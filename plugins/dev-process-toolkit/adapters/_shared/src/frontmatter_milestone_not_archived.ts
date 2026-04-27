// frontmatter_milestone_not_archived — /gate-check probe (#27, STE-119 AC-STE-119.4).
//
// Active FRs whose `milestone:` frontmatter points at an archived plan file
// are a `M<N>` collision: the FR was drafted with a guessed-stale milestone
// number (M30 spec-write 2026-04-27 picked M28, already shipped). Probe
// fires hard so post-edit collisions surface even when the pre-allocation
// guard in `/spec-write` was bypassed.
//
// Scoping table (matching AC-STE-119.4):
//   - archived FR → vacuous (archive matches archived plan by construction)
//   - active FR, milestone matches active plan → pass
//   - active FR, milestone matches archived plan → hard fail (collision)
//   - active FR, milestone matches no plan → hard fail (orphan)
//   - missing milestone: frontmatter → hard fail (malformed)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface FrontmatterMilestoneViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface FrontmatterMilestoneReport {
  violations: FrontmatterMilestoneViolation[];
}

interface ParsedFrontmatter {
  milestone: string | null;
  milestoneLine: number;
  status: string | null;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0] !== "---") return { milestone: null, milestoneLine: 1, status: null };
  let milestone: string | null = null;
  let milestoneLine = 1;
  let status: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(lines[i]!);
    if (!m) continue;
    if (m[1] === "milestone") {
      milestone = m[2]!.trim();
      milestoneLine = i + 1;
    } else if (m[1] === "status") {
      status = m[2]!.trim();
    }
  }
  return { milestone, milestoneLine, status };
}

function buildMessage(reason: string, file: string, kind: "collision" | "orphan" | "malformed"): string {
  const remedy = {
    collision:
      "Active FR points at an archived M<N>.md. Either the FR was drafted with a stale milestone number (run /spec-write with a fresh number — see specs/plan/M*.md + CHANGELOG for the next free) or the milestone was archived prematurely. Resolve by editing the FR's frontmatter `milestone:` to a live number, or unarchive the plan file if the milestone is still active.",
    orphan:
      "Active FR's `milestone:` points at no plan file (active or archived). Either create specs/plan/<value>.md or fix the frontmatter.",
    malformed:
      "FR file is missing `milestone:` frontmatter — required by Schema Q. Add the line under the `---` block.",
  }[kind];
  return [
    `frontmatter_milestone_not_archived: ${reason}`,
    `Remedy: ${remedy}`,
    `Context: file=${file}, probe=frontmatter_milestone_not_archived`,
  ].join("\n");
}

export async function runFrontmatterMilestoneNotArchivedProbe(
  projectRoot: string,
): Promise<FrontmatterMilestoneReport> {
  const frsDir = join(projectRoot, "specs", "frs");
  const planDir = join(projectRoot, "specs", "plan");
  const planArchiveDir = join(projectRoot, "specs", "plan", "archive");
  if (!existsSync(frsDir)) return { violations: [] };

  const violations: FrontmatterMilestoneViolation[] = [];
  const entries = readdirSync(frsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = join(frsDir, entry.name);
    const rel = relative(projectRoot, fullPath);
    const content = readFileSync(fullPath, "utf-8");
    const fm = parseFrontmatter(content);

    // archived FR is vacuous
    if (fm.status === "archived") continue;

    if (!fm.milestone) {
      const reason = `${rel} has no \`milestone:\` frontmatter — required for active FRs`;
      violations.push({
        file: fullPath,
        line: fm.milestoneLine,
        reason,
        note: `${rel}:${fm.milestoneLine} — ${reason} (malformed)`,
        message: buildMessage(reason, rel, "malformed"),
      });
      continue;
    }

    const milestone = fm.milestone;
    const activePlan = join(planDir, `${milestone}.md`);
    const archivedPlan = join(planArchiveDir, `${milestone}.md`);

    if (existsSync(activePlan)) continue; // happy path

    if (existsSync(archivedPlan)) {
      const archRel = relative(projectRoot, archivedPlan);
      const reason = `${rel} (active) points at \`${milestone}\` — collision: ${archRel} is archived`;
      violations.push({
        file: fullPath,
        line: fm.milestoneLine,
        reason,
        note: `${rel}:${fm.milestoneLine} — active FR pointing at archived ${milestone} (collision with ${archRel})`,
        message: buildMessage(reason, rel, "collision"),
      });
      continue;
    }

    // Neither active nor archived plan file exists: orphan.
    const reason = `${rel} (active) points at \`${milestone}\` — no plan file (orphan)`;
    violations.push({
      file: fullPath,
      line: fm.milestoneLine,
      reason,
      note: `${rel}:${fm.milestoneLine} — orphan: ${milestone} has no plan file (active or archived)`,
      message: buildMessage(reason, rel, "orphan"),
    });
  }
  return { violations };
}
