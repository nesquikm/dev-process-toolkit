---
status: live
updated_at: 2026-08-07
---

# Open follow-ups

Items surfaced during implementation or review that are **real but out of scope
for the milestone that found them**. Each one is here because it would otherwise
survive only in an archived FR's `## Implementation notes`, a review transcript,
or a session that has ended — none of which anybody reads again.

**What belongs here.** A defect or gap that is (a) measured, not suspected, (b)
covered by no acceptance criterion in the milestone that found it, and (c) not
urgent enough to widen that milestone's scope. Anything actionable enough to
schedule should become a tracker ticket and be linked from its entry.

**What does not.** Anything already covered by an AC, anything speculative, and
anything a probe already catches — the gate is the durable record for those.

**Convention.** Newest milestone first. When an item ships, delete its entry in
the same change that closes it and note the closure in the shipping FR. Entries
that go stale without shipping are worse than no entry, so an item that no longer
reproduces should be deleted with a one-line reason rather than left to rot.

---

## From M121 implementation (2026-08-07)

### 0. Two live inconsistencies STE-446 created or left behind

Both were surfaced at STE-446's commit gate and deliberately not fixed there (outside every AC of that FR). Recording them because a gate report is scrollback and this file is not.

**(a) — CLOSED by STE-447.** The `smoke_fixture_groups.ts` `USAGE` string contradicting its own refusal line. The question this entry posed was answered rather than assumed: AC-STE-447.8 names `smoke_verdict.ts` specifically, so its scope does **not** extend here — this was a separate surface. It was fixed anyway, because STE-447 had to edit that same `USAGE` constant to advertise the new `legs` subcommand, and knowingly re-shipping a contradiction from a line you are already rewriting is not scope discipline. The alternation is now derived (`SMOKE_LEGS.join("|")`) rather than restated, so it cannot drift again.

**(b) `tests/m116-ste-420-verdict-artifact.test.ts` hand-rolls a brace-group parser that is now a near-copy of the shared one, with a WEAKER regex.** The test uses `/^\{\n([\s\S]*?)^\} &/gm`; `parseSpawnFenceGroups` in `adapters/_shared/src/leg_prose_surfaces.ts` uses the tab-tolerant `/^\{[ \t]*\n([\s\S]*?)^\}[ \t]*&/gm`. They agree today and would diverge the moment the driver's spawn fence gained trailing whitespace on a brace line — the test would stop finding groups the parser still finds, silently. Pointing that test at the shared parser retires the divergence.

### 0b. Two tooling hazards for anyone running mutation probes

This milestone's method is "mutate, observe RED, restore". Two ways that goes wrong, both hit live:

**Restore with an absolute path, never a relative one after a `cd`.** A probe that ends `cp /tmp/backup .claude/skills/…/SKILL.md` will silently miss if an earlier `cd` in the same compound command changed the working directory — the `cp` fails, the `&&` chain stops, and the **mutated file stays on disk**. Hit once this session; caught only by reading the error text. Use absolute paths on both sides of the restore and verify with `git status` afterwards rather than trusting the copy.

**A mutation that silently NO-OPS is indistinguishable from a fix that does nothing — and it invites reverting a CORRECT fix.** Hit twice in M121. `sed 's/^set -f$//'` matched nothing because the directive was indented, so the "mutated" and "unmutated" runs printed byte-identical output. The natural reading of identical output is *"my fix made no difference, revert it"*; the correct reading is **"my mutation missed"**. Same shape when a harness substitutes values into an extracted fence: if the substitution fails, artifacts land somewhere the assertions never look, and every test fails at once in a way that reads as "the code under test does nothing" rather than "the harness is misconfigured". **Always assert the mutation applied** — count what was removed, or compare before/after and throw on equality — BEFORE running anything that depends on it. Identical output on both sides is evidence about your probe, never about your fix.

**A DELEGATED mutation probe delegates the restore obligation, and the delegator cannot see the mutation window.** Hit in STE-450. The blast-radius survey was measured by a subagent that registered a synthetic ninth fixture group, ran the full suite, and reverted — sound method, and it caught two sites hand-analysis missed. But for the duration the working tree was dirty with someone else's edit, and the implementing session noticed only because an unrelated `Edit` failed with *"file has been modified since read"*. Had that edit targeted one of the mutated files instead, it would have been applied on top of a synthetic mutation and then "restored" out from under. **Verify the tree with `git status` immediately before and after any delegated measurement, and do not edit a file a subagent may be holding.**

**`bun test -t "<name>"` treats its argument as a REGEX.** Filtering on a test whose name contains parentheses — `-t "direction (i)"` — matches zero tests and reports `matched 0 tests`, which reads like a passing filter rather than a failed one. Use a distinctive literal substring without regex metacharacters.

### 0a. — CLOSED by STE-452. A reduced `--legs` run reports a WRONG verdict under `--auto-fix`

**CLOSED by STE-452 — kept rather than deleted, because the convention's delete-on-ship rule assumes the entry's value was the reminder, and here it is the measurement.** The "before" figures below are the only executed record of what the defect actually did, and STE-452's implementation notes quote them; deleting them would leave that FR citing evidence nobody can find. Everything from here to the scope list is **history**, not a live defect.

**What shipped:** all four surfaces named at the foot of this entry now count `SELECTED_LEGS`. `--legs linear` with the other legs' artifacts absent falls through rc collection at rc 0 and the `green` probe reports `STATUS=[green]`; a SELECTED leg with a missing artifact still aborts, now with an explicit message instead of a `test(1)` usage error. Covered by `tests/m121-ste-452-termination-harness.test.ts`, which executes the fences rather than grepping them, and by three tests added to `tests/driver-gate-fail-open-guards.test.ts`. Eleven mutations were run against the shipped fences and prose; eleven RED, every restore md5-verified. The full table, including the control run that decided how the `green`-probe derivation surface was repaired, is in that FR's `## Implementation notes` § Mutation results.

**One caveat that outlives the fix, because it is a coverage ceiling rather than a bug.** Two of the four surfaces — the leg-completeness check and aggregation — are prose executed by a model, not shell. They are adapted and positively pinned, but they are not *executed* by any test and cannot be. Do not read "all four adapted" as "all four covered to the same standard".

---

**The original entry follows, unchanged.**

**This is a usability defect, not a scoping note, and it is written here rather than only in skill prose because STE-452 rewrites the `green` probe and must meet it.** STE-447 shipped the `--legs` selector; it did not adapt the termination probe, which is out of its ACs.

**Measured 2026-08-07** by extracting the `green`-probe fence from `.claude/skills/conformance-loop/SKILL.md` and executing it against materialized findings files:

- **Full selection, all per-leg findings files present, zero high lines** → `STATUS=green`, break taken. Correct.
- **Reduced selection (`--legs linear`, only that leg's findings file on disk)** → the probe greps every REGISTERED leg, so it emits to stderr:
  ```
  grep: /tmp/dpt-smoke-findings-<date>-jira.md: No such file or directory
  grep: /tmp/dpt-smoke-findings-<date>-none.md: No such file or directory
  bash: line 3: [: : integer expression expected
  ```
  `STATUS` stays **unset** and **the script continues**. It does not refuse and it does not abort.

**The three operator experiences, distinguished, because only one of them is acceptable:**

1. **It does NOT refuse.** No NFR-10 message, no non-zero exit from the probe.
2. **It ERRORS only in the sense of shell diagnostics.** Three stderr lines that read like a malfunction, with no explanation tying them to the `--legs` flag the operator passed.
3. **What it actually does — CORRECTED 2026-08-07 after the STE-447 audit executed the RC-collection fence.**

**The first version of this entry was WRONG and is corrected here rather than quietly edited, because the error is instructive.** It claimed that under capture-only the operator "DOES get the aggregated report and a verdict", and flagged that half as read-from-prose rather than executed. It was an inference, and the inference was false. The audit executed the fence; the measured behaviour is worse and arrives earlier.

**A reduced run never reaches the `green` probe at all. It hard-aborts at RC collection, in BOTH modes.** Executed against the RC-collection fence with only `linear.rc` present:

```
/conformance-loop: Phase A subprocess failed (linear=0, jira=1, none=1). Aborting.
rc=1
```

The RC gate reads every REGISTERED leg's rc-file. An unselected leg wrote none, `cat` yields empty, the `case '' -> RC=1` normalization (correctly, for its own purpose) treats an unreadable rc as a failure, and the gate aborts. **That gate sits before aggregation and before the capture-only short-circuit**, so the run produces no aggregated report, no findings file and no verdict in either mode.

**Revised severity, and it cuts both ways.** This is *safer* than the false-`exhausted` verdict the earlier version of this entry described — the run fails loudly and non-zero rather than reporting a confident falsehood, so the vacuous-green hazard is not reachable through this path either. But it means **`--legs` is effectively unusable today for any proper subset**: the selector parses, the guard refuses emptiness correctly, and then the run dies at the first gate that counts legs. And the diagnostic actively misleads — *"Phase A subprocess failed"* names a subprocess failure when no subprocess was ever spawned for those legs.

**So the honest statement of what STE-447 shipped:** the guard is sound and the selector's happy path is not. A reduced run is refused by a downstream gate with a wrong explanation.

**A FIFTH surface, measured by STE-448 and FIXED there — read this before assuming the list below is complete.** The spawn fence's own last line summarised the detach as `linear=${PID_LINEAR} jira=${PID_JIRA} none=${PID_NONE}`, one variable per REGISTERED leg. An unselected leg's brace group never runs and never assigns its variable, so under `set -u` that line aborted the shell at the END of the spawn fence — after the selected legs were detached, before anything could `wait` on them. Measured: `PID_JIRA: unbound variable`, rc 1, groups orphaned. Unlike the four below it fires inside Phase A's own fence rather than downstream of it, and it was invisible: reverting the fix left the whole suite at 6764 pass / 0 fail. STE-448 replaced the line with a `SELECTED_LEGS`-driven summary and covered it with an executed `set -u` reduced-run test. Noted here so STE-452 does not re-derive it as a fifth item, and as evidence that the enumeration below was a snapshot rather than a survey.

**Scope when STE-452 picks this up — larger than the `green` probe alone.** At least four surfaces count legs off the registered set and each needs the selection:

- **RC collection** (the one that actually fires first — start here).
- **The `green` termination probe** (the surface originally named here).
- **The leg-completeness check**, which verifies each leg's grandchild log set.
- **Aggregation**, which reads a per-leg findings file per registered leg.

The common requirement is that `SELECTED_LEGS`, resolved by pre-flight (0), must reach all of them. For each: an absent artifact for a SELECTED leg stays an abort (STE-452's own "absent-file semantic" task); an absent artifact for an UNSELECTED leg must be a no-op. Those two cases are indistinguishable today because none of the four can see the selection.

### 0c. Three leg-count assumptions STE-447 measured but could not fix

All three were found while implementing STE-447, are covered by none of its nine ACs, and are recorded rather than absorbed. Each is a place where widening `SMOKE_LEGS` to three left a two-leg assumption behind.

**(a) `tests/smoke-test-driver-hardening.test.ts:237` budgets the auto-approve marker at "at least 4", and the 4 is two-leg arithmetic.** The test title states its own derivation: *"conformance-loop carries the marker at least 4 times (Phase A linear + jira + Phase B spec-write + implement)"*. With three registered legs the true count is 5, so the assertion has one leg of slack. **Consequence:** a leg whose spawn block ships WITHOUT the `<dpt:auto-approve>v1</dpt:auto-approve>` marker still satisfies it — and a marker-less leg halts at its child's Phase 0 prompt under `claude -p`, which is the failure STE-226 exists to prevent. `at least`-style budgets derived from a leg count are the same class as the unanchored-prefix pins in § 2 below; the fix is to derive the expected count from `SMOKE_LEGS.length` rather than to bump 4 to 5.

**(b) — CLOSED by STE-448.** All three abort/teardown clauses tore down a two-leg brace expansion (`rm -rf ../dpt-test-project-{linear,jira}`) and so leaked the tracker-less leg's directory on every abort path. Closed exactly as this entry prescribed: the three clauses now route to a shared § Per-leg abort teardown recipe that iterates the **SPAWNED** set — recovered from disk, since a leg's brace group opens its per-iteration log as its first act, so the log's existence is the durable record that the group ran. Selected-but-never-spawned legs are therefore not `rm -rf`'d, and no new hand-maintained leg list was introduced (the loop walks `SELECTED_LEGS`, which pre-flight (0) resolved from `SMOKE_LEGS`). Covered by `tests/m121-ste-448-mode-none-leg.test.ts` § AC-STE-448.2, which asserts three per-leg removals and permits the superseded expansion only on a line labelled superseded.

**(c) The extract-and-execute-a-fence pattern now has three independent implementations.** `tests/driver-gate-fail-open-guards.test.ts:82`, `tests/m117-ste-428-report-issue-renderable.test.ts:362` and `tests/m121-ste-447-legs-selector.test.ts` each define their own fence extractor, and they do not agree: two use a `/```bash\n([\s\S]*?)```/g` regex and one uses a line scanner over `/^\s*```/`. They agree on the drivers' current formatting and would diverge on an indented fence. Three copies is the threshold § 4 of the M117 section sets for extracting a shared module ("extract when a third wants it"), so this is that trigger firing. Worth pairing with the same file's `parseSpawnFenceGroups`, which is a fourth brace-group parser.

**UPDATED by STE-452 — there are now FOUR, and the fourth was added knowingly.** `tests/m121-ste-452-termination-harness.test.ts` defines its own `bashFences` too. Extracting the shared module was considered and declined inside that FR: it would have touched three test files this milestone's ACs do not name, on a branch already carrying a recorded conflict about which shipped test files may be modified, and the FR's own scope line says the harness is deliberately narrower than the flag it attaches to. Recording the count honestly is the alternative to pretending the threshold was not crossed again. The trigger is now firing at 4/3.

**CORRECTED by STE-453 — the count above was WRONG when it was written, and the correction is the point of this paragraph.** There were **FIVE**, not four: `m121-ste-448-mode-none-leg.test.ts` defines one too, and it was never counted. Across three mutually-disagreeing grammars — two `/```bash\n([\s\S]*?)```/g` variants, one line scanner over `/^\s*```/`, and one broad `/^```[^\n]*\n/` — plus a sixth definition in `m121-ste-451-fixture-group-10.test.ts` that extracts but never spawns. **An entry whose whole content is a count is worth exactly the accuracy of that count**, and this one had drifted low inside the milestone that wrote it, which is the same "an FR's own count of its defect is a hypothesis" pattern § 9 of the M116 section records.

**PARTIALLY CLOSED by STE-453.** `tests/_fence.ts` now holds the shared extractor (`bashFences`, `anyFences`, `fenceContaining`) plus the throwing `mutate` from § 0b, and `m121-ste-452-termination-harness.test.ts` imports it — its definitions were lifted **verbatim**, so behaviour is unchanged by construction and that file's 42 tests are the equivalence proof. STE-453 needed a sixth private copy and made the module instead of adding one. **Three inline copies remain** (`driver-gate-fail-open-guards`, `m117-ste-428-report-issue-renderable`, `m121-ste-447-legs-selector`); repointing them is mechanical but touches three files no STE-453 AC names, so it is left here rather than absorbed. The house precedent for the module's shape is `tests/_skill-md.ts`.

### 0e. Three things STE-448 measured — one blocked, two hazards for the next editor

**(a) BLOCKED, and it is a hard constraint on the smoke driver, not a preference.** `tests/m116-ste-423-tracker-scoped-artifacts.test.ts` requires every `dpt-smoke-` literal in `.claude/skills/smoke-test/SKILL.md` to carry a tracker segment matching its own hardcoded `TRACKER_SEGMENT` alternation — `(?:<tracker>|\$\{TRACKER\}|\$TRACKER|linear|jira)`, a two-leg literal that predates the third leg. AC-STE-446.4 forbids modifying that file (it asserts the file is byte-unchanged against the merge-base). **Consequence: no per-leg scratch path for any leg outside `{linear, jira}` may be written out in the smoke driver, ever, until one of the two constraints is lifted.** STE-448 complied by stating the tracker-less leg's artifact classes through the `<tracker>` template and putting the enumeration in `/conformance-loop`, which STE-423 declares out of scope — the route STE-446's own hazard note prescribes. It works, but the asymmetry is real and will read as an oversight to the next editor: `linear` and `jira` are spelled out in § Operator-driven parallelism and the third leg is not. **The fix is to derive `TRACKER_SEGMENT` from `SMOKE_LEGS`** (STE-446's audit already recorded the same alternation being hand-copied a third time), which requires a milestone willing to touch that file — i.e. one that does not inherit AC-STE-446.4's unmodified-file arm. Until then, do not read the missing literals as a gap in the third leg's coverage.

**(b) HAZARD — the poll-loop derivation surface binds to the FIRST `for LEG in` in the loop driver, and nothing says so.** `POLL_LOOP_WORDS_RE` in `adapters/_shared/src/leg_prose_surfaces.ts` is a NON-GLOBAL `exec`, so `parseSpawnFenceGroups`'s sibling surface takes whichever `for LEG in …` appears first in the document — not the poll loop's. Measured while adding the § Per-leg abort teardown fence, which sits above the poll loop: the pidfile surface reported `${SELECTED_LEGS}` as a leg token and the STE-446 set-equality check went RED for a reason that had nothing to do with the leg set. Worked around by naming the new loop variable `SEL` (the house precedent pre-flight (h)'s remedy already uses), and the fence carries a comment saying why. **The real fix is to anchor the surface on the poll loop rather than on the first match** — e.g. require the matched loop's body to contain a `.pid` path. Left alone here because re-aiming a shipped derivation surface is STE-446's contract, not this FR's, and the workaround is verified.

**(c) The STE-447 spawn-fence harness keys its /tmp artifacts on `process.pid`.** `runSpawnFence` in `tests/m121-ste-447-legs-selector.test.ts` builds its token as `ste447spawn-${process.pid}-${seq}`, which is unique only while no PID is ever reused. It leaked three `.rc` files per run — deterministically, measured — because the fence aborted before `wait` under `set -u` (the defect STE-448 fixed), so the orphaned brace groups wrote their rc-files after the harness had cleaned up. With that abort fixed the leak is gone (measured: 0 leftovers), so the collision has nothing left to collide with and this is recorded rather than fixed. **It is still the likely mechanism behind the one flaky failure seen during STE-448's gate runs** — `--legs linear spawns ONLY linear` failing once in five full-suite runs and passing in isolation, with a stale `jira.log` present on disk at a recycled-PID token. If it ever recurs, make the token unique per invocation (the harness already `mkdtemp`s a stub-bin directory whose basename would serve).

### 0d. TOOLKIT FINDING — the pre-commit `/tdd` gate is satisfied by skill INVOCATION alone, and its named remedy damages verified work

**This is a finding about the SHIPPED PLUGIN, not an M121 defect.** It is recorded here because M121 is where it surfaced, but it belongs to `plugins/dev-process-toolkit/templates/hooks/`, it affects every consumer project the toolkit bootstraps, and it is exactly the class of thing `/conformance-loop` exists to find. It should become a tracker ticket against the toolkit rather than being absorbed into this milestone.

**Mechanism, stated precisely because the obvious reading is wrong.** There is no `pre-commit` git hook in this repository — the only git hook installed is `commit-msg`. The block comes from a **PreToolUse Bash hook the plugin injects** via `plugins/dev-process-toolkit/hooks/hooks.json`, running `templates/hooks/_lib/hooks/pre-commit-tdd-orchestrator.ts`. It intercepts `git commit*`, classifies the staged paths, and on `tdd-required` calls `requireSkillToolUse("dev-process-toolkit:tdd", ...)`, exiting 2 on a miss.

**Half one — the gate measures a string, not a process.** `requireSkillToolUse` scans the **session transcript** for a `Skill` tool_use naming `dev-process-toolkit:tdd`. That is the entire pass condition. It does not check that the RED stage ran, that GREEN ran, that a cycle completed, that any `tdd-result` block was emitted, or that anything whatsoever was verified. **The moment the skill is invoked, the evidence exists.**

Observed in this session: STE-447 was implemented directly and the commit was refused; the skill was then invoked, and only the AUDIT stage was run — because it is the only stage coherent against a finished FR. **The gate would have passed identically had the skill been loaded and nothing run at all.** AUDIT was run because it is independently valuable, not because the gate required it.

**Epistemic status, stated so nobody over-reads this.** The claim in the previous paragraph is **inferred from reading the hook source and observing this run** — the pass condition is a transcript grep, and nothing downstream of the invocation is consulted. It is **NOT** the result of a controlled experiment in which the skill was invoked and then nothing was done. That experiment was deliberately not run. The inference is strong but it is an inference.

**Half two, and the sharper one — the gate's prescribed cure is harmful.** The hook's own refusal text names its remedy: *"run /dev-process-toolkit:tdd before retrying this action."* Taken literally against an FR that is already complete and green, that remedy is destructive. The RED stage's contract is to write failing tests for every AC and confirm RED; against a finished implementation the only routes to red are (a) inventing requirements the ACs do not state, (b) reverting the implementation, or (c) weakening assertions in tests that already pass. It is failure mode (A) false-RED **by construction**, and (c) is the live hazard: in this session the RED stage would have been pointed at the file carrying the executed fence, the reachability anchor, the slice-sanity anchor and the throwing falsifiability witnesses. GREEN and REFACTOR inherit the same incoherence — there is nothing to turn green, and the refactorer's correctness gate is "tests still pass", which they already do.

**So the gate is trivially satisfiable AND its prescribed cure is harmful.** Those two together are the finding. A process gate whose evidence is a transcript mention is not measuring the process; it is measuring whether a particular string appeared, and any session that types the invocation satisfies it regardless of what happens afterwards.

**A framing to avoid, recorded because it was the first one reached for.** The tempting write-up is *"an FR completed to a higher standard by another route is blocked, while an FR that merely invoked the skill passes."* That asymmetry is real, but it is the **symptom**; the defect is that invocation alone is the evidence. Writing it the first way makes it sound like a scoping quibble about which routes count as TDD. It is not — it is that the gate cannot tell the difference between a completed cycle and a typed command.

**Why it was not overridden.** Bypassing with `--no-verify` was considered and declined. The argument for bypass — that the property the gate proxies for was not merely met but exceeded here (executed-fence tests, two mutations run against the real file, falsifiability proven in both directions) — is probably true, and is precisely the species of reasoning Core Principle 1 ("Deterministic gates override LLM judgment") exists to subordinate. Whether a genuine override belongs in this gate is a decision for the toolkit owner, not for an implementing session.

**Scope when this is picked up.** Two candidate directions, neither costed: bind the evidence to a completed cycle (a `tdd-result` block, or an orchestrator-written receipt) rather than to a tool_use record; and give the hook a coherent path for work that arrives finished — an audit-only mode whose remedy is the AUDIT stage rather than the full cycle, so the prescribed cure stops being destructive. Note the interaction: fixing only the first half makes the second worse, because a stricter evidence requirement forces more sessions down the harmful remedy.

### 0f. Five findings from the STE-449 roster audit — none of them in that FR's ACs

The audit was expected to produce findings and did. All four are recorded rather than absorbed; the first is the one with teeth.

**(a) Fixture group 4 has NO tracker-less coverage of a contract that is mostly tracker-agnostic — and STE-449 made that visible rather than fixing it.** Group 4's SUT is STE-227's `--no-tech` contract, whose four steps are: create a flagged FR, `/implement` refuses, re-run clears the flag, `/implement` proceeds to commit + archive + **ticket reaches `Done`**. Only step 4's last clause needs a tracker. But the group is *constituted* as exactly two sub-fixtures — 4a (Linear) and 4b (Jira) — so on the tracker-less leg there is nothing to run. Until STE-449 the roster still claimed the leg (via the `ALL_LEGS` alias), which **MEASURED at rc 1: the tracker-less leg reported `STE-227 runtime check: NOT-REACHED` and therefore could never report a fixture-group pass, no matter how well every other group ran.** The roster now says `["linear","jira"]` and the group renders `N/A` there, which is honest about what exists. **The gap it makes visible is real and unclosed: steps 1–3 are tracker-agnostic and are covered on no tracker-less leg.** Closing it means writing a sub-fixture 4c whose step 4 asserts commit + archive and *omits* the ticket clause. That is a new fixture, not a roster edit, so it belongs to a milestone willing to add one — note it is a THIRD instance of the same shape STE-450 and STE-451 already handle. Do not read group 4's `N/A` as coverage.

**(b) `/gate-check` probe #10's own description repeats the false reading STE-449 just corrected in `/setup`.** Its body states the backward-compat reading as *absent ⇒ branch automation disabled*. That is the same clause step 7c used to carry and it is false for the same reason: the STE-228 universal pre-commit gate has no tracker awareness and never reads Schema L, so it keeps running with the key absent. Only `/implement` § 0.b″'s proposal is genuinely gated. Out of STE-449's scope (its ACs name step 7c's two lines specifically), and probe #10's *behaviour* is unaffected — it greps the template file for the key and is right to. Only the explanatory parenthetical is wrong. Fix it in the same change that next touches that probe's prose.

**(c) `docs/layout-reference.md:108` lists `tracker` among the "mode-invariant Schema Q keys", contradicting `specs/technical-spec.md:260`.** The technical spec says the `tracker:` field is ABSENT in mode-none (STE-321 AC.3, code-wins), and the `identity_mode_conditional` probe enforces the technical-spec reading — so the layout reference is the wrong one and a reader following it would expect a key the gate rejects. Named as explicitly out of scope in STE-449's own `## Notes`; recorded here so it survives that FR's archival.

**(d) Sub-fixture 1b carries a two-leg cross-tracker assertion with no third-leg form.** Group 1 rosters every leg, correctly — its SUT is a byte-grep on the prompt body. But 1b's third assertion (STE-294 AC.4) reads *"Linear-side AND Jira-side both raised `RequiresInputRefusedError` … asymmetry between Linear-leg refusal and Jira-leg auto-apply is the regression shape this assertion fences."* That is a claim about a PAIR of legs embedded in a per-leg fixture, and it names two of the three. It is not wrong today — the symmetry it fences is real — but it neither covers the tracker-less leg nor says it does not. Same class as § 0c(a): a two-leg arithmetic left behind by the widening. Deciding whether the third leg joins that symmetry claim needs the FR's author, not a roster edit.

**(e) THREE more surfaces still carry the retired step-7c claims, and the scope line drawn between them is deliberate.** STE-449 corrected `skills/setup/SKILL.md` step 7c AND `docs/setup-tracker-mode.md` § Branch template — the latter because step 7c's closing line explicitly delegates the long form to it, so leaving it would have RELOCATED the contradiction into the file the skill points at rather than resolving it. **That was caught by an adversarial pass, not by the gate: the suite was green at 6781/0 with the falsehood intact two files away, because AC.2's assertions were scoped to one file.** The following three are separate documents about the key in general rather than step 7c's prose, so they are recorded rather than fixed:

- `docs/patterns.md:417` — "the single canonical default in every mode" (false in the *seeded* sense) and "Absent key ⇒ branch automation disabled" (false unqualified). Its neighbouring claim, that the KEY is consumed only by `/implement`, is TRUE and should survive any fix — the universal gate does not read the key, it takes a name from each skill's `branchNameFor(...)`. That distinction is the whole subtlety and a careless edit will lose it.
- `specs/technical-spec.md:220` — correctly scopes the disabling to `/implement`, so only its "in every mode" seeding clause is wrong. The smallest fix of the three.
- `templates/CLAUDE.md.template:183-184` — "the single seeded default in every mode". This one SHIPS to every consumer project, and it is pinned by gate probe #10 (which greps the template for `branch_template:`), so a fix must keep the literal key token present. Its adjacent line, "Absent `branch_template:` ⇒ `/implement` branch automation disabled", is already correctly scoped.

### 0g. `renderProbeSkipReason` has NO production caller — the routing half of AC-STE-450.4 is a directive, not a wire

**Measured during STE-450, and it changes what fixture group 9's sub-fixture 9c can honestly claim.** AC-STE-450.4 asks the group to assert that "gate probe #26's skip text routes through `renderProbeSkipReason`". It does not, and it cannot today.

- `runTrackerProjectMilestoneAttachedProbe` returns a bare `{ violations: [], advisories: [] }` on its `mode: none` path. It emits **no text at all** — there is no skip line for any renderer to have produced. The words "skip"/"skipped" appear in that module only in a header comment.
- `grep -rn renderProbeSkipReason` over the repository returns the definition, its own unit test, `skills/gate-check/SKILL.md`'s prose directive, and (since STE-450) `tests/m121-ste-450-fixture-group-9.test.ts`. **Zero `import`s from any probe module.** The helper is unreached at runtime; the module's own header said as much in 2026-05 and nothing has wired it since.
- Consequence for 9c: the FORBIDDEN-PHRASE half is fully enforced and falsifiable — the phrase exists in this repository only as a negative pin, so any occurrence in a capture is a fresh paraphrase and the assertion bites. The POSITIVE half ("the skip line agrees with the renderer") is **conditional by construction**: a model that ignores the directive emits no skip line, and a conditional assertion over an absent line is the vacuous shape M121 exists to hunt. 9c says so in its own prose rather than letting a green result imply otherwise.

**Why it was not fixed here.** Wiring the probe means changing `tracker_project_milestone_attached.ts`'s return contract to carry a skip reason, which ripples into its own tests and `/gate-check`'s reporting prose. No AC of STE-450 authorizes a change to that shipped surface, and `specs/plan/M121.md`'s blast-radius table lists `tracker_probe_skip_reason.ts` as *asserted against, modified only if the leak check fails* — the leak check did not fail. Recording beats absorbing.

**Scope when someone picks it up.** Give the probe report an optional `skip?: ProbeSkipReason` field, populate it on the four structural early-returns (`mode: none`, FR archived, no tracker block, plan file missing), and render it through the helper at the reporting boundary. Then 9c's positive half stops being conditional and the assertion can be tightened from "agrees if present" to "present and agrees" — which is the assertion AC-STE-450.4 was written expecting to be possible.

### 0h. Five findings the STE-450 adversarial sweep and end-of-FR audit turned up — none of them that FR's doing

Recorded rather than absorbed. All three predate STE-450 and none is in its ACs; each was verified by reading, not inferred.

**(a) `.claude/skills/smoke-test/SKILL.md` § Phase 2.X frames the whole phase as the M56 cohort.** The heading is `### Phase 2.X — M56 runtime regression fixtures (STE-220 / STE-221 / STE-222)` and the opening sentence is *"Three fixture groups verify that the M55 cohort's SKILL.md-prose fixes … actually fire at runtime"*. That was true at three groups and has been false since the M64 cohort added four more — so it has been wrong for six milestones, and it is the first thing a reader of the phase sees. The body already says the right thing further down (*"Phase 2.X is shared infrastructure for runtime regression coverage"*); the heading and lede never caught up. Fix them together with whichever FR next edits that heading.

**(b) The `NOT-REACHED` vs `N/A` teaching paragraph offers exactly one worked example, and there are now three reason classes.** It explains `N/A` solely through *"group 2 is Linear-only because probe #26 … is vacuous on Jira"*. Since STE-449, STE-450 and STE-451 there are FOUR distinct reasons a group can be n/a — vacuity (group 2), fixture constitution (group 4), inversion (group 9), and vacuity-with-a-named-substitute (group 10, where the artifact is never written on a tracker leg and the ticket transition carries the same property instead) — and the tracker-less leg now shows two n/a rows at once while the tracker legs show two and three. The module header in `smoke_fixture_groups.ts` has the same single-example shape; its *roster docstring* was widened by STE-450 and its file header was not. Neither is wrong, both are now unrepresentative.

**(c) `tests/m117-ste-425-falsifiable-coverage.test.ts` carries a comment that has been false since the FR that wrote it.** *"Groups 1, 2 and 3 state ONLY a PASS branch today"* — STE-425 itself is what gave those three groups their `NOT-REACHED` branches, so the sentence was stale on arrival. Harmless (it documents a test that asserts something else), but it is a comment describing the opposite of what the code beneath it does.

**(d) `tests/m117-ste-425-falsifiable-coverage.test.ts`'s per-group PASS/FAIL branch check greps the WHOLE SKILL, not the group's own slice.** It pulls each group's `sut` token out of that group's slice and then asserts `SKILL.includes(\`<sut> runtime check: PASS\`)` against the entire document. Pre-existing since STE-425 and now covering ten groups. It is the same wrong-scope positive-pin class STE-450 promoted into `docs/patterns.md` § Pattern 31: a group whose own footer loses its FAIL branch stays green as long as any other group anywhere in the file still spells the same token — which is reachable, because `sut` tokens are not enforced unique. Groups 9 and 10 happen to be covered by the slice-scoped pins in `m121-ste-450-fixture-group-9.test.ts` and `m121-ste-451-fixture-group-10.test.ts`; groups 1–8 are not. Fix by scoping the `includes` to `slices.get(spec.group)`.

**(e) AC-STE-450.4's authored premise is unsatisfiable, and STE-451 must not inherit the phrasing.** "The group asserts that probe #26's skip text routes through `renderProbeSkipReason`" cannot be satisfied without changing `tracker_project_milestone_attached.ts`'s return contract (§ 0g). STE-450 ships it Partial with the reason recorded. Whoever writes fixture group 10 should check that its ACs do not describe a routing, emission or reporting behaviour that no code performs — the failure here was in the AC, not in the implementation, and it was only caught because the implementation was attempted honestly.

**Method note, because it is the reusable part.** All three were found by a pass whose brief was to *refute* a completed change, not to review it — specifically by asking "what present-tense claim did adding a ninth group make false?" and then classifying every hit as DATED HISTORY or PRESENT-TENSE CLAIM rather than fixing on sight. The classification step is what kept the sweep from rewriting legitimate history like *"before STE-449 seven of the eight rosters were `ALL_LEGS`"*, which reads identically to a stale claim and must not be touched.

### 0i. A SHIPPED GUARD WAS SILENTLY DISARMED BY AN UNRELATED EDIT, and the whole suite stayed green

**Measured during STE-451, in both directions, and it is the sharpest instance of the milestone's own thesis so far — because the guard did not go red, it went ELSEWHERE.**

`tests/m121-ste-448-mode-none-leg.test.ts` § "a named-phrasing tripwire for the row growing a presence claim" guards § Phase 4's tracker-less release-proof row against quietly acquiring a lock-presence claim. It takes its window as `smokeDoc.indexOf("AC-STE-448.9")` plus 2400 characters. **That anchor is a plain substring, and it is not unique.**

STE-451's fixture-group-10 block sits in Phase 2.X — *above* Phase 4 — and its first draft named the row it complements by AC token, as ordinary cross-referencing prose. Measured immediately:

- Before: first occurrence at **line 1429**, the real row; window contains the row's own text (`"the release proof"` → `True`).
- After one unrelated mention: first occurrence at **line 1316**, inside the new block; `"the release proof" in window` → **`False`**. The guard was now scanning the new block and **no longer reached the row it exists to protect**.
- **The 448 suite stayed at 42 pass / 0 fail through both states.** Nothing anywhere reported that a guard had been moved off its subject.

Repaired by rewording the new prose (Pattern 31's house remedy — never weaken the pin), and the block now carries an explicit warning against naming that AC token above Phase 4. Both states were re-measured after the repair: anchor back at 1431, window reaches the row, suite still 42/0.

**Why this is a distinct failure class and deserves its own entry.** STE-449's correction #20 was a slice anchor returning `-1`, where `slice(-1)` yielded one character and a length check passed — a guard that proved nothing. This one is worse in a specific way: `indexOf` returned a **valid** index to the **wrong** text, so the guard kept running, kept passing, and kept looking like coverage. A `-1` at least has a canonical smell. **A slice-anchored pin has no idea what it is holding.**

**The general fix, and it generalizes past this one test.** Any pin that slices a document by `indexOf(<token>)` needs a **non-vacuity assertion that the slice actually contains the thing it guards** — here, `expect(row).toContain("the release proof")` before the ban runs. That single line converts a silent relocation into a loud failure. Worth sweeping for: `grep -n 'indexOf(' tests/*.ts` finds the candidates, and the smoke driver and `/conformance-loop` are both large enough documents that token collisions are a matter of time rather than luck.

**AMENDED, because the remedy above is INCOMPLETE and STE-451 proved it in the same session.** A second shipped guard in the same test file was disarmed by a different mechanism that this entry's fix does not address. `tests/m121-ste-448-mode-none-leg.test.ts` also carried `expect(smokeDoc!).toMatch(/STE-451/)` — a **document-wide** pin, no slicing involved, which was a genuine guard only because the token had **exactly one satisfier**: the Phase 4 row naming its successor. STE-451 wrote that literal a second time, in a Phase 2 step-3 paragraph, and the arm stopped seeing its subject. Measured: stripping the token from the row alone then left the file **42 pass / 0 fail**.

So the general shape is broader than "slice anchors need a non-vacuity assertion". It is: **a pin over a token that occurs once becomes vacuous the moment new prose spells that token a second time anywhere in the document** — and unlike the anchor case there is no `indexOf` to inspect, so a reader auditing for this class finds nothing to look at. Both arms are now scoped to the row and both repairs were verified by the *distinguishing* mutation (strip the token from the row while it survives elsewhere), which is green under the old form and RED under the new.

**Sweep worth doing, and it is bigger than the `indexOf` one.** Any `expect(<wholeDoc>).toMatch(/<token>/)` over a large document is a candidate; the ones that matter are those whose token currently occurs once. `grep -n 'toMatch(/STE-' tests/*.ts` and `grep -n 'toContain("STE-' tests/*.ts` enumerate them. The cheap repair is the same in both classes — scope the assertion to the region that must carry the token, and assert the region is the right one before asserting anything about its contents.

Both live instances are closed. What is unfixed is the class: neither sweep has been run repo-wide.

### 0j. `LocalProvider.claimLock` has NO production caller — what fixture group 10 can and cannot claim

**Verified independently during STE-451, not inherited: `grep` over `plugins/dev-process-toolkit/**/*.ts` excluding `*.test.ts` returns zero imports of `local_provider` and zero `.claimLock(` call sites.**

The entire wire from `/implement` to the lock write is one sentence — `skills/implement/SKILL.md:46`, step 0.c: *"`mode: none`: `LocalProvider.claimLock` writes `.dpt/locks/<id>`."*

**This is NOT the § 0g shape and must not be filed alongside it.** `renderProbeSkipReason` is structurally unreachable — probe #26 emits no text for it to render, so no amount of model compliance could satisfy the AC that named it. `claimLock` is fully implemented, unit-tested, and reachable; a model that follows the directive produces exactly the artifact group 10 observes. Prose-directive-as-wire is also the toolkit's normal architecture, so "no production caller" is not by itself a defect here.

**What IS worth recording is an asymmetry inside that one bullet.** Its sibling steps name an invocation form — 0.b′ *"Call `buildResolverConfig(...)` from `adapters/_shared/src/resolver_config.ts`"*, 0.b″ *"call `isCurrentBranchAcceptable(...)` from `adapters/_shared/src/branch_proposal.ts`"*. Step 0.c's tracker half points at a runbook document. Its `mode: none` half names **no file path and no call form** — it states a fact about what a class does rather than instructing anyone to run it. Whether a `claude -p` child improvises the right invocation from that sentence is an empirical question, and **nothing in the repository measures it today.**

**That is precisely why fixture group 10 is a test and not a restatement**, and it is the honest reading of a group-10 RED at runtime: the first hypothesis is not "the lock code broke" but "step 0.c's mode-none half was never actionable enough to be followed". Both are real findings; they have different remedies.

**Scope when someone picks it up.** Give 0.c's mode-none half the same shape as its siblings — name the module path and the call — so the directive is followable rather than merely true. That is a one-sentence change to a shipped skill, which no AC of STE-451 authorizes, and it should be made only alongside a run that can measure the before/after.

### 0k. Findings from the STE-453 coverage sweep — none of them that FR's doing

**The sweep was the FR's own prescribed check** (`specs/frs/STE-453.md` § Testing: *"a reader can no longer find a coverage claim in the skill that is not backed by an executing test … checkable by enumerating the skill's coverage claims and pairing each with its test"*). It ran over all 999 lines of `.claude/skills/conformance-loop/SKILL.md` and every `conformance-loop-*.test.ts`. Ten claims are backed by nothing; four assertions are satisfied by prose that says the opposite of what they check. STE-453's ACs reach five of these; the rest are recorded rather than absorbed.

Every entry names the **RED-producing input that does NOT work** — the edit that should turn the assertion red and does not. That is the falsifiable form; "looks weak" is not.

**(a) — CLOSED by STE-453 AC.6. The `max-iterations` termination probe failed OPEN on a non-integer cap.** Retained rather than deleted because the "before" measurement is the only executed record of what the defect did, and the FR's notes cite it.

Executed, not inferred: `ITER=3 MAX_ITERATIONS=""` → `bash: [: : integer expression expected`, `STATUS` unset, **rc 0, and the loop continues**. Same for `abc`. It was the last surviving instance in this driver of the accidental `test(1)`-usage-error class STE-452 AC.5 wrote out of the `green` probe, and it sat on the loop's **only spending control**, so under `--auto-fix` each extra iteration spawns `/spec-write` + `/implement` fixers that commit.

**It was first recorded here as out of scope — correctly on process, wrongly on consequence — and the operator then widened the scope rather than accept the note.** The deciding argument: a malformed cap means an unbounded loop that keeps committing, which is a worse consequence than any finding this milestone did fix, so shipping it as a note in a release headlined "we eliminated the fail-opens" would be indefensible. `AC-STE-453.6` was added by its own `docs(specs)` commit ahead of the fix, on the AC-STE-446.6 mechanism.

**What shipped:** the established in-file `case "${VAR}" in ''|*[!0-9]*)` shape — the same guard the rc-collection gate and the `green` probe already carried — refusing with a named message and `exit 1` **before** the iteration proceeds. Valid caps are byte-identically unaffected, asserted by a regression floor that re-executes every valid pair; a mutation making the guard reject everything turns that floor RED, which is the overshoot check.

**The deferral's own tripwire worked.** The test written while deferring asserted the `test(1)` *diagnostic was emitted*, specifically so a later fix would redden rather than let the hole sit behind a green assertion. It reddened one turn later, against the session that wrote it.

**Reachability caveat, retained because it bounds the claim:** `MAX_ITERATIONS` is parsed from prose by a model, not by shell, so an empty value needs an operator typo surviving that parse — weaker than the RC-file case, which a shell redirect produced. The fence's obligation is fail-closed-on-bad-input regardless.

**(b) `conformance-loop-args.test.ts:36` survives deleting all six flag bullets.** The `## Argument parsing` slice contains the unknown-flag **remedy line**, which lists every flag, so the six `toContain` calls are donated by the refusal rather than by the documentation they name. **Does NOT redden:** delete the six `- \`--flag\`` bullets outright. The fix is a per-bullet line-scoped pin; it touches a shipped predecessor's enforcement for no current AC's benefit.

**(c) The `--linear-team` and `--max-iterations` default-value pins cannot detect a changed default.** `:79-82` matches `/--linear-team[\s\S]{0,200}STE/` and has **five** donors (the argument-hint at :4, :27 twice, the remedy at :35, plus any `STE-<N>` token within 200 characters); `:74-77` has the same shape for `default 3`. **Does NOT redden:** rewrite `Default \`STE\`` to `Default \`FOO\``, or `default 3` to `default 5`. Contrast `:70` (`--auto-fix` default OFF), which has one satisfier and does bite — the difference is a token that happens to be this repo's team prefix.

**(d) `conformance-loop-permissions-pre-flight.test.ts:108-115` are two bans with no positive twin.** The apparent twin at `:104` anchors on `Path-safety`, which resolves ~345 lines from the section it names. **Does NOT redden:** truncate the document at `## Threat model` and delete everything after it. Textbook Pattern 31 rider 1 — a ban is satisfied by deleting the subject.

**(e) `conformance-loop-permissions-pre-flight.test.ts:67`'s alternation binds looser than it reads.** `/Remedy:[\s\S]{0,400}allow-list|allowlist|permissions\.allow/i` — `|` binds loosest, so the second and third branches match a bare token **anywhere in the document**, with no `Remedy:` required. **Does NOT redden:** delete every `Remedy:` line in the skill. Same file `:49-51` computes `Math.max(indexOf("Phase 0"), indexOf("Pre-flight")) > -1` over strings occurring 17 and 4 times, testing neither containment nor position.

**(f) `conformance-loop-spawn-pattern-pre-flight.test.ts:78-87` is satisfied by the English word "contains".** And `:72`'s `toContain("Bash(claude:*)")` has seven satisfiers, two of them unrelated `# STE-350:` comments. **Does NOT redden:** delete the operative probe-shape sentence. Note before fixing: `:89-100` is satisfied by the STE-252 empty-array refusal it exists to strengthen past, and that refusal belongs to shipped AC-STE-351.1 — the repair is that FR's surface, not a drive-by.

**(g) `conformance-loop-termination.test.ts` carries two two-leg residues.** Its green-exit test checks `HIGH_LINEAR` and `HIGH_JIRA` and **never `HIGH_NONE`**, so deleting the tracker-less leg's arm from the conjunction leaves it green (STE-452's executed harness does catch this, which is why it is low severity rather than none). And `:71-81`'s ordering test slices to EOF where its sibling at `:20-30` bounds at the section, so it resolves against `## Output` rather than § Termination. **Does NOT redden:** strip the backticks from `` `no-progress` `` inside § Termination only.

**(h) `conformance-loop-aggregator.test.ts:41`'s `/Fail-fast/i` has seven donors**, one of them a Phase B `NEW_TRACKER_ID` guard unrelated to Phase A. **Does NOT redden:** delete the Phase A fail-fast paragraph.

**(i) Five UNBACKED claims in the driver, one of them an EXECUTABLE fence with no test of any kind.** The § Per-leg abort teardown fence — which decides what is `rm -rf`'d on every abort path — is asserted by nothing: `grep -rn "SPAWNED_LEGS" tests/ adapters/` returns zero. **This is a different class from the prose-only surfaces** STE-453 labelled: those have no runnable form, this one is runnable and simply untested. The others: the `Bound?` table's "stripping every per-leg `.log` reference reds zero surfaces" claim; the `SEL`-not-`LEG` rule that keeps the pidfile surface from being hijacked; the verify line `grep -c 'conformance_loop_terminated_' >= 3`, which **no probe runs** (`plan_verify_line_validity.ts` excludes `specs/plan/archive/**`); and the PID-reuse paragraph's "the leg-completeness check is the corroborating signal".

**(j) The refusal counts contradict each other.** `## Pre-flight refusals` says "**Nine refusals total** … emitting **eleven distinct canonical messages**"; the machine-checked figure 197 lines later says **twelve** anchors and enumerates twelve. That parenthetical's own numbers are stale too — it says "reports 14, not 11" (the contrast is against 12) and "three more times" (measured: 15 document-wide occurrences across 14 lines, so the line carries two extra, not three). The derived pin at `m121-ste-447-legs-selector.test.ts` recomputes only the twelve; nothing reaches the other three numbers.

**(k) The § Aggregation per-leg findings-file bullet list is hand-maintained and bound by nothing — and it now sits directly beside a list that IS bound.** STE-453 bound the report template's `**Source files:**` list to `SMOKE_LEGS` via `reportShapeLegs`. The § Aggregation bullet list a few lines above it enumerates the same three paths and is bound by no surface: `green-probe-findings-files` deliberately scopes to the `green` fence, and `leg_prose_surfaces.ts` documents why. **Does NOT redden:** delete the `none` bullet from § Aggregation. Two neighbouring enumerations of the same set with different failure behaviour is precisely the "do not add a leg to one surface only" hazard the skill's own § leg-set paragraph opens with. Recorded rather than fixed because binding it is a new derivation surface, which is `LEG_PROSE_SURFACES`' contract rather than STE-453's; the skill's Bound? table now carries the row and says which side is which.

**(l) Two of STE-453's own new pins are weaker than they read, and both are recorded rather than polished.** `conformance-loop-args.test.ts`'s negative arm bans only the literal `mocks the subprocess`, so a reworded vaporware claim ("substitutes the subprocess spawn with canned output") escapes it — the positive arm beside it is what actually holds AC-STE-453.1, and it was measured to bite. And the coverage ledger's "every cited test file EXECUTES something" check is a textual `toContain("Bun.spawnSync")`, satisfiable by a comment that merely mentions the string. Both citees genuinely spawn today (six sites and one), so it is non-vacuous now; it would stop being so the day someone cites a file that only talks about spawning. Recorded because a pin that is *currently* honest by luck is worth naming before it stops being.

**(m) TOOLING — "assert the mutation applied" is NOT enough; it must be asserted to apply AT THE INTENDED SITE.** § 0b's rule catches a mutation that changes nothing. It does not catch a mutation that changes *the wrong thing*, and STE-453 hit that three times in one run. Three probes against the new `MAX_ITERATIONS` guard used a first-occurrence `replace(find, repl, 1)` for the anchors `in ''|*[!0-9]*)` and `exit 1`. **Both strings occur EARLIER in the document** — in the rc-collection gate and the `green` probe — so all three silently mutated a different guard, the byte-change check passed, and all three reported **GREEN**. Read naively that is "three surviving mutations", i.e. a vacuous new test block; the truth was a vacuous *probe*. Re-anchored to the fence region and re-run, the same three came back **2, 6 and 3 RED**. The fix is mechanical: slice the region first, mutate inside it, and abort when the anchor is absent *from that region* rather than from the document. **A first-occurrence anchor in a 999-line document whose guards deliberately share one house shape is a trap by construction** — the more consistent the codebase's idiom, the more likely a mutation lands on the wrong instance of it.

**Method note, because it is the reusable part.** Every entry above was produced by re-implementing the assertions as predicates over the document text and applying named mutations, rather than by reading them and judging. Four of the findings were invisible to reading — they look like ordinary pins — and **four were in assertions STE-453 itself had just written**: two caught by the mutation battery (a borrowed-window label pin, a section-wide `toContain` donated by a sibling bullet) and two more by the AUDIT stage afterwards (a ban whose exemption was line-wide rather than clause-wide, and an inverse check that iterated an empty list for two of its three regions). **The battery did not catch the audit's two, and the audit did not catch the battery's two.** They are not substitutes, and this FR is the fourth consecutive measurement of that in M121.

### 0l. STRUCTURAL — a history-asserting test is verified one commit LATE, by construction

**Not a defect in any FR. A property of this repository's test suite that the next person to write such a test should meet before it bites them, as it bit STE-458.**

A test whose subject is git history — "the authorizing commit precedes the code", "this file's commits are all `docs(specs)`", "the archive commit carries a flipped frontmatter" — **cannot be verified by a gate run that precedes the commit under test.** Its input is the history, and the commit being judged is the thing that changes the history. So:

- The gate is green at the moment the commit is proposed.
- The commit lands.
- The test's input is now different, and the answer may be different too.
- **The green reported at that gate was true of a tree that no longer existed the instant the commit landed.**

Measured, not theorised. STE-458's `AC-STE-458.1` asserted that every commit touching `specs/frs/STE-458.md` is `docs(specs)`-typed. The suite was green when the implementation commit was proposed. That commit carried the FR's `## Implementation notes`, so a `fix(tests):` commit touched the FR — and the assertion went RED **after** landing. It was found only because an unrelated edit prompted a re-run; nothing in the flow would otherwise have looked again.

**Consequences, and they are not fixable by trying harder.**

1. **The first honest run of a history-asserting test is the NEXT gate, never the one that approves its commit.** This is the one class in this repository where "verify by execution before deciding" is structurally impossible — the execution cannot happen before the decision, because the decision creates the input.
2. **A gate report that predates the commit cannot vouch for these tests.** It can vouch for everything else in the same run. Report them as unverified-at-this-gate rather than folding them into a single green number that implies otherwise.
3. **Re-run the gate immediately AFTER any commit that touches a path a history test watches** — the FR file itself, the module, the test file. Cheap, and it converts a latent red into an immediate one.
4. Prefer asserting the ORDERING property (authorized-before-code) over a proxy for it (every commit is a given type). The proxy over-constrains, and over-constraint is what turns a legitimate commit shape into a false red. STE-458's assertion was narrowed for exactly this reason and its narrowing was mutation-verified in both directions.

**The general shape, which is worth more than the instance.** Falsifiability discipline proves an assertion CAN fail. It does not prove the assertion is ABOUT THE RIGHT THING, and it does not prove the assertion is CHECKABLE AT THE MOMENT YOU RELY ON IT. Those are three separate properties and this repository has now been bitten by all three.

### 1. Cross-commit atomicity is NOT enforced — AC-STE-446.7 ships with one arm

**This is a known, deliberate absence. Do not read the green suite as covering it.**

AC-STE-446.7 requires that widening `SMOKE_LEGS` and re-pointing the fixture-group rosters land in the **same commit**, because a split leaves an intermediate revision where a leg is registered by the enum and rostered by no group — the STE-445 guard fires and every `--leg <newleg>` invocation is refused.

What ships is the **working-tree invariant arm only**: the finished tree declares all three legs, carries no second copy of the leg list, and `groupsCoveringLeg` returns a non-empty set for the new leg. That arm is falsifiable on every run and catches the end state.

A second arm — a git-history walk over the branch — was written and then **deleted rather than shipped**, on two independent grounds:

1. **Permanently vacuous post-merge.** Its range was `merge-base(HEAD, main)..HEAD`. On main that collapses to `HEAD..HEAD`, so the walk passes over an empty set forever. M121 exists to eliminate assertions that cannot fail; shipping one as part of its own implementation would be self-refuting.
2. **Identifier proxy, defeatable by a rename-first split.** The predicate required the old alias to be textually present. A split that first renames the alias while keeping the enum two-member, then widens in a later commit, leaves a broken intermediate the walk cannot see.

A vacuous test is worse than no test — no test is an honest absence, a vacuous one is a false presence that reads as coverage.

**Proposed scope for whoever picks this up**, both halves needed:

- **Walk the milestone's commit set, not a collapsing range.** Derive the revisions from the shas touching `specs/plan/M121.md`, or from a recorded kickoff..ship range in the plan frontmatter — something that does not evaluate to empty once the branch merges into the ref it compares against.
- **Key the predicate on roster coverage, not on an identifier.** For each revision, assert every leg declared by that revision's enum is rostered by at least one group in that same revision. That is what the AC actually means by "the rosters ceasing to read the hardcoded literal", and it is immune to a rename.

Worth checking whether this generalizes: any invariant of the form "these two edits must be in one commit" has the same shape, and a reusable milestone-scoped history walker would serve them all.

## From the M121 design session (2026-08-07)

### 1. The runtime leg registry — deferred from M121

M121 makes `SMOKE_LEGS` the sole leg-set authority and binds five skill-prose
surfaces to it via derivation meta-tests, but the two project-local driver skills
keep **N literal brace groups** in their spawn fences. Adding a fifth leg would
still mean editing prose in two files.

The eventual shape is a **runtime leg registry**: one entry per leg carrying its
id, MCP family, required flags, spawn argv and pre-flight set, materialized into
the shell so the spawn block becomes a single loop regardless of N.

**Why it was deferred rather than built.** The registry introduces a failure mode
M121 does not otherwise have: if the registry CLI dies or emits an empty list,
**zero legs spawn and the run reports green** — no findings files, no
high-severity lines, `STATUS=green`. Trading a coverage gap for a vacuity gap is
not progress, and a fail-closed guard for it needs its own falsifiable tests,
which would have displaced the tracker-less coverage work that is M121's actual
purpose.

**Scope when it is picked up.** The zero-legs-spawned vacuous-green guard is part
of this item's scope, not an afterthought. Note that M121's `--legs` selector
already introduces operator-controlled emptiness and STE-447 guards *that* path;
the registry adds a second route to the same hazard (a registry that resolves to
nothing without any operator input), and it needs its own guard on the same
fail-closed principle.

**Inherited analysis — do not re-derive.** Measured 2026-08-07 against v2.60.0:
widening `SMOKE_LEGS` with a synthetic fourth leg left the full gate at
`6605 pass / 15 skip / 0 fail`, byte-identical to baseline — zero tests red.
`grep -rln "SMOKE_LEGS\|SmokeLeg" tests/ adapters/` returned only the defining
module. The enum was an exported authority imported by nothing.

### 2. Sweep for other unanchored-prefix assertions over generated strings

`tests/m117-ste-425-falsifiable-coverage.test.ts:867` asserted
`toMatch(/--leg must be one of linear \| jira/)` against a string built by
`SMOKE_LEGS.join(" | ")`. Unanchored, so the enum could grow without bound and
the assertion never noticed — it would catch only a shrink or a reorder of the
first two members. STE-445 fixes that instance.

A second instance was found in the same session:
`tests/m98-ste-366-zsh-glob-fences.test.ts:261` whitelisted
`/^for \w+ in linear jira\b/`, which matches a widened `for LEG in linear jira none`
by prefix. Benign in effect — it whitelists fixed-loop shapes and a widened fixed
loop is still one — but it accepts a change it never reviewed. **CLOSED by
STE-447 (AC.9).** It is now built from `SMOKE_LEGS` and anchored at both ends.

**One lesson from closing it, because it generalizes to the whole class.**
Anchoring ALONE would have traded a false accept for a silent vacancy: the
whitelist is consulted only for lines it matches, so a drifted loop simply
stops matching and the negative control asserts nothing about it — green, and
quieter than before. The anchored pattern therefore ships paired with a
non-vacuity test that fails when it stops resolving against the driver's real
loop. **Anyone sweeping the rest of this class should budget for that pair, not
for a one-line regex edit** — an anchor without a resolution check converts a
false-accept bug into a can't-fail bug, which is worse.

**The class is what needs sweeping, not these two instances.** Any assertion that
prefix-matches a string assembled from a collection will silently tolerate that
collection growing. Worth a targeted pass over the test suite for
`toMatch(/…/)` against `.join(`-built values.

### 3. `docs/layout-reference.md` contradicts `technical-spec.md` on tracker-key invariance

`plugins/dev-process-toolkit/docs/layout-reference.md:108` lists `tracker` among
the **mode-invariant** Schema Q keys. `specs/technical-spec.md:260` and the
gate-check skill both say the opposite — the key is mode-conditional, present in
tracker mode and forbidden under `mode: none`. Gate probe #13 enforces the
technical-spec reading, so the code is not ambiguous; the doc is simply wrong.

Surfaced during the M121 design survey and deliberately kept out of M121's scope
so it would not block the design. It is a one-line doc fix, but it should be made
deliberately rather than folded into an unrelated milestone.

---

## From the M116 + M117 post-release review (v2.57.1, 2026-07-28)

### 1. The `/spec-write` driver answers block has no `requirement` key

**Only a live `/smoke-test` leg can settle this. Do not guess at it.** A wrong
guess silently changes what the driver answers, which is worse than the gap.

The evidence, all re-measured on 2026-07-28:

- `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` § "Milestone-allocation
  gate" enumerates the § 1–§ 6 FR-content prompts as nine: **Summary, Requirement,
  Acceptance Criteria, Technical Design, Testing, cross-cutting scope, out-of-scope,
  NFRs, risks.** `resolveInterviewAnswer(promptBody, key)` is called once per
  question, *keyed by that question's own answer key*.
- The smoke driver bakes **21** keys across its two `<dpt:answers>v1` blocks
  (`.claude/skills/smoke-test/SKILL.md`). Eight of the nine prompts have an
  obvious key. **`Requirement` has none** — there is no `requirement` key, and
  no key whose name plausibly stands in for it.
- Nothing catches it. The drift pin at
  `plugins/dev-process-toolkit/tests/m116-ste-418-wiring.test.ts:719` runs
  **driver → doc**: every key the driver bakes must be named in the doc. A
  documented prompt with *no* driver key is invisible to it, by construction.

It **might** be benign: if `Requirement` folds into `feature_summary` at runtime,
nothing is missing. But the prompt-to-key vocabulary is **defined nowhere** — no
module maps prompt names to answer keys, so neither reading can be settled from
the tree. If it is not benign, a headless `/spec-write` refuses at the Requirement
question and the chain truncates at step 2 again — the exact failure M116 exists
to close.

**What the next conformance run should look for.** In the `/spec-write` child's
capture: whether a Requirement question is posed at all, and if so whether it
resolves `pre-baked` (benign — some key answered it) or raises
`RequiresInputRefusedError` at gate site `requirement` (not benign — add the key
and the doc entry together, so the drift pin covers it). Either outcome should
then be written into the doc as the prompt-to-key map that does not currently
exist, which closes this item and the whole class with it.

### 2. The PR-body half of a disclosure has no gate

v2.57.1 added the AC-STE-418.4 deferral to the CHANGELOG, where
`tests/m116-ste-418-deferral-disclosure.test.ts` now pins it. The same gap
existed in the PR #54 body's "Recorded limitations" section and was fixed by
hand. Nothing in this repo can assert against a GitHub PR body, so that half is
protected by nothing. Recorded rather than solved: the CHANGELOG is the durable
record and it is now gated; the PR body is a review-time artifact. If PR bodies
start carrying claims the CHANGELOG does not, this becomes worth fixing.

## From M117 — Smoke-Driver Hygiene (2026-07-28)

### 1. Phase 8 `/report-issue` coverage still depends on classifier variance — `STE-431`

**Tracked:** `STE-431` (Backlog, team STE, project "DPT — Dev Process Toolkit").
This is the only item here with a ticket; the rest are recorded but unscheduled.

AC-STE-428.4 shipped a `--dry-run` flag, which works and publishes nothing
outward. Its trailing purpose clause — "so coverage does not depend on classifier
variance" — is not delivered: a `--dry-run` spawn is exactly as deniable as the
spawn denied on 2026-07-27. The flag makes intent legible at the classification
boundary; nothing forces an allow. Full reasoning, including why the standing-
authorization alternative was declined, is in `STE-431` and in
`specs/frs/archive/STE-428.md` § Notes.

### 2. `templates/permissions.json` still ships inert exact rules

`/setup` derives a bootstrapped project's allow-list from
`templates/permissions.json` via `canonicalAllowList` — **not** from
`templates/settings.json`, which M117 fixed and which has no runtime consumer at
all (its only reader in the tree is the M117 test written to assert it).

`templates/permissions.json` deliberately ships exact rules (`Bash(git commit)`,
`Bash(git status)`) per an earlier self-modification finding. Under the matcher
model M117 pinned, a rule without a `:*` suffix matches only the literal string,
so **those entries grant nothing** and every `git` command in a
`/setup`-bootstrapped consumer project falls through to whatever the ambient
permission mode decides. That is the same defect M117 fixed in the smoke
scaffold, still live on the path that reaches real users.

Covered by no AC in M117. Note the interaction before fixing: wherever the
inherited default permission mode is `auto`, the classifier decides each call
regardless, so correcting these entries fixes a *policy artifact* rather than
guaranteeing a runtime fence. Both statements are true and they bound each other.

### 3. `phaseASlice` truncates at a fenced heading in 4 of 7 test files

`harness-driver-abort-reap-parity.test.ts`,
`m112-ste-414-nontty-hard-gate.test.ts`,
`m98-ste-365-fire-and-exit-guard.test.ts` and
`smoke-driver-m96-wait-discipline.test.ts` each define
`phaseASlice = sectionSlice(body, "### Phase A — …", "## Findings")` with a
non-fence-aware `indexOf`. The only occurrence of `## Findings` in
`.claude/skills/conformance-loop/SKILL.md` is **inside a fenced report
template**, so those four slices stop early and exclude the tail of Phase A —
including the transient-retry contract M117 added there.

The three remaining definitions end at `"### Phase B"` and do include it.
Consequence: a future parity test written against the shared helper would pass
vacuously over the region it was written to check. M117's own tests are immune
(they use a fence-aware `headingSections`), which is why this is latent rather
than failing.

### 4. `parseArgs` duplicated byte-for-byte in two CLI shims

`adapters/_shared/src/smoke_verdict.ts` and
`adapters/_shared/src/smoke_fixture_groups.ts` carry semantically identical
copies — the only two in the tree.

**Deliberately not extracted, and the reasoning should be respected rather than
re-litigated at two copies:** a new shared module in this repo is not free. It
acquires the per-module meta-test surface (the STE-token ceiling, the
dot-anchored path-drift pin) and adds an import hop to files whose whole purpose
is that a driver SKILL can run `bun <one-file>.ts` from a bash fence. Extract
when a **third** `import.meta.main` shim wants it.

### 5. ~20 pre-existing `tsc` errors block any typecheck gate step

`bunx tsc --noEmit` over `adapters/_shared/src/**` + `tests/**` surfaces roughly
twenty errors in modules unrelated to M117 — a cast in `tracker_config.ts`,
null-narrowing in `tracker_tolerance.ts`, a TS5097 in a bundled hook, plus
several test-file overload and `delete` errors.

Consequence, and the reason this matters more than it looks: the gate is
`bun test` with **no typecheck step**, so a type break surfaces only at review
time. M117 added a required field to an exported interface
(`ReconcileItem.side`) and had to verify by hand that no other constructor
exists. Cleaning these up is the precondition for adding a typecheck step, which
is what would make that class of change safe by construction.

### 6. Pre-flight #10 refuses a whole run over a non-operative gate — judgment call

`/smoke-test` pre-flight #10 (and its `/conformance-loop` mirror, refusal (f))
hard-refuses a run when `Bash(claude:*)` is absent from the tracked allow-list.
M117 established by measurement that wherever the inherited default permission
mode is `auto` — the environment the driver actually runs in, since every spawn
exports `CLAUDE_CONFIG_DIR=~/.claude-st` — the classifier decides spawns and the
allow-list's contents guarantee nothing at runtime.

The probe was **kept and re-justified** on two surviving merits: it holds the
scaffold in sync with the tracked list, and the allow-list *is* the operative
gate in any checkout that has not opted into `auto`. Both are real. But the first
is already enforced fail-closed by gate-check probe #62, and the second is
hypothetical for this driver. So a *run-refusing* gate may be stronger than the
remaining justification supports. Not a defect — a deliberate call worth
revisiting with fresh eyes rather than inheriting silently.

---

## Carried forward from M116 — Headless Conformance Unblock (2026-07-27)

Recovered from the archived FRs' `## Implementation notes` and from review of the
shipped modules. M116 did not record these as a single list, so this section is a
reconstruction — treat it as such, and prefer the archived FRs as the primary
source where they disagree.

### 7. `capability_row_assert.ts` scores a MISSING capture as an empty one

The CLI shim reads
`const ndjson = (await file.exists()) ? await file.text() : ""`, so a capture
that **never existed** is scored identically to one that exists and is empty.

This matters because several smoke fixtures are **absence-only** assertions
(fixture 1b, fixture 5b): under `absent`, a spawn that produced no log at all
scores PASS. That is the same can't-fail class STE-421 was written to close —
relocated rather than eliminated.

The module's own comment defends it deliberately ("a missing capture is a real
smoke signal, not a crash… chain-integrity detection is `assertChainIntegrity`'s
job, not this runner's"), and that division of labour is defensible — **but only
if every absence assertion is paired with a chain-integrity check on the same
path.** Nothing currently enforces that pairing. Either enforce it, or have the
runner distinguish missing from empty and let the caller decide.

### 8. AC-STE-418.4 shipped deferred

The recorded six-capture replay through `assertChainIntegrity` landed in both
directions, but the live `/smoke-test` leg was not run in the implementation
session. Retroactive validation was deferred to the next conformance run — which
has not happened yet, and M117 did not run one either.

### 9. Three FRs undercounted their own defect

M116's FRs named "eight raw-grep sites" (nine existed), "four occurrences" of an
unscoped pidfile glob (five literals across four lines), and a self-check that
"already computes both abort triggers" (it computed one).

Not actionable on its own. Recorded because it is a **pattern**, and it repeated
in M117: STE-426 called all ten scaffold entries glob-shaped when nine were, and
STE-430 attributed a denial to heredoc parsing when the real cause was an inert
exact rule. The lesson worth carrying: an FR's own count of its defect is a
hypothesis, and implementation should re-measure it before building on it.

### 10. `specs/frs/archive/STE-417.md` was edited under a spec-authorized exception

AC-STE-424.5 required editing an already-archived FR, which the archive-frozen
convention normally forbids. The AC named the file and line explicitly, so it was
treated as authorized. Recorded so a future reader who finds an archived file
with a post-archival edit has the reason rather than a mystery.
