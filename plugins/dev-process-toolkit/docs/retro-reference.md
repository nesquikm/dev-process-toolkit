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
