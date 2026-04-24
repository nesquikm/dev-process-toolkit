---
id: fr_01KPR3M74XA75GJKT4Z4HG95TS
title: Tighten Question-Batching Prevention in /brainstorm and /spec-write
milestone: M11
status: archived
archived_at: 2026-04-13T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Reinforce the one-clarifying-question-at-a-time rule in both skills so Claude doesn't batch questions at phase transitions or inside `/spec-write`'s per-section question blocks. Observed violation: in the v1.13.0 session, the brainstorm → spec-write handoff batched 2 independent scope-lock questions, and `/spec-write`'s "Ask the user:" bullet lists encouraged question-batching-by-design. Fix is in the skill files themselves (not in per-project memory) since the plugin runs in downstream projects where per-project memory doesn't apply.

## Acceptance Criteria

- AC-28.1: `skills/brainstorm/SKILL.md` "Rules" section gains an explicit sub-rule stating: one question per turn applies at phase transitions too, even when two questions look independent
- AC-28.2: `skills/brainstorm/SKILL.md` gains a short rationalization-prevention table (between 3 and 6 rows) mapping common batching excuses to reality — e.g., "These two are independent" / "Ask the first, wait, then the second"; "Efficiency wins" / "Efficiency ≠ batching"; "User is responsive, I'll batch" / "The socratic form is the rule, responsiveness is not license"
- AC-28.3: `skills/spec-write/SKILL.md` per-section question blocks (under `#### requirements.md`, `#### technical-spec.md`, `#### testing-spec.md`, `#### plan.md`) are reshaped from bulleted simultaneous questions to explicit ordered waiting: each question is presented as "Ask {Q1}. Wait for the answer. Then ask {Q2}." — the list of questions stays the same, only the framing changes
- AC-28.4: `skills/spec-write/SKILL.md` "Rules" section gains an explicit one-at-a-time rule that mirrors brainstorm's phrasing (cross-skill schema — AC-28.5 enforces the literal match)
- AC-28.5: The one-at-a-time rule text is byte-identical in `brainstorm/SKILL.md` and `spec-write/SKILL.md` (treated as a cross-skill schema — see NFR-4 precedent). A single canonical sentence both skills cite
- AC-28.6: Both skill files remain under 300 lines after the tightening (NFR-1)
- AC-28.7: Changes are additive — existing workflow contract not broken, no heading renames, no removed steps, no new required user-facing questions

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M11-single-file.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
