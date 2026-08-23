# こども市役所

高齢者やデジタル操作が苦手な人が、トランシーバーを模した大きなボタンで相談できる音声Webアプリの試作です。

テーマは「段取りのアウトソーシング」です。ごみ分別専用にはせず、日常の相談を幅広く受け、必要に応じて確認・調査・整理しながら次の行動を一緒に決めます。回答役は、小さな「こども職員」です。

> 子ども向けアプリではありません。「こども市役所」は案内役の設定です。

## 現在のDEV版

- URL: <https://kodomo-shiyakusho-dev.kii-einsatz.workers.dev/>
- 開発ブランチ: `dev`
- Worker名: `kodomo-shiyakusho-dev`
- 設定地域: 埼玉県富士見市・鶴瀬西
- 診断ログ: 有効

現在はDEV版を開発・検証対象としています。`dev` ブランチへのpush後、GitHub Actionsが検査を行い、成功すると同じDEV Workerへ自動配備します。

## 現在の構成

| 項目 | 実装 |
| --- | --- |
| Web UI | React 19、TypeScript、Vite |
| 配信・API | Cloudflare Workers |
| 音声認識 | Workers AI Whisper Large V3 Turbo |
| 会話モデル | Workers AI `@cf/zai-org/glm-4.7-flash` |
| 地域情報 | Function Callingで必要時だけ実行 |
| 会話履歴 | タブ単位で直近6メッセージ、最大3往復 |
| 音声出力 | 端末の日本語音声。外部TTS接続口も保持 |
| 端末間通話 | WebRTCによる1対1のP2P音声通信 |
| 通話シグナリング | Cloudflare Durable ObjectとWebSocket |

## 画面仕様

### AI音声相談

- トランシーバー中央の大きな「話す」ボタンで録音を開始する。
- もう一度押すと録音を止めて送信する。
- 30秒経過した場合も自動で録音を止める。
- 初回はブラウザのマイク許可を明示的に取得し、許可状態の変化を監視する。
- 「文字起こし中」と「返事を考えています」を分けて表示する。
- 回答到着後は自動読み上げを試み、失敗しても「再生」から再試行できる。
- 回答後の右下「発信」は、続けてAIへ相談する操作として使う。
- 声を使えない場合は例題ボタンから同じ会話処理を試せる。

### 会話履歴

- トランシーバーの下に机と巻物を表示する。
- 利用者とこども職員の直近の会話を巻物へ記録する。
- マウスホイール、スクロールバー、紙面のドラッグで履歴を移動できる。
- スクロール量に合わせて巻物のローラーが回転する。
- 履歴は `sessionStorage` に保存し、タブを閉じると失われる。

### 端末間P2P通話

受信・発信ボタンは別パネルではなく、トランシーバー本体の左上と右上に配置します。通信番号やパスワードの入力はありません。

#### 受信側

1. 左上の「受信」を押す。
2. WebSocketへ接続し、リッスン待機状態になる。
3. 左ボタンが「中止」に変わり、そのボタンだけを強調する。
4. 発信ボタン、AI録音、例題などは非強調・無効になる。
5. 着信すると左ボタンを強調し、「受信」を押して応答する。
6. 応答操作を起点にマイクを取得し、WebRTC接続を確立する。

#### 発信側

1. 右上の「発信」を押す。
2. マイクを取得し、受信待機中の相手を呼び出す。
3. 呼び出し中は右ボタンが「中止」に変わり、そのボタンだけを強調する。
4. 受信ボタン、AI録音、例題などは非強調・無効になる。
5. 30秒以内に応答がない場合は呼び出しを終了する。

#### 通話中と終了

- 音声はCloudflareを経由せず、WebRTCで端末間を直接送受信する。
- ICEサーバーには `stun:stun.cloudflare.com:3478` だけを使用する。
- 通話成立後は双方のボタンを「通話終了」へ切り替える。
- どちらかが終了すると、PeerConnection、WebSocket、ローカル音声トラック、相手音声を解放する。
- 相手側には「通話が終了しました」と表示する。
- マイク拒否、マイク未検出、接続失敗、相手切断では理由を短く表示し、再操作できる状態へ戻す。
- 一時的なWebRTC切断には6秒の猶予を設ける。

#### 現在の通話制約

- 対象は1対1のみ。
- パスワード、通信番号、相手選択はない。
- 現在は単一の待受先 `direct-call` を使うDEVモックで、同時に接続できるブラウザは2台まで。
- 複数組の同時通話、履歴保存、録音、オフライン通知はない。
- TURN中継は使わないため、厳しいNATやファイアウォール環境ではP2P接続できない場合がある。
- LINE Botなどで実利用する場合は、利用者と通信先を外部のIDで結び付ける設計へ置き換える想定。

## AI会話仕様

### 基本方針

モデルには次の方針をsystemメッセージで渡します。正本は [`worker/agent.ts`](worker/agent.ts) の `SYSTEM_PROMPT` です。

- 「こども市役所」の元気で可愛い小さな女の子職員として話す。
- 敬語は少したどたどしくする。
- 日常の相談全般を扱い、段取りを引き受ける。
- ごみ以外の相談も、スキルがないことを理由に断らない。
- 結論や次の一手を先にし、一度聞いて理解できる短い口語文にする。
- 「今日」「明日」「明後日」は必要なく年月日へ展開しない。
- Markdown、見出し、箇条書き、番号リスト、表、URL、長い括弧書きを回答へ含めない。
- 絵文字、顔文字、装飾目的の記号を使わない。
- 内部のスキル名や判断過程を利用者へ説明しない。

推論パラメータは `temperature: 0.7`、`top_p: 0.9`、`stream: false` です。

### 会話コンテキスト

- 現在のタブ内で、直近6メッセージ、最大3往復を保持する。
- 履歴は `user`、`assistant` の順でモデルへ渡す。
- 各メッセージは最大1,000文字、履歴全体は最大6,000文字。
- `sessionId` はタブごとに生成し、DEV診断ログの会話単位として使う。
- サーバー側で会話を永続保存しない。

モデルへ渡す並びは次の形式です。

```ts
[
  { role: "system", content: SYSTEM_PROMPT },
  ...history,
  { role: "user", content: transcript },
]
```

### 回答の後処理

- モデル出力から思考タグ、絵文字、顔文字、装飾記号を除去する。
- `displayText` は画面と巻物に表示する。
- `speechText` は音声向けに別途整形する。
- Markdown記号、URL、不要な年、読み上げに不向きな区切りを音声文から除去する。
- 箇条書きが残った場合は「一つ目は」のような耳で順番が分かる表現へ変換する。

## 地域情報スキル

GLMには次のFunction Callingスキルを提示します。ごみ情報はsystemプロンプトへ埋め込まず、必要な場合だけ会話へ追加します。

| スキル | 用途 |
| --- | --- |
| `get_local_waste_schedule` | 鶴瀬西3丁目の指定日・今日・明日の収集予定 |
| `search_local_waste_guide` | リポジトリ内の簡潔な地域資料を検索 |
| `search_official_fujimi_waste_info` | ローカル資料にない品目を富士見市公式分別辞典で検索 |

ツール実行は1回の質問につき最大2回です。ローカル資料で見つからなければ、次の巡回で公式資料を検索できます。ごみに関係ない質問では、モデルがツールを使わず回答します。

公式検索は任意URLを受け取りません。Worker内で許可した富士見市公式PDFだけを取得し、Workers AI Markdown Conversionで文字列化して該当箇所だけをモデルへ返します。

簡潔な収集曜日と主要な分別情報は [`worker/skills/fujimi-waste/reference.md`](worker/skills/fujimi-waste/reference.md) にあります。`reference.md` と、Workerへバンドルする [`reference.ts`](worker/skills/fujimi-waste/reference.ts) は同時に更新します。

## AI音声相談の処理フロー

1. 利用者が「話す」を押し、マイク録音を開始する。
2. もう一度押すか30秒経過すると録音を止める。
3. Whisperが音声を日本語テキストへ変換する。
4. 直近の会話履歴と入力テキストをGLMへ渡す。
5. GLMが必要なら地域情報スキルを選ぶ。
6. Workerがスキルを実行し、結果をGLMへ返す。
7. 回答を表示用と読み上げ用に整形する。
8. 回答を巻物へ追加し、自動読み上げを試みる。

## API

### `GET /api/health`

AI、LLM、外部TTSの有効状態と設定地域を返します。

### `POST /api/transcribe`

`multipart/form-data` の `audio` を日本語テキストへ変換します。

- Whisperモデル: `@cf/openai/whisper-large-v3-turbo`
- 最大音声サイズ: 12 MiB
- Worker側タイムアウト: 40秒
- `language: "ja"`
- `vad_filter: true`
- `condition_on_previous_text: false`

```json
{
  "text": "アイロンは何ごみですか"
}
```

### `POST /api/chat`

```json
{
  "message": "アイロンは何ごみですか",
  "inputSource": "voice",
  "history": [
    { "role": "user", "content": "明日の予定を整理して" },
    { "role": "assistant", "content": "まず、時間が決まっている予定を確認しましょう。" }
  ],
  "sessionId": "tab-session-id"
}
```

`message` は最大1,000文字です。Worker側のLLM処理タイムアウトは40秒、ブラウザ側の通信タイムアウトは45秒です。

```json
{
  "displayText": "アイロンは、不燃ごみです。",
  "speechText": "アイロンは、不燃ごみです。",
  "sourceUrl": "https://www.city.fujimi.saitama.jp/...",
  "toolsUsed": ["search_local_waste_guide"]
}
```

`sourceUrl` と `toolsUsed` はスキルを使った場合だけ返します。

### `POST /api/speech`

外部TTSが設定されている場合、最大300文字の `speechText` から音声を返します。未設定または失敗時は端末の日本語音声へフォールバックします。

### `GET /api/call/signal?client=<client-id>`

WebSocket Upgrade専用のP2P通話シグナリング接続です。

- ブラウザごとに一時的なclient IDを生成する。
- `ready`、`call`、`accept`、`offer`、`answer`、`ice`、`hangup`、`cancel` を中継する。
- 1メッセージは最大32 KiB。
- WebSocket Hibernation APIを使い、接続状態はWebSocket attachmentへ保持する。
- 会話内容や音声を保存しない。

## プライバシーとログ

### 保存しないもの

- 録音した音声データ
- P2P通話の音声
- P2P通話の録音・履歴
- サーバー上の会話履歴
- APIキーや秘密情報

### DEV診断ログ

DEV版で音声入力した場合だけ、次をCloudflare WorkerログへJSONで出力します。

- `event: "voice_interaction"`
- `sessionId`
- ターン番号と履歴長
- 音声認識後の `transcript`
- 回答の `responseText`
- `toolsUsed`

アプリは音声本体、IP、リクエストヘッダーを診断イベントへ明示的に含めません。通話シグナリングでは参加台数とエラーだけを診断し、音声はWorkerを通りません。

本番設定では `DIAGNOSTIC_LOGGING` を有効にしません。

## マイクと音声機能の排他

- AI録音中・AI送信中・マイク許可確認中はP2P通話を開始できない。
- P2P通話の待機・発信・着信・接続・通話中はAI録音と例題操作を無効にする。
- 通話操作時はAIの読み上げと通信ノイズを停止する。
- 外部TTSの応答が遅れて到着しても、通話開始後に再生しない。
- 通話終了時は全MediaStreamTrackを停止する。

## ディレクトリ

```text
src/App.tsx                            画面、AI録音、マイク許可、巻物UI
src/api.ts                            APIクライアントとブラウザ側タイムアウト
src/audio.ts                          音声アンロック、通信音、回答読み上げ
src/useP2PCall.ts                     WebRTC通話の状態管理とマイク排他
worker/index.ts                       APIルーティング、Whisper、TTS中継
worker/agent.ts                       GLM、口語整形、Function Callingループ
worker/call-room.ts                   Durable Objectシグナリング中継
worker/call-protocol.ts               シグナリング入力の検証
worker/skills/fujimi-waste/           富士見市の地域情報スキル
wrangler.dev.jsonc                    DEV Worker設定
wrangler.jsonc                        本番Worker設定
.github/workflows/ci.yml              CIとdev/mainのCloudflare配備
```

## ローカル確認

Node.js 22以上を使います。

```bash
npm ci
npm run dev
```

検査は次の順で実行します。

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

DEVへ手動配備する場合は次を実行します。

```bash
npm run deploy:cloudflare:dev
```

## Cloudflare bindingsと変数

| 名前 | 種類 | 用途 |
| --- | --- | --- |
| `AI` | Workers AI binding | Whisper、GLM、Markdown Conversion |
| `CALL_ROOM` | Durable Object binding | P2P通話シグナリング |
| `AI_ENABLED` | 変数 | 音声認識の有効化 |
| `LLM_ENABLED` | 変数 | AI会話の有効化 |
| `DEMO_AREA` | 変数 | 設定地域の表示 |
| `DIAGNOSTIC_LOGGING` | 変数 | DEV診断ログの有効化 |
| `TTS_BASE_URL` | Secretまたは変数 | 任意の外部TTS URL |
| `TTS_SHARED_SECRET` | Secret | 任意の外部TTS認証 |

## 現在の検証範囲

- TypeScript型検査
- ESLint
- AI回答・スキル・口語整形の単体テスト
- シグナリングプロトコルの単体テスト
- Vite本番ビルド
- 公開DEV上でのUI、受信待機、中止、排他表示、2クライアントのWebSocket接続確認

実マイクを使った2台間の双方向音声は、物理端末で最終確認する必要があります。

## 主要な決定事項

| 日付 | 決定 |
| --- | --- |
| 2026-08-23 | テーマを「段取りのアウトソーシング」とし、日常相談全般を扱う |
| 2026-08-23 | 会話モデルをGLM 4.7 Flashへ変更する |
| 2026-08-23 | 直近最大3往復の会話履歴をタブ内で保持する |
| 2026-08-23 | 絵文字・顔文字を除去し、回答を音声向けの口語文へ整形する |
| 2026-08-23 | 机と巻物のUIへ会話履歴を表示する |
| 2026-08-23 | マイク許可と自動再生の初回処理を分離する |
| 2026-08-23 | WebRTCの1対1 P2P音声通話を追加する |
| 2026-08-23 | 通話ボタンをトランシーバー本体へ置き、通信番号なしの待受方式にする |
| 2026-08-23 | P2P音声はSTUNのみとし、TURN、録音、履歴保存は追加しない |
