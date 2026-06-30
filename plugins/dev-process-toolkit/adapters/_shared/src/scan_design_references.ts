// scan_design_references — pure detector backing the /gate-check
// `design_references_resolve` probe. Given a project root, walk the spec-file
// glob (`specs/requirements.md`, `specs/frs/**/*.md` active + `archive/`,
// `specs/technical-spec.md`, `specs/testing-spec.md`, `specs/plan/**/*.md`),
// find every `## Design References` section (a LEVEL-2 heading whose text is
// exactly "Design References" — an h3 `### Design References` does NOT count;
// the section ends at the next line beginning with `## `), and for each list
// item under it whose first backtick-wrapped token is a repo-root-relative
// path emit a row recording the path, the spec file it lives in, the entry's
// 1-indexed line, and whether the path resolves on disk.
//
// Detection-only + deterministic: the probe (caller) GATE FAILEDs on any row
// with `resolves === false`. Non-path prose lines under the heading (no
// backtick path token) are ignored, so a section with only prose / no entries
// yields zero rows (vacuous pass).
//
// Modelled on `scan_cross_cutting_spec_refs.ts` (readFileSync + line walk) and
// `traceability_link_validity.ts` (specs/ tree discovery).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface DesignReferenceRow {
  /** Repo-root-relative path named in the backtick token (verbatim). */
  path: string;
  /** Repo-root-relative path of the spec file, POSIX separators. */
  file: string;
  /** 1-indexed line of the entry. */
  line: number;
  /** existsSync(join(projectRoot, path)). */
  resolves: boolean;
}

// A LEVEL-2 heading whose text is exactly "Design References". `### …` (h3)
// fails because the char after `##` is `#`, not whitespace.
const DESIGN_REFS_HEADING_RE = /^##[ \t]+Design References[ \t]*$/;
// Any line that begins a new level-2 section ends the current one.
const SECTION_END_RE = /^## /;
// A markdown list item (`- ` / `* ` / `+ `, optional leading indent). Only
// list items are entries — a prose line that merely mentions a backtick path
// under the heading is NOT a reference (matches the documented contract and
// avoids a false-positive GATE FAILED on hand-authored prose).
const LIST_ITEM_RE = /^[ \t]*[-*+][ \t]+/;
// First backtick-wrapped token on a line.
const FIRST_BACKTICK_RE = /`([^`]+)`/;

/** A backtick token is a repo-root-relative path iff it is not absolute, not a
 * URL, and contains a `/` path separator (e.g. `specs/design/…/foo.png`). */
function isRepoRootRelativePath(token: string): boolean {
  if (token.startsWith("/")) return false; // absolute
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false; // URL scheme
  return token.includes("/");
}

/** Recursively collect every `*.md` file under `dir` (includes `archive/`). */
function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(abs));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

/** The full spec-file glob, as absolute paths that exist on disk. */
function listSpecFiles(projectRoot: string): string[] {
  const specsDir = join(projectRoot, "specs");
  if (!existsSync(specsDir)) return [];
  const files: string[] = [];
  for (const name of ["requirements.md", "technical-spec.md", "testing-spec.md"]) {
    const abs = join(specsDir, name);
    if (existsSync(abs)) files.push(abs);
  }
  files.push(...walkMarkdown(join(specsDir, "frs")));
  files.push(...walkMarkdown(join(specsDir, "plan")));
  return files;
}

function scanFile(absPath: string, projectRoot: string): DesignReferenceRow[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath).split(sep).join("/");
  const lines = content.split("\n");
  const rows: DesignReferenceRow[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (DESIGN_REFS_HEADING_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (SECTION_END_RE.test(line)) {
      inSection = false;
      continue;
    }
    if (!LIST_ITEM_RE.test(line)) continue; // only list items are entries
    const match = FIRST_BACKTICK_RE.exec(line);
    if (!match) continue;
    const token = match[1]!;
    if (!isRepoRootRelativePath(token)) continue;
    rows.push({
      path: token,
      file: rel,
      line: i + 1,
      resolves: existsSync(join(projectRoot, token)),
    });
  }
  return rows;
}

export function scanDesignReferences(projectRoot: string): DesignReferenceRow[] {
  const rows: DesignReferenceRow[] = [];
  for (const absPath of listSpecFiles(projectRoot)) {
    rows.push(...scanFile(absPath, projectRoot));
  }
  return rows;
}
