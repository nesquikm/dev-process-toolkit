// STE-825 (M_d1e7b1) fix round 1 — the amended ACs.
//
// AC-STE-825.1 (amended): the not-started carve-out gains a fourth leg — nothing
// shows the work began. `FrRef.startedBy?: readonly string[]` carries the evidence
// lines; absent ⇒ the carve-out never fires (fail closed), `[]` ⇒ the leg holds.
// The evidence comes from `workStartedEvidence(projectRoot, trackerId, frId?)` in
// `adapters/_shared/src/fr_work_started.ts`: one entry per run-start ledger row of
// /implement or /tdd naming the FR, and per commit in HEAD's history whose message
// names the tracker id and touches a path outside `specs/`. `readPlanTaskState`
// counts `- [X]` as checked too.
//
// AC-STE-825.4/.5 (amended): the commit gate reads every vouching run across every
// /gate-check window; the newest run with a recorded outcome decides, and a bare
// re-mint with no outcome never changes the verdict.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  bashCall,
  cleanupTemps,
  makeTree,
  mintRun,
  outcomeCommand,
  parseAnnouncement,
  receiptCommand,
  runCli,
  runHook,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
} from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;
const T = 120_000;

const TEMPS: string[] = [];
afterAll(() => {
  cleanupTemps();
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste825r1-${label}-`));
  TEMPS.push(d);
  return d;
}

async function predicate(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/active_ticket_drift_predicate")) as AnyMod;
}

async function started(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/fr_work_started")) as AnyMod;
}

async function lockMod(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/lock")) as AnyMod;
}

const TID = "STE-900";
const ME = "me@example.invalid";
const MAPPING = { initial: "backlog", in_progress: "in_progress", done: "done" };
const BACKLOG = { status: "backlog", assignee: null };

function plan(checkedTaskLines: string[]) {
  return { totalTasks: 3, uncheckedTasks: 1, planStatus: "active", checkedTaskLines };
}

// ------------------------------------------------------------ git helpers

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } as Record<string, string>;

function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", ["-c", "user.name=F", "-c", "user.email=f@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    env: GIT_ENV,
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

/** A fresh repo with a base commit naming no ticket. */
function repo(label: string): string {
  const root = join(scratch(label), "repo");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: base");
  return root;
}

/** Write each file, stage it, and commit with `message`. */
function commit(root: string, message: string, files: string[]): void {
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), `// ${f} ${Math.random()}\n`);
    git(root, "add", f);
  }
  git(root, "commit", "-q", "-m", message);
}

function runStartRow(skill: string, fr: string | null): string {
  return JSON.stringify({
    schema: "dpt-run-start/1",
    session_id: "s",
    skill,
    fr,
    started_at: "2026-11-18T00:00:00Z",
    settings_hash: null,
    settings: {},
    plugin_version: null,
    registration: null,
  });
}

function writeLedger(root: string, rows: string[]): void {
  mkdirSync(join(root, ".dpt", "ledger"), { recursive: true });
  writeFileSync(join(root, ".dpt", "ledger", "run-starts.jsonl"), rows.join("\n") + "\n");
}

// ===========================================================================
// AC-STE-825.1 (amended) — the started leg, fail closed
// ===========================================================================

describe("AC-STE-825.1 (amended) the started leg of the carve-out", () => {
  test("startedBy: [] with the other three legs holding → passes", async () => {
    const m = await predicate();
    expect(m.activeTicketDriftPasses(BACKLOG, plan([]), MAPPING, ME, { trackerId: TID, lockIds: [], startedBy: [] })).toBe(true);
  });

  test("startedBy absent → the carve-out never fires (fail closed)", async () => {
    const m = await predicate();
    expect(m.activeTicketDriftPasses(BACKLOG, plan([]), MAPPING, ME, { trackerId: TID, lockIds: [] })).toBe(false);
  });

  test("readPlanTaskState counts an uppercase `- [X]` line as checked and lists it", async () => {
    const { readPlanTaskState } = (await import("../adapters/_shared/src/plan_task_state")) as AnyMod;
    const specs = join(scratch("plan"), "specs");
    mkdirSync(join(specs, "plan"), { recursive: true });
    writeFileSync(join(specs, "plan", "M9.md"), "# M9\n\n- [X] STE-900 — upper\n- [ ] STE-901 — open\n- [x] STE-902 — lower\n");
    const s = await readPlanTaskState(specs, "M9");
    expect({ total: s.totalTasks, unchecked: s.uncheckedTasks, checked: s.checkedTaskLines }).toEqual({
      total: 3,
      unchecked: 1,
      checked: ["- [X] STE-900 — upper", "- [x] STE-902 — lower"],
    });
  });

  test("an uppercase `- [X]` line naming the FR fails the carve-out", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(BACKLOG, plan(["- [X] STE-900 — ticked"]), MAPPING, ME, { trackerId: TID, lockIds: [], startedBy: [] });
    expect(v).toBe(false);
  });
});

// ===========================================================================
// AC-STE-825.2 (amended) — one false condition each, and the refute repro
// ===========================================================================

describe("AC-STE-825.2 (amended) each single false condition fails the predicate", () => {
  test("status not initial → fails", async () => {
    const m = await predicate();
    expect(
      m.activeTicketDriftPasses({ status: "in_progress", assignee: "other@example.invalid" }, plan([]), MAPPING, ME, {
        trackerId: TID,
        lockIds: [],
        startedBy: [],
      }),
    ).toBe(false);
  });

  test("a checked task line names the tracker id → fails", async () => {
    const m = await predicate();
    expect(
      m.activeTicketDriftPasses(BACKLOG, plan(["- [x] STE-900 — ticked"]), MAPPING, ME, { trackerId: TID, lockIds: [], startedBy: [] }),
    ).toBe(false);
  });

  test("a lock names the FR → fails", async () => {
    const m = await predicate();
    expect(m.activeTicketDriftPasses(BACKLOG, plan([]), MAPPING, ME, { trackerId: TID, lockIds: [TID], startedBy: [] })).toBe(false);
  });

  test("startedBy non-empty → fails", async () => {
    const m = await predicate();
    expect(
      m.activeTicketDriftPasses(BACKLOG, plan([]), MAPPING, ME, {
        trackerId: TID,
        lockIds: [],
        startedBy: ["commit abc1234 feat: x"],
      }),
    ).toBe(false);
  });
});

describe("AC-STE-825.2 (amended) workStartedEvidence on real repos", () => {
  test("refute repro: a commit naming STE-900 that touches src/a.ts → the predicate is false", async () => {
    const root = repo("refute");
    commit(root, "feat: x\n\nRefs: STE-900", ["src/a.ts"]);
    const { workStartedEvidence } = await started();
    const { readLockIds } = await lockMod();
    const m = await predicate();
    const v = m.activeTicketDriftPasses(BACKLOG, plan([]), MAPPING, ME, {
      trackerId: TID,
      lockIds: readLockIds(root),
      startedBy: workStartedEvidence(root, TID),
    });
    expect(v).toBe(false);
  });

  test("refute repro: the evidence for that commit is one entry", async () => {
    const root = repo("refute-ev");
    commit(root, "feat: x\n\nRefs: STE-900", ["src/a.ts"]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(root, TID).length).toBe(1);
  });

  // Audit advisory (fix round 1): a project in a repo subdirectory reads its own specs/, not the repo root's.
  test("project in a repo subdirectory: its spec-only commit is not evidence, its code commit is", async () => {
    const root = repo("subdir");
    commit(root, "chore(specs): write FR STE-900\n\nRefs: STE-900", ["app/specs/frs/STE-900.md"]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(join(root, "app"), TID)).toEqual([]);
    commit(root, "feat: y\n\nRefs: STE-900", ["app/src/y.ts"]);
    expect(workStartedEvidence(join(root, "app"), TID).length).toBe(1);
  });

  test("a freshly written FR whose only commit touches specs/ → evidence [] and the predicate passes", async () => {
    const root = repo("fresh");
    commit(root, "chore(specs): write FR STE-900\n\nRefs: STE-900", ["specs/frs/STE-900.md"]);
    const { workStartedEvidence } = await started();
    const { readLockIds } = await lockMod();
    const ev = workStartedEvidence(root, TID);
    expect(ev).toEqual([]);
    const m = await predicate();
    expect(
      m.activeTicketDriftPasses(BACKLOG, plan([]), MAPPING, ME, { trackerId: TID, lockIds: readLockIds(root), startedBy: ev }),
    ).toBe(true);
  });

  test("a commit naming STE-9000 is not evidence for STE-900", async () => {
    const root = repo("longer");
    commit(root, "feat: y\n\nRefs: STE-9000", ["src/b.ts"]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });

  test("a tdd run-start row naming STE-900 → non-empty evidence", async () => {
    const root = repo("ledger-tdd");
    writeLedger(root, [runStartRow("dev-process-toolkit:tdd", "STE-900")]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(root, TID).length).toBe(1);
  });

  test("an implement run-start row naming the frId → non-empty evidence", async () => {
    const root = repo("ledger-impl");
    writeLedger(root, [runStartRow("dev-process-toolkit:implement", "fr_01ABC")]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(root, TID, "fr_01ABC").length).toBe(1);
  });

  test("a gate-check row naming STE-900 is not evidence", async () => {
    const root = repo("ledger-gate");
    writeLedger(root, [runStartRow("dev-process-toolkit:gate-check", "STE-900")]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });

  test("a tdd row naming another FR is not evidence", async () => {
    const root = repo("ledger-other");
    writeLedger(root, [runStartRow("dev-process-toolkit:tdd", "STE-901")]);
    const { workStartedEvidence } = await started();
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-825.4 / .5 (amended) — through the real hook, across windows
// ===========================================================================

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

function outcome(root: string, verdict: "pass" | "fail"): string[] {
  const o = runCli(["outcome", "gate-check", root, verdict]);
  expect({ code: o.exitCode, err: o.stderr }).toEqual({ code: 0, err: "" });
  expect(parseAnnouncement(o.stdout.split("\n")[0] ?? "", "dpt-gate-outcome: ")).not.toBeNull();
  return bashCall(uid("o"), outcomeCommand("gate-check", root, verdict), o.stdout);
}

function runRecords(root: string, run: ReturnType<typeof mintRun>): string[] {
  return bashCall(uid("r"), receiptCommand("gate-check", root), run.run.stdout);
}

function checkout(label: string): string {
  const root = makeTree(label, "on");
  stageCodeAndTest(root);
  return root;
}

describe("AC-STE-825.4/.5 (amended) the newest run with an outcome decides", () => {
  test("(A) window 1 pass, window 2 fail → exit 2", async () => {
    const root = checkout("a-pass-fail");
    const run1 = mintRun(root);
    const out1 = outcome(root, "pass");
    const run2 = mintRun(root);
    const out2 = outcome(root, "fail");
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, run1),
      ...out1,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, run2),
      ...out2,
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(B) window 1 fail, window 2 pass → exit 0, empty stderr", async () => {
    const root = checkout("b-fail-pass");
    const run1 = mintRun(root);
    const out1 = outcome(root, "fail");
    const run2 = mintRun(root);
    const out2 = outcome(root, "pass");
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, run1),
      ...out1,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, run2),
      ...out2,
    ]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(C) one window: fail, then a bare re-mint with no outcome → exit 2", async () => {
    const root = checkout("c-fail-remint");
    const run1 = mintRun(root);
    const out1 = outcome(root, "fail");
    const run2 = mintRun(root);
    const tr = writeTranscript(tempDir("tr"), [...skillCall("gate", "sk1"), ...runRecords(root, run1), ...out1, ...runRecords(root, run2)]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(D) one window: pass, then a bare re-mint with no outcome → exit 0", async () => {
    const root = checkout("d-pass-remint");
    const run1 = mintRun(root);
    const out1 = outcome(root, "pass");
    const run2 = mintRun(root);
    const tr = writeTranscript(tempDir("tr"), [...skillCall("gate", "sk1"), ...runRecords(root, run1), ...out1, ...runRecords(root, run2)]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(E) window 1 fail, window 2 bare re-mint with no outcome → exit 2", async () => {
    const root = checkout("e-fail-window-remint");
    const run1 = mintRun(root);
    const out1 = outcome(root, "fail");
    const run2 = mintRun(root);
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, run1),
      ...out1,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, run2),
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);
});
