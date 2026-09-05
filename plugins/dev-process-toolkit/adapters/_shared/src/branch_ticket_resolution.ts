// branch_ticket_resolution — STE-563. Resolve the active ticket on a branch
// that does not carry a ticket id, deterministically and without a prompt.
//
// WHY THIS EXISTS, MEASURED. The default Schema L branch template is
// `{type}/m{N}-{slug}`. Under STE-539's tracker-first Linear minting `{N}`
// renders `M_<6-hex>`, so a branch reads `feat/m_b11423-greet-helper` and
// carries no `STE-<N>` anywhere. `docs/ticket-binding.md` Tier 1 applies the
// adapter's `id_pattern` to the branch name, finds nothing, and Tier 2 asks a
// human — which under `claude -p` is nobody. `/gate-check` therefore withheld
// `push_ac_toggle` on the 2026-09-05 Linear leg: a green gate, a Done ticket,
// and four acceptance-criteria checkboxes that never toggled.
//
// Neither surface is wrong on its own. The template renders what M106 asked
// it to render; the resolver refuses to guess a ticket off a branch that does
// not name one, which is the silent-mutation risk `docs/ticket-binding.md`
// exists to prevent. They disagree BY CONSTRUCTION, so this module adds the
// missing tier rather than loosening either side.
//
// THE COMPARISON HAPPENS IN THE RENDERING DOMAIN, never by reconstructing a
// milestone id from a branch. `milestoneBranchToken`'s epic arm lowercases the
// key and rewrites `-` as `_`, so `M_PROJ-500`, `M_PROJ_500` and `M_proj_500`
// all render `m_proj_500` and the branch cannot say which it came from. A
// reconstructing implementation has to pick one and is wrong for the other
// two. Rendering the CANDIDATE forward through the same function the branch
// was built with is total in the direction it is used, so it has no such
// choice to get wrong.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import {
  MILESTONE_BRANCH_TEMPLATE,
  canonicalBranchTemplate,
  isProtectedTrunk,
  milestoneBranchToken,
} from "./branch_proposal";
import { normalizeFrontmatterSource } from "./frontmatter";
import { parseMilestoneToken } from "./milestone_token";

/**
 * The `{N}` substitution INPUT for a full milestone id.
 *
 * `buildBranchProposal` takes `{N}` asymmetrically and that asymmetry is
 * shipped: a numeric milestone arrives BARE (`"19"` → `m19`, because
 * `milestoneBranchToken` passes an unparseable value through untouched and
 * `"M19"` would render `mM19`), while an epic-keyed one arrives as the FULL
 * token (`"M_PROJ_500"` → `m_proj_500`). Callers holding an FR's
 * `milestone:` frontmatter hold the full token in both cases, so the mapping
 * belongs here rather than at every call site.
 */
export function milestoneBranchInput(milestoneId: string): string | null {
  const token = parseMilestoneToken(milestoneId);
  if (token === null) return null;
  return token.kind === "numeric" ? String(token.number) : milestoneId;
}

/**
 * The branch SEGMENT a milestone id renders to under the milestone-keyed
 * template — `M19` → `m19`, `M_f040b5` → `m_f040b5`, `M_PROJ-500` →
 * `m_proj_500`.
 *
 * Returns `null` for an id the union grammar does not accept, and for one
 * whose canonical template is the ticket-keyed form (there is no milestone
 * segment on such a branch to compare against).
 */
export function milestoneBranchSegmentFor(milestoneId: string): string | null {
  const input = milestoneBranchInput(milestoneId);
  if (input === null) return null;
  if (canonicalBranchTemplate({ milestone: input }) !== MILESTONE_BRANCH_TEMPLATE) return null;
  return `m${milestoneBranchToken(input)}`;
}

/**
 * The milestone segment a branch carries, or `null`.
 *
 * Anchored on the template's own shape: the segment sits at the head of the
 * template's last path component and runs to the `-` that introduces the
 * slug. Anchoring rather than substring-searching is what removes the
 * `m19` / `m191` hazard `matchesMilestone` handles with `\b` — here the whole
 * segment is delimited on both sides, so `m19` cannot be found inside `m191`
 * and `m_proj_500` cannot be found inside `m_proj_5001`.
 *
 * The accepted alphabet is exactly what the renderer emits: bare digits, or
 * `_` followed by an epic key already through `epicBranchKey` (lowercase,
 * `-` rewritten to `_`, alphanumeric head). Widening it past that would
 * accept branches `buildBranchProposal` cannot produce.
 */
const MILESTONE_SEGMENT_RE = /(?:^|\/)(m(?:\d+|_[a-z0-9][a-z0-9_]*))(?=-|$)/;

export function milestoneBranchSegment(branch: string): string | null {
  const m = MILESTONE_SEGMENT_RE.exec(branch.toLowerCase());
  return m === null ? null : m[1]!;
}

/**
 * Does `branch` name `milestoneId`? Compared in the rendering domain — both
 * sides are what the renderer emits, never what a parser guessed.
 */
export function milestoneMatchesBranch(milestoneId: string, branch: string): boolean {
  const rendered = milestoneBranchSegmentFor(milestoneId);
  if (rendered === null) return false;
  return milestoneBranchSegment(branch) === rendered;
}

/** One FR the walk considered, with the two fields resolution reads. */
export interface FrCandidate {
  /** Repo-relative path, for the reason line. */
  file: string;
  /** `milestone:` frontmatter, verbatim. */
  milestone: string;
  /** The tracker id under `tracker:`, or `null` when the FR carries none. */
  ticketId: string | null;
}

/** How the ticket was resolved, or why it was not. */
export type TicketResolution =
  | { tier: "branch-id"; ticketId: string }
  | { tier: "milestone-fr"; ticketId: string; milestone: string; frPath: string }
  | { tier: "interactive"; reason: string };

const FR_DIR = join("specs", "frs");

/** `specs/frs/` then `specs/frs/archive/` — the house live-then-archive order. */
function frFiles(projectRoot: string): string[] {
  const out: string[] = [];
  for (const dir of [join(projectRoot, FR_DIR), join(projectRoot, FR_DIR, "archive")]) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      if (name.endsWith(".md")) out.push(join(dir, name));
    }
  }
  return out;
}

/**
 * Read one FR's `milestone:` and its tracker id.
 *
 * Normalized first: a CRLF or BOM-mangled FR otherwise reads as having no
 * frontmatter at all and is silently skipped, which would turn a resolvable
 * branch into an interactive prompt with no explanation.
 */
export function readFrCandidate(projectRoot: string, path: string): FrCandidate | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  const lines = normalizeFrontmatterSource(raw).split("\n");
  if (lines[0] !== "---") return null;

  let milestone: string | null = null;
  let ticketId: string | null = null;
  let inTracker = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "---") break;
    // A `tracker:` block's entries are indented one level; anything at column
    // zero closes it. Reading a nested value as a top-level key is how a
    // sibling reader once bound `linear:` from the wrong block.
    if (inTracker) {
      const nested = /^\s+([a-z_]+):\s*(.*?)\s*$/.exec(line);
      if (nested !== null) {
        if (ticketId === null && nested[2]!.length > 0) ticketId = nested[2]!;
        continue;
      }
      inTracker = false;
    }
    const top = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (top === null) continue;
    if (top[1] === "milestone") milestone = top[2]!;
    else if (top[1] === "tracker") inTracker = true;
  }
  if (milestone === null || milestone.length === 0) return null;
  return { file: relative(projectRoot, path), milestone, ticketId };
}

/**
 * Resolve the active ticket for `branch`.
 *
 * Tier 1 (`branch-id`) is unchanged and still first: a branch carrying a
 * ticket id matching the adapter's `id_pattern` wins silently.
 *
 * Tier 1b (`milestone-fr`) is this FR's addition: a milestone-keyed branch
 * whose milestone is bound by EXACTLY ONE FR carrying a tracker id resolves
 * to that FR's ticket. Deterministic, local-file-only, no prompt.
 *
 * Everything else returns `interactive` with a reason naming what was found.
 * More than one candidate NEVER resolves — not the first, not the newest, not
 * the one whose slug is closest to the branch. A milestone branch carrying
 * several FRs is the ordinary case, and picking one of them is exactly the
 * guess `docs/ticket-binding.md` forbids.
 *
 * Resolution is not consent: the mandatory confirmation prompt is unchanged
 * and still runs on the value this returns.
 */
export function resolveTicketForBranch(
  projectRoot: string,
  branch: string,
  opts: { idPattern?: RegExp } = {},
): TicketResolution {
  if (isProtectedTrunk(branch)) {
    return { tier: "interactive", reason: `branch "${branch}" is a protected trunk` };
  }

  const idPattern = opts.idPattern ?? /[A-Z]+-\d+/;
  const onBranch = new RegExp(idPattern.source, idPattern.flags.replace("g", ""))
    .exec(branch.toUpperCase());
  if (onBranch !== null) return { tier: "branch-id", ticketId: onBranch[0] };

  const segment = milestoneBranchSegment(branch);
  if (segment === null) {
    return {
      tier: "interactive",
      reason: `branch "${branch}" carries neither a ticket id nor a milestone segment`,
    };
  }

  const matches: FrCandidate[] = [];
  for (const path of frFiles(projectRoot)) {
    const fr = readFrCandidate(projectRoot, path);
    if (fr === null || fr.ticketId === null) continue;
    if (milestoneBranchSegmentFor(fr.milestone) === segment) matches.push(fr);
  }

  if (matches.length === 1) {
    const only = matches[0]!;
    return {
      tier: "milestone-fr",
      ticketId: only.ticketId!,
      milestone: only.milestone,
      frPath: only.file,
    };
  }
  if (matches.length === 0) {
    return {
      tier: "interactive",
      reason: `branch "${branch}" names milestone segment "${segment}", which no FR under specs/frs/ binds with a tracker id`,
    };
  }
  const ids = matches.map((m) => m.ticketId!).join(", ");
  return {
    tier: "interactive",
    reason: `branch "${branch}" names milestone segment "${segment}", which ${matches.length} FRs bind (${ids}) — refusing to choose`,
  };
}

if (import.meta.main) {
  const [projectRoot, branch] = process.argv.slice(2);
  if (!projectRoot || !branch) {
    console.error("usage: bun branch_ticket_resolution.ts <projectRoot> <branch>");
    process.exit(2);
  }
  const resolution = resolveTicketForBranch(projectRoot, branch);
  if (resolution.tier === "interactive") {
    console.log(`ticket-resolution: interactive — ${resolution.reason}`);
    process.exit(1);
  }
  console.log(`ticket-resolution: ${resolution.tier} ${resolution.ticketId}`);
  process.exit(0);
}
