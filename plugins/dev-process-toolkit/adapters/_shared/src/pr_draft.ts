// Draft pull-request support for `/pr`.
//
// Pure functions, no I/O. The skill surface stays prose; every decision that
// can be wrong deterministically — is this invocation a draft request, does
// the argv carry `--draft`, can this host hold a draft at all — lives here so
// it can be tested as CODE rather than grepped for as documentation.
//
// Three invariants this module exists to hold:
//
//   1. The default is untouched. `buildPrCreateArgv()` with no draft option at
//      all emits the shipped `gh pr create` shape and no flag.
//   2. A draft request is explicit. Prose that NEGATES a draft ("not as a
//      draft") is not pattern-matched into one.
//   3. An unsupported host is SAID, never silently downgraded. Opening a
//      normal pull request when a draft was asked for misrepresents the state
//      of the work, so the unsupported path throws a canonical refusal instead
//      of returning a `draft: false` plan.

/** The state a pull request is opened in. */
export type DraftState = "draft" | "ready";

/** Tracker modes the `/pr` surface runs under. */
export type TrackerMode = "none" | "linear" | "jira";

/** What the environment can actually do about draft pull requests. */
export interface HostDraftSupport {
  /** Identity used in the refusal's `Context:` line. */
  readonly host: string;
  /** The host/repository can hold draft pull requests at all. */
  readonly draftCapable: boolean;
  /** The installed `gh` CLI accepts `--draft` on `pr create`. */
  readonly cliSupportsDraftFlag: boolean;
}

export interface DraftSupportGuard {
  /** Stable id — refusals name it, and drop-one mutation keys on it. */
  readonly id: string;
  readonly reason: string;
  matches(host: HostDraftSupport): boolean;
}

export interface DraftRequest {
  readonly draft: boolean;
  /** The invocation text with recognized flags removed. */
  readonly residualText: string;
  readonly raw: string;
}

export interface PrPlan {
  readonly draft: boolean;
  readonly state: DraftState;
  /** The full `gh pr create …` invocation. */
  readonly argv: readonly string[];
  /** Tracker-mode post-create ops, in order. Empty in `mode: none`. */
  readonly mcpCalls: readonly string[];
  /** The closing report handed to the operator. */
  readonly report: string;
  readonly residualText: string;
}

export interface PrPlanInput {
  /** Raw text after `/pr`. */
  readonly text: string;
  readonly mode: TrackerMode;
  readonly host: HostDraftSupport;
  readonly url?: string;
  readonly ticket?: string | null;
}

export interface GuardOptions {
  readonly guards?: readonly DraftSupportGuard[];
}

export interface ArgvInput {
  draft?: boolean;
  base?: string;
  title?: string;
  body?: string;
}

/** The literal flag `gh pr create` understands. */
export const GH_DRAFT_FLAG = "--draft";

/** The literal flag the `/pr` invocation understands. Deliberately the same
 *  spelling as the `gh` one — one word for one concept on both sides. */
export const DRAFT_REQUEST_FLAG = "--draft";

/** How each state is named in the closing report. Distinct on purpose: the
 *  ABSENCE of the word "draft" is not a statement, so the default branch names
 *  its own state too. */
export const DRAFT_STATE_LABELS: Record<DraftState, string> = {
  draft: "draft",
  ready: "ready for review",
};

// The flag as a standalone token. `--no-draft` and `--draft-mode` do not match.
//
// TWO constants for ONE pattern, deliberately. The `/g` form is what `replace`
// needs to strip every occurrence; `/g` also makes `.test()` STATEFUL, so a
// second call on the same string answers from `lastIndex` and returns false.
// Naming the non-global copy is the fix, rather than rebuilding a throwaway
// `new RegExp(src)` inside the parser on every call.
// Trailing PUNCTUATION closes the token as well as whitespace. Without this,
// "--draft, no rush" and "please --draft." did not match at all: the flag was
// neither detected nor stripped, so the run opened a NORMAL pull request with
// nothing said — the silent-downgrade this module exists to prevent, reached
// through the flag path. `--no-draft` and `--draft-mode` still do not match,
// because `-` is deliberately absent from the closing class.
const DRAFT_FLAG_SOURCE = "(^|\\s)--draft(?=[\\s,.;:!?]|$)";
const DRAFT_FLAG_STRIP_RE = new RegExp(DRAFT_FLAG_SOURCE, "g");
const DRAFT_FLAG_TEST_RE = new RegExp(DRAFT_FLAG_SOURCE);

// Prose that ASKS for a draft, e.g. "open it as a draft".
// `an?` already covers the "as a draft" case — a second literal alternative for
// it would be a subset of the first and could never be the branch that matched.
const DRAFT_PROSE_RE = /\bas an?\s+draft\b|\bdraft\s+(pull request|pr)\b/i;

// Prose that REFUSES one. Checked first: "don't open it as a draft" contains
// the positive phrase verbatim, so a positive-only matcher inverts the user.
const DRAFT_NEGATION_RE = /\b(not|no|never|without|dont|doesnt|do not)\b/i;

/**
 * Clause boundaries. The negation window is scoped to the clause CONTAINING the
 * draft phrase, never the whole utterance.
 *
 * Found by the STE-496 audit: testing negation across the entire residual text
 * made "open it as a draft, no rush" parse as `draft: false` — a normal pull
 * request opened with nothing said, which is the same silent-downgrade class
 * the unsupported-host rule exists to prevent, reached through the prose path
 * instead of the host path. The negation there ("no") belongs to a different
 * clause and negates nothing about the draft.
 *
 * Scoping to the clause keeps the case this matcher was written for — "don't
 * open it as a draft" — because that negation sits in the SAME clause as the
 * phrase, before it.
 */
const CLAUSE_SPLIT_RE = /[,;.!?]|\band\b|\bbut\b|\bthen\b/i;

/**
 * Is the draft phrase in `text` negated? True only when a negation word appears
 * in the same clause as the phrase, at or before it.
 */
function draftPhraseIsNegated(text: string): boolean {
  const hit = DRAFT_PROSE_RE.exec(text);
  if (hit === null) return false;
  const before = text.slice(0, hit.index);
  // The clause containing the phrase starts after the last boundary before it.
  const parts = before.split(CLAUSE_SPLIT_RE);
  const clauseHead = parts[parts.length - 1] ?? "";
  return DRAFT_NEGATION_RE.test(clauseHead);
}

/** The guards that decide whether a draft can be opened at all.
 *
 *  Each guard matches exactly one failure mode and no other, so dropping one
 *  leaves its siblings standing — the property the mutation coverage rides on.
 *
 *  SHARED WITH THE SIBLING GUARD LISTS: NOTHING. Decided, not overlooked.
 *  Two other modules in this milestone use the same drop-one idiom —
 *  `gate_class.IRREVERSIBLE_GUARDS` (matcher arity 1, over a gate string) and
 *  `merge_policy_ratchet.LOOSENING_GUARDS` (arity 2, over a policy pair). An
 *  earlier pass already declined to unify THOSE two; the same verdict holds
 *  here, for a reason that is stronger rather than weaker at Tier 2:
 *
 *    * There is no logic to deduplicate. Only `id` and `matches` are common,
 *      and a shared `Guard<T>` interface would move four lines of structure
 *      into a shared file while every guard list, matcher, and refusal string
 *      stayed exactly where it is. That is type-level DRY bought with a real
 *      cross-module edge.
 *    * The edge runs the wrong way. `IRREVERSIBLE_GUARDS` is a Tier-1 safety
 *      fence. Making a Tier-2 convenience feature a co-owner of its type means
 *      a future widening for THIS module lands on that fence. Independence is
 *      the property being protected; adding a third, lower-stakes member to
 *      the family spends it for nothing.
 *    * Each list's drop-one coverage is asserted against its OWN module's
 *      public entry points, so a shared type would not buy a single test
 *      either — and a shared LIST would destroy the property outright.
 */
export const DRAFT_SUPPORT_GUARDS: readonly DraftSupportGuard[] = [
  {
    id: "host_cannot_hold_drafts",
    reason: "the repository host does not support draft pull requests",
    matches: (host) => !host.draftCapable,
  },
  {
    id: "cli_lacks_draft_flag",
    reason: "the installed gh CLI does not accept --draft on pr create",
    matches: (host) => !host.cliSupportsDraftFlag,
  },
];

/** A named error so callers can tell a refusal from an incidental crash. */
export class DraftUnsupportedError extends Error {
  override readonly name = "DraftUnsupportedError";
  readonly guardIds: readonly string[];

  constructor(message: string, guardIds: readonly string[]) {
    super(message);
    this.guardIds = guardIds;
  }
}

/**
 * Decide whether an invocation asks for a draft pull request.
 *
 * Recognizes the explicit flag and the plain-English phrasing, and carries the
 * raw text through untouched so callers can quote the operator back.
 */
export function parseDraftRequest(text: string): DraftRequest {
  const raw = text;
  const hasFlag = DRAFT_FLAG_TEST_RE.test(text);
  const residualText = text
    .replace(DRAFT_FLAG_STRIP_RE, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Apostrophes are folded so "don't" and "dont" read the same.
  const normalized = residualText.replace(/['’]/g, "");
  const asksInProse =
    DRAFT_PROSE_RE.test(normalized) && !draftPhraseIsNegated(normalized);

  return { draft: hasFlag || asksInProse, residualText, raw };
}

function failedGuards(
  host: HostDraftSupport,
  options: GuardOptions = {},
): DraftSupportGuard[] {
  const guards = options.guards ?? DRAFT_SUPPORT_GUARDS;
  return guards.filter((g) => g.matches(host));
}

/** True when a draft pull request can be opened against `host`. */
export function isDraftSupported(
  host: HostDraftSupport,
  options: GuardOptions = {},
): boolean {
  return failedGuards(host, options).length === 0;
}

/**
 * Refuse — loudly, in the canonical Refusing/Remedy/Context shape — when a
 * draft was asked for and cannot be delivered. Never downgrades.
 *
 * The message is built here rather than through `requires_input`'s exported
 * `renderRefusalMessage`, and that is a checked decision, not a missed reuse.
 * That helper renders a DIFFERENT envelope for a different refusal class: its
 * first line is `Verdict:`, not `Refusing:`, and it appends
 * `<dpt:requires-input-refused>v1</dpt:requires-input-refused>` as a mandatory
 * last line. `socratic_first_turn_stream.ts` scans assistant text for exactly
 * that marker, so routing an unsupported-host refusal through it would make a
 * `/pr` draft refusal read as a first-turn requires-input refusal in the smoke
 * harness. Sharing the envelope would corrupt the reader, not save a line.
 */
export function assertDraftSupported(
  host: HostDraftSupport,
  options: GuardOptions = {},
): void {
  const failed = failedGuards(host, options);
  if (failed.length === 0) return;
  const reasons = failed.map((g) => g.reason).join("; ");
  const ids = failed.map((g) => g.id).join(",");
  throw new DraftUnsupportedError(
    `Refusing: cannot open a draft pull request — ${reasons}.\n` +
      "Remedy: re-run /pr without the draft request to open a normal pull " +
      "request, or open the draft manually on the host.\n" +
      `Context: host=${host.host} guards=${ids}`,
    failed.map((g) => g.id),
  );
}

/** Build the `gh pr create` invocation. One builder for every tracker mode. */
export function buildPrCreateArgv(input: ArgvInput = {}): string[] {
  const argv = ["gh", "pr", "create"];
  if (input.base !== undefined) argv.push("--base", input.base);
  if (input.title !== undefined) argv.push("--title", input.title);
  if (input.body !== undefined) argv.push("--body", input.body);
  if (input.draft === true) argv.push(GH_DRAFT_FLAG);
  return argv;
}

/** The closing report: the URL, plus the state that was actually opened. */
export function prClosingReport(input: { url: string; draft: boolean }): string {
  const label = DRAFT_STATE_LABELS[input.draft ? "draft" : "ready"];
  return `Pull request opened as ${label}: ${input.url}`;
}

/** Tracker post-create ops. Identical whether or not a draft was asked for. */
function trackerCalls(mode: TrackerMode): string[] {
  if (mode === "none") return [];
  return ["transition_status", "upsert_ticket_metadata"];
}

/** Plan one `/pr` run end to end: parse, guard, build, report. */
export function planPullRequest(
  input: PrPlanInput,
  options: GuardOptions = {},
): PrPlan {
  const request = parseDraftRequest(input.text);
  if (request.draft) assertDraftSupported(input.host, options);

  const state: DraftState = request.draft ? "draft" : "ready";
  const argv = buildPrCreateArgv({ draft: request.draft });
  const url = input.url ?? "";

  return {
    draft: request.draft,
    state,
    argv,
    mcpCalls: trackerCalls(input.mode),
    report: prClosingReport({ url, draft: request.draft }),
    residualText: request.residualText,
  };
}
