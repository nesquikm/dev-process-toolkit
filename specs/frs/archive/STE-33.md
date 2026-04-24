---
id: fr_01KPR3M74XA75GJKT4Z4HG95TF
title: `/spec-archive` Tracker-ID Resolution
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-33
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`/spec-archive` accepts a tracker ID or URL. If a local FR with that tracker ref exists, it archives via M13's `git mv` + status-flip path. If no local FR exists, it refuses (archival never auto-imports — archiving a ticket that has no local presence is semantically nonsensical).

## Acceptance Criteria

- AC-STE-33.1: `/spec-archive <arg>` calls `resolveFRArgument(arg, config)` at entry
- AC-STE-33.2: `{kind: 'ulid'}` → existing M13 flow (archive via `git mv` + frontmatter `status: archived`)
- AC-STE-33.3: `{kind: 'tracker-id' | 'url'}` + `findFRByTrackerRef` returns a ULID → resolve to ULID, archive via the same path as AC-STE-33.2
- AC-STE-33.4: `{kind: 'tracker-id' | 'url'}` + no local FR → refuse with NFR-10 canonical error: `"No local FR mapped to <tracker>:<id>. Archival never auto-imports. To dismiss the tracker ticket, close it in the tracker directly."` Non-zero exit; no side effects
- AC-STE-33.5: Milestone-level archival (`/spec-archive M12`) is unaffected — the `^M\d+$` argument is a known keyword per AC-STE-30.7 and short-circuits tracker-ID branches entirely
- AC-STE-33.6: Resolver call is defensive: if `resolveFRArgument` returns `fallthrough`, the skill proceeds with its pre-M14 argument handling (e.g., milestone codes, explicit ULID)

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
