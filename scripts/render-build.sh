#!/usr/bin/env bash
# Render build: one web service serves the API and the built website.
# Uses the pnpm version the lockfile was made with (pnpm 12 rejects the workspace settings).
set -euo pipefail

pnpm() { npx --yes pnpm@10.34.7 "$@"; }

# Catch pasted values like "NAME=value", quotes or spaces before building a site
# whose sign-in silently fails. Values are never printed.
check_key() {
  local name="$1" pattern="$2" value="${!1:-}"
  if [ -z "$value" ]; then echo "ERROR: $name is not set." >&2; exit 1; fi
  if ! [[ "$value" =~ $pattern ]]; then
    echo "ERROR: $name has the wrong format. Paste only the key itself (no '$name=', quotes or spaces)." >&2
    exit 1
  fi
}
check_key VITE_CLERK_PUBLISHABLE_KEY '^pk_(test|live)_[A-Za-z0-9]+$'
check_key CLERK_PUBLISHABLE_KEY '^pk_(test|live)_[A-Za-z0-9]+$'
check_key CLERK_SECRET_KEY '^sk_(test|live)_[A-Za-z0-9]+$'
if [ "$VITE_CLERK_PUBLISHABLE_KEY" != "$CLERK_PUBLISHABLE_KEY" ]; then
  echo "ERROR: VITE_CLERK_PUBLISHABLE_KEY and CLERK_PUBLISHABLE_KEY must be the same key." >&2
  exit 1
fi
# Optional: Cloudinary media storage, checked only when set.
if [ -n "${CLERK_WEBHOOK_SIGNING_SECRET:-}" ]; then
  check_key CLERK_WEBHOOK_SIGNING_SECRET '^whsec_[A-Za-z0-9+/=]+$'
fi
# Media storage is optional, so a bad value only warns: uploads explain the problem at runtime.
if [ -n "${CLOUDINARY_URL:-}" ]; then
  if [[ "$CLOUDINARY_URL" == *"<"* || "$CLOUDINARY_URL" == *">"* || "$CLOUDINARY_URL" == *your_api* ]]; then
    echo "WARNING: CLOUDINARY_URL still contains the <your_api_key> / <your_api_secret> placeholders; uploads stay off until the real API key and secret (Cloudinary -> Settings -> API Keys) replace them." >&2
  elif ! [[ "$CLOUDINARY_URL" =~ ^cloudinary://[0-9]{6,}:[^@\<\>[:space:]]+@[A-Za-z0-9_-]+/?$ ]]; then
    echo "WARNING: CLOUDINARY_URL has the wrong format (expected cloudinary://API_KEY:API_SECRET@CLOUD_NAME); uploads stay off until it is fixed." >&2
  fi
fi

# Render sets NODE_ENV=production for the build too; build tools are devDependencies.
pnpm install --frozen-lockfile --prod=false

# Additive schema changes apply automatically. If drizzle-kit would drop or rename
# data it stops for confirmation and the build fails, so the live site keeps running.
if [ "${SKIP_DB_PUSH:-}" != "true" ]; then
  pnpm --filter @workspace/db run push
fi

pnpm --filter @workspace/api-server run build

# vite.config.ts requires PORT and BASE_PATH even for a production build.
PORT="${PORT:-10000}" BASE_PATH=/ pnpm --filter @workspace/new-world-emerald run build
