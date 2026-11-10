// STE-699 (M_a5dc12) — a shipped milestone's Epic can be closed from the
// repository that planned it, through exactly one checked path.
//
// The module under test is adapters/_shared/src/epic_close.ts:
//
//   bun run epic_close.ts <projectRoot> <EPIC-KEY> --children <listing>
//
// It writes and announces ONE `epic-close` receipt naming the key only when
// all four checks hold:
//   (a) the git index of <projectRoot> tracks specs/plan/<M>.md or
//       specs/plan/archive/<M>.md, <M> = milestoneIdFromEpicKey(<EPIC-KEY>);
//   (b) that plan's `shipped_in` passes the shipped plan/ship coherence rule
//       (a CHANGELOG heading for the stamped version exists);
//   (c) every `spans_repos` sibling the plan declares is idle by the shipped
//       sibling-release check;
//   (d) the listing holds at least one child, every child's status category done.
//
// The tracker-write gate then permits a STATUS-ONLY `transitionJiraIssue` on
// that key, and nothing else. Every gate leg runs through the SHIPPED `.sh`
// wrapper on a recorded payload (AC-STE-699.9); every refusal has a permit twin
// that differs from it in the one variable it keys on, so removing any of the
// four checks, the status-only restriction or the key match reds a named test
// here (AC-STE-699.10).
//
// Synthetic keys only (GK-*, DST-*); every repository is a temporary git repo.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { RECEIPT_ANNOUNCEMENT_PREFIX, receiptDigest } from "../adapters/_shared/src/tracker_receipts";
import { siblingShipGate } from "../adapters/_shared/src/sibling_release";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { commitAll, git, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, declareJira } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import { buildPassingBundle, serverPrefix, type BundleSession, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(60_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const ADAPTERS_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const EPIC_CLOSE = "epic_close.ts";
const EPIC_CLOSE_PATH = join(ADAPTERS_SRC, EPIC_CLOSE);
const HOOK = "pre-tracker-write-gate";
const HOOK_MODULE_PATH = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", `${HOOK}.ts`);
const GRADER_PATH = join(ADAPTERS_SRC, "shared_tracker_live_grader.ts");
const SH_ENTRY_REL = join("templates", "hooks", "process", `${HOOK}.sh`);
const SKILL_MD = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");

const SESSION = "s-699-main";
/** At the declared `min_dpt_version` (2.87.0) of every fixture repository. */
const MANIFEST_VERSION = "2.87.0";
const EPIC = "GK-85";
const OTHER_EPIC = "GK-86";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const VERSION = "1.2.0";
const CLOUD = "example.atlassian.net";
const BE_NAME = BE_TAG; // glade-be — the invoking repository
const FE_NAME = FE_TAG; // glade-fe — the declared sibling
const BE_FR = "GK-111";
const FE_FR = "GK-101";
const FE_FR_ACTIVE = "GK-102";

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-699-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let NEUTRAL_CWD = "";
let SH_ROOT = "";
beforeAll(() => {
  NEUTRAL_CWD = tempDir("neutral");
  // The shipped wrapper's plugin root: a fixture manifest (the floor reads
  // MANIFEST_VERSION) beside symlinks to this plugin's real templates/adapters.
  SH_ROOT = tempDir("sh-root");
  pluginManifest(SH_ROOT, MANIFEST_VERSION);
  symlinkSync(join(PLUGIN_ROOT, "templates"), join(SH_ROOT, "templates"));
  symlinkSync(join(PLUGIN_ROOT, "adapters"), join(SH_ROOT, "adapters"));
});

// ------------------------------------------------------------------- worlds

/** The one fact a twin changes; the permit leg changes none. */
interface Variant {
  /** (a) the plan is on disk but not in the git index. */
  untrackedPlan?: boolean;
  /** (b) CHANGELOG.md holds no heading for the stamped version. */
  noChangelogHeading?: boolean;
  /** (c) the declared sibling holds an active FR bound to the milestone. */
  siblingBusy?: boolean;
}

interface World {
  /** The invoking repository (glade-be): it planned and shipped the milestone. */
  be: string;
  /** The declared sibling (glade-fe). */
  fe: string;
  scratch: string;
  planFile: string;
}

const CHANGELOG_SHIPPED = [
  "# Changelog",
  "",
  `## [${VERSION}] — 2026-11-01 — "Close Out"`,
  "",
  "### Fixed",
  "",
  "- The milestone shipped.",
  "",
  '## [1.1.0] — 2026-10-01 — "Before"',
  "",
  "### Fixed",
  "",
  "- Earlier work.",
  "",
].join("\n");
const CHANGELOG_WITHOUT_HEADING = [
  "# Changelog",
  "",
  '## [1.1.0] — 2026-10-01 — "Before"',
  "",
  "### Fixed",
  "",
  "- Earlier work.",
  "",
].join("\n");

/**
 * Two Jira-shared repositories (project GK) under one parent: BE planned
 * M_GK_85 (archived plan stamped v1.2.0, spanning FE; one archived FR; a
 * CHANGELOG heading for 1.2.0) and FE holds its idle half (plan naming BE
 * back, one archived FR). Everything is committed, so the plan is tracked.
 * Each `Variant` flag changes exactly the one fact its check reads.
 */
function makeWorld(v: Variant = {}): World {
  const parent = tempDir("world");
  const be = join(parent, BE_NAME);
  const fe = join(parent, FE_NAME);
  mkdirSync(be, { recursive: true });
  mkdirSync(fe, { recursive: true });
  declareJira(be, BE_TAG);
  declareJira(fe, FE_TAG);
  const planFile = writePlan(be, "archive", MILESTONE, { [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` }, { shippedIn: `v${VERSION}` });
  writeFr(be, BE_FR, MILESTONE, "archived");
  writeFileSync(join(be, "CHANGELOG.md"), v.noChangelogHeading ? CHANGELOG_WITHOUT_HEADING : CHANGELOG_SHIPPED);
  writePlan(fe, "archive", MILESTONE, { [BE_NAME]: `../${BE_NAME}`, [FE_NAME]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, FE_FR, MILESTONE, "archived");
  if (v.siblingBusy) writeFr(fe, FE_FR_ACTIVE, MILESTONE, "active");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  if (v.untrackedPlan) {
    git(be, "rm", "-q", "--cached", "--", `specs/plan/archive/${MILESTONE}.md`);
    git(be, "commit", "-q", "-m", "fixture: untrack the plan");
    if (!existsSync(planFile)) throw new Error("fixture: the untracked plan must stay on disk");
  }
  return { be, fe, scratch: tempDir("scratch"), planFile };
}

// ----------------------------------------------------------- child listings

type Category = "done" | "indeterminate" | "new";

function child(key: string, category: Category, labels: string[]): Record<string, unknown> {
  const name = category === "done" ? "Done" : category === "indeterminate" ? "In Progress" : "To Do";
  return {
    key,
    fields: {
      summary: `Child ${key}`,
      status: { name, statusCategory: { key: category } },
      issuetype: { name: "Task" },
      project: { key: "GK" },
      labels,
      parent: { key: EPIC },
    },
  };
}

/** The permit leg's listing: one page, proven last, every child done. */
const DONE_CHILDREN = (): Record<string, unknown> => ({
  issues: [child(FE_FR, "done", [FE_TAG]), child(BE_FR, "done", [BE_TAG])],
  isLast: true,
});
/** (d) twin: one child not done. */
const ONE_CHILD_OPEN = (): Record<string, unknown> => ({
  issues: [child(FE_FR, "indeterminate", [FE_TAG]), child(BE_FR, "done", [BE_TAG])],
  isLast: true,
});
/** (d) twin: no child at all. */
const NO_CHILDREN = (): Record<string, unknown> => ({ issues: [], isLast: true });

let listingSeq = 0;
function saveListing(w: World, listing: unknown): string {
  listingSeq += 1;
  const p = join(w.scratch, `children-${listingSeq}.json`);
  writeFileSync(p, JSON.stringify(listing));
  return p;
}

// ------------------------------------------------------------ module runs

interface ModuleRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** The command a transcript records for this run. */
  command: string;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) if (val !== undefined) env[k] = val;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  return env;
}

/** Spawn the REAL epic_close.ts with `args` after the module path. */
function runEpicClose(args: string[]): ModuleRun {
  const p = Bun.spawnSync(["bun", "run", EPIC_CLOSE_PATH, ...args], { cwd: NEUTRAL_CWD, env: childEnv(), stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: p.exitCode ?? -1,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString(),
    command: `bun run "${EPIC_CLOSE_PATH}" ${args.join(" ")}`,
  };
}

function closeEpic(w: World, listing: unknown, key = EPIC): ModuleRun {
  return runEpicClose([w.be, key, "--children", saveListing(w, listing)]);
}

function show(r: { exitCode: number; stdout: string; stderr: string }): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

const announcementLines = (out: string): string[] => out.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));

/** The receipt files the session wrote under `root`. */
function receiptFiles(root: string): string[] {
  const dir = receiptsDir(root, SESSION);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => join(dir, n));
}

/** The one announced receipt path of a permitted run. */
function announcedPath(r: ModuleRun): string {
  const lines = announcementLines(r.stdout);
  if (lines.length !== 1) throw new Error(`expected exactly one announcement, got:\n${show(r)}`);
  return lines[0]!.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]!;
}

function expectClosed(r: ModuleRun, w: World, key = EPIC): Record<string, unknown> {
  if (r.exitCode !== 0) throw new Error(`expected epic_close.ts to permit (exit 0), got:\n${show(r)}`);
  const lines = announcementLines(r.stdout);
  expect(lines.length, "exactly one receipt announced").toBe(1);
  const path = announcedPath(r);
  expect(resolve(path).startsWith(receiptsDir(w.be, SESSION)), "the receipt sits in this session's directory of the project root").toBe(true);
  expect(lines[0]!, "the announcement carries the receipt's digest").toContain(`sha256:${receiptDigest(readFileSync(path))}`);
  expect(receiptFiles(w.be).length, "one receipt file written").toBe(1);
  const receipt = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  expect({ kind: receipt.kind, subject: receipt.subject, adapter: receipt.adapter, sessionId: receipt.sessionId }).toEqual({
    kind: "epic-close",
    subject: key,
    adapter: "jira",
    sessionId: SESSION,
  });
  return receipt;
}

/** AC-STE-699.3 — refused in the NFR-10 shape, naming the check, non-zero, no receipt. */
function expectRefused(r: ModuleRun, w: World, ...needles: RegExp[]): void {
  if (r.exitCode === 0) throw new Error(`expected epic_close.ts to refuse (non-zero exit), got:\n${show(r)}`);
  expect(announcementLines(r.stdout), "a refusal announces no receipt").toEqual([]);
  expect(announcementLines(r.stderr), "a refusal announces no receipt on stderr either").toEqual([]);
  expect(receiptFiles(w.be), "a refusal writes no receipt").toEqual([]);
  const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
  expect(lines.length, `NFR-10 shape needs at least three lines:\n${show(r)}`).toBeGreaterThanOrEqual(3);
  expect(/^(Remedy|Context): /.test(lines[0]!), `the first line is the verdict, not a sub-line:\n${show(r)}`).toBe(false);
  expect(lines.some((l) => l.startsWith("Remedy: ")), `a Remedy: line:\n${show(r)}`).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: ")), `a Context: line:\n${show(r)}`).toBe(true);
  for (const n of needles) expect(r.stderr, `the refusal names ${n}:\n${show(r)}`).toMatch(n);
}

// ------------------------------------------------------------- transcripts

class Transcript {
  readonly lines: string[] = [];
  private seq = 0;

  use(name: string, input: unknown, id = this.nextId()): string {
    this.lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        timestamp: new Date().toISOString(),
        message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      }),
    );
    return id;
  }

  result(id: string, content: unknown, isError = false): void {
    this.lines.push(
      JSON.stringify({
        type: "user",
        sessionId: SESSION,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content, ...(isError ? { is_error: true } : {}) }] },
      }),
    );
  }

  bash(command: string, output: string, isError = false): void {
    const id = this.use("Bash", { command, description: "run" });
    this.result(id, output, isError);
  }

  /** A recorded module run, as Claude Code records it: stdout on success, stderr as an error result. */
  run(r: ModuleRun): void {
    this.bash(r.command, r.exitCode === 0 ? r.stdout.trimEnd() : `Exit code ${r.exitCode}\n${r.stderr}`, r.exitCode !== 0);
  }

  private nextId(): string {
    this.seq += 1;
    return `toolu_699_${String(this.seq).padStart(4, "0")}`;
  }
}

const GATED_ID = "toolu_699_gated";
let transcriptSeq = 0;

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Drive the gate through the SHIPPED `.sh` wrapper on a recorded PreToolUse payload. */
async function gate(tool: string, input: Record<string, unknown>, t: Transcript, cwd: string): Promise<Run> {
  transcriptSeq += 1;
  const path = join(NEUTRAL_CWD, `transcript-${transcriptSeq}.jsonl`);
  const gated = new Transcript();
  gated.use(`mcp__atlassian__${tool}`, input, GATED_ID);
  writeFileSync(path, [...t.lines, ...gated.lines].join("\n") + "\n");
  const payload = JSON.stringify({
    session_id: SESSION,
    transcript_path: path,
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: `mcp__atlassian__${tool}`,
    tool_input: input,
    tool_use_id: GATED_ID,
  });
  const env = childEnv();
  env.CLAUDE_PLUGIN_ROOT = SH_ROOT;
  const proc = Bun.spawn(["bash", join(SH_ROOT, SH_ENTRY_REL)], { cwd: NEUTRAL_CWD, env, stdin: new Response(payload).body, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

function expectPermit(r: Run, why: string): void {
  if (r.exitCode !== 0) throw new Error(`${why}: expected the gate to permit (exit 0), got:\n${show(r)}`);
  expect(r.stdout, why).toBe("");
}

function expectGateRefusal(r: Run, why: string): void {
  if (r.exitCode !== 2) throw new Error(`${why}: expected the gate to refuse (exit 2), got:\n${show(r)}`);
  expect(r.stdout, why).toBe("");
  expect(r.stderr, why).toContain("Refusing:");
  expect(r.stderr, why).toContain("Remedy:");
  expect(r.stderr, why).toContain(`hook=${HOOK}`);
}

/** The status-only close: the issue key and the transition (plus the cloud id every Jira call carries). */
const statusOnly = (key: string): Record<string, unknown> => ({ cloudId: CLOUD, issueIdOrKey: key, transition: { id: "41" } });

// ===========================================================================
// AC-STE-699.1 — the module, its CLI, and its place in the announcing list
// ===========================================================================

interface HookModule {
  RECEIPT_WRITING_SUBCOMMANDS: Readonly<Record<string, string | null>>;
  RECEIPT_ANNOUNCING_MODULES: readonly string[];
  invokedDecidingModule: (command: string) => string | null;
}
const hookModule = async (): Promise<HookModule> => (await import(HOOK_MODULE_PATH)) as HookModule;

describe("AC-STE-699.1 — epic_close.ts ships and is a subcommand-less receipt-writing module", () => {
  test("adapters/_shared/src/epic_close.ts exists", () => {
    expect(existsSync(EPIC_CLOSE_PATH)).toBe(true);
  });

  test("RECEIPT_WRITING_SUBCOMMANDS lists epic_close.ts with NO subcommand (null), so RECEIPT_ANNOUNCING_MODULES carries it", async () => {
    const m = await hookModule();
    expect(Object.prototype.hasOwnProperty.call(m.RECEIPT_WRITING_SUBCOMMANDS, EPIC_CLOSE), "listed").toBe(true);
    expect(m.RECEIPT_WRITING_SUBCOMMANDS[EPIC_CLOSE]).toBeNull();
    expect(m.RECEIPT_ANNOUNCING_MODULES).toContain(EPIC_CLOSE);
  });

  test("the hook accepts exactly `<projectRoot> <EPIC-KEY> --children <listing>` after the module; any other argv announces nothing", async () => {
    const { invokedDecidingModule } = await hookModule();
    const cmd = (args: string) => `bun run "${EPIC_CLOSE_PATH}" ${args}`;
    expect(invokedDecidingModule(cmd("/r/be GK-85 --children /r/be/.dpt/tmp/children.json"))).toBe(EPIC_CLOSE);
    const rejected: Array<[string, string]> = [
      ["no --children", "/r/be GK-85"],
      ["--children with no file", "/r/be GK-85 --children"],
      ["a flag other than --children", "/r/be GK-85 --listing /r/x.json"],
      ["an extra trailing argument", "/r/be GK-85 --children /r/x.json --force"],
      ["a subcommand before the root", "close /r/be GK-85 --children /r/x.json"],
    ];
    for (const [name, args] of rejected) {
      expect({ name, module: invokedDecidingModule(cmd(args)) }).toEqual({ name, module: null });
    }
  });
});

// ===========================================================================
// Fixture controls — the twins differ from the permit leg in ONE check each,
// as the SHIPPED helpers grade them (green before and after the change).
// ===========================================================================

describe("CONTROL — the fixture's twins, graded by the shipped helpers the module composes", () => {
  test("(a) the permit world tracks the plan; the untracked twin keeps it on disk but out of the index", () => {
    const permit = makeWorld();
    const twin = makeWorld({ untrackedPlan: true });
    const rel = `specs/plan/archive/${MILESTONE}.md`;
    expect(git(permit.be, "ls-files", "--", rel).trim()).toBe(rel);
    expect(git(twin.be, "ls-files", "--", rel).trim()).toBe("");
    expect(existsSync(twin.planFile)).toBe(true);
  });

  test("(b) plan/ship coherence passes the permit world and reports a corrupt stamp on the no-heading twin", async () => {
    const permit = makeWorld();
    const twin = makeWorld({ noChangelogHeading: true });
    const corrupt = async (root: string) => (await runPlanShipCoherenceProbe(root)).violations.filter((v) => v.kind === "corrupt_stamp").length;
    expect(await corrupt(permit.be)).toBe(0);
    expect(await corrupt(twin.be)).toBeGreaterThan(0);
  });

  test("(c) the sibling release check finds the sibling idle in the permit world and busy in the twin", async () => {
    const permit = makeWorld();
    const twin = makeWorld({ siblingBusy: true });
    const gateOf = async (w: World) =>
      siblingShipGate({ projectRoot: w.be, planBody: readFileSync(w.planFile, "utf-8"), milestone: MILESTONE, partial: false });
    expect((await gateOf(permit)).refusal).toBeNull();
    const busy = await gateOf(twin);
    expect(busy.refusal).not.toBeNull();
    expect(busy.refusal!).toContain(FE_NAME);
  });
});

// ===========================================================================
// AC-STE-699.2 / .3 — the four checks, each with its twin
// ===========================================================================

describe("AC-STE-699.2 — all four checks hold → one announced `epic-close` receipt naming the key", () => {
  test("PERMIT — tracked shipped plan, CHANGELOG heading, idle sibling, every child done → exit 0, one receipt (kind epic-close, subject GK-85)", () => {
    const w = makeWorld();
    expectClosed(closeEpic(w, DONE_CHILDREN()), w);
  });
});

describe("AC-STE-699.2 / .3 — each failing check refuses in the NFR-10 shape, names itself, exits non-zero, writes no receipt", () => {
  test("(a) TWIN — the plan is on disk but not tracked by the git index → refused, naming the plan and the index", () => {
    const w = makeWorld({ untrackedPlan: true });
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE), /track|index/i);
  });

  test("(a) KEY — an Epic key whose milestone this repository never planned (GK-86 → M_GK_86) → refused, naming M_GK_86", () => {
    const w = makeWorld();
    expectRefused(closeEpic(w, DONE_CHILDREN(), OTHER_EPIC), w, new RegExp(milestoneIdFromEpicKey(OTHER_EPIC)));
  });

  test("(b) TWIN — CHANGELOG.md holds no heading for the stamped v1.2.0 → refused, naming shipped_in and the CHANGELOG", () => {
    const w = makeWorld({ noChangelogHeading: true });
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, /shipped_in/, /CHANGELOG/, /1\.2\.0/);
  });

  test("(c) TWIN — the declared sibling glade-fe holds an active FR bound to the milestone → refused, naming the sibling", () => {
    const w = makeWorld({ siblingBusy: true });
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(FE_NAME), /busy|idle|active/i);
  });

  test("(d) TWIN — one child's status category is not done → refused, naming that child", () => {
    const w = makeWorld();
    expectRefused(closeEpic(w, ONE_CHILD_OPEN()), w, new RegExp(FE_FR), /done/i);
  });

  test("(d) TWIN — the listing holds no child → refused, naming the empty listing", () => {
    const w = makeWorld();
    expectRefused(closeEpic(w, NO_CHILDREN()), w, /child/i);
  });

  test("a missing --children listing file → refused the same way, naming --children", () => {
    const w = makeWorld();
    expectRefused(runEpicClose([w.be, EPIC, "--children", join(w.scratch, "absent.json")]), w, /--children|listing/);
  });

  test("an unreadable --children listing (not JSON) → refused the same way, naming --children", () => {
    const w = makeWorld();
    const p = join(w.scratch, "garbled.json");
    writeFileSync(p, "{ not json");
    expectRefused(runEpicClose([w.be, EPIC, "--children", p]), w, /--children|listing/);
  });

  test("no --children flag at all → refused the same way", () => {
    const w = makeWorld();
    expectRefused(runEpicClose([w.be, EPIC]), w, /--children/);
  });
});

// ===========================================================================
// AC-STE-699.4 / .5 / .9 — the gate, through the shipped .sh wrapper
// ===========================================================================

describe("AC-STE-699.4 / .5 — with an announced epic-close receipt the gate permits a status-only transition on that key, and nothing else", () => {
  let w: World;
  let closed: ModuleRun;
  let receiptPath: string;
  let announced: Transcript;
  beforeAll(() => {
    w = makeWorld();
    closed = closeEpic(w, DONE_CHILDREN());
    expectClosed(closed, w);
    receiptPath = announcedPath(closed);
    announced = new Transcript();
    announced.run(closed);
  });

  test("PERMIT (AC.4) — transitionJiraIssue on GK-85 carrying only the issue key and the transition → exit 0, silent stdout", async () => {
    expectPermit(await gate("transitionJiraIssue", statusOnly(EPIC), announced, w.be), "status-only close");
  });

  test("CONTROL (AC.6 twin) — the SAME transition with no epic_close run in the transcript → refused", async () => {
    expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), new Transcript(), w.be), "no receipt");
  });

  const forbidden: Array<[string, string, Record<string, unknown>]> = [
    ["the transition also carries `fields`", "transitionJiraIssue", { ...statusOnly(EPIC), fields: { resolution: { name: "Done" } } }],
    ["the transition also carries `update`", "transitionJiraIssue", { ...statusOnly(EPIC), update: { labels: [{ add: "closed" }] } }],
    ["the transition also carries a comment (update.comment)", "transitionJiraIssue", { ...statusOnly(EPIC), update: { comment: [{ add: { body: "Shipped." } }] } }],
    ["the transition also carries a top-level comment", "transitionJiraIssue", { ...statusOnly(EPIC), comment: "Shipped." }],
    ["an editJiraIssue on the key (summary)", "editJiraIssue", { cloudId: CLOUD, issueIdOrKey: EPIC, fields: { summary: "Renamed" } }],
    ["an editJiraIssue on the key (labels only)", "editJiraIssue", { cloudId: CLOUD, issueIdOrKey: EPIC, fields: { labels: [BE_TAG] } }],
    ["a status-only transition on ANOTHER key (GK-86)", "transitionJiraIssue", statusOnly(OTHER_EPIC)],
  ];
  for (const [name, tool, input] of forbidden) {
    test(`FORBID (AC.5) — ${name} → refused although the receipt is present`, async () => {
      expectGateRefusal(await gate(tool, input, announced, w.be), name);
    });
  }

  test("FORBID (AC.5) — the receipt announced by an `echo` of its own line, not by a run of epic_close.ts → refused", async () => {
    const t = new Transcript();
    const line = announcementLines(closed.stdout)[0]!;
    t.bash(`echo "${line}"`, line);
    expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be), "echoed announcement");
  });

  test("FORBID (AC.5) — the receipt announced by a module outside RECEIPT_ANNOUNCING_MODULES (sibling_release.ts) → refused", async () => {
    const t = new Transcript();
    t.bash(`bun run "${join(ADAPTERS_SRC, "sibling_release.ts")}" ${w.be} ${w.planFile} ${MILESTONE}`, announcementLines(closed.stdout)[0]!);
    expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be), "unregistered announcer");
  });

  test("FORBID (AC.5) — the epic-close receipt announced by a registered module that does not write it (ticket_ownership.ts confirm) → refused", async () => {
    const t = new Transcript();
    t.bash(`bun run "${join(ADAPTERS_SRC, "ticket_ownership.ts")}" confirm ${w.be} ${EPIC} ${join(w.scratch, "ticket.json")}`, announcementLines(closed.stdout)[0]!);
    expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be), "another module's announcement");
  });

  test("FORBID (AC.5) — the receipt announced by an epic_close.ts command in a shape the hook does not accept (no --children) → refused", async () => {
    const t = new Transcript();
    t.bash(`bun run "${EPIC_CLOSE_PATH}" ${w.be} ${EPIC}`, announcementLines(closed.stdout)[0]!);
    expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be), "rejected argv shape");
  });

  test("FORBID (AC.5) — the announced receipt file rewritten after its announcement → refused", async () => {
    const copyWorld = makeWorld();
    const run = closeEpic(copyWorld, DONE_CHILDREN());
    expectClosed(run, copyWorld);
    const t = new Transcript();
    t.run(run);
    expectPermit(await gate("transitionJiraIssue", statusOnly(EPIC), t, copyWorld.be), "PERMIT TWIN — intact");
    const path = announcedPath(run);
    writeFileSync(path, readFileSync(path, "utf-8").replace(/\n$/, " \n"));
    expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), t, copyWorld.be), "rewritten receipt");
  });

  test("the receipt the forbid legs read is still present on disk (they refuse with it in place)", () => {
    expect(existsSync(receiptPath)).toBe(true);
  });
});

describe("AC-STE-699.9 — each check's twin, end to end: the refused run writes no receipt, so the gate refuses the close", () => {
  const twins: Array<[string, Variant, () => Record<string, unknown>]> = [
    ["(a) untracked plan", { untrackedPlan: true }, DONE_CHILDREN],
    ["(b) no CHANGELOG heading for the stamp", { noChangelogHeading: true }, DONE_CHILDREN],
    ["(c) busy sibling", { siblingBusy: true }, DONE_CHILDREN],
    ["(d) a child not done", {}, ONE_CHILD_OPEN],
  ];
  test("PERMIT LEG — the four checks hold: the recorded run's receipt permits the status-only close", async () => {
    const w = makeWorld();
    const t = new Transcript();
    t.run(closeEpic(w, DONE_CHILDREN()));
    expectPermit(await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be), "permit leg");
  });
  for (const [name, variant, listing] of twins) {
    test(`TWIN ${name} — epic_close.ts refuses, and the same close is refused by the gate`, async () => {
      const w = makeWorld(variant);
      const r = closeEpic(w, listing());
      expect(r.exitCode, `${name}:\n${show(r)}`).not.toBe(0);
      expect(receiptFiles(w.be), name).toEqual([]);
      const t = new Transcript();
      t.run(r);
      expectGateRefusal(await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be), name);
    });
  }
});

// ===========================================================================
// AC-STE-699.6 — the refusal without a receipt names epic_close.ts
// ===========================================================================

/** The Remedy: line of a gate refusal. */
const remedyOf = (r: Run): string => r.stderr.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "";

/** The sentences of `text` (split after `.`, `:` or `;` that ends a clause). */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.;])\s+(?=[A-Z])/);

describe("AC-STE-699.6 — without the receipt, a transition on an unowned Epic is refused, and its remedy routes to epic_close.ts", () => {
  let r: Run;
  beforeAll(async () => {
    const w = makeWorld();
    r = await gate("transitionJiraIssue", statusOnly(EPIC), new Transcript(), w.be);
  });

  test("refused as today (exit 2, NFR-10 block)", () => {
    expectGateRefusal(r, "unowned Epic, no receipt");
  });

  test("the remedy names epic_close.ts as the path for a shipped milestone's Epic", () => {
    const remedy = remedyOf(r);
    expect(remedy).toContain(EPIC_CLOSE);
    expect(remedy).toMatch(/--children/);
    // Amended by AC-STE-729.7: the remedy now leads with the fetch, and the
    // `<ticket.json>` confirm route follows the epic_close.ts route (it is last).
    expect(remedy.startsWith("Remedy: fetch the ticket in this session"), remedy).toBe(true);
    const confirm = remedy.indexOf('ticket_ownership.ts" confirm <projectRoot> <KEY> <ticket.json>');
    expect(confirm).toBeGreaterThan(remedy.indexOf(EPIC_CLOSE));
  });

  // Amended by AC-STE-729.7: an Epic's description or summary routes to epic_edit.ts and the `Edit <KEY>` answer.
  test("the remedy names epic_edit.ts and the `Edit <KEY>` answer for an Epic's description or summary", () => {
    const remedy = remedyOf(r);
    expect(remedy).toContain("epic_edit.ts");
    expect(remedy).toContain('"Edit <KEY>"');
  });

  test("no sentence of the remedy that speaks of an Epic or a container verdict tells the agent the owning repository can make the write", () => {
    const remedy = remedyOf(r);
    const epicSentences = sentencesOf(remedy).filter((s) => /\bEpic\b|\bcontainer\b/.test(s));
    expect(epicSentences.length, "CONTROL — the remedy still speaks of the Epic").toBeGreaterThan(0);
    for (const s of epicSentences) expect({ sentence: s, owningRepo: /owning repository/i.test(s) }).toEqual({ sentence: s, owningRepo: false });
  });
});

// ===========================================================================
// AC-STE-699.7 — the live grader mirrors AC.4 and AC.5
// ===========================================================================

interface Finding {
  code: string;
  session?: string;
  item?: string;
  detail?: string;
}
interface GraderModule {
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Finding[] };
  RECEIPT_WRITERS: Readonly<Record<string, { module: string; subcommand: string | null }>>;
}
const grader = async (): Promise<GraderModule> => (await import(GRADER_PATH)) as GraderModule;

const sha256Hex = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");

function appendCall(s: BundleSession, name: string, input: Record<string, unknown>, result: ToolCall["result"], tag: string): ToolCall {
  const c: ToolCall = { ref: `${s.sessionId}:toolu_699_${tag}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name, input, result, sidechain: false };
  s.calls.push(c);
  return c;
}

/** An `epic-close` receipt for `key` in `s`'s repository, announced by one Bash run of `command`. */
function appendEpicClose(b: LiveBundle, s: BundleSession, key: string, command: string, tag: string): string {
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/epic-close-${tag}.json`;
  const set = b.repos[s.root].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({
    path,
    sessionId: s.sessionId,
    sha256: sha256Hex(path),
    kind: "epic-close",
    adapter: b.run.tracker,
    container: b.run.container,
    subject: key,
    decision: "close",
    evidence: { key, milestone: milestoneIdFromEpicKey(key) },
  });
  appendCall(s, "Bash", { command, description: "run" }, { isError: false, text: `closed\ndpt-receipt: ${path} sha256:${sha256Hex(path)}`, exitCode: 0, items: null, lastPage: null }, `ann_${tag}`);
  return path;
}

const epicCloseCommand = (root: string, key: string): string =>
  `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${EPIC_CLOSE}" <${root}> ${key} --children <${root}>/.dpt/tmp/children.json`;

/** A successful Jira write on `key`, appended to `s`. */
function appendJiraWrite(s: BundleSession, tool: "transitionJiraIssue" | "editJiraIssue", input: Record<string, unknown>, tag: string): ToolCall {
  return appendCall(s, serverPrefix("jira", s.root) + tool, input, { isError: false, text: "", exitCode: null, items: [], lastPage: null }, `w_${tag}`);
}

describe("AC-STE-699.7 — shared_tracker_live_grader.ts mirrors the epic-close rule", () => {
  test("RECEIPT_WRITERS maps the `epic-close` kind to epic_close.ts with no subcommand", async () => {
    expect((await grader()).RECEIPT_WRITERS["epic-close"]).toEqual({ module: EPIC_CLOSE, subcommand: null });
  });

  /**
   * One Jira passing bundle; in the S13 session (root B) an epic-close receipt
   * for a fresh key in the run's container is announced by `announcer`, then
   * one successful write `write` follows. Returns the write's ungated verdict
   * and whether the receipt was flagged unannounced.
   */
  async function gradeClose(opts: {
    write: (key: string) => { tool: "transitionJiraIssue" | "editJiraIssue"; input: Record<string, unknown> };
    announcer?: (root: string, key: string) => string;
  }): Promise<{ ungated: boolean; unannounced: boolean }> {
    const g = await grader();
    const b = buildPassingBundle("jira");
    const s = b.sessions.find((x) => x.marker === "S13")!;
    const key = `${b.run.container}-850`;
    const command = (opts.announcer ?? ((root, k) => epicCloseCommand(root, k)))(s.root, key);
    const path = appendEpicClose(b, s, key, command, "close");
    const { tool, input } = opts.write(key);
    const w = appendJiraWrite(s, tool, input, "close");
    const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
    return {
      ungated: v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${w.ref}:`)),
      unannounced: v.findings.some((f) => f.code === "unannounced-receipt" && f.item === path),
    };
  }

  const transitionOnly = (key: string) => ({ tool: "transitionJiraIssue" as const, input: { cloudId: "cloud-dst", issueIdOrKey: key, transition: { id: "41" } } });

  test("PERMIT (mirrors AC.4) — a status-only transition on the key after its epic-close receipt is gated, and the receipt is announced", async () => {
    expect(await gradeClose({ write: transitionOnly })).toEqual({ ungated: false, unannounced: false });
  });

  const forbidden: Array<[string, (key: string) => { tool: "transitionJiraIssue" | "editJiraIssue"; input: Record<string, unknown> }]> = [
    ["the transition also carries `fields`", (k) => ({ tool: "transitionJiraIssue", input: { ...transitionOnly(k).input, fields: { resolution: { name: "Done" } } } })],
    ["the transition also carries `update`", (k) => ({ tool: "transitionJiraIssue", input: { ...transitionOnly(k).input, update: { labels: [{ add: "closed" }] } } })],
    ["the transition also carries a comment", (k) => ({ tool: "transitionJiraIssue", input: { ...transitionOnly(k).input, update: { comment: [{ add: { body: "Shipped." } }] } } })],
    ["an editJiraIssue on the key", (k) => ({ tool: "editJiraIssue", input: { cloudId: "cloud-dst", issueIdOrKey: k, fields: { summary: "Renamed" } } })],
    ["a status-only transition on ANOTHER key", (k) => transitionOnly(`${k.slice(0, k.lastIndexOf("-"))}-851`)],
  ];
  for (const [name, write] of forbidden) {
    test(`FORBID (mirrors AC.5) — ${name} → ungated-write`, async () => {
      expect((await gradeClose({ write })).ungated).toBe(true);
    });
  }

  test("FORBID (mirrors AC.5) — the epic-close receipt announced by ticket_ownership.ts confirm, not its writer → ungated-write and unannounced-receipt", async () => {
    const r = await gradeClose({
      write: transitionOnly,
      announcer: (root, k) => `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/ticket_ownership.ts" confirm <${root}> ${k} <${root}>/.dpt/tmp/ticket.json`,
    });
    expect(r).toEqual({ ungated: true, unannounced: true });
  });

  test("FORBID (mirrors AC.5) — the epic-close receipt announced by a module no list registers (gate_receipt.ts) → ungated-write and unannounced-receipt", async () => {
    const r = await gradeClose({
      write: transitionOnly,
      announcer: (root) => `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" gate-check <${root}>`,
    });
    expect(r).toEqual({ ungated: true, unannounced: true });
  });
});

// ===========================================================================
// AC-STE-699.8 — /ship-milestone orders listing → epic_close.ts → transition
// ===========================================================================

describe("AC-STE-699.8 — the /ship-milestone post-ship Epic close runs epic_close.ts between the children listing and the transition", () => {
  const body = readFileSync(SKILL_MD, "utf-8");
  const start = body.indexOf("### 9. Post-ship checklist");
  const end = body.indexOf("### 9b.", start);
  const section = start >= 0 && end > start ? body.slice(start, end) : "";
  const at = section.indexOf(EPIC_CLOSE);

  test("CONTROL — the post-ship checklist section is found", () => {
    expect(section.length).toBeGreaterThan(0);
  });

  test("the Epic close step names epic_close.ts with its --children listing", () => {
    expect(at, "epic_close.ts is named in the post-ship step").toBeGreaterThanOrEqual(0);
    expect(section.slice(at)).toMatch(/^epic_close\.ts[^\n]*--children/);
  });

  test("order: save the Epic's children listing, THEN run epic_close.ts, THEN the transition", () => {
    expect(at).toBeGreaterThanOrEqual(0);
    const before = section.slice(0, at);
    const after = section.slice(at + EPIC_CLOSE.length);
    expect(before, "the children listing is saved before epic_close.ts runs").toMatch(/sav\w*[^\n]*children|children[^\n]*listing/i);
    expect(after, "the transition follows epic_close.ts").toMatch(/transition/i);
  });

  test("on a refusal the Epic stays open and the refusal is reported verbatim", () => {
    expect(at).toBeGreaterThanOrEqual(0);
    expect(section).toMatch(/refus/i);
    expect(section).toMatch(/verbatim/i);
    expect(section).toMatch(/(stays|remains|left|leave[s]?)\s+(the Epic\s+)?open/i);
  });
});

// ===========================================================================
// AC-STE-699.2 / .3 [hardening] — twins differing from the permit leg in one thing
// ===========================================================================

describe("AC-STE-699.2 / .3 [hardening] — last-page proof and an archived plan are required", () => {
  test("AC-STE-699.2/.3 [hardening] (d) TWIN — the final page says `isLast: false` and hands a nextPageToken → refused, no receipt", () => {
    const w = makeWorld();
    const listing = { ...DONE_CHILDREN(), isLast: false, nextPageToken: "tok-page-2" };
    expectRefused(closeEpic(w, listing), w, /last page|final page|page/i);
  });

  test("AC-STE-699.2/.3 [hardening] (d) TWIN — the final page says `isLast: false` with no further page → refused, no receipt", () => {
    const w = makeWorld();
    const listing = { ...DONE_CHILDREN(), isLast: false };
    expectRefused(closeEpic(w, listing), w, /--children|listing/);
  });

  test("AC-STE-699.2/.3 [hardening] TWIN — the plan tracked at the LIVE path specs/plan/<M>.md (stamped, CHANGELOG heading present) → refused as not archived / not shipped, no receipt", () => {
    const w = makeWorld();
    git(w.be, "rm", "-q", "--", `specs/plan/archive/${MILESTONE}.md`);
    const live = writePlan(w.be, "live", MILESTONE, { [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` }, { shippedIn: `v${VERSION}` });
    commitAll(w.be, "fixture: plan at the live path");
    expect(live).toBe(join(w.be, "specs", "plan", `${MILESTONE}.md`));
    expect(git(w.be, "ls-files", "--", `specs/plan/${MILESTONE}.md`).trim()).toBe(`specs/plan/${MILESTONE}.md`);
    expect(readFileSync(join(w.be, "CHANGELOG.md"), "utf-8")).toContain(`## [${VERSION}]`);
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE), /not archived|not shipped/i);
  });
});

// ===========================================================================
// AC-STE-699.2 [security] — Phase 3, Pass 2: the front door reads what is
// tracked and only children of THIS Epic
// ===========================================================================

describe("AC-STE-699.2(b) [security] S6 — shipped_in is read from the git INDEX, not the working tree", () => {
  const SPANS = (): Record<string, string> => ({ [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` });

  test("AC-STE-699.2(b) [security] S6 TWIN — the committed plan carries NO shipped_in; the working-tree copy is stamped v1.2.0 → refused, no receipt", () => {
    const w = makeWorld();
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: null });
    commitAll(w.be, "fixture: the tracked plan is unstamped");
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: `v${VERSION}` });
    expect(git(w.be, "show", `:specs/plan/archive/${MILESTONE}.md`)).toContain("shipped_in: null");
    expect(readFileSync(w.planFile, "utf-8")).toContain(`shipped_in: v${VERSION}`);
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, /shipped_in/);
  });

  test("AC-STE-699.2(b) [security] S6 TWIN — the committed plan is stamped v9.9.9 (no CHANGELOG heading); the working-tree copy says v1.2.0 → refused, no receipt", () => {
    const w = makeWorld();
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: "v9.9.9" });
    commitAll(w.be, "fixture: the tracked plan carries an unshipped stamp");
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: `v${VERSION}` });
    expect(git(w.be, "show", `:specs/plan/archive/${MILESTONE}.md`)).toContain("shipped_in: v9.9.9");
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, /shipped_in|9\.9\.9/);
  });

  test("AC-STE-699.2(b) [security] S6 TWIN — the STAGED plan is unstamped while the working tree is stamped → refused, no receipt", () => {
    const w = makeWorld();
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: null });
    git(w.be, "add", "--", `specs/plan/archive/${MILESTONE}.md`);
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: `v${VERSION}` });
    expect(git(w.be, "show", `:specs/plan/archive/${MILESTONE}.md`)).toContain("shipped_in: null");
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, /shipped_in/);
  });
});

describe("AC-STE-699.2 [M1] — the plan is read from HEAD: a plan that is only staged never closes the Epic (v3.4.0 fix round 1)", () => {
  const SPANS = (): Record<string, string> => ({ [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` });
  const REL = `specs/plan/archive/${MILESTONE}.md`;
  /** stdout of a git probe, or "" when git fails. */
  const gitOut = (root: string, ...args: string[]): string => {
    const p = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
    return p.exitCode === 0 ? p.stdout.toString() : "";
  };

  test("AC-STE-699.2 [M1] TWIN — no plan in HEAD; the shipped plan is only `git add`-ed (index = working tree) → refused, no receipt", () => {
    const w = makeWorld({ untrackedPlan: true });
    git(w.be, "add", "--", REL);
    expect(gitOut(w.be, "ls-tree", "--name-only", "HEAD", "--", REL).trim(), "fixture: HEAD has no plan").toBe("");
    expect(gitOut(w.be, "ls-files", "--", REL).trim(), "fixture: the index tracks the staged plan").toBe(REL);
    expect(gitOut(w.be, "diff", "--name-only", "--", REL).trim(), "fixture: the working tree equals the index").toBe("");
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE));
  });

  test("AC-STE-699.2 [M1] TWIN — HEAD's plan is unstamped; the stamp v1.2.0 is only `git add`-ed (index = working tree) → refused, no receipt", () => {
    const w = makeWorld();
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: null });
    commitAll(w.be, "fixture: the committed plan is unstamped");
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: `v${VERSION}` });
    git(w.be, "add", "--", REL);
    expect(gitOut(w.be, "show", `HEAD:${REL}`), "fixture: HEAD is unstamped").toContain("shipped_in: null");
    expect(gitOut(w.be, "show", `:${REL}`), "fixture: the index is stamped").toContain(`shipped_in: v${VERSION}`);
    expect(readFileSync(w.planFile, "utf-8"), "fixture: the working tree is stamped").toContain(`shipped_in: v${VERSION}`);
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE));
  });

  test("AC-STE-699.2 [M1] PERMIT CONTROL — the committed, clean plan (HEAD = index = working tree) still closes, one receipt", () => {
    const w = makeWorld();
    expect(gitOut(w.be, "status", "--porcelain", "--", REL).trim(), "fixture: the plan is clean against HEAD").toBe("");
    expectClosed(closeEpic(w, DONE_CHILDREN()), w);
  });
});

// ===========================================================================
// AC-STE-699.2 [N1] / [N2] — v3.4.0 fix round 2: git compares the plan with
// HEAD (so a clean CRLF checkout is HEAD), and epic_close holds only the plan's
// FRONTMATTER to HEAD — a body-only edit after the release commit (a ticked
// checkbox) closes as it did in v3.3.0.
// ===========================================================================

describe("AC-STE-699.2 [N1] — a clean CRLF checkout of the shipped plan closes the Epic", () => {
  const REL = `specs/plan/archive/${MILESTONE}.md`;
  const gitOut = (root: string, ...args: string[]): string => {
    const p = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
    return p.exitCode === 0 ? p.stdout.toString() : "";
  };
  /** Re-check-out BE's plan under `mode`, so the working tree holds CRLF while `git status` stays clean. */
  const crlfCheckout = (w: World, mode: "autocrlf" | "attributes"): void => {
    if (mode === "autocrlf") git(w.be, "config", "core.autocrlf", "true");
    else {
      writeFileSync(join(w.be, ".gitattributes"), "*.md text eol=crlf\n");
      git(w.be, "add", "--", ".gitattributes");
      git(w.be, "commit", "-q", "-m", "fixture: markdown checks out with CRLF");
    }
    rmSync(w.planFile);
    git(w.be, "checkout", "--", REL);
  };

  for (const mode of ["autocrlf", "attributes"] as const) {
    const how = mode === "autocrlf" ? "`core.autocrlf=true`" : "`.gitattributes` `*.md text eol=crlf`";
    test(`AC-STE-699.2 [N1] PERMIT — ${how}: the plan re-checked-out with CRLF, \`git status --porcelain\` empty → closes, one receipt`, () => {
      const w = makeWorld();
      crlfCheckout(w, mode);
      expect(readFileSync(w.planFile, "utf-8"), "fixture: the working tree holds CRLF").toContain("\r\n");
      expect(gitOut(w.be, "show", `HEAD:${REL}`), "fixture: HEAD's blob holds LF").not.toContain("\r\n");
      expect(gitOut(w.be, "status", "--porcelain").trim(), "fixture: the checkout is clean").toBe("");
      expectClosed(closeEpic(w, DONE_CHILDREN()), w);
    });

    test(`AC-STE-699.2 [N1] TWIN — ${how}: HEAD unstamped, the stamp v${VERSION} only \`git add\`-ed (CRLF on disk) → refused, no receipt`, () => {
      const w = makeWorld();
      writePlan(w.be, "archive", MILESTONE, { [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` }, { shippedIn: null });
      commitAll(w.be, "fixture: the committed plan is unstamped");
      crlfCheckout(w, mode);
      writePlan(w.be, "archive", MILESTONE, { [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` }, { shippedIn: `v${VERSION}` });
      writeFileSync(w.planFile, readFileSync(w.planFile, "utf-8").replace(/\r?\n/g, "\r\n"));
      git(w.be, "add", "--", REL);
      expect(gitOut(w.be, "show", `HEAD:${REL}`), "fixture: HEAD is unstamped").toContain("shipped_in: null");
      expect(gitOut(w.be, "show", `:${REL}`), "fixture: the index is stamped").toContain(`shipped_in: v${VERSION}`);
      expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE));
    });
  }
});

describe("AC-STE-699.2 [N2] — epic_close holds the plan's frontmatter, not its body, to HEAD (no stricter than v3.3.0)", () => {
  const SPANS = (): Record<string, string> => ({ [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` });
  const REL = `specs/plan/archive/${MILESTONE}.md`;
  const gitOut = (root: string, ...args: string[]): string => {
    const p = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
    return p.exitCode === 0 ? p.stdout.toString() : "";
  };
  /** BE's shipped plan with an unticked task committed; returns the committed text. */
  const withTask = (w: World): string => {
    writeFileSync(w.planFile, `${readFileSync(w.planFile, "utf-8")}- [ ] Close the Epic.\n`);
    commitAll(w.be, "fixture: the plan lists one task");
    return readFileSync(w.planFile, "utf-8");
  };
  const frontmatterOf = (text: string): string => text.split("---")[1] ?? "";

  test("AC-STE-699.2 [N2] PERMIT — the task checkbox ticked in the working tree only (frontmatter = HEAD) → closes, one receipt", () => {
    const w = makeWorld();
    const committed = withTask(w);
    writeFileSync(w.planFile, committed.replace("- [ ] Close the Epic.", "- [x] Close the Epic."));
    expect(gitOut(w.be, "diff", "--name-only", "HEAD", "--", REL).trim(), "fixture: the body differs from HEAD").toBe(REL);
    expect(frontmatterOf(readFileSync(w.planFile, "utf-8")), "fixture: the frontmatter equals HEAD's").toBe(frontmatterOf(gitOut(w.be, "show", `HEAD:${REL}`)));
    expectClosed(closeEpic(w, DONE_CHILDREN()), w);
  });

  test("AC-STE-699.2 [N2] PERMIT — the ticked checkbox staged (index = working tree, body ≠ HEAD, frontmatter = HEAD) → closes, one receipt", () => {
    const w = makeWorld();
    const committed = withTask(w);
    writeFileSync(w.planFile, committed.replace("- [ ] Close the Epic.", "- [x] Close the Epic."));
    git(w.be, "add", "--", REL);
    expect(gitOut(w.be, "diff", "--name-only", "--cached", "--", REL).trim(), "fixture: the index differs from HEAD").toBe(REL);
    expectClosed(closeEpic(w, DONE_CHILDREN()), w);
  });

  test("AC-STE-699.2 [N2] TWIN — the same ticked body, plus `shipped_in: v1.1.0` only staged (a CHANGELOG release, HEAD says v1.2.0) → refused, no receipt", () => {
    const w = makeWorld();
    withTask(w);
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: "v1.1.0" });
    writeFileSync(w.planFile, `${readFileSync(w.planFile, "utf-8")}- [x] Close the Epic.\n`);
    git(w.be, "add", "--", REL);
    expect(gitOut(w.be, "show", `HEAD:${REL}`), "fixture: HEAD is stamped v1.2.0").toContain(`shipped_in: v${VERSION}`);
    expect(gitOut(w.be, "show", `:${REL}`), "fixture: the index is stamped v1.1.0").toContain("shipped_in: v1.1.0");
    expect(readFileSync(join(w.be, "CHANGELOG.md"), "utf-8"), "fixture: v1.1.0 is a CHANGELOG release").toContain("## [1.1.0]");
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE), /HEAD/);
  });

  test("AC-STE-699.2 [N2] TWIN — the frontmatter differs from HEAD in the working tree only (an extra key; body untouched) → refused, no receipt", () => {
    const w = makeWorld();
    writePlan(w.be, "archive", MILESTONE, SPANS(), { shippedIn: `v${VERSION}`, extra: { note: "uncommitted" } });
    expect(gitOut(w.be, "diff", "--name-only", "--cached", "--", REL).trim(), "fixture: the index equals HEAD").toBe("");
    expect(gitOut(w.be, "diff", "--name-only", "--", REL).trim(), "fixture: the working tree differs").toBe(REL);
    expectRefused(closeEpic(w, DONE_CHILDREN()), w, new RegExp(MILESTONE), /HEAD/);
  });
});

describe("AC-STE-699.2(d) [security] S7 — every listed child must name THIS Epic as its parent", () => {
  const withParent = (row: Record<string, unknown>, parent: string | null): Record<string, unknown> => {
    const fields = { ...(row.fields as Record<string, unknown>) };
    if (parent === null) delete fields.parent;
    else fields.parent = { key: parent };
    return { ...row, fields };
  };

  test("AC-STE-699.2(d) [security] S7 TWIN — one done row whose fields.parent.key is GK-999 → refused under (d), naming that row, no receipt", () => {
    const w = makeWorld();
    const listing = {
      issues: [withParent(child(FE_FR, "done", [FE_TAG]), "GK-999"), child(BE_FR, "done", [BE_TAG])],
      isLast: true,
    };
    expectRefused(closeEpic(w, listing), w, new RegExp(FE_FR), /parent|GK-999|child/i);
  });

  test("AC-STE-699.2(d) [security] S7 TWIN — EVERY row names another Epic (GK-999), all done → refused, no receipt", () => {
    const w = makeWorld();
    const listing = {
      issues: [withParent(child(FE_FR, "done", [FE_TAG]), "GK-999"), withParent(child(BE_FR, "done", [BE_TAG]), "GK-999")],
      isLast: true,
    };
    expectRefused(closeEpic(w, listing), w, /GK-999|parent/i);
  });

  test("AC-STE-699.2(d) [security] S7 PERMIT CONTROL — rows whose fields.parent.key equals GK-85 → closed, one receipt", () => {
    const w = makeWorld();
    expectClosed(closeEpic(w, DONE_CHILDREN()), w);
  });

  test("AC-STE-699.2(d) [security] S7 — rows with no parent field are refused (amended by AC-STE-701.2)", () => {
    const w = makeWorld();
    const listing = {
      issues: [withParent(child(FE_FR, "done", [FE_TAG]), null), withParent(child(BE_FR, "done", [BE_TAG]), null)],
      isLast: true,
    };
    expectRefused(closeEpic(w, listing), w, new RegExp(FE_FR), new RegExp(BE_FR), /\bparent\b[^\n]*\bmissing\b|\bmissing\b[^\n]*\bparent\b|\bno parent\b/i);
  });
});
