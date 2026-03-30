---
name: tdd
description: Execute TDD cycle for a specific test file or feature. Runs RED (write failing test) → GREEN (implement) → VERIFY (all gates pass). Use when building features following TDD methodology.
argument-hint: '<test-file-path or feature description>'
---

# TDD Cycle

Execute a TDD workflow for: `$ARGUMENTS`

## Process

### 1. RED — Write Failing Tests

- Read CLAUDE.md and relevant source files to understand existing patterns
- If specs exist in `specs/`, read relevant requirements
- Write test(s) following project test conventions
- Run the test and confirm it FAILS (red)
- If the test file already exists and passes, skip to VERIFY

### 2. GREEN — Implement

- Write the minimum code to make tests pass
- Follow project patterns from CLAUDE.md
- Run the specific test file and confirm it PASSES (green)

### 3. VERIFY — Gate Check

Read the project's CLAUDE.md for the gate check commands. If not specified, use typical commands for the stack:
<!-- ADAPT: If copying this skill manually, replace with your project's commands -->
- Run typecheck (e.g., `npm run typecheck`, `fvm flutter analyze`, `mypy .`)
- Run lint (e.g., `npm run lint`, `ruff check .`)
- Run full test suite (e.g., `npm run test`, `fvm flutter test`, `pytest`)

Report each phase clearly. If VERIFY fails, fix issues and re-verify before declaring done.

If VERIFY fails and the cause is unclear, use `/dev-process-toolkit:debug` to investigate systematically before attempting fixes.

## Red Flags

If you hear yourself thinking any of these, stop and apply the rule anyway:

- "This is too simple to need a failing test first" → write the test
- "I'll test after — I just need to get it working" → write the test first
- "I know the tests pass, no need to re-verify" → run VERIFY and read the output
- "Just this once, then I'll go back to TDD" → there is no just this once
