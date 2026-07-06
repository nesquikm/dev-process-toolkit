// token_stats_render — render half of the per-skill token-usage feature
// (STE-345).
//
// AC-STE-345.1 — block shape. A `## Token Stats` section fenced by literal
// `<!-- token-stats:begin -->` / `<!-- token-stats:end -->` markers, placed
// last in the FR body. Between the fences is a per-skill × per-model
// markdown table (columns: skill, model, input, output, cache-read,
// cache-creation) with per-row values kept separate plus a `subtotal` row;
// the render is byte-stable for a given ledger input.

import {
  readLedgerRows,
  rewriteLedgerRows,
  type TokenLedgerRow,
} from "./token_usage";

/** Literal sentinel opening the fenced Token Stats region. */
export const TOKEN_STATS_BEGIN = "<!-- token-stats:begin -->";

/** Literal sentinel closing the fenced Token Stats region. */
export const TOKEN_STATS_END = "<!-- token-stats:end -->";

/** Section heading rendered inside the fenced region. */
export const TOKEN_STATS_HEADING = "## Token Stats";

/** The four token columns rendered (and summed into `subtotal`). */
const TOKEN_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

/** The four token counters, keyed by column name. */
type TokenCounts = Record<(typeof TOKEN_COLUMNS)[number], number>;

/** Fresh all-zero counter set. */
function zeroTokenCounts(): TokenCounts {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

/** Accumulate `source`'s four token columns into `target`. */
function addTokenCounts(target: TokenCounts, source: TokenCounts): void {
  for (const column of TOKEN_COLUMNS) {
    target[column] += source[column];
  }
}

/** One aggregated (skill, model) table row. */
type TableRow = TokenCounts & { skill: string; model: string };

/** Aggregate ledger rows into one table row per (skill, model) pair. */
function aggregateBySkillModel(rows: TokenLedgerRow[]): TableRow[] {
  const buckets = new Map<string, TableRow>();

  // NUL-separated composite key below — same idiom as token_usage.ts buckets.
  for (const row of rows) {
    const key = `${row.skill}\u0000${row.model}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { skill: row.skill, model: row.model, ...zeroTokenCounts() };
      buckets.set(key, bucket);
    }
    addTokenCounts(bucket, row);
  }

  // Deterministic order (byte-stable render): sort by skill, then model.
  return [...buckets.values()].sort(
    (a, b) =>
      a.skill.localeCompare(b.skill) || a.model.localeCompare(b.model),
  );
}

/** Format one markdown table line from its cells. */
function tableLine(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * Pure renderer (AC-STE-345.1): ledger rows → the fenced `## Token Stats`
 * block. Per-skill × per-model rows are kept separate (so e.g. `brainstorm`
 * and `spec-write` each get their own line) and a trailing `subtotal` row
 * carries the column sums. Deterministic: same rows in, same bytes out.
 */
export function renderTokenStatsBlock(rows: TokenLedgerRow[]): string {
  const tableRows = aggregateBySkillModel(rows);

  const subtotal = zeroTokenCounts();
  for (const row of tableRows) {
    addTokenCounts(subtotal, row);
  }

  const lines: string[] = [
    TOKEN_STATS_BEGIN,
    "",
    TOKEN_STATS_HEADING,
    "",
    tableLine([
      "skill",
      "model",
      "input",
      "output",
      "cache-read",
      "cache-creation",
    ]),
    tableLine(["---", "---", "---:", "---:", "---:", "---:"]),
    ...tableRows.map((row) =>
      tableLine([
        row.skill,
        row.model,
        ...TOKEN_COLUMNS.map((column) => String(row[column])),
      ]),
    ),
    tableLine([
      "subtotal",
      "",
      ...TOKEN_COLUMNS.map((column) => String(subtotal[column])),
    ]),
    "",
    TOKEN_STATS_END,
  ];

  return lines.join("\n") + "\n";
}

/**
 * Idempotent FR-body upsert (AC-STE-345.2): when the body already carries a
 * sentinel-fenced Token Stats region, re-render it **in place** (the fenced
 * bytes from `<!-- token-stats:begin -->` through `<!-- token-stats:end -->`
 * are swapped for the fresh render; everything outside is byte-preserved).
 * When absent, append the block after the final section (`## Notes` is last
 * by template) separated by one blank line. Re-rendering never yields a
 * second block: upsert(upsert(body, rows), rows) === upsert(body, rows).
 */
export function upsertTokenStatsBlock(
  frBody: string,
  rows: TokenLedgerRow[],
): string {
  const block = renderTokenStatsBlock(rows);
  // The fenced region proper: begin marker through end marker, inclusive
  // (renderTokenStatsBlock appends one trailing newline after the end
  // marker, which belongs to the surrounding body, not the region).
  const region = block.slice(
    0,
    block.lastIndexOf(TOKEN_STATS_END) + TOKEN_STATS_END.length,
  );

  const begin = frBody.indexOf(TOKEN_STATS_BEGIN);
  const end = frBody.indexOf(TOKEN_STATS_END);

  if (begin !== -1 && end > begin) {
    // Replace the existing fenced region in place; bytes outside it are
    // untouched.
    return (
      frBody.slice(0, begin) +
      region +
      frBody.slice(end + TOKEN_STATS_END.length)
    );
  }

  // Insert: append as the last section, one blank line after the body.
  return frBody.replace(/\n*$/, "") + "\n\n" + block;
}

/** Skill name whose detached rows are eligible for FR bridging. */
const BRAINSTORM_SKILL = "dev-process-toolkit:brainstorm";

/** Selector options for `filterRowsForFR` (see AC-STE-345.6). */
export interface FilterRowsForFROptions {
  branch: string;
  sessionLineage: string[];
  brainstormClaim: string;
}

/**
 * Ledger-row selector for one FR (AC-STE-345.6).
 *
 * Selection rules:
 * - **Direct** — rows whose `session_id` is in `sessionLineage` (the FR's own
 *   sessions), unless already claimed by another FR.
 * - **Previously claimed** — rows with `claimed_by === brainstormClaim` stay
 *   attached to this FR, wherever they came from.
 * - **Bridging** — when no brainstorm row is attached yet, the most-recent
 *   **unclaimed** detached `brainstorm` session on the FR's branch is claimed:
 *   its rows are selected and marked `claimed_by = brainstormClaim` so no
 *   other FR double-counts them. Older / off-branch / non-brainstorm detached
 *   rows are left alone (they fall through to the milestone "design" bucket).
 */
export function filterRowsForFR(
  ledger: (TokenLedgerRow & { claimed_by?: string })[],
  opts: FilterRowsForFROptions,
): TokenLedgerRow[] {
  const { branch, sessionLineage, brainstormClaim } = opts;
  const lineage = new Set(sessionLineage);

  // Direct same-session rows + rows already claimed by this FR. A row
  // claimed by a *different* FR is never selected (no double-count).
  const selected = ledger.filter(
    (row) =>
      row.claimed_by === brainstormClaim ||
      (row.claimed_by === undefined && lineage.has(row.session_id)),
  );

  // Bridge a detached brainstorm only when none is attached yet (neither
  // same-session nor previously claimed) — bridging is a fallback.
  const hasBrainstorm = selected.some((row) => row.skill === BRAINSTORM_SKILL);
  if (!hasBrainstorm) {
    const candidates = ledger.filter(
      (row) =>
        row.skill === BRAINSTORM_SKILL &&
        row.git_branch === branch &&
        row.claimed_by === undefined &&
        !lineage.has(row.session_id),
    );

    // Most-recent unclaimed session wins (ISO-8601 `ts` compares
    // lexicographically); its rows are claimed, older sessions left alone.
    let bridgedSession: string | undefined;
    let bridgedTs = "";
    for (const row of candidates) {
      if (bridgedSession === undefined || row.ts > bridgedTs) {
        bridgedSession = row.session_id;
        bridgedTs = row.ts;
      }
    }
    if (bridgedSession !== undefined) {
      for (const row of candidates) {
        if (row.session_id === bridgedSession) {
          row.claimed_by = brainstormClaim;
          selected.push(row);
        }
      }
    }
  }

  return selected;
}

/**
 * Durable FR-row claim (AC-STE-345.6): read the ledger, select this FR's rows
 * via `filterRowsForFR`, and — when the bridging fallback claimed new rows —
 * persist the `claimed_by` marks back to `.dev-process/token-ledger.jsonl` so
 * no other FR double-counts them across separate runs. Fail-open: absent or
 * unreadable ledger returns `[]` with no write; a ledger containing malformed
 * lines is selected from but never rewritten (claims stay in-memory rather
 * than persisting over bytes we could not fully parse); no new claims ⇒ the
 * ledger bytes stay untouched.
 */
export function claimRowsForFR(
  projectRoot: string,
  opts: FilterRowsForFROptions,
): TokenLedgerRow[] {
  const state: { sawMalformed?: boolean } = {};
  const ledger = readLedgerRows(projectRoot, state);
  if (ledger.length === 0) return [];

  const claimedBefore = new Set(
    ledger.filter((row) => row.claimed_by !== undefined),
  );
  const selected = filterRowsForFR(ledger, opts);

  const newlyClaimed = ledger.some(
    (row) => row.claimed_by !== undefined && !claimedBefore.has(row),
  );
  if (newlyClaimed && !state.sawMalformed) {
    rewriteLedgerRows(projectRoot, ledger);
  }
  return selected;
}
