// Shared guard definitions for the smoke driver's § Phase 4 tracker-less
// release-proof row (`AC-STE-448.9`).
//
// WHY THIS MODULE EXISTS — one definition, two consumers, no drift.
// `m121-ste-448-mode-none-leg.test.ts` owns the row's disclaimer pins and its
// presence-claim tripwire. `m121-ste-456-two-sided-lock-evidence.test.ts` adds
// AC-STE-456.6's window-budget assertion over the SAME pins and AC-STE-456.5's
// two-direction measurement of the SAME tripwire. Two private copies is the
// shape STE-451's correction #40 recorded: "the conditional ban and its own
// not-blind anchor held independent copies of the regex array — editing one
// leaves the other green, so the anchor stops protecting the ban exactly when
// it would matter."
//
// THE ANCHOR HAZARD, inherited and now asserted rather than hoped for.
// `follow-ups.md` § 0i: the row's guard slices the document at
// `indexOf("AC-STE-448.9")`, which is a PLAIN SUBSTRING. Any prose above
// § Phase 4 naming that token silently relocates the window onto the new first
// occurrence, and the suite stays green while the guard stops guarding.
// `assertAnchorUnique` converts that silent relocation into a red.

/** The row's slice anchor. Its uniqueness is the guard's whole foundation. */
export const AC9_ANCHOR = "AC-STE-448.9";

/**
 * The historical window size, kept at its shipped value.
 *
 * It is a BUDGET, not a boundary: AC-STE-456.6 asserts every disclaimer pin
 * still lands inside it, so prose growth that would push a pin out goes RED
 * instead of leaving a guard scanning text that no longer holds its subject.
 * The tripwire itself no longer depends on it — see `ac9Row`.
 */
export const AC9_WINDOW = 2400;

/**
 * Every phrase the row's disclaimer pins read, in document order.
 *
 * The first four are STE-448's and STE-451's and are unchanged. The fifth is
 * STE-456's witness requirement, added because AC-STE-456.4 makes it the
 * clause that stops this row's green from being producible by a claim that
 * never fired.
 */
/**
 * Every phrase the row's disclaimer pins read, in document order.
 *
 * THESE ARE THE FULL SUBJECTS, NOT STEMS — corrected after the audit, which is
 * the only reason the budget below means anything. The list first carried
 * `"deliberately only HALF"` and `"satisfied *vacuously*"`, which are strict
 * PREFIXES of what `m121-ste-448-mode-none-leg.test.ts` actually matches
 * (`/deliberately only HALF of the lock assertion/` and
 * `/satisfied \*vacuously\* by a lock that was never created/`). Measured: the
 * true furthest guarded end is 2306, not the 2273 the stems reported, so the
 * budget over-stated headroom by 33 characters and a growth of 95-127 would
 * have pushed a LIVE guard partly outside the window while `budgetViolations`
 * returned `[]`.
 *
 * That is the exact silent-green AC-STE-456.6 exists to forbid, produced by the
 * budget assertion itself — a pin list that is not the guard list is a budget
 * for a different document.
 */
export const AC9_DISCLAIMER_PINS: readonly string[] = [
  "the release proof",
  "STE-451",
  "deliberately only HALF of the lock assertion",
  "satisfied *vacuously* by a lock that was never created",
  "The durable claim witness is REQUIRED here",
  "`claim-commit none`, or no such line at all, is a **FAIL even with the lock absent**",
];

const VERB = [
  "assert", "asserts", "asserted", "asserting",
  "verify", "verifies", "verified", "verifying",
  "check", "checks", "checked", "checking",
  "confirm", "confirms", "confirmed", "confirming",
  "pin", "pins", "pinned", "pinning",
].join("|");

/**
 * A gap span that may not CONTAIN the token `commit`.
 *
 * This is the clause that permits a git-history witness. AC-STE-456.4 requires
 * the row to demand the durable claim COMMIT, and the natural English for that
 * — "confirm the claim commit that created the lock exists" — was banned by the
 * predecessor tripwire. Excluding `commit` from the spans permits the witness
 * while leaving every filesystem-presence phrasing banned.
 */
const gap = (n: number) => `(?:(?!commit)[^\\n]){0,${n}}`;

/**
 * The tripwire, narrowed by AC-STE-456.5 in two directions at once.
 *
 * WIDENED: the predecessor spelled five bare verb stems, so `\bassert\b` failed
 * on `asserts` and a witness written in ordinary third person walked straight
 * past it. Measured by the predecessor session on a labelled corpus: "Assert
 * the lock exists…" fired; "The run also asserts the lock exists…" was silent.
 * All four inflections of all five verbs are now spelled.
 *
 * NARROWED: `commit` is excluded from both gap spans, so the git-history
 * witness is permitted.
 *
 * NAMED RESIDUAL HOLE — stated here rather than smoothed over, because a hole
 * a reader can see is worth more than one they discover:
 *
 *   "verify that, before the archive commit, the lock file exists mid-run"
 *
 * goes SILENT. The `commit` exclusion cannot distinguish a sentence that names
 * the commit as its SUBJECT (legitimate, must be permitted) from one that names
 * it in a subordinate clause while making a filesystem-presence claim
 * (drift, should fire). Closing it needs a parser, not a regex, and a textual
 * ban over unbounded English was never going to be exhaustive — which is why
 * the REAL guard is the five disclaimer pins above, not this tripwire.
 * `m121-ste-456-two-sided-lock-evidence.test.ts` asserts the hole is exactly
 * where this comment says it is, so a future narrowing that closes it is
 * forced to update this note rather than leave it stale.
 */
export const PRESENCE_CLAIM_TRIPWIRE = new RegExp(
  `\\b(?:${VERB})\\b${gap(70)}\\block\\w*${gap(40)}\\b(?:exists?|existed|is present|was created)\\b`,
  "i",
);

/** The predecessor form, kept ONLY so the narrowing can be measured against it. */
export const PRESENCE_CLAIM_TRIPWIRE_PRE_456 =
  /\b(?:assert|verify|check|confirm|pin)\b[^\n]{0,70}\block\w*[^\n]{0,40}\b(?:exists?|existed|is present|was created)\b/i;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Throw unless the slice anchor occurs exactly once in the document.
 *
 * § 0i's remedy said "assert the slice contains the thing it guards". That is
 * necessary and not sufficient: it detects a relocation only once the window
 * has already moved far enough to lose the subject. Counting the anchor
 * detects the SECOND OCCURRENCE ITSELF, which is the event, and it does so
 * wherever in the document that occurrence lands.
 */
export function assertAnchorUnique(doc: string): void {
  const n = count(doc, AC9_ANCHOR);
  if (n !== 1) {
    throw new Error(
      `${AC9_ANCHOR} must occur exactly once in the smoke driver (found ${n}). ` +
        `A second occurrence relocates the row guard's indexOf window onto it ` +
        `and the whole suite stays green — follow-ups.md § 0i.`,
    );
  }
}

/** The historical 2400-character slice, unchanged. */
export function ac9Window(doc: string): string {
  assertAnchorUnique(doc);
  const start = doc.indexOf(AC9_ANCHOR);
  return doc.slice(start, start + AC9_WINDOW);
}

/**
 * The WHOLE row — anchor through the next `#### ` heading.
 *
 * STRICTLY LARGER than the 2400 window whenever the row exceeds it, which it
 * now does: STE-456's witness paragraph and supersession annotation put the
 * row at ~3.7k characters, so ~1.3k of it — including the annotation — falls
 * outside the historical slice. A ban that scanned only the window would stop
 * seeing the row's own tail, which is § 3.1's failure mode exactly: the guard
 * keeps passing and stops covering.
 *
 * The row-bounded ban is therefore additive, not a replacement. The shipped
 * window-scoped assertions are left byte-unchanged.
 */
export function ac9Row(doc: string): string {
  assertAnchorUnique(doc);
  const start = doc.indexOf(AC9_ANCHOR);
  const end = doc.indexOf("\n#### ", start);
  if (end <= start) {
    throw new Error("ac9Row: no `#### ` heading follows the AC-STE-448.9 row");
  }
  return doc.slice(start, end);
}
