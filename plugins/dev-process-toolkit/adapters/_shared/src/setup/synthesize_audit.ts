// synthesize_audit — STE-123 helper.
//
// Deterministically synthesizes the `## /setup audit` section from /setup's
// in-scope resolved-defaults table (the values populated during steps
// 7b/7c/7d). Idempotent: existing per-step audit entries are preserved
// verbatim (STE-108 AC-STE-108.7 append-only), and a `(step, field)`
// dedup key prevents double-writes.
//
// Call site: /setup step 8a (AC-STE-123.1) — runs unconditionally before the
// step-8b bootstrap commit. The deterministic post-condition makes the
// audit section a byproduct of any /setup run with default-applied outcomes,
// satisfying probe-19 at the file-shape level.

import { readFileSync } from "node:fs";
import { appendAuditEntry } from "./audit_log";

export interface ResolvedDefaultEntry<T> {
  value: T;
  reason: string;
}

export interface ResolvedDefaults {
  /** ISO date (`YYYY-MM-DD`). */
  date: string;
  branchTemplate?: ResolvedDefaultEntry<string>;
  docsUserFacing?: ResolvedDefaultEntry<boolean>;
  docsPackages?: ResolvedDefaultEntry<boolean>;
  docsChangelogCi?: ResolvedDefaultEntry<boolean>;
}

/**
 * Surfaced by /setup step 8a (AC-STE-123.4) when `hasDefaultApplicableOutcomes`
 * returns true (the file shows default-applied outcomes) but the
 * resolved-defaults table is empty — an invariant violation indicating
 * /setup got into an inconsistent in-memory state. Aborts the bootstrap
 * commit before malformed output lands in git.
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

function collectCandidates(d: ResolvedDefaults): Candidate[] {
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
 * Synthesize the `## /setup audit` section from the in-scope resolved-defaults
 * table. Reads CLAUDE.md once to detect existing entries (idempotent), then
 * calls `appendAuditEntry` once per missing default-applied outcome.
 *
 * @returns counts of `synthesized` (newly written) and `skipped` (already present).
 * @throws {AuditPostconditionUnsatisfiable} when the resolved-defaults table is empty.
 */
export function synthesizeAuditSection(
  claudeMdPath: string,
  resolvedDefaults: ResolvedDefaults,
): { synthesized: number; skipped: number } {
  const candidates = collectCandidates(resolvedDefaults);
  if (candidates.length === 0) {
    throw new AuditPostconditionUnsatisfiable(
      "synthesize_audit: resolved-defaults table empty — cannot synthesize audit section. " +
        "Investigate: CLAUDE.md shows default-applied outcomes but /setup's in-memory " +
        "resolved-defaults map has no entries. Step 7b/7c/7d may have skipped its in-memory record.",
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
      date: resolvedDefaults.date,
      step: c.step,
      field: c.field,
      value: c.value,
      reason: c.reason,
    });
    synthesized++;
  }
  return { synthesized, skipped };
}
