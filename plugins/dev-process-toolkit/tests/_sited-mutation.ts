// Sited mutation — apply a mutation INSIDE a named region, or refuse.
//
// WHY THIS MODULE EXISTS, and it is not tidiness.
//
// `doc.replace(find, repl)` takes the FIRST occurrence in the whole document.
// The guards this milestone ships deliberately share one house shape — the same
// anchors, the same disclaimer phrases, the same window arithmetic — so a
// first-occurrence anchor is a trap by construction rather than by accident.
// Three mutations in M121 landed on the wrong copy and reported GREEN
// (follow-ups.md § 0k(m)): the mutation applied, the document changed, the
// assertion under test never saw it, and the run recorded "the pin holds".
//
// A mutation that silently misses is strictly worse than no mutation at all: it
// manufactures evidence of falsifiability for an assertion that was never
// exercised. So this helper does three things a bare `replace` does not:
//
//   1. It SLICES THE REGION FIRST and searches only inside it, so an occurrence
//      elsewhere in the document cannot be selected.
//   2. It ABORTS — loudly, with the region's bounds in the message — when the
//      anchor is absent from THAT REGION, or occurs more than once inside it.
//      Both are states in which the caller's intended site is not determined,
//      and guessing one is how a false GREEN is produced.
//   3. It ASSERTS THE BYTES LANDED at the computed offset before returning, so
//      "the mutation applied" is measured rather than assumed.
//
// Every failure throws. A helper that returned the unmutated document on a miss
// would reproduce the defect it exists to retire.

export interface SitedMutationOptions {
  /** Names the region in error messages, e.g. "the AC-STE-448.9 wide window". */
  readonly label?: string;
}

/**
 * Replace `find` with `repl`, selecting the occurrence inside `[from, to)`.
 *
 * @param doc  the whole document; the returned string is the whole document too
 * @param from region start, an absolute offset into `doc`
 * @param to   region end, exclusive
 * @param find the anchor, which must occur EXACTLY ONCE within `[from, to)`
 * @param repl the replacement bytes
 *
 * @throws if the bounds are not a well-formed region of `doc`
 * @throws if `find` is absent from the region, or occurs more than once in it
 * @throws if the replacement bytes are not present at the computed offset
 */
export function mutateInRegion(
  doc: string,
  from: number,
  to: number,
  find: string,
  repl: string,
  options: SitedMutationOptions = {},
): string {
  const where = options.label ? `${options.label} [${from}, ${to})` : `[${from}, ${to})`;

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    throw new Error(`mutateInRegion: ${where} is not a well-formed region`);
  }
  if (to > doc.length) {
    throw new Error(
      `mutateInRegion: ${where} runs past the end of the document (${doc.length})`,
    );
  }
  if (find === "") {
    throw new Error(`mutateInRegion: ${where} was given an empty anchor`);
  }

  const region = doc.slice(from, to);
  const occurrences = region.split(find).length - 1;
  if (occurrences === 0) {
    throw new Error(
      `mutateInRegion: the anchor ${JSON.stringify(find)} is ABSENT from ${where}. ` +
        `A whole-document replace would have mutated some other copy of it and ` +
        `reported success — follow-ups.md § 0k(m).`,
    );
  }
  if (occurrences > 1) {
    throw new Error(
      `mutateInRegion: the anchor ${JSON.stringify(find)} occurs ${occurrences} ` +
        `times inside ${where}, so the intended site is not determined. Narrow the ` +
        `region or lengthen the anchor.`,
    );
  }

  const at = from + region.indexOf(find);
  const out = doc.slice(0, at) + repl + doc.slice(at + find.length);

  // The bytes landed WHERE THEY WERE AIMED — measured, not assumed. Without
  // this the helper's whole promise rests on the arithmetic above being right.
  if (out.slice(at, at + repl.length) !== repl) {
    throw new Error(
      `mutateInRegion: the replacement did not land at offset ${at} within ${where}`,
    );
  }
  if (out.length !== doc.length - find.length + repl.length) {
    throw new Error(
      `mutateInRegion: the mutation changed the document length by an unexpected ` +
        `amount at offset ${at} within ${where}`,
    );
  }
  return out;
}
