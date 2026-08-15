// STE-465 — Best-practices manifest helpers.
//
// Reads, writes, and mutates `specs/best-practices.yaml`: the git-tracked
// catalog of project best-practices documents. Clones the STE-301
// deps-manifest idiom (`deps_manifest.ts`) verbatim — reuse the existing
// idiom, do not abstract. Schema:
//
//     best_practices:
//       - name: error-handling
//         path: docs/best-practices/error-handling.md
//         scope: ["src/**/*.ts", "adapters/**"]
//         topics: [errors, logging]
//         notes: house rules for throw vs. return
//
// Deliberate divergences from the deps twin:
//   - CLOSED schema: unknown entry keys REFUSE (deps ignores them).
//   - `path` is REPO-RELATIVE: no absolute paths, no `..` traversal
//     (deps is sibling-only `../`-prefixed — the exact inverse).
//
// Design rationale (matches `deps_manifest.ts` / `frontmatter.ts`): the
// schema is tight enough that we hand-roll the parser rather than pull a
// YAML dep. The shape is a single top-level `best_practices:` block list
// whose entries are flat maps of scalars plus flow-style string lists —
// no nested maps, no block-style lists. Anything outside that surface
// throws `BestPracticesManifestShapeError` carrying the NFR-10 canonical
// refusal shape (Refusing: ... / Remedy: ... / Context: ...) so callers
// can surface the failure verbatim to the operator.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BestPracticesEntry {
  name: string;
  path: string;
  scope?: string[];
  topics?: string[];
  notes?: string;
}

export interface BestPracticesManifest {
  best_practices: BestPracticesEntry[];
}

/** Closed-enum entry-key consts (M124) — the /best-practices add/edit field
 * prompts validate against these; exporting changes no behavior. */
export const KNOWN_KEYS: readonly string[] = ["name", "path", "scope", "topics", "notes"];
export const LIST_KEYS: readonly string[] = ["scope", "topics"];

/**
 * Thrown when the manifest file or an entry violates the schema. The
 * message follows the NFR-10 canonical refusal shape — Refusing / Remedy
 * / Context lines — so callers can render it verbatim without
 * re-templating.
 */
export class BestPracticesManifestShapeError extends Error {
  readonly reason: string;
  constructor(reason: string, remedy?: string, context?: string) {
    const remedyLine =
      remedy ?? "fix specs/best-practices.yaml to conform to the manifest schema and re-run.";
    const contextLine = context ?? "mode=best-practices-manifest, file=specs/best-practices.yaml";
    super(
      [
        `Refusing: ${reason}`,
        `Remedy: ${remedyLine}`,
        `Context: ${contextLine}`,
      ].join("\n"),
    );
    this.name = "BestPracticesManifestShapeError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Parser — minimal scoped YAML covering the best-practices.yaml schema only.
// ---------------------------------------------------------------------------

interface ParsedEntry {
  fields: Record<string, string>;
  lineNo: number;
}

function parseManifestYaml(text: string): ParsedEntry[] {
  // Normalize CRLF → LF before splitting so Windows-authored manifests
  // don't trail `\r` garbage into parsed field values (sibling-module
  // convention — see jira_pull_acs.ts and release_config.ts).
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // Locate the `best_practices:` top-level key.
  let i = 0;
  // Skip leading blank / comment lines.
  while (i < lines.length) {
    const l = lines[i]!;
    const t = l.trim();
    if (t.length === 0 || t.startsWith("#")) {
      i++;
      continue;
    }
    break;
  }
  if (i >= lines.length) {
    throw new BestPracticesManifestShapeError(
      "best-practices.yaml is empty — expected top-level `best_practices:` key",
    );
  }
  const header = lines[i]!;
  const headerTrimmed = header.trim();
  if (headerTrimmed === "best_practices: []") return [];
  if (!/^best_practices:\s*$/.test(header)) {
    throw new BestPracticesManifestShapeError(
      `best-practices.yaml line ${i + 1}: expected top-level \`best_practices:\` key, got ${JSON.stringify(header)}`,
    );
  }
  i++;
  const entries: ParsedEntry[] = [];
  let current: ParsedEntry | null = null;
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    // Entry header: `  - key: value` — starts a new entry.
    const entryMatch = /^(\s+)-\s+([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(raw);
    if (entryMatch) {
      const [, , key, value] = entryMatch;
      current = { fields: {}, lineNo: i + 1 };
      current.fields[key!] = value!.trim();
      entries.push(current);
      continue;
    }
    // Continuation field: `    key: value` (deeper indent than `-` marker).
    const fieldMatch = /^(\s+)([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(raw);
    if (fieldMatch && current !== null) {
      const [, , key, value] = fieldMatch;
      current.fields[key!] = value!.trim();
      continue;
    }
    throw new BestPracticesManifestShapeError(
      `best-practices.yaml line ${i + 1}: unrecognized line ${JSON.stringify(raw)} — expected block-list entry or scalar field`,
    );
  }
  return entries;
}

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse a flow-style string list — `["a", "b"]`, `[a, b]`, or `[]`.
 * Block-style lists and anything not bracket-delimited refuse (the
 * manifest's only supported list form is flow style).
 */
function parseFlowList(name: string, key: string, value: string, lineNo: number): string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) {
    throw new BestPracticesManifestShapeError(
      `best-practices.yaml entry \`${name}\` at line ${lineNo}: field \`${key}\` must be a flow-style list (e.g., \`[a, b]\`), got ${JSON.stringify(value)}`,
    );
  }
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((item) => stripQuotes(item.trim()));
}

/**
 * Assert `path` is repo-relative: rejects absolute paths and any `..`
 * traversal segment (leading or embedded). The exact inverse of the deps
 * twin's sibling-only `../` constraint.
 */
function assertRepoRelativePath(name: string, path: string, where: string): void {
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.startsWith("\\")) {
    throw new BestPracticesManifestShapeError(
      `${where}: entry \`${name}\` has absolute path \`${path}\` — path must be repo-relative`,
    );
  }
  if (path.split("/").includes("..")) {
    throw new BestPracticesManifestShapeError(
      `${where}: entry \`${name}\` has path \`${path}\` containing a \`..\` segment — path must stay inside the repo`,
    );
  }
}

function validateEntry(fields: Record<string, string>, lineNo: number): BestPracticesEntry {
  for (const key of Object.keys(fields)) {
    if (!KNOWN_KEYS.includes(key)) {
      throw new BestPracticesManifestShapeError(
        `best-practices.yaml entry at line ${lineNo}: unknown field \`${key}\` (closed schema — allowed fields: ${KNOWN_KEYS.join(", ")})`,
      );
    }
  }
  const name = fields["name"] !== undefined ? stripQuotes(fields["name"]) : undefined;
  const path = fields["path"] !== undefined ? stripQuotes(fields["path"]) : undefined;
  if (!name) {
    throw new BestPracticesManifestShapeError(
      `best-practices.yaml entry at line ${lineNo}: missing required field \`name\``,
    );
  }
  if (!path) {
    throw new BestPracticesManifestShapeError(
      `best-practices.yaml entry \`${name}\` at line ${lineNo}: missing required field \`path\``,
    );
  }
  assertRepoRelativePath(name, path, `best-practices.yaml line ${lineNo}`);
  const entry: BestPracticesEntry = { name, path };
  for (const key of LIST_KEYS) {
    const raw = fields[key];
    if (raw !== undefined) {
      entry[key as "scope" | "topics"] = parseFlowList(name, key, raw, lineNo);
    }
  }
  if (fields["notes"] !== undefined && fields["notes"].length > 0) {
    entry.notes = stripQuotes(fields["notes"]);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read `<specsDir>/best-practices.yaml` and return a typed
 * `BestPracticesManifest`. Absent file is the canonical empty manifest —
 * `{ best_practices: [] }` — not an error (projects without catalogued
 * best-practices docs are common). Malformed YAML, missing
 * `best_practices:` key, bad entry shape, unknown entry keys, or a
 * non-repo-relative `path` all throw `BestPracticesManifestShapeError`
 * carrying NFR-10 canonical refusal text. Never a partial parse — one
 * bad entry refuses the whole read.
 */
export function readManifest(specsDir: string): BestPracticesManifest {
  const manifestPath = join(specsDir, "best-practices.yaml");
  if (!existsSync(manifestPath)) return { best_practices: [] };
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new BestPracticesManifestShapeError(
      `cannot read best-practices.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = parseManifestYaml(text);
  const best_practices: BestPracticesEntry[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const validated = validateEntry(entry.fields, entry.lineNo);
    if (seen.has(validated.name)) {
      throw new BestPracticesManifestShapeError(
        `best-practices.yaml entry \`${validated.name}\` at line ${entry.lineNo}: duplicate name (manifest entries must have unique names)`,
      );
    }
    seen.add(validated.name);
    best_practices.push(validated);
  }
  return { best_practices };
}

/**
 * Serialize a `BestPracticesManifest` to `<specsDir>/best-practices.yaml`.
 * Round-trip is verified by `readManifest` — every entry written here must
 * validate on read-back. Empty manifest is serialized as
 * `best_practices: []\n`.
 */
export function writeManifest(specsDir: string, manifest: BestPracticesManifest): void {
  const manifestPath = join(specsDir, "best-practices.yaml");
  if (manifest.best_practices.length === 0) {
    writeFileSync(manifestPath, "best_practices: []\n");
    return;
  }
  const lines: string[] = ["best_practices:"];
  for (const entry of manifest.best_practices) {
    assertEntryShape(entry);
    lines.push(`  - name: ${entry.name}`);
    lines.push(`    path: ${entry.path}`);
    if (entry.scope !== undefined) lines.push(`    scope: ${formatFlowList(entry.scope)}`);
    if (entry.topics !== undefined) lines.push(`    topics: ${formatFlowList(entry.topics)}`);
    if (entry.notes !== undefined) lines.push(`    notes: ${entry.notes}`);
  }
  lines.push("");
  writeFileSync(manifestPath, lines.join("\n"));
}

function formatFlowList(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

/**
 * Validate an entry shape (used by both addEntry and the read-time
 * validator). Centralises the repo-relative path invariant +
 * non-empty-name checks.
 */
function assertEntryShape(entry: BestPracticesEntry): void {
  if (!entry.name || entry.name.length === 0) {
    throw new BestPracticesManifestShapeError(
      "entry is missing required field `name`",
    );
  }
  if (!entry.path || entry.path.length === 0) {
    throw new BestPracticesManifestShapeError(
      `entry \`${entry.name}\` is missing required field \`path\``,
    );
  }
  assertRepoRelativePath(entry.name, entry.path, "entry");
  for (const [field, value] of [
    ["name", entry.name],
    ["path", entry.path],
    ["notes", entry.notes],
  ] as const) {
    // Serialized raw as one manifest line each — a control character (esp. a
    // newline) would splice extra lines into the YAML and break round-trip.
    if (value !== undefined && /[\x00-\x1f\x7f]/.test(value)) {
      throw new BestPracticesManifestShapeError(
        `entry \`${entry.name}\` field \`${field}\` contains a control character — single-line values only`,
      );
    }
  }
}

/**
 * Append `entry` to `manifest.best_practices`, mutating in place and
 * returning the same reference for convenience. Throws on name collision
 * (uniqueness is the manifest's primary invariant) or on a
 * non-repo-relative path.
 */
export function addEntry(
  manifest: BestPracticesManifest,
  entry: BestPracticesEntry,
): BestPracticesManifest {
  assertEntryShape(entry);
  if (manifest.best_practices.some((e) => e.name === entry.name)) {
    throw new BestPracticesManifestShapeError(
      `cannot add entry \`${entry.name}\` — name already present in manifest`,
      `pick a different name, or edit the existing \`${entry.name}\` entry instead.`,
    );
  }
  manifest.best_practices.push(entry);
  return manifest;
}

/**
 * Remove the entry whose name matches `name`. Throws when the name is
 * not in the manifest (callers must verify presence — use `findEntry`
 * for a non-throwing probe).
 */
export function removeEntry(
  manifest: BestPracticesManifest,
  name: string,
): BestPracticesManifest {
  const idx = manifest.best_practices.findIndex((e) => e.name === name);
  if (idx < 0) {
    throw new BestPracticesManifestShapeError(
      `cannot remove entry \`${name}\` — name not present in manifest`,
      `list the manifest's current entries and re-run with one of them.`,
    );
  }
  manifest.best_practices.splice(idx, 1);
  return manifest;
}

/**
 * Non-throwing lookup by entry name. Returns the entry or `undefined`.
 */
export function findEntry(
  manifest: BestPracticesManifest,
  name: string,
): BestPracticesEntry | undefined {
  return manifest.best_practices.find((e) => e.name === name);
}

// ---------------------------------------------------------------------------
// Scope-glob selection (M124) — the deterministic half of the /implement
// Phase 3 best-practices conformance lens.
// ---------------------------------------------------------------------------

/**
 * Compile one `scope` glob to an anchored RegExp. Supported surface:
 *   `**` — any number of path segments (crosses `/`);
 *          `**` followed by `/` collapses to zero-or-more WHOLE segments,
 *          so `src/**` + `/*.ts` matches both `src/a.ts` and `src/a/b.ts`
 *   `*`  — within one segment only (never crosses `/`),
 *          so `*.md` matches `README.md` but not `docs/a.md`
 *   `?`  — exactly one non-separator character
 * Everything else is literal. Matching is against repo-relative paths,
 * full-string anchored — never a substring/`includes` shortcut.
 */
function globToRegExp(glob: string): RegExp {
  // Collapse redundant `**` runs (`****`, `**/**`, `**/**/**`, …) to a single
  // `**` so adjacent (?:[^/]+/)* groups never stack — the stacked form is the
  // classic catastrophic-backtracking shape on long non-matching paths.
  const normalized = glob.replace(/\*{3,}/g, "**").replace(/\*\*(?:\/\*\*)+/g, "**");
  let out = "";
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i]!;
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Select the manifest entries the Phase 3 lens must read for a given
 * changed-file list. Deterministic and pure: manifest order preserved,
 * one row per entry regardless of how many files match, same input ⇒
 * same output. Entries without `scope` always apply (including for an
 * empty changed-file list); a scoped entry applies iff at least one
 * changed file matches at least one of its globs.
 */
export function selectEntriesForChangedFiles(
  manifest: BestPracticesManifest,
  changedFiles: readonly string[],
): BestPracticesEntry[] {
  return manifest.best_practices.filter((entry) => {
    if (entry.scope === undefined) return true;
    const patterns = entry.scope.map(globToRegExp);
    return changedFiles.some((file) => patterns.some((re) => re.test(file)));
  });
}

// ---------------------------------------------------------------------------
// CLI — thin `import.meta.main` wrapper (mirrors smoke_fixture_groups.ts /
// active_plan_ship_ready.ts): one bun-runnable `select` leg so the
// /implement lens resolves its entry set by EXECUTING this module, never by
// re-deriving the glob semantics in prose.
//
// Usage:
//   bun best_practices_manifest.ts select --specs <dir> --files "<paths>"
//
// Prints one `name<TAB>path` line per selected entry, in manifest order,
// exit 0. An absent/empty manifest prints a `no-manifest` disposition line
// (exit 0) — never a silent empty pass, which would be indistinguishable
// from "entries exist, none matched". Bad input exits 2 (the house usage
// code, never a verdict).
// ---------------------------------------------------------------------------

const CLI_USAGE =
  'usage: bun best_practices_manifest.ts select --specs <dir> --files "<changed files, whitespace-separated>"';

function parseCliFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    flags[token.slice(2)] =
      argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")
        ? argv[++i]!
        : "";
  }
  return flags;
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== "select") {
    console.error(
      `best_practices_manifest: unknown command ${JSON.stringify(command ?? "")}\n${CLI_USAGE}`,
    );
    process.exit(2);
  }
  const flags = parseCliFlags(rest);
  const filesRaw = flags["files"];
  if (filesRaw === undefined || filesRaw.trim().length === 0) {
    console.error(
      `best_practices_manifest: select requires --files with at least one changed path\n${CLI_USAGE}`,
    );
    process.exit(2);
  }
  const specsDir = flags["specs"] ?? "specs";
  let manifest: BestPracticesManifest;
  try {
    manifest = readManifest(specsDir);
  } catch (err) {
    // Malformed manifest is a usage-shaped refusal, never a verdict — the
    // NFR-10 canonical refusal text surfaces verbatim.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (manifest.best_practices.length === 0) {
    console.log(
      `no-manifest: best-practices.yaml absent or empty in ${specsDir} — lens skipped`,
    );
    process.exit(0);
  }
  const changed = filesRaw.split(/\s+/).filter(Boolean);
  const selected = selectEntriesForChangedFiles(manifest, changed);
  if (selected.length === 0) {
    // Distinct from the no-manifest disposition above: entries exist, none
    // scoped to these files. Never silent — an empty stdout would collapse
    // the two cases.
    console.log("no-match: entries exist but none scoped to the changed files");
    process.exit(0);
  }
  for (const entry of selected) {
    console.log(`${entry.name}\t${entry.path}`);
  }
  process.exit(0);
}
