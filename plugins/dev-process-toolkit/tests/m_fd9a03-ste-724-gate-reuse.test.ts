// STE-724 (M_fd9a03) — the reuse front door, its stored pass, the hooks that
// never read it, and the `reuse: on` receipt line.
//
// AC.4, AC.5, AC.6, AC.8, AC.9, AC.10, AC.11, AC.12, AC.14, AC.15, AC.16,
// AC.18 and the receipt-line half of AC.20 live here.
//
// Module under test: adapters/_shared/src/gate_reuse.ts (new), CLI
//   bun run gate_reuse.ts run <root> <label> -- <command text>
// plus the `reuse: on` line of the gate_receipt.ts receipt call.
//
// Every receipt is written by SPAWNING a shipped front door (the STE-614 rule),
// except the rows that FORGE one, which say so. Every fixture naming `reuse`
// sets `gate_commands: reuse` AND `tracking.gate_outcomes: { enabled: true }`
// unless the row is about one of them being off. The session transcript lives
// under a temp CLAUDE_CONFIG_DIR at `projects/<slug of the root>/<sid>.jsonl`,
// which `sessionTranscriptPath(CLAUDE_CODE_SESSION_ID, process.cwd())` finds.
// The command a fixture runs touches a sentinel OUTSIDE the tree, so running it
// never dirties the key, and an absent sentinel proves the command did not run.
//
// AC.18 lives in the "AC-STE-724.18 mutation controls" block: one temp plugin
// copy per check (knob, tree-clean, transcript announcement, announcesGateStep
// provenance, runsGateOutcome provenance, the run outcome check in two halves,
// and the outcome-switch guard before the `reuse: on` read), each graded
// against an unmutated copy on the same fixture.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cwdToSlug } from "../adapters/_shared/src/find_current_session";
import { NEVER_REUSABLE_STEPS } from "../adapters/_shared/src/optimizations_config";
import { receiptDigest } from "../adapters/_shared/src/tracker_receipts";
import {
  GATE_OUTCOMES_FALSE,
  GATE_OUTCOMES_ON,
  GIT_ENV,
  PLUGIN_ROOT,
  SETTINGS_HEAD,
  SID,
  SKILL_OF,
  SRC,
  bashCall as contentOnlyBashCall,
  cleanupTemps,
  git,
  makeTree,
  mintRun,
  outcomeCommand,
  parseAnnouncement,
  pluginCopy,
  readJson,
  receiptCommand,
  receiptDirOf,
  runCli,
  runHook,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
  type CliRun,
  type SwitchState,
} from "./_m_7bc805_gate_outcome_fixture";
import { writeDptGitignore } from "../adapters/_shared/src/setup/dpt_gitignore";

type AnyMod = Record<string, any>;
const T = 180_000;

afterAll(cleanupTemps);

const GATE_REUSE = join(SRC, "gate_reuse.ts");
const LABEL = "test";
const OTHER_SID = "m7bc805s715other";
const REUSE_PREFIX = "dpt-reuse: ";
const RECEIPT_PREFIX = "dpt-receipt: ";
const OUTCOME_PREFIX = "dpt-gate-outcome: ";

/** The ONE line the door prints after a run (operator ruling 2026-11-09). */
const STEP_PREFIX = "dpt-gate-step: ";
const STEP_LINE_RE = /^dpt-gate-step: [a-z][a-z0-9_-]{0,39} exit \d+ — .*?, log \S.*?, read the log on failure, receipt (\/.*\S) sha256:([0-9a-f]{64})$/;

/** A FORGED step line naming `path` and its current digest, as a hand-writer would print it. */
function forgedStepLine(path: string, label = "test", exit = 0): string {
  return `${STEP_PREFIX}${label} exit ${exit} — ok, log /x/forged.log, read the log on failure, receipt ${path} sha256:${receiptDigest(readFileSync(path))}`;
}
const NFR10_SHAPE = /^.+\nRemedy: .+\nContext: .+/m;

async function reuseModule(): Promise<AnyMod> {
  if (!existsSync(GATE_REUSE)) throw new Error(`gate_reuse.ts is absent: ${GATE_REUSE}`);
  return (await import(GATE_REUSE)) as AnyMod;
}

/**
 * One Bash call as a real Claude Code transcript records it: the tool_result
 * `content` is stdout and stderr concatenated, and the record's top-level
 * `toolUseResult` carries them apart (keys stdout, stderr, interrupted,
 * isImage), measured on a live transcript. Every Bash result this file writes
 * goes through here.
 */
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

/**
 * The shared fixture tree plus the committed `.dpt/.gitignore` a
 * toolkit-managed tree carries (/setup writes it via `writeDptGitignore`).
 * Without it the first receipt write creates that file and leaves the tree
 * dirty, so a key minted after it would never match a clean-tree key.
 */
function managedTree(label: string, state: SwitchState): string {
  const root = makeTree(label, state);
  writeDptGitignore(root);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "dpt gitignore");
  return root;
}

const KNOB_REUSE = "optimizations:\n  gate_commands: reuse\n";
const KNOB_RUN = "optimizations:\n  gate_commands: run\n";
const KNOB_INVALID = "optimizations:\n  gate_commands: skip\n";

const SETTINGS = {
  reuse: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_REUSE,
  absent: SETTINGS_HEAD + GATE_OUTCOMES_ON,
  run: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_RUN,
  invalid: SETTINGS_HEAD + GATE_OUTCOMES_ON + KNOB_INVALID,
  outcomesOff: SETTINGS_HEAD + GATE_OUTCOMES_FALSE + KNOB_REUSE,
} as const;
type KnobState = keyof typeof SETTINGS;

/**
 * A clean, committed toolkit tree whose settings file reads `knob`, with a
 * committed `docs/` subdirectory (a cwd below the root) and, when asked, on a
 * synthetic branch whose name a receipt must never carry.
 */
function reuseTree(label: string, knob: KnobState = "reuse", opts: { branch?: string } = {}): string {
  const root = managedTree(label, "on");
  if (opts.branch !== undefined) git(root, "checkout", "-q", "-b", opts.branch);
  writeFileSync(join(root, "specs", "settings.yaml"), SETTINGS[knob]);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "readme.txt"), "synthetic\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", `knob ${knob}`);
  return root;
}

/** Rewrite the settings file to `knob` and commit it. */
function setKnob(root: string, knob: KnobState): void {
  writeFileSync(join(root, "specs", "settings.yaml"), SETTINGS[knob]);
  git(root, "commit", "-qam", `knob ${knob}`);
}

const realpathOf = (p: string): string => realpathSync(p);

function isClean(root: string): boolean {
  return git(root, "status", "--porcelain").trim() === "";
}

/** Every file under `<root>/.dpt`, recursively: the store's file count. */
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

function sessionReceipts(root: string, sid = SID): Array<{ path: string; record: Record<string, any> }> {
  const dir = receiptDirOf(root, sid);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => ({ path: join(dir, n), record: readJson(join(dir, n)) as Record<string, any> }));
}

const stepReceipts = (root: string, sid = SID) => sessionReceipts(root, sid).filter((r) => r.record.kind === "gate-step");

// --------------------------------------------------------------- the CLI

/** A fresh, empty config dir: no real transcript is ever consulted. */
function emptyConfig(): string {
  const d = join(tempDir("cfg-empty"), "config");
  mkdirSync(join(d, "projects"), { recursive: true });
  return d;
}

function runReuse(
  root: string,
  label: string,
  command: string,
  o: { cfg?: string; sid?: string | null; cwd?: string; env?: Record<string, string>; frontDoor?: string } = {},
): CliRun {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...GIT_ENV,
    CLAUDE_CONFIG_DIR: o.cfg ?? emptyConfig(),
    ...(o.env ?? {}),
  };
  if (o.sid === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = o.sid ?? SID;
  const p = spawnSync(process.execPath, ["run", o.frontDoor ?? GATE_REUSE, "run", root, label, "--", command], {
    cwd: o.cwd ?? root,
    env,
    encoding: "utf-8",
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** The Bash command `/gate-check` issues for one gate command, as a transcript records it. */
const reuseCommand = (root: string, label: string, command: string, door = '"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_reuse.ts"'): string =>
  `bun run ${door} run "${root}" ${label} -- '${command}'`;

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

function reuseLines(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l.startsWith(REUSE_PREFIX));
}

function writeSessionTranscript(cfg: string, root: string, sid: string, records: string[]): string {
  const dir = join(cfg, "projects", cwdToSlug(root));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sid}.jsonl`);
  writeFileSync(file, `${records.join("\n")}\n`);
  return file;
}

// ------------------------------------------------------ the stored pass

interface Built {
  root: string;
  cfg: string;
  sentinel: string;
  cmd: string;
  run: { stdout: string; path: string };
  step: { stdout: string; stderr: string; path: string; digest: string; line: string };
  outcome: { stdout: string; stderr: string; path: string; digest: string; line: string };
  transcript: string;
  records: { skill: string[]; run: string[]; step: string[]; outcome: string[] };
}

/**
 * The genuine stored pass: a run receipt, one front-door step that ran and
 * passed, an outcome `pass` with `key_stable: true` referencing the run, every
 * one of them announced in this session's transcript by the call that printed it.
 */
function buildSession(
  label: string,
  o: {
    knob?: KnobState;
    outcome?: "pass" | "fail" | "none";
    unstableOutcome?: boolean;
    command?: (sentinel: string) => string;
    /** The gate_reuse.ts the step runs through (a plugin copy); the shipped one by default. */
    frontDoor?: string;
    /** Leave an untracked file in the tree for the whole session. */
    dirty?: boolean;
  } = {},
): Built {
  const root = reuseTree(label, o.knob ?? "reuse");
  if (o.dirty) writeFileSync(join(root, "untracked.txt"), "dirty for the whole session\n");
  const cfg = join(tempDir(`${label}-cfg`), "config");
  mkdirSync(join(cfg, "projects"), { recursive: true });
  const sentinel = join(tempDir(`${label}-s`), "sentinel");
  const cmd = o.command ? o.command(sentinel) : `touch ${sentinel} && echo ok`;

  const run = mintRun(root);
  const stepRun = runReuse(root, LABEL, cmd, { cfg, frontDoor: o.frontDoor });
  if (stepRun.exitCode !== 0 && o.command === undefined) {
    throw new Error(`front door step failed (exit ${stepRun.exitCode}): ${stepRun.stderr}`);
  }
  const step = { stdout: stepRun.stdout, stderr: stepRun.stderr, ...announcementIn(stepRun.stdout, STEP_PREFIX) };
  rmSync(sentinel, { force: true });

  let outcome = { stdout: "", stderr: "", path: "", digest: "", line: "" };
  const verdict = o.outcome ?? "pass";
  if (verdict !== "none") {
    const probe = join(root, "unstable.txt");
    if (o.unstableOutcome) writeFileSync(probe, "dirty between run and outcome\n");
    const out = runCli(["outcome", "gate-check", root, verdict, "--step", `${LABEL}=pass`]);
    if (o.unstableOutcome) rmSync(probe);
    if (out.exitCode !== 0) throw new Error(`outcome CLI failed: ${out.stderr}`);
    outcome = { stdout: out.stdout, stderr: out.stderr, ...announcementIn(out.stdout, OUTCOME_PREFIX) };
  }

  const records = {
    skill: skillCall("gate"),
    run: bashCall("b0", receiptCommand("gate-check", root), run.run.stdout, run.run.stderr),
    step: bashCall("b1", reuseCommand(root, LABEL, cmd), step.stdout, step.stderr),
    outcome:
      verdict === "none"
        ? []
        : bashCall("b2", outcomeCommand("gate-check", root, verdict, [`${LABEL}=pass`]), outcome.stdout, outcome.stderr),
  };
  const transcript = writeSessionTranscript(cfg, root, SID, [...records.skill, ...records.run, ...records.step, ...records.outcome]);
  return { root, cfg, sentinel, cmd, run: { stdout: run.run.stdout, path: run.path }, step, outcome, transcript, records };
}

function retranscribe(b: Built, records: string[], sid = SID): void {
  rmSync(b.transcript, { force: true });
  writeSessionTranscript(b.cfg, b.root, sid, records);
}

/** The command ran: its sentinel exists and no `dpt-reuse:` line was printed. */
function expectRan(b: Built, r: CliRun): void {
  expect({ ran: existsSync(b.sentinel), reuse: reuseLines(r.stdout) }).toEqual({ ran: true, reuse: [] });
}

/** The command was reused: no sentinel, one `dpt-reuse:` line, exit 0. */
function expectReused(b: Built, r: CliRun): void {
  expect({ ran: existsSync(b.sentinel), code: r.exitCode, reuse: reuseLines(r.stdout).length }).toEqual({
    ran: false,
    code: 0,
    reuse: 1,
  });
}

// ===========================================================================
// AC-STE-724.4 — trip / no-trip, one named test per key part
// ===========================================================================

describe("AC-STE-724.4 a matching announced pass is reused; any changed key part runs", () => {
  test("TRIP: with an announced matching pass the front door prints dpt-reuse:, does not run the command, exits 0", () => {
    const b = buildSession("ac4-trip");
    expect(isClean(b.root)).toBe(true);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectReused(b, r);
  }, T);

  test("TRIP: run from a subdirectory of the root, the transcript is still found and the pass reused", () => {
    const b = buildSession("ac4-subdir");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg, cwd: join(b.root, "docs") });
    expectReused(b, r);
  }, T);

  test("key part: a new commit runs the command", () => {
    const b = buildSession("ac4-commit");
    git(b.root, "commit", "-q", "--allow-empty", "-m", "another commit");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
    expect(r.exitCode).toBe(0);
  }, T);

  test("key part: one changed byte of command text runs the command", () => {
    const b = buildSession("ac4-cmd-byte");
    const r = runReuse(b.root, LABEL, `${b.cmd} `, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("key part: one changed byte of specs/settings.yaml runs the command", async () => {
    const b = buildSession("ac4-settings-byte");
    writeFileSync(join(b.root, "specs", "settings.yaml"), `${SETTINGS.reuse}#\n`);
    git(b.root, "commit", "-qam", "one settings byte");
    const m = await reuseModule();
    const live = await m.computeReuseKey(b.root, b.cmd);
    const stored = readJson(b.step.path) as Record<string, any>;
    expect(live.gate.settings).not.toBe(stored.evidence.key.gate.settings);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("key part: one changed byte of the ## Key Commands section runs the command", async () => {
    const b = buildSession("ac4-commands-byte");
    const md = readFileSync(join(b.root, "CLAUDE.md"), "utf-8");
    expect(md).toContain("- `bun run lint`\n");
    writeFileSync(join(b.root, "CLAUDE.md"), md.replace("- `bun run lint`\n", "- `bun run lint `\n"));
    git(b.root, "commit", "-qam", "one key-commands byte");
    const m = await reuseModule();
    const live = await m.computeReuseKey(b.root, b.cmd);
    const stored = readJson(b.step.path) as Record<string, any>;
    expect(live.gate.commands).not.toBe(stored.evidence.key.gate.commands);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("key part: an untracked file runs the command", () => {
    const b = buildSession("ac4-untracked");
    writeFileSync(join(b.root, "untracked.txt"), "x\n");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  /** decideReuse in-process, with this session's id and config dir. */
  async function decide(b: Built, options: Record<string, unknown>): Promise<unknown> {
    const m = await reuseModule();
    const saved = { sid: process.env.CLAUDE_CODE_SESSION_ID, cfg: process.env.CLAUDE_CONFIG_DIR };
    process.env.CLAUDE_CODE_SESSION_ID = SID;
    process.env.CLAUDE_CONFIG_DIR = b.cfg;
    try {
      return await m.decideReuse(b.root, LABEL, b.cmd, options);
    } finally {
      if (saved.sid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = saved.sid;
      if (saved.cfg === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = saved.cfg;
    }
  }

  test("key part: another Bun version (decideReuse with a bunVersion stub) does not reuse", async () => {
    const b = buildSession("ac4-bun");
    const control = await decide(b, {});
    const stubbed = await decide(b, { bunVersion: "0.0.0-stub" });
    // CONTROL: unstubbed, the decision names the stored receipt it would reuse.
    expect(JSON.stringify(control)).toContain(b.step.path);
    expect(stubbed).not.toEqual(control);
    // CONTROL: unstubbed, the decision IS a reuse; stubbed, it is NOT.
    expect((control as { reuse?: unknown }).reuse).toBe(true);
    expect((stubbed as { reuse?: unknown }).reuse).toBe(false);
    expect(existsSync(b.sentinel)).toBe(false);
  }, T);

  test("key part: another plugin version (decideReuse with a pluginRoot naming another version) does not reuse", async () => {
    const b = buildSession("ac4-plugin");
    const pluginRoot = join(tempDir("ac4-plugin-root"), "plugin");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), '{"name":"stub","version":"0.0.1"}\n');
    const control = await decide(b, {});
    const stubbed = await decide(b, { pluginRoot });
    expect(JSON.stringify(control)).toContain(b.step.path);
    expect(stubbed).not.toEqual(control);
    // CONTROL: unstubbed, the decision IS a reuse; stubbed, it is NOT.
    expect((control as { reuse?: unknown }).reuse).toBe(true);
    expect((stubbed as { reuse?: unknown }).reuse).toBe(false);
    expect(existsSync(b.sentinel)).toBe(false);
  }, T);
});

// ===========================================================================
// AC-STE-724.5 — every unvouched or unmatched record runs the command
// ===========================================================================

describe("AC-STE-724.5 the front door runs the command unless the stored pass is vouched for", () => {
  test("the stored step receipt's decision is fail: the command runs", () => {
    const b = buildSession("ac5-fail", { command: (s) => `touch ${s}; exit 1` });
    expect((readJson(b.step.path) as Record<string, any>).decision).toBe("fail");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
    expect(r.exitCode).toBe(1);
  }, T);

  test("no gate-outcome receipt references the run: the command runs", () => {
    const b = buildSession("ac5-no-outcome", { outcome: "none" });
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the only gate-outcome referencing the run has decision fail: the command runs", () => {
    const b = buildSession("ac5-outcome-fail", { outcome: "fail" });
    expect((readJson(b.outcome.path) as Record<string, any>).decision).toBe("fail");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the only gate-outcome referencing the run has key_stable false: the command runs", () => {
    const b = buildSession("ac5-unstable", { unstableOutcome: true });
    expect((readJson(b.outcome.path) as Record<string, any>).evidence.key_stable).toBe(false);
    expect(isClean(b.root)).toBe(true);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the step announcement absent from the transcript runs the command", () => {
    const b = buildSession("ac5-no-step-ann");
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the outcome announcement absent from the transcript runs the command", () => {
    const b = buildSession("ac5-no-outcome-ann");
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.step]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the step receipt rewritten after its announcement (digest mismatch) runs the command", () => {
    const b = buildSession("ac5-step-rewritten");
    const parsed = JSON.parse(readFileSync(b.step.path, "utf-8"));
    writeFileSync(b.step.path, `${JSON.stringify(parsed, null, 1)}\n`);
    expect(receiptDigest(readFileSync(b.step.path))).not.toBe(b.step.digest);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the outcome receipt rewritten after its announcement (digest mismatch) runs the command", () => {
    const b = buildSession("ac5-outcome-rewritten");
    const parsed = JSON.parse(readFileSync(b.outcome.path, "utf-8"));
    writeFileSync(b.outcome.path, `${JSON.stringify(parsed, null, 1)}\n`);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the transcript missing runs the command", () => {
    const b = buildSession("ac5-no-transcript");
    rmSync(b.transcript);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("the receipts belonging to another session run the command", () => {
    const b = buildSession("ac5-other-session");
    // The other session's transcript carries the very same announcements.
    writeSessionTranscript(b.cfg, b.root, OTHER_SID, [...b.records.skill, ...b.records.run, ...b.records.step, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg, sid: OTHER_SID });
    expectRan(b, r);
  }, T);

  // ------------------------------------------------------------ forgeries

  test("forgery: a hand-written gate-step receipt announced by echo runs the command", () => {
    const b = buildSession("ac5-forge-echo");
    // FORGED: the genuine bytes under a new name, the genuine file removed.
    const forged = join(receiptDirOf(b.root), "9999-forged-step.json");
    writeFileSync(forged, readFileSync(b.step.path));
    rmSync(b.step.path);
    const line = forgedStepLine(forged);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...bashCall("b1", `echo '${line}'`, `${line}\n`), ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("forgery: a step announcement printed by a cd chain runs the command", () => {
    const b = buildSession("ac5-forge-cd");
    const chained = `cd ${b.root} && ${reuseCommand(b.root, LABEL, b.cmd)}`;
    retranscribe(b, [...b.records.skill, ...b.records.run, ...bashCall("b1", chained, b.step.stdout), ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("forgery: a step announcement printed by a same-named gate_reuse.ts outside the plugin runs the command", () => {
    const b = buildSession("ac5-forge-outside");
    const outside = join(tempDir("ac5-outside"), "gate_reuse.ts");
    writeFileSync(outside, "// not the front door\n");
    const cmd = reuseCommand(b.root, LABEL, b.cmd, `"${outside}"`);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...bashCall("b1", cmd, b.step.stdout), ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("forgery: a hand-written gate-outcome announced by echo runs the command", () => {
    const b = buildSession("ac5-forge-outcome");
    const forged = join(receiptDirOf(b.root), "9999-forged-outcome.json");
    writeFileSync(forged, readFileSync(b.outcome.path));
    rmSync(b.outcome.path);
    const line = `${OUTCOME_PREFIX}${forged} sha256:${receiptDigest(readFileSync(forged))}`;
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.step, ...bashCall("b2", `echo '${line}'`, `${line}\n`)]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("announcesGateStep is false for each forged form and true for the plain one", async () => {
    const m = await reuseModule();
    expect(typeof m.announcesGateStep).toBe("function");
    const outside = join(tempDir("ac5-unit-outside"), "gate_reuse.ts");
    writeFileSync(outside, "// not the front door\n");
    const plain = [
      `bun run ${GATE_REUSE} run /tmp/x test -- 'bun test'`,
      `bun ${GATE_REUSE} run /tmp/x lint -- 'bun run lint'`,
      reuseCommand("/tmp/x", "test", "bun test"),
    ];
    const forged = [
      `echo bun run ${GATE_REUSE} run /tmp/x test -- 'bun test'`,
      `echo 'dpt-receipt: /tmp/x/r.json sha256:${"0".repeat(64)}'`,
      `cd /tmp/x && bun run ${GATE_REUSE} run /tmp/x test -- 'bun test'`,
      `bun run ${outside} run /tmp/x test -- 'bun test'`,
      `bun run ${join(SRC, "gate_receipt.ts")} gate-check /tmp/x`,
    ];
    for (const c of plain) expect({ c, v: m.announcesGateStep(c) }).toEqual({ c, v: true });
    for (const c of forged) expect({ c, v: m.announcesGateStep(c) }).toEqual({ c, v: false });
  });
});

// ===========================================================================
// AC-STE-724.6 — knob off: a hand run always runs and records nothing
// ===========================================================================

describe("AC-STE-724.6 with the knob off the front door runs, writes nothing, never reuses", () => {
  const OFF: Array<[string, KnobState]> = [
    ["absent", "absent"],
    ["run", "run"],
    ["the section invalid", "invalid"],
    ["reuse with tracking.gate_outcomes off", "outcomesOff"],
  ];
  for (const [name, knob] of OFF) {
    test(`knob off (${name}): runs every time, writes no receipt, prints no dpt-reuse:, names the off knob`, () => {
      // A pass stored and announced while the knob was on, then the knob turned off.
      const b = buildSession(`ac6-${knob}`);
      setKnob(b.root, knob);
      const before = storeFileCount(b.root);
      for (let i = 0; i < 2; i++) {
        const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
        expectRan(b, r);
        expect(r.exitCode).toBe(0);
        expect(r.stderr).toContain("gate_commands");
        rmSync(b.sentinel, { force: true });
      }
      expect(storeFileCount(b.root)).toBe(before);
    }, T);

    test(`knob off (${name}): exits with the command's status`, () => {
      const root = reuseTree(`ac6-status-${knob}`, knob);
      const sentinel = join(tempDir("ac6-s"), "sentinel");
      const before = storeFileCount(root);
      const r = runReuse(root, LABEL, `touch ${sentinel}; exit 7`);
      expect({ code: r.exitCode, ran: existsSync(sentinel), reuse: reuseLines(r.stdout) }).toEqual({ code: 7, ran: true, reuse: [] });
      expect(storeFileCount(root)).toBe(before);
    }, T);
  }
});

// ===========================================================================
// AC-STE-724.8 — the step receipt
// ===========================================================================

const BUN_TOTALS = " 3 pass\n 1 skip\n 0 fail\n 4 expect() calls\nRan 4 tests across 1 file. [5.00ms]\n";
const BRANCH = "synthetic-branch-ste724";

describe("AC-STE-724.8 a run writes exactly one gate-step receipt", () => {
  test("a command exiting 3 records fail and the front door exits 3; the receipt has the documented envelope", () => {
    const root = reuseTree("ac8-exit3", "reuse", { branch: BRANCH });
    const run = mintRun(root);
    const r = runReuse(root, LABEL, "exit 3");
    expect(r.exitCode).toBe(3);
    const steps = stepReceipts(root);
    expect(steps.length).toBe(1);
    const rec = steps[0]!.record;
    expect({ kind: rec.kind, adapter: rec.adapter, container: rec.container, subject: rec.subject, decision: rec.decision }).toEqual({
      kind: "gate-step",
      adapter: null,
      container: null,
      subject: "dev-process-toolkit:gate-check",
      decision: "fail",
    });
    expect(Object.keys(rec.evidence).sort()).toEqual(["duration_ms", "exit", "key", "label", "run", "summary"]);
    expect(rec.evidence.exit).toBe(3);
    expect(rec.evidence.label).toBe(LABEL);
    expect(rec.evidence.run).toBe(receiptDigest(readFileSync(run.path)));
    expect(typeof rec.evidence.duration_ms).toBe("number");
    // The announcement the front door printed names this receipt.
    expect(announcementIn(r.stdout, STEP_PREFIX).path).toBe(steps[0]!.path);
  }, T);

  test("a passing command records pass, and its key is the live key computed before it ran", async () => {
    const root = reuseTree("ac8-pass");
    mintRun(root);
    const m = await reuseModule();
    const live = await m.computeReuseKey(root, "echo fine");
    const r = runReuse(root, LABEL, "echo fine");
    expect(r.exitCode).toBe(0);
    const steps = stepReceipts(root);
    expect(steps.length).toBe(1);
    expect(steps[0]!.record.decision).toBe("pass");
    expect(steps[0]!.record.evidence.key).toEqual(live);
  }, T);

  test("a parsable bun test output stores its totals line as the summary", async () => {
    const root = reuseTree("ac8-totals");
    mintRun(root);
    const r = runReuse(root, LABEL, `printf '${BUN_TOTALS.replace(/\n/g, "\\n")}'`);
    expect(r.exitCode).toBe(0);
    const { renderTotalsLine } = await import("../adapters/_shared/src/gate_capture");
    const expected = renderTotalsLine({ output: BUN_TOTALS, stack: "bun" } as any);
    expect(expected).toBe("gate_capture: pass 3, fail 0, skip 1");
    expect(stepReceipts(root)[0]!.record.evidence.summary).toBe(expected);
  }, T);

  test("the receipt holds no absolute path but its own root, no cwd and no branch name", () => {
    const root = reuseTree("ac8-no-paths", "reuse", { branch: BRANCH });
    mintRun(root);
    const r = runReuse(root, LABEL, `printf '${BUN_TOTALS.replace(/\n/g, "\\n")}'`, { cwd: join(root, "docs") });
    expect(r.exitCode).toBe(0);
    const rec = stepReceipts(root)[0]!.record;
    expect(rec.root).toBe(root);
    const { root: _own, ...rest } = rec;
    const text = JSON.stringify(rest);
    expect(text).not.toContain(root);
    expect(text).not.toContain(join(root, "docs"));
    expect(text).not.toContain(BRANCH);
    expect(text.match(/"\/[^"]*"|[\s=:(]\/[A-Za-z0-9._-]+\//g)).toBeNull();
  }, T);

  test("an unparsable output whose last line names a temporary absolute path stores it as <path>", () => {
    const root = reuseTree("ac8-path-token");
    mintRun(root);
    const tmp = join(tempDir("ac8-tok"), "out.log");
    const r = runReuse(root, LABEL, `echo first line; echo wrote ${tmp}`);
    expect(r.exitCode).toBe(0);
    const summary = stepReceipts(root)[0]!.record.evidence.summary;
    expect(summary).toBe("wrote <path>");
    expect(summary).not.toContain(tmp);
  }, T);

  test("an unparsable last line longer than 200 characters is cut to 200", () => {
    const root = reuseTree("ac8-cut");
    mintRun(root);
    const long = "x".repeat(260);
    const r = runReuse(root, LABEL, `echo ${long}`);
    expect(r.exitCode).toBe(0);
    expect(stepReceipts(root)[0]!.record.evidence.summary).toBe("x".repeat(200));
  }, T);
});

// ===========================================================================
// AC-STE-724.9 — a reused command reports the stored run
// ===========================================================================

describe("AC-STE-724.9 the dpt-reuse: line names the stored summary, createdAt and receipt path", () => {
  test("the printed summary equals the stored evidence.summary byte for byte", () => {
    const b = buildSession("ac9-line", { command: (s) => `touch ${s}; printf "${BUN_TOTALS.replace(/\n/g, "\\n")}"` });
    const stored = readJson(b.step.path) as Record<string, any>;
    expect(stored.evidence.summary).toBe("gate_capture: pass 3, fail 0, skip 1");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectReused(b, r);
    const expected = `${REUSE_PREFIX}${LABEL} — ${stored.evidence.summary} (stored run ${stored.createdAt}, exit 0, ${b.step.path})`;
    expect(reuseLines(r.stdout)).toEqual([expected]);
  }, T);
});

// ===========================================================================
// AC-STE-724.10 — never-reusable labels are refused
// ===========================================================================

describe("AC-STE-724.10 the front door refuses a NEVER_REUSABLE_STEPS label", () => {
  // PR #133 review: the hyphen spelling of each entry is refused too.
  for (const label of [...NEVER_REUSABLE_STEPS, ...NEVER_REUSABLE_STEPS.filter((l) => l.includes("_")).map((l) => l.replace(/_/g, "-"))]) {
    test(`label ${label}: exit 1 in NFR-10 shape, nothing run, nothing written`, () => {
      const root = reuseTree(`ac10-${label.replace(/_/g, "-")}`);
      const sentinel = join(tempDir("ac10-s"), "sentinel");
      const before = storeFileCount(root);
      const r = runReuse(root, label, `touch ${sentinel}`);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(NFR10_SHAPE);
      expect(r.stderr).toContain(label);
      expect(existsSync(sentinel)).toBe(false);
      expect(reuseLines(r.stdout)).toEqual([]);
      expect(storeFileCount(root)).toBe(before);
    }, T);
  }
});

// ===========================================================================
// AC-STE-724.11 — a gate-step receipt is never commit evidence
// ===========================================================================

describe("AC-STE-724.11 gate-step receipts satisfy no evidence reader", () => {
  async function gateReceiptModule(): Promise<AnyMod> {
    return (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
  }

  /** A tree whose store holds a run receipt and two announced front-door steps. */
  function stepsSession(label: string) {
    const root = reuseTree(label);
    stageCodeAndTest(root);
    const run = mintRun(root);
    const s1 = runReuse(root, "test", "echo one");
    const s2 = runReuse(root, "lint", "echo two");
    expect([s1.exitCode, s2.exitCode]).toEqual([0, 0]);
    expect(stepReceipts(root).length).toBe(2);
    return { root, run, s1, s2 };
  }

  test("gateReceiptEvidence misses for gate-check, spec-review and tdd on a session holding only gate-step receipts", async () => {
    const m = await gateReceiptModule();
    const f = stepsSession("ac11-reader");
    rmSync(f.run.path);
    expect(sessionReceipts(f.root).every((r) => r.record.kind === "gate-step")).toBe(true);
    for (const subject of [SKILL_OF.gate, SKILL_OF.pr, SKILL_OF.tdd]) {
      const v = m.gateReceiptEvidence(subject, f.root, SID);
      expect({ subject, ok: v.ok }).toEqual({ subject, ok: false });
      expect(v.reason).not.toBe("receipt-found");
    }
  }, T);

  test("pre-commit-gate-check through its wrapper exits 2 on a session with only announced gate-step receipts", async () => {
    const f = stepsSession("ac11-hook");
    rmSync(f.run.path);
    const tr = writeTranscript(tempDir("ac11-tr"), [
      ...skillCall("gate"),
      ...bashCall("b1", reuseCommand(f.root, "test", "echo one"), f.s1.stdout, f.s1.stderr),
      ...bashCall("b2", reuseCommand(f.root, "lint", "echo two"), f.s2.stdout, f.s2.stderr),
    ]);
    const r = await runHook("gate", f.root, tr);
    expect(r.exitCode).toBe(2);
  }, T);

  test("POSITIVE CONTROL: the same session with the gate Skill call and its announced gate run receipt exits 0", async () => {
    const f = stepsSession("ac11-permit");
    const tr = writeTranscript(tempDir("ac11-tr"), [
      ...skillCall("gate"),
      ...bashCall("b0", receiptCommand("gate-check", f.root), f.run.run.stdout, f.run.run.stderr),
      ...bashCall("b1", reuseCommand(f.root, "test", "echo one"), f.s1.stdout, f.s1.stderr),
      ...bashCall("b2", reuseCommand(f.root, "lint", "echo two"), f.s2.stdout, f.s2.stderr),
    ]);
    const r = await runHook("gate", f.root, tr);
    expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
  }, T);
});

// ===========================================================================
// AC-STE-724.12 — no hook reads any of it
// ===========================================================================

describe("AC-STE-724.12 no non-test hook file imports gate_reuse or reads gate-step / dpt-reuse:", () => {
  const NEEDLES = ["gate_reuse", "gate-step", "dpt-reuse:"];

  function nonTestFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          if (name === "__tests__" || name === "node_modules") continue;
          walk(p);
        } else if (!/\.test\.[cm]?[jt]s$/.test(name)) out.push(p);
      }
    };
    walk(dir);
    return out;
  }

  const FILES = [...nonTestFiles(join(PLUGIN_ROOT, "templates", "hooks")), ...nonTestFiles(join(PLUGIN_ROOT, "hooks"))];

  test("the scan finds zero hits", () => {
    expect(FILES.length).toBeGreaterThan(5);
    const hits = FILES.flatMap((p) => {
      const body = readFileSync(p, "utf-8");
      return NEEDLES.filter((n) => body.includes(n)).map((n) => `${p}: ${n}`);
    });
    expect(hits).toEqual([]);
  });

  test("CONTROL: the same scan finds gate_receipt imported by templates/hooks/_lib/hooks/pre-commit-gate-check.ts", () => {
    const target = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-commit-gate-check.ts");
    expect(FILES).toContain(target);
    expect(readFileSync(target, "utf-8")).toMatch(/from\s+["'][^"']*gate_receipt(\.ts)?["']/);
  });
});

// ===========================================================================
// AC-STE-724.14 — an unreadable key never blocks a gate
// ===========================================================================

describe("AC-STE-724.14 with git off PATH the command still runs and records key: null", () => {
  test("PATH stripped of git: the command runs, exits with its own status, and its receipt carries key: null", () => {
    const root = reuseTree("ac14-no-git");
    mintRun(root);
    const bin = join(tempDir("ac14-bin"), "bin");
    mkdirSync(bin, { recursive: true });
    symlinkSync(process.execPath, join(bin, "bun"));
    const PATH = `${bin}:/bin`;
    // CONTROL: git really is unreachable on that PATH.
    expect(spawnSync("/bin/sh", ["-c", "command -v git"], { env: { PATH } }).status).not.toBe(0);
    const sentinel = join(tempDir("ac14-s"), "sentinel");
    const r = runReuse(root, LABEL, `: > ${sentinel}; exit 5`, { env: { PATH } });
    expect({ code: r.exitCode, ran: existsSync(sentinel) }).toEqual({ code: 5, ran: true });
    const steps = stepReceipts(root);
    expect(steps.length).toBe(1);
    expect(steps[0]!.record.evidence.key).toBeNull();
    expect(steps[0]!.record.decision).toBe("fail");
  }, T);
});

// ===========================================================================
// AC-STE-724.15 — no session id
// ===========================================================================

describe("AC-STE-724.15 with CLAUDE_CODE_SESSION_ID unset the front door runs and records nothing", () => {
  test("unset: runs, writes no receipt, prints no dpt-reuse:, names CLAUDE_CODE_SESSION_ID, exits with the command's status", () => {
    const b = buildSession("ac15-unset");
    const before = storeFileCount(b.root);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg, sid: null });
    expectRan(b, r);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
    expect(storeFileCount(b.root)).toBe(before);
    const sentinel = join(tempDir("ac15-s"), "sentinel");
    const r2 = runReuse(b.root, LABEL, `touch ${sentinel}; exit 4`, { cfg: b.cfg, sid: null });
    expect({ code: r2.exitCode, ran: existsSync(sentinel) }).toEqual({ code: 4, ran: true });
    expect(storeFileCount(b.root)).toBe(before);
  }, T);

  test("empty: the same as unset", () => {
    const root = reuseTree("ac15-empty");
    const sentinel = join(tempDir("ac15-e"), "sentinel");
    const before = storeFileCount(root);
    const r = runReuse(root, LABEL, `touch ${sentinel}; exit 2`, { sid: "" });
    expect({ code: r.exitCode, ran: existsSync(sentinel), reuse: reuseLines(r.stdout) }).toEqual({ code: 2, ran: true, reuse: [] });
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
    expect(storeFileCount(root)).toBe(before);
  }, T);

  test("AC-STE-724.15 (unsafe session id): runs, exits with the command's status, writes no receipt, prints no dpt-reuse:, names CLAUDE_CODE_SESSION_ID, no stack trace", () => {
    const root = reuseTree("ac15-unsafe");
    const sentinel = join(tempDir("ac15-u"), "sentinel");
    const before = storeFileCount(root);
    // CONTROL: `../x` is a session id receiptsDir refuses (it carries a `/`).
    expect(/^[A-Za-z0-9._-]+$/.test("../x")).toBe(false);
    const r = runReuse(root, LABEL, `touch ${sentinel}; exit 4`, { sid: "../x" });
    expect({ code: r.exitCode, ran: existsSync(sentinel), reuse: reuseLines(r.stdout) }).toEqual({ code: 4, ran: true, reuse: [] });
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
    expect(r.stderr.split("\n").filter((l) => /^ {4}at /.test(l))).toEqual([]);
    expect(storeFileCount(root)).toBe(before);
  }, T);
});

// ===========================================================================
// AC-STE-724.16 — synthetic ids only
// ===========================================================================

describe("AC-STE-724.16 the new test files carry synthetic ids only", () => {
  const FILES = [
    "m_fd9a03-ste-724-reuse-key.test.ts",
    "m_fd9a03-ste-724-gate-reuse.test.ts",
    "m_fd9a03-ste-724-gate-reuse-prose.test.ts",
  ].map((n) => join(PLUGIN_ROOT, "tests", n));
  // Built from parts so this file does not carry the needles it greps for.
  const HOME_NEEDLES = ["/" + "Users/", "/" + "home/"];
  const UUID = new RegExp(["[0-9a-f]{8}", "[0-9a-f]{4}", "[0-9a-f]{4}", "[0-9a-f]{4}", "[0-9a-f]{12}"].join("-"), "i");

  function violations(text: string): string[] {
    const out = HOME_NEEDLES.filter((n) => text.includes(n));
    const u = UUID.exec(text);
    if (u !== null) out.push(u[0]);
    return out;
  }

  test("no fixture carries a home-directory path or a UUID-shaped session id", () => {
    for (const f of FILES) {
      expect(existsSync(f)).toBe(true);
      expect({ f, v: violations(readFileSync(f, "utf-8")) }).toEqual({ f, v: [] });
    }
  });

  test("CONTROL: the scan reds on a planted home path and a planted UUID", () => {
    expect(violations(`const p = "${HOME_NEEDLES[0]}someone/x";`).length).toBe(1);
    expect(violations(`sid: "${["0a1b2c3d", "0000", "4000", "8000", "0123456789ab"].join("-")}"`).length).toBe(1);
  });
});

// ===========================================================================
// AC-STE-724.18 — mutation controls: each check is load-bearing
// ===========================================================================
//
// Each row copies the plugin to a temp dir, applies ONE text mutation to the
// copy (`mutateCopy` throws when its pattern matches nothing), and runs the
// named test's scenario twice on the same fixture: through an UNMUTATED copy
// (which behaves as the shipped module: the command runs) and through the
// MUTATED copy (which now reuses, or writes, or loads what the named test
// forbids). The transcript spells every front door as
// `${CLAUDE_PLUGIN_ROOT}/…`, which each copy expands to its own root, so a
// copy vouches the same announcements the shipped module does.

type Edit = [file: string, re: RegExp, to: string | ((m: string) => string)];

/** A plugin copy with `edits` applied; returns its src dir. Each edit throws when it matches nothing. */
function mutatedCopy(label: string, edits: readonly Edit[]): string {
  const src = join(pluginCopy(`ste724-ac18-${label}`), "adapters", "_shared", "src");
  for (const [file, re, to] of edits) {
    const p = join(src, file);
    const body = readFileSync(p, "utf-8");
    if (!re.test(body)) throw new Error(`mutation did not apply: ${re} matched nothing in ${p}`);
    writeFileSync(p, body.replace(re, to as string));
  }
  return src;
}

const reuseDoor = (src: string): string => join(src, "gate_reuse.ts");

/** One front-door call through `door`, graded: did the command run, was a pass reused, how many store files it added. */
function graded(b: Built, door: string): { ran: boolean; reused: boolean; wrote: number } {
  rmSync(b.sentinel, { force: true });
  const before = storeFileCount(b.root);
  const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg, frontDoor: door });
  const out = { ran: existsSync(b.sentinel), reused: reuseLines(r.stdout).length === 1, wrote: storeFileCount(b.root) - before };
  rmSync(b.sentinel, { force: true });
  return out;
}

const RAN = { ran: true, reused: false };
const REUSED = { ran: false, reused: true };
const pick = (g: { ran: boolean; reused: boolean }) => ({ ran: g.ran, reused: g.reused });

describe("AC-STE-724.18 mutation controls: each check reds a named test", () => {
  let plain: string | null = null;
  const unmutated = (): string => (plain ??= reuseDoor(mutatedCopy("plain", [])));

  test("control: an unmutated copy grades as the real module does (genuine pass reused, step-unannounced session runs)", () => {
    const b = buildSession("ac18-control");
    expect(pick(graded(b, GATE_REUSE))).toEqual(REUSED);
    expect(pick(graded(b, unmutated()))).toEqual(REUSED);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.outcome]);
    expect(pick(graded(b, GATE_REUSE))).toEqual(RAN);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
  }, T);

  test("AC-STE-724.18 mutation: knob check — removing it turns 'AC-STE-724.6 knob off (absent): ... writes no receipt' red", () => {
    const door = reuseDoor(
      mutatedCopy("knob", [["gate_reuse.ts", /function knobOn\(root: string\): boolean \{/, (m) => `${m}\n  if (root !== "") return true;`]]),
    );
    const b = buildSession("ac18-knob");
    setKnob(b.root, "absent");
    expect(graded(b, unmutated())).toEqual({ ...RAN, wrote: 0 });
    // Mutated: the knob reads on, so a step receipt (and its step log) is written with the knob absent.
    expect(graded(b, door)).toEqual({ ...RAN, wrote: 2 });
  }, T);

  test("AC-STE-724.18 mutation: tree-clean check — removing it lets a dirty tree's stored pass be reused", () => {
    // Both reads of git status are the clean check: the key's own and the trusted re-read.
    const door = reuseDoor(
      mutatedCopy("clean", [
        ["gate_reuse.ts", /if \(gate\.head === null \|\| !gate\.clean\) return null;/, "if (gate.head === null) return null;"],
        ["gate_reuse.ts", /if \(trustedGit\(root, \["status", [^\n]*\n/, ""],
      ]),
    );
    // The stored pass is minted by the mutated copy on a tree dirty for the whole session.
    const b = buildSession("ac18-clean", { dirty: true, frontDoor: door });
    expect(isClean(b.root)).toBe(false);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: transcript-announcement check — removing it turns 'the step announcement absent from the transcript runs the command' red", () => {
    const door = reuseDoor(mutatedCopy("ann", [["gate_reuse.ts", /stepVouched\(s, f\)/g, "true"]]));
    const b = buildSession("ac18-ann");
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.outcome]);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: announcesGateStep provenance — removing it turns 'forgery: a step announcement printed by a same-named gate_reuse.ts outside the plugin' red", () => {
    const door = reuseDoor(
      mutatedCopy("step-prov", [["gate_reuse.ts", /run\.module === OWN_FRONT_DOOR && run\.args\[0\] === "run"/, 'run.args[0] === "run"']]),
    );
    const b = buildSession("ac18-step-prov");
    const outside = join(tempDir("ac18-outside"), "gate_reuse.ts");
    writeFileSync(outside, "// not the front door\n");
    const cmd = reuseCommand(b.root, LABEL, b.cmd, `"${outside}"`);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...bashCall("b1", cmd, b.step.stdout), ...b.records.outcome]);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: runsGateOutcome provenance — removing it turns 'forgery: a hand-written gate-outcome announced by echo' red", () => {
    const door = reuseDoor(
      mutatedCopy("outcome-prov", [
        ["gate_receipt.ts", /export function runsGateOutcome\(command: string\): boolean \{/, (m) => `${m}\n  if (command !== "") return true;`],
      ]),
    );
    const b = buildSession("ac18-outcome-prov");
    const forged = join(receiptDirOf(b.root), "9999-forged-outcome.json");
    writeFileSync(forged, readFileSync(b.outcome.path));
    rmSync(b.outcome.path);
    const line = `${OUTCOME_PREFIX}${forged} sha256:${receiptDigest(readFileSync(forged))}`;
    retranscribe(b, [...b.records.skill, ...b.records.run, ...b.records.step, ...bashCall("b2", `echo '${line}'`, `${line}\n`)]);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: run outcome check (decision pass / key_stable) — removing it turns the outcome-fail and key_stable-false rows red", () => {
    const door = reuseDoor(
      mutatedCopy("outcome-pass", [
        ["gate_reuse.ts", /if \(outcome\?\.record\.decision !== "pass" \|\| outcome\.record\.evidence\?\.key_stable !== true\) return null;/, "if (outcome === undefined) return null;"],
      ]),
    );
    for (const [name, o] of [
      ["fail", { outcome: "fail" }],
      ["unstable", { unstableOutcome: true }],
    ] as const) {
      const b = buildSession(`ac18-outcome-${name}`, o);
      expect({ name, g: pick(graded(b, unmutated())) }).toEqual({ name, g: RAN });
      expect({ name, g: pick(graded(b, door)) }).toEqual({ name, g: REUSED });
    }
  }, T);

  test("AC-STE-724.18 mutation: run outcome check (run reference) — removing it turns 'no gate-outcome receipt references the run' red", () => {
    const door = reuseDoor(
      mutatedCopy("outcome-ref", [
        ["gate_reuse.ts", /return passedRunLabels\(s, r\.evidence\?\.run\)\?\.has\(r\.evidence\?\.label\) === true;/, "return true;"],
      ]),
    );
    const b = buildSession("ac18-outcome-ref", { outcome: "none" });
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: index-flag check — removing it turns 'AC-STE-724.3 (hidden edit, skip-worktree)' red", () => {
    const door = reuseDoor(
      mutatedCopy("index-flags", [["gate_reuse.ts", /if \(hiddenIndexEntries\(trustedGit\(root, \["ls-files", "-v"\]\)\)\.length > 0\) return true;/, ""]]),
    );
    const b = buildSession("ac18-index-flags");
    writeFileSync(join(b.root, "docs", "readme.txt"), "edited after the stored pass\n");
    git(b.root, "update-index", "--skip-worktree", "docs/readme.txt");
    expect(isClean(b.root)).toBe(true);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: newest-step check — removing it turns 'AC-STE-724.5 (newest step): S1 pass, S2 fail' red", () => {
    // The newest vouched step and the newer-fail check are one rule; removing both lets S1 shadow S2.
    const door = reuseDoor(
      mutatedCopy("newest", [
        [
          "gate_reuse.ts",
          /const f = newestStep\(session, label, key\);/,
          "const f = [...session.files].reverse().find((x) => x.record.evidence?.label === label && stepStands(session, x, key));",
        ],
        ["gate_reuse.ts", /if \(failedSince\(s, f, liveKey\)\) return false;/, ""],
      ]),
    );
    const b = passThenFailSession("ac18-newest", "success");
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: newer-fail check — removing it turns 'S1 pass, S2 fail recorded in the REAL error shape' red", () => {
    const door = reuseDoor(mutatedCopy("failed-since", [["gate_reuse.ts", /if \(failedSince\(s, f, liveKey\)\) return false;/, ""]]));
    const b = passThenFailSession("ac18-failed-since", "error");
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: error-shaped door call capture — removing it turns 'a later error-shaped door call for the label with NO stored receipt' red", () => {
    const door = reuseDoor(mutatedCopy("failed-calls", [["gate_reuse.ts", /if \(label !== null\) failedCalls\.push\(\{ label, line: at \}\);/, ""]]));
    const b = passThenFailSession("ac18-failed-calls", "error");
    rmSync(stepReceipts(b.root).find((x) => x.record.decision === "fail")!.path);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: trusted-git flags — dropping core.fsmonitor=false turns 'AC-STE-724.3 (hidden edit, fsmonitor)' red", () => {
    const door = reuseDoor(mutatedCopy("fsmonitor", [["gate_reuse.ts", /"-c", "core\.fsmonitor=false", /, ""]]));
    const b = buildSession("ac18-fsmonitor");
    lyingFsmonitor(b.root);
    writeFileSync(join(b.root, "docs", "readme.txt"), "EDITED-WI");
    expect(isClean(b.root)).toBe(true);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: filter check — removing it turns 'AC-STE-724.3 (hidden edit, clean filter)' red", () => {
    const door = reuseDoor(
      mutatedCopy("filters", [["gate_reuse.ts", /return configuredFilters\(root, trustedGit\(root, \["ls-files", "-z"\]\)\)\.length > 0;/, "return false;"]]),
    );
    const b = buildSession("ac18-filters");
    lyingCleanFilter(b.root, "docs/readme.txt");
    const file = join(b.root, "docs", "readme.txt");
    writeFileSync(file, readFileSync(file, "utf-8").replace(/[^\n]/g, "X"));
    git(b.root, "update-index", "--refresh");
    expect(isClean(b.root)).toBe(true);
    expect(pick(graded(b, unmutated()))).toEqual(RAN);
    expect(pick(graded(b, door))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.18 mutation: outcome-switch guard before the reuse: on read — removing it turns 'marker copy: optimizations_config.ts is not loaded with the outcome switch off' red", () => {
    const mark = (src: string, label: string): string => {
      const mod = join(src, "optimizations_config.ts");
      const marker = join(tempDir(`${label}-m`), "loaded");
      writeFileSync(mod, `import { writeFileSync as __markLoaded } from "node:fs";\n__markLoaded(${JSON.stringify(marker)}, "loaded\\n");\n${readFileSync(mod, "utf-8")}`);
      return marker;
    };
    const plainSrc = mutatedCopy("guard-plain", []);
    const plainMarker = mark(plainSrc, "ac18-guard-plain");
    const src = mutatedCopy("guard", [
      ["gate_receipt.ts", /if \(!receiptCarriesKey\(path\)\) return;\s*console\.log\("outcome: on"\);/, 'if (receiptCarriesKey(path)) console.log("outcome: on");'],
    ]);
    const marker = mark(src, "ac18-guard");
    const root = settingsTree("ac18-guard-tree", "false", SETTINGS.outcomesOff);

    const a = mintRun(root, "gate-check", { frontDoor: join(plainSrc, "gate_receipt.ts") });
    expect({ stdout: a.run.stdout, loaded: existsSync(plainMarker) }).toEqual({ stdout: `${ann(a.path)}\n`, loaded: false });
    // Mutated: still one line, but optimizations_config.ts loads with the outcome switch off.
    const m = mintRun(root, "gate-check", { frontDoor: join(src, "gate_receipt.ts") });
    expect({ stdout: m.run.stdout, loaded: existsSync(marker) }).toEqual({ stdout: `${ann(m.path)}\n`, loaded: true });
  }, T);
});

// ===========================================================================
// AC-STE-724.20 — the receipt call prints `reuse: on`
// ===========================================================================

function settingsTree(label: string, state: SwitchState, settings: string | null): string {
  const root = managedTree(label, state);
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
    git(root, "add", "-A");
    git(root, "commit", "-q", "--allow-empty", "-m", "settings");
  }
  return root;
}

const ann = (path: string): string => `${RECEIPT_PREFIX}${path} sha256:${receiptDigest(readFileSync(path))}`;

describe("AC-STE-724.20 the gate-check receipt call prints reuse: on only with the knob effective", () => {
  test("outcomes on and gate_commands: reuse: exactly three lines, the announcement, outcome: on, reuse: on", () => {
    const root = settingsTree("ac20-three", "on", SETTINGS.reuse);
    const { run, path } = mintRun(root);
    expect(run.stdout).toBe(`${ann(path)}\noutcome: on\nreuse: on\n`);
  }, T);

  for (const knob of ["absent", "run", "invalid"] as const) {
    test(`outcomes on, knob ${knob}: exactly two lines`, () => {
      const root = settingsTree(`ac20-two-${knob}`, "on", SETTINGS[knob]);
      const { run, path } = mintRun(root);
      expect(run.stdout).toBe(`${ann(path)}\noutcome: on\n`);
    }, T);
  }

  const OFF: Array<[SwitchState, string | null]> = [
    ["false", SETTINGS.outcomesOff],
    ["absent", SETTINGS_HEAD + KNOB_REUSE],
    ["legacy", null],
    ["none", null],
  ];
  for (const [state, settings] of OFF) {
    test(`outcome switch off (${state}): one line, its v3.0.0 bytes`, () => {
      const root = settingsTree(`ac20-one-${state}`, state, settings);
      const { run, path } = mintRun(root);
      expect(run.stdout).toBe(`${ann(path)}\n`);
    }, T);
  }

  for (const skill of ["tdd", "spec-review"]) {
    test(`a ${skill} receipt call never prints reuse: on, even with the knob at reuse`, () => {
      const root = settingsTree(`ac20-${skill}`, "on", SETTINGS.reuse);
      const { run, path } = mintRun(root, skill);
      expect(run.stdout.split("\n")).not.toContain("reuse: on");
      expect(run.stdout).toBe(`${ann(path)}\noutcome: on\n`);
    }, T);
  }

  /** A plugin copy whose optimizations_config.ts writes a marker file when loaded. */
  function markerCopy(label: string): { door: string; marker: string } {
    const copy = pluginCopy(label);
    const mod = join(copy, "adapters", "_shared", "src", "optimizations_config.ts");
    const marker = join(tempDir(`${label}-m`), "loaded");
    const body = readFileSync(mod, "utf-8");
    writeFileSync(mod, `import { writeFileSync as __markLoaded } from "node:fs";\n__markLoaded(${JSON.stringify(marker)}, "loaded\\n");\n${body}`);
    return { door: join(copy, "adapters", "_shared", "src", "gate_receipt.ts"), marker };
  }

  test("marker copy: optimizations_config.ts is not loaded with the outcome switch off", () => {
    const { door, marker } = markerCopy("ac20-marker-off");
    const root = settingsTree("ac20-marker-off-tree", "false", SETTINGS.outcomesOff);
    const { run, path } = mintRun(root, "gate-check", { frontDoor: door });
    expect(run.stdout).toBe(`${ann(path)}\n`);
    expect(existsSync(marker)).toBe(false);
  }, T);

  test("CONTROL: the marker copy does write its marker with the outcome switch on and the knob at reuse", () => {
    const { door, marker } = markerCopy("ac20-marker-on");
    const root = settingsTree("ac20-marker-on-tree", "on", SETTINGS.reuse);
    const { run, path } = mintRun(root, "gate-check", { frontDoor: door });
    expect(run.stdout).toBe(`${ann(path)}\noutcome: on\nreuse: on\n`);
    expect(existsSync(marker)).toBe(true);
  }, T);

  test("a broken optimizations module prints two lines and exits 0", () => {
    const copy = pluginCopy("ac20-broken");
    writeFileSync(join(copy, "adapters", "_shared", "src", "optimizations_config.ts"), 'throw new Error("broken optimizations module");\n');
    const door = join(copy, "adapters", "_shared", "src", "gate_receipt.ts");
    const root = settingsTree("ac20-broken-tree", "on", SETTINGS.reuse);
    const run = runCli(["gate-check", root], { frontDoor: door });
    expect(run.exitCode).toBe(0);
    const path = parseAnnouncement(run.stdout.split("\n")[0] ?? "", RECEIPT_PREFIX)!.path;
    expect(run.stdout).toBe(`${ann(path)}\noutcome: on\n`);
  }, T);

  test("the AC-STE-715.13 two-line literal carries its Amended by AC-STE-724.20 comment", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "tests", "m_7bc805-ste-715-outcome-front-door.test.ts"), "utf-8").split("\n");
    const at = src.findIndex((l) => l.includes("sha256:${sha(readFileSync(path))}\\noutcome: on\\n`)"));
    expect(at).toBeGreaterThan(0);
    const window = src.slice(Math.max(0, at - 3), at + 1).join("\n");
    expect(window).toContain("// Amended by AC-STE-724.20: two lines -> three when reuse is on.");
  });
});

// ===========================================================================
// Hardening rows — self-forgery, path scrub, signal, timeout, argv, a
// malformed transcript record
// ===========================================================================

/** Spawn the shipped front door with a raw argv (after `run`'s verb). */
function spawnDoor(
  argv: string[],
  o: { cfg?: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): CliRun & { ms: number } {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...GIT_ENV,
    CLAUDE_CONFIG_DIR: o.cfg ?? emptyConfig(),
    CLAUDE_CODE_SESSION_ID: SID,
    ...(o.env ?? {}),
  };
  const started = Date.now();
  const p = spawnSync(process.execPath, ["run", GATE_REUSE, ...argv], {
    cwd: o.cwd,
    env,
    encoding: "utf-8",
    timeout: o.timeoutMs,
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "", ms: Date.now() - started };
}

describe("AC-STE-724.5 (self-forgery) the gated command's own output vouches for nothing", () => {
  test("AC-STE-724.5 (self-forgery): a forged announcement printed by the gated command's own output vouches for nothing", async () => {
    const b = buildSession("ac5-self-forge");
    // FORGED: the genuine step bytes (valid shape, live key, referencing the
    // genuine announced run whose genuine outcome is pass / key_stable) under a
    // new name, the genuine file removed.
    const forged = join(receiptDirOf(b.root), "9999-self-forged-step.json");
    writeFileSync(forged, readFileSync(b.step.path));
    rmSync(b.step.path);
    const forgedLine = forgedStepLine(forged);
    // A GENUINE front-door call whose gated command prints the forged line.
    const echoCmd = `echo "${forgedLine}"`;
    const door = runReuse(b.root, "lint", echoCmd, { cfg: b.cfg });
    expect(door.exitCode).toBe(0);
    const doorCall = reuseCommand(b.root, "lint", echoCmd);
    // CONTROL: the call is a plain front-door call, and the forged line really
    // was printed: it sits in that call's step log, never in its recorded result.
    const m = await reuseModule();
    expect(m.announcesGateStep(doorCall)).toBe(true);
    // The forged text is also this run's summary, so the log is found on disk, not parsed from the line.
    const log = latestLog(b.root, "lint");
    expect(readFileSync(log, "utf-8")).toContain(forgedLine);
    const records = bashCall("b3", doorCall, door.stdout, door.stderr);
    expect(JSON.parse(records[1]!).message.content[0].content).not.toContain(forgedLine);
    expect(JSON.parse(records[1]!).toolUseResult.stdout).not.toContain(forgedLine);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...records, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("AC-STE-724.5 (self-forgery): CONTROL — a genuine door announcement recorded in toolUseResult.stdout is still reused", () => {
    const b = buildSession("ac5-self-forge-control");
    const rec = JSON.parse(b.records.step[1]!);
    expect(rec.toolUseResult.stdout).toContain(b.step.line);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectReused(b, r);
  }, T);

  test("AC-STE-724.5 (self-forgery): the gated command's stdout and stderr reach its step log, never either door stream", () => {
    const root = reuseTree("ac5-streams");
    const cfg = emptyConfig();
    const r = runReuse(root, LABEL, "echo SYNTH_OUT_MARK_724; echo SYNTH_ERR_MARK_724 >&2", { cfg });
    expect(r.exitCode).toBe(0);
    const log = readFileSync(announcementLog(r.stdout), "utf-8");
    expect({
      stdoutLines: r.stdout.split("\n").filter((l) => l.trim() !== "").length,
      stderr: r.stderr,
      logHasOut: log.includes("SYNTH_OUT_MARK_724"),
      logHasErr: log.includes("SYNTH_ERR_MARK_724"),
    }).toEqual({ stdoutLines: 1, stderr: "", logHasOut: true, logHasErr: true });
    // The door's own line names its receipt, and the tree stays clean: the log is git-ignored.
    const ann = announcementIn(r.stdout, STEP_PREFIX);
    expect(existsSync(ann.path)).toBe(true);
    expect(isClean(root)).toBe(true);
  }, T);
});

// ===========================================================================
// Operator ruling 2026-11-09 (PR #133 review B3): the door prints ONE line and
// the gated command's output lives in its step log.
// ===========================================================================

/** The newest step log for `label` in this session's log directory. */
function latestLog(root: string, label: string): string {
  const dir = join(root, ".dpt", "ledger", "gate-steps", SID);
  const names = readdirSync(dir).filter((n) => n.endsWith(`-${label}.log`)).sort();
  if (names.length === 0) throw new Error(`no ${label} log under ${dir}`);
  return join(dir, names[names.length - 1]!);
}

/** The log path the door's one step line names. */
function announcementLog(stdout: string): string {
  const m = /^dpt-gate-step: \S+ exit \d+ — .*?, log (\S.*?), read the log on failure, receipt /m.exec(stdout);
  if (m === null) throw new Error(`no step line in: ${stdout}`);
  return m[1]!;
}

/** A bun-test-style run: a pass line on stdout, noise on stderr, then the totals block. Double quotes only: the transcript wraps the command in single quotes. */
const NOISY = [
  'echo "bun test v1.3.0 (synthetic)"',
  'echo "tests/a.test.ts:" >&2',
  'echo "(pass) a > one [0.10ms]" >&2',
  'echo "(pass) a > two [0.20ms]" >&2',
  'echo "" >&2',
  'echo " 2 pass" >&2',
  'echo " 0 fail" >&2',
  'echo " 4 expect() calls" >&2',
  'echo "Ran 2 tests across 1 file. [12.00ms]" >&2',
].join("; ");

describe("AC-STE-724.5 (log file): the door prints one line naming its log, its exit and the read-on-failure hint", () => {
  test("AC-STE-724.5 (log file): a failing command's one line names the exit, a log under .dpt/ledger/gate-steps/<session>/ and read the log on failure", () => {
    const root = reuseTree("b3-fail-line");
    const r = runReuse(root, "lint", "echo SYNTH_FAIL_DETAIL; exit 4", { cfg: emptyConfig() });
    expect(r.exitCode).toBe(4);
    const lines = r.stdout.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBe(1);
    expect(r.stderr).toBe("");
    expect(lines[0]!).toStartWith(`${STEP_PREFIX}lint exit 4 — SYNTH_FAIL_DETAIL, log `);
    expect(lines[0]!).toContain(", read the log on failure, receipt ");
    const log = announcementLog(r.stdout);
    expect(log.startsWith(join(realpathOf(root), ".dpt", "ledger", "gate-steps", SID) + "/")).toBe(true);
    expect(log).toEndWith("-lint.log");
    expect(readFileSync(log, "utf-8")).toBe("SYNTH_FAIL_DETAIL\n");
    expect(stepReceipts(root)[0]!.record.evidence.exit).toBe(4);
  }, T);

  test("AC-STE-724.5 (log file): a noisy bun-test-style command in a REAL-shape record (stderr inside toolUseResult.stdout) is vouched and reused", () => {
    const b = buildSession("b3-noisy", { command: (s) => `touch ${s}; ${NOISY}` });
    // The real shape: whatever the process wrote to either stream sits in toolUseResult.stdout.
    const rec = JSON.parse(b.records.step[1]!);
    expect(rec.toolUseResult.stderr).toBe("");
    expect(rec.toolUseResult.stdout).toBe(`${b.step.stdout}${b.step.stderr}`);
    expect(String(rec.toolUseResult.stdout).split("\n").filter((l: string) => l.trim() !== "")).toEqual([b.step.line]);
    // The noise really ran: it is in the step log.
    expect(readFileSync(announcementLog(b.step.stdout), "utf-8")).toContain("Ran 2 tests across 1 file.");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectReused(b, r);
  }, T);

  test("AC-STE-724.5 (log file): CONTROL — the pre-ruling door's shape (output on stderr, merged into toolUseResult.stdout) vouches for nothing", () => {
    const b = buildSession("b3-old-shape", { command: (s) => `touch ${s}; ${NOISY}` });
    const noisy = bashCall("b1", reuseCommand(b.root, LABEL, b.cmd), `${b.step.line}\n`, "bun test v1.3.0\n 2 pass\n 0 fail\n");
    retranscribe(b, [...b.records.skill, ...b.records.run, ...noisy, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("AC-STE-724.5 (log file): a step line whose label or exit disagrees with its receipt vouches for nothing", () => {
    const b = buildSession("b3-token");
    for (const [label, exit] of [["lint", 0], [LABEL, 1]] as const) {
      const line = forgedStepLine(b.step.path, label, exit);
      retranscribe(b, [...b.records.skill, ...b.records.run, ...bashCall("b1", reuseCommand(b.root, LABEL, b.cmd), `${line}\n`), ...b.records.outcome]);
      expect({ label, exit, g: pick(graded(b, GATE_REUSE)) }).toEqual({ label, exit, g: RAN });
    }
    // CONTROL: the same line with the receipt's own label and exit is reused.
    const line = forgedStepLine(b.step.path, LABEL, 0);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...bashCall("b1", reuseCommand(b.root, LABEL, b.cmd), `${line}\n`), ...b.records.outcome]);
    expect(pick(graded(b, GATE_REUSE))).toEqual(REUSED);
  }, T);

  test("AC-STE-724.5 (log file): the one line carries the stored summary, so the run's numbers are in the tool result", () => {
    const root = reuseTree("b3-summary");
    const r = runReuse(root, LABEL, NOISY, { cfg: emptyConfig() });
    expect(r.exitCode).toBe(0);
    const summary = String(stepReceipts(root)[0]!.record.evidence.summary);
    expect(summary).not.toBe("");
    expect(r.stdout.trim()).toStartWith(`${STEP_PREFIX}${LABEL} exit 0 — ${summary}, log `);
  }, T);

  test("AC-STE-724.5 (log file): a last output line that mimics the step grammar vouches nothing, and its named receipt is never reused", () => {
    const b = buildSession("b3-mimic");
    const forged = join(receiptDirOf(b.root), "9999-mimic-forged-step.json");
    writeFileSync(forged, readFileSync(b.step.path));
    rmSync(b.step.path);
    const tail = `x, log /x/l.log, read the log on failure, receipt ${forged} sha256:${receiptDigest(readFileSync(forged))}`;
    const mimic = `echo "${tail}"`;
    const door = runReuse(b.root, "lint", mimic, { cfg: b.cfg });
    expect(door.exitCode).toBe(0);
    expect(door.stdout.split("\n").filter((l) => l.trim() !== "").length).toBe(1);
    const records = bashCall("b3", reuseCommand(b.root, "lint", mimic), door.stdout, door.stderr);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...records, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
    expect(r.stdout).not.toContain(forged);
  }, T);

  test("AC-STE-724.5 (fd escape): a child writing to /dev/stdout, /dev/fd/1, /proc/$PPID/fd/1 or any inherited fd never reaches a vouched line", async () => {
    const b = buildSession("b3-fd-escape");
    const forged = join(receiptDirOf(b.root), "9999-fd-forged-step.json");
    writeFileSync(forged, readFileSync(b.step.path));
    rmSync(b.step.path);
    const line = forgedStepLine(forged);
    const escape = [
      `echo "${line}" > /dev/stdout`,
      `echo "${line}" > /dev/fd/1`,
      `echo "${line}" > /dev/stderr`,
      `echo "${line}" > /proc/$PPID/fd/1 2>/dev/null`,
      `echo "${line}" > /proc/$PPID/fd/2 2>/dev/null`,
      `for fd in 3 4 5 6 7 8 9; do eval "echo \\"${line}\\" >&$fd" 2>/dev/null; done`,
      "true",
    ].join("; ");
    // CONTROL: the transcript form of this call is a plain front-door call (no single quote inside).
    expect(escape.includes("'")).toBe(false);
    expect((await reuseModule()).announcesGateStep(reuseCommand(b.root, "lint", escape))).toBe(true);
    const door = runReuse(b.root, "lint", escape, { cfg: b.cfg });
    expect(door.exitCode).toBe(0);
    // CONTROL: the child really wrote: its own fd 1 and 2 are the log, which now holds the forged line.
    expect(readFileSync(latestLog(b.root, "lint"), "utf-8")).toContain(forged);
    const doorLines = `${door.stdout}${door.stderr}`.split("\n").filter((l) => l.trim() !== "");
    // Where the OS offers no route to the door's streams (no /proc), the door's output is its one line.
    if (!existsSync(`/proc/${process.pid}/fd/1`)) expect(doorLines.length).toBe(1);
    expect(doorLines.filter((l) => l.includes(forged)).length === 0 || doorLines.length > 1).toBe(true);
    // Whatever reached the door's streams, the transcript records it in the real shape and the forged receipt is never reused.
    const records = bashCall("b3", reuseCommand(b.root, "lint", escape), door.stdout, door.stderr);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...records, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
    expect(r.stdout).not.toContain(forged);
  }, T);
});

describe("AC-STE-724.8 hardening: path scrub and a signal-killed command", () => {
  test("AC-STE-724.8 (path scrub): an unparsable last line stores no /tmp/ substring; each absolute path token becomes <path>", () => {
    const root = reuseTree("ac8-scrub");
    const line = "error at file=/tmp/x/y.ts (/tmp/x/z.ts:3) '/tmp/q'";
    const r = runReuse(root, LABEL, `printf '%s\\n' "${line}"; exit 1`, { cfg: emptyConfig() });
    expect(r.exitCode).toBe(1);
    const steps = stepReceipts(root);
    expect(steps.length).toBe(1);
    const summary = String(steps[0]!.record.evidence.summary);
    expect(summary).not.toContain("/tmp/");
    expect(summary.split("<path>").length - 1).toBe(3);
    expect(summary.startsWith("error at file=<path>")).toBe(true);
    // The whole stored receipt carries no /tmp/x or /tmp/q token either.
    expect(readFileSync(steps[0]!.path, "utf-8")).not.toMatch(/\/tmp\/(x|q)\b/);
  }, T);

  test("AC-STE-724.8 (signal): a command killed by a signal records fail and the door exits non-zero", () => {
    const root = reuseTree("ac8-signal");
    const r = runReuse(root, LABEL, "kill -9 $$", { cfg: emptyConfig() });
    expect(r.exitCode).not.toBe(0);
    const steps = stepReceipts(root);
    expect(steps.length).toBe(1);
    expect(steps[0]!.record.decision).toBe("fail");
    expect(steps[0]!.record.evidence.exit).not.toBe(0);
  }, T);
});

describe("AC-STE-724.14 hardening: a run past its bound and a malformed transcript record", () => {
  test("AC-STE-724.14 (timeout): a command backgrounding a pipe-holding sleep makes the door exit non-zero within a few seconds and record fail", () => {
    const root = reuseTree("ac14-timeout");
    const r = spawnDoor(["run", root, LABEL, "--", "sleep 30 & sleep 30"], {
      cwd: root,
      env: { DPT_GATE_TIMEOUT_MS: "1000", DPT_GATE_KILL_GRACE_MS: "500" },
      timeoutMs: 25_000,
    });
    expect(r.ms).toBeLessThan(10_000);
    expect(r.exitCode).not.toBe(0);
    expect(r.exitCode).not.toBe(-1);
    const steps = stepReceipts(root);
    expect(steps.length).toBe(1);
    expect(steps[0]!.record.decision).toBe("fail");
  }, T);

  test("AC-STE-724.14 (decide throws): a transcript holding a malformed record still runs the command and exits with its status", () => {
    const b = buildSession("ac14-malformed");
    writeFileSync(b.transcript, `${readFileSync(b.transcript, "utf-8")}42\nnull\n"a string"\n[1,2]\n{not json\n`);
    const cmd = `touch ${b.sentinel}; exit 3`;
    const r = runReuse(b.root, LABEL, cmd, { cfg: b.cfg });
    expect({ ran: existsSync(b.sentinel), code: r.exitCode, reuse: reuseLines(r.stdout) }).toEqual({ ran: true, code: 3, reuse: [] });
  }, T);
});

describe("AC-STE-724.10 hardening: the argv after --", () => {
  test("AC-STE-724.10 (argv): more than one argument after -- is refused in NFR-10 shape, nothing run", () => {
    const root = reuseTree("ac10-argv-many");
    const sentinel = join(tempDir("ac10-argv-many-s"), "sentinel");
    const before = storeFileCount(root);
    const r = spawnDoor(["run", root, LABEL, "--", "touch", sentinel], { cwd: root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(NFR10_SHAPE);
    expect(existsSync(sentinel)).toBe(false);
    expect(storeFileCount(root)).toBe(before);
  }, T);

  test("AC-STE-724.10 (argv): zero arguments after -- is refused in NFR-10 shape, nothing run", () => {
    const root = reuseTree("ac10-argv-none");
    const before = storeFileCount(root);
    const r = spawnDoor(["run", root, LABEL, "--"], { cwd: root });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(NFR10_SHAPE);
    expect(storeFileCount(root)).toBe(before);
  }, T);
});

// ===========================================================================
// Round-2 hardening: label grammar, one-line step announcements, pump errors
// ===========================================================================

describe("AC-STE-724.10 (label): the label grammar ^[a-z][a-z0-9_-]{0,39}$", () => {
  const refused: Array<[string, string]> = [
    ["a newline followed by a dpt-receipt: line", `test\n${RECEIPT_PREFIX}/x/forged.json sha256:${"0".repeat(64)}`],
    ["a newline followed by a dpt-gate-step: line", `test\n${STEP_PREFIX}test exit 0 — ok, log /x/l.log, read the log on failure, receipt /x/forged.json sha256:${"0".repeat(64)}`],
    ["uppercase", "Tests"],
    ["empty", ""],
    ["41 characters", `a${"b".repeat(40)}`],
  ];
  for (const [name, label] of refused) {
    test(`AC-STE-724.10 (label): a label outside ^[a-z][a-z0-9_-]{0,39}$ is refused in NFR-10 shape, nothing run (${name})`, () => {
      const root = reuseTree(`ac10-label-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 20)}`);
      const sentinel = join(tempDir("ac10-label-s"), "sentinel");
      const before = storeFileCount(root);
      const r = spawnDoor(["run", root, label, "--", `touch ${sentinel}`], { cwd: root });
      expect({
        code: r.exitCode,
        nfr10: NFR10_SHAPE.test(r.stderr),
        ran: existsSync(sentinel),
        written: storeFileCount(root) - before,
        stdoutAnnouncements: r.stdout.split("\n").filter((l) => l.startsWith(RECEIPT_PREFIX) || l.startsWith(STEP_PREFIX) || l.startsWith(REUSE_PREFIX)),
      }).toEqual({ code: 1, nfr10: true, ran: false, written: 0, stdoutAnnouncements: [] });
    }, T);
  }

  for (const label of ["tests", "type-check_2", "a", `a${"b".repeat(39)}`]) {
    test(`AC-STE-724.10 (label): CONTROL — the label ${JSON.stringify(label)} inside the grammar runs normally and records one step`, () => {
      const root = reuseTree(`ac10-label-ok-${label.length}`);
      const sentinel = join(tempDir("ac10-label-ok-s"), "sentinel");
      const r = spawnDoor(["run", root, label, "--", `touch ${sentinel} && echo ok`], { cwd: root });
      expect(r.exitCode).toBe(0);
      expect(existsSync(sentinel)).toBe(true);
      const steps = stepReceipts(root);
      expect(steps.map((s) => s.record.evidence.label)).toEqual([label]);
      expect(steps[0]!.record.decision).toBe("pass");
    }, T);
  }
});

describe("AC-STE-724.5 (one line): a step announcement vouches only from a one-line recorded stdout", () => {
  /**
   * A genuine front-door Bash call whose recorded `toolUseResult.stdout` holds
   * the genuine announcement PLUS a second `dpt-receipt:` line naming a
   * hand-written gate-step receipt. FORGED: the genuine step bytes copied under
   * a new name (valid shape, live key, label, run); the genuine file stays.
   */
  function twoLineSession(label: string, forgedFirst: boolean): Built & { forged: string } {
    const b = buildSession(label);
    const forged = join(receiptDirOf(b.root), "9999-two-line-forged-step.json");
    writeFileSync(forged, readFileSync(b.step.path));
    const forgedLine = forgedStepLine(forged);
    const lines = forgedFirst ? [forgedLine, b.step.line] : [b.step.line, forgedLine];
    const stdout = `${lines.join("\n")}\n`;
    const step = bashCall("b1", reuseCommand(b.root, LABEL, b.cmd), stdout, b.step.stderr);
    // CONTROL: the recorded stdout really holds two non-empty announcement lines.
    const rec = JSON.parse(step[1]!);
    expect(String(rec.toolUseResult.stdout).split("\n").filter((l: string) => l.trim() !== "")).toEqual(lines);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...step, ...b.records.outcome]);
    return { ...b, forged };
  }

  for (const [where, forgedFirst] of [["before", true], ["after", false]] as const) {
    test(`AC-STE-724.5 (one line): a step announcement vouches only when the recorded stdout of that call holds exactly one non-empty line (forged line ${where} the genuine one)`, () => {
      const b = twoLineSession(`ac5-one-line-${where}`, forgedFirst);
      const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
      expectRan(b, r);
      expect(r.stdout).not.toContain(b.forged);
      expect(r.stdout.split("\n").filter((l) => l.startsWith(REUSE_PREFIX) && l.includes(b.step.path))).toEqual([]);
    }, T);
  }

  test("AC-STE-724.5 (one line): CONTROL — the same session with only the genuine single line still reuses", () => {
    const b = buildSession("ac5-one-line-control");
    const forged = join(receiptDirOf(b.root), "9999-two-line-forged-step.json");
    writeFileSync(forged, readFileSync(b.step.path));
    const step = bashCall("b1", reuseCommand(b.root, LABEL, b.cmd), `${b.step.line}\n`, b.step.stderr);
    retranscribe(b, [...b.records.skill, ...b.records.run, ...step, ...b.records.outcome]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectReused(b, r);
    expect(reuseLines(r.stdout)[0]).toContain(b.step.path);
  }, T);
});

describe("AC-STE-724.14 (pump error): a closed stderr leaves no gated child behind", () => {
  test("AC-STE-724.14 (pump error): with the door's stderr a pipe whose reader has exited, no gated child is running after the door exits", () => {
    const root = reuseTree("ac14-pump");
    const work = tempDir("ac14-pump-w");
    const pidFile = join(work, "child.pid");
    const outFile = join(work, "door.out");
    // The gated shell records its pid, waits until the stderr reader is long
    // gone, writes (EPIPE for the door's pump), then would idle for 8 s.
    const gated = `echo $$ > ${pidFile}; sleep 1; echo first; echo second; echo third; sleep 8`;
    const script = `"$DOOR_BUN" run "$DOOR" run "$DOOR_ROOT" ${LABEL} -- "$DOOR_CMD" 2>&1 >"$DOOR_OUT" | true`;
    const p = spawnSync("sh", ["-c", script], {
      cwd: root,
      env: {
        ...(process.env as Record<string, string>),
        ...GIT_ENV,
        CLAUDE_CONFIG_DIR: emptyConfig(),
        CLAUDE_CODE_SESSION_ID: SID,
        DOOR_BUN: process.execPath,
        DOOR: GATE_REUSE,
        DOOR_ROOT: root,
        DOOR_CMD: gated,
        DOOR_OUT: outFile,
      },
      encoding: "utf-8",
      timeout: 30_000,
    });
    expect(p.status).not.toBeNull();
    // CONTROL: the gated command really started and recorded its pid.
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf-8").trim());
    expect(Number.isInteger(pid) && pid > 1).toBe(true);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    expect({ gatedChildAliveAfterDoorExit: alive }).toEqual({ gatedChildAliveAfterDoorExit: false });
  }, T);
});

// ===========================================================================
// Pre-merge fix (PR #133 review B1): a tracked-file edit hidden from
// `git status` by an index flag never yields a key.
// ===========================================================================

describe("AC-STE-724.3 (hidden edit): an index flag hiding an edit from git status makes the tree not clean", () => {
  for (const [name, flag, editFirst] of [
    ["skip-worktree", "--skip-worktree", true],
    ["assume-unchanged", "--assume-unchanged", false],
  ] as const) {
    test(`AC-STE-724.3 (hidden edit, ${name}): an edited committed file flagged ${flag} runs the command`, () => {
      const b = buildSession(`b1-${name}`);
      const file = join(b.root, "docs", "readme.txt");
      if (editFirst) writeFileSync(file, "edited after the stored pass\n");
      git(b.root, "update-index", flag, "docs/readme.txt");
      if (!editFirst) writeFileSync(file, "edited after the stored pass\n");
      // CONTROL: git status really hides the edit.
      expect(isClean(b.root)).toBe(true);
      const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
      expectRan(b, r);
    }, T);
  }

  test("AC-STE-724.3 (hidden edit): computeReuseKey is null with any skip-worktree or assume-unchanged entry, edited or not", async () => {
    const m = await reuseModule();
    const root = reuseTree("b1-key-unit");
    expect(m.computeReuseKey(root, "true")).not.toBeNull();
    git(root, "update-index", "--skip-worktree", "docs/readme.txt");
    expect(m.computeReuseKey(root, "true")).toBeNull();
    git(root, "update-index", "--no-skip-worktree", "docs/readme.txt");
    expect(m.computeReuseKey(root, "true")).not.toBeNull();
    git(root, "update-index", "--assume-unchanged", "docs/readme.txt");
    expect(m.computeReuseKey(root, "true")).toBeNull();
  }, T);

  test("AC-STE-724.3 (hidden edit): hiddenIndexEntries flags h, S, s and every lowercase tag, never H", async () => {
    const m = await reuseModule();
    expect(m.hiddenIndexEntries("H docs/a.txt\nH b.txt\n")).toEqual([]);
    expect(m.hiddenIndexEntries("H a\nh docs/readme.txt\nS c\ns d\nm e\nr f\nc g\nk h2\n")).toEqual([
      "docs/readme.txt",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h2",
    ]);
    // Any tag other than H fails safe, unmerged M included.
    expect(m.hiddenIndexEntries("M u\n")).toEqual(["u"]);
    expect(m.hiddenIndexEntries("")).toEqual([]);
  });
});

/**
 * A Bash call that exited non-zero, as Claude Code REALLY records it (PR #133
 * review 2, measured on live transcripts): `is_error: true`, content
 * `Exit code N\n…`, and `toolUseResult` a STRING `Error: Exit code N\n…`.
 */
function errorBashCall(id: string, command: string, stdout: string, code: number): string[] {
  const [use, result] = contentOnlyBashCall(id, command, stdout);
  const record = JSON.parse(result as string);
  record.message.content[0].is_error = true;
  record.message.content[0].content = `Exit code ${code}\n${stdout}`;
  record.toolUseResult = `Error: Exit code ${code}\n${stdout}`;
  return [use as string, JSON.stringify(record)];
}

/**
 * How S2's failing door call reaches the transcript: `error` is the REAL
 * shape (is_error, string toolUseResult); `success` the pre-review-2 fixture
 * shape that never occurs for a non-zero exit; `absent` no record at all, so
 * S2's fail is in the store only, never vouched.
 */
type FailShape = "error" | "success" | "absent";

function failRecord(shape: FailShape, id: string, command: string, run: CliRun): string[] {
  if (shape === "absent") return [];
  return shape === "error" ? errorBashCall(id, command, run.stdout, run.exitCode) : bashCall(id, command, run.stdout, run.stderr);
}

/**
 * The B2 shape: in one run, step S1 of `test` passes, S2 of the same label
 * and key fails, then the run's one outcome claims `test=pass`. S2's call is
 * recorded in `shape` (the real error shape by default).
 */
function passThenFailSession(label: string, shape: FailShape = "error"): Built {
  const b = buildSession(label, {
    command: (s) => `if [ -e ${s}.fail ]; then exit 1; fi; touch ${s} && echo ok`,
    outcome: "none",
  });
  const failFlag = `${b.sentinel}.fail`;
  writeFileSync(failFlag, "");
  const s2 = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
  rmSync(failFlag);
  rmSync(b.sentinel, { force: true });
  if (s2.exitCode !== 1) throw new Error(`S2 did not fail: exit ${s2.exitCode}`);
  const out = runCli(["outcome", "gate-check", b.root, "pass", "--step", `${LABEL}=pass`]);
  if (out.exitCode !== 0) throw new Error(`outcome CLI failed: ${out.stderr}`);
  const records = {
    ...b.records,
    step: [...b.records.step, ...failRecord(shape, "b4", reuseCommand(b.root, LABEL, b.cmd), s2)],
    outcome: bashCall("b5", outcomeCommand("gate-check", b.root, "pass", [`${LABEL}=pass`]), out.stdout, out.stderr),
  };
  retranscribe(b, [...records.skill, ...records.run, ...records.step, ...records.outcome]);
  return { ...b, records };
}

// ===========================================================================
// Pre-merge fix (PR #133 review B2): the newest vouched step for a label and
// key decides, and it must itself be a pass.
// ===========================================================================

describe("AC-STE-724.5 (newest step): a later fail on the same run, label and key is never shadowed by an earlier pass", () => {
  for (const [shape, title] of [
    ["success", "S1 pass, S2 fail, then the run's outcome claiming test=pass: run reruns and verdict prints rerun"],
    ["error", "S1 pass, S2 fail recorded in the REAL error shape (is_error, string toolUseResult), outcome claiming test=pass: run reruns and verdict prints rerun"],
    ["absent", "S1 pass, S2 fail with no vouch at all (stored, never announced), outcome claiming test=pass: run reruns and verdict prints rerun"],
  ] as const)
  test(`AC-STE-724.5 (newest step): ${title}`, () => {
    const b = passThenFailSession(`b2-newest-${shape}`, shape);
    const steps = stepReceipts(b.root);
    expect(steps.map((s) => s.record.decision)).toEqual(["pass", "fail"]);
    // Both steps share the run and the key.
    expect(steps[1]!.record.evidence.run).toBe(steps[0]!.record.evidence.run);
    expect(steps[1]!.record.evidence.key).toEqual(steps[0]!.record.evidence.key);
    const verdict = spawnDoor(["verdict", b.root], { cfg: b.cfg, cwd: b.root });
    expect(verdict.stdout.trim()).toBe("rerun");
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  test("AC-STE-724.5 (newest step): an outcome that does not list the step's label as pass vouches for nothing", () => {
    const b = buildSession("b2-unlisted", { outcome: "none" });
    const out = runCli(["outcome", "gate-check", b.root, "pass", "--step", "lint=pass"]);
    expect(out.exitCode).toBe(0);
    retranscribe(b, [
      ...b.records.skill,
      ...b.records.run,
      ...b.records.step,
      ...bashCall("b5", outcomeCommand("gate-check", b.root, "pass", ["lint=pass"]), out.stdout, out.stderr),
    ]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectRan(b, r);
  }, T);

  for (const shape of ["success", "error"] as const)
  test(`AC-STE-724.5 (newest step): CONTROL — S1 fail then S2 pass on the same key reuses S2 (fail recorded in the ${shape} shape)`, () => {
    const b = buildSession(`b2-control-${shape}`, {
      command: (s) => `if [ -e ${s}.fail ]; then exit 1; fi; touch ${s} && echo ok`,
      outcome: "none",
    });
    // b.records.step is S1 (pass). Make a fail, then a pass, newest last.
    const failFlag = `${b.sentinel}.fail`;
    writeFileSync(failFlag, "");
    const s2 = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    rmSync(failFlag);
    const s3 = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    rmSync(b.sentinel, { force: true });
    expect([s2.exitCode, s3.exitCode]).toEqual([1, 0]);
    const out = runCli(["outcome", "gate-check", b.root, "pass", "--step", `${LABEL}=pass`]);
    retranscribe(b, [
      ...b.records.skill,
      ...b.records.run,
      ...b.records.step,
      ...failRecord(shape, "b4", reuseCommand(b.root, LABEL, b.cmd), s2),
      ...bashCall("b5", reuseCommand(b.root, LABEL, b.cmd), s3.stdout, s3.stderr),
      ...bashCall("b6", outcomeCommand("gate-check", b.root, "pass", [`${LABEL}=pass`]), out.stdout, out.stderr),
    ]);
    const r = runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg });
    expectReused(b, r);
    const newest = stepReceipts(b.root).at(-1)!;
    expect(reuseLines(r.stdout)[0]).toContain(newest.path);
  }, T);
});

// ===========================================================================
// Pre-merge fix 2 (PR #133 review 2, R2-B1): a failed step counts without a
// vouch. A non-zero exit is recorded `is_error: true` with a string
// `toolUseResult`, so its step line vouches nothing; the stored fail receipt
// and the error-shaped door call still refuse reuse. A forged fail can only
// cause a rerun.
// ===========================================================================

describe("AC-STE-724.5 (failed step counts unvouched): a fail newer than the vouched pass refuses reuse", () => {
  test("AC-STE-724.5 (failed step counts unvouched): a later error-shaped door call for the label with NO stored receipt refuses reuse", () => {
    const b = passThenFailSession("r2b1-noreceipt", "error");
    // The door died before writing (a killed door, say): only its error record remains.
    const fail = stepReceipts(b.root).find((s) => s.record.decision === "fail")!;
    rmSync(fail.path);
    expect(stepReceipts(b.root).map((s) => s.record.decision)).toEqual(["pass"]);
    const verdict = spawnDoor(["verdict", b.root], { cfg: b.cfg, cwd: b.root });
    expect(verdict.stdout.trim()).toBe("rerun");
    expectRan(b, runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg }));
  }, T);

  test("AC-STE-724.5 (failed step counts unvouched): an error-shaped door call for ANOTHER label does not refuse this label's reuse", () => {
    const b = buildSession("r2b1-otherlabel");
    const lint = runReuse(b.root, "lint", "exit 1", { cfg: b.cfg });
    expect(lint.exitCode).toBe(1);
    retranscribe(b, [
      ...b.records.skill,
      ...b.records.run,
      ...b.records.step,
      ...errorBashCall("b7", reuseCommand(b.root, "lint", "exit 1"), lint.stdout, 1),
      ...b.records.outcome,
    ]);
    expectReused(b, runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg }));
  }, T);

  test("AC-STE-724.5 (failed step counts unvouched): an error-shaped door call BEFORE the vouched pass does not refuse it", () => {
    const b = buildSession("r2b1-before");
    retranscribe(b, [
      ...b.records.skill,
      ...b.records.run,
      ...errorBashCall("b7", reuseCommand(b.root, LABEL, b.cmd), "", 1),
      ...b.records.step,
      ...b.records.outcome,
    ]);
    expectReused(b, runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg }));
  }, T);
});

// ===========================================================================
// Pre-merge fix 2 (PR #133 review 2, R2-HIGH): local git state that makes
// `git status` lie never yields a key.
// ===========================================================================

function lyingFsmonitor(root: string): void {
  const hook = join(root, ".git", "lying-fsmonitor.sh");
  // Hook protocol v2: print a token, a NUL, then no changed paths.
  writeFileSync(hook, "#!/bin/sh\nprintf 'tok\\0'\n");
  spawnSync("chmod", ["+x", hook]);
  git(root, "config", "core.fsmonitor", hook);
  git(root, "config", "core.fsmonitorHookVersion", "2");
  git(root, "status", "--porcelain"); // prime the index with the hook's token
}

/** A clean filter that hands git the committed bytes, whatever the worktree holds. */
function lyingCleanFilter(root: string, path: string): void {
  const committed = join(root, ".git", "committed-copy");
  writeFileSync(committed, readFileSync(join(root, path)));
  git(root, "config", "filter.liar.clean", `cat ${committed}`);
  git(root, "config", "filter.liar.smudge", "cat");
  writeFileSync(join(root, ".git", "info", "attributes"), `${path} filter=liar\n`);
}

describe("AC-STE-724.3 (hidden edit, git config): an fsmonitor hook or a clean filter hiding an edit makes the tree not clean", () => {
  test("AC-STE-724.3 (hidden edit, fsmonitor): an edit hidden by a core.fsmonitor hook reporting no changes runs the command", () => {
    const b = buildSession("r2h-fsmonitor");
    lyingFsmonitor(b.root);
    writeFileSync(join(b.root, "docs", "readme.txt"), "EDITED-WI");
    // CONTROL: git status really hides the edit.
    expect(isClean(b.root)).toBe(true);
    expectRan(b, runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg }));
  }, T);

  test("AC-STE-724.3 (hidden edit, clean filter): an edit hidden by a clean filter runs the command", () => {
    const b = buildSession("r2h-filter");
    lyingCleanFilter(b.root, "docs/readme.txt");
    const file = join(b.root, "docs", "readme.txt");
    // Same size: git compares content (through the filter) only when the size is unchanged.
    writeFileSync(file, readFileSync(file, "utf-8").replace(/[^\n]/g, "X"));
    git(b.root, "update-index", "--refresh");
    // CONTROL: git status really hides the edit.
    expect(isClean(b.root)).toBe(true);
    expectRan(b, runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg }));
  }, T);

  test("AC-STE-724.3 (hidden edit, git config): computeReuseKey is null under each hider, and not null once it is gone", async () => {
    const m = await reuseModule();
    const root = reuseTree("r2h-key-unit");
    expect(m.computeReuseKey(root, "true")).not.toBeNull();
    // A filter attribute whose driver is configured.
    git(root, "config", "filter.liar.clean", "cat");
    writeFileSync(join(root, ".git", "info", "attributes"), "docs/readme.txt filter=liar\n");
    expect(m.computeReuseKey(root, "true")).toBeNull();
    // A process filter alone is a filter too.
    git(root, "config", "--unset", "filter.liar.clean");
    git(root, "config", "filter.liar.process", "cat");
    expect(m.computeReuseKey(root, "true")).toBeNull();
    git(root, "config", "--remove-section", "filter.liar");
    // An attribute naming no configured driver filters nothing.
    expect(m.computeReuseKey(root, "true")).not.toBeNull();
    writeFileSync(join(root, ".git", "info", "attributes"), "");
    for (const [k, v] of [
      ["core.ignoreStat", "true"],
      ["core.checkStat", "minimal"],
    ]) {
      git(root, "config", k!, v!);
      expect(m.computeReuseKey(root, "true")).toBeNull();
      git(root, "config", "--unset", k!);
      expect(m.computeReuseKey(root, "true")).not.toBeNull();
    }
  }, T);

  test("AC-STE-724.3 (hidden edit, git config): status.showUntrackedFiles=no cannot hide an untracked file from the clean check", async () => {
    const m = await reuseModule();
    const root = reuseTree("r2h-status-flags");
    git(root, "config", "status.showUntrackedFiles", "no");
    writeFileSync(join(root, "untracked.txt"), "new\n");
    expect(m.computeReuseKey(root, "true")).toBeNull();
  }, T);
});

// ===========================================================================
// Pre-merge fix 2 (PR #133 review 2, LOW): the key is recomputed after the
// run; a tree the run left changed stores key: null, never reusable.
// ===========================================================================

describe("AC-STE-724.8 (key after the run): a run that leaves the tree changed stores key: null", () => {
  test("AC-STE-724.8 (key after the run): a command editing a tracked file stores key null, and a revert before the next call still runs it", () => {
    const b = buildSession("r2-keyafter", {
      command: (s) => `touch ${s}; echo during-the-run >> docs/readme.txt; echo ok`,
    });
    const step = stepReceipts(b.root).at(-1)!;
    expect(step.record.decision).toBe("pass");
    expect(step.record.evidence.key).toBeNull();
    git(b.root, "checkout", "--", "docs/readme.txt");
    expect(isClean(b.root)).toBe(true);
    expectRan(b, runReuse(b.root, LABEL, b.cmd, { cfg: b.cfg }));
  }, T);
});
