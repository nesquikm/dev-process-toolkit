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
 * WHY THIS LIST IS LOAD-BEARING, stated here because it is the only place it is
 * stated. The presence-claim tripwire below is a regex over unbounded English
 * and was never going to be exhaustive; these pins are what actually guards the
 * row. A row that grew a presence claim while keeping them contradicts itself on
 * its face, and one that drops them to make room turns every pin RED. The same
 * list is AC-STE-456.6's budget subject, so it is the thing the recorded
 * headroom is measured against as well as the drift guard.
 *
 * ORDER IS THE DOCUMENT'S, NOT THE LIST'S OWN HISTORY — reordered by STE-460
 * AC.9. Two comment blocks headed this array and both claimed document order,
 * while the array was in the order it had been APPENDED IN: STE-448's and
 * STE-451's phrases, then STE-456's two witness clauses. Measured against the
 * shipped document, those two youngest entries sit near the TOP of the window,
 * so the claim ran backwards over its last two elements. Reordered rather than
 * disclaimed, because document order is the property a reader needs: it makes
 * the trailing entry really the trailing one, which is the entry the recorded
 * headroom is measured against and the one every "the last pin" note beside
 * this module means. Provenance is annotated per entry instead of implied by
 * position.
 *
 * STE-456's witness clauses are here because AC-STE-456.4 makes the witness the
 * clause that stops this row's green from being producible by a claim that
 * never fired.
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
  "the release proof", // STE-448
  "The durable claim witness is REQUIRED here", // STE-456
  // STE-456, NARROWED BY STE-486 — and the narrowing is why the pin moved
  // rather than being deleted. STE-456's unqualified form (``claim-commit
  // none`, or no such line at all, is a **FAIL even with the lock absent**`)
  // false-REDDED a healthy run: the sampler fires once per poll call, so a
  // grandchild that claims and finishes inside one call records only pre-claim
  // state. § Sub-fixture 10a's carve-out already said so, and STE-486 makes
  // this row consult it. What the row must still state — and what this pin
  // guards — is that the failure SURVIVES the carve-out when nothing confirms
  // the claim. A row that dropped this clause would be back to an absence check
  // a never-fired claim satisfies, which is the whole subject of the window.
  "**with no claim commit in history it is a FAIL even with the lock absent**", // STE-456 / STE-486
  "STE-451", // STE-451
  "deliberately only HALF of the lock assertion", // STE-448
  "satisfied *vacuously* by a lock that was never created", // STE-448 — trailing pin
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
 * the REAL guard is the six disclaimer pins above, not this tripwire.
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

/** The historical `AC9_WINDOW`-character slice, unchanged. */
export function ac9Window(doc: string): string {
  assertAnchorUnique(doc);
  const start = doc.indexOf(AC9_ANCHOR);
  return doc.slice(start, start + AC9_WINDOW);
}

/**
 * The WHOLE row — anchor through the next `#### ` heading.
 *
 * STRICTLY LARGER than the `AC9_WINDOW` slice whenever the row exceeds it,
 * which it now does: STE-456's witness paragraph and supersession annotation
 * put the row at ~3.7k characters, so ~1.3k of it — including the annotation
 * — falls outside the historical slice. A ban that scanned only the window
 * would stop seeing the row's own tail, which is § 3.1's failure mode exactly:
 * the guard keeps passing and stops covering.
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

// ═══════════════════════════════ the budgets ═════════════════════════════════
//
// TWO GUARDED WINDOWS, ONE PREDICATE.
//
// The row is guarded at two scales. The wide window carries the disclaimer pins.
// A second, much tighter window carries the row's TITLE, and until STE-460 it
// was asserted and not budgeted at all — so prose growth past its headroom was
// silent by construction, which is the same hole the wide budget exists to close
// one scale up.
//
// WHAT CHANGED, AND WHY IT IS A CHANGE OF KIND RATHER THAN OF DEGREE. The wide
// budget previously asserted `headroom > 0`. Positivity is satisfied by a
// headroom of 1 exactly as well as by the true figure, so the number every
// editor reads — which lived in a COMMENT — could rot to nothing while the
// assertion beside it stayed green. The headroom is now RECORDED as data and
// compared as a NUMBER, and both windows are budgeted by this one mechanism.
//
// THE RECORDED FIGURES ARE BLIND TO THE DOCUMENT, deliberately. If they were
// re-derived from `doc` the comparison would hold for every possible input and
// could not fail — the circularity this milestone has shipped four times. They
// are constants, and the suite proves they are constants by mutating the
// document and asserting they do not move.

/**
 * The row's TITLE, which is also the tighter window's only pin.
 *
 * One definition, read by the shipped title assertion and by the budget below.
 * A pin list that is not the guard list is a budget for a different document —
 * the stems-versus-subjects error recorded above, which over-stated the wide
 * window's headroom by 33 characters.
 */
export const AC9_TITLE_PIN =
  "the release proof: the durable claim witness AND the absence.";

/**
 * The tighter window: the leading slice of the row inside which the title is
 * asserted. Sole definition site — consumers import it rather than restating
 * the digits, so the cap resolves from exactly one place.
 */
export const AC9_TITLE_WINDOW = 200;

/**
 * RECORDED headroom for the wide window. Measured by execution: the furthest
 * guarded pin ends at 2346.
 *
 * RE-MEASURED BY STE-486, in the same edit that moved the row — which is the
 * discipline this constant exists to force. The witness clause grew by exactly
 * 40 characters (the unqualified FAIL sentence became the narrowed one above),
 * so 2306 became 2346 and the headroom fell 94 → 54. STE-486's own executable
 * span is deliberately placed AFTER the row's supersession annotation, outside
 * this window, precisely so a paragraph of new prose did not spend a budget
 * that guards pins still doing their job.
 */
export const AC9_WINDOW_HEADROOM = 54;

/**
 * RECORDED headroom for the title window. Measured by execution: the 61-char
 * title sits at offset 15.
 */
export const AC9_TITLE_HEADROOM = 124;

export interface Ac9Pin {
  phrase: string;
  /** Offset within the window, or -1 when the window no longer holds it. */
  at: number;
  /** `at + phrase.length`, or -1. */
  endsAt: number;
}

export interface Ac9Budget {
  name: string;
  window: number;
  pins: Ac9Pin[];
  /** Phrases the window no longer holds, in pin order. */
  missing: string[];
  /** The furthest guarded end inside the window; 0 when nothing is left. */
  furthest: number;
  /** `window - furthest`, MEASURED from the document passed in. */
  headroom: number;
  /** The figure of record. A constant — never derived from the document. */
  recordedHeadroom: number;
}

function scanBudget(
  name: string,
  text: string,
  window: number,
  phrases: readonly string[],
  recordedHeadroom: number,
): Ac9Budget {
  // `text` is already sliced to `window`, so `indexOf` can only return matches
  // that lie WHOLLY inside it. A pin that overruns the cap is therefore not
  // "found late" — it is not found at all, and `furthest` DECREASES rather than
  // exceeding the cap. That is why an `endsAt > window` arm would be dead code,
  // and why the headroom equality, not a `<=` comparison, is what bites.
  const pins: Ac9Pin[] = phrases.map((phrase) => {
    const at = text.indexOf(phrase);
    return { phrase, at, endsAt: at === -1 ? -1 : at + phrase.length };
  });
  const found = pins.filter((p) => p.at !== -1);
  const furthest = found.length === 0 ? 0 : Math.max(...found.map((p) => p.endsAt));
  return {
    name,
    window,
    pins,
    missing: pins.filter((p) => p.at === -1).map((p) => p.phrase),
    furthest,
    headroom: window - furthest,
    recordedHeadroom,
  };
}

/** Both guarded windows, measured against `doc`. */
export function ac9Budgets(doc: string): Ac9Budget[] {
  const win = ac9Window(doc);
  return [
    scanBudget(
      "AC-STE-448.9 disclaimer window",
      win,
      AC9_WINDOW,
      AC9_DISCLAIMER_PINS,
      AC9_WINDOW_HEADROOM,
    ),
    scanBudget(
      "AC-STE-448.9 row title",
      win.slice(0, AC9_TITLE_WINDOW),
      AC9_TITLE_WINDOW,
      [AC9_TITLE_PIN],
      AC9_TITLE_HEADROOM,
    ),
  ];
}

export interface Ac9BudgetFailure {
  name: string;
  window: number;
  kind: "pin-missing" | "headroom-drift";
  detail: string;
}

/**
 * The whole budget as one predicate: `[]` iff every guarded window still holds
 * every pin AND its measured headroom equals the figure of record.
 *
 * The headroom arm and the pin-presence arm bite in DISJOINT regimes — at
 * exactly the headroom no pin has left, so only the equality fires; one
 * character further the trailing pin leaves entirely, `furthest` falls back to
 * an earlier pin and positivity would go green again. Either arm alone leaves a
 * band of growth that passes. Both together close it, which is why they are one
 * function rather than two assertions in two tests.
 */
export function ac9BudgetFailures(doc: string): Ac9BudgetFailure[] {
  const failures: Ac9BudgetFailure[] = [];
  for (const b of ac9Budgets(doc)) {
    if (b.missing.length > 0) {
      failures.push({
        name: b.name,
        window: b.window,
        kind: "pin-missing",
        detail: `the window no longer holds: ${b.missing.join(" | ")}`,
      });
    }
    if (b.headroom !== b.recordedHeadroom) {
      failures.push({
        name: b.name,
        window: b.window,
        kind: "headroom-drift",
        detail:
          `measured headroom ${b.headroom}, recorded ${b.recordedHeadroom}. ` +
          `Re-measure the window and update the recorded figure in the same edit ` +
          `— a recorded figure that drifts silently is the defect this budget retires.`,
      });
    }
  }
  return failures;
}
