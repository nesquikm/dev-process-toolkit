import { describe, expect, test } from "bun:test";
import {
  extractTddSpecReviewBlock,
  parseTddSpecReviewBlock,
} from "../adapters/_shared/src/tdd_spec_review_result";

// STE-296 AC.3 — `tdd-spec-review-result` fenced-block parser.
//
// The audit subagent ends its turn with exactly one fenced block:
//
//     ```tdd-spec-review-result
//     role: spec-reviewer
//     status: ok
//     missing_acs: []
//     partial_acs: []
//     drift_count: 0
//     advisory_findings: []
//     cross_cutting_drift: []
//     command: bun test plugins/dev-process-toolkit/tests/
//     output_excerpt: |
//       PASS — 314 of 314
//     notes: optional
//     ```
//
// Required fields:
//   role: spec-reviewer
//   status: ok | failed
//   missing_acs: string[]
//   partial_acs: string[]
//   drift_count: number
//   advisory_findings: string[]
//   cross_cutting_drift: string[]
//   command: string
//   output_excerpt: string
// Optional: notes
//
// Format violations: missing field, wrong role, wrong type, no fence,
// multiple fences ⇒ each surface a reason naming the offending field.

function fence(body: string): string {
  return ["```tdd-spec-review-result", body, "```"].join("\n");
}

const WELL_FORMED_CLEAN = fence(
  [
    "role: spec-reviewer",
    "status: ok",
    "missing_acs: []",
    "partial_acs: []",
    "drift_count: 0",
    "advisory_findings: []",
    "cross_cutting_drift: []",
    "command: bun test plugins/dev-process-toolkit/tests/",
    "output_excerpt: |",
    "  PASS — 314 of 314",
  ].join("\n"),
);

const WELL_FORMED_WITH_MISSING = fence(
  [
    "role: spec-reviewer",
    "status: ok",
    "missing_acs:",
    "  - AC-STE-296.2",
    "partial_acs:",
    "  - AC-STE-296.5",
    "drift_count: 2",
    "advisory_findings:",
    "  - src/foo.ts:42 — orphan helper extracted during refactor",
    "cross_cutting_drift:",
    "  - specs/requirements.md — stale ref to deleted FR",
    "command: bun test plugins/dev-process-toolkit/tests/",
    "output_excerpt: |",
    "  PASS — 314 of 314",
    "notes: missing impl for AC.2",
  ].join("\n"),
);

describe("AC-STE-296.3 — tdd-spec-review-result parser", () => {
  test("well-formed clean block (no missing ACs) parses cleanly", () => {
    const r = parseTddSpecReviewBlock(WELL_FORMED_CLEAN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.role).toBe("spec-reviewer");
    expect(r.block.status).toBe("ok");
    expect(r.block.missing_acs).toEqual([]);
    expect(r.block.partial_acs).toEqual([]);
    expect(r.block.drift_count).toBe(0);
    expect(r.block.advisory_findings).toEqual([]);
    expect(r.block.cross_cutting_drift).toEqual([]);
    expect(r.block.command).toContain("bun test");
    expect(r.block.output_excerpt).toContain("PASS");
  });

  test("well-formed block with missing_acs parses; missing_acs.length === 1", () => {
    const r = parseTddSpecReviewBlock(WELL_FORMED_WITH_MISSING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.missing_acs).toEqual(["AC-STE-296.2"]);
    expect(r.block.missing_acs.length).toBe(1);
    expect(r.block.partial_acs).toEqual(["AC-STE-296.5"]);
    expect(r.block.drift_count).toBe(2);
    expect(r.block.advisory_findings.length).toBe(1);
    expect(r.block.cross_cutting_drift.length).toBe(1);
    expect(r.block.notes).toBe("missing impl for AC.2");
  });

  test("status: failed is accepted (audit-side failure path)", () => {
    const body = fence(
      [
        "role: spec-reviewer",
        "status: failed",
        "missing_acs: []",
        "partial_acs: []",
        "drift_count: 0",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  reviewer could not load FR",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.status).toBe("failed");
  });

  test("missing `missing_acs` field ⇒ format violation naming the field", () => {
    const body = fence(
      [
        "role: spec-reviewer",
        "status: ok",
        "partial_acs: []",
        "drift_count: 0",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("missing_acs");
  });

  test("wrong role (implementer) ⇒ format violation", () => {
    const body = fence(
      [
        "role: implementer",
        "status: ok",
        "missing_acs: []",
        "partial_acs: []",
        "drift_count: 0",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/role/i);
  });

  test("two fenced blocks ⇒ format violation (exactly-one rule)", () => {
    const stdout = [WELL_FORMED_CLEAN, WELL_FORMED_CLEAN].join("\n\n");
    const ex = extractTddSpecReviewBlock(stdout);
    expect(ex.ok).toBe(false);
    if (ex.ok) return;
    expect(ex.reason).toMatch(/multiple|more than one|exactly one/i);
  });

  test("zero fences ⇒ format violation", () => {
    const ex = extractTddSpecReviewBlock("no fence here at all");
    expect(ex.ok).toBe(false);
    if (ex.ok) return;
    expect(ex.reason).toMatch(/no.*fenced|missing fence|exactly one/i);
  });

  test("drift_count non-numeric ⇒ format violation naming the field", () => {
    const body = fence(
      [
        "role: spec-reviewer",
        "status: ok",
        "missing_acs: []",
        "partial_acs: []",
        "drift_count: not-a-number",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("drift_count");
  });

  test("partial_acs non-array ⇒ format violation naming the field", () => {
    const body = fence(
      [
        "role: spec-reviewer",
        "status: ok",
        "missing_acs: []",
        "partial_acs: not-a-list",
        "drift_count: 0",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("partial_acs");
  });

  test("missing each required field surfaces format violation naming it", () => {
    const required = [
      "status",
      "missing_acs",
      "partial_acs",
      "drift_count",
      "advisory_findings",
      "cross_cutting_drift",
      "command",
      "output_excerpt",
    ];
    for (const missing of required) {
      const all: Record<string, string> = {
        status: "status: ok",
        missing_acs: "missing_acs: []",
        partial_acs: "partial_acs: []",
        drift_count: "drift_count: 0",
        advisory_findings: "advisory_findings: []",
        cross_cutting_drift: "cross_cutting_drift: []",
        command: "command: bun test",
        output_excerpt: "output_excerpt: |\n  PASS",
      };
      delete all[missing]!;
      const body = fence(["role: spec-reviewer", ...Object.values(all)].join("\n"));
      const r = parseTddSpecReviewBlock(body);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toContain(missing);
    }
  });

  test("notes is optional and survives when present", () => {
    const r = parseTddSpecReviewBlock(WELL_FORMED_WITH_MISSING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.notes).toBe("missing impl for AC.2");
  });

  test("notes absence is fine", () => {
    const r = parseTddSpecReviewBlock(WELL_FORMED_CLEAN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.notes).toBeUndefined();
  });

  test("extractTddSpecReviewBlock locates the fence inside larger output", () => {
    const stdout = ["preamble", WELL_FORMED_CLEAN, "trailing"].join("\n\n");
    const ex = extractTddSpecReviewBlock(stdout);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    expect(ex.body).toContain("role: spec-reviewer");
  });

  test("invalid status value ⇒ format violation", () => {
    const body = fence(
      [
        "role: spec-reviewer",
        "status: maybe",
        "missing_acs: []",
        "partial_acs: []",
        "drift_count: 0",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  x",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/status/i);
  });

  test("parses multi-element missing_acs list", () => {
    const body = fence(
      [
        "role: spec-reviewer",
        "status: ok",
        "missing_acs:",
        "  - AC-STE-296.2",
        "  - AC-STE-296.4",
        "partial_acs: []",
        "drift_count: 0",
        "advisory_findings: []",
        "cross_cutting_drift: []",
        "command: bun test",
        "output_excerpt: |",
        "  PASS",
      ].join("\n"),
    );
    const r = parseTddSpecReviewBlock(body);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.missing_acs).toEqual(["AC-STE-296.2", "AC-STE-296.4"]);
  });
});
