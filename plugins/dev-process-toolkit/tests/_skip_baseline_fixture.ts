// _skip_baseline_fixture — one git fixture for every test that needs a
// capturable skip baseline.
//
// WHY THIS EXISTS. M136 / STE-527 re-keyed the baseline store from the branch
// name to the TRUNK COMMIT, and made capture refuse unless HEAD stands on the
// sha being captured with a clean tree. Before that, a baseline could be seeded
// into any `mkdtemp` directory with two lines and no git at all, and four M132
// test files did exactly that. Under the new contract those fixtures are not
// merely outdated — they are asking for something the module is now required to
// refuse.
//
// The alternative to this module was four private git fixtures. They would
// agree on the day they were written; the first one to be adjusted for a new
// precondition would then silently stop resembling the others, and the tests
// most likely to notice a capture regression would be the ones whose fixture
// had drifted furthest from what capture actually does.
//
// NOT A MOCK. Everything here is a real repository on disk, and `seedBaseline`
// drives the SHIPPED `captureSkipBaseline`. A fixture that wrote the store file
// itself would keep passing after capture stopped working, which is the whole
// class of defect M136 was opened over.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROTECTED_TRUNKS } from "../adapters/_shared/src/branch_proposal";
import { dptRoot } from "../adapters/_shared/src/dpt_paths";
import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";

/** The trunk a fixture repository is created on — the shipped first member. */
export const FIXTURE_TRUNK = PROTECTED_TRUNKS[0] as string;

/** A throwaway directory. Callers are responsible for their own cleanup. */
export function fixtureTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `dpt-${label}-`));
}

/** Run git in `cwd`, returning trimmed stdout. Throws on a non-zero exit. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** A fixture repository: where it is, and the trunk commit it stands on. */
export interface FixtureRepo {
  readonly root: string;
  /** The commit `resolveTrunkSha` will return for this root. */
  readonly trunkSha: string;
}

/**
 * A git project standing on the first protected trunk with a CLEAN tree.
 *
 * The shipped `.dpt/.gitignore` body is written AND COMMITTED, exactly as a
 * `/setup`-bootstrapped project carries it. That is load-bearing rather than
 * scene-setting: an ignore policy that does not cover what capture writes makes
 * the tree dirty the moment capture mints anything, and capture would then
 * refuse on its own artifact.
 */
export function makeTrunkRepo(label: string): FixtureRepo {
  const root = fixtureTempDir(`repo-${label}`);

  // The label goes INTO the committed tree, so two fixtures never share a sha.
  // Git derives a commit id from its tree, message, author and timestamp, and
  // the timestamp has one-second resolution — so two byte-identical fixtures
  // built in the same second are the SAME commit. A test asserting that one
  // root's key is absent from another's store would then be comparing a key to
  // itself, and would pass or fail on how fast the machine was.
  writeFileSync(join(root, "README.md"), `# fixture ${label}\n`);
  mkdirSync(dptRoot(root), { recursive: true });
  writeFileSync(join(dptRoot(root), ".gitignore"), DPT_GITIGNORE_BODY);

  git(root, ["init", "-q", "-b", FIXTURE_TRUNK]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "chore: fixture"]);

  return { root, trunkSha: git(root, ["rev-parse", "HEAD"]) };
}

/** Cut a feature branch and put one commit on it, so HEAD leaves the trunk. */
export function cutBranch(root: string, name: string): void {
  git(root, ["checkout", "-q", "-b", name]);
  writeFileSync(join(root, `${name.replace(/\W+/g, "-")}.md`), "work\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", `feat: ${name}`]);
}

/** The capture surface a fixture drives — the shipped module's own shape. */
export interface CaptureModule {
  captureSkipBaseline(
    projectRoot: string,
    sha: string,
    skipped: number,
  ): { written: boolean };
}

/**
 * A repository whose trunk commit already carries a baseline of `skipped`.
 *
 * The capture happens while HEAD is still ON the trunk with a clean tree —
 * the only state the shipped guard accepts — and the branch is cut afterwards,
 * which is also the order the real flow is supposed to use. `written` is
 * asserted by throwing rather than by an `expect`, so this module stays usable
 * from a non-test context and a silently skipped write can never look like a
 * seeded fixture.
 */
export function repoWithBaseline(
  mod: CaptureModule,
  label: string,
  skipped: number,
  branch?: string,
): FixtureRepo {
  const repo = makeTrunkRepo(label);

  const result = mod.captureSkipBaseline(repo.root, repo.trunkSha, skipped);
  if (!result.written) {
    throw new Error(
      `repoWithBaseline(${label}): capture wrote nothing for ${repo.trunkSha} — ` +
        "the fixture is not seeded, and any assertion made against it would be vacuous",
    );
  }

  if (branch !== undefined) cutBranch(repo.root, branch);
  return repo;
}
