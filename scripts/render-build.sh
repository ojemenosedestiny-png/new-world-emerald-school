#!/usr/bin/env bash
# Render build: one web service serves the API and the built website.
# Uses the pnpm version the lockfile was made with (pnpm 12 rejects the workspace settings).
set -euo pipefail

pnpm() { npx --yes pnpm@10.34.7 "$@"; }

# Render sets NODE_ENV=production for the build too; build tools are devDependencies.
pnpm install --frozen-lockfile --prod=false

# Additive schema changes apply automatically. If drizzle-kit would drop or rename
# data it stops for confirmation and the build fails, so the live site keeps running.
if [ "${SKIP_DB_PUSH:-}" != "true" ]; then
  pnpm --filter @workspace/db run push
fi

pnpm --filter @workspace/api-server run build

# vite.config.ts requires PORT and BASE_PATH even for a production build.
: "${VITE_CLERK_PUBLISHABLE_KEY:?Set VITE_CLERK_PUBLISHABLE_KEY (your Clerk publishable key) before building}"
PORT="${PORT:-10000}" BASE_PATH=/ pnpm --filter @workspace/new-world-emerald run build
