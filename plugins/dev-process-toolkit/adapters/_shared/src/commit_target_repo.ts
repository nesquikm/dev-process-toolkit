// commit_target_repo — resolve the repository a commit will WRITE TO (STE-597).
//
// The defect this module closes: both pre-commit hooks decided what to check by
// looking at the directory their own process happened to sit in, and recognised
// a commit only through `/^git commit\b/` — a matcher that misses
// `cd <dir> && git commit` and `git -C <dir> commit` entirely. It refused the
// careful path and permitted the careless one.
//
// AC-STE-597.1 — a commit-bearing command is recognised in three shapes (bare,
//   directory-change-prefixed, `-C`), and each resolves its target repository.
// AC-STE-597.4 — an unresolvable target is NAMED, never refused: `isCommit`
//   stays true, `repoRoot` is null, and `unresolved` says what could not be
//   determined. Callers emit a `Reminder:` on that leg and exit 1 (STE-601): a
//   PreToolUse exit 0 shows no stderr, so an exit-0 advisory is a silent allow.
//
// Pure with respect to the filesystem except `checkoutRootOf` and `gitAliasOf`:
// the resolver takes both lookups as arguments so callers (and tests) can
// inject them, mirroring the injected-probe idiom the rest of `_shared` uses. The one
// other reader of ambient state is `resolveCommitTargetFromPayload`, which
// falls back to `process.cwd()` only when the payload declares no directory.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  argv0Is,
  changeDirectory,
  type CheckoutRootLookup,
  FULL_READING,
  isUnexpanded,
  MAX_NESTING,
  readInvocations,
  type ReadingRules,
  resolvePath,
  type RunningDirectory,
} from "./shell_invocations";

/**
 * The reading the commit question is asked under: the whole grammar. Prefix
 * wrappers and leading assignments (AC-STE-601.2) read `env X=1 time command
 * git commit` as the `git commit` it runs; reserved words and nested shells
 * reach the commit inside `if …; then` and `bash -c`; substitutions
 * (AC-STE-601.6) run `echo $(git commit)`'s commit, quoted or not, in the
 * running directory.
 */
const COMMIT_READING: ReadingRules = FULL_READING;

/**
 * A literal commit inside a nested string the reader declined to open because
 * it sat deeper than `MAX_NESTING` (AC-STE-601.5). The string was not parsed,
 * so this only asks whether it SPELLS a commit — enough to refuse a silent
 * `isCommit: false`, never enough to place it.
 */
const LITERAL_COMMIT = /\bgit\b[\s\S]*\bcommit\b/;

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

/** The command shapes a commit can arrive in. `none` means: not a commit. */
export type CommitCommandShape = "none" | "bare" | "cd-prefixed" | "dash-c";

/** The resolved (or explicitly unresolved) target of a commit-bearing command. */
export interface CommitTarget {
  /** True when the command actually runs `git commit`, in any of the shapes. */
  isCommit: boolean;
  /** Which shape carried it; `"none"` if and only if `isCommit` is false. */
  shape: CommitCommandShape;
  /** Checkout root the commit writes to, or null when it cannot be determined. */
  repoRoot: string | null;
  /** Non-null exactly when `repoRoot` is null: what could not be determined. */
  unresolved: string | null;
  /**
   * EVERY checkout the command was RESOLVED to write to (STE-614 AC.9): the
   * one-element `[repoRoot]` when there is one, every distinct root when the
   * command commits to several, and empty when the target is unresolved.
   *
   * Additive on purpose. `repoRoot` keeps its meaning — the single checkout, or
   * null — because callers that can speak about one repository and no more (the
   * /tdd hook's staged-set classification) must not be handed the first of two.
   * A caller that grades a rule PER checkout reads this instead, and a
   * multi-checkout command then stops being a hole: evidence has to hold in
   * every root here, and the refusal names each one that lacks it.
   *
   * Empty is therefore the honest test for "unresolved", and the one the guards
   * branch on: `repoRoot === null` is also true of the several-checkouts answer,
   * which is fully resolved.
   */
  repoRoots: string[];
  /**
   * True when the command never named a directory the reader could resolve —
   * an unexpanded word, a wrapper it cannot see through, `--git-dir`/`GIT_DIR`,
   * or a subshell whose extent is unknown. The commit could land ANYWHERE.
   *
   * False for a directory that resolved but holds no checkout: that answer is
   * known, not undetermined — the commit lands nowhere, git will say so, and
   * there is no repository there for a repository-scoped rule to grade. Both
   * answers carry a null `repoRoot` and an empty `repoRoots`, which is why the
   * distinction needs a name of its own.
   */
  unplaced: boolean;
  /** Checkouts an unplaced commit could write to; empty on every other answer. */
  candidateRoots: string[];
  /**
   * The git subcommand that writes the commit (`commit`, `merge`, `revert`, ...),
   * or null when it is not a commit or the command could not be read far enough
   * to say (AC-STE-601.8).
   */
  subcommand: string | null;
  /**
   * True when the commit is built from the STAGED SET: a plain `git commit`, or
   * a `--continue` that concludes a stopped merge, cherry-pick, revert or am.
   * A guard that classifies staged paths can only speak for these.
   */
  fromIndex: boolean;
  /**
   * Non-null when the command writes no commit but runs a history-changing git
   * subcommand the gates do not cover (`pull`, `rebase`, `stash`, writing
   * `notes`) — a notice naming it, so the gap is never silent (AC-STE-601.9).
   */
  advisory: string | null;
}

/** Directory → checkout root lookup. Returns null for "inside no checkout". */
export type CheckoutRootResolver = CheckoutRootLookup;

// ---------------------------------------------------------------------------
// checkoutRootOf — walk up to the first directory holding a `.git` entry.
// ---------------------------------------------------------------------------

/**
 * The checkout root containing `dir`, or null when `dir` is inside no checkout.
 *
 * Tests for a `.git` ENTRY, not a `.git` DIRECTORY: in a linked worktree `.git`
 * is a file holding a `gitdir:` pointer, and a directory-only test would walk
 * straight past the worktree root into whatever encloses it.
 */
export function checkoutRootOf(dir: string): string | null {
  let current = dir;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Command parsing.
// ---------------------------------------------------------------------------

interface CommitOccurrence {
  shape: Exclude<CommitCommandShape, "none">;
  /** The literal directory the commit writes in, when known. */
  dir: string | null;
  /** The unexpandable word standing in for that directory, when it is not. */
  word: string | null;
  /** The commit-writing subcommand, when the invocation was read far enough. */
  subcommand: string | null;
  /** Whether that commit is built from the staged set. */
  fromIndex: boolean;
}

/** Global options that take the next word as their value. */
const GIT_GLOBAL_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/**
 * Global options that NAME A REPOSITORY other than the one `-C`/cwd implies.
 *
 * `checkoutRootOf` reasons about a working directory; these point somewhere a
 * directory walk cannot follow — a bare `.git`, a detached work tree. Skipping
 * them silently attributes the commit to the SESSION's checkout, which is a
 * confident answer about the wrong repository. Naming them is the honest one.
 * `-c key=value` deliberately stays out: it configures, it names no tree.
 */
const REPO_NAMING_OPTS = new Set(["--git-dir", "--work-tree"]);

/**
 * AC-STE-601.8 — every subcommand that WRITES A COMMIT, as data.
 *
 * `excludes` are the options under which the subcommand writes none (it stops
 * short, fast-forwards, or abandons the operation); `fromIndex` are the options
 * under which the commit it writes is built from the staged set. `commit`
 * itself is always built from the index.
 */
interface CommitSubcommand {
  excludes: readonly string[];
  fromIndex: readonly string[] | "always";
}

const PICK_EXCLUDES = ["-n", "--no-commit", "--abort", "--quit", "--skip"] as const;

export const COMMIT_SUBCOMMANDS: Readonly<Record<string, CommitSubcommand>> = {
  commit: { excludes: [], fromIndex: "always" },
  merge: { excludes: ["--ff-only", "--squash", "--no-commit", "--abort", "--quit"], fromIndex: ["--continue"] },
  "cherry-pick": { excludes: PICK_EXCLUDES, fromIndex: ["--continue"] },
  revert: { excludes: PICK_EXCLUDES, fromIndex: ["--continue"] },
  am: { excludes: ["--abort", "--quit", "--show-current-patch"], fromIndex: ["--continue"] },
  "commit-tree": { excludes: [], fromIndex: [] },
};

/**
 * AC-STE-601.9 — subcommands that change history OUTSIDE the gated commit path,
 * as data. They are out of scope for the gates but never silent: the gate-check
 * hook names them in a `Reminder:`.
 *
 * `excludes` are options under which the subcommand changes nothing worth a
 * notice (`rebase --abort`). `actions`, when present, is the list of first
 * non-option words that advise; any other action (`stash list`, `notes list`)
 * is read-only. `bare` says whether the subcommand with no action advises
 * (`git stash` pushes; `git notes` lists).
 */
interface AdvisorySubcommand {
  excludes: readonly string[];
  actions?: readonly string[];
  bare?: boolean;
}

export const ADVISORY_SUBCOMMANDS: Readonly<Record<string, AdvisorySubcommand>> = {
  pull: { excludes: [] },
  rebase: { excludes: ["--abort", "--quit"] },
  stash: { excludes: [], actions: ["push", "save"], bare: true },
  notes: { excludes: [], actions: ["add", "append", "copy", "edit", "merge", "remove", "prune"], bare: false },
};

/** The advisory for an out-of-scope subcommand, or null when it needs none. */
function advisoryOf(subcommand: string | null, args: readonly string[]): string | null {
  const row = subcommandRow(ADVISORY_SUBCOMMANDS, subcommand);
  if (row === null) return null;
  if (optionNames(args).some((n) => row.excludes.includes(n))) return null;
  if (row.actions !== undefined) {
    const action = args.find((a) => !a.startsWith("-"));
    if (action === undefined ? row.bare !== true : !row.actions.includes(action)) return null;
  }
  return (
    `\`git ${subcommand}\` changes history outside the gated commit path, so the ` +
    `pre-commit gates do not check it`
  );
}

/** Environment variables that name the repository git writes to (AC-STE-601.11). */
const REPO_NAMING_ENV = new Set(["GIT_DIR", "GIT_WORK_TREE"]);

/** The last repository-naming binding a command runs under, or null. */
function repoBindingOf(assignments: readonly string[]): { name: string; value: string } | null {
  let found: { name: string; value: string } | null = null;
  for (const a of assignments) {
    const equals = a.indexOf("=");
    const name = a.slice(0, equals);
    if (REPO_NAMING_ENV.has(name)) found = { name, value: a.slice(equals + 1) };
  }
  return found;
}

/**
 * The NAMES of the options before `--` (after it every word is a path or
 * revision, never a flag). A long option is named without its value, so
 * `--show-current-patch=diff` is `--show-current-patch`.
 */
function optionNames(args: readonly string[]): string[] {
  const end = args.indexOf("--");
  return (end === -1 ? args : args.slice(0, end))
    .filter((a) => a.startsWith("-"))
    .map((a) => (a.startsWith("--") ? (a.split("=")[0] as string) : a));
}

/** A subcommand's row in one of the tables above, or null when it has none. */
function subcommandRow<T>(table: Readonly<Record<string, T>>, subcommand: string | null): T | null {
  return subcommand !== null && Object.hasOwn(table, subcommand) ? (table[subcommand] as T) : null;
}

/** What a commit-writing invocation writes: its subcommand, and whether from the index. */
interface CommitWrite {
  subcommand: string;
  fromIndex: boolean;
}

/**
 * The commit-writing reading of a subcommand and its arguments, or null when
 * this invocation writes no commit. Options are compared on their name.
 */
function commitSubcommandOf(subcommand: string | null, args: readonly string[]): CommitWrite | null {
  const row = subcommandRow(COMMIT_SUBCOMMANDS, subcommand);
  if (row === null || subcommand === null) return null;
  const names = optionNames(args);
  if (names.some((n) => row.excludes.includes(n))) return null;
  const fromIndex = row.fromIndex === "always" || names.some((n) => row.fromIndex.includes(n));
  return { subcommand, fromIndex };
}

interface GitInvocation {
  /**
   * Every `-C` argument, IN ORDER.
   *
   * git CHAINS them: each `-C` is resolved against the directory the previous
   * one selected, so `git -C /a -C sub commit` commits in `/a/sub`. Keeping only
   * the last and resolving it against the session's directory answers
   * `<session>/sub` — a confident answer about the wrong repository.
   */
  dashCs: string[];
  /** A repository-naming global option this resolver cannot follow, if present. */
  repoOption: string | null;
  /**
   * A GLOBAL option still carrying an unexpanded shell word, if present.
   *
   * The line is drawn at the subcommand, and drawn deliberately: everything
   * before it can change which tree git writes to, everything after it is
   * argument data. So `git -c user.name=$(whoami) commit` is unresolvable while
   * `git commit -m $(echo hi)` resolves — a reader that called every `$`
   * unresolvable would turn a computed commit message into an advisory, which
   * is a bypass wearing a reminder.
   *
   * The rule is knowingly conservative in one place: `-c key=$(...)` configures
   * and names no tree, yet it lands here. That errs toward saying "I cannot
   * tell", which is the direction this module is built to err in.
   */
  unexpandedGlobal: string | null;
  /** Every word between argv0 and the subcommand (the global options). */
  globals: string[];
  /** The subcommand, or null when the segment is not a git invocation at all. */
  subcommand: string | null;
  /** Every word after the subcommand. */
  args: string[];
}

/**
 * The directory a `-C` chain selects from `cwd`. CHAINED, the way git resolves
 * them: each `-C` starts from the directory the previous one selected, and the
 * first starts from the running cwd. `changeDirectory` is the same step a `cd`
 * takes, so an absolute argument wins outright, a relative one composes, and an
 * unexpanded word anywhere in the chain poisons the whole of it.
 */
function dashCTarget(cwd: RunningDirectory, dashCs: readonly string[]): RunningDirectory {
  let target = cwd;
  for (const value of dashCs) target = changeDirectory(target, value);
  return target;
}

/** The shape a commit arrived in: a `-C` wins, then a moved directory, else bare. */
function shapeOf(moved: boolean, dashCs: readonly string[] = []): Exclude<CommitCommandShape, "none"> {
  return dashCs.length > 0 ? "dash-c" : moved ? "cd-prefixed" : "bare";
}

/**
 * Read an argv as a git invocation: `git` with its global options skipped, and
 * the first non-option word as the subcommand. A command that merely MENTIONS a
 * commit (`git log --grep='git commit'`, `echo git commit`) never qualifies,
 * because its own first word is not `git` or its subcommand is not a commit.
 */
function parseGit(tokens: readonly string[]): GitInvocation | null {
  // An argv0 is git when its final path segment is exactly `git` (`/usr/bin/git`,
  // `./git`) — the shared reader's rule, asked of this module's own program.
  if (!argv0Is(tokens[0], "git")) return null;
  const dashCs: string[] = [];
  let repoOption: string | null = null;
  let unexpandedGlobal: string | null = null;
  const noteUnexpanded = (word: string | undefined): void => {
    if (word !== undefined && unexpandedGlobal === null && isUnexpanded(word)) {
      unexpandedGlobal = word;
    }
  };
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (!token.startsWith("-")) {
      return {
        dashCs,
        repoOption,
        unexpandedGlobal,
        globals: tokens.slice(1, i),
        subcommand: token,
        args: tokens.slice(i + 1),
      };
    }
    if (token === "-C" && i + 1 < tokens.length) {
      dashCs.push(tokens[i + 1] as string);
      i += 2;
      continue;
    }
    if (token.startsWith("-C") && token.length > 2) {
      dashCs.push(token.slice(2));
      i += 1;
      continue;
    }
    // Both spellings: `--git-dir=<v>` (one token) and `--git-dir <v>` (two).
    const equals = token.indexOf("=");
    const flag = equals > 0 ? token.slice(0, equals) : token;
    if (REPO_NAMING_OPTS.has(flag)) {
      repoOption = flag;
      i += equals > 0 ? 1 : 2;
      continue;
    }
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(token)) {
      noteUnexpanded(tokens[i + 1]);
      i += 2;
      continue;
    }
    noteUnexpanded(token);
    i += 1;
  }
  return { dashCs, repoOption, unexpandedGlobal, globals: tokens.slice(1), subcommand: null, args: [] };
}

// ---------------------------------------------------------------------------
// AC-STE-601.10 — git aliases, resolved before classifying.
// ---------------------------------------------------------------------------

/**
 * Alias lookup in a directory: the alias's value, `null` when no such alias is
 * defined, `undefined` when the configuration cannot be read at all.
 */
export type GitAliasLookup = (dir: string, name: string) => string | null | undefined;

/** `git config --get alias.NAME`, run in `dir`. Exit 1 = not defined; any other failure = unreadable. */
export function gitAliasOf(dir: string, name: string): string | null | undefined {
  const run = spawnSync("git", ["-C", dir, "config", "--get", `alias.${name}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  });
  if (run.error !== undefined) return undefined;
  if (run.status === 0) return run.stdout.replace(/\n$/, "");
  if (run.status === 1) return null;
  return undefined;
}

/** Alias expansions (plain and `!` shell aliases together) are followed at most this deep. */
export const MAX_ALIAS_DEPTH = MAX_NESTING;

/**
 * Words git runs as a command of its own, never as an alias: git consults an
 * alias only after its builtins and installed commands, so none of these needs
 * a `git config` lookup — which keeps the hooks fast on every ordinary commit.
 */
const GIT_COMMANDS: ReadonlySet<string> = new Set(
  (
    "add am annotate apply archimport archive backfill bisect blame branch bugreport bundle " +
    "cat-file check-attr check-ignore check-mailmap check-ref-format checkout checkout-index " +
    "cherry cherry-pick citool clean clone column commit commit-graph commit-tree config " +
    "count-objects credential credential-cache credential-store cvsexportcommit cvsimport " +
    "cvsserver daemon describe diagnose diff diff-files diff-index diff-pairs diff-tree " +
    "difftool fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg for-each-ref " +
    "for-each-repo format-patch fsck fsck-objects gc get-tar-commit-id grep gui hash-object help " +
    "history hook http-backend http-fetch http-push imap-send index-pack init init-db instaweb " +
    "interpret-trailers last-modified log ls-files ls-remote ls-tree mailinfo mailsplit " +
    "maintenance merge merge-base merge-file merge-index merge-octopus merge-one-file merge-ours " +
    "merge-recursive merge-resolve merge-subtree merge-tree mergetool mktag mktree " +
    "multi-pack-index mv name-rev notes p4 pack-objects pack-redundant pack-refs patch-id prune " +
    "prune-packed pull push quiltimport range-diff read-tree rebase receive-pack reflog refs " +
    "remote repack replace replay repo request-pull rerere reset restore rev-list rev-parse " +
    "revert rm send-email send-pack shell shortlog show show-branch show-index show-ref " +
    "sparse-checkout stage stash status stripspace submodule subtree switch symbolic-ref tag " +
    "unpack-file unpack-objects update-index update-ref update-server-info upload-archive " +
    "upload-pack var verify-commit verify-pack verify-tag version whatchanged worktree write-tree"
  ).split(" "),
);

/** Split a plain alias value into words the way git does: whitespace, quotes and backslashes. */
function splitAliasValue(value: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string;
    if (c === "\\" && i + 1 < value.length) {
      word += value[++i];
      started = true;
    } else if (quote !== null) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** The value `-c alias.NAME=VALUE` gives an alias on the command itself (last one wins). */
function commandLineAlias(globals: readonly string[], name: string): string | null {
  let value: string | null = null;
  for (let i = 0; i < globals.length; i++) {
    if (globals[i] !== "-c") continue;
    const setting = globals[i + 1] ?? "";
    const equals = setting.indexOf("=");
    const key = equals === -1 ? setting : setting.slice(0, equals);
    if (key.toLowerCase() === `alias.${name}`.toLowerCase()) value = equals === -1 ? "true" : setting.slice(equals + 1);
  }
  return value;
}

type AliasReading =
  | { kind: "git"; git: GitInvocation }
  | { kind: "shell"; command: string; dir: string }
  | { kind: "unreadable"; name: string }
  | { kind: "deep" };

/**
 * Expand the invocation's subcommand while it is an alias. A plain value
 * replaces the alias word; a `!` value is a shell command to be read from the
 * checkout's top level. `depth` counts every expansion already followed.
 */
function expandAlias(
  argv0: string,
  start: GitInvocation,
  cwd: RunningDirectory,
  roots: CheckoutRootResolver,
  aliases: GitAliasLookup,
  depth: number,
): { reading: AliasReading; depth: number } {
  let git = start;
  for (;;) {
    const name = git.subcommand;
    if (name === null || GIT_COMMANDS.has(name)) return { reading: { kind: "git", git }, depth };
    if (depth >= MAX_ALIAS_DEPTH) return { reading: { kind: "deep" }, depth };
    let value = commandLineAlias(git.globals, name);
    let dir: string | null = null;
    if (value === null || value.startsWith("!")) dir = dashCTarget(cwd, git.dashCs).dir;
    if (value === null) {
      if (dir === null || isUnexpanded(name) || git.repoOption !== null || git.unexpandedGlobal !== null) {
        return { reading: { kind: "unreadable", name }, depth };
      }
      if (!/^[A-Za-z0-9-]+$/.test(name)) return { reading: { kind: "git", git }, depth };
      const looked = aliases(dir, name);
      if (looked === undefined) return { reading: { kind: "unreadable", name }, depth };
      if (looked === null) return { reading: { kind: "git", git }, depth };
      value = looked;
    }
    depth += 1;
    if (value.startsWith("!")) {
      if (dir === null) return { reading: { kind: "unreadable", name }, depth };
      const quoted = git.args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`);
      return {
        reading: { kind: "shell", command: [value.slice(1), ...quoted].join(" "), dir: roots(dir) ?? dir },
        depth,
      };
    }
    const next = parseGit([argv0, ...git.globals, ...splitAliasValue(value), ...git.args]);
    if (next === null) return { reading: { kind: "git", git }, depth };
    git = next;
  }
}

// ---------------------------------------------------------------------------
// resolveCommitTarget.
// ---------------------------------------------------------------------------

const NO_COMMIT: CommitTarget = {
  isCommit: false,
  shape: "none",
  repoRoot: null,
  unresolved: null,
  repoRoots: [],
  unplaced: false,
  candidateRoots: [],
  subcommand: null,
  fromIndex: false,
  advisory: null,
};

/**
 * Resolve the repository a commit-bearing command writes to.
 *
 * @param command     The raw command line, as the hook payload carries it.
 * @param sessionCwd  The calling session's working directory.
 * @param roots       Directory → checkout root lookup (default: real filesystem).
 * @param aliases     Git alias lookup (default: `git config` in that directory).
 */
export function resolveCommitTarget(
  command: string,
  sessionCwd: string,
  roots: CheckoutRootResolver = checkoutRootOf,
  aliases: GitAliasLookup = gitAliasOf,
): CommitTarget {
  const { occurrences, advisory, candidates, balanced } = collectOccurrences(
    command,
    sessionCwd,
    roots,
    aliases,
    0,
  );
  return verdict(occurrences, advisory, candidates, balanced, roots);
}

interface Collected {
  occurrences: CommitOccurrence[];
  /** The first out-of-scope subcommand's notice (AC-STE-601.9). */
  advisory: string | null;
  /** Checkouts an unplaced commit could write to (AC-STE-601.7). */
  candidates: string[];
  balanced: boolean;
}

function collectOccurrences(
  command: string,
  sessionCwd: string,
  roots: CheckoutRootResolver,
  aliases: GitAliasLookup,
  depth: number,
): Collected {
  const occurrences: CommitOccurrence[] = [];
  let advisory: string | null = null;
  const candidates: string[] = [];
  // The shared recogniser does the reading — quotes, heredocs, substitutions,
  // subshell scopes, wrappers, reserved words, nested shells and the `cd` walk.
  const reading = readInvocations(command, sessionCwd, roots, COMMIT_READING);
  const { invocations } = reading;
  let balanced = reading.balanced;

  /** Offer the checkout holding a literal directory as a candidate root. */
  const offer = (dir: string | null): void => {
    const root = dir === null ? null : roots(dir);
    if (root !== null) candidates.push(root);
  };
  /** A commit whose subcommand could not be read, standing unplaced behind `word`. */
  const unreadCommit = (shape: CommitOccurrence["shape"], word: string): void => {
    occurrences.push({ shape, dir: null, word, subcommand: null, fromIndex: false });
  };

  for (const invocation of invocations) {
    const cwd: RunningDirectory = { dir: invocation.dir, word: invocation.unexpanded, moved: invocation.moved };
    if (invocation.nestingExceeded) {
      if (LITERAL_COMMIT.test(invocation.argv.slice(1).join(" "))) {
        unreadCommit(shapeOf(cwd.moved), `nesting deeper than ${MAX_NESTING}`);
      }
      continue;
    }
    const parsed = parseGit(invocation.argv);
    if (parsed === null) continue;

    // AC-STE-601.10 — an alias is resolved before the subcommand is classified.
    const expanded = expandAlias(invocation.argv[0] as string, parsed, cwd, roots, aliases, depth);
    const alias = expanded.reading;
    if (alias.kind === "unreadable" || alias.kind === "deep") {
      unreadCommit(
        shapeOf(cwd.moved, parsed.dashCs),
        alias.kind === "deep"
          ? `a git alias chain deeper than ${MAX_ALIAS_DEPTH}`
          : `the git alias \`${alias.name}\`, whose configuration cannot be read`,
      );
      continue;
    }
    let git = parsed;
    let writes: CommitWrite | null;
    if (alias.kind === "shell") {
      const nested = collectOccurrences(alias.command, alias.dir, roots, aliases, expanded.depth);
      balanced &&= nested.balanced;
      if (nested.occurrences.length === 0) {
        advisory ??= nested.advisory;
        continue;
      }
      const plain =
        invocation.unplaced === null &&
        !invocation.caseArm &&
        git.repoOption === null &&
        git.unexpandedGlobal === null &&
        repoBindingOf(invocation.assignments) === null;
      if (plain) {
        occurrences.push(...nested.occurrences);
        candidates.push(...nested.candidates);
        continue;
      }
      const first = nested.occurrences[0] as CommitOccurrence;
      writes = { subcommand: first.subcommand ?? "commit", fromIndex: first.fromIndex };
    } else {
      git = alias.git;
      writes = commitSubcommandOf(git.subcommand, git.args);
    }
    if (writes === null) {
      advisory ??= advisoryOf(git.subcommand, git.args);
      continue;
    }
    const commit = writes;
    const push = (o: Omit<CommitOccurrence, keyof CommitWrite>): void => {
      occurrences.push({ ...o, ...commit });
    };

    // AC-STE-601.7 — a wrapper that runs the commit many times, or somewhere
    // else, leaves it unplaced; every literal directory it could land in is a
    // candidate, and a word it cannot expand never is.
    if (invocation.unplaced !== null) {
      const { by, placeholders } = invocation.unplaced;
      const literal = (w: string): boolean => !isUnexpanded(w) && !placeholders.some((p) => w.includes(p));
      let current: string | null = invocation.dir;
      offer(current);
      for (const value of git.dashCs) {
        current = literal(value) ? resolvePath(current, value) : null;
        offer(current);
      }
      push({ shape: shapeOf(cwd.moved, git.dashCs), dir: null, word: `the \`${by}\` wrapper` });
      continue;
    }

    // AC-STE-601.4 — whether a `case` arm runs is a run-time pattern match, so
    // its commit is a commit with no place the command establishes.
    if (invocation.caseArm) {
      push({ shape: shapeOf(cwd.moved), dir: null, word: "a case arm" });
      continue;
    }

    // AC-STE-601.11 — a `GIT_DIR=`/`GIT_WORK_TREE=` binding (prefix, `env`
    // operand or in-command `export`) names a repository the directory walk
    // cannot follow, exactly as `--git-dir` does. Unplaced, with the literal
    // value's checkout offered as a candidate.
    const binding = repoBindingOf(invocation.assignments);
    if (binding !== null) {
      if (!isUnexpanded(binding.value)) offer(resolvePath(invocation.dir, binding.value));
      push({
        shape: shapeOf(cwd.moved, git.dashCs),
        dir: null,
        word: `the \`${binding.name}\` environment variable`,
      });
      continue;
    }

    // A repository named by `--git-dir`/`--work-tree` is a target this resolver
    // cannot place. Still a commit; just not one it may guess about.
    if (git.repoOption !== null) {
      push({ shape: shapeOf(cwd.moved), dir: null, word: `the \`${git.repoOption}\` option` });
      continue;
    }

    // A global option whose value the shell has not expanded yet could name any
    // tree at all. Naming the word is the honest answer; attributing the commit
    // to the session's checkout would be a confident answer about a repository
    // the command never named.
    if (git.unexpandedGlobal !== null) {
      push({ shape: shapeOf(cwd.moved, git.dashCs), dir: null, word: git.unexpandedGlobal });
      continue;
    }

    // Placed: in the directory a `-C` chain selects, or else the running one.
    const target = dashCTarget(cwd, git.dashCs);
    push({
      shape: shapeOf(cwd.moved, git.dashCs),
      dir: target.dir,
      word: target.dir === null ? target.word : null,
    });
  }

  return { occurrences, advisory, candidates, balanced };
}

function verdict(
  occurrences: readonly CommitOccurrence[],
  advisory: string | null,
  candidates: readonly string[],
  balanced: boolean,
  roots: CheckoutRootResolver,
): CommitTarget {
  if (occurrences.length === 0) return { ...NO_COMMIT, candidateRoots: [], advisory };

  const first = occurrences[0] as CommitOccurrence;
  /** The commit's answer: its checkout root, or what could not be determined (and where it might land). */
  const answer = (
    repoRoot: string | null,
    unresolved: string | null,
    candidateRoots: string[] = [],
    // STE-614 AC.9 — the resolved checkouts. Defaulted FROM `repoRoot` so every
    // existing answer carries the same fact twice rather than disagreeing with
    // itself; only the several-checkouts answer passes its own list.
    repoRoots: string[] = repoRoot === null ? [] : [repoRoot],
    // True only when the command never named a directory the reader could
    // resolve — see the `unplaced` field's own documentation.
    unplaced = false,
  ): CommitTarget => ({
    isCommit: true,
    shape: first.shape,
    repoRoot,
    unresolved,
    repoRoots,
    unplaced,
    candidateRoots,
    subcommand: first.subcommand,
    fromIndex: first.fromIndex,
    advisory: null,
  });

  // AC-STE-597.4 — unbalanced parentheses mean the EXTENT of a subshell is not
  // knowable, and therefore neither is the directory the commit runs in. The
  // parser may answer or it may decline; what it may never do is answer
  // confidently about a repository it has not established.
  if (!balanced) {
    return answer(
      null,
      "cannot resolve the commit's target repository from unbalanced " +
        "parentheses: the extent of the subshell, and so the directory the " +
        "commit runs in, is not determined by the command",
      [],
      [],
      true,
    );
  }

  // Anything the command names but cannot pin to a checkout root.
  const unnameable: string[] = [];
  const resolvedRoots: string[] = [];
  // STE-614 AC.9 — the two ways an answer is not a checkout root are different
  // facts. A word, a wrapper or an option the reader could not turn into a
  // DIRECTORY leaves the commit UNPLACED: it may land anywhere, so a guard has
  // something to warn about. A directory that resolved and simply holds no
  // checkout is a KNOWN answer — that commit lands nowhere and git itself will
  // say so — and there is no repository there for any rule to grade.
  let unplaced = false;
  for (const occurrence of occurrences) {
    if (occurrence.dir === null) {
      unnameable.push(occurrence.word ?? "the commit's target directory");
      unplaced = true;
      continue;
    }
    const root = roots(occurrence.dir);
    if (root === null) unnameable.push(occurrence.dir);
    else resolvedRoots.push(root);
  }

  if (unnameable.length > 0) {
    return answer(
      null,
      `cannot resolve the commit's target repository from ${unique(unnameable).join(", ")}`,
      unique(candidates),
      [],
      unplaced,
    );
  }

  const distinct = unique(resolvedRoots);
  if (distinct.length > 1) {
    // `repoRoot` stays null — there is no ONE repository to name — but the
    // checkouts are known, so a per-checkout rule grades all of them (STE-614
    // AC.9). Before this, several checkouts read as "unresolved" and a commit
    // into a second repository slipped past the first repository's evidence.
    return answer(
      null,
      `the command commits to more than one repository: ${distinct.join(", ")}`,
      [],
      distinct,
    );
  }

  return answer(distinct[0] as string, null);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// The hook front door.
// ---------------------------------------------------------------------------

/** The two hook-payload fields a commit guard needs: what ran, and from where. */
export interface CommitCommandPayload {
  /** The calling session's working directory, as the payload declares it. */
  cwd?: string;
  tool_input?: { command?: string };
}

/**
 * `resolveCommitTarget` fed from a Claude Code hook payload.
 *
 * Both pre-commit guards ask the same question of the same two fields, and a
 * disagreement between siblings about WHICH fields to read is the defect shape
 * STE-597 exists to close — one hook classifying against the session's tree
 * while the other classified against its own. Read them in one place and the
 * two hooks cannot drift apart in the reading.
 *
 * `process.cwd()` is the LAST resort, never the anchor: it applies only to a
 * payload that declares no directory at all, which leaves the hook with nothing
 * better than its own. Everywhere the payload does say, the payload wins.
 */
export function resolveCommitTargetFromPayload(
  payload: CommitCommandPayload,
  roots: CheckoutRootResolver = checkoutRootOf,
): CommitTarget {
  return resolveCommitTarget(
    payload.tool_input?.command ?? "",
    payload.cwd ?? process.cwd(),
    roots,
  );
}
