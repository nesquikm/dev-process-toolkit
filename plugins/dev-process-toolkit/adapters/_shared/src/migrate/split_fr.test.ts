// Phase D Tier 4 test — split_fr.ts (AC-48.6).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrs } from "./split_fr";

const FIXTURE_INPUT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "migration",
  "v1-to-v2",
  "input",
  "specs",
  "requirements.md",
);

describe("splitFrs", () => {
  test("returns 3 FR blocks keyed by old FR id from the round-trip fixture", () => {
    const md = readFileSync(FIXTURE_INPUT, "utf-8");
    const blocks = splitFrs(md);
    expect(blocks.size).toBe(3);
    expect(blocks.has("FR-1")).toBe(true);
    expect(blocks.has("FR-2")).toBe(true);
    expect(blocks.has("FR-3")).toBe(true);
  });

  test("each block has title, anchor, body, and acceptance criteria", () => {
    const md = readFileSync(FIXTURE_INPUT, "utf-8");
    const blocks = splitFrs(md);
    const fr1 = blocks.get("FR-1")!;
    expect(fr1.title).toBe("First Active Requirement");
    expect(fr1.anchor).toBe("FR-1");
    expect(fr1.body).toContain("Minimal active requirement");
    expect(fr1.acceptanceCriteria.some((a) => a.includes("AC-1.1"))).toBe(true);
    expect(fr1.acceptanceCriteria.some((a) => a.includes("AC-1.2"))).toBe(true);
  });

  test("handles inline FR blocks with no ACs by returning empty acceptanceCriteria array", () => {
    const md = [
      "# Requirements",
      "",
      "## 2. Functional Requirements",
      "",
      "### FR-99: No ACs Here {#FR-99}",
      "",
      "Just a requirement without ACs.",
      "",
      "## 3. NFRs",
      "",
    ].join("\n");
    const blocks = splitFrs(md);
    const fr99 = blocks.get("FR-99")!;
    expect(fr99.title).toBe("No ACs Here");
    expect(fr99.acceptanceCriteria).toEqual([]);
  });

  test("ignores NFR and non-FR headings", () => {
    const md = [
      "### NFR-1: Example",
      "",
      "NFR body.",
      "",
      "### FR-5: Real FR {#FR-5}",
      "",
      "Real FR body.",
      "",
    ].join("\n");
    const blocks = splitFrs(md);
    expect(blocks.size).toBe(1);
    expect(blocks.has("FR-5")).toBe(true);
  });

  test("boundary: next ## or ### at same or higher level terminates the block", () => {
    const md = [
      "### FR-1: First {#FR-1}",
      "",
      "First body.",
      "",
      "**Acceptance Criteria:**",
      "- AC-1.1: one",
      "",
      "### FR-2: Second {#FR-2}",
      "",
      "Second body.",
      "",
    ].join("\n");
    const blocks = splitFrs(md);
    expect(blocks.size).toBe(2);
    const fr1 = blocks.get("FR-1")!;
    expect(fr1.body).toContain("First body");
    expect(fr1.body).not.toContain("Second body");
  });
});
