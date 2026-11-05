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
  ac?: string;
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

/** `/tdd <FR> --resume-at <AC>`, with placeholders for what the report lacks. */
function resumeCommand(report: HaltReport): string {
  return `/dev-process-toolkit:tdd ${report.fr ?? "<FR-id>"} --resume-at ${report.ac ?? "<AC-id>"}`;
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
        `then resume with ${resumeCommand(report)}.`,
    );
    lines.push(
      `Context: skill=tdd, mode=${report.mode}, role=${report.role}` +
        (report.ac ? `, ac=${report.ac}` : "") +
        `, retries=${report.retryCount}`,
    );
    return lines.join("\n");
  }
  lines.push(
    "Remedy: inspect the report above and resume manually. " +
      "Re-run /dev-process-toolkit:tdd against the FR after fixing the " +
      "identified failure mode (test-writer false-RED, implementer GREEN " +
      "miss, refactorer regression, format drift, subagent maxTurns, or " +
      "spec-review reporting unimplemented acceptance criteria)." +
      // A halt in Stage GREEN has ACs before it implemented: a re-run from
      // Stage RED would dispatch the test-writer over their tests again.
      (report.role === "implementer" && report.ac
        ? ` For this implementer halt, resume at its AC instead: ${resumeCommand(report)}.`
        : ""),
  );
  lines.push(
    `Context: skill=tdd, mode=${report.mode}, role=${report.role}` +
      (report.ac ? `, ac=${report.ac}` : "") +
      `, retries=${report.retryCount}`,
  );
  return lines.join("\n");
}
