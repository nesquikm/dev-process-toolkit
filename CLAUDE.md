# Dev Process Toolkit

A Claude Code plugin marketplace for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This repo is a **Claude Code plugin marketplace** containing one plugin. The plugin provides commands, agents, templates, and docs that set up development processes in other projects.

## Structure

```
.claude-plugin/marketplace.json          → Marketplace catalog
plugins/dev-process-toolkit/             → The plugin
├── .claude-plugin/plugin.json           → Plugin manifest
├── skills/                              → 17 slash commands (4 user-invocable + 13 dispatch — the three TDD child skills `tdd-write-test|tdd-implement|tdd-refactor` carry `user-invocable: false` and run only as `/dev-process-toolkit:tdd` orchestrator forks)
├── agents/                              → 4 subagent templates (code-reviewer + tdd-{test-writer|implementer|refactorer}; the three TDD subagents are invoked exclusively by the /tdd orchestrator via `context: fork` per STE-225)
├── templates/                           → CLAUDE.md template, spec file templates, settings.json
├── docs/                                → Methodology, skill anatomy, adaptation guide, patterns
└── examples/                            → Stack-specific configs (TypeScript, Flutter, Python)
```

## How It Works

### As a plugin

Users add the marketplace, install the plugin, then run `/dev-process-toolkit:setup`. The setup command detects the stack, generates CLAUDE.md, configures settings, and optionally creates spec files.

## Release Checklist

`/ship-milestone` reads the `## Release Files` block below to drive the per-release version bump. The block is the single source of truth for which files get rewritten on a release; partial-update bugs (e.g., a release that forgets to bump README's "Latest:" line) cannot happen because every file ships in the block.

`specs/requirements.md` carries a `Latest shipped release: vX.Y.Z` line that must also stay in sync — it is enforced separately by gate-check probe #9b (root spec hygiene), not by `/ship-milestone`. Update it as part of the same release commit when bumping versions.

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
    pattern: 'Latest: \*\*v(?<version>\d+\.\d+\.\d+) — '
    replace: 'Latest: **v{version} — '
    optional: true
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

## Docs

user_facing_mode: false
packages_mode: false
changelog_ci_owned: false
