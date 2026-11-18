// STE-825 (M_d1e7b1) fix round 4 — the re-amended ACs, new parts.
//
// AC-STE-825.4 (amended): when gate outcomes are off for the checkout, no outcome,
// pending or unreadable call is graded, and the outcome command says it recorded
// nothing (Z1). A run minted by an uncounted receipt call does not let a later
// outcome slip past (Z2). A compound's every outcome segment is read (Z3). An
// announced outcome file later deleted or rewritten is unreadable (Z4). A segment
// runs the outcome verb when `bun` runs the front door, whatever path or flags
// spell `bun` (Z5).
//
// AC-STE-825.1 (amended): work reaching a branch through a merge commit naming the
// id counts through the merge's first-parent diff (Z6); a message carrying the
// field separator cannot forge the name list, and a non-ASCII spec path is still a
// spec path (Z7).

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  bashCall,
  cleanupTemps,
  FRONT_DOOR,
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
import { workStartedEvidence } from "../adapters/_shared/src/fr_work_started";

const T = 120_000;
const TID = "STE-900";

const TEMPS: string[] = [];
afterAll(() => {
  cleanupTemps();
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `ste825r4-${label}-`));
  TEMPS.push(d);
  return d;
}

// ------------------------------------------------------------ git helpers

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } as Record<string, string>;
delete GIT_ENV.GIT_DIR;
delete GIT_ENV.GIT_WORK_TREE;
delete GIT_ENV.GIT_INDEX_FILE;

function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", ["-c", "user.name=F", "-c", "user.email=f@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    env: GIT_ENV,
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

/** A fresh repo whose base commit is the FR's own spec (touches specs/ only). */
function repo(label: string): string {
  const root = join(scratch(label), "repo");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  commit(root, "docs(specs): write FR\n\nRefs: STE-900", ["specs/frs/STE-900.md"]);
  return root;
}

/** Write each file, stage it, and commit with `message` (passed via a file, so any byte survives). */
function commit(root: string, message: string, files: string[]): void {
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), `// ${f} ${Math.random()}\n`);
    git(root, "add", f);
  }
  const msgFile = join(scratch("msg"), "msg.txt");
  writeFileSync(msgFile, message);
  git(root, "commit", "-q", "-F", msgFile);
}

// ------------------------------------------------------ transcript helpers

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

interface Outcome {
  path: string;
  digest: string;
  stdout: string;
  records: string[];
}

/** Record `verdict` through the CLI and wrap it in a plain, counted outcome call. */
function outcome(root: string, verdict: "pass" | "fail", command = outcomeCommand("gate-check", root, verdict)): Outcome {
  const o = runCli(["outcome", "gate-check", root, verdict]);
  expect({ code: o.exitCode, err: o.stderr }).toEqual({ code: 0, err: "" });
  const ann = parseAnnouncement(o.stdout.split("\n")[0] ?? "", "dpt-gate-outcome: ");
  if (ann === null) throw new Error(`outcome CLI printed no announcement: ${o.stdout}`);
  return { ...ann, stdout: o.stdout, records: bashCall(uid("o"), command, o.stdout) };
}

function runRecords(root: string, run: ReturnType<typeof mintRun>, command = receiptCommand("gate-check", root)): string[] {
  return bashCall(uid("r"), command, run.run.stdout);
}

/** Only the tool_use half of a Bash call: the call ran, its result is not in the transcript yet. */
function pendingBashCall(id: string, command: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    }),
  ];
}

/** run1 with an announced, counted pass: on its own this admits the commit. */
function passedWindow(root: string): string[] {
  const r1 = mintRun(root);
  const p1 = outcome(root, "pass");
  return [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...p1.records];
}

function checkout(label: string, state: "on" | "false" | "absent" = "on"): string {
  const root = makeTree(label, state);
  stageCodeAndTest(root);
  return root;
}

async function hook(root: string, records: string[]) {
  return runHook("gate", root, writeTranscript(tempDir("tr"), records));
}

/** The door as the skill bodies spell it. */
const DOOR = '"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts"';

// ===========================================================================
// Z1 — gate outcomes off: nothing outcome-shaped is graded
// ===========================================================================

type OffCase = [string, (root: string) => string[]];

const OFF_CASES: OffCase[] = [
  [
    "(a) an honest plain outcome call, its CLI output recorded",
    (root) => {
      const o = runCli(["outcome", "gate-check", root, "pass"]);
      return bashCall(uid("o"), outcomeCommand("gate-check", root, "pass"), o.stdout);
    },
  ],
  [
    "(b) a heredoc that only mentions an outcome fail call",
    (root) =>
      bashCall(
        uid("h"),
        `cat > /tmp/ste825r4-notes.md <<'EOF'\nthen: bun run ${FRONT_DOOR} outcome gate-check ${root} fail\nEOF`,
        "",
      ),
  ],
  [
    "(b2) an echo that only mentions an outcome fail call",
    (root) => bashCall(uid("e"), `echo "bun run ${FRONT_DOOR} outcome gate-check ${root} fail"`, `bun run ${FRONT_DOOR} outcome gate-check ${root} fail\n`),
  ],
  ["(c) a pending outcome-verb call (no result)", (root) => pendingBashCall(uid("pend"), outcomeCommand("gate-check", root, "fail"))],
  [
    "(d) a compound `<receipt> && <outcome fail>`",
    (root) => {
      const run = runCli(["gate-check", root]);
      const o = runCli(["outcome", "gate-check", root, "fail"]);
      return bashCall(uid("c"), `${receiptCommand("gate-check", root)} && ${outcomeCommand("gate-check", root, "fail")}`, run.stdout + o.stdout);
    },
  ],
];

for (const state of ["false", "absent"] as const) {
  describe(`AC-STE-825.4 (round 4) Z1 outcomes off — makeTree state "${state}"`, () => {
    for (const [name, make] of OFF_CASES) {
      test(`${name} after a run → exit 0`, async () => {
        const root = checkout(`z1-${state}-${seq}`, state);
        const r1 = mintRun(root);
        const r = await hook(root, [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...make(root)]);
        expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
      }, T);

      test(`${name}, then a fresh /gate-check window + run (e) → exit 0`, async () => {
        const root = checkout(`z1e-${state}-${seq}`, state);
        const r1 = mintRun(root);
        const head = [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...make(root)];
        const r2 = mintRun(root);
        const r = await hook(root, [...head, ...skillCall("gate", "sk2"), ...runRecords(root, r2)]);
        expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
      }, T);
    }

    test("the outcome CLI prints exactly one line naming that outcomes are off, exit 0", () => {
      const root = checkout(`z1cli-${state}`, state);
      mintRun(root);
      const o = runCli(["outcome", "gate-check", root, "pass"]);
      const lines = o.stdout.split("\n").filter((l) => l.trim() !== "");
      expect({ code: o.exitCode, lines: lines.length, off: /off/i.test(o.stdout) }).toEqual({ code: 0, lines: 1, off: true });
    });
  });
}

describe("AC-STE-825.4 (round 4) Z1 control — outcomes on still refuse", () => {
  test("compound `<receipt> && <outcome fail>` after a pass → exit 2", async () => {
    const root = checkout("z1-on-control");
    const head = passedWindow(root);
    const run = runCli(["gate-check", root]);
    const o = runCli(["outcome", "gate-check", root, "fail"]);
    const r = await hook(root, [
      ...head,
      ...bashCall(uid("c"), `${receiptCommand("gate-check", root)} && ${outcomeCommand("gate-check", root, "fail")}`, run.stdout + o.stdout),
    ]);
    expect(r.exitCode).toBe(2);
  }, T);
});

// ===========================================================================
// Z2 — a run minted by an uncounted receipt call
// ===========================================================================

describe("AC-STE-825.4 (round 4) Z2 a run minted by an uncounted receipt call", () => {
  test("(I) pass on R1; R2 minted by `<receipt>; echo done`; a plain announced fail → exit 2", async () => {
    const root = checkout("z2-i");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const f = outcome(root, "fail");
    const r = await hook(root, [
      ...head,
      ...bashCall(uid("r"), `${receiptCommand("gate-check", root)}; echo done`, `${r2.run.stdout}done\n`),
      ...f.records,
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(I2) one window, no earlier pass; R1 counted, R2 minted by `… && true`; a plain announced fail → exit 2", async () => {
    const root = checkout("z2-i2");
    const r1 = mintRun(root);
    const r2 = mintRun(root);
    const f = outcome(root, "fail");
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...runRecords(root, r2, `${receiptCommand("gate-check", root)} && true`),
      ...f.records,
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(I3) R1 counted + fail; R2 compound-minted + a plain announced pass → exit 2 (the pass's run was not counted)", async () => {
    const root = checkout("z2-i3");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f.records,
      ...bashCall(uid("r"), `${receiptCommand("gate-check", root)}; echo done`, `${r2.run.stdout}done\n`),
      ...p.records,
    ]);
    expect(r.exitCode).toBe(2);
  }, T);
});

// ===========================================================================
// Z3 — every outcome segment of a compound is read
// ===========================================================================

describe("AC-STE-825.4 (round 4) Z3 a compound with a tdd outcome segment first", () => {
  test("`outcome tdd pass && outcome gate-check fail` (fail recorded) after an earlier pass → exit 2", async () => {
    const root = checkout("z3");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const f = runCli(["outcome", "gate-check", root, "fail"]);
    expect({ code: f.exitCode, err: f.stderr }).toEqual({ code: 0, err: "" });
    const cmd = `bun run ${DOOR} outcome tdd "${root}" pass && bun run ${DOOR} outcome gate-check "${root}" fail`;
    const r = await hook(root, [...head, ...runRecords(root, r2), ...bashCall(uid("c"), cmd, f.stdout)]);
    expect(r.exitCode).toBe(2);
  }, T);
});

// ===========================================================================
// Z4 — an announced outcome file later deleted or rewritten
// ===========================================================================

describe("AC-STE-825.4 (round 4) Z4 an announced outcome file made unreadable", () => {
  test("(H1) pass, then announced fail, then the fail file is deleted → exit 2", async () => {
    const root = checkout("z4-h1");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const f = outcome(root, "fail");
    rmSync(f.path);
    const r = await hook(root, [...head, ...runRecords(root, r2), ...f.records]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(H2) pass, then announced fail, then the fail file is rewritten to decision pass → exit 2", async () => {
    const root = checkout("z4-h2");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const f = outcome(root, "fail");
    const rec = JSON.parse(readFileSync(f.path, "utf8"));
    expect(rec.decision).toBe("fail");
    rec.decision = "pass";
    writeFileSync(f.path, JSON.stringify(rec));
    const r = await hook(root, [...head, ...runRecords(root, r2), ...f.records]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(H3) only R1 and its announced fail, then the fail file is deleted → exit 2", async () => {
    const root = checkout("z4-h3");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    rmSync(f.path);
    const r = await hook(root, [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...f.records]);
    expect(r.exitCode).toBe(2);
  }, T);
});

// ===========================================================================
// Z5 — whatever path or flags spell `bun`
// ===========================================================================

describe("AC-STE-825.4 (round 4) Z5 any spelling of bun running the door's outcome verb", () => {
  const cases: Array<[string, (root: string) => string]> = [
    ["(K) /usr/local/bin/bun run", (root) => `/usr/local/bin/bun run ${DOOR} outcome gate-check "${root}" fail`],
    ["(L) bun --silent <door>", (root) => `bun --silent ${DOOR} outcome gate-check "${root}" fail`],
    ["(L2) bun --bun run", (root) => `bun --bun run ${DOOR} outcome gate-check "${root}" fail`],
  ];
  for (const [name, cmd] of cases) {
    test(`${name}: an announced fail after an earlier pass → exit 2`, async () => {
      const root = checkout(`z5-${seq}`);
      const head = passedWindow(root);
      const r2 = mintRun(root);
      const f = runCli(["outcome", "gate-check", root, "fail"]);
      expect({ code: f.exitCode, err: f.stderr }).toEqual({ code: 0, err: "" });
      const r = await hook(root, [...head, ...runRecords(root, r2), ...bashCall(uid("o"), cmd(root), f.stdout)]);
      expect(r.exitCode).toBe(2);
    }, T);
  }

  test("negative: `sed -n 1,5p <door> | grep outcome` after a pass → exit 0", async () => {
    const root = checkout("z5-sed");
    const r = await hook(root, [...passedWindow(root), ...bashCall(uid("s"), `sed -n 1,5p ${FRONT_DOOR} | grep outcome`, "outcome\n")]);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("negative: `grep -n outcome <door>` after a pass → exit 0", async () => {
    const root = checkout("z5-grep");
    const r = await hook(root, [...passedWindow(root), ...bashCall(uid("g"), `grep -n outcome ${FRONT_DOOR}`, "12:outcome\n")]);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

// ===========================================================================
// Z6 / Z7 — workStartedEvidence
// ===========================================================================

describe("AC-STE-825.1 (round 4) workStartedEvidence", () => {
  test("(Z6) work on a side branch not naming the id, merged --no-ff by a merge commit naming it → a commit evidence line", () => {
    const root = repo("z6-merge");
    git(root, "checkout", "-q", "-b", "feature");
    commit(root, "feat(src): work", ["src/a.ts"]);
    commit(root, "feat(src): more work", ["src/b.ts"]);
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--no-ff", "-m", "Merge feature (STE-900)", "feature");
    expect(workStartedEvidence(root, TID).some((l) => l.startsWith("commit: "))).toBe(true);
  });

  test("(Z7a) a message carrying \\x1f followed by a specs path, touching src/ → non-empty", () => {
    const root = repo("z7-sep");
    commit(root, "feat(src): x\n\nrefs: STE-900\x1fspecs/x\n", ["src/a.ts"]);
    expect(workStartedEvidence(root, TID).length).toBeGreaterThan(0);
  });

  test("(Z7b) a spec-only FR commit whose spec filename is non-ASCII (specs/frs/é.md) → [] (not started)", () => {
    const root = repo("z7-quote");
    commit(root, "docs(specs): more FR\n\nRefs: STE-900", ["specs/frs/é.md"]);
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });
});

// Audit advisory (round 4): the AC-STE-825.1 clause "a directory git does not know reads as started".
describe("AC-STE-825.1 (amended) a directory git does not know", () => {
  test("(Z8) workStartedEvidence on a plain directory outside any repository → started, naming the git failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste825-nogit-"));
    try {
      const ev = workStartedEvidence(dir, "STE-900");
      expect(ev.some((l) => l.startsWith("git-unreadable"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
