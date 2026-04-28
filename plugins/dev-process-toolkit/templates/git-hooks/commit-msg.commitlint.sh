#!/bin/sh
# Conventional Commits v1.0.0 commit-msg hook (commitlint delegator).
# Installed by /dev-process-toolkit:setup --commitlint. See AC-STE-133.3.
#
# Delegates validation to @commitlint/cli for full spec coverage. Intended
# for projects with Node/Bun tooling. Repos without commitlint installed
# get a clear "missing dep" diagnostic and exit 1 — /setup --commitlint
# surfaces the install command (`bun add -D @commitlint/cli @commitlint/config-conventional`)
# but does not run it; the user is expected to install before the first commit.

set -u

msg_file="${1:-}"
if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
    # No message file — let git decide.
    exit 0
fi

if ! command -v bunx >/dev/null 2>&1; then
    printf 'commit-msg: bunx not found on $PATH\n' >&2
    printf '  Install Bun (https://bun.sh) or re-run /setup without --commitlint to use the shell hook.\n' >&2
    exit 1
fi

exec bunx commitlint --edit "$msg_file"
