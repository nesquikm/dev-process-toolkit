// task_tracking_canonical_keys — /gate-check probe (STE-114 AC-STE-114.3).
//
// Closed set of Schema L canonical keys. Top-level keys outside the set
// fail; subsection contents are scoped out. Catches the smoke-test failure
// mode (F2 in /tmp/dpt-smoke-findings-2026-04-25.md) where /setup wrote
// `linear_team_key` / `linear_team_id` etc. as top-level keys.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const CANONICAL_KEYS: ReadonlySet<string> = new Set([
  "mode",
  "mcp_server",
  "jira_ac_field",
  "branch_template",
]);

export interface TaskTrackingCanonicalKeysViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TaskTrackingCanonicalKeysReport {
  violations: TaskTrackingCanonicalKeysViolation[];
}

interface SectionScan {
  start: number; // 1-based line number of `## Task Tracking` heading
  end: number; // 1-based line number of the next `##`/`#` heading or EOF+1
  lines: string[]; // content lines between (exclusive of) start and end
}

function locateSection(content: string): SectionScan | null {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  return {
    start: startIdx + 1,
    end: endIdx + 1,
    lines: lines.slice(startIdx + 1, endIdx),
  };
}

function buildMessage(reason: string, file: string): string {
  return [
    `task_tracking_canonical_keys: ${reason}`,
    `Remedy: keep only {mode, mcp_server, jira_ac_field, branch_template} as top-level keys under ## Task Tracking. ` +
      `Move tracker-specific metadata (project IDs, team names) under a sub-heading like \`### Linear\` or into the adapter's own config. ` +
      `See plugins/dev-process-toolkit/docs/patterns.md § Schema L Canonical keys.`,
    `Context: file=${file}, probe=task_tracking_canonical_keys`,
  ].join("\n");
}

export async function runTaskTrackingCanonicalKeysProbe(
  projectRoot: string,
): Promise<TaskTrackingCanonicalKeysReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { violations: [] };

  const content = readFileSync(claudeMd, "utf-8");
  const scan = locateSection(content);
  if (!scan) return { violations: [] };

  const rel = relative(projectRoot, claudeMd);
  const violations: TaskTrackingCanonicalKeysViolation[] = [];
  const offenders: { name: string; line: number }[] = [];
  const malformedLines: number[] = [];

  let inSubsection = false;
  for (let i = 0; i < scan.lines.length; i++) {
    const raw = scan.lines[i]!;
    const lineNo = scan.start + 1 + i; // +1: skip the heading line itself
    if (raw.startsWith("###")) {
      // Schema L permits sub-section headings; their contents are out of scope.
      inSubsection = true;
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (inSubsection) continue;

    // Top-level content. Must be a `key: <value>` line (value may be empty).
    const m = /^([a-z_][a-z0-9_]*)\s*:/.exec(raw);
    if (!m) {
      malformedLines.push(lineNo);
      continue;
    }
    const key = m[1]!;
    if (!CANONICAL_KEYS.has(key)) {
      offenders.push({ name: key, line: lineNo });
    }
  }

  if (offenders.length > 0) {
    const names = offenders.map((o) => o.name).join(", ");
    const firstLine = offenders[0]!.line;
    const reason = `non-canonical keys at top level: ${names} — closed set is {mode, mcp_server, jira_ac_field, branch_template}`;
    violations.push({
      file: claudeMd,
      line: firstLine,
      reason,
      note: `${rel}:${firstLine} — ${reason}`,
      message: buildMessage(reason, rel),
    });
  }
  if (malformedLines.length > 0) {
    const lineNo = malformedLines[0]!;
    const reason = `malformed Schema L line — top-level content under ## Task Tracking must be \`key: value\` pairs (parse error)`;
    violations.push({
      file: claudeMd,
      line: lineNo,
      reason,
      note: `${rel}:${lineNo} — ${reason}`,
      message: buildMessage(reason, rel),
    });
  }

  return { violations };
}
