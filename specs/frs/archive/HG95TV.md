---
id: fr_01KPR3M74XA75GJKT4Z4HG95TV
title: Visual-Check Fallback Guidance
milestone: M2
status: archived
archived_at: 2026-04-09T00:00:00Z
tracker: {}
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

**Description:** `/visual-check` should detect MCP availability and offer a manual fallback.

## Acceptance Criteria

- AC-9.1: `visual-check/SKILL.md` contains a step titled `### 0. Check MCP availability` placed before step 1 (dev server check)
- AC-9.2: Step 0 specifies a detection method: attempt a `list_ducks` MCP call; if the call fails or returns an error, MCP is unavailable
- AC-9.3: Step 0 contains a conditional: if MCP unavailable, display a message with the literal text `mcp-rubber-duck is not configured` and a link to the setup instructions
- AC-9.4: The fallback path contains a section titled `### Manual Verification Checklist` with at least 5 items covering: layout correctness, responsive behavior, accessibility basics, browser console errors, visual regressions vs. previous state
- AC-9.5: The fallback checklist ends with a pass/fail summary in the same format as the MCP-assisted path (checkmarks)

## Technical Design

*(not present in v1 archive; left empty during migration)*

## Testing

*(not present in v1 archive; left empty during migration)*

## Notes

Migrated from `specs/archive/M2-light-touch-skills.md` by `/setup --migrate` on 2026-04-21; original archived date preserved.
