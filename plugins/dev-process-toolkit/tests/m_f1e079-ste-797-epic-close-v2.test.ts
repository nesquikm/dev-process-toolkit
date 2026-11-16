// STE-797 (M_f1e079) — a shipped Epic closes when the call carries its
// attribution key.
//
// The Atlassian `transitionJiraIssue` and `editJiraIssue` tools carry an
// optional `actionSource` input (enum "jira_mcp_card" | "model_tool_call")
// saying who made the call. It is call metadata, not an edit, so:
//
//   AC.1 — join_consent_ownership.ts treats it as an envelope key:
//          isStatusOnlyTransition accepts it, labelsEnvelope does not count it.
//   AC.2 — the gate permits a status-only close carrying it after an intact
//          epic-close receipt, through the SHIPPED `.sh` wrapper; its
//          no-receipt twin and its `fields` / `update` twins stay refused.
//   AC.3 — the Epic edit check (hook and live grader) accepts it, and both
//          read ONE shared key set exported by join_consent_ownership.ts.
//   AC.4 — the "not a plain invocation" refusal note leaves out a rejected
//          command a later plain run of the same deciding module superseded.
//
// The STE-699 world fixture and `.sh` gate driver are copied from
// tests/m_a5dc12-ste-699-epic-close.test.ts (a test file cannot be imported
// without re-running its suite); the STE-729 Epic edit fixtures are imported
// from tests/_m_b2fdc0_ste729_fixture.ts.
//
// Synthetic keys only (GK-*, PROJ-*); every repository is a temporary git repo.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { milestoneIdFromEpicKey } from "../adapters/_shared/src/milestone_token";
import { RECEIPT_ANNOUNCEMENT_PREFIX } from "../adapters/_shared/src/tracker_receipts";
import { commitAll, git, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, declareJira } from "./_orphan_pages";
import { writeFr, writePlan } from "./_sibling_state_fixture";
import { buildPassingBundle, serverPrefix, type BundleSession, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";
import {
  EDIT_LABEL,
  EPIC as EDIT_EPIC,
  JIRA,
  askEdit,
  cleanupTemps as cleanupEditTemps,
  editInput,
  editedTranscript,
  gate as editGate,
  makeWorld as makeEditWorld,
  permitProblem,
  refusalProblem,
  show as showEdit,
} from "./_m_b2fdc0_ste729_fixture";

// Spawned children (git, bun) under full-suite load exceed bun's 5 s default.
setDefaultTimeout(120_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const ADAPTERS_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const OWNERSHIP_PATH = join(ADAPTERS_SRC, "join_consent_ownership.ts");
const EPIC_CLOSE = "epic_close.ts";
const EPIC_CLOSE_PATH = join(ADAPTERS_SRC, EPIC_CLOSE);
const TICKET_OWNERSHIP_PATH = join(ADAPTERS_SRC, "ticket_ownership.ts");
const HOOK = "pre-tracker-write-gate";
const HOOK_MODULE_PATH = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", `${HOOK}.ts`);
const GRADER_PATH = join(ADAPTERS_SRC, "shared_tracker_live_grader.ts");
const SH_ENTRY_REL = join("templates", "hooks", "process", `${HOOK}.sh`);

const SESSION = "s-797-main";
/** At the declared `min_dpt_version` (2.87.0) of every fixture repository. */
const MANIFEST_VERSION = "2.87.0";
const EPIC = "GK-85";
const MILESTONE = milestoneIdFromEpicKey(EPIC); // M_GK_85
const VERSION = "1.2.0";
const CLOUD = "example.atlassian.net";
const BE_NAME = BE_TAG;
const FE_NAME = FE_TAG;
const BE_FR = "GK-111";
const FE_FR = "GK-101";
const MODEL_CALL = { actionSource: "model_tool_call" } as const;

/** The exact envelope set AC.3 names: the STE-729 keys plus `actionSource`. */
const EXPECTED_EPIC_EDIT_KEYS = ["actionSource", "cloudId", "contentFormat", "fields", "issueIdOrKey", "responseContentFormat"];

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-797-${label}-`)));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupEditTemps();
});

let NEUTRAL_CWD = "";
let SH_ROOT = "";
beforeAll(() => {
  NEUTRAL_CWD = tempDir("neutral");
  SH_ROOT = tempDir("sh-root");
  pluginManifest(SH_ROOT, MANIFEST_VERSION);
  symlinkSync(join(PLUGIN_ROOT, "templates"), join(SH_ROOT, "templates"));
  symlinkSync(join(PLUGIN_ROOT, "adapters"), join(SH_ROOT, "adapters"));
});

// ------------------------------------------------------------------- worlds
// Copied from the STE-699 suite: the permit world (every check holds).

interface World {
  be: string;
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
].join("\n");

function makeWorld(): World {
  const parent = tempDir("world");
  const be = join(parent, BE_NAME);
  const fe = join(parent, FE_NAME);
  mkdirSync(be, { recursive: true });
  mkdirSync(fe, { recursive: true });
  declareJira(be, BE_TAG);
  declareJira(fe, FE_TAG);
  const planFile = writePlan(be, "archive", MILESTONE, { [BE_NAME]: ".", [FE_NAME]: `../${FE_NAME}` }, { shippedIn: `v${VERSION}` });
  writeFr(be, BE_FR, MILESTONE, "archived");
  writeFileSync(join(be, "CHANGELOG.md"), CHANGELOG_SHIPPED);
  writePlan(fe, "archive", MILESTONE, { [BE_NAME]: `../${BE_NAME}`, [FE_NAME]: "." }, { shippedIn: "v3.4.0" });
  writeFr(fe, FE_FR, MILESTONE, "archived");
  for (const root of [be, fe]) {
    git(root, "init", "-q", "-b", "main");
    commitAll(root, "fixture");
  }
  return { be, fe, scratch: tempDir("scratch"), planFile };
}

type Category = "done" | "indeterminate";

function child(key: string, category: Category, labels: string[]): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Child ${key}`,
      status: { name: category === "done" ? "Done" : "In Progress", statusCategory: { key: category } },
      issuetype: { name: "Task" },
      project: { key: "GK" },
      labels,
      parent: { key: EPIC },
    },
  };
}
const DONE_CHILDREN = (): Record<string, unknown> => ({ issues: [child(FE_FR, "done", [FE_TAG]), child(BE_FR, "done", [BE_TAG])], isLast: true });
const ONE_CHILD_OPEN = (): Record<string, unknown> => ({ issues: [child(FE_FR, "indeterminate", [FE_TAG]), child(BE_FR, "done", [BE_TAG])], isLast: true });

let listingSeq = 0;
function saveListing(w: World, listing: unknown): string {
  listingSeq += 1;
  const p = join(w.scratch, `children-${listingSeq}.json`);
  writeFileSync(p, JSON.stringify(listing));
  return p;
}

interface ModuleRun {
  exitCode: number;
  stdout: string;
  stderr: string;
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

function closeEpic(w: World, listing: unknown, key = EPIC): ModuleRun {
  const args = [w.be, key, "--children", saveListing(w, listing)];
  const p = Bun.spawnSync(["bun", "run", EPIC_CLOSE_PATH, ...args], { cwd: NEUTRAL_CWD, env: childEnv(), stdout: "pipe", stderr: "pipe" });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString(), command: `bun run "${EPIC_CLOSE_PATH}" ${args.join(" ")}` };
}

function show(r: { exitCode: number; stdout: string; stderr: string }): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

const announcementLines = (out: string): string[] => out.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));

/** A permitted epic_close.ts run in `w`, checked to have announced exactly one receipt. */
function closedRun(w: World): ModuleRun {
  const r = closeEpic(w, DONE_CHILDREN());
  if (r.exitCode !== 0 || announcementLines(r.stdout).length !== 1) throw new Error(`fixture: epic_close.ts did not permit:\n${show(r)}`);
  return r;
}

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

  run(r: ModuleRun): void {
    this.bash(r.command, r.exitCode === 0 ? r.stdout.trimEnd() : `Exit code ${r.exitCode}\n${r.stderr}`, r.exitCode !== 0);
  }

  private nextId(): string {
    this.seq += 1;
    return `toolu_797_${String(this.seq).padStart(4, "0")}`;
  }
}

const GATED_ID = "toolu_797_gated";
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
// AC-STE-797.1 — `actionSource` is an envelope key in join_consent_ownership.ts
// ===========================================================================

interface OwnershipModule {
  isStatusOnlyTransition: (input: Record<string, unknown>) => boolean;
  labelsEnvelope: (input: unknown) => { extraKeys: string[] } | null;
  EPIC_EDIT_INPUT_KEYS?: ReadonlySet<string>;
}
const ownership = async (): Promise<OwnershipModule> => (await import(OWNERSHIP_PATH)) as OwnershipModule;

describe("AC-STE-797.1 — `actionSource` is an envelope key in join_consent_ownership.ts", () => {
  test("isStatusOnlyTransition accepts cloudId + issueIdOrKey + transition + actionSource \"model_tool_call\"", async () => {
    const { isStatusOnlyTransition } = await ownership();
    expect(isStatusOnlyTransition({ ...statusOnly(EPIC), actionSource: "model_tool_call" })).toBe(true);
  });

  test("isStatusOnlyTransition accepts cloudId + issueIdOrKey + transition + actionSource \"jira_mcp_card\"", async () => {
    const { isStatusOnlyTransition } = await ownership();
    expect(isStatusOnlyTransition({ ...statusOnly(EPIC), actionSource: "jira_mcp_card" })).toBe(true);
  });

  test("CONTROL — isStatusOnlyTransition still refuses `fields` or `update` beside actionSource", async () => {
    const { isStatusOnlyTransition } = await ownership();
    expect({
      fields: isStatusOnlyTransition({ ...statusOnly(EPIC), ...MODEL_CALL, fields: { resolution: { name: "Done" } } }),
      update: isStatusOnlyTransition({ ...statusOnly(EPIC), ...MODEL_CALL, update: { labels: [{ add: "closed" }] } }),
    }).toEqual({ fields: false, update: false });
  });

  test("labelsEnvelope does not count actionSource as an extra key on a labels-only write", async () => {
    const { labelsEnvelope } = await ownership();
    expect(labelsEnvelope({ cloudId: CLOUD, issueIdOrKey: EPIC, fields: { labels: [BE_TAG] }, actionSource: "model_tool_call" })).toEqual({ extraKeys: [] });
  });

  test("CONTROL — labelsEnvelope still counts an unknown top-level key (`foo`) beside actionSource", async () => {
    const { labelsEnvelope } = await ownership();
    expect(labelsEnvelope({ cloudId: CLOUD, issueIdOrKey: EPIC, fields: { labels: [BE_TAG] }, actionSource: "model_tool_call", foo: 1 })).toEqual({ extraKeys: ["foo"] });
  });
});

// ===========================================================================
// AC-STE-797.2 — the gate permits the close carrying actionSource, through
// the shipped `.sh` wrapper; its twins stay refused
// ===========================================================================

describe("AC-STE-797.2 — with an intact epic-close receipt the gate permits a status-only close carrying actionSource", () => {
  let w: World;
  let announced: Transcript;
  beforeAll(() => {
    w = makeWorld();
    announced = new Transcript();
    announced.run(closedRun(w));
  });

  test("CONTROL — the status-only close WITHOUT actionSource is permitted (the receipt is intact)", async () => {
    expectPermit(await gate("transitionJiraIssue", statusOnly(EPIC), announced, w.be), "status-only close");
  });

  test("PERMIT — the status-only close carrying actionSource \"model_tool_call\" → exit 0, silent stdout", async () => {
    expectPermit(await gate("transitionJiraIssue", { ...statusOnly(EPIC), ...MODEL_CALL }, announced, w.be), "status-only close + actionSource");
  });

  test("TWIN — the same close carrying actionSource with no epic_close.ts run in the transcript → refused", async () => {
    expectGateRefusal(await gate("transitionJiraIssue", { ...statusOnly(EPIC), ...MODEL_CALL }, new Transcript(), w.be), "no receipt");
  });

  test("TWIN — `fields` beside actionSource → refused although the receipt is present", async () => {
    expectGateRefusal(await gate("transitionJiraIssue", { ...statusOnly(EPIC), ...MODEL_CALL, fields: { resolution: { name: "Done" } } }, announced, w.be), "fields + actionSource");
  });

  test("TWIN — `update` beside actionSource → refused although the receipt is present", async () => {
    expectGateRefusal(await gate("transitionJiraIssue", { ...statusOnly(EPIC), ...MODEL_CALL, update: { labels: [{ add: "closed" }] } }, announced, w.be), "update + actionSource");
  });
});

// ---------------------------------------------------- live grader helpers

interface Finding {
  code: string;
  item?: string;
  detail?: string;
}
interface GraderModule {
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Finding[] };
}
const grader = async (): Promise<GraderModule> => (await import(GRADER_PATH)) as GraderModule;

const sha256Hex = (s: string): string => new Bun.CryptoHasher("sha256").update(s).digest("hex");

let callSeq = 0;
function appendCall(s: BundleSession, name: string, input: Record<string, unknown>, result: ToolCall["result"]): ToolCall {
  callSeq += 1;
  const c: ToolCall = { ref: `${s.sessionId}:toolu_797_${callSeq}`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name, input, result, sidechain: false };
  s.calls.push(c);
  return c;
}

function appendReceipt(b: LiveBundle, s: BundleSession, kind: "epic-close" | "epic-edit", key: string, command: string, text: (path: string) => string): void {
  const path = `<${s.root}>/.dpt/ledger/receipts/${s.sessionId}/${kind}-${++callSeq}.json`;
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
  appendCall(s, "Bash", { command, description: "run" }, { isError: false, text: text(path), exitCode: 0, items: null, lastPage: null });
}

function appendJiraWrite(s: BundleSession, tool: string, input: Record<string, unknown>): ToolCall {
  return appendCall(s, serverPrefix("jira", s.root) + tool, input, { isError: false, text: "", exitCode: null, items: [], lastPage: null });
}

/** One Jira passing bundle; in session S13 an epic-close receipt for a fresh key, then `write(key)`. True when the write draws ungated-write. */
async function gradeClose(write: (key: string) => Record<string, unknown>): Promise<boolean> {
  const g = await grader();
  const b = buildPassingBundle("jira");
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const key = `${b.run.container}-870`;
  appendReceipt(b, s, "epic-close", key, `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${EPIC_CLOSE}" <${s.root}> ${key} --children <${s.root}>/.dpt/tmp/children.json`, (p) => `closed\ndpt-receipt: ${p} sha256:${sha256Hex(p)}`);
  const w = appendJiraWrite(s, "transitionJiraIssue", write(key));
  const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
  return v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${w.ref}:`));
}

/** One Jira passing bundle; in session S13 an epic-edit receipt, the answer `Edit <KEY>`, then an editJiraIssue with `input(key)`. True when it draws ungated-write. */
async function gradeEdit(input: (key: string) => Record<string, unknown>): Promise<boolean> {
  const g = await grader();
  const b = buildPassingBundle("jira");
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const key = `${b.run.container}-880`;
  appendReceipt(
    b,
    s,
    "epic-edit",
    key,
    `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/epic_edit.ts" <${s.root}> ${key}`,
    (p) => `default=forbidden\noptions=${JSON.stringify([`Edit ${key}`, `Skip ${key}`])}\ndpt-receipt: ${p} sha256:${sha256Hex(p)}`,
  );
  const question = `Edit the description or summary of Epic ${key}?`;
  appendCall(
    s,
    "AskUserQuestion",
    { questions: [{ question, header: "Epic", options: [{ label: `Edit ${key}` }, { label: `Skip ${key}` }], multiSelect: false }] },
    { isError: false, text: `User has answered your questions: "${question}"="Edit ${key}". You can now continue with the user's answers in mind.`, exitCode: null, items: null, lastPage: null },
  );
  const w = appendJiraWrite(s, "editJiraIssue", input(key));
  const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
  return v.findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${w.ref}:`));
}

const graderTransition = (k: string): Record<string, unknown> => ({ cloudId: "cloud-dst", issueIdOrKey: k, transition: { id: "41" } });

describe("AC-STE-797.2 (grader twin) — the live grader gates the status-only close carrying actionSource", () => {
  test("CONTROL — the status-only close without actionSource after its epic-close receipt is gated", async () => {
    expect(await gradeClose(graderTransition)).toBe(false);
  });

  test("PERMIT — the status-only close carrying actionSource \"model_tool_call\" is gated (no ungated-write)", async () => {
    expect(await gradeClose((k) => ({ ...graderTransition(k), ...MODEL_CALL }))).toBe(false);
  });

  test("TWIN — `fields` beside actionSource → ungated-write", async () => {
    expect(await gradeClose((k) => ({ ...graderTransition(k), ...MODEL_CALL, fields: { resolution: { name: "Done" } } }))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-797.3 — the Epic edit check accepts actionSource, hook and grader
// alike, from ONE shared key set
// ===========================================================================

describe("AC-STE-797.3 — one shared EPIC_EDIT_INPUT_KEYS, exported by join_consent_ownership.ts, carries actionSource", () => {
  test("join_consent_ownership.ts exports EPIC_EDIT_INPUT_KEYS = the STE-729 envelope keys plus actionSource", async () => {
    const m = await ownership();
    expect(m.EPIC_EDIT_INPUT_KEYS instanceof Set, "EPIC_EDIT_INPUT_KEYS is exported as a Set").toBe(true);
    expect([...m.EPIC_EDIT_INPUT_KEYS!].sort()).toEqual(EXPECTED_EPIC_EDIT_KEYS);
  });

  for (const [name, path] of [
    ["the hook (pre-tracker-write-gate.ts)", HOOK_MODULE_PATH],
    ["the live grader (shared_tracker_live_grader.ts)", GRADER_PATH],
  ] as const) {
    test(`${name} defines no EPIC_EDIT_INPUT_KEYS copy of its own`, () => {
      const src = readFileSync(path, "utf-8");
      expect(src).not.toMatch(/\bconst\s+EPIC_EDIT_INPUT_KEYS\b/);
    });

    test(`${name} imports EPIC_EDIT_INPUT_KEYS from join_consent_ownership`, () => {
      const src = readFileSync(path, "utf-8");
      const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*join_consent_ownership(?:\.ts)?["']/g)].map((m) => m[1]!);
      expect(imports.some((names) => /\bEPIC_EDIT_INPUT_KEYS\b/.test(names)), "an import from join_consent_ownership names EPIC_EDIT_INPUT_KEYS").toBe(true);
    });
  }
});

describe("AC-STE-797.3 — the hook's Epic edit check accepts actionSource beside its envelope keys (shipped `.sh` wrapper)", () => {
  const consented = (w: ReturnType<typeof makeEditWorld>) => {
    const { t } = editedTranscript(PLUGIN_ROOT, w);
    askEdit(t, EDIT_EPIC, EDIT_LABEL(EDIT_EPIC));
    return t;
  };

  test("CONTROL — the consented description edit without actionSource is permitted", async () => {
    const w = makeEditWorld();
    const r = await editGate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(EDIT_EPIC), consented(w), w.root);
    expect(permitProblem(r), showEdit(r)).toBeNull();
  });

  test("PERMIT — the consented description edit carrying actionSource \"model_tool_call\" → permitted", async () => {
    const w = makeEditWorld();
    const r = await editGate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(EDIT_EPIC, undefined, { ...MODEL_CALL }), consented(w), w.root);
    expect(permitProblem(r), showEdit(r)).toBeNull();
  });

  test("PERMIT — description + summary with contentFormat, responseContentFormat and actionSource → permitted", async () => {
    const w = makeEditWorld();
    const input = editInput(EDIT_EPIC, { description: "Body", summary: "Title" }, { contentFormat: "markdown", responseContentFormat: "markdown", ...MODEL_CALL });
    const r = await editGate(PLUGIN_ROOT, JIRA("editJiraIssue"), input, consented(w), w.root);
    expect(permitProblem(r), showEdit(r)).toBeNull();
  });

  test("TWIN — an `update` block beside actionSource → refused", async () => {
    const w = makeEditWorld();
    const r = await editGate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(EDIT_EPIC, undefined, { ...MODEL_CALL, update: { labels: [{ add: "x" }] } }), consented(w), w.root);
    expect(refusalProblem(r), showEdit(r)).toBeNull();
  });
});

describe("AC-STE-797.3 — the live grader's Epic edit check accepts actionSource", () => {
  const desc = (k: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ cloudId: "cloud-dst", issueIdOrKey: k, fields: { description: "Body" }, ...extra });

  test("CONTROL — the consented description edit without actionSource is gated", async () => {
    expect(await gradeEdit((k) => desc(k))).toBe(false);
  });

  test("PERMIT — the consented description edit carrying actionSource is gated (no ungated-write)", async () => {
    expect(await gradeEdit((k) => desc(k, { ...MODEL_CALL }))).toBe(false);
  });

  test("TWIN — an `update` block beside actionSource → ungated-write", async () => {
    expect(await gradeEdit((k) => desc(k, { ...MODEL_CALL, update: { labels: [{ add: "x" }] } }))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-797.4 — the "not a plain invocation" note leaves out a rejected
// command a later plain run of the same deciding module superseded
// ===========================================================================

const NOTE = /(\d+) Bash command\(s\) ran a deciding subcommand in a shape that is not a plain invocation, so any receipt they wrote was ignored — the latest: `([^`]*)`/;

/** How the note quotes a command: the first 240 characters, then an ellipsis (the shipped note's cut). */
const cited = (cmd: string): string => (cmd.length > 240 ? `${cmd.slice(0, 240)}…` : cmd);

/** The note's count and cited command, or null when the refusal carries no note. */
function noteOf(r: Run): { count: number; latest: string } | null {
  const m = NOTE.exec(r.stderr);
  return m === null ? null : { count: Number(m[1]), latest: m[2]! };
}

describe("AC-STE-797.4 — the 'not a plain invocation' note covers only commands no later plain run superseded", () => {
  let w: World;
  let listing: string;
  let refusedPlain: ModuleRun;
  beforeAll(() => {
    w = makeWorld();
    listing = saveListing(w, DONE_CHILDREN());
    // A plain epic_close.ts run in the accepted shape that refuses (one child
    // open): it announces nothing, so the close stays refused and the note shows.
    refusedPlain = closeEpic(w, ONE_CHILD_OPEN());
    if (refusedPlain.exitCode === 0) throw new Error(`fixture: the plain run must refuse:\n${show(refusedPlain)}`);
  });
  const wrappedClose = () => `cd "${w.be}" && bun run "${EPIC_CLOSE_PATH}" ${w.be} ${EPIC} --children ${listing}`;
  const wrappedConfirm = () => `cd "${w.be}" && bun run "${TICKET_OWNERSHIP_PATH}" confirm ${w.be} ${EPIC} ${join(w.scratch, "ticket.json")}`;

  test("CONTROL — only the wrapped epic_close.ts run → refused, the note counts 1 and cites it", async () => {
    const t = new Transcript();
    t.bash(wrappedClose(), "closed");
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "wrapped only");
    expect(noteOf(r), show(r)).toEqual({ count: 1, latest: cited(wrappedClose()) });
  });

  test("SUPERSEDED — the wrapped run, then a plain run of epic_close.ts → refused, and the note is left out", async () => {
    const t = new Transcript();
    t.bash(wrappedClose(), "closed");
    t.run(refusedPlain);
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "wrapped then plain");
    expect(noteOf(r), show(r)).toBeNull();
  });

  // Phase 3 review (Pass 2): "ran" means the plain run executed — its result is
  // a success or an `Exit code N` error. A call that was denied, or whose result
  // has not landed, never ran, so it supersedes nothing.
  test("DENIED — the wrapped run, then a plain run whose call was denied → the note still counts 1 and cites the wrapped run", async () => {
    const t = new Transcript();
    t.bash(wrappedClose(), "closed");
    t.bash(refusedPlain.command, "Permission to use Bash has been denied.", true);
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "wrapped then denied plain");
    expect(noteOf(r), show(r)).toEqual({ count: 1, latest: cited(wrappedClose()) });
  });

  test("NO RESULT — the wrapped run, then a plain run with no result yet → the note still counts 1 and cites the wrapped run", async () => {
    const t = new Transcript();
    t.bash(wrappedClose(), "closed");
    t.use("Bash", { command: refusedPlain.command, description: "run" });
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "wrapped then pending plain");
    expect(noteOf(r), show(r)).toEqual({ count: 1, latest: cited(wrappedClose()) });
  });

  test("ORDER — a plain run BEFORE the wrapped run does not supersede it: the note counts 1 and cites the wrapped run", async () => {
    const t = new Transcript();
    t.run(refusedPlain);
    t.bash(wrappedClose(), "closed");
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "plain then wrapped");
    expect(noteOf(r), show(r)).toEqual({ count: 1, latest: cited(wrappedClose()) });
  });

  test("COUNT — a wrapped ticket_ownership.ts run, a wrapped epic_close.ts run, then a plain epic_close.ts run → the note counts 1 and cites the ticket_ownership.ts run", async () => {
    const t = new Transcript();
    t.bash(wrappedConfirm(), "confirmed");
    t.bash(wrappedClose(), "closed");
    t.run(refusedPlain);
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "two rejected, one superseded");
    expect(noteOf(r), show(r)).toEqual({ count: 1, latest: cited(wrappedConfirm()) });
  });

  test("CONTROL (COUNT) — the same two wrapped runs with no plain run → the note counts 2 and cites the later one", async () => {
    const t = new Transcript();
    t.bash(wrappedConfirm(), "confirmed");
    t.bash(wrappedClose(), "closed");
    const r = await gate("transitionJiraIssue", statusOnly(EPIC), t, w.be);
    expectGateRefusal(r, "two rejected");
    expect(noteOf(r), show(r)).toEqual({ count: 2, latest: cited(wrappedClose()) });
  });
});
