// Shared YAML frontmatter parser — consolidates the 4 near-duplicate variants
// that were inlined in local_provider, index_gen, convert_archive, and
// plan_lock. Minimal-YAML scope: scalar values, single-level `tracker:` map,
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

export function parseFrontmatter(
  md: string,
  options: ParseFrontmatterOptions = {},
): Record<string, unknown> {
  const match = FRONTMATTER_RE.exec(md);
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
        (map as Record<string, unknown>)[k] = v === "null" ? null : stripQuotes(v);
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
    } else if (rest === "null") {
      out[key] = null;
      currentKey = null;
    } else {
      out[key] = stripQuotes(rest);
      currentKey = null;
    }
  }
  return out;
}

/**
 * Flat variant used by `convert_archive` (no nested maps expected).
 * Preserves the original untyped-string return shape.
 */
export function parseFrontmatterFlat(md: string): Record<string, string> {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const k = line.slice(0, c).trim();
    const v = line.slice(c + 1).trim();
    if (k.length > 0) out[k] = stripQuotes(v);
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
