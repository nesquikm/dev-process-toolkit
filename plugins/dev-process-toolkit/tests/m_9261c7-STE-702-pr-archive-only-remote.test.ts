// STE-702 — the pull request gate's archive-only pass grades the branch the
// pull request opens: the REMOTE branch must equal local HEAD, and EVERY
// distinct base the command's creations name must be archive-only.
//
// Every hook leg runs through the SHIPPED `pre-pr-spec-review.sh` wrapper
// (AC-STE-702.8), against temporary checkouts with a REAL `file://` bare
// remote, and a session transcript carrying NO spec-review Skill call — so a
// leg that is not archive-only must be refused for want of evidence.
//
// Mutation map (AC-STE-702.8) — which named test reds for each mutation:
//   * Remove the remote-head check →
//       "a remote head ahead of the local branch gets no pass" (AC.1), and every
//       AC-STE-702.3 FORBID leg (detached HEAD, missing remote branch,
//       different sha, failed ls-remote, branch.<b>.remote mismatch).
//   * Read the remote as always `origin` (ignore branch.<b>.remote) →
//       "AC-STE-702.3 FORBID — branch.<b>.remote names upstream, whose head differs" and
//       "AC-STE-702.3 PERMIT — branch.<b>.remote names upstream, whose head matches".
//   * Grade only one of several bases (the first OR the last) →
//       "two distinct bases are each graded" (AC.2 runs both orders).
//   * Drop the `bases` list from pr_target_repo.ts →
//       the "AC-STE-702.4 — pr_target_repo exposes every distinct base" unit cases.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePrTarget } from "../adapters/_shared/src/pr_target_repo";
import { applyArchiveMove, git, makeArchiveRepo, writeAt } from "./_archive_only_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const PR_WRAPPER = join(PLUGIN_ROOT, "templates", "hooks", "process", "pre-pr-spec-review.sh");
const SID = "s-9261c7-702";
const T = 60_000;

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "m-9261c7-702-"));
});
afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

// ------------------------------------------------------------------ harness

function bareTranscript(): string {
  const file = join(tmpRoot, "transcript.jsonl");
  writeFileSync(file, JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "ls" } }) + "\n");
  return file;
}

interface Run {
  exitCode: number;
  stderr: string;
}

async function runPr(repo: string, command: string): Promise<Run> {
  const payload = JSON.stringify({
    session_id: SID,
    transcript_path: bareTranscript(),
    cwd: repo,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  });
  const proc = Bun.spawn(["/bin/bash", PR_WRAPPER], {
    cwd: repo,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stderr };
}

function expectRefused(r: Run): void {
  expect({
    code: r.exitCode,
    refusing: r.stderr.includes("Refusing:"),
    skill: r.stderr.includes("spec-review"),
  }).toEqual({ code: 2, refusing: true, skill: true });
}

function expectPermitted(r: Run): void {
  expect({ code: r.exitCode, refusing: r.stderr.includes("Refusing:") }).toEqual({ code: 0, refusing: false });
}

const PR_FILL = "gh pr create --fill";
const BRANCH = "fix/x";

function makeBare(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "--bare", "-b", "main");
  return path;
}

/**
 * Clone O: a checkout with a real `file://` origin whose default branch is
 * `main` (origin/HEAD set from it), on branch `fix/x` holding ONE archive-only
 * commit. `push` decides whether `fix/x` is pushed (and tracked) to origin.
 */
function originRepo(name: string, push = true): { repo: string; bare: string } {
  const bare = makeBare(join(tmpRoot, `${name}.remote.git`));
  const repo = makeArchiveRepo(join(tmpRoot, name));
  git(repo, "remote", "add", "origin", `file://${bare}`);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "fetch", "-q", "origin");
  git(repo, "remote", "set-head", "origin", "main");
  git(repo, "checkout", "-q", "-b", BRANCH);
  applyArchiveMove(repo);
  git(repo, "commit", "-q", "-m", "chore(specs): archive FX-1");
  if (push) git(repo, "push", "-q", "-u", "origin", BRANCH);
  return { repo, bare };
}

/** Clone W of `bare`: checks out `branch`, commits a source file, pushes. */
function pushCodeFromOtherClone(bare: string, name: string, branch = BRANCH): void {
  const w = join(tmpRoot, name);
  const r = spawnSync("git", ["clone", "-q", `file://${bare}`, w], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`clone failed: ${r.stderr}`);
  git(w, "config", "user.name", "Fixture");
  git(w, "config", "user.email", "fixture@example.invalid");
  git(w, "config", "commit.gpgsign", "false");
  git(w, "checkout", "-q", branch);
  writeAt(w, "src/extra.ts", "export const extra = 1;\n");
  git(w, "add", "-A");
  git(w, "commit", "-q", "-m", "feat: code nobody reviewed");
  git(w, "push", "-q", "origin", branch);
}

// ------------------------------------------------------------ AC-STE-702.1

describe("AC-STE-702.1 — the remote branch, not the stale local one, is graded", () => {
  test(
    "a remote head ahead of the local branch gets no pass",
    async () => {
      const { repo, bare } = originRepo("o");
      pushCodeFromOtherClone(bare, "w");
      // O stays unfetched: its local fix/x is still archive-only.
      expectRefused(await runPr(repo, PR_FILL));
    },
    T,
  );

  test(
    "AC-STE-702.1 PERMIT CONTROL — the same clone with the remote head equal to HEAD → exit 0",
    async () => {
      const { repo } = originRepo("o-control");
      expectPermitted(await runPr(repo, PR_FILL));
    },
    T,
  );
});

// ------------------------------------------------------------ AC-STE-702.3

describe("AC-STE-702.3 — the pass requires `git ls-remote <remote> refs/heads/<branch>` to equal HEAD", () => {
  test(
    "AC-STE-702.3 FORBID — a detached HEAD (at the pushed sha) → refused",
    async () => {
      const { repo } = originRepo("detached");
      git(repo, "checkout", "-q", "--detach");
      expectRefused(await runPr(repo, PR_FILL));
    },
    T,
  );

  test(
    "AC-STE-702.3 FORBID — the branch is missing on the remote → refused",
    async () => {
      const { repo } = originRepo("missing", false);
      expectRefused(await runPr(repo, PR_FILL));
    },
    T,
  );

  test(
    "AC-STE-702.3 FORBID — the remote branch holds a different sha → refused",
    async () => {
      const { repo } = originRepo("different");
      // Still archive-only locally, but no longer the commit the remote holds.
      git(repo, "commit", "-q", "--amend", "-m", "chore(specs): archive FX-1 (reworded)");
      expectRefused(await runPr(repo, PR_FILL));
    },
    T,
  );

  test(
    "AC-STE-702.3 FORBID — `git ls-remote` fails (the remote URL does not resolve) → refused",
    async () => {
      const { repo } = originRepo("lsremote-fails");
      git(repo, "remote", "set-url", "origin", `file://${join(tmpRoot, "no-such-remote.git")}`);
      expectRefused(await runPr(repo, PR_FILL));
    },
    T,
  );

  /** origin holds fix/x == HEAD; `upstream` is the branch's configured remote. */
  function upstreamRepo(name: string): { repo: string; upstream: string } {
    const { repo } = originRepo(name);
    const upstream = makeBare(join(tmpRoot, `${name}.upstream.git`));
    git(repo, "remote", "add", "upstream", `file://${upstream}`);
    git(repo, "push", "-q", "upstream", "main");
    git(repo, "push", "-q", "-u", "upstream", BRANCH);
    expect(git(repo, "config", `branch.${BRANCH}.remote`).trim()).toBe("upstream");
    return { repo, upstream };
  }

  test(
    "AC-STE-702.3 FORBID — branch.<b>.remote names upstream, whose head differs → refused even though origin matches",
    async () => {
      const { repo, upstream } = upstreamRepo("upstream-diff");
      pushCodeFromOtherClone(upstream, "w-upstream");
      expectRefused(await runPr(repo, PR_FILL));
    },
    T,
  );

  test(
    "AC-STE-702.3 PERMIT — branch.<b>.remote names upstream, whose head matches → exit 0 even though origin lacks the branch",
    async () => {
      const { repo } = upstreamRepo("upstream-match");
      git(repo, "push", "-q", "origin", "--delete", BRANCH);
      expectPermitted(await runPr(repo, PR_FILL));
    },
    T,
  );
});

// ------------------------------------------------------------ AC-STE-702.2

/**
 * `release/1` forks from the initial commit; `main` then gains a code commit;
 * `release/2` sits at that `main` tip; `fix/x` branches from `main` with only
 * the archive move. Against `main` (the default) and `release/2` the branch is
 * archive-only; against `release/1` its diff carries main's code commit.
 */
function basesRepo(name: string): string {
  const bare = makeBare(join(tmpRoot, `${name}.remote.git`));
  const repo = makeArchiveRepo(join(tmpRoot, name));
  git(repo, "remote", "add", "origin", `file://${bare}`);
  git(repo, "branch", "release/1");
  writeAt(repo, "src/app.ts", "export const app = 3;\n");
  git(repo, "commit", "-q", "-am", "feat: main moves on");
  git(repo, "branch", "release/2");
  git(repo, "push", "-q", "origin", "main", "release/1", "release/2");
  git(repo, "fetch", "-q", "origin");
  git(repo, "remote", "set-head", "origin", "main");
  git(repo, "checkout", "-q", "-b", BRANCH);
  applyArchiveMove(repo);
  git(repo, "commit", "-q", "-m", "chore(specs): archive FX-1");
  git(repo, "push", "-q", "-u", "origin", BRANCH);
  return repo;
}

describe("AC-STE-702.2 / AC-STE-702.4 — every distinct base is graded", () => {
  test(
    "two distinct bases are each graded",
    async () => {
      const repo = basesRepo("two-bases");
      // Both orders: a gate grading only the first OR only the last base reds one.
      expectRefused(await runPr(repo, "gh pr create --base release/1 -t t -b b || gh pr create -t t -b b"));
      expectRefused(await runPr(repo, "gh pr create -t t -b b || gh pr create --base release/1 -t t -b b"));
    },
    T,
  );

  test(
    "AC-STE-702.4 PERMIT CONTROL — two distinct bases, both archive-only → exit 0",
    async () => {
      const repo = basesRepo("two-bases-ok");
      expectPermitted(await runPr(repo, "gh pr create --base release/2 -t t -b b || gh pr create -t t -b b"));
    },
    T,
  );

  test(
    "AC-STE-702.4 — one creation with one base behaves as today (release/1 refused, release/2 permitted)",
    async () => {
      const repo = basesRepo("one-base");
      expectRefused(await runPr(repo, "gh pr create --base release/1 -t t -b b"));
      expectPermitted(await runPr(repo, "gh pr create --base release/2 -t t -b b"));
    },
    T,
  );
});

// ------------------------------------------------- AC-STE-702.4 (unit, parser)

describe("AC-STE-702.4 — pr_target_repo exposes every distinct base (null = the default branch)", () => {
  const ROOT = "/fixture/root";
  const resolve = (command: string) =>
    resolvePrTarget(command, ROOT, () => ROOT, () => []) as ReturnType<typeof resolvePrTarget> & {
      bases?: (string | null)[];
    };
  const asSet = (xs: (string | null)[] | undefined) => new Set(xs ?? ["<no bases field>"]);

  test("two creations, one naming release/1 and one naming none → bases {release/1, null}", () => {
    const t = resolve("gh pr create --base release/1 -t t -b b || gh pr create -t t -b b");
    expect(t.isPr).toBe(true);
    expect(t.bases?.length).toBe(2);
    expect(asSet(t.bases)).toEqual(new Set(["release/1", null]));
  });

  test("two creations naming two different bases → bases {a, b}", () => {
    const t = resolve("gh pr create --base a -t t -b b || gh pr create -B b -t t -b b");
    expect(t.bases?.length).toBe(2);
    expect(asSet(t.bases)).toEqual(new Set(["a", "b"]));
  });

  test("two creations naming the same base → one distinct base, and `base` as today", () => {
    const t = resolve("gh pr create --base x -t t -b b && gh pr create --base=x -t t -b b");
    expect({ bases: t.bases, base: t.base }).toEqual({ bases: ["x"], base: "x" });
  });

  test("one creation with one base → bases [develop], base develop (as today)", () => {
    const t = resolve("gh pr create --base develop -t t -b b");
    expect({ bases: t.bases, base: t.base }).toEqual({ bases: ["develop"], base: "develop" });
  });

  test("one creation naming no base → bases [null], base null (the default branch)", () => {
    const t = resolve("gh pr create --fill");
    expect({ bases: t.bases, base: t.base }).toEqual({ bases: [null], base: null });
  });
});

// ------------------------------------------------------------ AC-STE-702.7

describe("AC-STE-702.7 — archived AC-STE-700.5 carries the STE-702 amendment and nothing else changes", () => {
  const PATH = "specs/frs/archive/STE-700.md";
  const CLAUSE_RE =
    / \*\(Amended by STE-702 \(v\d+\.\d+\.\d+\): the default branch is read from refs\/remotes\/origin\/HEAD, and the pass is withheld when that ref is absent\.\)\*/;

  test("the AC-STE-700.5 line ends with the amendment clause, naming a release version", () => {
    const now = readFileSync(join(REPO_ROOT, PATH), "utf-8");
    const line = now.split("\n").find((l) => l.startsWith("- AC-STE-700.5:")) ?? "";
    expect(line).toMatch(new RegExp(`${CLAUSE_RE.source}$`));
  });

  test("removing that one clause gives back the file byte-for-byte as of f915fc54", () => {
    const now = readFileSync(join(REPO_ROOT, PATH), "utf-8");
    const before = spawnSync("git", ["show", `f915fc54:${PATH}`], { cwd: REPO_ROOT, encoding: "utf-8" });
    expect(before.status).toBe(0);
    expect(CLAUSE_RE.test(now)).toBe(true);
    expect(now.replace(CLAUSE_RE, "")).toBe(before.stdout);
  });
});

// ------------------------------------------- hardening — the network call is bounded
//
// `git ls-remote` is the one call on the archive-only path that may leave the
// machine. A remote that accepts the connection and never answers must read as
// "no pass" within the bound, never hang the hook (Phase 3 review, round 1).
// Mutation control: drop the spawn `timeout` in lsRemoteOut and this test hangs
// until bun's own per-test timeout reds it.
describe("STE-702 hardening — a silent remote withholds the pass instead of hanging", () => {
  test("a remote that never answers → isRemoteHeadEqualToHead false within the bound", async () => {
    const { createServer } = await import("node:net");
    const { isRemoteHeadEqualToHead } = await import("../adapters/_shared/src/archive_only_change");
    const held: import("node:net").Socket[] = [];
    const server = createServer((s) => held.push(s));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const { repo } = originRepo("silent");
      git(repo, "remote", "set-url", "origin", `http://127.0.0.1:${port}/never.git`);
      const started = Date.now();
      const ok = isRemoteHeadEqualToHead(repo);
      const elapsed = Date.now() - started;
      expect({ ok, bounded: elapsed < 8_000 }).toEqual({ ok: false, bounded: true });
    } finally {
      for (const s of held) s.destroy();
      server.close();
    }
  }, 20_000);
});
