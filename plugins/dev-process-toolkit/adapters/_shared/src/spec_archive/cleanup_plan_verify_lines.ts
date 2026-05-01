// cleanup_plan_verify_lines — STE-126 AC-STE-126.1 + STE-171 AC-STE-171.3 helper.
//
// Invoked from /implement Phase 4 (same hook as rewriteArchiveLinks). Given
// the diff's deleted-files list and added-test-files list, walks every active
// `specs/plan/M*.md` (excluding `archive/`) and updates each `verify:` line
// that references a deleted file:
//
//   (a) deleted file is `*.placeholder.test.ts` AND added list contains
//       exactly one `*.test.ts` → rewrite the verify line to reference the
//       replacement file. Parent task checkbox stays `[ ]` since real-test
//       coverage now drives verification.
//   (b) otherwise → mark the parent task `[x]` and drop the verify line
//       entirely. The task is conceptually done; the file the verify pointed
//       at no longer exists.
//
// STE-171 filesystem fallback: when `deletedFiles[]` is empty or doesn't
// match a verify line, the helper inspects path-shaped tokens in the line
// (same heuristic as /gate-check probe #28 — `[\w./-]+\.[a-z0-9]+`, must
// include `/`, URL-skipped, backtick-fenced tokens treated as prose) and
// checks each against the project tree. Any token that doesn't resolve is
// treated as effectively-deleted: the parent task is marked `[x]` and the
// verify line is dropped (case (b)). This closes smoke #6 F3 — the
// helper used to no-op when the LLM forgot to populate `deletedFiles[]`,
// even though the verify line referenced a path that had just been
// deleted.
//
// Archive plan files (`specs/plan/archive/**`) are frozen by NFR-15 / STE-22
// archival invariants and are never scanned.
//
// Idempotent: empty deletedFiles + all paths resolved on disk yields an
// empty rewrite (no error).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface CleanupResult {
  filesChanged: string[];
  linesUpdated: number;
}

const PLACEHOLDER_RE = /\.placeholder\.test\.[a-z0-9]+$/i;
const TEST_FILE_RE = /\.test\.[a-z0-9]+$/i;

// Same shape as /gate-check probe #28 (plan_verify_line_validity.ts) so the
// fallback's notion of "path-like token" matches what the probe will warn
// about — the helper closes exactly the surface the probe detects.
const PATH_TOKEN_RE = /(?<![\w/.-])([\w][\w./-]*\.[a-z0-9]+)\b/gi;
const URL_RE = /^https?:\/\//i;

function isInsideBackticks(line: string, tokenStart: number, tokenEnd: number): boolean {
  const before = line.slice(0, tokenStart);
  const tickCountBefore = (before.match(/`/g) || []).length;
  if (tickCountBefore % 2 === 0) return false;
  const closing = line.indexOf("`", tokenEnd);
  return closing !== -1;
}

function findMissingPathInVerifyLine(line: string, projectRoot: string): string | null {
  PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(line)) !== null) {
    const token = match[1]!;
    const tokenStart = match.index;
    const tokenEnd = tokenStart + token.length;
    if (URL_RE.test(token)) continue;
    if (!token.includes("/")) continue;
    if (isInsideBackticks(line, tokenStart, tokenEnd)) continue;
    const candidate = join(projectRoot, token);
    if (!existsSync(candidate)) return token;
  }
  return null;
}

function listActivePlans(specsDir: string): string[] {
  const dir = join(specsDir, "specs", "plan");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function pickReplacement(deletedPath: string, addedTestFiles: string[]): string | null {
  if (!PLACEHOLDER_RE.test(deletedPath)) return null;
  const candidates = addedTestFiles.filter((f) => TEST_FILE_RE.test(f) && !PLACEHOLDER_RE.test(f));
  if (candidates.length === 1) return candidates[0]!;
  return null;
}

function fileMatchesVerifyLine(line: string, deletedFile: string): boolean {
  const base = basename(deletedFile);
  return line.includes(deletedFile) || (base.length > 0 && line.includes(base));
}

function processPlan(
  absPath: string,
  deletedFiles: string[],
  addedTestFiles: string[],
  projectRoot: string,
): { changed: boolean; linesUpdated: number } {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    // Unreadable plan file (permissions, concurrent write) — surface as
    // no-op instead of an uncaught throw, matching the I/O-safety pattern
    // in sibling helpers (rewrite_links.ts, plan_verify_line_validity.ts).
    return { changed: false, linesUpdated: 0 };
  }
  const lines = content.split("\n");
  let linesUpdated = 0;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const stripped = line.trimStart();
    const isVerify = stripped.startsWith("verify:");

    if (!isVerify) {
      out.push(line);
      continue;
    }

    // Find the deleted file this verify line references (if any).
    const matched = deletedFiles.find((f) => fileMatchesVerifyLine(line, f));

    // Filesystem fallback (STE-171 AC-STE-171.3): when the explicit
    // deletedFiles[] argument doesn't match, scan the verify line for a
    // path-shaped token that doesn't resolve on disk and treat that as the
    // effective "deleted" file. Replacement detection (case (a)) is still
    // gated on a known *.placeholder.test.* match in deletedFiles, since the
    // fallback can't infer placeholder-vs-real intent from a missing path.
    const fallbackToken = matched ? null : findMissingPathInVerifyLine(line, projectRoot);

    if (!matched && !fallbackToken) {
      out.push(line);
      continue;
    }

    const replacement = matched ? pickReplacement(matched, addedTestFiles) : null;

    if (replacement && matched) {
      // Rewrite the verify line to reference the replacement file. `matched`
      // is narrowed to `string` here by the truthy guard above, so no cast
      // is needed.
      const rewritten = line.split(matched).join(replacement);
      out.push(rewritten);
      linesUpdated += 1;
    } else {
      // Mark the most recent unchecked parent task `[x]` and drop this
      // verify line entirely. Walk backwards through the buffered output
      // to find the parent task line.
      for (let j = out.length - 1; j >= 0; j--) {
        const prior = out[j]!;
        const m = prior.match(/^(\s*-\s*)\[\s\](\s*.*)$/);
        if (m) {
          out[j] = `${m[1]}[x]${m[2]}`;
          break;
        }
        // Stop scanning if we hit a non-list non-blank line — verify line
        // isn't bound to a task we recognize, just drop it without flipping.
        if (prior.trim() !== "" && !/^\s*-/.test(prior)) break;
      }
      // Skip pushing the verify line — it's dropped.
      linesUpdated += 1;
    }
  }

  if (linesUpdated === 0) return { changed: false, linesUpdated: 0 };
  const next = out.join("\n");
  if (next === content) return { changed: false, linesUpdated: 0 };
  // Caller (/implement Phase 4) treats any throw as an abort signal —
  // do NOT swallow a write failure here. AC-STE-125.3 / AC-STE-126.1 abort
  // semantics rely on the throw bubbling up to surface NFR-10.
  writeFileSync(absPath, next);
  return { changed: true, linesUpdated };
}

export function cleanupPlanVerifyLines(
  specsDir: string,
  deletedFiles: string[],
  addedTestFiles: string[] = [],
): CleanupResult {
  // Empty deletedFiles[] no longer short-circuits — the filesystem fallback
  // can still surface verify lines whose path tokens don't resolve on disk.
  // Plans whose verify lines all resolve (or contain no path-shaped tokens)
  // are still a vacuous no-op.
  const filesChanged: string[] = [];
  let totalLines = 0;
  for (const planPath of listActivePlans(specsDir)) {
    const result = processPlan(planPath, deletedFiles, addedTestFiles, specsDir);
    if (result.changed) {
      filesChanged.push(planPath.slice(specsDir.length + 1));
      totalLines += result.linesUpdated;
    }
  }
  return { filesChanged, linesUpdated: totalLines };
}
