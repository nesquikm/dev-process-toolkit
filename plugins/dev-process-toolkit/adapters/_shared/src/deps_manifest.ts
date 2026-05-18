// STE-301 — Dependency manifest helpers.
//
// Reads, writes, and mutates `specs/deps.yaml`: the git-tracked catalog of
// sibling-directory dependencies consumed by `/deps` (management surface)
// and `/deps-research` (read-only retrieval fork). Schema:
//
//     deps:
//       - name: my-internal-sdk
//         path: ../my-internal-sdk
//         origin: git@github.com:acme/my-internal-sdk.git
//         ref: main
//         kind: toolkit-docs
//
// `kind: toolkit-docs` is the only supported value in M78 — future-proof
// slot for non-toolkit doc formats. `path` MUST start with `../`
// (sibling-only invariant enforced at read + add time, plus by the
// `resolveSiblingPath` resolver).
//
// Design rationale (matches `frontmatter.ts`): the schema is tight enough
// that we hand-roll the parser rather than pull a YAML dep. The shape is a
// single top-level `deps:` block list whose entries are flat scalar maps —
// no nested maps, no flow style. Anything outside that surface throws
// `DepsManifestShapeError` carrying the NFR-10 canonical refusal shape
// (Refusing: ... / Remedy: ... / Context: ...) so callers can surface the
// failure verbatim to the operator.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type DepsKind = "toolkit-docs";

export interface DepsEntry {
  name: string;
  path: string;
  origin?: string;
  ref?: string;
  kind: DepsKind;
}

export interface DepsManifest {
  deps: DepsEntry[];
}

const SUPPORTED_KINDS: readonly string[] = ["toolkit-docs"];

/**
 * Thrown when the manifest file or an entry violates the schema. The
 * message follows the NFR-10 canonical refusal shape — Refusing / Remedy
 * / Context lines — so callers can render it verbatim without
 * re-templating.
 */
export class DepsManifestShapeError extends Error {
  readonly reason: string;
  constructor(reason: string, remedy?: string, context?: string) {
    const remedyLine = remedy ?? "fix specs/deps.yaml to conform to the manifest schema and re-run.";
    const contextLine = context ?? "mode=deps-manifest, file=specs/deps.yaml";
    super(
      [
        `Refusing: ${reason}`,
        `Remedy: ${remedyLine}`,
        `Context: ${contextLine}`,
      ].join("\n"),
    );
    this.name = "DepsManifestShapeError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Parser — minimal scoped YAML covering the deps.yaml schema only.
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
  // Locate the `deps:` top-level key.
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
    throw new DepsManifestShapeError(
      "deps.yaml is empty — expected top-level `deps:` key",
    );
  }
  const header = lines[i]!;
  const headerTrimmed = header.trim();
  if (headerTrimmed === "deps: []") return [];
  if (!/^deps:\s*$/.test(header)) {
    throw new DepsManifestShapeError(
      `deps.yaml line ${i + 1}: expected top-level \`deps:\` key, got ${JSON.stringify(header)}`,
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
      current.fields[key!] = stripQuotes(value!.trim());
      entries.push(current);
      continue;
    }
    // Continuation field: `    key: value` (deeper indent than `-` marker).
    const fieldMatch = /^(\s+)([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(raw);
    if (fieldMatch && current !== null) {
      const [, , key, value] = fieldMatch;
      current.fields[key!] = stripQuotes(value!.trim());
      continue;
    }
    throw new DepsManifestShapeError(
      `deps.yaml line ${i + 1}: unrecognized line ${JSON.stringify(raw)} — expected block-list entry or scalar field`,
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

function validateEntry(fields: Record<string, string>, lineNo: number): DepsEntry {
  const name = fields["name"];
  const path = fields["path"];
  const kind = fields["kind"];
  if (!name) {
    throw new DepsManifestShapeError(
      `deps.yaml entry at line ${lineNo}: missing required field \`name\``,
    );
  }
  if (!path) {
    throw new DepsManifestShapeError(
      `deps.yaml entry \`${name}\` at line ${lineNo}: missing required field \`path\``,
    );
  }
  if (!kind) {
    throw new DepsManifestShapeError(
      `deps.yaml entry \`${name}\` at line ${lineNo}: missing required field \`kind\``,
    );
  }
  if (!SUPPORTED_KINDS.includes(kind)) {
    throw new DepsManifestShapeError(
      `deps.yaml entry \`${name}\` at line ${lineNo}: kind \`${kind}\` is not supported (expected one of: ${SUPPORTED_KINDS.join(", ")})`,
    );
  }
  if (!path.startsWith("../")) {
    throw new DepsManifestShapeError(
      `deps.yaml entry \`${name}\` at line ${lineNo}: path \`${path}\` must start with \`../\` (sibling-only constraint)`,
    );
  }
  const entry: DepsEntry = { name, path, kind: kind as DepsKind };
  if (fields["origin"]) entry.origin = fields["origin"];
  if (fields["ref"]) entry.ref = fields["ref"];
  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read `<specsDir>/deps.yaml` and return a typed `DepsManifest`. Absent
 * file is the canonical empty manifest — `{ deps: [] }` — not an error
 * (consumers without sibling deps are common). Malformed YAML, missing
 * `deps:` key, bad entry shape, or non-sibling `path` all throw
 * `DepsManifestShapeError` carrying NFR-10 canonical refusal text.
 */
export function readManifest(specsDir: string): DepsManifest {
  const manifestPath = join(specsDir, "deps.yaml");
  if (!existsSync(manifestPath)) return { deps: [] };
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new DepsManifestShapeError(
      `cannot read deps.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = parseManifestYaml(text);
  const deps: DepsEntry[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const validated = validateEntry(entry.fields, entry.lineNo);
    if (seen.has(validated.name)) {
      throw new DepsManifestShapeError(
        `deps.yaml entry \`${validated.name}\` at line ${entry.lineNo}: duplicate name (manifest entries must have unique names)`,
      );
    }
    seen.add(validated.name);
    deps.push(validated);
  }
  return { deps };
}

/**
 * Serialize a `DepsManifest` to `<specsDir>/deps.yaml`. Round-trip is
 * verified by `readManifest` — every entry written here must validate on
 * read-back. Empty manifest is serialized as `deps: []\n`.
 */
export function writeManifest(specsDir: string, manifest: DepsManifest): void {
  const manifestPath = join(specsDir, "deps.yaml");
  if (manifest.deps.length === 0) {
    writeFileSync(manifestPath, "deps: []\n");
    return;
  }
  const lines: string[] = ["deps:"];
  for (const entry of manifest.deps) {
    lines.push(`  - name: ${entry.name}`);
    lines.push(`    path: ${entry.path}`);
    if (entry.origin !== undefined) lines.push(`    origin: ${entry.origin}`);
    if (entry.ref !== undefined) lines.push(`    ref: ${entry.ref}`);
    lines.push(`    kind: ${entry.kind}`);
  }
  lines.push("");
  writeFileSync(manifestPath, lines.join("\n"));
}

/**
 * Validate an entry shape (used by both addEntry and the read-time
 * validator). Centralises the sibling-only invariant + kind allowlist
 * + non-empty-name checks.
 */
function assertEntryShape(entry: DepsEntry): void {
  if (!entry.name || entry.name.length === 0) {
    throw new DepsManifestShapeError(
      "entry is missing required field `name`",
    );
  }
  if (!entry.path || entry.path.length === 0) {
    throw new DepsManifestShapeError(
      `entry \`${entry.name}\` is missing required field \`path\``,
    );
  }
  if (!entry.path.startsWith("../")) {
    throw new DepsManifestShapeError(
      `entry \`${entry.name}\` has path \`${entry.path}\` — must start with \`../\` (sibling-only constraint)`,
    );
  }
  if (!SUPPORTED_KINDS.includes(entry.kind)) {
    throw new DepsManifestShapeError(
      `entry \`${entry.name}\` has kind \`${entry.kind}\` — must be one of: ${SUPPORTED_KINDS.join(", ")}`,
    );
  }
}

/**
 * Append `entry` to `manifest.deps`, mutating in place and returning the
 * same reference for convenience. Throws on name collision (uniqueness
 * is the manifest's primary invariant), on non-`../` path (sibling-only),
 * or on unsupported `kind`.
 */
export function addEntry(manifest: DepsManifest, entry: DepsEntry): DepsManifest {
  assertEntryShape(entry);
  if (manifest.deps.some((e) => e.name === entry.name)) {
    throw new DepsManifestShapeError(
      `cannot add entry \`${entry.name}\` — name already present in manifest`,
      `pick a different name, or run \`/deps edit ${entry.name}\` to update the existing entry.`,
    );
  }
  manifest.deps.push(entry);
  return manifest;
}

/**
 * Remove the entry whose name matches `name`. Throws when the name is
 * not in the manifest (callers must verify presence — use `findEntry`
 * for a non-throwing probe).
 */
export function removeEntry(manifest: DepsManifest, name: string): DepsManifest {
  const idx = manifest.deps.findIndex((e) => e.name === name);
  if (idx < 0) {
    throw new DepsManifestShapeError(
      `cannot remove entry \`${name}\` — name not present in manifest`,
      `run \`/deps list\` to see the current entries.`,
    );
  }
  manifest.deps.splice(idx, 1);
  return manifest;
}

/**
 * Non-throwing lookup by entry name. Returns the entry or `undefined`.
 */
export function findEntry(
  manifest: DepsManifest,
  name: string,
): DepsEntry | undefined {
  return manifest.deps.find((e) => e.name === name);
}

/**
 * Resolve `entry.path` against `consumerRepoRoot`, returning an absolute
 * path. The sibling-only invariant is re-asserted here (defense in depth
 * — callers may have built the entry outside the read/add validators).
 */
export function resolveSiblingPath(
  consumerRepoRoot: string,
  entry: DepsEntry,
): string {
  if (!entry.path.startsWith("../")) {
    throw new DepsManifestShapeError(
      `entry \`${entry.name}\` has path \`${entry.path}\` — must start with \`../\` (sibling-only constraint)`,
      `update the entry's \`path\` to a sibling-relative form (e.g., \`../${entry.name}\`).`,
    );
  }
  return resolve(consumerRepoRoot, entry.path);
}
