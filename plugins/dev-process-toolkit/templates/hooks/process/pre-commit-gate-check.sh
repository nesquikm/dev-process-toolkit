#!/usr/bin/env bash
# STE-285 AC-STE-285.2 — PreToolUse Bash:`git commit*` hook.
#
# Require a Skill(/dev-process-toolkit:gate-check) tool_use in the current
# Claude Code session log. Refuse with NFR-10-shape stderr on miss.
# Fail-open when $CLAUDE_SESSION_FILE is unset (non-Claude commits).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib/session.sh
. "${SCRIPT_DIR}/../_lib/session.sh"

require_skill_tool_use "dev-process-toolkit:gate-check" "pre-commit-gate-check"
