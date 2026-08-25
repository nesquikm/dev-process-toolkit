// deliver_worker_name — M134 STE-518: a spawned ceremony worker's remote-control
// name is DERIVED from the run's own identity, never typed.
//
// A worker launched without a name takes whatever name the spawning skill
// defaults to. Where session names are global that makes every worker
// indistinguishable from every other and from the operator's own session — and
// a name collision is not cosmetic: the spawning skill refuses to launch when a
// live session already holds the name, so a collision blocks the spawn outright.
//
// The name is `<repository>-<identity>`: the basename of the repository root
// joined to the run's identity segment (its FR when the run carries one, its
// milestone otherwise). Both halves are folded into the spawning skill's
// grammar — lowercase, runs of anything outside the grammar collapsed to a
// single hyphen, leading and trailing hyphens stripped from EACH segment before
// they are joined.
//
// It does not always return a name, and the two ways it declines are the whole
// design. Over the length cap the REPOSITORY half gives way, keeping its leading
// characters and shortening by exactly as much as it must; the identity half is
// the discriminator the shape exists for and is never cut. When not even a
// one-character repository segment makes the name fit, and when the composed
// name would not begin with a lowercase letter, it refuses — a truncated
// identity would silently reintroduce the collision, and prefixing a letter
// would invent a name the operator never chose. Both refusals wear the canonical
// NFR-10 envelope.
//
// NOT built on `branch_proposal`. That module's `canonicalBranchTemplate` tests
// for bare digits and then for an epic token, so a full `M134`-form milestone
// matches neither and falls through to its ticket-keyed template — two
// spellings of one milestone disagree there. This derivation owes nothing to
// that shape and deliberately shares no code with it.

import type { DeliverRouting } from "./deliver_argument";

/** The spawning skill's cap on an agent name. */
export const WORKER_NAME_MAX_LENGTH = 32;

/**
 * The grammar every returned name must match. Its `{0,31}` tail and
 * `WORKER_NAME_MAX_LENGTH` are the same cap counted twice — one leading letter
 * plus 31 more — so the length is enforced before composition, by the budget,
 * and the only clause that can reject a composed name here is the leading one.
 */
export const WORKER_NAME_GRAMMAR = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * The NFR-10 refusal this module raises. Named so a caller can tell a worker-name
 * refusal apart from a routing or decision refusal that crossed the same
 * boundary — all three render the same three-line envelope.
 */
export class WorkerNameRefusedError extends Error {
  override readonly name = "WorkerNameRefusedError";
}

/** The three line prefixes a canonical NFR-10 envelope always carries. */
const ENVELOPE_PREFIXES = ["Refusing: ", "Remedy: ", "Context: "] as const;

/** The canonical NFR-10 envelope: Refusing / Remedy / Context, in that order. */
function refuse(parts: {
  verdict: string;
  remedy: string;
  context: string;
}): WorkerNameRefusedError {
  return new WorkerNameRefusedError(
    [
      `${ENVELOPE_PREFIXES[0]}${parts.verdict}`,
      `${ENVELOPE_PREFIXES[1]}${parts.remedy}`,
      `${ENVELOPE_PREFIXES[2]}${parts.context}`,
    ].join("\n"),
  );
}

/**
 * The identity segment, taken from the routing the argument resolver already
 * returned: the FR when the run carries one, the milestone otherwise.
 *
 * Returned RAW — sanitizing belongs to the name builder, not to this extractor.
 * The routing's own fields are the source: nothing here re-parses
 * `routing.identity`, which is what the operator typed rather than what the
 * resolver decided. A routing that carries neither — the feature-request path,
 * which has no unit of work yet — refuses.
 */
export function workerIdentitySegment(routing: DeliverRouting): string {
  const identity = routing.fr ?? routing.milestone;
  if (identity === null) {
    throw refuse({
      verdict:
        "to name a worker for a run that routes to neither an FR nor a milestone.",
      remedy:
        "Deliver an FR or a milestone — resolve the feature request into a spec first, then spawn the worker against the FR or milestone it produced.",
      context: `The routing is kind "${routing.kind}" (scope "${routing.scope}") with fr=null and milestone=null; a worker's remote-control name is <repository>-<identity> and there is no identity to render.`,
    });
  }
  return identity;
}

/**
 * Fold one segment into the grammar: lowercase, runs of characters outside the
 * grammar collapsed to a single hyphen, leading and trailing hyphens stripped.
 *
 * Stripping happens PER SEGMENT and before the join, so the joining hyphen is
 * the only one that can ever sit between the two halves.
 */
function sanitizeSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** The repository segment: the basename of `repoRoot`, sanitized. */
function repositorySegment(repoRoot: string): string {
  // Trailing separators first, so `/a/b/` yields `b` rather than an empty last
  // component. Both separators are honoured rather than deferring to
  // `node:path`, whose basename is platform-flavoured.
  const trimmed = repoRoot.replace(/[/\\]+$/, "");
  return sanitizeSegment(trimmed.split(/[/\\]/).pop() ?? "");
}

export interface WorkerRemoteControlNameInput {
  /** The repository root whose basename becomes the repository segment. */
  readonly repoRoot: string;
  /** The run's identity, raw — sanitizing is this builder's job, not the caller's. */
  readonly identity: string;
}

/**
 * The worker's remote-control name: `<repository>-<identity>`.
 *
 * The identity is a bare string parameter on purpose — both the milestone-scoped
 * and the FR-scoped caller reuse this one builder, and each supplies its own
 * identity rather than this module reaching back into a routing object.
 */
export function workerRemoteControlName(
  input: WorkerRemoteControlNameInput,
): string {
  const repo = repositorySegment(input.repoRoot);
  const identity = sanitizeSegment(input.identity);

  // Over the cap the REPOSITORY segment gives way, keeping its leading
  // characters and shortening by exactly as much as it must — never more. The
  // identity is the discriminator the whole name shape exists for, so it is
  // never the half that is cut.
  const budget = WORKER_NAME_MAX_LENGTH - identity.length - 1;

  // The identity alone leaves no room for a repository segment of even one
  // character. Shortening the repository cannot help and truncating the identity
  // is forbidden — the discriminator would stop discriminating — so this refuses
  // rather than returning a name that is either over the cap or silently cut.
  if (budget < 1) {
    throw refuse({
      verdict: `to name a worker: the identity segment "${identity}" leaves no room for a repository segment.`,
      remedy: `Shorten the identity to at most ${WORKER_NAME_MAX_LENGTH - 2} characters — a name is <repository>-<identity> and the repository segment may not be dropped or the identity truncated.`,
      context: `Repository segment "${repo}" is ${repo.length} characters and identity segment "${identity}" is ${identity.length}; the shortest possible name is 1 + 1 + ${identity.length} = ${identity.length + 2} characters against a cap of ${WORKER_NAME_MAX_LENGTH}.`,
    });
  }

  // A prefix can land on a hyphen; strip it so the joining hyphen stays the
  // only one between the two halves.
  const head =
    repo.length > budget ? repo.slice(0, budget).replace(/-+$/, "") : repo;
  const name = `${head}-${identity}`;

  // The grammar demands a LOWERCASE LETTER first, and sanitizing cannot supply
  // one: it lowercases and collapses, but a repository whose name begins with a
  // digit or an underscore — or that sanitizes away to nothing — still composes
  // to a name outside the grammar. Prefixing a letter would invent a name the
  // operator never chose, so this refuses rather than returning one that the
  // spawning skill would reject anyway.
  if (!WORKER_NAME_GRAMMAR.test(name)) {
    throw refuse({
      verdict: `to name a worker: the composed name "${name}" is outside the agent-name grammar.`,
      remedy:
        "Give the repository a name that starts with a lowercase letter, or spawn the worker from a repository root whose basename does — the name is derived, never patched.",
      context: `Repository segment "${head}" joined to identity segment "${identity}" yields "${name}", which does not match ${WORKER_NAME_GRAMMAR.source}; a name must begin with a lowercase letter and sanitizing cannot add one.`,
    });
  }

  return name;
}
