---
id: fr_01KPR3M74XA75GJKT4Z4HG95TR
title: Plan Template Task Decomposition Discipline
milestone: M10
status: archived
archived_at: 2026-04-13T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Tighten `plan.md.template` so tasks are sized for verifiable progress (roughly one commit's worth) with an explicit verification step per task. Add an anti-pattern callout about mega-tasks.

## Acceptance Criteria

- AC-26.1: `templates/spec-templates/plan.md.template` task list example shows each task as a 2-line entry: line 1 = action (`- [ ] Add X`), line 2 indented = `verify: <command or observation>`
- AC-26.2: Template includes an explicit `### Task Sizing` section/note stating: "Each task should be ≈ one commit's worth of work — small enough that the verification step is unambiguous"
- AC-26.3: Template includes an anti-pattern callout listing at least two bad task examples (e.g., `- [ ] Implement entire feature`, `- [ ] Refactor and add tests and update docs`) with a one-line reason for each
- AC-26.4: `spec-write/SKILL.md` `plan.md` section references the new "Task Sizing" guidance so `/spec-write` generates `plan.md` content conforming to AC-26.1
- AC-26.5: Existing `plan.md` files in downstream projects are not broken — the template change is additive (new guidance + example formatting), no required heading renames

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M10-second-look.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
