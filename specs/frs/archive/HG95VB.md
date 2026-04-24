---
id: fr_01KPR3M74XA75GJKT4Z4HG95VB
title: Stable Anchor IDs in Spec Templates
milestone: M7
status: archived
archived_at: 2026-04-10T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Archival pointers and the traceability matrix both depend on stable identifiers that survive heading renames and reordering. Spec templates, `/setup`, and `/spec-write` must embed explicit anchor IDs on every archivable unit. Without this, FR-16 pointers become ambiguous the first time anyone edits a heading.

## Acceptance Criteria

- AC-18.1: `templates/spec-templates/plan.md.template` milestone heading format is `## M{N}: {title} {#M{N}}` — the `{#M{N}}` anchor suffix is literal in the template
- AC-18.2: `templates/spec-templates/requirements.md.template` FR heading format is `### FR-{N}: {title} {#FR-{N}}`
- AC-18.3: AC line format uses the prefix `- AC-{N}.{M}: ` (the AC ID itself is the anchor — matches the existing convention, no change needed)
- AC-18.4: `spec-write/SKILL.md` contains a plain-text instruction that every milestone and FR the skill generates or edits must carry its stable anchor ID; any heading without one is flagged as a warning
- AC-18.5: `setup/SKILL.md` doctor validation (from FR-4) adds a check: if `specs/` exists, verify every `## M{N}:` and `### FR-{N}:` heading carries a matching `{#...}` anchor; missing anchors report under `GATE PASSED WITH NOTES`
- AC-18.6: `docs/patterns.md` contains a section titled `### Stable Anchor IDs` explaining the pointer-stability rationale and the anchor format per unit type

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M7-bounded-context.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
