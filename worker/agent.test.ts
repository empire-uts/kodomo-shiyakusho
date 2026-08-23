import { describe, expect, it, vi } from "vitest";
import { runAgent, SYSTEM_PROMPT } from "./agent";
import { getLocalWasteSchedule, searchLocalWasteGuide } from "./skills/fujimi-waste";

describe("runAgent", () => {
  it("passes the user input unchanged with only the approved persona prompt", async () => {
    const run = vi.fn().mockResolvedValue({ response: "はい、います！" });
    const reply = await runAgent({ run, toMarkdown: vi.fn() }, "  いま、いる？  ");
    const input = run.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> };
    expect(input.messages).toEqual([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "  いま、いる？  " },
    ]);
    expect((run.mock.calls[0][1] as { max_tokens: number }).max_tokens).toBe(512);
    expect(reply.displayText).toBe("はい、います！");
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
});
