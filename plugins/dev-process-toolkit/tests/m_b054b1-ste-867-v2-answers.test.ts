// STE-867 (M_b054b1) — Atlassian v2 answers are read, and an error inside a
// success is an error.
//
// The v2 tools wrap every answer in `{data: …}`, and a refused call can come
// back with NO `is_error` flag as `{data: {error, status, …}}`. The one reader
// (tracker_answer.ts) unwraps one level and names the error; the tracker-write
// gate, its live grader, `decide --from-transcript` and every listing command
// read v2 answers through it. Older answers read as before (AC.6, pinned).
//
// Gate legs run the SHIPPED `.sh` wrapper on a recorded PreToolUse payload;
// grader legs extract transcripts; consumer legs spawn the command. The v2 key
// names were recorded; every key, site and value here is invented.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importFromTracker, ticketImportOwnership } from "../adapters/_shared/src/import";
import type { Provider } from "../adapters/_shared/src/provider";
import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { discoverAcField, fieldRows } from "../adapters/jira/src/discover_field";
import { flaggedError, readCompleteList, readTrackerItem, readTrackerListing, readTrackerPage, trackerItemKey, type CompleteListTool } from "../adapters/_shared/src/tracker_answer";
import { announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { commitAll, git } from "./_span_fixture";
import { BE_TAG, FE_TAG, declareJira } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import { buildPassingBundle, clone, materialize, serverPrefix, type BundleSession, type LiveBundle, type ToolCall, type ToolResult } from "./_live_bundle_fixtures";
import { jiraEpics, jiraIssueTypes, jiraProjects, makeGlade, rowLine, runRepoint, verdict as rowVerdict } from "./_repoint_fixture";
import {
  SESSION,
  TAG,
  TICKET,
  SIBLING_TAG,
  Transcript,
  askAdopt,
  childEnv,
  cleanupTemps as cleanupFixtureTemps,
  gate,
  jiraTicket,
  makeWorld as makeTicketWorld,
  neutralCwd,
  permitProblem,
  refusalProblem,
  runModule,
  shRootFor,
  show,
  type ModuleRun,
  type Run,
  type World as TicketWorld,
} from "./_m_b2fdc0_ste729_fixture";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const GRADER_PATH = join(SRC, "shared_tracker_live_grader.ts");
const SHAPES = join(import.meta.dir, "fixtures", "live-shapes");

const EPIC = "GK-85";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const VERSION = "1.2.0";
const CLOUD = "example.invalid";
const TITLE = "BE payout export";
const EPIC_TITLE = "BE Payouts";
const MADE = "GK-150";

type Obj = Record<string, unknown>;
type Spelling = "direct" | "executeWrite" | "executeRead";
const jira = (tool: string): string => `mcp__atlassian__${tool}`;
const wrap = (name: string, inputs: Obj, extra: Obj = {}): Obj => ({ name, inputs, cloudId: CLOUD, ...extra });
const spelled = (how: Spelling, op: string, inputs: Obj): [string, Obj] => (how === "direct" ? [jira(op), { cloudId: CLOUD, ...inputs }] : [jira(how), wrap(op, inputs)]);
const v2 = (answer: unknown): Obj => ({ data: answer });

/** The recorded in-band error; `status` undefined omits it. `over` adds keys beside `error`. */
const ERROR_NAME = "EXAMPLE_VALIDATION_ERROR";
const inBand = (status: unknown, over: Obj = {}): Obj =>
  v2({
    error: ERROR_NAME,
    message: "Example refusal",
    problems: [{ field: "parent", reason: "example reason" }],
    repairHint: "Example hint",
    ...(status === undefined ? {} : { status }),
    upstreamErrors: { errorMessages: ["Example refusal"], errors: { parent: "example reason" } },
    ...over,
  });

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-867-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupFixtureTemps();
});

// ------------------------------------------------------------------- worlds

interface World {
  be: string;
  planFile: string;
  scratch: string;
}

/** The STE-699 world: BE planned and shipped M_GK_85; FE shipped it too. */
function makeWorld(): World {
  const parent = tempDir("world");
  const be = join(parent, BE_TAG);
  const fe = join(parent, FE_TAG);
  for (const [root, tag] of [[be, BE_TAG], [fe, FE_TAG]] as const) {
    mkdirSync(root, { recursive: true });
    declareJira(root, tag);
  }
  const planFile = writePlan(be, "archive", MILESTONE, { [BE_TAG]: ".", [FE_TAG]: `../${FE_TAG}` }, { shippedIn: `v${VERSION}` });
  writeFileSync(planFile, readFileSync(planFile, "utf-8").replace(/^# .*$/m, `## ${MILESTONE} — Rewards`));
  writeFr(be, "GK-111", MILESTONE, "archived");
  writeFileSync(join(be, "CHANGELOG.md"), ["# Changelog", "", `## [${VERSION}] — 2026-11-01 — "Close Out"`, "", "### Fixed", "", "- The milestone shipped.", ""].join("\n"));
  writePlan(fe, "archive", MILESTONE, { [BE_TAG]: `../${BE_TAG}`, [FE_TAG]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, "GK-101", MILESTONE, "archived");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  return { be, planFile, scratch: tempDir("scratch") };
}

/** One Jira row with every field a toolkit reader asks for (the v2 full view's nesting). */
const row = (key: string, over: Obj = {}): Obj => ({
  id: `10${key.split("-")[1]}`,
  key,
  fields: {
    summary: `Ticket ${key}`,
    labels: [BE_TAG],
    description: "Filed for the fixture.",
    creator: { displayName: "Fixture Author" },
    issuetype: { id: "10002", name: "Task", hierarchyLevel: 0, subtask: false, description: "" },
    project: { id: "10000", key: "GK", name: "Example project", projectTypeKey: "software", simplified: false },
    status: { id: "10001", name: "To Do", description: "", statusCategory: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" } },
    ...over,
  },
});
const DONE = { id: "10003", name: "Done", description: "", statusCategory: { id: 3, key: "done", name: "Done", colorName: "green" } };
const EPIC_TYPE = { id: "10004", name: "Epic", hierarchyLevel: 1, subtask: false, description: "" };
const page = (issues: Obj[], next?: string): Obj => ({ isLast: next === undefined, issues, ...(next === undefined ? {} : { nextPageToken: next }) });

let seq = 0;
function save(content: unknown): string {
  seq += 1;
  const p = join(w.scratch, `answer-${seq}.json`);
  writeFileSync(p, JSON.stringify(content));
  return p;
}

let w: World;
let tw: TicketWorld;
beforeAll(() => {
  w = makeWorld();
  tw = makeTicketWorld();
});

// ------------------------------------------------------------------ verdicts

function expectPermit(r: Run): void {
  expect(permitProblem(r), show(r)).toBeNull();
}
function expectRefusal(r: Run, ...needles: string[]): void {
  expect(refusalProblem(r), show(r)).toBeNull();
  for (const n of needles) expect(r.stderr).toContain(n);
}

// ===========================================================================
// AC-STE-867.1 — one `data` level, and nothing beside or under it
// ===========================================================================

const ITEM: Obj = { id: "10101", key: "GK-101", appliedContentFormat: "markdown", fields: { summary: "One" } };
const ROWS: Obj[] = [row("GK-101"), row("GK-102")];
const PROJECTS: Obj = { startAt: 0, maxResults: 50, total: 1, isLast: true, values: [{ id: "10000", key: "GK", name: "Example project" }] };
const TYPES: Obj = { startAt: 0, maxResults: 50, total: 1, issueTypes: [{ id: "10002", name: "Task" }] };

type Read = { ok: boolean; reason?: string };
/** Every Jira reader, with a v2 answer it accepts. */
const READERS: Array<[string, Obj, (a: unknown) => Read]> = [
  ["readTrackerPage", page(ROWS), (a) => readTrackerPage("jira", a)],
  ["readTrackerListing", page(ROWS), (a) => readTrackerListing("jira", [a])],
  ["readTrackerItem", ITEM, (a) => readTrackerItem("jira", a)],
  ["readCompleteList getVisibleJiraProjects", PROJECTS, (a) => readCompleteList("jira:getVisibleJiraProjects", a)],
  ["readCompleteList getJiraProjectIssueTypesMetadata", TYPES, (a) => readCompleteList("jira:getJiraProjectIssueTypesMetadata", a)],
];

describe("AC-STE-867.1 — {data: <page>} and {data: <item>} are read", () => {
  test("a last page", () => {
    expect(readTrackerPage("jira", v2({ appliedContentFormat: "markdown", ...page(ROWS) }))).toEqual({ ok: true, page: { items: ROWS, last: true, next: null } });
  });
  test("a page with more to come hands its nextPageToken", () => {
    expect(readTrackerPage("jira", v2(page(ROWS, "tok-2")))).toEqual({ ok: true, page: { items: ROWS, last: false, next: "tok-2" } });
  });
  test("an executeRead page, whose rows are {key, fields}", () => {
    const rows = [{ key: "GK-101", fields: { summary: "One" } }];
    expect(readTrackerPage("jira", v2({ isLast: true, issues: rows }))).toEqual({ ok: true, page: { items: rows, last: true, next: null } });
  });
  test("an item is the object under data", () => {
    expect(readTrackerItem("jira", v2(ITEM))).toEqual({ ok: true, item: ITEM });
  });
  test("a one-page listing", () => {
    expect(readTrackerListing("jira", [v2(page(ROWS))])).toEqual({ ok: true, items: ROWS, last: true });
  });
  test("a project list", () => {
    expect(readCompleteList("jira:getVisibleJiraProjects", v2(PROJECTS))).toEqual({ ok: true, items: PROJECTS.values as Obj[], complete: true });
  });
  test("an issue-type list", () => {
    expect(readCompleteList("jira:getJiraProjectIssueTypesMetadata", v2(TYPES))).toEqual({ ok: true, items: TYPES.issueTypes as Obj[], complete: true });
  });
  test("the answer is not mutated", () => {
    const a = v2(page(ROWS, "tok-2"));
    const before = JSON.stringify(a);
    expect(readTrackerPage("jira", a).ok).toBe(true);
    expect(JSON.stringify(a)).toBe(before);
  });
  test("the page rules hold inside data: isLast false with no token is refused", () => {
    expect(readTrackerPage("jira", v2({ isLast: false, issues: ROWS })).ok).toBe(false);
  });
  test("the page rules hold inside data: no isLast is refused", () => {
    expect(readTrackerPage("jira", v2({ issues: ROWS })).ok).toBe(false);
  });
});

describe("AC-STE-867.1 — every other envelope fails closed", () => {
  for (const [name, good, read] of READERS) {
    const bad: Array<[string, unknown]> = [
      ["an unknown key beside data", { data: good, meta: {} }],
      ["a v1 wrapped key beside data", { data: good, context: {} }],
      ["a plain answer beside data", { ...good, data: good }],
      ["a key beside an empty data", { ...good, data: {} }],
      ["a key beside a null data", { ...good, data: null }],
      ["an array under data", { data: [good] }],
      ["a string under data", { data: JSON.stringify(good) }],
      ["a null under data", { data: null }],
      ["a number under data", { data: 7 }],
      ["an empty data", { data: {} }],
      ["a nested data", { data: { data: good } }],
      ["a nested data beside the answer's keys", { data: { ...good, data: {} } }],
    ];
    test(`CONTROL — ${name} reads the good answer bare`, () => {
      expect(read(good).ok).toBe(true);
    });
    for (const [title, a] of bad) {
      test(`${name}: ${title}`, () => {
        expect(read(a).ok).toBe(false);
      });
    }
  }
});

describe("AC-STE-867.1 — a saved v2 chain, its requestCursor recorded by the toolkit", () => {
  const first = v2(page([ROWS[0]!], "tok-2"));
  const second = (over: Obj = {}): Obj => ({ ...v2(page([ROWS[1]!])), requestCursor: "tok-2", ...over });
  test("chains", () => {
    expect(readTrackerListing("jira", [first, second()])).toEqual({ ok: true, items: ROWS, last: true });
  });
  test("a v1 page chains onto a v2 page", () => {
    expect(readTrackerListing("jira", [first, { ...page([ROWS[1]!]), requestCursor: "tok-2" }])).toEqual({ ok: true, items: ROWS, last: true });
  });
  test("REFUSE — another key beside data on the second page", () => {
    expect(readTrackerListing("jira", [first, second({ context: {} })]).ok).toBe(false);
  });
  test("REFUSE — no requestCursor, naming it", () => {
    const r = readTrackerListing("jira", [first, v2(page([ROWS[1]!]))]);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("requestCursor") });
  });
  test("REFUSE — a requestCursor that is not the page before's token, naming it", () => {
    const r = readTrackerListing("jira", [first, second({ requestCursor: "tok-9" })]);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("tok-9") });
  });
  test("REFUSE — requestCursor beside an item", () => {
    expect(readTrackerItem("jira", { ...v2(ITEM), requestCursor: "tok-2" }).ok).toBe(false);
  });
});

describe("AC-STE-867.1 — only a Jira answer is unwrapped", () => {
  test("CONTROL — the Linear answers read bare", () => {
    expect(readTrackerPage("linear", { issues: [{ id: "ZZT-1" }], hasNextPage: false }).ok).toBe(true);
    expect(readTrackerItem("linear", { id: "ZZT-1" }).ok).toBe(true);
  });
  test("a Linear page under data is refused", () => {
    expect(readTrackerPage("linear", v2({ issues: [{ id: "ZZT-1" }], hasNextPage: false })).ok).toBe(false);
  });
  test("a Linear item under data is refused", () => {
    expect(readTrackerItem("linear", v2({ id: "ZZT-1" })).ok).toBe(false);
  });
  test("a Linear status list under data is refused", () => {
    expect(readCompleteList("linear:list_issue_statuses", v2([{ id: "s1", name: "Todo" }])).ok).toBe(false);
  });
});

// ===========================================================================
// AC-STE-867.2 — {data: {error}} is a named error
// ===========================================================================

describe("AC-STE-867.2 — an in-band error is a named error to every reader", () => {
  for (const [name, good, read] of READERS) {
    for (const [title, a] of [
      ["the recorded error", inBand(400)],
      ["the error alone", v2({ error: ERROR_NAME })],
      ["the error beside a whole good answer", inBand(400, good)],
      ["the error beside a key, issues and values", inBand(400, { key: "GK-101", id: "10101", issues: [], isLast: true, values: [], issueTypes: [], total: 0, startAt: 0 })],
    ] as Array<[string, Obj]>) {
      test(`${name}: ${title}`, () => {
        const r = read(a);
        expect(r.ok).toBe(false);
        expect(r.reason).toContain(ERROR_NAME);
      });
    }
    for (const [title, error] of [["empty", ""], ["null", null], ["false", false], ["object", { code: 1 }]] as Array<[string, unknown]>) {
      test(`${name}: an ${title} error beside a good answer is still the error`, () => {
        const r = read(v2({ ...good, error }));
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/error/i);
      });
    }
  }
  test("an error on a later page fails the whole listing, named", () => {
    const r = readTrackerListing("jira", [v2(page([ROWS[0]!], "tok-2")), { ...inBand(400, page([])), requestCursor: "tok-2" }]);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining(ERROR_NAME) });
  });
  test("the CLI names it and exits 1", () => {
    const r = runModule(PLUGIN_ROOT, "tracker_answer.ts", ["page", "jira", save(inBand(400, page([])))]);
    expect(r.exitCode, show(r)).toBe(1);
    expect(r.stderr).toContain(ERROR_NAME);
  });
});

// ===========================================================================
// AC-STE-867.3 — the gate on v2 create answers
// ===========================================================================

const TICKET_V2: Obj = { projectKey: "GK", issueType: "Task", summary: TITLE, parent: EPIC, labels: [BE_TAG] };
const EPIC_V2: Obj = { projectKey: "GK", issueType: "Epic", summary: EPIC_TITLE, labels: [BE_TAG] };
const CREATED = v2({ id: "10150", key: MADE });

/** Write one receipt of this session in `root` and record the deciding run that announced it. */
function announce(t: Transcript, root: string, module: string, args: string, input: ReceiptInput): void {
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  let path: string;
  try {
    path = writeReceipt(root, input);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = prev;
  }
  t.bash(`bun run "${join(SRC, module)}" ${args}`, announceReceipt(path));
}

/** A ticket create decided (`create` + `attach-target` receipts) under GK-85. */
function ticketDecided(): Transcript {
  const t = new Transcript();
  announce(t, w.be, "create_idempotency_probe.ts", `decide "${w.be}" /tmp/page.json --title "${TITLE}" --parent ${EPIC} --attempt fast`, {
    kind: "create",
    adapter: "jira",
    container: EPIC,
    subject: TITLE,
    decision: "create",
    evidence: { createPayload: { project: "GK", summary: TITLE, labels: [BE_TAG], parent: EPIC } },
  });
  announce(t, w.be, "attach_project_milestone.ts", `${w.be} jira GK ${w.be}/specs/plan/archive/${MILESTONE}.md /tmp/listing.json`, {
    kind: "attach-target",
    adapter: "jira",
    container: "GK",
    subject: MILESTONE,
    decision: "parent",
    evidence: { surface: "parent", key: EPIC, planFile: `specs/plan/archive/${MILESTONE}.md`, provenance: { kind: "not-applicable" } },
  });
  return t;
}

const RELIST_INPUT: Obj = { jql: "project = GK AND issuetype = Epic", fields: ["summary", "status", "issuetype", "project", "labels"], maxResults: 100 };
/** The Epic decision by the REAL front door on an empty listing (no re-list yet). */
function epicDecision(): Transcript {
  const listing = save({ issues: [], isLast: true });
  const run = runModule(PLUGIN_ROOT, "resolve_milestone_identity.ts", [w.be, "jira", "GK", listing, "--title", EPIC_TITLE]);
  if (run.exitCode !== 0) throw new Error(`fixture: the decision did not run:\n${show(run)}`);
  const t = new Transcript();
  t.bash(`bun run "${join(SRC, "resolve_milestone_identity.ts")}" ${w.be} jira GK ${listing} --title "${EPIC_TITLE}"`, run.stdout.trimEnd());
  return t;
}
function relist(t: Transcript, how: Spelling, answer: unknown, extra: Obj = {}): Transcript {
  const [tool, input] = spelled(how, "searchJiraIssuesUsingJql", { ...RELIST_INPUT, ...extra });
  t.tool(tool, input, answer);
  return t;
}
const epicDecided = (): Transcript => relist(epicDecision(), "direct", { issues: [], isLast: true });

let driveSeq = 0;
/** The gate on a lone call, whose own line and id are absent from the transcript. */
async function drive(tool: string, input: Obj, t: Transcript): Promise<Run> {
  driveSeq += 1;
  const path = join(neutralCwd(), `transcript-867-${process.pid}-${driveSeq}.jsonl`);
  writeFileSync(path, `${t.lines.join("\n")}\n`);
  const payload = JSON.stringify({ session_id: SESSION, transcript_path: path, cwd: w.be, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input });
  const sh = shRootFor(PLUGIN_ROOT);
  const proc = Bun.spawn(["bash", join(sh, "templates", "hooks", "process", "pre-tracker-write-gate.sh")], { cwd: neutralCwd(), env: childEnv(sh), stdin: new Response(payload).body, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

const PAIRS: Array<[Spelling, Spelling]> = [["direct", "direct"], ["executeWrite", "direct"], ["direct", "executeWrite"], ["executeWrite", "executeWrite"]];
const call = (how: Spelling, op: string, inputs: Obj, t: Transcript): Promise<Run> => {
  const [tool, input] = spelled(how, op, inputs);
  return gate(PLUGIN_ROOT, tool, input, t, w.be);
};
/** `t` after a first create of `op` that answered `answer`. */
function tried(t: Transcript, how: Spelling, op: Obj, answer: unknown, isError = false): Transcript {
  const [tool, input] = spelled(how, "createJiraIssue", op);
  t.tool(tool, input, answer, isError);
  return t;
}

describe("AC-STE-867.3 — {data: {id, key}} is a settled create of that key", () => {
  for (const [first, again] of PAIRS) {
    test(`ticket, ${first} then ${again}`, async () => {
      expectRefusal(await call(again, "createJiraIssue", TICKET_V2, tried(ticketDecided(), first, TICKET_V2, CREATED)), MADE, "returned");
    });
    test(`Epic, ${first} then ${again}`, async () => {
      expectRefusal(await call(again, "createJiraIssue", EPIC_V2, tried(epicDecided(), first, EPIC_V2, CREATED)), MADE);
    });
    test(`the created ticket is owned: ${first} create, ${again} edit`, async () => {
      expectPermit(await call(again, "editJiraIssue", { issueIdOrKey: MADE, fields: { summary: "S" } }, tried(ticketDecided(), first, TICKET_V2, CREATED)));
    });
  }
  test("TWIN — another key is not owned", async () => {
    expectRefusal(await call("direct", "editJiraIssue", { issueIdOrKey: "GK-151", fields: { summary: "S" } }, tried(ticketDecided(), "direct", TICKET_V2, CREATED)), "GK-151");
  });
  test("a key beside data settles nothing: the create may have made its ticket", async () => {
    const r = await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, { data: { id: "10150" }, key: MADE }));
    expectRefusal(r, "may have made the ticket");
    expect(r.stderr).not.toContain(`returned ${MADE}`);
  });
});

const NEVER_LANDED = [400, 401, 403, 404, 409, 422, 429];
const MAY_HAVE: Array<[string, unknown]> = [
  ["408", 408], ["500", 500], ["502", 502], ["503", 503], ["504", 504], ["missing", undefined], ["the string \"400\"", "400"],
  ["null", null], ["true", true], ["a list", [400]], ["200", 200], ["302", 302], ["40", 40], ["4000", 4000],
];

describe("AC-STE-867.3 — an in-band error on a create", () => {
  for (const status of NEVER_LANDED) {
    test(`status ${status}: never landed, the retry is permitted`, async () => {
      expectPermit(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(status))));
    });
  }
  for (const [title, status] of MAY_HAVE) {
    test(`status ${title}: the create may have made its ticket`, async () => {
      expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(status))), "may have made the ticket");
    });
  }
  for (const [first, again] of PAIRS.slice(1)) {
    test(`status 400, ${first} then ${again}: permitted`, async () => {
      expectPermit(await call(again, "createJiraIssue", TICKET_V2, tried(ticketDecided(), first, TICKET_V2, inBand(400))));
    });
    test(`status 500, ${first} then ${again}: may have made its ticket`, async () => {
      expectRefusal(await call(again, "createJiraIssue", TICKET_V2, tried(ticketDecided(), first, TICKET_V2, inBand(500))), "may have made the ticket");
    });
  }
  for (const how of ["direct", "executeWrite"] as const) {
    test(`status 400 on a ${how} Epic create: the retry is permitted`, async () => {
      expectPermit(await call(how, "createJiraIssue", EPIC_V2, tried(epicDecided(), how, EPIC_V2, inBand(400))));
    });
    test(`status 503 on a ${how} Epic create: the retry is refused`, async () => {
      expectRefusal(await call(how, "createJiraIssue", EPIC_V2, tried(epicDecided(), how, EPIC_V2, inBand(503))));
    });
    test(`status 400, ${how}: the receipt is unspent for a lone retry`, async () => {
      const [tool, input] = spelled(how, "createJiraIssue", TICKET_V2);
      expectPermit(await drive(tool, input, tried(ticketDecided(), how, TICKET_V2, inBand(400))));
    });
    test(`status 500, ${how}: a lone retry is refused`, async () => {
      const [tool, input] = spelled(how, "createJiraIssue", TICKET_V2);
      expectRefusal(await drive(tool, input, tried(ticketDecided(), how, TICKET_V2, inBand(500))));
    });
  }
  // Review r1 (F3) — the words that make an error result ambiguous do so in band too.
  for (const words of [{ message: "gateway timed out" }, { error: "request interrupted" }, { message: "upstream answered 504" }]) {
    test(`status 400 saying ${JSON.stringify(words)}: the create may have made its ticket`, async () => {
      expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, words))), "may have made the ticket");
    });
  }
  // Review r2 — the words count wherever the error object holds them.
  const ELSEWHERE: Array<[string, Obj]> = [
    ["upstreamErrors.errorMessages", { upstreamErrors: { errorMessages: ["Gateway timed out"], errors: {} } }],
    ["upstreamErrors.errors", { upstreamErrors: { errorMessages: [], errors: { parent: "the request was aborted" } } }],
    ["problems", { problems: [{ field: "parent", reason: "upstream timed out" }] }],
    ["repairHint", { repairHint: "the connection was reset; check before retrying" }],
    ["an object error", { error: { code: "X", detail: "upstream timed out" } }],
    ["a nested numeric status", { upstreamErrors: { status: 504 } }],
    ["a numeric status in an error object", { error: { status: 503 } }],
    ["a boolean timedOut", { upstreamErrors: { timedOut: true } }],
    ["a key named timeout", { upstreamErrors: { errorMessages: [], errors: { timeout: "x" } } }],
  ];
  for (const [where, over] of ELSEWHERE) {
    test(`status 400 saying it timed out in ${where}: the create may have made its ticket`, async () => {
      expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, over))), "may have made the ticket");
    });
  }
  // Review r3 — the words count after a line break or a tab too, at any depth of escaping.
  for (const message of ["Upstream said:\n503 Service Unavailable", "request timed\nout", "gateway\t502", JSON.stringify({ said: "Upstream:\r\n503" })]) {
    test(`status 400 saying ${JSON.stringify(message)}: the create may have made its ticket`, async () => {
      expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, { message }))), "may have made the ticket");
    });
  }
  test("CONTROL — a line break alone adds no doubt: status 400 never landed", async () => {
    expectPermit(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, { message: "Bad\nrequest" }))));
  });
  // Review r2 — an in-band error in any text block is an error.
  const NOTICE = "Notice: this server will be upgraded.";
  const twoBlocks = (t: Transcript, how: Spelling, over: Obj, order: "error first" | "notice first"): Transcript => {
    const [tool, input] = spelled(how, "createJiraIssue", TICKET_V2);
    const id = t.use(tool, input);
    const blocks = [{ type: "text", text: JSON.stringify(inBand(400, over)) }, { type: "text", text: NOTICE }];
    t.result(id, order === "error first" ? blocks : blocks.reverse());
    return t;
  };
  for (const how of ["direct", "executeWrite"] as const) {
    for (const order of ["error first", "notice first"] as const) {
      test(`${how}, two text blocks, ${order}: status 400 never landed, and the key its message names was not created`, async () => {
        const over = { message: "parent GK-9001 is not valid" };
        expectPermit(await call("direct", "createJiraIssue", TICKET_V2, twoBlocks(ticketDecided(), how, over, order)));
        const edit = { cloudId: CLOUD, issueIdOrKey: "GK-9001", fields: { summary: "x" } };
        expectRefusal(await gate(PLUGIN_ROOT, jira("editJiraIssue"), edit, twoBlocks(ticketDecided(), how, over, order), w.be), "GK-9001");
      });
    }
  }
  for (const [title, content] of [
    ["pretty-printed, then a notice", `${JSON.stringify(inBand(400, { message: "parent GK-9001 is not valid" }), null, 2)}\n${NOTICE}`],
    ["after an unbalanced brace", `Notice { ${JSON.stringify(inBand(400, { message: "parent GK-9001 is not valid" }))}`],
    ["after a notice on the same line", `${NOTICE} ${JSON.stringify(inBand(400, { message: "parent GK-9001 is not valid" }))}`],
    ["with a key beside data, then a notice", [{ type: "text", text: JSON.stringify({ ...inBand(400, { message: "parent GK-9001 is not valid" }), meta: {} }) }, { type: "text", text: NOTICE }]],
  ] as Array<[string, unknown]>) {
    test(`an error ${title}: the key it names is not created here`, async () => {
      const t = ticketDecided();
      t.result(t.use(jira("createJiraIssue"), TICKET_V2), content);
      const edit = { cloudId: CLOUD, issueIdOrKey: "GK-9001", fields: { summary: "x" } };
      expectRefusal(await gate(PLUGIN_ROOT, jira("editJiraIssue"), edit, t, w.be), "GK-9001");
    });
  }
  test("pretty-printed, then a notice: status 400 never landed", async () => {
    const t = ticketDecided();
    t.result(t.use(jira("createJiraIssue"), TICKET_V2), `${JSON.stringify(inBand(400), null, 2)}\n${NOTICE}`);
    expectPermit(await call("direct", "createJiraIssue", TICKET_V2, t));
  });
  test("a key beside data proves nothing: the create may have made its ticket", async () => {
    const t = ticketDecided();
    t.result(t.use(jira("createJiraIssue"), TICKET_V2), JSON.stringify({ ...inBand(400), meta: {} }));
    expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, t), "may have made the ticket");
  });
  test("a hostile result is scanned in linear time: the hook answers well inside its 5 s bound", async () => {
    for (const body of [`"error" ${"{a".repeat(60_000)}${"}".repeat(60_000)}`, `"error" ${"{a}".repeat(80_000)}`, `"error" ${"{".repeat(200_000)}`]) {
      const t = ticketDecided();
      t.result(t.use(jira("createJiraIssue"), TICKET_V2), body);
      const at = Date.now();
      await call("direct", "createJiraIssue", TICKET_V2, t);
      expect(Date.now() - at).toBeLessThan(3_000);
    }
  });
  test("two errors of different statuses prove nothing", async () => {
    const t = ticketDecided();
    t.result(t.use(jira("createJiraIssue"), TICKET_V2), [{ type: "text", text: JSON.stringify(inBand(400)) }, { type: "text", text: JSON.stringify(inBand(409)) }]);
    expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, t), "may have made the ticket");
  });
  test("one block holding the error and then a notice line is an error too", async () => {
    const t = ticketDecided();
    const id = t.use(jira("createJiraIssue"), TICKET_V2);
    t.result(id, `${JSON.stringify(inBand(400, { message: "parent GK-9001 is not valid" }))}\n${NOTICE}`);
    const edit = { cloudId: CLOUD, issueIdOrKey: "GK-9001", fields: { summary: "x" } };
    expectRefusal(await gate(PLUGIN_ROOT, jira("editJiraIssue"), edit, t, w.be), "GK-9001");
  });
  // The recorded flagged form: {error: boolean, message, statusCode}, with is_error.
  for (const [title, answer, landed] of [
    ["statusCode 400", { error: true, message: "bad request", statusCode: 400 }, false],
    ["statusCode 408", { error: true, message: "x", statusCode: 408 }, true],
    ["statusCode 503", { error: true, message: "x", statusCode: 503 }, true],
    ["statusCode 400 whose message says it timed out", { error: true, message: "upstream timed out", statusCode: 400 }, true],
    ["no statusCode", { error: true, message: "bad request" }, true],
    ["statusCode 400 beside a created key", { error: true, message: "x", statusCode: 400, key: MADE }, true],
    ["statusCode 400 beside a created id", { error: true, message: "status 400", statusCode: 400, id: 10150 }, true],
    ["statusCode 400 beside an unrecorded key", { error: true, message: "x", statusCode: 400, issue: { key: MADE } }, true],
    ["statusCode 400 under an error: false", { error: false, message: "bad request", statusCode: 400 }, false],
    ["statusCode 400 whose message breaks a line before 503", { error: true, message: "Upstream said:\n503 Service Unavailable", statusCode: 400 }, true],
    ["statusCode 400 whose message holds escaped JSON with a break before 503", { error: true, message: JSON.stringify({ said: "Upstream:\n503" }), statusCode: 400 }, true],
    ["statusCode 400 whose message breaks a line after a plain word", { error: true, message: "Bad\nrequest", statusCode: 400 }, false],
  ] as Array<[string, Obj, boolean]>) {
    test(`a flagged error, ${title}: ${landed ? "may have made its ticket" : "never landed"}`, async () => {
      const r = await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, answer, true));
      if (landed) expectRefusal(r, "may have made the ticket");
      else expectPermit(r);
    });
  }
  test("the readers refuse the flagged form", () => {
    const a = { error: true, message: "bad request", statusCode: 400 };
    expect([readTrackerPage("jira", a).ok, readTrackerItem("jira", a).ok, readCompleteList("jira:getVisibleJiraProjects", a).ok]).toEqual([false, false, false]);
  });
  test("with the error flag set too, status 400 still never landed", async () => {
    expectPermit(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400), true)));
  });
  test("with the error flag set too, status 500 may have made its ticket", async () => {
    expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(500), true)), "may have made the ticket");
  });
  test("a 4xx only in the message proves nothing: no status", async () => {
    expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(undefined, { message: "status 400 Bad Request" }))), "may have made the ticket");
  });
  test("a 4xx only in the message proves nothing: status 500", async () => {
    expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(500, { message: "Error: status 400 Bad Request" }))), "may have made the ticket");
  });
  test("a status outside an in-band error proves nothing: no error key", async () => {
    expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, v2({ status: 400, message: "Example" }))), "may have made the ticket");
  });
  for (const extra of [{ key: MADE }, { id: "10150" }, { id: 10150 }, { id: "10150", key: MADE, error: null }]) {
    test(`status 400 beside ${JSON.stringify(extra)}: the create may have made its ticket`, async () => {
      expectRefusal(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, extra))), "may have made the ticket");
    });
  }
  test("CONTROL — an empty key or id names nothing: status 400 stays never landed", async () => {
    expectPermit(await call("direct", "createJiraIssue", TICKET_V2, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, { key: "", id: null }))));
  });
  test("a key beside the error is not owned", async () => {
    expectRefusal(await call("direct", "editJiraIssue", { issueIdOrKey: MADE, fields: { summary: "S" } }, tried(ticketDecided(), "direct", TICKET_V2, inBand(400, { id: "10150", key: MADE }))), MADE);
  });
});

describe("AC-STE-867.3 — the Epic re-list reads v2 answers, direct or through executeRead", () => {
  const create = (t: Transcript): Promise<Run> => call("direct", "createJiraIssue", EPIC_V2, t);
  const openTwin = row("GK-90", { summary: EPIC_TITLE, issuetype: EPIC_TYPE });
  test("CONTROL — no re-list is refused", async () => {
    expectRefusal(await create(epicDecision()));
  });
  for (const [title, input] of [
    ["a key beside inputs", wrap("searchJiraIssuesUsingJql", RELIST_INPUT, { jql: "project = GK" })],
    ["two cloudId values", wrap("searchJiraIssuesUsingJql", { ...RELIST_INPUT, cloudId: "other.example.invalid" })],
  ] as Array<[string, Obj]>) {
    test(`REFUSE — executeRead with ${title} is no re-list`, async () => {
      const t = epicDecision();
      t.tool(jira("executeRead"), input, v2(page([])));
      expectRefusal(await create(t));
    });
  }
  for (const how of ["direct", "executeRead"] as const) {
    test(`PERMIT — ${how}: an empty last page`, async () => {
      expectPermit(await create(relist(epicDecision(), how, v2(page([])))));
    });
    test(`REFUSE — ${how}: the open same-title Epic, named`, async () => {
      expectRefusal(await create(relist(epicDecision(), how, v2(page([openTwin])))), "GK-90", "duplicate");
    });
    test(`PERMIT — ${how}: the same-title Epic is done`, async () => {
      expectPermit(await create(relist(epicDecision(), how, v2(page([row("GK-90", { summary: EPIC_TITLE, issuetype: EPIC_TYPE, status: DONE })])))));
    });
    test(`REFUSE — ${how}: an in-band error beside an empty last page`, async () => {
      expectRefusal(await create(relist(epicDecision(), how, inBand(400, page([])))));
    });
    test(`REFUSE — ${how}: a first page only`, async () => {
      expectRefusal(await create(relist(epicDecision(), how, v2(page([], "tok-2")))));
    });
    test(`PERMIT — ${how}: two chained pages`, async () => {
      const t = relist(epicDecision(), how, v2(page([row("GK-91", { issuetype: EPIC_TYPE })], "tok-2")));
      expectPermit(await create(relist(t, how, v2(page([])), { nextPageToken: "tok-2" })));
    });
    test(`REFUSE — ${how}: the second page is an in-band error`, async () => {
      const t = relist(epicDecision(), how, v2(page([row("GK-91", { issuetype: EPIC_TYPE })], "tok-2")));
      expectRefusal(await create(relist(t, how, inBand(503, page([])), { nextPageToken: "tok-2" })));
    });
    test(`REFUSE — ${how}: a re-list older than the freshness window`, async () => {
      const t = relist(epicDecision(), how, v2(page([])));
      const last = JSON.parse(t.lines.pop()!) as Obj;
      t.lines.push(JSON.stringify({ ...last, timestamp: new Date(Date.now() - 300_000).toISOString() }));
      expectRefusal(await create(t));
    });
  }
  test("PERMIT — executeRead carrying a v1 page", async () => {
    expectPermit(await create(relist(epicDecision(), "executeRead", page([]))));
  });
  test("REFUSE — executeRead of a narrower JQL", async () => {
    expectRefusal(await create(relist(epicDecision(), "executeRead", v2(page([])), { jql: "project = GK AND issuetype = Epic AND labels = x" })));
  });
  test("REFUSE — executeRead naming another operation", async () => {
    const t = epicDecision();
    t.tool(jira("executeRead"), wrap("getJiraIssue", RELIST_INPUT), v2(page([])));
    expectRefusal(await create(t));
  });
});

// ===========================================================================
// AC-STE-867.4 — ticket provenance
// ===========================================================================

type TicketOver = { labels?: string[]; type?: "Task" | "Epic"; project?: string };
const ticket = (o: TicketOver = {}, key = TICKET): Obj => ({ ...jiraTicket(key, o), appliedContentFormat: "markdown" });
function fetched(t: Transcript, how: Spelling, answer: unknown, key = TICKET, isError = false): Transcript {
  const [tool, input] = spelled(how, "getJiraIssue", { issueIdOrKey: key });
  t.tool(tool, input, answer, isError);
  return t;
}
const editTicket = (t: Transcript): Promise<Run> => gate(PLUGIN_ROOT, jira("editJiraIssue"), { cloudId: CLOUD, issueIdOrKey: TICKET, fields: { summary: "Retitled" } }, t, tw.root);
const READS = ["direct", "executeRead"] as const;

/** Whether the refusal says `field` is missing. */
const namesMissing = (r: Run, field: string): boolean => new RegExp(`(missing|lacks?|absent)[^\\n]{0,200}\\b${field}\\b|\\b${field}\\b[^\\n]{0,120}(missing|absent)`, "i").test(r.stderr);

describe("AC-STE-867.4 — a v2 getJiraIssue answer gives provenance", () => {
  test("CONTROL — no fetch is refused, and names no missing field", async () => {
    const r = await editTicket(new Transcript());
    expectRefusal(r, TICKET);
    expect(["project", "labels", "creator", "issuetype", "summary", "description"].filter((f) => namesMissing(r, f))).toEqual([]);
  });
  for (const how of READS) {
    test(`PERMIT — ${how}: owned by tag`, async () => {
      expectPermit(await editTicket(fetched(new Transcript(), how, v2(ticket()))));
    });
    test(`PERMIT — ${how}: untagged, then adopted`, async () => {
      const t = fetched(new Transcript(), how, v2(ticket({ labels: [] })));
      askAdopt(t, TICKET, `Adopt ${TICKET}`);
      expectPermit(await editTicket(t));
    });
    test(`REFUSE — ${how}: untagged, not adopted`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, v2(ticket({ labels: [] })))));
    });
    test(`REFUSE — ${how}: the sibling's tag`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, v2(ticket({ labels: [SIBLING_TAG] })))));
    });
    test(`REFUSE — ${how}: an Epic`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, v2(ticket({ type: "Epic" })))));
    });
    test(`REFUSE — ${how}: another project`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, v2(ticket({ project: "OTHER" })))));
    });
    test(`REFUSE — ${how}: the answer reads as another key`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, v2(ticket({}, "PROJ-599")))));
    });
    test(`REFUSE — ${how}: the error flag on an owned answer`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, v2(ticket()), TICKET, true)));
    });
    test(`REFUSE — ${how}: an in-band error carrying a whole owned ticket`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, inBand(404, ticket()))));
    });
    test(`REFUSE — ${how}: a key beside data`, async () => {
      expectRefusal(await editTicket(fetched(new Transcript(), how, { ...v2(ticket()), context: {} })));
    });
    test(`REFUSE — ${how}: without key, naming it`, async () => {
      const a = ticket() as Obj;
      delete a.key;
      const r = await editTicket(fetched(new Transcript(), how, v2(a)));
      expectRefusal(r, TICKET);
      expect(namesMissing(r, "key"), r.stderr).toBe(true);
    });
    for (const field of ["project", "labels", "issuetype", "creator", "description"]) {
      test(`REFUSE — ${how}: without ${field}, naming it`, async () => {
        const a = ticket();
        delete (a.fields as Obj)[field];
        const r = await editTicket(fetched(new Transcript(), how, v2(a)));
        expectRefusal(r, TICKET);
        expect(namesMissing(r, field), r.stderr).toBe(true);
      });
    }
    test(`REFUSE — ${how}: without project and creator, naming both`, async () => {
      const a = ticket();
      delete (a.fields as Obj).project;
      delete (a.fields as Obj).creator;
      const r = await editTicket(fetched(new Transcript(), how, v2(a)));
      expectRefusal(r, TICKET);
      expect(["project", "creator"].filter((f) => namesMissing(r, f)), r.stderr).toEqual(["project", "creator"]);
    });
  }
  test("PERMIT — executeRead carrying a v1 answer", async () => {
    expectPermit(await editTicket(fetched(new Transcript(), "executeRead", ticket())));
  });
  test("PERMIT — executeRead with responseFields and view beside its inputs", async () => {
    const t = new Transcript();
    t.tool(jira("executeRead"), wrap("getJiraIssue", { issueIdOrKey: TICKET }, { view: "full", responseFields: ["key", "fields"] }), v2(ticket()));
    expectPermit(await editTicket(t));
  });
  test("REFUSE — executeRead naming another read", async () => {
    const t = new Transcript();
    t.tool(jira("executeRead"), wrap("searchJiraIssuesUsingJql", { issueIdOrKey: TICKET }), v2(ticket()));
    expectRefusal(await editTicket(t));
  });
  test("REFUSE — the key beside inputs is not the fetched key", async () => {
    const t = new Transcript();
    t.tool(jira("executeRead"), wrap("getJiraIssue", { issueIdOrKey: "PROJ-599" }, { issueIdOrKey: TICKET }), v2(ticket()));
    expectRefusal(await editTicket(t));
  });

  test("REFUSE — an executeRead fetch naming two cloudId values proves nothing, and supersedes an older owned fetch", async () => {
    const twoSites = wrap("getJiraIssue", { issueIdOrKey: TICKET, cloudId: "other.example.invalid" });
    const alone = new Transcript();
    alone.tool(jira("executeRead"), twoSites, v2(ticket()));
    expectRefusal(await editTicket(alone));
    const t = fetched(new Transcript(), "direct", ticket());
    t.tool(jira("executeRead"), twoSites, v2(ticket({ labels: [SIBLING_TAG] })));
    expectRefusal(await editTicket(t));
  });

  describe("the newest fetch governs, however it is spelled", () => {
    for (const [older, newer] of [["direct", "executeRead"], ["executeRead", "direct"], ["direct", "direct"], ["executeRead", "executeRead"]] as const) {
      test(`REFUSE — ${older} owned (v1), then ${newer} foreign (v2)`, async () => {
        const t = fetched(new Transcript(), older, ticket());
        expectRefusal(await editTicket(fetched(t, newer, v2(ticket({ labels: [SIBLING_TAG] })))));
      });
      test(`PERMIT — ${older} foreign (v1), then ${newer} owned (v2)`, async () => {
        const t = fetched(new Transcript(), older, ticket({ labels: [SIBLING_TAG] }));
        expectPermit(await editTicket(fetched(t, newer, v2(ticket({ labels: [TAG] })))));
      });
    }
  });
});

// ------------------------------------------------------------ the live grader

interface Finding {
  code: string;
  detail?: string;
}
interface Verdict {
  outcome: string;
  findings: Finding[];
  scenarios: Record<string, unknown>;
}
interface GraderModule {
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => Verdict;
  extractBundle: (o: unknown) => { ok: true; bundle: LiveBundle } | { ok: false; verdict: unknown };
}
const grader = async (): Promise<GraderModule> => (await import(GRADER_PATH)) as GraderModule;
const grade = async (b: LiveBundle): Promise<Verdict> => (await grader()).gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
const ungated = (v: Verdict, c: ToolCall): boolean => v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${c.ref}:`));

/** The bundle read back from the transcripts a run would leave; `rewrite` edits each tracker tool_use / tool_result pair first. */
async function extracted(bundle: LiveBundle, rewrite?: (use: { name: string; input: Obj }, text: string) => string): Promise<LiveBundle> {
  const m = materialize(bundle, tempDir("records"));
  if (rewrite) {
    for (const f of readdirSync(m.configDir, { recursive: true, encoding: "utf-8" }).filter((n) => n.endsWith(".jsonl"))) {
      const path = join(m.configDir, f);
      type Block = { type: string; id?: string; tool_use_id?: string; name: string; input: Obj; content?: unknown };
      const recs = readFileSync(path, "utf-8").trimEnd().split("\n").map((l) => JSON.parse(l) as { message?: { content?: unknown } });
      const blocks = recs.flatMap((r) => (Array.isArray(r.message?.content) ? (r.message.content as Block[]) : []));
      for (const u of blocks.filter((b) => b.type === "tool_use" && b.name.startsWith("mcp__"))) {
        const res = blocks.find((b) => b.type === "tool_result" && b.tool_use_id === u.id);
        if (res && Array.isArray(res.content)) for (const c of res.content as Array<{ type: string; text: string }>) c.text = rewrite(u, c.text);
      }
      writeFileSync(path, `${recs.map((r) => JSON.stringify(r)).join("\n")}\n`);
    }
  }
  const x = (await grader()).extractBundle({
    configDirs: [m.configDir],
    ledgerSessionIds: m.ledger,
    roots: { A: { path: m.roots.A, tag: bundle.roots.A.tag }, B: { path: m.roots.B, tag: bundle.roots.B.tag } },
    run: m.run,
    synthetic: true,
  });
  if (!x.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(x.verdict)}`);
  return x.bundle;
}
/** A raw answer as a transcript records it: JSON text, no error flag. */
const raw = (answer: unknown, isError = false): ToolResult => ({ isError, text: JSON.stringify(answer), exitCode: null, items: null, lastPage: null });
let callSeq = 0;
const toolCall = (s: BundleSession, name: string, input: Obj, result: ToolResult, at: string): ToolCall => ({
  ref: `${s.sessionId}:toolu_867_${++callSeq}`,
  at,
  name: serverPrefix("jira", s.root) + name,
  input,
  result,
  sidechain: false,
});
function append(s: BundleSession, name: string, input: Obj, result: ToolResult): ToolCall {
  const c = toolCall(s, name, input, result, new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString());
  s.calls.push(c);
  return c;
}
function marked(b: LiveBundle, marker: string, root?: "A" | "B"): BundleSession {
  const s = b.sessions.find((x) => x.marker === marker && (root === undefined || x.root === root));
  if (!s) throw new Error(`fixture: no ${marker} session`);
  return s;
}

describe("AC-STE-867.3 / .4 — the grader reads v2 answers as it reads v1 answers", () => {
  const items = (b: LiveBundle): unknown[] => b.sessions.flatMap((s) => s.calls.filter((c) => c.name.startsWith("mcp__")).map((c) => ({ ref: c.ref, items: c.result.items, lastPage: c.result.lastPage })));
  /** The answer in the v2 envelope when it holds an item or a page. */
  const enveloped = (text: string): string => {
    const a = JSON.parse(text) as Obj;
    return a.key === undefined && a.issues === undefined ? text : JSON.stringify(v2(a));
  };
  const wrapRead = (u: { name: string; input: Obj }): void => {
    const tool = u.name.split("__").at(-1)!;
    if (tool !== "searchJiraIssuesUsingJql" && tool !== "getJiraIssue") return;
    const { cloudId, ...inputs } = u.input;
    u.name = `${u.name.slice(0, -tool.length)}executeRead`;
    u.input = { name: tool, inputs, ...(cloudId === undefined ? {} : { cloudId }) };
  };
  for (const [title, wrapped] of [["direct", false], ["its reads through executeRead", true]] as Array<[string, boolean]>) {
    test(`a passing bundle, ${title}, with every item and page enveloped extracts the same items and grades alike`, async () => {
      let n = 0;
      const before = await extracted(buildPassingBundle("jira"));
      const after = await extracted(buildPassingBundle("jira"), (u, text) => {
        if (wrapped) wrapRead(u);
        const t = enveloped(text);
        if (t !== text) n += 1;
        return t;
      });
      expect(n).toBeGreaterThan(5);
      expect(items(after)).toEqual(items(before));
      const strip = (v: Verdict) => ({ findings: v.findings.filter((f) => f.code !== "unclassified-tool"), scenarios: v.scenarios });
      expect(strip(await grade(after))).toEqual(strip(await grade(before)));
    });
  }

  /** S1 A's decided create, made after the same create answered `answer`. */
  async function retried(how: Spelling, answer: unknown, isError = false): Promise<{ first: boolean; second: boolean }> {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S1", "A");
    const at = s.calls.findIndex((c) => c.name.endsWith("__createJiraIssue"));
    const made = s.calls[at]!;
    const { cloudId, ...inputs } = made.input;
    const input: Obj = how === "direct" ? clone(made.input) : { name: "createJiraIssue", inputs, cloudId };
    const lost = toolCall(s, how === "direct" ? "createJiraIssue" : how, input, raw(answer, isError), made.at);
    s.calls.splice(at, 0, lost);
    const v = await grade(await extracted(b));
    return { first: ungated(v, lost), second: ungated(v, made) };
  }
  for (const how of ["direct", "executeWrite"] as const) {
    for (const status of [400, 404, 422]) {
      test(`${how} create answering ${status} in-band: never landed, the retry is gated`, async () => {
        expect(await retried(how, inBand(status))).toEqual({ first: false, second: false });
      });
    }
    for (const [title, status] of [["408", 408], ["500", 500], ["no status", undefined], ["the string \"400\"", "400"]] as Array<[string, unknown]>) {
      test(`${how} create answering ${title} in-band: may have landed, the retry is ungated`, async () => {
        expect(await retried(how, inBand(status))).toEqual({ first: false, second: true });
      });
    }
    test(`${how} create answering {id, key}: settled, the repeat is ungated`, async () => {
      expect((await retried(how, v2({ id: "10150", key: "DST-9150" }))).second).toBe(true);
    });
  }
  for (const [where, over] of [
    ["upstreamErrors", { upstreamErrors: { errorMessages: ["Gateway timed out"], errors: {} } }],
    ["problems", { problems: [{ field: "parent", reason: "upstream timed out" }] }],
    ["an object error", { error: { detail: "upstream timed out" } }],
  ] as Array<[string, Obj]>) {
    test(`direct create answering 400 that says it timed out in ${where}: the retry is ungated`, async () => {
      expect(await retried("direct", inBand(400, over))).toEqual({ first: false, second: true });
    });
  }
  test("an in-band error followed by a notice is an error to the grader too", async () => {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const answer = raw(inBand(400));
    const c = append(s, "createJiraIssue", { projectKey: b.run.container, issueType: "Task", summary: "Undecided", labels: [b.roots[s.root].tag] }, { ...answer, text: `${answer.text}\nNotice: upgrade.` });
    expect(ungated(await grade(await extracted(b)), c)).toBe(false);
  });
  test("direct create answering 400 beside a created key: may have landed, the retry is ungated", async () => {
    expect(await retried("direct", inBand(400, { key: "DST-9150" }))).toEqual({ first: false, second: true });
  });
  for (const [title, answer, isError, again] of [
    ["in-band 400 with a break before 503", inBand(400, { message: "Upstream said:\n503" }), false, true],
    ["flagged 400 with a break before 503", { error: true, message: "Upstream said:\n503", statusCode: 400 }, true, true],
    ["flagged 400 beside a created key", { error: true, message: "x", statusCode: 400, key: "DST-9150" }, true, true],
    ["flagged 400 alone", { error: true, message: "bad request", statusCode: 400 }, true, false],
  ] as Array<[string, unknown, boolean, boolean]>) {
    test(`direct create answering ${title}: the retry is ${again ? "ungated" : "gated"}`, async () => {
      expect(await retried("direct", answer, isError)).toEqual({ first: false, second: again });
    });
  }
  test("a Linear create answering the Jira flagged form may have landed: the retry is ungated, as in the hook", async () => {
    const b = buildPassingBundle("linear");
    const s = marked(b, "S1", "A");
    const at = s.calls.findIndex((c) => c.name.endsWith("__save_issue") && c.input.id === undefined);
    const made = s.calls[at]!;
    s.calls.splice(at, 0, toolCall(s, "save_issue", clone(made.input), raw({ error: true, message: "Bad", statusCode: 400 }, true), made.at));
    expect(ungated(await grade(b), made)).toBe(true);
  });
  test("a 4xx only in the message of a 500 proves nothing", async () => {
    expect(await retried("direct", inBand(500, { message: "Error: status 400 Bad Request" }))).toEqual({ first: false, second: true });
  });
  test("an in-band error is no successful write: no ungated-write for an undecided create", async () => {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const c = append(s, "createJiraIssue", { projectKey: b.run.container, issueType: "Task", summary: "Undecided", labels: [b.roots[s.root].tag] }, raw(inBand(400)));
    expect(ungated(await grade(await extracted(b)), c)).toBe(false);
  });
  test("TWIN — the same undecided create answering {id, key} is ungated", async () => {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const c = append(s, "createJiraIssue", { projectKey: b.run.container, issueType: "Task", summary: "Undecided", labels: [b.roots[s.root].tag] }, raw(v2({ id: "1", key: `${b.run.container}-9151` })));
    expect(ungated(await grade(await extracted(b)), c)).toBe(true);
  });

  type Fetch = { how: "direct" | "executeRead"; own: boolean; shape: (t: Obj) => unknown };
  /** An S13 edit of an unbound ticket after `fetches`. True = ungated. */
  async function edited(fetches: Fetch[]): Promise<boolean> {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const key = `${b.run.container}-960`;
    for (const f of fetches) {
      const tag = b.roots[f.own ? s.root : s.root === "A" ? "B" : "A"].tag;
      const inputs = { issueIdOrKey: key };
      const answer = raw(f.shape(jiraTicket(key, { labels: [tag], project: b.run.container })));
      if (f.how === "direct") append(s, "getJiraIssue", inputs, answer);
      else append(s, "executeRead", { name: "getJiraIssue", inputs }, answer);
    }
    const c = append(s, "editJiraIssue", { issueIdOrKey: key, fields: { summary: "Retitled" } }, { isError: false, text: "", exitCode: null, items: [], lastPage: null });
    return ungated(await grade(await extracted(b)), c);
  }
  const v1 = (t: Obj): unknown => t;
  test("CONTROL — no fetch is ungated, an owned v1 fetch is gated", async () => {
    expect(await edited([])).toBe(true);
    expect(await edited([{ how: "direct", own: true, shape: v1 }])).toBe(false);
  });
  for (const how of READS) {
    test(`${how}: an owned v2 fetch is gated`, async () => {
      expect(await edited([{ how, own: true, shape: v2 }])).toBe(false);
    });
    test(`${how}: a foreign v2 fetch is ungated`, async () => {
      expect(await edited([{ how, own: false, shape: v2 }])).toBe(true);
    });
    test(`${how}: an in-band error carrying an owned ticket is ungated`, async () => {
      expect(await edited([{ how, own: true, shape: (t) => inBand(404, t) }])).toBe(true);
    });
    test(`${how}: an answer without project is ungated`, async () => {
      const without = (t: Obj): unknown => {
        delete (t.fields as Obj).project;
        return v2(t);
      };
      expect(await edited([{ how, own: true, shape: without }])).toBe(true);
    });
    test(`${how}: a newer foreign v2 answer supersedes an older direct owned one`, async () => {
      expect(await edited([{ how: "direct", own: true, shape: v1 }, { how, own: false, shape: v2 }])).toBe(true);
    });
    test(`${how}: a newer owned v2 answer supersedes an older foreign one`, async () => {
      expect(await edited([{ how: "direct", own: false, shape: v1 }, { how, own: true, shape: v2 }])).toBe(false);
    });
  }
});

// ===========================================================================
// AC-STE-867.5 — the decision from the transcript
// ===========================================================================

describe("AC-STE-867.5 — decide --from-transcript accepts v2 searches", () => {
  const SEARCH = "searchJiraIssuesUsingJql";
  let printed: Obj = {};
  beforeAll(() => {
    const r = runModule(PLUGIN_ROOT, "create_idempotency_probe.ts", ["query", w.be, "--title", TITLE, "--parent", EPIC]);
    if (r.exitCode !== 0) throw new Error(`fixture: query failed\n${show(r)}`);
    printed = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("{"))!) as Obj;
  });
  const match = (key = MADE): Obj => row(key, { summary: TITLE, parent: { id: "10085", key: EPIC } });
  const other = (key: string): Obj => row(key, { summary: `Other ${key}`, parent: { id: "10085", key: EPIC } });

  interface Search {
    name: string;
    input: Obj;
    answer: unknown;
  }
  const search = (how: "direct" | "executeRead", answer: unknown, extra: Obj = {}): Search => {
    const [name, input] = spelled(how, SEARCH, { ...printed, ...extra });
    return { name, input, answer };
  };
  function decide(calls: Search[]): Obj {
    const t = new Transcript();
    const ids = calls.map((c) => {
      const id = t.use(c.name, c.input);
      t.result(id, [{ type: "text", text: JSON.stringify(c.answer) }]);
      return id;
    });
    seq += 1;
    const path = join(w.scratch, `transcript-${seq}.jsonl`);
    writeFileSync(path, `${t.lines.join("\n")}\n`);
    const r = runModule(PLUGIN_ROOT, "create_idempotency_probe.ts", ["decide", w.be, "--from-transcript", path, ...ids, "--title", TITLE, "--parent", EPIC, "--attempt", "fast"]);
    const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
    if (line === undefined) throw new Error(`decide printed no decision:\n${show(r)}`);
    return JSON.parse(line) as Obj;
  }
  test("CONTROL — a direct v1 search", () => {
    expect(decide([search("direct", page([match()]))])).toMatchObject({ outcome: "reused", key: MADE });
  });
  for (const how of READS) {
    test(`${how}: the match is reused`, () => {
      expect(decide([search(how, v2(page([match()])))])).toMatchObject({ outcome: "reused", key: MADE });
    });
    test(`${how}: an empty last page proves absence`, () => {
      expect(decide([search(how, v2(page([])))])).toMatchObject({ outcome: "create", reason: "proven-absent" });
    });
    test(`${how}: the match on the second page is reused`, () => {
      expect(decide([search(how, v2(page([other("GK-140")], "tok-2"))), search(how, v2(page([match()])), { nextPageToken: "tok-2" })])).toMatchObject({ outcome: "reused", key: MADE });
    });
    test(`${how}: a first page only is capped`, () => {
      expect(decide([search(how, v2(page([other("GK-140")], "tok-2")))])).toMatchObject({ outcome: "refused", reason: "page-cap" });
    });
    test(`${how}: an in-band error beside an empty last page is unreadable, never a create`, () => {
      expect(decide([search(how, inBand(400, page([])))])).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
    test(`${how}: a key beside data is unreadable, never a create`, () => {
      expect(decide([search(how, { ...v2(page([])), context: {} })])).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
    test(`${how}: a row without project is unreadable, never a create`, () => {
      const bare = match();
      delete (bare.fields as Obj).project;
      expect(decide([search(how, v2(page([bare])))])).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
    test(`${how}: a narrowed search is refused`, () => {
      expect(decide([search(how, v2(page([])), { jql: `${String(printed.jql)} AND key = GK-1` })])).toMatchObject({ outcome: "refused", reason: "page-violates-query" });
    });
    test(`${how}: an extra input is refused`, () => {
      expect(decide([search(how, v2(page([])), { query: "x" })])).toMatchObject({ outcome: "refused", reason: "page-violates-query" });
    });
  }
  for (const how of READS) {
    test(`${how}: view "full" is the printed search (AC-STE-869.2 tells agents to send it)`, () => {
      expect(decide([search(how, v2(page([match()])), { view: "full" })])).toMatchObject({ outcome: "reused", key: MADE });
    });
    test(`${how}: any other view is refused`, () => {
      expect(decide([search(how, v2(page([])), { view: "compact" })])).toMatchObject({ outcome: "refused", reason: "page-violates-query" });
    });
  }
  test("executeRead with view \"full\" beside its inputs is the printed search", () => {
    expect(decide([{ name: jira("executeRead"), input: wrap(SEARCH, printed, { view: "full" }), answer: v2(page([match()])) }])).toMatchObject({ outcome: "reused", key: MADE });
  });
  for (const extra of [{ view: "compact" }, { responseFields: ["key"] }, { view: "full", responseFields: ["key"] }]) {
    test(`REFUSE — executeRead narrowed beside its inputs by ${JSON.stringify(extra)}`, () => {
      expect(decide([{ name: jira("executeRead"), input: wrap(SEARCH, printed, extra), answer: v2(page([])) }])).toMatchObject({ outcome: "refused", reason: "page-violates-query" });
    });
  }
  test("a chain of a direct page and an executeRead page", () => {
    expect(decide([search("direct", page([other("GK-140")], "tok-2")), search("executeRead", v2(page([match()])), { nextPageToken: "tok-2" })])).toMatchObject({ outcome: "reused", key: MADE });
  });
  test("executeRead with cloudId inside its inputs", () => {
    expect(decide([{ name: jira("executeRead"), input: { name: SEARCH, inputs: { ...printed, cloudId: CLOUD } }, answer: v2(page([match()])) }])).toMatchObject({ outcome: "reused", key: MADE });
  });
  test("REFUSE — executeRead naming another operation", () => {
    expect(decide([{ name: jira("executeRead"), input: wrap("getJiraIssue", printed), answer: v2(page([])) }])).toMatchObject({ outcome: "refused" });
  });
  test("REFUSE — executeRead with two different cloudId values", () => {
    expect(decide([{ name: jira("executeRead"), input: wrap(SEARCH, { ...printed, cloudId: "other.example.invalid" }), answer: v2(page([])) }])).toMatchObject({ outcome: "refused" });
  });
  test("REFUSE — executeRead with an unknown key beside its inputs", () => {
    expect(decide([{ name: jira("executeRead"), input: wrap(SEARCH, printed, { jql: "project = GK" }), answer: v2(page([])) }])).toMatchObject({ outcome: "refused" });
  });
});

// ===========================================================================
// AC-STE-867.5 — every other listing consumer
// ===========================================================================

/** What a consumer prints, without the receipt path and the saved file's own name and digest. */
const said = (r: ModuleRun): string[] => r.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("dpt-receipt:") && !l.includes("sha256"));

interface Consumer {
  name: string;
  module: string;
  args: (file: string) => string[];
  answer: () => Obj;
  /** A literal the run's output must hold. */
  says: RegExp;
}
const CONSUMERS: Consumer[] = [
  {
    name: "the saved-page decision",
    module: "create_idempotency_probe.ts",
    args: (f) => ["decide", w.be, f, "--title", TITLE, "--parent", EPIC, "--attempt", "fast"],
    answer: () => page([row(MADE, { summary: TITLE, parent: { key: EPIC } })]),
    says: /"outcome":"reused","key":"GK-150"/,
  },
  {
    name: "the milestone decision",
    module: "resolve_milestone_identity.ts",
    args: (f) => [w.be, "jira", "GK", f, "--title", EPIC_TITLE],
    answer: () => page([row("GK-90", { summary: "Another Epic", issuetype: EPIC_TYPE })]),
    says: /act=create/,
  },
  {
    name: "container ownership, list",
    module: "container_ownership.ts",
    args: (f) => ["list", w.be, f],
    answer: () => page([row("GK-121", { labels: [] }), row("GK-122", { labels: [FE_TAG] })]),
    says: /Import GK-121/,
  },
  {
    name: "container ownership, consent",
    module: "container_ownership.ts",
    args: (f) => ["consent", w.be, "GK-121", f],
    answer: () => page([row("GK-121", { labels: [] })]),
    says: /dpt-receipt:/,
  },
  {
    name: "ticket ownership, decide",
    module: "ticket_ownership.ts",
    args: (f) => ["decide", w.be, f],
    answer: () => row("GK-121"),
    says: /"verdict":"owned"/,
  },
  {
    name: "ticket ownership, confirm",
    module: "ticket_ownership.ts",
    args: (f) => ["confirm", w.be, "GK-121", f],
    answer: () => row("GK-121"),
    says: /dpt-receipt:/,
  },
  {
    name: "the attach target",
    module: "attach_project_milestone.ts",
    args: (f) => [w.be, "jira", "GK", w.planFile, f],
    answer: () => page([row(EPIC, { summary: "Rewards", issuetype: EPIC_TYPE })]),
    says: /key=GK-85/,
  },
  {
    name: "Epic close",
    module: "epic_close.ts",
    args: (f) => [w.be, EPIC, "--children", f],
    answer: () => page([row("GK-101", { labels: [FE_TAG], status: DONE, parent: { key: EPIC } }), row("GK-111", { status: DONE, parent: { key: EPIC } })]),
    says: /dpt-receipt:/,
  },
  {
    name: "the sibling gate",
    module: "sibling_release.ts",
    args: (f) => [w.be, w.planFile, MILESTONE, "--children", f],
    answer: () => page([row("GK-101", { labels: [FE_TAG], status: DONE, parent: { key: EPIC } }), row("GK-111", { status: DONE, parent: { key: EPIC } })]),
    says: /Spans: glade-fe@v3\.4\.0/,
  },
  {
    name: "the bug-type check",
    module: "bug_tracker_type.ts",
    args: (f) => ["jira", f, "Bug", EPIC],
    answer: () => ({ startAt: 0, maxResults: 50, total: 2, issueTypes: [{ id: "10002", name: "Task", subtask: false, description: "" }, { id: "10005", name: "Bug", subtask: false, description: "" }] }),
    says: /^Bug$/m,
  },
];

describe("AC-STE-867.5 — each command reads a saved v2 answer as it reads the v1 one", () => {
  for (const c of CONSUMERS) {
    const run = (answer: unknown): ModuleRun => runModule(PLUGIN_ROOT, c.module, c.args(save(answer)));
    test(`CONTROL — ${c.name}: the v1 answer`, () => {
      const r = run(c.answer());
      expect(r.exitCode, show(r)).toBe(0);
      expect(r.stdout).toMatch(c.says);
    });
    test(`${c.name}: the v2 answer, with the v1 output`, () => {
      const r = run(v2({ appliedContentFormat: "markdown", ...c.answer() }));
      expect(r.exitCode, show(r)).toBe(0);
      expect(r.stdout).toMatch(c.says);
      expect(said(r)).toEqual(said(run(c.answer())));
    });
    test(`${c.name}: an in-band error beside the whole answer is never read as it`, () => {
      const r = run(inBand(400, c.answer()));
      expect(`${r.exitCode === 0 ? "" : "refused"}${r.stdout}`).toMatch(/refused/);
      expect(r.stdout).not.toMatch(c.says);
    });
  }

  for (const [title, args, says] of [
    ["container ownership, list", (a: string, b: string) => ["list", w.be, a, b], /Import GK-122/],
    ["container ownership, consent", (a: string, b: string) => ["consent", w.be, "GK-122", a, b], /dpt-receipt:/],
  ] as Array<[string, (a: string, b: string) => string[], RegExp]>) {
    test(`${title}: two chained v2 pages`, () => {
      const first = save(v2(page([row("GK-121", { labels: [] })], "tok-2")));
      const second = save({ ...v2(page([row("GK-122", { labels: [] })])), requestCursor: "tok-2" });
      const r = runModule(PLUGIN_ROOT, "container_ownership.ts", args(first, second));
      expect(r.exitCode, show(r)).toBe(0);
      expect(r.stdout).toMatch(says);
    });
  }
  test("Epic close and the sibling gate read a saved array of chained v2 pages", () => {
    const kids = [row("GK-101", { labels: [FE_TAG], status: DONE, parent: { key: EPIC } }), row("GK-111", { status: DONE, parent: { key: EPIC } })];
    const file = save([v2(page([kids[0]!], "tok-2")), { ...v2(page([kids[1]!])), requestCursor: "tok-2" }]);
    const close = runModule(PLUGIN_ROOT, "epic_close.ts", [w.be, EPIC, "--children", file]);
    expect(close.stdout, show(close)).toContain("dpt-receipt:");
    const gated = runModule(PLUGIN_ROOT, "sibling_release.ts", [w.be, w.planFile, MILESTONE, "--children", file]);
    expect(gated.stderr, show(gated)).toContain("children=2");
  });
});

describe("AC-STE-867.5 — import reads v2 answers (it has no command form)", () => {
  async function imported(ownership: (root: string) => Parameters<typeof importFromTracker>[5]): Promise<{ error: string | null; labels: unknown }> {
    const { be } = makeWorld();
    let labels: unknown = null;
    const provider = {
      getMetadata: async () => ({ title: "Hand filed", description: "Body", acs: [] }),
      sync: async (spec: { frontmatter?: Obj; labels?: unknown }) => {
        labels = spec.labels;
        return { kind: "ok", message: "" };
      },
      claimLock: async () => ({ kind: "claimed", message: "" }),
      getUrl: () => "https://example.invalid/browse/GK-121",
      mintId: () => "GK-121",
      upsertTicketMetadata: async () => "GK-121",
      filenameFor: () => "GK-121.md",
    } as unknown as Provider;
    try {
      await importFromTracker("jira", "GK-121", provider, join(be, "specs"), async () => MILESTONE, ownership(be));
      return { error: null, labels };
    } catch (e) {
      return { error: (e as Error).message, labels };
    }
  }
  const untagged = (): Obj => row("GK-121", { labels: ["milestone-x"] });
  test("CONTROL — a fetched v1 ticket imports", async () => {
    expect((await imported((root) => ticketImportOwnership(root, untagged()))).error).toBeNull();
  });
  test("a fetched v2 ticket imports, its labels merged with the tag", async () => {
    const got = await imported((root) => ticketImportOwnership(root, v2(untagged())));
    expect(got.error).toBeNull();
    expect(got.labels).toEqual(["milestone-x", BE_TAG]);
  });
  test("a listed v2 page imports its ticket", async () => {
    expect((await imported((projectRoot) => ({ projectRoot, pages: [v2(page([untagged()]))] }))).error).toBeNull();
  });
  test("a ticket on the second of two chained v2 pages imports", async () => {
    const pages = [v2(page([row("GK-120")], "tok-2")), { ...v2(page([untagged()])), requestCursor: "tok-2" }];
    expect((await imported((projectRoot) => ({ projectRoot, pages }))).error).toBeNull();
  });
  test("REFUSE — a fetched in-band error carrying the ticket, named", async () => {
    expect((await imported((root) => ticketImportOwnership(root, inBand(404, untagged())))).error).toContain(ERROR_NAME);
  });
});

describe("AC-STE-867.5 — the repoint command reads v2 listings", () => {
  const LISTINGS: Array<["--projects" | "--issue-types" | "--containers", number, () => unknown]> = [
    ["--projects", 1, () => jiraProjects(["FY", "GK", "GX"])],
    ["--issue-types", 3, () => jiraIssueTypes(["Epic", "Task", "Bug"])],
    ["--containers", 7, () => jiraEpics("GK", ["GK-80", "GK-83", "GK-85"])],
  ];
  const rows = (flag: "--projects" | "--issue-types" | "--containers", answer: unknown): string[] => {
    const g = makeGlade();
    try {
      const out = runRepoint(g.args({ [flag]: g.listing("v2.json", answer) })).stdout;
      return [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${n} ${String(rowVerdict(out, n))} ${n === 1 || n === 3 ? rowLine(out, n).split(g.lst).join("<lst>") : ""}`);
    } finally {
      g.cleanup();
    }
  };
  for (const [flag, , answer] of LISTINGS) {
    test(`${flag}: the v2 answer draws the v1 rows`, () => {
      const v1Rows = rows(flag, answer());
      expect(v1Rows.filter((r) => / PASS/.test(r)).length).toBeGreaterThan(2);
      expect(rows(flag, v2(answer()))).toEqual(v1Rows);
    });
  }
  test("--statuses: the v2 transitions and statuses answers draw the v1 row 4; an in-band error refuses it", () => {
    const recorded = JSON.parse(readFileSync(join(SHAPES, "jira", "listJiraIssueTransitions.v2.json"), "utf-8")) as { answer: { data: Obj } };
    const transitions = recorded.answer.data;
    expect("expand" in transitions).toBe(false);
    const statuses = { statuses: ["To Do", "In Progress", "Done"].map((name, i) => ({ id: String(i), name })), isLast: true };
    const row4 = (answer: unknown): string => {
      const g = makeGlade();
      try {
        const out = runRepoint(g.args({ "--statuses": g.listing("s.json", answer) })).stdout;
        return `${String(rowVerdict(out, 4))} ${rowLine(out, 4).split(g.lst).join("<lst>")}`;
      } finally {
        g.cleanup();
      }
    };
    for (const a of [transitions, statuses]) {
      expect(row4(a)).toContain("PASS");
      expect(row4(v2(a))).toBe(row4(a));
    }
    expect(row4(inBand(400, transitions))).toContain("REFUSE");
    expect(row4({ ...v2(transitions), extra: 1 })).toContain("REFUSE");
  });
  test("--projects: an in-band error beside the list refuses row 1", () => {
    expect(rows("--projects", inBand(400, jiraProjects(["FY", "GK", "GX"]) as Obj))[0]).toStartWith("1 REFUSE");
  });
  test("--issue-types: an in-band error beside the list refuses row 3", () => {
    expect(rows("--issue-types", inBand(400, jiraIssueTypes(["Epic", "Task", "Bug"]) as Obj))[2]).toStartWith("3 REFUSE");
  });
});

// ===========================================================================
// AC-STE-867.6 — every v1 fixture reads as before
// ===========================================================================

/**
 * Measured at 2026-11-24, before the v2 reader: per fixture, which reads
 * succeed (`readTrackerPage` under issues, projects, milestones, labels and
 * teams; `readTrackerListing`; `readTrackerItem`; the three complete lists) and
 * the sha256 of every result, a refusal standing as "refused".
 */
const V1_READS: Array<[string, string, string]> = [
  ["jira/create.plain.json", "------+---", "ce68e10739874297359cda2cd3299822e3d1dd7773540c1b896e3f3d39c07905"],
  ["jira/create.wrapped.json", "------+---", "393345b42cf6768b6ffee57cad669ab8a6f67035d5e2a79b406cf08139daf298"],
  ["jira/edit.plain.json", "------+---", "2a2e50e3b793cbe27ce7c23839f69b488b06c4a411e2a6ccb1adcb36f88d94ce"],
  ["jira/edit.wrapped.json", "------+---", "07e797674050ac75ec0faba66ca5b05a1b8aa3c7c0c53b64c1e4edce86caa2c1"],
  ["jira/get.plain.json", "------+---", "babed70bea63f9075dd403ce87e4c327b2e7c78d5ba7fee8d5bb0c0a973c15a8"],
  ["jira/get.wrapped.json", "------+---", "023f9529cd2bf7773559c7a282d1c31c4f707de94fb8d9a99e8c7c0c7405b699"],
  ["jira/getAccessibleAtlassianResources.json", "-------+--", "94209844a0e9d8e006dfe57a702760b3d41ef6177402a218a17b21c39d3aa324"],
  // Amended by AC-STE-872.5 (M_e8850b): the v1 create-metadata fixture this FR adds; no shared reader reads it.
  ["jira/getJiraIssueTypeMetaWithFields.json", "----------", "4a98cc60268ec64279d665b586193d598135ac0a3d6bd6a4975892346566695d"],
  ["jira/getJiraProjectIssueTypesMetadata.json", "---------+", "b31a5ea15c73634c0ec9998aa72e6a1d81738317703fd4fa0935ee2eb19fe1d4"],
  ["jira/getVisibleJiraProjects.json", "--------+-", "0b6578f565f39b3320fe9fd6e2d9808e029ecf77cdba8f446b38e9c42e6bdc47"],
  ["jira/search.plain.last.json", "++++++----", "1562bb3f03a85db3fa547cded892ee2c6b9d0ee5cad827da0dde2b586ede9364"],
  ["jira/search.plain.more.json", "++++++----", "143f96cc9de0ccb871c94309eadec92b6861572e7f8df38afb9c77c0fe368993"],
  ["jira/search.wrapped.last.json", "+++++++---", "a23897c0a30f008d4ee9e49a14d06fb43354ccc63ea00840289f64a6e1dfce82"],
  ["jira/search.wrapped.more.json", "++++++----", "2085f86ac8672cc0992f577ac471563a3f7b3302de2645eb146202de31beea71"],
  ["linear/create_issue_label.json", "----------", "4a98cc60268ec64279d665b586193d598135ac0a3d6bd6a4975892346566695d"],
  ["linear/get_issue.json", "------+---", "11b6d634785d89934c24d745c9dba1eb8463884eae8b9d342df3e10970aedb1d"],
  ["linear/get_milestone.json", "------+---", "d798be0a33c1d93e655bb31fbb1fad82bf94a2b68bed7a8e169fbc1c4decaa42"],
  ["linear/get_project.json", "------+---", "9746b97c274384cfd1a9ec12df6c2b912dbd716078427950a838fb87f049e443"],
  ["linear/get_team.json", "------+---", "fcd59f6ac6ae6d15f1294e402e1a1511791c2d2d0c5cd07b04afaca70a43b0f8"],
  ["linear/list_issue_labels.more.json", "---+------", "93bd14ef56636fb123efcd8ac4138f0b0d7fe33b2026b1c2f2f5051143d33dba"],
  ["linear/list_issue_statuses.json", "-------+--", "6581c95a62ff9ce18454f9d327e770e4414eb417900f32dc633f18ee8e9f46eb"],
  ["linear/list_issues.last.json", "+----+----", "42dc6112c8ee14cf79a5950b9b03e2345bac9b509e4d63a1cdfcde401748f9bf"],
  ["linear/list_issues.more.json", "+----+----", "ffda21026ed7c67f372bfea951411bc4b7e21ff7ce7731eb97f10557c4029a7c"],
  ["linear/list_milestones.json", "--+-------", "30d515a6301fb7456e34f31dc0780c546b28763c19f78c65822bdbe271f69944"],
  ["linear/list_projects.json", "-+--------", "8a416d35b1fde76db14e10758d9d015e99e2217640da090660973a2784ab6697"],
  ["linear/list_teams.json", "----+-----", "dfab7ffef9413cfcf8122ca3dec98a397c9de4f83961399775517971e3f06587"],
  ["linear/save_issue.create.json", "------+---", "e535bea5797d25c9f131c7c627f52a795671cd68fddc347e447e941398e69b1a"],
  ["linear/save_issue.update.json", "------+---", "67f8736433f568527333f07a59cc4cc04c4fadc1ba0afc77dd349b9a4e7b12b5"],
  ["linear/save_milestone.create.json", "------+---", "69ef44f0105d90087ef030622910674dff3218db84438aabe62d1c46a0280439"],
];
const ITEM_KEYS = ["issues", "projects", "milestones", "labels", "teams"];
const LISTS: CompleteListTool[] = ["linear:list_issue_statuses", "jira:getVisibleJiraProjects", "jira:getJiraProjectIssueTypesMetadata"];
const shapeFiles = (): string[] => readdirSync(SHAPES).flatMap((t) => readdirSync(join(SHAPES, t)).map((f) => `${t}/${f}`)).sort();

describe("AC-STE-867.6 — every v1 fixture reads to the same result as before", () => {
  test("the pins cover every v1 fixture", () => {
    expect(V1_READS.map(([f]) => f).sort()).toEqual(shapeFiles().filter((f) => !f.endsWith(".v2.json")));
  });
  for (const [file, oks, digest] of V1_READS) {
    test(file, () => {
      const tracker = file.split("/")[0] as "jira" | "linear";
      const answer = (JSON.parse(readFileSync(join(SHAPES, file), "utf-8")) as Obj).answer;
      const reads = [
        ...ITEM_KEYS.map((k) => readTrackerPage(tracker, answer, k)),
        readTrackerListing(tracker, [answer]),
        readTrackerItem(tracker, answer),
        ...LISTS.map((l) => readCompleteList(l, answer)),
      ].map((r) => (r.ok ? r : "refused"));
      expect(reads.map((r) => (r === "refused" ? "-" : "+")).join("")).toBe(oks);
      expect(new Bun.CryptoHasher("sha256").update(JSON.stringify(reads)).digest("hex")).toBe(digest);
    });
  }
});

describe("AC-STE-867.5 — the bug-type check on the recorded v2 issue types, whose rows carry no hierarchyLevel", () => {
  const types = (names: string[]): Obj => ({ data: { startAt: 0, maxResults: 50, total: names.length, issueTypes: names.map((name, i) => ({ id: String(10001 + i), name, subtask: name === "Sub-task", description: "" })) } });
  const check = (type: string): ModuleRun => runModule(PLUGIN_ROOT, "bug_tracker_type.ts", ["jira", save(types(["Task", "Epic", "Sub-task", "Bug"])), type, EPIC]);
  for (const type of ["Epic", "Sub-task"]) {
    test(`REFUSE — ${type}`, () => {
      const r = check(type);
      expect(r.exitCode, show(r)).not.toBe(0);
      expect(r.stderr).toContain("cannot take");
    });
  }
  test("PERMIT — Bug", () => {
    expect(check("Bug").exitCode).toBe(0);
  });
});

// ===========================================================================
// AC-STE-867.7 — the v2 fixtures
// ===========================================================================

describe("AC-STE-867.7 — each accepted v2 shape has a sanitised fixture", () => {
  const load = (f: string): { provenance: Obj; answer?: Obj } => JSON.parse(readFileSync(join(SHAPES, "jira", `${f}.v2.json`), "utf-8")) as { provenance: Obj; answer?: Obj };
  const RECORDED = ["comment", "create", "edit", "error", "get.compact", "get.full", "search.executeRead", "search.last", "search.more", "transition"];
  const CALLED = ["getJiraIssueTypeMetaWithFields", "listJiraIssueLinkTypes", "listJiraIssueTransitions", "listJiraProjectIssueTypesMetadata", "listJiraProjects.last", "listJiraProjects.more"];
  test("the fixture set", () => {
    expect(shapeFiles().filter((f) => f.endsWith(".v2.json"))).toEqual([...RECORDED, ...CALLED, "error.flagged"].map((f) => `jira/${f}.v2.json`).sort());
  });
  for (const f of RECORDED) {
    test(`${f}: provenance and date`, () => {
      const p = load(f).provenance;
      expect(p.method).toBe("recorded-transcript");
      expect(String(p.measured_at) >= "2026-11-16" && String(p.measured_at) <= "2026-11-24").toBe(true);
      expect(String(p.note)).toContain("every value is invented");
      expect(typeof p.request).toBe("object");
    });
    test(`${f}: one data level`, () => {
      expect(Object.keys(load(f).answer!)).toEqual(["data"]);
    });
  }
  for (const f of CALLED) {
    test(`${f}: recorded by a read-only call, dated, sanitised, one data level`, () => {
      const p = load(f).provenance;
      expect(p.method).toBe("read-only-call");
      expect(p.measured_at).toBe("2026-11-24");
      expect(String(p.note)).toContain("every value is invented");
      expect(Object.keys(load(f).answer!)).toEqual(["data"]);
    });
  }
  test("the project list reads as a complete list only on its last page", () => {
    expect(readCompleteList("jira:getVisibleJiraProjects", load("listJiraProjects.last").answer)).toMatchObject({ ok: true, complete: true, items: [{ key: "ZZ" }] });
    expect(readCompleteList("jira:getVisibleJiraProjects", load("listJiraProjects.more").answer)).toMatchObject({ ok: true, complete: false, items: [{ key: "ZZ" }, { key: "ZY" }] });
  });
  test("the issue types read as a complete list, and a short page does not", () => {
    const a = load("listJiraProjectIssueTypesMetadata").answer as { data: Obj };
    expect(readCompleteList("jira:getJiraProjectIssueTypesMetadata", a)).toMatchObject({ ok: true, complete: true });
    expect(readCompleteList("jira:getJiraProjectIssueTypesMetadata", { data: { ...a.data, total: 9 } })).toMatchObject({ ok: true, complete: false });
  });
  for (const f of [...RECORDED, ...CALLED, "error.flagged"]) {
    test(`${f}: no real key, site, name, address or account id`, () => {
      const text = readFileSync(join(SHAPES, "jira", `${f}.v2.json`), "utf-8");
      expect([...text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => m[0]).filter((k) => !/^ZZ-\d+$/.test(k) && !/^STE-867$/.test(k))).toEqual([]);
      expect(text).not.toMatch(/https?:\/\/|@|atlassian\.net|accountId|displayName|emailAddress|avatar/i);
      expect([...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => m[0]).filter((u) => !u.startsWith("aaaaaaaa-aaaa-4aaa-8aaa-"))).toEqual([]);
    });
  }
  const keys = (r: { ok: true; items: Obj[] } | { ok: false; reason: string }): unknown => (r.ok ? r.items.map((i) => trackerItemKey("jira", i)) : r);
  for (const [f, want, last] of [["search.last", ["ZZ-101", "ZZ-102"], true], ["search.more", ["ZZ-103"], false], ["search.executeRead", ["ZZ-104"], true]] as Array<[string, string[], boolean]>) {
    test(`${f} reads as a page`, () => {
      const r = readTrackerListing("jira", [load(f).answer]);
      expect(keys(r)).toEqual(want);
      expect(r).toMatchObject({ ok: true, last });
    });
  }
  test("search.more hands its token", () => {
    expect(readTrackerPage("jira", load("search.more").answer)).toMatchObject({ ok: true, page: { next: "example-token-2" } });
  });
  for (const [f, want] of [["get.compact", "ZZ-101"], ["get.full", "ZZ-101"], ["edit", "ZZ-101"], ["create", "ZZ-105"]] as Array<[string, string]>) {
    test(`${f} reads as the item ${want}`, () => {
      expect(readTrackerItem("jira", load(f).answer)).toMatchObject({ ok: true, item: { key: want } });
    });
  }
  test("error.flagged: recorded by a read-only call, dated, and read as its status; no other tracker reads it", () => {
    const { provenance: p, answer } = load("error.flagged");
    expect([p.method, p.measured_at]).toEqual(["read-only-call", "2026-11-24"]);
    expect(String(p.note)).toContain("every value is invented");
    expect(Object.keys(answer!)).toEqual(["error", "message", "statusCode"]);
    expect(flaggedError("jira", JSON.stringify(answer))?.status).toBe(400);
    expect(flaggedError("linear", JSON.stringify(answer))).toBeNull();
    expect(readTrackerItem("jira", answer).ok).toBe(false);
  });
  test("getJiraIssueTypeMetaWithFields reads as its field rows, named by fieldId", () => {
    expect(discoverAcField(fieldRows(load("getJiraIssueTypeMetaWithFields").answer))).toEqual({ ok: true, gid: "customfield_10050", name: "Acceptance Criteria" });
  });
  test("error reads as the named error", () => {
    expect(readTrackerItem("jira", load("error").answer)).toMatchObject({ ok: false, reason: expect.stringContaining("EXAMPLE_VALIDATION_ERROR") });
  });
  for (const f of ["transition", "comment"]) {
    test(`${f} holds no item`, () => {
      expect(readTrackerItem("jira", load(f).answer).ok).toBe(false);
    });
  }
});
