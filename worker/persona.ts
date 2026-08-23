import type { Reply } from "./garbage-rules";

export const PERSONA_MESSAGES = (fact: Reply) => [
  {
    role: "system",
    content: "あなたは『こども市役所』の元気でかわいい小さな女の子職員。お年寄りへ『〜だよっ』『〜してね』と親しく話す。です・ます調は禁止。事実を変えず、新情報を足さない。80字以内のJSONだけ返す。/no_think",
  },
  {
    role: "user",
    content: `事実:${fact.displayText}\n出力:{"displayText":"かわいい短文"}`,
  },
];

function modelText(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  if ("response" in result && typeof (result as { response?: unknown }).response === "string") {
    return (result as { response: string }).response;
  }
  if ("choices" in result) {
    const choices = (result as { choices?: unknown }).choices;
    if (Array.isArray(choices)) {
      const first = choices[0] as { message?: { content?: unknown } } | undefined;
      if (typeof first?.message?.content === "string") return first.message.content;
    }
  }
  return "";
}

export function applyPersonaResult(base: Reply, result: unknown): Reply {
  const raw = modelText(result).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return base;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      displayText?: unknown;
    };
    const displayText = typeof parsed.displayText === "string" ? parsed.displayText.trim() : "";
    if (!displayText || displayText.length > 120) return base;
    if (base.category && !displayText.includes(base.category)) return base;
    return { ...base, displayText };
  } catch {
    return base;
  }
}
