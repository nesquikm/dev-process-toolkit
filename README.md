# Dev Process Toolkit

A Claude Code plugin that adds **Spec-Driven Development (SDD)** and **TDD** workflows to any project. Includes 9 commands, 2 agents, spec templates, and documentation.

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
| `/dev-process-toolkit:spec-write` | Guide through writing spec files (requirements, technical, testing, plan) |
| `/dev-process-toolkit:implement` | End-to-end feature implementation with TDD and self-review |
| `/dev-process-toolkit:tdd` | RED → GREEN → VERIFY cycle |
| `/dev-process-toolkit:gate-check` | Deterministic quality gates (typecheck + lint + test) |
| `/dev-process-toolkit:spec-review` | Audit code against spec requirements |
| `/dev-process-toolkit:visual-check` | Browser-based UI verification via MCP |
| `/dev-process-toolkit:pr` | Pull request creation |
| `/dev-process-toolkit:simplify` | Code quality review and cleanup |

### Agents

- **code-reviewer** — Reviews code for quality, patterns, and security
- **test-writer** — Writes tests following project conventions

## Manual Setup

If you prefer not to install the plugin, you can copy files manually from `plugins/dev-process-toolkit/`:

1. Copy `skills/` contents to your project's `.claude/skills/` directory
2. Copy `agents/` contents to your project's `.claude/agents/` directory
3. Look for `<!-- ADAPT -->` comments in each skill and replace with your project's commands
4. Create your `CLAUDE.md` using `templates/CLAUDE.md.template`
5. Run `/gate-check` to verify everything works

See `plugins/dev-process-toolkit/docs/adaptation-guide.md` for detailed instructions.

## What's Inside

```
dev-process-toolkit/
├── .claude-plugin/
│   └── marketplace.json            # Marketplace catalog
├── plugins/
│   └── dev-process-toolkit/         # The plugin
│       ├── .claude-plugin/
│       │   └── plugin.json          # Plugin manifest
│       ├── skills/                  # 9 skills (slash commands)
│       ├── agents/                  # 2 specialist agents
│       ├── templates/               # CLAUDE.md and spec templates
│       ├── docs/                    # Methodology and guides
│       └── examples/                # Stack-specific configs
├── CLAUDE.md
├── README.md
└── LICENSE
```

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
- `plugins/dev-process-toolkit/docs/adaptation-guide.md` — Step-by-step guide to adapt for any stack
- `plugins/dev-process-toolkit/docs/patterns.md` — 10 proven patterns + anti-patterns

**Claude Code official docs:** https://code.claude.com/docs/en
