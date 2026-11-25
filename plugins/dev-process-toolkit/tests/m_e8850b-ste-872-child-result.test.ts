// STE-872 (M_e8850b) — a test child killed by a signal is named as a crash and
// still fails (AC-STE-872.1 / .2 / .3).
//
// The helper `tests/_child_result.ts` reads a FINISHED child result — a
// `Bun.spawnSync` result (exitCode / signalCode / exitedDueToTimeout), a
// `node:child_process` spawnSync result (status / signal / error.code
// ETIMEDOUT) or a node async `close` pair ({ code, signal }) — and returns
// { code, signal, timedOut, note }. Every child here is real: a shell that
// kills itself with SIGTRAP, a shell that exits on its own, a sleep that
// outlives its timeout.

import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNestedBunTest } from "./_nested_bun_test";

const TESTS = import.meta.dir;
const HELPER = join(TESTS, "_child_result.ts");

type ChildResult = { code: number; signal: string | null; timedOut: boolean; note: string };
type ChildResultFn = (result: unknown, command: string[] | string, opts?: { timeoutMs?: number }) => ChildResult;

async function helper(): Promise<ChildResultFn> {
  expect(existsSync(HELPER), "tests/_child_result.ts exists").toBe(true);
  const mod = (await import(HELPER)) as { childResult?: ChildResultFn };
  expect(typeof mod.childResult, "tests/_child_result.ts exports childResult").toBe("function");
  return mod.childResult!;
}

const TRAP = ["sh", "-c", "kill -TRAP $$"];
const EXIT1 = ["sh", "-c", "exit 1"];
const EXIT0 = ["sh", "-c", "exit 0"];
const SLEEP = ["sh", "-c", "sleep 5"];
const TIMEOUT_MS = 200;

function nodeClose(cmd: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

// ------------------------------------------------------------ AC-STE-872.1/.3

describe("AC-STE-872.3 — a child that kills itself with SIGTRAP is named by the helper", () => {
  test("AC-STE-872.3: Bun.spawnSync — the note names SIGTRAP, the command and that the child did not exit on its own", async () => {
    const childResult = await helper();
    const r = Bun.spawnSync(TRAP, { stdout: "pipe", stderr: "pipe" });
    expect({ exitCode: r.exitCode, signalCode: r.signalCode }, "precondition: the child really died of SIGTRAP").toEqual({ exitCode: null, signalCode: "SIGTRAP" });
    const out = childResult(r, TRAP);
    expect(out.signal).toBe("SIGTRAP");
    expect(out.timedOut).toBe(false);
    expect(out.note).toContain("SIGTRAP");
    expect(out.note).toContain("kill -TRAP $$");
    expect(out.note).toContain("did not exit on its own");
  });

  test("AC-STE-872.3: node spawnSync — the note names SIGTRAP, the command and that the child did not exit on its own", async () => {
    const childResult = await helper();
    const r = spawnSync(TRAP[0]!, TRAP.slice(1), { encoding: "utf-8" });
    expect({ status: r.status, signal: r.signal }, "precondition: the child really died of SIGTRAP").toEqual({ status: null, signal: "SIGTRAP" });
    const out = childResult(r, TRAP.join(" "));
    expect(out.signal).toBe("SIGTRAP");
    expect(out.timedOut).toBe(false);
    expect(out.note).toContain("SIGTRAP");
    expect(out.note).toContain("kill -TRAP $$");
    expect(out.note).toContain("did not exit on its own");
  });

  test("AC-STE-872.3: node async close — { code: null, signal: SIGTRAP } is named the same way", async () => {
    const childResult = await helper();
    const r = await nodeClose(TRAP);
    expect(r, "precondition: the child really died of SIGTRAP").toEqual({ code: null, signal: "SIGTRAP" });
    const out = childResult(r, TRAP);
    expect(out.signal).toBe("SIGTRAP");
    expect(out.note).toContain("SIGTRAP");
    expect(out.note).toContain("did not exit on its own");
  });

  test("AC-STE-872.3: Bun.spawnSync — a child that exits 1 on its own gives code 1 and no signal text", async () => {
    const childResult = await helper();
    const out = childResult(Bun.spawnSync(EXIT1), EXIT1);
    expect(out).toEqual({ code: 1, signal: null, timedOut: false, note: "" });
  });

  test("AC-STE-872.3: node spawnSync — a child that exits 1 on its own gives code 1 and no signal text", async () => {
    const childResult = await helper();
    const out = childResult(spawnSync(EXIT1[0]!, EXIT1.slice(1)), EXIT1);
    expect(out).toEqual({ code: 1, signal: null, timedOut: false, note: "" });
  });

  test("AC-STE-872.3: node async close — { code: 1, signal: null } gives code 1 and no signal text", async () => {
    const childResult = await helper();
    const out = childResult(await nodeClose(EXIT1), EXIT1);
    expect(out).toEqual({ code: 1, signal: null, timedOut: false, note: "" });
  });
});

describe("AC-STE-872.1 — one helper, three result shapes, and a failure never becomes a pass", () => {
  test("AC-STE-872.1: a signal-derived code is never 0 — it is -1 for every shape", async () => {
    const childResult = await helper();
    const codes = [
      childResult(Bun.spawnSync(TRAP), TRAP).code,
      childResult(spawnSync(TRAP[0]!, TRAP.slice(1)), TRAP).code,
      childResult(await nodeClose(TRAP), TRAP).code,
    ];
    expect(codes).toEqual([-1, -1, -1]);
  });

  test("AC-STE-872.1: a child that exits 0 on its own reads as 0 with an empty note", async () => {
    const childResult = await helper();
    expect(childResult(Bun.spawnSync(EXIT0), EXIT0)).toEqual({ code: 0, signal: null, timedOut: false, note: "" });
  });

  test("AC-STE-872.1: Bun.spawnSync killed by its own timeout is named as a timeout, not a signal kill", async () => {
    const childResult = await helper();
    const r = Bun.spawnSync(SLEEP, { timeout: TIMEOUT_MS });
    expect(r.exitCode, "precondition: the timeout killed the child").toBeNull();
    const out = childResult(r, SLEEP, { timeoutMs: TIMEOUT_MS });
    expect(out.timedOut).toBe(true);
    expect(out.code).not.toBe(0);
    expect(out.note).toMatch(/time(d)? ?out/i);
    expect(out.note).toContain(String(TIMEOUT_MS));
    expect(out.note).toContain("sleep 5");
    expect(out.note).not.toContain("did not exit on its own");
  });

  test("AC-STE-872.1: node spawnSync killed by its own timeout (error.code ETIMEDOUT) is named as a timeout", async () => {
    const childResult = await helper();
    const r = spawnSync(SLEEP[0]!, SLEEP.slice(1), { timeout: TIMEOUT_MS });
    expect((r.error as NodeJS.ErrnoException | undefined)?.code, "precondition: the timeout killed the child").toBe("ETIMEDOUT");
    const out = childResult(r, SLEEP, { timeoutMs: TIMEOUT_MS });
    expect(out.timedOut).toBe(true);
    expect(out.code).not.toBe(0);
    expect(out.note).toMatch(/time(d)? ?out/i);
    expect(out.note).not.toContain("did not exit on its own");
  });

  // Amended by AC-STE-872.1 (M_e8850b, review F7): a child that never started, or
  // one killed for passing maxBuffer, is named as that, not as a machine-load kill.
  test("AC-STE-872.1: node spawnSync of a missing command is named as a start failure (ENOENT), not a kill", async () => {
    const childResult = await helper();
    const r = spawnSync("dpt-no-such-command-a1", []);
    expect((r.error as NodeJS.ErrnoException | undefined)?.code, "precondition: the command was not found").toBe("ENOENT");
    const out = childResult(r, "dpt-no-such-command-a1");
    expect(out.code).toBe(-1);
    expect(out.signal).toBeNull();
    expect(out.timedOut).toBe(false);
    expect(out.note).toContain("failed to start (ENOENT)");
    expect(out.note).toContain("dpt-no-such-command-a1");
    expect(out.note).not.toContain("killed");
    expect(out.note).not.toContain("machine-load");
  });

  test("AC-STE-872.1: node spawnSync of a file that is not executable is named as a start failure (EACCES)", async () => {
    const childResult = await helper();
    const dir = mkdtempSync(join(tmpdir(), "ste-872-eacces-"));
    try {
      const file = join(dir, "not-executable.sh");
      writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
      const r = spawnSync(file, []);
      expect((r.error as NodeJS.ErrnoException | undefined)?.code, "precondition: the file could not be run").toBe("EACCES");
      const out = childResult(r, file);
      expect(out.code).toBe(-1);
      expect(out.note).toContain("failed to start (EACCES)");
      expect(out.note).not.toContain("machine-load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC-STE-872.1: node spawnSync whose output passes maxBuffer is named as a buffer limit (ENOBUFS), not a machine-load kill", async () => {
    const childResult = await helper();
    const cmd = ["sh", "-c", "yes | head -c 2000000"];
    const r = spawnSync(cmd[0]!, cmd.slice(1), { maxBuffer: 1000 });
    expect((r.error as NodeJS.ErrnoException | undefined)?.code, "precondition: the output passed maxBuffer").toBe("ENOBUFS");
    const out = childResult(r, cmd);
    expect(out.code).toBe(-1);
    expect(out.timedOut).toBe(false);
    expect(out.note).toContain("maxBuffer");
    expect(out.note).toContain("ENOBUFS");
    expect(out.note).toContain("yes | head -c 2000000");
    expect(out.note).not.toContain("machine-load");
  });

  test("AC-STE-872.1: withNote adds a note to stderr on its own line, and an empty note adds nothing", async () => {
    const mod = (await import(HELPER)) as { withNote?: (stderr: string, note: string) => string };
    expect(typeof mod.withNote).toBe("function");
    expect(mod.withNote!("boom", "")).toBe("boom");
    expect(mod.withNote!("", "[n]")).toBe("[n]\n");
    expect(mod.withNote!("boom", "[n]")).toBe("boom\n[n]\n");
    expect(mod.withNote!("boom\n", "[n]")).toBe("boom\n[n]\n");
  });

  test("AC-STE-872.1: the helper imports only node builtins and starts no process (it never retries)", () => {
    const src = readFileSync(HELPER, "utf-8");
    const imports = [...src.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(imports.filter((s) => !s.startsWith("node:"))).toEqual([]);
    expect(src).not.toMatch(/\b(spawnSync|spawn|execSync|execFileSync|exec|execFile|fork)\s*\(|Bun\.spawn/);
  });
});

// ------------------------------------------------------------------ AC-STE-872.2

/** A runner module under tests/ that starts bun: a spawn call plus a bun binary reference. */
function startsBun(src: string): boolean {
  return /\bspawnSync\s*\(|\bspawn\s*\(|Bun\.spawn/.test(src) && /process\.execPath|["']bun["']|\bREAL_BUN\b/.test(src);
}

/**
 * Every `(exitCode|status|code) ?? <anything but null/undefined>` or `|| <anything>`
 * that is real code, not `${…}` shell-template text: a number, a ternary in
 * parentheses or a name all turn a null exit code into a number.
 */
function nullCollapses(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(/[\w.]*\b(?:exitCode|status|code)\s*(?:\?\?\s*(?!null\b|undefined\b)|\|\|\s*)[-\w(]+/g)) {
    if (src.slice(Math.max(0, m.index! - 2), m.index!) === "${") continue;
    const line = src.slice(0, m.index!).split("\n").length;
    hits.push(`${line}: ${m[0]}`);
  }
  return hits;
}

const RUNNERS = [
  "_gate_receipt_fixture.ts",
  "_m_7bc805_capture_fixture.ts",
  "_m_7bc805_gate_outcome_fixture.ts",
  "_m_7bc805_timeline_fixture.ts",
  "_m_b2fdc0_ste729_fixture.ts",
  "_m_b2fdc0_ste730_fixture.ts",
  "_m_d1b4b7_ste722_fixture.ts",
  "_orphan_pages.ts",
  "_shared_tracker_runner.ts",
];
/** The test files red in v3.10.0's two recorded runs, and the runner each one reaches bun through. */
const RED_IN_V3100: Array<[file: string, runner: string]> = [
  ["m_fd9a03-ste-725-reuse-verdict.test.ts", "_m_7bc805_gate_outcome_fixture.ts"],
  ["m_2306b6-ste-616-guard-mutation-matrix.test.ts", "_shared_tracker_runner.ts"],
];
/**
 * Runners that start bun but must stay loadable from any directory, so they
 * import only `node:` builtins and cannot import the helper. Each one must still
 * name the signal and say the child did not exit on its own (tested below).
 */
const SELF_CONTAINED = ["_nested_bun_test.ts"];
const read = (f: string): string => readFileSync(join(TESTS, f), "utf-8");
const bunRunners = (): string[] => readdirSync(TESTS).filter((f) => /^_.*\.ts$/.test(f) && f !== "_child_result.ts" && startsBun(read(f))).sort();
const importsHelper = (src: string): boolean => /from\s+["']\.\/_child_result(\.ts)?["']/.test(src);
/** The bun runners, other than the self-contained ones, that do not import the helper. */
const runnersWithoutHelper = (files: Array<{ name: string; src: string }>): string[] =>
  files.filter((f) => !SELF_CONTAINED.includes(f.name) && startsBun(f.src) && !importsHelper(f.src)).map((f) => f.name).sort();

describe("AC-STE-872.2 — no runner that starts bun collapses a null exit code without the helper", () => {
  test("AC-STE-872.2: the sweep sees every named runner (a vacuous sweep proves nothing)", () => {
    const found = bunRunners();
    expect(found.length).toBeGreaterThanOrEqual(RUNNERS.length);
    expect(RUNNERS.filter((r) => !found.includes(r))).toEqual([]);
  });

  test("AC-STE-872.2: mutation control — the predicate reds a synthetic offender and spares shell-template text", () => {
    const offender = 'const p = Bun.spawnSync(["bun", "run", m]);\nreturn { code: p.exitCode ?? -1 };\n';
    expect(startsBun(offender)).toBe(true);
    expect(nullCollapses(offender)).toEqual(["2: p.exitCode ?? -1"]);
    expect(nullCollapses("const r = spawnSync(process.execPath, []);\nreturn { exitCode: r.status ?? 1 };")).toEqual(["2: r.status ?? 1"]);
    expect(nullCollapses('child.on("close", (code) => done({ exitCode: code ?? -1 }));')).toEqual(["1: code ?? -1"]);
    expect(nullCollapses("const tail = `exit ${r.exitCode ?? 0}`;")).toEqual([]);
    // Spellings a numbers-only sweep missed.
    expect(nullCollapses("return { exitCode: proc.status ?? (proc.signal !== null ? 128 : 1) };")).toEqual(["1: proc.status ?? (proc"]);
    expect(nullCollapses("return { code: p.exitCode || -1 };")).toEqual(["1: p.exitCode || -1"]);
    expect(nullCollapses("return { code: p.exitCode ?? FALLBACK };")).toEqual(["1: p.exitCode ?? FALLBACK"]);
    // Keeping the null is not a collapse.
    expect(nullCollapses("const c = p.exitCode ?? null;")).toEqual([]);
  });

  // Amended by AC-STE-872.2 (M_e8850b, review F6): every bun runner the sweep
  // finds must read its child through the helper, not only a hard-coded list,
  // so a new runner that skips the helper turns this red.
  for (const f of [...new Set([...RUNNERS, ...bunRunners().filter((r) => !SELF_CONTAINED.includes(r))])].sort()) {
    test(`AC-STE-872.2: ${f} reads its child through tests/_child_result.ts`, () => {
      expect(importsHelper(read(f))).toBe(true);
    });
  }

  test("AC-STE-872.2: every runner under tests/ that starts bun, other than the self-contained ones, imports the helper", () => {
    const files = bunRunners().map((name) => ({ name, src: read(name) }));
    expect(files.length).toBeGreaterThanOrEqual(RUNNERS.length);
    expect(runnersWithoutHelper(files)).toEqual([]);
  });

  test("AC-STE-872.2: mutation control — a synthetic bun runner without the helper reds the sweep", () => {
    const files = bunRunners().map((name) => ({ name, src: read(name) }));
    const synthetic = {
      name: "_synthetic_runner.ts",
      src: 'import { spawnSync } from "node:child_process";\nexport const run = (m: string) => {\n  const p = spawnSync("bun", ["run", m]);\n  return { status: p.status, stderr: p.stderr };\n};\n',
    };
    expect(startsBun(synthetic.src), "the synthetic runner starts bun").toBe(true);
    expect(nullCollapses(synthetic.src), "it collapses nothing, so only the import sweep can catch it").toEqual([]);
    expect(runnersWithoutHelper([...files, synthetic])).toEqual(["_synthetic_runner.ts"]);
    const adopted = { name: "_synthetic_runner.ts", src: `import { childResult } from "./_child_result";\n${synthetic.src}` };
    expect(runnersWithoutHelper([...files, adopted])).toEqual([]);
    const exempt = { name: SELF_CONTAINED[0]!, src: synthetic.src };
    expect(runnersWithoutHelper([exempt])).toEqual([]);
  });

  test("AC-STE-872.2: the shared runners name a bun child killed by a signal: non-zero code and the note on stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-872-runners-"));
    try {
      const mod = join(dir, "self-kill.ts");
      writeFileSync(mod, 'process.kill(process.pid, "SIGKILL");\n');
      const { spawnDoor } = await import("./_span_declare_fixture");
      const { runModule } = await import("./_sibling_state_fixture");
      const { runRetro } = await import("./_m_d1b4b7_retro_fixture");
      const { runProposal } = await import("./_m_d1b4b7_ste728_fixture");
      const { runFrontDoor } = await import("./_m_d1b4b7_ste720_fixture");
      const runs: Array<[string, { status: number | null; stderr: string }]> = [
        ["spawnDoor", spawnDoor(mod, [], dir)],
        ["runModule", runModule(mod, [])],
        ["runRetro", runRetro(dir, [], {}, mod)],
        ["runProposal", runProposal(["propose", dir], { module: mod, cwd: dir })],
        ["runFrontDoor", runFrontDoor(dir, dir, [], { door: mod })],
      ];
      for (const [name, r] of runs) {
        expect(typeof r.status, `${name}: the code is a number`).toBe("number");
        expect(r.status, `${name}: a signal kill is never 0`).not.toBe(0);
        expect(r.stderr, `${name}: stderr names the signal`).toContain("SIGKILL");
        expect(r.stderr, `${name}: stderr says the child did not exit on its own`).toContain("did not exit on its own");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test("AC-STE-872.2: no runner under tests/ that starts bun collapses a null exit code", () => {
    const offenders = bunRunners()
      .filter((f) => !SELF_CONTAINED.includes(f))
      .flatMap((f) => nullCollapses(read(f)).map((h) => `${f}:${h}`));
    expect(offenders).toEqual([]);
  });

  test("AC-STE-872.2: the self-contained runners are bun runners the sweep sees, and they import only node builtins", () => {
    const found = bunRunners();
    for (const f of SELF_CONTAINED) {
      expect(found, `${f} is found by the sweep`).toContain(f);
      // The sweep sees its collapse, so the exemption is the only thing that spares it.
      expect(nullCollapses(read(f)).length, `${f}: the sweep sees its collapse`).toBeGreaterThan(0);
      expect(importsHelper(read(f))).toBe(false);
      const imports = [...read(f).matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
      expect(imports.filter((s) => !s.startsWith("node:")), `${f} imports only node builtins`).toEqual([]);
    }
  });

  test("AC-STE-872.2: _nested_bun_test.ts names a signal kill: non-zero code, the signal, and a note", () => {
    const depth = Number(process.env.DPT_NESTED_BUN_TEST_DEPTH || "0");
    if (depth >= 3) return; // at the ceiling the runner refuses to spawn; the source tests above still hold
    const dir = mkdtempSync(join(tmpdir(), "ste-872-nested-"));
    try {
      const file = join(dir, "self-kill.test.ts");
      writeFileSync(file, 'import { test } from "bun:test";\ntest("dies", () => { process.kill(process.pid, "SIGKILL"); });\n');
      const r = runNestedBunTest([file], { cwd: dir, timeoutMs: 60_000 });
      expect(r.timedOut).toBe(false);
      expect(r.exitCode).not.toBe(0);
      expect(r.signal).toBe("SIGKILL");
      expect(r.note).toContain("SIGKILL");
      expect(r.note).toContain(file);
      expect(r.note).toContain("did not exit on its own");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  test("AC-STE-872.2: _nested_bun_test.ts names its own timeout as a timeout, and a clean exit has no note", () => {
    const depth = Number(process.env.DPT_NESTED_BUN_TEST_DEPTH || "0");
    if (depth >= 3) return;
    const dir = mkdtempSync(join(tmpdir(), "ste-872-nested-"));
    try {
      const slow = join(dir, "slow.test.ts");
      writeFileSync(slow, 'import { test } from "bun:test";\ntest("slow", async () => { await Bun.sleep(20_000); }, 60_000);\n');
      const t = runNestedBunTest([slow], { cwd: dir, timeoutMs: 1_500 });
      expect(t.timedOut).toBe(true);
      expect(t.exitCode).not.toBe(0);
      expect(t.note).toContain("timed out");
      expect(t.note).toContain("1500 ms");
      expect(t.note).not.toContain("did not exit on its own");
      const fine = join(dir, "fine.test.ts");
      writeFileSync(fine, 'import { test } from "bun:test";\ntest("fine", () => {});\n');
      const f = runNestedBunTest([fine], { cwd: dir, timeoutMs: 60_000 });
      expect({ exitCode: f.exitCode, signal: f.signal, note: f.note }).toEqual({ exitCode: 0, signal: null, note: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  for (const [file, runner] of RED_IN_V3100) {
    test(`AC-STE-872.2: ${file} collapses no null exit code and reaches bun through the helper`, () => {
      const src = read(file);
      expect(nullCollapses(src)).toEqual([]);
      expect(src).toContain(`from "./${runner.replace(/\.ts$/, "")}"`);
      expect(importsHelper(read(runner))).toBe(true);
    });
  }
});
