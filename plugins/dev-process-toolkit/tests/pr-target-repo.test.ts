// STE-615 — the pull-request gate finds the repository a request is opened from.
//
// AC-STE-615.1 (recognition) and AC-STE-615.2 (the target), graded against the
// NEW module `adapters/_shared/src/pr_target_repo.ts` on REAL `git init`
// checkouts with REAL `origin` remotes.
//
// ---------------------------------------------------------------------------
// THE CONTRACT THIS SUITE PINS (the module does not exist yet — this is its spec)
// ---------------------------------------------------------------------------
//
//   export interface PrTarget {
//     /** True when the command creates a pull request, in any recognised shape. */
//     isPr: boolean;
//     /** The checkout the request is opened from, or null. */
//     repoRoot: string | null;
//     /** Every checkout the command was RESOLVED to open a request from. */
//     repoRoots: string[];
//     /** Non-null exactly when the target could not be determined. */
//     unresolved: string | null;
//     /** True when the command named no directory the reader could resolve. */
//     unplaced: boolean;
//     /** Checkouts an unplaced request could be opened from. */
//     candidateRoots: string[];
//     /**
//      * THE ONE FIELD `CommitTarget` HAS NO ANALOGUE FOR. Non-null when the
//      * command names a repository slug that NO remote of the local checkout
//      * matches: a known-foreign target. It carries the slug verbatim, so the
//      * hook's refusal can name it.
//      *
//      * It is a field of its own rather than a flavour of `unresolved` because
//      * the two legs end differently: a known-foreign target is REFUSED with
//      * exit 2 even when the evidence is there (evidence in one checkout cannot
//      * vouch for a request into another repository), while an unresolved one
//      * is REMINDED about with exit 1 once the evidence holds. One field cannot
//      * carry both verdicts, and a hook that guessed would get one of them
//      * wrong in silence.
//      */
//     foreign: string | null;
//   }
//
//   export function resolvePrTargetFromPayload(
//     payload: { cwd?: string; tool_input?: { command?: string } },
//     roots?: (dir: string) => string | null,
//   ): PrTarget;
//
// On a known-foreign answer `repoRoot` is null, `repoRoots` is empty,
// `unresolved` is null, `unplaced` is false, and `candidateRoots` names the
// local checkout the request runs in — that is what lets the refusal say both
// the slug and the checkout, as AC-STE-615.2 requires.
//
// WHY REAL GIT: the slug-to-remote match is read with `git remote -v` run in
// the resolved checkout. A fixture that stubbed the remote list would keep
// passing on the day the spawn broke, which is the failure this FR closes on
// the recogniser side.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, makeSpanFixture, type SpanFixture } from "./_span_fixture";

import {
  resolvePrTargetFromPayload,
} from "../adapters/_shared/src/pr_target_repo";

/** The two remotes AC-STE-615.2 names, one ssh and one https, one with `.git`. */
const FE_REMOTE = "git@github.com:org/fe.git";
const BE_REMOTE = "https://github.com/org/be";

let fx: SpanFixture;
/** FE — the session's own checkout. */
let FE = "";
/** BE — the sibling checkout. */
let BE = "";
/** A linked worktree of FE. */
let WT = "";
/** A checkout with no remotes at all. */
let BARE = "";
/** A directory holding an empty PATH, so a spawned `git` cannot be found. */
let NO_GIT_PATH = "";
let scratch = "";

/** Resolve `command` as if the session sat in `cwd` (default: FE). */
function resolve(command: string, cwd: string = FE) {
  return resolvePrTargetFromPayload({ cwd, tool_input: { command } });
}

/** Run `fn` with `name` set to `value` in the hook process's own environment. */
function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

/** Same checkout, whatever `/var` vs `/private/var` spelling either side used. */
function sameRoot(actual: string | null, expected: string): boolean {
  return actual !== null && realpathSync(actual) === realpathSync(expected);
}

beforeAll(() => {
  fx = makeSpanFixture("M_ste615");
  FE = fx.a;
  BE = fx.b;
  git(FE, "remote", "add", "origin", FE_REMOTE);
  git(BE, "remote", "add", "origin", BE_REMOTE);

  scratch = mkdtempSync(join(tmpdir(), "ste615-scratch-"));

  WT = join(scratch, "fe-worktree");
  git(FE, "worktree", "add", "-q", "-b", "ste615-wt", WT);

  BARE = mkdtempSync(join(tmpdir(), "ste615-noremote-"));
  git(BARE, "init", "-q", "-b", "main");
  writeFileSync(join(BARE, "README.md"), "no remotes here\n");

  NO_GIT_PATH = join(scratch, "bin-no-git");
  mkdirSync(NO_GIT_PATH, { recursive: true });
});

afterAll(() => {
  fx?.cleanup();
  rmSync(BARE, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-STE-615.1 — recognition. Every row the AC names, each in its own test.
// ---------------------------------------------------------------------------

describe("AC-STE-615.1 — PR creation is recognised in every shape the AC names", () => {
  const creating = (): Array<[string, string]> => [
    ["bare", "gh pr create"],
    ["an absolute argv0", "/opt/homebrew/bin/gh pr create"],
    ["`-R` before `pr`", "gh -R o/r pr create"],
    ["`--repo=` after `create`", "gh pr create --repo=o/r"],
    ["a `cd` prefix", `cd ${BE} && gh pr create`],
    ["a parenthesised subshell", `(cd ${BE}; gh pr create)`],
    ["chained after a push with `&&`", "git push -u origin b && gh pr create"],
    ["chained after a push by newline", "git push -u origin b\ngh pr create"],
    ["a `GH_REPO=` prefix assignment", "GH_REPO=o/r gh pr create"],
    ["a `GH_REPO=` env operand", "env GH_REPO=o/r gh pr create"],
    ["the `command` wrapper", "command gh pr create"],
    ["a nested shell", "bash -lc 'gh pr create'"],
    ["a command substitution", "url=$(gh pr create --fill)"],
    ["gh's built-in `new` alias", "gh pr new"],
    ["`new` behind a `cd` prefix", `cd ${BE} && gh pr new`],
    ["`--dry-run`, conservatively", "gh pr create --dry-run"],
  ];

  for (const [label, command] of creating()) {
    test(`${label}: \`${command.replace(/\n/g, "\\n")}\` is PR creation`, () => {
      expect({ command, isPr: resolve(command).isPr }).toEqual({ command, isPr: true });
    });
  }
});

describe("AC-STE-615.1 — every out-of-scope row is named by its own test", () => {
  const notCreating: Array<[string, string]> = [
    ["`gh pr list` reads, it does not create", "gh pr list"],
    ["`gh pr view` reads one request", "gh pr view 1"],
    ["`gh pr merge` closes one, it opens none", "gh pr merge 1"],
    ["`gh api …/pulls` is the REST door, not the gh grammar", "gh api repos/o/r/pulls -X POST"],
    ["`hub pull-request` is another tool entirely", "hub pull-request"],
    ["`git push -o merge_request.create` is GitLab's push option", "git push -o merge_request.create"],
    ["a script FILE is not read", "bash make_pr.sh"],
    ["an opaque `bash -c \"$X\"` holds no literal creation", 'bash -c "$X"'],
    ["`--help` prints help and creates nothing", "gh pr create --help"],
    ["`-h` is the same help", "gh pr create -h"],
    [
      "a heredoc BODY that merely mentions the command",
      "cat > f.md <<'EOF'\ngh pr create --title x\nEOF",
    ],
  ];

  for (const [label, command] of notCreating) {
    test(`${label}: \`${command.replace(/\n/g, "\\n")}\` is not PR creation`, () => {
      expect({ command, isPr: resolve(command).isPr }).toEqual({ command, isPr: false });
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-615.2 — the target.
// ---------------------------------------------------------------------------

describe("AC-STE-615.2 — the target checkout, session rooted in FE", () => {
  test("`cd <BE> && gh pr create` resolves to BE", () => {
    const t = resolve(`cd ${BE} && gh pr create`);
    expect({ isPr: t.isPr, be: sameRoot(t.repoRoot, BE) }).toEqual({ isPr: true, be: true });
    expect(t.repoRoots.map((r) => realpathSync(r))).toEqual([realpathSync(BE)]);
    expect({ foreign: t.foreign, unresolved: t.unresolved }).toEqual({ foreign: null, unresolved: null });
  });

  test("a bare `gh pr create` resolves to FE", () => {
    const t = resolve("gh pr create");
    expect({ isPr: t.isPr, fe: sameRoot(t.repoRoot, FE) }).toEqual({ isPr: true, fe: true });
    expect({ foreign: t.foreign, unresolved: t.unresolved }).toEqual({ foreign: null, unresolved: null });
  });

  test("`gh pr create --repo org/fe` matches FE's ssh remote and resolves to FE", () => {
    const t = resolve("gh pr create --repo org/fe");
    expect({ fe: sameRoot(t.repoRoot, FE), foreign: t.foreign }).toEqual({ fe: true, foreign: null });
  });

  test("`gh pr create -R github.com/ORG/FE` matches case-insensitively, with a HOST/ prefix", () => {
    const t = resolve("gh pr create -R github.com/ORG/FE");
    expect({ fe: sameRoot(t.repoRoot, FE), foreign: t.foreign }).toEqual({ fe: true, foreign: null });
  });

  test("`cd <BE> && GH_REPO=org/be gh pr create` matches BE's https remote and resolves to BE", () => {
    const t = resolve(`cd ${BE} && GH_REPO=org/be gh pr create`);
    expect({ be: sameRoot(t.repoRoot, BE), foreign: t.foreign }).toEqual({ be: true, foreign: null });
  });

  test("`--repo` wins over `GH_REPO` when both are given", () => {
    // GH_REPO names BE, `--repo` names FE, and the command runs in FE. If
    // GH_REPO won, this would be a known-foreign refusal instead.
    const t = resolve("GH_REPO=org/be gh pr create --repo org/fe");
    expect({ fe: sameRoot(t.repoRoot, FE), foreign: t.foreign }).toEqual({ fe: true, foreign: null });
  });

  test("`GH_REPO=org/be` in the hook process's own environment is known-foreign from FE", () => {
    const t = withEnv("GH_REPO", "org/be", () => resolve("gh pr create"));
    expect({ isPr: t.isPr, foreign: t.foreign }).toEqual({ isPr: true, foreign: "org/be" });
    expect({ root: t.repoRoot, roots: t.repoRoots }).toEqual({ root: null, roots: [] });
  });

  test("`GH_REPO=org/fe` in the hook process's own environment resolves to FE", () => {
    const t = withEnv("GH_REPO", "org/fe", () => resolve("gh pr create"));
    expect({ fe: sameRoot(t.repoRoot, FE), foreign: t.foreign }).toEqual({ fe: true, foreign: null });
  });

  test("`gh pr create --repo org/be` from FE is a known-foreign target naming `org/be`", () => {
    const t = resolve("gh pr create --repo org/be");
    expect({ isPr: t.isPr, foreign: t.foreign, unresolved: t.unresolved })
      .toEqual({ isPr: true, foreign: "org/be", unresolved: null });
    // The refusal has to name the checkout as well as the slug.
    expect(t.candidateRoots.map((r) => realpathSync(r))).toEqual([realpathSync(FE)]);
  });

  test("`gh pr create --repo \"$R\"` is unresolved, naming `$R`", () => {
    const t = resolve('gh pr create --repo "$R"');
    expect({ isPr: t.isPr, foreign: t.foreign, unplaced: t.unplaced })
      .toEqual({ isPr: true, foreign: null, unplaced: true });
    expect(t.repoRoot).toBeNull();
    expect(t.unresolved ?? "").toContain("$R");
  });

  test("a `git remote` lookup that cannot run is unresolved, naming the remote lookup", () => {
    const t = withEnv("PATH", NO_GIT_PATH, () => resolve("gh pr create --repo org/fe"));
    expect({ isPr: t.isPr, root: t.repoRoot, foreign: t.foreign })
      .toEqual({ isPr: true, root: null, foreign: null });
    expect(t.unresolved ?? "").toMatch(/git remote/);
    expect(t.unplaced).toBe(true);
  });

  test("CONTROL — the same command with git back on PATH resolves to FE", () => {
    expect(sameRoot(resolve("gh pr create --repo org/fe").repoRoot, FE)).toBe(true);
  });

  test("`gh pr create --repo org/fe` from a checkout with NO remotes is known-foreign", () => {
    const t = resolve("gh pr create --repo org/fe", BARE);
    expect({ isPr: t.isPr, foreign: t.foreign, unresolved: t.unresolved })
      .toEqual({ isPr: true, foreign: "org/fe", unresolved: null });
  });

  test("a slug that is neither OWNER/REPO nor HOST/OWNER/REPO is refused, naming the slug", () => {
    const t = resolve("gh pr create --repo fe");
    expect({ isPr: t.isPr, foreign: t.foreign, root: t.repoRoot })
      .toEqual({ isPr: true, foreign: "fe", root: null });
  });

  test("`cd <FE linked worktree> && gh pr create` resolves to the WORKTREE's root, not FE's", () => {
    const t = resolve(`cd ${WT} && gh pr create`);
    expect({ isPr: t.isPr, wt: sameRoot(t.repoRoot, WT) }).toEqual({ isPr: true, wt: true });
    expect(sameRoot(t.repoRoot, FE)).toBe(false);
  });
});
