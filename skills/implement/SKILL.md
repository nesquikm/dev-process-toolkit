---
name: implement
description: Implement a feature or fix end-to-end. Analyzes the request, builds in TDD order, runs gate checks, self-reviews with bounded loops, and reports for human approval before committing.
disable-model-invocation: true
argument-hint: '<task description, issue number, or task file name>'
---

# Implement

Implement the following end-to-end: `$ARGUMENTS`

## Phase 1: Understand

1. **Check for specs** — If `specs/` exists, check whether spec files have real content (not just template placeholders). If specs exist but are mostly empty, warn the user: "Specs appear to be incomplete. SDD works best when specs are filled in first. Consider running `/dev-process-toolkit:spec-write` or continue with what's available?" Let the user decide.

2. **Understand the request** — Determine the source:
   - If `$ARGUMENTS` is a number, try `gh issue view $ARGUMENTS` for GitHub issue
   - If `$ARGUMENTS` matches a file in `.tasks/`, read that task file
   - If specs exist in `specs/`, read relevant specs
   - Otherwise, treat `$ARGUMENTS` as the task description
3. **Read relevant code** — Find the files that need to change
4. **Build the AC checklist** — Extract every acceptance criterion as a binary pass/fail checklist. If no explicit ACs exist, derive them from the description. This checklist is your **definition of done**.
5. **Present the plan** — Show the user:
   - AC checklist
   - Files to create/modify
   - Test strategy
   - Ask for approval before proceeding

## Phase 2: Build (TDD)

6. **Execute in TDD order:**
   - For each change:
     a. Write tests first
     b. Run tests — confirm RED (failing)
     c. Implement the code
     d. Run tests — confirm GREEN (passing)
   - Follow project patterns from CLAUDE.md

<!-- ADAPT: If copying this skill manually, replace with your project's gate commands -->
7. **Gate check** — Read the gate commands from CLAUDE.md and run them (e.g., `npm run typecheck && npm run lint && npm run test`)
   - This is the **deterministic kill switch** — if it fails, fix before proceeding
   - Do NOT let judgment override a failing gate

## Phase 3: Self-Review Loop (max 2 rounds)

> The gate check is the hard stop. This review loop is the smart stop.

8. **Round N (N = 1, 2):**

   a. **AC check** — Walk the checklist from Phase 1. For each AC:
   - ✓ Pass — implemented and tested
   - ✗ Fail — missing or wrong
   - ⚠ Partial — implemented but incomplete

   b. **Code audit** — Re-read every file created/modified. Look for:
   - Logic bugs, off-by-one errors, wrong comparisons
   - Missing edge cases the tests don't cover
   - Pattern violations (check CLAUDE.md for project patterns)
   - Hardcoded values that should come from config
   - Security issues (unsanitized input, injection risks)

   <!-- ADAPT: Add domain-specific checks for your framework/stack -->
   <!-- Examples: -->
   <!-- Flutter: const constructors, tryEmit() usage, codegen files not edited, l10n strings -->
   <!-- React/Web: URL state management, component prop types, accessibility -->
   <!-- MCP server: Response format compliance, ESM import extensions, tool registration -->
   <!-- API server: Input validation at boundaries, error response format, auth checks -->
   <!-- See docs/patterns.md Pattern 8 for more examples -->
   c. **Stack-specific checks** — Verify framework patterns are followed

   d. **Decision (deterministic, not vibes):**
   - **All ACs pass + no issues found** → exit loop, go to Phase 4
   - **Issues found, round 1** → fix issues, re-run gate check, go to round 2
   - **Issues found, round 2** → check for convergence:
     - Same issue types as round 1 → **STOP and escalate** to user (going in circles)
     - New/different issues → fix, re-run gate check, then escalate to user (diminishing returns)

   e. **After any fix** — always re-run the full gate check before continuing

## Phase 4: Report & Handoff

9. **Report** — Present to the user:
   - AC checklist with final pass/fail status
   - Files created/modified
   - Test coverage (which cases are tested)
   - Self-review findings (what was caught and fixed, what remains)
   - Gate check result
   - Number of review rounds used

10. **Wait for approval** — Ask the user to review before committing. Do NOT commit until the user explicitly says so.

## Rules

- Do NOT proceed if the gate check fails — fix first
- Do NOT skip tests — always write tests before implementation
- Do NOT commit without user approval
- Do NOT self-review more than 2 rounds — escalate instead of looping
- The gate check (deterministic) always overrides judgment about quality
- ACs are binary (pass/fail) — no "good enough"
