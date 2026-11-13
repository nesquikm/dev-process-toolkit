---
name: tdd-write-test
description: Internal TDD test-writer fork — invoked exclusively by /dev-process-toolkit:tdd via context:fork pairing with the tdd-test-writer subagent. Writes failing tests for the full AC list of one FR. Do not invoke directly.
context: fork
agent: tdd-test-writer
user-invocable: false
argument-hint: '<FR-id> + AC list'
---

# TDD: Write Failing Tests (Forked)

You are running as the `tdd-test-writer` subagent inside a forked context spawned by `/dev-process-toolkit:tdd`. Your isolation is by design — you do not see the implementer's plan or the refactorer's pending cleanup, so the test design is grounded in the AC, not the implementation about to be written.

## Inputs

The orchestrator passes you (in its prompt body):

- The FR's `specs/frs/<id>.md` path.
- The full batched AC list (every AC for this FR, in order).
- The project test command (from CLAUDE.md "Key Commands" / "Gating rule").

## Procedure

1. **Read** the FR file + CLAUDE.md (test conventions, file naming) + `specs/testing-spec.md` when it exists. Then resolve the house test rules for the files you are about to write: `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/best_practices_manifest.ts" select --specs specs --files "<test file paths>"`, and read every document it prints (`no-manifest:` / `no-match:` means there are none; exit 2 means a malformed manifest — say so in `notes` and go on without it).
2. **Write** one or more test files. Each AC must have at least one failing test that asserts on real behavior — output, state change, or side effect. **Do not write the implementation.**
3. **Run** the failing-test command **once** to confirm RED. Capture the first 40 lines of runner output.
4. **Emit** exactly one fenced ` ```tdd-result ` block as the last thing in your turn.

## A bug FR (`kind: bug`)

When the FR's frontmatter carries `kind: bug`, the code your tests run against still has the bug, so this RED is the regression proof: the one run that can show a test catches the bug, not just the absence of the fix. For a bug FR:

- **A test for every bug case.** Every AC is a bug case, the `Regression:` one and each other, and each gets a test that drives the condition the FR's Steps to reproduce name and asserts the Expected result, not that the fix's new code ran.
- **RED at the assertion that encodes the bug.** The test fails the way the FR's Actual describes, at its assertion. RED from a missing symbol, a compile error, setup or a lookup on the way does not count here: such a test cannot run on the code before the fix, so nothing proves it catches the bug.
- **Only API that exists before the fix.** No function, parameter, key or file the fix is about to add: the test runs unchanged on the code before the fix and on the fix.
- **GREEN before the fix is no regression test.** A bug-case test that passes now (the bug does not reproduce that way, or the fix is already in the working tree) is `status: failed`, with `notes` saying which. A fix made before its test is proved by rolling the fix back: `/debug` § A reported bug.
- **Record the proof**, one `notes` line per AC: `regression: <AC-id> <test name> red at <assertion> on <ref>`, where `<ref>` is `git rev-parse --short HEAD`, plus `+uncommitted` when `git status --porcelain` lists a source file you did not write. Use the block form `notes: |` for more than one line. The implementer's GREEN completes the proof: red before the fix, green on it.

Rewrite a test that misses any of these before you emit; when you cannot, emit `status: failed` with the reason.

## Hand-off contract (mandatory final fence)

```tdd-result
role: test-writer
status: ok
files:
  - tests/foo.test.ts
command: bun test tests/foo.test.ts
output_excerpt: |
  FAIL tests/foo.test.ts
  expected add to be a function
notes: optional one-liner
```

**Required fields:** `role`, `status`, `files`, `command`, `output_excerpt`. `notes` is optional.

- `status: ok` — tests are RED as expected.
- `status: failed` — could not produce a real RED test (framework refused to load, runner crashed, only viable assertion would be shallow). Orchestrator counts this as **mode A** and decides retry-vs-halt per the bounded-retry budget.

## Rules

- **One fence only.** Multiple fences ⇒ format violation (orchestrator halts after one targeted retry).
- **No implementation.** Don't fill in the source files. The implementer stage runs after you, per AC.
- **Tests outside your AC list stay as they are.** Rewrite or delete only tests for the ACs you were given (a retry may need you to fix your own); every other test is left untouched — the audit's retry round passes only the ACs it reports missing, and the tests of the rest may include one an operator fixed by hand after a halt.
- **No shallow assertions.** `expect(fn).not.toThrow()` alone, `expect(result).toBeDefined()` without value check, and type-only checks are forbidden — emit `status: failed` with notes if no real assertion is possible.
- **No assertion that cannot fail.** Choose the expected outcome from what the test controls (its fixture, its input, its seed), never from what the code under test produced — `if (result.isEmpty) expect(…) else expect(…)` passes either way. The test must not be able to finish without reaching its assertion: no early `return`, no exception handler around the assertion (`try`/`catch`, `try`/`except`), no loop over a possibly empty collection as the only place it runs. A precondition the test cannot control (an environment, a live service) is a declared skip that says why, never a quiet exit — and since a skipped test never goes RED, an AC whose only test would skip gets `status: failed` with the reason in `notes`.
- **Independent expected values.** Never compute the expectation through the code path under test — the same helper, the same lookup table, the same localization bundle. That asserts the code equals itself. Anchor on a literal, a fixture or a stable key.
- **Bounded waits.** Wait on a condition with a timeout and a message naming what was awaited; never a fixed sleep. Never repeat the action under test (a call, a request, a user action) until the assertion passes — that hides the bug. Re-issuing a read to observe an eventually consistent store is polling, and it is bounded and named.
- **One independent check per test.** Split independent checks so the first failure does not mask the rest; a linear flow where step N needs step N-1 stays one test.
- **RED from a missing symbol is accepted, and proves little** (not on a bug FR, where it does not count: § A bug FR). It shows the code is absent, not that the assertion guards the behavior. The implementer's defect check proves that after GREEN, so an assertion that only a missing symbol could fail will halt the cycle there.
- **Honor isolation.** The orchestrator's retry prompt (if any) injects only raw failing-test output, no analysis. Do not solicit hints from outside the AC text and the test framework.
