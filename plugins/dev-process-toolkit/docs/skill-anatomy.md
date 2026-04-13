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
name: my-skill                    # Display name, becomes /my-skill. Lowercase, hyphens, max 64 chars.
description: What it does         # Claude uses this to decide relevance. Under 250 chars; front-load the key use case.
argument-hint: '<arg> [optional]' # Shown in autocomplete
disable-model-invocation: true    # Only user can trigger (not Claude/subagents). Reserve for bootstrap-style skills that rewrite project scaffolding (e.g., /setup). Avoid on composable skills — it blocks legitimate agent-team composition.
user-invocable: false             # Only Claude can trigger (hidden from / menu). Use for background knowledge.
allowed-tools: Read, Grep, Glob   # Tool restrictions when skill is active
model: sonnet                     # Model override
effort: low                       # Effort level: low, medium, high, max (Opus 4.6 only). Overrides session default.
context: fork                     # Run in a subagent
agent: Explore                    # Which subagent type (with context: fork)
hooks: ...                        # Hooks scoped to this skill's lifecycle
paths: "src/**/*.ts"              # Glob patterns: skill auto-activates only when working with matching files
shell: bash                       # Shell for !`command` blocks: bash (default) or powershell
---
```

**Invocation matrix:**

| Frontmatter                      | You can invoke | Claude can invoke | When loaded into context                                     |
| :------------------------------- | :------------- | :---------------- | :----------------------------------------------------------- |
| (default)                        | Yes            | Yes               | Description always in context, full skill loads when invoked |
| `disable-model-invocation: true` | Yes            | No                | Description not in context, full skill loads when you invoke |
| `user-invocable: false`          | No             | Yes               | Description always in context, full skill loads when invoked |

## Skill Types in the SDD Toolkit

### 0. Setup (project onboarding)
- **Purpose**: Detect stack, generate CLAUDE.md, configure settings, create spec files
- **Invocation**: User-invoked once when setting up a project
- **Key pattern**: Reads templates from plugin directory, adapts to detected toolchain

### 0b. Brainstorm (pre-spec design session)
- **Purpose**: Socratic exploration of approaches before writing specs; gets design approval
- **Invocation**: User-invoked before spec-write, for features with open solution spaces
- **Key pattern**: One clarifying question at a time → 2–3 approaches with tradeoffs → approved design

### 0c. Spec Write (guided spec authoring)
- **Purpose**: Walk the user through filling in spec files in precedence order
- **Invocation**: User-invoked after setup (or after brainstorm), before implementation
- **Key pattern**: Interactive Q&A to extract requirements, then generates structured specs

### 1. Gate Check (deterministic quality gate)
- **Purpose**: Run typecheck + lint + test, review changed code, and report a verdict with actual output
- **Invocation**: User-invoked after completing work
- **Key pattern**: Commands are deterministic (always override LLM judgment); code review is an advisory layer that can elevate concerns but can't downgrade a failing command

### 2. Implement (end-to-end orchestrator)
- **Purpose**: Full feature lifecycle from understanding → TDD → three-stage review → handoff
- **Invocation**: User-invoked with task reference
- **Key pattern**: 4-phase pipeline with three-stage bounded self-review loop (spec compliance → code quality → hardening)

### 3. TDD (micro-cycle)
- **Purpose**: RED → GREEN → VERIFY for a single test/feature
- **Invocation**: User-invoked or called within /implement
- **Key pattern**: Write test first, implement, verify gates

### 4. Debug (structured debugging protocol)
- **Purpose**: Systematic investigation of failing tests or gate check failures
- **Invocation**: User-invoked or referenced from /tdd and /gate-check when failure cause is unclear
- **Key pattern**: 4-phase protocol — Root Cause → Pattern Analysis → Hypothesis Testing → Implementation; 3-fix escalation rule

### 5. Spec Review (compliance audit)
- **Purpose**: Check implementation against spec requirements
- **Invocation**: User-invoked or within /implement (Stage A of self-review)
- **Key pattern**: Read-only analysis with traceability matrix

### 5b. Spec Archive (manual archival escape hatch)
- **Purpose**: Move a user-selected milestone, FR, or AC block out of live specs into `specs/archive/` with a diff approval gate (FR-17)
- **Invocation**: User-invoked for reopens, cross-cutting ACs, aborted work, or explicit compaction; never auto-scans
- **Key pattern**: Resolve anchor target → build Schema G archive body → present diff → wait for approval → write-then-excise → append index row; reopens produce `-r2` / `-r3` revision files

### 6. Visual Check (UI verification)
- **Purpose**: Verify web UI renders correctly in a real browser
- **Invocation**: User-invoked or within /implement (for web milestones)
- **Key pattern**: Delegates to a rubber duck MCP with Chrome tools

### 7. PR (pull request creation)
- **Purpose**: Create a well-formatted PR from current changes
- **Invocation**: User-invoked
- **Key pattern**: Analyze changes, format description, push

### 8. Simplify (code quality cleanup)
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

There are two ways to run work in a separate context (isolated from the parent skill's conversation history): **explicit `Agent`-tool invocation from inside a skill body** (the pattern this plugin actually uses) and **`context: fork` frontmatter** (a documented alternative that this plugin does not exercise).

### Explicit `Agent`-tool invocation (reference implementation)

This is how `/implement` Phase 3 Stage B delegates to `code-reviewer`. The skill body tells Claude to invoke the `Agent` tool with a named subagent, a prompt built from runtime context, and an expected return shape that the caller parses to make a decision.

Minimal example, adapted from `skills/implement/SKILL.md` Stage B. The real Stage B template also passes the Phase 1 AC checklist as context and tells the subagent "Do NOT check spec compliance — /spec-review owns that"; those lines are stripped here for clarity but should be included verbatim when copying the pattern for a new delegation point.

```markdown
d. **Invoke `code-reviewer` via the `Agent` tool** with a prompt built from this template:

   \```
   Review the changes in this branch against the code-reviewer rubric (quality, security, patterns, stack-specific).

   Changed files (name + status):
   <paste output of: git diff --name-status <base-ref>>

   Return findings in the shape documented at the bottom of agents/code-reviewer.md.
   \```

e. **Expected return shape** — one line per criterion, `<criterion> — OK` or `<criterion> — CONCERN: file:line — <reason>`, ending with `OVERALL: OK` or `OVERALL: CONCERNS (N)`. Integrate:
   - `OVERALL: OK` → continue
   - `OVERALL: CONCERNS` → fix each concern and re-invoke
   - Subagent errors or unparseable shape → fall back to running the rubric inline
```

Why this pattern: the skill author has explicit control over the prompt and the return shape, the caller parses a deterministic format instead of free-form text, and the fallback path (run inline if delegation fails) is explicit. The delegated agent lives in `.claude/agents/<name>.md` (or `plugins/<plugin>/agents/<name>.md`) and documents its own return shape.

**Sequential multi-pass variant.** `/implement` Phase 3 Stage B uses this primitive twice in a row (Pass 1 — Spec Compliance, Pass 2 — Code Quality) with two different prompts against the same subagent, a fail-fast rule between them, and a literal skipped-pass reporting line when Pass 1 finds critical findings. See `skills/implement/SKILL.md` § Stage B for the full template and `agents/code-reviewer.md` § Pass-Specific Return Contracts for the two prompt shapes. When you need different scrutiny levels on the same diff, the multi-pass variant lets you order them deterministically (cheapest gate first) instead of conflating them into one prompt.

### Alternative — `context: fork` (unexercised in this plugin as of v1.12.0)

Add `context: fork` to the skill frontmatter to run the whole skill in a forked context:

```yaml
---
context: fork
agent: Explore    # Built-in: Explore, Plan, general-purpose, or a custom name from .claude/agents/
---
```

As of v1.12.0, **0 of 12 skills in this plugin use this frontmatter** — the failure modes and prompt-passing ergonomics are not road-tested here. Prefer the explicit `Agent`-tool invocation pattern above for new delegation points. `context: fork` remains documented for readers adapting the plugin to other contexts where whole-skill forking is a better fit.

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
2. **Reserve `disable-model-invocation: true` for bootstrap skills** — use it on skills that rewrite project scaffolding (e.g., `/setup`) where a subagent re-running the skill mid-flight would clobber the working tree. Do **not** use it on composable skills like `/implement` or `/pr`; the flag blocks agent-team subagents from invoking them via the `Skill` tool, forcing the leaky workaround of reading `SKILL.md` body manually.
3. **Use `allowed-tools`** to restrict what Claude can do (e.g., read-only for review skills)
4. **Reference supporting files** so Claude knows when to load them
5. **Include clear phase structure** — skills with phases are easier for Claude to follow
6. **Make decisions deterministic** — binary ACs, gate checks, bounded loops

## References

- **Skills**: https://code.claude.com/docs/en/skills
- **Sub-agents**: https://code.claude.com/docs/en/sub-agents
- **Hooks**: https://code.claude.com/docs/en/hooks
- **Settings**: https://code.claude.com/docs/en/settings
