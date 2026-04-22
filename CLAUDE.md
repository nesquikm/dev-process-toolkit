# Dev Process Toolkit

A Claude Code plugin marketplace for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This repo is a **Claude Code plugin marketplace** containing one plugin. The plugin provides commands, agents, templates, and docs that set up development processes in other projects.

## Structure

```
.claude-plugin/marketplace.json          → Marketplace catalog
plugins/dev-process-toolkit/             → The plugin
├── .claude-plugin/plugin.json           → Plugin manifest
├── skills/                              → 12 slash commands (setup, brainstorm, spec-write, implement, tdd, gate-check, debug, spec-review, spec-archive, visual-check, pr, simplify)
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

## Task Tracking

mode: linear
mcp_server: linear
active_ticket:
jira_ac_field:

### Sync log

- 2026-04-22T07:59:54Z — Migration complete: none → linear, 27 FRs moved
- 2026-04-22T11:56:15Z — 3 FRs added to M15 (FR-67..69); STE-46..48 created
- 2026-04-22T13:46:41Z — 1 FR added to M15 (FR-70, archive-path drift); STE-49 created
