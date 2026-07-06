// backfill_milestone_labels — STE-364 (M97).
//
// One-shot milestone-binding backfill sweep behind
// `/spec-archive --backfill-milestone-labels`. Enumerates FR files under
// `<specsDir>/frs/*.md` AND `<specsDir>/frs/archive/*.md`, keeping only FRs
// that carry BOTH a `tracker:` binding and `milestone:` frontmatter
// (parseFrFrontmatter — shared with probe #26 and the archival-boundary
// assertion, so the three milestone-binding surfaces can never drift on
// frontmatter interpretation). The canonical milestone name resolves via
// planFileHeadingToMilestoneName against `<specsDir>/plan/<M>.md`, falling
// back to `<specsDir>/plan/archive/<M>.md`; an FR whose plan file is missing
// from both trees is skipped (probe #27 owns that diagnostic).
//
// The present/missing predicate is adapter-aware and SHARED with the
// archival assertion (milestoneBindingPresent — the two M97 surfaces cannot
// drift by construction): `object` (Linear, default) ⇒ `projectMilestone.name`
// byte-equals the canonical plan-heading name; `label` (Jira) ⇒ `labels`
// contains `milestone-<M-token>`. Missing bindings attach via
// attachProjectMilestone (which carries the transient retry + read-back
// verify).
//
// Dry-run by default: `apply` must be `true` for any write to fire; a dry
// run performs reads only (getIssue classification) and reports the intended
// attaches in `backfilled`. Best-effort per ticket: one failure is recorded
// in `failed` (NFR-10 shape, Remedy line) and the sweep continues. FR-backed
// only: the sweep never enumerates the tracker board — a ticket with no FR
// can never be fetched or touched.
//
// Vacuous (zero candidates, zero tracker calls) on:
//   - `mode: "none"`
//   - adapter `supports("project_milestone") === false`

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachProjectMilestone,
  milestoneBindingPresent,
  planFileHeadingToMilestoneName,
  resolveMilestoneBinding,
  type MilestoneOps,
} from "./attach_project_milestone";
import { parseFrFrontmatter } from "./tracker_project_milestone_attached";

export interface BackfillEntry {
  ticketId: string;
  /** Canonical plan-heading milestone name (em-dash form). */
  milestone: string;
}

export interface BackfillFailure extends BackfillEntry {
  /** The plan file the FR maps to (active or archived tree). */
  planFile: string;
  /** NFR-10 canonical detail (carries a Remedy line). */
  detail: string;
}

export interface BackfillMilestoneLabelsReport {
  /** Attached this run; in a dry-run, the INTENDED attaches (no write fires). */
  backfilled: BackfillEntry[];
  /** Binding already present — skipped, zero writes. */
  alreadyCorrect: BackfillEntry[];
  /** Attach did not land; recorded and the sweep continued. */
  failed: BackfillFailure[];
}

export interface BackfillMilestoneLabelsOptions {
  /** Task-tracking mode from CLAUDE.md (`"none"` ⇒ vacuous). */
  mode: string;
  /** Writes fire only when `true`; defaults to FALSE (dry-run by default). */
  apply?: boolean;
}

/** Sorted `.md` files directly under `dir` (no recursion; absent dir ⇒ []). */
function listFrFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => join(dir, e.name))
    .sort();
}

/** Resolve `milestone:` to its plan file + canonical name, active tree first. */
function resolvePlan(
  specsDir: string,
  milestone: string,
): { planFile: string; canonical: string } | null {
  for (const planFile of [
    join(specsDir, "plan", `${milestone}.md`),
    join(specsDir, "plan", "archive", `${milestone}.md`),
  ]) {
    try {
      return { planFile, canonical: planFileHeadingToMilestoneName(planFile) };
    } catch {
      // Missing or heading-less at this location — try the next tree.
    }
  }
  return null;
}

export async function backfillMilestoneLabels(
  provider: MilestoneOps,
  project: string,
  specsDir: string,
  opts: BackfillMilestoneLabelsOptions,
): Promise<BackfillMilestoneLabelsReport> {
  const report: BackfillMilestoneLabelsReport = {
    backfilled: [],
    alreadyCorrect: [],
    failed: [],
  };
  // Vacuity: no tracker at all, or the adapter lacks the capability.
  if (opts.mode === "none") return report;
  if (provider.supports && !provider.supports("project_milestone")) return report;

  const apply = opts.apply === true;
  const binding = resolveMilestoneBinding(provider);
  const frFiles = [
    ...listFrFiles(join(specsDir, "frs")),
    ...listFrFiles(join(specsDir, "frs", "archive")),
  ];

  for (const frFile of frFiles) {
    const fm = parseFrFrontmatter(readFileSync(frFile, "utf-8"));
    // FR-backed candidates only: both a tracker binding and a milestone.
    if (!fm.trackerId || !fm.milestone) continue;
    const plan = resolvePlan(specsDir, fm.milestone);
    if (!plan) continue;
    const { planFile, canonical } = plan;
    const ticketId = fm.trackerId;

    try {
      const issue = await provider.getIssue(ticketId);
      if (milestoneBindingPresent(issue, canonical, binding)) {
        report.alreadyCorrect.push({ ticketId, milestone: canonical });
        continue;
      }
      // Dry-run records the intended attach; --apply performs it (the helper
      // read-back-verifies, throwing MilestoneAttachmentError on a silent drop).
      if (apply) {
        await attachProjectMilestone(provider, project, canonical, ticketId);
      }
      report.backfilled.push({ ticketId, milestone: canonical });
    } catch (err) {
      // Best-effort per ticket: record and continue with the next FR.
      const raw = err instanceof Error ? err.message : String(err);
      const detail = /Remedy:/.test(raw)
        ? raw
        : [
            `backfill_milestone_labels: attach for ${ticketId} did not land — ${raw}`,
            "Remedy: attach the milestone manually via the tracker's edit-issue call, then re-run /spec-archive --backfill-milestone-labels.",
            `Context: ticket=${ticketId}, expected="${canonical}", binding=${binding}, helper=backfillMilestoneLabels`,
          ].join("\n");
      report.failed.push({ ticketId, milestone: canonical, planFile, detail });
    }
  }
  return report;
}
