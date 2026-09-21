// STE-616 (M_2306b6) — tracker doubles no kinder than the real trackers.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Three measured properties of the real tools make a kind stub lie, and each
// is a rule here (FR § Requirement):
//
//   1. Filters. Every conjunct of every JQL string, and every filter parameter
//      of `list_issues`, is evaluated. A conjunct the grammar does not know
//      throws `UnsupportedQueryError` naming it — never ignored, never a
//      superset the real tracker would not return.
//   2. Text search is a superset. `summary ~ "\"<phrase>\""` is case-insensitive
//      phrase CONTAINMENT (dashes and whitespace folded, as the real tokenizer
//      folds them), and Linear `query` ranks a superset (any word of the query
//      in the title or description) — neither is ever an equality filter.
//   3. Listings page. Jira answers at most `maxResults` (capped at 100, default
//      50) rows with a `nextPageToken` while rows remain and ALWAYS carries
//      `isLast`; Linear pages `list_issues` at `limit` (default 50) with a
//      `cursor`, hides archived issues unless `includeArchived` is true, and
//      serves `list_milestones` newest-first in its real 50-row window. The page
//      size is settable per scenario (`pageSize`) so a scenario can force a
//      multi-page answer.
//
// Every answer has the MEASURED shape pinned under tests/fixtures/live-shapes/
// (bound by tests/m_2306b6-ste-617-live-shape-pins.test.ts):
//
//   - Linear pages are top-level `{ issues, hasNextPage, cursor? }` — there is
//     no `pageInfo`; a row carries exactly the requested `fields` plus `id`,
//     its key is `id` (`STE-12`, no `identifier`), and its `team` and
//     `project` are DISPLAY names (the `team` filter takes the key);
//   - `list_milestones` rows are `{ id, name, description, progress, sortOrder }`;
//   - a `save_issue` answer is the full measured issue record, keyed by `id`;
//   - Jira answers come in the two shapes the same server flips between,
//     chosen per double (`new JiraDouble(kindness, "wrapped")`): plain
//     `{ issues, isLast, nextPageToken? }` rows / `{ id, key, self }` creates,
//     or wrapped `{ context, issues: { nodes, pageInfo, … } }` for search, get
//     and create alike.
//
// Linear's input schemas are closed (`additionalProperties: false`): an unknown
// parameter throws naming it, judged against the parameter names recorded per
// tool in `adapters/_shared/data/tracker-tool-inventory.json`.
//
// Every call, read and write, is recorded, so a zero-write claim is a count.
// Either double can land a create and then answer it with a transport error
// (`failNextWrite`), which is how the network-error retry path is driven.
//
// `kindness` switches exist ONLY for the AC-STE-616.2 / .23 negative controls:
// a double that ignores its query, or that answers in one page, must make the
// self-tests go red. Scenarios never set them.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const INVENTORY_PATH = join(import.meta.dir, "..", "adapters", "_shared", "data", "tracker-tool-inventory.json");

export class UnsupportedQueryError extends Error {
  constructor(readonly conjunct: string, jql: string) {
    super(`UnsupportedQueryError: the Jira double does not understand the conjunct \`${conjunct}\` in: ${jql}`);
    this.name = "UnsupportedQueryError";
  }
}

export class UnknownParameterError extends Error {
  constructor(readonly tool: string, readonly parameter: string) {
    super(`UnknownParameterError: ${tool} has no input parameter \`${parameter}\` (its schema is closed, additionalProperties: false)`);
    this.name = "UnknownParameterError";
  }
}

export class TransportError extends Error {
  constructor(tool: string) {
    super(`MCP error -32001: Request timed out (${tool}) — the transport dropped the answer`);
    this.name = "TransportError";
  }
}

export interface Kindness {
  /** Negative control: evaluate no conjunct / filter at all. */
  ignoreQuery?: boolean;
  /** Negative control: answer everything in one page, always last. */
  onePage?: boolean;
  /** Negative control: text search as exact equality instead of a superset. */
  exactText?: boolean;
  /** Negative control: show archived Linear issues whatever `includeArchived` says. */
  showArchived?: boolean;
}

export interface DoubleCall {
  tool: string;
  input: Record<string, unknown>;
  kind: "read" | "write";
}

interface InventoryServer {
  tools: string[];
  parameters?: Record<string, string[]>;
  classification?: Record<string, { class: string; reason?: string }>;
}

export function readInventory(): { servers: Record<string, InventoryServer> } {
  return JSON.parse(readFileSync(INVENTORY_PATH, "utf-8"));
}

function recordedParameters(server: "atlassian" | "linear", tool: string): string[] {
  const params = readInventory().servers[server]?.parameters?.[tool];
  if (!Array.isArray(params) || params.length === 0) {
    throw new Error(
      `the tool inventory fixture records no parameter names for ${server}.${tool}; extend adapters/_shared/data/tracker-tool-inventory.json in place`,
    );
  }
  return params;
}

/** Fold what the real tokenizers fold: case, dash variants, whitespace runs (NBSP included). */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

// ===========================================================================
// Jira
// ===========================================================================

export interface JiraIssue {
  key: string;
  summary: string;
  labels: string[];
  issuetype: string;
  parent: string | null;
  project: string;
  status: { name: string; category: "new" | "indeterminate" | "done" };
  description: string;
  creator: string;
  assignee: string | null;
}

/** The two Jira answer shapes one server was measured flipping between. */
export type JiraShape = "plain" | "wrapped";
export const JIRA_SHAPES: readonly JiraShape[] = ["plain", "wrapped"];

const JIRA_EXPAND = "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations";

/** The measured `context` block of a wrapped answer (values are fixture stand-ins). */
const JIRA_CONTEXT = {
  atlassianAccountId: "<account-id>",
  cloudId: "fixture-cloud",
  clientName: "localhost",
  mcpClientName: "claude-code",
  toolName: "",
  endpoint: "v1:streamable-http",
  sessionId: "fixture-session",
  invocationId: "fixture-invocation",
  env: "prod",
  featureFlags: {},
};

const CATEGORY_NAME: Record<JiraIssue["status"]["category"], string> = {
  new: "To Do",
  indeterminate: "In Progress",
  done: "Done",
};

type JiraPredicate = (i: JiraIssue) => boolean;

/** Read a JQL string literal at `s[i] === '"'`; returns its unescaped value and the index past it. */
function readLiteral(s: string, i: number): { value: string; end: number } | null {
  if (s[i] !== '"') return null;
  let value = "";
  let j = i + 1;
  while (j < s.length) {
    const ch = s[j]!;
    if (ch === "\\") {
      if (j + 1 >= s.length) return null;
      value += s[j + 1];
      j += 2;
      continue;
    }
    if (ch === '"') return { value, end: j + 1 };
    value += ch;
    j += 1;
  }
  return null;
}

/** A bare value (`SHR`, `Epic`, `SHR-12`) or a quoted literal. */
function readValue(s: string, i: number): { value: string; end: number } | null {
  if (s[i] === '"') return readLiteral(s, i);
  const m = /^[A-Za-z0-9_\-.]+/.exec(s.slice(i));
  return m ? { value: m[0], end: i + m[0].length } : null;
}

export interface ParsedJql {
  predicates: JiraPredicate[];
  conjuncts: string[];
  orderBy: string | null;
}

/**
 * The grammar the front doors emit at the kickoff commit (AC-STE-616.2):
 * `project =`, `parent =`, `labels =`, `issuetype =` / `!=`,
 * `summary ~ "\"<phrase>\""`, `statusCategory =` / `!=`, `AND`, `ORDER BY`.
 * Anything else throws `UnsupportedQueryError` naming the conjunct.
 */
export function parseJql(jql: string, kindness: Kindness = {}): ParsedJql {
  let body = jql.trim();
  let orderBy: string | null = null;
  const ob = /\s+ORDER BY\s+([A-Za-z]+)(\s+(ASC|DESC))?\s*$/.exec(body);
  if (ob) {
    orderBy = `${ob[1]}${ob[3] ? ` ${ob[3]}` : ""}`;
    body = body.slice(0, ob.index);
  }
  const predicates: JiraPredicate[] = [];
  const conjuncts: string[] = [];
  let i = 0;
  for (;;) {
    const rest = body.slice(i);
    const start = i;
    let m: RegExpExecArray | null;
    let pred: JiraPredicate | null = null;
    if ((m = /^project = /.exec(rest))) {
      const v = readValue(body, i + m[0].length);
      if (v) {
        const want = v.value;
        pred = (x) => x.project === want;
        i = v.end;
      }
    } else if ((m = /^parent = /.exec(rest))) {
      const v = readValue(body, i + m[0].length);
      if (v) {
        const want = v.value.toUpperCase();
        pred = (x) => (x.parent ?? "").toUpperCase() === want;
        i = v.end;
      }
    } else if ((m = /^labels = /.exec(rest))) {
      const v = readValue(body, i + m[0].length);
      if (v) {
        const want = v.value;
        pred = (x) => x.labels.includes(want);
        i = v.end;
      }
    } else if ((m = /^issuetype (=|!=) /.exec(rest))) {
      const v = readValue(body, i + m[0].length);
      if (v) {
        const want = v.value.toLowerCase();
        const neg = m[1] === "!=";
        pred = (x) => (x.issuetype.toLowerCase() === want) !== neg;
        i = v.end;
      }
    } else if ((m = /^statusCategory (=|!=) /.exec(rest))) {
      const v = readValue(body, i + m[0].length);
      if (v) {
        const want = v.value.toLowerCase();
        const neg = m[1] === "!=";
        pred = (x) =>
          (CATEGORY_NAME[x.status.category].toLowerCase() === want || x.status.category === want) !== neg;
        i = v.end;
      }
    } else if ((m = /^summary ~ /.exec(rest))) {
      const v = readLiteral(body, i + m[0].length);
      if (v && v.value.startsWith('"') && v.value.endsWith('"') && v.value.length >= 2) {
        const phrase = v.value.slice(1, -1).replace(/\\(.)/gsu, "$1");
        const folded = foldText(phrase);
        pred = kindness.exactText
          ? (x) => x.summary === phrase
          : (x) => foldText(x.summary).includes(folded);
        i = v.end;
      }
    }
    if (pred === null) {
      const endAnd = body.indexOf(" AND ", start);
      throw new UnsupportedQueryError(body.slice(start, endAnd === -1 ? undefined : endAnd), jql);
    }
    predicates.push(pred);
    conjuncts.push(body.slice(start, i));
    if (i === body.length) break;
    if (body.startsWith(" AND ", i)) {
      i += 5;
      continue;
    }
    const endAnd = body.indexOf(" AND ", i);
    throw new UnsupportedQueryError(body.slice(start, endAnd === -1 ? undefined : endAnd), jql);
  }
  return { predicates: kindness.ignoreQuery ? [] : predicates, conjuncts, orderBy };
}

export class JiraDouble {
  readonly issues: JiraIssue[] = [];
  readonly calls: DoubleCall[] = [];
  readonly projects: Array<{ id: string; key: string; name: string }> = [];
  /** Per-scenario page size; the smaller of it and the requested `maxResults` wins. */
  pageSize: number | null = null;
  /** The next write lands, then answers with a transport error. */
  failNextWrite = false;
  private seq = new Map<string, number>();

  constructor(
    readonly kindness: Kindness = {},
    /** Which of the two measured Jira answer shapes this double speaks. */
    readonly shape: JiraShape = "plain",
  ) {}

  get writeCount(): number {
    return this.calls.filter((c) => c.kind === "write").length;
  }

  addProject(key: string): void {
    if (!this.projects.some((p) => p.key === key)) {
      this.projects.push({ id: String(10000 + this.projects.length + 1), key, name: `Project ${key}` });
    }
  }

  private nextKey(project: string): string {
    const n = (this.seq.get(project) ?? 0) + 1;
    this.seq.set(project, n);
    return `${project}-${n}`;
  }

  /** Seed an issue straight into the store — an old client, a human, or fixture history. No call is recorded. */
  seed(i: Partial<JiraIssue> & { summary: string; project: string }): JiraIssue {
    this.addProject(i.project);
    const issue: JiraIssue = {
      key: i.key ?? this.nextKey(i.project),
      labels: [],
      issuetype: "Task",
      parent: null,
      status: { name: "To Do", category: "new" },
      description: "",
      creator: "Fixture Human",
      assignee: null,
      ...i,
    };
    this.issues.push(issue);
    return issue;
  }

  find(key: string): JiraIssue | undefined {
    return this.issues.find((i) => i.key.toUpperCase() === key.toUpperCase());
  }

  private checkParams(tool: string, input: Record<string, unknown>): void {
    const known = recordedParameters("atlassian", tool);
    for (const k of Object.keys(input)) if (!known.includes(k)) throw new UnknownParameterError(tool, k);
  }

  private row(i: JiraIssue, fields: string[] | undefined): Record<string, unknown> {
    const all: Record<string, unknown> = {
      summary: i.summary,
      labels: [...i.labels],
      issuetype: { name: i.issuetype, hierarchyLevel: i.issuetype === "Epic" ? 1 : 0 },
      project: { key: i.project },
      status: { name: i.status.name, statusCategory: { key: i.status.category } },
      description: i.description,
      creator: { displayName: i.creator },
      assignee: i.assignee === null ? null : { accountId: i.assignee },
      parent: i.parent === null ? null : { key: i.parent },
    };
    const want = fields === undefined || fields.length === 0 ? Object.keys(all) : fields;
    const out: Record<string, unknown> = {};
    for (const f of want) if (f in all) out[f] = all[f];
    const id = String(10000 + this.issues.indexOf(i));
    const row: Record<string, unknown> = { expand: JIRA_EXPAND, id, self: `https://fixture.invalid/rest/api/3/issue/${id}`, key: i.key, fields: out };
    // A wrapped node carries its browse URL as well (measured).
    return this.shape === "wrapped" ? { ...row, webUrl: `https://fixture.invalid/browse/${i.key}` } : row;
  }

  /** The wrapped envelope (`context` + `issues`) the measured wrapped answers carry. */
  private wrap(toolName: string, issues: Record<string, unknown>): Record<string, unknown> {
    return { issues, context: { ...JIRA_CONTEXT, toolName } };
  }

  /** `searchJiraIssuesUsingJql`, in this double's shape. */
  search(input: Record<string, unknown>): Record<string, any> {
    this.checkParams("searchJiraIssuesUsingJql", input);
    this.calls.push({ tool: "searchJiraIssuesUsingJql", input, kind: "read" });
    const jql = String(input.jql ?? "");
    const q = parseJql(jql, this.kindness);
    let hits = this.issues.filter((i) => q.predicates.every((p) => p(i)));
    // The store is in creation order; `ORDER BY created DESC` reverses it.
    if (q.orderBy === "created DESC") hits = [...hits].reverse();
    const requested = typeof input.maxResults === "number" ? input.maxResults : 50;
    const size = Math.max(1, Math.min(requested, 100, this.pageSize ?? Infinity));
    let offset = 0;
    if (typeof input.nextPageToken === "string") {
      const m = /^page:(\d+):(.*)$/s.exec(input.nextPageToken);
      if (!m || m[2] !== jql) throw new Error(`Jira double 400: nextPageToken ${input.nextPageToken} does not belong to this query`);
      offset = Number(m[1]);
    }
    fieldsCheck(input.fields);
    const fields = Array.isArray(input.fields) ? (input.fields as string[]) : undefined;
    const page = this.kindness.onePage ? hits : hits.slice(offset, offset + size);
    const more = !this.kindness.onePage && offset + size < hits.length;
    const token = more ? `page:${offset + size}:${jql}` : null;
    const rows = page.map((i) => this.row(i, fields));
    if (this.shape === "wrapped") {
      return this.wrap("searchJiraIssuesUsingJql", {
        nodes: rows,
        ...(more ? { remainingCount: hits.length - offset - size } : {}),
        webUrl: `https://fixture.invalid/issues?jql=${encodeURIComponent(jql)}`,
        pageInfo: { hasNextPage: more, endCursor: token },
      });
    }
    return { issues: rows, isLast: !more, ...(token === null ? {} : { nextPageToken: token }) };
  }

  /**
   * The paging of one page THIS double emitted: whether it is the last, and
   * the token for the next. Test-side only — the double knows its own shape;
   * the toolkit reads pages through tracker_answer.ts.
   */
  pageMeta(page: Record<string, any>): { last: boolean; next: string | null; items: Record<string, unknown>[] } {
    if (this.shape === "wrapped") {
      return { last: !page.issues.pageInfo.hasNextPage, next: page.issues.pageInfo.endCursor, items: page.issues.nodes };
    }
    return { last: page.isLast === true, next: page.nextPageToken ?? null, items: page.issues };
  }

  /** An empty, complete search page in this double's shape. */
  emptyPage(): Record<string, unknown> {
    return this.shape === "wrapped"
      ? this.wrap("searchJiraIssuesUsingJql", { nodes: [], webUrl: "https://fixture.invalid/issues", pageInfo: { hasNextPage: false, endCursor: null } })
      : { issues: [], isLast: true };
  }

  /** Every page of one query, following the next-page token until the last. */
  searchAll(jql: string, fields: string[], maxResults = 100): Array<Record<string, any>> {
    const pages: Array<Record<string, any>> = [];
    let token: string | null = null;
    for (let n = 0; n < 1000; n++) {
      const page = this.search({ cloudId: "fixture-cloud", jql, fields, maxResults, ...(token ? { nextPageToken: token } : {}) });
      // The session's saving step, as the docs order it: each page after the
      // first carries the cursor it was fetched with, so the readers can prove
      // the pages form one chain (tracker_answer.readTrackerListing).
      pages.push(token ? { ...page, requestCursor: token } : page);
      const meta = this.pageMeta(page);
      if (meta.last) return pages;
      token = meta.next;
    }
    throw new Error("Jira double: runaway paging");
  }

  /** `getJiraIssue` — the raw answer the ownership decision reads, in this double's shape. */
  get(input: Record<string, unknown>): Record<string, unknown> {
    this.checkParams("getJiraIssue", input);
    this.calls.push({ tool: "getJiraIssue", input, kind: "read" });
    const i = this.find(String(input.issueIdOrKey ?? ""));
    if (!i) throw new Error(`Jira double 404: issue ${String(input.issueIdOrKey)} does not exist`);
    const row = this.row(i, undefined);
    return this.shape === "wrapped" ? this.wrap("getJiraIssue", { nodes: [row] }) : row;
  }

  /** Apply one gated write (bare tool name). Returns the tool's answer. */
  apply(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    if (tool === "createJiraIssue" || tool === "editJiraIssue" || tool === "transitionJiraIssue") {
      this.checkParams(tool, input);
    }
    this.calls.push({ tool, input, kind: "write" });
    const result = this.perform(tool, input);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new TransportError(tool);
    }
    return result;
  }

  private perform(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    const extra = (input.additional_fields ?? {}) as Record<string, unknown>;
    if (tool === "createJiraIssue") {
      const project = String(input.projectKey ?? "");
      const parentRaw = input.parent ?? extra.parent;
      const parent =
        typeof parentRaw === "string" ? parentRaw : parentRaw && typeof parentRaw === "object" ? String((parentRaw as { key?: unknown }).key ?? "") || null : null;
      const labels = Array.isArray(input.labels) ? input.labels : Array.isArray(extra.labels) ? extra.labels : [];
      const issue = this.seed({
        project,
        summary: String(input.summary ?? ""),
        issuetype: String(input.issueTypeName ?? "Task"),
        labels: (labels as unknown[]).map(String),
        parent,
        description: typeof input.description === "string" ? input.description : "",
        creator: "Toolkit Session",
      });
      const id = String(10000 + this.issues.indexOf(issue));
      return this.shape === "wrapped"
        ? this.wrap("createJiraIssue", { nodes: [this.row(issue, ["summary", "issuetype", "project", "description", "assignee", "status"])] })
        : { id, key: issue.key, self: `https://fixture.invalid/rest/api/3/issue/${id}` };
    }
    const key = String(input.issueIdOrKey ?? "");
    const issue = this.find(key);
    if (!issue) throw new Error(`Jira double 404: issue ${key} does not exist`);
    if (tool === "editJiraIssue") {
      const f = (input.fields ?? {}) as Record<string, unknown>;
      if (Array.isArray(f.labels)) issue.labels = f.labels.map(String);
      if (typeof f.summary === "string") issue.summary = f.summary;
      if (f.assignee && typeof f.assignee === "object") issue.assignee = String((f.assignee as { accountId?: unknown }).accountId ?? "");
      return { key: issue.key };
    }
    if (tool === "transitionJiraIssue") {
      issue.status = { name: "In Progress", category: "indeterminate" };
      return { key: issue.key, transitioned: true };
    }
    return { key: issue.key, ok: true };
  }
}

function fieldsCheck(fields: unknown): void {
  if (fields !== undefined && !(Array.isArray(fields) && fields.every((f) => typeof f === "string"))) {
    throw new Error("Jira double 400: fields must be an array of strings");
  }
}

// ===========================================================================
// Linear
// ===========================================================================

export interface LinearIssue {
  uuid: string;
  /** The store's `STE-12` key; every answer carries it as top-level `id`. */
  identifier: string;
  title: string;
  description: string;
  labels: string[];
  project: string;
  /** The team KEY the `team` filter takes; answers carry `LinearDouble.teamName(team)`. */
  team: string;
  projectMilestone: { id: string; name: string } | null;
  archivedAt: string | null;
  createdBy: string;
  state: string;
  assignee: string | null;
}

export interface LinearMilestone {
  id: string;
  name: string;
  project: string;
  createdAt: number;
}

const LINEAR_FIELD_ENUM = new Set([
  "id", "uuid", "title", "description", "projectMilestone", "priority", "estimate", "url", "gitBranchName",
  "createdAt", "updatedAt", "archivedAt", "completedAt", "startedAt", "canceledAt", "dueDate", "slaStartedAt",
  "slaMediumRiskAt", "slaHighRiskAt", "slaBreachesAt", "slaType", "status", "statusType", "labels", "triageIntel",
  "createdBy", "createdById", "assignee", "assigneeId", "delegate", "delegateId", "project", "projectId", "parentId",
  "team", "teamId", "cycleId",
]);

/** The default `list_issues` row, without `fields`: the measured row's keys. */
const LINEAR_DEFAULT_ROW = ["title", "labels", "description", "createdBy", "project", "team", "projectMilestone", "status"];

const FIXTURE_TIME = "2026-09-21T00:00:00.000Z";

/** The real 50-row window of `list_milestones` (out of scope follow-up, reproduced faithfully). */
export const LINEAR_MILESTONE_WINDOW = 50;

export class LinearDouble {
  readonly issues: LinearIssue[] = [];
  readonly milestones: LinearMilestone[] = [];
  readonly calls: DoubleCall[] = [];
  readonly projects: Array<{ id: string; name: string }> = [];
  pageSize: number | null = null;
  failNextWrite = false;
  private seq = 0;
  private clock = 0;

  constructor(readonly kindness: Kindness = {}) {}

  get writeCount(): number {
    return this.calls.filter((c) => c.kind === "write").length;
  }

  addProject(name: string): void {
    if (!this.projects.some((p) => p.name === name)) {
      this.projects.push({ id: `0000000${this.projects.length + 1}-0000-4000-8000-00000000000${this.projects.length + 1}`, name });
    }
  }

  private checkParams(tool: string, input: Record<string, unknown>): void {
    const known = recordedParameters("linear", tool);
    for (const k of Object.keys(input)) if (!known.includes(k)) throw new UnknownParameterError(tool, k);
  }

  seed(i: Partial<LinearIssue> & { title: string; project: string; team?: string }): LinearIssue {
    this.addProject(i.project);
    this.seq += 1;
    const issue: LinearIssue = {
      uuid: `${String(this.seq).padStart(8, "0")}-1111-4111-8111-${String(this.seq).padStart(12, "0")}`,
      identifier: `${i.team ?? "STE"}-${this.seq}`,
      description: "",
      labels: [],
      team: "STE",
      projectMilestone: null,
      archivedAt: null,
      createdBy: "Fixture Human",
      state: "Todo",
      assignee: null,
      ...i,
    };
    this.issues.push(issue);
    return issue;
  }

  seedMilestone(project: string, name: string, id?: string): LinearMilestone {
    this.addProject(project);
    this.clock += 1;
    const n = this.milestones.length + 1;
    const ms: LinearMilestone = {
      id: id ?? `${(0xa00000 + n * 17).toString(16)}00-2222-4222-8222-${String(n).padStart(12, "0")}`,
      name,
      project,
      createdAt: this.clock,
    };
    this.milestones.push(ms);
    return ms;
  }

  find(key: string): LinearIssue | undefined {
    return this.issues.find((i) => i.identifier.toUpperCase() === key.toUpperCase() || i.uuid === key);
  }

  /** The team's display name, as every measured answer carries `team` (the filter takes the key). */
  static teamName(key: string): string {
    return key === "STE" ? "Example Team Display Name" : `${key} Team Display Name`;
  }

  /** The full measured issue record (the `save_issue` answer's key set), keyed by `id`. */
  private record(i: LinearIssue): Record<string, unknown> {
    const project = this.projects.find((p) => p.name === i.project);
    const state = i.state === "Done" ? "completed" : i.state === "In Progress" ? "started" : "unstarted";
    return {
      id: i.identifier,
      uuid: i.uuid,
      title: i.title,
      description: i.description,
      projectMilestone: i.projectMilestone,
      priority: { value: 0, name: "No priority" },
      url: `https://linear.app/fixture/issue/${i.identifier}`,
      gitBranchName: `fixture/${i.identifier.toLowerCase()}`,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
      archivedAt: i.archivedAt,
      completedAt: null,
      startedAt: null,
      canceledAt: null,
      dueDate: null,
      slaStartedAt: null,
      slaMediumRiskAt: null,
      slaHighRiskAt: null,
      slaBreachesAt: null,
      status: i.state,
      statusType: state,
      labels: [...i.labels],
      attachments: [],
      documents: [],
      createdBy: i.createdBy,
      createdById: "00000000-0000-4000-8000-0000000000c1",
      assignee: i.assignee,
      assigneeId: i.assignee === null ? null : "00000000-0000-4000-8000-0000000000a1",
      project: i.project,
      projectId: project?.id ?? null,
      team: LinearDouble.teamName(i.team),
      teamId: `00000000-0000-4000-8000-${i.team.padStart(12, "0").slice(-12)}`,
    };
  }

  /** One `list_issues` row: exactly the requested `fields` plus `id` (measured); the default row without `fields`. */
  private row(i: LinearIssue, fields: string[] | undefined): Record<string, unknown> {
    const all = this.record(i);
    const want = fields === undefined || fields.length === 0 ? LINEAR_DEFAULT_ROW : fields;
    const out: Record<string, unknown> = { id: all.id };
    for (const f of want) if (f in all) out[f] = all[f];
    return out;
  }

  /** `list_issues`: every filter applied, `query` a ranked superset, paged at `limit` with a top-level cursor. */
  listIssues(input: Record<string, unknown>): { issues: unknown[]; hasNextPage: boolean; cursor?: string } {
    this.checkParams("list_issues", input);
    this.calls.push({ tool: "list_issues", input, kind: "read" });
    if (Array.isArray(input.fields)) {
      for (const f of input.fields) if (!LINEAR_FIELD_ENUM.has(String(f))) throw new Error(`list_issues: fields value \`${String(f)}\` is not in the schema enum`);
    }
    const q = this.kindness.ignoreQuery ? {} : input;
    let hits = this.issues.filter((i) => {
      if (!this.kindness.showArchived && i.archivedAt !== null && input.includeArchived !== true) return false;
      if (typeof q.team === "string" && i.team !== q.team) return false;
      if (typeof q.project === "string" && i.project !== q.project) return false;
      if (typeof q.label === "string" && !i.labels.includes(q.label)) return false;
      if (typeof q.state === "string" && i.state !== q.state) return false;
      if (typeof q.parentId === "string") return false;
      return true;
    });
    if (typeof q.query === "string" && q.query.trim() !== "") {
      const words = foldText(q.query).split(" ").filter((w) => w.length > 0);
      const score = (i: LinearIssue) => {
        const hay = foldText(`${i.title} ${i.description}`);
        return words.filter((w) => hay.includes(w)).length;
      };
      if (this.kindness.exactText) hits = hits.filter((i) => i.title === q.query);
      else hits = hits.filter((i) => score(i) > 0).sort((x, y) => score(y) - score(x));
    }
    const requested = typeof input.limit === "number" ? input.limit : 50;
    const size = Math.max(1, Math.min(requested, 250, this.pageSize ?? Infinity));
    let offset = 0;
    if (typeof input.cursor === "string") {
      const m = /^cursor:(\d+)$/.exec(input.cursor);
      if (!m) throw new Error(`list_issues: unknown cursor ${input.cursor}`);
      offset = Number(m[1]);
    }
    const fields = Array.isArray(input.fields) ? (input.fields as string[]) : undefined;
    if (this.kindness.onePage) {
      return { issues: hits.map((i) => this.row(i, fields)), hasNextPage: false };
    }
    const page = hits.slice(offset, offset + size);
    const more = offset + size < hits.length;
    return { issues: page.map((i) => this.row(i, fields)), hasNextPage: more, ...(more ? { cursor: `cursor:${offset + size}` } : {}) };
  }

  /** An empty, complete `list_issues` page. */
  emptyPage(): Record<string, unknown> {
    return { issues: [], hasNextPage: false };
  }

  /** Every page of one `list_issues` call, following the cursor. */
  listAll(input: Record<string, unknown>): Array<Record<string, unknown>> {
    const pages: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    for (let n = 0; n < 1000; n++) {
      const page = this.listIssues({ ...input, ...(cursor ? { cursor } : {}) });
      // Each page after the first is saved with the cursor it was fetched with.
      pages.push(cursor ? { ...page, requestCursor: cursor } : page);
      if (!page.hasNextPage) return pages;
      cursor = page.cursor ?? null;
    }
    throw new Error("Linear double: runaway paging");
  }

  /** `list_milestones`: newest first, at most the real 50-row window. */
  listMilestones(input: Record<string, unknown>): { milestones: Array<Record<string, unknown>> } {
    this.checkParams("list_milestones", input);
    this.calls.push({ tool: "list_milestones", input, kind: "read" });
    const rows = this.milestones
      .filter((m) => m.project === input.project)
      .sort((x, y) => y.createdAt - x.createdAt)
      .slice(0, LINEAR_MILESTONE_WINDOW);
    return { milestones: rows.map((m) => this.milestoneRow(m)) };
  }

  /** A `list_milestones` row (measured): `{ id, name, description, progress, sortOrder }`. */
  private milestoneRow(m: LinearMilestone): Record<string, unknown> {
    return { id: m.id, name: m.name, description: "", progress: 0, sortOrder: m.createdAt * 1000 };
  }

  /** `get_issue` — the raw answer the ownership decision reads. */
  get(input: Record<string, unknown>): Record<string, unknown> {
    this.checkParams("get_issue", input);
    this.calls.push({ tool: "get_issue", input, kind: "read" });
    const i = this.find(String(input.id ?? ""));
    if (!i) throw new Error(`get_issue: ${String(input.id)} not found`);
    return this.record(i);
  }

  apply(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    if (tool === "save_issue" || tool === "save_milestone") this.checkParams(tool, input);
    this.calls.push({ tool, input, kind: "write" });
    const result = this.perform(tool, input);
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new TransportError(tool);
    }
    return result;
  }

  private perform(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    if (tool === "save_milestone") {
      // The measured create answer: `{ id, name, progress, sortOrder }`.
      const found = typeof input.id === "string" ? this.milestones.find((m) => m.id === input.id) : undefined;
      if (typeof input.id === "string" && found === undefined) return { id: input.id };
      const ms = found ?? this.seedMilestone(String(input.project ?? ""), String(input.name ?? ""));
      return { id: ms.id, name: ms.name, progress: 0, sortOrder: ms.createdAt * 1000 };
    }
    if (tool === "save_issue") {
      if (typeof input.id !== "string") {
        const msRef = typeof input.milestone === "string" ? input.milestone : null;
        const ms = msRef === null ? null : this.milestones.find((m) => m.id === msRef || m.name === msRef) ?? { id: msRef, name: msRef };
        const issue = this.seed({
          title: String(input.title ?? ""),
          project: String(input.project ?? ""),
          team: String(input.team ?? "STE"),
          labels: Array.isArray(input.labels) ? input.labels.map(String) : [],
          projectMilestone: ms === null ? null : { id: ms.id, name: ms.name },
          description: typeof input.description === "string" ? input.description : "",
          createdBy: "Toolkit Session",
        });
        return this.record(issue);
      }
      const issue = this.find(input.id);
      if (!issue) throw new Error(`save_issue: ${input.id} not found`);
      if (Array.isArray(input.labels)) issue.labels = input.labels.map(String);
      if (typeof input.state === "string") issue.state = input.state;
      if (typeof input.assignee === "string") issue.assignee = input.assignee;
      // An update answers the same record as a create (measured).
      return this.record(issue);
    }
    return { ok: true };
  }
}

export type TrackerDouble = JiraDouble | LinearDouble;
