// next_free_milestone_number — STE-119 AC-STE-119.2.
//
// Three-way scan to find the next safe `M<N>` allocation. Sources:
//   1. Active plan files: `<specsDir>/plan/M<N>.md`
//   2. Archived plan files: `<specsDir>/plan/archive/M<N>.md`
//   3. CHANGELOG.md `M<N>` references (best-effort signal)
//
// Returns `next = max(union) + 1` plus per-source breakdown so the caller
// can render the diagnostic table required by AC-STE-119.7.
//
// Edge cases:
//   - empty specs/ → `next: 1`
//   - gap in sequence (e.g., M12, M13, M16) → returns `max + 1`, never
//     reuses gap numbers (gaps are intentional — preserved for in-flight
//     work on stashes / abandoned milestones).
//   - missing / malformed CHANGELOG → vacuous (changelog source is the
//     third leg, not load-bearing); the file-system check is the hard gate.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MilestoneAvailability {
  next: number;
  sources: {
    active: number[];
    archived: number[];
    changelog: number[];
  };
}

const PLAN_FILENAME = /^M(\d+)\.md$/;
const CHANGELOG_M_REF = /\bM(\d+)\b/g;

function listMNumbers(dir: string): number[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => f.match(PLAN_FILENAME)?.[1])
    .filter((s): s is string => s !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function scanChangelog(path: string): number[] {
  if (!existsSync(path)) return [];
  const md = readFileSync(path, "utf-8");
  const found = new Set<number>();
  for (const match of md.matchAll(CHANGELOG_M_REF)) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

export function nextFreeMilestoneNumber(
  specsDir: string,
  changelogPath?: string,
): MilestoneAvailability {
  const active = listMNumbers(join(specsDir, "plan"));
  const archived = listMNumbers(join(specsDir, "plan", "archive"));
  const changelog = changelogPath ? scanChangelog(changelogPath) : [];
  const all = new Set<number>([...active, ...archived, ...changelog]);
  const max = all.size === 0 ? 0 : Math.max(...all);
  return { next: max + 1, sources: { active, archived, changelog } };
}
