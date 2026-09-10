// STE-284 AC-STE-284.3 — /spec-write preamble reconciliation prose grep.
//
// Asserts the SKILL.md carries a `§ 0.5 Tracker-local reconciliation` section
// between § 0 and § 0a, referencing the shared helper, the import path, and
// the no-auto-import rule that governs tracker-only orphans. Content-grep test
// in the same style as the other SKILL.md-shape tests under `tests/`.
//
// M_840a06/STE-578 replaced the old "cites the STE-135 guard" pin: no such
// guard exists (the import path has no existence check), so that assertion
// was pinning a false claim open. It is deleted, not satisfied.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(import.meta.dir, "..", "skills", "spec-write", "SKILL.md");

describe("AC-STE-284.3 + AC-STE-578.1: § 0.5 Tracker-local reconciliation section present", () => {
  test("SKILL.md contains the literal `§ 0.5` reconciliation heading", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    // The heading text must mention both "0.5" and "Tracker-local reconciliation".
    expect(body).toMatch(/0\.5/);
    expect(body).toMatch(/Tracker-local reconciliation/i);
  });

  test("§ 0.5 sits between § 0 and § 0a in document order", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    // Find the three section markers and assert ascending offsets.
    const idx0 = body.search(/^###\s*0\.\s/m);
    const idx05 = body.search(/0\.5.*Tracker-local reconciliation/i);
    const idx0a = body.search(/^###\s*0a\b/m);
    expect(idx0).toBeGreaterThanOrEqual(0);
    expect(idx05).toBeGreaterThan(idx0);
    expect(idx0a).toBeGreaterThan(idx05);
  });

  test("§ 0.5 references the shared helper `reconcileTrackerLocal`", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toContain("reconcileTrackerLocal");
  });

  test("§ 0.5 names `importFromTracker` as the path it forbids", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toContain("importFromTracker");
  });

  test("§ 0.5 forbids auto-import and cites no clobber guard", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    // Scope the positive to § 0.5 itself: asserting against the whole file
    // would pass on the phrase turning up in any other section.
    const start = body.indexOf("### 0.5 Tracker-local reconciliation");
    const end = body.indexOf("\n### ", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section = body.slice(start, end);
    expect(section).toMatch(/never auto-imported/i);
    // The guard the old pin claimed does not exist, so the token must not
    // return — not even inside a sentence denying it.
    expect(body).not.toMatch(/STE-135/);
  });

  test("NFR-1: SKILL.md ≤ 358 lines (preamble addition stays within budget)", () => {
    // This pin used to allow 360 — LOOSER than the contract, so it was a
    // hole rather than a false red: two lines past NFR-1 would have passed
    // here while `tests/skill-nfr-1-length.test.ts` failed. NFR-1 is 358
    // (`specs/requirements.md`, and the one `const SKILL_LINE_CAP = 358;`).
    // Repointed by M_8f8e25/STE-558.
    const SKILL_LINE_CAP = 358;
    const body = readFileSync(SKILL_PATH, "utf-8");
    const lineCount = body.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});
