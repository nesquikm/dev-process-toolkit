---
id: fr_01KPR3M74XA75GJKT4Z4HG95TW
title: Risk Scan Automation in `/spec-write`
milestone: M2
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Make the risk scan a structured step with explicit categories and severity ratings.

## Acceptance Criteria

- AC-10.1: `spec-write/SKILL.md` step 6 (Risk scan) contains a table with columns: `Category`, `Risk`, `Severity`, `Mitigation`
- AC-10.2: The category list contains exactly 6 items: external dependencies, breaking changes, security surface, performance impact, data migration, unclear acceptance criteria
- AC-10.3: Severity uses exactly 3 levels: `high`, `medium`, `low`
- AC-10.4: The section contains the literal instruction: `Any high-severity risk must be resolved or explicitly accepted before proceeding to implementation`

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M2-light-touch-skills.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
