// capture_artifact_identity — decide whether a capture artifact found on disk
// really is the artifact a committed derived fixture was produced from.
//
// WHY THIS MODULE EXISTS. The capability-row fixture-equivalence block used to
// locate its subject by BASENAME ALONE, walking a directory list and taking the
// first path whose name matched. That basename is run-agnostic — every
// conformance run writes exactly the same path — so any later run's capture was
// accepted as the artifact the fixture was derived from, and the equivalence
// assertion then compared two unrelated runs. The visible face of that bug is a
// red gate; the dangerous face is a GREEN one, where a mismatched artifact whose
// scores happen to agree satisfies every assertion while establishing nothing.
//
// The identification therefore lives here, as a pure function over explicit
// inputs, rather than inside the test file: the test file's directory list and
// its lookups are evaluated at MODULE LOAD and so cannot be steered at runtime,
// which makes the decision unexercisable at unit granularity while it stays
// there.
//
// THE RULES. Three run-bound properties, and all three must hold before the
// comparison is allowed to run:
//
//  1. IDENTITY — the candidate's bytes must not equal the derived fixture's.
//     This is the canonical agreeing case (a file always scores identically to
//     itself), so it is refused on identity, never on score.
//  2. SIZE FLOOR — the candidate must clear {@link DERIVED_FIXTURE_BYTE_CEILING},
//     which is the very ceiling the committed fixtures are held under. A derived
//     fixture therefore can never clear it.
//  3. DECLARED RUN — the caller must declare which run the artifact came from,
//     and that declaration must match the run the fixture records in its name.
//
// ORDER MATTERS. The two INTRINSIC properties (1 and 2) are read off the
// artifact itself and are evaluated FIRST; the caller-supplied declaration is
// additive only. A caller can qualify an artifact the intrinsic checks admit,
// never widen what they admit.

/**
 * The byte ceiling every committed derived fixture is held under, and — by
 * deliberate reuse — the size FLOOR a candidate artifact must clear to be
 * considered a real capture. One constant, not two: a derived fixture can never
 * clear a floor equal to its own ceiling, and two independent literals could
 * drift apart where one cannot.
 */
export const DERIVED_FIXTURE_BYTE_CEILING = 32 * 1024;

/** Why a candidate was, or was not, accepted as the fixture's source artifact. */
export type CaptureQualificationReason =
  | "qualified"
  | "artifact-absent"
  | "identical-to-derived-fixture"
  | "below-size-floor"
  | "run-not-declared"
  | "declared-run-mismatch";

/**
 * The three states the guard must keep legible. Collapsing `not-qualifying`
 * into `absent` would return the block to a permanently quiet state that looks
 * like a clean checkout forever.
 */
export type CaptureQualificationState = "absent" | "not-qualifying" | "checked";

/** A capture artifact found on disk, read into memory. */
export interface CaptureCandidate {
  path: string;
  bytes: Buffer;
}

export interface CaptureQualificationInput {
  /** The artifact found at the searched path, or `null` when nothing is there. */
  candidate: CaptureCandidate | null;
  /** Bytes of the committed derived fixture the candidate would be compared to. */
  derivedBytes: Buffer;
  /** The run the caller declares the artifact came from. Absent by default. */
  declaredRun?: string | null;
  /** The run the derived fixture records in its own name. */
  expectedRun: string;
  // NO `sizeFloor` OVERRIDE, deliberately. An earlier draft exposed one and it
  // had zero production callers — but the real objection is not that it was
  // unused. A caller-supplied floor is a hole in the guarantee this module
  // exists to make: the floor is the derived-fixture ceiling BECAUSE a fixture
  // can then never clear it, and that argument collapses the moment a caller
  // may pass any number. One constant, no override, no way to widen it.
}

export interface CaptureQualification {
  qualified: boolean;
  state: CaptureQualificationState;
  reason: CaptureQualificationReason;
  /** The refused/accepted path, so a skip can name what it refused. */
  path: string | null;
  /** Human label carrying the machine-readable reason; empty when qualified. */
  skipLabel: string;
}

/** Byte-for-byte equality, tolerant of any `Uint8Array` view reaching us. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  // `Buffer.compare` takes Uint8Array directly. Wrapping each side in
  // `Buffer.from` first would deep-copy both — and candidates in this family
  // reach ~1.25 MB, so that is two full copies per identity check for nothing.
  return Buffer.compare(a, b) === 0;
}

/**
 * The human half of a refusal. Every label carries its machine-readable reason
 * verbatim, so a skipped test NAMES why it skipped without a lookup table, and
 * no two reasons can produce the same label.
 */
function skipLabelFor(reason: CaptureQualificationReason, detail: string): string {
  return ` [SKIPPED — ${reason}: ${detail}]`;
}

/**
 * Decide whether `input.candidate` may be compared against the derived fixture.
 *
 * Check order is identity -> floor -> declared run; see the ORDER MATTERS note
 * at the top of this file.
 */
export function qualifyCaptureArtifact(
  input: CaptureQualificationInput,
): CaptureQualification {
  const { candidate, derivedBytes, expectedRun } = input;
  const floor = DERIVED_FIXTURE_BYTE_CEILING;

  if (candidate === null || candidate === undefined) {
    return {
      qualified: false,
      state: "absent",
      reason: "artifact-absent",
      path: null,
      skipLabel: skipLabelFor(
        "artifact-absent",
        "no capture artifact at the searched paths",
      ),
    };
  }

  const refuse = (
    reason: CaptureQualificationReason,
    detail: string,
  ): CaptureQualification => ({
    qualified: false,
    state: "not-qualifying",
    reason,
    path: candidate.path,
    skipLabel: skipLabelFor(reason, detail),
  });

  // 1 — INTRINSIC. A file always scores identically to itself, so the agreeing
  // verdict such a candidate would produce establishes nothing. Refused here,
  // ahead of the floor, so the canonical case keeps its own reason.
  if (sameBytes(candidate.bytes, derivedBytes)) {
    return refuse(
      "identical-to-derived-fixture",
      "candidate bytes are the committed fixture's own",
    );
  }

  // 2 — INTRINSIC. The floor is the fixture ceiling: nothing small enough to be
  // a committed reproducer can be the full capture it was reduced from.
  if (candidate.bytes.length < floor) {
    return refuse(
      "below-size-floor",
      `${candidate.bytes.length} B is under the ${floor} B floor`,
    );
  }

  // 3 — ADDITIVE, and only now. Presence alone never suffices.
  const declared = (input.declaredRun ?? "").trim();
  if (declared.length === 0) {
    return refuse(
      "run-not-declared",
      "set DPT_CAPTURE_RUN to the run that wrote this artifact",
    );
  }
  if (declared !== expectedRun.trim()) {
    return refuse(
      "declared-run-mismatch",
      `declared ${declared}, but the fixture records ${expectedRun}`,
    );
  }

  return {
    qualified: true,
    state: "checked",
    reason: "qualified",
    path: candidate.path,
    skipLabel: "",
  };
}

/**
 * Select the one entry whose capture basename matches, refusing ambiguity.
 *
 * Extracted here rather than left as a closure over a table constant so that
 * BOTH of its guarantees can be exercised: a positional lookup (`table[0]`) is
 * correct until someone reorders the table and then silently re-points at a
 * different subject, which is this module's own subject matter one level down.
 * Zero or several matches THROW — a wrong-subject test that keeps passing is
 * the failure being prevented, so failing loudly is the whole point.
 */
export function selectUniqueByCapture<T extends { capture: string }>(
  entries: readonly T[],
  capture: string,
): T {
  const matches = entries.filter((row) => row.capture === capture);
  if (matches.length !== 1) {
    throw new Error(
      `STE-458: expected exactly one entry for capture ${capture}, found ${matches.length}`,
    );
  }
  return matches[0]!;
}

/**
 * The run a derived fixture records in its own filename (`…-2026-07-27.log`),
 * or `null` when the name records no run — which is exactly the case for the
 * run-agnostic capture basenames the old search keyed on.
 */
export function runRecordedByFixture(fixtureFile: string): string | null {
  const basename = fixtureFile.split(/[\\/]/).pop() ?? "";
  const match = basename.match(/(?:^|[^0-9])(\d{4}-\d{2}-\d{2})(?:[^0-9]|$)/);
  return match?.[1] ?? null;
}
