export interface Reply {
  displayText: string;
  speechText: string;
  source: "master" | "official-guidance" | "fallback";
  ruleId: string;
  category?: string;
  sourceUrl?: string;
}

const DICTIONARY_URL = "https://www.city.fujimi.saitama.jp/kurashi_tetsuzuki/gomi_recycle/gomi/dashikata/gominobunbtunituite.files/gomibunnbetuziten20260724.pdf";
const COLLECTION_URL = "https://www.city.fujimi.saitama.jp/kurashi_tetsuzuki/gomi_recycle/gomi/dashikata/gominobunbtunituite.html";
const SPRAY_URL = "https://www.city.fujimi.saitama.jp/kurashi_tetsuzuki/gomi_recycle/gomi/dashikata/2010-0512-1609-138.html";

interface Rule {
  id: string;
  aliases: string[];
  reply: Reply;
}

const rules: Rule[] = [
  {
    id: "rechargeable-battery",
    aliases: ["充電池", "リチウムイオン電池", "モバイルバッテリー", "バッテリー"],
    reply: {
      displayText: "充電池は有害ごみです。外せる場合は機器から外し、JBRCの店頭回収も使えます。",
      speechText: "じゅうでんちは、ゆうがいごみです。はずせるばあいは、ききからはずしてね。",
      source: "master",
      ruleId: "rechargeable-battery",
      category: "有害ごみ",
      sourceUrl: DICTIONARY_URL,
    },
  },
  {
    id: "dry-battery",
    aliases: ["乾電池", "かんでんち"],
    reply: {
      displayText: "乾電池は有害ごみです。燃やすごみには混ぜず、有害ごみの日に出してください。",
      speechText: "かんでんちは、ゆうがいごみです。もやすごみには、まぜないでね。",
      source: "master",
      ruleId: "dry-battery",
      category: "有害ごみ",
      sourceUrl: DICTIONARY_URL,
    },
  },
  {
    id: "spray-can",
    aliases: ["スプレー缶", "カセットガス", "カセットボンベ", "ガス缶"],
    reply: {
      displayText: "中身を使い切り、穴を開けずにビン類のかごへ出してください。中身を出し切れないときは、市へ確認してください。",
      speechText: "なかみをつかいきり、あなをあけずに、びんるいのかごへだしてね。なかみがのこるときは、しにかくにんしてね。",
      source: "official-guidance",
      ruleId: "spray-can",
      category: "ビン",
      sourceUrl: SPRAY_URL,
    },
  },
  {
    id: "umbrella",
    aliases: ["傘", "かさ"],
    reply: {
      displayText: "傘は不燃ごみです。できるだけ分解し、親骨が70センチを超えるものは市へ確認してください。",
      speechText: "かさは、ふねんごみです。できるだけぶんかいして、ながいものは、しにかくにんしてね。",
      source: "master",
      ruleId: "umbrella",
      category: "不燃ごみ",
      sourceUrl: DICTIONARY_URL,
    },
  },
  {
    id: "diaper",
    aliases: ["おむつ", "紙おむつ"],
    reply: {
      displayText: "おむつは可燃ごみです。汚物は先にトイレへ流してから出してください。",
      speechText: "おむつは、かねんごみです。おぶつは、さきにといれへながしてね。",
      source: "master",
      ruleId: "diaper",
      category: "可燃ごみ",
      sourceUrl: DICTIONARY_URL,
    },
  },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\u3000、。！？?]/g, "");
}

export function answerQuestion(message: string): Reply {
  const normalized = normalize(message);
  const rule = rules.find((candidate) => candidate.aliases.some((alias) => normalized.includes(normalize(alias))));
  if (rule) return rule.reply;

  if (normalized.includes("出し忘れ") || normalized.includes("間に合わ")) {
    return {
      displayText: "収集後に出したごみは、その日の再収集はありません。次の収集日まで保管し、取り残しなら分別シールを確認してください。",
      speechText: "しゅうしゅうのあとにだしたごみは、そのひのさいしゅうしゅうはありません。つぎのひまで、ほかんしてね。",
      source: "official-guidance",
      ruleId: "missed-collection",
      sourceUrl: COLLECTION_URL,
    };
  }

  if (normalized.includes("今日") || normalized.includes("何曜日") || normalized.includes("収集日")) {
    return {
      displayText: "鶴瀬西の収集曜日は、まだ確認済みデータを登録していません。今は富士見市の収集日程で確認してください。",
      speechText: "つるせにしのしゅうしゅうようびは、まだかくにんちゅうです。いまは、ふじみしのにっていでかくにんしてね。",
      source: "fallback",
      ruleId: "schedule-unverified",
      sourceUrl: COLLECTION_URL,
    };
  }

  if (normalized.includes("電池")) {
    return {
      displayText: "乾電池ですか、充電できる電池ですか？ 種類を教えてください。",
      speechText: "かんでんちですか、じゅうでんできるでんちですか。しゅるいをおしえてね。",
      source: "fallback",
      ruleId: "battery-clarification",
      sourceUrl: DICTIONARY_URL,
    };
  }

  return {
    displayText: "まだ確認できない品物です。品物の名前と、金属・プラスチックなどの材質を一つずつ教えてください。",
    speechText: "まだかくにんできないしなものです。なまえと、ざいしつを、ひとつずつおしえてね。",
    source: "fallback",
    ruleId: "unknown-item",
    sourceUrl: COLLECTION_URL,
  };
}
