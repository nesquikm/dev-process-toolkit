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

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface BestPracticesEntry {
  name: string;
  path: string;
  scope?: string[];
  topics?: string[];
  notes?: string;
  max_bytes?: number;
  sha256?: string;
}

export interface BestPracticesManifest {
  best_practices: BestPracticesEntry[];
}

/**
 * True when `path` names a regular file — the only thing a best-practices
 * document can be. A directory or other non-file passes `existsSync` and
 * `statSync` but cannot be read as a document (EISDIR), so every reader asks
 * this one question instead of `existsSync` alone.
 */
export function isRegularDocument(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** sha256 hex digest over bytes already in memory. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * sha256 hex digest over a document's bytes. Shared by the `select` leg and
 * the /gate-check probe #91 (`best_practices_digest_match.ts`), so the two
 * can never disagree on what a document's digest is (STE-879).
 */
export function documentSha256(path: string): string {
  return sha256Hex(readFileSync(path));
}

/** A `max_bytes` value as text: a positive decimal integer, no sign, no leading zero. */
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

/** Closed-enum entry-key consts (M124) — the /best-practices add/edit field
 * prompts validate against these; exporting changes no behavior. */
export const KNOWN_KEYS: readonly string[] = ["name", "path", "scope", "topics", "notes", "max_bytes", "sha256"];
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
  if (fields["max_bytes"] !== undefined) {
    const raw = stripQuotes(fields["max_bytes"]);
    if (!POSITIVE_INT_RE.test(raw)) {
      throw new BestPracticesManifestShapeError(
        `best-practices.yaml entry \`${name}\` at line ${lineNo}: field \`max_bytes\` must be a positive integer, got ${JSON.stringify(raw)}`,
      );
    }
    entry.max_bytes = Number(raw);
  }
  if (fields["sha256"] !== undefined) {
    entry.sha256 = stripQuotes(fields["sha256"]);
    assertEntryShape(entry);
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
  return parseManifestText(text);
}

/** Parse manifest TEXT exactly as `readManifest` parses the file — the one parser. */
export function parseManifestText(text: string): BestPracticesManifest {
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
  writeFileSync(join(specsDir, "best-practices.yaml"), renderManifestText(manifest));
}

/** The exact bytes `writeManifest` writes for `manifest`. */
export function renderManifestText(manifest: BestPracticesManifest): string {
  if (manifest.best_practices.length === 0) return "best_practices: []\n";
  const lines: string[] = ["best_practices:"];
  for (const entry of manifest.best_practices) {
    assertEntryShape(entry);
    lines.push(`  - name: ${entry.name}`);
    lines.push(`    path: ${entry.path}`);
    if (entry.scope !== undefined) lines.push(`    scope: ${formatFlowList(entry.scope)}`);
    if (entry.topics !== undefined) lines.push(`    topics: ${formatFlowList(entry.topics)}`);
    if (entry.notes !== undefined) lines.push(`    notes: ${entry.notes}`);
    if (entry.max_bytes !== undefined) lines.push(`    max_bytes: ${entry.max_bytes}`);
    if (entry.sha256 !== undefined) lines.push(`    sha256: ${entry.sha256}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Entries compared field by field, key order ignored. */
function canonicalEntries(manifest: BestPracticesManifest): string {
  return JSON.stringify(
    manifest.best_practices.map((e) =>
      Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))),
    ),
  );
}

/**
 * Write `manifest` only if its rendered text reads back as exactly these
 * entries (STE-879 review). The parser trims and strips quotes, so a value
 * written verbatim could otherwise read back as another — a `kettle ` beside
 * `kettle` would leave a manifest every later read refuses. A refusal throws
 * before any write, so the file on disk stays byte-identical.
 */
function writeManifestVerified(specsDir: string, manifest: BestPracticesManifest): void {
  const text = renderManifestText(manifest);
  let readBack: BestPracticesManifest;
  try {
    readBack = parseManifestText(text);
  } catch (err) {
    throw new BestPracticesManifestShapeError(
      `the manifest this change would write does not read back: ${err instanceof Error ? err.message : String(err)}`,
      `pass names, paths and notes without leading or trailing spaces or surrounding quotes, then re-run.`,
    );
  }
  if (canonicalEntries(readBack) !== canonicalEntries(manifest)) {
    throw new BestPracticesManifestShapeError(
      `the manifest this change would write reads back differently (a value would be trimmed or unquoted on read)`,
      `pass names, paths and notes without leading or trailing spaces or surrounding quotes, then re-run.`,
    );
  }
  writeFileSync(join(specsDir, "best-practices.yaml"), text);
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
  if (
    entry.max_bytes !== undefined &&
    !(Number.isSafeInteger(entry.max_bytes) && entry.max_bytes > 0)
  ) {
    throw new BestPracticesManifestShapeError(
      `entry \`${entry.name}\` field \`max_bytes\` must be a positive integer, got ${JSON.stringify(entry.max_bytes)}`,
    );
  }
  if (entry.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new BestPracticesManifestShapeError(
      `entry \`${entry.name}\` field \`sha256\` must be 64 lowercase hex characters, got ${JSON.stringify(entry.sha256)}`,
    );
  }
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
// Prints one `name<TAB>path<TAB><bytes><TAB><sha256>` line per selected entry, in manifest order,
// exit 0. An absent/empty manifest prints a `no-manifest` disposition line
// (exit 0) — never a silent empty pass, which would be indistinguishable
// from "entries exist, none matched". Bad input exits 2 (the house usage
// code, never a verdict).
// ---------------------------------------------------------------------------

const CLI_USAGE = [
  'usage: bun best_practices_manifest.ts select --specs <dir> --files "<changed files, whitespace-separated>"',
  '       bun best_practices_manifest.ts add --specs <dir> --name <n> --path <p> [--scope "<globs>"] [--topics "<t1,t2>"] [--notes "<text>"] [--max-bytes <N>] [--sha256 <hex>]',
  "       bun best_practices_manifest.ts remove --specs <dir> --name <n>",
].join("\n");

/**
 * The `add` leg (AC-STE-879.1): build the entry from the flags, validate it
 * through `addEntry`, check the document exists under the repo root (the
 * specs directory's parent — the skill's `existsSync(join(repoRoot, path))`
 * rule), then persist with `writeManifest`. Every refusal throws before the
 * write, so the manifest is untouched.
 */
function runAddCommand(flags: Record<string, string>): void {
  const specsDir = flags["specs"] ?? "specs";
  const manifest = readManifest(specsDir);
  const entry: BestPracticesEntry = { name: flags["name"] ?? "", path: flags["path"] ?? "" };
  if (flags["scope"] !== undefined) entry.scope = flags["scope"].split(/\s+/).filter(Boolean);
  if (flags["topics"] !== undefined) {
    entry.topics = flags["topics"].split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (flags["notes"] !== undefined) entry.notes = flags["notes"];
  if (flags["max-bytes"] !== undefined) {
    const raw = flags["max-bytes"];
    if (!POSITIVE_INT_RE.test(raw)) {
      throw new BestPracticesManifestShapeError(
        `cannot add entry \`${entry.name}\` — --max-bytes must be a positive integer, got \`${raw}\``,
        `pass --max-bytes as a whole number of bytes greater than zero (e.g. --max-bytes 65536).`,
      );
    }
    entry.max_bytes = Number(raw);
  }
  if (flags["sha256"] !== undefined) entry.sha256 = flags["sha256"];
  addEntry(manifest, entry);
  const repoRoot = dirname(resolve(specsDir));
  if (!isRegularDocument(join(repoRoot, entry.path))) {
    throw new BestPracticesManifestShapeError(
      `cannot add entry \`${entry.name}\` — document \`${entry.path}\` does not exist or is not a regular file`,
      `create ${entry.path} first, or fix the path, then re-run add.`,
    );
  }
  writeManifestVerified(specsDir, manifest);
}

/**
 * The `remove` leg (AC-STE-879.2): remove the named entry through
 * `removeEntry`, then persist. An unknown name throws before the write, so
 * the manifest stays byte-identical.
 */
function runRemoveCommand(flags: Record<string, string>): void {
  const specsDir = flags["specs"] ?? "specs";
  const manifest = readManifest(specsDir);
  removeEntry(manifest, flags["name"] ?? "");
  writeManifestVerified(specsDir, manifest);
}

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
  if (command === "add" || command === "remove") {
    try {
      (command === "add" ? runAddCommand : runRemoveCommand)(parseCliFlags(rest));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    process.exit(0);
  }
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
  // Documents resolve against the specs directory's parent — the same base the
  // `add` leg and probe #91 use — never the process cwd.
  const repoRoot = dirname(resolve(specsDir));
  for (const entry of selected) {
    const docAbs = join(repoRoot, entry.path);
    // AC-STE-878.4: a missing document is a per-entry refusal, never exit 2.
    // A directory is no document either: it refuses the same way.
    if (!isRegularDocument(docAbs)) {
      console.log(`refused: ${entry.name} missing`);
      continue;
    }
    // AC-STE-878.3: size check before the read — a refused document is never read.
    const statBytes = statSync(docAbs).size;
    if (entry.max_bytes !== undefined && statBytes > entry.max_bytes) {
      console.log(`refused: ${entry.name} ${statBytes}`);
      continue;
    }
    // One read feeds both the printed size and the digest, so they always
    // describe the same bytes even if the file changed after the stat.
    let content: Buffer;
    try {
      content = readFileSync(docAbs);
    } catch {
      console.log(`refused: ${entry.name} missing`);
      continue;
    }
    const bytes = content.length;
    if (entry.max_bytes !== undefined && bytes > entry.max_bytes) {
      console.log(`refused: ${entry.name} ${bytes}`);
      continue;
    }
    const sha256 = sha256Hex(content);
    // AC-STE-879.5: a declared digest that no longer matches refuses the entry.
    if (entry.sha256 !== undefined && entry.sha256 !== sha256) {
      console.log(`refused: ${entry.name} sha256 ${sha256}`);
      continue;
    }
    console.log(`${entry.name}\t${entry.path}\t${bytes}\t${sha256}`);
  }
  process.exit(0);
}
