---
id: fr_01KPR3M74WN5NYPM4D2PSQ8CQS
title: /setup --migrate Flow
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-14
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

A distinct invocation of `/setup` that migrates an existing project between modes (`none → tracker`, `tracker → none`, `tracker → other tracker`). Migration is atomic: any failure leaves CLAUDE.md mode and `specs/` unchanged.

## Acceptance Criteria

- AC-STE-14.1: `/setup --migrate` is a distinct invocation mode of the `/setup` skill (not a separate skill)
- AC-STE-14.2: Detects current mode from CLAUDE.md and the presence/absence of `specs/`
- AC-STE-14.3: Supports transitions: `none → <tracker>`, `<tracker> → none`, `<tracker> → <other tracker>`
- AC-STE-14.4: `none → <tracker>`: extracts ACs from each FR in `specs/requirements.md`, calls `upsert_ticket_metadata(null, title, description)` per FR to create a tracker ticket with the AC checklist mirrored from local, captures returned ticket IDs, writes them into the traceability matrix. **Local `requirements.md` AC content is preserved unchanged** — the migration adds the tracker mirror; it does not remove the local source (Path B: both sides hold ACs)
- AC-STE-14.5: `<tracker> → none`: pulls ACs from each FR's tracker ticket, reconciles with the already-present local AC list via STE-17 per-item prompts if drift exists, writes the resolved state back into `specs/requirements.md`; tracker tickets left intact by default (user prompted to optionally close them)
- AC-STE-14.6: `<tracker> → <other>`: pulls AC lists and metadata from old tracker, runs STE-17 reconciliation against local (in case of drift), pushes resolved state to new tracker via `upsert_ticket_metadata`, updates traceability matrix; old tickets not deleted
- AC-STE-14.7: Migration is atomic — any step failure leaves CLAUDE.md mode unchanged and `specs/` unchanged; partial side effects on the tracker side are reported to the user with a retry/rollback prompt in NFR-10 canonical shape
- AC-STE-14.8: `none → <tracker>` bulk sync calls `upsert_ticket_metadata` per FR in order, captures returned ticket IDs, writes them into `specs/requirements.md`'s traceability matrix; partial mid-bulk failure prompts user to retry or roll back created tickets

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
