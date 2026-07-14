// Deterministic branch-type derivation (STE-381).
//
// Pure function, no I/O — replaces the LLM pass for `{type}` in the
// branch-proposal flow. Keyed on the FR's `changelog_category` frontmatter
// (STE-73 read-side default `Added`), with `--no-tech` as the
// highest-precedence override. Design notes: specs/frs/STE-381.md
// § Technical Design.
//
// Never throws: category shape is validated at authoring time (closed-set
// choice in the draft preview); defensive tolerance here keeps the branch
// gate non-blocking on legacy FRs with hand-edited frontmatter. The return
// set {feat, fix, chore} is a subset of STE-64 AC-13's clamp allow-list, so
// every output passes `buildBranchProposal`'s clamp verbatim.

/** Categories that derive `fix` (strict, case-sensitive membership). */
const FIX_CATEGORIES = new Set(["Fixed", "Security"]);

/** Input for `branchTypeFor`. Both fields optional — absent means default. */
export interface BranchTypeInput {
  /** FR frontmatter `changelog_category:` value; absent ⇒ STE-73 default `Added`. */
  changelogCategory?: "Added" | "Changed" | "Deprecated" | "Removed" | "Fixed" | "Security" | string;
  /** True when the FR was created via a `--no-tech` run (spec-only at creation). */
  noTech?: boolean;
}

/**
 * Derive the branch `{type}` with explicit three-branch precedence:
 *
 * 1. `noTech === true` ⇒ `chore` — a `--no-tech` FR is spec-only at
 *    creation regardless of category.
 * 2. `changelogCategory ∈ {Fixed, Security}` ⇒ `fix`.
 * 3. Everything else — `Added`, `Changed`, `Deprecated`, `Removed`,
 *    unknown strings, or absent — ⇒ `feat`.
 */
export function branchTypeFor(input: BranchTypeInput): "feat" | "fix" | "chore" {
  if (input.noTech === true) return "chore";
  if (input.changelogCategory !== undefined && FIX_CATEGORIES.has(input.changelogCategory)) {
    return "fix";
  }
  return "feat";
}
