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
  MilestoneAttachmentError,
  milestoneBindingPresent,
  milestoneLabel,
  planFileHeadingToMilestoneName,
  resolveMilestoneBinding,
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
  /** Injected wait for the attach's transient-retry backoff (tests). */
  sleep?: (ms: number) => Promise<void>;
}

function asserted(
  ticketId: string,
  expected: string,
  binding: "object" | "label" | "epic",
): AssertMilestoneBindingAtArchiveResult {
  const noun = binding === "label" ? "label" : binding === "epic" ? "parent-Epic binding for" : "milestone";
  return {
    outcome: "asserted",
    token: MILESTONE_LABEL_ASSERTED_AT_ARCHIVE,
    detail: `${ticketId} carries ${noun} "${expected}" at the archival boundary`,
  };
}

function refused(
  ticketId: string,
  expected: string,
  binding: "object" | "label" | "epic",
  cause?: string,
): AssertMilestoneBindingAtArchiveResult {
  const noun = binding === "label" ? "label" : binding === "epic" ? "parent-Epic binding for" : "milestone";
  const headline = cause
    ? `${MILESTONE_LABEL_ARCHIVE_REFUSED}: ${ticketId} could not be verified to carry ${noun} "${expected}" at the archival boundary — ${cause}.`
    : `${MILESTONE_LABEL_ARCHIVE_REFUSED}: ${ticketId} is missing ${noun} "${expected}" at the archival boundary — one attach attempt did not land.`;
  return {
    outcome: "refused",
    token: MILESTONE_LABEL_ARCHIVE_REFUSED,
    detail: [
      headline,
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

  const binding = resolveMilestoneBinding(provider);
  const expected = binding === "label" ? milestoneLabel(canonical) : canonical;
  const ticketId = fm.trackerId;

  // Present/missing classification is SHARED with the STE-364 backfill sweep
  // (milestoneBindingPresent) — the two M97 surfaces cannot drift. The fetch
  // is guarded: a thrown getIssue (network, auth, dead ticket) converts to a
  // refusal — the helper NEVER throws, so a milestone-group archival batch
  // skips only this FR and the others proceed.
  let issue: Awaited<ReturnType<MilestoneOps["getIssue"]>>;
  try {
    issue = await provider.getIssue(ticketId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return refused(ticketId, expected, binding, `ticket fetch failed (${msg})`);
  }
  if (milestoneBindingPresent(issue, canonical, binding)) {
    return asserted(ticketId, expected, binding);
  }

  // Miss ⇒ attach ONCE. attachProjectMilestone carries the STE-362 transient
  // retry and read-back-verifies the binding itself; a still-missing binding
  // surfaces as MilestoneAttachmentError, which we convert into a refusal
  // (never a throw at the archival boundary). A non-mismatch attach failure
  // (network exhaustion, auth) threads its message into the refusal detail so
  // the operator can tell a dead connection from a GB-11 silent drop.
  try {
    await attachProjectMilestone(provider, project, canonical, ticketId, {
      sleep: deps.sleep,
    });
  } catch (err) {
    if (err instanceof MilestoneAttachmentError) {
      return refused(ticketId, expected, binding);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return refused(ticketId, expected, binding, `attach attempt failed (${msg})`);
  }
  return asserted(ticketId, expected, binding);
}
