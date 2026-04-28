// migrate_fr_frontmatter_strip_id — STE-121 AC-STE-121.7 migration helper.
//
// Dry-run only. Walks active `specs/frs/*.md` (excluding `archive/`),
// detects FRs that carry BOTH an `id:` line AND a populated `tracker:` block
// (the regression shape the M29 prose flip didn't catch), and returns a
// unified diff per file that strips the `id:` line. Operator pipes the
// concatenated diff to `patch -p1` to apply.
//
// Pattern mirrors STE-114's `migrate_task_tracking_canonical.ts`:
// LCS-aware diff renderer, `--- a/` / `+++ b/` headers, no automatic
// backfill, archive immutable per STE-22 / AC-STE-18.4.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

interface FRFrontmatterScan {
  hasId: boolean;
  hasPopulatedTracker: boolean;
}

function scanFrontmatter(content: string): FRFrontmatterScan {
  if (!content.startsWith("---\n")) return { hasId: false, hasPopulatedTracker: false };
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return { hasId: false, hasPopulatedTracker: false };
  const fm = content.slice(4, closeIdx);
  const lines = fm.split("\n");
  let hasId = false;
  let hasPopulatedTracker = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^id:\s*\S/.test(line)) hasId = true;
    if (/^tracker:\s*$/.test(line)) {
      // Look for at least one populated child key on the next line(s).
      for (let j = i + 1; j < lines.length; j++) {
        const child = lines[j]!;
        if (/^\s{2,}\S+:\s*\S/.test(child)) {
          hasPopulatedTracker = true;
          break;
        }
        if (/^\S/.test(child)) break; // sibling key ended the tracker block
      }
    }
  }
  return { hasId, hasPopulatedTracker };
}

function buildHunk(before: string[], after: string[]): string {
  const beforeLen = before.length;
  const afterLen = after.length;
  const header = `@@ -1,${beforeLen} +1,${afterLen} @@`;

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

export interface MigrationDiff {
  path: string;
  diff: string;
}

/**
 * Walk `<specsDir>/frs/*.md` (skipping `archive/`) and return a unified diff
 * per file that strips the `id:` line on FRs carrying both `id:` and a
 * populated `tracker:` block. Returns the empty array when no migration
 * is needed.
 */
export async function computeStripIdMigrationDiffs(specsDir: string): Promise<MigrationDiff[]> {
  const frsDir = join(specsDir, "frs");
  let entries: string[];
  try {
    entries = await readdir(frsDir);
  } catch {
    return [];
  }
  const diffs: MigrationDiff[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const path = join(frsDir, entry);
    let content: string;
    try {
      content = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    const scan = scanFrontmatter(content);
    if (!(scan.hasId && scan.hasPopulatedTracker)) continue;
    const before = content.split("\n");
    const after = before.filter((line) => !/^id:\s*\S/.test(line));
    const aPath = `a/${relative(specsDir, path)}`;
    const bPath = `b/${relative(specsDir, path)}`;
    const body = buildHunk(before, after);
    diffs.push({ path, diff: [`--- ${aPath}`, `+++ ${bPath}`, body].join("\n") });
  }
  return diffs;
}
