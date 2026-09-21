// STE-597 — `commit_target_repo`: resolve the repository a commit will WRITE TO.
//
// The defect this module exists to close: both pre-commit hooks decided what to
// check by looking at the directory their own process happened to sit in, and
// recognised a commit only through `/^git commit\b/` — a matcher that misses
// `cd <dir> && git commit` and `git -C <dir> commit` entirely. It refused the
// careful path and permitted the careless one.
//
// AC-STE-597.1 — three command shapes, each resolving a target repository.
// AC-STE-597.4 — an unresolvable target is named, never refused.
// AC-STE-597.5 — every clause here is falsifiable against its sibling: the
//   RETIRED predicate is pinned LITERALLY below and asserted NOT to match the
//   two shapes the new resolver does match. That is the recorded direction.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkoutRootOf,
  resolveCommitTarget,
  type CommitCommandShape,
  type CommitTarget,
} from "../adapters/_shared/src/commit_target_repo";

// ---------------------------------------------------------------------------
// The retired predicate, pinned LITERALLY (AC-STE-597.5).
//
// This is the exact regex both pre-commit hooks carried before STE-597. It is
// reproduced here, not imported, precisely so it CANNOT be quietly widened: if
// somebody "fixes" the old matcher instead of replacing it, this file still
// grades the old bytes and still records which shapes they missed.
// ---------------------------------------------------------------------------
const RETIRED_PRE_CHANGE_MATCHER = /^git commit\b/;

// The three shapes, as one table so every clause below is applied to all three.
const BARE = "git commit -m x";
const CD_PREFIXED = "cd /s/b && git commit -m x";
const DASH_C = "git -C /s/b commit -m x";

/**
 * An INJECTED checkout resolver over a fixed directory→root map, so none of
 * these cases needs a real git checkout. Any directory not in the map is
 * "inside no checkout" and answers null — the AC-STE-597.4 unresolvable leg.
 */
function fakeRoots(map: Record<string, string>): (dir: string) => string | null {
  return (dir: string) => map[dir] ?? null;
}

const ROOTS = fakeRoots({
  "/s/a": "/s/a",
  "/s/a/sub": "/s/a",
  "/s/b": "/s/b",
  "/s/b/sub": "/s/b",
  "/s/c": "/s/c",
});

// ---------------------------------------------------------------------------
// AC-STE-597.1 — the three shapes resolve the repository the commit writes to.
// ---------------------------------------------------------------------------

describe("AC-STE-597.1 — three command shapes, each resolving its target repo", () => {
  test("bare form resolves the SESSION cwd's checkout root", () => {
    const t = resolveCommitTarget(BARE, "/s/a/sub", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("`cd <dir> && git commit` resolves the CD TARGET's checkout root, not the session's", () => {
    const t = resolveCommitTarget(CD_PREFIXED, "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    // The whole defect in one assertion: the session sits in /s/a, the commit
    // lands in /s/b.
    expect(t.repoRoot).toBe("/s/b");
    expect(t.repoRoot).not.toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("`git -C <dir> commit` resolves the -C TARGET's checkout root, not the session's", () => {
    const t = resolveCommitTarget(DASH_C, "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe("/s/b");
    expect(t.repoRoot).not.toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("a cd target inside a checkout resolves UP to that checkout's root", () => {
    const t = resolveCommitTarget("cd /s/b/sub && git commit -m x", "/s/a", ROOTS);
    expect(t.shape).toBe("cd-prefixed");
    expect(t.repoRoot).toBe("/s/b");
  });

  test("CONTROL — the three shapes disagree about the target, so the resolver is not returning a constant", () => {
    const bare = resolveCommitTarget(BARE, "/s/a", ROOTS).repoRoot;
    const cd = resolveCommitTarget(CD_PREFIXED, "/s/a", ROOTS).repoRoot;
    const dashC = resolveCommitTarget(DASH_C, "/s/a", ROOTS).repoRoot;
    expect(bare).toBe("/s/a");
    expect(cd).toBe("/s/b");
    expect(dashC).toBe("/s/b");
    expect(new Set([bare, cd, dashC]).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.5 — the recorded direction: RETIRED matcher vs the new resolver.
// ---------------------------------------------------------------------------

describe("AC-STE-597.5 — recorded direction: the retired `/^git commit\\b/` matcher vs the resolver", () => {
  test("CONTROL — the retired matcher CAN hit: it matches the bare form", () => {
    // Without this control every "does not match" assertion below would be a
    // claim rather than evidence — a regex that matched nothing would satisfy
    // them all.
    expect(RETIRED_PRE_CHANGE_MATCHER.test(BARE)).toBe(true);
  });

  test("the retired matcher MISSES the cd-prefixed form — the bypass, stated as a fact", () => {
    expect(RETIRED_PRE_CHANGE_MATCHER.test(CD_PREFIXED)).toBe(false);
    expect(resolveCommitTarget(CD_PREFIXED, "/s/a", ROOTS).isCommit).toBe(true);
  });

  test("the retired matcher MISSES the `-C` form — the same bypass, second spelling", () => {
    expect(RETIRED_PRE_CHANGE_MATCHER.test(DASH_C)).toBe(false);
    expect(resolveCommitTarget(DASH_C, "/s/a", ROOTS).isCommit).toBe(true);
  });

  test("the retired matcher and the resolver AGREE on the bare form (no behaviour weakened)", () => {
    expect(RETIRED_PRE_CHANGE_MATCHER.test(BARE)).toBe(true);
    expect(resolveCommitTarget(BARE, "/s/a", ROOTS).isCommit).toBe(true);
  });

  test("the retired matcher and the resolver AGREE that `git status` is not a commit", () => {
    expect(RETIRED_PRE_CHANGE_MATCHER.test("git status")).toBe(false);
    expect(resolveCommitTarget("git status", "/s/a", ROOTS).isCommit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.1 (negative half) — commands that only MENTION a commit.
// ---------------------------------------------------------------------------

const NON_COMMIT_COMMANDS: readonly string[] = [
  "ls",
  "git status",
  "git log --grep='git commit'",
  "echo git commit",
  "git log --oneline",
  "cd /s/b && git status",
  // STE-597 AUDIT — the four below are why this clause is not as narrow as it
  // reads. Every entry above mentions a commit inside a quoted word that holds
  // NO shell operator, so a splitter that ignored quotes entirely would still
  // pass all of them. These put an operator (or a comment) inside the quoted
  // mention, which is where a quote-blind splitter hands the tail of the quote
  // back as its own segment and the guard OVER-REFUSES a command that commits
  // nothing. The FR's Risks table promises "the new matches are only ever
  // commit-bearing commands"; that promise is graded here.
  'echo "x && git commit"',
  'git log --grep="a && git commit"',
  "echo 'x; git commit'",
  "git status # git commit",
];

describe("AC-STE-597.1 — a command that merely mentions a commit is not a commit", () => {
  for (const cmd of NON_COMMIT_COMMANDS) {
    test(`\`${cmd}\` → isCommit false, shape "none"`, () => {
      const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
      expect(t.isCommit).toBe(false);
      expect(t.shape).toBe("none");
    });
  }

  test("CONTROL — the same session cwd DOES yield a commit for the bare form, so the negatives are not vacuous", () => {
    expect(resolveCommitTarget(BARE, "/s/a", ROOTS).isCommit).toBe(true);
  });

  test("CONTROL — a quoted operator in the COMMIT MESSAGE is still a commit: the tightening did not go too far", () => {
    // The mirror image of the four fixtures added above. Here the `&&` inside
    // the quotes belongs to a command that really does commit, and refusing to
    // see it would trade over-refusal for a bypass — the exact swap this FR
    // exists to stop making.
    const t = resolveCommitTarget("cd /s/b && git commit -m 'a && b'", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    expect(t.repoRoot).toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a quoted semicolon in the commit message is a commit too, and a quoted `#` is not a comment", () => {
    const semi = resolveCommitTarget('git -C /s/b commit -m "a; b"', "/s/a", ROOTS);
    expect(semi.isCommit).toBe(true);
    expect(semi.repoRoot).toBe("/s/b");

    const hash = resolveCommitTarget('git -C /s/b commit -m "fixes #12"', "/s/a", ROOTS);
    expect(hash.isCommit).toBe(true);
    expect(hash.repoRoot).toBe("/s/b");
  });

  test('shape is "none" if and only if isCommit is false, across every case in this file', () => {
    const all: readonly string[] = [
      ...NON_COMMIT_COMMANDS,
      BARE,
      CD_PREFIXED,
      DASH_C,
      'cd "$REPO" && git commit -m x',
      "cd /s/nowhere && git commit -m x",
    ];
    const seen: CommitCommandShape[] = [];
    for (const cmd of all) {
      const t: CommitTarget = resolveCommitTarget(cmd, "/s/a", ROOTS);
      expect(t.shape === "none").toBe(t.isCommit === false);
      seen.push(t.shape);
    }
    // CONTROL: the loop above is only meaningful if both sides actually occur.
    expect(seen).toContain("none");
    expect(seen).toContain("bare");
    expect(seen).toContain("cd-prefixed");
    expect(seen).toContain("dash-c");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.4 — unresolvable targets are NAMED, never refused.
// ---------------------------------------------------------------------------

describe("AC-STE-597.4 — an unresolvable commit target is still a commit, with the cause named", () => {
  test("a `cd` whose argument is a shell expansion is unresolvable and names the expansion", () => {
    const t = resolveCommitTarget('cd "$REPO" && git commit -m x', "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(typeof t.unresolved).toBe("string");
    expect((t.unresolved ?? "").length).toBeGreaterThan(0);
    expect(t.unresolved).toContain("$REPO");
  });

  test("the braced spelling `${REPO}` is unresolvable too", () => {
    const t = resolveCommitTarget("cd ${REPO}/pkg && git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("REPO");
  });

  test("a target directory inside no checkout is unresolvable and names the directory", () => {
    const t = resolveCommitTarget("cd /s/nowhere && git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("/s/nowhere");
  });

  test("a bare commit from a session cwd inside no checkout is unresolvable and names it", () => {
    const t = resolveCommitTarget(BARE, "/s/nowhere", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("/s/nowhere");
  });

  test("TWO DIFFERENT commit targets in one command is unresolvable and names both", () => {
    const t = resolveCommitTarget(
      "git -C /s/b commit -m x && git -C /s/c commit -m y",
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("/s/b");
    expect(t.unresolved).toContain("/s/c");
  });

  test("CONTROL — the SAME target twice resolves, so the clause above grades disagreement, not arity", () => {
    const t = resolveCommitTarget(
      "git -C /s/b commit -m x && git -C /s/b commit -m y",
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("`unresolved` is non-null if and only if `repoRoot` is null, across resolvable and unresolvable cases", () => {
    const cases: readonly string[] = [
      BARE,
      CD_PREFIXED,
      DASH_C,
      'cd "$REPO" && git commit -m x',
      "cd /s/nowhere && git commit -m x",
      "git -C /s/b commit -m x && git -C /s/c commit -m y",
    ];
    const roots: (string | null)[] = [];
    for (const cmd of cases) {
      const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
      expect(t.unresolved === null).toBe(t.repoRoot !== null);
      roots.push(t.repoRoot);
    }
    // CONTROL: both sides of the biconditional have to occur, or it is vacuous.
    expect(roots.filter((r) => r === null).length).toBeGreaterThan(0);
    expect(roots.filter((r) => r !== null).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.4 (AUDIT) — `--git-dir` / `--work-tree` name a repository this
// resolver cannot reason about, and the honest answer is to say so.
//
// The global-option scan skips `--git-dir <value>` as a two-token pair, so the
// `=`-joined spelling escapes it entirely and the commit is attributed to the
// SESSION's checkout root — a confident answer about the wrong repository,
// which is worse than no answer. The space-separated spelling is skipped and
// then forgotten, which lands in the same place.
// ---------------------------------------------------------------------------

describe("AC-STE-597.4 — `--git-dir` / `--work-tree` are unresolvable, never the session's repo", () => {
  const REPO_NAMING_OPTIONS: ReadonlyArray<readonly [string, string]> = [
    ["git --git-dir=/other/.git commit -m x", "--git-dir"],
    ["git --work-tree=/other commit -m x", "--work-tree"],
    ["git --git-dir /other/.git commit -m x", "--git-dir"],
  ];

  for (const [cmd, option] of REPO_NAMING_OPTIONS) {
    test(`\`${cmd}\` → a commit, repoRoot null, and \`${option}\` named in \`unresolved\``, () => {
      const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
      // Still a commit — this is not a licence to wave it through.
      expect(t.isCommit).toBe(true);
      // But the session's own checkout is NOT where it lands, and answering
      // "/s/a" would be the guard classifying the wrong tree with confidence.
      expect(t.repoRoot).toBe(null);
      expect(t.repoRoot).not.toBe("/s/a");
      expect(t.unresolved).toContain(option);
    });
  }

  test("CONTROL — the same session cwd DOES resolve for a bare commit, so the nulls above are the OPTION's doing", () => {
    const t = resolveCommitTarget(BARE, "/s/a", ROOTS);
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — `-C` still resolves: the unresolvable leg did not swallow the shape that CAN be resolved", () => {
    const t = resolveCommitTarget(DASH_C, "/s/a", ROOTS);
    expect(t.repoRoot).toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — `git --git-dir=/other/.git status` is not a commit at all", () => {
    // Without this, the clauses above would also pass for a resolver that
    // treated any `--git-dir` sighting as a commit it could not place.
    const t = resolveCommitTarget("git --git-dir=/other/.git status", "/s/a", ROOTS);
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — `-c key=value` is a CONFIG option, not a repository, and still resolves", () => {
    // `-c` sits in the same global-option table as `--git-dir`, but it names no
    // tree. A fix that turned every `=`-joined global option into "unresolvable"
    // would red this.
    const t = resolveCommitTarget("git -c commit.gpgsign=false commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// `checkoutRootOf` against a real filesystem.
// ---------------------------------------------------------------------------

describe("STE-597 — checkoutRootOf walks up to the first directory holding `.git`", () => {
  test("a nested directory resolves to the checkout root", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-597-croot-"));
    try {
      mkdirSync(join(root, ".git"), { recursive: true });
      mkdirSync(join(root, "a", "b"), { recursive: true });
      expect(checkoutRootOf(join(root, "a", "b"))).toBe(root);
      expect(checkoutRootOf(root)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a LINKED WORKTREE — where `.git` is a FILE, not a directory — resolves to itself", () => {
    // This is the shape AC-STE-597.2's pairing runs on. A resolver that tested
    // for a `.git` DIRECTORY would walk straight past a worktree root.
    const root = mkdtempSync(join(tmpdir(), "ste-597-wt-"));
    try {
      writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/w\n");
      mkdirSync(join(root, "src"), { recursive: true });
      expect(checkoutRootOf(join(root, "src"))).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("CONTROL — a directory inside no checkout resolves to null", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-597-nogit-"));
    try {
      mkdirSync(join(root, "a"), { recursive: true });
      expect(checkoutRootOf(join(root, "a"))).toBe(null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// STE-597 Phase 3 Stage B (Pass 2) — FINDING A.
//
// This module's own header says a confident answer about the WRONG repository
// is worse than no answer. Two shapes still give one:
//
//   1. `(cd /other && git commit -m x)` — a parenthesised subshell, the ordinary
//      idiom for scoping a `cd`. The splitter has no notion of `(` or `)`, so
//      the first segment tokenizes to ["(cd", "/other"], `"(cd"` is not the
//      literal `"cd"` the cd-branch tests for, the directory change is dropped
//      in silence, and the commit is attributed to the SESSION's tree.
//   2. `git -C /a -C sub commit -m x` — real git CHAINS repeated `-C`, each one
//      resolved against the previous. `parseGit` keeps only the LAST and
//      resolves it against the session cwd, answering `/s/sub` for a session
//      at `/s`.
//
// Both are graded for the CORRECT target, not merely for "unresolvable", and
// the honesty rule is pinned underneath them for the shapes that genuinely
// cannot be resolved.
// ---------------------------------------------------------------------------

/**
 * A second checkout map whose SUBDIRECTORIES are checkouts in their own right.
 *
 * `ROOTS` maps `/s/b/sub` up to `/s/b`, which would let a resolver that chained
 * `-C` correctly and one that resolved the tail against the session cwd agree
 * on some inputs. Here every directory is its own root, so a clause can pin the
 * exact directory the commit lands in rather than merely "not the session's".
 */
const NESTED_ROOTS = fakeRoots({
  "/s/a": "/s/a",
  "/s/a/sub": "/s/a/sub",
  "/s/b": "/s/b",
  "/s/b/sub": "/s/b/sub",
  "/s/c": "/s/c",
});

describe("AC-STE-597.1 — a parenthesised subshell scopes the `cd`, and the commit follows it", () => {
  test("`(cd <dir> && git commit -m x)` resolves the SUBSHELL's directory, not the session's", () => {
    const t = resolveCommitTarget("(cd /s/b && git commit -m x)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    // The finding in one assertion: the commit runs inside the subshell, so it
    // writes to /s/b. Answering /s/a is a confident answer about the wrong repo.
    expect(t.repoRoot).toBe("/s/b");
    expect(t.repoRoot).not.toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("the closing paren glued to the subcommand is still a commit", () => {
    // With no trailing `-m x` the close paren lands on the SUBCOMMAND token,
    // which is where a fix that only stripped a leading `(` would hand back
    // `commit)` and see no commit at all.
    const t = resolveCommitTarget("(cd /s/b && git commit)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("a NESTED subshell resolves to the INNERMOST directory the commit runs in", () => {
    const t = resolveCommitTarget(
      "(cd /s/b && (cd /s/c && git commit -m x))",
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/c");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a `cd` in a subshell that does NOT contain the commit leaves the target alone", () => {
    // `(cd /s/b) && git commit -m x`: the subshell exits before the commit
    // runs, so the commit writes to the SESSION's repo. Judged RESOLVABLE, and
    // deliberately so — it is the same modelling as the clause above (a paren
    // is a scope boundary), just read in the other direction. This clause is
    // the control for that one: a resolver that always applied the `cd` would
    // answer /s/b here, and one that never applied it would answer /s/a above.
    // Only a resolver that models the scope passes both.
    const t = resolveCommitTarget("(cd /s/b) && git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/a");
    expect(t.repoRoot).not.toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("the subshell's `cd` does not leak past its closing paren — two targets, so UNRESOLVABLE", () => {
    // First commit lands in /s/b (inside the subshell), second in /s/a (after
    // it). Two different repositories in one command is exactly the case this
    // module already refuses to guess about, and it only arises if the scope
    // is restored on `)`.
    const t = resolveCommitTarget(
      "(cd /s/b && git commit -m x) && git commit -m y",
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("/s/b");
    expect(t.unresolved).toContain("/s/a");
  });

  test("AC-STE-597.5 — the retired matcher misses the subshell form too (recorded direction)", () => {
    expect(RETIRED_PRE_CHANGE_MATCHER.test("(cd /s/b && git commit -m x)")).toBe(false);
    expect(
      resolveCommitTarget("(cd /s/b && git commit -m x)", "/s/a", ROOTS).isCommit,
    ).toBe(true);
  });

  test("CONTROL — parens inside a QUOTED word are data: the commit message keeps its brackets", () => {
    // The mirror of the tightening. A fix that treated every `(` as a scope
    // opener would break a commit whose message contains one.
    const t = resolveCommitTarget('git commit -m "(cd /s/b && oops)"', "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a quoted subshell that commits NOTHING is still not a commit", () => {
    const t = resolveCommitTarget('echo "(cd /s/b && git commit)"', "/s/a", ROOTS);
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });
});

describe("AC-STE-597.1 — repeated `-C` CHAINS, the way git resolves it", () => {
  test("`git -C /a -C sub commit` resolves to /a/sub, not the session's /s/sub", () => {
    const t = resolveCommitTarget("git -C /s/b -C sub commit -m x", "/s/a", NESTED_ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe("/s/b/sub");
    // The two wrong answers, named: the session-relative one the parser gives
    // today, and the "kept only the first" one.
    expect(t.repoRoot).not.toBe("/s/a/sub");
    expect(t.repoRoot).not.toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("an ABSOLUTE later `-C` wins outright, as git resolves it", () => {
    const t = resolveCommitTarget("git -C /s/b -C /s/c commit -m x", "/s/a", NESTED_ROOTS);
    expect(t.repoRoot).toBe("/s/c");
    expect(t.unresolved).toBe(null);
  });

  test("the GLUED spelling chains identically", () => {
    const t = resolveCommitTarget("git -C/s/b -Csub commit -m x", "/s/a", NESTED_ROOTS);
    expect(t.repoRoot).toBe("/s/b/sub");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a SINGLE relative `-C` still resolves against the session cwd", () => {
    // Without this the chaining clause would also pass for a resolver that had
    // simply stopped reading the session directory for a relative `-C`.
    const t = resolveCommitTarget("git -C sub commit -m x", "/s/a", NESTED_ROOTS);
    expect(t.repoRoot).toBe("/s/a/sub");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a single relative `-C` after a `cd` resolves against the CD TARGET", () => {
    const t = resolveCommitTarget("cd /s/b && git -C sub commit -m x", "/s/a", NESTED_ROOTS);
    expect(t.repoRoot).toBe("/s/b/sub");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — an unexpanded word ANYWHERE in the chain is unresolvable, never a guess", () => {
    const t = resolveCommitTarget("git -C /s/b -C $SUB commit -m x", "/s/a", NESTED_ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("SUB");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-597.4 — the honesty rule, stated once for everything unmodelled.
//
// This is the clause that protects the shapes this parser does NOT model: it
// may answer, or it may say it cannot, but it may never answer CONFIDENTLY
// about a repository it has not established. Unbalanced parentheses are the
// worked example: the extent of the subshell is not knowable, so neither is the
// directory the commit runs in.
// ---------------------------------------------------------------------------

describe("AC-STE-597.4 — an unbalanced paren shape is named unresolvable, never guessed at", () => {
  const UNBALANCED: readonly string[] = [
    // One `(` too many: the subshell never closes, so where the commit runs is
    // not determined by anything the parser can read.
    "((cd /s/b && git commit -m x)",
    // A stray `)` with no opener: same ignorance, other direction.
    "cd /s/b && git commit -m x)",
  ];

  for (const cmd of UNBALANCED) {
    test(`\`${cmd}\` → a commit, repoRoot null, and a non-empty \`unresolved\``, () => {
      const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
      // Still a commit — not knowing where it lands is not a licence to ignore it.
      expect(t.isCommit).toBe(true);
      expect(t.repoRoot).toBe(null);
      expect(typeof t.unresolved).toBe("string");
      expect((t.unresolved ?? "").length).toBeGreaterThan(0);
    });
  }

  test("CONTROL — the BALANCED sibling of each resolves, so the nulls above are the imbalance's doing", () => {
    // Without this pair the clauses above would pass against a resolver that
    // had given up on every command containing a paren.
    const balanced = resolveCommitTarget("((cd /s/b && git commit -m x))", "/s/a", ROOTS);
    expect(balanced.repoRoot).toBe("/s/b");
    expect(balanced.unresolved).toBe(null);

    const noParens = resolveCommitTarget("cd /s/b && git commit -m x", "/s/a", ROOTS);
    expect(noParens.repoRoot).toBe("/s/b");
    expect(noParens.unresolved).toBe(null);
  });

  test("the honesty rule holds across every FINDING A shape: a repoRoot is never returned without a resolution", () => {
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ["(cd /s/b && git commit -m x)", "/s/b"],
      ["(cd /s/b) && git commit -m x", "/s/a"],
      ["(cd /s/b && (cd /s/c && git commit -m x))", "/s/c"],
      ["((cd /s/b && git commit -m x)", null],
      ["cd /s/b && git commit -m x)", null],
      ["(cd /s/b && git commit -m x) && git commit -m y", null],
    ];
    const resolved: (string | null)[] = [];
    for (const [cmd, expected] of cases) {
      const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
      expect(t.isCommit).toBe(true);
      expect(t.repoRoot).toBe(expected);
      // The biconditional: an unresolved cause is present exactly when there is
      // no root, so "null root, null cause" (silent ignorance) cannot pass.
      expect(t.unresolved === null).toBe(t.repoRoot !== null);
      resolved.push(t.repoRoot);
    }
    // CONTROL: both sides have to occur or the loop grades nothing.
    expect(resolved.filter((r) => r === null).length).toBeGreaterThan(0);
    expect(resolved.filter((r) => r !== null).length).toBeGreaterThan(0);
  });

  test("CONTROL — the existing controls are untouched by paren handling", () => {
    // Named here because FINDING A changes the splitter, which is the shared
    // machinery those controls ride on.
    const quotedOperator = resolveCommitTarget(
      "cd /s/b && git commit -m 'a && b'",
      "/s/a",
      ROOTS,
    );
    expect(quotedOperator.isCommit).toBe(true);
    expect(quotedOperator.repoRoot).toBe("/s/b");

    const config = resolveCommitTarget(
      "git -c commit.gpgsign=false commit -m x",
      "/s/a",
      ROOTS,
    );
    expect(config.isCommit).toBe(true);
    expect(config.repoRoot).toBe("/s/a");

    expect(resolveCommitTarget('echo "x && git commit"', "/s/a", ROOTS).isCommit).toBe(
      false,
    );
    expect(
      resolveCommitTarget("git log --grep='git commit'", "/s/a", ROOTS).isCommit,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STE-597 FINAL ROUND — FINDING B: a HEREDOC BODY is data being WRITTEN, not a
// command being RUN.
//
// Measured against the shipped resolver on 2026-09-17:
//
//     cat > t.md <<EOF
//     run: cd /p && git commit
//     EOF
//
//   → { isCommit: true, shape: "bare" }
//
// The body is the CONTENT of a file being authored. Nothing in it runs. Because
// the gate-check hook refuses on `isCommit` ALONE — resolvability is irrelevant
// there — this blocks a legitimate authoring command outright. It has bitten
// this milestone's own build twice: two agents had a `cat <<EOF` refused while
// writing test fixtures that merely MENTION a commit.
//
// This is a regression against the FR's OWN promise. STE-597's Risks table says
// "the new matches are only ever commit-bearing commands", and its Summary calls
// refusing the careful path "the worst shape a guard can have".
//
// The shape is NARROWER than "any heredoc". A body whose commit text sits inside
// a quoted string is ALREADY classified not-a-commit (measured) — the quote
// scanner happens to swallow it. The defect is the UNQUOTED body line.
//
// The controls below are the load-bearing half. A fix that skipped from `<<` to
// the END OF THE STRING rather than to the DELIMITER LINE would turn every
// heredoc into a blanket amnesty and open a real bypass — a commit after the
// terminator would go unseen. That is graded first, and deliberately.
// ---------------------------------------------------------------------------

/** Build a heredoc command from its operator, delimiter spelling and body. */
function heredoc(operator: string, delimiter: string, body: readonly string[]): string {
  return [`cat > t.md ${operator}${delimiter}`, ...body, "EOF"].join("\n");
}

/** The exact body that was refused in the wild: an unquoted cd-prefixed commit. */
const REFUSED_BODY = ["run: cd /s/b && git commit -m x"];

describe("AC-STE-597.1 — a heredoc BODY is data being written, not a command being run", () => {
  test("the measured shape — `cat > t.md <<EOF` with an unquoted `cd … && git commit` body → NOT a commit", () => {
    const t = resolveCommitTarget(heredoc("<<", "EOF", REFUSED_BODY), "/s/a", ROOTS);
    // The defect in one assertion: this authoring command commits nothing, and
    // the shipped resolver answered `true` / `"bare"` for it.
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toBe(null);
  });

  test("the `<<-` tab-stripping spelling is read the same way", () => {
    const t = resolveCommitTarget(heredoc("<<-", "EOF", REFUSED_BODY), "/s/a", ROOTS);
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });

  const QUOTED_DELIMITERS: ReadonlyArray<readonly [string, string]> = [
    ["<<", "'EOF'"],
    ["<<", '"EOF"'],
    ["<<-", "'EOF'"],
  ];

  for (const [operator, delimiter] of QUOTED_DELIMITERS) {
    test(`the quoted-delimiter spelling \`${operator}${delimiter}\` is read the same way`, () => {
      const t = resolveCommitTarget(
        heredoc(operator, delimiter, REFUSED_BODY),
        "/s/a",
        ROOTS,
      );
      expect(t.isCommit).toBe(false);
      expect(t.shape).toBe("none");
    });
  }

  test("a body line that is a BARE `git commit` is data too — no `cd` needed to reach the defect", () => {
    const t = resolveCommitTarget(
      heredoc("<<", "EOF", ["git commit -m x"]),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });

  test("a body line carrying the `-C` spelling is data as well", () => {
    const t = resolveCommitTarget(
      heredoc("<<", "EOF", ["  run: git -C /s/b commit -m x"]),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });

  test("a heredoc with NO terminator swallows to end of input and still commits nothing", () => {
    const t = resolveCommitTarget(
      "cat > t.md <<EOF\nrun: cd /s/b && git commit -m x",
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// The controls. Every one of these is written to go RED against a fix that
// turned "there is a heredoc here" into "ignore the rest of the command".
// ---------------------------------------------------------------------------

describe("AC-STE-597.1 — the heredoc reading must not go blind: commits outside the body still count", () => {
  test("CONTROL — a REAL commit AFTER the terminator is still a commit (the bypass this fix must not open)", () => {
    // The single most important clause in this round. The body is inert prose;
    // the line AFTER `EOF` is a live command. A fix that skipped from `<<` to
    // end-of-string would answer `false` here and hand anyone a one-line bypass
    // of both pre-commit hooks.
    const t = resolveCommitTarget(
      ["cat > t.md <<EOF", "hello", "EOF", "git commit -m x"].join("\n"),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a real commit after the terminator is seen even when the BODY also mentions one", () => {
    // The adversarial spelling of the clause above: a careless fix that gave up
    // on the whole command once it saw commit-shaped text inside a body would
    // pass the previous clause (body is `hello`) and fail this one.
    const t = resolveCommitTarget(
      [
        "cat > t.md <<EOF",
        "run: cd /s/c && git commit -m fixture",
        "EOF",
        "cd /s/b && git commit -m x",
      ].join("\n"),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    // /s/b is the LIVE cd target; /s/c only ever appeared inside the body.
    expect(t.repoRoot).toBe("/s/b");
    expect(t.repoRoot).not.toBe("/s/c");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a real commit BEFORE the heredoc, on an earlier line, is still a commit", () => {
    const t = resolveCommitTarget(
      ["git commit -m x", "cat > t.md <<EOF", "run: git commit -m fixture", "EOF"].join(
        "\n",
      ),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
  });

  test("CONTROL — a `-C` commit AFTER the terminator resolves to the `-C` target, not the session", () => {
    const t = resolveCommitTarget(
      ["cat > t.md <<EOF", "hello", "EOF", "git -C /s/b commit -m x"].join("\n"),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe("/s/b");
  });

  test("CONTROL — a `cd` that runs BEFORE the heredoc still steers a commit that runs after it", () => {
    // Pins that the heredoc skip does not also discard the directory state the
    // scanner accumulated on the way in.
    const t = resolveCommitTarget(
      ["cd /s/b", "cat > t.md <<EOF", "hello", "EOF", "git commit -m x"].join("\n"),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    expect(t.repoRoot).toBe("/s/b");
    expect(t.repoRoot).not.toBe("/s/a");
  });

  test("CONTROL — the terminator must be the delimiter ALONE: a body line merely containing it does not end the body", () => {
    // `EOF is not the end` contains `EOF`. A substring test would terminate the
    // body there and read the next line as a live command.
    const t = resolveCommitTarget(
      ["cat > t.md <<EOF", "EOF is not the end", "git commit -m x", "EOF"].join("\n"),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });

  test("CONTROL — `<<` inside a QUOTED word is data, not a heredoc operator", () => {
    // A fix that scanned the raw string for `<<` without honouring quotes would
    // swallow the rest of this command and answer `false` for a real commit.
    const t = resolveCommitTarget('git commit -m "see <<EOF in the docs"', "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — the same body text WITHOUT the heredoc operator is a commit, so the negatives above are not vacuous", () => {
    // Strip `cat > t.md <<EOF` and the `run: ` label and the very same words
    // commit for real. Without this, every clause in the block above would also
    // pass for a resolver that had simply stopped recognising commits.
    const t = resolveCommitTarget("cd /s/b && git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("cd-prefixed");
    expect(t.repoRoot).toBe("/s/b");
  });

  test("CONTROL — the already-correct quoted-body spelling keeps answering not-a-commit", () => {
    // Measured as ALREADY correct pre-fix. It is here so a fix cannot claim
    // this case as its own work, and so a regression in it is visible.
    const t = resolveCommitTarget(
      heredoc("<<", "EOF", ["run: 'cd /s/b && git commit -m x'"]),
      "/s/a",
      ROOTS,
    );
    expect(t.isCommit).toBe(false);
    expect(t.shape).toBe("none");
  });

  test("CONTROL — every pre-existing shape still answers exactly as it did before the heredoc fix", () => {
    // The no-regression sweep, stated as one table so a heredoc change that
    // disturbed the splitter cannot land quietly.
    const unchanged: ReadonlyArray<readonly [string, boolean, CommitCommandShape, string | null]> =
      [
        [BARE, true, "bare", "/s/a"],
        [CD_PREFIXED, true, "cd-prefixed", "/s/b"],
        [DASH_C, true, "dash-c", "/s/b"],
        ["(cd /s/b && git commit -m x)", true, "cd-prefixed", "/s/b"],
        ["(cd /s/b) && git commit -m x", true, "bare", "/s/a"],
        ["git -C /s/b commit -m x && git -C /s/c commit -m y", true, "dash-c", null],
        ['cd "$REPO" && git commit -m x', true, "cd-prefixed", null],
        ["((cd /s/b && git commit -m x)", true, "cd-prefixed", null],
        ['echo "x && git commit"', false, "none", null],
        ["git log --grep='git commit'", false, "none", null],
        ["git status", false, "none", null],
        ["echo git commit", false, "none", null],
      ];
    for (const [cmd, isCommit, shape, repoRoot] of unchanged) {
      const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
      expect([cmd, t.isCommit]).toEqual([cmd, isCommit]);
      expect([cmd, t.shape]).toEqual([cmd, shape]);
      expect([cmd, t.repoRoot]).toEqual([cmd, repoRoot]);
    }
  });
});

// ---------------------------------------------------------------------------
// STE-597 Pass 2 ROUND 2 — a `$(...)` COMMAND SUBSTITUTION is part of the word
// it sits in, not a subshell scope boundary.
//
// Measured against the shipped resolver on 2026-09-17, before this section
// existed:
//
//   git -C $(pwd) commit -m x                        → isCommit FALSE
//   git -C $(git rev-parse --show-toplevel) commit   → isCommit FALSE
//   git -c user.name=$(whoami) commit -m x           → isCommit FALSE
//   git --git-dir=$(pwd)/.git commit -m x            → isCommit FALSE
//
// `scanCommand` treats EVERY unquoted `(` as a scope opener, including the one
// that opens a command substitution. When the substitution sits before the
// `commit` token the invocation is torn across segments — one holding `git -C
// $`, another holding `commit` — so no segment contains both `git` and
// `commit`, `occurrences` is empty, and BOTH pre-commit hooks exit 0 in
// SILENCE. Not a wrong answer: no answer at all, with no refusal and no
// advisory. `git -C $(git rev-parse --show-toplevel) commit` is an everyday
// idiom, so this is a full silent bypass of both blocking gates and it is
// strictly worse than the wrong-repository answer AC-STE-597.4 exists to stop.
//
// The required reading: consume the substitution as ordinary literal text —
// nested parens, quotes, and operators inside it included — leaving the
// surrounding token whole. The resulting value still carries an unexpanded
// `$`, so the honesty rule this module already ships takes over: commit-bearing
// (`isCommit` true), target not established (`repoRoot` null), and `unresolved`
// naming the value it could not expand.
//
// THE CONTROLS ARE THE POINT. A fix that simply stopped treating `(` as a scope
// boundary would pass clauses 1-4 and silently undo the paren work of the
// previous round. The `(cd /x && git commit)` / `(cd /x) && git commit` pair
// below is what forbids that: only a reader that tells `$(` from a bare `(`
// answers both.
// ---------------------------------------------------------------------------

describe("AC-STE-597.1/4 — a `$(...)` substitution hides no commit (RED: today every one of these is invisible)", () => {
  test("`git -C $(pwd) commit` is a COMMIT that resolves to the running directory's checkout (STE-613 amends this STE-597 pin)", () => {
    const t = resolveCommitTarget("git -C $(pwd) commit -m x", "/s/a", ROOTS);
    // The bypass, stated as the assertion that fails on the shipped bytes.
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe("/s/a");
    // Never the session's repo: that would be a confident answer about a
    // repository the command did not name.
    expect(t.repoRoot).not.toBe(null);
    expect(t.unresolved).toBe(null);
    // And it is unresolvable because the VALUE is unexpanded, not because the
    // parser lost count of the parentheses. A fix that consumed the `$(` but
    // left the depth counter unbalanced would produce an unbalanced-paren
    // diagnosis here, which is the right verdict for the wrong reason.
    expect(t.unresolved ?? "").not.toContain("unbalanced");
  });

  test("`git -C $(git rev-parse --show-toplevel) commit` — the everyday idiom — is a commit that resolves to the checkout root (STE-613 amends this STE-597 pin)", () => {
    const cmd = "git -C $(git rev-parse --show-toplevel) commit -m x";
    const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
    // The inner `git` must not be mistaken for a second invocation, and the
    // inner `--show-toplevel` must not be parsed as a global option of the
    // outer one: the whole span is one word's worth of literal text.
    expect(t.unresolved ?? "").not.toContain("unbalanced");
  });

  test("`git -c user.name=$(whoami) commit` — a substitution in a GLOBAL OPTION's value", () => {
    const t = resolveCommitTarget("git -c user.name=$(whoami) commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("$(whoami)");
  });

  test("`git --git-dir=$(pwd)/.git commit` is a commit against a repository this resolver cannot place", () => {
    const t = resolveCommitTarget("git --git-dir=$(pwd)/.git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.repoRoot).not.toBe("/s/a");
    // Either honest naming is accepted — the option, or the value it carries —
    // because both say the same true thing. What is NOT accepted is silence,
    // and `repoRoot` above forbids a guess.
    expect(t.unresolved).toMatch(/--git-dir|\$\(pwd\)/);
  });

  test("a substitution carrying an OPERATOR does not split the word around it", () => {
    // `;` and `&&` inside `$(...)` are the substitution's own syntax. A splitter
    // that broke on them would tear `git -C` away from `commit` exactly as the
    // shipped one does on `(`.
    const t = resolveCommitTarget("git -C $(foo; bar && baz) commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).not.toContain("unbalanced");
  });

  test("NESTED substitution: `git -C $(dirname $(pwd)) commit` keeps its closing parens straight", () => {
    const t = resolveCommitTarget("git -C $(dirname $(pwd)) commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("dash-c");
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("$(dirname $(pwd))");
    // The inner `)` closes the inner substitution, the outer `)` the outer one.
    // A reader that stopped at the first `)` would leave a dangling `)` in the
    // stream and report an imbalance instead.
    expect(t.unresolved).not.toContain("unbalanced");
  });

  test("a substitution inside a GENUINE subshell leaves the subshell intact, and resolves to the subshell's directory (STE-613 amends this pin)", () => {
    // Both readings are exercised at once: the `(` opens a scope, the `$(`
    // does not, and the commit is still found inside the scope.
    const t = resolveCommitTarget("(cd /s/b && git -C $(pwd) commit -m x)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/b");
    expect(t.unresolved).toBe(null);
    expect(t.unresolved ?? "").not.toContain("unbalanced");
  });

  test("`echo $(git commit)` IS a commit (STE-601 amends this STE-597 pin: a substitution executes) — the tear cuts the other way too", () => {
    // Measured: today this answers `isCommit: true`. The splitter breaks the
    // word at the substitution's `(`, leaving a segment that reads `git
    // commit)` — a commit nobody wrote. So the same defect produces a false
    // NEGATIVE on `git -C $(pwd) commit` and a false POSITIVE here, and a fix
    // that only chased the bypass would leave this over-refusal standing.
    const t = resolveCommitTarget("echo $(git commit)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/a");
  });

  test("the UNQUOTED spelling agrees with the QUOTED one, and both resolve alike (STE-613 amends this pin)", () => {
    // `git -C "$(pwd)" commit` resolves today, because the quote hides the `(`
    // from the splitter. Two spellings of one command answering differently is
    // the defect restated; this clause pins them together.
    const quoted = resolveCommitTarget('git -C "$(pwd)" commit -m x', "/s/a", ROOTS);
    const unquoted = resolveCommitTarget("git -C $(pwd) commit -m x", "/s/a", ROOTS);
    expect(quoted.isCommit).toBe(true);
    expect(quoted.repoRoot).toBe("/s/a");
    expect(unquoted.isCommit).toBe(quoted.isCommit);
    expect(unquoted.shape).toBe(quoted.shape);
    expect(unquoted.repoRoot).toBe(quoted.repoRoot);
    expect(unquoted.unresolved).toBe(quoted.unresolved);
  });
});

describe("STE-597 ROUND 2 CONTROLS — the substitution fix must not become a new bypass", () => {
  test("CONTROL — `git commit -m $(echo hi)` still RESOLVES: the message is not the repository", () => {
    // The mirror of the fix. A reader that declared any `$` unresolvable would
    // turn every commit with a computed message into a /tdd advisory — an
    // exit-0 leg — which is a bypass wearing a reminder.
    const t = resolveCommitTarget("git commit -m $(echo hi)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — `cd $(pwd)/sub && git commit` is commit-bearing and resolves to the session's checkout (STE-613 amends this pin)", () => {
    const t = resolveCommitTarget("cd $(pwd)/sub && git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/a");
    expect(t.repoRoot).not.toBe(null);
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a GENUINE subshell keeps its scope: `(cd /s/b && git commit)` commits in /s/b", () => {
    const t = resolveCommitTarget("(cd /s/b && git commit -m x)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — and in the other direction: `(cd /s/b) && git commit` commits in the SESSION's repo", () => {
    // This pair is the whole argument that `$(` and `(` are different things.
    // A fix that stopped opening a scope on `(` would answer /s/a above and
    // /s/b here; only one that tells them apart answers both.
    const t = resolveCommitTarget("(cd /s/b) && git commit -m x", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/a");
    expect(t.repoRoot).not.toBe("/s/b");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a paren inside a QUOTED commit message is untouched", () => {
    const t = resolveCommitTarget('git commit -m "fix (urgent)"', "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.shape).toBe("bare");
    expect(t.repoRoot).toBe("/s/a");
    expect(t.unresolved).toBe(null);
  });

  test("CONTROL — a QUOTED substitution that runs its commit: STE-601 amends this STE-597 pin, a quoted substitution executes too", () => {
    // Green in both directions: the quote already hid the `(` from the
    // splitter, so this spelling has always answered correctly.
    expect(resolveCommitTarget('echo "$(git commit)"', "/s/a", ROOTS).isCommit).toBe(true);
  });

  test("CONTROL — an unbalanced paren is still diagnosed as unbalanced after the fix", () => {
    // The substitution reader must not swallow so greedily that a genuinely
    // unterminated subshell starts reading as a resolvable command.
    const t = resolveCommitTarget("((cd /s/b && git commit -m x)", "/s/a", ROOTS);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(t.unresolved).toContain("unbalanced");
  });
});

// ---------------------------------------------------------------------------
// STE-601 (AC-STE-601.6) — the two amended pins, demonstrated by execution.
// Each command really creates a commit object under bash AND zsh, run as
// `<shell> <file>` in a scratch repository: the pins recorded the old
// splitter's behaviour, not shell semantics.
// ---------------------------------------------------------------------------
import { spawnSync as ste601Spawn } from "node:child_process";

describe("STE-601 — the amended substitution pins are real commits under bash and zsh", () => {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const g = (cwd: string, ...args: string[]): string =>
    String(ste601Spawn("git", args, { cwd, env, encoding: "utf8" }).stdout).trim();

  for (const cmd of ["echo $(git commit)", 'echo "$(git commit)"']) {
    for (const shell of ["bash", "zsh"]) {
      test(`\`${cmd}\` under ${shell} creates a commit, and the resolver says so`, () => {
        const repo = mkdtempSync(join(tmpdir(), "ste601-exec-"));
        try {
          g(repo, "init", "-q");
          g(repo, "commit", "-q", "--allow-empty", "-m", "init");
          const editor = join(repo, "..", `${repo.split("/").pop()}-editor.sh`);
          writeFileSync(editor, '#!/bin/sh\necho "msg" > "$1"\n', { mode: 0o755 });
          writeFileSync(join(repo, "f.txt"), "x\n");
          g(repo, "add", "f.txt");
          const script = join(repo, "..", `${repo.split("/").pop()}-cmd.sh`);
          writeFileSync(script, cmd + "\n");
          const before = Number(g(repo, "rev-list", "--count", "HEAD"));
          const p = ste601Spawn(shell, [script], { cwd: repo, env: { ...env, GIT_EDITOR: editor } });
          expect(p.status).toBe(0);
          expect(Number(g(repo, "rev-list", "--count", "HEAD"))).toBe(before + 1);
          rmSync(editor, { force: true });
          rmSync(script, { force: true });
        } finally {
          rmSync(repo, { recursive: true, force: true });
        }
        const t = resolveCommitTarget(cmd, "/s/a", ROOTS);
        expect(t.isCommit).toBe(true);
        expect(t.repoRoot).toBe("/s/a");
      });
    }
  }
});
