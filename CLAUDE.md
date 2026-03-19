# Dev Process Toolkit

A portable collection of Claude Code skills, agents, templates, and documentation for bootstrapping **Spec-Driven Development (SDD)** and **TDD** workflows in any project.

## What This Is

This is NOT a project to build — it's a **meta-toolkit**. Use it to set up development processes in other projects. When a user asks to set up SDD/TDD for a new or existing project, use the skills, templates, and docs in this directory as source material.

## How to Use This Toolkit

### Setting up a new project

1. Copy skills from `.claude/skills/` to the target project's `.claude/skills/`
2. Adapt `<!-- ADAPT -->` comments in each skill to match the target's toolchain
3. Copy agents from `.claude/agents/` if the project needs them
4. Use `templates/CLAUDE.md.template` to create the target's CLAUDE.md
5. Use `templates/spec-templates/*.template` to create spec files in the target's `specs/` directory
6. Use `templates/settings.json` as a starting point for `.claude/settings.json`
7. Refer to `examples/` for stack-specific gate commands and conventions

### Adding process to an existing project

Start minimal — copy only `/gate-check` and `/tdd` skills. Add `/implement` and `/pr` once the basics work. See `docs/adaptation-guide.md` Step 5 for the recommended progression.

## Directory Layout

| Path | Purpose |
|------|---------|
| `.claude/skills/` | 7 portable skill templates (gate-check, implement, tdd, spec-review, visual-check, pr, simplify) |
| `.claude/agents/` | 2 subagent templates (code-reviewer, test-writer) |
| `templates/` | CLAUDE.md template, spec file templates, settings.json |
| `docs/` | Methodology docs, skill anatomy, adaptation guide, patterns |
| `examples/` | Stack-specific configs (TypeScript, Flutter, Python) |

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
