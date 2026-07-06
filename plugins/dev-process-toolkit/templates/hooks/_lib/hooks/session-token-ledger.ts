// STE-344 — session token-ledger capture hook (per-hook entrypoint).
//
// Fired on SessionEnd (Stop wired as an equivalent trigger). Parses
// `transcript_path` from the stdin hook JSON (STE-290 contract), aggregates
// the session's per-(skill, model) token usage, and writes it to the ledger —
// replacing any rows already recorded for this session_id, so a re-fire never
// appends duplicates. Fail-open: any parse/IO error exits 0 with no write and
// no stderr gate.

import {
  parseTranscriptTokenUsage,
  writeSessionRows,
} from "../../../../adapters/_shared/src/token_usage.ts";
import { parseHookPayload } from "../session.ts";

try {
  const stdin = await Bun.stdin.text();
  const payload = parseHookPayload(stdin);
  if (!payload) {
    process.exit(0);
  }

  const rows = parseTranscriptTokenUsage(payload.transcript_path);
  if (rows.length > 0) {
    // The payload's session_id is authoritative for the replace key.
    const sessionId =
      typeof payload.session_id === "string" ? payload.session_id : "";
    for (const row of rows) {
      row.session_id = sessionId;
    }
    const projectRoot =
      typeof payload.cwd === "string" && payload.cwd !== ""
        ? payload.cwd
        : process.cwd();
    writeSessionRows(projectRoot, sessionId, rows);
  }
} catch {
  // fail-open by design — never block session teardown
}
process.exit(0);
