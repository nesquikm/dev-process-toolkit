// report_issue_publish_gate_marker (STE-402 AC-STE-402.3) — /gate-check probe
// `report_issue_publish_gate_marker`. Severity: error.
//
// Asserts that `plugins/dev-process-toolkit/skills/report-issue/SKILL.md`
// documents the gist publish gate's marker/refusal routing. The 2026-07-19
// conformance run's Jira leg (F7): with the auto-approve marker absent under
// `claude -p`, the skill treated a prose "proceed" as authorization and
// invoked `gh gist create` — an irreversible push to a third-party service,
// blocked only by the harness classifier, not the plugin's own gate. The fix
// wires the publish gate through the same runtime byte-grep + `requireOrRefuse`
// three-branch contract `/spec-write` § 7a uses; this probe pins the contract
// byte-checkably so it cannot silently regress.
//
// Sibling probe shape to probe #70 `spec_write_milestone_gate_routed`
// (STE-401) and probe #55 `not_a_trigger_anchor_present` (STE-313): single-
// file scope, literal substring match (no regex — the STE-270 lesson), one
// NFR-10 note per missing literal. Vacuous when the report-issue SKILL.md is
// absent (downstream toolkit consumers without the plugin's own skills tree).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const PROBE_ID = "report_issue_publish_gate_marker";

export type Severity = "error" | "warning";

export interface ReportIssuePublishGateViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface ReportIssuePublishGateReport {
  violations: ReportIssuePublishGateViolation[];
}

// The publish-gate contract, as byte-checkable literals the report-issue
// SKILL body MUST carry:
//   - `check_marker_runtime.ts` — the SOLE runtime marker decider.
//   - `RequiresInputRefusedError` — the marker-absent + non-tty outcome
//     (no `gh gist create`).
//   - the NOT-a-trigger anchor phrase — the literal that forbids treating a
//     prose "proceed" as publish authorization (the F7 failure).
export const PUBLISH_GATE_REQUIRED_LITERALS = [
  "check_marker_runtime.ts",
  "RequiresInputRefusedError",
  "NOT authorization to publish",
] as const;

const SKILL_REL_PATH =
  "plugins/dev-process-toolkit/skills/report-issue/SKILL.md";

const REMEDY =
  "document the gist publish gate's marker/refusal routing in " +
  "skills/report-issue/SKILL.md: it MUST name the runtime byte-grep " +
  "`adapters/_shared/src/check_marker_runtime.ts` as the sole decider, refuse " +
  "on the marker-absent + non-tty branch via `RequiresInputRefusedError` " +
  "(no `gh gist create`), and carry the NOT-a-trigger anchor stating prose / " +
  "\"proceed\" instructions are `NOT authorization to publish`.";

function buildMessage(relFile: string, line: number, reason: string): string {
  return [
    `${PROBE_ID}: ${relFile}:${line} — ${reason}`,
    `Remedy: ${REMEDY}`,
    `Context: file=${relFile}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

export async function runReportIssuePublishGateMarkerProbe(
  projectRoot: string,
): Promise<ReportIssuePublishGateReport> {
  const abs = join(projectRoot, SKILL_REL_PATH);
  if (!existsSync(abs)) return { violations: [] };
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return { violations: [] };
  }
  const rel = relative(projectRoot, abs);
  const violations: ReportIssuePublishGateViolation[] = [];
  for (const literal of PUBLISH_GATE_REQUIRED_LITERALS) {
    if (content.includes(literal)) continue;
    const reason = `publish-gate contract missing required literal ${JSON.stringify(literal)}`;
    violations.push({
      file: abs,
      line: 1,
      reason,
      note: `${rel}:1 — ${reason}`,
      message: buildMessage(rel, 1, reason),
      severity: "error",
    });
  }
  return { violations };
}
