import { describe, expect, it } from "vitest";
import { answerQuestion } from "./garbage-rules";
import { applyPersonaResult } from "./persona";

describe("applyPersonaResult", () => {
  const base = answerQuestion("乾電池は何ごみ？");

  it("keeps verified metadata while applying the generated wording", () => {
    const reply = applyPersonaResult(base, {
      response: '{"displayText":"乾電池はね、有害ごみだよっ。いっしょに気をつけようね！","speechText":"かんでんちはね、ゆうがいごみだよ。いっしょにきをつけようね"}',
    });
    expect(reply.displayText).toContain("だよっ");
    expect(reply.ruleId).toBe("dry-battery");
    expect(reply.category).toBe("有害ごみ");
  });

  it("falls back to the verified reply on malformed output", () => {
    expect(applyPersonaResult(base, { response: "not json" })).toEqual(base);
  });
});
