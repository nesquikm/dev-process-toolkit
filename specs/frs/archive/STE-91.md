---
title: README workflow advertisement for /docs + /ship-milestone
milestone: M25
status: archived
archived_at: 2026-04-24T21:20:14Z
tracker:
  linear: STE-91
created_at: 2026-04-24T20:40:28Z
---

## Requirement

README.md:3 advertises 14 commands by count but the Quickstart/Workflow walkthrough enumerates only 12. `/docs` and `/ship-milestone` (both shipped v1.23.0) are missing from the golden-path description. A cold user reading the README will discover these two skills only by poking around the plugin files or running `/help`.

## Acceptance Criteria

- AC-STE-91.1: README Quickstart/Workflow walkthrough includes `/docs` with a one-line description matching its SKILL.md summary (e.g., "Generate or update project docs — staged fragments + canonical regeneration."). {#AC-STE-91.1}
- AC-STE-91.2: README Quickstart/Workflow walkthrough includes `/ship-milestone` with a one-line description (e.g., "Bundle the Release Checklist + /docs --commit --full into one atomic release commit."). {#AC-STE-91.2}
- AC-STE-91.3: Order in the walkthrough is consistent with the workflow's actual sequence — `/docs` sits alongside the documentation/verification skills; `/ship-milestone` sits at the release step (after `/pr`). {#AC-STE-91.3}
- AC-STE-91.4: README's "14 skills (slash commands)" count line (line 3) remains unchanged and consistent with the walkthrough length. {#AC-STE-91.4}

## Technical Design

Two README walkthrough additions. No code changes, no new tests.

## Testing

No new test required.

## Notes

Consider whether `/docs` belongs in the main workflow table (it's invoked optionally, not every cycle) or in a separate "release-time skills" subsection. Either is acceptable; the audit's M20 just asked for them to be mentioned somewhere in the golden-path narrative.
