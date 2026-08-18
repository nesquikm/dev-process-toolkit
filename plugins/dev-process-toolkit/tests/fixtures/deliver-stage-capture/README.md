# `deliver-stage-result` capture fixtures — PROVENANCE

**These three files are hand-authored MODELS of a worker stage-report emission.
They were not harvested from a `/deliver` worker run.** Read this before citing
them as evidence for AC-STE-492.4.

| File | Role |
|---|---|
| `worker-stage-report.txt` | a well-formed capture — the predicate must ACCEPT it |
| `worker-stage-report-no-fence.txt` | mutation 1: the fence removed, the literal token deliberately kept in prose so a token-grep predicate cannot pass it |
| `worker-stage-report-reordered.txt` | mutation 2: all six sections present, order broken |

## Why the label is load-bearing

AC-STE-492.4 asks for a fixture group that asserts the fence against *"a captured
worker stage report — an artifact a worker actually produced"*. `specs/plan/M129.md`
books the gap between that wording and what could exist at implementation time as
an accepted **HIGH** risk, and says in terms: *"Do not close AC-STE-492.4 on the
hand-authored fixture alone."*

So the split, stated plainly:

- **Satisfied by these files.** The clause's *subject* is a capture rather than
  `/deliver`'s own prose, and the clause is falsifiable — mutation 1 and mutation 2
  both drive `verifyDeliverStageCapture` to `ok: false`, and the same predicate
  rejects `skills/deliver/SKILL.md` itself, which carries a well-formed
  `deliver-stage-result` example and would satisfy a naive token-grep.
- **Not satisfied by these files.** The *provenance* half. No `/deliver`-spawned
  worker has emitted any of them.

## Correcting the plan's stated validation path

`specs/plan/M129.md` proposes closing the deferred half *"against a genuine capture
in the next `/conformance-loop` run"*. **That run can never produce one.** The
conformance harness drives every child through `claude -p`, so stdin is non-tty by
construction; `/deliver` refuses non-tty **unconditionally, with no marker
carve-out** (`skills/deliver/SKILL.md`, FIRST ACTION clause), and smoke fixture
group 11 exists precisely to assert that refusal. No `/deliver` worker can exist
inside the harness, so no conformance run can ever harvest this artifact.

The only source is an **interactive** `/deliver` run. Closing the deferred half
means: run `/deliver` interactively, let a spawned worker complete a ceremony
stage, and replace `worker-stage-report.txt` with the worker's verbatim emission
(re-deriving both mutations from it). Delete this section when that lands.

## Keeping the model honest

The `gate:` line carries this tree's real numbers at authoring time
(8067 pass / 16 skip / 0 fail). If it ever drifts far from the current gate, that
is a signal the model is stale — not that the predicate is wrong. The predicate
never reads list-section content; see `adapters/_shared/src/deliver_stage_capture.ts`.
