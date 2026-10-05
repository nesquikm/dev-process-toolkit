---
milestone: M_1ef45e
status: active
archived_at: null
kickoff_branch: feat/m_1ef45e-summaries-in-plain-words
frozen_at: null
migration: none
codename: Plainspoken
---

# Implementation Plan

## M_1ef45e — Summaries in Plain Words {#M_1ef45e}

**Goal:** Human-facing summary text reads as plain language. An ASD-STE100-inspired "plain sentences" rule binds four surfaces: the FR Summary, the report lead-in, the PR body Summary and the code-reviewer CONCERN explanation. The FR Summary and report lead-in are graded by a deterministic sentence cap. ACs, design and skill prose are untouched.

**Prerequisites:** v2.94.1 merged at da49cabc (PR #106).

**Release target:** v2.95.0, a minor: one Added FR.

**Operator rulings.** 2026-10-05 brainstorm: scope is summaries and report leads only; approach 2 (prose rule plus sentence cap) chosen over prose-only and fidelity tracing; generated quality must not decrease. Milestone title and codename composed automatically.

**Migration:** none.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-661 | Summary sentences stay short and plain | linear:`STE-661` |

### Tasks

- [x] Add the plain-sentence splitter module with unit tests
  verify: splitter tests green, terminator and dotted-token cases covered
- [x] Add sentence_cap to the Summary row of the altitude scanner, with its own epoch grandfathering
  verify: scanner and provenance fixtures green
- [x] Add the lead-in sentence check to the stage report verifier
  verify: verifier fixtures green; captured fixtures re-checked
- [x] Write the Plain sentences section and the four surface pointers; update probe #67 and stage-block rule text and their pins
  verify: text-assertion tests green, no stale count pin
- [x] Run the mutation battery and the dogfood measurement
  verify: each mutation applied and reddened its test; dogfood zero rows

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to main
- `/gate-check` clean
