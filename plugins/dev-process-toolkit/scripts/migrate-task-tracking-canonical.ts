// STE-114 AC-STE-114.5 — one-time migration helper for projects that picked
// up non-canonical Schema L keys at the top level of `## Task Tracking`.
//
// Dry-run only. Reads CLAUDE.md, extracts non-canonical top-level keys, and
// prints a unified diff that moves each key line, verbatim and prefixed `- `,
// into a `## Tracker Notes` prose section inserted directly after the
// `## Task Tracking` span (appending to an existing `## Tracker Notes`
// instead of adding a second heading). Metadata never lands in a tracker
// sub-section: the settings schema is closed and the settings move refuses it.
// Operator pipes to `patch -p1` if they want to apply.

import { readFileSync } from "node:fs";
import { TASK_TRACKING_HEADING } from "../adapters/_shared/src/project_settings_legacy";
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
  const startIdx = lines.findIndex((l) => l === TASK_TRACKING_HEADING);
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

const TRACKER_NOTES_HEADING = "## Tracker Notes";

/**
 * Pure helper. Returns a unified diff string (suitable for `patch -p1`)
 * that moves non-canonical top-level keys into a `## Tracker Notes` prose
 * section directly after the `## Task Tracking` span, each line verbatim
 * and prefixed `- `. An existing `## Tracker Notes` is appended to.
 *
 * Returns the empty string when no migration is needed (no section, or
 * top-level keys already canonical-only).
 */
export function computeMigrationDiff(content: string, claudeMdPath: string): string {
  const parsed = parse(content);
  if (!parsed) return "";

  // Split the span into kept lines and offending top-level key lines.
  // Sub-section contents are scoped out of the canonical-key check.
  const offenders: string[] = [];
  const migratedSection: string[] = [];
  let inSubsection = false;
  for (const line of parsed.sectionLines) {
    if (/^###\s/.test(line)) inSubsection = true;
    if (!inSubsection) {
      const m = /^([a-z_][a-z0-9_]*)\s*:/.exec(line);
      if (m && !CANONICAL_KEYS.has(m[1]!)) {
        offenders.push(line);
        continue;
      }
    }
    migratedSection.push(line);
  }
  if (offenders.length === 0) return "";
  const bullets = offenders.map((o) => `- ${o}`);

  const after = [...parsed.preamble, parsed.heading, ...migratedSection, ...parsed.afterLines];
  const notesAt = after.indexOf(TRACKER_NOTES_HEADING);
  if (notesAt >= 0) {
    // Append to the existing notes section, before its trailing blank lines.
    let end = after.length;
    for (let i = notesAt + 1; i < after.length; i++) {
      if (/^#{1,2}\s/.test(after[i]!)) {
        end = i;
        break;
      }
    }
    let insertAt = end;
    while (insertAt - 1 > notesAt && after[insertAt - 1] === "") insertAt--;
    const block = insertAt === notesAt + 1 ? ["", ...bullets] : [...bullets];
    if (insertAt === end) block.push("");
    after.splice(insertAt, 0, ...block);
  } else {
    // Insert a new notes section directly after the `## Task Tracking` span.
    const insertAt = parsed.preamble.length + 1 + migratedSection.length;
    const block: string[] = [];
    if (migratedSection.length > 0 && migratedSection[migratedSection.length - 1] !== "") block.push("");
    block.push(TRACKER_NOTES_HEADING, "", ...bullets, "");
    after.splice(insertAt, 0, ...block);
  }

  const before = [
    ...parsed.preamble,
    parsed.heading,
    ...parsed.sectionLines,
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
