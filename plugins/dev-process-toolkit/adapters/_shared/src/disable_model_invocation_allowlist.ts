// disable_model_invocation_allowlist (STE-324 AC-STE-324.8) —
// /gate-check probe `disable_model_invocation_allowlist`. Severity: error.
// Probe #59.
//
// Verifies the `disable-model-invocation: true` frontmatter flag is only
// declared on the canonical-allowlist of skills (`/setup`). The flag
// disables automatic skill invocation by the model and is appropriate for
// bootstrap-only entry points where unintended re-invocation would clobber
// state. Composable skills (e.g. `/ship-milestone`, `/spec-archive`) must
// remain model-invocable — surfacing the flag on them would silently
// break orchestration chains (`/implement → /spec-archive`, release
// pipelines, etc.).
//
// Canonical-allowlist shape mirrors `closing_summary_capability_keys`
// (STE-238 AC.4) and the alternate-trigger scan probes (#47, #48, #58):
// a single const enumerates the permitted carriers; every other skill
// SKILL.md frontmatter is scanned and a violation is emitted per offender.
// Each violation surfaces as an NFR-10 canonical refusal
// (`<file>:<line>:<column> — <reason>` with `Refusing: / Remedy: / Context:`
// sub-lines).
//
// Vacuous when `plugins/dev-process-toolkit/skills/` is absent (downstream
// toolkit consumers without the plugin's own skills tree).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const PROBE_ID = "disable_model_invocation_allowlist";

export type Severity = "error" | "warning";

/**
 * Canonical allowlist of skill names permitted to declare
 * `disable-model-invocation: true` in their SKILL.md frontmatter. `/setup`
 * is the sole permitted carrier per STE-251 / STE-324 — it is the bootstrap
 * entry point and must not be auto-invoked by the model mid-session.
 */
export const DISABLE_MODEL_INVOCATION_ALLOWLIST: readonly string[] = [
  "setup",
] as const;

export interface DisableModelInvocationAllowlistViolation {
  file: string;
  line: number;
  column: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
  skill: string;
}

export interface DisableModelInvocationAllowlistReport {
  violations: DisableModelInvocationAllowlistViolation[];
}

function buildReason(skill: string): string {
  return (
    `\`disable-model-invocation: true\` declared on skill \`${skill}\` ` +
    `which is not in the canonical allowlist ` +
    `[${DISABLE_MODEL_INVOCATION_ALLOWLIST.map((s) => `\`${s}\``).join(", ")}]`
  );
}

function buildMessage(
  relPath: string,
  line: number,
  column: number,
  skill: string,
): string {
  const reason = buildReason(skill);
  return [
    `${relPath}:${line}:${column} — ${reason}`,
    `Refusing: \`disable-model-invocation: true\` makes a skill un-invocable ` +
      `by the model. The flag is only appropriate for bootstrap entry ` +
      `points (\`/setup\`); declaring it on a composable skill silently ` +
      `breaks orchestration chains that expect the skill to be reachable ` +
      `mid-session.`,
    `Remedy: remove the \`disable-model-invocation: true\` line from ` +
      `${relPath}'s frontmatter. If the skill genuinely needs to opt out ` +
      `of model invocation, add it to ` +
      `\`DISABLE_MODEL_INVOCATION_ALLOWLIST\` in ` +
      `\`adapters/_shared/src/disable_model_invocation_allowlist.ts\` and ` +
      `explain the rationale in the const's doc-comment.`,
    `Context: file=${relPath}, skill=${skill}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

/**
 * Extract the frontmatter block from a SKILL.md body. Returns the raw
 * frontmatter text and its 1-based line offset (always 2 when a leading
 * `---\n` opener is present). Returns `null` when no frontmatter block is
 * present.
 */
function extractFrontmatter(
  body: string,
): { text: string; startLine: number } | null {
  // Frontmatter convention: file begins with `---\n`, terminates at the
  // next `\n---` line. Mirrors readFrontmatterDescription in the AC.7 test.
  if (!body.startsWith("---\n")) return null;
  const closeIdx = body.indexOf("\n---", 4);
  if (closeIdx === -1) return null;
  const text = body.slice(4, closeIdx);
  return { text, startLine: 2 };
}

/**
 * Scan a SKILL.md file for an offending `disable-model-invocation: true`
 * frontmatter line. Returns an empty list when the file is allowlisted,
 * missing, or carries no offending line.
 */
function scanSkillFile(
  absPath: string,
  projectRoot: string,
  skillName: string,
): DisableModelInvocationAllowlistViolation[] {
  if (DISABLE_MODEL_INVOCATION_ALLOWLIST.includes(skillName)) return [];
  let body: string;
  try {
    body = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const fm = extractFrontmatter(body);
  if (fm === null) return [];
  const rel = relative(projectRoot, absPath);
  const violations: DisableModelInvocationAllowlistViolation[] = [];
  const lines = fm.text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    // Byte-checkable match: literal `disable-model-invocation: true` (with
    // optional trailing whitespace). Case-sensitive — frontmatter keys are
    // canonical lowercase per YAML convention.
    const m = /^(disable-model-invocation:\s*true)\s*$/.exec(lineText);
    if (m === null) continue;
    const lineNo = fm.startLine + i;
    const column = 1;
    const reason = buildReason(skillName);
    violations.push({
      file: absPath,
      line: lineNo,
      column,
      reason,
      note: `${rel}:${lineNo}:${column} — ${reason}`,
      message: buildMessage(rel, lineNo, column, skillName),
      severity: "error",
      skill: skillName,
    });
  }
  return violations;
}

export async function runDisableModelInvocationAllowlistProbe(
  projectRoot: string,
): Promise<DisableModelInvocationAllowlistReport> {
  const skillsRoot = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  if (!existsSync(skillsRoot)) return { violations: [] };

  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return { violations: [] };
  }

  const violations: DisableModelInvocationAllowlistViolation[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillName = ent.name;
    const skillFile = join(skillsRoot, skillName, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    violations.push(...scanSkillFile(skillFile, projectRoot, skillName));
  }
  return { violations };
}
