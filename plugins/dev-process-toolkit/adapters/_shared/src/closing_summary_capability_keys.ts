// closing_summary_capability_keys (STE-238 AC-STE-238.4) —
// /gate-check probe. Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/{spec-write,gate-check,smoke-test}/SKILL.md`
// and `.claude/skills/{spec-write,gate-check,smoke-test}/SKILL.md`. For each
// capability key in the canonical set (sourced from /spec-write § 7's static
// plain-language map), asserts the spec-write skill body carries a literal
// "MUST emit `<key>`" directive (regex match on the documented directive
// shape). The probe is the source-level companion to /smoke-test Phase 9's
// behavioral fixture — Phase 9 catches LLM regressions where the directive
// is present but ignored at runtime; this probe catches drift where the
// directive itself goes missing from skill prose.
//
// Modeled on STE-232:AC.5 / STE-228 probe shape — substring + regex match,
// per-key violation row.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface ClosingSummaryCapabilityKeysViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
  missingKey: string;
}

export interface ClosingSummaryCapabilityKeysReport {
  violations: ClosingSummaryCapabilityKeysViolation[];
}

/**
 * The canonical set of capability keys emitted by /spec-write that have a
 * documented MUST-emit-literal-token directive in skill prose. Sourced from
 * /spec-write § 7's static plain-language map; covers STE-226 (draft +
 * commit gates), STE-228 (branch gate), STE-230 (spec-research seed), plus
 * the STE-238 additions (`branch_gate_skipped_already_non_main`).
 */
export const CANONICAL_CAPABILITY_KEYS = [
  "spec_write_draft_default_applied",
  "spec_write_commit_default_applied",
  "branch_gate_default_applied",
  "branch_gate_skipped_already_non_main",
  "spec_research_invoked",
  "spec_research_no_matches",
  "spec_research_shape_violation",
] as const;

export type CapabilityKey = (typeof CANONICAL_CAPABILITY_KEYS)[number];

/**
 * Map each canonical key to the skill body that MUST carry its MUST-emit
 * directive. Most keys live in `spec-write`'s SKILL.md (the canonical
 * static map source); future keys can route to `gate-check` or
 * `smoke-test` SKILL.md by adding a row.
 */
const KEY_OWNER_SKILL: Record<CapabilityKey, string> = {
  spec_write_draft_default_applied: "spec-write",
  spec_write_commit_default_applied: "spec-write",
  branch_gate_default_applied: "spec-write",
  branch_gate_skipped_already_non_main: "spec-write",
  spec_research_invoked: "spec-write",
  spec_research_no_matches: "spec-write",
  spec_research_shape_violation: "spec-write",
};

/**
 * Regex matching a MUST-emit directive for a specific capability key. The
 * directive shape is `MUST emit \`<key>\`` (case-sensitive; backticks
 * required so a stray prose mention of the key name doesn't satisfy the
 * directive). The shape is byte-checkable and matches the prose strengthening
 * landed in /spec-write SKILL.md under STE-238 AC.1 / AC.2 / AC.3.
 */
function buildMustEmitRegex(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`MUST emit\\s*\`${escaped}\``);
}

function buildMessage(
  file: string,
  key: CapabilityKey,
): string {
  return [
    `closing_summary_capability_keys: ${file} — capability key \`${key}\` is in ` +
      `the canonical static map but the skill body does not carry a literal ` +
      `\`MUST emit \\\`${key}\\\`\` directive.`,
    `Remedy: add a sentence at the documented emission site that says ` +
      `\`MUST emit \\\`${key}\\\`\` (literal backticked token). The byte-checkable ` +
      `directive is the structural signal this probe greps for; narrative prose ` +
      `like "the closing summary will mention <key>" is insufficient (STE-220 ` +
      `lesson). See /spec-write § 7's static plain-language map for the ` +
      `canonical key set.`,
    `Context: file=${file}, key=${key}, probe=closing_summary_capability_keys, severity=error`,
  ].join("\n");
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
  ownedKeys: CapabilityKey[],
): ClosingSummaryCapabilityKeysViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: ClosingSummaryCapabilityKeysViolation[] = [];
  for (const key of ownedKeys) {
    if (buildMustEmitRegex(key).test(content)) continue;
    const reason = `MUST-emit directive missing for key \`${key}\``;
    violations.push({
      file: absPath,
      line: 1,
      reason,
      note: `${rel}:1 — ${reason}`,
      message: buildMessage(rel, key),
      severity: "error",
      missingKey: key,
    });
  }
  return violations;
}

export async function runClosingSummaryCapabilityKeysProbe(
  projectRoot: string,
): Promise<ClosingSummaryCapabilityKeysReport> {
  const skillsByOwner: Record<string, CapabilityKey[]> = {};
  for (const key of CANONICAL_CAPABILITY_KEYS) {
    const owner = KEY_OWNER_SKILL[key];
    (skillsByOwner[owner] ??= []).push(key);
  }
  const violations: ClosingSummaryCapabilityKeysViolation[] = [];
  for (const [owner, keys] of Object.entries(skillsByOwner)) {
    const candidates = [
      join(projectRoot, "plugins", "dev-process-toolkit", "skills", owner, "SKILL.md"),
      join(projectRoot, ".claude", "skills", owner, "SKILL.md"),
    ];
    // If neither candidate exists, the owner skill is missing — vacuous;
    // missing-skill hygiene belongs to `/setup`'s scaffolding contract,
    // not to this probe.
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      violations.push(...scanSkillFile(path, projectRoot, keys));
    }
  }
  return { violations };
}
