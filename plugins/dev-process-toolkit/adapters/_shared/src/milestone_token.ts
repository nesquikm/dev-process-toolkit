// STE-376 AC-STE-376.1 — centralized milestone-token union matcher.
//
// ONE home for the milestone-id grammar. Two shapes are legal:
//   - `M<N>`         — sequential numeric ids (`M101`), the historical grammar
//   - `M_<epic-key>` — opaque Jira-Epic-keyed ids (`M_PROJ_500`, `M_PROJ-500`)
// Everything else (`M`, `M_`, `Mx`, `milestone-M5`, `M5-extra`) is malformed.
//
// Consumers embed the exported regex SOURCES into their larger patterns (plan
// filenames, changelog refs, heading grammars) instead of keeping private
// `M\d+` copies — the STE-335 AC-7 audit in milestone_token.test.ts greps
// every consumer for a `milestone_token` reference so a private copy cannot
// silently return.

/** Digits of a numeric milestone id (`101` of `M101`). */
const NUMBER_SOURCE = String.raw`\d+`;

/**
 * An Epic key (`PROJ_500` / `PROJ-500` of `M_PROJ_500` / `M_PROJ-500`).
 * Alphanumeric head so `M_` (empty key) and `M__x` stay malformed; `_` and
 * `-` are both legal past the head (raw Jira Epic keys are hyphenated;
 * label-safe mirrors use `_`). Keys are opaque — never case-folded, never
 * read as numbers.
 */
const EPIC_KEY_SOURCE = String.raw`[A-Za-z0-9][A-Za-z0-9_-]*`;

/**
 * A BARE numeric milestone number (`"19"` — no leading `M`), anchored.
 * The shape template/branch plumbing passes around as `{N}`.
 */
export const MILESTONE_NUMBER_RE = new RegExp(`^${NUMBER_SOURCE}$`);

/** Unanchored source of a numeric milestone token, no capture group: `M101`. */
export const NUMERIC_MILESTONE_SOURCE = `M${NUMBER_SOURCE}`;

/** Unanchored numeric-token source with the NUMBER captured — embeds as `M(\d+)`. */
export const NUMERIC_MILESTONE_NUMBER_SOURCE = `M(${NUMBER_SOURCE})`;

/**
 * Unanchored source of the FULL union token, no capture group:
 * `M<N>` | `M_<epic-key>` (`M101`, `M_PROJ_500`, `M_PROJ-500`).
 */
export const MILESTONE_TOKEN_SOURCE = `(?:M${NUMBER_SOURCE}|M_${EPIC_KEY_SOURCE})`;

/**
 * Anchored plan-file name under the union grammar: `M101.md`, `M_PROJ_500.md`.
 * Every `specs/plan/**` walker filters through this one constant so the
 * accepted filename shapes cannot drift between probes.
 */
export const PLAN_FILENAME_RE = new RegExp(String.raw`^${MILESTONE_TOKEN_SOURCE}\.md$`);

const NUMERIC_TOKEN_RE = new RegExp(`^${NUMERIC_MILESTONE_NUMBER_SOURCE}$`);
const EPIC_TOKEN_RE = new RegExp(`^M_(${EPIC_KEY_SOURCE})$`);

/** A parsed milestone token, discriminated by grammar branch. */
export type MilestoneToken =
  | { kind: "numeric"; number: number }
  | { kind: "epic"; key: string };

/**
 * Parse a FULL milestone token (anchored — trailing junk like `M5-extra`
 * never prefix-matches). Numeric tokens carry their number; epic tokens
 * carry the key verbatim. Malformed input parses to `null`.
 */
export function parseMilestoneToken(token: string): MilestoneToken | null {
  const numeric = NUMERIC_TOKEN_RE.exec(token);
  if (numeric !== null) return { kind: "numeric", number: Number(numeric[1]) };
  const epic = EPIC_TOKEN_RE.exec(token);
  if (epic !== null) return { kind: "epic", key: epic[1]! };
  return null;
}

/** Full-token accept/reject over the union grammar. */
export function isMilestoneToken(token: string): boolean {
  return parseMilestoneToken(token) !== null;
}

/**
 * Deterministic ordering over bare milestone tokens: numeric tokens first,
 * ascending by numeric part; epic-keyed (and unparseable) tokens follow,
 * compared by code point — never locale-sensitive.
 */
export function compareMilestoneTokens(a: string, b: string): number {
  const ta = parseMilestoneToken(a);
  const tb = parseMilestoneToken(b);
  if (ta?.kind === "numeric" && tb?.kind === "numeric") return ta.number - tb.number;
  if (ta?.kind === "numeric") return -1;
  if (tb?.kind === "numeric") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
