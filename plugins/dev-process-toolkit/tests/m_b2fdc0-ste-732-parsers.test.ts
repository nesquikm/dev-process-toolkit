// STE-732 (M_b2fdc0) — the test-count parsers read Vitest, Cargo and
// Playwright, and the bun / pytest parsers refuse another runner's output.
//
// AC-STE-732.1 (stack vocabulary, settings, docs), .2 (per-parser counts and
// summary-line refusals), .3 (`deriveRunCounts` exact pass / fail / skip),
// .4 (mislabel refusal naming the runner; v3.3.0 counts unchanged), .8 (parser
// half: bun / pytest / flutter derive exactly what v3.3.0 derived, graded
// against the real v3.3.0 parser extracted with `git archive`).
//
// The per-parser and mislabel legs are defined once in
// tests/_m_b2fdc0_ste732_fixture.ts and run here by name; the mutation battery
// grades the same legs.
//
// All names are synthetic.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CARGO_COMPILE_ERROR,
  CARGO_GREEN,
  CARGO_MIXED,
  EXPECTED,
  FOREIGN_LOOKING_RUNS,
  LEGACY_ANSI_CORPUS,
  LEGACY_ANSI_EXPECTED,
  LEGACY_CORPUS,
  PLAYWRIGHT_GREEN,
  PLAYWRIGHT_MIXED,
  PLAYWRIGHT_NO_TESTS,
  PLUGIN_ROOT,
  SHIPPED_SRC,
  VITEST_GREEN,
  VITEST_MIXED,
  VITEST_NO_TESTS_LINE,
  VITEST_UNHANDLED_ERRORS,
  cleanupTemps,
  out,
  runLeg,
  settingsYaml,
  tempDir,
} from "./_m_b2fdc0_ste732_fixture";

setDefaultTimeout(60_000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P: any = await import(join(SHIPPED_SRC, "test_count_parser.ts"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const D: any = await import(join(SHIPPED_SRC, "deliver_stage_evidence.ts"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: any = await import(join(SHIPPED_SRC, "project_settings.ts"));

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
  cleanupTemps();
});

async function leg(name: string): Promise<void> {
  expect(await runLeg(name, SHIPPED_SRC)).toBeNull();
}

// ===========================================================================
// AC-STE-732.1 — vitest, cargo and playwright join the stack vocabulary
// ===========================================================================

describe("AC-STE-732.1 — the three stacks join the vocabulary, the settings loader and the docs", () => {
  test("TEST_COMMAND_STACKS is exactly bun, pytest, flutter, vitest, cargo, playwright", () => {
    expect([...S.TEST_COMMAND_STACKS].sort()).toEqual(["bun", "cargo", "flutter", "playwright", "pytest", "vitest"]);
  });

  test("parseTestOutput dispatches each new stack to a parser (never the `unknown stack` refusal)", () => {
    for (const [stack, lines] of [
      ["vitest", VITEST_GREEN],
      ["cargo", CARGO_GREEN],
      ["playwright", PLAYWRIGHT_GREEN],
    ] as const) {
      const r = P.parseTestOutput(out(lines), stack);
      expect({ stack, ok: r.ok }).toEqual({ stack, ok: true });
    }
  });

  test("verification.test_commands accepts an entry for each new stack", () => {
    const list = [
      { stack: "vitest", command: ["pnpm", "vitest", "run"] },
      { stack: "cargo", command: ["cargo", "test"] },
      { stack: "playwright", command: ["npx", "playwright", "test"] },
    ];
    const root = mkdtempSync(join(tmpdir(), "ste732-settings-"));
    ROOTS.push(root);
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settingsYaml(list));
    expect(S.loadProjectSection(root, "verification").test_commands).toEqual(list);
    expect(S.loadProjectSettings(root).settings.verification.test_commands).toEqual(list);
  });

  test("an unknown stack is still refused (the vocabulary grew by exactly three)", () => {
    const root = mkdtempSync(join(tmpdir(), "ste732-settings-"));
    ROOTS.push(root);
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settingsYaml([{ stack: "jest", command: ["npx", "jest"] }]));
    expect(() => S.loadProjectSection(root, "verification")).toThrow(/verification\.test_commands\[0\]\.stack/);
  });

  test("docs/settings-reference.md's test_commands row lists all six stacks", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "settings-reference.md"), "utf-8");
    const row = doc.split("\n").find((l) => l.startsWith("| `verification.test_commands`"));
    expect(row).toBeDefined();
    for (const stack of ["bun", "pytest", "flutter", "vitest", "cargo", "playwright"]) expect({ stack, listed: row!.includes(`\`${stack}\``) }).toEqual({ stack, listed: true });
  });
});

// ===========================================================================
// AC-STE-732.2 — each parser reads its own summary line, or refuses
// ===========================================================================

describe("AC-STE-732.2 — vitest reads the `Tests` line, never `Test Files`", () => {
  test("green: Test Files 2 passed / Tests 5 passed → 5 passed, not 2", () => leg("PARSER vitest COUNT — reads the Tests line, not the Test Files line (green)"));
  test("mixed: Tests 1 failed | 6 passed | 2 skipped | 1 todo → pass 6, fail 1, skip 3 (todo counts as skipped)", () =>
    leg("PARSER vitest COUNT — failed, passed, skipped + todo from the Tests line (mixed)"));
  test("parseTestOutput's own counters on the mixed run: failures 1, errors 0, skipped 3", () => {
    const r = P.parseTestOutput(out(VITEST_MIXED), "vitest");
    expect(r.ok).toBe(true);
    expect({ failures: r.count.failures, errors: r.count.errors, skipped: r.count.skipped }).toEqual({ failures: 1, errors: 0, skipped: 3 });
  });
  test("refuses when the Tests line is absent, even with a Test Files line present", () => leg("PARSER vitest REFUSE — no Tests line, only Test Files"));
  test("refuses Cargo output", () => leg("PARSER vitest REFUSE — a Cargo run is not a Vitest run"));
});

describe("AC-STE-732.2 — cargo sums every `test result:` line", () => {
  test("green: 2 passed + 1 ignored, then doc-tests 2 passed → pass 4, fail 0, skip 1", () => leg("PARSER cargo COUNT — sums every test result line (green)"));
  test("three binaries, the last failing → pass 6, fail 1, skip 1", () => leg("PARSER cargo COUNT — sums every test result line (three binaries, one failing)"));
  test("parseTestOutput's own counters on the three-binary run: failures 1, errors 0, skipped 1", () => {
    const r = P.parseTestOutput(out(CARGO_MIXED), "cargo");
    expect(r.ok).toBe(true);
    expect({ failures: r.count.failures, errors: r.count.errors, skipped: r.count.skipped }).toEqual({ failures: 1, errors: 0, skipped: 1 });
  });
  test("a single binary's line is not the whole run: the first line alone would say 2 passed", () => {
    expect(D.deriveRunCounts({ output: out(CARGO_MIXED), stack: "cargo" }).pass).toBe(6);
  });
  test("refuses a compile error (no test result line)", () => leg("PARSER cargo REFUSE — a compile error prints no test result line"));
  test("refuses Vitest output", () => leg("PARSER cargo REFUSE — a Vitest run is not a Cargo run"));
});

describe("AC-STE-732.2 — playwright reads the final passed / failed / flaky / skipped lines", () => {
  test("1 failed, 1 flaky, 2 skipped, 3 passed → pass 4 (flaky counts as passed), fail 1, skip 2", () =>
    leg("PARSER playwright COUNT — failed, flaky (as passed), skipped, passed"));
  test("green: 4 passed (2.1s) → pass 4", () => leg("PARSER playwright COUNT — green"));
  test("a test title carrying `9 passed` mid-line is not a summary line", () => {
    expect(D.deriveRunCounts({ output: out(PLAYWRIGHT_MIXED), stack: "playwright" }).pass).toBe(4);
  });
  test("parseTestOutput's own counters on the mixed run: failures 1, errors 0, skipped 2", () => {
    const r = P.parseTestOutput(out(PLAYWRIGHT_MIXED), "playwright");
    expect(r.ok).toBe(true);
    expect({ failures: r.count.failures, errors: r.count.errors, skipped: r.count.skipped }).toEqual({ failures: 1, errors: 0, skipped: 2 });
  });
  test("refuses `No tests found` (no summary footer)", () => leg("PARSER playwright REFUSE — no tests found prints no summary"));
  test("refuses Cargo output", () => leg("PARSER playwright REFUSE — a Cargo run is not a Playwright run"));
});

// ===========================================================================
// AC-STE-732.3 — deriveRunCounts is exact on every recorded output
// ===========================================================================

describe("AC-STE-732.3 — deriveRunCounts returns exact pass, fail and skip for each new stack", () => {
  const CASES = [
    ["vitest", "VITEST_GREEN", VITEST_GREEN],
    ["vitest", "VITEST_MIXED", VITEST_MIXED],
    ["cargo", "CARGO_GREEN", CARGO_GREEN],
    ["cargo", "CARGO_MIXED", CARGO_MIXED],
    ["playwright", "PLAYWRIGHT_GREEN", PLAYWRIGHT_GREEN],
    ["playwright", "PLAYWRIGHT_MIXED", PLAYWRIGHT_MIXED],
  ] as const;
  for (const [stack, label, lines] of CASES) {
    test(`${stack} ${label} → ${JSON.stringify(EXPECTED[label])}`, () => {
      expect(D.deriveRunCounts({ output: out(lines), stack })).toEqual({ ok: true, ...EXPECTED[label] });
    });
  }

  for (const [stack, label, lines] of [
    ["vitest", "VITEST_NO_TESTS_LINE", VITEST_NO_TESTS_LINE],
    ["cargo", "CARGO_COMPILE_ERROR", CARGO_COMPILE_ERROR],
    ["playwright", "PLAYWRIGHT_NO_TESTS", PLAYWRIGHT_NO_TESTS],
  ] as const) {
    test(`${stack} ${label} → { ok: false } carrying the parser's reason`, () => {
      const r = D.deriveRunCounts({ output: out(lines), stack });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(P.parseTestOutput(out(lines), stack).reason);
    });
  }
});

// ===========================================================================
// AC-STE-732.4 — bun and pytest refuse another runner's output, naming it
// ===========================================================================

describe("AC-STE-732.4 — the bun and pytest parsers refuse a Vitest or Cargo run, naming the runner", () => {
  test("pytest ← Vitest output (v3.3.0 read `Test Files  2 passed` as 2 tests)", () => leg("MISLABEL pytest — Vitest output refuses, naming vitest"));
  test("pytest ← Cargo output (v3.3.0 read the first `2 passed;` as the run)", () => leg("MISLABEL pytest — Cargo output refuses, naming cargo"));
  test("bun ← Vitest output", () => leg("MISLABEL bun — Vitest output refuses, naming vitest"));
  test("bun ← Cargo output", () => leg("MISLABEL bun — Cargo output refuses, naming cargo"));

  test("the corpus of bun / pytest / flutter recorded outputs derives exactly its recorded counts", () => leg("PERMIT parsers — every bun / pytest / flutter corpus output derives its v3.3.0 counts"));
});

// ===========================================================================
// AC-STE-732.4 / .8 — parser counts identical to the real v3.3.0 parser
// ===========================================================================

const V330_SHA = "e9d6c6557688309802ed3a1aa668b647b9ac5537";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TRUNK: any = null;

beforeAll(async () => {
  const exists = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "cat-file", "-e", `${V330_SHA}^{commit}`], { stdout: "pipe", stderr: "pipe" });
  if (exists.exitCode !== 0) throw new Error(`v3.3.0 commit ${V330_SHA} is unreachable in this clone — fetch it; this guard never skips`);
  const top = Bun.spawnSync(["git", "-C", PLUGIN_ROOT, "rev-parse", "--show-toplevel"], { stdout: "pipe" }).stdout.toString().trim();
  const prefix = PLUGIN_ROOT.slice(top.length + 1);
  const dest = tempDir("ste732-trunk");
  const archive = Bun.spawnSync(["/bin/sh", "-c", `git -C '${top}' archive '${V330_SHA}' '${prefix}/adapters' | tar -x -C '${dest}'`], { stdout: "pipe", stderr: "pipe" });
  if (archive.exitCode !== 0) throw new Error(`git archive failed: ${archive.stderr.toString()}`);
  const src = join(dest, prefix, "adapters", "_shared", "src");
  if (!existsSync(join(src, "deliver_stage_evidence.ts"))) throw new Error(`trunk extraction has no deliver_stage_evidence.ts under ${src}`);
  TRUNK = await import(join(src, "deliver_stage_evidence.ts"));
});

describe("AC-STE-732.8 — bun / pytest / flutter parse exactly as at v3.3.0", () => {
  for (const c of LEGACY_CORPUS) {
    test(`${c.stack}: ${c.label} — now === v3.3.0`, () => {
      const now = D.deriveRunCounts({ output: c.output, stack: c.stack });
      const then = TRUNK.deriveRunCounts({ output: c.output, stack: c.stack });
      expect(then).toEqual({ ok: true, ...c.expected });
      expect(now).toEqual(then);
    });
  }

  test("a corpus output with no counters still refuses with v3.3.0's own reason (bun, pytest, flutter)", () => {
    for (const stack of ["bun", "pytest", "flutter"]) {
      const garbage = "make: the runner printed nothing countable\n";
      expect({ stack, now: D.deriveRunCounts({ output: garbage, stack }) }).toEqual({ stack, now: TRUNK.deriveRunCounts({ output: garbage, stack }) });
    }
  });
});


// ===========================================================================
// Phase 3 review — coloured output, foreign-looking lines, Vitest unhandled errors
// ===========================================================================

describe("AC-STE-732.2 — coloured (FORCE_COLOR) runs parse to the plain recordings' exact counts", () => {
  test("vitest green, coloured → 5 / 0 / 0", () => leg("ANSI vitest COUNT — coloured green run reads the Tests line"));
  test("vitest mixed, coloured → 6 / 1 / 3", () => leg("ANSI vitest COUNT — coloured mixed run reads the Tests line"));
  test("cargo green, coloured `ok` → 4 / 0 / 1", () => leg("ANSI cargo COUNT — coloured green run sums every test result line"));
  test("cargo three binaries, coloured `FAILED` → 6 / 1 / 1", () => leg("ANSI cargo COUNT — coloured three-binary run sums every test result line"));
  test("playwright green, coloured footer → 4 / 0 / 0", () => leg("ANSI playwright COUNT — coloured green footer"));
  test("playwright mixed, coloured footer → 4 / 1 / 2", () => leg("ANSI playwright COUNT — coloured mixed footer (flaky as passed)"));
});

describe("AC-STE-732.4 — a coloured Vitest or Cargo run declared as bun / pytest still refuses, naming the runner", () => {
  test("pytest ← coloured Vitest output", () => leg("ANSI MISLABEL pytest — coloured Vitest output refuses, naming vitest"));
  test("bun ← coloured Vitest output", () => leg("ANSI MISLABEL bun — coloured Vitest output refuses, naming vitest"));
  test("pytest ← coloured Cargo output", () => leg("ANSI MISLABEL pytest — coloured Cargo output refuses, naming cargo"));
  test("bun ← coloured Cargo output", () => leg("ANSI MISLABEL bun — coloured Cargo output refuses, naming cargo"));
});

describe("AC-STE-732.4 / .8 — a bun / pytest run that merely prints a foreign-looking line is not refused", () => {
  test("every foreign-looking run keeps its recorded v3.3.0 counts", () =>
    leg("PERMIT mislabel — a bun / pytest run that merely prints a bare `Test Files` or `test result: ok. N passed;` line keeps its v3.3.0 counts"));
  for (const c of FOREIGN_LOOKING_RUNS) {
    test(`${c.stack}: ${c.label} — now === v3.3.0`, () => {
      const now = D.deriveRunCounts({ output: out(c.lines), stack: c.stack });
      const then = TRUNK.deriveRunCounts({ output: out(c.lines), stack: c.stack });
      expect(then).toEqual({ ok: true, ...c.expected });
      expect(now).toEqual(then);
    });
  }
  test("the real runs those lines imitate are still refused as mislabelled (Test Files + Tests; full Cargo tail)", async () => {
    for (const name of [
      "MISLABEL pytest — Vitest output refuses, naming vitest",
      "MISLABEL bun — Vitest output refuses, naming vitest",
      "MISLABEL pytest — Cargo output refuses, naming cargo",
      "MISLABEL bun — Cargo output refuses, naming cargo",
    ]) {
      expect({ name, problem: await runLeg(name, SHIPPED_SRC) }).toEqual({ name, problem: null });
    }
  });
});

describe("AC-STE-732.8 — coloured bun / pytest / flutter output parses exactly as at v3.3.0 (no stripping imposed)", () => {
  test("every coloured corpus output derives its recorded v3.3.0 counts", () => leg("PERMIT parsers — coloured bun / pytest / flutter outputs derive exactly their v3.3.0 counts"));
  for (const c of LEGACY_ANSI_CORPUS) {
    test(`${c.stack}: ${c.label} — now === v3.3.0`, () => {
      const now = D.deriveRunCounts({ output: c.output, stack: c.stack });
      const then = TRUNK.deriveRunCounts({ output: c.output, stack: c.stack });
      expect(then).toEqual({ ok: true, ...LEGACY_ANSI_EXPECTED[c.label] });
      expect(now).toEqual(then);
    });
  }
});

describe("AC-STE-732.2 / .3 — a Vitest run with unhandled errors is not a green run", () => {
  test("`Errors  2 errors` → errors 2, and deriveRunCounts fails the run (5 / 2 / 0)", () => leg("PARSER vitest ERRORS — `Errors  2 errors` reports errors 2 and fails the run"));
  test("deriveRunCounts reports fail > 0", () => {
    const r = D.deriveRunCounts({ output: out(VITEST_UNHANDLED_ERRORS), stack: "vitest" });
    expect(r.ok).toBe(true);
    expect(r.fail).toBeGreaterThan(0);
  });
});
