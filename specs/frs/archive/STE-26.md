---
title: File-per-FR Layout
milestone: M13
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-26
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Each FR lives in its own file at `specs/frs/<ulid>.md` containing the requirement, acceptance criteria, technical design, and testing — all co-located. Replaces the monolithic `requirements.md` / `technical-spec.md` / `testing-spec.md` as the per-FR container; those files shrink to cross-cutting material only. Disjoint filenames make merges between parallel branches additive by construction.

## Acceptance Criteria

- AC-STE-26.1: `specs/frs/` exists after v2 migration; every FR is exactly one file under it (no FR spans multiple files, no file holds multiple FRs)
- AC-STE-26.2: Each FR file has exactly these top-level sections in this order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes`
- AC-STE-26.3: After v2 migration, no FR-specific content exists in `requirements.md` / `technical-spec.md` / `testing-spec.md`; those files hold only cross-cutting material (patterns, architecture, conventions, NFRs)
- AC-STE-26.4: A generated `specs/INDEX.md` is rebuilt by any skill that writes under `specs/frs/`. Lists active FRs with columns: ULID (linked to file), title, milestone, status, primary tracker ref (if any)
- AC-STE-26.5: `specs/INDEX.md` entries are sorted deterministically by `milestone` → `status` → `ULID`

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
