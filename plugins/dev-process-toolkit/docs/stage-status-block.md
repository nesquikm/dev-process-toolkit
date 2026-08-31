# The stage status block

The one closing-summary shape every user-facing stage emits **instead of** narrating. Extracted here once — the shipped `docs/deliver-reference.md` precedent — so the eleven adopting skills point at a single contract in one line each rather than restating it eleven times against the NFR-1 line cap.

Grading lives in code, not in this file:

- `adapters/_shared/src/stage_status_block.ts` — `verifyStageStatusBlock(report, evidence)` grades one **rendered** report: fence presence, the eight-section fixed order, the whole-report line cap (`STAGE_REPORT_LINE_CAP` = 40), the empty-section fallback, and counts claimed with no capture behind them.
- `adapters/_shared/src/stage_block_adoption.ts` — `verifyStageReportAdoption(report, evidence)` layers the **adoption policy** on top of that grader, and `scanStageBlockAdoption(projectRoot)` reports which adopting skills still close with narration. It is a policy over the grader, never a second parser.

## The block

```deliver-stage-result
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

## The four adoption rules

1. **The prose lead-in is capped at 12 lines.** At most twelve lines of narration may precede the fence opener — `PROSE_LEAD_IN_LINE_CAP`, derived as `STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2` (40 − 26 − 2) rather than typed, so the lead-in allowance and the two budgets it was carved out of cannot drift apart. Past that the block is riding beneath the narration instead of replacing it.
2. **Narration beside the block is a refusal, not a style note.** A report that reinstates its former multi-paragraph summary above a compliant block fails adoption even though the block itself grades clean — that was the rejected alternative at design time.
3. **Exactly one block per report.** The count rule has a single owner: the refusal is `verifyStageStatusBlock`'s, in its own words.
4. **The block is the LAST thing in the report.** Nothing non-blank follows the closing marker.

Capability tokens (the `spec_write_*` / `branch_gate_*` / `report_issue_*` family registered in `/spec-write` § 7's static map) **survive the rewrite inside the block** — `locateCapabilityTokens(report)` splits them into `inBlock` and `outsideBlock`, and a token left loose in the prose is a token the block does not carry.

## The eleven adopting stages

The AUTHORITATIVE list is `ADOPTING_STAGES` in `adapters/_shared/src/stage_block_adoption.ts`; every code path — the scanner, the tests — reads it from there rather than re-listing it. The names are spelled out once more here, and only here, because a reader of this contract needs to know who is bound by it: `best-practices`, `brainstorm`, `deps`, `gate-check`, `implement`, `report-issue`, `setup`, `spec-archive`, `spec-review`, `spec-write`, `upgrade`. Should this prose and the const ever disagree, the const is right and this line is the bug.

The boundary is exactly the set of skills that already carried a closing-summary contract, so each has an existing contract to **supersede** rather than a new obligation to acquire. It is deliberately **not** the `/deliver` stage vocabulary (`DELIVER_STAGE_IDS`): that omits `brainstorm` and three of its five members have no closing summary at all. A stage absent from the eleven — `/pr`, `/docs`, `/deliver`, `/simplify` — is out of scope **by declaration**, not by oversight, and the scanner is silent about it.
