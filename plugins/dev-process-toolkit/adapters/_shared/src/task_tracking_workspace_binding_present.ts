// task_tracking_workspace_binding_present — /gate-check probe (#25, STE-117 AC-STE-117.8).
//
// In tracker mode, the `## Task Tracking` block must carry a populated
// `### Linear` / `### Jira` sub-section identifying the workspace binding
// (Linear team + project, Jira project). Closes the silent-landing trap
// from M30 spec-write where STE-115/116 were `mcp__linear__save_issue`'d
// without `project`, landing outside the user's expected project board.
//
// Vacuous on:
//   - CLAUDE.md absent;
//   - `## Task Tracking` section absent (mode-none canonical form);
//   - `mode: none` explicit.
//
// Required:
//   - Linear: `team:` AND `project:` non-empty in `### Linear`;
//   - Jira: `project:` non-empty in `### Jira` (team is N/A).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readWorkspaceBinding, type WorkspaceAdapterKey } from "./workspace_binding";

export interface TaskTrackingWorkspaceBindingViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TaskTrackingWorkspaceBindingReport {
  violations: TaskTrackingWorkspaceBindingViolation[];
}

const SECTION_HEADING = "## Task Tracking";

interface ResolvedMode {
  mode: string;
  modeLine: number;
  sectionLine: number;
}

function resolveMode(content: string): ResolvedMode | null {
  const lines = content.split("\n");
  const sectionLine = lines.findIndex((l) => l === SECTION_HEADING);
  if (sectionLine < 0) return null;
  let endLine = lines.length;
  for (let i = sectionLine + 1; i < lines.length; i++) {
    // Aligned with task_tracking_canonical_keys.ts and migrate-* scripts.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endLine = i;
      break;
    }
  }
  for (let i = sectionLine + 1; i < endLine; i++) {
    const m = /^mode:\s*(\S+)\s*$/.exec(lines[i]!);
    if (m) return { mode: m[1]!, modeLine: i + 1, sectionLine: sectionLine + 1 };
  }
  return { mode: "", modeLine: sectionLine + 1, sectionLine: sectionLine + 1 };
}

function adapterKeyForMode(mode: string): WorkspaceAdapterKey | null {
  if (mode === "linear") return "linear";
  if (mode === "jira") return "jira";
  return null;
}

function buildMessage(reason: string, file: string, mode: string): string {
  return [
    `task_tracking_workspace_binding_present: ${reason}`,
    `Remedy: under ## Task Tracking, add a \`### ${mode === "linear" ? "Linear" : "Jira"}\` sub-section ` +
      `with required keys (Linear: team + project; Jira: project). Run the migration helper at ` +
      `plugins/dev-process-toolkit/scripts/migrate-task-tracking-add-workspace.ts to generate a diff. ` +
      `See plugins/dev-process-toolkit/docs/patterns.md § Schema L Workspace binding sub-sections.`,
    `Context: file=${file}, mode=${mode}, probe=task_tracking_workspace_binding_present`,
  ].join("\n");
}

export async function runTaskTrackingWorkspaceBindingPresentProbe(
  projectRoot: string,
): Promise<TaskTrackingWorkspaceBindingReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { violations: [] };
  const content = readFileSync(claudeMd, "utf-8");
  const resolved = resolveMode(content);
  if (!resolved) return { violations: [] };
  if (resolved.mode === "" || resolved.mode === "none") return { violations: [] };

  const adapterKey = adapterKeyForMode(resolved.mode);
  if (adapterKey === null) {
    // Custom adapter — out of scope for this probe (no canonical sub-section
    // shape defined for arbitrary trackers). Vacuous pass.
    return { violations: [] };
  }

  const rel = relative(projectRoot, claudeMd);
  const binding = readWorkspaceBinding(claudeMd, adapterKey);
  const subTitle = `### ${adapterKey === "linear" ? "Linear" : "Jira"}`;

  const subPresent = content.split("\n").some((l) => l === subTitle);
  if (!subPresent) {
    const reason = `tracker mode "${resolved.mode}" requires a ${subTitle} sub-section under ## Task Tracking — sub-section is absent`;
    return {
      violations: [
        {
          file: claudeMd,
          line: resolved.sectionLine,
          reason,
          note: `${rel}:${resolved.sectionLine} — ${reason}`,
          message: buildMessage(reason, rel, resolved.mode),
        },
      ],
    };
  }

  const missing: string[] = [];
  if (adapterKey === "linear") {
    if (!binding.team) missing.push("team");
    if (!binding.project) missing.push("project");
  } else {
    if (!binding.project) missing.push("project");
  }

  if (missing.length === 0) return { violations: [] };

  const reason = `${subTitle} sub-section is missing required key${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
  // Find the line of the sub-section heading for diagnostic positioning.
  const headingLineIdx = content.split("\n").findIndex((l) => l === subTitle);
  const lineNo = headingLineIdx >= 0 ? headingLineIdx + 1 : resolved.sectionLine;
  return {
    violations: [
      {
        file: claudeMd,
        line: lineNo,
        reason,
        note: `${rel}:${lineNo} — ${reason}`,
        message: buildMessage(reason, rel, resolved.mode),
      },
    ],
  };
}
