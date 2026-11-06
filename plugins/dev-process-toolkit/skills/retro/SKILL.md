---
name: retro
description: Grade a finished run against the toolkit's retro rules — slow gate runs, gate reruns on an unchanged key, zero-yield TDD rounds, cost per changed line — and write one report under `.dpt/ledger/retro/`. Read-only: never changes a gate, threshold, receipt, ledger row, tracked file or tracker.
argument-hint: '[<milestone> | <fr-id>]'
---

# Retro

Grade the run named by `$ARGUMENTS` against the v1 retro rules and print what tripped. The skill is thin: it runs the front door, prints the rule table, and closes with the status block. Rule definitions, thresholds, data sources and the report schema live in `docs/retro-reference.md`.

## Process

### 1. Run the front door

Invoking `/retro` by hand always runs, whatever `retro.enabled` says in `specs/settings.yaml` — that key decides only whether the close-out offer runs. Run:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro.ts <projectRoot> [scope]
```

- No argument: the current session.
- An FR id or a milestone: the sessions whose token-ledger rows are claimed by that FR, or by any FR of that milestone.
- Free text is refused; relay the refusal from stderr verbatim and stop.

On success it prints one JSON line `{ report, tripped_count, suggested_severity }` and writes exactly one file, `.dpt/ledger/retro/<scope-slug>-<stamp>.json`. That file is the only write this skill makes.

### 2. Print the rule table

Read the report file named by `report` and print one row per rule:

| rule | disposition | value | threshold | reason |
|---|---|---|---|---|

A rule whose input is missing reads `skipped: input not observable` with the reason the report gives — print it as such, never as `clear`. Sessions appear only by their `s<N>` aliases. Label the `cost_per_changed_line` numerator `parent-visible tokens`.

## Rules

- Never change a gate, a threshold, a receipt, a ledger row, a tracked file or a tracker.
- Never refuse on `retro.enabled`.
- Never compose a rule's value in prose; every value comes from the report file.

## Closing

`/retro` closes with **exactly one** `stage-status-block` fence as the LAST thing in its report, with at most 12 lines of prose lead-in above it. Fixed section order, the `- (none found)` fallback and the caps live in `docs/stage-status-block.md`; adoption is graded by `adapters/_shared/src/stage_block_adoption.ts`. The block carries **one** `tripped: <tripped_count>` `summary:` row and **one** `severity: <suggested_severity>` `summary:` row; the per-rule verdicts stay in the report file. Skip this block when the invocation body carries the driven-run marker: the orchestrator drives the next step in the same turn.

```stage-status-block
stage: retro   # then milestone, status, summary, gate, drive, e2e, follow_ups in fixed order — docs/stage-status-block.md
```
