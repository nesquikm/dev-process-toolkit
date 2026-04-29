// synthesize_audit — STE-123 helper, extended by STE-153.
//
// Deterministically synthesizes the `## /setup audit` section from /setup's
// in-scope resolved Schema L values table (the values populated during
// steps 7b/7c/7d). Each entry carries a per-resolution `reason:` string —
// `"user-supplied"` or `"default applied"` — so the audit section is a
// complete provenance log of every well-formed /setup run, not only of
// default-applied outcomes (STE-153). Idempotent: existing per-step audit
// entries are preserved verbatim (STE-108 AC-STE-108.7 append-only), and a
// `(step, field)` dedup key prevents double-writes.
//
// Call site: /setup step 8a (AC-STE-123.1) — runs unconditionally before
// the step-8b bootstrap commit whenever the toolkit marker is present and
// at least one Schema L surface is populated. The deterministic
// post-condition makes the audit section a byproduct of every well-formed
// /setup run, satisfying probe-19 at the file-shape level.

import { readFileSync } from "node:fs";
import { appendAuditEntry } from "./audit_log";

/**
 * Per-resolution Schema L entry: the resolved `value` plus the provenance
 * `reason` recorded at /setup step 7b/7c/7d. STE-153 generalised the
 * contract: every resolution records here, not only default-applied ones.
 * `reason` is a free-form string — canonical values are `"user-supplied"`
 * and `"default applied"`, but adapters may extend (e.g., `"pre-existing"`
 * for the idempotent-merge branch).
 */
export interface ResolvedSchemaLEntry<T> {
  value: T;
  reason: string;
}

/**
 * In-scope table /setup populates as steps 7b/7c/7d resolve each Schema L
 * answer. Step 8a passes this table to {@link synthesizeAuditSection}.
 * STE-153: every resolution writes here regardless of provenance, so the
 * table is non-empty for every well-formed /setup run that produces a
 * toolkit-managed file with at least one Schema L surface populated.
 */
export interface ResolvedSchemaLValues {
  /** ISO date (`YYYY-MM-DD`). */
  date: string;
  branchTemplate?: ResolvedSchemaLEntry<string>;
  docsUserFacing?: ResolvedSchemaLEntry<boolean>;
  docsPackages?: ResolvedSchemaLEntry<boolean>;
  docsChangelogCi?: ResolvedSchemaLEntry<boolean>;
}

/**
 * Defensive invariant. /setup step 8a (AC-STE-123.4) surfaces this when the
 * resolved Schema L values table is empty — e.g., a programming-error path
 * where 7b/7c/7d skipped their in-memory record. Aborts the bootstrap
 * commit before malformed output lands in git.
 *
 * **Unreachable on the canonical /setup path post-STE-153.** Every
 * Schema L resolution at 7b/7c/7d records into the table regardless of
 * provenance (`"user-supplied"` or `"default applied"`), so the canonical
 * 7b/7c/7d → 8a flow always carries at least one entry whenever the file
 * has any Schema L surface populated. This throw remains as a defensive
 * tripwire for genuinely inconsistent in-memory state, not as a normal
 * exit path.
 */
export class AuditPostconditionUnsatisfiable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditPostconditionUnsatisfiable";
  }
}

interface Candidate {
  step: string;
  field: string;
  value: unknown;
  reason: string;
}

function collectCandidates(d: ResolvedSchemaLValues): Candidate[] {
  const out: Candidate[] = [];
  if (d.branchTemplate) {
    out.push({
      step: "7c",
      field: "branch_template",
      value: d.branchTemplate.value,
      reason: d.branchTemplate.reason,
    });
  }
  if (d.docsUserFacing) {
    out.push({
      step: "7d",
      field: "docs.user_facing_mode",
      value: d.docsUserFacing.value,
      reason: d.docsUserFacing.reason,
    });
  }
  if (d.docsPackages) {
    out.push({
      step: "7d",
      field: "docs.packages_mode",
      value: d.docsPackages.value,
      reason: d.docsPackages.reason,
    });
  }
  if (d.docsChangelogCi) {
    out.push({
      step: "7d",
      field: "docs.changelog_ci_owned",
      value: d.docsChangelogCi.value,
      reason: d.docsChangelogCi.reason,
    });
  }
  return out;
}

const ENTRY_LINE_RE = /^- \d{4}-\d{2}-\d{2} step:(\S+) \(([^)]+)\) value:/;

/**
 * Parse existing audit-section entries and return the set of `${step}:${field}`
 * dedup keys. Preserves `appendAuditEntry`'s append-only contract — never
 * rewrites or removes entries, just records what's already there.
 */
function parseExistingAuditEntries(content: string): Set<string> {
  const keys = new Set<string>();
  const lines = content.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (line === "## /setup audit") {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s/.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const m = ENTRY_LINE_RE.exec(line);
    if (!m) continue;
    keys.add(`${m[1]}:${m[2]}`);
  }
  return keys;
}

/**
 * Synthesize the `## /setup audit` section from the in-scope resolved Schema L
 * values table. Reads CLAUDE.md once to detect existing entries (idempotent),
 * then calls `appendAuditEntry` once per missing resolution. Each entry's
 * provenance is preserved per-resolution via the entry's `reason` string —
 * `"user-supplied"` or `"default applied"` (or any other adapter-extended
 * value).
 *
 * @returns counts of `synthesized` (newly written) and `skipped` (already present).
 * @throws {AuditPostconditionUnsatisfiable} when the resolved Schema L values
 *   table is empty (defensive invariant; unreachable on the canonical
 *   /setup 7b/7c/7d → 8a path post-STE-153).
 */
export function synthesizeAuditSection(
  claudeMdPath: string,
  resolvedSchemaLValues: ResolvedSchemaLValues,
): { synthesized: number; skipped: number } {
  const candidates = collectCandidates(resolvedSchemaLValues);
  if (candidates.length === 0) {
    throw new AuditPostconditionUnsatisfiable(
      "synthesize_audit: resolved Schema L values table empty — cannot synthesize audit section. " +
        "Investigate: CLAUDE.md shows audit-required Schema L surfaces but /setup's in-memory " +
        "resolved-values map has no entries. Step 7b/7c/7d may have skipped its in-memory record.",
    );
  }
  const content = readFileSync(claudeMdPath, "utf-8");
  const existing = parseExistingAuditEntries(content);

  let synthesized = 0;
  let skipped = 0;
  for (const c of candidates) {
    const key = `${c.step}:${c.field}`;
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    appendAuditEntry(claudeMdPath, {
      date: resolvedSchemaLValues.date,
      step: c.step,
      field: c.field,
      value: c.value,
      reason: c.reason,
    });
    synthesized++;
  }
  return { synthesized, skipped };
}
