// token_usage — per-skill token-usage capture layer (STE-344).
//
// AC-STE-344.1 — ledger schema + location. An append-only JSONL ledger at
// `<projectRoot>/.dev-process/token-ledger.jsonl`; each line is one
// `token-ledger/v1` aggregate for a `(session_id, skill, model)` triple,
// where `skill` is the transcript's `attributionSkill` string or the
// literal sentinel `(main-loop)`.
//
// Write semantics (`writeSessionRows`): read ledger → drop rows matching
// `session_id` → append fresh rows → write. Append-only across sessions,
// replace within a session (so a SessionEnd re-fire never duplicates).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Schema discriminator carried on every ledger line. */
export const TOKEN_LEDGER_SCHEMA = "token-ledger/v1";

/** One `token-ledger/v1` JSONL line — an aggregate per (session, skill, model). */
export interface TokenLedgerRow {
  schema: string;
  ts: string;
  session_id: string;
  git_branch: string;
  skill: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  message_count: number;
  /** Tracker ID of the FR that claimed this row (brainstorm→FR bridging, STE-345). */
  claimed_by?: string;
}

/** Fixed ledger location: `<projectRoot>/.dev-process/token-ledger.jsonl`. */
export function ledgerPath(projectRoot: string): string {
  return join(projectRoot, ".dev-process", "token-ledger.jsonl");
}

/**
 * Persist one session's aggregates: read the ledger, drop any rows already
 * recorded for `sessionId`, append the fresh rows, and write the file back.
 * Rows from other sessions are preserved verbatim (append-only across
 * sessions, replace within a session).
 */
export function writeSessionRows(
  projectRoot: string,
  sessionId: string,
  rows: TokenLedgerRow[],
): void {
  const path = ledgerPath(projectRoot);

  let existing: TokenLedgerRow[] = [];
  if (existsSync(path)) {
    existing = readFileSync(path, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TokenLedgerRow)
      .filter((row) => row.session_id !== sessionId);
  }

  const next = [...existing, ...rows];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    next.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

/**
 * Fail-open ledger read: `[]` when the ledger is absent or unreadable;
 * malformed lines are skipped. `sawMalformed` (when provided) is set so
 * callers that rewrite the ledger can decline to persist over garbage.
 */
export function readLedgerRows(
  projectRoot: string,
  state?: { sawMalformed?: boolean },
): TokenLedgerRow[] {
  const path = ledgerPath(projectRoot);
  if (!existsSync(path)) return [];

  let body: string;
  try {
    body = readFileSync(path, "utf-8");
  } catch {
    return [];
  }

  const rows: TokenLedgerRow[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line) as TokenLedgerRow);
    } catch {
      if (state) state.sawMalformed = true;
    }
  }
  return rows;
}

/** Rewrite the whole ledger file from `rows` (claim-persistence path). */
export function rewriteLedgerRows(
  projectRoot: string,
  rows: TokenLedgerRow[],
): void {
  const path = ledgerPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

/** Sentinel `skill` value for transcript lines carrying no attributionSkill. */
const MAIN_LOOP_SENTINEL = "(main-loop)";

/** The four `message.usage` counters accumulated into every ledger row. */
const TOKEN_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

/** Read a numeric usage field, treating anything non-numeric as 0. */
function tokenField(usage: Record<string, unknown>, field: string): number {
  const value = usage[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Pure transcript parser (AC-STE-344.2) — group assistant-turn usage by
 * `(attributionSkill ?? "(main-loop)") × message.model`.
 *
 * Reads the JSONL transcript and, for every line carrying `message.usage`,
 * accumulates the four token fields into a bucket keyed by
 * `(attributionSkill ?? "(main-loop)", message.model)`; returns one row per
 * non-empty bucket with `message_count` set to the number of contributing
 * lines.
 *
 * Fail-open (same posture as `templates/hooks/_lib/session.ts`): a missing,
 * unreadable, or whitespace-only transcript returns `[]`; malformed
 * individual lines are skipped, never thrown.
 */
export function parseTranscriptTokenUsage(
  transcriptPath: string,
): TokenLedgerRow[] {
  if (!existsSync(transcriptPath)) {
    return [];
  }

  let body: string;
  try {
    body = readFileSync(transcriptPath, "utf-8");
  } catch {
    return [];
  }
  if (body.trim() === "") {
    return [];
  }

  const buckets = new Map<string, TokenLedgerRow>();

  for (const rawLine of body.split("\n")) {
    if (rawLine.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue; // malformed line — skip, never throw
    }
    if (typeof parsed !== "object" || parsed === null) continue;

    const entry = parsed as Record<string, unknown>;
    const message = entry.message;
    if (typeof message !== "object" || message === null) continue;

    const { model, usage } = message as Record<string, unknown>;
    if (typeof model !== "string") continue;
    if (typeof usage !== "object" || usage === null) continue;

    const usageRecord = usage as Record<string, unknown>;
    const skill =
      typeof entry.attributionSkill === "string"
        ? entry.attributionSkill
        : MAIN_LOOP_SENTINEL;

    const key = `${skill}\u0000${model}`;
    let row = buckets.get(key);
    if (!row) {
      row = {
        schema: TOKEN_LEDGER_SCHEMA,
        ts:
          typeof entry.timestamp === "string"
            ? entry.timestamp
            : new Date().toISOString(),
        session_id: typeof entry.sessionId === "string" ? entry.sessionId : "",
        git_branch: typeof entry.gitBranch === "string" ? entry.gitBranch : "",
        skill,
        model,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        message_count: 0,
      };
      buckets.set(key, row);
    }

    for (const field of TOKEN_FIELDS) {
      row[field] += tokenField(usageRecord, field);
    }
    row.message_count += 1;
  }

  return [...buckets.values()];
}
