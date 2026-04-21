// plan_lock.ts — Schema T enforcement + post-freeze edit scan (FR-44).
//
// Two exported surfaces:
//   1. checkPlanWriteAllowed(planPath, currentBranch): refuses edits to
//      status: active plan files unless the current branch is the sanctioned
//      plan/M<N>-replan-<N> branch for that milestone (AC-44.3, AC-44.4).
//   2. findPostFreezeEdits(repoRoot): scans git log for commits that touched
//      specs/plan/M*.md after the plan's frozen_at date. Returns SHAs for
//      /gate-check to surface as a warning (AC-44.4 warning semantics).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PLAN_FROZEN_MESSAGE = (milestone: string): string =>
  `Plan for ${milestone} is frozen. Create a \`plan/${milestone}-replan-<N>\` branch to revise.`;

export interface PlanWriteCheckResult {
  allowed: boolean;
  milestone?: string;
  message?: string;
}

function parsePlanFrontmatter(md: string): Record<string, string | null> {
  const match = /^---\n([\s\S]*?)\n---/m.exec(md);
  if (!match) return {};
  const out: Record<string, string | null> = {};
  for (const raw of match[1]!.split("\n")) {
    const c = raw.indexOf(":");
    if (c < 0) continue;
    const key = raw.slice(0, c).trim();
    const rest = raw.slice(c + 1).trim();
    out[key] = rest === "null" || rest === "" ? null : rest;
  }
  return out;
}

export function checkPlanWriteAllowed(planPath: string, currentBranch: string): PlanWriteCheckResult {
  let text: string;
  try {
    text = readFileSync(planPath, "utf-8");
  } catch {
    return { allowed: true };
  }
  const fm = parsePlanFrontmatter(text);
  const milestone = (fm["milestone"] ?? "").replace(/^M?/, "M").replace(/^MM/, "M");
  const status = fm["status"];
  if (status !== "active") return { allowed: true, milestone };
  // Active plan — only allow from the sanctioned replan branch
  const replanRe = new RegExp(`^plan/${milestone.replace("M", "M")}-replan-\\d+$`);
  if (replanRe.test(currentBranch)) return { allowed: true, milestone };
  return {
    allowed: false,
    milestone,
    message: PLAN_FROZEN_MESSAGE(milestone),
  };
}

export interface PostFreezeEdit {
  milestone: string;
  path: string;
  sha: string;
  authorDate: string;
  frozenAt: string;
}

export async function findPostFreezeEdits(repoRoot: string): Promise<PostFreezeEdit[]> {
  const specsPlanDir = join(repoRoot, "specs", "plan");
  const out: PostFreezeEdit[] = [];
  let files: string[];
  try {
    files = readdirSync(specsPlanDir).filter((f) => f.endsWith(".md") && /^M\d+\.md$/.test(f));
  } catch {
    return out;
  }
  for (const file of files) {
    const full = join(specsPlanDir, file);
    let text: string;
    try {
      text = readFileSync(full, "utf-8");
    } catch {
      continue;
    }
    const fm = parsePlanFrontmatter(text);
    const frozen = fm["frozen_at"];
    if (fm["status"] !== "active" || !frozen) continue;
    const relPath = `specs/plan/${file}`;
    const commits = await gitLogAfter(repoRoot, relPath, frozen);
    for (const c of commits) {
      out.push({
        milestone: file.replace(/\.md$/, ""),
        path: relPath,
        sha: c.sha,
        authorDate: c.date,
        frozenAt: frozen,
      });
    }
  }
  return out;
}

async function gitLogAfter(
  repoRoot: string,
  relPath: string,
  afterIso: string,
): Promise<Array<{ sha: string; date: string }>> {
  const proc = Bun.spawnSync({
    cmd: ["git", "log", "--follow", `--after=${afterIso}`, "--format=%H|%aI", "--", relPath],
    cwd: repoRoot,
  });
  if (proc.exitCode !== 0) return [];
  const text = new TextDecoder().decode(proc.stdout).trim();
  if (text.length === 0) return [];
  return text.split("\n").map((line) => {
    const [sha, date] = line.split("|");
    return { sha: sha ?? "", date: date ?? "" };
  });
}
