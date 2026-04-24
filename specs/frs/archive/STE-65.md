---
title: Pre-state assertion in TrackerProvider.releaseLock (guard claimLock-skipped leak)
milestone: M19
status: archived
archived_at: 2026-04-23T14:49:58Z
tracker:
  linear: STE-65
created_at: 2026-04-23T13:17:29Z
---

## Requirement

The M18 ship dogfood surfaced a failure mode: `/implement` Phase 4 Close called `Provider.releaseLock` on all three M18 tickets and transitioned them `Backlog → Done`, skipping `In Progress` entirely. Root cause: Phase 1 step 0.c (`claimLock`) was silently omitted by the implementer; nothing in the stack objected. Linear history for STE-60/61/62 now shows no `startedAt` timestamp — the tickets never "started" even though their work shipped.

Fix: `TrackerProvider.releaseLock` must re-fetch the ticket's current status **before** calling `transition_status → Done` and assert the pre-state is the adapter's canonical `in_progress` mapping. Any other pre-state (Backlog, Unstarted, Cancelled, already-Done) raises an NFR-10-shape error naming the ticket, the observed status, and the "run claimLock first" remedy. Exits non-zero so Phase 4 Close fails loudly — no silent `Backlog → Done` leap.

Complement to the existing `TrackerWriteNoOpError` post-write guard: pre-write asserts the ticket is in the expected state; post-write asserts the write landed. Both layers together make `releaseLock` fail-closed.

## Acceptance Criteria

- AC-STE-65.1: `TrackerProvider.releaseLock(id)` calls `driver.getTicketStatus(trackerRef)` before `driver.transitionStatus(trackerRef, "done")`. The current implementation already does this fetch for the `updatedAt` baseline; STE-65 adds a pre-state check on the same returned object. No additional MCP call — NFR-8 call budget preserved.
- AC-STE-65.2: If the returned `status` is not `"in_progress"`, `releaseLock` throws a new `TrackerReleaseLockPreconditionError` and does NOT call `transitionStatus`. The error extends `Error`, carries `ticketRef`, `trackerKey`, and `observedStatus` as readonly fields. Its `message` is NFR-10 canonical shape:

  ```
  TrackerProvider.releaseLock: ticket <trackerKey>:<ticketRef> is in "<observedStatus>" state; expected "in_progress".
  Remedy: /implement Phase 1 step 0.c (Provider.claimLock) was skipped or the ticket was moved out-of-band. Transition the ticket to In Progress manually (or rerun /implement from Phase 1 so claimLock fires), then re-run Phase 4 Close.
  Context: trackerKey=<trackerKey>, ticket=<ticketRef>, operation=releaseLock
  ```

- AC-STE-65.3: `LocalProvider.releaseLock` is unchanged. `mode: none` has no tracker state to assert; the deterministic `.dpt-locks/<id>` delete remains the proof-of-release (mirrors STE-54's sentinel treatment).
- AC-STE-65.4: `adapters/_shared/src/tracker_provider.test.ts` gains explicit coverage for each rejected pre-state: `backlog`, `unstarted`, `cancelled`, `done`, `completed`. Each test constructs a stub driver whose `getTicketStatus` returns the rejected status and asserts (a) `releaseLock` throws `TrackerReleaseLockPreconditionError`, (b) `driver.transitionStatus` is NOT called (call count === 0), (c) the error message contains the canonical NFR-10 shape substrings (`"expected \"in_progress\""`, `"Remedy:"`, `"Context: trackerKey="`).
- AC-STE-65.5: Existing happy-path tests that pass `in_progress` as the pre-state continue to pass unchanged. The existing mock driver that returns `in_progress` from `getTicketStatus` satisfies the new assertion without test rewrites.
- AC-STE-65.6: `skills/implement/SKILL.md` Phase 4 Close step (b) gains a one-line pointer: *"`releaseLock` asserts the ticket's pre-state is In Progress (STE-65); a skipped or out-of-band claimLock surfaces as an NFR-10 refusal before the Done transition."*
- AC-STE-65.7: `plugins/dev-process-toolkit/adapters/linear.md` "Silent no-op trap" section gains a sibling "claimLock-skipped trap" subsection explaining the pre-state assertion, cross-referenced to STE-65.
- AC-STE-65.8: `CHANGELOG.md` v1.22.0 entry names the user-facing impact: **(a)** downstream projects whose `/implement` runs accidentally skip `claimLock` now fail loudly at Phase 4 Close rather than leaking a silent `Backlog → Done` transition, **(b)** operators who manually moved a ticket to Done between claim and release must rerun the skill (or manually revert the status) — the write side no longer papers over tracker drift. The M18 ship's tickets (STE-60/61/62) are cited as the dogfooding regression that motivated this FR.

## Technical Design

**Module edits:** `plugins/dev-process-toolkit/adapters/_shared/src/tracker_provider.ts` only. No Provider interface change (the new behavior is inside `releaseLock`'s body; the signature is unchanged).

**New error class** (exported alongside `TrackerWriteNoOpError`):

```typescript
export class TrackerReleaseLockPreconditionError extends Error {
  readonly ticketRef: string;
  readonly trackerKey: string;
  readonly observedStatus: TicketStatus;
  constructor(args: { ticketRef: string; trackerKey: string; observedStatus: TicketStatus }) {
    super(
      `TrackerProvider.releaseLock: ticket ${args.trackerKey}:${args.ticketRef} is in "${args.observedStatus}" state; expected "in_progress".\n` +
      `Remedy: /implement Phase 1 step 0.c (Provider.claimLock) was skipped or the ticket was moved out-of-band. ` +
      `Transition the ticket to In Progress manually (or rerun /implement from Phase 1 so claimLock fires), then re-run Phase 4 Close.\n` +
      `Context: trackerKey=${args.trackerKey}, ticket=${args.ticketRef}, operation=releaseLock`
    );
    this.name = "TrackerReleaseLockPreconditionError";
    this.ticketRef = args.ticketRef;
    this.trackerKey = args.trackerKey;
    this.observedStatus = args.observedStatus;
  }
}
```

**`releaseLock` refactor.** Current body:

```typescript
async releaseLock(id: string): Promise<void> {
  const trackerRef = await this.resolveTrackerRef(id);
  if (!trackerRef) return;
  const pre = await this.driver.getTicketStatus(trackerRef);
  await this.driver.transitionStatus(trackerRef, "done");
  await this.verifyWriteLanded(trackerRef, pre.updatedAt, "releaseLock");
}
```

Becomes:

```typescript
async releaseLock(id: string): Promise<void> {
  const trackerRef = await this.resolveTrackerRef(id);
  if (!trackerRef) return;
  const pre = await this.driver.getTicketStatus(trackerRef);
  if (pre.status !== "in_progress") {
    throw new TrackerReleaseLockPreconditionError({
      ticketRef: trackerRef,
      trackerKey: this.driver.trackerKey,
      observedStatus: pre.status,
    });
  }
  await this.driver.transitionStatus(trackerRef, "done");
  await this.verifyWriteLanded(trackerRef, pre.updatedAt, "releaseLock");
}
```

Reuses the existing single `getTicketStatus` fetch — no extra MCP calls.

## Testing

Five new negative-path tests in `tracker_provider.test.ts` (one per rejected pre-state: `backlog`, `unstarted`, `cancelled`, `done`, `completed`). Each constructs a stub driver returning the rejected status, calls `releaseLock`, asserts the throw type + message substrings + `transitionStatus` call count === 0. One happy-path test (may reuse an existing `in_progress` scenario) asserts the transition lands when pre-state is correct. No E2E tests — the skill integration is covered by the prose assertion in AC-STE-65.6.

## Notes

**Why this wasn't caught before M18.** M17 STE-54 added `getTicketStatus` post-release verification (Phase 4 Close step (c)) — but that fires *after* `transitionStatus` has landed. A `Backlog → Done` transition satisfies the post-release check (status is now `Done`, matching `status_mapping.done`). STE-65 closes the gap on the pre-write side.

**Not in scope:** post-write rollback of a mistakenly-landed `Done` transition. If `releaseLock` fires on a ticket in the wrong pre-state *after* STE-65 lands, the throw prevents the transition; there's nothing to roll back. Operators who hit the assertion must manually fix the ticket state and re-run.

**Release target:** v1.22.0 (current M19 codename "Branch Convention"). Ships alongside STE-63, STE-64, STE-66. Could bundle with STE-64's PR-2 or ride in its own PR-3 depending on scope at PR time — not a spec concern.

**Symmetry with `claimLock`.** `TrackerProvider.claimLock` already guards its own pre-state (rejects `in_progress + other assignee` as `taken-elsewhere`). STE-65 adds the mirror guard on the release side so both ends of the lifecycle are defended.
