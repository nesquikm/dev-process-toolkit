// pr_target_repo — resolve the repository a PULL REQUEST is opened from (STE-615).
//
// The sibling of `commit_target_repo.ts`, asking the other half of the same
// question. That module answers "which checkout does this command WRITE a
// commit to?"; this one answers "which repository does this command OPEN A
// REQUEST into?" — and, unlike a commit, a request can name a repository the
// local checkout is not: `gh pr create --repo other/repo` runs here and lands
// there. That is why this module carries a field `CommitTarget` has no
// analogue for (`foreign`), and why it asks the gh grammar rather than git's.
//
// AC-STE-615.1 — PR CREATION IS RECOGNISED, in every shape the shell can carry
//   it: behind a `cd`, a subshell, a `&&` chain, a newline, a prefix
//   assignment, `env`, `command`, a nested shell, a command substitution — and
//   under both spellings gh accepts (`pr create`, `pr new`). Everything that
//   merely READS a request (`list`, `view`, `merge`), that opens one through a
//   different door (`gh api …/pulls`, `hub pull-request`, GitLab's push
//   option), that is only a script FILE or an opaque `"$X"`, or that asks for
//   help, is out of scope — each refused by the grammar, never by a regex.
//
// AC-STE-615.2 — THE TARGET is the checkout root of the directory the
//   invocation runs in, and, when the command NAMES a repository slug (`-R` /
//   `--repo`, else `GH_REPO` bound on the command, else `GH_REPO` in the hook
//   process's own environment), that slug must match a remote of that checkout.
//   A slug no remote matches — or one that is not a repository slug at all — is
//   KNOWN-FOREIGN. A slug the shell has not expanded, a `git remote` that
//   cannot be run, and a directory that cannot be expanded are UNRESOLVED. The
//   two verdicts are kept apart because their callers end differently; see the
//   `foreign` field below.
//
// Built on the SHARED recogniser: `shell_invocations.ts` owns the shell
// grammar, this module owns only the gh question asked over the invocation
// stream it produces. A second parser here would be the drift STE-601 closed.
//
// Pure with respect to the filesystem except the injected `roots` lookup, which
// defaults to `checkoutRootOf` — the sibling's walk, imported rather than
// rewritten, so the two modules cannot disagree about where a checkout begins.

import { spawnSync } from "node:child_process";

import {
  argv0Is,
  FULL_READING,
  isUnexpanded,
  MAX_NESTING,
  readInvocations,
  type CheckoutRootLookup,
  type ReadingRules,
} from "./shell_invocations";

import { checkoutRootOf } from "./commit_target_repo";

/**
 * The reading the PR question is asked under: the whole grammar, exactly as the
 * commit question asks it. A request created behind `env`, inside `bash -lc` or
 * spliced out of `url=$(gh pr create --fill)` is the same request; a reading
 * that saw fewer of those shapes would refuse the careful path and permit the
 * careless one, which is the defect shape this file inherits its caution from.
 */
const PR_READING: ReadingRules = FULL_READING;

/**
 * A literal PR creation inside a nested string the reader declined to open
 * because it sat deeper than `MAX_NESTING`. The string was not parsed, so this
 * only asks whether it SPELLS a creation — enough to refuse a silent
 * `isPr: false`, never enough to place it.
 */
const LITERAL_PR = /\bgh\b[\s\S]*\bpr\b[\s\S]*\b(?:create|new)\b/;

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

/** The resolved (or explicitly unresolved) target of a request-creating command. */
export interface PrTarget {
  /** True when the command creates a pull request, in any recognised shape. */
  isPr: boolean;
  /** The checkout the request is opened from, or null. */
  repoRoot: string | null;
  /** Every checkout the command was RESOLVED to open a request from. */
  repoRoots: string[];
  /** Non-null exactly when the target could not be determined. */
  unresolved: string | null;
  /** True when the command named no directory the reader could resolve. */
  unplaced: boolean;
  /** Checkouts an unplaced request could be opened from. */
  candidateRoots: string[];
  /**
   * THE ONE FIELD `CommitTarget` HAS NO ANALOGUE FOR. Non-null when the command
   * names a repository slug that NO remote of the local checkout matches: a
   * known-foreign target. It carries the slug verbatim, so the hook's refusal
   * can name it.
   *
   * It is a field of its own rather than a flavour of `unresolved` because the
   * two legs end differently: a known-foreign target is REFUSED even when the
   * evidence is there (evidence in one checkout cannot vouch for a request into
   * another repository), while an unresolved one is only REMINDED about once
   * the evidence holds. One field cannot carry both verdicts, and a hook that
   * guessed would get one of them wrong in silence.
   */
  foreign: string | null;
}

/** Directory → checkout root lookup. Returns null for "inside no checkout". */
export type CheckoutRootResolver = CheckoutRootLookup;

// ---------------------------------------------------------------------------
// The remote listing — the only spawn this module makes.
// ---------------------------------------------------------------------------

/**
 * Checkout root → its remote URLs, or `null` when the listing COULD NOT BE RUN.
 *
 * Null is a third answer, not an empty list: a checkout with no remotes answers
 * `[]` and that answer is knowledge (nothing there can vouch for the slug, so
 * the target is foreign), while a listing that never ran is ignorance (the
 * target is unresolved). Collapsing the two would turn a broken spawn into a
 * confident refusal.
 */
export type RemoteLookup = (root: string) => string[] | null;

/**
 * `git remote -v`, run IN the resolved checkout — not in the hook process's own
 * directory, which is the one place that has nothing to do with where the
 * request is opened from.
 *
 * The spawn-and-report shape the /tdd hook uses: a spawn that cannot run is
 * REPORTED as `null`, never thrown. An uncaught spawn here would surface as a
 * raw stack trace inside a PreToolUse hook, which reads to the operator as an
 * unexplained interruption rather than as the reminder it actually is.
 */
export function gitRemotesOf(root: string): string[] | null {
  let run: ReturnType<typeof spawnSync<string>>;
  try {
    run = spawnSync("git", ["-C", root, "remote", "-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      // Passed rather than left to default: under Bun an omitted `env` resolves
      // `git` against the PATH the process STARTED with, so a PATH the hook
      // changed would be honoured for the lookup's own settings and ignored for
      // finding the binary — two different environments in one spawn.
      env: process.env,
    });
  } catch {
    return null;
  }
  // `error` is git missing from PATH or the spawn refused; a non-zero exit is
  // git having run and disagreed. Neither one lists remotes, so neither may be
  // read as "this checkout has none".
  if (run.error !== undefined || run.status !== 0) return null;
  // `origin\tgit@github.com:org/fe.git (fetch)` — the URL is the second field.
  return run.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1] ?? "")
    .filter((url) => url !== "");
}

// ---------------------------------------------------------------------------
// Slug ↔ remote matching.
// ---------------------------------------------------------------------------

/** A repository named by a slug or a remote URL, reduced to what can be compared. */
interface RepoRef {
  /** The forge host, lower-cased, or null when the reference names none. */
  host: string | null;
  /** `owner/repo`, lower-cased, with any `.git` suffix removed. */
  ownerRepo: string;
}

/** An explicit port on an authority (`github.com:22`), which names no repository. */
const PORT_SUFFIX = /:\d+$/;

/**
 * A remote URL as a `RepoRef`, or null when it names no `owner/repo` at all.
 *
 * Both forms git writes have to be read, because the same slug has to match
 * either: `https://github.com/org/be` (scheme, so the host ends at the first
 * `/`) and `git@github.com:org/fe.git` (scp-like, so the host ends at the first
 * `:` — and only when that colon comes before any `/`, or `/srv/git:mirror`
 * would read its directory as a host).
 */
function parseRemoteUrl(url: string): RepoRef | null {
  let rest = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  let host: string | null = null;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(rest);
  if (scheme !== null) {
    rest = rest.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    host = rest.slice(0, slash);
    rest = rest.slice(slash + 1);
  } else {
    const colon = rest.indexOf(":");
    const slash = rest.indexOf("/");
    if (colon !== -1 && (slash === -1 || colon < slash)) {
      host = rest.slice(0, colon);
      rest = rest.slice(colon + 1);
    }
  }
  if (host !== null) {
    // Credentials and a port are transport detail; the repository is the same one.
    const at = host.indexOf("@");
    host = host.slice(at + 1).replace(PORT_SUFFIX, "");
  }
  const segments = rest.split("/").filter((s) => s !== "");
  if (segments.length < 2) return null;
  return {
    host: host === null ? null : host.toLowerCase(),
    ownerRepo: segments.slice(-2).join("/").toLowerCase(),
  };
}

/**
 * A `-R`/`--repo`/`GH_REPO` slug as a `RepoRef`, or null when it is not a slug.
 *
 * gh accepts exactly `OWNER/REPO` and `HOST/OWNER/REPO`. Anything else (`fe`, a
 * four-segment path) names no repository this resolver can check, and null is
 * what makes the caller refuse it by name instead of quietly resolving to the
 * local checkout — which would be the bypass the gate exists to close.
 */
function parseSlug(slug: string): RepoRef | null {
  const segments = slug.trim().replace(/\.git$/i, "").split("/").filter((s) => s !== "");
  if (segments.length === 2) return { host: null, ownerRepo: segments.join("/").toLowerCase() };
  if (segments.length === 3) {
    return {
      host: (segments[0] as string).toLowerCase(),
      ownerRepo: segments.slice(1).join("/").toLowerCase(),
    };
  }
  return null;
}

/**
 * True when `url` is a remote of the repository `wanted` names.
 *
 * A slug that names no host matches on `owner/repo` alone, because that is all
 * the operator said; a slug that DOES name one must agree with the remote's,
 * since `github.com/org/fe` and an enterprise host's `org/fe` are two
 * repositories and only one of them is here.
 */
function remoteMatches(url: string, wanted: RepoRef): boolean {
  const remote = parseRemoteUrl(url);
  if (remote === null || remote.ownerRepo !== wanted.ownerRepo) return false;
  return wanted.host === null || remote.host === wanted.host;
}

// ---------------------------------------------------------------------------
// The gh grammar.
// ---------------------------------------------------------------------------

/**
 * gh's own options that NAME A REPOSITORY, in both spellings. They may stand
 * before the command words (`gh -R o/r pr create`) or after them
 * (`gh pr create --repo=o/r`), because cobra parses flags wherever they fall —
 * so this reader may not assume a position either.
 */
const REPO_OPTS: ReadonlySet<string> = new Set(["-R", "--repo"]);

/** The options that make gh PRINT HELP and run nothing at all. */
const HELP_OPTS: ReadonlySet<string> = new Set(["-h", "--help"]);

/** A gh command line, read as its option-free words plus the facts its flags carry. */
interface GhInvocation {
  /** The non-option words, in order: `["pr", "create"]` for a bare creation. */
  words: string[];
  /** The repository slug `-R` / `--repo` named, when one was given. */
  repoSlug: string | null;
  /** True when a help option stands anywhere in the argv. */
  help: boolean;
}

/**
 * Read an argv as a gh invocation, or null when its argv0 is not gh.
 *
 * Options are read LENIENTLY — an unknown `-word` takes no value — with the
 * repository options the one exception, because their value must be consumed
 * or it reads as a command word: `gh -R o/r pr create` would otherwise offer
 * `o/r` as the subcommand and the creation would go unseen. Every other flag's
 * value is argument data, and a stray one landing in `words` cannot turn a
 * non-creation into a creation, because only the FIRST TWO words decide.
 */
function parseGh(tokens: readonly string[]): GhInvocation | null {
  // An argv0 is gh when its final path segment is exactly `gh`
  // (`/opt/homebrew/bin/gh`) — the shared reader's rule, asked of this module's
  // own program, so the two resolvers cannot disagree about what an invocation is.
  if (!argv0Is(tokens[0], "gh")) return null;
  const words: string[] = [];
  let repoSlug: string | null = null;
  let help = false;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (!token.startsWith("-") || token === "-") {
      words.push(token);
      continue;
    }
    if (HELP_OPTS.has(token)) {
      help = true;
      continue;
    }
    // Both spellings, and both ways of attaching the value: `--repo o/r`,
    // `--repo=o/r`, `-R o/r`, `-Ro/r`.
    const equals = token.indexOf("=");
    const flag = equals > 0 ? token.slice(0, equals) : token;
    if (REPO_OPTS.has(flag)) {
      if (equals > 0) repoSlug = token.slice(equals + 1);
      else {
        repoSlug = tokens[i + 1] ?? null;
        i += 1;
      }
      continue;
    }
    if (token.startsWith("-R") && token.length > 2 && !token.startsWith("--")) {
      repoSlug = token.slice(2);
      continue;
    }
  }
  return { words, repoSlug, help };
}

/**
 * True when this gh invocation CREATES a pull request.
 *
 * `pr new` is gh's own alias for `pr create`, so both spellings open a request
 * and both are in scope. `--dry-run` stays in scope deliberately: it is one
 * character away from the real thing, and a gate that waved it through would
 * teach the shape that bypasses the gate.
 */
function createsPullRequest(gh: GhInvocation): boolean {
  if (gh.help) return false;
  return gh.words[0] === "pr" && (gh.words[1] === "create" || gh.words[1] === "new");
}

// ---------------------------------------------------------------------------
// resolvePrTarget.
// ---------------------------------------------------------------------------

/** The environment variable gh reads when no `-R`/`--repo` is given. */
const GH_REPO_ENV = "GH_REPO";

/**
 * The last `GH_REPO=` binding the command runs under, or null.
 *
 * `invocation.assignments` already carries all three ways a command can be
 * bound — a prefix assignment, an `env` operand, an in-command `export` — so
 * this reads one list rather than three, and cannot recognise the shapes
 * inconsistently the way three readers would. Last one wins, as the shell does.
 */
function boundGhRepo(assignments: readonly string[]): string | null {
  let found: string | null = null;
  for (const assignment of assignments) {
    const equals = assignment.indexOf("=");
    if (equals > 0 && assignment.slice(0, equals) === GH_REPO_ENV) {
      found = assignment.slice(equals + 1);
    }
  }
  return found;
}

/**
 * The repository slug this invocation names, in gh's own order of precedence:
 * the `-R`/`--repo` option, else a `GH_REPO` bound on the command, else
 * `GH_REPO` in the hook process's own environment — which the hook inherits
 * from the very session that is about to run the command, so it is a target the
 * operator named just as surely as the flag is.
 */
function repoSlugOf(gh: GhInvocation, assignments: readonly string[]): string | null {
  if (gh.repoSlug !== null) return gh.repoSlug;
  const bound = boundGhRepo(assignments);
  if (bound !== null) return bound;
  // An empty value is how a variable is unset in practice, and gh ignores it.
  return process.env[GH_REPO_ENV] === undefined || process.env[GH_REPO_ENV] === ""
    ? null
    : (process.env[GH_REPO_ENV] as string);
}

/** One recognised request creation, and the directory it runs in. */
interface PrOccurrence {
  /** The literal directory the request is opened from, when known. */
  dir: string | null;
  /** The unexpandable word standing in for that directory, when it is not. */
  word: string | null;
  /** The repository slug the invocation names, when it names one. */
  slug: string | null;
}

const NO_PR: PrTarget = {
  isPr: false,
  repoRoot: null,
  repoRoots: [],
  unresolved: null,
  unplaced: false,
  candidateRoots: [],
  foreign: null,
};

/**
 * Resolve the repository a request-creating command opens a request from.
 *
 * @param command     The raw command line, as the hook payload carries it.
 * @param sessionCwd  The calling session's working directory.
 * @param roots       Directory → checkout root lookup (default: real filesystem).
 * @param remotes     Checkout root → remote URLs (default: `git remote -v`).
 */
export function resolvePrTarget(
  command: string,
  sessionCwd: string,
  roots: CheckoutRootResolver = checkoutRootOf,
  remotes: RemoteLookup = gitRemotesOf,
): PrTarget {
  const { invocations, balanced } = readInvocations(command, sessionCwd, roots, PR_READING);
  const occurrences: PrOccurrence[] = [];

  for (const invocation of invocations) {
    // A nested string too deep to open was never parsed. It may still SPELL a
    // creation, and answering `isPr: false` about text nobody read is the
    // silent permission this module exists to refuse.
    if (invocation.nestingExceeded) {
      if (LITERAL_PR.test(invocation.argv.slice(1).join(" "))) {
        occurrences.push({ dir: null, word: `nesting deeper than ${MAX_NESTING}`, slug: null });
      }
      continue;
    }
    const gh = parseGh(invocation.argv);
    if (gh === null || !createsPullRequest(gh)) continue;
    occurrences.push({
      dir: invocation.dir,
      word: invocation.dir === null ? invocation.unexpanded : null,
      slug: repoSlugOf(gh, invocation.assignments),
    });
  }

  return verdict(occurrences, balanced, roots, remotes);
}

function verdict(
  occurrences: readonly PrOccurrence[],
  balanced: boolean,
  roots: CheckoutRootResolver,
  remotes: RemoteLookup,
): PrTarget {
  if (occurrences.length === 0) return { ...NO_PR };

  /** A recognised request whose target could not be pinned to a checkout. */
  const undetermined = (unresolved: string): PrTarget => ({
    ...NO_PR,
    isPr: true,
    unresolved,
    unplaced: true,
  });

  // Unbalanced parentheses mean the EXTENT of a subshell is not knowable, and
  // therefore neither is the directory the request is opened from.
  if (!balanced) {
    return undetermined(
      "cannot resolve the request's target repository from unbalanced parentheses: " +
        "the extent of the subshell, and so the directory the request runs in, is " +
        "not determined by the command",
    );
  }

  const unnameable: string[] = [];
  const resolvedRoots: string[] = [];
  /** The first known-foreign slug, with the local checkout the refusal must name. */
  let foreign: { slug: string; root: string } | null = null;
  for (const occurrence of occurrences) {
    if (occurrence.dir === null) {
      unnameable.push(occurrence.word ?? "the request's target directory");
      continue;
    }
    const root = roots(occurrence.dir);
    if (root === null) {
      unnameable.push(occurrence.dir);
      continue;
    }
    // No slug: the request goes to the checkout it is opened from, and there is
    // nothing to match against.
    if (occurrence.slug === null) {
      resolvedRoots.push(root);
      continue;
    }
    // A slug the shell has not expanded could name ANY repository, including
    // this one. Saying which would be a guess; naming the word is the answer.
    if (isUnexpanded(occurrence.slug)) {
      unnameable.push(`\`${occurrence.slug}\``);
      continue;
    }
    const wanted = parseSlug(occurrence.slug);
    if (wanted === null) {
      // Not a repository slug at all. gh would reject it, and so must this: a
      // resolver that fell back to the local checkout would let an unreadable
      // slug inherit the local checkout's evidence.
      foreign ??= { slug: occurrence.slug, root };
      continue;
    }
    const urls = remotes(root);
    if (urls === null) {
      // The listing never ran, so "no remote matches" was never established.
      unnameable.push(`\`git remote -v\` in ${root}`);
      continue;
    }
    if (urls.some((url) => remoteMatches(url, wanted))) resolvedRoots.push(root);
    else foreign ??= { slug: occurrence.slug, root };
  }

  // Foreign outranks unresolved, because the two end differently and only one
  // of them is safe to get wrong: refusing a request whose target is KNOWN to
  // be another repository costs an operator one explicit re-run, while
  // reminding about it would open it on evidence that cannot vouch for it.
  if (foreign !== null) {
    return { ...NO_PR, isPr: true, foreign: foreign.slug, candidateRoots: [foreign.root] };
  }

  if (unnameable.length > 0) {
    return undetermined(
      `cannot resolve the request's target repository from ${unique(unnameable).join(", ")}`,
    );
  }

  const distinct = unique(resolvedRoots);
  return {
    ...NO_PR,
    isPr: true,
    repoRoot: distinct.length === 1 ? (distinct[0] as string) : null,
    repoRoots: distinct,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// ---------------------------------------------------------------------------
// The hook front door.
// ---------------------------------------------------------------------------

/** The two hook-payload fields a PR guard needs: what ran, and from where. */
export interface PrCommandPayload {
  /** The calling session's working directory, as the payload declares it. */
  cwd?: string;
  tool_input?: { command?: string };
}

/**
 * `resolvePrTarget` fed from a Claude Code hook payload.
 *
 * The same two fields `resolveCommitTargetFromPayload` reads, read the same
 * way and for the same reason: `process.cwd()` is the LAST resort, never the
 * anchor — it applies only to a payload that declares no directory at all.
 * Everywhere the payload does say, the payload wins.
 */
export function resolvePrTargetFromPayload(
  payload: PrCommandPayload,
  roots: CheckoutRootResolver = checkoutRootOf,
  remotes: RemoteLookup = gitRemotesOf,
): PrTarget {
  return resolvePrTarget(
    payload.tool_input?.command ?? "",
    payload.cwd ?? process.cwd(),
    roots,
    remotes,
  );
}
