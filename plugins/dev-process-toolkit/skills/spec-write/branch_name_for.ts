// `/spec-write` `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// `/spec-write` has two run shapes:
//   - new-FR run            → delegates to `buildBranchProposal` from the
//                             shared adapter (template rendering — no
//                             duplicated logic, per the FR's design note).
//   - cross-cutting-only    → returns the literal `docs/specs-cross-cutting`.
//
// Collision suffixing is the gate's responsibility (AC-STE-228.11).

import { buildBranchProposal } from "../../adapters/_shared/src/branch_proposal";

export type SpecWriteBranchInput =
  | { shape: "cross-cutting" }
  | {
      shape: "new-fr";
      template: string;
      type: string;
      slug: string;
      milestone?: string;
      trackerId?: string;
      shortUlid?: string;
    };

/**
 * Return the clean proposed branch name for a `/spec-write` run.
 *
 * Cross-cutting-only runs return a fixed literal — no FR identity exists
 * to template against. New-FR runs delegate to `buildBranchProposal`,
 * which owns sanitization, template substitution, and the 60-char clamp.
 */
export function branchNameFor(input: SpecWriteBranchInput): string {
  if (input.shape === "cross-cutting") {
    return "docs/specs-cross-cutting";
  }
  return buildBranchProposal({
    template: input.template,
    type: input.type,
    slug: input.slug,
    milestone: input.milestone,
    trackerId: input.trackerId,
    shortUlid: input.shortUlid,
  });
}
