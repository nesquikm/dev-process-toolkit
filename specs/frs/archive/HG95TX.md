---
id: fr_01KPR3M74XA75GJKT4Z4HG95TX
title: Drift Detection in `/gate-check` and `/implement` (partial — AC-1.1..1.4 only; AC-1.5 archived in M4)
milestone: M3
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Add a lightweight drift check to `/gate-check` that compares spec ACs against implementation. `/implement` Phase 4 references the drift summary in its report.

## Acceptance Criteria

- AC-1.1: `gate-check/SKILL.md` contains a section titled `## Drift Check` placed after the `## Code Review` section
- AC-1.2: The Drift Check section contains a conditional: `If specs/ directory exists` (literal or equivalent phrasing) — when no specs exist, the section instructs to skip silently
- AC-1.3: The Drift Check section contains a table with columns: `AC ID`, `Status` (implemented / not found / no AC), `Location`
- AC-1.4: The Drift Check section contains the literal instruction: `Drift findings do NOT cause GATE FAILED` and specifies they appear under `GATE PASSED WITH NOTES`

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M3-gate-check-and-code-reviewer.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
