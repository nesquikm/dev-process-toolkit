---
title: CLAUDE.md skill enumeration fix
milestone: M25
status: archived
archived_at: 2026-04-24T21:20:14Z
tracker:
  linear: STE-88
created_at: 2026-04-24T20:40:21Z
---

## Requirement

`CLAUDE.md:15` enumerates "12 slash commands (setup, brainstorm, spec-write, implement, tdd, gate-check, debug, spec-review, spec-archive, visual-check, pr, simplify)". Actual skill count as of v1.26.0 is 14 — the enumeration omits `/docs` (shipped v1.23.0 STE-70) and `/ship-milestone` (shipped v1.23.0 STE-73). README.md already carries the final-state phrasing "14 skills (slash commands)" without the name list, which rots less — every new skill invalidates the enumeration but only nudges the count.

## Acceptance Criteria

- AC-STE-88.1: `CLAUDE.md:15` reads `├── skills/                              → 14 slash commands` with no parenthetical name list. {#AC-STE-88.1}
- AC-STE-88.2: `grep -n "slash commands" CLAUDE.md` returns exactly one line matching "14 slash commands". {#AC-STE-88.2}
- AC-STE-88.3: No other location in `CLAUDE.md` references a specific skill count or enumerates skill names. {#AC-STE-88.3}

## Technical Design

One-line edit in `CLAUDE.md`. No code changes, no new tests.

## Testing

No new test required. The invariant is checked at gate time via `bun test` (existing CLAUDE.md content tests, if any, must continue to pass).

## Notes

Drops the skill-name enumeration entirely to match README's phrasing. Future skill addition only updates the count, not a name list.
