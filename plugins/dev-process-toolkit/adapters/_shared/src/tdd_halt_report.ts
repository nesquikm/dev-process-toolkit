// tdd_halt_report — STE-225 AC.5 / AC.8(d). Deterministic formatter for
// the halt-path report. Renders failure mode, retry count, and the last
// `tdd-result` block (or raw subagent output if none) so the operator
// can resume manually. The orchestrator emits this body, then exits
// non-zero — exit-code handling is orchestrator-level prose, not the
// formatter's concern.

import type { TddRole } from "./tdd_result";
import type { FailureMode } from "./tdd_retry_state";

export interface HaltReport {
  mode: FailureMode;
  role: TddRole;
  /** The FR the run was for — lets the resume command be copied as it stands. */
  fr?: string;
  /**
   * Which skill started the run. A run `/implement` started resumes through
   * `/implement`, so its gate, review, commit and tracker close still run.
   * Absent means `/tdd` was invoked directly.
   */
  entry?: "tdd" | "implement";
  ac?: string;
  /**
   * True when an implementer halted in the AUDIT stage's retry round. Every
   * AC is GREEN by then, so the resume point is `audit`, never the AC — an
   * AC resume would re-dispatch implementers for the GREEN ACs after it.
   */
  auditRound?: boolean;
  retryCount: number;
  lastBlock?: string;
  rawOutput?: string;
  /**
   * STE-296 AC.7 — unresolved missing ACs from the second audit. Set when
   * `mode === "spec-gap"`. Each entry is rendered in the report body so
   * the operator can see which ACs the spec-reviewer flagged as still
   * unimplemented after the bounded audit-round retry.
   */
  missingAcs?: string[];
}

const MODE_DESCRIPTIONS: Record<FailureMode, string> = {
  A: "false-RED — test-writer's tests did not fail when run",
  B: "implementer could not reach GREEN",
  C: "refactorer broke GREEN",
  D: "format violation — invalid or missing tdd-result block",
  E: "maxTurns exhaustion — subagent stopped without producing a block",
  "spec-gap":
    "spec-review audit still reports missing ACs after the bounded retry",
  "not-load-bearing":
    "defect check — the AC's test stayed GREEN under two different plants with the behavior broken",
};

/**
 * The resume command for a halt: the skill that started the run, the FR, and
 * the point to resume at — an AC, `refactor` or `audit`. Placeholders stand in
 * for what the report lacks.
 */
function resumeCommand(report: HaltReport, at: string = report.ac ?? "<AC-id>"): string {
  return `/dev-process-toolkit:${report.entry ?? "tdd"} ${report.fr ?? "<FR-id>"} --resume-at ${at}`;
}

/**
 * The resume sentence for a halt that is not `not-load-bearing`, or "" when a
 * plain re-run is right. When it is non-empty it is the whole remedy: the
 * re-run clause would restart at Stage RED and contradict it. Once a test is
 * GREEN, a re-run from Stage RED would halt in mode A, so every later halt
 * resumes where it stopped. A first-pass Stage GREEN halt resumes at its AC.
 * A refactorer halt resumes at `refactor`. An audit halt resumes at `audit`:
 * any spec-reviewer halt, and an implementer halt in the audit retry round.
 * A test-writer halt has nothing implemented yet, so a re-run is the remedy.
 */
function resumeSentence(report: HaltReport): string {
  if (report.mode === "spec-gap") {
    return `After the audit, every test is GREEN: implement the ACs it reports missing, or correct the FR, then resume with ${resumeCommand(report, "audit")}.`;
  }
  if (report.role === "spec-reviewer") {
    return `At the audit, every test is GREEN: fix what stopped the spec-reviewer, then resume with ${resumeCommand(report, "audit")}.`;
  }
  if (report.role === "refactorer") {
    return `After GREEN, every test passes: fix or revert the refactor, then resume with ${resumeCommand(report, "refactor")}.`;
  }
  if (report.role === "implementer" && report.auditRound) {
    return `The halt came in the audit retry round, after every AC was GREEN: fix what stopped the implementer, then resume with ${resumeCommand(report, "audit")}.`;
  }
  if (report.role === "implementer" && report.ac) {
    return `The ACs before this one are GREEN: fix what stopped the implementer, then resume at its AC with ${resumeCommand(report)}.`;
  }
  return "";
}

export function formatHaltReport(report: HaltReport): string {
  const lines: string[] = [];
  // not-load-bearing halts on its first attempt: no budget ran out.
  lines.push(
    report.mode === "not-load-bearing"
      ? "/dev-process-toolkit:tdd: halt — a test does not guard its acceptance criterion."
      : "/dev-process-toolkit:tdd: halt — bounded retry budget exhausted.",
  );
  lines.push("");
  lines.push(`failure mode: ${report.mode} (${MODE_DESCRIPTIONS[report.mode]})`);
  lines.push(`role: ${report.role}`);
  if (report.role === "implementer" && report.ac) {
    lines.push(`AC: ${report.ac}`);
  }
  lines.push(`retry count: ${report.retryCount}`);
  if (
    report.mode === "spec-gap" &&
    report.missingAcs &&
    report.missingAcs.length > 0
  ) {
    lines.push("");
    lines.push("Unresolved missing ACs:");
    for (const acId of report.missingAcs) {
      lines.push(`  - ${acId}`);
    }
  }
  lines.push("");
  if (report.lastBlock && report.lastBlock.trim().length > 0) {
    lines.push("Last tdd-result block:");
    lines.push(report.lastBlock.trimEnd());
  } else {
    lines.push("Last raw output (no parseable tdd-result block emitted):");
    lines.push((report.rawOutput ?? "").trimEnd());
  }
  lines.push("");
  if (report.mode === "not-load-bearing") {
    // The test-writer is not user-invocable, so the one remedy the operator can
    // act on is a hand fix to the test. A plain re-run of the FR restarts at
    // Stage RED: the test-writer is dispatched again over the tests, the hand
    // fix among them, and after a halt on the last AC every test is GREEN,
    // which reads as mode A. `--resume-at` skips Stage RED and re-enters
    // Stage GREEN at this AC.
    lines.push(
      `Remedy: the test is the defect, not the implementation — fix the test for ${report.ac ?? "this AC"} by hand ` +
        "so it fails at its assertion when the behavior breaks, " +
        (report.auditRound
          ? `then resume with ${resumeCommand(report, "audit")}.`
          : report.ac
          ? `then resume with ${resumeCommand(report)}.`
          : "then resume at that AC (this report did not record its id)."),
    );
    lines.push(
      `Context: skill=tdd, mode=${report.mode}, role=${report.role}` +
        (report.ac ? `, ac=${report.ac}` : "") +
        `, retries=${report.retryCount}`,
    );
    return lines.join("\n");
  }
  const resume = resumeSentence(report);
  lines.push(
    resume
      ? `Remedy: inspect the report above. ${resume}`
      : "Remedy: inspect the report above and resume manually. " +
          "Re-run /dev-process-toolkit:tdd against the FR after fixing the " +
          "identified failure mode (test-writer false-RED, implementer GREEN " +
          "miss, refactorer regression, format drift, subagent maxTurns, or " +
          "spec-review reporting unimplemented acceptance criteria).",
  );
  lines.push(
    `Context: skill=tdd, mode=${report.mode}, role=${report.role}` +
      (report.ac ? `, ac=${report.ac}` : "") +
      `, retries=${report.retryCount}`,
  );
  return lines.join("\n");
}
