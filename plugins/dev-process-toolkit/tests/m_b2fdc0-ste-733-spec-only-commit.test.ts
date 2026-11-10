// STE-733 (M_b2fdc0) — AC-STE-733.1 / .2 / .6: a spec-only commit needs no
// gate run.
//
// Every leg drives the SHIPPED `pre-commit-gate-check.sh` wrapper over a
// transcript carrying NO gate-check Skill call (AC-STE-733.6), against a
// temporary checkout. The permit stages an edit to an ACTIVE FR and plan — not
// an archive move, so the STE-700 archive-only pass cannot be what permits it.
// Each twin differs from the permit in exactly one condition of AC-STE-733.1
// and must get today's rule: refused for want of evidence.

import { afterAll, describe, expect, test } from "bun:test";

import { cleanupTemps, commitLegs, PLUGIN_ROOT } from "./_m_b2fdc0_ste733_fixture";

const T = 120_000;

afterAll(() => cleanupTemps());

const LEGS = commitLegs();

describe("AC-STE-733.1 / AC-STE-733.2 — the spec-only commit passes with no gate-check evidence", () => {
  for (const l of LEGS.filter((x) => x.expect === "permit")) {
    test(l.name, async () => {
      expect(await l.check(PLUGIN_ROOT)).toBeNull();
    }, T);
  }
});

describe("AC-STE-733.1 / AC-STE-733.6 — each twin differs in one condition and gets today's rule", () => {
  for (const l of LEGS.filter((x) => x.expect === "refuse")) {
    test(l.name, async () => {
      expect(await l.check(PLUGIN_ROOT)).toBeNull();
    }, T);
  }

  test("AC-STE-733.6 — every condition of AC .1 has a twin", () => {
    const conditions = new Set(
      LEGS.filter((l) => l.expect === "refuse").map((l) => /TWIN \(([^)]+)\)/.exec(l.name)?.[1]),
    );
    expect([...conditions].sort()).toEqual(
      ["--amend", "-a", "clean tree", "nothing staged", "one checkout", "path", "pathspec", "plain", "unplaced"].sort(),
    );
  });
});
