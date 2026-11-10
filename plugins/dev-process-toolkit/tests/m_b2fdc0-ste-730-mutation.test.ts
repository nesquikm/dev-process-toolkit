// STE-730 (M_b2fdc0) — AC-STE-730.9: the mutation battery.
//
// Removing the declared-list read, the summation, or the fail-closed rule must
// turn at least one NAMED test red.
//
// Each row copies the plugin's adapters/, templates/ and manifest to a temp
// directory, applies ONE sited mutation with `mutateInRegion` (the anchor must
// occur exactly once in the file), and drives the row's named legs — the very
// legs the main suite runs, from tests/_m_b2fdc0_ste730_fixture.ts — against
// the copy's front doors. A row is KILLED only when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - at least one named leg is in the rule's own category (DECLARED for the
//     read, SUM for the summation, CLOSED for fail-closed);
//   - every PERMIT leg (key absent → the table path) still passes on the
//     mutant, so a mutation that breaks loading is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `file`, `find`
// and `replace` are null until the shipped code exists. Site each row with ONE
// exact anchor and a replacement that removes only that rule. A null row FAILS,
// naming itself — the battery never passes vacuously. The rule ids and kill
// categories are fixed by AC-STE-730.9 and must not be edited to make a row
// pass. Add a second row for a rule when the two front doors carry separate
// copies of it.
//
// The real tree is never mutated: `git status --porcelain` over the plugin is
// compared before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import { LEGS, LEG_BY_NAME, PLUGIN_ROOT, cleanupTemps, tempDir } from "./_m_b2fdc0_ste730_fixture";

setDefaultTimeout(600_000);

type Rule = "declared-read" | "summation" | "fail-closed";

interface Row {
  rule: Rule;
  guard: string;
  /** Relative to the plugin root; null until sited. */
  file: string | null;
  /** The exact anchor (occurs exactly once in `file`); null until sited. */
  find: string | null;
  replace: string | null;
  /** Full leg names (from LEGS) the row turns red. */
  kills: string[];
}

const CATEGORY: Readonly<Record<Rule, RegExp>> = {
  "declared-read": /^(gate|baseline) DECLARED/,
  summation: /^(gate|baseline) SUM/,
  "fail-closed": /^(gate|baseline) CLOSED/,
};

/**
 * IMPLEMENTER: site `file` / `find` / `replace` for every row. Do not change
 * `rule` or remove a row.
 */
const ROWS: Row[] = [
  {
    rule: "declared-read",
    guard: "the resolver reads `verification.test_commands` when present",
    file: "adapters/_shared/src/declared_test_commands.ts",
    find: "const list = verification?.test_commands;",
    replace: "const list: unknown = undefined;",
    kills: ["gate DECLARED — the fvm wrapper runs and bare flutter does not", "baseline DECLARED — the fvm wrapper runs and bare flutter does not"],
  },
  {
    rule: "summation",
    guard: "pass / fail / skip are summed over every declared entry",
    file: "adapters/_shared/src/declared_test_commands.ts",
    find: "pass += counts.pass;\n    fail += counts.fail;\n    skip += counts.skip;",
    replace: "pass = counts.pass;\n    fail = counts.fail;\n    skip = counts.skip;",
    kills: ["gate SUM — two make entries run in order and their counts add up"],
  },
  {
    rule: "fail-closed",
    guard: "an entry with no readable count, or killed on its bound, refuses the whole capture",
    file: "adapters/_shared/src/declared_test_commands.ts",
    find: "if (!counts.ok) {\n      throw declaredRefusal(",
    replace: "if (!counts.ok) {\n      return;\n      throw declaredRefusal(",
    kills: ["gate CLOSED — an entry with no readable count refuses, and no partial sum stands"],
  },
];

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "."], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

function copyPlugin(label: string): string {
  const copy = join(tempDir(`mut-${label}`), "plugin");
  mkdirSync(copy, { recursive: true });
  for (const d of ["adapters", "templates", ".claude-plugin"]) cpSync(join(PLUGIN_ROOT, d), join(copy, d), { recursive: true, dereference: true });
  return copy;
}

const srcOf = (pluginRoot: string) => join(pluginRoot, "adapters", "_shared", "src");

let statusBefore = "";
let pristine = "";
beforeAll(() => {
  statusBefore = porcelain();
  pristine = copyPlugin("pristine");
});
afterAll(() => cleanupTemps());

describe("AC-STE-730.9 — the battery's shape", () => {
  test("every rule has a row, and every row names known non-permit legs, one in its own category", () => {
    for (const rule of Object.keys(CATEGORY) as Rule[]) expect({ rule, present: ROWS.some((r) => r.rule === rule) }).toEqual({ rule, present: true });
    for (const r of ROWS) {
      for (const k of r.kills) {
        expect({ row: r.rule, leg: k, known: LEG_BY_NAME.has(k) }).toEqual({ row: r.rule, leg: k, known: true });
        expect({ row: r.rule, leg: k, permit: LEG_BY_NAME.get(k)?.permit }).toEqual({ row: r.rule, leg: k, permit: false });
      }
      expect({ row: r.rule, inCategory: r.kills.some((k) => CATEGORY[r.rule].test(k)) }).toEqual({ row: r.rule, inCategory: true });
    }
  });

  test("CONTROL — the unmutated copy passes every leg the battery uses", () => {
    const failures: string[] = [];
    for (const l of LEGS) {
      if (!l.permit && !ROWS.some((r) => r.kills.includes(l.name))) continue;
      const p = l.check(srcOf(pristine));
      if (p !== null) failures.push(`${l.name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-730.9 — removing one rule turns a named test red", () => {
  for (const row of ROWS) {
    test(`${row.rule} — ${row.guard}`, () => {
      if (row.file === null || row.find === null || row.replace === null) {
        throw new Error(`row ${row.rule} is not sited: set file/find/replace against the shipped code (one exact anchor, removing only this rule)`);
      }
      const mutant = copyPlugin(row.rule);
      const target = join(mutant, row.file);
      if (!existsSync(target)) throw new Error(`row ${row.rule}: ${row.file} does not exist`);
      const doc = readFileSync(target, "utf-8");
      writeFileSync(target, mutateInRegion(doc, 0, doc.length, row.find, row.replace, { label: `${row.rule} in ${row.file}` }));

      for (const l of LEGS) {
        if (!l.permit) continue;
        const p = l.check(srcOf(mutant));
        if (p !== null) throw new Error(`row ${row.rule}: the mutant broke the permit leg "${l.name}" (a load error or an over-wide mutation, not a kill):\n${p}`);
      }
      for (const k of row.kills) {
        const leg = LEG_BY_NAME.get(k)!;
        const before = leg.check(srcOf(pristine));
        if (before !== null) throw new Error(`row ${row.rule}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = leg.check(srcOf(mutant));
        if (after === null) throw new Error(`row ${row.rule} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real plugin tree was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});
