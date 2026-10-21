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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SRC_ROOT = process.env.STE686_SRC_ROOT ?? resolve(import.meta.dir, "../adapters/_shared/src");
const GATE_IDENTITY_RUN = join(SRC_ROOT, "gate_identity_run.ts");
const GATE_CAPTURE = join(SRC_ROOT, "gate_capture.ts");

const { skipIdentityCommand } = (await import(join(SRC_ROOT, "skip_identities.ts"))) as typeof import("../adapters/_shared/src/skip_identities");
const mod = (await import(GATE_IDENTITY_RUN)) as typeof import("../adapters/_shared/src/gate_identity_run") & {
  readonly GATE_KILL_GRACE_MS?: unknown;
};

const TEMP_DIRS: string[] = [];
function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `m292387-686-gb-${label}-`));
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

const readPid = (p: string): number | null => {
  if (!existsSync(p)) return null;
  const n = Number(readFileSync(p, "utf-8").trim());
  return Number.isInteger(n) && n > 1 ? n : null;
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Pids still alive after a short reaping window; survivors are killed by recorded pid. */
function survivors(pids: readonly number[]): number[] {
  const deadline = performance.now() + 3_000;
  let left = pids.filter(alive);
  while (left.length > 0 && performance.now() < deadline) {
    Bun.sleepSync(50);
    left = left.filter(alive);
  }
  for (const pid of left) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return left;
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
// The `/bin/sh -c` arm — the bun stack, whose run is an identity invocation
// ===========================================================================

describe("AC-STE-686.9 — a killed bun-stack run ends its whole process group", () => {
  // `runGateNamingSkips` on the bun stack runs `["/bin/sh", "-c", <identity
  // command>]`, not the caller's argv: `skipIdentityCommand("bun", …)` composes
  // `bun test … --reporter=junit …`. A stub `bun` first on PATH is the gate. It
  // ignores TERM, starts a TERM-ignoring GRANDCHILD, and both record their pids.
  // The stub detaches its own stdio first, so a survivor cannot hold the
  // captured pipe open and turn a missing group kill into a slow-but-green run.
  // THE VERDICT IS THE PIDS: after the run returns, neither may still exist.
  interface ShRun {
    output: string;
    killedOnBoundMs: number | null;
    armed: boolean;
    pids: number[];
    boundMs: number;
    all: string;
  }

  function stubBun(bin: string, dir: string): { armed: string; childPid: string; grandPid: string } {
    const armed = join(dir, "armed");
    const childPid = join(dir, "child.pid");
    const grandPid = join(dir, "grandchild.pid");
    const body = [
      "#!/bin/bash",
      "exec </dev/null >/dev/null 2>&1",
      "trap '' TERM",
      `echo $$ > '${childPid}'`,
      `/bin/bash -c "trap '' TERM; echo \\$\\$ > '${grandPid}'; exec /bin/sleep ${CHILD_SLEEP_S}" &`,
      "for _ in $(/usr/bin/seq 1 150); do",
      `  [ -s '${grandPid}' ] && break`,
      "  /bin/sleep 0.02",
      "done",
      `[ -s '${grandPid}' ] && : > '${armed}'`,
      `/bin/sleep ${CHILD_SLEEP_S}`,
      "",
    ].join("\n");
    writeFileSync(join(bin, "bun"), body, { mode: 0o755 });
    return { armed, childPid, grandPid };
  }

  // `Bun.spawnSync` with no `env` hands the child the env this process STARTED
  // with, so a PATH set via `process.env` never reaches `/bin/sh`. The run is
  // therefore driven from a small child process whose PATH carries the stub.
  function runOnce(boundMs: number): ShRun {
    const dir = tempDir("sh");
    const bin = tempDir("sh-bin");
    const s = stubBun(bin, dir);
    const driver =
      `const m = await import(${JSON.stringify(GATE_IDENTITY_RUN)});` +
      `const o = m.runGateNamingSkips(${JSON.stringify(dir)}, "bun", ["bun", "test"], ${boundMs});` +
      `process.stdout.write(JSON.stringify({ output: o.output, killedOnBoundMs: o.killedOnBoundMs ?? null }));`;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.PATH = `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`;
    env.DPT_GATE_KILL_GRACE_MS = String(GRACE_MS);
    const proc = Bun.spawnSync([process.execPath, "-e", driver], {
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const stdout = proc.stdout.toString();
    let parsed: { output: string; killedOnBoundMs: number | null } = { output: "", killedOnBoundMs: null };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // left empty; `all` carries the evidence
    }
    const pids = [readPid(s.childPid), readPid(s.grandPid)].filter((p): p is number => p !== null);
    return {
      ...parsed,
      armed: existsSync(s.armed),
      pids,
      boundMs,
      all: `exit ${proc.exitCode}\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`,
    };
  }

  test("AC-STE-686.9: the bun stack runs through /bin/sh -c (the arm under test)", () => {
    expect(skipIdentityCommand("bun", "/tmp/r.xml")).toMatch(/^bun test\b/);
  });

  test("AC-STE-686.9: a TERM-ignoring bun-stack run is killed with its grandchild, naming the bound", () => {
    let run: ShRun | null = null;
    for (const boundMs of BOUNDS_MS) {
      const attempt = runOnce(boundMs);
      if (attempt.armed && attempt.pids.length === 2) {
        run = attempt;
        break;
      }
      survivors(attempt.pids);
    }
    if (run === null) throw new Error(`the bun stub never armed within ${BOUNDS_MS.join("/")} ms`);
    const left = survivors(run.pids);
    if (left.length > 0) throw new Error(`pids ${left.join(", ")} outlived the killed run\n${run.all}`);
    expect({
      killedOnBoundMs: run.killedOnBoundMs,
      timedOut: run.output.includes(mod.TIMED_OUT_MARKER),
      survivors: left,
    }).toEqual({ killedOnBoundMs: run.boundMs, timedOut: true, survivors: [] });
  }, 28_000);
});

// ===========================================================================
// The supervisor BACKSTOP — a wedged supervisor (AC-STE-686.10 closing .9)
// ===========================================================================

describe("AC-STE-686.9 — a wedged supervisor is cut by the caller's backstop, and its gate group with it", () => {
  // `runGateNamingSkips` spawns the supervisor with a backstop `timeout:` (bound
  // + grace + SUPERVISOR_BACKSTOP_MS) and `killSignal: "SIGKILL"`. Nothing else
  // stops a supervisor that never returns. TWO TEST-ONLY SEAMS, both inert when
  // unset:
  //   * `DPT_GATE_SUPERVISOR_BACKSTOP_MS` — a positive number of milliseconds
  //     that replaces the 60 s backstop margin;
  //   * `DPT_GATE_SUPERVISOR_WEDGE_FILE` — a path. When set, the supervisor
  //     writes that file, starts the gate exactly as in production (its own
  //     process group), and then neither arms the bound nor ever exits.
  // The wedge file is the precondition: no file, no wedge, and the run proves
  // nothing about the backstop.
  //
  // PINNED: the backstop SIGKILLs only the supervisor, and the gate lives in its
  // own process group, so a backstop that stops there leaves the gate and its
  // grandchild running as orphans. "A child that ignores SIGTERM still ends"
  // (AC .9) holds on this path too: after the call returns, the gate and its
  // grandchild are gone. The verdict is their recorded pids.
  //
  // Driven from a child process because `Bun.spawnSync` with no `env` hands the
  // supervisor the env this process STARTED with. The driver is itself bounded
  // (20 s, SIGKILL), so a missing backstop fails this test by its own check
  // instead of hanging it; strays are then killed by recorded pid.
  const BOUND_MS = 300;
  const BACKSTOPS_MS = [500, 2_000, 4_000];
  const RETURN_WITHIN_MS = 10_000;

  interface WedgeRun {
    wedged: boolean;
    armed: boolean;
    elapsedMs: number | null;
    timedOut: boolean;
    killedOnBoundMs: number | null;
    pids: { supervisor: number | null; gate: number | null; grandchild: number | null };
    all: string;
  }

  function runOnce(backstopMs: number): WedgeRun {
    const dir = tempDir("wedge");
    const wedgeFile = join(dir, "supervisor-wedged");
    const armed = join(dir, "armed");
    const supPid = join(dir, "supervisor.pid");
    const gatePid = join(dir, "gate.pid");
    const grandPid = join(dir, "grandchild.pid");
    const script = join(dir, "gate.sh");
    writeFileSync(
      script,
      [
        "#!/bin/bash",
        "exec </dev/null >/dev/null 2>&1",
        "trap '' TERM",
        `echo $$ > '${gatePid}'`,
        `echo $PPID > '${supPid}'`,
        `/bin/bash -c "trap '' TERM; echo \\$\\$ > '${grandPid}'; exec /bin/sleep ${CHILD_SLEEP_S}" &`,
        "for _ in $(/usr/bin/seq 1 150); do",
        `  [ -s '${grandPid}' ] && break`,
        "  /bin/sleep 0.02",
        "done",
        `[ -s '${grandPid}' ] && : > '${armed}'`,
        `/bin/sleep ${CHILD_SLEEP_S}`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const driver =
      `const m = await import(${JSON.stringify(GATE_IDENTITY_RUN)});` +
      `const t0 = performance.now();` +
      `const o = m.runGateNamingSkips(${JSON.stringify(dir)}, "unknown", ["/bin/bash", ${JSON.stringify(script)}], ${BOUND_MS});` +
      `process.stdout.write(JSON.stringify({ output: o.output, killedOnBoundMs: o.killedOnBoundMs ?? null, elapsedMs: performance.now() - t0 }));`;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.DPT_GATE_KILL_GRACE_MS = String(GRACE_MS);
    env.DPT_GATE_SUPERVISOR_BACKSTOP_MS = String(backstopMs);
    env.DPT_GATE_SUPERVISOR_WEDGE_FILE = wedgeFile;
    const proc = Bun.spawnSync([process.execPath, "-e", driver], {
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      killSignal: "SIGKILL",
    });
    const stdout = proc.stdout.toString();
    let parsed: { output: string; killedOnBoundMs: number | null; elapsedMs: number | null } = {
      output: "",
      killedOnBoundMs: null,
      elapsedMs: null,
    };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // the driver was cut or crashed; `all` carries the evidence
    }
    return {
      wedged: existsSync(wedgeFile),
      armed: existsSync(armed),
      elapsedMs: parsed.elapsedMs,
      timedOut: parsed.output.includes(mod.TIMED_OUT_MARKER),
      killedOnBoundMs: parsed.killedOnBoundMs,
      pids: { supervisor: readPid(supPid), gate: readPid(gatePid), grandchild: readPid(grandPid) },
      all: `exit ${proc.exitCode} signal ${proc.signalCode}\nstdout:\n${stdout}\nstderr:\n${proc.stderr.toString()}`,
    };
  }

  const recorded = (run: WedgeRun): number[] =>
    [run.pids.supervisor, run.pids.gate, run.pids.grandchild].filter((p): p is number => p !== null);

  test("AC-STE-686.9: a wedged supervisor is cut by the backstop; the run is reported cut and its gate group is gone", () => {
    let run: WedgeRun | null = null;
    for (const backstopMs of BACKSTOPS_MS) {
      const attempt = runOnce(backstopMs);
      if (!attempt.wedged || (attempt.armed && attempt.pids.gate !== null)) {
        run = attempt;
        break;
      }
      // The gate never armed before the backstop fired: proves nothing; widen.
      survivors(recorded(attempt));
    }
    if (run === null) throw new Error(`the gate never armed under a wedged supervisor within ${BACKSTOPS_MS.join("/")} ms`);
    // The supervisor itself is reaped by the backstop; the gate and grandchild
    // must have been reaped by the caller too. Anything left is killed by pid.
    const gateGroup = [run.pids.gate, run.pids.grandchild].filter((p): p is number => p !== null);
    const leftGate = survivors(gateGroup);
    survivors(run.pids.supervisor === null ? [] : [run.pids.supervisor]);
    const returnedInTime = run.elapsedMs !== null && run.elapsedMs < RETURN_WITHIN_MS;
    const actual = {
      wedged: run.wedged,
      returnedInTime,
      timedOut: run.timedOut,
      killedOnBoundMs: run.killedOnBoundMs,
      gateSurvivors: leftGate,
    };
    const expected = { wedged: true, returnedInTime: true, timedOut: true, killedOnBoundMs: BOUND_MS, gateSurvivors: [] };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`wedged-supervisor run: ${JSON.stringify(actual)} (elapsed ${run.elapsedMs} ms)\n${run.all}`);
    }
    expect(actual).toEqual(expected);
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
