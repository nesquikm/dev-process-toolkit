---
name: implement
description: Implement a feature or fix end-to-end. Analyzes the request, builds in TDD order, runs gate checks, self-reviews with bounded loops, and reports for human approval before committing.
disable-model-invocation: true
argument-hint: '<milestone, task description, issue number, "next", or "all">'
---

# Implement

Implement the following end-to-end: `$ARGUMENTS`

## Phase 1: Understand

1. **Check for specs** — If `specs/` exists, check whether spec files have real content (not just template placeholders). If specs exist but are mostly empty, warn the user: "Specs appear to be incomplete. SDD works best when specs are filled in first. Consider running `/dev-process-toolkit:spec-write` or continue with what's available?" Let the user decide.

2. **Resolve the target** — Determine what to implement:
   - If `$ARGUMENTS` is "next", read `specs/plan.md` and find the first milestone with unchecked acceptance criteria (`- [ ]`). Use that milestone as the target. If all milestones are complete, report "All milestones complete."
   - If `$ARGUMENTS` is "all" or "remaining", read `specs/plan.md` and collect all milestones with unchecked acceptance criteria. Run them sequentially — complete the full Phase 1–4 cycle for each milestone before starting the next. Present the list of milestones to the user for approval before starting.
   - If `$ARGUMENTS` names multiple milestones (e.g., "M2 and M3"), run them sequentially in the listed order — full Phase 1–4 cycle per milestone.
   - If `$ARGUMENTS` matches a milestone name (e.g., "M1", "M2"), read that milestone from `specs/plan.md`
   - If `$ARGUMENTS` is a number, try `gh issue view $ARGUMENTS` for GitHub issue
   - If `$ARGUMENTS` matches a file in `.tasks/`, read that task file
   - If specs exist in `specs/`, read relevant specs
   - Otherwise, treat `$ARGUMENTS` as the task description

3. **Read the gate commands** — Read CLAUDE.md and find the gate check commands (look for "Key Commands" or "Gating rule" section). These are the commands you'll use throughout.

4. **Read relevant code** — Find the files that need to change

5. **Build the AC checklist** — Extract every acceptance criterion as a binary pass/fail checklist. If no explicit ACs exist, derive them from the description. This checklist is your **definition of done**.

6. **Present the plan** — Show the user:
   - AC checklist
   - Files to create/modify
   - Test strategy
   - **Warning if running in parallel:** If multiple milestones are being implemented concurrently (e.g., via agents), warn about potential conflicts on shared files (like index.ts barrel exports). Recommend serializing writes to shared files.
   - Ask for approval before proceeding

## Phase 2: Build (TDD)

7. **Execute in TDD order:**
   - For each change:
     a. Write tests first
     b. Run tests — confirm RED (failing). If tests pass unexpectedly, the test isn't validating new behavior — fix the test assertions so they actually require the unwritten code before proceeding.
     c. Implement the code
     d. Run tests — confirm GREEN (passing)
   - Follow project patterns from CLAUDE.md

8. **Gate check** — Run the gate commands from step 3
   - This is the **deterministic kill switch** — if it fails, fix before proceeding
   - Do NOT let judgment override a failing gate

## Phase 3: Self-Review Loop (max 2 rounds)

> The gate check is the hard stop. This review loop is the smart stop.

**Proportional review:** Scale the review depth to the change size. For trivial changes (single function, <20 lines, no new modules), a quick AC check + gate check is sufficient — skip the full code audit and cross-module coverage analysis. Reserve the deep review for changes that touch multiple modules or introduce new patterns.

9. **Round N (N = 1, 2):**

   a. **AC check** — Walk the checklist from Phase 1. For each AC:
   - ✓ Pass — implemented and **directly tested** (not just indirectly covered)
   - ✗ Fail — missing or wrong
   - ⚠ Partial — implemented but incomplete or only indirectly tested

   If an AC explicitly names a module or function (e.g., "Validation helpers throw correct error types"), verify that a test file directly tests that module. Indirect coverage through other tests does NOT satisfy an explicit AC.

   b. **Code audit** — Re-read every file created/modified. Look for:
   - Logic bugs, off-by-one errors, wrong comparisons
   - Missing edge cases the tests don't cover
   - Pattern violations (check CLAUDE.md for project patterns)
   - Hardcoded values that should come from config
   - Security issues (unsanitized input, injection risks)

   c. **Cross-module coverage check** — For every module that was created or significantly modified, verify it has direct test coverage. If an AC references a specific module that has no dedicated test file, flag it as a gap.

   <!-- ADAPT: Add domain-specific checks for your framework/stack -->
   <!-- Examples: -->
   <!-- Flutter: const constructors, tryEmit() usage, codegen files not edited, l10n strings -->
   <!-- React/Web: URL state management, component prop types, accessibility -->
   <!-- MCP server: Response format compliance, ESM import extensions, tool registration -->
   <!-- API server: Input validation at boundaries, error response format, auth checks -->
   d. **Stack-specific checks** — Verify framework patterns are followed

   e. **Decision (deterministic, not vibes):**
   - **All ACs pass + no issues found** → exit loop, go to Phase 4
   - **Issues found, round 1** → fix issues, re-run gate check, go to round 2
   - **Issues found, round 2** → check for convergence:
     - Same issue types as round 1 → **STOP and escalate** to user (going in circles)
     - New/different issues → fix, re-run gate check, then escalate to user (diminishing returns)

   f. **After any fix** — always re-run the full gate check before continuing

## Phase 4: Report & Handoff

10. **Update specs** — If implementing a milestone from `specs/plan.md`:
    - Update the milestone's acceptance criteria from `- [ ]` to `- [x]` for each AC that passed. This keeps plan.md as the single source of progress truth.
    - If `specs/requirements.md` has a traceability matrix, update the Implementation and Tests columns for each AC with the actual file paths (e.g., `src/calculator.ts`, `tests/calculator.test.ts`).

11. **Report** — Present to the user:
   - AC checklist with final pass/fail status
   - Files created/modified
   - Test coverage (which cases are tested, flag any modules without direct tests)
   - Self-review findings (what was caught and fixed, what remains)
   - Gate check result
   - Number of review rounds used

12. **Wait for approval** — Ask the user to review before committing. Do NOT commit until the user explicitly says so.

## Rules

- Do NOT proceed if the gate check fails — fix first
- Do NOT skip tests — always write tests before implementation
- Do NOT commit without user approval
- Do NOT self-review more than 2 rounds — escalate instead of looping
- The gate check (deterministic) always overrides judgment about quality
- ACs are binary (pass/fail) — no "good enough"
- Every AC that names a specific module requires a direct test for that module
