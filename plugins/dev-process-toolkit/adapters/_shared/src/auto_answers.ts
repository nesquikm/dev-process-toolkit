// auto_answers — the sanctioned, byte-checkable answer source an autonomous
// driver supplies so a Socratic interview can complete under non-tty stdin.
//
// **Why this exists.** Under `claude -p` the `AskUserQuestion` tool is
// unregistered, so an interview step annotated `requires-input:` has no way
// to obtain an answer and correctly raises the canonical refusal. That
// refusal is right — but it left an autonomous smoke/conformance driver with
// no legitimate way to drive `/spec-write` at all, truncating the canonical
// chain at its second step. This module supplies the missing half: an
// explicit, operator-authored block of interview answers that a caller can
// feed into `requireOrRefuse`'s `preBakedValue` slot.
//
// **Why the marker is a hard precondition.** An answers block on its own is
// INERT. `extractAutoAnswers` first consults `checkMarkerRuntime` for the
// literal auto-approve marker in the SAME body, and returns
// `{ present: false, answers: {} }` when it is absent — regardless of how
// well-formed the block is. That fence is what keeps this module from
// reopening the hole the auto-mode protocol closed: harness
// `<system-reminder>` prose, "work without stopping" paraphrases, pre-baked
// `<command-args>` flag text, and `claude -p` non-interactive inference are
// NOT triggers. Only the literal marker unlocks the block, and the marker
// literal is never re-typed here — it lives in `check_marker_runtime.ts`
// alone, so there is exactly one byte-string to audit.
//
// **Why malformed blocks fail CLOSED.** A truncated prompt body could leave
// an unterminated `<dpt:answers>v1` with arbitrary trailing prose inside it,
// and a body could carry the delimiters out of order. Both yield
// `{ present: false, answers: {} }` rather than a best-effort parse: a
// partial answer set silently satisfying an interview is strictly worse than
// a refusal, because the refusal is visible and the partial answer is not.
//
// **Block grammar.** One `key: value` pair per line between the delimiters.
// The split is on the FIRST colon only — interview answers routinely carry
// embedded colons in their values. Keys and values are trimmed; blank lines,
// colon-less lines, and lines with an empty key are ignored rather than
// treated as errors, so an operator can lay the block out readably.
//
// Pure I/O: callers pass a materialized `promptBody` string. No env reads,
// no filesystem reads, no regex — the same discipline as the marker grep.

import { checkMarkerRuntime } from "./check_marker_runtime";

/** Opening delimiter of a sanctioned answers block. Byte-pinned. */
export const AUTO_ANSWERS_OPEN = "<dpt:answers>v1";

/** Closing delimiter of a sanctioned answers block. Byte-pinned. */
export const AUTO_ANSWERS_CLOSE = "</dpt:answers>";

export interface ExtractAutoAnswersResult {
  /**
   * `true` iff the auto-approve marker AND a well-formed answers block are
   * both present in the body. Any other combination is inert.
   */
  present: boolean;
  /**
   * Parsed `key -> value` pairs. Always `{}` when `present` is `false`, so
   * callers may branch on either field.
   */
  answers: Record<string, string>;
}

/** The single inert result, materialized fresh so callers cannot mutate it. */
function inert(): ExtractAutoAnswersResult {
  return { present: false, answers: {} };
}

/**
 * Parse the `key: value` lines of an already-delimited block body.
 * Built through a `Map` + `Object.fromEntries` so a key like `__proto__`
 * becomes an ordinary own property instead of touching the prototype.
 */
function parseAnswerLines(blockBody: string): Record<string, string> {
  const pairs = new Map<string, string>();
  for (const line of blockBody.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (key === "") continue;
    pairs.set(key, line.slice(colon + 1).trim());
  }
  return Object.fromEntries(pairs);
}

/**
 * Lift the sanctioned answers block out of `promptBody`.
 *
 * Hard precondition: the literal auto-approve marker must appear in the same
 * body (checked via {@link checkMarkerRuntime}). Malformed blocks — an open
 * delimiter with no matching close, or a close that precedes the open — fail
 * closed. See the module header for the full rationale.
 */
export function extractAutoAnswers(
  promptBody: string,
): ExtractAutoAnswersResult {
  if (!checkMarkerRuntime(promptBody).present) return inert();

  const openIdx = promptBody.indexOf(AUTO_ANSWERS_OPEN);
  if (openIdx === -1) return inert();

  const bodyStart = openIdx + AUTO_ANSWERS_OPEN.length;
  // Searching from `bodyStart` collapses both malformed shapes into one
  // miss: an unterminated block has no close at all, and a close that
  // precedes the open is not a close for THIS open.
  const closeIdx = promptBody.indexOf(AUTO_ANSWERS_CLOSE, bodyStart);
  if (closeIdx === -1) return inert();

  return {
    present: true,
    answers: parseAnswerLines(promptBody.slice(bodyStart, closeIdx)),
  };
}

/**
 * Resolve one interview answer from the sanctioned block, or `undefined`
 * when the body is unmarked, the block is absent or malformed, or the block
 * simply does not answer `key`.
 *
 * The return value is what callers hand to `requireOrRefuse`'s
 * `preBakedValue` slot: a hit reads `pre-baked`, and `undefined` lets the
 * normal refusal fire untouched.
 */
export function resolveInterviewAnswer(
  promptBody: string,
  key: string,
): unknown | undefined {
  const { present, answers } = extractAutoAnswers(promptBody);
  if (!present) return undefined;
  return Object.prototype.hasOwnProperty.call(answers, key)
    ? answers[key]
    : undefined;
}
