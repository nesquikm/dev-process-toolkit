---
milestone: M_0cac80
status: archived
archived_at: 2026-10-21T07:45:19Z
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

- [x] Grade bug subsections under their parent sections and reject a TODO regression body in probe #88
  verify: placement and TODO-regression fixtures red before, green after
- [x] Move a ticket-supplied Root cause under Technical Design on import; document placement and Schema Q `kind`
  verify: import fixture with all four subsections supplied passes probe #88
- [x] Refuse an import whose ticket answer cannot be read for bug detection
  verify: null-labels, missing-issuetype and missing-item fixtures refuse; plain and bug controls unchanged
- [x] Make the bun fallback total skip-inclusive
  verify: fallback fixture reads pass 5, fail 1, skip 2 through deriveRunCounts
- [x] Make the Jira Epic key optional in the bug type check and order the check before the Epic mint
  verify: front door grades a type with no key; prose pins
- [x] Investigate the M_7384cf first-run wedge (100% CPU, 83 exact-limit timeouts) and record findings below
  verify: a Findings paragraph exists in this plan, reproducible or not
- [x] Run the mutation battery
  verify: each mutation applied alone reddened its test

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to main's baseline
- `/gate-check` clean

### Wedge investigation

**Not reproduced.** No session reproduced the wedge: this session's baseline gate ran 16:39 wall clock with pass 19047, fail 0, skip 16, while TDD forks and a read-only sweep ran beside it. Everything below is static analysis: grep/rg sweeps and reading the code. The original symptoms were 83 timeouts at exactly 5000 ms and 77+ min at 100% CPU, on a machine at load ~17.

**What was searched.** Three read-only sweeps covered `tests/**`, `adapters/_shared/src/**`, `templates/hooks/**`, `hooks/` and `scripts/`. They looked for:
- deadline loops: `Bun.sleepSync`, `Atomics.wait`, `while (Date.now()/performance.now() <`
- transcript-lag waits, retry/backoff loops, `while(true)`/`for(;;)`
- `spawnSync` / `execFileSync` calls with no `timeout`

An adversarial pass then tried to refute each "unbounded" candidate. As a control, the same grep over product source (adapters, hooks, scripts, skills, `templates/hooks/*.sh`) found zero synchronous deadline loops, while it did find the loops in `tests/`, so the pattern works.

| Site | Kind | Bound |
|---|---|---|
| `tests/_ste594_harness.ts:395` `waitForKind` | sleepSync loop, re-reads the call log every 50 ms | 5000 ms + 200 ms |
| `tests/_ste594_harness.ts:412` `waitDead` | sleepSync loop polling `kill -0` | 10 000 ms default (5000 ms from `reap`); EPERM counts as alive |
| `tests/_ste594_harness.ts:465` `spawnLive` | sleepSync loop, forks `ps` every 20 ms | 2000 ms, but each `ps` call has no timeout (about 100 forks per call) |
| `tests/m_4df444-ste-595-phase-a-fence-run.test.ts:109` / `:151` | sleepSync loops | 4000 + 200 ms / 5000 ms |
| `templates/hooks/_lib/session.ts:889`, `pre-tracker-write-gate.ts:2571` | sleepSync, transcript lag | 2000 ms, in hook child processes started with async `Bun.spawn` (does not block the runner) |
| `adapters/_shared/src/attach_project_milestone.ts:529` | async retry | 3 retries, 7 s total; tests inject a sleep recorder |
| Nested `bun test` via `spawnSync`, e.g. `m_79b1f6-ste-590:216`, `-591:155`, `-589:809`, `-588:394`, `m120-ste-444:597`, `m143-ste-552:422`, `m121-ste-458:944`, `m_102cfa-ste-672:141` | sync spawn of whole suites | **none**; chains go up to 3 levels deep (672 → 590 → nested) |
| Self-re-run mutation overlays, e.g. `m_1e0717-ste-664:770` plus 13 siblings (665, 670, 671, 673, 674, 557, m104-384, …) | `Bun.spawnSync(["bun","test",THIS_FILE,"-t",…])` | **none** |
| `adapters/_shared/src/spawn_receipt.ts:466`, `signature_extractor.ts:216` | sync spawn of an external command | **none** (`signature_extractor` is driven by no test) |

**Counts.** There are 5 synchronous deadline loops in tests and 2 in hook source (bounded, child processes only). There are about 349 `spawnSync` calls across 138 test files, mostly with no timeout. Product source has about 25 git `spawnSync` sites with no timeout; they were refuted as hang risks because they finish on their own in time proportional to their input.

**Confirmed unbounded (verify stage).**
- The nested and self-re-running `bun test` `spawnSync` sites above.
- `spawn_receipt.ts:466` and `signature_extractor.ts:216`.

Contested or refuted:
- `falsifiability_harness.ts:723` (`bash -c` with no timeout): one pass confirmed it, the other refuted it because the commands are finite grep-style assertions.
- `smoke_session_cleanup.ts:143` (`lsof`): has no bound, but no test reaches it because every test stubs `isHeld`/probes.

No deadline loop without a bound was found.

**How well the lead fits.** It explains part of the picture.
- It fits the timeout reports. Bun cannot preempt synchronous code, so a test that sits in `waitDead` (10 s) or in a nested `bun test` is reported only once it returns. Every such test is then labelled with the configured 5000 ms timeout, which matches "exactly 5000 ms". Under load ~17, the loops sized at 4–10 s and the `ps`-forking `spawnLive` would overrun together.
- It does not explain the CPU. `Bun.sleepSync` sleeps rather than spins, and a parent blocked in `spawnSync` sits idle. The 5 loops therefore cannot produce 77 min at 100% CPU.
- A better CPU candidate is the nested `bun test` children with no timeout. Each is a full bun process re-running whole suites, up to 3 levels deep, while the outer runner and its timeouts wait on them.
- Precedent: `skip_identities.ts:250` records that a default-5 s full run had a timeout storm and then stalled at 0% CPU with no children, twice (M_85e846). With `--timeout 30000` the same run finished in 380 s with 0 fails. The plain `bun test` gate does not pass that flag.

**Recommended follow-ups (not implemented now).**
1. Add `timeout` and `killSignal: "SIGKILL"` to every nested `bun test` `spawnSync` call (one shared helper). Consider an env guard that refuses nesting past 1 level.
2. Add a `bunfig.toml` `[test] timeout` (around 30 000 ms) so the plain gate matches the measured `--timeout 30000` run.
3. Bring the sleepSync waits in `_ste594_harness.ts` and the ste-595 test under the per-test budget, or make them async (`await Bun.sleep`) so bun can time them out. Add a timeout to the `ps` calls in `spawnLive`.
4. Add timeouts to `spawn_receipt.ts:466`, `signature_extractor.ts:216` (matching its dart/griffe siblings) and `falsifiability_harness.ts:723`.
5. On the next occurrence, capture `ps -axo pid,ppid,pcpu,etime,command | grep bun` while it is happening, to tell a spinning test from a nested-suite pile-up.
