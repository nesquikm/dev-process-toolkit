// A `LocalProvider` fixture repo carrying a REAL shipped git hook.
//
// WHY THIS MODULE EXISTS — AC-STE-461.15, and it is the structural reason a
// shipped defect sat under a green gate.
//
// `LocalProvider.claimLock` writes a lock, stages it and commits it. The
// toolkit ALSO ships a `commit-msg` hook that rejects any subject over 72
// characters, and `/setup` installs it into every project it bootstraps. Those
// two facts met for the first time in a downstream tree, never in this suite:
// NOTHING here has ever installed a hook into a lock-provider fixture, so every
// `claimLock` test committed into a hook-free repo and the collision was
// unreachable by construction. 7127 tests were green over it.
//
// So the harness is a first-class, reusable surface rather than scaffolding for
// two experiments. It exists so the next provider change is executed against
// the gate the toolkit actually installs, not against a gate-free repo.
//
// THREE THINGS IT REFUSES TO LEAVE TO ASSUMPTION:
//
//   1. The hook is the SHIPPED BYTES. `installCommitMsgHook` copies the
//      template verbatim and `assertHookIsShippedVerbatim` compares the two
//      files byte-for-byte. A "hook" that is a paraphrase tests the paraphrase.
//   2. The hook is LIVE. A hook file that is not executable is silently
//      IGNORED by git — the single most effective way to make an experiment
//      like E1 pass while proving nothing. `proveHookRejects` executes a
//      deliberately over-long subject and requires the commit to be REFUSED.
//   3. The failure is OBSERVED FROM INSIDE. `installRejectingPreCommit` writes
//      a hook that records the staged path list into `$GIT_DIR` BEFORE it
//      exits non-zero. Any rollback assertion can then be paired with proof
//      that the write-and-stage really happened — see `stagedWhenHookRan`.
//
// (3) is not decoration. `specs/plan/M121.md`'s fixture group 10 mutation 3
// "failed by THROWING OUT OF claimLock" and therefore proved nothing about the
// downstream predicate. A rollback assertion of the form "the tree is clean"
// is satisfied just as well by a provider that threw BEFORE writing anything,
// so on its own it cannot tell a working rollback from an absent write. Pairing
// it with the pre-commit hook's own observation closes that: the hook cannot
// have run unless the lock was written and staged first.

import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalProvider } from "../adapters/_shared/src/local_provider";

const TESTS_DIR = import.meta.dir;
export const PLUGIN_ROOT = join(TESTS_DIR, "..");
export const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

/** The two `commit-msg` hooks `/setup` can install. Both are shipped surfaces. */
export const SHIPPED_COMMIT_MSG_HOOKS = {
  /** The POSIX-shell hook, the default. Its 72-char cap is a literal in the script. */
  shell: join(PLUGIN_ROOT, "templates/git-hooks/commit-msg.sh"),
  /** `/setup --commitlint`. Execs `bunx commitlint`; the cap comes from the config. */
  commitlint: join(PLUGIN_ROOT, "templates/git-hooks/commit-msg.commitlint.sh"),
} as const;

export type CommitMsgHookVariant = keyof typeof SHIPPED_COMMIT_MSG_HOOKS;

/** The shipped commitlint config the `--commitlint` hook resolves at run time. */
export const SHIPPED_COMMITLINT_CONFIG = join(
  PLUGIN_ROOT,
  "templates/git-hooks/commitlint.config.js",
);

export interface GitRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run git, returning the outcome rather than throwing — failures are the subject here. */
export function gitTry(cwd: string, ...args: string[]): GitRun {
  const p = Bun.spawnSync({ cmd: ["git", ...args], cwd });
  return {
    exitCode: p.exitCode,
    stdout: new TextDecoder().decode(p.stdout),
    stderr: new TextDecoder().decode(p.stderr),
  };
}

/** Run git, throwing on failure. For setup steps that MUST succeed. */
export function git(cwd: string, ...args: string[]): string {
  const r = gitTry(cwd, ...args);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

export interface HookedFixture {
  /** Repo root. */
  root: string;
  /** The branch the fixture is checked out on — the variable the defect scaled with. */
  branch: string;
  /** `.git` — where the pre-commit hook drops its observation, out of `porcelain`'s way. */
  gitDir: string;
  /** Which shipped `commit-msg` hook is installed, or `null`. */
  commitMsgHook: CommitMsgHookVariant | null;
}

export interface HookedFixtureOptions {
  /** The branch to claim on. Length is the whole point — 4, 35 and 68 in E1. */
  branch: string;
  /** Which shipped hook to install, or `null` for a hook-free control repo. */
  commitMsgHook?: CommitMsgHookVariant | null;
  /** Prefix for the temp dir, so a leaked fixture names the experiment that leaked it. */
  label?: string;
}

/**
 * A git repo on `branch`, with one seed commit and the requested shipped hook.
 *
 * The branch is set with `symbolic-ref` before the first commit so the fixture
 * never depends on the operator's `init.defaultBranch`, and so a 68-character
 * branch is reached without a checkout that could fail on a fresh repo.
 */
export function buildHookedFixture(options: HookedFixtureOptions): HookedFixture {
  const root = mkdtempSync(join(tmpdir(), `${options.label ?? "ste461"}-`));
  git(root, "init", "--quiet");
  git(root, "symbolic-ref", "HEAD", `refs/heads/${options.branch}`);
  git(root, "config", "user.email", "ste461@example.invalid");
  git(root, "config", "user.name", "STE-461 Fixture");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(join(root, "specs", "frs", ".gitkeep"), "");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "chore: seed the tracker-less fixture");

  const f: HookedFixture = {
    root,
    branch: options.branch,
    gitDir: join(root, ".git"),
    commitMsgHook: null,
  };
  const variant = options.commitMsgHook === undefined ? "shell" : options.commitMsgHook;
  if (variant !== null) installCommitMsgHook(f, variant);
  return f;
}

/** Copy a shipped `commit-msg` hook into the fixture VERBATIM and make it executable. */
export function installCommitMsgHook(f: HookedFixture, variant: CommitMsgHookVariant): void {
  const target = join(f.gitDir, "hooks", "commit-msg");
  mkdirSync(join(f.gitDir, "hooks"), { recursive: true });
  copyFileSync(SHIPPED_COMMIT_MSG_HOOKS[variant], target);
  chmodSync(target, 0o755);
  if (variant === "commitlint") {
    // The hook execs `bunx commitlint`, which resolves its config from the
    // repo root — so the shipped config has to be there for the hook to be the
    // shipped hook rather than a hook running someone else's rules.
    copyFileSync(SHIPPED_COMMITLINT_CONFIG, join(f.root, "commitlint.config.js"));
  }
  f.commitMsgHook = variant;
}

/** Install an arbitrary `commit-msg` script — used for the stricter downstream hook. */
export function installCustomCommitMsgHook(f: HookedFixture, script: string): void {
  const target = join(f.gitDir, "hooks", "commit-msg");
  mkdirSync(join(f.gitDir, "hooks"), { recursive: true });
  writeFileSync(target, script);
  chmodSync(target, 0o755);
  f.commitMsgHook = null;
}

/** The installed hook's bytes, or `null` when no hook is installed. */
export function installedCommitMsgHookBytes(f: HookedFixture): string | null {
  const target = join(f.gitDir, "hooks", "commit-msg");
  return existsSync(target) ? readFileSync(target, "utf8") : null;
}

/** The path the pre-commit hook writes its observation to. Inside `.git`, so `porcelain` ignores it. */
export function observationPath(f: HookedFixture): string {
  return join(f.gitDir, "ste461-pre-commit-observed.txt");
}

export interface RejectingPreCommitOptions {
  /** The line the hook prints on stderr. The rollback diagnostic must carry it. */
  message: string;
  /**
   * Extra shell run AFTER the observation is recorded and BEFORE `exit 1`.
   * AC-STE-461.7 uses it to make the rollback itself fail.
   */
  sabotage?: string;
}

/**
 * A `pre-commit` hook that RECORDS the staged path list, then refuses.
 *
 * The rejection is deliberately unrelated to subject length — it is the class
 * AC-STE-461.4 names, of which the 72-char cap is one instance. The recorded
 * observation is what lets a caller prove the lock was written and staged
 * before the refusal, so a "clean tree" assertion cannot be satisfied by a
 * provider that threw earlier and never wrote at all.
 */
export function installRejectingPreCommit(
  f: HookedFixture,
  options: RejectingPreCommitOptions,
): void {
  const target = join(f.gitDir, "hooks", "pre-commit");
  mkdirSync(join(f.gitDir, "hooks"), { recursive: true });
  writeFileSync(
    target,
    [
      "#!/bin/sh",
      "# STE-461 fixture: observe, sabotage (optional), then refuse.",
      `git diff --cached --name-status > "${observationPath(f)}" 2>&1 || true`,
      options.sabotage ?? "",
      `printf '%s\\n' ${JSON.stringify(options.message)} >&2`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(target, 0o755);
}

/**
 * What was staged at the moment the `pre-commit` hook ran.
 *
 * `null` means the hook never ran — which, paired with a clean-tree assertion,
 * is the difference between "the rollback worked" and "nothing was ever
 * written". Callers assert on this rather than trusting the clean tree alone.
 */
export function stagedWhenHookRan(f: HookedFixture): string | null {
  const p = observationPath(f);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

export function removeHook(f: HookedFixture, name: "commit-msg" | "pre-commit"): void {
  rmSync(join(f.gitDir, "hooks", name), { force: true });
  if (name === "commit-msg") f.commitMsgHook = null;
}

/** `git status --porcelain`, the tree-corruption predicate every rollback AC reads. */
export function porcelain(f: HookedFixture): string {
  return gitTry(f.root, "status", "--porcelain").stdout.trim();
}

/** The last commit's subject. */
export function lastSubject(f: HookedFixture): string {
  return git(f.root, "log", "--format=%s", "-1");
}

/** The last commit's body. The branch moved here; the hook does not validate it. */
export function lastBody(f: HookedFixture): string {
  return gitTry(f.root, "log", "--format=%b", "-1").stdout.replace(/\s+$/, "");
}

/** Every subject in history, newest first. */
export function subjects(f: HookedFixture): string[] {
  return gitTry(f.root, "log", "--format=%s").stdout.split("\n").filter(Boolean);
}

export function lockPath(f: HookedFixture, id: string): string {
  return join(f.root, ".dpt", "locks", id);
}

export function lockExists(f: HookedFixture, id: string): boolean {
  return existsSync(lockPath(f, id));
}

/** A provider bound to the fixture. `skipFetch` — the fixture has no remotes to scan. */
export function provider(f: HookedFixture): LocalProvider {
  return new LocalProvider({ repoRoot: f.root, skipFetch: true });
}

export interface AttemptOutcome<T> {
  /** The resolved value, or `undefined` when the call threw. */
  returned: T | undefined;
  /** The thrown error's message, or `null` when nothing was thrown. */
  message: string | null;
  threw: boolean;
}

/**
 * Run a provider call and report BOTH halves of the outcome.
 *
 * Deliberately not `expect(...).rejects`: AC-STE-461.5's whole point is that a
 * throw and a returned result are DIFFERENT observations and the failure mode
 * being repaired is one silently becoming the other. Reporting `returned`
 * alongside `threw` means a swallowed error shows up as data rather than as an
 * assertion that never ran.
 */
export async function attempt<T>(fn: () => Promise<T>): Promise<AttemptOutcome<T>> {
  try {
    const returned = await fn();
    return { returned, message: null, threw: false };
  } catch (err) {
    return {
      returned: undefined,
      message: err instanceof Error ? err.message : String(err),
      threw: true,
    };
  }
}

/**
 * EXECUTED PROOF that the installed hook is running.
 *
 * A `commit-msg` hook that is not executable is skipped by git in silence, and
 * an experiment that "installed a hook" into such a repo measures nothing at
 * all while looking exactly like a passing one. So every experiment calls this
 * first: an over-long subject on an EMPTY commit (nothing staged, nothing to
 * clean up) must be REFUSED. If it is accepted, the hook is inert and every
 * conformance claim built on that fixture is worthless.
 */
export function proveHookRejects(f: HookedFixture): GitRun {
  const overlong = `chore(locks): ${"x".repeat(80)}`;
  if (overlong.length <= 72) throw new Error("proveHookRejects: the probe subject is not over-long");
  return gitTry(f.root, "commit", "--allow-empty", "--quiet", "-m", overlong);
}

/** EXECUTED control: a legal subject on an empty commit is ACCEPTED by the same hook. */
export function proveHookAccepts(f: HookedFixture): GitRun {
  const legal = "chore(locks): hook liveness control";
  if (legal.length > 72) throw new Error("proveHookAccepts: the control subject is over-long");
  const r = gitTry(f.root, "commit", "--allow-empty", "--quiet", "-m", legal);
  if (r.exitCode === 0) git(f.root, "reset", "--hard", "--quiet", "HEAD~1");
  return r;
}

/**
 * The `--commitlint` variant's missing-dependency diagnostic.
 *
 * STATED PLAINLY BECAUSE IT BOUNDS WHAT THE COMMITLINT ARM PROVES. The hook
 * execs `bunx commitlint`, and commitlint resolves `@commitlint/config-conventional`
 * from the repo under test. This repo does not depend on commitlint (see
 * `tests/commitlint-config.test.ts`), so in a fixture the resolution fails and
 * the hook reports a module-resolution error for EVERY subject, conforming or
 * not. On such a run the executed commitlint arm cannot discriminate, which is
 * exactly why AC-STE-461.2's commitlint half is ALSO carried by a
 * config-derived cap read out of the shipped `commitlint.config.js` — an
 * assertion that holds with no toolchain at all.
 *
 * What the executed arm still buys, on any machine where commitlint resolves,
 * is the real thing: a rule violation names the rule. So the assertion is
 * "accepted, or refused for a reason that is NOT a lint violation" — a
 * `header-max-length` failure fails it either way.
 */
export function isMissingCommitlintDependency(run: GitRun): boolean {
  const text = `${run.stdout}\n${run.stderr}`;
  return (
    /MODULE_NOT_FOUND/.test(text) ||
    /Cannot find module/.test(text) ||
    /bunx not found/.test(text) ||
    /Please add rules to your `commitlint\.config/.test(text)
  );
}

/** The effective subject cap the shipped commitlint config imposes, parsed from the file. */
export function shippedCommitlintCap(): number {
  const src = readFileSync(SHIPPED_COMMITLINT_CONFIG, "utf8");
  const m = /"header-max-length"\s*:\s*\[\s*\d+\s*,\s*"[a-z]+"\s*,\s*(\d+)\s*\]/.exec(src);
  if (m === null) {
    throw new Error(
      "shippedCommitlintCap: the shipped commitlint config states no header-max-length. " +
        "Without it the commitlint variant inherits upstream's 100 and the toolkit's own " +
        "72-char cap is silently relaxed — STE-142's defect, returning.",
    );
  }
  return Number.parseInt(m[1]!, 10);
}

/** The rule names the shipped commitlint config overrides. AC-STE-461.2 requires exactly one. */
export function shippedCommitlintOverriddenRules(): string[] {
  const src = readFileSync(SHIPPED_COMMITLINT_CONFIG, "utf8");
  const rulesAt = src.indexOf("rules:");
  if (rulesAt < 0) return [];
  const open = src.indexOf("{", rulesAt);
  const close = src.indexOf("}", open);
  return [...src.slice(open, close).matchAll(/"([a-z-]+)"\s*:/g)].map((m) => m[1]!);
}

/**
 * Remove a fixture, restoring permissions first.
 *
 * AC-STE-461.7's scenario chmods the lock directory read-only from inside a
 * hook so the rollback's `unlink` fails. A plain `rmSync` cannot delete through
 * that, and a leaked fixture is a dirty machine, not a test result.
 */
export function cleanup(f: HookedFixture): void {
  Bun.spawnSync({ cmd: ["chmod", "-R", "u+rwX", f.root] });
  rmSync(f.root, { recursive: true, force: true });
}

/** The subject `claimLock` is required to build. Prefix is 29 chars; total is 29 + len(id). */
export const CLAIM_SUBJECT_PREFIX = "chore(locks): claim lock for ";

/** The subject `releaseLock` builds. */
export const RELEASE_SUBJECT_PREFIX = "chore(locks): release lock for ";

/** The cap the shipped shell hook enforces, as a literal read from the shipped script. */
export function shippedShellHookCap(): number {
  const src = readFileSync(SHIPPED_COMMIT_MSG_HOOKS.shell, "utf8");
  const m = /subject_len"?\s*-gt\s*(\d+)/.exec(src) ?? /-gt\s+(\d+)\s*\]/.exec(src);
  if (m === null) {
    throw new Error("shippedShellHookCap: the shipped shell hook states no numeric subject cap");
  }
  return Number.parseInt(m[1]!, 10);
}
