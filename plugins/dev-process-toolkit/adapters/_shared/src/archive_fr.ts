// archive_fr — STE-210 AC-STE-210.3 helper.
//
// Two-export shape:
//
//   `flipArchivedFrontmatter(archivePath, archivedAt)` — pure
//     frontmatter-rewrite primitive (rewrites in place; no git
//     operations). Callers that already shell out to `git mv` and
//     `git add` (the canonical Phase 4 prose path) use this primitive
//     between the two invocations.
//
//   `archiveFRWithFlip(repoRoot, frPath, archivedAt) → archivePath` —
//     spec-named single-call wrapper (AC-STE-210.3 names the helper
//     and signature explicitly). Computes the archive path from
//     `repoRoot + frPath`, performs the in-place frontmatter flip,
//     and returns the archive path. The wrapper does NOT invoke git
//     itself (the toolkit shells `git mv` / `git add` from skill
//     prose via the Bash tool); it's the callable handle that owns
//     the post-mv frontmatter rewrite step. Callers thread the return
//     value into `git add`.
//
// The order matters: editing frontmatter BEFORE `git mv` stages the
// rename with the un-flipped index content (the F11 staging-order bug
// from the 2026-05-04 Flutter-app smoke). The helper is the canonical
// single-call replacement for the three-step prose; Phase 4 prose may
// continue to call the primitives directly (the helper is opt-in
// convenience, not a hard refactor).
//
// Idempotency: re-running on an already-archived FR is a no-op:
//   1. `git mv` of an already-archived file at the same path is a no-op.
//   2. Frontmatter edit at the archive path: when the file already
//      shows `status: archived` + `archived_at:` populated, the edit
//      produces identical content (no diff).
//   3. `git add` of unchanged content is a no-op.
//
// The helper does NOT call git itself (Bun lacks a built-in git client
// and the toolkit shells out via the Bash tool from skill prose). It
// performs the frontmatter rewrite at the new path; the caller threads
// it between the two git invocations.

import { readFile, writeFile } from "node:fs/promises";
import { hasBom, joinFrontmatter, splitFrontmatter } from "./frontmatter";
import { join, dirname, basename } from "node:path";

export interface ArchiveFlipResult {
  /** True when the file's frontmatter already showed `status: archived`. */
  alreadyArchived: boolean;
  /** Final ISO-8601 timestamp written to `archived_at:`. */
  archivedAt: string;
}

/**
 * Flip an archived FR's frontmatter to `status: archived` +
 * `archived_at: <archivedAt>`. Idempotent: re-running on an
 * already-flipped file produces byte-identical content.
 *
 * Pass the **already-moved** path (i.e., `specs/frs/archive/<name>.md`)
 * — the helper does not perform the `git mv` itself. Frontmatter
 * synthesis: when the file lacks a `---` block at the very top, the
 * helper prepends `---\nstatus: archived\narchived_at: <ts>\n---\n\n`
 * (per STE-197 AC-STE-197.4 — backwards-compat for legacy
 * `/setup`-generated plans / FRs without frontmatter). Other callers
 * that already require frontmatter (the standard FR archival path)
 * never hit the synthesis branch.
 */
export async function flipArchivedFrontmatter(
  archivePath: string,
  archivedAt: string,
): Promise<ArchiveFlipResult> {
  const original = await readFile(archivePath, "utf-8");
  // `splitFrontmatter` tolerates CRLF / lone-CR / BOM and carries the body
  // through VERBATIM. Two things depend on that. Without CRLF tolerance a
  // Windows-authored file fails the opener check and takes the synthesis
  // branch below, prepending a SECOND frontmatter block above the real one —
  // corruption, not merely a skipped check. And without a verbatim body, a
  // two-field frontmatter edit would rewrite every line ending in the file
  // (both failure modes reproduced against fixtures).
  const split = splitFrontmatter(original);
  if (split === null) {
    // STE-197 AC-STE-197.4 — synthesize frontmatter for legacy files.
    // Lift any BOM to the front — prepending in front of it would bury a
    // U+FEFF mid-document.
    const bom = hasBom(original) ? "﻿" : "";
    const bodyAfterBom = bom === "" ? original : original.slice(1);
    const prepended = `${bom}---\nstatus: archived\narchived_at: ${archivedAt}\n---\n\n${bodyAfterBom}`;
    await writeFile(archivePath, prepended, "utf-8");
    return { alreadyArchived: false, archivedAt };
  }

  const lines = split.lines;
  let alreadyArchived = false;
  let sawStatus = false;
  let sawArchivedAt = false;
  const newLines: string[] = [];
  for (const line of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      newLines.push(line);
      continue;
    }
    const key = m[1]!;
    const value = (m[2] ?? "").trim();
    if (key === "status") {
      sawStatus = true;
      if (value === "archived") alreadyArchived = true;
      newLines.push("status: archived");
    } else if (key === "archived_at") {
      sawArchivedAt = true;
      // Preserve an existing non-null timestamp on idempotent re-run.
      if (value !== "" && value !== "null") {
        newLines.push(`archived_at: ${value}`);
      } else {
        newLines.push(`archived_at: ${archivedAt}`);
        alreadyArchived = false;
      }
    } else {
      newLines.push(line);
    }
  }
  if (!sawStatus) newLines.push("status: archived");
  if (!sawArchivedAt) newLines.push(`archived_at: ${archivedAt}`);
  const newContent = joinFrontmatter(split, newLines);
  if (newContent !== original) {
    await writeFile(archivePath, newContent, "utf-8");
  }
  return { alreadyArchived, archivedAt };
}

/**
 * STE-210 AC-STE-210.3 — spec-named single-call wrapper. Computes the
 * archive path from `repoRoot + frPath` (assumes `frPath` is the
 * post-`git mv` path under `specs/frs/archive/<name>.md` or
 * `specs/plan/archive/<M#>.md`; the wrapper's job is the in-place
 * frontmatter flip after the rename, not the rename itself), performs
 * the frontmatter flip, and returns the absolute archive path so the
 * caller can thread it into `git add`.
 *
 * Signature matches AC-STE-210.3 exactly: `(repoRoot, frPath, archivedAt) → archivePath`.
 *
 * `frPath` may be relative (resolved against `repoRoot`) or absolute
 * (used as-is). Idempotent: re-running on an already-flipped file is
 * byte-identical (delegates to `flipArchivedFrontmatter`).
 */
export async function archiveFRWithFlip(
  repoRoot: string,
  frPath: string,
  archivedAt: string,
): Promise<string> {
  // If the caller passed a pre-`git mv` active path (e.g.,
  // `specs/frs/<name>.md`), translate to the archive sibling. Otherwise
  // use the path as-is (the caller already pointed at the archive copy).
  let resolved = frPath;
  if (!resolved.includes("specs/frs/archive/") &&
      !resolved.includes("specs/plan/archive/")) {
    const dir = dirname(resolved);
    const name = basename(resolved);
    resolved = join(dir, "archive", name);
  }
  const absolute = resolved.startsWith("/") ? resolved : join(repoRoot, resolved);
  await flipArchivedFrontmatter(absolute, archivedAt);
  return absolute;
}
