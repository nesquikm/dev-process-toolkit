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

**Goal:** Let a gate shorten a real run by reusing a deterministic command's pass on identical input. With the knob off, its default, the gate runs exactly as in v3.0.0, the M_94e6f7 merge commit, and makes no extra tool call. With it on, the gate still runs, still writes its receipt and still runs its review. It skips a command only when it recomputes the full key itself and finds a pass this session announced. One settings section holds a closed set of knobs, and a probe refuses anything else. The skills that demand a fresh gate say when a proven reuse counts as fresh.

**Prerequisites:** M_94e6f7 merged (the `specs/settings.yaml` file and its loader). M_7bc805 merged: with tracking.gate_outcomes on, gate receipts carry a pass or fail outcome and a reuse key. M4 reuses that key function, never a second one. Dependency rule: gate_commands: reuse takes effect only when tracking.gate_outcomes is on, and nothing turns that key on implicitly; otherwise the knob reads run and the new probe reports requires-gate-outcomes. M_d1b4b7 merged. STE-723 edits one of its modules: it adds the reuse row to the STE-728 `PROPOSABLE_SETTINGS` table in `retro_proposal.ts` and widens that table's row-shape check by one case. No other M_fd9a03 FR reads M_d1b4b7 output.

**Release target:** v3.3.0, a minor after v3.2.0: two Added FRs and one Changed FR. Verify against CHANGELOG.md before shipping.

**Rebase onto v3.0.0.** These specs were rebased onto 6c62b32c and reconciled with what v3.0.0 shipped. The `optimizations` section is a closed set in the loader (`TOP_KEYS`, `settingsKeyOrder("optimizations")` = `OPTIMIZATION_KNOBS`, `NEW_KEYS`), not the drafted pass-through: v3.0.0 validates per section, so a bad knob name refuses only `optimizations` reads (which read `run`) and whole-file readers, as any unknown key does today. The knob's value stays the probe's to grade. The vacuous probe count is an accepted named difference (operator ruling relayed with the rebase). No FR writes a CLAUDE.md settings section.

**Operator rulings.**

- 2026-11-04: shorten real runs only. No knob may lower generated-code quality or disable a deterministic gate.
- Reuse is never hook evidence, and STE-641 stands.
- The LLM review step and out-of-tree probes are never reusable: tracker probes, probe #69 and date epochs.
- Knobs live in an `optimizations:` section of `specs/settings.yaml` as a closed enum.
- Cite STE-196 and the skip baseline as the house shape. The repository is public: synthetic ids only.
- R5 (2026-11-04), pre-granted for this milestone: re-base the AC-STE-618.8 KICKOFF once at this milestone's gate-check edit commit, listing the new permitted lines. The re-base lands as its own reviewed commit with the freeze test green. All three FRs therefore put their gate-check lines in that one edit commit.
- Defaults unchanged (operator rule, 2026-11-04): no behaviour change by default; every optimization is a settings change the user approves after /retro. The reuse knob is off unless set, and STE-723 adds its row to the STE-728 proposal table, applied only on explicit approval.
- R6 (2026-11-04): the front door runs only when the knob is on. With `gate_commands` off, `/gate-check` is byte-identical to today: no front door, no gate-step receipts. With it off, the `/simplify` STE-196 skip keeps its current behaviour.
- Supervisor ruling 2026-11-04, for operator review: an off knob costs no tool call. The `gate-check` receipt call prints `reuse: on` when the knob is effective, and both skills key on that line. So an off gate also makes no knob read. "Today" in R6 means v3.0.0, the defaults baseline, never v2.101.4. One output moves by default: the conformance-probes summary counts the new vacuous probe, an accepted named difference (operator ruling relayed with the rebase).

**Decisions.** The section key is `optimizations` and the one knob is `gate_commands`. Version one reuses within one session only, behind that single knob. The knob is read inside the receipt call, which prints `reuse: on`, so an off gate never calls the front door or the knob verb. The knob verb stays for hand runs and tests. Tracker ids are lowercased inside file paths when placeholders are filled.

**Migration:** none. The section is optional and absent means run; no consumer artifact moves.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-723 | The settings file names a closed set of reuse knobs and a probe refuses any other | linear:`STE-723` |
| STE-724 | The gate reuses a deterministic command's pass only when it recomputes the same key itself | linear:`STE-724` |
| STE-725 | The skills that demand a fresh gate say when a proven reuse counts as fresh | linear:`STE-725` |

### Tasks

- [ ] Add `optimizations_config.ts` with the knob and value enums, the refused-name list, `readOptimizations`, `validateOptimizations` and the `knob` verb, read through the M_94e6f7 settings loader (AC-STE-723.1, .2, .3, .5, .6, .12)
  verify: reader and verb return run for absent, empty and invalid sections, and for reuse with tracking.gate_outcomes off; one violation per offending key; source grep zero hits beside its control
- [ ] Admit `optimizations` to the loader as a closed section (`TOP_KEYS` last, `settingsKeyOrder`, `NEW_KEYS`, defaults), its value unchecked by the loader; add the never-throwing `settingsSectionValue` export; document it in settings-reference; add its `new` mapping row and the enum case of the off-when-absent row (AC-STE-723.8)
  verify: an unknown knob name refuses `optimizations` reads only, a bad value passes the loader, the planted-knob control still names only `orchestration.skip_gates`; settings-reference names `gate_commands`, `reuse` and `run`
- [ ] Add the probe module entry `runOptimizationsReuseOnlyProbe` and its fixtures (AC-STE-723.4)
  verify: positive fixture plus one negative per reason, requires-gate-outcomes included; shape and knob names decided from `settingsSectionValue`'s parsed value, so flow-style and `{}` sections pass, with lines from `settingsSectionKeys` or the section line; vacuous with zero notes on an unmanaged tree, a foreign settings file and no section
- [ ] Add the reuse row to the STE-728 proposal table (AC-STE-723.13)
  verify: propose prints the reuse line only with tracking.gate_outcomes on; the AC-STE-728.1 row pin moves from three to four with its Amended-by comment
- [ ] Add `computeReuseKey` to `gate_reuse.ts`, composing the M_7bc805 `gateReuseKey` with a per-command hash and passing its stub options through (AC-STE-724.1, .2, .3)
  verify: keys exactly `gate` and `command_sha256`; null on modified, staged, untracked, non-git and unborn HEAD; `gate` deep-equals the M_7bc805 run-receipt key
- [ ] Add the `reuse: on` line to the `gate-check` receipt call, behind the outcome switch and a dynamic import (AC-STE-724.20)
  verify: one, two or three lines by switch and knob; no module load with the outcome switch off; the AC-STE-715.13 literal carries its Amended-by comment
- [ ] Add the `run` verb and `announcesGateStep`: knob check first, then live key, announced same-session `gate-step` pass lookup with provenance, and a reuse line or a real run plus one receipt (AC-STE-724.4, .5, .6, .8, .9, .10, .14, .15, .16)
  verify: paired trip and no-trip fixtures, one per key part and one per refusal; each echo, chain and same-name forgery runs the command; knob off, or reuse with outcomes off, writes nothing; unset session id writes nothing
- [ ] Prove the hooks read nothing new (AC-STE-724.11, .12)
  verify: `gateReceiptEvidence` misses on step-only sessions; `pre-commit-gate-check` wrapper exits 2; hook source grep zero hits beside its control
- [ ] Add the `verdict` verb; add the `/simplify` branch, keyed on the consulted run's `reuse: on` line, after the kept gate-stamp sentence; amend AC-STE-196.2 before its anchor (AC-STE-725.1, .2, .3, .7)
  verify: clean and rerun fixtures with the knob on and off, forgery rows included; no receipt written; trunk simplify prose test green unchanged; no unconditional `gate_reuse.ts` mention
- [ ] Add the reuse clause to `/implement` step i and `docs/implement-reference.md`; add the patterns.md entry and the hooks-reference sentence (AC-STE-725.4, .6)
  verify: needles per surface; "Never claim clean from memory" kept
- [ ] Land every M4 gate-check SKILL.md edit in one commit: the probe line, the one `## Commands` line keyed on `reuse: on`, the `(reused)` Reporting row, the two Rules lines and the Reporting fresh-run sentence; move every probe-count pin by one in it (AC-STE-723.7, AC-STE-724.7, .13, AC-STE-725.5)
  verify: probe #81 grades the line reachable; trunk Commands lines and Code Review byte-identical; Red Flags and Rationalization blocks byte-identical; the file measures 358 split-lines and 87 STE tokens, and the eight exact pins of the line budget read 358 with their Amended-by comments; every file `grep -rl "probe count" tests/` lists is green
- [ ] Under ruling R5, re-base KICKOFF to that edit commit as its own reviewed commit, listing every new permitted line (AC-STE-723.9, AC-STE-724.17, AC-STE-725.8)
  verify: freeze test green on the re-base commit; neighbour-line negative controls still fail `driftBeyond`
- [ ] Add the milestone's defaults-unchanged test (AC-STE-725.11)
  verify: knob reads run, probe silent, verdict prints rerun, no gate-step receipt, receipt call and store equal v3.0.0; the probe summary differs only by its named vacuous count
- [ ] Mutation controls for each rule (AC-STE-723.10, AC-STE-724.18, AC-STE-725.9)
  verify: removing the knob, tree-clean, announcement, provenance, run-outcome, never-reusable and verdict checks each reds a named test
- [ ] Run the full suite on the last commit (AC-STE-723.11, AC-STE-724.19, AC-STE-725.10)
  verify: `bun test` 0 fail; skip identities equal the trunk baseline by name

### SKILL.md line budget

The cap is 358, never raised. Counts are `split("\n").length`, the unit `tests/skill-nfr-1-length.test.ts` measures (`wc -l` reads one fewer). Starting counts are the M_d1b4b7 end counts, which leave gate-check, implement and simplify at their v3.0.0 bytes (6c62b32c). Gate-check uses all of its headroom here, so every gate-check line below is fixed in advance and lands in the one edit commit.

| SKILL.md | Start | Lines this milestone adds or rewrites | Net | End |
|---|---|---|---|---|
| gate-check | 356 | Added: the optimizations_reuse_only probe line as row 90, directly after row 89 (line 176 at v3.0.0) and before the blank line ahead of `Full details:` (STE-723), +1. Added: the knob line directly after the `## Commands` Key Commands lookup line (line 252 at v3.0.0), with no blank line between, so it joins that paragraph and the five typical-command lines keep their bytes (STE-724), +1. In place: the Reporting row naming (reused) (STE-724); the fresh-run line and the skip-no-step line in Rules, and the Reporting fresh-run sentence (STE-725). | +2 | 358 |
| implement | 358 | Phase 3 step i at line 213 gains the reuse clause in place (STE-725); no line added, so none displaced. The clause carries no `STE-<n>` token, so the 41-token pin of `tests/ticket-ownership-shared.test.ts` and the exact-count pins the M_d1b4b7 plan names do not move. | 0 | 358 |
| simplify | 60 | Added: the knob branch after step 4 (STE-725), at most +2. No test pins its count exactly (scan of every test naming `simplify/SKILL.md` for 59 or 60). | ≤+2 | ≤62 |

No gate-check line beyond these two is added; one more line would need a displaced line, and none is planned. Every added or rewritten gate-check line carries no `STE-<n>` token, so its STE-token count stays 87 and `tests/ste-614-surfaces.test.ts` ("no `STE-<N>` token is added anywhere under skills/") stays green. Neither added line sits above line 176, so every row-position pin above it holds (row 25 on line 80, row 26 on line 81, row 49 on line 128, row 63 on line 150, row 73 on line 160).

The edit commit moves these exact pins from 356 to 358 split-lines, each with an `// Amended by AC-STE-724.13` comment; the 87 STE-token pins on the same rows do not move:

- `tests/orphan-listing-shared.test.ts:773-776` (356 split-lines, 87 STE tokens, row 49 on line 128)
- `tests/m_685ff6-ste-608-spec-write-prose.test.ts:163-165` (356 split-lines, 87 STE tokens)
- `tests/shared-declaration-setup.test.ts:871-875` (356 split-lines, 87 STE tokens, row 25 on line 80)
- `tests/gate-check-spec-research-result-shape.test.ts:425-428` (356 split-lines, 87 STE tokens)
- `tests/m_a85e46-ste-656-docs-drift.test.ts:478-481` (356 split-lines, 87 STE tokens)
- `tests/m_79b1f6-ste-588-sibling-coherence.test.ts:932-934` (356 split-lines, rows 26 and 63; its "89 rows" moves to 90 with the probe-count pins)
- `tests/m_8f07e0-ste-584-awaiting-siblings.test.ts:571-573` (356 split-lines)
- `tests/m_685ff6-ste-612-probe25-leg.test.ts:223-224` (356 split-lines)

Two more read the count against git, not a constant, and are re-checked green on the edit commit with no edit: `tests/m_685ff6-ste-609-prose.test.ts:192` (rows 1 to 89 keep main's positions; the count is held to main's only where no row is added) and the AC-STE-618.8 freeze, which the R5 re-base handles. These were found by running every test that reads `skills/gate-check/SKILL.md` against a scratch copy carrying the two added lines; the probe-count pins (`grep -rl "probe count" tests/`) and the freeze also redden there, as the Tasks already say.

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean, including the new probe on this repo's own settings file
- Defaults unchanged: with no settings file, and with a migrated file holding only the moved keys, skill, hook and probe outputs equal v3.0.0, the M_94e6f7 merge commit (tests/m_fd9a03-defaults-unchanged.test.ts); no extra tool call by default. One named difference, accepted by operator ruling: the conformance-probes summary counts one more vacuous probe (STE-723). A second, on a CLI no skill calls by default: `project_settings.ts get optimizations` exits 0 with its `gate_commands: run` default where v3.0.0 refused, and the `get` refusal's section list gains `optimizations` last (AC-STE-725.11)
