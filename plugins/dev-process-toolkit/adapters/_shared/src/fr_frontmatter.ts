// fr_frontmatter — STE-121 helper. Canonical YAML frontmatter for FR files.
//
// Two branches:
//   - mode: none      → `id: fr_<26-char ULID>` block, no `tracker:` block
//   - tracker mode    → no `id:` field, compact `tracker:\n  <key>: <id>` block
//
// /spec-write step 0b mandates this helper (AC-STE-121.2). Hand-rolled YAML
// is the regression source the M29 prose flip didn't catch — the helper is
// the system-enforced canonical-shape generator that closes that gap.
//
// `runFrontmatterShapeCheck` is the in-band post-write self-check (AC-STE-121.3):
// /spec-write calls it after Provider.sync(spec) returns; if probe-13 logic
// flags the just-written file, it throws `FRFrontmatterShapeError` with NFR-10
// canonical shape. Probe-13 stays at gate time as the safety net.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { normalizeFrontmatterSource } from "./frontmatter";
import { runIdentityModeConditionalProbe } from "./identity_mode_conditional";

export interface FRFrontmatterInput {
  /** ULID (`fr_<26 chars>`). Required in mode-none, forbidden in tracker mode. */
  id?: string;
  title: string;
  milestone: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface TrackerBinding {
  /** Adapter key (e.g., `"linear"`, `"jira"`). Out-of-tree adapters welcome. */
  key: string;
  /** Tracker-allocated ID (e.g., `"STE-121"`). */
  id: string;
}

export class InvalidFrontmatterInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFrontmatterInputError";
  }
}

export class InvalidTrackerShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTrackerShapeError";
  }
}

/**
 * Surfaced by /spec-write's post-write self-check (AC-STE-121.3) when the
 * just-written FR file fails probe-13's `identity_mode_conditional` logic
 * — the second-line defense for hand-rolled YAML or helper bugs.
 */
export class FRFrontmatterShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FRFrontmatterShapeError";
  }
}

// YAML scalars that contain `:`, `#`, `"`, `\`, or start with whitespace
// require quoting. Em-dash (U+2014) and other non-ASCII printables do not.
function escapeYamlScalar(s: string): string {
  if (s.length === 0) return JSON.stringify(s);
  if (/^\s/.test(s)) return JSON.stringify(s);
  if (/["\\:#]/.test(s)) return JSON.stringify(s);
  return s;
}

export interface BuildFRFrontmatterOpts {
  /**
   * STE-227 AC-STE-227.2 — when explicitly `true`, emit a
   * `needs_technical_review: true` line after the `tracker:` block (or `id:`
   * line in mode-none) and before `created_at:`. Absent / `undefined` /
   * `false` produce byte-identical output with the field omitted entirely.
   */
  needsTechnicalReview?: boolean;
  /**
   * STE-381 AC-STE-381.2 — when provided, emit a
   * `changelog_category: <value>` line after `created_at:` (the shipped
   * M102-era file shape). Value comes from the closed Keep-a-Changelog set
   * {Added, Changed, Deprecated, Removed, Fixed, Security}. Absent /
   * `undefined` produce byte-identical output with the field omitted
   * entirely.
   */
  changelogCategory?: "Added" | "Changed" | "Deprecated" | "Removed" | "Fixed" | "Security" | string;
}

/**
 * Build the canonical FR-file frontmatter block. Returned string includes
 * leading and trailing `---\n` delimiters and a trailing newline.
 *
 * Field ordering (both modes):
 *   title → milestone → status → archived_at → (id | tracker)
 *     → [needs_technical_review] → created_at → [changelog_category]
 *
 * Throws:
 *   - {@link InvalidFrontmatterInputError} when `spec.id` and `trackerBinding`
 *     mismatch the active mode (mode-none requires id; tracker mode forbids id).
 *   - {@link InvalidTrackerShapeError} when `trackerBinding` carries a `url`
 *     property (verbose `{ key, id, url }` shape forbidden per STE-110 AC-STE-110.2).
 */
export function buildFRFrontmatter(
  spec: FRFrontmatterInput,
  trackerBinding?: TrackerBinding,
  opts?: BuildFRFrontmatterOpts,
): string {
  if (trackerBinding && spec.id) {
    throw new InvalidFrontmatterInputError(
      "tracker mode forbids id: field — pass spec.id=undefined when trackerBinding is provided",
    );
  }
  if (!trackerBinding && !spec.id) {
    throw new InvalidFrontmatterInputError(
      "mode-none requires spec.id (fr_<ULID>) — pass trackerBinding when in tracker mode",
    );
  }
  if (trackerBinding && Object.prototype.hasOwnProperty.call(trackerBinding, "url")) {
    throw new InvalidTrackerShapeError(
      "verbose tracker shape forbidden per STE-110 AC-STE-110.2 — pass { key, id } only",
    );
  }

  const lines: string[] = ["---"];
  lines.push(`title: ${escapeYamlScalar(spec.title)}`);
  lines.push(`milestone: ${spec.milestone}`);
  lines.push("status: active");
  lines.push("archived_at: null");
  if (spec.id) {
    lines.push(`id: ${spec.id}`);
  } else if (trackerBinding) {
    lines.push("tracker:");
    lines.push(`  ${trackerBinding.key}: ${trackerBinding.id}`);
  }
  if (opts?.needsTechnicalReview === true) {
    lines.push("needs_technical_review: true");
  }
  lines.push(`created_at: ${spec.createdAt}`);
  if (opts?.changelogCategory !== undefined) {
    lines.push(`changelog_category: ${opts.changelogCategory}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/**
 * Frontmatter keys whose value is the literal word `undefined`, nested keys
 * included (`tracker.undefined`). Reads the file's own bytes rather than a
 * parsed object, because the shape this catches is a template that wrote the
 * word out — a parser would hand back the STRING "undefined" and lose which key
 * carried it.
 */
function frontmatterUndefinedKeys(frFilePath: string): string[] {
  let text: string;
  try {
    text = readFileSync(frFilePath, "utf-8");
  } catch {
    return []; // an unreadable file is the probe's to report, not this scan's
  }
  // Through the shared normalizer, not a local CRLF replace: a BOM'd file would
  // otherwise fail the opener match and read as "no frontmatter", and the
  // structural sweep in the suite exists to catch exactly that hand-roll.
  const m = /^---\n([\s\S]*?)\n---/.exec(normalizeFrontmatterSource(text));
  if (!m) return [];
  const out: string[] = [];
  let parent = "";
  for (const line of m[1]!.split("\n")) {
    const kv = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, value] = kv as unknown as [string, string, string, string];
    const nested = indent.length > 0;
    if (!nested) parent = key;
    const name = nested ? `${parent}.${key}` : key;
    if (key === "undefined" || value.trim() === "undefined") out.push(name);
  }
  return out;
}

/**
 * /spec-write post-write self-check (AC-STE-121.3). Runs probe-13's
 * `runIdentityModeConditionalProbe` against the just-written FR file.
 * Throws `FRFrontmatterShapeError` (NFR-10 canonical shape) if violations
 * scoped to `frFilePath` surface — the LLM hand-rolled YAML, mutated the
 * environment, or the helper has a bug. The check is a no-op when the file
 * is canonical.
 *
 * Call site: /spec-write step 0b, immediately after `Provider.sync(spec)`
 * returns (so the tracker-id is bound before validation).
 */
export async function runFrontmatterShapeCheck(
  projectRoot: string,
  frFilePath: string,
): Promise<void> {
  // The probe below decides the PRESENCE or ABSENCE of `id:` and looks at no
  // other key, so this check's promise to catch "the LLM hand-rolled YAML" was
  // wider than what it did: a file carrying `tracker:\n  undefined: undefined`
  // and `created_at: undefined` passed it (measured on live leg 2, 2026-09-23).
  // The literal word `undefined` in a value is never something a writer emits —
  // it is a template that interpolated a missing variable — so it is refused
  // here by name, before the probe runs.
  const undefinedKeys = frontmatterUndefinedKeys(frFilePath);
  if (undefinedKeys.length > 0) {
    throw new FRFrontmatterShapeError(
      [
        `Refusing: ${relative(projectRoot, frFilePath)} carries the literal value \`undefined\` for: ${undefinedKeys.join(", ")}. A frontmatter value is never the word undefined; a template interpolated a variable it did not have.`,
        `Remedy: call buildFRFrontmatter(spec, trackerBinding?) from adapters/_shared/src/fr_frontmatter.ts and retry`,
        `Context: mode=spec-write, ticket=unbound, skill=spec-write, hook=post-write-self-check`,
      ].join("\n"),
    );
  }
  const report = await runIdentityModeConditionalProbe(projectRoot);
  const target = resolve(frFilePath);
  const scoped = report.violations.filter((v) => resolve(v.file) === target);
  if (scoped.length === 0) return;
  const v = scoped[0]!;
  // NFR-10 canonical shape: verdict + remedy + context fused. The probe
  // already produced the full message; surface it verbatim and tag the
  // remedy with the helper-call instruction.
  throw new FRFrontmatterShapeError(
    [
      v.message,
      `Remedy: call buildFRFrontmatter(spec, trackerBinding?) from adapters/_shared/src/fr_frontmatter.ts and retry`,
    ].join("\n"),
  );
}
