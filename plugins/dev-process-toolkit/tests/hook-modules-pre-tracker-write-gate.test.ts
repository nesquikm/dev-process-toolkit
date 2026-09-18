// STE-607 (M_947c79) — `_lib/hooks/pre-tracker-write-gate.ts`: a PreToolUse
// hook that refuses shared-container tracker writes no deciding command
// approved in this session.
//
// Every behavioural case here SPAWNS the entry point exactly as the harness
// does: `bun run <module>`, the PreToolUse payload JSON on stdin, a fixture
// transcript on disk (JSONL in the real Claude Code shape — an `assistant` line
// carrying `message.content[].tool_use` and a `user` line carrying the paired
// `message.content[].tool_result`), over `makeSpanFixture` roots initialised as
// git repositories. The spawned process runs from a directory that is NOT a git
// repository, so a hook that read `process.cwd()` instead of `payload.cwd`
// cannot pass.
//
// ---------------------------------------------------------------------------
// CONTRACT this suite reads from the hook module (the implementer satisfies it)
// ---------------------------------------------------------------------------
//   export const TRACKER_WRITE_TOOLS: readonly string[]      — §1, the 26 names
//   export const TRACKER_READ_TOOLS: readonly string[]
//   export const UNGATED_WRITE_TOOLS: Readonly<Record<string, string>>
//                                     — name -> one-line reason
//   export const RECEIPT_ANNOUNCING_MODULES: readonly string[] — module basenames
//   The stdin-reading entry is guarded by `if (import.meta.main)`, so importing
//   the module for its constants has no side effect.
//
// The running version is read from the hook's own manifest through
// `runningDptVersion()`, i.e. `$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json`;
// every spawn points CLAUDE_PLUGIN_ROOT at a fixture manifest directory.
//
// Blocking-gate derivation (§7 third bullet) — THE CHOICE IS THE RECORDED
// EXEMPTION, not a second demand family. `tests/_blocking_gates.ts` derives
// gates from Skill-demand calls and must carry no gate name; this gate demands
// receipts, not a Skill, so it has no `skill` for the STE-573 announcement legs
// to grade. The exemption is recorded in `RECEIPT_GATE_EXEMPTION` below, the
// derivation is asserted NOT to list the gate (so the exemption is not a dead
// letter), and the announcement legs the derivation would have driven are
// graded here directly (AC-STE-607.10).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";
import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import {
  RECEIPT_ANNOUNCEMENT_PREFIX,
  writeReceipt,
  type ReceiptInput,
} from "../adapters/_shared/src/tracker_receipts";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";
import { BE_TAG, FE_TAG, boundFr, declareJira, declareLinear } from "./_orphan_pages";
import { deriveBlockingGates } from "./_blocking_gates";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const ADAPTERS_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const HOOK = "pre-tracker-write-gate";
const MODULE_PATH = join(PLUGIN_ROOT, "templates", "hooks", "_lib", "hooks", `${HOOK}.ts`);
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");
const INVENTORY = join(PLUGIN_ROOT, "tests", "fixtures", "tracker-tool-inventory.json");

const SESSION = "s-607-main";
const OTHER_SESSION = "s-607-other";
const MANIFEST_VERSION = "2.87.0";
const GATING_MILESTONE = "M_685ff6";

const DECIDE = "create_idempotency_probe.ts";
const CONSENT = "container_ownership.ts";
const CONFIRM = "ticket_ownership.ts";

/** §1 — the list, verbatim from the FR. */
const FR_WRITE_LIST = [
  "createJiraIssue",
  "editJiraIssue",
  "transitionJiraIssue",
  "addCommentToJiraIssue",
  "addWorklogToJiraIssue",
  "createIssueLink",
  "save_issue",
  "save_milestone",
  "save_comment",
  "delete_comment",
  "create_attachment",
  "create_attachment_from_upload",
  "delete_attachment",
  "share_issue",
  "unshare_issue",
  "save_project",
  "create_issue_label",
  "save_issue_label",
  "retire_issue_label",
  "restore_issue_label",
  "save_project_label",
  "retire_project_label",
  "restore_project_label",
  "save_status_update",
  "delete_status_update",
  "save_document",
] as const;
const ATLASSIAN_WRITES = new Set(FR_WRITE_LIST.slice(0, 6));

// ------------------------------------------------------------------ cleanup

const tempDirs: string[] = [];
const cleanups: Array<() => void> = [];

function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-607-${label}-`)));
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

/** A neutral directory the hook process runs FROM — never a git repository. */
let NEUTRAL_CWD: string;
/** A valid manifest directory at MANIFEST_VERSION. */
let MANIFEST_DIR: string;

beforeAll(() => {
  NEUTRAL_CWD = tempDir("neutral");
  MANIFEST_DIR = tempDir("manifest");
  pluginManifest(MANIFEST_DIR, MANIFEST_VERSION);
});

// ---------------------------------------------------------------------- git

function git(root: string, ...args: string[]): string {
  const p = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=dpt-607",
      "-c",
      "user.email=dpt-607@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-C",
      root,
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} in ${root} failed: ${p.stderr.toString()}`);
  }
  return p.stdout.toString();
}

/** `git init` + add everything + one commit. */
function gitInit(root: string): void {
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "fixture");
}

// ------------------------------------------------------------------- worlds

interface World {
  fe: string;
  be: string;
  scratch: string;
}

/**
 * The two-repo Jira world of AC-STE-607.3: FE (`glacy-fe`) and BE (`glacy-be`)
 * share Jira project GF. FE's FRs bind GF-101/GF-102, BE's binds GF-111. Both
 * are git repositories with their FR files in the index.
 */
function makeWorld(opts: { beFloor?: string } = {}): World {
  const span = makeSpanFixture("M_GF_85");
  cleanups.push(() => span.cleanup());
  const fe = realpathSync(span.a);
  const be = realpathSync(span.b);
  declareJira(fe, FE_TAG);
  if (opts.beFloor === undefined) declareJira(be, BE_TAG);
  else {
    claudeMd(be, {
      mode: "jira",
      project: "GF",
      defaultLabels: [BE_TAG],
      repoTag: BE_TAG,
      minDptVersion: opts.beFloor,
    });
  }
  boundFr(fe, "GF-101");
  boundFr(fe, "GF-102");
  boundFr(be, "GF-111");
  gitInit(fe);
  gitInit(be);
  return { fe, be, scratch: tempDir("scratch") };
}

/** One git repository at `root` with a Linear declaration (or none). */
function linearRepo(tag: string | null): string {
  const root = tempDir("linear");
  declareLinear(root, tag);
  gitInit(root);
  return root;
}

// ----------------------------------------------------------------- receipts

function receiptIn(root: string, input: ReceiptInput, session = SESSION): string {
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = session;
  try {
    return resolve(writeReceipt(root, input));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = prev;
  }
}

interface CreateShape {
  title: string;
  labels?: string[];
  parent?: string | null;
}

/** A `create` receipt shaped exactly as `decide` writes one (STE-604). */
function createReceipt(root: string, c: CreateShape, session = SESSION): string {
  const parent = c.parent === undefined ? "GF-85" : c.parent;
  return receiptIn(
    root,
    {
      kind: "create",
      adapter: "jira",
      container: parent ?? "",
      subject: c.title,
      decision: "create",
      evidence: {
        createPayload: {
          project: "GF",
          summary: c.title,
          labels: c.labels ?? [BE_TAG],
          ...(parent ? { parent } : {}),
        },
      },
    },
    session,
  );
}

/** A `reuse` receipt as `decide` writes one: subject is the title, key in evidence. */
function reuseReceipt(root: string, key: string, title: string): string {
  return receiptIn(root, {
    kind: "reuse",
    adapter: "jira",
    container: "GF-85",
    subject: title,
    decision: "reused",
    evidence: { key },
  });
}

/** An `import` receipt as `container_ownership.ts consent` writes one (STE-605). */
function importReceipt(root: string, key: string): string {
  return receiptIn(root, {
    kind: "import",
    adapter: "jira",
    container: "GF",
    subject: key,
    decision: "import",
    evidence: { class: "unowned", labels: [], hasBackLink: false },
  });
}

/** A `binding` receipt of an ADOPTED ticket, as `ticket_ownership.ts confirm --adopt` writes one (STE-606). */
function adoptReceipt(root: string, key: string): string {
  return receiptIn(root, {
    kind: "binding",
    adapter: "jira",
    container: "GF",
    subject: key,
    decision: "adopt",
    evidence: { verdict: "unowned", tracked: 0 },
  });
}

// --------------------------------------------------------------- transcript

let transcriptSeq = 0;

type AskOutcome = { answer: string } | "error" | "denied";

/** A session transcript in the real Claude Code JSONL shape. */
class Session {
  readonly lines: string[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `toolu_607_${String(this.seq).padStart(5, "0")}`;
  }

  toolUse(name: string, input: unknown): string {
    const id = this.nextId();
    this.lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
      }),
    );
    return id;
  }

  toolResult(id: string, content: unknown, isError = false, extra: Record<string, unknown> = {}): void {
    this.lines.push(
      JSON.stringify({
        type: "user",
        sessionId: SESSION,
        message: {
          role: "user",
          content: [
            { tool_use_id: id, type: "tool_result", content, ...(isError ? { is_error: true } : {}) },
          ],
        },
        ...extra,
      }),
    );
  }

  text(t: string): void {
    this.lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId: SESSION,
        message: { role: "assistant", content: [{ type: "text", text: t }] },
      }),
    );
  }

  bash(command: string, output: string, isError = false): string {
    const id = this.toolUse("Bash", { command, description: "run" });
    this.toolResult(id, output, isError);
    return id;
  }

  /** A deciding command's Bash call whose output announces `receiptPath`. */
  announce(
    module: string,
    args: string,
    receiptPath: string,
    decisionLine = '{"outcome":"create","reason":"proven-absent"}',
    isError = false,
  ): string {
    return this.bash(
      `bun run "${join(ADAPTERS_SRC, module)}" ${args}`,
      `${decisionLine}\n${RECEIPT_ANNOUNCEMENT_PREFIX}${receiptPath}`,
      isError,
    );
  }

  /** `decide` for a Jira create in `root`. */
  announceDecide(root: string, receiptPath: string, attempt = "fast", title = "BE payout export"): string {
    return this.announce(
      DECIDE,
      `decide "${root}" /tmp/page.json --title "${title}" --parent GF-85 --attempt ${attempt}`,
      receiptPath,
    );
  }

  /** An MCP call and its result. Success results are MCP text blocks. */
  mcp(tool: string, input: unknown, result: unknown, isError = false): string {
    const id = this.toolUse(tool, input);
    const content = isError
      ? String(result)
      : [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }];
    this.toolResult(id, content, isError);
    return id;
  }

  /** The AskUserQuestion a deciding command's option labels drive. */
  ask(key: string, verb: "Import" | "Adopt", outcome: AskOutcome): string {
    const question = `${verb} ${key} into this repository?`;
    const questions = [
      {
        question,
        header: verb,
        multiSelect: false,
        options: [
          { label: `${verb} ${key}`, description: `${verb} the ticket.` },
          { label: `Skip ${key}`, description: "Leave it alone." },
        ],
      },
    ];
    const id = this.toolUse("AskUserQuestion", { questions });
    if (outcome === "error") {
      this.toolResult(
        id,
        "<tool_use_error>InputValidationError: AskUserQuestion failed</tool_use_error>",
        true,
      );
    } else if (outcome === "denied") {
      this.toolResult(
        id,
        "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
        true,
      );
    } else {
      this.toolResult(
        id,
        `Your questions have been answered: "${question}"="${outcome.answer}". You can now continue with these answers in mind.`,
        false,
        { toolUseResult: { questions, answers: { [question]: outcome.answer } } },
      );
    }
    return id;
  }

  save(dir: string): string {
    transcriptSeq += 1;
    const p = join(dir, `transcript-${transcriptSeq}.jsonl`);
    writeFileSync(p, this.lines.join("\n") + (this.lines.length ? "\n" : ""));
    return p;
  }
}

// ------------------------------------------------------------------ running

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  cwd: string;
  transcript: string;
  sessionId?: string;
  pluginRoot?: string;
}

function payload(tool: string, input: unknown, o: RunOpts): string {
  return JSON.stringify({
    session_id: o.sessionId ?? SESSION,
    transcript_path: o.transcript,
    cwd: o.cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: input,
    tool_use_id: "toolu_607_pending",
  });
}

async function runRaw(stdin: string, pluginRoot?: string): Promise<Run> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PROJECT_DIR;
  env.CLAUDE_PLUGIN_ROOT = pluginRoot ?? MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  const proc = Bun.spawn(["bun", "run", MODULE_PATH], {
    cwd: NEUTRAL_CWD,
    env,
    stdin: new Response(stdin).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

function runHook(tool: string, input: unknown, o: RunOpts): Promise<Run> {
  return runRaw(payload(tool, input, o), o.pluginRoot);
}

function show(r: Run): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function expectPermit(r: Run): void {
  if (r.exitCode !== 0) throw new Error(`expected exit 0 (permit), got:\n${show(r)}`);
  expect(r.stdout).toBe("");
}

function expectSilent(r: Run): void {
  if (r.exitCode !== 0 || r.stdout !== "" || r.stderr !== "") {
    throw new Error(`expected exit 0 with empty stdout and stderr, got:\n${show(r)}`);
  }
}

function expectRefusal(r: Run, ...needles: Array<string | RegExp>): void {
  if (r.exitCode !== 2) throw new Error(`expected exit 2 (refusal), got:\n${show(r)}`);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("Refusing:");
  expect(r.stderr).toContain("Remedy:");
  expect(r.stderr).toContain(`hook=${HOOK}`);
  for (const n of needles) {
    if (typeof n === "string") expect(r.stderr).toContain(n);
    else expect(r.stderr).toMatch(n);
  }
}

// --------------------------------------------------------- tool call inputs

const CLOUD = "glacy.atlassian.net";
const JIRA = (t: string) => `mcp__atlassian__${t}`;
const LINEAR = (t: string) => `mcp__linear__${t}`;

interface JiraCreate {
  title?: string;
  labels?: string[];
  parent?: string | null;
  parentVia?: "arg" | "additional";
  type?: string;
}

function jiraCreate(c: JiraCreate = {}): Record<string, unknown> {
  const parent = c.parent === undefined ? "GF-85" : c.parent;
  const via = c.parentVia ?? "arg";
  return {
    cloudId: CLOUD,
    projectKey: "GF",
    issueTypeName: c.type ?? "Task",
    summary: c.title ?? "BE payout export",
    description: "Some body.\n\nSource: specs/frs/GF-NEW.md",
    ...(parent && via === "arg" ? { parent } : {}),
    additional_fields: {
      labels: c.labels ?? [BE_TAG],
      ...(parent && via === "additional" ? { parent: { key: parent } } : {}),
    },
  };
}

const transition = (key: string) => ({
  cloudId: CLOUD,
  issueIdOrKey: key,
  transition: { id: "31" },
});

/** A plausible input for every write tool — used by the undeclared matrix. */
function sampleInput(tool: string): Record<string, unknown> {
  switch (tool) {
    case "createJiraIssue":
      return jiraCreate();
    case "editJiraIssue":
      return { cloudId: CLOUD, issueIdOrKey: "GF-111", fields: { summary: "Renamed" } };
    case "transitionJiraIssue":
      return transition("GF-111");
    case "addCommentToJiraIssue":
      return { cloudId: CLOUD, issueIdOrKey: "GF-111", commentBody: "Progress." };
    case "addWorklogToJiraIssue":
      return { cloudId: CLOUD, issueIdOrKey: "GF-111", timeSpent: "1h" };
    case "createIssueLink":
      return { cloudId: CLOUD, inwardIssue: "GF-111", outwardIssue: "GF-101", type: "Relates" };
    case "save_issue":
      return { team: "STE", project: "DPT", title: "A new ticket", labels: [] };
    case "save_milestone":
      return { project: "DPT", name: "M_x" };
    case "save_comment":
      return { issueId: "STE-111", body: "Progress." };
    case "delete_comment":
      return { id: "5d3f0f5e-0000-4000-8000-000000000001" };
    case "create_attachment":
      return { issue: "STE-111", title: "log", url: "https://example.invalid/log" };
    case "create_attachment_from_upload":
      return { issue: "STE-111", title: "log", uploadId: "upl_1" };
    case "delete_attachment":
      return { id: "5d3f0f5e-0000-4000-8000-000000000002" };
    case "share_issue":
    case "unshare_issue":
      return { id: "STE-111" };
    case "save_project":
      return { name: "DPT", team: "STE" };
    case "create_issue_label":
    case "save_issue_label":
      return { name: "some-label", team: "STE" };
    case "save_project_label":
      return { name: "some-project-label" };
    case "retire_issue_label":
    case "restore_issue_label":
    case "retire_project_label":
    case "restore_project_label":
      return { id: "5d3f0f5e-0000-4000-8000-000000000003" };
    case "save_status_update":
      return { project: "DPT", body: "On track." };
    case "delete_status_update":
      return { id: "5d3f0f5e-0000-4000-8000-000000000004" };
    case "save_document":
      return { project: "DPT", title: "Notes", content: "Body." };
    default:
      throw new Error(`no sample input for ${tool}`);
  }
}

// ---------------------------------------------------------- module surface

interface HookModule {
  TRACKER_WRITE_TOOLS: readonly string[];
  TRACKER_READ_TOOLS: readonly string[];
  UNGATED_WRITE_TOOLS: Readonly<Record<string, string>>;
  RECEIPT_ANNOUNCING_MODULES: readonly string[];
}

async function hookModule(): Promise<HookModule> {
  return (await import(MODULE_PATH)) as HookModule;
}

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}

function preToolUseGroups(): HookGroup[] {
  const parsed = JSON.parse(readFileSync(HOOKS_JSON, "utf-8")) as {
    hooks?: { PreToolUse?: HookGroup[] };
  };
  return parsed.hooks?.PreToolUse ?? [];
}

function gateGroup(): HookGroup | undefined {
  return preToolUseGroups().find((g) =>
    (g.hooks ?? []).some((h) => (h.command ?? "").endsWith(`/templates/hooks/process/${HOOK}.sh`)),
  );
}

// ===========================================================================
// AC-STE-607.1 — byte-identical when undeclared
// ===========================================================================

describe("AC-STE-607.1 — undeclared repositories see no change", () => {
  test("every TRACKER_WRITE_TOOLS tool × {no CLAUDE.md, mode: none, tracker mode with no tag} → exit 0, empty stdout, empty stderr", async () => {
    const { TRACKER_WRITE_TOOLS } = await hookModule();
    expect(TRACKER_WRITE_TOOLS.length).toBe(FR_WRITE_LIST.length);

    const noClaudeMd = tempDir("undeclared-none");
    gitInit(noClaudeMd);
    const modeNone = tempDir("undeclared-mode-none");
    writeFileSync(
      join(modeNone, "CLAUDE.md"),
      "# Fixture\n\n## Task Tracking\n\nmode: none\n\n## Verification\n\nrun_cmd: none\n",
    );
    gitInit(modeNone);
    const jiraNoTag = tempDir("undeclared-jira");
    declareJira(jiraNoTag, null);
    gitInit(jiraNoTag);
    const linearNoTag = linearRepo(null);

    const scratch = tempDir("undeclared-scratch");
    const transcript = new Session().save(scratch);

    const cases: Array<{ label: string; tool: string; full: string; cwd: string }> = [];
    for (const tool of TRACKER_WRITE_TOOLS) {
      const tracker = ATLASSIAN_WRITES.has(tool as never) ? jiraNoTag : linearNoTag;
      const full = ATLASSIAN_WRITES.has(tool as never) ? JIRA(tool) : LINEAR(tool);
      cases.push({ label: `${tool} / no CLAUDE.md`, tool, full, cwd: noClaudeMd });
      cases.push({ label: `${tool} / mode: none`, tool, full, cwd: modeNone });
      cases.push({ label: `${tool} / tracker mode, no tag`, tool, full, cwd: tracker });
    }
    const runs = await Promise.all(
      cases.map((c) => runHook(c.full, sampleInput(c.tool), { cwd: c.cwd, transcript })),
    );
    const failures = runs
      .map((r, i) => ({ r, c: cases[i]! }))
      .filter(({ r }) => r.exitCode !== 0 || r.stdout !== "" || r.stderr !== "")
      .map(({ r, c }) => `${c.label}: ${show(r)}`);
    expect(failures).toEqual([]);
    expect(runs.length).toBe(FR_WRITE_LIST.length * 3);
  }, 120_000);

  test("an announced receipt root that is itself undeclared keeps the hook silent", async () => {
    const cwd = tempDir("undeclared-cwd");
    declareJira(cwd, null);
    gitInit(cwd);
    const other = tempDir("undeclared-announced");
    declareJira(other, null);
    gitInit(other);
    const path = createReceipt(other, { title: "BE payout export" });
    const s = new Session();
    s.announceDecide(other, path);
    const transcript = s.save(tempDir("undeclared-scratch2"));
    for (const [tool, input] of [
      [JIRA("createJiraIssue"), jiraCreate()],
      [JIRA("transitionJiraIssue"), transition("GF-101")],
      [JIRA("createJiraIssue"), jiraCreate({ type: "Epic", parent: null })],
    ] as const) {
      expectSilent(await runHook(tool, input, { cwd, transcript }));
    }
  }, 30_000);
});

// ===========================================================================
// AC-STE-607.2 — the matcher and the inventory
// ===========================================================================

const SPELLINGS = ["atlassian", "claude_ai_Atlassian", "linear", "claude_ai_Linear"] as const;
const READ_CONTROLS = [
  "getJiraIssue",
  "searchJiraIssuesUsingJql",
  "getTransitionsForJiraIssue",
  "list_issues",
  "get_issue",
  "list_milestones",
] as const;

describe("AC-STE-607.2 — hooks.json matcher, derived from TRACKER_WRITE_TOOLS", () => {
  test("TRACKER_WRITE_TOOLS is exactly the FR §1 list", async () => {
    const { TRACKER_WRITE_TOOLS } = await hookModule();
    expect([...TRACKER_WRITE_TOOLS].sort()).toEqual([...FR_WRITE_LIST].sort());
    expect(new Set(TRACKER_WRITE_TOOLS).size).toBe(TRACKER_WRITE_TOOLS.length);
  });

  test("hooks.json registers the gate in its own PreToolUse group: the shim command, timeout 5000", () => {
    const group = gateGroup();
    expect(group).toBeDefined();
    const hooks = group!.hooks ?? [];
    expect(hooks.length).toBe(1);
    expect(hooks[0]!.type).toBe("command");
    expect(hooks[0]!.command).toBe(`"\${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/${HOOK}.sh`);
    expect(hooks[0]!.timeout).toBe(5000);
    expect(existsSync(join(PLUGIN_ROOT, "templates", "hooks", "process", `${HOOK}.sh`))).toBe(true);
  });

  test("the registered matcher equals the one re-derived from TRACKER_WRITE_TOOLS", async () => {
    const { TRACKER_WRITE_TOOLS } = await hookModule();
    const derived = `^mcp__.+__(${TRACKER_WRITE_TOOLS.join("|")})$`;
    expect(gateGroup()?.matcher).toBe(derived);
  });

  test("the compiled matcher matches every listed tool under all four server spellings", () => {
    const re = new RegExp(gateGroup()!.matcher!);
    const misses: string[] = [];
    for (const tool of FR_WRITE_LIST) {
      for (const server of SPELLINGS) {
        const name = `mcp__${server}__${tool}`;
        if (!re.test(name)) misses.push(name);
      }
    }
    expect(misses).toEqual([]);
  });

  test("the compiled matcher matches none of the read-only controls, under any spelling, nor Bash", () => {
    const re = new RegExp(gateGroup()!.matcher!);
    const hits: string[] = [];
    for (const tool of READ_CONTROLS) {
      for (const server of SPELLINGS) {
        const name = `mcp__${server}__${tool}`;
        if (re.test(name)) hits.push(name);
      }
    }
    if (re.test("Bash")) hits.push("Bash");
    expect(hits).toEqual([]);
  });
});

interface Inventory {
  captured_at: string;
  source: string;
  servers: Record<string, { prefix: string; count: number; tools: string[] }>;
}

function readInventory(): Inventory {
  return JSON.parse(readFileSync(INVENTORY, "utf-8")) as Inventory;
}

/** The names of `inventory` that sit in NOT exactly one of the three sets. */
function unpartitioned(names: readonly string[], m: HookModule): string[] {
  const write = new Set(m.TRACKER_WRITE_TOOLS);
  const read = new Set(m.TRACKER_READ_TOOLS);
  const ungated = new Set(Object.keys(m.UNGATED_WRITE_TOOLS));
  return names.filter(
    (n) => Number(write.has(n)) + Number(read.has(n)) + Number(ungated.has(n)) !== 1,
  );
}

describe("AC-STE-607.2 — the tool inventory partitions into the three sets", () => {
  test("the checked-in inventory records its capture date and per-server counts that match its lists", () => {
    const inv = readInventory();
    expect(inv.captured_at).toBe("2026-09-18");
    expect(Object.keys(inv.servers).sort()).toEqual(["atlassian", "linear"]);
    expect(inv.servers.atlassian!.count).toBe(40);
    expect(inv.servers.linear!.count).toBe(66);
    for (const s of Object.values(inv.servers)) {
      expect(s.tools.length).toBe(s.count);
      expect(new Set(s.tools).size).toBe(s.count);
    }
  });

  test("every inventory name sits in exactly one of TRACKER_WRITE_TOOLS, TRACKER_READ_TOOLS, UNGATED_WRITE_TOOLS", async () => {
    const m = await hookModule();
    const names = Object.values(readInventory().servers).flatMap((s) => s.tools);
    expect(names.length).toBe(106);
    expect(unpartitioned(names, m)).toEqual([]);
  });

  test("CONTROL — a planted unknown name fails the partition", async () => {
    const m = await hookModule();
    const names = Object.values(readInventory().servers).flatMap((s) => s.tools);
    expect(unpartitioned([...names, "frobnicate_issue"], m)).toEqual(["frobnicate_issue"]);
  });

  test("every listed write tool is in the inventory, and every UNGATED_WRITE_TOOLS entry carries a one-line reason", async () => {
    const m = await hookModule();
    const names = new Set(Object.values(readInventory().servers).flatMap((s) => s.tools));
    expect(m.TRACKER_WRITE_TOOLS.filter((t) => !names.has(t))).toEqual([]);
    const entries = Object.entries(m.UNGATED_WRITE_TOOLS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, reason] of entries) {
      expect(typeof reason).toBe("string");
      expect({ name, blank: reason.trim().length === 0 }).toEqual({ name, blank: false });
      expect({ name, multiline: reason.includes("\n") }).toEqual({ name, multiline: false });
    }
  });

  test("TRACKER_READ_TOOLS holds reads only — no create/update/save/delete verb hides there", async () => {
    const m = await hookModule();
    const writeVerb = /^(create|update|save|delete|add|edit|transition|retire|restore|share|unshare|merge|mark|resolve|submit|prepare)/i;
    expect(m.TRACKER_READ_TOOLS.filter((t) => writeVerb.test(t))).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-607.3 — create, over the two-repo fixture
// ===========================================================================

describe("AC-STE-607.3 — a create needs a matching, unspent create receipt in its target", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
  });

  const create = (s: Session, input: Record<string, unknown> = jiraCreate()) =>
    runHook(JIRA("createJiraIssue"), input, { cwd: w.be, transcript: s.save(w.scratch) });

  test("BE createJiraIssue with a matching, announced create receipt → exit 0", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await create(s));
  });

  test("a title differing only by the normalizer's drift (double space) still matches → exit 0", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE ledger sync" }), "fast", "BE ledger sync");
    expectPermit(await create(s, jiraCreate({ title: "BE  ledger sync" })));
  });

  test("parent read from `additional_fields.parent` matches as the `parent` argument does → exit 0", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE refund hook" }), "fast", "BE refund hook");
    expectPermit(await create(s, jiraCreate({ title: "BE refund hook", parentVia: "additional" })));
  });

  test("no receipt → exit 2 naming the tool, the target root and the deciding command", async () => {
    const r = await create(new Session());
    expectRefusal(r, "createJiraIssue", w.be, /decide/, /receipt/i);
  });

  test("a receipt from ANOTHER session, announced → exit 2", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }, OTHER_SESSION));
    expectRefusal(await create(s), /receipt/i);
  });

  test("the matching receipt sitting in FE's root, announced → exit 2 (receipts are read from the target only)", async () => {
    const s = new Session();
    s.announceDecide(w.fe, createReceipt(w.fe, { title: "BE payout export" }));
    expectRefusal(await create(s), /receipt/i, w.be);
  });

  test("payload title differs → exit 2 naming the title", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectRefusal(await create(s, jiraCreate({ title: "BE payout import" })), /title/i);
  });

  test("payload labels miss the tag → exit 2 naming the label/tag", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectRefusal(await create(s, jiraCreate({ labels: [] })), /label|tag/i);
  });

  test("payload parent differs → exit 2 naming the parent", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectRefusal(await create(s, jiraCreate({ parent: "GF-89" })), /parent/i);
  });

  for (const [label, result, isError] of [
    ["a success", { id: "10150", key: "GF-150", self: "https://glacy.atlassian.net/rest/api/3/issue/10150" }, false],
    ["a Gateway-Timeout error", "Error: 504 Gateway Timeout", true],
  ] as const) {
    test(`spent: a second matching create after the first (whose result was ${label}) → exit 2 naming \`decide --attempt\``, async () => {
      const s = new Session();
      s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
      s.mcp(JIRA("createJiraIssue"), jiraCreate(), result, isError);
      expectRefusal(await create(s), /decide --attempt/);
    });
  }

  test("retry path permitted: a fresh retry-1 receipt announced after the failed create → exit 0", async () => {
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), "Error: 504 Gateway Timeout", true);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }), "retry-1");
    expectPermit(await create(s));
  });
});

// ===========================================================================
// AC-STE-607.4 — ticket writes
// ===========================================================================

describe("AC-STE-607.4 — a ticket write needs a subject its target owns", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
    // An FR file on disk that was never `git add`ed: bound in the working
    // tree, NOT in the index — owned by nothing.
    boundFr(w.be, "GF-131");
  });

  const act = (s: Session, key: string) =>
    runHook(JIRA("transitionJiraIssue"), transition(key), { cwd: w.be, transcript: s.save(w.scratch) });

  test("BE transition on its tracked FR's key → exit 0", async () => {
    expectPermit(await act(new Session(), "GF-111"));
  });

  test("BE transition on FE's key → exit 2 naming the key", async () => {
    expectRefusal(await act(new Session(), "GF-101"), "GF-101", "transitionJiraIssue");
  });

  test("CONTROL — an FR file in the working tree but not in the git index owns nothing → exit 2", async () => {
    expectRefusal(await act(new Session(), "GF-131"), "GF-131");
  });

  test("a key the session's own createJiraIssue returned earlier → exit 0", async () => {
    const s = new Session();
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), { id: "10150", key: "GF-150", self: "x" });
    expectPermit(await act(s, "GF-150"));
  });

  test("CONTROL — the same create whose result is an error created nothing → exit 2", async () => {
    const s = new Session();
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), "Error: 400 {\"key\":\"GF-150\"}", true);
    expectRefusal(await act(s, "GF-150"), "GF-150");
  });

  test("a key named by a `reuse` receipt → exit 0", async () => {
    const s = new Session();
    s.announce(
      DECIDE,
      `decide "${w.be}" /tmp/page.json --title "BE streak cron" --parent GF-85 --attempt fast`,
      reuseReceipt(w.be, "GF-112", "BE streak cron"),
      '{"outcome":"reused","key":"GF-112"}',
    );
    expectPermit(await act(s, "GF-112"));
  });

  const consentCases: Array<{
    kind: "import" | "binding";
    verb: "Import" | "Adopt";
    key: string;
    receipt: (root: string, key: string) => string;
    module: string;
    args: (root: string, key: string) => string;
  }> = [
    {
      kind: "import",
      verb: "Import",
      key: "GF-121",
      receipt: importReceipt,
      module: CONSENT,
      args: (root, key) => `consent "${root}" ${key} /tmp/page.json`,
    },
    {
      kind: "binding",
      verb: "Adopt",
      key: "GF-122",
      receipt: adoptReceipt,
      module: CONFIRM,
      args: (root, key) => `confirm "${root}" ${key} /tmp/ticket.json --adopt`,
    },
  ];

  for (const c of consentCases) {
    const announce = (s: Session) =>
      s.announce(c.module, c.args(w.be, c.key), c.receipt(w.be, c.key), `{"decision":"${c.kind}"}`);

    test(`${c.kind} receipt with no ask in the transcript → exit 2`, async () => {
      const s = new Session();
      announce(s);
      expectRefusal(await act(s, c.key), c.key);
    });

    test(`${c.kind} receipt with the ask answered \`${c.verb} ${c.key}\` before the announcement → exit 0`, async () => {
      const s = new Session();
      s.ask(c.key, c.verb, { answer: `${c.verb} ${c.key}` });
      announce(s);
      expectPermit(await act(s, c.key));
    });

    for (const [label, outcome] of [
      ["the decline option", { answer: `Skip ${c.key}` }],
      ["free text", { answer: "sure, go ahead" }],
      ["free text quoting the label", { answer: `${c.verb} ${c.key}? not sure, ask me later` }],
      ["an error tool_result", "error"],
      ["a denied tool_result", "denied"],
    ] as const) {
      test(`${c.kind} receipt with the ask answered by ${label} → exit 2`, async () => {
        const s = new Session();
        s.ask(c.key, c.verb, outcome as AskOutcome);
        announce(s);
        expectRefusal(await act(s, c.key), c.key);
      });
    }

    test(`${c.kind} receipt with the answered ask positioned AFTER the announcement → exit 2`, async () => {
      const s = new Session();
      announce(s);
      s.ask(c.key, c.verb, { answer: `${c.verb} ${c.key}` });
      expectRefusal(await act(s, c.key), c.key);
    });
  }

  test("createIssueLink BE↔FE (one owned side) → exit 0", async () => {
    const r = await runHook(
      JIRA("createIssueLink"),
      { cloudId: CLOUD, inwardIssue: "GF-111", outwardIssue: "GF-101", type: "Relates" },
      { cwd: w.be, transcript: new Session().save(w.scratch) },
    );
    expectPermit(r);
  });

  test("createIssueLink FE↔FE (no owned side) → exit 2", async () => {
    const r = await runHook(
      JIRA("createIssueLink"),
      { cloudId: CLOUD, inwardIssue: "GF-101", outwardIssue: "GF-102", type: "Relates" },
      { cwd: w.be, transcript: new Session().save(w.scratch) },
    );
    expectRefusal(r, /GF-101|GF-102/);
  });
});

// ===========================================================================
// AC-STE-607.5 — target resolution
// ===========================================================================

describe("AC-STE-607.5 — receipts are read from the TARGET repository", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
  });

  /** A session rooted in FE that ran BE's deciding command. */
  function feSessionWithBeReceipt(announced: boolean): string {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    if (announced) s.announceDecide(w.be, path);
    return s.save(w.scratch);
  }

  test("session rooted in FE, BE's receipt announced, create carrying BE's tag → exit 0", async () => {
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), {
      cwd: w.fe,
      transcript: feSessionWithBeReceipt(true),
    });
    expectPermit(r);
  });

  test("the same receipt NOT announced → exit 2", async () => {
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), {
      cwd: w.fe,
      transcript: feSessionWithBeReceipt(false),
    });
    expectRefusal(r);
  });

  for (const [label, labels] of [
    ["FE's tag", [FE_TAG]],
    ["both tags", [FE_TAG, BE_TAG]],
    ["neither tag", []],
  ] as const) {
    test(`the same announced receipt, create carrying ${label} → exit 2`, async () => {
      const r = await runHook(JIRA("createJiraIssue"), jiraCreate({ labels: [...labels] }), {
        cwd: w.fe,
        transcript: feSessionWithBeReceipt(true),
      });
      expectRefusal(r);
    });
  }

  test("a cwd outside any git repository with an announced declared root is gated (mismatch → 2, match → 0)", async () => {
    const outside = tempDir("nogit");
    const transcript = feSessionWithBeReceipt(true);
    expectRefusal(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "Something else" }), { cwd: outside, transcript }),
      /title/i,
    );
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: outside, transcript }));
  });

  describe("a worktree of BE as cwd reads the worktree's own CLAUDE.md, index and receipts", () => {
    let wt: string;
    beforeAll(() => {
      wt = join(tempDir("worktree-parent"), "be-wt");
      git(w.be, "worktree", "add", "-q", "-b", "wt-607", wt);
      wt = realpathSync(wt);
      cleanups.unshift(() => {
        try {
          git(w.be, "worktree", "remove", "--force", wt);
        } catch {
          /* the parent may already be gone */
        }
      });
      // GF-160 is bound in the WORKTREE's index only.
      boundFr(wt, "GF-160");
      git(wt, "add", "specs/frs/GF-160.md");
    });

    test("receipt written in the worktree root and announced → create exit 0", async () => {
      const s = new Session();
      s.announceDecide(wt, createReceipt(wt, { title: "BE payout export" }));
      expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: wt, transcript: s.save(w.scratch) }));
    });

    test("receipt in the MAIN checkout, not announced, does not authorise a create from the worktree → exit 2", async () => {
      createReceipt(w.be, { title: "BE payout export" });
      const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), {
        cwd: wt,
        transcript: new Session().save(w.scratch),
      });
      expectRefusal(r);
    });

    test("a key bound only in the worktree's index: owned from the worktree (0), not from the main checkout (2)", async () => {
      const transcript = new Session().save(w.scratch);
      expectPermit(await runHook(JIRA("transitionJiraIssue"), transition("GF-160"), { cwd: wt, transcript }));
      expectRefusal(
        await runHook(JIRA("transitionJiraIssue"), transition("GF-160"), { cwd: w.be, transcript }),
        "GF-160",
      );
    });

    test("the worktree's own CLAUDE.md, undeclared, silences the hook there while the main checkout stays gated", async () => {
      const wt2 = join(tempDir("worktree-parent2"), "be-wt2");
      git(w.be, "worktree", "add", "-q", "-b", "wt-607-b", wt2);
      const real = realpathSync(wt2);
      cleanups.unshift(() => {
        try {
          git(w.be, "worktree", "remove", "--force", real);
        } catch {
          /* ignore */
        }
      });
      declareJira(real, null);
      const transcript = new Session().save(w.scratch);
      expectSilent(await runHook(JIRA("transitionJiraIssue"), transition("GF-101"), { cwd: real, transcript }));
      expectRefusal(
        await runHook(JIRA("transitionJiraIssue"), transition("GF-101"), { cwd: w.be, transcript }),
        "GF-101",
      );
    });
  });
});

// ===========================================================================
// AC-STE-607.6 — the floor, both directions
// ===========================================================================

describe("AC-STE-607.6 — min_dpt_version against the hook's own manifest", () => {
  test("a declared floor ABOVE the manifest version refuses every write to that container, naming both versions", async () => {
    const w = makeWorld({ beFloor: "2.88.0" });
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    const transcript = s.save(w.scratch);
    const created = await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript });
    expectRefusal(created, "2.88.0", MANIFEST_VERSION);
    const owned = await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), { cwd: w.be, transcript });
    expectRefusal(owned, "2.88.0", MANIFEST_VERSION);
  }, 30_000);

  test("a floor EQUAL to the manifest version leaves the receipt rules in charge (match → 0, no receipt → 2)", async () => {
    const w = makeWorld({ beFloor: MANIFEST_VERSION });
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(
      await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }),
    );
    const bare = await runHook(JIRA("createJiraIssue"), jiraCreate(), {
      cwd: w.be,
      transcript: new Session().save(w.scratch),
    });
    expectRefusal(bare, /receipt/i);
    expect(bare.stderr).not.toContain("2.88.0");
  }, 30_000);
});

// ===========================================================================
// AC-STE-607.7 — unreadable inputs, announcing modules, forgery controls
// ===========================================================================

describe("AC-STE-607.7 — RECEIPT_ANNOUNCING_MODULES", () => {
  test("holds exactly the three deciding modules", async () => {
    const { RECEIPT_ANNOUNCING_MODULES } = await hookModule();
    expect([...RECEIPT_ANNOUNCING_MODULES].sort()).toEqual([CONSENT, DECIDE, CONFIRM].sort());
  });
});

describe("AC-STE-607.7 — unreadable inputs", () => {
  let w: World;
  let permitTranscript: string;
  beforeAll(() => {
    w = makeWorld();
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    permitTranscript = s.save(w.scratch);
  });

  const permitCall = (pluginRoot?: string) =>
    runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: permitTranscript, pluginRoot });

  test("unparseable stdin → exit 0 (fail-open outside a session)", async () => {
    expectSilent(await runRaw("this is not json {"));
    expectSilent(await runRaw(""));
  });

  test("permit twin: the readable manifest lets the matching create through", async () => {
    expectPermit(await permitCall(MANIFEST_DIR));
  });

  test("the hook's own manifest ABSENT while declared → exit 2 naming the manifest", async () => {
    const empty = tempDir("no-manifest");
    expectRefusal(await permitCall(empty), /plugin\.json/);
  });

  test("the hook's own manifest UNREADABLE while declared → exit 2 naming the manifest", async () => {
    const dir = tempDir("locked-manifest");
    pluginManifest(dir, MANIFEST_VERSION);
    const file = join(dir, ".claude-plugin", "plugin.json");
    chmodSync(file, 0o000);
    try {
      expectRefusal(await permitCall(dir), /plugin\.json/);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test("the hook's own manifest carrying a NON-SEMVER version while declared → exit 2 naming the manifest", async () => {
    const dir = tempDir("bad-manifest");
    pluginManifest(dir, "2.87");
    expectRefusal(await permitCall(dir), /plugin\.json/, /2\.87\b/);
  });

  test("CONTROL — manifest absent while NOTHING is declared → exit 0, silent", async () => {
    const cwd = tempDir("undeclared-no-manifest");
    declareJira(cwd, null);
    gitInit(cwd);
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), {
      cwd,
      transcript: new Session().save(w.scratch),
      pluginRoot: tempDir("no-manifest-2"),
    });
    expectSilent(r);
  });

  test("the cwd's CLAUDE.md present but unreadable → exit 2 naming the file", async () => {
    const root = tempDir("locked-claude-md");
    declareJira(root, BE_TAG);
    gitInit(root);
    const file = join(root, "CLAUDE.md");
    chmodSync(file, 0o000);
    try {
      const r = await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), {
        cwd: root,
        transcript: new Session().save(w.scratch),
      });
      expectRefusal(r, /CLAUDE\.md/);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test("a malformed declaration → exit 2 carrying the reader's own text", async () => {
    const root = tempDir("malformed-decl");
    claudeMd(root, { mode: "jira", project: "GF", defaultLabels: [BE_TAG], repoTag: BE_TAG });
    gitInit(root);
    const r = await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), {
      cwd: root,
      transcript: new Session().save(w.scratch),
    });
    expectRefusal(r, /min_dpt_version/);
  });

  test("an unreadable transcript: a tracked key still passes, a session-created key is refused naming the transcript", async () => {
    const missing = join(w.scratch, "no-such-transcript.jsonl");
    expectPermit(await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), { cwd: w.be, transcript: missing }));
    expectRefusal(
      await runHook(JIRA("transitionJiraIssue"), transition("GF-150"), { cwd: w.be, transcript: missing }),
      /transcript/i,
    );
  });

  test("a receipt file that fails to parse is ignored and counted in the refusal", async () => {
    const dir = receiptsDir(w.be, SESSION);
    mkdirSync(dir, { recursive: true });
    const garbage = join(dir, "zz-garbage.json");
    writeFileSync(garbage, "{ this is not a receipt");
    try {
      const s = new Session();
      s.announceDecide(w.be, garbage);
      const r = await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "Only garbage here" }), {
        cwd: w.be,
        transcript: s.save(w.scratch),
      });
      expectRefusal(r, /unpars|malformed|ignored|skipped|failed to parse|invalid/i, /\b1\b/);
    } finally {
      rmSync(garbage, { force: true });
    }
  });

  test("an unresolvable subject (numeric issue id) in a declared repository → exit 2 naming it", async () => {
    const r = await runHook(JIRA("transitionJiraIssue"), transition("10234"), {
      cwd: w.be,
      transcript: new Session().save(w.scratch),
    });
    expectRefusal(r, "10234", /resolv/i);
  });
});

describe("AC-STE-607.7 — forgery controls: only a listed deciding command's own output announces", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
  });

  const create = (s: Session) =>
    runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) });

  test("a receipt JSON written by a Write tool_use and announced by `echo` → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    const wid = s.toolUse("Write", { file_path: path, content: readFileSync(path, "utf-8") });
    s.toolResult(wid, `File created successfully at: ${path}`);
    s.bash(`echo "${RECEIPT_ANNOUNCEMENT_PREFIX}${path}"`, `${RECEIPT_ANNOUNCEMENT_PREFIX}${path}`);
    expectRefusal(await create(s));
  });

  test("a valid receipt whose announcement sits in assistant text → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.text(`Decided. ${RECEIPT_ANNOUNCEMENT_PREFIX}${path}`);
    expectRefusal(await create(s));
  });

  test("a valid receipt announced by a Bash call that ran some other command → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.bash(`ls "${dirname(path)}"`, `${RECEIPT_ANNOUNCEMENT_PREFIX}${path}`);
    expectRefusal(await create(s));
  });

  test("a valid receipt announced by a module OUTSIDE RECEIPT_ANNOUNCING_MODULES → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.announce("gate_evidence.ts", `record "${w.be}"`, path);
    expectRefusal(await create(s));
  });

  test("a deciding command's announcement inside an ERROR tool_result → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.announce(DECIDE, `decide "${w.be}" /tmp/page.json --title "BE payout export" --attempt fast`, path, "{}", true);
    expectRefusal(await create(s));
  });

  test("an announced path outside receiptsDir(<root>, <this session>) → exit 2", async () => {
    const real = createReceipt(w.be, { title: "BE payout export" });
    const stray = join(w.be, ".dpt", "elsewhere", "receipt.json");
    mkdirSync(dirname(stray), { recursive: true });
    copyFileSync(real, stray);
    rmSync(real);
    const s = new Session();
    s.announceDecide(w.be, stray);
    expectRefusal(await create(s));
  });

  test("CONTROL — the same receipt announced by the deciding command → exit 0", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.announceDecide(w.be, path);
    expectPermit(await create(s));
  });

  test("CONTROL — the REAL `decide` command's own output, fed back as its tool_result, authorises its create → exit 0", async () => {
    const page = join(w.scratch, "empty-page.json");
    writeFileSync(page, JSON.stringify({ issues: [], isLast: true }));
    const title = "BE real decide";
    const command = [
      "bun",
      "run",
      join(ADAPTERS_SRC, DECIDE),
      "decide",
      w.be,
      page,
      "--title",
      title,
      "--parent",
      "GF-85",
      "--attempt",
      "fast",
    ];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
    env.CLAUDE_CODE_SESSION_ID = SESSION;
    const p = Bun.spawnSync(command, { env, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const out = p.stdout.toString();
    expect(out).toContain(RECEIPT_ANNOUNCEMENT_PREFIX);
    const decision = JSON.parse(out.split("\n")[0]!) as { createPayload: Record<string, unknown> };
    const s = new Session();
    s.bash(command.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" "), out);
    const cp = decision.createPayload;
    const r = await runHook(
      JIRA("createJiraIssue"),
      jiraCreate({ title: String(cp.summary), labels: cp.labels as string[], parent: String(cp.parent) }),
      { cwd: w.be, transcript: s.save(w.scratch) },
    );
    expectPermit(r);
  }, 30_000);
});

// ===========================================================================
// AC-STE-607.8 — container writes are named, not gated
// ===========================================================================

describe("AC-STE-607.8 — container writes exit 1 with a Reminder in a declared target", () => {
  function expectReminder(r: Run, kind: RegExp): void {
    if (r.exitCode !== 1) throw new Error(`expected exit 1 (reminder), got:\n${show(r)}`);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^Reminder:/m);
    expect(r.stderr).not.toContain("Refusing:");
    expect(r.stderr).toContain(GATING_MILESTONE);
    expect(r.stderr).toMatch(kind);
  }

  test("an Epic create in a declared Jira target → exit 1, Reminder naming its kind and M_685ff6", async () => {
    const w = makeWorld();
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate({ type: "Epic", parent: null, title: "M_GF_95 Payouts" }), {
      cwd: w.be,
      transcript: new Session().save(w.scratch),
    });
    expectReminder(r, /milestone|epic/i);
  }, 30_000);

  test("save_milestone and save_issue_label in a declared Linear target → exit 1, Reminder naming the kind", async () => {
    const root = linearRepo(BE_TAG);
    const transcript = new Session().save(tempDir("linear-scratch"));
    expectReminder(
      await runHook(LINEAR("save_milestone"), { project: "DPT", name: "M_x" }, { cwd: root, transcript }),
      /milestone/i,
    );
    expectReminder(
      await runHook(LINEAR("save_issue_label"), { name: BE_TAG, team: "STE" }, { cwd: root, transcript }),
      /label/i,
    );
  }, 30_000);

  test("the same three calls in undeclared targets → exit 0, silent", async () => {
    const jira = tempDir("undeclared-epic");
    declareJira(jira, null);
    gitInit(jira);
    const linear = linearRepo(null);
    const transcript = new Session().save(tempDir("undeclared-container-scratch"));
    expectSilent(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ type: "Epic", parent: null }), { cwd: jira, transcript }),
    );
    expectSilent(await runHook(LINEAR("save_milestone"), { project: "DPT", name: "M_x" }, { cwd: linear, transcript }));
    expectSilent(
      await runHook(LINEAR("save_issue_label"), { name: BE_TAG, team: "STE" }, { cwd: linear, transcript }),
    );
  }, 30_000);
});

// ===========================================================================
// AC-STE-607.9 — performance
// ===========================================================================

describe("AC-STE-607.9 — inside the 5000 ms timeout on a large session", () => {
  test("5,000-line transcript with 200 receipts → the matching create exits 0 inside 5000 ms (measured time recorded)", async () => {
    const w = makeWorld();
    const s = new Session();
    const RECEIPTS = 200;
    for (let i = 0; i < RECEIPTS; i++) {
      const title = `BE task ${i}`;
      s.announceDecide(w.be, createReceipt(w.be, { title }), "fast", title);
    }
    const filler = "x".repeat(400);
    let n = 0;
    while (s.lines.length < 5000) {
      if (n % 3 === 0) s.text(`Working on step ${n}. ${filler}`);
      else s.bash(`ls -la src/step-${n}`, `total ${n}\n${filler}`);
      n += 1;
    }
    const transcript = s.save(w.scratch);
    const lines = readFileSync(transcript, "utf-8").split("\n").filter((l) => l !== "").length;
    expect(lines).toBeGreaterThanOrEqual(5000);
    expect(
      readdirSync(receiptsDir(w.be, SESSION)).filter((n) => n.endsWith(".json")).length,
    ).toBeGreaterThanOrEqual(RECEIPTS);

    const t0 = performance.now();
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE task 137" }), {
      cwd: w.be,
      transcript,
    });
    const elapsed = performance.now() - t0;
    console.log(
      `AC-STE-607.9 measured: ${elapsed.toFixed(0)} ms for ${lines} transcript lines / ${RECEIPTS} receipts (budget 5000 ms)`,
    );
    expectPermit(r);
    expect(elapsed).toBeLessThan(5000);
  }, 60_000);
});

// ===========================================================================
// AC-STE-607.10 — surfaces and pins
// ===========================================================================

const BLOCKS = /\b(block|refus)/i;

/** Windows of `lines` starting at a line naming the hook, running to the next heading or `limit` lines. */
function windowsNaming(body: string, limit = 9): string[] {
  const lines = body.split("\n");
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (!l.includes(HOOK)) return;
    const win = [l];
    for (let j = i + 1; j < lines.length && j <= i + limit; j++) {
      if (/^#{1,6}\s/.test(lines[j]!)) break;
      win.push(lines[j]!);
    }
    out.push(win.join("\n"));
  });
  return out;
}

const saysWhatItBlocks = (w: string) => /tracker/i.test(w) && /writ/i.test(w) && BLOCKS.test(w);

/** The `hooks/` entry of a tree diagram: from its line to the next tree entry. */
function treeHooksEntry(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /hooks\/\s/.test(l) && l.includes("hooks.json"));
  if (start < 0) return "";
  const out = [lines[start]!];
  for (let j = start + 1; j < lines.length; j++) {
    if (/[├└]──/.test(lines[j]!)) break;
    out.push(lines[j]!);
  }
  return out.join("\n");
}

describe("AC-STE-607.10 — the gate is announced where operators look", () => {
  const DOCS: Array<[string, string]> = [
    ["docs/hooks-reference.md", join(PLUGIN_ROOT, "docs", "hooks-reference.md")],
    ["docs/honored-contracts.md", join(PLUGIN_ROOT, "docs", "honored-contracts.md")],
    ["docs/workflow-overview.md", join(PLUGIN_ROOT, "docs", "workflow-overview.md")],
    ["templates/CLAUDE.md.template", join(PLUGIN_ROOT, "templates", "CLAUDE.md.template")],
  ];

  for (const [label, path] of DOCS) {
    test(`${label} names \`${HOOK}\` and says it blocks tracker writes`, () => {
      const wins = windowsNaming(readFileSync(path, "utf-8"));
      expect(wins.length).toBeGreaterThan(0);
      expect(wins.some(saysWhatItBlocks)).toBe(true);
    });
  }

  for (const [label, path] of [
    ["README.md (hooks tree)", join(REPO_ROOT, "README.md")],
    ["CLAUDE.md (structure line)", join(REPO_ROOT, "CLAUDE.md")],
  ] as const) {
    test(`${label}: the hooks/ entry names \`${HOOK}\` and what it blocks`, () => {
      const entry = treeHooksEntry(readFileSync(path, "utf-8"));
      expect(entry).toContain("hooks.json");
      expect(entry).toContain(HOOK);
      expect(saysWhatItBlocks(entry)).toBe(true);
    });
  }

  test("CONTROL — the grader rejects a surface that names the gate without saying what it blocks", () => {
    expect(windowsNaming(`intro\n\n- \`${HOOK}\` exists.\n`).some(saysWhatItBlocks)).toBe(false);
    expect(saysWhatItBlocks(treeHooksEntry(`├── hooks/  # hooks.json — ${HOOK}\n├── scripts/`))).toBe(false);
  });

  test("skills/**/*.md totals 245 STE tokens", () => {
    const skillsRoot = join(PLUGIN_ROOT, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(skillsRoot)) {
      files += 1;
      total += (readFileSync(join(skillsRoot, rel), "utf-8").match(/\bSTE-\d+\b/g) ?? []).length;
    }
    expect(files).toBeGreaterThan(20);
    expect(total).toBe(245);
  });
});

/**
 * The recorded exemption (§7, third bullet). The derivation in
 * `tests/_blocking_gates.ts` reads SKILL-demand calls; this gate demands
 * receipts written by deciding commands and has no Skill to name, so the
 * STE-573/STE-577 announcement legs — which grade each gate's `skill` on every
 * surface — have nothing to grade for it. It is a separate kind of gate, and
 * its announcement is graded by the AC-STE-607.10 legs above instead.
 */
const RECEIPT_GATE_EXEMPTION = {
  hook: HOOK,
  demands: "receipts",
  reason:
    "demands deciding-command receipts, not a Skill tool_use; announced surfaces are graded by AC-STE-607.10 here",
} as const;

describe("AC-STE-607.10 — blocking-gate derivation: the recorded exemption", () => {
  test("the Skill-demand derivation does not list the receipt gate (so the exemption is live, not a dead letter)", () => {
    const hooks = deriveBlockingGates(PLUGIN_ROOT).map((g) => g.hook);
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks).not.toContain(RECEIPT_GATE_EXEMPTION.hook);
  });

  test("the exempted gate is nonetheless a REFUSING gate: its entry point exists and exits 2 through emitNFR10(\"Refusing\", …)", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
    const dense = readFileSync(MODULE_PATH, "utf-8").replace(/\s+/g, "");
    expect(dense).toContain('emitNFR10("Refusing"');
    expect(dense).toMatch(/process\.exit\([^)]*2[^)]*\)/);
    expect(RECEIPT_GATE_EXEMPTION.reason.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AUDIT fixes (STE-607 Stage C). The live harness writes the gated call's own
// tool_use to the transcript BEFORE PreToolUse runs; a floor binds only the
// declared targets of the call's container; a Linear receipt for one project
// never authorises another project of the same team.
// ===========================================================================

/** Append an assistant message whose tool_uses have NOT run (no tool_result yet). */
function pendingToolUses(s: Session, uses: Array<{ id: string; name: string; input: unknown }>): void {
  s.lines.push(
    JSON.stringify({
      type: "assistant",
      sessionId: SESSION,
      message: { role: "assistant", content: uses.map((u) => ({ type: "tool_use", ...u })) },
    }),
  );
}

describe("STE-607 audit — the gated call itself, floors per target, Linear project match", () => {
  test("the pending create's own tool_use, already in the transcript, does not spend its receipt → exit 0 (control: a create that RAN does)", async () => {
    const w = makeWorld();
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    pendingToolUses(s, [
      { id: "toolu_607_pending", name: JIRA("createJiraIssue"), input: jiraCreate() },
      { id: "toolu_607_sibling", name: JIRA("createJiraIssue"), input: jiraCreate() },
    ]);
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));

    const ran = new Session();
    ran.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    ran.mcp(JIRA("createJiraIssue"), jiraCreate(), "Gateway Timeout", true);
    pendingToolUses(ran, [{ id: "toolu_607_pending", name: JIRA("createJiraIssue"), input: jiraCreate() }]);
    expectRefusal(
      await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: ran.save(w.scratch) }),
      /decide --attempt/,
    );
  }, 30_000);

  test("another repository's floor never blocks a write into a container it does not bind (control: the same floor on this container refuses)", async () => {
    const w = makeWorld();
    const other = tempDir("floor-other");
    claudeMd(other, { mode: "jira", project: "GX", defaultLabels: ["glacy-ops"], repoTag: "glacy-ops", minDptVersion: "2.88.0" });
    gitInit(other);
    const s = new Session();
    s.announce(DECIDE, `decide "${other}" /tmp/page.json --title "Ops" --attempt fast`, receiptIn(other, {
      kind: "reuse", adapter: "jira", container: "GX", subject: "Ops", decision: "reused", evidence: { key: "GX-1" },
    }));
    const transcript = s.save(w.scratch);
    expectPermit(await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), { cwd: w.be, transcript }));

    const floored = makeWorld({ beFloor: "2.88.0" });
    expectRefusal(
      await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), {
        cwd: floored.be,
        transcript: new Session().save(floored.scratch),
      }),
      "2.88.0",
    );
  }, 30_000);

  test("a Linear create receipt for project DPT does not authorise a create into another project of the same team (control: DPT itself passes)", async () => {
    const root = linearRepo(BE_TAG);
    const scratch = tempDir("linear-create");
    const payloadFor = (project: string) => ({
      team: "STE",
      project,
      title: "BE payout export",
      labels: [BE_TAG],
      milestone: "ms-1",
    });
    const s = new Session();
    s.announce(DECIDE, `decide "${root}" /tmp/page.json --title "BE payout export" --linear-milestone ms-1 --attempt fast`, receiptIn(root, {
      kind: "create", adapter: "linear", container: "ms-1", subject: "BE payout export", decision: "create",
      evidence: { createPayload: payloadFor("DPT") },
    }));
    const transcript = s.save(scratch);
    expectRefusal(await runHook(LINEAR("save_issue"), payloadFor("OTHER"), { cwd: root, transcript }), /project/i);
    expectPermit(await runHook(LINEAR("save_issue"), payloadFor("DPT"), { cwd: root, transcript }));
  }, 30_000);

  test("a comment id alone (no ticket key) in a declared target is unresolvable → exit 2", async () => {
    const root = linearRepo(BE_TAG);
    const r = await runHook(LINEAR("delete_comment"), { id: "5b3c0e0e-2f7a-4d0d-9b1c-1a2b3c4d5e6f" }, {
      cwd: root,
      transcript: new Session().save(tempDir("linear-comment")),
    });
    expectRefusal(r);
  }, 30_000);
});

describe("STE-607 audit — a receipt names its own session", () => {
  test("a receipt whose JSON names ANOTHER session, filed in this session's directory and announced, authorises nothing (control: its own session's copy does)", async () => {
    const w = makeWorld();
    const foreign = createReceipt(w.be, { title: "BE payout export" }, "s-607-other");
    const dir = receiptsDir(w.be, SESSION);
    mkdirSync(dir, { recursive: true });
    const misfiled = join(dir, "misfiled-from-other-session.json");
    copyFileSync(foreign, misfiled);
    const s = new Session();
    s.announceDecide(w.be, misfiled);
    expectRefusal(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));

    const own = new Session();
    own.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: own.save(w.scratch) }));
  }, 30_000);
});

describe("STE-607 — attachment writes name their ticket in `issue`", () => {
  test("create_attachment on this repository's tracked key → exit 0; on FE's key from BE → exit 2", async () => {
    const root = linearRepo(BE_TAG);
    boundFr(root, "STE-611", "linear");
    git(root, "add", "-A");
    git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "bind STE-611");
    const transcript = new Session().save(tempDir("attach"));
    const attach = (issue: string) => ({ issue, base64Content: "aGk=", filename: "x.txt", contentType: "text/plain" });
    expectPermit(await runHook(LINEAR("create_attachment"), attach("STE-611"), { cwd: root, transcript }));
    expectRefusal(await runHook(LINEAR("create_attachment"), attach("STE-612"), { cwd: root, transcript }), "STE-612");
  }, 30_000);
});
