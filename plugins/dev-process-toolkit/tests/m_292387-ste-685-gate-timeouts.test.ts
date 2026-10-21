// STE-685 — per-test time limits in the gate (AC-STE-685.4, AC-STE-685.5).
//
//   AC.4  `plugins/dev-process-toolkit/bunfig.toml` sets `[test] timeout = 30000`.
//         A fixture test that sleeps 6 s (no per-test timeout of its own), run
//         through the shared runner from the gate root, PASSES; the same run
//         from a directory with no bunfig fails at bun's 5000 ms default.
//   AC.5  The m116-ste-424 probe #73 dogfood test declares its own 30000 ms
//         timeout.
//
// NOTE for the implementer: bun 1.3.14 parses `[test] timeout` in bunfig.toml
// but does NOT apply it (measured: a 6 s test still times out at 5000 ms with
// only that line present). A `[test] preload` that calls
// `setDefaultTimeout(30000)` from "bun:test" does apply. The behavioural check
// below grades the OUTCOME, so whichever mechanism the file uses must work.
//
// The fixture lives in a mkdtemp dir outside the gate root (never collected) and
// is run by absolute path. The runner is imported lazily so the bunfig and
// dogfood pins grade on their own while the runner is missing.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { enclosingCall, stripComments } from "./_m292387_source";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const BUNFIG = join(PLUGIN_ROOT, "bunfig.toml");
const M116 = join(import.meta.dir, "m116-ste-424-short-ulid-collision.test.ts");
const DOGFOOD_TITLE = "dogfood — this repo (mode: linear) still returns zero probe #73 violations";

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste685-${tag}-`));
  scratch.push(d);
  return d;
}

const SIX_SECOND_SLEEPER = [
  'import { test, expect } from "bun:test";',
  'test("ste685 sleeps six seconds", async () => {',
  "  await Bun.sleep(6000);",
  '  console.log("STE685-SIX-DONE");',
  "  expect(1).toBe(1);",
  "});",
  "",
].join("\n");

type Runner = (
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
) => { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean };

async function loadRunner(): Promise<Runner> {
  const mod = (await import("./_nested_bun_test")) as { runNestedBunTest: Runner };
  return mod.runNestedBunTest;
}

/** `[test]` section body of a TOML text (up to the next `[section]`), or null. */
function testSection(toml: string): string | null {
  const m = /^\[test\][ \t]*$/m.exec(toml);
  if (m === null) return null;
  const rest = toml.slice(m.index + m[0].length);
  const next = /^\[[^\]]+\][ \t]*$/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

describe("AC-STE-685.4 — the gate root's bunfig.toml sets a 30 s per-test timeout", () => {
  test("bunfig.toml exists at the plugin root with `[test] timeout = 30000`", () => {
    expect(existsSync(BUNFIG)).toBe(true);
    const section = testSection(readFileSync(BUNFIG, "utf8"));
    expect(section).not.toBeNull();
    expect(section as string).toMatch(/^\s*timeout\s*=\s*30_?000\s*(?:#.*)?$/m);
  });

  test("a 6 s fixture run through the runner from the gate root passes", async () => {
    const run = await loadRunner();
    const file = join(freshDir("six-root"), "six.test.ts");
    writeFileSync(file, SIX_SECOND_SLEEPER);
    const r = run([file], { cwd: PLUGIN_ROOT, timeoutMs: 25_000 });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.timedOut).toBe(false);
    expect(out).not.toContain("timed out after 5000ms");
    expect(out).toContain("STE685-SIX-DONE");
    expect(r.exitCode).toBe(0);
  }, 29_000);

  test("the same run from a directory with no bunfig fails at the 5000 ms default", async () => {
    const run = await loadRunner();
    const dir = freshDir("six-bare");
    const file = join(dir, "six.test.ts");
    writeFileSync(file, SIX_SECOND_SLEEPER);
    const r = run([file], { cwd: dir, timeoutMs: 25_000 });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(out).toContain("timed out after 5000ms");
  }, 29_000);
});

describe("AC-STE-685.5 — the probe #73 dogfood test declares its own 30000 ms timeout", () => {
  test("m116-ste-424's dogfood test call ends with a 30000 timeout argument", () => {
    const src = stripComments(readFileSync(M116, "utf8"));
    const at = src.indexOf(DOGFOOD_TITLE);
    expect(at).toBeGreaterThan(-1);
    const call = enclosingCall(src, at);
    // the enclosing call is the test(...) registration itself
    expect(src.slice(0, src.indexOf(call)).trimEnd().endsWith("test")).toBe(true);
    expect(call).toMatch(/\}\s*,\s*30_?000\s*,?\s*\)$/);
  });
});
