// spec_write_milestone_gate_routed (STE-401 AC-STE-401.5) — /gate-check probe
// `spec_write_milestone_gate_routed`. Severity: error.
//
// Asserts that `plugins/dev-process-toolkit/skills/spec-write/SKILL.md`
// documents the milestone-allocation gate's marker/refusal routing. The 2026-
// 07-19 conformance run's headline finding (F1, both trackers): the
// milestone-allocation decision fell to prose under non-tty stdin and ended
// the turn — a clean-success `claude -p` exit with zero artifacts. The fix
// wires the gate through `requireOrRefuse` (marker present ⇒ default-apply the
// recommendation; absent + non-tty ⇒ RequiresInputRefusedError), and this
// probe pins the contract in the SKILL body byte-checkably so it cannot
// silently regress into prose again.
//
// Sibling probe shape to probe #55 `not_a_trigger_anchor_present` (STE-313)
// and probe #47 `spec_write_first_turn_drift_scan` (STE-270): single-file
// scope, literal substring match (no regex on the canonical phrases), one
// NFR-10 note per missing literal. Vacuous when the spec-write SKILL.md is
// absent (downstream toolkit consumers without the plugin's own skills tree).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const PROBE_ID = "spec_write_milestone_gate_routed";

export type Severity = "error" | "warning";

export interface MilestoneGateRoutedViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface MilestoneGateRoutedReport {
  violations: MilestoneGateRoutedViolation[];
}

// The milestone-allocation gate contract, as byte-checkable literals the
// SKILL body MUST carry. Literal substring match — no regex — so future copy
// edits can't silently change match semantics (the STE-270 lesson):
//   - `requireOrRefuse` — the routing primitive the gate delegates to.
//   - `milestone_allocation_default_applied` — the marker-present default-
//     apply capability token (also enforced by probe #44's MUST-emit leg).
//   - `RequiresInputRefusedError` — the marker-absent + non-tty outcome.
//   - the non-tty refusal anchor phrase — the literal that forbids the F1
//     prose-ask-then-end-turn no-op.
export const MILESTONE_GATE_REQUIRED_LITERALS = [
  "requireOrRefuse",
  "milestone_allocation_default_applied",
  "RequiresInputRefusedError",
  "prose-ask-then-end-turn is forbidden under non-tty",
] as const;

const SKILL_REL_PATH =
  "plugins/dev-process-toolkit/skills/spec-write/SKILL.md";

const REMEDY =
  "document the milestone-allocation gate's marker/refusal routing in " +
  "skills/spec-write/SKILL.md: it MUST route through `requireOrRefuse(...)` " +
  "with the computed recommendation as defaultValue (marker present ⇒ " +
  "default-apply, `MUST emit \\`milestone_allocation_default_applied\\``; " +
  "absent + non-tty ⇒ `RequiresInputRefusedError`), and MUST carry the " +
  "literal non-tty anchor `prose-ask-then-end-turn is forbidden under non-tty`.";

function buildMessage(relFile: string, line: number, reason: string): string {
  return [
    `${PROBE_ID}: ${relFile}:${line} — ${reason}`,
    `Remedy: ${REMEDY}`,
    `Context: file=${relFile}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

export async function runSpecWriteMilestoneGateRoutedProbe(
  projectRoot: string,
): Promise<MilestoneGateRoutedReport> {
  const abs = join(projectRoot, SKILL_REL_PATH);
  if (!existsSync(abs)) return { violations: [] };
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return { violations: [] };
  }
  const rel = relative(projectRoot, abs);
  const violations: MilestoneGateRoutedViolation[] = [];
  for (const literal of MILESTONE_GATE_REQUIRED_LITERALS) {
    if (content.includes(literal)) continue;
    const reason = `milestone-allocation gate contract missing required literal ${JSON.stringify(literal)}`;
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
