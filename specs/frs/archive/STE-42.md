---
title: Complete v1→v2 Migration — Strip Per-Milestone Blocks from Cross-Cutting Files
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-42
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

FR-40 AC-40.3 mandates that post-migration, no FR-specific or per-milestone content exists in `technical-spec.md` / `testing-spec.md`. The v1→v2 migration tool (M13 Phase D, `adapters/_shared/src/migrate/`) split FRs but left per-milestone narrative in place. Current state: `technical-spec.md` at **1213 lines** with `# M{N}:` blocks; `testing-spec.md` at **578 lines** with `## 6. M12 — Tracker Integration Testing` and `## 7. M13 — Parallel-safe Spec Layout Testing` sections.

## Acceptance Criteria

- [x] AC-63.1: `specs/technical-spec.md` contains only cross-cutting content (Architecture, Data Model, Schemas A–G, Skill Modification Map, Size Budgets) — zero `# M{N}:` or per-milestone headings
- [x] AC-63.2: `specs/testing-spec.md` contains only cross-cutting content (Framework, Strategy, Conventions, Coverage Targets, Test Data) — zero `## <N>. M{N} — ...` milestone-specific sections
- [x] AC-63.3: Per-milestone content previously in these files is relocated: per-FR `## Technical Design` / `## Testing` sections go into the relevant `specs/frs/<ulid>.md`; cross-milestone narrative that's genuinely cross-cutting (e.g., M12's Tier-5 manual conformance checklist if still applicable) stays after rewording to drop the milestone frame
- [x] AC-63.4: Line-count targets after relocation: `technical-spec.md` ≤ 600 lines (currently 1213); `testing-spec.md` ≤ 300 lines (currently 578)
- [x] AC-63.5: v1→v2 migration tool (`adapters/_shared/src/migrate/`) is updated so future v1→v2 migrations perform the per-milestone strip at migration time; a regression fixture locks the behaviour (v1 fixture with per-milestone content → v2 output has zero `# M{N}:` headings in cross-cutting files)
- [x] AC-63.6: `/gate-check` adds a lint probe: grep `specs/technical-spec.md` and `specs/testing-spec.md` for `^#{1,3} M\d+` — any match fails the gate with a pointer to AC-40.3

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session. Finding #8 of 8. Largest single FR in M15 by LOC of change. Affects both repo state (spec files to rewrite) and migration tool code.
