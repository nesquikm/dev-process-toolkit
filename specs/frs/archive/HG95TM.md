---
id: fr_01KPR3M74XA75GJKT4Z4HG95TM
title: Two-Stage Review in /implement Phase 3 Stage B
milestone: M10
status: archived
archived_at: 2026-04-13T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Split Stage B's single `code-reviewer` invocation into two sequential passes: **Pass 1 — Spec Compliance** (ACs implemented? undocumented features?) and **Pass 2 — Code Quality** (existing canonical rubric in `agents/code-reviewer.md`). Pass 2 runs only if Pass 1 returns no critical findings (fail-fast).

## Acceptance Criteria

- AC-23.1: `implement/SKILL.md` Phase 3 Stage B section names two passes explicitly, in order: "Pass 1 — Spec Compliance", "Pass 2 — Code Quality"
- AC-23.2: Each pass invokes the `code-reviewer` subagent via the `Agent` tool with a pass-specific prompt (Pass 1 prompt references `requirements.md` ACs; Pass 2 prompt references the canonical rubric)
- AC-23.3: Fail-fast rule documented verbatim: "If Pass 1 returns critical findings, do NOT run Pass 2; surface Pass 1 findings and stop."
- AC-23.4: Stage B report aggregates results under two subheadings — `### Pass 1: Spec Compliance` and `### Pass 2: Code Quality`
- AC-23.5: Skipped Pass 2 (due to Pass 1 fail) is reported as "Pass 2: Skipped (Pass 1 critical findings)", not silently omitted
- AC-23.6: `agents/code-reviewer.md` documents the two return-contract shapes (one for spec-compliance pass, one for code-quality pass) — both use the existing OK / CONCERN format from Schema J
- AC-23.7: When `specs/` does not exist, Pass 1 is skipped silently and Pass 2 runs as the sole review (graceful degradation for non-spec projects)
- AC-23.8: `implement/SKILL.md` remains under 300 lines after the Stage B rewrite (NFR-1)

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M10-second-look.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
