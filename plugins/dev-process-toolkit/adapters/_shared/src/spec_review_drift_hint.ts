// spec_review_drift_hint — STE-172 AC-STE-172.2 / AC-STE-172.3 / AC-STE-172.4
// helper.
//
// `/spec-review` calls this to render the live-spec drift refresh hint at
// the end of a report. The threshold (`>= 2`) and the literal line shape
// are owned by this helper so the rule is testable across drift-count
// fixtures without invoking the LLM. SKILL.md prose binds to it; the
// doc-conformance test pins the contract; this helper makes the
// 0/1/4-drift integration coverage real (string-equality, not LLM
// behavior).
//
// Threshold rationale: `>= 2` (not `> 0`). `/implement` routinely produces
// single-line cosmetic drifts during normal /implement churn; surfacing a
// refresh hint on every single-drift audit would train operators to ignore
// it.

export const SPEC_REVIEW_DRIFT_HINT_THRESHOLD = 2;

export function formatDriftHint(driftCount: number): string | null {
  if (!Number.isInteger(driftCount) || driftCount < SPEC_REVIEW_DRIFT_HINT_THRESHOLD) {
    return null;
  }
  return `Live-spec refresh suggested — ${driftCount} drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.`;
}
