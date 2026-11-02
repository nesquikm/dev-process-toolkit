---
milestone: M_a5dc12
status: archived
archived_at: 2026-11-02T19:37:02Z
kickoff_branch: null
frozen_at: null
migration: none
codename: Closing Time
shipped_in: v2.101.3
---

# Implementation Plan

## M_a5dc12 — A shipped milestone can be closed out {#M_a5dc12}

**Goal:** Two defects from a shared-Jira field report against v2.99.1. The release ceremony orders closing a shipped milestone's Epic, and the tracker write gate refuses that write from every repository. A spec-only archive commit and its pull request demand full gate and review runs.

**Prerequisites:** v2.101.2 merged at f4e94914 (PR #124).

**Release target:** the next patch after v2.101.2: two Fixed FRs. Verify against CHANGELOG.md before shipping.

**Operator rulings.** 2026-11-02 brainstorm: (1) one milestone, two FRs; (2) an Epic closes only on plan proof plus ship state, through a receipt front door, with no operator-consent fallback; (3) the gate carve-out is archive-only, on both the commit and the PR gate. The repository is public: synthetic ids only.

**Migration:** none — rules inside bundled hooks and shared modules; no consumer artifact changes.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-699 | A shipped milestone's Epic can be closed from the repository that planned it | linear:`STE-699` |
| STE-700 | An archive-only commit or pull request needs no fresh gate or review run | linear:`STE-700` |

### Tasks

- [x] Add the epic-close front door with its four checks and register it as a receipt-writing module
  verify: each failing check refuses with no receipt; all four passing writes one receipt
- [x] Teach the tracker write gate to admit a status-only Epic transition on an epic-close receipt, and fix its remedy text
  verify: permit leg and every forbid leg through the shipped wrapper; amended refusal pins green
- [x] Mirror the Epic-close rule in the live grader and point the ship-milestone close step at the front door
  verify: hook/grader parity test green
- [x] Add the shared archive-only classifier
  verify: permit and forbid twins for every allowed and disallowed edit
- [x] Wire the classifier into the commit gate and the PR gate, and document the carve-out
  verify: archive-only commit and PR pass with no evidence; every forbid twin still refuses
- [x] Mutation controls for each rule
  verify: removing each rule reds at least one named test

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean

<!-- token-stats:begin -->

## Token Stats

| scope | model | input | output | cache-read | cache-creation |
| --- | --- | ---: | ---: | ---: | ---: |
| agent-toolkit:spawn-agent | claude-opus-5-5 | 90 | 20663 | 18791716 | 185555 |
| dev-process-toolkit:gate-check | claude-opus-5-5 | 216 | 65598 | 40252644 | 494940 |
| dev-process-toolkit:implement | claude-opus-5-5 | 104 | 15705 | 5497230 | 209940 |
| dev-process-toolkit:ship-milestone | claude-opus-5-5 | 22 | 7007 | 3241495 | 63633 |
| dev-process-toolkit:tdd | claude-opus-5-5 | 26 | 5982 | 2036448 | 20030 |
| (main-loop) | claude-opus-5-5 | 844 | 193618 | 82272396 | 467124 |
| total |  | 1302 | 308573 | 152091929 | 1441222 |

<!-- token-stats:end -->
