// shared_carve_out — STE-486's anti-drift mechanism: ONE authored source for
// fixture 10a's sampling-gap carve-out, cited by every other site rather than
// restated there.
//
// WHY. The defect this FR closes is not a wrong rule — it is TWO statements of
// one rule that drifted apart. § Sub-fixture 10a says an empty log with a
// confirmed claim commit is a finding to report; § Phase 4's AC-STE-448.9 row,
// as tightened by STE-456, called the same disk a FAIL. A repair that re-states
// the carve-out in prose at the Phase 4 row RE-CREATES that defect — later,
// quietly, and with the same excuse. So this module makes restatement a hard
// error and citation the only other legal shape:
//
//   - `carveOutDefinition` throws when the operative wording occurs more than
//     once, so a verbatim second copy fails loudly instead of becoming a silent
//     second authored source.
//   - `resolveCarveOutFor` refuses for any section that neither defines nor
//     cites, so "shared" cannot degrade into "globally readable".
//   - A citation whose definition has been deleted DANGLES and throws, so
//     deleting the source breaks both sites rather than leaving the citing one
//     holding a private copy.
//
// A THIRD STATEMENT EXISTS AND IS DELIBERATELY LEFT ALONE. § Sub-fixture 10c's
// rendering rule restates the carve-out in its own words for the GROUP'S
// RENDERING ("a blanket 'any sub-fixture failure' reading would make it
// invisible"). It is out of this FR's scope, and the definition anchor below is
// chosen so that paragraph cannot read as a second DEFINITION.

/**
 * The operative wording — the clause that IS the carve-out. Chosen because it
 * is the imperative half: any copy that reproduces the rule's force reproduces
 * these bytes, and 10c's rendering paragraph, which paraphrases rather than
 * restates, does not.
 */
export const CARVE_OUT_DEFINING_PHRASE = "do NOT fail the group on this alone";

/**
 * How another section names the carve-out instead of restating it. The section
 * that DEFINES the rule never carries this form, so a defining site and a
 * citing site are never confused for one another.
 */
export const CARVE_OUT_CITATION_PHRASE =
  "the `10a-sampling-gap` carve-out defined in § Sub-fixture 10a";

/** One site of the carve-out: the heading it lives under, and its bytes. */
export interface CarveOutSite {
  /** The full heading line of the enclosing section, `#` markers included. */
  readonly section: string;
  /** The carve-out bytes in force at that site. */
  readonly text: string;
}

const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;

interface HeadingRef {
  readonly index: number;
  readonly depth: number;
  readonly line: string;
}

/**
 * One scan of a body: every heading outside a fence, plus the byte offset of
 * every line so a heading index and a raw offset can be compared directly.
 *
 * Named rather than inlined as `ReturnType<typeof headings>` because three
 * helpers take it and the scan is the unit they share — a reader should not
 * have to resolve a type expression to learn what they agree on.
 */
interface HeadingIndex {
  readonly offsets: readonly number[];
  readonly refs: readonly HeadingRef[];
}

/**
 * Every heading in the body, IGNORING fenced blocks.
 *
 * Fence-awareness is load-bearing, not tidiness: 10a's sampler fence opens with
 * `# Group 10 sampler — run ONCE PER step-3 poll call…`, and a naive scan reads
 * that shell comment as a heading, truncating 10a three lines short of the very
 * rule this module resolves. A slicer that stops inside the block it was asked
 * to read reports the carve-out ABSENT and passes every "not restated"
 * assertion for the wrong reason.
 */
function headings(body: string): HeadingIndex {
  const lines = body.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }

  const refs: HeadingRef[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const hit = HEADING_RE.exec(line);
    if (hit) refs.push({ index: i, depth: (hit[1] as string).length, line });
  }
  return { offsets, refs };
}

/** The heading whose line contains `needle`. Zero or many matches throw. */
function findHeading(refs: readonly HeadingRef[], needle: string): HeadingRef {
  const hits = refs.filter((ref) => ref.line.includes(needle));
  if (hits.length === 0) {
    throw new Error(`carve-out: no heading contains "${needle}"`);
  }
  if (hits.length > 1) {
    throw new Error(`carve-out: ${hits.length} headings contain "${needle}" — ambiguous`);
  }
  return hits[0] as HeadingRef;
}

/** The body of `heading`, up to the next heading of the same or shallower depth. */
function sliceFrom(body: string, heading: HeadingRef, all: HeadingIndex): string {
  const next = all.refs.find((ref) => ref.index > heading.index && ref.depth <= heading.depth);
  const start = all.offsets[heading.index] as number;
  return next ? body.slice(start, all.offsets[next.index] as number) : body.slice(start);
}

/** The heading a byte offset falls under, or `null` above the first heading. */
function enclosing(all: HeadingIndex, offset: number): HeadingRef | null {
  let found: HeadingRef | null = null;
  for (const ref of all.refs) {
    if ((all.offsets[ref.index] as number) <= offset) found = ref;
    else break;
  }
  return found;
}

/** Every offset at which `needle` occurs in `body`. */
function offsetsOf(body: string, needle: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = body.indexOf(needle, from);
    if (at < 0) return out;
    out.push(at);
    from = at + needle.length;
  }
}

/**
 * The single defining site of the carve-out.
 *
 * MORE THAN ONE occurrence throws. That is the whole mechanism: the naive
 * repair — copy 10a's rule down to the Phase 4 row — produces exactly two, and
 * a second authored source is the defect, whatever it is labelled. Zero
 * occurrences throws too: a citation must never resolve against a remembered
 * form.
 */
export function carveOutDefinition(skillBody: string): CarveOutSite {
  const at = offsetsOf(skillBody, CARVE_OUT_DEFINING_PHRASE);
  if (at.length === 0) {
    throw new Error(
      `carve-out: no defining site — "${CARVE_OUT_DEFINING_PHRASE}" is absent`,
    );
  }
  if (at.length > 1) {
    throw new Error(
      `carve-out: ${at.length} defining sites — the rule is restated, not shared`,
    );
  }

  const offset = at[0] as number;
  const all = headings(skillBody);
  const heading = enclosing(all, offset);
  if (heading === null) {
    throw new Error("carve-out: the defining site is not inside any section");
  }

  // The carve-out's bytes are the block the phrase lives in: from the start of
  // its line to the end of it. The rule is one bullet, and taking the line
  // rather than a remembered span means an edit to the source is an edit to
  // what every citing site resolves.
  const lineStart = skillBody.lastIndexOf("\n", offset) + 1;
  const lineEndAt = skillBody.indexOf("\n", offset);
  const lineEnd = lineEndAt === -1 ? skillBody.length : lineEndAt;
  return { section: heading.line, text: skillBody.slice(lineStart, lineEnd) };
}

/**
 * Every section that CITES the carve-out instead of restating it, in document
 * order. The defining section is not among them — it defines.
 */
export function carveOutCitations(skillBody: string): readonly CarveOutSite[] {
  const all = headings(skillBody);
  const sites: CarveOutSite[] = [];
  for (const offset of offsetsOf(skillBody, CARVE_OUT_CITATION_PHRASE)) {
    const heading = enclosing(all, offset);
    if (heading === null) continue;
    if (sites.some((site) => site.section === heading.line)) continue;
    sites.push({ section: heading.line, text: CARVE_OUT_CITATION_PHRASE });
  }
  return sites;
}

/**
 * The carve-out bytes in force at the section whose heading contains
 * `section` — its own if it defines the rule, the definition's if it cites,
 * and a THROW if it does neither.
 *
 * Refusing the third case is what keeps "shared" from degrading into "globally
 * readable": § Sub-fixture 10b is the carve-out's own AUTHORITY and still never
 * states the rule, so it must not be handed the definition merely for asking.
 */
export function resolveCarveOutFor(skillBody: string, section: string): string {
  const all = headings(skillBody);
  const heading = findHeading(all.refs, section);
  const body = sliceFrom(skillBody, heading, all);

  const defines = body.includes(CARVE_OUT_DEFINING_PHRASE);
  const cites = body.includes(CARVE_OUT_CITATION_PHRASE);
  if (!defines && !cites) {
    throw new Error(
      `carve-out: § ${heading.line.trim()} neither defines nor cites the carve-out`,
    );
  }

  // BOTH legal shapes resolve through the DEFINITION rather than through the
  // local slice, and that one path is the mechanism:
  //   - a DEFINING section handed its own slice would be holding a private
  //     copy; going through `carveOutDefinition` means a duplicated rule throws
  //     here too, exactly as it does for every other caller.
  //   - a CITING section gets the throw from a DANGLING citation, so deleting
  //     the source breaks the citing site rather than leaving it holding
  //     nothing.
  return carveOutDefinition(skillBody).text;
}
