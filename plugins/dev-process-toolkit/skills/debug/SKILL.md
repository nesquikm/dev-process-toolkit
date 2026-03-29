---
name: debug
description: Structured debugging protocol for failed gate checks, failing tests, or unexpected behavior. Use when /gate-check or /tdd fails and the cause is unclear. Phases: Root Cause → Pattern Analysis → Hypothesis Testing → Implementation.
argument-hint: '<failing test, error message, or symptom>'
---

# Debug

Investigate and fix: `$ARGUMENTS`

## Phase 1: Root Cause Investigation

Before writing any fixes:

1. **Read the full error** — Don't skim. Copy the exact error message, stack trace, and file:line references.
2. **Reproduce it** — Run the failing command fresh and confirm the error is consistent.
3. **Read the failing code** — Read the test file and the implementation it calls. Don't assume you know what the code does.
4. **Check recent changes** — Run `git diff HEAD` or `git log --oneline -5` to see what changed before this started failing.

Output a one-sentence hypothesis: "This fails because X in Y."

## Phase 2: Pattern Analysis

Before attempting any fix, ask:

1. **Isolated failure or symptom?**
   - Does changing one thing fix it, or does the error move to a different location?
   - Are multiple tests failing in the same pattern?

2. **Is the test itself correct?**
   - Could the test be testing the wrong thing?
   - Does the test have setup/teardown issues?

3. **Is there environment pollution?**
   - Tests that pass in isolation but fail in a suite: suspect shared state, singletons, global mocks, or file system side effects.
   - Find the polluter: run half the test suite, check if the failure occurs, narrow down by bisecting.

4. **Is there a timing dependency?**
   - Tests that fail intermittently often depend on `sleep()` or wall-clock time.
   - Replace `sleep(N)` with condition-based waiting: poll for the condition with a timeout.
   - Fixed sleeps are false gates — they pass on fast machines and fail on slow ones.

## Phase 3: Hypothesis Testing

1. **State the hypothesis explicitly** — Write it down before touching code.
2. **Make one change at a time** — Don't batch fixes. Each change tests one hypothesis.
3. **Run the gate after each change** — Don't chain multiple fixes and hope.
4. **If the fix doesn't work, revert it** — Don't accumulate partial fixes. A failed fix left in the code obscures the next hypothesis.

## Phase 4: Implementation

Once the root cause is confirmed:

1. **Fix the root cause, not the symptom** — If a test is timing-sensitive, don't increase the sleep duration. Fix the timing dependency.
2. **Run the gate check after the fix** — Read the full output. Report the actual result (e.g., "47 tests, 0 failures, 0 errors").
3. **Check for related issues** — Did this fix reveal another failure? Address it before declaring done.

## The 3-Fix Rule

If you have attempted 3 different fixes and the test still fails:

**Stop. Question the architecture.**

Don't try fix #4. Instead:

1. Re-read the spec or requirement for this feature
2. Ask: is the implementation approach itself wrong?
3. Ask: does this test reflect what the spec actually requires?
4. Escalate to the user with your findings — describe what you tried and why each failed

Continuing past 3 failed fixes without changing your mental model burns time and obscures the root cause.

## Rules

- Do NOT skip Phase 1 — "I know what's wrong" is how debugging sessions fail
- Do NOT batch multiple hypotheses into one fix
- Do NOT increase `sleep()` durations to fix flaky tests — find the condition and wait for it
- Do NOT claim the issue is fixed without running the gate and reading the actual output
- After 3 failed fixes, escalate — do not attempt fix #4
