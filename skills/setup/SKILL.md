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

Examine the current project to determine:
- **Language and framework** — Check for `package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `build.gradle`, etc.
- **Existing toolchain** — What test runner, linter, and typecheck commands are available
- **Project structure** — Source directory layout (`src/`, `lib/`, `app/`, etc.)
- **Existing CLAUDE.md** — If one exists, read it to understand current conventions
- **New vs existing** — Is there source code already, or is this a fresh project?

### 2. Handle new projects

If the project is empty or has no toolchain:

1. **Ask what stack the user wants** (TypeScript/Node, Flutter/Dart, Python, Go, etc.)
2. **Offer to scaffold the toolchain** — propose specific commands to initialize:
   - TypeScript/Node: `npm init -y`, install `typescript`, `vitest`, `eslint`, create `tsconfig.json`
   - Flutter/Dart: `flutter create`, add `bloc_test` and `mocktail` to dev dependencies
   - Python: `uv init` or `poetry init`, install `pytest`, `mypy`, `ruff`
   - Go: `go mod init`, install `golangci-lint`
3. **Run the initialization** after user approval
4. **Continue to step 3** once the toolchain is in place

### 3. Read the templates

Load the reference material from the plugin directory:
- `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.template` — Base template for CLAUDE.md
- `${CLAUDE_PLUGIN_ROOT}/examples/` — Stack-specific gate commands and patterns
- `${CLAUDE_PLUGIN_ROOT}/docs/adaptation-guide.md` — For reference on what to configure

Match the detected stack to the closest example in `${CLAUDE_PLUGIN_ROOT}/examples/` (typescript-node, flutter-dart, or python). For other stacks, use the adaptation guide's gate command table.

### 4. Present the plan

Show the user what you'll create and ask for approval:
- **CLAUDE.md** — With their project's actual commands, patterns, and conventions filled in
- **.claude/settings.json** — With tool permissions for their stack (or merge into existing)
- **specs/** (optional) — Spec file templates if they want the full SDD workflow

### 5. Generate CLAUDE.md

Create `CLAUDE.md` in the project root based on the template, filling in:
- Project name and description
- Detected tech stack
- Actual directory structure (from the project, not the template example)
- Real gate commands for their stack
- Key patterns (infer from existing code, or leave as TODOs for the user to fill in)
- Testing conventions (detected from existing tests, or from the stack example)
- DO NOT section with sensible defaults

**Important:** Generate real content, not template placeholders. If you can detect the test framework from config files, write it. If you can see the directory structure, document it. Only leave `<!-- TODO -->` markers for things you genuinely can't determine.

### 6. Configure settings

Create or update `.claude/settings.json` with tool permissions appropriate for the stack. Use the examples from `${CLAUDE_PLUGIN_ROOT}/examples/` as reference.

If `.claude/settings.json` already exists, merge permissions — don't overwrite existing settings.

### 7. Create specs (optional)

If the user wants the full SDD workflow (or if `$ARGUMENTS` contains "new"):
- Create `specs/` directory
- Copy spec templates from `${CLAUDE_PLUGIN_ROOT}/templates/spec-templates/`
- **Pre-fill aggressively** based on what you already know from detection:
  - **requirements.md:** Fill in project name, overview, and detected stack in the Overview section
  - **technical-spec.md:** Fill in architecture (detected directory structure), dependencies (from package.json/pubspec.yaml/pyproject.toml with versions), key design decisions based on detected patterns
  - **testing-spec.md:** Fill in test framework, mocking library, coverage tool, file naming convention, and test structure — all detectable from config files and the stack example
  - **plan.md:** Create an M1 skeleton for foundation/scaffolding based on what setup just built
- Leave requirements, acceptance criteria, and milestone tasks for the user to fill in — those require domain knowledge

If the user has an existing project and didn't ask for specs, skip this step.

### 8. Verify

Run the gate check commands you configured to verify they work:
- If all pass: report success
- If any fail: explain what needs to be fixed (missing dependencies, wrong commands, etc.)

### 9. Report

Summarize what was created, then present the SDD workflow:

**Files created/modified:** list them.

**Your SDD Workflow:**

```
1. Write specs     → Fill in specs/*.md (requirements first, then technical, testing, plan)
2. /implement      → Builds features with TDD + self-review (the main entry point)
3. /gate-check     → Verify quality gates pass
4. /spec-review    → Audit implementation against specs
5. /simplify       → Clean up changed code
6. /pr             → Create pull request
```

**Next steps:**

If spec files were created:
1. Fill in `specs/requirements.md` — define what to build (functional requirements + acceptance criteria)
2. Fill in `specs/technical-spec.md` — define how to build it (architecture, data model, key patterns)
3. Fill in `specs/testing-spec.md` — define how to test it (conventions, coverage targets)
4. Fill in `specs/plan.md` — break work into milestones with task order
5. Run `/dev-process-toolkit:implement <milestone>` to start building

If no spec files were created (existing project, lightweight setup):
1. Run `/dev-process-toolkit:implement <task description>` to build features
2. Add specs later if you want the full SDD workflow

**Key principle:** Specs are the source of truth. `/implement` reads specs to understand what to build, writes tests first, self-reviews against acceptance criteria, and reports for human approval before committing.

**For advanced configuration** (hooks, domain-specific checks, CI/CD integration), see the adaptation guide in the plugin docs.

## Rules

- Always ask for approval before creating or modifying files
- Never overwrite an existing CLAUDE.md without confirmation — offer to merge instead
- Generate real content based on what you detect, not empty templates
