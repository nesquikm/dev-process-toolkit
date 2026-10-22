// STE-694 (M_bae31f) — the AC-STE-694.2 typed-answer matrix, in ONE place.
//
// The pure predicate suite (tests/m_bae31f-ste-694-typed-adopt.test.ts), the
// hook suite (tests/hook-modules-pre-tracker-write-gate.test.ts, AC-STE-607.4)
// and the live grader suite (tests/m_2306b6-ste-617-live-grader.test.ts,
// AC-STE-650.8) all read these rows, so "the hook and the live grader give
// identical verdicts on the AC.2 matrix" (AC-STE-694.4) is measured against
// one list rather than three hand-copied ones.
//
// Each row is a function of the ticket key, because each suite has its own
// fixture key (NEX-496 in the FR, GF-122 in the hook world, the bundle's
// old-client key in the grader). The verdict is for a question that names the
// key and offers `Adopt <KEY>`.
//
// `battery` names the AC-STE-694.8 mutation the row is the named red for:
//   "key check"              — drop the whole-word key check
//   "affirmative first word" — drop the first-word check
//   "negation"               — drop the negation-word check

export interface TypedAdoptRow {
  /** The row's name with the key written `<KEY>`, used in test titles. */
  readonly name: string;
  /** The typed answer for `key`. */
  readonly answer: (key: string) => string;
  /** Whether the answer consents to `Adopt <KEY>`. */
  readonly consents: boolean;
  /** The AC-STE-694.8 mutation this row reddens, when it is a named battery row. */
  readonly battery?: "key check" | "affirmative first word" | "negation";
}

export const TYPED_ADOPT_MATRIX: readonly TypedAdoptRow[] = [
  { name: "adopt <KEY>", answer: (k) => `adopt ${k}`, consents: true },
  { name: "yes, post to <KEY>", answer: (k) => `yes, post to ${k}`, consents: true },
  { name: "Adopt <key in lower case>", answer: (k) => `Adopt ${k.toLowerCase()}`, consents: true },
  { name: "post it", answer: () => "post it", consents: false, battery: "key check" },
  { name: "Skip <KEY>", answer: (k) => `Skip ${k}`, consents: false },
  { name: "don't adopt <KEY>", answer: (k) => `don't adopt ${k}`, consents: false },
  { name: "adopt <KEY>0", answer: (k) => `adopt ${k}0`, consents: false, battery: "key check" },
  { name: "yes adopt <KEY> but not now", answer: (k) => `yes adopt ${k} but not now`, consents: false, battery: "negation" },
  { name: "<KEY>", answer: (k) => k, consents: false, battery: "affirmative first word" },
];
