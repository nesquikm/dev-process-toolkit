// STE-114 AC-STE-114.5 — one-time migration helper for projects that picked
// up non-canonical Schema L keys at the top level of `## Task Tracking`.
//
// Dry-run only. Reads CLAUDE.md, extracts non-canonical top-level keys, and
// prints a unified diff that moves them under `### <Tracker>` subsection.
// Operator pipes to `patch -p1` if they want to apply.

import { readFileSync } from "node:fs";
import { CANONICAL_KEYS } from "../adapters/_shared/src/task_tracking_canonical_keys";

interface ParsedSection {
  // Lines BEFORE `## Task Tracking` (inclusive, ends without trailing \n).
  preamble: string[];
  // The `## Task Tracking` heading line (literal).
  heading: string;
  // Lines AFTER the heading, before the next `##`/`#` heading.
  sectionLines: string[];
  // Lines AFTER the section (next heading onward).
  afterLines: string[];
}

function parse(content: string): ParsedSection | null {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  return {
    preamble: lines.slice(0, startIdx),
    heading: lines[startIdx]!,
    sectionLines: lines.slice(startIdx + 1, endIdx),
    afterLines: lines.slice(endIdx),
  };
}

function titleCase(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
}

function buildHunk(before: string[], after: string[]): string {
  // Whole-file unified diff, single hunk via LCS. We render `-p1`-friendly
  // headers so `patch -p1 < diff.patch` works from the project root.
  const beforeLen = before.length;
  const afterLen = after.length;
  const header = `@@ -1,${beforeLen} +1,${afterLen} @@`;

  // LCS table: dp[i][j] = length of LCS of before[0..i-1] vs after[0..j-1].
  const dp: number[][] = Array.from({ length: beforeLen + 1 }, () =>
    new Array<number>(afterLen + 1).fill(0),
  );
  for (let i = 1; i <= beforeLen; i++) {
    for (let j = 1; j <= afterLen; j++) {
      const row = dp[i]!;
      const prevRow = dp[i - 1]!;
      if (before[i - 1] === after[j - 1]) row[j] = (prevRow[j - 1] ?? 0) + 1;
      else row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
    }
  }

  const ops: string[] = [];
  let i = beforeLen;
  let j = afterLen;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.push(` ${before[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
      ops.push(`+${after[j - 1]}`);
      j--;
    } else {
      ops.push(`-${before[i - 1]}`);
      i--;
    }
  }
  ops.reverse();
  return [header, ...ops].join("\n");
}

/**
 * Pure helper. Returns a unified diff string (suitable for `patch -p1`)
 * that moves non-canonical top-level keys under `### <Tracker>`.
 *
 * Returns the empty string when no migration is needed (no section, or
 * top-level keys already canonical-only).
 */
export function computeMigrationDiff(content: string, claudeMdPath: string): string {
  const parsed = parse(content);
  if (!parsed) return "";

  // Identify mode + non-canonical keys + subsection presence.
  let mode = "";
  const offenders: string[] = [];
  let subsectionStart = -1;
  let subsectionName = "";
  let inSubsection = false;
  for (let i = 0; i < parsed.sectionLines.length; i++) {
    const line = parsed.sectionLines[i]!;
    const subM = /^###\s+(.+?)\s*$/.exec(line);
    if (subM) {
      if (subsectionStart < 0) {
        subsectionStart = i;
        subsectionName = subM[1]!;
      }
      inSubsection = true;
      continue;
    }
    if (inSubsection) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (key === "mode") mode = (m[2] ?? "").trim();
    if (CANONICAL_KEYS.has(key)) continue;
    offenders.push(line);
  }
  if (offenders.length === 0) return "";

  const trackerLabel = subsectionName || titleCase(mode || "Tracker");

  // Build the migrated section lines.
  const migratedSection: string[] = [];
  inSubsection = false;
  for (const line of parsed.sectionLines) {
    if (/^###\s/.test(line)) {
      // Existing subsection — preserve verbatim; offenders appended below.
      inSubsection = true;
      migratedSection.push(line);
      continue;
    }
    if (inSubsection) {
      migratedSection.push(line);
      continue;
    }
    const m = /^([a-z_][a-z0-9_]*)\s*:/.exec(line);
    if (m && !CANONICAL_KEYS.has(m[1]!)) {
      // Drop from top level — these go under the subsection.
      continue;
    }
    migratedSection.push(line);
  }
  // If a subsection already existed, append offenders to it; otherwise
  // append a new `### <Tracker>` block.
  if (subsectionStart >= 0) {
    // Append offenders to the end of the section (they fall under the
    // existing subsection, which is the last `###` block).
    if (migratedSection[migratedSection.length - 1] !== "") {
      migratedSection.push("");
    }
    for (const o of offenders) migratedSection.push(o);
  } else {
    if (migratedSection.length > 0 && migratedSection[migratedSection.length - 1] !== "") {
      migratedSection.push("");
    }
    migratedSection.push(`### ${trackerLabel}`);
    migratedSection.push("");
    for (const o of offenders) migratedSection.push(o);
  }

  const before = [
    ...parsed.preamble,
    parsed.heading,
    ...parsed.sectionLines,
    ...parsed.afterLines,
  ];
  const after = [
    ...parsed.preamble,
    parsed.heading,
    ...migratedSection,
    ...parsed.afterLines,
  ];

  // Headers (paths relative to repo-root style).
  const aPath = `a/${claudeMdPath.replace(/^[\/.]+/, "")}`;
  const bPath = `b/${claudeMdPath.replace(/^[\/.]+/, "")}`;
  const diffBody = buildHunk(before, after);
  return [`--- ${aPath}`, `+++ ${bPath}`, diffBody].join("\n");
}

// CLI entry: bun run scripts/migrate-task-tracking-canonical.ts <claude-md-path>
async function main(argv: string[]): Promise<number> {
  const path = argv[2];
  if (!path) {
    console.error("usage: migrate-task-tracking-canonical.ts <CLAUDE.md path>");
    return 1;
  }
  const content = readFileSync(path, "utf-8");
  const diff = computeMigrationDiff(content, path);
  if (diff === "") {
    console.error("# no migration needed — top-level keys are already canonical");
    return 0;
  }
  console.log(diff);
  return 0;
}

if (import.meta.main) {
  main(process.argv).then((code) => process.exit(code));
}
