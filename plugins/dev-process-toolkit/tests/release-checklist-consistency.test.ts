// STE-138 AC-STE-138.4 — guard against checklist-vs-reality drift in
// CLAUDE.md `## Release Checklist`. The checklist is the procedure that
// keeps every release-impacted file in sync; if the checklist itself is
// drifted the procedure quietly skips files. Tests:
//   1. The numbered list enumerates exactly the canonical five paths.
//   2. Every enumerated path exists.
//   3. Every `## <heading>` mentioned inside a checklist entry resolves
//      to a real heading in the named target file.
//   4. The prose preamble's file-count claim matches the actual list
//      length.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

interface ChecklistEntry {
  path: string;
  rawLine: string;
}

interface Checklist {
  intro: string;
  entries: ChecklistEntry[];
}

function readChecklist(): Checklist {
  const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf-8");
  const sectionMatch = claudeMd.match(/## Release Checklist\n([\s\S]*?)(?=\n## |$)/);
  if (!sectionMatch) {
    throw new Error("CLAUDE.md is missing ## Release Checklist section");
  }
  const body = sectionMatch[1]!;
  const intro = body.split("\n").find((l) => /MUST all be updated together/.test(l)) ?? "";
  const entries: ChecklistEntry[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\d+\.\s+`([^`]+)`/);
    if (m) entries.push({ path: m[1]!, rawLine: line });
  }
  return { intro, entries };
}

const NUMBER_WORDS: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
};

describe("AC-STE-138.4 — Release Checklist matches reality", () => {
  test("numbered list enumerates exactly five files (G20 fix)", () => {
    const { entries } = readChecklist();
    expect(entries.length).toBe(5);
  });

  test("preamble file-count claim matches the list length", () => {
    const { intro, entries } = readChecklist();
    const word = NUMBER_WORDS[entries.length] ?? String(entries.length);
    const pattern = new RegExp(`\\bthese\\s+(${word}|${entries.length})\\s+files\\b`, "i");
    if (!pattern.test(intro)) {
      throw new Error(
        `Release Checklist preamble claims a different file count than the list (${entries.length} entries). Preamble: "${intro}"`,
      );
    }
    expect(intro).toMatch(pattern);
  });

  test("each enumerated file path exists in the repo", () => {
    const { entries } = readChecklist();
    for (const e of entries) {
      expect(existsSync(join(repoRoot, e.path))).toBe(true);
    }
  });

  test("every backticked `## <heading>` in a checklist entry resolves in the target file (G21 fix)", () => {
    const { entries } = readChecklist();
    // "Add a new ..." entries describe additive shape (e.g., the next
    // CHANGELOG section); the heading does not yet exist in the target.
    // Only existing-section pointers are checked.
    const isAdditive = (line: string) => /\badd\s+a\s+new\b/i.test(line);
    for (const e of entries) {
      if (isAdditive(e.rawLine)) continue;
      const headingRefs = [...e.rawLine.matchAll(/`(##\s+[^`]+?)`/g)].map((m) => m[1]!);
      if (headingRefs.length === 0) continue;
      const target = readFileSync(join(repoRoot, e.path), "utf-8");
      for (const h of headingRefs) {
        const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`^${escaped}\\b`, "m");
        if (!re.test(target)) {
          throw new Error(
            `Release Checklist entry for \`${e.path}\` references heading ${h}, but no such heading exists in that file.`,
          );
        }
        expect(target).toMatch(re);
      }
    }
  });

  test("specs/requirements.md is one of the enumerated files (G20 fix)", () => {
    const { entries } = readChecklist();
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("specs/requirements.md");
  });
});
