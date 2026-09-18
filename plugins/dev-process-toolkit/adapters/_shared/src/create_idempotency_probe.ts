// create_idempotency_probe (STE-579, M_840a06) — the pre-create "was this
// ticket already made?" join, as a decision the CLIENT makes.
//
// The tracker query NARROWS THE PAGE; it never answers the identity question.
// Measured live against cloudId 96bffaef-cf5d-4dbf-a170-3d700df9bc83:
//
//   project = GF AND summary = "The reward banner, repainted light"
//       -> {"issues": [], "isLast": true}   accepted, and ALWAYS empty
//   project = GF AND summary ~ "\"The reward banner, repainted light\""
//       -> GF-83, exactly one
//
// So `buildIdempotencyJql` emits the phrase-escaped `~` form, and the join
// itself happens here, over the returned page, by normalized compare.
//
// THE REFUSAL THIS MODULE EXISTS FOR. On a tracker project SHARED between
// sibling repositories, a page can carry a candidate whose title matches and
// whose `repo_tag` belongs to a DIFFERENT repository. That candidate is not
// this repo's ticket:
//
//   - returning it mis-binds the FR onto someone else's issue, and every
//     later write — status, AC checkboxes, milestone attachment — lands there;
//   - creating beside it duplicates onto a board with no delete tool.
//
// The query carries the tag as a conjunct, so a tracker that honours it never
// returns such a row. A row that fails ANY conjunct means the search run was
// not the one `query` printed (STE-604): the run STOPS — no reuse, no create,
// `tracker_idempotency_uncertain` with reason `page-violates-query` — and the
// operator decides.
//
// The create call count is the assertion that matters, not the returned
// outcome: an implementation that mints a stray and then declines to return it
// satisfies an outcome-only check and still leaves a duplicate on the board.
// `deps.create` is therefore never invoked on the refusal branch — not invoked
// and discarded, not invoked.
//
// OPT-IN. With no `repo_tag` declared, every leg behaves exactly as it did
// before this FR apart from the query operator: a title match is reused
// whatever labels it carries. An absent tag and an empty one are the same
// thing, so a project that never sets the key never starts refusing runs that
// worked yesterday.

// ---------------------------------------------------------------- the compare

/**
 * The five drift triggers a title picks up between the spec file that authored
 * it and the tracker that stored it. Each is normalized AWAY before comparing;
 * none of them collapses a genuine retitle onto its neighbour.
 */
export const DRIFT_RULES = [
  "en-dash",
  "double-space",
  "trailing-space",
  "nbsp",
  "heading-anchor",
] as const;

export type DriftRule = (typeof DRIFT_RULES)[number];

/**
 * Normalize `title` for comparison. `rules` defaults to every rule; passing a
 * subset is how the suite proves each rule is INDEPENDENTLY responsible for
 * its own drift class (its own rule alone is sufficient, and no sibling's rule
 * absorbs it).
 *
 * Comparison-only: the returned string is never written to a tracker.
 */
export function normalizeTitleForCompare(
  title: string,
  rules: readonly DriftRule[] = DRIFT_RULES,
): string {
  const on = new Set(rules);
  let out = title;
  // Applied widest-first: an anchor suffix is structure, the rest are glyphs.
  if (on.has("heading-anchor")) out = out.replace(/\s*\{#[^}]*\}\s*$/u, "");
  if (on.has("en-dash")) out = out.replace(/[–—]/gu, "-");
  if (on.has("nbsp")) out = out.replace(/ /gu, " ");
  // ASCII space runs only — an NBSP is `\s` in JS, and folding it here would
  // let the double-space rule silently absorb the nbsp rule's drift class.
  if (on.has("double-space")) out = out.replace(/ {2,}/gu, " ");
  if (on.has("trailing-space")) out = out.replace(/^[ \t]+|[ \t]+$/gu, "");
  return out;
}

// -------------------------------------------------------------- the refusals

/** The capability key a stopped idempotency probe surfaces. */
export const TRACKER_IDEMPOTENCY_UNCERTAIN = "tracker_idempotency_uncertain" as const;

/**
 * "Does this label set carry the repo tag?" — the ONE definition of tag
 * membership. Both sides of the FR ask it: the pre-flight guard asks it of the
 * labels the CREATE call forwards, and the join asks it of a candidate the
 * page returned. They must never drift apart — a guard that accepts a tag the
 * join then rejects (or the reverse) reopens exactly the always-miss this
 * module exists to close — so they read the same predicate, not two copies of
 * it.
 */
function carriesTag(labels: readonly string[], tag: string): boolean {
  return labels.includes(tag);
}

/**
 * A declared `repo_tag` that is not forwarded onto created issues produces a
 * label conjunct that ALWAYS misses — so every later probe reads "no prior
 * run" and every run creates again. NFR-10 canonical shape: a first line that
 * states the mismatch, then `Remedy:`, then `Context:`, naming both halves.
 */
export class RepoTagBindingError extends Error {
  readonly repoTag: string;
  readonly defaultLabels: readonly string[];

  constructor(repoTag: string, defaultLabels: readonly string[]) {
    const rendered = defaultLabels.length
      ? defaultLabels.map((l) => `"${l}"`).join(", ")
      : "(none)";
    super(
      `RepoTagBindingError: repo_tag "${repoTag}" is declared but is not forwarded in the default labels [${rendered}] — the idempotency probe would narrow by a label no created issue carries, so every probe reads "no prior run" and every run creates a duplicate.\n` +
        `Remedy: add "${repoTag}" to the adapter sub-section's \`default_labels\` (the same list the create call forwards), or remove the \`repo_tag\` declaration. Do not narrow by a tag the writer does not write — the two must be the same string.\n` +
        `Context: repo_tag="${repoTag}", default_labels=[${rendered}], helper=assertRepoTagForwarded`,
    );
    this.name = "RepoTagBindingError";
    this.repoTag = repoTag;
    this.defaultLabels = [...defaultLabels];
  }
}

/**
 * Refuse a declared-but-unforwarded `repo_tag`. Vacuous when no tag is
 * declared: an absent tag and an empty one are the same thing, and neither
 * places any requirement on the label set.
 */
export function assertRepoTagForwarded(
  repoTag: string | undefined,
  defaultLabels: readonly string[] | undefined,
): void {
  if (!repoTag) return;
  const labels = defaultLabels ?? [];
  if (carriesTag(labels, repoTag)) return;
  throw new RepoTagBindingError(repoTag, labels);
}

// -------------------------------------------------------------- the JQL shape

export interface IdempotencyCandidate {
  id: string;
  title: string;
  labels: readonly string[];
  /** STE-604 — the fields a query-honouring page carries; graded when present. */
  project?: string;
  parent?: string | null;
  issuetype?: string;
}

export interface IdempotencySearchResult {
  candidates: readonly IdempotencyCandidate[];
  /** true when the last page still reports more results (Jira `isLast: false`, Linear `hasNextPage: true`). */
  capped: boolean;
}

export interface IdempotencySearchParams {
  projectKey: string;
  title: string;
  parentKey?: string;
  milestoneLabel?: string;
  repoTag?: string;
}

/**
 * Escape a string for the inside of a JQL double-quoted literal: `\` first,
 * then `"`, so an escape the second pass adds is never re-escaped.
 */
function escapeJqlLiteral(s: string): string {
  return s.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/**
 * The narrowing query. `summary ~ "\"<title>\""` — the escaped inner quotes are
 * the phrase-match form; without them `~` widens to any word. `=` is never
 * emitted: Jira ACCEPTS it and answers zero rows for a summary the issue
 * provably carries.
 */
export function buildIdempotencyJql(
  params: IdempotencySearchParams,
  opts: { excludeEpics?: boolean } = {},
): string {
  // Unquoted operands must be bare Jira keys, and quoted ones are escaped: a
  // value that could close its literal would append clauses and WIDEN the one
  // query whose job is to narrow.
  if (!/^[A-Z][A-Z0-9_]*$/.test(params.projectKey)) {
    throw new Error(`buildIdempotencyJql: project key "${params.projectKey}" is not a Jira project key`);
  }
  if (params.parentKey && !/^[A-Z][A-Z0-9_]*-\d+$/.test(params.parentKey)) {
    throw new Error(`buildIdempotencyJql: parent "${params.parentKey}" is not a Jira issue key`);
  }
  const clauses = [`project = ${params.projectKey}`];
  // Conjunct order follows § Jira's stated order: project, then the CONTAINER
  // in either of its two forms — an Epic `parent`, or the grandfathered
  // numeric milestone label — then the repo tag, then the summary phrase.
  // Both container forms therefore sit together, ahead of the tag; the tag is
  // not a container and must not be interleaved between them.
  if (params.parentKey) clauses.push(`parent = ${params.parentKey}`);
  if (params.milestoneLabel) clauses.push(`labels = "${escapeJqlLiteral(params.milestoneLabel)}"`);
  // An Epic is a container, never the ticket being created (STE-604).
  if (opts.excludeEpics) clauses.push("issuetype != Epic");
  if (params.repoTag) clauses.push(`labels = "${escapeJqlLiteral(params.repoTag)}"`);
  // Two escaping levels: the phrase inside the literal, then the literal. For
  // a title with no `"` or `\` this is the measured `summary ~ "\"<t>\""`.
  clauses.push(`summary ~ "${escapeJqlLiteral(`"${escapeJqlLiteral(params.title)}"`)}"`);
  return clauses.join(" AND ");
}

// ------------------------------------------------------------------ the probe

export interface IdempotencyDeps {
  search(params: IdempotencySearchParams): Promise<IdempotencySearchResult>;
  create(params: { projectKey: string; title: string }): Promise<{ id: string }>;
}

/** Which probe round this is: the fast path, or one of the three retries. */
export type IdempotencyAttempt = "fast" | "retry-1" | "retry-2" | "retry-3";
export const IDEMPOTENCY_ATTEMPTS: readonly IdempotencyAttempt[] = [
  "fast",
  "retry-1",
  "retry-2",
  "retry-3",
];

export type IdempotencyRefusalReason =
  | "page-violates-query"
  | "page-unreadable"
  | "page-cap"
  | "retry-miss-shared";

export type IdempotencyOutcome =
  | { kind: "reused"; id: string; capability: null }
  | {
      kind: "created";
      id: string;
      /** Set on the undeclared retry-3 fall-through: created, but not proven absent. */
      capability: null | typeof TRACKER_IDEMPOTENCY_UNCERTAIN;
    }
  | { kind: "miss"; id: null; capability: null }
  | {
      kind: "refused";
      id: null;
      capability: typeof TRACKER_IDEMPOTENCY_UNCERTAIN;
      reason: IdempotencyRefusalReason;
    };

export interface RunCreateIdempotencyProbeParams extends IdempotencySearchParams {
  /** The labels the CREATE call forwards — the set `repo_tag` must live in. */
  defaultLabels?: readonly string[];
  /** STE-604 — the probe round; absent reads as the fast path. */
  attempt?: IdempotencyAttempt;
}

// --------------------------------------------------------------- the decision

/**
 * One row of a saved search page, normalized across trackers. A field left
 * `undefined` was not carried by the page and is not checked; the command
 * layer refuses a page missing a field a conjunct needs BEFORE it gets here.
 */
export interface DecisionCandidate {
  key: string;
  title: string;
  labels?: readonly string[];
  project?: string;
  /** Jira Epic parent key; `null` = the row has no parent. */
  parent?: string | null;
  issuetype?: string;
  /** Linear project-milestone id; `null` = the row sits in no milestone. */
  milestone?: string | null;
  team?: string;
}

/** The conjuncts the query carried, plus the title being created. */
export interface DecisionQuery {
  projectKey: string;
  title: string;
  parentKey?: string;
  milestoneLabel?: string;
  /** Linear: checked client-side — `list_issues` has no milestone input. */
  linearMilestone?: string;
  team?: string;
  repoTag?: string;
}

export type CreateDecision =
  | { outcome: "reused"; key: string }
  | { outcome: "create"; reason?: "proven-absent"; capability?: typeof TRACKER_IDEMPOTENCY_UNCERTAIN }
  | { outcome: "miss" }
  | {
      outcome: "refused";
      reason: IdempotencyRefusalReason;
      capability: typeof TRACKER_IDEMPOTENCY_UNCERTAIN;
    };

function refusal(reason: IdempotencyRefusalReason): CreateDecision {
  return { outcome: "refused", reason, capability: TRACKER_IDEMPOTENCY_UNCERTAIN };
}

/** Does `c` fail a conjunct the query carried? Only carried fields are graded. */
function violatesQuery(c: DecisionCandidate, q: DecisionQuery): boolean {
  if (c.project !== undefined && c.project !== q.projectKey) return true;
  if (q.team !== undefined && c.team !== undefined && c.team !== q.team) return true;
  if (q.parentKey !== undefined && c.parent !== undefined && c.parent !== q.parentKey) return true;
  // An Epic is a container, never the ticket being created.
  if (c.issuetype !== undefined && c.issuetype === "Epic") return true;
  if (c.labels !== undefined) {
    if (q.milestoneLabel && !carriesTag(c.labels, q.milestoneLabel)) return true;
    if (q.repoTag && !carriesTag(c.labels, q.repoTag)) return true;
  }
  return false;
}

/**
 * STE-604 — the ONE create decision, shared by the `decide` command and
 * `runCreateIdempotencyProbe`. The page is graded against the query that
 * should have produced it before any title is compared: a row that fails a
 * conjunct means the search was not the one `query` printed, and nothing on
 * such a page can be trusted either as a match or as an absence.
 */
export function decideCreate(
  query: DecisionQuery,
  page: { candidates: readonly DecisionCandidate[]; capped: boolean },
  attempt: IdempotencyAttempt = "fast",
): CreateDecision {
  if (page.candidates.some((c) => violatesQuery(c, query))) {
    return refusal("page-violates-query");
  }

  const wanted = normalizeTitleForCompare(query.title);
  const match = page.candidates.find(
    (c) =>
      normalizeTitleForCompare(c.title) === wanted &&
      (query.linearMilestone === undefined || c.milestone === query.linearMilestone),
  );
  if (match) return { outcome: "reused", key: match.key };

  // No match. A page that reached the cap has not PROVEN the ticket absent.
  if (page.capped) return refusal("page-cap");

  if (attempt === "fast") {
    return page.candidates.length === 0
      ? { outcome: "create", reason: "proven-absent" }
      : { outcome: "create" };
  }
  if (attempt !== "retry-3") return { outcome: "miss" };
  // The last retry missed a create that may have landed: refuse when shared,
  // create with the warning when undeclared.
  return query.repoTag
    ? refusal("retry-miss-shared")
    : { outcome: "create", capability: TRACKER_IDEMPOTENCY_UNCERTAIN };
}

// ------------------------------------------------------------------ the probe

/**
 * Narrow, join, then decide. Exactly one of: reuse an existing ticket, create
 * a fresh one, report a miss for the next retry, or stop.
 *
 * `deps.create` is reached from ONE place, on a `create` decision only, so the
 * call count on every other branch is zero by construction rather than by a
 * discarded result.
 */
export async function runCreateIdempotencyProbe(
  params: RunCreateIdempotencyProbeParams,
  deps: IdempotencyDeps,
): Promise<IdempotencyOutcome> {
  // Before any tracker traffic: a tag the create call will not write is a
  // narrowing conjunct that can only ever miss.
  assertRepoTagForwarded(params.repoTag, params.defaultLabels);

  // Absent and empty are the same declaration, so they must produce the same
  // search params byte for byte — hence the key is omitted, never sent empty.
  const searchParams: IdempotencySearchParams = {
    projectKey: params.projectKey,
    title: params.title,
    ...(params.parentKey === undefined ? {} : { parentKey: params.parentKey }),
    ...(params.milestoneLabel === undefined ? {} : { milestoneLabel: params.milestoneLabel }),
    ...(params.repoTag ? { repoTag: params.repoTag } : {}),
  };
  const page = await deps.search(searchParams);

  const decision = decideCreate(
    searchParams,
    {
      candidates: page.candidates.map((c) => ({ ...c, key: c.id })),
      capped: page.capped,
    },
    params.attempt ?? "fast",
  );

  switch (decision.outcome) {
    case "reused":
      return { kind: "reused", id: decision.key, capability: null };
    case "miss":
      return { kind: "miss", id: null, capability: null };
    case "refused":
      return {
        kind: "refused",
        id: null,
        capability: TRACKER_IDEMPOTENCY_UNCERTAIN,
        reason: decision.reason,
      };
    case "create": {
      const created = await deps.create({ projectKey: params.projectKey, title: params.title });
      return { kind: "created", id: created.id, capability: decision.capability ?? null };
    }
  }
}

// ------------------------------------------------------------- the front door

/** The fields a Jira search page must carry for `decide` to grade it. */
export const JIRA_QUERY_FIELDS = ["summary", "labels", "issuetype", "parent", "project"] as const;
/** The fields a Linear `list_issues` page must carry for `decide` to grade it. */
export const LINEAR_QUERY_FIELDS = ["title", "labels", "projectMilestone", "project", "team"] as const;
export const LINEAR_QUERY_LIMIT = 250;

interface QueryArgs {
  root: string;
  title: string;
  /** `--title-file <path>`: the title is the file's text, one trailing newline dropped. */
  titleFile?: string;
  parentKey?: string;
  milestoneLabel?: string;
  linearMilestone?: string;
}

/**
 * Parse `<root> (--title <t> | --title-file <path>) [container]`. The tag is
 * never an argument. `--title-file` carries a title a plain command cannot
 * quote — one with a backtick, `$` or `\` — so the invocation stays the one
 * plain command the tracker-write gate accepts (STE-607 review 2).
 */
function parseQueryArgs(argv: readonly string[]): QueryArgs | null {
  const [root, ...flags] = argv;
  if (!root || root.startsWith("--")) return null;
  const out: Partial<QueryArgs> = { root };
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i]!;
    const value = flags[i + 1];
    if (value === undefined) return null;
    if (flag === "--title") out.title = value;
    else if (flag === "--title-file") out.titleFile = value;
    else if (flag === "--parent") out.parentKey = value;
    else if (flag === "--milestone-label") out.milestoneLabel = value;
    else if (flag === "--linear-milestone") out.linearMilestone = value;
    else return null; // --tag / --repo-tag included: the binding owns the tag.
  }
  if ((out.title === undefined) === (out.titleFile === undefined)) return null; // exactly one
  if (out.titleFile !== undefined) out.title = "";
  return out as QueryArgs;
}

/** Read `--title-file` into `title`; the file's one trailing newline is not part of the title. */
async function resolveTitleFile<T extends QueryArgs>(args: T): Promise<T> {
  if (args.titleFile === undefined) return args;
  const { readFileSync } = await import("node:fs");
  const title = readFileSync(args.titleFile, "utf-8").replace(/\r?\n$/, "");
  if (title.trim() === "" || /[\r\n]/.test(title)) {
    throw new Error(`--title-file ${args.titleFile}: the title must be one non-empty line.`);
  }
  return { ...args, title };
}

/**
 * Read `<root>/CLAUDE.md`'s binding (tag included) and refuse on a malformed
 * declaration, a failed floor or an unforwarded tag. Shared by `query` and
 * `decide`, so both read the one declaration the same way.
 */
async function loadCommandBinding(root: string, sub: "query" | "decide") {
  const { join } = await import("node:path");
  const { readWorkspaceBinding } = await import("./workspace_binding");
  const { readTaskTrackingSection } = await import("./resolver_config");
  const { checkVersionFloor, runningDptVersion } = await import("./dpt_version");
  const claudeMdPath = join(root, "CLAUDE.md");
  const mode = readTaskTrackingSection(claudeMdPath)["mode"];
  if (mode !== "jira" && mode !== "linear") {
    throw new Error(`${sub}: tracker mode "${String(mode)}" has no search to run (jira or linear only).`);
  }
  const binding = readWorkspaceBinding(claudeMdPath, mode);
  const floor = checkVersionFloor(binding, runningDptVersion());
  if (!floor.ok) throw new Error(floor.message);
  assertRepoTagForwarded(binding.repoTag, binding.defaultLabels);
  if (!binding.project) throw new Error(`${sub}: the ${mode} binding declares no \`project\`.`);
  return { mode, binding: { ...binding, project: binding.project } };
}

type CommandBinding = Awaited<ReturnType<typeof loadCommandBinding>>;

/**
 * The conjuncts one binding + one argv produce. `query` prints them and
 * `decide` grades against them, so the two can never carry different sets.
 */
function commandQuery({ mode, binding }: CommandBinding, args: QueryArgs): DecisionQuery {
  return {
    projectKey: binding.project,
    title: args.title,
    ...(args.parentKey ? { parentKey: args.parentKey } : {}),
    ...(args.milestoneLabel ? { milestoneLabel: args.milestoneLabel } : {}),
    ...(args.linearMilestone ? { linearMilestone: args.linearMilestone } : {}),
    ...(mode === "linear" && binding.team ? { team: binding.team } : {}),
    ...(binding.repoTag ? { repoTag: binding.repoTag } : {}),
  };
}

/**
 * STE-604 `query`: read the binding (tag included) from `<root>/CLAUDE.md`,
 * refuse on a malformed declaration, a failed floor or an unforwarded tag,
 * then print the one search the tracker must run — as one JSON line.
 */
async function runQueryCommand(args: QueryArgs): Promise<string> {
  const loaded = await loadCommandBinding(args.root, "query");
  const { mode, binding } = loaded;

  if (mode === "jira") {
    const jql = buildIdempotencyJql(commandQuery(loaded, args), { excludeEpics: true });
    return JSON.stringify({ jql, fields: [...JIRA_QUERY_FIELDS] });
  }
  // Linear: never `query` (full-text widens), never `projectMilestone` (checked
  // client-side by `decide`).
  return JSON.stringify({
    ...(binding.team ? { team: binding.team } : {}),
    project: binding.project,
    ...(binding.repoTag ? { label: binding.repoTag } : {}),
    fields: [...LINEAR_QUERY_FIELDS],
    limit: LINEAR_QUERY_LIMIT,
  });
}

// ------------------------------------------------------------ the decide door

interface DecideArgs extends QueryArgs {
  pages: string[];
  attempt: IdempotencyAttempt;
}

/** Parse `<root> <page.json>... --title <t> [container] --attempt <a>`. */
function parseDecideArgs(argv: readonly string[]): DecideArgs | null {
  const [root, ...rest] = argv;
  if (!root || root.startsWith("--")) return null;
  const pages: string[] = [];
  let i = 0;
  while (i < rest.length && !rest[i]!.startsWith("--")) pages.push(rest[i++]!);
  const flags = rest.slice(i);
  const at = flags.indexOf("--attempt");
  if (at < 0 || at % 2 !== 0) return null;
  const attempt = flags[at + 1] as IdempotencyAttempt | undefined;
  if (!attempt || !IDEMPOTENCY_ATTEMPTS.includes(attempt)) return null;
  const q = parseQueryArgs([root, ...flags.slice(0, at), ...flags.slice(at + 2)]);
  if (!q || pages.length === 0) return null;
  return { ...q, pages, attempt };
}

/** A page the decision cannot read. Never "no match". */
class UnreadablePage extends Error {}

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A Linear/Jira reference that may be a bare string or `{ key|name|id }`. */
function refName(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (isObj(v)) {
    for (const k of ["key", "name", "id"]) if (typeof v[k] === "string") return v[k];
  }
  return undefined;
}

/** The container flag is the milestone's id — never its display name. */
function milestoneId(v: unknown): string | null {
  if (v == null) return null;
  if (isObj(v) && typeof v.id === "string") return v.id;
  return refName(v) ?? null;
}

function labelList(v: unknown, needed: boolean): string[] | undefined {
  if (v === undefined) {
    if (needed) throw new UnreadablePage("a candidate lacks `labels`");
    return undefined;
  }
  if (!Array.isArray(v)) throw new UnreadablePage("`labels` is not a list");
  return v.map((l) => {
    const n = refName(l);
    if (n === undefined) throw new UnreadablePage("an unreadable label");
    return n;
  });
}

function readJiraPages(
  raw: unknown[],
  q: DecisionQuery,
): { candidates: DecisionCandidate[]; capped: boolean } {
  const candidates: DecisionCandidate[] = [];
  let capped = false;
  for (const page of raw) {
    if (!isObj(page) || !Array.isArray(page.issues) || typeof page.isLast !== "boolean") {
      throw new UnreadablePage("not a Jira search page (`issues` + `isLast`)");
    }
    capped = !page.isLast;
    for (const issue of page.issues) {
      const f = isObj(issue) ? issue.fields : undefined;
      if (!isObj(issue) || typeof issue.key !== "string" || !isObj(f) || typeof f.summary !== "string") {
        throw new UnreadablePage("a candidate lacks `key` or `summary`");
      }
      const project = refName(f.project);
      const issuetype = refName(f.issuetype);
      if (project === undefined) throw new UnreadablePage("a candidate lacks `project`");
      if (issuetype === undefined) throw new UnreadablePage("a candidate lacks `issuetype`");
      const labels = labelList(f.labels, Boolean(q.repoTag || q.milestoneLabel));
      candidates.push({
        key: issue.key,
        title: f.summary,
        project,
        issuetype,
        parent: f.parent == null ? null : (refName(f.parent) ?? null),
        ...(labels ? { labels } : {}),
      });
    }
  }
  return { candidates, capped };
}

function readLinearPages(
  raw: unknown[],
  q: DecisionQuery,
): { candidates: DecisionCandidate[]; capped: boolean } {
  const candidates: DecisionCandidate[] = [];
  let capped = false;
  for (const page of raw) {
    if (
      !isObj(page) ||
      !Array.isArray(page.issues) ||
      !isObj(page.pageInfo) ||
      typeof page.pageInfo.hasNextPage !== "boolean"
    ) {
      throw new UnreadablePage("not a Linear list_issues page (`issues` + `pageInfo`)");
    }
    capped = page.pageInfo.hasNextPage;
    for (const issue of page.issues) {
      if (!isObj(issue) || typeof issue.title !== "string") {
        throw new UnreadablePage("a candidate lacks `title`");
      }
      const key = refName(issue.identifier) ?? refName(issue.id);
      const project = refName(issue.project);
      if (key === undefined) throw new UnreadablePage("a candidate lacks `identifier`");
      if (project === undefined) throw new UnreadablePage("a candidate lacks `project`");
      if (q.linearMilestone !== undefined && !("projectMilestone" in issue)) {
        throw new UnreadablePage("a candidate lacks `projectMilestone`");
      }
      const team = refName(issue.team);
      // A team conjunct the query carried must be checkable on every row: an
      // absent `team` would otherwise skip that conjunct, never violate it.
      if (q.team !== undefined && team === undefined) {
        throw new UnreadablePage("a candidate lacks `team`");
      }
      const labels = labelList(issue.labels, Boolean(q.repoTag));
      candidates.push({
        key,
        title: issue.title,
        project,
        milestone: milestoneId(issue.projectMilestone),
        ...(team === undefined ? {} : { team }),
        ...(labels ? { labels } : {}),
      });
    }
  }
  return { candidates, capped };
}

/** The create a `create` decision authorises, carrying its container. */
function buildCreatePayload(
  mode: "jira" | "linear",
  args: DecideArgs,
  binding: { project: string; team?: string; defaultLabels?: string[] },
): Record<string, unknown> {
  const labels = [...(binding.defaultLabels ?? [])];
  if (mode === "jira") {
    if (args.milestoneLabel && !labels.includes(args.milestoneLabel)) labels.push(args.milestoneLabel);
    return {
      project: binding.project,
      summary: args.title,
      labels,
      ...(args.parentKey ? { parent: args.parentKey } : {}),
    };
  }
  return {
    ...(binding.team ? { team: binding.team } : {}),
    project: binding.project,
    title: args.title,
    labels,
    ...(args.linearMilestone ? { milestone: args.linearMilestone } : {}),
  };
}

/**
 * STE-604 `decide`: grade the saved page(s) against the query the binding
 * builds, then print the one decision as one JSON line.
 */
async function runDecideCommand(args: DecideArgs): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const loaded = await loadCommandBinding(args.root, "decide");
  const { mode, binding } = loaded;
  const query = commandQuery(loaded, args);

  let decision: CreateDecision;
  try {
    const raw = args.pages.map((p) => {
      try {
        return JSON.parse(readFileSync(p, "utf-8")) as unknown;
      } catch (e) {
        throw new UnreadablePage(`page ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    const page = mode === "jira" ? readJiraPages(raw, query) : readLinearPages(raw, query);
    decision = decideCreate(query, page, args.attempt);
  } catch (e) {
    if (!(e instanceof UnreadablePage)) throw e;
    decision = refusal("page-unreadable");
  }

  const out =
    decision.outcome === "create"
      ? { ...decision, createPayload: buildCreatePayload(mode, args, binding) }
      : decision;
  const lines = [JSON.stringify(out)];
  // STE-604 §4 — a shared repository records what it decided; an undeclared
  // one writes nothing at all.
  if (binding.shared && (out.outcome === "create" || out.outcome === "reused")) {
    const { resolve } = await import("node:path");
    const { writeReceipt, announceReceipt } = await import("./tracker_receipts");
    const container = args.parentKey ?? args.milestoneLabel ?? args.linearMilestone ?? "";
    const path = writeReceipt(resolve(args.root), {
      kind: out.outcome === "create" ? "create" : "reuse",
      adapter: mode,
      container,
      subject: args.title,
      decision: out.outcome,
      evidence: out.outcome === "create" ? { createPayload: out.createPayload } : { key: out.key },
    });
    lines.push(announceReceipt(path));
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === "normalize" && rest.length >= 1) {
    // Only a receipt write may start a line with `dpt-receipt:` — never an
    // echoed argument (STE-607 review 2).
    const { printable, RECEIPT_ANNOUNCEMENT_PREFIX } = await import("./tracker_receipts");
    const out = printable(normalizeTitleForCompare(rest[0]!));
    if (out.trimStart().startsWith(RECEIPT_ANNOUNCEMENT_PREFIX.trim())) {
      console.error(`normalize: a title cannot start with "${RECEIPT_ANNOUNCEMENT_PREFIX.trim()}"; refusing`);
      process.exit(2);
    }
    console.log(out);
    process.exit(0);
  }
  if (sub === "query") {
    const args = parseQueryArgs(rest);
    if (args) {
      try {
        console.log(await runQueryCommand(await resolveTitleFile(args)));
        process.exit(0);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    }
  }
  if (sub === "decide") {
    const args = parseDecideArgs(rest);
    if (args) {
      try {
        console.log(await runDecideCommand(await resolveTitleFile(args)));
        process.exit(0);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    }
  }
  if (sub === "jql" && rest.length >= 2) {
    try {
      console.log(
        buildIdempotencyJql({
          projectKey: rest[0]!,
          title: rest[1]!,
          ...(rest[2] ? { parentKey: rest[2] } : {}),
          ...(rest[3] ? { repoTag: rest[3] } : {}),
        }),
      );
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    process.exit(0);
  }
  console.error(
    "usage: bun create_idempotency_probe.ts normalize <title>\n" +
      "       bun create_idempotency_probe.ts query <projectRoot> (--title <t> | --title-file <path>) [--parent <EpicKey> | --milestone-label <label> | --linear-milestone <id>]\n" +
      "       bun create_idempotency_probe.ts decide <projectRoot> <page.json>... (--title <t> | --title-file <path>) [container] --attempt <fast|retry-1|retry-2|retry-3>\n" +
      "       bun create_idempotency_probe.ts jql <projectKey> <title> [parentKey] [repoTag]",
  );
  process.exit(2);
}
