---
name: setup
description: Set up SDD/TDD development process for the current project. Creates CLAUDE.md, configures settings, and optionally creates spec files. Use when starting a new project or adding process to an existing one.
disable-model-invocation: true
argument-hint: '[new or existing]'
---

# Project Setup

Set up the Spec-Driven Development and TDD workflow for this project.

## Process

### 1. Detect the project

Check for project files (`package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc.) and source directories.

If **no project files are found** (empty directory or only basic files), this is a new project — go to step 2.

If project files exist, skip to step 3.

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

### 8. Create specs (optional)

If the user wants the full SDD workflow (or if `$ARGUMENTS` contains "new"):
- Create `specs/` directory
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
1. Write specs       → specs/*.md (requirements first, then technical, testing, plan)
2. /implement        → Builds features with TDD + self-review (the main entry point)
3. /gate-check       → Verify quality gates pass
4. /spec-review      → Audit implementation against specs
5. /simplify         → Clean up changed code
6. /pr               → Create pull request
```

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
