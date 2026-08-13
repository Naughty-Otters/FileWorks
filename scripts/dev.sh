#!/usr/bin/env bash
# Native API + UI via the FileWorks TUI.
set -euo pipefail
exec "$(cd "$(dirname "$0")" && pwd)/fw" dev "$@"
