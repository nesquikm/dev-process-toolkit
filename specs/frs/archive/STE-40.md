---
title: Migration Regenerates INDEX.md After Frontmatter Writes
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-40
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

FR-40 AC-40.4 requires `specs/INDEX.md` to be rebuilt by any skill that writes under `specs/frs/`. Migration writes N frontmatter changes (one per FR) but `docs/setup-migrate.md` doesn't include a `regenerateIndex` call. Stale INDEX becomes a downstream `/gate-check` failure risk (v2-conformance probe AC-49.5). Dogfooded 2026-04-22 — Claude called `regenerateIndex` via `bun --eval` as a manual step.

## Acceptance Criteria

- AC-61.1: After successful none→tracker migration completes frontmatter writes (per FR-58), migration calls `regenerateIndex(specsDir)` before terminating
- AC-61.2: INDEX regeneration runs inside the atomicity boundary (AC-36.7): if it fails, migration surfaces NFR-10 canonical-shape error with the unbound FRs listed; CLAUDE.md mode line is not written
- AC-61.3: Regression fixture asserts: before migration `Tracker` column in INDEX.md is `—` for all FRs; after migration every row shows `<key>:<id>` binding in sorted order (milestone → status → ULID per AC-40.5)
- AC-61.4: `docs/setup-migrate.md` step 5 (sync-log append) becomes step 6; new step 5 is `regenerateIndex(specsDir)` with explicit atomicity wording
- AC-61.5: All other migration directions (`<tracker> → none`, `<tracker> → <other>`) also call `regenerateIndex` — the rule is "any frontmatter write triggers regen" per FR-40 AC-40.4

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #6 of 8. Small but important — closes the AC-40.4 loop.
