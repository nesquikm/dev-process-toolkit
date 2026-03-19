# Patterns from Real Projects

Proven patterns extracted from three production projects using SDD with Claude Code.

## Pattern 1: The Deterministic Kill Switch

**Problem**: LLMs can convince themselves that broken code is fine.

**Solution**: Gate checks are deterministic commands (compiler, linter, test runner) that always override LLM judgment.

```
Gate check result: FAIL (3 type errors)
LLM judgment: "The code looks correct to me"
Winner: Gate check. Always.
```

This is the single most important pattern. Without it, the self-review loop becomes an echo chamber.

## Pattern 2: Bounded Self-Review (Max 2 Rounds)

**Problem**: Unbounded review loops can run forever, burning tokens on diminishing returns.

**Solution**: Cap self-review at 2 rounds with convergence detection:

```
Round 1: Found issues → Fix → Re-gate → Round 2
Round 2:
  Same issues as round 1 → DEADLOCK → Escalate to human
  New issues → Fix → Re-gate → Escalate to human
  No issues → Done
```

Why 2 and not 3? Because if round 2 finds the same issue classes as round 1, the agent is going in circles. More rounds won't help.

## Pattern 3: Binary Acceptance Criteria

**Problem**: Vague criteria like "looks good" or "well-tested" allow scope creep and subjective judgment.

**Solution**: Every AC is binary — pass or fail:
- ✓ Pass — implemented and tested
- ✗ Fail — missing or wrong
- ⚠ Partial — implemented but incomplete

No open-ended "is this good enough?" The AC checklist IS the definition of done.

## Pattern 4: Phase-Based Implementation

**Problem**: Agents jump between tasks, lose context, and skip steps.

**Solution**: Implementation follows strict phases:

```
Phase 1: Understand  → Read specs/issue, build AC checklist, present plan
Phase 2: Build (TDD) → RED → GREEN → VERIFY for each task
Phase 3: Self-Review → Bounded loop with deterministic decisions
Phase 4: Report      → Present findings, wait for human approval
```

Each phase has clear entry/exit conditions. The agent can't skip ahead.

## Pattern 5: Spec Precedence Hierarchy

**Problem**: Multiple docs can contradict each other.

**Solution**: Establish a clear precedence:

```
requirements.md > testing-spec.md > technical-spec.md > plan.md
```

If the plan says "use approach X" but requirements say "must support Y" and X doesn't support Y, requirements win.

## Pattern 6: SPEC_DEVIATION Markers

**Problem**: Sometimes you must deviate from specs. But deviations get lost.

**Solution**: When implementation must differ from spec, add a code comment:

```typescript
// SPEC_DEVIATION: Using client-side filtering instead of server-side
// Reason: All data is already in memory from the mock generator
```

The self-review phase catches these and includes them in the report to the human.

## Pattern 7: Human-Gated Commits

**Problem**: Agents commit code that hasn't been reviewed.

**Solution**: The agent never commits without explicit human approval. The report phase presents:
- AC checklist status
- Files changed
- Self-review findings
- Gate check results
- SPEC_DEVIATIONs

Only after the human says "go ahead" does the agent commit.

## Pattern 8: Stack-Specific Review Checklists

**Problem**: Generic code review misses framework-specific issues.

**Solution**: Add domain-specific checks to the self-review phase:

**Flutter**: `const` constructors, `tryEmit()` usage, codegen files not edited, l10n strings
**TypeScript/MCP**: Response format compliance, ESM import extensions, tool registration
**React/Web**: URL state management, component prop types, accessibility
**API Server**: Input validation at boundaries, error response format, auth checks

## Pattern 9: Gate Check Matches CI

**Problem**: Code passes locally but fails in CI.

**Solution**: Gate check commands should be identical to CI pipeline:

```yaml
# CI pipeline
- npm run typecheck
- npm run lint
- npm run test

# /gate-check skill
1. npm run typecheck
2. npm run lint
3. npm run test
```

Same commands, same order, same flags.

## Pattern 10: Visual Verification via MCP

**Problem**: Web UIs can render incorrectly even when tests pass.

**Solution**: Use a rubber duck MCP with Chrome browser tools to visually inspect the page:

1. Start dev server if not running
2. Ask duck to open page in Chrome
3. Duck reports what it sees (layout, content, errors)
4. Test filter switching with different URL params
5. Report as pass/fail checklist

This catches styling issues, layout problems, and rendering bugs that unit tests can't detect.

## Anti-Patterns to Avoid

### The Infinite Refinement Loop
Two models critiquing each other forever. Fix: bounded loops + convergence detection.

### The Vibes-Based Exit
"It looks good to me" as a quality gate. Fix: deterministic gate checks.

### The Skip-the-Test Shortcut
"Tests will slow me down." Fix: TDD is mandatory, not optional.

### The Mega-Commit
Implementing everything before running any gates. Fix: gate check after each task.

### The Scope Creep Review
Self-review that starts "improving" code beyond the AC scope. Fix: binary AC checklist as the only review criteria.
