// M_4df444 / STE-595 — the spawn fences RUN: one child per selected leg, counted
// (AC.7, and the behavioural half of AC.6).
//
// SAFETY, stated first because this suite executes documented spawn fences.
//   * `claude` and `bun` are stubbed on PATH, and every run first asserts that
//     `command -v claude` and `command -v bun` resolve to the stubs, refusing to
//     run otherwise. The claude stub records its own pid and argv, then
//     `exec -a claude /bin/sleep 7.595`: `ps -p <pid> -o comm=` reports `claude`
//     for it, as it would for the real CLI, and it exits by itself even if
//     cleanup never runs. A real `claude` is never started.
//   * Every `/tmp/` path in an extracted fence is rebased into a per-test temp
//     root before the run. A real run's pidfiles, logs, rc-files and verdict
//     artifacts are never read, written or globbed, including by an abort
//     branch's `rm -f …/*.pid` reap. Phase A also gets a unique ITER per run.
//   * The working directory is `<temp root>/work`, so a teardown's
//     `rm -rf ../dpt-test-project-<leg>` can only reach the temp root.
//   * Every fence runs from a FILE (`bash <file>`). Nothing is ever fed to a
//     shell through stdin: the stdin form of the fence is only handed to the
//     hook as TEXT, and is never executed whatever the hook answers.
//   * Cleanup signals only processes this run started (a stub whose argv is
//     exactly `claude 7.595`, or a brace group whose argv names the temp root),
//     waits for them, then removes the temp root.
//
// `set -u` is prepended to every fence. That is how the driver ran it on
// 2026-09-11 (the golden fixture's second line), and STE-448 records a `set -u`
// abort in this very fence. A count that dies on an unbound variable is a
// count an earlier abort skipped.
//
// COUNT-LINE CONTRACT (tests/_spawn_fences.ts): `launched=<n> live=<n>` on one
// line, where `live` counts the RECORDED pids (the pidfiles each fence already
// writes) that answer `kill -0` and pass `ps -p <pid> -o comm=`. The mismatch
// tests make a leg's pid unrecordable by planting a directory at its pidfile
// path, so `echo $! > <pidfile>` fails, and expect `live` to drop while
// `launched` does not.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseSpawnFenceGroups } from "../adapters/_shared/src/leg_prose_surfaces";
import {
  countLines,
  countSites,
  label,
  parseFences,
  phaseAFence,
  readDoc,
  spawnLineIndices,
  type Fence,
} from "./_spawn_fences";
import { runHookOn } from "./_stdin_spawn_hook";

// ===========================================================================
// Sandbox.
// ===========================================================================

const STUB_SLEEP = "7.595";
let seq = 0;
const unique = (prefix: string): string => `${prefix}${process.pid}x${Date.now().toString(36)}x${++seq}`;

interface Sandbox {
  root: string;
  bin: string;
  tmp: string;
  work: string;
  record: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "ste595-run-"));
  const bin = join(root, "bin");
  const tmp = join(root, "tmp");
  const work = join(root, "work");
  for (const d of [bin, tmp, work]) mkdirSync(d, { recursive: true });
  const record = join(root, "claude-stub.record");
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/bash\nprintf '%s\\t%s\\n' "$$" "$*" >> '${record}'\nexec -a claude /bin/sleep ${STUB_SLEEP}\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/bash\nprintf '%s\\n' "$*" >> '${join(root, "bun-stub.record")}'\necho 0\n`,
    { mode: 0o755 },
  );
  return { root, bin, tmp, work, record };
}

interface StubCall {
  pid: number;
  args: string;
}

function stubCalls(sb: Sandbox): StubCall[] {
  if (!existsSync(sb.record)) return [];
  return readFileSync(sb.record, "utf-8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const [pid, ...rest] = l.split("\t");
      return { pid: Number(pid), args: rest.join("\t") };
    });
}

/** Stubs record themselves a few ms after the fork: wait for `n`, then let stragglers land. */
function waitForCalls(sb: Sandbox, n: number, ms = 4_000): StubCall[] {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && stubCalls(sb).length < n) Bun.sleepSync(50);
  Bun.sleepSync(200);
  return stubCalls(sb);
}

const processArgs = (pid: number): string =>
  Bun.spawnSync(["ps", "-p", String(pid), "-o", "args="]).stdout.toString().trim();

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function reap(sb: Sandbox): void {
  const candidates = new Set<number>(stubCalls(sb).map((c) => c.pid));
  if (existsSync(sb.tmp)) {
    for (const name of readdirSync(sb.tmp)) {
      if (!name.endsWith(".pid")) continue;
      try {
        const p = Number.parseInt(readFileSync(join(sb.tmp, name), "utf-8").trim(), 10);
        if (p > 0) candidates.add(p);
      } catch {
        // a directory planted by a mismatch test
      }
    }
  }
  const ours = [...candidates].filter((p) => {
    const args = processArgs(p);
    return args === `claude ${STUB_SLEEP}` || args.includes(sb.root);
  });
  for (const p of ours) {
    try {
      process.kill(p, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && ours.some(alive)) Bun.sleepSync(50);
  rmSync(sb.root, { recursive: true, force: true });
}

interface FenceRun {
  exitCode: number;
  out: string;
  err: string;
}

function writeFence(sb: Sandbox, script: string): string {
  const file = join(sb.root, `fence-${++seq}.sh`);
  writeFileSync(file, script);
  return file;
}

/** Run a fence FILE with the stubs first on PATH. Refuses to run if a stub is not what resolves. */
function runFenceAt(file: string, sb: Sandbox, env: Record<string, string>): FenceRun {
  const fullEnv = { ...process.env, PATH: `${sb.bin}:${process.env.PATH ?? ""}`, ...env };
  const which = Bun.spawnSync(["bash", "-c", "command -v claude; command -v bun"], { env: fullEnv, cwd: sb.work });
  expect(
    which.stdout.toString().trim().split("\n"),
    "SAFETY: the stubs must shadow the real claude and bun, or nothing runs",
  ).toEqual([join(sb.bin, "claude"), join(sb.bin, "bun")]);
  const out = `${file}.out`;
  const err = `${file}.err`;
  // The fence runs from its file; the outer shell only redirects, so the
  // detached groups inherit files rather than this process's pipes.
  const r = Bun.spawnSync(["bash", "-c", 'bash "$1" >"$2" 2>"$3"', "ste595-runner", file, out, err], {
    env: fullEnv,
    cwd: sb.work,
    timeout: 60_000,
  });
  return {
    exitCode: r.exitCode ?? -1,
    out: existsSync(out) ? readFileSync(out, "utf-8") : "",
    err: existsSync(err) ? readFileSync(err, "utf-8") : "",
  };
}

const today = (): string => Bun.spawnSync(["date", "+%Y-%m-%d"]).stdout.toString().trim();

// ===========================================================================
// The Phase A fence, extracted by shape.
// ===========================================================================

const LOOP_DOC_TEXT = readDoc("conformance-loop");
const PHASE_A = phaseAFence(parseFences("conformance-loop", LOOP_DOC_TEXT));
/** The registered legs, read off the fence's own brace groups by the shipped parser. */
const REGISTERED_LEGS = parseSpawnFenceGroups(LOOP_DOC_TEXT)
  .map((g) => g.tracker)
  .filter((t) => t !== "");

function requirePhaseA(): Fence {
  if (PHASE_A === undefined) {
    throw new Error("the /conformance-loop Phase A spawn fence was not found by shape");
  }
  return PHASE_A;
}

function phaseAScript(iter: string, sb: Sandbox): string {
  const body = requirePhaseA().body;
  expect((body.match(/^ITER=<N>$/gm) ?? []).length, "the fence carries exactly one ITER=<N> placeholder").toBe(1);
  return `set -u\n${body.replace(/^ITER=<N>$/m, `ITER=${iter}`).replaceAll("/tmp/", `${sb.tmp}/`)}\n`;
}

const PHASE_A_ENV = { LINEAR_TEAM: "STE595", JIRA_PROJECT: "DST595" };

function selections(legs: readonly string[]): string[][] {
  const out: string[][] = [[...legs]];
  if (legs.length > 1) out.push([legs[0]!]);
  if (legs.length > 2) out.push([legs[0]!, legs[legs.length - 1]!]);
  return out;
}

function pidfileLegs(sb: Sandbox, iter: string): string[] {
  if (!existsSync(sb.tmp)) return [];
  return readdirSync(sb.tmp)
    .filter((n) => n.includes(`-iter-${iter}-`) && n.endsWith(".pid"))
    .map((n) => /-([A-Za-z0-9_]+)\.pid$/.exec(n)?.[1] ?? "")
    .sort();
}

function lastCount(run: FenceRun) {
  const counts = countLines(`${run.out}\n${run.err}`);
  expect(
    counts.length,
    `no \`launched=<n> live=<n>\` line in the fence output.\n--- stdout ---\n${run.out}\n--- stderr ---\n${run.err}`,
  ).toBeGreaterThan(0);
  return counts[counts.length - 1]!;
}

// ===========================================================================
// AC-STE-595.7
// ===========================================================================

describe("AC-STE-595.7 — the actual Phase A fence, run from a file with claude stubbed", () => {
  test("CONTROL: the fence is found by shape and its registered legs are read off its own groups", () => {
    const f = requirePhaseA();
    expect(REGISTERED_LEGS.length, "the fence's brace groups name their --tracker legs").toBeGreaterThan(0);
    expect(spawnLineIndices(f).length, "one claude -p spawn line per registered leg").toBe(REGISTERED_LEGS.length);
    expect((f.body.match(/^ITER=<N>$/gm) ?? []).length).toBe(1);
  });

  for (const sel of selections(REGISTERED_LEGS)) {
    test(`SELECTED_LEGS="${sel.join(" ")}": one stub child per selected leg, and the count line reports ${sel.length}`, () => {
      const sb = makeSandbox();
      try {
        const iter = unique("ste595i");
        const run = runFenceAt(writeFence(sb, phaseAScript(iter, sb)), sb, {
          ...PHASE_A_ENV,
          SELECTED_LEGS: sel.join(" "),
        });

        const calls = waitForCalls(sb, sel.length);
        expect(calls.length, `stub claude calls: ${JSON.stringify(calls)}`).toBe(sel.length);
        for (const c of calls) expect(c.args).toMatch(/^-p \/smoke-test --tracker \S+/);
        expect(calls.map((c) => /--tracker\s+(\S+)/.exec(c.args)?.[1] ?? "").sort()).toEqual([...sel].sort());
        expect(pidfileLegs(sb, iter), "a pidfile for each selected leg and for no other").toEqual([...sel].sort());

        const count = lastCount(run);
        expect(count.launched, count.line).toBe(sel.length);
        expect(count.live, count.line).toBe(sel.length);
        expect(run.exitCode, `stderr:\n${run.err}`).toBe(0);
      } finally {
        reap(sb);
      }
    }, 60_000);
  }

  test("the same fence fed to bash through stdin is refused by the hook before any stub runs, and its pidfiles are absent (CONTROL: the file form passes the gate and runs)", async () => {
    const sb = makeSandbox();
    try {
      // The stdin form. Handed to the hook as TEXT; never executed, whatever it answers.
      const iterStdin = unique("ste595s");
      const stdinCommand = `bash <<'OUTER'\n${phaseAScript(iterStdin, sb)}OUTER`;
      const refused = await runHookOn(stdinCommand);
      expect(refused.exitCode, `hook stderr:\n${refused.stderr}`).toBe(2);
      expect(refused.stderr).toMatch(/^Refusing: /m);
      expect(stubCalls(sb), "no stub ran").toEqual([]);
      expect(pidfileLegs(sb, iterStdin), "no pidfile in the rebased /tmp").toEqual([]);
      expect(readdirSync("/tmp").filter((n) => n.includes(iterStdin)), "no pidfile in the real /tmp").toEqual([]);

      // CONTROL: the file form of the same fence passes the same gate, and only then runs.
      const iterFile = unique("ste595f");
      const file = writeFence(sb, phaseAScript(iterFile, sb));
      const allowed = await runHookOn(`bash ${file}`);
      expect(allowed.exitCode, `hook stderr:\n${allowed.stderr}`).toBe(0);
      runFenceAt(file, sb, { ...PHASE_A_ENV, SELECTED_LEGS: REGISTERED_LEGS.join(" ") });
      waitForCalls(sb, REGISTERED_LEGS.length);
      expect(pidfileLegs(sb, iterFile)).toEqual([...REGISTERED_LEGS].sort());
    } finally {
      reap(sb);
    }
  }, 60_000);
});

// ===========================================================================
// AC-STE-595.6 — behaviour: a count mismatch aborts.
// ===========================================================================

describe("AC-STE-595.6 — Phase A: a count mismatch aborts through the per-leg abort teardown (BEHAVIOUR)", () => {
  test("a leg whose pid cannot be recorded ⇒ live < launched ⇒ non-zero exit, an ABORT, the per-leg abort teardown", () => {
    const sb = makeSandbox();
    try {
      const iter = unique("ste595m");
      const victim = REGISTERED_LEGS[0]!;
      mkdirSync(join(sb.tmp, `dpt-conformance-loop-${today()}-iter-${iter}-${victim}.pid`));
      for (const leg of REGISTERED_LEGS) mkdirSync(join(sb.root, `dpt-test-project-${leg}`));

      const run = runFenceAt(writeFence(sb, phaseAScript(iter, sb)), sb, {
        ...PHASE_A_ENV,
        SELECTED_LEGS: REGISTERED_LEGS.join(" "),
      });
      waitForCalls(sb, REGISTERED_LEGS.length);
      const both = `${run.out}\n${run.err}`;

      const count = lastCount(run);
      expect(count.launched, count.line).toBe(REGISTERED_LEGS.length);
      expect(count.live, count.line).toBe(REGISTERED_LEGS.length - 1);
      expect(run.exitCode, both).not.toBe(0);
      expect(both).toMatch(/ABORT/);
      expect(both).toMatch(/per-leg abort teardown|teardown_spawned_legs=/i);
    } finally {
      reap(sb);
    }
  }, 60_000);
});

/** /smoke-test background spawn fences that run as written once placeholders are filled (the retry example is elided pseudo-code). */
const SMOKE_RUNNABLE = countSites().filter((f) => f.doc === "smoke-test" && !/claude\s+-p\s+\.\.\./.test(f.body));

function smokeScript(f: Fence, tracker: string, sb: Sandbox): string {
  const body = f.body
    .replaceAll("<tracker>", tracker)
    .replaceAll("<feature-id>", "FR-STE595")
    .replaceAll("/tmp/", `${sb.tmp}/`);
  return `set -u\n${body}\n`;
}

function firstPidfile(script: string): string {
  const m = /echo \$! > "?([^\s"]+\.pid)"?/.exec(script);
  if (!m) throw new Error("no `echo $! > <pidfile>` capture in the fence");
  return m[1]!;
}

describe("AC-STE-595.6 — each runnable /smoke-test spawn fence counts its children (BEHAVIOUR)", () => {
  test("CONTROL: at least one runnable /smoke-test spawn fence is derived, each capturing its pids", () => {
    expect(SMOKE_RUNNABLE.length).toBeGreaterThan(0);
    for (const f of SMOKE_RUNNABLE) expect(f.body, label(f)).toMatch(/echo \$! > /);
  });

  for (const f of SMOKE_RUNNABLE) {
    const k = spawnLineIndices(f).length;

    test(`${label(f)}: ${k} stub children, count line launched=${k} live=${k}, exit 0`, () => {
      const sb = makeSandbox();
      try {
        const run = runFenceAt(writeFence(sb, smokeScript(f, unique("ste595t"), sb)), sb, {});
        expect(waitForCalls(sb, k).length).toBe(k);
        const count = lastCount(run);
        expect(count.launched, count.line).toBe(k);
        expect(count.live, count.line).toBe(k);
        expect(run.exitCode, `stderr:\n${run.err}`).toBe(0);
      } finally {
        reap(sb);
      }
    }, 60_000);

    test(`${label(f)}: a pid that cannot be recorded ⇒ launched=${k} live=${k - 1}, an ABORT through teardown, non-zero exit`, () => {
      const sb = makeSandbox();
      try {
        const script = smokeScript(f, unique("ste595t"), sb);
        mkdirSync(firstPidfile(script), { recursive: true });
        const run = runFenceAt(writeFence(sb, script), sb, {});
        waitForCalls(sb, k);
        const both = `${run.out}\n${run.err}`;
        const count = lastCount(run);
        expect(count.launched, count.line).toBe(k);
        expect(count.live, count.line).toBe(k - 1);
        expect(run.exitCode, both).not.toBe(0);
        expect(both).toMatch(/ABORT/);
        expect(both).toMatch(/teardown/i);
      } finally {
        reap(sb);
      }
    }, 60_000);
  }
});
