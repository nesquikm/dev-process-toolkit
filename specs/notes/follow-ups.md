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

## From M137 — PR #76 adversarial review (2026-09-01)

### 1. The CHANGELOG's release test count still drifts after the release commit is written

**Measured, on this branch.** Against `f504493` (`chore(release): v2.75.0`):

| what | value |
| --- | --- |
| commits landed after the release commit | 7 commits |
| test files changed after the release commit | 11 test files |
| count stated in the v2.75.0 entry | 10708 |
| count the gate reported when the review measured it | 10950 |

The stated 10708 was HONEST when written. It was made wrong afterwards, by the seven commits that landed past the release commit — which is why "check the number at write time" is only half a guard. Two boundaries, not one:

- **The write boundary** — the number is wrong the moment `/ship-milestone` writes it. Closed by `checkWriteBoundary` in `adapters/_shared/src/release_test_count_guard.ts`, graded against the gate run pre-flight refusal #3 already makes, at no extra cost.
- **The merge boundary** — the number is right when written and made wrong by later commits. This is the residual banked here. `/pr` now WARNS on it (`checkMergeBoundary`, a git query), and a warning is not a fix: nothing rewrites the stated count, and nobody is forced to. A branch whose release commit is not its last commit can still merge with a count that does not describe it.

**What would actually close it**, and why neither is done here: rewriting the closing line automatically at merge time needs a gate run at merge time, which is the cost the deleted `tests/changelog-release-test-count.test.ts` proved unacceptable (89.5s -> 178.4s on every contributor's every run, forever, for a once-per-release staleness). Deriving the count from anything other than the gate reintroduces the defect as its own fix — a second implementation of "how many tests are there" is a number that can disagree with the gate. The remaining option is procedural — ship the release as the last commit on the branch — and the `/pr` warning is what makes that procedure mechanical rather than remembered.

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

### 0j. `LocalProvider.claimLock` has NO production caller — **CLOSED by STE-457**

**Retained in reduced form rather than deleted, because the measurement is the only executed record of the "before" and STE-457's whole case rests on it** (§ 0a and § 0k(a) precedent).

The measurement, verified independently during STE-451 and still true after the fix: `grep` over `plugins/dev-process-toolkit/**/*.ts` excluding `*.test.ts` returns **zero** imports of `local_provider` and **zero** `.claimLock(` call sites. STE-457 added prose, not a caller, so that number did not move and was never the defect. **Prose-directive-as-wire is the toolkit's normal architecture** — this entry was never filed as "no production caller is a bug", and it must not be re-opened as one.

What it *did* record was an asymmetry inside one bullet: siblings 0.b′ and 0.b″ each name a module path and a call form, 0.c's tracker half points at a runbook, and 0.c's tracker-less half named neither. **Closed by STE-457**, which gave that half the sibling shape and added the Phase 1-exit arm that reads the artifact back. The 2026-08-08 conformance run is the "before" the entry asked for (*"made only alongside a run that can measure the before/after"*); the "after" is not yet measured and cannot be offline — see § 0n.

### 0n. A doc-level symmetry PREFERENCE left standing by STE-457 — nothing broken, only uneven

**This is not a deferred fix and it must not be read as one.** It is filed as a *preference* with an *unmeasured* cost, which is a different class from every other entry in this file, and it declares that class here so a later reader neither schedules it as a gap nor deletes it as speculative.

**The unevenness.** After STE-457, step 0.c's two halves are symmetric at the *instruction* level — both name a call form, both name where the thing lives, both close with a pointer. They are still asymmetric at the *document* level: the tracker half points at a dedicated runbook (`docs/implement-tracker-mode.md` § Claim runbook) and the tracker-less half points at a section of a shared reference (`docs/implement-reference.md` § Phase 4 Close). A `docs/implement-mode-none.md` runbook would make the two halves match shape for shape.

**Why STE-457 did not write it, argued rather than asserted.** The instruction-level asymmetry was *functional* — one leg had something followable and the other did not, measured on a live run. The document-level asymmetry is *cosmetic*: a reader following either half reaches an executable instruction either way, and no measurement anywhere shows a tracker-less run failing for want of a runbook file. Adding one would buy symmetry and spend a new documentation surface.

**The cost is UNMEASURED, and that is the honest state.** `/gate-check` probe #37 (`cross-cutting-spec-stale-file-refs`) scans path tokens inside directory-tree fences in `specs/technical-spec.md` and `specs/testing-spec.md`. Those fences today list `docs/` as a directory and never per-file, so a new `docs/implement-mode-none.md` would *appear* to cost zero probe-#37 rows — **but that is an inference from the current fence contents, not a measurement**, and the fences are exactly the kind of thing a later milestone tightens. Trading a measured functional fix for an unmeasured drift exposure was the reason to stop; if someone picks this up, measure the exposure first rather than inheriting the inference above.

### 0o. `specs/technical-spec.md` still states a 351-line SKILL cap that the gate enforces at 358

Measured while pinning STE-457's line budget. `tests/skill-nfr-1-length.test.ts:18` carries `SKILL_LINE_CAP = 358` and five other suites duplicate that number, while `specs/technical-spec.md:89` still says *"Every SKILL.md ≤ 351 lines"* and `:556` repeats *"NFR-1 351-line cap"*. Two shipped SKILL files (`setup`, `spec-write`) sit at 358 — i.e. seven lines past what the spec claims is the ceiling — so the spec is not merely stale, it describes a cap the repository is already knowingly over.

Out of scope for STE-457, whose AC pins the *enforced* number and says so. Worth closing as a one-line spec correction rather than a code change: the gate is the authority, and the doc should follow it.

### 0v. STRUCTURAL — an FR's blast-radius enumeration is a HYPOTHESIS, and it has been wrong eight times across two milestones

**Not a defect in any one FR. A property of how FRs are written in this repository, which the next author should meet before it bites them.**

**The count.** M116 recorded three FRs that undercounted their own defect (5 glob literals not 4, 9 grep sites not 8, 1 trigger not 2). M121 has now added five: STE-457's blast-radius table named one shipped surface where the change touched three; STE-460 AC.6 said the cap sat in "three places" where raw counting found six; STE-460 AC.9's pin set was counted three different ways across three surfaces; STE-461 AC.13 enumerated `:376/377/378` and missed `:171` and `:254`; and STE-461's own § Technical Design named three changing surfaces where the diff carried twelve. **Eight instances is not a run of bad luck.**

**The mechanism, which is the part worth carrying.** An enumeration written at spec time is produced by *reading* — greps, recall, a scan of the obvious sites. The implementation is produced by *executing*. Those two methods disagree systematically, and they disagree in one direction: reading undercounts, because a site you did not think to search for is indistinguishable from a site that does not exist. STE-460 measured this directly — a comment/string tokenizer for the cap scan was written and discarded because **every mis-parse undercounts**, i.e. every failure mode of the smarter method produces a false GREEN on the exact question being asked.

**The rule.** Treat a spec-time site list as a hypothesis to be re-measured, never as an inventory to build on. `specs/plan/archive/M121.md`'s blast-radius table already says *"Derive it from the diff"* about itself; that instruction generalises to every enumeration in every FR, and the failure to generalise it is what produced five of the eight. Concretely: after the producer-side change lands and before the sweep begins, run the gate and read the failure set — that is the real site list, and it costs one run.

**A sharper variant, recorded because the evidence LOOKS sound.** STE-461 AC.13 did not merely undercount; it asserted that two specific pins *could not* redden, on the strength of a real executed measurement. The measurement was correct — taken under a **rewording** mutation, where both truncation-tolerant pins legitimately stayed green. The FR performs a **deletion**, which removes the trailing space those pins depend on, and both redden. **A correct measurement of the wrong mutation is more insidious than an unfalsifiable assertion**, because the evidence exists, re-runs, and confirms — while bearing on a question nobody asked. What transfers between a mutation and a change is the *technique*; what does not transfer is the *applicability*, and nothing in the measurement announces the gap. The three known falsifiability failures are now: an assertion that cannot fail; a perfect pin on the wrong subject; and sound evidence for the wrong mutation.

**And under-claiming is not the safe direction.** A spec that says "these cannot redden" while they redden is contradicted by execution the first time a reviewer checks it, and one contradicted clause costs the reader their trust in every other clause of that FR.

### 0p. TOOLKIT DEFECT — `LocalProvider.claimLock` cannot commit in any project carrying the toolkit's own `commit-msg` hook

**Measured by execution during STE-457, against the real module and the real shipped hook. This is a defect in the SHIPPED PLUGIN, not in M121, and it belongs to `adapters/_shared/src/local_provider.ts` + `templates/git-hooks/commit-msg.sh`.**

The claim commit subject is built at `local_provider.ts:183` as `chore(locks): claim lock for ${id} on ${branch}`. With a real minted id (29 chars) and an ordinary branch name that is **97 characters**. `templates/git-hooks/commit-msg.sh:49-53` rejects any subject over **72**. Executed in a throwaway repo with the shipped hook installed:

```
subject length: 97 | hook cap: 72
claimLock THREW: ShellError: Failed with exit code 1
lock file: PRESENT          # written and `git add`-ed at :181-182
claim commits found: (none) # the commit at :184 was rejected
git status:  A  .dpt/locks/fr_01KZ…
```

`claimLock` writes the lock, stages it, *then* commits — so the failure leaves the lock on disk **staged and uncommitted**, and the exception propagates out of the claim.

**Why it has never been seen.** `claimLock` has zero production callers (§ 0j), and `/setup` step 6b's hook install is explicitly *best-effort* — the model-layer block on `.git/hooks/` writes is **expected** under `bypassPermissions`, which is how every `claude -p` smoke and conformance leg runs. So the autonomous legs carry no hook and the collision never fires there. **Interactive downstream projects do install it**, and that is where this bites.

**What STE-457 changed about it, stated plainly because it is the reason this is filed now.** Before STE-457, step 0.d skipped `mode: none` entirely, so a thrown claim left a dirty tree and the run continued. After STE-457, 0.d is a hard entry gate — so on a hook-carrying project the two conjuncts split (lock present, witness absent) and `/implement` refuses at Phase 1 exit. STE-457 therefore made a latent defect **reachable and blocking**. Its 0.d prose was written to distinguish that exact state and to *not* prescribe re-running 0.c for it, because re-running repeats the rejection — but naming a failure is not repairing it.

**Scope when someone picks it up.** The repair is a code change to the commit subject (e.g. key it on the 6-char tail that already names the FR file) plus the two prose surfaces in `/implement` and the two executed fences in `.claude/skills/smoke-test/SKILL.md` that pin the current subject byte-for-byte — one of them shipped by AC-STE-456.7 specifically to prove the fence matches a subject written by the real `claimLock`. **No AC of STE-457 authorizes any of that**, and changing a commit-message format that three shipped surfaces pin is not a fix to smuggle into a prose FR. It needs its own authorizing commit, on the AC-STE-446.6 mechanism this milestone has now used three times.

### 0q. Four surfaces still state the retired half-only proof-of-release, and one quotes a sentence that no longer exists

Measured during STE-457's review; none is covered by its ACs, which name `docs/implement-reference.md` only.

- `.claude/skills/smoke-test/SKILL.md:14` and `:172` — *"release is proved by the deletion of a lock file rather than by a ticket transition"*. `:172` is the **operator contract printed before every run**, so it is the most visible of the four. The same document's own Phase 4 row was already corrected to the two-sided form by STE-456, so the file now disagrees with itself.
- `specs/frs/STE-448.md:18` — the same sentence in that FR's § Summary.
- `specs/frs/STE-451.md:73` — quotes *"the deterministic `.dpt/locks/<id>` deletion in step (b) is the proof-of-release for `mode: none`"* byte-exactly, under the heading *"Measured from the artifacts, not inferred"*. STE-457 deleted that sentence from the document being cited, so an ACTIVE FR now quotes prose that exists nowhere. `grep -rn` for the phrase returns exactly this one hit.

Not swept in STE-457 because two of the four are shipped predecessor FRs and the other two are in the smoke driver, whose AC-STE-448.9 guarded window carries only **94 characters** of headroom (AC-STE-456.6) — editing that file is cheap to get wrong and its budget is asserted. The honest sequencing is one `docs(specs)` commit for the two FRs and a separate, budget-re-measured edit for the driver.

### 0r. `--code-only`'s "behaviour identical to `mode: none`" clause is now false about 0.d as well as 0.c

`skills/implement/SKILL.md:40` says both *"skips 0.c/0.d/0.e"* and *"Behavior identical to `mode: none` for the duration of the run"*, while `:41` resolves `LocalProvider` for `--code-only` too — so the lock machinery is live on that path but the claim and its verification are skipped. Before STE-457 the two clauses collided on 0.c alone (0.d was skipped in both modes and so agreed); after it, `mode: none` runs 0.d as a hard gate while `--code-only` — declared behaviourally identical — does not.

`tests/m84-ste-322-skill-prose-hygiene.test.ts:74-80` pins the literal token list `skips 0.c/0.d/0.e`, which is unchanged and correct; nothing relates 0.a's equivalence claim to what the steps now do per mode. The one-line repair is to narrow the clause to what it means (tracker *side effects* are identical; the tracker-less claim/verify pair is skipped as listed). Widening the skip list instead would be a shipped-contract change no AC authorizes.

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

### 0m. Findings from STE-456 — none of them that FR's ACs, and one is a live hole elsewhere

**(a) THE STEP-3 SAMPLER AND THE FIXTURE PHASE ARE THE ONLY TWO SURFACES THAT WROTE THE LOCK EVIDENCE, AND BOTH USED TO BE SILENT ON A MISS.** Closed by STE-456. Recorded here because the general shape recurs: **an append-on-hit log cannot be read for absence, and every "the log was never created" inference drawn from one is unsupported.** `scratchpad/conformance-findings.md` § F7 drew exactly that inference about group 10's sampler on the 2026-08-08 run — treating a missing log as a reachability symptom when it is equally consistent with a sampler that ran correctly and found nothing, which is what a never-claimed lock produces. **The run report's reading there is not supported by the artifact and should not be inherited as established.** Any future one-sided evidence file in this repository has the same defect by construction; the repair is always the same and costs one `else`.

**(b) `follow-ups.md` § 0i's REMEDY IS NECESSARY AND NOT SUFFICIENT, and the stronger form costs one line.** § 0i prescribes, for any `indexOf`-sliced pin, "a non-vacuity assertion that the slice actually contains the thing it guards". That detects a relocation only **after** the window has moved far enough to lose its subject. A second occurrence of the anchor that lands only slightly above the row relocates the window while the row is still (partly) inside it — the guard passes, and it is now reading a different span than the one it was measured against. **Counting the anchor detects the second occurrence itself, wherever it lands.** STE-456 ships `assertAnchorUnique` for the AC-STE-448.9 anchor and measured the difference: one HTML comment written above Phase 4 turns **eleven** tests red under the counting form. **The sweep § 0i asked for has still not been run repo-wide, and it should now look for both forms** — `grep -n 'indexOf(' tests/*.ts` for slice anchors, `grep -n 'toMatch(/STE-' tests/*.ts` for once-occurring tokens.

**(c) A PIN ON A MECHANISM'S ANNOUNCEMENT IS NOT A PIN ON THE MECHANISM — measured again, and this time inside the FR citing the finding.** `specs/plan/M121.md` § Milestone finding recorded this after STE-452, where prose pins bound the summary of two model-executed surfaces while the operative instructions sat ~480 lines further down. STE-456 repeated it at a distance of **one sentence**: the fourth state's bold lead-in was pinned, the sentence deciding its outcome was not, and weakening `**FAIL 10a**` to a note left the suite 196/0. **The generalisation worth carrying: when a mechanism is declared and then given a consequence, the consequence is the mechanism.** Pin the sentence a reader would act on, and — where two surfaces must agree about it — pin both and assert they agree.

**(d) THE ROW-TITLE CLASS, which neither (b) nor (c) covers.** A bolded row heading is prose that summarises the row, so by (c) it is not the mechanism and pinning it looks like ceremony. But a heading that contradicts its own paragraph is a defect a reader hits **first**, and reverting STE-456's Phase 4 row title reddened nothing across six suites. Cheap rule: **when an edit changes what a row REQUIRES, pin the heading too — and pin the retired phrasing to zero document-wide**, so it cannot return somewhere the slice does not look.

**(f) `git log --grep` IS REGEX-FLAVOUR DEPENDENT, and a shipped fence was one config key away from failing every healthy run.** Executed against a real claim commit: `--grep="^chore(locks): claim lock for <id> "` matches **1** commit under the default BRE, **0** under `grep.patternType=extended`, **0** under `grep.extendedRegexp=true`, **0** under `perl`. Under ERE/PCRE the literal `(locks)` becomes a **capture group**, so the pattern means `chorelocks` and can never match. `--basic-regexp` restores the match under every setting and is now on both group-10 fences.

**Why it is worth an entry rather than a line in an FR.** The defect predates STE-456 — but before it, an unmatched witness produced an empty log with the commit present, which the carve-out tolerates as a `10a-sampling-gap`. STE-456 makes the witness REQUIRED, so the *same* config now turns a perfectly healthy run into a hard FAIL. **A latent gap and a false RED are the same bug at different tolerances, and tightening a tolerance can promote one into the other without touching the buggy line.** Worth checking before any future edit that makes an existing soft signal load-bearing. A sweep of `adapters/`, `skills/` and `.claude/skills/` for other `--grep` uses returns none, so the class is closed here — but nothing enforces the flag on a *new* one.

**(e) NOT FIXED, and named so it is not discovered as a surprise.** The narrowed presence-claim tripwire has one residual hole: a sentence naming the commit in a subordinate clause while making a filesystem-presence claim (`"verify that, before the archive commit, the lock file exists mid-run"`) goes silent, because the `commit` exclusion cannot tell that from a legitimate git-history witness. Closing it needs a parser rather than a regex. It is named in `tests/_ac9-row-guard.ts` and asserted to be exactly where the note says, so a future narrowing must update the note rather than leave it stale. **The real guard was never the tripwire** — it is the six disclaimer pins of `AC9_DISCLAIMER_PINS`, which a presence claim must either contradict on its face or delete. (This note said five until STE-460 AC.9; the array had held six since STE-456 added its second witness clause.)

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

### 0s. THE LIVE-THEN-ARCHIVE FALLBACK IS A CONVENTION DISCOVERABLE ONLY BY READING OTHER TESTS — **CLOSED for M121 by STE-459, OPEN as a class**

**Found by performing M121's archive, not by any test that asked the question.** Recorded here rather than only in the FR because the FR will be archived by the very operation it describes, and because the general shape outlives this milestone.

**The measurement.** Archiving M121's thirteen FRs and its plan took the gate from `7047 pass / 15 skip / 0 fail` to `7030 pass / 18 skip / 14 fail`. Six of this milestone's own test files bind a milestone-scoped spec artifact at the live path with no `archive/` fallback:

| file | binds | on archival |
|---|---|---|
| `tests/m121-ste-445-derivation-falsifiability.test.ts` | `specs/plan/M121.md` | 3 hard failures |
| `tests/m121-ste-446-leg-set-authority.test.ts` | `specs/frs/STE-446.md` | 3 hard failures |
| `tests/m121-ste-452-termination-harness.test.ts` | `specs/frs/STE-452.md` | 1 hard failure |
| `tests/m121-ste-457-mode-none-claim-instruction.test.ts` | `specs/frs/STE-457.md` + the plan | 7 hard failures |
| `tests/m121-ste-455-plan-id-equality-correction.test.ts` | `specs/frs/STE-448.md` | 1 SILENT skip, unlabelled |
| `tests/m121-ste-458-capture-artifact-identity.test.ts` | `specs/frs/STE-458.md` | 2 labelled skips |

**The idiom already existed and nothing required its use.** `existsSync(active) ? active : archived` ships verbatim at `tests/m108-ste-393-docs-pins.test.ts:99` (`const planPath = existsSync(active) ? active : archived;`) and `tests/m114-ste-416-linear-checkbox-doc-accuracy.test.ts:203` (`const frPath = existsSync(activePath) ? activePath : archivePath;`) — M108 and M114, thirteen and seven milestones ahead of M121. **A convention whose only documentation is its own prior call sites is not discoverable by anyone who does not already know to look**, and the next person writing a milestone-scoped test file will make the same mistake for the same reason. STE-459 therefore ships a meta-test over `tests/m121-*.test.ts` alongside the six edits; **that meta-test is milestone-scoped, so the class is closed for M121 and OPEN for M122+.** Widening it to all `tests/*.ts` was not attempted here and is the obvious next step.

**Why the quiet half is the worse half, stated once so it is not re-litigated.** The fourteen failures stop a release and get read. The three skips leave a GREEN gate at a higher skip number, and nothing in the report says which three assertions stopped guarding anything. The guards were written to tolerate a plugin-only checkout that ships no `specs/` — a real and correct concern — and archival is byte-indistinguishable from that case at the only signal the guard consults (`existsSync`). **A guard cannot distinguish "this consumer never had the artifact" from "this repository just moved it" without being told which question it is asking.**

**The labelling asymmetry, worth more than the instance.** `m121-ste-458` renders `[SKIPPED — FR absent from specs/frs/ or history unreachable]` into the test name; `m121-ste-455` is a bare `describe.skip`. The first is legible to a reader scrolling a 7000-test report; the second is indistinguishable from a test someone disabled on purpose. **Rule worth carrying: a guard that can fire during a routine repository operation must name its reason in the test title.** Neither should skip on archival at all — both now read the archived path — but the labelling rule is what makes the residual cases safe.

**A single-path fallback is NOT always the fix, and `m121-ste-458` is the counter-example.** Its path constant feeds `commitsTouching`, i.e. `git log --diff-filter=AM -- <path>`. `git log` without `--follow` does not cross a rename, and the live path's post-archive `D` is excluded by the `AM` filter — so the archived path's history is exactly one commit, the archive commit itself. Falling back to it alone empties `authorizing` and turns the deliberate non-vacuity assertion into a hard failure: **the naive fix converts a silent skip into a red test and looks, from the failure message, like the archive broke something.** The repair is the union of both paths, concatenated **archive-first** so newest-first ordering survives and `FR_COMMITS[length - 1]` still resolves to the authorizing commit. `--follow` is explicitly not the answer here for the same reason probe #73 rejected it: similarity matching launders one template-shaped artifact into another.

**Generalisation.** This is the third distinct mechanism in M121 by which an assertion stops being about its subject while the suite reports green — after § 0i's anchor relocation (`indexOf` returning a valid index into the wrong text) and § 0i's once-occurring-token dilution. Those two were caught by mutation *inside* the milestone. This one was caught only by performing the archive, and **no mutation battery would have found it**, because every mutation in this milestone was measured against a live tree. The class to watch: **any state transition that no gate run precedes.** § 0l names the other member (history-asserting tests, verified one commit late).

### 0u. CORRECTION TO THE RECORD — the 2026-08-08 run produced **five** high-severity findings, not three, and 13 is a FLOOR

**Recorded here because the number was repeated several times in narration and once, in narrower form, in the archived plan.** `follow-ups.md` is live and takes the correction; the archived plan is frozen and is not re-edited for it (see § 0t for the one edit that was authorized, and why this one was not folded into it).

**The measured figures**, from `scratchpad/conformance-findings.md` (the run report; a session artifact, not a repo one — [[feedback_gate_report_not_an_artifact]]):

- **Thirteen findings recorded.** Seven at the loop layer (`F1`–`F7`) and six relayed verbatim from the jira leg's own surviving findings file (`J1`–`J6`).
- **Five are high.** `F1`, `F2`, `F3` at the loop layer; `J1` and `J6` relayed. `J4` is medium-high. Verified against the severity lines at `:62`, `:111`, `:145`, `:246`, `:261`.
- **The milestone fixed TWO of the five** — `F1` (STE-456 detection, then STE-457 fix) and `F2` (STE-455). `F3`, `J1` and `J6` are unfixed and no FR claims them.

**`F3` is not a defect the milestone declined to fix — it is not a code defect at all.** The report tags it *"high (operational, not a code defect)"*: all three legs killed simultaneously by a weekly usage limit ~50–60 minutes in, after the six canonical skills and before the post-chain phases. Counting it among "defects found" overstates what the run surfaced about the code.

**THIRTEEN IS A LOWER BOUND ON AN UNKNOWN, NOT A COUNT.** `F4` records that two of the three legs lost every finding they had — only the jira leg wrote its findings file incrementally — in the report's own words, *"The run kept 6 findings and lost an unknown number."* So the true figure is unknowable from this run, and any statement of the form "the run found N" is a statement about what survived the kill, not about what the run observed. **This is the part most likely to be dropped when the number is repeated**, and dropping it converts a floor into an apparent total.

**Where the narrower phrasing survives.** `specs/plan/archive/M121.md` § FR list reads *"They close the two high findings that run produced"*. That sentence is accurate about what the follow-up wave CLOSED and inaccurate about what the run PRODUCED. It is left as written because the plan is archived and the § 0t exception was authorized for the blast-radius count alone; a reader reaching that line should read it as "the two the wave closed" and come here for the run's actual tally.

### 0t. `specs/plan/archive/M121.md` was edited after archival, under an operator-authorized exception — **NOT a general licence**

**Sibling to § 10 of the M116 section** (`specs/frs/archive/STE-417.md`, edited under a spec-authorized exception). Recorded for the same reason: a future reader who finds an archived file with a post-archival edit should get the reason rather than a mystery.

**The rule this departs from**, stated in two places in the shipped skill — `skills/spec-archive/SKILL.md:78` and its § Rules bullet at `:183`: *"No skill writes to files under `specs/frs/archive/` or `specs/plan/archive/` except the frontmatter flip (`status` / `archived_at`, plus `ship_state` under `--parked`) at move time."* That rule is unchanged, and this entry does not amend it.

**What was edited and why.** One number, in the § Migration blast-radius paragraph: *"Seven of this milestone's **thirteen** FRs"* → *"**fourteen**"*. STE-459 was authored at archive time (§ 0s), which made the denominator false the moment it landed. The operator authorized the edit explicitly, on the ground that the plan is the first thing anyone reads and a knowingly-false count at the top of it is worse than a bounded exception to a freeze rule. The numerator was left at seven and the reason written into the same sentence, because a reader seeing only the denominator move would reasonably infer the blast radius had grown — it had not; STE-459 is test-only.

**The three conditions that made it an exception rather than a precedent**, named so the next reader can check whether they hold before reaching for this entry:

1. **The plan had not shipped.** `shipped_in` was still `null`, so no release stamp and no CHANGELOG entry referenced the text being corrected, and probe #63 `plan_ship_coherence` had nothing to contradict.
2. **The correction was a fact already false on disk**, not a rewording, an improvement, or a late scope change. The alternative was not "leave it tidy" but "leave it wrong".
3. **Nothing pinned the sentence.** `grep` over `tests/` and `adapters/` for the phrase returned zero, so the edit could not launder a green assertion — checked before the edit, not after.

**What this is NOT licence for.** Editing an archived FR or plan to improve its prose, to backfill a finding, to soften a recorded conflict, or to update a count that went stale because a LATER milestone changed something. The last case is the tempting one and it is the boundary: this number went stale because of an FR inside the same unshipped milestone. A number that goes stale because M122 exists belongs in M122's own record, not retro-edited into M121's.

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

## Carried forward from M127 — Fixture Falsifiability (2026-08-17)

### 11. `PLUGIN_DIR` is a hardcoded maintainer-absolute path in the Phase 2.X preamble

`.claude/skills/smoke-test/SKILL.md` § Capability-row evidence sets
`PLUGIN_DIR=/Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit`
by a plain, non-exported assignment inside a bash fence. Every `${CAP_ASSERT}`
fixture in Phase 2.X and Phase 9 already depends on it, and STE-484's repaired
group-7 assertion now does too.

Two consequences, both measured rather than theorised. A driver that runs one of
these spans in a shell which never sourced that fence gets `bun "/adapters/…"`,
module-not-found, and a non-zero exit on **every** leg — a false RED with exactly
the silhouette M127 exists to remove. And the value is one machine's path, so no
span depending on it is runnable from a fresh checkout.

Deriving `PLUGIN_DIR` in the preamble — from the SKILL's own location, the way the
teardown fence already derives `TOOLKIT_REPO` from it — would close both for every
consumer in one edit. It was **not** done in M127: the preamble is shared surface
and no M127 FR authorizes editing it, and widening a fixture-falsifiability
milestone into a shared-preamble change is the kind of quiet scope growth this
repo has been bitten by before. STE-484 states the caveat at the group-7 span
instead. Closing this properly wants its own FR.

Surfaced by the STE-484 spec-review audit, 2026-08-17.

### 12. Four residuals from M127's STE-486 audit, none blocking

Recorded because each is a real observation the audit made and none was worth
widening STE-486's scope to close.

1. **`carveOutCitations()` is dead.** `adapters/_shared/src/shared_carve_out.ts`
   exports it, the STE-486 test's design block specifies it, and nothing calls
   it — zero importers repo-wide, zero assertions, and its dedupe arm is
   unexercised. The one function whose job is to ENUMERATE citing sites ships
   unverified. This is the STE-445 silhouette (exported authority imported by
   nothing) inside the very module built to stop drift. Wire it into the
   uniqueness check or delete it.

2. **`git -C "" ` leaves the CWD unchanged.** In the § Tracker-less rows span an
   unset `${TP}` therefore does not fail — it silently searches the DRIVER's own
   repository for the claim commit, while the lock test degrades to `/.dpt/…`
   and reports lock-absent. It fails safe today only because a minted ULID
   `FR_ID` cannot match a commit in the toolkit repo. Nothing asserts `TP` and
   `FR_ID` are actually set.

3. **`claim_witness_assert.ts` treats an omitted third argument as
   `lock-absent`** (`lockState !== "lock-present"`) — the permissive direction
   for a safety-critical input. Unreachable from the shipped span, which always
   emits one of the two tokens; `exit 2` would be the fail-closed choice.

4. **`AC9_DISCLAIMER_PINS[2]` is read by INDEX** at
   `tests/m121-ste-456-two-sided-lock-evidence.test.ts`. That list's own doc
   block stresses its order is the DOCUMENT's, and STE-460 reordered it once
   already. A future reorder silently re-points the assertion onto a different
   subject while staying green.

Also from the same milestone: `HEADING_RE` / `FENCE_RE` are byte-identical in
`falsifiability_harness.ts` and `shared_carve_out.ts`. Deliberately not hoisted —
the two modules handle fences by genuinely different strategies (mask-to-blanks
to preserve byte offsets vs skip-while-collecting) and their heading matchers
disagree on subject, so only the two regex literals are honestly shared and
buying that costs an edit to a heavily-pinned module.

Surfaced by the STE-486 spec-review audit, 2026-08-17.

### 13. Two enumerator blind spots M127/STE-487 leaves open, both named

STE-487's AC.3 claims a check enumerates "every per-run artifact path in both
harness SKILLs". After closing the `VAR=<path>` gap (assignment prefixes were
dropped before the scoped test, exempting 25 sites — scanned went 194 → 219,
still `unscoped=0`, so nothing live was hiding there), two classes remain
outside the enforcement. Neither hides a live offender today. Both are recorded
because "every" is measurably not yet true.

1. **`${VAR}`-rooted paths are not resolved.** The scan is textual, so
   `MANIFEST="${P9}/artifact-manifest-<date>.log"` is not recognised as living
   under `/tmp` — the root is behind a variable. Phase 9's own new fence writes
   through exactly this shape. Coverage survives only because the same two
   classes are ALSO spelled fully-qualified elsewhere in the section, which
   means an edit that drops the redundant spelling retires the enforcement
   **silently, with no test going red**. That is the vacuity shape this
   milestone exists to remove, one level up, and it is the more dangerous of
   the two. Closing it wants a one-pass shell-variable resolution over the
   fence before enumeration.

2. **The glob / reap half of STE-423's claim is out of scope.** STE-423 said
   every path a leg "writes, globs, or reaps" carries the segment; the check
   covers writes only, and `isGlob()` drops 26 refs. Four of those are
   genuinely UNSCOPED cross-leg reaps: `/tmp/dpt-smoke-prompt-*.txt`,
   `/tmp/dpt-smoke-findings-*.md`, `/tmp/dpt-conformance-loop-*.pid`. A teardown
   reaping the last of those while a sibling leg is still running destroys that
   leg's evidence — precisely the failure class STE-487 was opened for, and the
   documented-safe parallel mode is what makes it reachable.

Also noted, low severity: AC.2's "outside the repo, or covered by an ignore
rule" test executes zero assertions under the shipped design (every resolved
path is `/tmp`, so its loop `continue`s every iteration). It is a correct
conditional contract with no teeth today; the AC's real coverage is the
adjacent test that writes all 15 artifacts at their resolved paths and diffs
`git status --porcelain -uall`.

Surfaced by the STE-487 spec-review audit, 2026-08-17.

### 14. `m117-ste-425`'s closing-check slicer anchors on a stealable regex

`tests/m117-ste-425-falsifiable-coverage.test.ts` locates § Closing artifact
accounting by scanning for the FIRST line matching `/untracked/i` AND
`/artifact|fixture|capture|transcript/i`. Any prose added ANYWHERE earlier in
`.claude/skills/smoke-test/SKILL.md` that happens to use both words silently
relocates the anchor, and the slice then contains no bash fence — six tests go
red pointing at a section nobody touched.

Hit for real in M127: STE-489's staging paragraph (fixture group 2, ~850 lines
above the real section) described a spec file "left untracked in the working
tree" while also saying "sub-fixtures" and "capture". Six `AC-STE-425.4` /
`Phase 3 round-2 hardening` tests went red. The repair was a single word —
"untracked" → "uncommitted" — which is the tell that the anchor, not the prose,
is the defect.

This is the same relocation class as the AC-STE-448.9 row guard, whose window is
taken from the FIRST occurrence of its own AC token and which a mention anywhere
above § Phase 4 silently moves (recorded at § 0i). Both want anchoring on a
heading, or on a token that exists nowhere else, rather than on a conjunction of
common words.

Surfaced while implementing STE-489, 2026-08-17.

---

## A pinned line that outlived its subject — `conformance-loop-aggregator.test.ts:71`

`tests/conformance-loop-aggregator.test.ts:71` pins `/RC_LINEAR.*-ne\s*0[\s\S]{0,80}RC_JIRA.*-ne\s*0/`
against the § RC collection fence, under the name "Phase A fails fast if either
subprocess returns non-zero". After STE-490 the line it matches is the only
thing it can match, and that line is semantically dead: replacing the outer
three-way guard with `if true` changes zero of four fence outcomes, because the
per-leg loop below it already skips clean legs. The pin therefore holds a
redundant line in place, and — the part that matters — it would stay GREEN if
the entire classification loop were deleted, so long as the inert `if` line
remained. A perfect pin on a subject that has moved.

Two other suites were believed to require the same line and do not:
`driver-gate-fail-open-guards.test.ts:163` and
`m121-ste-452-termination-harness.test.ts:158` assert only `/-ne 0/` against the
whole fence, which the loop's own `[ "${LEG_RC}" -ne 0 ]` satisfies. So the
aggregator's proximity pin is the sole constraint.

The honest repair is to re-point the pin at what now decides — the `classify`
call and the `RC_FAILED` accumulation — and drop the dead guard. That is a
shipped-test change and wants an FR, not a refactor.

Surfaced while implementing STE-490, 2026-08-17.

---

## The README release-file entry bumps the number and leaves the sentence lying

`CLAUDE.md` § Release Files declares the README row as `kind: regex` with
`pattern: 'Latest: \*\*v(?<version>\d+\.\d+\.\d+) — '`. The capture group covers
the **version only**, so a mechanical `/ship-milestone` apply rewrites the digits
and leaves the codename and the entire descriptive sentence describing the
*previous* release. It reads as a correct bump until somebody actually reads the
sentence — the failure is invisible to the mechanism that caused it, which is
the shape this repo treats as worse than a loud break.

This is a defect in the release mechanism, not in any one release: every
milestone that ships through it inherits the same stale-sentence risk and has to
remember to hand-edit the line. Found during M127 and hand-corrected again in
M128 rather than fixed.

Candidate repair: extend the row so the codename and summary clause are part of
the replace template (a `kind: regex` pattern capturing the whole line, or a
dedicated `kind` that knows the README headline's shape), so the apply either
rewrites all of it or refuses. Wants an FR.

Surfaced while shipping M128, 2026-08-17.

---

## `runtime check:` is still spelled inline in all thirteen fixture-group footers

STE-491 stated the roster-line spelling once, normatively, in
`.claude/skills/smoke-test/SKILL.md` § Phase 3 — Capture, and reconciled fixture
group 12's footer to cite it. Group 12 was chosen because two shipped suites read
its literals — not because it was the only duplicate.

Counts, with the tree each was measured on named, because an earlier draft of
this note reported the post-change numbers under a pre-change framing:

| | pre-change (`ff87a97`) | post-change |
|---|---|---|
| `grep -c 'runtime check:'` | 14 | 14 |
| footers restating NOT-REACHED / N/A | 8 | 7 |
| footers using "rather than nothing at all" | 6 | 5 |

The total is unchanged at fourteen because group 12 gave up the semantic
restatement, not its own `STE-467 runtime check:` token — it keeps that
deliberately, since `m124-ste-467-implement-lens.test.ts` and
`m117-ste-425-falsifiable-coverage.test.ts` both read it. The pre-change
fourteen is the general statement plus thirteen footers; the post-change
fourteen is the new § Phase 3 statement plus the same thirteen. So **all
thirteen** footers still spell the token inline — this is a semantic
deduplication, not a token one.

Two hazards make this more than tidying:

1. **AC-STE-491.1's "stated once" predicate is a three-literal co-occurrence
   test** (`runtime check:` ∧ all four outcome labels ∧ `smoke_fixture_groups.ts`),
   not a normativity test. Six sections sit one token away from flipping it:
   sub-fixtures 2c, 9c, 10c, 11a and 13a already satisfy two of three conjuncts
   (token + labels, no module basename), and § Phase 2.X summary line satisfies
   the other two (labels + module, no token) since this FR removed the token from
   its bullet. Verified by mutation: prepending a bare "Rendered by
   smoke_fixture_groups.ts." to group 13a's footer FALSE-REDs "exactly ONE
   section states it" without that footer restating anything. The converse also
   holds — a genuine second full statement that writes "the fixture-group
   renderer" instead of the filename scores 2/3 and passes the guard.
2. So the footer rewrite **cannot** mention the module by name without also
   revisiting the predicate. Sequencing matters: tighten the predicate to test
   normativity first, then reconcile the footers.

Also still duplicated: the `smoke_fixture_groups.ts render --leg …` invocation
appears in § Phase 2.X's fence and again in § Phase 3's new paragraph. Only the
Phase 3 copy is pinned, so the Phase 2.X copy can drift silently. Deduplicating
means deleting a runnable command from the runbook step where the operator
actually runs it, which is a behaviour-affecting change to a section no AC
covers.

Surfaced while implementing STE-491, 2026-08-17.

---

## `/tdd` implementer forks must not run `git stash` operations

**Needs an FR before it can land** — `agents/tdd-implementer.md` is a shipped
file and no M129 AC authorises editing it, so this is recorded rather than fixed.

**The incident (M129, 2026-08-17).** A `tdd-implementer` fork, trying to measure
a pre-change baseline, ran `git stash push -- <paths>` followed by an
unconditional `git stash pop`. The push failed — the target module was untracked,
so the pathspec matched nothing — but the pop then ran anyway and popped an
unrelated pre-existing entry (`stash@{0}`, a WIP from the `feat/m109-…` branch)
into the working tree, leaving `adapters/_shared/src/token_stats_render.ts` in a
conflicted `UU` state.

**It recovered, and disclosed.** The fork verified the conflict's "ours" blob was
byte-identical to `HEAD`, restored with `git checkout HEAD -- <path>`, and
reported the whole sequence in its hand-off rather than quietly fixing it.
Independently verified afterwards by both the worker and the supervising session:
all three stash entries still present with the M109 WIP at `stash@{0}`, zero
unmerged paths, no conflict markers anywhere under `plugins/` or `specs/`.

**Why it still needs closing.** Nothing was lost *this time*, and that is the
point — the same sequence against a stash entry that did apply cleanly would
have silently mixed another branch's WIP into a milestone commit, and the fork
had no way to know it had done so. A subagent has no business mutating the stash:
it does not own the tree it runs in, cannot see what else is stacked there, and
its "restore" path assumes its own push succeeded.

**Proposed fix.** Add an explicit prohibition to `agents/tdd-implementer.md`
(and its siblings `tdd-test-writer` / `tdd-refactorer`, which have the same
tree access): no `git stash` in any form. A baseline measurement wants
`git diff` / `git show HEAD:<path>` / a scratchpad copy, none of which mutate
shared state. Consider a `/gate-check` probe over `agents/*.md` asserting the
prohibition is present, since prose alone is what failed here.

**Interim mitigation, already in force:** the M129 worker passed an explicit
"do NOT run any `git stash` command" constraint in every subsequent implementer
prompt. That is a runtime instruction, not a shipped change, and it held for the
rest of the milestone — but it protects only runs whose orchestrator remembers
to say it.

Surfaced while implementing M129 / STE-493, 2026-08-17.

---

## PROPOSED for `docs/patterns.md`: the proximity-pin escape hatch

**Proposal only — `docs/patterns.md` is a shipped file and no M129 AC authorises editing it.** Recorded here so it can be filed as its own FR.

**The rule.** A two-anchor proximity assertion — "these two strings occur within N characters of each other" — guarantees only that the **anchor** is new. The second needle is unconstrained and may match anything inside the window, including text that predates the change entirely. When a new section is inserted **adjacent to topically similar shipped prose**, the needle half will match that shipped prose and the pin passes without the new text saying anything.

**Measured instance (M129 / STE-495).** Four prose pins used `nearby(target_repo, <needle>, 900)`. `target_repo` appeared nowhere in either `/deliver` surface at HEAD, so the pins read as new-text-only. The new `## Target repo` section was inserted directly under `docs/deliver-reference.md`'s pre-existing Phase table, whose rows already contained *"Inline, invoking session"* and *"One fresh spawned visible worker per milestone"*. Stubbing the entire new section — keeping the anchor token, deleting every claim — left **two of the four pins green**.

**The fix that works.** Slice the assertion's subject to the sections that actually mention the anchor, and run the pin against that slice. Do **not** shrink the window as the remedy: window size is a proxy for "same thought" and tuning it trades one arbitrary failure for another. After slicing, the same stub mutation killed six tests instead of two.

**The secondary lesson, worth its own line.** The test file's header asserted the property the author intended ("every prose pin is anchored on a token that does not exist today") rather than the one achieved. That claim was true of the anchor and false of the pin, and it actively discouraged checking. A falsifiability claim in a header is itself an assertion and should be as falsifiable as the pins it describes.

**Why it belongs in patterns.md.** This repo pins prose across many shipped surfaces and routinely appends new sections beneath existing tables, so the precondition recurs structurally. It is the fourth wrong-subject-pin instance recorded in M129 and the first with this shape; the other three were all "the pin reads the wrong subject", while this one is "the pin reads the right subject and the wrong text".

Surfaced while implementing M129 / STE-495, 2026-08-17.

---

## The NFR-1 skill line cap has three values and no single source of truth

**Needs its own FR — no M129 AC authorises changing a cap, and the fix touches shipped docs and tests repo-wide.**

Surfaced by the STE-497 refactor pass, which noticed `docs/deliver-reference.md:3` citing a "351-line cap" while the FR's own tripwire pinned 358. Measured across the tree:

| Surface | Value | Count |
|---|---|---|
| `plugins/dev-process-toolkit/docs/*.md` prose | **351** | 6 files (`deliver-`, `layout-`, `implement-`, `resolver-entry`, `setup-`, `ship-milestone-` reference) |
| `tests/*.ts` — `SKILL_LINE_CAP` | **358** | 14 files |
| `tests/*.ts` — `SKILL_LINE_CAP` | **351** | 1 file |

So the number is restated in at least 21 places under three different spellings of the same rule, and the docs disagree with the majority of the tests. Nothing derives it from anything; every site is a hand-typed literal.

**Why this is more than cosmetic.** The cap exists to keep a skill readable by the agent that executes it, and every reference doc opens by explaining that its own existence is a consequence of that cap ("extracted from `skills/<name>/SKILL.md` to keep the skill file under the NFR-1 351-line cap"). An author trimming a skill to satisfy the documented 351 does strictly more work than the gate requires; an author trusting the 358 pin writes prose the docs describe as over-cap. Neither is caught, because no probe compares the two.

**Proposed fix.** Export the cap once from `adapters/_shared/src/` (alongside the other shared numeric authorities such as `MAX_CONCURRENT_WORKERS`), have every test import it instead of declaring `SKILL_LINE_CAP` locally, and either derive the docs' sentence from it or add a `/gate-check` probe asserting the documented number matches the exported one — the same shape as probe #57 `public_surface_count_drift`, which exists precisely because hand-typed counts drift. The 1-vs-14 test split should be resolved to whichever value the gate actually enforces before the constant is minted, so the hoist does not silently ratify the minority spelling.

Deliberately NOT fixed in M129: reconciling it means editing six shipped reference docs and fifteen shipped test files for a rule this milestone does not touch.

Surfaced while implementing M129 / STE-497, 2026-08-17.

---

## PROPOSED probe: README's Args column must mirror each skill's `argument-hint`

**Needs its own FR — a new `/gate-check` probe moves the pinned probe count across ~12 files, and no M129 AC authorises that.**

`README.md` states the rule itself: *"The `Args` column mirrors each skill's `argument-hint:` frontmatter"*, and `—` is defined there as *"a skill that takes no arguments"*. Nothing enforces either half.

**M129 staled it twice, in one milestone:**

| Row | Was | Should have been | Pinned green by |
|---|---|---|---|
| `/pr` | `—` | `` `[--draft]` `` | `m106-ste-389…:152` asserting `cells[3] === "—"` |
| `/deliver` | `` `[feature request or idea]` `` | `` `[feature request or idea, or a milestone or FR identity]` `` | nothing — it simply drifted |

The `/pr` case is the instructive one: a shipped test asserted the literal `—` and therefore **certified a false statement** once the skill gained a flag. The rule was never "renders `—`"; it was "mirrors the hint". A pin on the literal rather than on the relationship inverts from protection into obstruction the moment the thing it describes changes.

**Proposed fix.** A probe over every `| \`/<skill>\` |` row in `README.md`: read that skill's `argument-hint` frontmatter (absent ⇒ the cell must be `—`; present ⇒ the cell must be the value backticked, quotes stripped). This is the contract archived `AC-STE-314.1` already asks for and which no test has ever enforced. Shape it on probe #57 `public_surface_count_drift`, which exists for exactly this class of hand-typed documentation drift, and make it vacuous when `README.md` is absent so consumer projects never fail on it.

**Interim, already landed:** `tests/m129-ste-497-deliver-identity.test.ts` pins the mirroring for the two skills M129 changed (`/deliver`, `/pr`), including a not-the-`—`-marker leg and a non-vacuity control. That covers the two rows this milestone touched and nothing else.

Surfaced while implementing M129 / STE-496 and STE-497, 2026-08-17.

## Evasion twins for every guard validated against real content only

**The finding, measured.** Every accumulating rule this repository ships resets its
accumulator on a repeated heading, so splitting an over-budget section into two
identically-named sections evades the cap entirely. Measured with controls on 2026-09-01:

| rule / cap | control (one heading) | evasion (repeated headings) |
|---|---|---|
| `line_cap` 6 lines (STE-386, M105) | 10 lines → flags | 5 + 5 = 10 → **silent** |
| `word_cap` Summary 80 | 200 words → flags | 3 × 70 = 210 → **silent** |
| `word_cap` Technical Design 120 | — | 3 × 100 = 300 → **silent** |
| `word_cap` Notes 60 | — | 2 × 55 = 110 → **silent** |
| plan narrative 150 | 400 words → flags | 3 × 140 = 420 → **silent** |
| stage-report ceiling 49 lines | — | 50 × 2 = 124 → **accepted** |

`backtick`, `ac_id` and `path_token` do NOT multiply — measured, not assumed. The boundary
is structural: **a rule carrying state across lines needs a per-name property; a per-line
predicate does not.**

**Why it survived.** A dogfood over real content answers "does this fire?" and never
"can this be avoided?" — real material does not evade. Every dogfood M137 shipped proved
its scanner measures *something*; none proved it measures *all of its subject*. Five holes
across three modules survived four adversarial review rounds for that reason, and no review
can close it: a review inspects what exists, and this is a property the suite must contain.

**What M137 shipped.** The per-name property (gating), the taxonomy above, and the standing
rule that every dogfood ships with an **evasion twin** — same total, restructured, required
to produce the same verdict.

**What this FR owes.** M137 applied the twin rule to its own guards only. The following were
validated by pointing them at real material and are therefore proven only to measure
something: the archive-fallback dogfoods, the citation resolver (`resolveExemptCitation`),
the adoption grader (`scanStageBlockAdoption`), and the `deliver-stage-result` fence contract.
Audit every guard in `adapters/_shared/src/` for an evasion twin; add one or record why none
can be constructed. Deliberately deferred from M137 to keep the milestone shippable — the
rule is the deliverable, this sweep is its consequence.

Surfaced while implementing M137 review round 2, 2026-09-01.

## K8 — grade the INSTRUCTION, not the heading (banked from M137 round 3)

`gradeAdoptingSkills` in `stage_block_adoption.ts` enforces "exempt is not
optional" with `body.includes(entry.heading)` — a raw substring search over a
SKILL.md. Four evasions demonstrated: a bare heading, a heading only inside a
fence, a heading in an HTML comment, and a heading in prose. The last is the
worst — `"We removed the ## Verification evidence section entirely."` satisfies
the check that the section still exists.

**Three of the four cannot be closed by tightening it, and attempting to would
flag the correct file.** In `skills/implement/SKILL.md` both required headings
(`## Verification evidence`, `## Advisory notes`) appear ONLY as backticked
mentions inside one prose paragraph at line 280 — zero line-start occurrences.
The subject is an AUTHORING surface: a SKILL.md *instructs* the runtime to emit
a section, it does not contain one. The module's own header says so.

**This is the review committing the error the FR already retracted.** AC-533.8
originally demanded a probe over SKILL.md grade a rendered report's narration —
structurally impossible for the same reason, and withdrawn during the milestone.
K8 treats a heading-presence check on an authoring surface as though the surface
were the report.

**The closable half needs a different and larger check:** assert the skill
ORDERS the section — `render ## X through <renderer>` — rather than that the
heading appears. Strictly better than grading presence, and it generalises past
these two sections. That is the FR someone should pick up; do not attempt it as
a tightening of the substring match.

## Structural exemption has no ITEM-LENGTH bound (banked from M137 round 3)

A structural body's rows are exempt from the narrative word cap, and a row of
ANY length counts as one row. A "task row" carrying 120 words is narrative
wearing a list marker, and nothing bounds it.

**Measured on the 136 archived plans staged as active:** 40 structural
subsections exceed the cap in raw words, with **21,217 words riding exempt**.
The largest single one is 6,429 words (`Halt condition`, M121). Thirty-eight of
those were exempt before M137 touched anything — this is a pre-existing hole,
not a new one.

**What M137 changed, with both halves of the ledger.** `7b9ed07` made ordered
rows structural so the scanner could see the task shape this project actually
writes. On that corpus it takes violations **41 → 28**: of the 13 removed,
**11 are `Tasks`** — the false positives that made the finding — and **2 are
narrative written as numbered lists** (`Deviations from the approved design`,
`Follow-ups carried out of M136`), which now ride exempt. Control: identical
968-word prose is FLAGGED as plain bullets and EXEMPT as `1. …` rows, the prose
held constant and only the list marker varied.

So the change bought 11 and cost 2, and made two more instances of the
item-length problem reachable. **Do not fix it by reverting** — that restores 11
wrong reds to remove 2 right ones.

**Scope this as the WHOLE question, not the two sections M137 made reachable.**
Fixing the two while leaving the thirty-eight that were always there is "the fix
reaches only the clause you name" committed on purpose, in the round convened to
stop doing that.

**The obstacle is real and is what the FR must decide:** every formulation of an
item-length bound either introduces a second budget literal — which AC-STE-536.4
refuses, one definition per budget — or picks a fraction of the existing cap,
which is a new number wearing a derivation. The FR has to name the number and
say where it lives.
