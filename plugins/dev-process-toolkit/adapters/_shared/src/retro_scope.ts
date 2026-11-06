// STE-719 (M_d1b4b7) — the one /retro scope resolver, shared with STE-722.
//
// `resolveRetroScope(projectRoot, arg)` turns the /retro argument into the
// raw session ids of its scope:
//   - no argument: the current session (`findCurrentSession(cwd)`);
//   - an FR id: the sessions whose token-ledger rows are `claimed_by` it;
//   - a milestone: the sessions claimed by any FR whose frontmatter
//     `milestone` names it (specs/frs and specs/frs/archive);
//   - free text: refused in the NFR-10 shape.
// FR and milestone scopes need the token ledger, so with
// `tracking.token_stats` off they resolve to no session and the reason says so.
// Session ids stay raw here; they are aliased only when a report is written.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { classifyDeliverArgument } from "./deliver_argument";
import { findCurrentSession } from "./find_current_session";
import { parseFrontmatter } from "./frontmatter";
import { readLedgerRows } from "./token_usage";
import { loadProjectSection } from "./project_settings";

export type RetroScopeKind = "session" | "fr" | "milestone";

export interface RetroScope {
  kind: RetroScopeKind;
  /** The FR id or milestone id; null for the current-session scope. */
  id: string | null;
  /** Raw scope session ids, in first-appearance order. */
  sessions: string[];
  /** Null, or why `sessions` is empty. */
  reason: string | null;
}

export const EMPTY_SCOPE_REASON = "scope resolves to no session";
const TOKEN_STATS_OFF_SUFFIX = " (tracking.token_stats off)";

function tokenStatsOn(projectRoot: string): boolean {
  try {
    // Through the loader (either home), so this module composes no CLAUDE.md path (probe #74).
    return loadProjectSection(projectRoot, "tracking").token_stats?.enabled === true;
  } catch {
    return false;
  }
}

/** Every identity an FR file answers to: its tracker refs, its `id`, its file stem. */
function frIdentities(path: string, fm: Record<string, unknown>): string[] {
  const ids = [basename(path, ".md")];
  if (typeof fm.id === "string") ids.push(fm.id);
  const tracker = fm.tracker;
  if (tracker !== null && typeof tracker === "object") {
    for (const v of Object.values(tracker as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "" && v !== "null") ids.push(v);
    }
  }
  return ids;
}

/** The identities of every FR (active or archived) whose frontmatter `milestone` is `milestone`. */
function milestoneFrIds(projectRoot: string, milestone: string): Set<string> {
  const out = new Set<string>();
  for (const dir of [join(projectRoot, "specs", "frs"), join(projectRoot, "specs", "frs", "archive")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      let fm: Record<string, unknown>;
      try {
        fm = parseFrontmatter(readFileSync(path, "utf-8"), { lenient: true });
      } catch {
        continue;
      }
      if (fm.milestone !== milestone) continue;
      for (const id of frIdentities(path, fm)) out.add(id);
    }
  }
  return out;
}

function claimedSessions(projectRoot: string, claimers: Set<string>): string[] {
  const seen = new Set<string>();
  for (const row of readLedgerRows(projectRoot)) {
    if (row.claimed_by !== undefined && claimers.has(row.claimed_by) && typeof row.session_id === "string") {
      seen.add(row.session_id);
    }
  }
  return [...seen];
}

function scope(kind: RetroScopeKind, id: string | null, sessions: string[], suffix = ""): RetroScope {
  return { kind, id, sessions, reason: sessions.length === 0 ? EMPTY_SCOPE_REASON + suffix : null };
}

export function resolveRetroScope(projectRoot: string, arg: string | undefined | null): RetroScope {
  if (arg === undefined || arg === null || arg.trim() === "") {
    const transcript = findCurrentSession(process.cwd());
    return scope("session", null, transcript === null ? [] : [basename(transcript, ".jsonl")]);
  }

  const c = classifyDeliverArgument(arg);
  if (c.kind === "feature_request") {
    throw new Error(
      [
        `Refusing: /retro takes an FR id or a milestone, not free text ("${arg.trim()}").`,
        "Remedy: run /retro with no argument for the current session, or pass an FR id (STE-123) or a milestone (M_abc123).",
        "Context: mode=retro, phase=scope, argument=feature_request",
      ].join("\n"),
    );
  }

  const kind: RetroScopeKind = c.kind === "milestone_identity" ? "milestone" : "fr";
  const id = c.identity!;
  if (!tokenStatsOn(projectRoot)) return scope(kind, id, [], TOKEN_STATS_OFF_SUFFIX);

  const claimers = kind === "fr" ? new Set([id]) : milestoneFrIds(projectRoot, id);
  return scope(kind, id, claimedSessions(projectRoot, claimers));
}
