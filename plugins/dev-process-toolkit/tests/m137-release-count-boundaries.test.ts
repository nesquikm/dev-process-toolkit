// PR #76 adversarial review, finding C6 — SECOND RESOLUTION. The release
// entry's test count goes wrong at TWO boundaries, and the first attempt at a
// guard cost the whole gate twice over to watch only one of them.
//
// WHAT THE FIRST ATTEMPT GOT WRONG, stated plainly because the correction is
// what shapes this file:
//
//   The claim was "a CHANGELOG count cannot drift between releases; it can
//   only be wrong when written."  FALSE, and disproved by this very branch.
//   MEASURED against `f504493` (`chore(release): v2.75.0`):
//
//     commits landed after the release commit ....................  7
//     test files changed after the release commit ...............  11
//     count stated in the v2.75.0 entry .......................... 10708
//     count `bun test` reported when the review measured it ...... 10950
//
//   A write-time check alone would have verified 10708 HONESTLY at f504493
//   and been made wrong by the seven commits after it.
//
// AND WHAT THE FIRST ATTEMPT COST. `tests/changelog-release-test-count.test.ts`
// derived the measured side by spawning the real suite from inside the suite:
// 89.5s -> 178.4s, on every contributor's every run, forever, to catch a
// once-per-release staleness. Slow gates get skipped, and a guard that changes
// behaviour AWAY from running the gate costs more than it catches. It is
// deleted, and Group A keeps it deleted.
//
// THE TWO BOUNDARIES, each guarded where it is free:
//
//   PART 1 — THE WRITE BOUNDARY, in `/ship-milestone`'s pre-flight. That
//   surface ALREADY runs the gate (pre-flight refusal #3) and ALREADY parses
//   counts with `test_count_parser.ts` — the same module the CHANGELOG line is
//   written from. The measurement is therefore free there, and the guard pins
//   the PRODUCER rather than the artifact.
//
//   PART 2 — THE MERGE BOUNDARY, at `/pr` time, and it costs NO gate run: a
//   git query, not a test execution. `git diff --name-only <release>..HEAD --
//   '*.test.*'` is milliseconds. This is the procedure "the count must be the
//   last edit on the branch" made MECHANICAL.
//
//   PART 3 — a FRONT DOOR on `test_count_parser.ts`, which has none (measured:
//   0 `import.meta.main` occurrences, while both altitude scanners have 3).
//   Part 1 makes that module load-bearing for a release-blocking check while it
//   sits in the exact ordered-and-unreachable state that made C5 a finding.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. It never compares the stated count
// to a measured one. Deriving the number a second time — by counting test
// files, or by any second implementation of "how many tests are there" — is a
// number that can disagree with the gate, which is the defect being closed,
// reintroduced as its own fix. Every assertion below is about the two GUARDS,
// never about the artifact's current value.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkMergeBoundary,
  checkWriteBoundary,
  findLatestReleaseCommit,
  parseStatedTestCount,
  testFilesChangedSince,
} from "../adapters/_shared/src/release_test_count_guard";
import { parseTestOutput, type TestCount } from "../adapters/_shared/src/test_count_parser";
import { parseChangelogTop } from "../adapters/_shared/src/release_surface_agreement";
import {
  ORDERED_UNREACHABLE_PIN,
  classifyReferenceLine,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const TESTS_DIR = join(PLUGIN_ROOT, "tests");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const GUARD_MODULE = join(SHARED_SRC, "release_test_count_guard.ts");
const PARSER_MODULE = join(SHARED_SRC, "test_count_parser.ts");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const PR_SKILL = join(PLUGIN_ROOT, "skills", "pr", "SKILL.md");
const FOLLOW_UPS = join(REPO_ROOT, "specs", "notes", "follow-ups.md");

/** Repo-relative module keys, exactly as probe #81 records them. */
const GUARD_KEY = "adapters/_shared/src/release_test_count_guard.ts";
const PARSER_KEY = "adapters/_shared/src/test_count_parser.ts";

const DELETED_TEST = join(TESTS_DIR, "changelog-release-test-count.test.ts");

const read = (path: string): string => readFileSync(path, "utf-8");

// ---------------------------------------------------------------------------
// Temp-tree plumbing
// ---------------------------------------------------------------------------

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function run(argv: string[], opts: { cwd?: string; stdin?: string } = {}): Run {
  const proc = Bun.spawnSync(argv, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.stdin === undefined ? {} : { stdin: new TextEncoder().encode(opts.stdin) }),
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? -1,
  };
}

function git(cwd: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if ((proc.exitCode ?? -1) !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

/** A throwaway repository with a real history — no hooks, no remotes. */
function makeRepo(): string {
  const dir = tempDir("release-count-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "gate@example.invalid");
  git(dir, "config", "user.name", "Gate");
  git(dir, "config", "commit.gpgsign", "false");
  return dir;
}

function commit(repo: string, files: Record<string, string>, subject: string): string {
  for (const [rel, body] of Object.entries(files)) {
    const path = join(repo, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--no-verify", "-m", subject);
  return git(repo, "rev-parse", "HEAD").trim();
}

// ===========================================================================
// GROUP A — the subprocess test is gone, and the gate does not run the gate
// ===========================================================================

describe("C6/A — the gate no longer re-enters itself", () => {
  test("tests/changelog-release-test-count.test.ts is deleted", () => {
    expect(
      existsSync(DELETED_TEST),
      "the subprocess-running count test is back; it doubles gate wall time " +
        "(89.5s -> 178.4s) to watch one of the two boundaries this file guards " +
        "for free",
    ).toBe(false);
  });

  test("no test carries the re-entry guard env var any more", () => {
    // This file is excluded from its own scan: the prose above NAMES the
    // retired guard, and a pin that cannot mention its own subject is a pin
    // that cannot explain itself. Every other file is scanned.
    const self = import.meta.file;
    const carriers = readdirSync(TESTS_DIR)
      .filter((n) => n.endsWith(".ts") && n !== self)
      .filter((n) => read(join(TESTS_DIR, n)).includes("DPT_RELEASE_TEST_COUNT_CHILD"));
    expect(
      carriers,
      "a recursion-guard env var is the tell of a suite that spawns itself — " +
        "nothing in the gate should need one",
    ).toEqual([]);
  });

  test("no test spawns the WHOLE project gate from inside the project tree", () => {
    // Spawning `bun test` against a TEMP fixture project is fine and common
    // (`m136-ste-529` does it). What is forbidden is spawning the bare gate
    // with this repository as the working directory: that is the doubling.
    const bareGate = /\[\s*"bun",\s*"test"\s*\]/;
    const ownTree = /cwd:\s*(PLUGIN_ROOT|REPO_ROOT|pluginRoot|repoRoot)\b/;
    const offenders = readdirSync(TESTS_DIR)
      .filter((n) => n.endsWith(".ts"))
      .filter((n) => {
        const src = read(join(TESTS_DIR, n));
        return bareGate.test(src) && ownTree.test(src);
      });
    expect(
      offenders,
      "these files run `bun test` with the real repository as cwd — the gate " +
        "running the gate",
    ).toEqual([]);
  });
});

// ===========================================================================
// GROUP B — PART 1, the WRITE boundary
// ===========================================================================

describe("C6/B — the write boundary reads the CHANGELOG's stated count", () => {
  const CLOSING = (n: number, f = 0, e = 0): string =>
    `Total test count at release: ${n} tests, ${f} failures, ${e} errors.`;

  const entry = (version: string, count: string | null): string =>
    [
      `## [${version}] — 2026-09-01 — "Fixture"`,
      "",
      "### Fixed",
      "",
      "- something",
      "",
      ...(count === null ? [] : [count, ""]),
    ].join("\n");

  test("it reads the TOPMOST entry's count, not an older one", () => {
    const changelog = [entry("3.0.0", CLOSING(4242)), entry("2.9.0", CLOSING(1111))].join("\n");
    const stated = parseStatedTestCount(changelog);
    expect(stated).not.toBeNull();
    expect(stated!.total).toBe(4242);
    expect(stated!.failures).toBe(0);
    expect(stated!.errors).toBe(0);
  });

  test("the version it reports is the one the SHIPPED changelog parser reports", () => {
    // Derived on both sides: no second implementation of "which release is on
    // top" — the answer comes from `release_surface_agreement`, which already
    // owns that question.
    const changelog = [entry("3.0.0", CLOSING(4242)), entry("2.9.0", CLOSING(1111))].join("\n");
    expect(parseStatedTestCount(changelog)!.version).toBe(parseChangelogTop(changelog)!.version);
  });

  test("a topmost entry with no closing line reads as absent, not as zero", () => {
    const changelog = [entry("3.0.0", null), entry("2.9.0", CLOSING(1111))].join("\n");
    expect(
      parseStatedTestCount(changelog),
      "a missing line must be distinguishable from a stated 0 — a zero count " +
        "would compare unequal and refuse, which is a different verdict",
    ).toBeNull();
  });

  test("CRLF does not silently blind the reader", () => {
    // This repository has lost a whole transform to CRLF twice (M113, M114).
    const changelog = [entry("3.0.0", CLOSING(4242))].join("\n").replace(/\n/g, "\r\n");
    expect(parseStatedTestCount(changelog)?.total).toBe(4242);
  });
});

describe("C6/B — the write boundary refuses on mismatch and only on mismatch", () => {
  const measured = (total: number): TestCount => ({ total, failures: 0, errors: 0, skipped: 0 });

  const input = (stated: number, total: number) => ({
    milestone: "M999",
    version: "9.9.9",
    stated,
    measured: measured(total),
  });

  test("agreement passes with no message at all", () => {
    const result = checkWriteBoundary(input(10947, 10947));
    expect(result.ok).toBe(true);
    expect(result.message).toBeNull();
  });

  test("disagreement refuses", () => {
    expect(checkWriteBoundary(input(10708, 10947)).ok).toBe(false);
  });

  test("the refusal NAMES BOTH NUMBERS — a diff, not a chore", () => {
    // "the count is wrong" sends an author to run the gate by hand; "states
    // 10708, the gate reports 10947" is a diff.
    const message = checkWriteBoundary(input(10708, 10947)).message!;
    expect(message).toContain("10708");
    expect(message).toContain("10947");
  });

  test("both numbers are DERIVED — moving either moves the message", () => {
    // Kills the refusal that hard-codes a number, or interpolates one side
    // twice. Two mutations, each in one field only.
    const base = checkWriteBoundary(input(10708, 10947)).message!;
    const movedStated = checkWriteBoundary(input(10709, 10947)).message!;
    const movedMeasured = checkWriteBoundary(input(10708, 10948)).message!;
    expect(movedStated, "the stated side is not interpolated").not.toBe(base);
    expect(movedMeasured, "the measured side is not interpolated").not.toBe(base);
    expect(movedStated).not.toBe(movedMeasured);
  });

  test("it carries the canonical NFR-10 refusal shape", () => {
    const message = checkWriteBoundary(input(10708, 10947)).message!;
    expect(message.startsWith("/ship-milestone: ")).toBe(true);
    expect(message).toMatch(/^Remedy: /m);
    expect(message).toMatch(/^Context: .*skill=ship-milestone/m);
    expect(message).toMatch(/milestone=M999/);
    expect(message).toMatch(/version=9\.9\.9/);
  });

  test("the Remedy restates the line the release is about to write", () => {
    // The remedy must be executable: the exact closing line, with the measured
    // numbers already substituted, so the author can paste it.
    const message = checkWriteBoundary({
      milestone: "M999",
      version: "9.9.9",
      stated: 10708,
      measured: { total: 10947, failures: 0, errors: 0, skipped: 15 },
    }).message!;
    expect(message).toContain("Total test count at release: 10947 tests, 0 failures, 0 errors.");
  });
});

describe("C6/B — `/ship-milestone` carries the guard, and quotes it rather than restating it", () => {
  test("the skill names the guard module", () => {
    expect(
      read(SHIP_SKILL),
      `skills/ship-milestone/SKILL.md never names ${GUARD_KEY}; the write ` +
        `boundary is unwired`,
    ).toContain(GUARD_KEY);
  });

  test("the reference is an ORDER, graded by the shipped classifier", () => {
    // Not a hand-written phrase list: the same `classifyReferenceLine` probe
    // #81 uses decides whether the skill tells the reader to RUN this or
    // merely mentions it.
    const lines = read(SHIP_SKILL).split("\n").filter((l) => l.includes(GUARD_KEY));
    expect(lines.length, "no reference to grade").toBeGreaterThan(0);
    expect(
      lines.some((l) => classifyReferenceLine(l) === "ordered"),
      "every reference to the guard is descriptive — the pre-flight names a " +
        "module without ordering anybody to call it",
    ).toBe(true);
  });

  test("the pre-flight reuses the gate run it ALREADY made — it does not run a second", () => {
    // Refusal #3 already runs the project's test command once. The measured
    // side of the write boundary is that run's output, parsed by
    // `test_count_parser.ts`. A pre-flight that ran the gate twice would cost
    // exactly what the deleted test cost.
    const body = read(SHIP_SKILL);
    const window = body.slice(body.indexOf("## Pre-flight refusals"));
    expect(
      /same (gate )?run|already ran|run once|that same run|the run it already/i.test(window),
      "the pre-flight never says the measured count comes from the gate run " +
        "refusal #3 already made — nothing stops a second full gate run",
    ).toBe(true);
  });

  test("the skill's quoted refusal AGREES with the module, fragment for fragment", () => {
    // The module is the single source of this refusal's text (the
    // `pr_draft.ts` idiom). Every number-free fragment of what the module
    // renders must appear in the skill, so a later edit to one cannot drift
    // from the other. Splitting on digits is what lets the skill quote the
    // shape with `<N>`-style placeholders and still satisfy this.
    const rendered = checkWriteBoundary({
      milestone: "M999",
      version: "9.9.9",
      stated: 1,
      measured: { total: 2, failures: 0, errors: 0, skipped: 0 },
    }).message!;
    const fragments = rendered
      .split(/\d+/)
      .map((f) => f.trim())
      .filter((f) => f.length >= 24);
    expect(fragments.length, "the rendered refusal is too short to pin").toBeGreaterThan(0);
    const skill = read(SHIP_SKILL);
    for (const fragment of fragments) {
      expect(
        skill,
        `skills/ship-milestone/SKILL.md does not quote the guard's own wording:\n` +
          `  ${fragment}\nQuote the module's text (numbers may be placeholders) so ` +
          `the two cannot drift.`,
      ).toContain(fragment);
    }
  });
});

// ===========================================================================
// GROUP C — PART 2, the MERGE boundary
// ===========================================================================

// A TRAP MEASURED WHILE WRITING THESE TESTS, recorded so the next reader does
// not pay for it twice: `git log --grep` takes a BASIC regular expression by
// default, and `chore(release):` contains parentheses. Passing
// `--extended-regexp` turns those into a group, so `^chore(release):` matches
// the string `chorerelease:` and the search silently finds NOTHING — a release
// commit that exists reads as absent, and the whole guard goes quiet. Default
// (BRE) or `--fixed-strings` both work. The first draft of the implementation
// used ERE, and the "it finds the most recent release commit" leg below is what
// caught it.
describe("C6/C — the merge boundary is a git query", () => {
  test("it finds the most recent release commit", () => {
    const repo = makeRepo();
    commit(repo, { "a.txt": "1" }, "feat(x): first");
    const release = commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    const found = findLatestReleaseCommit(repo);
    expect(found).not.toBeNull();
    expect(found!.sha).toBe(release);
    cleanup();
  });

  test("a repository with no release commit is a verdict, not a crash", () => {
    const repo = makeRepo();
    commit(repo, { "a.txt": "1" }, "feat(x): first");
    expect(findLatestReleaseCommit(repo)).toBeNull();
    const result = checkMergeBoundary(repo);
    expect(result.stale).toBe(false);
    expect(result.releaseCommit).toBeNull();
    cleanup();
  });

  test("release commit IS HEAD — clean, the count was the last edit", () => {
    const repo = makeRepo();
    commit(repo, { "src/a.ts": "1", "src/a.test.ts": "x" }, "feat(x): first");
    commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    const result = checkMergeBoundary(repo);
    expect(result.stale).toBe(false);
    expect(result.commitsSince).toBe(0);
    expect(result.testFilesChanged).toEqual([]);
    expect(result.message).toBeNull();
    cleanup();
  });

  test("commits after the release but NO test file changed — still clean (the AND-rule)", () => {
    // Both conditions are required. A docs-only commit after the release
    // cannot move the count, and warning about it would train the operator to
    // ignore the warning.
    const repo = makeRepo();
    commit(repo, { "src/a.test.ts": "x" }, "feat(x): first");
    commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    commit(repo, { "README.md": "docs" }, "docs(readme): tidy");
    const result = checkMergeBoundary(repo);
    expect(result.commitsSince).toBe(1);
    expect(result.testFilesChanged).toEqual([]);
    expect(
      result.stale,
      "a commit that touches no test file cannot have moved the count",
    ).toBe(false);
    cleanup();
  });

  test("commits after the release AND a test file changed — it FIRES", () => {
    const repo = makeRepo();
    commit(repo, { "src/a.test.ts": "x" }, "feat(x): first");
    commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    commit(repo, { "src/b.test.ts": "y" }, "test(b): add");
    commit(repo, { "src/c.spec.test.js": "z" }, "test(c): add");
    const result = checkMergeBoundary(repo);
    expect(result.stale).toBe(true);
    expect(result.commitsSince).toBe(2);
    expect(result.testFilesChanged.sort()).toEqual(["src/b.test.ts", "src/c.spec.test.js"].sort());
    cleanup();
  });

  test("its answer IS the git command's answer — derived, not re-implemented", () => {
    const repo = makeRepo();
    commit(repo, { "src/a.test.ts": "x" }, "feat(x): first");
    const release = commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    commit(repo, { "src/b.test.ts": "y", "docs/x.md": "d" }, "test(b): add");
    const raw = git(repo, "diff", "--name-only", `${release}..HEAD`, "--", "*.test.*")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .sort();
    expect(testFilesChangedSince(repo, release).slice().sort()).toEqual(raw);
    cleanup();
  });

  test("the warning names the release commit, the commit count and the files", () => {
    const repo = makeRepo();
    commit(repo, { "src/a.test.ts": "x" }, "feat(x): first");
    const release = commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    commit(repo, { "src/b.test.ts": "y" }, "test(b): add");
    const message = checkMergeBoundary(repo).message!;
    expect(message, "no message on a stale branch is a silent skip").toBeTruthy();
    expect(message).toContain(release.slice(0, 7));
    expect(message).toContain("src/b.test.ts");
    expect(message).toMatch(/\b1\b/);
    cleanup();
  });

  test("the message is derived — a second changed test file changes it", () => {
    const repo = makeRepo();
    commit(repo, { "src/a.test.ts": "x" }, "feat(x): first");
    commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    commit(repo, { "src/b.test.ts": "y" }, "test(b): add");
    const one = checkMergeBoundary(repo).message!;
    commit(repo, { "src/c.test.ts": "z" }, "test(c): add");
    const two = checkMergeBoundary(repo).message!;
    expect(two, "the warning prints a fixed string").not.toBe(one);
    expect(two).toContain("src/c.test.ts");
    cleanup();
  });
});

describe("C6/C — it costs NO gate run", () => {
  test("the module never spawns the project's test command", () => {
    const src = read(GUARD_MODULE);
    expect(
      /"bun",\s*"test"|bun test\b/.test(src.replace(/^\s*\/\/.*$/gm, "")),
      "the merge-boundary guard runs the gate — the whole point is that it does not",
    ).toBe(false);
  });

  test("it answers on THIS repository in milliseconds, not minutes", () => {
    const started = Date.now();
    const result = checkMergeBoundary(REPO_ROOT);
    const elapsed = Date.now() - started;
    expect(result).toBeDefined();
    expect(
      elapsed,
      `the merge-boundary check took ${elapsed}ms; the gate it must not run ` +
        `takes ~92_000ms`,
    ).toBeLessThan(10_000);
  });

  test("on THIS repository it agrees with raw git, in whatever state the branch is", () => {
    // Deliberately NOT a literal verdict. This branch is stale today (7
    // commits, 11 test files past f504493) and will be clean the moment a
    // release commit lands on top; an assertion on the verdict would flip.
    // What must hold in BOTH states is that the module reports what git
    // reports.
    const result = checkMergeBoundary(REPO_ROOT);
    if (result.releaseCommit === null) return;
    const raw = git(REPO_ROOT, "diff", "--name-only", `${result.releaseCommit.sha}..HEAD`, "--", "*.test.*")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(result.testFilesChanged.slice().sort()).toEqual(raw.slice().sort());
    const count = Number(
      git(REPO_ROOT, "rev-list", "--count", `${result.releaseCommit.sha}..HEAD`).trim(),
    );
    expect(result.commitsSince).toBe(count);
    expect(result.stale).toBe(count > 0 && raw.length > 0);
  });
});

describe("C6/C — `/pr` carries the merge-boundary check", () => {
  test("the skill names the guard module", () => {
    expect(
      read(PR_SKILL),
      `skills/pr/SKILL.md never names ${GUARD_KEY} — the merge boundary is unwired`,
    ).toContain(GUARD_KEY);
  });

  test("the reference is an ORDER, graded by the shipped classifier", () => {
    const lines = read(PR_SKILL).split("\n").filter((l) => l.includes(GUARD_KEY));
    expect(lines.length, "no reference to grade").toBeGreaterThan(0);
    expect(
      lines.some((l) => classifyReferenceLine(l) === "ordered"),
      "`/pr` names the guard without ordering anybody to run it",
    ).toBe(true);
  });

  test("it runs BEFORE the PR is created", () => {
    const body = PR_SKILL_TEXT();
    const guardAt = body.indexOf(GUARD_KEY);
    const stepsAt = body.indexOf("## Steps");
    expect(guardAt, "the guard is not in skills/pr/SKILL.md").toBeGreaterThan(-1);
    expect(
      guardAt,
      "the merge-boundary check sits after `## Steps` — a warning that arrives " +
        "once the PR is open is a warning nobody acts on",
    ).toBeLessThan(stepsAt);
  });

  test("the shipped section order of skills/pr/SKILL.md is preserved", () => {
    const body = PR_SKILL_TEXT();
    const order = ["## Tracker Mode Probe", "## Ship-State Pre-Flight (Soft)", "## Steps", "## Notes"];
    let cursor = -1;
    for (const heading of order) {
      const at = body.indexOf(heading, cursor + 1);
      expect(at, `shipped heading lost or reordered: ${heading}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  test("the skill quotes the guard's own wording, fragment for fragment", () => {
    const repo = makeRepo();
    commit(repo, { "src/a.test.ts": "x" }, "feat(x): first");
    commit(repo, { "CHANGELOG.md": "## [1.0.0]" }, "chore(release): v1.0.0");
    commit(repo, { "src/b.test.ts": "y" }, "test(b): add");
    const rendered = checkMergeBoundary(repo).message!;
    cleanup();

    // Number-free AND path-free fragments: the sha, the counts and the file
    // list are all per-run values, so only the fixed wording is pinned.
    const fragments = rendered
      .split(/\n/)
      .flatMap((line) => line.split(/[0-9a-f]{7,}|src\/[^\s,]+/))
      .flatMap((piece) => piece.split(/\d+/))
      .map((f) => f.trim())
      .filter((f) => f.length >= 24);
    expect(fragments.length, "the rendered warning is too short to pin").toBeGreaterThan(0);
    const skill = read(PR_SKILL);
    for (const fragment of fragments) {
      expect(
        skill,
        `skills/pr/SKILL.md does not quote the guard's own wording:\n  ${fragment}`,
      ).toContain(fragment);
    }
  });
});

function PR_SKILL_TEXT(): string {
  return read(PR_SKILL);
}

// ===========================================================================
// GROUP D — PART 3, `test_count_parser.ts` gets a front door
// ===========================================================================

/**
 * REAL runner output, produced by really running the runner. A hand-typed
 * fixture would let the front door pass against a shape bun does not emit.
 */
function realBunOutput(testCount: number): string {
  const dir = tempDir("release-count-runner-");
  const bodies = Array.from(
    { length: testCount },
    (_, i) => `test("case ${i}", () => { expect(${i}).toBe(${i}); });`,
  );
  writeFileSync(
    join(dir, "fixture.test.ts"),
    ['import { expect, test } from "bun:test";', "", ...bodies, ""].join("\n"),
  );
  const proc = Bun.spawnSync(["bun", "test"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  return `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
}

/** Pull the four counters out of whatever the front door prints. */
function readPrinted(stdout: string): Partial<TestCount> {
  const grab = (key: string): number | undefined => {
    const m = new RegExp(`\\b${key}\\s*[=:]\\s*(\\d+)`, "i").exec(stdout);
    return m ? Number(m[1]) : undefined;
  };
  return {
    total: grab("total"),
    failures: grab("failures"),
    errors: grab("errors"),
    skipped: grab("skipped"),
  };
}

describe("C6/D — the parser has a command-line front door", () => {
  test("it carries an `import.meta.main` guard", () => {
    expect(
      read(PARSER_MODULE).includes("if (import.meta.main)"),
      `${PARSER_KEY} carries no \`import.meta.main\` guard. Part 1 makes it ` +
        `load-bearing for a release-blocking check while it sits in the exact ` +
        `ordered-and-unreachable shape that made C5 a finding.`,
    ).toBe(true);
  });

  test("importing it stays side-effect-free — the guard is what gates the run", () => {
    const result = run(["bun", "-e", `await import(${JSON.stringify(PARSER_MODULE)});`]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  test("it EXECUTES AND MEASURES — real runner output, derived expectation", () => {
    const output = realBunOutput(3);
    const expected = parseTestOutput(output, "bun");
    expect(expected.ok, "the fixture runner produced unparseable output").toBe(true);

    const file = join(tempDir("release-count-out-"), "out.txt");
    writeFileSync(file, output);
    const result = run(["bun", "run", PARSER_MODULE, "bun", file]);
    expect(result.exitCode, result.stderr).toBe(0);

    const printed = readPrinted(result.stdout);
    expect(
      printed.total,
      `the front door printed no readable total\nstdout:\n${result.stdout}`,
    ).toBe((expected as { ok: true; count: TestCount }).count.total);
    expect(printed.failures).toBe((expected as { ok: true; count: TestCount }).count.failures);
    expect(printed.errors).toBe((expected as { ok: true; count: TestCount }).count.errors);
    expect(printed.skipped).toBe((expected as { ok: true; count: TestCount }).count.skipped);
    cleanup();
  });

  test("it MEASURES rather than prints a constant — two runs, two totals", () => {
    // The vacuity this leg exists to kill: a front door that is reachable,
    // runnable, and always says the same thing.
    const dir = tempDir("release-count-out-");
    const totals: number[] = [];
    for (const n of [2, 5]) {
      const file = join(dir, `out-${n}.txt`);
      writeFileSync(file, realBunOutput(n));
      const result = run(["bun", "run", PARSER_MODULE, "bun", file]);
      expect(result.exitCode, result.stderr).toBe(0);
      totals.push(readPrinted(result.stdout).total!);
    }
    expect(totals[0]).toBe(2);
    expect(totals[1]).toBe(5);
    cleanup();
  });

  test("it reads stdin when handed no path", () => {
    const output = realBunOutput(4);
    const result = run(["bun", "run", PARSER_MODULE, "bun"], { stdin: output });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(readPrinted(result.stdout).total).toBe(4);
    cleanup();
  });

  test("unparseable input exits non-zero and says the parser's own reason", () => {
    const result = run(["bun", "run", PARSER_MODULE, "bun"], { stdin: "nothing countable here\n" });
    expect(result.exitCode, "a front door that reports success on garbage is worse than none")
      .not.toBe(0);
    const reason = parseTestOutput("nothing countable here\n", "bun");
    expect(reason.ok).toBe(false);
    expect(
      `${result.stdout}${result.stderr}`,
      "the failure text is not the parser's own — a second wording can drift",
    ).toContain((reason as { ok: false; reason: string }).reason);
  });
});

// ===========================================================================
// GROUP E — probe #81 stays green, both new doors included
// ===========================================================================

describe("C6/E — reachability after two new front doors", () => {
  test("no reference to either module is ordered-and-unreachable", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    for (const key of [GUARD_KEY, PARSER_KEY]) {
      const refs = report.records.filter((r) => r.module === key);
      expect(refs.length, `${key} is referenced by at least one shipped surface`).toBeGreaterThan(0);
      const stranded = refs.filter((r) => r.refClass === "ordered" && !r.reachable);
      expect(
        stranded.map((r) => `${r.surface}:${r.line}`),
        `an order naming ${key} that nobody can carry out`,
      ).toEqual([]);
    }
  }, 120_000);

  test("the pin equals the count the probe MEASURES, and the run is clean", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN} — ` +
        `re-measure and move the pin per the probe's own remedy; never raise it`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 120_000);
});

// ===========================================================================
// GROUP F — the residual is BANKED, not claimed closed
// ===========================================================================

describe("C6/F — the drift class is recorded in specs/notes/follow-ups.md", () => {
  /** The `###` entry containing this branch's measurement. */
  function entrySlice(): string {
    const body = read(FOLLOW_UPS);
    const at = body.indexOf("10708");
    expect(
      at,
      "specs/notes/follow-ups.md records no entry naming the measured drift " +
        "(10708 stated against 10950 measured). A residual claimed closed is " +
        "a residual nobody re-reads.",
    ).toBeGreaterThan(-1);
    const start = body.lastIndexOf("\n### ", at);
    const next = body.indexOf("\n### ", at);
    return body.slice(start < 0 ? 0 : start, next < 0 ? body.length : next);
  }

  test("the entry carries THIS branch's measurement, not a general worry", () => {
    const entry = entrySlice();
    expect(entry, "the release commit the drift is measured from").toContain("f504493");
    expect(entry, "the number of commits that landed past it").toMatch(/\b7 commits\b/);
    expect(entry, "the number of test files those commits changed").toMatch(/\b11 test files?\b/);
    expect(entry, "what the entry stated").toContain("10708");
    expect(entry, "what the gate reported").toContain("10950");
  });

  test("it says the count drifts when work continues past the release commit", () => {
    expect(
      /release commit/i.test(entrySlice()),
      "the entry never names the boundary the drift happens at",
    ).toBe(true);
  });

  test("it is BANKED, not claimed closed", () => {
    expect(
      /\bCLOSED\b/.test(entrySlice()),
      "the entry claims closure; the merge-boundary guard warns, it does not " +
        "make the stated count right",
    ).toBe(false);
  });

  test("it sits in the newest section — the file's newest-first convention", () => {
    const body = read(FOLLOW_UPS);
    expect(
      body.indexOf("10708"),
      "the new entry is filed below an older milestone's section",
    ).toBeLessThan(body.indexOf("## From M121 implementation"));
  });
});
