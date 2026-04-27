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

If a multi-milestone worktree run partially succeeds, list completed work (milestones + commit hashes) and the failing milestone, then offer three recovery options: **cherry-pick** completed commits onto `main` (`git cherry-pick <hash>...`), **continue** in the worktree after a fix (`cd <path>`, resume `/implement`), or **discard** the worktree (`git worktree remove <path> --force`).

## Phase 1: Understand

> Do not read `specs/frs/archive/` or `specs/plan/archive/` during implementation — archived FRs and milestones are historical context only.

0. **Tracker-mode probes** — Before any other action:

   - **0.b Provider resolution** — Resolve `Provider` once per invocation: `LocalProvider` if `mode: none`, `TrackerProvider` wrapping the configured tracker adapter otherwise (AC-STE-20.3). No re-resolution mid-execution. ACs come from `specs/frs/<ulid>.md`; Phase 4 archives via `git mv`; `Provider.claimLock`/`releaseLock` gates entry/exit per STE-28.
   - **0.b′ Resolver entry (AC-STE-32.1)** — Call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry (STE-44 AC-STE-44.5), then pass the result to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. Never hand-assemble the config inline; malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal (AC-STE-44.6). Route by `kind`: `ulid` → proceed to 0.c with that ULID; `tracker-id` / `url` + `findFRByTrackerRef` hit → proceed with the resolved ULID; `tracker-id` / `url` + miss → run `importFromTracker(...)` (same helper as `/spec-write`) then proceed to 0.c with the new ULID; `fallthrough` → continue to step 2 for free-form argument handling (milestone code like `M13`, task description, GitHub issue number). Branch-name interop (STE-27): if the branch name contains a ticket ID that disagrees with the argument's resolved ticket, **the argument wins** with an NFR-10-shape warning (AC-STE-32.5). `AmbiguousArgumentError` surfaces per NFR-10 with the `<tracker>:<id>` remedy. Full decision table: `docs/resolver-entry.md`.
   - **0.b″ Branch proposal (STE-64)** — Between 0.b′ and 0.c, if Schema L carries `branch_template:`, call `isCurrentBranchAcceptable(currentBranch, scope)` from `adapters/_shared/src/branch_proposal.ts`. Unacceptable ⇒ run a single LLM pass for `{type, slug}`, render via `buildBranchProposal`, and prompt `[Y] accept / [e] edit / [n] abort`. `Y` → `git checkout -b`; `n` → clean exit, zero side effects (no claim below); `git checkout -b` failure → NFR-10 refusal, exit non-zero (AC-STE-64.8). Absent `branch_template:` ⇒ skip entirely (AC-STE-64.1, backward-compat). Full decision logic + prompt flow in `docs/implement-reference.md` § Branch Proposal (STE-64).
   - **0.c Claim** — Entry gate. Tracker mode: run the per-FR claim sequence in `docs/implement-tracker-mode.md` § Claim runbook. The four-way routing (`claimed` / `already-ours` / `taken-elsewhere` / `already-released`) is per the runbook's decision steps (AC-STE-28.1/2). `mode: none`: `LocalProvider.claimLock` writes `.dpt-locks/<id>` (the runbook does not apply — no tracker writes in `mode: none`).
   - **0.e Claim verification (Phase 1-exit self-check, tracker mode only)** — Before entering Phase 2, re-fetch the ticket via `mcp__<tracker>__get_issue(<id>)` and assert (1) `status == status_mapping[in_progress]` AND (2) `assignee == currentUser`. Mismatch ⇒ NFR-10 canonical refusal naming the ticket + observed status/assignee, and hard-refuse to enter Phase 2: the LLM must go back and run 0.c per the Claim runbook before retrying. `mode: none` skips this step entirely (LocalProvider's `local-no-tracker` sentinel makes the assertion vacuous). This early-stage gate complements `/gate-check` probe #14 (active-side ticket-state drift, M24 STE-87) which catches the same failure mode at gate time.
   - **0.d Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker hooks below skip. If a tracker mode is active:
     - **Ticket-binding pre-flight** — 3-tier resolver + confirmation prompt per `docs/ticket-binding.md` (STE-27). Branch-regex mismatch fails loudly (AC-STE-27.3); decline exits cleanly (AC-STE-27.4).
     - **Record `updatedAt` (post-claimLock)** — After step 0.c `claimLock` has succeeded, call the adapter's `pull_acs(ticket_id)` and store the ticket's `updatedAt` in-session for `/gate-check` to compare later (AC-STE-11.2, STE-45 AC-STE-45.1). Recording **after** claimLock is load-bearing: `claimLock` itself mutates the ticket (sets status + assignee), so recording before would cause `/gate-check` to flag the skill's own write as drift. Same rule applies to any other tracker-writing pre-flight step — record `updatedAt` after all pre-flight side effects settle (AC-STE-45.5).
     - **STE-17 diff/resolve** — Run the bidirectional AC sync loop before proceeding past Phase 1 (AC-STE-17.1, AC-STE-17.3, AC-STE-17.4).
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

9. **Spec deviation check** — If reality contradicts the spec, STOP coding forward and classify: `underspecified` (backfill + test + continue), `ambiguous` (provisional decision + user confirm at Phase 4), `contradicts` (wait for user decision), `infeasible` (wait). Always backfill edge cases to `specs/requirements.md` / `specs/technical-spec.md` plus a test. Full playbook (assess-already-written-code rule + per-class resolution detail + backfill invariant): `docs/implement-reference.md` § Spec Deviation Check.

### Spec Breakout

If the current milestone accumulates 3 or more `contradicts` / `infeasible` deviations (configurable via CLAUDE.md threshold; default 3), STOP, emit a **Spec Breakout report** listing every deviation with classification + proposed resolution, and recommend a spec rewrite for the affected areas before resuming. Breakout is a valid output, not a failure. Full report shape: `docs/implement-reference.md` § Spec Breakout.

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

   h. **Decision:** GATE PASSED ⇒ exit loop. GATE PASSED WITH NOTES ⇒ carry notes into the Phase 4 report, exit loop. Issues on round 1 ⇒ fix + re-run gate + go to round 2. Issues on round 2 ⇒ escalate to user (same types = going in circles; new types = diminishing returns). Full decision matrix: `docs/implement-reference.md` § Round Resolution.

   i. **After any fix** — re-run the full gate fresh, cite actual numbers (e.g., "47 tests, 0 failures, 0 errors"). Never claim clean from memory.

## Phase 4: Report & Handoff

Phase 4 has four labeled sub-steps executed in order:

- **Phase 4a** — gate check passed (final step of Phase 3; no new logic here — the green gate is the entry ticket to Phase 4).
- **Phase 4b** — doc fragment (STE-74) — writes `docs/.pending/<fr-id>.md` when docs generation is enabled.
- **Phase 4c** — report (step 14) + human approval (step 15).
- **Phase 4d** — Close procedure (commit → `Provider.releaseLock` → `Provider.getTicketStatus`).

### Phase 4b: Doc fragment (STE-74)

Non-blocking hook. Sits between Phase 4a (gate pass) and Phase 4c (report + approval) / 4d (Close).

1. **Gate.** Call `readDocsConfig(CLAUDE.md)` from `adapters/_shared/src/docs_config.ts`. Both `userFacingMode` and `packagesMode` `false` — or the `## Docs` section absent — ⇒ **silent no-op**: no log line, no deviation-report row, zero output (AC-STE-74.3). Preserves the byte-identical surface for projects that don't use docs generation.
2. **Invoke.** Run `/docs --quick` with a 60-second timeout. The current FR ID is resolved the same way manual `/docs --quick` resolves it — via `branch_template:` mapping, diff scan, or `_unbound-<ts>` fallback (see `skills/docs/SKILL.md` § `/docs --quick`) (AC-STE-74.2). No new `/implement` flag is introduced (AC-STE-74.8) — temporarily skip by flipping Schema L docs keys.
3. **Success row.** Append exactly this row to the Spec Deviation Summary table (AC-STE-74.4):

   ```
   | Doc fragment | added | docs/.pending/<fr-id>.md | — |
   ```

4. **Failure or timeout (non-blocking).** A non-zero exit, thrown error, or 60s timeout is logged as a warning and appended as the skipped row (AC-STE-74.5):

   ```
   | Doc fragment | skipped (error) | — | /docs --quick failed: <first-line-of-error>. Run manually after commit to retry. |
   ```

   Phase 4 **continues to Phase 4c** — the implementation commit does not block on a failed fragment write. A missing fragment is better than a failed implementation commit.
5. **Timeout path.** The 60-second cap routes through the failure path with the literal error text `timeout after 60s` (AC-STE-74.6).

Full decision table (resolver fallback ordering, which directory `_unbound-*` fragments live in, diagnostic log shape) lives in `docs/implement-reference.md` § Phase 4b Doc Fragment Hook.

### Spec Deviation Summary

Before updating specs, compile all deviations discovered during Phase 2:

| Deviation | Classification | Resolution | Needs Confirmation? |
|-----------|---------------|------------|---------------------|
| *description* | underspecified / ambiguous / contradicts / infeasible | *what was done* | No / **Yes** |

Classification types (matching Phase 2 step 9): `underspecified`, `ambiguous`, `contradicts`, `infeasible`.

Rule: any row with Classification = `ambiguous` must have Needs Confirmation? = `**Yes**` (these are provisional decisions requiring user approval).

### Milestone Archival

After the human approves the Phase 4 report (step 15), and **only then**, archive every FR belonging to the completed milestone plus the milestone's plan file. This keeps `specs/frs/` and `specs/plan/` size bounded regardless of project age.

- **technical-spec.md is never auto-archived** — architectural decisions use `Superseded-by:` in place (the ADR convention). `/implement` archival touches only `specs/frs/**` and `specs/plan/<M#>.md`.
- Run archival **only after explicit human approval in step 15**, never before. If the user asks for changes instead, abort archival entirely.
- Single-FR runs (`/implement <FR-id>`) intentionally leave `status: active`; bulk archive a completed milestone via `/spec-archive M<N>` before running `/ship-milestone` (STE-83 — this is the canonical pre-step `/ship-milestone` refusal #1 points to in the tracker-Done-but-file-active case).

**Procedure (STE-22).** For every FR with frontmatter `milestone == <current>`: compute the base filename via `Provider.filenameFor(spec)` (M18 STE-60 AC-STE-60.4) and run `git mv specs/frs/<name> specs/frs/archive/<name>` + flip frontmatter `status: active` → `status: archived` + set `archived_at: <ISO now>`. The stem is preserved across the move — `/spec-archive` and `/implement` never rename during archival (NFR-15 filename-permanence holds). All N moves and N flips land in one atomic commit (AC-STE-22.2, AC-STE-22.6). Then `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` (AC-STE-21.5) in the same commit, **and apply the same status flip to the plan file's frontmatter** — flip `specs/plan/<M#>.md` `status: active` → `status: archived` and set `archived_at: <ISO now>` (the same timestamp used for the FR flips). This **plan-status flip** is part of the same atomic commit as the FR moves and the plan `git mv` (AC-STE-92.3); read-side enforcement is `/gate-check` probe #16 (`archive_plan_status`). Call `Provider.releaseLock(id)` for each released FR (AC-STE-28.4). Full details: `docs/layout-reference.md` § `/implement`.

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

15. **Wait for approval, then run the Close procedure** — Ask the user to review before committing. Do NOT commit until the user explicitly says so.

    ### Phase 4 Close (atomic — all three steps required, in order)

    Once the user approves, execute the Close procedure end-to-end. Phase 4 does not exit cleanly unless all three sub-steps complete; if any sub-step fails, surface the failure and exit non-zero so the next run can resume through the `already-ours` path.

    **(a) `git commit`** — create the final commit (includes any FR archive moves from § Milestone Archival on a full-milestone run).

    **(b) Release** — for every ticket that was claimed during Phase 1 in tracker mode, run the per-FR release sequence in `docs/implement-tracker-mode.md` § Release runbook. Tracker mode: transitions the ticket to the adapter's canonical Done status; the runbook also performs the STE-65/STE-84-narrowed pre-state assertion (In Progress **or** canonical Done — any other pre-state surfaces a `TrackerReleaseLockPreconditionError` per NFR-10) before the Done transition, so the `Backlog → Done` silent-leap guardrail still holds. `mode: none`: deletes `.dpt-locks/<id>` (runbook does not apply). **No exit path through Phase 4 skips this step.** If the release sequence fails, Phase 4 fails loudly — never swallow the error. On a full-milestone run where § Milestone Archival already released each archived FR (AC-STE-28.4), skip the per-ticket call here for those same FRs (AC-STE-47.6 double-call avoidance). Two outcomes — `transitioned` (normal path) and `already-released` (STE-84 idempotent-terminal branch, ticket was already at canonical Done, no write performed) — are both valid exit paths; step (c)'s post-release verification runs identically for both.

    **(c) Post-release verification** — for each released FR, run step 4 of `docs/implement-tracker-mode.md` § Release runbook and **assert** the returned `status` matches the adapter's `status_mapping.done` canonical name. A mismatch means the release reported success but the tracker didn't move (silent no-op trap). Surface an NFR-10-canonical refusal naming the ticket + observed vs. expected status, and exit Phase 4 non-zero so the human can intervene. In `mode: none`, `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel; treat the sentinel as vacuously passing the assertion — the deterministic `.dpt-locks/<id>` deletion in step (b) is the proof-of-release for `mode: none`.

    **Abort boundary (AC-STE-47.3) — do NOT call `releaseLock` or `getTicketStatus`** when any of the following happen: a gate-check failure, a Spec Breakout, a user rejection at step 15, or any Phase 1–3 early exit. In every abort case, the lock stays so a follow-up run can resume through the `already-ours` path (AC-STE-28.1). The Close procedure only runs once the user explicitly approves **and** `git commit` lands.

    The Pattern 9 byte-diff regression gate against the `mode-none-v2` fixture continues to pass because the cleanup was already part of the existing mode-none flow.

## Phase 5: Milestone close prompt (STE-75)

Fires only on a **milestone-scope** invocation (`/implement M<N>`) that shipped every FR cleanly. Opt-in chain into `/ship-milestone M<N>` — a prompt, not a silent chain. Phase 5 is the **last thing** `/implement` does before process exit; nothing else runs between the prompt (or its skip path) and exit.

### Conditions (evaluated in order)

1. **Invocation shape.** Skip entirely if `$ARGUMENTS` is a single-FR arg (e.g., `STE-42`, a ULID, a URL), the literal `all` / `remaining`, or empty / no arg. Only an `M<N>` arg qualifies.
2. **Milestone completeness.** Re-read `specs/plan/M<N>.md`; confirm every listed FR transitioned from `status: active` to `status: archived` during this run. If any FR remains active or if any FR's gate-check failed this session (partial success), skip entirely. No output about `/ship-milestone`.
3. **TTY.** Check whether stdin is a TTY (proxy: interactive Claude Code session accepting user replies). Non-TTY / CI context / piped stdin ⇒ print the manual-command hint (AC-STE-75.4), do not prompt, do not read stdin.

If all three conditions pass, print the prompt and read one line from stdin.

### Prompt (AC-STE-75.1, exact format including the blank line)

```
All FRs in M<N> shipped.

Run /ship-milestone M<N> now? (y/n):
```

### Branches

- **Accept** — user input is `y` or `yes` (case-insensitive, trimmed). Chain into `/ship-milestone M<N>` in-process. All of `/ship-milestone`'s own gates still fire — the release commit is gated by its own `Apply? [y/N]` prompt on the release diff (AC-STE-75.6). The `y` here does **not** pre-approve the release; it only starts `/ship-milestone`. Refusal at that second gate exits cleanly without a release commit (AC-STE-75.6).
- **Decline** — user input is `n`, `no`, empty (just Enter), or any other non-matching string (case-insensitive). Do not chain; print the hint below and exit 0.

### Hint (AC-STE-75.3, exact literal — also used on the non-TTY skip path)

```
Ready to close milestone. Run: /ship-milestone M<N>
```

### Chain-failure refusal (AC-STE-75.5)

If the user accepts but `/ship-milestone` fails to start (skill not registered, `skills/ship-milestone/` missing, etc.), surface this NFR-10-shape refusal and exit non-zero:

```
/implement: attempted to chain into /ship-milestone but it failed to start: <error>.
Remedy: verify the skill is installed (check plugins/dev-process-toolkit/.claude-plugin/plugin.json), then run /ship-milestone M<N> manually.
Context: milestone=M<N>, chain=ship-milestone, skill=implement
```

### Skip-case summary

| Case | Behaviour |
|------|-----------|
| Single-FR arg (e.g., `STE-42`, ULID, URL) | silent skip — no prompt, no hint |
| `all` / `remaining` / no arg | silent skip — no prompt, no hint |
| Any FR in `specs/plan/M<N>.md` still `status: active` | silent skip — milestone isn't done |
| Any FR's gate-check failed this run | silent skip — partial success |
| Non-TTY stdin (CI, piped input) | print hint, no prompt, no stdin read |
| All conditions met | print prompt, accept `y`/`yes` (chain) or anything else (hint + exit 0) |

## Rules

- Do NOT proceed if the gate check fails — fix first
- Do NOT skip tests — always write tests before implementation
- Do NOT commit without user approval
- Do NOT self-review more than 2 rounds — escalate instead of looping
- Do NOT silently work around a broken spec — update the spec first (see Phase 2 step 9)
- Do NOT let edge cases live only in code — always backfill specs
- Do NOT modify or delete existing tests to make new code pass — if an existing test fails, either the new code is wrong or the spec changed (and spec changes need user approval)
- Tracker writes during /implement are exactly the calls in the Claim and Release runbooks (`docs/implement-tracker-mode.md` § Claim runbook, § Release runbook) — claim at Phase 1 step 0.c, release at Phase 4d step (b). Other tracker writes mid-flow (raw `mcp__<tracker>__save_issue` / `mcp__<tracker>__transition_status` for arbitrary field updates, AC toggles outside STE-17, etc.) are forbidden. Read operations (`mcp__<tracker>__get_issue` for display, the runbooks' own re-fetches) are permitted. Rationale: STE-65's guardrail (no Backlog → Done leap) only fires on the runbook path; ad-hoc MCP writes bypass it.
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
- "The spec says X but Y works better" / "It's just a small edge case, no need to update specs" → update the spec first, backfill now / "Just this once" → there is no just this once

## Architecture Note

This skill runs in-process in the main session — deliberately **not** `context: fork`. Phase 3 Stage B spawns the `code-reviewer` subagent via the `Agent` tool, and Claude Code forbids nested subagent spawns (*"Subagents cannot spawn other subagents"*). The review-fix loop additionally requires findings to flow back to the same implementer that wrote the code, so the chain-the-reviewer-after-`/implement`-returns workaround also breaks. See `docs/patterns.md` § Pattern: `/implement` Runs In-Process for the full rationale.
