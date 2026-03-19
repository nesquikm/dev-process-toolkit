# Dev Process Toolkit

A Claude Code plugin for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This is a **Claude Code plugin** and **meta-toolkit**. It provides skills, agents, templates, and docs that set up development processes in other projects. It is also usable without the plugin system — users can copy skills and agents manually.

## Plugin Structure

This repository follows the Claude Code plugin format:

| Path | Purpose |
|------|---------|
| `.claude-plugin/` | Plugin manifest and marketplace metadata |
| `skills/` | 9 plugin skills (setup, spec-write, gate-check, implement, tdd, spec-review, visual-check, pr, simplify) |
| `agents/` | 2 subagent templates (code-reviewer, test-writer) |
| `templates/` | CLAUDE.md template, spec file templates, settings.json |
| `docs/` | Methodology docs, skill anatomy, adaptation guide, patterns |
| `examples/` | Stack-specific configs (TypeScript, Flutter, Python) |

## How It Works

### As a plugin

Users install the plugin, then run `/dev-process-toolkit:setup` in their project. The setup skill detects the stack, generates CLAUDE.md, configures settings, and optionally creates spec files.

### Manual setup

Users copy `skills/` to their `.claude/skills/` and `agents/` to their `.claude/agents/`, then adapt `<!-- ADAPT -->` markers. See `docs/adaptation-guide.md` for step-by-step instructions.

## Key Docs

- `docs/sdd-methodology.md` — What SDD is and how it works
- `docs/skill-anatomy.md` — How Claude Code skills work (frontmatter, substitutions, subagents)
- `docs/adaptation-guide.md` — Step-by-step guide to adapt for any stack
- `docs/patterns.md` — 10 proven patterns + anti-patterns from real projects

## Core Principles

1. **Deterministic gates override LLM judgment** — compiler/linter/tests always win
2. **Acceptance criteria are binary** — pass or fail, no "good enough"
3. **Self-review is bounded** — max 2 rounds, then escalate to human
4. **Human approval before commit** — agent never commits without explicit OK
5. **Specs are the source of truth** — code follows specs, not the other way around

## Proven Stacks

This toolkit was extracted from three production projects:
- **TypeScript/React/Vite** — web analytics dashboard (npm-based gates)
- **TypeScript/Node/MCP** — MCP server (npm-based gates + build step)
- **Flutter/Dart** — mobile app (fvm flutter analyze + test, make codegen)

See `examples/` for stack-specific details.
