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
      displayText: "充電池はね、有害ごみだよ。外せるときは機械から外してね。JBRCのお店の回収も使えるよ。",
      speechText: "じゅうでんちはね、ゆうがいごみだよ。はずせるときは、きかいからはずしてね。",
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
      displayText: "乾電池はね、有害ごみだよ。燃やすごみには入れないで、有害ごみの日に出してね。",
      speechText: "かんでんちはね、ゆうがいごみだよ。もやすごみにはいれないで、ゆうがいごみのひにだしてね。",
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
      displayText: "スプレー缶はね、中身をぜんぶ使い切って、穴を開けずにビンのかごへ入れてね。中身が残ったら、市役所に聞いてね。",
      speechText: "すぷれーかんはね、なかみをぜんぶつかいきって、あなをあけずに、びんのかごへいれてね。なかみがのこったら、しやくしょにきいてね。",
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
      displayText: "傘はね、不燃ごみだよ。できるだけ分けて、親骨が70センチより長かったら市役所に聞いてね。",
      speechText: "かさはね、ふねんごみだよ。できるだけわけて、ながかったら、しやくしょにきいてね。",
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
      displayText: "おむつはね、可燃ごみだよ。中のものは先にトイレへ流してから出してね。",
      speechText: "おむつはね、かねんごみだよ。なかのものは、さきにといれへながしてからだしてね。",
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
      displayText: "きょうはもう集めに来ないよ。次の収集日までしまっておいてね。取り残しなら、分別シールを見てみよう。",
      speechText: "きょうはもう、あつめにこないよ。つぎのしゅうしゅうびまで、しまっておいてね。",
      source: "official-guidance",
      ruleId: "missed-collection",
      sourceUrl: COLLECTION_URL,
    };
  }

  if (normalized.includes("今日") || normalized.includes("何曜日") || normalized.includes("収集日")) {
    return {
      displayText: "ごめんね。鶴瀬西の収集曜日は、まだ確認済みデータを登録していないんだ。今は富士見市の日程を見てね。",
      speechText: "ごめんね。つるせにしのしゅうしゅうようびは、まだかくにんちゅうなんだ。いまは、ふじみしのにっていをみてね。",
      source: "fallback",
      ruleId: "schedule-unverified",
      sourceUrl: COLLECTION_URL,
    };
  }

  if (normalized.includes("電池")) {
    return {
      displayText: "電池はどっちかな？ 使い切りの乾電池か、充電できる電池か教えてね。",
      speechText: "でんちはどっちかな。つかいきりのかんでんちか、じゅうでんできるでんちか、おしえてね。",
      source: "fallback",
      ruleId: "battery-clarification",
      sourceUrl: DICTIONARY_URL,
    };
  }

  return {
    displayText: "ごめんね、まだわからない品物だよ。名前と、金属・プラスチックなどの材質を一つずつ教えてね。",
    speechText: "ごめんね、まだわからないしなものだよ。なまえと、ざいしつを、ひとつずつおしえてね。",
    source: "fallback",
    ruleId: "unknown-item",
    sourceUrl: COLLECTION_URL,
  };
}
