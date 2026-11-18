// A meta-pin that freezes another test file may admit an edited line only when
// the line carries an amendment marker naming a LIVE acceptance criterion:
// `Amended by AC-<PREFIX>.<N>`, where the AC id appears as an AC line in a
// current FR file (`specs/frs/*.md` or `specs/frs/archive/*.md`). A bare
// marker, or one naming an AC nobody wrote, admits nothing.
//
// Added by AC-STE-752.1 (M_d1e7b1), on the orchestrator's ruling for the
// AC-STE-721.13 and AC-STE-592.5 meta-pins.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKER_RE = /Amended by (AC-[A-Z0-9]+(?:-[0-9]+)?\.[0-9]+)\b/;

/** Every AC id written as an AC line in the repo's FR files, active and archived. */
export function liveAcIds(repoRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const dir of [join(repoRoot, "specs", "frs"), join(repoRoot, "specs", "frs", "archive")]) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const body = readFileSync(join(dir, name), "utf-8");
      for (const m of body.matchAll(/^- (AC-[A-Z0-9]+(?:-[0-9]+)?\.[0-9]+):/gm)) ids.add(m[1]!);
    }
  }
  return ids;
}

/** The AC id a line's amendment marker names, or null when it carries none. */
export function markerAcId(line: string): string | null {
  return MARKER_RE.exec(line)?.[1] ?? null;
}

/** True only when the line's marker names an AC id that is in `live`. */
export function carriesLiveAmendment(line: string, live: ReadonlySet<string>): boolean {
  const id = markerAcId(line);
  return id !== null && live.has(id);
}

/**
 * Which of `lines` are comment-only: blank, a `//` comment, or a block comment
 * that is the WHOLE line. A closed block comment followed by code is code, and a line that
 * starts with `*` is comment-only only inside a block this sequence opened — at
 * the start of a hunk nothing proves it is inside one, so it is graded as code.
 * Amended by AC-STE-752.1 (M_d1e7b1): review S1, a block comment then code was admitted.
 */
function commentOnlyFlags(lines: readonly string[]): boolean[] {
  let inBlock = false;
  return lines.map((raw) => {
    const l = raw.trim();
    if (inBlock) {
      const close = l.indexOf("*/");
      if (close < 0) return true;
      inBlock = false;
      return l.slice(close + 2).trim() === "";
    }
    if (l === "" || l.startsWith("//")) return true;
    if (!l.startsWith("/*")) return false;
    const close = l.indexOf("*/", 2);
    if (close < 0) {
      inBlock = true;
      return true;
    }
    return l.slice(close + 2).trim() === "";
  });
}

/**
 * A `git diff -U0` hunk admitted as a live-AC amendment, strictly: every added
 * line either carries a live marker or is comment-only (a comment cannot change
 * behaviour), at least one added line carries the marker, and no more code
 * lines are removed than marked lines are added — so an unrelated removal
 * cannot ride inside a marked hunk.
 */
export function hunkIsLiveAmendment(hunk: string, live: ReadonlySet<string>): boolean {
  const lines = hunk.split("\n");
  // Callers hand in hunks split at `@@`, so no file header (`---`/`+++`) is in
  // here, and a content line that itself starts with `++` or `--` is still graded.
  const added = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  const removed = lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1));
  const marked = added.filter((l) => carriesLiveAmendment(l, live));
  if (marked.length === 0) return false;
  const addedComment = commentOnlyFlags(added);
  if (!added.every((l, i) => carriesLiveAmendment(l, live) || addedComment[i])) return false;
  const removedComment = commentOnlyFlags(removed);
  const removedCode = removed.filter((_, i) => !removedComment[i]);
  return removedCode.length <= marked.length;
}
