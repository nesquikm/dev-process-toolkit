// STE-290 — Pre-commit /tdd orchestrator enforcement (per-hook entrypoint).
// STE-295 AC.1 — carve-out: spec-only commits skip the /tdd requirement.
// STE-360 AC.1 — carve-out: /setup's Bun zero-match placeholder test is exempt.
//
// Refusing hook: on `git commit*`, runs `git diff --cached --name-only` to
// find staged files, then asks `classifyStagedPaths` for a verdict:
//   - "spec-only"    → exit 0 (carve-out: pure spec/plan/requirements commit)
//   - "no-fr"        → exit 0 (no FR-related paths; STE-290 didn't flag)
//   - "tdd-required" → require a `dev-process-toolkit:tdd` Skill tool_use in
//                       the session transcript (exit 2 on miss).
//
// Spec-only carve-out fires iff the staged set is NON-EMPTY, EVERY path
// matches one of the SPEC_PATTERNS below, AND NO path matches the
// src/test patterns (`src/**`, `**/__tests__/**`, `*.{test,spec}.{ts,tsx,js}`).
// Mixed spec+src or spec+test still requires /tdd (preserves STE-290 semantics).
//
// STE-360 placeholder exemption (dual key): a staged path is exempt iff
//   (a) its basename is `.placeholder.test.ts` (guard, secondary), AND
//   (b) the STAGED BLOB carries the "Bun zero-match workaround" marker
//       comment (grep, primary) OR the path is staged as a DELETION
//       (the STE-215/STE-222 first-real-test-lands lifecycle).
// Exemption subtracts exempt placeholders from the tdd-REQUIRED set only —
// it never waives the check for other staged files, and it does not feed
// back into the spec-only carve-out (placeholder + FR file stays mixed,
// hence tdd-required).

import { parseHookPayload, requireSkillToolUse } from "../session.ts";

// ---------------------------------------------------------------------------
// Pure classifier — exported for unit tests (AC-STE-295.1).
// ---------------------------------------------------------------------------

const FR_RE = /^specs\/frs\/.*\.md$/;
const TEST_SUFFIX_RE = /\.(test|spec)\.(ts|tsx|js)$/;

// Spec-only carve-out patterns. Every staged path must match at least one of
// these AND none may match the src/test patterns below for `spec-only`.
const SPEC_PATTERNS: RegExp[] = [
  /^specs\/frs\/[^/]+\.md$/, // specs/frs/*.md (excludes subdirs except archive below)
  /^specs\/frs\/archive\/[^/]+\.md$/, // specs/frs/archive/*.md
  /^specs\/plan\/M[^/]*\.md$/, // specs/plan/M*.md
  /^specs\/plan\/archive\/[^/]+\.md$/, // specs/plan/archive/*.md
  /^specs\/requirements\.md$/,
  /^specs\/technical-spec\.md$/,
  /^specs\/testing-spec\.md$/,
];

const SRC_RE = /^src\//;
const TESTS_DIR_RE = /(^|\/)__tests__(\/|$)/;

const isSpecPath = (p: string): boolean =>
  SPEC_PATTERNS.some((re) => re.test(p));

const isSrcOrTestPath = (p: string): boolean =>
  SRC_RE.test(p) || TESTS_DIR_RE.test(p) || TEST_SUFFIX_RE.test(p);

const isFrRelated = (p: string): boolean =>
  FR_RE.test(p) || p.includes("__tests__") || TEST_SUFFIX_RE.test(p);

export type StagedClassification = "spec-only" | "tdd-required" | "no-fr";

/**
 * Classify a staged-paths list into one of three verdicts that drive the
 * pre-commit /tdd orchestrator's early-exit decision.
 *
 *   - "spec-only"    — staged set is non-empty, every path matches a spec
 *                       pattern, and no path matches src/test patterns.
 *                       Hook exits 0 (carve-out).
 *   - "tdd-required" — staged set contains an FR-markdown path or any
 *                       test-related path (`__tests__` dir or test/spec
 *                       suffix). Hook requires /tdd Skill tool_use.
 *   - "no-fr"        — neither carve-out nor STE-290 trigger fires; hook
 *                       exits 0 (e.g., empty set, pure README/CHANGELOG).
 *
 * Pure function: no I/O, no globals.
 */
export function classifyStagedPaths(paths: string[]): StagedClassification {
  if (paths.length === 0) {
    return "no-fr";
  }
  const hasSrcOrTest = paths.some(isSrcOrTestPath);
  const allSpec = paths.every(isSpecPath);
  if (!hasSrcOrTest && allSpec) {
    return "spec-only";
  }
  if (paths.some(isFrRelated)) {
    return "tdd-required";
  }
  return "no-fr";
}

// ---------------------------------------------------------------------------
// Git plumbing — one spawn/collect helper shared by every `git` call below.
// ---------------------------------------------------------------------------

/** Run `git <args>` in cwd; capture stdout, discard stderr, report exit code. */
async function gitOut(
  args: string[],
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

// ---------------------------------------------------------------------------
// STE-360 — /setup Bun zero-match placeholder exemption.
// ---------------------------------------------------------------------------

const PLACEHOLDER_BASENAME = ".placeholder.test.ts";
const PLACEHOLDER_MARKER = "Bun zero-match workaround";

/**
 * True iff `path` is an exempt /setup placeholder per the STE-360 dual key:
 * basename must be `.placeholder.test.ts` AND the staged blob must carry the
 * `Bun zero-match workaround` marker comment (or the path must be staged as
 * a deletion). Reads the INDEX (`git show :<path>`), not the worktree, so a
 * marker-less file renamed to the placeholder basename stays tdd-required.
 */
async function isExemptPlaceholder(path: string): Promise<boolean> {
  if (path.split("/").pop() !== PLACEHOLDER_BASENAME) {
    return false;
  }
  // Deletion leg: `git rm`-ed placeholders have no staged blob to grep.
  const status = await gitOut([
    "diff",
    "--cached",
    "--name-status",
    "--",
    path,
  ]);
  if (status.stdout.trimStart().startsWith("D")) {
    return true;
  }
  // Marker leg: grep the staged blob for the workaround marker comment.
  const show = await gitOut(["show", `:${path}`]);
  return show.exitCode === 0 && show.stdout.includes(PLACEHOLDER_MARKER);
}

// ---------------------------------------------------------------------------
// Entrypoint — only runs when this file is executed (not imported for tests).
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const stdin = await Bun.stdin.text();
  const payload = parseHookPayload(stdin);
  if (!payload) {
    process.exit(0);
  }
  const cmd = payload.tool_input?.command ?? "";
  if (!/^git commit\b/.test(cmd)) {
    process.exit(0);
  }

  // Collect staged files via filesystem call (no $CLAUDE_STAGED_FILES env var).
  const { stdout: stagedRaw } = await gitOut(["diff", "--cached", "--name-only"]);
  const staged = stagedRaw.split("\n").filter((l) => l.length > 0);

  const verdict = classifyStagedPaths(staged);
  if (verdict !== "tdd-required") {
    process.exit(0);
  }

  // STE-360 — subtract exempt placeholders from the tdd-required set. If
  // every path that triggered "tdd-required" is an exempt placeholder, the
  // commit passes without /tdd evidence; any remaining tdd-required path
  // (FR markdown, real test file) keeps the requirement in force.
  const required = staged.filter(isFrRelated);
  const exemptFlags = await Promise.all(required.map(isExemptPlaceholder));
  if (required.length > 0 && exemptFlags.every(Boolean)) {
    process.exit(0);
  }

  const { found } = requireSkillToolUse(
    "dev-process-toolkit:tdd",
    "pre-commit-tdd-orchestrator",
    payload,
  );
  process.exit(found ? 0 : 2);
}
