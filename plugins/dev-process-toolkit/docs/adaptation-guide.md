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

Agents are specialist personas spawned by Claude via the `Agent` tool. As of v1.12.0 the plugin ships exactly one agent:

- **code-reviewer** — The canonical code review rubric (quality, security, patterns, stack-specific). `/implement` Phase 3 Stage B delegates to it via explicit `Agent`-tool invocation — see `docs/skill-anatomy.md` § Subagent Execution for the concrete example. `/gate-check` also references `agents/code-reviewer.md` as its rubric source, but runs the review inline so the verdict returns in one turn. Spec-compliance checks are **not** code-reviewer's job — `/spec-review` owns AC→code traceability.

Agents live in `.claude/agents/` (or `plugins/<plugin>/agents/` for plugins) and need `name` and `description` in frontmatter, a domain expertise description, and an explicit return shape so the calling skill can parse findings deterministically.

To add project-specific agents, follow the same pattern: give them a focused rubric, a machine-parseable return shape, and a single canonical home — then have skills delegate to them via `Agent`-tool invocations rather than inlining the rubric in multiple places.

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

Completed milestones are auto-archived when `/implement` Phase 4 is approved (STE-22). Every FR belonging to the milestone is moved from `specs/frs/<name>.md` to `specs/frs/archive/<name>.md` via `git mv` — the base `<name>` is whatever `Provider.filenameFor(spec)` returns (tracker ID in tracker mode, short-ULID tail in `mode: none`) and the stem is preserved across the move. The frontmatter `status: active → archived` + `archived_at` flip lands in the same commit; the milestone's plan file is moved from `specs/plan/<M#>.md` to `specs/plan/archive/<M#>.md`. There is no rolling index file — per-unit archives are their own index, addressable directly by tracker ID, short-ULID tail, or milestone ID.

### Opting out entirely

If you don't want archival, delete `specs/frs/archive/` and `specs/plan/archive/` (or never create them). `/implement` Phase 4 will run the archival step anyway, which recreates those directories on first archival. Opting out cleanly is not a first-class feature of the v2 layout — the v2 mechanism is `git mv` between sibling directories, not an optional write. Projects that want `plan.md` / `requirements.md` style monoliths should stay on pre-M13 releases (v1.15.x).

### Manual archival via `/spec-archive`

For content the auto-path can't reach — reopened milestones, cross-cutting FRs, aborted work you want to preserve, explicit user-directed compaction — use `/dev-process-toolkit:spec-archive <ULID>` or `/dev-process-toolkit:spec-archive M<N>` (milestone group) or `/dev-process-toolkit:spec-archive LIN-1234` (tracker ref → resolves to the bound ULID). The skill shows a diff before touching any file and waits for explicit approval; it never auto-scans for completed work.

See `skills/spec-archive/SKILL.md` for the full protocol, including the reopen path (move the file back from `specs/frs/archive/` and flip frontmatter status) and the `technical-spec.md` "supersede-in-place, never archive" rule.

### Adjusting the archive directory layout

The default v2 layout is flat per-unit: archived FRs at `specs/frs/archive/<name>.md` (stem preserved from the active location — see M18 STE-60 for the `<name>` shape), archived milestones at `specs/plan/archive/M<N>.md`. Changing this layout is out of scope — `/implement` and `/spec-archive` hardcode the pattern. If you need a different layout (nested by year, split by source file), file an issue or fork the skills.

These are **starting points** — adapt them to your project's specific tools and versions.
