// STE-672 — fence for tests that require a NON-EMPTY `git diff` against a moving ref.
//
// A test that diffs against `main` (or `HEAD`) and asserts the diff is non-empty
// reads green on its branch and red on trunk the moment the branch merges: the
// moving ref then holds the edits and the diff reads empty. Such assertions must
// diff against a pinned commit instead. Assertions that a suite is UNEDITED
// against `main` (empty diff, `--quiet`, no unmarked hunks) are fine and not flagged.
//
// The scan is per test block: a block (a `test(`/`it(` call up to the next one)
// that spawns `git diff` with a literal moving ref, and asserts on a line that
// the output is non-empty, yields one hit per such assertion line.
//
// Best-effort, by shape. A clean scan is a claim about the shapes below, not
// proof that no such assertion exists. It does not see: a ref passed through a
// variable or helper parameter, a range spelling (`main..HEAD`), an `expect(...)`
// chain split across lines, or a non-empty check that never names `stdout`
// (`expect(hunks.length).toBeGreaterThan(0)`).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type MovingRefDiffHit = { file: string; line: number; snippet: string };

/** The moving refs, spelled once for both detectors below. */
const MOVING_REF = String.raw`(?:origin\/)?(?:main|HEAD)`;

/** A quoted literal naming a moving ref. */
const MOVING_REF_LITERAL = new RegExp(String.raw`^["'\`]${MOVING_REF}["'\`]$`);

/** `["diff", ...]` argument arrays. */
const DIFF_ARGS_ARRAY = /\[\s*["'`]diff["'`]\s*,([^\]]*)\]/g;

/** `git diff ... main|HEAD` inside one string (execSync-style). */
const DIFF_COMMAND_STRING = new RegExp(
  String.raw`["'\`]git\s+diff\b[^"'\`\n]*\s${MOVING_REF}\b[^"'\`\n]*["'\`]`,
);

/** Assertion lines that require the diff output to be non-empty. */
const NON_EMPTY_ASSERTIONS: RegExp[] = [
  /\bexpect\(.*\)\s*\.toContain\(\s*["'`](?:@@|diff --git)/,
  /\bexpect\(.*\)\s*\.toMatch\(\s*\/(?:\^)?@@/,
  /\bexpect\(.*\bstdout\b.*\)\s*\.toBeGreaterThan\(\s*0\s*\)/,
  /\bexpect\(.*\bstdout\b.*\)\s*\.not\.(?:toBe|toEqual)\(\s*(?:""|''|``)\s*\)/,
];

const BLOCK_START = /^\s*(?:test|it)(?:\.\w+)?\(/;

function diffsAgainstMovingRef(block: string): boolean {
  for (const m of block.matchAll(DIFF_ARGS_ARRAY)) {
    const args = m[1]!.split(",").map((a) => a.trim());
    if (args.some((a) => MOVING_REF_LITERAL.test(a))) return true;
  }
  return DIFF_COMMAND_STRING.test(block);
}

/** Scan one test source for non-empty-diff-against-a-moving-ref assertions. */
export function scanSourceForMovingRefDiffAssertions(source: string, file: string): MovingRefDiffHit[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const starts = [0];
  lines.forEach((l, i) => {
    if (i > 0 && BLOCK_START.test(l)) starts.push(i);
  });
  const hits: MovingRefDiffHit[] = [];
  for (let b = 0; b < starts.length; b++) {
    const from = starts[b]!;
    const to = b + 1 < starts.length ? starts[b + 1]! : lines.length;
    const blockLines = lines.slice(from, to);
    if (!diffsAgainstMovingRef(blockLines.join("\n"))) continue;
    blockLines.forEach((l, i) => {
      if (NON_EMPTY_ASSERTIONS.some((re) => re.test(l))) {
        hits.push({ file, line: from + i + 1, snippet: l.trim() });
      }
    });
  }
  return hits;
}

function collectTestFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectTestFiles(path, out);
    else if (/\.test\.[cm]?[jt]sx?$/.test(name)) out.push(path);
  }
}

/** Scan every `*.test.*` file under `testsDir` (recursively). */
export function scanMovingRefDiffAssertions(testsDir: string): MovingRefDiffHit[] {
  const files: string[] = [];
  collectTestFiles(testsDir, files);
  files.sort();
  return files.flatMap((f) => scanSourceForMovingRefDiffAssertions(readFileSync(f, "utf-8"), f));
}
