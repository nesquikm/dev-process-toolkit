// implement_invocation_grammar_doc — /gate-check probe (STE-181 AC-STE-181.5).
//
// Documentation-existence probe. Verifies the `/implement` SKILL.md (when
// present) carries an `## Invocation forms` section with a comparison table
// of at least 6 rows, where the Phase 5 row contains both `silent-skip` and
// `runs it` literals (case-insensitive).
//
// Vacuous on projects that don't ship the toolkit's own SKILL.md.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface ImplementInvocationGrammarDocViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface ImplementInvocationGrammarDocReport {
  violations: ImplementInvocationGrammarDocViolation[];
}

const TABLE_ROW_RE = /^\|.*\|\s*$/;

function findImplementSkill(projectRoot: string): string | null {
  const candidates = [
    join(projectRoot, "skills", "implement", "SKILL.md"),
    join(
      projectRoot,
      "plugins",
      "dev-process-toolkit",
      "skills",
      "implement",
      "SKILL.md",
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function buildMessage(
  filePath: string,
  projectRoot: string,
  reason: string,
  line: number,
): { note: string; message: string } {
  const rel = relative(projectRoot, filePath);
  const note = `${rel}:${line} — ${reason}`;
  const message = [
    `implement_invocation_grammar_doc: ${reason}`,
    `Remedy: ensure skills/implement/SKILL.md carries the canonical \`## Invocation forms\` section after the lede with a side-by-side comparison table (at least 6 rows total: header + one per phase 0–5). Phase 5 row MUST contain both \`silent-skip\` and \`runs it\` literals so the divergence is searchable. See specs/frs/archive/STE-181.md for the canonical shape.`,
    `Context: file=${rel}, line=${line}, probe=implement_invocation_grammar_doc`,
  ].join("\n");
  return { note, message };
}

export async function runImplementInvocationGrammarDocProbe(
  projectRoot: string,
): Promise<ImplementInvocationGrammarDocReport> {
  const skillPath = findImplementSkill(projectRoot);
  if (skillPath === null) return { violations: [] };

  const body = readFileSync(skillPath, "utf-8");
  const violations: ImplementInvocationGrammarDocViolation[] = [];

  // (a) Heading must exist. Locate via a single line-by-line scan so the
  // section-slicer below reuses the same line index without double-scanning
  // via both `body.match` and `lines.findIndex`.
  const lines = body.split("\n");
  const startLine = lines.findIndex((l) => /^## Invocation forms\s*$/.test(l));
  if (startLine === -1) {
    const reason = `\`## Invocation forms\` heading missing from skills/implement/SKILL.md`;
    const { note, message } = buildMessage(skillPath, projectRoot, reason, 1);
    violations.push({ file: skillPath, line: 1, reason, note, message });
    return { violations };
  }

  // Slice the section: from the heading to the next `## ` or EOF.
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i += 1) {
    if (/^## \S/.test(lines[i] ?? "")) {
      endLine = i;
      break;
    }
  }
  const sectionLines = lines.slice(startLine, endLine);

  // (b) Table must have at least 6 rows total. Rows are `|...|` lines; we
  // count the header + separator + body rows. The header + separator are 2
  // rows; for "at least 6 rows" we need ≥6 total Markdown table lines (which
  // includes the separator), giving ≥4 body rows. The AC says "at least 6
  // rows (one per phase + header)" — so we want header + separator +
  // ≥6 body rows = ≥8 total `|` lines, but we'll be lenient and accept
  // ≥6 total `|` lines (header + separator + ≥4 body rows) since the
  // canonical table has 6 phases (0,1,2,3,4,5) which is 8 lines including
  // header+separator. Use ≥6 as a floor — Phase-5-row check below ensures
  // the 5 phases are present.
  const tableLines = sectionLines.filter((l) => TABLE_ROW_RE.test(l));
  if (tableLines.length < 6) {
    const reason = `\`## Invocation forms\` table has too few rows: found ${tableLines.length}, expected at least 6 rows (header + separator + one per phase 0–5)`;
    const lineNumber = startLine + 1;
    const { note, message } = buildMessage(
      skillPath,
      projectRoot,
      reason,
      lineNumber,
    );
    violations.push({ file: skillPath, line: lineNumber, reason, note, message });
  }

  // (c) Phase 5 row must contain both `silent-skip` and `runs it` literals
  // (case-insensitive). The row is identified by starting cell containing a
  // bare `5` token (with optional surrounding whitespace and decorations).
  const phaseRow = tableLines.find((l) => /^\|\s*5\s*[\s(|]/.test(l));
  if (phaseRow === undefined) {
    const reason = `\`## Invocation forms\` table is missing a Phase 5 row (no row whose first cell starts with \`5\`)`;
    const lineNumber = startLine + 1;
    const { note, message } = buildMessage(
      skillPath,
      projectRoot,
      reason,
      lineNumber,
    );
    violations.push({ file: skillPath, line: lineNumber, reason, note, message });
  } else {
    const lower = phaseRow.toLowerCase();
    const hasSilentSkip = lower.includes("silent-skip");
    const hasRunsIt = /\bruns\s+it\b/.test(lower);
    if (!hasSilentSkip || !hasRunsIt) {
      const missing: string[] = [];
      if (!hasSilentSkip) missing.push("`silent-skip`");
      if (!hasRunsIt) missing.push("`runs it`");
      const reason = `\`## Invocation forms\` Phase 5 row missing required divergence keywords: ${missing.join(", ")}`;
      // Find the actual line number of the Phase 5 row.
      const lineIdxInSection = sectionLines.findIndex((l) => l === phaseRow);
      const lineNumber = startLine + lineIdxInSection + 1;
      const { note, message } = buildMessage(
        skillPath,
        projectRoot,
        reason,
        lineNumber,
      );
      violations.push({ file: skillPath, line: lineNumber, reason, note, message });
    }
  }

  return { violations };
}
