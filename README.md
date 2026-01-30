# ICLER - Discord Event Calendar Bot

Discord の #クラブイベント チャンネルに投稿された X（Twitter）リンクから、イベント情報を抽出して Google カレンダーに自動追加する Bot

## アーキテクチャ

```
Discord Server (#クラブイベント)
         │ WebSocket
         ▼
┌─────────────────────────────────────────────┐
│         Discord Bot (Railway)                │
│  ┌──────────────┐   ┌──────────────────┐    │
│  │ メッセージ監視 │──▶│ Xリンク検出      │    │
│  └──────────────┘   └────────┬─────────┘    │
│                              ▼              │
│  ┌──────────────────────────────────────┐   │
│  │ FixTweet API でツイート内容取得       │   │
│  └────────────────────┬─────────────────┘   │
│                       ▼                     │
│  ┌──────────────────────────────────────┐   │
│  │ Claude API でイベント情報抽出         │   │
│  │ (日時・場所・イベント名)              │   │
│  └────────────────────┬─────────────────┘   │
│                       ▼                     │
│  ┌──────────────────────────────────────┐   │
│  │ Google Calendar API でイベント作成    │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## 技術スタック

| カテゴリ | 技術 | 理由 |
|---------|------|------|
| 言語 | TypeScript | 型安全性、保守性 |
| ランタイム | Node.js 20+ | discord.js の要件 |
| Discord | discord.js v14 | 成熟したライブラリ、WebSocket 対応 |
| Twitter | FixTweet API | 無料、公式 API 不要 |
| LLM | Claude API (Haiku) | 低コスト（月100件で約$0.03）、日本語に優れる |
| Google | googleapis | 公式ライブラリ、OAuth2 対応 |
| デプロイ | Railway | 無料枠$5/月、WebSocket対応、常時稼働 |
| ビルド | tsup | シンプルで高速 |

## ファイル構成

```
discordbot-icler/
├── src/
│   ├── index.ts                 # エントリーポイント
│   ├── bot.ts                   # Discord Bot 初期化
│   ├── config/
│   │   └── index.ts             # 環境変数・設定
│   ├── handlers/
│   │   ├── messageHandler.ts    # メッセージ受信
│   │   └── commandHandler.ts    # スラッシュコマンド
│   ├── services/
│   │   ├── twitterService.ts    # FixTweet でツイート取得
│   │   ├── eventExtractor.ts    # Claude でイベント抽出
│   │   └── calendarService.ts   # Google Calendar 連携
│   ├── utils/
│   │   ├── urlParser.ts         # URL 解析
│   │   └── logger.ts            # ロギング
│   └── types/
│       └── index.ts             # 型定義
├── .env.example
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── railway.toml
```

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、各値を設定:

```env
# Discord
DISCORD_BOT_TOKEN=           # Discord Developer Portal で取得
DISCORD_TARGET_CHANNEL_ID=   # #クラブイベント チャンネルの ID
DISCORD_GUILD_ID=            # サーバー ID

# Claude API
ANTHROPIC_API_KEY=           # Anthropic Console で取得

# Google Calendar
GOOGLE_CLIENT_ID=            # Google Cloud Console で取得
GOOGLE_CLIENT_SECRET=        # Google Cloud Console で取得
GOOGLE_REDIRECT_URI=         # OAuth2 リダイレクト URI
GOOGLE_REFRESH_TOKEN=        # 初回認証後に取得
```

### 3. Google Calendar OAuth2 認証（初回のみ）

```bash
pnpm run auth:google
```

ブラウザで認証を完了すると、Refresh Token が表示されます。これを `GOOGLE_REFRESH_TOKEN` に設定してください。

### 4. 開発サーバーの起動

```bash
pnpm run dev
```

### 5. ビルド

```bash
pnpm run build
```

## デプロイ（Railway）

1. [Railway](https://railway.app/) でプロジェクトを作成
2. GitHub リポジトリを連携
3. 環境変数を設定
4. 自動デプロイが開始

## 使い方

1. Discord サーバーに Bot を招待
2. #クラブイベント チャンネルに X のイベント情報リンクを投稿
3. Bot が自動でイベント情報を抽出し、Google カレンダーに追加
4. Discord に確認メッセージが返信される

## 注意事項

- FixTweet は非公式サービスのため、将来的に使えなくなる可能性があります
- Google Calendar の OAuth2 は初回のみ手動で認証が必要です
- Claude API のコストは非常に低いですが、API キー管理は慎重に行ってください

## ライセンス

MIT
