// STE-685 — the shared nested `bun test` runner (AC-STE-685.1, .2, .6).
//
//   AC.1  `tests/_nested_bun_test.ts` exports ONE runner, `runNestedBunTest`,
//         that spawns `bun test` with a `timeout` (default 300000 ms, overridable
//         per call) and `killSignal: "SIGKILL"`, returning
//         `{ exitCode, stdout, stderr, timedOut }`. A child that outlives its
//         timeout is killed and reported `timedOut: true`.
//   AC.2  The child gets `DPT_NESTED_BUN_TEST_DEPTH` one higher than the
//         caller's own (read from `process.env` at call time; absent = 0). A call
//         made at depth 3 THROWS before spawning, naming the depth and the
//         ceiling (3).
//   AC.6  Removing the runner's timeout, its SIGKILL, or its depth refusal each
//         reddens a test. The behavioural tests below are the reddening tests;
//         the AC.6 block proves it by importing a MUTATED COPY of the runner
//         (written under the OS temp dir — nothing in the repo is edited) and
//         showing the same check flips on each mutant.
//
// Every fixture lives in a fresh `mkdtemp` dir OUTSIDE the gate root, so the
// full `bun test` run never collects one. Fixtures are run by absolute path.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { stripComments } from "./_m292387_source";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const RUNNER_PATH = join(import.meta.dir, "_nested_bun_test.ts");
const DEPTH_ENV = "DPT_NESTED_BUN_TEST_DEPTH";

const scratch: string[] = [];
function freshDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste685-${tag}-`));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function fixture(tag: string, name: string, body: string): string {
  const path = join(freshDir(tag), name);
  writeFileSync(path, body);
  return path;
}

/** Run `fn` with `DPT_NESTED_BUN_TEST_DEPTH` set to `depth` (or unset), restoring it after. */
function atDepth<T>(depth: string | undefined, fn: () => T): T {
  const saved = process.env[DEPTH_ENV];
  if (depth === undefined) delete process.env[DEPTH_ENV];
  else process.env[DEPTH_ENV] = depth;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[DEPTH_ENV];
    else process.env[DEPTH_ENV] = saved;
  }
}

const PASSING = [
  'import { test, expect } from "bun:test";',
  'test("ste685 passing fixture", () => {',
  '  console.log("STE685-STDOUT-MARKER");',
  "  expect(1 + 1).toBe(2);",
  "});",
  "",
].join("\n");

const FAILING = [
  'import { test, expect } from "bun:test";',
  'test("ste685 failing fixture", () => {',
  "  expect(1 + 1).toBe(3);",
  "});",
  "",
].join("\n");

// Ignores SIGTERM and sleeps 8 s: only a SIGKILL ends it early.
const TERM_IGNORING_SLEEPER = [
  'import { test, expect } from "bun:test";',
  'process.on("SIGTERM", () => { console.log("STE685-TERM-IGNORED"); });',
  'test("ste685 sleeper", async () => {',
  "  await Bun.sleep(8000);",
  '  console.log("STE685-SLEEPER-FINISHED");',
  "  expect(1).toBe(1);",
  "}, 60000);",
  "",
].join("\n");

const DEPTH_ECHO = [
  'import { test, expect } from "bun:test";',
  'test("ste685 depth echo", () => {',
  `  console.log("STE685-CHILD-DEPTH=" + String(process.env.${DEPTH_ENV}));`,
  "  expect(1).toBe(1);",
  "});",
  "",
].join("\n");

function markerWriter(markerPath: string): string {
  return [
    'import { test, expect } from "bun:test";',
    'import { writeFileSync } from "node:fs";',
    `writeFileSync(${JSON.stringify(markerPath)}, "ran");`,
    'test("ste685 marker", () => { expect(1).toBe(1); });',
    "",
  ].join("\n");
}

// Recurses through the runner until the runner refuses.
function recursingFixture(runnerPath: string): string {
  return [
    'import { test, expect } from "bun:test";',
    `import { runNestedBunTest } from ${JSON.stringify(runnerPath)};`,
    'test("ste685 recurse", () => {',
    `  const depth = String(process.env.${DEPTH_ENV});`,
    "  try {",
    "    const r = runNestedBunTest([import.meta.path], { timeoutMs: 25000 });",
    '    console.log("STE685-LEVEL " + depth + " child-exit=" + r.exitCode);',
    "    console.log(r.stdout);",
    "    console.log(r.stderr);",
    "  } catch (e) {",
    '    console.log("STE685-REFUSED-AT " + depth + " :: " + (e as Error).message);',
    "  }",
    "  expect(1).toBe(1);",
    "}, 28000);",
    "",
  ].join("\n");
}

function ownDepth(): number {
  const raw = process.env[DEPTH_ENV];
  return raw === undefined || raw === "" ? 0 : Number(raw);
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-685.1 — one runner, bounded, reporting exit/stdout/stderr/timedOut
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-685.1 — runNestedBunTest", () => {
  test("module exists at tests/_nested_bun_test.ts and exports the runner as a function", () => {
    expect(existsSync(RUNNER_PATH)).toBe(true);
    expect(typeof runNestedBunTest).toBe("function");
  });

  test("a passing child reports exitCode 0, its stdout, and timedOut false", () => {
    const file = fixture("pass", "passing.test.ts", PASSING);
    const r = runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 });
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(typeof r.stdout).toBe("string");
    expect(typeof r.stderr).toBe("string");
    expect(r.stdout).toContain("STE685-STDOUT-MARKER");
    expect(r.stderr).toContain("1 pass");
  }, 29_000);

  test("a failing child reports a non-zero exitCode and its stderr", () => {
    const file = fixture("fail", "failing.test.ts", FAILING);
    const r = runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 });
    expect(r.exitCode).toBe(1);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).toContain("1 fail");
  }, 29_000);

  test("a child that outlives a per-call timeout is SIGKILLed promptly and reported timedOut: true", () => {
    const file = fixture("kill", "sleeper.test.ts", TERM_IGNORING_SLEEPER);
    const started = Date.now();
    const r = runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 1_500 });
    const elapsed = Date.now() - started;
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
    // The fixture ignores SIGTERM and sleeps 8 s: only SIGKILL at ~1.5 s ends it this early.
    expect(elapsed).toBeLessThan(6_000);
    expect(r.stdout).not.toContain("STE685-SLEEPER-FINISHED");
  }, 29_000);

  test("the default timeout is 300000 ms and the kill signal is SIGKILL (source pin)", () => {
    const src = stripComments(readFileSync(RUNNER_PATH, "utf8"));
    expect(src).toMatch(/\b300_?000\b/);
    expect(src).toMatch(/\bkillSignal\s*:\s*["']SIGKILL["']/);
    expect(src).toMatch(/\btimeout\s*:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-685.2 — depth counter and the depth-3 refusal
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-685.2 — DPT_NESTED_BUN_TEST_DEPTH", () => {
  test("the child receives the caller's depth plus one (unset caller = 0 → child 1)", () => {
    const file = fixture("echo0", "echo.test.ts", DEPTH_ECHO);
    const r = atDepth(undefined, () => runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("STE685-CHILD-DEPTH=1");
  }, 29_000);

  test("a caller at depth 2 may still spawn, and its child sees depth 3", () => {
    const file = fixture("echo2", "echo.test.ts", DEPTH_ECHO);
    const r = atDepth("2", () => runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("STE685-CHILD-DEPTH=3");
  }, 29_000);

  test("a call made at depth 3 throws before spawning, naming the depth and the ceiling", () => {
    const dir = freshDir("refuse");
    const marker = join(dir, "spawned.marker");
    const file = join(dir, "marker.test.ts");
    writeFileSync(file, markerWriter(marker));
    let message = "";
    atDepth("3", () => {
      try {
        runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 });
        message = "<<did not throw>>";
      } catch (e) {
        message = (e as Error).message;
      }
    });
    expect(message).not.toBe("<<did not throw>>");
    expect(message).toMatch(/depth\D{0,40}3/i);
    expect(message).toMatch(/ceiling\D{0,40}3/i);
    expect(existsSync(marker)).toBe(false);
  }, 29_000);

  test("a call made past the ceiling (depth 4) also refuses before spawning", () => {
    const dir = freshDir("refuse4");
    const marker = join(dir, "spawned.marker");
    const file = join(dir, "marker.test.ts");
    writeFileSync(file, markerWriter(marker));
    expect(() =>
      atDepth("4", () => runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 })),
    ).toThrow(/4/);
    expect(existsSync(marker)).toBe(false);
  }, 29_000);

  test("a self-recursing fixture runs levels 1..3 and is refused at depth 3", () => {
    if (ownDepth() >= 1) {
      // Under an outer nested run the chain is shorter; the refusal tests above still grade AC.2.
      return;
    }
    const file = fixture("recurse", "recurse.test.ts", recursingFixture(RUNNER_PATH));
    const r = atDepth(undefined, () => runNestedBunTest([file], { cwd: PLUGIN_ROOT, timeoutMs: 28_000 }));
    const all = `${r.stdout}\n${r.stderr}`;
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(all).toContain("STE685-LEVEL 1 child-exit=0");
    expect(all).toContain("STE685-LEVEL 2 child-exit=0");
    expect(all).toContain("STE685-REFUSED-AT 3 ::");
    expect(all).not.toContain("STE685-LEVEL 3 ");
    expect(all).not.toContain("STE685-REFUSED-AT 1 ");
    expect(all).not.toContain("STE685-REFUSED-AT 2 ");
  }, 29_500);
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-685.6 — each guard's removal flips a check
// ═══════════════════════════════════════════════════════════════════════════

type Runner = typeof runNestedBunTest;

async function importMutant(tag: string, mutate: (src: string) => string): Promise<Runner> {
  const original = stripComments(readFileSync(RUNNER_PATH, "utf8"));
  const mutated = mutate(original);
  // The mutation must have APPLIED; a no-op mutant would prove nothing.
  expect(mutated).not.toBe(original);
  const path = join(freshDir(`mutant-${tag}`), "_nested_bun_test.ts");
  writeFileSync(path, mutated);
  const mod = (await import(path)) as { runNestedBunTest: Runner };
  expect(typeof mod.runNestedBunTest).toBe("function");
  return mod.runNestedBunTest;
}

const DROP_TIMEOUT = (src: string) => src.replace(/\btimeout\s*:\s*[^,\n}]+,?/g, "");
const DROP_SIGKILL = (src: string) => src.replace(/\bkillSignal\s*:\s*["']SIGKILL["']\s*,?/g, "");
const DROP_REFUSAL = (src: string) => src.replace(/\bthrow\s+new\s+[A-Za-z_$][\w$]*\s*\(/g, "void (");

describe("AC-STE-685.6 — removing a guard reddens a check", () => {
  test("CONTROL: an unpatched copy kills the TERM-ignoring sleeper at its timeout", async () => {
    const run = await importMutant("control", (s) => `${s}\n// control copy\n`);
    const file = fixture("m-ctl", "sleeper.test.ts", TERM_IGNORING_SLEEPER);
    const started = Date.now();
    const r = run([file], { cwd: PLUGIN_ROOT, timeoutMs: 1_500 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 29_000);

  test("MUTANT no-timeout: the sleeper runs to completion and is NOT reported timedOut", async () => {
    const run = await importMutant("no-timeout", DROP_TIMEOUT);
    const file = fixture("m-to", "sleeper.test.ts", TERM_IGNORING_SLEEPER);
    const r = run([file], { cwd: PLUGIN_ROOT, timeoutMs: 1_500 });
    // The AC.1 kill test asserts timedOut === true; this mutant breaks it.
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toContain("STE685-SLEEPER-FINISHED");
  }, 29_000);

  test("MUTANT no-SIGKILL: SIGTERM is ignored, so the run outlives the AC.1 kill test's 6 s bound", async () => {
    const run = await importMutant("no-sigkill", DROP_SIGKILL);
    const file = fixture("m-sk", "sleeper.test.ts", TERM_IGNORING_SLEEPER);
    const started = Date.now();
    run([file], { cwd: PLUGIN_ROOT, timeoutMs: 1_500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(6_000);
  }, 29_000);

  test("MUTANT no-refusal: a call at depth 3 spawns instead of throwing", async () => {
    const run = await importMutant("no-refusal", DROP_REFUSAL);
    const dir = freshDir("m-ref");
    const marker = join(dir, "spawned.marker");
    const file = join(dir, "marker.test.ts");
    writeFileSync(file, markerWriter(marker));
    let threw = false;
    atDepth("3", () => {
      try {
        run([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(existsSync(marker)).toBe(true);
  }, 29_000);
});
