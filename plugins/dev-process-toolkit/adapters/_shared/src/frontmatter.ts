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
