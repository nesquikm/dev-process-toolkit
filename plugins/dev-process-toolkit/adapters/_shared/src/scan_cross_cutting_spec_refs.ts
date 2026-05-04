// scan_cross_cutting_spec_refs (STE-215) — given a removed path and a
// specs directory, find every reference to the path in
// `specs/technical-spec.md` and `specs/testing-spec.md`. Used by
// `/implement` Phase 4 to propagate file deletions to the cross-cutting
// specs (directory-tree leaf lines auto-cleaned; prose mentions flagged
// for human review) and by the `/gate-check` `cross-cutting-spec-stale-
// file-refs` probe as a defense-in-depth read-side check.
//
// Two reference shapes:
//   - `treeLeaf`: line inside a triple-backtick fence whose tree-character
//     prefix indicates it is a leaf entry naming the path.
//   - `proseMention`: line outside any fence that names the path.
//
// Match rule: a line "names the path" iff it contains either the basename
// or the full relative-path token. Both shapes match the same rule; only
// the position (inside/outside fence) determines the kind. The basename-
// only match catches the common `.placeholder.test.ts` shape where the
// directory tree shows it as a leaf without the parent prefix.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type RefKind = "treeLeaf" | "proseMention";

export interface CrossCuttingSpecRef {
  line: number;
  snippet: string;
  kind: RefKind;
}

export interface CrossCuttingSpecScanResult {
  technicalSpec: CrossCuttingSpecRef[];
  testingSpec: CrossCuttingSpecRef[];
}

function scanFile(
  absPath: string,
  removedPath: string,
): CrossCuttingSpecRef[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }

  const removedBase = basename(removedPath);
  const lines = content.split("\n");
  const refs: CrossCuttingSpecRef[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const namesPath = line.includes(removedPath) || line.includes(removedBase);
    if (!namesPath) continue;
    refs.push({
      line: i + 1,
      snippet: line,
      kind: inFence ? "treeLeaf" : "proseMention",
    });
  }
  return refs;
}

export function scanCrossCuttingSpecRefs(
  removedPath: string,
  specsDir: string,
): CrossCuttingSpecScanResult {
  return {
    technicalSpec: scanFile(join(specsDir, "technical-spec.md"), removedPath),
    testingSpec: scanFile(join(specsDir, "testing-spec.md"), removedPath),
  };
}
