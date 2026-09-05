# Dev Process Toolkit

A Claude Code plugin marketplace for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This repo is a **Claude Code plugin marketplace** containing one plugin. The plugin provides commands, agents, templates, and docs that set up development processes in other projects.

## Structure

```
.claude-plugin/marketplace.json          → Marketplace catalog
plugins/dev-process-toolkit/             → The plugin
├── .claude-plugin/plugin.json           → Plugin manifest
├── skills/                              → 27 slash commands (18 user-invocable + 9 dispatch — seven of the nine are dispatch-only fork children: the four TDD child skills `tdd-write-test|tdd-implement|tdd-refactor|tdd-spec-review`, the `spec-research` and `deps-research` child skills, and the `spec-review-audit` child skill carry `user-invocable: false` and run only as orchestrator forks (`/dev-process-toolkit:tdd` for the TDD four; `/dev-process-toolkit:spec-research` forked from `/brainstorm` and `/spec-write`; `/dev-process-toolkit:deps-research` forked from `/brainstorm` and `/spec-write`; `/dev-process-toolkit:spec-review-audit` forked from `/spec-review`). The other two, `/upgrade` and `setup-template`, are NOT fork children — `/upgrade` carries `user-invocable: false` only to stay off the slash menu, stays model-invocable, and is discovered through `/gate-check` probe #69 (`upgrade_staleness`) instead of a menu slot, while `setup-template` is dispatched exclusively by `/setup --template`. The `/deps` and `/best-practices` skills are the user-invocable manifest management surfaces.)
├── agents/                              → 8 subagent templates (code-reviewer + spec-researcher + spec-reviewer + deps-researcher + tdd-{test-writer|implementer|refactorer|spec-reviewer}; the four TDD subagents are invoked exclusively by the /tdd orchestrator via `context: fork` per STE-225 + STE-296, the spec-researcher and deps-researcher are invoked exclusively by the /dev-process-toolkit:spec-research and /dev-process-toolkit:deps-research forked skills via `context: fork`, and the spec-reviewer is invoked exclusively by the /dev-process-toolkit:spec-review-audit forked skill via `context: fork`)
├── templates/                           → CLAUDE.md template, spec file templates, settings.json
├── docs/                                → Methodology, skill anatomy, adaptation guide, patterns
└── examples/                            → Stack-specific configs (TypeScript, Flutter, Python)
```

## How It Works

### As a plugin

Users add the marketplace, install the plugin, then run `/dev-process-toolkit:setup`. The setup command detects the stack, generates CLAUDE.md, configures settings, and optionally creates spec files.

## Release Checklist

`/ship-milestone` reads the `## Release Files` block below to drive the per-release version bump. The block is the single source of truth for which files get rewritten on a release: a file that ships in the block is rewritten by the ceremony, and a release surface that does not ship in it is maintained by hand and will go stale. That is the whole guarantee — the block does not make partial-update bugs impossible, it makes them a missing entry, which is a thing you can look for.

`specs/requirements.md` ships in the block as of v2.80.1 (STE-554). Its `Latest shipped release:` line carries a version and a codename, both rewritten by the release run and both graded by gate-check probe #9b (root spec hygiene); before STE-554 the line had no writer, so every release commit red that probe until a human amended the file by hand.

What remains hand-maintained, deliberately: the prose paragraph after the README "Latest:" banner and the milestone id inside it. Those are written by a person, and `release_surface_agreement` grades the milestone before the release commit is created.

Schema reference + per-kind worked examples live in `plugins/dev-process-toolkit/docs/ship-milestone-reference.md`.

## Release Files

```yaml
files:
  - path: plugins/dev-process-toolkit/.claude-plugin/plugin.json
    kind: json
    field: version
  - path: .claude-plugin/marketplace.json
    kind: json
    field: plugins[0].version
  - path: CHANGELOG.md
    kind: changelog
  - path: README.md
    kind: regex
    pattern: 'Latest: \*\*v(?<version>\d+\.\d+\.\d+) — "(?<codename>[^"]+)"'
    replace: 'Latest: **v{version} — "{codename}"'
    optional: true
  - path: specs/requirements.md
    kind: regex
    pattern: '\*\*Latest shipped release:\*\* \*\*v(?<version>\d+\.\d+\.\d+) \("(?<codename>[^"]+)"\)\*\*'
    replace: '**Latest shipped release:** **v{version} ("{codename}")**'
```

## Core Principles

1. **Deterministic gates override LLM judgment** — compiler/linter/tests always win
2. **Acceptance criteria are binary** — pass or fail, no "good enough"
3. **Self-review is bounded** — max 2 rounds, then escalate to human
4. **Human approval before commit** — agent never commits without explicit OK
5. **Specs are the source of truth** — code follows specs, not the other way around

## Commit Convention

This repo follows [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) from M36 forward. The `commit-msg` hook installed at `.git/hooks/commit-msg` (a copy of `plugins/dev-process-toolkit/templates/git-hooks/commit-msg.sh`) hard-blocks non-conforming commits with no grace period.

**Subject** — `<type>(<scope>): <description>`, ≤ 72 characters.

- **Type** — one of `feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert`.
- **Scope** — encouraged; the primary touched area (e.g., `skills/setup`, `adapters/linear`, `templates`, `tests`).
- **Breaking change** — append `!` (e.g., `feat(api)!: drop legacy endpoint`). The `BREAKING CHANGE:` body footer is also accepted.

**Tracker IDs** go in the footer:

```
Refs: STE-<N>
```

**Release commits** (produced by `/ship-milestone`) carry an extra footer:

```
Release: vX.Y.Z "Codename"
Refs: M<N>
```

**Sample messages:**

```
feat(skills/setup): install commit-msg hook on /setup

Refs: STE-133
```

```
chore(release): v1.37.0

Conventional Commits adoption (M36 ships).

Release: v1.37.0 "Conventional"
Refs: M36
```

The user-preferences override in the global `~/.claude/CLAUDE.md` (no Claude-Code attribution, no robot emoji, short and humorous) constrains commit-message *style*; this section constrains *format*. They compose — both apply.

**Pre-CC history (M1–M35)** is intentionally not rewritten. CHANGELOG entries continue to follow the existing `## [X.Y.Z] — YYYY-MM-DD — "Codename"` format independent of the per-commit subject convention. The M36 implementation commit and the M36 ship commit are the first two canonical CC commits on this repo's main line of history.

## Task Tracking

mode: linear
mcp_server: linear
jira_ac_field:

### Linear

team: STE
project: DPT — Dev Process Toolkit

## Verification

verify_skill: smoke-test
verify_mode: manual
run_cmd: none

## Docs

user_facing_mode: false
packages_mode: false
changelog_ci_owned: false

## Orchestration

default_effort: ultracode
merge_policy: auto

## Token Stats

enabled: true
