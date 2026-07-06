// assert_milestone_binding_at_archive — STE-363 AC-STE-363.1 (M97).
//
// Archival-boundary milestone-binding assertion, called by /spec-archive
// (single-FR + milestone-group paths) and /implement Phase-4-close for each
// FR being archived in tracker mode with `project_milestone: true`. Fetches
// the FR's bound ticket and asserts its milestone binding is present via the
// adapter-aware surface, mirroring /gate-check probe #26
// (tracker_project_milestone_attached):
//
//   - `object` (Linear, default) ⇒ `projectMilestone.name` byte-equals the
//     canonical plan-heading name (planFileHeadingToMilestoneName).
//   - `label` (Jira) ⇒ `labels` contains `milestone-<M-token>`.
//
// On a miss the helper calls attachProjectMilestone ONCE (which carries the
// STE-362 transient retry and its own read-back verify) — a still-missing
// binding refuses with an NFR-10 canonical detail. Never throws on a
// refusal: callers branch on the returned outcome.
//
// Vacuous (no tracker call, no assertion) on:
//   - `mode: none`
//   - adapter `supports("project_milestone") === false`
//   - FR without a `tracker:` binding or `milestone:` frontmatter
//   - missing/unparsable `specs/plan/<milestone>.md` (probe #27 owns that
//     diagnostic)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachProjectMilestone,
  milestoneLabel,
  planFileHeadingToMilestoneName,
  type MilestoneOps,
} from "./attach_project_milestone";
import { parseFrFrontmatter } from "./tracker_project_milestone_attached";

export const MILESTONE_LABEL_ASSERTED_AT_ARCHIVE = "milestone_label_asserted_at_archive" as const;
export const MILESTONE_LABEL_ARCHIVE_REFUSED = "milestone_label_archive_refused" as const;

export type AssertMilestoneBindingAtArchiveResult =
  | { outcome: "vacuous"; token?: undefined; detail?: undefined }
  | { outcome: "asserted"; token: typeof MILESTONE_LABEL_ASSERTED_AT_ARCHIVE; detail: string }
  | { outcome: "refused"; token: typeof MILESTONE_LABEL_ARCHIVE_REFUSED; detail: string };

export interface AssertMilestoneBindingAtArchiveDeps {
  /** Repo root — locates `specs/plan/<milestone>.md`. */
  projectRoot: string;
  /** Task-tracking mode from CLAUDE.md (`none` ⇒ vacuous). */
  mode: string;
}

function asserted(
  ticketId: string,
  expected: string,
  binding: "object" | "label",
): AssertMilestoneBindingAtArchiveResult {
  const noun = binding === "label" ? "label" : "milestone";
  return {
    outcome: "asserted",
    token: MILESTONE_LABEL_ASSERTED_AT_ARCHIVE,
    detail: `${ticketId} carries ${noun} "${expected}" at the archival boundary`,
  };
}

function refused(
  ticketId: string,
  expected: string,
  binding: "object" | "label",
): AssertMilestoneBindingAtArchiveResult {
  const noun = binding === "label" ? "label" : "milestone";
  return {
    outcome: "refused",
    token: MILESTONE_LABEL_ARCHIVE_REFUSED,
    detail: [
      `${MILESTONE_LABEL_ARCHIVE_REFUSED}: ${ticketId} is missing ${noun} "${expected}" at the archival boundary — one attach attempt did not land.`,
      `Remedy: attach the milestone manually via the tracker's edit-issue call, or run /spec-archive --backfill-milestone-labels to backfill the binding, then re-run the archival.`,
      `Context: ticket=${ticketId}, expected="${expected}", binding=${binding}, helper=assertMilestoneBindingAtArchive`,
    ].join("\n"),
  };
}

export async function assertMilestoneBindingAtArchive(
  provider: MilestoneOps,
  project: string,
  frFile: string,
  deps: AssertMilestoneBindingAtArchiveDeps,
): Promise<AssertMilestoneBindingAtArchiveResult> {
  // Vacuity: mode none — no tracker at all.
  if (deps.mode === "none") return { outcome: "vacuous" };
  // Vacuity: adapter declares no project_milestone capability.
  if (provider.supports && !provider.supports("project_milestone")) {
    return { outcome: "vacuous" };
  }
  // Frontmatter walk is SHARED with probe #26 (parseFrFrontmatter) — the
  // archival assertion and the gate probe interpret `milestone:` +
  // `tracker:` identically by construction, not by mirroring.
  const fm = parseFrFrontmatter(readFileSync(frFile, "utf-8"));
  // Vacuity: FR is local-only (no tracker binding) or has no milestone.
  if (!fm.trackerId || !fm.milestone) return { outcome: "vacuous" };

  const planPath = join(deps.projectRoot, "specs", "plan", `${fm.milestone}.md`);
  let canonical: string;
  try {
    canonical = planFileHeadingToMilestoneName(planPath);
  } catch {
    // Missing or heading-less plan file — probe #27 owns that diagnostic.
    return { outcome: "vacuous" };
  }

  const binding: "object" | "label" = provider.milestoneBinding === "label" ? "label" : "object";
  const expected = binding === "label" ? milestoneLabel(canonical) : canonical;
  const ticketId = fm.trackerId;

  const issue = await provider.getIssue(ticketId);
  const present =
    binding === "label"
      ? (issue.labels ?? []).includes(expected)
      : (issue.projectMilestone?.name ?? null) === expected;
  if (present) return asserted(ticketId, expected, binding);

  // Miss ⇒ attach ONCE. attachProjectMilestone carries the STE-362 transient
  // retry and read-back-verifies the binding itself; a still-missing binding
  // surfaces as MilestoneAttachmentError, which we convert into a refusal
  // (never a throw at the archival boundary).
  try {
    await attachProjectMilestone(provider, project, canonical, ticketId);
  } catch {
    return refused(ticketId, expected, binding);
  }
  return asserted(ticketId, expected, binding);
}
