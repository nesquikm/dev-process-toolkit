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

## Pattern 11: Three-Stage Self-Review

**Problem**: A single combined review pass conflates spec compliance with code quality. The reviewer finds a style issue and considers the review thorough; the spec gap goes unnoticed. "The code is clean, therefore it meets the spec" is a rationalization the combined review enables. Additionally, happy-path code that passes all checks can still be fragile — negative and boundary cases are systematically missed unless explicitly checked.

**Solution**: Split the self-review into three sequential stages:

```
Stage A — Spec Compliance: Does the code match what was specified?
  → Walk the AC checklist, check cross-module coverage
  → Fix any spec gaps before moving on

Stage B — Code Quality: Is the code well-written?
  → Audit for logic bugs, pattern violations, security issues
  → Fix any quality issues

Stage C — Hardening (first round only): Is the code robust?
  → Negative & edge-case tests (null, empty, boundary, failure modes)
  → Error path audit (no swallowed errors, no leaked secrets)
  → Focus on cases most likely to cause real bugs
```

Complete stages in order: A → B → C. If any stage finds issues, fix them and re-run the gate before proceeding to the next. Stage C runs only on round 1 to avoid diminishing returns.

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

## Pattern 15: Spec Deviation Classification

**Problem**: During implementation, the agent discovers the spec is wrong or incomplete. It silently works around the issue, and the spec and code drift apart. The next person (human or agent) to read the spec gets a false picture.

**Solution**: Classify every spec deviation into one of four categories, each with a different action:

```
Underspecified → Add edge case to specs + test, continue
Ambiguous      → Propose conservative default, log as provisional, continue
Contradicts    → STOP, present options to user, wait for decision
Infeasible     → STOP, explain why, propose alternatives, wait for decision
```

Always backfill specs with what you learned. Edge cases discovered during implementation must be logged in specs and covered by tests — code is not documentation.

## Pattern 16: Pre-Implementation Risk Scan

**Problem**: Surprises during implementation (missing APIs, migration issues, concurrency bugs) are expensive to fix. Many could have been identified before coding started.

**Solution**: After specs are complete and before implementation begins, scan for risks in known categories:

```
External dependencies → Could they be unavailable or change?
Data migrations       → Schema changes, backwards compatibility?
Concurrency           → Shared state, race conditions?
Auth & security       → New endpoints, permission changes?
Performance           → Large data sets, unbounded loops?
Unclear ACs           → Subjective, hard to test?
```

Flag each risk in the relevant spec. Don't invent risks — only flag things that would genuinely surprise someone during implementation.

## Pattern 17: Baseline Health Check

**Problem**: An agent starts building a new feature on a codebase that's already broken. All of Phase 2 (TDD) is wasted because the failures are pre-existing, not caused by the new code.

**Solution**: Run the full gate check before writing any code. If it fails, fix it first (or inform the user). Never build on a broken foundation.

## Pattern 18: Test Integrity Lock

**Problem**: When new code breaks existing tests, the agent modifies the tests instead of fixing the code. This silently weakens the test suite — tests that used to catch bugs now don't.

**Solution**: Treat existing tests as immutable unless the spec has changed. If an existing test fails after new code is added, either the new code is wrong or the spec changed. Spec changes require user approval. The agent must never delete or weaken tests to make its implementation pass.

## Pattern 19: Git Checkpoints for Recovery

**Problem**: The self-review loop (Phase 3) discovers the implementation went in the wrong direction. But all changes are uncommitted — there's no way to partially revert to a known-good state.

**Solution**: After each meaningful TDD cycle, create an intermediate git commit. These are recovery points, not PR-ready commits. If a later change breaks things, the agent can revert to the last checkpoint instead of starting over.

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

### The Silent Spec Divergence
Agent finds the spec is wrong, works around it in code, never updates the spec. The spec becomes fiction. Fix: spec deviation classification + mandatory backfill.

### The Test Weakener
New code breaks existing tests, so the agent "fixes" the tests instead of the code. Fix: treat existing tests as immutable unless the spec changed (with user approval).

### The Shallow Test
Test exists and passes, but asserts nothing meaningful (`expect(fn).not.toThrow()`, `assert result is not None`). Fix: assertion quality checks that flag tests without value/behavior assertions.

## Pattern 20: Spec-Code Drift Detection

**Problem**: Specs and code drift apart over time. An AC says "must validate input" but no validation code exists. Nobody notices because the gate check only runs deterministic commands — it doesn't compare spec to code.

**Solution**: After gate commands pass, run a drift check that traces each AC to implementing code:

```
AC-1.1 → src/feature.ts:42    (implemented)
AC-1.2 → (not found)           (drift!)
AC-2.1 → src/service.ts:15    (implemented)
```

Drift findings are **advisory** (GATE PASSED WITH NOTES, never GATE FAILED) because the traceability is heuristic — false positives would erode trust in the deterministic gate. But they surface gaps early.

## Pattern 21: Spec Breakout Protocol

**Problem**: The agent discovers 4+ spec contradictions in a single milestone but keeps pushing forward, writing increasingly contorted workarounds. The resulting code is a mess of provisional decisions.

**Solution**: Set a threshold (default 3) for `contradicts` or `infeasible` spec deviations within a milestone. When the threshold is reached, stop implementation and issue a Spec Breakout report — listing all accumulated deviations and recommending a spec rewrite before continuing. A spec breakout is a valid output, not a failure.

## Pattern 22: Shallow Test Detection

**Problem**: Tests exist and pass, but they don't actually verify behavior. Common anti-patterns: `expect(fn).not.toThrow()` as the sole assertion, `assert result is not None` without checking the value, type-only checks without verifying content. These tests create false confidence.

**Solution**: Add assertion quality checks in TDD (RED phase) and self-review (Stage A). Flag tests that only use these patterns and require assertions on actual return values, state changes, or side effects.

### Stable Anchor IDs

**Problem (FR-18)**: Archival pointers, traceability matrices, and cross-links between spec files all depend on identifiers that survive heading renames and reordering. A pointer like `M3 → specs/archive/M3-user-auth.md` is only stable if "M3" itself is a stable identifier on the heading — not a positional guess. The first time someone renames a milestone, every positional reference rots silently.

**Solution**: Embed explicit Markdown anchor IDs on every archivable unit at creation time. Templates ship with the anchor syntax pre-filled; `/spec-write` enforces the rule on generated or edited headings; `/setup` doctor validation warns if any heading lacks its anchor. Anchors are CommonMark-friendly, render as empty spans, and survive all mainstream Markdown viewers.

| Unit type | Heading form | Anchor format | Source of truth |
|-----------|-------------|---------------|-----------------|
| Milestone | `## M{N}: {title}` | `{#M{N}}` — appended to the heading line | `templates/spec-templates/plan.md.template` |
| FR | `### FR-{N}: {title}` | `{#FR-{N}}` — appended to the heading line | `templates/spec-templates/requirements.md.template` |
| AC | `- AC-{N}.{M}: {text}` | The AC ID itself acts as the anchor — existing convention, no change | list-item line in requirements.md |

Example of a properly anchored milestone heading:

```markdown
## M3: User authentication {#M3}
```

Grep pattern to find missing anchors: `^##\s+M[0-9]+:` in `plan.md` and `^###\s+FR-[0-9]+:` in `requirements.md` — any match whose line does NOT also contain `{#M` / `{#FR-` is a doctor warning. Archival (FR-16) and `/spec-archive` (FR-17) resolve pointer targets through these anchors.

### Pattern: Archival Lifecycle

**Problem (FR-16 through FR-20)**: Spec files grow unboundedly as a project matures. Every `/implement`, `/gate-check`, and `/spec-review` invocation reads the full `plan.md` and `requirements.md`, inflating hot-path context cost on work that's already shipped. Simply splitting files by hand breaks prompt caching (the cache-hot prefix moves on every rewrite), duplicates still-current content, and loses grep-friendliness.

**Solution**: Milestones are the natural unit of completion. When `/implement` finishes a milestone and the human approves the Phase 4 report, the milestone block and all traceability-matched ACs are **moved** (not copied) from live specs into a single archive file at `specs/archive/M{N}-{slug}.md`, replaced by Schema H pointer lines. For content the auto-path can't reach (reopens, cross-cutting ACs, aborted work), `/spec-archive` is the manual escape hatch with a diff approval gate.

**What moves:**
- The `## M{N}: ...` block from `plan.md` (verbatim, in full).
- Every AC in `requirements.md` whose traceability-matrix row resolved in this milestone. FRs whose ACs are all archived collapse to a single Schema H pointer; FRs with mixed status retain only their non-archived ACs.
- The matched rows of the traceability matrix, bundled into the archive file for auditability.

**What does NOT move:**
- `technical-spec.md` — architectural decisions use `Superseded-by:` in place (ADR convention: adr.github.io, Nygard). Auto-archiving ADRs would destroy load-bearing context for future implementation.
- `testing-spec.md` — test conventions stay live.
- In-flight milestones, future milestones, or ACs without a populated traceability row.

**Rationale:**
- **Prompt caching stability** — archival is a surgical move, so the cache-hot prefix of the live files stays stable between milestones and only invalidates at the moment of archival (once per milestone, not once per run).
- **Bounded hot-path context cost** — live `plan.md` and `requirements.md` never accumulate shipped content; hot-path token cost is roughly constant regardless of project age (NFR-5).
- **Auditability** — archive files are append-only. Reopens create `-r2`, `-r3` revision files, never in-place mutations. History is trivially greppable (`^> archived:`).
- **Escape hatch** — `/spec-archive` covers everything auto-archival can't reach, with an explicit diff approval gate so users see exactly what's moving.
