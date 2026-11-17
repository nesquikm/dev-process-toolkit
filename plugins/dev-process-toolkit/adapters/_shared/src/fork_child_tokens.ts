// STE-812 — forked child skills' tokens reach the ledger.
//
// A forked skill runs in its own transcript under
// `<dir>/<session>/subagents/agent-<id>.jsonl`, beside the parent transcript
// `<dir>/<session>.jsonl`. AC-STE-812.1: a child is read only when its
// `agent-<id>.forked-skill.json` names a string `skillName`, its
// `agent-<id>.jsonl` exists, and `<id>` is the `toolUseResult.agentId` of a
// parent line whose `toolUseResult.status` is `"forked"`.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { parseTranscriptTokenUsage, type TokenLedgerRow } from "./token_usage.ts";

/** An agent id names one file in `subagents/`; anything path-like is refused. */
const AGENT_ID = /^[A-Za-z0-9_-]+$/;

/** Parsed JSONL lines of `file`; unreadable files and malformed lines yield nothing. */
function jsonLines(file: string): Record<string, unknown>[] {
  let body: string;
  try {
    body = readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) out.push(parsed as Record<string, unknown>);
    } catch {
      // malformed line — skip
    }
  }
  return out;
}

/** The parent's `status: "forked"` Skill results, in order: agent id + the result line's timestamp. */
function forkedAgents(transcriptPath: string): { id: string; ts: unknown }[] {
  const out: { id: string; ts: unknown }[] = [];
  for (const line of jsonLines(transcriptPath)) {
    const result = line.toolUseResult;
    if (typeof result !== "object" || result === null) continue;
    const { status, agentId } = result as Record<string, unknown>;
    if (status !== "forked" || typeof agentId !== "string" || !AGENT_ID.test(agentId)) continue;
    if (!out.some((a) => a.id === agentId)) out.push({ id: agentId, ts: line.timestamp });
  }
  return out;
}

/** `file` parsed as a JSON object; null when it is unreadable, malformed or not an object. */
function jsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The marker's `skillName`, or null when the marker is missing, unreadable or names none. */
function markerSkill(file: string): string | null {
  const skill = jsonObject(file)?.skillName;
  return typeof skill === "string" ? skill : null;
}

/**
 * True only when the child's `meta.json` records `finished: true` (AC-STE-812.3). Missing,
 * unreadable or malformed all read false: a meta file nobody can read does not say the
 * child finished, so its tokens are kept and marked incomplete rather than dropped, which
 * would make the run's parent-only total look complete (PR #142 review).
 */
function finished(file: string): boolean {
  return jsonObject(file)?.finished === true;
}

/** Fold `row`'s token counts into `into` (same skill, model and FR). */
function addUsage(into: TokenLedgerRow, row: TokenLedgerRow): void {
  into.input_tokens += row.input_tokens;
  into.output_tokens += row.output_tokens;
  into.cache_read_input_tokens += row.cache_read_input_tokens;
  into.cache_creation_input_tokens += row.cache_creation_input_tokens;
  into.message_count += row.message_count;
  if (row.ts < into.ts) into.ts = row.ts;
}

/** The FR a line of `skill` at `timestamp` belongs to, or null (STE-811's `attributeLine`). */
export type ForkAttribute = (skill: string, timestamp: unknown) => string | null;

/**
 * Rows for every forked child the parent transcript names, one per (skill, model, FR),
 * every line counted under the marker's `skillName`, tagged `scope: "fork"`.
 * AC-STE-812.2: the FR is `attribute(skillName, <parent result line's timestamp>)` —
 * the parent line's time, never the child lines' — claimed with `claim_source: "run"`.
 */
export function forkChildRows(transcriptPath: string, sessionId: string, attribute: ForkAttribute = () => null): TokenLedgerRow[] {
  const session = basename(transcriptPath, ".jsonl");
  const subagents = join(dirname(transcriptPath), session, "subagents");
  // One row per (skill, model, FR) across every child of the session (AC-STE-812.2), so
  // two children of one skill run for one FR fold together, as the ledger's carry expects.
  const folded = new Map<string, TokenLedgerRow>();
  for (const { id, ts } of forkedAgents(transcriptPath)) {
    try {
      const skill = markerSkill(join(subagents, `agent-${id}.forked-skill.json`));
      const child = join(subagents, `agent-${id}.jsonl`);
      if (skill === null || !existsSync(child)) continue;
      const complete = finished(join(subagents, `agent-${id}.meta.json`));
      const fr = attribute(skill, ts);
      // Read the whole child before folding any of it, so a child that throws adds nothing.
      const lines = parseTranscriptTokenUsage(child);
      for (const row of lines) {
        const key = `${skill}\u0000${row.model}\u0000${fr ?? ""}`;
        const prior = folded.get(key);
        if (prior !== undefined) {
          addUsage(prior, row);
          // A folded row is complete only when every child it holds finished.
          prior.complete = prior.complete === true && complete;
          continue;
        }
        const fresh: TokenLedgerRow = { ...row, skill, session_id: sessionId, scope: "fork", complete };
        if (fr !== null) {
          fresh.claimed_by = fr;
          fresh.claim_source = "run";
        }
        folded.set(key, fresh);
      }
    } catch {
      // fail-open per child
    }
  }
  return [...folded.values()];
}
