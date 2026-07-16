// migrate_branch_template — STE-388 AC-STE-388.6.
//
// `/setup --migrate` branch-template re-seed. When CLAUDE.md carries a
// `branch_template:` whose value is byte-identical to the retired seeded
// default `{type}/{ticket-id}-{slug}`, rewrite it to the canonical
// milestone-keyed template `{type}/m{N}-{slug}` and log the re-seed in
// `## /setup audit` (via `appendAuditRow`, which creates the section when
// absent). Any other value — customized, already-canonical, or a near-miss
// of the retired default — is preserved verbatim, and an absent key stays
// absent: the no-op paths never touch the file, so re-running is free.
//
// The two template constants are imported from `../branch_proposal.ts`
// (the selector's milestone-keyed form and its ticket-keyed fallback) and
// re-exported under their re-seed roles; `canonicalBranchTemplate` remains
// the single source of truth for which form `/setup` seeds.

import { readFileSync, writeFileSync } from "node:fs";
import { MILESTONE_BRANCH_TEMPLATE, TICKET_BRANCH_TEMPLATE } from "../branch_proposal";
import { appendAuditRow } from "./audit_log";

/** Retired seeded default — the pre-M106 `/setup` step 7c seed. */
export const RETIRED_SEEDED_DEFAULT = TICKET_BRANCH_TEMPLATE;

/** Canonical milestone-keyed template `/setup` seeds from M106 forward. */
export const CANONICAL_BRANCH_TEMPLATE = MILESTONE_BRANCH_TEMPLATE;

/** Matches a Schema L `branch_template:` line; group 1 is the raw value. */
const KEY_LINE_RE = /^branch_template:[ \t]*(.*)$/;

export interface ReseedBranchTemplateResult {
  /** `true` when the retired seeded default was found and rewritten. */
  reseeded: boolean;
}

/**
 * Re-seed CLAUDE.md's `branch_template:` from the retired seeded default to
 * the canonical milestone-keyed template. Byte-identical match only — any
 * other value (including near-misses) is preserved verbatim; an absent key
 * stays absent. A performed re-seed is logged as a `## /setup audit` row
 * (`step:7c`, `source: default-applied`) dated `opts.date`.
 */
export function reseedBranchTemplate(
  claudeMdPath: string,
  opts: { date: string },
): ReseedBranchTemplateResult {
  const content = readFileSync(claudeMdPath, "utf-8");
  const lines = content.split("\n");
  const idx = lines.findIndex((line) => {
    const m = KEY_LINE_RE.exec(line);
    return m !== null && m[1] === RETIRED_SEEDED_DEFAULT;
  });
  if (idx < 0) return { reseeded: false };

  lines[idx] = `branch_template: ${CANONICAL_BRANCH_TEMPLATE}`;
  writeFileSync(claudeMdPath, lines.join("\n"));
  appendAuditRow(claudeMdPath, {
    date: opts.date,
    step: "7c",
    field: "branch_template",
    value: CANONICAL_BRANCH_TEMPLATE,
    source: "default-applied",
    reason: "--migrate re-seed of retired seeded default",
  });
  return { reseeded: true };
}
