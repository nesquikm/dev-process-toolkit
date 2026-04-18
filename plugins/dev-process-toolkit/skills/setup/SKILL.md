---
name: setup
description: Set up SDD/TDD development process for the current project. Creates CLAUDE.md, configures settings, and optionally creates spec files. Use when starting a new project or adding process to an existing one.
disable-model-invocation: true
argument-hint: '[new or existing]'
---

# Project Setup

Set up the Spec-Driven Development and TDD workflow for this project.

## Process

### 0. Tracker mode probe (existing projects)

Before any detection or setup, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` already exists and contains a `## Task Tracking` section, this is an existing tracker-mode project — `/setup --migrate` is the right entry point for changing modes (FR-36 AC-36.1). If `CLAUDE.md` is absent, empty of `## Task Tracking`, or `$ARGUMENTS` contains `new`, run the normal fresh-setup flow below.

### 1. Detect the project

Check for project files (`package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) and source directories.

If **no project files are found** (empty directory or only basic files), this is a new project — go to step 2.

If project files exist, skip to step 3.

### 1b. Doctor Validation

For **existing projects** (project files found in step 1), validate prerequisites before proceeding:

| Check | How | Remediation |
|-------|-----|-------------|
| Required tools installed | Run version commands: `node -v`, `flutter --version`, `python3 --version`, etc. | Install the missing tool or update PATH |
| Gate commands runnable | Run the gating rule from CLAUDE.md (e.g., `npm run typecheck && npm run lint && npm run test`) | Fix failing commands or update CLAUDE.md gating rule |
| CLAUDE.md present | Check if `CLAUDE.md` exists in project root | Will be created in step 5 |
| .claude/settings.json present | Check if `.claude/settings.json` exists | Will be created in step 6 |
| Spec anchor IDs (if `specs/` exists) | Grep `specs/plan.md` for every `## M{N}:` and `specs/requirements.md` for every `### FR-{N}:` heading; each must carry a matching `{#M{N}}` or `{#FR-{N}}` anchor on the same line | Add the missing `{#M{N}}` / `{#FR-{N}}` anchor to the heading. Missing anchors do NOT cause doctor failure — they report under `GATE PASSED WITH NOTES` so archival pointers stay stable (FR-18) |

Report pass/fail for each check with remediation instructions. Missing anchor IDs surface under `GATE PASSED WITH NOTES`, never as a hard failure.

For **new projects** (no project files found), skip this step — tools and configs will be set up during scaffolding.

### 2. Scaffold new projects

Ask the user what stack they want, then scaffold a **working, gate-check-ready** project. Every generated config must work out of the box — no manual fixup required.

#### 2a. Research current best practices

Before generating any config files, search the web for the current recommended setup for the chosen stack. Look for:
- Latest stable versions of the test runner, linter, and typecheck tool
- Current config file format (tools change formats between major versions — e.g., ESLint flat config vs legacy `.eslintrc`)
- Current recommended tsconfig/pyproject/pubspec settings
- Any known gotchas with the latest versions

This ensures scaffolding uses up-to-date patterns, not stale defaults.

#### 2b. Scaffold the project

Key requirements for **every stack**:
- **Git repo** — Run `git init` if not already in a git repository
- **ESM/modern module format** — Use the current module standard (e.g., `"type": "module"` for Node)
- **Placeholder source file** — Prevents "no inputs found" errors (e.g., `src/index.ts`, `src/__init__.py`, `main.go`)
- **Test runner configured to pass with no tests** — Critical for gate-check on empty project (e.g., Vitest `passWithNoTests: true`)
- **Don't use interactive `init` commands** that generate broken defaults (e.g., don't use `tsc --init` — create tsconfig.json directly with correct settings)
- **.gitignore** — Stack-appropriate ignores (node_modules, dist, __pycache__, .venv, etc.)
- **All config files** — Must work together without conflicts or manual fixup

**Stack-specific guidance** (use as a starting point — verify against your web research):

- **TypeScript/Node:** `npm init -y`, set `"type": "module"`, install typescript + vitest + eslint, create tsconfig.json (strict, ESM, src/dist dirs), vitest.config.ts, eslint config (if using `projectService: true`, add `allowDefaultProject: ['*.config.ts', '*.config.mjs']` so root-level config files are linted correctly), src/index.ts, tests/ dir
- **Flutter/Dart:** `flutter create .` (or `fvm flutter create .`), add bloc_test and mocktail as dev deps, verify test/ dir exists
- **Python:** `uv init` (or poetry init), add pytest + mypy + ruff as dev deps, create src/__init__.py, tests/ dir, verify pyproject.toml has tool configs
- **Go:** `go mod init <module>`, create main.go, install golangci-lint

#### 2c. Verify scaffolding

Run the gate commands to verify they all pass. If anything fails, fix it immediately — the project must be gate-check-ready before proceeding to step 3.

### 3. Read the templates

Load reference material from the plugin directory:
- `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.template` — Base template
- `${CLAUDE_PLUGIN_ROOT}/examples/` — Stack-specific gate commands and patterns
- `${CLAUDE_PLUGIN_ROOT}/docs/adaptation-guide.md` — Configuration reference

Match the detected stack to the closest example in `${CLAUDE_PLUGIN_ROOT}/examples/` (typescript-node, flutter-dart, or python). For other stacks, use the adaptation guide's gate command table.

### 4. Present the plan

Show the user what you'll create and ask for approval:
- **CLAUDE.md** — With their project's actual commands, patterns, and conventions
- **.claude/settings.json** — With tool permissions for their stack
- **specs/** (optional) — Spec file templates if they want the full SDD workflow

### 5. Generate CLAUDE.md

Create `CLAUDE.md` based on the template, filling in:
- Project name and description
- Detected tech stack
- Actual directory structure (from the project)
- Real gate commands for their stack
- Key patterns (infer from existing code, or leave as TODOs)
- Testing conventions (detected from config files and stack examples)
- DO NOT section with sensible defaults

**Important:** Generate real content, not template placeholders. If you can detect the test framework, write it. If you can see the directory structure, document it.

### 6. Configure settings

Create or update `.claude/settings.json` with tool permissions for the stack. Use `${CLAUDE_PLUGIN_ROOT}/examples/` as reference.

If `.claude/settings.json` already exists, merge permissions — don't overwrite.

### 7. Configure MCP servers

**Optionally offer [mcp-rubber-duck](https://github.com/nesquikm/mcp-rubber-duck)** — an MCP server that delegates tasks to independent AI "ducks," each with their own tools and context. It improves quality through cross-model evaluation (different models reviewing each other's work) and enables the `/visual-check` skill for visual UI verification. Explain this to the user and let them decide whether to set it up. Useful for any stack.

**For web-based projects only** (TypeScript/Node with a UI, React, Next.js, Vue, Svelte, etc.), also add `chrome-devtools-mcp` to `.mcp.json` so that Chrome can be used directly from Claude Code:

```json
{
  "mcpServers": {
    "chrome": {
      "type": "stdio",
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest"]
    }
  }
}
```

If `.mcp.json` already exists, merge — don't overwrite.

### 7b. Tracker mode (optional)

Ask exactly once, near the end of the flow — after CLAUDE.md is drafted but before it's written:

> Task Tracking (optional): where do ACs live? `1. none` (default — ACs stay in `specs/requirements.md`) / `2. linear` / `3. jira` / `4. asana` / `5. custom` (copy `adapters/_template`). Enter 1–5; default 1.

If the user picks `1` or skips, do NOT emit a `## Task Tracking` section in CLAUDE.md — absence is the canonical form for `mode: none` (FR-29 AC-29.5). Continue to step 8.

If the user picks 2–5, run the flow in `docs/setup-tracker-mode.md` in full:

1. Verify `bun --version` ≥ 1.2; absence hard-stops mode recording with an NFR-10 canonical-shape error (AC-30.8).
2. Linear only: if `claude mcp list` contains `https://mcp.linear.app/sse`, offer the dry-run migration to V2 `https://mcp.linear.app/mcp` (AC-30.9). User decline is fine — they can skip migration and still proceed on V1 until the 2026-05-11 shutdown.
3. Detect the target MCP via `claude mcp list`. If absent, render a dry-run JSON diff of the proposed `mcpServers.<name>` entry and require explicit confirmation before writing `settings.json` (AC-30.1, AC-30.2, AC-30.3, DD-12.9).
4. Run a harmless test call (Linear `list_teams` / Jira empty `search` / Asana `list_workspaces`). On failure, surface an NFR-10 canonical-shape error and refuse to record mode — the project remains `mode: none` (AC-30.4, AC-30.5).
5. For Jira: pipe `GET /rest/api/3/field` response into `bun run adapters/jira/src/discover_field.ts` and record `jira_ac_field: customfield_XXXXX` in the section (AC-30.6).
6. For Asana: detect the workspace's status convention (section / custom_enum / completed_boolean) and record `asana_status_convention` (AC-30.7).
7. Append the `## Task Tracking` section to CLAUDE.md per Schema L with the resolved keys (one per line) and an empty `### Sync log` subsection.

See `docs/setup-tracker-mode.md` for the exact question prompt, canonical error shapes, JSON diff preview format, and migration wording. Do not inline those procedures here — NFR-1 keeps this skill under 300 lines.

### 8. Create specs (optional)

If the user wants the full SDD workflow (or if `$ARGUMENTS` contains "new"):
- Create `specs/` directory
- Create `specs/archive/` directory alongside it (empty — populated later by `/implement` Phase 4 auto-archival and `/spec-archive`, see FR-16/FR-19)
- Copy `${CLAUDE_PLUGIN_ROOT}/templates/spec-templates/archive-index.md.template` to `specs/archive/index.md` so the rolling archive index exists from day one with its `| Milestone | Title | Archived | Archive File |` header row
- Copy templates from `${CLAUDE_PLUGIN_ROOT}/templates/spec-templates/`
- **Pre-fill with concrete values** from what you already know — replace every placeholder you can with real data:
  - **requirements.md:** Project name, overview, detected stack. Fill the traceability matrix header rows with AC IDs from any existing requirements.
  - **technical-spec.md:** Actual directory structure (run `ls`), actual dependencies with pinned versions (from lock file or package manifest), module boundaries you can infer from the code
  - **testing-spec.md:** Exact test framework + version, mocking library, coverage tool, file naming convention (detected from existing tests or config), test directory path
  - **plan.md:** M1 skeleton for the foundation that setup just built, with concrete file paths and gate commands
- Leave requirements, acceptance criteria, and milestone tasks for the user — but everything else should be filled in, not left as `<!-- placeholder -->`

If the user didn't ask for specs, skip this step.

### 9. Verify

Run gate check commands to verify they all pass. If any fail, fix immediately — don't report a broken setup.

### 10. Offer to fill specs

If spec files were created, ask the user:

> "Spec templates are ready. Want me to help you fill them in now? I can walk you through defining requirements, technical decisions, and the implementation plan. (Run `/dev-process-toolkit:spec-write`)"

### 11. Report

Summarize what was created, then present the SDD workflow:

**Files created/modified:** list them.

**Your SDD Workflow:**

```
0. /brainstorm       → (Optional) Explore approaches before writing specs
1. Write specs       → specs/*.md (requirements first, then technical, testing, plan)
2. /implement        → Builds features with TDD + three-stage self-review (the main entry point)
3. /gate-check       → Verify quality gates pass
4. /debug            → Investigate failing tests or unclear gate failures
5. /spec-review      → Audit implementation against specs
6. /simplify         → Clean up changed code
7. /pr               → Create pull request
```

**Workflows** — choose the path that matches your task:

**Bugfix:** `/debug → /implement → /gate-check → /pr`
**Feature:** `/brainstorm → /spec-write → /implement → /spec-review → /gate-check → /pr`
**Refactor:** `/implement → /simplify → /gate-check → /pr`

**Next steps:**

If spec files were created:
1. Fill in `specs/requirements.md` — define what to build (functional requirements + acceptance criteria)
2. Fill in `specs/technical-spec.md` — define how to build it (architecture, data model, key patterns)
3. Fill in `specs/testing-spec.md` — define how to test it (conventions, coverage targets)
4. Fill in `specs/plan.md` — break work into milestones with task order
5. Run `/dev-process-toolkit:implement <milestone>` to start building

Or run `/dev-process-toolkit:spec-write` to have Claude guide you through filling specs interactively.

If no spec files were created:
1. Run `/dev-process-toolkit:implement <task description>` to build features
2. Add specs later if you want the full SDD workflow

**Key principle:** Specs are the source of truth. `/implement` reads specs to understand what to build, writes tests first, self-reviews against acceptance criteria, and reports for human approval before committing.

**For advanced configuration** (hooks, domain-specific checks, CI/CD), see the adaptation guide in the plugin docs.

## Rules

- Always ask for approval before creating or modifying files
- Never overwrite an existing CLAUDE.md without confirmation — offer to merge instead
- Generate real content based on what you detect, not empty templates
- The scaffolded project MUST pass gate-check before proceeding — fix any issues
