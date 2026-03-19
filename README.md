# Dev Process Toolkit

A portable collection of Claude Code skills, agents, templates, and documentation that help bootstrap and adapt **Spec-Driven Development (SDD)** and **TDD** workflows for any project.

## What's Inside

```
dev-process-toolkit/
├── .claude/
│   ├── skills/              # Copy-and-adapt skill templates
│   │   ├── gate-check/      # Deterministic quality gates
│   │   ├── implement/       # End-to-end feature implementation
│   │   ├── tdd/             # RED → GREEN → VERIFY cycle
│   │   ├── spec-review/     # Audit code against specs
│   │   ├── visual-check/    # Browser-based UI verification
│   │   ├── pr/              # Pull request creation
│   │   └── simplify/        # Code quality review
│   └── agents/              # Subagent templates
│       ├── code-reviewer.md
│       └── test-writer.md
├── templates/
│   ├── CLAUDE.md.template   # CLAUDE.md starter for new projects
│   ├── spec-templates/      # Spec file templates
│   └── settings.json        # Recommended settings
├── docs/
│   ├── sdd-methodology.md   # SDD explained
│   ├── skill-anatomy.md     # How skills work
│   ├── adaptation-guide.md  # How to adapt for your stack
│   └── patterns.md          # Patterns from real projects
└── examples/
    ├── typescript-node/      # Example config for TS/Node
    ├── flutter-dart/         # Example config for Flutter
    └── python/               # Example config for Python
```

## Quick Start

The easiest way to get started is to point Claude Code at this repository and let it do the setup for you:

```
Add SDD/TDD process to my project using https://github.com/nesquikm/dev-process-toolkit
```

Claude Code will read the toolkit's CLAUDE.md, copy the relevant skills and templates, and adapt them to your stack. You can also set it up manually:

### New project

Starting from scratch — no code, no toolchain yet.

1. **Initialize your project** — Set up your language/framework (`npm init`, `flutter create`, `uv init`, etc.) and install a test runner and linter
2. **Copy skills** to your project's `.claude/skills/` directory
3. **Adapt gate commands** — Look for `<!-- ADAPT -->` comments in `gate-check/SKILL.md` and `tdd/SKILL.md`, replace the example commands with yours (see `examples/` for your stack)
4. **Set up CLAUDE.md** — Copy `templates/CLAUDE.md.template`, fill in every section (delete the HTML comments as you go)
5. **Write specs** — Use `templates/spec-templates/` to define what you're building (start with `requirements.md` and `plan.md`)
6. **Verify** — Run `/gate-check` to confirm your gate commands work (they should pass on an empty project)
7. **Run `/implement`** to start building features end-to-end

### Existing project

Adding SDD/TDD process to a project that already builds and tests.

1. **Copy skills** to your project's `.claude/skills/` directory
2. **Adapt gate commands** — Look for `<!-- ADAPT -->` comments in `gate-check/SKILL.md` and `tdd/SKILL.md`, replace the example commands with yours (see `examples/` for your stack)
3. **Set up CLAUDE.md** — Copy `templates/CLAUDE.md.template`, fill in every section (delete the HTML comments as you go)
4. **Verify** — Run `/gate-check` to confirm all gates pass on your current codebase
5. **Start using** — Run `/tdd` for test-first development, `/implement` for full features, `/pr` when ready to push

Write specs later if you want the full SDD workflow, or skip them and use `/implement` with inline task descriptions.

For detailed adaptation instructions, see `docs/adaptation-guide.md`.

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

- `docs/sdd-methodology.md` — What SDD is and how it works
- `docs/skill-anatomy.md` — How Claude Code skills work
- `docs/adaptation-guide.md` — Step-by-step guide to adapt for any stack
- `docs/patterns.md` — 10 proven patterns + anti-patterns

**Claude Code official docs:** https://code.claude.com/docs/en
