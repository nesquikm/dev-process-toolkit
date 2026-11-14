# Retro Reference

Overflow for `skills/retro/SKILL.md`. The front door is `adapters/_shared/src/retro.ts`; the rules are `adapters/_shared/src/retro_rules.ts`; the report schema is `adapters/_shared/src/retro_report.ts`.

## Switch

`retro.enabled` in `specs/settings.yaml` (boolean, default false) decides only whether the close-out offer runs. Invoking `/retro` by hand always runs and writes its one report either way.

## Dispositions

Every rule maps to exactly one of `tripped`, `clear`, or `skipped: input not observable` with a reason naming the missing input. A rule never reports `clear` from absent data. A scope that resolves to no session skips every rule with reason `scope resolves to no session`.

## v1 rules

| id | source | trips when |
|---|---|---|
| `slow_gate_run` | timeline | one gate run's `wall_ms` exceeds its subject's bound (gate-check 900000 ms, spec-review 1200000 ms, tdd 3600000 ms) |
| `gate_rerun_unchanged_key` | timeline | at least 1 passing rerun on an unchanged, stable key |
| `zero_yield_round` | timeline | at least 2 implement or refactor rounds that changed no file |
| `cost_per_changed_line` | token_ledger, capture_ledger | parent-visible output tokens per changed line exceed 500 |

Thresholds are constants in code, never settings knobs.

## Report

One file, `.dpt/ledger/retro/<scope-slug>-<UTC yyyymmddThhmmssZ>.json`, schema `dpt-retro/1`. Sessions appear only as `s<N>` aliases with a 16-hex digest; the report holds no absolute path, raw command, cwd or branch name. `suggested_severity` is `low` for one tripped rule and `medium` for two or more, never `high`.

## Settings proposal

`adapters/_shared/src/retro_proposal.ts` reads a saved report and proposes turning on a recording key a skipped rule named. `propose` prints `set`, `because` and optional `add .gitignore:` lines, then one `digest=` line. It writes nothing.

`apply` writes only on a verified approval in the session transcript: a real `propose` result carrying the digest, then an `AskUserQuestion` holding every printed line, answered `Apply the shown change`. It first writes one `retro-apply` receipt, which consumes the approval and is never rolled back, and prints `retro-apply: consumed digest=<digest>`. One approval admits one `apply`: it is consumed by that receipt, by any recorded `apply` call naming the digest, or by that printed line in any later tool result. It then checks preconditions, writes the keys, appends any printed `.gitignore` line, and registers the capture hook. A refused `register` restores the prior bytes. `retro.ts` never imports this module; the report schema is unchanged.

## Trend

`retro.ts <root> --trend [--last N]` routes to `retro_trend.ts` and writes one `.dpt/ledger/retro/trend-<stamp>.json` (schema `dpt-retro-trend/1`). A run is one archived FR with token-ledger rows claimed by its id; runs group by (skill, `changelog_category`, size bucket) and each group keeps its newest N runs. N defaults to `TREND_DEFAULT_LAST` (20) and must be a positive integer; anything else, `--last` with no value or given twice, any other argument, or a `retro.priority` the loader refuses, is refused in the NFR-10 shape and writes nothing.

Size is the added plus deleted lines of the commits whose footer carries `Refs: <FR id>`: S under 100, M 100 to 500, L over 500. A run's skill is the skill on its first claimed ledger row, and an FR with no `changelog_category` groups under `unknown`. When git cannot be read, no run can be sized and every group's size reads `unknown`.

**Metrics** (one cell each, columns in `retro.priority` order). Each shows the window median of the per-run values and `delta`, the newer half's median minus the older half's:

| id | per run | input |
|---|---|---|
| `waste` | reruns on an unchanged key plus rounds that changed no file (the `gate_rerun_unchanged_key` and `zero_yield_round` rules; not observable unless both are). Waste reads skipped until TDD rounds record whether they changed a file | `tracking.tool_calls` |
| `tokens` | claimed output tokens per changed line | `tracking.token_stats` |
| `time` | the run's median gate wall time | `tracking.gate_outcomes` and `tracking.tool_calls` |

**Signals** (pooled over the window, one value each): `gate_failure_rate` (failed over failed plus passed gate runs; `tracking.gate_outcomes` and `tracking.tool_calls`), `spec_review_gaps_per_fr` (`/spec-review` partial plus missing ACs per run; `tdd-audit` receipts are not counted; skipped when the window holds no spec-review receipt; `tracking.review_findings`), `code_review_concerns_per_100_lines` (`tracking.review_findings`; a receipt naming no FR, or any FR in the window, counts; skipped when the window holds no code-review receipt) and `post_merge_fixes` (`fix` commits within 14 days of the FR's last `Refs:` commit that touch a file it changed, old or new name after a rename, and do not name its id or cite one of its ACs; read from git).

**Notes, never zero.** A cell whose tracking key is off reads `skipped: not observable (tracking.<key> is off)`, or `(tracking.<a> and tracking.<b> are off)` when it needs several keys that are off; a cell whose input is simply absent reads `skipped: not observable`. A group with fewer than `TREND_MIN_RUNS` (5) runs in its window reads `insufficient: <n> runs` in every cell.

**Order.** Groups sort worst first by the `delta` of the first-ranked metric; a group with no number there sorts after one with a number, and when that `delta` is null for both groups compared, the next ranked metric decides, and so on.

**Sharing.** A session claimed by several FRs belongs to each of their runs, but the pooled signals count its gate runs and receipts once per window, so a shared session is never counted twice. The per-run metrics still read the session for each run that claims it.

The trend report writes no receipt, settings or proposal, and `retro_proposal.ts` refuses it (its schema is not `dpt-retro/1`).
