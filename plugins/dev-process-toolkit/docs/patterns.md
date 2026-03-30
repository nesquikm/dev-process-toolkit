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

## Pattern 11: Two-Stage Self-Review

**Problem**: A single combined review pass conflates spec compliance with code quality. The reviewer finds a style issue and considers the review thorough; the spec gap goes unnoticed. "The code is clean, therefore it meets the spec" is a rationalization the combined review enables.

**Solution**: Split the self-review into two sequential stages:

```
Stage A — Spec Compliance: Does the code match what was specified?
  → Walk the AC checklist, check cross-module coverage
  → Fix any spec gaps before moving on

Stage B — Code Quality: Is the code well-written?
  → Audit for logic bugs, pattern violations, security issues
  → Fix any quality issues
```

Complete Stage A before starting Stage B. If Stage A finds issues, fix them and re-run the gate first. This prevents code quality findings from obscuring spec compliance gaps.

## Pattern 12: Verification-Before-Completion

**Problem**: An agent can "know" tests pass from memory of the last run. Over time, "I verified" without actual verification becomes the norm.

**Solution**: Forbid completion claims without fresh command output. Before reporting a phase done:

1. Run the gate command right now, in this session
2. Read the full output
3. Report the actual numbers: "47 tests, 0 failures, 0 errors"

Forbidden phrases (because they don't cite evidence): "tests pass", "should be fine", "I've verified", "it should work now". Any claim of completeness must be backed by a gate command run in the current session, with the actual output cited.

## Pattern 13: Structured Debugging (4 Phases + 3-Fix Rule)

**Problem**: When a gate check fails, agents thrash — trying multiple fixes without diagnosing the root cause. Each failed fix obscures the next hypothesis.

**Solution**: Structure debugging into 4 phases:

```
Phase 1: Root Cause Investigation  → Read the full error, reproduce it, check recent changes
Phase 2: Pattern Analysis          → Isolated or symptom? Test pollution? Timing dependency?
Phase 3: Hypothesis Testing        → One change at a time, revert if wrong, gate after each
Phase 4: Implementation            → Fix root cause, not symptom, run gate and cite output
```

The 3-Fix Rule: if 3 different fixes all fail, stop and question the architecture. Don't try fix #4 — escalate to the user with findings.

Common sources of flaky tests: `sleep()` calls (replace with condition-based waiting), shared state between tests (find the polluter by bisecting the test suite), and global mocks that persist across test cases.

## Pattern 14: Anti-Rationalization Red Flags

**Problem**: Rules are easy to follow when things are going well. They break under pressure. An agent under pressure invents reasons the rule doesn't apply "just this once."

**Solution**: Embed the specific internal monologue that precedes rule-breaking, so the rationalization is caught at the moment it forms:

```
"I'll run gate-check after the next task"       → run it now
"This is too simple to need a failing test"     → write the test
"I know the tests pass"                         → run them and read the output
"Just this once"                                → there is no just this once
"It should work now"                            → "should" is not a gate result
```

These Red Flags sections appear in /implement, /tdd, and /gate-check at the point of decision, not as a reference doc to consult separately.

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
