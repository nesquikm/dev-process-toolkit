#!/usr/bin/env bash
# STE-285 AC-STE-285.2 — UserPromptSubmit hook on /dev-process-toolkit:spec-write.
#
# If no Skill(/dev-process-toolkit:brainstorm) tool_use is in the current
# session AND the user prompt has no resolved tracker ID arg (greenfield
# heuristic), inject a stderr reminder to consider /brainstorm first.
#
# This is an advisory hook (UserPromptSubmit). It never refuses the prompt;
# it only writes a reminder to stderr when triggered.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib/session.sh
. "${SCRIPT_DIR}/../_lib/session.sh"

# Fail-open when there's no session context — we can't tell if brainstorm
# already ran.
if [ -z "${CLAUDE_SESSION_FILE:-}" ]; then
  exit 0
fi

# Brainstorm already fired in this session ⇒ no reminder needed.
if has_skill_tool_use "dev-process-toolkit:brainstorm"; then
  exit 0
fi

# Inspect the user prompt: env var first, fall back to stdin.
USER_PROMPT="${CLAUDE_USER_PROMPT:-}"
if [ -z "$USER_PROMPT" ] && [ ! -t 0 ]; then
  USER_PROMPT="$(cat || true)"
fi

# Only trigger on /dev-process-toolkit:spec-write invocations.
case "$USER_PROMPT" in
  */dev-process-toolkit:spec-write*|/dev-process-toolkit:spec-write*)
    : # matched, fall through
    ;;
  *)
    exit 0
    ;;
esac

# Tracker-ID heuristic: PROJECT-123 style token ⇒ not greenfield, skip.
# Match against the portion after the skill name.
if echo "$USER_PROMPT" | grep -Eq '[A-Z][A-Z0-9]+-[0-9]+'; then
  exit 0
fi

# Greenfield invocation: emit advisory reminder (NFR-10 shape with
# Reminder: verdict, advisory only — does not block).
emit_nfr10_block \
  "Reminder" \
  "consider running /dev-process-toolkit:brainstorm before /spec-write for greenfield FRs." \
  "run /dev-process-toolkit:brainstorm to explore approach + tradeoffs, then re-invoke /spec-write." \
  "dev-process-toolkit:spec-write" \
  "pre-spec-write-brainstorm-reminder"

# Advisory only — do not block.
exit 0
