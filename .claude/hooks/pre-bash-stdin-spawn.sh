#!/usr/bin/env bash
exec bun run "${CLAUDE_PROJECT_DIR}/.claude/hooks/pre-bash-stdin-spawn.ts"
