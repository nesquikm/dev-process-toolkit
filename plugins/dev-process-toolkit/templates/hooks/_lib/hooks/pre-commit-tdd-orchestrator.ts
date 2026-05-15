// STE-290 — Pre-commit /tdd orchestrator enforcement (per-hook entrypoint).
// STE-295 AC.1 — carve-out: spec-only commits skip the /tdd requirement.
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
  const proc = Bun.spawn(["git", "diff", "--cached", "--name-only"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const stagedRaw = await new Response(proc.stdout).text();
  await proc.exited;
  const staged = stagedRaw.split("\n").filter((l) => l.length > 0);

  const verdict = classifyStagedPaths(staged);
  if (verdict !== "tdd-required") {
    process.exit(0);
  }

  const { found } = requireSkillToolUse(
    "dev-process-toolkit:tdd",
    "pre-commit-tdd-orchestrator",
    payload,
  );
  process.exit(found ? 0 : 2);
}
