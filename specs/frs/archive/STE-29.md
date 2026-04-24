---
id: fr_01KPR3M74XA75GJKT4Z4HG95T8
title: Layout Version Marker + Cross-Skill Gate
milestone: M14
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-29
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

`specs/.dpt-layout` records the current layout version. Every spec-touching skill reads this on entry and refuses to run against a mismatched version, routing the user to `/setup` for migration.

## Acceptance Criteria

- AC-STE-29.1: `specs/.dpt-layout` is a YAML file with required fields: `version` (string, e.g., `v2`), `migrated_at` (ISO date), `migration_commit` (git SHA, null if `/setup` generated a fresh v2 tree)
- AC-STE-29.2: A shared utility `readLayoutVersion(specsDir)` lives in `adapters/_shared/src/layout.ts` and is invoked by every spec-touching skill on entry
- AC-STE-29.3: On version mismatch, skills exit with non-zero status and the exact message: `"Layout v<actual> detected; <skill> requires v<expected>. Run /dev-process-toolkit:setup to migrate."`
- AC-STE-29.4: `/setup` itself is exempt from the gate (it implements the migration) — this exemption is explicit in the utility via a `{ allowMissing: true }` flag
- AC-STE-29.5: `/gate-check` includes a check that `specs/.dpt-layout` exists and is the expected version; missing marker on a project with `specs/requirements.md` fails with a pointer to `/setup --migrate`

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
