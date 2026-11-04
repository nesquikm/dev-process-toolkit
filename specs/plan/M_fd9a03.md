---
milestone: M_fd9a03
status: active
archived_at: null
kickoff_branch: null
frozen_at: null
migration: none
codename: Proof of Work
---

# Implementation Plan

## M_fd9a03 — Reuse only what the gate proves itself {#M_fd9a03}

**Goal:** Let a gate shorten a real run by reusing a deterministic command's pass on identical input. With the knob off, the gate runs exactly as today. With it on, the gate still runs, still writes its receipt and still runs its review. It skips a command only when it recomputes the full key itself and finds a pass this session announced. One settings section holds a closed set of knobs, and a probe refuses anything else. The skills that demand a fresh gate say when a proven reuse counts as fresh.

**Prerequisites:** M_94e6f7 merged (the `specs/settings.yaml` file and its loader). M_7bc805 merged: gate receipts carry a pass or fail outcome and a reuse key. M4 reuses that key function, never a second one. M_d1b4b7 merged, for sequence only: no M_fd9a03 FR reads M_d1b4b7 output.

**Release target:** v3.3.0, a minor after v3.2.0: two Added FRs and one Changed FR. Verify against CHANGELOG.md before shipping.

**Operator rulings.**

- 2026-11-04: shorten real runs only. No knob may lower generated-code quality or disable a deterministic gate.
- Reuse is never hook evidence, and STE-641 stands.
- The LLM review step and out-of-tree probes are never reusable: tracker probes, probe #69 and date epochs.
- Knobs live in an `optimizations:` section of `specs/settings.yaml` as a closed enum.
- Cite STE-196 and the skip baseline as the house shape. The repository is public: synthetic ids only.
- R5 (2026-11-04), pre-granted for this milestone: re-base the AC-STE-618.8 KICKOFF once at this milestone's gate-check edit commit, listing the new permitted lines. The re-base lands as its own reviewed commit with the freeze test green. All three FRs therefore put their gate-check lines in that one edit commit.
- R6 (2026-11-04): the front door runs only when the knob is on. With `gate_commands` off, `/gate-check` is byte-identical to today: no front door, no gate-step receipts. With it off, the `/simplify` STE-196 skip keeps its current behaviour.

**Decisions.** The section key is `optimizations` and the one knob is `gate_commands`. Version one reuses within one session only, behind that single knob. The knob is read through the knob verb of the optimizations module, so an off gate never calls the front door. Tracker ids are lowercased inside file paths when placeholders are filled.

**Migration:** none. The section is optional and absent means run; no consumer artifact moves.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-723 | The settings file names a closed set of reuse knobs and a probe refuses any other | linear:`STE-723` |
| STE-724 | The gate reuses a deterministic command's pass only when it recomputes the same key itself | linear:`STE-724` |
| STE-725 | The skills that demand a fresh gate say when a proven reuse counts as fresh | linear:`STE-725` |

### Tasks

- [ ] Add `optimizations_config.ts` with the knob and value enums, the refused-name list, `readOptimizations`, `validateOptimizations` and the `knob` verb, read through the M_94e6f7 settings loader (AC-STE-723.1, .2, .3, .5, .6)
  verify: reader and verb return run for absent, empty and invalid sections; one violation per offending key; source grep zero hits beside its control
- [ ] Admit `optimizations` to the loader's top-level set as a pass-through section; document it in settings-reference; add its `new` mapping row (AC-STE-723.8)
  verify: loader accepts a refused knob without throwing; settings-reference names `gate_commands`, `reuse` and `run`
- [ ] Add the probe module entry `runOptimizationsReuseOnlyProbe` and its fixtures (AC-STE-723.4)
  verify: positive fixture plus one negative per reason; vacuous on an unmanaged tree and on no section
- [ ] Add `computeReuseKey` to `gate_reuse.ts`, composing the M_7bc805 `gateReuseKey` with a per-command hash (AC-STE-724.1, .2, .3)
  verify: keys exactly `gate` and `command_sha256`; null on modified, staged, untracked, non-git and unborn HEAD; `gate` deep-equals the M_7bc805 run-receipt key
- [ ] Add the `run` verb: knob check first, then live key, announced same-session `gate-step` pass lookup, and a reuse line or a real run plus one receipt (AC-STE-724.4, .5, .6, .8, .9, .10, .14, .15, .16)
  verify: paired trip and no-trip fixtures, one per key part and one per refusal; knob off writes nothing; unset session id writes nothing
- [ ] Prove the hooks read nothing new (AC-STE-724.11, .12)
  verify: `gateReceiptEvidence` misses on step-only sessions; `pre-commit-gate-check` wrapper exits 2; hook source grep zero hits beside its control
- [ ] Add the `verdict` verb; add the `/simplify` knob branch after the kept gate-stamp sentence; amend AC-STE-196.2 before its anchor (AC-STE-725.1, .2, .3, .7)
  verify: clean and rerun fixtures with the knob on and off; no receipt written; trunk simplify prose test green unchanged
- [ ] Add the reuse clause to `/implement` step i and `docs/implement-reference.md`; add the patterns.md entry and the hooks-reference sentence (AC-STE-725.4, .6)
  verify: needles per surface; "Never claim clean from memory" kept
- [ ] Land every M4 gate-check SKILL.md edit in one commit: the probe line, the `## Commands` knob paragraph, the `(reused)` Reporting row, the two Rules lines and the Reporting fresh-run sentence; move every probe-count pin by one in it (AC-STE-723.7, AC-STE-724.7, .13, AC-STE-725.5)
  verify: probe #81 grades the line reachable; trunk Commands lines and Code Review byte-identical; Red Flags and Rationalization blocks byte-identical; NFR-1 cap held; every file `grep -rl "probe count" tests/` lists is green
- [ ] Under ruling R5, re-base KICKOFF to that edit commit as its own reviewed commit, listing every new permitted line (AC-STE-723.9, AC-STE-724.17, AC-STE-725.8)
  verify: freeze test green on the re-base commit; neighbour-line negative controls still fail `driftBeyond`
- [ ] Mutation controls for each rule (AC-STE-723.10, AC-STE-724.18, AC-STE-725.9)
  verify: removing the knob, tree-clean, announcement, run-outcome, never-reusable and verdict checks each reds a named test
- [ ] Run the full suite on the last commit (AC-STE-723.11, AC-STE-724.19, AC-STE-725.10)
  verify: `bun test` 0 fail; skip identities equal the trunk baseline by name

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean, including the new probe on this repo's own settings file
