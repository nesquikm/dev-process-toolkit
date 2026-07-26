// Shared YAML frontmatter parser — consolidates the near-duplicate variants
// that were inlined in local_provider and plan_lock. Minimal-YAML scope:
// scalar values, single-level `tracker:` map,
// `{}` empty-map literal, `null` literal, quoted string passthrough.
//
// Design rationale: we intentionally do NOT pull a YAML library — the
// frontmatter schema is tightly constrained (Schemas Q, R, S, T) and the
// surface area of real cases is small. Keeping the parser in-repo avoids a
// runtime dependency on a ~500-line YAML dep for what amounts to
// `key: value` line parsing.

export interface ParseFrontmatterOptions {
  /**
   * When true, missing or malformed frontmatter returns {} instead of
   * throwing. Callers that read opportunistic frontmatter (plan_lock
   * checking arbitrary paths) pass true; callers that require frontmatter
   * (FR file readers) leave it false.
   */
  lenient?: boolean;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/m;

/**
 * Canonical input normalization for every frontmatter reader.
 *
 * Strips a UTF-8 BOM and folds CRLF and lone-CR to LF. Load-bearing, not
 * cosmetic: every scanner in this repo anchors on a literal `---\n` opener, so
 * a Windows-authored or BOM-prefixed file otherwise reads as having NO
 * frontmatter at all. That failure is silent and it points the wrong way in
 * both directions — a strict caller throws, a `lenient: true` caller gets `{}`
 * and its gate passes on a file it never actually parsed.
 *
 * `\r\n` is folded before lone `\r` so CRLF never becomes a blank line, and
 * neither substitution changes the line COUNT, so reported line numbers stay
 * accurate. Idempotent, and a no-op on already-LF content.
 *
 * Writers must normalize for parsing but restore the original bytes on write —
 * see `detectEol` / `applyEol`.
 */
export function normalizeFrontmatterSource(raw: string): string {
  return raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** True when the raw source carried a UTF-8 BOM. */
export function hasBom(raw: string): boolean {
  return raw.startsWith("﻿");
}

/**
 * A frontmatter block located in a document WITHOUT disturbing the rest of it.
 *
 * This is the write-side counterpart to `normalizeFrontmatterSource`. Folding
 * the whole document and re-applying one line ending on write is lossy in two
 * ways that were both reproduced against real fixtures: a file whose
 * frontmatter is CRLF but whose body is LF gets its untouched body rewritten
 * to CRLF, and a lone `\r` used as meaningful BODY content (pasted progress
 * output, say) is permanently folded into a real newline with no way to undo
 * it. A frontmatter edit must change frontmatter and nothing else, so `rest`
 * here is carried through byte-for-byte.
 */
export interface FrontmatterSplit {
  /** `"﻿"` when the file carried a BOM, else `""`. */
  bom: string;
  /** Logical frontmatter lines, line endings already stripped. */
  lines: string[];
  /** The line ending used INSIDE the frontmatter block. */
  eol: "\r\n" | "\n";
  /** Everything after the closing `---`, VERBATIM — never re-encoded. */
  rest: string;
}

const FM_SPLIT_RE = /^(﻿?)---(\r?\n)([\s\S]*?)(\r?\n)---/;
const FM_OPENER_RE = /^﻿?---\r?\n/;

/**
 * True when the document OPENS a frontmatter block, regardless of whether it
 * closes one. Lets callers distinguish "no frontmatter at all" from "opened
 * but never closed", which carry different refusals.
 */
export function hasFrontmatterOpener(raw: string): boolean {
  return FM_OPENER_RE.test(raw);
}

/**
 * Split `raw` into its frontmatter lines plus a verbatim remainder, tolerating
 * CRLF, lone-CR and a BOM. Returns `null` when there is no well-formed block.
 */
export function splitFrontmatter(raw: string): FrontmatterSplit | null {
  const m = FM_SPLIT_RE.exec(raw);
  if (m === null) return null;
  return {
    bom: m[1] ?? "",
    lines: (m[3] ?? "").split(/\r\n|\r|\n/),
    eol: (m[2] as "\r\n" | "\n") ?? "\n",
    rest: raw.slice(m[0].length),
  };
}

/**
 * Rebuild a document from edited frontmatter lines plus the untouched
 * remainder. Exact inverse of `splitFrontmatter` when `lines` is unchanged.
 */
export function joinFrontmatter(split: FrontmatterSplit, lines: string[]): string {
  const { bom, eol, rest } = split;
  return `${bom}---${eol}${lines.join(eol)}${eol}---${rest}`;
}

export function parseFrontmatter(
  md: string,
  options: ParseFrontmatterOptions = {},
): Record<string, unknown> {
  const match = FRONTMATTER_RE.exec(normalizeFrontmatterSource(md));
  if (!match) {
    if (options.lenient) return {};
    throw new Error("frontmatter: no YAML frontmatter block found");
  }
  const lines = match[1]!.split("\n");
  const out: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const raw of lines) {
    if (raw.length === 0) continue;
    if ((raw.startsWith("  ") || raw.startsWith("\t")) && currentKey !== null) {
      const inner = raw.trim();
      const c = inner.indexOf(":");
      if (c < 0) continue;
      const k = inner.slice(0, c).trim();
      const v = inner.slice(c + 1).trim();
      const map = out[currentKey] as Record<string, unknown> | undefined;
      if (map && typeof map === "object") {
        (map as Record<string, unknown>)[k] = coerceScalar(v);
      }
      continue;
    }
    const c = raw.indexOf(":");
    if (c < 0) continue;
    const key = raw.slice(0, c).trim();
    const rest = raw.slice(c + 1).trim();
    if (rest === "") {
      out[key] = {};
      currentKey = key;
    } else if (rest === "{}") {
      out[key] = {};
      currentKey = null;
    } else {
      out[key] = coerceScalar(rest);
      currentKey = null;
    }
  }
  return out;
}

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  }
  return v;
}

// YAML-literal coercion for scalar values: `null` → null, bare `true`/`false`
// → booleans, everything else → quote-stripped string. Quoted literals
// (`"true"`, `'null'`) stay strings — users asked for a string explicitly.
function coerceScalar(v: string): string | boolean | null {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return stripQuotes(v);
}
