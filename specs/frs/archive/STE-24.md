---
title: Skills Retrofit for v2 Layout
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-24
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

All 12 skills are updated to read and write the v2 layout. A new regression fixture `tests/fixtures/v2-minimal/` captures a golden v2 tree; CI verifies no skill regresses against it.

## Acceptance Criteria

- AC-STE-24.1: All 12 skills pass their existing regression probes against `tests/fixtures/v2-minimal/` (no regressions vs. v1 behavior on equivalent inputs)
- AC-STE-24.2: `/spec-write` creates new FRs as `specs/frs/<ulid>.md` via `Provider.mintId()`; never writes to `specs/requirements.md` on v2 projects
- AC-STE-24.3: `/implement` reads ACs from `specs/frs/<ulid>.md`, enforces one-ticket-one-branch via STE-28, archives via STE-22
- AC-STE-24.4: `/spec-archive` resolves its argument to a specific ULID (direct, or via milestone grouping to a set of ULIDs) and archives via `git mv` + status flip
- AC-STE-24.5: `/gate-check` adds a v2-conformance probe: ULID-filename match (AC-STE-18.1/STE-18.2), required frontmatter fields present, `specs/.dpt-layout` at expected version
- AC-STE-24.6: `/spec-review` reads v2 files for its consistency checks (traceability, FR-to-code mapping)
- AC-STE-24.7: `/brainstorm`, `/tdd`, `/simplify`, `/debug`, `/pr`, `/visual-check` run against v2 fixtures without modification (read-only or layout-agnostic), verified by regression tests
- AC-STE-24.8: `tests/fixtures/v2-minimal/` is checked in with: `specs/.dpt-layout` (`version: v2`), 3 sample FR files with full frontmatter, 1 archived FR under `specs/frs/archive/`, 1 active plan file, 1 completed plan file, a slimmed `technical-spec.md` and `testing-spec.md`. `verify-regression.ts` gets a new probe layer asserting each skill's output against the fixture is byte-identical to a captured snapshot

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
