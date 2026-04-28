---
id: fr_01KPR3M74XA75GJKT4Z4HG95TN
title: Rationalization-Prevention Table in /gate-check
milestone: M10
status: archived
archived_at: 2026-04-13T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Add a borrowed-from-`superpowers` table to `gate-check/SKILL.md`'s Red Flags section that maps common rationalizations to their reality, hardening the "evidence over claims" stance.

## Acceptance Criteria

- AC-24.1: `gate-check/SKILL.md` "Red Flags" section contains a subsection titled `### Rationalization Prevention` with a table of exactly two columns: "Excuse" and "Reality"
- AC-24.2: Table contains at minimum these 6 rows (exact strings, in order): "Should work now" / "Run the verification"; "I'm confident" / "Confidence ≠ evidence"; "Just this once" / "No exceptions"; "Linter passed" / "Linter ≠ compiler / tests"; "Agent said success" / "Verify independently"; "Partial check is enough" / "Partial proves nothing"
- AC-24.3: No change to gate logic, verdict strings (NFR-4), or commands — this FR is documentation-only inside an existing skill
- AC-24.4: `gate-check/SKILL.md` remains under 300 lines (NFR-1)

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M10-second-look.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
