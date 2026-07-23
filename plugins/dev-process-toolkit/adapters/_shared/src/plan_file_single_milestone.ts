// plan_file_single_milestone — /gate-check probe (STE-197 AC-STE-197.5).
//
// Invariant: every `specs/plan/*.md` and `specs/plan/archive/*.md` file
// must scaffold exactly one `## M<N>:` heading. Multi-milestone plan
// files are the F3.2 bug shape from the 2026-05-04 Dart-lib smoke run —
// `/setup` copying the un-trimmed template verbatim left M1 + M2 +
// dependency graph in a single file, breaking downstream skills.
//
// Severity: ADVISORY. Legacy multi-milestone files exist in user
// projects (the bug shape we're fixing); flagging them at warn level
// gives operators the signal without blocking their gate.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { MILESTONE_TOKEN_SOURCE, PLAN_FILENAME_RE } from "./milestone_token";

export interface PlanFileSingleMilestoneViolation {
  file: string;
  count: number;
  reason: string;
  note: string; // `file:line — reason` per STE-82
}

export interface PlanFileSingleMilestoneReport {
  violations: PlanFileSingleMilestoneViolation[];
}

const MILESTONE_HEADING_RE = new RegExp(`^## ${MILESTONE_TOKEN_SOURCE}:`, "gm");

async function listPlanFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const subdir of [
    join("specs", "plan"),
    join("specs", "plan", "archive"),
  ]) {
    const dir = join(projectRoot, subdir);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && PLAN_FILENAME_RE.test(e.name)) {
          out.push(join(dir, e.name));
        }
      }
    } catch {
      // missing dir is OK — fresh repos may have no archive yet
    }
  }
  return out.sort();
}

/**
 * Walk every `specs/plan/M*.md` (active + archive) and report files that
 * carry more than one `## M\d+:` heading. Pure function — no writes.
 *
 * Call site: `/gate-check` conformance probes + the STE-197 integration
 * test at `tests/gate-check-plan-file-single-milestone.test.ts`.
 */
export async function runPlanFileSingleMilestoneProbe(
  projectRoot: string,
): Promise<PlanFileSingleMilestoneReport> {
  const files = await listPlanFiles(projectRoot);
  const violations: PlanFileSingleMilestoneViolation[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const matches = content.match(MILESTONE_HEADING_RE) ?? [];
    if (matches.length > 1) {
      const rel = relative(projectRoot, file);
      const reason = `plan file carries ${matches.length} \`## M<N>:\` headings; expected exactly 1`;
      violations.push({
        file,
        count: matches.length,
        reason,
        note: `${rel}:1 — ${reason}`,
      });
    }
  }

  return { violations };
}
