#!/usr/bin/env bash
# Thin wrapper around capture-regression.ts so scripts callers don't have to
# know about Bun. The real capture logic lives in capture-regression.ts for
# portability across macOS / Linux / Windows (no reliance on `shasum`, `find`
# locale quirks, or BSD-vs-GNU `wc` byte counting).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "capture-regression: bun not found on PATH (see docs/tracker-adapters.md § Bun runtime)" >&2
  exit 2
fi

exec bun run "$SCRIPT_DIR/capture-regression.ts"
