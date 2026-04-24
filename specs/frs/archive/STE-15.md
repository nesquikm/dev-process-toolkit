---
title: Per-Tracker AC Placement Convention
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-15
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Each adapter declares where ACs live in its tracker's native data model. This is the only spec content placement the adapter is responsible for — all other spec files stay local in both modes.

## Acceptance Criteria

- AC-STE-15.1: Linear adapter places ACs as `- [ ]` checkboxes under a `## Acceptance Criteria` heading in the issue description
- AC-STE-15.2: Jira adapter places ACs in the discovered custom field (recorded in CLAUDE.md per AC-STE-9.6)
- AC-STE-15.4: Adapters declare their AC placement in the `ac_storage_convention` frontmatter field (per Schema M); skills consume the convention only via the adapter, never by hard-coding tracker-specific logic
- AC-STE-15.5: Linear adapter applies semantic markdown diffing (not string diff) before pushing AC updates, to avoid Linear's description normalization round-trip loop
- AC-STE-15.6: Tracker ticket description, as produced by `upsert_ticket_metadata`, contains the full FR description body **and** a visible back-link to `specs/requirements.md#FR-{N}` — the back-link is mandatory, so PMs viewing a ticket can always find the local source

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
