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

Before any detection or setup, run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` already exists and contains a `## Task Tracking` section, this is an existing tracker-mode project — `/setup --migrate` is the right entry point for changing modes (STE-14 AC-STE-14.1). If `CLAUDE.md` is absent, empty of `## Task Tracking`, or `$ARGUMENTS` contains `new` — and `$ARGUMENTS` does **not** contain `--migrate` or `--migrate-dry-run` — run the normal fresh-setup flow below. When `--migrate` is present, section 0b overrides this routing regardless of `## Task Tracking` presence (AC-STE-35.2).

### 0b. Migration invocation (`/setup --migrate` / `--migrate-dry-run`)

When `$ARGUMENTS` contains `--migrate` or `--migrate-dry-run`, skip steps 1–8 and route into **tracker-mode migration** (STE-14, M12) — handles all transitions between modes. Current mode is detected via Schema L probe (AC-STE-14.2): absence of `## Task Tracking` = `mode: none` (canonical form per AC-STE-8.5); presence = parse `mode: <value>`. All modes (including `none`) are valid starting states (AC-STE-35.1):

- Detect current mode via Schema L probe (AC-STE-14.2).
- Prompt for target mode; refuse no-op via NFR-10 canonical shape: `Detected current mode: <current>. Supported targets: <others>. Migration must change mode.` (AC-STE-35.5)
- Supported transitions: `none → <tracker>` / `<tracker> → none` / `<tracker> → <other>`. Unsupported = NFR-10 canonical refusal.
- Atomicity: CLAUDE.md `mode:` line never rewritten until migration succeeds (AC-STE-14.7/8).
- **Active-FR rename (M18 STE-60 AC-STE-60.6).** On any mode change, re-derive filenames for every active FR under `specs/frs/*.md` (not `archive/`) using the *target-mode* `Provider.filenameFor(spec)` and `git mv` each file to its new name. Archive is frozen by mode transitions — historical FRs keep whatever convention they had at archival time. Any self-referencing cross-link inside the moved file (rare — grep before committing) is rewritten in place. All renames + the CLAUDE.md `mode:` flip land in a single atomic commit so the repo is never left half-migrated.
v2 is the baseline layout — there is no `v1 → v2` migration path. Projects created before v1.13.0 can be ported by hand or recreated via `/setup new`; in-repo dogfooding has been v2 since M13.

Detailed tracker-mode migration procedures, atomicity guarantee, and partial-failure rollback prompt live inline in this section plus `docs/setup-tracker-mode.md` for the per-tracker detail — do not inline those procedures here (NFR-1). `git log` is the audit trail for who did what and when; there is no separate sync log.

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
| Spec anchor IDs (if `specs/` exists) | Grep `specs/plan.md` for every `## M{N}:` and `specs/requirements.md` for every `### FR-{N}:` heading; each must carry a matching `{#M{N}}` or `{#FR-{N}}` anchor on the same line | Add the missing `{#M{N}}` / `{#FR-{N}}` anchor to the heading. Missing anchors do NOT cause doctor failure — they report under `GATE PASSED WITH NOTES` so archival pointers stay stable (HG95VB) |

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

> Task Tracking (optional): where do ACs live? `1. none` (default — ACs stay in `specs/requirements.md`) / `2. linear` / `3. jira` / `4. custom` (copy `adapters/_template`). Enter 1–4; default 1.

If the user picks `1` or skips, do NOT emit a `## Task Tracking` section in CLAUDE.md — absence is the canonical form for `mode: none` (STE-8 AC-STE-8.5). Continue to step 8.

If the user picks 2–4, run the flow in `docs/setup-tracker-mode.md` in full:

1. Verify `bun --version` ≥ 1.2; absence hard-stops mode recording with an NFR-10 canonical-shape error (AC-STE-9.8).
2. Detect the target MCP via `claude mcp list`. If absent, render a dry-run JSON diff of the proposed `mcpServers.<name>` entry and require explicit confirmation before writing `settings.json` (AC-STE-9.1, AC-STE-9.2, AC-STE-9.3, DD-12.9).
3. Run a harmless test call (Linear `list_teams` / Jira empty `search`). On failure, surface an NFR-10 canonical-shape error and refuse to record mode — the project remains `mode: none` (AC-STE-9.4, AC-STE-9.5).
4. For Jira: pipe `GET /rest/api/3/field` response into `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/jira/src/discover_field.ts` and record `jira_ac_field: customfield_XXXXX` in the section (AC-STE-9.6).
5. Append the `## Task Tracking` section to CLAUDE.md per Schema L with the resolved keys (one per line).

See `docs/setup-tracker-mode.md` for the exact question prompt, canonical error shapes, and JSON diff preview format. Do not inline those procedures here — NFR-1 keeps this skill under 300 lines.

### 7c. Branch-naming template (STE-64)

Ask once, after Schema L has been drafted (or immediately, when 7b picked `mode: none` and no Schema L block will be emitted):

> Branch-naming template? (default: `<default-for-mode>`).

Default-for-mode: `{type}/m{N}-{slug}` in `mode: none`; `{type}/{ticket-id}-{slug}` in any tracker mode. Placeholders: `{type}` → `feat`/`fix`/`chore` (LLM-inferred); `{N}` → milestone number; `{ticket-id}` → tracker ID in tracker mode, short-ULID tail (lowercased) in `mode: none`; `{slug}` → 2–4 word kebab (LLM-inferred).

- Empty response ⇒ accept default.
- Non-empty response ⇒ use verbatim (`/implement` sanitizes LLM output at render time, so custom templates are safe).
- Write the resolved value as `branch_template: <value>` in the Schema L block (tracker-mode projects: append to existing keys). `mode: none` projects that elected `1` in step 7b: skip writing; branch automation stays disabled (AC-STE-64.1).

**Skip condition:** if the current CLAUDE.md already has `branch_template:` under `## Task Tracking`, do not re-ask. `/setup --migrate` preserves existing keys unless the user explicitly chooses to edit them.

See `docs/setup-tracker-mode.md` § Branch template for the long-form prompt and examples.

### 7d. Docs modes (STE-68)

Ask three yes/no prompts, in this exact order, after 7c:

1. `Generate user-facing docs (narrative + mermaid state/flow diagrams)?`
2. `Generate packages-style API reference docs? (typedoc <detected|not found>, ts-morph <bundled>, stack: <ts|other>)`
3. `Is CHANGELOG.md generated by CI (if yes, /ship-milestone will not write it)?`

Prompt 2 augments its default message with a signature-extraction probe result (AC-STE-72.6). Check `<projectRoot>/node_modules/.bin/typedoc` and `PATH` for `typedoc`; check `<projectRoot>/tsconfig.json` to decide the stack. The probe result is informational — whether typedoc is present does not change the prompt's default or accepted inputs, only the user's visibility into which strategy `/docs` will choose later (AC-STE-72.2).

Accept `y`/`n`/`yes`/`no` case-insensitively; other inputs re-prompt with the remedy `answer y or n` (AC-STE-68.1). If the project already has a `## Docs` section, show the current value inline on each prompt (e.g., `Generate user-facing docs? [current: true]`) and accept empty input as "keep current" (AC-STE-68.5).

If the user answers `no` to both prompts 1 and 2, refuse with NFR-10 canonical shape and re-ask only those two (changelog_ci_owned is preserved between retries):

```
/setup: at least one docs mode must be enabled to write the ## Docs section.
Remedy: answer yes to either "user-facing docs?" or "packages API refs?", or decline both to skip docs configuration entirely (the ## Docs section will not be written and /docs will be a no-op).
Context: mode=<tracker-mode>, skill=setup
```

If the user declines both on the re-ask, skip writing the section entirely — absent section ≡ all three `false` (AC-STE-68.3).

Write the resolved answers as a `## Docs` section in `CLAUDE.md`, placed immediately after `## Task Tracking` (or at end of file if no tracker section exists). Schema L format, lowercase literal `true`/`false`, no quoting:

```
## Docs

user_facing_mode: <true|false>
packages_mode: <true|false>
changelog_ci_owned: <true|false>
```

Re-run writes are atomic — read CLAUDE.md, splice the full `## Docs` block, write once (AC-STE-68.5).

See `docs/setup-docs-mode.md` for the full prompt wording, re-run display, and NFR-10 refusal format.

### 8. Create specs (optional)

If the user wants the full SDD workflow (or if `$ARGUMENTS` contains "new"):
- Create `specs/` directory plus `specs/frs/`, `specs/frs/archive/`, `specs/plan/`, `specs/plan/archive/` (the v2 layout — per-unit archival; no rolling index file).
- Copy cross-cutting templates from `${CLAUDE_PLUGIN_ROOT}/templates/spec-templates/` (`requirements.md`, `technical-spec.md`, `testing-spec.md`). Do not create or copy any `archive-index.md` file — v2 archival is `git mv` + frontmatter flip (STE-22); there is no index template.
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
