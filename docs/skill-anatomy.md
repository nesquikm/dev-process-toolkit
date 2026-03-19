# Anatomy of Claude Code Skills

## What Skills Are

Skills are markdown files with YAML frontmatter that extend Claude Code's capabilities. They live in `.claude/skills/<name>/SKILL.md` and can be invoked with `/name` or triggered automatically by Claude when relevant.

Skills follow the [Agent Skills](https://agentskills.io) open standard, which works across multiple AI tools. Claude Code extends the standard with additional features like invocation control, subagent execution, and dynamic context injection.

## File Structure

```
.claude/skills/<skill-name>/
├── SKILL.md           # Main instructions (required)
├── references/        # Supporting docs (optional)
│   └── patterns.md    # Loaded on demand
├── templates/         # Templates for Claude to fill
└── scripts/           # Scripts Claude can execute
```

## Frontmatter Fields

```yaml
---
name: my-skill                    # Display name, becomes /my-skill
description: What it does         # Claude uses this to decide relevance
argument-hint: '<arg> [optional]' # Shown in autocomplete
disable-model-invocation: true    # Only user can trigger (not Claude)
user-invocable: false             # Only Claude can trigger (hidden from / menu)
allowed-tools: Read, Grep, Glob   # Tool restrictions when skill is active
model: sonnet                     # Model override
context: fork                     # Run in a subagent
agent: Explore                    # Which subagent type (with context: fork)
---
```

## Skill Types in the SDD Toolkit

### 0. Setup (project onboarding)
- **Purpose**: Detect stack, generate CLAUDE.md, configure settings, create spec files
- **Invocation**: User-invoked once when setting up a project
- **Key pattern**: Reads templates from plugin directory, adapts to detected toolchain

### 0b. Spec Write (guided spec authoring)
- **Purpose**: Walk the user through filling in spec files in precedence order
- **Invocation**: User-invoked after setup, before implementation
- **Key pattern**: Interactive Q&A to extract requirements, then generates structured specs

### 1. Gate Check (deterministic quality gate)
- **Purpose**: Run typecheck + lint + test and report pass/fail
- **Invocation**: User-invoked after completing work
- **Key pattern**: Deterministic — no LLM judgment, just command results

### 2. Implement (end-to-end orchestrator)
- **Purpose**: Full feature lifecycle from understanding → TDD → review → handoff
- **Invocation**: User-invoked with task reference
- **Key pattern**: 4-phase pipeline with bounded self-review loop

### 3. TDD (micro-cycle)
- **Purpose**: RED → GREEN → VERIFY for a single test/feature
- **Invocation**: User-invoked or called within /implement
- **Key pattern**: Write test first, implement, verify gates

### 4. Spec Review (compliance audit)
- **Purpose**: Check implementation against spec requirements
- **Invocation**: User-invoked or within /implement
- **Key pattern**: Read-only analysis with traceability matrix

### 5. Visual Check (UI verification)
- **Purpose**: Verify web UI renders correctly in a real browser
- **Invocation**: User-invoked or within /implement (for web milestones)
- **Key pattern**: Delegates to a rubber duck MCP with Chrome tools

### 6. PR (pull request creation)
- **Purpose**: Create a well-formatted PR from current changes
- **Invocation**: User-invoked
- **Key pattern**: Analyze changes, format description, push

### 7. Simplify (code quality cleanup)
- **Purpose**: Review recently changed files for reuse, quality, and efficiency issues
- **Invocation**: User-invoked after completing a feature
- **Key pattern**: Minimal, focused fixes on changed files only — then re-gate

## String Substitutions

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | All arguments passed after `/skill-name` |
| `$ARGUMENTS[N]` or `$N` | Specific argument by index |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Directory containing the SKILL.md |

## Dynamic Context Injection

Use `` !`command` `` to run shell commands before the skill content is sent to Claude:

```yaml
## Current git status
!`git status --short`

## Recent changes
!`git log --oneline -5`
```

## Subagent Execution

Add `context: fork` to run a skill in isolation (separate context, no conversation history):

```yaml
---
context: fork
agent: Explore    # Built-in: Explore, Plan, general-purpose, or a custom name from .claude/agents/
---
```

## Agents vs Skills

| Aspect | Skills | Agents |
|--------|--------|--------|
| Location | `.claude/skills/` | `.claude/agents/` |
| Invocation | `/name` or auto | Spawned by Claude via Agent tool |
| Context | Inline or forked | Always separate |
| Purpose | Task instructions | Specialist personas |
| User-facing | Yes (slash command) | No (Claude decides) |
| Tool restriction field | `allowed-tools` | `tools` (also `disallowedTools`) |
| Optional fields | `model`, `context`, `agent`, `hooks` | `model`, `color`, `maxTurns`, `permissionMode`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `isolation` |

See the official docs for the full list of agent fields: https://code.claude.com/docs/en/sub-agents

## Best Practices

1. **Keep SKILL.md under 500 lines** — move reference material to separate files
2. **Use `disable-model-invocation: true`** for skills with side effects (deploy, commit, PR)
3. **Use `allowed-tools`** to restrict what Claude can do (e.g., read-only for review skills)
4. **Reference supporting files** so Claude knows when to load them
5. **Include clear phase structure** — skills with phases are easier for Claude to follow
6. **Make decisions deterministic** — binary ACs, gate checks, bounded loops

## References

- **Skills**: https://code.claude.com/docs/en/skills
- **Sub-agents**: https://code.claude.com/docs/en/sub-agents
- **Hooks**: https://code.claude.com/docs/en/hooks
- **Settings**: https://code.claude.com/docs/en/settings
