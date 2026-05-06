---
title: "feat(smoke): trivial add(a, b) for /tdd live smoke"
milestone: M-SMOKE
status: active
archived_at: null
tracker:
  linear: STE-SMOKE
created_at: 2026-05-06T00:00:00Z
---

# STE-SMOKE: feat(smoke): trivial add(a, b) for /tdd live smoke {#STE-SMOKE}

## Requirement

Provide a trivial fixture FR for the `/dev-process-toolkit:tdd` orchestrator headless live smoke (STE-225 AC.9). Single AC, single function, single test.

## Acceptance Criteria

- AC-STE-SMOKE.1: A function `add(a, b)` returns the sum of two numbers (`add(2, 3) === 5`).

## Technical Design

Implementation lives at `src/add.ts`, exporting `add(a: number, b: number): number`.

## Testing

A single test file at `tests/add.test.ts` asserts `add(2, 3) === 5` (and one or two additional cases). Test command: `bun test tests/add.test.ts`.

## Notes

This FR is fixture-only. It exists solely to give the live-smoke runner a trivial-but-real target for the multi-agent orchestrator. Behavioral assertions only — filename / phrasing variance from model nondeterminism is expected.
