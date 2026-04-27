// tracker_project_milestone_attached — /gate-check probe (#26, STE-118 AC-STE-118.6).
//
// For each `status: active` FR with a tracker block, assert that the
// tracker ticket's `projectMilestone.name` byte-equals the canonical
// milestone name derived from the local plan-file H1 heading. Closes the
// drift surface where /spec-write didn't auto-attach (STE-115/116 origin).
//
// Vacuous on:
//   - mode: none
//   - archived FRs (immutable, AC-STE-18.4)
//   - active FRs without a `tracker:` block (FR is local-only despite tracker mode)
//   - active FRs whose plan file is missing (probe #27 owns that diagnostic)
//
// Hard fails:
//   - ticket projectMilestone is null
//   - ticket projectMilestone.name != canonical local heading
//
// Diagnostic format (AC-STE-118.6 / .7) shows both byte-rendered strings
// so em-dash drift is visible. The remedy points at
// `/spec-write --rename-milestone M<N>` for the rename-on-mismatch flow.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface TrackerProjectMilestoneAttachedViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TrackerProjectMilestoneAttachedReport {
  violations: TrackerProjectMilestoneAttachedViolation[];
}

export interface TrackerProjectMilestoneAttachedDeps {
  /**
   * Looks up the issue's projectMilestone via the active adapter. Wraps
   * `mcp__linear__get_issue` in production; tests inject a stub.
   * Returning `{ projectMilestone: null }` indicates the ticket exists but
   * has no milestone attached. Throwing is treated as an opaque hard fail.
   */
  getIssue: (ticketId: string) => Promise<{ projectMilestone?: { name: string } | null }>;
}

const HEADING_RE = /^# (M\d+ — .+?)(?:\s*\{#M\d+\})?\s*$/m;

interface FrFrontmatter {
  milestone: string | null;
  status: string | null;
  trackerLinear: string | null;
}

function parseFrFrontmatter(content: string): FrFrontmatter {
  const lines = content.split("\n");
  if (lines[0] !== "---") return { milestone: null, status: null, trackerLinear: null };
  let milestone: string | null = null;
  let status: string | null = null;
  let trackerLinear: string | null = null;
  let inTracker = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "---") break;
    // Two canonical tracker shapes (Schema Q):
    //   tracker: {}            — empty (no tracker bound)
    //   tracker:               — followed by indented `  linear: <id>` lines
    // Any other shape on the `tracker:` line itself (inline mapping with
    // values, e.g. `tracker: { linear: STE-1 }`) is non-canonical for /implement
    // and falls through to the generic key parser below — we only enter
    // `inTracker` for the indented-block shape.
    if (line === "tracker: {}") {
      inTracker = false;
      continue;
    }
    if (line === "tracker:") {
      inTracker = true;
      continue;
    }
    if (inTracker && /^\s+linear:/.test(line)) {
      const m = /^\s+linear:\s*(\S+)\s*$/.exec(line);
      if (m) trackerLinear = m[1]!;
      continue;
    }
    // Leaving the indented block.
    if (!/^\s/.test(line)) inTracker = false;
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === "milestone") milestone = m[2]!.trim();
    else if (m[1] === "status") status = m[2]!.trim();
  }
  return { milestone, status, trackerLinear };
}

function buildMessage(reason: string, file: string, kind: "missing" | "mismatch"): string {
  const remedy =
    kind === "missing"
      ? "Run /implement Phase 1 against this FR — Phase 1 entry calls attachProjectMilestone() idempotently. Or attach manually via mcp__linear__save_issue(id=<ticket>, milestone=<canonical name from plan H1>)."
      : "If the local plan-file heading is correct, run /spec-write --rename-milestone M<N> to rename the Linear milestone to match. If the tracker side is correct, edit specs/plan/M<N>.md heading to match.";
  return [
    `tracker_project_milestone_attached: ${reason}`,
    `Remedy: ${remedy}`,
    `Context: file=${file}, probe=tracker_project_milestone_attached`,
  ].join("\n");
}

function isTrackerMode(claudeMdContent: string): boolean {
  const lines = claudeMdContent.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return false;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    // Aligned with task_tracking_canonical_keys.ts boundary-detection convention.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = /^mode:\s*(\S+)\s*$/.exec(lines[i]!);
    if (m) {
      const mode = m[1]!;
      return mode !== "none" && mode !== "";
    }
  }
  return false;
}

function readPlanHeading(planPath: string): string | null {
  if (!existsSync(planPath)) return null;
  const md = readFileSync(planPath, "utf-8");
  const m = md.match(HEADING_RE);
  return m ? m[1]!.trim() : null;
}

export async function runTrackerProjectMilestoneAttachedProbe(
  projectRoot: string,
  deps: TrackerProjectMilestoneAttachedDeps,
): Promise<TrackerProjectMilestoneAttachedReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { violations: [] };
  const claudeMdContent = readFileSync(claudeMd, "utf-8");
  if (!isTrackerMode(claudeMdContent)) return { violations: [] };

  const frsDir = join(projectRoot, "specs", "frs");
  if (!existsSync(frsDir)) return { violations: [] };

  const violations: TrackerProjectMilestoneAttachedViolation[] = [];
  const entries = readdirSync(frsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = join(frsDir, entry.name);
    const rel = relative(projectRoot, fullPath);
    const content = readFileSync(fullPath, "utf-8");
    const fm = parseFrFrontmatter(content);
    if (fm.status !== "active") continue;
    if (!fm.trackerLinear) continue;
    if (!fm.milestone) continue;

    const planPath = join(projectRoot, "specs", "plan", `${fm.milestone}.md`);
    const heading = readPlanHeading(planPath);
    if (heading === null) continue; // probe #27 owns the orphan/missing-plan diagnostic

    let issue: { projectMilestone?: { name: string } | null };
    try {
      issue = await deps.getIssue(fm.trackerLinear);
    } catch (e) {
      const reason = `tracker fetch for ${fm.trackerLinear} failed: ${e instanceof Error ? e.message : String(e)}`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — ${reason}`,
        message: buildMessage(reason, rel, "missing"),
      });
      continue;
    }
    const attached = issue.projectMilestone?.name ?? null;
    if (attached === null) {
      const reason = `${rel} (linear:${fm.trackerLinear}) is missing projectMilestone — expected "${heading}"`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — linear:${fm.trackerLinear} not attached to projectMilestone (expected "${heading}")`,
        message: buildMessage(reason, rel, "missing"),
      });
      continue;
    }
    if (attached !== heading) {
      const reason = `${rel} (linear:${fm.trackerLinear}) projectMilestone mismatch — local: "${heading}" vs tracker: "${attached}"`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — linear:${fm.trackerLinear} milestone "${attached}" != local "${heading}"`,
        message: buildMessage(reason, rel, "mismatch"),
      });
    }
  }
  return { violations };
}
