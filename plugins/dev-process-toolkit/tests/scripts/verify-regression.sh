#!/usr/bin/env bash
# Thin wrapper around verify-regression.ts (see capture-regression.sh).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "verify-regression: bun not found on PATH (see docs/tracker-adapters.md § Bun runtime)" >&2
  exit 2
fi

exec bun run "$SCRIPT_DIR/verify-regression.ts"
