---
id: fr_01KPR3M74XA75GJKT4Z4HG95TJ
title: Golden Paths in CLAUDE.md Template and `/setup` Report (partial — AC-13.1..13.3 only; AC-13.4 archived in M5)
milestone: M1
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Add workflow paths to reduce cognitive load from 11 commands.

## Acceptance Criteria

- AC-13.1: `templates/CLAUDE.md.template` contains a section titled `## Workflows` placed after `## Key Commands`
- AC-13.2: The Workflows section contains at least 3 named paths: `Bugfix`, `Feature`, `Refactor` — each listing the ordered skill sequence with arrow notation (e.g., `/debug → /implement → /gate-check → /pr`)
- AC-13.3: Every skill name in the workflow paths exists in `skills/` directory (no broken references)

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M1-templates-and-docs.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
