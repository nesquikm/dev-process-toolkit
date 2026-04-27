// plan_verify_line_validity — /gate-check probe (STE-126 AC-STE-126.2).
//
// Severity: warning. Scans active `specs/plan/M*.md` (excluding `archive/`)
// for `verify:` lines that reference filesystem paths and flags any whose
// referenced path no longer resolves. Catches the drift surface where
// /implement Phase 4 deletes a file but the plan file's task still names it.
//
// Heuristic for path detection: tokens that match `[\w./-]+\.[a-z0-9]+`
// (i.e., `something.ext`) are treated as candidate paths. Pure-prose verify
// lines (no extension token) are skipped — they're operator-judgment
// instructions, not deterministic checks.
//
// Archive plan files (`specs/plan/archive/**`) are frozen by NFR-15 / STE-22
// archival invariants and are never scanned.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Match tokens that look like file paths with an extension. The pre-pattern
// `(?<![\w/.-])` keeps us from gobbling identifiers that share a tail.
const PATH_TOKEN_RE = /(?<![\w/.-])([\w][\w./-]*\.[a-z0-9]+)\b/gi;

// Skip URL-like tokens — verify lines occasionally include `http://...`.
const URL_RE = /^https?:\/\//i;

export type Severity = "warning" | "error";

export interface PlanVerifyLineViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface PlanVerifyLineReport {
  violations: PlanVerifyLineViolation[];
}

function listActivePlans(projectRoot: string): string[] {
  const dir = join(projectRoot, "specs", "plan");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n: string) => n.endsWith(".md"))
      .map((n: string) => join(dir, n));
  } catch {
    return [];
  }
}

function buildMessage(reason: string, file: string, missing: string): string {
  return [
    `plan_verify_line_validity: ${reason}`,
    `Remedy: update the verify line in ${file} to reference an existing path, ` +
      `or mark the parent task [x] and drop the verify line. The cleanup helper ` +
      `\`cleanupPlanVerifyLines\` from plugins/dev-process-toolkit/adapters/_shared/src/spec_archive/cleanup_plan_verify_lines.ts ` +
      `automates this when /implement Phase 4 is the deletion source.`,
    `Context: file=${file}, path=${missing}, probe=plan_verify_line_validity, severity=warning`,
  ].join("\n");
}

function isInsideBackticks(line: string, tokenStart: number, tokenEnd: number): boolean {
  // A token is "inside backticks" iff an OPEN backtick precedes it and a
  // CLOSE backtick follows it. Inline-backtick spans toggle on each `, so:
  //   - Odd count of backticks before tokenStart → currently inside an open span.
  //   - Even count → outside.
  // After confirming we're inside, also assert the closing backtick exists at
  // or after tokenEnd (defends against malformed unclosed spans).
  const before = line.slice(0, tokenStart);
  const tickCountBefore = (before.match(/`/g) || []).length;
  if (tickCountBefore % 2 === 0) return false; // even ⇒ outside any span
  const closing = line.indexOf("`", tokenEnd);
  return closing !== -1;
}

function scanPlanFile(absPath: string, projectRoot: string): PlanVerifyLineViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const violations: PlanVerifyLineViolation[] = [];
  const lines = content.split("\n");
  const rel = relative(projectRoot, absPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const stripped = line.trimStart();
    if (!stripped.startsWith("verify:")) continue;

    PATH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_TOKEN_RE.exec(line)) !== null) {
      const token = match[1]!;
      const tokenStart = match.index;
      const tokenEnd = tokenStart + token.length;
      if (URL_RE.test(token)) continue;
      // Only flag tokens that look path-like (contain `/` OR have a known
      // file-system extension). Bare tokens like `output.txt` are common in
      // verify-line examples; drop them to keep noise low.
      if (!token.includes("/")) continue;
      // Tokens fenced in inline backticks are prose references (e.g.,
      // describing a search target), not deterministic check paths. Skip.
      if (isInsideBackticks(line, tokenStart, tokenEnd)) continue;
      const candidate = join(projectRoot, token);
      if (existsSync(candidate)) continue;
      const reason = `verify line references missing path "${token}"`;
      violations.push({
        file: absPath,
        line: i + 1,
        reason,
        note: `${rel}:${i + 1} — ${reason}`,
        message: buildMessage(reason, rel, token),
        severity: "warning",
      });
    }
  }
  return violations;
}

export async function runPlanVerifyLineValidityProbe(
  projectRoot: string,
): Promise<PlanVerifyLineReport> {
  const specsDir = join(projectRoot, "specs");
  if (!existsSync(specsDir)) return { violations: [] };

  const violations: PlanVerifyLineViolation[] = [];
  for (const planPath of listActivePlans(projectRoot)) {
    violations.push(...scanPlanFile(planPath, projectRoot));
  }
  return { violations };
}
