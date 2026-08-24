#!/usr/bin/env bash
# Post-deploy integration runner.
#
# Usage:
#   ./scripts/run.sh staging              # full suite (UI + API)
#   ./scripts/run.sh staging smoke        # @smoke only
#   ./scripts/run.sh staging api          # API project only
#   ./scripts/run.sh staging ui           # UI project only
#   ./scripts/run.sh local convert        # @convert (needs FW_API_KEY)
#   FW_API_KEY=fw_live_… ./scripts/run.sh staging

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_NAME="${1:-staging}"
MODE="${2:-all}"

case "$ENV_NAME" in
  local|dev|staging|prod) ;;
  *)
    echo "Usage: $0 <local|dev|staging|prod> [all|smoke|api|ui|convert]" >&2
    exit 2
    ;;
esac

export FW_ENV="$ENV_NAME"

if [[ ! -d node_modules/@playwright/test ]]; then
  echo "Installing integration deps…"
  npm install
  npx playwright install chromium
fi

ARGS=()
case "$MODE" in
  all) ;;
  smoke) ARGS+=(--grep @smoke) ;;
  api) ARGS+=(--project=api) ;;
  ui) ARGS+=(--project=ui) ;;
  convert) ARGS+=(--grep @convert) ;;
  *)
    echo "Unknown mode: $MODE (all|smoke|api|ui|convert)" >&2
    exit 2
    ;;
esac

echo "→ FileWorks integration  env=$FW_ENV  mode=$MODE"
case "$FW_ENV" in
  local) echo "  base=http://localhost:3000  api=http://localhost:8000" ;;
  dev) echo "  base=https://fileworks-dev.pages.dev  api=${FW_API_URL:-"(set FW_API_URL)"}" ;;
  staging) echo "  base=https://staging.fileworks.ai  api=https://api.staging.fileworks.ai" ;;
  prod) echo "  base=https://fileworks.ai  api=https://api.fileworks.ai" ;;
esac

npx playwright test "${ARGS[@]}"
