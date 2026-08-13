#!/usr/bin/env bash
# Run backend and/or frontend tests with coverage floors.
# Backend fails under 80% (pytest-cov). Frontend fails under Vitest thresholds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
Usage: scripts/check-coverage.sh [--all|--backend|--frontend|--auto]

  --all       Run both suites (default when not in a git commit)
  --backend   Backend pytest + --cov-fail-under=80
  --frontend  Frontend vitest coverage thresholds
  --auto      Staged backend/ → pytest; staged frontend/ → vitest
EOF
}

mode="${1:-auto}"
case "$mode" in
  -h|--help)
    usage
    exit 0
    ;;
  --all|all|--backend|--frontend|--auto|auto|"")
    ;;
  *)
    echo "Unknown option: $mode" >&2
    usage >&2
    exit 2
    ;;
esac

run_backend=false
run_frontend=false

select_suites() {
  case "$mode" in
    --all|all)
      run_backend=true
      run_frontend=true
      return
      ;;
    --backend)
      run_backend=true
      return
      ;;
    --frontend)
      run_frontend=true
      return
      ;;
  esac

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    run_backend=true
    run_frontend=true
    return
  fi

  local staged
  staged="$(git diff --cached --name-only --diff-filter=ACMR || true)"
  if [[ -z "$staged" ]]; then
    run_backend=true
    run_frontend=true
    return
  fi

  if echo "$staged" | grep -qE '^backend/'; then
    run_backend=true
  fi
  if echo "$staged" | grep -qE '^frontend/'; then
    run_frontend=true
  fi
}

select_suites

if ! $run_backend && ! $run_frontend; then
  echo "No backend/ or frontend/ files staged; skipping coverage checks."
  exit 0
fi

run_backend_tests() {
  echo "==> Backend tests + coverage (≥80%)"
  if ! command -v uv >/dev/null 2>&1; then
    echo "uv is required to run backend tests. Install: https://docs.astral.sh/uv/" >&2
    exit 1
  fi
  (
    cd "$ROOT/backend"
    PYTHONPATH=. uv run pytest \
      --cov=app \
      --cov-report=term-missing \
      --cov-fail-under=80 \
      -q
  )
}

run_frontend_tests() {
  echo "==> Frontend tests + coverage thresholds"
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to run frontend tests." >&2
    exit 1
  fi
  if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
    echo "frontend/node_modules is missing. Run: cd frontend && npm install" >&2
    exit 1
  fi
  (
    cd "$ROOT/frontend"
    npm run test:coverage
  )
}

if $run_backend; then
  run_backend_tests
fi
if $run_frontend; then
  run_frontend_tests
fi

echo "Coverage checks passed."
