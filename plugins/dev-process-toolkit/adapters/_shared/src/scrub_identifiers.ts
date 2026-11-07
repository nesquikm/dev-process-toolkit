// scrub_identifiers — STE-720 (M_d1b4b7).
//
// Pure, deterministic identifier pass beside scrub_secrets.ts. No I/O, no
// side effects. Session aliases come only from session_aliases.ts
// (createAliasMap / aliasFor); this module mints no numbering of its own.

import { createHash } from "node:crypto";
import { type AliasMap, createAliasMap, aliasFor } from "./session_aliases";
import { cwdToSlug } from "./find_current_session";

/** One row of the redaction summary: a pattern key and its hit count. */
export interface ScrubMatch {
  pattern: string;
  count: number;
}

/** The scrubbed text plus one summary row per identifier pattern. */
export interface ScrubResult {
  scrubbed: string;
  matches: ScrubMatch[];
}

export interface IdentifierPattern {
  /** Stable identifier surfaced in the redaction summary. */
  key: "home_path" | "session_id" | "branch_name";
}

/** The three identifier rows, in their load-bearing order. */
export const IDENTIFIER_PATTERNS: readonly IdentifierPattern[] = [
  { key: "home_path" },
  { key: "session_id" },
  { key: "branch_name" },
];

export interface IdentifierContext {
  home?: string;
  branches: readonly string[];
  aliases: AliasMap;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every match of `re` with `to`, returning the new text and the hit count. */
function replaceCounting(
  text: string,
  re: RegExp,
  to: string | ((match: string, ...groups: string[]) => string),
): [string, number] {
  let n = 0;
  const out = text.replace(re, (match: string, ...rest: unknown[]) => {
    n++;
    return typeof to === "string" ? to : to(match, ...(rest as string[]));
  });
  return [out, n];
}

/** `home_path`: literal home, `/Users|home/<seg>` prefixes, then project-folder slugs. */
function scrubHomePaths(text: string, home: string | undefined): [string, number] {
  const h = home && home.length > 1 ? home.replace(/\/+$/, "") : "";
  const passes: [RegExp, string][] = [
    ...(h ? [[new RegExp(`${escapeRegExp(h)}(?![A-Za-z0-9._-])`, "g"), "~"] as [RegExp, string]] : []),
    // The user segment stops at a quote, comma, bracket or backslash too, so a bare home path inside
    // JSON (`"cwd":"/home/x",`) never swallows the next field.
    [/(?<![A-Za-z0-9])\/(?:Users|home)\/[^/\s"'`,;)\]}>\\]+/g, "~"],
    ...(h ? [[new RegExp(`${escapeRegExp(cwdToSlug(h))}(?=[-/])`, "g"), "-~"] as [RegExp, string]] : []),
    [/-(?:Users|home)-[A-Za-z0-9]+(?=[-/])/g, "-~"],
  ];
  let out = text;
  let total = 0;
  for (const [re, to] of passes) {
    const [next, n] = replaceCounting(out, re, to);
    out = next;
    total += n;
  }
  return [out, total];
}

/** `session_id`: every UUID-shaped token, any case, takes its alias from the shared map. */
const UUID_RE = /(?<![0-9A-Fa-f-])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f-])/g;

function scrubSessionIds(text: string, aliases: AliasMap): [string, number] {
  return replaceCounting(text, UUID_RE, (id) => aliasFor(aliases, id.toLowerCase()));
}

/** Branch names `branch_name` never rewrites. */
const DEFAULT_BRANCHES: ReadonlySet<string> = new Set(["main", "master", "develop", "trunk", "HEAD"]);

/** `branch-<first 8 hex of sha256(name)>`. */
function branchAlias(name: string): string {
  return `branch-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
}

/**
 * `branch_name`: each name in `branches` as a whole token. The token may start
 * at a path or ref boundary (`/`, `.`, `:`, whitespace, a quote, the start of
 * the text), so `refs/heads/<name>`, `origin/<name>`, `/tree/<name>` and
 * `main...<name>` are all rewritten and every prefix is kept. It never starts
 * after a letter, digit, `_` or `-`, so a name inside a larger word is left
 * alone. A trailing `.` ends the token unless a token character follows it.
 */
const BRANCH_ALIAS_RE = /^branch-[0-9a-f]{8}$/;

function scrubBranches(text: string, branches: readonly string[]): [string, number] {
  // A name already in alias form came from an earlier pass (a scrubbed `gitBranch` field read back
  // as a branch); re-hashing it would change scrubbed text on every run.
  const names = [...new Set(branches)].filter((b) => b.length > 0 && !DEFAULT_BRANCHES.has(b) && !BRANCH_ALIAS_RE.test(b));
  if (names.length === 0) return [text, 0];
  names.sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(?<![A-Za-z0-9_-])(?:${names.map(escapeRegExp).join("|")})(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9_-])`,
    "g",
  );
  return replaceCounting(text, re, (name) => branchAlias(name));
}

/** A fresh map for one report; every file of that report shares it. */
export { createAliasMap };

export function scrubIdentifiers(text: string, ctx: IdentifierContext): ScrubResult {
  const matches: ScrubMatch[] = IDENTIFIER_PATTERNS.map((p) => ({ pattern: p.key, count: 0 }));
  const [scrubbed, homeCount] = scrubHomePaths(text, ctx.home);
  matches[0].count = homeCount;
  const [aliased, idCount] = scrubSessionIds(scrubbed, ctx.aliases);
  matches[1].count = idCount;
  const [branched, branchCount] = scrubBranches(aliased, ctx.branches);
  matches[2].count = branchCount;
  return { scrubbed: branched, matches };
}
