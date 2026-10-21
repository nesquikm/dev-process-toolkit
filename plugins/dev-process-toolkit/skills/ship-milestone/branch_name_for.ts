// `/ship-milestone` `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// A versioned release proposes `release/v<X.Y.Z>`, with the `v` prefix
// normalized (a caller-supplied `v3.0.0` produces `release/v3.0.0`, not
// `release/vv3.0.0`). An unreleased run (`changelog_unversioned: true`) has
// no version and proposes `release/<milestone-lowercase>-unreleased`.
// Collision suffixing (`-2` for the rare double-ship) is the gate's
// responsibility.

export type ShipMilestoneBranchInput =
  | {
      /** Release version, e.g. `"2.11.0"` or `"v2.11.0"`. */
      version: string;
    }
  | {
      /** Milestone id, e.g. `"M12"` or `"M_7A948E"`. */
      milestone: string;
      unreleased: true;
    };

/**
 * Return the clean proposed branch name for a `/ship-milestone` release
 * commit.
 */
export function branchNameFor(input: ShipMilestoneBranchInput): string {
  if ("unreleased" in input) {
    return `release/${input.milestone.toLowerCase()}-unreleased`;
  }
  const normalized = input.version.replace(/^v/, "");
  return `release/v${normalized}`;
}
