// spec_write_first_turn_tracker_create_clause (STE-404 AC-STE-404.4) —
// /gate-check probe `spec_write_first_turn_tracker_create_clause`.
// Severity: error.
//
// Asserts that `plugins/dev-process-toolkit/skills/spec-write/SKILL.md`
// documents the first-turn tracker-create prohibition. The 2026-07-20
// conformance re-run's F4 (HIGH): under the autonomous-mode reminder + no
// marker, /spec-write skipped the first-turn loop and made a real tracker
// create (createJiraIssue → DST-49) before asking — a gap because the
// first-turn forbidden set listed Write/Edit/NotebookEdit but NOT the
// tracker-create MCP tools. This probe pins the closed gap in the SKILL body
// byte-checkably so it cannot silently regress.
//
// Sibling probe shape to probe #70 `spec_write_milestone_gate_routed` and
// probe #55 `not_a_trigger_anchor_present`: single-file scope, literal
// substring match (no regex — the STE-270 lesson), one NFR-10 note per
// missing literal. Vacuous when the spec-write SKILL.md is absent.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const PROBE_ID = "spec_write_first_turn_tracker_create_clause";

export type Severity = "error" | "warning";

export interface FirstTurnTrackerCreateClauseViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface FirstTurnTrackerCreateClauseReport {
  violations: FirstTurnTrackerCreateClauseViolation[];
}

// The first-turn tracker-create prohibition, as byte-checkable literals the
// SKILL body MUST carry:
//   - the two tracker-create MCP tool names, so the prohibition names the
//     exact tools the arbiter forbids;
//   - a first-turn-forbidden anchor phrase.
export const TRACKER_CREATE_CLAUSE_REQUIRED_LITERALS = [
  "mcp__atlassian__createJiraIssue",
  "mcp__linear__save_issue",
  "forbidden before the first ask/refusal",
] as const;

const SKILL_REL_PATH =
  "plugins/dev-process-toolkit/skills/spec-write/SKILL.md";

const REMEDY =
  "document the first-turn tracker-create prohibition in " +
  "skills/spec-write/SKILL.md: the FIRST ACTION contract MUST name the " +
  "tracker-create MCP tools (`mcp__atlassian__createJiraIssue`, " +
  "`mcp__linear__save_issue`) as `forbidden before the first ask/refusal` " +
  "(the same magpie bypass as scaffolding — the autonomous-mode reminder is " +
  "the escalation trigger to resist).";

function buildMessage(relFile: string, line: number, reason: string): string {
  return [
    `${PROBE_ID}: ${relFile}:${line} — ${reason}`,
    `Remedy: ${REMEDY}`,
    `Context: file=${relFile}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

export async function runSpecWriteFirstTurnTrackerCreateClauseProbe(
  projectRoot: string,
): Promise<FirstTurnTrackerCreateClauseReport> {
  const abs = join(projectRoot, SKILL_REL_PATH);
  if (!existsSync(abs)) return { violations: [] };
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return { violations: [] };
  }
  const rel = relative(projectRoot, abs);
  const violations: FirstTurnTrackerCreateClauseViolation[] = [];
  for (const literal of TRACKER_CREATE_CLAUSE_REQUIRED_LITERALS) {
    if (content.includes(literal)) continue;
    const reason = `first-turn tracker-create clause missing required literal ${JSON.stringify(literal)}`;
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
