// `/setup` `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// `/setup` runs before any project context exists (no FR file, no tracker
// identity, no Schema L config to render against). The bootstrap commit
// always lands on the same literal branch name; the gate's collision
// probe (AC-STE-228.11) handles the unlikely case of a re-run by appending
// `-2`, `-3`, … suffixes.
//
// Per AC-STE-228.4: returns the **clean** name (no suffix). Suffixing is
// the gate's responsibility, not the builder's.

/**
 * Return the clean proposed branch name for the `/setup` bootstrap commit.
 *
 * The name is a fixed literal — `/setup` runs before any project context
 * exists, so there is nothing to template against. Collision suffixing is
 * handled downstream by `findFreeBranchName` in the gate module.
 */
export function branchNameFor(): string {
  return "chore/setup-bootstrap";
}
