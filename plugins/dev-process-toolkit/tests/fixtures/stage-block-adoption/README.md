# `stage-status-block` captured-report fixtures — PROVENANCE

**These two files are hand-authored MODELS of an adopting stage's rendered
closing report. They were not harvested from a live `/implement` run.** Read
this before citing them as evidence for STE-533's adoption claim.

| File | Role |
|---|---|
| `stage-report.txt` | a compliant capture — `verifyStageReportAdoption` must ACCEPT it |
| `stage-report-narrated.txt` | the DISCRIMINATING mutant: the former multi-paragraph narration reinstated above an otherwise byte-identical block |

## Why this model was rebuilt (M137 round 4)

The revision these files replace carried **four lines of prose and one summary
row**. It graded clean — and it graded clean because the grader measures the
BUDGET, not whether the report says what `skills/implement/SKILL.md` step 14
orders it to say. Step 14 mandates an AC checklist with pass/fail status, the
files created/modified, test coverage, self-review findings, spec changes,
drift findings, a gate result citing actual output, and the number of review
rounds used. The old model carried **none** of them.

That is the root cause of three rounds of budget arithmetic: **the contract
looked satisfiable because it was modelled by a report that skipped its own
mandates.** A fixture that models conformance by OMISSION certifies nothing,
and `tests/m137-ste-533-report-conformance-matrix.test.ts` now asserts this one
carries the mandated content so the omission cannot be rebuilt.

## The construction, stated because every number in it is load-bearing

`stage-report.txt` is an honest step-14 report at realistic size:

| Piece | Lines | Why |
|---|---|---|
| prose lead-in | 4 (3 narration) | under the 12-line `PROSE_LEAD_IN_LINE_CAP` |
| the fence | 25 of the 26-line `FENCE_LINE_CAP` | every mandated item rides INSIDE it |
| `## Verification evidence` | 7 | cap-exempt, budget read off `renderStageEvidence` |
| `## Advisory notes` | 2 | cap-exempt, budget read off `renderMaxAdvisoryNotes` |
| **total** | **40** | 31 counted lines against the 40-line whole-report cap |

Per-item content is **bounded, never silently truncated**: 41 ACs and 22 files
each render as `first 3 of <total>` with the total stated, so the operator keeps
the magnitude and knows the tail exists. That is the same discipline
`renderAdvisoryNotes` applies to advisory notes, applied to the two lists step
14 mandates but nothing renders for it.

## What this model proves that the old one hid

`verifyStageStatusBlock` — STE-532's grader — **REFUSES this file**: it counts
all 41 lines against its own 40-line whole-report cap, and it does not fund the
AC-STE-533.2a carve-out that `verifyStageReportAdoption` funds. So for
`/implement` the two graders disagree by exactly the 9 lines of the two exempt
sections, and an honest report lands in the gap.

The old model never exposed that, because at 29 lines it fit under both.

**Consequence for the narrated twin.** The twin has to carry ≥ 13 narration
lines to break the 12-line prose cap, and it carries the same fence and the same
two exempt sections, so its floor is `13 + 2 + <fence body> + 9` lines. STE-532's
raw cap is 40. An honest `/implement` report needs a fence body of at least 19
lines to carry step 14's eight mandates at one row each, which puts the twin at
43 lines minimum — over that cap **at any size, under any bound**. The twin is
therefore refused by STE-532 too, and the old "STE-532 accepts it, adoption does
not" framing is only constructible for a report that omits its mandates. What
still discriminates, and what the tests read, is the REASON: adoption refuses it
naming the prose lead-in cap, which is a rule STE-532 does not own.

## Isolation

The two files differ **only** by the reinstated narration — the mutant is the
clean file with ten narration lines inserted above the fence, and nothing else.
`blockOf(narrated) === blockOf(clean)` is asserted. If a later edit changes the
block in one of them, the red the mutant produces stops being attributable to
the narration rule and the pair stops measuring anything.

## Both files carry the sections `/implement` OWES

`## Verification evidence` and `## Advisory notes` are the two AC-STE-533.2a
cap-exempt sections. **Exempt is not optional**: a rendered `/implement` report
that drops them is not a compliant capture, so both files carry both sections
after the block, where AC-STE-533.6 permits them. An earlier revision of these
fixtures carried *neither* — and graded clean, which is exactly the direction a
carve-out checked only one way leaves unguarded.

## Provenance, stated because the label is load-bearing

Group 14's fixtures carry the same warning for the same reason. At runtime
smoke fixture group 15 grades a capture the driver wrote during the chain
(`/tmp/dpt-smoke-<tracker>-ste533-stage-report.txt`); these committed files pin
the grader in unit tests instead. A hand-authored model is not a harvest, and
the difference has to stay readable.

## Keeping the model honest

The `gate:` line carries this tree's real numbers at authoring time. If it ever
drifts far from the current gate, that is a signal the model is stale — not
that the grader is wrong. The `summary:` list deliberately carries a canonical
capability token (`best_practices_lens_applied`) INSIDE the fence, because
STE-533's claim is that the tokens survive the rewrite rather than being lost
with the prose that used to carry them.
