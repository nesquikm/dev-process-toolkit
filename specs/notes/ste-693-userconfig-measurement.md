# STE-693 AC.1 — live userConfig measurement (2026-10-22, Claude Code 2.1.308)

Measured before any gate code changed. A throwaway probe plugin `optprobe` declared `userConfig.tracker_write_gate` (`type: string`, `default: enforce`) and registered a `UserPromptSubmit` hook and a `PreToolUse` (`Bash`) hook, each appending `env | grep '^CLAUDE_PLUGIN_OPTION_'` to a capture file. It was installed from a scratch directory marketplace at local scope into a scratch git project, and each run was one `claude -p` session (haiku) that called `echo probe` through Bash. The value was set with `claude plugin configure optprobe@optprobe-mkt --values-stdin`, the CLI form of `/plugin configure`. It wrote `pluginConfigs["optprobe@optprobe-mkt"].options.tracker_write_gate` into the user settings file.

| Run | Where the value was set | What both hooks received |
|-----|-------------------------|--------------------------|
| 1 | not set | no `CLAUDE_PLUGIN_OPTION_*` variable at all: the manifest `default` is **not** injected |
| 2 | user settings `pluginConfigs`, via `claude plugin configure` | `CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE=off` |
| 3 | project `.claude/settings.json` `pluginConfigs` only | no variable, and `claude plugin configure` still listed the option as not set |
| 4 | project `.claude/settings.local.json` `pluginConfigs` only | no variable |

Capture transcript (both hooks fired in every run):

```
== run1-unset
UserPromptSubmit-ran
PreToolUse-ran
== run2-user-off
UserPromptSubmit CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE=off
UserPromptSubmit-ran
PreToolUse CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE=off
PreToolUse-ran
== run3-project-off
UserPromptSubmit-ran
PreToolUse-ran
== run4-local-off
UserPromptSubmit-ran
PreToolUse-ran
```

The binary agrees: its hook runner sets ``fo[`CLAUDE_PLUGIN_OPTION_${key.replace(/[^A-Za-z0-9_]/g,"_").toUpperCase()}`]=String(value)`` for each configured option.

**Results the later ACs use.** The variable is `CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE`, and the stored string arrives verbatim. When the option is unset the variable is absent, so absent must mean `enforce`. Only the user settings file reaches the hook. A committed project-scope value does **not** reach it, and neither does a local-scope one. So AC.6's conditional warning about a committed project settings file does not apply, and the `/gate-check` row reports the effective setting only. The probe plugin, its marketplace and its cache were removed afterwards. The user settings file, `known_marketplaces.json` and `installed_plugins.json` were compared with pre-run backups and are byte-identical.
