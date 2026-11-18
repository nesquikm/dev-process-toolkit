// plan_task_state — STE-151 helper for /gate-check probe #14 active-side
// drift exemption.
//
// Reads `<specsDir>/plan/<milestone>.md` (active path) or
// `<specsDir>/plan/archive/<milestone>.md` (fallback) and returns:
//   - totalTasks      — count of `^\s*-\s*\[[ xX]\]\s` task-list lines
//   - uncheckedTasks  — subset that are `- [ ]` (unchecked)
//   - checkedTaskLines — the `- [x]` / `- [X]` lines, verbatim (STE-825)
//   - planStatus      — 'active' if loaded from plan/, 'archived' from
//                       plan/archive/, 'missing' if neither file exists
//
// The strict regex deliberately rejects prose bullets and only matches
// canonical Markdown task-list syntax (one space inside the brackets, then
// a space). That keeps `- some bullet` and `- [ ]immediately` out of the
// count.

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export type PlanStatus = "active" | "archived" | "missing";

export interface PlanTaskState {
  totalTasks: number;
  uncheckedTasks: number;
  planStatus: PlanStatus;
  /** Every checked (`- [x]` or `- [X]`) task line of the plan, verbatim (STE-825). */
  checkedTaskLines?: string[];
}

const TASK_LINE_RE = /^\s*-\s*\[[ xX]\]\s/;
const UNCHECKED_RE = /^\s*-\s*\[ \]\s/;
const CHECKED_RE = /^\s*-\s*\[[xX]\]\s/;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readPlanTaskState(
  specsDir: string,
  milestone: string,
): Promise<PlanTaskState> {
  const activePath = join(specsDir, "plan", `${milestone}.md`);
  const archivedPath = join(specsDir, "plan", "archive", `${milestone}.md`);

  let path: string | null = null;
  let status: PlanStatus = "missing";
  if (await fileExists(activePath)) {
    path = activePath;
    status = "active";
  } else if (await fileExists(archivedPath)) {
    path = archivedPath;
    status = "archived";
  }

  if (path === null) {
    return { totalTasks: 0, uncheckedTasks: 0, planStatus: "missing", checkedTaskLines: [] };
  }

  const content = await readFile(path, "utf-8");
  const lines = content.split("\n");
  let total = 0;
  let unchecked = 0;
  const checkedTaskLines: string[] = [];
  for (const line of lines) {
    if (TASK_LINE_RE.test(line)) {
      total += 1;
      if (UNCHECKED_RE.test(line)) unchecked += 1;
      if (CHECKED_RE.test(line)) checkedTaskLines.push(line);
    }
  }
  return { totalTasks: total, uncheckedTasks: unchecked, planStatus: status, checkedTaskLines };
}
