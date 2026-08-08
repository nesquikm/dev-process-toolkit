// Shared shell-fence extraction for tests that EXECUTE a driver skill's
// snippets instead of grepping the prose around them.
//
// Why this module exists. `specs/notes/follow-ups.md` § 0c(c) records the
// extract-and-execute-a-fence pattern accumulating private copies — the entry
// says the threshold is "extract when a third wants it" and reports the trigger
// "firing at 4/3". The real count when STE-453 measured it was FIVE, across
// three mutually-disagreeing grammars:
//
//   driver-gate-fail-open-guards.test.ts, m117-ste-428-report-issue-renderable.test.ts,
//   m121-ste-447-legs-selector.test.ts, m121-ste-448-mode-none-leg.test.ts,
//   m121-ste-452-termination-harness.test.ts
//
// STE-453 needed a sixth. Adding one to a list already past its own threshold
// is how that entry stops meaning anything, so the STE-452 definitions were
// lifted here VERBATIM and that file now imports them. The remaining three
// inline copies are recorded, not silently tolerated — see § 0c(c).
//
// The two grammars are BOTH kept, deliberately, because they answer different
// questions and conflating them has already produced a guard that watched the
// wrong door (m121-ste-452-termination-harness.test.ts § "exactly ONE fence
// carries STATUS=green" documents that review finding).

/**
 * Every ```bash fence body in the document, in document order.
 *
 * Use this to FETCH a fence you intend to run: the driver's executable
 * snippets are bash-tagged, and running a ```text block would be a category
 * error.
 */
export function bashFences(body: string): string[] {
  return [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/**
 * Every column-0 fence body whatever its language tag.
 *
 * Use this to COUNT carriers of a marker that a derivation surface locates by
 * first match. Those surfaces scan the whole document, so a decoy in a plain or
 * ```text fence re-points them just as effectively as a bash one — and a
 * uniqueness guard written with `bashFences` would report all-clear while it
 * happened.
 */
export function anyFences(body: string): string[] {
  return [...body.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
}

/**
 * Locate a fence by a marker in its body.
 *
 * Markers are the STATUS the fence assigns or the variable it owns — never a
 * leg name. Slicing on a leg would reinstate exactly the technique STE-446
 * retired and would stop finding the fence the day a leg is renamed.
 */
export function fenceContaining(body: string, marker: string): string {
  return bashFences(body).find((f) => f.includes(marker)) ?? "";
}

/**
 * Apply a textual mutation to an extracted fence and THROW if it did not apply.
 *
 * `specs/notes/follow-ups.md` § 0b: a mutation that silently no-ops is
 * indistinguishable from a fix that does nothing, and the natural reading of
 * "both runs printed the same thing" is *my change made no difference* rather
 * than *my mutation missed*. Every witness routed through here turns a regex
 * that stopped matching into a loud error instead of a green test asserting
 * that a guard it never removed still works.
 */
export function mutate(fence: string, pattern: RegExp | string, replacement: string): string {
  const out = fence.replace(pattern as RegExp, replacement);
  if (out === fence) {
    throw new Error(
      `mutation did not apply: ${String(pattern)} matched nothing in the extracted fence`,
    );
  }
  return out;
}
