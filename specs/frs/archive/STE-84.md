---
id: fr_01KPYMEND800M23STE84BBBBBB
title: TrackerProvider.releaseLock idempotent-terminal branch
milestone: M23
status: archived
archived_at: 2026-04-24T12:55:00Z
tracker:
  linear: STE-84
created_at: 2026-04-24T12:31:00Z
---

## Requirement

`TrackerProvider.releaseLock` today (post-STE-65) asserts the ticket's pre-release status is `"in_progress"` and throws `TrackerReleaseLockPreconditionError` otherwise. This is the right behavior for `/implement` Phase 4 Close — it catches the `Backlog → Done` silent-leap bug that STE-65 was built for.

But `/spec-archive` bulk-archival calls `releaseLock` per FR (AC-STE-28.4). In the real-world workflow where every FR ships via single-FR `/implement` (which releases the tracker ticket to Done via its own Phase 4 Close), **every ticket is already at `status_mapping.done` by the time `/spec-archive M<N>` runs**. Every `releaseLock` call throws, and bulk archival either fails atomically or (if the caller catches) skips tracker writes entirely — neither is the right shape.

STE-84 narrows the pre-state assertion to allow already-terminal tickets: `status === "done"` short-circuits the call to `transitionStatus` and returns `"already-released"`. Non-In-Progress-and-non-Done pre-states still throw (STE-65's invariant preserved). `/spec-archive` bulk-archival stops tripping; `/implement` Phase 4 Close gains a cleaner signal for the "ticket was already released out-of-band" case.

## Acceptance Criteria

- AC-STE-84.1: `Provider.releaseLock` return type in `adapters/_shared/src/provider.ts` changes from `Promise<void>` to `Promise<"transitioned" | "already-released">`. No other interface members change.
- AC-STE-84.2: `TrackerProvider.releaseLock` implementation in `adapters/_shared/src/tracker_provider.ts` behavior:
  - `pre.status === "in_progress"` → call `transitionStatus("done")` + verify write landed + return `"transitioned"` (existing behavior).
  - `pre.status === "done"` → return `"already-released"` immediately; do NOT call `transitionStatus`; do NOT call `verifyWriteLanded` (no write occurred).
  - `pre.status ∉ {"in_progress", "done"}` → throw `TrackerReleaseLockPreconditionError` naming the observed status (existing STE-65 behavior; narrowed set).
- AC-STE-84.3: `LocalProvider.releaseLock` in `adapters/_shared/src/local_provider.ts`:
  - Existing behavior: delete `.dpt-locks/<ulid>`.
  - New return: `"transitioned"` if the lock file existed and was deleted; `"already-released"` if no lock file was present (silently idempotent).
- AC-STE-84.4: The three consumers of `Provider.releaseLock` are touched up:
  - **`/implement` Phase 4 Close step (b)** — SKILL.md prose names the two possible return values and treats `"already-released"` as a valid exit path (not an error); step (c)'s `getTicketStatus` verification runs identically for both.
  - **`/spec-archive` single-FR path** — SKILL.md prose names the two return values in the Diff Preview: `releaseLock` row shows either `(tracker mode: transition_status → done)` or `(tracker mode: already-released)`.
  - **`/spec-archive` bulk-archival path** — Diff Preview aggregates the two counts (`N transitioned, M already-released`) in the summary row.
- AC-STE-84.5: `TrackerReleaseLockPreconditionError` error message still names `"in_progress"` as the expected pre-state (the throw path is unchanged; only the return-early branch is new). STE-65's canonical-shape tests continue to pass byte-identically for non-Done non-In-Progress pre-states.
- AC-STE-84.6: `tests/tracker_provider.test.ts` gains four new test cases: (1) `in_progress` pre-state returns `"transitioned"`, (2) `done` pre-state returns `"already-released"` and does NOT call `transitionStatus`, (3) `backlog`/`cancelled`/`unstarted` pre-state still throws the existing error, (4) error message byte-identical to STE-65's spec. `tests/local_provider.test.ts` gains two cases: lock-file-present returns `"transitioned"`, lock-file-absent returns `"already-released"`.
- AC-STE-84.7: `/gate-check` ticket-state-drift probe (STE-54 AC-STE-54.3) behavior is unchanged. The probe reads archive-side tickets and asserts they're at `status_mapping.done` — the idempotent-release path preserves this invariant (already-Done tickets remain Done; newly-transitioned tickets reach Done). New prose-assertion test `tests/releaselock-idempotent.test.ts` covers the probe's unchanged shape + one positive-path test that walks an archived FR whose ticket was released via the `"already-released"` path and confirms the probe passes.

## Technical Design

**Interface change** (`adapters/_shared/src/provider.ts`):

```typescript
// Before
releaseLock(id: string): Promise<void>;

// After
releaseLock(id: string): Promise<"transitioned" | "already-released">;
```

**`TrackerProvider.releaseLock` implementation:**

```typescript
async releaseLock(id: string): Promise<"transitioned" | "already-released"> {
  const trackerRef = await this.resolveTrackerRef(id);
  if (!trackerRef) return "already-released"; // no binding → no-op (existing silent path)
  const pre = await this.driver.getTicketStatus(trackerRef);
  if (pre.status === "done") return "already-released";
  if (pre.status !== "in_progress") {
    throw new TrackerReleaseLockPreconditionError({
      ticketRef: trackerRef,
      trackerKey: this.driver.trackerKey,
      observedStatus: pre.status,
    });
  }
  await this.driver.transitionStatus(trackerRef, "done");
  await this.verifyWriteLanded(trackerRef, pre.updatedAt, "releaseLock");
  return "transitioned";
}
```

**`LocalProvider.releaseLock` implementation:**

```typescript
async releaseLock(id: string): Promise<"transitioned" | "already-released"> {
  const lockPath = this.lockPathFor(id);
  if (!(await fileExists(lockPath))) return "already-released";
  await rmAndCommit(lockPath);
  return "transitioned";
}
```

**Call-site touch-ups** are SKILL.md prose + minor ignoring of the new return value where it isn't used (destructuring / optional binding). No control-flow changes in callers.

## Testing

Six new unit tests across two files (`tracker_provider.test.ts`, `local_provider.test.ts`) per AC-STE-84.6 — covers both implementations and the three pre-state branches. One integration-shape test (`releaselock-idempotent.test.ts`) covering the ticket-state-drift probe's unchanged shape.

## Notes

**Why narrow (not remove) the pre-state check.** STE-65's origin was a real bug: a ticket at `status: backlog` got silent-transitioned to `done` by `releaseLock` because `claimLock` was skipped. That failure mode is still dangerous and the throw on non-terminal-non-In-Progress pre-states catches it. Loosening only the `done` case is the minimal relaxation that fixes the bulk-archive friction without weakening the guardrail against the original bug class.

**Return discrimination vs. void + log line.** The return-value approach was chosen over a silent path + log-line because callers (`/spec-archive` bulk) want to report aggregate counts in the Diff Preview — a `void` signature would force them to call `getTicketStatus` separately, doubling the tracker calls per archived FR and undoing NFR-8's call-budget discipline. The return type makes the information free.

**Release target:** v1.24.0. Phase A of M23 plan.
