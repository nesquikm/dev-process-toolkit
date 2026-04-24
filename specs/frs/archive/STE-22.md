---
id: fr_01KPR3M74XA75GJKT4Z4HG95T6
title: Move-Based Archival
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-22
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Archival moves the FR file via `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` in the same commit that flips the frontmatter `status:` to `archived`. Replaces the current Phase 4 mechanism of rewriting shared `specs/archive/*.md` files — the current hotspot for content collisions.

## Acceptance Criteria

- AC-STE-22.1: `/implement` Phase 4 archival uses `git mv` for the path change (never copy-delete, never rewrite)
- AC-STE-22.2: The archival commit includes both the `git mv` path change AND the frontmatter `status: active` → `status: archived` flip, in a single atomic commit
- AC-STE-22.3: Archived FRs remain readable by every skill (`Provider.getMetadata` returns them normally); they are filtered out of default `INDEX.md` listings
- AC-STE-22.4: `/spec-archive` (manual invocation) uses the same `git mv` + frontmatter-flip mechanism — one archival code path, not two
- AC-STE-22.5: After archival, no skill writes to files under `specs/frs/archive/` except for the frontmatter `status` flip at move time. Archived files are effectively read-only
- AC-STE-22.6: The milestone-level archival entry point (archive all FRs whose `milestone == M12`) is supported as a single operation that performs N `git mv`s + flips in one commit

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
