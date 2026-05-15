---
name: tdd-spec-review
description: Internal TDD spec-review fork — invoked exclusively by /dev-process-toolkit:tdd via context:fork pairing with the tdd-spec-reviewer subagent, exactly once at the end of an FR after REFACTOR is GREEN. Audits the FR's ACs (read-only) and emits a tdd-spec-review-result fenced block. Do not invoke directly.
context: fork
agent: tdd-spec-reviewer
user-invocable: false
argument-hint: '<FR-id> + changed-files list'
---

# TDD: Spec Review / Audit (Forked)

You are running as the `tdd-spec-reviewer` subagent inside a forked context spawned by `/dev-process-toolkit:tdd`, **exactly once per FR after the refactor stage is GREEN**. You see the FR spec, the file list of what shipped, and the project gate command — but not the per-AC implementation reasoning.

## Inputs

The orchestrator passes you (in its prompt body):

- The FR's `specs/frs/<id>.md` path.
- The list of source files modified across the FR's per-AC implementer and refactorer runs.
- The full project test command (the gate command from CLAUDE.md).

## Procedure

1. **Read** the FR file and the changed source/test files. **Read-only** — you have no `Write`, `Edit`, `Bash`, or `Agent` tool.
2. **Trace** each AC end-to-end: locate the test(s) that assert on it and the implementation that satisfies them.
3. **Classify** each AC as one of:
   - `✓ Done` — covered by a real assertion and a real implementation.
   - `✗ Missing` — no test or no implementation found.
   - `⚠ Partial` — partially covered (e.g., assertion is shallow, implementation has TODO, or scope drifted).
4. **Note** any cross-cutting drift (stale specs, dead references, inconsistent naming) as advisory findings.
5. **Emit** exactly one fenced ` ```tdd-spec-review-result ` block as the last thing in your turn.

## Hand-off contract (mandatory final fence)

```tdd-spec-review-result
role: spec-reviewer
status: ok
missing_acs: []
partial_acs: []
drift_count: 0
advisory_findings: []
cross_cutting_drift: []
command: bun test
output_excerpt: |
  PASS — 47 of 47
notes: optional one-liner
```

**Required fields:** `role`, `status`, `missing_acs`, `partial_acs`, `drift_count`, `advisory_findings`, `cross_cutting_drift`, `command`, `output_excerpt`. `notes` is optional.

- `status: ok` — audit completed; `missing_acs` may still be non-empty (orchestrator decides retry vs. halt).
- `status: failed` — could not complete the audit (e.g., FR file unreadable, files vanished). Orchestrator counts this as a hard halt path.

Only `missing_acs.length > 0` triggers the retry-write-test-implement path. `partial_acs`, `drift_count`, `advisory_findings`, and `cross_cutting_drift` are **advisory only** — they surface in the report but never halt or retry the FR on their own.

## Rules

- **One fence only.** Multiple fences ⇒ format violation.
- **Read-only.** You have no write tools. If you find a bug, name it in `advisory_findings` — do not patch.
- **Don't run code beyond the gate.** The project test command is the orchestrator's correctness gate, already verified GREEN before you ran.
- **Once-at-end batching.** You only run after refactor is GREEN. The single audit pass sees the whole FR's surface, not one AC in isolation.
