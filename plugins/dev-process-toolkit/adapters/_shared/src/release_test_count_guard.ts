// release_test_count_guard (M137, PR #76 review finding C6) — the CHANGELOG's
// per-release test count, guarded at BOTH boundaries it can go wrong at.
//
// The closing line of every release entry —
//
//     Total test count at release: <N> tests, <F> failures, <E> errors.
//
// — is hand-typed into a branch that keeps adding tests. It has gone stale
// twice, and it can go wrong twice over:
//
//   THE WRITE BOUNDARY. Wrong the moment `/ship-milestone` writes it, because
//   the number came from somewhere other than the gate run that release was
//   cut from. `parseStatedTestCount` + `checkWriteBoundary` close this one,
//   and they cost NOTHING: pre-flight refusal #3 already runs the project's
//   test command once and already parses its output with
//   `./test_count_parser`. The measured side of the comparison is that same
//   run's output. A second run would cost exactly what the deleted
//   `tests/changelog-release-test-count.test.ts` cost — 89.5s -> 178.4s on
//   every contributor's every gate run, forever, to watch a once-per-release
//   staleness.
//
//   THE MERGE BOUNDARY. Correct when written, then made wrong by the commits
//   that land on the branch afterwards. MEASURED on the branch this module
//   shipped from: 7 commits and 11 test files landed past `f504493`
//   (`chore(release): v2.75.0`), taking a count that was HONEST when written
//   (10708) to an actual 10950. `findLatestReleaseCommit` +
//   `testFilesChangedSince` + `checkMergeBoundary` close this one, and they
//   cost a git query — milliseconds, not minutes. This is the procedure "the
//   count must be the last edit on the branch" made mechanical.
//
// WHAT THIS MODULE NEVER DOES: derive the count a second time. Nothing here
// counts tests, counts test files, or executes the project's test command. A
// number produced any way other than by the gate is a number that can disagree
// with the gate, which is the defect being closed, reintroduced as its own fix.
// The write boundary compares the CHANGELOG's stated number against a
// `TestCount` its CALLER measured; the merge boundary never looks at a number
// at all, only at whether work landed past the release commit.
//
// A TRAP, MEASURED, recorded so nobody pays for it twice. `git log --grep`
// takes a BASIC regular expression, and `chore(release):` contains
// parentheses. Passing `--extended-regexp` turns those into a capture group,
// so `^chore(release):` matches the string `chorerelease:` and the search
// finds NOTHING — an existing release commit reads as absent and the whole
// merge-boundary guard goes silent while looking healthy. The search below is
// therefore BRE (git's default): no `-E`, no `--extended-regexp`, ever.

import { spawnSync } from "node:child_process";

import { parseChangelogTop } from "./release_surface_agreement";
import type { TestCount } from "./test_count_parser";

// ---------------------------------------------------------------------------
// The write boundary — what the CHANGELOG says
// ---------------------------------------------------------------------------

/** The count as STATED by the topmost CHANGELOG entry's closing line. */
export interface StatedTestCount {
  /** Bare semver of the entry the count was read out of. */
  version: string;
  total: number;
  failures: number;
  errors: number;
}

/**
 * The closing line, as `/ship-milestone` renders it. `skipped` is deliberately
 * absent: the shipped line reports exactly total / failures / errors (STE-508),
 * and a reader that demanded a fourth counter would read every shipped entry as
 * malformed.
 */
const CLOSING_LINE_RE =
  /Total test count at release:\s*(\d+)\s+tests?,\s*(\d+)\s+failures?,\s*(\d+)\s+errors?\./;

/** A versioned CHANGELOG heading, used only to bound the topmost ENTRY. */
const VERSIONED_HEADING = /^##\s+\[/;

/**
 * Fold CRLF to LF. This repository has lost a whole transform to CRLF twice
 * (M113's colon-only readers, M114's Linear checkbox push), and the reader
 * below is line-anchored, so it normalizes before it matches.
 *
 * NO BOM STRIP, deliberately — the same decision `./release_surface_agreement`
 * records for the same file, and for the same reason. Nothing here matches at
 * offset 0: the heading pattern is line-anchored but a CHANGELOG's first line
 * is its `# Title`, and the closing-line pattern is unanchored and matches
 * mid-file. A leading U+FEFF therefore cannot reach either match, and a strip
 * that cannot change an answer is a clause no test can fail.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Read the closing line out of the TOPMOST release entry of a CHANGELOG.
 *
 * `null` — not zero — when the topmost entry carries no closing line. A stated
 * 0 would compare unequal against any real gate run and refuse, which is a
 * different verdict from "this release states no count at all".
 *
 * WHICH ENTRY IS ON TOP is not decided here. `parseChangelogTop` from
 * `./release_surface_agreement` already owns that question, and its answer is
 * what this function reports as `version` — a second implementation of "which
 * release is newest" is exactly where the two would drift apart. This function
 * only bounds that entry's slice (heading to the next heading) and reads the
 * line inside it.
 */
export function parseStatedTestCount(changelog: string): StatedTestCount | null {
  const text = normalize(changelog);
  const top = parseChangelogTop(text);
  if (!top) return null;

  const lines = text.split("\n");
  const headings: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (VERSIONED_HEADING.test(lines[i]!)) headings.push(i);
  }
  // The slice belongs to the entry `parseChangelogTop` named, found by that
  // version rather than by position: a `## [Unreleased]` heading above it must
  // not silently redirect the read to a different entry's body.
  const startAt = headings.findIndex((i) => lines[i]!.includes(`[${top.version}]`) ||
    lines[i]!.includes(`[v${top.version}]`));
  if (startAt === -1) return null;
  const start = headings[startAt]!;
  const end = headings[startAt + 1] ?? lines.length;

  const m = CLOSING_LINE_RE.exec(lines.slice(start, end).join("\n"));
  if (!m) return null;
  return {
    version: top.version,
    total: Number(m[1]),
    failures: Number(m[2]),
    errors: Number(m[3]),
  };
}

/** What `/ship-milestone` knows when it is about to write the closing line. */
export interface WriteBoundaryInput {
  /** `M<N>` (or `M_<epic-key>`), for the `Context:` line. */
  milestone: string;
  /** The version being shipped, for the `Context:` line. */
  version: string;
  /** The number the CHANGELOG states — from `parseStatedTestCount`. */
  stated: number;
  /**
   * The number the GATE reported. Measured by the caller from the run
   * pre-flight refusal #3 already made, parsed by `./test_count_parser`. This
   * module never runs a gate and never counts anything.
   */
  measured: TestCount;
}

export interface WriteBoundaryResult {
  ok: boolean;
  /** `null` on agreement — a passing check says nothing at all. */
  message: string | null;
}

/**
 * Compare the stated count against the measured one and render the refusal.
 *
 * THIS MODULE IS THE SINGLE SOURCE OF THAT REFUSAL'S TEXT — the `pr_draft.ts`
 * idiom. `skills/ship-milestone/SKILL.md` quotes the shape below rather than
 * restating it, and the suite pins every number-free fragment of what this
 * renders against that skill, so an edit to one cannot drift from the other.
 *
 * BOTH NUMBERS ARE NAMED, and both are interpolated. "The count is wrong"
 * sends an author off to run the gate by hand; "states 10708, the gate reports
 * 10950" is a diff. And the Remedy restates the whole closing line with the
 * measured numbers already substituted, so it can be pasted rather than
 * reassembled.
 */
export function checkWriteBoundary(input: WriteBoundaryInput): WriteBoundaryResult {
  const { milestone, version, stated, measured } = input;
  if (stated === measured.total) return { ok: true, message: null };

  const closing =
    `Total test count at release: ${measured.total} tests, ` +
    `${measured.failures} failures, ${measured.errors} errors.`;

  return {
    ok: false,
    message: [
      `/ship-milestone: the CHANGELOG closing line states ${stated} tests; ` +
        `the gate run reports ${measured.total}.`,
      `Remedy: rewrite the closing line to read \`${closing}\` — the count ` +
        `must be the last edit on the branch.`,
      `Context: milestone=${milestone}, version=${version}, stated=${stated}, ` +
        `measured=${measured.total}, skill=ship-milestone`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// The merge boundary — what landed after the count was written
// ---------------------------------------------------------------------------

/** The release commit the stated count was measured at. */
export interface ReleaseCommit {
  /** Full 40-character object name. */
  sha: string;
  /** Its subject line, for diagnostics. */
  subject: string;
}

/**
 * The release-commit subject, as a BASIC regular expression. Read the trap at
 * the head of this file before touching it: under `--extended-regexp` the
 * parentheses become a group and this pattern matches nothing.
 */
const RELEASE_SUBJECT_BRE = "^chore(release):";

/** Field separator inside `--format`; never appears in a subject. */
const FS = "\u001f";

/**
 * Run git and hand back stdout, or `null` when git could not answer — a
 * directory that is not a repository, a repository with no commits, a missing
 * binary. Every caller treats `null` as "no verdict", never as a crash: a
 * guard that throws on an unusual tree is a guard that gets removed.
 */
function gitOut(repo: string, args: string[]): string | null {
  try {
    const proc = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
    if (proc.error || proc.status !== 0) return null;
    return proc.stdout ?? "";
  } catch {
    return null;
  }
}

/**
 * The most recent `chore(release):` commit reachable from HEAD, or `null` when
 * the branch carries none (a fresh repository, a fork that never released).
 */
export function findLatestReleaseCommit(repo: string): ReleaseCommit | null {
  const out = gitOut(repo, [
    "log",
    "-n",
    "1",
    "--grep",
    RELEASE_SUBJECT_BRE,
    `--format=%H${FS}%s`,
  ]);
  if (out === null) return null;
  const line = out.split("\n")[0]?.trim() ?? "";
  if (line === "") return null;
  const [sha, subject] = line.split(FS);
  if (!sha) return null;
  return { sha, subject: subject ?? "" };
}

/**
 * Every test file changed between `sha` and HEAD, as git reports it.
 *
 * DERIVED, not re-implemented: the answer IS `git diff --name-only
 * <sha>..HEAD -- '*.test.*'`. Nothing here walks the tree, matches names, or
 * decides what a test file is — a second definition of "test file" is a second
 * thing to keep in sync.
 */
export function testFilesChangedSince(repo: string, sha: string): string[] {
  const out = gitOut(repo, ["diff", "--name-only", `${sha}..HEAD`, "--", "*.test.*"]);
  if (out === null) return [];
  return out.split("\n").filter((l) => l.trim() !== "");
}

/** How many commits landed after the release commit. */
function commitsSinceCount(repo: string, sha: string): number {
  const out = gitOut(repo, ["rev-list", "--count", `${sha}..HEAD`]);
  if (out === null) return 0;
  const n = Number(out.trim());
  return Number.isFinite(n) ? n : 0;
}

export interface MergeBoundaryResult {
  /** Commits landed past the release commit AND at least one was a test file. */
  stale: boolean;
  releaseCommit: ReleaseCommit | null;
  commitsSince: number;
  testFilesChanged: string[];
  /** `null` unless `stale` — a silent skip is worse than a loud failure, and a
   * warning on a clean branch is worse than both: it trains the reader to
   * ignore the warning. */
  message: string | null;
}

/**
 * The merge-boundary verdict for a repository, at `/pr` time.
 *
 * BOTH CONDITIONS ARE REQUIRED (the AND-rule). Commits past the release commit
 * that touch no test file cannot have moved the count, and warning about them
 * is how a guard gets ignored. A repository with no release commit at all is a
 * verdict — `stale: false`, `releaseCommit: null` — never a crash.
 *
 * COSTS NO GATE RUN. Three git queries, milliseconds. Nothing here executes
 * the project's tests; the first attempt at this guard did, and it doubled the
 * gate's wall time for every contributor forever.
 */
export function checkMergeBoundary(repo: string): MergeBoundaryResult {
  const releaseCommit = findLatestReleaseCommit(repo);
  if (releaseCommit === null) {
    return {
      stale: false,
      releaseCommit: null,
      commitsSince: 0,
      testFilesChanged: [],
      message: null,
    };
  }

  const commitsSince = commitsSinceCount(repo, releaseCommit.sha);
  const testFilesChanged = testFilesChangedSince(repo, releaseCommit.sha);
  const stale = commitsSince > 0 && testFilesChanged.length > 0;

  return {
    stale,
    releaseCommit,
    commitsSince,
    testFilesChanged,
    message: stale ? renderMergeBoundaryWarning(releaseCommit, commitsSince, testFilesChanged) : null,
  };
}

/**
 * The warning `/pr` prints. As with the write boundary, this module is the
 * single source of its wording and `skills/pr/SKILL.md` quotes it; every
 * fixed fragment is pinned against that skill by the suite.
 *
 * Every figure is derived — the release commit, the commit count, the file
 * count and the file list — so a second changed test file changes the text. A
 * warning that prints the same string whatever happened is a warning that
 * proves nothing was measured.
 */
function renderMergeBoundaryWarning(
  release: ReleaseCommit,
  commitsSince: number,
  testFilesChanged: readonly string[],
): string {
  const short = release.sha.slice(0, 7);
  return [
    `/pr: the CHANGELOG test count was written at ${short}; work has landed on top of it since.`,
    `  commits since the release commit: ${commitsSince}`,
    `  test files changed since it: ${testFilesChanged.length}`,
    ...testFilesChanged.map((f) => `  - ${f}`),
    `The stated count cannot describe this branch — it was measured before those commits.`,
    `Remedy: re-run the gate and rewrite the topmost CHANGELOG entry's closing line, ` +
      `then amend the release commit; or open this PR and let the release ship after it merges.`,
    `Context: release=${short}, commits-since=${commitsSince}, ` +
      `test-files-changed=${testFilesChanged.length}, skill=pr`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Command-line front door
// ---------------------------------------------------------------------------

// Read-only, and it SPEAKS FOR THE MERGE BOUNDARY, which is the half that can
// be answered from a checkout alone: the write boundary needs a gate run's
// output, which only its caller has. Prints the warning verbatim when the
// branch is stale, one `clean` line naming the release commit when it is not,
// and one `no release commit` line when the branch carries none — three
// distinguishable verdicts, because "nothing printed" is not a statement.
//
// Imported by `/ship-milestone`'s and `/pr`'s callers and by the suite, where
// `import.meta.main` is false and this block never runs: the module stays
// side-effect-free at import.
if (import.meta.main) {
  const repo = process.argv[2] ?? process.cwd();
  const result = checkMergeBoundary(repo);
  if (result.releaseCommit === null) {
    console.log("no release commit on this branch — nothing to compare against");
  } else if (result.message !== null) {
    console.log(result.message);
  } else {
    console.log(
      `clean: the count was the last edit at ${result.releaseCommit.sha.slice(0, 7)} ` +
        `(${result.commitsSince} commits since, 0 test files changed)`,
    );
  }
}
