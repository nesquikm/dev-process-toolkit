---
milestone: M_a8e09a
status: archived
archived_at: 2026-09-08T10:59:44Z
kickoff_branch: null
frozen_at: null
migration: none
shipped_in: null
---

# Implementation Plan

## M_a8e09a — Gates That Mind Their Own Subject {#M_a8e09a}

**Goal:** Four gates and rules stop asserting about things they do not own — a dogfood that grades a sibling's transient state, a transition issued without reading where the ticket is, a title rule naming a branch that has never existed, and a roll-up that types the number it should derive.

**Prerequisites:** None. Ships after M_a41431.

**Release target:** the next patch after v2.80.5 — verify against `CHANGELOG.md` rather than trusting this line.

These are the four follow-ups M_a41431 left behind. Each one is a surface that makes a claim wider than its own subject, and in three of the four the over-claim is what keeps a real defect invisible.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-574 | The dogfood grades only the subject its milestone owns | linear:`STE-574` |
| STE-575 | /pr transitions the ticket forward only | linear:`STE-575` |
| STE-576 | The PR-title rule states two things that are not true | linear:`STE-576` |
| STE-577 | The blocking-gate count is derived, not typed | linear:`STE-577` |

### The one that loosens a gate

STE-574 is the only FR here that makes a check more permissive, and it is treated as the suspect one. Detection does not move: the conformance probe keeps flagging unshipped ship debt at error severity, and the release skill keeps scanning the plan archive for the same condition. What moves is the instant of grading, back to the operator-invoked surfaces where the remedy is actionable. Both survivors are confirmed by test in the same change rather than assumed after it.

That is still a reduction in automatic pressure, and the FR says so rather than claiming a free lunch.

### What the reports got wrong

Three of the four findings named the wrong file or the wrong mechanism, and acting on the original wording would have been the expensive failure in each case.

The dogfood finding named a file that gets the scoping right and carries a comment predicting this exact deadlock; the flat assert is in a different file. The gate-count finding proposed a mutation to the hook registry, which the derived reader never opens — that mutation is invisible and would read as the finding being false. The same finding pointed at an advisory recorded in the archived notes; it exists only as comments in the reader's own source.

### The trap inside the fix

The gate-count FR is one line away from reproducing its own subject. Two entries of the hand-kept array are bound by index to specific skill files, and the derived set is name-sorted. Swapping the array for the derived set silently regrades the wrong file and stays green. The list is graded; it is not replaced.

### Tasks

- [x] STE-574 — the violation record carries a typed kind
  verify: all four push sites set it, including the one that builds its record inline
- [x] STE-574 — the live-tree assert excludes the kind this milestone does not own
  verify: empty on a reconstructed archive-then-ship window, and the arm reds before the change
- [x] STE-574 — the filter cannot degenerate into selecting nothing
  verify: a corrupt-stamp fixture and a surface-disagreement fixture both survive it
- [x] STE-574 — both surviving detectors are confirmed still wired
  verify: the probe registration and the release skill's archive scan are each asserted
- [x] STE-575 — the transition decision is a pure helper over the observed status
  verify: skip on the done role, skip when no review lane exists, transition otherwise
- [x] STE-575 — the skip is reported in words
  verify: every skip carries a non-empty reason naming the observed status
- [x] STE-575 — the end-to-end arm reds before and passes after
  verify: on a synthetic three-lane config, drift routing yields pass after and genuine drift before
- [x] STE-575 — all three describing surfaces are amended together
  verify: each of the skill bullet, the reference doc and the diagram is asserted separately
- [x] STE-576 — the release-branch clause names what exists
  verify: the bullet no longer carries the phrase, sliced through the existing reader
- [x] STE-576 — the hook claim is replaced with the real constraint
  verify: the validate-against-the-hook clause is gone and the four prose pins still pass
- [x] STE-577 — both suites grade their list against the derived set
  verify: neither roll-up compares against a literal, and each agreement test is first in its file
- [x] STE-577 — the hand-kept arrays and their order are untouched
  verify: the two index-bound entries still name the skill files they name today
- [x] STE-577 — a fourth gate reds both suites, and a removed gate does too
  verify: measured green on the unmutated tree first, and green under the same mutation before the change

### Gate commands

```bash
cd plugins/dev-process-toolkit && bun test
```

### Dependency graph

```
STE-574   STE-575   STE-576   STE-577
```

The four are independent. STE-574 runs first because it is the one that loosens a check, and the rest of the milestone should be measured against a tree where that has already settled.
