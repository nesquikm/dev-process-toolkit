// shared_tracker_live_grader — STE-617.
//
// Grades one live shared-tracker run (`/shared-tracker-smoke`) from its
// evidence bundle: the run's metadata, its spawn ledger and the sessions the
// ledger names. The verdict is decided by this program, never by the driver
// that ran the children.
//
// The bundle is a PROJECTION of the harness records, never a copy
// (`extractBundle`): per ledgered session its scenario marker (from the first
// user message's marker line), its root, its client and every tool_use /
// tool_result pair (subagent sidechains included); per repository its
// receipts, commits, FR bindings and plan tokens. Assistant TEXT is never
// read — only tool_use blocks of assistant records are.
//
// AC-STE-617.3 — the spawn ceiling. A run may ledger at most
// `spawnCeiling(tracker)` sessions (the registry's live steps for that tracker
// plus the two audits, derived in shared_tracker_scenarios.ts and printed by
// Phase 0). A ledger holding more aborts the run as `spawn-overrun`; exactly
// at the ceiling is not an overrun.
//
// AC-STE-617.6 — each ledgered session maps to exactly one scenario from the
// marker line of its transcript's first user message: a registry scenario id,
// or one of the reserved markers `audit` and `intruder`. No marker, two
// markers or an unknown marker aborts naming the session; a registry scenario
// applicable to the tracker with no session is `not-observed`.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { milestoneLabel } from "./attach_project_milestone";
import { resolveInterviewAnswer } from "./auto_answers";
import { normalizeTitleForCompare } from "./create_idempotency_probe";
import { readTrackerItem, readTrackerPage } from "./tracker_answer";

import {
  linearWorstCase,
  SHARED_TRACKER_SCENARIO_IDS,
  SHARED_TRACKER_SCENARIOS,
  type SharedTrackerId,
  spawnCeiling,
} from "./shared_tracker_scenarios";
import { receiptsRoot, smokeRunLedgerPath } from "./dpt_paths";
import { legSessionIds, readRunLedger } from "./smoke_run_ledger";
import { simpleCommandWords } from "./shell_invocations";
import { indexTranscripts } from "./smoke_session_cleanup";
import type { SmokeOutcome } from "./smoke_verdict";

// ---------------------------------------------------------------------------
// types — the bundle shape (tests/_live_bundle_fixtures.ts documents it)
// ---------------------------------------------------------------------------

export type Root = "A" | "B";
export type Client = "tree" | "below-floor" | "old-client" | "intruder";

export interface TrackerItem {
  key: string;
  summary: string;
  labels: string[];
  status: string;
  parent: string | null;
  milestone: string | null;
  issueType: string | null;
  kind: "issue" | "milestone" | "project";
  container: string;
  /** The required answer fields the tracker's answer lacked (`REQUIRED_ANSWER_FIELDS`); absent when it lacked none. */
  absent?: string[];
}

export interface ToolResult {
  isError: boolean;
  text: string;
  exitCode: number | null;
  items: TrackerItem[] | null;
  lastPage: boolean | null;
}

export interface ToolCall {
  ref: string;
  at: string;
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
  sidechain: boolean;
}

export interface BundleSession {
  sessionId: string;
  marker: string;
  root: Root;
  /** The session's working directory, rewritten relative to the run's roots (`<B>`, `<B>/.s11/relocated`). */
  cwd: string;
  client: Client;
  calls: ToolCall[];
  /**
   * The sanctioned answers block of the session's FIRST user message
   * (auto_answers.ts, read with the key the tracker-write hook reads), kept
   * only for the keys the grader reads (`GRADED_ANSWER_KEYS`); absent when
   * the block answers none of them.
   */
  answers?: Record<string, string>;
  /** The timestamp of the first user message that carried `answers`. */
  answersAt?: string;
}

export interface BundleReceipt {
  path: string;
  sessionId: string;
  sha256: string;
  kind: string;
  adapter: SharedTrackerId | null;
  container: string | null;
  subject: string;
  decision: string;
  evidence: Record<string, unknown>;
}

export type ReceiptSet = { readable: true; records: BundleReceipt[] } | { readable: false; error: string };

export interface RepoState {
  receipts: ReceiptSet;
  commits: Array<{ subject: string; at: string }>;
  frBindings: Array<{ path: string; title: string; key: string; milestone: string | null }>;
  plans: Array<{ path: string; milestone: string }>;
}

export interface RunMeta {
  runId: string;
  nonce: string;
  tracker: SharedTrackerId;
  pluginVersion: string;
  startedAt: string;
  behaviourDigest: { digest: string; files: Record<string, string> };
  belowFloorDigest: string;
  container: string;
  repointFrom: string | null;
  linearTeam: string | null;
  skips: Array<{ id: string; reason: string }>;
  auditQuery: string;
}

export interface LiveBundle {
  schema: 1;
  synthetic: boolean;
  run: RunMeta;
  roots: { A: { name: string; tag: string }; B: { name: string; tag: string } };
  ledger: string[];
  sessions: BundleSession[];
  repos: { A: RepoState; B: RepoState };
  unledgeredSessions: string[];
}

export interface LiveFinding {
  code: string;
  scenario?: string;
  session?: string;
  item?: string;
  tool?: string;
  detail?: string;
}

export interface LiveScenarioOutcome {
  outcome: "pass" | "fail" | "not-observed" | "offline-only" | "skipped";
  reason?: string;
  refs: string[];
}

export interface LiveVerdict {
  outcome: SmokeOutcome;
  findings: LiveFinding[];
  scenarios: Record<string, LiveScenarioOutcome>;
  runId: string;
  nonce: string;
  tracker: SharedTrackerId;
  pluginVersion: string;
  behaviourDigest: { digest: string; files: Record<string, string> };
  graderDigest: string;
  linearBudget: { declared: number; spent: number; created: string[] } | null;
  /**
   * The repoint inputs whose completeness the SESSION asserted rather than the
   * tracker proved (Jira statuses and labels: no MCP tool lists them), read
   * from the repoint receipt B's declaration announced. `[]` when every input
   * was proven; null when the run made no repoint (S8 the named skip).
   */
  assertedCompleteness: string[] | null;
}

export interface GradeOptions {
  behaviourDigestNow: string;
  hooksJsonPath?: string;
  inventoryPath?: string;
}

export interface ExtractOptions {
  configDirs: string[];
  /** The toolkit checkout the run was driven from; a path under it is rewritten `<toolkit>`. */
  toolkitRoot?: string;
  ledgerSessionIds: string[];
  roots: { A: { path: string; tag: string }; B: { path: string; tag: string } };
  run: RunMeta;
  synthetic?: boolean;
}

export type ExtractResult = { ok: true; bundle: LiveBundle } | { ok: false; verdict: { outcome: "abort"; findings: LiveFinding[] } };

// ---------------------------------------------------------------------------
// markers (AC.6)
// ---------------------------------------------------------------------------

export const RESERVED_MARKERS = ["audit", "intruder"] as const;
const MARKER_PREFIX = "dpt-shared-tracker-scenario:";
const MARKER_LINE = /^dpt-shared-tracker-scenario:\s*(\S+)(?:\s+client=(\S+))?\s*$/;
const CLIENTS: readonly Client[] = ["tree", "below-floor", "old-client", "intruder"];

type MarkerParse = { ok: true; marker: string; client: Client } | { ok: false; detail: string };

/** The one scenario a session's first user message names. */
export function parseMarker(firstUserText: string): MarkerParse {
  const lines = firstUserText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(MARKER_PREFIX));
  if (lines.length === 0) return { ok: false, detail: "its first user message carries no scenario marker line" };
  if (lines.length > 1) return { ok: false, detail: `its first user message carries ${lines.length} scenario marker lines` };
  const m = MARKER_LINE.exec(lines[0]!);
  if (!m) return { ok: false, detail: `malformed scenario marker line: ${lines[0]}` };
  const marker = m[1]!;
  if (!SHARED_TRACKER_SCENARIO_IDS.includes(marker) && !(RESERVED_MARKERS as readonly string[]).includes(marker)) {
    return { ok: false, detail: `unknown scenario marker ${marker}` };
  }
  const client = (m[2] ?? "tree") as Client;
  if (!CLIENTS.includes(client)) return { ok: false, detail: `unknown client ${m[2]}` };
  return { ok: true, marker, client };
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

interface RawRecord {
  type?: string;
  isMeta?: boolean;
  cwd?: string;
  timestamp?: string;
  message?: { content?: unknown };
}

/**
 * A transcript's records, or null when the file cannot be read. `torn` counts
 * the non-blank lines that are not JSON: a torn line may have held a tool_use
 * or a tool_result, so the caller aborts on one rather than grading the rest
 * as if the record had never been written.
 */
function readJsonl(path: string): { records: RawRecord[]; torn: number } | null {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  const records: RawRecord[] = [];
  let torn = 0;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      records.push(JSON.parse(l) as RawRecord);
    } catch {
      torn += 1;
    }
  }
  return { records, torn };
}

/** The text of a message content or tool_result content (a string, or its text blocks joined). */
function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "text")
    .map((b) => String((b as { text?: unknown }).text ?? ""))
    .join("\n");
}

/** The text of a USER record's content. Never called on an assistant record. */
const userMessageText = (r: RawRecord): string => blocksText(r.message?.content);

/** The working directory the first record carrying one names ("" when none does). */
const cwdOf = (recs: RawRecord[]): string => recs.find((r) => typeof r.cwd === "string")?.cwd ?? "";

type Rewriter = (s: string) => string;

function rewriteDeep(v: unknown, rw: Rewriter): unknown {
  if (typeof v === "string") return rw(v);
  if (Array.isArray(v)) return v.map((x) => rewriteDeep(x, rw));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteDeep(x, rw)]));
  return v;
}

/** The server segment of an MCP tool name (`mcp__<server>__<tool>` → `<server>`). */
const serverOf = (name: string): string => name.split("__")[1] ?? "";
/** The bare tool name of an MCP tracker call (`mcp__<server>__<tool>` → `<tool>`). */
const bareTool = (name: string): string => name.split("__").at(-1) ?? name;

/** An MCP call on an Atlassian or Linear server, under any server spelling. */
function isTrackerTool(name: string): boolean {
  if (!name.startsWith("mcp__")) return false;
  return /atlassian|linear/i.test(serverOf(name));
}

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const labelsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((l) => (typeof l === "string" ? l : str((l as { name?: unknown })?.name))) : [];
/** A Linear field given as a bare string or a `{ name }` object (a status, a project). */
const stringOrName = (v: unknown): string => (typeof v === "string" ? v : str((v as { name?: unknown } | null)?.name));

/** Linear's audit milestone reads: the listing and the per-key read, by bare tool name. */
export interface AuditMilestoneReads {
  list: string;
  get: string;
}

/**
 * What the audit child asks the tracker for (the smoke skill's audit fence
 * passes exactly this; a test there pins its prompt to this export).
 * `issue` — Jira's `fields` of the nonce search and each read-back, Linear's
 * `fields` of `list_issues`. `milestone` — the reads that bring the milestone
 * containers S3 grades into the audit: on Linear the shared project's
 * `list_milestones` and a `get_milestone` per created milestone (neither takes
 * a field list, so their answer is `AUDIT_ALWAYS_RETURNED`'s milestone
 * fields); null on Jira, whose milestone is an Epic the issue search and
 * read-backs already return. A test in the grader's suite derives, from the
 * item projection and the predicates, every answer field a predicate reads on
 * an audit item of each kind and fails naming any this contract omits.
 */
export const AUDIT_REQUEST_FIELDS: Readonly<Record<SharedTrackerId, { issue: readonly string[]; milestone: AuditMilestoneReads | null }>> = {
  jira: { issue: ["summary", "labels", "status", "parent", "issuetype", "project"], milestone: null },
  linear: { issue: ["id", "title", "labels", "status", "project", "projectMilestone"], milestone: { list: "list_milestones", get: "get_milestone" } },
};

/**
 * The answer fields every item carries without being asked: Jira's issue
 * `key` (outside `fields`), Linear's `id` (the list_issues tool documents
 * "`id` is always included"; with `fields` given it is the issue identifier,
 * `STE-618`, and no `identifier` field is returned — measured 2026-09-21);
 * and every field of a Linear milestone answer, which takes no field list
 * (measured: tests/fixtures/live-shapes/linear/{list,get}_milestone*.json).
 */
export const AUDIT_ALWAYS_RETURNED: Readonly<Record<SharedTrackerId, { issue: readonly string[]; milestone: readonly string[] | null }>> = {
  jira: { issue: ["key"], milestone: null },
  linear: { issue: ["id"], milestone: ["id", "name", "description", "progress", "sortOrder"] },
};

/**
 * The answer fields an item of each kind must carry for the predicates to
 * grade it: an item read without one is recorded in its `absent` list, and an
 * audit item with an absent field aborts the run as `audit-incomplete`
 * (`auditFieldsAbsent`) — never skipped, never read as empty. Jira fields are
 * named as inside `fields` (`key` is top-level).
 */
const REQUIRED_ANSWER_FIELDS: Readonly<Record<SharedTrackerId, Readonly<Record<TrackerItem["kind"], readonly string[]>>>> = {
  jira: { issue: ["key", "summary", "labels", "status", "issuetype", "project"], milestone: [], project: [] },
  linear: { issue: ["id", "title", "labels", "status", "project"], milestone: ["id", "name"], project: ["name", "status"] },
};

/** The tools whose answers are tracker items, by kind. Any other tool's answer projects to no item. */
const ISSUE_TOOL = /__(createJiraIssue|editJiraIssue|getJiraIssue|searchJiraIssuesUsingJql|transitionJiraIssue|save_issue|get_issue|list_issues)$/;
const MILESTONE_TOOL = /__(list_milestones|save_milestone|get_milestone)$/;
const PROJECT_TOOL = /__(get_project|save_project|list_projects)$/;

/** The kind of item a tracker tool's answer holds, or null when it holds none (a team, a user, a site, a transition list). */
function itemKindOf(tracker: SharedTrackerId, tool: string): TrackerItem["kind"] | null {
  if (ISSUE_TOOL.test(tool)) return "issue";
  if (tracker === "linear" && MILESTONE_TOOL.test(tool)) return "milestone";
  if (tracker === "linear" && PROJECT_TOOL.test(tool)) return "project";
  return null;
}

/** A field an answer carries: present and neither null nor undefined; labels must be a list. */
const carries = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== undefined && (k !== "labels" || Array.isArray(o[k]));

/**
 * One tracker item projected to the fields the grader reads (no hosts, emails
 * or account ids). It takes an item tracker_answer.ts already read out of its
 * answer (`readTrackerPage` / `readTrackerItem`: a Jira wrapped node, a plain
 * issue, a Linear row), never a whole answer. `absent` names each required
 * answer field (`REQUIRED_ANSWER_FIELDS`) the object lacked; it is present
 * only when one is.
 */
export function projectItem(tracker: SharedTrackerId, tool: string, o: Record<string, unknown>): TrackerItem {
  const kind = itemKindOf(tracker, tool) ?? "issue";
  let item: TrackerItem;
  let absent: string[];
  if (tracker === "jira") {
    const f = (o.fields && typeof o.fields === "object" ? o.fields : {}) as Record<string, unknown>;
    const nameOf = (x: unknown) => strOrNull((x as { name?: unknown } | null)?.name);
    item = {
      key: str(o.key),
      summary: str(f.summary),
      labels: labelsOf(f.labels),
      status: nameOf(f.status) ?? "",
      parent: strOrNull((f.parent as { key?: unknown } | null)?.key),
      milestone: null,
      issueType: nameOf(f.issuetype),
      kind: "issue",
      container: str((f.project as { key?: unknown } | null)?.key),
    };
    absent = REQUIRED_ANSWER_FIELDS.jira[kind].filter((k) => (k === "key" ? !carries(o, k) || str(o.key) === "" : !carries(f, k)));
  } else if (kind === "milestone") {
    // A milestone answer is `{ id, name, description, progress, sortOrder }`
    // (measured): it names no status and no project, so neither is read.
    item = { key: str(o.id), summary: str(o.name), labels: [], status: "", parent: null, milestone: null, issueType: null, kind: "milestone", container: "" };
    absent = REQUIRED_ANSWER_FIELDS.linear.milestone.filter((k) => !carries(o, k));
  } else if (kind === "project") {
    // A project's status is `{ id, name, type }` (measured): its `type` is the
    // workflow category (`completed`), whatever the team named the state.
    const st = o.status as { type?: unknown } | null | undefined;
    const status = st && typeof st === "object" && typeof st.type === "string" ? st.type : stringOrName(o.status ?? o.state);
    item = { key: str(o.name), summary: str(o.name), labels: [], status, parent: null, milestone: null, issueType: null, kind: "project", container: str(o.name) };
    absent = REQUIRED_ANSWER_FIELDS.linear.project.filter((k) => !carries(o, k));
  } else {
    item = {
      key: str(o.id),
      summary: str(o.title),
      labels: labelsOf(o.labels),
      status: stringOrName(o.status),
      parent: null,
      milestone: strOrNull((o.projectMilestone as { id?: unknown } | null)?.id),
      issueType: null,
      kind: "issue",
      container: stringOrName(o.project),
    };
    absent = REQUIRED_ANSWER_FIELDS.linear.issue.filter((k) => !carries(o, k));
  }
  return absent.length > 0 ? { ...item, absent } : item;
}

/**
 * The key a listing tool's rows sit under, or undefined for a tool that
 * answers one item: Jira's search answers `issues`; a Linear `list_<things>`
 * answers `<things>` (list_issues → issues, list_milestones → milestones).
 */
function listRowsKey(tool: string): string | undefined {
  const bare = bareTool(tool);
  if (bare === "searchJiraIssuesUsingJql") return "issues";
  return bare.startsWith("list_") ? bare.slice("list_".length) : undefined;
}

/**
 * One tracker answer projected: its items and last-page flag, or why it is
 * unreadable. A listing is read by `readTrackerPage`, any other item answer by
 * `readTrackerItem` (tracker_answer.ts, the one reader of the measured shapes),
 * and each item they return is projected by `projectItem`. `lastPage` is true
 * only for a page the reader PROVES last, false for one naming a next page, and
 * null when it cannot say: a full `LINEAR_MILESTONE_WINDOW` of Linear
 * milestones, the same rule resolve_milestone_identity.ts gates on. An answer
 * in no observed shape is `unreadable`, never guessed at as a page or an item.
 */
type Projection = { ok: true; items: TrackerItem[]; lastPage: boolean | null } | { ok: false; reason: string };

/**
 * A tracker answer's projection, or null when the answer is not JSON. A tool
 * whose answer holds no tracker item (`itemKindOf`) projects to no item, so a
 * team, a user or a site read is never graded as an unkeyed issue.
 */
function projectAnswer(tracker: SharedTrackerId, tool: string, text: string): Projection | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (itemKindOf(tracker, tool) === null) return { ok: true, items: [], lastPage: null };
  const rowsKey = listRowsKey(tool);
  if (rowsKey !== undefined) {
    const r = readTrackerPage(tracker, v, rowsKey);
    if (!r.ok) return r;
    const lastPage = r.page.last ? true : r.page.next !== null ? false : null;
    return { ok: true, items: r.page.items.map((x) => projectItem(tracker, tool, x)), lastPage };
  }
  const r = readTrackerItem(tracker, v);
  return r.ok ? { ok: true, items: [projectItem(tracker, tool, r.item)], lastPage: null } : r;
}

/**
 * The answers-block key the tracker-write hook reads an orphan import's (and
 * adopt's) consent from (`resolveInterviewAnswer(text, "tracker_orphan_import")`
 * in pre-tracker-write-gate.ts). The only key the grader keeps.
 */
export const ORPHAN_CONSENT_ANSWER_KEY = "tracker_orphan_import";
const GRADED_ANSWER_KEYS: readonly string[] = [ORPHAN_CONSENT_ANSWER_KEY];

const POINTER = /^<persisted-output>[\s\S]*?Full output saved to: ([^\n]+)\n/;
const EXIT_PREFIX = /^Exit code (\d+)\n?/;

interface RawUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
  at: string;
  sidechain: boolean;
  order: number;
}

type SessionParse = { ok: true; session: BundleSession } | { ok: false; finding: LiveFinding };

function parseSession(
  sid: string,
  main: RawRecord[],
  sides: RawRecord[][],
  tracker: SharedTrackerId,
  rootOf: (cwd: string) => Root | null,
  rw: Rewriter,
): SessionParse {
  const abort = (code: string, detail: string): SessionParse => ({ ok: false, finding: { code, session: sid, detail } });
  const first = main.find((r) => r.type === "user" && r.isMeta !== true);
  if (!first) return abort("no-marker", `session ${sid}: its transcript holds no user message`);
  const firstText = userMessageText(first);
  const mk = parseMarker(firstText);
  if (!mk.ok) return abort("scenario-marker", `session ${sid}: ${mk.detail}`);
  // The operator's answers are read from the first user message only, through
  // auto_answers.ts (the parser the hook uses): a block in a later message or a
  // tool_result answers nothing here.
  const answers: Record<string, string> = {};
  for (const k of GRADED_ANSWER_KEYS) {
    const v = resolveInterviewAnswer(firstText, k);
    if (typeof v === "string") answers[k] = rw(v);
  }
  const cwd = cwdOf(main);
  const root = rootOf(cwd);
  if (root === null) return abort("session-outside-roots", `session ${sid}: its cwd is neither throwaway repository`);

  const uses: RawUse[] = [];
  const results = new Map<string, { content: unknown; isError: boolean }>();
  let order = 0;
  const scan = (recs: RawRecord[], sidechain: boolean) => {
    for (const r of recs) {
      const c = r.message?.content;
      if (!Array.isArray(c)) continue;
      for (const blk of c) {
        if (!blk || typeof blk !== "object") continue;
        const b = blk as Record<string, unknown>;
        // Only tool_use blocks of assistant records are read — never their text.
        if (r.type === "assistant" && b.type === "tool_use") {
          uses.push({ id: str(b.id), name: str(b.name), input: (b.input ?? {}) as Record<string, unknown>, at: str(r.timestamp), sidechain, order: order++ });
        } else if (r.type === "user" && b.type === "tool_result") {
          results.set(str(b.tool_use_id), { content: b.content, isError: b.is_error === true });
        }
      }
    }
  };
  scan(main, false);
  for (const s of sides) scan(s, true);
  uses.sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.order - y.order);

  const calls: ToolCall[] = [];
  for (const u of uses) {
    const res = results.get(u.id);
    // A tool_use with no tool_result is a record the harness never finished:
    // what the call did is unknown, so it is never graded as an error or a success.
    if (!res) return abort("tool-result-missing", `session ${sid}: tool_use ${u.id} (${u.name}) has no tool_result`);
    let text = blocksText(res.content);
    const ptr = POINTER.exec(text);
    if (ptr) {
      try {
        text = readFileSync(ptr[1]!.trim(), "utf-8");
      } catch {
        return abort("tool-result-missing", `session ${sid}: the persisted tool_result of ${u.id} points at a file that cannot be read`);
      }
    }
    const isError = res.isError;
    let result: ToolResult;
    if (u.name === "Bash") {
      const ex = EXIT_PREFIX.exec(text);
      const exitCode = ex ? Number(ex[1]) : isError ? null : 0;
      result = { isError, text: rw(ex ? text.slice(ex[0].length) : text), exitCode, items: null, lastPage: null };
    } else if (!isError && isTrackerTool(u.name)) {
      // An answer in no observed shape keeps no item, so every predicate that
      // needs one fails closed; its text names why, never the raw answer.
      const a = projectAnswer(tracker, u.name, text);
      result =
        a === null
          ? { isError, text: rw(text), exitCode: null, items: null, lastPage: null }
          : a.ok
            ? { isError, text: "", exitCode: null, items: a.items, lastPage: a.lastPage }
            : { isError, text: `unreadable tracker answer: ${a.reason}`, exitCode: null, items: null, lastPage: null };
    } else {
      result = { isError, text: rw(text), exitCode: null, items: null, lastPage: null };
    }
    calls.push({ ref: `${sid}:${u.id}`, at: u.at, name: u.name, input: rewriteDeep(u.input, rw) as Record<string, unknown>, result, sidechain: u.sidechain });
  }
  const session: BundleSession = { sessionId: sid, marker: mk.marker, root, cwd: rw(cwd), client: mk.client, calls };
  if (Object.keys(answers).length > 0) {
    session.answers = answers;
    session.answersAt = str(first.timestamp);
  }
  return { ok: true, session };
}

function git(root: string, args: string[]): string | null {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  const r = Bun.spawnSync(["git", "-C", root, ...args], { env });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

function frontmatter(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1]! : "";
}

const field = (fm: string, name: string): string | null => {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(fm);
  const v = m?.[1]?.trim() ?? "";
  return v === "" ? null : v;
};

function readReceipts(rootPath: string, tag: Root, rw: Rewriter): ReceiptSet {
  const dir = receiptsRoot(rootPath);
  let sessions: string[];
  try {
    sessions = readdirSync(dir);
  } catch (e) {
    // An ABSENT directory is not an empty one: it is recorded as unreadable,
    // and the grade decides (gatedWrites) whether the repository's sessions
    // made writes it should have receipted.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { readable: false, error: `the receipts directory <${tag}>/.dpt/ledger/receipts is absent` };
    return { readable: false, error: (e as Error).message };
  }
  const records: Array<BundleReceipt & { at: string }> = [];
  try {
    for (const s of sessions) {
      let names: string[];
      try {
        names = readdirSync(join(dir, s));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOTDIR") continue;
        throw e;
      }
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        const bytes = readFileSync(join(dir, s, n));
        const j = JSON.parse(bytes.toString("utf-8")) as Record<string, unknown>;
        records.push({
          path: rw(join(dir, s, n)),
          sessionId: str(j.sessionId),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          kind: str(j.kind),
          adapter: (j.adapter ?? null) as SharedTrackerId | null,
          container: (j.container ?? null) as string | null,
          subject: rw(str(j.subject)),
          decision: str(j.decision),
          evidence: rewriteDeep(j.evidence ?? {}, rw) as Record<string, unknown>,
          at: str(j.createdAt),
        });
      }
    }
  } catch (e) {
    return { readable: false, error: (e as Error).message };
  }
  records.sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.path.localeCompare(y.path, "en", { numeric: true }));
  return { readable: true, records: records.map(({ at: _at, ...r }) => r) };
}

function readRepo(rootPath: string, tag: Root, tracker: SharedTrackerId, rw: Rewriter): RepoState {
  const commits: RepoState["commits"] = [];
  for (const l of (git(rootPath, ["log", "--reverse", "--format=%s%x1f%cI"]) ?? "").split("\n")) {
    if (!l) continue;
    const [subject, at] = l.split("\x1f");
    commits.push({ subject: rw(subject ?? ""), at: new Date(at ?? "").toISOString() });
  }
  const frBindings: RepoState["frBindings"] = [];
  const plans: RepoState["plans"] = [];
  const tracked = (git(rootPath, ["ls-files", "-z", "--", "specs/frs", "specs/plan"]) ?? "").split("\0").filter(Boolean);
  for (const p of tracked.sort()) {
    const isFr = /^specs\/frs\/[^/]+\.md$/.test(p);
    const isPlan = /^specs\/plan\/[^/]+\.md$/.test(p);
    if (!isFr && !isPlan) continue;
    let text: string;
    try {
      text = readFileSync(join(rootPath, p), "utf-8");
    } catch {
      continue;
    }
    const fm = frontmatter(text);
    if (isPlan) {
      const ms = field(fm, "milestone");
      if (ms) plans.push({ path: p, milestone: ms });
      continue;
    }
    const block = /^tracker:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m.exec(fm)?.[1] ?? "";
    const key = new RegExp(`^[ \\t]+${tracker}:[ \\t]*(\\S+)`, "m").exec(block)?.[1];
    if (!key) continue;
    frBindings.push({ path: p, title: rw(field(fm, "title") ?? ""), key, milestone: field(fm, "milestone") });
  }
  return { receipts: readReceipts(rootPath, tag, rw), commits, frBindings, plans };
}

/**
 * Project a run's records into its evidence bundle: the ledgered sessions'
 * transcripts (through smoke_session_cleanup's transcript index, sidechains
 * included), both repositories' receipts and git state. Any session whose
 * transcript or sidechain cannot be read, holds a torn (non-JSON) line, holds
 * a tool_use with no tool_result, or cannot be mapped to exactly one scenario
 * aborts, naming it (and, for a file, the file relative to its project
 * directory). A receipts directory that is absent is recorded as unreadable,
 * never as empty. Absolute paths are rewritten to `<A>`, `<B>`, `<toolkit>`
 * (the checkout the run was driven from) and `<config>` (each config dir).
 */
export function extractBundle(o: ExtractOptions): ExtractResult {
  const tracker = o.run.tracker;
  const A = o.roots.A.path;
  const B = o.roots.B.path;
  // A ROOT may be handed over spelled through a symlink (macOS /tmp is
  // /private/tmp): both spellings of each root are rewritten and matched. A
  // session's own cwd is never resolved — resolving it would let a planted
  // symlink pull an outside session into a root — so a cwd spelled through a
  // symlink the grader was not given fails closed as outside the roots.
  // Resolve the longest existing ancestor and keep the rest, so a cwd that no
  // longer exists (a removed worktree) still resolves through its parent.
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      const parent = dirname(p);
      return parent === p ? p : join(real(parent), basename(p));
    }
  };
  // The toolkit checkout (`<toolkit>`) and each config dir (`<config>`) are
  // rewritten the same way, both spellings each: a recorded path to the tree
  // the run was driven from, or to a transcript, is not personal data and must
  // not make the privacy refusal throw the whole bundle away. Any other path
  // under a home directory is still refused. Longest first, so a root nested
  // in another known path gets its own token.
  const known: Array<[string, string]> = [["<A>", A], ["<B>", B]];
  if (o.toolkitRoot) known.push(["<toolkit>", o.toolkitRoot]);
  for (const c of o.configDirs) known.push(["<config>", c]);
  const pairs = known
    .flatMap(([tok, p]) => [[tok, p.replace(/\/+$/, "")] as const, [tok, real(p).replace(/\/+$/, "")] as const])
    .filter(([, p]) => p !== "")
    .sort((x, y) => y[1].length - x[1].length);
  // Anchored at a path boundary, so a sibling path that only shares a root's
  // prefix (`<root>-scratch/…`) is never rewritten into the root token.
  const boundary = pairs.map(([tok, p]) => [tok, new RegExp(`${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|$|[^\\w.-])`, "g")] as const);
  const rw: Rewriter = (s) => {
    let t = s;
    for (const [tok, re] of boundary) t = t.replace(re, tok);
    return t;
  };
  const within = (cwd: string, root: string) => cwd === root || cwd.startsWith(`${root}/`);
  const rootOf = (cwd: string): Root | null =>
    within(cwd, A) || within(cwd, real(A)) ? "A" : within(cwd, B) || within(cwd, real(B)) ? "B" : null;

  const idx = indexTranscripts(o.configDirs);
  const mains = new Map<string, string>();
  const sides = new Map<string, string[]>();
  for (const f of idx.files) {
    if (f.sidechain) sides.set(f.sid, [...(sides.get(f.sid) ?? []), f.path]);
    else if (!mains.has(f.sid)) mains.set(f.sid, f.path);
  }

  const findings: LiveFinding[] = [];
  const sessions: BundleSession[] = [];
  /** A transcript file named relative to its project directory (`<sid>.jsonl`, `<sid>/subagents/<agent>.jsonl`): no absolute path. */
  const fileName = (sid: string, p: string, sidechain: boolean) => (sidechain ? `${sid}/subagents/${basename(p)}` : basename(p));
  for (const sid of o.ledgerSessionIds) {
    const path = mains.get(sid);
    const main = path ? readJsonl(path) : null;
    if (!main) {
      findings.push({ code: "transcript-missing", session: sid, detail: `ledgered session ${sid} has no readable transcript` });
      continue;
    }
    if (main.torn > 0) {
      findings.push({ code: "transcript-torn", session: sid, detail: `session ${sid}: ${fileName(sid, path!, false)} holds ${main.torn} line(s) that are not JSON` });
      continue;
    }
    // A sidechain that cannot be read, or holds a torn line, aborts naming it:
    // its tool calls are part of the session and cannot be graded as absent.
    const sideRecs: RawRecord[][] = [];
    let sideBroken = false;
    for (const sp of sides.get(sid) ?? []) {
      const side = readJsonl(sp);
      if (side === null || side.torn > 0) {
        const why = side === null ? "cannot be read" : `holds ${side.torn} line(s) that are not JSON`;
        findings.push({ code: side === null ? "transcript-unreadable" : "transcript-torn", session: sid, detail: `session ${sid}: the sidechain ${fileName(sid, sp, true)} ${why}` });
        sideBroken = true;
        continue;
      }
      sideRecs.push(side.records);
    }
    if (sideBroken) continue;
    const p = parseSession(sid, main.records, sideRecs, tracker, rootOf, rw);
    if (!p.ok) findings.push(p.finding);
    else sessions.push(p.session);
  }
  if (findings.length > 0) return { ok: false, verdict: { outcome: "abort", findings } };

  // AC.15 — a transcript filed under a throwaway root's slug whose cwd is that root, but which the ledger lacks.
  const ledgered = new Set(o.ledgerSessionIds);
  const slugs = [A, real(A), B, real(B)].map((p) => p.replace(/[^A-Za-z0-9]/g, "-"));
  const unledgeredSessions: string[] = [];
  for (const [sid, path] of mains) {
    if (ledgered.has(sid)) continue;
    const slug = basename(dirname(path));
    if (!slugs.some((s) => slug.startsWith(s))) continue;
    if (rootOf(cwdOf(readJsonl(path)?.records ?? [])) !== null) unledgeredSessions.push(sid);
  }
  unledgeredSessions.sort();

  return {
    ok: true,
    bundle: {
      schema: 1,
      synthetic: o.synthetic === true,
      run: o.run,
      roots: { A: { name: basename(A), tag: o.roots.A.tag }, B: { name: basename(B), tag: o.roots.B.tag } },
      ledger: [...o.ledgerSessionIds],
      sessions,
      repos: { A: readRepo(A, "A", tracker, rw), B: readRepo(B, "B", tracker, rw) },
      unledgeredSessions,
    },
  };
}

// ---------------------------------------------------------------------------
// grading
// ---------------------------------------------------------------------------

/** AC-STE-617.3 — a ledger over the registry-derived ceiling. */
function spawnOverrun(b: LiveBundle): LiveFinding[] {
  const ceiling = spawnCeiling(b.run.tracker);
  if (b.ledger.length <= ceiling) return [];
  return [{ code: "spawn-overrun", detail: `the run ledger holds ${b.ledger.length} sessions; the ceiling for ${b.run.tracker} is ${ceiling}` }];
}

const REPOINT_SKIP_REASON = "repoint-space-not-given";

/**
 * AC-STE-617.18 — S8 is a named skip only on a Jira run given no repoint space
 * that records the skip. A run given the flag, a Linear run, or a bundle with no
 * skip record never skips S8.
 */
function isHonouredRepointSkip(b: LiveBundle, id: string): boolean {
  return (
    id === "S8" &&
    b.run.tracker === "jira" &&
    b.run.repointFrom === null &&
    (b.run.skips ?? []).some((k) => k.id === "S8" && k.reason === REPOINT_SKIP_REASON)
  );
}

/** AC-STE-617.6 — every registry scenario applicable to the tracker gets an outcome; one with no session is not-observed. */
function gradeScenarios(b: LiveBundle): Record<string, LiveScenarioOutcome> {
  const out: Record<string, LiveScenarioOutcome> = {};
  for (const s of SHARED_TRACKER_SCENARIOS) {
    if (!s.trackers.includes(b.run.tracker)) continue;
    if (!s.live) {
      out[s.id] = { outcome: "offline-only", reason: s.offlineReason, refs: [] };
      continue;
    }
    const own = b.sessions.filter((x) => x.marker === s.id);
    if (own.length === 0 && isHonouredRepointSkip(b, s.id)) {
      out[s.id] = { outcome: "skipped", reason: REPOINT_SKIP_REASON, refs: [] };
      continue;
    }
    if (own.length === 0) {
      out[s.id] = { outcome: "not-observed", reason: "no ledgered session carries this scenario's marker", refs: [] };
      continue;
    }
    const silent = own.find((x) => x.calls.length === 0);
    if (silent) {
      out[s.id] = { outcome: "not-observed", reason: `session ${silent.sessionId} recorded no tool call`, refs: [] };
      continue;
    }
    const refs = own.flatMap((x) => x.calls.map((c) => c.ref));
    const pred = LIVE_PREDICATES[s.id];
    let r: PredicateResult;
    try {
      r = pred ? pred(b, own) : { outcome: "fail", reason: `the grader holds no predicate for live scenario ${s.id}` };
    } catch (e) {
      // A predicate that needs a repository's receipts cannot grade without
      // them: the scenario is not-observed (a failure), never decided from an
      // empty list as if nothing had been written.
      if (!(e instanceof ReceiptsUnreadable)) throw e;
      r = notObserved(`repository <${e.root}>'s receipts cannot be read (${e.why}), so this scenario's receipts cannot be graded`);
    }
    out[s.id] = r.reason === undefined ? { outcome: r.outcome, refs } : { outcome: r.outcome, reason: r.reason, refs };
  }
  return out;
}

/** The titles a scenario's sessions created on the tracker, read from the create calls' inputs. */
function createdTitles(own: BundleSession[]): Set<string> {
  const titles = new Set<string>();
  for (const s of own) {
    for (const c of s.calls) {
      if (!isTrackerTool(c.name) || c.result.isError || !/create|save_issue/i.test(c.name) || c.input.id) continue;
      const t = createTitle(c);
      if (t) titles.add(t);
    }
  }
  return titles;
}

/**
 * AC-STE-617.10 (S1, S2), records only — the two repositories' FR files
 * carrying a title the scenario created bind different ticket keys.
 */
function sameTitleBindsDifferentKeys(b: LiveBundle, own: BundleSession[]): string | null {
  for (const t of createdTitles(own)) {
    const aKeys = new Set(b.repos.A.frBindings.filter((f) => f.title === t).map((f) => f.key));
    const shared = b.repos.B.frBindings.filter((f) => f.title === t && aKeys.has(f.key));
    if (shared.length > 0) return `both repositories' FR files titled "${t}" bind ${shared[0]!.key}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// live predicates (AC.9 – AC.12) — one per live registry id, records only
// ---------------------------------------------------------------------------

type PredicateResult = { outcome: "pass" | "fail" | "not-observed"; reason?: string };
type Predicate = (b: LiveBundle, own: BundleSession[]) => PredicateResult;

const PASS: PredicateResult = { outcome: "pass" };
const fail = (reason: string): PredicateResult => ({ outcome: "fail", reason });
const notObserved = (reason: string): PredicateResult => ({ outcome: "not-observed", reason });

/**
 * The tracker-write tools the tracker-write hook gates — a copy of the hook's
 * `TRACKER_WRITE_TOOLS` (the list its hooks.json matcher is generated from).
 * The grader keeps its own copy rather than importing hook code; a drift test
 * in the grader's suite imports the hook's list and keeps the two equal.
 */
export const TRACKER_WRITE_TOOL_NAMES: readonly string[] = [
  "createJiraIssue", "editJiraIssue", "transitionJiraIssue", "addCommentToJiraIssue", "addWorklogToJiraIssue", "createIssueLink",
  "save_issue", "save_milestone", "save_comment", "delete_comment", "create_attachment", "create_attachment_from_upload",
  "delete_attachment", "share_issue", "unshare_issue", "save_project", "create_issue_label", "save_issue_label",
  "retire_issue_label", "restore_issue_label", "save_project_label", "retire_project_label", "restore_project_label",
  "save_status_update", "delete_status_update", "save_document",
];
const TRACKER_WRITE_TOOL = new RegExp(`^(${TRACKER_WRITE_TOOL_NAMES.join("|")})$`);
/** The B repository's second server name (`claude_ai_Atlassian` / `claude_ai_Linear`). */
const SECOND_SERVER = /^claude_ai_/;

const isTrackerWrite = (c: ToolCall): boolean => isTrackerTool(c.name) && TRACKER_WRITE_TOOL.test(bareTool(c.name));
const cmdOf = (c: ToolCall): string => (c.name === "Bash" ? String(c.input.command ?? "") : "");

/** What `${CLAUDE_PLUGIN_ROOT}` is read as when a recorded command is parsed: a placeholder word, never a real path. */
const PLUGIN_ROOT_WORD = "/dpt-plugin-root";
const MODULE_DIR = `${PLUGIN_ROOT_WORD}/adapters/_shared/src/`;
/** The bundle's root tokens, spelled back as placeholder absolute paths so the shell grammar reads them as plain words. */
const ROOT_WORDS: ReadonlyArray<readonly [string, string]> = [["<A>", "/dpt-root-a"], ["<B>", "/dpt-root-b"]];

/** One toolkit module run: the module file name and the words after it. */
interface ModuleRun {
  module: string;
  args: string[];
}

/**
 * The toolkit module a recorded Bash command RUNS, or null. The whole command
 * must be ONE plain `bun [run] "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/<module>.ts" …`
 * invocation under the tracker-write hook's own shell grammar
 * (`simpleCommandWords`): no chaining (`;`, `&&`, `|`), redirection,
 * subshell, substitution or comment. So `bun run <writer> …; echo 'dpt-receipt: …'`
 * runs no module here, and neither does `echo …<module>.ts…; exit 1`: text
 * that merely names a module is never a run of it.
 */
function toolkitModuleRun(command: string): ModuleRun | null {
  let cmd = command.trim();
  for (const [token, word] of ROOT_WORDS) cmd = cmd.replaceAll(token, word);
  const words = simpleCommandWords(cmd, PLUGIN_ROOT_WORD);
  if (words === null || words[0] !== "bun") return null;
  const at = words[1] === "run" ? 2 : 1;
  const target = words[at];
  if (target === undefined || !target.startsWith(MODULE_DIR)) return null;
  const module = target.slice(MODULE_DIR.length);
  return /^[\w.-]+\.ts$/.test(module) ? { module, args: words.slice(at + 1) } : null;
}

/** The Bash calls of `s` that RUN `module` (under `subcommand`, when given) — `toolkitModuleRun`, never a substring. */
function moduleRuns(s: BundleSession, module: string, subcommand?: string): ToolCall[] {
  return s.calls.filter((c) => {
    if (c.name !== "Bash") return false;
    const run = toolkitModuleRun(cmdOf(c));
    return run !== null && run.module === module && (subcommand === undefined || run.args[0] === subcommand);
  });
}
const ms = (at: string): number => Date.parse(at);
/** A commit time (whole seconds) falls in a call's step: from its second to the next call in the session. */
const inStep = (commitAt: string, from: string, to: number): boolean => {
  const t = ms(commitAt);
  return t >= Math.floor(ms(from) / 1000) * 1000 && t < to;
};
function nextAt(s: BundleSession, c: ToolCall): number {
  const later = s.calls.filter((x) => ms(x.at) > ms(c.at)).map((x) => ms(x.at));
  return later.length > 0 ? Math.min(...later) : Number.POSITIVE_INFINITY;
}

/**
 * Whether a call's tool_result is ANY PreToolUse hook error, whatever its
 * wording. The sites where a hook refusal is FORBIDDEN (the permitted PR, the
 * ungated clients' isolation) read this, never `hookRefusal`: a refusal worded
 * differently still refused, and reading it as "not refused" would be the
 * permitting answer. The sites where a refusal is REQUIRED keep `hookRefusal`'s
 * full shape and the hook it names, which fails closed on a rewording.
 */
function anyHookError(c: ToolCall): boolean {
  return c.result.isError && /\bPreToolUse:\S+ hook\b/.test(c.result.text);
}

/** The hook a refused call names, or null when its tool_result is not a hook refusal. */
function hookRefusal(c: ToolCall): string | null {
  if (!c.result.isError || !/PreToolUse:\S+ hook error:/.test(c.result.text) || !/Refusing:/.test(c.result.text)) return null;
  return /hook=([\w-]+)/.exec(c.result.text)?.[1] ?? null;
}

/** A `save_*` call with no `id` input creates; one with an id updates. */
const hasNoId = (c: ToolCall): boolean => c.input.id === undefined || c.input.id === null || c.input.id === "";
/** The keys a call's tracker answer names. */
const itemKeys = (c: ToolCall): string[] => (c.result.items ?? []).map((i) => i.key);
/** The title a create call's input gives (`summary` on Jira, `title` on Linear), or "". */
const createTitle = (c: ToolCall): string =>
  typeof c.input.summary === "string" ? c.input.summary : typeof c.input.title === "string" ? c.input.title : "";

/** A successful tracker create: any `createJiraIssue`, or a `save_issue` / `save_milestone` without `id`. */
const isCreate = (c: ToolCall): boolean => {
  if (!isTrackerTool(c.name) || c.result.isError) return false;
  const t = bareTool(c.name);
  if (t === "createJiraIssue") return true;
  return (t === "save_issue" || t === "save_milestone") && hasNoId(c);
};
/** A create ATTEMPT, whatever its answer: a `createJiraIssue`, or a `save_issue` / `save_milestone` without `id`. */
const isCreateAttempt = (c: ToolCall): boolean => {
  if (!isTrackerTool(c.name)) return false;
  const t = bareTool(c.name);
  return t === "createJiraIssue" || ((t === "save_issue" || t === "save_milestone") && hasNoId(c));
};
const createdBy = (ss: BundleSession[]): string[] => ss.flatMap((s) => s.calls.filter(isCreate).flatMap(itemKeys));
/** A claim transition: a `transitionJiraIssue`, or a Linear `save_issue` on an id that sets its state or assignee. */
const isClaimTransition = (c: ToolCall): boolean => {
  const t = bareTool(c.name);
  if (t === "transitionJiraIssue") return true;
  return t === "save_issue" && !hasNoId(c) && ["state", "stateId", "status", "assignee", "assigneeId"].some((k) => c.input[k] !== undefined);
};
/** An import sync: a labels write on an existing ticket (`editJiraIssue` fields.labels, or a Linear `save_issue` on an id with labels). */
const isLabelSync = (c: ToolCall): boolean => {
  const t = bareTool(c.name);
  if (t === "editJiraIssue") return ((c.input.fields ?? {}) as Record<string, unknown>).labels !== undefined;
  return t === "save_issue" && !hasNoId(c) && c.input.labels !== undefined;
};

/** The git subcommand a command runs (after `-C <dir>` / `-c <k=v>` options), or null. */
function gitSubcommand(cmd: string): string | null {
  return /\bgit(?:\s+-[Cc]\s+\S+)*\s+([A-Za-z][\w-]*)/.exec(cmd)?.[1] ?? null;
}
/** Git's own subcommands: a run naming any other one can only be running an alias. */
const GIT_BUILTINS: ReadonlySet<string> = new Set([
  "add", "am", "apply", "archive", "bisect", "blame", "branch", "bundle", "cat-file", "checkout", "cherry-pick", "clean",
  "clone", "commit", "commit-tree", "config", "describe", "diff", "fetch", "for-each-ref", "format-patch", "gc", "grep",
  "hash-object", "init", "log", "ls-files", "ls-tree", "merge", "merge-base", "mv", "notes", "pull", "push", "read-tree",
  "rebase", "reflog", "remote", "reset", "restore", "rev-list", "rev-parse", "revert", "rm", "show", "show-ref", "stash",
  "status", "submodule", "switch", "symbolic-ref", "tag", "update-ref", "worktree", "write-tree",
]);
/** Git subcommands that never write, whatever their arguments. */
const GIT_READ_ONLY: ReadonlySet<string> = new Set([
  "log", "status", "show", "diff", "rev-parse", "ls-files", "ls-tree", "show-ref", "merge-base", "cat-file", "rev-list",
  "describe", "blame", "grep", "for-each-ref", "shortlog", "whatchanged", "var", "check-ignore", "check-attr", "name-rev", "cherry",
]);
/** Branch options that only list or show (anything else — a name, -d/-D/-m/-M/-c/-C, --set-upstream-to — may write). */
const BRANCH_LIST_OPTIONS = /^(?:--list|-l|--show-current|-a|--all|-r|--remotes|-v|-vv|--verbose|--no-color|--color(?:=\S+)?|--format=\S+|--sort=\S+)$/;

/**
 * Whether a git command is read-only: its subcommand never writes
 * (`GIT_READ_ONLY`), or it is the listing or reading form of a subcommand that
 * can write — `branch` with only listing options (or none), `config` with
 * `--get`/`--get-all`/`--get-regexp`/`--list` (or the `get`/`list` verbs),
 * `worktree list`, `remote` with no verb or `-v`/`show`/`get-url`,
 * `stash list|show`, `tag` with `-l`/`--list` or nothing, `reflog` with no
 * verb or `show`. Anything else (commit, merge, cherry-pick, revert, am,
 * commit-tree, reset, checkout, switch, update-ref, a bare `config k v`, an
 * alias) is not read-only, and neither is a command holding more than one git
 * invocation.
 */
function isReadOnlyGit(cmd: string): boolean {
  // One git invocation only: `git status; git commit` is not a read.
  if ((cmd.match(/\bgit\b/g) ?? []).length !== 1) return false;
  const sub = gitSubcommand(cmd);
  if (sub === null) return false;
  if (GIT_READ_ONLY.has(sub)) return true;
  const m = new RegExp(`\\bgit(?:\\s+-[Cc]\\s+\\S+)*\\s+${sub.replace(/[-]/g, "\\-")}\\b([^;&|]*)`).exec(cmd);
  const args = (m?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
  const [verb] = args;
  switch (sub) {
    case "branch":
      return args.every((a) => BRANCH_LIST_OPTIONS.test(a));
    case "config":
      return args.some((a) => /^(?:--get|--get-all|--get-regexp|--list|-l)$/.test(a)) || verb === "get" || verb === "list";
    case "worktree":
      return verb === "list";
    case "remote":
      return verb === undefined || verb === "-v" || verb === "--verbose" || verb === "show" || verb === "get-url";
    case "stash":
      return verb === "list" || verb === "show";
    case "tag":
      return verb === undefined || verb === "-l" || verb === "--list";
    case "reflog":
      return verb === undefined || verb === "show";
    default:
      return false;
  }
}

const isMergeNoFf = (cmd: string): boolean => gitSubcommand(cmd) === "merge" && /\s--no-ff(?:\s|$)/.test(cmd);
const isAliasedGitRun = (cmd: string): boolean => {
  const sub = gitSubcommand(cmd);
  return sub !== null && !GIT_BUILTINS.has(sub);
};
/** Keys created in `ss` by a create whose input labels carry one of `tags`. */
const keysCreatedWithTag = (ss: BundleSession[], tags: readonly string[]): string[] =>
  ss.flatMap((s) => s.calls.filter((c) => isCreate(c) && inputLabels(c).some((l) => tags.includes(l))).flatMap(itemKeys));
const targetKey = (c: ToolCall): string => str(c.input.issueIdOrKey ?? c.input.id);
function inputLabels(c: ToolCall): string[] {
  const add = (c.input.additional_fields ?? {}) as Record<string, unknown>;
  const fields = (c.input.fields ?? {}) as Record<string, unknown>;
  return labelsOf(c.input.labels ?? add.labels ?? fields.labels);
}

/** The sessions carrying `marker`, in bundle order (`[0]` is the first audit, `[1]` the second). */
const sessionsMarked = (b: LiveBundle, marker: string): BundleSession[] => b.sessions.filter((s) => s.marker === marker);

/** Thrown by `receiptsOf` for a repository whose receipts cannot be read (absent or unreadable). */
class ReceiptsUnreadable extends Error {
  constructor(
    readonly root: Root,
    readonly why: string,
  ) {
    super(`repository <${root}>'s receipts cannot be read: ${why}`);
  }
}

/**
 * A repository's receipts. When they cannot be read this THROWS
 * `ReceiptsUnreadable` rather than returning an empty list, so no consumer can
 * read "unreadable" as "none written": a predicate that needs them is graded
 * not-observed (`gradeScenarios`), and `gatedWrites` aborts the run when the
 * repository's sessions made gated writes. The run-wide receipt checks that
 * iterate every readable repository use `readableReceipts` and say so.
 */
function receiptsOf(b: LiveBundle, root: Root): BundleReceipt[] {
  const set = b.repos[root].receipts;
  if (!set.readable) throw new ReceiptsUnreadable(root, set.error);
  return set.records;
}

/**
 * Every receipt of the repositories whose receipts CAN be read. An unreadable
 * repository contributes none here on purpose: nothing of it can be checked
 * for announcement or listing provenance, and it is not graded as clean
 * either — `gatedWrites` aborts on it whenever its sessions made gated
 * writes, and every scenario that needs its receipts is not-observed.
 */
function readableReceipts(b: LiveBundle): BundleReceipt[] {
  return (["A", "B"] as const).flatMap((r) => {
    const set = b.repos[r].receipts;
    return set.readable ? set.records : [];
  });
}

/** The first audit's read-back: every item it read, by key (a later read of a key wins). */
function auditItems(b: LiveBundle): Map<string, TrackerItem> {
  const out = new Map<string, TrackerItem>();
  const first = sessionsMarked(b, "audit")[0];
  for (const c of first?.calls ?? []) for (const i of c.result.items ?? []) out.set(i.key, i);
  return out;
}

const intruderKeys = (b: LiveBundle): string[] => createdBy(sessionsMarked(b, "intruder"));

/** Keys created carrying a declared repository tag, plus every key an FR file binds. */
function taggedKeys(b: LiveBundle): Set<string> {
  const bound = [...b.repos.A.frBindings, ...b.repos.B.frBindings].map((f) => f.key);
  return new Set([...bound, ...keysCreatedWithTag(b.sessions, [b.roots.A.tag, b.roots.B.tag])]);
}

/**
 * A receipt announcement line (`dpt-receipt: <path> [sha256:<hex>]`) in a
 * tool_result; group 1 is the path, group 2 the sha256. The line alone proves
 * nothing: `announcements` counts it only from one plain toolkit module run,
 * and only with a sha256.
 */
const ANNOUNCE = /^dpt-receipt: (\S+)(?: sha256:([0-9a-f]{64}))?\s*$/gm;

/**
 * The earliest announcement, in these sessions, of a gate receipt (adapter
 * null) present in B: printed by a run of `gate_receipt.ts` (the module that
 * writes gate receipts) with the sha256 of the receipt's bytes. The same line
 * printed by any other command — an `echo` — is no evidence.
 */
function gateEvidenceAt(b: LiveBundle, own: BundleSession[]): string | null {
  const gateReceipts = receiptsOf(b, "B").filter((r) => r.adapter === null && r.path.startsWith("<B>/"));
  const ats: string[] = [];
  for (const s of own) {
    for (const a of announcements(s)) {
      if (a.module === "gate_receipt.ts" && gateReceipts.some((r) => r.path === a.path && r.sha256 === a.sha256)) ats.push(s.calls[a.index]!.at);
    }
  }
  return ats.sort((x, y) => ms(x) - ms(y))[0] ?? null;
}

const landsInB = (b: LiveBundle, s: BundleSession, c: ToolCall): boolean => b.repos.B.commits.some((k) => inStep(k.at, c.at, nextAt(s, c)));

/**
 * S1, S2 — two nonce FR items per title, one per repository's tag; the FR
 * files bind different keys. Sessions that made no successful create leave
 * nothing to count: not-observed, never a pass by an empty loop.
 */
const sameTitle: Predicate = (b, own) => {
  const titles = createdTitles(own);
  if (titles.size === 0) return notObserved("no session of this scenario made a successful create");
  const audit = [...auditItems(b).values()];
  for (const t of titles) {
    const items = audit.filter((i) => i.kind === "issue" && i.issueType !== "Epic" && i.summary === t);
    // An item read without its labels is not untagged: it cannot be counted either way (`auditFieldsAbsent` aborts the run on it).
    const unlabelled = items.find((i) => i.absent?.includes("labels"));
    if (unlabelled) return notObserved(`the audit read ${unlabelled.key || "an item"} titled "${t}" without its labels, so its tag cannot be counted`);
    if (items.length !== 2) return fail(`the audit holds ${items.length} FR items titled "${t}", not two`);
    for (const tag of [b.roots.A.tag, b.roots.B.tag]) {
      const n = items.filter((i) => i.labels.includes(tag)).length;
      if (n !== 1) return fail(`${n} of the FR items titled "${t}" carry the tag ${tag}, not one`);
    }
  }
  const why = sameTitleBindsDifferentKeys(b, own);
  return why === null ? PASS : fail(why);
};

/** S3 — one milestone container for the span title; A decided create, B joined by key; both plans carry one token. */
const mintAndJoin: Predicate = (b, own) => {
  const decision = (r: Root) => {
    const ids = new Set(own.filter((s) => s.root === r).map((s) => s.sessionId));
    return receiptsOf(b, r).find((x) => x.kind === "milestone-decision" && ids.has(x.sessionId));
  };
  const a = decision("A");
  const bj = decision("B");
  if (!a || a.evidence.act !== "create") return fail(`A's milestone-decision receipt records act ${str(a?.evidence.act) || "(none)"}, not create`);
  if (!bj || bj.evidence.act !== "join" || bj.evidence.via !== "key") return fail(`B's milestone-decision receipt records act ${str(bj?.evidence.act) || "(none)"} via ${str(bj?.evidence.via) || "(none)"}, not a join via key`);
  const span = str(a.evidence.title) || a.subject;
  const containers = [...auditItems(b).values()].filter((i) => (i.kind === "milestone" || i.issueType === "Epic") && i.summary === span);
  if (containers.length !== 1) return fail(`the audit holds ${containers.length} milestone containers titled "${span}", not one`);
  if (str(bj.evidence.key) !== containers[0]!.key) return fail(`B joined ${str(bj.evidence.key)}, not the span's container ${containers[0]!.key}`);
  const bTokens = new Set(b.repos.B.plans.map((p) => p.milestone));
  if (!b.repos.A.plans.some((p) => bTokens.has(p.milestone))) return fail("A's and B's plans carry no common milestone token");
  return PASS;
};

/** S4 — each repository's listing claims none of its sibling's keys and names the intruder's items unattributed. */
const orphanListing: Predicate = (b, own) => {
  const intruders = intruderKeys(b);
  for (const r of ["A", "B"] as const) {
    const sib = new Set(b.repos[r === "A" ? "B" : "A"].frBindings.map((f) => f.key));
    const runs = own.filter((s) => s.root === r).flatMap((s) => moduleRuns(s, "container_ownership.ts", "list"));
    if (runs.length === 0) return fail(`no orphan listing is recorded in <${r}>`);
    for (const c of runs) {
      const rows = new Map<string, string>();
      for (const m of c.result.text.matchAll(/^\|\s*([^|\s]+)\s*\|\s*([^|\s]+)\s*\|/gm)) rows.set(m[1]!, m[2]!);
      for (const [key, cls] of rows) if (sib.has(key) && cls === "ours") return fail(`<${r}>'s listing claims its sibling's ${key} as its own`);
      for (const u of intruders) if (rows.get(u) !== "unowned") return fail(`<${r}>'s listing does not name the intruder's ${u} as unattributed`);
    }
  }
  return PASS;
};

/** S5 — A's busy-sibling run exits 1 naming B with no commit during it; its permit twin, after B's archive, exits 0. */
const siblingBusyShip: Predicate = (b, own) => {
  const RUN = "sibling_release.ts";
  const busy = own[0]!;
  const refusal = moduleRuns(busy, RUN)[0];
  if (!refusal) return notObserved(`session ${busy.sessionId} never ran sibling_release.ts (its /ship-milestone stopped earlier)`);
  if (refusal.result.exitCode !== 1 || !refusal.result.text.includes(b.roots.B.name)) return fail(`${refusal.ref}: the busy-sibling run exited ${refusal.result.exitCode} without refusing on ${b.roots.B.name}`);
  const end = nextAt(busy, refusal);
  const landed = b.repos.A.commits.find((k) => inStep(k.at, refusal.at, end));
  if (landed) return fail(`A's history gained "${landed.subject}" during the busy-sibling step`);
  const twin = own.slice(1).flatMap((s) => moduleRuns(s, RUN)).find((c) => ms(c.at) > ms(refusal.at));
  if (!twin) return fail("no permit twin of the busy-sibling run is recorded");
  if (twin.result.exitCode !== 0) return fail(`${twin.ref}: the permit twin exited ${twin.result.exitCode}`);
  if (!b.repos.B.commits.some((k) => /archive/i.test(k.subject) && ms(k.at) <= ms(twin.at))) return fail("the permit twin ran before B's FR was archived");
  return PASS;
};

/**
 * S6 — refused on the second server name, nothing created (tool_results and
 * audit), digest equal. The audit-side count links an audit item to the
 * session by the title its create attempt carried, so a session whose writes
 * include no titled create attempt leaves that count nothing to count by:
 * not-observed, never a pass by an empty title set.
 */
const belowFloor: Predicate = (b, own) => {
  const writes = own.flatMap((s) => s.calls.filter(isTrackerWrite));
  if (writes.length === 0) return notObserved("the below-floor session attempted no tracker write");
  const refused = writes.filter((c) => hookRefusal(c) === "pre-tracker-write-gate");
  if (refused.length === 0) return fail("no tracker write of the below-floor session was refused by the tracker-write hook");
  if (!refused.some((c) => SECOND_SERVER.test(serverOf(c.name)))) return fail("no hook refusal is recorded on the second server name");
  const created = createdBy(own);
  if (created.length > 0) return fail(`the below-floor session created ${created.join(", ")}`);
  const titles = new Set(writes.filter(isCreateAttempt).map(createTitle).filter(Boolean));
  if (titles.size === 0) return notObserved("no below-floor write was a titled create, so the audit holds nothing to count it by");
  const inAudit = [...auditItems(b).values()].find((i) => titles.has(i.summary));
  if (inAudit) return fail(`the audit reads ${inAudit.key}, titled like the below-floor write`);
  if (b.run.belowFloorDigest !== b.run.behaviourDigest.digest) return fail("the below-floor copy's behaviour digest differs from the tree under test's");
  return PASS;
};

/** S7, S9 — every tracker write the scenario attempted was refused by the tracker-write hook. */
const writesRefused: Predicate = (_b, own) => {
  const writes = own.flatMap((s) => s.calls.filter(isTrackerWrite));
  if (writes.length === 0) return notObserved("the scenario attempted no tracker write");
  const through = writes.find((c) => hookRefusal(c) !== "pre-tracker-write-gate");
  return through ? fail(`${through.ref}: the write was not refused by the tracker-write hook`) : PASS;
};

/**
 * S11 — B's relocated checkout: every S11 session runs in a worktree inside B
 * (its cwd is under `<B>/`, not `<B>` itself); every tracker write it made
 * was refused by the tracker-write hook, and at least one refusal names
 * `CLAUDE.md` as unreadable (the worktree's declaration made unreadable);
 * nothing was created — no successful create in its tool_results, and no
 * audit item under the title of any create it attempted. No write is
 * not-observed. The pre-declaration-branch half of S11 (an undeclared
 * worktree whose write is permitted, AC-STE-616.10) is graded offline only.
 */
const relocatedCheckout: Predicate = (b, own) => {
  const writes = own.flatMap((s) => s.calls.filter(isTrackerWrite));
  if (writes.length === 0) return notObserved("the relocated checkout attempted no tracker write");
  const stray = own.find((s) => s.root !== "B" || !s.cwd.startsWith("<B>/"));
  if (stray) return fail(`session ${stray.sessionId} ran in ${stray.cwd || "(no cwd)"}, not a relocated checkout inside B`);
  const through = writes.find((c) => hookRefusal(c) !== "pre-tracker-write-gate");
  if (through) return fail(`${through.ref}: the write was not refused by the tracker-write hook`);
  if (!writes.some((c) => /CLAUDE\.md/.test(c.result.text) && /cannot be read|unreadable/i.test(c.result.text))) return fail("no refusal names the relocated checkout's CLAUDE.md as unreadable");
  const created = createdBy(own);
  if (created.length > 0) return fail(`the relocated checkout created ${created.join(", ")}`);
  const titles = new Set(writes.filter(isCreateAttempt).map(createTitle).filter(Boolean));
  const inAudit = [...auditItems(b).values()].find((i) => titles.has(i.summary));
  if (inAudit) return fail(`the audit reads ${inAudit.key}, titled like a relocated-checkout create`);
  return PASS;
};

/**
 * S8 — a refusal with zero container writes precedes B's declaration; the
 * legacy key resolves, undup'd. The legacy key is the one B's sessions
 * created before the repoint; with none created, the legacy-key check has
 * nothing to check: not-observed.
 */
/**
 * The repoint receipt a successful repoint run announced (its own
 * announcement, printed by the receipt's writer, naming bytes that exist in
 * B's receipts), or null.
 */
function declarationReceipt(b: LiveBundle, own: BundleSession[]): { decl: ToolCall; receipt: BundleReceipt | null } | null {
  for (const s of own) {
    const i = s.calls.findIndex((c) => c.name === "Bash" && toolkitModuleRun(cmdOf(c))?.module === "repoint_tracker_binding.ts" && c.result.exitCode === 0 && !c.result.isError);
    if (i === -1) continue;
    const set = b.repos.B.receipts;
    const a = announcements(s).find((x) => x.index === i);
    const receipt = a && set.readable ? set.records.find((r) => r.kind === "repoint" && announces(a, r)) ?? null : null;
    return { decl: s.calls[i]!, receipt };
  }
  return null;
}

/** The receipt's `assertedCompleteness`, or null when it is absent or not a list of input names. */
const assertedInputs = (r: BundleReceipt | null): string[] | null => {
  const v = r?.evidence.assertedCompleteness;
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
};

const repoint: Predicate = (b, own) => {
  const runs = own.flatMap((s) => moduleRuns(s, "repoint_tracker_binding.ts"));
  const decl = runs.find((c) => c.result.exitCode === 0 && !c.result.isError);
  if (!decl) return fail("B's declaration (a successful repoint) is not recorded");
  const declared = declarationReceipt(b, own);
  if (!declared?.receipt) return fail("B's declaration announced no repoint receipt present in B's receipts");
  if (assertedInputs(declared.receipt) === null) return fail("the repoint receipt does not record evidence.assertedCompleteness as a list of input names, so the verdict cannot say which inputs rested on the session's claim");
  const refusal = runs.find((c) => c.result.exitCode !== 0 && ms(c.at) < ms(decl.at));
  if (!refusal) return fail("no repoint refusal precedes B's declaration");
  const write = own.flatMap((s) => s.calls.filter(isTrackerWrite)).find((c) => ms(c.at) > ms(refusal.at) && ms(c.at) < ms(decl.at));
  if (write) return fail(`${write.ref}: a container write between the refusal and the declaration`);
  const legacyKeys = createdBy(own);
  if (legacyKeys.length === 0) return notObserved("no legacy item was created before the repoint, so no legacy key can be resolved");
  const audit = auditItems(b);
  for (const k of legacyKeys) {
    const legacy = audit.get(k);
    if (!legacy) return fail(`the legacy key ${k} does not resolve in the audit`);
    // An item read without its container is not proven to be elsewhere: it counts as in the shared one.
    const dup = [...audit.values()].find((i) => i.key !== k && (i.container === b.run.container || i.container === "") && i.summary === legacy.summary);
    if (dup) return fail(`${dup.key} in the shared container duplicates the legacy item's title`);
  }
  return PASS;
};

/** S10 — the detector, afterwards, flags the intruder's and the old client's items and no tagged item. */
const oldClient: Predicate = (b, own) => {
  const old = own.filter((s) => s.client === "old-client");
  const attempts = old.flatMap((s) => s.calls.filter(isTrackerWrite));
  const lastWrite = Math.max(Number.NEGATIVE_INFINITY, ...attempts.map((c) => ms(c.at)));
  const runs = own.filter((s) => s.client === "tree").flatMap((s) => moduleRuns(s, "tracker_local_reconciliation_drift.ts")).filter((c) => ms(c.at) > lastWrite);
  if (runs.length === 0) return fail("no detector run is recorded after the old client's writes");
  const flagged = new Set(runs.flatMap((c) => [...c.result.text.matchAll(/^warning unowned-container-ticket: (\S+)/gm)].map((m) => m[1]!)));
  const intruders = intruderKeys(b);
  if (intruders.length === 0) return fail("the intruder created no item for the detector to recall");
  for (const k of [...intruders, ...createdBy(old)]) if (!flagged.has(k)) return fail(`the detector does not flag ${k}`);
  const tagged = taggedKeys(b);
  for (const k of flagged) if (tagged.has(k)) return fail(`the detector flags ${k}, which carries a declared tag`);
  return attempts.length === 0 ? { outcome: "pass", reason: "old-client-stopped" } : PASS;
};

/** S12 — commit and PR into B refused by the hooks before B's evidence; after it the commit lands and the PR meets gh. */
const hooksByRepo: Predicate = (b, own) => {
  const ev = gateEvidenceAt(b, own);
  if (ev === null) return fail("B's own gate evidence is never announced");
  const pairs = own.flatMap((s) => s.calls.filter((c) => c.name === "Bash" && cmdOf(c).includes("<B>")).map((c) => ({ s, c })));
  const commits = pairs.filter(({ c }) => /\bgit\b[^|;&]*\bcommit\b/.test(cmdOf(c)));
  const prs = pairs.filter(({ c }) => /\bgh\s+pr\s+create\b/.test(cmdOf(c)));
  const before = (xs: typeof pairs) => xs.filter(({ c }) => ms(c.at) < ms(ev));
  const after = (xs: typeof pairs) => xs.filter(({ c }) => ms(c.at) > ms(ev));
  if (before(commits).length === 0 || before(prs).length === 0) return fail("no commit or no PR into B is recorded before B's evidence");
  for (const { c } of before(commits)) if (hookRefusal(c) !== "pre-commit-gate-check") return fail(`${c.ref}: the commit into B was not refused by the commit hook`);
  for (const { c } of before(prs)) if (hookRefusal(c) !== "pre-pr-spec-review") return fail(`${c.ref}: the PR into B was not refused by the PR hook`);
  if (after(commits).length === 0 || after(prs).length === 0) return fail("no commit or no PR into B is recorded after B's evidence");
  for (const { s, c } of after(commits)) if (c.result.exitCode !== 0 || !landsInB(b, s, c)) return fail(`${c.ref}: the permitted commit did not land in B's history`);
  for (const { c } of after(prs)) if (!c.result.isError || anyHookError(c)) return fail(`${c.ref}: the permitted PR's tool_result is not a gh error`);
  return PASS;
};

/**
 * S13 — B's claim transition AND its import sync on A's ticket are each
 * recorded and each hook-refused, and A's ticket is unchanged; the untagged
 * item's import follows the operator's consent to its printed `Import <KEY>`
 * label — an answered AskUserQuestion, or the answers block of the session's
 * first user message (`consentTimes`). One of the two writes alone is not the
 * scenario.
 */
const claimAndImport: Predicate = (b, own) => {
  const tagA = b.roots.A.tag;
  const tagB = b.roots.B.tag;
  const aKeys = new Set([...b.repos.A.frBindings.map((f) => f.key), ...keysCreatedWithTag(b.sessions.filter((x) => x.root === "A"), [tagA])]);
  const calls = own.flatMap((s) => s.calls);
  const onA = calls.filter((c) => isTrackerWrite(c) && aKeys.has(targetKey(c)));
  if (!onA.some(isClaimTransition)) return fail("no claim transition on A's ticket is recorded");
  if (!onA.some(isLabelSync)) return fail("no import sync on A's ticket is recorded");
  for (const c of onA) if (hookRefusal(c) !== "pre-tracker-write-gate") return fail(`${c.ref}: the write on A's ${targetKey(c)} was not refused by the tracker-write hook`);
  const audit = auditItems(b);
  for (const k of new Set(onA.map(targetKey))) {
    const it = audit.get(k);
    if (!it || !it.labels.includes(tagA) || it.labels.includes(tagB)) return fail(`the audit does not show A's ${k} unchanged`);
  }
  const intruders = intruderKeys(b);
  if (intruders.length === 0) return fail("there is no untagged item to import");
  // The untagged item S13 imports: each intruder item its session asks about or writes to.
  const consents = own.flatMap((s) => moduleRuns(s, "container_ownership.ts", "consent"));
  const importsOf = (u: string) => calls.filter((c) => (isTrackerWrite(c) && targetKey(c) === u) || (consents.includes(c) && cmdOf(c).includes(u)));
  // Consent: an answered AskUserQuestion, or the answers block of a session's first user message (`consentTimes`).
  const askedAbout = (u: string) => own.flatMap((s) => consentTimes(s, `Import ${u}`));
  const touched = intruders.filter((u) => importsOf(u).length > 0 || askedAbout(u).length > 0);
  if (touched.length === 0) return fail("no import of an untagged item is recorded");
  for (const u of touched) {
    const asked = askedAbout(u);
    if (asked.length === 0) return fail(`no consent to the printed "Import ${u}" label is recorded (an answered AskUserQuestion, or ${ORPHAN_CONSENT_ANSWER_KEY}: Import ${u} in the answers block)`);
    const askAt = Math.min(...asked);
    const imports = importsOf(u);
    const syncs = imports.filter((c) => isTrackerWrite(c) && !c.result.isError);
    if (syncs.length === 0) return fail(`no import sync of ${u} succeeded`);
    const early = imports.find((c) => ms(c.at) < askAt);
    if (early) return fail(`${early.ref}: the import of ${u} precedes the answered question`);
    if (!audit.get(u)?.labels.includes(tagB)) return fail(`the audit does not read B's tag on ${u}`);
  }
  return PASS;
};

/** S14 — B's attach before its join exits 1 with no create after it; A's release is held one-sided before B's back-reference. */
const zeroWriteJoin: Predicate = (b, own) => {
  const join = receiptsOf(b, "B").find((r) => r.kind === "milestone-decision" && r.evidence.act === "join");
  if (!join) return fail("B's join decision is not recorded");
  // Announced by its writer's run (resolve_milestone_identity.ts), with its bytes' sha256: an echoed line is no announcement.
  const joinAts = b.sessions.filter((s) => s.root === "B").flatMap(announcements).filter((a) => announces(a, join)).map((a) => a.at);
  if (joinAts.length === 0) return fail("B's join decision was never announced by its writer");
  const joinAt = Math.min(...joinAts);
  const attaches = own.filter((s) => s.root === "B").flatMap((s) => moduleRuns(s, "attach_project_milestone.ts").map((c) => ({ s, c }))).filter(({ c }) => ms(c.at) < joinAt);
  if (attaches.length === 0) return fail("B's attach-target run before its join is not recorded");
  for (const { s, c } of attaches) {
    if (c.result.exitCode !== 1) return fail(`${c.ref}: B's attach before its join exited ${c.result.exitCode}`);
    const after = s.calls.find((x) => isCreate(x) && ms(x.at) > ms(c.at));
    if (after) return fail(`${after.ref}: an FR create follows the refused attach`);
  }
  const joinKey = str(join.evidence.key);
  const created = b.sessions.filter((s) => s.root === "B").flatMap((s) => s.calls).some((c) => isCreate(c) && ms(c.at) > joinAt && str(c.input.parent ?? c.input.milestone) === joinKey);
  if (!created) return fail(`no create into ${joinKey} succeeds after B's join`);
  const held = own.filter((s) => s.root === "A").flatMap((s) => moduleRuns(s, "sibling_release.ts")).filter((c) => ms(c.at) < joinAt);
  if (held.length === 0) return fail("A's sibling_release.ts run before B's back-reference is not recorded");
  for (const c of held) if (c.result.exitCode !== 1 || !c.result.text.includes(b.roots.B.name) || !/one-sided/.test(c.result.text)) return fail(`${c.ref}: A's release was not held naming ${b.roots.B.name} one-sided`);
  return PASS;
};

/** S16 — each root's typed door refuses naming the decision front door, probe #73 errors on M999.md, no tracker call. */
function reportsM999(text: string): boolean {
  try {
    const v = JSON.parse(text) as { violations?: Array<{ severity?: unknown; file?: unknown }> };
    return (v.violations ?? []).some((x) => x.severity === "error" && /(^|\/)M999\.md$/.test(str(x.file)));
  } catch {
    return text.split("\n").some((l) => /\berror\b/.test(l) && l.includes("M999.md"));
  }
}
const newNumericMilestone: Predicate = (_b, own) => {
  for (const r of ["A", "B"] as const) {
    const ss = own.filter((s) => s.root === r);
    const doors = ss.flatMap((s) => moduleRuns(s, "next_free_milestone_number.ts"));
    const probes = ss.flatMap((s) => moduleRuns(s, "plan_identity_mode_conditional.ts"));
    if (doors.length === 0 || probes.length === 0) return fail(`<${r}> records no typed door run or no probe #73 run`);
    for (const c of doors) if (c.result.exitCode !== 1 || !/resolve_milestone_identity/.test(c.result.text)) return fail(`${c.ref}: the typed door exited ${c.result.exitCode} without naming the decision front door`);
    for (const c of probes) if (!reportsM999(c.result.text)) return fail(`${c.ref}: probe #73 does not report M999.md as an error`);
  }
  const tracker = own.flatMap((s) => s.calls).find((c) => isTrackerTool(c.name));
  return tracker ? fail(`${tracker.ref}: a tracker call in a record-only scenario`) : PASS;
};

/**
 * S17 — commit-writing git runs into B are hook-refused before B's evidence
 * and land in B's history after it. Each side must hold BOTH a
 * `merge --no-ff` and an aliased commit (a git subcommand that is no git
 * builtin, so only an alias can make it run): one of the two alone is not
 * the scenario.
 */
const subcommandsAndAliases: Predicate = (b, own) => {
  const ev = gateEvidenceAt(b, own);
  if (ev === null) return fail("B's own gate evidence is never announced");
  const runs = own.flatMap((s) => s.calls.filter((c) => c.name === "Bash" && /\bgit\b/.test(cmdOf(c)) && cmdOf(c).includes("<B>") && !isReadOnlyGit(cmdOf(c))).map((c) => ({ s, c })));
  const before = runs.filter(({ c }) => ms(c.at) < ms(ev));
  const after = runs.filter(({ c }) => ms(c.at) > ms(ev));
  for (const [side, xs] of [["before", before], ["after", after]] as const) {
    if (!xs.some(({ c }) => isMergeNoFf(cmdOf(c)))) return fail(`no \`merge --no-ff\` into B is recorded ${side} B's evidence`);
    if (!xs.some(({ c }) => isAliasedGitRun(cmdOf(c)))) return fail(`no aliased commit into B is recorded ${side} B's evidence`);
  }
  for (const { c } of before) if (hookRefusal(c) !== "pre-commit-gate-check") return fail(`${c.ref}: the run into B was not refused by the commit hook before B's evidence`);
  for (const { s, c } of after) if (c.result.exitCode !== 0 || !landsInB(b, s, c)) return fail(`${c.ref}: the run into B did not land in B's history after its evidence`);
  return PASS;
};

const LIVE_PREDICATES: Readonly<Record<string, Predicate>> = {
  S1: sameTitle,
  S2: sameTitle,
  S3: mintAndJoin,
  S4: orphanListing,
  S5: siblingBusyShip,
  S6: belowFloor,
  S7: writesRefused,
  S8: repoint,
  S9: writesRefused,
  S10: oldClient,
  S11: relocatedCheckout,
  S12: hooksByRepo,
  S13: claimAndImport,
  S14: zeroWriteJoin,
  S16: newNumericMilestone,
  S17: subcommandsAndAliases,
};

/** The registry ids the grader holds a live predicate for (AC.9). */
export const LIVE_PREDICATE_IDS: readonly string[] = Object.keys(LIVE_PREDICATES);

/** AC-STE-617.14 — Linear's issue budget, declared from the registry and spent by the run's issue creates. */
function linearBudget(b: LiveBundle): LiveVerdict["linearBudget"] {
  if (b.run.tracker !== "linear") return null;
  const created = b.sessions
    .filter((s) => s.marker !== "audit")
    .flatMap((s) => s.calls.filter((c) => /__save_issue$/.test(c.name) && !c.input.id && !c.result.isError).flatMap(itemKeys));
  return { declared: linearWorstCase(), spent: created.length, created };
}

/** The Linear free plan's refusal of an issue create past its cap. */
const LINEAR_FREE_ISSUE_LIMIT = /free issue limit/i;

/**
 * AC-STE-617.14 — Linear's budget is graded two ways: the first create the
 * free plan answered with its issue-limit 400 aborts the leg (never retried)
 * naming the budget spent; a run that spent more issues than the registry's
 * worst case fails `linear-budget-exceeded`.
 */
function linearBudgetFindings(b: LiveBundle, budget: LiveVerdict["linearBudget"]): { aborts: LiveFinding[]; findings: LiveFinding[] } {
  if (budget === null) return { aborts: [], findings: [] };
  const aborts: LiveFinding[] = [];
  for (const s of b.sessions.filter((x) => x.marker !== "audit")) {
    const capped = s.calls.find((c) => /__save_issue$/.test(c.name) && !c.input.id && c.result.isError && LINEAR_FREE_ISSUE_LIMIT.test(c.result.text));
    if (capped) {
      aborts.push({ code: "linear-free-issue-limit", session: s.sessionId, tool: capped.name, detail: `${capped.ref}: Linear refused an issue create at the free issue limit after ${budget.spent} of ${budget.declared} budgeted issues were spent; not retried` });
      break;
    }
  }
  const findings: LiveFinding[] =
    budget.spent > budget.declared
      ? [{ code: "linear-budget-exceeded", detail: `the run created ${budget.spent} Linear issues, over the registry's budget of ${budget.declared}: ${budget.created.join(", ")}` }]
      : [];
  return { aborts, findings };
}

function graderDigest(): string {
  return createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
}

/** AC-STE-617.8 — a ledgered session the bundle holds no record of. */
function missingSessions(b: LiveBundle): LiveFinding[] {
  const have = new Set(b.sessions.map((s) => s.sessionId));
  return b.ledger
    .filter((id) => !have.has(id))
    .map((id) => ({ code: "transcript-missing", session: id, detail: `ledgered session ${id} has no readable transcript` }));
}

/** AC-STE-617.8 — only the audits (or nothing) ran: no registry scenario was observed. */
function noScenarios(b: LiveBundle): LiveFinding[] {
  const observed = b.sessions.some((s) => SHARED_TRACKER_SCENARIO_IDS.includes(s.marker));
  return observed ? [] : [{ code: "no-scenarios", detail: "no ledgered session carries a registry scenario marker" }];
}

/** AC-STE-617.8 — the behaviour digest at grading differs from the one taken at the run's start. */
function pluginChanged(b: LiveBundle, now: string): LiveFinding[] {
  if (now === b.run.behaviourDigest.digest) return [];
  return [{ code: "plugin-changed-mid-run", detail: `behaviour digest ${b.run.behaviourDigest.digest} at the run's start, ${now} at grading` }];
}

/** Sessions whose writes are ungated by design (graded by the detector instead). */
const UNGATED_CLIENTS: readonly Client[] = ["old-client", "intruder"];

/**
 * Tracker receipt kind → the ONE module run that writes it and prints its
 * announcement (read from each module's own `writeReceipt({ kind })` call). A
 * receipt counts as announced only when its writer announced it: one module
 * never vouches for another module's kind. `subcommand` is the receipt-writing
 * subcommand the tracker-write hook requires (`RECEIPT_WRITING_SUBCOMMANDS`);
 * null marks a module whose whole CLI is its receipt-writing front door. The
 * modules for the kinds the hook gates are exactly the hook's
 * `RECEIPT_ANNOUNCING_MODULES` (a test pins the two lists together);
 * `repoint_tracker_binding.ts` is the one extra, as the hook gates no write by
 * a repoint receipt. Gate receipts (`adapter: null`) are out of scope.
 */
export const RECEIPT_WRITERS: Readonly<Record<string, { module: string; subcommand: string | null }>> = {
  create: { module: "create_idempotency_probe.ts", subcommand: "decide" },
  reuse: { module: "create_idempotency_probe.ts", subcommand: "decide" },
  "milestone-decision": { module: "resolve_milestone_identity.ts", subcommand: null },
  binding: { module: "ticket_ownership.ts", subcommand: "confirm" },
  import: { module: "container_ownership.ts", subcommand: "consent" },
  "attach-target": { module: "attach_project_milestone.ts", subcommand: null },
  repoint: { module: "repoint_tracker_binding.ts", subcommand: null },
};

/**
 * One receipt announcement: a `dpt-receipt: <path> sha256:<hex>` line in the
 * non-error output of a Bash call that RAN a toolkit module
 * (`toolkitModuleRun`), with that module, its first argument, and the call's
 * index in its session. As in the tracker-write hook, a run writes one
 * receipt, so an output carrying more than one announcement line announces
 * none, and a line with no sha256 announces nothing.
 */
interface ModuleAnnouncement {
  path: string;
  sha256: string;
  module: string;
  firstArg: string;
  index: number;
  at: number;
}

/** Every announcement in one session, in call order. */
function announcements(s: BundleSession): ModuleAnnouncement[] {
  const out: ModuleAnnouncement[] = [];
  s.calls.forEach((c, index) => {
    if (c.name !== "Bash" || c.result.isError) return;
    const run = toolkitModuleRun(cmdOf(c));
    if (!run) return;
    const lines = [...c.result.text.matchAll(ANNOUNCE)];
    if (lines.length !== 1 || !lines[0]![2]) return;
    out.push({ path: lines[0]![1]!, sha256: lines[0]![2]!, module: run.module, firstArg: run.args[0] ?? "", index, at: ms(c.at) });
  });
  return out;
}

/** Whether an announcement was printed by the writer of `kind` (its module, under its subcommand when it has one). */
function byWriter(kind: string, a: ModuleAnnouncement): boolean {
  const w = RECEIPT_WRITERS[kind];
  return w !== undefined && a.module === w.module && (w.subcommand === null || a.firstArg === w.subcommand);
}

/** Whether `a` announces `r`: the same path, the sha256 of the receipt file's bytes, printed by the writer of its kind. */
const announces = (a: ModuleAnnouncement, r: BundleReceipt): boolean => a.path === r.path && a.sha256 === r.sha256 && byWriter(r.kind, a);

/** The earliest time, in `s`, the writer of the receipt's kind announced it; undefined when it never did. */
function writerAnnouncedAt(s: BundleSession, r: BundleReceipt): number | undefined {
  const ats = announcements(s).filter((a) => announces(a, r)).map((a) => a.at);
  return ats.length > 0 ? Math.min(...ats) : undefined;
}

// --- the shapes the tracker-write hook compares (mirrored, never imported) ---

/** A create's comparable fields, read from a tool call's input or a create receipt's payload. */
interface CreateShape {
  project: string;
  team: string;
  title: string;
  labels: string[];
  /** The Jira parent or the Linear milestone the create binds; "" for none. */
  container: string;
}

const sameName = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();
const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
function asKey(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.key === "string") return o.key;
    if (typeof o.id === "string") return o.id;
  }
  return "";
}

function callShape(tracker: SharedTrackerId, input: Record<string, unknown>): CreateShape {
  const extra = (input.additional_fields && typeof input.additional_fields === "object" ? input.additional_fields : {}) as Record<string, unknown>;
  if (tracker === "jira") {
    return { project: str(input.projectKey), team: "", title: str(input.summary), labels: stringList(input.labels ?? extra.labels), container: asKey(input.parent) || asKey(extra.parent) };
  }
  return { project: str(input.project), team: str(input.team), title: str(input.title), labels: stringList(input.labels), container: asKey(input.milestone) };
}

function payloadShape(tracker: SharedTrackerId, p: Record<string, unknown>): CreateShape {
  return {
    project: str(p.project),
    team: str(p.team),
    title: tracker === "jira" ? str(p.summary) : str(p.title),
    labels: stringList(p.labels),
    container: asKey(tracker === "jira" ? p.parent : p.milestone),
  };
}

/** The hook's create comparison: project (and Linear team), normalized title, the target's tag plus the receipt's numeric labels, parent/milestone. */
function createMismatch(tracker: SharedTrackerId, call: CreateShape, receipt: CreateShape, tag: string): string | null {
  const projectDiffers =
    tracker === "jira" ? !sameName(call.project, receipt.project) : (call.project !== "" || receipt.project !== "") && !sameName(call.project, receipt.project);
  const teamDiffers = tracker === "linear" && call.team !== "" && receipt.team !== "" && !sameName(call.team, receipt.team);
  if (projectDiffers || teamDiffers) return `project "${call.project}" differs from the receipt's "${receipt.project}"`;
  if (normalizeTitleForCompare(call.title) !== normalizeTitleForCompare(receipt.title)) return `title "${call.title}" differs from the receipt's "${receipt.title}"`;
  const missing = [tag, ...receipt.labels.filter((l) => /^\d+$/.test(l))].filter((l) => !call.labels.includes(l));
  if (missing.length > 0) return `labels [${call.labels.join(", ")}] miss ${missing.join(", ")}`;
  if (!sameName(call.container, receipt.container)) return `${tracker === "jira" ? "parent" : "milestone"} "${call.container || "none"}" differs from the receipt's "${receipt.container || "none"}"`;
  return null;
}

/**
 * The hook's attach binding (STE-611): an `attach-target` receipt in the
 * create's project whose resolved surface binds the create's own milestone —
 * Jira: a parent must be the Epic a `parent` surface resolved; no parent needs
 * a `label` surface whose plan token's `milestone-<token>` label the create
 * carries. Linear: a milestone must be the id an `object` surface resolved, or
 * a name it answers to; no milestone is accepted on any resolved target.
 * Provenance (the decision an attach relied on) is the hook's to check at
 * write time and is not re-graded here.
 */
function attachBinds(tracker: SharedTrackerId, shape: CreateShape, r: BundleReceipt): boolean {
  const ev = r.evidence;
  const surface = str(ev.surface);
  if (surface === "" || !sameName(str(r.container), shape.project || shape.team)) return false;
  if (tracker === "jira") {
    if (shape.container !== "") return surface === "parent" && sameName(str(ev.key), shape.container);
    const token = basename(str(ev.planFile)).replace(/\.md$/, "");
    if (surface !== "label" || token === "") return false;
    try {
      return shape.labels.includes(milestoneLabel(token));
    } catch {
      return false;
    }
  }
  if (shape.container === "") return true;
  const id = surface === "object" ? str(ev.id) : "";
  const names = [ev.name, ev.milestoneName].filter((n): n is string => typeof n === "string" && n !== "");
  return (id !== "" && id === shape.container) || names.some((n) => sameName(n, shape.container));
}

/** A ticket key as the hook resolves one (`GF-123`, `STE-9`). */
const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
/** A ticket call's subject keys, as the hook reads them: both sides of a link, else the issue fields. */
function subjectKeys(c: ToolCall): string[] {
  const i = c.input;
  const vals = bareTool(c.name) === "createIssueLink" ? [i.inwardIssue, i.outwardIssue] : [i.issueIdOrKey, i.id, i.issueId, i.issue];
  return [...new Set(vals.map((v) => asKey(v).trim()).filter((k) => TICKET_KEY.test(k)).map((k) => k.toUpperCase()))];
}

/** How the hook classes a successful tracker write: a ticket create, a milestone-container create, another container write, or a ticket write. */
type WriteClass = "ticket-create" | "milestone-create" | "container" | "ticket";
function writeClass(c: ToolCall): WriteClass {
  const t = bareTool(c.name);
  if (t === "createJiraIssue") {
    const type = c.input.issueTypeName;
    return typeof type === "string" && type.trim().toLowerCase() === "epic" ? "milestone-create" : "ticket-create";
  }
  if (t === "save_issue" && hasNoId(c)) return "ticket-create";
  if (t === "save_milestone") return hasNoId(c) ? "milestone-create" : "container";
  if (t === "save_project" || /label/.test(t) || /status_update/.test(t) || t === "save_document") return "container";
  return "ticket";
}

/**
 * The times, in `s`, the operator consented to `label` (`Import DST-7`,
 * `Adopt DST-7`): an answered AskUserQuestion whose answer is that label, or
 * the first user message's answers block giving exactly that label under
 * `ORPHAN_CONSENT_ANSWER_KEY` (the route a `claude -p` child has, where an
 * AskUserQuestion comes back as an error). The block's value must EQUAL the
 * label — the hook's `consentLines` rule since D-8, which before it accepted
 * any value merely naming the key (so `Skip DST-7` read as consent). The hook
 * reads a block from any operator message; the grade reads only the first.
 */
function consentTimes(s: BundleSession, label: string): number[] {
  const out = s.calls.filter((c) => c.name === "AskUserQuestion" && !c.result.isError && c.result.text.includes(`="${label}"`)).map((c) => ms(c.at));
  if (s.answers?.[ORPHAN_CONSENT_ANSWER_KEY] === label && s.answersAt !== undefined) out.push(ms(s.answersAt));
  return out.filter((t) => !Number.isNaN(t));
}

/** Whether the question `label` answers (e.g. `Import DST-7`) was answered before call `index` of `s`. */
const answeredBefore = (s: BundleSession, index: number, label: string): boolean => {
  const at = s.calls[index] ? ms(s.calls[index]!.at) : Number.POSITIVE_INFINITY;
  return consentTimes(s, label).some((t) => t < at);
};

const rootOfPath = (p: string): Root | null => (/^<([AB])>\//.exec(p)?.[1] as Root | undefined) ?? null;

/**
 * The run-wide gated-write check (AC-STE-617.17's `ungated-write`, and
 * AC-STE-617.8's `receipts-unreadable`). In every session but the old
 * client's and the intruder's, each SUCCESSFUL tracker write of a kind the
 * tracker-write hook gates by receipt must follow, in that session, a run of
 * the named front door whose output announced a receipt that exists in the
 * decided-for repository and records the decision the write carries — the
 * fields the hook compares:
 *   - a ticket create: an unspent `create` receipt of the repository whose tag
 *     the create carries, matching its project, title, tag and parent or
 *     milestone (one receipt, one create), AND an `attach-target` receipt of
 *     that repository binding the create's milestone;
 *   - an Epic / `save_milestone` create: an unspent `milestone-decision` whose
 *     act is create, for the same project and the byte-equal title;
 *   - a write on a ticket key in the run's containers: the key is owned —
 *     created earlier in the session, bound by an FR file of the session's
 *     repository (or a repository it announced a receipt in), or named by a
 *     `reuse` receipt's key, a `binding` receipt's subject (an adopt only after
 *     the answered `Adopt <KEY>`), an `import` receipt's subject after the
 *     answered `Import <KEY>`, or (a Jira labels-only edit) a join decision's key.
 *   A consent (`Adopt <KEY>`, `Import <KEY>`) is an answered AskUserQuestion or
 *   the first user message's answers block giving exactly that label, before
 *   the announcing run (`answeredBefore`).
 * Other container writes (a project, a label, a status update, a document, a
 * milestone edit) are not gated by a receipt: the hook refuses them outright,
 * save the rows of `PERMITTED_CONTAINER_WRITES`. Each successful one no row
 * permits is `ungated-write`, whatever the state of the receipts.
 * A session that made receipt-gated writes against a repository whose receipts
 * are absent or unreadable aborts the run as `receipts-unreadable`, once per
 * repository; those writes are never graded as receipted.
 */
/**
 * The container-class writes the tracker-write hook permits in a declared
 * container, each with the reason the hook permits it (gateContainer). A
 * successful container write in a gated session that no row permits is
 * `ungated-write`. There is no receipt to ask for on any of these: the hook
 * decides them by rule, so the grade applies the same rule. Rows, not a
 * blanket exemption — an exemption with no written reason is how a class
 * goes back to being invisible.
 *
 * The Epic / `save_milestone`-without-id create is not here: it is class
 * `milestone-create`, graded against its `milestone-decision` receipt. A
 * container write outside the run's containers — which the hook would pass
 * under §3 — is not permitted either: no scenario writes one, and a run that
 * did left the spaces it was sanctioned to touch.
 */
/** A plain label create: not a label group and not nested under one (the hook refuses both). */
const plainLabel = (c: ToolCall): boolean => c.input.isGroup !== true && (c.input.parent === undefined || c.input.parent === null || c.input.parent === "");

const PERMITTED_CONTAINER_WRITES: ReadonlyArray<{ tool: string; permits: (c: ToolCall, b: LiveBundle) => boolean; reason: string }> = [
  {
    tool: "create_issue_label",
    permits: (c, b) => plainLabel(c) && typeof c.input.name === "string" && (["A", "B"] as const).some((r) => c.input.name === b.roots[r].tag),
    reason: "a repository creating its own repo-tag label: the hook permits a PLAIN label create (no group, no parent) whose name is a declared target's repo_tag, and no deciding command writes a receipt for it",
  },
  {
    tool: "save_issue_label",
    permits: (c, b) => (c.input.id === undefined || c.input.id === null || c.input.id === "") && plainLabel(c) && typeof c.input.name === "string" && (["A", "B"] as const).some((r) => c.input.name === b.roots[r].tag),
    reason: "the same repo-tag label create through the tool the Linear MCP steers to (it marks create_issue_label deprecated): with no `id` save_issue_label creates, and the hook permits it on the same rule; with an `id` it is a rename, which no row permits",
  },
];

function gatedWrites(b: LiveBundle): { aborts: LiveFinding[]; findings: LiveFinding[] } {
  const tracker = b.run.tracker;
  const aborts: LiveFinding[] = [];
  const findings: LiveFinding[] = [];
  const aborted = new Set<Root>();
  const abortFor = (root: Root, s: BundleSession): void => {
    if (aborted.has(root)) return;
    aborted.add(root);
    const set = b.repos[root].receipts;
    aborts.push({ code: "receipts-unreadable", session: s.sessionId, detail: `repository <${root}>'s receipts cannot be read (${set.readable ? "" : set.error}) while its sessions made gated writes` });
  };
  /** Keys in the run's containers: a Jira key of the shared or the repoint-from space; every Linear key (one team). */
  const inRunContainers = (k: string): boolean =>
    tracker === "linear" || [b.run.container, b.run.repointFrom ?? ""].some((c) => c !== "" && sameName(c, k.slice(0, k.lastIndexOf("-"))));

  for (const s of b.sessions) {
    if (UNGATED_CLIENTS.includes(s.client)) continue;
    for (const c of s.calls) {
      if (!isTrackerWrite(c) || c.result.isError || writeClass(c) !== "container") continue;
      if (PERMITTED_CONTAINER_WRITES.some((p) => bareTool(c.name) === p.tool && p.permits(c, b))) continue;
      findings.push({
        code: "ungated-write",
        ...(SHARED_TRACKER_SCENARIO_IDS.includes(s.marker) ? { scenario: s.marker } : {}),
        session: s.sessionId,
        tool: c.name,
        detail: `${c.ref}: a successful ${bareTool(c.name)} — a container write the tracker-write hook refuses in a declared container, and no PERMITTED_CONTAINER_WRITES row permits it`,
      });
    }
    const writes = s.calls.map((c, i) => ({ c, i })).filter(({ c }) => isTrackerWrite(c) && !c.result.isError && writeClass(c) !== "container");
    if (writes.length === 0) continue;
    if (!b.repos[s.root].receipts.readable) {
      abortFor(s.root, s);
      continue;
    }
    const ann = announcements(s);
    /** The receipt of `kind` that `a` announces, or null; an unreadable decided-for repository aborts. */
    const receiptOf = (a: ModuleAnnouncement, kind: string): BundleReceipt | null => {
      if (!byWriter(kind, a)) return null;
      const root = rootOfPath(a.path);
      if (root === null) return null;
      const set = b.repos[root].receipts;
      if (!set.readable) {
        abortFor(root, s);
        return null;
      }
      return set.records.find((r) => r.kind === kind && r.adapter === tracker && r.sessionId === s.sessionId && announces(a, r)) ?? null;
    };
    const spent = new Set<string>();
    const created = new Set<string>();
    for (const { c, i } of writes) {
      const before = ann.filter((a) => a.index < i);
      const cls = writeClass(c);
      let why: string | null = null;
      if (cls === "ticket-create") {
        const shape = callShape(tracker, c.input);
        const tagged = (["A", "B"] as const).filter((r) => shape.labels.includes(b.roots[r].tag));
        if (tagged.length !== 1) {
          why = `create carries ${tagged.length === 0 ? "no" : "more than one"} repository tag, so no repository decided it`;
        } else {
          const root = tagged[0]!;
          const mine = before.filter((a) => rootOfPath(a.path) === root);
          const receipt = mine
            .map((a) => receiptOf(a, "create"))
            .find((r) => r !== null && !spent.has(r.path) && createMismatch(tracker, shape, payloadShape(tracker, (r.evidence.createPayload ?? {}) as Record<string, unknown>), b.roots[root].tag) === null);
          if (!receipt) why = `create of "${shape.title}" follows no unspent create receipt announced by create_idempotency_probe.ts decide in <${root}> that records its project, title, tag and ${tracker === "jira" ? "parent" : "milestone"}`;
          else {
            spent.add(receipt.path);
            if (!mine.some((a) => {
              const r = receiptOf(a, "attach-target");
              return r !== null && attachBinds(tracker, shape, r);
            })) why = `create of "${shape.title}" follows no attach-target receipt announced by attach_project_milestone.ts in <${root}> that resolved the container it binds`;
          }
        }
      } else if (cls === "milestone-create") {
        const project = tracker === "jira" ? str(c.input.projectKey) : str(c.input.project);
        const name = tracker === "jira" ? str(c.input.summary) : str(c.input.name);
        const decision = before
          .map((a) => receiptOf(a, "milestone-decision"))
          .find((r) => r !== null && !spent.has(r.path) && r.evidence.act === "create" && sameName(str(r.container), project) && str(r.evidence.title) === name);
        if (!decision) why = `milestone-container create of "${name}" in ${project} follows no unspent create decision announced by resolve_milestone_identity.ts for that project and title`;
        else spent.add(decision.path);
      } else {
        const keys = subjectKeys(c).filter(inRunContainers);
        if (subjectKeys(c).length === 0) why = "ticket write names no ticket key the hook could resolve";
        else if (keys.length > 0) {
          const roots = new Set<Root>([s.root, ...before.map((a) => rootOfPath(a.path)).filter((r): r is Root => r !== null)]);
          const labelsOnly = bareTool(c.name) === "editJiraIssue" && Object.keys((c.input.fields ?? {}) as object).every((k) => k === "labels");
          const owned = (k: string): boolean => {
            if (created.has(k)) return true;
            if ([...roots].some((r) => b.repos[r].frBindings.some((f) => f.key.toUpperCase() === k))) return true;
            return before.some((a) => {
              const reuse = receiptOf(a, "reuse");
              if (reuse && str(reuse.evidence.key).toUpperCase() === k) return true;
              const bind = receiptOf(a, "binding");
              if (bind && bind.subject.toUpperCase() === k && (bind.decision !== "adopt" || answeredBefore(s, a.index, `Adopt ${k}`))) return true;
              const imp = receiptOf(a, "import");
              if (imp && imp.subject.toUpperCase() === k && answeredBefore(s, a.index, `Import ${k}`)) return true;
              const join = tracker === "jira" && labelsOnly ? receiptOf(a, "milestone-decision") : null;
              return join !== null && join.evidence.act === "join" && str(join.evidence.key).toUpperCase() === k;
            });
          };
          const ok = bareTool(c.name) === "createIssueLink" ? keys.some(owned) : keys.every(owned);
          if (!ok) why = `write on ${keys.join(", ")} follows no receipt, creation or FR binding in this session that makes the key its repository's`;
        }
      }
      if (cls === "ticket-create" || cls === "milestone-create") for (const k of itemKeys(c)) created.add(k.toUpperCase());
      if (why !== null) {
        findings.push({
          code: "ungated-write",
          ...(SHARED_TRACKER_SCENARIO_IDS.includes(s.marker) ? { scenario: s.marker } : {}),
          session: s.sessionId,
          tool: c.name,
          detail: `${c.ref}: a successful ${why}`,
        });
      }
    }
  }
  return { aborts, findings };
}

/**
 * AC-STE-617.17 — a tracker receipt (adapter set; gate receipts carry none)
 * on disk that its kind's writer (`RECEIPT_WRITERS`) announced in no run in
 * the bundle — with the sha256 of the receipt file's own bytes — fails as
 * `unannounced-receipt`. An announcement by any other module, by its module
 * under another subcommand, by a command that is not one plain module run, or
 * naming other bytes counts for nothing, and a kind with no writer in the map
 * is never announced. Receipts written by the old client's or the intruder's
 * sessions are exempt, as for `ungated-write`. A repository whose receipts
 * cannot be read contributes none (`readableReceipts`).
 */
function unannouncedReceipts(b: LiveBundle): LiveFinding[] {
  const exempt = new Set(b.sessions.filter((s) => UNGATED_CLIENTS.includes(s.client)).map((s) => s.sessionId));
  const all = b.sessions.flatMap(announcements);
  const out: LiveFinding[] = [];
  for (const r of readableReceipts(b)) {
    if (r.adapter === null || exempt.has(r.sessionId)) continue;
    if (all.some((a) => announces(a, r))) continue;
    const w = RECEIPT_WRITERS[r.kind];
    const writer = w ? `${w.module}${w.subcommand ? ` ${w.subcommand}` : ""}` : "no known writer";
    out.push({ code: "unannounced-receipt", session: r.sessionId, item: r.path, detail: `tracker receipt ${r.path} (${r.kind}) was not announced by its writer (${writer}) with the sha256 of its bytes` });
  }
  return out;
}

/**
 * AC-STE-617.17 (MI-5) — every milestone-decision receipt's listing must equal
 * (as a key set) the answer of a tracker listing call recorded as its LAST
 * page, in the receipt's own session, before its writer's run announced it
 * (`RECEIPT_WRITERS`). "Last" is the reader's (tracker_answer.ts, via
 * `projectAnswer`): a Jira page saying so, or a Linear `list_milestones`
 * answer — which carries no paging field — holding fewer than
 * `LINEAR_MILESTONE_WINDOW` rows; a full window is unknown, so a decision on
 * it is unlisted. A repository whose receipts cannot be read contributes none
 * (`readableReceipts`).
 */
function unlistedDecisions(b: LiveBundle): LiveFinding[] {
  const out: LiveFinding[] = [];
  const sameKeys = (a: string[], c: string[]): boolean => {
    const x = [...new Set(a)].sort();
    const y = [...new Set(c)].sort();
    return x.length === y.length && x.every((k, i) => k === y[i]);
  };
  for (const r of readableReceipts(b)) {
    if (r.kind !== "milestone-decision" || r.adapter === null) continue;
    const listing = r.evidence.listing as { rowKeys?: unknown } | undefined;
    const rowKeys = Array.isArray(listing?.rowKeys) ? listing.rowKeys.map(str) : null;
    const s = b.sessions.find((x) => x.sessionId === r.sessionId);
    const until = s ? (writerAnnouncedAt(s, r) ?? Number.POSITIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    const listed =
      rowKeys !== null &&
      (s?.calls ?? []).some(
        (c) =>
          isTrackerTool(c.name) &&
          !isTrackerWrite(c) &&
          !c.result.isError &&
          c.result.lastPage === true &&
          ms(c.at) < until &&
          sameKeys((c.result.items ?? []).map((i) => i.key), rowKeys),
      );
    if (!listed) out.push({ code: "unlisted-decision", session: r.sessionId, item: r.path, detail: `milestone decision ${r.path} names a listing no earlier last-page listing in its session answered` });
  }
  return out;
}

/**
 * The audit rules one audit session's nonce query is held to: every issue
 * search it ran is byte-equal to the fence's `auditQuery`, and at least one
 * reached its last page (a page PROVEN last: `lastPage === true`). Findings
 * carry `code`, so the first audit aborts as `audit-incomplete` and the second
 * fails as `teardown-incomplete`.
 */
function nonceQueryFindings(b: LiveBundle, audit: BundleSession, code: string, which: string): LiveFinding[] {
  const search = b.run.tracker === "jira" ? "searchJiraIssuesUsingJql" : "list_issues";
  const queryOf = (c: ToolCall): unknown => (b.run.tracker === "jira" ? c.input.jql : c.input.query);
  const runs = audit.calls.filter((c) => isTrackerTool(c.name) && bareTool(c.name) === search);
  const out: LiveFinding[] = [];
  for (const c of runs) {
    if (queryOf(c) !== b.run.auditQuery) out.push({ code, session: audit.sessionId, tool: c.name, detail: `${c.ref}: the ${which} query ${JSON.stringify(queryOf(c))} is not the fence's ${JSON.stringify(b.run.auditQuery)}` });
  }
  if (!runs.some((c) => !c.result.isError && c.result.lastPage === true)) {
    out.push({ code, session: audit.sessionId, detail: `the ${which}'s nonce query never reached its last page` });
  }
  return out;
}

/**
 * AC-STE-617.17 — the first audit's nonce query must be byte-equal to the
 * fence's and reach its last page (`nonceQueryFindings`), and its reads must
 * hold every item a registry scenario's session created (the intruder's items
 * are graded by `isolation-broken` instead). Otherwise the run aborts as
 * `audit-incomplete`.
 */
function auditIncomplete(b: LiveBundle): LiveFinding[] {
  const first = sessionsMarked(b, "audit")[0];
  if (!first) return [{ code: "audit-incomplete", detail: "no audit session was recorded" }];
  const out = nonceQueryFindings(b, first, "audit-incomplete", "audit");
  const read = auditItems(b);
  for (const k of createdBy(b.sessions.filter((s) => SHARED_TRACKER_SCENARIO_IDS.includes(s.marker)))) {
    if (!read.has(k)) out.push({ code: "audit-incomplete", session: first.sessionId, item: k, detail: `the audit never read ${k}, which a scenario created` });
  }
  return out;
}

/**
 * AC-STE-617.17, fail closed — an item either audit read without an answer
 * field its kind requires (`REQUIRED_ANSWER_FIELDS`: a Jira issue's project,
 * labels or status; a Linear issue's id, title, labels, status or project; a
 * Linear project's name or status) aborts the run as `audit-incomplete`,
 * naming the item and the field. Such an item is never skipped by a
 * predicate, never counted as untagged, never read as in no container.
 */
function auditFieldsAbsent(b: LiveBundle): LiveFinding[] {
  const out: LiveFinding[] = [];
  sessionsMarked(b, "audit").forEach((audit, n) => {
    const which = n === 0 ? "first audit" : n === 1 ? "second audit" : `audit #${n + 1}`;
    for (const c of audit.calls) {
      if (!isTrackerTool(c.name) || c.result.isError) continue;
      for (const i of c.result.items ?? []) {
        for (const field of i.absent ?? []) {
          out.push({ code: "audit-incomplete", session: audit.sessionId, item: i.key || "(no key)", tool: c.name, detail: `${c.ref}: the ${which} read ${i.key || "an item"} without its ${field} field, so no predicate can grade it` });
        }
      }
    }
  });
  return out;
}

/** Whether an item's key names a tracker space by its prefix (`DST-7`, `STE-9`): every Jira item but a project; a Linear issue. */
const spaceKeyed = (tracker: SharedTrackerId, i: TrackerItem): boolean => (tracker === "jira" ? i.kind !== "project" : i.kind === "issue");

/**
 * The space-keyed item keys (`spaceKeyed`) in any answer of the bundle that
 * are not `<SPACE>-<n>`, or whose space is not one of `spaces` (compared
 * case-insensitively); with `spaces` null only the shape is checked. The ONE
 * definition: the grade (`itemsOutsideSpaces`, the run's own spaces) and
 * STE-618's live-proof gate (the plan row's `Spaces`) both call it, so a
 * bundle the grade passes cannot fail the gate's not-live key check on an
 * item the grade never looked at (a project or milestone read by name, or an
 * unkeyed answer) — and an unkeyed issue fails both.
 */
export function keysOutsideSpaces(b: LiveBundle, spaces: readonly string[] | null): string[] {
  const allowed = spaces === null ? null : new Set(spaces.map((x) => x.toUpperCase()));
  const out = new Set<string>();
  for (const s of b.sessions ?? []) {
    for (const c of s.calls ?? []) {
      for (const i of c.result?.items ?? []) {
        if (!spaceKeyed(b.run.tracker, i)) continue;
        const m = /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(i.key);
        if (!m || (allowed !== null && !allowed.has(m[1]!.toUpperCase()))) out.add(i.key === "" ? "(no key)" : i.key);
      }
    }
  }
  return [...out].sort();
}

/** The run's own spaces: the Jira shared and repoint-from keys; the Linear team (null — shape only — when the run recorded none). */
function runSpaces(b: LiveBundle): string[] | null {
  if (b.run.tracker === "jira") return [b.run.container, ...(b.run.repointFrom ? [b.run.repointFrom] : [])];
  return b.run.linearTeam ? [b.run.linearTeam] : null;
}

/** A space-keyed item whose key is unreadable or outside the run's spaces fails `item-outside-spaces`. */
function itemsOutsideSpaces(b: LiveBundle): LiveFinding[] {
  const spaces = runSpaces(b);
  return keysOutsideSpaces(b, spaces).map((k) => ({
    code: "item-outside-spaces",
    item: k,
    detail: `a ${b.run.tracker} answer names ${k}, which is not a key of the run's spaces (${spaces === null ? "any <SPACE>-<n>" : spaces.join(", ")})`,
  }));
}

/**
 * A successful create whose answer names no key (no parsable answer, no item,
 * or an empty key) would vanish from audit completeness, the Linear budget and
 * teardown: the run aborts as `create-key-unreadable` naming the call.
 */
function createKeyUnreadable(b: LiveBundle): LiveFinding[] {
  const out: LiveFinding[] = [];
  for (const s of b.sessions) {
    for (const c of s.calls.filter(isCreate)) {
      const items = c.result.items ?? [];
      if (items.length > 0 && items.every((i) => i.key !== "")) continue;
      out.push({ code: "create-key-unreadable", session: s.sessionId, tool: c.name, detail: `${c.ref}: a successful create whose answer names no created key` });
    }
  }
  return out;
}

/**
 * The run-wide isolation check (AC-STE-617.12): neither the old client's
 * plugin set nor the intruder's carries the tracker-write hook, so any
 * PreToolUse hook error on one of their tracker writes, however it is worded,
 * means the isolation broke; and the
 * intruder's items must be present in the first audit's read-back.
 */
function isolationBroken(b: LiveBundle): LiveFinding[] {
  const out: LiveFinding[] = [];
  for (const s of b.sessions) {
    if (!UNGATED_CLIENTS.includes(s.client)) continue;
    for (const c of s.calls) {
      if (!isTrackerTool(c.name)) continue;
      if (!anyHookError(c)) continue;
      const hook = hookRefusal(c);
      out.push({ code: "isolation-broken", session: s.sessionId, tool: c.name, detail: `${c.ref}: a ${s.client} write was refused by ${hook ? `the ${hook} hook` : "a PreToolUse hook"}, which its plugin set does not carry` });
    }
  }
  if (sessionsMarked(b, "audit").length > 0) {
    const read = auditItems(b);
    for (const s of sessionsMarked(b, "intruder")) {
      for (const k of createdBy([s])) {
        if (!read.has(k)) out.push({ code: "isolation-broken", session: s.sessionId, detail: `the intruder's ${k} is absent from the audit` });
      }
    }
  }
  return out;
}

/** The plugin root this module ships in (`adapters/_shared/src` → three levels up). */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** The tracker-write hook's registration — the file whose matcher the live hook really runs under. */
const DEFAULT_HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");
/**
 * STE-607's tool inventory, with STE-616's per-tool class. It is production
 * data under `adapters/_shared/data/`, INSIDE the behaviour digest, and it is
 * there because this module reads it at runtime: an instrument the proof does
 * not fingerprint could loosen the grade without staling the proof. The live
 * grade and the offline tests read this one file, so they cannot disagree
 * about a tool.
 */
const DEFAULT_INVENTORY = join(PLUGIN_ROOT, "adapters", "_shared", "data", "tracker-tool-inventory.json");

/** The PreToolUse matchers of the tracker-write gate (the entry whose command runs `pre-tracker-write-gate`). */
function trackerWriteMatchers(path: string): RegExp[] {
  const j = JSON.parse(readFileSync(path, "utf-8")) as { hooks?: { PreToolUse?: { matcher?: unknown; hooks?: { command?: unknown }[] }[] } };
  return (j.hooks?.PreToolUse ?? [])
    .filter((e) => typeof e.matcher === "string" && (e.hooks ?? []).some((h) => /pre-tracker-write-gate/.test(String(h.command ?? ""))))
    .map((e) => new RegExp(e.matcher as string));
}

type InventoryClass = "read" | "gated-write" | "out-of-scope";

/**
 * `<server family>/<bare tool>` → its inventoried class. The family is the
 * inventory's server key (`atlassian`, `linear`); a live server name carries
 * it in any spelling (`mcp__claude_ai_Atlassian__…`), as `isTrackerTool` reads it.
 * A tool listed with no classification gets NO class, so it is graded
 * `unclassified-tool` like an absent one — never defaulted to a read, which
 * would let a new write tool pass unregistered.
 */
function inventoryClasses(path: string): Map<string, InventoryClass> {
  const j = JSON.parse(readFileSync(path, "utf-8")) as {
    servers: Record<string, { tools: string[]; classification?: Record<string, { class: InventoryClass }> }>;
  };
  const out = new Map<string, InventoryClass>();
  for (const [family, srv] of Object.entries(j.servers)) {
    for (const t of srv.tools) {
      const cls = srv.classification?.[t]?.class;
      if (cls !== undefined) out.set(`${family}/${t}`, cls);
    }
  }
  return out;
}

/** The inventory key of a tracker tool call's name, or null when its server names no known family. */
function inventoryKey(name: string): string | null {
  const server = serverOf(name);
  const family = /atlassian/i.test(server) ? "atlassian" : /linear/i.test(server) ? "linear" : null;
  return family ? `${family}/${bareTool(name)}` : null;
}

/**
 * AC-STE-617.13 — every observed tracker tool is in the STE-607 inventory
 * (else `unclassified-tool`), and every observed inventoried write is matched
 * by the tracker-write hook's `hooks.json` matcher (else `unregistered-write-tool`).
 */
function toolRegistration(b: LiveBundle, hooksJsonPath: string, inventoryPath: string): { aborts: LiveFinding[]; findings: LiveFinding[] } {
  // The instrument could not be read: a named abort naming the file, never a
  // crash and never a pass that skipped the registration and classification checks.
  const unreadable = (path: string, e: unknown) => ({ aborts: [{ code: "tool-registration-unreadable", detail: `${path} cannot be read or parsed (${(e as Error).message}), so no observed tracker tool could be checked against it` }], findings: [] });
  let matchers: RegExp[];
  let classes: Map<string, InventoryClass>;
  try {
    matchers = trackerWriteMatchers(hooksJsonPath);
  } catch (e) {
    return unreadable(hooksJsonPath, e);
  }
  try {
    classes = inventoryClasses(inventoryPath);
  } catch (e) {
    return unreadable(inventoryPath, e);
  }
  const out: LiveFinding[] = [];
  const seen = new Set<string>();
  for (const s of b.sessions) {
    for (const c of s.calls) {
      if (!isTrackerTool(c.name) || seen.has(c.name)) continue;
      seen.add(c.name);
      const key = inventoryKey(c.name);
      const cls = key === null ? undefined : classes.get(key);
      if (cls === undefined) {
        out.push({ code: "unclassified-tool", session: s.sessionId, tool: c.name, detail: `${c.ref}: ${c.name} is absent from the tracker tool inventory, or listed there with no class` });
      } else if (cls === "gated-write" && !matchers.some((m) => m.test(c.name))) {
        out.push({ code: "unregistered-write-tool", session: s.sessionId, tool: c.name, detail: `${c.ref}: write tool ${c.name} is not matched by the tracker-write hook's matcher` });
      }
    }
  }
  return { aborts: [], findings: out };
}

/**
 * AC-STE-617.15 — teardown is graded from the second audit. Its nonce query
 * is held to the first audit's rules (byte-equal to the fence's, paged to a
 * page proven last). On Jira it must read back every item any session of the
 * run created, and every nonce item (Epics included) in the shared space and,
 * when given, the repoint-from space must read Done — a second audit that
 * read nothing proves nothing Done, and an item read without its container
 * is never skipped as out of scope. On Linear both throwaway projects must be
 * read (`get_project`, projected as `kind: "project"`) and read as completed
 * (the status `type`, whatever the state is named). Each failure is `teardown-incomplete`. Once the
 * run's tracker writes exist (a successful create by any session), a bundle
 * with no second audit fails, naming the missing audit: a teardown never read
 * back is not proven. Before the first write, teardown is not owed and
 * nothing is graded here.
 */
function teardownIncomplete(b: LiveBundle): LiveFinding[] {
  const second = sessionsMarked(b, "audit")[1];
  if (!second) {
    const creates = b.sessions.flatMap((s) => s.calls.filter(isCreate));
    if (creates.length === 0) return [];
    return [{ code: "teardown-incomplete", item: "second audit", detail: `the run made ${creates.length} successful tracker creates (first ${creates[0]!.ref}) but no second audit was recorded, so its teardown is unproven` }];
  }
  const scope = [b.run.container, ...(b.run.repointFrom ? [b.run.repointFrom] : [])];
  const read = new Map<string, TrackerItem>();
  for (const c of second.calls) for (const i of c.result.items ?? []) read.set(`${i.kind}:${i.key}`, i);
  const out: LiveFinding[] = nonceQueryFindings(b, second, "teardown-incomplete", "second audit");
  if (b.run.tracker === "jira") {
    const readKeys = new Set([...read.values()].map((i) => i.key));
    for (const k of new Set(createdBy(b.sessions))) {
      if (!readKeys.has(k)) out.push({ code: "teardown-incomplete", session: second.sessionId, item: k, detail: `the second audit never read back ${k}, which the run created` });
    }
    for (const i of read.values()) {
      // Only an item PROVEN to sit in another container is out of scope; one read
      // without its container (or its status) is never skipped as Done.
      if (i.kind === "project" || (i.container !== "" && !scope.includes(i.container)) || (i.status !== "" && /^done$/i.test(i.status))) continue;
      out.push({ code: "teardown-incomplete", item: i.key, detail: `the second audit still reads ${i.key} "${i.summary}" in ${i.container || "(no container read)"} as ${i.status || "(no status read)"}` });
    }
    return out;
  }
  for (const name of scope) {
    const p = [...read.values()].find((i) => i.kind === "project" && (i.summary === name || i.key === name));
    if (!p) out.push({ code: "teardown-incomplete", item: name, detail: `the second audit never read throwaway project ${name}` });
    else if (!/^completed$/i.test(p.status)) out.push({ code: "teardown-incomplete", item: name, detail: `the second audit reads throwaway project ${name} as ${p.status}, not completed` });
  }
  return out;
}

/**
 * The Linear team conjunct, shown live rather than inferred. With no team in a
 * repository's binding the create decision's query carries no team conjunct,
 * so the identifier-prefix team rule cannot fire; a pass used to imply the
 * guard was live only because Linear rejects a create without `team`, an
 * invariant outside the toolkit. So every Linear create decision's recorded
 * payload must carry the run's team (`--linear-team`), and a run that recorded
 * no create decision never showed the guard live at all.
 */
function teamConjunctInert(b: LiveBundle): LiveFinding[] {
  if (b.run.tracker !== "linear") return [];
  const want = b.run.linearTeam;
  const creates = (["A", "B"] as const).flatMap((r) => {
    const set = b.repos[r].receipts;
    return set.readable ? set.records.filter((x) => x.kind === "create" && x.adapter === "linear") : [];
  });
  if (creates.length === 0) return [{ code: "team-conjunct-inert", detail: "no Linear create decision is recorded, so the team conjunct was never shown live" }];
  const out: LiveFinding[] = [];
  for (const r of creates) {
    const p = r.evidence.createPayload;
    const team = p && typeof p === "object" ? (p as Record<string, unknown>).team : undefined;
    if (typeof team !== "string" || team === "" || (want !== null && team !== want)) {
      out.push({ code: "team-conjunct-inert", session: r.sessionId, detail: `${r.path}: the create decision's payload carries team ${JSON.stringify(team ?? null)}, not the run's team ${JSON.stringify(want)} — its query ran without the team conjunct` });
    }
  }
  return out;
}

export function gradeBundle(b: LiveBundle, o: GradeOptions): LiveVerdict {
  const gw = gatedWrites(b);
  const budget = linearBudget(b);
  const lb = linearBudgetFindings(b, budget);
  const reg = toolRegistration(b, o.hooksJsonPath ?? DEFAULT_HOOKS_JSON, o.inventoryPath ?? DEFAULT_INVENTORY);
  const aborts = [...spawnOverrun(b), ...missingSessions(b), ...noScenarios(b), ...pluginChanged(b, o.behaviourDigestNow), ...gw.aborts, ...lb.aborts, ...auditIncomplete(b), ...auditFieldsAbsent(b), ...createKeyUnreadable(b), ...reg.aborts];
  const findings: LiveFinding[] = [
    ...gw.findings,
    ...unannouncedReceipts(b),
    ...unlistedDecisions(b),
    ...lb.findings,
    ...isolationBroken(b),
    ...teardownIncomplete(b),
    ...itemsOutsideSpaces(b),
    ...teamConjunctInert(b),
    ...reg.findings,
  ];
  for (const s of b.unledgeredSessions ?? []) {
    findings.push({ code: "unledgered-session", session: s, detail: `session ${s} ran in a throwaway repository but the run ledger does not name it` });
  }
  const scenarios = gradeScenarios(b);
  const failed = Object.values(scenarios).some((s) => s.outcome === "fail" || s.outcome === "not-observed");
  const outcome: SmokeOutcome = aborts.length > 0 ? "abort" : findings.length > 0 || failed ? "fail" : "pass";
  return {
    outcome,
    findings: [...aborts, ...findings],
    scenarios,
    runId: b.run.runId,
    nonce: b.run.nonce,
    tracker: b.run.tracker,
    pluginVersion: b.run.pluginVersion,
    behaviourDigest: b.run.behaviourDigest,
    graderDigest: graderDigest(),
    linearBudget: budget,
    assertedCompleteness: b.run.skips?.some((k) => k.id === "S8") ? null : assertedInputs(declarationReceipt(b, sessionsMarked(b, "S8"))?.receipt ?? null),
  };
}

// ---------------------------------------------------------------------------
// privacy (AC.16)
// ---------------------------------------------------------------------------

export interface PrivacyViolation {
  pattern: string;
  value: string;
  where: string;
}

const PRIVACY_PATTERNS: ReadonlyArray<{ pattern: string; re: RegExp }> = [
  { pattern: "email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { pattern: "Atlassian account id (24 hex)", re: /(?<![0-9A-Fa-f])[0-9a-f]{24}(?![0-9A-Fa-f])/g },
  { pattern: "Atlassian account id (prefixed)", re: /\b\d{6}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g },
  { pattern: "*.atlassian.net site host", re: /\b[A-Za-z0-9-]+\.atlassian\.net\b/g },
  { pattern: "linear.app/<workspace>", re: /\blinear\.app\/[A-Za-z0-9_-]+/g },
  { pattern: "/Users/<name>", re: /\/Users\/[^/\s"'`]+/g },
  { pattern: "/home/<name>", re: /\/home\/[^/\s"'`]+/g },
];

export function privacyViolations(b: unknown): PrivacyViolation[] {
  const out: PrivacyViolation[] = [];
  const visit = (v: unknown, where: string) => {
    if (typeof v === "string") {
      for (const p of PRIVACY_PATTERNS) for (const m of v.matchAll(p.re)) out.push({ pattern: p.pattern, value: m[0], where });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${where}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        visit(k, `${where}{key}`);
        visit(x, `${where}.${k}`);
      }
    }
  };
  visit(b, "$");
  return out;
}

// ---------------------------------------------------------------------------
// the behaviour digest (STE-617, STE-618)
// ---------------------------------------------------------------------------

export type BehaviourDigestResult =
  | { ok: true; digest: string; files: Record<string, string> }
  | { ok: false; reason: "digest-unavailable"; message: string };

const MANIFEST = ".claude-plugin/plugin.json";
const VERSION_FIELD = /("version"\s*:\s*)"[^"]*"/;
const VERSION_PLACEHOLDER = '"version": "<version>"';

/** A tracked file that describes behaviour: not under `tests/`, not a colocated `*.test.ts`. */
const countsForBehaviour = (p: string): boolean => !p.startsWith("tests/") && !p.endsWith(".test.ts");

/**
 * The plugin's behaviour digest — the ONE definition (STE-617, STE-618): a
 * SHA-256 per git-tracked file under `pluginRoot`, read from the working
 * copy, except `tests/` and colocated `*.test.ts`, plus one digest over the
 * sorted list. `.claude-plugin/plugin.json` is hashed with its `version`
 * value replaced by a fixed placeholder, so a version bump alone never moves
 * it. Untracked and ignored files never count. A root that is not a git
 * checkout is hashed over `opts.trackedFiles` (the tracked-file list of the
 * checkout it was copied from); with no list it refuses `digest-unavailable`.
 */
export function behaviourDigest(pluginRoot: string, opts: { trackedFiles?: readonly string[] } = {}): BehaviourDigestResult {
  let tracked: string[];
  if (opts.trackedFiles !== undefined) {
    tracked = opts.trackedFiles.map((p) => p.trim()).filter(Boolean);
  } else {
    const out = git(pluginRoot, ["ls-files", "-z"]);
    if (out === null) return { ok: false, reason: "digest-unavailable", message: `${pluginRoot} is not a git checkout and no tracked-file list was given` };
    tracked = out.split("\0").filter(Boolean);
  }
  const paths = [...new Set(tracked.filter(countsForBehaviour))].sort();
  if (paths.length === 0) return { ok: false, reason: "digest-unavailable", message: `${pluginRoot} has no tracked files to digest` };
  const files: Record<string, string> = {};
  for (const p of paths) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(pluginRoot, p));
    } catch (e) {
      return { ok: false, reason: "digest-unavailable", message: `tracked file ${p} cannot be read: ${(e as Error).message}` };
    }
    const body = p === MANIFEST ? bytes.toString("utf-8").replace(VERSION_FIELD, VERSION_PLACEHOLDER) : bytes;
    files[p] = createHash("sha256").update(body).digest("hex");
  }
  const digest = createHash("sha256")
    .update(paths.map((p) => `${files[p]}  ${p}\n`).join(""))
    .digest("hex");
  return { ok: true, digest, files };
}

// ---------------------------------------------------------------------------
// the committed evidence bundle (AC.16)
// ---------------------------------------------------------------------------

/** The bundle's record file; the directory also holds `grade`'s `verdict.json`. */
export const BUNDLE_FILE = "bundle.json";
/** The verdict `grade` writes beside `bundle.json` by default; STE-618's live-proof gate reads the recorded outcome and scenario set from it. */
export const VERDICT_FILE = "verdict.json";
/** The committed bundle is exactly these two files; any other file in the directory is not part of it. */
export const BUNDLE_FILES: readonly string[] = [BUNDLE_FILE, VERDICT_FILE];

export type WriteBundleResult = { ok: true; path: string } | { ok: false; reason: "privacy"; violations: PrivacyViolation[] };

/**
 * Write through a sibling temp file and rename over the target (the house
 * pattern, as `token_usage.ts` writes its ledger): an interrupted write leaves
 * the old file or the new one, never a truncated file at the committed path.
 */
function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * Write `b` to `<dir>/bundle.json`. A bundle holding any privacy pattern is
 * refused before anything touches the disk: no directory, no file.
 */
export function writeEvidenceBundle(b: LiveBundle, dir: string): WriteBundleResult {
  const violations = privacyViolations(b);
  if (violations.length > 0) return { ok: false, reason: "privacy", violations };
  const path = join(dir, BUNDLE_FILE);
  atomicWrite(path, `${JSON.stringify(b, null, 2)}\n`);
  return { ok: true, path };
}

/**
 * Write the verdict artifact `v` to `path` (in a live run, `<bundle dir>/verdict.json`,
 * which is committed beside `bundle.json`). A verdict holding any privacy
 * pattern is refused exactly as `writeEvidenceBundle` refuses a bundle:
 * nothing touches the disk.
 */
export function writeVerdictFile(v: unknown, path: string): WriteBundleResult {
  const violations = privacyViolations(v);
  if (violations.length > 0) return { ok: false, reason: "privacy", violations };
  atomicWrite(path, `${JSON.stringify(v, null, 2)}\n`);
  return { ok: true, path };
}

/**
 * The bundle's content hash — the ONE definition (STE-618): a SHA-256 over
 * one line per file of `BUNDLE_FILES` (`bundle.json`, `verdict.json`), in that
 * sorted order — `<sha256(file)>  <name>\n`, or `absent  <name>\n` when the
 * file is missing. Nothing else in the directory counts, so a stray file (a
 * `.DS_Store`, an ignored note) never makes a local tree and a clean clone
 * disagree; one changed byte in either defined file always moves it. The
 * plan's `### Live proof` row records it and `live_proof_gate.ts` recomputes it.
 */
export function bundleHash(dir: string): string {
  const lines = [...BUNDLE_FILES].sort().map((name) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      return `absent  ${name}\n`;
    }
    return `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`;
  });
  return createHash("sha256").update(lines.join("")).digest("hex");
}

export interface BundleScan {
  scanned: number;
  status: "no-bundles-yet" | "scanned";
  violations: PrivacyViolation[];
}

/**
 * Scan every `<root>/<bundle dir>/` file of `BUNDLE_FILES` — `bundle.json` and
 * the committed `verdict.json` beside it. A directory holding either counts as
 * one scanned bundle. Zero bundles — the root absent or empty — is
 * `no-bundles-yet`, never a pass; the release gate is what makes zero a
 * failure. Each violation's `where` names the file it was found in; a file
 * that is not JSON is scanned as text.
 */
export function scanCommittedBundles(root: string): BundleScan {
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    entries = [];
  }
  let scanned = 0;
  const violations: PrivacyViolation[] = [];
  for (const name of entries) {
    const present = BUNDLE_FILES.filter((f) => existsSync(join(root, name, f)));
    if (present.length === 0) continue;
    scanned += 1;
    for (const f of present) {
      const text = readFileSync(join(root, name, f), "utf-8");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON: the raw text is what gets scanned
      }
      for (const v of privacyViolations(body)) violations.push({ ...v, where: `${name}/${f}:${v.where}` });
    }
  }
  return { scanned, status: scanned === 0 ? "no-bundles-yet" : "scanned", violations };
}

// ---------------------------------------------------------------------------
// the command-line front door
// ---------------------------------------------------------------------------

const USAGE = [
  "usage: shared_tracker_live_grader.ts digest <pluginRoot> [--tracked-list <file>]",
  "       shared_tracker_live_grader.ts extract --project-root <dir> --run <id> --leg <leg> --tracker jira|linear --nonce <nonce>",
  "           --root-a <dir> --root-b <dir> --config-dir <dir> --digest-at-start <sha256> --out <bundle dir>",
  "           --container <key|name> [--repoint-from <key|name>] [--linear-team <key>]",
  "           --below-floor <plugin dir> --tracked-list <file> [--started-at-ms <ms>]",
  "       shared_tracker_live_grader.ts grade --bundle <bundle dir> [--verdict <file>]   (default <bundle dir>/verdict.json)",
].join("\n");

/** `--flag value` pairs; a flag outside `allowed`, a repeated flag or a flag with no value is a usage error (null). */
function parseFlags(args: string[], allowed: readonly string[]): Map<string, string> | null {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i]!;
    const v = args[i + 1];
    if (!k.startsWith("--") || !allowed.includes(k.slice(2)) || out.has(k.slice(2)) || v === undefined || v.startsWith("--")) return null;
    out.set(k.slice(2), v);
  }
  return out;
}

function usage(): number {
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

/** `digest <pluginRoot> [--tracked-list <file>]` — prints the digest JSON; a refusal exits 1 naming its reason. */
function cliDigest(args: string[]): number {
  const root = args[0];
  if (!root || root.startsWith("--")) return usage();
  const rest = args.slice(1);
  let trackedFiles: string[] | undefined;
  if (rest.length > 0) {
    if (rest.length !== 2 || rest[0] !== "--tracked-list") return usage();
    try {
      trackedFiles = readFileSync(rest[1]!, "utf-8").split("\n");
    } catch (e) {
      process.stderr.write(`digest-unavailable: the tracked-file list ${rest[1]} cannot be read: ${(e as Error).message}\n`);
      return 1;
    }
  }
  const r = behaviourDigest(root, trackedFiles === undefined ? {} : { trackedFiles });
  if (!r.ok) {
    process.stderr.write(`${r.reason}: ${r.message}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  return 0;
}

/** The file `extract` leaves beside the bundle when extraction aborts; `grade` turns it into the verdict. */
const EXTRACT_ABORT_FILE = "extract-abort.json";

const EXTRACT_FLAGS = [
  "project-root", "run", "leg", "tracker", "nonce", "root-a", "root-b", "config-dir", "digest-at-start", "out",
  "container", "repoint-from", "linear-team", "below-floor", "tracked-list", "started-at-ms",
] as const;
const EXTRACT_REQUIRED = [
  "project-root", "run", "leg", "tracker", "nonce", "root-a", "root-b", "config-dir", "digest-at-start", "out",
  "container", "below-floor", "tracked-list",
] as const;

/**
 * `extract` — project the run's ledgered sessions into the evidence bundle and
 * write it to `--out` (privacy-refused bundles are never written). The run
 * metadata the flags do not carry is derived: the plugin version from the
 * tree's manifest, the below-floor digest from `--below-floor` over
 * `--tracked-list`, the audit query from the tracker and nonce exactly as
 * Phase 4 writes it, and the S8 skip from a Jira run given no repoint space.
 */
function cliExtract(args: string[]): number {
  const f = parseFlags(args, EXTRACT_FLAGS);
  if (f === null || EXTRACT_REQUIRED.some((k) => !f.has(k))) return usage();
  const tracker = f.get("tracker")!;
  if (tracker !== "jira" && tracker !== "linear") return usage();
  const projectRoot = f.get("project-root")!;
  const nonce = f.get("nonce")!;
  const out = f.get("out")!;
  const pluginTree = join(projectRoot, "plugins", "dev-process-toolkit");

  let pluginVersion: string;
  try {
    pluginVersion = String(JSON.parse(readFileSync(join(pluginTree, MANIFEST), "utf-8")).version ?? "");
  } catch (e) {
    process.stderr.write(`extract: the plugin manifest under ${pluginTree} cannot be read: ${(e as Error).message}\n`);
    return 1;
  }
  const digestAtStart = f.get("digest-at-start")!;
  const now = behaviourDigest(pluginTree);
  let trackedFiles: string[];
  try {
    trackedFiles = readFileSync(f.get("tracked-list")!, "utf-8").split("\n");
  } catch (e) {
    process.stderr.write(`extract: the tracked-file list ${f.get("tracked-list")} cannot be read: ${(e as Error).message}\n`);
    return 1;
  }
  const below = behaviourDigest(f.get("below-floor")!, { trackedFiles });
  const startedMs = f.has("started-at-ms") ? Number(f.get("started-at-ms")) : Number.NaN;
  const repointFrom = f.get("repoint-from") || null;

  const run: RunMeta = {
    runId: f.get("run")!,
    nonce,
    tracker,
    pluginVersion,
    startedAt: Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : "",
    // The digest recorded is the one taken at the start; its per-file hashes are kept only when the tree still matches it.
    behaviourDigest: { digest: digestAtStart, files: now.ok && now.digest === digestAtStart ? now.files : {} },
    belowFloorDigest: below.ok ? below.digest : "",
    container: f.get("container")!,
    repointFrom,
    linearTeam: tracker === "linear" ? f.get("linear-team") ?? null : null,
    skips: tracker === "jira" && repointFrom === null ? [{ id: "S8", reason: REPOINT_SKIP_REASON }] : [],
    auditQuery: tracker === "jira" ? `summary ~ "${nonce}" ORDER BY key ASC` : nonce,
  };
  const ledgerSessionIds = legSessionIds(readRunLedger(smokeRunLedgerPath(projectRoot, run.runId)), run.runId, f.get("leg")!);
  const x = extractBundle({
    configDirs: [f.get("config-dir")!],
    toolkitRoot: projectRoot,
    ledgerSessionIds,
    roots: { A: { path: f.get("root-a")!, tag: `shr-${nonce}-a` }, B: { path: f.get("root-b")!, tag: `shr-${nonce}-b` } },
    run,
    synthetic: false,
  });
  if (!x.ok) {
    const w = privacyViolations(x.verdict);
    if (w.length === 0) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, EXTRACT_ABORT_FILE), `${JSON.stringify(x.verdict, null, 2)}\n`);
    }
    for (const fd of x.verdict.findings) process.stderr.write(`abort: ${fd.code}${fd.session ? ` ${fd.session}` : ""}${fd.detail ? ` — ${fd.detail}` : ""}\n`);
    return 1;
  }
  const w = writeEvidenceBundle(x.bundle, out);
  if (!w.ok) {
    process.stderr.write(`extract: refused to write the bundle — it holds personal data (${w.violations.length} match(es)):\n`);
    for (const v of w.violations) process.stderr.write(`  ${v.pattern} at ${v.where}\n`);
    return 1;
  }
  process.stdout.write(`bundle: ${w.path} sessions=${x.bundle.sessions.length}\n`);
  // No hash here: `grade` writes verdict.json into this same directory, and the
  // plan row's hash must cover it. `grade` prints the hash the row records.
  return 0;
}

/**
 * `grade` — grade `<bundle dir>/bundle.json` against the tree's behaviour
 * digest now and write the verdict artifact (default `<bundle dir>/verdict.json`). A bundle dir holding only an
 * extraction abort writes that abort; one holding neither aborts as
 * `bundle-missing`. A verdict holding personal data is refused through
 * `writeVerdictFile` and not written. Exits 0 on pass, 1 otherwise.
 */
function cliGrade(args: string[]): number {
  const f = parseFlags(args, ["bundle", "verdict"]);
  if (f === null || !f.has("bundle")) return usage();
  const dir = f.get("bundle")!;
  // The default is the bundle directory's verdict.json: the file STE-618's live-proof gate reads the recorded outcome and scenario set from.
  const verdictPath = f.get("verdict") ?? join(dir, VERDICT_FILE);
  const writeVerdict = (v: unknown, outcome: string): number => {
    // verdict.json is committed beside bundle.json, so it is privacy-refused like the bundle: a refused verdict is not written.
    const w = writeVerdictFile(v, verdictPath);
    if (!w.ok) {
      process.stderr.write(`grade: refused to write the verdict (${outcome}) — it holds personal data (${w.violations.length} match(es)):\n`);
      for (const x of w.violations) process.stderr.write(`  ${x.pattern} at ${x.where}\n`);
      return 1;
    }
    process.stdout.write(`verdict: ${outcome} → ${verdictPath}\n`);
    // The plan's Live proof row records this hash (STE-618). It is taken AFTER
    // verdict.json is written, so it covers the recorded verdict the gate reads:
    // a hand-edited verdict then reads bundle-altered. The ONE definition computes it.
    if (existsSync(join(dir, BUNDLE_FILE))) process.stdout.write(`bundle-hash=${bundleHash(dir)}\n`);
    return outcome === "pass" ? 0 : 1;
  };
  let bundle: LiveBundle;
  try {
    bundle = JSON.parse(readFileSync(join(dir, BUNDLE_FILE), "utf-8")) as LiveBundle;
  } catch (e) {
    try {
      const abort = JSON.parse(readFileSync(join(dir, EXTRACT_ABORT_FILE), "utf-8")) as { outcome: string };
      return writeVerdict(abort, abort.outcome);
    } catch {
      // The directory's own name and the error code only: an absolute path here
      // would be privacy-refused, and the abort's reason would never be saved.
      const detail = `no readable ${BUNDLE_FILE} in bundle directory ${basename(dir)} (${(e as { code?: unknown }).code ?? "unreadable"})`;
      return writeVerdict({ outcome: "abort", findings: [{ code: "bundle-missing", detail }] }, "abort");
    }
  }
  const now = behaviourDigest(PLUGIN_ROOT);
  const v = gradeBundle(bundle, { behaviourDigestNow: now.ok ? now.digest : "" });
  return writeVerdict(v, v.outcome);
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "digest") process.exit(cliDigest(args));
  if (cmd === "extract") process.exit(cliExtract(args));
  if (cmd === "grade") process.exit(cliGrade(args));
  process.exit(usage());
}
