// split_plan.ts — split v1 plan.md by ## M<N>: heading into per-milestone
// plan file blocks; parse archived-pointer lines separately (AC-48.7).
//
// Status detection:
//   - If the milestone body contains "**Status:** complete" → status=complete
//   - If "**Status:** draft" → draft
//   - Otherwise → active (matches AC-48.7 default for in-flight milestones)
// AC-48.7 sets kickoff_branch and frozen_at to null for migrated plans
// regardless of status — this is the documented spec exception relative to
// AC-44.2 (see plan.schema.json $comment).

export interface PlanFrontmatter {
  milestone: string;
  status: "draft" | "active" | "complete";
  kickoff_branch: string | null;
  frozen_at: string | null;
  revision: number;
}

export interface MilestoneBlock {
  id: string;
  title: string;
  body: string;
  frontmatter: PlanFrontmatter;
}

export interface ArchivedPointer {
  id: string;
  title: string;
  archiveFile: string;
  archivedDate: string;
}

export interface SplitPlanResult {
  milestones: MilestoneBlock[];
  archivedPointers: ArchivedPointer[];
}

const MILESTONE_HEADING_RE = /^##\s+(M\d+):\s+(.+?)(?:\s*\{#M\d+\})?\s*$/;
const ARCHIVED_POINTER_RE =
  /^>\s*archived:\s+(M\d+)\s+—\s+(.+?)\s+→\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\)\s*$/;
const STATUS_LINE_RE = /\*\*Status:\*\*\s+(\w+)/;

export function splitPlan(markdown: string): SplitPlanResult {
  const lines = markdown.split("\n");
  const milestones: MilestoneBlock[] = [];
  const archivedPointers: ArchivedPointer[] = [];

  // First pass: archived pointers
  for (const line of lines) {
    const m = ARCHIVED_POINTER_RE.exec(line);
    if (m) {
      archivedPointers.push({
        id: m[1]!,
        title: m[2]!.trim(),
        archiveFile: m[3]!.trim(),
        archivedDate: m[4]!,
      });
    }
  }

  // Second pass: milestone headings
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = MILESTONE_HEADING_RE.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const id = match[1]!;
    const title = match[2]!.trim();
    let j = i + 1;
    while (j < lines.length) {
      if (/^##\s+M\d+:\s/.test(lines[j]!)) break;
      // stop at next top-level section (## anything)
      if (/^##\s+/.test(lines[j]!) && !/^##\s+M\d+:/.test(lines[j]!)) break;
      j++;
    }
    const body = lines.slice(i + 1, j).join("\n").trim();
    const statusMatch = STATUS_LINE_RE.exec(body);
    let status: PlanFrontmatter["status"] = "active";
    if (statusMatch) {
      const raw = statusMatch[1]!.toLowerCase();
      if (raw === "complete") status = "complete";
      else if (raw === "draft") status = "draft";
      else status = "active";
    }
    milestones.push({
      id,
      title,
      body,
      frontmatter: {
        milestone: id,
        status,
        kickoff_branch: null,
        frozen_at: null,
        revision: 1,
      },
    });
    i = j;
  }

  return { milestones, archivedPointers };
}

export function renderPlanFile(block: MilestoneBlock): string {
  const fm = block.frontmatter;
  const lines = [
    "---",
    `milestone: ${fm.milestone}`,
    `status: ${fm.status}`,
    `kickoff_branch: ${fm.kickoff_branch === null ? "null" : fm.kickoff_branch}`,
    `frozen_at: ${fm.frozen_at === null ? "null" : fm.frozen_at}`,
    `revision: ${fm.revision}`,
    "---",
    "",
    `# ${block.id}: ${block.title}`,
    "",
    block.body,
    "",
  ];
  return lines.join("\n");
}

export function renderArchivedPlanFile(pointer: ArchivedPointer, body: string): string {
  const lines = [
    "---",
    `milestone: ${pointer.id}`,
    `status: complete`,
    `kickoff_branch: null`,
    `frozen_at: null`,
    `revision: 1`,
    "---",
    "",
    `# ${pointer.id}: ${pointer.title}`,
    "",
    body.trim(),
    "",
  ];
  return lines.join("\n");
}
