---
name: retro
description: Grade a finished run against the toolkit's retro rules — slow gate runs, gate reruns on an unchanged key, zero-yield TDD rounds, cost per changed line — and write one report under `.dpt/ledger/retro/`. Never changes a gate, threshold, receipt, ledger row, tracked file or tracker. One exception: a settings change applied on explicit approval, plus the one retro-apply receipt consuming it.
argument-hint: '[<milestone> | <fr-id>]'
---

# Retro

Grade the run named by `$ARGUMENTS` against the v1 retro rules and print what tripped. The skill is thin: it runs the front door, prints the rule table, offers any settings proposal, and closes with the status block. Rule definitions, thresholds, data sources and the report schema live in `docs/retro-reference.md`.

## Process

### 1. Run the front door

Invoking `/retro` by hand always runs, whatever `retro.enabled` says in `specs/settings.yaml` — that key decides only whether the close-out offer runs. Run:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro.ts <projectRoot> [scope]
```

- No argument: the current session.
- An FR id or a milestone: the sessions whose token-ledger rows are claimed by that FR, or by any FR of that milestone.
- Free text is refused; relay the refusal from stderr verbatim and stop.

On success it prints one JSON line `{ report, tripped_count, suggested_severity }` and writes exactly one file, `.dpt/ledger/retro/<scope-slug>-<stamp>.json`. That file is the only write this step makes.

### 2. Print the rule table

Read the report file named by `report` and print one row per rule:

| rule | disposition | value | threshold | reason |
|---|---|---|---|---|

A rule whose input is missing reads `skipped: input not observable` with the reason the report gives — print it as such, never as `clear`. Sessions appear only by their `s<N>` aliases. Label the `cost_per_changed_line` numerator `parent-visible tokens`.

### 3. Offer the settings proposal

After the rule table, run, with the report file the front door named:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro_proposal.ts propose <projectRoot> <report-file>
```

It writes nothing. When it prints nothing, skip to Closing.

When it prints, ask your own `AskUserQuestion`. The question text repeats every line `propose` printed, each on its own line. That is every `set ...`, `because ...` and `add .gitignore: ...` line, then the `digest=` line. `apply` refuses a question that leaves one out.

The two options are `Apply the shown change` and `Leave settings unchanged`. `Leave settings unchanged` is the default.

The question follows the `requires_explicit_approval` rail of `docs/upgrade-reference.md`. The auto-approve marker never answers it and never applies the change.

A driven run, or a run without an interactive operator, prints `settings proposal not applied — run /dev-process-toolkit:retro to review it`. That run never calls `apply`.

Only an explicit approval calls `apply`, with the printed digest:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro_proposal.ts apply <projectRoot> <report-file> <digest>
```

Relay any refusal from stderr verbatim. A refused apply consumes the approval: fix the cause, then re-run propose and ask again. The approval check and write order live in `docs/retro-reference.md`.

## Rules

- Never change a gate, a threshold, a receipt, a ledger row, a tracked file or a tracker. The one exception: the change `apply` makes on explicit approval (the settings keys, any printed `.gitignore` line, the capture-hook registration in `.claude/settings.local.json`), plus its one consuming `retro-apply` receipt.
- Never refuse on `retro.enabled`.
- Never compose a rule's value in prose; every value comes from the report file.

## Closing

`/retro` closes with **exactly one** `stage-status-block` fence as the LAST thing in its report, with at most 12 lines of prose lead-in above it. Fixed section order, the `- (none found)` fallback and the caps live in `docs/stage-status-block.md`; adoption is graded by `adapters/_shared/src/stage_block_adoption.ts`. The block carries **one** `tripped: <tripped_count>` `summary:` row and **one** `severity: <suggested_severity>` `summary:` row; the per-rule verdicts stay in the report file. Skip this block when the invocation body carries the driven-run marker: the orchestrator drives the next step in the same turn.

```stage-status-block
stage: retro   # then milestone, status, summary, gate, drive, e2e, follow_ups in fixed order — docs/stage-status-block.md
```
