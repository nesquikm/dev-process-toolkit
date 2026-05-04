// plan_only_archival — STE-200 helper.
//
// Decides whether `/spec-archive M<N>` should branch to the plan-only
// archival path. Three eligibility signals:
//   (a) plan frontmatter carries `kind: scaffolding` (STE-197 marker).
//   (b) every task checkbox under the `## M<N>:` block is `[x]` or
//       `[deferred]` (zero unchecked).
//   (c) operator passed `--plan-only` explicitly (escape hatch).
//
// The helper is pure — no side effects, no writes. Callers that intend
// to mutate state read the result and decide separately. The helper
// also returns the parsed reason so the closing-summary capability row
// can name which branch fired.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";

export type PlanOnlyEligibilityReason =
  | "scaffolding"
  | "all-checked"
  | "explicit-flag"
  | "ineligible-mixed-tasks"
  | "ineligible-plan-missing";

export interface PlanOnlyEligibility {
  eligible: boolean;
  reason: PlanOnlyEligibilityReason;
  /** True when the plan file exists at the active path. */
  planExists: boolean;
}

const TASK_LINE_RE = /^\s*-\s*\[(?<marker>[^\]]*)\]\s/;

export async function evaluatePlanOnlyEligibility(
  specsDir: string,
  milestone: string,
  options: { planOnlyFlag?: boolean } = {},
): Promise<PlanOnlyEligibility> {
  const planPath = join(specsDir, "plan", `${milestone}.md`);
  let content: string;
  try {
    content = await readFile(planPath, "utf-8");
  } catch {
    return { eligible: false, reason: "ineligible-plan-missing", planExists: false };
  }

  // (c) explicit flag wins.
  if (options.planOnlyFlag) {
    return { eligible: true, reason: "explicit-flag", planExists: true };
  }

  // (a) frontmatter `kind: scaffolding`.
  let fm: Record<string, unknown> = {};
  try {
    fm = parseFrontmatter(content, { lenient: true });
  } catch {
    fm = {};
  }
  if (fm["kind"] === "scaffolding") {
    return { eligible: true, reason: "scaffolding", planExists: true };
  }

  // (b) every task checkbox under any `## M<N>:` block is `[x]` or
  // `[deferred]`. Empty / no tasks ⇒ ineligible (ambiguous state per
  // STE-200's no-FRs + unchecked-ACs refusal rule).
  let totalTasks = 0;
  let uncheckedTasks = 0;
  for (const line of content.split("\n")) {
    const m = TASK_LINE_RE.exec(line);
    if (!m) continue;
    totalTasks += 1;
    const marker = (m.groups?.marker ?? "").trim().toLowerCase();
    // "x" and "deferred" count as completed; anything else (including
    // empty " " for `[ ]`) is unchecked.
    if (marker !== "x" && marker !== "deferred") uncheckedTasks += 1;
  }
  if (totalTasks > 0 && uncheckedTasks === 0) {
    return { eligible: true, reason: "all-checked", planExists: true };
  }
  return { eligible: false, reason: "ineligible-mixed-tasks", planExists: true };
}
