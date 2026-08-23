import { describe, expect, it } from "vitest";
import { answerQuestion } from "./garbage-rules";
import { applyPersonaResult } from "./persona";

describe("applyPersonaResult", () => {
  const base = answerQuestion("乾電池は何ごみ？");

  it("keeps verified metadata while applying the generated wording", () => {
    const reply = applyPersonaResult(base, {
      response: '{"prefix":"はーいっ！","suffix":"またきいてね♪"}',
    });
    expect(reply.displayText).toContain(base.displayText);
    expect(reply.displayText).toContain("はーいっ");
    expect(reply.ruleId).toBe("dry-battery");
    expect(reply.category).toBe("有害ごみ");
    expect(reply.speechText).toContain(base.speechText);
  });

  it("falls back to safe fixed decoration on malformed output", () => {
    const reply = applyPersonaResult(base, { response: "not json" });
    expect(reply.displayText).toContain(base.displayText);
    expect(reply.ruleId).toBe(base.ruleId);
  });
});
