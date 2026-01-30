# discordbot-icler

Discord Bot で X（Twitter）リンクからイベント情報を抽出し、Google カレンダーに自動追加します。

## 機能

- Discord チャンネルへの X リンク投稿を自動検知
- Gemini API でイベント情報（日時・場所・イベント名）を抽出
- Google Calendar に自動でイベントを作成
- 成功時は元メッセージに 📅 リアクションを付与

## アーキテクチャ

```
Discord Server
       │ WebSocket
       ▼
┌─────────────────────────────────────────────┐
│         Discord Bot                         │
│  ┌──────────────┐   ┌──────────────────┐   │
│  │ メッセージ監視 │──▶│ Xリンク検出      │   │
│  └──────────────┘   └────────┬─────────┘   │
│                              ▼             │
│  ┌──────────────────────────────────────┐  │
│  │ Discord embed からツイート内容取得    │  │
│  └────────────────────┬─────────────────┘  │
│                       ▼                    │
│  ┌──────────────────────────────────────┐  │
│  │ Gemini API でイベント情報抽出         │  │
│  └────────────────────┬─────────────────┘  │
│                       ▼                    │
│  ┌──────────────────────────────────────┐  │
│  │ Google Calendar API でイベント作成    │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| 言語 | TypeScript |
| ランタイム | Node.js 20+ |
| パッケージ管理 | pnpm |
| Discord | discord.js v14 |
| LLM | Google Gemini API |
| カレンダー | Google Calendar API |
| ビルド | tsup |

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、各値を設定してください。

### 3. Google Calendar OAuth2 認証（初回のみ）

```bash
pnpm run auth:google
```

### 4. 開発サーバーの起動

```bash
pnpm run dev
```

### 5. ビルド

```bash
pnpm run build
```

## コマンド一覧

```bash
pnpm install       # 依存関係インストール
pnpm run dev       # 開発サーバー起動
pnpm run build     # ビルド
pnpm run typecheck # 型チェック
pnpm run start     # 本番サーバー起動
```

## ライセンス

[MIT](LICENSE)
