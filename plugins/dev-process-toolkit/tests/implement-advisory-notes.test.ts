// STE-148 — /implement must surface Stage B Pass 2 advisory concerns inline
// in the end-of-run report AND persist them in the archived FR markdown.
//
// The skill is LLM-driven, so this is a doc-conformance probe that asserts
// the SKILL.md prose carries the load-bearing wording. Pattern mirrors
// other implement-* prose tests (`implement-phase4-close.test.ts`,
// `implement-phase4-rewrite-links.test.ts`).
//
// Acceptance criteria:
//   AC-STE-148.1: Phase 3 Stage B captures advisory concerns in a structured
//     `advisoryNote[]` array with schema {pass, concern, rationale, classification}.
//     Phase 4 step 14 (Report) emits a `## Advisory notes` section listing
//     every advisory entry as one bullet.
//   AC-STE-148.2: Phase 4 archive step appends `## Implementation notes` to
//     the archived FR markdown body, after `## Notes`.
//   AC-STE-148.3: Zero-advisory case still emits the heading + literal line
//     "No advisory notes."
//   AC-STE-148.4: Report and archive renderings share a single formatter so
//     bullet bodies are byte-identical.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readSkill(): string {
  return readFileSync(implementPath, "utf-8");
}

function stageBBlock(): string {
  const body = readSkill();
  const start = body.indexOf("### Stage B");
  const end = body.indexOf("### Stage C", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

function phase4Block(): string {
  const body = readSkill();
  // Anchor on the full canonical heading text — a prefix-only match
  // (`## Phase 4: Report`) would silently keep working if the suffix
  // changed, hiding a heading rename. Tied to the `## Phase 5` heading
  // as the upper bound, which is unique in the file.
  const start = body.indexOf("## Phase 4: Report & Handoff");
  const end = body.indexOf("## Phase 5", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("STE-148 AC-STE-148.1 — Stage B captures advisoryNote schema", () => {
  test("Stage B prose names the `advisoryNote` structured field", () => {
    expect(stageBBlock()).toContain("advisoryNote");
  });

  test("Stage B prose enumerates the schema fields {pass, concern, rationale, classification}", () => {
    const block = stageBBlock();
    expect(block).toContain("pass");
    expect(block).toContain("concern");
    expect(block).toContain("rationale");
    expect(block).toContain("classification");
  });

  test("Stage B prose marks advisory classification with the literal `'advisory'`", () => {
    expect(stageBBlock()).toMatch(/classification[^\n]*advisory/);
  });
});

describe("STE-148 AC-STE-148.1 — Phase 4 report emits `## Advisory notes` section", () => {
  test("Phase 4 step 14 names the `## Advisory notes` heading", () => {
    expect(phase4Block()).toContain("## Advisory notes");
  });

  test("Phase 4 step 14 prose says one bullet per advisory entry", () => {
    expect(phase4Block().toLowerCase()).toMatch(/one bullet per (advisory|concern|entry)/);
  });
});

describe("STE-148 AC-STE-148.2 — Phase 4 archive appends `## Implementation notes` to FR body", () => {
  test("Phase 4 milestone-archival prose names `## Implementation notes` heading", () => {
    expect(phase4Block()).toContain("## Implementation notes");
  });

  test("Phase 4 prose locates the section after `## Notes`", () => {
    // Allow markdown emphasis between `after` and the heading reference
    // (the SKILL.md prose bolds **after** for prose emphasis).
    expect(phase4Block().toLowerCase()).toMatch(/after[*\s]+`?##\s+notes`?/);
  });
});

describe("STE-148 AC-STE-148.3 — zero-advisory case emits placeholder line", () => {
  test("Phase 4 prose mandates the literal `No advisory notes.` line on empty", () => {
    expect(phase4Block()).toContain("No advisory notes.");
  });

  test("Phase 4 prose says heading is emitted even with zero entries", () => {
    expect(phase4Block().toLowerCase()).toMatch(/(zero|no|empty)[^\n]*(heading|section|emit|never absent|always)/);
  });
});

describe("STE-148 AC-STE-148.4 — report and archive share a single formatter", () => {
  test("Phase 4 prose mandates byte-identical bullet bodies between report and archive", () => {
    expect(phase4Block().toLowerCase()).toMatch(/byte-identical/);
  });

  test("Phase 4 prose names a shared formatter / single source list", () => {
    expect(phase4Block().toLowerCase()).toMatch(/(shared|single)\s+(formatter|source|list)/);
  });
});
