import { describe, expect, it, vi } from "vitest";
import { runAgent, SYSTEM_PROMPT } from "./agent";
import { getLocalWasteSchedule, searchLocalWasteGuide, searchOfficialWasteInfo } from "./skills/fujimi-waste";

describe("runAgent", () => {
  it("passes the user input unchanged with only the approved persona prompt", async () => {
    const run = vi.fn().mockResolvedValue({ response: "はい、います！" });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "  いま、いる？  ");
    const input = run.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> };
    expect(SYSTEM_PROMPT).toContain("段取りを引き受け");
    expect(SYSTEM_PROMPT).toContain("日常の相談全般");
    expect(SYSTEM_PROMPT).toContain("スキルがないことを理由に断りません");
    expect(SYSTEM_PROMPT).toContain("内部の判断");
    expect(input.messages).toEqual([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "  いま、いる？  " },
    ]);
    expect(run.mock.calls[0][1]).not.toHaveProperty("max_tokens");
    expect(reply.displayText).toBe("はい、います！");
  });

  it("places recent conversation before the current user message", async () => {
    const run = vi.fn().mockResolvedValue({ response: "では、温かいうどんにしましょう！" });
    await runAgent({ run, toMarkdown: vi.fn() }, "温かいのがいい", [
      { role: "user", content: "お昼、何がいい？" },
      { role: "assistant", content: "温かいものと冷たいもの、どちらがいいですか？" },
    ]);
    const input = run.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> };
    expect(input.messages).toEqual([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "お昼、何がいい？" },
      { role: "assistant", content: "温かいものと冷たいもの、どちらがいいですか？" },
      { role: "user", content: "温かいのがいい" },
    ]);
  });

  it("executes a selected local skill and returns the model's final answer", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ tool_calls: [{ name: "search_local_waste_guide", arguments: { query: "乾電池" } }] })
      .mockResolvedValueOnce({ response: "乾電池は、有害ごみですっ。" });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "乾電池は何ごみ？");
    expect(reply.displayText).toBe("乾電池は、有害ごみですっ。");
    expect(reply.toolsUsed).toEqual(["search_local_waste_guide"]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("fujimi waste skills", () => {
  it("returns the verified Friday schedule for Tsuruse-nishi 3-chome", () => {
    const result = getLocalWasteSchedule("2026-08-28");
    expect(result.content).toContain("可燃ごみ / 資源プラスチック");
  });

  it("searches the compact repository reference", () => {
    expect(searchLocalWasteGuide("アイロンは何ごみ？").content).toContain("アイロン: 不燃ごみ");
  });

  it("tells the model not to guess when the official dictionary has no match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: { "content-type": "application/pdf", "content-length": "1" },
    })));
    const result = await searchOfficialWasteInfo({
      toMarkdown: vi.fn().mockResolvedValue({ format: "markdown", data: "# ごみ分別辞典\n別の品目: 可燃ごみ" }),
    }, "アコーディオン");
    expect(result.content).toContain("区分を推測せず");
    expect(result.content).toContain("調べたけどわかりません");
    vi.unstubAllGlobals();
  });
});
