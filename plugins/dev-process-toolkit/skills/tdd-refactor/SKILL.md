---
name: tdd-refactor
description: Internal TDD refactorer fork — invoked exclusively by /dev-process-toolkit:tdd via context:fork pairing with the tdd-refactorer subagent, exactly once at end of FR after all ACs are GREEN. Do not invoke directly.
context: fork
agent: tdd-refactorer
user-invocable: false
argument-hint: '<changed-files list>'
---

# TDD: Refactor (Forked)

You are running as the `tdd-refactorer` subagent inside a forked context spawned by `/dev-process-toolkit:tdd`, **exactly once per FR after every AC is GREEN**. You see the file list of what shipped but not the per-AC implementation reasoning.

## Inputs

The orchestrator passes you (in its prompt body):

- The list of source files modified across the FR's per-AC implementer runs.
- The full project test command (the gate command from CLAUDE.md).

## Procedure

1. **Read** CLAUDE.md and the changed source files.
2. **Run** the full project test command to confirm GREEN baseline.
3. **Refactor** for clarity / cross-AC deduplication / pattern consistency. Examples:
   - Hoist a duplicated helper used by two AC implementations.
   - Rename a confusingly-named symbol introduced by an early AC.
   - Pull a cross-cutting type into a shared module.
4. **Re-run** the full test command. Tests must still be GREEN — that is your correctness gate.
5. **Emit** exactly one fenced ` ```tdd-result ` block as the last thing in your turn.

**Empty refactor is fine.** If there's nothing worth changing, return `files: []` with a notes line.

## Hand-off contract (mandatory final fence)

```tdd-result
role: refactorer
status: ok
files:
  - src/foo.ts
  - src/shared.ts
command: bun test
output_excerpt: |
  PASS — 47 of 47
notes: hoisted shared validate() helper
```

**Required fields:** `role`, `status`, `files` (may be empty list), `command`, `output_excerpt`. `notes` is optional.

- `status: ok` — tests still GREEN after your changes.
- `status: failed` — your refactor broke a test. Orchestrator counts this as **mode C** and decides retry-vs-halt per the bounded-retry budget.

## Rules

- **One fence only.** Multiple fences ⇒ format violation.
- **Don't modify tests.** Your gate is "tests still pass." If a test seems wrong or brittle, emit `status: failed` and explain in `notes`.
- **Once-at-end batching.** You only run after every AC is GREEN. The single global pass sees cross-AC duplication that per-AC refactor wouldn't catch.
