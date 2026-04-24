---
title: `/spec-write` Tracker Import
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-31
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/spec-write` accepts a tracker ID or URL as its argument. On first encounter with a tracker ref that has no local FR, it imports the ticket from the tracker via `Provider.getMetadata`, mints a ULID, and creates `specs/frs/<ulid>.md`. On subsequent calls with the same tracker ref, it opens the existing FR for editing — no duplicate imports. Initial import bypasses STE-17's per-AC diff loop, since the local side is empty and tracker ACs are authoritative by default.

## Acceptance Criteria

- AC-STE-31.1: `/spec-write <arg>` calls `resolveFRArgument(arg, config)` at entry (after layout version gate per STE-29)
- AC-STE-31.2: `{kind: 'ulid'}` → open/edit existing FR by ULID (unchanged pre-M14 behavior)
- AC-STE-31.3: `{kind: 'tracker-id' | 'url'}` AND `findFRByTrackerRef` returns a ULID → open/edit that existing FR; no import, no network call beyond the resolve
- AC-STE-31.4: `{kind: 'tracker-id' | 'url'}` AND no local FR found → import flow runs: `Provider.getMetadata(trackerKey, trackerId)` → user prompted to pick milestone from `specs/plan/M*.md` (fallback: free-text, validated against existing milestone codes) → `Provider.mintId()` → write `specs/frs/<ulid>.md` with frontmatter `{id, title, milestone, status: active, tracker: {<key>: <id>}, created_at}` and body populated from the tracker description + ACs → `Provider.sync()` for any write-back (e.g., tracker-side URL-to-FR metadata) → `regenerateIndex(specsDir)`
- AC-STE-31.5: Initial import MUST NOT trigger STE-17's per-AC prompt loop. All tracker ACs are imported wholesale under `## Acceptance Criteria`. Documented as an explicit exception to AC-STE-17.2's classification behavior: empty-local ⇒ auto-accept-tracker, no user prompt
- AC-STE-31.6: Subsequent `/spec-write` invocations on the same tracker ID (after the initial import) follow STE-17's normal diff/resolve flow — both sides are now populated and diffs are meaningful
- AC-STE-31.7: Empty tracker ACs (ticket description has no recognizable AC list) → the created FR file's `## Acceptance Criteria` section contains a single TODO marker line, consistent with STE-23's handling of AC-less FRs during migration
- AC-STE-31.8: All error surfaces (tracker unreachable, ticket not found, access denied, milestone not picked) conform to NFR-10 canonical shape

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
