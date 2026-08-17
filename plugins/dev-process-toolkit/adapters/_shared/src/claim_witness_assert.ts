// claim_witness_assert — STE-486. Decide "did the claim lock demonstrably
// exist?" from § Phase 2 step 3's `lock-samples` log PLUS the test project's
// own history, and expose the decision as a one-line verdict + exit code the
// § Phase 4 tracker-less row branches on.
//
// WHY THE ROW COULD NOT STAY PROSE. Fixture 10a and § Phase 4's AC-STE-448.9
// row state ONE rule and had drifted into two readings of it. The measured
// evidence is `/tmp/dpt-smoke-none-ste451-lock-samples.log` from the 2026-08-16
// tracker-less leg — 60 bytes, in full:
//
//     lock-absent fr_01M05MY4CE5DCWW8E26WJQMS6D
//     claim-commit none
//
// The sampler RAN (the log exists), fired once inside a single poll call, and
// recorded PRE-CLAIM state on both of its lines: `/implement` claimed 38 s
// later and finished inside that same call. The claim commit was in history and
// the lock had been correctly released — a perfectly healthy run. 10a's
// carve-out reports that as a `10a-sampling-gap` finding; the Phase 4 row, as
// tightened by STE-456, called it a FAIL. This module is the rule as executable
// code, so the two sites cannot disagree again.
//
// THE OUTCOME RULE THIS MODULE IMPLEMENTS — which is the PHASE 4 ROW's rule,
// INHERITING 10a's carve-out. It is deliberately NOT a restatement of 10a, and
// the difference is worth stating precisely, because an earlier draft of this
// comment claimed "it is 10a's" and then wrote a rule 10a does not state:
//
//   10a's PASS criterion is "at least one `lock-present` line" — a SAMPLED
//   observation of the lock while it existed. This row cannot make that
//   observation; it runs after the release. Its PASS criterion is "the log
//   names a real sha AND the lock is gone". The two rules therefore disagree
//   on one input by design: a log carrying `lock-absent` plus a real sha is a
//   `10a-sampling-gap` REPORT under 10a's rule and an outright PASS under this
//   one, because for THIS row the durable witness is the whole point.
//
//   What is inherited from 10a, verbatim and by citation rather than by copy,
//   is only the carve-out: a missing sha with the claim confirmed in history
//   REPORTS and does not FAIL. That is the single statement § Sub-fixture 10a
//   owns and § Tracker-less rows cites.
//
//   no log at all                                     ⇒ `10a-sampler-absent`, FAIL
//   log, no sha, NO confirming claim commit           ⇒ the claim never wrote, FAIL
//   log, no sha, claim commit confirmed in history    ⇒ sampling gap, REPORT not FAIL  (10a's carve-out)
//   log names a real sha                              ⇒ PASS
//
// …and orthogonal to all four: a lock that is still on disk is a FAIL whatever
// the log says. The release half of the row does not get carved out.
//
// A REPORT IS NOT A SILENT PASS. The sampling-gap outcome exits 0 but always
// renders its finding token on stdout, because the operator has to learn the
// sampler missed its window — that is a real driver finding, and swallowing it
// would trade a false RED for a false GREEN.
//
// Usage (the CLI shim at the bottom, mirroring capability_row_assert.ts):
//   bun claim_witness_assert.ts <log> <confirmed-sha> [lock-absent|lock-present]
// Exit codes: pass or sampling-gap ⇒ 0, fail ⇒ 1, usage error ⇒ 2.

/** The finding token 10a's carve-out names. Reported, never failed on alone. */
export const SAMPLING_GAP_FINDING = "10a-sampling-gap";

/** The fourth state: no log at all means the sampler never ran. Always FAIL. */
export const SAMPLER_ABSENT_FINDING = "10a-sampler-absent";

/** The three outcomes the rule distinguishes. Two of them exit 0. */
export type ClaimWitnessOutcome = "pass" | "sampling-gap" | "fail";

/** What one evaluation produced. */
export interface ClaimWitnessVerdict {
  readonly outcome: ClaimWitnessOutcome;
  /** The finding token to surface, or `null` when there is nothing to report. */
  readonly finding: string | null;
  /** The sha the verdict rests on — from the log, or from history. */
  readonly sha: string | null;
  /** Single line, always non-empty: the driver-facing verdict. */
  readonly line: string;
  /** 0 for `pass` and `sampling-gap`, 1 for `fail`. */
  readonly exitCode: number;
}

/** Inputs for one evaluation. `logText: null` means the log does not exist. */
export interface ClaimWitnessInput {
  readonly logText: string | null;
  readonly confirmedSha: string | null;
  readonly lockAbsent: boolean;
}

/**
 * A git object name: 7–40 lowercase hex characters.
 *
 * `none` is what the sampler writes when it found nothing, and it must read as
 * "no sha" rather than as a sha spelled `none` — that conflation is how a
 * missing observation turns into a confirmed one.
 */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/** Whether a candidate names a real object rather than a sentinel or noise. */
function isSha(value: string | null | undefined): boolean {
  return typeof value === "string" && SHA_RE.test(value.trim());
}

const CLAIM_LINE_RE = /^[ \t]*claim-commit[ \t]*(.*)$/;

/**
 * The first `claim-commit <sha>` line naming a real sha.
 *
 * `none`, an empty value, a malformed value, and no such line at all ALL read
 * as `null` — they are the same state, and a sha anywhere in the log is durable
 * evidence whichever sample recorded it, so later lines are still consulted
 * after an earlier `none`.
 */
export function readClaimCommitSha(logText: string): string | null {
  if (typeof logText !== "string") return null;
  for (const line of logText.split("\n")) {
    const hit = CLAIM_LINE_RE.exec(line);
    if (!hit) continue;
    const value = (hit[1] ?? "").trim();
    if (isSha(value)) return value;
  }
  return null;
}

function render(
  outcome: ClaimWitnessOutcome,
  finding: string | null,
  sha: string | null,
  lockAbsent: boolean,
  why: string,
): ClaimWitnessVerdict {
  const detail = [
    finding ? finding : null,
    `sha=${sha ?? "none"}`,
    `lock=${lockAbsent ? "absent" : "PRESENT"}`,
    `(${why})`,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
  return {
    outcome,
    finding,
    sha,
    line: `claim-witness: ${outcome} ${detail}`,
    exitCode: outcome === "fail" ? 1 : 0,
  };
}

/**
 * Apply the outcome rule to one log, one independent confirmation, and the
 * lock's end state.
 *
 * The carve-out NARROWS the failure; it never removes it. An unconfirmed
 * absence is still a FAIL, an empty confirmation string is not a confirmation
 * (`$(git log …)` yields `""` on a project with no such commit, and a
 * truthiness bug here would bless every failing run), and a lock that survived
 * fails whatever the log names.
 */
export function evaluateClaimWitness(input: ClaimWitnessInput): ClaimWitnessVerdict {
  const { logText, confirmedSha, lockAbsent } = input;

  if (logText === null || logText === undefined) {
    return render("fail", SAMPLER_ABSENT_FINDING, null, lockAbsent, "no sample log at all — the sampler never ran");
  }

  const sampled = readClaimCommitSha(logText);

  if (!lockAbsent) {
    return render(
      "fail",
      null,
      sampled,
      lockAbsent,
      "the lock survived — the release half of the row is not carved out",
    );
  }

  if (sampled !== null) {
    return render("pass", null, sampled, lockAbsent, "the log names the claim commit and the lock is gone");
  }

  const confirmed = isSha(confirmedSha) ? (confirmedSha as string).trim() : null;
  if (confirmed !== null) {
    return render(
      "sampling-gap",
      SAMPLING_GAP_FINDING,
      confirmed,
      lockAbsent,
      "the log names no sha but history confirms the claim commit — see § Sub-fixture 10a",
    );
  }

  return render("fail", null, null, lockAbsent, "no sha in the log and none in history — the claim never wrote");
}

if (import.meta.main) {
  const [logPath, confirmedSha, lockState] = process.argv.slice(2);
  if (!logPath || (lockState !== undefined && lockState !== "lock-absent" && lockState !== "lock-present")) {
    console.error(
      "usage: bun claim_witness_assert.ts <log> <confirmed-sha> [lock-absent|lock-present]",
    );
    process.exit(2);
  }
  const file = Bun.file(logPath);
  // A missing log is the FOURTH STATE, not a crash: it is `10a-sampler-absent`
  // and the rule already has an answer for it.
  const logText = (await file.exists()) ? await file.text() : null;
  const verdict = evaluateClaimWitness({
    logText,
    confirmedSha: confirmedSha ?? null,
    lockAbsent: lockState !== "lock-present",
  });
  console.log(verdict.line);
  process.exit(verdict.exitCode);
}
