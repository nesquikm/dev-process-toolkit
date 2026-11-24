// STE-866 (M_b054b1) — writes through the generic execute tools are gated.
//
// `executeRead` / `executeWrite` / `executeDestructive` carry any operation as
// `{name, inputs, cloudId}`. `canonicalAtlassianCall` unwraps them once; the
// tracker-write gate and its live grader then read the named operation's call.
// The gate exports `TRACKER_EXECUTE_TOOLS`, kept OUT of `TRACKER_WRITE_TOOLS`,
// and the registered matcher is generated from both lists.
//
// Gate legs run the SHIPPED `.sh` wrapper on a recorded PreToolUse payload;
// grader legs append or re-spell calls of a passing live bundle. The wrapper
// keys and the v2 registry were recorded; every key and site here is invented.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { RECEIPT_ANNOUNCEMENT_PREFIX, announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { commitAll, git } from "./_span_fixture";
import { BE_TAG, FE_TAG, boundFr, declareJira, declareLinear } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import { buildPassingBundle, clone, materialize, serverPrefix, type BundleSession, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";
import {
  SESSION,
  Transcript,
  childEnv,
  cleanupTemps as cleanupFixtureTemps,
  gate,
  neutralCwd,
  permitProblem,
  refusalProblem,
  runModule,
  shRootFor,
  show,
  type Run,
} from "./_m_b2fdc0_ste729_fixture";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const CALL_PATH = join(SRC, "atlassian_call.ts");
const GRADER_PATH = join(SRC, "shared_tracker_live_grader.ts");
const HOOK_PATH = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-tracker-write-gate.ts");
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");

const EPIC = "GK-85";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const VERSION = "1.2.0";
const CLOUD = "example.invalid";
const OTHER_CLOUD = "other.example.invalid";
const OWN = "GK-112"; // bound by a tracked FR of glade-be
const FOREIGN = "GK-101"; // glade-fe's
const FOREIGN_2 = "GK-102";
const SERVERS = ["atlassian", "claude_ai_Atlassian"] as const;
const EXECUTE = ["executeRead", "executeWrite", "executeDestructive"] as const;
const WRITE = "executeWrite";
const DESTRUCTIVE = "executeDestructive";
const READ = "executeRead";

type Input = Record<string, unknown>;
interface Canonical {
  tool: string;
  input: Input;
  unplaced: string[];
}
const canonical = async (tool: string, input: Input): Promise<Canonical> =>
  ((await import(CALL_PATH)) as { canonicalAtlassianCall: (t: string, i: Input) => Canonical }).canonicalAtlassianCall(tool, input);

interface HookModule {
  TRACKER_WRITE_TOOLS: readonly string[];
  TRACKER_EXECUTE_TOOLS: readonly string[];
  TRACKER_READ_TOOLS: readonly string[];
  UNGATED_WRITE_TOOLS: Readonly<Record<string, string>>;
  TRACKER_WRITE_MATCHER: string;
}
const hook = async (): Promise<HookModule> => (await import(HOOK_PATH)) as unknown as HookModule;

const jira = (tool: string, server: string = "atlassian"): string => `mcp__${server}__${tool}`;
/** The recorded wrapper input: `cloudId` beside `inputs`. */
const wrap = (name: unknown, inputs: unknown, extra: Input = {}): Input => ({ name, inputs, cloudId: CLOUD, ...extra });

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-866-${label}-`)));
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
  scratch: string;
}

/** The STE-699 world: BE planned and shipped M_GK_85 and binds OWN by a tracked FR. */
function makeWorld(): World {
  const parent = tempDir("world");
  const be = join(parent, BE_TAG);
  const fe = join(parent, FE_TAG);
  for (const [root, tag] of [[be, BE_TAG], [fe, FE_TAG]] as const) {
    mkdirSync(root, { recursive: true });
    declareJira(root, tag);
  }
  writePlan(be, "archive", MILESTONE, { [BE_TAG]: ".", [FE_TAG]: `../${FE_TAG}` }, { shippedIn: `v${VERSION}` });
  writeFr(be, "GK-111", MILESTONE, "archived");
  boundFr(be, OWN);
  writeFileSync(join(be, "CHANGELOG.md"), ["# Changelog", "", `## [${VERSION}] — 2026-11-01 — "Close Out"`, "", "### Fixed", "", "- The milestone shipped.", ""].join("\n"));
  writePlan(fe, "archive", MILESTONE, { [BE_TAG]: `../${BE_TAG}`, [FE_TAG]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, FOREIGN, MILESTONE, "archived");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  return { be, scratch: tempDir("scratch") };
}

/** A committed repository with the given declaration, or none at all. */
function bareRepo(label: string, declare: ((root: string) => void) | null): string {
  const root = tempDir(label);
  writeFileSync(join(root, "README.md"), "fixture\n");
  declare?.(root);
  git(root, "init", "-q", "-b", "main");
  commitAll(root, "fixture");
  return root;
}

const child = (key: string, label: string): Input => ({
  key,
  fields: { summary: `Child ${key}`, status: { name: "Done", statusCategory: { key: "done" } }, issuetype: { name: "Task" }, project: { key: "GK" }, labels: [label], parent: { key: EPIC } },
});

/** A transcript holding the REAL epic_close.ts run that announced GK-85's receipt. */
function closedTranscript(w: World): Transcript {
  const listing = join(w.scratch, "children.json");
  writeFileSync(listing, JSON.stringify({ issues: [child(FOREIGN, FE_TAG), child("GK-111", BE_TAG)], isLast: true }));
  const r = runModule(PLUGIN_ROOT, "epic_close.ts", [w.be, EPIC, "--children", listing]);
  if (r.exitCode !== 0 || !r.stdout.includes(RECEIPT_ANNOUNCEMENT_PREFIX)) throw new Error(`fixture: epic_close.ts did not permit:\n${show(r)}`);
  const t = new Transcript();
  t.run(r);
  return t;
}

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

const TITLE = "BE payout export";
const EPIC_TITLE = "BE Payouts";

/** A ticket create decided (`create` + `attach-target` receipts) under GK-85. */
function ticketDecided(w: World): Transcript {
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

/** An Epic create decided by the REAL front door on an empty listing, then re-listed. */
function epicDecided(w: World): Transcript {
  const listing = join(w.scratch, "epics.json");
  writeFileSync(listing, JSON.stringify({ issues: [], isLast: true }));
  const run = runModule(PLUGIN_ROOT, "resolve_milestone_identity.ts", [w.be, "jira", "GK", listing, "--title", EPIC_TITLE]);
  if (run.exitCode !== 0) throw new Error(`fixture: the decision did not run:\n${show(run)}`);
  const t = new Transcript();
  t.bash(`bun run "${join(SRC, "resolve_milestone_identity.ts")}" ${w.be} jira GK ${listing} --title "${EPIC_TITLE}"`, run.stdout.trimEnd());
  t.tool(jira("searchJiraIssuesUsingJql"), { cloudId: CLOUD, jql: "project = GK AND issuetype = Epic", fields: ["summary", "status", "issuetype", "project", "labels"], maxResults: 100 }, { issues: [], isLast: true });
  return t;
}

const TICKET_V2: Input = { projectKey: "GK", issueType: "Task", summary: TITLE, parent: EPIC, labels: [BE_TAG] };
const TICKET_V1: Input = { projectKey: "GK", issueTypeName: "Task", summary: TITLE, parent: EPIC, additional_fields: { labels: [BE_TAG] } };
const EPIC_V2: Input = { projectKey: "GK", issueType: "Epic", summary: EPIC_TITLE, labels: [BE_TAG] };

// ------------------------------------------------------------------ verdicts

function expectPermit(r: Run): void {
  expect(permitProblem(r), show(r)).toBeNull();
}
function expectSilent(r: Run): void {
  expect({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
}
function expectRefusal(r: Run, ...needles: string[]): void {
  expect(refusalProblem(r), show(r)).toBeNull();
  for (const n of needles) expect(r.stderr).toContain(n);
}

const ask = (tool: string, input: Input, cwd: string, t = new Transcript(), server: string = "atlassian"): Promise<Run> => gate(PLUGIN_ROOT, jira(tool, server), input, t, cwd);

let seq = 0;
/** The gate with extra environment, or on a call whose own line and id are absent. */
async function drive(tool: string, input: Input, cwd: string, t: Transcript, env: Record<string, string> = {}): Promise<Run> {
  seq += 1;
  const path = join(neutralCwd(), `transcript-866-${process.pid}-${seq}.jsonl`);
  writeFileSync(path, `${t.lines.join("\n")}\n`);
  const payload = JSON.stringify({ session_id: SESSION, transcript_path: path, cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: jira(tool), tool_input: input });
  const sh = shRootFor(PLUGIN_ROOT);
  const proc = Bun.spawn(["bash", join(sh, "templates", "hooks", "process", "pre-tracker-write-gate.sh")], { cwd: neutralCwd(), env: { ...childEnv(sh), ...env }, stdin: new Response(payload).body, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

let w: World;
beforeAll(() => {
  w = makeWorld();
});

// ===========================================================================
// AC-STE-866.1 — the matcher, the unwrapping, the cloudId
// ===========================================================================

/** The recorded v2 registry, identical under both server spellings. */
const V2_REGISTRY = [
  "addGraphContext", "addOrEditJiraIssueComment", "atlassianUserInfo", "createConfluenceContent", "createJiraIssue", "discover", "editJiraIssue",
  "executeDestructive", "executeRead", "executeWrite", "getAccessibleAtlassianResources", "getCollaborators", "getConfluenceContent", "getGraphContext",
  "getGraphObject", "getJiraIssue", "getLoomObjectsContent", "getPeopleInfo", "getWorkActivity", "getWorkPortfolio", "listJiraIssueComments", "search",
  "searchConfluence", "searchJiraIssuesUsingJql", "transitionJiraIssue", "updateConfluenceContent",
] as const;
const V2_READS = [
  "discover", "getCollaborators", "getConfluenceContent", "getGraphContext", "getGraphObject", "getLoomObjectsContent", "getPeopleInfo", "getWorkActivity",
  "getWorkPortfolio", "listJiraIssueComments", "searchConfluence",
] as const;
const V2_CONFLUENCE_WRITES = ["createConfluenceContent", "updateConfluenceContent", "addConfluenceReaction", "addLabelsToConfluenceContent", "createConfluenceAttachment", "createConfluenceComment", "createConfluenceInfographicForPage", "createConfluenceMauiApp", "createConfluenceSpace", "editConfluenceInfographicForPage", "editConfluenceMauiApp", "manageConfluenceApproval", "unwatchConfluenceLabel", "unwatchConfluenceSpace", "updateConfluenceComment", "updateConfluenceCommentResolution", "watchConfluenceContent", "watchConfluenceLabel", "watchConfluenceSpace"] as const;

describe("AC-STE-866.1 — the matcher covers the execute tools", () => {
  const registered = (): string => {
    const groups = (JSON.parse(readFileSync(HOOKS_JSON, "utf-8")) as { hooks: { PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> } }).hooks.PreToolUse;
    const mine = groups.filter((g) => g.hooks.some((h) => h.command.endsWith("/pre-tracker-write-gate.sh")));
    expect(mine.length).toBe(1);
    return mine[0]!.matcher ?? "";
  };

  test("TRACKER_EXECUTE_TOOLS is the three generic tools", async () => {
    expect([...(await hook()).TRACKER_EXECUTE_TOOLS]).toEqual([...EXECUTE]);
  });
  test("no execute tool is in TRACKER_WRITE_TOOLS", async () => {
    const m = await hook();
    expect(m.TRACKER_WRITE_TOOLS.filter((t) => m.TRACKER_EXECUTE_TOOLS.includes(t))).toEqual([]);
  });
  test("the registered matcher is the one generated from both lists", async () => {
    const m = await hook();
    expect(m.TRACKER_WRITE_MATCHER).toBe(`^mcp__.+__(${[...m.TRACKER_WRITE_TOOLS, ...m.TRACKER_EXECUTE_TOOLS].join("|")})$`);
    expect(registered()).toBe(m.TRACKER_WRITE_MATCHER);
  });
  for (const server of SERVERS) {
    for (const tool of EXECUTE) {
      test(`matches ${tool} under ${server}`, () => {
        expect(new RegExp(registered()).test(jira(tool, server))).toBe(true);
      });
    }
    test(`an execute-like name and the v2 reads stay unmatched under ${server}`, () => {
      const re = new RegExp(registered());
      expect(["executeWrites", "executeReadOnly", ...V2_READS].filter((t) => re.test(jira(t, server)))).toEqual([]);
    });
  }
  test("every recorded v2 name sits in exactly one of the four lists", async () => {
    const m = await hook();
    const lists = [m.TRACKER_WRITE_TOOLS, m.TRACKER_EXECUTE_TOOLS, m.TRACKER_READ_TOOLS, Object.keys(m.UNGATED_WRITE_TOOLS)];
    expect(V2_REGISTRY.length).toBe(26);
    expect(V2_REGISTRY.filter((n) => lists.filter((l) => l.includes(n)).length !== 1)).toEqual([]);
  });
});

/** Each gated operation: the wrapped name, its inputs, and the canonical call it reads as. */
const UNWRAPS: Array<[string, Input, string, Input]> = [
  ["createJiraIssue", TICKET_V2, "createJiraIssue", { projectKey: "GK", issueTypeName: "Task", summary: TITLE, parent: EPIC, labels: [BE_TAG] }],
  ["createJiraIssue", TICKET_V1, "createJiraIssue", TICKET_V1],
  ["editJiraIssue", { issueIdOrKey: OWN, additional_fields: { summary: "S" } }, "editJiraIssue", { issueIdOrKey: OWN, fields: { summary: "S" } }],
  ["editJiraIssue", { issueIdOrKey: OWN, fields: { summary: "S" } }, "editJiraIssue", { issueIdOrKey: OWN, fields: { summary: "S" } }],
  ["transitionJiraIssue", { issueIdOrKey: OWN, transitionId: "41" }, "transitionJiraIssue", { issueIdOrKey: OWN, transition: { id: "41" } }],
  ["transitionJiraIssue", { issueIdOrKey: OWN, transition: { id: "41" } }, "transitionJiraIssue", { issueIdOrKey: OWN, transition: { id: "41" } }],
  ["addOrEditJiraIssueComment", { issueIdOrKey: OWN, commentBody: "x" }, "addCommentToJiraIssue", { issueIdOrKey: OWN, commentBody: "x" }],
  ["addCommentToJiraIssue", { issueIdOrKey: OWN, commentBody: "x" }, "addCommentToJiraIssue", { issueIdOrKey: OWN, commentBody: "x" }],
  ["addWorklogToJiraIssue", { issueIdOrKey: OWN, timeSpent: "1h" }, "addWorklogToJiraIssue", { issueIdOrKey: OWN, timeSpent: "1h" }],
  ["createIssueLink", { inwardIssue: OWN, outwardIssue: FOREIGN, type: "Relates" }, "createIssueLink", { inwardIssue: OWN, outwardIssue: FOREIGN, type: "Relates" }],
  ["addGraphContext", { objectIdentifier: OWN, targetObjectIdentifier: FOREIGN, relationshipType: "jira-work-item-links-jira-work-item" }, "addTeamworkGraphContext", { objectIdentifier: OWN, targetObjectIdentifier: FOREIGN, relationshipType: "jira-work-item-links-jira-work-item" }],
];

const deepFreeze = <T>(v: T): T => {
  if (v !== null && typeof v === "object") {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
};

describe("AC-STE-866.1 — canonicalAtlassianCall unwraps {name, inputs, cloudId}", () => {
  UNWRAPS.forEach(([name, inputs, tool, want], i) => {
    for (const [where, input] of [
      ["beside inputs", { name, inputs, cloudId: CLOUD }],
      ["inside inputs", { name, inputs: { ...inputs, cloudId: CLOUD } }],
      ["in both, equal", { name, inputs: { ...inputs, cloudId: CLOUD }, cloudId: CLOUD }],
    ] as Array<[string, Input]>) {
      test(`${i + 1}. executeWrite ${name} (${Object.keys(inputs).join(", ")}), cloudId ${where}`, async () => {
        expect(await canonical(WRITE, structuredClone(input))).toEqual({ tool, input: { ...want, cloudId: CLOUD }, unplaced: [] });
      });
    }
  });
  for (const wrapper of EXECUTE) {
    test(`${wrapper} unwraps alike, and a frozen input is not mutated`, async () => {
      const input = wrap("transitionJiraIssue", { issueIdOrKey: OWN, transitionName: "Done" });
      const c = await canonical(wrapper, deepFreeze(structuredClone(input)));
      expect({ tool: c.tool, input: c.input }).toEqual({ tool: "transitionJiraIssue", input: { cloudId: CLOUD, issueIdOrKey: OWN, transition: { name: "Done" } } });
    });
  }
});

describe("AC-STE-866.1 — the cloudId, through the gate", () => {
  const edit: Input = { issueIdOrKey: OWN, fields: { summary: "S" } };
  for (const server of SERVERS) {
    test(`REFUSE — two different cloudId values under ${server}`, async () => {
      expectRefusal(await ask(WRITE, wrap("editJiraIssue", { ...edit, cloudId: OTHER_CLOUD }), w.be, undefined, server), "cloudId");
    });
  }
  test("REFUSE — a decided create with two different cloudId values", async () => {
    expectRefusal(await ask(WRITE, wrap("createJiraIssue", { ...TICKET_V2, cloudId: OTHER_CLOUD }), w.be, ticketDecided(w)), "cloudId");
  });
  for (const [where, input] of [
    ["beside inputs", { name: "editJiraIssue", inputs: edit, cloudId: CLOUD }],
    ["inside inputs", { name: "editJiraIssue", inputs: { ...edit, cloudId: CLOUD } }],
    ["in both, equal", { name: "editJiraIssue", inputs: { ...edit, cloudId: CLOUD }, cloudId: CLOUD }],
  ] as Array<[string, Input]>) {
    test(`PERMIT — an owned edit, cloudId ${where}`, async () => {
      expectPermit(await ask(WRITE, input, w.be));
    });
    test(`TWIN — a foreign edit, cloudId ${where} → refused`, async () => {
      expectRefusal(await ask(WRITE, { ...input, inputs: { ...(input.inputs as Input), issueIdOrKey: FOREIGN } }, w.be), FOREIGN);
    });
  }
});

// ===========================================================================
// AC-STE-866.2 — the direct call's verdict, per operation
// ===========================================================================

interface Leg {
  name: string;
  op: string;
  permit: Input;
  refuse: Input;
  /** What the refusal names. */
  needle: string;
  t?: (w: World) => Transcript;
}
const onTicket = (op: string, rest: Input): Leg => ({ name: `${op} {${Object.keys(rest).join(", ")}}`, op, permit: { issueIdOrKey: OWN, ...rest }, refuse: { issueIdOrKey: FOREIGN, ...rest }, needle: FOREIGN });
const graph = (a: string, b: string): Input => ({ objectIdentifier: a, targetObjectIdentifier: b, relationshipType: "jira-work-item-links-jira-work-item" });
const LEGS: Leg[] = [
  { name: "create, v1 inputs", op: "createJiraIssue", permit: TICKET_V1, refuse: { ...TICKET_V1, additional_fields: { labels: ["other"] } }, needle: BE_TAG, t: ticketDecided },
  { name: "create, v2 inputs", op: "createJiraIssue", permit: TICKET_V2, refuse: { ...TICKET_V2, labels: ["other"] }, needle: BE_TAG, t: ticketDecided },
  { name: "Epic create, v2 inputs", op: "createJiraIssue", permit: EPIC_V2, refuse: { ...EPIC_V2, summary: "Another Epic" }, needle: "Another Epic", t: epicDecided },
  { name: "Epic close", op: "transitionJiraIssue", permit: { issueIdOrKey: EPIC, transitionId: "41" }, refuse: { issueIdOrKey: "GK-86", transitionId: "41" }, needle: "GK-86", t: closedTranscript },
  onTicket("editJiraIssue", { fields: { summary: "S" } }),
  onTicket("editJiraIssue", { additional_fields: { summary: "S" } }),
  onTicket("transitionJiraIssue", { transition: { id: "31" } }),
  onTicket("transitionJiraIssue", { transitionId: "31" }),
  onTicket("addCommentToJiraIssue", { commentBody: "Progress." }),
  onTicket("addOrEditJiraIssueComment", { commentBody: "Progress.", commentId: "10001" }),
  onTicket("addWorklogToJiraIssue", { timeSpent: "1h" }),
  { name: "issue link", op: "createIssueLink", permit: { inwardIssue: OWN, outwardIssue: FOREIGN, type: "Relates" }, refuse: { inwardIssue: FOREIGN_2, outwardIssue: FOREIGN, type: "Relates" }, needle: FOREIGN },
  { name: "graph link, v1 name", op: "addTeamworkGraphContext", permit: graph(OWN, FOREIGN), refuse: graph(FOREIGN_2, FOREIGN), needle: FOREIGN },
  { name: "graph link, v2 name", op: "addGraphContext", permit: graph(OWN, FOREIGN), refuse: graph(FOREIGN_2, FOREIGN), needle: FOREIGN },
];

describe("AC-STE-866.2 — a wrapped operation gets the direct call's verdict", () => {
  for (const l of LEGS) {
    const t = (): Transcript => l.t?.(w) ?? new Transcript();
    test(`CONTROL — ${l.name}: the direct pair permits and refuses`, async () => {
      expectPermit(await ask(l.op, { cloudId: CLOUD, ...l.permit }, w.be, t()));
      expectRefusal(await ask(l.op, { cloudId: CLOUD, ...l.refuse }, w.be, t()), l.needle);
    });
    for (const server of SERVERS) {
      test(`PERMIT — ${l.name}, wrapped under ${server}`, async () => {
        expectPermit(await ask(WRITE, wrap(l.op, l.permit), w.be, t(), server));
      });
      test(`REFUSE — ${l.name}, wrapped under ${server}`, async () => {
        expectRefusal(await ask(WRITE, wrap(l.op, l.refuse), w.be, t(), server), l.needle);
      });
    }
  }

  test("REFUSE — an undecided wrapped create", async () => {
    expectRefusal(await ask(WRITE, wrap("createJiraIssue", TICKET_V2), w.be), "create receipt");
  });
  test("REFUSE — a wrapped create naming two issue types, although decided", async () => {
    expectRefusal(await ask(WRITE, wrap("createJiraIssue", { ...TICKET_V2, issueTypeName: "Epic" }), w.be, ticketDecided(w)));
  });
  test("a wrapped write into a project no target binds passes, as the direct call does", async () => {
    const i: Input = { issueIdOrKey: "ZZ-9", fields: { summary: "S" } };
    expectSilent(await ask("editJiraIssue", { cloudId: CLOUD, ...i }, w.be));
    expectSilent(await ask(WRITE, wrap("editJiraIssue", i), w.be));
  });

  for (const [k, v] of [["issueIdOrKey", OWN], ["fields", { summary: "T" }], ["projectKey", "GK"], ["actionSource", "model_tool_call"], ["frobnicate", "x"]] as const) {
    test(`REFUSE — an owned write with the extra wrapper key ${k}`, async () => {
      expectRefusal(await ask(WRITE, wrap("editJiraIssue", { issueIdOrKey: OWN, fields: { summary: "S" } }, { [k]: v }), w.be), k);
    });
  }
  test("REFUSE — a decided create with an extra wrapper key", async () => {
    expectRefusal(await ask(WRITE, wrap("createJiraIssue", TICKET_V2, { additional_fields: { labels: ["x"] } }), w.be, ticketDecided(w)), "additional_fields");
  });
  test("a wrapper's issueIdOrKey never stands in for the inputs'", async () => {
    expectRefusal(await ask(WRITE, wrap("editJiraIssue", { issueIdOrKey: FOREIGN, fields: { summary: "S" } }, { issueIdOrKey: OWN }), w.be));
  });
});

// ===========================================================================
// AC-STE-866.3 — an operation the gate cannot place
// ===========================================================================

/** Payloads refused under a declared target: title, input, what the refusal names. */
const UNPLACEABLE: Array<[string, Input, string | null]> = [
  ...[
    "deleteJiraIssue", "bulkEditJiraIssues", "frobnicate", "CREATEJIRAISSUE", "EditJiraIssue", " editJiraIssue ", "getjiraissue",
    "mcp__atlassian__editJiraIssue", "save_issue", "merge_diff", "constructor", "toString", "__proto__", "hasOwnProperty",
  ].map((n): [string, Input, string] => [`unknown name ${JSON.stringify(n)}`, wrap(n, { issueIdOrKey: OWN }), n.trim()]),
  ["no name", { inputs: { issueIdOrKey: OWN }, cloudId: CLOUD }, null],
  ["empty name", wrap("", { issueIdOrKey: OWN }), null],
  ["null name", wrap(null, { issueIdOrKey: OWN }), null],
  ["numeric name", wrap(7, { issueIdOrKey: OWN }), null],
  ["array name", wrap(["editJiraIssue"], { issueIdOrKey: OWN }), null],
  ["object name", wrap({ name: "getJiraIssue" }, { issueIdOrKey: OWN }), null],
  ["no inputs", { name: "editJiraIssue", cloudId: CLOUD }, "editJiraIssue"],
  ["null inputs", wrap("editJiraIssue", null), "editJiraIssue"],
  ["string inputs", wrap("editJiraIssue", JSON.stringify({ issueIdOrKey: OWN })), "editJiraIssue"],
  ["array inputs", wrap("editJiraIssue", [{ issueIdOrKey: OWN }]), "editJiraIssue"],
  ["numeric inputs", wrap("editJiraIssue", 3), "editJiraIssue"],
  ["string inputs of a create", wrap("createJiraIssue", "{}"), "createJiraIssue"],
  ["an empty call", {}, null],
];
/** Placeable writes whose wrapper is refused for another reason. */
const MALFORMED: Array<[string, Input]> = [
  ["two cloudIds", wrap("editJiraIssue", { issueIdOrKey: OWN, cloudId: OTHER_CLOUD })],
  ["an extra wrapper key", wrap("editJiraIssue", { issueIdOrKey: OWN }, { frobnicate: 1 })],
  ["a nested execute", wrap("executeWrite", wrap("editJiraIssue", { issueIdOrKey: OWN }))],
];

describe("AC-STE-866.3 — in a declared repository an unplaceable operation is refused, naming it", () => {
  for (const [title, input, needle] of UNPLACEABLE) {
    for (const wrapper of EXECUTE) {
      test(`REFUSE — ${wrapper}: ${title}`, async () => {
        expectRefusal(await ask(wrapper, input, w.be), needle ?? wrapper);
      });
    }
  }
  test("REFUSE — an unknown operation under the second server spelling", async () => {
    expectRefusal(await ask(WRITE, wrap("frobnicate", {}), w.be, undefined, "claude_ai_Atlassian"), "frobnicate");
  });
  test("REFUSE — an unknown operation naming only an unbound project: it carries no container", async () => {
    expectRefusal(await ask(WRITE, wrap("frobnicate", { projectKey: "ZZ" }), w.be), "frobnicate");
  });
  test("REFUSE — from an undeclared directory, when a deciding run announced a receipt in a declared repository", async () => {
    const undeclared = bareRepo("announced", null);
    expectRefusal(await ask(WRITE, wrap("frobnicate", {}), undeclared, ticketDecided(w)), "frobnicate");
  });
});

describe("AC-STE-866.3 — with no declared Jira target the same payloads pass in silence", () => {
  const repos: Array<[string, string]> = [];
  beforeAll(() => {
    repos.push(["no CLAUDE.md", bareRepo("none", null)]);
    repos.push(["Jira without a tag", bareRepo("untagged", (r) => declareJira(r, null))]);
    repos.push(["a shared Linear target", bareRepo("linear", (r) => declareLinear(r, BE_TAG))]);
  });
  const payloads: Array<[string, Input]> = [...UNPLACEABLE.map(([t, i]): [string, Input] => [t, i]), ...MALFORMED, ["a foreign edit", wrap("editJiraIssue", { issueIdOrKey: FOREIGN })]];
  for (const [title, input] of payloads) {
    test(`SILENT — ${title}, in every undeclared repository and under every wrapper`, async () => {
      expect(repos.length).toBe(3);
      const runs = await Promise.all(repos.flatMap(([label, root]) => EXECUTE.map(async (x) => ({ label, x, r: await ask(x, input, root) }))));
      expect(runs.map(({ label, x, r }) => ({ label, x, exit: r.exitCode, out: r.stdout, err: r.stderr }))).toEqual(runs.map(({ label, x }) => ({ label, x, exit: 0, out: "", err: "" })));
    });
  }
});

describe("AC-STE-866.3 — the off-switch speaks for a wrapped write as for a direct one", () => {
  const OFF = { CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE: "off" };
  const SAYS = "tracker write gate off for this user";
  const foreign: Input = { issueIdOrKey: FOREIGN, fields: { summary: "S" } };
  test("CONTROL — the direct foreign edit is permitted, loudly", async () => {
    const r = await drive("editJiraIssue", { cloudId: CLOUD, ...foreign }, w.be, new Transcript(), OFF);
    expectPermit(r);
    expect(r.stderr).toContain(SAYS);
  });
  for (const [title, input] of [["a wrapped foreign edit", wrap("editJiraIssue", foreign)], ["an unknown operation", wrap("frobnicate", {})]] as Array<[string, Input]>) {
    test(`${title} is permitted, loudly, in a declared repository`, async () => {
      const r = await drive(WRITE, input, w.be, new Transcript(), OFF);
      expectPermit(r);
      expect(r.stderr).toContain(SAYS);
    });
    test(`${title} stays silent in an undeclared repository`, async () => {
      expectSilent(await drive(WRITE, input, bareRepo("off", null), new Transcript(), OFF));
    });
  }
  test("a wrapped known read stays silent in a declared repository with the gate off", async () => {
    expectSilent(await drive(READ, wrap("getJiraIssue", { issueIdOrKey: FOREIGN }), w.be, new Transcript(), OFF));
  });
});

// ===========================================================================
// AC-STE-866.4 — listed non-Jira writes
// ===========================================================================

const V1_NON_JIRA = [
  "createCompassComponent", "createCompassComponentRelationship", "createCompassCustomFieldDefinition", "createConfluenceFooterComment",
  "createConfluenceInlineComment", "createConfluencePage", "updateConfluencePage",
] as const;

describe("AC-STE-866.4 — a listed non-Jira write passes in a declared container", () => {
  for (const op of [...V1_NON_JIRA, ...V2_CONFLUENCE_WRITES]) {
    test(`SILENT — executeWrite and executeRead: ${op}`, async () => {
      for (const wrapper of [WRITE, READ]) expectSilent(await ask(wrapper, wrap(op, { title: "Notes", body: "Text" }), w.be));
    });
  }
  test("the v2 Confluence names carry a one-line reason", async () => {
    const m = await hook();
    for (const n of V2_CONFLUENCE_WRITES) {
      expect(m.UNGATED_WRITE_TOOLS).toHaveProperty(n);
      expect(m.UNGATED_WRITE_TOOLS[n]!.trim().length).toBeGreaterThan(0);
      expect(m.UNGATED_WRITE_TOOLS[n]).not.toContain("\n");
    }
  });
  test("the Atlassian entries are exactly the Confluence and Compass names, and no Jira operation is listed", async () => {
    const names = Object.keys((await hook()).UNGATED_WRITE_TOOLS);
    expect(names.filter((n) => /confluence|compass/i.test(n)).sort()).toEqual([...V1_NON_JIRA, ...V2_CONFLUENCE_WRITES].sort());
    // Linear's names are snake_case; an Atlassian name holds no underscore.
    expect(names.filter((n) => !n.includes("_") && !/confluence|compass/i.test(n))).toEqual([]);
    expect(names.filter((n) => /jira|issue|worklog|graph(?:context|object)/i.test(n))).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-866.5 — the operation decides, not the wrapper
// ===========================================================================

describe("AC-STE-866.5 — executeDestructive naming a Jira operation is always refused", () => {
  for (const l of LEGS) {
    test(`REFUSE — ${l.name}, although its executeWrite twin is permitted`, async () => {
      expectRefusal(await ask(DESTRUCTIVE, wrap(l.op, l.permit), w.be, l.t?.(w) ?? new Transcript()), DESTRUCTIVE, l.op);
    });
  }
});

describe("AC-STE-866.5 — a write named under executeRead is graded as that write", () => {
  for (const l of LEGS) {
    test(`PERMIT — ${l.name}`, async () => {
      expectPermit(await ask(READ, wrap(l.op, l.permit), w.be, l.t?.(w) ?? new Transcript()));
    });
    test(`REFUSE — ${l.name}`, async () => {
      expectRefusal(await ask(READ, wrap(l.op, l.refuse), w.be, l.t?.(w) ?? new Transcript()), l.needle);
    });
  }
  test("responseFields and view are wrapper keys: they change no verdict", async () => {
    const keys = { responseFields: ["key"], view: "summary" };
    expectPermit(await ask(READ, wrap("editJiraIssue", { issueIdOrKey: OWN, fields: { summary: "S" } }, keys), w.be));
    expectRefusal(await ask(READ, wrap("editJiraIssue", { issueIdOrKey: FOREIGN, fields: { summary: "S" } }, keys), w.be), FOREIGN);
  });
});

describe("AC-STE-866.5 — a known read passes under any wrapper", () => {
  const V1_READS = ["getJiraIssue", "searchJiraIssuesUsingJql", "getTransitionsForJiraIssue", "search", "fetch", "atlassianUserInfo", "lookupJiraAccountId", "getConfluencePage"];
  for (const op of [...V1_READS, ...V2_READS]) {
    test(`SILENT — ${op}`, async () => {
      const runs = await Promise.all(EXECUTE.map((x) => ask(x, wrap(op, { issueIdOrKey: FOREIGN }), w.be)));
      for (const r of runs) expectSilent(r);
    });
  }
  test("SILENT — the recorded wrapped read", async () => {
    expectSilent(
      await ask(READ, wrap("searchJiraIssuesUsingJql", { fields: ["summary"], jql: "project = GK", maxResults: 10, responseContentFormat: "markdown" }, { view: "full", responseFields: ["key"] }), w.be),
    );
  });
});

// ===========================================================================
// AC-STE-866.6 — the transcript walk
// ===========================================================================

type Spelling = "direct" | "executeWrite" | "executeRead";
const spelled = (how: Spelling, op: string, inputs: Input): [string, Input] => (how === "direct" ? [op, { cloudId: CLOUD, ...inputs }] : [how, wrap(op, inputs)]);
const PAIRS: Array<[Spelling, Spelling]> = [
  ["direct", "direct"],
  ["executeWrite", "direct"],
  ["direct", "executeWrite"],
  ["executeWrite", "executeWrite"],
  ["executeRead", "direct"],
];
const MADE = { key: "GK-150", id: "10150" };

describe("AC-STE-866.6 — the walk counts a wrapped create exactly as a direct one", () => {
  /** The gated create after `record` put an earlier one into the transcript. */
  async function second(first: Spelling, gated: Spelling, op: Input, t: Transcript, record: (t: Transcript, name: string, input: Input) => void): Promise<Run> {
    const [tool, input] = spelled(first, "createJiraIssue", op);
    record(t, jira(tool), input);
    const [gTool, gInput] = spelled(gated, "createJiraIssue", op);
    return ask(gTool, gInput, w.be, t);
  }
  for (const [first, gated] of PAIRS) {
    const tag = `${first} then ${gated}`;
    test(`${tag}: a create that returned its key settles the ticket`, async () => {
      expectRefusal(await second(first, gated, TICKET_V2, ticketDecided(w), (t, n, i) => t.tool(n, i, MADE)), MADE.key, "returned");
    });
    test(`${tag}: an Epic create that returned its key settles the container`, async () => {
      expectRefusal(await second(first, gated, EPIC_V2, epicDecided(w), (t, n, i) => t.tool(n, i, MADE)), MADE.key);
    });
    test(`${tag}: a create that timed out may have made its ticket`, async () => {
      expectRefusal(await second(first, gated, TICKET_V2, ticketDecided(w), (t, n, i) => t.tool(n, i, "Request timed out", true)), "may have made the ticket");
    });
    test(`${tag}: a create answering 500 may have made its ticket`, async () => {
      expectRefusal(await second(first, gated, TICKET_V2, ticketDecided(w), (t, n, i) => t.tool(n, i, "Error: status 500", true)), "may have made the ticket");
    });
    test(`${tag}: a create naming no key may have made its ticket`, async () => {
      expectRefusal(await second(first, gated, TICKET_V2, ticketDecided(w), (t, n, i) => t.tool(n, i, { ok: true })), "may have made the ticket");
    });
    test(`${tag}: a create with no result yet may have made its ticket`, async () => {
      expectRefusal(await second(first, gated, TICKET_V2, ticketDecided(w), (t, n, i) => void t.use(n, i)), "no result");
    });
    test(`${tag}: a create the tracker refused with 400 spent nothing`, async () => {
      expectPermit(await second(first, gated, TICKET_V2, ticketDecided(w), (t, n, i) => t.tool(n, i, "Error: status 400 Bad Request", true)));
    });
    test(`${tag}: a pending create spends the receipt of a lone later call`, async () => {
      const t = ticketDecided(w);
      const [tool, input] = spelled(first, "createJiraIssue", TICKET_V2);
      t.use(jira(tool), input);
      const [gTool, gInput] = spelled(gated, "createJiraIssue", TICKET_V2);
      expectRefusal(await drive(gTool, gInput, w.be, t), "is spent");
    });
  }

  for (const first of ["direct", "executeWrite"] as const) {
    for (const gated of ["direct", "executeWrite"] as const) {
      test(`a ticket a ${first} create made is owned: a ${gated} edit of it is permitted`, async () => {
        const t = ticketDecided(w);
        const [tool, input] = spelled(first, "createJiraIssue", TICKET_V2);
        t.tool(jira(tool), input, MADE);
        const [gTool, gInput] = spelled(gated, "editJiraIssue", { issueIdOrKey: MADE.key, fields: { summary: "S" } });
        expectPermit(await ask(gTool, gInput, w.be, t));
      });
    }
  }
  test("TWIN — the same wrapped edit with no such create is refused", async () => {
    expectRefusal(await ask(WRITE, wrap("editJiraIssue", { issueIdOrKey: MADE.key, fields: { summary: "S" } }), w.be, ticketDecided(w)), MADE.key);
  });
  test("a wrapped create of another title is no prior create", async () => {
    const t = ticketDecided(w);
    t.tool(jira(WRITE), wrap("createJiraIssue", { ...TICKET_V2, summary: "Something else" }), MADE);
    expectPermit(await ask(WRITE, wrap("createJiraIssue", TICKET_V2), w.be, t));
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
/** The verdict without `unclassified-tool`, which grades the tool inventory and not the gate. */
const verdictOf = (v: Verdict) => ({ findings: v.findings.filter((f) => f.code !== "unclassified-tool"), scenarios: v.scenarios });

let callSeq = 0;
function appendCall(s: BundleSession, name: string, input: Input, result?: ToolCall["result"]): ToolCall {
  callSeq += 1;
  const c: ToolCall = {
    ref: `${s.sessionId}:toolu_866_${callSeq}`,
    at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
    name: serverPrefix("jira", s.root) + name,
    input,
    result: result ?? { isError: false, text: "", exitCode: null, items: [], lastPage: null },
    sidechain: false,
  };
  s.calls.push(c);
  return c;
}
function marked(b: LiveBundle, marker: string, root?: "A" | "B"): BundleSession {
  const s = b.sessions.find((x) => x.marker === marker && (root === undefined || x.root === root));
  if (!s) throw new Error(`fixture: no ${marker} session`);
  return s;
}

const WRITE_TOOLS = ["createJiraIssue", "editJiraIssue", "transitionJiraIssue", "addCommentToJiraIssue", "addWorklogToJiraIssue", "createIssueLink"];
/** The execute spelling of one recorded write, in place; true when it was one. */
function wrapCall(c: { name: string; input: Input }): boolean {
  const tool = c.name.split("__").at(-1)!;
  if (!c.name.startsWith("mcp__") || !WRITE_TOOLS.includes(tool)) return false;
  const { cloudId, ...inputs } = c.input;
  c.name = c.name.slice(0, c.name.length - tool.length) + WRITE;
  c.input = { name: tool, inputs, ...(cloudId === undefined ? {} : { cloudId }) };
  return true;
}

describe("AC-STE-866.6 — the live grader reads a wrapped bundle as the direct one", () => {
  test("a whole passing Jira bundle with every write wrapped draws the same findings and scenarios", async () => {
    const direct = buildPassingBundle("jira");
    const wrapped = clone(direct);
    expect(wrapped.sessions.flatMap((s) => s.calls.filter(wrapCall)).length).toBeGreaterThan(5);
    const [a, b] = [await grade(direct), await grade(wrapped)];
    expect(a.outcome).toBe("pass");
    expect(verdictOf(b)).toEqual(verdictOf(a));
  });

  test("the same records, extracted from transcripts of wrapped calls, keep each created item", async () => {
    const bundle = buildPassingBundle("jira");
    const dir = tempDir("records");
    const m = materialize(bundle, dir);
    const extract = async (): Promise<LiveBundle> => {
      const x = (await grader()).extractBundle({
        configDirs: [m.configDir],
        ledgerSessionIds: m.ledger,
        roots: { A: { path: m.roots.A, tag: bundle.roots.A.tag }, B: { path: m.roots.B, tag: bundle.roots.B.tag } },
        run: m.run,
        synthetic: true,
      });
      if (!x.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(x.verdict)}`);
      return x.bundle;
    };
    const items = (b: LiveBundle): unknown[] => b.sessions.flatMap((s) => s.calls.filter((c) => c.name.startsWith("mcp__")).map((c) => ({ ref: c.ref, items: c.result.items })));
    const before = await extract();
    let wraps = 0;
    for (const f of readdirSync(m.configDir, { recursive: true, encoding: "utf-8" }).filter((n) => n.endsWith(".jsonl"))) {
      const path = join(m.configDir, f);
      const lines = readFileSync(path, "utf-8").trimEnd().split("\n").map((l) => {
        const r = JSON.parse(l) as { message?: { content?: unknown } };
        const blocks = Array.isArray(r.message?.content) ? (r.message.content as Array<{ type: string; name: string; input: Input }>) : [];
        for (const x of blocks) if (x.type === "tool_use" && wrapCall(x)) wraps += 1;
        return JSON.stringify(r);
      });
      writeFileSync(path, `${lines.join("\n")}\n`);
    }
    expect(wraps).toBeGreaterThan(5);
    const after = await extract();
    expect(items(after)).toEqual(items(before));
    expect(verdictOf(await grade(after))).toEqual(verdictOf(await grade(before)));
  });

  test("the recorded bundle is not mutated by grading", async () => {
    const b = buildPassingBundle("jira");
    b.sessions.forEach((s) => s.calls.forEach(wrapCall));
    const before = JSON.stringify(b);
    const v = await grade(b);
    expect(v.findings.filter((f) => f.code === "ungated-write")).toEqual([]);
    expect(v.scenarios).toEqual((await grade(buildPassingBundle("jira"))).scenarios);
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe("AC-STE-866.6 — the live grader reports an ungated wrapped write", () => {
  /** One successful call appended to S13, on a ticket S13's repository owns or not. True = ungated. */
  async function graded(tool: string, input: (key: string) => Input, owned: boolean): Promise<boolean> {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const key = `${b.run.container}-890`;
    if (owned) b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key, milestone: null });
    const c = appendCall(s, tool, input(key));
    return ungated(await grade(b), c);
  }
  const OPS: Array<[string, (k: string) => Input]> = [
    ["editJiraIssue", (k) => ({ issueIdOrKey: k, fields: { summary: "S" } })],
    ["transitionJiraIssue", (k) => ({ issueIdOrKey: k, transitionId: "31" })],
    ["addOrEditJiraIssueComment", (k) => ({ issueIdOrKey: k, commentBody: "x" })],
    ["addCommentToJiraIssue", (k) => ({ issueIdOrKey: k, commentBody: "x" })],
    ["addWorklogToJiraIssue", (k) => ({ issueIdOrKey: k, timeSpent: "1h" })],
    ["createIssueLink", (k) => ({ inwardIssue: k, outwardIssue: `${k}1`, type: "Relates" })],
    ["addGraphContext", (k) => graph(k, `${k}1`)],
  ];
  for (const [op, input] of OPS) {
    for (const wrapper of [WRITE, READ]) {
      test(`${wrapper} ${op}: gated when the ticket is owned`, async () => {
        expect(await graded(wrapper, (k) => wrap(op, input(k)), true)).toBe(false);
      });
      test(`${wrapper} ${op}: ungated-write when it is not`, async () => {
        expect(await graded(wrapper, (k) => wrap(op, input(k)), false)).toBe(true);
      });
    }
    test(`executeDestructive ${op}: ungated-write although the ticket is owned`, async () => {
      expect(await graded(DESTRUCTIVE, (k) => wrap(op, input(k)), true)).toBe(true);
    });
  }
  for (const [title, input] of UNPLACEABLE) {
    test(`${title}: ungated-write, under every wrapper`, async () => {
      const got = await Promise.all(EXECUTE.map((x) => graded(x, () => input, true)));
      expect(got).toEqual([true, true, true]);
    });
  }
  const edit = (k: string): Input => ({ issueIdOrKey: k, fields: { summary: "S" } });
  test("two different cloudIds on an owned ticket: ungated-write", async () => {
    expect(await graded(WRITE, (k) => wrap("editJiraIssue", { ...edit(k), cloudId: OTHER_CLOUD }), true)).toBe(true);
  });
  test("an extra wrapper key on an owned ticket: ungated-write", async () => {
    expect(await graded(WRITE, (k) => wrap("editJiraIssue", edit(k), { frobnicate: 1 }), true)).toBe(true);
  });
  test("an operation nested in an execute operation on an owned ticket: ungated-write", async () => {
    expect(await graded(WRITE, (k) => wrap(WRITE, wrap("editJiraIssue", edit(k))), true)).toBe(true);
  });
  for (const op of [...V1_NON_JIRA, ...V2_CONFLUENCE_WRITES]) {
    test(`executeWrite ${op} is no ungated write`, async () => {
      expect(await graded(WRITE, () => wrap(op, { title: "Notes" }), false)).toBe(false);
    });
  }
  for (const op of ["getJiraIssue", ...V2_READS]) {
    test(`${op} is no ungated write under any wrapper`, async () => {
      const got = await Promise.all(EXECUTE.map((x) => graded(x, (k) => wrap(op, { issueIdOrKey: k }), false)));
      expect(got).toEqual([false, false, false]);
    });
  }
  test("a wrapped write the hook refused (an error result) is no ungated write", async () => {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const c = appendCall(s, WRITE, wrap("frobnicate", {}), { isError: true, text: "PreToolUse:mcp__atlassian__executeWrite hook error: Refusing: x", exitCode: null, items: null, lastPage: null });
    expect(ungated(await grade(b), c)).toBe(false);
  });

  for (const [first, again] of PAIRS) {
    test(`a decided create made ${first}, then again ${again}: the second is an ungated write`, async () => {
      const b = buildPassingBundle("jira");
      const s = marked(b, "S1", "A");
      const made = s.calls.find((c) => c.name.endsWith("__createJiraIssue"));
      if (!made) throw new Error("fixture: S1 A holds no create");
      const { cloudId, ...inputs } = made.input;
      const re = (how: Spelling): [string, Input] => (how === "direct" ? ["createJiraIssue", { cloudId, ...inputs }] : [how, { name: "createJiraIssue", inputs, cloudId }]);
      const [tool, input] = re(first);
      made.name = serverPrefix("jira", s.root) + tool;
      made.input = input;
      const [tool2, input2] = re(again);
      const dup = appendCall(s, tool2, input2, clone(made.result));
      const v = await grade(b);
      expect({ first: ungated(v, made), second: ungated(v, dup) }).toEqual({ first: false, second: true });
    });
  }
  test("an undecided wrapped create is an ungated write", async () => {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const c = appendCall(s, WRITE, wrap("createJiraIssue", { projectKey: b.run.container, issueType: "Task", summary: "Undecided", labels: [b.roots[s.root].tag] }));
    expect(ungated(await grade(b), c)).toBe(true);
  });
});

// ===========================================================================
// AC-STE-866.7 — never unwrapped twice
// ===========================================================================

describe("AC-STE-866.7 — an operation nested in another execute operation", () => {
  const inner: Array<[string, Input]> = [
    ["editJiraIssue", { issueIdOrKey: OWN, fields: { summary: "S" } }],
    ["getJiraIssue", { issueIdOrKey: OWN }],
    ["createConfluencePage", { title: "Notes" }],
  ];
  for (const outer of EXECUTE) {
    for (const mid of EXECUTE) {
      for (const [op, inputs] of inner) {
        const nested = wrap(mid, wrap(op, inputs));
        test(`REFUSE — ${outer} naming ${mid} naming ${op}`, async () => {
          expectRefusal(await ask(outer, nested, w.be), mid);
        });
      }
      test(`${outer} naming ${mid} is not read as the inner call`, async () => {
        // The control: one level does unwrap.
        expect((await canonical(outer, wrap("editJiraIssue", { issueIdOrKey: OWN }))).tool).toBe("editJiraIssue");
        expect((await canonical(outer, wrap(mid, wrap("editJiraIssue", { issueIdOrKey: OWN })))).tool).not.toBe("editJiraIssue");
      });
    }
  }
  test("a nested create is no prior create: the decided create is still permitted", async () => {
    const t = ticketDecided(w);
    t.tool(jira(WRITE), wrap(WRITE, wrap("createJiraIssue", TICKET_V2)), "PreToolUse:mcp__atlassian__executeWrite hook error: Refusing: nested", true);
    expectPermit(await ask(WRITE, wrap("createJiraIssue", TICKET_V2), w.be, t));
    expectRefusal(await ask(WRITE, wrap("createJiraIssue", { ...TICKET_V2, labels: ["other"] }), w.be, t), BE_TAG);
  });
});

describe("AC-STE-866.6 — the grader's copies of the hook's lists are the hook's lists", () => {
  test("the Atlassian read and ungated-write names are equal, and neither holds a gated write", async () => {
    const hook = (await import("../templates/hooks/_lib/hooks/pre-tracker-write-gate.ts")) as unknown as {
      TRACKER_READ_TOOLS: readonly string[];
      UNGATED_WRITE_TOOLS: Readonly<Record<string, string>>;
      TRACKER_WRITE_TOOLS: readonly string[];
    };
    const g = (await import("../adapters/_shared/src/shared_tracker_live_grader.ts")) as unknown as {
      ATLASSIAN_READ_TOOL_NAMES: readonly string[];
      ATLASSIAN_UNGATED_WRITE_TOOL_NAMES: readonly string[];
    };
    const atlassian = (names: readonly string[]): string[] => names.filter((n) => !n.includes("_")).sort();
    expect([...g.ATLASSIAN_READ_TOOL_NAMES].sort()).toEqual(atlassian(hook.TRACKER_READ_TOOLS));
    expect([...g.ATLASSIAN_UNGATED_WRITE_TOOL_NAMES].sort()).toEqual(atlassian(Object.keys(hook.UNGATED_WRITE_TOOLS)));
    const both = [...g.ATLASSIAN_READ_TOOL_NAMES, ...g.ATLASSIAN_UNGATED_WRITE_TOOL_NAMES];
    expect(hook.TRACKER_WRITE_TOOLS.filter((t) => both.includes(t))).toEqual([]);
  });
});
