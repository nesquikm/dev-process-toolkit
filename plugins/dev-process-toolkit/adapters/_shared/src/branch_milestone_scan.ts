// STE-338 AC-STE-338.1 — scanBranchMilestones.
//
// Cross-branch milestone-number scan. Enumerates git refs (local heads always,
// plus remote-tracking refs by default), runs `git ls-tree` per ref over
// `specs/plan/`, and extracts the `M<N>` number from any path matching
// `(?:^|/)M(\d+)\.md$` (catches both `specs/plan/M<N>.md` and
// `specs/plan/archive/M<N>.md`). Returns a deduped, ascending `number[]`.
//
// Follows the git-plumbing house style in local_provider.ts: a private
// safeGit helper built on Bun.spawnSync that returns trimmed stdout on exit 0
// and "" otherwise (swallowing all errors), so a non-repo / missing path
// degrades to [] rather than throwing.

export interface BranchScanOpts {
  includeRemotes?: boolean;
  fetch?: boolean;
}

import { NUMERIC_MILESTONE_NUMBER_SOURCE } from "./milestone_token";

const PLAN_FILE_RE = new RegExp(String.raw`(?:^|/)${NUMERIC_MILESTONE_NUMBER_SOURCE}\.md$`);

function safeGit(repoRoot: string, ...args: string[]): string {
  try {
    const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd: repoRoot });
    if (proc.exitCode !== 0) return "";
    return new TextDecoder().decode(proc.stdout).trim();
  } catch {
    return "";
  }
}

function enumerateRefs(repoRoot: string, includeRemotes: boolean): string[] {
  const specs = ["refs/heads"];
  if (includeRemotes) specs.push("refs/remotes");
  const out = safeGit(repoRoot, "for-each-ref", "--format=%(refname:short)", ...specs);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((ref) => !ref.endsWith("/HEAD"));
}

export async function scanBranchMilestones(repoRoot: string, opts?: BranchScanOpts): Promise<number[]> {
  // AC-STE-338.3 — Best-effort / non-load-bearing. EVERY git interaction below
  // already funnels through safeGit (non-zero exit ⇒ "", spawn throw ⇒ caught
  // ⇒ ""), so the enumerated failure modes — not a repo, git binary absent,
  // shallow clone, detached HEAD, ls-tree / for-each-ref errors — each degrade
  // to []. The outer try/catch is a belt-and-suspenders top-level safeguard: any
  // unexpected throw (now or from future edits) returns [] rather than
  // propagating, matching the fail-soft posture of the CHANGELOG leg in
  // next_free_milestone_number.ts. The scan must never block allocation.
  try {
    const includeRemotes = opts?.includeRemotes !== false;

    // Opt-in network refresh. The default (opts.fetch falsy) performs NO network
    // call and scans only refs already present. With opts.fetch === true, run a
    // best-effort `git fetch --all` first; safeGit swallows non-zero exits (and
    // the try/catch swallows spawn failures), so an offline / no-remote / timeout
    // fetch failure is naturally ignored and the scan proceeds against local refs.
    if (opts?.fetch === true) {
      safeGit(repoRoot, "fetch", "--all", "--quiet");
    }

    const refs = enumerateRefs(repoRoot, includeRemotes);

    const found = new Set<number>();
    for (const ref of refs) {
      const tree = safeGit(repoRoot, "ls-tree", "-r", "--name-only", ref, "--", "specs/plan/");
      if (tree.length === 0) continue;
      for (const line of tree.split("\n")) {
        const m = PLAN_FILE_RE.exec(line.trim());
        if (m) found.add(Number(m[1]));
      }
    }

    return [...found].sort((a, b) => a - b);
  } catch {
    return [];
  }
}
