// STE-725 (M_fd9a03) — the `verdict` verb of the reuse front door.
//
//   bun run gate_reuse.ts verdict <root>
//
// prints `clean` or `rerun`, runs nothing and writes nothing. It prints `clean`
// only when the knob is effective (`gate_commands: reuse`, the outcome switch
// on, the section valid), this session's latest announced `gate-check` run
// receipt is referenced by an announced `gate-outcome` pass with
// `key_stable: true`, that run recorded at least one `gate-step`, and every
// `gate-step` of that run is an announced pass whose stored key deep-equals the
// live key (its `command_sha256` taken from the stored step).
//
// AC-STE-725.2, AC-STE-725.3 and the verdict rows of AC-STE-725.9 live here.
//
// Every receipt is written by SPAWNING a shipped front door (the STE-614
// rule), except the rows that FORGE or REKEY one, which say so. Transcripts
// record each Bash result's `toolUseResult.stdout`/`stderr` the way a live
// Claude Code transcript does. Each gate command touches a sentinel OUTSIDE
// the tree, so running it never dirties the key and an absent sentinel proves
// the verdict ran nothing. Synthetic ids only.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cwdToSlug } from "../adapters/_shared/src/find_current_session";
import { gateReuseKey } from "../adapters/_shared/src/gate_reuse_key";
import { receiptDigest } from "../adapters/_shared/src/tracker_receipts";
import { writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";
import {
  GATE_OUTCOMES_FALSE,
  GATE_OUTCOMES_ON,
  GIT_ENV,
  SETTINGS_HEAD,
  SID,
  SRC,
  bashCall as contentOnlyBashCall,
  cleanupTemps,
  git,
  makeTree,
  mintRun,
  outcomeCommand,
  parseAnnouncement,
  readJson,
  receiptCommand,
  receiptDirOf,
  runCli,
  skillCall,
  tempDir,
  type CliRun,
} from "./_m_7bc805_gate_outcome_fixture";

const T = 240_000;

afterAll(cleanupTemps);

const GATE_REUSE = join(SRC, "gate_reuse.ts");
const RECEIPT_PREFIX = "dpt-receipt: ";
const OUTCOME_PREFIX = "dpt-gate-outcome: ";

/** The ONE line the door prints after a run (operator ruling 2026-11-09). */
const STEP_PREFIX = "dpt-gate-step: ";
const STEP_LINE_RE = /^dpt-gate-step: [a-z][a-z0-9_-]{0,39} exit \d+ — .*?, log \S.*?, read the log on failure, receipt (\/.*\S) sha256:([0-9a-f]{64})$/;

/** A FORGED step line naming `path` and its current digest, as a hand-writer would print it. */
function forgedStepLine(path: string, label = "test", exit = 0): string {
  return `${STEP_PREFIX}${label} exit ${exit} — ok, log /x/forged.log, read the log on failure, receipt ${path} sha256:${receiptDigest(readFileSync(path))}`;
}

/** One Bash call as a live transcript records it: `content` concatenated, `toolUseResult` apart. */
function bashCall(id: string, command: string, stdout: string, stderr = ""): string[] {
  const [use, result] = contentOnlyBashCall(id, command, stdout);
  const joined = stdout === "" || stderr === "" || stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}\n${stderr}`;
  const record = JSON.parse(result as string);
  record.message.content[0].content = joined;
  // The REAL merged shape (Claude Code 2.1.319): the process's stderr is
  // recorded INSIDE toolUseResult.stdout, and toolUseResult.stderr is empty.
  record.toolUseResult = { stdout: joined, stderr: "", interrupted: false, isImage: false };
  return [use as string, JSON.stringify(record)];
}

// ------------------------------------------------------------------ trees

const KNOB_REUSE = "optimizations:\n  gate_commands: reuse\n";
const KNOB_RUN = "optimizations:\n  gate_commands: run\n";
const KNOB_INVALID = "optimizations:\n  gate_commands: skip\n";

const SETTINGS = {
  reuse: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_REUSE,
  // The same effective settings, other bytes: the rekey control's knob-on twin.
  reuseRekeyed: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_REUSE + "# rekeyed\n",
  absent: SETTINGS_HEAD + GATE_OUTCOMES_ON,
  run: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_RUN,
  invalid: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_INVALID,
  outcomesOff: SETTINGS_HEAD + GATE_OUTCOMES_FALSE + KNOB_REUSE,
} as const;
type KnobState = keyof typeof SETTINGS;

/** A clean committed toolkit tree (with its `.dpt/.gitignore`) whose settings read `knob`. */
function reuseTree(label: string, knob: KnobState = "reuse"): string {
  const root = makeTree(label, "on");
  writeDptGitignore(root);
  writeFileSync(join(root, "specs", "settings.yaml"), SETTINGS[knob]);
  git(root, "add", "-A");
  git(root, "commit", "-qm", `knob ${knob}`);
  return root;
}

function setKnob(root: string, knob: KnobState): void {
  writeFileSync(join(root, "specs", "settings.yaml"), SETTINGS[knob]);
  git(root, "commit", "-qam", `knob ${knob}`);
}

/** Every file under `<root>/.dpt`, recursively. */
function storeFileCount(root: string): number {
  const base = join(root, ".dpt");
  if (!existsSync(base)) return 0;
  let n = 0;
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else n += 1;
    }
  };
  walk(base);
  return n;
}

function writeSessionTranscript(cfg: string, root: string, sid: string, records: string[]): string {
  const dir = join(cfg, "projects", cwdToSlug(root));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sid}.jsonl`);
  writeFileSync(file, `${records.join("\n")}\n`);
  return file;
}

function announcementIn(stdout: string, prefix: string): { path: string; digest: string; line: string } {
  for (const line of stdout.split("\n")) {
    if (prefix === STEP_PREFIX) {
      const m = STEP_LINE_RE.exec(line);
      if (m !== null) return { path: m[1]!, digest: m[2]!, line };
      continue;
    }
    const a = parseAnnouncement(line, prefix);
    if (a !== null) return { ...a, line };
  }
  throw new Error(`no ${prefix.trim()} announcement in: ${stdout}`);
}

// ------------------------------------------------------------- the CLIs

function envFor(cfg: string, sid: string | null): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_CONFIG_DIR: cfg };
  if (sid === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sid;
  return env;
}

function runStep(root: string, cfg: string, label: string, command: string): CliRun {
  const p = spawnSync(process.execPath, ["run", GATE_REUSE, "run", root, label, "--", command], {
    cwd: root,
    env: envFor(cfg, SID),
    encoding: "utf-8",
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** The verdict verb, spawned as `/simplify` would issue it. */
function runVerdict(b: { root: string; cfg: string }, o: { sid?: string | null; frontDoor?: string } = {}): CliRun {
  const p = spawnSync(process.execPath, ["run", o.frontDoor ?? GATE_REUSE, "verdict", b.root], {
    cwd: b.root,
    env: envFor(b.cfg, o.sid === undefined ? SID : o.sid),
    encoding: "utf-8",
    timeout: 120_000,
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** The verdict's printed word: its stdout, trimmed. */
const verdictOf = (b: { root: string; cfg: string }, o: { sid?: string | null } = {}): string => runVerdict(b, o).stdout.trim();

const stepCommand = (root: string, label: string, command: string, door = '"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts"'): string =>
  `bun run ${door} run "${root}" ${label} -- '${command}'`;

// ------------------------------------------------------- the session

interface Step {
  label: string;
  cmd: string;
  sentinel: string;
  stdout: string;
  stderr: string;
  path: string;
  digest: string;
}

interface Built {
  root: string;
  cfg: string;
  steps: Step[];
  run: { path: string };
  outcome: { path: string; stdout: string };
  transcript: string;
  records: { skill: string[]; run: string[]; steps: string[][]; outcome: string[] };
}

/**
 * The genuine clean session: one `gate-check` run receipt, a front-door step
 * per gate command that ran and passed, and an outcome `pass` with
 * `key_stable: true` referencing the run, each announced in this session's
 * transcript by the call that printed it.
 */
function buildSession(
  label: string,
  o: { labels?: string[]; failLabel?: string; outcome?: "pass" | "fail"; outcomeSteps?: string[] } = {},
): Built {
  const root = reuseTree(label);
  const cfg = join(tempDir(`${label}-cfg`), "config");
  mkdirSync(join(cfg, "projects"), { recursive: true });
  const run = mintRun(root);
  const labels = o.labels ?? ["test", "lint"];
  const steps: Step[] = labels.map((l) => {
    const sentinel = join(tempDir(`${label}-${l}-s`), "sentinel");
    const cmd = l === o.failLabel ? `touch ${sentinel}; exit 1` : `touch ${sentinel} && echo ok`;
    const r = runStep(root, cfg, l, cmd);
    if (l !== o.failLabel && r.exitCode !== 0) throw new Error(`front door step ${l} failed (exit ${r.exitCode}): ${r.stderr}`);
    const a = announcementIn(r.stdout, STEP_PREFIX);
    rmSync(sentinel, { force: true });
    return { label: l, cmd, sentinel, stdout: r.stdout, stderr: r.stderr, path: a.path, digest: a.digest };
  });
  const verdict = o.outcome ?? "pass";
  // The one-account rule (STE-724): by default the outcome's `--step` entries
  // are exactly the run's gate-step labels, each `pass`. `outcomeSteps`
  // overrides them for the command-list rows.
  const stepArgs = o.outcomeSteps ?? labels.map((l) => `${l}=pass`);
  const out = runCli(["outcome", "gate-check", root, verdict, ...stepArgs.flatMap((s) => ["--step", s])]);
  if (out.exitCode !== 0) throw new Error(`outcome CLI failed: ${out.stderr}`);
  const outcome = { path: announcementIn(out.stdout, OUTCOME_PREFIX).path, stdout: out.stdout };
  const records = {
    skill: skillCall("gate"),
    run: bashCall("b0", receiptCommand("gate-check", root), run.run.stdout, run.run.stderr),
    steps: steps.map((s, i) => bashCall(`b1${i}`, stepCommand(root, s.label, s.cmd), s.stdout, s.stderr)),
    outcome: bashCall("b2", outcomeCommand("gate-check", root, verdict, stepArgs), out.stdout, out.stderr),
  };
  const transcript = writeSessionTranscript(cfg, root, SID, [...records.skill, ...records.run, ...records.steps.flat(), ...records.outcome]);
  return { root, cfg, steps, run: { path: run.path }, outcome, transcript, records };
}

function retranscribe(b: Built, records: string[]): void {
  rmSync(b.transcript, { force: true });
  writeSessionTranscript(b.cfg, b.root, SID, records);
}

const allRecords = (b: Built): string[] => [...b.records.skill, ...b.records.run, ...b.records.steps.flat(), ...b.records.outcome];

const sentinelsAbsent = (b: Built): boolean => b.steps.every((s) => !existsSync(s.sentinel));

/**
 * REKEYED (not spawned): rewrite every step receipt's stored gate key to the
 * live key of the tree as it stands, and re-announce each in the transcript
 * with the genuine front-door command form and its new digest. Settings bytes
 * are part of the key, so a knob change always changes it; rekeying isolates
 * the knob check from the key check.
 */
function rekey(b: Built): void {
  const live = gateReuseKey(realpathSync(b.root));
  b.records.steps = b.steps.map((s, i) => {
    const r = JSON.parse(readFileSync(s.path, "utf-8"));
    r.evidence.key.gate = live;
    writeFileSync(s.path, `${JSON.stringify(r, null, 2)}\n`);
    const line = forgedStepLine(s.path, s.label, r.evidence.exit);
    s.digest = receiptDigest(readFileSync(s.path));
    return bashCall(`b1${i}`, stepCommand(b.root, s.label, s.cmd), `${line}\n`, s.stderr);
  });
  retranscribe(b, allRecords(b));
}

// ===========================================================================
// AC-STE-725.2 — clean on the genuine session, rerun on every broken one
// ===========================================================================

describe("AC-STE-725.2 the verdict verb prints clean only on a fully vouched clean run", () => {
  test("AC-STE-725.2 clean: every command has an announced matching gate-step pass", () => {
    const b = buildSession("v2-clean");
    expect(verdictOf(b)).toBe("clean");
  }, T);

  test("AC-STE-725.2 rerun: one command's step missing from the session (its announcement absent)", () => {
    const b = buildSession("v2-missing-step");
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.steps[0]!, ...b.records.outcome]);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: the run recorded no gate-step at all", () => {
    const b = buildSession("v2-zero-steps", { labels: ["test"] });
    rmSync(b.steps[0]!.path);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.outcome]);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: one step's decision is fail", () => {
    const b = buildSession("v2-step-fail", { failLabel: "lint" });
    expect((readJson(b.steps[1]!.path) as Record<string, any>).decision).toBe("fail");
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: one step's stored key is null", () => {
    const b = buildSession("v2-null-key");
    // REWRITTEN: the second step's key set to null, re-announced in the
    // genuine front-door form with its new digest, so only the key check can fail.
    const s = b.steps[1]!;
    const r = JSON.parse(readFileSync(s.path, "utf-8"));
    r.evidence.key = null;
    writeFileSync(s.path, `${JSON.stringify(r, null, 2)}\n`);
    b.records.steps[1] = bashCall("b11", stepCommand(b.root, s.label, s.cmd), `${forgedStepLine(s.path, s.label, r.evidence.exit)}\n`, s.stderr);
    retranscribe(b, allRecords(b));
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: one key part changed (a new commit after the run)", () => {
    const b = buildSession("v2-key-part");
    writeFileSync(join(b.root, "later.txt"), "committed after the gate\n");
    git(b.root, "add", "-A");
    git(b.root, "commit", "-qm", "later");
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: an untracked file in the tree (another key part)", () => {
    const b = buildSession("v2-untracked");
    writeFileSync(join(b.root, "untracked.txt"), "dirty\n");
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: the run receipt's outcome is fail", () => {
    const b = buildSession("v2-outcome-fail", { outcome: "fail" });
    expect((readJson(b.outcome.path) as Record<string, any>).decision).toBe("fail");
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: the run receipt's announcement absent from the transcript", () => {
    const b = buildSession("v2-run-unannounced");
    retranscribe(b, [...b.records.skill, ...b.records.steps.flat(), ...b.records.outcome]);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: a newer announced gate-check run with no steps is the latest run", () => {
    const b = buildSession("v2-newer-run");
    const later = mintRun(b.root);
    retranscribe(b, [...allRecords(b), ...bashCall("b3", receiptCommand("gate-check", b.root), later.run.stdout, later.run.stderr)]);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: the transcript is missing", () => {
    const b = buildSession("v2-no-transcript");
    rmSync(b.transcript);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 rerun: CLAUDE_CODE_SESSION_ID is unset", () => {
    const b = buildSession("v2-no-sid");
    expect(verdictOf(b, { sid: null })).toBe("rerun");
  }, T);

  // ------------------------------------------------------------ forgeries

  test("AC-STE-725.2 forgery: a step announced by echo prints rerun", () => {
    const b = buildSession("v2-forge-echo");
    // FORGED: the genuine bytes under a new name, the genuine file removed.
    const s = b.steps[1]!;
    const forged = join(receiptDirOf(b.root), "9999-forged-step.json");
    writeFileSync(forged, readFileSync(s.path));
    rmSync(s.path);
    const line = forgedStepLine(forged);
    b.records.steps[1] = bashCall("b11", `echo '${line}'`, `${line}\n`);
    retranscribe(b, allRecords(b));
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 forgery: a step announcement printed by a cd ... && chain prints rerun", () => {
    const b = buildSession("v2-forge-cd");
    const s = b.steps[1]!;
    b.records.steps[1] = bashCall("b11", `cd ${b.root} && ${stepCommand(b.root, s.label, s.cmd)}`, s.stdout, s.stderr);
    retranscribe(b, allRecords(b));
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 forgery: an outcome announced by echo prints rerun", () => {
    const b = buildSession("v2-forge-outcome");
    const forged = join(receiptDirOf(b.root), "9999-forged-outcome.json");
    writeFileSync(forged, readFileSync(b.outcome.path));
    rmSync(b.outcome.path);
    const line = `${OUTCOME_PREFIX}${forged} sha256:${receiptDigest(readFileSync(forged))}`;
    b.records.outcome = bashCall("b2", `echo '${line}'`, `${line}\n`);
    retranscribe(b, allRecords(b));
    expect(verdictOf(b)).toBe("rerun");
  }, T);
});

// ===========================================================================
// AC-STE-725.2 (command list) — the outcome's `evidence.steps` names every
// command of the run (STE-724 "One account of each step"), so a command that
// never went through the front door is a missing step, not an absent one.
// ===========================================================================

describe("AC-STE-725.2 (command list) the outcome's steps and the run's gate-steps are one account", () => {
  test("AC-STE-725.2 (command list): the outcome lists test and lint but only test went through the front door, rerun", () => {
    const b = buildSession("v2-cl-unfronted", { labels: ["test"], outcomeSteps: ["test=pass", "lint=pass"] });
    const out = readJson(b.outcome.path) as Record<string, any>;
    expect(out.evidence.steps).toEqual([
      { name: "test", result: "pass" },
      { name: "lint", result: "pass" },
    ]);
    expect(b.steps.map((s) => s.label)).toEqual(["test"]);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 (command list): the outcome lists a step whose result is fail, rerun", () => {
    const b = buildSession("v2-cl-step-fail", { outcomeSteps: ["test=pass", "lint=fail"] });
    const out = readJson(b.outcome.path) as Record<string, any>;
    expect(out.decision).toBe("pass");
    expect(out.evidence.steps).toEqual([
      { name: "test", result: "pass" },
      { name: "lint", result: "fail" },
    ]);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 (command list): the outcome lists no steps while the run recorded gate-steps, rerun", () => {
    const b = buildSession("v2-cl-no-steps", { outcomeSteps: [] });
    expect((readJson(b.outcome.path) as Record<string, any>).evidence.steps).toEqual([]);
    expect(b.steps.length).toBe(2);
    expect(verdictOf(b)).toBe("rerun");
  }, T);

  test("AC-STE-725.2 (command list) control: the outcome lists exactly the vouched gate-step labels, all pass, clean", () => {
    const b = buildSession("v2-cl-control", { labels: ["test", "lint", "types"], outcomeSteps: ["test=pass", "lint=pass", "types=pass"] });
    expect((readJson(b.outcome.path) as Record<string, any>).evidence.steps).toEqual([
      { name: "test", result: "pass" },
      { name: "lint", result: "pass" },
      { name: "types", result: "pass" },
    ]);
    expect(verdictOf(b)).toBe("clean");
  }, T);
});

// ===========================================================================
// AC-STE-725.2 / AC-STE-725.9 — the knob, isolated from the key by rekeying
// ===========================================================================

/** Whether the shipped `run` verb reuses every step of `b` (the fixture's own control). */
function runVerbReusesAll(b: Built): boolean {
  return b.steps.every((s) => {
    const r = runStep(b.root, b.cfg, s.label, s.cmd);
    const reused = r.stdout.split("\n").some((l) => l.startsWith("dpt-reuse: ")) && !existsSync(s.sentinel);
    rmSync(s.sentinel, { force: true });
    return reused;
  });
}

describe("AC-STE-725.2 fixture control: the shipped run verb agrees the fixtures are clean", () => {
  test("control: the run verb reuses every step of the clean fixture, and of it rekeyed under knob-on settings with other bytes", () => {
    const b = buildSession("v2-fixture-control");
    expect(runVerbReusesAll(b)).toBe(true);
    const k = buildSession("v2-fixture-rekey");
    setKnob(k.root, "reuseRekeyed");
    rekey(k);
    expect(runVerbReusesAll(k)).toBe(true);
  }, T);
});

describe("AC-STE-725.2 on the clean fixture the verdict prints rerun with the knob off", () => {
  test("AC-STE-725.9 control: rekeyed under knob-on settings with other bytes, the session still prints clean", () => {
    const b = buildSession("v9-rekey-control");
    setKnob(b.root, "reuseRekeyed");
    expect(verdictOf(b)).toBe("rerun"); // the settings bytes are a key part
    rekey(b);
    expect(verdictOf(b)).toBe("clean");
  }, T);

  const OFF: Array<[string, KnobState]> = [
    ["gate_commands absent", "absent"],
    ["gate_commands: run", "run"],
    ["the section invalid", "invalid"],
    ["reuse with tracking.gate_outcomes off", "outcomesOff"],
  ];
  for (const [name, knob] of OFF) {
    test(`AC-STE-725.9 knob off (${name}): rekeyed to the live key, the verdict still prints rerun`, () => {
      const b = buildSession(`v9-${knob}`);
      setKnob(b.root, knob);
      rekey(b);
      expect(verdictOf(b)).toBe("rerun");
    }, T);
  }
});

// ===========================================================================
// AC-STE-725.3 — the verdict runs nothing and writes nothing
// ===========================================================================

describe("AC-STE-725.3 the verdict verb spawns no gate command and writes no receipt", () => {
  test("AC-STE-725.3 clean: it prints clean, the store's file count is unchanged and no sentinel appears", () => {
    const b = buildSession("v3-clean");
    const before = storeFileCount(b.root);
    const out = verdictOf(b);
    expect({ out, files: storeFileCount(b.root), sentinelsAbsent: sentinelsAbsent(b) }).toEqual({
      out: "clean",
      files: before,
      sentinelsAbsent: true,
    });
  }, T);

  test("AC-STE-725.3 rerun: it prints rerun, the store's file count is unchanged and no sentinel appears", () => {
    const b = buildSession("v3-rerun");
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.steps[0]!, ...b.records.outcome]);
    const before = storeFileCount(b.root);
    const out = verdictOf(b);
    expect({ out, files: storeFileCount(b.root), sentinelsAbsent: sentinelsAbsent(b) }).toEqual({
      out: "rerun",
      files: before,
      sentinelsAbsent: true,
    });
  }, T);

  test("AC-STE-725.3 CLAUDE_CODE_SESSION_ID unset: it prints rerun and writes nothing", () => {
    const b = buildSession("v3-no-sid");
    const before = storeFileCount(b.root);
    const out = verdictOf(b, { sid: null });
    expect({ out, files: storeFileCount(b.root), sentinelsAbsent: sentinelsAbsent(b) }).toEqual({
      out: "rerun",
      files: before,
      sentinelsAbsent: true,
    });
  }, T);
});

// ===========================================================================
// AC-STE-725.2 (mixed outcomes) — the run receipt must be referenced by a
// `gate-outcome` with `decision: pass` and `key_stable: true`, read from the
// run's LATEST vouched outcome: an earlier vouched pass does not survive a
// later vouched fail or a later `key_stable: false`.
// ===========================================================================

/**
 * HAND-MADE (not spawned): the genuine outcome front door pairs one outcome
 * per run, so a second outcome for the same run is written from the genuine
 * outcome's bytes with `edit` applied, under a name that sorts after it and a
 * later `createdAt`, and announced in the transcript under the genuine outcome
 * command form (a call `runsGateOutcome` accepts) with its matching digest, so
 * it is vouched exactly as the genuine one is.
 */
function addLaterOutcome(b: Built, edit: (r: Record<string, any>) => void): string {
  const r = JSON.parse(readFileSync(b.outcome.path, "utf-8"));
  edit(r);
  if (typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt))) {
    r.createdAt = new Date(Date.parse(r.createdAt) + 60_000).toISOString();
  }
  const later = `${b.outcome.path.replace(/\.json$/, "")}~later.json`;
  writeFileSync(later, `${JSON.stringify(r, null, 2)}\n`);
  const line = `${OUTCOME_PREFIX}${later} sha256:${receiptDigest(readFileSync(later))}`;
  const steps = (r.evidence?.steps ?? []).map((s: { name: string; result: string }) => `${s.name}=${s.result}`);
  const call = bashCall("b4", outcomeCommand("gate-check", b.root, String(r.decision), steps), `${line}\n`);
  retranscribe(b, [...allRecords(b), ...call]);
  return later;
}

describe("AC-STE-725.2 (mixed outcomes) the run's latest vouched outcome decides", () => {
  test(
    "AC-STE-725.2 (mixed outcomes): a run whose latest vouched outcome is fail, or key_stable false, prints rerun even when an earlier vouched pass outcome references it and the steps all read pass",
    () => {
      // Control: only the earlier (genuine) pass/key_stable outcome → clean.
      const c = buildSession("v2-mixed-control");
      const earlier = readJson(c.outcome.path) as Record<string, any>;
      expect({ decision: earlier.decision, key_stable: earlier.evidence.key_stable }).toEqual({ decision: "pass", key_stable: true });
      expect(verdictOf(c)).toBe("clean");

      // Control: a hand-made later outcome that is itself pass/key_stable is
      // vouched and changes nothing → clean (the hand-made path is not what reds A/B).
      const d = buildSession("v2-mixed-dup");
      addLaterOutcome(d, () => {});
      expect(verdictOf(d)).toBe("clean");

      // Row A: later vouched outcome decision fail, its steps all pass → rerun.
      const a = buildSession("v2-mixed-fail");
      const aLater = readJson(addLaterOutcome(a, (r) => {
        r.decision = "fail";
      })) as Record<string, any>;
      expect(typeof aLater.evidence.run).toBe("string");
      expect(aLater.evidence.run).toBe((readJson(a.outcome.path) as Record<string, any>).evidence.run);
      expect(aLater.decision).toBe("fail");
      expect(aLater.evidence.key_stable).toBe(true);
      expect(aLater.evidence.steps.every((s: { result: string }) => s.result === "pass")).toBe(true);
      expect(verdictOf(a)).toBe("rerun");

      // Row B: later vouched outcome decision pass but key_stable false → rerun.
      const bb = buildSession("v2-mixed-unstable");
      const bLater = readJson(addLaterOutcome(bb, (r) => {
        r.evidence.key_stable = false;
      })) as Record<string, any>;
      expect(bLater.evidence.run).toBe((readJson(bb.outcome.path) as Record<string, any>).evidence.run);
      expect({ decision: bLater.decision, key_stable: bLater.evidence.key_stable }).toEqual({ decision: "pass", key_stable: false });
      expect(bLater.evidence.steps.every((s: { result: string }) => s.result === "pass")).toBe(true);
      expect(verdictOf(bb)).toBe("rerun");
    },
    T,
  );
});
