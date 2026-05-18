// STE-308 AC-STE-308.3 / AC-STE-308.8 (unit half) —
// deterministic parser for the `spec-review-result` fenced block emitted
// by the spec-reviewer audit subagent (forked via /spec-review).
//
// Module under test:
//   plugins/dev-process-toolkit/adapters/_shared/src/spec_review_result.ts
//
// Public surface (from STE-308 § Technical Design):
//
//   export interface TraceabilityRow {
//     ac: string;
//     impl: string | null;
//     test: string | null;
//     status: 'done' | 'missing' | 'partial';
//   }
//
//   export interface SpecReviewResult {
//     traceability: TraceabilityRow[];
//     drift_count: number;
//     drift_entries: string[];
//     advisory_findings: string[];
//   }
//
//   export function parseSpecReviewResultBlock(text: string): SpecReviewResult;
//
// Closed-schema rules per AC-STE-308.3:
//   - exactly one fenced ```spec-review-result block
//   - required sections in canonical order:
//       ## Traceability map
//       ## Findings
//       ## Drift hints
//   - each AC row inside `## Traceability map` carries required fields
//     `ac`, `impl` (or null), `test` (or null), `status` (one of
//     `done` / `missing` / `partial`).
//   - missing / extra-fenced / wrong-role / wrong-type ⇒ format
//     violation naming the offending field.
//
// Pattern lineage: closest precedent is
// `parseTddSpecReviewResultBlock` (STE-296 — YAML-shaped block) but the
// shape here is sectioned markdown (closer to `parseDepsResearchBlock`
// from STE-301). Both ancestors are read for inspiration; the contract
// here follows the STE-308 § Technical Design verbatim.

import { describe, expect, test } from "bun:test";
import {
  parseSpecReviewResultBlock,
} from "../adapters/_shared/src/spec_review_result";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers — build canonical / mutated `spec-review-result` blocks.
// ─────────────────────────────────────────────────────────────────────────────

function fence(body: string[]): string {
  return ["```spec-review-result", ...body, "```"].join("\n");
}

const WELL_FORMED = fence([
  "role: spec-reviewer",
  "",
  "## Traceability map",
  "- ac: AC-STE-308.1, impl: agents/spec-reviewer.md:1, test: tests/spec-review-fork-migration.test.ts:10, status: done",
  "- ac: AC-STE-308.2, impl: skills/spec-review-audit/SKILL.md:1, test: tests/spec-review-fork-migration.test.ts:42, status: done",
  "",
  "## Findings",
  "- AC-STE-308.1 traced cleanly",
  "",
  "## Drift hints",
  "- (none)",
]);

const WELL_FORMED_WITH_DRIFT = fence([
  "role: spec-reviewer",
  "",
  "## Traceability map",
  "- ac: AC-STE-308.1, impl: agents/spec-reviewer.md:1, test: tests/spec-review-fork-migration.test.ts:10, status: done",
  "- ac: AC-STE-308.2, impl: null, test: tests/spec-review-fork-migration.test.ts:42, status: partial",
  "- ac: AC-STE-308.3, impl: null, test: null, status: missing",
  "",
  "## Findings",
  "- AC-STE-308.2 partial — impl missing",
  "- AC-STE-308.3 missing — no trace",
  "",
  "## Drift hints",
  "- specs/requirements.md:120 — stale ref to deleted FR",
  "- specs/technical-spec.md:55 — orphan section heading",
]);

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.3 — well-formed block parses; interface shape matches.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.3 — well-formed spec-review-result block parses", () => {
  test("returns a SpecReviewResult with traceability rows + counts", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.block.traceability)).toBe(true);
    expect(r.block.traceability.length).toBe(2);
    expect(typeof r.block.drift_count).toBe("number");
    expect(Array.isArray(r.block.drift_entries)).toBe(true);
    expect(Array.isArray(r.block.advisory_findings)).toBe(true);
  });

  test("traceability row fields parse correctly (ac, impl, test, status)", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const first = r.block.traceability[0]!;
    expect(first.ac).toBe("AC-STE-308.1");
    expect(first.impl).toBe("agents/spec-reviewer.md:1");
    expect(first.test).toBe("tests/spec-review-fork-migration.test.ts:10");
    expect(first.status).toBe("done");
  });

  test("status accepts 'done' | 'missing' | 'partial' (full enum coverage)", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED_WITH_DRIFT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const statuses = r.block.traceability.map((row) => row.status);
    expect(statuses).toContain("done");
    expect(statuses).toContain("partial");
    expect(statuses).toContain("missing");
  });

  test("impl / test can be null (per AC-STE-308.3 schema)", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED_WITH_DRIFT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const partial = r.block.traceability.find((row) => row.ac === "AC-STE-308.2");
    const missing = r.block.traceability.find((row) => row.ac === "AC-STE-308.3");
    expect(partial?.impl).toBeNull();
    expect(missing?.impl).toBeNull();
    expect(missing?.test).toBeNull();
  });

  test("drift_count reflects number of `## Drift hints` entries", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED_WITH_DRIFT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.drift_count).toBe(2);
    expect(r.block.drift_entries.length).toBe(2);
    expect(r.block.drift_entries[0]).toContain("specs/requirements.md");
  });

  test("advisory_findings reflects `## Findings` entries", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED_WITH_DRIFT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.advisory_findings.length).toBe(2);
    expect(r.block.advisory_findings[0]).toContain("AC-STE-308.2");
  });

  test("clean block (no drift entries) ⇒ drift_count = 0", () => {
    const r = parseSpecReviewResultBlock(WELL_FORMED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // "- (none)" is a sentinel, not a drift; the parser must treat it as zero.
    expect(r.block.drift_count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-308.3 — format violations: missing section / wrong role /
// extra fences / malformed row each fire a format violation naming the
// offending field.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.3 — format violations", () => {
  test("missing `## Traceability map` section ⇒ format violation naming it", () => {
    const body = fence([
      "role: spec-reviewer",
      "",
      "## Findings",
      "- ok",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Traceability map/i);
  });

  test("missing `## Findings` section ⇒ format violation naming it", () => {
    const body = fence([
      "role: spec-reviewer",
      "",
      "## Traceability map",
      "- ac: AC-STE-308.1, impl: x, test: y, status: done",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Findings/i);
  });

  test("missing `## Drift hints` section ⇒ format violation naming it", () => {
    const body = fence([
      "role: spec-reviewer",
      "",
      "## Traceability map",
      "- ac: AC-STE-308.1, impl: x, test: y, status: done",
      "",
      "## Findings",
      "- ok",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Drift hints/i);
  });

  test("wrong role identifier (e.g. `implementer`) ⇒ format violation naming role", () => {
    const body = fence([
      "role: implementer",
      "",
      "## Traceability map",
      "- ac: AC-STE-308.1, impl: x, test: y, status: done",
      "",
      "## Findings",
      "- ok",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/role/i);
  });

  test("extra fenced block (two ```spec-review-result fences) ⇒ format violation", () => {
    const stdout = [WELL_FORMED, WELL_FORMED].join("\n\n");
    const r = parseSpecReviewResultBlock(stdout);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/multiple|more than one|exactly one|extra/i);
  });

  test("zero fenced blocks ⇒ format violation", () => {
    const r = parseSpecReviewResultBlock("no fence here at all");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no.*fenced|missing fence|exactly one|fence/i);
  });

  test("malformed AC row (missing `status` field) ⇒ format violation naming status", () => {
    const body = fence([
      "role: spec-reviewer",
      "",
      "## Traceability map",
      "- ac: AC-STE-308.1, impl: x, test: y",
      "",
      "## Findings",
      "- ok",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/status/i);
  });

  test("malformed AC row (missing `ac` field) ⇒ format violation naming ac", () => {
    const body = fence([
      "role: spec-reviewer",
      "",
      "## Traceability map",
      "- impl: x, test: y, status: done",
      "",
      "## Findings",
      "- ok",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/\bac\b/i);
  });

  test("invalid status value (e.g. `maybe`) ⇒ format violation naming status", () => {
    const body = fence([
      "role: spec-reviewer",
      "",
      "## Traceability map",
      "- ac: AC-STE-308.1, impl: x, test: y, status: maybe",
      "",
      "## Findings",
      "- ok",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/status/i);
  });

  test("missing `role` field ⇒ format violation naming role", () => {
    const body = fence([
      "## Traceability map",
      "- ac: AC-STE-308.1, impl: x, test: y, status: done",
      "",
      "## Findings",
      "- ok",
      "",
      "## Drift hints",
      "- (none)",
    ]);
    const r = parseSpecReviewResultBlock(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/role/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration sanity — parser output threads into existing
// `formatDriftHint` (STE-172) without modification.
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-308.7 — parsed drift_count feeds formatDriftHint unchanged", () => {
  test("drift_count from parsed block crosses threshold ⇒ formatDriftHint emits canonical line", async () => {
    const { formatDriftHint } = await import(
      "../adapters/_shared/src/spec_review_drift_hint"
    );
    const r = parseSpecReviewResultBlock(WELL_FORMED_WITH_DRIFT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hint = formatDriftHint(r.block.drift_count);
    expect(hint).toBe(
      "Live-spec refresh suggested — 2 drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.",
    );
  });

  test("clean parsed block (drift_count = 0) ⇒ formatDriftHint returns null", async () => {
    const { formatDriftHint } = await import(
      "../adapters/_shared/src/spec_review_drift_hint"
    );
    const r = parseSpecReviewResultBlock(WELL_FORMED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatDriftHint(r.block.drift_count)).toBeNull();
  });
});
