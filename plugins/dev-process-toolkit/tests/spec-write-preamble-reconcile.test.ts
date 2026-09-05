// STE-284 AC-STE-284.3 — /spec-write preamble reconciliation prose grep.
//
// Asserts the SKILL.md carries a `§ 0.5 Tracker-local reconciliation` section
// between § 0 and § 0a, referencing the shared helper, the import path, and
// the STE-135 existsSync guard. Content-grep test in the same style as the
// other SKILL.md-shape tests under `tests/`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_PATH = join(import.meta.dir, "..", "skills", "spec-write", "SKILL.md");

describe("AC-STE-284.3: § 0.5 Tracker-local reconciliation section present", () => {
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

  test("§ 0.5 references the auto-import path via `importFromTracker`", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toContain("importFromTracker");
  });

  test("§ 0.5 cites the STE-135 `existsSync` guard", () => {
    const body = readFileSync(SKILL_PATH, "utf-8");
    expect(body).toContain("existsSync");
    expect(body).toContain("STE-135");
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
