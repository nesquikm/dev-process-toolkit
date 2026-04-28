#!/bin/sh
# Conventional Commits v1.0.0 commit-msg hook (POSIX shell).
# Installed by /dev-process-toolkit:setup. See AC-STE-133.1.
#
# Validates the subject line of the commit message file passed as $1:
#   - matches ^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+
#   - is <= 72 characters
# Empty / comment-only messages are allowed (interactive abort path; git aborts).
# On invalid input: exit 1; stderr names the failing rule and the offending subject.

set -u

msg_file="${1:-}"
if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
    # Nothing to validate — let git decide what to do with the missing file.
    exit 0
fi

# Find the first non-blank, non-comment line — the subject.
# `subject_raw` preserves the user's original line for display; `subject` is the
# trimmed form used for the length and regex checks. Mixing the two would either
# (a) miscount length on lines with leading/trailing whitespace, or (b) break
# AC-STE-133.1's "offending subject line verbatim" promise on display.
subject=""
subject_raw=""
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        \#*) continue ;;
        "") continue ;;
        *)
            trimmed=$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
            if [ -z "$trimmed" ]; then
                continue
            fi
            subject="$trimmed"
            subject_raw="$line"
            break
            ;;
    esac
done < "$msg_file"

# Empty / comment-only message — git's interactive abort path.
if [ -z "$subject" ]; then
    exit 0
fi

# Length check (rule: subject-too-long, > 72 chars). Run on the trimmed form
# so a stray trailing newline or accidental indent doesn't trip the gate.
subject_len=$(printf '%s' "$subject" | awk '{ print length }')
if [ "$subject_len" -gt 72 ]; then
    printf 'commit-msg: subject-too-long (%s chars, max 72)\n  %s\n' "$subject_len" "$subject_raw" >&2
    exit 1
fi

# Conventional-commits regex.
# Type list: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
# Optional scope `(<text>)`, optional `!` for breaking, then `: <description>`.
cc_re='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+$'

if printf '%s' "$subject" | grep -Eq "$cc_re"; then
    exit 0
fi

# Diagnose which rule failed.
# Order matters — pick the most specific reason.

# Rule: missing-colon-or-description — type prefix + optional scope + optional `!` is present
# but description is missing or empty.
empty_desc_re='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:[[:space:]]*$'
if printf '%s' "$subject" | grep -Eq "$empty_desc_re"; then
    printf 'commit-msg: missing-colon-or-description (empty description after `:`)\n  %s\n' "$subject_raw" >&2
    exit 1
fi

# Rule: unknown-type — `<word>: <description>` shape but `<word>` isn't a recognized type.
unknown_type_re='^[a-zA-Z][a-zA-Z0-9_-]*(\([^)]+\))?!?: .+$'
if printf '%s' "$subject" | grep -Eq "$unknown_type_re"; then
    printf 'commit-msg: unknown-type (must be one of feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\n  %s\n' "$subject_raw" >&2
    exit 1
fi

# Default: type-prefix-missing — no recognizable Conventional Commits shape at all.
printf 'commit-msg: type-prefix-missing (expected `<type>(<scope>)?!?: <description>`)\n  %s\n' "$subject_raw" >&2
exit 1
