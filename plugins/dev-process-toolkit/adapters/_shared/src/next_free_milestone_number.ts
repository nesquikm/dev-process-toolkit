// next_free_milestone_number — STE-119 AC-STE-119.2 + STE-284 AC-STE-284.1
//   + STE-338 AC-STE-338.4.
//
// Five-way scan over every `M<N>` the project can already see.
//
// NO IDENTITY ROUTE CALLS THIS ANY MORE. Every branch of
// `resolve_milestone_identity.ts` derives its milestone id from a key — the
// tracker's, or the local minter's — and `mode: linear` was the last one to
// stop scanning (STE-541). What the scan still owns is the check an operator
// who hand-TYPES an `M<N>` needs: `explicitMilestoneCollisionRefusal` below,
// reachable in process or through this module's own front door at the foot of
// the file. Read the counts below as "what the project can already see",
// never as "what the next milestone will be named".
//
// Sources:
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
import { NUMERIC_MILESTONE_NUMBER_SOURCE } from "./milestone_token";

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

const PLAN_FILENAME = new RegExp(String.raw`^${NUMERIC_MILESTONE_NUMBER_SOURCE}\.md$`);
const CHANGELOG_M_REF = new RegExp(String.raw`\b${NUMERIC_MILESTONE_NUMBER_SOURCE}\b`, "g");
const TRACKER_MILESTONE_NAME = new RegExp(`^${NUMERIC_MILESTONE_NUMBER_SOURCE}`);

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

/** One scan source's name, derived from the result shape rather than listed. */
type MilestoneSourceName = keyof MilestoneAvailability["sources"];

/**
 * The per-source breakdown, one indented `  <source>: <numbers>` line each,
 * `(none)` for an empty leg.
 *
 * Rendered by walking the KEYS of `sources`, never a hand-written list of
 * five. Both consumers — the collision refusal below and the front door at the
 * foot of this file — print the same breakdown, and each had its own copy of
 * the formatting rule; a sixth source added to `MilestoneAvailability` would
 * have been reported by whichever copy someone remembered to extend and gone
 * silently missing from the other. One renderer, so neither path can go quiet
 * alone.
 */
export function renderMilestoneSourceBreakdown(
  sources: MilestoneAvailability["sources"],
): string[] {
  return (Object.keys(sources) as MilestoneSourceName[]).map(
    (s) => `  ${s}: ${sources[s].length === 0 ? "(none)" : sources[s].join(", ")}`,
  );
}

/**
 * The explicit-`M<N>` collision check the milestone-number allocation guard
 * orders in prose: an operator who TYPES a milestone number gets it validated
 * against all five sources, and a number any of them already holds is refused
 * in NFR-10 canonical shape showing every breakdown plus the next free number.
 *
 * Returns `null` when the typed number is free — the guard proceeds — and the
 * refusal text when it is taken. Building the message here rather than at the
 * call site keeps the five-source breakdown and the scan that produced it in
 * one place, so a source added to `MilestoneAvailability` cannot go unreported.
 */
export function explicitMilestoneCollisionRefusal(
  typed: number,
  availability: MilestoneAvailability,
): string | null {
  const { sources } = availability;
  const holders = (Object.keys(sources) as MilestoneSourceName[]).filter((s) =>
    sources[s].includes(typed),
  );
  if (holders.length === 0) return null;
  return [
    `Refusing: milestone M${typed} is already claimed — the five-way scan found it in: ${holders.join(", ")}.`,
    `Remedy: type M${availability.next} instead, or pick a number none of the five sources holds.`,
    `Context: mode=milestone-number-allocation, phase=explicit-M-token-check, typed=M${typed}, next-free=M${availability.next}`,
    ...renderMilestoneSourceBreakdown(sources),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Command-line entry point
// ---------------------------------------------------------------------------
//
// The scan no longer allocates an identity for a new Linear milestone — that
// is the minter's job now. What survives is the check an operator who TYPES an
// `M<N>` still needs: this door runs the five-way scan over a real specs tree
// and either refuses the typed number with the full breakdown or reports the
// next free one.
//
//   bun run adapters/_shared/src/next_free_milestone_number.ts specs M101
//   Refusing: milestone M101 is already claimed — ...
//
//   bun run adapters/_shared/src/next_free_milestone_number.ts specs M999
//   typed=M999
//   verdict=free
//   next-free=M102
//
// The tracker and branch legs need injected scanners this door cannot build,
// so both report `(none)` here — the file-system and CHANGELOG legs are the
// ones a command line can measure. `import.meta.main` is false on import, so
// the module stays side-effect free for its importers.
if (import.meta.main) {
  const specsDir = process.argv[2];
  const typedToken = process.argv[3];
  const typedNumber = typedToken?.match(new RegExp(`^${NUMERIC_MILESTONE_NUMBER_SOURCE}$`))?.[1];

  if (specsDir === undefined || typedNumber === undefined) {
    console.error(
      [
        "Refusing: to check a typed milestone identity without a specs directory and an `M<N>` token.",
        "Remedy: bun run adapters/_shared/src/next_free_milestone_number.ts <specsDir> <typed-M-token>",
        `Context: mode=milestone-number-allocation, phase=explicit-M-token-check, argv=${specsDir === undefined ? "incomplete" : `malformed-token:${typedToken}`}`,
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    const typed = Number(typedNumber);
    const availability = await nextFreeMilestoneNumber(
      specsDir,
      join(specsDir, "..", "CHANGELOG.md"),
    );
    const refusal = explicitMilestoneCollisionRefusal(typed, availability);
    if (refusal !== null) {
      console.error(refusal);
      process.exitCode = 1;
    } else {
      console.log(`typed=M${typed}`);
      console.log("verdict=free");
      console.log(`next-free=M${availability.next}`);
      // The SAME renderer the refusal uses, so the free verdict and the
      // refused one can never disagree about what the scan saw.
      for (const line of renderMilestoneSourceBreakdown(availability.sources)) {
        console.log(line);
      }
    }
  }
}
