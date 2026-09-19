// STE-611 (M_685ff6) — AC-STE-611.6 (the stranding scenario) and
// AC-STE-611.7 (provenance: the zero-write join is closed).
//
// Both pieces are NEW on this FR — the resolver and the attach front door do
// not exist at 3170dfc — so, as STE-597 did for its own new module, the
// unguarded outcome is graded on a faithful pre-change-semantics SIBLING
// written here: HEAD's order, create first and attach after. The sibling legs
// show the outcome is unguarded there; the real-code legs assert it is guarded
// now, and are RED on the pre-change bytes (no export, and a `bun run` of the
// module exits 0 printing nothing).
//
// Every fixture is a real git repository (GIT_CONFIG_GLOBAL=/dev/null through
// `_span_fixture`'s GIT_ENV), because provenance reads the target's HEAD
// commit. The front doors are spawned as subprocesses with
// CLAUDE_CODE_SESSION_ID set; decision receipts come from the REAL STE-608
// decision front door. The hook half of AC.6 lives in
// `hook-modules-pre-tracker-write-gate.test.ts`, beside its harness.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as attachModule from "../adapters/_shared/src/attach_project_milestone";
import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { RECEIPT_ANNOUNCEMENT_PREFIX } from "../adapters/_shared/src/tracker_receipts";
import { claudeMd, commitAll, git, makeSpanFixture, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, declareJira } from "./_orphan_pages";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const ATTACH_SRC = join(SRC, "attach_project_milestone.ts");
const RESOLVE_SRC = join(SRC, "resolve_milestone_identity.ts");
const SESSION = "s-611-strand";
const OTHER_SESSION = "s-611-other";
const MANIFEST_VERSION = "2.87.0";

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
const cleanups: Array<() => void> = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-611s-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let MANIFEST_DIR = "";
beforeAll(() => {
  MANIFEST_DIR = tempDir("manifest");
  pluginManifest(MANIFEST_DIR, MANIFEST_VERSION);
});

// ---------------------------------------------------------------- spawning

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function spawn(module: string, argv: string[], session: string, cwd: string): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = session;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  const p = Bun.spawnSync(["bun", "run", module, ...argv], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

function show(r: Run): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function writeListing(dir: string, body: unknown): string {
  const p = join(dir, `listing-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(body));
  return p;
}

/** The attach front door: `<projectRoot> jira <project> <planFile> <listingFile>`. */
function attachDoor(root: string, project: string, plan: string, listing: unknown, scratch: string, session = SESSION): Run {
  return spawn(ATTACH_SRC, [root, "jira", project, plan, writeListing(scratch, listing)], session, root);
}

/** The REAL STE-608 decision front door; throws unless it decided. Returns the receipt path. */
function decide(root: string, project: string, flagArgs: string[], listing: unknown, scratch: string, session = SESSION): string {
  const r = spawn(RESOLVE_SRC, [root, "jira", project, writeListing(scratch, listing), ...flagArgs], session, root);
  if (r.exitCode !== 0) throw new Error(`the decision front door failed:\n${show(r)}`);
  const line = r.stdout.split("\n").find((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));
  if (!line) throw new Error(`no announcement:\n${show(r)}`);
  return line.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]!;
}

function receipts(root: string, session = SESSION, kind?: string): string[] {
  const dir = receiptsDir(root, session);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => join(dir, n))
    .filter((p) => {
      if (kind === undefined) return true;
      try {
        return (JSON.parse(readFileSync(p, "utf-8")) as { kind?: unknown }).kind === kind;
      } catch {
        return false;
      }
    });
}

function expectAttached(r: Run, root: string, key: string): void {
  if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
  const ls = r.stdout.split("\n");
  expect(ls).toContain("surface=parent");
  expect(ls).toContain(`key=${key}`);
  expect(ls.filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX)).length).toBe(1);
  expect(receipts(root, SESSION, "attach-target").length).toBe(1);
}

function expectDoorRefused(r: Run, root: string, ...needles: Array<string | RegExp>): void {
  if (r.exitCode !== 1) throw new Error(`expected exit 1, got:\n${show(r)}`);
  expect(r.stdout).toBe("");
  for (const n of needles) {
    if (typeof n === "string") expect(r.stderr).toContain(n);
    else expect(r.stderr).toMatch(n);
  }
  expect(receipts(root, SESSION, "attach-target")).toEqual([]);
}

// ---------------------------------------------------------------- fixtures

const epicRow = (key: string, summary: string, project = "GF") => ({
  key,
  fields: {
    summary,
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    labels: [],
    issuetype: { name: "Epic" },
    project: { key: project },
  },
});

function writePlan(root: string, token: string, title: string): string {
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  const p = join(root, "specs", "plan", `${token}.md`);
  writeFileSync(p, `---\nmilestone: ${token}\nstatus: active\narchived_at: null\n---\n\n## ${token} — ${title} {#${token}}\n\nBody.\n`);
  return p;
}

function gitInit(root: string): void {
  git(root, "init", "-q", "-b", "main");
  commitAll(root, "fixture");
}

/** A shared-declaring repository (repo_tag) bound to `project`, git-initialised. */
function sharedRepo(project: string, tag = BE_TAG): string {
  const root = tempDir(`shared-${project}`);
  claudeMd(root, { mode: "jira", project, defaultLabels: [tag], repoTag: tag, minDptVersion: "2.87.0" });
  gitInit(root);
  return root;
}

/**
 * The two-repository world of the join: FE (`glacy-fe`) minted GF-85 and holds
 * its plan; BE (`glacy-be`) is about to join it. Both declare `repo_tag`.
 */
function joinWorld(): { fe: string; be: string; scratch: string } {
  const span = makeSpanFixture("M_GF_85", { repositories: false });
  cleanups.push(() => span.cleanup());
  const fe = realpathSync(span.a);
  const be = realpathSync(span.b);
  declareJira(fe, FE_TAG);
  declareJira(be, BE_TAG);
  gitInit(fe);
  gitInit(be);
  // FE's plan for the milestone it minted (the sibling STE-610 reads).
  mkdirSync(join(fe, "specs", "plan"), { recursive: true });
  writeFileSync(join(fe, "specs", "plan", "M_GF_85.md"), "---\nmilestone: M_GF_85\nstatus: active\narchived_at: null\n---\n\n# M_GF_85\n");
  return { fe, be, scratch: tempDir("scratch") };
}

const GF_85 = { issues: [epicRow("GF-85", "Payouts")], isLast: true };

// ------------------------------------------------ the pre-change sibling

interface Tracker {
  calls: string[];
  tickets: Map<string, { parent: string | null }>;
  provider: Record<string, unknown>;
  createTicket(title: string): Promise<string>;
}

/** An in-memory Jira: GF's Epics are listed; tickets are created and parented. */
function tracker(epics: Array<{ key: string; name: string }>): Tracker {
  const calls: string[] = [];
  const tickets = new Map<string, { parent: string | null }>();
  let seq = 200;
  const provider: Record<string, unknown> = {
    milestoneBinding: "epic",
    listEpics: async (project: string) => {
      calls.push(`listEpics(${project})`);
      return epics.map((e) => ({ ...e }));
    },
    getIssue: async (id: string) => {
      calls.push(`getIssue(${id})`);
      return { parent: tickets.get(id)?.parent ?? null, labels: [] };
    },
    setParent: async (id: string, key: string) => {
      calls.push(`setParent(${id},${key})`);
      tickets.get(id)!.parent = key;
    },
    addLabel: async () => {
      calls.push("addLabel");
    },
    listMilestones: async () => [],
    saveMilestone: async () => {},
    upsertTicketMetadata: async (id: string) => id,
  };
  return {
    calls,
    tickets,
    provider,
    async createTicket(title: string) {
      seq += 1;
      const id = `GF-${seq}`;
      calls.push(`createTicket(${title})`);
      tickets.set(id, { parent: null });
      return id;
    },
  };
}

/** HEAD's order, faithfully: `Provider.sync` creates the ticket, then the attach runs. */
async function preChangeSibling(t: Tracker, project: string, milestoneName: string, title: string): Promise<{ created: string[]; error: Error | null }> {
  const id = await t.createTicket(title);
  try {
    await attachModule.attachProjectMilestone(t.provider as never, project, milestoneName, id, { sleep: async () => {} });
    return { created: [id], error: null };
  } catch (e) {
    return { created: [id], error: e as Error };
  }
}

/** The post-change order on the real code: the resolver runs first; a refusal leaves nothing to create. */
async function postChangeOrder(t: Tracker, project: string, milestoneName: string, title: string): Promise<{ created: string[]; error: Error | null }> {
  const resolve = (attachModule as unknown as Record<string, unknown>).resolveAttachTarget;
  if (typeof resolve !== "function") throw new Error("resolveAttachTarget is not exported");
  try {
    await (resolve as (p: unknown, pr: string, n: string) => Promise<unknown>)(t.provider, project, milestoneName);
  } catch (e) {
    return { created: [], error: e as Error };
  }
  const id = await t.createTicket(title);
  await attachModule.attachProjectMilestone(t.provider as never, project, milestoneName, id, { sleep: async () => {} });
  return { created: [id], error: null };
}

// ===========================================================================
// AC-STE-611.6 — the stranding scenario
// ===========================================================================

describe("AC-STE-611.6 — graded against the pre-change sibling (create first, attach after)", () => {
  test("(sibling) HEAD's order strands the ticket: created in GF, parentless, then MilestoneEpicNotFoundError", async () => {
    const t = tracker([{ key: "GF-85", name: "Payouts" }]);
    const r = await preChangeSibling(t, "GF", "M_GB_40 — Payouts", "BE payout export");
    expect(r.created.length).toBe(1);
    expect(r.error?.name).toBe("MilestoneEpicNotFoundError");
    expect(t.tickets.get(r.created[0]!)?.parent).toBeNull();
    expect(t.calls[0]).toBe("createTicket(BE payout export)");
  });

  test("the real code resolves first: the refusal arrives before any create, zero tickets exist", async () => {
    const t = tracker([{ key: "GF-85", name: "Payouts" }]);
    const r = await postChangeOrder(t, "GF", "M_GB_40 — Payouts", "BE payout export");
    expect(r.error?.name).toBe("MilestoneEpicNotFoundError");
    expect(r.created).toEqual([]);
    expect(t.tickets.size).toBe(0);
    expect(t.calls.filter((c) => c.startsWith("createTicket") || c.startsWith("setParent"))).toEqual([]);
  });

  test("(control) bound to GB, the real order resolves GB-40, creates once and parents it", async () => {
    const t = tracker([{ key: "GB-40", name: "Payouts" }]);
    const r = await postChangeOrder(t, "GB", "M_GB_40 — Payouts", "BE payout export");
    expect(r.error).toBeNull();
    expect(r.created.length).toBe(1);
    expect(t.tickets.get(r.created[0]!)?.parent).toBe("GB-40");
  });
});

describe("AC-STE-611.6 — the front door refuses the stranded plan and writes no receipt", () => {
  test("repo_tag, bound to GF, active plan M_GB_40: exit 1 naming GB, no receipt", () => {
    const root = sharedRepo("GF");
    const plan = writePlan(root, "M_GB_40", "Payouts");
    commitAll(root, "plan M_GB_40"); // continuing work: provenance is satisfied, the miss is the refusal
    const r = attachDoor(root, "GF", plan, GF_85, tempDir("scratch"));
    expectDoorRefused(r, root, "GB", "MilestoneEpicNotFoundError", '"GF"');
    expect(receipts(root)).toEqual([]);
  }, 30_000);

  test("(control) bound to GB: the target resolves to GB-40 and the receipt is written", () => {
    const root = sharedRepo("GB");
    const plan = writePlan(root, "M_GB_40", "Payouts");
    commitAll(root, "plan M_GB_40");
    const r = attachDoor(root, "GB", plan, { issues: [epicRow("GB-40", "Payouts", "GB")], isLast: true }, tempDir("scratch"));
    expectAttached(r, root, "GB-40");
  }, 30_000);

  test("join path: in a shared project, a plan whose Epic another repository minted resolves to that Epic", () => {
    const w = joinWorld();
    decide(w.be, "GF", ["--join-key", "GF-85", "--sibling", w.fe], GF_85, w.scratch);
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    const r = attachDoor(w.be, "GF", plan, GF_85, w.scratch);
    expectAttached(r, w.be, "GF-85");
  }, 60_000);
});

// ===========================================================================
// AC-STE-611.7 — provenance closes the zero-write join
// ===========================================================================

describe("AC-STE-611.7 — graded against the pre-change sibling: the live silent join", () => {
  test("(sibling) HEAD's order binds a NEW plan to the sibling's Epic with no decision at all", async () => {
    const t = tracker([{ key: "GF-85", name: "Payouts" }]);
    const r = await preChangeSibling(t, "GF", "M_GF_85 — Payouts", "BE payout export");
    expect(r.error).toBeNull();
    expect(t.tickets.get(r.created[0]!)?.parent).toBe("GF-85");
  });

  test("the real front door refuses that new plan without a decision: NFR-10, names GF-85, no receipt", () => {
    const w = joinWorld();
    const plan = writePlan(w.be, "M_GF_85", "Payouts"); // this session is writing it: absent from HEAD
    const r = attachDoor(w.be, "GF", plan, GF_85, w.scratch);
    expectDoorRefused(r, w.be, "GF-85", /without a decision/i, /^Remedy:/m, /^Context:/m);
  }, 30_000);
});

describe("AC-STE-611.7 — provenance legs", () => {
  test("after a decided join by key: passes", () => {
    const w = joinWorld();
    decide(w.be, "GF", ["--join-key", "GF-85", "--sibling", w.fe], GF_85, w.scratch);
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    expectAttached(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85");
  }, 60_000);

  test("after a decided create whose title equals the resolved container's listed title: passes", () => {
    const w = joinWorld();
    decide(w.be, "GF", ["--title", "Payouts"], { issues: [], isLast: true }, w.scratch);
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    expectAttached(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85");
  }, 60_000);

  test("a decided create of a DIFFERENT title does not decide this container: refuses", () => {
    const w = joinWorld();
    decide(w.be, "GF", ["--title", "Refunds"], { issues: [], isLast: true }, w.scratch);
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    expectDoorRefused(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85", /without a decision/i);
  }, 60_000);

  test("a plan already committed at HEAD passes with no decision receipt (continuing work across sessions)", () => {
    const w = joinWorld();
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    commitAll(w.be, "plan M_GF_85");
    expectAttached(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85");
  }, 30_000);

  test("a decision receipt from ANOTHER session does not satisfy: refuses", () => {
    const w = joinWorld();
    decide(w.be, "GF", ["--join-key", "GF-85", "--sibling", w.fe], GF_85, w.scratch, OTHER_SESSION);
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    expectDoorRefused(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85", /without a decision/i);
  }, 60_000);

  test("a malformed decision receipt counts as absent: refuses", () => {
    const w = joinWorld();
    const receipt = decide(w.be, "GF", ["--join-key", "GF-85", "--sibling", w.fe], GF_85, w.scratch);
    writeFileSync(receipt, "{not json");
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    expectDoorRefused(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85", /without a decision/i);
  }, 60_000);

  test("an unreadable decision receipt counts as absent: refuses", () => {
    const w = joinWorld();
    const receipt = decide(w.be, "GF", ["--join-key", "GF-85", "--sibling", w.fe], GF_85, w.scratch);
    chmodSync(receipt, 0o000);
    cleanups.push(() => chmodSync(receipt, 0o644));
    const plan = writePlan(w.be, "M_GF_85", "Payouts");
    expectDoorRefused(attachDoor(w.be, "GF", plan, GF_85, w.scratch), w.be, "GF-85", /without a decision/i);
  }, 60_000);

  test("a target that is not a git repository refuses: HEAD cannot be read", () => {
    const root = tempDir("not-git");
    claudeMd(root, { mode: "jira", project: "GF", defaultLabels: [BE_TAG], repoTag: BE_TAG, minDptVersion: "2.87.0" });
    const plan = writePlan(root, "M_GF_85", "Payouts");
    const r = spawn(ATTACH_SRC, [root, "jira", "GF", plan, writeListing(tempDir("scratch"), GF_85)], SESSION, tempDir("cwd"));
    expectDoorRefused(r, root, /HEAD|git/);
  }, 30_000);

  test("without repo_tag the check does not run: a new uncommitted plan with no decision resolves as before", () => {
    const root = tempDir("unshared");
    claudeMd(root, { mode: "jira", project: "GF" });
    gitInit(root);
    const plan = writePlan(root, "M_GF_85", "Payouts");
    const r = attachDoor(root, "GF", plan, GF_85, tempDir("scratch"));
    expectAttached(r, root, "GF-85");
    expect(r.stderr).toBe("");
  }, 30_000);
});
