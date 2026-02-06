# Meet Agent - AI Meeting Assistant

Recall.ai を使って Zoom / Google Meet / Microsoft Teams の会議に参加し、音声で質問に回答する AI アシスタント。

## 機能

- Zoom, Google Meet, Microsoft Teams, Webex の会議に自動参加
- 会議の発言をリアルタイムで認識（AssemblyAI）
- GPT-4 で質問に回答
- 音声合成で会議参加者に回答（Google Cloud TTS）

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
         │ WebSocket
         ▼
┌─────────────────┐
│ Express Server  │
├─────────────────┤
│ AssemblyAI      │  ← 音声認識
│ GPT-4           │  ← AI応答生成
│ Google TTS      │  ← 音声合成
└─────────────────┘
```

## 必要なもの

- Node.js v18+
- ngrok（ローカル開発用）
- 以下の API キー:
  - **Recall.ai** - 会議ボット
  - **OpenAI** - GPT-4
  - **AssemblyAI** - 音声認識
  - **Google Cloud** - 音声合成

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

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# AssemblyAI
ASSEMBLYAI_API_KEY=your_assemblyai_api_key

# Google Cloud
GOOGLE_CLOUD_API_KEY=your_google_cloud_api_key

# Server
BASE_URL=https://your-ngrok-url.ngrok-free.app
PORT=3000
```

### 3. API キーの取得方法

#### Recall.ai
1. https://recall.ai でアカウント作成
2. ダッシュボードから API キーをコピー

#### OpenAI
1. https://platform.openai.com/api-keys でキーを作成

#### AssemblyAI
1. https://www.assemblyai.com でアカウント作成
2. ダッシュボードから API キーをコピー
3. 無料枠: $200 分

#### Google Cloud TTS
1. https://console.cloud.google.com/ にアクセス
2. 「API とサービス」→「ライブラリ」→「Cloud Text-to-Speech API」を有効化
3. 「API とサービス」→「認証情報」→「認証情報を作成」→「API キー」
4. 無料枠: 100万文字/月

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
│   ├── index.ts           # メインサーバー（WebSocket + TTS）
│   ├── server.ts          # Express API
│   ├── services/
│   │   ├── recall.ts      # Recall.ai クライアント
│   │   └── openai.ts      # OpenAI クライアント
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
- AssemblyAI の API キーが正しいか確認
- サーバーログで `User said:` が表示されているか確認

### 音声が出力されない
- Google Cloud TTS の API キーが正しいか確認
- Text-to-Speech API が有効になっているか確認
- サーバーログで `TTS audio generated:` が表示されているか確認

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
