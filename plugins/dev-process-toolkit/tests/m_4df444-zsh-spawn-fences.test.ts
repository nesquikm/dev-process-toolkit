// M_4df444 / STE-595 + STE-594 — /implement Phase 3 (supervisor pre-review): the
// spawn fences' own new lines under zsh.
//
// STE-595 tells the driver to run every spawn fence as `bash <file>`, but the
// 2026-09-05 false ABORTs show drivers do run fences inline in zsh, and zsh does
// not field-split an unquoted parameter. Two of this milestone's new lines
// depended on that splitting (measured by the supervising session, 2026-09-15):
//   * the Phase A live-child count iterated `${SELECTED_LEGS}` and `${PIDS}`, so
//     under zsh it read one leg called "linear jira none", counted live=0,
//     ABORTed, handed `kill -0` one unsplit word (reaping nothing) and then
//     removed the pidfiles — leaving live leg drivers no scan could see;
//   * every /smoke-test ledger append passed `${DPT_SMOKE_PARENT:+--parent "…"}`,
//     one word under zsh, which the append parser refuses, so an inline zsh run
//     recorded no grandchild at all.
// Each case runs the REAL fence under zsh and, as the control, under bash; the
// bash run already passes, so the test pins shell-independence, not a new
// behaviour. `claude` and `bun` are stubbed exactly as the STE-594 harness does.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  appendsIn,
  baseEnv,
  makeSandbox,
  PHASE_A_ENV,
  phaseAScript,
  readCalls,
  reap,
  SMOKE_RUNNABLE,
  smokeScript,
  type Sandbox,
  sandboxLedgerRows,
  unique,
} from "./_ste594_harness";

const SHELLS: Array<[string, string]> = [
  ["bash (control)", "/bin/bash"],
  ["zsh", "/bin/zsh"],
];

const sandboxes: Sandbox[] = [];
afterEach(() => {
  for (const sb of sandboxes.splice(0)) reap(sb);
});

function runIn(shell: string, sb: Sandbox, script: string, env: Record<string, string>): { code: number; out: string } {
  const file = join(sb.root, `fence-${unique("z")}.sh`);
  writeFileSync(file, script);
  const which = Bun.spawnSync([shell, "-c", "command -v claude; command -v bun"], { env, cwd: sb.work });
  expect(which.stdout.toString().trim().split("\n"), "SAFETY: the stubs must shadow the real claude and bun").toEqual([
    join(sb.bin, "claude"),
    join(sb.bin, "bun"),
  ]);
  const r = Bun.spawnSync([shell, file], { env, cwd: sb.work, timeout: 60_000 });
  return { code: r.exitCode ?? -1, out: `${r.stdout.toString()}\n${r.stderr.toString()}` };
}

describe("AC-STE-595.6 / AC-STE-595.7 — Phase 3: the Phase A live-child count works under zsh as under bash", () => {
  for (const [name, shell] of SHELLS) {
    test(`${name}: three selected legs → launched=3 live=3, no ABORT, every leg's pidfile left for the poll`, () => {
      const sb = makeSandbox("record");
      sandboxes.push(sb);
      const iter = unique("zq");
      const r = runIn(shell, sb, phaseAScript(sb, iter), baseEnv(sb, { ...PHASE_A_ENV, SELECTED_LEGS: "linear jira none" }));
      expect(r.out, "the count line").toMatch(/launched=3 live=3/);
      expect(r.out).not.toMatch(/ABORT/);
      const pidfiles = readdirSync(sb.tmp).filter((n) => /-iter-.*-(linear|jira|none)\.pid$/.test(n));
      expect(pidfiles.length, `the fence removed pidfiles it should have left: ${JSON.stringify(pidfiles)}\n${r.out}`).toBe(3);
    });
  }
});

describe("AC-STE-594.3 — Phase 3: a /smoke-test grandchild records its parent under zsh as under bash", () => {
  const fence = SMOKE_RUNNABLE[0];
  for (const [name, shell] of SHELLS) {
    test(`${name}: every append in the first runnable /smoke-test fence records the inherited run, leg and parent`, () => {
      if (fence === undefined) throw new Error("no runnable /smoke-test spawn fence found");
      const sb = makeSandbox("delegate");
      sandboxes.push(sb);
      const run = randomUUID();
      const parent = randomUUID();
      const env = baseEnv(sb, { DPT_SMOKE_RUN_ID: run, DPT_SMOKE_LEG: "linear", DPT_SMOKE_PARENT: parent });
      const r = runIn(shell, sb, smokeScript(fence, sb, "linear"), env);
      const spawned = readCalls(sb).filter((c) => c.kind === "claude").length;
      const rows = sandboxLedgerRows(sb);
      expect(spawned, `the fence spawned something\n${r.out}`).toBeGreaterThan(0);
      expect(rows.length, `one recorded row per spawn (appends: ${JSON.stringify(appendsIn(readCalls(sb)))})\n${r.out}`).toBe(spawned);
      for (const row of rows) {
        expect(row.run).toBe(run);
        expect(row.leg).toBe("linear");
        expect(row.parent).toBe(parent);
      }
      expect(existsSync(sb.work), "sandbox intact").toBe(true);
    });
  }
});
