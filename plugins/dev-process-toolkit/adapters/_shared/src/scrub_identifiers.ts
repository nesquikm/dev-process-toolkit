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
  /** The resolved Claude config root (`defaultConfigDir()`); its `projects/` folder anchors the slug pass. */
  configDir?: string;
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
 * alone. It may end at `/` too, so `<worktree>/<name>/src/a.ts` loses the
 * name; names are tried longest first, so with `feat` and `feat/x` both known,
 * `feat/x/y` becomes `<alias of feat/x>/y`. A trailing `.` ends the token
 * unless a token character follows it.
 *
 * Each `/` of a name also matches its URL-encoded (`%2F`, `%2f`) and
 * JSON-escaped (`\/`) forms, and the token may start right after an encoded
 * `%2F`; every form takes the plain name's alias.
 *
 * The token may also start right after a JSON string escape (`\n`, `\t`, `\r`
 * as two characters) or an ANSI SGR sequence ending in `m` (raw ESC or the
 * JSON `\u001b` form), so a name at the start of a line of recorded stdout is
 * rewritten too.
 *
 * Inside a Claude project-folder slug a name appears as `cwdToSlug(name)`
 * (`feat/x` → `feat-x`) between a `-` and a `-` or the segment's end; it takes
 * the same alias, so the slug and the cwd it encodes stay consistent. A slug is
 * the segment after `projects/` under a config-dir-like parent (`.claude*`,
 * `.config/claude`, or the resolved config root, home-rewritten form
 * included), or a `-`-led slug alone on a line (`ls <config>/projects`).
 *
 * This is best-effort: other percent-encodings, double-escaped JSON, markdown
 * emphasis around a name and other wrappers are not recognised.
 */
const BRANCH_ALIAS_RE = /^branch-[0-9a-f]{8}$/;

const SLASH_FORMS = "(?:/|%2[Ff]|\\\\/)";
const SLASH_FORMS_RE = /%2[Ff]|\\\//g;

/** Start boundaries a letter lookbehind misreads: a JSON `\n` `\t` `\r`, and an ANSI SGR (raw ESC or `\u001b`). */
const ESCAPE_STARTS = "(?<=\\\\[ntr])|(?<=(?:\\x1b|\\\\u001[bB])\\[[0-9;]*m)";

/** A `/` in plain or JSON-escaped form, as a regex source. */
const SLASH_SRC = "(?:/|\\\\/)";

/** The config-dir-like parents of `projects/`: `.claude*`, `.config/claude`, and the resolved root. */
function configParents(configDir: string | undefined, home: string | undefined): string[] {
  const out = ["\\.claude[A-Za-z0-9._-]*", `\\.config${SLASH_SRC}claude`];
  const root = configDir ? configDir.replace(/\/+$/, "") : "";
  if (root.length > 1) {
    const forms = [root];
    const h = home && home.length > 1 ? home.replace(/\/+$/, "") : "";
    if (h && root.startsWith(`${h}/`)) forms.push(`~${root.slice(h.length)}`);
    for (const f of forms) out.push(f.split("/").map(escapeRegExp).join(SLASH_SRC));
  }
  return out;
}

/** A `-`-led slug alone on a line, the line ended by a real or JSON-escaped newline. */
const BARE_SLUG_RE = /(?<=^|\\[nr])-[-A-Za-z0-9~]+(?=$|\\[nr]|")/gm;

function scrubSlugBranches(text: string, names: readonly string[], ctx: { home?: string; configDir?: string }): [string, number] {
  const bySlug = new Map<string, string>();
  for (const b of names) {
    const s = cwdToSlug(b);
    if (!bySlug.has(s)) bySlug.set(s, b);
  }
  const slugs = [...bySlug.keys()].sort((a, b) => b.length - a.length);
  const inner = new RegExp(`(?<=-)(?:${slugs.map(escapeRegExp).join("|")})(?=-|$)`, "g");
  const segmentRe = new RegExp(`((?:${configParents(ctx.configDir, ctx.home).join("|")})${SLASH_SRC}projects${SLASH_SRC})([-A-Za-z0-9~]+)`, "g");
  let total = 0;
  const rewrite = (segment: string): string => {
    const [next, n] = replaceCounting(segment, inner, (s) => branchAlias(bySlug.get(s)!));
    total += n;
    return next;
  };
  const anchored = text.replace(segmentRe, (_m, prefix: string, segment: string) => prefix + rewrite(segment));
  return [anchored.replace(BARE_SLUG_RE, rewrite), total];
}

function scrubBranches(text: string, branches: readonly string[], ctx: { home?: string; configDir?: string }): [string, number] {
  // A name already in alias form came from an earlier pass (a scrubbed `gitBranch` field read back
  // as a branch); re-hashing it would change scrubbed text on every run.
  const names = [...new Set(branches)].filter((b) => b.length > 0 && !DEFAULT_BRANCHES.has(b) && !BRANCH_ALIAS_RE.test(b));
  if (names.length === 0) return [text, 0];
  names.sort((a, b) => b.length - a.length);
  const [slugged, slugCount] = scrubSlugBranches(text, names, ctx);
  const known = new Set(names);
  const pattern = (b: string) => b.split("/").map(escapeRegExp).join(SLASH_FORMS);
  const re = new RegExp(
    `(?:(?<![A-Za-z0-9_-])|(?<=%2[Ff])|${ESCAPE_STARTS})(?:${names.map(pattern).join("|")})(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])`,
    "g",
  );
  const [out, n] = replaceCounting(slugged, re, (match) => {
    const plain = match.replace(SLASH_FORMS_RE, "/");
    return branchAlias(known.has(plain) ? plain : match);
  });
  return [out, slugCount + n];
}

/** A fresh map for one report; every file of that report shares it. */
export { createAliasMap };

export function scrubIdentifiers(text: string, ctx: IdentifierContext): ScrubResult {
  const matches: ScrubMatch[] = IDENTIFIER_PATTERNS.map((p) => ({ pattern: p.key, count: 0 }));
  const [scrubbed, homeCount] = scrubHomePaths(text, ctx.home);
  matches[0].count = homeCount;
  const [aliased, idCount] = scrubSessionIds(scrubbed, ctx.aliases);
  matches[1].count = idCount;
  const [branched, branchCount] = scrubBranches(aliased, ctx.branches, ctx);
  matches[2].count = branchCount;
  return { scrubbed: branched, matches };
}
