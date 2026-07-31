// cross_cutting_spec_stale_file_refs (STE-215 AC-STE-215.5) —
// /gate-check probe. Severity: warning (NotesOnly).
//
// Walks `specs/technical-spec.md` and `specs/testing-spec.md` for path-
// references inside triple-backtick directory-tree blocks (treeLeaf
// shape). Tokens that look like file paths but don't resolve on disk
// surface as warnings. Prose mentions outside fences are operator
// judgment surface and never flagged here.
//
// Accept-list (`TREE_FENCE_INFO_ACCEPT_LIST`): the scan is restricted to
// fences whose info string is empty (bare), `text`, or `tree`. Fences
// carrying a language-tagged info string (`dart`, `sh`, `yaml`,
// `typescript`, …) are out of scope and are never scanned, because they
// are code, not directory trees. That
// exclusion closes three false-positive classes seen on a real consumer
// project: package-prefixed imports, app-relative asset literals, and
// shell path arguments. Bare stays the canonical form every directory
// tree in this repo already uses; `text` and `tree` are accepted so
// authors who tag for their renderer are not punished.
//
// Deliberately out of scope, alongside the bare-basename concession
// above: a tree rooted at a subdirectory prints its leaves relative to
// THAT root, while this probe still resolves them against the repo root.
// Resolving against a fence-declared root is not attempted — inferring
// the root is ambiguous (a first line of `src/` may be the root or a
// leaf) — and the probe is warn-only, so the residual is a note the
// operator judges, never a gate failure.
//
// Defense-in-depth read-side check for paths that bypass /implement's
// Phase 4 cross-cutting-spec propagation step (manual deletes, `git rm`,
// downstream toolkit consumers).

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "warning" | "error";

export interface CrossCuttingSpecStaleFileRefViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface CrossCuttingSpecStaleFileRefReport {
  violations: CrossCuttingSpecStaleFileRefViolation[];
}

// Match path-shaped tokens inside a directory-tree leaf line. The leaf
// shape after the tree characters (`├── `, `└── `, leading whitespace) is
// usually `<name>` or `<dir>/`. We match path-shaped tokens with an
// extension OR ending with `/` (directory entries).
const PATH_TOKEN_RE = /(?<![\w/.-])([\w][\w./-]*\.[a-z0-9]+)\b/gi;

// Skip URL-like tokens — fenced code blocks occasionally include
// `https://...` (e.g., dependency manifest examples). Aligned with the
// sibling probe `plan_verify_line_validity`.
const URL_RE = /^https?:\/\//i;

// Info strings whose fences are scanned as directory trees. Anything else
// (`dart`, `sh`, `yaml`, …) is a code sample, not a tree, and is skipped.
export const TREE_FENCE_INFO_ACCEPT_LIST: readonly string[] = [
  "",
  "text",
  "tree",
];

// A fence line: opening delimiter plus (on an opener) its info string.
// Deliberately unanchored at the end — under CRLF the trailing `\r` is a
// line terminator that `.` cannot match, so a `$` here would make the
// pattern miss every fence line in a CRLF file.
const FENCE_LINE_RE = /^\s*```([^\r\n]*)/;

/** Normalize a captured info string: strip a trailing CR, trim, lower-case. */
function normalizeFenceInfo(raw: string): string {
  return raw.replace(/\r$/, "").trim().toLowerCase();
}

function buildMessage(
  reason: string,
  file: string,
  missingPath: string,
): string {
  return [
    `cross_cutting_spec_stale_file_refs: ${reason}`,
    `Remedy: rewrite the directory-tree block in ${file} to drop the missing path, ` +
      `or restore the path on disk if it was deleted in error. ` +
      `/implement Phase 4's cross-cutting-spec propagation step automates this when ` +
      `the deletion source is /implement; manual edits / \`git rm\` bypass the propagation, ` +
      `which is what this probe surfaces.`,
    `Context: file=${file}, path=${missingPath}, probe=cross_cutting_spec_stale_file_refs, severity=warning`,
  ].join("\n");
}

function scanFile(
  absPath: string,
  projectRoot: string,
): CrossCuttingSpecStaleFileRefViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const rel = relative(projectRoot, absPath);
  const violations: CrossCuttingSpecStaleFileRefViolation[] = [];
  // `null` ⇒ no fence is open. Otherwise the normalized info string of the
  // currently open fence. A fence line OPENS (capture this line's info
  // string) when closed and CLOSES (reset to `null`) when open — a closing
  // marker's own text is never read as an info string, so a tagged fence
  // still closes and the toggle cannot desynchronize.
  let fenceInfo: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE_LINE_RE.exec(line);
    if (fenceMatch) {
      fenceInfo = fenceInfo === null ? normalizeFenceInfo(fenceMatch[1]!) : null;
      continue;
    }
    // Prose mentions (no fence open) are NOT scanned, and neither are
    // language-tagged fences whose info string is off the accept-list.
    if (fenceInfo === null) continue;
    if (!TREE_FENCE_INFO_ACCEPT_LIST.includes(fenceInfo)) continue;

    PATH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_TOKEN_RE.exec(line)) !== null) {
      const token = match[1]!;
      // Token must look path-shaped (have a dot in the basename — already
      // enforced by the regex). Skip pure-extension hits or short shapes
      // that match prose words like `e.g.` or `i.e.`.
      if (token.length < 5) continue;
      if (/^(?:e\.g|i\.e|etc)\b/i.test(token)) continue;
      if (URL_RE.test(token)) continue;
      // Bare basenames (no `/`) are ambiguous: a directory-tree leaf like
      // `└── greet.ts` doesn't carry the parent path context, so we can't
      // resolve it against disk. Aligned with the heuristic used by the
      // sibling probe `plan_verify_line_validity` (line 105). Tradeoff:
      // the probe misses bare-leaf drift; the cleanup helper
      // `scanCrossCuttingSpecRefs` (which matches by basename) is the
      // precise mechanism — this probe is the safety net for full-path
      // refs that bypass /implement's propagation.
      if (!token.includes("/")) continue;
      const candidate = join(projectRoot, token);
      if (existsSync(candidate)) continue;
      const reason = `directory-tree leaf references missing path "${token}"`;
      violations.push({
        file: absPath,
        line: i + 1,
        reason,
        note: `${rel}:${i + 1} — ${reason}`,
        message: buildMessage(reason, rel, token),
        severity: "warning",
      });
    }
  }
  return violations;
}

export async function runCrossCuttingSpecStaleFileRefsProbe(
  projectRoot: string,
): Promise<CrossCuttingSpecStaleFileRefReport> {
  const specsDir = join(projectRoot, "specs");
  if (!existsSync(specsDir)) return { violations: [] };
  const violations: CrossCuttingSpecStaleFileRefViolation[] = [];
  violations.push(
    ...scanFile(join(specsDir, "technical-spec.md"), projectRoot),
  );
  violations.push(
    ...scanFile(join(specsDir, "testing-spec.md"), projectRoot),
  );
  return { violations };
}
