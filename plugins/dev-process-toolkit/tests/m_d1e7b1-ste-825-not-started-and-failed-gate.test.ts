// STE-825 (M_d1e7b1) — probe #14 passes a ticket that is provably not started,
// and the commit gate refuses a commit whose vouching gate run recorded `fail`.
//
// Call shape driven here (AC-STE-825.1):
//
//   activeTicketDriftPasses(summary, planTaskState, statusMapping, currentUser, frRef?)
//
//   - `statusMapping.initial`        — the tracker status the `initial` role maps to
//   - `planTaskState.checkedTaskLines` — every `- [x]` task line of the FR's plan,
//                                       filled by `readPlanTaskState`
//   - `frRef = { trackerId, lockIds, startedBy }` — the FR's tracker id, the ids held
//                                       in the lock store (`readLockIds`, `lock.ts`),
//                                       and the evidence that work began
//                                       (`workStartedEvidence`, `fr_work_started.ts`)
//
// The not-started carve-out (`notStartedExempt`) passes only when the status is
// the initial one, no checked task line names the tracker id, no lock id names
// the FR, and `startedBy` is supplied and empty. Without `frRef` or `startedBy`
// nothing is provable, so it never fires. Amended by AC-STE-825.1 (M_d1e7b1)

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const PLUGIN_ROOT = join(import.meta.dir, "..");

const TEMPS: string[] = [];
afterAll(() => {
  cleanupTemps();
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste825-${label}-`));
  TEMPS.push(d);
  return d;
}

async function predicate(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/active_ticket_drift_predicate")) as AnyMod;
}

const TRACKER_ID = "STE-825";
const ME = "me@example.invalid";
const MAPPING = { initial: "backlog", in_progress: "in_progress", done: "done" };

/** A plan with work left, one checked line naming someone else, one unchecked naming this FR. */
function plan(checkedTaskLines: string[]) {
  return { totalTasks: 3, uncheckedTasks: 1, planStatus: "active", checkedTaskLines };
}

const OTHER_CHECKED = ["- [x] STE-824 — the sibling FR ships first"];

// ===========================================================================
// AC-STE-825.1 — the not-started carve-out
// ===========================================================================

describe("AC-STE-825.1 the not-started carve-out", () => {
  test("backlog ticket, no checked line naming the FR, no lock naming it → passes", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(
      { status: "backlog", assignee: null },
      plan(OTHER_CHECKED),
      MAPPING,
      ME,
      { trackerId: TRACKER_ID, startedBy: [], lockIds: ["STE-824"] }, // Amended by AC-STE-825.1 (M_d1e7b1)
    );
    expect(v).toBe(true);
  });

  test("notStartedExempt is exported and fires for the same evidence", async () => {
    const m = await predicate();
    expect(typeof m.notStartedExempt).toBe("function");
    expect(
      m.notStartedExempt({ status: "backlog", assignee: null }, plan(OTHER_CHECKED), MAPPING, {
        trackerId: TRACKER_ID,
        startedBy: [], lockIds: [], // Amended by AC-STE-825.1 (M_d1e7b1)
      }),
    ).toBe(true);
  });

  // Added after Stage B review: both boundaries of the id match, and a lock filed under the FR's own id.
  for (const line of ["- [x] fix-STE-825 landed", "- [x] STE-825-2 follow-up", "- [x] (STE-825)"]) {
    test(`a checked line \`${line}\` names STE-825 → fails`, async () => {
      const m = await predicate();
      const v = m.activeTicketDriftPasses({ status: "backlog", assignee: null }, plan([line]), MAPPING, ME, { trackerId: TRACKER_ID, startedBy: [], lockIds: [] }); // Amended by AC-STE-825.1 (M_d1e7b1)
      expect(v).toBe(false);
    });
  }

  test("a lock filed under the FR's own id (not the tracker id) names the FR → fails", async () => {
    const m = await predicate();
    const ref = { trackerId: TRACKER_ID, frId: "fr_01ABC", startedBy: [], lockIds: ["fr_01ABC"] }; // Amended by AC-STE-825.1 (M_d1e7b1)
    expect(m.activeTicketDriftPasses({ status: "backlog", assignee: null }, plan([]), MAPPING, ME, ref)).toBe(false);
    expect(m.activeTicketDriftPasses({ status: "backlog", assignee: null }, plan([]), MAPPING, ME, { ...ref, lockIds: ["fr_01XYZ"] })).toBe(true);
  });

  test("a checked line naming a longer id (STE-8250) does not name STE-825", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(
      { status: "backlog", assignee: null },
      plan(["- [x] STE-8250 — a different ticket"]),
      MAPPING,
      ME,
      { trackerId: TRACKER_ID, startedBy: [], lockIds: [] }, // Amended by AC-STE-825.1 (M_d1e7b1)
    );
    expect(v).toBe(true);
  });

  test("the initial status is read from the mapping, not hard-coded", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(
      { status: "unstarted", assignee: null },
      plan([]),
      { initial: "unstarted", in_progress: "in_progress", done: "done" },
      ME,
      { trackerId: TRACKER_ID, startedBy: [], lockIds: [] }, // Amended by AC-STE-825.1 (M_d1e7b1)
    );
    expect(v).toBe(true);
  });

  test("without the FR reference nothing is provable, so a backlog ticket still fails", async () => {
    const m = await predicate();
    expect(m.activeTicketDriftPasses({ status: "backlog", assignee: null }, plan([]), MAPPING, ME)).toBe(false);
  });

  test("readPlanTaskState returns the checked task lines of the plan", async () => {
    const { readPlanTaskState } = (await import("../adapters/_shared/src/plan_task_state")) as AnyMod;
    const specs = join(scratch("plan"), "specs");
    mkdirSync(join(specs, "plan"), { recursive: true });
    writeFileSync(
      join(specs, "plan", "M9.md"),
      "# M9\n\n- [x] STE-824 — done one\n- [ ] STE-825 — waiting\n- a prose bullet\n- [x] STE-826 — done two\n",
    );
    const s = await readPlanTaskState(specs, "M9");
    expect(s.checkedTaskLines).toEqual(["- [x] STE-824 — done one", "- [x] STE-826 — done two"]);
  });

  test("readLockIds lists the ids held in .dpt/locks/, and [] when the store is absent", async () => {
    const lock = (await import("../adapters/_shared/src/lock")) as AnyMod;
    expect(typeof lock.readLockIds).toBe("function");
    const root = scratch("locks");
    expect(lock.readLockIds(root)).toEqual([]);
    mkdirSync(join(root, ".dpt", "locks"), { recursive: true });
    writeFileSync(join(root, ".dpt", "locks", "STE-825"), "branch: feat/x\n");
    writeFileSync(join(root, ".dpt", "locks", "fr_01ABC"), "branch: feat/y\n");
    expect([...lock.readLockIds(root)].sort()).toEqual(["STE-825", "fr_01ABC"]);
  });
});

// ===========================================================================
// AC-STE-825.2 — each single false condition keeps the drift failure
// ===========================================================================

describe("AC-STE-825.2 one false condition keeps the existing drift failure", () => {
  test("status not initial (in progress under someone else) → fails", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(
      { status: "in_progress", assignee: "other@example.invalid" },
      plan(OTHER_CHECKED),
      MAPPING,
      ME,
      { trackerId: TRACKER_ID, startedBy: [], lockIds: [] }, // Amended by AC-STE-825.1 (M_d1e7b1)
    );
    expect(v).toBe(false);
  });

  test("a checked task line names the FR's tracker id → fails", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(
      { status: "backlog", assignee: null },
      plan([...OTHER_CHECKED, "- [x] STE-825 — the work is already ticked"]),
      MAPPING,
      ME,
      { trackerId: TRACKER_ID, startedBy: [], lockIds: [] }, // Amended by AC-STE-825.1 (M_d1e7b1)
    );
    expect(v).toBe(false);
  });

  test("a lock entry names the FR → fails", async () => {
    const m = await predicate();
    const v = m.activeTicketDriftPasses(
      { status: "backlog", assignee: null },
      plan(OTHER_CHECKED),
      MAPPING,
      ME,
      { trackerId: TRACKER_ID, startedBy: [], lockIds: ["STE-824", TRACKER_ID] }, // Amended by AC-STE-825.1 (M_d1e7b1)
    );
    expect(v).toBe(false);
  });
});

// ===========================================================================
// AC-STE-825.3 — probe #14 prose
// ===========================================================================

function probe14Block(): string {
  const body = readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf8");
  const idx = body.search(/14\.\s+\*\*Ticket-state drift.*active/i);
  expect(idx).toBeGreaterThan(-1);
  const next = body.indexOf("\n15.", idx);
  return body.slice(idx, next > 0 ? next : undefined);
}

describe("AC-STE-825.3 probe #14 truth table and provenance", () => {
  test("the truth table gains a not-started row that passes on the initial status", () => {
    const rows = probe14Block()
      .split("\n")
      .filter((l) => /^\s*\|\s*active\s*\|/.test(l));
    const notStarted = rows.filter((l) => /initial/.test(l) && /\*\*pass\*\*/.test(l) && /not.started/i.test(l));
    expect(notStarted.length).toBe(1);
  });

  test("a pass through the carve-out is logged as carve_out: not_started", () => {
    expect(probe14Block()).toContain("carve_out: not_started");
  });
});

// ===========================================================================
// AC-STE-825.4 / .5 — the commit gate and a failed outcome
// ===========================================================================

function outcome(root: string, verdict: "pass" | "fail") {
  const o = runCli(["outcome", "gate-check", root, verdict]);
  expect({ code: o.exitCode, err: o.stderr }).toEqual({ code: 0, err: "" });
  expect(parseAnnouncement(o.stdout.split("\n")[0] ?? "", "dpt-gate-outcome: ")).not.toBeNull();
  return { stdout: o.stdout, records: bashCall(`o-${Math.random().toString(36).slice(2)}`, outcomeCommand("gate-check", root, verdict), o.stdout) };
}

function runRecords(root: string, run: ReturnType<typeof mintRun>): string[] {
  return bashCall(`r-${Math.random().toString(36).slice(2)}`, receiptCommand("gate-check", root), run.run.stdout);
}

describe("AC-STE-825.4 a fail outcome on the vouching run refuses the commit", () => {
  test("Skill call + announced run + fail outcome → exit 2 naming the run and the remedy", async () => {
    const root = makeTree("fail-out", "on");
    stageCodeAndTest(root);
    const run = mintRun(root);
    const digest = parseAnnouncement(run.line, "dpt-receipt: ")!.digest;
    const tr = writeTranscript(tempDir("tr"), [...skillCall("gate"), ...runRecords(root, run), ...outcome(root, "fail").records]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Refusing:");
    expect({ namesRun: r.stderr.includes(run.path) || r.stderr.includes(digest) }).toEqual({ namesRun: true });
    expect(r.stderr).toMatch(/\bfix\b/i);
    expect(r.stderr).toMatch(/re-run/i);
  }, T);

  test("CONTROL: with no outcome recorded the same session is permitted as before", async () => {
    const root = makeTree("no-out", "on");
    stageCodeAndTest(root);
    const run = mintRun(root);
    const tr = writeTranscript(tempDir("tr"), [...skillCall("gate"), ...runRecords(root, run)]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

describe("AC-STE-825.5 a later pass clears it; a foreign fail does not refuse", () => {
  test("fail is refused, then a later run with a pass outcome for the same checkout is permitted", async () => {
    const root = makeTree("pass-after", "on");
    stageCodeAndTest(root);
    const run1 = mintRun(root);
    const failed = [...skillCall("gate"), ...runRecords(root, run1), ...outcome(root, "fail").records];
    const refused = await runHook("gate", root, writeTranscript(tempDir("tr"), failed));
    expect(refused.exitCode).toBe(2);

    const run2 = mintRun(root);
    const cleared = [...failed, ...runRecords(root, run2), ...outcome(root, "pass").records];
    const r = await runHook("gate", root, writeTranscript(tempDir("tr"), cleared));
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  // Added by the orchestrator after the AC-STE-825.5 defect check: a plant that matched ANY run's
  // outcome (not the vouching run's digest) stayed GREEN. This pins the digest match: an older
  // run's fail does not refuse a newer vouching run that has no outcome of its own.
  test("an older run's fail still refuses: a bare re-mint with no outcome does not clear it", async () => { // Amended by AC-STE-825.4 (M_d1e7b1)
    const root = makeTree("older-fail", "on");
    stageCodeAndTest(root);
    const run1 = mintRun(root);
    const failed = outcome(root, "fail").records; // recorded against run1, the only run so far
    const run2 = mintRun(root);
    const tr = [...skillCall("gate"), ...runRecords(root, run1), ...failed, ...runRecords(root, run2)];
    const r = await runHook("gate", root, writeTranscript(tempDir("tr"), tr));
    expect(r.exitCode).toBe(2); // Amended by AC-STE-825.4 (M_d1e7b1)
  }, T);

  test("a fail recorded for checkout B refuses B but not checkout A", async () => {
    const a = makeTree("chk-a", "on");
    const b = makeTree("chk-b", "on");
    stageCodeAndTest(a);
    stageCodeAndTest(b);
    const runA = mintRun(a);
    const runB = mintRun(b);
    // One Skill call vouches for one checkout, so each checkout gets its own.
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk-a"),
      ...runRecords(a, runA),
      ...skillCall("gate", "sk-b"),
      ...runRecords(b, runB),
      ...outcome(b, "fail").records,
    ]);
    const rb = await runHook("gate", b, tr);
    expect(rb.exitCode).toBe(2);
    const ra = await runHook("gate", a, tr);
    expect({ code: ra.exitCode, err: ra.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

// ===========================================================================
// AC-STE-825.6 — the hooks reference
// ===========================================================================

/** The text under `heading`, up to the next `##`/`###` heading found past the heading's own line. */
function section(body: string, heading: string): string {
  const start = body.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const from = start + heading.length + 2;
  const rel = body.slice(from).search(/\n#{2,3} /);
  return body.slice(start, rel < 0 ? undefined : from + rel);
}

describe("AC-STE-825.6 docs/hooks-reference.md describes the failed-outcome refusal", () => {
  test("§ pre-commit-gate-check has a sentence on the gate-outcome fail refusal", () => {
    const body = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf8");
    const text = section(body, "### pre-commit-gate-check");
    const hits = text
      .split(/\n\s*\n/)
      .flatMap((p) => p.replace(/\n/g, " ").split(/(?<=[.!?])\s+/))
      .filter((s) => /gate-outcome/.test(s) && /\bfail\b/.test(s) && /(exit 2|refus)/i.test(s));
    expect(hits.length).toBeGreaterThan(0);
  });
});
