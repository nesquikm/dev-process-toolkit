// Derive, from an adopting stage's OWN SKILL.md text, what its closing report
// is instructed to contain.
//
// WHY THIS FILE EXISTS. `tests/m137-ste-533-report-conformance-matrix.test.ts`
// used to grade a HAND-WRITTEN literal table of eleven report plans. Measured:
// deleting a stage's bounding edit from its SKILL.md — replacing "at most the
// first 3 as `first 3 of <K>` rows" with "every finding as its own row", the
// exact revert of the fix — left the whole suite green, because the matrix
// never read the instruction it claimed to be grading. Six of the nine stages'
// bounding edits could be reverted with a clean gate. A guard that runs,
// returns cleanly and measures nothing is the class this milestone exists to
// stop shipping.
//
// So the row budget is READ OFF THE SKILL.md. The literal table survives only
// as a cross-check, and a disagreement between the two is a finding.
//
// WHAT IS DERIVED, AND WHAT IS NOT — stated here rather than discovered later,
// because an unbounded fallback is how the previous version went hollow.
//
//   DERIVED
//     · the prose lead-in cap, from the sentence that states it;
//     · every `summary:` row TEMPLATE the closing-report region declares;
//     · each template's ROW BUDGET, from one of exactly three dispositions the
//       region may state — an item bound (`at most the first <N>`), an explicit
//       aggregation (`the block carries **one** ... row`), or an explicit fixed
//       maximum (`**three files maximum**`, `in 2–3 sentences`);
//     · for a stage that rolls a fixed list of mandates into the fence, the
//       COUNT of those mandates, from the sentence that states it.
//
//   NOT DERIVED, and deliberately so
//     · the realistic MAGNITUDE of a stage's driving content (how many drift
//       findings a run finds, how many files a bootstrap writes). It is a
//       property of the run, not of the instruction, and it does not change the
//       line count of a BOUNDED report — the header row states it whatever it
//       is. Nothing here reads or needs it.
//     · prose CONTENT. Only its ceiling is instructed, and the ceiling is what
//       a report has to fit under, so the builder fills the derived cap exactly
//       and grades the worst case.
//
//   REFUSED
//     · a declared template with none of the three dispositions. That is the
//       reverted state, and it is reported as UNANALYSABLE so the stage fails
//       loudly rather than falling back to a literal.
//     · a stage whose region declares no template and states no fixed-size
//       justification either. "The parser found nothing" and "the instruction
//       bounds nothing" are the same bytes, so the benefit of the doubt goes to
//       the second reading.
//
// Read-only: takes SKILL.md text, returns a description. No disk writes, no
// git, no child processes.

/** How many `summary:` rows one declared group is instructed to own. */
export type Disposition =
  | { readonly kind: "bounded"; readonly n: number }
  | { readonly kind: "aggregated" }
  | { readonly kind: "fixed"; readonly n: number };

export interface DerivedGroup {
  /** The row template, verbatim from the SKILL.md. */
  readonly template: string;
  readonly disposition: Disposition;
  /** `summary:` rows this group owns: header + items, or the flat count. */
  readonly rows: number;
  /** The sentence the disposition was read off, so a reader can check it. */
  readonly quote: string;
}

export interface UnanalysableGroup {
  readonly template: string;
  readonly why: string;
  readonly quote: string;
}

export interface DerivedInstruction {
  readonly stage: string;
  /** The prose lead-in cap the SKILL.md states, or null when it states none. */
  readonly proseCap: number | null;
  readonly groups: readonly DerivedGroup[];
  /** Groups declared with no derivable row budget. Non-empty ⇒ fail loudly. */
  readonly unanalysable: readonly UnanalysableGroup[];
  /**
   * Fixed mandates the region says ride inside the fence as one row each
   * (`All eight ride INSIDE the fence as \`summary:\` rows`), or null.
   */
  readonly mandateCount: number | null;
  /** Total `summary:` rows the instruction adds up to. */
  readonly summaryRows: number;
  /** Paragraphs of the SKILL.md the derivation read. */
  readonly regionParagraphs: readonly string[];
}

// ---------------------------------------------------------------------------
// The region
// ---------------------------------------------------------------------------

/**
 * The instruction verbs that order closing-report content. A paragraph carrying
 * one of these is in scope; the rest of the SKILL.md is not.
 *
 * The list is the file header's own inventory of how the eleven phrase it —
 * "Present:" / "Summarize" / "report what happened, in this order" — plus the
 * status-block vocabulary the adoption added. Stated once, here.
 */
export const CLOSING_REPORT_MARKERS: readonly string[] = [
  "closing summary",
  "closing report",
  "status block",
  "stage-status-block",
  "`summary:` row",
  "inside the fence",
  "Summarize",
  "Present:",
  "report what happened",
];

/** Fenced blocks are examples, not instructions — and they break backtick pairing. */
const stripFences = (text: string): string =>
  text.replace(/^```[\s\S]*?^```/gm, "");

export function closingReportRegion(text: string): string[] {
  return stripFences(text)
    .split(/\n[ \t]*\n/)
    .filter((p) => CLOSING_REPORT_MARKERS.some((m) => p.includes(m)));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * A `summary:` row template: a backticked span that opens with a row label and
 * a colon, and is CALLED a row by the text right after it.
 *
 * The trailing-`row` lookahead is what keeps this off the hundreds of other
 * backticked spans in a SKILL.md — a commit subject, a config key, a shell
 * fragment. Without it the scan picks up `maxTurns: 8` and `archived_at: <ISO
 * now>`, measured.
 */
const TEMPLATE_CALLED_A_ROW =
  /`([A-Za-z][\w /()-]{2,40}:[^`\n]{1,150})`(?=[\s`\w:,—.-]{0,24}\brows?\b)/g;

/**
 * A template that carries its own `first N of M listed below` bound. Some
 * stages write the bound INTO the row rather than in the sentence around it,
 * and those rows are not always followed by the word "row".
 */
const TEMPLATE_SELF_BOUNDING =
  /`([A-Za-z][\w /()-]{2,40}:[^`\n]{1,150}first \d+ of \d+ listed below)`/g;

/**
 * A paragraph that claims, in its own words, that the rows it names are bounded
 * and ride inside the fence.
 *
 * MEASURED, and the reason this exists: reverting `/implement`'s bound left the
 * suite green. Its step 14 writes the bound INTO the row template and puts no
 * "row" after it, so the mutated template simply stopped matching and VANISHED
 * from the derivation instead of being refused — a dropped subject reads as a
 * pass, which is the same vacuity one layer down.
 */
const BOUND_CLAIM =
  /every per-item list is BOUNDED|\*\*BOUNDED, and inside the fence\.\*\*|inside the fence, bounded/i;

/**
 * Every row-shaped backticked span in a paragraph that CLAIMS its rows are
 * bounded. Inside such a paragraph the claim is the licence to scan without the
 * trailing-`row` anchor: each row it names must exhibit the bound it promises,
 * and one that does not is refused rather than dropped.
 */
const TEMPLATE_UNDER_A_BOUND_CLAIM =
  /`([A-Za-z][\w /()-]{2,40}: [^`\n]{1,150})`/g;

/** A row template states a count — a placeholder or a digit. `applies: false` does not. */
const statesACount = (template: string): boolean =>
  /<\w|\d/.test(template.slice(template.indexOf(": ")));

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** A digit or an English number word, or null when it is neither. */
export function parseCount(token: string | undefined): number | null {
  if (token === undefined) return null;
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

/** The sentence a match sits in — the quote a reader checks the derivation against. */
function sentenceAround(paragraph: string, index: number): string {
  const start = paragraph.lastIndexOf(". ", index);
  const end = paragraph.indexOf(". ", index);
  return paragraph
    .slice(start === -1 ? 0 : start + 2, end === -1 ? paragraph.length : end + 1)
    .trim();
}

// ---------------------------------------------------------------------------
// Dispositions
// ---------------------------------------------------------------------------

/** `the block carries **one** \`…\` \`summary:\` row` — an explicit roll-up. */
function isAggregated(paragraph: string, matchIndex: number): boolean {
  const before = paragraph
    .slice(Math.max(0, matchIndex - 45), matchIndex)
    .replace(/\*/g, "");
  return /\bone\b[\s\w]{0,12}$/.test(before);
}

/** `at most the first <N>` — an explicit item bound stated in the sentence. */
function statedItemBound(paragraph: string): number | null {
  const m = paragraph.match(/at most(?: the)? first (\w+)/i);
  return m === null ? null : parseCount(m[1]);
}

/** `**three files maximum**`, `in 2–3 sentences` — an explicit fixed maximum. */
function statedFixedMaximum(paragraph: string): { n: number; quote: string } | null {
  const max = paragraph.match(/\*\*(\w+)[\w -]*? maximum\*\*/);
  const maxN = parseCount(max?.[1]);
  if (max !== null && maxN !== null) {
    return { n: maxN, quote: sentenceAround(paragraph, max.index ?? 0) };
  }
  const sentences = paragraph.match(/in (\d+)[–-](\d+) sentences/);
  if (sentences !== null) {
    return {
      n: Number(sentences[2]),
      quote: sentenceAround(paragraph, sentences.index ?? 0),
    };
  }
  return null;
}

/** `All eight ride INSIDE the fence as \`summary:\` rows` — a fixed mandate list. */
function statedMandateCount(region: readonly string[]): number | null {
  for (const p of region) {
    const m = p.match(/\ball (\w+) ride INSIDE the fence as `summary:` rows/i);
    const n = parseCount(m?.[1]);
    if (n !== null) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

export function deriveReportInstruction(
  stage: string,
  skillText: string,
): DerivedInstruction {
  const region = closingReportRegion(skillText);
  const proseMatch = skillText.match(/at most (\d+) lines of prose lead-in/i);
  const proseCap = proseMatch === null ? null : Number(proseMatch[1]);

  const groups: DerivedGroup[] = [];
  const unanalysable: UnanalysableGroup[] = [];
  const seen = new Set<string>();

  for (const paragraph of region) {
    const scans = [TEMPLATE_CALLED_A_ROW, TEMPLATE_SELF_BOUNDING];
    if (BOUND_CLAIM.test(paragraph)) scans.push(TEMPLATE_UNDER_A_BOUND_CLAIM);
    const found: { template: string; index: number }[] = [];
    for (const re of scans) {
      for (const m of paragraph.matchAll(re)) {
        if (!statesACount(m[1]!)) continue;
        if (found.some((f) => f.template === m[1])) continue;
        found.push({ template: m[1]!, index: m.index ?? 0 });
      }
    }
    for (const { template, index } of found) {
      if (seen.has(template)) continue;
      seen.add(template);
      const quote = sentenceAround(paragraph, index);

      if (isAggregated(paragraph, index)) {
        groups.push({
          template,
          disposition: { kind: "aggregated" },
          rows: 1,
          quote,
        });
        continue;
      }
      const inline = parseCount(template.match(/first (\d+) of/)?.[1]);
      const stated = statedItemBound(paragraph);
      const bound = stated ?? inline;
      if (bound !== null) {
        groups.push({
          template,
          disposition: { kind: "bounded", n: bound },
          rows: 1 + bound,
          quote,
        });
        continue;
      }
      unanalysable.push({
        template,
        why:
          "the region declares this row but states no bound for it: no " +
          "`at most the first <N>`, no explicit `one`-row aggregation, no " +
          "fixed maximum. An unbounded per-item list is the reverted state.",
        quote,
      });
    }
  }

  // A stage whose region declares no row template at all is only admissible
  // when the region says, positively, that its report cannot grow with the
  // work. Silence is refused: "the parser found nothing" and "the instruction
  // bounds nothing" are indistinguishable, and the second is the costly one.
  if (groups.length === 0 && unanalysable.length === 0) {
    let fixed: { n: number; quote: string } | null = null;
    for (const paragraph of region) {
      fixed = statedFixedMaximum(paragraph);
      if (fixed !== null) break;
    }
    if (fixed === null) {
      unanalysable.push({
        template: "(no `summary:` row template declared)",
        why:
          "the closing-report region declares no row template and states no " +
          "fixed maximum either, so nothing in this stage's own text bounds " +
          "what its report may carry",
        quote: region[region.length - 1]?.slice(0, 180) ?? "(empty region)",
      });
    } else {
      groups.push({
        template: "(fixed-size content, no row template)",
        disposition: { kind: "fixed", n: fixed.n },
        rows: fixed.n,
        quote: fixed.quote,
      });
    }
  } else {
    // A stage that DOES declare templates may still carry a fixed-size list
    // beside them (a file list bounded by construction).
    for (const paragraph of region) {
      const fixed = statedFixedMaximum(paragraph);
      if (fixed === null) continue;
      const template = `(fixed maximum: ${fixed.n})`;
      if (seen.has(template)) continue;
      seen.add(template);
      groups.push({
        template,
        disposition: { kind: "fixed", n: fixed.n },
        rows: fixed.n,
        quote: fixed.quote,
      });
    }
  }

  const mandateCount = statedMandateCount(region);
  const templateRows = groups.reduce((sum, g) => sum + g.rows, 0);
  // The mandate list and the bounded groups overlap: a mandate that is itself a
  // bounded list contributes its header row from the mandate count and its item
  // rows from the group. So the item rows are ADDED to the mandate count rather
  // than the whole group.
  const summaryRows =
    mandateCount === null
      ? Math.max(1, templateRows)
      : mandateCount +
        groups.reduce(
          (sum, g) => sum + (g.disposition.kind === "bounded" ? g.disposition.n : 0),
          0,
        );

  return {
    stage,
    proseCap,
    groups,
    unanalysable,
    mandateCount,
    summaryRows,
    regionParagraphs: region,
  };
}

// ---------------------------------------------------------------------------
// THE MUTATION — the derivation's own falsifiability
// ---------------------------------------------------------------------------

/**
 * Revert a stage's bounding edit IN MEMORY: strip the `at most the first <N>`
 * clause and every `first <N> of` row shape, which is what the fix added and
 * what its revert removes.
 *
 * Returns null when nothing changed. A mutation that never applied reads as a
 * pass, so every caller asserts on the null.
 */
export function revertBoundingEdit(skillText: string): string | null {
  const mutated = skillText
    .replace(/at most(?: the)? first \w+/gi, "every one")
    .replace(/first \d+ of/g, "one row per");
  return mutated === skillText ? null : mutated;
}
