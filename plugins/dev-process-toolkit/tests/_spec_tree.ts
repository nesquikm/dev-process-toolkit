// Shared spec-tree resolution for suites that measure THIS repository's own
// FRs and plans.
//
// THE CLASS THIS MODULE EXISTS TO CLOSE — the archival blind spot. A milestone's
// FRs live in `specs/frs/` while it is open and in `specs/frs/archive/` the
// moment it ships. The archive commit is the one transition no gate run
// precedes: a suite that reaches its own FR through a hardcoded
// `specs/frs/<id>.md` is green on every run up to and including the ship, then
// throws ENOENT on the archive commit itself. This repository has been bitten
// four times, and each time by a NEW guard written after the previous fix.
//
// So the idiom lives here, once, and the suites import it:
//
//   resolveSpecFile()   — ONE named spec file, active tree then archive, with
//                         the path that resolved reported as `source`. The
//                         `"none"` sentinel is never a pass: a caller must
//                         assert on `source` so a silently-missing file cannot
//                         read as a clean run.
//   mdFilesIn()         — the `*.md` files directly in a directory.
//   boundToMilestone()  — frontmatter `milestone: M<N>` binding, which is how
//                         an archive fallback stays scoped to ONE milestone.
//
// WHY THE FALLBACK MUST BE MILESTONE-SCOPED. `specs/frs/archive/` holds every
// FR this repository has ever written — 440-plus of them, the overwhelming
// majority authored long before the word caps, altitude rules and block
// conventions that today's suites measure. Measured 2026-08-31: the whole
// archive carries 638 `word_cap` violations against a rule it predates. A
// fallback that stages the archive WHOLESALE therefore does not restore the
// subject a suite lost — it swaps in a different, far larger, pre-rule subject
// and reddens the tree with legitimate history.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Which tree supplied a spec subject. `"none"` is always a failure. */
export type SpecSource = "active" | "archive" | "none";

export interface ResolvedSpecFile {
  /** Absolute path, or `""` when nothing resolved. */
  abs: string;
  /** Repo-root-relative POSIX path, or `""` when nothing resolved. */
  rel: string;
  source: SpecSource;
}

/** `*.md` files directly in `dir` (non-recursive), absolute, sorted. */
export function mdFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** True iff the file's frontmatter binds it to `milestone: <milestone>`. */
export function boundToMilestone(abs: string, milestone: string): boolean {
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return false;
  }
  return new RegExp(`^milestone:\\s*${milestone}\\s*$`, "m").test(content);
}

/**
 * Resolve ONE named spec file through the active tree, then the archive.
 *
 * `dir` is the repo-root-relative directory holding the ACTIVE copies, POSIX
 * separators — `"specs/frs"` or `"specs/plan"`. The archive is always its
 * `archive/` child, which is where `/implement` Phase 4 and `/spec-archive`
 * `git mv` the file when its milestone ships.
 *
 * Active wins, so an open milestone is graded on its working copy. Neither
 * path existing returns `source: "none"` with empty paths rather than throwing,
 * so the caller can assert the sentinel and fail with its own message.
 */
export function resolveSpecFile(
  repoRoot: string,
  dir: string,
  name: string,
): ResolvedSpecFile {
  const segments = dir.split("/");
  const active = join(repoRoot, ...segments, name);
  if (existsSync(active)) {
    return { abs: active, rel: `${dir}/${name}`, source: "active" };
  }
  const archived = join(repoRoot, ...segments, "archive", name);
  if (existsSync(archived)) {
    return { abs: archived, rel: `${dir}/archive/${name}`, source: "archive" };
  }
  return { abs: "", rel: "", source: "none" };
}

/**
 * Read ONE named spec file through the active-then-archive lookup, returning
 * the body alongside the path that supplied it.
 *
 * Throws on `"none"`. A missing FR is a broken subject, and the suites that
 * call this assert ON its body — a silent `""` would let every one of those
 * assertions pass while measuring nothing.
 */
export function readSpecFile(
  repoRoot: string,
  dir: string,
  name: string,
): { body: string; rel: string; source: SpecSource } {
  const found = resolveSpecFile(repoRoot, dir, name);
  if (found.source === "none") {
    throw new Error(
      `${dir}/${name} resolves in neither the active tree nor ${dir}/archive/ — ` +
        "the subject is missing, which is a failure and never a clean run",
    );
  }
  return { body: readFileSync(found.abs, "utf-8"), rel: found.rel, source: found.source };
}

/**
 * The files in `dir` bound to `milestone`, active tree first and the archive
 * only when the active tree holds none of them.
 *
 * This is the MILESTONE-SCOPED fallback: the archive is consulted for THIS
 * milestone's files alone, never wholesale.
 */
export function milestoneSpecFiles(
  repoRoot: string,
  dir: string,
  milestone: string,
): { files: string[]; source: SpecSource } {
  const segments = dir.split("/");
  const active = mdFilesIn(join(repoRoot, ...segments)).filter((abs) =>
    boundToMilestone(abs, milestone),
  );
  if (active.length > 0) return { files: active, source: "active" };

  const archived = mdFilesIn(join(repoRoot, ...segments, "archive")).filter((abs) =>
    boundToMilestone(abs, milestone),
  );
  if (archived.length > 0) return { files: archived, source: "archive" };

  return { files: [], source: "none" };
}
