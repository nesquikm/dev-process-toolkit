// requires_input_sentinel_coverage (STE-232 AC-STE-232.5) — /gate-check probe.
// Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
// `.claude/skills/*/SKILL.md` (matching STE-226 AC.5). For every skill whose
// body carries a `requires-input:` annotation, asserts:
//
//   (a) the body invokes the canonical helper `requireOrRefuse(...)`
//       (substring match on `requireOrRefuse`)
//   (b) the body cites the canonical protocol doc `docs/auto-mode-protocol.md`
//       by relative path (substring match on the path literal)
//
// Either missing ⇒ one violation per check. Both missing on the same skill ⇒
// two separate violations so the operator sees both gaps in the gate-check
// report. Skills without a `requires-input:` annotation are vacuously out of
// scope — the protocol only constrains gates that explicitly declare the
// requirement.
//
// HTML-comment-scoped mentions are stripped before scanning so a skill that
// documents the convention in a comment is not falsely required to invoke the
// helper. Fenced code blocks are NOT stripped — example helper calls inside a
// fence count toward (a), and protocol-doc citations inside a fence count
// toward (b).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface RequiresInputCoverageViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface RequiresInputCoverageReport {
  violations: RequiresInputCoverageViolation[];
}

const HELPER_TOKEN = "requireOrRefuse";
const PROTOCOL_PATH = "docs/auto-mode-protocol.md";
const REQUIRES_INPUT_RE = /(?<!<!--[^>]*)\brequires-input:/;

function buildMessage(
  file: string,
  line: number,
  kind: "helper" | "protocol",
): string {
  if (kind === "helper") {
    return [
      `requires_input_sentinel_coverage: ${file}:${line} — skill carries a ` +
        `\`requires-input:\` annotation but the body does not reference the ` +
        `canonical helper \`${HELPER_TOKEN}\` from ` +
        `\`adapters/_shared/src/requires_input.ts\`.`,
      `Remedy: route the per-step refusal through ` +
        `\`${HELPER_TOKEN}(spec, key, sentinel)\` so the four-outcome decision ` +
        `(user-supplied / pre-baked / default-applied / refused) is consolidated. ` +
        `See \`docs/auto-mode-protocol.md\` § Refusal Mechanism.`,
      `Context: file=${file}, probe=requires_input_sentinel_coverage, severity=error`,
    ].join("\n");
  }
  return [
    `requires_input_sentinel_coverage: ${file}:${line} — skill carries a ` +
      `\`requires-input:\` annotation but the body does not cite the canonical ` +
      `protocol doc \`${PROTOCOL_PATH}\`.`,
    `Remedy: include a relative-path reference to \`${PROTOCOL_PATH}\` near the ` +
      `\`requires-input:\` annotation so a future reader (and the probe) can ` +
      `trace the cross-skill contract.`,
    `Context: file=${file}, probe=requires_input_sentinel_coverage, severity=error`,
  ].join("\n");
}

/**
 * Strip HTML comments (`<!-- ... -->`) from a markdown body before scanning.
 * Comments are documentation surface, not live behavior; a `requires-input:`
 * mention inside a comment doesn't impose the contract on the surrounding
 * skill.
 */
function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Find the 1-based line number where the first non-comment `requires-input:`
 * annotation appears. Returns `null` when the body is comment-only.
 */
function findRequiresInputLine(content: string): number | null {
  const stripped = stripHtmlComments(content);
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (REQUIRES_INPUT_RE.test(lines[i]!)) return i + 1;
  }
  return null;
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
): RequiresInputCoverageViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const annotationLine = findRequiresInputLine(content);
  if (annotationLine === null) return [];
  const stripped = stripHtmlComments(content);
  const rel = relative(projectRoot, absPath);
  const violations: RequiresInputCoverageViolation[] = [];
  if (!stripped.includes(HELPER_TOKEN)) {
    const reason = `requires-input: annotation present but no \`${HELPER_TOKEN}\` call cited`;
    violations.push({
      file: absPath,
      line: annotationLine,
      reason,
      note: `${rel}:${annotationLine} — ${reason}`,
      message: buildMessage(rel, annotationLine, "helper"),
      severity: "error",
    });
  }
  if (!stripped.includes(PROTOCOL_PATH)) {
    const reason = `requires-input: annotation present but \`${PROTOCOL_PATH}\` not cited`;
    violations.push({
      file: absPath,
      line: annotationLine,
      reason,
      note: `${rel}:${annotationLine} — ${reason}`,
      message: buildMessage(rel, annotationLine, "protocol"),
      severity: "error",
    });
  }
  return violations;
}

function listSkillFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries) {
    const dir = join(skillsDir, name);
    let s;
    try {
      s = statSync(dir);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    const skillMd = join(dir, "SKILL.md");
    if (existsSync(skillMd)) files.push(skillMd);
  }
  return files;
}

export async function runRequiresInputSentinelCoverageProbe(
  projectRoot: string,
): Promise<RequiresInputCoverageReport> {
  const pluginSkillsDir = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  const projectSkillsDir = join(projectRoot, ".claude", "skills");
  const violations: RequiresInputCoverageViolation[] = [];
  for (const f of listSkillFiles(pluginSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  for (const f of listSkillFiles(projectSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  return { violations };
}
