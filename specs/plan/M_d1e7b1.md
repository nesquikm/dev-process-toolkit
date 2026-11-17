---
milestone: M_d1e7b1
status: active
archived_at: null
kickoff_branch: fix/conformance-2026-11-17
frozen_at: null
migration: none
codename: Read Back
---

# Implementation Plan

## M_d1e7b1 — Graded by what the probe said {#M_d1e7b1}

**Goal:** Fix the findings of the 2026-11-17 conformance run (v3.7.0, linear + jira + none legs). One shipped probe runner prints a fixed row per probe, so smoke fixtures grade the probe's own output instead of the model's wording. Probe #14 passes the ticket state /spec-write leaves, and the commit gate refuses a failed gate outcome. /implement's report fits its caps, and its self-review escalates instead of editing the FR. A --no-tech spec-research skip names itself. The spec auditors cite their tree facts. The receipt recogniser accepts one narrow `cd` form, and spec deletions get the spec-only pass. The smoke harness fixtures reach their subjects.

**Prerequisites:** v3.8.0 on main (0bc55466).

**Release target:** v3.9.0, a minor: two Added FRs (STE-756, STE-752) and six Fixed FRs.

**Design:** the Phase A triage of the 2026-11-17 conformance report, as ruled by the orchestrator. Gate policy is delegated in the kickoff: spec approval, FR commits, archive and release are approved by the worker.

**Decisions.**

- The runner calls existing probe modules only and adds no probe semantics. Its row set must equal the registry's project-root-only probes, pinned by a test, so a later probe cannot skip silently.
- Tracker and MCP probes (#8, #14, #26) and the prose-defined probes stay with the model, rendered in the same fixed grammar.
- The receipt recogniser widens by exactly one shape: `cd <literal dir> && bun <literal path> …` with the receipt last. Variable paths stay unsupported.
- Probe #14's not-started carve-out needs all three conditions: initial lane, no checked task for the FR, no lock.
- F14 (group 14 unreachable headless) gets no fix beyond reporting N/A (headless).
- STE-744, STE-750 and STE-751 were archived in the cap cleanup and are not restored; the FRs that supersede them say so.

**Migration:** none. No consumer artifact changes shape; the runner is a new module and the receipt change is a recogniser widening.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-756 | One probe runner prints a fixed row per probe, and the fixtures grade that row | linear:`STE-756` |
| STE-825 | Probe #14 passes a ticket that is not started, and the commit gate refuses a failed gate | linear:`STE-825` |
| STE-745 | The /implement report fits its caps, and fixture 15a grades the whole report | linear:`STE-745` |
| STE-835 | /implement's self-review stops before it edits the FR | linear:`STE-835` |
| STE-752 | A --no-tech run names its legal spec-research skip | linear:`STE-752` |
| STE-826 | The spec-review audits state only tree facts they checked | linear:`STE-826` |
| STE-791 | The gate receipt counts under one narrow cd form, and spec deletions get the spec-only pass | linear:`STE-791` |
| STE-824 | The smoke harness reaches what each fixture names and stays out of the operator's stores | linear:`STE-824` |

### Tasks

- [x] STE-752: `spec_research_skipped_no_tech` in spec-write, brainstorm, the key registry and the smoke --no-tech capture
  verify: registry and contract tests red before, green after
- [x] STE-826: spec auditors cite the read behind a file-existence claim; /spec-review re-checks claims
  verify: contract tests on both agent files and the skill
- [x] STE-835: Phase 3 FR conflict escalates with `implement_spec_conflict_escalated`
  verify: contract tests on SKILL, reference and key registry
- [x] STE-745: lead-in template + caps in /implement; 15a grades the whole final message
  verify: template sentences fit the cap; model report exits 0; old cut drops an exempt section
- [x] STE-825: probe #14 not-started carve-out; commit gate refuses a recorded fail outcome
  verify: each single-condition failure still fails; fail/pass-after-fail/foreign-checkout hook tests
- [x] STE-791: narrow `cd` receipt form; spec-deletion pass; smoke driver evidence docs
  verify: one negative test per rejected shape; outside-specs deletion gets no pass
- [x] STE-756: `gate_probe_rows.ts` + `gate_probe_runner.ts`, `probe-row` expectation, fixtures 3c/9a/9b/2a/2c re-keyed
  verify: runner set equals registry project-root-only set; prose-only capture fails 3c; probe #81 green
- [x] STE-824: smoke harness fixes 1b/5b, group 2, Phase 4, 3a/3b, 13a, group 14, Phase 0.5, child-spawn; missing capture exits 2
  verify: contract test per AC; CLI test for missing capture
