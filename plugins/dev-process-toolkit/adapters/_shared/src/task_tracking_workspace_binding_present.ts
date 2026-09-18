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
//
// STE-603 — when the sub-section declares a `repo_tag`, three more legs:
//   (a) a reader refusal is a violation carrying the reader's own text;
//   (b) the shared-container stop paragraph absent, present twice, or not
//       byte-equal to `renderSharedTrackerSentinel` for the declared tag/floor;
//   (c) the running toolkit version below `min_dpt_version`.
// A stop paragraph with no declaration is also a violation. With neither a
// declaration nor a paragraph, the output is unchanged.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { checkVersionFloor, nfr10Message, runningDptVersion } from "./dpt_version";
import { renderSharedTrackerSentinel, SHARED_TRACKER_MARKER } from "./setup/tracker_binding_write";
import {
  locateSubsection,
  readWorkspaceBinding,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
} from "./workspace_binding";

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

const WRITER = "plugins/dev-process-toolkit/adapters/_shared/src/setup/tracker_binding_write.ts";

function buildSharedMessage(leg: string, reason: string, remedy: string, file: string, mode: string): string {
  return nfr10Message(
    `task_tracking_workspace_binding_present: ${reason}`,
    remedy,
    `file=${file}, mode=${mode}, leg=${leg}, probe=task_tracking_workspace_binding_present`,
  );
}

/** Each stop paragraph in the sub-section: the marker line through its contiguous `>` lines. */
function stopParagraphs(sub: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < sub.length; i++) {
    if (sub[i] !== SHARED_TRACKER_MARKER) continue;
    let end = i + 1;
    while (end < sub.length && sub[end]!.startsWith(">") && sub[end] !== SHARED_TRACKER_MARKER) end++;
    out.push(sub.slice(i, end).join("\n"));
    i = end - 1;
  }
  return out;
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
  const subTitle = `### ${adapterKey === "linear" ? "Linear" : "Jira"}`;
  const lines = content.split("\n");

  const subPresent = lines.some((l) => l === subTitle);
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

  // Find the line of the sub-section heading for diagnostic positioning.
  const headingLineIdx = lines.findIndex((l) => l === subTitle);
  const lineNo = headingLineIdx >= 0 ? headingLineIdx + 1 : resolved.sectionLine;
  const violation = (reason: string, message: string): TaskTrackingWorkspaceBindingViolation => ({
    file: claudeMd,
    line: lineNo,
    reason,
    note: `${rel}:${lineNo} — ${reason}`,
    message,
  });

  // Leg (a) — the reader's refusal, in the reader's own words.
  let binding: WorkspaceBinding;
  try {
    binding = readWorkspaceBinding(claudeMd, adapterKey);
  } catch (e) {
    const readerText = e instanceof Error ? e.message : String(e);
    const reason = `${subTitle} shared-container declaration is refused by the reader: ${readerText.split("\n")[0]}`;
    return { violations: [violation(reason, readerText)] };
  }

  const violations: TaskTrackingWorkspaceBindingViolation[] = [];
  const missing: string[] = [];
  if (adapterKey === "linear") {
    if (!binding.team) missing.push("team");
    if (!binding.project) missing.push("project");
  } else {
    if (!binding.project) missing.push("project");
  }
  if (missing.length > 0) {
    const reason = `${subTitle} sub-section is missing required key${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
    violations.push(violation(reason, buildMessage(reason, rel, resolved.mode)));
  }

  const paragraphs = stopParagraphs(locateSubsection(lines, adapterKey) ?? []);
  const rewrite = `re-run \`bun run ${WRITER} <projectRoot> ${adapterKey} --project <project> --shared <tag>\` to re-render it`;
  if (binding.shared) {
    // Leg (b) — exactly one paragraph, byte-equal to the render.
    const expected = renderSharedTrackerSentinel({
      adapter: adapterKey,
      project: binding.project ?? "",
      repoTag: binding.repoTag!,
      minDptVersion: binding.minDptVersion!,
    });
    let problem: string | null = null;
    if (paragraphs.length === 0) problem = "is absent";
    else if (paragraphs.length > 1) problem = `is present ${paragraphs.length} times`;
    else if (paragraphs[0] !== expected) {
      problem = `is not the render for project "${binding.project ?? ""}", tag "${binding.repoTag}" and floor ${binding.minDptVersion} (stale paragraph)`;
    }
    if (problem !== null) {
      const reason = `${subTitle} declares repo_tag "${binding.repoTag}" but the shared-container stop paragraph ${problem}`;
      violations.push(violation(reason, buildSharedMessage("paragraph", reason, `${rewrite}.`, rel, resolved.mode)));
    }
    // Leg (c) — the running toolkit version at or above the floor.
    let running: string | null = null;
    try {
      running = runningDptVersion();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const reason = `${subTitle} declares min_dpt_version ${binding.minDptVersion} but the running toolkit version is unknown: ${text.split("\n")[0]}`;
      violations.push(violation(reason, text));
    }
    if (running !== null) {
      const verdict = checkVersionFloor(binding, running);
      if (!verdict.ok) {
        const reason = `${subTitle} declares min_dpt_version ${verdict.floor}; the running toolkit version ${verdict.running} is below it`;
        violations.push(violation(reason, verdict.message));
      }
    }
  } else if (paragraphs.length > 0) {
    const reason = `${subTitle} carries a shared-container stop paragraph but declares no repo_tag (stale paragraph)`;
    violations.push(
      violation(
        reason,
        buildSharedMessage(
          "paragraph",
          reason,
          `delete the paragraph, or declare the container shared: ${rewrite}.`,
          rel,
          resolved.mode,
        ),
      ),
    );
  }

  return { violations };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const report = await runTaskTrackingWorkspaceBindingPresentProbe(root);
  if (report.violations.length === 0) {
    process.stdout.write("task_tracking_workspace_binding_present: OK\n");
  } else {
    for (const v of report.violations) process.stdout.write(`${v.note}\n${v.message}\n`);
    process.exit(1);
  }
}
