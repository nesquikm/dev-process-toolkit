# Settings Reference

`specs/settings.yaml` is the project's one settings file. It is committed, one per project, and read by `loadProjectSettings` in `adapters/_shared/src/project_settings.ts`. This page lists every key it accepts, with its type, its default and the legacy home it replaces. Every key set is closed: an unknown key, a wrong type, a missing `schema_version` or a `schema_version` other than `1` is refused with a `SettingsShapeError` naming the file and the dotted key path.

All example values on this page are synthetic.

## Sources

The loader reports one of three sources and refuses a fourth case:

- `settings`: `specs/settings.yaml` exists and no legacy home exists.
- `legacy`: no settings file, and at least one legacy home exists. Values come from the same parse the v2.101.4 readers perform. The legacy read fallback lives through 3.x and is removed in 4.0.
- `none`: neither. Every section takes its documented default.
- Both a settings file and a legacy home carrying a recognised key: refused. The loader never merges two homes. Run `/dev-process-toolkit:upgrade` to move the legacy values.

A `specs/settings.yaml` with no line starting `schema_version:` or `min_dpt_version:` at column 0 is a foreign file (an OpenAPI or test spec, say) and is treated as absent.

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

One sub-map per adapter; either or both may be present. Each replaces the CLAUDE.md `### Linear` or `### Jira` sub-section of `## Task Tracking`.

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

The key set is closed: exactly the four keys `verify_skill`, `verify_mode`, `run_cmd` and `e2e_cmd`. Any other key under `verification` is a config error.

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `verification.verify_skill` | string | absent | `## Verification` `verify_skill:` |
| `verification.verify_mode` | `advisory` \| `blocking` \| `manual` | resolved from `run_cmd`: `blocking` when `run_cmd` declares a real command, `advisory` when `run_cmd` is `none`, empty or absent | `## Verification` `verify_mode:` |
| `verification.run_cmd` | string | absent | `## Verification` `run_cmd:` |
| `verification.e2e_cmd` | string | absent | `## Verification` `e2e_cmd:` |

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

### `close_out`

| Key | Type | Default | Replaces |
| --- | --- | --- | --- |
| `close_out.upgrade_offer` | block `{ enabled: boolean }` | `{ enabled: false }` | new (STE-712), no legacy home; absent means off |

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
