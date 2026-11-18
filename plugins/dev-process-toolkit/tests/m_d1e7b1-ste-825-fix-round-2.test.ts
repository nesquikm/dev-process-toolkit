// STE-825 (M_d1e7b1) fix round 2 — the re-amended ACs.
//
// AC-STE-825.4 (amended): an outcome counts only when its own `dpt-gate-outcome`
// announcement — printed by a Bash call that runs the front door's `outcome`
// verb — sits in the transcript after its run, and the file still hashes to the
// announced digest. Outcomes are ordered by that announcement; the newest counted
// outcome decides.
//
// AC-STE-825.5 (amended): pass after fail clears the refusal in one window or in a
// later window another checkout opened; fail after pass refuses there too.
//
// AC-STE-825.1 (amended): `workStartedEvidence` reads local branches, matches the
// tracker id in any letter case, strips GIT_* from git's environment, and fails
// closed: git missing, failing or timing out counts as started. Only a repo with
// no commits reads as not started.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  bashCall,
  FRONT_DOOR,
  cleanupTemps,
  makeTree,
  mintRun,
  outcomeCommand,
  parseAnnouncement,
  receiptCommand,
  receiptDirOf,
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
  const d = mkdtempSync(join(tmpdir(), `ste825r2-${label}-`));
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

/** Write each file, stage it, and commit with `message`. */
function commit(root: string, message: string, files: string[]): void {
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), `// ${f} ${Math.random()}\n`);
    git(root, "add", f);
  }
  git(root, "commit", "-q", "-m", message);
}

/** A repo with real started work: a commit naming STE-900 that touches src/. */
function startedRepo(label: string): string {
  const root = repo(label);
  commit(root, "feat(src): start\n\nRefs: STE-900", ["src/a.ts"]);
  return root;
}

/** Run `f` with process.env patched; restore every changed key afterwards. */
function withEnv<R>(patch: Record<string, string | undefined>, f: () => R): R {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return f();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ===========================================================================
// AC-STE-825.1 (amended) — workStartedEvidence fails closed, reads local branches
// ===========================================================================

describe("AC-STE-825.1 (amended) workStartedEvidence", () => {
  test("(1) the work commit sits on local branch feat/STE-900 while HEAD is main → non-empty", () => {
    const root = repo("branch");
    git(root, "checkout", "-q", "-b", "feat/STE-900");
    commit(root, "feat(src): start\n\nRefs: STE-900", ["src/a.ts"]);
    git(root, "checkout", "-q", "main");
    expect(workStartedEvidence(root, TID).length).toBeGreaterThan(0);
  });

  test("(2) a lowercase id in the commit message (`refs: ste-900`) → non-empty", () => {
    const root = repo("lower");
    commit(root, "feat(src): start\n\nrefs: ste-900", ["src/a.ts"]);
    expect(workStartedEvidence(root, TID).length).toBeGreaterThan(0);
  });

  test("(3) git not on PATH → non-empty, and an entry names the git failure", () => {
    const root = startedRepo("nogit");
    const ev = withEnv({ PATH: "/nonexistent" }, () => workStartedEvidence(root, TID));
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.some((e) => /git/i.test(e))).toBe(true);
  });

  test("(4) HEAD points at a missing ref (git log exits 128) → non-empty", () => {
    const root = startedRepo("brokenhead");
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/does-not-exist\n");
    expect(workStartedEvidence(root, TID).length).toBeGreaterThan(0);
  });

  test(
    "(5) a git that hangs → returns within 10s with non-empty evidence",
    () => {
      const root = repo("hang");
      const bin = scratch("hangbin");
      writeFileSync(join(bin, "git"), "#!/bin/sh\nexec sleep 30\n");
      chmodSync(join(bin, "git"), 0o755);
      const t0 = Date.now();
      const ev = withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () => workStartedEvidence(root, TID));
      const elapsed = Date.now() - t0;
      expect({ fast: elapsed < 10_000, started: ev.length > 0 }).toEqual({ fast: true, started: true });
    },
    45_000,
  );

  test("(6) GIT_DIR pointing at another repo is stripped: the target's work commit still counts → non-empty", () => {
    const root = startedRepo("gitdir");
    const other = repo("gitdir-other");
    const ev = withEnv({ GIT_DIR: join(other, ".git") }, () => workStartedEvidence(root, TID));
    expect(ev.length).toBeGreaterThan(0);
  });

  test("(7) an empty repo with no commits → [] (not started)", () => {
    const root = join(scratch("empty"), "repo");
    mkdirSync(root, { recursive: true });
    git(root, "init", "-q", "-b", "main");
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });

  test("(8) control: only the FR's spec commit → []", () => {
    const root = repo("spec-only");
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-825.4 / .5 (amended) — through the real hook
// ===========================================================================

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

interface Outcome {
  path: string;
  digest: string;
  stdout: string;
  records: string[];
}

function outcome(root: string, verdict: "pass" | "fail"): Outcome {
  const o = runCli(["outcome", "gate-check", root, verdict]);
  expect({ code: o.exitCode, err: o.stderr }).toEqual({ code: 0, err: "" });
  const ann = parseAnnouncement(o.stdout.split("\n")[0] ?? "", "dpt-gate-outcome: ");
  if (ann === null) throw new Error(`outcome CLI printed no announcement: ${o.stdout}`);
  return { ...ann, stdout: o.stdout, records: bashCall(uid("o"), outcomeCommand("gate-check", root, verdict), o.stdout) };
}

function runRecords(root: string, run: ReturnType<typeof mintRun>): string[] {
  return bashCall(uid("r"), receiptCommand("gate-check", root), run.run.stdout);
}

function runDigest(run: ReturnType<typeof mintRun>): string {
  const a = parseAnnouncement(run.line, "dpt-receipt: ");
  if (a === null) throw new Error(`no receipt announcement: ${run.line}`);
  return a.digest;
}

/** Hand-write a `pass` outcome file (no CLI, no announcement) cloned from a real outcome, for run `digest`. */
function plantPass(root: string, from: string, digest: string): void {
  const rec = JSON.parse(readFileSync(from, "utf8"));
  rec.decision = "pass";
  rec.evidence = { ...rec.evidence, run: digest };
  writeFileSync(join(receiptDirOf(root), "zzzz-planted.json"), JSON.stringify(rec));
}

function checkout(label: string): string {
  const root = makeTree(label, "on");
  stageCodeAndTest(root);
  return root;
}

describe("AC-STE-825.4 (amended) only an announced, intact outcome counts", () => {
  test("(E) run fails (announced), then an unannounced hand-written pass for the same run → exit 2", async () => {
    const root = checkout("e-planted");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    plantPass(root, f.path, runDigest(r1));
    const tr = writeTranscript(tempDir("tr"), [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...f.records]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(F) run fails, bare re-mint R2, hand-written pass for R2 → exit 2", async () => {
    const root = checkout("f-remint-planted");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const r2 = mintRun(root);
    plantPass(root, f.path, runDigest(r2));
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f.records,
      ...runRecords(root, r2),
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(H) fail announced; a later announced pass whose file is rewritten afterwards (digest mismatch) → exit 2", async () => {
    const root = checkout("h-tampered");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const original = readFileSync(p.path, "utf8");
    const rewritten = JSON.stringify(JSON.parse(original), null, 4) + "\n";
    expect(rewritten).not.toBe(original);
    writeFileSync(p.path, rewritten);
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f.records,
      ...runRecords(root, r2),
      ...p.records,
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(I) a pass announcement printed by a non-outcome Bash call (echo) does not count → exit 2", async () => {
    const root = checkout("i-echo");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const echoed = bashCall(uid("e"), `echo "dpt-gate-outcome: ${p.path} sha256:${p.digest}"`, p.stdout);
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f.records,
      ...runRecords(root, r2),
      ...echoed,
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);
});

describe("AC-STE-825.5 (amended) the newest counted outcome decides, across windows and checkouts", () => {
  test("(G) fail then pass in one window, both via the CLI and announced → exit 0", async () => {
    const root = checkout("g-fail-pass");
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f.records,
      ...runRecords(root, r2),
      ...p.records,
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(0);
  }, T);

  test("(D) window 1: A1 pass; window 2 opens on B, then A2 fails → hook for A exits 2", async () => {
    const a = checkout("d-a");
    const b = checkout("d-b");
    const a1 = mintRun(a);
    const pa = outcome(a, "pass");
    const b1 = mintRun(b);
    const a2 = mintRun(a);
    const fa = outcome(a, "fail");
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(a, a1),
      ...pa.records,
      ...skillCall("gate", "sk2"),
      ...runRecords(b, b1),
      ...runRecords(a, a2),
      ...fa.records,
    ]);
    const r = await runHook("gate", a, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(D') window 1: A1 fail; window 2 opens on B, then A2 passes → hook for A exits 0", async () => {
    const a = checkout("dp-a");
    const b = checkout("dp-b");
    const a1 = mintRun(a);
    const fa = outcome(a, "fail");
    const b1 = mintRun(b);
    const a2 = mintRun(a);
    const pa = outcome(a, "pass");
    const tr = writeTranscript(tempDir("tr"), [
      ...skillCall("gate", "sk1"),
      ...runRecords(a, a1),
      ...fa.records,
      ...skillCall("gate", "sk2"),
      ...runRecords(b, b1),
      ...runRecords(a, a2),
      ...pa.records,
    ]);
    const r = await runHook("gate", a, tr);
    expect(r.exitCode).toBe(0);
  }, T);
});

// Audit advisory (fix round 2): an outcome announced BEFORE its run's own announcement is not counted.
describe("AC-STE-825.4 (amended) an outcome counts only after its run", () => {
  test("(J) a fail announced before its run's receipt line → not counted, exit 0", async () => {
    const root = makeTree("r2-j", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const tr = writeTranscript(tempDir("tr"), [...skillCall("gate", "sk1"), ...f.records, ...runRecords(root, r1)]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

// Addendum Y3b (cf-verify V1): the commit leg must work on a real-sized history. Reading the
// whole `git log --name-only` overflowed spawnSync's buffer (ENOBUFS), so the leg was dead.
describe("AC-STE-825.1 (amended) the commit leg on a real-sized history", () => {
  test("(K) a history over 1 MB with only the FR's spec commit → [] (not started), not a buffer failure", () => {
    const root = repo("bighist");
    const msgFile = join(scratch("bigmsg"), "msg.txt");
    writeFileSync(msgFile, `chore: filler\n\n${"x".repeat(80)}\n`.repeat(15_000)); // ~1.2 MB, names no ticket
    git(root, "commit", "-q", "--allow-empty", "-F", msgFile);
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });

  test("(K2) the same big history plus a work commit naming the id → a commit evidence line", () => {
    const root = repo("bighist2");
    const msgFile = join(scratch("bigmsg2"), "msg.txt");
    writeFileSync(msgFile, `chore: filler\n\n${"x".repeat(80)}\n`.repeat(15_000));
    git(root, "commit", "-q", "--allow-empty", "-F", msgFile);
    commit(root, "feat(src): start\n\nRefs: STE-900", ["src/a.ts"]);
    expect(workStartedEvidence(root, TID).some((l) => l.startsWith("commit: "))).toBe(true);
  });

  test("(L) on this checkout, STE-825 reads as started through a commit line", () => {
    const checkoutRoot = join(import.meta.dir, "..", "..", "..");
    const ev = workStartedEvidence(checkoutRoot, "STE-825");
    expect(ev.some((l) => l.startsWith("commit: "))).toBe(true);
    expect(ev.filter((l) => l.startsWith("git-unreadable"))).toEqual([]);
  });

  test("(M) a git whose log output overflows any buffer (stubbed) → fails closed with a named failure", () => {
    const root = repo("overflow");
    const bin = scratch("overflowbin");
    writeFileSync(
      join(bin, "git"),
      '#!/bin/sh\ncase "$*" in\n  *rev-parse*) echo 0000000000000000000000000000000000000000 ;;\n  *for-each-ref*) echo refs/heads/main ;;\n  *log*) head -c 200000000 /dev/zero | tr "\\0" a ;;\nesac\nexit 0\n',
    );
    chmodSync(join(bin, "git"), 0o755);
    const ev = withEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` }, () => workStartedEvidence(root, TID));
    expect(ev.some((l) => /git-unreadable/.test(l))).toBe(true);
  }, 45_000);

  test("(N) an unborn HEAD (orphan branch) beside a branch with only the spec commit → [] (not started)", () => {
    const root = repo("orphan");
    git(root, "checkout", "-q", "--orphan", "fresh");
    expect(workStartedEvidence(root, TID)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-825.4 (amended, fix round 3) — a pending or unreadable outcome refuses
// ===========================================================================

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

/** One Bash call whose result is an error result carrying `stdout`. */
function erroredBashCall(id: string, command: string, stdout: string): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: stdout }] },
    }),
  ];
}

/** run1 with an announced, counted pass: on its own this admits the commit. */
function passedWindow(root: string): string[] {
  const r1 = mintRun(root);
  const p1 = outcome(root, "pass");
  return [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...p1.records];
}

/** One compound Bash call that mints a run and records `verdict` in the same command. */
function compoundRunAndOutcome(root: string, verdict: "pass" | "fail"): string[] {
  const run = runCli(["gate-check", root]);
  expect({ code: run.exitCode, err: run.stderr }).toEqual({ code: 0, err: "" });
  const o = runCli(["outcome", "gate-check", root, verdict]);
  expect({ code: o.exitCode, err: o.stderr }).toEqual({ code: 0, err: "" });
  return bashCall(
    uid("c"),
    `${receiptCommand("gate-check", root)} && ${outcomeCommand("gate-check", root, verdict)}`,
    run.stdout + o.stdout,
  );
}

describe("AC-STE-825.4 (round 3) pending and unreadable outcomes", () => {
  test("(P0) control: run1 + announced pass alone → exit 0", async () => {
    const root = checkout("p0-control");
    const tr = writeTranscript(tempDir("tr"), passedWindow(root));
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(P1) an outcome-verb call with no result yet, still missing after the wait → exit 2, refused as pending", async () => {
    const root = checkout("p1-pending");
    const tr = writeTranscript(tempDir("tr"), [
      ...passedWindow(root),
      ...pendingBashCall(uid("pend"), outcomeCommand("gate-check", root, "fail")),
    ]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, pending: /pending/i.test(r.stderr) }).toEqual({ code: 2, pending: true });
  }, T);

  test("(P2a) control: the same outcome call with its announced fail result → exit 2 with the gate-failed wording", async () => {
    const root = checkout("p2a-fail");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const f = outcome(root, "fail");
    const tr = writeTranscript(tempDir("tr"), [...head, ...runRecords(root, r2), ...f.records]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, failed: r.stderr.includes("fix what failed the gate, or re-run it") }).toEqual({
      code: 2,
      failed: true,
    });
  }, T);

  test("(P2b) control: the same outcome call with its announced pass result → exit 0", async () => {
    const root = checkout("p2b-pass");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const tr = writeTranscript(tempDir("tr"), [...head, ...runRecords(root, r2), ...p.records]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(U1) a compound `receipt && outcome fail` call → exit 2", async () => {
    const root = checkout("u1-compound-fail");
    const tr = writeTranscript(tempDir("tr"), [...passedWindow(root), ...compoundRunAndOutcome(root, "fail")]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(U1b) a compound `receipt && outcome pass` call is unreadable too: the older pass does not decide past it → exit 2", async () => {
    const root = checkout("u1b-compound-pass");
    const tr = writeTranscript(tempDir("tr"), [...passedWindow(root), ...compoundRunAndOutcome(root, "pass")]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(U2) an outcome-verb call whose result is an error result → exit 2", async () => {
    const root = checkout("u2-error");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const tr = writeTranscript(tempDir("tr"), [
      ...head,
      ...runRecords(root, r2),
      ...erroredBashCall(uid("err"), outcomeCommand("gate-check", root, "pass"), p.stdout),
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(U3a) an outcome-verb call whose result has no `dpt-gate-outcome:` line → exit 2", async () => {
    const root = checkout("u3a-no-line");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    outcome(root, "pass");
    const tr = writeTranscript(tempDir("tr"), [
      ...head,
      ...runRecords(root, r2),
      ...bashCall(uid("ok"), outcomeCommand("gate-check", root, "pass"), "ok\n"),
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(U3b) an outcome-verb call whose result carries two announcement lines → exit 2", async () => {
    const root = checkout("u3b-two-lines");
    const head = passedWindow(root);
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const line = p.stdout.split("\n")[0]!;
    const tr = writeTranscript(tempDir("tr"), [
      ...head,
      ...runRecords(root, r2),
      ...bashCall(uid("two"), outcomeCommand("gate-check", root, "pass"), `${line}\n${p.stdout}`),
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("(U4) recovery: the compound call, then a later run2 with a properly announced pass → exit 0", async () => {
    const root = checkout("u4-recovery");
    const head = [...passedWindow(root), ...compoundRunAndOutcome(root, "fail")];
    const r3 = mintRun(root);
    const p = outcome(root, "pass");
    const tr = writeTranscript(tempDir("tr"), [...head, ...runRecords(root, r3), ...p.records]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

// Fix round 3: a pending or unreadable outcome is scoped to the gate its command names, so a broken
// `outcome tdd` call does not hold the gate-check commit gate; an unreadable skill word fails closed.
describe("AC-STE-825.4 (round 3) pending and unreadable outcomes are scoped to their gate", () => {
  test("(S1) a pending outcome call for ANOTHER gate (`outcome tdd …`) does not refuse the gate-check commit", async () => {
    const root = checkout("s1-other-gate");
    const tr = writeTranscript(tempDir("tr"), [
      ...passedWindow(root),
      ...pendingBashCall(uid("pend"), outcomeCommand("gate-check", root, "fail").replace(" outcome gate-check ", " outcome tdd ")),
    ]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(S2) a pending outcome call whose skill word cannot be read still refuses (fail closed)", async () => {
    const root = checkout("s2-unread-skill");
    const tr = writeTranscript(tempDir("tr"), [
      ...passedWindow(root),
      ...pendingBashCall(uid("pend"), outcomeCommand("gate-check", root, "fail").replace(" outcome gate-check ", " outcome $SKILL ")),
    ]);
    const r = await runHook("gate", root, tr);
    expect(r.exitCode).toBe(2);
  }, T);
});

// Fix round 3 audit: only a call that RUNS the front door (a `bun [run] <door> outcome` segment)
// is an outcome call. Reading or grepping the file is not, and must not hold the gate.
describe("AC-STE-825.4 (round 3) only a bun call of the door's outcome verb is an outcome call", () => {
  test("(T1) `sed -n 1,50p <door> | grep outcome` after a pass → exit 0", async () => {
    const root = checkout("t1-sed");
    const tr = writeTranscript(tempDir("tr"), [
      ...passedWindow(root),
      ...bashCall(uid("sed"), `sed -n 1,50p ${FRONT_DOOR} | grep outcome`, "outcome\n"),
    ]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(T2) `cat <door> && echo outcome gate-check` with no result yet → exit 0 (not pending)", async () => {
    const root = checkout("t2-cat");
    const tr = writeTranscript(tempDir("tr"), [
      ...passedWindow(root),
      ...pendingBashCall(uid("cat"), `cat ${FRONT_DOOR} && echo outcome gate-check`),
    ]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);

  test("(T3) the compound refusal names the unreadable outcome", async () => {
    const root = checkout("t3-wording");
    const tr = writeTranscript(tempDir("tr"), [...passedWindow(root), ...compoundRunAndOutcome(root, "fail")]);
    const r = await runHook("gate", root, tr);
    expect({ code: r.exitCode, unreadable: /unreadable outcome/i.test(r.stderr) }).toEqual({ code: 2, unreadable: true });
  }, T);
});
