// Tests for /gate-check probe `spec_research_result_shape`
// (STE-230 AC-STE-230.12). Severity: error. Probe #41.
//
// Builds tmp fixtures under .dpt-locks/<ulid>/spec-research-result.txt
// and asserts the probe surfaces banner / section-order / line-cap
// drift while passing on canonical blocks. Vacuous when no log file
// exists.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPEC_RESEARCH_BANNER,
  SPEC_RESEARCH_SECTIONS,
  runSpecResearchResultShapeProbe,
} from "../adapters/_shared/src/spec_research_result_shape";

interface Fixture {
  ulid: string;
  content: string;
}

function makeFixture(blocks: Fixture[]): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "spec-research-shape-probe-"));
  for (const b of blocks) {
    const dir = join(root, ".dpt-locks", b.ulid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec-research-result.txt"), b.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function canonicalBlock(): string {
  return [
    SPEC_RESEARCH_BANNER,
    "```spec-research-result",
    "## Related FRs",
    "- STE-225 (archived) — context-fork pattern — relevant: forked subagents",
    "",
    "## Prior Decisions",
    "- subagents are read-only and discard intermediate state on exit",
    "",
    "## Reusable ACs / Patterns",
    "- STE-225:AC-3 — context: fork frontmatter with explicit agent: pin",
    "```",
    "",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Vacuous case — no `.dpt-locks/` directory at all.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — vacuous", () => {
  test("project root with no .dpt-locks/ directory → no violations", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-vacuous-"));
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(".dpt-locks/ exists but no spec-research-result.txt → no violations", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-empty-"));
    try {
      mkdirSync(join(root, ".dpt-locks", "01H123"), { recursive: true });
      writeFileSync(join(root, ".dpt-locks", "01H123", "other.txt"), "noise\n");
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// Positive case — a fully canonical block passes.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — positive", () => {
  test("canonical block (banner + 3 sections in order + ≤25 lines) → no violations", () => {
    const { root, cleanup } = makeFixture([
      { ulid: "01H1AB", content: canonicalBlock() },
    ]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("flat layout (.dpt-locks/spec-research-result.txt) is also recognized", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-flat-"));
    try {
      mkdirSync(join(root, ".dpt-locks"), { recursive: true });
      writeFileSync(
        join(root, ".dpt-locks", "spec-research-result.txt"),
        canonicalBlock(),
      );
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// Negative cases — every shape failure surfaces a violation.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — negative", () => {
  test("missing banner line → violation", () => {
    const content = [
      "```spec-research-result",
      "## Related FRs",
      "- (none found)",
      "## Prior Decisions",
      "- (none found)",
      "## Reusable ACs / Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NB", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      expect(
        report.violations.some((v) => /banner/i.test(v.reason)),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("section order swapped → violation cites the offending heading", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "```spec-research-result",
      "## Prior Decisions", // out-of-order
      "- (none found)",
      "## Related FRs",
      "- (none found)",
      "## Reusable ACs / Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NS", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      const offenders = report.violations.filter((v) =>
        /heading at this position/i.test(v.reason),
      );
      expect(offenders.length).toBeGreaterThan(0);
      expect(offenders[0]!.reason).toContain("## Prior Decisions");
      expect(offenders[0]!.reason).toContain("expected `## Related FRs`");
    } finally {
      cleanup();
    }
  });

  test("missing third section → violation surfaces the section count", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "```spec-research-result",
      "## Related FRs",
      "- (none found)",
      "## Prior Decisions",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NM", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(
        report.violations.some((v) => /found 2/.test(v.reason)),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("> 25-line block → violation cites the line count", () => {
    const lines: string[] = [SPEC_RESEARCH_BANNER, "```spec-research-result"];
    for (const heading of SPEC_RESEARCH_SECTIONS) {
      lines.push(heading);
      // pad each section with ten bullets so the block easily exceeds 25 lines
      for (let i = 0; i < 10; i++) {
        lines.push(`- bullet ${i} text padding`);
      }
    }
    lines.push("```");
    lines.push("");
    const { root, cleanup } = makeFixture([
      { ulid: "01H1NL", content: lines.join("\n") },
    ]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      const cap = report.violations.find((v) =>
        /≤ 25-line cap is exceeded/.test(v.reason),
      );
      expect(cap).toBeDefined();
      expect(cap!.reason).toMatch(/^block is \d+ lines/);
    } finally {
      cleanup();
    }
  });

  test("missing opening fence → violation cites the missing fence", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "## Related FRs",
      "- (none found)",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NF", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(
        report.violations.some((v) =>
          /missing opening fence/.test(v.reason),
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("missing closing fence → violation cites the unclosed block", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "```spec-research-result",
      "## Related FRs",
      "- (none found)",
      "## Prior Decisions",
      "- (none found)",
      "## Reusable ACs / Patterns",
      "- (none found)",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NC", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(
        report.violations.some((v) =>
          /missing closing fence/.test(v.reason),
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Severity / message shape — error severity, NFR-10 canonical shape.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — message shape", () => {
  test("violation carries severity=error and NFR-10 canonical message", () => {
    const content = "## not even close\n";
    const { root, cleanup } = makeFixture([{ ulid: "01H1MS", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.message).toContain("spec_research_result_shape:");
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain("severity=error");
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Constants — sanity-check the byte-exact canonicals exported by the module.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — constants", () => {
  test("SPEC_RESEARCH_BANNER matches the literal AC-STE-230.3 line", () => {
    expect(SPEC_RESEARCH_BANNER).toBe(
      "> [historical reference — decisions below may be stale; use as background, not authority]",
    );
  });

  test("SPEC_RESEARCH_SECTIONS is the canonical 3-section list in order", () => {
    expect(SPEC_RESEARCH_SECTIONS).toEqual([
      "## Related FRs",
      "## Prior Decisions",
      "## Reusable ACs / Patterns",
    ]);
  });
});
