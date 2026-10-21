// M_292387 /implement Phase 3 round-1 review fixes. Each test was red against
// the pre-fix tree and pins one finding:
//   R1 — the nested runner spawns the parent's bun (`process.execPath`).
//   R2 — runAssertion kills at its bound with SIGKILL, so a command that
//        ignores SIGTERM cannot outlive it.
//   R3 — the spawn_receipt front door names a check it could not start,
//        instead of printing the raw spawn error.
//   R4 — gate_capture says so when a run's report cannot be read, so a red
//        run is never silent about why no failing test is named.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runAssertion, scoreRun } from "../adapters/_shared/src/falsifiability_harness";
import { renderFailingLines } from "../adapters/_shared/src/gate_capture";

const SRC = resolve(import.meta.dir, "../adapters/_shared/src");
const RUNNER = resolve(import.meta.dir, "_nested_bun_test.ts");

const DIRS: string[] = [];
afterAll(() => {
  for (const d of DIRS) rmSync(d, { recursive: true, force: true });
});

describe("R1 — the nested runner spawns the parent's bun", () => {
  test("its spawn names process.execPath, not `bun` from PATH", () => {
    const src = readFileSync(RUNNER, "utf-8");
    expect(src).toMatch(/spawnSync\(\s*process\.execPath\s*,\s*\[\s*"test"/);
    expect(src).not.toMatch(/spawnSync\(\s*"bun"/);
  });
});

describe("R2 — runAssertion kills at its bound with SIGKILL", () => {
  test("a SIGTERM-ignoring command is stopped at the bound and refused as did-not-complete", () => {
    const t0 = performance.now();
    const run = runAssertion({ command: "trap '' TERM; exec sleep 5" } as never, { timeoutMs: 300 });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(4_500);
    expect(run.timedOut).toBe(true);
    expect(() => scoreRun(run, "stdout-count" as never)).toThrow(/did not complete/i);
  }, 15_000);
});

describe("R3 — the spawn_receipt front door names a check it could not start", () => {
  test("a fifth argument that does not exist ends in a named ownership-unresolved refusal", () => {
    const dir = mkdtempSync(join(tmpdir(), "m292387-r3-"));
    DIRS.push(dir);
    const proc = Bun.spawnSync(
      [process.execPath, join(SRC, "spawn_receipt.ts"), "surface:1", join(dir, "ledger.tsv"), "w", "cmux", join(dir, "no-such-check")],
      { cwd: dir, env: { ...process.env, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg") }, stdout: "pipe", stderr: "pipe" },
    );
    const stderr = proc.stderr.toString();
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stdout.toString()).toBe("");
    expect(stderr).toMatch(/^Refusing: the ownership check for worker "w" could not be started/m);
    expect(stderr).toMatch(/^Remedy: /m);
    expect(stderr).toMatch(/^Context: reason=ownership-unresolved$/m);
  });
});

describe("R4 — gate_capture is never silent about unnamed failures", () => {
  test("named failures render one line each", () => {
    expect(renderFailingLines(["a.test.ts > x", "b.test.ts > y"], true)).toEqual([
      "gate_capture: failing — a.test.ts > x",
      "gate_capture: failing — b.test.ts > y",
    ]);
  });

  test("an unreadable report on a report-writing stack is said out loud", () => {
    expect(renderFailingLines(null, true)).toEqual([
      "gate_capture: failing tests cannot be named — this run's report could not be read",
    ]);
  });

  test("a stack that writes no report prints nothing extra (its skip line already says so)", () => {
    expect(renderFailingLines(null, false)).toEqual([]);
  });
});

describe("R5 — a malformed marketplace manifest skips its candidate", () => {
  test("a non-array `plugins` falls through to installPath instead of throwing", () => {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "m292387-r5-"));
    DIRS.push(dir);
    const cfg = join(dir, "cfg", "plugins");
    const market = join(dir, "market");
    const install = join(dir, "install");
    mkdirSync(cfg, { recursive: true });
    mkdirSync(join(market, ".claude-plugin"), { recursive: true });
    mkdirSync(join(install, "skills", "spawn-agent", "lib"), { recursive: true });
    writeFileSync(join(market, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: { name: "agent-toolkit" } }));
    writeFileSync(join(cfg, "known_marketplaces.json"), JSON.stringify({ m: { source: { source: "directory", path: market } } }));
    writeFileSync(join(cfg, "installed_plugins.json"), JSON.stringify({ plugins: { "agent-toolkit@m": [{ installPath: install }] } }));
    writeFileSync(join(install, "skills", "spawn-agent", "lib", "owned.py"), "import sys\nprint('surface:1')\n");
    const proc = Bun.spawnSync(
      [process.execPath, join(SRC, "spawn_receipt.ts"), "surface:1", join(dir, "ledger.tsv"), "w", "cmux"],
      { cwd: dir, env: { ...process.env, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg") }, stdout: "pipe", stderr: "pipe" },
    );
    expect(proc.stderr.toString()).not.toMatch(/TypeError|is not a function/);
    expect(proc.stdout.toString()).toBe("  - spawn: handle=surface:1 ledger=" + join(dir, "ledger.tsv") + " owned=0\n");
  });
});
