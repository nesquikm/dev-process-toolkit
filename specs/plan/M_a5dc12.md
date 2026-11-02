---
milestone: M_a5dc12
status: active
archived_at: null
kickoff_branch: null
frozen_at: null
migration: none
codename: Closing Time
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

- [ ] Add the epic-close front door with its four checks and register it as a receipt-writing module
  verify: each failing check refuses with no receipt; all four passing writes one receipt
- [ ] Teach the tracker write gate to admit a status-only Epic transition on an epic-close receipt, and fix its remedy text
  verify: permit leg and every forbid leg through the shipped wrapper; amended refusal pins green
- [ ] Mirror the Epic-close rule in the live grader and point the ship-milestone close step at the front door
  verify: hook/grader parity test green
- [ ] Add the shared archive-only classifier
  verify: permit and forbid twins for every allowed and disallowed edit
- [ ] Wire the classifier into the commit gate and the PR gate, and document the carve-out
  verify: archive-only commit and PR pass with no evidence; every forbid twin still refuses
- [ ] Mutation controls for each rule
  verify: removing each rule reds at least one named test

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean
