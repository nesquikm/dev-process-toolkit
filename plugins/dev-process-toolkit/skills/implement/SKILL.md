---
name: implement
description: Implement a feature or fix end-to-end. Analyzes the request, builds in TDD order, runs gate checks, self-reviews with bounded loops, and reports for human approval before committing.
argument-hint: '<milestone, task description, issue number, "next", or "all">'
---

# Implement

Implement the following end-to-end: `$ARGUMENTS`

## Pre-flight: Branch Isolation

Ask the user: "Work in a **git worktree** (isolated branch) or on the **current branch**?" — worktrees let failed runs be discarded cleanly; current branch starts immediately.

If worktree: derive a branch name from the task (e.g., `feat/user-auth`), run `git worktree add ../<branch-name> -b <branch-name>`, install dependencies for the detected stack (`npm install`, `uv sync`, `cargo build`, `go mod download`, etc.), and perform all Phase 1–4 work inside the new directory. On success, tell the user how to merge back; on failure, offer `git worktree remove <path> --force`.

### Partial Failure Recovery

If a multi-milestone run partially succeeds in a worktree, list completed work (milestones + commit hashes) and failed work (which milestone broke and why), then offer three recovery options:

1. **Cherry-pick completed commits** onto `main` (`git checkout main && git cherry-pick <hash>...`).
2. **Continue in the worktree** after fixing the failure (`cd <worktree-path>`, fix, resume `/implement`).
3. **Discard the worktree** entirely (`git worktree remove <worktree-path> --force`).

## Phase 1: Understand

> Do not read specs/archive/ during implementation — archived milestones are historical context only.

0. **Layout + tracker-mode probes** — Before any other action:

   - **0.a Layout probe** — Read `specs/.dpt-layout` via `bun run adapters/_shared/src/layout.ts`. If `version: v2`, run v2 behavior (ACs come from `specs/frs/<ulid>.md`; Phase 4 archives via `git mv`; `Provider.claimLock`/`releaseLock` gates entry/exit per FR-46). If the marker is absent and `specs/requirements.md` exists, run v1 behavior unchanged. If version > v2, exit with the canonical message: `"Layout v<actual> detected; /implement requires v2. Run /dev-process-toolkit:setup to migrate."` (AC-47.3). Full v2 reference: `docs/v2-layout-reference.md`.
   - **0.b Provider resolution** — In v2 mode, resolve `Provider` once per invocation: `LocalProvider` if `mode: none`, `TrackerProvider` wrapping the configured tracker adapter otherwise (AC-43.3). No re-resolution mid-execution.
   - **0.b′ Resolver entry (AC-53.1)** — Call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry (FR-65 AC-65.5), then pass the result to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. Never hand-assemble the config inline; malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal (AC-65.6). Route by `kind`: `ulid` → proceed to 0.c with that ULID; `tracker-id` / `url` + `findFRByTrackerRef` hit → proceed with the resolved ULID; `tracker-id` / `url` + miss → run `importFromTracker(...)` (same helper as `/spec-write`) then proceed to 0.c with the new ULID; `fallthrough` → continue to step 2 for pre-M14 argument handling (milestone code like `M13`, task description, GitHub issue number). Branch-name interop (FR-32): if the branch name contains a ticket ID that disagrees with the argument's resolved ticket, **the argument wins** with an NFR-10-shape warning (AC-53.5). `AmbiguousArgumentError` surfaces per NFR-10 with the `<tracker>:<id>` remedy. Full decision table: `docs/resolver-entry.md`.
   - **0.c `Provider.claimLock(id, currentBranch)`** — Entry gate in v2 mode. `claimed` → proceed; `already-ours` → resume; `taken-elsewhere` → STOP with the message naming the holding branch (AC-46.1/2).
   - **0.d Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker hooks below skip. If a tracker mode is active:
     - **Ticket-binding pre-flight** — 3-tier resolver + confirmation prompt per `docs/ticket-binding.md` (FR-32). Branch-regex mismatch fails loudly (AC-32.3); decline exits cleanly (AC-32.4).
     - **Record `updatedAt` (post-claimLock)** — After step 0.c `claimLock` has succeeded, call the adapter's `pull_acs(ticket_id)` and store the ticket's `updatedAt` in-session for `/gate-check` to compare later (AC-33.2, FR-66 AC-66.1). Recording **after** claimLock is load-bearing: `claimLock` itself mutates the ticket (sets status + assignee), so recording before would cause `/gate-check` to flag the skill's own write as drift. Same rule applies to any other tracker-writing pre-flight step — record `updatedAt` after all pre-flight side effects settle (AC-66.5).
     - **FR-39 diff/resolve** — Run the bidirectional AC sync loop before proceeding past Phase 1 (AC-39.1, AC-39.3, AC-39.4).
     See `docs/implement-tracker-mode.md` for the full tracker-mode flow.

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

4. **Verify baseline health** — Run the gate commands now, before writing any code. If the project is already broken, fix it first (or tell the user). Do not build new features on a broken foundation.

5. **Read relevant code** — Find the files that need to change

6. **Build the AC checklist** — Extract every acceptance criterion as a binary pass/fail checklist. If no explicit ACs exist, derive them from the description. This checklist is your **definition of done**.

7. **Present the plan** — Show the user:
   - AC checklist
   - Files to create/modify
   - Test strategy
   - **Warning if running in parallel:** If multiple milestones are being implemented concurrently (e.g., via agents), warn about potential conflicts on shared files (like index.ts barrel exports). Recommend serializing writes to shared files.
   - Ask for approval before proceeding

## Phase 2: Build (TDD)

8. **Execute in TDD order:**
   - For each change:
     a. Write tests first
     b. Run tests — confirm RED (failing). If tests pass unexpectedly, the test isn't validating new behavior — fix the test assertions so they actually require the unwritten code before proceeding.
     c. Implement the code
     d. Run tests — confirm GREEN (passing)
   - Follow project patterns from CLAUDE.md

9. **Spec deviation check** — If during implementation you discover that a spec is **wrong, infeasible, or contradictory** (e.g., an API doesn't exist, a requirement conflicts with another, performance constraints make the approach unviable):

   a. **STOP coding forward.** Do not work around the spec — the spec is the source of truth, and if reality contradicts it, the spec must be updated first.

   b. **Assess already-written code** — If significant code was already written based on the incorrect spec, evaluate whether to revert to the last checkpoint (git commit) or adapt the existing code. Prefer reverting if the spec change alters the fundamental approach.

   c. **Classify the issue:**
      - **Underspecified** — spec doesn't mention this case but the behavior is clearly implied → add the edge case to specs, add a test, continue. No user approval needed.
      - **Ambiguous** — spec doesn't say and reasonable people could disagree → propose the most conservative behavior, log it as a provisional decision in specs, add a test, ask the user to confirm at Phase 4. Continue.
      - **Contradicts spec** — what the spec says cannot work or conflicts with another requirement → present the contradiction, propose 2+ options with tradeoffs, and **wait for user decision** before proceeding. Update the spec with the decision.
      - **Infeasible** — the specified approach hits a hard technical wall → explain why, propose alternatives, **wait for user decision**.

   d. **Always backfill specs** — Any edge case discovered during implementation (whether it blocks you or not) must be:
      - Logged in `specs/requirements.md` edge cases section (or `specs/technical-spec.md` if architectural)
      - Covered by a test
      - This prevents "tribal knowledge" from living only in code.

### Spec Breakout

If the current milestone accumulates 3 or more `contradicts` or `infeasible` deviations (check the project's CLAUDE.md for a custom threshold; default is 3):

1. **STOP implementation** — do not push forward on a broken spec
2. Present a **Spec Breakout report** listing all accumulated deviations, their classifications, and proposed resolutions
3. Recommend a spec rewrite for the affected areas before resuming implementation

Spec Breakout is a valid output, not a failure. It means the spec needs work before code can proceed.

10. **Checkpoint** — After completing each logical unit of work (a TDD cycle for a meaningful chunk), create a git commit on the working branch. These intermediate commits are recovery points — if a later change breaks things, you can revert to the last known-good state instead of starting over.

11. **Gate check** — Run the gate commands from step 3. This is the **deterministic kill switch**: if it fails, fix before proceeding, never let judgment override a failing gate. If the failure cause is unclear, use `/dev-process-toolkit:debug` for structured investigation.

## Parallelization

When a milestone has fan-out-friendly tasks (independent files, ≥3 workers worth of work), parallel dispatch via native subagents, agent-teams, or worktree-per-subagent isolation can keep each context clean and shorten wall-clock. For parallelizable work, see `docs/parallel-execution.md` before dispatching.

## Phase 3: Self-Review Loop (max 2 rounds)

> The gate check is the hard stop. This review loop is the smart stop.

**Proportional review:** Scale the review depth to the change size. For trivial changes (single function, <20 lines, no new modules), a quick AC check + gate check is sufficient. Reserve the deep review for changes that touch multiple modules or introduce new patterns.

Each round has three sequential stages. **Complete each stage before starting the next.** If a stage finds issues, fix them and re-run the gate before proceeding.

12. **Round N (N = 1, 2):**

   ### Stage A — Spec Compliance

   a. **AC check** — Walk the checklist from Phase 1. For each AC:
   - ✓ Pass — implemented and **directly tested** (not just indirectly covered)
   - ✗ Fail — missing or wrong
   - ⚠ Partial — implemented but incomplete or only indirectly tested

   If an AC explicitly names a module or function (e.g., "Validation helpers throw correct error types"), verify that a test file directly tests that module. Indirect coverage through other tests does NOT satisfy an explicit AC.

   b. **Cross-module coverage check** — For every module that was created or significantly modified, verify it has direct test coverage. If an AC references a specific module that has no dedicated test file, flag it as a gap.

   c. **Assertion quality check** — Scan test files for shallow assertions. Flag these anti-patterns:

   1. `expect(fn).not.toThrow()` or `assert not raises` as the sole assertion
   2. `assert result is not None` / `expect(result).toBeDefined()` without checking the value
   3. Type-only checks (`isinstance()`, `typeof`) without verifying the actual content

   Tests using only these patterns are not validating behavior — strengthen them.

   **If Stage A finds any issues:** fix them, re-run the gate check, then proceed to Stage B.

   ### Stage B — Two-Pass Review (delegated to `code-reviewer`)

   Stage B runs two sequential `code-reviewer` invocations via the `Agent` tool: **Pass 1 — Spec Compliance** (did we build the right thing?) then **Pass 2 — Code Quality** (did we build it well?). Both passes use the canonical rubric in `agents/code-reviewer.md`; only the prompt differs. Delegation keeps each review in an isolated context.

   **If Pass 1 returns critical findings, do NOT run Pass 2; surface Pass 1 findings and stop.**

   Resolve `<base-ref>` once before either pass: use the feature branch's merge base (e.g., `git merge-base HEAD main`) on a branch run, `HEAD~1` on a hotfix on main, or `HEAD` if Phase 2 left uncommitted changes you need reviewed.

   ### Pass 1: Spec Compliance

   Runs only if `specs/requirements.md` exists. If `specs/` does not exist, skip Pass 1 silently and run Pass 2 as the sole review (graceful degradation for non-spec projects).

   d. **Invoke `code-reviewer` via the `Agent` tool** with this prompt:

   ```
   Pass 1 — Spec Compliance. Check whether every change in the diff traces to an acceptance criterion in specs/requirements.md, and flag any code that has no corresponding AC (undocumented behavior).

   Changed files (name + status):
   <paste output of: git diff --name-status <base-ref>>

   Acceptance criteria from Phase 1 (this IS your concern):
   <paste AC checklist>

   Read specs/requirements.md directly. Use your Read tool to open each changed file. Return findings in the Pass-Specific Return Contracts shape documented in agents/code-reviewer.md (one line per AC: OK or CONCERN, plus OVERALL).
   ```

   e. **Integrate Pass 1:**
   - `OVERALL: OK` → Pass 1 passes; run Pass 2.
   - `OVERALL: CONCERNS` (critical: undocumented features or missing AC coverage) → fail-fast. Skip Pass 2. Report Pass 2 as the literal line `Pass 2: Skipped (Pass 1 critical findings)` — never silently omitted. Fix findings, re-run the gate check, then re-invoke Pass 1 on round 2 — if round 2 still fails, escalate per the Decision section.

   ### Pass 2: Code Quality

   Runs only if Pass 1 returned `OVERALL: OK`, or if Pass 1 was skipped because `specs/` does not exist.

   f. **Invoke `code-reviewer` via the `Agent` tool** with this prompt:

   ```
   Pass 2 — Code Quality. Review the changes against the canonical rubric (quality, security, patterns, stack-specific). Do NOT check spec compliance — Pass 1 (or /spec-review) owns that.

   Changed files (name + status):
   <paste output of: git diff --name-status <base-ref>>

   Acceptance criteria from Phase 1 (context only, not your concern):
   <paste AC checklist>

   Read the project's CLAUDE.md for stack-specific patterns. Use your Read tool to open each changed file you need to inspect — the caller has not inlined the diff bodies. Return findings in the exact shape documented at the bottom of agents/code-reviewer.md.
   ```

   g. **Integrate Pass 2** — one line per criterion, either `<criterion> — OK` or `<criterion> — CONCERN: file:line — <one-sentence reason>`, ending with `OVERALL: OK` or `OVERALL: CONCERNS (N)`.
   - `OVERALL: OK` → Stage B passes; proceed to Stage C.
   - `OVERALL: CONCERNS` → fix each concern, re-run the gate check, then re-invoke Pass 2 if you're still on round 1. On round 2, escalate per the Decision section.
   - **Either subagent errors or returns an unparseable shape** → fall back to reading `agents/code-reviewer.md` and executing the corresponding pass's rubric inline. Never skip Stage B because delegation failed.

   **Stage B report aggregates under two subheadings:** `### Pass 1: Spec Compliance` and `### Pass 2: Code Quality`. The Pass 2 block must exist even when skipped (use the literal skipped line above).

   ### Stage C — Hardening (first round only)

   After Stage B passes on round 1, run a hardening pass before declaring victory. Skip on round 2 (diminishing returns). Cover negative/edge-case tests and an error-path audit. See `docs/implement-reference.md` for the full Stage C checklist, stack-specific hardening examples, and the round-resolution decision matrix.

   ### Decision (deterministic, not vibes)

   h. **Decision:**
   - **All stages pass + gate confirms clean (GATE PASSED)** → exit loop, go to Phase 4
   - **Gate returns GATE PASSED WITH NOTES** → treat non-critical notes as informational, include them in the Phase 4 report for the user to review. Exit loop.
   - **Issues found, round 1** → fix issues, re-run gate check, go to round 2
   - **Issues found, round 2** → check for convergence:
     - Same issue types as round 1 → **STOP and escalate** to user (going in circles)
     - New/different issues → fix, re-run gate check, then escalate to user (diminishing returns)

   i. **After any fix** — always re-run the full gate check before continuing. Read the actual output and report the numbers (e.g., "47 tests, 0 failures, 0 errors"). Do not claim clean from memory of a previous run.

## Phase 4: Report & Handoff

### Spec Deviation Summary

Before updating specs, compile all deviations discovered during Phase 2:

| Deviation | Classification | Resolution | Needs Confirmation? |
|-----------|---------------|------------|---------------------|
| *description* | underspecified / ambiguous / contradicts / infeasible | *what was done* | No / **Yes** |

Classification types (matching Phase 2 step 9): `underspecified`, `ambiguous`, `contradicts`, `infeasible`.

Rule: any row with Classification = `ambiguous` must have Needs Confirmation? = `**Yes**` (these are provisional decisions requiring user approval).

### Milestone Archival

After the human approves the Phase 4 report (step 15), and **only then**, archive the completed milestone block out of the live spec files into `specs/archive/`. This keeps `plan.md` and `requirements.md` size bounded regardless of project age.

- **Archival is skipped if specs/archive/ does not exist** — legacy projects (pre-v1.10.0) without the archive directory get no archival, and no error.
- **technical-spec.md is never auto-archived** — architectural decisions use `Superseded-by:` in place (the ADR convention). `/implement` touches only `plan.md` and `requirements.md`.
- Run archival **only after explicit human approval in step 15**, never before. If the user asks for changes instead, abort archival entirely.

**v1 procedure (legacy layout).** Write-then-delete ordering so an interrupted run leaves recoverable state: build and write the Schema G archive file first (under `specs/archive/M{N}-{slug}.md`), then excise the plan block and the traceability-matched ACs from the live specs, leaving Schema H pointer lines in place, and append one row to `specs/archive/index.md`. The collapse rule (FRs with all ACs archived collapse to a pointer; FRs with mixed status keep their header) and the incomplete-matrix fallback (move only the plan block, warn the user to archive orphan ACs via `/dev-process-toolkit:spec-archive`) are detailed in `docs/implement-reference.md` § Milestone Archival Procedure along with the exact sub-step ordering.

**v2 procedure (file-per-FR layout, FR-45).** For every FR with `milestone == <current>`: `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` + flip frontmatter `status: active` → `status: archived` + set `archived_at: <ISO now>`. All N moves and N flips land in one atomic commit (AC-45.2, AC-45.6). Then `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` (AC-44.5) in the same commit. Call `Provider.releaseLock(id)` for each released FR (AC-46.4). Finally, regenerate `specs/INDEX.md` via `regenerateIndex(specsDir)` — archived FRs drop out of the default listing (AC-45.3). Full details: `docs/v2-layout-reference.md` § `/implement`.

#### Post-Archive Drift Check

After the archive move completes and before the final Phase 4 report rendering, run the post-archive drift check from `skills/spec-archive/SKILL.md` § Post-Archive Drift Check. Do **not** re-inline the two-pass logic here — point at it to stay DRY. For Pass B, build the brief from this milestone's context: (a) the just-archived milestone and FR IDs, (b) a one-paragraph excerpt of the new archive file's title and goal lines only (not the full body), (c) the standard scope-framing instruction from the spec-archive section. Render the unified Schema I table, apply the `No drift detected` empty path, and offer the same 3-choice UX (address inline / save to `specs/drift-{YYYY-MM-DD}.md` / acknowledge). The drift check never blocks the already-completed archival.

For reopens, cross-cutting ACs, or anything this auto-path can't reach, `/dev-process-toolkit:spec-archive` is the escape hatch.

13. **Update specs** — If implementing a milestone from `specs/plan.md`:
    - Update the milestone's acceptance criteria from `- [ ]` to `- [x]` for each AC that passed. This keeps plan.md as the single source of progress truth.
    - If `specs/requirements.md` has a traceability matrix, update the Implementation and Tests columns for each AC with the actual file paths (e.g., `src/calculator.ts`, `tests/calculator.test.ts`).

14. **Report** — Present to the user:
   - AC checklist with final pass/fail status
   - Files created/modified
   - Test coverage (which cases are tested, flag any modules without direct tests)
   - Self-review findings (what was caught and fixed, what remains)
   - Spec changes made (edge cases added, deviations resolved, provisional decisions needing confirmation)
   - Drift findings (if specs/ exists and gate-check was run)
   - Gate check result — cite the actual output (e.g., "0 failures, 0 errors"), not just "passed"
   - Number of review rounds used

15. **Wait for approval, then release locks** — Ask the user to review before committing. Do NOT commit until the user explicitly says so.

    **After the user approves AND `git commit` lands** (for each commit in this run), for every ticket that was claimed during Phase 1 in v2 tracker mode, call `Provider.releaseLock(<id>)` — the Done transition in tracker mode, the `.dpt-locks/<id>` cleanup in `mode: none`. This is the only place an FR-scope run (FR subset of an in-flight milestone, no archival) releases the lock; leaving it out strands the tracker at `In Progress` after the commit lands.

    **Abort boundary (AC-68.3) — do NOT call `releaseLock`** when any of the following happen: a gate-check failure, a Spec Breakout, a user rejection at this step, or any Phase 1–3 early exit. In every abort case, the lock stays so a follow-up run can resume through the `already-ours` path (AC-46.1).

    **Double-call avoidance (AC-68.6).** On a full-milestone run where § Milestone Archival fires, the archival path already calls `releaseLock` per archived FR (AC-46.4) — skip the per-ticket call here for those same FRs. On an FR-scope run (archival does not fire), this step is the sole caller.

    In `mode: none`, `LocalProvider.releaseLock` deletes `.dpt-locks/<id>` regardless of tracker configuration (AC-68.4); the Pattern 9 byte-diff regression gate against the `mode-none-v2-migration` fixture continues to pass because the cleanup was already part of the existing mode-none flow.

## Rules

- Do NOT proceed if the gate check fails — fix first
- Do NOT skip tests — always write tests before implementation
- Do NOT commit without user approval
- Do NOT self-review more than 2 rounds — escalate instead of looping
- Do NOT silently work around a broken spec — update the spec first (see Phase 2 step 9)
- Do NOT let edge cases live only in code — always backfill specs
- Do NOT modify or delete existing tests to make new code pass — if an existing test fails, either the new code is wrong or the spec changed (and spec changes need user approval)
- The gate check (deterministic) always overrides judgment about quality
- ACs are binary (pass/fail) — no "good enough"
- Every AC that names a specific module requires a direct test for that module
- Stage A (spec compliance) must complete before Stage B (code quality), then Stage C (hardening) — do not blend them
- Before claiming any phase complete, run the gate command fresh and cite the actual output. Do NOT claim completion from memory of a previous run.
- Forbidden: "tests pass", "should be fine", "I verified" without citing actual command output

## Red Flags

If you hear yourself thinking any of these, stop and apply the rule anyway:

- "I'll run gate-check after the next task" / "I know the tests pass" → run it now, read the actual output
- "This is too simple to need a failing test first" / "I'll test after, it's almost done" → write the test first
- "It should work now" → "should" is not a gate result
- "The spec says X but Y works better" / "It's just a small edge case, no need to update specs" → update the spec first, backfill now
- "Just this once" → there is no just this once

## Architecture Note

This skill runs in-process in the main session — deliberately **not** `context: fork`. Phase 3 Stage B spawns the `code-reviewer` subagent via the `Agent` tool, and Claude Code forbids nested subagent spawns (*"Subagents cannot spawn other subagents"*). The review-fix loop additionally requires findings to flow back to the same implementer that wrote the code, so the chain-the-reviewer-after-`/implement`-returns workaround also breaks. See `docs/patterns.md` § Pattern: `/implement` Runs In-Process for the full rationale.
