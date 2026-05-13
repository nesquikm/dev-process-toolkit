#!/usr/bin/env bash
# Shared helper for Process-category enforcement hooks (STE-285).
#
# Reads the current Claude Code session log (JSONL stream at
# $CLAUDE_SESSION_FILE) and looks for a `Skill` tool_use entry naming a
# specific skill. Fail-open when $CLAUDE_SESSION_FILE is unset (hook invoked
# outside a Claude Code session, e.g. a bare `git commit`).
#
# Public API:
#   require_skill_tool_use <skill-name> <hook-name>
#     - exits 0 on hit (skill tool_use found in session log).
#     - exits 0 if $CLAUDE_SESSION_FILE is unset (fail-open).
#     - exits 1 with NFR-10-shape stderr on miss.
#
#   has_skill_tool_use <skill-name>
#     - returns 0 on hit, 1 on miss. Does not emit anything. Fail-open
#       (returns 0) when $CLAUDE_SESSION_FILE is unset.

# Return 0 if a Skill tool_use for $1 exists in $CLAUDE_SESSION_FILE.
# Fail-open (return 0) if $CLAUDE_SESSION_FILE is unset or missing.
has_skill_tool_use() {
  local skill="$1"
  if [ -z "${CLAUDE_SESSION_FILE:-}" ]; then
    return 0
  fi
  if [ ! -f "$CLAUDE_SESSION_FILE" ]; then
    return 0
  fi
  # JSONL: each line is a JSON object. Match a tool_use entry where both
  # name=="Skill" AND input.skill=="<skill>" appear on the SAME line — two
  # separate greps would false-positive on unrelated Skill tool_uses for a
  # different skill plus an unrelated mention of <skill> on another line.
  # `-F` is fixed-string (no regex), neutralising any metacharacter content
  # an attacker-influenced skill name might carry.
  local needle_name='"name":"Skill"'
  local needle_skill="\"skill\":\"${skill}\""
  if grep -F "$needle_name" "$CLAUDE_SESSION_FILE" 2>/dev/null \
       | grep -qF "$needle_skill"; then
    return 0
  fi
  return 1
}

# Emit a 3-line NFR-10-shape block to stderr.
#   $1 = verdict prefix word (e.g. "Refusing", "Reminder")
#   $2 = WHY  — one-line reason
#   $3 = HOW  — one-line remediation
#   $4 = skill name (for the Context tail)
#   $5 = hook name  (for the Context tail)
emit_nfr10_block() {
  local verdict="$1"
  local why="$2"
  local how="$3"
  local skill="$4"
  local hook="$5"
  {
    echo "${verdict}: ${why}"
    echo "Remedy: ${how}"
    echo "Context: mode=hook, ticket=unbound, skill=${skill}, hook=${hook}"
  } >&2
}

# Emit NFR-10-shape refusal to stderr (does not exit).
#   $1 = skill name (e.g. dev-process-toolkit:gate-check)
#   $2 = hook name (e.g. pre-commit-gate-check)
emit_nfr10_refusal() {
  local skill="$1"
  local hook="$2"
  emit_nfr10_block \
    "Refusing" \
    "required ${skill} Skill tool_use not found in current session." \
    "run /${skill} before retrying this action." \
    "${skill}" \
    "${hook}"
}

# require_skill_tool_use <skill> <hook>
#   - Fail-open on unset $CLAUDE_SESSION_FILE.
#   - Hit ⇒ exit 0.
#   - Miss ⇒ emit NFR-10 stderr + exit 1.
require_skill_tool_use() {
  local skill="$1"
  local hook="$2"
  if [ -z "${CLAUDE_SESSION_FILE:-}" ]; then
    exit 0
  fi
  if has_skill_tool_use "$skill"; then
    exit 0
  fi
  emit_nfr10_refusal "$skill" "$hook"
  exit 1
}
