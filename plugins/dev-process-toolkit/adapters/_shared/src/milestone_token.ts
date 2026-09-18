// STE-376 AC-STE-376.1 — centralized milestone-token union matcher.
//
// ONE home for the milestone-id grammar. Two shapes are legal:
//   - `M<N>`   — sequential numeric ids (`M101`), the historical grammar
//   - `M_<key>` — opaque tracker-derived ids (`M_PROJ_500`, `M_PROJ-500`,
//     `M_0K0K0K`, `M_550e84`). THREE producers feed this one branch, and only
//     the first is Jira: `milestoneIdFromEpicKey` (a Jira Epic key),
//     `milestoneIdFromUlid` (a minted ULID's tail, `mode: none`) and
//     `milestoneIdFromLinearMilestone` (a Linear milestone identifier's leading
//     six hex). The key is OPAQUE — the branch is deliberately one grammar for
//     all three, so a reader must not infer the producer from the token.
// Everything else (`M`, `M_`, `Mx`, `milestone-M5`, `M5-extra`) is malformed.
//
// Consumers embed the exported regex SOURCES into their larger patterns (plan
// filenames, changelog refs, heading grammars) instead of keeping private
// `M\d+` copies — the STE-335 AC-7 audit in milestone_token.test.ts greps
// every consumer for a `milestone_token` reference so a private copy cannot
// silently return.

import { normalizeTitleForCompare } from "./create_idempotency_probe";
import { ULID_REGEX } from "./ulid";

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
 * STE-377 AC-STE-377.1 — Epic-first milestone-id derivation. Sanitize a
 * tracker-assigned Epic key to the filesystem/label-safe `M_<epic-key>` id:
 * every character outside `[A-Za-z0-9_]` becomes `_` (`PROJ-500` →
 * `M_PROJ_500`). Idempotent over already-sanitized keys, so the id
 * re-derives stably from its own parsed `key`. Throws when the result is
 * malformed under the union grammar (empty key ⇒ bare `M_`) — never a
 * silent bad id.
 */
export function milestoneIdFromEpicKey(key: string): string {
  const id = `M_${key.replace(/[^A-Za-z0-9_]/g, "_")}`;
  if (!isMilestoneToken(id) || !/^M_[A-Za-z0-9_]+$/.test(id)) {
    throw new Error(
      `milestoneIdFromEpicKey: Epic key "${key}" does not sanitize to a well-formed \`M_<epic-key>\` milestone id`,
    );
  }
  return id;
}

/**
 * Tracker-less milestone-id derivation — the `mode: none` sibling of
 * `milestoneIdFromEpicKey`, feeding the SAME opaque `M_<key>` branch of the
 * union grammar (no grammar change: `EPIC_KEY_SOURCE` already admits a 6-char
 * Crockford tail).
 *
 * The key is `ulid.slice(23, 29)` — the same offsets `acPrefix`
 * (`ac_prefix.ts`) uses, for the same reason: `ulid.ts` mints monotonic ULIDs,
 * so same-millisecond mints share their LEADING random chars and only the
 * tail is entropic. See that module's header for the full rationale.
 *
 * Throws when the input is not a well-formed minted id under `ULID_REGEX`, or
 * when the derived id is malformed under the union grammar — mirroring
 * `milestoneIdFromEpicKey`'s never-a-silent-bad-id contract.
 */
export function milestoneIdFromUlid(ulid: string): string {
  if (!ULID_REGEX.test(ulid)) {
    throw new Error(
      `milestoneIdFromUlid: "${ulid}" is not a well-formed minted id (\`fr_\` + 26 Crockford base32 chars)`,
    );
  }
  const id = `M_${ulid.slice(23, 29)}`;
  if (!isMilestoneToken(id)) {
    throw new Error(
      `milestoneIdFromUlid: minted id "${ulid}" does not derive a well-formed \`M_<key>\` milestone id (got "${id}")`,
    );
  }
  return id;
}

/**
 * The canonical UUID shape a Linear milestone identifier arrives in:
 * `8-4-4-4-12` hex groups. The gate is a SHAPE check, not a version check —
 * the identifier is opaque and belongs to the tracker.
 */
const LINEAR_MILESTONE_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * STE-539 AC-STE-539.3 — Linear milestone-id derivation, the tracker-first
 * sibling of `milestoneIdFromEpicKey` and `milestoneIdFromUlid`, feeding the
 * SAME opaque `M_<key>` branch of the union grammar (no grammar change:
 * `EPIC_KEY_SOURCE` already admits a 6-char hex head, so `M_550e84` parses).
 *
 * The key is the LEADING six hex characters of the identifier the tracker
 * allocated — `uuid.slice(0, 6)`. Deliberately NOT the ULID sibling's
 * `slice(23, 29)` offsets: those exist because minted ULIDs are monotonic and
 * share their leading characters within a millisecond, which is a fact about
 * `ulid.ts` and not about a tracker-assigned UUID. Index 23 of a UUID is a
 * group separator, so the borrowed offsets would sanitize to the malformed
 * `M__44665` — a token with a `_` key head, which the union grammar rejects.
 *
 * Throws when the input is not UUID-shaped, or when the derived token is
 * malformed under the union grammar — mirroring both siblings'
 * never-a-silent-bad-id contract.
 */
export function milestoneIdFromLinearMilestone(uuid: string): string {
  if (!LINEAR_MILESTONE_UUID_RE.test(uuid)) {
    throw new Error(
      `milestoneIdFromLinearMilestone: "${uuid}" is not a well-formed Linear milestone identifier (8-4-4-4-12 hex)`,
    );
  }
  const id = `M_${uuid.slice(0, 6)}`;
  if (!isMilestoneToken(id)) {
    throw new Error(
      `milestoneIdFromLinearMilestone: milestone identifier "${uuid}" does not derive a well-formed \`M_<key>\` milestone id (got "${id}")`,
    );
  }
  return id;
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

/**
 * STE-586 AC-STE-586.11 — the ONE milestone-title normalizer both mint
 * modules join on. NFC first (decomposed and precomposed spellings meet),
 * then every whitespace/glyph rule INHERITED from `normalizeTitleForCompare`
 * (never re-written here), then an explicit en-US case fold LAST — a bare
 * `toLowerCase` folds `I` differently under a Turkish-locale runtime.
 */
export function normalizeMilestoneTitle(t: string): string {
  return normalizeTitleForCompare(t.normalize("NFC")).toLocaleLowerCase("en-US");
}

/**
 * STE-586 — the ONE equality both mint find legs match on: the rows whose
 * `name` normalizes equal to `title`, BOTH sides through
 * `normalizeMilestoneTitle`. Returned as a list so each caller tells the three
 * outcomes apart — one joins; zero creates or, under join, refuses; two or
 * more are ambiguous and refuse.
 */
export function matchMilestoneTitle<T extends { readonly name: string }>(rows: readonly T[], title: string): T[] {
  const wanted = normalizeMilestoneTitle(title);
  return rows.filter((row) => normalizeMilestoneTitle(row.name) === wanted);
}

/**
 * STE-608 — one listed Jira Epic, as the decision reads it. `statusCategory`
 * is Jira's `status.statusCategory.key` (`new` | `indeterminate` | `done`).
 */
export interface JiraDecisionRow {
  readonly key: string;
  readonly name: string;
  readonly statusCategory?: string;
  readonly labels?: readonly string[];
}

/** STE-608 — one listed Linear project milestone, as the decision reads it. */
export interface LinearDecisionRow {
  readonly id?: string;
  readonly name: string;
}

/**
 * STE-608 AC-STE-608.1 — the decision's input. The mode, the project, the
 * rows the session ENUMERATED, and exactly one of a human title or a join
 * key. There is deliberately no provider and no path field: the decision
 * reads what it is handed and nothing else.
 */
export type MilestoneMintDecisionInput =
  | {
      readonly mode: "jira";
      readonly project: string;
      readonly rows: readonly JiraDecisionRow[];
      readonly title?: string;
      readonly joinKey?: string;
    }
  | {
      readonly mode: "linear";
      readonly project: string;
      readonly rows: readonly LinearDecisionRow[];
      readonly title?: string;
      readonly joinKey?: string;
    };

/**
 * The act a mint performs. A create names every closed key the title leg
 * excluded; a join names how it was found, the container key and its title.
 */
export type MilestoneMintDecision =
  | { readonly act: "create"; readonly excluded?: readonly string[] }
  | {
      readonly act: "join";
      readonly via: "key" | "title";
      readonly key: string;
      readonly name: string;
      /** STE-608 AC-STE-608.9 — Jira only: the joined Epic's labels as listed. */
      readonly labels?: readonly string[];
    };

function decisionRefusal(verdict: string, remedy: string, context: string): Error {
  return new Error([`Refusing: ${verdict}`, `Remedy: ${remedy}`, `Context: ${context}`].join("\n"));
}

/**
 * STE-608 AC-STE-608.1 — the ONE pure decision both mints and the gate spec
 * consult: create, or join by key, or join by title. No I/O, no provider.
 * Throws an NFR-10 refusal when the input or the listing cannot decide.
 */
export function decideMilestoneMint(input: MilestoneMintDecisionInput): MilestoneMintDecision {
  const { mode, project } = input;
  const title = input.title !== undefined && input.title !== "" ? input.title : undefined;
  const joinKey = input.joinKey !== undefined && input.joinKey !== "" ? input.joinKey : undefined;
  const context = `mode=${mode}, project=${project}, phase=milestone-mint-decision`;

  if ((title === undefined) === (joinKey === undefined)) {
    const both = title !== undefined;
    throw decisionRefusal(
      both
        ? `to decide a milestone mint in project ${project} from both a title and a join key — the two can name different containers.`
        : `to decide a milestone mint in project ${project} without a title or a join key — there is nothing to create or join.`,
      "pass exactly one: the human title (to create, or join by title) or the existing container's key (to join by key).",
      `${context}, title=${title === undefined ? "absent" : "present"}, join_key=${joinKey === undefined ? "absent" : "present"}`,
    );
  }

  const rows = mode === "jira"
    ? input.rows.map((r) => ({
        key: r.key as string | undefined,
        name: r.name,
        closed: r.statusCategory === "done",
        labels: Array.isArray(r.labels) ? (r.labels as readonly string[]) : undefined,
      }))
    : input.rows.map((r) => ({ key: r.id, name: r.name, closed: false, labels: undefined as readonly string[] | undefined }));

  // STE-608 AC-STE-608.9 — a Jira join carries the joined Epic's labels as
  // listed; the label merge cannot be computed from a set that was never read.
  const join = (hit: (typeof rows)[number], via: "key" | "title"): MilestoneMintDecision => {
    if (mode !== "jira") return { act: "join", via, key: hit.key!, name: hit.name };
    if (hit.labels === undefined) {
      throw decisionRefusal(
        `to join Epic ${hit.key} in project ${project} — its listed row carries no labels field, so the milestone label merge cannot be computed from an unread set.`,
        "enumerate the project's Epics again with each row's labels field, then decide again.",
        `${context}, via=${via}, key=${hit.key}, labels=absent`,
      );
    }
    return { act: "join", via, key: hit.key!, name: hit.name, labels: hit.labels };
  };

  if (mode === "jira") {
    const unknown = input.rows.filter((r) => typeof r.statusCategory !== "string" || r.statusCategory === "");
    if (unknown.length > 0) {
      throw decisionRefusal(
        `to decide a milestone mint in project ${project} — ${unknown.length} listed row(s) carry no status, so the listing cannot tell open from closed: ${unknown.map((r) => r.key ?? "<no identifier>").join(", ")}.`,
        "enumerate the project's Epics again with each row's status category (status.statusCategory.key), then decide again.",
        `${context}, rows=${rows.length}, rows_without_status=${unknown.length}`,
      );
    }
  }

  if (joinKey !== undefined) {
    let hits: typeof rows;
    if (mode === "jira") {
      hits = rows.filter((r) => r.key === joinKey);
    } else if (/^M_/.test(joinKey)) {
      hits = rows.filter((r) => {
        try {
          return r.key !== undefined && milestoneIdFromLinearMilestone(r.key) === joinKey;
        } catch {
          return false;
        }
      });
    } else {
      hits = rows.filter((r) => r.key !== undefined && r.key.toLowerCase() === joinKey.toLowerCase());
    }
    if (hits.length === 0) {
      throw decisionRefusal(
        `to join milestone container ${joinKey} in project ${project} — no listed row carries that key.`,
        "check the key against the container listing, or enumerate the project again — a join by key never falls through to create.",
        `${context}, via=key, join_key=${joinKey}, rows=${rows.length}`,
      );
    }
    if (hits.length > 1) {
      throw decisionRefusal(
        `to join milestone container ${joinKey} in project ${project} — ${hits.length} listed rows derive that key: ${hits.map((h) => h.key).join(", ")}.`,
        "join by the full milestone identifier instead of the short token.",
        `${context}, via=key, join_key=${joinKey}`,
      );
    }
    const hit = hits[0]!;
    if (hit.closed) {
      throw decisionRefusal(
        `to join milestone container ${hit.key} in project ${project} — it is closed (status category done).`,
        `reopen ${hit.key} in the tracker first, then decide again — a join never lands in a closed container.`,
        `${context}, via=key, join_key=${joinKey}, status_category=done`,
      );
    }
    return join(hit, "key");
  }

  const matches = matchMilestoneTitle(rows, title!);
  const excluded = matches.filter((r) => r.closed).map((r) => r.key!);
  const open = matches.filter((r) => !r.closed);
  if (open.length === 0) return excluded.length > 0 ? { act: "create", excluded } : { act: "create" };
  if (open.length > 1) {
    const candidates = open.map((r) => `${r.key ?? "<no identifier>"} "${r.name}"`).join(", ");
    throw decisionRefusal(
      `to decide milestone "${title}" in project ${project} — ${open.length} existing containers normalize to the same title: ${candidates}.`,
      "rename one of them in the tracker so their titles no longer normalize equal, or join a specific one by its key instead of by title.",
      `${context}, via=title, normalized=${normalizeMilestoneTitle(title!)}`,
    );
  }
  const hit = open[0]!;
  if (hit.key === undefined) {
    throw decisionRefusal(
      `to join milestone "${title}" in project ${project} — the matching row carries no identifier.`,
      "enumerate the project's milestones with their identifiers, then decide again.",
      `${context}, via=title`,
    );
  }
  return join(hit, "title");
}

/** STE-608 — what a mint's find leg enumerated: the decision input without its title or join key. */
export type MilestoneMintListing =
  | { readonly mode: "jira"; readonly project: string; readonly rows: readonly JiraDecisionRow[] }
  | { readonly mode: "linear"; readonly project: string; readonly rows: readonly LinearDecisionRow[] };

/**
 * STE-608 AC-STE-608.1 + AC-STE-608.8 — a mint's find leg under an APPROVED
 * decision, shared by both mints. Consults `decideMilestoneMint` (a join by key
 * decides by that key, anything else by the title) and compares the verdict
 * with the approval:
 *
 *   - the key the mint binds — an approved join the listing confirms, or an
 *     approved create whose own earlier attempt landed (`createAttempted`: a
 *     hit on a RETRY is this call's create surviving a timeout, AC-STE-522.10);
 *   - `{ mismatch }` — the listing decides an act the approval never saw (a
 *     join on the first attempt of a create, another key, or no join at all).
 *     PERMANENT — re-listing returns the same page — so the mint returns it
 *     out of the retry and refuses once, with zero writes;
 *   - `null` — an approved create the listing agrees with: go create.
 */
export function reconcileApprovedMint(
  listing: MilestoneMintListing,
  title: string,
  expected: MilestoneMintDecision,
  createAttempted: boolean,
): string | { mismatch: string | null } | null {
  const decision = decideMilestoneMint(
    expected.act === "join" && expected.via === "key" ? { ...listing, joinKey: expected.key } : { ...listing, title },
  );
  if (decision.act === "join") {
    if (expected.act === "create") return createAttempted ? decision.key : { mismatch: decision.key };
    return decision.key === expected.key ? decision.key : { mismatch: decision.key };
  }
  return expected.act === "join" ? { mismatch: null } : null;
}

/**
 * STE-608 AC-STE-608.8 — the NFR-10 refusal both mints raise on a
 * `reconcileApprovedMint` mismatch. `container` is what the mint makes
 * (`milestone Epic`), `noun` the short name the find leg reports (`Epic`).
 */
export function approvedMintMismatchRefusal(args: {
  mode: "jira" | "linear";
  phase: string;
  container: string;
  noun: string;
  title: string;
  project: string;
  expected: MilestoneMintDecision;
  found: string | null;
}): Error {
  const { mode, phase, container, noun, title, project, expected, found } = args;
  const approved = expected.act === "join" ? `join ${expected.key}` : "create";
  const yielded = found === null ? `no joinable ${noun}` : `existing ${noun} ${found}`;
  return decisionRefusal(
    `to mint ${container} "${title}" in project ${project} — the approved act was ${approved}, but the find leg yielded ${yielded}.`,
    "re-run the mint decision against the current listing and approve the act it names — a mint never performs an act other than the approved one.",
    `mode=${mode}, phase=${phase}, expect=${expected.act}, found=${found ?? "none"}`,
  );
}
