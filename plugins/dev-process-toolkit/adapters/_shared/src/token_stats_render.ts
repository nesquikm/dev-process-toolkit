// token_stats_render — render half of the per-skill token-usage feature
// (STE-345 FR block + STE-346 milestone rollup).
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

/** One aggregated (label, model) table row — label is a skill or a rollup bucket. */
type LabeledRow = TokenCounts & { label: string; model: string };

/** Aggregate ledger rows into one table row per (label, model) bucket. */
function aggregateByLabelModel(
  rows: TokenLedgerRow[],
  labelOf: (row: TokenLedgerRow) => string,
): LabeledRow[] {
  const buckets = new Map<string, LabeledRow>();

  // NUL-separated composite key below — same idiom as token_usage.ts buckets.
  for (const row of rows) {
    const label = labelOf(row);
    const key = `${label}\u0000${row.model}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { label, model: row.model, ...zeroTokenCounts() };
      buckets.set(key, bucket);
    }
    addTokenCounts(bucket, row);
  }

  return [...buckets.values()];
}

/** Format one markdown table line from its cells. */
function tableLine(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * Shared fenced-block scaffold for both renderers: sentinel pair around the
 * `## Token Stats` heading and a markdown table (label column + model + the
 * four token columns), closed by a summary row carrying the column sums.
 * Deterministic given pre-sorted rows: same rows in, same bytes out.
 */
function renderFencedTable(
  labelHeader: string,
  tableRows: LabeledRow[],
  summaryLabel: string,
): string {
  const summary = zeroTokenCounts();
  for (const row of tableRows) {
    addTokenCounts(summary, row);
  }

  const lines: string[] = [
    TOKEN_STATS_BEGIN,
    "",
    TOKEN_STATS_HEADING,
    "",
    tableLine([
      labelHeader,
      "model",
      "input",
      "output",
      "cache-read",
      "cache-creation",
    ]),
    tableLine(["---", "---", "---:", "---:", "---:", "---:"]),
    ...tableRows.map((row) =>
      tableLine([
        row.label,
        row.model,
        ...TOKEN_COLUMNS.map((column) => String(row[column])),
      ]),
    ),
    tableLine([
      summaryLabel,
      "",
      ...TOKEN_COLUMNS.map((column) => String(summary[column])),
    ]),
    "",
    TOKEN_STATS_END,
  ];

  return lines.join("\n") + "\n";
}

/**
 * Pure renderer (AC-STE-345.1): ledger rows → the fenced `## Token Stats`
 * block. Per-skill × per-model rows are kept separate (so e.g. `brainstorm`
 * and `spec-write` each get their own line) and a trailing `subtotal` row
 * carries the column sums. Deterministic: same rows in, same bytes out.
 */
export function renderTokenStatsBlock(rows: TokenLedgerRow[]): string {
  // Deterministic order (byte-stable render): sort by skill, then model.
  const tableRows = aggregateByLabelModel(rows, (row) => row.skill).sort(
    (a, b) => a.label.localeCompare(b.label) || a.model.localeCompare(b.model),
  );

  return renderFencedTable("skill", tableRows, "subtotal");
}

/**
 * Shared idempotent fenced-upsert mechanics for both body upserts: when the
 * body already carries a sentinel-fenced Token Stats region, the fenced
 * bytes from `<!-- token-stats:begin -->` through `<!-- token-stats:end -->`
 * are swapped for the fresh `block` render **in place** (everything outside
 * is byte-preserved). When absent, the block is appended after the final
 * section, separated by one blank line. Re-rendering never yields a second
 * block: upsert(upsert(body)) === upsert(body).
 */
function upsertFencedBlock(body: string, block: string): string {
  // The fenced region proper: begin marker through end marker, inclusive
  // (the renderers append one trailing newline after the end marker, which
  // belongs to the surrounding body, not the region).
  const region = block.slice(
    0,
    block.lastIndexOf(TOKEN_STATS_END) + TOKEN_STATS_END.length,
  );

  const begin = body.indexOf(TOKEN_STATS_BEGIN);
  const end = body.indexOf(TOKEN_STATS_END);

  if (begin !== -1 && end > begin) {
    // Replace the existing fenced region in place; bytes outside it are
    // untouched.
    return (
      body.slice(0, begin) + region + body.slice(end + TOKEN_STATS_END.length)
    );
  }

  // Insert: append as the last section, one blank line after the body.
  return body.replace(/\n*$/, "") + "\n\n" + block;
}

/**
 * Idempotent FR-body upsert (AC-STE-345.2): shared `upsertFencedBlock`
 * mechanics over the FR render — an existing fenced region is re-rendered
 * in place (bytes outside preserved verbatim); when absent, the block lands
 * after the final section (`## Notes` is last by template).
 */
export function upsertTokenStatsBlock(
  frBody: string,
  rows: TokenLedgerRow[],
): string {
  return upsertFencedBlock(frBody, renderTokenStatsBlock(rows));
}

/** Skill name whose detached rows are eligible for FR bridging. */
const BRAINSTORM_SKILL = "dev-process-toolkit:brainstorm";

/** Milestone-rollup bucket for brainstorm rows never claimed by any FR. */
const DESIGN_BUCKET = "design/exploration";

/** Ledger `skill` value for unattributed orchestrator (main-loop) rows. */
const MAIN_LOOP_LABEL = "(main-loop)";

/** Options for the milestone rollup renderers (AC-STE-346.2). */
export interface MilestoneRollupOptions {
  /** In-scope FR ids in plan order — pins the subtotal-row ordering. */
  frOrder: string[];
}

/**
 * Milestone bucket for one ledger row: the claiming FR when `claimed_by` is
 * set; the `design/exploration` bucket for unclaimed brainstorm rows
 * (AC-STE-346.3); otherwise the skill itself — which keeps `(main-loop)`
 * orchestrator rows on their own line.
 */
function rollupLabel(row: TokenLedgerRow): string {
  if (row.claimed_by !== undefined) return row.claimed_by;
  if (row.skill === BRAINSTORM_SKILL) return DESIGN_BUCKET;
  return row.skill;
}

/** Sort group for a rollup bucket: FRs (plan order) → other → main-loop → design. */
function rollupGroup(label: string, frOrder: string[]): number {
  if (frOrder.includes(label)) return 0;
  if (label === MAIN_LOOP_LABEL) return 2;
  if (label === DESIGN_BUCKET) return 3;
  return 1;
}

/**
 * Pure milestone-rollup renderer (AC-STE-346.2): ledger rows → the fenced
 * `## Token Stats` rollup for `specs/plan/M<N>.md`. One subtotal line per
 * in-scope FR × model (FR attribution via `claimed_by`), a `(main-loop)`
 * line per model for unattributed orchestrator rows, a `design/exploration`
 * line for brainstorm rows never claimed by any FR, and a trailing milestone
 * `total` row. Deterministic: same rows in, same bytes out.
 */
export function renderMilestoneRollup(
  rows: TokenLedgerRow[],
  opts: MilestoneRollupOptions,
): string {
  const { frOrder } = opts;

  // Deterministic order (byte-stable render): FR subtotals in `frOrder`,
  // then any other buckets, then `(main-loop)`, then `design/exploration`;
  // per-model lines sorted within each bucket.
  const tableRows = aggregateByLabelModel(rows, rollupLabel).sort(
    (a, b) =>
      rollupGroup(a.label, frOrder) - rollupGroup(b.label, frOrder) ||
      frOrder.indexOf(a.label) - frOrder.indexOf(b.label) ||
      a.label.localeCompare(b.label) ||
      a.model.localeCompare(b.model),
  );

  return renderFencedTable("scope", tableRows, "total");
}

/**
 * Idempotent plan-body upsert (AC-STE-346.2/.4): shared `upsertFencedBlock`
 * mechanics over the rollup render — an existing sentinel-fenced region is
 * re-rendered **in place** (bytes outside it preserved verbatim); when
 * absent, the block is appended after the plan's final section, one blank
 * line separated. Never a second block. Pure: writing the result to disk is
 * the caller's explicit, staged act.
 */
export function upsertMilestoneRollup(
  planBody: string,
  rows: TokenLedgerRow[],
  opts: MilestoneRollupOptions,
): string {
  return upsertFencedBlock(planBody, renderMilestoneRollup(rows, opts));
}

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
 * persist the `claimed_by` marks back to `.dpt/ledger/token-ledger.jsonl` so
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
