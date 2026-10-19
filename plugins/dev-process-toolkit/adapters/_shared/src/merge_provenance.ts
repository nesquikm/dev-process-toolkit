// STE-676 — merge provenance for the pre-commit /tdd guard.
//
// During a merge, the staged set holds files the incoming side already shipped.
// A tdd-required staged path whose index entry equals that path at a commit
// listed in MERGE_HEAD (octopus heads included), or at REBASE_HEAD during a
// rebase stop, is WAIVED: the commit grades
// only what the merge itself changed. Every git failure, and any head that does
// not resolve to a commit, gives NO waiver — the reader fails closed.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface WaivedPath {
  path: string;
  /** Full sha of the head commit, or of git's merge-result tree, holding the staged bytes. */
  head: string;
}

/** `git <args>` in `cwd`: its exit code and stdout, or `null` when it could not be run. */
async function gitRun(args: string[], cwd: string): Promise<{ code: number; out: string } | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    return { code: await proc.exited, out };
  } catch {
    return null;
  }
}

/** `git <args>` in `cwd`; null on a spawn failure or a non-zero exit. */
async function git(args: string[], cwd: string): Promise<string | null> {
  const r = await gitRun(args, cwd);
  return r !== null && r.code === 0 ? r.out : null;
}

/** A `git rev-parse --git-path` line, made absolute against `repoRoot`. */
function absoluteGitPath(repoRoot: string, line: string): string {
  const p = line.trim();
  return isAbsolute(p) ? p : join(repoRoot, p);
}

/**
 * `git rev-parse --git-path` for every name in ONE spawn, each made absolute;
 * null on a git failure. One call, because the hook pays for it on every
 * tdd-required commit, merge or not.
 */
async function gitPaths<N extends string>(repoRoot: string, names: readonly N[]): Promise<Record<N, string> | null> {
  const out = await git(["rev-parse", ...names.flatMap((n) => ["--git-path", n])], repoRoot);
  if (out === null) return null;
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== names.length) return null;
  return Object.fromEntries(names.map((n, i) => [n, absoluteGitPath(repoRoot, lines[i]!)])) as Record<N, string>;
}

/** The staged paths that differ from `rev` (a commit or a tree); null on a git failure. */
async function stagedDiffersFrom(repoRoot: string, rev: string): Promise<Set<string> | null> {
  const out = await git(["diff", "--cached", "--name-only", "--no-renames", "-z", rev], repoRoot);
  return out === null ? null : new Set(out.split("\0").filter(Boolean));
}

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The heads listed in the git-dir `file`, each resolved to a full commit sha.
 * `[]` when the file is absent, and `null` when the waiver must be disabled: a
 * line that is not a full sha (git writes nothing else there), one that does
 * not resolve with `^{commit}`, one that is HEAD or an ancestor of it (no
 * merge brings in history HEAD already has, so accepting one would waive any
 * old version of a test, deletions included), or a git call that failed.
 */
async function headsIn(repoRoot: string, file: string): Promise<string[] | null> {
  if (!existsSync(file)) return [];
  let body: string;
  try {
    body = readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  const heads: string[] = [];
  for (const line of body.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!SHA_RE.test(line)) return null;
    const out = await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${line}^{commit}`], repoRoot);
    if (out === null || out.trim() === "") return null;
    const ancestor = await gitRun(["merge-base", "--is-ancestor", out.trim(), "HEAD"], repoRoot);
    if (ancestor === null || ancestor.code !== 1) return null;
    heads.push(out.trim());
  }
  return heads;
}

/** What is in progress: the heads to compare against, and where git's own result lives. */
interface MergeState {
  heads: string[];
  /** True for a rebase stop, whose one head is the commit being replayed. */
  rebase: boolean;
  autoMergeFile: string;
}

/**
 * The in-progress merge heads (MERGE_HEAD), else — during a rebase stop, i.e.
 * REBASE_HEAD present AND a `rebase-merge` / `rebase-apply` directory under the
 * git dir (AC-STE-676.5) — the commit being replayed. `heads: []` when neither
 * is in progress, `null` when the waiver must be disabled.
 */
async function mergeState(repoRoot: string): Promise<MergeState | null> {
  const p = await gitPaths(repoRoot, ["MERGE_HEAD", "rebase-merge", "rebase-apply", "REBASE_HEAD", "AUTO_MERGE"]);
  if (p === null) return null;
  const merge = await headsIn(repoRoot, p.MERGE_HEAD);
  if (merge === null) return null;
  if (merge.length > 0) return { heads: merge, rebase: false, autoMergeFile: p.AUTO_MERGE };
  if (!existsSync(p["rebase-merge"]) && !existsSync(p["rebase-apply"])) {
    return { heads: [], rebase: false, autoMergeFile: p.AUTO_MERGE };
  }
  const replayed = await headsIn(repoRoot, p.REBASE_HEAD);
  return replayed === null ? null : { heads: replayed, rebase: true, autoMergeFile: p.AUTO_MERGE };
}

/**
 * Git's own merge result, as a tree sha: the `AUTO_MERGE` ref when git wrote
 * one, else `git merge-tree --write-tree HEAD <head>` for a two-parent merge —
 * merged against the replayed commit's parent during a rebase, which is the
 * base git itself uses for a pick, so no other commit's hunks can leak in.
 * `"none"` when git has no single result to offer — an octopus fallback, or a
 * merge-tree that reports a conflict (exit 1). `"failed"` on any git failure,
 * which disables the waiver for the whole commit (AC-STE-676.6). The fallback
 * needs git 2.38 or later (2.40 for `--merge-base` during a rebase); older
 * git fails here and the waiver is off.
 */
async function mergeResultTree(repoRoot: string, state: MergeState): Promise<string | "none" | "failed"> {
  if (existsSync(state.autoMergeFile)) {
    const out = await git(["rev-parse", "--verify", "--quiet", "AUTO_MERGE^{tree}"], repoRoot);
    return out === null || out.trim() === "" ? "failed" : out.trim();
  }
  if (state.heads.length !== 1) return "none";
  const head = state.heads[0]!;
  const base = state.rebase ? [`--merge-base=${head}^`] : [];
  // merge-tree writes the result's objects into the object store; they are
  // unreferenced and harmless, and gc collects them.
  const r = await gitRun(["merge-tree", "--write-tree", ...base, "HEAD", head], repoRoot);
  if (r === null || (r.code !== 0 && r.code !== 1)) return "failed";
  if (r.code === 1) return "none";
  const tree = r.out.split("\n")[0]?.trim() ?? "";
  return SHA_RE.test(tree) ? tree : "failed";
}

/**
 * The subset of `paths` whose staged entry equals that path at some merge head,
 * or git's merge result, each paired with what it matched. One `git diff --cached`
 * per head, plus one against the merge result tree when paths remain unmatched.
 */
export async function waivedMergePaths(repoRoot: string, paths: string[]): Promise<WaivedPath[]> {
  if (paths.length === 0) return [];
  const state = await mergeState(repoRoot);
  if (state === null || state.heads.length === 0) return [];
  const heads = state.heads;
  const matched = new Map<string, string>();
  const claim = (rev: string, differs: Set<string>): void => {
    for (const p of paths) {
      if (!matched.has(p) && !differs.has(p)) matched.set(p, rev);
    }
  };
  for (const head of heads) {
    const differs = await stagedDiffersFrom(repoRoot, head);
    if (differs === null) return [];
    claim(head, differs);
  }
  // AC-STE-676.2 — a path git merged on its own equals the merge result tree.
  if (paths.some((p) => !matched.has(p))) {
    const tree = await mergeResultTree(repoRoot, state);
    if (tree === "failed") return [];
    if (tree !== "none") {
      const differs = await stagedDiffersFrom(repoRoot, tree);
      if (differs === null) return [];
      claim(tree, differs);
    }
  }
  return paths.filter((p) => matched.has(p)).map((p) => ({ path: p, head: matched.get(p)! }));
}

/**
 * AC-STE-676.8 — the in-progress operation the waiver does NOT cover: a
 * `git merge --squash` (SQUASH_MSG), a stopped cherry-pick (CHERRY_PICK_HEAD)
 * or a stopped revert (REVERT_HEAD). One `git rev-parse --git-path` spawn;
 * null when none is in progress or git failed (the refusal then stays as today).
 */
export async function uncoveredOperation(
  repoRoot: string,
): Promise<"squash" | "cherry-pick" | "revert" | null> {
  const markers = [
    ["SQUASH_MSG", "squash"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ] as const;
  const out = await git(["rev-parse", ...markers.flatMap(([name]) => ["--git-path", name])], repoRoot);
  if (out === null) return null;
  const files = out.split("\n").filter((l) => l.trim() !== "");
  if (files.length !== markers.length) return null;
  const i = files.findIndex((f) => existsSync(absoluteGitPath(repoRoot, f)));
  return i === -1 ? null : markers[i]![1];
}
