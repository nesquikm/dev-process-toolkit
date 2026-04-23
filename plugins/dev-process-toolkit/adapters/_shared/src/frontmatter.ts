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

// YAML-literal coercion for scalar values: `null` → null, bare `true`/`false`
// → booleans, everything else → quote-stripped string. Quoted literals
// (`"true"`, `'null'`) stay strings — users asked for a string explicitly.
function coerceScalar(v: string): string | boolean | null {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return stripQuotes(v);
}

/**
 * Write a `tracker: { <key>: <id> }` binding into an FR file's frontmatter,
 * producing the canonical multi-line form the parser expects. Used by
 * `/setup --migrate` (FR-58) to record tracker ticket IDs after a
 * successful bulk push.
 *
 * Behavior:
 * - The empty-seed `tracker: {}` line is replaced with a multi-line block.
 * - Existing bindings are preserved and the new key is inserted alphabetically
 *   (AC-58.2/AC-42.5).
 * - Re-binding an existing key overwrites the id in place — no duplicates.
 * - Ad-hoc inline `tracker: { linear: LIN-1 }` is never emitted (AC-58.4).
 *
 * Throws if the input has no frontmatter block — callers are expected to
 * pass a well-formed FR file (`specs/frs/<ulid>.md`).
 */
export function setTrackerBinding(md: string, key: string, id: string): string {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) {
    throw new Error("frontmatter: no YAML frontmatter block found");
  }
  const fmBody = match[1]!;
  const existing = extractTrackerMap(fmBody);
  const merged: Record<string, string> = { ...existing, [key]: id };
  const sortedKeys = Object.keys(merged).sort();

  const trackerLines = ["tracker:"];
  for (const k of sortedKeys) {
    trackerLines.push(`  ${k}: ${yamlQuoteIfNeeded(merged[k]!)}`);
  }
  const trackerBlock = trackerLines.join("\n");

  const rebuiltFm = rewriteTrackerBlock(fmBody, trackerBlock);
  return md.slice(0, match.index) +
    `---\n${rebuiltFm}\n---` +
    md.slice(match.index + match[0].length);
}

function extractTrackerMap(fmBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = fmBody.split("\n");
  let inTracker = false;
  for (const raw of lines) {
    if (/^tracker:\s*\{\s*\}\s*$/.test(raw)) return {};
    // AC-58.4 forbids the inline non-empty form (`tracker: { key: val }`).
    // Silently returning {} here would drop the existing keys — throw
    // instead so the migration tool surfaces a loud error and the operator
    // can normalize the FR file before re-running.
    if (/^tracker:\s*\{.+\}\s*$/.test(raw)) {
      throw new Error(
        "frontmatter: inline non-empty tracker map is not supported; " +
          "convert to multi-line form (see AC-58.4)",
      );
    }
    if (/^tracker:\s*$/.test(raw)) {
      inTracker = true;
      continue;
    }
    if (inTracker) {
      if (!(raw.startsWith("  ") || raw.startsWith("\t"))) break;
      const inner = raw.trim();
      const c = inner.indexOf(":");
      if (c < 0) continue;
      const k = inner.slice(0, c).trim();
      const v = inner.slice(c + 1).trim();
      out[k] = stripQuotes(v);
    }
  }
  return out;
}

/**
 * Emit a YAML-safe double-quoted form if the value would confuse the bespoke
 * parseFrontmatter reader or a stricter downstream YAML consumer — otherwise
 * return bare. Tracker IDs in real adapters (Linear `STE-36`, Jira `PROJ-1`,
 * GitHub `42`) are bare-safe; this guard is defensive against future
 * adapters that allow richer IDs.
 */
function yamlQuoteIfNeeded(v: string): string {
  if (v.length === 0) return '""';
  if (/[:#\s"'{}\[\],&*?|<>=!%@`]/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

function rewriteTrackerBlock(fmBody: string, newTrackerBlock: string): string {
  const lines = fmBody.split("\n");
  const out: string[] = [];
  let i = 0;
  let wrote = false;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^tracker:/.test(line)) {
      out.push(newTrackerBlock);
      wrote = true;
      i++;
      while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i]!.startsWith("\t"))) {
        i++;
      }
      continue;
    }
    out.push(line);
    i++;
  }
  if (!wrote) out.push(newTrackerBlock);
  return out.join("\n");
}
