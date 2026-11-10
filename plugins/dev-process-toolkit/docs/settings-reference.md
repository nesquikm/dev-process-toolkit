# Settings Reference

`specs/settings.yaml` is the project's one settings file. It is committed, one per project, and read by `loadProjectSettings` in `adapters/_shared/src/project_settings.ts`. This page lists every key it accepts, with its type, its default and the legacy home it replaces. Every key set is closed: an unknown key, a wrong type, a missing `schema_version` or a `schema_version` other than `1` is refused with a `SettingsShapeError` naming the file and the dotted key path.

All example values on this page are synthetic.

## Sources

The loader reports one of three sources and refuses a fourth case:

- `settings`: `specs/settings.yaml` exists and no legacy home exists.
- `legacy`: no settings file, and at least one legacy home exists. Values come from the same parse the v2.101.4 readers perform. The legacy read fallback lives through 3.x and is removed in 4.0.
- `none`: neither. Every section takes its documented default.
- Both a settings file and a legacy home carrying a recognised key: refused. The loader never merges two homes. Run `/dev-process-toolkit:upgrade` to move the legacy values.

Whose file it is depends on whether the tree is migrated. A tree is migrated when CLAUDE.md's `## Project Settings` section holds the pointer line `renderSettingsPointer` renders (the line the move and a 3.x `/setup` write); a `## Project Settings` heading of the project's own, with no pointer line, does not count. A CLAUDE.md that still carries a line only a 3.x settings-file writer writes (the marker comment that opens the generated tracking stub, or the `<!-- Project settings live in specs/settings.yaml. Edit them there. -->` comment) also counts, so deleting the `## Project Settings` section does not quietly turn the loader off.

On a migrated tree the settings file is always the toolkit's, and the loader is strict: a file that cannot be read is refused (`specs/settings.yaml cannot be read`), a file without `min_dpt_version` is refused, and a file beside a legacy home that carries a recognised key is refused as two homes.

On any other tree, including a repository the toolkit never set up and a legacy tree that has not been moved, `specs/settings.yaml` is the toolkit's only when it has a `min_dpt_version:` line at column 0. Every toolkit writer writes that line. Any other file there is the project's own file (an OpenAPI or test spec, a project's own `schema_version: 1` config with keys that share a toolkit section name, a file that does not parse, several YAML documents, a file that cannot be read, a directory at the path): every reader, hook and the token ledger ignore it, as v2.101.5 does, and `/upgrade`'s move refuses until it is renamed.

Each reader checks the header (`schema_version`, `min_dpt_version`, the closed top level) and its own section only, so a typo in one section breaks only that section's readers, as a malformed CLAUDE.md section did in v2.101.5. `loadProjectSettings` and the gate probes still check the whole file.

## Keys

### Top level

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `schema_version` | integer, must be `1` | required | new file format (STE-706) |
| `min_dpt_version` | strict `X.Y.Z` string | required | new file format (STE-706); a floor above the running toolkit refuses |

### `task_tracking`

An absent section means mode `none`.

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `task_tracking.mode` | `none` \| `linear` \| `jira` \| custom adapter name | `none` | `## Task Tracking` `mode:` |
| `task_tracking.mcp_server` | string | absent | `## Task Tracking` `mcp_server:` |
| `task_tracking.jira_ac_field` | string | absent | `## Task Tracking` `jira_ac_field:` |
| `task_tracking.branch_template` | string | absent | `## Task Tracking` `branch_template:` |
| `task_tracking.secondary_tracker` | string | `none` | `## Task Tracking` `secondary_tracker:` |
| `task_tracking.milestone_scan_fetch` | boolean | `false` | the standalone top-level `milestone_scan_fetch:` line in CLAUDE.md |

The `/spec-write --fetch` and `--no-fetch` flags still outrank `task_tracking.milestone_scan_fetch`, per `resolveFetchPolicy`: `--no-fetch` beats `--fetch`, which beats the setting, which beats the built-in default `false`.

#### `task_tracking.linear` and `task_tracking.jira`

One sub-map per adapter; either or both may be present. Each replaces the legacy CLAUDE.md `### Linear` or `### Jira` sub-section of `## Task Tracking`.

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `team` | string | absent | `### Linear` / `### Jira` `team:` |
| `project` | string | absent | `### Linear` / `### Jira` `project:` |
| `default_labels` | list of strings | `[]` | `### Linear` / `### Jira` `default_labels:` |
| `repo_tag` | string (shared container only) | absent | `### Linear` / `### Jira` `repo_tag:` |
| `min_dpt_version` | strict `X.Y.Z` string (shared container only) | absent | `### Linear` / `### Jira` `min_dpt_version:` |
| `linear_bug_label` | string | absent | `### Linear` `linear_bug_label:` |
| `jira_bug_issue_type` | string | absent | `### Jira` `jira_bug_issue_type:` |
| `jira_issue_type` | string | absent | `### Jira` `jira_issue_type:` |

In a tracker mode the binding is required: `/gate-check` probe #25 (`task-tracking-workspace-binding-present`) hard-fails without it. `task_tracking.linear` needs `team` and `project`; `task_tracking.jira` needs `project`. A missing sub-map, a missing key or an empty value all fail. Tickets created without `project` silently landed on the wrong board, which is why the probe exists.

#### `task_tracking.status_vocabulary`

The same document `specs/tracker-config.yaml` held, validated by `validateTrackerConfig`.

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `tracker_key` | string | absent | `specs/tracker-config.yaml` `tracker_key` |
| `statuses` | list of strings | absent | `specs/tracker-config.yaml` `statuses` |
| `roles` | map of role to status | absent | `specs/tracker-config.yaml` `roles` |

### `verification`

The key set is closed: exactly the five keys `verify_skill`, `verify_mode`, `run_cmd`, `e2e_cmd` and `test_commands`. Any other key under `verification` is a config error. `test_commands` is read from this file only; a legacy CLAUDE.md `## Verification` block cannot supply it.

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `verification.verify_skill` | string | absent | `## Verification` `verify_skill:` |
| `verification.verify_mode` | `advisory` \| `blocking` \| `manual` | resolved from `run_cmd`: `blocking` when `run_cmd` declares a real command, `advisory` when `run_cmd` is `none`, empty or absent | `## Verification` `verify_mode:` |
| `verification.run_cmd` | string | absent | `## Verification` `run_cmd:` |
| `verification.e2e_cmd` | string | absent | `## Verification` `e2e_cmd:` |
| `verification.test_commands` | non-empty list of `{ stack, command }` entries: `stack` is one of `bun` \| `pytest` \| `flutter` (picks the test-count parser), `command` is a non-empty list of non-empty strings; no other key on an entry | absent | new (STE-730), no legacy home; a `## Verification` heading never supplies it |

- `verify_mode`: a written value always wins. An absent key is resolved from `run_cmd`: `blocking` when `run_cmd` declares a real command, so a failing check blocks the commit, and `advisory` when `run_cmd` is `none`, empty or absent, so the outcome is reported and never blocks the commit.
- `run_cmd: none` declares that the project cannot be run. `none` is an answer, distinct from an absent key, which is no answer at all.
- `e2e_cmd: none` answers "no end-to-end suite" under the same convention; an absent key answers nothing.

### `docs`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `docs.user_facing_mode` | boolean | `false` | `## Docs` `user_facing_mode:` |
| `docs.packages_mode` | boolean | `false` | `## Docs` `packages_mode:` |
| `docs.changelog_ci_owned` | boolean | `false` | `## Docs` `changelog_ci_owned:` |
| `docs.changelog_unversioned` | boolean | `false` | `## Docs` `changelog_unversioned:` |

`/setup` writes these three flags: `docs.user_facing_mode`, `docs.packages_mode`, `docs.changelog_ci_owned`.

Optional key, not written by `/setup`: `docs.changelog_unversioned` (default `false`; absent reads `false`). Add it by hand when git tags or CI own the version; if `true`, `/ship-milestone` writes no version and entries go under `## [Unreleased]`.

### `orchestration`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `orchestration.default_effort` | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` | `ultracode` | `## Orchestration` `default_effort:` |
| `orchestration.merge_policy` | `offer` \| `auto` \| `never` | `offer` | `## Orchestration` `merge_policy:` |

### `tracking`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `tracking.token_stats` | block `{ enabled: boolean }` | `{ enabled: false }` | `## Token Stats` `enabled:` |
| `tracking.gate_outcomes` | block `{ enabled: boolean }` | `{ enabled: false }` | new (STE-715), no legacy home; absent means off. It shares the `tracking` section, so a malformed value refuses every `tracking` read, the token-stats switch included |
| `tracking.tool_calls` | block `{ enabled: boolean }` | `{ enabled: false }` | new (STE-716), no legacy home; absent means off. It shares the `tracking` section, so a malformed value refuses every `tracking` read |

### `close_out`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `close_out.upgrade_offer` | block `{ enabled: boolean }` | `{ enabled: false }` | new (STE-712), no legacy home; absent means off |

### `retro`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `retro.enabled` | boolean | `false` | new (STE-719), no legacy home; absent means off. The switch for the close-out retro offer only |

### `optimizations`

The key set is closed: exactly the one knob `gate_commands`. Any other key under `optimizations` is a config error, and a step that can never be reused (such as `code_review`) is refused by name. `/setup` writes no `optimizations` section.

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `optimizations.gate_commands` | `reuse` \| `run` | `run` | new (STE-723), no legacy home; absent means `run` |

- `run` (the default): `/gate-check` runs the project's deterministic gate commands (typecheck, lint, test, build) exactly as it always has. An absent key or an absent section reads `run`.
- `reuse`: `/gate-check` may reuse a stored deterministic pass proved on identical input instead of running the command again. It takes effect only when `tracking.gate_outcomes.enabled` is `true`; nothing turns that key on implicitly, and without it the knob reads `run`. No value skips a command, lowers a severity or changes what a run checks.
- With `reuse`, the front door sends each command's stdout and stderr to a step log under `.dpt/ledger/gate-steps/<session>/`, which is git-ignored, and prints exactly one line itself: `dpt-gate-step: <label> exit <N> — <summary>, log <path>, read the log on failure, receipt <path> sha256:<digest>`. On a failure, read the log it names. A reused command prints one `dpt-reuse:` line instead.
- The loader checks the knob name only. The value is graded by `/gate-check` probe `optimizations_reuse_only`, which refuses any value other than `reuse` or `run`.
- A failed step blocks reuse without a vouch. Claude Code records a non-zero exit as an error result, so a failing step's line never vouches; instead, any stored `gate-step` fail for the same label that is newer than the vouched pass and was stored on the live key or on a null key (a failing run that changed the tree), or any error-shaped front-door call for the label after it, makes the door run the command again. That holds when the failing call was piped or backgrounded and so recorded as a success. A fail stored on a different non-null key is another tree and does not block. A forged fail can only cause a rerun.
- No key, so no reuse, on a tree whose `git status` could be misled by local git state: any index entry `git ls-files -v` tags other than `H` (`--skip-worktree`, `--assume-unchanged`, sparse checkout), `core.ignoreStat` set, `core.checkStat` set to `minimal`, or a `clean`, `smudge` or `process` filter driver configured for a tracked path (Git LFS included). The clean check runs `git status` with `core.fsmonitor` and `core.untrackedCache` off, `core.trustctime=true`, `core.checkStat=default`, `core.fileMode=true`, `core.ignorecase=false` and `core.precomposeunicode=false` forced, every untracked file and submodule shown, and no optional locks. So a local `core.trustctime=false` or `core.fileMode=false` cannot hide a same-size, time-restored edit or a mode change, and the macOS defaults `core.ignorecase=true` and `core.precomposeunicode=true` cannot hide a case-only or NFC/NFD rename done with plain `mv`. A tree whose on-disk names differ from the index only in case or Unicode normal form (for example, files a Finder copy wrote in NFD) never reuses. On a filesystem without file modes, forcing `core.fileMode` shows every file changed, so reuse never fires there. This fails safe.
- The key is computed again after the command exits; if the run left the tree changed, its step stores `key: null` and is never reused.
- A gated command containing a single quote cannot sit inside the documented `'<command>'` and stay a plain call, so its step line never vouches and it always runs. This fails safe.
- Scope: reuse protects against stale evidence in ordinary use. It is not a defence against an agent or user that deliberately hides edits or disguises failures. Each check above closes a way ordinary work could leave a stale pass looking fresh, apart from the residual named below; someone set on hiding a change can still find one this list does not name.
- Residual (STE-724): git-ignored paths such as a local `.env`, dependency directories such as `node_modules`, generated and build output, and runtimes other than Bun are outside the key, and so is every input outside the repository: a sibling checkout reached through a `file:` dependency or a symlink, a local database or service, and the clock. A change there can make a reused pass one a fresh run would not produce. So is a line-ending-only edit that an `eol`/`text` attribute or `core.autocrlf` normalises away, an edit made during a run and reverted before it exits, and git state set through the environment (`GIT_DIR`, `GIT_CONFIG_*`) rather than the repository. Only a fail through the front door counts against a stored pass: a fail from running the same command by hand, outside the door, does not block reuse (on an identical key such a fail comes only from flakiness or an input outside the key). A child that reaches the door's stdout by path (on darwin, Claude Code's task output file; on Linux, `/proc/$PPID/fd/1`) can append lines to it; extra lines vouch nothing, so this fails safe. The same-session limit bounds that residual, it is not closed.

### `release`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `release.files` | list of release-file entries, same entry shape | `[]` | `## Release Files` |

`/setup` seeds `release.files` from the per-stack default in `examples/<stack>/release.yml`. Each entry takes these keys:

- `path`: repo-relative path.
- `kind`: `json`, `toml`, `yaml`, `changelog` or `regex`.
- `field`: per kind, and not interchangeable:
  - json — any dot-path, array index included: `version`, `package.version`, `plugins[0].version`.
  - toml — top-level or one-level-dotted only: `version`, `project.version`. `plugins[0].version` throws at bump time.
  - yaml — top-level scalar only, no dots: `version`. `project.version` is refused at parse time.
- `pattern`: a regex with a named `(?<version>...)` group, `regex` kind only. Every occurrence it matches is rewritten.
- `replace`: a template using `{version}` and `{codename}`, `regex` kind only, written literally.
- `optional`: boolean, default `false`. A missing path or a pattern that matches nothing is `n/a`, not an error.

Full schema and per-kind worked examples: `docs/ship-milestone-reference.md`.

### `video`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `video.config` | map, validated by `parseVideoConfig` | `{}` | `.dpt/video/config.yaml` |
| `video.style` | map, validated by `parseVideoStyle` | `{}` | `.dpt/video/style.yaml` |

## Never moved

These surfaces stay where they are. The loader never reads them:

- `.dpt/.env`: secrets.
- The per-user `userConfig.tracker_write_gate`. A project copy is refused as forged.
- `.claude/settings.json`: owned by Claude Code.
- The `DPT_*` environment knobs (for example `DPT_GATE_TIMEOUT_MS` and `DPT_SKIP_FETCH`).

## Stays in CLAUDE.md

The `/setup` generation marker, `## /setup audit`, `## Key Commands`, the whole of `## Testing Conventions` (its `Layout:` bullet included) and every other prose section stay in CLAUDE.md.

Through all of 3.x, a settings-file tree in a tracker mode also carries a generated `## Task Tracking` stub in CLAUDE.md, rendered by `renderTrackingStub`, so a pre-3.0 cached hook keeps guarding. Edit `specs/settings.yaml`, not the stub. The loader never reads the stub slot. The stub is removed in 4.0.

## Front door

```
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/project_settings.ts mode <projectRoot>
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/project_settings.ts get <section> <projectRoot>
```

`mode` prints `mode: <value>` and `source: <source>`; `get` prints the section as JSON. Code uses this front door today. Through 3.x, skills still read the tracker mode from the CLAUDE.md binding stub; the front door becomes the skill path in 4.0.
