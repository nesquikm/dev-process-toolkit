# `/implement` Reference

Extended reference material for `/dev-process-toolkit:implement` that was extracted from `skills/implement/SKILL.md` to keep the skill file under the NFR-1 line cap. The skill file contains a one-line pointer to this file at the Stage C section.

This reference is **not required reading** on every run — the skill itself has enough guidance to operate. Consult this file when Stage C (Hardening) is run on round 1 of the self-review loop, or when a hardening pass needs concrete examples.

## Phase 3 Stage C — Hardening Pass (first round only)

After Stage B passes on round 1, run a hardening pass before declaring victory. Skip this on round 2 (diminishing returns).

### f. Negative & edge-case tests

For each module created or modified, ask:

- What happens with empty / null / missing input?
- What happens at boundary values (`0`, `-1`, `MAX_INT`, empty string, empty array, single-element array)?
- What happens when an external dependency fails (network error, timeout, malformed response, unexpected status code)?
- Are there race conditions or ordering assumptions? Can two writers clobber each other? Can a reader observe a partial write?
- What happens under concurrent load (if the module is called from multiple callers)?

You don't need to test every combination — focus on the cases most likely to cause real bugs. Add tests for any gaps found. If the module is a pure function with a small input space, consider property-based testing; if it's a state machine, test every transition at least once.

### g. Error path audit

Verify that error handling:

- **Doesn't swallow errors silently** — caught exceptions must either be rethrown, logged with context, or explicitly ignored with a comment explaining why.
- **Doesn't leak sensitive information in error messages** — no raw database errors to the client, no stack traces in production responses, no credentials or PII in logs.
- **Returns appropriate error types/codes at system boundaries** — HTTP 4xx for client errors, 5xx for server errors; typed error unions for internal APIs; specific exception classes, not bare `Exception` catches.
- **Has a retry or fallback strategy where appropriate** — transient failures on external deps usually warrant bounded retry; permanent failures should fail fast.
- **Logs enough context to diagnose** — include the operation name, inputs (redacted), and the downstream error.

### Stack-specific hardening examples

These are illustrative — use the patterns in your project's CLAUDE.md as the authoritative list.

- **TypeScript / Node:** verify `async/await` error propagation (no unhandled rejections); check that `Promise.all` isn't hiding partial failures; confirm `JSON.parse` is wrapped in try/catch at system boundaries.
- **Python:** verify `with` statements close resources on exception; check that `except Exception:` is specific or commented; confirm `asyncio.gather` uses `return_exceptions=True` when partial failure is acceptable.
- **Flutter / Dart:** verify `async` functions return `Future` and are `await`ed; check that `Stream` subscriptions are cancelled in `dispose()`; confirm `tryEmit()` is used on closed BLoCs.
- **Go:** verify every returned `error` is checked; check that deferred `Close()` calls are paired with error handling; confirm context cancellation propagates through goroutines.
- **Rust:** verify `Result` is not discarded with `let _ = ...`; check that `?` propagates errors to the right boundary; confirm `panic!` is only used for truly unreachable states.

## Branch Proposal

Fires at Phase 1 entry, **between resolver (0.b′) and `claimLock` (0.c)** — the branch identity must settle before the lock binds to it.

### Guard

1. Read `branch_template:` from Schema L (the probe already ran in step 0.f; the value is in-session).
   - Absent ⇒ skip the whole step. Branch automation disabled.
   - Present ⇒ continue.
2. Extract the run-scope identifier from the resolver result:
   - Milestone run (`fallthrough` + arg matches `M<N>`) ⇒ `RunScope.kind = "milestone"`, `number = "<N>"`.
   - Tracker-mode FR run ⇒ `RunScope.kind = "fr-tracker"`, `trackerId = <resolved tracker ID>`, plus optional `milestoneNumber = <digits of the FR's milestone: frontmatter>` when the FR is milestone-bound.
   - Mode-none FR run ⇒ `RunScope.kind = "fr-mode-none"`, `shortUlid = spec.id.slice(23, 29).toLowerCase()`, plus the same optional `milestoneNumber`. With `milestoneNumber` present, a word-bounded `m<N>` branch OR the legacy ticket/short-ULID substring is acceptable — both naming generations pass.
3. Call `isCurrentBranchAcceptable(currentBranch, scope)` from `adapters/_shared/src/branch_proposal.ts`. `true` ⇒ skip the proposal (branch already encodes the scope). `false` ⇒ continue.

### Proposal render

4. Derive `type` deterministically via `branchTypeFor({ changelogCategory })` from `adapters/_shared/src/branch_type_for.ts`, where `changelogCategory` is the resolved FR's `changelog_category` frontmatter value (absent ⇒ STE-73 default `Added`); the helper's `noTech` opt never applies in `/implement` — the STE-227 `needs_technical_review` refusal at 0.b′¹ fires before 0.b″ ever runs (documented, not plumbed). Result: `type` ∈ `{feat, fix, chore}`. Then run a single LLM pass over the FR's `## Requirement` section (or the milestone plan file's "Why this milestone exists" section for milestone runs) for `{slug}` only — a 2–4 word kebab-case phrase summarizing the work.
5. Resolve the effective template via `canonicalBranchTemplate({ milestone })` from `adapters/_shared/src/branch_proposal.ts`, where `milestone` is the digits of the resolved FR's `milestone:` frontmatter for FR-scoped runs (milestone runs use the run-arg `<N>`, unchanged) — milestone-bound ⇒ `{type}/m{N}-{slug}`, milestone-less ⇒ `{type}/{ticket-id}-{slug}` fallback. Precedence: an explicit Schema L `branch_template:` value (anything other than the canonical seeded default) wins over the derived form — operator override preserved; the absent-key skip in Guard step 1 is unaffected. Then call `buildBranchProposal({template, type, slug, milestone, trackerId, shortUlid})`. The function:
   - Clamps `{type}` to the allowed set (unknown ⇒ `feat`).
   - Sanitizes `{slug}` to `[a-z0-9-]`, collapses hyphen runs, strips leading/trailing hyphens.
   - Throws `EmptySlugError` if the slug sanitizes to empty (⇒ surface as NFR-10 refusal and re-prompt).
   - Substitutes `{type}`, `{N}`, `{ticket-id}`, `{slug}` into the template.
   - Truncates slug-only if the rendered name exceeds 60 chars.

### Prompt

6. Render: `Create branch '<rendered>'? [Y] accept / [e] edit / [n] abort`.
   - `Y` or `enter` ⇒ `git checkout -b <rendered>`, continue Phase 1 at step 0.c.
   - `e` ⇒ present the rendered name on an editable input line; re-prompt `Y/e/n` on the edited string. No cap on edit iterations, but the user must ultimately press `Y` or `n`.
   - `n` ⇒ exit cleanly with `aborted: branch not created` and **zero side effects** (no `claimLock`, no ticket writes, no file changes).

### Failure handling

7. `git checkout -b` fails (branch already exists with different upstream, uncommitted changes conflict, permissions, etc.): surface the git error via NFR-10 canonical shape and exit non-zero. Never silently proceed on the old branch after a failed checkout.

### Scope boundary

Only `/implement` reads `branch_template:`. `/tdd`, `/debug`, `/spec-write`, `/gate-check`, `/pr`, `/spec-archive`, `/spec-review`, `/visual-check`, `/simplify`, `/brainstorm` never read the key and never prompt for branch creation.

## Milestone Archival Procedure

Full sub-step ordering for the Phase 4 Milestone Archival block. The skill itself carries a condensed summary; consult this section when executing the archival or debugging an interrupted run. Sub-steps are lettered to avoid clashing with the Phase 4 flow numbering (steps 13–15 in the skill).

a. Scan `specs/frs/*.md` for every FR with frontmatter `milestone == <current>`. Build the FR batch.
b. For each batched FR: plan one `git mv specs/frs/<name> specs/frs/archive/<name>` (where `<name>` is `Provider.filenameFor(spec)`; stem preserved across the move) + frontmatter flip (`status: active → archived`; set `archived_at: <ISO now>`) + one `Provider.releaseLock(<ulid>)` call.
c. If `specs/plan/<M#>.md` exists, plan one `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` to batch alongside the FR moves.
d. Present the full batch as a diff preview — list every `git mv`, every frontmatter flip, every `releaseLock`. Do not summarize.
e. On explicit human approval (Phase 4 step 15): execute all moves + flips + `releaseLock` calls and commit atomically in a single commit. Any error aborts the entire batch — no partial archival.
f. Run the Post-Archive Drift Check from `skills/spec-archive/SKILL.md` § Post-Archive Drift Check. Render the unified Schema I table; offer the 3-choice UX (address inline / save to `specs/drift-<date>.md` / acknowledge). The drift check never blocks the already-committed archival.
g. `specs/technical-spec.md` is **never** archived — ADRs use `Superseded-by:` in place (ADR convention).

## Decision matrix (round resolution)

The self-review loop has hard exit conditions that Stage C feeds into. For reference:

| Outcome | Action |
|---------|--------|
| All stages pass + gate confirms clean (`GATE PASSED`) | Exit loop, proceed to Phase 4 |
| Gate returns `GATE PASSED WITH NOTES` | Treat non-critical notes as informational, include in Phase 4 report, exit loop |
| Issues found on round 1 | Fix, re-run gate check, go to round 2 |
| Issues found on round 2, same issue types as round 1 | **STOP and escalate** — going in circles |
| Issues found on round 2, different issue types | Fix, re-run gate check, escalate to user (diminishing returns) |

After any fix, always re-run the full gate check before continuing. Read the actual output and report the numbers (e.g., `47 tests, 0 failures, 0 errors`). Never claim clean from memory of a previous run.

## Spec Deviation Check

The skill's condensed rule is "if reality contradicts the spec, STOP and classify". Full playbook for Phase 2 step 9:

a. **STOP coding forward.** The spec is the source of truth. If reality contradicts it, the spec must be updated first — do not work around a broken spec.

b. **Assess already-written code.** If significant code was already written against the incorrect spec, evaluate whether to revert to the last checkpoint (git commit) or adapt the existing code. Prefer reverting if the spec change alters the fundamental approach.

c. **Classify the issue** — exactly one of four types (Schema per NFR-4):

| Class | When | Action |
|-------|------|--------|
| `underspecified` | spec silent but behavior clearly implied | add edge case to specs + add test + continue. No user approval needed. |
| `ambiguous` | spec silent, reasonable people disagree | propose most conservative behavior, log as provisional decision in specs, add test, confirm at Phase 4. Continue. |
| `contradicts` | what the spec says cannot work or conflicts with another requirement | present contradiction + propose 2+ options with tradeoffs. **Wait for user decision.** Update spec with decision. |
| `infeasible` | specified approach hits a hard technical wall | explain why + propose alternatives. **Wait for user decision.** |

d. **Always backfill specs.** Any edge case discovered during implementation (whether it blocks you or not) must be:

- Logged in `specs/requirements.md` edge-case section (or `specs/technical-spec.md` if architectural).
- Covered by a test.
- Never allowed to live only in code — that's tribal knowledge, and it rots.

## Spec Breakout

The skill's condensed rule is "3 or more `contradicts` / `infeasible` deviations ⇒ STOP + Spec Breakout report + recommend rewrite". Full report shape:

1. **Title line.** `Spec Breakout — milestone M<N>` + date.
2. **Trigger.** Count + list of deviations by ID (e.g., `3 contradicts, 1 infeasible — total 4 ≥ threshold 3`).
3. **Deviation table.** Schema per NFR-4 Deviation Table: columns `Deviation`, `Classification`, `Resolution` (or `unresolved — awaiting decision`), `Needs Confirmation?`.
4. **Affected specs.** Named sections of `specs/requirements.md` / `specs/technical-spec.md` that need rewrite.
5. **Recommended scope.** Proposed rewrite scope (single section, whole FR, whole milestone plan).
6. **Resume condition.** What must change in the specs before `/implement` can safely resume.

Breakout is a valid skill output, not a failure. Emit the report, update the task list, and wait for the user to update specs. The threshold is configurable via CLAUDE.md (look for a line like `spec_breakout_threshold: <N>`; default `3`).

## Phase 5 — Milestone close prompt

Fires only on a **milestone-scope** invocation (`/implement M<N>`) that shipped every FR cleanly. Opt-in chain into `/ship-milestone M<N>` — a prompt, not a silent chain. Phase 5 is the **last thing** `/implement` does before process exit; nothing else runs between the prompt (or its skip path) and exit.

### Conditions (evaluated in order)

1. **Invocation shape.** Skip entirely if `$ARGUMENTS` is a single-FR arg (a tracker ID, a ULID, a URL), the literal `all` / `remaining`, or empty / no arg. Only an `M<N>` arg qualifies.
2. **Milestone completeness.** Re-read `specs/plan/M<N>.md`; confirm every listed FR transitioned from `status: active` to `status: archived` during this run. If any FR remains active or any FR's gate-check failed this session (partial success), skip entirely.
3. **TTY.** Check whether stdin is a TTY (proxy: interactive Claude Code session accepting user replies). Non-TTY / CI / piped stdin ⇒ print the manual-command hint, do not prompt, do not read stdin.

If all three pass, print the prompt and read one line from stdin.

### Prompt (exact format including the blank line)

```
All FRs in M<N> shipped.

Run /ship-milestone M<N> now? (y/n):
```

### Branches

- **Accept** — input is `y` or `yes` (case-insensitive, trimmed). Chain into `/ship-milestone M<N>` in-process. All `/ship-milestone`'s own gates still fire — the release commit is gated by its own `Apply? [y/N]` prompt on the release diff. The `y` here does **not** pre-approve the release; refusal at that second gate exits cleanly without a release commit.
- **Decline** — input is `n`, `no`, empty (just Enter), or any other non-matching string (case-insensitive). Do not chain; print the hint below and exit 0.

### Hint (exact literal — also used on the non-TTY skip path)

```
Ready to close milestone. Run: /ship-milestone M<N>
```

### Chain-failure refusal

If the user accepts but `/ship-milestone` fails to start (skill not registered, `skills/ship-milestone/` missing, etc.), surface this NFR-10-shape refusal and exit non-zero:

```
/implement: attempted to chain into /ship-milestone but it failed to start: <error>.
Remedy: verify the skill is installed (check plugins/dev-process-toolkit/.claude-plugin/plugin.json), then run /ship-milestone M<N> manually.
Context: milestone=M<N>, chain=ship-milestone, skill=implement
```

### Skip-case summary

| Case | Behaviour |
|------|-----------|
| Single-FR arg (e.g., a tracker ID, ULID, URL) | silent skip — no prompt, no hint |
| `all` / `remaining` / no arg | silent skip — no prompt, no hint |
| Any FR in `specs/plan/M<N>.md` still `status: active` | silent skip — milestone isn't done |
| Any FR's gate-check failed this run | silent skip — partial success |
| Non-TTY stdin (CI, piped input) | print hint, no prompt, no stdin read |
| All conditions met | print prompt, accept `y`/`yes` (chain) or anything else (hint + exit 0) |

## Phase 4 Milestone Archival — full procedure detail

The skill carries the condensed entry; this section is the operational mirror.

**Milestone-binding assertion (pre-move gate).** Before any FR's `git mv`, call `assertMilestoneBindingAtArchive(provider, project, frFile, deps)` from `adapters/_shared/src/assert_milestone_binding_at_archive.ts` for each FR being archived (tracker mode with `project_milestone: true` only; vacuous on `mode: none`, `project_milestone: false`, and missing plan files). `outcome: "asserted"` (binding present, or missing-then-attached via the single retrying attach) ⇒ proceed and emit `milestone_label_asserted_at_archive` for that FR; `outcome: "refused"` ⇒ skip that FR's `git mv` + frontmatter flip + `releaseLock` entirely, emit `milestone_label_archive_refused`, surface the NFR-10 detail (ticket, expected binding, backfill/manual-attach remedy), and let the other FRs in the batch proceed. FR-backed scope only — the assertion iterates exactly the FR files being archived; it never enumerates the tracker board.

**Procedure.** For every FR with frontmatter `milestone == <current>`: compute the base filename via `Provider.filenameFor(spec)` and run `git mv specs/frs/<name> specs/frs/archive/<name>` + flip frontmatter `status: active` → `status: archived` + set `archived_at: <ISO now>`. **`archived_at` precision: full ISO-8601 with date + time + Z (e.g., `2026-04-30T17:23:11Z`); not date-only with zeroed time (`2026-04-30T00:00:00Z` is the regression shape).** Render via `date -u +%Y-%m-%dT%H:%M:%SZ`, never the shorter `date +%Y-%m-%d` form (it rounds to midnight UTC — an earlier smoke caught this regression). The stem is preserved across the move — `/spec-archive` and `/implement` never rename during archival (NFR-15 filename-permanence holds). All N moves and N flips land in one atomic commit. Then `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` in the same commit, **and apply the same status flip to the plan file's frontmatter** — flip `status: active` → `status: archived` and set `archived_at: <ISO now>` (the same full-ISO-8601 timestamp used for the FR flips, date + time + Z). This **plan-status flip** is part of the same atomic commit; read-side enforcement is `/gate-check` probe #16 (`archive_plan_status`).

**Token Stats re-render.** Per in-scope FR, after the `git mv` + frontmatter flip and before the archive commit is created, refresh the FR's `## Token Stats` block at its new archive path from the token ledger: select rows via `claimRowsForFR(projectRoot, { branch, sessionLineage, brainstormClaim: <tracker-id> })` and apply `upsertTokenStatsBlock(frBody, rows)` (both from `adapters/_shared/src/token_stats_render.ts`), then `git add` the archive path so the refresh lands in the **same archive commit** — never a separate commit or post-commit dirty tree. Vacuous when the ledger is absent or has no rows for the FR. **Second pass — re-render after all claims settle.** `claimRowsForFR` demotes a row shared by two FRs of one session into the `design/exploration` bucket, and that demotion is retroactive: the first FR of the session is refreshed before the second FR's claim exists, so an FR refreshed earlier in this sweep goes stale mid-run. Once the sweep's last claim settles, re-render **every in-scope FR**'s block once more from the settled ledger and `git add` it — still the same archive commit, still vacuous for FRs with no rows.

**Rewrite traceability links.** Before staging the atomic commit, call `rewriteArchiveLinks(repoRoot, frId)` from `adapters/_shared/src/spec_archive/rewrite_links.ts` for **each** FR being archived. The helper rewrites every `frs/<id>.md` reference in `specs/requirements.md`, every active `specs/plan/*.md`, every `specs/plan/archive/*.md`, and the unreleased prefix of `CHANGELOG.md` to `frs/archive/<id>.md` (both Markdown link forms and bare path mentions). The rewrites land in the **same atomic commit** as the `git mv` + frontmatter flips. On the next `/gate-check`, probe #23 (`traceability-link-validity`) sees a clean tree — no manual fix-up between commit and gate. Idempotent: an orphan FR with no references yields an empty rewrite, no error.

**Cleanup stale plan verify lines.** Right after `rewriteArchiveLinks` returns, call `cleanupPlanVerifyLines(projectRoot, deletedFiles, addedTestFiles)` from `adapters/_shared/src/spec_archive/cleanup_plan_verify_lines.ts`. `deletedFiles` is the set of paths Phase 2 deleted; `addedTestFiles` is the set of `*.test.*` files added. The helper walks every active `specs/plan/M*.md` (excluding `archive/`) and updates each `verify:` line that references a deleted path: when the deleted file is `*.placeholder.test.ts` and a single new test file was added, the verify line is rewritten to reference the replacement; otherwise the parent task is marked `[x]` and the verify line is dropped. Empty `deletedFiles` ⇒ vacuous no-op. The cleanup writes land in the **same atomic commit**. The new `/gate-check` probe #28 (`plan-verify-line-validity`, severity: warning) is the read-side backstop on every run.

**Failure semantics.** If `rewriteArchiveLinks` or `cleanupPlanVerifyLines` throws (e.g., a plan file is read-only, an I/O error fires), `/implement` **aborts archival cleanly — do not commit the archive move, do not call `Provider.releaseLock`**. Surface an NFR-10 canonical refusal naming the offending plan `file:line:column` and the link or verify line that would have been rewritten, then exit Phase 4 non-zero. The FR file remains in its pre-archive location so a follow-up run can resume through the `already-ours` claim path. Same rule applies to a partial rewrite (any helper invocation in the milestone-group batch fails) — the entire commit is aborted, never partial.

Then call `Provider.releaseLock(id)` for each released FR.

## Step 14 Verification Evidence

`/implement`'s step-14 report carries the same machine-derived evidence rows the `deliver-stage-result` fence carries, so a standalone run — a single-FR run, or an `/implement M<N>` an operator types by hand — evidences its work exactly as an orchestrated one does. Before this contract those counts existed only when a stage ran underneath the `/deliver` orchestrator: the guarantee was a property of one invocation path rather than of the work.

**Obligation.** Step 14 MUST render the section headed `## Verification evidence` through `renderImplementReportEvidence` from `adapters/_shared/src/implement_report_evidence.ts`. That function takes exactly one argument — the captured runs — and no stage, milestone or fence context; a second parameter would make the guarantee conditional on the orchestrated path all over again.

**Rows (fixed order, never omitted).**

1. `gate:` — the gate-check run, carrying its skip count and the baseline skip delta.
2. `drive:` — the project-drive run.
3. `e2e:` — the end-to-end run.

**Delegation, not a second renderer.** `implement_report_evidence` derives nothing of its own — no count parsing, no baseline lookup, no row shape. It calls the shared stage-evidence renderer and re-labels the result, so its rows are byte-identical to the fence's, being the same bytes. A second formatter that merely agreed with the fence today would let the two invocation paths drift into disagreeing about whether the same work was green.

**Fail-closed.** A missing capture is a refusal, not a silent omission: `ok` goes false, `reasons` names each offending section by name, and the `gate:` / `drive:` / `e2e:` rows are emitted anyway. A confident nothing is the failure mode this guards against.

## Phase 4 End-to-End Authoring Hook

Runs in Phase 4, before the step-14 report — the same placement as the other Phase 4 hooks, so the decision is made before the work is declared green.

**Why it exists.** Nothing else in the loop ever ADDS an end-to-end test. `/tdd` writes tests per AC through a test-writer that is deliberately blind to the running system, which is correct for unit tests and exactly wrong for end-to-end ones. The end-to-end suite therefore drifts away from the product one change at a time, while the evidence rows keep faithfully reporting green counts for a suite that stopped covering anything.

**Obligation.** When the `## Verification` block declares an `e2e_cmd` that is a real command, the change adds or edits an end-to-end test covering it, the suite is run, and the outcome is resolved through `resolveE2eAuthoring` from `adapters/_shared/src/e2e_authoring.ts`. A declared project whose change authored nothing and recorded nothing REFUSES: the green declaration is not available to it.

**The quiet half.** A change with no end-to-end observable surface records that explicitly, with a reason. Silence is not an answer — a silent skip and a considered decision produce identical trees (no new file either way, no diff either way, nothing to grep for either way), so the module distinguishes them by demanding the record and reading the reason back out. Only the recorded decision emits `end_to_end_none_needed`; a silent skip emits nothing and refuses. A blank reason is silence wearing a hat and lands on exactly the same refusal as saying nothing at all, and a none-needed record alongside a freshly authored test is a contradiction rather than a preference.

**Three states, never two.** An absent `e2e_cmd` is vacuous — byte-identical to today's behaviour for projects that never opted in. The literal `none` is an ANSWER ("there is no end-to-end suite"), so it needs no authored test and no suite run. The module asks `isRunCmdNone` / `isRunCmdAnswered` from `adapters/_shared/src/verification_config.ts` rather than comparing those four bytes itself, which is what keeps the absent key from folding into the `none` answer.

**Delegation, not a second renderer.** `e2e_authoring` derives no counts of its own: the `e2e:` rows and every number in them come from the shared stage-evidence renderer, called by bare name so an override is genuinely wired through.

**One block, not two — the hook's capture is threaded into step 14.** `e2e_authoring`'s captured end-to-end run is **fed into** the single step-14 `renderImplementReportEvidence` call, so one evidence block carries `gate:`, `drive:` and `e2e:` each from its real capture. Read on its own the hook's `evidenceRows` still carry `- (none found)` for `gate:` and `drive:` — captures this module was never given and cannot speak for — which is exactly why they are threaded through the step-14 renderer rather than rendered beside it: a second block would re-split the source of truth the one-renderer contract above exists to consolidate.

## Advisory Notes

Phase 3 Stage B routes any Pass 2 CONCERNS that round-2 escalation classifies as **advisory** (not gate-blocking) into a structured `advisoryNote[]` array. Capture happens before Stage B exits — without it, advisory concerns disappear from non-interactive (`claude -p`) runs after Stage B returns, leaving the operator with no audit trail and no chance to override (smoke-test 2026-04-28 finding F2).

**Schema (per record):**

```
advisoryNote: {
  pass: 2,
  concern: string,            // one-line concern statement copied verbatim from Pass 2 output
  rationale: string,          // why this concern was routed to advisory rather than gate-blocking
  classification: 'advisory'
}
```

**Render contract.** A single shared formatter renders each `advisoryNote` to the bullet-body shape `<concern> — <rationale>`. Two surfaces consume the formatter's output:

1. **Phase 4 step 14 report** — append a `## Advisory notes` section after the existing report items, one bullet per advisory entry in capture order. Empty list ⇒ heading + the literal line `No advisory notes.` — never absent.
2. **Phase 4 § Milestone Archival archived-FR write** — append a `## Implementation notes` body section after the FR's existing `## Notes` section, body content is the FR's slice of `advisoryNote[]` rendered via the same formatter. Empty slice ⇒ heading + the literal line `No advisory notes.`.

Bullet bodies between the two surfaces are byte-identical because both share the same source list and the same formatter. If the rendering ever diverges, that's the regression signal — the formatter must be the single source of truth for advisory-note prose.

## Phase 4 Close (atomic — full text)

Once the user approves at step 15, execute the Close procedure end-to-end. Phase 4 does not exit cleanly unless all three sub-steps complete; if any sub-step fails, surface the failure and exit non-zero so the next run can resume through the `already-ours` path.

**(a) `git commit`** — create the final commit (includes any FR archive moves from § Milestone Archival on a full-milestone run).

**(b) Release** — for every ticket that was claimed during Phase 1 in tracker mode, run the per-FR release sequence in `docs/implement-tracker-mode.md` § Release runbook. Tracker mode: transitions the ticket to the adapter's canonical Done status; the runbook performs the narrowed pre-state assertion (In Progress **or** canonical Done — any other pre-state surfaces a `TrackerReleaseLockPreconditionError` per NFR-10) before the Done transition, so the `Backlog → Done` silent-leap guardrail still holds. `mode: none`: deletes `.dpt/locks/<id>` (runbook does not apply). **No exit path through Phase 4 skips this step.** If the release sequence fails, Phase 4 fails loudly — never swallow the error. On a full-milestone run where § Milestone Archival already released each archived FR, skip the per-ticket call here for those same FRs (double-call avoidance). Two outcomes — `transitioned` and `already-released` (idempotent-terminal branch) — are both valid exit paths; step (c)'s post-release verification runs identically for both.

**(c) Post-release verification** — for each released FR, run step 4 of `docs/implement-tracker-mode.md` § Release runbook and **assert** the returned `status` matches the adapter's `status_mapping.done` canonical name. A mismatch means the release reported success but the tracker didn't move (silent no-op trap). Surface an NFR-10-canonical refusal naming the ticket + observed vs. expected status, and exit Phase 4 non-zero so the human can intervene. In `mode: none`, `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel; treat the sentinel as vacuously passing the assertion. The proof-of-release for `mode: none` is two-sided: the durable claim witness — the `chore(locks): claim lock for <id>` commit step 0.c produced, which records the branch on a `branch: <branch>` body line rather than in the subject, because a branch-bearing subject is uncommittable past the hook's 72-character cap — **plus** the absence of `.dpt/locks/<id>` after step (b). Absence alone is not proof, because a claim that never fired leaves exactly the disk a completed release leaves; a run whose history carries no claim commit is a claim failure to surface, never a release to certify. `LocalProvider.releaseLock` is unchanged in code — it still deletes the lock and commits — what changed is what counts as proof that it had something to delete.

**Abort boundary — do NOT call `releaseLock` or `getTicketStatus`** when any of the following happen: a gate-check failure, a Spec Breakout, a user rejection at step 15, or any Phase 1–3 early exit. In every abort case, the lock stays so a follow-up run can resume through the `already-ours` path. The Close procedure only runs once the user explicitly approves **and** `git commit` lands.

The Pattern 9 byte-diff regression gate against the `mode-none-v2` fixture continues to pass because the cleanup was already part of the existing mode-none flow.

## Phase 4b Doc Fragment Hook

The skill body carries the condensed flow; this section covers edge cases and the diagnostic log shape.

### When it runs

Phase 4b fires after Phase 4a (gate pass) and before Phase 4c (report + approval) / 4d (Close). Its enabling gate is the `## Docs` section of `CLAUDE.md` (read via `readDocsConfig(CLAUDE.md)` from `adapters/_shared/src/docs_config.ts`). Both `userFacingMode` and `packagesMode` false — or the section absent — ⇒ **silent no-op**: no log line, no row, zero output. This preserves byte-identical behavior for projects that don't use docs generation.

### FR ID resolver order

Phase 4b invokes `/docs --quick` with the resolver that `/docs` itself uses:

1. **Branch template match.** If `branch_template:` is set in Schema L and the current branch name maps to a tracker ID or ULID under that template, use it.
2. **Diff scan.** Otherwise, find the most-recent FR whose file appears in the working-tree diff (`git log -1 --format=%H -- specs/frs/<fr>.md`).
3. **Unbound fallback.** If neither resolves, `/docs --quick` writes `docs/.pending/_unbound-<UTC-timestamp>.md` with a `warning:` line in the frontmatter. No retry — the fragment is still written.

### Success path

On successful fragment write, `/implement` appends exactly one row to the existing Phase 4 Spec Deviation Summary table:

```
| Doc fragment | added | docs/.pending/<fr-id>.md | — |
```

The `<fr-id>` placeholder resolves to the actual fragment base name (tracker ID, short-ULID tail, or `_unbound-<ts>`).

### Failure path

`/docs --quick` non-zero exit, thrown error, or 60-second timeout — Phase 4b logs one warning line to stdout, then appends:

```
| Doc fragment | skipped (error) | — | /docs --quick failed: <first-line-of-error>. Run manually after commit to retry. |
```

The `<first-line-of-error>` is the first line of stderr (or the string `timeout after 60s` on timeout). Phase 4 then continues to Phase 4c normally — the implementation commit does not block on a failed fragment write. The user can re-run `/docs --quick` manually after the commit lands.

### Diagnostic log shape

The single log line printed on success (stdout):

```
phase-4b: /docs --quick wrote docs/.pending/<fr-id>.md
```

On failure (stderr, then the skipped row goes to the Deviation table):

```
phase-4b: warning — /docs --quick failed: <first-line-of-error>
```

No log line is ever printed when Phase 4b is gated off (both modes false or section absent) — zero-output invariant.

### Out-of-scope

- **Cross-FR fragments.** Phase 4b writes exactly one fragment per `/implement` run, bound to the FR being implemented. If a diff genuinely spans multiple FRs, the human runs `/docs --quick` manually with explicit overrides after the commit.
- **Retry on failure.** No automatic retry. A single failure appends the skipped row and lets the user decide.
- **`--skip-docs` flag.** None. The contract forbids a new `/implement` flag; temporary opt-out is done by flipping Schema L docs keys.

## Phase 4b′ Cross-Cutting Spec Propagation

The skill body carries the condensed flow; this section is the full edit policy and the commit-message contract.

### When it runs

Between the Phase 4b doc-fragment hook and Phase 4c (report + approval). Deleted paths are derived from `git diff --name-status <baseline>..HEAD --diff-filter=D` — never recalled from session memory — and each one is passed to `scanCrossCuttingSpecRefs(removedPath, specsDir)` from `adapters/_shared/src/scan_cross_cutting_spec_refs.ts`. The helper is detection-only: it returns per-file lists of `{line, snippet, kind}` hits and edits nothing.

### Edit policy

- **`treeLeaf` hits are deleted.** The hit sits inside a fenced directory tree in `specs/technical-spec.md` / `specs/testing-spec.md`; drop the whole line with the Edit tool and never rewrite the surrounding text.
- **`proseMention` hits are left untouched.** A sentence that names the removed file usually needs restructuring rather than a line delete, which is a judgment call the operator makes. Phase 4b′ records the hit instead of guessing.
- **Zero hits across both specs ⇒ silent no-op** — no commit, no row, no log line.
- **≥1 hit ⇒ exactly one follow-up commit**, placed between the implementation commit and any archival commit.

The `cross_cutting_spec_stale_file_refs` `/gate-check` probe is the read-side safety net for removals that bypass this hook entirely.

### Commit subject — fixed by construction

Render the message with `buildPropagationCommitMessage(removedPaths, proseMentions)` from `adapters/_shared/src/propagation_commit_message.ts`, never by hand. The subject it emits is one fixed literal, byte-identical for every removal:

```
chore(specs): propagate file removal to cross-cutting specs
```

**Why it carries no path.** The `commit-msg` hook `/setup` installs (`templates/git-hooks/commit-msg.sh`, `-gt 72`, restated by `commitlint.config.js` as `header-max-length`) rejects any subject longer than 72 characters. The earlier wording interpolated the removed path between a `chore(specs): propagate` prefix and a `removal…` tail — fixed wording costing 55 characters, leaving at most seventeen for the path. `src/.placeholder.test.ts` rendered 79 and a plugin-relative adapter path rendered 110, so the prescribed subject was unsatisfiable for nearly every realistic input. A subject no caller input can reach is a subject whose length no caller input can change; the fixed literal measures 59 and clears the cap unconditionally.

**Where the path went.** Nothing is lost — every removed path, and every prose-mention `file:line` plus its snippet, is written into the commit **body**, which the hook does not read. That is what makes the follow-up amend possible: the operator recovers which propagation this was, and which sentences still need restructuring, from the body of the commit itself.

**The bound is enforced before anything is written.** `buildPropagationCommitMessage(removedPaths, proseMentions, {mode, ticket})` forwards its third argument to `assertPropagationSubjectWithinCap`, which runs inside the builder and throws in the NFR-10 refusal shape (verdict, `Remedy:`, `Context:`) rather than letting a rejected subject reach the hook. Bypassing the hook is never an acceptable response on any path: deterministic gates override LLM judgment, so the commit conforms to the gate rather than the gate bending to the commit.

### Coupled surface — do not repair here

`.claude/skills/smoke-test/SKILL.md` lines 998 and 1006 grep for the *old*, path-embedding subject and therefore look stale against the shipped literal above. Repairing those two greps is STE-488's job in M127; leave them alone when editing this hook so the two milestones stay separable.

## Commit message format

Phase 4 commits use [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The `commit-msg` hook installed by `/setup` is the deterministic gate; this section is the cooperative specification the agent follows when proposing the message at the step 14 approval gate.

### Subject

`<type>(<scope>): <title>` — total length ≤ 72 characters. Append `!` after the scope (or after the bare type when no scope) for breaking changes (`feat(api)!: drop legacy endpoint`, `feat!: rename root config`).

### Type heuristic

Pick from the [Angular set](https://www.conventionalcommits.org/en/v1.0.0/#summary):

| FR class | Type | Notes |
|----------|------|-------|
| New user-visible functionality | `feat` | Default for spec-driven feature FRs. |
| Bug-fix FR | `fix` | Use when the FR's purpose is to correct broken behavior. |
| Documentation-only change (README, docs/, prose-only SKILL.md edits) | `docs` | No production code touched. |
| Behavior-preserving restructure | `refactor` | Renames, dead-code removal, reorganization with no semantic change. |
| Build / tooling / non-functional housekeeping | `chore` | Dependency bumps, gitignore edits, hook installs. |
| Test-only change | `test` | New tests with no production-code change. |
| Performance | `perf` | Use sparingly — most perf work is `refactor` + benchmarks. |

### Scope

Primary touched skill or area: `skills/implement`, `skills/pr`, `adapters/linear`, `adapters/_shared`, `templates`, `tests`, `docs`. Multi-area FRs pick the dominant area; if no single area dominates, omit the scope (`feat: ...` is valid).

### Body + footer

- **Body** — the existing Phase 4 prose (AC checklist resolution, files touched, deviation summary). Unchanged in shape from pre-M36.
- **Footer** — one `Refs:` line per FR touched, in tracker-ID form: `Refs: STE-<N>`. In `mode: none` use the short-ULID tail (`Refs: VDTAF4`). Multiple FRs in one commit get one `Refs:` line each.

### Example

```
feat(commits): adopt Conventional Commits v1.0.0

Adds `commit-msg` hook template + skill prose updates so the
toolkit and adopting projects share one deterministic
commit-format gate. Local hook hard-blocks non-CC commits
without grace period.

Refs: STE-<N>
```

### Step 14 approval-gate render

Alongside the AC checklist and gate output, the report must include the proposed `<type>(<scope>): <title>`. The user can redirect type/scope before approval (e.g., "use `chore` not `feat` — this is non-functional"). The commit-msg hook is the deterministic backstop if drift slips through.
