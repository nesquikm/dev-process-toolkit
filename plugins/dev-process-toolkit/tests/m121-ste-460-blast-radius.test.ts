// M121 / STE-460 — AC.10.
//
// THE SUBJECT IS THE MECHANISM, NOT THE NUMBER. The plan's blast-radius pin is a
// pair of hardcoded constants — `toContain("receives the seven surfaces above")`
// beside `expect(rows.length).toBe(7)` — which are two independently-worded
// restatements of one fact. The pair has gone stale FOUR times, once per
// milestone growth. Correcting the constants a fifth time reproduces the
// mechanism; deriving retires it.
//
// THE CIRCULARITY BAN, which is what makes this file worth more than the pin it
// replaces. A derived comparison whose two sides come from ONE expression cannot
// fail, and would look identical in every passing run. So the two sides are
// proved INDEPENDENT by measurement: mutating the table must leave the prose
// expression's answer unmoved, and mutating the prose must leave the table
// expression's answer unmoved. Then each mutation is shown to REDDEN the
// comparison. A derivation that cannot be made to redden is a finding, not a
// guard.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { proseSurfaceCount, tableSurfaceRows } from "./_m121-blast-radius";
import { mutateInRegion } from "./_sited-mutation";

const TESTS_DIR = import.meta.dir;
const PLUGIN_ROOT = join(TESTS_DIR, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SUITE_457 = join(TESTS_DIR, "m121-ste-457-mode-none-claim-instruction.test.ts");

// AC-STE-459.2's house conditional — live-then-archive, so this suite survives
// its own milestone's archival instead of going silently skipped.
const PLAN_ACTIVE = join(REPO_ROOT, "specs/plan/M121.md");
const PLAN_ARCHIVED = join(REPO_ROOT, "specs/plan/archive/M121.md");
const PLAN_M121 = existsSync(PLAN_ACTIVE) ? PLAN_ACTIVE : PLAN_ARCHIVED;

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function planDoc(): string {
  const plan = read(PLAN_M121);
  expect(plan).not.toBeNull();
  return plan!;
}

function tableRegion(plan: string): [number, number] {
  const start = plan.indexOf("| Shipped surface | Touched by | Nature of change |");
  expect(start).toBeGreaterThan(-1);
  const end = plan.indexOf("\n\n", plan.indexOf("\n|---|", start));
  expect(end).toBeGreaterThan(start);
  return [start, end];
}

function proseRegion(plan: string): [number, number] {
  const start = plan.indexOf("Only the two project-local driver skills");
  expect(start).toBeGreaterThan(-1);
  const end = plan.indexOf("\n\n", start);
  expect(end).toBeGreaterThan(start);
  return [start, end];
}

/**
 * Add one row to the table, touching NOTHING else.
 *
 * The anchor is the table's LAST ROW, resolved from the table itself rather than
 * spelled here, and the mutation is sited inside the table's region. A
 * first-occurrence replacement over this plan lands on the wrong instance —
 * several of its rows share a path prefix.
 */
function planWithExtraRow(plan: string): string {
  const rows = tableSurfaceRows(plan);
  expect(rows.length).toBeGreaterThan(0);
  const last = rows[rows.length - 1]!;
  const [from, to] = tableRegion(plan);
  const fabricated =
    "| `plugins/dev-process-toolkit/tests/_ste-460-fabricated-surface.ts` | STE-460 | fabricated row, falsifiability arm only |";
  return mutateInRegion(plan, from, to, last, `${last}\n${fabricated}`);
}

/** Change the prose count word, touching NOTHING else. */
function planWithProseCountBumped(plan: string): string {
  const [from, to] = proseRegion(plan);
  return mutateInRegion(
    plan,
    from,
    to,
    "receives the seven surfaces",
    "receives the eight surfaces",
  );
}

describe("AC-STE-460.10 — the blast-radius count is derived, and the derivation can fail", () => {
  test("the plan resolves, so nothing below is a silent skip", () => {
    expect(read(PLAN_M121)).not.toBeNull();
    expect(tableSurfaceRows(planDoc()).length).toBeGreaterThan(0);
  });

  test("the two sides agree on the shipped plan", () => {
    const plan = planDoc();
    expect(proseSurfaceCount(plan)).toBe(tableSurfaceRows(plan).length);
  });

  test("the TABLE side is blind to the prose — mutating the sentence does not move it", () => {
    // NON-CIRCULARITY, half one. One expression feeding both sides is an
    // assertion incapable of failing; this is the arm that rules it out.
    const plan = planDoc();
    const bumped = planWithProseCountBumped(plan);
    expect(tableSurfaceRows(bumped).length).toBe(tableSurfaceRows(plan).length);
    expect(proseSurfaceCount(bumped)).toBe(proseSurfaceCount(plan) + 1);
  });

  test("the PROSE side is blind to the table — adding a row does not move it", () => {
    // NON-CIRCULARITY, half two.
    const plan = planDoc();
    const extra = planWithExtraRow(plan);
    expect(proseSurfaceCount(extra)).toBe(proseSurfaceCount(plan));
    expect(tableSurfaceRows(extra).length).toBe(tableSurfaceRows(plan).length + 1);
  });

  test("FALSIFIABILITY: a row added WITHOUT touching the prose sentence reddens the comparison", () => {
    // The AC's named RED-producing input, executed. If this cannot be made to
    // redden, the derivation is decorative and the finding is that, not a pass.
    const extra = planWithExtraRow(planDoc());
    expect(proseSurfaceCount(extra)).not.toBe(tableSurfaceRows(extra).length);
  });

  test("FALSIFIABILITY: a prose count changed WITHOUT touching the table reddens it too", () => {
    // The other direction, because a comparison that only sees table growth
    // would go silent on the far commoner edit: someone updating the sentence
    // and forgetting the table.
    const bumped = planWithProseCountBumped(planDoc());
    expect(proseSurfaceCount(bumped)).not.toBe(tableSurfaceRows(bumped).length);
  });

  test("the two hardcoded constants are gone from the shipped pin", () => {
    const suite = read(SUITE_457);
    expect(suite).not.toBeNull();
    expect(suite!).not.toContain("receives the seven surfaces above");
    expect(suite!).not.toContain("toBe(7)");
    expect(suite!).toContain("./_m121-blast-radius");
    // POSITIVE TWIN — pin the ASSERTION EXPRESSION, not the identifier.
    // Measured during this FR's audit: with only the import pinned, deleting the
    // comparison below from the shipped suite left the whole gate byte-identically
    // GREEN — the `import {…}` line alone satisfied `toContain("<identifier>")`.
    // That is Pattern 31 rider 1 landing on this AC's OWN named subject, so the
    // ban above needs a twin that names what must still be executed.
    expect(suite!).toContain(
      "expect(proseSurfaceCount(plan!)).toBe(tableSurfaceRows(plan!).length);",
    );
  });

  test("the three per-surface coverage assertions beside it are BYTE-UNCHANGED", () => {
    // EXPLICITLY PROTECTED. Those assertions are correct and are not what this
    // AC replaces — a repair that deleted them while retiring the two constants
    // would trade a stale number for a smaller guard, which is the shape of
    // "fix" this milestone keeps catching.
    const suite = read(SUITE_457);
    expect(suite).not.toBeNull();
    for (const surface of [
      '"skills/implement/SKILL.md"',
      '"docs/implement-reference.md"',
      '"docs/workflow-overview.md"',
    ]) {
      expect({ surface, present: suite!.includes(surface) }).toEqual({ surface, present: true });
    }
    expect(suite!).toContain(
      'expect(rows.some((r) => r.includes(surface) && r.includes("STE-457"))).toBe(true);',
    );
  });
});
