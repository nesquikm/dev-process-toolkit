# Adaptation Guide

How to adapt the SDD toolkit for your specific project and tech stack.

> Run `/dev-process-toolkit:setup` to configure your project automatically. This guide is a reference for what `/setup` does and how to customize the configuration afterward.

## Step 1: Configure Your Gate Commands

The most important adaptation is mapping gate check commands to your toolchain. `/setup` writes these into your project's CLAUDE.md under the "Key Commands" section. To customize, edit your CLAUDE.md directly.

| Stack | Typecheck | Lint | Test | Build |
|-------|-----------|------|------|-------|
| TypeScript/Node | `npm run typecheck` | `npm run lint` | `npm run test` | `npm run build` |
| Flutter/Dart | `fvm flutter analyze` | (included in analyze) | `fvm flutter test` | (included in run) |
| Python | `mypy .` | `ruff check .` | `pytest` | — |
| Go | `go vet ./...` | `golangci-lint run` | `go test ./...` | `go build ./...` |
| Rust | `cargo check` | `cargo clippy` | `cargo test` | `cargo build` |
| Java/Kotlin | `./gradlew compileJava` | `./gradlew spotlessCheck` | `./gradlew test` | `./gradlew build` |

Skills like `/gate-check` and `/tdd` read these commands from your CLAUDE.md at runtime.

## Step 2: Set Up CLAUDE.md

Use `templates/CLAUDE.md.template` as a starting point. Key sections:

1. **Project overview** — What this project is (1-2 sentences)
2. **Tech stack** — Languages, frameworks, tools
3. **Architecture** — Directory structure and key patterns
4. **Commands** — Build, test, lint, run
5. **Key patterns** — How code is organized (state management, API layer, etc.)
6. **Testing conventions** — Test framework, mocking approach, naming
7. **DO NOT** — Explicit boundaries for Claude

## Step 3: Customize /implement Behavior

The `/implement` skill reads configuration from your CLAUDE.md at runtime. Customize by adding these sections to your CLAUDE.md:

### Input source
`/implement` auto-detects the input source in this order:
- **Spec milestones**: Read `specs/plan.md`
- **GitHub issues**: Use `gh issue view $ARGUMENTS`
- **Task files**: Read `.tasks/$ARGUMENTS.md`
- **Inline description**: Use `$ARGUMENTS` directly

### TDD patterns
Document your testing conventions in CLAUDE.md so `/implement` and `/tdd` follow them:
- **TS/Node**: `vi.useFakeTimers()`, Vitest, seed-based data
- **Flutter**: `mocktail`, `bloc_test`, mirror `lib/` in `test/`
- **Python**: `pytest`, `unittest.mock`, fixtures

### Domain-specific review checks
`/implement` reads domain-specific checks from your CLAUDE.md during self-review. Common patterns:

- **Flutter**: `const` constructors, `BlocProvider` usage, codegen files not edited
- **MCP server**: Response format compliance, tool registration
- **Web SPA**: URL state management, accessibility
- **API server**: Input validation, error responses, auth checks

## Step 4: Write Specs (If Using Full SDD)

If you want the full SDD workflow, create specs:

```
specs/
├── requirements.md     # Functional requirements with acceptance criteria
├── technical-spec.md   # Architecture decisions and patterns
├── testing-spec.md     # Test conventions and coverage targets
└── plan.md             # Milestones with task order
```

See `templates/spec-templates/` for starter templates.

If you're adding SDD to an existing project, start with just `plan.md` to define milestones for new features. You can back-fill other specs later.

## Step 5: Choose Your Skill Set

Not every project needs every skill. Here's a recommended progression:

### Minimum viable (any project)
- `/gate-check` — Deterministic quality gate
- `/tdd` — RED → GREEN → VERIFY cycle
- `/debug` — Structured debugging when gate or tests fail

### Standard (projects with specs or issues)
- `/gate-check`
- `/tdd`
- `/debug`
- `/implement` — End-to-end feature implementation
- `/simplify` — Code quality cleanup after features
- `/pr` — Pull request creation

### Full SDD (spec-driven projects)
- `/brainstorm` — Pre-spec design session for open-ended features
- `/spec-write` — Guided spec authoring
- `/gate-check`
- `/tdd`
- `/debug`
- `/implement`
- `/spec-review` — Compliance audit
- `/visual-check` — UI verification (web projects)
- `/simplify`
- `/pr`

### Domain-specific additions
- **Flutter**: `/codegen`, `/build-run`, `/l10n`, `/feature-scaffold`, `/bump-version`
- **MCP servers**: `/tool-review`
- **Web SPA**: `/visual-check`

## Step 6: Configure Agents (Optional)

Agents are specialist personas spawned by Claude for specific tasks. Common agents:

- **code-reviewer** — Reviews code quality and pattern compliance
- **test-writer** — Writes tests following project conventions
- **debugger** — Investigates and fixes issues

Agents go in `.claude/agents/` and need:
- `name` and `description` in frontmatter
- Domain expertise description
- Step-by-step methodology
- Output format specification

## Step 7: Configure Settings

In `.claude/settings.json`, add tool permissions that your skills need:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(git *)",
      "Bash(gh *)"
    ]
  }
}
```

See `examples/` for stack-specific permission lists.

## Step 8: Configure Hooks (Optional)

Hooks run shell commands in response to Claude Code events. They're defined in `.claude/settings.json` under `"hooks"`. Common patterns from real projects:

### Block editing protected files

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$CLAUDE_TOOL_INPUT\" | grep -q '\"specs/\\|.g.dart\\|.freezed.dart'; then echo 'BLOCKED: Do not edit spec files or generated code' >&2 && exit 2; fi"
          }
        ]
      }
    ]
  }
}
```

### Auto-format after edits

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "FILE=$(echo \"$CLAUDE_TOOL_INPUT\" | grep -o '\"file_path\":\"[^\"]*\"' | cut -d'\"' -f4); if [[ \"$FILE\" == *.dart ]]; then dart format \"$FILE\"; fi"
          }
        ]
      }
    ]
  }
}
```

### Remind to run gate check on stop

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Reminder: run /gate-check before committing'"
          }
        ]
      }
    ]
  }
}
```

Adapt the matchers and commands to your stack.

Other useful hook events include `SessionStart`, `UserPromptSubmit`, `SubagentStop`, and `PostToolUseFailure`. See the full hooks reference: https://code.claude.com/docs/en/hooks

## Common Adaptations

### Monorepo
- Use package-level `.claude/skills/` directories for package-specific skills
- Scope gate checks to the relevant package
- Claude auto-discovers skills from nested directories

### No specs (existing project)
- Skip spec-review, use implement without spec references
- Use /gate-check and /tdd as standalone tools
- Gradually add specs for new features

## CI/CD Parity

Keep your gate-check commands in sync with your CI pipeline so that local checks match what CI enforces.

### Principle

The gate-check commands in CLAUDE.md and `/gate-check` should be **identical** to (or a strict subset of) what your CI pipeline runs. If CI runs additional checks (e.g., integration tests, deploy previews), that's fine — but everything gate-check runs locally must also run in CI.

### How to Sync

1. **Start from CI** — Define your CI pipeline first, then extract the check commands into CLAUDE.md's gating rule
2. **Single source** — Keep the command list in CLAUDE.md and reference it from both `/gate-check` and your CI config
3. **Version-lock tools** — Pin linter/formatter versions in both environments to avoid drift (e.g., `ruff==0.4.0` locally and in CI)
4. **Test locally** — Run `act` (GitHub Actions) or equivalent to test CI configs locally before pushing

### Starter Configs

See `examples/` for GitHub Actions starter configs:
- `examples/typescript-node/.github/workflows/gate-check.yml`
- `examples/python/.github/workflows/gate-check.yml`
- `examples/flutter-dart/.github/workflows/gate-check.yml`

## Customizing Archival

As of v1.10.0 (FR-16 through FR-20), completed milestones are auto-archived out of live spec files into `specs/archive/` when `/implement` Phase 4 is approved. This keeps `plan.md` and `requirements.md` size bounded regardless of project age. The archival mechanism is fully opt-in and fully overridable.

### Opting out entirely

Delete `specs/archive/` from your project (or never create it). `/implement` Phase 4 checks for the directory before doing any archival work and **silently skips** archival if it's missing (AC-16.7). Your specs stay whole, nothing moves, and no pointers are written. This is the right choice for small projects, short-lived experiments, or any situation where you don't want the extra directory.

If you opted out initially and want to opt in later, run `/dev-process-toolkit:setup` again or create the directory manually:

```bash
mkdir -p specs/archive
cp ${CLAUDE_PLUGIN_ROOT}/templates/spec-templates/archive-index.md.template specs/archive/index.md
```

Subsequent `/implement` runs will pick it up automatically.

### Manual archival via `/spec-archive`

For content the auto-path can't reach — reopened milestones, cross-cutting ACs not tied to a single milestone, aborted work you want to preserve, explicit user-directed compaction — use `/dev-process-toolkit:spec-archive {#M3}` (or `{#FR-7}`, or an explicit heading string). The skill shows you a diff before touching any file and waits for explicit approval. It never auto-scans for completed work — you name what to archive.

See `skills/spec-archive/SKILL.md` for the full protocol, including the reopen/revision naming rule (`M{N}-r2-{slug}.md`) and the `technical-spec.md` archival warning.

### Adjusting the archive directory layout

The default layout is flat: `specs/archive/M{N}-{slug}.md` for milestones, plus a single `specs/archive/index.md` rolling index. Changing this layout is out of scope for v1.10.0 — the `/implement` and `/spec-archive` skills hardcode the pattern. If you need a different layout (e.g., nested by year, split by source file), file an issue or fork the skills.

These are **starting points** — adapt them to your project's specific tools and versions.
