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
    expect(SYSTEM_PROMPT).toContain("ヤドカリさん");
    expect(SYSTEM_PROMPT).not.toContain("女の子職員");
    expect(SYSTEM_PROMPT).toContain("スキルがないことを理由に断りません");
    expect(SYSTEM_PROMPT).toContain("内部の判断");
    expect(SYSTEM_PROMPT).toContain("必要もないのに年月日へ変換しません");
    expect(input.messages).toEqual([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "  いま、いる？  " },
    ]);
    expect(run.mock.calls[0][1]).not.toHaveProperty("max_tokens");
    expect(reply.displayText).toBe("はい、います！");
  });

  it("removes emoji, kaomoji, and decorative symbols from the answer", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: "はい！😊 いっしょに進めますね～♪ (^^)/\n1️⃣ まず確認します。",
        },
      }],
    });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "手伝って");
    expect(reply.displayText).toBe("はい！ いっしょに進めますね～\n1 まず確認します。");
    expect(reply.speechText).toBe("はい！いっしょに進めますね。一つ目は、まず確認します。");
  });

  it("turns visual formatting into natural spoken ordering", async () => {
    const run = vi.fn().mockResolvedValue({
      response: "## 買い物の手順\n- 財布を持ちます\n- 駅へ行きます\n詳しくは [案内ページ](https://example.com/guide) です。",
    });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "買い物の段取りをして");
    expect(reply.displayText).toContain("## 買い物の手順");
    expect(reply.speechText).toBe(
      "買い物の手順。一つ目は、財布を持ちます。二つ目は、駅へ行きます。詳しくは 案内ページ です。",
    );
  });

  it("does not read an unnecessary year or ISO date aloud", async () => {
    const run = vi.fn().mockResolvedValue({
      response: "明日は2026年8月24日です。次の予定は2026-08-31です。",
    });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "明日の予定は？");
    expect(reply.displayText).toBe("明日は2026年8月24日です。次の予定は2026-08-31です。");
    expect(reply.speechText).toBe("明日は8月24日です。次の予定は8月31日です。");
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

  it("supports OpenAI-compatible chat completion tool calls", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: { name: "search_local_waste_guide", arguments: "{\"query\":\"乾電池\"}" },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: "乾電池は有害ごみです。" } }] });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "乾電池は何ごみ？");
    const firstInput = run.mock.calls[0][1] as { tools: Array<{ type?: string }> };
    const secondInput = run.mock.calls[1][1] as { messages: Array<Record<string, unknown>> };
    expect(firstInput.tools[0].type).toBe("function");
    expect(secondInput.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-1" });
    expect(reply.displayText).toBe("乾電池は有害ごみです。");
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
