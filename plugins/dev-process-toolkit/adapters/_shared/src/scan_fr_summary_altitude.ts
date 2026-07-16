// scan_fr_summary_altitude — pure scanner backing the /gate-check
// `fr_summary_altitude` probe (#67, STE-386). Given a project root, walk the
// ACTIVE FRs only (`specs/frs/*.md`, `archive/` excluded), locate each file's
// `## Summary` section (heading matched by /^##\s+Summary\s*$/ — an h3
// `### Summary` does NOT count; the section ends at the next `^##` heading or
// EOF), and enforce four altitude rules over the SECTION BODY ONLY:
//
//   line_cap   — more than 6 non-empty lines fails; the violation anchors at
//                the first non-empty line beyond the cap (the 7th). The
//                3-line floor is authoring guidance (STE-385), NOT enforced.
//   backtick   — any backtick character on a line (subsumes code fences).
//   ac_id      — an AC-ID token of the AC-prefix shape, regardless of tracker
//                flavor (AC-STE-386.2 and AC-DST-45.1 both flag).
//   path_token — a whitespace-delimited token containing BOTH a slash and a
//                dot-extension. "and/or", "read/write", "v2.46.0", and the
//                sentence-final "request/response." all stay clean.
//
// Detection-only + deterministic: `file` is repo-root-relative with POSIX
// separators; `line` is 1-indexed. Vacuous paths (no `## Summary`, empty or
// absent `specs/frs/`) yield zero violations — the probe caller renders zero
// violations as a bare GATE PASSED row.
//
// Modelled on `scan_design_references.ts` (readFileSync + line walk).

import { existsSync, readFileSync, readdirSync } from "node:fs";

export const PROBE_ID = "fr_summary_altitude";

export interface FrSummaryAltitudeViolation {
  /** Repo-root-relative path of the FR file, POSIX separators. */
  file: string;
  /** 1-indexed line of the violation. */
  line: number;
  /** One of the closed set: line_cap | backtick | ac_id | path_token. */
  rule: "line_cap" | "backtick" | "ac_id" | "path_token";
}

/** Non-empty summary lines beyond this count flag `line_cap`. */
const LINE_CAP = 6;
// A LEVEL-2 heading whose text is exactly "Summary". `### Summary` (h3) fails
// because the char after `##` is `#`, not whitespace.
const SUMMARY_HEADING_RE = /^##\s+Summary\s*$/;
// Any following `^##` heading ends the section.
const SECTION_END_RE = /^##/;
// AC-ID token of the AC-prefix shape, any tracker flavor (STE, DST, …).
const AC_ID_RE = /\bAC-[A-Z][A-Z0-9]*-\d+\.\d+/;
// Trailing sentence punctuation stripped from a token before the
// dot-extension check ("request/response." must stay clean).
const TRAILING_PUNCT_RE = /[.,;:!?)\]'"]+$/;
// A dot-extension: a final `.` followed by alphanumerics.
const DOT_EXTENSION_RE = /\.[A-Za-z0-9]+$/;

/** True iff a whitespace-delimited token carries both a slash and a
 * dot-extension (after trailing sentence punctuation is stripped). */
function isPathToken(token: string): boolean {
  const stripped = token.replace(TRAILING_PUNCT_RE, "");
  return stripped.includes("/") && DOT_EXTENSION_RE.test(stripped);
}

/** Active FR files: `specs/frs/*.md`, non-recursive — `archive/` excluded. */
function listActiveFrs(projectRoot: string): { abs: string; rel: string }[] {
  const frsDir = `${projectRoot}/specs/frs`;
  if (!existsSync(frsDir)) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(frsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => ({ abs: `${frsDir}/${e.name}`, rel: `specs/frs/${e.name}` }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

function scanFile(abs: string, rel: string): FrSummaryAltitudeViolation[] {
  let content: string;
  try {
    content = readFileSync(abs, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const violations: FrSummaryAltitudeViolation[] = [];
  let inSection = false;
  let nonEmptyCount = 0;
  let lineCapFlagged = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (SUMMARY_HEADING_RE.test(line)) {
      inSection = true;
      nonEmptyCount = 0;
      lineCapFlagged = false;
      continue;
    }
    if (!inSection) continue;
    if (SECTION_END_RE.test(line)) {
      inSection = false;
      continue;
    }

    if (line.trim() !== "") {
      nonEmptyCount++;
      if (nonEmptyCount > LINE_CAP && !lineCapFlagged) {
        lineCapFlagged = true;
        violations.push({ file: rel, line: i + 1, rule: "line_cap" });
      }
    }
    if (line.includes("`")) {
      violations.push({ file: rel, line: i + 1, rule: "backtick" });
    }
    if (AC_ID_RE.test(line)) {
      violations.push({ file: rel, line: i + 1, rule: "ac_id" });
    }
    if (line.split(/\s+/).some(isPathToken)) {
      violations.push({ file: rel, line: i + 1, rule: "path_token" });
    }
  }
  return violations;
}

export function scanFrSummaryAltitude(
  projectRoot: string,
): FrSummaryAltitudeViolation[] {
  const violations: FrSummaryAltitudeViolation[] = [];
  for (const { abs, rel } of listActiveFrs(projectRoot)) {
    violations.push(...scanFile(abs, rel));
  }
  return violations;
}
