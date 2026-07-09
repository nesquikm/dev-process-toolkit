// Tests for /gate-check probe `deps_research_result_shape`
// (STE-373 AC-STE-373.1). Severity: error. Probe #64.
//
// Structural clone of `gate-check-spec-research-result-shape.test.ts`
// (probe #41), but the block-shape validation is delegated to the
// EXISTING parser `parseDepsResearchBlock`
// (adapters/_shared/src/deps_research_result.ts). The probe walks
// recorded `.dpt-locks/**/deps-research-result.txt` logs, feeds each
// file's content to the parser, and maps every `{ ok: false, reason }`
// to an NFR-10 `file:line — reason` violation.
//
// Builds tmp fixtures under .dpt-locks/<ulid>/deps-research-result.txt
// using the real DEPS_RESEARCH_BANNER + DEPS_RESEARCH_SECTIONS
// constants, and asserts the probe surfaces banner / section-order /
// line-cap / multi-fence drift while passing on canonical blocks.
// Vacuous when no log file exists.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEPS_RESEARCH_BANNER,
  DEPS_RESEARCH_SECTIONS,
} from "../adapters/_shared/src/deps_research_result";
import { runDepsResearchResultShapeProbe } from "../adapters/_shared/src/deps_research_result_shape";

const FENCE_OPEN = "```deps-research-result";
const FENCE_CLOSE = "```";

interface Fixture {
  ulid: string;
  content: string;
}

function makeFixture(blocks: Fixture[]): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "deps-research-shape-probe-"));
  for (const b of blocks) {
    const dir = join(root, ".dpt-locks", b.ulid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "deps-research-result.txt"), b.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Canonical, in-order, ≤25-line block built from the real constants. */
function canonicalBlock(): string {
  const lines: string[] = [DEPS_RESEARCH_BANNER, FENCE_OPEN];
  for (const heading of DEPS_RESEARCH_SECTIONS) {
    lines.push(heading);
    lines.push("- (none found)");
  }
  lines.push(FENCE_CLOSE);
  lines.push("");
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Vacuous cases.
// -----------------------------------------------------------------------------

describe("deps_research_result_shape — vacuous", () => {
  test("project root with no .dpt-locks/ directory → no violations", () => {
    const root = mkdtempSync(join(tmpdir(), "deps-research-shape-vacuous-"));
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(".dpt-locks/ exists but no deps-research-result.txt → no violations", () => {
    const root = mkdtempSync(join(tmpdir(), "deps-research-shape-empty-"));
    try {
      mkdirSync(join(root, ".dpt-locks", "01H123"), { recursive: true });
      writeFileSync(join(root, ".dpt-locks", "01H123", "other.txt"), "noise\n");
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// Positive cases — a fully canonical block passes.
// -----------------------------------------------------------------------------

describe("deps_research_result_shape — positive", () => {
  test("canonical block (banner + 3 sections in order + ≤25 lines) → no violations", () => {
    const { root, cleanup } = makeFixture([
      { ulid: "01H1AB", content: canonicalBlock() },
    ]);
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("recursive walk recognizes a nested .dpt-locks/<ulid>/deps-research-result.txt", () => {
    const root = mkdtempSync(join(tmpdir(), "deps-research-shape-nested-"));
    try {
      const dir = join(root, ".dpt-locks", "01HZZZ");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "deps-research-result.txt"), canonicalBlock());
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// Negative cases — every shape failure surfaces exactly one NFR-10 violation.
// -----------------------------------------------------------------------------

describe("deps_research_result_shape — negative", () => {
  test("missing banner line → violation whose note carries file:line — reason", () => {
    const content = [
      FENCE_OPEN,
      DEPS_RESEARCH_SECTIONS[0],
      "- (none found)",
      DEPS_RESEARCH_SECTIONS[1],
      "- (none found)",
      DEPS_RESEARCH_SECTIONS[2],
      "- (none found)",
      FENCE_CLOSE,
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NB", content }]);
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.reason).toMatch(/banner/i);
      expect(v.note).toMatch(/:\d+ — /);
      expect(v.note).toMatch(/deps-research-result\.txt:\d+ — /);
    } finally {
      cleanup();
    }
  });

  test("section order swapped → single violation naming the offending heading", () => {
    const content = [
      DEPS_RESEARCH_BANNER,
      FENCE_OPEN,
      DEPS_RESEARCH_SECTIONS[1], // out of order — should be section[0]
      "- (none found)",
      DEPS_RESEARCH_SECTIONS[0],
      "- (none found)",
      DEPS_RESEARCH_SECTIONS[2],
      "- (none found)",
      FENCE_CLOSE,
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NS", content }]);
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.reason).toMatch(/order/i);
      expect(v.reason).toContain(DEPS_RESEARCH_SECTIONS[1]!);
      expect(v.note).toMatch(/:\d+ — /);
    } finally {
      cleanup();
    }
  });

  test("> 25-line block → single violation citing the line count", () => {
    const lines: string[] = [DEPS_RESEARCH_BANNER, FENCE_OPEN];
    for (const heading of DEPS_RESEARCH_SECTIONS) {
      lines.push(heading);
      for (let i = 0; i < 10; i++) lines.push(`- bullet ${i} padding`);
    }
    lines.push(FENCE_CLOSE);
    lines.push("");
    const { root, cleanup } = makeFixture([
      { ulid: "01H1NL", content: lines.join("\n") },
    ]);
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.reason).toMatch(/\bblock is \d+ lines/);
      expect(v.reason).toMatch(/cap/i);
      expect(v.note).toMatch(/:\d+ — /);
    } finally {
      cleanup();
    }
  });

  test("two fenced blocks in one file → single violation (parser enforces exactly-one)", () => {
    const content = `${canonicalBlock()}\n${canonicalBlock()}`;
    const { root, cleanup } = makeFixture([{ ulid: "01H1MF", content }]);
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      expect(v.reason).toMatch(/multiple|duplicate|exactly one|found 2/i);
      expect(v.note).toMatch(/:\d+ — /);
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Severity / message shape — error severity, NFR-10 canonical shape.
// -----------------------------------------------------------------------------

describe("deps_research_result_shape — message shape", () => {
  test("violation carries severity=error and NFR-10 Remedy:/Context: message", () => {
    const { root, cleanup } = makeFixture([
      { ulid: "01H1MS", content: "## not even close\n" },
    ]);
    try {
      const report = runDepsResearchResultShapeProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.message).toContain("deps_research_result_shape");
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain("severity=error");
      // note shape: `<relpath>:<line> — <reason>`
      expect(v.note).toBe(`${v.file.replace(`${root}/`, "")}:${v.line} — ${v.reason}`);
    } finally {
      cleanup();
    }
  });
});
