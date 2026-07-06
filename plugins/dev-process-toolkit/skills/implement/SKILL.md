---
name: implement
description: Implement a feature or fix end-to-end. Analyzes the request, builds in TDD order, runs gate checks, self-reviews with bounded loops, and reports for human approval before committing.
argument-hint: '<milestone, task description, issue number, "next", or "all">'
---

# Implement

Implement the following end-to-end: `$ARGUMENTS`

## Invocation forms

Two shapes diverge at Phase 5. **`/implement <FR-id>`** to **ship one FR** (most common — smoke driver + `/spec-write`'s next step); **`/implement M<N>`** to **close out a milestone** (every active FR + Phase 5 close + archival). End states differ by design (STE-83): single-FR leaves FR + milestone `status: active`; milestone form archives both on green gate. If single-FR + plan fully checked, `/gate-check` probe #14 fires the **STE-180 advisory** (`M<N> plan fully checked but not archived — run /spec-archive M<N> or /implement M<N> to close`) — the gate tells you, not memory.

| Phase | `/implement <FR-id>` | `/implement M<N>` |
|-------|----------------------|---------------------|
| 0 (Pre-flight) | single FR's binding | every active FR in M<N> |
| 1 (Tracker claim) | claims one ticket | claims every ticket |
| 2 (Plan analysis) | plans tasks for the FR | plans every FR's tasks, dep-ordered |
| 3 (TDD loop) | builds the FR | builds every FR |
| 4 (Commit + close) | one feature commit + tracker → Done | one commit per FR + each tracker → Done |
| 5 (Milestone close) | **silent-skip** (no prompt, no archival) | **runs it** — close prompt + archival sweep |

## Pre-flight: Branch Isolation

Ask the user: "Work in a **git worktree** (isolated branch) or on the **current branch**?" — worktrees let failed runs be discarded cleanly; current branch starts immediately.

If worktree: derive a branch name from the task (e.g., `feat/user-auth`), run `git worktree add ../<branch-name> -b <branch-name>`, install dependencies for the detected stack (`npm install`, `uv sync`, `cargo build`, `go mod download`, etc.), and perform all Phase 1–4 work inside the new directory. On success, tell the user how to merge back; on failure, offer `git worktree remove <path> --force`.

### Partial Failure Recovery

If a multi-milestone worktree run partially succeeds, list completed work (milestones + commit hashes) and the failing milestone, then offer three recovery options: **cherry-pick** completed commits onto `main` (`git cherry-pick <hash>...`), **continue** in the worktree after a fix (`cd <path>`, resume `/implement`), or **discard** the worktree (`git worktree remove <path> --force`).

## Phase 1: Understand

> Do not read `specs/frs/archive/` or `specs/plan/archive/` during implementation — archived FRs and milestones are historical context only.

0. **Tracker-mode probes** — Before any other action:

   - **0.a Tracker availability pre-flight (STE-199 AC-STE-199.4 / AC-STE-199.5)** — When `mode != none`, before any other Phase 1 step, enumerate the available tool list and check for `mcp__<tracker>__*` patterns. If zero matching tools are loadable in this session, branch on `--code-only`: with the flag, log `tracker_skipped: pre-flight probe failed; --code-only flag honored` and proceed through the code-only path (skips 0.c/0.d/0.e and Phase 4d release transition); without the flag, refuse with NFR-10 canonical shape: `"Tracker <tracker> configured in CLAUDE.md but mcp__<tracker>__* tools are not available in this session. Remedy: run \`claude /mcp\` to (re)authenticate, or re-invoke with --code-only for a degraded tracker-skipped run."` Surface a `tracker_skipped` capability row in the closing summary for each step the `--code-only` path skips. Vacuous on `mode: none`. Behavior identical to `mode: none` for the duration of the run; CLAUDE.md is **not** edited by `--code-only`.
   - **0.b Provider resolution** — Resolve `Provider` once per invocation: `LocalProvider` if `mode: none` (or `--code-only` flag set), `TrackerProvider` wrapping the configured tracker adapter otherwise. No re-resolution mid-execution. ACs come from `specs/frs/<ulid>.md`; Phase 4 archives via `git mv`; `Provider.claimLock`/`releaseLock` gates entry/exit per the Provider lifecycle contract.
   - **0.b′ Resolver entry** — Call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry, then pass the result to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. Never hand-assemble the config inline; malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal. Route by `kind`: `ulid` → proceed to 0.c with that ULID; `tracker-id` / `url` → branch on mode: tracker mode uses `findFRPathByTrackerRef(specsDir, trackerKey, trackerId)`, `mode: none` uses `findFRByTrackerRef(specsDir, trackerKey, trackerId)`; on hit, proceed to 0.c; on miss, run `importFromTracker(...)` then proceed. **`milestone` (STE-202 AC-STE-202.3)** → read the milestone plan file at `specs/plan/<milestone>.md` and run the milestone-scope flow per § Invocation forms; `fallthrough` → continue to step 2 for free-form argument handling. Branch-name interop: if the branch name contains a ticket ID that disagrees with the argument's resolved ticket, **the argument wins** with an NFR-10-shape warning. Full decision table: `docs/resolver-entry.md`.
   - **0.b′¹ `needs_technical_review` refusal (STE-227 AC-STE-227.6)** — Immediately after 0.b′ resolves a single FR (`kind: ulid` / `tracker-id` / `url`) and **before** 0.b″ branch proposal and 0.c claim, read the resolved FR's frontmatter at `frFilePath`. If `needs_technical_review: true`, hard-refuse with NFR-10 canonical shape: Verdict `"/implement refused — FR <id> flagged needs_technical_review; technical sections are placeholders."` and Remedy `"Run /spec-write <FR-id> to complete the technical design + testing sections, then re-invoke /implement."` (substitute `<FR-id>` with the resolved ID). Emit the `implement_refused_needs_technical_review` capability row in the closing summary, then exit non-zero. **No claim, no branch, zero side effects** — refusal fires before 0.b″ and 0.c so nothing is mutated on disk or on the tracker.
   - **0.b′² `needs_technical_review` milestone-scope refusal (STE-227 AC-STE-227.7)** — When 0.b′ resolves `kind: milestone` to `M<N>`, before any claim cycle starts, enumerate every active FR in scope: glob `specs/frs/*.md`, filter by frontmatter `milestone: M<N>` AND `status: active`, then collect every FR whose frontmatter has `needs_technical_review: true` into a flagged-list. If the flagged-list is non-empty, hard-refuse the **whole milestone** with NFR-10 canonical shape: Verdict `"/implement refused — milestone M<N> contains <N> FR(s) flagged needs_technical_review."` and Remedy `"Run /spec-write <FR-id> (no flag) for each flagged FR, then re-invoke /implement M<N>:\n  - <id-1>\n  - <id-2>\n  - …"` — the remedy **enumerates every flagged FR** so the reviewer can address them in one batch (no whack-a-mole). Emit the `implement_refused_needs_technical_review` capability row in the closing summary, then exit non-zero. **Refusal fires before any claim** — no per-FR claim cycle starts, no branch is proposed, no tracker write happens; nothing is mutated on disk or on the tracker for any FR in the milestone.
   - **0.b″ Branch proposal** — Between 0.b′ and 0.c, if Schema L carries `branch_template:`, call `isCurrentBranchAcceptable(currentBranch, scope)` from `adapters/_shared/src/branch_proposal.ts`. Unacceptable ⇒ run a single LLM pass for `{type, slug}`, render via `buildBranchProposal`, prompt `[Y] accept / [e] edit / [n] abort`. `Y` → `git checkout -b`; `n` → clean exit, zero side effects. Absent `branch_template:` ⇒ skip entirely. **Trunk-OK allowlist (STE-228 supersedes STE-202 AC-STE-202.5):** the trunk-OK list narrows to `TRUNK_OK_TYPES = ["ci"]` only — `chore` and `docs` no longer ship directly to trunk. When the type is `ci`, the proposal flow accepts the trunk branch as-is. For every other type (`feat`, `fix`, `refactor`, `perf`, `chore`, `docs`), the derived branch is enforced. The same constant is consumed by `requireCommittableBranch` from `adapters/_shared/src/require_committable_branch.ts`, the universal pre-commit gate every commit-producing skill calls before staging — see STE-228 § Branch-name canonical table for the full per-skill builder mapping. Full decision logic in `docs/implement-reference.md` § Branch Proposal.
   - **0.c Claim** — Entry gate. Tracker mode: run the per-FR claim sequence in `docs/implement-tracker-mode.md` § Claim runbook. Four-way routing (`claimed` / `already-ours` / `taken-elsewhere` / `already-released`) per the runbook's decision steps. `mode: none`: `LocalProvider.claimLock` writes `.dpt-locks/<id>`.
   - **0.d Claim verification (Phase 1-exit self-check, tracker mode only)** — Before entering Phase 2, re-fetch the ticket via `mcp__<tracker>__get_issue(<id>)` and assert (1) `status == status_mapping[in_progress]` AND (2) `assignee == currentUser`. Mismatch ⇒ NFR-10 canonical refusal naming the ticket + observed status/assignee; hard-refuse to enter Phase 2. `mode: none` skips this step. Complements `/gate-check`'s active-side ticket-state drift probe at gate time.
   - **0.e Project-milestone attach (any adapter with `project_milestone: true` — Linear + Jira, idempotent)** — In tracker mode with `project_milestone: true`, after 0.d succeeds, read the FR's `milestone:` frontmatter and call `planFileHeadingToMilestoneName(specs/plan/<milestone>.md)` from `adapters/_shared/src/attach_project_milestone.ts`. Then call `attachProjectMilestone(provider, project, canonicalName, ticketId)` — Linear binds the native project milestone, Jira read-merge-writes the `milestone-<M-token>` label. Idempotent on already-bound tickets. Vacuous on archived FRs, `mode: none`, and adapters with `project_milestone: false`. `MilestoneAttachmentError` surfaces per NFR-10; on a **permanent** attach failure (transient retries exhausted, or a non-transient binding mismatch) the closing summary MUST emit `milestone_attach_failed` as a loud warning-severity capability row — never a plain informational line. **All-paths guarantee:** the attach + verify runs per FR on **every** `/implement` path, before that FR's Phase 4 close — the single-FR path (`/implement <FR-id>`) runs it here; the milestone-scope path (`/implement M<N>` fan-out, one `/tdd` orchestrator per FR) runs 0.e inside each FR's claim cycle, never once-per-milestone.
   - **0.f Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and tracker hooks below skip. If a tracker mode is active:
     - **Ticket-binding pre-flight** — 2-tier ticket-binding resolver + confirmation prompt per `docs/ticket-binding.md`. Branch-regex mismatch fails loudly; decline exits cleanly.
     - **Record `updatedAt` (post-claimLock)** — After step 0.c `claimLock` has succeeded, call the adapter's `pull_acs(ticket_id)` and store the ticket's `updatedAt` in-session for `/gate-check` to compare later. Recording **after** claimLock is load-bearing: `claimLock` itself mutates the ticket, so recording before would cause `/gate-check` to flag the skill's own write as drift. Same rule applies to any other tracker-writing pre-flight step.
     - **Bidirectional AC diff/resolve** — Run the bidirectional AC sync loop before proceeding past Phase 1.
     See `docs/implement-tracker-mode.md` for the full tracker-mode flow.

1. **Check for specs** — If `specs/` exists, check whether spec files have real content. If specs exist but are mostly empty, warn the user: "Specs appear to be incomplete. SDD works best when specs are filled in first. Consider running `/dev-process-toolkit:spec-write` or continue with what's available?" Let the user decide.

2. **Resolve the target** — Determine what to implement based on `$ARGUMENTS`:
   - `next` ⇒ first milestone in `specs/plan/` with unchecked ACs (report `All milestones complete.` if none).
   - `all` / `remaining` ⇒ all milestones with unchecked ACs, run sequentially after presenting the list for approval.
   - Multiple milestones (e.g., `M2 and M3`) ⇒ run sequentially in listed order.
   - Single milestone name (`M1`, `M2`) ⇒ read that milestone from `specs/plan/<M#>.md`.
   - Numeric ⇒ `gh issue view $ARGUMENTS`.
   - Filename in `.tasks/` ⇒ read the task file.
   - Otherwise ⇒ read relevant specs in `specs/` (if present) or treat as task description.

   **Slim closure detection (STE-200 AC-STE-200.3, milestone-scope only).** After the target resolves to `M<N>`, count `claimable_fr_count(M<N>)` — active `specs/frs/*.md` files with `milestone: M<N>` frontmatter. When the count is **zero** AND `evaluatePlanOnlyEligibility(specsDir, "M<N>")` returns eligible (kind: scaffolding OR all-checked), route to **slim closure**: skip claim/build phases, invoke `/spec-archive M<N>` (which auto-takes the plan-only branch per AC-STE-200.1) + surface a `plan_only_archival` capability row in the closing summary; jump straight to Phase 5 (which silent-skips per AC-STE-200.4 on `kind: scaffolding` and zero-FR milestones — no `/ship-milestone` chain prompt fires). Documented as the `/setup`-bootstrap-milestone path.

3. **Read the gate commands** — Read CLAUDE.md and find the gate check commands (look for "Key Commands" or "Gating rule" section). These are the commands you'll use throughout.

4. **Verify baseline health** — Run the gate commands now, before writing any code. If the project is already broken, fix it first (or tell the user). Do not build new features on a broken foundation.

5. **Read relevant code** — Find the files that need to change.

6. **Build the AC checklist** — Extract every acceptance criterion as a binary pass/fail checklist. If no explicit ACs exist, derive them from the description. This checklist is your **definition of done**.

7. **Present the plan** — Show the user: AC checklist, files to create/modify, test strategy. Warn about parallel-conflict risk on shared files (like index.ts barrel exports). Ask for approval before proceeding.

## Phase 2: Build (TDD)

8. **Execute in TDD order via the multi-agent orchestrator** —

   > **TDD Orchestrator Contract.** Violation name: **Inline TDD Antipattern** (writing tests + code in the parent `/implement` context instead of forking the orchestrator). Auditable evidence shape: **N `Skill(/dev-process-toolkit:tdd <FR-id>)` `tool_use` entries where N = FR count in milestone scope** — one orchestrator invocation per FR, no inlined RED→GREEN→REFACTOR in the parent transcript. Residual-risk note: the STE-220→STE-270 prose-falsification chain shows prose alone is falsifiable; the documented escalation path on repeat violation is an **evidence-based gate** (STE-262 / STE-270 pattern) or a **hard mechanic** (STE-225 pattern). Catalog: `docs/honored-contracts.md`.

   **Rationalization Prevention.** The following rationalizations are documented antipatterns — each is preempted here so they cannot be invoked as waivers:

   | Excuse | Reality |
   |--------|---------|
   | Milestone spans N FRs / many ACs — orchestrator cost is too high | Cost is not a contract waiver; orchestrator-per-FR IS the milestone-scope pattern (STE-225). |
   | `/implement M<N>` milestone-scope has no clear "use the orchestrator N times" pattern | N-times IS the pattern: one `Skill(/dev-process-toolkit:tdd <FR-id>)` `tool_use` per FR in scope — N invocations where N = FR count. |
   | Prioritized shipping over process fidelity | Process fidelity IS the ship gate, not its competitor; an FR shipped via inline TDD has not shipped through the contract. |

   invoke `/dev-process-toolkit:tdd <FR-id>` inline (no separate opt-in path). Per STE-225 + STE-296, the orchestrator runs RED → GREEN → REFACTOR → AUDIT via four forked subagents (test-writer once per FR with the full AC list batched; implementer once per AC; refactorer once at end after all GREEN; spec-reviewer once at end post-REFACTOR) with `context: fork` isolation, a strict `tdd-result` fenced-block hand-off contract, and bounded retry (max 2 per role per AC for semantic failures A/B/C/E; single targeted retry for format violation D). Per-stage isolation enforces the test-writer-cannot-see-implementation guarantee deterministically. The orchestrator's halt path **does** pause for the operator — that's intentional, not a pacing violation: halt fires only after the bounded-retry cap is exhausted, so it surfaces a real failure. Routine cycles (no retries) run end-to-end without operator interaction. Follow project patterns from CLAUDE.md.

9. **Spec deviation check** — If reality contradicts the spec, STOP coding forward and classify: `underspecified` (backfill + test + continue), `ambiguous` (provisional decision + user confirm at Phase 4), `contradicts` (wait for user decision), `infeasible` (wait). Always backfill edge cases to `specs/requirements.md` / `specs/technical-spec.md` plus a test. Full playbook: `docs/implement-reference.md` § Spec Deviation Check.

### Spec Breakout

If the current milestone accumulates 3 or more `contradicts` / `infeasible` deviations (configurable; default 3), STOP, emit a **Spec Breakout report**, recommend a spec rewrite for the affected areas before resuming. Breakout is a valid output, not a failure. Full report shape: `docs/implement-reference.md` § Spec Breakout.

10. **Checkpoint** — After completing each logical unit of work (a TDD cycle for a meaningful chunk), create a git commit on the working branch. These intermediate commits are recovery points.

11. **Gate check** — Run the gate commands from step 3. This is the **deterministic kill switch**: if it fails, fix before proceeding. Use `/dev-process-toolkit:debug` for unclear failures.

## Parallelization

For fan-out-friendly tasks (independent files, ≥3 workers worth of work), parallel dispatch via native subagents, agent-teams, or worktree-per-subagent isolation can keep each context clean. See `docs/parallel-execution.md` before dispatching.

## Phase 3: Self-Review Loop (max 2 rounds)

> The gate check is the hard stop. This review loop is the smart stop.

Phase 3 review runs against the code Phase 2 produced via the `/dev-process-toolkit:tdd` orchestrator. If the orchestrator halted (bounded-retry exhausted on mode A/B/C/D/E per STE-225), Phase 2 already escalated to the operator and Phase 3 does not run — the halt report is the surfaced failure. Otherwise Phase 3's gate check is the deterministic backstop that confirms the orchestrator's GREEN-at-exit claim against the project's full gate command (typecheck + lint + tests).

**Spec-review audit capability propagation (STE-296).** When the `/tdd` orchestrator's spec-review audit step fires, `/implement` propagates its outcome through the Phase 4 step 14 closing summary as one of three literal, byte-checkable capability tokens — sourced from the static map in `skills/spec-write/SKILL.md` § 7 (single source of truth for capability-gap rendering):

- audit clean on first pass ⇒ **MUST emit `tdd_spec_audit_passed`** (literal token, backticked).
- audit found missing AC(s) on first pass and a bounded retry round (test-writer + implementer scoped to missing ACs) recovered them ⇒ **MUST emit `tdd_spec_audit_missing_recovered`** (literal token, backticked).
- audit found missing AC(s) on first pass and the bounded retry round did not recover them ⇒ orchestrator halts with `mode: spec-gap` and **MUST emit `tdd_spec_audit_halted`** (literal token, backticked); `/implement` surfaces the unresolved AC list to the operator and exits non-zero before Phase 4 step 15.

The byte-checkable tokens are the structural signals `/gate-check`'s `closing_summary_capability_keys` probe greps for; narrative prose like "spec audit was clean" is insufficient. Plain-language rendered prose lives in the `skills/spec-write/SKILL.md` § 7 static map under the same keys; do not paraphrase at runtime.

**Proportional review:** Scale review depth to change size. Trivial changes (single function, <20 lines, no new modules) need only AC + gate check. Reserve deep review for changes touching multiple modules or new patterns.

Each round has three sequential stages. **Complete each stage before starting the next.** If a stage finds issues, fix them and re-run the gate before proceeding.

12. **Round N (N = 1, 2):**

   ### Stage A — Spec Compliance

   a. **AC check** — Walk the checklist from Phase 1. For each AC:
   - ✓ Pass — implemented and **directly tested** (not just indirectly covered)
   - ✗ Fail — missing or wrong
   - ⚠ Partial — implemented but incomplete or only indirectly tested

   If an AC explicitly names a module or function, verify a test file directly tests that module. Indirect coverage does NOT satisfy an explicit AC.

   b. **Cross-module coverage check** — For every module created or significantly modified, verify direct test coverage. If an AC references a specific module without a dedicated test file, flag it as a gap.

   c. **Assertion quality check** — Scan test files for shallow assertions: `expect(fn).not.toThrow()` / `assert not raises` as the sole assertion, `expect(result).toBeDefined()` / `assert result is not None` without checking the value, type-only checks (`isinstance()`, `typeof`) without verifying content. Tests using only these patterns aren't validating behavior — strengthen them.

   **If Stage A finds issues:** fix, re-run gate check, then proceed to Stage B.

   ### Stage B — Two-Pass Review (delegated to `code-reviewer`)

   Stage B runs two sequential `code-reviewer` invocations via the `Agent` tool: **Pass 1 — Spec Compliance** then **Pass 2 — Code Quality**. Both use `agents/code-reviewer.md`'s canonical rubric; only the prompt differs. Delegation keeps each review in an isolated context.

   **If Pass 1 returns critical findings, do NOT run Pass 2; surface Pass 1 findings and stop.**

   Resolve `<base-ref>` once before either pass: feature branch's merge base (e.g., `git merge-base HEAD main`), `HEAD~1` on a hotfix on main, or `HEAD` if Phase 2 left uncommitted changes.

   ### Pass 1: Spec Compliance

   Runs only if `specs/requirements.md` exists. Otherwise skip silently and run Pass 2 as the sole review (graceful degradation).

   d. **Invoke `code-reviewer` via the `Agent` tool** with this prompt:

   ```
   Pass 1 — Spec Compliance. Check whether every change in the diff traces to an acceptance criterion in specs/requirements.md, and flag any code with no corresponding AC (undocumented behavior).

   Changed files (name + status):
   <paste output of: git diff --name-status <base-ref>>

   Acceptance criteria from Phase 1 (this IS your concern):
   <paste AC checklist>

   Read specs/requirements.md directly. Use your Read tool to open each changed file. Return findings in the Pass-Specific Return Contracts shape documented in agents/code-reviewer.md (one line per AC: OK or CONCERN, plus OVERALL).
   ```

   e. **Integrate Pass 1:**
   - `OVERALL: OK` → Pass 1 passes; run Pass 2.
   - `OVERALL: CONCERNS` (critical: undocumented features or missing AC coverage) → fail-fast. Skip Pass 2. Report Pass 2 as the literal line `Pass 2: Skipped (Pass 1 critical findings)` — never silently omitted. Fix findings, re-run gate check, then re-invoke Pass 1 on round 2 — if round 2 still fails, escalate.

   ### Pass 2: Code Quality

   Runs only if Pass 1 returned `OVERALL: OK`, or Pass 1 was skipped because `specs/` does not exist.

   f. **Invoke `code-reviewer` via the `Agent` tool** with this prompt:

   ```
   Pass 2 — Code Quality. Review changes against the canonical rubric (quality, security, patterns, stack-specific). Do NOT check spec compliance — Pass 1 (or /spec-review) owns that.

   Changed files (name + status):
   <paste output of: git diff --name-status <base-ref>>

   Acceptance criteria from Phase 1 (context only, not your concern):
   <paste AC checklist>

   Read the project's CLAUDE.md for stack-specific patterns. Use your Read tool to open each changed file you need to inspect — the caller has not inlined the diff bodies. Return findings in the exact shape documented at the bottom of agents/code-reviewer.md.
   ```

   g. **Integrate Pass 2** — one line per criterion (`<criterion> — OK` or `<criterion> — CONCERN: file:line — <reason>`), ending with `OVERALL: OK` or `OVERALL: CONCERNS (N)`.
   - `OVERALL: OK` → Stage B passes; proceed to Stage C.
   - `OVERALL: CONCERNS` → fix each concern, re-run gate check, then re-invoke Pass 2 if you're still on round 1. On round 2, escalate.
   - **Either subagent errors or returns an unparseable shape** → fall back to reading `agents/code-reviewer.md` and executing the corresponding pass's rubric inline. Never skip Stage B because delegation failed.

   **Stage B report aggregates under two subheadings:** `### Pass 1: Spec Compliance` and `### Pass 2: Code Quality`. The Pass 2 block must exist even when skipped (use the literal skipped line above). **Advisory-note capture:** when the round-2 escalation routes one or more Pass 2 CONCERNS to **advisory** rather than gate-blocking, capture each in `advisoryNote[]` — record schema `{ pass: 2, concern, rationale, classification: 'advisory' }` — before exiting Stage B. The array threads into Phase 4 step 14 and § Milestone Archival via a single shared formatter; without this capture, advisory concerns disappear from `claude -p` runs (caught by an earlier smoke-test). Full schema + rationale: `docs/implement-reference.md` § Advisory Notes.

   ### Stage C — Hardening (first round only)

   After Stage B passes on round 1, run a hardening pass. Skip on round 2 (diminishing returns). Cover negative/edge-case tests + an error-path audit. See `docs/implement-reference.md` § Phase 3 Stage C — Hardening Pass.

   ### Decision (deterministic, not vibes)

   h. **Decision:** GATE PASSED ⇒ exit loop. GATE PASSED WITH NOTES ⇒ carry notes into Phase 4 report, exit loop. Issues on round 1 ⇒ fix + re-run gate + go to round 2. Issues on round 2 ⇒ escalate to user. Full matrix: `docs/implement-reference.md` § Decision matrix.

   i. **After any fix** — re-run the full gate fresh, cite actual numbers (e.g., "47 tests, 0 failures, 0 errors"). Never claim clean from memory.

## Phase 4: Report & Handoff

Four labeled sub-steps in order: **Phase 4a** (gate-check passed — no new logic), **Phase 4b** (doc fragment hook; writes `docs/.pending/<fr-id>.md` when docs generation is enabled), **Phase 4c** (report at step 14 + human approval at step 15), **Phase 4d** (Close procedure: commit → `Provider.releaseLock` → `Provider.getTicketStatus`).

### Phase 4b: Doc fragment

Non-blocking hook between Phase 4a (gate pass) and Phase 4c (report + approval). Call `readDocsConfig(CLAUDE.md)` from `adapters/_shared/src/docs_config.ts`; both `userFacingMode` and `packagesMode` false (or `## Docs` absent) ⇒ **silent no-op**, zero output. Otherwise run `/docs --quick` with a 60s timeout (FR ID resolves via `branch_template:` mapping, diff scan, or `_unbound-<ts>` fallback — no new flag). On success append `| Doc fragment | added | docs/.pending/<fr-id>.md | — |` to the Spec Deviation Summary table; on non-zero exit / thrown error / 60s timeout (text: `timeout after 60s`) append `| Doc fragment | skipped (error) | — | /docs --quick failed: <first-line-of-error>. Run manually after commit to retry. |` and continue to Phase 4c — the implementation commit never blocks on a failed fragment write. Full decision table (resolver fallback ordering, log shape): `docs/implement-reference.md` § Phase 4b Doc Fragment Hook.

**Phase 4b' — cross-cutting spec propagation (STE-215).** Between the doc-fragment hook and Phase 4c. Derive `deletedFiles[]` from `git diff --name-status <baseline>..HEAD --diff-filter=D` (never recall from session memory) and call `scanCrossCuttingSpecRefs(removedPath, specsDir)` from `adapters/_shared/src/scan_cross_cutting_spec_refs.ts` per deleted path — the helper is detection-only, returning per-file lists of `{line, snippet, kind: 'treeLeaf' | 'proseMention'}` hits. **For every `treeLeaf` hit, delete that line in `specs/technical-spec.md` / `specs/testing-spec.md` via the Edit tool** (the line is inside a ``` fence — drop it whole; never rewrite surrounding text). **Prose-mention hits stay untouched** — record their `file:line` + snippet in the propagation commit body so the operator can amend in a follow-up if the surrounding sentence needs restructuring. ≥1 hit across either spec ⇒ emit one follow-up `chore(specs): propagate <removed-path> removal to cross-cutting specs` between the implementation commit and any archival commit; zero hits ⇒ silent no-op. The `cross_cutting_spec_stale_file_refs` `/gate-check` probe is the read-side safety net for paths that bypass this. Full edit policy: `docs/implement-reference.md` § Phase 4b' Cross-Cutting Spec Propagation.

### Phase 4b″ — Project Verification

Between the Phase 4b′ hook and Phase 4c (step-14 report). Resolve the project's optional check ("verification") skill through a shared discovery-precedence resolver, in strict order:

1. **Declared** — call `readVerificationConfig(CLAUDE.md)` for the `## Verification` block's `verify_skill`. If set, use it verbatim (no scan).
2. **Discover (fallback)** — else call `scanCandidateCheckSkills(projectRoot)` (`adapters/_shared/src/scan_candidate_check_skills.ts`) to scan `.claude/skills/*/SKILL.md` for candidates whose slug matches `*drive*` / `*check*` / `*verify*` or whose frontmatter carries `verify: true`. **Exactly one** candidate ⇒ **offer to adopt** it — on accept, write `verify_skill` into the `## Verification` block, then use it; **never silently** run an undeclared skill.
3. **Ambiguous** — multiple candidates ⇒ list them and ask which to adopt; **never guess**.
4. **None** — zero candidates and no declared `verify_skill` ⇒ the "no check declared" path. Rather than silently skip, **offer to scaffold** a check skill via the same `scaffoldCheckSkill` generator, **or** — for a small **web** project — to adopt the generic `/dev-process-toolkit:visual-check` as the check. On accept ⇒ write the skill (**MUST emit `verify_skill_scaffolded`**). On decline ⇒ proceed to the step-14 report with a "no verification configured" note (**MUST emit `verify_skill_scaffold_declined`**). It **never writes** a skill without the offer.

**Non-interactive default (autonomous safety).** The path-2 adopt-offer and path-4 scaffold / `visual-check` offer both carry a **safe decline-default** — they are advisory offers, not `requires-input` gates. In a non-interactive / non-TTY autonomous run (e.g. a `claude -p` chain), both offers **default to decline** (no adopt-write, no scaffold), proceed to the step-14 report with the "no verification configured" note (**MUST emit `verify_skill_none_declared`**), and **never block** — an autonomous `/implement` must never stall waiting on a verification offer.

**Run placement + advisory report.** When a check skill is resolved and the mode is not `manual`, run it here — after Phase 4a (gate-check GREEN) and the 4b/4b′ hooks, before the Phase 4c step-14 report — then render its outcome (pass/fail plus a short captured-output summary) as a row in that step-14 report. In `manual` mode `/implement` does **not** auto-run the skill; it prints a one-line reminder naming the resolved skill and how to run it.

**Failure classification + propose (never auto-invoke).** On a failing check, classify the failure as `spec-gap` (built behavior diverges from the intended design/spec) or `impl-bug` (a code defect), and surface a recommendation naming the exact next command — `/dev-process-toolkit:brainstorm` (reopen the design when the spec itself is wrong), `/dev-process-toolkit:spec-write <FR-id>` (amend an under-specified FR), or an inline fix (a self-contained code defect) — as a line in the step-14 report. `/implement` **never** auto-invokes any of them; it only proposes, and the human runs the recommended command.

**`verify_mode` gating of the step-15 commit.** `verify_mode: blocking` gates the Phase 4c step-15 commit approval — a failing check blocks the commit, which is not offered until the check passes or the operator explicitly types an override. `verify_mode: advisory` (the default) reports a failing check in the step-14 report but the step-15 approval still proceeds — the human decides. `verify_mode: manual` never blocks (no auto-run).

**Capability tokens (step-14 closing summary).** The step-14 report emits **exactly one** outcome token (literal, backticked) per verification outcome: pass ⇒ **MUST emit `verify_skill_passed`**; fail under advisory ⇒ **MUST emit `verify_skill_failed_advisory`**; fail under blocking ⇒ **MUST emit `verify_skill_failed_blocking`**; manual-mode reminder ⇒ **MUST emit `verify_skill_manual_reminder`**; no check declared/discovered ⇒ **MUST emit `verify_skill_none_declared`**. Separately (not one of the five outcome tokens), when discovery in step 2 above auto-adopts a single candidate and writes `verify_skill` into `## Verification`, **MUST emit `verify_skill_adopted`** for that adoption event. `/gate-check`'s `closing_summary_capability_keys` probe greps the literals; narrative paraphrase is insufficient.

**Authoring a check skill.** The scaffold-offer (step 4 above) and hand-rolled checks both follow `docs/verification-skills.md` (authoring guide) — see also patterns.md § Pattern 30 (Project-Authored Verification Skills).

### Commit message format

Phase 4 commits use [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — enforced by the `commit-msg` hook installed by `/setup`. The proposed `<type>(<scope>): <title>` (≤ 72 chars) plus body and `Refs: STE-<N>` footer is rendered to the user at the step 14 approval gate **before** step 15 commits, so the user can redirect type/scope before commit. Use `!` for breaking changes (`feat(api)!:`, `feat!:`).

Full type heuristic table, scope-selection rules, and canonical example: `docs/implement-reference.md` § Commit message format.

### Spec Deviation Summary

Before updating specs, compile all deviations discovered during Phase 2 into a table with columns `Deviation | Classification | Resolution | Needs Confirmation?`. Classification ∈ `underspecified` / `ambiguous` / `contradicts` / `infeasible`. Any row with Classification = `ambiguous` must have Needs Confirmation? = `**Yes**`.

### Milestone Archival

After the human approves the Phase 4 report (step 15), and **only then**, archive every FR belonging to the completed milestone plus the milestone's plan file. This keeps `specs/frs/` and `specs/plan/` size bounded.

- **technical-spec.md is never auto-archived** — ADRs use `Superseded-by:` in place. `/implement` archival touches only `specs/frs/**` and `specs/plan/<M#>.md`.
- **`specs/design/` is immutable across archival** — design-reference images under `specs/design/` are never `git mv`'d into `archive/` and never link-rewritten on archival; only the spec markdown moves, the referenced images stay put.
- Run archival **only after explicit human approval in step 15**, never before. If the user asks for changes instead, abort archival entirely.
- Single-FR runs (`/implement <FR-id>`) intentionally leave `status: active`; bulk archive a completed milestone via `/spec-archive M<N>` before running `/ship-milestone`.

**Procedure summary.** For each archived FR, first run `git status --porcelain specs/frs/<name>` and feed the output to `isFRUntrackedInPorcelain(porcelain, frPath)` (`adapters/_shared/src/spec_archive/stage_untracked_fr.ts`). When it returns true, run `git add specs/frs/<name>` *before* `git mv specs/frs/<name> specs/frs/archive/<name>` — otherwise `git mv` falls back to plain `mv` for untracked files and `git log --follow` loses rename history (smoke #6 F2). Then **(STE-210 AC-STE-210.2 — staging-order reorder for tracked-modified FRs):** **(1)** `git mv specs/frs/<name> specs/frs/archive/<name>` first (stem preserved per NFR-15; the rename is staged with the working-tree content at this moment), **(2)** edit the frontmatter at the **new archive path** (flip `status: active → archived` + set `archived_at: <ISO now>`), **(3)** `git add specs/frs/archive/<name>` to re-stage the post-edit content. Editing frontmatter *before* `git mv` would stage the rename with un-flipped index content (the F11 bug — archive commits landing with `status: active`). Optional convenience: `archiveFRWithFlip(repoRoot, frPath, archivedAt) → archivePath` from `adapters/_shared/src/archive_fr.ts` runs the post-`git mv` frontmatter flip and returns the absolute archive path so the caller threads it into `git add`. The three-step caller pattern is `git mv` → `archiveFRWithFlip(...)` → `git add` (the helper covers step 2 only; the git invocations stay in skill prose where the Bash tool runs them). **`archived_at` precision: full ISO-8601 with date + time + Z (e.g., `2026-04-30T17:23:11Z`); not date-only with zeroed time (`2026-04-30T00:00:00Z` is the regression shape).** Render the wall-clock instant of the archive commit via `date -u +%Y-%m-%dT%H:%M:%SZ`, never the shorter `date +%Y-%m-%d` form — the latter rounds to midnight UTC. An earlier smoke caught the LLM-rendered midnight value; the prose is now pedantic so the prompt is unambiguous. **Plan-status flip:** `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` and apply the same `status: active → archived` flip + `archived_at` to the plan frontmatter — same atomic commit, same full-ISO-8601 timestamp (date + time + Z). **Frontmatter-prepend (legacy plans, STE-197 AC-STE-197.4):** if the plan file lacks a `---` YAML frontmatter block at the very top, prepend `---\nstatus: archived\narchived_at: <ISO timestamp>\n---\n\n` before the `# Implementation Plan` H1, in the same atomic commit. Backwards-compat for `/setup`-generated plans written before STE-197 shipped (no frontmatter to flip — synthesize one with the archived state directly). Before staging, call `rewriteArchiveLinks(repoRoot, frId)` per FR (`adapters/_shared/src/spec_archive/rewrite_links.ts`) to rewrite traceability references in `specs/requirements.md`, active plans, archive plans, and CHANGELOG's unreleased prefix. **Append shipped-AC traceability row.** Per archived FR, call `appendTraceabilityRow(repoRoot, frId, acNumbers, implFiles, testFiles)` from `adapters/_shared/src/spec_archive/append_traceability_row.ts` — `acNumbers` is the list of AC indices that shipped (`1, 2, 3, …` from the FR's `## Acceptance Criteria` block); `implFiles` and `testFiles` are derived from `git diff --name-status <baseline>..HEAD --diff-filter=AM` filtered for non-test (`implFiles`) and `*.test.*` (`testFiles`) paths. The helper appends one row of shape `| AC-<frId>.<lo>..<hi> | <impl-files> | <test-files> |` to `specs/requirements.md` § 6 Traceability Matrix; **idempotent on re-run** so a follow-up `/implement` against the same FR detects the existing row and no-ops. Call `cleanupPlanVerifyLines(projectRoot, deletedFiles, addedTestFiles)` (`adapters/_shared/src/spec_archive/cleanup_plan_verify_lines.ts`) to update `verify:` lines that reference deleted paths. **Derive `deletedFiles[]` deterministically** via `git diff --name-status <baseline>..HEAD --diff-filter=D` (parse `D <path>` rows) — never recall from session memory. The helper has a **filesystem fallback** (STE-171 AC-STE-171.3): when `deletedFiles[]` is empty or doesn't match a verify line, it auto-detects path-shaped tokens that don't resolve on disk and treats them as effectively-deleted — same heuristic as `/gate-check` probe #28. The fallback is defense-in-depth only; the explicit `--diff-filter=D` derivation is still the load-bearing input. All moves + flips + rewrites land in **one atomic commit**. On any helper throw, abort cleanly — do not commit, do not call `Provider.releaseLock`; surface NFR-10 canonical refusal naming the offending plan `file:line:column`. Then call `Provider.releaseLock(id)` for each released FR. **Advisory-note persistence:** before staging the archive moves, for each FR, append a `## Implementation notes` body section to the FR markdown **after** `## Notes` — body is the FR's slice of `advisoryNote[]` rendered via the same shared formatter as Phase 4 step 14 (byte-identical bullet bodies); empty slice ⇒ heading plus the literal line `No advisory notes.` — never absent, so the archived FR carries the audit trail past the session window. Full procedure detail: `docs/implement-reference.md` § Phase 4 Milestone Archival.

#### Post-Archive Drift Check

After the archive move completes, run the post-archive drift check from `skills/spec-archive/SKILL.md` § Post-Archive Drift Check. For Pass B, build the brief from this milestone's context: just-archived milestone + FR IDs, a one-paragraph excerpt of the new archive file's title and goal lines only, and the standard scope-framing instruction. Render the unified Schema I table; offer the 3-choice UX. The drift check never blocks the already-completed archival.

For reopens, cross-cutting ACs, or anything this auto-path can't reach, `/dev-process-toolkit:spec-archive` is the escape hatch.

13. **Update specs** — If implementing a milestone from `specs/plan/<M#>.md`:
    - Update the milestone's acceptance criteria from `- [ ]` to `- [x]` for each AC that passed.
    - If `specs/requirements.md` has a traceability matrix, update Implementation and Tests columns with actual file paths.

14. **Report** — Present: AC checklist with pass/fail status; files created/modified; test coverage (which cases tested; flag modules without direct tests); self-review findings (caught + fixed; what remains); spec changes (edge cases added, deviations resolved, provisional decisions needing confirmation); drift findings (when `specs/` exists); gate check result citing actual output (e.g., `0 failures, 0 errors`); number of review rounds used. **Archival hygiene** — when § Milestone Archival ran, list `rewrote N traceability links in M plan files`, `updated N plan task-list verify lines`, `appended N traceability row(s) to specs/requirements.md § 6`, and `staged N untracked FR file(s) before git mv`. **Advisory notes section:** after the items above, append a `## Advisory notes` section rendering the `advisoryNote[]` list captured in Phase 3 Stage B as **one bullet per advisory entry**, in capture order, body shape `<concern> — <rationale>`. Zero entries ⇒ heading plus the literal line `No advisory notes.` — never absent, so the operator never confuses "no concerns" with "concerns hidden". Shared formatter with the archived-FR write below: bullet bodies are byte-identical.

15. **Wait for approval, then run the Close procedure** — Ask the user to review before committing. Do NOT commit until the user explicitly says so. If a `blocking` Phase 4b″ check failed, do not offer the commit until it passes or the operator overrides.

    ### Phase 4 Close (atomic — all three steps required, in order)

    Once approved, execute the Close procedure end-to-end. Sub-steps (b) and (c) run **only after `git commit` lands** at (a):

    **(a) `git commit`** — final commit (includes any FR archive moves on a full-milestone run).
    **(b) Release** — for every claimed ticket, run `docs/implement-tracker-mode.md` § Release runbook. **No exit path skips this step.** On a full-milestone run where § Milestone Archival already released each archived FR, skip the per-ticket call here for those same FRs (double-call avoidance).
    **(c) Post-release verification** — assert returned `status` matches `status_mapping.done`. Mismatch ⇒ NFR-10 refusal + exit non-zero.

    **Abort boundary — do NOT call `releaseLock` or `getTicketStatus`** on gate-check failure, Spec Breakout, user rejection at step 15, or any Phase 1–3 early exit. The lock stays so a follow-up run can resume through the `already-ours` path. Full Close text + abort cases: `docs/implement-reference.md` § Phase 4 Close.

## Phase 5: Milestone close prompt

Fires only on a **milestone-scope** invocation (`/implement M<N>`) that shipped every FR cleanly. Opt-in chain into `/ship-milestone M<N>` — a prompt, not a silent chain. Phase 5 is the last thing `/implement` does before process exit.

Silent skip cases: single-FR arg (a tracker ID, ULID, or URL), `'all'` / `'remaining'` / no arg / empty invocation, any FR in `specs/plan/M<N>.md` still `status: active`, or any gate-check failed this run (partial success). **Scaffolding-milestone skip (STE-200 AC-STE-200.4):** zero FR files in `specs/frs/` for `M<N>` AND/OR plan frontmatter `kind: scaffolding` ⇒ no chain prompt — scaffolding milestones don't get release-version bumps. Non-TTY stdin (CI / piped) ⇒ print the hint, do not prompt.

Otherwise print the prompt (exact format including the blank line):

```
All FRs in M<N> shipped.

Run /ship-milestone M<N> now? (y/n):
```

- **Accept** — input is `y` or `yes` (case-insensitive, trimmed). Chain into `/ship-milestone M<N>` in-process. All of `/ship-milestone`'s own gates still fire — the release commit is gated by its own deciding `Apply? [y/N]` prompt. The `y` here does not pre-approve the release; refusal at that second gate exits cleanly without a release commit.
- **Decline** — input is `n` / `no` / empty / any other non-matching string. Do not chain; print the hint and exit 0: `Ready to close milestone. Run: /ship-milestone M<N>`.

Chain-failure refusal: if `/ship-milestone` fails to start, surface an NFR-10 shape and exit non-zero:

```
/implement: attempted to chain into /ship-milestone but it failed to start: <error>.
Remedy: verify the plugin is installed and the skill is enabled — `claude /plugin list` lists installed plugins and their skills. Then run /ship-milestone M<N> manually.
Context: milestone=M<N>, chain=ship-milestone, skill=implement
```

Full skip-case table: `docs/implement-reference.md` § Phase 5.

## Rules

- Do NOT proceed if the gate check fails — fix first
- Do NOT skip tests — always write tests before implementation
- Do NOT commit without user approval
- Do NOT self-review more than 2 rounds — escalate instead of looping
- Do NOT silently work around a broken spec — update the spec first (Phase 2 step 9)
- Do NOT let edge cases live only in code — always backfill specs
- Do NOT modify or delete existing tests to make new code pass — if an existing test fails, either the new code is wrong or the spec changed (and spec changes need user approval)
- Tracker writes during /implement are exactly the calls in the Claim and Release runbooks (`docs/implement-tracker-mode.md`) — claim at Phase 1 step 0.c, release at Phase 4d step (b). Other tracker writes mid-flow (raw `mcp__<tracker>__save_issue` / `mcp__<tracker>__transition_status` for arbitrary field updates, AC toggles outside the bidirectional sync loop) are forbidden. Read operations (`mcp__<tracker>__get_issue` for display, the runbooks' own re-fetches) are permitted. Rationale: the runbook's no-Backlog-to-Done-leap guardrail only fires on the runbook path; ad-hoc MCP writes bypass it.
- The gate check (deterministic) always overrides judgment about quality
- ACs are binary (pass/fail) — no "good enough"
- Every AC that names a specific module requires a direct test for that module
- Stage A → Stage B → Stage C — do not blend them
- Before claiming any phase complete, run the gate command fresh and cite actual output. Do NOT claim completion from memory of a previous run.
- Forbidden: "tests pass", "should be fine", "I verified" without citing actual command output

## Red Flags

If you hear yourself thinking any of these, stop and apply the rule anyway:

- "I'll run gate-check after the next task" / "I know the tests pass" → run it now, read actual output
- "This is too simple to need a failing test first" / "I'll test after, it's almost done" → write the test first
- "It should work now" → "should" is not a gate result; "The spec says X but Y works better" / "Just one small edge case" → update the spec first, backfill now

## Architecture Note

This skill runs in-process in the main session — deliberately **not** `context: fork`. Phase 3 Stage B spawns the `code-reviewer` subagent via the `Agent` tool, and Claude Code forbids nested subagent spawns. The review-fix loop additionally requires findings to flow back to the same implementer that wrote the code. Full rationale: `docs/patterns.md` § Pattern: `/implement` Runs In-Process.
