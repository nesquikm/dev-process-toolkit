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
// STE-649 widened the gated list to 27 names (STE-607's archived 26 plus
// `addTeamworkGraphContext`) and made both link tools — `createIssueLink` and
// the Teamwork Graph link — refuse a Jira-item side that resolves to no key.
//
// The stdin entry is guarded by `import.meta.main`, so importing this module
// for its constants has no side effect.

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { emitNFR10, parseHookPayload, readTranscriptLines, RECEIPT_RESULT_WAIT_MS, type HookPayload } from "../session.ts";
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
import { containerListingRowsComplete, governingDecision, isCanonicalContainerListing, normalizeMilestoneTitle } from "../../../../adapters/_shared/src/milestone_token.ts";
import { resolveInterviewAnswer } from "../../../../adapters/_shared/src/auto_answers.ts";
import { exemptsJoinConsent } from "../../../../adapters/_shared/src/join_consent_ownership.ts";
import { checkVersionFloor, runningDptVersion } from "../../../../adapters/_shared/src/dpt_version.ts";
// The ONE reading of "which command ran which module" (M_85e846 review). Both
// this gate and the gate-receipt front door reach it here; a second copy is how
// the two gates came to disagree about the one rule.
import { bunInvocation, realpathOr } from "../../../../adapters/_shared/src/shell_invocations.ts";
import { listingRequestCursor, readTrackerItem, readTrackerListing, trackerItemKey } from "../../../../adapters/_shared/src/tracker_answer.ts";

/** Kept exported from here, where it was declared until the two gates started sharing it. */
export { simpleCommandWords } from "../../../../adapters/_shared/src/shell_invocations.ts";

export const HOOK_NAME = "pre-tracker-write-gate";

// ---------------------------------------------------------------------------
// §1 — the ONE list the hooks.json matcher is generated from: 27 names, 7
// Atlassian + 20 Linear (STE-649 amends STE-607's 26 with addTeamworkGraphContext)
// ---------------------------------------------------------------------------

const ATLASSIAN_WRITE_TOOLS = [
  "createJiraIssue",
  "editJiraIssue",
  "transitionJiraIssue",
  "addCommentToJiraIssue",
  "addWorklogToJiraIssue",
  "createIssueLink",
  "addTeamworkGraphContext",
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

/** §1 — inventory names that only read (adapters/_shared/data/tracker-tool-inventory.json, AC-STE-607.2). */
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
  "get_triage_responsibility",
  "get_user",
  "get_workspace",
  "list_agent_skills",
  "list_comments",
  "list_custom_views",
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
 * `null` marks a module with NO subcommand — the decision front door (STE-608)
 * and the attach front door (STE-611): its whole CLI is the one receipt-writing
 * front door, so its argv is checked by `NO_SUBCOMMAND_ARGV` instead. A module
 * listed with a subcommand never announces without it.
 */
export const RECEIPT_WRITING_SUBCOMMANDS: Readonly<Record<string, string | null>> = {
  "create_idempotency_probe.ts": "decide",
  "container_ownership.ts": "consent",
  "ticket_ownership.ts": "confirm",
  "resolve_milestone_identity.ts": null,
  "attach_project_milestone.ts": null,
};

export const RECEIPT_ANNOUNCING_MODULES: readonly string[] = Object.keys(RECEIPT_WRITING_SUBCOMMANDS);

/**
 * The argv a subcommand-less deciding module is accepted with, after the
 * module path: the decision front door's exact
 * `<projectRoot> <jira|linear> <project> <listingFile> --title|--join-key <v>`,
 * optionally followed by exactly `--sibling <path>` (STE-610 AC-STE-610.4), and
 * the attach front door's exact
 * `<projectRoot> <jira|linear> <project> <planFile> <listingFile>` (STE-611).
 */
const NO_SUBCOMMAND_ARGV: Readonly<Record<string, (args: string[]) => boolean>> = {
  "resolve_milestone_identity.ts": (a) =>
    (a.length === 6 || (a.length === 8 && a[6] === "--sibling")) &&
    (a[1] === "jira" || a[1] === "linear") &&
    (a[4] === "--title" || a[4] === "--join-key"),
  "attach_project_milestone.ts": (a) => a.length === 5 && (a[1] === "jira" || a[1] === "linear"),
};

/**
 * The accepted invocation of a deciding module, as every refusal shows it:
 * `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/<module>" [<subcommand>] …`.
 */
export function acceptedShape(module: string, args: string): string {
  const sub = RECEIPT_WRITING_SUBCOMMANDS[module];
  return `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${module}" ${sub ? `${sub} ` : ""}${args}`;
}

/** `ticket_ownership.ts decide` — read-only, so not a receipt-writing subcommand (STE-649). */
const DECIDE_OWNERSHIP_SHAPE = `bun run "\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/ticket_ownership.ts" decide <projectRoot> <ticket.json>`;

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

/**
 * STE-641 — the gated call's own tool_use line was not in the read when the
 * wait ran out. Not a refusal: the read is graded with the call placed after
 * every recorded line, as when the payload carries no tool_use_id.
 */
interface StaleRead {
  path: string;
  id: string;
}

/** STE-641 — refuse a create that duplicates a still-pending create in its own assistant turn. */
function refuseParallelDuplicate(where: string, subject: string, why: string, remedy: string, note: string): 2 {
  return refuse(
    `${where}: it duplicates ${subject}, a parallel create in the same assistant turn that has not finished, so ${why}.${note}`,
    `drop this parallel duplicate: ${remedy}`,
  );
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

/**
 * This hook's own plugin root: the deciding modules it trusts are ITS plugin's,
 * never a same-named file elsewhere. Same root the shared reader computes from
 * its own location, reached from this file instead.
 */
const OWN_PLUGIN_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

/**
 * The deciding module a Bash command RUNS to write a receipt, or null. The
 * command must be one `bun [run] <module path> <subcommand> …` invocation
 * under `simpleCommandWords`, the module path must be this plugin's own file
 * — a same-named file elsewhere, a module mentioned in an argument, or a
 * comment naming one runs nothing here — and the subcommand must be the
 * module's receipt-writing one (`RECEIPT_WRITING_SUBCOMMANDS`).
 */
export function invokedDecidingModule(command: string): string | null {
  const run = bunInvocation(command, OWN_PLUGIN_ROOT);
  if (run === null) return null;
  for (const m of RECEIPT_ANNOUNCING_MODULES) {
    if (run.module !== realpathOr(join(OWN_PLUGIN_ROOT, "adapters", "_shared", "src", m))) continue;
    const sub = RECEIPT_WRITING_SUBCOMMANDS[m];
    if (sub === null) return NO_SUBCOMMAND_ARGV[m]?.(run.args) === true ? m : null;
    return run.args[0] === sub ? m : null;
  }
  return null;
}

/**
 * A Bash command that names a deciding module's receipt-writing subcommand
 * but is NOT accepted by `invokedDecidingModule` — chained, redirected,
 * `cd`-prefixed, or quoted beyond the grammar. Its receipt is ignored, so the
 * refusal names it instead of leaving the model to repeat the same shape.
 * STE-650 AC.12 — the recogniser reads what RAN: `bun` spelled by an absolute
 * path, a `bash -c` body and a backslash-continued line count; a segment that
 * only echoes the invocation does not. The receipt's own accepted shape
 * (`invokedDecidingModule`) is unchanged.
 */
/** `bun` as a command word, bare or spelled by a path ending in `/bun` (STE-650 AC.12). */
const BUN_WORD = `(?:^|\\s)(?:[^\\s"'=]*/)?bun\\b`;
const DECIDING_MODULE_PATTERNS = Object.entries(RECEIPT_WRITING_SUBCOMMANDS).map(([m, sub]) => {
  const mod = m.replace(/\./g, "\\.");
  return {
    // `bun … <module>` then an optional closing quote, whitespace, and the
    // receipt subcommand (any argument for a module with no subcommand).
    direct: new RegExp(`${BUN_WORD}.*${mod}["']?\\s+${sub === null ? "\\S" : `${sub}\\b`}`),
    assigned: new RegExp(`(?:^|\\s)([A-Za-z_][A-Za-z0-9_]*)=\\S*${mod}`),
  };
});

function rejectedDecidingCommand(command: string): boolean {
  if (invokedDecidingModule(command) !== null) return false;
  // Only a segment that RUNS a deciding module under `bun` counts; one that
  // merely names it (`grep`, `rg`, `echo`) runs nothing and is not reported.
  // STE-650 AC.12 — a backslash-newline continuation is one line, a
  // `bash -c "…"` / `sh -c '…'` body is what runs, and a segment that only
  // hands the invocation to `echo`/`printf` as an argument runs nothing.
  const unwrapped = command
    .replace(/\\\r?\n/g, " ")
    .replace(/(?:^|(?<=[\s;&|(]))(?:\S*\/)?(?:ba|z|da)?sh\s+-c\s+(["'])([\s\S]*?)\1/g, (_m, _q, body: string) => ` ${body}`);
  const segments = unwrapped.split(/;|&&|\|\||\||\n/).filter((seg) => !/^\s*(?:echo|printf)\b/.test(seg));
  return DECIDING_MODULE_PATTERNS.some(({ direct, assigned }) => {
    if (segments.some((seg) => direct.test(seg))) return true;
    return segments.some((seg, i) => {
      const name = assigned.exec(seg)?.[1];
      if (name === undefined) return false;
      const viaVar = new RegExp(`${BUN_WORD}.*(?:\\$${name}\\b|"\\$${name}"|\\$\\{${name}\\})`);
      return segments.slice(i + 1).some((later) => viaVar.test(later));
    });
  });
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

/**
 * STE-649 (D-7) — the session id a receipt path belongs to when it sits
 * directly under `receiptsDir(<root>, <other>)` for a session other than
 * `sessionId`; null otherwise.
 */
function foreignSessionOf(path: string, sessionId: string): string | null {
  const abs = resolve(path);
  const other = basename(dirname(abs));
  if (other === sessionId) return null;
  const root = dirname(dirname(dirname(dirname(dirname(abs)))));
  try {
    return dirname(abs) === receiptsDir(root, other) ? other : null;
  } catch {
    return null;
  }
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
   * An unreadable file stays intact here and is counted as unreadable (with its errno) later.
   */
  intact: boolean;
}

/** The session's announcements, plus the deciding commands whose shape the gate ignored. */
export interface AnnouncementScan {
  announcements: Announcement[];
  /** Bash commands naming a receipt-writing subcommand in a shape `invokedDecidingModule` rejects. */
  rejected: string[];
  /** STE-649 (D-7) — accepted announcements of a receipt filed under another session's directory; they authorise nothing. */
  foreign: Array<{ path: string; session: string }>;
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
  const foreign: Array<{ path: string; session: string }> = [];
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
        } else {
          const session = foreignSessionOf(receiptPath, sessionId);
          if (session !== null) foreign.push({ path: receiptPath, session });
        }
      }
    }
  });
  return { announcements: out, rejected, foreign };
}

export function candidateRoots(payload: HookPayload, announcements: Announcement[]): string[] {
  return candidateRootsFrom(gitTopLevel(payload.cwd), announcements);
}

/** `candidateRoots` over an already-resolved cwd top level. */
function candidateRootsFrom(top: string | null, announcements: Announcement[]): string[] {
  const roots: string[] = [];
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

/** One front-door receipt: its announcement, its container, its evidence object. */
interface FrontDoorReceipt {
  announcement: Announcement;
  container: string;
  evidence: Record<string, unknown>;
}

/**
 * The `kind` receipts of this session and adapter in `roots`, in transcript
 * order, each announced by a run of `module` itself. A receipt of that kind
 * announced by any other module, rewritten after its announcement,
 * unreadable, or carrying no string container or no evidence object counts
 * as absent. Shared by the decision front door's and the attach front door's
 * readers, which differ only in the evidence they keep.
 */
function frontDoorReceipts(
  announcements: Announcement[],
  module: string,
  kind: string,
  roots: ReadonlySet<string>,
  sessionId: string,
  adapter: WorkspaceAdapterKey,
): FrontDoorReceipt[] {
  const out: FrontDoorReceipt[] = [];
  for (const a of announcements) {
    if (a.module !== module || !a.intact || !roots.has(a.root)) continue;
    const r = readSessionReceipt(a.receiptPath, sessionId, adapter);
    if (!r || r.kind !== kind || typeof r.container !== "string") continue;
    const ev = r.evidence && typeof r.evidence === "object" ? (r.evidence as Record<string, unknown>) : null;
    if (ev) out.push({ announcement: a, container: r.container, evidence: ev });
  }
  return out;
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
 * the prior-create walk (`priorCreates`), and the shape each is compared by: the
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
 * Claude Code does NOT write a tool_use to the transcript before its
 * PreToolUse hook reads it: it writes a message's tool_use lines when the
 * message list next changes — normally the first tool's result, AFTER the
 * first call's hook has returned (measured 2026-09-28, STE-641 § Measurement:
 * the first call's line landed after its own result). run() re-reads for up
 * to GATED_LINE_WAIT_MS, which can find a LATER call of a batch; a lone or
 * first call never appears, and its read is graded with the call placed after
 * every recorded line — never refused for the lag. Once the gated line is in,
 * every earlier line is too (the file is append-only). Receipts are allocated in
 * this order whether or not a create has run yet: two creates in one turn
 * cannot both take one receipt, however their hooks interleave. The gated
 * call's own tool_use never spends (it is where the walk stops); when it is
 * absent (no tool_use_id, a subagent call, a stale read) it is taken to come
 * after every other create.
 *
 * A create whose RECORDED result proves it never reached the tracker (`neverRan`:
 * a hook or permission refusal, a user rejection, a 4xx) took nothing, so it
 * spends nothing. Live Linear leg 2, step 17: a create matching its receipt was
 * refused by this hook for want of an attach-target receipt, the walk spent the
 * receipt on it anyway, and the corrected create was refused as "spent" with no
 * legal path left (`decide --attempt retry-1` answered miss). A create with no
 * result yet (a pending parallel sibling) or an ambiguous one (a timeout, a 5xx)
 * still spends, exactly as before.
 */
function createsBefore(
  parsed: Array<ParsedLine | null>,
  adapter: WorkspaceAdapterKey,
  gatedId: string | undefined,
  kind: CreateKind = TICKET_CREATES,
): Array<{ line: number; shape: CreateShape }> {
  const neverReached = new Set<string>();
  for (const p of parsed) {
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type === "tool_result" && typeof b.tool_use_id === "string" && b.is_error === true && neverRan(p, b)) neverReached.add(b.tool_use_id);
    }
  }
  const out: Array<{ line: number; shape: CreateShape }> = [];
  for (let idx = 0; idx < parsed.length; idx++) {
    for (const b of parsed[idx]?.blocks ?? []) {
      if (gatedId !== undefined && b.id === gatedId) return out;
      if (typeof b.id === "string" && neverReached.has(b.id)) continue;
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
  /** STE-641 — a pending sibling in the gated call's own assistant message. */
  parallel: boolean;
}

/** STE-642 — a create ordered before the gated call, in the state priorCreates gives it. */
interface PriorCreate extends LostCreate {
  /** `unkeyed` — a non-error result naming no created key, treated as lost. */
  state: "lost" | "settled" | "unkeyed";
  /** The key a `settled` create returned; "" otherwise. */
  key: string;
}

/** The assistant message id a transcript line carries, or "". */
function messageIdOf(p: ParsedLine): string {
  const m = p.raw.message as { id?: unknown } | undefined;
  return m && typeof m.id === "string" ? m.id : "";
}

/**
 * §4 / STE-642 — every create tool_use ordered BEFORE the gated call, each with
 * the state its recorded result gives it:
 *
 * - `lost` — an error result that does not prove the call never ran (a
 *   timeout, a 5xx, an interrupt), or no result at all. Such a create may have
 *   made its ticket, and a tracker search can lag its index, so an honest
 *   re-run of `decide --attempt fast` can miss it (the GF-90/GF-91 double
 *   create). `why` says which.
 * - `settled` — a non-error result naming the key it created (createdKeyOf,
 *   or createdMilestoneIdOf for a Linear save_milestone). The gates refuse a
 *   second same-ticket create naming that key, with no fresh-decide remedy:
 *   no receipt, fresh or not, authorises it.
 * - `unkeyed` — a non-error result naming no created key. The create happened
 *   but its ticket is unknown, so the gates treat it as `lost`.
 *
 * A create whose error result proves it never ran (`neverRan`) is excluded.
 *
 * Creates are ordered by a running (line, position) ordinal over tool_use
 * blocks, as createsBefore walks them, so the one-line-per-message and the
 * one-line-per-tool_use layouts order them alike. When the gated call's own
 * line is in the read — a later call of a batch, found by the wait in run() —
 * a no-result create ordered before it counts: if it shares the gated call's
 * assistant message it is a same-turn sibling, `parallel` marks it, and the
 * gates refuse the call as a parallel duplicate rather than point at the
 * retry search. When the line is NOT in the read — a lone or first call,
 * whose line Claude Code writes only after its hook returns (STE-641
 * § Re-cut), a payload with no tool_use_id, or a subagent's call — the call is
 * placed after every recorded line and a create with no result yet is not
 * counted as lost, exactly as at v2.90.0.
 */
function priorCreates(
  parsed: Array<ParsedLine | null>,
  adapter: WorkspaceAdapterKey,
  gatedId: string | undefined,
  kind: CreateKind = TICKET_CREATES,
): PriorCreate[] {
  // STE-641 — a running (line, position) ordinal over tool_use blocks, as
  // createsBefore walks them: both transcript layouts order creates alike.
  let ordinal = 0;
  let gatedOrdinal = -1;
  let gatedLine = -1;
  let gatedMessage = "";
  const creates = new Map<string, { ordinal: number; line: number; message: string; shape: CreateShape; call: TrackerCall }>();
  const outcome = new Map<string, string | null>(); // id → why it is lost, or null when it is settled
  const keys = new Map<string, string>(); // id → the key a settled create returned
  const succeeded = new Set<string>(); // ids whose result was not an error
  parsed.forEach((p, idx) => {
    if (!p) return;
    for (const b of p.blocks) {
      if (b.type === "tool_use") ordinal++;
      if (b.type === "tool_use" && gatedId !== undefined && b.id === gatedId && gatedOrdinal < 0) {
        gatedOrdinal = ordinal;
        gatedLine = idx;
        gatedMessage = messageIdOf(p);
      }
      if (b.type === "tool_use" && typeof b.id === "string" && b.id !== gatedId) {
        const c = kind.pick(b, adapter);
        if (c) creates.set(b.id, { ordinal, line: idx, message: messageIdOf(p), shape: kind.shape(c), call: c });
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string" && creates.has(b.tool_use_id)) {
        const lost = b.is_error === true && !neverRan(p, b);
        outcome.set(b.tool_use_id, lost ? `its result was an error: ${resultText(b.content).trim().split("\n")[0]!.slice(0, 120)}` : null);
        const made = creates.get(b.tool_use_id)!;
        const text = resultText(b.content).trim();
        const key = b.is_error === true ? null : createdKeyOf(text, made.call) ?? (kind === MILESTONE_CREATES && adapter === "linear" ? createdMilestoneIdOf(text) : null);
        if (key !== null) keys.set(b.tool_use_id, key);
        if (b.is_error !== true) succeeded.add(b.tool_use_id);
      }
    }
  });
  const out: PriorCreate[] = [];
  for (const [id, c] of creates) {
    if (gatedOrdinal >= 0 && c.ordinal >= gatedOrdinal) continue;
    const key = keys.get(id);
    if (key !== undefined) {
      out.push({ id, shape: c.shape, why: "", parallel: false, state: "settled", key });
      continue;
    }
    if (succeeded.has(id)) {
      out.push({ id, shape: c.shape, why: "its result names no created key", parallel: false, state: "unkeyed", key: "" });
      continue;
    }
    const why = outcome.has(id) ? outcome.get(id)! : gatedOrdinal >= 0 ? "it has no result" : null;
    if (why === null) continue;
    const sibling = !outcome.has(id) && (c.line === gatedLine || (gatedMessage !== "" && c.message === gatedMessage));
    out.push({ id, shape: c.shape, why, parallel: sibling, state: "lost", key: "" });
  }
  return out;
}

/**
 * The same milestone container: project, and the title under the container
 * normalizer (normalizeMilestoneTitle — case-insensitive, as the decision door
 * and the STE-644 re-list compare container titles; review R2-AC642.1).
 */
function sameContainer(a: CreateShape, b: CreateShape): boolean {
  return normalizeMilestoneTitle(a.title) === normalizeMilestoneTitle(b.title) && sameName(a.project, b.project);
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
  cwdTop: string | null,
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
    if (tagged.length > 1 && tagged.every((d) => d.binding.repoTag === tagged[0].binding.repoTag)) {
      return refuseSameTag(call, shape, tagged, announcements, cwdTop, note);
    }
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
  // STE-642 — a create of this ticket that returned its key settled it: no
  // create receipt, fresh or not, authorises a second create of it.
  // One parse of the transcript serves every walk below.
  const parsed = parseLines(transcript);
  const prior = priorCreates(parsed, call.adapter, call.toolUseId).filter((c) => sameTicket(c.shape, shape));
  const settled = prior.find((c) => c.state === "settled");
  if (settled) {
    return refuse(
      `${where}: an earlier create of "${shape.title}" (${settled.id}) returned \`${settled.key}\` — no create receipt, fresh or not, authorises a second create of that ticket.${note}`,
      `write to \`${settled.key}\` (this session created it, so it is owned); for a genuinely second ticket, decide a distinct title, or have the operator create it by hand.`,
    );
  }

  // §4 — after a create whose outcome is unknown, no create receipt — fresh or
  // not — authorises another create of that ticket: only the retry path, which
  // finds it and reuses it, proceeds.
  const lost = prior.find((c) => c.state !== "settled");
  if (lost?.parallel) {
    return refuseParallelDuplicate(
      where,
      `"${shape.title}" (${lost.id})`,
      "no create receipt authorises a second create of that ticket",
      `send one create per ticket in a turn, and once ${lost.id}'s result names the ticket it made, write to that ticket.`,
      note,
    );
  }
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
  for (const c of createsBefore(parsed, call.adapter, call.toolUseId)) {
    const hit = seen.find((r) => !r.spent && r.line < c.line && createMismatch(call.adapter, c.shape, r.shape, tag) === null);
    if (hit) hit.spent = true;
  }
  const matching = seen.filter((r) => createMismatch(call.adapter, shape, r.shape, tag) === null);
  if (matching.some((r) => !r.spent)) {
    const created = createdKeys(parsed, call.adapter);
    return gateAttachTarget(call, shape, sessionId, announcements, created, target, note, parsed);
  }

  if (matching.length > 0) {
    return refuse(
      `${where}: its create receipt (${matching[matching.length - 1].path}) is spent — another create took it, and a create that timed out may still have made the ticket.${note}`,
      `run ${DECIDE_CMD} --attempt retry-<N> (${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt retry-<N>")}) to search for the ticket that create may have made: a \`reused\` decision writes a reuse receipt that lets you write to that ticket. In a shared repository a retry never authorises another create. When retry-3 still misses, ask the operator with AskUserQuestion to search the tracker for the ticket by hand: if it exists, save it as <ticket.json> and run ${acceptedShape("ticket_ownership.ts", "<projectRoot> <KEY> <ticket.json>")} to write to it; if it does not, the operator creates it by hand — no receipt in this session authorises another create of it.`,
    );
  }
  const unspent = seen.filter((r) => !r.spent);
  if (unspent.length > 0) {
    const last = unspent[unspent.length - 1];
    return refuse(
      `${where}: the call does not match its create receipt (${last.path}): ${createMismatch(call.adapter, shape, last.shape, tag)}.${note}`,
      `send the payload ${DECIDE_CMD} decided, or run ${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt fast")} again for this one ${PLAIN_RULE}, then retry.`,
    );
  }
  const allSpent = seen.length > 0 ? ` This session's ${seen.length} create receipt(s) are all spent, each by the create it authorised.` : "";
  return refuse(
    `${where}: no create receipt announced by ${DECIDE_CMD} in this session authorises it.${allSpent}${note}`,
    `run ${acceptedShape(DECIDE_MODULE, "<projectRoot> <page.json>... --title <title> [container] --attempt fast")} in ${target.root} for this ticket ${PLAIN_RULE}, then retry.`,
  );
}

/** The absolute git common directory of `root` (one per repository, shared by its worktrees), or null. */
function gitCommonDir(root: string): string | null {
  try {
    const p = Bun.spawnSync(["git", "-C", root, "rev-parse", "--git-common-dir"], { stdout: "pipe", stderr: "pipe", timeout: 2000 });
    if (p.exitCode !== 0) return null;
    const out = p.stdout.toString().trim();
    return out.length > 0 ? realpathOr(resolve(root, out)) : null;
  } catch {
    return null;
  }
}

/**
 * D-5 — every tagged target declares the SAME repo tag, so the labels carry one
 * tag, not several: the targets are two checkouts of one repository (or two
 * repositories declaring one tag). Name the roots, where this session's
 * receipts were announced, and where the call runs from. Runs git only here.
 */
function refuseSameTag(
  call: TrackerCall,
  shape: CreateShape,
  tagged: DeclaredTarget[],
  announcements: Announcement[],
  cwdTop: string | null,
  note: string,
): ExitCode {
  const roots = tagged.map((d) => d.root);
  const common = roots.map(gitCommonDir);
  // Only git's own answer names the cause: a root whose common dir cannot be
  // read is neither proven one repository nor proven another.
  const unreadable = roots.filter((_, i) => common[i] === null);
  const oneRepo = unreadable.length === 0 && common.every((c) => c === common[0]);
  const kind =
    unreadable.length > 0
      ? `roots, and git cannot tell whether they are one repository (no git common dir for ${unreadable.join(", ")})`
      : oneRepo
        ? "checkouts of one repository"
        : "different repositories";
  const announced = roots.filter((r) => announcements.some((a) => a.root === r));
  const where = announced.length > 0 ? `this session's receipts were announced in ${announced.join(", ")}` : "no receipt of this session was announced in any of them";
  const from = cwdTop !== null ? `, and the call runs from ${cwdTop}` : "";
  return refuse(
    `${call.tool} into ${shape.project || shape.team}: the repo tag ${tagged[0].binding.repoTag} is declared by ${roots.length} ${kind} (${roots.join(", ")}); ${where}${from}, so the target cannot be resolved.${note}`,
    unreadable.length > 0
      ? `check that each of those roots is a git checkout, then run the deciding commands and this write from ONE of them and retry.`
      : oneRepo
        ? `run the deciding commands and this write from ONE checkout, then retry.`
        : `if these are two clones of one project, run the deciding commands and this write from ONE of them; if they are different projects, give each its own repo tag in its declaration; then retry.`,
  );
}

// ---------------------------------------------------------------------------
// §4 — creates: an `attach-target` receipt resolved the create's container (STE-611)
// ---------------------------------------------------------------------------

/** The attach front door: the ONE module whose receipts resolve an FR's milestone container. */
const ATTACH_MODULE = "attach_project_milestone.ts";
const ATTACH_SHAPE = acceptedShape(ATTACH_MODULE, "<projectRoot> <jira|linear> <project> <planFile> <listingFile>");

interface AttachTarget {
  path: string;
  project: string;
  surface: string;
  /** The Epic key a `parent` surface resolved; "" for any other surface. */
  key: string;
  /** The Linear milestone id an `object` surface resolved; "" otherwise. */
  id: string;
  /** Every name the resolved container answers to: its listed name and the milestone name. */
  names: string[];
  /** The plan's milestone token (its file name), for the `label` surface's `milestone-<token>`. */
  token: string;
  /** Whether its provenance holds (`provenanceUnproven` is null); an unproven target never permits. */
  proven: boolean;
  /** Why it is unproven, when it is. */
  unproven: typeof NOT_ANNOUNCED | typeof NOT_CREATED | typeof NOT_CONSENTED | null;
  /** STE-643 — the forbidden join decision and the answer it still needs, when `unproven` is `NOT_CONSENTED`. */
  consent: { receipt: string; label: string } | null;
}

/**
 * The `attach-target` receipts of this session in `root`, each announced by a
 * run of the attach front door itself. A receipt of that kind announced by any
 * other module, rewritten after its announcement, unreadable, malformed, or
 * written for another session or adapter counts as absent.
 */
/**
 * STE-611 AC.7 — an attach target proven by a DECISION counts only when that
 * decision receipt was announced, intact and with the recorded digest, by the
 * decision front door's own run in this transcript. The attach front door
 * reads decision files from disk and cannot tell one written by hand; the
 * transcript can. A plan committed at HEAD, or a target that joins no existing
 * container, needs no decision. Anything else (absent, unshared in a declared
 * target, malformed) counts as absent.
 */
const NOT_ANNOUNCED = "never-announced";
const NOT_CREATED = "not-created";
/** STE-643 — a `default=forbidden` join decision no AskUserQuestion after it answered with its consent label. */
const NOT_CONSENTED = "not-consented";

/**
 * Null when the provenance holds; otherwise why not (`NOT_ANNOUNCED`,
 * `NOT_CREATED` or `NOT_CONSENTED`). On `NOT_CONSENTED`, `consent` receives
 * the decision receipt and the answer it needs.
 */
function provenanceUnproven(
  provenance: unknown,
  announcements: Announcement[],
  resolvedKey: string,
  created: ReadonlySet<string>,
  parsed: Array<ParsedLine | null>,
  consent: { receipt: string; label: string } = { receipt: "", label: "" },
): typeof NOT_ANNOUNCED | typeof NOT_CREATED | typeof NOT_CONSENTED | null {
  if (provenance === null || typeof provenance !== "object") return NOT_ANNOUNCED;
  const p = provenance as Record<string, unknown>;
  if (p.kind === "committed" || p.kind === "not-applicable") return null;
  if (p.kind !== "decided" || typeof p.receipt !== "string" || typeof p.sha256 !== "string") return NOT_ANNOUNCED;
  const wanted = resolve(p.receipt);
  let why: typeof NOT_ANNOUNCED | typeof NOT_CREATED | typeof NOT_CONSENTED = NOT_ANNOUNCED;
  for (const x of announcements) {
    if (x.module !== RESOLVE_MODULE || !x.intact || resolve(x.receiptPath) !== wanted) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(x.receiptPath);
    } catch {
      continue;
    }
    if (receiptDigest(bytes) !== p.sha256) continue;
    // A CREATE decision proves only a container this session created: the
    // resolved key must be one a create call of this transcript returned.
    // Otherwise a create decision would prove a silent join of a sibling's
    // same-title container (M_685ff6 review).
    let act: unknown;
    try {
      act = (JSON.parse(bytes.toString("utf-8")) as { evidence?: { act?: unknown } }).evidence?.act;
    } catch {
      continue;
    }
    // STE-643 — a join decision that printed default=forbidden proves its
    // target only once the operator answered its consent label after it.
    const ev = (JSON.parse(bytes.toString("utf-8")) as { evidence?: Record<string, unknown> }).evidence ?? {};
    const forbiddenJoin: ConsentSubject | null =
      act === "join" && ev.default === "forbidden"
        ? {
            line: x.line,
            act: "join",
            key: typeof ev.key === "string" ? ev.key : "",
            title: typeof ev.title === "string" ? ev.title : null,
          }
        : null;
    const label = forbiddenJoin === null ? "" : consentLabel(forbiddenJoin);
    if (forbiddenJoin !== null && !answeredAfter(parsed, forbiddenJoin, label)) {
      why = NOT_CONSENTED;
      consent.receipt = x.receiptPath;
      consent.label = label;
      continue;
    }
    if (act === "join") return null;
    if (act === "create" && resolvedKey !== "" && created.has(resolvedKey.toUpperCase())) return null;
    why = NOT_CREATED;
  }
  return why;
}

function attachTargets(
  announcements: Announcement[],
  created: ReadonlySet<string>,
  root: string,
  sessionId: string,
  adapter: WorkspaceAdapterKey,
  parsed: Array<ParsedLine | null>,
): AttachTarget[] {
  const out: AttachTarget[] = [];
  for (const { announcement: a, container, evidence: ev } of frontDoorReceipts(
    announcements,
    ATTACH_MODULE,
    "attach-target",
    new Set([root]),
    sessionId,
    adapter,
  )) {
    if (typeof ev.surface !== "string" || ev.surface === "") continue;
    const key = ev.surface === "parent" && typeof ev.key === "string" ? ev.key : "";
    const id = ev.surface === "object" && typeof ev.id === "string" ? ev.id : "";
    const planFile = typeof ev.planFile === "string" ? ev.planFile : "";
    const consent = { receipt: "", label: "" };
    const unproven = provenanceUnproven(ev.provenance, announcements, key || id, created, parsed, consent);
    out.push({
      proven: unproven === null,
      unproven,
      consent: unproven === NOT_CONSENTED ? consent : null,
      path: a.receiptPath,
      project: container,
      surface: ev.surface,
      key,
      id,
      names: [ev.name, ev.milestoneName].filter((n): n is string => typeof n === "string" && n !== ""),
      token: planFile === "" ? "" : basename(planFile).replace(/\.md$/, ""),
    });
  }
  return out;
}

/**
 * Whether the create's own milestone binding is one a proven target resolved.
 * Jira: a parent must be the Epic key a `parent` target resolved; with no
 * parent, the labels must carry `milestone-<token>` of a `label` target (a
 * parentless create under an Epic-bound milestone would be stranded). Linear:
 * a `milestone` argument must be a resolved target's id or one of its names;
 * a Linear create that names no milestone is accepted on any proven target in
 * the project — the named residual, since its payload carries nothing to bind.
 */
function bindsTarget(call: TrackerCall, shape: CreateShape, t: AttachTarget): boolean {
  const container = shape.container;
  if (call.adapter === "jira") {
    if (container !== "") return t.surface === "parent" && sameName(t.key, container);
    if (t.surface !== "label" || t.token === "") return false;
    let label: string;
    try {
      label = milestoneLabel(t.token);
    } catch {
      return false;
    }
    return shape.labels.includes(label);
  }
  if (container === "") return true;
  return (t.id !== "" && t.id === container) || t.names.some((n) => sameName(n, container));
}

/**
 * STE-611 — beside the create receipt, an FR create in a declared target needs
 * an `attach-target` receipt of this session that resolved a surface in the
 * create's project AND bound the create's own milestone (`bindsTarget`). One
 * resolved target serves every FR of its milestone, so the receipt is never
 * spent.
 */
function gateAttachTarget(
  call: TrackerCall,
  shape: CreateShape,
  sessionId: string,
  announcements: Announcement[],
  created: ReadonlySet<string>,
  target: DeclaredTarget,
  note: string,
  parsed: Array<ParsedLine | null>,
): ExitCode {
  const where = `${call.tool} in ${target.root}`;
  const project = shape.project !== "" ? shape.project : shape.team;
  const all = attachTargets(announcements, created, target.root, sessionId, call.adapter, parsed).filter((t) =>
    sameName(t.project, project),
  );
  const inProject = all.filter((t) => t.proven);
  // Linear by name (M_685ff6 review r2): an id binds its milestone; a name
  // binds only when ONE resolved milestone answers to it case-insensitively,
  // so two milestones differing only in case cannot cross-bind.
  if (call.adapter === "linear" && shape.container !== "" && !inProject.some((t) => t.id !== "" && t.id === shape.container)) {
    const named = inProject.filter((t) => t.names.some((n) => sameName(n, shape.container)));
    const distinct = new Set(named.map((t) => `${t.surface}:${t.id || t.token}`));
    if (distinct.size > 1) {
      return refuse(
        `${where}: the milestone "${shape.container}" is ambiguous — it names more than one milestone an attach-target receipt of this session resolved (${[...distinct].join(", ")}), which differ only in case.${note}`,
        `name the milestone by its id, as ${ATTACH_MODULE} printed it (\`id=\`), then retry.`,
      );
    }
  }
  if (inProject.some((t) => bindsTarget(call, shape, t))) return 0;
  if (inProject.length > 0) {
    const last = inProject[inProject.length - 1]!;
    const resolved =
      last.surface === "parent"
        ? `the Epic ${last.key} (send it as the parent)`
        : last.surface === "label"
          ? `the label surface of ${last.token} (carry the label ${(() => {
              try {
                return milestoneLabel(last.token);
              } catch {
                return `milestone-${last.token}`;
              }
            })()})`
          : `the milestone ${last.id || last.names[0] || "(unnamed)"} (name it as the milestone)`;
    const sent =
      call.adapter === "jira"
        ? shape.container === ""
          ? `no parent and the labels [${shape.labels.join(", ")}]`
          : `the parent "${shape.container}"`
        : `the milestone "${shape.container}"`;
    return refuse(
      `${where}: the payload carries ${sent}, which binds no milestone container an attach-target receipt of this session resolved — the latest (${last.path}) resolved ${resolved}.${note}`,
      `bind the create to the container ${ATTACH_MODULE} resolved, or run ${ATTACH_SHAPE} in ${target.root} for this FR's milestone ${PLAIN_RULE}, then retry.`,
    );
  }
  const unproven = all.filter((t) => !t.proven);
  if (unproven.length > 0) {
    const last = unproven[unproven.length - 1]!;
    const resolvedKey = last.key || last.id;
    if (last.unproven === NOT_CONSENTED && last.consent !== null) {
      return refuse(
        `${where}: the attach-target receipt (${last.path}) resolved ${resolvedKey} through the join decision ${last.consent.receipt}, which printed default=forbidden — and ${unansweredConsent(last.consent.label)}.${note}`,
        `ask the operator with AskUserQuestion naming the joined container, offering the printed \`options=\` labels verbatim; create the FR only after the answer is exactly "${last.consent.label}". Then retry.`,
      );
    }
    if (last.unproven === NOT_CREATED) {
      return refuse(
        `${where}: the attach-target receipt (${last.path}) resolved the existing container ${resolvedKey}, and the milestone decision it relies on is a CREATE — but no create call of this session returned ${resolvedKey}, so binding to it would be a join the operator never approved.${note}`,
        `to join ${resolvedKey}, decide it with ${frontDoor("--join-key <key>")} (with \`--sibling <path>\` in a shared container) ${PLAIN_RULE}; to create your own container, create it through the decided create first. Then run ${ATTACH_SHAPE} again and retry.`,
      );
    }
    return refuse(
      `${where}: the attach-target receipt (${last.path}) relied on a milestone decision that ${RESOLVE_MODULE} never announced in this session — a decision receipt must come from that front door's own run.${note}`,
      `decide the milestone container with ${frontDoor("--join-key <key>")} (or \`--title <title>\` to create) ${PLAIN_RULE}, run ${ATTACH_SHAPE} again, then retry.`,
    );
  }
  return refuse(
    `${where}: no attach-target receipt announced by ${ATTACH_MODULE} in this session resolved the milestone container in project "${project}", so the ticket could be created where it cannot be attached.${note}`,
    `run ${ATTACH_SHAPE} in ${target.root} for the FR's milestone ${PLAIN_RULE}; when it refuses, the FR is not created. Then retry.`,
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

/** The Teamwork Graph relationship types whose target is a Jira item (STE-649). */
const TEAMWORK_ITEM_TARGETS = new Set(["jira-work-item-links-jira-work-item", "jira-work-item-blocks-jira-work-item"]);

/** A call that links two tickets: `createIssueLink`, or a Teamwork Graph link. */
function isLinkTool(tool: string): boolean {
  return tool === "createIssueLink" || tool === "addTeamworkGraphContext";
}

/** The input fields a ticket call names its subject in: both sides of a link, else the issue fields. */
function subjectValues(call: TrackerCall): unknown[] {
  const i = call.input;
  if (call.tool === "createIssueLink") return [i.inwardIssue, i.outwardIssue];
  if (call.tool === "addTeamworkGraphContext") {
    // The object is always a Jira item; the target is one only for item↔item relationship types.
    const itemTarget = typeof i.relationshipType === "string" && TEAMWORK_ITEM_TARGETS.has(i.relationshipType);
    return itemTarget ? [i.objectIdentifier, i.targetObjectIdentifier] : [i.objectIdentifier];
  }
  return [i.issueIdOrKey, i.id, i.issueId, i.issue];
}

/** A Jira `/browse/<KEY>` URL; its key is the item it names (STE-649). */
const BROWSE_URL = /^https?:\/\/[^/?#\s]+\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)\/?(?:[?#]\S*)?$/;

/** A link side's raw spelling, as named in a refusal. */
function sideText(v: unknown): string {
  return (typeof v === "number" ? String(v) : asKey(v)).trim();
}

/**
 * STE-649 — a Jira-item side of a link resolves only from a key or a
 * `/browse/<KEY>` URL; a numeric id, an ARI or any other URL resolves to
 * nothing (null).
 */
function resolveItemSide(v: unknown): string | null {
  const s = sideText(v);
  if (TICKET_KEY.test(s)) return s.toUpperCase();
  const m = BROWSE_URL.exec(s);
  return m ? m[1]!.toUpperCase() : null;
}

/** A link's Jira-item sides that resolve to no ticket key (STE-649); empty for any other call. */
function unresolvedItemSides(call: TrackerCall): unknown[] {
  return isLinkTool(call.tool) ? subjectValues(call).filter((v) => resolveItemSide(v) === null) : [];
}

/** §2 — a ticket call's subject keys: `issueIdOrKey`, both keys of a link, `id`, or the commented issue. */
export function subjectKeys(call: TrackerCall): string[] {
  if (isLinkTool(call.tool)) {
    const sides = subjectValues(call).map(resolveItemSide).filter((k): k is string => k !== null);
    return [...new Set(sides)];
  }
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
 * The ONE key a create's result names as created, read by the shared reader
 * (`tracker_answer.ts`): a Jira create's `key` — plain, or the one node of a
 * wrapped answer — or a Linear create's top-level `id` (`STE-619`; the
 * measured answer carries no `identifier`). Every other key the result echoes
 * — a parent Epic, a linked sibling — was not created by this call, and a
 * JSON answer in no measured shape names nothing. A result that is not JSON
 * falls back to the first key carrying the create's own Jira project prefix,
 * and otherwise names nothing.
 */
function createdKeyOf(text: string, call: TrackerCall): string | null {
  try {
    const read = readTrackerItem(call.adapter, JSON.parse(text));
    return read.ok ? trackerItemKey(call.adapter, read.item) : null;
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
  const creates = new Map<string, { call: TrackerCall; milestone: boolean }>();
  const out = new Set<string>();
  for (const p of parsed) {
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type === "tool_use") {
        const ticket = createCallIn(b, adapter);
        const c = ticket ?? MILESTONE_CREATES.pick(b, adapter);
        if (typeof b.id === "string" && c) creates.set(b.id, { call: c, milestone: ticket === null });
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        const c = creates.get(b.tool_use_id);
        if (b.is_error === true || !c) continue;
        const text = resultText(b.content).trim();
        const key = createdKeyOf(text, c.call) ?? (c.milestone && adapter === "linear" ? createdMilestoneIdOf(text) : null);
        if (key !== null) out.add(key);
      }
    }
  }
  return out;
}

/**
 * The id a Linear `save_milestone` create returned — a UUID at the top level
 * or under `milestone`/`projectMilestone` — upper-cased like every other
 * created key. A result that is not JSON names nothing.
 */
function createdMilestoneIdOf(text: string): string | null {
  try {
    const r = JSON.parse(text) as Record<string, unknown> | null;
    for (const o of [r, r?.milestone, r?.projectMilestone]) {
      const id = o && typeof o === "object" ? (o as Record<string, unknown>).id : undefined;
      if (typeof id === "string" && UUID_SHAPE.test(id)) return id.toUpperCase();
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/**
 * STE-650 AC-8 — the answer the harness recorded to ONE question of an
 * `AskUserQuestion` tool_result: `toolUseResult.answers` keyed by question
 * text, else the harness's own sentence `"<question>"="<answer>"`. Null when
 * the result records no answer to that question.
 */
function answerTo(p: ParsedLine, block: ContentBlock, question: string): string | null {
  const tur = p.raw.toolUseResult as { answers?: unknown } | undefined;
  if (tur && tur.answers && typeof tur.answers === "object") {
    const v = (tur.answers as Record<string, unknown>)[question];
    return typeof v === "string" ? v : null;
  }
  const text = resultText(block.content);
  const at = text.indexOf(`"${question}"="`);
  if (at < 0) return null;
  const m = /^([^"]*)"(?=[.,]\s|[.,]?$)/.exec(text.slice(at + question.length + 4));
  return m ? m[1]! : null;
}

/**
 * STE-650 AC-8 — the ONE per-question consent matcher both consent checks
 * use: an answered AskUserQuestion consents to `label` only when a question
 * whose own text names the subject (`names`) and offers `label` as an option
 * was answered exactly `label`. Another question's answer neither grants nor
 * withholds it.
 * Twin: `consentedPerQuestion` in adapters/_shared/src/shared_tracker_live_grader.ts
 */
function consentedPerQuestion(questions: unknown, p: ParsedLine, block: ContentBlock, label: string, names: (question: string) => boolean): boolean {
  if (!Array.isArray(questions)) return false;
  return questions.some((q) => {
    const question = (q as { question?: unknown } | null)?.question;
    if (typeof question !== "string" || !names(question)) return false;
    const options = (q as { options?: unknown } | null)?.options;
    if (!Array.isArray(options) || !options.some((o) => (o as { label?: unknown } | null)?.label === label)) return false;
    return answerTo(p, block, question) === label;
  });
}

function operatorText(p: ParsedLine): string {
  if (p.raw.type !== "user" || p.raw.isMeta === true) return "";
  const content = (p.raw.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if ((content as ContentBlock[]).some((b) => b?.type === "tool_result")) return "";
  return (content as ContentBlock[]).map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).join("\n");
}

/** Line indices of an ANSWERED consent to `<verb> <key>` (§4), read per question (`consentedPerQuestion`, STE-650 AC-8). */
function consentLines(parsed: Array<ParsedLine | null>, key: string, verb: "Import" | "Adopt"): number[] {
  const label = `${verb} ${key}`;
  const asks = new Map<string, unknown>();
  const out: number[] = [];
  parsed.forEach((p, idx) => {
    if (!p) return;
    for (const b of p.blocks) {
      if (b.type === "tool_use" && b.name === "AskUserQuestion" && typeof b.id === "string") {
        asks.set(b.id, (b.input as { questions?: unknown } | undefined)?.questions);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        if (b.is_error === true || !asks.has(b.tool_use_id)) continue;
        if (consentedPerQuestion(asks.get(b.tool_use_id), p, b, label, (q) => namesKey(q, key))) out.push(idx);
      }
    }
    const text = operatorText(p);
    if (text) {
      const v = resolveInterviewAnswer(text, "tracker_orphan_import");
      const values = Array.isArray(v) ? v : [v];
      // Exactly the ask's rule: the value is consent only when it IS the label
      // (D-8 — a value merely naming the key read `Skip <KEY>` as consent).
      if (values.some((x) => x === label)) out.push(idx);
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
  stale: StaleRead | null = null,
): ExitCode {
  // STE-649 — every Jira-item side of a link must resolve; an owned other side does not excuse one that does not.
  const unresolved = unresolvedItemSides(call);
  if (unresolved.length > 0) {
    const named = unresolved.map((v) => `"${sideText(v)}"`).join(", ");
    return refuse(
      `${call.tool}: the Jira-item side ${named} cannot be resolved to a ticket key — a side resolves only from a key (e.g. GF-123) or a /browse/<KEY> URL, never from a numeric id, an ARI or another URL — so the link is refused whatever its other side.${note}`,
      `pass every Jira-item side of the link as its key or its /browse/<KEY> URL, then retry.`,
    );
  }
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
  const isLink = isLinkTool(call.tool);
  const bound = inScope.filter((k) => k.targets.length > 0);
  const unowned = inScope.filter((k) => !ownedKey(k));
  // A link needs one owned side; every other ticket call needs every subject owned.
  const permitted = isLink ? bound.some(ownedKey) : unowned.length === 0;
  if (permitted) return 0;
  const named = (isLink ? bound : unowned).map((k) => k.key);
  const targetRoots = [...new Set(inScope.flatMap((k) => k.targets.map((t) => t.root)))].join(", ");
  // STE-641 — name the lag as a fact, not a retry: a lone call's own line is
  // written only after its PreToolUse hook returns, so retrying cannot help.
  const lag = stale === null ? "" : ` (The transcript read did not yet hold this call's own tool_use ${stale.id}; it was graded as the last call of its turn.)`;
  return refuse(
    `${call.tool} on ${named.join(", ")}: ${isLink ? "neither side is" : "the ticket is not"} owned by the declared target ${targetRoots} — no tracked FR file binds it, no create of it is visible in this session's transcript, and no reuse, binding or consented import receipt names it.${lag}${note}`,
    // STE-649 AC.8 — `decide` writes no receipt, so its shape is spelled
    // literally: acceptedShape() would print `confirm decide`.
    // STE-649 AC.10 — `--adopt` is conditional, never an unconditional `[--adopt]`.
    `first run ${DECIDE_OWNERSHIP_SHAPE} to read the ticket's ownership verdict, then run ${acceptedShape("ticket_ownership.ts", "<projectRoot> <KEY> <ticket.json>")} (only when decide's verdict is unowned and the operator answered "Adopt \`<KEY>\`" append \`--adopt\`; or, after an answered import question, ${acceptedShape("container_ownership.ts", "<projectRoot> <KEY> <page.json>...")}) in ${targetRoots} for ${named.join(", ")} ${PLAIN_RULE}, then retry. ` +
      // STE-649 AC.9 — the verdicts no receipt can clear, and their routes.
      `A foreign-repo verdict (the ticket carries another repository's tag) or a container verdict (the ticket is an Epic) is refused by both confirm and consent, and on Linear confirm also refuses another project's ticket in the same team: make that write from the owning repository, or relabel the ticket to this repository first.`,
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
  /** The joined container's listed name (joins only); null when the receipt records none. */
  name: string | null;
  /** STE-643 — the front door printed `default=forbidden` (recorded as `evidence.default`). */
  forbidden: boolean;
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
  for (const { announcement: a, container, evidence: ev } of frontDoorReceipts(
    announcements,
    RESOLVE_MODULE,
    "milestone-decision",
    roots,
    sessionId,
    adapter,
  )) {
    if (ev.act !== "create" && ev.act !== "join") continue;
    out.push({
      line: a.line,
      path: a.receiptPath,
      project: container,
      act: ev.act,
      key: typeof ev.key === "string" ? ev.key : "",
      title: typeof ev.title === "string" ? ev.title : null,
      milestoneId: typeof ev.milestoneId === "string" ? ev.milestoneId : "",
      labels: stringList(ev.labels),
      name: typeof ev.name === "string" ? ev.name : null,
      forbidden: ev.default === "forbidden",
    });
  }
  return out;
}

/**
 * STE-643 — what the consent rule reads of a decision: where it was announced
 * (transcript line), its act, and the key or title a question must name.
 * Twin: `forbiddenDecisionConsented` in adapters/_shared/src/shared_tracker_live_grader.ts
 * mirrors this rule for the live grader (separate modules by design — keep both in step).
 */
type ConsentSubject = Pick<MilestoneDecision, "line" | "act" | "key" | "title">;

/**
 * STE-643 — the consent a `default=forbidden` decision needs, computed from
 * the decision's own act, key and title (never from recorded options).
 */
function consentLabel(d: ConsentSubject): string {
  return d.act === "join" ? `Join \`${d.key}\`` : `Create \`${d.title ?? ""}\``;
}

/** STE-643 — the refusal clause naming the consent answer a decision still needs. */
const unansweredConsent = (label: string): string => `no AskUserQuestion after it was answered "${label}"`;

/**
 * STE-643 — true when an AskUserQuestion after the decision's announcement
 * holds a question whose own text names its key or title, offers `label` as
 * an option, and was answered exactly `label` (per question — STE-650 AC-8).
 */
function answeredAfter(parsed: Array<ParsedLine | null>, d: ConsentSubject, label: string): boolean {
  // The QUESTION text must name the decision: the label itself always
  // carries the key or title, so reading the options too would let a
  // correctly-labelled option ride an unrelated question.
  const names = (q: string): boolean => (d.key !== "" && namesKey(q, d.key)) || (d.title !== null && d.title !== "" && q.includes(d.title));
  const asks = new Map<string, unknown>();
  for (let idx = d.line + 1; idx < parsed.length; idx++) {
    const p = parsed[idx];
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type === "tool_use" && b.name === "AskUserQuestion" && typeof b.id === "string") {
        asks.set(b.id, (b.input as { questions?: unknown } | undefined)?.questions);
      } else if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        if (b.is_error === true || !asks.has(b.tool_use_id)) continue;
        if (consentedPerQuestion(asks.get(b.tool_use_id), p, b, label, names)) return true;
      }
    }
  }
  return false;
}

/** STE-644 — the listing tool a container re-list is read from, per tracker. */
const RELIST_TOOLS: Readonly<Record<WorkspaceAdapterKey, string>> = { jira: "searchJiraIssuesUsingJql", linear: "list_milestones" };

/** STE-644 — one complete container listing chain: its rows and the transcript line of its last result. */
interface Relist {
  items: Record<string, unknown>[];
  lastLine: number;
}

/**
 * STE-644 — the complete, canonical-scope listings of `project`'s containers
 * recorded after line `from`: non-error results of the adapter's listing tool
 * whose request `isCanonicalContainerListing` admits, chained from an unpaged
 * request, each later request carrying the previous page's cursor, read by
 * tracker_answer's `readTrackerListing` and ending on a page proven last. An
 * errored or unreadable page breaks its chain, and a chain whose rows fail
 * `containerListingRowsComplete` (a Jira row without its summary, its status
 * category or a key with `project`'s prefix; a Linear row without its name)
 * does not qualify. `consented` (a forbidden decision the operator answered)
 * admits a full Linear milestone window, which never proves the last page:
 * the answer is the only way past it. Freshness is not checked here; the
 * caller filters by `freshBefore`. Twin: `relistedAfter` in
 * shared_tracker_live_grader.ts, which grades the same rule on a recorded
 * bundle and cannot check all of it (see there).
 */
function relistsAfter(parsed: Array<ParsedLine | null>, from: number, adapter: WorkspaceAdapterKey, project: string, consented = false): Relist[] {
  const tool = RELIST_TOOLS[adapter];
  const requests = new Map<string, unknown>();
  const out: Relist[] = [];
  let pages: unknown[] | null = null;
  for (let idx = from + 1; idx < parsed.length; idx++) {
    const p = parsed[idx];
    if (!p) continue;
    for (const b of p.blocks) {
      if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        if (b.name.startsWith("mcp__") && b.name.endsWith(`__${tool}`) && isCanonicalContainerListing(adapter, b.input, project)) requests.set(b.id, b.input);
        continue;
      }
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string" || !requests.has(b.tool_use_id)) continue;
      const cursor = listingRequestCursor(adapter, requests.get(b.tool_use_id));
      requests.delete(b.tool_use_id);
      let answer: unknown = null;
      try {
        answer = b.is_error === true ? null : JSON.parse(resultText(b.content));
      } catch {
        answer = null;
      }
      if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
        pages = null;
        continue;
      }
      if (cursor === null) pages = [answer];
      else if (pages === null) continue;
      else pages.push({ ...(answer as Record<string, unknown>), requestCursor: cursor });
      const read = readTrackerListing(adapter, pages, adapter === "linear" ? "milestones" : "issues");
      if (read.ok && containerListingRowsComplete(adapter, read.items, project) && (read.last || (consented && adapter === "linear"))) out.push({ items: read.items, lastLine: idx });
    }
  }
  return out;
}

/** STE-644 (v) — the most a qualifying re-list's last result may precede the gated call. */
const LISTING_FRESH_MS = 120_000;
/** STE-644 (v), review B1R2-5 — how far a re-list's result may sit in the future (clock skew) and still count. */
const LISTING_FUTURE_SKEW_MS = 5_000;

/** A transcript line's `timestamp` in epoch ms, or null when absent or unreadable. */
function lineTime(p: ParsedLine | null | undefined): number | null {
  const t = p && typeof p.raw.timestamp === "string" ? Date.parse(p.raw.timestamp) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * STE-644 (v) — whether a re-list's last result is within LISTING_FRESH_MS of
 * the grading time (`now`). Grading time, never the gated line's own
 * `timestamp`: that stamp marks when its MESSAGE started streaming, which a
 * later call of a batch can trail by seconds, so it would widen the window
 * (review B1R2-2). A result stamped more than LISTING_FUTURE_SKEW_MS in the
 * future, or with no timestamp, is not fresh (review B1R2-5).
 */
function freshBefore(parsed: Array<ParsedLine | null>, relist: Relist, now: number = Date.now()): boolean {
  const last = lineTime(parsed[relist.lastLine]);
  return last !== null && now - last <= LISTING_FRESH_MS && now - last >= -LISTING_FUTURE_SKEW_MS;
}

/** STE-644 — the re-list a container create's refusal asks for. */
function relistRemedy(adapter: WorkspaceAdapterKey, project: string): string {
  const query = adapter === "jira" ? `\`project = ${project} AND issuetype = Epic\` (every page, with summary and status)` : `\`list_milestones\` for project ${project} (every row, with its name)`;
  return `list project ${project}'s containers again after the decision with ${query}, and send the create within 120 s of that read.`;
}

/**
 * STE-644 — the key (Linear: the id) of the first OPEN row in `relist` whose
 * normalized title equals `title`, or null. Open: a Jira row whose
 * `statusCategory` key is not `done`; any Linear row.
 */
function openSameTitle(adapter: WorkspaceAdapterKey, relist: Relist, title: string): string | null {
  const want = normalizeMilestoneTitle(title);
  for (const row of relist.items) {
    if (adapter === "linear") {
      if (typeof row.name === "string" && normalizeMilestoneTitle(row.name) === want) return String(row.id ?? "");
      continue;
    }
    const f = row.fields as { summary?: unknown; status?: { statusCategory?: { key?: unknown } } } | undefined;
    if (typeof f?.summary === "string" && normalizeMilestoneTitle(f.summary) === want && f.status?.statusCategory?.key !== "done") return String(row.key ?? "");
  }
  return null;
}

/** A create decision for the same project and a byte-equal title (AC-STE-608.10 a/b). */
function decides(d: MilestoneDecision, c: CreateShape): boolean {
  return d.act === "create" && sameName(d.project, c.project) && d.title === c.title;
}

/**
 * The gate on a milestone-container create (a Jira Epic, a Linear project
 * milestone). In order, it refuses a create that (STE-642) repeats a create of
 * the same container this session already made; that no announced create
 * decision for the same project and byte-equal title permits; or whose only
 * permitting decisions are spent, or printed default=forbidden with no answer
 * to their consent label after them (STE-643). Once a decision permits it,
 * STE-644 further requires a re-list: a `relistsAfter` listing of the
 * project's containers recorded after that decision, whose last result is
 * within LISTING_FRESH_MS of the grading time (`freshBefore`). A fresh re-list that
 * holds an open container of the same title (`openSameTitle`) refuses with a
 * join remedy; no fresh re-list refuses with `relistRemedy`. On Linear an
 * allowed decision whose only re-list is a full 50-row window (never proof of
 * the last page) refuses with the consent remedy instead — answer
 * `Create \`<title>\`` — since another re-list returns the same window
 * (STE-650 AC.13); a consented decision accepts that window. The live grader's
 * twin of the re-list rule is `relistedAfter` in shared_tracker_live_grader.ts.
 */
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
  // STE-642 — a container create that returned its key settled it: no create
  // decision, fresh or not, authorises a second create of it.
  // One parse of the transcript serves every walk below.
  const parsed = parseLines(transcript);
  const prior = priorCreates(parsed, call.adapter, call.toolUseId, MILESTONE_CREATES).filter((c) =>
    sameContainer(c.shape, want),
  );
  const settled = prior.find((c) => c.state === "settled");
  if (settled) {
    return refuse(
      `${where}: an earlier create of the ${name} "${want.title}" (${settled.id}) returned \`${settled.key}\` — no create decision, fresh or not, authorises a second create of it.${note}`,
      `use \`${settled.key}\`; a second ${name} titled "${want.title}" would duplicate it.`,
    );
  }
  // §4 — after a container create whose outcome is unknown, no decision
  // authorises another create of it.
  const lost = prior.find((c) => c.state !== "settled");
  if (lost?.parallel) {
    return refuseParallelDuplicate(
      where,
      `the ${name} "${want.title}" (${lost.id})`,
      "no decision authorises a second create of it",
      `send one create per ${name} in a turn — the decision ${frontDoor("--title <title>")} wrote authorises one create.`,
      note,
    );
  }
  if (lost) {
    return refuse(
      `${where}: an earlier create of the ${name} "${want.title}" (${lost.id}) may have made it — ${lost.why} — so no decision authorises another create of it.${note}`,
      `list project ${want.project}'s containers again, save that listing, and run ${frontDoor("--title <title>")} ${PLAIN_RULE}: a listing that holds the ${name} decides a join, and nothing is created. If it still misses, ask the operator with AskUserQuestion to search the tracker by hand.`,
    );
  }
  const roots = new Set(targets.map((t) => t.root));
  const seen = milestoneDecisions(announcements, roots, sessionId, call.adapter).map((d) => ({ ...d, spent: false }));
  // One create decision authorises ONE container create after its announcement.
  for (const c of createsBefore(parsed, call.adapter, call.toolUseId, MILESTONE_CREATES)) {
    const hit = seen.find((d) => !d.spent && d.line < c.line && decides(d, c.shape));
    if (hit) hit.spent = true;
  }
  // The LATEST decision for this project and title governs (M_685ff6 review):
  // a join decided after a create decision is the gate the operator answered
  // last, so the earlier create no longer authorises anything.
  const governing = governingDecision(
    seen.filter((d) => sameName(d.project, want.project)),
    { title: want.title },
  );
  if (governing && governing.act === "join") {
    return refuse(
      `${where}: the latest milestone decision for "${want.title}" in project ${want.project} (${governing.path}) joins the existing ${name} ${governing.key}, so no create of it is authorised — an earlier create decision is superseded.${note}`,
      `use ${governing.key}: a join writes nothing to the container. To create a new ${name} instead, save a fresh listing and run ${frontDoor("--title <title>")} ${PLAIN_RULE}.`,
    );
  }
  const matching = seen.filter((d) => decides(d, want));
  const permitting = matching.find((d) => !d.spent && (!d.forbidden || answeredAfter(parsed, d, consentLabel(d))));
  if (permitting) {
    // STE-644 — once the permit is otherwise met, the create needs a later,
    // complete, canonical-scope listing of the project's containers.
    // STE-650 AC-13 — a full Linear milestone window never proves the last
    // page, so an allowed decision followed by a 50-row re-list needs the
    // operator's consent answer, exactly like a forbidden one.
    const label = consentLabel(permitting);
    const consented = permitting.forbidden || (call.adapter === "linear" && answeredAfter(parsed, permitting, label));
    const fresh = relistsAfter(parsed, permitting.line, call.adapter, want.project, consented).filter((r) => freshBefore(parsed, r));
    const capped = consented || call.adapter !== "linear" ? [] : relistsAfter(parsed, permitting.line, call.adapter, want.project, true).filter((r) => freshBefore(parsed, r));
    const dup = [...fresh, ...capped].map((r) => openSameTitle(call.adapter, r, want.title)).find((k) => k !== null);
    if (dup !== undefined) {
      return refuse(
        `${where}: the re-list of project ${want.project}'s containers after its create decision (${permitting.path}) holds the open ${name} \`${dup}\` titled "${want.title}", so creating it again would duplicate it.${note}`,
        `join it: decide with --join-key \`${dup}\` --sibling \`<path>\`; nothing is created.`,
      );
    }
    if (fresh.length > 0) return 0;
    if (capped.length > 0) {
      return refuse(
        `${where}: the re-list of project ${want.project}'s containers after its create decision (${permitting.path}) returned a full window of ${capped[capped.length - 1]!.items.length} rows, which never proves the ${name} "${want.title}" is absent, and ${unansweredConsent(label)}.${note}`,
        `ask the operator with AskUserQuestion, naming "${want.title}" and offering "${label}"; only that recorded answer after the decision permits this create — another re-list returns the same full window.`,
      );
    }
    return refuse(
      `${where}: its create decision (${permitting.path}) has no later, complete listing of project ${want.project}'s containers recorded in this session, so the ${name} "${want.title}" may exist already.${note}`,
      relistRemedy(call.adapter, want.project),
    );
  }
  // STE-643 — an unspent create decision that printed default=forbidden
  // permits only once its consent label was answered after it.
  const unconsented = matching.filter((d) => !d.spent);
  if (unconsented.length > 0) {
    const d = unconsented[unconsented.length - 1]!;
    const label = consentLabel(d);
    return refuse(
      `${where}: its create decision (${d.path}) printed default=forbidden — the listing may be capped — and ${unansweredConsent(label)}.${note}`,
      `ask the operator with AskUserQuestion, naming "${want.title}" and offering "${label}"; only that recorded answer after the decision permits this create.`,
    );
  }
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
 * renames a label; the one other permitted write is a label create of the
 * target's own `repo_tag` — `create_issue_label`, or `save_issue_label` with no
 * `id` (the create the Linear MCP steers to; it marks the former deprecated).
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
  // A label CREATE: `create_issue_label`, or `save_issue_label` with no `id` —
  // the Linear MCP marks create_issue_label deprecated and steers a model to
  // save_issue_label, so the permit must cover both or the recommended tool is
  // refused. A save_issue_label WITH an id is a rename, refused below.
  if (call.tool === "create_issue_label" || (call.tool === "save_issue_label" && (call.input.id === undefined || call.input.id === null || call.input.id === ""))) {
    const name = typeof call.input.name === "string" ? call.input.name : "";
    // Only a PLAIN label: a label group, or a label nested under one, named like
    // the repo tag has no honest use, so it falls to the refusal below.
    const parent = call.input.parent;
    const plain = call.input.isGroup !== true && (parent === undefined || parent === null || parent === "");
    if (plain && name !== "" && targets.some((t) => t.binding.repoTag === name)) return 0;
    return refuse(
      `${where}: ${call.tool} "${name}" is not a declared target's repo tag (${targets.map((t) => t.binding.repoTag ?? "none").join(", ")}), and no toolkit flow creates any other label.${note}`,
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
  transcript: string[] = [],
): ExitCode | null {
  if (call.adapter !== "jira" || call.tool !== "editJiraIssue") return null;
  const fields = call.input.fields;
  if (!fields || typeof fields !== "object" || !("labels" in (fields as Record<string, unknown>))) return null;
  // Only a write whose SOLE effect is the labels set is a read-merge. Any other
  // field, or any other top-level key (an `update` block), leaves the call to
  // the ownership rule of §4 (M_685ff6 review: a superset must not carry a
  // summary edit onto a sibling's Epic).
  if (Object.keys(fields as Record<string, unknown>).some((k) => k !== "labels")) return null;
  if (Object.keys(call.input).some((k) => k !== "cloudId" && k !== "issueIdOrKey" && k !== "fields")) return null;
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
  // Review TWR-4 (round 2): an Epic this session created needs no join
  // consent — it is its own — but its labels write is still a read-merge: the
  // listed labels and the milestone label below are checked for every joined
  // Epic, created here or not (AC-STE-608.10 (d)). STE-650 AC.1 — the hook
  // derives the key's ownership route and the shared predicate decides; the
  // hook tells only "created" from every other route (an FR binding, a reuse,
  // binding or import receipt), and none of those is exempt.
  const parsed = parseLines(transcript);
  const route = createdKeys(parsed, call.adapter).has(key) ? "created" : "not-created";
  const consent = consentLabel(join);
  const unconsented = !exemptsJoinConsent(route) && join.forbidden && !answeredAfter(parsed, join, consent);
  if (unconsented) {
    return refuse(
      `editJiraIssue on ${key}, an Epic joined by ${join.path}: that decision printed default=forbidden, and ${unansweredConsent(consent)}.${note}`,
      `ask the operator with AskUserQuestion naming ${key}, offering the printed \`options=\` labels verbatim; write the labels only after the answer is exactly "${consent}".`,
    );
  }
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
 * transcript (no announced roots, no session-created keys), the count of
 * announced receipt files that could not be read (with their errno codes), and
 * the count that were read but failed to parse.
 */
function unreadableInputsNote(payload: HookPayload, transcript: string[] | null, scan: AnnouncementScan): string {
  const { announcements } = scan;
  if (transcript === null) {
    return ` The session transcript (${payload.transcript_path || "no transcript_path"}) is unreadable, so no announced receipt roots or session-created keys were counted.`;
  }
  let unparseable = 0;
  let unreadable = 0;
  const errnos = new Set<string>();
  let rewritten = 0;
  const ownSession = sessionIdOf(payload);
  const otherSessions = scan.foreign.map((f) => f.session);
  for (const a of announcements) {
    if (!a.intact) {
      rewritten++;
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(a.receiptPath, "utf-8");
    } catch (e) {
      unreadable++;
      errnos.add((e as NodeJS.ErrnoException)?.code ?? "unknown error");
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      unparseable++;
      continue;
    }
    const writer = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).sessionId : undefined;
    if (typeof writer === "string" && writer !== ownSession) otherSessions.push(writer);
  }
  const notes: string[] = [];
  if (unreadable > 0) notes.push(` ${unreadable} announced receipt file(s) could not be read (${[...errnos].join(", ")}) and were ignored.`);
  if (unparseable > 0) notes.push(` ${unparseable} announced receipt file(s) failed to parse and were ignored.`);
  if (rewritten > 0) notes.push(` ${rewritten} announced receipt file(s) changed after their announcement and were ignored.`);
  if (otherSessions.length > 0) {
    notes.push(
      ` ${otherSessions.length} announced receipt file(s) belong to another session (${[...new Set(otherSessions)].join(", ")}) and authorise nothing in this one — run the deciding command in this session.`,
    );
  }
  if (scan.rejected.length > 0) {
    const last = scan.rejected[scan.rejected.length - 1]!;
    notes.push(
      ` ${scan.rejected.length} Bash command(s) ran a deciding subcommand in a shape that is not a plain invocation, so any receipt they wrote was ignored — the latest: \`${last.length > 240 ? `${last.slice(0, 240)}…` : last}\`.`,
    );
  }
  return notes.join("");
}

/**
 * STE-641 — how long the gate waits for the gated call's own tool_use line to
 * reach the transcript. The ONE transcript-lag bound: the commit and PR gates'
 * receipt wait (`RECEIPT_RESULT_WAIT_MS`, STE-650) is the same value.
 */
export const GATED_LINE_WAIT_MS = RECEIPT_RESULT_WAIT_MS;
const GATED_LINE_POLL_MS = 25;

/** Whether a read holds a tool_use block whose `id` is `id` (a mere mention in text does not count). */
function holdsToolUse(lines: string[], id: string): boolean {
  return lines.some((line) => line.includes(id) && contentBlocks(line).some((b) => b.type === "tool_use" && b.id === id));
}

/**
 * STE-641 — re-read the transcript until it holds the gated call's own
 * tool_use line, for at most `waitMs`. Claude Code writes a message's tool_use
 * lines only when the message list next changes, so a LATER call of a batch
 * may find its line during the wait while a lone or first call never will.
 * An unreadable first read is returned as is. `stale` is true when the budget
 * ran out with the line still absent; the caller then grades the read with
 * the call placed last rather than refusing.
 */
export function awaitGatedLine(
  read: () => string[] | null,
  id: string,
  waitMs: number,
  sleep: (ms: number) => void,
): { lines: string[] | null; stale: boolean } {
  let lines = read();
  if (lines === null) return { lines, stale: false };
  let slept = 0;
  while (!holdsToolUse(lines, id)) {
    if (slept >= waitMs) return { lines, stale: true };
    const step = Math.min(GATED_LINE_POLL_MS, waitMs - slept);
    sleep(step);
    slept += step;
    const next = read();
    if (next !== null) lines = next;
  }
  return { lines, stale: false };
}

type Graded = { exit: ExitCode } | { scan: AnnouncementScan; declared: DeclaredTarget[]; cwdTop: string | null };

/** Announcements, declarations and the declared targets of one transcript read; an exit when grading ends there. */
function gradeRead(payload: HookPayload, call: TrackerCall, lines: string[], sessionId: string): Graded {
  // One pass over the transcript for announcements, shared by candidate
  // resolution and every gate below (no session id → nothing announced).
  const scan = scanAnnouncements(lines, sessionId);
  const cwdTop = gitTopLevel(payload.cwd);
  const declarations = readDeclarations(candidateRootsFrom(cwdTop, scan.announcements), call.adapter);
  for (const d of declarations) {
    if (d.ok) continue;
    return {
      exit: refuse(
        `${call.tool} — the declaration in ${d.root} cannot be read: ${d.error.split("\n")[0]}`,
        `fix the shared-container declaration in ${join(d.root, "CLAUDE.md")} and retry.`,
      ),
    };
  }
  const declared: DeclaredTarget[] = declarations.flatMap((d) => (d.ok && d.binding.shared ? [d] : []));
  if (declared.length === 0) return { exit: 0 }; // §3 — byte-identical when undeclared
  const floor = checkFloors(call, declared);
  if (floor !== 0) return { exit: floor };
  return { scan, declared, cwdTop };
}

export function run(stdin: string): ExitCode {
  const payload = parseHookPayload(stdin);
  if (!payload) return 0; // §6 — fail-open outside a session
  const call = identifyTrackerCall(payload);
  if (!call) return 0;

  let transcript = readTranscriptLines(payload);
  const sessionId = sessionIdOf(payload);
  let lines = transcript ?? [];
  let graded = gradeRead(payload, call, lines, sessionId);
  if ("exit" in graded) return graded.exit;

  // STE-641 — the gated call's own line may not be flushed yet: wait for it
  // when this call writes into a declared target, then grade the final read.
  const id = payload.tool_use_id;
  const first = transcript;
  let stale: StaleRead | null = null;
  if (
    first !== null &&
    typeof id === "string" &&
    !holdsToolUse(first, id) &&
    graded.declared.some((d) => bindsCall(call, d)) &&
    (payload as { agent_id?: unknown }).agent_id === undefined
  ) {
    let reads = 0;
    const waited = awaitGatedLine(
      () => (reads++ === 0 ? first : readTranscriptLines(payload)),
      id,
      GATED_LINE_WAIT_MS,
      (ms) => Bun.sleepSync(ms),
    );
    transcript = waited.lines;
    if (waited.stale) stale = { path: payload.transcript_path || "no transcript_path", id };
    lines = transcript ?? [];
    graded = gradeRead(payload, call, lines, sessionId);
    if ("exit" in graded) return graded.exit;
  }
  const { scan, declared, cwdTop } = graded;
  const announcements = scan.announcements;

  const note = unreadableInputsNote(payload, transcript, scan);
  if (isCreate(call.tool, call.input)) return gateCreate(call, sessionId, lines, announcements, declared, note, cwdTop);
  if (isContainer(call.tool, call.input)) return gateContainer(call, sessionId, lines, announcements, declared, note);
  const joined = gateJoinedLabels(call, sessionId, announcements, declared, note, lines);
  if (joined !== null) return joined;
  return gateTicket(call, sessionId, lines, announcements, declared, note, stale);
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
