---
milestone: M_0cac80
status: active
archived_at: null
kickoff_branch: fix/m_0cac80-bug-follow-ups
frozen_at: null
migration: none
codename: Fine Print
---

# Implementation Plan

## M_0cac80 — Bug follow-ups graded in place {#M_0cac80}

**Goal:** Close the follow-ups M_7384cf (v2.99.0) left open. The bug FR check grades each section under its own parent and stops accepting a TODO regression criterion; import refuses a ticket it cannot read; the bun count fallback stops under-reporting passes; and the bug type check runs before a new milestone Epic exists.

**Prerequisites:** v2.99.0 merged at dfe51708 (PR #115).

**Release target:** v2.99.1, a patch: four Fixed FRs. Verify against CHANGELOG.md before shipping.

**Operator rulings.** 2026-10-21 /deliver run, brainstorm approach #1, self-approved under the operator's standing delegation: one patch milestone, four FRs filed as `kind: bug` with the Linear Bug label (the feature dogfooded on its own fixes). The Epic key becomes optional rather than reordering the mint, because the type rule does not depend on which Epic.

**Migration:** none — no consumer artifact changes shape.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-681 | Probe 88 grades each bug section where it belongs | linear:`STE-681` |
| STE-682 | Import refuses a ticket it cannot read for bug detection | linear:`STE-682` |
| STE-683 | Bun count fallback stops subtracting skips twice | linear:`STE-683` |
| STE-684 | Bug type check runs before a new milestone Epic exists | linear:`STE-684` |

### Tasks

- [ ] Grade bug subsections under their parent sections and reject a TODO regression body in probe #88
  verify: placement and TODO-regression fixtures red before, green after
- [ ] Move a ticket-supplied Root cause under Technical Design on import; document placement and Schema Q `kind`
  verify: import fixture with all four subsections supplied passes probe #88
- [ ] Refuse an import whose ticket answer cannot be read for bug detection
  verify: null-labels, missing-issuetype and missing-item fixtures refuse; plain and bug controls unchanged
- [ ] Make the bun fallback total skip-inclusive
  verify: fallback fixture reads pass 5, fail 1, skip 2 through deriveRunCounts
- [ ] Make the Jira Epic key optional in the bug type check and order the check before the Epic mint
  verify: front door grades a type with no key; prose pins
- [ ] Investigate the M_7384cf first-run wedge (100% CPU, 83 exact-limit timeouts) and record findings below
  verify: a Findings paragraph exists in this plan, reproducible or not
- [ ] Run the mutation battery
  verify: each mutation applied alone reddened its test

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to main's baseline
- `/gate-check` clean
