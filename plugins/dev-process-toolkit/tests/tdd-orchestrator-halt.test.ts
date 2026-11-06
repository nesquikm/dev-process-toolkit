import { describe, expect, test } from "bun:test";
import { formatHaltReport } from "../adapters/_shared/src/tdd_halt_report";

// STE-225 AC.5 + AC.8(d) — Halt-path report shape.
//
// On halt the orchestrator must emit a deterministic report containing
// (1) failure mode, (2) retry count, (3) last `tdd-result` block (or
// raw output if none), so the operator can resume manually. Also exits
// non-zero — that's an orchestrator-level concern, not the formatter's;
// the formatter only renders the body.

describe("AC-STE-225.5 / AC-STE-225.8(d) — halt report formatter", () => {
  test("renders failure mode + retry count + last block", () => {
    const out = formatHaltReport({
      mode: "B",
      role: "implementer",
      ac: "AC-STE-225.3",
      retryCount: 2,
      lastBlock:
        "```tdd-result\nrole: implementer\nstatus: failed\nfiles:\n  - src/x.ts\n```",
    });
    expect(out).toContain("failure mode: B");
    expect(out).toContain("retry count: 2");
    expect(out).toContain("role: implementer");
    expect(out).toContain("AC-STE-225.3");
    expect(out).toContain("```tdd-result");
  });

  test("falls back to raw output when no parseable block was emitted", () => {
    const out = formatHaltReport({
      mode: "E",
      role: "test-writer",
      retryCount: 2,
      rawOutput: "subagent ran out of turns at maxTurns: 8\nstdout: ...\n",
    });
    expect(out).toContain("failure mode: E");
    expect(out).toContain("raw output");
    expect(out).toContain("maxTurns: 8");
    expect(out).not.toContain("```tdd-result\n");
  });

  test("includes the orchestrator's NFR-10-shape Remedy line", () => {
    const out = formatHaltReport({
      mode: "A",
      role: "test-writer",
      retryCount: 2,
      rawOutput: "test passed when expected to fail",
    });
    expect(out).toMatch(/Remedy:/);
    expect(out).toContain("/dev-process-toolkit:tdd");
  });

  test("Context: line names the orchestrator skill for log searchability", () => {
    const out = formatHaltReport({
      mode: "D",
      role: "refactorer",
      retryCount: 2,
      rawOutput: "no fenced block",
    });
    expect(out).toMatch(/Context:/);
    expect(out).toContain("skill=tdd");
  });

  test("AC reference omitted when role is test-writer / refactorer (per-FR runs)", () => {
    const writer = formatHaltReport({
      mode: "A",
      role: "test-writer",
      retryCount: 2,
      rawOutput: "x",
    });
    expect(writer).not.toMatch(/\bAC[\s:-]/i);
    const refactor = formatHaltReport({
      mode: "C",
      role: "refactorer",
      retryCount: 2,
      rawOutput: "x",
    });
    expect(refactor).not.toMatch(/\bAC[\s:-]/i);
  });
});

// STE-296 AC.7 — `spec-gap` halt mode extends the 5-mode taxonomy.
//
// formatHaltReport accepts:
//   { mode: "spec-gap", role: "spec-reviewer", retryCount, missingAcs: string[], lastBlock? }
// and renders a report naming the unresolved missing ACs + the last classified
// spec-review block.
describe("AC-STE-296.7 — spec-gap halt mode (audit failure)", () => {
  test("renders spec-gap mode header with role spec-reviewer", () => {
    const out = formatHaltReport({
      mode: "spec-gap",
      role: "spec-reviewer",
      retryCount: 1,
      missingAcs: ["AC-STE-296.2", "AC-STE-296.5"],
    });
    expect(out).toContain("spec-gap");
    expect(out).toContain("spec-reviewer");
  });

  test("lists each unresolved missing AC in the report body", () => {
    const out = formatHaltReport({
      mode: "spec-gap",
      role: "spec-reviewer",
      retryCount: 1,
      missingAcs: ["AC-STE-296.2", "AC-STE-296.5"],
    });
    expect(out).toContain("AC-STE-296.2");
    expect(out).toContain("AC-STE-296.5");
  });

  test("includes the last spec-review block when present", () => {
    const out = formatHaltReport({
      mode: "spec-gap",
      role: "spec-reviewer",
      retryCount: 1,
      missingAcs: ["AC.1"],
      lastBlock:
        "```tdd-spec-review-result\nrole: spec-reviewer\nstatus: ok\nmissing_acs:\n  - AC.1\n```",
    });
    expect(out).toContain("```tdd-spec-review-result");
    expect(out).toContain("missing_acs");
  });

  test("Remedy + Context footer prose still present for spec-gap", () => {
    const out = formatHaltReport({
      mode: "spec-gap",
      role: "spec-reviewer",
      retryCount: 1,
      missingAcs: ["AC.1"],
    });
    expect(out).toMatch(/Remedy:/);
    expect(out).toMatch(/Context:/);
  });

  test("spec-gap mode description names the audit failure semantics", () => {
    const out = formatHaltReport({
      mode: "spec-gap",
      role: "spec-reviewer",
      retryCount: 1,
      missingAcs: ["AC.1"],
    });
    // Mode header line should include human-readable description, not just the token.
    expect(out).toMatch(/audit|spec.review|missing/i);
  });
});

// A failed defect check halts on its first attempt, so the report must not
// claim a retry budget ran out, and it must say what to do instead: the test
// is the defect, which the implementer was not allowed to touch.
describe("defect check — not-load-bearing halt report", () => {
  const report = () =>
    formatHaltReport({
      mode: "not-load-bearing",
      role: "implementer",
      ac: "AC-X.2",
      retryCount: 0,
      lastBlock:
        "```tdd-result\nrole: implementer\nstatus: failed\nfiles:\n  - src/x.ts\ncommand: bun test\noutput_excerpt: |\n  PASS\nnotes: defect check: dropped save() → still GREEN\n```",
    });

  test("names the mode with its own description", () => {
    const out = report();
    // The description, not the echoed notes line, has to name the check.
    expect(out).toMatch(/failure mode: not-load-bearing \([^)\n]*defect check[^)\n]*\)/);
    expect(out).toContain("AC: AC-X.2");
  });

  test("does not claim an exhausted retry budget", () => {
    const out = report();
    expect(out).not.toContain("bounded retry budget exhausted");
    expect(out.split("\n")[0]).toBe(
      "/dev-process-toolkit:tdd: halt — a test does not guard its acceptance criterion.",
    );
  });

  // The test-writer is not user-invocable, so the remedy is a hand fix to the
  // test. A plain re-run of the FR cannot follow it: Stage RED needs every
  // AC's test RED, and the ACs already implemented are GREEN — so the remedy
  // resumes at the halted AC, past Stage RED.
  test("the remedy points at the test, by hand, and resumes at the AC", () => {
    const remedy = report().split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("fix the test for AC-X.2 by hand");
    expect(remedy).toContain("fails at its assertion when the behavior breaks");
    expect(remedy).toContain("/dev-process-toolkit:tdd <FR-id> --resume-at AC-X.2");
    expect(remedy).not.toContain("test-writer");
  });

  // The orchestrator knows the FR; with it, the resume command is one the
  // operator can copy as it stands.
  test("with the FR id, the resume command names it", () => {
    const out = formatHaltReport({
      mode: "not-load-bearing",
      role: "implementer",
      fr: "STE-901",
      ac: "AC-STE-901.2",
      retryCount: 0,
    });
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("/dev-process-toolkit:tdd STE-901 --resume-at AC-STE-901.2");
  });
});

// A halt in Stage GREEN leaves the ACs before it implemented. Re-running the
// FR from the top dispatches the test-writer again over every test, so an
// implementer halt that names its AC points at the resume instead.
describe("an implementer halt names the resume at its AC", () => {
  test("mode B on an AC: the remedy offers --resume-at for that AC", () => {
    const out = formatHaltReport({
      mode: "B",
      role: "implementer",
      fr: "STE-901",
      ac: "AC-STE-901.3",
      retryCount: 2,
    });
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("/dev-process-toolkit:tdd STE-901 --resume-at AC-STE-901.3");
  });

  test("a test-writer halt has no AC to resume at, and offers no resume", () => {
    const out = formatHaltReport({ mode: "A", role: "test-writer", retryCount: 2 });
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).not.toContain("--resume-at");
  });

  // A run /implement started resumes through /implement, or the gate, review,
  // commit and tracker close never run, and the next /implement re-enters
  // Stage RED and halts in mode A.
  test("a run /implement started resumes through /implement", () => {
    const out = formatHaltReport({
      mode: "not-load-bearing",
      role: "implementer",
      entry: "implement",
      fr: "STE-901",
      ac: "AC-STE-901.2",
      retryCount: 0,
    });
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("/dev-process-toolkit:implement STE-901 --resume-at AC-STE-901.2");
  });
});

// After GREEN every test passes, so a re-run from Stage RED halts in mode A.
// A refactorer halt and an audit halt each name the stage to resume at.
describe("a halt after GREEN names the stage to resume at", () => {
  test("a refactorer halt resumes at refactor", () => {
    const out = formatHaltReport({ mode: "C", role: "refactorer", fr: "STE-901", retryCount: 2 });
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("/dev-process-toolkit:tdd STE-901 --resume-at refactor");
  });

  test("a spec-gap halt resumes at audit", () => {
    const out = formatHaltReport({
      mode: "spec-gap",
      role: "spec-reviewer",
      fr: "STE-901",
      retryCount: 1,
      missingAcs: ["AC-STE-901.4"],
    });
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("/dev-process-toolkit:tdd STE-901 --resume-at audit");
  });
});
