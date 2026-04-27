# Dev Process Toolkit

A Claude Code plugin marketplace for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This repo is a **Claude Code plugin marketplace** containing one plugin. The plugin provides commands, agents, templates, and docs that set up development processes in other projects.

## Structure

```
.claude-plugin/marketplace.json          → Marketplace catalog
plugins/dev-process-toolkit/             → The plugin
├── .claude-plugin/plugin.json           → Plugin manifest
├── skills/                              → 14 slash commands
├── agents/                              → 1 subagent template (code-reviewer — canonical review rubric, invoked twice by /implement Stage B: Pass 1 spec-compliance, Pass 2 code-quality)
├── templates/                           → CLAUDE.md template, spec file templates, settings.json
├── docs/                                → Methodology, skill anatomy, adaptation guide, patterns
└── examples/                            → Stack-specific configs (TypeScript, Flutter, Python)
```

## How It Works

### As a plugin

Users add the marketplace, install the plugin, then run `/dev-process-toolkit:setup`. The setup command detects the stack, generates CLAUDE.md, configures settings, and optionally creates spec files.

## Release Checklist

When bumping the version, these four files MUST all be updated together. Missing any of them is a release bug.

1. `plugins/dev-process-toolkit/.claude-plugin/plugin.json` — `"version"` field
2. `.claude-plugin/marketplace.json` — `"version"` field in the plugin entry
3. `CHANGELOG.md` — add a new `## [X.Y.Z] — YYYY-MM-DD — "Codename"` section at the top (below the intro), following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Use `### Added` / `### Changed` / `### Removed` / `### Fixed` subsections as needed. Cross-reference the FRs that landed in the release.
4. `README.md` — update the "Latest: **vX.Y.Z — 'Codename'**" line in the `## Release Notes` section, and refresh any counts in the `## Structure` list that the release changed (e.g., skill count, pattern count). The README is the entry point for new users; a stale "Latest:" line advertises the wrong release.

All four must stay in sync. Bump on every feature-significant change. Never ship a version bump without a CHANGELOG entry — that's how release notes rot into the README.

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
