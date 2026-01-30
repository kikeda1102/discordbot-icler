# CLAUDE.md

AI 開発アシスタント向けのプロジェクト情報です。

## プロジェクト概要

Discord Bot で X リンクからイベント情報を抽出し、Google Calendar に自動追加する。

## コマンド

```bash
pnpm install       # 依存関係インストール
pnpm run dev       # 開発サーバー起動
pnpm run build     # ビルド
pnpm run typecheck # 型チェック
```

## 開発時の確認事項

- 一定作業ごとに `pnpm run typecheck` を実行し、型エラーがないことを確認する
- ファイルを複数作成・編集した後は必ず型チェックを行う
- エラーがあれば次の作業に進む前に修正する

## コミット規約

- 意味のまとまりごとにコミットする
- 1つの機能やモジュールが完成したらコミット
- 複数の無関係な変更を1つのコミットにまとめない

## コーディング規約

### 変数宣言

- `let` の使用は原則禁止、常に `const` を使用する
- 条件分岐で値が変わる場合は、三項演算子や即時関数で `const` を使う

### 型安全性

以下は禁止：

- `as` による型アサーション
- `any` 型の使用
- `!`（non-null assertion）

代わりに型ガードと型の絞り込みを使用する。

### エラーハンドリング

```typescript
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

### セキュリティ

- API キー、トークン、パスワード等の機密情報をコードやコミットに含めない
- 機密情報は必ず環境変数経由で参照し、ハードコードしない
