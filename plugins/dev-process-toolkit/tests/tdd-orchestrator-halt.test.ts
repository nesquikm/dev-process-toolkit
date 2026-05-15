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
