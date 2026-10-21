// STE-686 — product child processes are bounded, and a red gate names its
// failing tests.
//
//   AC-STE-686.4  the `spawn_receipt.ts` front door runs its ownership check
//                 with a 10000 ms timeout and `killSignal: "SIGKILL"`; a check
//                 that outlives it ends in the `ownership-unresolved` refusal
//                 naming the timeout, with nothing on stdout.
//   AC-STE-686.5  `runTypedoc` passes `timeout: 60_000`; a typedoc that
//                 outlives it returns `ok: false` with a reason naming it.
//   AC-STE-686.6  `runAssertion` passes a 60000 ms timeout; an assertion that
//                 outlives it is reported as a command that did not complete,
//                 never as a count.
//   AC-STE-686.8  the `gate_capture.ts` front door prints `file > test name` for
//                 every failing test of the run it measured.
//
// HUNG CHILDREN are stubs that sleep past a bound SHRUNK for the test, so
// nothing here waits anywhere near a product bound:
//   * spawn_receipt — `DPT_OWNED_CHECK_TIMEOUT_MS` overrides the front door's
//     10000 ms bound (the shape `DPT_GATE_TIMEOUT_MS` already has);
//   * typedoc — `ExtractOptions.typedocTimeoutMs` overrides runTypedoc's bound;
//   * runAssertion — an optional second argument `{ timeoutMs }`.
// The shipped VALUES are pinned on the source text separately.
//
// `STE686_SRC_ROOT` overrides the module root for the mutation battery
// (AC-STE-686.10), which re-runs this file against patched copies.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { enclosingCall, functionBody, reachableNumbers, stripComments, timeoutExpressions } from "./_m292387_source";

const SRC_ROOT = process.env.STE686_SRC_ROOT ?? resolve(import.meta.dir, "../adapters/_shared/src");
const SPAWN_RECEIPT = join(SRC_ROOT, "spawn_receipt.ts");
const SIGNATURE_EXTRACTOR = join(SRC_ROOT, "signature_extractor.ts");
const FALSIFIABILITY = join(SRC_ROOT, "falsifiability_harness.ts");
const GATE_CAPTURE = join(SRC_ROOT, "gate_capture.ts");

const read = (p: string): string => readFileSync(p, "utf-8");

const TEMP_DIRS: string[] = [];
function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `m292387-686-${label}-`));
  TEMP_DIRS.push(d);
  return d;
}
afterAll(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TIMEOUT_RE = /tim(?:ed out|eout)/i;

/** An executable stub at `<dir>/<name>`. */
function stub(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return p;
}

// ===========================================================================
// AC-STE-686.4 — the spawn_receipt front door
// ===========================================================================

describe("AC-STE-686.4 — the ownership check is bounded and SIGKILLed", () => {
  // The check ARMS itself (`trap '' TERM`, then writes `armed`), sleeps
  // CHECK_SLEEP_S with its stdio detached, then writes `done`. Only a SIGKILL
  // stops an ARMED check before `done`: a SIGTERM is ignored and the front
  // door's spawnSync waits for the sleep to finish.
  //
  // RACE: on a loaded machine bash may not have run `trap` when the bound
  // fires, and then a SIGTERM kills it too. A run whose check never armed
  // proves nothing about the signal, so it is retried with a wider bound;
  // only an ARMED run is graded. The verdict is the `done` marker, not wall
  // time, so a slow machine cannot pass a mutant or fail the shipped code.
  const CHECK_SLEEP_S = 6;
  const BOUNDS_MS = [300, 1_500, 4_000];

  interface HungRun {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    elapsedMs: number;
    boundMs: number;
    finished: boolean;
  }

  function runOnce(boundMs: number): HungRun & { armed: boolean } {
    const dir = tempDir("owned");
    const armed = join(dir, "armed");
    const done = join(dir, "done");
    const check = stub(
      dir,
      "owned-check",
      `trap '' TERM\n: > '${armed}'\n/bin/sleep ${CHECK_SLEEP_S} </dev/null >/dev/null 2>&1\n: > '${done}'`,
    );
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.HOME = dir;
    env.CLAUDE_CONFIG_DIR = join(dir, "config");
    env.DPT_OWNED_CHECK_TIMEOUT_MS = String(boundMs);
    const t0 = performance.now();
    const proc = Bun.spawnSync(
      [process.execPath, SPAWN_RECEIPT, "surface:7", join(dir, "ledger.jsonl"), "worker-686", "cmux", check],
      { cwd: dir, env, stdout: "pipe", stderr: "pipe", timeout: 14_000 },
    );
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      elapsedMs: performance.now() - t0,
      boundMs,
      armed: existsSync(armed),
      finished: existsSync(done),
    };
  }

  /** Run the front door with a TERM-ignoring check that ARMED before its bound fired. */
  function runHungCheck(): HungRun {
    for (const boundMs of BOUNDS_MS) {
      const run = runOnce(boundMs);
      if (run.armed) return run;
    }
    throw new Error(`the ownership-check stub never armed its TERM trap within ${BOUNDS_MS.join("/")} ms`);
  }

  test("AC-STE-686.4: a check that outlives the bound is killed at the bound, not when it finishes", () => {
    const run = runHungCheck();
    expect({ boundMs: run.boundMs, finished: run.finished }).toEqual({ boundMs: run.boundMs, finished: false });
  }, 15_000);

  test("AC-STE-686.4: a check that outlives the bound ends in the ownership-unresolved refusal naming the timeout", () => {
    const run = runHungCheck();
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("reason=ownership-unresolved");
    expect(run.stderr).toMatch(TIMEOUT_RE);
  }, 15_000);

  test("AC-STE-686.4: a timed-out check leaves stdout empty", () => {
    const run = runHungCheck();
    expect(run.stdout).toBe("");
  }, 15_000);

  test("AC-STE-686.4: the front door's spawn passes timeout 10000 ms and killSignal SIGKILL", () => {
    const src = stripComments(read(SPAWN_RECEIPT));
    const main = src.slice(src.indexOf("if (import.meta.main)"));
    expect(main.length).toBeGreaterThan(0);
    const at = main.search(/Bun\.spawnSync\s*\(/);
    expect(at).toBeGreaterThanOrEqual(0);
    const call = enclosingCall(main, main.indexOf("(", at) + 1);
    const values = timeoutExpressions(call).flatMap((e) => reachableNumbers(e, src));
    expect(values).toContain(10_000);
    expect(call).toMatch(/killSignal\s*:\s*["']SIGKILL["']/);
  });
});

// ===========================================================================
// AC-STE-686.5 — runTypedoc
// ===========================================================================

describe("AC-STE-686.5 — typedoc is bounded like its dart and griffe siblings", () => {
  test("AC-STE-686.5: a typedoc that outlives its bound fails with a reason naming the timeout", async () => {
    const { extractSignatures } = (await import(SIGNATURE_EXTRACTOR)) as typeof import("../adapters/_shared/src/signature_extractor");
    const root = tempDir("typedoc");
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "export function add(a: number, b: number): number { return a + b; }\n");
    const typedoc = stub(tempDir("typedoc-bin"), "typedoc", "exec /bin/sleep 4");

    const t0 = performance.now();
    const result = extractSignatures(
      root,
      { userFacingMode: true, packagesMode: false, changelogCiOwned: false },
      { typedocBinary: typedoc, dartBinary: null, griffeBinary: null, typedocTimeoutMs: 300 } as Parameters<typeof extractSignatures>[2],
    );
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(2_500);
    expect(result.strategy).toBe("ts-morph");
    const failure = result.warnings.find((w) => w.startsWith("typedoc invocation failed ("));
    expect(failure).toBeDefined();
    expect(failure!).toMatch(/typedoc invocation failed \([^)]*tim(?:ed out|eout)/i);
  }, 15_000);

  test("AC-STE-686.5: runTypedoc's spawn passes timeout 60_000, the value its dart and griffe siblings pass", () => {
    const src = stripComments(read(SIGNATURE_EXTRACTOR));
    const body = functionBody(src, "runTypedoc");
    expect(body).not.toBeNull();
    const values = timeoutExpressions(body!).flatMap((e) => reachableNumbers(e, src));
    expect(values).toContain(60_000);
    // The siblings it must match still pass that value themselves.
    for (const sibling of ["runDartPubGet", "runDartExtractOnce"]) {
      const sib = functionBody(src, sibling);
      expect(sib).not.toBeNull();
      expect(timeoutExpressions(sib!).flatMap((e) => reachableNumbers(e, src))).toContain(60_000);
    }
  });
});

// ===========================================================================
// AC-STE-686.6 — runAssertion
// ===========================================================================

describe("AC-STE-686.6 — an assertion that outlives its bound is not a count", () => {
  // The sleeper is backgrounded with its stdio detached, so killing bash ends
  // the call at once; had the command completed it would print the count 7.
  const HUNG = "sleep 4 </dev/null >/dev/null 2>&1 & wait $!; echo 7";

  async function hungRun() {
    const mod = (await import(FALSIFIABILITY)) as typeof import("../adapters/_shared/src/falsifiability_harness");
    const runAssertion = mod.runAssertion as unknown as (
      bound: { command: string; capturePath: string },
      opts?: { timeoutMs?: number },
    ) => ReturnType<typeof mod.runAssertion>;
    const t0 = performance.now();
    const run = runAssertion({ command: HUNG, capturePath: "/dev/null" }, { timeoutMs: 300 });
    return { mod, run, elapsedMs: performance.now() - t0 };
  }

  test("AC-STE-686.6: the assertion is stopped at its bound", async () => {
    const { elapsedMs } = await hungRun();
    expect(elapsedMs).toBeLessThan(2_500);
  }, 15_000);

  test("AC-STE-686.6: under stdout-count scoring a timed-out run is refused as did-not-complete, never counted", async () => {
    const { mod, run } = await hungRun();
    expect(() => mod.scoreRun(run, "stdout-count")).toThrow(/did not complete/i);
  }, 15_000);

  test("AC-STE-686.6: under exit-code scoring a timed-out run is refused as did-not-complete", async () => {
    const { mod, run } = await hungRun();
    expect(() => mod.scoreRun(run, "exit-code")).toThrow(/did not complete/i);
  }, 15_000);

  test("AC-STE-686.6: a command that completes is still counted (control)", async () => {
    const mod = (await import(FALSIFIABILITY)) as typeof import("../adapters/_shared/src/falsifiability_harness");
    const run = mod.runAssertion({ command: "echo 7", capturePath: "/dev/null" });
    expect(mod.scoreRun(run, "stdout-count")).toBe(7);
  });

  test("AC-STE-686.6: runAssertion's spawn passes a 60000 ms timeout", () => {
    const src = stripComments(read(FALSIFIABILITY));
    const body = functionBody(src, "runAssertion");
    expect(body).not.toBeNull();
    const values = timeoutExpressions(body!).flatMap((e) => reachableNumbers(e, src));
    expect(values).toContain(60_000);
  });
});

// ===========================================================================
// AC-STE-686.8 — gate_capture names its failing tests
// ===========================================================================

describe("AC-STE-686.8 — the gate_capture front door names every failing test", () => {
  function bunProject(): string {
    const root = tempDir("gate");
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "m292387-686", private: true })}\n`);
    mkdirSync(join(root, "tests"));
    writeFileSync(
      join(root, "tests", "a.test.ts"),
      [
        'import { expect, test } from "bun:test";',
        'test("passes in a", () => { expect(1 + 1).toBe(2); });',
        'test("fails in a", () => { expect(1 + 1).toBe(3); });',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(root, "tests", "b.test.ts"),
      ['import { expect, test } from "bun:test";', 'test("passes in b", () => { expect(2).toBe(2); });', ""].join("\n"),
    );
    return root;
  }

  function runFrontDoor(root: string): { lines: string[]; all: string } {
    const proc = Bun.spawnSync([process.execPath, GATE_CAPTURE, root], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const stdout = proc.stdout.toString();
    return {
      lines: stdout.split("\n").filter((l) => l.length > 0),
      all: `exit ${proc.exitCode}\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`,
    };
  }

  test("AC-STE-686.8: a red run prints `file > test name` for its failing test, read from its own report", () => {
    const run = runFrontDoor(bunProject());
    // Control: the totals line shows this run really had one failure.
    expect(run.lines.some((l) => /^gate_capture: pass 2, fail 1, skip 0$/.test(l))).toBe(true);
    const failing = run.lines.filter((l) => /tests\/a\.test\.ts > fails in a\s*$/.test(l));
    if (failing.length !== 1) throw new Error(`expected one failing identity line\n${run.all}`);
  }, 90_000);

  test("AC-STE-686.8: passing tests are not named as failing", () => {
    const run = runFrontDoor(bunProject());
    const named = run.lines.filter((l) => / > passes in [ab]\s*$/.test(l));
    if (named.length !== 0) throw new Error(`passing tests were named\n${run.all}`);
    // Control: the failing one IS named, so an empty list above is a real answer.
    expect(run.lines.some((l) => / > fails in a\s*$/.test(l))).toBe(true);
  }, 90_000);
});
