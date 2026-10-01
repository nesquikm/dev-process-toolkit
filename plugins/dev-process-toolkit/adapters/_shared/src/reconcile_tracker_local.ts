// STE-284 AC-STE-284.2 — reconcileTrackerLocal helper.
//
// Walks `<specsDir>/frs/*.md` (excluding archive/) and `<specsDir>/plan/M*.md`
// (excluding archive/) and reconciles them against `provider.listActiveFRs()`
// + `provider.listMilestones()`. Returns three disjoint orphan lists:
//
//   - trackerOrphans:    tracker FR IDs with no local file
//   - localOrphans:      local FR files with no tracker binding (or whose
//                        binding points to an FR not on tracker)
//   - milestoneMismatches: milestone names present on one side only
//
// Shared repository (STE-652, `{ shared: true }`): on the tracker-side
// milestone direction only, a tracker milestone that no local FR (active or
// archived, by `milestone:` frontmatter) and no plan (active or archived)
// claims is a sibling's — it lands in `skippedMilestones`, never in
// `milestoneMismatches`; a claimed one is graded against active AND archived
// plans. Without the option the output is exactly the unshared one.
//
// Mode-none: vacuous (all three lists empty) — `LocalProvider` has no tracker
// to reconcile against, so the helper short-circuits before touching the FS.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { isMilestoneToken, PLAN_FILENAME_RE } from "./milestone_token";
import type { Provider } from "./provider";

export type ReconcileItemKind = "tracker-orphan" | "local-orphan" | "milestone-mismatch";

/**
 * Which side of the reconcile OWNS the artifact that has no counterpart on the
 * other side. `"tracker"` — the tracker carries it and nothing local matches;
 * `"local"` — the working tree carries it and nothing on the tracker matches.
 *
 * Load-bearing for `milestone-mismatch`, where both directions emit an
 * identical `kind` and were previously distinguishable only by free-text
 * `details`. Consumers that need one direction only (the
 * `tracker_local_reconciliation_drift` probe filters the local direction to
 * apply its scaffolding-plan carve-out) branch on this field rather than
 * regexing prose that a copy edit can silently invalidate.
 */
export type ReconcileSide = "local" | "tracker";

export interface ReconcileItem {
  kind: ReconcileItemKind;
  id: string;
  details: string;
  side: ReconcileSide;
  /** STE-605 — present only on tracker orphans of the classified-ticket path. */
  ownerClass?: string;
  /** STE-605 — the ticket creator's display name; classified-ticket path only. */
  owner?: string;
}

/**
 * STE-605 — one tracker ticket already classified by `container_ownership.ts`
 * (`classifyTicket`). Passed in place of the bare ids `provider.listActiveFRs()`
 * returns; this module never classifies by itself.
 */
export interface ClassifiedTrackerTicket {
  key: string;
  ownerClass: string;
  owner: string;
}

export interface ReconcileOptions {
  /** When given, replaces `provider.listActiveFRs()` as the tracker's FR set. */
  tickets?: ClassifiedTrackerTicket[];
  /**
   * STE-652 — the repository shares its tracker container with siblings. Used
   * only on the tracker-side milestone direction: a tracker milestone that no
   * local FR (active or archived) and no plan (active or archived) claims is a
   * sibling's — listed in `skippedMilestones`, never reported. A claimed one
   * is graded against active AND archived plans.
   */
  shared?: boolean;
}

// Classes never offered as tracker orphans: containers in every mode,
// siblings (which only exist in a shared repository).
const NEVER_ORPHAN_CLASSES: ReadonlySet<string> = new Set(["container", "sibling"]);

export interface ReconcileTrackerLocalResult {
  trackerOrphans: ReconcileItem[];
  localOrphans: ReconcileItem[];
  milestoneMismatches: ReconcileItem[];
  /** STE-652 — present only with `shared: true`: unclaimed tracker milestones. */
  skippedMilestones?: string[];
}

/**
 * Parsed view of one local FR file: its base filename (no directory) and the
 * list of tracker IDs declared in its `tracker:` frontmatter block (across
 * all tracker keys). Exported so cross-cutting consumers (e.g., the
 * `tracker_local_reconciliation_drift` gate-check probe) can share the same
 * FS-walk + frontmatter-parse pass instead of re-implementing it.
 */
export interface LocalFRBinding {
  filename: string;
  trackerIds: string[];
}

// Shared union grammar — Epic-keyed `M_<epic-key>` milestones reconcile
// alongside numeric `M<N>` (they are listable via the Jira Epic leg).

/**
 * Reconcile tracker-side state (active FR IDs + milestone names) against
 * local filesystem state (`<specsDir>/frs/*.md` + `<specsDir>/plan/M*.md`,
 * excluding `archive/`).
 *
 * Returns three disjoint orphan lists; never throws on missing directories
 * (a brand-new specs/ tree is a valid empty starting state).
 *
 * Mode-none (`provider.mode === 'none'`) returns three empty lists without
 * any FS or tracker calls — the AC-STE-284.2 vacuous branch.
 */
export async function reconcileTrackerLocal(
  provider: Provider,
  specsDir: string,
  options: ReconcileOptions = {},
): Promise<ReconcileTrackerLocalResult> {
  if (provider.mode === "none") {
    return { trackerOrphans: [], localOrphans: [], milestoneMismatches: [] };
  }

  const classified = options.tickets;
  const [trackerFRs, trackerMilestones] = await Promise.all([
    classified === undefined ? provider.listActiveFRs() : Promise.resolve(classified.map((t) => t.key)),
    provider.listMilestones(),
  ]);
  const classOf = new Map((classified ?? []).map((t) => [t.key, t] as const));

  const local = readLocalFRBindings(specsDir);
  const localPlanMilestones = readPlanMilestonesIn(join(specsDir, "plan"));

  // Build the set of tracker IDs bound by any local FR (across any tracker key).
  const boundTrackerIds = new Set<string>();
  for (const fr of local) {
    for (const id of fr.trackerIds) {
      boundTrackerIds.add(id);
    }
  }
  const trackerSet = new Set(trackerFRs);

  // tracker-orphan: tracker carries an active FR ID nothing local binds to.
  const trackerOrphans: ReconcileItem[] = [];
  for (const trackerId of trackerFRs) {
    if (boundTrackerIds.has(trackerId)) continue;
    const ticket = classOf.get(trackerId);
    if (ticket === undefined) {
      trackerOrphans.push({
        kind: "tracker-orphan",
        id: trackerId,
        details: `Tracker active FR ${trackerId} has no local file under ${specsDir}/frs/.`,
        side: "tracker",
      });
      continue;
    }
    if (NEVER_ORPHAN_CLASSES.has(ticket.ownerClass)) continue;
    trackerOrphans.push({
      kind: "tracker-orphan",
      id: trackerId,
      details: `Tracker active FR ${trackerId} (class ${ticket.ownerClass}, owner ${ticket.owner}) has no local file under ${specsDir}/frs/.`,
      side: "tracker",
      ownerClass: ticket.ownerClass,
      owner: ticket.owner,
    });
  }

  // local-orphan: local FR with no tracker binding at all, or whose bindings
  // all point at IDs not present on the tracker active list.
  const localOrphans: ReconcileItem[] = [];
  for (const fr of local) {
    if (fr.trackerIds.length === 0) {
      localOrphans.push({
        kind: "local-orphan",
        id: fr.filename,
        details: `Local FR ${fr.filename} has no tracker binding (\`tracker:\` is empty).`,
        side: "local",
      });
      continue;
    }
    const anyMatch = fr.trackerIds.some((id) => trackerSet.has(id));
    if (!anyMatch) {
      localOrphans.push({
        kind: "local-orphan",
        id: fr.filename,
        details: `Local FR ${fr.filename} binds to tracker IDs [${fr.trackerIds.join(", ")}] but none are active on the tracker.`,
        side: "local",
      });
    }
  }

  // milestone-mismatch: tracker milestones matching `M\d+` not in local plans,
  // OR local plan filenames not in tracker milestones.
  const milestoneMismatches: ReconcileItem[] = [];
  const localPlanSet = new Set(localPlanMilestones);
  const trackerMilestoneSet = new Set<string>();
  for (const m of trackerMilestones) {
    if (isMilestoneToken(m.name)) trackerMilestoneSet.add(m.name);
  }
  const shared = options.shared === true;
  const skippedMilestones: string[] = [];
  let claimed = new Set<string>();
  let gradedPlans = localPlanSet;
  if (shared) {
    const archivedPlans = readPlanMilestonesIn(join(specsDir, "plan", "archive"));
    gradedPlans = new Set([...localPlanMilestones, ...archivedPlans]);
    claimed = new Set([...gradedPlans, ...readLocalFRMilestones(specsDir)]);
  }
  for (const name of trackerMilestoneSet) {
    if (shared && !claimed.has(name)) {
      skippedMilestones.push(name);
      continue;
    }
    if (!gradedPlans.has(name)) {
      milestoneMismatches.push({
        kind: "milestone-mismatch",
        id: name,
        details: `Tracker milestone ${name} has no local plan file at ${specsDir}/plan/${name}.md.`,
        side: "tracker",
      });
    }
  }
  for (const name of localPlanSet) {
    if (!trackerMilestoneSet.has(name)) {
      milestoneMismatches.push({
        kind: "milestone-mismatch",
        id: name,
        details: `Local plan ${specsDir}/plan/${name}.md has no matching tracker milestone.`,
        side: "local",
      });
    }
  }

  if (shared) return { trackerOrphans, localOrphans, milestoneMismatches, skippedMilestones };
  return { trackerOrphans, localOrphans, milestoneMismatches };
}

/**
 * Walk `<specsDir>/frs/*.md` (excluding `archive/` — `readdirSync` is
 * non-recursive) and return one `LocalFRBinding` per file. Never throws on
 * missing directories or unreadable files; malformed frontmatter degrades
 * to "no tracker IDs" rather than failing the whole scan.
 *
 * Exported because the `tracker_local_reconciliation_drift` probe needs the
 * same FS-walk + frontmatter-parse pass to detect duplicate-binding
 * collisions (which `reconcileTrackerLocal` can't see by construction).
 *
 * STE-652: `{ includeArchive: true }` also walks `<specsDir>/frs/archive/*.md`,
 * returning those entries with `filename: "archive/<name>"`. The default
 * stays non-recursive, so existing callers see exactly what they saw before.
 */
export function readLocalFRBindings(
  specsDir: string,
  opts: { includeArchive?: boolean } = {},
): LocalFRBinding[] {
  const out = readFRBindingsIn(join(specsDir, "frs"), "");
  if (opts.includeArchive === true) {
    out.push(...readFRBindingsIn(join(specsDir, "frs", "archive"), "archive/"));
  }
  return out;
}

function readFRBindingsIn(frsDir: string, prefix: string): LocalFRBinding[] {
  return frFilesIn(frsDir).map(({ name, content }) => ({
    filename: `${prefix}${name}`,
    trackerIds: trackerIdsOf(content),
  }));
}

/**
 * The one FR-directory walk: every readable `*.md` file directly under `dir`
 * (non-recursive), with its contents. A missing or unreadable directory yields
 * nothing; an unreadable file is skipped.
 */
function frFilesIn(dir: string): { name: string; content: string }[] {
  if (!existsSync(dir)) return [];
  let entries: { name: string; isFile: () => boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; content: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      out.push({ name: entry.name, content: readFileSync(join(dir, entry.name), "utf-8") });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The tracker ids an FR file's `tracker:` frontmatter binds — the one reading
 * of a binding, shared by the working-tree walk above and by readers that
 * must parse a file's COMMITTED bytes instead (STE-606's ownership decision).
 */
export function trackerIdsOf(content: string): string[] {
  let fm: Record<string, unknown>;
  try {
    fm = parseFrontmatter(content, { lenient: true });
  } catch {
    fm = {};
  }
  const tracker = fm["tracker"];
  const trackerIds: string[] = [];
  if (tracker && typeof tracker === "object") {
    for (const value of Object.values(tracker as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        trackerIds.push(value);
      }
    }
  }
  return trackerIds;
}

/**
 * STE-652 — the `milestone:` frontmatter of every FR under `<specsDir>/frs/`
 * and `<specsDir>/frs/archive/`: the milestones this repository claims.
 */
function readLocalFRMilestones(specsDir: string): string[] {
  const out: string[] = [];
  for (const dir of [join(specsDir, "frs"), join(specsDir, "frs", "archive")]) {
    for (const { content } of frFilesIn(dir)) {
      let fm: Record<string, unknown>;
      try {
        fm = parseFrontmatter(content, { lenient: true });
      } catch {
        continue;
      }
      const m = fm["milestone"];
      if (typeof m === "string" && m.length > 0) out.push(m);
    }
  }
  return out;
}

/** The milestone of every `M*.md` plan file directly under `planDir`. */
function readPlanMilestonesIn(planDir: string): string[] {
  if (!existsSync(planDir)) return [];
  const out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    // A plan dir that is a file or unreadable reads as empty, like a missing
    // one: the reconcile never throws on its directories (plan/archive is now
    // read on the shared path).
    entries = readdirSync(planDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!PLAN_FILENAME_RE.test(entry.name)) continue;
    out.push(entry.name.replace(/\.md$/, ""));
  }
  return out;
}
