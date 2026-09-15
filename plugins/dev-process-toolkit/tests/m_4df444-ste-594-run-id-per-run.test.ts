// M_4df444 / STE-594 — the run id belongs to the RUN, not to one iteration.
//
// The FR records every spawn in a PER-RUN ledger. The first cut minted a fresh
// run id in every Phase A iteration and persisted it beside that iteration's
// pidfiles (`…-iter-<N>.run`). Two defects followed, both measured 2026-09-15:
//   * With --auto-fix running several iterations, every later reader (Phase B,
//     Termination) found only the LAST iteration's id, so a passed leg's
//     sessions from an earlier iteration were never in any cleanup's scope.
//   * The older Phase A fence tests (m121-ste-447, m121-ste-448) run the real
//     fence against the real /tmp and remove only the per-leg log/pid/rc files
//     they know, so every suite run left five `.run` files behind — 20 in one
//     afternoon, in a milestone about runs that clean up after themselves.
//
// The contract pinned here: ITER=1 mints the run id and writes it to one per-run
// file keyed by DATE (`dpt-conformance-loop-<date>.run`, the key the run's other
// artifacts already use); every later iteration and every later reader re-reads
// it by DATE alone.

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";

import {
  appendsIn,
  baseEnv,
  LOOP_TEXT,
  makeSandbox,
  PHASE_A_ENV,
  phaseAScript,
  readCalls,
  reap,
  runScript,
  type Sandbox,
} from "./_ste594_harness";

const sandboxes: Sandbox[] = [];
afterEach(() => {
  for (const sb of sandboxes.splice(0)) reap(sb);
});

/** Run Phase A for iterations 1 then 2 of ONE run (same DATE) in one sandbox. */
function twoIterations(): { sb: Sandbox; firstAppends: number } {
  const sb = makeSandbox("record");
  sandboxes.push(sb);
  const env = baseEnv(sb, { ...PHASE_A_ENV, SELECTED_LEGS: "linear jira none" });
  const r1 = runScript(sb, phaseAScript(sb, "1"), env);
  expect(r1.exitCode, `iteration 1 exit\n${r1.out}\n${r1.err}`).toBe(0);
  const firstAppends = appendsIn(readCalls(sb)).length;
  const r2 = runScript(sb, phaseAScript(sb, "2"), env);
  expect(r2.exitCode, `iteration 2 exit\n${r2.out}\n${r2.err}`).toBe(0);
  return { sb, firstAppends };
}

describe("AC-STE-594.3 / AC-STE-594.4 — one run id per run, found from DATE alone", () => {
  test("Phase A at ITER=2 records under the run id ITER=1 minted", () => {
    const { sb, firstAppends } = twoIterations();
    const appends = appendsIn(readCalls(sb));
    // Polarity: both iterations actually recorded, so one id cannot come from
    // an iteration that recorded nothing.
    expect(firstAppends).toBeGreaterThan(0);
    expect(appends.length).toBeGreaterThan(firstAppends);
    const runs = [...new Set(appends.map((a) => a.run))];
    expect(runs, `both iterations record under one run id: ${JSON.stringify(runs)}`).toHaveLength(1);
    expect(runs[0] ?? "").not.toBe("");
  });

  test("the run-id file is per run — one `dpt-conformance-loop-<date>.run`, none keyed by iteration", () => {
    const { sb } = twoIterations();
    const runFiles = readdirSync(sb.tmp).filter((n) => n.endsWith(".run")).sort();
    expect(runFiles, `run-id files in the rebased /tmp: ${JSON.stringify(runFiles)}`).toHaveLength(1);
    expect(runFiles[0]).toMatch(/^dpt-conformance-loop-\d{4}-\d{2}-\d{2}\.run$/);
  });

  test("every reader of the run-id file names it by DATE alone, never by ITER", () => {
    const readers = LOOP_TEXT.split("\n").filter((l) => /dpt-conformance-loop-[^"\s]*\.run\b/.test(l) && /\bcat\b/.test(l));
    expect(readers.length, "the loop doc re-reads the run id somewhere (Phase B at least)").toBeGreaterThan(0);
    for (const line of readers) {
      expect(line, "a reader keyed by iteration would miss an earlier iteration's run").not.toMatch(/iter-/);
      expect(line).toContain("dpt-conformance-loop-${DATE}.run");
    }
  });
});
