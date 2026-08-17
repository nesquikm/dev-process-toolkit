// cross_cutting_spec_stale_file_refs (STE-215 AC-STE-215.5) —
// /gate-check probe. Severity: warning (NotesOnly).
//
// Walks `specs/technical-spec.md` and `specs/testing-spec.md` for path-
// references in two shapes (STE-480): inside triple-backtick directory-
// tree blocks (`treeLeaf`) and in prose outside any fence
// (`proseMention`). Tokens that look like file paths but don't resolve on
// disk surface as warnings, tagged with the `kind` that produced them so
// consumers can keep the two shapes apart (tree leaves are mechanically
// rewritable; prose is operator judgment surface).
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
// Resolution (STE-480): a token counts as resolving when it exists under
// the project root OR under any `plugins/<name>/` sub-root carrying a
// `.claude-plugin/plugin.json` manifest. Marketplace repos keep their
// cross-cutting specs at the repo root while describing the plugin tree, so
// plugin-relative prose paths are the norm there, not drift. Derived from
// the manifest rather than a hard-coded path list, so it stays a layout rule
// and never becomes a per-project suppression list.
//
// Path TEMPLATES are skipped: an expression carrying a `<placeholder>`
// segment (`docs/.pending/<fr-id>.md`) names a path shape, which by
// construction resolves nowhere for anyone.
//
// Fence walking is NOT shared with `scan_cross_cutting_spec_refs.ts`, whose
// `RefKind` vocabulary this module does reuse. That divergence is deliberate,
// not drift: the helper toggles a plain boolean because every fence is equally
// in scope for it, while this probe must capture and normalize each opener's
// info string to apply the accept-list above. Pushing info-string scoping down
// into the helper would change what /implement Phase 4's propagation step
// cleans, which is a different contract with its own tests.
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { RefKind } from "./scan_cross_cutting_spec_refs";

export type Severity = "warning" | "error";

export interface CrossCuttingSpecStaleFileRefViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
  /**
   * Which reference shape produced this row. Reuses the `RefKind` vocabulary
   * exported by `scan_cross_cutting_spec_refs.ts` rather than declaring a
   * second one. This is the discriminator, NOT the severity: both shapes are
   * `warning`.
   */
  kind: RefKind;
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

// Characters that can appear in a path EXPRESSION as written in prose —
// the path-token characters plus the angle brackets that delimit a
// placeholder segment. Used to widen a matched token back out to the whole
// expression the author wrote, so `<…>` segments the token regex cannot
// cross are still visible to the template check below.
const PATH_EXPR_CHAR_RE = /[\w./<>-]/;

// A placeholder segment: `<fr-id>`, `<project>`, `<id>`, … Deliberately
// whitespace-free so a prose comparison (`a < b`) can never read as one.
const PLACEHOLDER_SEGMENT_RE = /<[^<>\s]*>/;

/**
 * True when the matched token is part of a path TEMPLATE — an expression
 * carrying a `<placeholder>` segment (`docs/.pending/<fr-id>.md`).
 *
 * A template names a path SHAPE, not a path: it can never resolve on disk,
 * for this project or any other, so flagging it as "missing" is always a
 * false positive. The token regex stops at `<`, which is exactly why the
 * check has to widen back out to the surrounding expression before deciding.
 */
function isPathTemplate(line: string, start: number, end: number): boolean {
  let left = start;
  while (left > 0 && PATH_EXPR_CHAR_RE.test(line[left - 1]!)) left--;
  let right = end;
  while (right < line.length && PATH_EXPR_CHAR_RE.test(line[right]!)) right++;
  return PLACEHOLDER_SEGMENT_RE.test(line.slice(left, right));
}

/**
 * True when a matched token is worth resolving against disk at all.
 *
 * These are the token-ACCEPTANCE rules, deliberately gathered into one
 * predicate rather than left as a run of inline `continue`s in the scan loop:
 * every clause is a pure, side-effect-free test of the same token, so they are
 * ORDER-INDEPENDENT and the sequence below carries no meaning. Reading them as
 * a pipeline (where an earlier clause protects a later one) would be a
 * misreading. The one real decision — "does this path exist on disk?" — stays
 * in the scan loop, so the loop reads as: reject what can never resolve, then
 * resolve.
 *
 * The clauses, all rejections:
 *   - too short to be a path expression;
 *   - a prose abbreviation (`e.g.`, `i.e.`, `etc.`) the token regex catches;
 *   - a URL, aligned with the sibling probe `plan_verify_line_validity`;
 *   - a bare basename with no `/` — a tree leaf like `└── greet.ts` carries no
 *     parent context, so it cannot be resolved. Tradeoff: the probe misses
 *     bare-leaf drift; the cleanup helper `scanCrossCuttingSpecRefs` (which
 *     matches by basename) is the precise mechanism — this probe is the safety
 *     net for full-path refs that bypass /implement's propagation;
 *   - a `<placeholder>`-carrying expression, which names a path SHAPE.
 *
 * The slash clause subsumes most of what the length and abbreviation clauses
 * would reject on their own. All three are kept: each states an independent
 * property of a non-path token, and none is load-bearing for another.
 */
function isScannableToken(line: string, token: string, start: number): boolean {
  if (token.length < 5) return false;
  if (/^(?:e\.g|i\.e|etc)\b/i.test(token)) return false;
  if (URL_RE.test(token)) return false;
  if (!token.includes("/")) return false;
  if (isPathTemplate(line, start, start + token.length)) return false;
  return true;
}

/**
 * The roots a path token is resolved against, in order: the project root,
 * then every `plugins/<name>/` directory carrying a `.claude-plugin/
 * plugin.json` manifest.
 *
 * Rationale (STE-480). In a Claude Code MARKETPLACE repo the cross-cutting
 * specs sit at the repo root but describe the PLUGIN's tree, so they address
 * paths plugin-relative by design (`adapters/_shared/src/…`,
 * `templates/permissions.json`, `docs/patterns.md`). Resolving those against
 * the repo root alone reports the entire plugin as missing. The sub-root set
 * is derived from the manifest, not from a hard-coded list, so it is a layout
 * rule rather than a per-project exclusion list: a `plugins/` directory with
 * no plugin manifests in it contributes no roots at all.
 *
 * Deterministic: manifest-bearing directories only, name-sorted, computed
 * once per probe run.
 */
export function resolutionRoots(projectRoot: string): string[] {
  const roots = [projectRoot];
  const pluginsDir = join(projectRoot, "plugins");
  let entries: string[];
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return roots;
  }
  for (const name of entries) {
    const candidate = join(pluginsDir, name);
    if (existsSync(join(candidate, ".claude-plugin", "plugin.json"))) {
      roots.push(candidate);
    }
  }
  return roots;
}

/** The reason half of the NFR-10 three-line shape, per reference kind. */
function buildReason(kind: RefKind, token: string): string {
  return kind === "treeLeaf"
    ? `directory-tree leaf references missing path "${token}"`
    : `prose references missing path "${token}"`;
}

function buildMessage(
  kind: RefKind,
  reason: string,
  file: string,
  missingPath: string,
): string {
  // Prose gets its own remedy sentence on purpose: reusing the tree-leaf
  // wording would tell the operator to rewrite a directory-tree block that
  // does not exist on that line.
  const remedy =
    kind === "treeLeaf"
      ? `Remedy: rewrite the directory-tree block in ${file} to drop the missing path, ` +
        `or restore the path on disk if it was deleted in error. ` +
        `/implement Phase 4's cross-cutting-spec propagation step automates this when ` +
        `the deletion source is /implement; manual edits / \`git rm\` bypass the propagation, ` +
        `which is what this probe surfaces.`
      : `Remedy: amend the sentence in ${file} to drop the missing path or requalify it ` +
        `(name the project it belongs to, or mark it historical), or restore the path on ` +
        `disk if it was deleted in error. Prose is never rewritten mechanically — ` +
        `/implement Phase 4's cross-cutting-spec propagation step only cleans directory-tree ` +
        `leaves, so this row is advisory and needs an operator judgment call.`;
  return [
    `cross_cutting_spec_stale_file_refs: ${reason}`,
    remedy,
    `Context: file=${file}, path=${missingPath}, kind=${kind}, probe=cross_cutting_spec_stale_file_refs, severity=warning`,
  ].join("\n");
}

function scanFile(
  absPath: string,
  projectRoot: string,
  roots: readonly string[],
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
    // Explicit in-scope decision (STE-480). Three outcomes, in this order:
    //   - no fence open        ⇒ prose, in scope, tagged `proseMention`;
    //   - fence on accept-list ⇒ directory tree, in scope, `treeLeaf`;
    //   - fence off accept-list ⇒ code sample, still out of scope, skipped.
    // Written as a decision rather than two guards because a `continue` on
    // `fenceInfo === null` would hand `null` to the accept-list check below —
    // the shape that kept prose unscanned before this FR.
    let kind: RefKind;
    if (fenceInfo === null) {
      kind = "proseMention";
    } else if (TREE_FENCE_INFO_ACCEPT_LIST.includes(fenceInfo)) {
      kind = "treeLeaf";
    } else {
      continue;
    }

    PATH_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_TOKEN_RE.exec(line)) !== null) {
      const token = match[1]!;
      if (!isScannableToken(line, token, match.index)) continue;
      if (roots.some((root) => existsSync(join(root, token)))) continue;
      const reason = buildReason(kind, token);
      violations.push({
        file: absPath,
        line: i + 1,
        reason,
        note: `${rel}:${i + 1} — ${reason}`,
        message: buildMessage(kind, reason, rel, token),
        severity: "warning",
        kind,
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
  const roots = resolutionRoots(projectRoot);
  violations.push(
    ...scanFile(join(specsDir, "technical-spec.md"), projectRoot, roots),
  );
  violations.push(
    ...scanFile(join(specsDir, "testing-spec.md"), projectRoot, roots),
  );
  return { violations };
}
