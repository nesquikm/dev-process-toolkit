# Dev Process Toolkit

A Claude Code plugin marketplace for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This repo is a **Claude Code plugin marketplace** containing one plugin. The plugin provides commands, agents, templates, and docs that set up development processes in other projects.

## Structure

```
.claude-plugin/marketplace.json          → Marketplace catalog
plugins/dev-process-toolkit/             → The plugin
├── .claude-plugin/plugin.json           → Plugin manifest
├── skills/                              → 11 slash commands (setup, brainstorm, spec-write, implement, tdd, gate-check, debug, spec-review, visual-check, pr, simplify)
├── agents/                              → 2 subagent templates (code-reviewer, test-writer)
├── templates/                           → CLAUDE.md template, spec file templates, settings.json
├── docs/                                → Methodology, skill anatomy, adaptation guide, patterns
└── examples/                            → Stack-specific configs (TypeScript, Flutter, Python)
```

## How It Works

### As a plugin

Users add the marketplace, install the plugin, then run `/dev-process-toolkit:setup`. The setup command detects the stack, generates CLAUDE.md, configures settings, and optionally creates spec files.

### Manual setup

Users copy `plugins/dev-process-toolkit/skills/` to their `.claude/skills/` and `agents/` to their `.claude/agents/`, then adapt `<!-- ADAPT -->` markers. See `plugins/dev-process-toolkit/docs/adaptation-guide.md`.

## Core Principles

1. **Deterministic gates override LLM judgment** — compiler/linter/tests always win
2. **Acceptance criteria are binary** — pass or fail, no "good enough"
3. **Self-review is bounded** — max 2 rounds, then escalate to human
4. **Human approval before commit** — agent never commits without explicit OK
5. **Specs are the source of truth** — code follows specs, not the other way around
