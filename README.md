# Makoto.Ise - AI Meeting Agent

Recall.ai + HeyGen Interactive Avatar を使って Zoom / Google Meet / Microsoft Teams の会議に参加する AI エージェント。
「伊勢 誠（いせ まこと）」というペルソナを持ち、音声でリアルタイムに会話します。

## 機能

- Zoom, Google Meet, Microsoft Teams, Webex の会議に自動参加
- HeyGen Interactive Avatar によるリアルタイム音声会話（STT / LLM / TTS 一体型）
- リップシンク付きアバター映像を会議カメラとして表示
- フォールバック: HeyGen なしでも動作（Google STT + Gemini + Google TTS + SVG アバター）

## アーキテクチャ

### HeyGen モード（推奨）

```
┌─────────────────┐
│   会議          │
│ (Zoom/Meet等)   │
└────────┬────────┘
         │ 音声
         ▼
┌─────────────────┐
│  Recall.ai Bot  │  ← 会議に参加、Bot Webpage をカメラとして表示
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  Bot Webpage (HeyGen SDK)                │
│                                          │
│  マイク音声 → LiveKit publish            │
│         ↓                                │
│  HeyGen (Deepgram STT → GPT-4o mini     │
│          → TTS + アバター lip-sync)      │
│         ↓                                │
│  LiveKit subscribe → 映像 & 音声再生     │
└──────────────────────────────────────────┘
         ↑
         │ アクセストークンのみ
┌──────────────────────────┐
│     Express Server       │  ← セッション管理 (REST API)
└──────────────────────────┘
```

サーバーはアクセストークンの生成とボットのライフサイクル管理のみ担当。
音声パイプラインはサーバーを経由せず、HeyGen SDK が全て処理します。

### フォールバックモード（HeyGen なし）

```
Bot Webpage → WebSocket → Server → Google STT → Gemini → Google TTS → 音声再生
```

## 必要なもの

- Node.js v18+
- ngrok（ローカル開発用）
- 以下の API キー / 認証情報:

| サービス | 用途 | HeyGen モード | フォールバック |
|---------|------|:---:|:---:|
| **Recall.ai** | 会議ボット | 必須 | 必須 |
| **HeyGen** | アバター + 音声会話 | 必須 | - |
| **Google Cloud STT** | 音声認識 | - | 必須 |
| **Google Cloud TTS** | 音声合成 | - | 必須 |
| **Gemini** | AI 応答生成 | - | 必須 |

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

# HeyGen (設定するとHeyGen Interactive Avatarモードが有効)
HEYGEN_API_KEY=your_heygen_api_key
# HEYGEN_AVATAR_NAME=Wayne_20240711   # オプション: アバター指定
# HEYGEN_VOICE_ID=                     # オプション: 音声指定

# Google Cloud - フォールバック用 (HeyGen未使用時に必要)
GOOGLE_CLOUD_API_KEY=your_google_cloud_api_key
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GOOGLE_CLOUD_PROJECT_ID=your_project_id
GEMINI_API_KEY=your_gemini_api_key

# Server
BASE_URL=https://your-ngrok-url.ngrok-free.app
PORT=3000
```

### 3. ビルド

```bash
npm run build
```

TypeScript のコンパイルと HeyGen SDK のブラウザバンドルを行います。

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

会議で話すと、伊勢 誠が音声で回答します。

## ペルソナ: 伊勢 誠（いせ まこと）

- **45歳男性**、千葉県船橋市在住
- **家族**: 妻（42歳・看護師）、長女（高校1年）、長男（中学1年）の4人家族
- **職業**: IT企業20年の経験を持つビジネスコンサルタント。DX推進・業務改善が専門
- **経歴**: 早稲田大学商学部卒 → 大手SIer → 独立
- **趣味**: ロードバイク（房総半島）、自家焙煎コーヒー、読書（司馬遼太郎ファン）、長男とPython学習
- **話し方**: 落ち着いた丁寧語、例え話が得意、自然な相槌

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

## ファイル構成

```
meet-agent/
├── src/
│   ├── index.ts           # メインサーバー（WebSocket + フォールバックパイプライン）
│   ├── server.ts          # Express API、ボットライフサイクル管理
│   ├── services/
│   │   ├── heygen.ts      # HeyGen API クライアント
│   │   ├── recall.ts      # Recall.ai クライアント
│   │   └── gemini.ts      # Gemini クライアント（フォールバック用）
│   └── types/
│       └── index.ts       # 型定義
├── public/
│   └── bot-page/          # ボット用Webページ（Recall.aiのカメラとして表示）
│       ├── index.html
│       ├── main.js              # HeyGen SDK 統合 & フォールバック音声処理
│       ├── heygen-sdk-entry.js  # SDK バンドル用エントリーポイント
│       ├── heygen-sdk.bundle.js # ビルド生成物（esbuild）
│       └── styles.css
├── .env.example
└── package.json
```

## トラブルシューティング

### ボットが会議に参加しない
- ngrok が起動しているか確認
- `BASE_URL` が正しい ngrok URL か確認
- Recall.ai のダッシュボードでボットの状態を確認

### HeyGen アバターが表示されない
- `HEYGEN_API_KEY` が正しいか確認
- サーバーログで `[HeyGen] Access token generated` が表示されているか確認
- HeyGen のアカウントに十分なクレジットがあるか確認

### 音声が認識されない（フォールバックモード）
- サービスアカウントの JSON ファイルが正しいパスに配置されているか確認
- `GOOGLE_CLOUD_PROJECT_ID` が正しいか確認
- Cloud Speech-to-Text API が有効になっているか確認

### ngrok の URL が変わった
ngrok 無料版は再起動のたびに URL が変わります。
毎回 `.env` の `BASE_URL` を更新してサーバーを再起動してください。

## 開発

```bash
# 開発モード
npm run dev

# ビルド（TypeScript + HeyGen SDK バンドル）
npm run build

# 本番モード
npm start
```

## ライセンス

MIT
