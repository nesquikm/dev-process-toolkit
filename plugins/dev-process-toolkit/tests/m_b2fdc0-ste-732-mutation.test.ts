// STE-732 (M_b2fdc0) — AC-STE-732.7: the mutation battery.
//
// Removing any new parser's summary-line requirement, the mislabel refusal, or
// the Vitest table refusal must turn at least one NAMED test red.
//
// Each row copies the plugin's adapters/, templates/ and manifest to a temp
// directory, applies ONE sited mutation with `mutateInRegion` (the anchor must
// occur exactly once in the file), and drives the row's named legs — the very
// legs the main suites run, from tests/_m_b2fdc0_ste732_fixture.ts — against
// the copy. A row is KILLED only when:
//   - every leg it names PASSES on the unmutated copy and FAILS on the mutant;
//   - at least one named leg is in the rule's own category;
//   - every PERMIT leg (v3.3.0 behaviour) still passes on the mutant, so a
//     mutation that breaks loading is never read as a kill.
//
// SITING THE ROWS (the implementer's half of this contract): `file`, `find`
// and `replace` are null until the shipped code exists. Site each row with ONE
// exact anchor and a replacement that removes only that rule. A null row FAILS,
// naming itself — the battery never passes vacuously. The rule ids and kill
// categories are fixed by AC-STE-732.7 and must not be edited to make a row
// pass. Add a second row for a rule when two sites carry separate copies of it
// (e.g. the mislabel check in the bun AND the pytest parser, or the Vitest
// refusal in both front doors).
//
// The real tree is never mutated: `git status --porcelain` over the plugin is
// compared before and after.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { mutateInRegion } from "./_sited-mutation";
import { LEGS, LEG_BY_NAME, PLUGIN_ROOT, cleanupTemps, tempDir } from "./_m_b2fdc0_ste732_fixture";

setDefaultTimeout(600_000);

type Rule =
  | "vitest-summary-line"
  | "cargo-summary-line"
  | "playwright-summary-line"
  | "mislabel-refusal"
  | "vitest-table-refusal"
  // fix round 1 (AC-STE-732.2 amended 2026-11-10)
  | "vitest-failed-test-files"
  | "cargo-crashed-binary"
  | "playwright-interrupted-did-not-run";

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
  "vitest-summary-line": /^PARSER vitest /,
  "cargo-summary-line": /^PARSER cargo /,
  "playwright-summary-line": /^PARSER playwright /,
  "mislabel-refusal": /^MISLABEL /,
  "vitest-table-refusal": /^TABLE vitest /,
  "vitest-failed-test-files": /^PARSER vitest /,
  "cargo-crashed-binary": /^PARSER cargo /,
  "playwright-interrupted-did-not-run": /^PARSER playwright /,
};

/**
 * IMPLEMENTER: site `file` / `find` / `replace` for every row, and pick the
 * `kills` legs the mutation turns red (at least one in the rule's category).
 * Do not change `rule` or remove a row.
 */
const ROWS: Row[] = [
  {
    rule: "vitest-summary-line",
    guard: "the vitest parser reads only the `Tests` line and refuses when it is absent",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "return { ok: false, reason: \"could not determine test count — Vitest output lacks the `Tests` summary line\" };",
    replace: "return { ok: true, count: { total: 0, failures: 0, errors: 0, skipped: 0 } };",
    kills: ["PARSER vitest REFUSE — no Tests line, only Test Files"],
  },
  {
    rule: "cargo-summary-line",
    guard: "the cargo parser reads only `test result:` lines and refuses when there is none",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "return { ok: false, reason: \"could not determine test count — Cargo output has no `test result:` line\" };",
    replace: "return { ok: true, count: { total: 0, failures: 0, errors: 0, skipped: 0 } };",
    kills: ["PARSER cargo REFUSE — a compile error prints no test result line"],
  },
  {
    rule: "playwright-summary-line",
    guard: "the playwright parser reads only the footer's summary lines and refuses when there is none",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "return { ok: false, reason: \"could not determine test count — Playwright output lacks the summary footer\" };",
    replace: "return { ok: true, count: { total: 0, failures: 0, errors: 0, skipped: 0 } };",
    kills: ["PARSER playwright REFUSE — no tests found prints no summary"],
  },
  {
    rule: "mislabel-refusal",
    guard: "the bun and pytest parsers refuse output carrying another runner's signature line",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "  if (runner === undefined) return undefined;\n",
    replace: "  return undefined;\n",
    kills: ["MISLABEL pytest — Vitest output refuses, naming vitest", "MISLABEL gate — a Vitest output declared as pytest refuses at gate_capture"],
  },
  {
    rule: "vitest-table-refusal",
    guard: "a package.json listing vitest gets no table gate; both front doors refuse",
    file: "adapters/_shared/src/capture_skip_baseline.ts",
    find: "      if (entry.marker === \"package.json\" && packageJsonListsVitest(projectRoot)) return null;\n",
    replace: "\n",
    kills: ["TABLE vitest gate — devDependencies vitest: gate_capture refuses naming verification.test_commands, bun never runs"],
  },
  // ---- fix round 1 (operator ruling 2026-11-10): unsited until the fix ships
  {
    rule: "vitest-failed-test-files",
    guard: "`N failed` on the Vitest `Test Files` line (N > 0) folds into the failures",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "  const failed = Math.max(n(\"failed\"), failedFiles);\n",
    replace: "  const failed = n(\"failed\");\n",
    kills: ["PARSER vitest FAILED FILES — `Test Files  1 failed` folds into failures → 3 / 1 / 0"],
  },
  {
    rule: "cargo-crashed-binary",
    guard: "Cargo output carrying `error: test failed` never reads green",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "const CARGO_TEST_FAILED_RE = /^error: test failed\\b/m;\n",
    replace: "const CARGO_TEST_FAILED_RE = /(?!)/;\n",
    kills: ["PARSER cargo CRASH — `error: test failed` alone never reads green"],
  },
  {
    rule: "cargo-crashed-binary",
    guard: "Cargo output carrying `process didn't exit successfully` never reads green",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "const CARGO_PROCESS_FAILED_RE = /process didn't exit successfully/;\n",
    replace: "const CARGO_PROCESS_FAILED_RE = /(?!)/;\n",
    kills: ["PARSER cargo CRASH — `process didn't exit successfully` alone never reads green"],
  },
  {
    rule: "playwright-interrupted-did-not-run",
    guard: "Playwright's `N interrupted` footer line counts as failures",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "  const interrupted = footer(\"interrupted\");\n",
    replace: "  const interrupted = undefined;\n",
    kills: ["PARSER playwright INTERRUPTED — `1 interrupted` alone → 2 / 1 / 0"],
  },
  {
    rule: "playwright-interrupted-did-not-run",
    guard: "Playwright's `N did not run` footer line counts as failures",
    file: "adapters/_shared/src/test_count_parser.ts",
    find: "  const didNotRun = footer(\"did not run\");\n",
    replace: "  const didNotRun = undefined;\n",
    kills: ["PARSER playwright DID NOT RUN — `4 did not run` alone → 2 / 4 / 0"],
  },
];

function porcelain(): string {
  const p = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "status", "--porcelain", "--", "."], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString();
}

function copyPlugin(label: string): string {
  const copy = join(tempDir(`mut732-${label}`), "plugin");
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

describe("AC-STE-732.7 — the battery's shape", () => {
  test("every rule has a row, and every row names known non-permit legs, one in its own category", () => {
    for (const rule of Object.keys(CATEGORY) as Rule[]) expect({ rule, present: ROWS.some((r) => r.rule === rule) }).toEqual({ rule, present: true });
    for (const r of ROWS) {
      expect({ row: r.rule, kills: r.kills.length > 0 }).toEqual({ row: r.rule, kills: true });
      for (const k of r.kills) {
        expect({ row: r.rule, leg: k, known: LEG_BY_NAME.has(k) }).toEqual({ row: r.rule, leg: k, known: true });
        expect({ row: r.rule, leg: k, permit: LEG_BY_NAME.get(k)?.permit }).toEqual({ row: r.rule, leg: k, permit: false });
      }
      expect({ row: r.rule, inCategory: r.kills.some((k) => CATEGORY[r.rule].test(k)) }).toEqual({ row: r.rule, inCategory: true });
    }
  });

  test("CONTROL — the unmutated copy passes every permit leg and every leg the battery uses", async () => {
    const failures: string[] = [];
    for (const l of LEGS) {
      if (!l.permit && !ROWS.some((r) => r.kills.includes(l.name))) continue;
      const p = await l.check(srcOf(pristine));
      if (p !== null) failures.push(`${l.name}: ${p}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("AC-STE-732.7 — removing one rule turns a named test red", () => {
  for (const row of ROWS) {
    test(`${row.rule} — ${row.guard}`, async () => {
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
        const p = await l.check(srcOf(mutant));
        if (p !== null) throw new Error(`row ${row.rule}: the mutant broke the permit leg "${l.name}" (a load error or an over-wide mutation, not a kill):\n${p}`);
      }
      for (const k of row.kills) {
        const leg = LEG_BY_NAME.get(k)!;
        const before = await leg.check(srcOf(pristine));
        if (before !== null) throw new Error(`row ${row.rule}: "${k}" fails on the UNMUTATED copy:\n${before}`);
        const after = await leg.check(srcOf(mutant));
        if (after === null) throw new Error(`row ${row.rule} NOT KILLED: "${k}" still holds on the mutant`);
      }
    });
  }

  test("the real plugin tree was not mutated (git status unchanged)", () => {
    expect(porcelain()).toBe(statusBefore);
  });
});
