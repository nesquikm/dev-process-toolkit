// STE-601 — a commit behind a wrapper, keyword or nested shell is still a commit.
//
// One describe per shape-table group of specs/frs/STE-601.md. Every recognised
// row is paired with a non-commit control that uses the SAME wrapper, so a
// resolver that answered `isCommit: true` for anything wrapped cannot pass.
//
// Directories are fake (`/s/a` = the session's checkout, `/s/b` = the sibling)
// through an injected checkout resolver, except the alias legs (AC.10), which
// need real `git config` and therefore real `git init` checkouts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCommitTarget, type CommitTarget } from "../adapters/_shared/src/commit_target_repo";
import { git } from "./_span_fixture";

const MAP: Record<string, string> = {
  "/s/a": "/s/a",
  "/s/a/sub": "/s/a",
  "/s/b": "/s/b",
  "/s/b/sub": "/s/b",
  "/s/b/.git": "/s/b",
};
const ROOTS = (dir: string): string | null => MAP[dir] ?? null;

// The new fields are additive; read them loosely so a missing field fails on
// its VALUE, not on a type error that would stop the whole file loading.
type Wide = CommitTarget & {
  candidateRoots?: string[];
  subcommand?: string | null;
  advisory?: string | null;
};
const r = (cmd: string, cwd = "/s/a"): Wide => resolveCommitTarget(cmd, cwd, ROOTS) as Wide;

const UNWRAPPED = "git -C /s/b commit -m x";
const STATUS = "git -C /s/b status";

function expectCommitIn(cmd: string, root: string, cwd = "/s/a"): Wide {
  const t = r(cmd, cwd);
  expect({ cmd, isCommit: t.isCommit, repoRoot: t.repoRoot, unresolved: t.unresolved }).toEqual({
    cmd,
    isCommit: true,
    repoRoot: root,
    unresolved: null,
  });
  return t;
}

function expectNotCommit(cmd: string, cwd = "/s/a"): Wide {
  const t = r(cmd, cwd);
  expect({ cmd, isCommit: t.isCommit }).toEqual({ cmd, isCommit: false });
  return t;
}

function expectUnplaced(cmd: string, reason: string, cwd = "/s/a"): Wide {
  const t = r(cmd, cwd);
  expect({ cmd, isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ cmd, isCommit: true, repoRoot: null });
  expect(String(t.unresolved)).toContain(reason);
  return t;
}

/** Single-quote a string for a POSIX shell. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------------------
// AC-STE-601.2 — prefix wrappers
// ---------------------------------------------------------------------------

const RECOGNISED_PREFIXES: readonly string[] = [
  "X=1 ",
  "A=1 B=2 ",
  'MSG="two words" ',
  "HUSKY=0 ",
  "GIT_AUTHOR_NAME=me ",
  "env ",
  "env X=1 ",
  "env -i ",
  "env - ",
  "env -0 ",
  "env -v ",
  "env -u HOME ",
  "env --unset=HOME ",
  "command ",
  "command -p ",
  "exec ",
  "nohup ",
  "time ",
  "time -p ",
  "nice ",
  "nice -n 5 ",
  "nice -5 ",
  "timeout 10 ",
  "timeout -s KILL 10 ",
  "! ",
];

describe("AC-STE-601.2 — a recognised prefix hides no commit", () => {
  const base = r(UNWRAPPED);

  test("the unwrapped baseline resolves to /s/b", () => {
    expect(base.isCommit).toBe(true);
    expect(base.repoRoot).toBe("/s/b");
  });

  for (const p of RECOGNISED_PREFIXES) {
    test(`\`${p}${UNWRAPPED}\` resolves like the unwrapped command`, () => {
      const t = expectCommitIn(p + UNWRAPPED, "/s/b");
      expect(t.shape).toBe(base.shape);
      expect(t.candidateRoots).toEqual([]);
    });
    test(`CONTROL — \`${p}${STATUS}\` is not a commit`, () => {
      expectNotCommit(p + STATUS);
    });
  }

  test("prefixes compose: `env X=1 time command git -C /s/b commit` → /s/b", () => {
    expectCommitIn("env X=1 time command git -C /s/b commit -m x", "/s/b");
  });

  for (const cmd of ["env -C /s/b git commit -m x", "env --chdir=/s/b git commit -m x", "env --chdir /s/b git commit -m x"]) {
    test(`\`${cmd}\` → /s/b (the directory change applies to the wrapped command)`, () => {
      expectCommitIn(cmd, "/s/b");
    });
  }

  test("the `env -C` directory change does NOT leak into a later segment", () => {
    expectCommitIn("env -C /s/b true; git commit -m x", "/s/a");
  });

  for (const cmd of ["command -v git", "command -V git", "type git", "which git", "hash git"]) {
    test(`out of scope (lookup, not execution): \`${cmd}\``, () => {
      expectNotCommit(cmd);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-601.3 — an argv0 whose final path segment is exactly `git`
// ---------------------------------------------------------------------------

describe("AC-STE-601.3 — a path to git is git", () => {
  test("`/usr/bin/git commit` → the session's checkout", () => expectCommitIn("/usr/bin/git commit -m x", "/s/a"));
  test("`/opt/homebrew/bin/git -C /s/b commit` → /s/b", () =>
    expectCommitIn("/opt/homebrew/bin/git -C /s/b commit -m x", "/s/b"));
  test("`./git commit` → the session's checkout", () => expectCommitIn("./git commit -m x", "/s/a"));
  test("CONTROL — `/usr/bin/git status` is not a commit", () => expectNotCommit("/usr/bin/git status"));
  for (const cmd of ["gitk", "/usr/bin/git2 commit -m x", "legit commit -m x"]) {
    test(`\`${cmd}\` is not git`, () => expectNotCommit(cmd));
  }
});

// ---------------------------------------------------------------------------
// AC-STE-601.4 — separators, reserved words, brace groups, functions, case
// ---------------------------------------------------------------------------

describe("AC-STE-601.4 — separators and keywords hide no commit, and scope is exact", () => {
  // A single `&` backgrounds its whole and-or list in a subshell, so a `cd` in
  // that list never reaches the commands after the `&` (review finding, STE-601).
  test("`cd /s/b & git commit` → the session's checkout: the backgrounded cd is a subshell", () =>
    expectCommitIn("cd /s/b & git commit -m x", "/s/a"));
  test("`cd /s/b && git commit &` → /s/b: the commit runs inside the backgrounded list", () =>
    expectCommitIn("cd /s/b && git commit -m x &", "/s/b"));
  test("`cd /s/b; sleep 1 & git commit` → /s/b: only the list before `&` is backgrounded", () =>
    expectCommitIn("cd /s/b; sleep 1 & git commit -m x", "/s/b"));
  test("CONTROL — `cd /s/b &> /dev/null; git commit` → /s/b: `&>` is a redirection, not a background", () =>
    expectCommitIn("cd /s/b &> /dev/null; git commit -m x", "/s/b"));
  const cases: Array<[string, string]> = [
    ["sleep 0 & git -C /s/b commit -m x", "/s/b"],
    ["true |& git -C /s/b commit -m x", "/s/b"],
    ["cd /s/b && if true; then git commit -m x; fi", "/s/b"],
    ["if git -C /s/b commit -m x; then echo ok; fi", "/s/b"],
    ["if false; then :; elif true; then git -C /s/b commit -m x; else :; fi", "/s/b"],
    ["if false; then :; else git -C /s/b commit -m x; fi", "/s/b"],
    ["while true; do git -C /s/b commit -m x; done", "/s/b"],
    ["until false; do git -C /s/b commit -m x; done", "/s/b"],
    ["for f in a b; do git -C /s/b commit -m x; done", "/s/b"],
    ["{ git -C /s/b commit -m x; }", "/s/b"],
    ["{ cd /s/b; }; git commit -m x", "/s/b"],
    ["(cd /s/b); git commit -m x", "/s/a"],
    ["f() { git -C /s/b commit -m x; }", "/s/b"],
    ["function f { git -C /s/b commit -m x; }", "/s/b"],
  ];
  for (const [cmd, root] of cases) {
    test(`\`${cmd}\` → ${root}`, () => expectCommitIn(cmd, root));
  }

  const controls = [
    "sleep 0 & git -C /s/b status",
    "true |& git -C /s/b status",
    "cd /s/b && if true; then git status; fi",
    "while true; do git -C /s/b status; done",
    "for f in a b; do git -C /s/b status; done",
    "{ git -C /s/b status; }",
    "f() { git -C /s/b status; }",
  ];
  for (const cmd of controls) {
    test(`CONTROL — \`${cmd}\` is not a commit`, () => expectNotCommit(cmd));
  }

  test("a commit inside a `case` arm is unplaced, naming \"a case arm\"", () => {
    expectUnplaced("case x in x) git -C /s/b commit -m x;; esac", "a case arm");
  });
  test("CONTROL — a `case` arm with no commit is not a commit", () => {
    expectNotCommit("case x in x) git -C /s/b status;; esac");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-601.5 — nested shells and eval
// ---------------------------------------------------------------------------

describe("AC-STE-601.5 — a nested shell is read recursively", () => {
  const cases: Array<[string, string]> = [
    ['bash -c "git -C /s/b commit -m x"', "/s/b"],
    ["zsh -lc 'git -C /s/b commit -m x'", "/s/b"],
    ["sh -ec 'git -C /s/b commit -m x'", "/s/b"],
    ["dash -xc 'git -C /s/b commit -m x'", "/s/b"],
    ["ksh -c 'git -C /s/b commit -m x'", "/s/b"],
    ["cd /s/b && sh -c 'git commit -m x'", "/s/b"],
    ["eval 'git -C /s/b commit -m x'", "/s/b"],
  ];
  for (const [cmd, root] of cases) {
    test(`\`${cmd}\` → ${root}`, () => expectCommitIn(cmd, root));
  }

  test("`bash -c 'cd /s/b && git commit'; git commit` is two commits in two checkouts", () => {
    const t = r("bash -c 'cd /s/b && git commit -m x'; git commit -m x");
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(String(t.unresolved)).toContain("more than one repository");
  });

  test("CONTROL — a `-c` string with no commit is not a commit", () => {
    expectNotCommit("bash -c 'git -C /s/b status'");
    expectNotCommit("eval 'git -C /s/b status'");
  });

  for (const cmd of ['bash -c "$CMD"', 'eval "$CMD"', "bash f.sh", "./f.sh", "source f.sh", ". f.sh"]) {
    test(`out of scope: \`${cmd}\``, () => expectNotCommit(cmd));
  }

  const nest = (depth: number): string => {
    let s = "git -C /s/b commit -m x";
    for (let i = 0; i < depth; i++) s = `bash -c ${q(s)}`;
    return s;
  };

  test("CONTROL — three levels deep still resolves to /s/b", () => expectCommitIn(nest(3), "/s/b"));
  test("eight levels deep still resolves to /s/b", () => expectCommitIn(nest(8), "/s/b"));
  test("nine levels deep is unplaced (\"nesting deeper than 8\"), never a throw and never isCommit: false", () => {
    let t: Wide | undefined;
    expect(() => {
      t = r(nest(9));
    }).not.toThrow();
    expect(t!.isCommit).toBe(true);
    expect(t!.repoRoot).toBe(null);
    expect(String(t!.unresolved)).toContain("nesting deeper than 8");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-601.6 — substitutions
// ---------------------------------------------------------------------------

describe("AC-STE-601.6 — a substitution executes, quoted or not", () => {
  test("`x=$(git -C /s/b commit -m y)` → /s/b", () => expectCommitIn("x=$(git -C /s/b commit -m y)", "/s/b"));
  test("`echo $(git commit)` → the running directory", () => expectCommitIn("echo $(git commit)", "/s/a"));
  test('`echo "$(git commit)"` → the running directory', () => expectCommitIn('echo "$(git commit)"', "/s/a"));
  test("`cd /s/b && echo $(git commit)` → /s/b (the substitution runs in the running directory)", () =>
    expectCommitIn("cd /s/b && echo $(git commit)", "/s/b"));

  test("the commit-message heredoc idiom is exactly one commit in the running directory", () => {
    const cmd = [
      `git commit -m "$(cat <<'EOF'`,
      `fix: a ( b ) ) " ' unbalanced`,
      `then git commit and (cd /s/b && git commit)`,
      `EOF`,
      `)"`,
    ].join("\n");
    expectCommitIn(cmd, "/s/a");
    expectCommitIn(`cd /s/b && ${cmd}`, "/s/b");
  });

  test("CONTROL — a heredoc inside a substitution that only MENTIONS a commit is not a commit", () => {
    const cmd = [
      `gh pr create --title t --body "$(cat <<'EOF'`,
      `run git commit, then (git -C /s/b commit -m x)`,
      `EOF`,
      `)"`,
    ].join("\n");
    expectNotCommit(cmd);
  });

  test("CONTROL — a substitution holding no commit is not a commit", () => {
    expectNotCommit("echo $(git status)");
    expectNotCommit('echo "$(git log -1)"');
  });
});

// ---------------------------------------------------------------------------
// AC-STE-601.7 — unplaced wrappers, with candidateRoots graded both ways
// ---------------------------------------------------------------------------

describe("AC-STE-601.7 — an unplaced wrapper is a commit with no single target", () => {
  const rows: Array<[string, string]> = [
    ["xargs git commit -m x", "xargs"],
    ["find . -exec git commit -m x \\;", "find"],
    ["find . -ok git commit -m x \\;", "find"],
    ["parallel git commit -m x ::: a", "parallel"],
    ["watch git commit -m x", "watch"],
    ["sudo git commit -m x", "sudo"],
    ["env -S 'git commit -m x'", "env"],
    ["env --split-string='git commit -m x'", "env"],
  ];
  for (const [cmd, wrapper] of rows) {
    test(`\`${cmd}\` → unplaced, naming ${wrapper}`, () => {
      expectUnplaced(cmd, wrapper);
    });
  }

  test("`sudo git -C /s/b commit` lists /s/b as a candidate", () => {
    expect(expectUnplaced("sudo git -C /s/b commit -m x", "sudo").candidateRoots).toContain("/s/b");
  });
  test("`cd /s/b && xargs git commit` lists /s/b as a candidate", () => {
    expect(expectUnplaced("cd /s/b && xargs git commit -m x", "xargs").candidateRoots).toContain("/s/b");
  });
  test("`find . -exec git -C /s/b commit \\;` lists /s/b as a candidate", () => {
    expect(expectUnplaced("find . -exec git -C /s/b commit -m x \\;", "find").candidateRoots).toContain("/s/b");
  });
  test("`sudo git commit` from A lists A only", () => {
    expect(expectUnplaced("sudo git commit -m x", "sudo").candidateRoots).toEqual(["/s/a"]);
  });
  test("`find . -execdir git commit \\;` lists only the running directory's checkout", () => {
    expect(expectUnplaced("find . -execdir git commit -m x \\;", "find").candidateRoots).toEqual(["/s/a"]);
  });
  test("`xargs -I{} git -C {} commit` never lists a word it cannot expand", () => {
    expect(expectUnplaced("xargs -I{} git -C {} commit -m x", "xargs").candidateRoots).toEqual(["/s/a"]);
  });

  test("every other answer carries candidateRoots: []", () => {
    for (const cmd of ["git commit -m x", "cd /s/b && git commit -m x", "git -C /s/b commit -m x", "git status", 'cd "$R" && git commit -m x']) {
      expect({ cmd, c: r(cmd).candidateRoots }).toEqual({ cmd, c: [] });
    }
  });

  for (const cmd of ["xargs git status", "find . -name '*.md'", "sudo ls", "watch git status", "sudo git -C /s/b status"]) {
    test(`CONTROL — \`${cmd}\` is not a commit`, () => expectNotCommit(cmd));
  }
});

// ---------------------------------------------------------------------------
// AC-STE-601.8 — commit-producing subcommands
// ---------------------------------------------------------------------------

describe("AC-STE-601.8 — merge, cherry-pick, revert, am and commit-tree write commits", () => {
  const rows: Array<[string, string]> = [
    ["merge --no-ff x", "merge"],
    ["merge x", "merge"],
    ["merge --continue", "merge"],
    ["cherry-pick x", "cherry-pick"],
    ["cherry-pick --continue", "cherry-pick"],
    ["revert x", "revert"],
    ["am p.mbox", "am"],
    ["commit-tree t -m m", "commit-tree"],
  ];
  const ref = r("git -C /s/b commit -m x");
  for (const [args, sub] of rows) {
    test(`\`git ${args}\` is a commit in the session's checkout, subcommand ${sub}`, () => {
      const t = expectCommitIn(`git ${args}`, "/s/a");
      expect(t.subcommand).toBe(sub);
    });
    test(`\`git -C /s/b ${args}\` has the same target as \`git -C /s/b commit\``, () => {
      const t = expectCommitIn(`git -C /s/b ${args}`, "/s/b");
      expect(t.shape).toBe(ref.shape);
      expect(t.subcommand).toBe(sub);
    });
  }

  test("a plain commit names its subcommand too", () => {
    expect(r("git commit -m x").subcommand).toBe("commit");
  });

  for (const args of [
    "merge --ff-only x",
    "merge --abort",
    "merge --quit",
    "merge --squash x",
    "merge --no-commit x",
    "cherry-pick -n x",
    "cherry-pick --no-commit x",
    "cherry-pick --abort",
    "cherry-pick --skip",
    "revert --no-commit x",
    "revert -n x",
    "revert --abort",
    "am --abort",
    "am --quit",
    "am --show-current-patch",
    "status",
    "log",
  ]) {
    test(`permit twin: \`git -C /s/b ${args}\` is not a commit`, () => expectNotCommit(`git -C /s/b ${args}`));
  }
});

// ---------------------------------------------------------------------------
// AC-STE-601.9 — advisory rows and the remaining out-of-scope rows
// ---------------------------------------------------------------------------

describe("AC-STE-601.9 — pull, rebase, stash and notes are advised, never silent", () => {
  const rows: Array<[string, string]> = [
    ["git pull", "pull"],
    ["git rebase main", "rebase"],
    ["git stash", "stash"],
    ["git stash push", "stash"],
    ["git stash save wip", "stash"],
    ["git notes add -m x", "notes"],
    ["git -C /s/b pull", "pull"],
  ];
  for (const [cmd, sub] of rows) {
    test(`\`${cmd}\` → not a commit, advisory naming ${sub}`, () => {
      const t = expectNotCommit(cmd);
      expect(String(t.advisory ?? "")).toContain(sub);
    });
  }
  for (const cmd of ["git stash list", "git stash show", "git notes list", "git rebase --abort", "git status"]) {
    test(`permit twin: \`${cmd}\` carries no advisory`, () => {
      const t = expectNotCommit(cmd);
      expect(t.advisory ?? null).toBe(null);
    });
  }
  test("out of scope: `ssh h 'git commit'` is not a commit in any local checkout", () => {
    expectNotCommit("ssh h 'git commit -m x'");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-601.10 — aliases, with real checkouts
// ---------------------------------------------------------------------------

describe("AC-STE-601.10 — a git alias is resolved before classifying", () => {
  let a = "";
  let b = "";
  beforeAll(() => {
    a = realpathSync(mkdtempSync(join(tmpdir(), "ste601-alias-a-")));
    b = realpathSync(mkdtempSync(join(tmpdir(), "ste601-alias-b-")));
    for (const d of [a, b]) git(d, "init", "-q", "-b", "main");
    git(b, "config", "alias.ci", "commit");
    git(b, "config", "alias.mc", "merge --no-ff");
    git(b, "config", "alias.pc", "!git commit");
    git(b, "config", "alias.st", "status");
    git(b, "config", "alias.loop", "!git loop");
  });
  afterAll(() => {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });

  const real = (cmd: string): Wide => resolveCommitTarget(cmd, a) as Wide;

  test("`git -C B ci` (alias.ci=commit in B) is a commit in B", () => {
    const t = real(`git -C ${b} ci -m x`);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(b);
  });
  test("`git -C B mc x` (alias.mc=merge --no-ff) is a commit in B", () => {
    const t = real(`git -C ${b} mc x`);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(b);
  });
  test("`git -C B pc` (alias.pc=!git commit) is read recursively and resolves to B", () => {
    const t = real(`git -C ${b} pc`);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(b);
  });
  test("permit twin: `git -C B st` (alias.st=status) is not a commit", () => {
    expect(real(`git -C ${b} st`).isCommit).toBe(false);
  });
  test("permit twin: the same `ci` word in A, where no alias is defined, is not a commit", () => {
    expect(real(`git -C ${a} ci -m x`).isCommit).toBe(false);
  });
  test("permit twin: an undefined alias word is not a commit", () => {
    expect(real(`git -C ${b} frobnicate`).isCommit).toBe(false);
  });
  test("`git -c alias.ci=commit ci` resolves without reading config", () => {
    const t = r("git -c alias.ci=commit ci -m y");
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe("/s/a");
  });
  test("CONTROL — `git -c alias.ci=status ci` is not a commit", () => {
    expect(r("git -c alias.ci=status ci").isCommit).toBe(false);
  });
  test('`git -C "$R" ci` whose checkout cannot be read is unplaced, naming "git alias"', () => {
    const t = real('git -C "$R" ci -m x');
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(String(t.unresolved)).toContain("git alias");
  });
  test("a self-referencing alias chain stops at depth 8, unplaced, never a hang", () => {
    const t = real(`git -C ${b} loop`);
    expect(t.isCommit).toBe(true);
    expect(t.repoRoot).toBe(null);
    expect(String(t.unresolved)).toContain("deeper than 8");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-601.11 — STE-601's listed shapes
// ---------------------------------------------------------------------------

describe("AC-STE-601.11 — escaped argv0, GIT_DIR and backtick substitutions", () => {
  // `eval` runs in the calling shell, so its `export` persists like its `cd` (review finding).
  test("`eval 'export GIT_DIR=/s/b/.git'; git commit` → unplaced naming GIT_DIR, /s/b a candidate", () => {
    const t = r("eval 'export GIT_DIR=/s/b/.git'; git commit -m x", "/s/a");
    expect({ isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ isCommit: true, repoRoot: null });
    expect(String(t.unresolved)).toContain("GIT_DIR");
    expect(t.candidateRoots).toContain("/s/b");
  });
  test("CONTROL — `bash -c 'export GIT_DIR=/s/b/.git'; git commit` → the session's checkout: a child shell's export dies with it", () =>
    expectCommitIn("bash -c 'export GIT_DIR=/s/b/.git'; git commit -m x", "/s/a"));
  test("`\\git commit` → the session's checkout", () => expectCommitIn("\\git commit -m x", "/s/a"));
  test("`\\git -C /s/b commit` → /s/b", () => expectCommitIn("\\git -C /s/b commit -m x", "/s/b"));
  test('`"git" -C /s/b commit` → /s/b', () => expectCommitIn('"git" -C /s/b commit -m x', "/s/b"));
  test("`'git' -C /s/b commit` → /s/b", () => expectCommitIn("'git' -C /s/b commit -m x", "/s/b"));
  test("`command git -C /s/b commit` → /s/b", () => expectCommitIn("command git -C /s/b commit -m x", "/s/b"));
  test("`env git -C /s/b commit` → /s/b", () => expectCommitIn("env git -C /s/b commit -m x", "/s/b"));

  for (const cmd of [
    "GIT_DIR=/s/b/.git git commit -m x",
    "env GIT_DIR=/s/b/.git git commit -m x",
    "export GIT_DIR=/s/b/.git; git commit -m x",
    "GIT_WORK_TREE=/s/b git commit -m x",
  ]) {
    test(`\`${cmd}\` → unplaced naming GIT_DIR/GIT_WORK_TREE, /s/b a candidate`, () => {
      const t = r(cmd);
      expect(t.isCommit).toBe(true);
      expect(t.repoRoot).toBe(null);
      expect(String(t.unresolved)).toMatch(/GIT_DIR|GIT_WORK_TREE/);
      expect(t.candidateRoots).toContain("/s/b");
    });
  }

  test("``echo `cd /s/b && git commit` `` → /s/b", () => expectCommitIn("echo `cd /s/b && git commit -m x`", "/s/b"));
  test("``x=`git -C /s/b commit -m y` && echo ok`` → /s/b", () =>
    expectCommitIn("x=`git -C /s/b commit -m y` && echo ok", "/s/b"));
  test("``echo `cd /s/b` && git commit`` → the session's checkout (the backtick scopes its cd)", () =>
    expectCommitIn("echo `cd /s/b` && git commit -m x", "/s/a"));

  for (const cmd of ["\\git status", "GIT_DIR=/s/b/.git git status", "echo `git status && git log`", '"git" status']) {
    test(`CONTROL — \`${cmd}\` is not a commit`, () => expectNotCommit(cmd));
  }
});
