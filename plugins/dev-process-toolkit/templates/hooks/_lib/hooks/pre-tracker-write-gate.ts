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

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { emitNFR10, parseHookPayload, readTranscriptLines, type HookPayload } from "../session.ts";
import {
  readWorkspaceBinding,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
} from "../../../../adapters/_shared/src/workspace_binding.ts";
import { receiptsDir } from "../../../../adapters/_shared/src/dpt_paths.ts";
import {
  parseReceiptAnnouncement,
  receiptDigest,
} from "../../../../adapters/_shared/src/tracker_receipts.ts";
import { normalizeTitleForCompare } from "../../../../adapters/_shared/src/create_idempotency_probe.ts";
import { readTrackedBindings } from "../../../../adapters/_shared/src/ticket_ownership.ts";
import { milestoneLabel } from "../../../../adapters/_shared/src/attach_project_milestone.ts";
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
 * §3 — the deciding modules whose Bash output may announce a receipt root,
 * each with the ONE subcommand that writes a receipt. Only that subcommand
 * announces: a module's other subcommands print model- or tracker-supplied
 * text (`normalize <title>` echoes its argument, `list` prints page keys), so
 * they must never stand in for a receipt write. A later deciding command adds
 * its module and subcommand here — and, only when it has no subcommand, its
 * argv check to `NO_SUBCOMMAND_ARGV`; a module writing receipts the gate must
 * not trust is never listed.
 *
 * `null` marks a module with NO subcommand (STE-608): its whole CLI is the one
 * receipt-writing front door, so its argv is checked by `NO_SUBCOMMAND_ARGV`
 * instead. A module listed with a subcommand never announces without it.
 */
export const RECEIPT_WRITING_SUBCOMMANDS: Readonly<Record<string, string | null>> = {
  "create_idempotency_probe.ts": "decide",
  "container_ownership.ts": "consent",
  "ticket_ownership.ts": "confirm",
  "resolve_milestone_identity.ts": null,
};

export const RECEIPT_ANNOUNCING_MODULES: readonly string[] = Object.keys(RECEIPT_WRITING_SUBCOMMANDS);

/**
 * The argv a subcommand-less deciding module is accepted with, after the
 * module path: the decision front door's exact
 * `<projectRoot> <jira|linear> <project> <listingFile> --title|--join-key <v>`.
 */
const NO_SUBCOMMAND_ARGV: Readonly<Record<string, (args: string[]) => boolean>> = {
  "resolve_milestone_identity.ts": (a) =>
    a.length === 6 && (a[1] === "jira" || a[1] === "linear") && (a[4] === "--title" || a[4] === "--join-key"),
};

/**
 * The accepted invocation of a deciding module, as every refusal shows it:
 * `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/<module>" [<subcommand>] …`.
 */
export function acceptedShape(module: string, args: string): string {
  const sub = RECEIPT_WRITING_SUBCOMMANDS[module];
  return `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${module}" ${sub ? `${sub} ` : ""}${args}`;
}

/** The plain-invocation rule every receipt refusal states (§3). */
const PLAIN_RULE =
  "as ONE plain command — no `cd … &&`, `;`, `|`, redirection such as `2>&1`, `~`, a variable other than the plugin root (`$VAR`), command substitution (`$(…)`), or `$`, backtick or backslash inside double quotes (a title that needs them goes in a file passed with `--title-file <path>`); the plugin path may be spelled `${CLAUDE_PLUGIN_ROOT}/…`, `\"${CLAUDE_PLUGIN_ROOT}/…\"`, `\"${CLAUDE_PLUGIN_ROOT}\"/…` or absolute. A receipt announced by any other command shape is ignored";

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

/** 0 permits silently, 2 refuses. */
type ExitCode = 0 | 2;

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

/**
 * A line's content blocks — objects only. A `null`, number or string element
 * is no block: passing it through would throw in a walk, and a thrown gate
 * refuses, which would break the undeclared silence (AC-STE-607.1).
 */
function blocksOf(raw: unknown): ContentBlock[] {
  const content = (raw as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is ContentBlock => b !== null && typeof b === "object" && !Array.isArray(b));
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

/** This hook's own plugin root: the deciding modules it trusts are ITS plugin's, never a same-named file elsewhere. */
const OWN_PLUGIN_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

/** The documented spellings of the plugin root in a command, expanded to this hook's own root. */
const PLUGIN_ROOT_VARS = ["${CLAUDE_PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT"];

/** The plugin-root variable spelled at `command[i]`, or null. `$CLAUDE_PLUGIN_ROOTX` is another variable. */
function pluginRootVarAt(command: string, i: number): string | null {
  for (const v of PLUGIN_ROOT_VARS) {
    if (!command.startsWith(v, i)) continue;
    if (v.startsWith("${") || !/[A-Za-z0-9_]/.test(command[i + v.length] ?? "")) return v;
  }
  return null;
}

/**
 * Split a Bash command into words under a deliberately small shell grammar,
 * or null when the command uses anything beyond it: unquoted metacharacters
 * (`;` `&` `|` `<` `>` `(` `)` `#` `*` `?` `~` `!` `{` `}` `[` `]` `\`),
 * command or variable substitution, or a newline. A command that could run a
 * second program — an `echo` chained after the real one, a comment carrying a
 * module name — is thereby not a deciding command at all. The one variable
 * allowed is the plugin root (`${CLAUDE_PLUGIN_ROOT}` / `$CLAUDE_PLUGIN_ROOT`,
 * bare or inside double quotes), expanded to `pluginRoot`: the spelling every
 * skill, adapter doc and hooks.json uses.
 */
export function simpleCommandWords(command: string, pluginRoot: string = OWN_PLUGIN_ROOT): string[] | null {
  const words: string[] = [];
  let cur: string | null = null;
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    const rootVar = ch === "$" ? pluginRootVarAt(command, i) : null;
    if (rootVar !== null) {
      cur = (cur ?? "") + pluginRoot;
      i += rootVar.length;
    } else if (ch === " " || ch === "\t") {
      if (cur !== null) words.push(cur);
      cur = null;
      i++;
    } else if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return null;
      const body = command.slice(i + 1, end);
      if (body.includes("\n")) return null;
      cur = (cur ?? "") + body;
      i = end + 1;
    } else if (ch === '"') {
      let body = "";
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        const v = command[j] === "$" ? pluginRootVarAt(command, j) : null;
        if (v !== null) {
          body += pluginRoot;
          j += v.length - 1;
        } else if (/[$`\\\n]/.test(command[j]!)) {
          return null;
        } else {
          body += command[j];
        }
      }
      if (j >= command.length) return null;
      cur = (cur ?? "") + body;
      i = j + 1;
    } else if (/[A-Za-z0-9_./:=@%+,-]/.test(ch)) {
      cur = (cur ?? "") + ch;
      i++;
    } else {
      return null;
    }
  }
  if (cur !== null) words.push(cur);
  return words;
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * The deciding module a Bash command RUNS to write a receipt, or null. The
 * command must be one `bun [run] <module path> <subcommand> …` invocation
 * under `simpleCommandWords`, the module path must be this plugin's own file
 * — a same-named file elsewhere, a module mentioned in an argument, or a
 * comment naming one runs nothing here — and the subcommand must be the
 * module's receipt-writing one (`RECEIPT_WRITING_SUBCOMMANDS`).
 */
export function invokedDecidingModule(command: string): string | null {
  const words = simpleCommandWords(command.trim());
  if (!words || words[0] !== "bun") return null;
  const at = words[1] === "run" ? 2 : 1;
  const target = words[at];
  if (target === undefined || !target.startsWith("/")) return null;
  const actual = realpathOr(target);
  for (const m of RECEIPT_ANNOUNCING_MODULES) {
    if (actual !== realpathOr(join(OWN_PLUGIN_ROOT, "adapters", "_shared", "src", m))) continue;
    const sub = RECEIPT_WRITING_SUBCOMMANDS[m];
    if (sub === null) return NO_SUBCOMMAND_ARGV[m]?.(words.slice(at + 1)) === true ? m : null;
    return words[at + 1] === sub ? m : null;
  }
  return null;
}

/**
 * A Bash command that names a deciding module's receipt-writing subcommand
 * but is NOT accepted by `invokedDecidingModule` — chained, redirected,
 * `cd`-prefixed, or quoted beyond the grammar. Its receipt is ignored, so the
 * refusal names it instead of leaving the model to repeat the same shape.
 */
function rejectedDecidingCommand(command: string): boolean {
  if (invokedDecidingModule(command) !== null) return false;
  return Object.entries(RECEIPT_WRITING_SUBCOMMANDS).some(([m, sub]) =>
    new RegExp(`${m.replace(/\./g, "\\.")}\\W*\\s+${sub === null ? "\\S" : `${sub}\\b`}`).test(command),
  );
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
  /** The deciding module whose run printed this announcement (`RECEIPT_ANNOUNCING_MODULES`). */
  module: string;
  receiptPath: string;
  /** Index of the transcript line carrying the announcing tool_result. */
  line: number;
  /**
   * False when the file's bytes no longer hash to the digest its command
   * announced: rewritten after the announcement, so it authorises nothing.
   * An unreadable file stays intact here and is counted as unparseable later.
   */
  intact: boolean;
}

/** The session's announcements, plus the deciding commands whose shape the gate ignored. */
export interface AnnouncementScan {
  announcements: Announcement[];
  /** Bash commands naming a receipt-writing subcommand in a shape `invokedDecidingModule` rejects. */
  rejected: string[];
}

/** Whether the receipt file still carries the bytes its announcement hashed. */
function stillAnnounced(path: string, digest: string): boolean {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    return true; // unreadable: ignored and counted by the caller (§6)
  }
  return receiptDigest(bytes) === digest;
}

/**
 * Every receipt root announced in this session by a deciding command: a
 * `dpt-receipt: <path> sha256:<digest>` line inside the non-error tool_result
 * of a `Bash` tool_use that RAN a receipt-writing subcommand of a module in
 * `RECEIPT_ANNOUNCING_MODULES` (`invokedDecidingModule`). No other command
 * can print such a line into that tool_result, so a replayed `echo` of a spent
 * receipt's announcement is not an announcement at all. A receipt-writing run
 * writes exactly one receipt, so a result carrying more than one announcement
 * line announces none of them.
 */
export function announcedReceipts(lines: string[], sessionId: string): Announcement[] {
  return scanAnnouncements(lines, sessionId).announcements;
}

export function scanAnnouncements(lines: string[], sessionId: string): AnnouncementScan {
  const announcingBash = new Map<string, string>(); // tool_use id → the deciding module it ran
  const out: Announcement[] = [];
  const rejected: string[] = [];
  lines.forEach((line, idx) => {
    for (const b of contentBlocks(line)) {
      if (b.type === "tool_use" && b.name === "Bash" && typeof b.id === "string") {
        const cmd = b.input?.command;
        if (typeof cmd !== "string") continue;
        const module = invokedDecidingModule(cmd);
        if (module !== null) announcingBash.set(b.id, module);
        else if (rejectedDecidingCommand(cmd)) rejected.push(cmd);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        if (b.is_error === true || !announcingBash.has(b.tool_use_id)) continue;
        const found = resultText(b.content)
          .split("\n")
          .map((l) => parseReceiptAnnouncement(l))
          .filter((a): a is { path: string; digest: string | null } => a !== null);
        if (found.length !== 1) continue;
        const a = found[0]!;
        if (a.digest === null || !a.path.startsWith("/") || !sessionId) continue;
        const receiptPath = resolve(a.path);
        const root = receiptRootOf(receiptPath, sessionId);
        if (root !== null) {
          out.push({ root, module: announcingBash.get(b.tool_use_id)!, receiptPath, line: idx, intact: stillAnnounced(receiptPath, a.digest) });
        }
      }
    }
  });
  return { announcements: out, rejected };
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

const DECIDE_MODULE = "create_idempotency_probe.ts";
const DECIDE_CMD = `${DECIDE_MODULE} decide`;

/** §2 — a `createJiraIssue` whose type is not Epic, or a `save_issue` without `id`. */
export function isCreate(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "createJiraIssue") {
    const type = input.issueTypeName;
    return !(typeof type === "string" && type.trim().toLowerCase() === "epic");
  }
  if (tool === "save_issue") return input.id === undefined || input.id === null || input.id === "";
  return false;
}

/** The tracker call a transcript tool_use block made for `adapter` that `accept` admits, or null. */
function trackerCallIn(
  b: ContentBlock,
  adapter: WorkspaceAdapterKey,
  accept: (tool: string, input: Record<string, unknown>) => boolean,
): TrackerCall | null {
  if (b.type !== "tool_use" || typeof b.name !== "string") return null;
  const c = identifyTrackerCall({ tool_name: b.name, tool_input: b.input } as unknown as HookPayload);
  return c && c.adapter === adapter && accept(c.tool, c.input) ? c : null;
}

/** The ticket create call a transcript tool_use block made for `adapter`, or null. */
function createCallIn(b: ContentBlock, adapter: WorkspaceAdapterKey): TrackerCall | null {
  return trackerCallIn(b, adapter, isCreate);
}

/**
 * Which tool_uses count as creates for the spending walk (`createsBefore`) and
 * the lost-create walk (`lostCreates`), and the shape each is compared by: the
 * ticket creates of §4, or the milestone-container creates of STE-608.
 */
interface CreateKind {
  pick: (b: ContentBlock, adapter: WorkspaceAdapterKey) => TrackerCall | null;
  shape: (c: TrackerCall) => CreateShape;
}

const TICKET_CREATES: CreateKind = {
  pick: createCallIn,
  shape: (c) => callShape(c.adapter, c.input),
};

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

/**
 * Container names compare case-insensitively: Jira project keys and Linear
 * team keys are matched by the trackers without regard to case, so `gf` is
 * `GF` and must not slip through as an undeclared container (§3).
 */
function sameName(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").toUpperCase() === (b ?? "").toUpperCase();
}

function bindsContainer(adapter: WorkspaceAdapterKey, b: WorkspaceBinding, c: CreateShape): boolean {
  if (adapter === "jira") return b.project !== undefined && sameName(b.project, c.project);
  return (c.project !== "" && b.project !== undefined && sameName(b.project, c.project)) ||
    (c.team !== "" && b.team !== undefined && sameName(b.team, c.team));
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
      ? !sameName(call.project, receipt.project)
      : (call.project !== "" || receipt.project !== "") && !sameName(call.project, receipt.project);
  const teamDiffers = adapter === "linear" && call.team !== "" && receipt.team !== "" && !sameName(call.team, receipt.team);
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
  if (!sameName(call.container, receipt.container)) {
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

/**
 * The create tool_uses ordered BEFORE the gated call, in transcript order
 * (line, then position within an assistant message).
 *
 * Claude Code writes a tool_use to the transcript BEFORE its PreToolUse hook
 * runs (measured on a live transcript), so the gated call — and every parallel
 * sibling of its assistant turn — is already there, run or not. Receipts are
 * allocated in this order whether or not a create has run yet: two creates in
 * one turn cannot both take one receipt, however their hooks interleave. The
 * gated call's own tool_use never spends (it is where the walk stops); when it
 * is absent from the transcript it is taken to come after every other create.
 */
function createsBefore(
  lines: string[],
  adapter: WorkspaceAdapterKey,
  gatedId: string | undefined,
  kind: CreateKind = TICKET_CREATES,
): Array<{ line: number; shape: CreateShape }> {
  const out: Array<{ line: number; shape: CreateShape }> = [];
  for (let idx = 0; idx < lines.length; idx++) {
    for (const b of contentBlocks(lines[idx]!)) {
      if (gatedId !== undefined && b.id === gatedId) return out;
      const c = kind.pick(b, adapter);
      if (c) out.push({ line: idx, shape: kind.shape(c) });
    }
  }
  return out;
}

/** `toolDenialKind` values Claude Code records on a tool call that never ran. */
const NEVER_RAN_DENIALS: ReadonlySet<string> = new Set(["permission-rule", "automode-blocked", "automode-unavailable", "user-rejected"]);

/**
 * Whether an error tool_result proves its call never reached the tracker: a
 * PreToolUse hook or permission denial, a user rejection, or an input the
 * harness refused to send. Claude Code writes these records; the model cannot.
 * A timeout, a server error or an interrupt proves nothing: the create may
 * have made the ticket.
 */
function neverRan(p: ParsedLine, b: ContentBlock): boolean {
  const kind = p.raw.toolDenialKind;
  if (typeof kind === "string") return NEVER_RAN_DENIALS.has(kind);
  const text = resultText(b.content).trimStart();
  return (
    text.startsWith("PreToolUse:") ||
    text.startsWith("The user doesn't want to proceed") ||
    text.startsWith("<tool_use_error>InputValidationError") ||
    trackerRejected(text)
  );
}

/** A 4xx status the tracker answered with — 408 (Request Timeout) excluded: that one proves nothing. */
const TRACKER_4XX = /\b(?:error|status(?:\s+code)?|http)\b[:\s]*4(?!08)\d\d\b/i;
/** Words that make any answer ambiguous: the request may have been processed. */
const MAY_HAVE_RUN = /time[ds]?[\s-]*out|\b5\d\d\b|interrupt|aborted|reset/i;

/**
 * A definite rejection by the tracker: the result names a 4xx status (the
 * request was refused before anything was written — a validation error, a
 * forbidden field, a missing project), and nothing in it suggests the request
 * may have run anyway. A timeout, a 5xx and an interrupt stay lost (§4).
 */
function trackerRejected(text: string): boolean {
  return TRACKER_4XX.test(text) && !MAY_HAVE_RUN.test(text);
}

interface LostCreate {
  id: string;
  shape: CreateShape;
  why: string;
}

/**
 * §4 — create tool_uses of an EARLIER turn than the gated call whose outcome is
 * unknown: an error result that does not prove the call never ran (a timeout,
 * a 5xx, an interrupt), or no result at all. Such a create may have made its
 * ticket, and a tracker search can lag its index, so an honest re-run of
 * `decide --attempt fast` can miss it (the GF-90/GF-91 double create). Parallel
 * siblings of the gated call are pending, not lost.
 */
function lostCreates(
  parsed: Array<ParsedLine | null>,
  adapter: WorkspaceAdapterKey,
  gatedId: string | undefined,
  kind: CreateKind = TICKET_CREATES,
): LostCreate[] {
  const gatedLine = gatedId === undefined ? -1 : parsed.findIndex((p) => p?.blocks.some((b) => b.id === gatedId) ?? false);
  const creates = new Map<string, { line: number; shape: CreateShape }>();
  const outcome = new Map<string, string | null>(); // id → why it is lost, or null when it is settled
  parsed.forEach((p, idx) => {
    if (!p) return;
    for (const b of p.blocks) {
      if (b.type === "tool_use" && typeof b.id === "string" && b.id !== gatedId) {
        const c = kind.pick(b, adapter);
        if (c) creates.set(b.id, { line: idx, shape: kind.shape(c) });
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string" && creates.has(b.tool_use_id)) {
        const lost = b.is_error === true && !neverRan(p, b);
        outcome.set(b.tool_use_id, lost ? `its result was an error: ${resultText(b.content).trim().split("\n")[0]!.slice(0, 120)}` : null);
      }
    }
  });
  const out: LostCreate[] = [];
  for (const [id, c] of creates) {
    if (gatedLine >= 0 && c.line >= gatedLine) continue;
    const why = outcome.has(id) ? outcome.get(id)! : gatedLine >= 0 ? "it has no result" : null;
    if (why !== null) out.push({ id, shape: c.shape, why });
  }
  return out;
}

/** The same ticket: title (normalized), project and container — labels aside. */
function sameTicket(a: CreateShape, b: CreateShape): boolean {
  return (
    normalizeTitleForCompare(a.title) === normalizeTitleForCompare(b.title) &&
    sameName(a.project, b.project) &&
    sameName(a.container, b.container)
  );
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Linear project slug (`<name>-<12 hex>`) or its bare slug id. */
const LINEAR_SLUG_SHAPE = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[0-9a-f]{12}$/;

/**
 * §4 — a create's container named by an opaque id the declaration cannot be
 * compared with: a Linear team or project UUID, a Linear project slug, or a
 * numeric Jira project id. Returns the offending value, or null.
 */
function opaqueContainer(adapter: WorkspaceAdapterKey, c: CreateShape): string | null {
  if (adapter === "jira") return /^\d+$/.test(c.project) ? c.project : null;
  if (UUID_SHAPE.test(c.team)) return c.team;
  if (UUID_SHAPE.test(c.project) || LINEAR_SLUG_SHAPE.test(c.project)) return c.project;
  return null;
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
  if (binding.length === 0) {
    // §4 — an id or slug cannot be told apart from a declared container, so it
    // is refused as unresolvable; a plainly named other container is not ours.
    const opaque = opaqueContainer(call.adapter, shape);
    if (opaque === null) return 0; // §3 — no declared target binds this container
    return refuse(
      `${call.tool} names its container by the id "${opaque}", which cannot be resolved against the declared targets ${declared.map((d) => `${d.root} (${d.binding.team ? `team ${d.binding.team}, ` : ""}project ${d.binding.project ?? "none"})`).join(", ")}.${note}`,
      `name the ${call.adapter === "jira" ? "project by its key" : "team and project by the names the declaration uses"}, as the createPayload ${DECIDE_CMD} printed does, then retry.`,
    );
  }
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
  const where = `${call.tool} in ${target.root}`;

  // §4 — after a create whose outcome is unknown, no create receipt — fresh or
  // not — authorises another create of that ticket: only the retry path, which
  // finds it and reuses it, proceeds.
  const lost = lostCreates(parseLines(transcript), call.adapter, call.toolUseId).find((c) => sameTicket(c.shape, shape));
  if (lost) {
    return refuse(
      `${where}: an earlier create of "${shape.title}" (${lost.id}) may have made the ticket — ${lost.why} — so no create receipt authorises another create of it; a fresh \`--attempt fast\` search can miss a ticket the tracker has not indexed yet.${note}`,
      `run ${DECIDE_CMD} --attempt retry-<N> (${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt retry-<N>")}) to search for it: a \`reused\` decision writes a reuse receipt that lets you write to that ticket. When retry-3 still misses, ask the operator with AskUserQuestion to search the tracker for the ticket by hand: if it exists, save it as <ticket.json> and run ${acceptedShape("ticket_ownership.ts", "<projectRoot> <KEY> <ticket.json>")} to write to it; if it does not, the operator creates it by hand — no receipt in this session authorises another create of it.`,
    );
  }

  const seen: CreateReceiptSeen[] = [];
  for (const a of announcements) {
    if (a.root !== target.root || !a.intact) continue;
    const r = readCreateReceipt(a.receiptPath, sessionId, call.adapter);
    if (r) seen.push({ line: a.line, path: a.receiptPath, shape: r, spent: false });
  }
  // §4 — each receipt authorises exactly ONE create tool_use after its announcement.
  for (const c of createsBefore(transcript, call.adapter, call.toolUseId)) {
    const hit = seen.find((r) => !r.spent && r.line < c.line && createMismatch(call.adapter, c.shape, r.shape, tag) === null);
    if (hit) hit.spent = true;
  }
  const matching = seen.filter((r) => createMismatch(call.adapter, shape, r.shape, tag) === null);
  if (matching.some((r) => !r.spent)) return 0;

  if (matching.length > 0) {
    return refuse(
      `${where}: its create receipt (${matching[matching.length - 1].path}) is spent — another create took it, and a create that timed out may still have made the ticket.${note}`,
      `run ${DECIDE_CMD} --attempt retry-<N> (${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt retry-<N>")}) to search for the ticket that create may have made: a \`reused\` decision writes a reuse receipt that lets you write to that ticket. In a shared repository a retry never authorises another create. When retry-3 still misses, ask the operator with AskUserQuestion to search the tracker for the ticket by hand: if it exists, save it as <ticket.json> and run ${acceptedShape("ticket_ownership.ts", "<projectRoot> <KEY> <ticket.json>")} to write to it; if it does not, the operator creates it by hand — no receipt in this session authorises another create of it.`,
    );
  }
  if (seen.length > 0) {
    const last = seen[seen.length - 1];
    return refuse(
      `${where}: the call does not match its create receipt (${last.path}): ${createMismatch(call.adapter, shape, last.shape, tag)}.${note}`,
      `send the payload ${DECIDE_CMD} decided, or run ${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt fast")} again for this one ${PLAIN_RULE}, then retry.`,
    );
  }
  return refuse(
    `${where}: no create receipt announced by ${DECIDE_CMD} in this session authorises it.${note}`,
    `run ${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt fast")} in ${target.root} for this ticket ${PLAIN_RULE}, then retry.`,
  );
}

// ---------------------------------------------------------------------------
// §4 — tickets: a subject the target owns
// ---------------------------------------------------------------------------

const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

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
  const declared = adapter === "jira" ? b.project : b.team;
  return declared !== undefined && sameName(declared, prefix);
}

function namesKey(text: string, key: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9-])${key.replace(/[-]/g, "\\-")}(?![0-9A-Za-z])`).test(text);
}

/**
 * The ONE key a create's result names as created: the top-level `key` (Jira)
 * or `identifier` (Linear), or the same field of a top-level `issue`. Every
 * other key the result echoes — a parent Epic, a linked sibling — was not
 * created by this call. A result that is not JSON falls back to the first key
 * carrying the create's own Jira project prefix, and otherwise names nothing.
 */
function createdKeyOf(text: string, call: TrackerCall): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    for (const f of ["key", "identifier"]) {
      const v = r[f];
      if (typeof v === "string" && TICKET_KEY.test(v)) return v.toUpperCase();
    }
    return null;
  };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null;
    return pick(parsed) ?? pick(parsed?.issue);
  } catch {
    const project = callShape(call.adapter, call.input).project;
    if (call.adapter !== "jira" || project === "") return null;
    for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]*-\d+/g)) {
      if (keyPrefix(m[0]).toUpperCase() === project.toUpperCase()) return m[0].toUpperCase();
    }
    return null;
  }
}

/**
 * Keys a create tool_use of this session — a ticket create, or an Epic create
 * the milestone decision permitted — returned as created in its paired,
 * non-error tool_result.
 */
function createdKeys(parsed: Array<ParsedLine | null>, adapter: WorkspaceAdapterKey): Set<string> {
  const creates = new Map<string, TrackerCall>();
  const out = new Set<string>();
  for (const p of parsed) {
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type === "tool_use") {
        const c = createCallIn(b, adapter) ?? MILESTONE_CREATES.pick(b, adapter);
        if (typeof b.id === "string" && c) creates.set(b.id, c);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const c = creates.get(b.tool_use_id);
        if (b.is_error === true || !c) continue;
        const key = createdKeyOf(resultText(b.content).trim(), c);
        if (key !== null) out.add(key);
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
    if (a.root !== root || !a.intact) continue;
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
    `run ${acceptedShape("ticket_ownership.ts", "<projectRoot> <KEY> <ticket.json> [--adopt]")} (or, after an answered import question, ${acceptedShape("container_ownership.ts", "<projectRoot> <KEY> <page.json>...")}) in ${targetRoots} for ${named.join(", ")} ${PLAIN_RULE}, then retry.`,
  );
}

// ---------------------------------------------------------------------------
// §5 — containers: decided against a `milestone-decision` receipt (STE-608)
// ---------------------------------------------------------------------------

/** The decision front door: the ONE module whose receipts decide a container write. */
const RESOLVE_MODULE = "resolve_milestone_identity.ts";

function frontDoor(what: "--title <title>" | "--join-key <key>"): string {
  return acceptedShape(RESOLVE_MODULE, `<projectRoot> <jira|linear> <project> <listing.json> ${what}`);
}

/** §5 — the kind a container call writes, named in its refusal. */
function containerKind(tool: string): string {
  if (tool === "createJiraIssue" || tool === "save_milestone") return "milestone";
  if (tool === "save_project") return "project";
  if (/label/.test(tool)) return "label";
  if (/status_update/.test(tool)) return "status update";
  return "document";
}

/** A container create the front door can decide: an Epic create, or a `save_milestone` without `id`. */
function isMilestoneCreate(tool: string, input: Record<string, unknown>): boolean {
  if (tool === "createJiraIssue") return !isCreate(tool, input);
  return tool === "save_milestone" && (input.id === undefined || input.id === null || input.id === "");
}

/** The milestone-container creates, for the shared spending and lost-create walks (one decision, one create). */
const MILESTONE_CREATES: CreateKind = {
  pick: (b, adapter) => trackerCallIn(b, adapter, isMilestoneCreate),
  shape: (c) => {
    const i = c.input;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return c.adapter === "jira"
      ? { project: text(i.projectKey), team: "", title: text(i.summary), labels: [], container: "" }
      : { project: text(i.project), team: "", title: text(i.name), labels: [], container: "" };
  },
};

interface MilestoneDecision {
  line: number;
  path: string;
  project: string;
  act: "create" | "join";
  key: string;
  /** The `--title` the decision was made for; null on a join by key. */
  title: string | null;
  milestoneId: string;
  /** The Epic's labels as listed (Jira joins only). */
  labels: string[];
}

/**
 * The `milestone-decision` receipts of this session in `roots`, in transcript
 * order — each announced by a run of the decision front door itself. A receipt
 * of that kind announced by any other deciding module, rewritten after its
 * announcement, unreadable, malformed, or written for another session or
 * adapter counts as absent.
 */
function milestoneDecisions(
  announcements: Announcement[],
  roots: ReadonlySet<string>,
  sessionId: string,
  adapter: WorkspaceAdapterKey,
): MilestoneDecision[] {
  const out: MilestoneDecision[] = [];
  for (const a of announcements) {
    if (a.module !== RESOLVE_MODULE || !a.intact || !roots.has(a.root)) continue;
    const r = readSessionReceipt(a.receiptPath, sessionId, adapter);
    if (!r || r.kind !== "milestone-decision" || typeof r.container !== "string") continue;
    const ev = r.evidence && typeof r.evidence === "object" ? (r.evidence as Record<string, unknown>) : null;
    if (!ev || (ev.act !== "create" && ev.act !== "join")) continue;
    out.push({
      line: a.line,
      path: a.receiptPath,
      project: r.container,
      act: ev.act,
      key: typeof ev.key === "string" ? ev.key : "",
      title: typeof ev.title === "string" ? ev.title : null,
      milestoneId: typeof ev.milestoneId === "string" ? ev.milestoneId : "",
      labels: stringList(ev.labels),
    });
  }
  return out;
}

/** A create decision for the same project and a byte-equal title (AC-STE-608.10 a/b). */
function decides(d: MilestoneDecision, c: CreateShape): boolean {
  return d.act === "create" && sameName(d.project, c.project) && d.title === c.title;
}

function gateMilestoneCreate(
  call: TrackerCall,
  sessionId: string,
  transcript: string[],
  announcements: Announcement[],
  targets: DeclaredTarget[],
  where: string,
  note: string,
): ExitCode {
  const want = MILESTONE_CREATES.shape(call);
  const name = call.adapter === "jira" ? "Epic" : "project milestone";
  const lost = lostCreates(parseLines(transcript), call.adapter, call.toolUseId, MILESTONE_CREATES).find((c) =>
    sameTicket(c.shape, want),
  );
  if (lost) {
    return refuse(
      `${where}: an earlier create of the ${name} "${want.title}" (${lost.id}) may have made it — ${lost.why} — so no decision authorises another create of it.${note}`,
      `list project ${want.project}'s containers again, save that listing, and run ${frontDoor("--title <title>")} ${PLAIN_RULE}: a listing that holds the ${name} decides a join, and nothing is created. If it still misses, ask the operator with AskUserQuestion to search the tracker by hand.`,
    );
  }
  const roots = new Set(targets.map((t) => t.root));
  const seen = milestoneDecisions(announcements, roots, sessionId, call.adapter).map((d) => ({ ...d, spent: false }));
  // One create decision authorises ONE container create after its announcement.
  for (const c of createsBefore(transcript, call.adapter, call.toolUseId, MILESTONE_CREATES)) {
    const hit = seen.find((d) => !d.spent && d.line < c.line && decides(d, c.shape));
    if (hit) hit.spent = true;
  }
  const matching = seen.filter((d) => decides(d, want));
  if (matching.some((d) => !d.spent)) return 0;
  if (matching.length > 0) {
    return refuse(
      `${where}: its create decision (${matching[matching.length - 1]!.path}) is spent — another create of the ${name} "${want.title}" took it, and that create may have made it.${note}`,
      `list project ${want.project}'s containers again and run ${frontDoor("--title <title>")} ${PLAIN_RULE}: a listing holding the ${name} decides a join; a create decision authorises one create only.`,
    );
  }
  const last = seen[seen.length - 1];
  const why = last
    ? `the latest milestone decision (${last.path}) is a ${last.act}${last.act === "join" ? ` of ${last.key}` : ` of "${last.title}" in project ${last.project}`}, not a create of "${want.title}" in project ${want.project}`
    : `no milestone-decision receipt announced by ${RESOLVE_MODULE} in this session decides it`;
  return refuse(
    `${where}: the ${name} create of "${want.title}" in project ${want.project} is not decided — ${why}.${note}`,
    `save project ${want.project}'s container listing and run ${frontDoor("--title <title>")} in ${[...roots].join(", ")} with this exact title ${PLAIN_RULE}; a create decision permits this create, a join decision names the existing key to use instead.`,
  );
}

/**
 * §5 — a `container` call in a declared target, decided (AC-STE-608.10): an
 * Epic create or a `save_milestone` without `id` needs a create decision; no
 * toolkit flow edits a milestone, writes a project, or retires, restores or
 * renames a label; the one other permitted write is a `create_issue_label`
 * of the target's own `repo_tag`.
 */
function gateContainer(
  call: TrackerCall,
  sessionId: string,
  transcript: string[],
  announcements: Announcement[],
  declared: DeclaredTarget[],
  note: string,
): ExitCode {
  const kind = containerKind(call.tool);
  const shape = callShape(call.adapter, call.input);
  let targets = declared;
  if (shape.project !== "" || shape.team !== "") {
    targets = declared.filter((d) => bindsContainer(call.adapter, d.binding, shape));
    if (targets.length === 0) {
      const opaque = opaqueContainer(call.adapter, shape);
      if (opaque === null) return 0; // §3 — no declared target binds this container
      return refuse(
        `${call.tool} names its container by the id "${opaque}", which cannot be resolved against the declared targets ${declared.map((d) => d.root).join(", ")}.${note}`,
        `name the ${call.adapter === "jira" ? "project by its key" : "team and project by the names the declaration uses"} and decide the ${kind} with ${frontDoor("--title <title>")}, then retry.`,
      );
    }
  }
  const where = `${call.tool} (a ${kind} write) in ${targets.map((t) => t.root).join(", ")}`;
  const decideRemedy = `milestone containers are decided by ${frontDoor("--title <title>")} (or \`--join-key <key>\` to take an existing one) ${PLAIN_RULE}`;

  if (isMilestoneCreate(call.tool, call.input)) {
    return gateMilestoneCreate(call, sessionId, transcript, announcements, targets, where, note);
  }
  if (call.tool === "save_milestone") {
    return refuse(
      `${where}: a save_milestone with an id edits an existing milestone, and no toolkit flow edits one.${note}`,
      `to use an existing milestone, join it — ${frontDoor("--join-key <key>")} writes nothing to it; to make a new one, ${decideRemedy}.`,
    );
  }
  if (call.tool === "save_project") {
    return refuse(
      `${where}: no toolkit flow writes a project.${note}`,
      `leave the project to a person in the tracker; ${decideRemedy}.`,
    );
  }
  if (call.tool === "create_issue_label") {
    const name = typeof call.input.name === "string" ? call.input.name : "";
    if (name !== "" && targets.some((t) => t.binding.repoTag === name)) return 0;
    return refuse(
      `${where}: create_issue_label "${name}" is not a declared target's repo tag (${targets.map((t) => t.binding.repoTag ?? "none").join(", ")}), and no toolkit flow creates any other label.${note}`,
      `create only this repository's own tag label (name = its repo_tag); ${decideRemedy}.`,
    );
  }
  if (/^(retire|restore)_/.test(call.tool) || (/label/.test(call.tool) && call.input.id !== undefined)) {
    return refuse(
      `${where}: a label retire, restore or rename is always refused — it can strip a sibling repository's tag from every ticket.${note}`,
      `leave the label to a person in the tracker; ${decideRemedy}.`,
    );
  }
  return refuse(
    `${where}: no toolkit flow performs a ${kind} write.${note}`,
    `leave the ${kind} to a person in the tracker; ${decideRemedy}.`,
  );
}

/**
 * AC-STE-608.10 (d) — an `editJiraIssue` writing `labels` on an Epic a
 * `milestone-decision` receipt records as joined is a read-merge: the payload
 * keeps every label that receipt listed plus the milestone label, or it is the
 * SET that clobbers a sibling's labels. Null when the rule does not apply (the
 * call then stays under the ownership rule of §4).
 */
function gateJoinedLabels(
  call: TrackerCall,
  sessionId: string,
  announcements: Announcement[],
  declared: DeclaredTarget[],
  note: string,
): ExitCode | null {
  if (call.adapter !== "jira" || call.tool !== "editJiraIssue") return null;
  const fields = call.input.fields;
  if (!fields || typeof fields !== "object" || !("labels" in (fields as Record<string, unknown>))) return null;
  const keys = subjectKeys(call);
  if (keys.length !== 1) return null;
  const key = keys[0]!;
  const targets = declared.filter((d) => bindsKey(call.adapter, d.binding, key));
  if (targets.length === 0) return null;
  const roots = new Set(targets.map((t) => t.root));
  const joins = milestoneDecisions(announcements, roots, sessionId, call.adapter).filter(
    (d) => d.act === "join" && d.key.toUpperCase() === key,
  );
  const join = joins[joins.length - 1];
  if (!join) return null;
  let milestone: string | null;
  try {
    milestone = milestoneLabel(join.milestoneId);
  } catch {
    milestone = null;
  }
  const labels = stringList((fields as Record<string, unknown>).labels);
  const required = milestone === null ? join.labels : [...join.labels, milestone];
  const missing = required.filter((l) => !labels.includes(l));
  if (milestone !== null && missing.length === 0) return 0;
  return refuse(
    `editJiraIssue on ${key}, an Epic joined by ${join.path}: the labels [${labels.join(", ")}] ${milestone === null ? `cannot be checked — the receipt names no milestone id` : `drop ${missing.map((l) => `"${l}"`).join(", ")}`}; a labels write replaces the whole set, so it would clobber the labels the listing showed.${note}`,
    `send the \`labels=\` value ${frontDoor("--join-key <key>")} printed for ${key} — every listed label plus the milestone label — or run it again on a fresh listing ${PLAIN_RULE}, then retry.`,
  );
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
    return bindsContainer(call.adapter, d.binding, shape) || opaqueContainer(call.adapter, shape) !== null;
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
function unreadableInputsNote(payload: HookPayload, transcript: string[] | null, scan: AnnouncementScan): string {
  const { announcements } = scan;
  if (transcript === null) {
    return ` The session transcript (${payload.transcript_path || "no transcript_path"}) is unreadable, so no announced receipt roots or session-created keys were counted.`;
  }
  let unparseable = 0;
  let rewritten = 0;
  for (const a of announcements) {
    if (!a.intact) {
      rewritten++;
      continue;
    }
    try {
      JSON.parse(readFileSync(a.receiptPath, "utf-8"));
    } catch {
      unparseable++;
    }
  }
  const notes: string[] = [];
  if (unparseable > 0) notes.push(` ${unparseable} announced receipt file(s) failed to parse and were ignored.`);
  if (rewritten > 0) notes.push(` ${rewritten} announced receipt file(s) changed after their announcement and were ignored.`);
  if (scan.rejected.length > 0) {
    const last = scan.rejected[scan.rejected.length - 1]!;
    notes.push(
      ` ${scan.rejected.length} Bash command(s) ran a deciding subcommand in a shape that is not a plain invocation, so any receipt they wrote was ignored — the latest: \`${last.length > 240 ? `${last.slice(0, 240)}…` : last}\`.`,
    );
  }
  return notes.join("");
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
  const scan = scanAnnouncements(lines, sessionId);
  const announcements = scan.announcements;
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

  const note = unreadableInputsNote(payload, transcript, scan);
  if (isCreate(call.tool, call.input)) return gateCreate(call, sessionId, lines, announcements, declared, note);
  if (isContainer(call.tool, call.input)) return gateContainer(call, sessionId, lines, announcements, declared, note);
  const joined = gateJoinedLabels(call, sessionId, announcements, declared, note);
  if (joined !== null) return joined;
  return gateTicket(call, sessionId, lines, announcements, declared, note);
}

/**
 * The entry's exit code. An exception inside the gate refuses (exit 2) naming
 * it: Claude Code treats any exit but 2 — a crash's exit 1 included — as
 * non-blocking, so a gate that threw would let the very write it exists to
 * check go through (fail-open).
 */
export function exitCodeFor(stdin: string, gate: (stdin: string) => ExitCode = run): ExitCode {
  try {
    return gate(stdin);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return refuse(
      `the tracker-write gate failed while checking this call (${msg}), so the write is not known to be safe.`,
      `report the error; a person may perform the write by hand once it is confirmed to belong to this repository.`,
    );
  }
}

if (import.meta.main) {
  const code = exitCodeFor(await Bun.stdin.text());
  // 0 permit, 2 refusal — every refuse(…) above.
  process.exit(code satisfies 0 | 2);
}
