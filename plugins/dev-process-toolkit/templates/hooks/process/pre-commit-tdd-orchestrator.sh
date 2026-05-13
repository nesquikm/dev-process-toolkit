#!/usr/bin/env bash
# STE-285 AC-STE-285.2 — PreToolUse Bash:`git commit*` hook.
#
# If FR-related files are staged (specs/frs/<id>.md or test files), require
# a Skill(/dev-process-toolkit:tdd) tool_use in the current session.
# Refuse with NFR-10-shape stderr on miss. Byte-checkable continuation of
# STE-283's TDD Orchestrator Contract.
#
# Fail-open when $CLAUDE_SESSION_FILE is unset.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../_lib/session.sh
. "${SCRIPT_DIR}/../_lib/session.sh"

# Fail-open: no Claude session ⇒ don't block the commit.
if [ -z "${CLAUDE_SESSION_FILE:-}" ]; then
  exit 0
fi

# Resolve staged-files list. Prefer the explicit env var (test hook + future
# orchestrator integration). Fall back to `git diff --cached --name-only`
# inside a real repo.
STAGED_FILES="${CLAUDE_STAGED_FILES:-}"
if [ -z "$STAGED_FILES" ]; then
  if command -v git >/dev/null 2>&1; then
    # `|| true` is intentional fail-open: an unborn HEAD or detached repo
    # state makes `git diff --cached` exit non-zero — we'd rather skip
    # enforcement than refuse a legitimate commit on a fresh repo. The
    # false-negative trade-off is documented in specs/frs/STE-285.md § Risks.
    STAGED_FILES="$(git diff --cached --name-only 2>/dev/null || true)"
  fi
fi

# Heuristic for "FR-related staged":
#   - specs/frs/<id>.md (FR spec file itself)
#   - any test file (path contains /__tests__/ OR ends in .test.ts/.spec.ts/.test.tsx)
fr_related=0
while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    specs/frs/*.md)
      fr_related=1
      break
      ;;
    *__tests__*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*.test.js|*.spec.js)
      fr_related=1
      break
      ;;
  esac
done <<< "$STAGED_FILES"

if [ "$fr_related" -eq 0 ]; then
  # No FR-related files staged ⇒ commit is docs/config-only, skip enforcement.
  exit 0
fi

if has_skill_tool_use "dev-process-toolkit:tdd"; then
  exit 0
fi

emit_nfr10_refusal "dev-process-toolkit:tdd" "pre-commit-tdd-orchestrator"
exit 1
