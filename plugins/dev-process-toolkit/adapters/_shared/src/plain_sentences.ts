// plain_sentences — the ONE sentence splitter behind the plain-sentence rule.
//
// STE-661 caps a sentence at `PLAIN_SENTENCE_WORD_CAP` words. Every grader of
// that cap (the FR Summary scanner, the stage-block lead-in rule) needs the
// same answer to the same question: where does a sentence end, and how many
// words does it hold? This module owns that answer so the graders cannot
// drift apart on it. It is pure — no I/O, nothing runs at import.
//
// The contract:
//
//   - A WORD is a whitespace-delimited token. Punctuation attached to a word
//     does not make it two words, and a token made of punctuation alone is
//     still a word.
//   - A sentence ENDS at a terminator (`SENTENCE_TERMINATORS`) that is
//     followed by whitespace or by the end of the text. The end of a line
//     counts as whitespace. A terminator followed by anything else does not
//     end a sentence, so `v2.46.0`, `e.g.x` and `and/or` stay inside one.
//     PINNED: only the token's LAST character is tested, so a terminator
//     wrapped in a closing quote or bracket (`"stop."`, `(see x.)`) does not
//     end a sentence — the terminator is followed by the closer, not by
//     whitespace. That is the AC's literal rule, kept rather than widened.
//   - A BLANK line (empty or whitespace-only) also ends a sentence, with or
//     without a terminator. The end of the input ends the last sentence, so
//     an unterminated run is still graded.
//   - A LIST-ITEM line (`- `, `* `, `+ `, `1. `, `1) `) STARTS a sentence:
//     a row is its own item, punctuated or not. Without this, an ordinary
//     bullet list of short unpunctuated rows pools into one long "sentence".
//     The marker itself is not a word, so a 20-word row sits at the cap.
//   - A sentence OVER the cap yields one row `{ line, words }`. `line` is
//     1-indexed into the input array and names the line holding the word that
//     first pushes the count past the cap — that is where a reader starts to
//     struggle, not where the sentence happens to stop. `words` is the whole
//     sentence's count. Rows come back in input order.
//
// The terminator set is a parameter, defaulting to the exported constant, so
// a caller can grade a mutated set without rewriting this file.

/** The most words a plain sentence may hold. */
export const PLAIN_SENTENCE_WORD_CAP = 20;

/** The characters that end a sentence when whitespace or end of text follows. */
export const SENTENCE_TERMINATORS: readonly string[] = [".", "!", "?", ";"];

/** A markdown list-item opener: a bullet or an ordinal, then whitespace. */
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** One sentence over the cap. */
export interface LongSentence {
  /** 1-indexed line of the word that crossed the cap. */
  line: number;
  /** Word count of the whole sentence. */
  words: number;
}

/** Every sentence in `lines` with more than `PLAIN_SENTENCE_WORD_CAP` words. */
export function longSentences(
  lines: readonly string[],
  terminators: readonly string[] = SENTENCE_TERMINATORS,
): LongSentence[] {
  const rows: LongSentence[] = [];
  let count = 0;
  let anchor = 0;

  const close = (): void => {
    if (count > PLAIN_SENTENCE_WORD_CAP) rows.push({ line: anchor, words: count });
    count = 0;
    anchor = 0;
  };

  lines.forEach((text, idx) => {
    if (text.trim() === "") {
      close();
      return;
    }
    const marker = LIST_ITEM_RE.exec(text);
    if (marker !== null) close();
    const body = marker === null ? text : text.slice(marker[0].length);
    for (const token of body.split(/\s+/)) {
      if (token === "") continue;
      count += 1;
      if (count === PLAIN_SENTENCE_WORD_CAP + 1) anchor = idx + 1;
      // A token ends at whitespace or end of line, so a terminator as its
      // LAST character is exactly "a terminator followed by whitespace".
      if (terminators.includes(token[token.length - 1]!)) close();
    }
  });
  close();
  return rows;
}
