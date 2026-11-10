---
milestone: M_b2fdc0
status: active
archived_at: null
kickoff_branch: null
frozen_at: null
migration: none
codename: House Rules
---

# Implementation Plan

## M_b2fdc0 — Owners keep their Epic current and tests run as declared {#M_b2fdc0}

**Goal:** Fix two field reports together. The repository that planned a milestone can edit its Jira Epic's description and summary after explicit consent, and a ticket fetched in the session proves its own ownership. The gate and skip-baseline captures run the test commands a project declares.

**Prerequisites:** v3.3.0 merged (main e9d6c655).

**Release target:** v3.4.0, a minor after v3.3.0: one Fixed FR and one Added FR. Verify against CHANGELOG.md before shipping.

**Operator rulings (2026-11-10).** Both reports ship as one milestone with one full test run. Epic writes widen to description and summary only, behind an exact consent answer; this reverses the STE-699 no-consent ruling for those two fields. Ownership comes from the session transcript, never from an agent-written file. Declared commands live in the settings file; absent means today's behaviour.

**Migration:** none. The settings key is optional and no consumer artifact moves.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-729 | The planning repository can edit its Epic's text with consent, and a fetched ticket proves ownership | linear:`STE-729` |
| STE-730 | The test capture runs the commands a project declares | linear:`STE-730` |

### Tasks

- [x] Add `epic_edit.ts` with checks (a)-(d), the consent options line and the `epic-edit` receipt; register it as a receipt-writing module (AC-STE-729.1, .2)
  verify: one refusal per failing check with no receipt; one announced receipt when all hold
- [x] Permit the Epic description/summary edit in the gate and its grader mirror (AC-STE-729.3, .4, .8)
  verify: permit leg plus one forbid twin per condition through the shipped wrapper
- [x] Read ownership from the session's fetched ticket in the gate and its grader mirror (AC-STE-729.5, .6, .8)
  verify: owned and adopt legs pass; other-tool, error, other-key and refused-verdict twins refuse
- [x] Require a `container_origin: minted` plan in `epic_edit.ts` and order the marker in the Jira Epic-first mint prose (AC-STE-729.12, .13)
  verify: minted permits; missing, joined and other values refuse; the mint prose pin names both values
- [x] Reword the ownership remedy and amend the STE-649 and STE-699 pins (AC-STE-729.7)
  verify: amended pins green with `Amended by AC-STE-729.7` markers
- [x] Add the hook and grader mutation battery and the unchanged-behaviour check (AC-STE-729.9, .10, .11)
  verify: each removed check reds a named test; existing gate suites green
- [x] Add `verification.test_commands` to the settings loader, key order, `NEW_KEYS` and settings reference (AC-STE-730.1, .2)
  verify: one shape-error row per malformed shape naming its dotted path
- [x] Resolve declared commands in both capture front doors and sum their counts, failing closed (AC-STE-730.3, .4, .5, .6, .7)
  verify: fvm-wrapper, two-entry, red-entry and absent-key fixtures
- [x] Add the capture mutation controls (AC-STE-730.8, .9)
  verify: each removed rule reds a named test
- [x] One full serial suite run from the worktree against trunk e9d6c655, then /gate-check (AC-STE-730.10)
  verify: 0 fail; skip identities equal the trunk baseline by name
