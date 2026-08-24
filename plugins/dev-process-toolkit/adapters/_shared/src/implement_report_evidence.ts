// implement_report_evidence — the SAME evidence rows the `deliver-stage-result`
// fence carries, rendered into `/implement`'s own step-14 report.
//
// THE DEFECT. The fence's machine-read counts only exist when a stage runs
// underneath the `/deliver` orchestrator. A standalone `/implement` run — every
// single-FR run, every `/implement M<N>` an operator types by hand — reported
// gate results in prose, with no skip count and no drive evidence at all. The
// guarantee was a property of ONE INVOCATION PATH rather than of the work.
//
// THE FIX, AND WHY IT IS A DELEGATION AND NOT A RENDERER. The tempting shape is
// a second formatter that agrees with the fence's today; every per-path test
// passes forever while the two drift, and the day they drift the two invocation
// paths disagree about whether the same work was green. So this module derives
// NOTHING: no count parsing, no baseline lookup, no row shape of its own. It
// calls `renderStageEvidence` by bare name and re-labels the result. There is
// exactly one place in the tree that builds a counts row, and it is not here.

import {
  renderStageEvidence,
  type EvidenceCounts,
  type EvidenceSection,
  type StageEvidenceInput,
} from "./deliver_stage_evidence";

/** The step-14 section heading these rows live under. */
export const IMPLEMENT_EVIDENCE_HEADING = "## Verification evidence";

export interface ImplementReportEvidence {
  /** DERIVED from `reasons` by the shared renderer, never asserted here. */
  readonly ok: boolean;
  /** The evidence rows — BYTE-IDENTICAL to the fence's, being the same bytes. */
  readonly rows: readonly string[];
  /** The whole step-14 section: the heading followed by exactly those rows. */
  readonly lines: readonly string[];
  readonly counts: Readonly<Record<EvidenceSection, EvidenceCounts | null>>;
  /** One line per refusal ground; empty iff `ok`. */
  readonly reasons: readonly string[];
}

/**
 * Render the step-14 evidence section from the captures behind it.
 *
 * ONE ARGUMENT, and captures are all of it: a second parameter carrying a
 * stage, a milestone or a fence would make the guarantee conditional on the
 * orchestrated path all over again, which is the defect this module closes.
 */
export function renderImplementReportEvidence(
  input: StageEvidenceInput,
): ImplementReportEvidence {
  const rendered = renderStageEvidence(input);
  return {
    ok: rendered.ok,
    rows: rendered.lines,
    lines: [IMPLEMENT_EVIDENCE_HEADING, ...rendered.lines],
    counts: rendered.counts,
    reasons: rendered.reasons,
  };
}
