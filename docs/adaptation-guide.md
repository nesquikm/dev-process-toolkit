# Adaptation Guide

How to adapt the SDD toolkit for your specific project and tech stack.

> **Plugin users:** If you installed the plugin, run `/dev-process-toolkit:setup` — it automates most of these steps. This guide is for manual setup or for understanding what the setup skill does.

## Step 1: Identify Your Gate Commands

The most important adaptation is mapping gate check commands to your toolchain.

| Stack | Typecheck | Lint | Test | Build |
|-------|-----------|------|------|-------|
| TypeScript/Node | `npm run typecheck` | `npm run lint` | `npm run test` | `npm run build` |
| Flutter/Dart | `fvm flutter analyze` | (included in analyze) | `fvm flutter test` | (included in run) |
| Python | `mypy .` | `ruff check .` | `pytest` | — |
| Go | `go vet ./...` | `golangci-lint run` | `go test ./...` | `go build ./...` |
| Rust | `cargo check` | `cargo clippy` | `cargo test` | `cargo build` |
| Java/Kotlin | `./gradlew compileJava` | `./gradlew spotlessCheck` | `./gradlew test` | `./gradlew build` |

Update `gate-check/SKILL.md` and `tdd/SKILL.md` with your project's commands.

## Step 2: Set Up CLAUDE.md

Use `templates/CLAUDE.md.template` as a starting point. Key sections:

1. **Project overview** — What this project is (1-2 sentences)
2. **Tech stack** — Languages, frameworks, tools
3. **Architecture** — Directory structure and key patterns
4. **Commands** — Build, test, lint, run
5. **Key patterns** — How code is organized (state management, API layer, etc.)
6. **Testing conventions** — Test framework, mocking approach, naming
7. **DO NOT** — Explicit boundaries for Claude

## Step 3: Adapt the /implement Skill

The `/implement` skill is the main orchestrator. Adapt it by changing:

### Input source
- **GitHub issues**: Use `gh issue view $ARGUMENTS`
- **Task files**: Read `.tasks/$ARGUMENTS.md`
- **Inline description**: Use `$ARGUMENTS` directly
- **Spec milestones**: Read `specs/plan.md`

### TDD patterns
- **TS/Node**: `vi.useFakeTimers()`, Vitest, seed-based data
- **Flutter**: `mocktail`, `bloc_test`, mirror `lib/` in `test/`
- **Python**: `pytest`, `unittest.mock`, fixtures

### Domain-specific review checks
Add checks specific to your stack in the self-review phase:

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

### Standard (projects with specs or issues)
- `/gate-check`
- `/tdd`
- `/implement` — End-to-end feature implementation
- `/simplify` — Code quality cleanup after features
- `/pr` — Pull request creation

### Full SDD (spec-driven projects)
- `/gate-check`
- `/tdd`
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

### CI/CD integration
- Gate check commands should mirror CI pipeline
- PR skill can add CI status checks
- Hook into pre-commit for automated gate checks
