# The stage status block

The one closing-summary shape every user-facing stage emits **instead of** narrating. Extracted here once — the shipped `docs/deliver-reference.md` precedent — so the eleven adopting skills point at a single contract in one line each rather than restating it eleven times against the NFR-1 line cap.

Grading lives in code, not in this file:

- `adapters/_shared/src/stage_status_block.ts` — `verifyStageStatusBlock(report, evidence)` grades one **rendered** report: fence presence, the eight-section fixed order, the whole-report line cap (`STAGE_REPORT_LINE_CAP` = 40), the empty-section fallback, and counts claimed with no capture behind them.
- `adapters/_shared/src/stage_block_adoption.ts` — `verifyStageReportAdoption(report, evidence)` layers the **adoption policy** on top of that grader, and `scanStageBlockAdoption(projectRoot)` reports which adopting skills' SKILL.md documents no closed status-block fence — plus which still emits `/deliver`'s banner, or has dropped a cap-exempt section. It is a policy over the grader, never a second parser. The scanner grades an AUTHORING SURFACE, so narration is not among its clauses: a SKILL.md is documentation and its prose is legitimate — narration is readable only from a rendered report, which the grader above owns. `/gate-check` probe #82 (`stage_block_adoption`) runs the scanner on every gate run; the same module opens a front door for a reader:

```sh
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/stage_block_adoption.ts <projectRoot>
```

The REPORT half has a front door of its own, and it is the one to point at a capture:

```sh
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/stage_block_adoption.ts --report <captured-report>
```

Exit 0 is clean and names the file it graded, exit 1 prints every refusal in the house `Remedy:`/`Context:` shape, exit 2 is a usage error and prints no verdict at all. **Frequency, stated honestly.** Smoke fixture group 15 runs that front door over a captured stage report on every conformance leg, so the report-level rules are enforced at conformance frequency rather than probe frequency — lower, and real. Committed models of both a compliant and a narration-reinstated capture live at `plugins/dev-process-toolkit/tests/fixtures/stage-block-adoption/`, with their provenance stated beside them.

**Two banners, two owners.** The eleven adopting stages emit ```` ```stage-status-block ````; `/deliver`'s worker hand-off keeps ```` ```deliver-stage-result ````, graded by `adapters/_shared/src/deliver_stage_capture.ts` against `DELIVER_STAGE_IDS`. Each grader accepts its own banner and refuses the other's. Nine of the eleven emit a `stage:` value the `/deliver` capture grader refuses outright, and that grader *requires* prose above its fence while this contract's whole claim is that the block replaces the prose — two contracts that cannot both be satisfied by the same bytes are two contracts. Widening `DELIVER_STAGE_IDS` was rejected: it would tell the worker-capture grader that a `/brainstorm` run is a valid ceremony hand-off, which is false.

## The block

```stage-status-block
stage: implement            # the emitting stage
milestone: M<N>             # or `none` on a milestone-less run
status: ok                  # ok | failed
summary:
  - one line per outcome the operator needs
gate:
  - pass 8123, fail 0, skip 16, baseline 16, delta 0
drive:
  - pass 12, fail 0, skip 0
e2e:
  - (none found)
follow_ups:
  - (none found)
```

**Fixed section order:** `stage`, `milestone`, `status`, `summary`, `gate`, `drive`, `e2e`, `follow_ups` — never reordered, never omitted. `stage`, `milestone` and `status` are scalars; the five list-bearing sections keep their heading and carry the literal fallback line `- (none found)` when there is nothing to report, because a dropped section and an empty one read identically to an operator and only one of them is honest.

**The `gate:` row's skips carry IDENTITIES, not just a count.** The capture behind the `gate:` section MUST supply `skipNames` — built by `captureGateRun`, the same READ side `/implement` step 14 and `/deliver` both order — so `evaluateSkipDelta` names WHICH skips changed instead of comparing counts alone. Supplying no `skipNames` leaves that function on its scalar path: a silently count-only comparison, in which a run that silences one test while un-silencing another reads as a clean pass. The read side is a front door a reader can copy, so this run's identities are obtainable and not merely required:

```sh
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_capture.ts <projectRoot>
```

## The six adoption rules

`verifyStageReportAdoption` layers these on top of `verifyStageStatusBlock`. When the list grows, this heading is the first thing that goes stale — see `docs/prose-altitude.md` § Counting a rule set.

1. **The prose lead-in is capped at 12 lines.** At most twelve lines of narration may precede the fence opener — `PROSE_LEAD_IN_LINE_CAP`, derived as `STAGE_REPORT_LINE_CAP - ADOPTED_FENCE_LINE_CAP - 2` (40 − 26 − 2) rather than typed, so the lead-in allowance and the two budgets it was carved out of cannot drift apart. Past that the block is riding beneath the narration instead of replacing it.
2. **Narration beside the block is a refusal, not a style note.** A report that reinstates its former multi-paragraph summary above a compliant block fails adoption even though the block itself grades clean — that was the rejected alternative at design time.
3. **Exactly one block per report.** The count rule has a single owner: the refusal is `verifyStageStatusBlock`'s, in its own words.
4. **The block is the LAST thing in the report, other than the cap-exempt sections below.** Nothing non-blank follows the closing marker except a section named in `CAP_EXEMPT_SECTIONS` for that stage, **and no more of it than that section's own renderer emits** — its budget, below. Three shapes are admitted inside a section: its heading, its list rows, and the bare `name:` keys the shipped renderers emit (`gate:` / `drive:` / `e2e:`, three of them from the evidence renderer alone) — plus the mandated literal sentence an empty section carries, which the entry's renderer states. Prose under a correctly-headed section is still narration.
5. **The block names an ADOPTING stage.** `stage:` must be one of `ADOPTING_STAGES`; a missing value and a `/deliver` ceremony id are both refused, because that vocabulary rides the other banner.
6. **Capability tokens ride INSIDE the block.** `locateCapabilityTokens(report)` splits the `spec_write_*` / `branch_gate_*` / `report_issue_*` family (registered in `/spec-write` § 7's static map) into `inBlock` and `outsideBlock`; a token left loose in the prose is a token the block does not carry, and is a reason of its own.

**The cap-exempt sections (`CAP_EXEMPT_SECTIONS`).** The lead-in cap governs FREE-FORM NARRATION alone; the structured sections earlier milestones mandate are exempt from it. The list is closed, lives in `adapters/_shared/src/stage_block_adoption.ts`, and every entry carries a `requiredBy` citation that must RESOLVE — a real declarer or a real pin, checked by `resolveExemptCitation`; a citation that names a heading only inside a `//` comment is refused, because a comment is not a pin. **Exempt is not optional:** a listed section that stops being emitted is a violation in its own right, graded by `scanStageBlockAdoption` from the other direction, because a carve-out checked one way is unguarded the other way.

**Every cap-exempt section has a BUDGET, and it is derived.** `exemptSectionBudget(entry)` is `entry.renderMax().length` — the section as its own shipped renderer emits it, read off the renderer rather than typed beside the entry, so a renderer that grows a line grows its budget on the same commit and the two can never disagree. **The budget is funded ONCE PER REPORT, per heading** — not once per occurrence: an exempt heading owns at most that many non-blank lines across the whole report, however many times it appears. Every line past the budget is narration again, faces the whole-report cap like any other line, and is refused by a reason naming the section and the number. **And a repeated exempt heading is refused outright, by name**, because the carve-out is a closed list of sections whose own renderers emit them exactly once and whose ABSENCE is already a violation — so repetition must not be the loophole absence is not, and the smallest duplicate (two occurrences at their exact rendered size) sits under the ceiling where no line-counting rule could reach it. Placement is unaffected: *different* owed sections may still sit on either side of the block, each appearing once. `## Verification evidence` is budgeted 7 (its heading, three `name:` keys and their rows) and `## Advisory notes` 2 (its heading and one line) — which is why the advisory line is bounded to the first few notes and cites `.dpt/ledger/advisory-notes.md`, where every run appends the full list.

**So an accepted report has a stated ceiling:** `maxAdoptedReportLines(stage)` = `STAGE_REPORT_LINE_CAP` plus every budget the stage owes — **49 lines for `/implement`** (40 + 7 + 2), and a flat 40 for a stage that owes no section at all. The bound shipped absent for one release, and the hole it left is worth stating: a maximal legal 49-line report plus 120 narration paragraphs wearing list markers under `## Advisory notes` ran 169 lines and graded clean against the 40-line cap. Bounding it PER OCCURRENCE left the same hole one restructuring away — 50 copies of `## Advisory notes` ran 124 lines and still graded clean — which is why the funding is per report.

## How a stage FITS

The rules above are what the grader REFUSES. This section is what an author DOES about it — stated here once so the eleven point at it rather than each inventing a shape. It adds no budget and raises no cap; a report that needed one would be the failure this contract exists to remove.

1. **The lead-in cap governs GENUINE NARRATION only.** Per-item content — a manifest table, an AC checklist, a file list, a drift table, a per-command row — is not narration and does not belong above the fence. It rides inside the block as `summary:` rows, where only the fence budget and the whole-report cap apply. That is what the block was built for.
2. **Where a list can exceed its budget, BOUND IT AND STATE THE TOTAL** — `first 3 of 41`, `first 6 of 25`. The operator keeps the magnitude and loses only the tail, and the tail stays recoverable from the artifact holding it in full (the manifest, the FR files, `metadata.json`, `.dpt/ledger/advisory-notes.md`). **A list that just stops is a silent truncation and is refused** — the lossy shape `renderAdvisoryNotes` was written against. A list bounded by construction (`/report-issue`'s three payload files, `/brainstorm`'s 2–3 sentences) needs no `first N of M` row: there is no tail to lose. **"Fixed" is not the same as bounded** — `/upgrade`'s migration registry was called bounded by construction on that reading, and it grows by an entry every migration milestone, so it has a tail and now carries a `first 3 of <A>` row like any other growing list. **What must never be bounded away is a FAILURE** — a failed command, a CONCERN criterion, a missing or partial AC. Sample the clean rows; name every gap.
3. **Where the content cannot fit AT ANY SIZE, the section that mandated it is SUPERSEDED, in its own words** — the shape `/setup` already uses: reference material to surface inline while the skill runs, not verbatim content the closing report reproduces beneath the fence. The report then carries counts plus a bounded sample. Superseding is a decision recorded on the mandating section, never a section quietly dropped. Where the content is a fixed floor no sampling can shrink — `scrubSecrets` emits one row per `SECRET_PATTERNS` entry regardless of match count — the report carries an AGGREGATE and CITES the artifact holding the breakdown, and that citation must resolve to a file the run really writes.
4. **Do NOT raise a cap to make a report fit.** `PROSE_LEAD_IN_LINE_CAP` is derived, so raising it silently moves the whole-report budget — the drift the derivation exists to prevent. A budget satisfied by making the report useless is not satisfied: if a stage cannot fit once bounded, that is a finding to raise, not a bound to shrink to one row.

The worked example is `plugins/dev-process-toolkit/tests/fixtures/stage-block-adoption/stage-report.txt` — an honest `/implement` report carrying all eight step-14 mandates inside the fence, 41 AC rows and 22 files rendered as `first 3 of 41` / `first 3 of 22`, with the fence body at 25 of its 26.

## The eleven adopting stages

The AUTHORITATIVE list is `ADOPTING_STAGES` in `adapters/_shared/src/stage_block_adoption.ts`, and the scanner and probe read it from there. Other surfaces do spell the eleven out again on purpose: a test suite states them independently (a test that read the const and compared it to itself would pass on any list at all), and STE-533's acceptance criteria enumerate them too. The names, because a reader of this contract needs to know who is bound by it: `best-practices`, `brainstorm`, `deps`, `gate-check`, `implement`, `report-issue`, `setup`, `spec-archive`, `spec-review`, `spec-write`, `upgrade`. Should this prose and the const ever disagree, the const is right and this line is the bug.

The boundary is exactly the set of skills that already carried a closing-summary contract, so each has an existing contract to **supersede** rather than a new obligation to acquire. It is deliberately **not** the `/deliver` stage vocabulary (`DELIVER_STAGE_IDS`): that omits `brainstorm` and three of its five members have no closing summary at all. A stage absent from the eleven — `/pr`, `/docs`, `/deliver`, `/simplify` — is out of scope **by declaration**, not by oversight, and the scanner is silent about it.
