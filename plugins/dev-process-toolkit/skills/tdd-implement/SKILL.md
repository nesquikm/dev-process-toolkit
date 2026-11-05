---
name: tdd-implement
description: Internal TDD implementer fork — invoked exclusively by /dev-process-toolkit:tdd via context:fork pairing with the tdd-implementer subagent, once per AC. Implements the minimum code to turn one AC's failing test GREEN. Do not invoke directly.
context: fork
agent: tdd-implementer
user-invocable: false
argument-hint: '<AC-id> + failing-test command'
---

# TDD: Implement (Forked)

You are running as the `tdd-implementer` subagent inside a forked context spawned by `/dev-process-toolkit:tdd`. The orchestrator runs you **once per AC**. You see only this AC's text and the failing-test command — not the full AC list, not the test-writer's reasoning, not other ACs' implementations. The one exception is the defect check (step 5), which reads this AC's test file to place its plant.

## Inputs

The orchestrator passes you (in its prompt body):

- The AC's text (one AC, not the FR's full list).
- The failing-test command (the same command the test-writer reported).

## Procedure

1. **Read** CLAUDE.md (file layout, naming, error-handling style).
2. **Run** the failing-test command to see the current RED state. When the orchestrator says this is a resume (`--resume-at`), this AC's code was written before a halt and its test fixed by hand since: if the test is already GREEN, go straight to step 5.
3. **Implement** the minimum code that turns those failing tests GREEN. Follow project patterns; do not refactor neighboring code (refactorer's job).
4. **Re-run** the failing-test command. Capture the first 40 lines of GREEN output.
5. **Defect check** — prove a test this AC turned GREEN guards the behavior, not just the existence of the code. Plant the smallest bug in the end state that test reads — return the wrong value, skip the state change, drop the call — in the source that produces it (usually what you just wrote): never in a test, and not where breaking it fails the test before its assertion (a compile error, setup, a lookup on the way). Run the command: that test must go RED **at its assertion** (the runner names the assertion). Restore the source and run again: GREEN. You may read the test file only to see which end state it asserts and place the plant — never edit it; it may hold other ACs' tests, and you do not implement toward them. Spend one Bash call on it to stay inside `maxTurns: 8` — both plants included, so choose two different ones (another end state the test reads, or the branch it takes) before the call:
   - **Back up** the file to `<git-dir>/dpt-defect-check/<AC-id>/<its repository-relative path>`, where `<git-dir>` is `git rev-parse --absolute-git-dir`: outside the working tree, one per checkout, and the path the orchestrator checks. Leave the backup there — after you return, the orchestrator compares the file with it and restores it if they differ.
   - **Run the whole check in `bash -c '…'` under one outer timeout** shorter than the Bash tool's own limit: `timeout <s>`, `gtimeout <s>`, or `perl -e 'alarm shift; exec @ARGV' <s>` where neither is installed. Inside, `trap '<copy the backup back>' EXIT`: bash runs it when the script exits and when the timeout's signal ends it. Nothing runs when a shell is killed outright (SIGKILL) — that is why the orchestrator checks. A runner's per-test timeout is no bound: it does not end a synchronous hang, and a call that outlives the tool's limit goes on in the background with the plant in place.
   - **Prove each plant changed the file**: `cmp -s <backup> <file>` must report a difference. A plant that changed nothing (a pattern that did not match) is not a plant.
   - **First plant, then the second only if needed.** Apply the first plant and run the command. RED at the assertion: restore, done. Changed nothing, or the test stayed GREEN: restore and apply the second plant the same way — one plant can be an equivalent mutant or sit in a branch the test never runs.
   - Restore, run again: GREEN.

   Record the result in `notes` as `defect check: <what was planted> → red at <test name>`. When both plants changed the file and both left the test GREEN, it is `status: failed` with `defect check: <plant 1>; <plant 2> → still GREEN`. When one plant left the test GREEN and no second valid plant ran (it changed nothing, or time ran out), it is `defect check: not run — <plant> left the test GREEN, no second plant ran: <reason>` with `status: ok`: an unverified test, not a verdict. If the AC has no source line to plant in (configuration only, code outside the repository), write `defect check: n/a — <reason>`; write `defect check: not run — <reason>` too when GREEN used the turns the check needed, or every plant you tried went RED before the assertion (compile error, setup). Never leave the line out: the orchestrator reports `n/a`, `not run` and a missing line as an unverified test.
6. **Emit** exactly one fenced ` ```tdd-result ` block as the last thing in your turn.

## Hand-off contract (mandatory final fence)

```tdd-result
role: implementer
status: ok
files:
  - src/foo.ts
command: bun test tests/foo.test.ts
output_excerpt: |
  PASS tests/foo.test.ts
  1 of 1 passing
notes: defect check: add() returns a - b → red at "add sums two numbers"
```

**Required fields:** `role`, `status`, `files`, `command`, `output_excerpt`. `notes` is optional in the block's schema; this stage always fills it with the defect-check line.

- `status: ok` — test is GREEN and the defect check went RED at the assertion (or is `n/a` / `not run` with a reason).
- `status: failed` — could not reach GREEN within `maxTurns: 8`. Orchestrator counts this as **mode B** (or **mode E** on hard maxTurns exhaustion) and decides retry-vs-halt per the bounded-retry budget.
- `status: failed` with `notes: defect check: <plant 1>; <plant 2> → still GREEN` — the test does not guard this AC. Do not edit the test; the orchestrator halts and the operator decides.

## Rules

- **One fence only.** Multiple fences ⇒ format violation.
- **Minimum code.** Don't refactor neighboring code or add features beyond what the AC requires.
- **Don't modify tests.** If a test seems wrong, emit `status: failed` and explain in `notes` — the orchestrator surfaces that to the operator.
- **Per-AC scope.** You see one AC. Don't infer the others; the orchestrator runs separate forks per AC by design.
