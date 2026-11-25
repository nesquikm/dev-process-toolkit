// STE-868 (M_b054b1) — a refusal names the plugin copy that ran.
//
// A deciding command run from ANOTHER copy of this plugin prints a normal
// receipt announcement the gate must keep ignoring (STE-607). The refusal says
// which copy ran and which one the hook trusts. The sentence itself is free;
// what it carries is pinned: both roots, both versions, "rerun".
//
// Every leg spawns the `.sh` wrapper of a plugin copy laid out as Claude Code's
// cache lays it out (<tmp>/cache/<marketplace>/dev-process-toolkit/<version>/)
// with CLAUDE_PLUGIN_ROOT at that copy. The refusal to a bare transcript is the
// baseline a leg is compared with: text the note adds is what differs from it.
//
// Invented keys and temporary paths only (GK-*, example.invalid).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { commitAll, git, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, declareJira } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import {
  JIRA,
  SESSION,
  Transcript,
  announcementLines,
  childEnv,
  cleanupTemps as cleanupFixtureTemps,
  moduleRel,
  neutralCwd,
  permitProblem,
  refusalProblem,
  runModule,
  show,
  type Run,
} from "./_m_b2fdc0_ste729_fixture";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const PLUGIN = "dev-process-toolkit";
const SH_REL = join("templates", "hooks", "process", "pre-tracker-write-gate.sh");
const EPIC_CLOSE = "epic_close.ts";
const CONFIRM = "ticket_ownership.ts";
const DECIDE = "create_idempotency_probe.ts";
const ATTACH = "attach_project_milestone.ts";
const EPIC = "GK-85";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const SHIPPED = "1.2.0";
const CLOUD = "example.invalid";
const TITLE = "BE payout export";
const OWN_VERSION = "9.4.2";
const FOREIGN_VERSION = "3.1.4";
const CHECKOUT_VERSION = "2.95.6";
type Input = Record<string, unknown>;

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-868-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupFixtureTemps();
});

// ------------------------------------------------------------- plugin copies

/** A runnable plugin copy at `root`: real sources, its own manifest. */
function fullCopy(root: string, version: string): string {
  mkdirSync(root, { recursive: true });
  cpSync(join(PLUGIN_ROOT, "templates"), join(root, "templates"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "adapters"), join(root, "adapters"), { recursive: true, filter: (s) => basename(s) !== "node_modules" });
  symlinkSync(join(PLUGIN_ROOT, "adapters", "_shared", "node_modules"), join(root, "adapters", "_shared", "node_modules"));
  pluginManifest(root, version);
  return root;
}

/** A directory holding files named as the deciding modules, and the manifest bytes given (null: none). */
function stubCopy(root: string, manifest: string | null): string {
  for (const m of [EPIC_CLOSE, CONFIRM, DECIDE]) {
    mkdirSync(dirname(join(root, moduleRel(m))), { recursive: true });
    writeFileSync(join(root, moduleRel(m)), "// a stub, never run\n");
  }
  if (manifest !== null) {
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), manifest);
  }
  return root;
}
const manifestOf = (version: string): string => JSON.stringify({ name: PLUGIN, version });
const cacheRoot = (base: string, version: string, plugin = PLUGIN): string => join(base, "cache", "example-market", plugin, version);

let OWN = "";
let FOREIGN = ""; // cache layout, a sibling version of OWN, runnable
let CHECKOUT = ""; // not a cache path, manifest only
let be = "";
let scratch = "";
let baseline = ""; // stderr of the close refused on a transcript with no deciding command
let createBaseline = "";
let runSeq = 0;

// --------------------------------------------------------------- gate driver

async function gate(tool: string, input: Input, t: Transcript, cwd = be, pluginRoot = OWN): Promise<Run> {
  const path = join(scratch, `transcript-${++runSeq}.jsonl`);
  const gatedId = "toolu_868_gated";
  const gated = new Transcript();
  gated.use(JIRA(tool), input, gatedId);
  writeFileSync(path, [...t.lines, ...gated.lines].join("\n") + "\n");
  const payload = JSON.stringify({
    session_id: SESSION,
    transcript_path: path,
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: JIRA(tool),
    tool_input: input,
    tool_use_id: gatedId,
  });
  const proc = Bun.spawn(["bash", join(pluginRoot, SH_REL)], {
    cwd: neutralCwd(),
    env: childEnv(pluginRoot),
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

const close = (t: Transcript): Promise<Run> => gate("transitionJiraIssue", { cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" } }, t);
const create = (t: Transcript): Promise<Run> =>
  gate("createJiraIssue", { cloudId: CLOUD, projectKey: "GK", issueTypeName: "Task", summary: TITLE, parent: EPIC, additional_fields: { labels: [BE_TAG] } }, t);

/** The close graded on `t` is an NFR-10 refusal, and the gate did not throw. Returns its stderr. */
async function refusedClose(t: Transcript): Promise<string> {
  const r = await close(t);
  expect(refusalProblem(r), show(r)).toBeNull();
  expect(r.stderr).not.toContain("failed while checking this call");
  return r.stderr;
}

// --------------------------------------------------------------- note readers

/** What `got` adds over `base`, one contiguous insertion. */
function added(base: string, got: string): string {
  let a = 0;
  while (a < base.length && base[a] === got[a]) a++;
  let z = 0;
  while (z < base.length - a && base[base.length - 1 - z] === got[got.length - 1 - z]) z++;
  return got.slice(a, got.length - z);
}

/** Text with the roots taken out: a cache root spells its version, which is not naming the version. */
const withoutRoots = (text: string, ...roots: string[]): string => roots.reduce((s, r) => s.replaceAll(r, "<root>"), text);

/** The refusal names the foreign copy and the hook's own, with both versions, and says to rerun. */
function expectCopyNote(stderr: string, foreignRoot: string, foreignVersion: string, o: { base?: string; own?: string; ownVersion?: string } = {}): void {
  const own = o.own ?? OWN;
  const note = added(o.base ?? baseline, stderr);
  const bare = withoutRoots(note, foreignRoot, own);
  expect(
    {
      foreignRoot: note.includes(foreignRoot),
      ownRoot: note.includes(own),
      foreignVersion: bare.toLowerCase().includes(foreignVersion),
      ownVersion: bare.includes(o.ownVersion ?? OWN_VERSION),
      rerun: /\bre-?run\b/i.test(bare),
    },
    stderr,
  ).toEqual({ foreignRoot: true, ownRoot: true, foreignVersion: true, ownVersion: true, rerun: true });
}

const cited = (cmd: string): string => (cmd.length > 240 ? `${cmd.slice(0, 240)}…` : cmd);
/** Today's sentence for `count` rejected commands, the latest being `cmd`. */
const todaysNote = (count: number, cmd: string): string =>
  ` ${count} Bash command(s) ran a deciding subcommand in a shape that is not a plain invocation, so any receipt they wrote was ignored — the latest: \`${cited(cmd)}\`.`;
const NOT_PLAIN = "in a shape that is not a plain invocation, so any receipt";

/** Today's note exactly, and nothing else beside the baseline refusal. */
function expectOnlyTodaysNote(stderr: string, count: number, cmd: string): void {
  expect(stderr).toContain(todaysNote(count, cmd));
  expect(stderr.replace(todaysNote(count, cmd), "")).toBe(baseline);
}

// ------------------------------------------------------------------- commands

const closeArgs = (): string => `${be} ${EPIC} --children ${join(scratch, "children.json")}`;
const closeCmd = (root: string): string => `bun run "${join(root, moduleRel(EPIC_CLOSE))}" ${closeArgs()}`;
const confirmCmd = (root: string): string => `bun run "${join(root, moduleRel(CONFIRM))}" confirm ${be} ${EPIC} ${join(scratch, "ticket.json")}`;
const wrapped = (cmd: string): string => `cd "${be}" && ${cmd}`;

/** A transcript of Bash calls, each with a successful result carrying no announcement. */
function bashes(...cmds: string[]): Transcript {
  const t = new Transcript();
  for (const c of cmds) t.bash(c, "done");
  return t;
}

beforeAll(async () => {
  scratch = tempDir("scratch");
  const cache = tempDir("plugins");
  OWN = fullCopy(cacheRoot(cache, OWN_VERSION), OWN_VERSION);
  FOREIGN = fullCopy(cacheRoot(cache, FOREIGN_VERSION), FOREIGN_VERSION);
  CHECKOUT = stubCopy(join(tempDir("checkout"), "toolkit"), manifestOf(CHECKOUT_VERSION));

  // The STE-699 world: BE planned and shipped M_GK_85.
  const parent = tempDir("world");
  be = join(parent, BE_TAG);
  const fe = join(parent, FE_TAG);
  mkdirSync(be, { recursive: true });
  mkdirSync(fe, { recursive: true });
  declareJira(be, BE_TAG);
  declareJira(fe, FE_TAG);
  writePlan(be, "archive", MILESTONE, { [BE_TAG]: ".", [FE_TAG]: `../${FE_TAG}` }, { shippedIn: `v${SHIPPED}` });
  writeFr(be, "GK-111", MILESTONE, "archived");
  writeFileSync(join(be, "CHANGELOG.md"), `# Changelog\n\n## [${SHIPPED}] — 2026-11-01 — "Close Out"\n\n### Fixed\n\n- The milestone shipped.\n`);
  writePlan(fe, "archive", MILESTONE, { [BE_TAG]: `../${BE_TAG}`, [FE_TAG]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, "GK-101", MILESTONE, "archived");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  const child = (key: string, label: string): Input => ({
    key,
    fields: {
      summary: `Child ${key}`,
      status: { name: "Done", statusCategory: { key: "done" } },
      issuetype: { name: "Task" },
      project: { key: "GK" },
      labels: [label],
      parent: { key: EPIC },
    },
  });
  writeFileSync(join(scratch, "children.json"), JSON.stringify({ issues: [child("GK-101", FE_TAG), child("GK-111", BE_TAG)], isLast: true }));

  const bare = await close(new Transcript());
  if (refusalProblem(bare) !== null) throw new Error(`fixture: the bare close must refuse:\n${show(bare)}`);
  baseline = bare.stderr;
  const bareCreate = await create(new Transcript());
  if (refusalProblem(bareCreate) !== null) throw new Error(`fixture: the bare create must refuse:\n${show(bareCreate)}`);
  createBaseline = bareCreate.stderr;
});

// ===========================================================================
// AC-STE-868.1 — the note names the copy that ran and the copy the hook trusts
// ===========================================================================

describe("AC-STE-868.1 — a deciding command run from another copy is named in the refusal", () => {
  test("another version in the same plugin cache", async () => {
    expectCopyNote(await refusedClose(bashes(closeCmd(FOREIGN))), FOREIGN, FOREIGN_VERSION);
  });

  test("a checkout outside any cache, known by its manifest's name", async () => {
    expectCopyNote(await refusedClose(bashes(closeCmd(CHECKOUT))), CHECKOUT, CHECKOUT_VERSION);
  });

  test("a module with a receipt subcommand (`ticket_ownership.ts confirm`)", async () => {
    expectCopyNote(await refusedClose(bashes(confirmCmd(FOREIGN))), FOREIGN, FOREIGN_VERSION);
  });

  test("`bun <path>` with no `run`", async () => {
    expectCopyNote(await refusedClose(bashes(closeCmd(FOREIGN).replace("bun run ", "bun "))), FOREIGN, FOREIGN_VERSION);
  });

  test("a ticket create's refusal carries the note too", async () => {
    const r = await create(bashes(`bun run "${join(FOREIGN, moduleRel(DECIDE))}" decide "${be}" /tmp/page.json --title "${TITLE}" --parent ${EPIC} --attempt fast`));
    expect(refusalProblem(r), show(r)).toBeNull();
    expectCopyNote(r.stderr, FOREIGN, FOREIGN_VERSION, { base: createBaseline });
  });

  test("the hook itself runs from a checkout: its own root and manifest version are the ones named", async () => {
    const own = realpathSync(PLUGIN_ROOT);
    const ownVersion = (JSON.parse(readFileSync(join(own, ".claude-plugin", "plugin.json"), "utf-8")) as { version: string }).version;
    const input = { cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" } };
    const bare = await gate("transitionJiraIssue", input, new Transcript(), be, own);
    const r = await gate("transitionJiraIssue", input, bashes(closeCmd(FOREIGN)), be, own);
    expect(refusalProblem(r), show(r)).toBeNull();
    expectCopyNote(r.stderr, FOREIGN, FOREIGN_VERSION, { base: bare.stderr, own, ownVersion });
  });

  test("two runs of one module from one copy read as one: one line per module", async () => {
    const once = await refusedClose(bashes(closeCmd(FOREIGN)));
    expectCopyNote(once, FOREIGN, FOREIGN_VERSION);
    expect(await refusedClose(bashes(closeCmd(FOREIGN), closeCmd(FOREIGN)))).toBe(once);
  });

  test("two copies ran one module: only the latest run is named", async () => {
    const stderr = await refusedClose(bashes(closeCmd(FOREIGN), closeCmd(CHECKOUT)));
    expectCopyNote(stderr, CHECKOUT, CHECKOUT_VERSION);
    expect(stderr).not.toContain(FOREIGN);
  });

  test("two modules, each from its own copy: both copies are named", async () => {
    const stderr = await refusedClose(bashes(closeCmd(FOREIGN), confirmCmd(CHECKOUT)));
    expectCopyNote(stderr, FOREIGN, FOREIGN_VERSION);
    expectCopyNote(stderr, CHECKOUT, CHECKOUT_VERSION);
  });

  test("a symlink whose target is another copy names that copy's real root", async () => {
    const link = join(tempDir("link"), "elsewhere");
    symlinkSync(FOREIGN, link);
    expectCopyNote(await refusedClose(bashes(closeCmd(link))), FOREIGN, FOREIGN_VERSION);
  });

  test("CONTROL — a symlinked path that resolves to the hook's own copy is not another copy", async () => {
    const link = join(tempDir("link"), "elsewhere");
    symlinkSync(OWN, link);
    expect(await refusedClose(bashes(closeCmd(link)))).toBe(baseline);
  });

  test("CONTROL — a plugin root whose `adapters` resolves into the hook's own copy is not another copy", async () => {
    const root = tempDir("linked-root");
    pluginManifest(root, FOREIGN_VERSION);
    symlinkSync(join(OWN, "adapters"), join(root, "adapters"));
    expect(await refusedClose(bashes(closeCmd(root)))).toBe(baseline);
  });

  test("CONTROL — the plugin-root variable is the hook's own copy", async () => {
    expect(await refusedClose(bashes(closeCmd("${CLAUDE_PLUGIN_ROOT}")))).toBe(baseline);
  });

  test("CONTROL — another copy's read-only subcommand (`ticket_ownership.ts decide`) adds nothing", async () => {
    expect(await refusedClose(bashes(confirmCmd(FOREIGN).replace(" confirm ", " decide ")))).toBe(baseline);
  });

  test("CONTROL — a command that only prints the invocation adds nothing", async () => {
    expect(await refusedClose(bashes(`echo ${closeCmd(FOREIGN)}`))).toBe(baseline);
  });

  test("CONTROL — in an undeclared repository a foreign run stays silent", async () => {
    const root = tempDir("undeclared");
    declareJira(root, null);
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
    const r = await gate("transitionJiraIssue", { cloudId: CLOUD, issueIdOrKey: EPIC, transition: { id: "41" } }, bashes(closeCmd(FOREIGN)), root);
    expect(r).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });
});

// ===========================================================================
// AC-STE-868.2 — out of the "not a plain invocation" count
// ===========================================================================

describe("AC-STE-868.2 — a foreign plain command is left out of the 'not a plain invocation' note", () => {
  test("alone, it draws no such note", async () => {
    const stderr = await refusedClose(bashes(closeCmd(FOREIGN)));
    expect(stderr).not.toContain(NOT_PLAIN);
  });

  for (const order of ["before", "after"] as const) {
    test(`${order} a wrapped command of another module, that one is counted and cited, and the copy is named`, async () => {
      const others = wrapped(confirmCmd(OWN));
      const stderr = await refusedClose(order === "before" ? bashes(closeCmd(FOREIGN), others) : bashes(others, closeCmd(FOREIGN)));
      expect(stderr).toContain(todaysNote(1, others));
      expectCopyNote(stderr.replace(todaysNote(1, others), ""), FOREIGN, FOREIGN_VERSION);
    });
  }

  test("between two wrapped commands, the two are counted and the later one cited", async () => {
    const last = wrapped(closeCmd(OWN));
    const stderr = await refusedClose(bashes(wrapped(confirmCmd(OWN)), confirmCmd(FOREIGN), last));
    expect(stderr).toContain(todaysNote(2, last));
    expectCopyNote(stderr.replace(todaysNote(2, last), ""), FOREIGN, FOREIGN_VERSION);
  });

  test("a foreign run supersedes nothing: a wrapped command of the SAME module stays counted", async () => {
    const own = wrapped(closeCmd(OWN));
    const stderr = await refusedClose(bashes(own, closeCmd(FOREIGN)));
    expect(stderr).toContain(todaysNote(1, own));
    expectCopyNote(stderr.replace(todaysNote(1, own), ""), FOREIGN, FOREIGN_VERSION);
  });

  const NOT_ALSO_PLAIN: Array<[string, (cmd: string) => string]> = [
    ["cd-prefixed", (c) => wrapped(c)],
    ["chained", (c) => `${c}; echo done`],
    ["redirected", (c) => `${c} 2>&1`],
    ["piped", (c) => `${c} | tail -5`],
    ["with an assignment before it", (c) => `X=1 ${c}`],
  ];
  for (const [name, shape] of NOT_ALSO_PLAIN) {
    test(`TWIN — a foreign command ${name} keeps today's note and gains none`, async () => {
      const cmd = shape(closeCmd(FOREIGN));
      expectOnlyTodaysNote(await refusedClose(bashes(cmd)), 1, cmd);
    });
  }

  test("TWIN — a foreign command with an argv the module is not accepted with keeps today's note and gains none", async () => {
    const cmd = `bun run "${join(FOREIGN, moduleRel(EPIC_CLOSE))}" ${be} ${EPIC}`;
    expectOnlyTodaysNote(await refusedClose(bashes(cmd)), 1, cmd);
  });
});

// ===========================================================================
// AC-STE-868.3 — manifests that cannot be read, and files outside any copy
// ===========================================================================

describe("AC-STE-868.3 — under another dev-process-toolkit cache directory, a manifest without a version is 'version unknown'", () => {
  const MANIFESTS: Array<[string, string | null]> = [
    ["absent", null],
    ["not JSON", "{ not json"],
    ["empty", ""],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["versionless", JSON.stringify({ name: PLUGIN })],
    ["carrying a version that is no string", JSON.stringify({ name: PLUGIN, version: 3 })],
  ];
  for (const [name, manifest] of MANIFESTS) {
    test(`the manifest is ${name}`, async () => {
      const root = stubCopy(cacheRoot(tempDir("unknown"), "3.0.1"), manifest);
      const stderr = await refusedClose(bashes(closeCmd(root)));
      expectCopyNote(stderr, root, "version unknown");
      expect(stderr).not.toContain(NOT_PLAIN);
    });
  }

  test("the manifest path is a directory", async () => {
    const root = stubCopy(cacheRoot(tempDir("unknown"), "3.0.1"), null);
    mkdirSync(join(root, ".claude-plugin", "plugin.json"), { recursive: true });
    expectCopyNote(await refusedClose(bashes(closeCmd(root))), root, "version unknown");
  });

  test("the whole version directory is gone", async () => {
    const root = cacheRoot(tempDir("unknown"), "3.0.1");
    expectCopyNote(await refusedClose(bashes(closeCmd(root))), root, "version unknown");
  });

  test("CONTROL — a readable manifest there reports its own version, not unknown", async () => {
    const root = stubCopy(cacheRoot(tempDir("known"), "3.0.1"), manifestOf("3.0.2"));
    const stderr = await refusedClose(bashes(closeCmd(root)));
    expectCopyNote(stderr, root, "3.0.2");
    expect(stderr.toLowerCase()).not.toContain("version unknown");
  });
});

describe("AC-STE-868.3 — a same-named module file outside any plugin copy keeps today's note and gains none", () => {
  const STRAYS: Array<[string, () => string]> = [
    ["a stray tree with no manifest", () => stubCopy(tempDir("stray"), null)],
    ["a stray tree whose manifest is not JSON", () => stubCopy(tempDir("stray"), "{ not json")],
    ["a tree whose manifest names another plugin", () => stubCopy(tempDir("other"), JSON.stringify({ name: "other-plugin", version: FOREIGN_VERSION }))],
    [
      "another plugin's cache directory",
      () => stubCopy(cacheRoot(tempDir("other"), FOREIGN_VERSION, "other-plugin"), JSON.stringify({ name: "other-plugin", version: FOREIGN_VERSION })),
    ],
    ["another plugin's cache directory with no manifest", () => stubCopy(cacheRoot(tempDir("other"), FOREIGN_VERSION, "other-plugin"), null)],
    ["a <plugin>/<version> tree outside any cache, with no manifest", () => stubCopy(join(tempDir("work"), "example-market", PLUGIN, FOREIGN_VERSION), null)],
  ];
  for (const [name, make] of STRAYS) {
    test(name, async () => {
      const cmd = closeCmd(make());
      expectOnlyTodaysNote(await refusedClose(bashes(cmd)), 1, cmd);
    });
  }

  test("a bare file named as the module, in no plugin layout at all", async () => {
    const file = join(tempDir("stray"), EPIC_CLOSE);
    writeFileSync(file, "// a stray\n");
    const cmd = `bun run "${file}" ${closeArgs()}`;
    expectOnlyTodaysNote(await refusedClose(bashes(cmd)), 1, cmd);
  });

  test("beside a foreign run, the stray alone is counted and cited", async () => {
    const stray = closeCmd(stubCopy(tempDir("stray"), null));
    const stderr = await refusedClose(bashes(stray, confirmCmd(FOREIGN)));
    expect(stderr).toContain(todaysNote(1, stray));
    expectCopyNote(stderr.replace(todaysNote(1, stray), ""), FOREIGN, FOREIGN_VERSION);
  });
});

// ===========================================================================
// AC-STE-868.4 — a later accepted run that ran drops the note
// ===========================================================================

describe("AC-STE-868.4 — a later accepted run of the same module drops the note", () => {
  test("its result succeeded → dropped", async () => {
    expectCopyNote(await refusedClose(bashes(closeCmd(FOREIGN))), FOREIGN, FOREIGN_VERSION);
    expect(await refusedClose(bashes(closeCmd(FOREIGN), closeCmd(OWN)))).toBe(baseline);
  });

  test("its result is an `Exit code N` error → dropped", async () => {
    const t = bashes(closeCmd(FOREIGN));
    t.bash(closeCmd(OWN), "Exit code 1\nRefusing: one child is open", true);
    expectCopyNote(await refusedClose(bashes(closeCmd(FOREIGN))), FOREIGN, FOREIGN_VERSION);
    expect(await refusedClose(t)).toBe(baseline);
  });

  test("it was denied → kept", async () => {
    const t = bashes(closeCmd(FOREIGN));
    t.bash(closeCmd(OWN), "Permission to use Bash has been denied.", true);
    expectCopyNote(await refusedClose(t), FOREIGN, FOREIGN_VERSION);
  });

  test("it has no result yet → kept", async () => {
    const t = bashes(closeCmd(FOREIGN));
    t.use("Bash", { command: closeCmd(OWN), description: "run" });
    expectCopyNote(await refusedClose(t), FOREIGN, FOREIGN_VERSION);
  });

  test("the accepted run came first → kept", async () => {
    expectCopyNote(await refusedClose(bashes(closeCmd(OWN), closeCmd(FOREIGN))), FOREIGN, FOREIGN_VERSION);
  });

  test("the accepted run's call came first, its result after → kept", async () => {
    const t = new Transcript();
    const id = t.use("Bash", { command: closeCmd(OWN), description: "run" });
    t.bash(closeCmd(FOREIGN), "done");
    t.result(id, "done");
    expectCopyNote(await refusedClose(t), FOREIGN, FOREIGN_VERSION);
  });

  test("the accepted run was of another module → kept", async () => {
    expectCopyNote(await refusedClose(bashes(closeCmd(FOREIGN), confirmCmd(OWN))), FOREIGN, FOREIGN_VERSION);
  });

  test("of two foreign modules, only the one run again is dropped", async () => {
    const stderr = await refusedClose(bashes(closeCmd(FOREIGN), confirmCmd(CHECKOUT), closeCmd(OWN)));
    expectCopyNote(stderr, CHECKOUT, CHECKOUT_VERSION);
    expect(stderr).not.toContain(FOREIGN);
  });

  test("a foreign run after the accepted one is named again, and the earlier one is not", async () => {
    const stderr = await refusedClose(bashes(closeCmd(CHECKOUT), closeCmd(OWN), closeCmd(FOREIGN)));
    expectCopyNote(stderr, FOREIGN, FOREIGN_VERSION);
    expect(stderr).not.toContain(CHECKOUT);
  });
});

// ===========================================================================
// AC-STE-868.5 — another copy's receipt never permits a write
// ===========================================================================

describe("AC-STE-868.5 — the Epic close", () => {
  /** The transcript of a REAL epic_close.ts run from `root`, which wrote and announced one receipt. */
  function closedBy(root: string): Transcript {
    const r = runModule(root, EPIC_CLOSE, [be, EPIC, "--children", join(scratch, "children.json")]);
    if (r.exitCode !== 0 || announcementLines(r.stdout).length !== 1) throw new Error(`fixture: epic_close.ts did not permit:\n${show(r)}`);
    const t = new Transcript();
    t.run(r);
    return t;
  }

  test("announced by another copy → refused, and the copy is named", async () => {
    expectCopyNote(await refusedClose(closedBy(FOREIGN)), FOREIGN, FOREIGN_VERSION);
  });

  test("TWIN — announced by the hook's own copy → permitted", async () => {
    const r = await close(closedBy(OWN));
    expect(permitProblem(r), show(r)).toBeNull();
  });

  test("TWIN — another copy's run, then the hook's own → permitted", async () => {
    const t = new Transcript();
    t.bash(closeCmd(FOREIGN), "done");
    const r0 = runModule(OWN, EPIC_CLOSE, [be, EPIC, "--children", join(scratch, "children.json")]);
    t.run(r0);
    const r = await close(t);
    expect(permitProblem(r), show(r)).toBeNull();
  });

  test("TWIN — announced through a symlink to the hook's own copy → permitted", async () => {
    const link = join(tempDir("link"), "elsewhere");
    symlinkSync(OWN, link);
    const r = await close(closedBy(link));
    expect(permitProblem(r), show(r)).toBeNull();
  });
});

describe("AC-STE-868.5 — a ticket create", () => {
  function announce(t: Transcript, root: string, module: string, args: string, input: ReceiptInput): void {
    const prev = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = SESSION;
    let path: string;
    try {
      path = writeReceipt(be, input);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = prev;
    }
    t.bash(`bun run "${join(root, moduleRel(module))}" ${args}`, announceReceipt(path));
  }

  /** The `create` receipt announced by `decideRoot`, the `attach-target` one by `attachRoot`. */
  function decided(decideRoot: string, attachRoot: string): Transcript {
    const t = new Transcript();
    const plan = `specs/plan/archive/${MILESTONE}.md`;
    announce(t, decideRoot, DECIDE, `decide "${be}" /tmp/page.json --title "${TITLE}" --parent ${EPIC} --attempt fast`, {
      kind: "create",
      adapter: "jira",
      container: EPIC,
      subject: TITLE,
      decision: "create",
      evidence: { createPayload: { project: "GK", summary: TITLE, labels: [BE_TAG], parent: EPIC } },
    });
    announce(t, attachRoot, ATTACH, `${be} jira GK ${be}/${plan} /tmp/listing.json`, {
      kind: "attach-target",
      adapter: "jira",
      container: "GK",
      subject: MILESTONE,
      decision: "parent",
      evidence: { surface: "parent", key: EPIC, planFile: plan, provenance: { kind: "not-applicable" } },
    });
    return t;
  }

  for (const [name, decideForeign, attachForeign] of [
    ["both receipts", true, true],
    ["the create receipt alone", true, false],
    ["the attach-target receipt alone", false, true],
  ] as const) {
    test(`${name} announced by another copy → refused, and the copy is named`, async () => {
      const r = await create(decided(decideForeign ? FOREIGN : OWN, attachForeign ? FOREIGN : OWN));
      expect(refusalProblem(r), show(r)).toBeNull();
      // The refused check differs from the bare create's, so the facts are read off the whole refusal.
      const bare = withoutRoots(r.stderr, FOREIGN, OWN);
      expect(
        { foreign: r.stderr.includes(FOREIGN), own: r.stderr.includes(OWN), versions: bare.includes(FOREIGN_VERSION) && bare.includes(OWN_VERSION) },
        r.stderr,
      ).toEqual({ foreign: true, own: true, versions: true });
    });
  }

  test("TWIN — both receipts announced by the hook's own copy → permitted", async () => {
    const r = await create(decided(OWN, OWN));
    expect(permitProblem(r), show(r)).toBeNull();
  });
});
