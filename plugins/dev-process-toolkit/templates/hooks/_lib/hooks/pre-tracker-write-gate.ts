// STE-607 — PreToolUse gate on shared-container tracker writes (per-hook entrypoint).
//
// Refusing hook: where a repository declares a shared container (STE-602
// `repo_tag` + `min_dpt_version`), a tracker write the deciding commands did
// not approve in this session is refused. Where no candidate repository
// declares anything, the hook exits 0 with no stdout and no stderr — byte-
// identical to the days when no hook ran at all (AC-STE-607.1).
//
// Order of work (Technical Design): classify the call first, then resolve the
// candidate roots (the git top level of `payload.cwd` plus every root announced
// by a deciding command in this session's transcript), then read each
// candidate's declaration through `readWorkspaceBinding` — never a second
// CLAUDE.md parser. No declared candidate → silent exit 0.
//
// The stdin entry is guarded by `import.meta.main`, so importing this module
// for its constants has no side effect.

import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { emitNFR10, parseHookPayload, readTranscriptLines, type HookPayload } from "../session.ts";
import {
  readWorkspaceBinding,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
} from "../../../../adapters/_shared/src/workspace_binding.ts";
import { receiptsDir } from "../../../../adapters/_shared/src/dpt_paths.ts";
import { RECEIPT_ANNOUNCEMENT_PREFIX } from "../../../../adapters/_shared/src/tracker_receipts.ts";
import { normalizeTitleForCompare } from "../../../../adapters/_shared/src/create_idempotency_probe.ts";
import { readTrackedBindings } from "../../../../adapters/_shared/src/ticket_ownership.ts";
import { resolveInterviewAnswer } from "../../../../adapters/_shared/src/auto_answers.ts";
import { checkVersionFloor, runningDptVersion } from "../../../../adapters/_shared/src/dpt_version.ts";

export const HOOK_NAME = "pre-tracker-write-gate";

// ---------------------------------------------------------------------------
// §1 — the ONE list the hooks.json matcher is generated from
// ---------------------------------------------------------------------------

const ATLASSIAN_WRITE_TOOLS = [
  "createJiraIssue",
  "editJiraIssue",
  "transitionJiraIssue",
  "addCommentToJiraIssue",
  "addWorklogToJiraIssue",
  "createIssueLink",
] as const;

const LINEAR_WRITE_TOOLS = [
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

export const TRACKER_WRITE_TOOLS: readonly string[] = [...ATLASSIAN_WRITE_TOOLS, ...LINEAR_WRITE_TOOLS];

/** The hooks.json PreToolUse matcher, generated from `TRACKER_WRITE_TOOLS`: any server spelling. */
export const TRACKER_WRITE_MATCHER = `^mcp__.+__(${TRACKER_WRITE_TOOLS.join("|")})$`;

/** §1 — inventory names that only read (tests/fixtures/tracker-tool-inventory.json, AC-STE-607.2). */
export const TRACKER_READ_TOOLS: readonly string[] = [
  // atlassian
  "atlassianUserInfo",
  "fetch",
  "getAccessibleAtlassianResources",
  "getCompassComponent",
  "getCompassComponents",
  "getCompassCustomFieldDefinitions",
  "getConfluenceCommentChildren",
  "getConfluencePage",
  "getConfluencePageDescendants",
  "getConfluencePageFooterComments",
  "getConfluencePageInlineComments",
  "getConfluenceSpaces",
  "getContentFormatGuide",
  "getIssueLinkTypes",
  "getJiraIssue",
  "getJiraIssueRemoteIssueLinks",
  "getJiraIssueTypeMetaWithFields",
  "getJiraProjectIssueTypesMetadata",
  "getPagesInConfluenceSpace",
  "getTeamworkGraphContext",
  "getTeamworkGraphObject",
  "getTransitionsForJiraIssue",
  "getVisibleJiraProjects",
  "lookupJiraAccountId",
  "search",
  "searchConfluenceUsingCql",
  "searchJiraIssuesUsingJql",
  // linear
  "extract_images",
  "get_agent_skill",
  "get_attachment",
  "get_diff",
  "get_diff_threads",
  "get_document",
  "get_issue",
  "get_issue_status",
  "get_milestone",
  "get_notifications",
  "get_project",
  "get_release",
  "get_release_note",
  "get_status_updates",
  "get_team",
  "get_template",
  "get_user",
  "get_workspace",
  "list_agent_skills",
  "list_comments",
  "list_cycles",
  "list_diffs",
  "list_documents",
  "list_issue_labels",
  "list_issue_statuses",
  "list_issues",
  "list_milestones",
  "list_project_labels",
  "list_projects",
  "list_release_notes",
  "list_release_pipelines",
  "list_releases",
  "list_teams",
  "list_templates",
  "list_users",
  "search_documentation",
];

/** §1 — inventory write names deliberately not gated, each with a one-line reason (AC-STE-607.2). */
export const UNGATED_WRITE_TOOLS: Readonly<Record<string, string>> = {
  // atlassian — Confluence and Compass hold no tracker tickets or containers
  createCompassComponent: "Compass catalog write; no Jira ticket or container is touched.",
  createCompassComponentRelationship: "Compass catalog write; no Jira ticket or container is touched.",
  createCompassCustomFieldDefinition: "Compass catalog write; no Jira ticket or container is touched.",
  createConfluenceFooterComment: "Confluence comment; the toolkit binds no FR to Confluence content.",
  createConfluenceInlineComment: "Confluence comment; the toolkit binds no FR to Confluence content.",
  createConfluencePage: "Confluence page write; the toolkit binds no FR to Confluence content.",
  updateConfluencePage: "Confluence page write; the toolkit binds no FR to Confluence content.",
  // linear — diff review, release and notification surfaces carry no ownership tag
  delete_diff_comment: "Linear diff-review write; diffs carry no ticket ownership tag.",
  save_diff_comment: "Linear diff-review write; diffs carry no ticket ownership tag.",
  resolve_diff_thread: "Linear diff-review write; diffs carry no ticket ownership tag.",
  submit_diff_review: "Linear diff-review write; diffs carry no ticket ownership tag.",
  update_diff: "Linear diff-review write; diffs carry no ticket ownership tag.",
  merge_diff: "Linear diff merge; acts on code review, not on a ticket or container.",
  save_release: "Linear release write; releases are not a container the toolkit mints or binds.",
  save_release_note: "Linear release-note write; release notes are not a container the toolkit binds.",
  mark_notification: "Linear notification state is per-user and touches no shared ticket.",
  prepare_attachment_upload: "Only mints an upload URL; the attachment write itself (create_attachment_from_upload) is gated.",
};

/**
 * §3 — the deciding modules whose Bash output may announce a receipt root. A
 * later deciding command appends its module here and nowhere else; a module
 * writing receipts the gate must not trust is never listed.
 */
export const RECEIPT_ANNOUNCING_MODULES: readonly string[] = [
  "create_idempotency_probe.ts",
  "container_ownership.ts",
  "ticket_ownership.ts",
];

// ---------------------------------------------------------------------------
// §2 — classification of the call
// ---------------------------------------------------------------------------

export interface TrackerCall {
  /** Bare tool name, e.g. `createJiraIssue`. */
  tool: string;
  adapter: WorkspaceAdapterKey;
  input: Record<string, unknown>;
  /** The gated call's own tool_use id (`payload.tool_use_id`), already in the transcript. */
  toolUseId?: string;
}

/** Recognise a tracker write under any server spelling: `mcp__<server>__<tool>`. */
export function identifyTrackerCall(payload: HookPayload): TrackerCall | null {
  const full = payload.tool_name;
  if (typeof full !== "string" || !full.startsWith("mcp__")) return null;
  const tool = TRACKER_WRITE_TOOLS.find((t) => full.endsWith(`__${t}`) && full.length > `mcp____${t}`.length);
  if (tool === undefined) return null;
  const adapter: WorkspaceAdapterKey = (ATLASSIAN_WRITE_TOOLS as readonly string[]).includes(tool)
    ? "jira"
    : "linear";
  const input =
    payload.tool_input && typeof payload.tool_input === "object"
      ? (payload.tool_input as Record<string, unknown>)
      : {};
  return { tool, adapter, input, ...(typeof payload.tool_use_id === "string" ? { toolUseId: payload.tool_use_id } : {}) };
}

// ---------------------------------------------------------------------------
// Exit codes and the one refusal shape
// ---------------------------------------------------------------------------

/** 0 permits silently, 1 permits with a Reminder (§5), 2 refuses. */
type ExitCode = 0 | 1 | 2;

/** Every refusal goes through here: one NFR-10 `Refusing` block on stderr, exit 2. */
function refuse(what: string, remedy: string): 2 {
  emitNFR10("Refusing", what, remedy, "none", HOOK_NAME);
  return 2;
}

function sessionIdOf(payload: HookPayload): string {
  return typeof payload.session_id === "string" ? payload.session_id : "";
}

// ---------------------------------------------------------------------------
// §3 — candidate roots
// ---------------------------------------------------------------------------

/** The git top level of `dir`, or null when `dir` is not inside a repository. */
export function gitTopLevel(dir: string): string | null {
  if (!dir) return null;
  try {
    const p = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (p.exitCode !== 0) return null;
    const top = p.stdout.toString().trim();
    return top.length > 0 ? top : null;
  } catch {
    return null;
  }
}

interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: { command?: unknown };
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  text?: unknown;
}

/** One parsed transcript line: the raw record and its `message.content` blocks. */
interface ParsedLine {
  raw: Record<string, unknown>;
  blocks: ContentBlock[];
}

function blocksOf(raw: unknown): ContentBlock[] {
  const content = (raw as { message?: { content?: unknown } })?.message?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function parseLines(lines: string[]): Array<ParsedLine | null> {
  return lines.map((line) => {
    if (!line.trim()) return null;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      return raw && typeof raw === "object" ? { raw, blocks: blocksOf(raw) } : null;
    } catch {
      return null;
    }
  });
}

function contentBlocks(line: string): ContentBlock[] {
  if (!line.trim()) return [];
  try {
    return blocksOf(JSON.parse(line));
  } catch {
    return [];
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && typeof (c as ContentBlock).text === "string" ? (c as ContentBlock).text : ""))
      .join("\n");
  }
  return "";
}

function runsAnnouncingModule(command: string): boolean {
  return RECEIPT_ANNOUNCING_MODULES.some((m) => new RegExp(`(^|[\\s"'/])${m.replace(/\./g, "\\.")}(["'\\s]|$)`).test(command));
}

/**
 * The root of a receipt path, when the path sits directly under
 * `receiptsDir(<root>, sessionId)`; null otherwise.
 */
function receiptRootOf(path: string, sessionId: string): string | null {
  const abs = resolve(path);
  // <root>/.dpt/ledger/receipts/<session>/<file>
  const root = dirname(dirname(dirname(dirname(dirname(abs)))));
  let dir: string;
  try {
    dir = receiptsDir(root, sessionId);
  } catch {
    return null;
  }
  return abs.startsWith(dir + sep) ? root : null;
}

export interface Announcement {
  root: string;
  receiptPath: string;
  /** Index of the transcript line carrying the announcing tool_result. */
  line: number;
}

/**
 * Every receipt root announced in this session by a deciding command: a
 * `dpt-receipt: <path>` line inside the non-error tool_result of a `Bash`
 * tool_use whose command runs a module in `RECEIPT_ANNOUNCING_MODULES`.
 */
export function announcedReceipts(lines: string[], sessionId: string): Announcement[] {
  const announcingBash = new Set<string>();
  const out: Announcement[] = [];
  lines.forEach((line, idx) => {
    for (const b of contentBlocks(line)) {
      if (b.type === "tool_use" && b.name === "Bash" && typeof b.id === "string") {
        const cmd = b.input?.command;
        if (typeof cmd === "string" && runsAnnouncingModule(cmd)) announcingBash.add(b.id);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        if (b.is_error === true || !announcingBash.has(b.tool_use_id)) continue;
        for (const l of resultText(b.content).split("\n")) {
          if (!l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX)) continue;
          const receiptPath = l.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim();
          if (!receiptPath.startsWith("/")) continue;
          const root = receiptRootOf(receiptPath, sessionId);
          if (root !== null) out.push({ root, receiptPath: resolve(receiptPath), line: idx });
        }
      }
    }
  });
  return out;
}

export function candidateRoots(payload: HookPayload, announcements: Announcement[]): string[] {
  const roots: string[] = [];
  const top = gitTopLevel(payload.cwd);
  if (top !== null) roots.push(top);
  for (const a of announcements) {
    if (!roots.includes(a.root)) roots.push(a.root);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Declarations and receipts
// ---------------------------------------------------------------------------

export type Declaration =
  | { root: string; ok: true; binding: WorkspaceBinding }
  | { root: string; ok: false; error: string };

/** A readable declaration that declares a shared container. */
type DeclaredTarget = { root: string; binding: WorkspaceBinding };

/** Each candidate's declaration through the STE-602 reader. Malformed/unreadable → `ok: false`. */
export function readDeclarations(roots: string[], adapter: WorkspaceAdapterKey): Declaration[] {
  return roots.map((root) => {
    try {
      return { root, ok: true, binding: readWorkspaceBinding(join(root, "CLAUDE.md"), adapter) };
    } catch (e) {
      return { root, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** An announced receipt file's JSON object, or null when it is unreadable or not an object. */
function readReceiptJson(path: string): Record<string, unknown> | null {
  try {
    const r = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A v1 receipt written for this session and this adapter, or null. */
function readSessionReceipt(
  path: string,
  sessionId: string,
  adapter: WorkspaceAdapterKey,
): Record<string, unknown> | null {
  const r = readReceiptJson(path);
  return r && r.v === 1 && r.sessionId === sessionId && r.adapter === adapter ? r : null;
}

// ---------------------------------------------------------------------------
// §4 — creates: a matching, unspent `create` receipt in the target
// ---------------------------------------------------------------------------

const DECIDE_CMD = "create_idempotency_probe.ts decide";

/** §2 — a `createJiraIssue` whose type is not Epic, or a `save_issue` without `id`. */
export function isCreate(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "createJiraIssue") {
    const type = input.issueTypeName;
    return !(typeof type === "string" && type.trim().toLowerCase() === "epic");
  }
  if (tool === "save_issue") return input.id === undefined || input.id === null || input.id === "";
  return false;
}

/** The create call a transcript tool_use block made for `adapter`, or null. */
function createCallIn(b: ContentBlock, adapter: WorkspaceAdapterKey): TrackerCall | null {
  if (b.type !== "tool_use" || typeof b.name !== "string") return null;
  const c = identifyTrackerCall({ tool_name: b.name, tool_input: b.input } as unknown as HookPayload);
  return c && c.adapter === adapter && isCreate(c.tool, c.input) ? c : null;
}

function asKey(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.key === "string") return o.key;
    if (typeof o.id === "string") return o.id;
  }
  return "";
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The create's comparable shape, read from a tool call's input. */
interface CreateShape {
  project: string;
  team: string;
  title: string;
  labels: string[];
  container: string;
}

function callShape(adapter: WorkspaceAdapterKey, input: Record<string, unknown>): CreateShape {
  const extra =
    input.additional_fields && typeof input.additional_fields === "object"
      ? (input.additional_fields as Record<string, unknown>)
      : {};
  if (adapter === "jira") {
    return {
      project: typeof input.projectKey === "string" ? input.projectKey : "",
      team: "",
      title: typeof input.summary === "string" ? input.summary : "",
      labels: stringList(input.labels ?? extra.labels),
      container: asKey(input.parent) || asKey(extra.parent),
    };
  }
  return {
    project: typeof input.project === "string" ? input.project : "",
    team: typeof input.team === "string" ? input.team : "",
    title: typeof input.title === "string" ? input.title : "",
    labels: stringList(input.labels),
    container: asKey(input.milestone),
  };
}

function receiptShape(adapter: WorkspaceAdapterKey, p: Record<string, unknown>): CreateShape {
  return {
    project: typeof p.project === "string" ? p.project : "",
    team: typeof p.team === "string" ? p.team : "",
    title: adapter === "jira" ? String(p.summary ?? "") : String(p.title ?? ""),
    labels: stringList(p.labels),
    container: asKey(adapter === "jira" ? p.parent : p.milestone),
  };
}

function bindsContainer(adapter: WorkspaceAdapterKey, b: WorkspaceBinding, c: CreateShape): boolean {
  if (adapter === "jira") return b.project === c.project;
  return (c.project !== "" && b.project === c.project) || (c.team !== "" && b.team === c.team);
}

/** The first mismatch between a create call and a receipt's payload, or null on a match. */
function createMismatch(
  adapter: WorkspaceAdapterKey,
  call: CreateShape,
  receipt: CreateShape,
  tag: string,
): string | null {
  // Linear: the project must match whenever both name one, and the team too;
  // a receipt for project A never authorises a create in project B of the
  // same team (the old either-or check let it through).
  const projectDiffers =
    adapter === "jira"
      ? call.project !== receipt.project
      : (call.project !== "" || receipt.project !== "") && call.project !== receipt.project;
  const teamDiffers = adapter === "linear" && call.team !== "" && receipt.team !== "" && call.team !== receipt.team;
  if (projectDiffers || teamDiffers) {
    return `project "${call.project}" differs from the receipt's "${receipt.project}"`;
  }
  if (normalizeTitleForCompare(call.title) !== normalizeTitleForCompare(receipt.title)) {
    return `title "${call.title}" differs from the receipt's "${receipt.title}"`;
  }
  const wanted = [tag, ...receipt.labels.filter((l) => /^\d+$/.test(l))];
  const missing = wanted.filter((l) => !call.labels.includes(l));
  if (missing.length > 0) {
    return `labels [${call.labels.join(", ")}] miss ${missing.map((l) => `"${l}"`).join(", ")} (the repo tag${missing.length > 1 || missing[0] !== tag ? " and milestone label" : ""})`;
  }
  const kind = adapter === "jira" ? "parent" : "milestone";
  if (call.container !== receipt.container) {
    return `${kind} "${call.container || "none"}" differs from the receipt's "${receipt.container || "none"}"`;
  }
  return null;
}

interface CreateReceiptSeen {
  line: number;
  path: string;
  shape: CreateShape;
  spent: boolean;
}

function readCreateReceipt(path: string, sessionId: string, adapter: WorkspaceAdapterKey): CreateShape | null {
  const r = readSessionReceipt(path, sessionId, adapter);
  if (!r || r.kind !== "create") return null;
  const ev = r.evidence as { createPayload?: unknown } | null;
  const p = ev && typeof ev.createPayload === "object" && ev.createPayload ? ev.createPayload : null;
  return p ? receiptShape(adapter, p as Record<string, unknown>) : null;
}

/** Every create tool_use in the transcript for `adapter`, in order. */
function priorCreates(
  lines: string[],
  adapter: WorkspaceAdapterKey,
  pendingId: string | undefined,
): Array<{ line: number; shape: CreateShape }> {
  // Claude Code writes a tool_use to the transcript BEFORE its PreToolUse hook
  // runs (measured on a live transcript), so the call being gated — and any
  // not-yet-run parallel sibling — is already there. Only a create that RAN
  // spends a receipt: one whose paired tool_result exists, whatever it says.
  const ran = new Set<string>();
  for (const line of lines) {
    for (const b of contentBlocks(line)) {
      if (b.type === "tool_result" && typeof b.tool_use_id === "string") ran.add(b.tool_use_id);
    }
  }
  const out: Array<{ line: number; shape: CreateShape }> = [];
  lines.forEach((line, idx) => {
    for (const b of contentBlocks(line)) {
      if (typeof b.id !== "string" || b.id === pendingId || !ran.has(b.id)) continue;
      const c = createCallIn(b, adapter);
      if (c) out.push({ line: idx, shape: callShape(adapter, c.input) });
    }
  });
  return out;
}

function gateCreate(
  call: TrackerCall,
  sessionId: string,
  transcript: string[],
  announcements: Announcement[],
  declared: DeclaredTarget[],
  note: string,
): ExitCode {
  const shape = callShape(call.adapter, call.input);
  if (shape.project === "" && shape.team === "") {
    return refuse(
      `${call.tool} names no project, so its target among ${declared.map((d) => d.root).join(", ")} cannot be resolved.${note}`,
      `pass the project the ${DECIDE_CMD} receipt was written for, then retry.`,
    );
  }
  const binding = declared.filter((d) => bindsContainer(call.adapter, d.binding, shape));
  if (binding.length === 0) return 0; // §3 — no declared target binds this container
  let target = binding[0];
  if (binding.length > 1) {
    const tagged = binding.filter((d) => d.binding.repoTag && shape.labels.includes(d.binding.repoTag));
    if (tagged.length !== 1) {
      return refuse(
        `${call.tool} into ${shape.project || shape.team}: labels [${shape.labels.join(", ")}] carry ${tagged.length === 0 ? "no" : "more than one"} repo tag of the declared targets ${binding.map((d) => `${d.root} (${d.binding.repoTag})`).join(", ")}, so the target cannot be resolved.${note}`,
        `carry exactly one target's repo tag in the labels and run ${DECIDE_CMD} in that repository, then retry.`,
      );
    }
    target = tagged[0];
  }
  const tag = target.binding.repoTag ?? "";

  const seen: CreateReceiptSeen[] = [];
  for (const a of announcements) {
    if (a.root !== target.root) continue;
    const r = readCreateReceipt(a.receiptPath, sessionId, call.adapter);
    if (r) seen.push({ line: a.line, path: a.receiptPath, shape: r, spent: false });
  }
  // §4 — each receipt authorises exactly ONE create tool_use after its announcement.
  for (const c of priorCreates(transcript, call.adapter, call.toolUseId)) {
    const hit = seen.find((r) => !r.spent && r.line < c.line && createMismatch(call.adapter, c.shape, r.shape, tag) === null);
    if (hit) hit.spent = true;
  }
  const matching = seen.filter((r) => createMismatch(call.adapter, shape, r.shape, tag) === null);
  if (matching.some((r) => !r.spent)) return 0;

  const where = `${call.tool} in ${target.root}`;
  if (matching.length > 0) {
    return refuse(
      `${where}: its create receipt (${matching[matching.length - 1].path}) is spent — a create already ran after it, and a timed-out create may still have made the ticket.${note}`,
      `run ${DECIDE_CMD} --attempt retry-<N> again for a fresh receipt, then retry.`,
    );
  }
  if (seen.length > 0) {
    const last = seen[seen.length - 1];
    return refuse(
      `${where}: the call does not match its create receipt (${last.path}): ${createMismatch(call.adapter, shape, last.shape, tag)}.${note}`,
      `send the payload ${DECIDE_CMD} decided, or run ${DECIDE_CMD} again for this one, then retry.`,
    );
  }
  return refuse(
    `${where}: no create receipt announced by ${DECIDE_CMD} in this session authorises it.${note}`,
    `run ${DECIDE_CMD} in ${target.root} for this ticket, then retry.`,
  );
}

// ---------------------------------------------------------------------------
// §4 — tickets: a subject the target owns
// ---------------------------------------------------------------------------

const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const CONFIRM_CMD = "ticket_ownership.ts confirm";

/** §2 — the container class; every non-create, non-container call is a `ticket` call. */
export function isContainer(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "createJiraIssue") return !isCreate(tool, input);
  return (
    tool === "save_milestone" ||
    tool === "save_project" ||
    /label/.test(tool) ||
    /status_update/.test(tool) ||
    tool === "save_document"
  );
}

/** The input fields a ticket call names its subject in: both sides of a link, else the issue fields. */
function subjectValues(call: TrackerCall): unknown[] {
  const i = call.input;
  return call.tool === "createIssueLink" ? [i.inwardIssue, i.outwardIssue] : [i.issueIdOrKey, i.id, i.issueId, i.issue];
}

/** §2 — a ticket call's subject keys: `issueIdOrKey`, both keys of a link, `id`, or the commented issue. */
export function subjectKeys(call: TrackerCall): string[] {
  const keys = subjectValues(call)
    .map((v) => asKey(v).trim())
    .filter((k) => TICKET_KEY.test(k));
  return [...new Set(keys.map((k) => k.toUpperCase()))];
}

/** The raw subject values a ticket call carried, for naming an unresolvable subject. */
function rawSubjects(call: TrackerCall): string {
  const raw = subjectValues(call)
    .map((v) => (typeof v === "number" ? String(v) : asKey(v)).trim())
    .filter((v) => v !== "");
  return raw.length > 0 ? ` (got ${raw.map((v) => `"${v}"`).join(", ")})` : "";
}

function keyPrefix(key: string): string {
  return key.slice(0, key.lastIndexOf("-"));
}

function bindsKey(adapter: WorkspaceAdapterKey, b: WorkspaceBinding, key: string): boolean {
  const prefix = keyPrefix(key);
  return adapter === "jira" ? b.project === prefix : b.team === prefix;
}

function namesKey(text: string, key: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9-])${key.replace(/[-]/g, "\\-")}(?![0-9A-Za-z])`).test(text);
}

/** Keys a create tool_use of this session returned in its paired, non-error tool_result. */
function createdKeys(parsed: Array<ParsedLine | null>, adapter: WorkspaceAdapterKey): Set<string> {
  const creates = new Set<string>();
  const out = new Set<string>();
  for (const p of parsed) {
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type === "tool_use") {
        if (typeof b.id === "string" && createCallIn(b, adapter)) creates.add(b.id);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        if (b.is_error === true || !creates.has(b.tool_use_id)) continue;
        for (const m of resultText(b.content).matchAll(/[A-Za-z][A-Za-z0-9]*-\d+/g)) out.add(m[0].toUpperCase());
      }
    }
  }
  return out;
}

/** The answer an `AskUserQuestion` tool_result selected, read from the harness's structured record. */
function selectedAnswers(p: ParsedLine, block: ContentBlock): string[] {
  const tur = p.raw.toolUseResult as { answers?: unknown } | undefined;
  if (tur && tur.answers && typeof tur.answers === "object") {
    return Object.values(tur.answers as Record<string, unknown>).filter((v): v is string => typeof v === "string");
  }
  // Fallback: the harness's own sentence, `"<question>"="<answer>".`
  const text = resultText(block.content);
  return [...text.matchAll(/"="([^"]*)"(?=[.,]\s|[.,]?$)/g)].map((m) => m[1]);
}

function operatorText(p: ParsedLine): string {
  if (p.raw.type !== "user" || p.raw.isMeta === true) return "";
  const content = (p.raw.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if ((content as ContentBlock[]).some((b) => b?.type === "tool_result")) return "";
  return (content as ContentBlock[]).map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).join("\n");
}

/** Line indices of an ANSWERED consent to `<verb> <key>` (§4). */
function consentLines(parsed: Array<ParsedLine | null>, key: string, verb: "Import" | "Adopt"): number[] {
  const label = `${verb} ${key}`;
  const asks = new Set<string>();
  const out: number[] = [];
  parsed.forEach((p, idx) => {
    if (!p) return;
    for (const b of p.blocks) {
      if (b.type === "tool_use" && b.name === "AskUserQuestion" && typeof b.id === "string") {
        if (namesKey(JSON.stringify(b.input ?? {}), key)) asks.add(b.id);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        if (b.is_error === true || !asks.has(b.tool_use_id)) continue;
        if (selectedAnswers(p, b).some((a) => a === label)) out.push(idx);
      }
    }
    const text = operatorText(p);
    if (text) {
      const v = resolveInterviewAnswer(text, "tracker_orphan_import");
      const values = Array.isArray(v) ? v : [v];
      if (values.some((x) => typeof x === "string" && namesKey(x, key))) out.push(idx);
    }
  });
  return out;
}

interface OwnershipContext {
  parsed: Array<ParsedLine | null>;
  announcements: Announcement[];
  created: Set<string>;
  sessionId: string;
  adapter: WorkspaceAdapterKey;
  tracked: Map<string, Set<string>>;
}

function trackedIds(ctx: OwnershipContext, root: string): Set<string> {
  let ids = ctx.tracked.get(root);
  if (!ids) {
    ids = new Set([...readTrackedBindings(root).ids].map((k) => k.toUpperCase()));
    ctx.tracked.set(root, ids);
  }
  return ids;
}

/** §4 — does `root` own `key`: tracked FR binding, created this session, or an announced receipt. */
function owns(ctx: OwnershipContext, root: string, key: string): boolean {
  if (trackedIds(ctx, root).has(key)) return true;
  if (ctx.created.has(key)) return true;
  for (const a of ctx.announcements) {
    if (a.root !== root) continue;
    const r = readSessionReceipt(a.receiptPath, ctx.sessionId, ctx.adapter);
    if (!r) continue;
    if (r.kind === "reuse") {
      const ev = r.evidence as { key?: unknown } | null;
      if (ev && typeof ev.key === "string" && ev.key.toUpperCase() === key) return true;
      continue;
    }
    const subject = typeof r.subject === "string" ? r.subject.toUpperCase() : "";
    if (subject !== key) continue;
    const verb = r.kind === "import" ? "Import" : r.kind === "binding" && r.decision === "adopt" ? "Adopt" : null;
    if (r.kind === "binding" && verb === null) return true;
    if (verb === null) continue;
    if (consentLines(ctx.parsed, key, verb).some((l) => l < a.line)) return true;
  }
  return false;
}

function gateTicket(
  call: TrackerCall,
  sessionId: string,
  transcript: string[],
  announcements: Announcement[],
  declared: DeclaredTarget[],
  note: string,
): ExitCode {
  const keys = subjectKeys(call);
  if (keys.length === 0) {
    return refuse(
      `${call.tool} names no resolvable ticket key${rawSubjects(call)}, so its subject among the declared targets ${declared.map((d) => d.root).join(", ")} cannot be resolved.${note}`,
      `pass the ticket's key (e.g. ${call.adapter === "jira" ? "GF-123" : "STE-123"}) rather than an internal id, then retry.`,
    );
  }
  const inScope = keys.map((k) => ({ key: k, targets: declared.filter((d) => bindsKey(call.adapter, d.binding, k)) }));
  if (inScope.every((k) => k.targets.length === 0)) return 0; // §3 — no declared target binds the container

  const parsed = parseLines(transcript);
  const ctx: OwnershipContext = {
    parsed,
    announcements,
    created: createdKeys(parsed, call.adapter),
    sessionId,
    adapter: call.adapter,
    tracked: new Map(),
  };
  const ownedKey = (k: { key: string; targets: DeclaredTarget[] }) =>
    k.targets.length === 0 || k.targets.some((t) => owns(ctx, t.root, k.key));
  const isLink = call.tool === "createIssueLink";
  const bound = inScope.filter((k) => k.targets.length > 0);
  const unowned = inScope.filter((k) => !ownedKey(k));
  // A link needs one owned side; every other ticket call needs every subject owned.
  const permitted = isLink ? bound.some(ownedKey) : unowned.length === 0;
  if (permitted) return 0;
  const named = (isLink ? bound : unowned).map((k) => k.key);
  const targetRoots = [...new Set(inScope.flatMap((k) => k.targets.map((t) => t.root)))].join(", ");
  return refuse(
    `${call.tool} on ${named.join(", ")}: ${isLink ? "neither side is" : "the ticket is not"} owned by the declared target ${targetRoots} — no tracked FR file binds it, this session did not create it, and no reuse, binding or consented import receipt names it.${note}`,
    `run ${CONFIRM_CMD} (or container_ownership.ts consent after an answered import question) in ${targetRoots} for ${named.join(", ")}, then retry.`,
  );
}

// ---------------------------------------------------------------------------
// §5 — containers: named, not gated, in this milestone
// ---------------------------------------------------------------------------

const CONTAINER_GATE_MILESTONE = "M_685ff6";

/** §5 — the kind a container call writes, for the Reminder. */
function containerKind(tool: string): string {
  if (tool === "createJiraIssue" || tool === "save_milestone") return "milestone";
  if (tool === "save_project") return "project";
  if (/label/.test(tool)) return "label";
  if (/status_update/.test(tool)) return "status update";
  return "document";
}

function remindContainer(call: TrackerCall, declared: DeclaredTarget[]): 1 {
  const kind = containerKind(call.tool);
  emitNFR10(
    "Reminder",
    `${call.tool} is a ${kind} write into a shared container declared by ${declared.map((d) => d.root).join(", ")}; container writes are gated from ${CONTAINER_GATE_MILESTONE}, so this one is named, not refused.`,
    `confirm this ${kind} belongs to this repository before relying on it.`,
    "none",
    HOOK_NAME,
  );
  return 1;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Whether a declared target binds the call's container (§3's "declared
 * target"): a create by its project/team, a ticket call by its keys' prefix.
 * A call whose container cannot be resolved binds every candidate, so an
 * unresolvable write is floor-checked against all of them (fail safe).
 */
function bindsCall(call: TrackerCall, d: DeclaredTarget): boolean {
  if (isCreate(call.tool, call.input) || isContainer(call.tool, call.input)) {
    const shape = callShape(call.adapter, call.input);
    if (shape.project === "" && shape.team === "") return true;
    return bindsContainer(call.adapter, d.binding, shape);
  }
  const keys = subjectKeys(call);
  if (keys.length === 0) return true;
  return keys.some((k) => bindsKey(call.adapter, d.binding, k));
}

/** §4 — the version floor of the call's declared targets, checked before every receipt and ticket rule. */
function checkFloors(call: TrackerCall, declared: DeclaredTarget[]): ExitCode {
  // Only the declared TARGETS of this call (§3/§4): another repository's
  // floor never blocks a write into a container that repository does not bind.
  const floored = declared.filter((d) => d.binding.minDptVersion !== undefined && bindsCall(call, d));
  if (floored.length === 0) return 0;
  let running: string;
  try {
    running = runningDptVersion();
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return refuse(
      `${call.tool} — the running toolkit version cannot be read, so the floor declared by ${floored.map((d) => d.root).join(", ")} cannot be checked: ${msg}`,
      `restore the dev-process-toolkit plugin manifest (.claude-plugin/plugin.json) with a strict X.Y.Z version, then retry.`,
    );
  }
  for (const d of floored) {
    const v = checkVersionFloor(d.binding, running);
    if (!v.ok) {
      return refuse(
        `${call.tool} writes into the shared container declared by ${d.root}: the running toolkit version ${v.running} is below its min_dpt_version ${v.floor}.`,
        `upgrade the dev-process-toolkit plugin to ${v.floor} or later, then retry.`,
      );
    }
  }
  return 0;
}

/**
 * §6 — the refusal suffix naming inputs the hook could not read: an unreadable
 * transcript (no announced roots, no session-created keys) and the count of
 * announced receipt files that failed to parse and were ignored.
 */
function unreadableInputsNote(payload: HookPayload, transcript: string[] | null, announcements: Announcement[]): string {
  if (transcript === null) {
    return ` The session transcript (${payload.transcript_path || "no transcript_path"}) is unreadable, so no announced receipt roots or session-created keys were counted.`;
  }
  let unparseable = 0;
  for (const a of announcements) {
    try {
      JSON.parse(readFileSync(a.receiptPath, "utf-8"));
    } catch {
      unparseable++;
    }
  }
  return unparseable > 0 ? ` ${unparseable} announced receipt file(s) failed to parse and were ignored.` : "";
}

export function run(stdin: string): ExitCode {
  const payload = parseHookPayload(stdin);
  if (!payload) return 0; // §6 — fail-open outside a session
  const call = identifyTrackerCall(payload);
  if (!call) return 0;

  const transcript = readTranscriptLines(payload);
  const sessionId = sessionIdOf(payload);
  const lines = transcript ?? [];
  // One pass over the transcript for announcements, shared by candidate
  // resolution and every gate below (no session id → nothing announced).
  const announcements = sessionId ? announcedReceipts(lines, sessionId) : [];
  const declarations = readDeclarations(candidateRoots(payload, announcements), call.adapter);
  for (const d of declarations) {
    if (d.ok) continue;
    return refuse(
      `${call.tool} — the declaration in ${d.root} cannot be read: ${d.error.split("\n")[0]}`,
      `fix the shared-container declaration in ${join(d.root, "CLAUDE.md")} and retry.`,
    );
  }
  const declared: DeclaredTarget[] = declarations.flatMap((d) => (d.ok && d.binding.shared ? [d] : []));
  if (declared.length === 0) return 0; // §3 — byte-identical when undeclared

  const floor = checkFloors(call, declared);
  if (floor !== 0) return floor;

  const note = unreadableInputsNote(payload, transcript, announcements);
  if (isCreate(call.tool, call.input)) return gateCreate(call, sessionId, lines, announcements, declared, note);
  if (!isContainer(call.tool, call.input)) return gateTicket(call, sessionId, lines, announcements, declared, note);
  return remindContainer(call, declared);
}

if (import.meta.main) {
  const code = run(await Bun.stdin.text());
  // 0 permit, 1 Reminder (non-blocking), 2 refusal — every refuse(…) above.
  process.exit(code satisfies 0 | 1 | 2);
}
