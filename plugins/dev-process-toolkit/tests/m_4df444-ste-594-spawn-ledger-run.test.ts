// M_4df444 / STE-594 — the spawn fences RUN, and every child they start is
// recorded first (AC.1 behaviour), under an id its grandchildren inherit
// (AC.3).
//
// SAFETY: see tests/_ste594_harness.ts. These suites use the harness's
// "record" mode. A ledger `append` is recorded by the bun stub and never
// executed, so nothing here writes a ledger anywhere; `claude` is a stub that
// records its argv and environment and sleeps 1.594 s. Every fence runs from a
// file with its /tmp paths and the repo root rebased into a per-test sandbox.
//
// WHAT IS RECORDED. The stubs share one record, so its order is the order the
// fence ran things in. For each stub `claude` call:
//   * its argv carries `--session-id <uuid>`, distinct per child;
//   * an EARLIER recorded `bun …/smoke_run_ledger.ts append` carries
//     `--session <that uuid>` and `--leg <that child's leg>`.
// `set -u` is prepended to every fence, as in STE-595's suites: that is how the
// driver ran them, so a fence that needs an inherited variable must default it.

import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { countLines, label, spawnLineIndices } from "./_spawn_fences";
import {
  appendsIn,
  baseEnv,
  envOf,
  inheritedDelta,
  makeSandbox,
  PHASE_A_ENV,
  phaseAScript,
  plantCheckout,
  readCalls,
  reap,
  REGISTERED_LEGS,
  runScript,
  sandboxLedgerRows,
  sessionIdOf,
  SMOKE_RUNNABLE,
  smokeScript,
  trackerOf,
  unique,
  UUID_RE,
  waitForKind,
  type Call,
  type FenceRun,
} from "./_ste594_harness";

function selections(legs: readonly string[]): string[][] {
  const out: string[][] = [[...legs]];
  if (legs.length > 1) out.push([legs[0]!]);
  if (legs.length > 2) out.push([legs[0]!, legs[legs.length - 1]!]);
  return out;
}

function lastCount(run: FenceRun) {
  const counts = countLines(`${run.out}\n${run.err}`);
  expect(counts.length, `no \`launched=<n> live=<n>\` line.\n--- stdout ---\n${run.out}\n--- stderr ---\n${run.err}`).toBeGreaterThan(0);
  return counts[counts.length - 1]!;
}

/** Every stub claude call carries a distinct uuid `--session-id`, and an earlier append recorded it (for `legOf(call)` when given). */
function expectEachChildRecordedFirst(cs: readonly Call[], legOf: (c: Call) => string | null, context: string): void {
  const kids = cs.filter((c) => c.kind === "claude");
  const appends = appendsIn(cs);
  const sids = kids.map((c) => sessionIdOf(c.args));
  for (const [i, c] of kids.entries()) {
    const sid = sids[i];
    expect(sid ?? "", `${context}: stub claude argv carries no --session-id <uuid>: ${c.args}`).toMatch(UUID_RE);
    const a = appends.find((x) => x.session === sid);
    expect(
      a,
      `${context}: no ledger append recorded session ${sid}.\nrecord:\n${cs.map((x) => `${x.kind} ${x.args}`).join("\n")}`,
    ).toBeDefined();
    expect(a!.index, `${context}: the append for ${sid} ran AFTER its spawn`).toBeLessThan(c.index);
    const leg = legOf(c);
    if (leg !== null) expect(a!.leg, `${context}: the append for ${sid} records the wrong leg`).toBe(leg);
  }
  expect(new Set(sids).size, `${context}: two children share one session id`).toBe(kids.length);
  expect(appends.length, `${context}: one append per child, and no append without a child`).toBe(kids.length);
}

// ===========================================================================
// AC-STE-594.1 — Phase A.
// ===========================================================================

describe("AC-STE-594.1 — the actual Phase A fence records each child under its --session-id before spawning it", () => {
  for (const sel of selections(REGISTERED_LEGS)) {
    test(`SELECTED_LEGS="${sel.join(" ")}": ${sel.length} recorded, ${sel.length} spawned, one run id, no unselected leg recorded`, () => {
      const sb = makeSandbox("record");
      try {
        const env = baseEnv(sb, { ...PHASE_A_ENV, SELECTED_LEGS: sel.join(" ") });
        const run = runScript(sb, phaseAScript(sb, unique("ste594i")), env);
        const cs = waitForKind(sb, "claude", sel.length);
        const kids = cs.filter((c) => c.kind === "claude");
        expect(kids.length, `stub claude calls:\n${kids.map((c) => c.args).join("\n")}`).toBe(sel.length);
        expectEachChildRecordedFirst(cs, (c) => trackerOf(c.args), "Phase A");

        const appends = appendsIn(cs);
        expect([...new Set(appends.map((a) => a.leg))].sort(), "appends name the selected legs and no other").toEqual([...sel].sort());
        const runs = [...new Set(appends.map((a) => a.run))];
        expect(runs.length, `one run id across the legs: ${JSON.stringify(runs)}`).toBe(1);
        expect(runs[0] ?? "", "the run id is non-empty").not.toBe("");

        // STE-595 still holds with the recording in place.
        const count = lastCount(run);
        expect(count.launched, count.line).toBe(sel.length);
        expect(count.live, count.line).toBe(sel.length);
        expect(run.exitCode, `stderr:\n${run.err}`).toBe(0);
      } finally {
        reap(sb);
      }
    }, 60_000);
  }
});

// ===========================================================================
// AC-STE-594.1 — every runnable /smoke-test spawn fence, standalone.
// ===========================================================================

describe("AC-STE-594.1 — each runnable /smoke-test spawn fence records its children first (standalone, no inherited run)", () => {
  test("CONTROL: at least one runnable /smoke-test spawn fence is derived", () => {
    expect(SMOKE_RUNNABLE.length).toBeGreaterThan(0);
  });

  for (const f of SMOKE_RUNNABLE) {
    const k = spawnLineIndices(f).length;
    test(`${label(f)}: ${k} children, each under a recorded --session-id; the appends carry a run and a leg; count still launched=${k} live=${k}`, () => {
      const sb = makeSandbox("record");
      try {
        const run = runScript(sb, smokeScript(f, sb, unique("ste594t")), baseEnv(sb));
        const cs = waitForKind(sb, "claude", k);
        expect(cs.filter((c) => c.kind === "claude").length).toBe(k);
        expectEachChildRecordedFirst(cs, () => null, label(f));
        for (const a of appendsIn(cs)) {
          expect(a.run ?? "", `append without a run: ${a.args}`).not.toBe("");
          expect(a.leg ?? "", `append without a leg: ${a.args}`).not.toBe("");
        }
        const count = lastCount(run);
        expect(count.launched, count.line).toBe(k);
        expect(count.live, count.line).toBe(k);
        expect(run.exitCode, `stderr:\n${run.err}`).toBe(0);
      } finally {
        reap(sb);
      }
    }, 60_000);
  }
});

// ===========================================================================
// AC-STE-594.3 — grandchildren inherit the run and the leg.
// ===========================================================================

const SENTINEL_TRACKER = "trk594x";

describe("AC-STE-594.3 — a /smoke-test grandchild records the run id and leg its parent's environment carries", () => {
  test("the loop exports its run id and each child's leg; a /smoke-test spawn fence run under that environment records them, not its own", () => {
    const f = SMOKE_RUNNABLE[0];
    expect(f, "a runnable /smoke-test spawn fence").toBeDefined();
    const k = spawnLineIndices(f!).length;
    const sb = makeSandbox("record");
    try {
      const loopEnv = baseEnv(sb, { ...PHASE_A_ENV, SELECTED_LEGS: REGISTERED_LEGS.join(" ") });
      runScript(sb, phaseAScript(sb, unique("ste594g")), loopEnv);
      const cs = waitForKind(sb, "claude", REGISTERED_LEGS.length);
      const kids = cs.filter((c) => c.kind === "claude");
      expect(kids.length).toBe(REGISTERED_LEGS.length);
      const loopRuns = [...new Set(appendsIn(cs).map((a) => a.run).filter((r): r is string => !!r))];
      expect(loopRuns.length, `the loop's appends carry one run id: ${JSON.stringify(loopRuns)}`).toBe(1);
      const runId = loopRuns[0]!;

      for (const child of kids) {
        const leg = trackerOf(child.args);
        const childEnv = envOf(sb, child.pid);
        expect(childEnv, `the ${leg} child's environment was captured`).not.toBeNull();
        const delta = inheritedDelta(childEnv!, loopEnv);
        expect(Object.values(delta), `the loop exports the run id to the ${leg} child`).toContain(runId);
        expect(Object.values(delta), `the loop exports the leg to the ${leg} child`).toContain(leg);

        // The grandchild fence's `<tracker>` is a SENTINEL, so a leg it records
        // can only have come from the inherited environment.
        const from = readCalls(sb).length;
        runScript(sb, smokeScript(f!, sb, SENTINEL_TRACKER), { ...baseEnv(sb), ...delta });
        const gAppends = appendsIn(waitForKind(sb, "claude", k, from));
        expect(gAppends.length, `${leg}: one append per grandchild`).toBe(k);
        for (const a of gAppends) {
          expect(a.run, `${leg} grandchild append: ${a.args}`).toBe(runId);
          expect(a.leg, `${leg} grandchild append: ${a.args}`).toBe(leg);
        }
      }

      // CONTROL: the same fence with nothing inherited does not land in the loop's run.
      const from = readCalls(sb).length;
      runScript(sb, smokeScript(f!, sb, SENTINEL_TRACKER), baseEnv(sb));
      const standalone = appendsIn(waitForKind(sb, "claude", k, from));
      expect(standalone.length).toBe(k);
      for (const a of standalone) expect(a.run, `standalone append: ${a.args}`).not.toBe(runId);
    } finally {
      reap(sb);
    }
  }, 90_000);
});

// ===========================================================================
// AUDIT FOLLOW-UP (M_4df444 F12) — a fence records under the checkout it is
// RUNNING IN, never under a literal one.
//
// Every /smoke-test append and every `--plugin-dir` carried the literal
// `/Users/ns/workspace/dev-process-toolkit`. That escaped the harness's rebase
// (which moves the REAL repo root, i.e. wherever these tests live) and the
// delegate stub's refusal (same string), so from a worktree the real ledger
// writer recorded under the main checkout — twenty-one files, measured
// 2026-09-16 — and the shipped fences would load one checkout's plugin while
// running in another. The binding now resolves from the fence's cwd: the
// checkout itself, or the test project beside it (Phase 2's real cwd), and
// refuses before any spawn when neither holds the plugin manifest. Delegate
// mode: the real writer runs, so "where the rows landed" is the assertion.
// ===========================================================================

describe("M_4df444 F12 — the fence binds its checkout from where it runs", () => {
  const f = SMOKE_RUNNABLE[0];

  test("run from the test project BESIDE the checkout, the rows land under the checkout", () => {
    expect(f, "a runnable /smoke-test spawn fence").toBeDefined();
    const k = spawnLineIndices(f!).length;
    const sb = makeSandbox("delegate");
    try {
      // Pre-flights #1 and #6 pin this layout: the checkout's basename, and the
      // test project as its sibling. The sandbox's own `work` is NOT the cwd.
      const checkout = plantCheckout(join(sb.root, "dev-process-toolkit"));
      const testProject = join(sb.root, "dpt-test-project-linear");
      mkdirSync(testProject, { recursive: true });
      const run = runScript(sb, smokeScript(f!, sb, "linear"), baseEnv(sb), 60_000, testProject);
      const cs = waitForKind(sb, "claude", k);
      expect(cs.filter((c) => c.kind === "claude").length, `stderr:\n${run.err}`).toBe(k);
      expect(run.exitCode, `stderr:\n${run.err}`).toBe(0);
      expect(sandboxLedgerRows(sb, checkout).length, "one row per spawn, under the CHECKOUT").toBe(k);
      expect(sandboxLedgerRows(sb).length, "nothing under the sandbox's work dir").toBe(0);
      expect(sandboxLedgerRows(sb, testProject).length, "nothing under the test project").toBe(0);
      // `pwd` in the fence is the PHYSICAL path (the sandbox lives under a
      // symlinked tmpdir on macOS), so compare against the resolved one.
      const pluginDir = join(realpathSync(checkout), "plugins", "dev-process-toolkit");
      for (const c of cs.filter((c) => c.kind === "claude")) {
        expect(c.args, "every child loads the plugin from the checkout it runs beside").toContain(`--plugin-dir ${pluginDir}`);
      }
    } finally {
      reap(sb);
    }
  }, 60_000);

  test("an exported DPT_PROJECT_ROOT wins over the cwd", () => {
    expect(f, "a runnable /smoke-test spawn fence").toBeDefined();
    const k = spawnLineIndices(f!).length;
    const sb = makeSandbox("delegate");
    try {
      const exported = plantCheckout(join(sb.root, "exported-checkout"));
      const run = runScript(sb, smokeScript(f!, sb, "linear"), baseEnv(sb, { DPT_PROJECT_ROOT: exported }));
      const cs = waitForKind(sb, "claude", k);
      expect(cs.filter((c) => c.kind === "claude").length, `stderr:\n${run.err}`).toBe(k);
      expect(sandboxLedgerRows(sb, exported).length, "rows under the exported root").toBe(k);
      expect(sandboxLedgerRows(sb).length, "none under the cwd, which also holds a manifest").toBe(0);
    } finally {
      reap(sb);
    }
  }, 60_000);

  test("nowhere to bind ⇒ the fence refuses BEFORE its first spawn — no child, no append, no guess", () => {
    expect(f, "a runnable /smoke-test spawn fence").toBeDefined();
    const sb = makeSandbox("delegate");
    try {
      // A bare dir: no manifest here, no checkout beside it.
      const nowhere = join(sb.root, "nowhere", "dpt-test-project-linear");
      mkdirSync(nowhere, { recursive: true });
      const run = runScript(sb, smokeScript(f!, sb, "linear"), baseEnv(sb), 60_000, nowhere);
      expect(run.exitCode).not.toBe(0);
      expect(run.err).toContain("ABORT: /smoke-test cannot resolve the toolkit checkout");
      expect(readCalls(sb).filter((c) => c.kind === "claude").length, "no child was spawned").toBe(0);
      expect(appendsIn(readCalls(sb)).length, "no append was attempted").toBe(0);
      expect(run.out, "no count line: the fence never reached its spawns").not.toMatch(/launched=/);
    } finally {
      reap(sb);
    }
  }, 60_000);
});
