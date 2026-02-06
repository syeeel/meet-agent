# Meet Agent - AI Meeting Assistant

Recall.ai を使って Zoom / Google Meet / Microsoft Teams の会議に参加し、音声で質問に回答する AI アシスタント。

## 機能

- Zoom, Google Meet, Microsoft Teams, Webex の会議に自動参加
- 会議の発言をリアルタイムで認識（Google Cloud STT V2 / Chirp 2）
- Gemini 2.5 Flash Lite で質問に回答（ストリーミング応答）
- 音声合成で会議参加者に回答（Google Cloud TTS / Chirp3-HD）
- 文単位のストリーミング TTS パイプライン（低遅延応答）

## アーキテクチャ

```
┌─────────────────┐
│   会議          │
│ (Zoom/Meet等)   │
└────────┬────────┘
         │ 音声
         ▼
┌─────────────────┐
│  Recall.ai Bot  │  ← 会議に参加
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Bot Webpage    │  ← 音声キャプチャ & 再生
└────────┬────────┘
         │ WebSocket (/ws/audio)
         ▼
┌──────────────────────────┐
│     Express Server       │
├──────────────────────────┤
│ Google STT V2 (Chirp 2)  │  ← 音声認識
│ Gemini 2.5 Flash Lite    │  ← AI応答生成（ストリーミング）
│ Google TTS (Chirp3-HD)   │  ← 音声合成
└──────────────────────────┘
```

### ストリーミングパイプライン

```
音声入力 → STT → Gemini (ストリーミング) → 文検出 → TTS → 音声再生
                                             ↑
                               句読点(。！？)で文を区切り、
                               文単位で即座にTTS生成・送信
```

Gemini のストリーミング応答中に句読点（。！？）を検出すると、その文を即座に TTS に送信。
音声再生はテキスト生成完了を待たずに開始されるため、応答遅延を最小化しています。

## 必要なもの

- Node.js v18+
- ngrok（ローカル開発用）
- 以下の API キー / 認証情報:
  - **Recall.ai** - 会議ボット
  - **Google Cloud** - STT（サービスアカウント）+ TTS（API キー）
  - **Gemini** - AI 応答生成

## クイックスタート

### 1. 依存パッケージをインストール

```bash
npm install
```

### 2. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を編集:

```env
# Recall.ai
RECALL_API_KEY=your_recall_api_key
RECALL_API_REGION=asia

# Google Cloud - TTS 用 API キー
GOOGLE_CLOUD_API_KEY=your_google_cloud_api_key

# Google Cloud - STT 用サービスアカウント
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_PROJECT_ID=your_project_id

# Gemini
GEMINI_API_KEY=your_gemini_api_key

# Server
BASE_URL=https://your-ngrok-url.ngrok-free.app
PORT=3000
```

### 3. API キーの取得方法

#### Recall.ai
1. https://recall.ai でアカウント作成
2. ダッシュボードから API キーをコピー

#### Google Cloud STT（Chirp 2）
1. https://console.cloud.google.com/ にアクセス
2. 「API とサービス」→「ライブラリ」→「Cloud Speech-to-Text API」を有効化
3. 「IAM と管理」→「サービスアカウント」→ サービスアカウントを作成
4. キーを作成（JSON 形式）→ `service-account.json` としてプロジェクトルートに配置
5. `.env` の `GOOGLE_CLOUD_PROJECT_ID` に GCP プロジェクト ID を設定

#### Google Cloud TTS（Chirp3-HD）
1. https://console.cloud.google.com/ にアクセス
2. 「API とサービス」→「ライブラリ」→「Cloud Text-to-Speech API」を有効化
3. 「API とサービス」→「認証情報」→「認証情報を作成」→「API キー」
4. 無料枠: 100万文字/月

#### Gemini
1. https://aistudio.google.com/apikey で API キーを作成

### 4. ngrok を起動

```bash
ngrok http 3000
```

表示された URL（例: `https://xxxx.ngrok-free.app`）を `.env` の `BASE_URL` に設定。

### 5. サーバーを起動

```bash
npm run dev
```

### 6. ボットを会議に参加させる

```bash
curl -X POST http://localhost:3000/api/bot/create \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-xxxx-xxx"}'
```

### 7. 会議で話しかける

会議で普通に話すと、AI が音声で回答します。

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/bot/create` | ボットを作成して会議に参加 |
| GET | `/api/bot/:id` | ボットの状態を取得 |
| GET | `/api/bot` | 全ボットの一覧 |
| POST | `/api/bot/:id/leave` | ボットを会議から退出 |
| POST | `/api/bot/:id/chat` | ボット経由でチャットメッセージを送信 |
| GET | `/api/health` | ヘルスチェック |

## 対応プラットフォーム

| プラットフォーム | 対応 |
|----------------|-----|
| Zoom | ✅ |
| Google Meet | ✅ |
| Microsoft Teams | ✅ |
| Cisco Webex | ✅ |
| Slack Huddles | ❌ |

## ファイル構成

```
meet-agent/
├── src/
│   ├── index.ts           # メインサーバー（WebSocket + STT + Gemini + TTS）
│   ├── server.ts          # Express API
│   ├── services/
│   │   ├── recall.ts      # Recall.ai クライアント
│   │   └── gemini.ts      # Gemini クライアント
│   └── types/
│       └── index.ts       # 型定義
├── public/
│   └── bot-page/          # ボット用Webページ
│       ├── index.html
│       ├── main.js        # 音声キャプチャ & 再生
│       └── styles.css
├── .env.example
└── package.json
```

## トラブルシューティング

### ボットが会議に参加しない
- ngrok が起動しているか確認
- `BASE_URL` が正しい ngrok URL か確認
- Recall.ai のダッシュボードでボットの状態を確認

### 音声が認識されない
- サービスアカウントの JSON ファイルが正しいパスに配置されているか確認
- `GOOGLE_CLOUD_PROJECT_ID` が正しいか確認
- Cloud Speech-to-Text API が有効になっているか確認
- サーバーログで `User said:` が表示されているか確認

### 音声が出力されない
- Google Cloud TTS の API キーが正しいか確認
- Cloud Text-to-Speech API が有効になっているか確認
- サーバーログで `Sentence 1:` が表示されているか確認

### ngrok の URL が変わった
ngrok 無料版は再起動のたびに URL が変わります。
毎回 `.env` の `BASE_URL` を更新してサーバーを再起動してください。

## 開発

```bash
# 開発モード
npm run dev

# ビルド
npm run build

# 本番モード
npm start
```

## ライセンス

MIT
