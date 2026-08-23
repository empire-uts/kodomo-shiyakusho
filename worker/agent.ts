import {
  getLocalWasteSchedule,
  searchLocalWasteGuide,
  searchOfficialWasteInfo,
  type MarkdownAi,
} from "./skills/fujimi-waste";

export const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
export const SYSTEM_PROMPT = "あなたは「こども市役所」の、元気で可愛い小さな女の子職員です。\n敬語はたどたどしいです。";

interface AiBinding extends MarkdownAi {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface ToolCall {
  name: string;
  arguments?: unknown;
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AgentReply {
  displayText: string;
  speechText: string;
  sourceUrl?: string;
  toolsUsed?: string[];
}

export const TOOLS = [
  {
    name: "get_local_waste_schedule",
    description: "富士見市鶴瀬西3丁目の、指定日または今日・明日のごみ収集予定を確認する。収集曜日の質問にだけ使う。",
    parameters: {
      type: "object",
      properties: {
        when: {
          type: "string",
          description: "today、tomorrow、または YYYY-MM-DD。今日ならtoday、明日ならtomorrow。",
        },
      },
      required: ["when"],
    },
  },
  {
    name: "search_local_waste_guide",
    description: "リポジトリに保存した富士見市鶴瀬西3丁目の簡潔な分別・収集資料を検索する。地域のごみ質問で最初に使う。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "調べたい品目またはごみ制度の短い検索語" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_official_fujimi_waste_info",
    description: "ローカル資料に答えがない品目を、富士見市公式の最新ごみ分別辞典で検索する。ごみ以外の質問には使わない。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "公式分別辞典で調べたい具体的な品目名" },
      },
      required: ["query"],
    },
  },
] as const;

function modelText(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  if ("response" in result && typeof (result as { response?: unknown }).response === "string") {
    return (result as { response: string }).response;
  }
  const choices = "choices" in result ? (result as { choices?: unknown }).choices : undefined;
  if (Array.isArray(choices)) {
    const first = choices[0] as { message?: { content?: unknown } } | undefined;
    if (typeof first?.message?.content === "string") return first.message.content;
  }
  return "";
}

function toolCalls(result: unknown): ToolCall[] {
  if (typeof result !== "object" || result === null || !("tool_calls" in result)) return [];
  const calls = (result as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) => {
    if (typeof call !== "object" || call === null || !("name" in call) || typeof call.name !== "string") return [];
    return [{ name: call.name, arguments: "arguments" in call ? call.arguments : undefined }];
  });
}

function argumentsObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function executeTool(ai: AiBinding, call: ToolCall): Promise<{ content: string; sourceUrl?: string }> {
  const args = argumentsObject(call.arguments);
  if (call.name === "get_local_waste_schedule") return getLocalWasteSchedule(args.when);
  if (call.name === "search_local_waste_guide") return searchLocalWasteGuide(String(args.query ?? ""));
  if (call.name === "search_official_fujimi_waste_info") {
    return searchOfficialWasteInfo(ai, String(args.query ?? ""));
  }
  return { content: `利用できないスキルです: ${call.name}` };
}

function cleanAnswer(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function runAgent(ai: AiBinding, userInput: string): Promise<AgentReply> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];
  const toolsUsed: string[] = [];
  let sourceUrl: string | undefined;

  for (let toolRound = 0; toolRound <= 2; toolRound += 1) {
    const canCallTool = toolRound < 2;
    const result = await ai.run(MODEL, {
      messages,
      ...(canCallTool ? { tools: TOOLS } : {}),
      max_tokens: 256,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.05,
      stream: false,
    });
    const call = canCallTool ? toolCalls(result)[0] : undefined;
    if (!call) {
      const answer = cleanAnswer(modelText(result));
      if (!answer) throw new Error("LLMが回答文を返しませんでした。");
      return {
        displayText: answer,
        speechText: answer,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
      };
    }

    const toolResult = await executeTool(ai, call);
    toolsUsed.push(call.name);
    sourceUrl = toolResult.sourceUrl ?? sourceUrl;
    messages.push(
      { role: "assistant", content: JSON.stringify(call) },
      { role: "tool", content: JSON.stringify(toolResult) },
    );
  }

  throw new Error("LLMの回答処理が完了しませんでした。");
}
