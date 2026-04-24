# Dev Process Toolkit

A Claude Code plugin that adds **Spec-Driven Development (SDD)** and **TDD** workflows to any project. Includes 14 commands, 1 agent, spec templates, and documentation.

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
| `/dev-process-toolkit:implement` | End-to-end feature implementation with TDD and bounded three-stage self-review (Stage A spec compliance → Stage B two-pass delegated review: Pass 1 spec compliance, Pass 2 code quality, fail-fast → Stage C hardening) |
| `/dev-process-toolkit:tdd` | RED → GREEN → VERIFY cycle |
| `/dev-process-toolkit:gate-check` | Deterministic quality gates (typecheck + lint + test) |
| `/dev-process-toolkit:debug` | Structured debugging protocol for failing tests or unclear gate failures |
| `/dev-process-toolkit:spec-review` | Audit code against spec requirements |
| `/dev-process-toolkit:spec-archive` | Manually archive a FR (by ULID or tracker ref) or milestone (`M<N>` group) via `git mv` into `specs/frs/archive/` / `specs/plan/archive/` with diff approval; runs a post-archive drift check (Pass A grep + Pass B semantic scan) on finish (FR-17, FR-21, FR-45) |
| `/dev-process-toolkit:visual-check` | Browser-based UI verification via MCP |
| `/dev-process-toolkit:docs` | Generate or update project docs — staged fragments (`--quick`), human-approved merge (`--commit`), or full canonical regeneration (`--full`) |
| `/dev-process-toolkit:pr` | Pull request creation |
| `/dev-process-toolkit:simplify` | Code quality review and cleanup |
| `/dev-process-toolkit:ship-milestone` | Bundle the Release Checklist + `/docs --commit --full` into one atomic, human-approved release commit |

### Agents

- **code-reviewer** — Canonical code review rubric (quality, security, patterns, stack-specific) plus pass-specific return contracts for the Stage B two-pass flow. Invoked twice by `/implement` Phase 3 Stage B via `Agent`-tool delegation — Pass 1 spec compliance (gated on `specs/requirements.md` existing; fail-fast), Pass 2 code quality; referenced inline by `/gate-check` Code Review.

## What's Inside

```
dev-process-toolkit/
├── .claude-plugin/
│   └── marketplace.json            # Marketplace catalog
├── plugins/
│   └── dev-process-toolkit/         # The plugin
│       ├── .claude-plugin/
│       │   └── plugin.json          # Plugin manifest
│       ├── skills/                  # 14 skills (slash commands)
│       ├── agents/                  # 1 specialist agent (code-reviewer)
│       ├── adapters/                # 3 tracker adapters (linear, jira, _template) + _shared helpers
│       ├── templates/               # CLAUDE.md and spec templates
│       ├── docs/                    # Methodology and guides
│       ├── tests/                   # Pattern 9 regression fixture + capture/verify scripts + MCP/project fixtures
│       └── examples/                # Stack-specific configs
├── CLAUDE.md
├── README.md
└── LICENSE
```

## Release Notes

See [`CHANGELOG.md`](./CHANGELOG.md) for the full release history. Latest: **v1.26.0 — "Symmetry"** (M24 completes STE-54's archive/active symmetry with two new `/gate-check` probes — #14 "active-side ticket-state drift" asserts every active FR's tracker shows `in_progress` with the current user as assignee; #15 "guessed tracker-ID scan" asserts every `AC-<PREFIX>` line's prefix equals the file's bound tracker ID. Three skill-local `## Rules` additions close hazards probes cannot catch: `/implement` forbids raw `mcp__<tracker>__save_issue` writes on in-flight FRs (route through `Provider.claimLock`/`releaseLock`); `/brainstorm` + `/spec-write` forbid narrating guessed tracker IDs in chat. Additive Provider widening: `getTicketStatus` returns `assignee` alongside status. One FR (STE-87).).

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

### Examples Provided For

- **Python** — stack-detection config + CLAUDE.md template under `plugins/dev-process-toolkit/examples/python/` (not dogfooded in production by the plugin author, but the `/setup` detection path and example config are maintained alongside the TypeScript and Flutter examples).

## Documentation

- `plugins/dev-process-toolkit/docs/sdd-methodology.md` — What SDD is and how it works
- `plugins/dev-process-toolkit/docs/skill-anatomy.md` — How Claude Code skills work
- `plugins/dev-process-toolkit/docs/adaptation-guide.md` — Reference for customizing skills and configuration after `/setup`
- `plugins/dev-process-toolkit/docs/patterns.md` — 25 proven patterns + anti-patterns
- `plugins/dev-process-toolkit/docs/v2-layout-reference.md` — v2 spec layout behavioral contract (file-per-FR keyed by tracker ID / short-ULID; ULID in frontmatter; Provider interface; skill integration map)

**Claude Code official docs:** https://code.claude.com/docs/en
