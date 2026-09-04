---
name: deliver
description: Full delivery pipeline orchestrator — takes a feature request from idea through specs to shipped, merged milestones by chaining the toolkit's phase skills end-to-end.
argument-hint: '[feature request or idea, or a milestone or FR identity]'
---

# Deliver

Orchestrate the full delivery pipeline for: `$ARGUMENTS`

This skill is the single entry point that chains the toolkit's phase skills — design, spec-writing, and the per-milestone ceremony — into one supervised pipeline run.

> **FIRST ACTION (under non-interactive stdin).** When `process.stdin.isTTY === false` (e.g., `claude -p`), refuse immediately via `requireOrRefuse(...)` from `adapters/_shared/src/requires_input.ts`, surfacing the `RequiresInputRefusedError` message — which carries the `<dpt:requires-input-refused>v1</dpt:requires-input-refused>` marker the stream parser maps to a machine-recognizable refusal (the canonical refusal shape). A prose-only refusal reads as `vacuous` (a non-pass), indistinguishable from doing nothing. **There is no marker carve-out** — unlike `/spec-write`, the auto-approve marker never lets `/deliver` proceed headless. `/deliver` is interactive by design: its Socratic phases, worker approval gates, and merge-policy prompts all require a live operator, so under non-tty stdin the refusal is unconditional. Interactive (tty) sessions are unaffected.

Extended flow detail — phase-by-phase narrative, the expanded `deliver-stage-result` field reference, the halt taxonomy, and merge-policy routing tables — lives in `docs/deliver-reference.md` (extracted to keep this skill under the NFR-1 line cap). The sections below are sufficient to operate; consult the reference when debugging a halted run.

## Pre-flight — spawn-agent availability

Phase 3's workers ride on the `agent-toolkit:spawn-agent` skill. Probe that the skill is available **via the plugin registry (the installed-plugins listing)** — before Phase 1 begins on a fresh run, or at the resume gate on a resumed one — never by filesystem guesses about where a plugin might live on disk.

If `agent-toolkit:spawn-agent` is unavailable, HALT with the NFR-10 canonical shape, carrying these install instructions verbatim:

```
Refusing: the agent-toolkit:spawn-agent skill is unavailable — /deliver cannot spawn visible workers
Remedy: install the plugin, then re-run /deliver:
  claude plugin install agent-toolkit
Context: mode=deliver, phase=pre-flight, skill=deliver
```

**The probe has two triggers, and they are mutually exclusive.** A run is either fresh or resumed, so exactly one of them applies to any given run and firing that one is mandatory — there is no run for which both apply and none for which neither does. On a fresh run the trigger is *before Phase 1 begins*; on the **resume** path it is the moment the resume classification is rendered for the confirm gate, before any worker is spawned and before any tracker claim. A resume never enters Phase 1, so a before-Phase-1 trigger alone never fires on it: the one path that reaches Phase 3 without passing through Phase 1 would be the one path the probe does not guard.

**Never substitute the built-in Agent/Task tool** for the missing skill. A subagent is invisible — the operator cannot watch it, click into it, or take it over — and a **visible session** is this pipeline's contract. When the skill is missing, the halt above is the only correct behavior.

**Fail closed there, degrade cleanly here.** Do not read that halt as the house style for every capability the spawning skill might lack. It guards a safety property — work must happen in a session the operator can watch and take over, which is why an invisible background agent is an explicit non-substitute for a visible session, and why nothing short of stopping will do. A worker's remote-control name is legibility instead, and legibility degrades gracefully: an unnamed, unbridged worker still completes the whole ceremony correctly, on its own surface, in a visible session the operator can watch, and no milestone's correctness turns on what its worker was called. So no naming path below ever halts — each takes the lesser outcome and reports it.

## Argument — classify it before Phase 1 runs

`$ARGUMENTS` is one of exactly three kinds, and the kind decides everything downstream. The decision command under **Resume** below reports it as `argument_kind`, **before Phase 1** — the answer it delegates to `classifyDeliverArgument(...)` / `resolveDeliverArgument(...)` in `adapters/_shared/src/deliver_argument.ts`:

- **A feature request or idea** — ordinary prose. Proceed to Phase 1 exactly as always. This is the shipped path and it is unchanged.
- **A milestone identity** — `M<N>`, `M_<epic-key>`, or a minted `M_<short-ULID>`: the shared union grammar, never a private `M\d+`. It names the milestone as the work.
- **An FR identity** — it names one FR, and the FR is what gets delivered. Its milestone is resolved here, from the `milestone:` key in the FR's own frontmatter and through the shared frontmatter reader; what the run then does with that milestone is the FR-scoped chain below.

An identity is **not** a feature idea, and treating it as one is the failure this step exists to prevent: the operator names work whose design and specs already exist — often already merged — and the first visible symptom is a Socratic question about something that shipped last week.

If the identity names **no plan file on disk**, **refuse** in the NFR-10 canonical shape and **do not enter the design phase**. The refusal names *both* plausible intents, because an operator who genuinely meant to start new work whose name resembles an identity must not be stranded: say that no plan by that name exists, and say how to start new work instead. Refusing and then brainstorming anyway is the same defect wearing a refusal.

An FR identity carries two further refusal triggers on exactly the same terms — the identity names no FR file on disk, or the FR it names declares no well-formed `milestone:` in its frontmatter — because in both cases there is no plan to route to. Each refuses in the same canonical shape and, like the one above, never enters the design phase.

None of this widens the headless surface. The unconditional non-tty refusal above still fires first, for every argument kind — identity recognition earns no carve-out.

## Resume — entering a milestone that is already under way

An identity that *does* name a plan on disk is almost always **resumed**, not started. Where the pipeline enters is decided by the milestone's state on disk, and the decision command below reports that state as `resume_state`, delegated to `classifyResume(...)` in `adapters/_shared/src/resume_classifier.ts`.

Six states change the entry point. They are the **milestone's** state, so this table is what a *milestone* identity runs. An FR identity is **not** classified by these six — it is classified at FR scope, in its own two-state vocabulary (`needs_technical_review` / `ready_to_implement`, exported as `FR_RESUME_STATES`), and takes the narrower chain in "An FR identity" below. The other four states answer a question about a milestone's plan, which one FR cannot answer.

| State | What is on disk | Where `/deliver` enters |
| --- | --- | --- |
| `needs_technical_review` | FRs bound to the milestone still await technical review | one `/spec-write` pass per flagged FR, inline, then the full chain |
| `ready_to_implement` | specs complete, nothing built yet | `/implement` → `/ship-milestone` → `/pr` |
| `partly_implemented` | some plan tasks ticked, or some bound FRs archived while others stay active | `/implement` → `/ship-milestone` → `/pr` |
| `ship_ready` | zero active FRs bound, at least one archived FR bound, no `shipped_in:` stamp | `/ship-milestone` → `/pr` |
| `shipped` | a real `shipped_in:` stamp | refuse |
| `parked` | the plan declares itself parked | refuse |

**Classification is read-only.** It reads what is on disk and mutates nothing — no spec write, no tracker write, no commit. Classifying a milestone and then walking away leaves the tree byte-identical.

**It assembles the shipped helpers rather than re-deriving them.** Plan task counts come from `plan_task_state`, ship-readiness from `active_plan_ship_ready`, stamp-versus-CHANGELOG coherence from `plan_ship_coherence`, and the review-flag enumeration from `needs_technical_review_consistency` — whose violations the classification carries rather than swallowing. The classifier keeps no private copy of any of those predicates: a second answer to a question that already has one home is the defect this reuse exists to prevent.

**The spec-writing passes follow the target repo.** When FRs still await technical review, run one `/spec-write` pass per flagged FR, in FR order, before any ceremony worker exists. Placement follows the milestone's route: **inline in the invoking session** when the milestone targets the invoking repo, and **inside the target repo's own worker** when it declares a `target_repo:` at another toolkit repo — that is the only place its tracker and specs bind correctly, and the operator answers there, in the visible session.

What is preserved identically on both branches is the Socratic guarantee, and it is about **who answers**, not where the skill runs: `/deliver` never answers on the operator's behalf, never paraphrases, never pre-fills, and never batches the questions. A visible worker the operator types into directly inserts no relay hop, so it proxies nothing — which is why placement can follow the repo without weakening the contract. A **reduced** target (no toolkit) has no `/implement` or `/ship-milestone` stage to resume into at all: its chain is do the work, open a PR.

**A ship-ready milestone enters at `/ship-milestone`**, skipping `/implement` entirely. Its work is already built and archived, so re-entering at `/implement` would re-run finished work.

**A shipped or parked milestone refuses** in the NFR-10 canonical shape and goes no further. A shipped refusal names the milestone and its `shipped_in:` stamp; a parked refusal surfaces the recorded park reason when one is on the record, and stays clean — no empty placeholder — when none is.

**The operator confirms before anything happens, and the record that gate shows is never typed.** Produce it by running

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/deliver_decision.ts <argument> [projectRoot]
```

with the operator's own argument (`[projectRoot]` defaults to the invoking repo). Paste the bytes it prints on stdout **verbatim** into the gate's prompt text: all eight labelled fields, and every chain step carrying its own placement. A retelling of the record in the reader's own prose is not the record — nothing downstream can tell a paraphrase apart from a real classification, which is exactly how a self-approved one-line summary once stood in for the whole decision. On a refusal the command prints the NFR-10 envelope on stderr and nothing on stdout, so the gate shows a whole record or no record.

**Grade the rendering against the capture before showing it.** `verifyResumeGateRender(rendered, capturedStdout)` in `adapters/_shared/src/resume_gate_render.ts` returns `{ ok: false, reasons }` when the gate text is a retelling rather than the record's own bytes, when what was handed in as the capture is not a whole eight-field record, and when no record was put in front of the operator at all.
Run it as `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/resume_gate_render.ts <argument> [projectRoot] <renderedPath>` — it re-runs the decision command itself and grades the rendering against the bytes that run just printed, so a capture nobody executed cannot be handed in; it prints its verdict on stdout and exits 0, or refuses on stderr with the NFR-10 envelope. Show the gate only on a clean verdict.

**The spawn-agent pre-flight probe fires here.** Rendering this record is the resume path's "before anything is spawned" point, so the Pre-flight section's probe runs at exactly this moment — before the gate is shown, before any worker exists, before any tracker claim. Absent ⇒ HALT in the same NFR-10 shape that section carries, and the gate is never shown. This is the resume path's only trigger for it: entering the chain further along means Phase 1 never runs, and a resume that skipped the probe is how a run reaches Phase 3 with no way to spawn.

The gate then asks the operator to confirm it, edit it, or abort. It is presented **before any worker is spawned** and **before any tracker claim is made**, so the operator is deciding rather than ratifying. On `edit`, the operator's chain is what runs, not the proposed one.

**An edit at the gate may reorder or drop steps, and may never change a step's placement.** The operator decides *what* runs; *where* each step runs is derived from the milestone's route and is not negotiable at the gate — hand-re-placing a step is exactly how a chain whose steps said `(worker)` once got run inline.

**Editing the remote-control field edits a field rather than a step.** Confirming the proposed `remote_control` value, naming a different worker, or dropping the bridge with `none` rewrites one labelled field and leaves every chain step exactly where the route placed it, so the placement rule above is unaffected by it.

**Bridging a worker grants no capability a bridged orchestrator lacks — and that holds only while the orchestrator is itself bridged.** Whoever drives the orchestrator can already spawn its workers and type into them, so the bridge adds nothing they could not already reach — but that argument rests entirely on the orchestrator being bridged too. Where workers are bridged and the orchestrator is not, the equivalence breaks and the bridge genuinely widens who can drive the run. Nothing enforces the precondition: there is no readable "am I bridged?" signal to test, because the toggle's connected state lives inside the reading session's own process. The gate names it and stops there — it is an operator-held assumption, not a checked one.

**Relocating who answers a prompt does not relax the gate taxonomy.** A bridge moves where the human stands, not whether a human decides: irreversible and outward-facing gates — merge a pull request, open a pull request, push to trunk, deploy, publish, send an outward-facing message — stay per-action human decisions, and a phone is a human. Reachable is not authorized; each such gate still asks, and asks again at the next of them.

**Aborting at that gate has no side effects** — nothing is spawned, nothing is claimed on the tracker, no inline pass runs, and not one byte of the tree changes.

**One milestone per invocation.** A resume resolves a single milestone, never a sweep, and spawns exactly one worker for that milestone's whole chain. Phase 3's serial one-worker-at-a-time topology below is unchanged: resume enters that topology further along, it does not widen it.

### An FR identity — the FR is the unit of work

An FR identity resumes **that one FR**. Its milestone is resolved from the FR's `milestone:` frontmatter and carried through the run, so every milestone-scoped step (`/spec-archive`, `/ship-milestone`, `/pr`) still knows which milestone it is acting on — but the milestone is **not the unit of work**, and an FR argument is never widened into a sweep of its siblings. The decision command asks the **FR question**, which is a different call from the milestone one:

```
classifyResume(projectRoot, { scope: "fr", fr: "<FR-id>", milestone: "M<N>" })   // NOT classifyResume(root, "M<N>")
runResume({ ..., milestone: "M<N>", fr: "<FR-id>" })                             // `fr` present ⇒ FR scope
```

The positional form above (`classifyResume(root, "M<N>")`) answers the *milestone's* question and returns the six milestone states — passing an FR argument to it silently widens the run back to milestone scope, which is the whole defect this section exists to close. The command takes both halves from the argument classification (`.scope === "fr"` and `.fr`), and `lastActiveFr` on the returned classification picks the branch its `chain:` field reports:

- **Other active FRs are still bound to the milestone** ⇒ the chain is `/implement <FR-id>` then `/pr`. It stops at the PR: the milestone is not finished, and running the ship ceremony now would release it early. The ceremony belongs to the run that closes the milestone.
- **This FR is the last active FR bound to its milestone** ⇒ the chain auto-extends to `/implement <FR-id>` → `/spec-archive M<N>` → `/ship-milestone M<N>` → `/pr`. `/spec-archive` is an explicit step and runs strictly before `/ship-milestone`, because a single-FR `/implement` run leaves the FR at `status: active` and archives nothing — shipping a milestone whose FRs are still active is exactly what that ordering prevents.

Two conditions modify both branches, and neither is optional:

- **The FR itself awaits technical review** ⇒ one `/spec-write <FR-id>` pass heads its chain, on either branch. Scope is that one FR — never the milestone-wide sweep the six-state table's `needs_technical_review` row describes. Placement follows the shipped rule: inside the target repo's worker for a `cross_repo_toolkit` route, inline otherwise.
- **The milestone targets a repo with no toolkit** (the `reduced` route) ⇒ the chain is `/work` then `/pr` and **does not auto-extend**, even when the FR is the last active one. `/spec-archive` and `/ship-milestone` are ceremonies that do not exist in that tree.

The confirm gate above states the branch and its arithmetic, not just the verdict: how many active FRs would remain bound to the milestone once this FR lands (`0 active FRs would remain` on the last-active branch), which of the two chains that count selected, and why. The operator confirms, edits, or aborts that chain exactly as for a milestone resume.

## Phases 1–2 — design and spec-writing, inline

Phases 1–2 run **inline in the invoking session**: invoke `/dev-process-toolkit:brainstorm` (Phase 1) with the driven-run literal `<dpt:driven>v1</dpt:driven>` in its invocation text, and after its design is approved, `/dev-process-toolkit:spec-write` (Phase 2) carrying that same `<dpt:driven>v1</dpt:driven>` literal, directly in this session — not in a spawned worker, not in a fork.

**The driven-run signal, and what it is not.** `<dpt:driven>v1</dpt:driven>` says one thing: this stage is a step of an orchestrated run, so the step that comes next is already on the record. A stage reads it by a deterministic byte check — `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/driven_run_signal.ts <file-or-->` prints `DRIVEN` or `STANDALONE`, and `isDrivenRun` in that module is the one predicate every consumer reads — never by judging whether its arguments look orchestrated. It is **distinct from the auto-approve marker** and shares no truthiness with it: driven says the answer is already known, headless says nobody is present to be asked, and a spawned worker is driven and fully interactive at once. Supplying it suppresses an inline stage's terminal report block and its continuation offers; it approves nothing, and every gate in the taxonomy below fires exactly as it does without it.

**Which repo a milestone targets decides that**, so resolve it before Phase 2 runs. A milestone plan may declare an optional `target_repo:` frontmatter key; the decision command reports the resolved route as `target_repo_route`, delegated to `routeMilestone(...)` in `adapters/_shared/src/target_repo.ts`. Three routes, and the first is the shipped one:

- **No `target_repo:` — or the `null` sentinel — means the invoking repo.** Every plan on disk says this by saying nothing, and it behaves exactly as it always has: both phases inline here, then the three-stage chain in one worker. The undeclared path never goes looking for another tree.
- **Another repo that has the toolkit** — spec-writing moves *into that milestone's worker*, as the first step of its chain, so the tracker and specs bind to the target repo rather than to this session's.
- **A repo with no toolkit** — a reduced chain: do the work, open a PR, with no `/implement` or `/ship-milestone` stage, because those ceremonies do not exist there. Toolkit presence is decided by the shipped on-disk managed-tree predicate, never guessed.

A declared repo that cannot be located **refuses** in the NFR-10 canonical shape naming the declaration; it never silently falls back to the invoking repo, because that would land a milestone's work in the wrong tree — the exact failure the declaration exists to prevent.

Both phase skills are Socratic by contract: they ask the operator clarifying questions one at a time and wait for real answers. `/deliver` leaves those Socratic contracts untouched — it **never proxies** their questions (answering on the operator's behalf, paraphrasing, or pre-filling answers is forbidden) and never batches them into a single combined prompt. Each question reaches the operator exactly as the phase skill asks it, in order, one at a time.

## Phase 3 — per-milestone ceremony in spawned visible workers

Once Phase 2 has produced the milestone plan(s), run the ceremony **strictly serially**: spawn **one fresh visible worker per milestone**, wait for it to finish its whole chain, and only then spawn the next milestone's worker. Never run two milestone workers concurrently — parallel milestones collide on probe-count pins and the release files (the 2026-08-15 operator decision that fixed this topology).

**`/deliver` is the top of a pipeline, never a step inside one.** Never key `/deliver` into a session that is itself a spawned worker — that collapses Phase 3's own spawn into the session doing the keying (the M130 run, 2026-08-24, where it went undetected for twenty minutes). Key `/implement M<N>` into the spawned worker instead.

For each milestone `M<N>`, in plan order:

1. **Spawn** one fresh, visible worker session via the `agent-toolkit:spawn-agent` skill. All spawn mechanics — surface/pane placement, session wiring, lifecycle — are that skill's contract; `/deliver` hands it the kickoff task text, the milestone identity, the worker's NAME, and — separately — whether to bridge it. Those are two hand-offs and not one: naming is unconditional on the launch line the spawning skill builds, bridging is an opt-in argument beside it, and collapsing them would make dropping a bridge cost the name. Fresh means a brand-new session per milestone: never reuse the previous milestone's worker, and never run milestone work inline — every milestone's ceremony runs in a spawned worker, unconditionally, whatever kind of session is reading this.
   **On the resume path the worker's name is the confirmed one.** What `/deliver` hands the spawning skill is the `remote_control` value carried on the record the operator confirmed at the resume gate — read straight off that confirmed record and never re-derived at the spawn, since re-deriving it would silently discard whatever the operator typed over the proposed value at that gate.
   **The fresh-idea path names its worker too.** An idea arriving as prose has no decision record behind it and no confirm gate at all, so here the name is derived at the spawn itself — the same derivation, run over the milestone Phase 2 has just produced by executing `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/deliver_worker_name.ts <repoRoot> <milestone>` and reading the name off its stdout, never by composing one in prose — and that name is what `/deliver` hands the spawning skill. The operator cannot retype it on this path, which is a far smaller thing than not having one at all: a fresh run never spawns an unnamed worker.
   **The bridge argument is opt-in.** When `/deliver` supplies no name, the launch line the spawning skill builds is byte-identical to the one it builds today, and the extra argument appears only when a name is handed over with the spawn. Opt-in here is forced rather than stylistic: that argument ends the session before it starts on an account whose organization has remote control switched off, so an argument passed unconditionally would break every spawn those operators make.
   **A `none` in that field withholds the BRIDGE, never the name.** A record whose `remote_control` reads `none` is a bridge the operator dropped for this run, and the worker is still spawned under its derived name — dropping a bridge is a choice about reachability, not about identity, and an unnamed worker collides with every other unnamed worker on a machine where session names are global, which the spawning skill refuses rather than resolves. The one case that also costs the name is a name that could not be DERIVED, and the advisory riding beside the record is what says so outright; there the worker comes up unbridged — visible, on its own surface, running the same chain it always runs. The run proceeds from there exactly as it would have with a bridge in place: dropping one is a choice the field is built to carry, never a failure the ceremony has to report.
   **A name the derivation refuses renders `none` rather than stopping the run.** When the repository basename and the run's identity do not compose into something the naming grammar admits, the decision record renders `remote_control: none` and the run proceeds to the confirm gate the operator would have used to drop it themselves — the record never refuses for this, since a naming problem halting a run before its gate is the hardest outcome for the mildest cause. Exactly one advisory row rides with the record naming which rule was broken and which half broke it — an identity too long to leave room under the length cap, a basename whose first character is outside the grammar, or a basename that sanitizes away to nothing — because the first is answered by shortening the identity and the other two by renaming the repository, and an operator cannot reach for either fix without the diagnosis.
   **A spawning skill too old to understand the extra argument degrades, and is never a halt.** An installation predating this contract will not recognize the argument at all, so the worker comes up unnamed and unbridged, the ceremony proceeds through every stage it would otherwise have run, and exactly one advisory row reports that the installed spawning skill cannot carry a worker name yet — upgrading that plugin is the entire remedy, and until someone does the run is worse only in how easy it is to find on screen.
   **An argument the command line refuses hard-exits the launch before the session ever starts, and that spawn is retried exactly once without the argument.** Where an organization has switched remote control off, or a subscription does not reach it, the bridged launch dies at the command line before any worker exists — nothing is half-started, so the same spawn is reissued unbridged and the ceremony proceeds through every stage from there. Exactly one advisory row reports that this account will not accept a bridged worker: an entitlement on the account is the whole remedy, and a single retry is the whole budget, since a launch turned away for an entitlement will be turned away again.
   **The two degradations are told apart.** A spawning skill that does not understand the argument and a command line that refuses it are different conditions with different remedies: an upgrade of the installed spawning skill answers the stale installation, an account entitlement answers the refusal. Each carries its own advisory row, worded in its own vocabulary — a shared row standing in for both would send whoever reads it toward the wrong fix, which is the whole of what an advisory is for.
   **Neither plugin declares a version floor on the other.** The halves of this contract ship in separate repositories on purpose, so this ceremony pins no minimum version of the spawning skill and that skill pins none of this one: the orchestrator stays useful against an installation that has never heard of the extra argument, and the argument stays useful to callers that are not this orchestrator, since anyone spawning a session may name it. A floor in either direction would couple plugins built to move independently, and would trade a graceful degradation for a failure at install time.

2. **Kickoff task text.** Read `readOrchestrationConfig().defaultEffort` (from `adapters/_shared/src/orchestration_config.ts`) and carry that effort keyword (e.g. `ultracode`) in the kickoff task text, so the worker session runs at the operator-configured effort level. The same text also states the whole `deliver-stage-result` hand-off contract, spelled out here rather than pointed at — the worker must be told the shape it is graded on before it starts:

   - **Banner** — each ceremony stage ends its report with **exactly one** fenced `deliver-stage-result` block, as the last thing in that report.
   - **Eight sections, fixed order** — `stage`, `milestone`, `status`, `summary`, `gate`, `drive`, `e2e`, `follow_ups`. Never reordered, never omitted. `drive` and `e2e` sit contiguously after `gate`: the three evidence sections are read as one block.
   - **Spawn receipt** — when the chain the worker ran carried a `(worker)`-placement step, `summary` also carries **one** receipt item, `- spawn: handle=<handle> ledger=<ledger-path> owned=0`, in that fixed field order. **Never type that line.** Run

     ```bash
     bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/spawn_receipt.ts <handle> <ledger> <name> <host>
     ```

     with the four values the spawning tool **reported** (an empty `<host>` when it reported none) and paste the one line it prints on stdout. The command resolves the handle through the tool's own ownership check and prints a receipt only on a clean resolve — every other outcome refuses on stderr with an empty stdout, so a handle the reporting stage composed can never reach the fence. `owned` is that check's exit code, and only `0` is emittable. The receipt is an indented `summary` item, not a ninth section, and costs exactly one line against the cap.
   - **No terminal host** — the spawning tool installed with no terminal host to spawn into (no cmux surface, no herdr pane) is the named `no-terminal-host` halt, never a quiet inline fallback: pre-flight probes the tool's availability, never the host's, so this is the one configuration only the halt itself can report.
   - **Line cap** — at most **26** lines total inside the fence. Raised from the previously shipped budget to fit `drive` and `e2e`; the evidence stays in the block rather than moving to a companion artifact, so `status:` and the numbers behind it are read from one place.
   - **Empty-section fallback** — a section with nothing to report keeps its heading and carries the literal `- (none found)` rather than being dropped.
   - **Driven signal** — the kickoff text carries the driven-run literal `<dpt:driven>v1</dpt:driven>`, on its own line, because a worker running a named chain is a driven run: its stages suppress the continuation offers whose answers that chain already gives. It is not the auto-approve marker and does not stand in for it — the prohibition below is unchanged, and the worker's approval gates stay live.
   - **Counts are derived, never authored** — every number in `gate`, `drive` and `e2e` is **derived from the captured output** of the command that produced it, read back out of those bytes. A count the worker authored — typed from memory, carried over from an earlier run, or invented because it looked plausible — is **not acceptable**, and is graded exactly like a missing section. One counts line per section: a section states one run's numbers, or the `- (none found)` fallback.

   The same kickoff text also names the milestone under work (`M<N>`) and the ceremony chain the worker runs in-session, and it **never** carries the auto-approve marker (`<dpt:auto-approve>v1</dpt:auto-approve>`) — workers are interactive and their approval gates must stay live for the operator relay below.
3. **The worker's chain**, run in-session, in order, inside that one worker:

   `/implement M<N>` → `/ship-milestone M<N>` → `/pr`

   The whole chain lives in the single worker session — the implement context is exactly what the ship and PR stages need. Do not split stages across workers.
4. **Wait** for the worker's chain to complete before touching the next milestone. Serial execution is the invariant, not an optimization.

## Worker approval gates — relay to the operator

Ceremony stages pause at real approval gates: the `/implement` commit approval, the `/ship-milestone` release approval, the `/pr` push/PR confirmation, and any tracker-write prompts. When a worker raises one of these gates, `/deliver` **relays it to the operator via AskUserQuestion** — quoting the worker's prompt faithfully — and then **forwards the operator's answer to the worker by keystroke** (typing the reply into the visible worker session). The operator is the only approver in this pipeline.

Gates are not interchangeable, and each class names who decides it (the taxonomy is code, in `adapters/_shared/src/gate_class.ts`): **content** gates shape what gets built, so the operator decides them gate by gate; **mechanical** gates have exactly one correct answer already determined upstream — the next milestone number, the branch name the convention fixes, a tracker field write — so the worker may decide them while a standing authorization is in effect; **irreversible** or outward-facing gates — merge a pull request, open a pull request, push to trunk, deploy to an environment, publish a package or release, send an outward-facing message — the operator decides, per action, and no standing authorization ever reaches them. Whether a given gate still relays is the decision command's `gate_relays` field, alongside the `gate_class` it reports — fail-closed by default (with no delegation on the record it is `yes` for every gate, which is the shipped behaviour), and a gate that *declares* itself mechanical while naming an irreversible action is overridden back to its irreversible class.

The exclusion has an escape hatch, and it is deliberately narrow: an irreversible action is authorized only by a **fresh instruction naming that action** — `freshInstructionAuthorizes(instruction, gate)` — never by a standing authorization however emphatic. "Drive it yourself" does not reach a merge; "merge this PR" does, and only that one. A fresh instruction authorizes the action once and mints no standing scope, so the next irreversible gate asks again.

A standing authorization is **restated back to the operator once, before it takes effect** — quoting their own words, naming the mechanical class it covers, listing every action it does not reach, and stating that it holds for the rest of this run. Until that restatement is on the record the authorization covers nothing at all, not even a mechanical gate: an authorization nobody has read back has no scope. The operator restates once; `/deliver` never re-asks it gate by gate afterwards.

Once on the record, that authorization reaches later milestones through **one channel only: the kickoff task text of the next worker spawned**, carried there as the restatement the operator agreed to (`carryDelegation` in the gate-class module appends it, leaving the rest of the kickoff text untouched). Never deliver it as a mid-run message to an already-running worker — a worker finishes under the scope it was spawned with, and widening that scope mid-run leaves its own transcript recording terms it is no longer operating under.

Two hard prohibitions:

- `/deliver` never injects the auto-approve marker (`<dpt:auto-approve>v1</dpt:auto-approve>`, the canonical line minted for headless `claude -p` heredoc fences and enforced by `adapters/_shared/src/auto_approve_marker.ts`) into worker prompts or kickoff task text. Workers run interactively and their gates must stay live.
- `/deliver` never fabricates an approval — no answering `y` on the operator's behalf, no pre-filling consent, no "the operator would obviously approve" shortcuts. If the operator declines or does not answer, the gate stays closed and the worker stays paused.

The standing authorization is a **distinct** mechanism from the auto-approve marker, not a second name for it, and `/deliver` still never injects that marker into any worker prompt or kickoff text. The marker is the byte-checkable channel minted for headless `claude -p` fences, where no operator is present to be asked; the delegation above exists only inside an interactive session, in words a live operator typed and had restated back to them. Different channels for different domains — which is exactly why adding the delegation does not widen, weaken, or stand in for the marker's contract.

## Stage hand-offs — the `deliver-stage-result` fence

Each ceremony stage (`/implement`, `/ship-milestone`, `/pr`) ends its hand-off back to the orchestrator with **exactly one** fenced `deliver-stage-result` block as the last thing in the stage's report. The block has a **fixed section order** — the sections below, in this order, never reordered, never omitted — and a **line cap** of 26 lines total inside the fence. Any section with nothing to report keeps its heading and carries the literal fallback line `- (none found)` instead of being dropped.

```deliver-stage-result
stage: implement            # implement | ship-milestone | pr
milestone: M<N>
status: ok                  # ok | failed
summary:
  - one line per FR shipped / version bumped / PR opened
  - spawn: handle=<handle> ledger=<ledger-path> owned=0   # only when the chain carried a (worker)-placement step
gate:
  - pass 8123, fail 0, skip 16, baseline 16, delta 0
drive:
  - pass 12, fail 0, skip 0
e2e:
  - pass 3, fail 0, skip 0
follow_ups:
  - (none found)
```

**Required sections, in fixed section order:** `stage`, `milestone`, `status`, `summary`, `gate`, `drive`, `e2e`, `follow_ups`. `status: ok` means the stage completed cleanly; `status: failed` means it could not — the orchestrator halts the milestone and reports to the operator rather than improvising a recovery.

**The `gate:` row's skips carry IDENTITIES, not just a count.** The capture behind a stage's `gate:` section MUST supply `skipNames` — built by `captureGateRun` in `adapters/_shared/src/gate_capture.ts`, the same READ side `/implement` step 14 orders — so `evaluateSkipDelta` names WHICH skips changed instead of comparing counts alone. Supplying no `skipNames` leaves that function on its scalar path: a silently count-only comparison, in which a run that silences one test while un-silencing another reads as a clean pass — on the surface where a whole milestone is graded. The read side is a front door a reader can copy, so this run's identities are obtainable and not merely required:

```sh
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_capture.ts <projectRoot>
```

**Reduced chains — a milestone targeting a repo with no toolkit ceremony.** When a milestone's work lands in a tree that has no toolkit installed, the worker does the work and opens a PR with no `/implement` or `/ship-milestone` stage. The one section that omits real content there is `gate` — and the new `drive` and `e2e` sections sit in exactly the same position: that tree has no project gate, drive or end-to-end command to report counts from. Omitting content is never dropping a section — `gate` keeps its heading and carries the literal `- (none found)` fallback, and so do `drive` and `e2e`. Every other section is filled exactly as on a full chain, `milestone` included: the milestone identity is the orchestrating repo's plan and is known to the worker, and `stage`, `status`, `summary` and `follow_ups` all describe work that did happen. So a reduced chain emits the same eight sections in the same fixed order as a full one, which is exactly why it cannot violate a contract written for the full chain.

`milestone` is a scalar, so the `- (none found)` fallback — a list-item form — is not even expressible there; that fallback belongs to the list sections `summary`, `gate`, `drive`, `e2e` and `follow_ups` alone.

### Shape violations — bounded retry, then halt

A stage report that violates the contract — no fence, multiple fences, sections missing or out of order, the line cap blown, or a **count that disagrees with the captured command output behind it** (including a number claimed with no capture behind it at all) — gets **one scoped retry**: re-prompt the same worker with only the fence contract restated ("re-emit your stage result as a single `deliver-stage-result` fence"), never a re-run of the stage's actual work. A second violation from the same stage is a **deterministic halt naming the stage** (e.g. `Halting: stage /ship-milestone for M<N> violated the deliver-stage-result contract twice`) — the same bounded-retry budget the `/tdd` orchestrator applies to its `tdd-result` fences. Never paper over a malformed hand-off by guessing what the stage meant.

**Grade a full-ceremony stage's fence WITH its captures.** A full-ceremony stage runs every command the project DECLARED it has — a repo whose `## Verification` block says `run_cmd: none`, this one included, has no drive to capture and reports `- (none found)` honestly — and every number it does print has captured output behind it, so its fence is verified with that evidence supplied — `verifyDeliverStageCapture(capturePath, evidence, spawn)`, second and third arguments present — and the verdict comes back `graded: "evidence-backed"`. Called with the fence alone the same function grades **shape-only** and says so in the verdict; that mode exists for a caller holding no captures, and a **shape-only** grade is **not a substitute** for evidence — it certifies form and nothing about the numbers, so a `status: ok` graded that way rests on the worker's word alone. A full-ceremony stage graded shape-only has not been evidenced, and its `ok` must not be relayed as though it had.

A counts disagreement is **not a second failure mode**. `verifyDeliverStageCapture(capturePath, evidence, spawn)` grades it into the same `{ ok: false, reasons }` verdict a missing section or a blown cap produces, so it takes the bounded-retry-then-halt path above unchanged — one scoped retry re-stating the contract, then a deterministic halt. Giving invented numbers their own recovery would mean a second budget, a second halt clause, and a worker that learns which violation is cheaper to commit.

## Post-PR — merge-policy routing

After a milestone's worker reports its `/pr` stage `ok` (an open PR exists), route on the run's **effective** merge policy — the decision command's `merge_policy` field, delegated to `runMergePolicy(...)` in `adapters/_shared/src/merge_policy_ratchet.ts` and printed as `configured -> effective`: the configured value (`readOrchestrationConfig().mergePolicy`, config key `merge_policy`) unless a conversational override is in effect, in which case the effective half is the tightened value. It is the effective half that routes, never the configured one: an operator who tightened mid-run said so precisely to change this decision, and routing on the config here would silently ignore them. Exactly three policies, exactly three behaviors:

- **`offer`** (the default) — ask the operator, via AskUserQuestion, whether to merge the open PR now, leave it for later, or stop the pipeline. The operator's answer decides; `/deliver` never assumes.
- **`auto`** — merge the PR **only after** it is **mergeable** and its **checks pass** (green CI, no conflicts, no blocked reviews). Never merge early, never bypass a red check. After the merge, **re-run the project gate on merged main** — and only when that gate is green does the next milestone's worker get spawned. A red gate on merged main halts the pipeline with a report to the operator.
- **`never`** — **stop at the open PR**. `/deliver` reports the PR URL and moves on to the next milestone (or ends the run) without merging; merging is entirely the operator's affair.

`auto` is **strictly opt-in**: the shipped default is `offer`, and no inference path may enable `auto` — not repo history, not CI shape, not "the operator merged the last three by hand". The only way `auto` turns on is the operator writing `merge_policy: auto` into the orchestration config themselves, an operator decision recorded in the FR Notes.

### Tightening mid-run — the merge-policy override

The operator can restrict merging by saying so — "don't merge anything", "ask me before every merge" — with no config edit. Resolve the statement with `overrideFromStatement(...)` from `adapters/_shared/src/merge_policy_ratchet.ts`, restate it back **once, before it takes effect**, via `confirmOverride(...)` — an unconfirmed override changes nothing — then apply it with `applyOverride(...)` and route each milestone's post-PR decision through `postPrAction(...)`. From then on it holds for the rest of this run: the routing above reads the run's *effective* policy, so every remaining milestone routes on the override rather than on the configured value. It is a run fact only — it is **not written to CLAUDE.md**, and persisting it stays a separate and explicit operator request.

The ratchet only ever tightens. `auto` → `offer`, `auto` → `never` and `offer` → `never` are accepted; `offer` → `auto`, `never` → `offer` and `never` → `auto` are refused, as is any statement reaching for `auto` at all — the only enabling act stays the operator writing `merge_policy: auto` into the orchestration config themselves, which is why no spoken instruction can become the inference path this section forbids.
