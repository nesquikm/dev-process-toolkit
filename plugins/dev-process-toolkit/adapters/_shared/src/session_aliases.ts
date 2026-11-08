// STE-719 (M_d1b4b7) — the one session aliaser.
//
// A report never holds a raw session id. Sessions are numbered `s1`, `s2`, ...
// in first-appearance order, and each alias carries `digest`, the first 16 hex
// of the sha256 of the raw id. `seedAliasMap` re-seeds a map from a report's
// `sessions[]`, so one session keeps one alias in every report file. The
// /retro report (retro_report.ts) and the STE-720 payload pass both number
// sessions through this module; no other module mints an alias.

import { createHash } from "node:crypto";

export interface SessionAlias {
  alias: string;
  digest: string;
}

export interface AliasMap {
  /** digest -> alias, for every session the map has numbered or been seeded with. */
  byDigest: Map<string, string>;
  /** The highest alias number handed out or seeded. */
  last: number;
}

export const SESSION_ALIAS_RE = /^s[1-9]\d*$/;

export function createAliasMap(): AliasMap {
  return { byDigest: new Map(), last: 0 };
}

/** First 16 hex of the sha256 of the raw session id. */
export function sessionDigest(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

/** The alias for `sessionId`, minting the next `s<N>` on first appearance. */
export function aliasFor(map: AliasMap, sessionId: string): string {
  const digest = sessionDigest(sessionId);
  const known = map.byDigest.get(digest);
  if (known !== undefined) return known;
  map.last += 1;
  const alias = `s${map.last}`;
  map.byDigest.set(digest, alias);
  return alias;
}

/** Re-seed `map` from a report's `sessions[]`: a seeded id keeps its alias, a new id takes the next number. */
export function seedAliasMap(map: AliasMap, sessions: readonly SessionAlias[]): AliasMap {
  for (const s of sessions) {
    if (!SESSION_ALIAS_RE.test(s.alias)) throw new Error(`seedAliasMap: not a session alias: ${JSON.stringify(s.alias)}`);
    map.byDigest.set(s.digest, s.alias);
    map.last = Math.max(map.last, Number(s.alias.slice(1)));
  }
  return map;
}
