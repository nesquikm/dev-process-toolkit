# `deliver-stage-result` capture fixtures — PROVENANCE

**These three files are hand-authored MODELS of a worker stage-report emission.
They were not harvested from a `/deliver` worker run.** Read this before citing
them as evidence for AC-STE-492.4.

| File | Role |
|---|---|
| `worker-stage-report.txt` | a well-formed capture — the predicate must ACCEPT it |
| `worker-stage-report-no-fence.txt` | mutation 1: the fence removed, the literal token deliberately kept in prose so a token-grep predicate cannot pass it |
| `worker-stage-report-reordered.txt` | mutation 2: all eight sections present, order broken |

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

**M133/STE-516 narrows that target; it does not hit it.** The deferred half is
still open — no `/deliver`-spawned worker has emitted any of these files. What
changed is what the eventual genuine capture has to carry: a stage whose chain
held a `(worker)`-placement step now owes a spawn receipt, so the verbatim
emission that replaces `worker-stage-report.txt` must carry one too, or it is
not a valid capture of a spawned stage.

## The spawn receipt (M133 / STE-516)

All three files carry the receipt line

```
  - spawn: handle=m133-implement@01K5X7QW2M8ZC4 ledger=/Users/ns/.agent-toolkit/spawn/ledger.json owned=0
```

verbatim — the same bytes the M133 suite renders, so the fixtures and the
generated captures agree on one shape rather than two. It is an **indented
`summary:` item, never a ninth section**: `topLevelKeys` is anchored at column 0,
so section detection cannot see it and the fixed eight-section order the
reordered mutation exists to test is not reopened. `handle`/`ledger` name a
`m133-implement` worker rather than an `m129-` one because the receipt is
STE-516's artifact, not STE-492's; the handle is an opaque token
(`adapters/_shared/src/spawn_receipt.ts` imposes no shape on it) and the value
is shared with the suite deliberately, so that grading a mutation against the
resolved handle produces no handle-mismatch reason of its own.

That last point is the discriminating-power invariant, and it is checked, not
assumed: adding the receipt left every fixture's reason set **byte-identical**.
The genuine file still verifies with `reasons: []`; mutation 1 still fails with
exactly one reason, the missing fence; mutation 2 still fails with exactly one
reason, the broken order. A mutation that had started failing for a new reason
would have lost the thing it was built to test.

In mutation 1 the receipt lives in **prose**, for the same reason the
`deliver-stage-result` token does: a receipt predicate that grepped lines
instead of walking the fence would be passed by that file, so it cannot be
written that way. `verifyDeliverStageCapture` returns on the missing fence
before any receipt is looked for, which is why the reason set is unchanged.

## Keeping the model honest

The `gate:` line carries this tree's real numbers at authoring time
(8067 pass / 0 fail / 16 skip, against a 16-skip baseline, so delta 0). If it ever
drifts far from the current gate, that is a signal the model is stale — not that
the predicate is wrong. Since STE-510 the predicate does read the three evidence
sections' list content: a counts line must carry `pass`, `fail` and `skip` (plus
`baseline` and `delta` in `gate`), while `- (none found)` stays legal everywhere.
See `adapters/_shared/src/deliver_stage_capture.ts`.
