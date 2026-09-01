# `stage-status-block` captured-report fixtures — PROVENANCE

**These two files are hand-authored MODELS of an adopting stage's rendered
closing report. They were not harvested from a live `/implement` run.** Read
this before citing them as evidence for STE-533's adoption claim.

| File | Role |
|---|---|
| `stage-report.txt` | a compliant capture — `verifyStageReportAdoption` must ACCEPT it |
| `stage-report-narrated.txt` | the DISCRIMINATING mutant: the former multi-paragraph narration reinstated above an otherwise byte-identical block |

## Why the second file is the load-bearing one

The mutant's fence is **byte-identical** to the clean file's, so a token-grep
passes it and so does STE-532's own `verifyStageStatusBlock` — it is a
well-formed status block by every rule STE-532 owns. Only the adoption policy
can tell the two apart, which is what makes this pair evidence for **this** FR
rather than for the last one. The clean file carries 4 lines of prose above the
fence; the mutant carries 14, over the 12-line prose lead-in cap.

Isolation is checked, not assumed: the two files differ **only** by the
reinstated narration. If a later edit changes the block in one of them, the red
the mutant produces stops being attributable to the narration rule and the pair
stops measuring anything.

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
