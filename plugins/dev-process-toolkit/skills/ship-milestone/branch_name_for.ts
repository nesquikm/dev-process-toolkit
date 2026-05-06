// `/ship-milestone` `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// `/ship-milestone` has a single run shape — release. The branch name is
// `release/v<X.Y.Z>`, with the `v` prefix normalized (a caller-supplied
// `v3.0.0` produces `release/v3.0.0`, not `release/vv3.0.0`). Collision
// suffixing (`-2` for the rare double-ship) is the gate's responsibility.

export interface ShipMilestoneBranchInput {
  /** Release version, e.g. `"2.11.0"` or `"v2.11.0"`. */
  version: string;
}

/**
 * Return the clean proposed branch name for a `/ship-milestone` release
 * commit. Strips an optional leading `v` from the input version so the
 * output always carries exactly one `v` prefix.
 */
export function branchNameFor(input: ShipMilestoneBranchInput): string {
  const normalized = input.version.replace(/^v/, "");
  return `release/v${normalized}`;
}
