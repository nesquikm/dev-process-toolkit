---
id: fr_01KPR3M74XA75GJKT4Z4HG95TT
title: Spec-to-Code Traceability in `/spec-review`
milestone: M2
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** `/spec-review` outputs a traceability map showing which code implements which requirement.

## Acceptance Criteria

- AC-7.1: `spec-review/SKILL.md` contains a step titled `Generate traceability map` placed between the implementation scan (step 2) and findings report (step 3)
- AC-7.2: The traceability map uses the format: `AC-X.Y → file:line, test-file:line` (one line per AC)
- AC-7.3: ACs with no implementing code use the literal marker `(not found)`
- AC-7.4: Code in changed files with no corresponding AC is flagged with the label `potential drift`

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M2-light-touch-skills.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
