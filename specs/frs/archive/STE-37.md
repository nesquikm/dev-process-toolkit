---
title: Migration Writes Ticket Bindings to FR Frontmatter (not Traceability Matrix)
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-37
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

`docs/setup-migrate.md:110-111` says to write returned ticket IDs into "the traceability matrix's Implementation column with `ticket=<id>` rows". v2 layout uses per-FR frontmatter's `tracker:` map (FR-42) as the canonical binding surface. Writing to a traceability matrix that no longer holds FR definitions is a no-op on v2. Dogfooded 2026-04-22 — Claude wrote to frontmatter via judgment call.

## Acceptance Criteria

- AC-58.1: In v2 mode, migration writes `tracker:\n  <key>: <id>` into each FR's frontmatter's `tracker:` map after the push succeeds
- AC-58.2: Existing `tracker:` entries are preserved (multi-tracker case per AC-42.4): if an FR already has `tracker: { jira: PROJ-1 }`, adding `linear: LIN-42` results in `tracker: { jira: PROJ-1, linear: LIN-42 }` (alphabetical per AC-42.5)
- AC-58.3: In v1 mode, migration continues to write to the traceability matrix as today (backward compat)
- AC-58.4: Frontmatter serialization uses the same YAML writer that `/spec-write` uses (no ad-hoc inline `{}` form after the first bind — `tracker: {}` is only the empty-state seed emitted by the migration tool)
- AC-58.5: Frontmatter write failure (disk full, permissions) after a successful tracker push is a partial-failure scenario: migration emits NFR-10 canonical shape with a retry/rollback prompt enumerating the un-bound FR IDs; CLAUDE.md mode line is NOT written

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #3 of 8. Reuses `frontmatter.ts` parser; new writer helper needed in `adapters/_shared/src/`.
