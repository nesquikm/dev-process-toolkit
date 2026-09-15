// M_4df444 / STE-594 — the Termination cleanup fence RUNS (AC.4 – AC.8).
//
// SAFETY: see tests/_ste594_harness.ts. These suites use its "delegate" mode:
//   * `claude` is a stub (argv + environment recorded, `exec -a claude
//     /bin/sleep 1.594`); a real claude never starts.
//   * `smoke_session_cleanup.ts` is ALWAYS the bun stub's. It records its argv
//     and which watched pids still answer `kill -0`, then exits
//     `STE594_CLEANUP_RC`. It deletes nothing, so no fence can reach a config
//     dir.
//   * `smoke_run_ledger.ts`, `smoke_verdict.ts` and `smoke_fixture_groups.ts`
//     run for real from this plugin's source, with cwd = <sandbox>/work and
//     HOME = <sandbox>/home. The stub refuses any argument naming the real
//     repo, and a guard fails the test if a run ledger appears in the real
//     repo's `.dpt/ledger/`.
//   * Every `/tmp/` path and the repo root in each fence are rebased into the
//     sandbox, and every fence runs from a file (`bash <file>`).
//
// ONE SCENARIO, in the order a live run produces its evidence:
//   1. the actual Phase A fence runs (ITER substituted, `set -u`) and starts one
//      stub child per spawned leg. Its ledger appends really run, into the
//      sandbox's `.dpt/ledger/`;
//   2. optionally, one runnable /smoke-test spawn fence per leg runs under the
//      environment that leg's child inherited (its grandchildren);
//   3. every child exits; then the verdict artifacts, rc-files, findings files,
//      the approval record and any live process for AC.5 / AC.8 are planted;
//   4. the actual Termination cleanup fence runs (`set -u`) with only what the
//      green probe also gets in scope: DATE, ITER, SELECTED_LEGS. Everything
//      else it needs, including this run's identity, it re-derives from what
//      Phase A left behind.
//
// A leg is CLEANED when a `--delete` cleanup call names it (`--leg <leg>`) or
// names every one of its recorded session ids. It is TOUCHED when any
// `--delete` call names it or any of its ids. A dry run (no `--delete`) deletes
// nothing and is allowed anywhere.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import { label, spawnLineIndices, type Fence } from "./_spawn_fences";
import {
  alive,
  assertRealLedgerUntouched,
  baseEnv,
  envOf,
  inheritedDelta,
  makeSandbox,
  PHASE_A_ENV,
  phaseAScript,
  pidfilePids,
  readCalls,
  realLedgerTree,
  reap,
  rebase,
  REGISTERED_LEGS,
  runScript,
  sandboxLedgerRows,
  sessionIdOf,
  SMOKE_RUNNABLE,
  smokeScript,
  snapshotPidfiles,
  spawnLive,
  terminationCleanupFence,
  today,
  trackerOf,
  unique,
  UUID_RE,
  waitDead,
  waitForKind,
  type Call,
  type FenceRun,
  type Sandbox,
} from "./_ste594_harness";

const [L0, L1, L2] = SMOKE_LEGS as readonly string[] as [string, string, string];

// ===========================================================================
// The scenario.
// ===========================================================================

type Verdict = "pass" | "fail" | "abort" | "missing" | "malformed" | "unreadable";

interface LiveSpec {
  leg: string;
  /** "smoke": a /smoke-test per-skill pidfile (what orphan adoption scans); "loop": the leg's Phase A pidfile. */
  kind: "smoke" | "loop";
  seconds: number;
}

interface ScenarioOpts {
  selected: readonly string[];
  /** Legs Phase A spawns (default: the selection). */
  spawned?: readonly string[];
  verdicts: Partial<Record<string, Verdict>>;
  rc?: Partial<Record<string, string>>;
  grandchildren?: boolean;
  live?: readonly LiveSpec[];
  cleanupRc?: number;
  timeoutMs?: number;
}

interface Scenario {
  sb: Sandbox;
  guard: Set<string>;
  date: string;
  iter: string;
  phaseA?: FenceRun;
  children: Record<string, string>;
  grandchildren: Record<string, string[]>;
  /** leg → every recorded session id (child + grandchildren). */
  sessions: Record<string, string[]>;
  live: Array<LiveSpec & { pid: number; pidfile: string }>;
  planted: Map<string, string>;
  pidfilesBefore: Map<string, string>;
  run?: FenceRun;
  cleanups: Call[];
  deletes: Call[];
  output: string;
}

function requireTerm(): Fence {
  const f = terminationCleanupFence();
  if (f === undefined) {
    throw new Error(
      "no single fence inside § Termination (after the green probe, before § Closing summary) calls " +
        "`bun …/smoke_session_cleanup.ts … --delete` — the fence AC-STE-594.4–.8 execute does not exist",
    );
  }
  return f;
}

function requireGrandchildFence(): Fence {
  const f = SMOKE_RUNNABLE[0];
  if (f === undefined) throw new Error("no runnable /smoke-test spawn fence to run as grandchildren");
  return f;
}

function plantVerdict(sb: Sandbox, leg: string, v: Verdict): void {
  const p = join(sb.tmp, `dpt-smoke-verdict-${leg}.json`);
  rmSync(p, { recursive: true, force: true });
  switch (v) {
    case "pass":
      writeFileSync(p, `${JSON.stringify({ outcome: "pass" }, null, 2)}\n`);
      break;
    case "fail":
    case "abort":
      writeFileSync(p, `${JSON.stringify({ outcome: v, trigger: "ste594 fixture" }, null, 2)}\n`);
      break;
    case "malformed":
      writeFileSync(p, "{ this is not a verdict\n");
      break;
    case "unreadable":
      mkdirSync(p); // a directory at the artifact path reads `unreadable`
      break;
    case "missing":
      break;
  }
}

function dispose(s: Scenario): void {
  try {
    reap(s.sb);
  } finally {
    assertRealLedgerUntouched(s.guard);
  }
}

function runScenario(o: ScenarioOpts): Scenario {
  const term = requireTerm();
  const sb = makeSandbox("delegate");
  const s: Scenario = {
    sb,
    guard: realLedgerTree(),
    date: today(),
    iter: unique("ste594x"),
    children: {},
    grandchildren: {},
    sessions: {},
    live: [],
    planted: new Map(),
    pidfilesBefore: new Map(),
    cleanups: [],
    deletes: [],
    output: "",
  };
  try {
    // 1. Phase A.
    const spawned = o.spawned ?? o.selected;
    const loopEnv = baseEnv(sb, { ...PHASE_A_ENV, SELECTED_LEGS: spawned.join(" ") });
    s.phaseA = runScript(sb, phaseAScript(sb, s.iter), loopEnv);
    const kids = waitForKind(sb, "claude", spawned.length).filter((c) => c.kind === "claude");
    if (kids.length !== spawned.length) {
      throw new Error(`precondition: Phase A started ${kids.length} of ${spawned.length} stub children\n--- stdout ---\n${s.phaseA.out}\n--- stderr ---\n${s.phaseA.err}`);
    }
    for (const c of kids) {
      const leg = trackerOf(c.args);
      const sid = sessionIdOf(c.args) ?? "";
      if (!UUID_RE.test(sid)) throw new Error(`precondition: the ${leg} child carries no --session-id <uuid>: ${c.args}`);
      s.children[leg] = sid;
      s.sessions[leg] = [sid];
    }
    waitDead([...kids.map((c) => c.pid), ...pidfilePids(sb)]);

    // 2. Grandchildren, under the environment each child inherited.
    if (o.grandchildren) {
      const f = requireGrandchildFence();
      const n = spawnLineIndices(f).length;
      for (const c of kids) {
        const leg = trackerOf(c.args);
        const delta = inheritedDelta(envOf(sb, c.pid) ?? {}, loopEnv);
        const from = readCalls(sb).length;
        runScript(sb, smokeScript(f, sb, leg), { ...baseEnv(sb), ...delta });
        const g = waitForKind(sb, "claude", n, from).filter((x) => x.kind === "claude");
        s.grandchildren[leg] = g.map((x) => sessionIdOf(x.args) ?? "").filter((x) => x !== "");
        s.sessions[leg] = [...(s.sessions[leg] ?? []), ...s.grandchildren[leg]!];
        waitDead(g.map((x) => x.pid));
      }
    }

    // 3. The evidence Termination reads, and what it must leave alone.
    for (const leg of REGISTERED_LEGS) {
      const v = o.verdicts[leg];
      if (v !== undefined) plantVerdict(sb, leg, v);
    }
    for (const [leg, rc] of Object.entries(o.rc ?? {})) {
      writeFileSync(join(sb.tmp, `dpt-conformance-loop-${s.date}-iter-${s.iter}-${leg}.rc`), `${rc}\n`);
    }
    for (const leg of REGISTERED_LEGS) {
      const p = join(sb.tmp, `dpt-smoke-findings-${s.date}-${leg}.md`);
      const body = `# /smoke-test findings — ${leg}\n\n### F1 — ste594 fixture\n\n**Severity:** medium\n`;
      writeFileSync(p, body);
      s.planted.set(p, body);
    }
    const approval = join(sb.tmp, `dpt-conformance-loop-${s.date}-approval.txt`);
    const approvalBody = "approved\npermissions_allow_present\nspawn_pattern_allow_present\n";
    writeFileSync(approval, approvalBody);
    s.planted.set(approval, approvalBody);
    for (const l of o.live ?? []) {
      const pid = spawnLive(sb, l.seconds);
      const pidfile =
        l.kind === "smoke"
          ? join(sb.tmp, `dpt-smoke-${l.leg}-implement.pid`)
          : join(sb.tmp, `dpt-conformance-loop-${s.date}-iter-${s.iter}-${l.leg}.pid`);
      writeFileSync(pidfile, `${pid}\n`);
      s.live.push({ ...l, pid, pidfile });
    }
    s.pidfilesBefore = snapshotPidfiles(sb);

    // 4. The Termination cleanup fence.
    const script = `set -u\n${rebase(term.body.replace(/^ITER=<N>$/m, `ITER=${s.iter}`), sb)}\n`;
    s.run = runScript(
      sb,
      script,
      baseEnv(sb, {
        DATE: s.date,
        ITER: s.iter,
        SELECTED_LEGS: o.selected.join(" "),
        STE594_WATCH_PIDS: s.live.map((l) => String(l.pid)).join(" "),
        STE594_CLEANUP_RC: String(o.cleanupRc ?? 0),
      }),
      o.timeoutMs ?? 45_000,
    );
    s.cleanups = readCalls(sb).filter((c) => c.kind === "cleanup");
    s.deletes = s.cleanups.filter((c) => /(?:^|\s)--delete(?:\s|$)/.test(c.args));
    s.output = `${s.run.out}\n${s.run.err}`;
    return s;
  } catch (e) {
    dispose(s);
    throw e;
  }
}

// ===========================================================================
// Reading a scenario.
// ===========================================================================

function namesLeg(args: string, leg: string): boolean {
  return new RegExp(`(?:^|\\s)--leg(?:=|\\s+)["']?${leg}["']?(?![A-Za-z0-9_-])`).test(args);
}

function cleaned(s: Scenario, leg: string): boolean {
  const sids = s.sessions[leg] ?? [];
  if (s.deletes.some((d) => namesLeg(d.args, leg))) return true;
  return sids.length > 0 && sids.every((sid) => s.deletes.some((d) => d.args.includes(sid)));
}

function touched(s: Scenario, leg: string): boolean {
  const sids = s.sessions[leg] ?? [];
  return s.deletes.some((d) => namesLeg(d.args, leg) || sids.some((sid) => d.args.includes(sid)));
}

function deletesFor(s: Scenario, leg: string): Call[] {
  const sids = s.sessions[leg] ?? [];
  return s.deletes.filter((d) => namesLeg(d.args, leg) || sids.some((sid) => d.args.includes(sid)));
}

/** A `smoke_session_cleanup … --delete` command in the output that names the leg (or all its ids), within a 4-line window. */
function namesManualCleanup(s: Scenario, leg: string): boolean {
  const sids = s.sessions[leg] ?? [];
  const lines = s.output.split("\n");
  const word = new RegExp(`(?:^|[^A-Za-z0-9_-])${leg}(?![A-Za-z0-9_-])`);
  return lines.some((l, i) => {
    if (!l.includes("smoke_session_cleanup")) return false;
    const w = lines.slice(Math.max(0, i - 1), i + 3).join(" ");
    return /--delete\b/.test(w) && (word.test(w) || (sids.length > 0 && sids.every((sid) => w.includes(sid))));
  });
}

function expectScoped(s: Scenario): void {
  for (const d of s.deletes) {
    expect(d.args, "a delete call scoped to recorded sessions (--session / --leg)").toMatch(/(?:^|\s)--(?:session|leg)\b/);
    expect(d.args, "a delete call must never fall back to a time window").not.toMatch(/(?:^|\s)--(?:since|until)\b/);
  }
}

function dump(s: Scenario): string {
  return [
    `sessions: ${JSON.stringify(s.sessions)}`,
    `cleanup calls:\n${s.cleanups.map((c) => `  ${c.args}   [alive=${c.alive.join(",")}]`).join("\n") || "  (none)"}`,
    `termination exit=${s.run?.exitCode} elapsed=${s.run?.elapsedMs}ms timedOut=${s.run?.timedOut}`,
    `--- termination stdout ---\n${(s.run?.out ?? "").slice(-3000)}`,
    `--- termination stderr ---\n${(s.run?.err ?? "").slice(-3000)}`,
  ].join("\n");
}

function scenario(o: ScenarioOpts, body: (s: Scenario) => void): void {
  const s = runScenario(o);
  try {
    body(s);
  } finally {
    dispose(s);
  }
}

const allOf = (v: Verdict): Record<string, Verdict> => Object.fromEntries(SMOKE_LEGS.map((l) => [l, v]));

// ===========================================================================
// CONTROL — the harness itself.
// ===========================================================================

describe("CONTROL — the delegate sandbox", () => {
  test("the actual Phase A fence runs in it and starts one stub child per registered leg, each carrying its --session-id", () => {
    const sb = makeSandbox("delegate");
    const guard = realLedgerTree();
    try {
      const run = runScript(sb, phaseAScript(sb, unique("ste594c")), baseEnv(sb, { ...PHASE_A_ENV, SELECTED_LEGS: REGISTERED_LEGS.join(" ") }));
      const kids = waitForKind(sb, "claude", REGISTERED_LEGS.length).filter((c) => c.kind === "claude");
      expect(kids.map((c) => trackerOf(c.args)).sort(), `stdout:\n${run.out}\nstderr:\n${run.err}`).toEqual([...REGISTERED_LEGS].sort());
      expect(readCalls(sb).filter((c) => c.kind === "refused"), "no delegated call named the real repo").toEqual([]);
    } finally {
      reap(sb);
      assertRealLedgerUntouched(guard);
    }
  }, 60_000);

  test("SMOKE_LEGS and the Phase A groups name the same legs, so one case per SMOKE_LEGS leg runs below", () => {
    expect([...REGISTERED_LEGS].sort()).toEqual([...SMOKE_LEGS].sort());
  });
});

// ===========================================================================
// AC-STE-594.7 — pass vs fail, one case per SMOKE_LEGS leg.
// ===========================================================================

describe("AC-STE-594.7 — the actual Termination fence gives opposite outcomes for a pass and a fail artifact", () => {
  for (const leg of SMOKE_LEGS) {
    const others = SMOKE_LEGS.filter((l) => l !== leg);

    test(`${leg}=pass (rc-file 64), partners fail (rc-file 0): ${leg} is cleaned through --delete, each partner kept and named with its manual cleanup command`, () => {
      scenario(
        {
          selected: SMOKE_LEGS,
          verdicts: { ...allOf("fail"), [leg]: "pass" },
          rc: { ...Object.fromEntries(others.map((o) => [o, "0"])), [leg]: "64" },
        },
        (s) => {
          expect(cleaned(s, leg), `${leg} should be cleaned\n${dump(s)}`).toBe(true);
          for (const o of others) {
            expect(touched(s, o), `${o} (fail) must not be touched\n${dump(s)}`).toBe(false);
            expect(namesManualCleanup(s, o), `${o} must be named with its manual cleanup command\n${dump(s)}`).toBe(true);
          }
          expectScoped(s);
        },
      );
    }, 90_000);

    test(`${leg}=fail (rc-file 0), partners pass (rc-file 64): the opposite — ${leg} kept and named, each partner cleaned`, () => {
      scenario(
        {
          selected: SMOKE_LEGS,
          verdicts: { ...allOf("pass"), [leg]: "fail" },
          rc: { ...Object.fromEntries(others.map((o) => [o, "64"])), [leg]: "0" },
        },
        (s) => {
          expect(touched(s, leg), `${leg} (fail) must not be touched\n${dump(s)}`).toBe(false);
          expect(namesManualCleanup(s, leg), `${leg} must be named with its manual cleanup command\n${dump(s)}`).toBe(true);
          for (const o of others) expect(cleaned(s, o), `${o} (pass) should be cleaned\n${dump(s)}`).toBe(true);
          expectScoped(s);
        },
      );
    }, 90_000);
  }
});

// ===========================================================================
// AC-STE-594.4 — only a pass ARTIFACT cleans, only the selection, and the survivor check.
// ===========================================================================

describe("AC-STE-594.4 — a non-pass or absent verdict deletes nothing of its leg", () => {
  for (const v of ["abort", "missing", "malformed", "unreadable"] as const) {
    test(`a ${v} verdict for ${L0} deletes nothing of it and names its manual cleanup command (CONTROL: the passing partners ARE cleaned)`, () => {
      scenario({ selected: SMOKE_LEGS, verdicts: { ...allOf("pass"), [L0]: v }, rc: { [L0]: "0" } }, (s) => {
        expect(touched(s, L0), `${L0} (${v}) must not be touched\n${dump(s)}`).toBe(false);
        expect(namesManualCleanup(s, L0), `${L0} (${v}) must be named with its manual cleanup command\n${dump(s)}`).toBe(true);
        for (const o of [L1, L2]) expect(cleaned(s, o), `${o} (pass) should be cleaned\n${dump(s)}`).toBe(true);
      });
    }, 90_000);
  }

  test("the artifact decides, never the rc-file: a pass artifact beside rc 1 is cleaned, a fail artifact beside rc 0 is kept", () => {
    scenario({ selected: [L0, L1], verdicts: { [L0]: "pass", [L1]: "fail" }, rc: { [L0]: "1", [L1]: "0" } }, (s) => {
      expect(cleaned(s, L0), dump(s)).toBe(true);
      expect(touched(s, L1), dump(s)).toBe(false);
    });
  }, 90_000);

  test("an unselected leg with a pass artifact and recorded sessions is untouched", () => {
    scenario({ selected: [L0, L1], spawned: SMOKE_LEGS, verdicts: allOf("pass") }, (s) => {
      expect(s.sessions[L2]?.length ?? 0, "control: the unselected leg really has recorded sessions").toBeGreaterThan(0);
      expect(touched(s, L2), `${L2} is not selected\n${dump(s)}`).toBe(false);
      expect(cleaned(s, L0), dump(s)).toBe(true);
      expect(cleaned(s, L1), dump(s)).toBe(true);
    });
  }, 90_000);

  test("a delete that exits non-zero naming a survivor does not pass the survivor check: the leg is named with its manual cleanup command", () => {
    scenario({ selected: [L0], verdicts: { [L0]: "pass" }, cleanupRc: 1 }, (s) => {
      expect(deletesFor(s, L0).length, `control: the delete was attempted\n${dump(s)}`).toBeGreaterThan(0);
      expect(namesManualCleanup(s, L0), `a leg whose delete left a survivor must stay on the manual list\n${dump(s)}`).toBe(true);
    });
  }, 90_000);

  test("every delete is scoped to the leg's recorded sessions, never to a time window", () => {
    scenario({ selected: SMOKE_LEGS, verdicts: allOf("pass") }, (s) => {
      expect(s.deletes.length, dump(s)).toBeGreaterThan(0);
      expectScoped(s);
    });
  }, 90_000);
});

// ===========================================================================
// AC-STE-594.5 — cleanup waits for every recorded pid of its leg.
// ===========================================================================

describe("AC-STE-594.5 — Termination cleanup of a leg waits until none of its recorded pids answers kill -0", () => {
  for (const kind of ["smoke", "loop"] as const) {
    test(`a live pid in the leg's ${kind} pidfile that exits after ~2.5 s: the leg's delete runs, and only after that pid stopped answering`, () => {
      scenario({ selected: [L0], verdicts: { [L0]: "pass" }, live: [{ leg: L0, kind, seconds: 2.5 }] }, (s) => {
        const pid = String(s.live[0]!.pid);
        const d = deletesFor(s, L0);
        expect(d.length, `the leg was never cleaned\n${dump(s)}`).toBeGreaterThan(0);
        for (const c of d) expect(c.alive, `a delete ran while pid ${pid} still answered kill -0\n${dump(s)}`).not.toContain(pid);
      });
    }, 90_000);
  }

  test("a pid that outlives the fence: no delete of that leg ever runs while it answers, and the fence does not kill it to get through", () => {
    scenario({ selected: [L0], verdicts: { [L0]: "pass" }, live: [{ leg: L0, kind: "smoke", seconds: 40 }], timeoutMs: 20_000 }, (s) => {
      const pid = s.live[0]!.pid;
      for (const c of deletesFor(s, L0)) {
        expect(c.alive, `a delete ran while pid ${pid} still answered kill -0\n${dump(s)}`).not.toContain(String(pid));
      }
      expect(alive(pid), "the fence must wait for the leg's process, not reap it").toBe(true);
    });
  }, 90_000);
});

// ===========================================================================
// AC-STE-594.6 — findings and approval survive.
// ===========================================================================

describe("AC-STE-594.6 — every leg's findings file and the approval record survive Termination cleanup", () => {
  test("all legs pass and are cleaned; every findings file and the approval record are still there, byte-identical", () => {
    scenario({ selected: SMOKE_LEGS, verdicts: allOf("pass") }, (s) => {
      expect(s.deletes.length, `control: the cleanup really ran\n${dump(s)}`).toBeGreaterThan(0);
      for (const [p, body] of s.planted) {
        expect(existsSync(p), `${p} was removed`).toBe(true);
        expect(readFileSync(p, "utf-8"), `${p} was changed`).toBe(body);
      }
    });
  }, 90_000);
});

// ===========================================================================
// AC-STE-594.8 — the tandem fixture (and AC.3's scope, end to end).
// ===========================================================================

describe("AC-STE-594.8 — a passed leg's cleanup leaves a failed partner's sessions, pidfiles and processes untouched", () => {
  test(`${L0} passes, ${L1} fails with a live grandchild: ${L0} is cleaned with its grandchildren; ${L1} keeps everything; the fence does not wait on ${L1}`, () => {
    scenario(
      {
        selected: [L0, L1],
        verdicts: { [L0]: "pass", [L1]: "fail" },
        grandchildren: true,
        live: [{ leg: L1, kind: "smoke", seconds: 60 }],
        timeoutMs: 30_000,
      },
      (s) => {
        // AC.3 end to end: the grandchildren are in the run ledger, under the child's run and leg.
        const rows = sandboxLedgerRows(s.sb);
        for (const leg of [L0, L1]) {
          const childRow = rows.find((r) => r.session_id === s.children[leg]);
          expect(childRow, `${leg}: the child's ledger row\nrows: ${JSON.stringify(rows)}`).toBeDefined();
          expect(s.grandchildren[leg]?.length ?? 0, `${leg}: control — grandchildren ran`).toBeGreaterThan(0);
          for (const g of s.grandchildren[leg] ?? []) {
            const r = rows.find((x) => x.session_id === g);
            expect(r, `${leg}: grandchild ${g} has no ledger row\nrows: ${JSON.stringify(rows)}`).toBeDefined();
            expect(r!.leg, `${leg}: grandchild ${g}`).toBe(leg);
            expect(r!.run, `${leg}: grandchild ${g}`).toBe(childRow!.run);
          }
        }

        expect(s.run?.timedOut, `the fence waited on the failed partner's live process\n${dump(s)}`).toBe(false);
        expect(cleaned(s, L0), `${L0} (pass) should be cleaned, grandchildren included\n${dump(s)}`).toBe(true);
        expect(touched(s, L1), `${L1} (fail) sessions must not be touched\n${dump(s)}`).toBe(false);

        const partnerPidfiles = [...s.pidfilesBefore].filter(
          ([p]) => p.endsWith(`-${L1}.pid`) || p.includes(`/dpt-smoke-${L1}-`),
        );
        expect(partnerPidfiles.length, "control: the partner has pidfiles").toBeGreaterThan(0);
        for (const [p, body] of partnerPidfiles) {
          expect(existsSync(p), `${p} was removed`).toBe(true);
          expect(readFileSync(p, "utf-8"), `${p} was rewritten`).toBe(body);
        }
        expect(alive(s.live[0]!.pid), `${L1}'s live grandchild was signalled`).toBe(true);
      },
    );
  }, 120_000);
});

// Referenced so a reader can find every site the scenario runs.
void label;
