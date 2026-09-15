// STE-594 — the run ledger writer, `adapters/_shared/src/smoke_run_ledger.ts`.
//
// THE CONTRACT pinned here, which the spawn fences and the Termination cleanup
// rely on:
//
//   appendRunLedgerRow(file, { run, leg, session_id, parent? }) → RunLedgerRow
//     One row = one JSON line holding exactly {run, leg, session_id, parent,
//     spawned_at}, written in ONE O_APPEND write so rows from concurrent legs
//     never tear or interleave. It creates the ledger's directory and never
//     rewrites bytes already there. It refuses (throws, writes nothing) a
//     session id that is not a UUID, and a run or leg that is not a bare
//     [A-Za-z0-9][A-Za-z0-9_-]* token. The session id is stored exactly as
//     given, since macOS `uuidgen` prints upper case.
//   readRunLedger(file) → RunLedgerRow[]
//     A missing file gives []. Malformed, torn and id-less lines are skipped,
//     never thrown on.
//   legSessionIds(rows, run, leg) → string[]
//     One run's one leg: its children and grandchildren, deduplicated, in
//     ledger order.
//   CLI:  bun smoke_run_ledger.ts append --run <id> --leg <leg> --session <uuid>
//                                        [--parent <id>] [--project-root <dir>]
//     Writes to dpt_paths.smokeRunLedgerPath(<--project-root, default cwd>, <run>)
//     and exits 0. A refusal exits non-zero and writes nothing.
//
// Every root here is a mkdtemp sandbox, and the CLI runs with cwd and HOME
// inside it. Nothing reads or writes the real ~/.claude*, nor the repo's .dpt/.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as dptPaths from "./dpt_paths";
import { cwdToSlug } from "./find_current_session";
import { defaultProbes, runCleanup } from "./smoke_session_cleanup";
import { appendRunLedgerRow, legSessionIds, readRunLedger, type RunLedgerRow } from "./smoke_run_ledger";

const SCRIPT = join(import.meta.dir, "smoke_run_ledger.ts");
const RUN = "3f9c2a71-8b4e-4d15-a6c2-9e0b7d5f1a24";
const OTHER_RUN = "a1b2c3d4-0000-4000-8000-000000000594";

type Compose = (projectRoot: string, runId: string) => string;
function ledgerFor(root: string, run: string): string {
  const c = (dptPaths as unknown as Record<string, unknown>).smokeRunLedgerPath as Compose | undefined;
  expect(typeof c, "dpt_paths.ts exports smokeRunLedgerPath(projectRoot, runId)").toBe("function");
  return c!(root, run);
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function sandbox(): string {
  const d = mkdtempSync(join(tmpdir(), "ste594-ledger-"));
  tempRoots.push(d);
  return d;
}

function cli(cwd: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: cwd },
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

const lines = (file: string): string[] => readFileSync(file, "utf-8").split("\n").filter((l) => l !== "");

// ===========================================================================
// The row.
// ===========================================================================

describe("appendRunLedgerRow — one row, one complete line", () => {
  test("writes exactly {run, leg, session_id, parent, spawned_at} as one JSON line, and returns that row", () => {
    const dir = sandbox();
    const file = join(dir, "ledger", "run.jsonl");
    const sid = randomUUID();
    const row = appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: sid, parent: null });
    const text = readFileSync(file, "utf-8");
    expect(text.endsWith("\n")).toBe(true);
    expect(lines(file).length).toBe(1);
    const parsed = JSON.parse(text.trim()) as RunLedgerRow;
    expect(Object.keys(parsed).sort()).toEqual(["leg", "parent", "run", "session_id", "spawned_at"]);
    expect(parsed).toMatchObject({ run: RUN, leg: "linear", session_id: sid, parent: null });
    expect(new Date(parsed.spawned_at).toISOString()).toBe(parsed.spawned_at);
    expect(row).toEqual(parsed);
  });

  test("records the parent it is given (a grandchild names its child's session)", () => {
    const dir = sandbox();
    const file = join(dir, "run.jsonl");
    const child = randomUUID();
    const grand = randomUUID();
    appendRunLedgerRow(file, { run: RUN, leg: "jira", session_id: grand, parent: child });
    expect((JSON.parse(lines(file)[0]!) as RunLedgerRow).parent).toBe(child);
  });

  test("creates a missing ledger directory itself", () => {
    const dir = sandbox();
    const file = join(dir, "a", "b", "c", "run.jsonl");
    appendRunLedgerRow(file, { run: RUN, leg: "none", session_id: randomUUID() });
    expect(existsSync(file)).toBe(true);
  });

  test("appends, never rewrites: bytes already in the file stay a byte-identical prefix", () => {
    const dir = sandbox();
    const file = join(dir, "run.jsonl");
    const prefix = '{"foreign":"line written by someone else"}\n';
    writeFileSync(file, prefix);
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: randomUUID() });
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: randomUUID() });
    const text = readFileSync(file, "utf-8");
    expect(text.startsWith(prefix)).toBe(true);
    expect(lines(file).length).toBe(3);
  });

  test("accepts an upper-case UUID as macOS uuidgen prints it, and stores it verbatim", () => {
    const dir = sandbox();
    const file = join(dir, "run.jsonl");
    const sid = randomUUID().toUpperCase();
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: sid });
    expect((JSON.parse(lines(file)[0]!) as RunLedgerRow).session_id).toBe(sid);
  });

  const bad: Array<[string, { run: string; leg: string; session_id: string }]> = [
    ["a session id that is not a UUID", { run: RUN, leg: "linear", session_id: "not-a-uuid" }],
    ["an empty session id", { run: RUN, leg: "linear", session_id: "" }],
    ["a truncated UUID", { run: RUN, leg: "linear", session_id: "0F48AAB9-61E8-4F60-AFD4" }],
    ["an empty run", { run: "", leg: "linear", session_id: randomUUID() }],
    ["a run that escapes its directory", { run: "../escape", leg: "linear", session_id: randomUUID() }],
    ["a run carrying a slash", { run: "a/b", leg: "linear", session_id: randomUUID() }],
    ["an empty leg", { run: RUN, leg: "", session_id: randomUUID() }],
    ["a leg carrying a space", { run: RUN, leg: "li near", session_id: randomUUID() }],
  ];
  for (const [what, row] of bad) {
    test(`refuses ${what}, and writes nothing`, () => {
      const dir = sandbox();
      const file = join(dir, "ledger", "run.jsonl");
      expect(() => appendRunLedgerRow(file, row)).toThrow();
      expect(existsSync(file)).toBe(false);
    });
  }
});

describe("readRunLedger / legSessionIds — AC-STE-594.3's scope", () => {
  test("a missing ledger reads as no rows", () => {
    expect(readRunLedger(join(sandbox(), "absent.jsonl"))).toEqual([]);
  });

  test("malformed, id-less and torn lines are skipped, never thrown on", () => {
    const dir = sandbox();
    const file = join(dir, "run.jsonl");
    const sid = randomUUID();
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: sid });
    writeFileSync(file, `${readFileSync(file, "utf-8")}not json at all\n{"run":"${RUN}","leg":"linear"}\n{"run":"${RUN}","leg":"li`, { flag: "w" });
    const rows = readRunLedger(file);
    expect(rows.map((r) => r.session_id)).toEqual([sid]);
  });

  test("one run's one leg: children and grandchildren, deduplicated, in ledger order; never another leg's or another run's", () => {
    const dir = sandbox();
    const file = join(dir, "run.jsonl");
    const lChild = randomUUID();
    const lGrand1 = randomUUID();
    const lGrand2 = randomUUID();
    const jChild = randomUUID();
    const jGrand = randomUUID();
    const otherRun = randomUUID();
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: lChild, parent: null });
    appendRunLedgerRow(file, { run: RUN, leg: "jira", session_id: jChild, parent: null });
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: lGrand1, parent: lChild });
    appendRunLedgerRow(file, { run: OTHER_RUN, leg: "linear", session_id: otherRun, parent: null });
    appendRunLedgerRow(file, { run: RUN, leg: "jira", session_id: jGrand, parent: jChild });
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: lGrand2, parent: lChild });
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: lGrand1, parent: lChild }); // a duplicate row
    const rows = readRunLedger(file);
    expect(legSessionIds(rows, RUN, "linear")).toEqual([lChild, lGrand1, lGrand2]);
    expect(legSessionIds(rows, RUN, "jira")).toEqual([jChild, jGrand]);
    expect(legSessionIds(rows, RUN, "none")).toEqual([]);
    expect(legSessionIds(rows, OTHER_RUN, "linear")).toEqual([otherRun]);
  });
});

// ===========================================================================
// The CLI the fences call.
// ===========================================================================

describe("CLI — `append`", () => {
  test("--project-root writes to dpt_paths' run ledger for that run, with the parent it was given", () => {
    const dir = sandbox();
    const sid = randomUUID();
    const parent = randomUUID();
    const r = cli(dir, ["append", "--project-root", dir, "--run", RUN, "--leg", "jira", "--session", sid, "--parent", parent]);
    expect(r.code, r.out).toBe(0);
    const file = ledgerFor(dir, RUN);
    expect(existsSync(file), file).toBe(true);
    const row = JSON.parse(lines(file)[0]!) as RunLedgerRow;
    expect(row).toMatchObject({ run: RUN, leg: "jira", session_id: sid, parent });
  });

  test("with no --project-root the ledger lands under the current directory, never beside the module", () => {
    const dir = sandbox();
    const run = randomUUID();
    const sid = randomUUID();
    const r = cli(dir, ["append", "--run", run, "--leg", "linear", "--session", sid]);
    expect(r.code, r.out).toBe(0);
    const rows = readRunLedger(ledgerFor(dir, run));
    expect(rows.map((x) => x.session_id)).toEqual([sid]);
  });

  test("a refused append exits non-zero and writes nothing", () => {
    const dir = sandbox();
    const r = cli(dir, ["append", "--project-root", dir, "--run", RUN, "--leg", "linear", "--session", "not-a-uuid"]);
    expect(r.code).not.toBe(0);
    expect(existsSync(ledgerFor(dir, RUN))).toBe(false);
  });

  test("three legs appending concurrently: every row lands whole, none torn or interleaved", async () => {
    const dir = sandbox();
    const expected: Array<{ leg: string; sid: string }> = [];
    const procs = [];
    for (const leg of ["linear", "jira", "none"]) {
      for (let i = 0; i < 8; i++) {
        const sid = randomUUID();
        expected.push({ leg, sid });
        procs.push(
          Bun.spawn([process.execPath, SCRIPT, "append", "--project-root", dir, "--run", RUN, "--leg", leg, "--session", sid], {
            cwd: dir,
            env: { ...process.env, HOME: dir },
            stdout: "pipe",
            stderr: "pipe",
          }),
        );
      }
    }
    const codes = await Promise.all(procs.map((p) => p.exited));
    expect(codes.every((c) => c === 0), `exit codes: ${codes.join(",")}`).toBe(true);

    const file = ledgerFor(dir, RUN);
    const text = readFileSync(file, "utf-8");
    expect(text.endsWith("\n")).toBe(true);
    const ls = text.split("\n").filter((l) => l !== "");
    expect(ls.length).toBe(expected.length);
    for (const l of ls) {
      expect((l.match(/"session_id"/g) ?? []).length, `a line holding more than one row: ${l}`).toBe(1);
      expect(() => JSON.parse(l), `a torn line: ${l}`).not.toThrow();
    }
    const rows = readRunLedger(file);
    expect(rows.map((r) => `${r.leg}:${r.session_id}`).sort()).toEqual(expected.map((e) => `${e.leg}:${e.sid}`).sort());
    for (const leg of ["linear", "jira", "none"]) expect(legSessionIds(rows, RUN, leg).length).toBe(8);
  }, 60_000);
});

// ===========================================================================
// AC-STE-594.8 — the tandem, at module level: ledger → STE-593 delete.
// ===========================================================================

const iso = (ms: number) => new Date(ms).toISOString();

function transcript(cfg: string, cwd: string, sid: string, ms: number, leg: string): string {
  const body = [
    { type: "queue-operation", operation: "enqueue", timestamp: iso(ms), sessionId: sid },
    {
      type: "user",
      message: { role: "user", content: `/smoke-test --tracker ${leg}` },
      sessionId: sid,
      cwd,
      timestamp: iso(ms + 1000),
      entrypoint: "sdk-cli",
      uuid: randomUUID(),
      userType: "external",
      version: "2.1.268",
    },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");
  const p = join(cfg, "projects", cwdToSlug(cwd), `${sid}.jsonl`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${body}\n`);
  return p;
}

function sessionEnv(cfg: string, sid: string): string {
  const p = join(cfg, "session-env", sid);
  mkdirSync(p, { recursive: true });
  return p;
}

describe("AC-STE-594.8 — a passed leg's ledgered sessions go through the STE-593 delete; the failed partner's stay", () => {
  test("linear's child + grandchildren, read from the run ledger, are deleted; jira's sessions, another run's session, and the findings + approval files are byte-identical", async () => {
    const dir = sandbox();
    const home = join(dir, "home");
    const cfg = join(home, ".claude-st");
    const cache = join(home, "cache");
    const cmux = join(home, "cmux");
    const projectRoot = join(dir, "toolkit");
    const tmp = join(dir, "tmp");
    for (const d of [join(cfg, "sessions"), join(cfg, "projects"), cache, cmux, projectRoot, tmp]) mkdirSync(d, { recursive: true });

    const now = Date.now() - 60_000;
    const mk = (leg: string, cwd: string) => {
      const sid = randomUUID();
      return { sid, files: [transcript(cfg, cwd, sid, now, leg), sessionEnv(cfg, sid)] };
    };
    const linear = { child: mk("linear", projectRoot), grand: [mk("linear", join(dir, "dpt-test-project-linear")), mk("linear", join(dir, "dpt-test-project-linear"))] };
    const jira = { child: mk("jira", projectRoot), grand: [mk("jira", join(dir, "dpt-test-project-jira"))] };
    const otherRunLinear = mk("linear", projectRoot);

    const file = ledgerFor(projectRoot, RUN);
    appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: linear.child.sid, parent: null });
    appendRunLedgerRow(file, { run: RUN, leg: "jira", session_id: jira.child.sid, parent: null });
    for (const g of linear.grand) appendRunLedgerRow(file, { run: RUN, leg: "linear", session_id: g.sid, parent: linear.child.sid });
    for (const g of jira.grand) appendRunLedgerRow(file, { run: RUN, leg: "jira", session_id: g.sid, parent: jira.child.sid });
    appendRunLedgerRow(ledgerFor(projectRoot, OTHER_RUN), { run: OTHER_RUN, leg: "linear", session_id: otherRunLinear.sid, parent: null });

    const findings = join(tmp, "dpt-smoke-findings-2026-09-15-linear.md");
    const approval = join(tmp, "dpt-conformance-loop-2026-09-15-approval.txt");
    writeFileSync(findings, "# findings\n");
    writeFileSync(approval, "approved\n");

    const keep = [...jira.child.files, ...jira.grand.flatMap((g) => g.files), ...otherRunLinear.files, findings, approval];
    const before = new Map(keep.filter((p) => !p.includes("session-env")).map((p) => [p, readFileSync(p, "utf-8")]));

    const ids = legSessionIds(readRunLedger(file), RUN, "linear");
    expect(ids.sort()).toEqual([linear.child.sid, ...linear.grand.map((g) => g.sid)].sort());

    const r = await runCleanup({
      roots: { configDirs: [cfg], cacheRoot: cache, homeDir: home, cmuxDir: cmux, projectRoot },
      sessionIds: ids,
      delete: true,
      probes: { ...defaultProbes(), commandLines: () => [], isHeld: () => false },
    });
    expect(r.exitCode, r.output).toBe(0);

    for (const p of [...linear.child.files, ...linear.grand.flatMap((g) => g.files)]) {
      expect(existsSync(p), `${p} (linear, passed) should be gone\n${r.output}`).toBe(false);
    }
    for (const p of keep) expect(existsSync(p), `${p} was removed\n${r.output}`).toBe(true);
    for (const [p, body] of before) expect(readFileSync(p, "utf-8"), `${p} was changed`).toBe(body);
  }, 60_000);
});
