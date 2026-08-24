// e2e_authoring — STE-512: the end-to-end authoring decision `/implement`
// Phase 4 owes when a project has declared how its end-to-end suite is
// invoked. (Sibling of `deliver_stage_evidence` (STE-510), whose renderer it
// delegates every count to, and of `verification_config` (STE-347), whose
// predicates it asks about the `none` sentinel.)
//
// THE DEFECT. Nothing in the loop ever ADDS an end-to-end test. `/tdd` writes
// tests per AC through a test-writer that is deliberately blind to the running
// system — correct for unit tests, exactly wrong for end-to-end ones — so the
// end-to-end suite drifts away from the product one change at a time while the
// evidence rows keep faithfully reporting green counts for a suite that stopped
// covering anything. The numbers get more trustworthy as what they measure gets
// less relevant.
//
// THE QUIET HALF. "No end-to-end test was needed" is right often enough to
// become reflexive, and a silent skip and a considered decision PRODUCE
// IDENTICAL TREES: no new file either way, no diff either way, nothing to grep
// for either way. So silence is not an answer here. A declared project whose
// change authored nothing and recorded nothing REFUSES, the recorded rationale
// reads back OUT (a decision you cannot retrieve is not recorded), a blank
// reason is a silent skip wearing a hat, and a none-needed record alongside a
// freshly authored test is a contradiction rather than a preference.
//
// TWO THINGS THIS MODULE DELIBERATELY DOES NOT DO.
//
//   1. It derives NO counts of its own. The rows and the numbers come from
//      `renderStageEvidence`, called by bare name so an override is genuinely
//      wired through — a second renderer that agrees today would only stop
//      agreeing on the day nobody is looking.
//   2. It never compares the four bytes of the `none` sentinel itself. `e2eCmd`
//      has THREE states — absent (null: answers nothing), the literal `none`
//      (an ANSWER: there is no end-to-end suite), and a real command — and a
//      hand-inlined equality against the sentinel, or a bare truthiness check,
//      folds two of them together. That is the documented defect `isRunCmdNone` /
//      `isRunCmdAnswered` were extracted to make impossible, so both questions
//      are asked THERE.
//
// An absent key is VACUOUS: byte-identical to today's behaviour, invariant
// under every sibling input, for projects that never opted in.

import {
  renderStageEvidence,
  type CapturedRun,
  type EvidenceCounts,
} from "./deliver_stage_evidence";
import { isRunCmdAnswered, isRunCmdNone } from "./verification_config";

/**
 * The four outcome tokens, one per path.
 *
 * NO DIGITS, deliberately: the capability-key registry probe's reverse
 * orphan-scan matches ``MUST emit `([a-z_]+)` ``, so an `e2e_…` spelling would
 * slip straight past it and the bidirectional const↔directive invariant would
 * go one-way for exactly these four keys — a coverage hole in a guard.
 */
export const E2E_CAPABILITY_TOKENS = {
  authored: "end_to_end_tests_authored",
  edited: "end_to_end_tests_edited",
  none_needed: "end_to_end_none_needed",
  suite_red: "end_to_end_suite_red",
} as const;

/**
 * The authoring DECISION, recorded independently of the emitted token.
 *
 * Kept separate on purpose: a red suite emits the suite-red token, and if the
 * decision lived only in the token then an unrelated failure would ERASE the
 * record that a none-needed call was consciously made.
 */
export type AuthoringDecision =
  | "authored"
  | "edited"
  | "none_needed"
  | "unrecorded"
  | "contradictory"
  | "not_applicable";

export interface E2eAuthoringInput {
  /** Straight off `readVerificationConfig`. Three states, never two. */
  readonly e2eCmd: string | null;
  /** End-to-end test files this change ADDED. */
  readonly addedTests?: readonly string[];
  /** End-to-end test files this change EDITED. */
  readonly editedTests?: readonly string[];
  /** The EXPLICIT none-needed record. Absent ⇒ silence, which is not a record. */
  readonly noneNeeded?: { readonly reason: string } | null;
  /** The captured end-to-end suite run — the bytes every count traces back to. */
  readonly run?: CapturedRun | null;
}

export interface E2eAuthoringOutcome {
  /** DERIVED from `reasons`, never asserted by a caller. */
  readonly ok: boolean;
  /** Did the project ANSWER "how is the end-to-end suite invoked?" */
  readonly declared: boolean;
  readonly authoring: AuthoringDecision;
  readonly suiteRed: boolean;
  /** Exactly one of the four tokens, or null when no token is owed. */
  readonly capabilityToken: string | null;
  /**
   * The recorded rationale, READ BACK OUT. Null when nothing was recorded.
   *
   * `authoring: "none_needed"` DOES NOT imply this is set. Two different
   * branches reach that decision: a change that recorded a reason (which lands
   * here), and the `none` ANSWER — a project with no end-to-end suite at all,
   * which has nothing to explain away and so records nothing. Render the
   * rationale from THIS field; deriving it from the decision prints `null` on
   * the second path.
   */
  readonly noneNeededReason: string | null;
  /** The evidence rows, from the ONE shared renderer. Empty when no suite exists. */
  readonly evidenceRows: readonly string[];
  readonly counts: EvidenceCounts | null;
  /** One line per refusal ground; empty iff `ok`. */
  readonly reasons: readonly string[];
}

/**
 * The shape an unopted-in project always gets. Built fresh per call from one
 * literal so every field — and the key ORDER a deep comparison sees — is
 * invariant under whatever else the caller passed.
 */
function vacuous(): E2eAuthoringOutcome {
  return {
    ok: true,
    declared: false,
    authoring: "not_applicable",
    suiteRed: false,
    capabilityToken: null,
    noneNeededReason: null,
    evidenceRows: [],
    counts: null,
    reasons: [],
  };
}

/** A recorded rationale, or null — blank text is silence wearing a hat. */
function recordedReason(input: E2eAuthoringInput): string | null {
  const reason = input.noneNeeded?.reason;
  if (typeof reason !== "string" || reason.trim() === "") return null;
  return reason;
}

/**
 * Resolve the end-to-end authoring decision for one change.
 *
 * Total, pure, and fail-closed: a declared project reaches `ok: true` only when
 * the suite really ran, its bytes really parsed, no count indicates failure,
 * and the change either touched an end-to-end test or recorded — retrievably —
 * why none was needed.
 */
export function resolveE2eAuthoring(input: E2eAuthoringInput): E2eAuthoringOutcome {
  const { e2eCmd } = input;

  // Absent, bare, or whitespace-only: no answer was given, so nothing is owed.
  if (!isRunCmdAnswered(e2eCmd)) return vacuous();

  // The `none` ANSWER: there is no end-to-end suite, so there is no suite to
  // run and no counts to render. An `(none found)` row here would imply a
  // capture went missing.
  //
  // This is the ONE path reaching `none_needed` with a null reason — see the
  // field doc above. It is not the quiet half: the record is the DECLARATION
  // itself, which is why `declared` is true here and false in `vacuous()`.
  // Silence still refuses, further down.
  if (isRunCmdNone(e2eCmd)) {
    return {
      ok: true,
      declared: true,
      authoring: "none_needed",
      suiteRed: false,
      capabilityToken: E2E_CAPABILITY_TOKENS.none_needed,
      noneNeededReason: null,
      evidenceRows: [],
      counts: null,
      reasons: [],
    };
  }

  const added = (input.addedTests ?? []).length > 0;
  const edited = (input.editedTests ?? []).length > 0;
  const noneNeededReason = recordedReason(input);

  const reasons: string[] = [];
  let authoring: AuthoringDecision;

  if ((added || edited) && noneNeededReason !== null) {
    authoring = "contradictory";
    reasons.push(
      "`e2e_cmd` is declared and this change BOTH touched an end-to-end test " +
        "and recorded a none-needed decision — the two contradict each other; " +
        "keep the authored/edited test, or drop the none-needed record",
    );
  } else if (added) {
    authoring = "authored";
  } else if (edited) {
    authoring = "edited";
  } else if (noneNeededReason !== null) {
    authoring = "none_needed";
  } else {
    authoring = "unrecorded";
    // Both remedies, named. A bare "refused" teaches neither.
    reasons.push(
      "`e2e_cmd` is declared, so this change owes an end-to-end test it does " +
        "not have: add or edit an end-to-end test covering the change, or " +
        "record the none-needed decision with a reason saying why no " +
        "end-to-end coverage applies",
    );
  }

  // The rows and every number in them come from the ONE renderer, over the
  // bytes the runner really emitted.
  const evidence = renderStageEvidence({
    e2e: input.run ?? null,
    required: ["e2e"],
  });
  const counts = evidence.counts.e2e;
  const suiteRed = counts !== null && counts.fail > 0;
  reasons.push(...evidence.reasons);

  // Precedence, pinned rather than left to whichever branch runs first: a red
  // suite outranks every authoring token, on all three authoring paths.
  let capabilityToken: string | null = null;
  if (suiteRed) capabilityToken = E2E_CAPABILITY_TOKENS.suite_red;
  else if (authoring === "authored") capabilityToken = E2E_CAPABILITY_TOKENS.authored;
  else if (authoring === "edited") capabilityToken = E2E_CAPABILITY_TOKENS.edited;
  else if (authoring === "none_needed") capabilityToken = E2E_CAPABILITY_TOKENS.none_needed;

  return {
    ok: reasons.length === 0,
    declared: true,
    authoring,
    suiteRed,
    capabilityToken,
    noneNeededReason,
    evidenceRows: evidence.lines,
    counts,
    reasons,
  };
}
