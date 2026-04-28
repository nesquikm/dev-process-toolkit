# `/implement` Tracker Mode Flow

Detailed tracker-mode procedures for `/implement`. Pointed at from
`skills/implement/SKILL.md` step 0 to keep the skill under NFR-1 (≤300 lines).

In `mode: none`, this document is unused — the `mode: none` branch runs unchanged.

## Pre-flight sequence (mode-gated, in order)

### 0.1 Ticket-binding pre-flight (STE-27)

Run the 2-tier resolver and mandatory confirmation prompt per
`docs/ticket-binding.md` (branch regex → interactive prompt; post-STE-62).
Decline exits cleanly with zero side effects (AC-STE-27.4). Branch-regex
mismatch fails loudly (AC-STE-27.3).

### 0.2 `pull_acs` + `updatedAt` recording (STE-11, STE-45)

> **Record `updatedAt` AFTER `claimLock` — the claim itself mutates the ticket** (STE-45 AC-STE-45.7). Recording before `claimLock` causes `/gate-check` to fire a false-positive drift warning on the skill's own write (AC-STE-45.1).

Call the active adapter's `pull_acs(ticket_id)` exactly once at skill entry
— **after** step 0.c `claimLock` has returned `claimed` or `already-ours`.
Capture the returned ticket's `updatedAt` (Schema O) into session memory —
not disk. `/gate-check` re-fetches later and compares against this value
(AC-STE-11.3). If the adapter's parser returns an empty AC list, fail the skill
with NFR-10 canonical shape `"No acceptance criteria found in ticket <ID>"`
(AC-STE-13.4). Never silently proceed.

**General rule (AC-STE-45.5).** Record `updatedAt` after all pre-flight side
effects settle — not just `claimLock`. Any pre-flight step that mutates
the tracker (including branch-name interop warning writes, if any future
adapter adds them) bumps `updatedAt`; the session snapshot must reflect
the post-mutation state so `/gate-check`'s drift detection is comparing
against a stable baseline.

**`already-ours` edge case (AC-STE-45.6).** When `claimLock` returns
`already-ours` (a resume on an existing claim) and `pull_acs` returns an
`updatedAt` older than one already recorded for this ticket in the current
session, prefer the newer value. This guards against tracker-API quirks
where a stale read could cause apparent backslide; the session should only
ever advance its recorded `updatedAt` forward in time.

Only feed the parser-returned AC list to the rest of the skill — never the
raw ticket description blob (STE-13 AC-STE-13.2, AC-STE-13.3). Comments, history,
preamble, and attachments are discarded at the parser boundary.

### 0.3 STE-17 diff/resolve loop

Read the local FR's AC list from `specs/requirements.md` (parsed from the
`### FR-{N}:` block's bullet list). Compare against the adapter-returned
`AcList` from step 0.2. Classify each AC:

- **identical** — text + `completed` match exactly (after normalization).
- **local-only** — present locally, absent from tracker.
- **tracker-only** — present in tracker, absent locally.
- **edited-both** — present on both sides with different text.

If all are `identical`, skip the prompt entirely and proceed (AC-STE-17.2
fast path).

If any non-identical AC exists, prompt per-AC with exactly four options
(AC-STE-17.3): `keep local`, `keep tracker`, `merge` (free-text editor),
`cancel`. No bulk shortcuts (AC-STE-17.7).

- `keep local` — overwrite tracker: `upsert_ticket_metadata(ticket_id, title, <rebuilt description with local AC block>)`.
- `keep tracker` — overwrite local: rewrite `specs/requirements.md` FR's
  AC list to match the tracker-canonical form.
- `merge` — open an editor (heredoc prompt), user writes the merged text,
  then apply to **both** sides (local requirements.md + tracker push).
- `cancel` — abort the skill cleanly with zero state mutation on either
  side (AC-STE-17.5).

After all per-AC resolutions apply, both sides converge to the same list
(AC-STE-17.4). The commit that captures the resolution is the audit trail
— `git log` + `git blame` on the FR file show the what, who, and when.

## MCP call budget (NFR-8)

`/implement` runs at most **two MCP calls** at startup:

1. `pull_acs(ticket_id)` — once at step 0.2.
2. `upsert_ticket_metadata(ticket_id, title, description)` — at most once
   per STE-17 resolution event (steps 0.3 options `keep local` / `merge`),
   not per AC. If all ACs are `identical` or the user picks `cancel`, this
   call is skipped.

Downstream phases (TDD, gate check, self-review) make **zero additional
MCP calls** — they operate on the session-cached AC list. Live re-fetching
happens only in `/gate-check` (one call, per AC-STE-11.3).

## Graceful degradation (STE-16 AC-STE-16.6)

If the adapter's `capabilities:` frontmatter list is missing
`upsert_ticket_metadata`, STE-17 resolution options that would push (`keep
local`, `merge`) degrade with an NFR-10 canonical-shape warning and proceed
with the local-only half of the resolution applied (tracker side left as-is
for manual correction). `pull_acs` is a hard requirement — an adapter that
doesn't declare it fails the skill at step 0.2.

## Phase 4 — post-commit `releaseLock` (STE-47)

After the user approves and `git commit` lands (step 15 in `skills/implement/SKILL.md`), the skill must call `Provider.releaseLock(<id>)` for every ticket claimed during Phase 1 — this performs the **Done transition** on the tracker side (`transitionStatus(ticket_id, "done")` via the active adapter) and writes the tracker's Done state. Without this call, an FR-scope run — implementing a subset of an in-flight milestone where no archival fires — leaves the ticket stuck at `In Progress` after the commit lands, producing a lying tracker.

Mirror of SKILL.md Phase 4 step 15:

- **When to call:** once per touched ticket, immediately after `git commit` succeeds on a user-approved commit.
- **Done transition wording:** `releaseLock` routes through the adapter's `transition_status(done)` op; in Linear, that's `mcp__linear__save_issue(id, state="Done")`. The `TrackerProvider` post-call `updatedAt` guard (STE-46) fires on a silent no-op.
- **Abort boundary (AC-STE-47.3):** skip `releaseLock` on gate failure, Spec Breakout, user rejection at step 15, or any Phase 1–3 early exit — the in-flight claim must survive for the `already-ours` resume path (AC-STE-28.1).
- **Double-call avoidance (AC-STE-47.6):** on a full-milestone run where § Milestone Archival fires, the archival path's `releaseLock` call per archived FR (AC-STE-28.4) consumes the responsibility — step 15 skips those FRs.

The tracker silent no-op trap (STE-46) means `releaseLock` itself must re-fetch `updatedAt` and assert it advanced — otherwise a bogus Linear response reads as success and the ticket stays at `In Progress`. `TrackerProvider.releaseLock` handles this in shared code; adapter drivers just need to populate `TicketStatusSummary.updatedAt`.

## Claim runbook

Concrete adapter-agnostic MCP-call sequence the LLM-as-runtime executes for
`Provider.claimLock(<id>, currentBranch)`. Encodes the entry-gate semantics
in operational form so the abstract Provider reference doesn't read as
"skip the tracker write" (the M26 dogfood failure mode that motivated this
runbook).

`<tracker>` resolves from Schema L's `mode:` (the active tracker key, e.g.
the `mcp_server:` from `adapters/<tracker>.md` frontmatter). Never hard-code
the vendor name in skill prose — the runbook abstracts over the per-tracker
concrete pattern via the active adapter's `## Tool surface` table.

1. **Read state + assignee.** Call `mcp__<tracker>__get_issue(<id>)`. Capture
   `status`, `assigneeId` / `assignee`, and `updatedAt`.
2. **Decision routing (four-way):**
   - `status == status_mapping[in_progress]` AND `assignee != currentUser`
     ⇒ STOP with `taken-elsewhere`. Surface an NFR-10 canonical-shape
     refusal naming the holding assignee + branch (AC-STE-28.2). Do not
     write.
   - `status == status_mapping[in_progress]` AND `assignee == currentUser`
     ⇒ `already-ours`. The claim is already held; resume the run without
     writing. Bookkeeping (the post-claim `updatedAt` recording for STE-11
     drift detection) still fires (see § 0.2 above).
   - `status == status_mapping[done]` ⇒ `already-released` (idempotent
     terminal — STE-84). The work shipped; don't re-open the ticket. Skip
     the run.
   - Otherwise (`Backlog`, `Unstarted`, `Cancelled`, etc.) ⇒ proceed to
     step 3 to perform the actual claim.
3. **Transition to In Progress + assign current user.** Look up the active
   adapter's `transition_status` row in `adapters/<tracker>.md` § Tool
   surface. Invoke that MCP call with the resolved `status_mapping[in_progress]`
   target plus the `assignee` field set to the current user. Per STE-65,
   this is the through-In-Progress hop — never skip directly to Done.
4. **Verify the write landed (silent no-op trap).** Re-fetch via
   `mcp__<tracker>__get_issue(<id>)` and assert that `updatedAt` /
   `startedAt` advanced past the pre-call value, AND `status ==
   status_mapping[in_progress]`, AND `assignee == currentUser`. If any
   assertion fails, raise an NFR-10 canonical-shape refusal (the silent
   no-op trap from `adapters/linear.md` § Silent no-op trap fires here).
   This is `claimed`. Record the post-claim `updatedAt` per § 0.2 for
   `/gate-check` drift detection.

The four routing outcomes — `claimed`, `already-ours`, `taken-elsewhere`,
`already-released` — match `TrackerProvider.claimLock`'s return contract.
The runbook is the operational mirror of the TS interface; both encode
the same semantics.

## Release runbook

Concrete adapter-agnostic MCP-call sequence for
`Provider.releaseLock(<id>)` and `Provider.getTicketStatus(<id>)`'s
post-release verification (Phase 4d steps b + c). Same shape as the Claim
runbook above — operational mirror of the Provider TS interface.

1. **Pre-release pre-state assertion (STE-65 narrowed by STE-84).** Call
   `mcp__<tracker>__get_issue(<id>)` and assert the current `status` is
   `status_mapping[in_progress]` OR `status_mapping[done]`. Any other
   pre-state — `Backlog`, `Unstarted`, `Cancelled`, etc. — surfaces a
   `TrackerReleaseLockPreconditionError` (NFR-10 canonical refusal)
   *without* invoking the Done transition. This guards the
   `Backlog → Done` silent-leap failure mode.
2. **STE-84 idempotent-terminal branch.** If the pre-state is already
   `status_mapping[done]`, return `already-released` and proceed to step 4
   (post-release verify) without writing. The ticket is already at the
   target state; re-asserting it is a no-op the runbook treats as
   successful.
3. **Transition to Done.** Look up the active adapter's `transition_status`
   row in `adapters/<tracker>.md` § Tool surface and invoke that MCP call
   with the target `status_mapping[done]`. Returns `transitioned`.
4. **Post-release verify (silent no-op trap).** Re-fetch via
   `mcp__<tracker>__get_issue(<id>)` and assert `status ==
   status_mapping[done]`. AND assert `updatedAt` / `completedAt` advanced
   past the pre-call value (skipped on the `already-released` branch — no
   write was performed). If either assertion fails, surface an NFR-10
   canonical-shape refusal naming the ticket plus observed-vs-expected
   status. The silent no-op trap from `adapters/linear.md` § Silent no-op
   trap is the rationale: the MCP can return a successful-looking response
   while the ticket didn't move.

The two return outcomes — `transitioned`, `already-released` — match
`TrackerProvider.releaseLock`'s return contract (STE-84 AC-STE-84.5).
Phase 4d step (c)'s `Provider.getTicketStatus(<id>)` assertion is step 4
of this runbook — the assertion semantics (`status ==
status_mapping[done]`) survive unchanged; only the API reference is
replaced with the runbook pointer.

## Parallelization interaction (Pattern 9 invariant)

`/implement` parallel dispatch is documented in `docs/parallel-execution.md`.
In tracker mode, each parallel subagent must run its own ticket-binding
pre-flight against its own branch — no shared cache. Concurrent writes to
the same ticket surface via STE-11 `updatedAt` mismatch on the next
`/gate-check` (AC-STE-11.3). `mode: none` behavior is unchanged regardless of
parallelization.
