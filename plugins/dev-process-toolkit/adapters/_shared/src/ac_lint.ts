// ac_lint — duplicate-AC scan (FR-73 AC-73.5).
//
// Walks every active FR under `specs/frs/*.md` (excluding `archive/`),
// extracts the `## Acceptance Criteria` section, and reports any
// `AC-<prefix>.<N>` combination that appears more than once within a
// single file's AC section.
//
// Cross-file duplicates are allowed — two different FRs may legitimately
// share `AC-STE-50.1` and `AC-STE-51.1` if they happen to use the same
// tail digit. The uniqueness invariant is per-FR.
//
// Wired into `/gate-check` via the v2 conformance probes (FR-73 AC-73.5).
// Callable standalone via `bun adapters/_shared/src/ac_lint.ts <specsDir>`.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AcLintIssue {
  file: string;
  prefix: string;
  number: number;
  occurrences: number;
}

export interface AcLintResult {
  issues: AcLintIssue[];
  filesScanned: number;
}

const AC_LINE_RE = /^\s*-?\s*AC-([A-Za-z0-9-]+)\.(\d+)[:\s]/;

/**
 * Scan a specs directory for duplicate AC-prefix.N pairs within any
 * FR's `## Acceptance Criteria` section.
 */
export async function acLint(specsDir: string): Promise<AcLintResult> {
  const frsDir = join(specsDir, "frs");
  let entries: string[];
  try {
    entries = await readdir(frsDir);
  } catch {
    return { issues: [], filesScanned: 0 };
  }

  const issues: AcLintIssue[] = [];
  let filesScanned = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const path = join(frsDir, entry);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      continue;
    }
    filesScanned += 1;
    const acSection = extractAcSection(content);
    if (acSection === null) continue;
    const counts = new Map<string, { prefix: string; number: number; count: number }>();
    for (const line of acSection.split("\n")) {
      const m = AC_LINE_RE.exec(line);
      if (!m) continue;
      const prefix = m[1]!;
      const number = Number.parseInt(m[2]!, 10);
      const key = `${prefix}.${number}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { prefix, number, count: 1 });
      }
    }
    for (const v of counts.values()) {
      if (v.count > 1) {
        issues.push({
          file: path,
          prefix: v.prefix,
          number: v.number,
          occurrences: v.count,
        });
      }
    }
  }

  return { issues, filesScanned };
}

/**
 * Extract the body of the `## Acceptance Criteria` section — from the
 * heading to the next `## ` heading or EOF. Returns null if the section
 * is absent.
 */
function extractAcSection(content: string): string | null {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => /^##\s+Acceptance Criteria\s*$/.test(l));
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx).join("\n");
}

/**
 * Format a canonical failure message for gate-check reporting. Returns
 * the empty string when there are no issues (caller: gate passes).
 */
export function formatAcLintFailure(result: AcLintResult): string {
  if (result.issues.length === 0) return "";
  const lines = [
    `ac_lint: ${result.issues.length} duplicate AC prefix(es) found across ${result.filesScanned} file(s):`,
  ];
  for (const issue of result.issues) {
    lines.push(
      `  ${issue.file}: AC-${issue.prefix}.${issue.number} appears ${issue.occurrences} times`,
    );
  }
  return lines.join("\n");
}
