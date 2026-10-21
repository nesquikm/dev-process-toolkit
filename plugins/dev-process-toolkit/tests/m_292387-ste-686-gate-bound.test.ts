// STE-686 — AC-STE-686.9: the gate run bound is 40 minutes, and a run that
// outlives it ENDS even when it ignores SIGTERM.
//
//   AC-STE-686.9  The gate run bound in `gate_identity_run.ts` defaults to 40
//                 minutes. A run that outlives it is sent SIGTERM, then SIGKILL
//                 after a short grace period, so a child that ignores SIGTERM
//                 still ends. The `gate_capture.ts` front door then reports the
//                 run as killed on the bound, naming the bound, not only as an
//                 unreadable report.
//
// MEASURED (operator ruling 2026-10-21): gate run 3 spun for an hour past the
// 20-minute bound, because the one signal `spawnSync`'s `timeout` sends is a
// SIGTERM and the run never handled it.
//
// SEAMS, so nothing here waits anywhere near a product bound:
//   * the bound — `runGateNamingSkips`'s `timeoutMs` argument, and
//     `DPT_GATE_TIMEOUT_MS` for the front door (both exist already);
//   * the grace period between SIGTERM and SIGKILL — `DPT_GATE_KILL_GRACE_MS`
//     (a positive number of milliseconds), with its shipped default exported
//     as `GATE_KILL_GRACE_MS`.
//
// THE VERDICT IS A MARKER, NOT WALL TIME. The hung child ARMS itself
// (`trap '' TERM`, then writes `armed`), sleeps with its stdio detached, then
// writes `done`. Only a SIGKILL stops an armed child before `done`. A run whose
// child never armed (the bound fired before bash ran `trap` on a loaded
// machine) proves nothing about the signal and is retried with a wider bound.
//
// `STE686_SRC_ROOT` overrides the module root for the mutation battery
// (AC-STE-686.10), which re-runs this file against patched copies.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SRC_ROOT = process.env.STE686_SRC_ROOT ?? resolve(import.meta.dir, "../adapters/_shared/src");
const GATE_IDENTITY_RUN = join(SRC_ROOT, "gate_identity_run.ts");
const GATE_CAPTURE = join(SRC_ROOT, "gate_capture.ts");

const mod = (await import(GATE_IDENTITY_RUN)) as typeof import("../adapters/_shared/src/gate_identity_run") & {
  readonly GATE_KILL_GRACE_MS?: unknown;
};

const TEMP_DIRS: string[] = [];
function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `m292387-686-fy-${label}-`));
  TEMP_DIRS.push(d);
  return d;
}
afterAll(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Long enough that a missing escalation is unmistakable, short enough to stay under 30 s. */
const CHILD_SLEEP_S = 12;
const BOUNDS_MS = [300, 1_500, 4_000];
const GRACE_MS = 200;

/** A bash script that ignores SIGTERM, marks itself armed, sleeps detached, then marks done. */
function termIgnoringScript(dir: string): { body: string; armed: string; done: string } {
  const armed = join(dir, "armed");
  const done = join(dir, "done");
  const body = `trap '' TERM\n: > '${armed}'\n/bin/sleep ${CHILD_SLEEP_S} </dev/null >/dev/null 2>&1\n: > '${done}'`;
  return { body, armed, done };
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ===========================================================================
// The default bound
// ===========================================================================

describe("AC-STE-686.9 — the gate run bound defaults to 40 minutes", () => {
  test("AC-STE-686.9: GATE_RUN_TIMEOUT_MS is 40 minutes", () => {
    expect(mod.GATE_RUN_TIMEOUT_MS).toBe(40 * 60_000);
  });

  test("AC-STE-686.9: with no override the bound in force is 40 minutes", () => {
    const bound = withEnv({ DPT_GATE_TIMEOUT_MS: undefined }, () => mod.gateRunTimeoutMs());
    expect(bound).toBe(40 * 60_000);
  });

  test("AC-STE-686.9: the SIGTERM-to-SIGKILL grace period is short and finite", () => {
    expect(typeof mod.GATE_KILL_GRACE_MS).toBe("number");
    const grace = mod.GATE_KILL_GRACE_MS as number;
    expect(grace).toBeGreaterThan(0);
    expect(grace).toBeLessThanOrEqual(10_000);
  });
});

// ===========================================================================
// The escalation — runGateNamingSkips
// ===========================================================================

describe("AC-STE-686.9 — a run that ignores SIGTERM is SIGKILLed after the grace period", () => {
  interface Run {
    output: string;
    armed: boolean;
    finished: boolean;
    boundMs: number;
    elapsedMs: number;
  }

  function runOnce(boundMs: number): Run {
    const dir = tempDir("run");
    const s = termIgnoringScript(dir);
    const t0 = performance.now();
    const obs = withEnv({ DPT_GATE_KILL_GRACE_MS: String(GRACE_MS) }, () =>
      mod.runGateNamingSkips(dir, "unknown", ["/bin/bash", "-c", s.body], boundMs),
    );
    return {
      output: obs.output,
      armed: existsSync(s.armed),
      finished: existsSync(s.done),
      boundMs,
      elapsedMs: performance.now() - t0,
    };
  }

  function runHung(): Run {
    for (const boundMs of BOUNDS_MS) {
      const run = runOnce(boundMs);
      if (run.armed) return run;
    }
    throw new Error(`the gate stub never armed its TERM trap within ${BOUNDS_MS.join("/")} ms`);
  }

  test("AC-STE-686.9: a run that ignores SIGTERM is SIGKILLed after the grace period", () => {
    const run = runHung();
    // `finished` means the child survived the SIGTERM and ran to its own end:
    // only a SIGKILL stops an armed child before it writes `done`.
    expect({ boundMs: run.boundMs, finished: run.finished }).toEqual({ boundMs: run.boundMs, finished: false });
  }, 28_000);

  test("AC-STE-686.9: the killed run still says it did not finish", () => {
    const run = runHung();
    expect(run.output).toContain(mod.TIMED_OUT_MARKER);
  }, 28_000);

  test("AC-STE-686.9: CONTROL — a run that ends in time is never signalled", () => {
    const dir = tempDir("ctl");
    const obs = withEnv({ DPT_GATE_KILL_GRACE_MS: String(GRACE_MS) }, () =>
      mod.runGateNamingSkips(dir, "unknown", ["/bin/sh", "-c", "echo 3 pass; echo 0 fail"], 20_000),
    );
    expect(obs.output).toContain("3 pass");
    expect(obs.output).not.toContain(mod.TIMED_OUT_MARKER);
  }, 28_000);
});

// ===========================================================================
// The front door — gate_capture.ts
// ===========================================================================

describe("AC-STE-686.9 — the gate_capture front door reports a run killed on the bound", () => {
  // A flutter project: `detectGate` resolves `pubspec.yaml` to `flutter test`,
  // a stack with no identity report, so the front door runs the stub's argv
  // directly. The stub `flutter` on PATH is the TERM-ignoring child.
  interface FrontDoorRun {
    lines: string[];
    all: string;
    armed: boolean;
    finished: boolean;
    boundMs: number;
  }

  function runOnce(boundMs: number): FrontDoorRun {
    const root = tempDir("fd");
    writeFileSync(join(root, "pubspec.yaml"), "name: m292387_686\n");
    const bin = tempDir("fd-bin");
    const s = termIgnoringScript(root);
    writeFileSync(join(bin, "flutter"), `#!/bin/bash\n${s.body}\n`, { mode: 0o755 });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.PATH = `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`;
    env.NO_COLOR = "1";
    env.DPT_GATE_TIMEOUT_MS = String(boundMs);
    env.DPT_GATE_KILL_GRACE_MS = String(GRACE_MS);
    const proc = Bun.spawnSync([process.execPath, GATE_CAPTURE, root], {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25_000,
      killSignal: "SIGKILL",
    });
    const stdout = proc.stdout.toString();
    return {
      lines: stdout.split("\n").filter((l) => l.length > 0),
      all: `exit ${proc.exitCode}\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`,
      armed: existsSync(s.armed),
      finished: existsSync(s.done),
      boundMs,
    };
  }

  function runHung(): FrontDoorRun {
    for (const boundMs of BOUNDS_MS) {
      const run = runOnce(boundMs);
      if (run.armed) return run;
    }
    throw new Error(`the flutter stub never armed its TERM trap within ${BOUNDS_MS.join("/")} ms`);
  }

  test("AC-STE-686.9: the front door's TERM-ignoring gate is killed, not waited for", () => {
    const run = runHung();
    if (run.finished) throw new Error(`the gate ran to its own end instead of being killed\n${run.all}`);
    expect(run.finished).toBe(false);
  }, 28_000);

  test("AC-STE-686.9: the front door prints a line saying the run was killed on the bound, naming the bound", () => {
    const run = runHung();
    const bound = new RegExp(`\\b${run.boundMs}\\s*ms\\b`);
    const killed = run.lines.filter((l) => l.startsWith("gate_capture:") && /\bkilled\b/i.test(l) && bound.test(l));
    if (killed.length !== 1) throw new Error(`expected one killed-on-the-bound line naming ${run.boundMs} ms\n${run.all}`);
    // Not only an unreadable report: the killed line is its own statement.
    expect(killed[0]).not.toContain("totals unreadable");
  }, 28_000);
});
