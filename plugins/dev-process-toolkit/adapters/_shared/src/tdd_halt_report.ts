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
  ac?: string;
  retryCount: number;
  lastBlock?: string;
  rawOutput?: string;
}

const MODE_DESCRIPTIONS: Record<FailureMode, string> = {
  A: "false-RED — test-writer's tests did not fail when run",
  B: "implementer could not reach GREEN",
  C: "refactorer broke GREEN",
  D: "format violation — invalid or missing tdd-result block",
  E: "maxTurns exhaustion — subagent stopped without producing a block",
};

export function formatHaltReport(report: HaltReport): string {
  const lines: string[] = [];
  lines.push("/dev-process-toolkit:tdd: halt — bounded retry budget exhausted.");
  lines.push("");
  lines.push(`failure mode: ${report.mode} (${MODE_DESCRIPTIONS[report.mode]})`);
  lines.push(`role: ${report.role}`);
  if (report.role === "implementer" && report.ac) {
    lines.push(`AC: ${report.ac}`);
  }
  lines.push(`retry count: ${report.retryCount}`);
  lines.push("");
  if (report.lastBlock && report.lastBlock.trim().length > 0) {
    lines.push("Last tdd-result block:");
    lines.push(report.lastBlock.trimEnd());
  } else {
    lines.push("Last raw output (no parseable tdd-result block emitted):");
    lines.push((report.rawOutput ?? "").trimEnd());
  }
  lines.push("");
  lines.push(
    "Remedy: inspect the report above and resume manually. " +
      "Re-run /dev-process-toolkit:tdd against the FR after fixing the " +
      "identified failure mode (test-writer false-RED, implementer GREEN " +
      "miss, refactorer regression, format drift, or subagent maxTurns).",
  );
  lines.push(
    `Context: skill=tdd, mode=${report.mode}, role=${report.role}` +
      (report.ac ? `, ac=${report.ac}` : "") +
      `, retries=${report.retryCount}`,
  );
  return lines.join("\n");
}
