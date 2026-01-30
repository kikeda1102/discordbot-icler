FROM node:20-slim

# pnpm インストール
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 依存関係インストール
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# ソースコードコピー
COPY . .

# ビルド
RUN pnpm run build

# 本番用依存関係のみ残す
RUN pnpm prune --prod

# 起動
CMD ["node", "dist/index.js"]
