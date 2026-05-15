// STE-284 AC-STE-284.5 / AC-STE-284.6 / AC-STE-284.8 — prose grep tests.
//
// Three independent literal-grep ACs, bundled here because each is a single
// regex assertion and grouping them keeps the per-file count modest. The
// `gate-check`'s `closing_summary_capability_keys` probe enforces these
// directives in production; this test layer is the per-AC unit gate.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SPEC_WRITE_SKILL = join(import.meta.dir, "..", "skills", "spec-write", "SKILL.md");
const GATE_CHECK_SKILL = join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md");
const FR_STE_284 = join(import.meta.dir, "..", "..", "..", "specs", "frs", "STE-284.md");

const CAPABILITY_KEYS = [
  "tracker_local_reconciled",
  "tracker_local_orphan_local",
  "milestone_local_orphan",
] as const;

describe("AC-STE-284.5: capability keys present in /spec-write SKILL.md", () => {
  for (const key of CAPABILITY_KEYS) {
    test(`'${key}' appears at least once in spec-write/SKILL.md`, () => {
      const body = readFileSync(SPEC_WRITE_SKILL, "utf-8");
      expect(body).toContain(key);
    });
  }
});

describe("AC-STE-284.5: capability keys present in /gate-check SKILL.md", () => {
  for (const key of CAPABILITY_KEYS) {
    test(`'${key}' appears at least once in gate-check/SKILL.md`, () => {
      const body = readFileSync(GATE_CHECK_SKILL, "utf-8");
      expect(body).toContain(key);
    });
  }
});

describe("AC-STE-284.5: plain-language explanations near each key (spec-write)", () => {
  test("'tracker_local_reconciled' is documented with FR / milestone counts framing", () => {
    const body = readFileSync(SPEC_WRITE_SKILL, "utf-8");
    // The FR text quotes the plain-language: "tracker → local reconciliation imported N FR(s) ..."
    const idx = body.indexOf("tracker_local_reconciled");
    expect(idx).toBeGreaterThanOrEqual(0);
    // The phrase "imported" or "reconciliation" appears within a 400-char window.
    const window = body.slice(Math.max(0, idx - 100), idx + 400);
    expect(window).toMatch(/reconcil|imported/);
  });
});

describe("AC-STE-284.6: STE-119 supersession framing in FR Notes", () => {
  test("specs/frs/STE-284.md mentions STE-119", () => {
    const body = readFileSync(FR_STE_284, "utf-8");
    expect(body).toContain("STE-119");
  });

  test("specs/frs/STE-284.md uses 'supersede' or 'Supersedes' framing", () => {
    const body = readFileSync(FR_STE_284, "utf-8");
    expect(body).toMatch(/[Ss]upersed/);
  });

  test("STE-119 reference is in the Notes section (or near supersession framing)", () => {
    const body = readFileSync(FR_STE_284, "utf-8");
    const idxNotes = body.indexOf("## Notes");
    const idxSTE119 = body.indexOf("STE-119");
    expect(idxNotes).toBeGreaterThanOrEqual(0);
    expect(idxSTE119).toBeGreaterThanOrEqual(0);
    // STE-119 should appear AFTER the Notes heading.
    expect(idxSTE119).toBeGreaterThan(idxNotes);
  });
});

describe("AC-STE-284.8: 1500ms budget constant documented (smoke-deferrable)", () => {
  test("performance budget 1500 (ms) is documented in the FR text", () => {
    const body = readFileSync(FR_STE_284, "utf-8");
    expect(body).toContain("1500");
  });
});
