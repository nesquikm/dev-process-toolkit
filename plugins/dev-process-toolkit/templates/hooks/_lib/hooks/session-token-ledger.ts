// STE-344 — session token-ledger capture hook (per-hook entrypoint).
//
// Fired on SessionEnd (Stop wired as an equivalent trigger). Parses
// `transcript_path` from the stdin hook JSON (STE-290 contract), aggregates
// the session's per-(skill, model) token usage, and writes it to the ledger —
// replacing any rows already recorded for this session_id, so a re-fire never
// appends duplicates. Fail-open: any parse/IO error exits 0 with no write and
// no stderr gate.
//
// STE-717 — the same entrypoint folds the session transcript into a tool-call
// timeline at `toolCallTimelinePath(<checkout root>, session_id)`, opt-in and
// per user: only when `tracking.tool_calls` is on at the checkout root AND
// `captureStatus` reports `registration: current`. A Node-built-ins-only fast
// path runs first, so a default tree loads no fold module. The token ledger's
// own path is unchanged.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readTokenStatsConfig } from "../../../../adapters/_shared/src/token_stats_config.ts";
import {
  parseTranscriptTokenUsage,
  writeSessionRows,
} from "../../../../adapters/_shared/src/token_usage.ts";
import { findCheckoutRoot, parseHookPayload, type HookPayload } from "../session.ts";

const SRC = resolve(import.meta.dir, "..", "..", "..", "..", "adapters", "_shared", "src");

/** True when `file` exists and its bytes contain `needle` (Node built-ins only). */
function holds(file: string, needle: string): boolean {
  try {
    return existsSync(file) && readFileSync(file, "utf-8").includes(needle);
  } catch {
    return false;
  }
}

/** STE-717 — the fold. Fail-open: any error writes nothing more and stays silent. */
async function foldTimeline(payload: HookPayload): Promise<void> {
  const root = findCheckoutRoot(payload.cwd);
  if (root === null) return;
  // Fast path — before any dynamic import.
  if (!holds(join(root, "specs", "settings.yaml"), "tool_calls")) return;
  if (!holds(join(root, ".claude", "settings.local.json"), "tool-call-capture.sh")) return;
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";

  // `captureStatus` reads the switch through `toolCallsSwitchOn` (project_settings.ts,
  // already loaded by the token ledger), and reports `current` only when it is on.
  const { captureStatus } = (await import(join(SRC, "capture_registration.ts"))) as {
    captureStatus: (r: string) => { registration: string };
  };
  if (captureStatus(root).registration !== "current") return;

  const { toolCallTimelinePath } = (await import(join(SRC, "dpt_paths.ts"))) as {
    toolCallTimelinePath: (r: string, s: string) => string;
  };
  const out = toolCallTimelinePath(root, sessionId); // refuses an unsafe id
  const text = readFileSync(payload.transcript_path, "utf-8");
  const { buildTimeline } = (await import(join(SRC, "tool_call_timeline.ts"))) as {
    buildTimeline: (t: string, r: string, s: string | null) => Promise<unknown>;
  };
  const timeline = await buildTimeline(text, root, sessionId);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(timeline, null, 2)}\n`);
}

/** The v3.0.0 token ledger, unchanged; `return` stands where it exited. */
function tokenLedger(payload: HookPayload): void {
  const projectRoot =
    typeof payload.cwd === "string" && payload.cwd !== ""
      ? payload.cwd
      : process.cwd();

  // STE-379 AC-STE-379.1 — gate on the project's `## Token Stats` enabled flag
  // (default OFF). A missing/unreadable CLAUDE.md or a malformed section makes
  // readTokenStatsConfig throw; that throw lands in the existing fail-open
  // catch below (no write, exit 0) — the gate is fail-off AND fail-open.
  if (!readTokenStatsConfig(join(projectRoot, "CLAUDE.md")).enabled) {
    return;
  }

  const rows = parseTranscriptTokenUsage(payload.transcript_path);
  if (rows.length > 0) {
    // The payload's session_id is authoritative for the replace key.
    const sessionId =
      typeof payload.session_id === "string" ? payload.session_id : "";
    for (const row of rows) {
      row.session_id = sessionId;
    }
    writeSessionRows(projectRoot, sessionId, rows);
  }
}

let payload: HookPayload | null = null;
try {
  payload = parseHookPayload(await Bun.stdin.text());
  if (!payload) {
    process.exit(0);
  }
  tokenLedger(payload);
} catch (e) {
  // fail-open by design — never block session teardown. A settings-file
  // refusal is still reported (review #4): the ledger must never stop silently
  // on a specs/settings.yaml it refuses. A legacy CLAUDE.md error stays silent,
  // as in v2.101.5.
  if (e instanceof Error && e.name === "SettingsShapeError") {
    process.stderr.write(`session-token-ledger: no rows written.\n${e.message}\n`);
  }
}
if (payload) {
  try {
    await foldTimeline(payload);
  } catch {
    // fail-open by design — the fold never blocks session teardown.
  }
}
process.exit(0);
