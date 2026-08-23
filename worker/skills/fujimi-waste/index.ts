import { LOCAL_WASTE_REFERENCE } from "./reference";

export const COLLECTION_GUIDE_URL = "https://www.city.fujimi.saitama.jp/kurashi_tetsuzuki/gomi_recycle/gomi/dashikata/gominobunbtunituite.html";
export const OFFICIAL_DICTIONARY_URL = "https://www.city.fujimi.saitama.jp/kurashi_tetsuzuki/gomi_recycle/gomi/dashikata/gominobunbtunituite.files/gomibunnbetuziten20260724.pdf";

export interface MarkdownResult {
  format?: string;
  data?: string;
  error?: string;
}

export interface MarkdownAi {
  toMarkdown(input: { name: string; blob: Blob }): Promise<MarkdownResult | MarkdownResult[]>;
}

function compact(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\u3000、。！？!?「」『』]/g, "");
}

function queryTerms(query: string): string[] {
  const normalized = compact(query);
  const core = normalized
    .replace(/(について|を)?(教えて|知りたい|調べて).*$/g, "")
    .replace(/(は|って)?(何ごみ|何ゴミ|どう捨てる|どう出す|捨て方|出し方|処分方法|分別).*$/g, "")
    .replace(/(ごみ|ゴミ)$/g, "");
  return [...new Set([core, normalized].filter((term) => term.length >= 2))];
}

export function searchText(text: string, query: string, maxCharacters = 4_000): string {
  const lines = text.split(/\r?\n/);
  const terms = queryTerms(query);
  const hitIndexes = lines
    .map((line, index) => ({ index, score: terms.reduce((score, term) => score + (compact(line).includes(term) ? term.length : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ index }) => index);

  if (hitIndexes.length === 0) {
    return "該当箇所を見つけられませんでした。必要なら富士見市公式の分別辞典を検索してください。";
  }

  const selected = new Set<number>();
  for (const index of hitIndexes) {
    for (let nearby = Math.max(0, index - 2); nearby <= Math.min(lines.length - 1, index + 2); nearby += 1) {
      selected.add(nearby);
    }
  }
  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .join("\n")
    .slice(0, maxCharacters);
}

export function searchLocalWasteGuide(query: string): { content: string; sourceUrl: string } {
  return {
    content: searchText(LOCAL_WASTE_REFERENCE, query, 2_500),
    sourceUrl: COLLECTION_GUIDE_URL,
  };
}

function jstDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function resolveDate(when: unknown, now: Date): Date {
  const today = jstDateParts(now);
  const offset = when === "tomorrow" || when === "明日" ? 1 : 0;
  if (typeof when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(when)) {
    const [year, month, day] = when.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
}

export function getLocalWasteSchedule(when: unknown, now = new Date()): { content: string; sourceUrl: string } {
  const date = resolveDate(when, now);
  const isoDate = date.toISOString().slice(0, 10);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()];
  const collections: Record<number, string[]> = {
    2: ["可燃ごみ"],
    3: ["不燃・有害ごみ、ペットボトル、紙・布類、ビン、カン"],
    5: ["可燃ごみ", "資源プラスチック"],
  };
  const items = collections[date.getUTCDay()] ?? [];
  const schedule = items.length > 0 ? items.join(" / ") : "定期収集なし";
  return {
    content: `対象: 富士見市鶴瀬西3丁目\n日付: ${isoDate}（${weekday}曜日）\n収集: ${schedule}\n当日午前8時30分までに集積所へ。祝日も収集。年末年始は市の最新案内を確認。`,
    sourceUrl: COLLECTION_GUIDE_URL,
  };
}

let dictionaryMarkdown: Promise<string> | undefined;

async function loadOfficialDictionary(ai: MarkdownAi): Promise<string> {
  if (!dictionaryMarkdown) {
    dictionaryMarkdown = (async () => {
      const response = await fetch(OFFICIAL_DICTIONARY_URL, {
        headers: { accept: "application/pdf" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`公式資料の取得に失敗しました (${response.status})`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > 2 * 1024 * 1024) throw new Error("公式資料の容量が上限を超えています");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 2 * 1024 * 1024) throw new Error("公式資料の容量が上限を超えています");
      const converted = await ai.toMarkdown({
        name: "fujimi-waste-dictionary.pdf",
        blob: new Blob([buffer], { type: "application/pdf" }),
      });
      const result = Array.isArray(converted) ? converted[0] : converted;
      if (!result || result.format === "error" || typeof result.data !== "string") {
        throw new Error(result?.error ?? "公式資料を文字に変換できませんでした");
      }
      return result.data;
    })().catch((error) => {
      dictionaryMarkdown = undefined;
      throw error;
    });
  }
  return dictionaryMarkdown;
}

export async function searchOfficialWasteInfo(ai: MarkdownAi, query: string): Promise<{ content: string; sourceUrl: string }> {
  try {
    const markdown = await loadOfficialDictionary(ai);
    return {
      content: searchText(markdown, query),
      sourceUrl: OFFICIAL_DICTIONARY_URL,
    };
  } catch (error) {
    return {
      content: `富士見市公式資料を検索できませんでした。推測せず、環境課（049-252-7100）への確認を案内してください。理由: ${error instanceof Error ? error.message : String(error)}`,
      sourceUrl: COLLECTION_GUIDE_URL,
    };
  }
}
