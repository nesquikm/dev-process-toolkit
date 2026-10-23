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
// fixture key (NEZ-496 in the FR, GK-122 in the hook world, the bundle's
// old-client key in the grader). The verdict is for a question that names the
// key and offers `Adopt <KEY>`.
//
// `battery` names the AC-STE-694.8 mutation the row is the named red for:
//   "key check"              — drop the whole-word key check
//   "affirmative first word" — drop the first-word check
//   "negation"               — drop the negation-word check
//   "never/n't"              — drop the never / n't-contraction check (AC.1 amended 2026-10-23)
//   "other key"              — drop the other-ticket-key check (AC.1 amended 2026-10-23)

export interface TypedAdoptRow {
  /** The row's name with the key written `<KEY>`, used in test titles. */
  readonly name: string;
  /** The typed answer for `key`. */
  readonly answer: (key: string) => string;
  /** Whether the answer consents to `Adopt <KEY>`. */
  readonly consents: boolean;
  /** The AC-STE-694.8 mutation this row reddens, when it is a named battery row. */
  readonly battery?: "key check" | "affirmative first word" | "negation" | "never/n't" | "other key";
}

/**
 * A ticket key other than `key`: the same project with the next number, so
 * `NEZ-1` gives `NEZ-2` (the AC-STE-694.2 row `adopt NEZ-1 and NEZ-2` on
 * `Adopt NEZ-1`) and every suite's own fixture key gets a distinct second key.
 */
export function otherKey(key: string): string {
  const m = /^(.*-)(\d+)$/.exec(key);
  if (!m) throw new Error(`otherKey: ${JSON.stringify(key)} is not a <PROJECT>-<N> ticket key`);
  return `${m[1]}${Number(m[2]) + 1}`;
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
  // AC-STE-694.2 rows added by the 2026-10-23 amendment of AC-STE-694.1.
  { name: "yes, never adopt <KEY>", answer: (k) => `yes, never adopt ${k}`, consents: false, battery: "never/n't" },
  { name: "go, I won't adopt <KEY>", answer: (k) => `go, I won't adopt ${k}`, consents: false, battery: "never/n't" },
  { name: "adopt <KEY> and <OTHER KEY>", answer: (k) => `adopt ${k} and ${otherKey(k)}`, consents: false, battery: "other key" },
  { name: "yes adopt <KEY> isn't it", answer: (k) => `yes adopt ${k} isn't it`, consents: false, battery: "never/n't" },
];
