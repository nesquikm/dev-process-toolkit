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

import { resolve } from "node:path";
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

/**
 * Build the canonical FR-file frontmatter block. Returned string includes
 * leading and trailing `---\n` delimiters and a trailing newline.
 *
 * Field ordering (both modes):
 *   title → milestone → status → archived_at → (id | tracker) → created_at
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
  lines.push(`created_at: ${spec.createdAt}`);
  lines.push("---");
  return lines.join("\n") + "\n";
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
