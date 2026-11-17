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

**Rounds are claims.** For `zero_yield_round`, the round record is the round's claim, not a measured diff: a `tdd-write-test`, `tdd-implement` or `tdd-refactor` round whose result parses as a `tdd-result` block records `tree_changed` from whether its `files:` list is empty, with `tree_disposition: "claimed"`, and every other round reads `tree_changed: null` with `tree_disposition: "not-observable"`. The reason is that forked rounds run in the background on the shared working tree, never commit, and are folded from the transcript at session end, so a measured per-round diff would need a tree snapshot at both edges of each fork, which nothing takes.

## Report

One file, `.dpt/ledger/retro/<scope-slug>-<UTC yyyymmddThhmmssZ>.json`, schema `dpt-retro/1`. Sessions appear only as `s<N>` aliases with a 16-hex digest; the report holds no absolute path, raw command, cwd or branch name. `suggested_severity` is `low` for one tripped rule and `medium` for two or more, never `high`.

## Settings proposal

`adapters/_shared/src/retro_proposal.ts` reads a saved report and proposes turning on a recording key a skipped rule named. `propose` prints `set`, `because` and optional `add .gitignore:` lines, then one `digest=` line. It writes nothing.

`apply` writes only on a verified approval in the session transcript: a real `propose` result carrying the digest, then an `AskUserQuestion` holding every printed line, answered `Apply the shown change`. It first writes one `retro-apply` receipt, which consumes the approval and is never rolled back, and prints `retro-apply: consumed digest=<digest>`. One approval admits one `apply`: it is consumed by that receipt, by any recorded `apply` call naming the digest, or by that printed line in any later tool result. It then checks preconditions, writes the keys, appends any printed `.gitignore` line, and registers the capture hook. A refused `register` restores the prior bytes. `retro.ts` never imports this module; the report schema is unchanged.

## Trend

`retro.ts <root> --trend [--last N]` routes to `retro_trend.ts` and writes one `.dpt/ledger/retro/trend-<stamp>.json` (schema `dpt-retro-trend/2`). A run is one (archived FR, skill): an archived FR with token-ledger rows claimed by its id makes one run for each skill on those rows; runs group by (skill, `changelog_category`, size bucket) and each group keeps its newest N runs. N defaults to `TREND_DEFAULT_LAST` (20) and must be a positive integer; anything else, `--last` with no value or given twice, any other argument, or a `retro.priority` the loader refuses, is refused in the NFR-10 shape and writes nothing.

Size is the added plus deleted lines of the commits whose footer carries `Refs: <FR id>`: S under 100, M 100 to 500, L over 500. A run's tokens and sessions come from its own skill's claimed rows only, and an FR with no `changelog_category` groups under `unknown`. When git cannot be read, no run can be sized and every group's size reads `unknown`.

**Settings.** Each run carries the `settings_hash` it started under, read from the run-start ledger (see Run-start ledger): the earliest row whose FR and skill match the run's, else the earliest row whose session is one of the run's sessions and whose skill matches, else `settings unknown`; a matching row with no `settings_hash` also reads `settings unknown`. Each group carries two keys for it: `runs_detail`, one entry per run in the window (FR id, skill, settings, session aliases), and `settings`, the window's runs counted per settings value, most runs first, ties by hash ascending.

**Metrics** (one cell each, columns in `retro.priority` order). Each shows the window median of the per-run values and `delta`, the newer half's median minus the older half's:

| id | per run | input |
|---|---|---|
| `waste` | reruns on an unchanged key plus rounds that changed no file (the `gate_rerun_unchanged_key` and `zero_yield_round` rules; not observable unless both are). A round counts as changing no file when its `tdd-result` claims an empty `files:` list (see the claim note under v1 rules) | `tracking.gate_outcomes` and `tracking.tool_calls` |
| `tokens` | claimed output tokens per changed line | `tracking.token_stats` |
| `time` | the run's median gate wall time | `tracking.gate_outcomes` and `tracking.tool_calls` |

**Signals** (pooled over the window, one value each): `gate_failure_rate` (failed over failed plus passed gate runs; `tracking.gate_outcomes` and `tracking.tool_calls`), `spec_review_gaps_per_fr` (`/spec-review` partial plus missing ACs per run; `tdd-audit` receipts are not counted; skipped when the window holds no spec-review receipt; `tracking.review_findings`), `code_review_concerns_per_100_lines` (`tracking.review_findings`; a receipt naming no FR, or any FR in the window, counts; skipped when the window holds no code-review receipt) and `post_merge_fixes` (commits whose subject is a Conventional Commits `fix` subject, whose subject or `Refs:` trailer names the run's id as a whole id or cites one of its ACs (`AC-<id>.<n>`), and that are dated after the run's `archived_at` and no more than 14 days after it; which files a commit changes does not matter; read from git. When fewer than half of the commit subjects in the group's fix windows are Conventional Commits subjects, the value is null with the note `skipped: not observable (history is not Conventional Commits)`).

**Notes, never zero.** A cell whose tracking key is off reads `skipped: not observable (tracking.<key> is off)`, or `(tracking.<a> and tracking.<b> are off)` when it needs several keys that are off; a cell whose input is simply absent reads `skipped: not observable`. A group with fewer than `TREND_MIN_RUNS` (5) runs in its window reads `insufficient: <n> runs` in every cell.

**Order.** Groups sort worst first by the `delta` of the first-ranked metric; a group with no number there sorts after one with a number, and when that `delta` is null for both groups compared, the next ranked metric decides, and so on.

**Sharing.** A session claimed by several FRs belongs to each of their runs, but the pooled signals count its gate runs and receipts once per window, so a shared session is never counted twice. The per-run metrics still read the session for each run that claims it.

The trend report writes no receipt, settings or proposal, and `retro_proposal.ts` refuses it (its schema is not `dpt-retro/1`).

## Run-start ledger

`adapters/_shared/src/run_start.ts` appends one row per skill start to `.dpt/ledger/run-starts.jsonl`, schema `dpt-run-start/1`, in one append write. The `run-start-snapshot` hook calls it when a skill starts. A row holds exactly these keys: `schema`, `session_id`, `skill` (the full `dev-process-toolkit:<name>` string the token ledger keys on), `fr` (or null), `started_at` (ISO-8601), `settings_hash`, `settings`, `plugin_version` and `registration`. `settings_hash` is the sha256 of the canonical JSON of `settings`, `plugin_version` and `registration`.

**Gate.** A row is written only when at least one `tracking.<name>.enabled` in `specs/settings.yaml` is `true`. With every tracking switch off, nothing is written and the helper prints `skipped: no tracking switch is on`. A legacy tree whose settings still live in CLAUDE.md records nothing until `/dev-process-toolkit:upgrade` moves them, and a hook payload with no session id writes nothing.

**Privacy.** `settings` holds every `PROPOSABLE_SETTINGS` key, each mapped to its raw value in the settings file or to `"absent"` when unset, and no other settings key. The row never copies the rest of the settings file.

## Run claims

**Attribution.** The `session-token-ledger` hook attributes each usage-bearing transcript line to the latest run-start row of the same session and the same skill whose `started_at` is at or before the line's `timestamp`, and the line's FR is that row's `fr`. When that `fr` is `null`, the line inherits the `fr` of the latest run-start row of the session, of any skill, with a non-null `fr` and a `started_at` between that row's start and the line. `(main-loop)` lines, and lines with no such row, are unattributed. Attributed lines are written as one row per (skill, model, FR) with `claimed_by: <FR>` and `claim_source: "run"`; unattributed lines keep one row per (skill, model). The token sums per (skill, model) are unchanged by the split.

**Settled claims.** A row whose `claim_source` is `"run"` is settled: `filterRowsForFR` selects it for its own FR, never demotes it to the design bucket (`design/exploration`), and never selects or re-claims it for any other FR, even when its session is in that FR's lineage. The STE-698 carry rule applies to unattributed rows only.
