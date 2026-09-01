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

1. **The prose lead-in is capped at 12 lines.** At most twelve lines of narration may precede the fence opener — `PROSE_LEAD_IN_LINE_CAP`, derived as `STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2` (40 − 26 − 2) rather than typed, so the lead-in allowance and the two budgets it was carved out of cannot drift apart. Past that the block is riding beneath the narration instead of replacing it.
2. **Narration beside the block is a refusal, not a style note.** A report that reinstates its former multi-paragraph summary above a compliant block fails adoption even though the block itself grades clean — that was the rejected alternative at design time.
3. **Exactly one block per report.** The count rule has a single owner: the refusal is `verifyStageStatusBlock`'s, in its own words.
4. **The block is the LAST thing in the report, other than the cap-exempt sections below.** Nothing non-blank follows the closing marker except a section named in `CAP_EXEMPT_SECTIONS` for that stage — its heading and its list rows, and nothing else: prose under a correctly-headed section is still narration.
5. **The block names an ADOPTING stage.** `stage:` must be one of `ADOPTING_STAGES`; a missing value and a `/deliver` ceremony id are both refused, because that vocabulary rides the other banner.
6. **Capability tokens ride INSIDE the block.** `locateCapabilityTokens(report)` splits the `spec_write_*` / `branch_gate_*` / `report_issue_*` family (registered in `/spec-write` § 7's static map) into `inBlock` and `outsideBlock`; a token left loose in the prose is a token the block does not carry, and is a reason of its own.

**The cap-exempt sections (`CAP_EXEMPT_SECTIONS`).** The lead-in cap governs FREE-FORM NARRATION alone; the structured sections earlier milestones mandate are exempt from it. The list is closed, lives in `adapters/_shared/src/stage_block_adoption.ts`, and every entry carries a `requiredBy` citation that must RESOLVE — a real declarer or a real pin, checked by `resolveExemptCitation`; a citation that names a heading only inside a `//` comment is refused, because a comment is not a pin. **Exempt is not optional:** a listed section that stops being emitted is a violation in its own right, graded by `scanStageBlockAdoption` from the other direction, because a carve-out checked one way is unguarded the other way.

## The eleven adopting stages

The AUTHORITATIVE list is `ADOPTING_STAGES` in `adapters/_shared/src/stage_block_adoption.ts`, and the scanner and probe read it from there. Other surfaces do spell the eleven out again on purpose: a test suite states them independently (a test that read the const and compared it to itself would pass on any list at all), and STE-533's acceptance criteria enumerate them too. The names, because a reader of this contract needs to know who is bound by it: `best-practices`, `brainstorm`, `deps`, `gate-check`, `implement`, `report-issue`, `setup`, `spec-archive`, `spec-review`, `spec-write`, `upgrade`. Should this prose and the const ever disagree, the const is right and this line is the bug.

The boundary is exactly the set of skills that already carried a closing-summary contract, so each has an existing contract to **supersede** rather than a new obligation to acquire. It is deliberately **not** the `/deliver` stage vocabulary (`DELIVER_STAGE_IDS`): that omits `brainstorm` and three of its five members have no closing summary at all. A stage absent from the eleven — `/pr`, `/docs`, `/deliver`, `/simplify` — is out of scope **by declaration**, not by oversight, and the scanner is silent about it.
