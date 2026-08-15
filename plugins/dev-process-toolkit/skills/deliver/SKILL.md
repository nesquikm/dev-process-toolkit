---
name: deliver
description: Full delivery pipeline orchestrator — takes a feature request from idea through specs to shipped, merged milestones by chaining the toolkit's phase skills end-to-end.
argument-hint: '[feature request or idea]'
---

# Deliver

Orchestrate the full delivery pipeline for: `$ARGUMENTS`

This skill is the single entry point that chains the toolkit's phase skills — design, spec-writing, and the per-milestone ceremony — into one supervised pipeline run.

> **FIRST ACTION (under non-interactive stdin).** When `process.stdin.isTTY === false` (e.g., `claude -p`), refuse immediately via `requireOrRefuse(...)` from `adapters/_shared/src/requires_input.ts`, surfacing the `RequiresInputRefusedError` message — which carries the `<dpt:requires-input-refused>v1</dpt:requires-input-refused>` marker the stream parser maps to a machine-recognizable refusal (the canonical refusal shape). A prose-only refusal reads as `vacuous` (a non-pass), indistinguishable from doing nothing. **There is no marker carve-out** — unlike `/spec-write`, the auto-approve marker never lets `/deliver` proceed headless. `/deliver` is interactive by design: its Socratic phases, worker approval gates, and merge-policy prompts all require a live operator, so under non-tty stdin the refusal is unconditional. Interactive (tty) sessions are unaffected.

Extended flow detail — phase-by-phase narrative, the expanded `deliver-stage-result` field reference, the halt taxonomy, and merge-policy routing tables — lives in `docs/deliver-reference.md` (extracted to keep this skill under the NFR-1 line cap). The sections below are sufficient to operate; consult the reference when debugging a halted run.

## Pre-flight — spawn-agent availability

Phase 3's workers ride on the `agent-toolkit:spawn-agent` skill. Before Phase 1 begins, probe that the skill is available **via the plugin registry (the installed-plugins listing)** — never by filesystem guesses about where a plugin might live on disk.

If `agent-toolkit:spawn-agent` is unavailable, HALT with the NFR-10 canonical shape, carrying these install instructions verbatim:

```
Refusing: the agent-toolkit:spawn-agent skill is unavailable — /deliver cannot spawn visible workers
Remedy: install the plugin, then re-run /deliver:
  claude plugin install agent-toolkit
Context: mode=deliver, phase=pre-flight, skill=deliver
```

**Never substitute the built-in Agent/Task tool** for the missing skill. A subagent is invisible — the operator cannot watch it, click into it, or take it over — and a **visible session** is this pipeline's contract. When the skill is missing, the halt above is the only correct behavior.

## Phases 1–2 — design and spec-writing, inline

Phases 1–2 run **inline in the invoking session**: invoke `/dev-process-toolkit:brainstorm` (Phase 1), and after its design is approved, `/dev-process-toolkit:spec-write` (Phase 2), directly in this session — not in a spawned worker, not in a fork.

Both phase skills are Socratic by contract: they ask the operator clarifying questions one at a time and wait for real answers. `/deliver` leaves those Socratic contracts untouched — it **never proxies** their questions (answering on the operator's behalf, paraphrasing, or pre-filling answers is forbidden) and never batches them into a single combined prompt. Each question reaches the operator exactly as the phase skill asks it, in order, one at a time.

## Phase 3 — per-milestone ceremony in spawned visible workers

Once Phase 2 has produced the milestone plan(s), run the ceremony **strictly serially**: spawn **one fresh visible worker per milestone**, wait for it to finish its whole chain, and only then spawn the next milestone's worker. Never run two milestone workers concurrently — parallel milestones collide on probe-count pins and the release files (the 2026-08-15 operator decision that fixed this topology).

For each milestone `M<N>`, in plan order:

1. **Spawn** one fresh, visible worker session via the `agent-toolkit:spawn-agent` skill. All spawn mechanics — surface/pane placement, session wiring, lifecycle — are that skill's contract; `/deliver` only hands it the kickoff task text and the milestone identity. Fresh means a brand-new session per milestone: never reuse the previous milestone's worker, and never run milestone work in this orchestrating session.
2. **Kickoff task text.** Read `readOrchestrationConfig().defaultEffort` (from `adapters/_shared/src/orchestration_config.ts`) and carry that effort keyword (e.g. `ultracode`) in the kickoff task text, so the worker session runs at the operator-configured effort level.
3. **The worker's chain**, run in-session, in order, inside that one worker:

   `/implement M<N>` → `/ship-milestone M<N>` → `/pr`

   The whole chain lives in the single worker session — the implement context is exactly what the ship and PR stages need. Do not split stages across workers.
4. **Wait** for the worker's chain to complete before touching the next milestone. Serial execution is the invariant, not an optimization.

## Worker approval gates — relay to the operator

Ceremony stages pause at real approval gates: the `/implement` commit approval, the `/ship-milestone` release approval, the `/pr` push/PR confirmation, and any tracker-write prompts. When a worker raises one of these gates, `/deliver` **relays it to the operator via AskUserQuestion** — quoting the worker's prompt faithfully — and then **forwards the operator's answer to the worker by keystroke** (typing the reply into the visible worker session). The operator is the only approver in this pipeline.

Two hard prohibitions:

- `/deliver` never injects the auto-approve marker (`<dpt:auto-approve>v1</dpt:auto-approve>`, the canonical line minted for headless `claude -p` heredoc fences and enforced by `adapters/_shared/src/auto_approve_marker.ts`) into worker prompts or kickoff task text. Workers run interactively and their gates must stay live.
- `/deliver` never fabricates an approval — no answering `y` on the operator's behalf, no pre-filling consent, no "the operator would obviously approve" shortcuts. If the operator declines or does not answer, the gate stays closed and the worker stays paused.

## Stage hand-offs — the `deliver-stage-result` fence

Each ceremony stage (`/implement`, `/ship-milestone`, `/pr`) ends its hand-off back to the orchestrator with **exactly one** fenced `deliver-stage-result` block as the last thing in the stage's report. The block has a **fixed section order** — the sections below, in this order, never reordered, never omitted — and a **line cap** of 20 lines total inside the fence. Any section with nothing to report keeps its heading and carries the literal fallback line `- (none found)` instead of being dropped.

```deliver-stage-result
stage: implement            # implement | ship-milestone | pr
milestone: M<N>
status: ok                  # ok | failed
summary:
  - one line per FR shipped / version bumped / PR opened
gate:
  - final gate numbers, pass AND skip counts
follow_ups:
  - (none found)
```

**Required sections, in fixed section order:** `stage`, `milestone`, `status`, `summary`, `gate`, `follow_ups`. `status: ok` means the stage completed cleanly; `status: failed` means it could not — the orchestrator halts the milestone and reports to the operator rather than improvising a recovery.

### Shape violations — bounded retry, then halt

A stage report that violates the contract — no fence, multiple fences, sections missing or out of order, or the line cap blown — gets **one scoped retry**: re-prompt the same worker with only the fence contract restated ("re-emit your stage result as a single `deliver-stage-result` fence"), never a re-run of the stage's actual work. A second violation from the same stage is a **deterministic halt naming the stage** (e.g. `Halting: stage /ship-milestone for M<N> violated the deliver-stage-result contract twice`) — the same bounded-retry budget the `/tdd` orchestrator applies to its `tdd-result` fences. Never paper over a malformed hand-off by guessing what the stage meant.

## Post-PR — merge-policy routing

After a milestone's worker reports its `/pr` stage `ok` (an open PR exists), route on `readOrchestrationConfig().mergePolicy` (the same `orchestration_config` module the kickoff step reads; config key `merge_policy`). Exactly three policies, exactly three behaviors:

- **`offer`** (the default) — ask the operator, via AskUserQuestion, whether to merge the open PR now, leave it for later, or stop the pipeline. The operator's answer decides; `/deliver` never assumes.
- **`auto`** — merge the PR **only after** it is **mergeable** and its **checks pass** (green CI, no conflicts, no blocked reviews). Never merge early, never bypass a red check. After the merge, **re-run the project gate on merged main** — and only when that gate is green does the next milestone's worker get spawned. A red gate on merged main halts the pipeline with a report to the operator.
- **`never`** — **stop at the open PR**. `/deliver` reports the PR URL and moves on to the next milestone (or ends the run) without merging; merging is entirely the operator's affair.

`auto` is **strictly opt-in**: the shipped default is `offer`, and no inference path may enable `auto` — not repo history, not CI shape, not "the operator merged the last three by hand". The only way `auto` turns on is the operator writing `merge_policy: auto` into the orchestration config themselves, an operator decision recorded in the FR Notes.
