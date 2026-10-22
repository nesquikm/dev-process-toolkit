---
milestone: M_bae31f
status: archived
archived_at: 2026-10-22T17:59:57Z
kickoff_branch: null
frozen_at: null
migration: none
codename: Off Switch
shipped_in: v2.101.0
---

# Implementation Plan

## M_bae31f — Per-user relief for the tracker write gate {#M_bae31f}

**Goal:** Answer GitHub issue #118. A user can switch pre-tracker-write-gate off for themselves through the plugin's userConfig, loudly and never silently. With the gate on, a free-text answer that names the ticket key and says yes counts as adopting that ticket.

**Prerequisites:** v2.100.1 merged at 5d2c0734 (PR #120), merged main green 19402/0/16.

**Release target:** a minor release after v2.100.1: one Added FR and one Changed FR. Verify against CHANGELOG.md before shipping.

**Operator rulings.** 2026-10-22 brainstorm: scope is the free-text re-ask and a per-user escape hatch; the hatch is a full off (approach 1, userConfig only); free text counts only when it names the key, starts affirmative and carries no negation. Out of scope: the VS Code transcript gap and a lighter ritual for comments.

**Migration:** none — the option defaults to enforce, so no consumer artifact changes.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-693 | A user can switch the tracker write gate off for themselves | linear:`STE-693` |
| STE-694 | A typed answer naming the key adopts the ticket | linear:`STE-694` |

### Tasks

- [x] Measure live how Claude Code delivers a plugin userConfig value to a hook, at user and project scope
  verify: the measurement and its transcript are recorded in the FR Notes before any gate code changes
- [x] Declare `tracker_write_gate` in plugin.json userConfig and honour `off` in the hook with one stderr line
  verify: off exits 0 with the line; enforce and absent are byte-identical to today
- [x] Report the switch from /gate-check and document it in the hooks reference
  verify: the probe row names the setting and the docs name the scope rule
- [x] Teach the shared consent predicate the typed-answer rule and amend AC-STE-607.4 and AC-STE-650.8
  verify: hook, grader and answeredAfter agree on every row of the consent matrix, D-8 negatives included

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean

<!-- token-stats:begin -->

## Token Stats

| scope | model | input | output | cache-read | cache-creation |
| --- | --- | ---: | ---: | ---: | ---: |
| dev-process-toolkit:gate-check | claude-opus-5-5 | 44 | 13688 | 5327488 | 137143 |
| dev-process-toolkit:implement | claude-opus-5-5 | 158 | 35510 | 10415681 | 298035 |
| dev-process-toolkit:tdd | claude-opus-5-5 | 26 | 12438 | 3760938 | 17281 |
| (main-loop) | claude-opus-5-5 | 732 | 206783 | 92042421 | 471351 |
| total |  | 960 | 268419 | 111546528 | 923810 |

<!-- token-stats:end -->
