# CLAUDE.md

> **⚠️ このリポジトリは Public にする予定です - 以下を厳守してください**
>
> - API キー、トークン、パスワード等の機密情報をコードやコミットに含めない
> - `.env` ファイルの内容を出力・表示しない
> - 機密情報は必ず環境変数経由で参照し、ハードコードしない

## プロジェクト概要

Discord Bot で #クラブイベント チャンネルに投稿された X リンクからイベント情報を抽出し、Google Calendar に自動追加する。

## コマンド

```bash
pnpm install       # 依存関係インストール
pnpm run dev       # 開発サーバー起動
pnpm run build     # ビルド
pnpm run typecheck # 型チェック
```

## 開発時の確認事項

- **一定作業ごとに `pnpm run typecheck` を実行し、型エラーがないことを確認する**
- ファイルを複数作成・編集した後は必ず型チェックを行う
- エラーがあれば次の作業に進む前に修正する

## コミット規約

- **意味のまとまりごとにコミットする**
- 1つの機能やモジュールが完成したらコミット
- 複数の無関係な変更を1つのコミットにまとめない

## コーディング規約

### 型安全性（厳守）

以下は **禁止** です：

```typescript
// ❌ as による型アサーション
const value = data as string;

// ❌ any 型の使用
function process(data: any) { ... }

// ❌ non-null assertion (!)
const name = user!.name;
```

代わりに **型ガード** と **型の絞り込み** を使用してください：

```typescript
// ✅ 型ガードで絞り込む
if (typeof data === 'string') {
  const value = data;
}

// ✅ 適切な型定義
function process(data: EventData) { ... }

// ✅ オプショナルチェーンとnullチェック
const name = user?.name ?? 'Unknown';
```

### エラーハンドリング

```typescript
// ✅ unknown でキャッチし、型ガードで絞り込む
try {
  await someOperation();
} catch (error: unknown) {
  if (error instanceof Error) {
    logger.error(error.message);
  }
}
```

### 環境変数

- `process.env` を直接参照しない
- `src/config/index.ts` 経由でアクセスする
- 必須環境変数は起動時にバリデーションする

