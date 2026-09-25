// STE-617 (M_2306b6) — synthetic evidence bundles for the live shared-tracker
// grader, and the materializer that turns one back into the on-disk records a
// real run leaves (transcripts, receipts, git history).
//
// Leading underscore: a helper module, never collected as a suite. STE-618's
// suite reuses it.
//
// EVERY BUNDLE BUILT HERE IS STAMPED `synthetic: true`. STE-618's release gate
// refuses a synthetic bundle as live proof; that stamp is the only thing that
// tells the two apart, so no builder in this file may ever omit it.
//
// ---------------------------------------------------------------------------
// The bundle shape (the contract `extractBundle` emits and `gradeBundle` reads)
// ---------------------------------------------------------------------------
//
// A bundle is a PROJECTION of the harness records, never a copy:
//   * sessions — one per ledgered session id, in ledger order. `marker` comes
//     from the scenario marker line of the session's FIRST user message
//     (`dpt-shared-tracker-scenario: <marker>[ client=<client>]`); `client` is
//     `tree` unless that line names another. `root` is the throwaway
//     repository the session's cwd is in (`A` or `B`); `cwd` is that working
//     directory rewritten relative to it (`<B>` for B's main root,
//     `<B>/.s11/relocated` for the worktree of B that S11 runs in).
//   * calls — every tool_use / tool_result pair, subagent sidechains included
//     (merged by timestamp, `sidechain: true`). `ref` is `<sid>:<tool_use_id>`.
//     Assistant TEXT is never kept.
//   * result — `isError`; `text` (a Bash tool's output with the harness's
//     `Exit code <n>` prefix removed, or an error's text; "" for a successful
//     tracker answer); `exitCode` (Bash only: 0 on success, <n> from the
//     prefix; null for a hook refusal, which never ran); `items` (a tracker
//     answer projected to key, summary, labels, status, parent, milestone,
//     issue type, kind and container); `lastPage` (a listing answer only:
//     true when the answer PROVES it is the last page, false when it names a
//     next page, null when it cannot say — a full 50-row Linear milestone
//     window). Tracker answers are read only through tracker_answer.ts; an
//     answer in no observed shape is recorded with `items: null` and a `text`
//     naming why it is unreadable.
//   * A hook refusal is the harness's `PreToolUse:<tool> hook error: [...]:
//     Refusing: …` text with `is_error: true`; its Context line names the hook
//     (`hook=pre-tracker-write-gate`, `pre-commit-gate-check`,
//     `pre-pr-spec-review`).
//   * repos — per repository: its receipts (path, session, sha256 of the
//     file's bytes, and the receipt's fields), its commits (subject and
//     committer time), its FR files' tracker bindings and its plans' tokens.
//   * Absolute paths are rewritten: the two throwaway roots become `<A>` and
//     `<B>`, the toolkit checkout `<toolkit>` and each config dir `<config>`.
//   * An audit item read without an answer field a predicate needs carries
//     `absent` (the missing answer fields); the grade aborts on it.
//   * `answers` / `answersAt` — the sanctioned answers block of the session's
//     first user message (only `tracker_orphan_import`), and when it was given.
//
// Receipt announcements: `dpt-receipt: <path> sha256:<hex>` on its own line
// in the output of ONE plain Bash run of a toolkit module
// (`bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/<module>.ts" …`, no
// chaining), the sha256 being the receipt file's own. A receipt counts only
// when the module that writes its kind announced it. A ticket create is gated
// by a `create` receipt (create_idempotency_probe.ts decide) matching its
// project, title, tag and parent/milestone AND an `attach-target` receipt
// (attach_project_milestone.ts) binding its milestone; an Epic / save_milestone
// create by a create decision (resolve_milestone_identity.ts); a write on a
// ticket key by the key being the repository's (created in the session, bound
// by an FR file, or named by a reuse, binding or consented import receipt).
// Gate receipts (commit/PR evidence) carry `adapter: null`.
//
// Audit completeness covers every key created by a session whose marker is a
// REGISTRY id; the intruder's item (reserved marker `intruder`) absent from
// the audit is `isolation-broken`, not an incomplete audit.
//
// The passing bundle, per tracker, starts exactly `spawnCeiling(tracker)` = 28
// sessions (Jira without `--jira-repoint-from`: 26, S8 a named skip).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Tracker = "jira" | "linear";
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
  /** The required answer fields the tracker's answer lacked; absent when it lacked none. */
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
  /** The session's working directory, rewritten relative to the run's roots (`<A>`, `<B>/.s11/relocated`). */
  cwd: string;
  client: Client;
  calls: ToolCall[];
  /** The first user message's answers block, for the keys the grader reads (`tracker_orphan_import`). */
  answers?: Record<string, string>;
  /** When that first user message was written. */
  answersAt?: string;
}

export interface BundleReceipt {
  path: string;
  sessionId: string;
  sha256: string;
  kind: string;
  adapter: Tracker | null;
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
  tracker: Tracker;
  pluginVersion: string;
  startedAt: string;
  behaviourDigest: { digest: string; files: Record<string, string> };
  /** The below-floor copy's digest, taken over the tree under test's tracked-file list. */
  belowFloorDigest: string;
  /** Jira: the shared space key. Linear: the shared throwaway project's name. */
  container: string;
  /** Jira: `--jira-repoint-from` (null when not given). Linear: B's pre-repoint project. */
  repointFrom: string | null;
  linearTeam: string | null;
  skips: Array<{ id: string; reason: string }>;
  /** The audit's nonce query exactly as its fence wrote it. */
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NONCE = "n7k2q9";
export const TAG_A = "shr-live-a";
export const TAG_B = "shr-live-b";
export const PLUGIN_VERSION = "2.90.0";
export const START = "2026-09-21T10:00:00.000Z";
export const HOOK_TRACKER = "pre-tracker-write-gate";
export const HOOK_COMMIT = "pre-commit-gate-check";
export const HOOK_PR = "pre-pr-spec-review";
/** The literal auto-approve marker every child prompt opens with (the answers block is inert without it). */
export const AUTO_APPROVE = "<dpt:auto-approve>v1</dpt:auto-approve>";
export const LINEAR_CAP_TEXT =
  'Error: 400 invalid_request — "You\'ve exceeded the free issue limit for this workspace"';
const MODULE = (m: string) => `"\${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/${m}"`;
const HEX = (s: string) => createHash("sha256").update(s).digest("hex");

export const title = (s: string) => `[${NONCE}] ${s}`;

/**
 * The fields the audit child requests on its issue search and read-backs, as
 * the skill's audit fence writes them. The grader's suite asserts these equal
 * the grader's `AUDIT_REQUEST_FIELDS` issue lists, so this is never a second
 * definition that can drift.
 */
export const AUDIT_FIELDS: Readonly<Record<Tracker, readonly string[]>> = {
  jira: ["summary", "labels", "status", "parent", "issuetype", "project"],
  linear: ["id", "title", "labels", "status", "project", "projectMilestone"],
};

export function sid(n: number): string {
  const h = n.toString(16).padStart(12, "0");
  return `5e55a0${n.toString(16).padStart(2, "0")}-617a-4c00-8000-${h}`;
}

/** A deep copy: every mutation in a suite starts from its own bundle. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// Tracker vocabulary
// ---------------------------------------------------------------------------

type Op = "create" | "createMilestone" | "edit" | "transition" | "search" | "listMilestones" | "get" | "getMilestone" | "getProject";

const JIRA_TOOLS: Record<Op, string> = {
  create: "createJiraIssue",
  createMilestone: "createJiraIssue",
  edit: "editJiraIssue",
  transition: "transitionJiraIssue",
  search: "searchJiraIssuesUsingJql",
  listMilestones: "searchJiraIssuesUsingJql",
  get: "getJiraIssue",
  getMilestone: "getJiraIssue",
  getProject: "getVisibleJiraProjects",
};
const LINEAR_TOOLS: Record<Op, string> = {
  create: "save_issue",
  createMilestone: "save_milestone",
  edit: "save_issue",
  transition: "save_issue",
  search: "list_issues",
  listMilestones: "list_milestones",
  get: "get_issue",
  getMilestone: "get_milestone",
  getProject: "get_project",
};

export function serverPrefix(tracker: Tracker, root: Root): string {
  if (tracker === "jira") return root === "A" ? "mcp__atlassian__" : "mcp__claude_ai_Atlassian__";
  return root === "A" ? "mcp__linear__" : "mcp__claude_ai_Linear__";
}

export function toolName(tracker: Tracker, root: Root, op: Op): string {
  return serverPrefix(tracker, root) + (tracker === "jira" ? JIRA_TOOLS : LINEAR_TOOLS)[op];
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** Jira only: `--jira-repoint-from`. Default "DST2"; null runs S8 as the named skip. */
  jiraRepointFrom?: string | null;
  /** Old-client write attempts (0 = the stop paragraph worked). Default 1. */
  oldClientWrites?: number;
  /** Untagged items the intruder writes. Default 1. */
  intruderItems?: number;
  /**
   * How S13's operator consents to the intruder item's import: an answered
   * AskUserQuestion ("ask"), or — the route a `claude -p` child has, where
   * AskUserQuestion returns an error — the first user message's sanctioned
   * answers block, `tracker_orphan_import: Import <KEY>` ("answers-block").
   * Default "ask".
   */
  importConsent?: "ask" | "answers-block";
}

class Fx {
  readonly tracker: Tracker;
  readonly opts: Required<BuildOptions>;
  readonly container: string;
  readonly repointFrom: string | null;
  private clock = Date.parse(START);
  private keySeq: Record<string, number> = {};
  private receiptSeq = 0;
  private sessionSeq = 0;
  sessions: BundleSession[] = [];
  items = new Map<string, TrackerItem>();
  created: Array<{ key: string; sessionId: string; marker: string; client: Client }> = [];
  repos: { A: RepoState; B: RepoState };

  constructor(tracker: Tracker, opts: BuildOptions) {
    this.tracker = tracker;
    this.opts = {
      jiraRepointFrom: opts.jiraRepointFrom === undefined ? "DST2" : opts.jiraRepointFrom,
      oldClientWrites: opts.oldClientWrites ?? 1,
      intruderItems: opts.intruderItems ?? 1,
      importConsent: opts.importConsent ?? "ask",
    };
    this.container = tracker === "jira" ? "DST" : `DPT Shared ${NONCE}`;
    this.repointFrom = tracker === "jira" ? this.opts.jiraRepointFrom : `DPT Pre ${NONCE}`;
    const bootstrap = (): RepoState => ({
      receipts: { readable: true, records: [] },
      commits: [{ subject: "chore: bootstrap shared-tracker smoke", at: new Date(this.clock - 60_000).toISOString() }],
      frBindings: [],
      plans: [],
    });
    this.repos = { A: bootstrap(), B: bootstrap() };
  }

  tick(): string {
    this.clock += 10_000;
    return new Date(this.clock).toISOString();
  }

  tag(root: Root): string {
    return root === "A" ? TAG_A : TAG_B;
  }

  mintKey(container: string, kind: TrackerItem["kind"]): string {
    if (this.tracker === "linear" && kind === "milestone") {
      const n = (this.keySeq.ms = (this.keySeq.ms ?? 0) + 1);
      return `5f3a9c${n.toString(16).padStart(2, "0")}-7d2e-4f00-9a00-${n.toString(16).padStart(12, "0")}`;
    }
    if (this.tracker === "linear") {
      const n = (this.keySeq.STE = (this.keySeq.STE ?? 900) + 1);
      return `STE-${n}`;
    }
    const base = container === "DST" ? 100 : 200;
    const n = (this.keySeq[container] = (this.keySeq[container] ?? base) + 1);
    return `${container}-${n}`;
  }

  session(marker: string, root: Root, client: Client = "tree", cwd: string = `<${root}>`): Session {
    const s: BundleSession = { sessionId: sid(++this.sessionSeq), marker, root, cwd, client, calls: [] };
    this.sessions.push(s);
    return new Session(this, s);
  }

  receipt(root: Root, s: BundleSession, r: Omit<BundleReceipt, "path" | "sessionId" | "sha256">): BundleReceipt {
    const path = `<${root}>/.dpt/ledger/receipts/${s.sessionId}/${r.kind}-${++this.receiptSeq}.json`;
    const rec: BundleReceipt = { path, sessionId: s.sessionId, sha256: HEX(path), ...r };
    const set = this.repos[root].receipts;
    if (set.readable) set.records.push(rec);
    return rec;
  }

  commit(root: Root, subject: string, at: string): void {
    this.repos[root].commits.push({ subject, at });
  }

  /** The milestone token a plan carries for a milestone key. */
  token(key: string): string {
    return this.tracker === "jira" ? `M_${key.replace(/[^A-Za-z0-9_]/g, "_")}` : `M_${key.slice(0, 6)}`;
  }
}

export function announcement(r: BundleReceipt): string {
  return `dpt-receipt: ${r.path} sha256:${r.sha256}`;
}

function hookRefusalText(name: string, hook: string, why: string): string {
  return (
    `PreToolUse:${name} hook error: ["\${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/${hook}.sh]: Refusing: ${why}\n` +
    `Remedy: follow the named front door, then retry.\n` +
    `Context: mode=hook, ticket=unbound, skill=none, hook=${hook}`
  );
}

class Session {
  constructor(readonly fx: Fx, readonly s: BundleSession) {}

  private push(name: string, input: Record<string, unknown>, result: ToolResult, sidechain = false): ToolCall {
    const call: ToolCall = {
      ref: `${this.s.sessionId}:toolu_${String(this.s.calls.length + 1).padStart(3, "0")}`,
      at: this.fx.tick(),
      name,
      input,
      result,
      sidechain,
    };
    this.s.calls.push(call);
    return call;
  }

  bash(command: string, text: string, exitCode = 0, sidechain = false): ToolCall {
    return this.push("Bash", { command, description: "run" }, { isError: exitCode !== 0, text, exitCode, items: null, lastPage: null }, sidechain);
  }

  bashHookRefused(command: string, hook: string, why: string): ToolCall {
    return this.push("Bash", { command, description: "run" }, { isError: true, text: hookRefusalText("Bash", hook, why), exitCode: null, items: null, lastPage: null });
  }

  tool(name: string, input: Record<string, unknown>, items: TrackerItem[] | null, lastPage: boolean | null = null): ToolCall {
    return this.push(name, input, { isError: false, text: "", exitCode: null, items: items ? clone(items) : null, lastPage });
  }

  toolRefused(name: string, input: Record<string, unknown>, why: string): ToolCall {
    return this.push(name, input, { isError: true, text: hookRefusalText(name, HOOK_TRACKER, why), exitCode: null, items: null, lastPage: null });
  }

  toolError(name: string, input: Record<string, unknown>, text: string): ToolCall {
    return this.push(name, input, { isError: true, text, exitCode: null, items: null, lastPage: null });
  }

  other(name: string, input: Record<string, unknown>, text: string): ToolCall {
    return this.push(name, input, { isError: false, text, exitCode: null, items: null, lastPage: null });
  }

  /** One ticket create through the tracker (no front door): the item it makes, or the refusal. */
  createIssue(summary: string, labels: string[], container: string, parentKey: string | null): TrackerItem {
    const fx = this.fx;
    const key = fx.mintKey(container, "issue");
    const item: TrackerItem = {
      key,
      summary,
      labels,
      status: fx.tracker === "jira" ? "To Do" : "Todo",
      parent: fx.tracker === "jira" ? parentKey : null,
      milestone: fx.tracker === "linear" ? parentKey : null,
      issueType: fx.tracker === "jira" ? "Task" : null,
      kind: "issue",
      container,
    };
    this.tool(toolName(fx.tracker, this.s.root, "create"), createInput(fx.tracker, container, summary, labels, parentKey), [item]);
    fx.items.set(key, item);
    fx.created.push({ key, sessionId: this.s.sessionId, marker: this.s.marker, client: this.s.client });
    return item;
  }

  /**
   * The FR create's two front doors, as the tracker-write hook requires them
   * in a declared target, in this order: the create decision
   * (create_idempotency_probe.ts decide → a `create` receipt, calls[0] of an
   * FR-create session), then the attach front door
   * (attach_project_milestone.ts → an `attach-target` receipt resolving the
   * container the create binds, calls[1]), then the create they decided. A create
   * under a milestone binds it by its parent (Jira) or milestone id (Linear);
   * a Jira create with no parent binds the label surface of the FR's plan
   * token, so it carries that `milestone-<token>` label; a Linear create with
   * no milestone is accepted on any resolved target in its project.
   */
  frCreate(summary: string, container: string, parentKey: string | null, frPath: string): TrackerItem {
    const fx = this.fx;
    const root = this.s.root;
    const labelToken = `M_${NONCE}`;
    const labels = fx.tracker === "jira" && parentKey === null ? [fx.tag(root), `milestone-${labelToken}`] : [fx.tag(root)];
    const attachEvidence =
      parentKey !== null
        ? fx.tracker === "jira"
          ? { surface: "parent", key: parentKey, planFile: `specs/plan/${fx.token(parentKey)}.md` }
          : { surface: "object", id: parentKey, planFile: `specs/plan/${fx.token(parentKey)}.md` }
        : fx.tracker === "jira"
          ? { surface: "label", planFile: `specs/plan/${labelToken}.md` }
          : { surface: "object", id: "", planFile: `specs/plan/${labelToken}.md` };
    const payload =
      fx.tracker === "jira"
        ? { project: container, summary, labels, parent: parentKey }
        : { team: "STE", project: container, title: summary, labels, milestone: parentKey };
    const r = fx.receipt(root, this.s, {
      kind: "create",
      adapter: fx.tracker,
      container: parentKey ?? container,
      subject: summary,
      decision: "create",
      evidence: { createPayload: payload },
    });
    this.bash(
      `bun run ${MODULE("create_idempotency_probe.ts")} decide <${root}> --title-file <${root}>/.dpt/tmp/title.txt`,
      `decision=create\n${announcement(r)}`,
    );
    const rAttach = fx.receipt(root, this.s, {
      kind: "attach-target",
      adapter: fx.tracker,
      container,
      subject: attachEvidence.planFile,
      decision: attachEvidence.surface,
      evidence: { ...attachEvidence, provenance: { kind: "not-applicable" } },
    });
    this.bash(
      `bun run ${MODULE("attach_project_milestone.ts")} <${root}> ${fx.tracker} ${fx.tracker === "jira" ? container : `"${container}"`} <${root}>/${attachEvidence.planFile} <${root}>/.dpt/tmp/listing.json`,
      `surface=${attachEvidence.surface}\n${announcement(rAttach)}`,
    );
    const item = this.createIssue(summary, labels, container, parentKey);
    fx.repos[root].frBindings.push({ path: frPath, title: summary, key: item.key, milestone: parentKey ? fx.token(parentKey) : null });
    return item;
  }

  /** A listing of the container's milestones, recorded as its last page. */
  listMilestones(items: TrackerItem[]): ToolCall {
    const fx = this.fx;
    const input =
      fx.tracker === "jira"
        ? { cloudId: "cloud-dst", jql: `project = ${fx.container} AND issuetype = Epic AND summary ~ "${NONCE}"` }
        : { project: fx.container };
    return this.tool(toolName(fx.tracker, this.s.root, "listMilestones"), input, items, true);
  }
}

function createInput(tracker: Tracker, container: string, summary: string, labels: string[], parentKey: string | null): Record<string, unknown> {
  if (tracker === "jira") {
    return {
      cloudId: "cloud-dst",
      projectKey: container,
      issueTypeName: "Task",
      summary,
      additional_fields: { labels },
      ...(parentKey ? { parent: parentKey } : {}),
    };
  }
  return { team: "STE", project: container, title: summary, labels, ...(parentKey ? { milestone: parentKey } : {}) };
}

const HOST_NAME = (tracker: Tracker, r: Root) => `dpt-shared-${tracker}-${r.toLowerCase()}`;

/**
 * The passing bundle for one tracker: every applicable live scenario passes,
 * every run-wide check holds, and nothing in it trips a privacy pattern.
 */
export function buildPassingBundle(tracker: Tracker, opts: BuildOptions = {}): LiveBundle {
  const fx = new Fx(tracker, opts);
  const nameA = HOST_NAME(tracker, "A");
  const nameB = HOST_NAME(tracker, "B");
  const skips: RunMeta["skips"] = [];
  const shared = fx.container;
  const doRepoint = fx.repointFrom !== null;

  // --- S8: B starts bound to the repoint-from container, then repoints -------
  let legacy: TrackerItem | null = null;
  if (doRepoint) {
    const s8a = fx.session("S8", "B");
    legacy = s8a.frCreate(title("S8 legacy item"), fx.repointFrom!, null, "specs/frs/fr-s8-legacy.md");
    const s8b = fx.session("S8", "B");
    const cmd = `bun run ${MODULE("repoint_tracker_binding.ts")} <B> ${tracker} ${tracker === "jira" ? shared : `"${shared}"`} --peer <A>`;
    s8b.bash(cmd, "/repoint: Refusing: row 3 — the sibling's declaration is not yet committed; nothing was written.", 1);
    const r = fx.receipt("B", s8b.s, {
      kind: "repoint",
      adapter: tracker,
      container: shared,
      subject: "<B>/CLAUDE.md",
      decision: "repoint",
      // As repoint_tracker_binding.ts records it: Jira statuses and labels rest on
      // the session's own completeness claim (no MCP tool lists them); every
      // Linear input is proven by the tracker.
      evidence: { oldProject: fx.repointFrom, newProject: shared, assertedCompleteness: tracker === "jira" ? ["statuses", "labels"] : [] },
    });
    const done = s8b.bash(cmd, `repointed ${fx.repointFrom} -> ${shared}\n${announcement(r)}`);
    fx.commit("B", "docs(claude): declare the shared tracker binding", done.at);
  } else {
    skips.push({ id: "S8", reason: "repoint-space-not-given" });
  }

  // --- the hook-less intruder writes untagged items --------------------------
  const intruder = fx.session("intruder", "A", "intruder");
  const untagged: TrackerItem[] = [];
  for (let i = 1; i <= fx.opts.intruderItems; i++) {
    untagged.push(intruder.createIssue(title(i === 1 ? "intruder untagged item" : `intruder untagged item ${i}`), [], shared, null));
  }
  const U = untagged[0]!;

  // --- S1: same-title FRs, coexisting ----------------------------------------
  const s1a = fx.session("S1", "A").frCreate(title("S1 same title"), shared, null, "specs/frs/fr-s1.md");
  const s1b = fx.session("S1", "B").frCreate(title("S1 same title"), shared, null, "specs/frs/fr-s1.md");

  // --- S3 A: the span mint ---------------------------------------------------
  const s3a = fx.session("S3", "A");
  s3a.listMilestones([]);
  const spanTitle = title("S3 span milestone");
  const rMint = fx.receipt("A", s3a.s, {
    kind: "milestone-decision",
    adapter: tracker,
    container: shared,
    subject: spanTitle,
    decision: "create",
    evidence: { act: "create", via: "", key: "", title: spanTitle, listing: { sha256: HEX("listing-empty"), rowKeys: [] } },
  });
  s3a.bash(
    `bun run ${MODULE("resolve_milestone_identity.ts")} <A> ${tracker} ${tracker === "jira" ? shared : `"${shared}"`} <A>/.dpt/tmp/listing.json --title "${spanTitle}"`,
    `act=create\nvia=\nkey=\nmilestoneId=\nlisting=0 rows\ngate=create a new milestone\ndefault=allowed\n${announcement(rMint)}`,
  );
  const epicKey = fx.mintKey(shared, "milestone");
  const epic: TrackerItem = {
    key: epicKey,
    summary: spanTitle,
    labels: tracker === "jira" ? [TAG_A] : [],
    // A Linear milestone answer carries no status and no project (measured), so its projection reads neither.
    status: tracker === "jira" ? "To Do" : "",
    parent: null,
    milestone: null,
    issueType: tracker === "jira" ? "Epic" : null,
    kind: tracker === "jira" ? "issue" : "milestone",
    container: tracker === "jira" ? shared : "",
  };
  s3a.tool(
    toolName(tracker, "A", "createMilestone"),
    tracker === "jira"
      ? { cloudId: "cloud-dst", projectKey: shared, issueTypeName: "Epic", summary: spanTitle, additional_fields: { labels: [TAG_A] } }
      : { project: shared, name: spanTitle },
    [epic],
  );
  fx.items.set(epicKey, epic);
  fx.created.push({ key: epicKey, sessionId: s3a.s.sessionId, marker: "S3", client: "tree" });
  const token = fx.token(epicKey);
  fx.repos.A.plans.push({ path: `specs/plan/${token}.md`, milestone: token });

  // --- S14: B's attach refused before its join; A's release held one-sided ----
  const s14b = fx.session("S14", "B");
  s14b.bash(
    `bun run ${MODULE("attach_project_milestone.ts")} <B> ${tracker} ${tracker === "jira" ? shared : `"${shared}"`} <B>/specs/plan/${token}.md <B>/.dpt/tmp/listing.json`,
    `/attach: Refusing: ${token} names ${nameA}'s container, but no join decision for it exists in this repository; decide the join by key first.`,
    1,
  );
  const s14a = fx.session("S14", "A");
  s14a.bash(
    `bun run ${MODULE("sibling_release.ts")} <A> <A>/specs/plan/${token}.md ${token} --children <A>/.dpt/tmp/children.json`,
    `/ship-milestone: ${nameB} is one-sided: its plan does not name ${nameA} back for ${token}.`,
    1,
  );

  // --- S3 B: the explicit join by key ----------------------------------------
  const s3b = fx.session("S3", "B");
  s3b.listMilestones([epic]);
  const rJoin = fx.receipt("B", s3b.s, {
    kind: "milestone-decision",
    adapter: tracker,
    container: shared,
    subject: epicKey,
    decision: "join",
    evidence: { act: "join", via: "key", key: epicKey, joinKey: epicKey, name: spanTitle, listing: { sha256: HEX("listing-epic"), rowKeys: [epicKey] } },
  });
  s3b.bash(
    `bun run ${MODULE("resolve_milestone_identity.ts")} <B> ${tracker} ${tracker === "jira" ? shared : `"${shared}"`} <B>/.dpt/tmp/listing.json --join-key ${epicKey}`,
    `act=join\nvia=key\nkey=${epicKey}\nmilestoneId=${token}\nlisting=1 rows\ngate=join the existing milestone\ndefault=allowed\n${announcement(rJoin)}`,
  );
  fx.repos.B.plans.push({ path: `specs/plan/${token}.md`, milestone: token });

  // --- S2: same-title FRs inside the joined milestone ------------------------
  const s2a = fx.session("S2", "A").frCreate(title("S2 joined title"), shared, epicKey, "specs/frs/fr-s2.md");
  const s2b = fx.session("S2", "B").frCreate(title("S2 joined title"), shared, epicKey, "specs/frs/fr-s2.md");

  // --- S4: orphan listings scoped by tag; the untagged detector --------------
  const listingText = (self: Root) => {
    const sib = self === "A" ? [s1b, s2b] : [s1a, s2a];
    const rows = ["| Key | Class | Owner | Toolkit-written | Title |", "|---|---|---|---|---|"];
    for (const t of sib) rows.push(`| ${t.key} | sibling | unknown | yes | ${t.summary} |`);
    for (const u of untagged) rows.push(`| ${u.key} | unowned | unknown | no | ${u.summary} |`);
    rows.push(`summary: read=${sib.length + untagged.length + 2} ours=0 sibling=${sib.length} (excluded) unowned=${untagged.length} containers=1 (excluded) bound=2 complete=true`);
    for (const u of untagged) rows.push(`options: Import ${u.key} | Skip ${u.key}`);
    return rows.join("\n");
  };
  const detectorText = (flagged: TrackerItem[]) =>
    [...flagged.map((t) => `warning unowned-container-ticket: ${t.key} "${t.summary}" (creator unknown) carries no repository tag; any repository sharing this container may claim it.`), "severity: warning"].join("\n");
  const s4a = fx.session("S4", "A");
  s4a.bash(`bun run ${MODULE("container_ownership.ts")} list <A> <A>/.dpt/tmp/page-1.json`, listingText("A"));
  s4a.bash(`bun run ${MODULE("tracker_local_reconciliation_drift.ts")} <A> <A>/.dpt/tmp/page-1.json`, detectorText(untagged));
  fx.session("S4", "B").bash(`bun run ${MODULE("container_ownership.ts")} list <B> <B>/.dpt/tmp/page-1.json`, listingText("B"));

  // --- S5: sibling-busy ship refusal, then its permit twin -------------------
  const s5a = fx.session("S5", "A");
  s5a.other("Skill", { skill: "dev-process-toolkit:ship-milestone" }, "Launching skill: dev-process-toolkit:ship-milestone");
  s5a.bash(
    `bun run ${MODULE("sibling_release.ts")} <A> <A>/specs/plan/${token}.md ${token} --offer`,
    `/ship-milestone: ${nameB} is busy: 1 active FRs (fr-s2) on ${token}; release refused, nothing committed.`,
    1,
  );
  s5a.bash("git -C <A> log -1 --format=%s", "chore: bootstrap shared-tracker smoke");
  fx.commit("B", "docs(specs): archive fr-s2", fx.tick());
  const s5b = fx.session("S5", "A");
  s5b.other("Skill", { skill: "dev-process-toolkit:ship-milestone" }, "Launching skill: dev-process-toolkit:ship-milestone");
  s5b.bash(`bun run ${MODULE("sibling_release.ts")} <A> <A>/specs/plan/${token}.md ${token} --offer`, `sibling ${nameB}: idle on ${token}`);

  // --- S6: the below-floor client, refused on the second server name ---------
  const s6 = fx.session("S6", "B", "below-floor");
  s6.toolRefused(
    toolName(tracker, "B", "create"),
    createInput(tracker, shared, title("S6 below-floor write"), [TAG_B], null),
    `this client (2.89.0) is below ${nameB}'s min_dpt_version ${PLUGIN_VERSION}; upgrade the plugin before writing.`,
  );

  // --- S7: a create with no receipt is refused --------------------------------
  const s7 = fx.session("S7", "A");
  s7.toolRefused(
    toolName(tracker, "A", "create"),
    createInput(tracker, shared, title("S7 unreceipted write"), [TAG_A], null),
    "no create receipt of this session matches the tool input; run create_idempotency_probe.ts decide first.",
  );

  // --- S9: a cross-repository write graded against the target ----------------
  const editInput = (key: string, labels: string[]) =>
    tracker === "jira" ? { cloudId: "cloud-dst", issueIdOrKey: key, fields: { labels } } : { id: key, labels };
  const transitionInput = (key: string) =>
    tracker === "jira" ? { cloudId: "cloud-dst", issueIdOrKey: key, transition: { id: "31" } } : { id: key, state: "In Progress" };
  fx.session("S9", "A").toolRefused(toolName(tracker, "A", "edit"), editInput(s1b.key, [TAG_A]), `${s1b.key}: the ticket is not owned by the declared target <B>.`);

  // --- S11: B's relocated checkout (a worktree inside B) --------------------
  // An unreceipted transition of A's S1 ticket is refused; with the worktree's
  // CLAUDE.md made unreadable, the same transition is refused naming it.
  const wt = "<B>/.s11/relocated";
  const s11 = fx.session("S11", "B", "tree", wt);
  s11.bash("git rev-parse --show-toplevel", wt);
  s11.toolRefused(toolName(tracker, "B", "transition"), transitionInput(s1a.key), `${s1a.key}: the ticket is not owned by the declared target ${wt}.`);
  s11.bash("chmod 000 CLAUDE.md", "");
  s11.toolRefused(
    toolName(tracker, "B", "transition"),
    transitionInput(s1a.key),
    `${tracker === "jira" ? "transitionJiraIssue" : "save_issue"} — the declaration in ${wt} cannot be read: EACCES: permission denied, open '${wt}/CLAUDE.md'`,
  );
  s11.bash("chmod 644 CLAUDE.md", "");

  // --- S10: the old client, then the detector (run in a subagent) ------------
  const s10o = fx.session("S10", "A", "old-client");
  const oldItems: TrackerItem[] = [];
  s10o.bash("cat <A>/CLAUDE.md", "## Tracker\nThis repository shares its tracker; a client below the floor must stop before any tracker write.");
  for (let i = 1; i <= fx.opts.oldClientWrites; i++) {
    oldItems.push(s10o.createIssue(title(i === 1 ? "S10 old client write" : `S10 old client write ${i}`), [], shared, null));
  }
  const s10d = fx.session("S10", "A");
  s10d.bash(`bun run ${MODULE("tracker_local_reconciliation_drift.ts")} <A> <A>/.dpt/tmp/page-2.json`, detectorText([...untagged, ...oldItems]), 0, true);

  // --- S13: claim and import ownership ---------------------------------------
  const s13 = fx.session("S13", "B");
  if (fx.opts.importConsent === "answers-block") {
    s13.s.answers = { tracker_orphan_import: `Import ${U.key}` };
    s13.s.answersAt = fx.tick();
  }
  s13.toolRefused(toolName(tracker, "B", "transition"), transitionInput(s1a.key), `${s1a.key}: the ticket is not owned by the declared target <B>.`);
  s13.toolRefused(toolName(tracker, "B", "edit"), editInput(s1a.key, [TAG_A, TAG_B]), `${s1a.key}: the ticket is not owned by the declared target <B>.`);
  s13.bash(`bun run ${MODULE("container_ownership.ts")} list <B> <B>/.dpt/tmp/page-3.json`, listingText("B"));
  if (fx.opts.importConsent === "ask") {
    s13.other(
      "AskUserQuestion",
      { questions: [{ question: `Import ${U.key} into ${nameB}?`, header: "Import", options: [{ label: `Import ${U.key}` }, { label: `Skip ${U.key}` }], multiSelect: false }] },
      `User has answered your questions: "Import ${U.key} into ${nameB}?"="Import ${U.key}". You can now continue with the user's answers in mind.`,
    );
  }
  const rImport = fx.receipt("B", s13.s, {
    kind: "import",
    adapter: tracker,
    container: shared,
    subject: U.key,
    decision: "import",
    evidence: { key: U.key },
  });
  s13.bash(`bun run ${MODULE("container_ownership.ts")} consent <B> ${U.key} <B>/.dpt/tmp/page-3.json`, `import=${U.key}\n${announcement(rImport)}`);
  const imported: TrackerItem = { ...U, labels: [TAG_B] };
  s13.tool(toolName(tracker, "B", "edit"), editInput(U.key, [TAG_B]), [imported]);
  fx.items.set(U.key, imported);

  // --- S12: a commit and a PR into B from a session rooted in A --------------
  const s12 = fx.session("S12", "A");
  const commitCmd = 'git -C <B> commit --allow-empty -m "s12: commit into B"';
  const prCmd = "cd <B> && gh pr create --title s12 --body s12";
  s12.bashHookRefused(commitCmd, HOOK_COMMIT, "<B> has no gate-check evidence of its own for this session.");
  s12.bashHookRefused(prCmd, HOOK_PR, "<B> has no spec-review evidence of its own for this session.");
  const g12 = fx.receipt("B", s12.s, { kind: "gate", adapter: null, container: null, subject: "gate-check", decision: "green", evidence: { head: "HEAD" } });
  s12.bash(`bun run ${MODULE("gate_receipt.ts")} gate-check <B>`, `gate=green\n${announcement(g12)}`);
  const landed12 = s12.bash(commitCmd, "[main 1a2b3c4] s12: commit into B");
  fx.commit("B", "s12: commit into B", landed12.at);
  s12.bash(prCmd, "none of the git remotes configured for this repository point to a known GitHub host.", 1);

  // --- S17: commit-writing subcommands and aliases ---------------------------
  const s17 = fx.session("S17", "A");
  const mergeCmd = "git -C <B> merge --no-ff feature-s17";
  const aliasCmd = 'git -C <B> ci --allow-empty -m "s17: aliased commit"';
  s17.bashHookRefused(mergeCmd, HOOK_COMMIT, "a merge commit into <B> is a commit; <B> has no gate-check evidence of its own.");
  s17.bashHookRefused(aliasCmd, HOOK_COMMIT, "`ci` is an alias of commit; <B> has no gate-check evidence of its own.");
  const g17 = fx.receipt("B", s17.s, { kind: "gate", adapter: null, container: null, subject: "gate-check", decision: "green", evidence: { head: "HEAD" } });
  s17.bash(`bun run ${MODULE("gate_receipt.ts")} gate-check <B>`, `gate=green\n${announcement(g17)}`);
  const merged = s17.bash(mergeCmd, "Merge made by the 'ort' strategy.");
  fx.commit("B", "Merge branch 'feature-s17'", merged.at);
  const aliased = s17.bash(aliasCmd, "[main 5d6e7f8] s17: aliased commit");
  fx.commit("B", "s17: aliased commit", aliased.at);

  // --- S16: a new numeric milestone, record-only -----------------------------
  for (const root of ["A", "B"] as const) {
    const s16 = fx.session("S16", root);
    s16.bash(
      `bun run ${MODULE("next_free_milestone_number.ts")} <${root}>/specs M999`,
      "Refusing: this repository is in tracker mode; a new milestone is minted by resolve_milestone_identity.ts, never by a typed M<N>.",
      1,
    );
    s16.bash(
      `bun run ${MODULE("plan_identity_mode_conditional.ts")} <${root}>`,
      JSON.stringify({ violations: [{ severity: "error", file: "specs/plan/M999.md", note: "a hand-written M<N> plan in tracker mode" }] }),
      1,
    );
  }

  // --- audit 1: the fixed nonce query, paged to its last page, then read-backs
  const auditQuery = tracker === "jira" ? `summary ~ "${NONCE}" ORDER BY key ASC` : NONCE;
  const auditInput = (page: number) =>
    tracker === "jira"
      ? { cloudId: "cloud-dst", jql: auditQuery, fields: [...AUDIT_FIELDS.jira], ...(page > 1 ? { nextPageToken: `page-${page}` } : {}) }
      : { query: auditQuery, includeArchived: true, fields: [...AUDIT_FIELDS.linear], ...(page > 1 ? { cursor: `page-${page}` } : {}) };
  const auditItems = () => [...fx.items.values()].filter((t) => t.kind === "issue");
  const a1 = fx.session("audit", "A");
  const all = auditItems();
  const half = Math.ceil(all.length / 2);
  a1.tool(toolName(tracker, "A", "search"), auditInput(1), all.slice(0, half), false);
  a1.tool(toolName(tracker, "A", "search"), auditInput(2), all.slice(half), true);
  if (tracker === "linear") {
    a1.tool(toolName(tracker, "A", "listMilestones"), { project: shared }, [...fx.items.values()].filter((t) => t.kind === "milestone"), true);
  }
  for (const c of fx.created) {
    const it = fx.items.get(c.key)!;
    const op = it.kind === "milestone" ? "getMilestone" : "get";
    const input = tracker === "jira" ? { cloudId: "cloud-dst", issueIdOrKey: c.key, fields: [...AUDIT_FIELDS.jira] } : op === "getMilestone" ? { project: shared, query: c.key } : { id: c.key };
    a1.tool(toolName(tracker, "A", op), input, [it]);
  }

  // --- audit 2: after teardown, every nonce item is Done / both projects completed
  const a2 = fx.session("audit", "A");
  if (tracker === "jira") {
    a2.tool(toolName(tracker, "A", "search"), auditInput(1), auditItems().map((t) => ({ ...t, status: "Done" })), true);
  } else {
    a2.tool(toolName(tracker, "A", "search"), auditInput(1), auditItems(), true);
    for (const name of [shared, fx.repointFrom!]) {
      a2.tool(toolName(tracker, "A", "getProject"), { query: name }, [
        { key: name, summary: name, labels: [], status: "Completed", parent: null, milestone: null, issueType: null, kind: "project", container: name },
      ]);
    }
  }

  const files = { "adapters/_shared/src/shared_tracker_live_grader.ts": HEX("grader"), ".claude-plugin/plugin.json": HEX("manifest") };
  const digest = HEX(JSON.stringify(files));
  return {
    schema: 1,
    synthetic: true,
    run: {
      runId: "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
      nonce: NONCE,
      tracker,
      pluginVersion: PLUGIN_VERSION,
      startedAt: START,
      behaviourDigest: { digest, files },
      belowFloorDigest: digest,
      container: shared,
      repointFrom: fx.repointFrom,
      linearTeam: tracker === "linear" ? "STE" : null,
      skips,
      auditQuery,
    },
    roots: { A: { name: nameA, tag: TAG_A }, B: { name: nameB, tag: TAG_B } },
    ledger: fx.sessions.map((s) => s.sessionId),
    sessions: fx.sessions,
    repos: fx.repos,
    unledgeredSessions: [],
  };
}

// ---------------------------------------------------------------------------
// Queries over a bundle (for mutations)
// ---------------------------------------------------------------------------

export function sessionsOf(b: LiveBundle, marker: string): BundleSession[] {
  return b.sessions.filter((s) => s.marker === marker);
}

export function allCalls(b: LiveBundle): ToolCall[] {
  return b.sessions.flatMap((s) => s.calls);
}

export function audits(b: LiveBundle): BundleSession[] {
  return sessionsOf(b, "audit");
}

/** Every create answer's key, per session (successful tracker creates only). */
export function createdKeys(s: BundleSession): string[] {
  return s.calls.filter((c) => !c.result.isError && isCreateCall(c)).flatMap((c) => (c.result.items ?? []).map((i) => i.key));
}

export function isCreateCall(c: ToolCall): boolean {
  if (/__createJiraIssue$/.test(c.name)) return true;
  if (/__save_milestone$/.test(c.name)) return !c.input.id;
  if (/__save_issue$/.test(c.name)) return !c.input.id;
  return false;
}

/** Apply `f` to every audit answer's copy of `key` (pages and read-backs). */
export function editAuditItem(b: LiveBundle, key: string, f: (i: TrackerItem) => void, which: "first" | "all" = "first"): void {
  const as = audits(b);
  for (const a of which === "first" ? as.slice(0, 1) : as) {
    for (const c of a.calls) for (const i of c.result.items ?? []) if (i.key === key) f(i);
  }
}

/** Remove `key` from every answer of the first audit. */
export function dropFromAudit(b: LiveBundle, key: string): void {
  const a = audits(b)[0]!;
  for (const c of a.calls) if (c.result.items) c.result.items = c.result.items.filter((i) => i.key !== key);
  a.calls = a.calls.filter((c) => !(c.result.items !== null && c.result.items.length === 0 && c.result.lastPage === null));
}

/** Add an item to the first audit's last page. */
export function addToAudit(b: LiveBundle, item: TrackerItem): void {
  const a = audits(b)[0]!;
  const last = [...a.calls].reverse().find((c) => c.result.lastPage === true && /__(searchJiraIssuesUsingJql|list_issues)$/.test(c.name))!;
  last.result.items!.push(item);
}

/** Remove whole sessions, with every receipt they wrote and every commit made during them. */
export function removeSessions(b: LiveBundle, ids: string[]): void {
  const gone = new Set(ids);
  b.sessions = b.sessions.filter((s) => !gone.has(s.sessionId));
  b.ledger = b.ledger.filter((s) => !gone.has(s));
  for (const r of ["A", "B"] as const) {
    const set = b.repos[r].receipts;
    if (set.readable) set.records = set.records.filter((x) => !gone.has(x.sessionId));
  }
}

function findCall(b: LiveBundle, marker: string, pred: (c: ToolCall, s: BundleSession) => boolean, nth = 0): ToolCall {
  const hits = sessionsOf(b, marker).flatMap((s) => s.calls.filter((c) => pred(c, s)));
  const c = hits[nth];
  if (!c) throw new Error(`fixture: no call in ${marker} matches`);
  return c;
}

const bashWith = (re: RegExp) => (c: ToolCall) => c.name === "Bash" && re.test(String(c.input.command));

function landAsGitError(c: ToolCall): void {
  c.result = { isError: true, text: "fatal: cannot lock ref 'HEAD': unable to create lock file", exitCode: 128, items: null, lastPage: null };
}

// ---------------------------------------------------------------------------
// One break per live registry id (AC-STE-617.9): a bundle that differs from
// the passing one only in that scenario's records, so the grade fails naming
// exactly that id. An id with no break THROWS — the loop in the grader suite
// iterates the registry, so a new live id without one fails loudly there.
// ---------------------------------------------------------------------------

export const SCENARIO_BREAKS: Readonly<Record<string, (b: LiveBundle) => string>> = {
  S1: (b) => {
    const s1b = createdKeys(sessionsOf(b, "S1").find((s) => s.root === "B")!)[0]!;
    editAuditItem(b, s1b, (i) => (i.labels = [TAG_A]));
    return "B's same-title FR reads A's tag in the audit, so no item carries B's";
  },
  S2: (b) => {
    const aKey = b.repos.A.frBindings.find((f) => f.path === "specs/frs/fr-s2.md")!.key;
    b.repos.B.frBindings.find((f) => f.path === "specs/frs/fr-s2.md")!.key = aKey;
    return "both repositories' fr-s2 files bind A's ticket";
  },
  S3: (b) => {
    const epic = createdKeys(sessionsOf(b, "S3")[0]!)[0]!;
    const first = audits(b)[0]!;
    const orig = first.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === epic)!;
    const dup = { ...orig, key: b.run.tracker === "jira" ? "DST-190" : "5f3a9cff-7d2e-4f00-9a00-0000000000ff" };
    const lastList = [...first.calls].reverse().find((c) => c.result.lastPage === true && (b.run.tracker === "jira" ? /__searchJiraIssuesUsingJql$/ : /__list_milestones$/).test(c.name))!;
    lastList.result.items!.push(dup);
    return "the audit holds two milestone containers for the span title";
  },
  S4: (b) => {
    const c = findCall(b, "S4", (c, s) => s.root === "A" && bashWith(/container_ownership\.ts" list/)(c));
    c.result.text = c.result.text.replace("| sibling |", "| ours |");
    return "A's orphan listing claims one of B's keys as its own";
  },
  S5: (b) => {
    const refusal = findCall(b, "S5", bashWith(/sibling_release\.ts/));
    const next = sessionsOf(b, "S5")[0]!.calls[2]!;
    const mid = new Date((Date.parse(refusal.at) + Date.parse(next.at)) / 2).toISOString();
    b.repos.A.commits.push({ subject: "chore(release): v0.2.0", at: mid });
    b.repos.A.commits.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    return "A's history gains a release commit during the busy-sibling step";
  },
  S6: (b) => {
    const c = sessionsOf(b, "S6")[0]!.calls[0]!;
    c.name = c.name.replace(serverPrefix(b.run.tracker, "B"), serverPrefix(b.run.tracker, "A"));
    return "no refusal is recorded on the second server name";
  },
  S7: (b) => {
    const c = sessionsOf(b, "S7")[0]!.calls[0]!;
    c.result.text = "Error: 400 Bad Request — the tracker rejected the payload";
    return "the unreceipted create was stopped by the tracker, not by the hook";
  },
  S8: (b) => {
    const legacy = createdKeys(sessionsOf(b, "S8")[0]!)[0]!;
    const orig = audits(b)[0]!.calls.flatMap((c) => c.result.items ?? []).find((i) => i.key === legacy)!;
    addToAudit(b, { ...orig, key: b.run.tracker === "jira" ? "DST-191" : "STE-991", container: b.run.container });
    return "a nonce item in the shared container duplicates the legacy item's title";
  },
  S9: (b) => {
    const c = sessionsOf(b, "S9")[0]!.calls[0]!;
    c.result = { isError: false, text: "", exitCode: null, items: [], lastPage: null };
    return "A's write to B's ticket went through";
  },
  S10: (b) => {
    const c = findCall(b, "S10", bashWith(/tracker_local_reconciliation_drift\.ts/));
    c.result.text = c.result.text.split("\n").filter((l) => !/S10 old client write/.test(l)).join("\n");
    return "the detector misses the old client's item";
  },
  S11: (b) => {
    const c = sessionsOf(b, "S11")[0]!.calls.find((x) => x.name !== "Bash")!;
    c.result = { isError: false, text: "", exitCode: null, items: [], lastPage: null };
    return "the relocated checkout's write went through, read as undeclared";
  },
  S12: (b) => {
    landAsGitError(findCall(b, "S12", bashWith(/commit --allow-empty/)));
    return "the commit into B was stopped by a git error, not by the hook";
  },
  S13: (b) => {
    const c = sessionsOf(b, "S13")[0]!.calls[0]!;
    c.result = { isError: false, text: "", exitCode: null, items: [], lastPage: null };
    return "B's claim transition on A's ticket went through";
  },
  S14: (b) => {
    const c = findCall(b, "S14", (c, s) => s.root === "B" && bashWith(/attach_project_milestone\.ts/)(c));
    c.result = { isError: false, text: "act=attach\nlisting=1 rows", exitCode: 0, items: null, lastPage: null };
    return "B's attach before its join exited 0";
  },
  S16: (b) => {
    const c = findCall(b, "S16", (c, s) => s.root === "A" && bashWith(/next_free_milestone_number\.ts/)(c));
    c.result = { isError: false, text: "typed=M999\nverdict=free\nnext-free=M999", exitCode: 0, items: null, lastPage: null };
    return "A's typed M999 door run exited 0";
  },
  S17: (b) => {
    const c = findCall(b, "S17", bashWith(/merge --no-ff/));
    c.result = { isError: false, text: "Merge made by the 'ort' strategy.", exitCode: 0, items: null, lastPage: null };
    return "the merge into B landed before B's evidence existed";
  },
};

export function breakScenario(b: LiveBundle, id: string): string {
  const f = SCENARIO_BREAKS[id];
  if (!f) throw new Error(`fixture: no break is defined for live scenario ${id} — add one to SCENARIO_BREAKS`);
  return f(b);
}

// ---------------------------------------------------------------------------
// The materializer: a bundle back into the records a real run leaves.
// ---------------------------------------------------------------------------

export interface Materialized {
  configDir: string;
  roots: { A: string; B: string };
  ledger: string[];
  run: RunMeta;
  /** Per session id: its main transcript file. */
  transcripts: Record<string, string>;
}

export interface MaterializeOptions {
  /** Keep `base` as spelled instead of resolving it, so transcripts record a symlinked path (the ROOT ALIAS mirror case). */
  keepBase?: boolean;
  /** Assistant text written beside every tool call (the grader must never read it). */
  assistantText?: string;
  /** Tool-use refs whose result is persisted as a pointer + preview; the full text lives in `<sid>/tool-results/<id>.txt`. */
  persistRefs?: string[];
  /** Persisted refs whose pointer FILE is not written. */
  dropPersistedFiles?: string[];
  /**
   * How a persisted result's pointer reads. `persisted-output` is the Bash
   * form; `mcp-token-limit` is what the harness writes for an MCP answer over
   * the token limit (measured on live leg 9, 2026-09-25: a plain-string
   * tool_result, `Error: result (N characters) exceeds maximum allowed
   * tokens. Output has been saved to <file>.`, the file holding the answer's
   * raw JSON). Default `persisted-output`.
   */
  persistShape?: "persisted-output" | "mcp-token-limit";
  /** The Jira answer shape the transcripts record (`trackerAnswer`); default `plain`. */
  jiraShape?: JiraShape;
}

const SITE = "https://acme-sandbox.atlassian.net";
const SITE_SELF = `${SITE}/rest/api/3/issue/`;
/** The Linear team's DISPLAY name: a row's `team` is a name, never the key (measured: tests/fixtures/live-shapes/linear/list_issues.*.json). */
export const LINEAR_TEAM_DISPLAY_NAME = "Shared Smoke Team";
const JIRA_EXPAND = "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations";

/**
 * The tracker answers below are built in the MEASURED shapes, key for key: the
 * pinned real answers under tests/fixtures/live-shapes/ (each with its
 * provenance), and tests/m_2306b6-ste-617-live-shape-pins.test.ts fails when a
 * built answer's top-level or item key set drifts from its pin. Jira answers
 * come in either of the two shapes the same server was recorded sending:
 * `plain` (`{ issues, isLast, nextPageToken? }`, an item `{ id, key, self, … }`)
 * or `wrapped` (`{ context, issues: { nodes, pageInfo, webUrl } }`).
 */
function jiraIssue(i: TrackerItem, wrapped: boolean): Record<string, unknown> {
  const id = `1${i.key.replace(/\D/g, "")}`;
  return {
    expand: JIRA_EXPAND,
    id,
    self: `${SITE_SELF}${id}`,
    key: i.key,
    fields: {
      summary: i.summary,
      labels: i.labels,
      status: { name: i.status },
      parent: i.parent ? { key: i.parent } : null,
      issuetype: { name: i.issueType },
      project: { key: i.container },
      reporter: { accountId: "5b10ac8d82e05b22cc7d4ef5", emailAddress: "ops@acme-sandbox.io", displayName: "Ops" },
    },
    ...(wrapped ? { webUrl: `${SITE}/browse/${i.key}` } : {}),
  };
}

/** A wrapped answer's `context` (its account id is what the projection must never carry into a bundle). */
const jiraContext = (tool: string): Record<string, unknown> => ({
  atlassianAccountId: "5b10ac8d82e05b22cc7d4ef5",
  cloudId: "cloud-dst",
  clientName: "localhost",
  mcpClientName: "claude-code",
  toolName: tool,
  endpoint: "v1:streamable-http",
  env: "prod",
});

const linearUuid = (key: string) => `${HEX(key).slice(0, 8)}-0000-4000-8000-000000000000`;

/** Every field of a Linear issue the server can answer, by name (a `list_issues` row carries only those its `fields` asked for, plus `id`). */
function linearIssueFields(i: TrackerItem): Record<string, unknown> {
  return {
    id: i.key,
    uuid: linearUuid(i.key),
    title: i.summary,
    description: "Reported by ops@acme-sandbox.io.",
    projectMilestone: i.milestone ? { id: i.milestone, name: "a milestone" } : null,
    priority: { value: 0, name: "No priority" },
    url: `https://linear.app/acme-ws/issue/${i.key}/x`,
    gitBranchName: `ops/${i.key.toLowerCase()}-x`,
    createdAt: START,
    updatedAt: START,
    archivedAt: null,
    completedAt: null,
    startedAt: null,
    canceledAt: null,
    dueDate: null,
    slaStartedAt: null,
    slaMediumRiskAt: null,
    slaHighRiskAt: null,
    slaBreachesAt: null,
    status: i.status,
    statusType: "unstarted",
    labels: i.labels,
    attachments: [],
    documents: [],
    createdBy: "Ops",
    createdById: "2d5a2118-0000-4000-8000-000000000001",
    assignee: null,
    assigneeId: null,
    project: i.container,
    projectId: `proj-${HEX(i.container).slice(0, 8)}`,
    team: LINEAR_TEAM_DISPLAY_NAME,
    teamId: "e1181251-0000-4000-8000-000000000001",
  };
}

/** The keys of a `save_issue` answer (create and update alike), measured. */
const LINEAR_SAVE_ISSUE_KEYS = [
  "id", "uuid", "title", "description", "projectMilestone", "priority", "url", "gitBranchName", "createdAt", "updatedAt",
  "archivedAt", "completedAt", "startedAt", "canceledAt", "dueDate", "slaStartedAt", "slaMediumRiskAt", "slaHighRiskAt",
  "slaBreachesAt", "status", "statusType", "labels", "attachments", "documents", "createdBy", "createdById", "assignee",
  "assigneeId", "project", "projectId", "team", "teamId",
] as const;

const pick = (o: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

function linearMilestone(i: TrackerItem, withDescription: boolean): Record<string, unknown> {
  return { id: i.key, name: i.summary, ...(withDescription ? { description: "" } : {}), progress: 0, sortOrder: 1000 };
}

function linearProject(i: TrackerItem): Record<string, unknown> {
  const id = `proj-${HEX(i.key).slice(0, 8)}`;
  const team = { id: "e1181251-0000-4000-8000-000000000001", name: LINEAR_TEAM_DISPLAY_NAME, key: "STE" };
  return {
    id,
    uuid: id,
    icon: null,
    color: "#bec2c8",
    name: i.summary,
    summary: "",
    description: "",
    url: `https://linear.app/acme-ws/project/${id}`,
    resourceCount: 0,
    createdAt: START,
    updatedAt: START,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    startDate: null,
    startDateResolution: null,
    targetDate: null,
    targetDateResolution: null,
    priority: { value: 0, name: "No priority" },
    labels: [],
    initiatives: [],
    lead: {},
    leadTeam: team,
    // A project's status is `{ id, name, type }`, its `type` the workflow category (measured live 2026-09-21).
    status: { id: "st-1", name: i.status, type: i.status.toLowerCase() },
    teams: [team],
  };
}

export type JiraShape = "plain" | "wrapped";
export const JIRA_SHAPES: readonly JiraShape[] = ["plain", "wrapped"];

/**
 * The raw answer the tracker sends for one recorded call, in the measured
 * shape of its tool. A shape no measurement covers throws: a double never
 * invents one.
 */
export function trackerAnswer(tracker: Tracker, c: ToolCall, jiraShape: JiraShape = "plain"): unknown {
  const items = c.result.items ?? [];
  const tool = c.name.split("__").at(-1)!;
  if (tracker === "jira") {
    const wrapped = jiraShape === "wrapped";
    if (tool === "searchJiraIssuesUsingJql") {
      const last = c.result.lastPage === true;
      const rows = items.map((i) => jiraIssue(i, wrapped));
      if (!wrapped) return { issues: rows, isLast: last, ...(last ? {} : { nextPageToken: "page-2" }) };
      return {
        context: jiraContext(tool),
        issues: { nodes: rows, pageInfo: { hasNextPage: !last, endCursor: last ? null : "page-2" }, webUrl: `${SITE}/issues?jql=x`, ...(last ? {} : { remainingCount: 1 }) },
      };
    }
    const one = items[0];
    if (one === undefined) return { ok: true };
    if (tool === "createJiraIssue" && !wrapped) {
      const id = `1${one.key.replace(/\D/g, "")}`;
      return { id, key: one.key, self: `${SITE_SELF}${id}` };
    }
    // getJiraIssue (measured both ways); editJiraIssue is answered like a read (unmeasured: no transcript recorded one).
    return wrapped ? { context: jiraContext(tool), issues: { nodes: [jiraIssue(one, true)] } } : jiraIssue(one, false);
  }
  if (tool === "list_issues") {
    const fields = c.input.fields;
    if (!Array.isArray(fields) || fields.length === 0) throw new Error(`fixture: ${c.ref} — a list_issues call without \`fields\` has no measured row shape`);
    const want = ["id", ...fields.map(String)];
    const last = c.result.lastPage === true;
    return { issues: items.map((i) => pick(linearIssueFields(i), want)), hasNextPage: !last, ...(last ? {} : { cursor: "page-2" }) };
  }
  if (tool === "list_milestones") {
    // No paging field at all: fewer than the 50-row window is the whole list, so "not the last page" cannot be written.
    if (c.result.lastPage !== true) throw new Error(`fixture: ${c.ref} — a list_milestones answer carries no paging field; only a complete (< 50 rows) listing can be built`);
    return { milestones: items.map((i) => linearMilestone(i, true)) };
  }
  const one = items[0];
  if (one === undefined) return { ok: true };
  if (tool === "get_milestone") return linearMilestone(one, true);
  if (tool === "save_milestone") return linearMilestone(one, false);
  if (tool === "get_project" || tool === "save_project") return linearProject(one);
  // save_issue (create and update) and get_issue, both measured: a fetched
  // issue is the save answer plus its stateHistory (live-shapes/linear/get_issue.json).
  const issue = pick(linearIssueFields(one), LINEAR_SAVE_ISSUE_KEYS);
  if (tool === "get_issue") return { ...issue, stateHistory: [{ state: { id: "st-1", name: one.status, type: String(one.status).toLowerCase() }, startedAt: START, endedAt: null }] };
  return issue;
}

export function markerLine(marker: string, client: Client = "tree"): string {
  return `dpt-shared-tracker-scenario: ${marker}${client === "tree" ? "" : ` client=${client}`}`;
}

/** The project slug Claude Code files a session's transcript under. */
export function slugOf(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Write the bundle's records under `base` (which the caller realpaths): a
 * config dir of transcripts (sidechains in `<sid>/subagents/`), two git
 * repositories with receipts, FR files, plans and commits. Receipt digests
 * are recomputed over the bytes written, and every announcement is rewritten
 * to match, so the on-disk records agree with each other exactly.
 */
export function materialize(bundle: LiveBundle, base: string, o: MaterializeOptions = {}): Materialized {
  const b = clone(bundle);
  base = o.keepBase ? base : realpathSync(base);
  const tracker = b.run.tracker;
  const roots = { A: join(base, b.roots.A.name), B: join(base, b.roots.B.name) };
  const configDir = join(base, "config");
  mkdirSync(join(configDir, "projects"), { recursive: true });
  const shaMap = new Map<string, string>();

  const sub = (text: string) => {
    let t = text.replaceAll("<A>", roots.A).replaceAll("<B>", roots.B);
    for (const [from, to] of shaMap) t = t.replaceAll(from, to);
    return t;
  };
  const subDeep = (v: unknown): unknown =>
    typeof v === "string" ? sub(v) : Array.isArray(v) ? v.map(subDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subDeep(x)])) : v;

  const gitEnv = (at: string) => ({
    ...process.env,
    GIT_AUTHOR_NAME: "smoke",
    GIT_AUTHOR_EMAIL: "smoke@localhost",
    GIT_COMMITTER_NAME: "smoke",
    GIT_COMMITTER_EMAIL: "smoke@localhost",
    GIT_AUTHOR_DATE: at,
    GIT_COMMITTER_DATE: at,
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: base,
  });
  const git = (cwd: string, at: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, env: gitEnv(at) });
    if (r.exitCode !== 0) throw new Error(`fixture git ${args.join(" ")}: ${r.stderr.toString()}`);
  };

  for (const r of ["A", "B"] as const) {
    const root = roots[r];
    const st = b.repos[r];
    mkdirSync(root, { recursive: true });
    git(root, st.commits[0]!.at, "init", "-q");
    writeFileSync(join(root, ".gitignore"), ".dpt/\n");
    writeFileSync(join(root, "CLAUDE.md"), `# ${b.roots[r].name}\n`);
    for (const f of st.frBindings) {
      mkdirSync(dirname(join(root, f.path)), { recursive: true });
      writeFileSync(
        join(root, f.path),
        ["---", `title: ${f.title}`, ...(f.milestone ? [`milestone: ${f.milestone}`] : []), "status: active", "tracker:", `  ${tracker}: ${f.key}`, "---", "", `# ${f.title}`, ""].join("\n"),
      );
    }
    for (const p of st.plans) {
      mkdirSync(dirname(join(root, p.path)), { recursive: true });
      writeFileSync(join(root, p.path), ["---", `milestone: ${p.milestone}`, "status: active", "---", "", `## ${p.milestone}`, ""].join("\n"));
    }
    git(root, st.commits[0]!.at, "add", "-A");
    git(root, st.commits[0]!.at, "commit", "-q", "-m", st.commits[0]!.subject);
    for (const c of st.commits.slice(1)) git(root, c.at, "commit", "-q", "--allow-empty", "-m", c.subject);
    if (st.receipts.readable) {
      for (const rec of st.receipts.records) {
        const abs = rec.path.replaceAll("<A>", roots.A).replaceAll("<B>", roots.B);
        const call = b.sessions.flatMap((s) => s.calls).find((c) => c.result.text.includes(rec.sha256));
        const json = {
          v: 1,
          kind: rec.kind,
          sessionId: rec.sessionId,
          root: roots[r],
          adapter: rec.adapter,
          container: rec.container,
          subject: sub(rec.subject),
          decision: rec.decision,
          evidence: subDeep(rec.evidence),
          createdAt: call?.at ?? START,
        };
        const bytes = `${JSON.stringify(json, null, 2)}\n`;
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, bytes);
        shaMap.set(`sha256:${rec.sha256}`, `sha256:${HEX(bytes)}`);
      }
    }
  }

  const transcripts: Record<string, string> = {};
  const persist = new Set(o.persistRefs ?? []);
  const dropFile = new Set(o.dropPersistedFiles ?? []);
  const text = o.assistantText ?? "Working on it.";
  for (const s of b.sessions) {
    const cwd = s.cwd.replaceAll("<A>", roots.A).replaceAll("<B>", roots.B);
    const dir = join(configDir, "projects", slugOf(cwd));
    mkdirSync(dir, { recursive: true });
    const base0 = { sessionId: s.sessionId, cwd, entrypoint: "sdk-cli", version: "2.1.0", userType: "external", gitBranch: "main" };
    const main: unknown[] = [];
    const side: unknown[] = [];
    let uuid = 0;
    const u = () => `${s.sessionId.slice(0, 8)}-0000-4000-8000-${String(++uuid).padStart(12, "0")}`;
    const first = s.answersAt ?? s.calls[0]?.at ?? START;
    const block = s.answers ? `<dpt:answers>v1\n${Object.entries(s.answers).map(([k, v]) => `${k}: ${v}`).join("\n")}\n</dpt:answers>\n` : "";
    main.push({
      ...base0,
      type: "user",
      isSidechain: false,
      uuid: u(),
      parentUuid: null,
      timestamp: first,
      message: { role: "user", content: `${AUTO_APPROVE}\n${markerLine(s.marker, s.client)}\n${block}Run the scenario step below.\nThen stop.` },
    });
    for (const c of s.calls) {
      const id = c.ref.split(":")[1]!;
      const target = c.sidechain ? side : main;
      const extra = c.sidechain ? { isSidechain: true, agentId: "a1b2c3d4e5f6a7b8c" } : { isSidechain: false };
      target.push({
        ...base0,
        ...extra,
        type: "assistant",
        uuid: u(),
        timestamp: c.at,
        message: { role: "assistant", content: [{ type: "text", text }, { type: "tool_use", id, name: c.name, input: subDeep(c.input) }] },
      });
      let content: unknown;
      if (c.name === "Bash") {
        const out = sub(c.result.text);
        content = c.result.exitCode === null ? out : c.result.exitCode === 0 ? out : `Exit code ${c.result.exitCode}\n${out}`;
      } else if (c.result.isError || c.result.items === null) {
        content = sub(c.result.text);
      } else {
        content = [{ type: "text", text: JSON.stringify(trackerAnswer(tracker, c, o.jiraShape)) }];
      }
      if (persist.has(c.ref)) {
        const full = typeof content === "string" ? content : (content as Array<{ text: string }>)[0]!.text;
        const file = join(dir, s.sessionId, "tool-results", `${id}.txt`);
        if (!dropFile.has(c.ref)) {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, full);
        }
        content =
          o.persistShape === "mcp-token-limit"
            ? `Error: result (${full.length.toLocaleString("en-US")} characters) exceeds maximum allowed tokens. Output has been saved to ${file}.\nFormat: JSON with schema: {issues: {nodes: [{...}]}}\n- For targeted queries (find a value, filter by field): use jq on the file directly.\n`
            : `<persisted-output>\nOutput too large (${Math.ceil(full.length / 1024)}KB). Full output saved to: ${file}\n\nPreview (first 2KB):\n${full.slice(0, 40)}\n...\n</persisted-output>`;
      }
      target.push({
        ...base0,
        ...extra,
        type: "user",
        uuid: u(),
        timestamp: c.at,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: c.result.isError }] },
      });
    }
    main.push({ ...base0, type: "assistant", isSidechain: false, uuid: u(), timestamp: s.calls.at(-1)?.at ?? first, message: { role: "assistant", content: [{ type: "text", text }] } });
    const file = join(dir, `${s.sessionId}.jsonl`);
    writeFileSync(file, main.map((l) => JSON.stringify(l)).join("\n") + "\n");
    transcripts[s.sessionId] = file;
    if (side.length > 0) {
      const sf = join(dir, s.sessionId, "subagents", "agent-a1b2c3d4e5f6a7b8c.jsonl");
      mkdirSync(dirname(sf), { recursive: true });
      writeFileSync(sf, side.map((l) => JSON.stringify(l)).join("\n") + "\n");
    }
  }
  return { configDir, roots, ledger: [...b.ledger], run: b.run, transcripts };
}

/** Rewrite every assistant text block of every transcript under a materialized config dir. */
export function rewriteAssistantText(files: readonly string[], to: string): number {
  let n = 0;
  for (const f of files) {
    const lines = readFileSync(f, "utf-8").split("\n").filter((l: string) => l.trim() !== "");
    const out = lines.map((l: string) => {
      const rec = JSON.parse(l);
      if (rec.type === "assistant" && Array.isArray(rec.message?.content)) {
        for (const blk of rec.message.content) {
          if (blk.type === "text") {
            blk.text = to;
            n++;
          }
        }
      }
      return JSON.stringify(rec);
    });
    writeFileSync(f, out.join("\n") + "\n");
  }
  return n;
}
