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
// sibling repositories, the narrowed page can carry a candidate whose title
// matches and whose `repo_tag` belongs to a DIFFERENT repository. That
// candidate is not this repo's ticket:
//
//   - returning it mis-binds the FR onto someone else's issue, and every
//     later write — status, AC checkboxes, milestone attachment — lands there;
//   - creating beside it duplicates onto a board with no delete tool.
//
// Both moves are irreversible in the direction that matters, so neither is
// taken. The run STOPS: no reuse, no create, `tracker_idempotency_uncertain`
// surfaced with both keys and both tags, and the operator decides.
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
}

export interface IdempotencySearchResult {
  candidates: readonly IdempotencyCandidate[];
  /** true when the result page hit the documented cap before reporting isLast. */
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
 * The narrowing query. `summary ~ "\"<title>\""` — the escaped inner quotes are
 * the phrase-match form; without them `~` widens to any word. `=` is never
 * emitted: Jira ACCEPTS it and answers zero rows for a summary the issue
 * provably carries.
 */
export function buildIdempotencyJql(params: IdempotencySearchParams): string {
  const clauses = [`project = ${params.projectKey}`];
  // Conjunct order follows § Jira's stated order: project, then the CONTAINER
  // in either of its two forms — an Epic `parent`, or the grandfathered
  // numeric milestone label — then the repo tag, then the summary phrase.
  // Both container forms therefore sit together, ahead of the tag; the tag is
  // not a container and must not be interleaved between them.
  if (params.parentKey) clauses.push(`parent = ${params.parentKey}`);
  if (params.milestoneLabel) clauses.push(`labels = "${params.milestoneLabel}"`);
  if (params.repoTag) clauses.push(`labels = "${params.repoTag}"`);
  clauses.push(`summary ~ "\\"${params.title}\\""`);
  return clauses.join(" AND ");
}

// ------------------------------------------------------------------ the probe

export interface IdempotencyDeps {
  search(params: IdempotencySearchParams): Promise<IdempotencySearchResult>;
  create(params: { projectKey: string; title: string }): Promise<{ id: string }>;
}

export type IdempotencyOutcome =
  | { kind: "reused"; id: string; capability: null }
  | { kind: "created"; id: string; capability: null }
  | {
      kind: "refused";
      id: null;
      capability: typeof TRACKER_IDEMPOTENCY_UNCERTAIN;
      reason: "foreign-repo-tag" | "page-cap";
    };

export interface RunCreateIdempotencyProbeParams extends IdempotencySearchParams {
  /** The labels the CREATE call forwards — the set `repo_tag` must live in. */
  defaultLabels?: readonly string[];
}

function refused(reason: "foreign-repo-tag" | "page-cap"): IdempotencyOutcome {
  return { kind: "refused", id: null, capability: TRACKER_IDEMPOTENCY_UNCERTAIN, reason };
}

/**
 * Narrow, join, then decide. Exactly one of: reuse an existing ticket, create
 * a fresh one, or stop.
 *
 * `deps.create` is reached from ONE place, guarded by both refusals, so the
 * call count on either stopped branch is zero by construction rather than by
 * a discarded result.
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

  const wanted = normalizeTitleForCompare(params.title);
  const matches = page.candidates.filter(
    (c) => normalizeTitleForCompare(c.title) === wanted,
  );

  // Narrowed to a plain string, so the join reads the same declared tag the
  // guard above read — and needs no non-null assertion to say so.
  const repoTag = params.repoTag;
  if (repoTag) {
    // A title match wearing a SIBLING repository's tag. Reusing it mis-binds
    // the FR; creating beside it duplicates. Neither, and the count is zero.
    const foreign = matches.find((c) => !carriesTag(c.labels, repoTag));
    if (foreign) return refused("foreign-repo-tag");
  }

  const mine = matches[0];
  if (mine) return { kind: "reused", id: mine.id, capability: null };

  // No match. A page that reached the cap before reporting isLast has not
  // PROVEN the ticket absent — that is uncertainty, not a miss.
  if (page.capped) return refused("page-cap");

  const created = await deps.create({ projectKey: params.projectKey, title: params.title });
  return { kind: "created", id: created.id, capability: null };
}

// ------------------------------------------------------------- the front door

if (import.meta.main) {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === "normalize" && rest.length >= 1) {
    console.log(normalizeTitleForCompare(rest[0]!));
    process.exit(0);
  }
  if (sub === "jql" && rest.length >= 2) {
    console.log(
      buildIdempotencyJql({
        projectKey: rest[0]!,
        title: rest[1]!,
        ...(rest[2] ? { parentKey: rest[2] } : {}),
        ...(rest[3] ? { repoTag: rest[3] } : {}),
      }),
    );
    process.exit(0);
  }
  console.error(
    "usage: bun create_idempotency_probe.ts normalize <title>\n" +
      "       bun create_idempotency_probe.ts jql <projectKey> <title> [parentKey] [repoTag]",
  );
  process.exit(2);
}
