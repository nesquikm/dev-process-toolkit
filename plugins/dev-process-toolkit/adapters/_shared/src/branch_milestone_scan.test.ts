// STE-338 AC-STE-338.1 / .2 / .3 — scanBranchMilestones.
//
// Cross-branch milestone-number scan. Enumerates git refs (local heads
// always, plus remote-tracking refs by default), runs `git ls-tree` per ref
// over `specs/plan/`, and extracts the `M<N>` number from any path matching
// `(?:^|/)M\d+\.md$` (catches both `specs/plan/M<N>.md` and
// `specs/plan/archive/M<N>.md`). Returns a deduped, ascending `number[]`.
//
// Behavior under test:
//   - union across local branches `a` (M40) and `b` (M41)
//   - remote-tracking ref unioned in by default (includeRemotes !== false)
//   - no-fetch default does NOT see a milestone that lives only on a bare
//     remote not yet fetched into remote-tracking refs (proves no git fetch)
//   - opts.fetch === true DOES pick it up after the fetch
//   - archive-path plan files are caught by the same scan
//   - a non-repo directory degrades to [] and never throws

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanBranchMilestones } from "./branch_milestone_scan";

function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd });
  if (proc.exitCode !== 0) {
    const err = new TextDecoder().decode(proc.stderr);
    throw new Error(`git ${args.join(" ")} failed (exit ${proc.exitCode}): ${err}`);
  }
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  // Initial commit so we have a base to branch from.
  mkdirSync(join(dir, "specs", "plan"), { recursive: true });
  writeFileSync(join(dir, ".gitkeep"), "");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
}

/** Commit a plan file at `relPath` (relative to repo root) on branch `branch`. */
function commitPlanFileOnBranch(dir: string, branch: string, relPath: string): void {
  git(dir, "checkout", "-q", "-b", branch);
  const abs = join(dir, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "---\nmilestone: x\n---\n");
  git(dir, "add", relPath);
  git(dir, "commit", "-q", "-m", `add ${relPath}`);
  git(dir, "checkout", "-q", "main");
}

let work: string;
const toClean: string[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "branch-milestone-scan-"));
  toClean.push(work);
  initRepo(work);
});
afterEach(() => {
  while (toClean.length) {
    const d = toClean.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

describe("scanBranchMilestones — local branch union (AC-STE-338.1)", () => {
  test("M40 on branch a and M41 on branch b → union [40, 41]", async () => {
    commitPlanFileOnBranch(work, "a", join("specs", "plan", "M40.md"));
    commitPlanFileOnBranch(work, "b", join("specs", "plan", "M41.md"));
    const got = await scanBranchMilestones(work);
    expect(got).toContain(40);
    expect(got).toContain(41);
  });

  test("result is deduped and sorted ascending", async () => {
    // M50 lives on two branches; M40 and M41 on one each.
    commitPlanFileOnBranch(work, "a", join("specs", "plan", "M40.md"));
    commitPlanFileOnBranch(work, "b", join("specs", "plan", "M50.md"));
    commitPlanFileOnBranch(work, "c", join("specs", "plan", "M50.md"));
    commitPlanFileOnBranch(work, "d", join("specs", "plan", "M41.md"));
    const got = await scanBranchMilestones(work);
    expect(got).toEqual([40, 41, 50]);
  });

  test("archive-path plan files (specs/plan/archive/M<N>.md) are caught too", async () => {
    commitPlanFileOnBranch(work, "arch", join("specs", "plan", "archive", "M77.md"));
    const got = await scanBranchMilestones(work);
    expect(got).toContain(77);
  });
});

describe("scanBranchMilestones — remote-tracking refs (AC-STE-338.1)", () => {
  test("a remote-tracking ref carrying a plan file is unioned in by default", async () => {
    // Build a bare remote, push a branch with M60 to it, fetch so the ref
    // becomes a remote-tracking ref, then delete the local branch.
    const remote = mkdtempSync(join(tmpdir(), "branch-milestone-remote-"));
    rmSync(remote, { recursive: true, force: true });
    toClean.push(remote);
    git(work, "init", "--bare", "-q", remote);
    git(work, "remote", "add", "origin", remote);
    commitPlanFileOnBranch(work, "remote-feat", join("specs", "plan", "M60.md"));
    git(work, "push", "-q", "origin", "remote-feat");
    git(work, "fetch", "-q", "origin");
    git(work, "branch", "-q", "-D", "remote-feat");
    const got = await scanBranchMilestones(work);
    expect(got).toContain(60);
  });

  test("includeRemotes: false skips remote-tracking refs", async () => {
    const remote = mkdtempSync(join(tmpdir(), "branch-milestone-remote-skip-"));
    rmSync(remote, { recursive: true, force: true });
    toClean.push(remote);
    git(work, "init", "--bare", "-q", remote);
    git(work, "remote", "add", "origin", remote);
    commitPlanFileOnBranch(work, "remote-only", join("specs", "plan", "M61.md"));
    git(work, "push", "-q", "origin", "remote-only");
    git(work, "fetch", "-q", "origin");
    git(work, "branch", "-q", "-D", "remote-only");
    const got = await scanBranchMilestones(work, { includeRemotes: false });
    // The milestone lives only on the remote-tracking ref now; skipping
    // remotes means it must NOT appear.
    expect(got).not.toContain(61);
  });

  test("a remote default-HEAD ref (refs/remotes/origin/HEAD) does not error or double-count (AC-STE-338.1)", async () => {
    // A clone always has refs/remotes/origin/HEAD (a symbolic ref to the
    // remote's default branch). `%(refname:short)` collapses it to the bare
    // remote name `origin`, which resolves to that branch — the scan must
    // tolerate it: the milestone appears exactly once (deduped), never errors.
    const remote = mkdtempSync(join(tmpdir(), "branch-milestone-head-"));
    rmSync(remote, { recursive: true, force: true });
    toClean.push(remote);
    git(work, "init", "--bare", "-q", remote);
    git(work, "remote", "add", "origin", remote);
    commitPlanFileOnBranch(work, "feat-head", join("specs", "plan", "M64.md"));
    git(work, "push", "-q", "origin", "feat-head");
    git(work, "fetch", "-q", "origin");
    git(work, "remote", "set-head", "origin", "feat-head"); // creates refs/remotes/origin/HEAD
    const got = await scanBranchMilestones(work);
    // M64 is reachable via the local branch, origin/feat-head, AND the
    // origin default-HEAD alias — but the deduping Set yields it exactly once.
    expect(got.filter((n) => n === 64)).toEqual([64]);
  });
});

describe("scanBranchMilestones — fetch policy (AC-STE-338.2)", () => {
  test("no-fetch default does NOT pick up a milestone only on a bare remote (no git fetch fired)", async () => {
    // Push M62 to a bare remote, then REMOVE the remote-tracking ref so the
    // milestone exists only on the bare remote (not in any local ref). With
    // the no-fetch default, scanBranchMilestones must not network-fetch, so
    // M62 stays invisible.
    const remote = mkdtempSync(join(tmpdir(), "branch-milestone-nofetch-"));
    rmSync(remote, { recursive: true, force: true });
    toClean.push(remote);
    git(work, "init", "--bare", "-q", remote);
    git(work, "remote", "add", "origin", remote);
    commitPlanFileOnBranch(work, "future", join("specs", "plan", "M62.md"));
    git(work, "push", "-q", "origin", "future");
    git(work, "branch", "-q", "-D", "future");
    // `git push` itself creates the local remote-tracking ref
    // refs/remotes/origin/future, so delete it — now M62 lives ONLY on the
    // bare remote, reachable only via a network `git fetch`. With the
    // no-fetch default the scanner must not network, so M62 stays invisible.
    git(work, "update-ref", "-d", "refs/remotes/origin/future");
    const got = await scanBranchMilestones(work);
    expect(got).not.toContain(62);
  });

  test("opts.fetch === true against a local bare remote DOES pick it up after fetch", async () => {
    const remote = mkdtempSync(join(tmpdir(), "branch-milestone-fetch-"));
    rmSync(remote, { recursive: true, force: true });
    toClean.push(remote);
    git(work, "init", "--bare", "-q", remote);
    git(work, "remote", "add", "origin", remote);
    commitPlanFileOnBranch(work, "future", join("specs", "plan", "M63.md"));
    git(work, "push", "-q", "origin", "future");
    git(work, "branch", "-q", "-D", "future");
    // Drop the push-created remote-tracking ref so M63 lives ONLY on the bare
    // remote. Without fetch it would be invisible; with fetch:true the scanner
    // runs `git fetch --all` first, re-creating origin/future, so M63 appears.
    git(work, "update-ref", "-d", "refs/remotes/origin/future");
    const got = await scanBranchMilestones(work, { fetch: true });
    expect(got).toContain(63);
  });
});

describe("scanBranchMilestones — fail-soft (AC-STE-338.3)", () => {
  test("a non-repo directory degrades to [] and never throws", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "branch-milestone-non-repo-"));
    toClean.push(notARepo);
    const got = await scanBranchMilestones(notARepo);
    expect(got).toEqual([]);
  });

  test("a path that does not exist degrades to [] and never throws", async () => {
    const got = await scanBranchMilestones("/nonexistent/repo/path/xyz");
    expect(got).toEqual([]);
  });
});

describe("scanBranchMilestones — M_<epic-key> tolerance (AC-STE-376.3)", () => {
  test("an epic-keyed plan file on a branch is accepted without error and excluded from the numeric set", async () => {
    commitPlanFileOnBranch(work, "epic", join("specs", "plan", "M_PROJ_500.md"));
    commitPlanFileOnBranch(work, "a", join("specs", "plan", "M40.md"));
    const got = await scanBranchMilestones(work);
    // The opaque epic id contributes NO integer — never NaN, never 500.
    expect(got).toEqual([40]);
  });

  test("an archived epic-keyed plan file is likewise excluded from the numeric set", async () => {
    commitPlanFileOnBranch(work, "epic-arch", join("specs", "plan", "archive", "M_PROJ_500.md"));
    const got = await scanBranchMilestones(work);
    expect(got).toEqual([]);
  });
});
