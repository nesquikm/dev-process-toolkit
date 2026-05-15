// tdd_spec_review_orchestrator — STE-296 AC.10. Pure-function state
// machine step for the AUDIT stage of the TDD orchestrator. Decides
// exit-ok / retry-write-test-implement / halt based on the parsed
// `tdd-spec-review-result` block and the audit-round retry budget.
//
// AC.4 stub: minimal symbol surface so the doc-invariant AC.4 tests can
// load. The full implementation lands under AC.10's fork.

import type { TddSpecReviewBlock } from "./tdd_spec_review_result";
import type { RetryBudget } from "./tdd_retry_state";

export type SpecReviewDecisionTag =
  | "exit-ok"
  | "retry-write-test-implement"
  | "halt";

export type SpecReviewCapabilityKey =
  | "tdd_spec_audit_passed"
  | "tdd_spec_audit_missing_recovered"
  | "tdd_spec_audit_halted";

export interface SpecReviewDecision {
  decision: SpecReviewDecisionTag;
  /**
   * Final-state capability key for the closing summary. Present only on
   * terminal outcomes (`exit-ok` ⇒ `tdd_spec_audit_passed` /
   * `tdd_spec_audit_missing_recovered`; `halt` ⇒ `tdd_spec_audit_halted`).
   * Absent on the `retry-write-test-implement` branch — the audit is
   * still in flight, so `/implement`'s propagation must not log a
   * final-state token until the second audit settles.
   */
  capabilityKey?: SpecReviewCapabilityKey;
  missingAcs: string[];
}

export interface StepSpecReviewInput {
  block: TddSpecReviewBlock;
  retryBudget: RetryBudget;
  isRetry: boolean;
}

/**
 * Pure-function state machine step for the AUDIT stage. AC.10 fleshes
 * out the four canonical paths (a–d). This stub is only present to
 * satisfy the test file's import graph for AC.4 doc-invariant checks;
 * AC.10's implementation replaces the body.
 */
export function stepSpecReview(input: StepSpecReviewInput): SpecReviewDecision {
  const missing = input.block.missing_acs;
  if (missing.length === 0) {
    return {
      decision: "exit-ok",
      capabilityKey: input.isRetry
        ? "tdd_spec_audit_missing_recovered"
        : "tdd_spec_audit_passed",
      missingAcs: [],
    };
  }
  if (input.isRetry) {
    return {
      decision: "halt",
      capabilityKey: "tdd_spec_audit_halted",
      missingAcs: missing.slice(),
    };
  }
  return {
    decision: "retry-write-test-implement",
    missingAcs: missing.slice(),
  };
}
