// report_issue_session_select — STE-374 AC-STE-374.1.
//
// /report-issue's transcript-selection heuristic used to be a bare
// most-recent-mtime pick (see `find_current_session.ts`). That silently
// grabs the wrong JSONL whenever the incident lives in an older session
// than the newest one on disk. `selectIncidentSession` upgrades the pick
// to a CONTENT-matched selection: it scans the K most-recent `*.jsonl`
// candidates under the cwd-slug directory, greps each for any of the
// incident `markers` (skill/fork name(s) parsed from the narrative plus
// any user-supplied marker string), and returns the first (most-recent)
// candidate whose content carries a marker.
//
// The most-recent-mtime pick — the previous whole heuristic — survives as
// the EXPLICIT fallback, used only when no candidate within the K-window
// matches a marker. When more candidates exist than the K-window admits,
// `truncated: true` surfaces that the scan was bounded so the operator can
// tell a "no incident found" fallback apart from a "looked past the
// window" one.
//
// The mtime idiom (statSync().mtimeMs, descending sort) mirrors
// `find_current_session.ts`; reads are defensive — an unreadable file is
// treated as non-matching rather than fatal.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Default scan-window size — the K most-recent `*.jsonl` candidates. */
export const DEFAULT_INCIDENT_WINDOW = 5;

export interface IncidentSessionSelection {
  /** The selected JSONL path, or `null` when no `*.jsonl` candidate exists. */
  path: string | null;
  /** `true` when the selected path was chosen by a marker content-match. */
  matched: boolean;
  /** `true` when more than K candidates existed and the scan window truncated. */
  truncated?: boolean;
}

/**
 * Select the incident's session JSONL under `cwdSlugDir`.
 *
 * Lists `*.jsonl` files by mtime (descending), considers the K most-recent
 * (`opts.k`, default {@link DEFAULT_INCIDENT_WINDOW}), and returns the first
 * whose CONTENT contains any of `markers` (substring UNION) →
 * `{ path, matched: true }`. When no candidate within the window matches,
 * returns the most-recent-mtime file with `matched: false` (the explicit
 * mtime fallback). An absent directory or one with zero `*.jsonl` files
 * returns the sentinel `{ path: null, matched: false }`. `truncated: true`
 * is surfaced whenever the total candidate count exceeds K.
 */
export function selectIncidentSession(
  cwdSlugDir: string,
  markers: string[],
  opts?: { k?: number },
): IncidentSessionSelection {
  const k = opts?.k ?? DEFAULT_INCIDENT_WINDOW;

  if (!existsSync(cwdSlugDir)) return { path: null, matched: false };

  let entries: string[];
  try {
    entries = readdirSync(cwdSlugDir);
  } catch {
    return { path: null, matched: false };
  }

  const candidates: { path: string; mtime: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(cwdSlugDir, name);
    let mtime: number;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({ path: full, mtime });
  }

  if (candidates.length === 0) return { path: null, matched: false };

  candidates.sort((a, b) => b.mtime - a.mtime);
  const truncated = candidates.length > k;

  const window = candidates.slice(0, k);
  for (const candidate of window) {
    let content: string;
    try {
      content = readFileSync(candidate.path, "utf-8");
    } catch {
      continue; // Unreadable file ⇒ treat as non-matching.
    }
    if (markers.some((marker) => content.includes(marker))) {
      return { path: candidate.path, matched: true, truncated };
    }
  }

  // No candidate within the window matched — the explicit mtime fallback.
  return { path: candidates[0]!.path, matched: false, truncated };
}
