// Tracker-ID Argument Resolver (FR-51, technical-spec §9.3–§9.5).
//
// A pure function over (argument, config) that classifies a skill argument
// into one of four kinds (ulid / tracker-id / url / fallthrough) and looks
// up configured trackers from CLAUDE.md's `## Task Tracking` section. Also
// exports findFRByTrackerRef, a filesystem scanner that maps a tracker
// reference back to a local FR ULID.
//
// Design rationale:
//   - Pure parsing + config lookup; no network I/O, no filesystem reads here
//     (NFR-17, NFR-19). All filesystem work is in findFRByTrackerRef.
//   - Ordering matters: explicit-prefix → ULID → URL → tracker-ID → fallthrough.
//     The ordering is asserted by unit tests (§9.4 algorithm notes).
//   - Ambiguity is an error, not a prompt (NFR-20). Resolver is callable from
//     non-interactive contexts; the deterministic error lets callers render
//     NFR-10 shape without threading interactivity into a pure function.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";

export type ResolveKind = "ulid" | "tracker-id" | "url" | "fr-code" | "fallthrough";

export interface ResolveResult {
  kind: ResolveKind;
  ulid?: string;
  trackerKey?: string;
  trackerId?: string;
  frNumber?: number;
}

export interface TrackerConfig {
  key: string;
  idPattern: RegExp;
  urlHost: string;
  urlPathRegex: RegExp;
  prefixes?: string[];
}

export interface ResolverConfig {
  trackers: TrackerConfig[];
}

/**
 * Thrown when an argument matches multiple tracker configurations and
 * prefix-based disambiguation can't pick a single winner. Callers catch
 * this and re-render as NFR-10 canonical error.
 */
export type AmbiguousArgumentKind = "tracker" | "fr-code";

export class AmbiguousArgumentError extends Error {
  readonly argument: string;
  readonly candidates: string[];
  readonly kind: AmbiguousArgumentKind;
  constructor(
    argument: string,
    candidates: string[],
    opts: { kind?: AmbiguousArgumentKind } = {},
  ) {
    const kind = opts.kind ?? "tracker";
    const remedy =
      kind === "tracker"
        ? `disambiguate using <tracker>:<id> explicit prefix (e.g., ${candidates[0]})`
        : `pass the ULID directly (e.g., ${candidates[0]}) — multiple FR files declare ACs for this number`;
    const scope =
      kind === "tracker"
        ? "across configured trackers"
        : "across FR files in specs/frs/";
    super(
      `Argument "${argument}" is ambiguous ${scope}. Candidates: ${candidates.join(", ")}. Remedy: ${remedy}.`,
    );
    this.name = "AmbiguousArgumentError";
    this.argument = argument;
    this.candidates = candidates;
    this.kind = kind;
  }
}

const ULID_RE = /^fr_[0-9A-HJKMNP-TV-Z]{26}$/;
const EXPLICIT_PREFIX_RE = /^([a-z]+):(.+)$/i;
const URL_RE = /^https?:\/\//;
const LEADING_ID_PREFIX_RE = /^([A-Z]+)-/;
const FR_CODE_RE = /^FR-(\d+)$/;

export function resolveFRArgument(arg: string, config: ResolverConfig): ResolveResult {
  // 1. Explicit prefix form always wins when the key is configured.
  //    Unknown prefixes fall through so non-tracker strings containing a
  //    colon (e.g., a URL, or a free-form title) don't short-circuit here.
  const explicit = EXPLICIT_PREFIX_RE.exec(arg);
  if (explicit) {
    const key = explicit[1]!.toLowerCase();
    const id = explicit[2]!;
    if (config.trackers.some((t) => t.key === key)) {
      return { kind: "tracker-id", trackerKey: key, trackerId: id };
    }
    // fall through to next detection step
  }

  // 2. ULID regex (after explicit to allow "someprefix:fr_..." fallthrough).
  if (ULID_RE.test(arg)) {
    return { kind: "ulid", ulid: arg };
  }

  // 2.5. FR-code route (FR-69 AC-69.1). DPT-internal codes like FR-57 map to
  //      a filesystem scan of specs/frs/*.md AC-<N>.M lines. Pure parse here;
  //      the scan lives in findFRByFRCode.
  const frCode = FR_CODE_RE.exec(arg);
  if (frCode) {
    return { kind: "fr-code", frNumber: Number.parseInt(frCode[1]!, 10) };
  }

  // 3. URL detection — allowlist by host (NFR-19). Unknown hosts fallthrough.
  if (URL_RE.test(arg)) {
    try {
      const url = new URL(arg);
      for (const t of config.trackers) {
        if (url.host === t.urlHost) {
          const match = url.pathname.match(t.urlPathRegex);
          if (match && match[1]) {
            return { kind: "url", trackerKey: t.key, trackerId: match[1] };
          }
        }
      }
      return { kind: "fallthrough" };
    } catch {
      return { kind: "fallthrough" };
    }
  }

  // 4. Tracker-ID pattern match with prefix disambiguation.
  const candidates = config.trackers.filter((t) => t.idPattern.test(arg));
  if (candidates.length === 1) {
    return { kind: "tracker-id", trackerKey: candidates[0]!.key, trackerId: arg };
  }
  if (candidates.length > 1) {
    const prefixMatch = LEADING_ID_PREFIX_RE.exec(arg);
    if (prefixMatch) {
      const prefix = prefixMatch[1]!;
      const byPrefix = candidates.filter((t) => t.prefixes?.includes(prefix));
      if (byPrefix.length === 1) {
        return { kind: "tracker-id", trackerKey: byPrefix[0]!.key, trackerId: arg };
      }
    }
    throw new AmbiguousArgumentError(
      arg,
      candidates.map((c) => `${c.key}:${arg}`),
    );
  }

  // 5. Fallthrough — skill handles per its existing contract.
  return { kind: "fallthrough" };
}

export interface FindOptions {
  includeArchive?: boolean;
}

/**
 * Scan `specs/frs/*.md` (excluding `archive/`) for an FR whose
 * `## Acceptance Criteria` section contains any line starting with
 * `AC-<N>.` (after stripping an optional `- ` or `* ` bullet prefix).
 *
 * Returns the matching FR ULID or `null`. Multiple matches throw
 * `AmbiguousArgumentError` (kind: "fr-code") per NFR-20 — callers re-render
 * in NFR-10 canonical shape. Miss is `null` (never a throw); callers pick
 * the miss remedy. Archive is never scanned (AC-69.2).
 */
export async function findFRByFRCode(
  specsDir: string,
  frNumber: number,
): Promise<string | null> {
  const dir = join(specsDir, "frs");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  entries.sort();
  const matches: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const path = join(dir, name);
    let text: string;
    try {
      text = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    if (!hasACInAcceptanceCriteria(text, frNumber)) continue;
    const fm = parseFrontmatter(text, { lenient: true });
    const id = fm["id"];
    if (typeof id === "string" && id.length > 0) matches.push(id);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  throw new AmbiguousArgumentError(`FR-${frNumber}`, matches, { kind: "fr-code" });
}

const BULLET_PREFIX_RE = /^\s*[-*]\s+/;

function hasACInAcceptanceCriteria(text: string, frNumber: number): boolean {
  const lines = text.split("\n");
  const needle = `AC-${frNumber}.`;
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^## /.test(line)) {
      inSection = /^##\s+Acceptance Criteria\b/i.test(line);
      continue;
    }
    if (!inSection) continue;
    const stripped = line.replace(BULLET_PREFIX_RE, "");
    if (stripped.startsWith(needle)) return true;
  }
  return false;
}

/**
 * Scan `specs/frs/*.md` (and optionally `specs/frs/archive/*.md`) for an FR
 * whose frontmatter `tracker.<trackerKey>` equals `trackerId`. Returns the
 * matching ULID or null. Short-circuits on first match (AC-51.8).
 */
export async function findFRByTrackerRef(
  specsDir: string,
  trackerKey: string,
  trackerId: string,
  options: FindOptions = {},
): Promise<string | null> {
  const searchDirs: string[] = [join(specsDir, "frs")];
  if (options.includeArchive) searchDirs.push(join(specsDir, "frs", "archive"));
  for (const dir of searchDirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    entries.sort();
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      let text: string;
      try {
        text = await readFile(path, "utf-8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(text, { lenient: true });
      const tracker = fm["tracker"];
      if (typeof tracker === "object" && tracker !== null && !Array.isArray(tracker)) {
        const val = (tracker as Record<string, unknown>)[trackerKey];
        if (val === trackerId) {
          const id = fm["id"];
          if (typeof id === "string" && id.length > 0) return id;
        }
      }
    }
  }
  return null;
}
