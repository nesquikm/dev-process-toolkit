import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-225 AC.3 + AC.8(c) — Orchestrator batching invariant.
//
// The orchestrator runs:
//   - tdd-write-test  ⇒ exactly **once per FR** with the full AC list batched
//   - tdd-implement   ⇒ exactly **N times** for N ACs (one fork per AC)
//   - tdd-refactor    ⇒ exactly **once** after all ACs are GREEN
//
// The orchestrator is prose-only — its execution is shaped by the
// SKILL.md instructions. These tests assert the prose declares the
// batching invariant unambiguously so a model running the skill cannot
// drift to per-AC test-writing or per-AC refactoring.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const orchestratorPath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "tdd",
  "SKILL.md",
);

const body = readFileSync(orchestratorPath, "utf-8");

describe("AC-STE-225.3 — orchestrator batching invariant declared in prose", () => {
  test("test-writer is invoked exactly once per FR with the batched AC list", () => {
    expect(body).toMatch(/tdd-write-test[\s\S]{0,400}(once per FR|exactly once)/i);
    expect(body).toMatch(/(batch|all ACs|full AC list)/i);
  });

  test("implementer is invoked once per AC (per-AC fork)", () => {
    expect(body).toMatch(/tdd-implement[\s\S]{0,400}(per AC|one (fork|invocation) per AC|N (forks|times) for N ACs)/i);
  });

  test("refactorer is invoked exactly once at end after all ACs GREEN", () => {
    expect(body).toMatch(/tdd-refactor[\s\S]{0,400}(once at end|exactly once|end of FR|after all ACs (are )?GREEN)/i);
  });
});

describe("AC-STE-225.5 — orchestrator failure-mode + retry prose", () => {
  test("orchestrator names all five failure modes A–E", () => {
    for (const mode of ["A", "B", "C", "D", "E"] as const) {
      // Match `(A)` or `mode A` (case-sensitive on the letter so `e.g.`
      // doesn't false-match for mode E).
      expect(body).toMatch(new RegExp(`\\(${mode}\\)|mode ${mode}`));
    }
  });

  test("orchestrator declares max-2 semantic budget and single-format budget", () => {
    expect(body).toMatch(/max[\s-]2|2 attempts/i);
    expect(body).toMatch(/(single|one)[\s-](targeted )?retry|format violation/i);
  });

  test("retry prompt prose forbids orchestrator-side analysis (isolation)", () => {
    // Test-writer-cannot-see-implementation: retry prompt injects only
    // raw failing-test output. AC.5 requires this be load-bearing prose.
    expect(body).toMatch(/raw[\s-]failing[\s-]test|raw output|no orchestrator[\s-]side analysis/i);
  });

  test("halt path emits failure mode + retry count + last block (or raw)", () => {
    expect(body).toMatch(/halt[\s\S]{0,400}(failure mode|retry count|last (block|tdd-result))/i);
    expect(body).toMatch(/(non-zero|exit )/i);
  });
});

describe("AC-STE-225.4 — orchestrator hand-off contract prose", () => {
  test("orchestrator references the `tdd-result` fenced block by name", () => {
    expect(body).toMatch(/```tdd-result|tdd-result fenced/);
  });

  test("orchestrator names the parser entrypoints from adapters/_shared/src/", () => {
    expect(body).toMatch(/parseTddResultBlock|extractTddResultBlock|tdd_result/);
  });
});
