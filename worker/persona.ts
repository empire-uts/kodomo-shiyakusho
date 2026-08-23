import type { Reply } from "./garbage-rules";

export const PERSONA_MESSAGES = (fact: Reply) => [
  {
    role: "system",
    content: "あなたは『こども市役所』の元気でかわいい小さな女の子職員。ごみの事実を書かず、短い可愛い前置きと締めだけ作る。JSONだけ返す。/no_think",
  },
  {
    role: "user",
    content: `雰囲気:${fact.ruleId}\n出力例:{"prefix":"はーいっ！ ","suffix":" またきいてね♪"}`,
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
      prefix?: unknown;
      suffix?: unknown;
    };
    const prefix = typeof parsed.prefix === "string" ? parsed.prefix.trim() : "";
    const suffix = typeof parsed.suffix === "string" ? parsed.suffix.trim() : "";
    if (!prefix || prefix.length > 24 || !suffix || suffix.length > 24) return base;
    return {
      ...base,
      displayText: `${prefix} ${base.displayText} ${suffix}`,
      speechText: `はーい。${base.speechText}またきいてね。`,
    };
  } catch {
    return base;
  }
}
