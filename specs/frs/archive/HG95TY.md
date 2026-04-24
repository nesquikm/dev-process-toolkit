---
id: fr_01KPR3M74XA75GJKT4Z4HG95TY
title: Security Scanning in `/gate-check`
milestone: M3
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** Make gate-check explicit about security tooling and add security-specific checks to the `<!-- ADAPT -->` examples.

## Acceptance Criteria

- AC-2.1: `gate-check/SKILL.md` Commands section contains an optional step listing security audit tools with examples: `npm audit`, `pip-audit`, `cargo audit`, `flutter pub audit`
- AC-2.2: `gate-check/SKILL.md` Code Review section contains at least 2 security-specific check examples (e.g., "OWASP dependency check", "secrets scanner") as plain instruction text (no `<!-- ADAPT -->` marker — see FR-15)
- AC-2.3: The Code Review rubric's **Security** row contains at least one literal tool name from AC-2.1 (e.g., `npm audit`, `pip-audit`)

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M3-gate-check-and-code-reviewer.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
