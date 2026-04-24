---
id: fr_01KPR3M74XA75GJKT4Z4HG95VA
title: `/spec-archive` Escape-Hatch Skill
milestone: M7
status: archived
archived_at: 2026-04-10T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** A new manual skill for archiving spec content FR-16 can't reach — reopened milestones, ACs not completed via `/implement`, aborted milestones, explicit user-directed compaction. Operates only on user-selected sections, never auto-scans.

## Acceptance Criteria

- AC-17.1: A file `skills/spec-archive/SKILL.md` exists with valid frontmatter (`name`, `description`, `argument-hint`)
- AC-17.2: The skill description states it operates only on user-selected sections identified by stable anchor IDs (FR-18) or explicit heading text — never by auto-scanning for checked boxes
- AC-17.3: The skill contains a step titled `## Present Diff for Approval` that shows the exact lines to be moved before any file is modified
- AC-17.4: The skill never proceeds to file modifications without explicit user approval after the diff is presented
- AC-17.5: Archive files produced by `/spec-archive` use the same file-format (Schema G) as FR-16
- AC-17.6: Pointer lines left by `/spec-archive` use the same format (Schema H) as FR-16
- AC-17.7: The skill contains a subsection titled `### Reopening an Archived Milestone` describing the revision naming `M{N}-r2-{slug}.md` and the rule that the original file is never mutated
- AC-17.8: The skill contains a subsection whose heading includes `Archiving from technical-spec.md` (step-numbering prefix like `### 4.` and backticks around the filename are acceptable) with an explicit warning that architectural decisions should usually be marked `Superseded-by` instead of archived
- AC-17.9: The skill appends one row to `specs/archive/index.md` per archival operation

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M7-bounded-context.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
