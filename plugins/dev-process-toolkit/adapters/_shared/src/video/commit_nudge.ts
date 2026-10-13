// STE-673 — offer to commit the house video style and tooling.
//
// AC-STE-673.1: `listUncommittedVideoTooling` reads
// `git status --porcelain=v1 -z --untracked-files=all` output and returns the
// sorted paths under `.dpt/video/` that are untracked, modified, renamed (new
// path) or deleted. `.dpt/video/work/**` (render scratch), `.dpt/.env` and
// every path outside `.dpt/video/` are never listed.

import { sep } from "node:path";
import { videoRoot, videoWorkRoot } from "../dpt_paths";

/** A dpt_paths helper's repo-relative path in git's `/`-separated form, with a trailing `/`. */
function gitPrefix(compose: (projectRoot: string) => string): string {
  return `${compose("").split(sep).join("/")}/`;
}

const VIDEO_PREFIX = gitPrefix(videoRoot);
const WORK_PREFIX = gitPrefix(videoWorkRoot);

/** A repo-relative path is video tooling: under `.dpt/video/`, outside `.dpt/video/work/`. */
export function isVideoToolingPath(path: string): boolean {
  return path.startsWith(VIDEO_PREFIX) && !path.startsWith(WORK_PREFIX);
}

export function listUncommittedVideoTooling(porcelain: string): string[] {
  const entries = porcelain.split("\0");
  const paths = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename or copy carries its original path as the next NUL-terminated entry.
    if (xy.includes("R") || xy.includes("C")) i++;
    if (!isVideoToolingPath(path)) continue;
    paths.add(path);
  }
  return [...paths].sort();
}
