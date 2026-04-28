---
title: One-Ticket-One-Branch Enforcement
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-28
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/implement <ulid>` refuses to start work on an FR already in-flight on another branch. Tracker mode uses tracker status + assignee as the strict guarantee; tracker-less mode uses `.dpt-locks/<ulid>` files + remote fetch as a best-effort signal.

## Acceptance Criteria

- AC-STE-28.1: Tracker mode: at `/implement <ulid>` entry, `Provider.getMetadata(id)` is called; skill refuses if the FR's tracker status is `in progress` AND assignee is not the current user, with a message naming the other assignee and branch
- AC-STE-28.2: Tracker-less mode: at `/implement <ulid>` entry, skill runs `git fetch --all` then inspects `.dpt-locks/<ulid>` across all remote branches; refuses if present on any branch other than the current one
- AC-STE-28.3: On successful claim, `Provider.claimLock(id, branch)` runs — tracker mode sets status `in progress` + assignee; tracker-less mode creates and commits `.dpt-locks/<ulid>` containing the branch name + ISO timestamp
- AC-STE-28.4: On Phase 4 completion OR explicit `/implement --release-lock <ulid>`, `Provider.releaseLock(id)` runs (clears tracker status → `done`, or deletes `.dpt-locks/<ulid>` and commits)
- AC-STE-28.5: `/gate-check` lists stale locks — `.dpt-locks/<ulid>` entries on branches that are merged into main or deleted — as warnings, and offers a `--cleanup-stale-locks` action that deletes them in a single commit
- AC-STE-28.6: Tracker-less lock claim is best-effort by design: two devs committing locks on separate branches without fetching first is a detectable-not-prevented race. AC-STE-28.2's `git fetch` makes it detectable on the next `/implement` entry; this is called out in docs as "tracker mode is the strict guarantee"
- AC-STE-28.7: `DPT_SKIP_FETCH=1` environment variable skips the `git fetch --all` step in AC-STE-28.2 for large-repo contexts; documented trade-off (NFR-16)

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
