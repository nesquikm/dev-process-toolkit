#!/usr/bin/env bash
exec bun run "${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/pre-commit-gate-check.ts"
