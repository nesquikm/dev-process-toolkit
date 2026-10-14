// STE-673 — the front door for the house-video commit nudge.
//
// AC-STE-673.2: `bun run video_commit_nudge.ts <projectRoot>` prints
// `nothing to commit` or one uncommitted video-tooling path per line, exits 0,
// and writes nothing (`--no-optional-locks` keeps `git status` from refreshing
// the index).
//
// AC-STE-673.3: with `--commit` it stages exactly the listed paths (deletions
// included) by explicit literal pathspecs and creates one commit with
// subject `chore(video): commit the house style and tooling`. It never pushes
// and runs no remote command.

import { resolve } from "node:path";
import { isVideoToolingPath, listUncommittedVideoTooling } from "./video/commit_nudge";

/** Run `git <args>` in `projectRoot`; return stdout, or throw naming the subcommand. */
function git(projectRoot: string, args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) {
    const sub = args.find((a) => !a.startsWith("-")) ?? args[0];
    throw new Error(`git ${sub} failed (exit ${p.exitCode}): ${p.stderr.toString()}`);
  }
  return p.stdout.toString();
}

/** The uncommitted video-tooling paths of the repository at `projectRoot`. */
export function uncommittedVideoTooling(projectRoot: string): string[] {
  return listUncommittedVideoTooling(
    git(projectRoot, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  );
}

export const VIDEO_COMMIT_SUBJECT = "chore(video): commit the house style and tooling";

/**
 * Stage exactly `paths` (deletions included) and create one commit. Never pushes.
 * When the commit fails (a refusing hook, no identity), the paths this call
 * staged are unstaged again, so a retry does not refuse on its own leftovers.
 */
export function commitVideoTooling(projectRoot: string, paths: string[]): void {
  const pathspecs = paths.map((p) => `:(literal)${p}`);
  const stagedBefore = new Set(stagedPaths(projectRoot));
  git(projectRoot, ["add", "--all", "--", ...pathspecs]);
  try {
    git(projectRoot, ["commit", "--quiet", "-m", VIDEO_COMMIT_SUBJECT]);
  } catch (err) {
    const added = paths.filter((p) => !stagedBefore.has(p)).map((p) => `:(literal)${p}`);
    if (added.length > 0) git(projectRoot, ["restore", "--staged", "--", ...added]);
    throw err;
  }
}

/** Paths already staged in the index (read-only; never refreshes the index). */
export function stagedPaths(projectRoot: string): string[] {
  return git(projectRoot, ["--no-optional-locks", "diff", "--cached", "--name-only", "--no-renames", "-z"])
    .split("\0")
    .filter((s) => s.length > 0);
}

/**
 * AC-STE-673.4: staged paths outside `paths` (the commit would sweep them in). A
 * staged video-tooling path is never outside: a `git mv` inside `.dpt/video/`
 * lists only its new path, while its staged deletion of the old one belongs to
 * the same commit.
 */
export function stagedOutsideList(projectRoot: string, paths: string[]): string[] {
  const listed = new Set(paths);
  return stagedPaths(projectRoot).filter((s) => !listed.has(s) && !isVideoToolingPath(s));
}

function main(projectRoot: string, commit: boolean): void {
  const paths = uncommittedVideoTooling(projectRoot);
  if (paths.length === 0) {
    console.log("nothing to commit");
  } else if (commit) {
    const outside = stagedOutsideList(projectRoot, paths);
    if (outside.length > 0) {
      console.error(
        [
          "Refusing: the index already holds staged changes outside the video-tooling list; committing would include them.",
          "Remedy: unstage them (git restore --staged -- <path>) or commit them separately, then re-run with --commit.",
          `Context: ${projectRoot}; staged outside the list:`,
          ...outside,
        ].join("\n"),
      );
      process.exit(1);
    }
    commitVideoTooling(projectRoot, paths);
    console.log(`committed ${paths.length} path(s): ${VIDEO_COMMIT_SUBJECT}\n${paths.join("\n")}`);
  } else {
    console.log(paths.join("\n"));
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => !a.startsWith("--"));
  const projectRoot = resolve(rootArg ?? process.cwd());
  try {
    main(projectRoot, args.includes("--commit"));
  } catch (err) {
    console.error(
      [
        `Refusing: ${(err as Error).message.trim()}`,
        "Remedy: run it from the root of a git checkout with a commit identity set; fix what git reported above, then re-run.",
        `Context: ${projectRoot}; mode=video-commit-nudge`,
      ].join("\n"),
    );
    process.exit(1);
  }
}
