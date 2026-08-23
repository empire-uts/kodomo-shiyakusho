# こども市役所

高齢者やデジタル操作が苦手な人が、大きなボタンを押して話せる音声Webアプリの試作です。回答役は、小さな「こども職員」です。ごみ分別専用アプリではなく、入力内容をQwenへ渡し、必要な場合だけ地域情報スキルを使います。

> 子ども向けアプリではありません。「こども市役所」は案内役の設定です。

## 現在の構成

| 項目 | 内容 |
| --- | --- |
| Web UI | React、TypeScript |
| 配信・API | Cloudflare Workers |
| 音声認識 | Workers AI Whisper Large V3 Turbo |
| 会話 | Workers AI Qwen 3 30B-A3B FP8 |
| 追加情報 | Qwenが必要時だけ呼ぶFunction Callingスキル |
| 設定地域 | 埼玉県富士見市鶴瀬西3丁目 |
| 音声出力 | 端末の日本語音声。外部TTS接続口も保持 |

dev版では、音声から変換したテキストと回答テキストを診断ログへ記録します。音声本体、IP、リクエストヘッダーはアプリから明示的には記録しません。

## 会話コンテキスト

Qwenへ常時渡すsystemメッセージは次の2文だけです。

```text
あなたは「こども市役所」の、元気で可愛い小さな女の子職員です。
敬語はたどたどしいです。
```

音声認識後の文字列は、空白を含め加工せずuserメッセージとして渡します。前後の固定挨拶、回答JSONの強制、ごみ専用プロンプト、会話履歴はありません。

```ts
[
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: transcript },
]
```

推論パラメータは `max_tokens: 512`、`temperature: 0.7`、`top_p: 0.9`、`repetition_penalty: 1.05` です。Qwenが思考だけで出力枠を使い切らないため、実環境テスト後に256から512へ変更しました。

## エージェンティックなスキル

Qwenには次のFunction Callingスキルを提示します。ごみ情報はsystemプロンプトへ埋め込まず、Qwenがスキルを選んだときだけ会話へ追加します。

| スキル | 用途 |
| --- | --- |
| `get_local_waste_schedule` | 鶴瀬西3丁目の指定日・今日・明日の収集予定 |
| `search_local_waste_guide` | リポジトリ内の簡潔な地域資料を検索 |
| `search_official_fujimi_waste_info` | ローカル資料にない品目を富士見市公式分別辞典で検索 |

ツール実行は1回の質問につき最大2回です。たとえば、ローカル資料で見つからなければ、次の巡回で公式資料を検索できます。ごみに関係ない質問では、Qwenがツールを選ばずそのまま回答します。

公式検索は任意URLを受け取りません。Worker内で許可した富士見市公式PDFだけを取得し、Workers AI Markdown Conversionで文字列化して該当箇所だけをQwenへ返します。取得・変換に失敗した場合は、推測を促さず富士見市環境課への確認情報を返します。

## 地域資料

簡潔な収集曜日と主要な分別情報は [`worker/skills/fujimi-waste/reference.md`](worker/skills/fujimi-waste/reference.md) にあります。

- 対象: 富士見市鶴瀬西3丁目
- 可燃ごみ: 火・金
- 資源プラスチック: 金
- 不燃・有害ごみ、ペットボトル、紙・布類、ビン、カン: 水
- 当日午前8時30分までに集積所へ出す
- 祝日も収集。年末年始はその年の案内を確認

資料の正本は富士見市公式の「家庭ごみと資源の出し方」と「ごみ分別辞典」です。

## 処理フロー

1. 利用者が大きなボタンを押して録音を始める。
2. もう一度押すか30秒経過すると録音を止める。
3. Whisperが日本語の文字列へ変換する。
4. 文字列をそのままQwenへ渡す。
5. Qwenが必要なら地域情報スキルを選ぶ。
6. Workerがスキルを実行し、結果をQwenへ返す。
7. Qwenの回答を画面表示し、自動読み上げする。

## API

### `POST /api/transcribe`

`multipart/form-data` の `audio` を日本語テキストへ変換します。Whisperには `language: "ja"` を指定しますが、ごみ専用の `initial_prompt` は設定しません。

```json
{
  "text": "アイロンは何ごみですか"
}
```

### `POST /api/chat`

```json
{
  "message": "アイロンは何ごみですか",
  "inputSource": "voice"
}
```

`message` は内容を変更せずQwenへ渡します。空文字と1,000文字超だけを拒否します。

```json
{
  "displayText": "アイロンは、不燃ごみですっ。",
  "speechText": "アイロンは、不燃ごみですっ。",
  "sourceUrl": "https://www.city.fujimi.saitama.jp/...",
  "toolsUsed": ["search_local_waste_guide"]
}
```

`sourceUrl` と `toolsUsed` はスキルを使った場合だけ返します。

### `POST /api/speech`

外部TTSが設定されている場合、読み上げ用テキストから音声を返します。dev版は端末の日本語音声を使います。

## プライバシー

- 音声データは永続保存しない。
- dev版は `transcript` と `responseText` をCloudflareログへ記録する。
- 本番では診断ログを無効にする。
- APIキーや秘密情報をフロントへ含めない。
- 公式検索先は富士見市の許可済みURLに固定する。

## ディレクトリ

```text
src/                                      React UI、録音、再生、APIクライアント
worker/index.ts                           APIルーティング、Whisper、TTS中継
worker/agent.ts                           QwenとFunction Callingの実行ループ
worker/skills/fujimi-waste/index.ts       地域情報スキル
worker/skills/fujimi-waste/reference.md   人が確認する簡潔な地域資料
worker/skills/fujimi-waste/reference.ts   Workerへバンドルする同内容の参照文字列
.github/workflows/ci.yml                  CIとdev/mainのCloudflare配備
```

`reference.md` と `reference.ts` は同時に更新します。

## ローカル確認

Node.js 22以上を使います。

```bash
npm ci
npm run dev
```

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

dev配備は次を実行します。

```bash
npm run deploy:cloudflare:dev
```

`dev` ブランチへの更新時は、GitHub Actionsが同じdev Workerへ自動配備します。

## 決定事項

| 日付 | 決定 |
| --- | --- |
| 2026-08-23 | 入力テキストを加工せずQwenへ渡す |
| 2026-08-23 | systemプロンプトを指定の2文だけにする |
| 2026-08-23 | 固定のごみ判定・回答合成・前後の挨拶を削除する |
| 2026-08-23 | 富士見市のごみ情報を必要時だけ呼ぶスキルとして残す |
| 2026-08-23 | スキル実行を最大2回に制限する |
| 2026-08-23 | 音声品質の改善は今回の変更対象外とする |
