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
// Mode-none: vacuous (all three lists empty) — `LocalProvider` has no tracker
// to reconcile against, so the helper short-circuits before touching the FS.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { isMilestoneToken, PLAN_FILENAME_RE } from "./milestone_token";
import type { Provider } from "./provider";

export type ReconcileItemKind = "tracker-orphan" | "local-orphan" | "milestone-mismatch";

export interface ReconcileItem {
  kind: ReconcileItemKind;
  id: string;
  details: string;
}

export interface ReconcileTrackerLocalResult {
  trackerOrphans: ReconcileItem[];
  localOrphans: ReconcileItem[];
  milestoneMismatches: ReconcileItem[];
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
): Promise<ReconcileTrackerLocalResult> {
  if (provider.mode === "none") {
    return { trackerOrphans: [], localOrphans: [], milestoneMismatches: [] };
  }

  const [trackerFRs, trackerMilestones] = await Promise.all([
    provider.listActiveFRs(),
    provider.listMilestones(),
  ]);

  const local = readLocalFRBindings(specsDir);
  const localPlanMilestones = readLocalPlanMilestones(specsDir);

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
    trackerOrphans.push({
      kind: "tracker-orphan",
      id: trackerId,
      details: `Tracker active FR ${trackerId} has no local file under ${specsDir}/frs/.`,
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
      });
      continue;
    }
    const anyMatch = fr.trackerIds.some((id) => trackerSet.has(id));
    if (!anyMatch) {
      localOrphans.push({
        kind: "local-orphan",
        id: fr.filename,
        details: `Local FR ${fr.filename} binds to tracker IDs [${fr.trackerIds.join(", ")}] but none are active on the tracker.`,
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
  for (const name of trackerMilestoneSet) {
    if (!localPlanSet.has(name)) {
      milestoneMismatches.push({
        kind: "milestone-mismatch",
        id: name,
        details: `Tracker milestone ${name} has no local plan file at ${specsDir}/plan/${name}.md.`,
      });
    }
  }
  for (const name of localPlanSet) {
    if (!trackerMilestoneSet.has(name)) {
      milestoneMismatches.push({
        kind: "milestone-mismatch",
        id: name,
        details: `Local plan ${specsDir}/plan/${name}.md has no matching tracker milestone.`,
      });
    }
  }

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
 */
export function readLocalFRBindings(specsDir: string): LocalFRBinding[] {
  const frsDir = join(specsDir, "frs");
  if (!existsSync(frsDir)) return [];
  const out: LocalFRBinding[] = [];
  let entries: { name: string; isFile: () => boolean }[];
  try {
    entries = readdirSync(frsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = join(frsDir, entry.name);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
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
    out.push({ filename: entry.name, trackerIds });
  }
  return out;
}

function readLocalPlanMilestones(specsDir: string): string[] {
  const planDir = join(specsDir, "plan");
  if (!existsSync(planDir)) return [];
  const out: string[] = [];
  const entries = readdirSync(planDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!PLAN_FILENAME_RE.test(entry.name)) continue;
    out.push(entry.name.replace(/\.md$/, ""));
  }
  return out;
}
