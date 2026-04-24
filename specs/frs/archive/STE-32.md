---
title: `/implement` Tracker-ID Entry
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-32
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/implement` accepts a tracker ID or URL as its argument and resolves to the local FR's ULID transparently. If no local FR exists for the tracker ref, it runs the same import flow as `/spec-write` (shared code path) and then proceeds into lock claim + implementation. Interoperates with M12's branch-name-based ticket binding (STE-27): when both the branch name and the argument suggest a ticket and they disagree, the argument wins with a warning.

## Acceptance Criteria

- AC-STE-32.1: `/implement <arg>` calls `resolveFRArgument(arg, config)` at entry (after layout version gate and before M13's lock-claim check)
- AC-STE-32.2: `{kind: 'ulid'}` → existing M13 flow (claim lock, implement)
- AC-STE-32.3: `{kind: 'tracker-id' | 'url'}` + `findFRByTrackerRef` returns a ULID → resolve to ULID, continue with existing claim-lock + implement flow
- AC-STE-32.4: `{kind: 'tracker-id' | 'url'}` + no local FR found → `importFromTracker(trackerKey, trackerId)` runs (shared helper with STE-31 — one code path, called from both skills), then the skill continues to claim lock + implement the newly created FR
- AC-STE-32.5: Branch-name ticket binding (M12 STE-27) remains functional. If the branch name contains a ticket ID AND the argument resolves to a different ticket ID, the argument wins. The mismatch surfaces as a warning in NFR-10 shape; implementation proceeds unless the user cancels
- AC-STE-32.6: `{kind: 'fallthrough'}` → skill handles it per existing contract (e.g., free-form argument may match a milestone code for `/implement M13` existing behavior)
- AC-STE-32.7: Errors surface per NFR-10 canonical shape

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
