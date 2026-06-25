// next_free_milestone_number — STE-119 AC-STE-119.2 + STE-284 AC-STE-284.1
//   + STE-338 AC-STE-338.4.
//
// Five-way scan to find the next safe `M<N>` allocation. Sources:
//   1. Active plan files: `<specsDir>/plan/M<N>.md`
//   2. Archived plan files: `<specsDir>/plan/archive/M<N>.md`
//   3. CHANGELOG.md `M<N>` references (best-effort signal)
//   4. Tracker milestones (optional, when `provider` is supplied) — names
//      matching `M(\d+)` from `provider.listMilestones()`.
//   5. Git branch milestones (optional, when `branchScanner` is supplied) —
//      `M<N>` numbers from `branchScanner.listBranchMilestones()`.
//
// Returns `next = max(union) + 1` plus per-source breakdown so the caller
// can render the diagnostic table required by AC-STE-119.7 / AC-STE-284.4.
//
// Edge cases:
//   - empty specs/ → `next: 1`
//   - gap in sequence (e.g., M12, M13, M16) → returns `max + 1`, never
//     reuses gap numbers (gaps are intentional — preserved for in-flight
//     work on stashes / abandoned milestones).
//   - missing / malformed CHANGELOG → vacuous (changelog source is the
//     third leg, not load-bearing); the file-system check is the hard gate.
//   - provider omitted / `mode: none` → `sources.tracker: []` (vacuous).
//   - branchScanner omitted → `sources.branches: []` (vacuous).
//   - tracker names that are not `M<N>` (e.g. "Backlog", "Cycle 7") are
//     ignored. Duplicates are deduped; result is sorted ascending.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MilestoneAvailability {
  next: number;
  sources: {
    active: number[];
    archived: number[];
    changelog: number[];
    tracker: number[];
    branches: number[];
  };
}

/**
 * Duck-typed milestone provider. Tracker adapters (Linear, Jira) expose this
 * shape via their `listMilestones()` capability; we only need the name field
 * to extract `M<N>` numbers.
 */
export interface MilestoneListingProvider {
  listMilestones: (project?: string) => Promise<{ name: string }[]>;
}

/**
 * Duck-typed branch scanner. Enumerates `M<N>` milestone numbers from git
 * branch refs (local + remote). Injected like `provider`; awaited only when
 * supplied. Returns numbers; the result is deduped + sorted ascending here.
 */
export interface BranchMilestoneScanner {
  listBranchMilestones: () => Promise<number[]>;
}

const PLAN_FILENAME = /^M(\d+)\.md$/;
const CHANGELOG_M_REF = /\bM(\d+)\b/g;
const TRACKER_MILESTONE_NAME = /^M(\d+)/;

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

async function scanTracker(provider: MilestoneListingProvider): Promise<number[]> {
  const milestones = await provider.listMilestones();
  const found = new Set<number>();
  for (const m of milestones) {
    const match = m.name.match(TRACKER_MILESTONE_NAME);
    if (match) found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

async function scanBranches(scanner: BranchMilestoneScanner): Promise<number[]> {
  const numbers = await scanner.listBranchMilestones();
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export async function nextFreeMilestoneNumber(
  specsDir: string,
  changelogPath?: string,
  provider?: MilestoneListingProvider,
  branchScanner?: BranchMilestoneScanner,
): Promise<MilestoneAvailability> {
  const active = listMNumbers(join(specsDir, "plan"));
  const archived = listMNumbers(join(specsDir, "plan", "archive"));
  const changelog = changelogPath ? scanChangelog(changelogPath) : [];
  const tracker = provider ? await scanTracker(provider) : [];
  const branches = branchScanner ? await scanBranches(branchScanner) : [];
  const all = new Set<number>([...active, ...archived, ...changelog, ...tracker, ...branches]);
  const max = all.size === 0 ? 0 : Math.max(...all);
  return { next: max + 1, sources: { active, archived, changelog, tracker, branches } };
}
