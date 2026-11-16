// run_start_ledger — STE-811: the read side of the STE-810 run-start ledger.
//
// Node built-ins plus ./dpt_paths only, so the SessionEnd/Stop token-ledger hook
// can read a session's run starts without loading the snapshot side
// (capture registration, the settings loader, the proposal table) that
// ./run_start pulls in — the STE-717 fold's fast path promises a default tree
// loads none of those.

import { existsSync, readFileSync } from "node:fs";

import { runStartLedgerPath } from "./dpt_paths";

export const RUN_START_SCHEMA = "dpt-run-start/1";

export interface RunStartRow {
  schema: typeof RUN_START_SCHEMA;
  session_id: string;
  /** The full `dev-process-toolkit:<name>` skill string. */
  skill: string;
  fr: string | null;
  /** ISO-8601, verbatim from the caller. */
  started_at: string;
  settings_hash: string | null;
  settings: Record<string, unknown>;
  plugin_version: string | null;
  registration: string | null;
}

/** Every run-start row in the ledger, or only `session`'s when given. */
export function readRunStarts(root: string, session?: string): RunStartRow[] {
  const file = runStartLedgerPath(root);
  if (!existsSync(file)) return [];
  const rows: RunStartRow[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    // A JSON line that is not a run-start row is skipped, never thrown on.
    if (parsed === null || typeof parsed !== "object" || (parsed as { schema?: unknown }).schema !== RUN_START_SCHEMA) continue;
    rows.push(parsed as RunStartRow);
  }
  return session === undefined ? rows : rows.filter((r) => r.session_id === session);
}
