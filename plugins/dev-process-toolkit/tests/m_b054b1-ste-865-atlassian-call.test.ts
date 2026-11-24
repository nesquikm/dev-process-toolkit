// STE-865 (M_b054b1) — one translator reads every Atlassian write shape.
//
// The module under test is adapters/_shared/src/atlassian_call.ts:
//
//   canonicalAtlassianCall(tool, input) → { tool, input, unplaced }
//
// `tool` is the bare name; the answer speaks the v1 vocabulary
// (addCommentToJiraIssue, issueTypeName, transition, fields). The tracker-write
// gate and its live grader read only that answer.
//
// Gate legs run the SHIPPED `.sh` wrapper on a recorded PreToolUse payload over
// the STE-699 world (a shipped Epic GK-85, two repositories sharing project
// GK); grader legs append the same calls to a passing live bundle.
//
// Invented keys and sites only (GK-*, PROJ-*, example.invalid).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { RECEIPT_ANNOUNCEMENT_PREFIX, announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { commitAll, git } from "./_span_fixture";
import { BE_TAG, FE_TAG, boundFr, declareJira } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import { buildPassingBundle, clone, serverPrefix, type BundleSession, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";
import {
  EDIT_LABEL,
  EPIC as EDIT_EPIC,
  SESSION,
  Transcript,
  askEdit,
  cleanupTemps as cleanupFixtureTemps,
  editedTranscript,
  gate,
  makeWorld as makeEditWorld,
  permitProblem,
  refusalProblem,
  runModule,
  show,
  type ModuleRun,
  type Run,
} from "./_m_b2fdc0_ste729_fixture";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const CALL_PATH = join(SRC, "atlassian_call.ts");
const OWNERSHIP_PATH = join(SRC, "join_consent_ownership.ts");
const GRADER_PATH = join(SRC, "shared_tracker_live_grader.ts");
const HOOK_PATH = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", "pre-tracker-write-gate.ts");
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");

const EPIC = "GK-85";
const OTHER_EPIC = "GK-86";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const VERSION = "1.2.0";
const CLOUD = "example.invalid";
const OWN = "GK-112"; // bound by a tracked FR of glade-be
const FOREIGN = "GK-101"; // glade-fe's
const SERVERS = ["atlassian", "claude_ai_Atlassian"] as const;
const browse = (key: string): string => `https://${CLOUD}/browse/${key}`;

type Input = Record<string, unknown>;
interface Canonical {
  tool: string;
  input: Input;
  unplaced: string[];
}
interface CallModule {
  canonicalAtlassianCall: (tool: string, input: Input) => Canonical;
}
interface OwnershipModule {
  isStatusOnlyTransition: (input: Input) => boolean;
  labelsEnvelope: (input: unknown) => { extraKeys: string[] } | null;
}
const callModule = async (path = CALL_PATH): Promise<CallModule> => (await import(path)) as CallModule;
const ownership = async (path = OWNERSHIP_PATH): Promise<OwnershipModule> => (await import(path)) as OwnershipModule;

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-865-${label}-`)));
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

/** The STE-699 world: BE planned and shipped M_GK_85; `bound` keys are bound by tracked FRs of BE. */
function makeWorld(bound: string[] = []): World {
  const parent = tempDir("world");
  const be = join(parent, BE_TAG);
  const fe = join(parent, FE_TAG);
  mkdirSync(be, { recursive: true });
  mkdirSync(fe, { recursive: true });
  declareJira(be, BE_TAG);
  declareJira(fe, FE_TAG);
  writePlan(be, "archive", MILESTONE, { [BE_TAG]: ".", [FE_TAG]: `../${FE_TAG}` }, { shippedIn: `v${VERSION}` });
  writeFr(be, "GK-111", MILESTONE, "archived");
  for (const k of bound) boundFr(be, k);
  writeFileSync(join(be, "CHANGELOG.md"), ["# Changelog", "", `## [${VERSION}] — 2026-11-01 — "Close Out"`, "", "### Fixed", "", "- The milestone shipped.", ""].join("\n"));
  writePlan(fe, "archive", MILESTONE, { [BE_TAG]: `../${BE_TAG}`, [FE_TAG]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, FOREIGN, MILESTONE, "archived");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  return { be, scratch: tempDir("scratch") };
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

/** A transcript holding the REAL epic_close.ts run that announced GK-85's receipt. */
function closedTranscript(w: World): Transcript {
  const listing = join(w.scratch, "children.json");
  writeFileSync(listing, JSON.stringify({ issues: [child(FOREIGN, FE_TAG), child("GK-111", BE_TAG)], isLast: true }));
  const r: ModuleRun = runModule(PLUGIN_ROOT, "epic_close.ts", [w.be, EPIC, "--children", listing]);
  const lines = r.stdout.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));
  if (r.exitCode !== 0 || lines.length !== 1) throw new Error(`fixture: epic_close.ts did not permit:\n${show(r)}`);
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

const jira = (tool: string, server: string = "atlassian"): string => `mcp__${server}__${tool}`;

function expectPermit(r: Run): void {
  expect(permitProblem(r), show(r)).toBeNull();
}
function expectRefusal(r: Run, ...needles: string[]): void {
  expect(refusalProblem(r), show(r)).toBeNull();
  for (const n of needles) expect(r.stderr).toContain(n);
}

// ------------------------------------------------------------ grader bundles

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
}
async function grade(b: LiveBundle): Promise<Verdict> {
  const g = (await import(GRADER_PATH)) as GraderModule;
  return g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
}
const ungated = (v: Verdict, c: ToolCall): boolean => v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${c.ref}:`));

const sha256Hex = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");
let callSeq = 0;
function appendCall(s: BundleSession, name: string, input: Input, result: ToolCall["result"]): ToolCall {
  callSeq += 1;
  const c: ToolCall = { ref: `${s.sessionId}:toolu_865_${callSeq}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name, input, result, sidechain: false };
  s.calls.push(c);
  return c;
}
const okResult = (text = ""): ToolCall["result"] => ({ isError: false, text, exitCode: null, items: [], lastPage: null });

function marked(b: LiveBundle, marker: string, root?: "A" | "B"): BundleSession {
  const s = b.sessions.find((x) => x.marker === marker && (root === undefined || x.root === root));
  if (!s) throw new Error(`fixture: no ${marker} session`);
  return s;
}

function appendReceipt(b: LiveBundle, s: BundleSession, kind: "epic-close" | "epic-edit", key: string, text = ""): void {
  callSeq += 1;
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/${kind}-${callSeq}.json`;
  const set = b.repos[s.root].receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  set.records.push({
    path,
    sessionId: s.sessionId,
    sha256: sha256Hex(path),
    kind,
    adapter: b.run.tracker,
    container: kind === "epic-close" ? b.run.container : null,
    subject: key,
    decision: kind === "epic-close" ? "close" : "edit",
    evidence: { key, milestone: milestoneIdFromEpicKey(key) },
  });
  const module = kind === "epic-close" ? "epic_close.ts" : "epic_edit.ts";
  const tail = kind === "epic-close" ? ` --children <${s.root}>/.dpt/tmp/children.json` : "";
  appendCall(
    s,
    "Bash",
    { command: `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${module}" <${s.root}> ${key}${tail}`, description: "run" },
    { isError: false, text: `${text}dpt-receipt: ${path} sha256:${sha256Hex(path)}`, exitCode: 0, items: null, lastPage: null },
  );
}

const appendWrite = (s: BundleSession, tool: string, input: Input): ToolCall => appendCall(s, serverPrefix("jira", s.root) + tool, input, okResult());

/** Grade one transition in S13; the epic-close receipt names `receiptFor(key)`, or there is none. True = ungated. */
async function gradeClose(shape: Input, receiptFor: ((key: string) => string) | null): Promise<boolean> {
  const b = buildPassingBundle("jira");
  const s = marked(b, "S13");
  const key = `${b.run.container}-870`;
  if (receiptFor) appendReceipt(b, s, "epic-close", receiptFor(key));
  const w = appendWrite(s, "transitionJiraIssue", { cloudId: "cloud-dst", issueIdOrKey: key, ...shape });
  return ungated(await grade(b), w);
}

/** Grade one consented Epic edit in S13. True = ungated. */
async function gradeEdit(shape: Input): Promise<boolean> {
  const b = buildPassingBundle("jira");
  const s = marked(b, "S13");
  const key = `${b.run.container}-880`;
  appendReceipt(b, s, "epic-edit", key, `default=forbidden\noptions=${JSON.stringify([`Edit ${key}`, `Skip ${key}`])}\n`);
  const question = `Edit the description or summary of Epic ${key}?`;
  appendCall(
    s,
    "AskUserQuestion",
    { questions: [{ question, header: "Epic", options: [{ label: `Edit ${key}` }, { label: `Skip ${key}` }], multiSelect: false }] },
    { isError: false, text: `User has answered your questions: "${question}"="Edit ${key}". You can now continue with the user's answers in mind.`, exitCode: null, items: null, lastPage: null },
  );
  const w = appendWrite(s, "editJiraIssue", { cloudId: "cloud-dst", issueIdOrKey: key, ...shape });
  return ungated(await grade(b), w);
}

/** Grade one edit on the Epic S3's B session joined (listed label team-x). True = ungated. */
async function gradeJoined(shape: (labels: string[]) => Input, owned: boolean): Promise<boolean> {
  const b = buildPassingBundle("jira");
  const s = marked(b, "S3", "B");
  const set = b.repos.B.receipts;
  if (!set.readable) throw new Error("fixture: receipts unreadable");
  const join_ = set.records.find((r) => r.kind === "milestone-decision" && r.evidence.act === "join" && r.sessionId === s.sessionId);
  if (!join_) throw new Error("fixture: S3 B recorded no join");
  const key = String(join_.evidence.key);
  const milestone = milestoneIdFromEpicKey(key);
  Object.assign(join_.evidence, { labels: ["team-x"], milestoneId: milestone });
  if (owned) b.repos.B.frBindings.push({ path: "specs/frs/fr-865.md", title: "Own Epic", key, milestone: null });
  const w = appendWrite(s, "editJiraIssue", { cloudId: "cloud-dst", issueIdOrKey: key, ...shape(["team-x", `milestone-${milestone}`]) });
  return ungated(await grade(b), w);
}

// ===========================================================================
// AC-STE-865.1 — one shared module; neither consumer reads a raw key
// ===========================================================================

const deepFreeze = <T>(v: T): T => {
  if (v !== null && typeof v === "object") {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
};

/** One pin per translated key: holds on the shipped module, fails when that key's translation is removed (AC.8). */
interface Pin {
  key: string;
  name: string;
  holds: (m: CallModule) => boolean;
}
const same = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b, true);
const ADDRESS = { cloudId: CLOUD, issueIdOrKey: EPIC };
const PINS: Pin[] = [
  {
    key: "transitionId",
    name: "`transitionId` reads as `transition: {id}`",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("transitionJiraIssue", { ...ADDRESS, transitionId: "41", actionSource: "model_tool_call" });
      return same(c, { tool: "transitionJiraIssue", input: { ...ADDRESS, transition: { id: "41" }, actionSource: "model_tool_call" }, unplaced: [] });
    },
  },
  {
    key: "transitionName",
    name: "`transitionName` reads as `transition: {name}`",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("transitionJiraIssue", { ...ADDRESS, transitionName: "Done" });
      return same(c, { tool: "transitionJiraIssue", input: { ...ADDRESS, transition: { name: "Done" } }, unplaced: [] });
    },
  },
  {
    key: "issueType",
    name: "`issueType` reads as `issueTypeName`",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("createJiraIssue", { cloudId: CLOUD, projectKey: "GK", issueType: "Epic", summary: "Payouts" });
      return same(c, { tool: "createJiraIssue", input: { cloudId: CLOUD, projectKey: "GK", issueTypeName: "Epic", summary: "Payouts" }, unplaced: [] });
    },
  },
  {
    key: "issueTypeName",
    name: "`issueType` beside a different `issueTypeName` is unplaced",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("createJiraIssue", { projectKey: "GK", issueType: "Epic", issueTypeName: "Task", summary: "Payouts" });
      return c.unplaced.some((k) => k === "issueType" || k === "issueTypeName");
    },
  },
  {
    key: "additional_fields",
    name: "an edit's `additional_fields` read as `fields`",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("editJiraIssue", { ...ADDRESS, fields: { summary: "S" }, additional_fields: { labels: ["a"] } });
      return same(c, { tool: "editJiraIssue", input: { ...ADDRESS, fields: { summary: "S", labels: ["a"] } }, unplaced: [] });
    },
  },
  {
    key: "fields",
    name: "a field named in both `fields` and `additional_fields` of an edit is unplaced",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("editJiraIssue", { ...ADDRESS, fields: { summary: "S" }, additional_fields: { summary: "T" } });
      return c.unplaced.length > 0;
    },
  },
  {
    key: "addOrEditJiraIssueComment",
    name: "`addOrEditJiraIssueComment` reads as `addCommentToJiraIssue`",
    holds: (m) => {
      const c = m.canonicalAtlassianCall("addOrEditJiraIssueComment", { ...ADDRESS, commentBody: "Progress." });
      return same(c, { tool: "addCommentToJiraIssue", input: { ...ADDRESS, commentBody: "Progress." }, unplaced: [] });
    },
  },
  {
    key: "addGraphContext",
    name: "`addGraphContext` reads as `addTeamworkGraphContext`",
    holds: (m) => {
      const input = { cloudId: CLOUD, objectIdentifier: "GK-1", targetObjectIdentifier: "GK-2", relationshipType: "jira-work-item-links-jira-work-item" };
      return same(m.canonicalAtlassianCall("addGraphContext", input), { tool: "addTeamworkGraphContext", input, unplaced: [] });
    },
  },
  {
    key: "linkType",
    name: "`createJiraIssueLink`'s `linkType` reads as `type` of `createIssueLink`",
    holds: (m) => same(m.canonicalAtlassianCall("createJiraIssueLink", { linkType: "Relates", inwardIssue: "GK-1", outwardIssue: "GK-2" }), { tool: "createIssueLink", input: { inwardIssue: "GK-1", outwardIssue: "GK-2", type: "Relates" }, unplaced: [] }),
  },
  {
    key: "createJiraIssueLink",
    name: "`createJiraIssueLink` reads as `createIssueLink`",
    holds: (m) => m.canonicalAtlassianCall("createJiraIssueLink", { linkType: "Relates" }).tool === "createIssueLink",
  },
  {
    key: "addOrEditJiraIssueWorklog",
    name: "`addOrEditJiraIssueWorklog` reads as `addWorklogToJiraIssue`",
    holds: (m) => m.canonicalAtlassianCall("addOrEditJiraIssueWorklog", { issueIdOrKey: EPIC, timeSpent: "1h" }).tool === "addWorklogToJiraIssue",
  },
  {
    key: "issueIdOrKey",
    name: "an `issueIdOrKey` browse URL reads as its key",
    holds: (m) => same(m.canonicalAtlassianCall("editJiraIssue", { issueIdOrKey: browse(EPIC), fields: { summary: "S" } }).input, { issueIdOrKey: EPIC, fields: { summary: "S" } }),
  },
];

describe("AC-STE-865.1 — canonicalAtlassianCall maps v1 and v2 write calls to one canonical call", () => {
  for (const p of PINS) {
    test(`PIN (${p.key}) — ${p.name}`, async () => {
      expect(p.holds(await callModule())).toBe(true);
    });
  }

  const V1: Array<[string, Input]> = [
    ["transitionJiraIssue", { ...ADDRESS, transition: { id: "41" }, actionSource: "model_tool_call" }],
    ["transitionJiraIssue", { ...ADDRESS, transition: { id: "41" }, fields: { resolution: { name: "Done" } } }],
    ["createJiraIssue", { cloudId: CLOUD, projectKey: "GK", issueTypeName: "Task", summary: "S", parent: EPIC, additional_fields: { labels: ["a"] } }],
    ["editJiraIssue", { ...ADDRESS, fields: { labels: ["a"] }, contentFormat: "markdown" }],
    ["addCommentToJiraIssue", { ...ADDRESS, commentBody: "Progress." }],
    ["addWorklogToJiraIssue", { ...ADDRESS, timeSpent: "1h" }],
    ["createIssueLink", { cloudId: CLOUD, inwardIssue: "GK-1", outwardIssue: "GK-2", type: "Relates" }],
  ];
  V1.forEach(([tool, input], i) => {
    test(`v1 call ${i + 1} (${tool}) comes back equal, with nothing unplaced`, async () => {
      const { canonicalAtlassianCall } = await callModule();
      expect(canonicalAtlassianCall(tool, structuredClone(input))).toEqual({ tool, input, unplaced: [] });
    });
  });

  const V2: Array<[string, Input]> = [
    ["transitionJiraIssue", { ...ADDRESS, transitionId: "41" }],
    ["createJiraIssue", { projectKey: "GK", issueType: "Epic", labels: ["a"] }],
    ["editJiraIssue", { ...ADDRESS, fields: { summary: "S" }, additional_fields: { labels: ["a"] } }],
    ["addOrEditJiraIssueComment", { ...ADDRESS, commentBody: "x", commentId: "10001" }],
  ];
  for (const [tool, input] of V2) {
    test(`pure — a deeply frozen v2 ${tool} input is neither mutated nor refused`, async () => {
      const { canonicalAtlassianCall } = await callModule();
      const before = JSON.stringify(input);
      const frozen = deepFreeze(structuredClone(input));
      expect(canonicalAtlassianCall(tool, frozen).input).toBeObject();
      expect(JSON.stringify(frozen)).toBe(before);
    });
  }

  for (const k of ["rankBeforeIssue", "inlineFileId", "frobnicate"]) {
    test(`an edit key the translator does not know (${k}) is kept in the canonical input`, async () => {
      const { canonicalAtlassianCall } = await callModule();
      expect(canonicalAtlassianCall("editJiraIssue", { ...ADDRESS, fields: { summary: "S" }, [k]: "x" }).input[k]).toBe("x");
    });
  }
});

// ------------------------------------------------------------- the key scan

const RAW_KEYS = ["issueTypeName", "issueType", "additional_fields", "transition", "transitionId", "transitionName"] as const;
/** Keys a canonical call never carries: any read of them is a raw read. */
const V2_ONLY = "transitionId|transitionName";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/**
 * Reads of a raw Atlassian write key in one consumer. A raw input is the hook's
 * `tool_input`, a transcript block's `.input`, or a name bound to either in the
 * same top-level declaration by a statement that does not translate it. The
 * two names only v2 carries, and `.input.issueType`, are raw wherever read.
 */
function rawKeyReads(source: string): string[] {
  const src = stripComments(source);
  const out: string[] = [];
  const keys = [...RAW_KEYS].sort((a, b) => b.length - a.length).join("|");
  const access = (base: string, names: string): RegExp => new RegExp(`${base}[\\s)?!]*(?:as [^)]*\\))?[\\s)?!]*(?:\\.\\s*(${names})\\b|(?:\\?\\.)?\\[\\s*["'](${names})["'])`, "g");
  for (const m of src.matchAll(new RegExp(`(?:\\.\\s*|["'])(${V2_ONLY})\\b`, "g"))) out.push(`v2-only ${m[1]}`);
  for (const m of src.matchAll(access("\\binput", "issueType"))) out.push(`v2-only ${m[1] ?? m[2]}`);
  const RAW = "(?:\\btool_input|\\b(?:b|block|blk|toolUse)\\??\\.input)\\b";
  for (const chunk of src.split(/\n(?=(?:export |async |function |const |let |class ))/)) {
    for (const m of chunk.matchAll(access(RAW, keys))) out.push(`direct ${m[1] ?? m[2]}`);
    for (const st of chunk.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|\w+)[^=;]*=\s*([^;]*);/g)) {
      const [, target, value] = st as unknown as [string, string, string];
      if (!new RegExp(RAW).test(value) || /canonicalAtlassianCall\s*\(/.test(value)) continue;
      if (target.startsWith("{")) {
        for (const m of target.matchAll(new RegExp(`\\b(${keys})\\b`, "g"))) out.push(`destructured ${m[1]}`);
      } else {
        for (const m of chunk.matchAll(access(`(?<![.\\w])${target}\\b`, keys))) out.push(`alias ${m[1] ?? m[2]}`);
      }
    }
  }
  return out;
}

const CONSUMERS = [
  ["pre-tracker-write-gate.ts", HOOK_PATH],
  ["shared_tracker_live_grader.ts", GRADER_PATH],
] as const;

describe("AC-STE-865.1 — the gate and the live grader read only the canonical call", () => {
  for (const [name, path] of CONSUMERS) {
    test(`${name} imports canonicalAtlassianCall from atlassian_call and calls it`, () => {
      const src = stripComments(readFileSync(path, "utf-8"));
      expect(src).toMatch(/import\s*\{[^}]*\bcanonicalAtlassianCall\b[^}]*\}\s*from\s*["'][^"']*\/atlassian_call(?:\.ts)?["']/);
      expect(src).toMatch(/\bcanonicalAtlassianCall\s*\(/);
    });

    test(`${name} reads no Atlassian write key from a raw input`, () => {
      expect(rawKeyReads(readFileSync(path, "utf-8"))).toEqual([]);
    });

    for (const key of RAW_KEYS) {
      for (const [form, plant] of [
        ["direct", `payload.tool_input.${key}`],
        ["cast", `(payload.tool_input as Record<string, unknown>).${key}`],
        ["block", `b.input?.${key}`],
        ["bracket", `(b.input as Record<string, unknown>)["${key}"]`],
        ["alias", `raw865.${key}`],
        ["destructured", `picked865`],
      ] as const) {
        test(`CONTROL — a planted ${form} read of ${key} in ${name} is found`, () => {
          const src = readFileSync(path, "utf-8");
          const bind = form === "alias" ? "  const raw865 = (b.input ?? {}) as Record<string, unknown>;\n" : form === "destructured" ? `  const { ${key}: picked865 } = payload.tool_input;\n` : "";
          const planted = `${src}\nfunction planted865(payload: any, b: any): unknown {\n${bind}  return ${plant};\n}\n`;
          const naming = (text: string): number => rawKeyReads(text).filter((x) => x.endsWith(` ${key}`)).length;
          expect(naming(planted)).toBeGreaterThan(naming(src));
        });
      }
    }
  }
});

describe("AC-STE-865.1 — the grader reads a bundle of v2 calls as it reads the same bundle in v1", () => {
  /** The v1 call's v2 spelling. */
  function toV2(c: ToolCall): boolean {
    const tool = c.name.split("__").at(-1);
    const i = c.input;
    if (tool === "createJiraIssue") {
      i.issueType = i.issueTypeName;
      delete i.issueTypeName;
      const add = i.additional_fields as Input | undefined;
      if (add?.labels !== undefined) {
        i.labels = add.labels;
        delete i.additional_fields;
      }
      return true;
    }
    if (tool === "editJiraIssue") {
      i.additional_fields = i.fields;
      delete i.fields;
      return true;
    }
    if (tool === "transitionJiraIssue") {
      i.transitionId = (i.transition as { id: string }).id;
      delete i.transition;
      return true;
    }
    return false;
  }

  test("a whole passing Jira bundle re-spelled in v2 draws the same outcome, findings and scenarios", async () => {
    const v1 = buildPassingBundle("jira");
    const v2 = clone(v1);
    const tools = new Set(v2.sessions.flatMap((s) => s.calls.filter(toV2)).map((c) => c.name.split("__").at(-1)));
    expect([...tools].sort()).toEqual(["createJiraIssue", "editJiraIssue", "transitionJiraIssue"]);
    const [a, b] = [await grade(v1), await grade(v2)];
    expect(a.outcome).toBe("pass");
    expect({ outcome: b.outcome, findings: b.findings, scenarios: b.scenarios }).toEqual({ outcome: a.outcome, findings: a.findings, scenarios: a.scenarios });
  });
});

// ===========================================================================
// AC-STE-865.2 — isStatusOnlyTransition
// ===========================================================================

const STATUS_ONLY: Array<[string, Input]> = [
  ["transition: {id}", { transition: { id: "41" } }],
  ["transitionId", { transitionId: "41" }],
  ["transitionName", { transitionName: "Done" }],
  ["transitionId + actionSource", { transitionId: "41", actionSource: "model_tool_call" }],
  ["transitionName + actionSource", { transitionName: "Done", actionSource: "jira_mcp_card" }],
];
const EXTRA_KEYS: Array<[string, unknown]> = [
  ["fields", { resolution: { name: "Done" } }],
  ["update", { labels: [{ add: "x" }] }],
  ["historyMetadata", { type: "x" }],
  ["sprintId", 7],
  ["assignToBacklog", true],
  ["boardId", 3],
  ["frobnicate", "x"],
];
const NOT_STATUS_ONLY: Array<[string, Input]> = [
  ["transition + transitionId", { transition: { id: "41" }, transitionId: "41" }],
  ["transition + transitionName", { transition: { id: "41" }, transitionName: "Done" }],
  ["transitionId + transitionName", { transitionId: "41", transitionName: "Done" }],
  ["empty transitionId", { transitionId: "" }],
  ["empty transitionName", { transitionName: "" }],
  ["numeric transitionId", { transitionId: 41 }],
  ["object transitionName", { transitionName: { name: "Done" } }],
  ["null transition", { transition: null }],
  ["no designator", {}],
  ...EXTRA_KEYS.map(([k, v]): [string, Input] => [`transitionId + ${k}`, { transitionId: "41", [k]: v }]),
  ...EXTRA_KEYS.map(([k, v]): [string, Input] => [`transitionName + ${k}`, { transitionName: "Done", [k]: v }]),
  ...EXTRA_KEYS.map(([k, v]): [string, Input] => [`transition + ${k}`, { transition: { id: "41" }, [k]: v }]),
];

describe("AC-STE-865.2 — isStatusOnlyTransition: exactly one designator beside only the call keys", () => {
  for (const [want, rows] of [
    [true, STATUS_ONLY],
    [false, NOT_STATUS_ONLY],
  ] as const) {
    for (const [name, shape] of rows) {
      test(`${name} → ${want} (raw input)`, async () => {
        expect((await ownership()).isStatusOnlyTransition({ ...ADDRESS, ...shape })).toBe(want);
      });
      test(`${name} → ${want} (after canonicalAtlassianCall)`, async () => {
        const { canonicalAtlassianCall } = await callModule();
        const c = canonicalAtlassianCall("transitionJiraIssue", { ...ADDRESS, ...shape });
        expect((await ownership()).isStatusOnlyTransition(c.input)).toBe(want);
      });
    }
  }
});

// ===========================================================================
// AC-STE-865.3 — the close, through the gate and the grader
// ===========================================================================

describe("AC-STE-865.3 — a shipped Epic closes in either shape after its epic-close receipt", () => {
  let w: World;
  let announced: Transcript;
  beforeAll(() => {
    w = makeWorld();
    announced = closedTranscript(w);
  });
  const close = (key: string, shape: Input, t: Transcript, server = "atlassian") =>
    gate(PLUGIN_ROOT, jira("transitionJiraIssue", server), { cloudId: CLOUD, issueIdOrKey: key, ...shape }, t, w.be);

  for (const [name, shape] of STATUS_ONLY) {
    for (const server of SERVERS) {
      test(`PERMIT — gate: ${name} under ${server}`, async () => {
        expectPermit(await close(EPIC, shape, announced, server));
      });
    }
    test(`TWIN — gate: ${name} with no receipt → refused`, async () => {
      expectRefusal(await close(EPIC, shape, new Transcript(), "atlassian"), EPIC);
    });
    test(`TWIN — gate: ${name} on another Epic → refused`, async () => {
      expectRefusal(await close(OTHER_EPIC, shape, announced), OTHER_EPIC);
    });
    test(`PERMIT — grader: ${name} is gated`, async () => {
      expect(await gradeClose(shape, (k) => k)).toBe(false);
    });
    test(`TWIN — grader: ${name} with no receipt → ungated-write`, async () => {
      expect(await gradeClose(shape, null)).toBe(true);
    });
    test(`TWIN — grader: ${name} with another key's receipt → ungated-write`, async () => {
      expect(await gradeClose(shape, (k) => `${k}1`)).toBe(true);
    });
  }

  for (const [name, shape] of NOT_STATUS_ONLY) {
    test(`TWIN — gate: ${name} → refused although the receipt is intact`, async () => {
      expectRefusal(await close(EPIC, shape, announced));
    });
    test(`TWIN — grader: ${name} → ungated-write although the receipt is intact`, async () => {
      expect(await gradeClose(shape, (k) => k)).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-865.4 — createJiraIssue
// ===========================================================================

const EPIC_TITLE = "BE Payouts";
const TICKET_TITLE = "BE payout export";
const EPIC_SPELLINGS = ["Epic", "epic", "EPIC"] as const;

describe("AC-STE-865.4 — `issueType` decides the create's class in the gate", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
  });
  const create = (input: Input, t: Transcript) => gate(PLUGIN_ROOT, jira("createJiraIssue"), { cloudId: CLOUD, projectKey: "GK", ...input }, t, w.be);

  /** An Epic create decided by the REAL front door on an empty listing, then re-listed. */
  function epicDecided(): Transcript {
    const listing = join(w.scratch, "epics.json");
    writeFileSync(listing, JSON.stringify({ issues: [], isLast: true }));
    const args = [w.be, "jira", "GK", listing, "--title", EPIC_TITLE];
    const run = runModule(PLUGIN_ROOT, "resolve_milestone_identity.ts", args);
    if (run.exitCode !== 0) throw new Error(`fixture: the decision did not run:\n${show(run)}`);
    const t = new Transcript();
    t.bash(`bun run "${join(SRC, "resolve_milestone_identity.ts")}" ${w.be} jira GK ${listing} --title "${EPIC_TITLE}"`, run.stdout.trimEnd());
    t.tool(
      jira("searchJiraIssuesUsingJql"),
      { cloudId: CLOUD, jql: "project = GK AND issuetype = Epic", fields: ["summary", "status", "issuetype", "project", "labels"], maxResults: 100 },
      { issues: [], isLast: true },
    );
    return t;
  }

  /** A ticket create decided (`create` + `attach-target` receipts) under GK-85. */
  function ticketDecided(): Transcript {
    const t = new Transcript();
    announce(t, w.be, "create_idempotency_probe.ts", `decide "${w.be}" /tmp/page.json --title "${TICKET_TITLE}" --parent ${EPIC} --attempt fast`, {
      kind: "create",
      adapter: "jira",
      container: EPIC,
      subject: TICKET_TITLE,
      decision: "create",
      evidence: { createPayload: { project: "GK", summary: TICKET_TITLE, labels: [BE_TAG], parent: EPIC } },
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

  test("CONTROL — the decided v1 Epic create is permitted", async () => {
    expectPermit(await create({ issueTypeName: "Epic", summary: EPIC_TITLE, additional_fields: { labels: [BE_TAG] } }, epicDecided()));
  });
  for (const type of EPIC_SPELLINGS) {
    test(`PERMIT — a decided milestone: issueType "${type}" with top-level labels`, async () => {
      expectPermit(await create({ issueType: type, summary: EPIC_TITLE, labels: [BE_TAG] }, epicDecided()));
    });
    test(`TWIN — issueType "${type}" with no decision is refused as a milestone write`, async () => {
      expectRefusal(await create({ issueType: type, summary: EPIC_TITLE, labels: [BE_TAG] }, new Transcript()), "a milestone write");
    });
  }

  for (const type of ["Task", "Story", "Epic Task"]) {
    test(`PERMIT — issueType "${type}" is a ticket create, and its top-level labels count`, async () => {
      expectPermit(await create({ issueType: type, summary: TICKET_TITLE, parent: EPIC, labels: [BE_TAG] }, ticketDecided()));
    });
  }
  test("TWIN — the v2 ticket create with a wrong top-level label is refused, naming the tag", async () => {
    expectRefusal(await create({ issueType: "Task", summary: TICKET_TITLE, parent: EPIC, labels: ["other"] }, ticketDecided()), BE_TAG);
  });
  test("a prior v2 Epic create spends the decision: a second one is refused", async () => {
    const t = epicDecided();
    t.tool(jira("createJiraIssue"), { cloudId: CLOUD, projectKey: "GK", issueType: "Epic", summary: EPIC_TITLE, labels: [BE_TAG] }, { key: "GK-150", id: "10150" });
    expectRefusal(await create({ issueType: "Epic", summary: EPIC_TITLE, labels: [BE_TAG] }, t), "GK-150");
  });

  for (const [a, b] of [
    ["Task", "Epic"],
    ["Epic", "Task"],
    ["Task", "Story"],
  ] as const) {
    test(`REFUSE — issueType "${a}" beside issueTypeName "${b}", both creates decided`, async () => {
      const t = ticketDecided();
      for (const l of epicDecided().lines) t.lines.push(l.replaceAll("toolu_729_", "toolu_729_e"));
      const ticket = await create({ issueType: a, issueTypeName: b, summary: TICKET_TITLE, parent: EPIC, labels: [BE_TAG] }, t);
      const epic = await create({ issueType: a, issueTypeName: b, summary: EPIC_TITLE, labels: [BE_TAG] }, t);
      expect({ ticket: refusalProblem(ticket), epic: refusalProblem(epic) }, `${show(ticket)}\n${show(epic)}`).toEqual({ ticket: null, epic: null });
    });
  }
  test("CONTROL — issueType and issueTypeName naming the same type are permitted", async () => {
    expectPermit(await create({ issueType: "Task", issueTypeName: "Task", summary: TICKET_TITLE, parent: EPIC, labels: [BE_TAG] }, ticketDecided()));
  });
});

describe("AC-STE-865.4 — `issueType` decides the create's class in the live grader", () => {
  async function gradeCreate(marker: string, epic: boolean, f: (i: Input, b: LiveBundle) => void): Promise<boolean> {
    const b = buildPassingBundle("jira");
    const s = marked(b, marker, "A");
    const c = s.calls.find((x) => x.name.endsWith("__createJiraIssue") && (x.input.issueTypeName === "Epic") === epic);
    if (!c) throw new Error(`fixture: ${marker} A holds no such create`);
    f(c.input, b);
    return ungated(await grade(b), c);
  }
  const v2 = (type: string, labels?: string[]) => (i: Input) => {
    delete i.issueTypeName;
    i.issueType = type;
    i.labels = labels ?? (i.additional_fields as { labels: string[] }).labels;
    delete i.additional_fields;
  };
  for (const type of EPIC_SPELLINGS) {
    test(`a decided milestone create spelled issueType "${type}" is gated`, async () => {
      expect(await gradeCreate("S3", true, v2(type))).toBe(false);
    });
  }
  test("TWIN — a ticket's decided create spelled issueType \"Epic\" follows no milestone decision → ungated-write", async () => {
    expect(await gradeCreate("S1", false, v2("Epic"))).toBe(true);
  });
  test("a decided ticket create spelled issueType \"Task\", labels at the top level, is gated", async () => {
    expect(await gradeCreate("S1", false, v2("Task"))).toBe(false);
  });
  test("TWIN — the same create with wrong top-level labels → ungated-write", async () => {
    expect(await gradeCreate("S1", false, v2("Task", ["other"]))).toBe(true);
  });
  test("a milestone create carrying issueType Task beside issueTypeName Epic → ungated-write", async () => {
    expect(await gradeCreate("S3", true, (i) => void (i.issueType = "Task"))).toBe(true);
  });
  test("a ticket create carrying issueType Epic beside issueTypeName Task → ungated-write", async () => {
    expect(await gradeCreate("S1", false, (i) => void (i.issueType = "Epic"))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-865.5 — editJiraIssue
// ===========================================================================

const PLACEMENT_KEYS = ["rankBeforeIssue", "rankAfterIssue", "rankCustomFieldId", "inlineFileId", "inlineFileCollection", "inlineFileName"] as const;

describe("AC-STE-865.5 — labelsEnvelope reads an edit's additional_fields as fields", () => {
  const envelope = async (shape: Input) => {
    const { canonicalAtlassianCall } = await callModule();
    return (await ownership()).labelsEnvelope(canonicalAtlassianCall("editJiraIssue", { ...ADDRESS, ...shape }).input);
  };
  test("labels in additional_fields alone are a labels-only write", async () => {
    expect(await envelope({ additional_fields: { labels: ["a"] } })).toEqual({ extraKeys: [] });
  });
  test("a summary in additional_fields beside labels counts as an extra key", async () => {
    expect((await envelope({ additional_fields: { labels: ["a"], summary: "S" } }))!.extraKeys).toContain("summary");
  });
  test("labels in additional_fields beside a summary in fields count the summary as extra", async () => {
    expect((await envelope({ fields: { summary: "S" }, additional_fields: { labels: ["a"] } }))!.extraKeys).toContain("summary");
  });
  test("labels in additional_fields beside a field named in both blocks are a labels write with an extra key, never no labels write", async () => {
    const e = await envelope({ fields: { description: "A" }, additional_fields: { description: "B", labels: ["a"] } });
    expect(e).not.toBeNull();
    expect(e!.extraKeys).toContain("additional_fields");
  });
  test("labels named in both blocks are not a labels-only write", async () => {
    expect((await envelope({ fields: { labels: ["a"] }, additional_fields: { labels: ["b"] } }))!.extraKeys.length).toBeGreaterThan(0);
  });
  for (const k of PLACEMENT_KEYS) {
    test(`${k} beside additional_fields.labels counts as an extra key`, async () => {
      expect((await envelope({ additional_fields: { labels: ["a"] }, [k]: "x" }))!.extraKeys).toContain(k);
    });
  }
});

const EPIC_EDITS: Array<[string, Input, boolean]> = [
  ["CONTROL — fields.description", { fields: { description: "Body" } }, true],
  ["additional_fields.description alone", { additional_fields: { description: "Body" } }, true],
  ["fields.description + additional_fields.summary", { fields: { description: "Body" }, additional_fields: { summary: "Title" } }, true],
  ["fields.description + additional_fields.labels", { fields: { description: "Body" }, additional_fields: { labels: ["x"] } }, false],
  ["description in both blocks", { fields: { description: "Body" }, additional_fields: { description: "Other" } }, false],
  ...PLACEMENT_KEYS.map((k): [string, Input, boolean] => [`fields.description + ${k}`, { fields: { description: "Body" }, [k]: "x" }, false]),
  ...PLACEMENT_KEYS.map((k): [string, Input, boolean] => [`additional_fields.description + ${k}`, { additional_fields: { description: "Body" }, [k]: "x" }, false]),
];

describe("AC-STE-865.5 — the consented Epic edit, in the gate and the grader", () => {
  for (const [name, shape, permitted] of EPIC_EDITS) {
    test(`gate: ${name} → ${permitted ? "permitted" : "refused"}`, async () => {
      const w = makeEditWorld();
      const { t } = editedTranscript(PLUGIN_ROOT, w);
      askEdit(t, EDIT_EPIC, EDIT_LABEL(EDIT_EPIC));
      const r = await gate(PLUGIN_ROOT, jira("editJiraIssue"), { cloudId: CLOUD, issueIdOrKey: EDIT_EPIC, ...shape }, t, w.root);
      if (permitted) expectPermit(r);
      else expectRefusal(r);
    });
    test(`grader: ${name} → ${permitted ? "gated" : "ungated-write"}`, async () => {
      expect(await gradeEdit(shape)).toBe(!permitted);
    });
  }
});

/** Edits on a joined Epic whose join listed `team-x`; `owned` gives the repository an FR binding on it. */
const JOINED_EDITS: Array<[string, (labels: string[]) => Input, boolean, boolean]> = [
  ["CONTROL — the read-merge in fields", (l) => ({ fields: { labels: l } }), false, true],
  ["the read-merge in additional_fields", (l) => ({ additional_fields: { labels: l } }), false, true],
  ["clobbering labels in additional_fields, the key FR-bound", () => ({ additional_fields: { labels: ["x"] } }), true, false],
  ["the read-merge + a summary in additional_fields, the key FR-bound", (l) => ({ additional_fields: { labels: l, summary: "S" } }), true, false],
  ["the read-merge in fields + a summary in additional_fields, the key FR-bound", (l) => ({ fields: { labels: l }, additional_fields: { summary: "S" } }), true, false],
  ["labels in additional_fields beside a description in both blocks, the key FR-bound", (l) => ({ fields: { description: "A" }, additional_fields: { description: "B", labels: l } }), true, false],
  ["labels in both blocks, the key FR-bound", (l) => ({ fields: { labels: l }, additional_fields: { labels: l } }), true, false],
  ...PLACEMENT_KEYS.map((k): [string, (l: string[]) => Input, boolean, boolean] => [`the read-merge in additional_fields + ${k}, the key FR-bound`, (l) => ({ additional_fields: { labels: l }, [k]: "x" }), true, false]),
  ...PLACEMENT_KEYS.map((k): [string, (l: string[]) => Input, boolean, boolean] => [`the read-merge in fields + ${k}, the key FR-bound`, (l) => ({ fields: { labels: l }, [k]: "x" }), true, false]),
];

describe("AC-STE-865.5 — the join-label write, in the gate and the grader", () => {
  let plain: World;
  let bound: World;
  beforeAll(() => {
    plain = makeWorld();
    bound = makeWorld([EPIC]);
  });
  function joined(w: World): Transcript {
    const t = new Transcript();
    announce(t, w.be, "resolve_milestone_identity.ts", `${w.be} jira GK /tmp/listing.json --join-key ${EPIC} --sibling /tmp/sibling`, {
      kind: "milestone-decision",
      adapter: "jira",
      container: "GK",
      subject: EPIC,
      decision: "join",
      evidence: { act: "join", via: "key", key: EPIC, milestoneId: MILESTONE, name: "Payouts", labels: ["team-x"], default: "allowed" },
    });
    return t;
  }
  for (const [name, shape, owned, permitted] of JOINED_EDITS) {
    test(`gate: ${name} → ${permitted ? "permitted" : "refused"}`, async () => {
      const w = owned ? bound : plain;
      const r = await gate(PLUGIN_ROOT, jira("editJiraIssue"), { cloudId: CLOUD, issueIdOrKey: EPIC, ...shape(["team-x", `milestone-${MILESTONE}`]) }, joined(w), w.be);
      if (permitted) expectPermit(r);
      else expectRefusal(r, EPIC);
    });
    test(`grader: ${name} → ${permitted ? "gated" : "ungated-write"}`, async () => {
      expect(await gradeJoined(shape, owned)).toBe(!permitted);
    });
  }
});

// ===========================================================================
// AC-STE-865.6 — comments, and browse URLs on every ticket write
// ===========================================================================

const TICKET_WRITES: Array<[string, Input]> = [
  ["editJiraIssue", { fields: { summary: "S" } }],
  ["transitionJiraIssue", { transitionId: "31" }],
  ["transitionJiraIssue", { transition: { id: "31" } }],
  ["addCommentToJiraIssue", { commentBody: "Progress." }],
  ["addWorklogToJiraIssue", { timeSpent: "1h" }],
  ["addOrEditJiraIssueComment", { commentBody: "Progress." }],
  ["addOrEditJiraIssueComment", { commentBody: "Progress.", commentId: "10001" }],
];
const titleOf = (tool: string, rest: Input): string => `${tool} {${Object.keys(rest).join(", ")}}`;

describe("AC-STE-865.6 — ticket writes, through the gate", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld([OWN]);
  });
  const write = (tool: string, key: string, rest: Input, server: string = "atlassian") =>
    gate(PLUGIN_ROOT, jira(tool, server), { cloudId: CLOUD, issueIdOrKey: key, ...rest }, new Transcript(), w.be);

  for (const [tool, rest] of TICKET_WRITES) {
    for (const server of SERVERS) {
      test(`${titleOf(tool, rest)} under ${server}: the owned key is permitted`, async () => {
        expectPermit(await write(tool, OWN, rest, server));
      });
      test(`${titleOf(tool, rest)} under ${server}: a foreign key is refused, naming it`, async () => {
        expectRefusal(await write(tool, FOREIGN, rest, server), FOREIGN);
      });
    }
    test(`${titleOf(tool, rest)}: an owned key's browse URL is permitted`, async () => {
      expectPermit(await write(tool, browse(OWN), rest));
    });
    test(`${titleOf(tool, rest)}: an owned key's browse URL with a query is permitted`, async () => {
      expectPermit(await write(tool, `${browse(OWN)}?focusedId=1`, rest));
    });
    test(`${titleOf(tool, rest)}: a foreign key's browse URL is refused as that key's ticket`, async () => {
      expectRefusal(await write(tool, browse(FOREIGN), rest), `on ${FOREIGN}: the ticket is not owned`);
    });
    test(`${titleOf(tool, rest)}: a URL that is no browse URL is refused`, async () => {
      expectRefusal(await write(tool, `https://${CLOUD}/issues/${OWN}`, rest));
    });
  }
  test("an Epic close addressed by its browse URL is permitted after its receipt", async () => {
    const c = makeWorld();
    expectPermit(await gate(PLUGIN_ROOT, jira("transitionJiraIssue"), { cloudId: CLOUD, issueIdOrKey: browse(EPIC), transitionName: "Done" }, closedTranscript(c), c.be));
  });
  test("TWIN — another Epic's browse URL is refused although GK-85's receipt is intact", async () => {
    const c = makeWorld();
    expectRefusal(await gate(PLUGIN_ROOT, jira("transitionJiraIssue"), { cloudId: CLOUD, issueIdOrKey: browse(OTHER_EPIC), transitionName: "Done" }, closedTranscript(c), c.be), OTHER_EPIC);
  });
});

describe("AC-STE-865.6 — ticket writes, in the live grader", () => {
  async function gradeWrite(tool: string, rest: Input, spell: (k: string) => string, owned: boolean): Promise<boolean> {
    const b = buildPassingBundle("jira");
    const s = marked(b, "S13");
    const key = `${b.run.container}-890`;
    if (owned) b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key, milestone: null });
    const w = appendWrite(s, tool, { cloudId: "cloud-dst", issueIdOrKey: spell(key), ...rest });
    return ungated(await grade(b), w);
  }
  for (const [tool, rest] of TICKET_WRITES) {
    for (const [spelling, spell] of [
      ["key", (k: string) => k],
      ["browse URL", browse],
    ] as const) {
      test(`${titleOf(tool, rest)} by ${spelling}: an owned ticket is gated`, async () => {
        expect(await gradeWrite(tool, rest, spell, true)).toBe(false);
      });
      test(`${titleOf(tool, rest)} by ${spelling}: an unowned ticket → ungated-write`, async () => {
        expect(await gradeWrite(tool, rest, spell, false)).toBe(true);
      });
    }
  }
});

// ===========================================================================
// AC-STE-865.7 — the matcher
// ===========================================================================

describe("AC-STE-865.7 — the hooks.json matcher covers every v1 and v2 direct Jira write", () => {
  interface HookModule {
    TRACKER_WRITE_TOOLS: readonly string[];
    TRACKER_EXECUTE_TOOLS: readonly string[];
    TRACKER_WRITE_MATCHER: string;
    identifyTrackerCall: (p: never) => { adapter: string } | null;
  }
  const hook = async (): Promise<HookModule> => (await import(HOOK_PATH)) as unknown as HookModule;
  function registered(): string {
    const groups = (JSON.parse(readFileSync(HOOKS_JSON, "utf-8")) as { hooks: { PreToolUse: Array<{ matcher?: string; hooks: Array<{ command: string }> }> } }).hooks.PreToolUse;
    const mine = groups.filter((g) => g.hooks.some((h) => h.command.endsWith("/pre-tracker-write-gate.sh")));
    expect(mine.length).toBe(1);
    return mine[0]!.matcher ?? "";
  }
  const V2 = ["createJiraIssue", "editJiraIssue", "transitionJiraIssue", "addOrEditJiraIssueComment", "createIssueLink", "addGraphContext", "createJiraIssueLink", "addOrEditJiraIssueWorklog"];
  const V1 = [
    "createJiraIssue", "editJiraIssue", "transitionJiraIssue", "addCommentToJiraIssue", "addWorklogToJiraIssue", "createIssueLink", "addTeamworkGraphContext",
    "save_issue", "save_milestone", "save_comment", "delete_comment", "create_attachment", "create_attachment_from_upload", "delete_attachment",
    "share_issue", "unshare_issue", "save_project", "create_issue_label", "save_issue_label", "retire_issue_label", "restore_issue_label",
    "save_project_label", "retire_project_label", "restore_project_label", "save_status_update", "delete_status_update", "save_document",
  ];

  test("the registered matcher is the one generated from the write list", async () => {
    const m = await hook();
    expect(registered()).toBe(m.TRACKER_WRITE_MATCHER);
    expect(registered()).toBe(`^mcp__.+__(${[...m.TRACKER_WRITE_TOOLS, ...m.TRACKER_EXECUTE_TOOLS].join("|")})$`);
  });
  for (const server of SERVERS) {
    for (const tool of V2) {
      test(`matches the v2 write ${tool} under ${server}, and the gate reads it as a Jira call`, async () => {
        const name = jira(tool, server);
        expect(new RegExp(registered()).test(name)).toBe(true);
        expect((await hook()).identifyTrackerCall({ tool_name: name, tool_input: { issueIdOrKey: OWN } } as never)?.adapter).toBe("jira");
      });
    }
    test(`every v1 name stays matched under ${server}`, () => {
      const re = new RegExp(registered());
      expect(V1.filter((t) => !re.test(jira(t, server)))).toEqual([]);
    });
    test(`a read stays unmatched under ${server}`, () => {
      expect(new RegExp(registered()).test(jira("getJiraIssue", server))).toBe(false);
    });
  }
});

// ===========================================================================
// AC-STE-865.8 — one mutation leg per translated key and designator
// ===========================================================================

/** Copy `paths` and their local imports into a fresh directory, keeping the basenames. */
function copyWithImports(paths: string[]): string {
  const dir = tempDir("mutant");
  const queue = [...paths];
  const done = new Set<string>();
  while (queue.length > 0) {
    const p = queue.pop()!;
    if (done.has(p)) continue;
    done.add(p);
    const src = readFileSync(p, "utf-8");
    writeFileSync(join(dir, basename(p)), src);
    for (const m of src.matchAll(/from\s+["'](\.\/[^"']+)["']/g)) {
      const rel = m[1]!.endsWith(".ts") ? m[1]! : `${m[1]!}.ts`;
      queue.push(join(dirname(p), rel));
    }
  }
  return dir;
}

/** Unname `key` in one copied file's code; true when the code (comments aside) changed. */
function unname(path: string, key: string): boolean {
  const src = readFileSync(path, "utf-8");
  const mutant = src.replace(new RegExp(`\\b${key}\\b`, "g"), `${key}Removed865`);
  writeFileSync(path, mutant);
  return stripComments(mutant) !== stripComments(src);
}

describe("AC-STE-865.8 — removing one translated key turns its named pin red", () => {
  for (const p of PINS) {
    test(`mutant: ${p.key} unnamed in atlassian_call.ts → PIN (${p.key}) fails`, async () => {
      const control = copyWithImports([CALL_PATH]);
      expect(p.holds(await callModule(join(control, basename(CALL_PATH))))).toBe(true);
      const dir = copyWithImports([CALL_PATH]);
      const copy = join(dir, basename(CALL_PATH));
      expect(unname(copy, p.key)).toBe(true);
      expect(p.holds(await callModule(copy))).toBe(false);
    });
  }

  for (const [key, shape] of [
    ["transition", { transition: { id: "41" } }],
    ["transitionId", { transitionId: "41" }],
    ["transitionName", { transitionName: "Done" }],
  ] as const) {
    test(`mutant: the ${key} designator unnamed → "${key === "transition" ? "transition: {id}" : key} → true (raw input)" fails`, async () => {
      const files = [OWNERSHIP_PATH, CALL_PATH];
      const control = copyWithImports(files);
      expect((await ownership(join(control, basename(OWNERSHIP_PATH)))).isStatusOnlyTransition({ ...ADDRESS, ...shape })).toBe(true);
      const dir = copyWithImports(files);
      const changed = files.map((f) => unname(join(dir, basename(f)), key));
      expect(changed).toContain(true);
      expect((await ownership(join(dir, basename(OWNERSHIP_PATH)))).isStatusOnlyTransition({ ...ADDRESS, ...shape })).toBe(false);
    });
  }

  describe("through the gate, on a mutated copy of the plugin", () => {
    let w: World;
    let announced: Transcript;
    beforeAll(() => {
      w = makeWorld();
      announced = closedTranscript(w);
    });
    /** A plugin copy with `key` unnamed in both modules that know the designators. */
    function pluginCopy(key: string | null): string {
      const root = tempDir("plugin");
      for (const d of ["adapters", "templates"]) cpSync(join(PLUGIN_ROOT, d), join(root, d), { recursive: true });
      if (key !== null) {
        const rel = (p: string): string => join(root, "adapters", "_shared", "src", basename(p));
        const changed = [CALL_PATH, OWNERSHIP_PATH].filter((p) => existsSync(p)).map((p) => unname(rel(p), key));
        expect(changed).toContain(true);
      }
      return root;
    }
    /** The close, announced by a run of the copy's own epic_close.ts. */
    const close = (root: string, shape: Input) => {
      const t = new Transcript();
      for (const l of announced.lines) t.lines.push(l.replaceAll(PLUGIN_ROOT, root));
      return gate(root, jira("transitionJiraIssue"), { cloudId: CLOUD, issueIdOrKey: EPIC, ...shape }, t, w.be);
    };
    for (const [key, shape] of [
      ["transitionId", { transitionId: "41" }],
      ["transitionName", { transitionName: "Done" }],
    ] as const) {
      test(`mutant: ${key} unnamed → "PERMIT — gate: ${key}" refuses, and the v1 close still permits`, async () => {
        expectPermit(await close(pluginCopy(null), shape));
        const mutant = pluginCopy(key);
        expectRefusal(await close(mutant, shape));
        expectPermit(await close(mutant, { transition: { id: "41" } }));
      });
    }
  });
});
