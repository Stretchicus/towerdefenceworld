#!/usr/bin/env bash
# Deploy Tower Defence World on the Linux host.
# Usage (from repo root):
#   sudo ./deploy.sh
# Or as a user that can restart the service:
#   ./deploy.sh
#
# Optional: copy client build to a separate Apache DocumentRoot:
#   DEPLOY_WEB_ROOT=/var/www/html ./deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> Repo: $ROOT"
echo "==> git pull"
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline

echo "==> npm install"
npm install

echo "==> build game-core"
npm run build -w @tdw/game-core

echo "==> build server"
npm run build -w @tdw/server

echo "==> build client"
npm run build -w @tdw/client

if [[ -n "${DEPLOY_WEB_ROOT:-}" ]]; then
  echo "==> rsync client -> $DEPLOY_WEB_ROOT"
  mkdir -p "$DEPLOY_WEB_ROOT"
  rsync -a --delete "$ROOT/packages/client/dist/" "$DEPLOY_WEB_ROOT/"
else
  echo "==> Skipping web copy (set DocumentRoot to packages/client/dist, or DEPLOY_WEB_ROOT=/path)"
fi

echo "==> restart tdw"
if command -v systemctl >/dev/null 2>&1; then
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart tdw
    systemctl --no-pager --full status tdw || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl restart tdw
    sudo systemctl --no-pager --full status tdw || true
  else
    echo "WARN: cannot restart tdw (need root or sudo)"
  fi
else
  echo "WARN: systemctl not found — restart the Node process yourself"
fi

echo "==> health check"
if curl -fsS "http://127.0.0.1:${PORT:-3101}/health"; then
  echo
else
  echo "WARN: health check failed on port ${PORT:-3101}"
fi

echo "==> Done. Hard-refresh the browser; header should show the latest build tag (e.g. v0.1.3)."
