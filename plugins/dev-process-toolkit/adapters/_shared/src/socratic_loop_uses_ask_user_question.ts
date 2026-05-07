// socratic_loop_uses_ask_user_question (STE-237 AC-STE-237.3) —
// /gate-check probe. Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
// `.claude/skills/*/SKILL.md` (matching STE-226:AC.5 / STE-232:AC.5
// scope). For every skill body that (a) cites `Pattern 26` (substring
// match) OR (b) carries a `socratic: true` frontmatter / Schema-K key,
// asserts:
//
//   (i) the body references the `AskUserQuestion` tool primitive
//       (substring match on `AskUserQuestion`)
//   (ii) the body cites the canonical protocol doc
//       `docs/auto-mode-protocol.md` (substring match on the path
//       literal)
//
// Either missing ⇒ separate violation row. Both missing on the same
// skill ⇒ two violations so the operator sees both gaps in the
// gate-check report.
//
// HTML-comment-scoped mentions are stripped before scanning so a skill
// that documents the convention in a `<!-- ... -->` comment is not
// falsely required to satisfy (i) / (ii). Forward-extension hook: any
// new skill that ships with `Pattern 26` prose or `socratic: true`
// front-matter is automatically picked up — no manual list maintenance.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface SocraticLoopCoverageViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface SocraticLoopCoverageReport {
  violations: SocraticLoopCoverageViolation[];
}

const ASK_TOKEN = "AskUserQuestion";
const PROTOCOL_PATH = "docs/auto-mode-protocol.md";
const PATTERN_26_RE = /\bPattern 26\b/;
const SOCRATIC_FLAG_RE = /^\s*socratic:\s*true\s*$/m;

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Detect whether a skill body is in scope for the probe. Returns the
 * 1-based line of the trigger (Pattern 26 mention or `socratic: true`
 * key) when in scope, `null` otherwise. Frontmatter is checked against
 * the raw content (the `---` block and any prose `socratic: true` line
 * count); body prose is checked against the comment-stripped text.
 */
function findScopeTriggerLine(content: string): number | null {
  const flagMatch = SOCRATIC_FLAG_RE.exec(content);
  if (flagMatch) {
    const before = content.slice(0, flagMatch.index);
    return before.split("\n").length;
  }
  const stripped = stripHtmlComments(content);
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN_26_RE.test(lines[i]!)) return i + 1;
  }
  return null;
}

function buildMessage(
  file: string,
  line: number,
  kind: "ask" | "protocol",
): string {
  if (kind === "ask") {
    return [
      `socratic_loop_uses_ask_user_question: ${file}:${line} — skill in scope ` +
        `(Pattern 26 / socratic: true) but the body does not reference the ` +
        `\`${ASK_TOKEN}\` tool primitive.`,
      `Remedy: rewrite every clarifying question in the skill body as an ` +
        `\`${ASK_TOKEN}\` tool call (closed-form options OR open-ended with ` +
        `the always-on "Other" free-form fallback). Pattern 26 prose stays ` +
        `as the conceptual anchor; \`${ASK_TOKEN}\` is the structural ` +
        `enforcement. See \`${PROTOCOL_PATH}\` § Socratic Loop Contract.`,
      `Context: file=${file}, probe=socratic_loop_uses_ask_user_question, severity=error`,
    ].join("\n");
  }
  return [
    `socratic_loop_uses_ask_user_question: ${file}:${line} — skill in scope ` +
      `(Pattern 26 / socratic: true) but the body does not cite the canonical ` +
      `protocol doc \`${PROTOCOL_PATH}\`.`,
    `Remedy: include a relative-path reference to \`${PROTOCOL_PATH}\` near ` +
      `the Pattern 26 / socratic-loop prose so a future reader (and the ` +
      `probe) can trace the cross-skill contract.`,
    `Context: file=${file}, probe=socratic_loop_uses_ask_user_question, severity=error`,
  ].join("\n");
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
): SocraticLoopCoverageViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const triggerLine = findScopeTriggerLine(content);
  if (triggerLine === null) return [];
  const stripped = stripHtmlComments(content);
  const rel = relative(projectRoot, absPath);
  const violations: SocraticLoopCoverageViolation[] = [];
  if (!stripped.includes(ASK_TOKEN)) {
    const reason = `Pattern 26 / socratic-tag in scope but no \`${ASK_TOKEN}\` reference in body`;
    violations.push({
      file: absPath,
      line: triggerLine,
      reason,
      note: `${rel}:${triggerLine} — ${reason}`,
      message: buildMessage(rel, triggerLine, "ask"),
      severity: "error",
    });
  }
  if (!stripped.includes(PROTOCOL_PATH)) {
    const reason = `Pattern 26 / socratic-tag in scope but \`${PROTOCOL_PATH}\` not cited`;
    violations.push({
      file: absPath,
      line: triggerLine,
      reason,
      note: `${rel}:${triggerLine} — ${reason}`,
      message: buildMessage(rel, triggerLine, "protocol"),
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

export async function runSocraticLoopUsesAskUserQuestionProbe(
  projectRoot: string,
): Promise<SocraticLoopCoverageReport> {
  const pluginSkillsDir = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  const projectSkillsDir = join(projectRoot, ".claude", "skills");
  const violations: SocraticLoopCoverageViolation[] = [];
  for (const f of listSkillFiles(pluginSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  for (const f of listSkillFiles(projectSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  return { violations };
}
