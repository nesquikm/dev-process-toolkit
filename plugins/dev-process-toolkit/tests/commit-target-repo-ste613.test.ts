// STE-613 — every way of changing directory moves the commit with it.
//
// One describe per model item of specs/frs/STE-613.md. Every resolving clause
// is paired with a still-unresolvable sibling that differs by one token.
// Directories are fake through an injected checkout lookup: /s/a is the
// session's checkout, /s/b the sibling, /h/x a checkout under a fake HOME.

import { describe, expect, test } from "bun:test";

import { resolveCommitTarget, type CommitTarget } from "../adapters/_shared/src/commit_target_repo";

const MAP: Record<string, string> = {
  "/s/a": "/s/a",
  "/s/a/sub": "/s/a",
  "/s/b": "/s/b",
  "/s/b/sub": "/s/b",
  "/s/b/.git": "/s/b",
  "/h/x": "/h/x",
};
const ROOTS = (dir: string): string | null => MAP[dir] ?? null;

const r = (cmd: string, cwd = "/s/a"): CommitTarget => resolveCommitTarget(cmd, cwd, ROOTS);

function expectCommitIn(cmd: string, root: string, cwd = "/s/a"): CommitTarget {
  const t = r(cmd, cwd);
  expect({ cmd, isCommit: t.isCommit, repoRoot: t.repoRoot, unresolved: t.unresolved }).toEqual({
    cmd,
    isCommit: true,
    repoRoot: root,
    unresolved: null,
  });
  return t;
}

function expectUnplaced(cmd: string, reason: string | null, cwd = "/s/a"): CommitTarget {
  const t = r(cmd, cwd);
  expect({ cmd, isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ cmd, isCommit: true, repoRoot: null });
  expect(t.unresolved).not.toBe(null);
  if (reason !== null) expect({ cmd, unresolved: String(t.unresolved).includes(reason) }).toEqual({ cmd, unresolved: true });
  return t;
}

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const saved = process.env[name];
  try {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

// ---------------------------------------------------------------------------
// AC-STE-613.1 — cd options, builtin cd, command cd, CDPATH
// ---------------------------------------------------------------------------

describe("AC-STE-613.1 — item 1: `cd` options are skipped, `--` ends them", () => {
  for (const opt of ["-P", "-L", "-Pe", "-e", "-@", "--", "-P --"]) {
    test(`\`cd ${opt} /s/b && git commit\` resolves to /s/b`, () => {
      expectCommitIn(`cd ${opt} /s/b && git commit -m x`, "/s/b");
    });
  }

  test("SIBLING — `cd -P - && git commit` (option then `-`) stays unresolvable", () => {
    expectUnplaced("cd -P - && git commit -m x", null);
  });

  test("CONTROL — `cd - && git commit` and a bare `cd && git commit` stay unresolvable", () => {
    const dash = expectUnplaced("cd - && git commit -m x", null);
    const bare = expectUnplaced("cd && git commit -m x", null);
    expect(dash.repoRoot).not.toBe("/s/a");
    expect(bare.repoRoot).not.toBe("/s/a");
  });

  test("CONTROL — the plain `cd /s/b && git commit` still resolves to /s/b", () => {
    expectCommitIn("cd /s/b && git commit -m x", "/s/b");
  });
});

describe("AC-STE-613.1 — item 2: `builtin cd` and `command cd` are `cd`", () => {
  test("`builtin cd /s/b && git commit` resolves to /s/b", () => {
    expectCommitIn("builtin cd /s/b && git commit -m x", "/s/b");
  });
  test("`command cd /s/b && git commit` resolves to /s/b", () => {
    expectCommitIn("command cd /s/b && git commit -m x", "/s/b");
  });
  test("`builtin cd -P /s/b && git commit` combines both items", () => {
    expectCommitIn("builtin cd -P /s/b && git commit -m x", "/s/b");
  });
  test("SIBLING — `builtin cd - && git commit` stays unresolvable", () => {
    expectUnplaced("builtin cd - && git commit -m x", null);
  });
  test("SIBLING — `command cd - && git commit` stays unresolvable", () => {
    expectUnplaced("command cd - && git commit -m x", null);
  });
});

describe("AC-STE-613.1 — item 1: CDPATH makes a bare relative operand unresolvable", () => {
  test("with CDPATH=/x, `cd b && git commit` is unresolvable naming CDPATH", () => {
    withEnv("CDPATH", "/x", () => {
      expectUnplaced("cd b && git commit -m x", "CDPATH", "/s");
    });
  });
  test("with CDPATH=/x, `pushd b && git commit` is unresolvable naming CDPATH", () => {
    withEnv("CDPATH", "/x", () => {
      expectUnplaced("pushd b && git commit -m x", "CDPATH", "/s");
    });
  });
  test("SIBLING — with CDPATH=/x, `cd ./b && git commit` still resolves", () => {
    withEnv("CDPATH", "/x", () => {
      expectCommitIn("cd ./b && git commit -m x", "/s/b", "/s");
    });
  });
  test("SIBLING — with CDPATH=/x, `cd /s/b && git commit` still resolves", () => {
    withEnv("CDPATH", "/x", () => {
      expectCommitIn("cd /s/b && git commit -m x", "/s/b", "/s");
    });
  });
  test("SIBLING — with CDPATH=/x, `cd ../b && git commit` still resolves", () => {
    withEnv("CDPATH", "/x", () => {
      expectCommitIn("cd ../b && git commit -m x", "/s/b", "/s/a");
    });
  });
  test("SIBLING — with CDPATH unset, `cd b && git commit` resolves as at HEAD", () => {
    withEnv("CDPATH", undefined, () => {
      expectCommitIn("cd b && git commit -m x", "/s/b", "/s");
    });
  });
  test("SIBLING — with CDPATH empty, `cd b && git commit` resolves as at HEAD", () => {
    withEnv("CDPATH", "", () => {
      expectCommitIn("cd b && git commit -m x", "/s/b", "/s");
    });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-613.2 — the directory stack
// ---------------------------------------------------------------------------

describe("AC-STE-613.2 — item 3: pushd / popd", () => {
  test("`pushd /s/b && git commit` resolves to /s/b", () => {
    expectCommitIn("pushd /s/b && git commit -m x", "/s/b");
  });
  test("`pushd /s/b >/dev/null; git commit` resolves to /s/b", () => {
    expectCommitIn("pushd /s/b >/dev/null; git commit -m x", "/s/b");
  });
  test("`pushd /s/b && popd && git commit` resolves to the session's checkout", () => {
    expectCommitIn("pushd /s/b && popd && git commit -m x", "/s/a");
  });
  test("`pushd /s/b && pushd /s/a/sub && popd && git commit` returns to /s/b", () => {
    expectCommitIn("pushd /s/b && pushd /s/a/sub && popd && git commit -m x", "/s/b");
  });
  test("`pushd -n /s/b && git commit` pushes without moving: the session's checkout", () => {
    expectCommitIn("pushd -n /s/b && git commit -m x", "/s/a");
  });
  test("`(pushd /s/b) && git commit` — the subshell restores stack and directory", () => {
    expectCommitIn("(pushd /s/b) && git commit -m x", "/s/a");
  });
  test("`(pushd /s/b); popd && git commit` — the subshell's push does not escape: popd is empty", () => {
    expectUnplaced("(pushd /s/b); popd && git commit -m x", "popd");
  });
  test("`popd && git commit` with an empty modelled stack is unresolvable naming popd", () => {
    expectUnplaced("popd && git commit -m x", "popd");
  });
  test("`pushd +1 && git commit` is unresolvable naming the word", () => {
    expectUnplaced("pushd +1 && git commit -m x", "+1");
  });
  test("`pushd -1 && git commit` is unresolvable naming the word", () => {
    expectUnplaced("pushd -1 && git commit -m x", "-1");
  });
  test("`popd +1 && git commit` is unresolvable naming the word", () => {
    expectUnplaced("popd +1 && git commit -m x", "+1");
  });
  test("`pushd /s/b && popd +1 && git commit` is unresolvable", () => {
    expectUnplaced("pushd /s/b && popd +1 && git commit -m x", "+1");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-613.3 — home
// ---------------------------------------------------------------------------

describe("AC-STE-613.3 — item 4: `~` is the hook process's home", () => {
  test("`cd ~/x && git commit` resolves to the checkout under HOME", () => {
    withEnv("HOME", "/h", () => {
      expectCommitIn("cd ~/x && git commit -m x", "/h/x");
    });
  });
  test("`git -C ~/x commit` resolves to the checkout under HOME", () => {
    withEnv("HOME", "/h", () => {
      expectCommitIn("git -C ~/x commit -m x", "/h/x");
    });
  });
  test("`cd ~ && cd x && git commit` resolves to the checkout under HOME", () => {
    withEnv("HOME", "/h", () => {
      expectCommitIn("cd ~ && cd x && git commit -m x", "/h/x");
    });
  });
  test("SIBLING — `cd ~other/x && git commit` is unresolvable", () => {
    withEnv("HOME", "/h", () => {
      expectUnplaced("cd ~other/x && git commit -m x", "~other");
    });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-613.4 — in-command variables
// ---------------------------------------------------------------------------

describe("AC-STE-613.4 — item 5: in-command variable bindings", () => {
  test('`B=/s/b; git -C "$B" commit` resolves to /s/b', () => {
    expectCommitIn('B=/s/b; git -C "$B" commit -m x', "/s/b");
  });
  test('`B=/s/b && cd "${B}" && git commit` resolves to /s/b', () => {
    expectCommitIn('B=/s/b && cd "${B}" && git commit -m x', "/s/b");
  });
  test('`S=/s; D=$S/b; git -C "$D" commit` resolves to /s/b', () => {
    expectCommitIn('S=/s; D=$S/b; git -C "$D" commit -m x', "/s/b");
  });
  test("`export B=/s/b; cd $B && git commit` resolves to /s/b", () => {
    expectCommitIn("export B=/s/b; cd $B && git commit -m x", "/s/b");
  });
  test("`B=/s/b; B=/s/a; git -C $B commit` — the later binding wins", () => {
    expectCommitIn("B=/s/b; B=/s/a/sub; git -C $B commit -m x", "/s/a");
  });
  test('SIBLING — `B=/s/b git -C "$B" commit` (a prefix assignment) is unresolvable', () => {
    expectUnplaced('B=/s/b git -C "$B" commit -m x', "$B");
  });
  test('SIBLING — `(B=/s/b); git -C "$B" commit` — a subshell binding does not escape', () => {
    expectUnplaced('(B=/s/b); git -C "$B" commit -m x', "$B");
  });
  test('CONTROL — `(B=/s/b; git -C "$B" commit)` — inside the subshell it binds', () => {
    expectCommitIn('(B=/s/b; git -C "$B" commit -m x)', "/s/b");
  });
  test('SIBLING — `B=/s/b; unset B; git -C "$B" commit` is unresolvable', () => {
    expectUnplaced('B=/s/b; unset B; git -C "$B" commit -m x', "$B");
  });
  test('SIBLING — `R=$(mktemp -d); git -C "$R" commit` is unresolvable naming $R', () => {
    expectUnplaced('R=$(mktemp -d); git -C "$R" commit -m x', "$R");
  });
  test('SIBLING — `S=$HOSTDIR; D=$S/b; git -C "$D" commit` (unbound name) is unresolvable', () => {
    expectUnplaced('S=$HOSTDIR; D=$S/b; git -C "$D" commit -m x', "$D");
  });
  test('SIBLING — a backtick value `R=`mktemp -d`; git -C "$R" commit` is unresolvable', () => {
    expectUnplaced('R=`mktemp -d`; git -C "$R" commit -m x', "$R");
  });
  test('SIBLING — `for d in /s/a /s/b; do git -C "$d" commit; done` is unresolvable', () => {
    expectUnplaced('for d in /s/a /s/b; do git -C "$d" commit -m x; done', "$d");
  });
  test('SIBLING — a loop variable shadows an earlier binding: `d=/s/b; for d in /s/a; do git -C "$d" commit; done`', () => {
    expectUnplaced('d=/s/b; for d in /s/a /s/b; do git -C "$d" commit -m x; done', "$d");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-613.5 — fixed computed directories
// ---------------------------------------------------------------------------

describe("AC-STE-613.5 — item 6: fixed computed directories", () => {
  for (const form of ["$(pwd)", '"$(pwd)"', "$PWD", "${PWD}", '"$PWD"', "`pwd`", "$(pwd -P)", "$(pwd -L)"]) {
    test(`\`cd /s/b && git -C ${form} commit\` resolves to /s/b`, () => {
      expectCommitIn(`cd /s/b && git -C ${form} commit -m x`, "/s/b");
    });
  }
  test("`git -C $(pwd) commit` from /s/a/sub resolves to /s/a", () => {
    expectCommitIn("git -C $(pwd) commit -m x", "/s/a", "/s/a/sub");
  });
  test("`git -C $(git rev-parse --show-toplevel) commit` from a subdirectory resolves to its checkout root", () => {
    expectCommitIn("git -C $(git rev-parse --show-toplevel) commit -m x", "/s/b", "/s/b/sub");
  });
  test("`cd /s/b/sub && git -C $(git rev-parse --show-toplevel) commit` resolves to /s/b", () => {
    expectCommitIn("cd /s/b/sub && git -C $(git rev-parse --show-toplevel) commit -m x", "/s/b");
  });
  test("`git -C $(git -C /s/b rev-parse --show-toplevel) commit` resolves to /s/b", () => {
    expectCommitIn("git -C $(git -C /s/b rev-parse --show-toplevel) commit -m x", "/s/b");
  });
  test("`(cd /s/b && git -C $(pwd) commit)` resolves to /s/b", () => {
    expectCommitIn("(cd /s/b && git -C $(pwd) commit -m x)", "/s/b");
  });
  test("`cd /s/b && cd $(pwd)/sub && git commit` resolves to /s/b", () => {
    expectCommitIn("cd /s/b && cd $(pwd)/sub && git commit -m x", "/s/b");
  });
  test("`B=$(pwd); cd /s/b && git -C $B commit` — the binding holds the directory at binding time", () => {
    expectCommitIn("cd /s/b && B=$(pwd); cd /s/a && git -C $B commit -m x", "/s/b");
  });
  test("SIBLING — `git -C $(dirname $(pwd)) commit` stays unresolvable", () => {
    expectUnplaced("git -C $(dirname $(pwd)) commit -m x", "$(dirname $(pwd))");
  });
  test("SIBLING — `git -C $(git rev-parse --git-dir) commit` stays unresolvable", () => {
    expectUnplaced("git -C $(git rev-parse --git-dir) commit -m x", "--git-dir");
  });
  test("SIBLING — `git -C $(mktemp -d) commit` stays unresolvable", () => {
    expectUnplaced("git -C $(mktemp -d) commit -m x", "$(mktemp -d)");
  });
  test("SIBLING — `git -C $OLDPWD commit` stays unresolvable", () => {
    expectUnplaced("git -C $OLDPWD commit -m x", "$OLDPWD");
  });
  test("CONTROL — `git -c user.name=$(whoami) commit` stays unresolvable", () => {
    expectUnplaced("git -c user.name=$(whoami) commit -m x", "$(whoami)");
  });
  test("CONTROL — `git --git-dir=$(pwd)/.git commit` stays unresolvable", () => {
    const t = expectUnplaced("git --git-dir=$(pwd)/.git commit -m x", null);
    expect(String(t.unresolved)).toMatch(/--git-dir|\$\(pwd\)/);
  });
});

// Review finding (STE-613 audit): `~` expansion must win over the CDPATH rule.
// Bash expands the tilde first, and an absolute path never searches CDPATH.
describe("STE-613 review — `~/…` is absolute, so CDPATH never applies to it", () => {
  const HROOTS = (d: string): string | null => (d === "/h/x" || d.startsWith("/h/x/") ? "/h/x" : null);
  for (const cmd of ["cd ~/x && git commit -m x", "pushd ~/x && git commit -m x"]) {
    test(`with CDPATH=/x and HOME=/h, \`${cmd}\` resolves to /h/x`, () => {
      const saved = { HOME: process.env.HOME, CDPATH: process.env.CDPATH };
      process.env.HOME = "/h";
      process.env.CDPATH = "/x";
      try {
        const t = resolveCommitTarget(cmd, "/s/a", HROOTS);
        expect({ repoRoot: t.repoRoot, unresolved: t.unresolved }).toEqual({ repoRoot: "/h/x", unresolved: null });
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    });
  }
});

// Review finding (STE-613): tilde expansion needs an UNQUOTED leading `~`.
// `cd "~/x"` names a directory literally called `~` under the running
// directory, so resolving it to HOME would be a confident wrong-tree answer.
describe("STE-613 review — a quoted or escaped `~` is never home", () => {
  const HROOTS = (d: string): string | null => (d === "/h/x" ? "/h/x" : d.startsWith("/s/") ? d.slice(0, 4) : null);
  const withHome = <T>(fn: () => T): T => {
    const saved = process.env.HOME;
    process.env.HOME = "/h";
    try {
      return fn();
    } finally {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
    }
  };
  for (const cmd of [`cd "~/x" && git commit -m x`, `cd '~/x' && git commit -m x`, "cd \\~/x && git commit -m x", `git -C "~/x" commit -m x`]) {
    test(`\`${cmd}\` is unplaced, never /h/x`, () => {
      const t = withHome(() => resolveCommitTarget(cmd, "/s/a", HROOTS));
      expect({ isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ isCommit: true, repoRoot: null });
      expect(String(t.unresolved)).toContain("~/x");
    });
  }
  test("CONTROL — the unquoted `cd ~/x` still resolves to /h/x", () => {
    const t = withHome(() => resolveCommitTarget("cd ~/x && git commit -m x", "/s/a", HROOTS));
    expect(t.repoRoot).toBe("/h/x");
  });
});

// Review finding (STE-613 Pass 1): commands that can rewrite a bound name make
// its value unknown. Item 5's rule — a value the model cannot read stays
// unexpanded — applied to the writers a command line uses. Each is paired with
// a control that differs only by the writer.
describe("STE-613 review — a command that can rewrite a binding makes it unknown", () => {
  const LOOK = (d: string): string | null => (d.startsWith("/s/") ? d.slice(0, 4) : null);
  for (const writer of ["read B", "declare B", "typeset B", "local B", "readonly B", "printf -v B x", "let B=1", "mapfile B", "getopts ab B", "source f.sh", ". f.sh"]) {
    test(`\`B=/s/b; ${writer}; git -C "$B" commit\` is unresolvable`, () => {
      const t = resolveCommitTarget(`B=/s/b; ${writer}; git -C "$B" commit -m x`, "/s/a", LOOK);
      expect({ isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ isCommit: true, repoRoot: null });
    });
  }
  test("CONTROL — `B=/s/b; echo B; git -C \"$B\" commit` still resolves to /s/b", () => {
    expect(resolveCommitTarget('B=/s/b; echo B; git -C "$B" commit -m x', "/s/a", LOOK).repoRoot).toBe("/s/b");
  });
  test("`select d in /s/b; do git -C \"$d\" commit; done` is unresolvable, like a `for` loop variable", () => {
    const t = resolveCommitTarget('select d in /s/b; do git -C "$d" commit -m x; done', "/s/a", LOOK);
    expect({ isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ isCommit: true, repoRoot: null });
  });
});

// Review finding (STE-613 Pass 2), both measured on the pre-fix bytes.
describe("STE-613 review — adversarial bindings neither crash the guard nor name the wrong tree", () => {
  const LOOK = (d: string): string | null => (d.startsWith("/s/") ? d.slice(0, 4) : null);

  // A binding may reference itself, so a chain doubles its value each step. At
  // 28 links the pre-fix resolver threw "Out of memory" — a crashed gate.
  for (const links of [20, 28, 40]) {
    test(`a ${links}-link self-referencing chain answers fast and never throws`, () => {
      const cmd = "A=xxxxxxxx;" + "A=$A$A;".repeat(links) + 'git -C "$A" commit -m x';
      const started = Date.now();
      const t = resolveCommitTarget(cmd, "/s/a", LOOK);
      expect({ isCommit: t.isCommit, repoRoot: t.repoRoot }).toEqual({ isCommit: true, repoRoot: null });
      expect(Date.now() - started).toBeLessThan(2000);
    });
  }
  test("CONTROL — a short chain of the same shape still resolves", () => {
    expect(resolveCommitTarget('A=/s; B=$A/b; git -C "$B" commit -m x', "/s/a", LOOK).repoRoot).toBe("/s/b");
  });

  // `PWD` is shell-maintained: `cd` re-stamps it over any manual assignment.
  // Verified against bash, which prints the cd target for `PWD=/x; cd /tmp`.
  test("`PWD=/s/b; cd /s/a/sub; git -C $PWD commit` follows the cd, not the stale binding", () => {
    const t = resolveCommitTarget("PWD=/s/b; cd /s/a/sub; git -C $PWD commit -m x", "/s/a", LOOK);
    expect({ repoRoot: t.repoRoot, unresolved: t.unresolved }).toEqual({ repoRoot: "/s/a", unresolved: null });
  });
  test("`PWD=/s/b; pushd /s/a/sub; git -C $PWD commit` follows the pushd too", () => {
    expect(resolveCommitTarget("PWD=/s/b; pushd /s/a/sub; git -C $PWD commit -m x", "/s/a", LOOK).repoRoot).toBe("/s/a");
  });
  test("CONTROL — with no directory change, a manual `PWD=` binding still stands", () => {
    expect(resolveCommitTarget("PWD=/s/b; git -C $PWD commit -m x", "/s/a", LOOK).repoRoot).toBe("/s/b");
  });
});
