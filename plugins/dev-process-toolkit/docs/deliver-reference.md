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

## The argument — three kinds, one of which is not new work

`/deliver` accepts three kinds of argument, decided by `classifyDeliverArgument(...)` in `adapters/_shared/src/deliver_argument.ts` and never by prose judgement at the call site:

- **A milestone identity** — a token under the shared union grammar (`adapters/_shared/src/milestone_token.ts`), which covers all three mint paths: the Linear sequential form, the Jira Epic-keyed form, and the tracker-less short-tail form. Recognition rides that module, never a private numeric copy — a private copy recognizes the sequential form and silently misroutes the other two.
- **An FR identity** — a tracker ref or a minted id, naming one FR. Its milestone is resolved from the `milestone:` key in its own frontmatter, read with the shared frontmatter reader, and carried through the run so every milestone-scoped step has it. What gets delivered is still the FR itself, on the FR-scoped chain below — the milestone is carried, not substituted for it.
- **A feature request** — prose, which is what `/deliver` has always taken and what the design phase exists for. Recognition is anchored on the *whole* argument, so prose that merely mentions a milestone token mid-sentence stays prose, and a malformed identity-ish token (`M`, `M_`, `M5-extra`) is prose too: handing the operator the pipeline they have always had is the safe reading.

**An identity that names no plan file on disk is REFUSED, and the design phase is never entered for it.** Both halves matter. `/deliver` halts in the NFR-10 canonical shape (`Refusing:` / `Remedy:` / `Context:`), quoting the identity and — for an FR — the milestone it resolved to. It does **not** then fall through to Phase 1, because a milestone identity is a perfectly well-formed "idea": brainstorming it would run a Socratic design session over work whose specs are already written and often already merged, which is the failure this refusal exists to prevent. Falling through is the dangerous outcome, not the polite one.

The refusal names both intents an operator could have had, because the identity alone cannot distinguish them. If they meant an **existing milestone**, the remedy is to check the identity — plans live in `specs/plan/` and, once shipped, in `specs/plan/archive/`, and the probe reads both. If they meant to **start new work**, the remedy is to describe it in their own words as a feature request, which is exactly the argument the design phase takes. A refusal that named only the first intent would strand the second reader with no way forward.

Identity recognition earns no relaxation of the non-interactive gate: the FIRST ACTION refusal in the skill file applies to every argument form alike, identities included, and it fires before the plan probe or the design phase is touched.

## An FR identity — the FR is the unit of work

The rule an FR resume runs on lives in the skill file, which is the operative surface. This section is the debugging view of the same rule: which chain a given FR should have produced, and how to read a run that produced the other one. Both surfaces are written against the shipped classifier, so if they ever disagree, `classifyResume(...)` / `resumeChain(...)` in `adapters/_shared/src/resume_classifier.ts` settles it — never prose judgement at the call site.

An FR identity delivers **that one FR**. The milestone off the FR's `milestone:` frontmatter is carried so every milestone-scoped step knows which milestone it is acting on, but it is **not the unit of work** and an FR argument is never widened into a sweep of its siblings. One classifier field decides the whole chain — but only if the classifier was asked the FR question in the first place:

```
classifyResume(projectRoot, { scope: "fr", fr: "<FR-id>", milestone: "M<N>" })
runResume({ ..., milestone: "M<N>", fr: "<FR-id>" })    // `fr` present ⇒ FR scope
```

The positional `classifyResume(root, "M<N>")` answers the *milestone's* question and returns the six milestone states, so a run that reached for it with an FR argument was already back at milestone scope before this table could apply — check that first when a chain came out milestone-shaped.

| `lastActiveFr` | Chain built | Why it ends where it does |
|---|---|---|
| `false` — other active FRs are still bound to the milestone | `/implement <FR-id>` → `/pr` | It stops at the PR. The milestone is not finished, so running the ship ceremony now would release it early; the ceremony belongs to the run that closes the milestone. |
| `true` — this FR is the last active FR bound to its milestone | `/implement <FR-id>` → `/spec-archive M<N>` → `/ship-milestone M<N>` → `/pr` | `/spec-archive` is an explicit step and runs strictly before `/ship-milestone`: a single-FR `/implement` run leaves the FR at `status: active` and archives nothing, and shipping a milestone whose FRs are still active is exactly what that ordering prevents. |

Reading a run that came out wrong starts at that field, because the confirm gate had already rendered its arithmetic before anything was spawned — how many active FRs would remain bound once this FR lands (`0 active FRs would remain` on the last-active branch), which chain that count selected, and why:

- **It shipped a milestone you did not expect to ship** ⇒ the classification saw no other FR bound to that milestone with `status: active`. Check for a sibling archived earlier in the same session, or bound to the milestone by a `milestone:` key that does not match.
- **It stopped at a PR you expected to ship** ⇒ the mirror case: a sibling was still active when the tree was read. Classification is read-only and one-shot, so archiving that sibling afterwards does not retro-extend the chain — the remedy is a fresh `/deliver M<N>` resume — which enters at `ship_ready` only once every bound FR is archived, and at `partly_implemented` while any is still active.

## Target repo — which tree a milestone's work lands in

A milestone plan may declare the repo it targets with an optional `target_repo:` frontmatter key. The declaration is additive and the default is the status quo:

- **No `target_repo:` key — or the `null` sentinel — means the invoking session's repo.** This is what every existing plan says by saying nothing, and it behaves exactly as it always has: design and spec-writing inline in the invoking session, then the shipped three-stage chain in one worker. `/deliver` does not go looking for another tree for an undeclared milestone; there is nothing to look for.
- **A declared value is read verbatim** and resolved against the invoking repo when relative. Declaring the invoking repo itself is a no-op, not a second code path.
- **A `target_repo` naming another toolkit-managed tree moves spec-writing into that milestone's worker.** Phase 1 still runs inline; Phase 2 does not. The specs have to bind to the target tree's tracker and its `specs/` directory rather than the invoking session's, and only a worker sitting in that tree can do that — so the worker's chain is `/dev-process-toolkit:spec-write` first, then the shipped ceremony unchanged: `/implement` → `/ship-milestone` → `/pr`. It is still one fresh worker for the milestone, and workers are still taken strictly one at a time.
- **A `target_repo` tree with no toolkit installed runs a reduced chain:** the worker does the work and opens a PR, and that is the whole chain — no `/implement` and no `/ship-milestone` stage, because those ceremonies do not exist in that tree. Toolkit presence is decided by the shipped on-disk managed-tree predicate against the resolved target repo, never guessed from the repo's name or asserted in the declaration. The reduction is a matter of which *stages* run; what the worker emits is unchanged — see "Reduced chains" under the hand-off contract below, where the same six sections still appear in the same fixed order.
- **A declared `target_repo` that cannot be located on disk is REFUSED, not worked around.** `/deliver` halts in the NFR-10 canonical shape (`Refusing:` / `Remedy:` / `Context:`), quoting the declared value and naming the `target_repo` key that carried it, and it never silently falls back to the invoking repo. The fallback is the dangerous outcome, not the safe one: a milestone whose plan names another tree would land its branch, its commits, and its PR in the invoking repo — the exact mix-up the declaration exists to prevent — and a silent skip is worse than a loud failure. Only the operator can decide whether the right answer is fixing the path, cloning the tree, or dropping the declaration, so the pipeline stops and asks.

The key is read out of the plan's frontmatter through the shared frontmatter reader, so a CRLF- or BOM-authored plan is understood the same as an LF one.

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

### Gate classes and the standing authorization

Every relayed gate carries one of three classes. The taxonomy is code — `adapters/_shared/src/gate_class.ts` — not prose, and `relayRequired(gate, delegation)` is the decision function:

| Class | Examples | Who decides | Can a standing authorization cover it? |
|-------|----------|-------------|----------------------------------------|
| `content` | the `/implement` commit approval, the release approval | operator, gate by gate | No |
| `mechanical` | the next milestone number, the branch name the convention fixes, a tracker field write | operator by default; the worker once a standing authorization is on the record | **Yes** — this is the only class it covers |
| `irreversible` | merge a pull request, push to trunk, deploy to an environment, publish a package or release, send an outward-facing message | operator, **per action, always** | **Never** |

- **Relay-everything is the shipped default.** With no delegation on the record, `relayRequired` is `true` for every gate in every class — a run where the operator says nothing behaves exactly as it always has.
- **Restate once.** A delegation covers nothing until it has been read back to the operator; an authorization nobody has confirmed has no scope.
- **Kickoff-only carry.** It reaches later milestones through the next spawned worker's kickoff text and never as a mid-run message to a running worker.
- **The irreversible exclusion is enforced, not documented.** Guards live in `IRREVERSIBLE_GUARDS` and each is drop-one mutation-verified; `/gate-check` probe #78 fails any surface that describes the authorization without naming every action it cannot reach. A gate that *declares* itself mechanical while naming an irreversible action is still classified irreversible — the guard hit wins.
- **The escape hatch is per-action.** `freshInstructionAuthorizes` admits an irreversible action only when the operator's fresh instruction names that action; it mints no standing scope, so the next one asks again.
- **Distinct from the auto-approve marker.** The `<dpt:auto-approve>v1</dpt:auto-approve>` marker is the byte-checkable channel for headless `claude -p` fences. The standing authorization exists only in an interactive session where a live operator typed the words. Different channels, different domains — which is why adding one does not weaken the other, and why `/deliver` still never injects the marker anywhere.

The operator is the only approver. Two hard prohibitions, restated because both have historical incident shapes:

- **No auto-approve injection.** The `<dpt:auto-approve>v1</dpt:auto-approve>` marker exists for headless `claude -p` heredoc fences; `/deliver`'s workers are interactive and their gates must stay live.
- **No fabricated approvals.** No answering `y` on the operator's behalf, no pre-filled consent, no inferring approval from silence. A declined or unanswered gate stays closed and the worker stays paused.

## The `deliver-stage-result` contract, expanded

Each ceremony stage ends its report with **exactly one** fenced `deliver-stage-result` block, last thing in the report.

**Reduced chains — a milestone targeting a repo with no toolkit ceremony.** When the work lands in a tree with no toolkit installed, the chain is reduced: the worker does the work and opens a PR, with no `/implement` or `/ship-milestone` stage. The one section that omits real content there is `gate` — that tree has no project gate command to report pass and skip counts from. Omitting content is never dropping a section: `gate` keeps its heading and carries the literal `- (none found)` fallback. Every other section is filled exactly as on a full chain, `milestone` included, so the `milestone` row's "never empty" in the table below holds without exception; the milestone identity is the orchestrating repo's plan and is known to the worker. A reduced chain therefore emits the same six sections in the same fixed order as a full one — which is exactly why it cannot violate a contract written for the full chain.

Note the shape constraint that makes this the only coherent reading: `stage`, `milestone` and `status` are **scalars**, while `summary`, `gate` and `follow_ups` are **lists**. The `- (none found)` fallback is a list-item form, so it is expressible only in the three list sections. A scalar section can never be "empty-with-fallback"; it is always filled.

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

### Tightening mid-run — the conversational merge-policy override

The routing table above reads the run's **effective** merge policy, not the configured one. They differ when the operator has tightened mid-run by saying so — "don't merge anything", "ask me before every merge" — which takes effect with no CLAUDE.md edit. Resolve with `overrideFromStatement(...)`, restate **once** before it takes effect with `confirmOverride(...)` (an unconfirmed override covers nothing), apply with `applyOverride(...)`, and route each post-PR decision through `postPrAction(...)` — all from `adapters/_shared/src/merge_policy_ratchet.ts`.

The ratchet is **restriction-only**, and that is what keeps it compatible with the `auto` guarantees above rather than a contradiction of them:

| Transition | Verdict |
|---|---|
| `offer` → `never` | accepted (tightening) |
| `auto` → `offer` | accepted (tightening) |
| `auto` → `never` | accepted (tightening) |
| `offer` → `auto` | **refused** (loosening) |
| `never` → `offer` | **refused** (loosening) |
| `never` → `auto` | **refused** (loosening) |
| identity (`x` → `x`) | refused as a no-op |

No tightening transition has `auto` as its target, so the set of values a spoken statement can produce is `{offer, never}` — `auto` is not in it. The refusal of an `auto` target is enforced **unconditionally and ahead of the guard list**, so it holds even if every loosening guard were dropped. The override is also **non-persistent**: it is a run fact, never written to CLAUDE.md, so the config file stays the sole surface on which `auto` can ever be enabled. Persisting an override is a separate, explicit operator request.

### `offer` prompt shape

The three options are always presented together — merge now, leave for later, stop — so "stop the whole pipeline" is always one answer away and never requires the operator to interrupt out-of-band.

## Boundary with the ceremony skills

`/deliver` orchestrates; it never re-implements. The commit approval belongs to `/implement`, the release approval to `/ship-milestone`, the push confirmation to `/pr` — `/deliver` relays those gates but never absorbs them, restates them with different wording, or adds gates of its own on top. Symmetrically, a worker's internal retries (e.g. `/implement`'s bounded self-review loop) are the worker's affair; `/deliver`'s retry budget applies only to the `deliver-stage-result` hand-off shape.
