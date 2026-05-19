// not_a_trigger_anchor_present (STE-313 AC-STE-313.5) — /gate-check probe
// `not_a_trigger_anchor_present`. Severity: error.
//
// Asserts a § Rules `NOT-a-trigger` anchor lands in BOTH
// `plugins/dev-process-toolkit/skills/spec-write/SKILL.md` AND
// `plugins/dev-process-toolkit/skills/setup/SKILL.md`. The anchor's
// byte-checkable contract is: every literal phrase in
// `NOT_A_TRIGGER_REQUIRED_PHRASES` (the canonical NOT-a-trigger set —
// `"work without stopping"`, `"autonomous-mode"`, `"standing instruction"`,
// `<command-args>`, `claude -p`) appears in the file AT OR AFTER the
// `## Rules` heading, alongside a literal reference to the runtime helper
// path `adapters/_shared/src/check_marker_runtime.ts` as the SOLE
// byte-checkable evaluation path.
//
// The location-sensitive check (must sit AT OR AFTER `## Rules`) is what
// distinguishes this probe from a plain phrase-presence scan — placing the
// anchor under, say, `## Process` would let a reader land on `## Rules`
// without the negative contract in view. A SKILL.md that lacks a `## Rules`
// heading entirely fails the probe (the anchor needs a Rules section to
// live under).
//
// Sibling probe shape to probe #47 `spec_write_first_turn_drift_scan`
// (STE-270 AC-STE-270.2) and probe #48 `spec_write_marker_alternate_trigger_scan`
// (STE-262 AC-STE-262.4) — same single-file-per-skill scope + per-violation
// NFR-10 note + literal substring detection (no regex on the canonical
// phrases). Vacuous when neither SKILL.md ships (downstream toolkit
// consumers without the plugin's own skills tree).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface NotATriggerAnchorViolation {
  file: string;
  line: number;
  column: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface NotATriggerAnchorReport {
  violations: NotATriggerAnchorViolation[];
}

// Canonical NOT-a-trigger phrase set. Literal substring match — no regex —
// so future SKILL.md copy edits don't accidentally regress detection. The
// quoted-string variants (`"work without stopping"`, `"autonomous-mode"`,
// `"standing instruction"`) carry the surrounding double-quotes because
// that is the byte-shape the AC text specifies; embedding them with the
// quotes makes the anchor self-documenting and grep-fence-proof.
export const NOT_A_TRIGGER_REQUIRED_PHRASES = [
  '"work without stopping"',
  '"autonomous-mode"',
  '"standing instruction"',
  "<command-args>",
  "claude -p",
] as const;

// Literal runtime-helper path the anchor MUST cite as the SOLE evaluation
// path. The path is byte-checkable (not paraphrased) so an LLM cannot
// rewrite the anchor in a way that loses the helper reference.
const RUNTIME_HELPER_PATH = "adapters/_shared/src/check_marker_runtime.ts";

const RULES_HEADING_RE = /^##\s+Rules\s*$/;

const SKILL_REL_PATHS = [
  "plugins/dev-process-toolkit/skills/spec-write/SKILL.md",
  "plugins/dev-process-toolkit/skills/setup/SKILL.md",
] as const;

const REMEDY =
  "land a § Rules anchor naming every NOT-a-trigger phrase " +
  "(`\"work without stopping\"`, `\"autonomous-mode\"`, `\"standing instruction\"`, " +
  "`<command-args>`, `claude -p`) plus a literal reference to " +
  "`adapters/_shared/src/check_marker_runtime.ts` as the SOLE byte-checkable " +
  "evaluation path; the anchor MUST sit AT OR AFTER the `## Rules` heading " +
  "so a reader landing on `## Rules` has the negative contract in view.";

function buildMessage(
  relFile: string,
  line: number,
  column: number,
  reason: string,
): string {
  return [
    `not_a_trigger_anchor_present: ${relFile}:${line}:${column} — ${reason}`,
    `Remedy: ${REMEDY}`,
    `Context: file=${relFile}, probe=not_a_trigger_anchor_present, severity=error`,
  ].join("\n");
}

function findRulesHeadingLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (RULES_HEADING_RE.test(lines[i]!)) return i;
  }
  return -1;
}

function scanSkill(
  absPath: string,
  projectRoot: string,
): NotATriggerAnchorViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: NotATriggerAnchorViolation[] = [];
  const lines = content.split("\n");
  const rulesLineIdx = findRulesHeadingLine(lines);

  if (rulesLineIdx === -1) {
    // No `## Rules` heading — the anchor has no canonical home.
    const reason =
      "NOT-a-trigger anchor missing — no `## Rules` heading found in this SKILL.md";
    violations.push({
      file: absPath,
      line: 1,
      column: 1,
      reason,
      note: `${rel}:1:1 — ${reason}`,
      message: buildMessage(rel, 1, 1, reason),
      severity: "error",
    });
    return violations;
  }

  // Body covered by the `## Rules` section: from the heading line onward.
  // The anchor MUST live AT OR AFTER `## Rules`; phrases appearing only
  // BEFORE `## Rules` (e.g., in a `## Process` section above it) do not
  // satisfy the contract.
  const rulesBodyLines = lines.slice(rulesLineIdx);
  const rulesBody = rulesBodyLines.join("\n");
  const rulesLineNo = rulesLineIdx + 1;

  // Check 1: each required phrase MUST appear inside the rules-section body.
  for (const phrase of NOT_A_TRIGGER_REQUIRED_PHRASES) {
    if (!rulesBody.includes(phrase)) {
      // Distinguish "absent entirely" vs "present only outside `## Rules`"
      // so the violation message guides the fix.
      const presentBeforeRules = lines
        .slice(0, rulesLineIdx)
        .some((l) => l.includes(phrase));
      const where = presentBeforeRules
        ? `present only BEFORE the \`## Rules\` heading (line ${rulesLineNo}); anchor must sit inside the Rules section`
        : "absent entirely from this SKILL.md";
      const reason =
        `NOT-a-trigger anchor missing required phrase ${JSON.stringify(phrase)} — ${where}`;
      violations.push({
        file: absPath,
        line: rulesLineNo,
        column: 1,
        reason,
        note: `${rel}:${rulesLineNo}:1 — ${reason}`,
        message: buildMessage(rel, rulesLineNo, 1, reason),
        severity: "error",
      });
    }
  }

  // Check 2: the runtime-helper path MUST be cited inside the rules-section
  // body. Surface the missing reference with the exact bare filename so the
  // remedy is grep-discoverable from the violation message.
  if (!rulesBody.includes(RUNTIME_HELPER_PATH)) {
    const presentBeforeRules = lines
      .slice(0, rulesLineIdx)
      .some((l) => l.includes(RUNTIME_HELPER_PATH));
    const where = presentBeforeRules
      ? `runtime helper reference \`check_marker_runtime.ts\` present only BEFORE \`## Rules\``
      : `runtime helper reference \`check_marker_runtime.ts\` absent entirely`;
    const reason =
      `NOT-a-trigger anchor missing literal runtime-helper path ` +
      `\`${RUNTIME_HELPER_PATH}\` — ${where}`;
    violations.push({
      file: absPath,
      line: rulesLineNo,
      column: 1,
      reason,
      note: `${rel}:${rulesLineNo}:1 — ${reason}`,
      message: buildMessage(rel, rulesLineNo, 1, reason),
      severity: "error",
    });
  }

  return violations;
}

export async function runNotATriggerAnchorPresentProbe(
  projectRoot: string,
): Promise<NotATriggerAnchorReport> {
  const violations: NotATriggerAnchorViolation[] = [];
  for (const rel of SKILL_REL_PATHS) {
    const abs = join(projectRoot, rel);
    violations.push(...scanSkill(abs, projectRoot));
  }
  return { violations };
}
