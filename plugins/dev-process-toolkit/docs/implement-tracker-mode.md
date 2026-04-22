# `/implement` Tracker Mode Flow

Detailed tracker-mode procedures for `/implement`. Pointed at from
`skills/implement/SKILL.md` step 0 to keep the skill under NFR-1 (≤300 lines).

In `mode: none`, this document is unused — the pre-M12 body runs unchanged.

## Pre-flight sequence (mode-gated, in order)

### 0.1 Ticket-binding pre-flight (FR-32)

Run the 3-tier resolver and mandatory confirmation prompt per
`docs/ticket-binding.md`. Decline exits cleanly with zero side effects
(AC-32.4). Branch-regex ↔ CLAUDE.md `active_ticket:` conflict fails loudly
(AC-32.3).

### 0.2 `pull_acs` + `updatedAt` recording (FR-33, FR-66)

> **Record `updatedAt` AFTER `claimLock` — the claim itself mutates the ticket** (FR-66 AC-66.7). Recording before `claimLock` causes `/gate-check` to fire a false-positive drift warning on the skill's own write (AC-66.1).

Call the active adapter's `pull_acs(ticket_id)` exactly once at skill entry
— **after** step 0.c `claimLock` has returned `claimed` or `already-ours`.
Capture the returned ticket's `updatedAt` (Schema O) into session memory —
not disk. `/gate-check` re-fetches later and compares against this value
(AC-33.3). If the adapter's parser returns an empty AC list, fail the skill
with NFR-10 canonical shape `"No acceptance criteria found in ticket <ID>"`
(AC-35.4). Never silently proceed.

**General rule (AC-66.5).** Record `updatedAt` after all pre-flight side
effects settle — not just `claimLock`. Any pre-flight step that mutates
the tracker (including branch-name interop warning writes, if any future
adapter adds them) bumps `updatedAt`; the session snapshot must reflect
the post-mutation state so `/gate-check`'s drift detection is comparing
against a stable baseline.

**`already-ours` edge case (AC-66.6).** When `claimLock` returns
`already-ours` (a resume on an existing claim) and `pull_acs` returns an
`updatedAt` older than one already recorded for this ticket in the current
session, prefer the newer value. This guards against tracker-API quirks
where a stale read could cause apparent backslide; the session should only
ever advance its recorded `updatedAt` forward in time.

Only feed the parser-returned AC list to the rest of the skill — never the
raw ticket description blob (FR-35 AC-35.2, AC-35.3). Comments, history,
preamble, and attachments are discarded at the parser boundary.

### 0.3 FR-39 diff/resolve loop

Read the local FR's AC list from `specs/requirements.md` (parsed from the
`### FR-{N}:` block's bullet list). Compare against the adapter-returned
`AcList` from step 0.2. Classify each AC:

- **identical** — text + `completed` match exactly (after normalization).
- **local-only** — present locally, absent from tracker.
- **tracker-only** — present in tracker, absent locally.
- **edited-both** — present on both sides with different text.

If all are `identical`, skip the prompt entirely and proceed (AC-39.2
fast path).

If any non-identical AC exists, prompt per-AC with exactly four options
(AC-39.3): `keep local`, `keep tracker`, `merge` (free-text editor),
`cancel`. No bulk shortcuts (AC-39.7).

- `keep local` — overwrite tracker: `upsert_ticket_metadata(ticket_id, title, <rebuilt description with local AC block>)`.
- `keep tracker` — overwrite local: rewrite `specs/requirements.md` FR's
  AC list to match the tracker-canonical form.
- `merge` — open an editor (heredoc prompt), user writes the merged text,
  then apply to **both** sides (local requirements.md + tracker push).
- `cancel` — abort the skill cleanly with zero state mutation on either
  side (AC-39.5).

After all per-AC resolutions apply, both sides converge to the same list
(AC-39.4). Then append one Sync-log entry to CLAUDE.md per AC-39.8:

```
- 2026-04-17T14:30:00Z — 2 AC conflicts resolved on LIN-123
```

(Entry form is enforced by Schema L's bulleted append-only contract.)

## MCP call budget (NFR-8)

`/implement` runs at most **two MCP calls** at startup:

1. `pull_acs(ticket_id)` — once at step 0.2.
2. `upsert_ticket_metadata(ticket_id, title, description)` — at most once
   per FR-39 resolution event (steps 0.3 options `keep local` / `merge`),
   not per AC. If all ACs are `identical` or the user picks `cancel`, this
   call is skipped.

Downstream phases (TDD, gate check, self-review) make **zero additional
MCP calls** — they operate on the session-cached AC list. Live re-fetching
happens only in `/gate-check` (one call, per AC-33.3).

## Graceful degradation (FR-38 AC-38.6)

If the adapter's `capabilities:` frontmatter list is missing
`upsert_ticket_metadata`, FR-39 resolution options that would push (`keep
local`, `merge`) degrade with an NFR-10 canonical-shape warning and proceed
with the local-only half of the resolution applied (tracker side left as-is
for manual correction). `pull_acs` is a hard requirement — an adapter that
doesn't declare it fails the skill at step 0.2.

## Phase 4 — post-commit `releaseLock` (FR-68)

After the user approves and `git commit` lands (step 15 in `skills/implement/SKILL.md`), the skill must call `Provider.releaseLock(<id>)` for every ticket claimed during Phase 1 — this performs the **Done transition** on the tracker side (`transitionStatus(ticket_id, "done")` via the active adapter) and writes the tracker's Done state. Without this call, an FR-scope run — implementing a subset of an in-flight milestone where no archival fires — leaves the ticket stuck at `In Progress` after the commit lands, producing a lying tracker.

Mirror of SKILL.md Phase 4 step 15:

- **When to call:** once per touched ticket, immediately after `git commit` succeeds on a user-approved commit.
- **Done transition wording:** `releaseLock` routes through the adapter's `transition_status(done)` op; in Linear, that's `mcp__linear__save_issue(id, state="Done")`. The `TrackerProvider` post-call `updatedAt` guard (FR-67) fires on a silent no-op.
- **Abort boundary (AC-68.3):** skip `releaseLock` on gate failure, Spec Breakout, user rejection at step 15, or any Phase 1–3 early exit — the in-flight claim must survive for the `already-ours` resume path (AC-46.1).
- **Double-call avoidance (AC-68.6):** on a full-milestone run where § Milestone Archival fires, the archival path's `releaseLock` call per archived FR (AC-46.4) consumes the responsibility — step 15 skips those FRs.

The tracker silent no-op trap (FR-67) means `releaseLock` itself must re-fetch `updatedAt` and assert it advanced — otherwise a bogus Linear response reads as success and the ticket stays at `In Progress`. `TrackerProvider.releaseLock` handles this in shared code; adapter drivers just need to populate `TicketStatusSummary.updatedAt`.

## Parallelization interaction (Pattern 9 invariant)

`/implement` parallel dispatch is documented in `docs/parallel-execution.md`.
In tracker mode, each parallel subagent must run its own ticket-binding
pre-flight against its own branch — no shared cache. Concurrent writes to
the same ticket surface via FR-33 `updatedAt` mismatch on the next
`/gate-check` (AC-33.3). `mode: none` behavior is unchanged regardless of
parallelization.
