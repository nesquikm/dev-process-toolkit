// M121 / STE-460 AC.10 — the blast-radius count, read TWICE from TWO PLACES.
//
// WHY TWO FUNCTIONS AND NOT ONE. The pin this module retires was
// `toContain("receives the seven surfaces above")` beside `toBe(7)`: two
// hardcoded constants restating one fact, stale four times over. The obvious
// repair — count the rows and format them into the expected sentence — would be
// WORSE than the constants, because a comparison whose two sides come from one
// expression is incapable of failing and looks identical in every passing run.
//
// So the two readers below are deliberately, structurally blind to each other:
//
//   `proseSurfaceCount` parses ONLY the sentence. It never locates the table,
//   never counts a row, and cannot observe a row being added or deleted.
//
//   `tableSurfaceRows` parses ONLY the table. It never locates the sentence,
//   never reads a number word, and cannot observe the sentence being reworded.
//
// That mutual blindness is not a comment — the AC.10 suite measures it, by
// mutating each side and asserting the other side's answer does not move. Keep
// it true: routing either function through the other's text, however
// conveniently, silently converts the guard back into an assertion that can
// never redden.

/** The table's header row — the table side's only anchor. */
const TABLE_HEADER = "| Shipped surface | Touched by | Nature of change |";

/**
 * The sentence side's only anchor. Deliberately spelled as a number WORD slot,
 * because the plan states the count in prose; a digit is accepted too so a
 * future rewording does not silently fall back to a stale reading.
 */
const PROSE_COUNT_RE = /receives the ([A-Za-z]+|\d+) surfaces above/g;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
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
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/**
 * The surface count AS THE PROSE SENTENCE STATES IT.
 *
 * Reads the number out of the plan's "receives the N surfaces above" sentence
 * and converts it. Blind to the table by construction.
 *
 * @throws if the sentence is absent, occurs more than once (the intended
 *   subject would not be determined), or states a count this cannot convert.
 *   Every failure throws rather than returning a sentinel: a reader that
 *   returned 0 on a miss would make the comparison pass or fail for reasons
 *   that have nothing to do with the plan.
 */
export function proseSurfaceCount(plan: string): number {
  const matches = [...plan.matchAll(PROSE_COUNT_RE)];
  if (matches.length === 0) {
    throw new Error(
      "proseSurfaceCount: the plan states no \"receives the N surfaces above\" count. " +
        "The sentence is the pin's subject; without it there is nothing to compare.",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `proseSurfaceCount: the count sentence occurs ${matches.length} times, so the ` +
        `intended subject is not determined. Narrow the wording in the plan.`,
    );
  }

  const raw = matches[0]![1]!;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

  const word = raw.toLowerCase();
  const value = NUMBER_WORDS[word];
  if (value === undefined) {
    throw new Error(
      `proseSurfaceCount: cannot convert the stated count ${JSON.stringify(raw)} to a ` +
        `number. Add the word to NUMBER_WORDS rather than loosening the regex.`,
    );
  }
  return value;
}

/**
 * The blast-radius table's SURFACE ROWS, as the table lists them.
 *
 * Returns the raw row strings (not a count) so callers can assert coverage of a
 * named surface as well as length. Blind to the prose sentence by construction.
 *
 * The row filter matches the shipped pin's: a surface row opens either with a
 * backticked path or with a bare `plugins` path. The header and the `|---|`
 * separator are excluded by that same filter.
 *
 * @throws if the table is absent or malformed — see `proseSurfaceCount` on why
 *   a miss is never a quiet empty list.
 */
export function tableSurfaceRows(plan: string): string[] {
  const start = plan.indexOf(TABLE_HEADER);
  if (start < 0) {
    throw new Error(
      `tableSurfaceRows: the plan carries no blast-radius table (looked for ` +
        `${JSON.stringify(TABLE_HEADER)}).`,
    );
  }
  const separator = plan.indexOf("\n|---|", start);
  if (separator < 0) {
    throw new Error(
      "tableSurfaceRows: the blast-radius table has no `|---|` separator row, so its " +
        "body cannot be delimited.",
    );
  }
  const blankLine = plan.indexOf("\n\n", separator);
  const end = blankLine < 0 ? plan.length : blankLine;

  return plan
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("| `") || line.startsWith("| plugins"));
}
