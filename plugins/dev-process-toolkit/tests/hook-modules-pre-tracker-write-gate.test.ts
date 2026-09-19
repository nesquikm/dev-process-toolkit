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
  symlinkSync,
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
import * as receiptsModule from "../adapters/_shared/src/tracker_receipts";
import { milestoneIdFromEpicKey, milestoneIdFromLinearMilestone } from "../adapters/_shared/src/milestone_token";
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
  const span = makeSpanFixture("M_GF_85", { repositories: false });
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
      `${decisionLine}\n${realAnnouncement(receiptPath)}`,
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
  /** The gated call's own tool_use id (default `toolu_607_pending`). */
  toolUseId?: string;
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
    tool_use_id: o.toolUseId ?? "toolu_607_pending",
  });
}

/**
 * Hook processes this suite runs at once. Unbounded, the undeclared matrix
 * launched 78 `bun` processes together; under a full-suite run they sat in
 * uninterruptible wait for up to 29 s and starved every test running beside
 * them past bun's 5000 ms per-test default — the five "unreadable inputs"
 * reds of the round-2 review (measured; the hook itself runs in ~30-130 ms).
 */
const HOOK_SPAWN_LIMIT = 6;
let hooksInFlight = 0;
let peakHooksInFlight = 0;

/** Run `fn` over `items` with at most `limit` in flight, results in input order. */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function runRaw(stdin: string, pluginRoot?: string): Promise<Run> {
  hooksInFlight += 1;
  peakHooksInFlight = Math.max(peakHooksInFlight, hooksInFlight);
  try {
    return await spawnHook(stdin, pluginRoot);
  } finally {
    hooksInFlight -= 1;
  }
}

async function spawnHook(stdin: string, pluginRoot?: string): Promise<Run> {
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
    peakHooksInFlight = 0;
    const runs = await mapBounded(cases, HOOK_SPAWN_LIMIT, (c) =>
      runHook(c.full, sampleInput(c.tool), { cwd: c.cwd, transcript }),
    );
    // The suite never floods the machine: the cause of the round-2 5000 ms reds.
    expect(peakHooksInFlight).toBeLessThanOrEqual(HOOK_SPAWN_LIMIT);
    expect(peakHooksInFlight).toBeGreaterThan(1); // positive control: the cases really ran concurrently
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await create(s));
  });

  test("a title differing only by the normalizer's drift (double space) still matches → exit 0", async () => {
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE ledger sync" }), "fast", "BE ledger sync");
    expectPermit(await create(s, jiraCreate({ title: "BE  ledger sync" })));
  });

  test("parent read from `additional_fields.parent` matches as the `parent` argument does → exit 0", async () => {
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
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

  // The retry leg is graded on receipts the REAL `decide` writes: see
  // "M_947c79 review — the shared retry leg" below. A shared retry never
  // yields a create receipt, so no synthetic one is announced here.
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
  function feSessionWithBeReceipt(announced: boolean, attachTarget = false): string {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    if (attachTarget) withAttachTarget(s, w.be, { scratch: w.scratch }); // the target is BE, whatever the cwd
    if (announced) s.announceDecide(w.be, path);
    return s.save(w.scratch);
  }

  test("session rooted in FE, BE's receipt announced, create carrying BE's tag → exit 0", async () => {
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), {
      cwd: w.fe,
      transcript: feSessionWithBeReceipt(true, true),
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    const transcript = feSessionWithBeReceipt(true, true);
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
      // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
      withAttachTarget(s, wt, { scratch: w.scratch });
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
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
  // Amended by AC-STE-608.10: the milestone decision front door is appended, last.
  test("holds exactly the three deciding modules plus the milestone decision front door, appended last", async () => {
    const { RECEIPT_ANNOUNCING_MODULES } = await hookModule();
    // Amended by AC-STE-611.3: the attach front door is appended after it.
    expect([...RECEIPT_ANNOUNCING_MODULES].sort()).toEqual(
      [CONSENT, DECIDE, CONFIRM, "resolve_milestone_identity.ts", "attach_project_milestone.ts"].sort(),
    );
    expect(RECEIPT_ANNOUNCING_MODULES[RECEIPT_ANNOUNCING_MODULES.length - 2]).toBe("resolve_milestone_identity.ts");
    expect(RECEIPT_ANNOUNCING_MODULES[RECEIPT_ANNOUNCING_MODULES.length - 1]).toBe("attach_project_milestone.ts");
  });
});

describe("AC-STE-607.7 — unreadable inputs", () => {
  let w: World;
  let permitTranscript: string;
  beforeAll(() => {
    w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt. (see beforeAll)
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
  }, 30_000);

  test("a malformed declaration → exit 2 carrying the reader's own text", async () => {
    const root = tempDir("malformed-decl");
    claudeMd(root, { mode: "jira", project: "GF", defaultLabels: [BE_TAG], repoTag: BE_TAG });
    gitInit(root);
    const r = await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), {
      cwd: root,
      transcript: new Session().save(w.scratch),
    });
    expectRefusal(r, /min_dpt_version/);
  }, 30_000);

  test("an unreadable transcript: a tracked key still passes, a session-created key is refused naming the transcript", async () => {
    const missing = join(w.scratch, "no-such-transcript.jsonl");
    expectPermit(await runHook(JIRA("transitionJiraIssue"), transition("GF-111"), { cwd: w.be, transcript: missing }));
    expectRefusal(
      await runHook(JIRA("transitionJiraIssue"), transition("GF-150"), { cwd: w.be, transcript: missing }),
      /transcript/i,
    );
  }, 30_000);

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
  }, 30_000);

  test("an unresolvable subject (numeric issue id) in a declared repository → exit 2 naming it", async () => {
    const r = await runHook(JIRA("transitionJiraIssue"), transition("10234"), {
      cwd: w.be,
      transcript: new Session().save(w.scratch),
    });
    expectRefusal(r, "10234", /resolv/i);
  }, 30_000);
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
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
// AC-STE-607.8 — amended by AC-STE-608.10: container writes are DECIDED, not
// reminded. The Reminder (exit 1) of M_947c79 no longer exists; a container
// call in a declared target with no milestone-decision receipt is refused
// naming the decision front door. The decided-rule legs live under
// "AC-STE-608.10" at the foot of this file.
// ===========================================================================

describe("AC-STE-607.8 (amended by AC-STE-608.10) — container writes in a declared target are decided, never reminded", () => {
  test("an Epic create in a declared Jira target with no decision receipt → exit 2 naming the decision front door, never exit 1", async () => {
    const w = makeWorld();
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate({ type: "Epic", parent: null, title: "M_GF_95 Payouts" }), {
      cwd: w.be,
      transcript: new Session().save(w.scratch),
    });
    expectRefusal(r, "resolve_milestone_identity.ts");
    expect(r.stderr).not.toMatch(/^Reminder:/m);
  }, 30_000);

  test("save_milestone and save_issue_label in a declared Linear target with no receipt → exit 2, never a Reminder", async () => {
    const root = linearRepo(BE_TAG);
    const transcript = new Session().save(tempDir("linear-scratch"));
    for (const r of [
      await runHook(LINEAR("save_milestone"), { project: "DPT", name: "M_x" }, { cwd: root, transcript }),
      await runHook(LINEAR("save_issue_label"), { name: "some-label", team: "STE" }, { cwd: root, transcript }),
    ]) {
      expectRefusal(r, "resolve_milestone_identity.ts");
      expect(r.stderr).not.toMatch(/^Reminder:/m);
    }
  }, 30_000);

  test("the Reminder text no longer exists in the hook", () => {
    const src = readFileSync(MODULE_PATH, "utf-8");
    expect(src).not.toContain("so this one is named, not refused");
    expect(src).not.toMatch(/emitNFR10\(\s*"Reminder"/);
    expect(src).not.toContain("remindContainer");
  });

  test("(control) the same three calls in undeclared targets → exit 0, silent", async () => {
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
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

describe("AC-STE-607.9 — the round-2 slow paths are the hook's own fast paths", () => {
  /** The hook's OWN wall time on one call: the fastest of three spawns, so machine load cannot pass for a slow hook. */
  async function hookMs(tool: string, input: unknown, o: RunOpts): Promise<{ ms: number; r: Run }> {
    let best = Infinity;
    let last: Run | undefined;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      last = await runHook(tool, input, o);
      best = Math.min(best, performance.now() - t0);
    }
    return { ms: best, r: last! };
  }

  test("each of the five unreadable-input refusals finishes well inside a second (measured times recorded)", async () => {
    const w = makeWorld();
    const unreadable = tempDir("t-locked");
    declareJira(unreadable, BE_TAG);
    gitInit(unreadable);
    const malformed = tempDir("t-malformed");
    claudeMd(malformed, { mode: "jira", project: "GF", defaultLabels: [BE_TAG], repoTag: BE_TAG });
    gitInit(malformed);
    const dir = receiptsDir(w.be, SESSION);
    mkdirSync(dir, { recursive: true });
    const garbage = join(dir, "zz-garbage-t.json");
    writeFileSync(garbage, "{ not a receipt");
    const bad = new Session();
    bad.announceDecide(w.be, garbage);
    const empty = new Session().save(w.scratch);
    const lockedFile = join(unreadable, "CLAUDE.md");
    chmodSync(lockedFile, 0o000);
    const cases: Array<[string, () => Promise<{ ms: number; r: Run }>]> = [
      ["unreadable CLAUDE.md", () => hookMs(JIRA("transitionJiraIssue"), transition("GF-111"), { cwd: unreadable, transcript: empty })],
      ["malformed declaration", () => hookMs(JIRA("transitionJiraIssue"), transition("GF-111"), { cwd: malformed, transcript: empty })],
      ["unreadable transcript", () => hookMs(JIRA("transitionJiraIssue"), transition("GF-150"), { cwd: w.be, transcript: join(w.scratch, "none.jsonl") })],
      ["unparseable receipt", () => hookMs(JIRA("createJiraIssue"), jiraCreate({ title: "Only garbage" }), { cwd: w.be, transcript: bad.save(w.scratch) })],
      ["numeric issue id", () => hookMs(JIRA("transitionJiraIssue"), transition("10234"), { cwd: w.be, transcript: empty })],
    ];
    const measured: string[] = [];
    try {
      for (const [label, run] of cases) {
        const { ms, r } = await run();
        expectRefusal(r);
        measured.push(`${label} ${ms.toFixed(0)} ms`);
        expect(ms, label).toBeLessThan(1000);
      }
    } finally {
      chmodSync(lockedFile, 0o644);
      rmSync(garbage, { force: true });
      console.log(`AC-STE-607.9 unreadable-input paths: ${measured.join(", ")} (fastest of 3 spawns; budget 1000 ms)`);
    }
  }, 60_000);

  test("an exception inside the gate refuses (exit 2) instead of exiting 1, which Claude Code lets through", async () => {
    const m = (await import(MODULE_PATH)) as { exitCodeFor: (stdin: string, gate: (s: string) => 0 | 1 | 2) => 0 | 1 | 2 };
    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    };
    let code: number;
    try {
      code = m.exitCodeFor("{}", () => {
        throw new Error("boom in the gate");
      });
    } finally {
      (process.stderr as { write: unknown }).write = orig;
    }
    expect(code).toBe(2);
    expect(writes.join("")).toContain("Refusing:");
    expect(writes.join("")).toContain("boom in the gate");
    // Control: a gate that returns passes its code through untouched.
    expect(m.exitCodeFor("{}", () => 0)).toBe(0);
  });
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    pendingToolUses(s, [
      { id: "toolu_607_pending", name: JIRA("createJiraIssue"), input: jiraCreate() },
      { id: "toolu_607_sibling", name: JIRA("createJiraIssue"), input: jiraCreate() },
    ]);
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));

    const ran = new Session();
    withAttachTarget(ran, w.be, { scratch: w.scratch });
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, root, { mode: "linear", scratch });
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
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, misfiled);
    expectRefusal(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));

    const own = new Session();
    withAttachTarget(own, w.be, { scratch: w.scratch });
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

// ===========================================================================
// M_947c79 pre-PR /spec-review fixes. Each case drives the real hook file and
// was measured red on the release bytes (4362d3d) before its fix landed.
// ===========================================================================

/** The announcement line exactly as the real deciding modules print it (digest-bound once the fix lands). */
function realAnnouncement(path: string): string {
  const mod = receiptsModule as unknown as { announceReceipt?: (p: string) => string };
  return mod.announceReceipt ? mod.announceReceipt(path) : `${RECEIPT_ANNOUNCEMENT_PREFIX}${path}`;
}

interface RealDecide {
  command: string;
  out: string;
}

/** Spawn the REAL `decide` with this session's id; the returned command is what the transcript records. */
function realDecide(
  root: string,
  page: unknown,
  title: string,
  attempt: string,
  opts: { scratch: string; commandPath?: string },
): RealDecide {
  const pagePath = join(opts.scratch, `page-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(pagePath, JSON.stringify(page));
  const argv = [root, pagePath, "--title", title, "--parent", "GF-85", "--attempt", attempt];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  const p = Bun.spawnSync(["bun", "run", join(ADAPTERS_SRC, DECIDE), "decide", ...argv], { env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`decide failed: ${p.stderr.toString()}`);
  const shown = opts.commandPath ?? join(ADAPTERS_SRC, DECIDE);
  const command = `bun run "${shown}" decide ${argv.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" ")}`;
  return { command, out: p.stdout.toString().trimEnd() };
}

function announcedPath(out: string): string {
  const line = out.split("\n").find((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));
  if (!line) throw new Error(`no announcement in:\n${out}`);
  return line.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]!;
}

const jiraTicket = (key: string, title: string) => ({
  key,
  fields: {
    summary: title,
    project: { key: "GF" },
    issuetype: { name: "Task" },
    parent: { key: "GF-85" },
    labels: [BE_TAG],
  },
});

describe("M_947c79 review — a receipt announcement proves the deciding command RAN (AC-STE-607.7)", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
  });
  const create = (s: Session, input: Record<string, unknown> = jiraCreate()) =>
    runHook(JIRA("createJiraIssue"), input, { cwd: w.be, transcript: s.save(w.scratch) });

  test("`echo` of a hand-written receipt's announcement, with the module name in a comment → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const line = realAnnouncement(path);
    const s = new Session();
    s.bash(`echo "${line}"  # ${CONFIRM}`, line);
    expectRefusal(await create(s));
  });

  test("a real deciding command chained with an `echo` of a forged announcement → exit 2", async () => {
    const forged = createReceipt(w.be, { title: "BE payout export" });
    const line = realAnnouncement(forged);
    const s = new Session();
    s.bash(`bun run "${join(ADAPTERS_SRC, DECIDE)}" normalize x; echo "${line}"`, `x\n${line}`);
    expectRefusal(await create(s));
  });

  test("a module of the same NAME at another path → exit 2", async () => {
    const path = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.bash(
      `bun run "/tmp/elsewhere/${DECIDE}" decide "${w.be}" /tmp/page.json --title "BE payout export" --parent GF-85 --attempt fast`,
      `{"outcome":"create"}\n${realAnnouncement(path)}`,
    );
    expectRefusal(await create(s));
  });

  test("re-echoing a SPENT create receipt's announcement does not re-arm it → exit 2", async () => {
    const s = new Session();
    const d = realDecide(w.be, { issues: [], isLast: true }, "BE payout export", "fast", { scratch: w.scratch });
    s.bash(d.command, d.out);
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), { id: "10150", key: "GF-150", self: "x" });
    const line = d.out.split("\n").find((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))!;
    s.bash(`echo "${line}" # ${DECIDE}`, line);
    expectRefusal(await create(s), /spent/);
  }, 30_000);

  test("a forged `binding` receipt (decision owned) echoed with the module name does not own FE's key → exit 2", async () => {
    const path = receiptIn(w.be, {
      kind: "binding",
      adapter: "jira",
      container: "GF",
      subject: "GF-101",
      decision: "owned",
      evidence: { verdict: "owned", tracked: 0 },
    });
    const line = realAnnouncement(path);
    const s = new Session();
    s.bash(`echo "${line}" # ${CONFIRM} confirm`, line);
    expectRefusal(
      await runHook(JIRA("transitionJiraIssue"), transition("GF-101"), { cwd: w.be, transcript: s.save(w.scratch) }),
      "GF-101",
    );
  });

  test("a real receipt REWRITTEN after its announcement authorises nothing → exit 2 (control: untouched, it does)", async () => {
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    const d = realDecide(w.be, { issues: [], isLast: true }, "BE payout export", "fast", { scratch: w.scratch });
    s.bash(d.command, d.out);
    const path = announcedPath(d.out);
    const transcript = s.save(w.scratch);
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript }));
    const r = JSON.parse(readFileSync(path, "utf-8"));
    r.evidence.createPayload.summary = "BE something else";
    writeFileSync(path, `${JSON.stringify(r)}\n`);
    expectRefusal(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE something else" }), { cwd: w.be, transcript }),
    );
  }, 30_000);

  test("CONTROL — the real `decide`, recorded with the documented `${CLAUDE_PLUGIN_ROOT}` path, authorises its create → exit 0", async () => {
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    const d = realDecide(w.be, { issues: [], isLast: true }, "BE plugin root form", "fast", {
      scratch: w.scratch,
      commandPath: `\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${DECIDE}`,
    });
    s.bash(d.command, d.out);
    expectPermit(await create(s, jiraCreate({ title: "BE plugin root form" })));
  }, 30_000);
});

describe("M_947c79 review — parallel creates cannot share one receipt (AC-STE-607.3)", () => {
  test("two pending creates in one assistant turn: the first is permitted, the second refused as spent", async () => {
    const w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    pendingToolUses(s, [
      { id: "toolu_607_first", name: JIRA("createJiraIssue"), input: jiraCreate() },
      { id: "toolu_607_second", name: JIRA("createJiraIssue"), input: jiraCreate() },
    ]);
    const transcript = s.save(w.scratch);
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript, toolUseId: "toolu_607_first" }));
    expectRefusal(
      await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript, toolUseId: "toolu_607_second" }),
      /spent/,
    );
  }, 30_000);

  test("CONTROL — two pending creates with two receipts: both permitted", async () => {
    const w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    pendingToolUses(s, [
      { id: "toolu_607_first", name: JIRA("createJiraIssue"), input: jiraCreate() },
      { id: "toolu_607_second", name: JIRA("createJiraIssue"), input: jiraCreate() },
    ]);
    const transcript = s.save(w.scratch);
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript, toolUseId: "toolu_607_first" }));
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript, toolUseId: "toolu_607_second" }));
  }, 30_000);
});

describe("M_947c79 review — a Linear create naming its container by id or slug is unresolvable (AC-STE-607.4 / §4)", () => {
  const UUID = "5b3c0e0e-2f7a-4d0d-9b1c-1a2b3c4d5e6f";
  for (const [label, input] of [
    ["team by UUID", { team: UUID, title: "X", labels: [BE_TAG] }],
    ["project by UUID", { project: UUID, title: "X", labels: [BE_TAG] }],
    ["project by slug", { project: "dpt-dev-process-toolkit-0a1b2c3d4e5f", title: "X", labels: [BE_TAG] }],
  ] as const) {
    test(`save_issue create with ${label} in a declared repository → exit 2 naming it`, async () => {
      const root = linearRepo(BE_TAG);
      const r = await runHook(LINEAR("save_issue"), input, { cwd: root, transcript: new Session().save(tempDir("linear-opaque")) });
      expectRefusal(r, /resolv/i);
    }, 30_000);
  }

  test("CONTROL — a create into a plainly named team no candidate declares stays silent (exit 0)", async () => {
    const root = linearRepo(BE_TAG);
    const r = await runHook(LINEAR("save_issue"), { team: "OPS", title: "X", labels: [] }, {
      cwd: root,
      transcript: new Session().save(tempDir("linear-other")),
    });
    expectPermit(r);
  }, 30_000);
});

describe("M_947c79 review — the shared retry leg, graded on receipts the real `decide` writes (AC-STE-607.3)", () => {
  test("after a spent receipt, a real retry-1 over a page WITHOUT the ticket writes no receipt and the create stays refused; the remedy never promises a fresh create receipt", async () => {
    const w = makeWorld();
    const s = new Session();
    const first = realDecide(w.be, { issues: [], isLast: true }, "BE payout export", "fast", { scratch: w.scratch });
    s.bash(first.command, first.out);
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), "Error: 504 Gateway Timeout", true);
    const retry = realDecide(w.be, { issues: [], isLast: true }, "BE payout export", "retry-1", { scratch: w.scratch });
    expect(retry.out).not.toContain(RECEIPT_ANNOUNCEMENT_PREFIX);
    s.bash(retry.command, retry.out);
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) });
    expectRefusal(r, /decide --attempt/, /reuse/i);
    expect(r.stderr).not.toMatch(/fresh receipt/i);
  }, 30_000);

  test("after a spent receipt, a real retry-1 over a page WITH the created ticket reuses it: a ticket write on that key → exit 0", async () => {
    const w = makeWorld();
    const s = new Session();
    const first = realDecide(w.be, { issues: [], isLast: true }, "BE payout export", "fast", { scratch: w.scratch });
    s.bash(first.command, first.out);
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), "Error: 504 Gateway Timeout", true);
    const retry = realDecide(
      w.be,
      { issues: [jiraTicket("GF-160", "BE payout export")], isLast: true },
      "BE payout export",
      "retry-1",
      { scratch: w.scratch },
    );
    expect(retry.out).toContain('"reused"');
    s.bash(retry.command, retry.out);
    expectPermit(
      await runHook(JIRA("transitionJiraIssue"), transition("GF-160"), { cwd: w.be, transcript: s.save(w.scratch) }),
    );
  }, 30_000);
});

describe("M_947c79 review — only the CREATED key is session-created (AC-STE-607.4)", () => {
  test("a create result echoing a parent/sibling key does not make that key session-created → exit 2 (control: the created key → exit 0)", async () => {
    const w = makeWorld();
    const s = new Session();
    s.mcp(JIRA("createJiraIssue"), jiraCreate(), {
      id: "10150",
      key: "GF-150",
      self: "https://glacy.atlassian.net/rest/api/3/issue/10150",
      fields: { parent: { key: "GF-101" } },
    });
    const transcript = s.save(w.scratch);
    expectPermit(await runHook(JIRA("transitionJiraIssue"), transition("GF-150"), { cwd: w.be, transcript }));
    expectRefusal(await runHook(JIRA("transitionJiraIssue"), transition("GF-101"), { cwd: w.be, transcript }), "GF-101");
  }, 30_000);

  test("a Linear create result names the created identifier; an echoed parent identifier is not created", async () => {
    const root = linearRepo(BE_TAG);
    const s = new Session();
    s.mcp(LINEAR("save_issue"), { team: "OPS", title: "X" }, { id: "u-1", identifier: "STE-900", parent: { identifier: "STE-5" } });
    const transcript = s.save(tempDir("linear-created"));
    expectPermit(await runHook(LINEAR("save_comment"), { issueId: "STE-900", body: "hi" }, { cwd: root, transcript }));
    expectRefusal(await runHook(LINEAR("save_comment"), { issueId: "STE-5", body: "hi" }, { cwd: root, transcript }), "STE-5");
  }, 30_000);
});

describe("M_947c79 review — the join order is enforced by the hook on the REAL `confirm` (AC-STE-606.3)", () => {
  /** Spawn the real `ticket_ownership.ts confirm` with this session's id; returns the transcript command and output. */
  function realConfirm(root: string, key: string, ticket: unknown, adopt: boolean, scratch: string): RealDecide {
    const t = join(scratch, `ticket-${key}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(t, JSON.stringify(ticket));
    const argv = [root, key, t, ...(adopt ? ["--adopt"] : [])];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
    env.CLAUDE_CODE_SESSION_ID = SESSION;
    const mod = join(ADAPTERS_SRC, CONFIRM);
    const p = Bun.spawnSync(["bun", "run", mod, "confirm", ...argv], { env, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`confirm failed: ${p.stderr.toString()}`);
    return { command: `bun run "${mod}" confirm ${argv.map((a) => `"${a}"`).join(" ")}`, out: p.stdout.toString().trimEnd() };
  }
  const unownedTicket = {
    key: "GF-121",
    fields: { summary: "Filed", labels: [], issuetype: { name: "Task" }, project: { key: "GF" }, status: { name: "To Do" }, creator: { displayName: "Someone" }, description: "Filed from the board." },
  };
  const importSync = { cloudId: CLOUD, issueIdOrKey: "GF-121", fields: { labels: [BE_TAG] } };

  test("the import's sync write on an unowned ticket is refused before `confirm`, and permitted after an answered Adopt + the real `confirm --adopt`", async () => {
    const w = makeWorld();
    const before = new Session();
    before.ask("GF-121", "Adopt", { answer: "Adopt GF-121" });
    expectRefusal(
      await runHook(JIRA("editJiraIssue"), importSync, { cwd: w.be, transcript: before.save(w.scratch) }),
      "GF-121",
    );
    const after = new Session();
    after.ask("GF-121", "Adopt", { answer: "Adopt GF-121" });
    const c = realConfirm(w.be, "GF-121", unownedTicket, true, w.scratch);
    after.bash(c.command, c.out);
    expectPermit(await runHook(JIRA("editJiraIssue"), importSync, { cwd: w.be, transcript: after.save(w.scratch) }));
  }, 30_000);
});

describe("M_947c79 review — surfaces describe what shipped", () => {
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");
  test("specs/technical-spec.md Schema L names the sub-section keys, the refusal classes and the receipt store", () => {
    const t = read("specs/technical-spec.md");
    const i = t.indexOf("### Schema L");
    const schemaL = t.slice(i, t.indexOf("\n### ", i + 1));
    for (const needle of ["repo_tag", "min_dpt_version", "RepoTagBindingError", "FIRST_GATED_DPT_VERSION", ".dpt/ledger/receipts/<session>/", "sha256:"]) {
      expect(schemaL, needle).toContain(needle);
    }
  });
  test("README's hooks-reference link text names the receipt-demanding gate", () => {
    const line = read("README.md").split("\n").find((l) => l.includes("docs/hooks-reference.md)"))!;
    expect(line).toContain("pre-tracker-write-gate");
  });
  test("adapters/linear.md states that `save_issue.labels` replaces the set and `addLabels` appends", () => {
    const t = read("plugins/dev-process-toolkit/adapters/linear.md");
    expect(t).not.toContain("append-only on update per the MCP contract");
    expect(t).toMatch(/`save_issue\.labels` REPLACES the full label set/);
    expect(t).toContain("`addLabels`");
  });
  test("the hooks reference states the digest-bound, single-invocation announcement and the shared retry semantics", () => {
    const t = read("plugins/dev-process-toolkit/docs/hooks-reference.md");
    expect(t).toContain("dpt-receipt: <path> sha256:<digest>");
    expect(t).toMatch(/never authorises another create/);
  });
});

// ===========================================================================
// M_947c79 pre-PR /spec-review, round 2. Each case drives the real hook file
// (and, where a forgery or a legitimate command is at stake, the REAL deciding
// module) and was measured red on acce9cf before its fix landed.
// ===========================================================================

/** Quote one argv word for the recorded Bash command, the way a model would. */
function shellWord(a: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'"'"'`)}'`;
}

interface RealRun extends RealDecide {
  code: number;
  err: string;
}

/**
 * Spawn a REAL deciding module with this session's id. `shown` is the module
 * path as the transcript's command spells it (default: the absolute path,
 * double-quoted); `prefix` precedes `bun` in the recorded command.
 */
function realRun(
  mod: string,
  argv: string[],
  opts: { shown?: string; prefix?: string } = {},
): RealRun {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = SESSION;
  const p = Bun.spawnSync(["bun", "run", join(ADAPTERS_SRC, mod), ...argv], { env, stdout: "pipe", stderr: "pipe" });
  const shown = opts.shown ?? `"${join(ADAPTERS_SRC, mod)}"`;
  return {
    command: `${opts.prefix ?? ""}bun run ${shown} ${argv.map(shellWord).join(" ")}`,
    out: p.stdout.toString().trimEnd(),
    code: p.exitCode ?? -1,
    err: p.stderr.toString(),
  };
}

function savePage(scratch: string, page: unknown): string {
  const p = join(scratch, `page-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(page));
  return p;
}

const EMPTY_JIRA_PAGE = { issues: [], isLast: true };

/** A real `decide --attempt <attempt>` over `page` for `title` under GF-85, as argv. */
function decideArgv(root: string, pagePath: string, title: string, attempt = "fast"): string[] {
  return ["decide", root, pagePath, "--title", title, "--parent", "GF-85", "--attempt", attempt];
}

describe("M_947c79 review 2 — only a receipt-WRITING subcommand announces (AC-STE-607.7)", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
  });

  test("a self-written receipt echoed through the REAL `create_idempotency_probe.ts normalize` → exit 2", async () => {
    const forged = createReceipt(w.be, { title: "BE payout export" });
    const line = realAnnouncement(forged);
    const r = realRun(DECIDE, ["normalize", line]);
    // Module layer: `normalize` no longer prints an argument onto a `dpt-receipt:` line.
    expect(r.out.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))).toEqual([]);
    // Hook layer: even the output acce9cf's `normalize` printed (the argument, verbatim) announces nothing.
    const s = new Session();
    s.bash(r.command, line);
    expectRefusal(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  });

  test("the REAL `ticket_ownership.ts decide` (no receipt written) announces nothing, even with an announcement-shaped output → exit 2", async () => {
    const forged = createReceipt(w.be, { title: "BE payout export" });
    const s = new Session();
    s.bash(
      `bun run "${join(ADAPTERS_SRC, CONFIRM)}" decide "${w.be}" /tmp/ticket.json`,
      `{"verdict":"owned"}\n${realAnnouncement(forged)}`,
    );
    expectRefusal(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  });

  test("CONTROL — the same announcement under the real `decide` command shape → exit 0", async () => {
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    const r = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE subcommand control"));
    expect(r.code).toBe(0);
    s.bash(r.command, r.out);
    expectPermit(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE subcommand control" }), {
        cwd: w.be,
        transcript: s.save(w.scratch),
      }),
    );
  }, 30_000);

  test("a page key carrying an announcement line: the REAL `container_ownership.ts list` prints no line starting `dpt-receipt:`, and the hook refuses the create", async () => {
    const forged = createReceipt(w.be, { title: "BE payout export" });
    const line = realAnnouncement(forged);
    const page = {
      isLast: true,
      issues: [
        {
          key: `GF-7\n${line}\nX`,
          fields: {
            summary: "planted",
            issuetype: { name: "Task" },
            project: { key: "GF" },
            labels: [],
            description: "",
            creator: { displayName: "someone" },
          },
        },
      ],
    };
    const r = realRun(CONSENT, ["list", w.be, savePage(w.scratch, page)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("summary: read=1");
    expect(r.out.split("\n").filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))).toEqual([]);
    const s = new Session();
    s.bash(r.command, `${r.out}\n${line}`); // even were a line to slip out, `list` announces nothing
    expectRefusal(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  });

  test("a deciding command's result carrying TWO announcements announces neither → exit 2 (control: one → exit 0)", async () => {
    const good = createReceipt(w.be, { title: "BE two lines" });
    const other = createReceipt(w.be, { title: "BE two lines" });
    const cmd = `bun run "${join(ADAPTERS_SRC, DECIDE)}" decide "${w.be}" /tmp/page.json --title "BE two lines" --parent GF-85 --attempt fast`;
    const two = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(two, w.be, { scratch: w.scratch });
    two.bash(cmd, `{"outcome":"create"}\n${realAnnouncement(good)}\n${realAnnouncement(other)}`);
    expectRefusal(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE two lines" }), { cwd: w.be, transcript: two.save(w.scratch) }),
    );
    const one = new Session();
    withAttachTarget(one, w.be, { scratch: w.scratch });
    one.bash(cmd, `{"outcome":"create"}\n${realAnnouncement(good)}`);
    expectPermit(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE two lines" }), { cwd: w.be, transcript: one.save(w.scratch) }),
    );
  });
});

// ------------------------------------------------ the grammar the prose uses

/** Every `bun run … <deciding module> …` command the shipped prose tells a model to run, in document order. */
function proseCommands(): Array<{ file: string; command: string }> {
  const roots = ["skills", "adapters", "docs"].map((d) => join(PLUGIN_ROOT, d));
  const files: string[] = [];
  for (const r of roots) for (const f of new Glob("**/*.md").scanSync({ cwd: r })) files.push(join(r, f));
  for (const n of ["STE-604", "STE-605", "STE-606", "STE-607"]) files.push(join(REPO_ROOT, "specs", "frs", "archive", `${n}.md`));
  files.sort();
  const out: Array<{ file: string; command: string }> = [];
  const re = /bun run [^`\n]*?(?:create_idempotency_probe|container_ownership|ticket_ownership)\.ts[^`\n]*/g;
  for (const f of files) {
    for (const m of readFileSync(f, "utf-8").matchAll(re)) out.push({ file: f.slice(REPO_ROOT.length + 1), command: m[0].trim() });
  }
  return out;
}

/** Fill the prose placeholders with concrete words; an unknown placeholder is left for the caller to catch. */
function instantiate(shape: string): string {
  return shape
    .replace(/\s*;$/, "")
    .replace(/\[--parent <EpicKey> \| --milestone-label <label> \| --linear-milestone <id>\]/g, "--parent GF-85")
    .replace(/\[container(?: flags)?\]/g, "--parent GF-85")
    .replace(/\[--linear-milestone <id>\]/g, "--linear-milestone m-1")
    .replace(/<fast\|retry-1\|retry-2\|retry-3>/g, "fast")
    .replace(/<fast\|retry-N>/g, "fast")
    .replace(/retry-<N>/g, "retry-1")
    .replace(/<projectRoot>/g, "/tmp/proj")
    .replace(/<page\.json>\.\.\./g, "/tmp/page.json")
    .replace(/<ticket\.json>/g, "/tmp/ticket.json")
    .replace(/<(?:title|t)>/g, '"A title"')
    .replace(/<(?:KEY|key)>/g, "GF-1")
    .replace(/<path>/g, "/tmp/title.txt")
    .replace(/\[--adopt\]/g, "--adopt");
}

const WRITING_SUBCOMMAND: Record<string, string> = { [DECIDE]: "decide", [CONSENT]: "consent", [CONFIRM]: "confirm" };

describe("M_947c79 review 2 — the accepted command grammar is the one the prose teaches (AC-STE-607.7)", () => {
  test("every prose command that writes a receipt is accepted; every other prose command announces nothing", async () => {
    const { invokedDecidingModule } = (await import(MODULE_PATH)) as { invokedDecidingModule: (c: string) => string | null };
    const cmds = proseCommands();
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const { file, command } of cmds) {
      const concrete = instantiate(command);
      if (/[<>[\]]/.test(concrete)) {
        wrong.push(`${file}: unhandled placeholder in ${command}`);
        continue;
      }
      const mod = Object.keys(WRITING_SUBCOMMAND).find((m) => command.includes(m))!;
      const sub = concrete.slice(concrete.indexOf(mod) + mod.length).replace(/^"?\s*/, "").split(/\s+/)[0];
      const writes = sub === WRITING_SUBCOMMAND[mod];
      const got = invokedDecidingModule(concrete);
      if (writes) seen.add(mod);
      if (got !== (writes ? mod : null)) wrong.push(`${file}: ${command} → ${got}`);
    }
    expect(wrong).toEqual([]);
    // Positive control: the extraction really reached every writing front door, in every spelling family.
    expect([...seen].sort()).toEqual(Object.keys(WRITING_SUBCOMMAND).sort());
    expect(cmds.length).toBeGreaterThanOrEqual(20);
    expect(cmds.some((c) => c.command.includes('"${CLAUDE_PLUGIN_ROOT}/'))).toBe(true);
    expect(cmds.some((c) => c.command.includes("run ${CLAUDE_PLUGIN_ROOT}/"))).toBe(true);
  });

  test("no prose spells a deciding module by a relative path the gate cannot resolve", () => {
    const cmds = proseCommands();
    const isRelative = (c: string) => /bun run "?adapters\//.test(c);
    // Positive controls: the grader flags the pre-amendment spelling, and the scan reaches the archived FRs.
    expect(isRelative("bun run adapters/_shared/src/create_idempotency_probe.ts decide")).toBe(true);
    expect(cmds.some((c) => c.file.endsWith("specs/frs/archive/STE-604.md"))).toBe(true);
    expect(cmds.filter((c) => isRelative(c.command))).toEqual([]);
  });

  test("the hooks.json quoting style `\"${CLAUDE_PLUGIN_ROOT}\"/adapters/…` on the REAL `decide` authorises its create → exit 0", async () => {
    const w = makeWorld();
    const r = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE hooks quoting"), {
      shown: `"\${CLAUDE_PLUGIN_ROOT}"/adapters/_shared/src/${DECIDE}`,
    });
    expect(r.code).toBe(0);
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.bash(r.command, r.out);
    expectPermit(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE hooks quoting" }), { cwd: w.be, transcript: s.save(w.scratch) }),
    );
  }, 30_000);

  test("a title with a backtick, `$` and `\\` goes through `--title-file` on the REAL `decide` → exit 0", async () => {
    const w = makeWorld();
    const title = "Make `x` cost $5 \\ less";
    const titleFile = join(w.scratch, "title.txt");
    writeFileSync(titleFile, `${title}\n`);
    const r = realRun(DECIDE, [
      "decide", w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "--title-file", titleFile, "--parent", "GF-85", "--attempt", "fast",
    ]);
    if (r.code !== 0) throw new Error(`decide --title-file failed (${r.code}): ${r.err}`);
    expect(JSON.parse(r.out.split("\n")[0]!).createPayload.summary).toBe(title);
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.bash(r.command, r.out);
    expectPermit(await runHook(JIRA("createJiraIssue"), jiraCreate({ title }), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 30_000);

  test("the refusal states the plain-invocation rule, shows the accepted shape, and names a real `decide` run in a rejected shape", async () => {
    const w = makeWorld();
    const r = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE cd prefix"), {
      prefix: `cd "${w.be}" && `,
    });
    expect(r.code).toBe(0);
    const s = new Session();
    s.bash(r.command, r.out);
    const refusal = await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE cd prefix" }), {
      cwd: w.be,
      transcript: s.save(w.scratch),
    });
    expectRefusal(
      refusal,
      `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${DECIDE}" decide`,
      /one plain command/i,
      "--title-file",
      /not a plain invocation/i,
      `cd "${w.be}" &&`,
    );
  }, 30_000);

  test("the ticket refusal shows the accepted `confirm` and `consent` shapes", async () => {
    const w = makeWorld();
    expectRefusal(
      await runHook(JIRA("transitionJiraIssue"), transition("GF-101"), { cwd: w.be, transcript: new Session().save(w.scratch) }),
      `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${CONFIRM}" confirm`,
      `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${CONSENT}" consent`,
      /one plain command/i,
    );
  });
});

describe("M_947c79 review 2 — container names compare case-insensitively (§3)", () => {
  test("a Jira create into `gf` (declared `GF`) with no receipt → exit 2 (control: `OPS` stays silent)", async () => {
    const w = makeWorld();
    const transcript = new Session().save(w.scratch);
    expectRefusal(await runHook(JIRA("createJiraIssue"), { ...jiraCreate(), projectKey: "gf" }, { cwd: w.be, transcript }));
    expectSilent(await runHook(JIRA("createJiraIssue"), { ...jiraCreate(), projectKey: "OPS" }, { cwd: w.be, transcript }));
  }, 30_000);

  test("a Linear create into team `ste` / project `dpt` (declared `STE`/`DPT`) with no receipt → exit 2", async () => {
    const root = linearRepo(BE_TAG);
    const transcript = new Session().save(tempDir("linear-case"));
    expectRefusal(await runHook(LINEAR("save_issue"), { team: "ste", title: "X", labels: [BE_TAG] }, { cwd: root, transcript }));
    expectRefusal(await runHook(LINEAR("save_issue"), { project: "dpt", title: "X", labels: [BE_TAG] }, { cwd: root, transcript }));
  }, 30_000);

  test("CONTROL — a create into `gf` matching a `GF` create receipt → exit 0", async () => {
    const w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(
      await runHook(JIRA("createJiraIssue"), { ...jiraCreate(), projectKey: "gf" }, { cwd: w.be, transcript: s.save(w.scratch) }),
    );
  }, 30_000);
});

describe("M_947c79 review 2 — after a create that may have made the ticket, only the retry path proceeds (AC-STE-607.3)", () => {
  /** decide fast → create (result given) → decide fast AGAIN over an index-lagged empty page → the gated create. */
  async function reRun(firstResult: { content: unknown; isError: boolean; extra?: Record<string, unknown> }, secondTitle = "BE lagged") {
    const w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt. (every leg of this helper)
    withAttachTarget(s, w.be, { scratch: w.scratch });
    const first = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE lagged"));
    expect(first.code).toBe(0);
    s.bash(first.command, first.out);
    const id = s.toolUse(JIRA("createJiraIssue"), jiraCreate({ title: "BE lagged" }));
    s.toolResult(id, firstResult.content, firstResult.isError, firstResult.extra ?? {});
    const second = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), secondTitle));
    expect(second.out).toContain(RECEIPT_ANNOUNCEMENT_PREFIX); // an honest search missed: a fresh create receipt was minted
    s.bash(second.command, second.out);
    return runHook(JIRA("createJiraIssue"), jiraCreate({ title: secondTitle }), { cwd: w.be, transcript: s.save(w.scratch) });
  }

  test("a create that timed out, then an honest `decide --attempt fast` that missed (index lag) → the second create is refused, naming the retry path", async () => {
    const r = await reRun({ content: "Error: 504 Gateway Timeout", isError: true });
    expectRefusal(r, /may have (made|created)/i, /--attempt retry-/);
  }, 30_000);

  test("an interrupted create is treated the same → exit 2", async () => {
    const r = await reRun({
      content: "[Request interrupted by user for tool use]",
      isError: true,
      extra: { toolDenialKind: "interrupted" },
    });
    expectRefusal(r, /may have (made|created)/i);
  }, 30_000);

  test("CONTROL — the first create was refused by this very hook (it never ran): the fresh receipt authorises the create → exit 0", async () => {
    const r = await reRun({
      content: `PreToolUse:mcp__atlassian__createJiraIssue hook error: ["\${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/${HOOK}.sh]: Refusing: no create receipt.\nRemedy: run decide.\nContext: mode=hook, ticket=unbound, skill=none, hook=${HOOK}\n`,
      isError: true,
      extra: { toolDenialKind: "permission-rule" },
    });
    expectPermit(r);
  }, 30_000);

  test("CONTROL — a hook refusal recorded WITHOUT `toolDenialKind` (an older client) is read from its text → exit 0", async () => {
    const r = await reRun({
      content: `PreToolUse:mcp__atlassian__createJiraIssue hook error: [x]: Refusing: no create receipt.\n`,
      isError: true,
    });
    expectPermit(r);
  }, 30_000);

  test("CONTROL — the first create was rejected by the user (it never ran) → exit 0", async () => {
    const r = await reRun({
      content: "The user doesn't want to proceed with this tool use. The tool use was rejected.",
      isError: true,
      extra: { toolDenialKind: "user-rejected" },
    });
    expectPermit(r);
  }, 30_000);

  test("CONTROL — a timed-out create of ANOTHER title does not block this one → exit 0", async () => {
    expectPermit(await reRun({ content: "Error: 504 Gateway Timeout", isError: true }, "BE unrelated"));
  }, 30_000);
});

describe("M_947c79 review 2 — the archived FRs and the hooks reference state what shipped", () => {
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");
  test("STE-605 and STE-606 front doors print the digest-bound announcement", () => {
    for (const f of ["specs/frs/archive/STE-605.md", "specs/frs/archive/STE-606.md"]) {
      expect(read(f), f).toContain("dpt-receipt: <path> sha256:<digest>");
    }
  });
  test("STE-607 restricts the announcing invocation to the receipt-writing subcommand", () => {
    const t = read("specs/frs/archive/STE-607.md");
    expect(t).toMatch(/`create_idempotency_probe\.ts decide`, `container_ownership\.ts consent`, `ticket_ownership\.ts confirm`/);
    expect(t).toContain("--title-file");
  });
  test("docs/hooks-reference.md documents the accepted grammar, the title-file route and the timed-out-create rule", () => {
    const t = read("plugins/dev-process-toolkit/docs/hooks-reference.md");
    for (const needle of [
      `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/create_idempotency_probe.ts" decide`,
      `"\${CLAUDE_PLUGIN_ROOT}"/adapters/_shared/src/`,
      "--title-file",
      "normalize",
    ]) {
      expect(t, needle).toContain(needle);
    }
    expect(t).toMatch(/may have made the ticket/);
  });
});

// ===========================================================================
// M_947c79 pre-PR /spec-review, round 3. Each case drives the real hook file
// and was measured red on 5742f2e before its fix landed.
// ===========================================================================

describe("M_947c79 review 3 — a definite tracker rejection is not a lost create (AC-STE-607.3)", () => {
  /** decide fast → create (result given) → decide fast again → the corrected create. */
  async function afterFirst(result: string): Promise<Run> {
    const w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt. (every leg of this helper)
    withAttachTarget(s, w.be, { scratch: w.scratch });
    const first = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE rejected once"));
    expect(first.code).toBe(0);
    s.bash(first.command, first.out);
    s.mcp(JIRA("createJiraIssue"), jiraCreate({ title: "BE rejected once", labels: ["wrong"] }), result, true);
    const second = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE rejected once"));
    expect(second.out).toContain(RECEIPT_ANNOUNCEMENT_PREFIX);
    s.bash(second.command, second.out);
    return runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE rejected once" }), { cwd: w.be, transcript: s.save(w.scratch) });
  }

  for (const text of [
    "Error: 400 Bad Request: Field 'labels' cannot be set. It is not on the appropriate screen, or unknown.",
    "Request failed with status code 422",
    "HTTP 403 Forbidden",
  ]) {
    test(`a create rejected with "${text.slice(0, 32)}…" made nothing: a fresh receipt authorises the corrected create → exit 0`, async () => {
      expectPermit(await afterFirst(text));
    }, 30_000);
  }

  for (const text of ["Error: 504 Gateway Timeout", "HTTP 408", "Error: 400 Bad Request (upstream timed out)"]) {
    test(`CONTROL — "${text}" proves nothing: the fresh create is still refused → exit 2`, async () => {
      expectRefusal(await afterFirst(text), /may have (made|created)/i);
    }, 30_000);
  }

  test("every lost-create refusal names a concrete action, never a bare \"a person decides\"", async () => {
    const r = await afterFirst("Error: 504 Gateway Timeout");
    expectRefusal(
      r,
      /AskUserQuestion/,
      `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${CONFIRM}" confirm`,
      /--attempt retry-/,
    );
    expect(r.stderr).not.toMatch(/a person decides\./);
  }, 30_000);
});

describe("M_947c79 review 3 — a malformed transcript never breaks the undeclared silence (AC-STE-607.1)", () => {
  function malformed(s: Session): void {
    s.lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [null, 7, "text", { type: "text", text: "hi" }] } }));
    s.lines.push(JSON.stringify({ type: "user", message: { role: "user", content: [null] } }));
  }

  test("null and non-object content blocks in an UNDECLARED repository → exit 0, empty stdout and stderr", async () => {
    const root = tempDir("undeclared-null");
    declareJira(root, null);
    gitInit(root);
    const s = new Session();
    malformed(s);
    s.bash(`bun run "${join(ADAPTERS_SRC, DECIDE)}" decide "${root}" /tmp/p.json --title T --attempt fast`, "{}");
    expectSilent(await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: root, transcript: s.save(tempDir("null-scratch")) }));
  }, 30_000);

  test("the same malformed blocks beside a real `decide` in a DECLARED repository: its receipt still authorises the create → exit 0", async () => {
    const w = makeWorld();
    const s = new Session();
    // Amended by AC-STE-611.3: the create also needs an attach-target receipt.
    withAttachTarget(s, w.be, { scratch: w.scratch });
    malformed(s);
    const d = realRun(DECIDE, decideArgv(w.be, savePage(w.scratch, EMPTY_JIRA_PAGE), "BE beside nulls"));
    s.bash(d.command, d.out);
    malformed(s);
    expectPermit(
      await runHook(JIRA("createJiraIssue"), jiraCreate({ title: "BE beside nulls" }), { cwd: w.be, transcript: s.save(w.scratch) }),
    );
  }, 30_000);
});

describe("M_947c79 review 3 — the refusal and the FR name what the grammar rejects and what it cannot see", () => {
  test("the plain-invocation rule names bare `$VAR`, `$(…)` and `~`", async () => {
    const w = makeWorld();
    const r = await runHook(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: new Session().save(w.scratch) });
    expectRefusal(r, "$VAR", "$(…)", "`~`");
  }, 30_000);

  test("STE-607 records the Bun-environment tampering class as a residual with a named follow-up", () => {
    const t = readFileSync(join(REPO_ROOT, "specs/frs/archive/STE-607.md"), "utf-8");
    for (const needle of ["bunfig.toml", "preload", "PATH"]) expect(t, needle).toContain(needle);
    expect(t).toMatch(/follow-up[^.\n]*Bun('s)? config/i);
  });
});

// ===========================================================================
// AC-STE-608.10 (M_685ff6) — container calls in a declared target are DECIDED
// against a `milestone-decision` receipt written by the decision front door
// (`resolve_milestone_identity.ts`). Every leg below is driven through the
// hook's SHELL entry, `templates/hooks/process/pre-tracker-write-gate.sh`,
// with a recorded tool payload on stdin; receipts come from the REAL front
// door, announced in the transcript by the command that ran it.
// ===========================================================================

const RESOLVE = "resolve_milestone_identity.ts";
const SH_ENTRY_REL = join("templates", "hooks", "process", `${HOOK}.sh`);

/**
 * A plugin root for the shell entry: the fixture manifest (so the floor reads
 * MANIFEST_VERSION) beside symlinks to this plugin's real `templates` and
 * `adapters`, so `${CLAUDE_PLUGIN_ROOT}/templates/…` resolves to the real hook.
 */
let SH_ROOT = "";
function shRoot(): string {
  if (SH_ROOT === "") {
    SH_ROOT = tempDir("sh-root");
    pluginManifest(SH_ROOT, MANIFEST_VERSION);
    symlinkSync(join(PLUGIN_ROOT, "templates"), join(SH_ROOT, "templates"));
    symlinkSync(join(PLUGIN_ROOT, "adapters"), join(SH_ROOT, "adapters"));
  }
  return SH_ROOT;
}

async function spawnSh(stdin: string): Promise<Run> {
  hooksInFlight += 1;
  peakHooksInFlight = Math.max(peakHooksInFlight, hooksInFlight);
  try {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.CLAUDE_PROJECT_DIR;
    env.CLAUDE_PLUGIN_ROOT = shRoot();
    env.CLAUDE_CODE_SESSION_ID = SESSION;
    const proc = Bun.spawn(["bash", join(shRoot(), SH_ENTRY_REL)], {
      cwd: NEUTRAL_CWD,
      env,
      stdin: new Response(stdin).body,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { exitCode: await proc.exited, stdout, stderr };
  } finally {
    hooksInFlight -= 1;
  }
}

function runSh(tool: string, input: unknown, o: RunOpts): Promise<Run> {
  return spawnSh(payload(tool, input, o));
}

interface Resolved {
  command: string;
  out: string;
  receipt: string;
}

/**
 * AC-STE-610.4: in a shared repository a join names its sibling, and the
 * sibling must hold a plan for the milestone. FE gets one, so BE's join can
 * pass `--sibling <FE>`; returns FE's root for that flag.
 */
function siblingWithPlan(w: World, milestone = "M_GF_85"): string {
  const dir = join(w.fe, "specs", "plan");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${milestone}.md`), `---\nmilestone: ${milestone}\nstatus: active\narchived_at: null\n---\n\n# ${milestone}\n`);
  return w.fe;
}

/** Spawn the REAL decision front door; `session` defaults to this suite's. */
function realResolve(root: string, argv: string[], scratch: string, listing: unknown, session = SESSION): Resolved {
  const listingPath = join(scratch, `listing-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(listingPath, JSON.stringify(listing));
  const full = [root, argv[0]!, argv[1]!, listingPath, ...argv.slice(2)];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = session;
  const p = Bun.spawnSync(["bun", "run", join(ADAPTERS_SRC, RESOLVE), ...full], { env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`the decision front door failed (exit ${p.exitCode}): ${p.stderr.toString()}`);
  const out = p.stdout.toString().trimEnd();
  return {
    command: `bun run "${join(ADAPTERS_SRC, RESOLVE)}" ${full.map((a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `"${a}"`)).join(" ")}`,
    out,
    receipt: announcedPath(out),
  };
}

const epicRow = (key: string, summary: string, labels: string[] = []) => ({
  key,
  fields: {
    summary,
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    labels,
    issuetype: { name: "Epic" },
    project: { key: "GF" },
  },
});

const EPIC_CREATE = (title: string) => jiraCreate({ type: "Epic", parent: null, title });

describe("AC-STE-608.10 — the hook announces the decision front door's receipts", () => {
  test("resolve_milestone_identity.ts is APPENDED to RECEIPT_ANNOUNCING_MODULES", async () => {
    const { RECEIPT_ANNOUNCING_MODULES } = await hookModule();
    // Amended by AC-STE-611.3: the attach front door is appended after it.
    expect(RECEIPT_ANNOUNCING_MODULES.indexOf(RESOLVE)).toBe(RECEIPT_ANNOUNCING_MODULES.indexOf("attach_project_milestone.ts") - 1);
    expect(RECEIPT_ANNOUNCING_MODULES.indexOf(RESOLVE)).toBe(3);
    expect(RECEIPT_ANNOUNCING_MODULES.slice(0, 3)).toEqual([DECIDE, CONSENT, CONFIRM]);
  });
});

describe("AC-STE-608.10 (a) — an Epic create needs a create decision for the same project and a byte-equal title", () => {
  test("permit: a create receipt for GF + \"BE Payouts\" → exit 0", async () => {
    const w = makeWorld();
    const s = new Session();
    const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    s.bash(d.command, d.out);
    expectPermit(await runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 30_000);

  test("forbid: no receipt, a title differing by one byte, a join receipt, another project → exit 2 naming the front door", async () => {
    const w = makeWorld();
    const none = new Session().save(w.scratch);
    const create = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const drift = new Session();
    drift.bash(create.command, create.out);
    // Amended by AC-STE-610.4: a shared join names its sibling.
    const join_ = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts", "--sibling", siblingWithPlan(w)], w.scratch, { issues: [epicRow("GF-85", "BE Payouts")], isLast: true });
    const joined = new Session();
    joined.bash(join_.command, join_.out);
    const nex = realResolve(w.be, ["jira", "NEX", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const other = new Session();
    other.bash(nex.command, nex.out);
    const cases: Array<[string, unknown, string]> = [
      ["no receipt", EPIC_CREATE("BE Payouts"), none],
      ["title drift (case)", EPIC_CREATE("BE payouts"), drift.save(w.scratch)],
      ["title drift (trailing space)", EPIC_CREATE("BE Payouts "), drift.save(w.scratch)],
      ["join receipt", EPIC_CREATE("BE Payouts"), joined.save(w.scratch)],
      ["other project", EPIC_CREATE("BE Payouts"), other.save(w.scratch)],
    ];
    const runs = await mapBounded(cases, HOOK_SPAWN_LIMIT, ([, input, transcript]) =>
      runSh(JIRA("createJiraIssue"), input, { cwd: w.be, transcript }),
    );
    runs.forEach((r, i) => {
      try {
        expectRefusal(r, RESOLVE);
      } catch (e) {
        throw new Error(`${cases[i]![0]}: ${(e as Error).message}`);
      }
    });
    expect(peakHooksInFlight).toBeLessThanOrEqual(HOOK_SPAWN_LIMIT);
  }, 60_000);

  test("forbid: a milestone-decision receipt announced by any other command is ignored → exit 2", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s = new Session();
    s.bash(`bun run "${join(ADAPTERS_SRC, "mint_milestone_epic.ts")}" GF "BE Payouts" GF-300`, d.out);
    expectRefusal(await runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript: s.save(w.scratch) }), RESOLVE);
  }, 30_000);

  test("forbid: a receipt from another session, or from another repository, does not satisfy → exit 2", async () => {
    const w = makeWorld();
    const otherSession = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE, OTHER_SESSION);
    const s1 = new Session();
    s1.bash(otherSession.command, otherSession.out);
    const elsewhere = tempDir("other-repo");
    declareJira(elsewhere, null);
    gitInit(elsewhere);
    const otherRepo = realResolve(elsewhere, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s2 = new Session();
    s2.bash(otherRepo.command, otherRepo.out);
    const runs = await mapBounded([s1.save(w.scratch), s2.save(w.scratch)], HOOK_SPAWN_LIMIT, (transcript) =>
      runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript }),
    );
    for (const r of runs) expectRefusal(r, RESOLVE);
  }, 30_000);

  test("forbid: an unreadable or malformed receipt counts as absent → exit 2", async () => {
    const w = makeWorld();
    const bad = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s1 = new Session();
    s1.bash(bad.command, bad.out);
    writeFileSync(bad.receipt, "{not json");
    const r1 = await runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript: s1.save(w.scratch) });
    expectRefusal(r1, RESOLVE);

    const locked = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s2 = new Session();
    s2.bash(locked.command, locked.out);
    chmodSync(locked.receipt, 0o000);
    cleanups.push(() => chmodSync(locked.receipt, 0o644));
    const r2 = await runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript: s2.save(w.scratch) });
    expectRefusal(r2, RESOLVE);
  }, 30_000);
});

describe("AC-STE-608.10 (b) — save_milestone", () => {
  test("permit: save_milestone without id under a create receipt on the same project and name → exit 0", async () => {
    const root = linearRepo(BE_TAG);
    const scratch = tempDir("lin-608");
    const d = realResolve(root, ["linear", "DPT", "--title", "Payouts"], scratch, { milestones: [] });
    const s = new Session();
    s.bash(d.command, d.out);
    expectPermit(await runSh(LINEAR("save_milestone"), { project: "DPT", name: "Payouts" }, { cwd: root, transcript: s.save(scratch) }));
  }, 30_000);

  test("forbid: no receipt, another name, or an `id` (no flow edits a milestone) → exit 2", async () => {
    const root = linearRepo(BE_TAG);
    const scratch = tempDir("lin-608-forbid");
    const d = realResolve(root, ["linear", "DPT", "--title", "Payouts"], scratch, { milestones: [] });
    const s = new Session();
    s.bash(d.command, d.out);
    const withReceipt = s.save(scratch);
    const cases: Array<[unknown, string]> = [
      [{ project: "DPT", name: "Payouts" }, new Session().save(scratch)],
      [{ project: "DPT", name: "Payouts II" }, withReceipt],
      [{ project: "DPT", name: "Payouts", id: "550e8400-e29b-41d4-a716-446655440000" }, withReceipt],
    ];
    const runs = await mapBounded(cases, HOOK_SPAWN_LIMIT, ([input, transcript]) =>
      runSh(LINEAR("save_milestone"), input, { cwd: root, transcript }),
    );
    for (const r of runs) expectRefusal(r, RESOLVE);
  }, 30_000);
});

describe("AC-STE-608.10 (c) — save_project", () => {
  test("forbid: save_project in a declared target → exit 2, even beside a create receipt", async () => {
    const root = linearRepo(BE_TAG);
    const scratch = tempDir("lin-608-project");
    const d = realResolve(root, ["linear", "DPT", "--title", "Payouts"], scratch, { milestones: [] });
    const s = new Session();
    s.bash(d.command, d.out);
    expectRefusal(await runSh(LINEAR("save_project"), { name: "DPT", team: "STE" }, { cwd: root, transcript: s.save(scratch) }), RESOLVE, /project/i);
  }, 30_000);
});

describe("AC-STE-608.10 (d) — a label write on a joined Epic is a read-merge", () => {
  test("permit: labels keep every listed label plus the milestone label → exit 0; forbid: the SET that clobbers → exit 2", async () => {
    const w = makeWorld();
    // Amended by AC-STE-610.4: a shared join names its sibling.
    const d = realResolve(w.be, ["jira", "GF", "--join-key", "GF-85", "--sibling", siblingWithPlan(w)], w.scratch, { issues: [epicRow("GF-85", "Payouts", ["team-x"])], isLast: true });
    const s = new Session();
    s.bash(d.command, d.out);
    const transcript = s.save(w.scratch);
    const edit = (labels: string[]) => ({ cloudId: CLOUD, issueIdOrKey: "GF-85", fields: { labels } });
    const [merged, clobber, noMilestone] = await mapBounded(
      [edit(["team-x", "milestone-M_GF_85"]), edit(["milestone-M_GF_85"]), edit(["team-x"])],
      HOOK_SPAWN_LIMIT,
      (input) => runSh(JIRA("editJiraIssue"), input, { cwd: w.be, transcript }),
    );
    expectPermit(merged!);
    expectRefusal(clobber!, RESOLVE);
    expectRefusal(noMilestone!, RESOLVE);
  }, 30_000);

  test("a label write on an Epic this session created stays under the STE-607 ownership rule → exit 0", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s = new Session();
    s.bash(d.command, d.out);
    s.mcp(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { key: "GF-300", id: "10300" });
    expectPermit(
      await runSh(JIRA("editJiraIssue"), { cloudId: CLOUD, issueIdOrKey: "GF-300", fields: { labels: ["milestone-M_GF_300"] } }, {
        cwd: w.be,
        transcript: s.save(w.scratch),
      }),
    );
  }, 30_000);
});

describe("AC-STE-608.10 (f) — every other container kind is refused, except the repo's own tag label", () => {
  const LABEL_ID = "5d3f0f5e-0000-4000-8000-000000000003";
  const refused: Array<[string, Record<string, unknown>, RegExp]> = [
    ["create_issue_label", { name: "some-label", team: "STE" }, /label/i],
    ["save_issue_label", { id: LABEL_ID, name: BE_TAG, team: "STE" }, /label/i],
    ["save_issue_label", { name: "some-label", team: "STE" }, /label/i],
    ["retire_issue_label", { id: LABEL_ID }, /label/i],
    ["restore_issue_label", { id: LABEL_ID }, /label/i],
    ["save_project_label", { name: "some-project-label" }, /label/i],
    ["retire_project_label", { id: LABEL_ID }, /label/i],
    ["restore_project_label", { id: LABEL_ID }, /label/i],
    ["save_status_update", { project: "DPT", body: "On track." }, /status update/i],
    ["delete_status_update", { id: "5d3f0f5e-0000-4000-8000-000000000004" }, /status update/i],
    ["save_document", { project: "DPT", title: "Notes", content: "Body." }, /document/i],
  ];

  test("forbid: each kind exits 2 naming the kind and the decision front door", async () => {
    const root = linearRepo(BE_TAG);
    const transcript = new Session().save(tempDir("lin-608-kinds"));
    const runs = await mapBounded(refused, HOOK_SPAWN_LIMIT, ([tool, input]) => runSh(LINEAR(tool), input, { cwd: root, transcript }));
    runs.forEach((r, i) => {
      const [tool, , kind] = refused[i]!;
      try {
        expectRefusal(r, RESOLVE, kind);
      } catch (e) {
        throw new Error(`${tool}: ${(e as Error).message}`);
      }
    });
    expect(peakHooksInFlight).toBeLessThanOrEqual(HOOK_SPAWN_LIMIT);
  }, 60_000);

  test("permit: create_issue_label whose name equals the target's repo_tag → exit 0", async () => {
    const root = linearRepo(BE_TAG);
    const transcript = new Session().save(tempDir("lin-608-tag"));
    expectPermit(await runSh(LINEAR("create_issue_label"), { name: BE_TAG, team: "STE" }, { cwd: root, transcript }));
  }, 30_000);

  test("(control) undeclared targets: every AC-STE-608.10 payload stays silent", async () => {
    const linear = linearRepo(null);
    const jira = tempDir("undeclared-608");
    declareJira(jira, null);
    gitInit(jira);
    const transcript = new Session().save(tempDir("undeclared-608-scratch"));
    const calls: Array<[string, unknown, string]> = [
      [JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), jira],
      [JIRA("editJiraIssue"), { cloudId: CLOUD, issueIdOrKey: "GF-85", fields: { labels: ["milestone-M_GF_85"] } }, jira],
      [LINEAR("save_milestone"), { project: "DPT", name: "Payouts", id: "550e8400-e29b-41d4-a716-446655440000" }, linear],
      [LINEAR("save_project"), { name: "DPT", team: "STE" }, linear],
      ...refused.map(([tool, input]) => [LINEAR(tool), input, linear] as [string, unknown, string]),
    ];
    const runs = await mapBounded(calls, HOOK_SPAWN_LIMIT, ([tool, input, cwd]) => runSh(tool, input, { cwd, transcript }));
    runs.forEach((r, i) => {
      try {
        expectSilent(r);
      } catch (e) {
        throw new Error(`${calls[i]![0]}: ${(e as Error).message}`);
      }
    });
  }, 60_000);
});

// ===========================================================================
// STE-608 mutation review — two holes the first-round legs could not trip.
// M9: the "announced by any other command" leg announced through a module the
// grammar never accepts, so dropping the module check left it green. These
// legs announce the SAME real receipt through a command the grammar DOES
// accept (a real deciding module), which only the module check can refuse.
// M10: no leg shared one create decision between two creates, so a decision
// that was never spent left every leg green.
// ===========================================================================

describe("AC-STE-608.10 hardening — only the decision front door's own run announces a milestone decision", () => {
  test("forbid: the real receipt announced by an ACCEPTED deciding module (ticket_ownership.ts confirm) → exit 2", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s = new Session();
    s.bash(`bun run "${join(ADAPTERS_SRC, CONFIRM)}" confirm "${w.be}" GF-1 /tmp/ticket.json`, d.out);
    expectRefusal(await runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript: s.save(w.scratch) }), RESOLVE);
  }, 30_000);

  test("control: the same receipt announced by the front door's own run → exit 0", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s = new Session();
    s.bash(d.command, d.out);
    expectPermit(await runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 30_000);
});

describe("AC-STE-608.10 hardening — one create decision authorises ONE container create", () => {
  test("two pending Epic creates on one decision: the first is permitted, the second refused as spent", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
    const s = new Session();
    s.bash(d.command, d.out);
    pendingToolUses(s, [
      { id: "toolu_608_first", name: JIRA("createJiraIssue"), input: EPIC_CREATE("BE Payouts") },
      { id: "toolu_608_second", name: JIRA("createJiraIssue"), input: EPIC_CREATE("BE Payouts") },
    ]);
    const transcript = s.save(w.scratch);
    const [first, second] = await mapBounded(["toolu_608_first", "toolu_608_second"], HOOK_SPAWN_LIMIT, (toolUseId) =>
      runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript, toolUseId }),
    );
    expectPermit(first!);
    expectRefusal(second!, /spent/, RESOLVE);
  }, 30_000);

  test("control: two decisions, two pending Epic creates → both permitted", async () => {
    const w = makeWorld();
    const s = new Session();
    for (let i = 0; i < 2; i++) {
      const d = realResolve(w.be, ["jira", "GF", "--title", "BE Payouts"], w.scratch, EMPTY_JIRA_PAGE);
      s.bash(d.command, d.out);
    }
    pendingToolUses(s, [
      { id: "toolu_608_first", name: JIRA("createJiraIssue"), input: EPIC_CREATE("BE Payouts") },
      { id: "toolu_608_second", name: JIRA("createJiraIssue"), input: EPIC_CREATE("BE Payouts") },
    ]);
    const transcript = s.save(w.scratch);
    const runs = await mapBounded(["toolu_608_first", "toolu_608_second"], HOOK_SPAWN_LIMIT, (toolUseId) =>
      runSh(JIRA("createJiraIssue"), EPIC_CREATE("BE Payouts"), { cwd: w.be, transcript, toolUseId }),
    );
    for (const r of runs) expectPermit(r);
  }, 30_000);
});

// ===========================================================================
// AC-STE-611.3 / .6 (M_685ff6) — an FR create in a shared repository needs an
// `attach-target` receipt from the attach front door
// (`attach_project_milestone.ts <projectRoot> <mode> <project> <planFile>
// <listingFile>`), announced by that front door's own run, from this session,
// in the target repository, resolving a surface in the create's project; a
// payload that names a parent must name the key the receipt resolved. Every
// leg runs through the shell entry with a recorded payload on stdin; receipts
// come from the REAL front door. RED on 3170dfc: the front door does not exist
// (a `bun run` of the module prints nothing) and the hook permits the create.
// ===========================================================================

const ATTACH = "attach_project_milestone.ts";
const GF_85_PAGE = { issues: [epicRow("GF-85", "Payouts")], isLast: true };

interface Attached {
  command: string;
  exitCode: number;
  out: string;
  err: string;
  receipt: string | null;
}

/** Spawn the REAL attach front door; never throws — the caller grades the outcome. */
function realAttach(
  root: string,
  project: string,
  plan: string,
  scratch: string,
  listing: unknown,
  session = SESSION,
  mode: "jira" | "linear" = "jira",
): Attached {
  const listingPath = join(scratch, `attach-listing-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(listingPath, JSON.stringify(listing));
  const full = [root, mode, project, plan, listingPath];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.CLAUDE_PLUGIN_ROOT = MANIFEST_DIR;
  env.CLAUDE_CODE_SESSION_ID = session;
  const p = Bun.spawnSync(["bun", "run", join(ADAPTERS_SRC, ATTACH), ...full], { env, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString().trimEnd();
  const line = out.split("\n").find((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));
  return {
    command: `bun run "${join(ADAPTERS_SRC, ATTACH)}" ${full.map((a) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `"${a}"`)).join(" ")}`,
    exitCode: p.exitCode ?? -1,
    out,
    err: p.stderr.toString(),
    receipt: line ? line.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim().split(/\s+/)[0]! : null,
  };
}

/** A real front-door run that must have resolved; returns it for the transcript. */
function attached(
  root: string,
  project: string,
  plan: string,
  scratch: string,
  listing: unknown,
  session = SESSION,
  mode: "jira" | "linear" = "jira",
): Attached {
  const a = realAttach(root, project, plan, scratch, listing, session, mode);
  if (a.exitCode !== 0 || a.receipt === null) {
    throw new Error(`the attach front door did not resolve (exit ${a.exitCode}):\n${a.out}\n${a.err}`);
  }
  return a;
}

/** Write `specs/plan/<token>.md` with a canonical heading; commit it when asked (continuing work). */
function planIn(root: string, token: string, title: string, commit: boolean): string {
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  const p = join(root, "specs", "plan", `${token}.md`);
  writeFileSync(p, `---\nmilestone: ${token}\nstatus: active\narchived_at: null\n---\n\n## ${token} — ${title} {#${token}}\n\nBody.\n`);
  if (commit) {
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", `plan ${token}`);
  }
  return p;
}

/** BE with its M_GF_85 plan committed, and a session that resolved it through the real front door. */
function attachedWorld(session = SESSION): { w: World; a: Attached } {
  const w = makeWorld();
  const plan = planIn(w.be, "M_GF_85", "Payouts", true);
  return { w, a: attached(w.be, "GF", plan, w.scratch, GF_85_PAGE, session) };
}

/** The Linear milestone the attach-target legs resolve; its plan token derives from this id (`M_550e84`). */
const LINEAR_ATTACH_MILESTONE = "550e8400-e29b-41d4-a716-446655440000";

/**
 * Since AC-STE-611.3 an FR create in a declared target needs, beside its create
 * receipt, an `attach-target` receipt. The legs that grade the CREATE-receipt
 * rule call this so they keep grading only that rule: it commits the milestone's
 * plan in `root` (only that path — whatever else sits in the index stays
 * staged), runs the REAL attach front door with this session's id, and records
 * its Bash tool_use + tool_result in `s` at the current position (so callers run
 * it before the create's own tool_use). Jira resolves Epic `key` (default
 * GF-85, the parent `jiraCreate` sends) from plan `M_<key>`; Linear resolves
 * LINEAR_ATTACH_MILESTONE from the plan its id derives.
 */
function withAttachTarget(
  s: Session,
  root: string,
  opts: { project?: string; mode?: "jira" | "linear"; key?: string; scratch?: string } = {},
): Attached {
  const mode = opts.mode ?? "jira";
  const scratch = opts.scratch ?? tempDir("611-attach");
  let project: string;
  let token: string;
  let listing: unknown;
  if (mode === "jira") {
    const key = opts.key ?? "GF-85";
    project = opts.project ?? key.split("-")[0]!;
    token = milestoneIdFromEpicKey(key);
    const row = epicRow(key, "Payouts");
    listing = { issues: [{ ...row, fields: { ...row.fields, project: { key: project } } }], isLast: true };
  } else {
    project = opts.project ?? "DPT";
    token = milestoneIdFromLinearMilestone(LINEAR_ATTACH_MILESTONE);
    listing = { milestones: [{ id: LINEAR_ATTACH_MILESTONE, name: "Payouts" }] };
  }
  const plan = join(root, "specs", "plan", `${token}.md`);
  if (!existsSync(plan)) {
    planIn(root, token, "Payouts", false);
    git(root, "add", "--", plan);
    git(root, "commit", "-q", "-m", `plan ${token}`, "--", plan);
  }
  const a = attached(root, project, plan, scratch, listing, SESSION, mode);
  s.bash(a.command, a.out);
  return a;
}

describe("AC-STE-611.3 — the hook announces the attach front door's receipts", () => {
  test("attach_project_milestone.ts is APPENDED to RECEIPT_ANNOUNCING_MODULES", async () => {
    const { RECEIPT_ANNOUNCING_MODULES } = await hookModule();
    expect(RECEIPT_ANNOUNCING_MODULES[RECEIPT_ANNOUNCING_MODULES.length - 1]).toBe(ATTACH);
    expect(RECEIPT_ANNOUNCING_MODULES.slice(0, 4)).toEqual([DECIDE, CONSENT, CONFIRM, RESOLVE]);
  });
});

describe("AC-STE-611.3 — an FR create in a shared repository needs an attach-target receipt", () => {
  test("permit: an attach-target receipt resolving GF-85 plus a matching create receipt → exit 0", async () => {
    const { w, a } = attachedWorld();
    const s = new Session();
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 30_000);

  test("forbid: a matching create receipt but no attach-target receipt → exit 2, NFR-10 naming the front door", async () => {
    const w = makeWorld();
    const s = new Session();
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    const r = await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) });
    expectRefusal(r, ATTACH, /Context:/);
  }, 30_000);

  test("forbid: an unreadable or a rewritten attach-target receipt counts as absent → exit 2", async () => {
    const one = attachedWorld();
    const s1 = new Session();
    s1.bash(one.a.command, one.a.out);
    s1.announceDecide(one.w.be, createReceipt(one.w.be, { title: "BE payout export" }));
    chmodSync(one.a.receipt!, 0o000);
    cleanups.push(() => chmodSync(one.a.receipt!, 0o644));

    const two = attachedWorld();
    const s2 = new Session();
    s2.bash(two.a.command, two.a.out);
    s2.announceDecide(two.w.be, createReceipt(two.w.be, { title: "BE payout export" }));
    writeFileSync(two.a.receipt!, "{not json");

    const runs = await mapBounded(
      [
        { w: one.w, transcript: s1.save(one.w.scratch) },
        { w: two.w, transcript: s2.save(two.w.scratch) },
      ],
      HOOK_SPAWN_LIMIT,
      (c) => runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: c.w.be, transcript: c.transcript }),
    );
    for (const r of runs) expectRefusal(r, ATTACH);
  }, 60_000);

  test("forbid: an attach-target receipt from ANOTHER session does not satisfy → exit 2", async () => {
    const { w, a } = attachedWorld(OTHER_SESSION);
    const s = new Session();
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectRefusal(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }), ATTACH);
  }, 30_000);

  test("forbid: the payload's parent differs from the key the receipt resolved → exit 2", async () => {
    const { w, a } = attachedWorld();
    const s = new Session();
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export", parent: "GF-89" }));
    const r = await runSh(JIRA("createJiraIssue"), jiraCreate({ parent: "GF-89" }), { cwd: w.be, transcript: s.save(w.scratch) });
    expectRefusal(r, "GF-85", "GF-89");
  }, 30_000);

  test("forgery: an attach-target receipt announced by any other module, or by the front door with extra argv, is ignored → exit 2", async () => {
    const { w, a } = attachedWorld();
    const forged = new Session();
    forged.bash(`bun run "${join(ADAPTERS_SRC, "mint_milestone_epic.ts")}" GF "Payouts" GF-300`, a.out);
    forged.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    const extra = new Session();
    extra.bash(`${a.command} --force`, a.out);
    extra.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    const runs = await mapBounded([forged.save(w.scratch), extra.save(w.scratch)], HOOK_SPAWN_LIMIT, (transcript) =>
      runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript }),
    );
    for (const r of runs) expectRefusal(r, ATTACH);
  }, 30_000);

  test("forbid: a Linear save_issue without `id` in a shared repository needs one too → exit 2", async () => {
    const root = linearRepo(BE_TAG);
    const scratch = tempDir("611-linear");
    const path = receiptIn(root, {
      kind: "create",
      adapter: "linear",
      container: "",
      subject: "A new ticket",
      decision: "create",
      evidence: { createPayload: { team: "STE", project: "DPT", title: "A new ticket", labels: [BE_TAG] } },
    });
    const s = new Session();
    s.announce(DECIDE, `decide "${root}" /tmp/page.json --title "A new ticket" --attempt fast`, path);
    const input = { team: "STE", project: "DPT", title: "A new ticket", labels: [BE_TAG] };
    expectRefusal(await runSh(LINEAR("save_issue"), input, { cwd: root, transcript: s.save(scratch) }), ATTACH);
  }, 30_000);

  test("(control) no repo_tag: the Jira FR create and the Linear save_issue both exit 0 with empty output", async () => {
    const jira = tempDir("611-undeclared-jira");
    declareJira(jira, null);
    gitInit(jira);
    const linear = linearRepo(null);
    const transcript = new Session().save(tempDir("611-undeclared-scratch"));
    const runs = await mapBounded(
      [
        { tool: JIRA("createJiraIssue"), input: jiraCreate(), cwd: jira },
        { tool: LINEAR("save_issue"), input: { team: "STE", project: "DPT", title: "A new ticket", labels: [] }, cwd: linear },
      ],
      HOOK_SPAWN_LIMIT,
      (c) => runSh(c.tool, c.input, { cwd: c.cwd, transcript }),
    );
    for (const r of runs) expectSilent(r);
  }, 30_000);
});

describe("AC-STE-611.6 — the stranding scenario, through the hook", () => {
  test("repo_tag, bound to GF, plan M_GB_40: the front door exits 1 naming GB with no receipt, and the FR create is refused", async () => {
    const w = makeWorld();
    const plan = planIn(w.be, "M_GB_40", "Payouts", true);
    const a = realAttach(w.be, "GF", plan, w.scratch, GF_85_PAGE);
    expect(a.exitCode).toBe(1);
    expect(a.out).toBe("");
    expect(a.err).toContain("GB");
    expect(a.receipt).toBeNull();
    const s = new Session();
    s.bash(a.command, a.err, true);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export", parent: "GB-40" }));
    const r = await runSh(JIRA("createJiraIssue"), jiraCreate({ parent: "GB-40" }), { cwd: w.be, transcript: s.save(w.scratch) });
    expectRefusal(r, ATTACH);
  }, 30_000);

  test("(control) bound to GB: the target resolves to GB-40, the receipt is written and the hook permits the create", async () => {
    const root = tempDir("611-gb");
    claudeMd(root, { mode: "jira", project: "GB", defaultLabels: [BE_TAG], repoTag: BE_TAG, minDptVersion: "2.87.0" });
    gitInit(root);
    const plan = planIn(root, "M_GB_40", "Payouts", true);
    const scratch = tempDir("611-gb-scratch");
    const gbEpic = { ...epicRow("GB-40", "Payouts"), fields: { ...epicRow("GB-40", "Payouts").fields, project: { key: "GB" } } };
    const a = attached(root, "GB", plan, scratch, { issues: [gbEpic], isLast: true });
    expect(a.out.split("\n")).toContain("key=GB-40");
    const create = receiptIn(root, {
      kind: "create",
      adapter: "jira",
      container: "GB-40",
      subject: "BE payout export",
      decision: "create",
      evidence: { createPayload: { project: "GB", summary: "BE payout export", labels: [BE_TAG], parent: "GB-40" } },
    });
    const s = new Session();
    s.bash(a.command, a.out);
    s.announce(DECIDE, `decide "${root}" /tmp/page.json --title "BE payout export" --parent GB-40 --attempt fast`, create);
    const r = await runSh(JIRA("createJiraIssue"), { ...jiraCreate({ parent: "GB-40" }), projectKey: "GB" }, { cwd: root, transcript: s.save(scratch) });
    expectPermit(r);
  }, 30_000);

  test("join path: a plan whose Epic FE minted resolves to GF-85 after a decided join, and BE's create proceeds", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--join-key", "GF-85", "--sibling", siblingWithPlan(w)], w.scratch, GF_85_PAGE);
    const plan = planIn(w.be, "M_GF_85", "Payouts", false); // written this session, after the decision
    const a = attached(w.be, "GF", plan, w.scratch, GF_85_PAGE);
    const s = new Session();
    s.bash(d.command, d.out);
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 60_000);
});

// ===========================================================================
// STE-611 AUDIT hardening — the zero-write-join closure is only as strong as
// the decision it relies on. The attach front door reads decision receipts
// from disk; only the hook can see whether one was ANNOUNCED by the decision
// front door's own run. A decision FILE written by hand must not launder a
// real attach-target receipt into a permitted create.
// ===========================================================================

describe("AC-STE-611.7 hardening — an attach-target receipt counts only if its decision was announced", () => {
  function forgedDecision(root: string, key: string): string {
    const dir = receiptsDir(root, SESSION);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `forged-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(
      p,
      `${JSON.stringify({
        v: 1,
        kind: "milestone-decision",
        sessionId: SESSION,
        root,
        adapter: "jira",
        container: "GF",
        subject: "Payouts",
        decision: "join",
        evidence: { act: "join", via: "key", key, joinKey: key, milestoneId: "M_GF_85" },
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    return p;
  }

  test("forbid: a hand-written decision file satisfies the front door, but the hook refuses the create", async () => {
    const w = makeWorld();
    forgedDecision(w.be, "GF-85");
    const plan = planIn(w.be, "M_GF_85", "Payouts", false);
    const a = attached(w.be, "GF", plan, w.scratch, GF_85_PAGE); // the front door is fooled by the file
    const s = new Session();
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectRefusal(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }), RESOLVE);
  }, 60_000);

  test("(control) the same flow with the decision announced by the real decision front door → exit 0", async () => {
    const w = makeWorld();
    const d = realResolve(w.be, ["jira", "GF", "--join-key", "GF-85", "--sibling", siblingWithPlan(w)], w.scratch, GF_85_PAGE);
    const plan = planIn(w.be, "M_GF_85", "Payouts", false);
    const a = attached(w.be, "GF", plan, w.scratch, GF_85_PAGE);
    const s = new Session();
    s.bash(d.command, d.out);
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 60_000);

  test("(control) a plan committed at HEAD needs no decision → exit 0", async () => {
    const { w, a } = attachedWorld();
    const s = new Session();
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectPermit(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }));
  }, 60_000);
});

describe("AC-STE-611.7 / .3 hardening — the legs the audit found unpinned", () => {
  test("a decided JOIN of a different key does not prove the resolved container: the front door refuses", () => {
    const w = makeWorld();
    const listing = { issues: [epicRow("GF-99", "Other"), epicRow("GF-85", "Payouts")], isLast: true };
    const d = realResolve(w.be, ["jira", "GF", "--join-key", "GF-99", "--sibling", siblingWithPlan(w, "M_GF_99")], w.scratch, listing);
    expect(d.receipt).toBeTruthy();
    const plan = planIn(w.be, "M_GF_85", "Payouts", false);
    const a = realAttach(w.be, "GF", plan, w.scratch, listing);
    expect(a.exitCode, `${a.out}\n${a.err}`).toBe(1);
    expect(a.err).toMatch(/without a decision/i);
    expect(a.receipt).toBeNull();
  }, 60_000);

  test("an attach-target receipt resolved in ANOTHER repository does not satisfy a create in this one", async () => {
    const w = makeWorld();
    const plan = planIn(w.fe, "M_GF_85", "Payouts", true);
    const a = attached(w.fe, "GF", plan, w.scratch, GF_85_PAGE);
    const s = new Session();
    s.bash(a.command, a.out);
    s.announceDecide(w.be, createReceipt(w.be, { title: "BE payout export" }));
    expectRefusal(await runSh(JIRA("createJiraIssue"), jiraCreate(), { cwd: w.be, transcript: s.save(w.scratch) }), ATTACH);
  }, 60_000);
});
