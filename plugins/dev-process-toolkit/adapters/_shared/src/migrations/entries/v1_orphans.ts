// M108 STE-391 — seed entry: v1-era orphans (AC-STE-391.4).
//
// Removes the v1-era layout marker and generated spec index under `specs/`
// (both dead since v1.20.0) and the dead sync-log subsection in CLAUDE.md
// (parser-ignored since v1.20.0). Retired literals come exclusively from
// `../legacy_paths` — never composed here (AC-STE-391.1).
//
// EXACT-SHAPE ONLY: the splice fires only on a subsection whose heading is the
// retired `LEGACY_SYNC_LOG_HEADING` AND whose enclosing `##` section is
// `## Task Tracking` — the shape the retired v1 writer emitted. A same-named
// subsection anywhere else is the operator's prose and survives byte-for-byte.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { readLines, removeTracked, rewriteLinesIfChanged } from "../consumer_files";
import type { DetectResult, MigrationEntry } from "../index";
import { LEGACY_SYNC_LOG_HEADING, legacyLayoutMarker, legacySpecsIndex } from "../legacy_paths";

/** The `##` section the retired v1 writer nested its sync log under. */
const SYNC_LOG_PARENT_HEADING = "## Task Tracking";

/** A `#`/`##`/`###` heading — the levels that can close a `###` subsection. */
const CLOSING_HEADING = /^#{1,3}(?:\s|$)/;

/** An `##` heading exactly — deeper headings never change the parent section. */
const H2_HEADING = /^##(?:\s|$)/;

/**
 * The half-open `[start, end)` line span of the dead sync-log subsection, or
 * `null` when the file does not carry the exact shape. Shared by `detect` and
 * `apply` so "did this fire?" and "what gets spliced?" can never disagree.
 */
function deadSyncLogSpan(lines: string[]): { start: number; end: number } | null {
  let parent: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === LEGACY_SYNC_LOG_HEADING && parent === SYNC_LOG_PARENT_HEADING) {
      let end = i + 1;
      while (end < lines.length && !CLOSING_HEADING.test(lines[end]!.trim())) end++;
      return { start: i, end };
    }
    // An h1 opens a new document region; an h2 names the enclosing section.
    if (/^#(?:\s|$)/.test(line)) parent = null;
    else if (H2_HEADING.test(line)) parent = line;
  }
  return null;
}

function claudeMd(projectRoot: string): string {
  return join(projectRoot, "CLAUDE.md");
}

/** The two `specs/` files the v1 layout left behind. Both were tracked. */
function orphanFiles(projectRoot: string): string[] {
  return [legacyLayoutMarker(projectRoot), legacySpecsIndex(projectRoot)];
}

function detectV1Orphans(projectRoot: string): DetectResult {
  const evidence: string[] = [];

  for (const orphan of orphanFiles(projectRoot)) {
    if (existsSync(orphan)) {
      evidence.push(`${relative(projectRoot, orphan)} present (dead since v1.20.0)`);
    }
  }

  const lines = readLines(claudeMd(projectRoot));
  if (lines !== null && deadSyncLogSpan(lines) !== null) {
    evidence.push(
      `CLAUDE.md carries the dead "${LEGACY_SYNC_LOG_HEADING}" subsection under "${SYNC_LOG_PARENT_HEADING}" (parser-ignored since v1.20.0)`,
    );
  }

  return { applies: evidence.length > 0, evidence };
}

export const v1Orphans: MigrationEntry = {
  id: "v1-orphans",
  introduced_in: "1.20.0",
  title: "Remove v1-era orphans: dead specs layout marker, generated spec index, sync-log subsection",
  kind: "script",
  detect: detectV1Orphans,
  apply(projectRoot) {
    // Re-apply is a no-op by construction: with nothing left to detect there is
    // nothing to heal, so we never touch the tree.
    if (!detectV1Orphans(projectRoot).applies) {
      return { changed: [], summary: "No v1-era orphans found — nothing to do." };
    }

    const changed: string[] = [];

    for (const orphan of orphanFiles(projectRoot)) {
      const rel = removeTracked(projectRoot, orphan);
      if (rel !== null) changed.push(rel);
    }

    // Splice ONLY the dead subsection: every other byte of CLAUDE.md is the
    // operator's and survives, original line endings included.
    const md = claudeMd(projectRoot);
    const spliced = rewriteLinesIfChanged(md, (lines) => {
      const span = deadSyncLogSpan(lines);
      if (span === null) return lines;
      const kept = [...lines];
      kept.splice(span.start, span.end - span.start);
      return kept;
    });
    if (spliced) changed.push(relative(projectRoot, md));

    return {
      changed,
      summary: `Removed v1-era orphans (${changed.join(", ")}). The dead layout marker and generated index are deleted, not migrated.`,
    };
  },
};
