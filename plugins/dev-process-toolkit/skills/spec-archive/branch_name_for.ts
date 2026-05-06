// `/spec-archive` `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// `/spec-archive` has two run shapes:
//   - FR archive        → `chore/archive-<tracker-id>` (lowercased)
//   - milestone archive → `chore/archive-m<N>`
//
// Collision suffixing is the gate's responsibility (AC-STE-228.11).

export type SpecArchiveBranchInput =
  | { shape: "fr"; trackerId: string }
  | { shape: "milestone"; milestone: number | string };

/**
 * Return the clean proposed branch name for a `/spec-archive` run.
 *
 * - FR archive lowercases the tracker ID so `STE-227` and `Ste-227` both
 *   produce `chore/archive-ste-227`.
 * - Milestone archive accepts numeric or string milestone numbers and
 *   renders them verbatim with the `m` prefix.
 */
export function branchNameFor(input: SpecArchiveBranchInput): string {
  if (input.shape === "fr") {
    return `chore/archive-${input.trackerId.toLowerCase()}`;
  }
  return `chore/archive-m${input.milestone}`;
}
