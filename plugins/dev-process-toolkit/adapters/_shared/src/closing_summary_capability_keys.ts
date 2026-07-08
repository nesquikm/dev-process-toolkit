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
 * commit gates), STE-228 (branch gate), STE-230 (spec-research seed), the
 * STE-238 additions (`branch_gate_skipped_already_non_main`), and the M84
 * STE-320 expansion that closes the 12→20 directive-coverage gap (Set A —
 * every key with a literal `MUST emit \`<key>\`` directive in /spec-write
 * SKILL.md, verified by the triple-pass audit at M84), the M97 STE-362
 * addition (`milestone_attach_failed` — loud permanent-failure surface for
 * the project-milestone attach), and the M97 STE-363 archival-assertion pair
 * (`milestone_label_asserted_at_archive` / `milestone_label_archive_refused`
 * — per-FR milestone-binding assertion outcomes emitted by /spec-archive and
 * /implement § Milestone Archival), and the M92 STE-345 addition
 * (`token_stats_rendered` — the FR's `## Token Stats` block was refreshed
 * from the token ledger riding the FR-file write). Excluded by design:
 * `tracker_status_forced`, `tracker_status_skipped`, `tracker_status_cancelled`,
 * `tracker_status_unknown_encountered`, `tracker_tolerance_refused_non_tty`
 * — these appear only as table-header column labels at SKILL.md L330, not
 * as MUST-emit directives.
 */
export const CANONICAL_CAPABILITY_KEYS = [
  "spec_write_draft_default_applied",
  "spec_write_draft_declined",
  "spec_write_commit_default_applied",
  "spec_write_commit_declined",
  "branch_gate_default_applied",
  "branch_gate_skipped_already_non_main",
  "branch_gate_created",
  "branch_gate_edited",
  "branch_gate_declined",
  "branch_gate_remote_probe_skipped",
  "spec_research_invoked",
  "spec_research_no_matches",
  "spec_research_shape_violation",
  "deps_research_invoked",
  "deps_research_no_matches",
  "deps_research_shape_violation",
  "tracker_status_advisory_non_tty",
  "tracker_status_genuine_drift",
  "tracker_local_orphan_local",
  "tracker_local_reconciled",
  "milestone_attach_failed",
  "milestone_label_asserted_at_archive",
  "milestone_label_archive_refused",
  "token_stats_rendered",
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
  spec_write_draft_declined: "spec-write",
  spec_write_commit_default_applied: "spec-write",
  spec_write_commit_declined: "spec-write",
  branch_gate_default_applied: "spec-write",
  branch_gate_skipped_already_non_main: "spec-write",
  branch_gate_created: "spec-write",
  branch_gate_edited: "spec-write",
  branch_gate_declined: "spec-write",
  branch_gate_remote_probe_skipped: "spec-write",
  spec_research_invoked: "spec-write",
  spec_research_no_matches: "spec-write",
  spec_research_shape_violation: "spec-write",
  deps_research_invoked: "spec-write",
  deps_research_no_matches: "spec-write",
  deps_research_shape_violation: "spec-write",
  tracker_status_advisory_non_tty: "spec-write",
  tracker_status_genuine_drift: "spec-write",
  tracker_local_orphan_local: "spec-write",
  tracker_local_reconciled: "spec-write",
  milestone_attach_failed: "spec-write",
  // The archival-assertion pair routes to spec-write (the canonical static-
  // map source) — the fixture legs of the probe tests write only a fixture
  // spec-write SKILL.md and expect one violation per canonical key. The
  // /spec-archive + /implement MUST-emit directives are pinned separately
  // by the M97 archival-assertion meta-tests.
  milestone_label_asserted_at_archive: "spec-write",
  milestone_label_archive_refused: "spec-write",
  // M92 STE-345: /spec-write § 0b step 7 renders the Token Stats block
  // riding the FR-file write; the MUST-emit directive lives in spec-write.
  token_stats_rendered: "spec-write",
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

/**
 * Read a SKILL.md file and compute its project-relative path. Returns
 * `null` when the file is missing or unreadable — both scan legs treat
 * such failures as vacuous (no violations to emit).
 */
function readSkillFile(
  absPath: string,
  projectRoot: string,
): { content: string; rel: string } | null {
  if (!existsSync(absPath)) return null;
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  return { content, rel: relative(projectRoot, absPath) };
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
  ownedKeys: CapabilityKey[],
): ClosingSummaryCapabilityKeysViolation[] {
  const file = readSkillFile(absPath, projectRoot);
  if (file === null) return [];
  const { content, rel } = file;
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

/**
 * Build the orphan-directive violation message — fired when a SKILL.md body
 * carries a `MUST emit \`<key>\`` directive whose key is NOT registered in
 * the canonical const. This is the reverse leg of the bidirectional invariant
 * landed under STE-320 AC-4 (M84): the const and the SKILL.md directive set
 * MUST round-trip byte-for-byte; an unregistered directive means either the
 * const is missing an entry or the directive is stale prose that should be
 * deleted.
 */
function buildOrphanDirectiveMessage(file: string, key: string): string {
  return [
    `closing_summary_capability_keys: ${file} — SKILL.md carries a literal ` +
      `\`MUST emit \\\`${key}\\\`\` directive but the canonical const ` +
      `CANONICAL_CAPABILITY_KEYS does not register \`${key}\`.`,
    `Remedy: either (a) add \`${key}\` to CANONICAL_CAPABILITY_KEYS in ` +
      `adapters/_shared/src/closing_summary_capability_keys.ts and route it ` +
      `via KEY_OWNER_SKILL, or (b) delete the stale \`MUST emit\` directive ` +
      `from SKILL.md. The bidirectional invariant (STE-320 AC-4) requires ` +
      `the const and the SKILL.md directive set to round-trip exactly.`,
    `Context: file=${file}, key=${key}, probe=closing_summary_capability_keys, severity=error`,
  ].join("\n");
}

/**
 * Reverse-leg scan: walk every `MUST emit \`<key>\`` directive in the given
 * SKILL.md file and emit a violation for each key NOT present in the
 * canonical const. Implements the second half of STE-320 AC-4's bidirectional
 * invariant — the existing scanSkillFile() handles the forward leg
 * (const → directive presence), this handles the reverse (directive → const
 * membership).
 */
function scanSkillFileForOrphanDirectives(
  absPath: string,
  projectRoot: string,
  registeredKeys: ReadonlySet<string>,
): ClosingSummaryCapabilityKeysViolation[] {
  const file = readSkillFile(absPath, projectRoot);
  if (file === null) return [];
  const { content, rel } = file;
  const violations: ClosingSummaryCapabilityKeysViolation[] = [];
  // Mirror the AC-4 scope-clarification: regex captures the FIRST backticked
  // key after `MUST emit`. The compound-form `\` / \`` continuation case
  // (e.g., the `tracker_local_orphan_local` / `milestone_local_orphan` pair
  // at /spec-write SKILL.md L327) intentionally captures only the head key
  // per STE-320's Requirement-section spec-prose-hygiene carve-out.
  const re = /MUST emit\s*`([a-z_]+)`/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const key = match[1]!;
    if (registeredKeys.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = `orphan MUST-emit directive: \`${key}\` not in CANONICAL_CAPABILITY_KEYS`;
    violations.push({
      file: absPath,
      line: 1,
      reason,
      note: `${rel}:1 — ${reason}`,
      message: buildOrphanDirectiveMessage(rel, key),
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
  // Reverse leg of the bidirectional invariant (STE-320 AC-4): scan
  // /spec-write SKILL.md for `MUST emit \`<key>\`` directives whose key is
  // NOT registered in CANONICAL_CAPABILITY_KEYS. Scope is /spec-write only
  // per the AC's scope clarification — other skills (`deps`, `setup`,
  // `implement`, `gate-check`) carry their own MUST-emit directives that
  // live outside this probe's registry (deliberate carve-out — the registry
  // is /spec-write-anchored per STE-238 origin).
  const registeredKeys = new Set<string>(CANONICAL_CAPABILITY_KEYS);
  const specWriteCandidates = [
    join(projectRoot, "plugins", "dev-process-toolkit", "skills", "spec-write", "SKILL.md"),
    join(projectRoot, ".claude", "skills", "spec-write", "SKILL.md"),
  ];
  for (const path of specWriteCandidates) {
    if (!existsSync(path)) continue;
    violations.push(
      ...scanSkillFileForOrphanDirectives(path, projectRoot, registeredKeys),
    );
  }
  return { violations };
}
