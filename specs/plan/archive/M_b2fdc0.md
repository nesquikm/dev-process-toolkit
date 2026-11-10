---
milestone: M_b2fdc0
status: archived
archived_at: 2026-11-10T16:30:35Z
kickoff_branch: null
frozen_at: null
migration: none
codename: House Rules
shipped_in: v3.4.0
---

# Implementation Plan

## M_b2fdc0 — Owners keep their Epic current and tests run as declared {#M_b2fdc0}

**Goal:** Fix two field reports together. The repository that planned a milestone can edit its Jira Epic's description and summary after explicit consent, and a ticket fetched in the session proves its own ownership. The gate and skip-baseline captures run the test commands a project declares.

**Prerequisites:** v3.3.0 merged (main e9d6c655).

**Release target:** v3.4.0, a minor after v3.3.0: STE-730 is Added; the other eight FRs are Fixed or Changed. Verify against CHANGELOG.md before shipping.

**Addendum (2026-11-10).** A second field report adds STE-731 to STE-737: operator scope "All but 4 and 5" of its triage. The pull-request relay reads the owning session's transcript; the Rust API page gets a named warning, not a rustdoc extractor.

**Operator rulings (2026-11-10).** Both reports ship as one milestone with one full test run. Epic writes widen to description and summary only, behind an exact consent answer; this reverses the STE-699 no-consent ruling for those two fields. Ownership comes from the session transcript, never from an agent-written file. Declared commands live in the settings file; absent means today's behaviour.

**Migration:** none. The settings key is optional and no consumer artifact moves.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-729 | The planning repository can edit its Epic's text with consent, and a fetched ticket proves ownership | linear:`STE-729` |
| STE-730 | The test capture runs the commands a project declares | linear:`STE-730` |
| STE-731 | Lock commits carry only the lock | linear:`STE-731` |
| STE-732 | The test capture reads Vitest, Cargo and Playwright counts, and refuses another runner's output | linear:`STE-732` |
| STE-733 | A spec-only commit needs no gate run, and a worker's spec review vouches for the pull request its owner opens | linear:`STE-733` |
| STE-734 | A bug found after ship and before merge has a named route | linear:`STE-734` |
| STE-735 | The spawn allow-list probe grades only repositories that spawn children | linear:`STE-735` |
| STE-736 | Archived plans keep working links, and three messages say what they mean | linear:`STE-736` |
| STE-737 | API signature extraction finds a TypeScript project in a subfolder and names an unsupported Rust stack | linear:`STE-737` |

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
- [x] Limit the three lock commits to their lock paths, add the `lock.ts` front door, and release after the archive commit in /spec-archive (STE-731)
  verify: foreign staged file twins, the archive-order pin and the pathspec mutation rows
- [x] Add the vitest, cargo and playwright parsers, the Cargo default, the Vitest refusal and the mislabel refusal (STE-732)
  verify: recorded-output fixtures, fake runners on PATH, unchanged bun/pytest/flutter fixtures
- [x] Add the spec-only commit carve-out and the owner-transcript pull-request relay (STE-733)
  verify: one twin per condition through the shipped wrappers, mutation rows per rule
- [x] Document the after-ship bug route and point probe #27's remedy at it (STE-734)
  verify: remedy and layout pins
- [x] Scope probe #62 to the smoke-test scaffold (STE-735)
  verify: with and without scaffold twins
- [x] Fix archived-plan link depth, the verify_mode message, probe #45's plural subject and the visual-check note (STE-736)
  verify: one test per fix
- [x] Read a subfolder TypeScript project and warn on Rust in the signature extractor (STE-737)
  verify: nested, root and Cargo fixtures
- [x] One full serial suite run for the whole milestone, then /gate-check (all FRs)
  verify: 0 fail; skip identities equal the trunk baseline by name

<!-- token-stats:begin -->

## Token Stats

| scope | model | input | output | cache-read | cache-creation |
| --- | --- | ---: | ---: | ---: | ---: |
| dev-process-toolkit:gate-check | claude-opus-5-5 | 220 | 100700 | 65205620 | 675453 |
| dev-process-toolkit:implement | claude-opus-5-5 | 72 | 22807 | 10256157 | 280170 |
| dev-process-toolkit:ship-milestone | claude-opus-5-5 | 62 | 19016 | 20131244 | 85215 |
| dev-process-toolkit:spec-archive | claude-opus-5-5 | 38 | 11652 | 11079392 | 43795 |
| dev-process-toolkit:spec-write | claude-opus-5-5 | 432 | 227033 | 53297124 | 832771 |
| dev-process-toolkit:tdd | claude-opus-5-5 | 298 | 162590 | 60719895 | 543454 |
| (main-loop) | claude-opus-5-5 | 1100 | 315192 | 189971694 | 931452 |
| design/exploration | claude-opus-5-5 | 128 | 27523 | 6514887 | 113397 |
| total |  | 2350 | 886513 | 417176013 | 3505707 |

<!-- token-stats:end -->
