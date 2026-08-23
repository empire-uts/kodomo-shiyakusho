import { describe, expect, it } from "vitest";
import { answerQuestion } from "./garbage-rules";

describe("answerQuestion", () => {
  it("never routes dry batteries to burnable waste", () => {
    const reply = answerQuestion("乾電池って燃えるごみでいいの？");
    expect(reply.category).toBe("有害ごみ");
    expect(reply.displayText).not.toContain("可燃ごみです");
  });

  it("prioritizes rechargeable batteries over the generic battery wording", () => {
    expect(answerQuestion("充電池を捨てたい").ruleId).toBe("rechargeable-battery");
  });

  it("gives official spray-can safety guidance", () => {
    const reply = answerQuestion("スプレー缶はどう出す？");
    expect(reply.displayText).toContain("穴を開けず");
    expect(reply.category).toBe("ビン");
  });

  it("does not invent an unverified collection weekday", () => {
    const reply = answerQuestion("今日は何ごみ？");
    expect(reply.ruleId).toBe("schedule-unverified");
    expect(reply.source).toBe("fallback");
    expect(reply.displayText).toContain("まだ確認済みデータを登録していない");
  });

  it("asks for more detail instead of guessing unknown items", () => {
    const reply = answerQuestion("これは何ごみ？");
    expect(reply.source).toBe("fallback");
    expect(reply.displayText).toContain("材質");
  });
});
