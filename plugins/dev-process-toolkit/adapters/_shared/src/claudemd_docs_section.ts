// claudemd_docs_section — /gate-check probe (STE-107 AC-STE-107.4).
//
// If CLAUDE.md exists, it MUST contain a `## Docs` section as a real
// (non-commented) `##`-level heading. Sibling probe to existing
// `## Task Tracking` checks. Catches the silent feature-drop failure mode
// from the v1.29.0 smoke test (F4).
//
// Vacuous when CLAUDE.md is absent (project not toolkit-managed). HTML
// comments are stripped before the heading scan — a `## Docs` line nested
// inside `<!-- … -->` does not count.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const HEADING_LINE = "## Docs";

export interface ClaudeMdDocsSectionViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface ClaudeMdDocsSectionReport {
  violations: ClaudeMdDocsSectionViolation[];
}

function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

export async function runClaudeMdDocsSectionProbe(
  projectRoot: string,
): Promise<ClaudeMdDocsSectionReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { violations: [] };

  const raw = readFileSync(claudeMd, "utf-8");
  const stripped = stripHtmlComments(raw);

  // Match a literal `## Docs` line — the canonical Schema-D heading.
  if (/^## Docs\s*$/m.test(stripped)) return { violations: [] };

  const rel = relative(projectRoot, claudeMd);
  const reason = `${HEADING_LINE} section missing — /docs cannot read mode flags without it`;
  const note = `${rel}:1 — ${reason}`;
  const message = [
    `claudemd_docs_section: ${reason}`,
    `Remedy: append a ${HEADING_LINE} section to ${rel} with the canonical keys (user_facing_mode, packages_mode, changelog_ci_owned), all defaulting to false. ` +
      `See plugins/dev-process-toolkit/templates/CLAUDE.md.template for the canonical block shape.`,
    `Context: file=${rel}, probe=claudemd_docs_section`,
  ].join("\n");

  return {
    violations: [{ file: claudeMd, line: 1, reason, note, message }],
  };
}
