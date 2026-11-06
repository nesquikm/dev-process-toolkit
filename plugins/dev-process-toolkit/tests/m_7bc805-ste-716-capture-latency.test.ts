// STE-716 (M_7bc805) AC.10 — capture latency against a same-run no-op baseline.
//
// The baseline is a no-op Bun wrapper (`exec bun run <noop.ts>`), spawned 30
// times in this run. Each case spawns the rendered registered command through
// `sh -c` 30 times. Bounds (AC-STE-716.10):
//   key absent            p95 <= baseline p95
//   flag false            p95 <= baseline p95 + 25 ms
//   flag on, other Bash   p95 <= baseline p95 + 50 ms
//   flag on, commit/Skill in a 2,000-file repo   p95 <= 500 ms
//   every case            max < 2,000 ms (the registered timeout)
// The full gate runs suites alongside each other, so a case that misses its
// bound is measured once more, baseline included, and fails only when both
// rounds miss. Every p95 of both rounds is printed.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CR,
  GIT_ENV,
  PLUGIN_REAL,
  RUNNING_VERSION,
  cleanupTemps,
  git,
  makeCheckout,
  payload,
  recordFor,
  recordPathOf,
  tempDir,
} from "./_m_7bc805_capture_fixture";

afterAll(cleanupTemps);

const RUNS = 30;

function p95(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1]!;
}

function time(argv: string[], cwd: string, stdin: string, env: Record<string, string>): number {
  const t0 = performance.now();
  const p = Bun.spawnSync(argv, { cwd, stdin: Buffer.from(stdin), stdout: "pipe", stderr: "pipe", env });
  const dt = performance.now() - t0;
  if (p.exitCode !== 0) throw new Error(`${argv.join(" ")} exited ${p.exitCode}: ${p.stderr.toString()}`);
  return dt;
}

function sample(argv: string[], cwd: string, stdin: string, env: Record<string, string>): number[] {
  return Array.from({ length: RUNS }, () => time(argv, cwd, stdin, env));
}

interface Case {
  name: string;
  root: string;
  command: string;
  stdin: string;
  bound: (base: number) => number;
}

describe("AC-STE-716.10 capture latency", () => {
  test("capture latency: every case within its bound of the same-run no-op baseline (retry once)", async () => {
    const m = await CR();
    const env = { ...(process.env as Record<string, string>), ...GIT_ENV };

    // The no-op Bun wrapper.
    const noopDir = tempDir("lat-noop");
    writeFileSync(join(noopDir, "noop.ts"), "await Bun.stdin.text();\nprocess.exit(0);\n");
    writeFileSync(join(noopDir, "noop.sh"), `#!/bin/bash\nexec bun run "${join(noopDir, "noop.ts")}" "$@"\n`);
    chmodSync(join(noopDir, "noop.sh"), 0o755);

    // A 2,000-file repo with the flag on and one staged change.
    const files: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) files[`src/d${i % 40}/f${i}.txt`] = `line ${i}\n`;
    const big = makeCheckout("lat-big", "on", { files });
    writeFileSync(join(big, "src", "d0", "f0.txt"), "changed\n");
    mkdirSync(join(big, "src", "new"), { recursive: true });
    writeFileSync(join(big, "src", "new", "n.txt"), "n\n");
    git(big, "add", "-A");

    const absent = makeCheckout("lat-absent", "absent");
    const off = makeCheckout("lat-off", "false");
    const on = makeCheckout("lat-on", "on");

    const commandFor = (root: string): string => {
      const { cfg } = recordFor(`lat-rec`, root);
      return m.renderCaptureHookCommand({ pluginRoot: PLUGIN_REAL, version: RUNNING_VERSION, installedPlugins: recordPathOf(cfg) });
    };
    const stdinFor = (root: string, p: Parameters<typeof payload>[0]): string => JSON.stringify(payload({ ...p, cwd: root }));

    const cases: Case[] = [
      { name: "key absent", root: absent, command: commandFor(absent), stdin: stdinFor(absent, { event: "pre", tool: "Bash", cwd: absent, command: "ls" }), bound: (b) => b },
      { name: "flag false", root: off, command: commandFor(off), stdin: stdinFor(off, { event: "pre", tool: "Bash", cwd: off, command: "ls" }), bound: (b) => b + 25 },
      { name: "flag on, other Bash", root: on, command: commandFor(on), stdin: stdinFor(on, { event: "pre", tool: "Bash", cwd: on, command: "ls" }), bound: (b) => b + 50 },
      { name: "flag on, commit, 2,000 files", root: big, command: commandFor(big), stdin: stdinFor(big, { event: "pre", tool: "Bash", cwd: big, command: "git commit -m x" }), bound: () => 500 },
      { name: "flag on, Skill, 2,000 files", root: big, command: commandFor(big), stdin: stdinFor(big, { event: "pre", tool: "Skill", cwd: big, skill: "dev-process-toolkit:tdd" }), bound: () => 500 },
    ];

    const baseline = (): number => p95(sample(["/bin/bash", join(noopDir, "noop.sh")], noopDir, "{}", env));
    const measure = (c: Case): { p95: number; max: number } => {
      const s = sample(["/bin/sh", "-c", c.command], c.root, c.stdin, { ...env, CLAUDE_PROJECT_DIR: c.root });
      return { p95: p95(s), max: Math.max(...s) };
    };

    const failures: string[] = [];
    const base1 = baseline();
    console.log(`[AC-STE-716.10] round 1 baseline p95 = ${base1.toFixed(1)} ms`);
    for (const c of cases) {
      const r1 = measure(c);
      const ok1 = r1.p95 <= c.bound(base1) && r1.max < 2000;
      console.log(`[AC-STE-716.10] round 1 ${c.name}: p95 = ${r1.p95.toFixed(1)} ms, max = ${r1.max.toFixed(1)} ms, bound = ${c.bound(base1).toFixed(1)} ms ${ok1 ? "ok" : "MISS"}`);
      if (ok1) continue;
      const base2 = baseline();
      const r2 = measure(c);
      const ok2 = r2.p95 <= c.bound(base2) && r2.max < 2000;
      console.log(`[AC-STE-716.10] round 2 baseline p95 = ${base2.toFixed(1)} ms`);
      console.log(`[AC-STE-716.10] round 2 ${c.name}: p95 = ${r2.p95.toFixed(1)} ms, max = ${r2.max.toFixed(1)} ms, bound = ${c.bound(base2).toFixed(1)} ms ${ok2 ? "ok" : "MISS"}`);
      if (!ok2) failures.push(`${c.name}: round 1 p95 ${r1.p95.toFixed(1)} / bound ${c.bound(base1).toFixed(1)}; round 2 p95 ${r2.p95.toFixed(1)} / bound ${c.bound(base2).toFixed(1)}`);
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
