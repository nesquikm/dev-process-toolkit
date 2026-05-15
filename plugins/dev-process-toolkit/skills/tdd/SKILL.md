---
name: tdd
description: Multi-agent TDD orchestrator. Runs RED → GREEN → REFACTOR for one FR via three forked subagents (test-writer / implementer / refactorer) with a strict tdd-result hand-off contract, bounded retries, and a deterministic halt path. Replaces the previous single-context /tdd.
argument-hint: '<FR-id>'
---

# TDD Orchestrator (Multi-Agent)

Execute the TDD cycle for `$ARGUMENTS` (an FR ID — `STE-NNN`, ULID, or `specs/frs/<id>.md` path) by orchestrating three **forked-subagent** stages. Each stage runs in an isolated context paired via Claude Code's `context: fork` + `agent:` mechanism, so the test-writer cannot see the implementer's plan, the implementer cannot see other ACs' implementations, and the refactorer cannot see per-AC reasoning.

The orchestrator itself runs in the **main context** (no `context: fork` on this skill) so it can drive the loop, parse hand-off blocks, and halt on bounded-retry exhaustion.

## Architecture

| Stage         | Child skill         | Subagent             | Cycle granularity                     |
|---------------|---------------------|----------------------|----------------------------------------|
| RED           | `tdd-write-test`    | `tdd-test-writer`    | **once per FR**, batched across all ACs |
| GREEN         | `tdd-implement`     | `tdd-implementer`    | **once per AC** — N forks for N ACs     |
| REFACTOR      | `tdd-refactor`      | `tdd-refactorer`     | **exactly once** at end after all GREEN |
| AUDIT         | `tdd-spec-review`   | `tdd-spec-reviewer`  | **exactly once** at end, post-REFACTOR  |

Children carry `context: fork` + `user-invocable: false` + an `agent:` field naming the subagent. The orchestrator invokes them via the **Skill tool** with the rendered prompt body.

## Inputs

- `$ARGUMENTS` resolves to a single FR.
- The FR's ACs come from `specs/frs/<id>.md` § Acceptance Criteria.
- The project test command comes from CLAUDE.md (Key Commands / Gating rule).

## Procedure

### 1. Resolve the FR + collect ACs

Read `specs/frs/<id>.md`. Extract the AC list (every `AC-<prefix>.<N>` line under `## Acceptance Criteria`). This is the batched input for the test-writer and the per-AC dispatch list for the implementer.

### 2. Stage RED — invoke `tdd-write-test` once with the batched AC list

Pass the test-writer:

- The FR file path.
- The full AC list (batched — every AC, in order).
- The project test command (the failing-test command target).

The child fork runs in isolation with `tools: Read, Grep, Glob, Write, Edit, Bash` (allowlist; no `Agent`, no Web tools). It writes failing tests for every AC, runs them once to confirm RED, and ends with a single `tdd-result` fenced block.

### 3. Stage GREEN — invoke `tdd-implement` once per AC

For each AC in order:

- Pass the implementer **only** that AC's text + the failing-test command target.
- The child fork runs in isolation, writes the minimum code to turn the failing test GREEN, re-runs the command, and ends with a single `tdd-result` fenced block.

The orchestrator dispatches **N forks for N ACs** — each implementer invocation sees one AC, never the full list. This per-AC isolation is the load-bearing property: it stops the implementer from optimizing across ACs in ways the test-writer didn't anticipate.

### 4. Stage REFACTOR — invoke `tdd-refactor` exactly once at end of FR

After every AC is GREEN, run the refactorer **once** with the full list of source files modified across the per-AC implementer runs. The refactorer cleans up cross-AC duplication while keeping every test GREEN — empty refactor is a valid outcome (`files: []`).

The single-once-at-end batching is by design. Per-AC isolation matters most for the test-writer-cannot-see-implementation guarantee; refactor isolation matters less because by then all tests are GREEN and the refactorer's correctness gate is "tests still pass." A single global pass costs less and sees cross-AC duplication that per-AC refactor wouldn't catch.

### 5. Stage AUDIT — invoke `tdd-spec-review` exactly once after REFACTOR

After `tdd-refactor` returns `status: ok` **and** re-running the refactor command still shows GREEN, the orchestrator forks `tdd-spec-review` exactly once — at end of FR, after every AC is GREEN and the cross-AC refactor pass has landed. The audit fork is the final stage in the state machine and runs **post-REFACTOR**, never per-AC.

Pass the spec-reviewer:

- The FR file path (so it can re-read the canonical AC list as authored).
- The AC list (the same batched list handed to the test-writer).
- The project test command (so it can confirm the FR is still GREEN before classifying).

The child fork runs in isolation with a read-only toolset (no `Write`, no `Edit`, no `Bash`, no `Agent`). It traces each AC to the implementation + tests, classifies each as ✓ Done / ✗ Missing / ⚠ Partial, scans for cross-cutting spec drift, and ends with a single `tdd-spec-review-result` fenced block.

The orchestrator parses the returned block via `parseTddSpecReviewBlock(...)` from `adapters/_shared/src/tdd_spec_review_result.ts` (the AC.3 helper). It then branches on `missing_acs.length`:

- **`missing_acs.length === 0` ⇒ exit-ok.** The audit passed. `partial_acs`, `drift_count`, `advisory_findings`, and `cross_cutting_drift` are **advisory only** — they are surfaced in the human-readable report but do not halt the FR or consume the retry budget. A clean first audit always exits successfully regardless of advisory fields.
- **`missing_acs.length > 0` on the first audit ⇒ retry path.** The orchestrator re-enters the RED→GREEN sub-loop for the missing ACs only (write-test + implement), capped at a single audit-round retry (`recordAuditRoundFailure(...)` budget, cap = 1).
- **`missing_acs.length > 0` on the second audit ⇒ halt.** The orchestrator emits a halt report listing the unresolved `missing_acs` and exits non-zero. The audit-round retry budget is independent from the per-AC semantic budget — burning per-AC retries does not consume audit retries, and vice versa.

The AUDIT stage's halt path uses the same `formatHaltReport` channel as the other stages, with `mode` set to the audit-specific failure mode and `missingAcs` populated from the returned block.

## Hand-off contract — the `tdd-result` fenced block

Every child ends its turn with **exactly one** fenced ` ```tdd-result ` block, parsed deterministically by `parseTddResultBlock(...)` from `adapters/_shared/src/tdd_result.ts`. Locate via `extractTddResultBlock(stdout)` against the child's full output.

Required fields per role:

```tdd-result
role: test-writer | implementer | refactorer
status: ok | failed
files:
  - path/to/file.ts
command: bun test path/to/file.test.ts
output_excerpt: |
  first 40 lines of test runner output
notes: optional one-liner
```

- `role` must equal the role being invoked (test-writer / implementer / refactorer).
- `files` may be empty (`[]`) for the refactorer when no refactor was needed.
- `output_excerpt` is the first 40 lines of test runner output — must show RED for test-writer, GREEN for implementer + refactorer.
- `notes` is optional; everything else is required.

## Failure modes (5 modes)

The orchestrator distinguishes:

- **(A) false-RED** — test-writer's `tdd-result` says `status: ok`, but re-running its `command` does not produce a failure (the tests don't actually fail).
- **(B) implementer can't reach GREEN** — implementer's `tdd-result` says `status: failed`, or `status: ok` but re-running the command shows RED.
- **(C) refactorer breaks GREEN** — refactorer's `tdd-result` says `status: failed`, or `status: ok` but re-running the command shows RED.
- **(D) format violation** — `extractTddResultBlock` or `parseTddResultBlock` rejects the child's output (no fenced block, multiple fences, missing role, missing required field, wrong role for the invocation, invalid status).
- **(E) maxTurns exhaustion** — child stopped after `maxTurns: 8` without producing a parseable block. Counts as a failed attempt under whichever of (A) / (B) / (C) applies to the calling role.

## Retry budget — bounded

Backed by `recordTddFailure(...)` from `adapters/_shared/src/tdd_retry_state.ts`:

- **Modes A / B / C / E (semantic):** max 2 attempts per role per AC. After the second failure, halt.
- **Mode D (format):** single targeted retry — re-prompt with "re-emit your last message with a valid `tdd-result` block." After the second format failure, halt.

Format and semantic budgets are independent — a format violation does not consume the semantic-failure budget.

### Retry prompt — isolation rule (load-bearing)

When retrying a child after a semantic failure, the orchestrator's retry prompt **injects only raw failing-test output** — no orchestrator-side analysis, no "the test fails because X — fix Y." Anything more leaks information that defeats the test-writer-cannot-see-implementation guarantee. The retry prompt template is:

```
The previous attempt did not satisfy the success criterion. Below is the
raw output of running the failing-test command. Re-emit your work as a
single `tdd-result` fenced block at the end of your turn.

<raw stdout/stderr from the test runner — no analysis>
```

For a mode-D format violation, the retry prompt is even narrower: "re-emit your last message with a valid `tdd-result` fenced block at the end of your turn." No semantic re-prompt.

## Halt path

When the bounded budget is exhausted, the orchestrator:

1. Calls `formatHaltReport(...)` from `adapters/_shared/src/tdd_halt_report.ts` with `{ mode, role, ac, retryCount, lastBlock?, rawOutput? }`.
2. Emits the rendered report (failure mode + retry count + last `tdd-result` block, or raw output if no block was emitted).
3. Exits non-zero — the halt is a real failure surfacing, not a routine pause.

## Pacing

The halt path **does** pause for the operator. This is intentional — the bounded-retry cap means halt only fires after a real failure. Routine TDD cycles (no retries needed) run end-to-end without operator interaction. `/implement` Phase 3 invokes this orchestrator inline.

## Rules

- Do NOT bypass the hand-off contract — `tdd-result` is the only return channel.
- Do NOT inject orchestrator-side analysis into retry prompts.
- Do NOT skip the per-AC implementer dispatch (one fork per AC; no batching).
- Do NOT run the refactorer per-AC — once at end of FR after all ACs are GREEN.
- Do NOT silently swallow format violations — surface mode D, retry once, halt.
- Do NOT modify or delete tests during the implementer/refactorer stage — if a test is wrong, the child emits `status: failed` and the operator decides.

## Red flags

- "I'll write the implementation alongside the tests for speed" → no — write tests in the test-writer fork only.
- "I'll skip the format-violation retry, just re-spawn the child" → no — single targeted retry, halt after that.
- "I'll feed the child my analysis of why its last attempt failed" → no — retry prompt injects only raw failing-test output.
