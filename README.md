# Dev Process Toolkit

A Claude Code plugin that adds **Spec-Driven Development (SDD)** and **TDD** workflows to any project. Includes 12 commands, 2 agents, spec templates, and documentation.

## Install as Plugin

```
/plugin marketplace add nesquikm/dev-process-toolkit
/plugin install dev-process-toolkit@nesquikm-dev-process-toolkit
```

Then run the setup command in your project:

```
/dev-process-toolkit:setup
```

This detects your stack, generates a CLAUDE.md, configures settings, and optionally creates spec files — all adapted to your project.

## What You Get

### Commands

| Command | Purpose |
|---------|---------|
| `/dev-process-toolkit:setup` | Set up SDD/TDD process for your project |
| `/dev-process-toolkit:brainstorm` | Socratic design session before writing specs (for open-ended features) |
| `/dev-process-toolkit:spec-write` | Guide through writing spec files (requirements, technical, testing, plan) |
| `/dev-process-toolkit:implement` | End-to-end feature implementation with TDD and two-stage self-review |
| `/dev-process-toolkit:tdd` | RED → GREEN → VERIFY cycle |
| `/dev-process-toolkit:gate-check` | Deterministic quality gates (typecheck + lint + test) |
| `/dev-process-toolkit:debug` | Structured debugging protocol for failing tests or unclear gate failures |
| `/dev-process-toolkit:spec-review` | Audit code against spec requirements |
| `/dev-process-toolkit:spec-archive` | Manually archive a milestone, FR, or AC block into `specs/archive/` with diff approval (FR-17) |
| `/dev-process-toolkit:visual-check` | Browser-based UI verification via MCP |
| `/dev-process-toolkit:pr` | Pull request creation |
| `/dev-process-toolkit:simplify` | Code quality review and cleanup |

### Agents

- **code-reviewer** — Reviews code for quality, patterns, and security
- **test-writer** — Writes tests following project conventions

## What's Inside

```
dev-process-toolkit/
├── .claude-plugin/
│   └── marketplace.json            # Marketplace catalog
├── plugins/
│   └── dev-process-toolkit/         # The plugin
│       ├── .claude-plugin/
│       │   └── plugin.json          # Plugin manifest
│       ├── skills/                  # 12 skills (slash commands)
│       ├── agents/                  # 2 specialist agents
│       ├── templates/               # CLAUDE.md and spec templates
│       ├── docs/                    # Methodology and guides
│       └── examples/                # Stack-specific configs
├── CLAUDE.md
├── README.md
└── LICENSE
```

## Release Notes

See [`CHANGELOG.md`](./CHANGELOG.md) for the full release history. Latest: **v1.10.0 — "Bounded Context"** (spec archival, `/spec-archive` skill, stable anchor IDs, `specs/archive/` convention).

## Core Philosophy

Three layers prevent AI agents from going off the rails:

1. **Specs** — Human-written requirements are the source of truth
2. **Deterministic gates** — Typecheck + lint + test must pass (no LLM judgment)
3. **Bounded self-review** — Max 2 rounds, then escalate to human

The key insight: **deterministic checks always override LLM judgment**. A failing test means "fix it," not "maybe it's fine."

## Proven Across

- **TypeScript/React/Vite** — web analytics dashboard
- **TypeScript/Node/MCP** — MCP server
- **Flutter/Dart** — retail mobile app

## Documentation

- `plugins/dev-process-toolkit/docs/sdd-methodology.md` — What SDD is and how it works
- `plugins/dev-process-toolkit/docs/skill-anatomy.md` — How Claude Code skills work
- `plugins/dev-process-toolkit/docs/adaptation-guide.md` — Reference for customizing skills and configuration after `/setup`
- `plugins/dev-process-toolkit/docs/patterns.md` — 14 proven patterns + anti-patterns

**Claude Code official docs:** https://code.claude.com/docs/en
