// M121 / STE-460 — AC.4, AC.5, AC.8.
//
// THREE DEFECTS IN ONE BUDGET, all measured by execution rather than by reading:
//
//   AC.4 — the headroom figure everyone edits against is a COMMENT. The
//          assertion beside it is `headroom > 0`, which a rot of the figure to 1
//          satisfies exactly as well as the true value.
//   AC.5 — the two checks meant to bound growth bite in DISJOINT regimes. At
//          exactly the headroom no pin has left the window, so the pin-presence
//          half is silent and only positivity fires; one character further the
//          trailing pin leaves entirely, `furthest` DECREASES, and positivity
//          goes green again. A band of growth passes both.
//   AC.8 — a second, tighter window (the 61-character row title inside a
//          200-character slice) is asserted and not budgeted at all, so growth
//          past its headroom is silent by construction.
//
// The repair is one mechanism over both windows, with each window's headroom
// RECORDED as data and compared as a number. Every arm below proves
// non-circularity rather than asserting it: mutating the document moves the
// measured figure and leaves the recorded one untouched. A recorded figure that
// moved with the document would make the comparison incapable of failing, which
// is the defect class this milestone exists to retire.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AC9_DISCLAIMER_PINS,
  AC9_TITLE_PIN,
  AC9_TITLE_WINDOW,
  AC9_WINDOW,
  ac9BudgetFailures,
  ac9Budgets,
  ac9Window,
} from "./_ac9-row-guard";
import { mutateInRegion } from "./_sited-mutation";

const TESTS_DIR = import.meta.dir;
const PLUGIN_ROOT = join(TESTS_DIR, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");
const SUITE_456 = join(TESTS_DIR, "m121-ste-456-two-sided-lock-evidence.test.ts");

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const smokeDoc = read(SMOKE_SKILL);
const describeIfSkills = smokeDoc === null ? describe.skip : describe;

describe("STE-460 budget — the document under test was actually found", () => {
  test("the smoke driver resolves, so nothing below is a silent skip", () => {
    expect(smokeDoc).not.toBeNull();
    expect(smokeDoc!.length).toBeGreaterThan(10_000);
  });
});

// ════════════════════════════ sited growth helpers ═══════════════════════════

function rowStart(doc: string): number {
  const at = doc.indexOf("AC-STE-448.9");
  expect(at).toBeGreaterThan(0);
  return at;
}

/**
 * Grow the row by `n` characters AHEAD of the disclaimer pins and BEHIND the
 * title, so only the wide window's measurement moves.
 *
 * Sited inside the row's own wide-window region, never by first-occurrence
 * replacement: `m121-ste-448` and `m121-ste-456` hold near-identical guard
 * bodies and three mutations in this milestone landed on the wrong copy and
 * reported GREEN.
 */
function growDisclaimerRegion(n: number): string {
  const doc = smokeDoc!;
  const start = rowStart(doc);
  const anchor = "The durable claim witness is REQUIRED here";
  const out = mutateInRegion(
    doc,
    start,
    start + AC9_WINDOW,
    anchor,
    `${"x".repeat(n)}${anchor}`,
  );
  expect(out.length).toBe(doc.length + n); // applied, and by exactly n bytes
  return out;
}

/**
 * Grow the row TITLE by `n` characters and COMPENSATE, so every disclaimer pin
 * keeps its exact offset.
 *
 * This is what makes AC.8's measurement attributable, and it is the FR's
 * RED-producing input taken literally: "grow that row past its headroom and
 * observe the budget stay silent." An uncompensated growth moves both windows at
 * once, and a FAIL from the wide budget would then be indistinguishable from a
 * FAIL of the tighter one — the incidental-failure hazard AC-STE-456.8 was built
 * around. With the compensation the wide budget is asserted GREEN on the very
 * same document.
 */
function growTitleCompensated(n: number): string {
  const doc = smokeDoc!;
  const start = rowStart(doc);
  const titleAt = doc.indexOf(AC9_TITLE_PIN, start);
  expect(titleAt).toBeGreaterThan(start);
  const titleEnd = titleAt + AC9_TITLE_PIN.length;
  const firstPinAfter = Math.min(
    ...AC9_DISCLAIMER_PINS.map((p) => doc.indexOf(p, titleEnd)).filter((i) => i > -1),
  );
  // The filler the compensation eats must hold no pin at all, or the RED would
  // be attributable to a destroyed pin rather than to the budget. Measured: 359
  // characters of pin-free filler follow the title.
  if (firstPinAfter - titleEnd <= n + 8) {
    throw new Error(
      `growTitleCompensated(${n}): only ${firstPinAfter - titleEnd} characters of ` +
        `pin-free filler follow the title; the compensation would eat a pin`,
    );
  }
  const out =
    doc.slice(0, titleAt) +
    "x".repeat(n) +
    doc.slice(titleAt, titleEnd) +
    doc.slice(titleEnd + n);
  expect(out.length).toBe(doc.length); // net-zero: every later offset is unmoved
  expect(out.slice(titleAt, titleAt + n)).toBe("x".repeat(n)); // sited
  for (const p of AC9_DISCLAIMER_PINS.filter((q) => doc.indexOf(q, titleEnd) > -1)) {
    expect(out.indexOf(p, titleEnd)).toBe(doc.indexOf(p, titleEnd)); // unmoved
  }
  return out;
}

function budgetFor(doc: string, window: number) {
  const b = ac9Budgets(doc).find((x) => x.window === window);
  expect({ window, found: b !== undefined }).toEqual({ window, found: true });
  return b!;
}

// ══════════════ AC-STE-460.4 — headroom is a NUMBER, not positivity ══════════

describeIfSkills("AC-STE-460.4 — the headroom is asserted as a number", () => {
  test("the shipped document is GREEN and its measured headroom equals the RECORDED one", () => {
    expect(ac9BudgetFailures(smokeDoc!)).toEqual([]);
    const b = budgetFor(smokeDoc!, AC9_WINDOW);
    expect(b.headroom).toBe(b.recordedHeadroom);
  });

  test("the recorded figure is RECORDED, not derived — mutating the doc leaves it unmoved", () => {
    // NON-CIRCULARITY, PROVED RATHER THAN CLAIMED. `headroom === recordedHeadroom`
    // is worthless if both sides are computed from the same document: the
    // comparison would hold for every possible input, which is the same defect
    // AC.10 names one file over and which this milestone has shipped four times.
    const grown = growDisclaimerRegion(37);
    const before = budgetFor(smokeDoc!, AC9_WINDOW);
    const after = budgetFor(grown, AC9_WINDOW);
    expect(after.recordedHeadroom).toBe(before.recordedHeadroom); // blind to the doc
    expect(after.headroom).toBe(before.headroom - 37); // measured, and it moved
  });

  test("rotting the figure to 1 is RED — positivity is no longer what is asserted", () => {
    // The AC's named RED-producing input, applied from the document side: a
    // headroom of 1 is POSITIVE, so the shipped `headroom > 0` form scores GREEN
    // on it. The repaired form must not.
    const recorded = budgetFor(smokeDoc!, AC9_WINDOW).recordedHeadroom;
    const rotted = growDisclaimerRegion(recorded - 1);
    const after = budgetFor(rotted, AC9_WINDOW);
    expect(after.headroom).toBe(1);
    expect(after.headroom > 0).toBe(true); // the retired assertion still passes
    expect(ac9BudgetFailures(rotted)).not.toEqual([]); // the repaired one does not
  });

  test("the retired `> 0` form is gone from the suite that carried it", () => {
    // A rider, not the mechanism — the mechanism is the three executed arms
    // above. Kept because the retired form is short enough to be reintroduced
    // beside the repaired one without anyone noticing.
    const suite = read(SUITE_456);
    expect(suite).not.toBeNull();
    expect(suite!).not.toContain("headroomIsPositive");
    // POSITIVE TWIN — a ban is satisfied by deleting its subject, so name what
    // must REPLACE the retired form. Measured during this FR's audit: deleting
    // the equality below from the shipped suite left the gate byte-identically
    // GREEN while this ban stayed satisfied.
    expect(suite!).toContain("expect(headroom).toBe(AC9_WINDOW_HEADROOM);");
  });
});

// ══════════════ AC-STE-460.5 — the two regimes are no longer disjoint ════════

describeIfSkills("AC-STE-460.5 — growth of the headroom AND of headroom + 1 both redden", () => {
  test("EXECUTED: growth of exactly the headroom turns the suite RED", () => {
    const recorded = budgetFor(smokeDoc!, AC9_WINDOW).recordedHeadroom;
    const grown = growDisclaimerRegion(recorded);
    const b = budgetFor(grown, AC9_WINDOW);
    // MEASURED, and recorded here so the regime is visible rather than inferred:
    // at exactly the headroom NO pin has left the window, so the pin-presence
    // half of the budget is SILENT. Only the equality arm bites.
    expect(b.missing).toEqual([]);
    expect(b.headroom).toBe(0);
    expect(ac9BudgetFailures(grown)).not.toEqual([]);
  });

  test("EXECUTED: growth of headroom + 1 turns the suite RED, on the OTHER regime", () => {
    const recorded = budgetFor(smokeDoc!, AC9_WINDOW).recordedHeadroom;
    const grown = growDisclaimerRegion(recorded + 1);
    const b = budgetFor(grown, AC9_WINDOW);
    // The trailing pin has now left the window entirely, so the pin-presence
    // half fires…
    expect(b.missing).not.toEqual([]);
    // …and `furthest` DECREASED, which is the trap: losing the trailing pin
    // makes the maximum fall back to an earlier one, so the retired
    // `headroom > 0` assertion goes GREEN AGAIN exactly here. Recorded as an
    // executed fact rather than as a warning.
    expect(b.headroom).toBeGreaterThan(0);
    expect(ac9BudgetFailures(grown)).not.toEqual([]);
  });

  test("EXECUTED: the whole band reddens — no growth slips between the two arms", () => {
    // The FR's complaint is not about 94 and 95 specifically; it is that two
    // assertions biting in disjoint regimes leave a BAND that passes both.
    // Sweeping the band is what proves the band is closed.
    const recorded = budgetFor(smokeDoc!, AC9_WINDOW).recordedHeadroom;
    const green: number[] = [];
    for (let n = 1; n <= recorded + 40; n++) {
      if (ac9BudgetFailures(growDisclaimerRegion(n)).length === 0) green.push(n);
    }
    expect(green).toEqual([]);
  });
});

// ══════════════ AC-STE-460.8 — the tighter window is BUDGETED ════════════════

describeIfSkills("AC-STE-460.8 — the 61-character row title is budgeted, not merely asserted", () => {
  test("the tighter window is a budget of the SAME mechanism, with its own recorded figure", () => {
    const title = budgetFor(smokeDoc!, AC9_TITLE_WINDOW);
    expect(title.pins.map((p) => p.phrase)).toContain(AC9_TITLE_PIN);
    expect(title.headroom).toBe(title.recordedHeadroom);
    expect(title.missing).toEqual([]);
    // Two windows, two recorded figures, ONE predicate — which is what "budgeted
    // by the same mechanism" has to mean if it is to mean anything.
    expect(ac9Budgets(smokeDoc!).map((b) => b.window).sort((a, b) => a - b)).toEqual(
      [AC9_TITLE_WINDOW, AC9_WINDOW].sort((a, b) => a - b),
    );
  });

  test("the title pin is the SAME literal the shipped title assertion reads", () => {
    // One definition, or the budget is a budget for a different subject — the
    // stems-versus-subjects error `_ac9-row-guard.ts` already records once, where
    // a pin list that was not the guard list over-stated headroom by 33.
    expect(ac9Window(smokeDoc!).slice(0, AC9_TITLE_WINDOW)).toContain(AC9_TITLE_PIN);
    const suite = read(SUITE_456);
    expect(suite).not.toBeNull();
    // Pin the ASSERTION EXPRESSION, not the identifier — the `import {…}` line
    // satisfies a bare `toContain("AC9_TITLE_PIN")` on its own, and the audit
    // measured that deleting the assertion left the gate GREEN.
    expect(suite!).toContain("expect(row.slice(0, AC9_TITLE_WINDOW)).toContain(AC9_TITLE_PIN);");
    // …and the tighter cap is no longer restated as digits beside it.
    expect(suite!.split(String(AC9_TITLE_WINDOW)).length - 1).toBe(0);
  });

  test("EXECUTED: growth to exactly the title headroom reddens — the WIDE budget stays SILENT", () => {
    const recorded = budgetFor(smokeDoc!, AC9_TITLE_WINDOW).recordedHeadroom;
    const grown = growTitleCompensated(recorded);
    // Attribution, asserted on both sides: the wide budget is untouched.
    expect({
      wideMissing: budgetFor(grown, AC9_WINDOW).missing,
      wideHeadroom: budgetFor(grown, AC9_WINDOW).headroom,
    }).toEqual({
      wideMissing: [],
      wideHeadroom: budgetFor(smokeDoc!, AC9_WINDOW).recordedHeadroom,
    });
    expect(budgetFor(grown, AC9_TITLE_WINDOW).headroom).toBe(0);
    expect(ac9BudgetFailures(grown)).not.toEqual([]);
  });

  test("EXECUTED: growth past the title headroom pushes the title OUT, wide budget still silent", () => {
    const recorded = budgetFor(smokeDoc!, AC9_TITLE_WINDOW).recordedHeadroom;
    const grown = growTitleCompensated(recorded + 1);
    expect(budgetFor(grown, AC9_WINDOW).missing).toEqual([]);
    expect(budgetFor(grown, AC9_TITLE_WINDOW).missing).toEqual([AC9_TITLE_PIN]);
    expect(ac9BudgetFailures(grown)).not.toEqual([]);
  });

  test("EXECUTED: the whole title band reddens — the tighter window has no silent range", () => {
    const recorded = budgetFor(smokeDoc!, AC9_TITLE_WINDOW).recordedHeadroom;
    const green: number[] = [];
    for (let n = 1; n <= recorded + 20; n++) {
      if (ac9BudgetFailures(growTitleCompensated(n)).length === 0) green.push(n);
    }
    expect(green).toEqual([]);
  });

  test("EXECUTED: `missing` is exactly the not-found set — the removed disjunct added nothing", () => {
    // AC.7's other half, asserted against the repaired predicate: an overrun
    // state (`at !== -1 && endsAt > window`) is unreachable, so `missing` must
    // be exactly the pins `indexOf` could not find. If the two ever differed,
    // the removal of the dead disjunct would have changed behaviour.
    for (let n = 0; n <= 200; n += 5) {
      const doc = n === 0 ? smokeDoc! : growDisclaimerRegion(n);
      for (const b of ac9Budgets(doc)) {
        expect({ n, window: b.window, missing: b.missing }).toEqual({
          n,
          window: b.window,
          missing: b.pins.filter((p) => p.at === -1).map((p) => p.phrase),
        });
        expect(b.pins.filter((p) => p.at !== -1 && p.endsAt > b.window)).toEqual([]);
      }
    }
  });
});
