# `/deliver` Reference

Extended reference material for `/dev-process-toolkit:deliver` that was extracted from `skills/deliver/SKILL.md` to keep the skill file under the NFR-1 351-line cap. The skill file contains a one-line pointer to this file.

This reference is **not required reading** on every run — the skill itself has enough guidance to operate. Consult this file when a stage hand-off misbehaves, when a merge-policy edge case comes up, or when debugging a halted pipeline run.

## Pipeline shape at a glance

| Phase | What runs | Where it runs | Operator involvement |
|-------|-----------|---------------|----------------------|
| Pre-flight | `agent-toolkit:spawn-agent` availability probe | Invoking session | None (halt only if missing) |
| Phase 1 | `/dev-process-toolkit:brainstorm` | Inline, invoking session | Socratic Q&A, design approval |
| Phase 2 | `/dev-process-toolkit:spec-write` | Inline, invoking session | Socratic Q&A, spec approval |
| Phase 3 | `/implement M<N>` → `/ship-milestone M<N>` → `/pr`, per milestone | One fresh spawned visible worker per milestone, strictly serial | Every approval gate relayed via AskUserQuestion |
| Post-PR | Merge-policy routing per milestone | Invoking session | Depends on `merge_policy` |

## Pre-flight — spawn-agent probe detail

Phase 3 rides entirely on the `agent-toolkit:spawn-agent` skill; without it there is no visible-worker topology and the pipeline cannot honor its supervision contract. The probe:

1. Check the plugin registry (the installed-plugins listing) for `agent-toolkit:spawn-agent`. Never probe by filesystem path — plugin install locations are the harness's business, and a path guess that happens to hit stale files would green-light a spawn that fails at runtime.
2. Present ⇒ proceed to Phase 1.
3. Absent ⇒ HALT with the NFR-10 canonical shape (Refusing / Remedy / Context), carrying the verbatim install instructions from the skill. Do not fall back to the built-in Agent/Task tool: a subagent is invisible — the operator cannot watch it, click into it, or take it over — and visibility is the entire reason the topology exists.

The probe runs **before Phase 1**, not before Phase 3. Discovering the missing skill after two Socratic phases of operator time is the failure mode this ordering exists to prevent.

## Phases 1–2 — inline Socratic phases

Both phases run **inline in the invoking session**. Rationale:

- The Socratic contract is a live back-and-forth between the phase skill and the operator. Running it in a spawned worker inserts a relay hop into every question; running it in a fork severs the operator entirely.
- `/deliver` never proxies, paraphrases, pre-fills, or batches the phase skills' questions. Each question reaches the operator exactly as asked, one at a time, in order. A "helpful" combined questionnaire is a contract violation, not an optimization.
- Phase 2 does not begin until Phase 1's design is approved. Phase 3 does not begin until Phase 2 has produced the milestone plan(s).

## Phase 3 — spawn delegation and worker topology

### What `/deliver` owns vs. what spawn-agent owns

All spawn mechanics belong to the `agent-toolkit:spawn-agent` skill: surface/pane placement, session wiring, lifecycle, teardown. `/deliver` hands it exactly two things — the kickoff task text and the milestone identity — and consumes exactly one thing back: a visible worker session it can watch and relay gates from. `/deliver` authors **no** `claude -p` heredoc spawn fences of its own; spawn mechanics are prose-delegated, never inlined. (This is also why the auto-approve marker never appears in `/deliver`'s body: there is no headless fence for it to mark.)

### Serial one-worker-per-milestone invariant

- **One fresh worker per milestone.** Fresh means a brand-new session: never reuse the previous milestone's worker (its context carries the previous milestone's release state), and never run milestone work in the orchestrating session (it must stay free to relay gates).
- **Strictly serial.** Wait for a worker's full chain to complete before spawning the next. Parallel milestone workers collide on probe-count pins and the release files — both are single-writer surfaces. This is the 2026-08-15 operator decision that fixed the topology; treat it as an invariant, not a tunable.
- **The whole chain lives in one worker.** `/implement M<N>` → `/ship-milestone M<N>` → `/pr`, in-session, in order. The implement context is exactly what the ship and PR stages need; splitting stages across workers throws that context away and forces each stage to re-derive it.

### Kickoff task text

Read `readOrchestrationConfig().defaultEffort` from `adapters/_shared/src/orchestration_config.ts` (STE-463) and carry the effort keyword (e.g. `ultracode`) in the kickoff task text so the worker runs at the operator-configured effort level. The kickoff text also names the milestone (`M<N>`), the chain, and the `deliver-stage-result` hand-off contract — and never carries the auto-approve marker.

## Approval-gate relay protocol

Ceremony stages pause at real gates: the `/implement` commit approval, the `/ship-milestone` release approval, the `/pr` push/PR confirmation, tracker-write prompts. The relay loop:

1. Worker raises a gate (visible in its session as a pending question or prompt).
2. `/deliver` surfaces it to the operator via **AskUserQuestion**, quoting the worker's prompt faithfully — no summarizing away the diff stats, version numbers, or file lists the worker included.
3. The operator answers.
4. `/deliver` forwards the answer to the worker **by keystroke** — typing the reply into the visible worker session.

The operator is the only approver. Two hard prohibitions, restated because both have historical incident shapes:

- **No auto-approve injection.** The `<dpt:auto-approve>v1</dpt:auto-approve>` marker exists for headless `claude -p` heredoc fences; `/deliver`'s workers are interactive and their gates must stay live.
- **No fabricated approvals.** No answering `y` on the operator's behalf, no pre-filled consent, no inferring approval from silence. A declined or unanswered gate stays closed and the worker stays paused.

## The `deliver-stage-result` contract, expanded

Each ceremony stage ends its report with **exactly one** fenced `deliver-stage-result` block, last thing in the report.

### Field reference

| Section | Position | Content | Empty-case |
|---------|----------|---------|-----------|
| `stage` | 1 | `implement` \| `ship-milestone` \| `pr` | never empty |
| `milestone` | 2 | `M<N>` | never empty |
| `status` | 3 | `ok` \| `failed` | never empty |
| `summary` | 4 | one line per FR shipped / version bumped / PR opened | `- (none found)` |
| `gate` | 5 | final gate numbers — pass **and** skip counts, both | `- (none found)` |
| `follow_ups` | 6 | deferred items, advisories, opened issues | `- (none found)` |

Rules:

- **Fixed section order** — the six sections above, in that order, never reordered, never omitted. An empty section keeps its heading and carries the literal `- (none found)` fallback line; dropping the heading is a shape violation.
- **Line cap: 20 lines** inside the fence. The fence is a hand-off summary, not a transcript — detail lives in the worker's visible session, which the operator can always open.
- `status: failed` means the stage could not complete. The orchestrator halts the milestone and reports; it never improvises a recovery on the worker's behalf.

### Why both gate numbers

`gate` reports pass **and** skip counts because a silent skip is worse than a loud failure — a gate line that only says "N passing" cannot distinguish a healthy run from one where half the suite quietly skipped.

## Halt taxonomy

Every halt path is deterministic and names its cause. The full set:

| Halt | Trigger | Message shape | Recoverable? |
|------|---------|---------------|--------------|
| Pre-flight halt | `agent-toolkit:spawn-agent` unavailable | NFR-10 Refusing / Remedy / Context with verbatim install instructions | Yes — install the plugin, re-run `/deliver` |
| Headless refusal | `process.stdin.isTTY === false` | `requireOrRefuse(...)` marker refusal (AC-STE-404.5 shape); no carve-out | Yes — re-run in an interactive session |
| Contract halt | Second `deliver-stage-result` shape violation from the same stage | `Halting: stage /<stage> for M<N> violated the deliver-stage-result contract twice` | Operator inspects the worker session |
| Stage failure | A stage reports `status: failed` | Halt the milestone, surface the stage's own report | Operator decides — fix and re-run, or abandon |
| Post-merge gate red | `merge_policy: auto` merged, then the gate on merged main is red | Halt before spawning the next milestone's worker; report the red gate | Operator fixes main before the pipeline continues |

The bounded-retry budget for shape violations is **one scoped retry** — re-prompt the same worker with only the fence contract restated ("re-emit your stage result as a single `deliver-stage-result` fence"), never a re-run of the stage's actual work. This mirrors the `/tdd` orchestrator's `tdd-result` budget (STE-225/STE-296): retries repair *reporting*, never *work*, and a second violation is a halt, not a third prompt.

## Merge-policy routing detail

After a milestone's `/pr` stage reports `ok`, route on `readOrchestrationConfig().mergePolicy` (config key `merge_policy`, same STE-463 module).

| Policy | Behavior | Next milestone spawns when |
|--------|----------|---------------------------|
| `offer` (default) | AskUserQuestion: merge now / leave for later / stop the pipeline | After the operator answers (merge-now waits for the merge; leave-for-later proceeds immediately) |
| `auto` | Merge only after the PR is **mergeable** and **checks pass**; then re-run the project gate on merged main | Only when the merged-main gate is green |
| `never` | Stop at the open PR; report the URL | Immediately |

### `auto` guard rails

- **Never merge early.** "Mergeable + checks pass" means green CI, no conflicts, no blocked reviews — all three, verified at merge time, not at PR-open time.
- **Never bypass a red check.** A flaky-looking failure is still a failure; the pipeline waits or halts, it does not admin-merge.
- **Gate on merged main is mandatory.** A PR that was green on its branch can still land red on main (concurrent merges, base drift). The post-merge gate run is what authorizes the next milestone's worker.
- **Strictly opt-in.** The shipped default is `offer`, and no inference path may enable `auto` — not repo history, not CI shape, not "the operator merged the last three by hand". The only enabling act is the operator writing `merge_policy: auto` into the orchestration config themselves.

### `offer` prompt shape

The three options are always presented together — merge now, leave for later, stop — so "stop the whole pipeline" is always one answer away and never requires the operator to interrupt out-of-band.

## Boundary with the ceremony skills

`/deliver` orchestrates; it never re-implements. The commit approval belongs to `/implement`, the release approval to `/ship-milestone`, the push confirmation to `/pr` — `/deliver` relays those gates but never absorbs them, restates them with different wording, or adds gates of its own on top. Symmetrically, a worker's internal retries (e.g. `/implement`'s bounded self-review loop) are the worker's affair; `/deliver`'s retry budget applies only to the `deliver-stage-result` hand-off shape.
