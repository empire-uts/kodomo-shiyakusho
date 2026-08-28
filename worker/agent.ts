import {
  getLocalWasteSchedule,
  searchLocalWasteGuide,
  searchOfficialWasteInfo,
  type MarkdownAi,
} from "./skills/fujimi-waste";

export const MODEL: string = "@cf/zai-org/glm-4.7-flash";
export const SYSTEM_PROMPT = "あなたは、利用者とトランシーバーで話す小さな案内役の「ヤドカリさん」です。親しみやすく、落ち着いた自然な敬語で話します。ヤドカリを強調した語尾や駄洒落は使いません。\n利用者の話を聞いて段取りを引き受け、必要に応じて確認・調査・整理しながら一緒に進めます。日常の相談全般が担当です。\nごみ以外の相談にも持っている知識で答え、段取りを前へ進めます。スキルがないことを理由に断りません。\nスキルは必要な場合だけ使います。利用できるスキルの種類・スキル名・内部の判断は、利用者への回答に書きません。\n回答は音声で読み上げられます。内容の範囲は狭めず、一度聞いて理解できる自然な話し言葉にします。結論や次の一手を先に言い、一文を短めにします。\n利用者が「今日」「明日」「明後日」と言ったときは、その言葉を回答でも使います。必要もないのに年月日へ変換しません。日付が必要なら月日だけを言い、年は年を聞かれた場合か、年またぎで曖昧な場合だけ言います。\nMarkdown、見出し、箇条書き、番号リスト、表、URL、長い括弧書きは使いません。複数の項目は「三つあります。一つ目は」のように、耳で順番が分かる言葉で話します。\n絵文字・顔文字・装飾目的の記号は使いません。";

interface AiBinding extends MarkdownAi {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface ToolCall {
  id?: string;
  name: string;
  arguments?: unknown;
}

export interface ConversationMessage {
  role: "user" | "assistant";
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

const USES_CHAT_COMPLETIONS_SCHEMA = MODEL !== "@cf/qwen/qwen3-30b-a3b-fp8";
const MODEL_TOOLS = USES_CHAT_COMPLETIONS_SCHEMA
  ? TOOLS.map((tool) => ({ type: "function", function: tool }))
  : TOOLS;

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
  if (typeof result !== "object" || result === null) return [];
  if ("tool_calls" in result && Array.isArray(result.tool_calls)) {
    return result.tool_calls.flatMap((call) => {
      if (typeof call !== "object" || call === null || !("name" in call) || typeof call.name !== "string") return [];
      return [{ name: call.name, arguments: "arguments" in call ? call.arguments : undefined }];
    });
  }
  const choices = "choices" in result ? result.choices : undefined;
  if (!Array.isArray(choices)) return [];
  const first = choices[0] as { message?: { tool_calls?: unknown } } | undefined;
  if (!Array.isArray(first?.message?.tool_calls)) return [];
  return first.message.tool_calls.flatMap((call) => {
    if (
      typeof call !== "object"
      || call === null
      || !("id" in call)
      || typeof call.id !== "string"
      || !("function" in call)
      || typeof call.function !== "object"
      || call.function === null
      || !("name" in call.function)
      || typeof call.function.name !== "string"
    ) return [];
    return [{
      id: call.id,
      name: call.function.name,
      arguments: "arguments" in call.function ? call.function.arguments : undefined,
    }];
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

const EMOJI_PATTERN = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\p{Emoji_Modifier})?)*|\p{Emoji_Modifier})/gu;
const KAOMOJI_PATTERN = /\s*(?:\([^\n()]{0,24}[｡ﾟ・＾^∀▽ωДдノﾉ´｀><＞＜•;；*][^\n()]{0,24}\)|（[^\n（）]{0,24}[｡ﾟ・＾^∀▽ωДдノﾉ´｀><＞＜•;；*][^\n（）]{0,24}）)(?:[ノﾉ/])?/gu;
const DECORATIVE_SYMBOL_PATTERN = /[☆★♡♥✦✧♪♫]+/gu;

function cleanAnswer(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/([#*0-9])\uFE0F?\u20E3/gu, "$1")
    .replace(KAOMOJI_PATTERN, "")
    .replace(EMOJI_PATTERN, "")
    .replace(DECORATIVE_SYMBOL_PATTERN, "")
    .replace(/[\uFE0E\uFE0F\u200D]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SPOKEN_ORDINALS = [
  "一つ目は",
  "二つ目は",
  "三つ目は",
  "四つ目は",
  "五つ目は",
  "六つ目は",
  "七つ目は",
  "八つ目は",
  "九つ目は",
  "十個目は",
];

function speechTextFrom(answer: string): string {
  let bulletIndex = 0;
  const spokenLines = answer
    .replace(/```[\s\S]*?```/g, "コードは画面で確認してください。")
    .replace(/\[([^\]]+)]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/[^\s)）]+/g, "")
    .replace(/(?:19|20)\d{2}年(?=\s*\d{1,2}月)/g, "")
    .replace(/\b(?:19|20)\d{2}-(\d{1,2})-(\d{1,2})\b/g, (_match, month: string, day: string) => (
      `${Number(month)}月${Number(day)}日`
    ))
    .split(/\n+/)
    .map((line) => {
      let spoken = line.trim().replace(/^#{1,6}\s*/, "");
      const numbered = spoken.match(/^(\d{1,2})(?:[.)、．]|\s+)\s*(.*)$/);
      if (numbered) {
        const position = Number(numbered[1]);
        const ordinal = SPOKEN_ORDINALS[position - 1] ?? `${position}番目は`;
        spoken = `${ordinal}、${numbered[2]}`;
      } else if (/^[-*+•・▪◦]\s*/u.test(spoken)) {
        bulletIndex += 1;
        const ordinal = SPOKEN_ORDINALS[bulletIndex - 1] ?? `${bulletIndex}番目は`;
        spoken = spoken.replace(/^[-*+•・▪◦]\s*/u, `${ordinal}、`);
      }
      spoken = spoken
        .replace(/[*_`~]/g, "")
        .replace(/[〜～]+/g, "。")
        .replace(/[／/]+/g, "、")
        .replace(/[:：]+/g, "、")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      if (spoken && !/[。！？!?]$/.test(spoken)) spoken += "。";
      return spoken;
    })
    .filter(Boolean);

  return spokenLines
    .join(" ")
    .replace(/。{2,}/g, "。")
    .replace(/、{2,}/g, "、")
    .replace(/([。！？!?])\s+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function runAgent(
  ai: AiBinding,
  userInput: string,
  history: ConversationMessage[] = [],
): Promise<AgentReply> {
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: userInput },
  ];
  const toolsUsed: string[] = [];
  let sourceUrl: string | undefined;

  for (let toolRound = 0; toolRound <= 2; toolRound += 1) {
    const canCallTool = toolRound < 2;
    const result = await ai.run(MODEL, {
      messages,
      ...(canCallTool ? { tools: MODEL_TOOLS } : {}),
      temperature: 0.7,
      top_p: 0.9,
      ...(!USES_CHAT_COMPLETIONS_SCHEMA ? { repetition_penalty: 1.05 } : {}),
      stream: false,
    });
    const call = canCallTool ? toolCalls(result)[0] : undefined;
    if (!call) {
      const answer = cleanAnswer(modelText(result));
      if (!answer) throw new Error("LLMが回答文を返しませんでした。");
      return {
        displayText: answer,
        speechText: speechTextFrom(answer),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
      };
    }

    const toolResult = await executeTool(ai, call);
    toolsUsed.push(call.name);
    sourceUrl = toolResult.sourceUrl ?? sourceUrl;
    if (call.id) {
      const argumentsJson = typeof call.arguments === "string"
        ? call.arguments
        : JSON.stringify(call.arguments ?? {});
      messages.push(
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: argumentsJson },
          }],
        },
        { role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) },
      );
    } else {
      messages.push(
        { role: "assistant", content: JSON.stringify(call) },
        { role: "tool", content: JSON.stringify(toolResult) },
      );
    }
  }

  throw new Error("LLMの回答処理が完了しませんでした。");
}
