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
//   determined. Callers exit zero and emit an advisory on that leg.
//
// Pure with respect to the filesystem except `checkoutRootOf`: the resolver
// takes the checkout lookup as an argument so callers (and tests) can inject
// one, mirroring the injected-probe idiom the rest of `_shared` uses. The one
// other reader of ambient state is `resolveCommitTargetFromPayload`, which
// falls back to `process.cwd()` only when the payload declares no directory.

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
}

/** Directory → checkout root lookup. Returns null for "inside no checkout". */
export type CheckoutRootResolver = (dir: string) => string | null;

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

/** A directory that is known literally, or known only as an unexpanded word. */
interface Cwd {
  /** The literal directory, or null when it is an unexpanded shell word. */
  dir: string | null;
  /** The word that could not be expanded, when `dir` is null. */
  word: string | null;
  /** True once a `cd` has moved off the session directory. */
  moved: boolean;
}

interface CommitOccurrence {
  shape: Exclude<CommitCommandShape, "none">;
  /** The literal directory the commit writes in, when known. */
  dir: string | null;
  /** The unexpandable word standing in for that directory, when it is not. */
  word: string | null;
}

/**
 * One step the shell takes: run a segment, or open/close a subshell scope.
 *
 * A parenthesised subshell is the ordinary idiom for SCOPING a `cd`, and the
 * scope runs in both directions: `(cd /x && git commit)` commits in `/x`, while
 * `(cd /x) && git commit` commits wherever the session already was, because the
 * subshell exited before the commit ran. A splitter with no notion of `(` and
 * `)` cannot tell those apart — it drops the `cd` in the first (a confident
 * answer about the wrong repository) or carries it past the `)` in the second.
 * Modelling the boundary explicitly is what lets both be answered correctly.
 */
type CommandEvent =
  | { kind: "segment"; text: string }
  | { kind: "open" }
  | { kind: "close" };

interface CommandScan {
  events: CommandEvent[];
  /** False when the unquoted parentheses do not pair up. */
  balanced: boolean;
}

/** A heredoc redirection awaiting its body, which starts on the next line. */
interface PendingHeredoc {
  /** The terminator word, with any quotes around it already removed. */
  delimiter: string;
  /** True for `<<-`, where leading tabs are stripped before the line is compared. */
  stripTabs: boolean;
}

/** Characters that end an unquoted heredoc delimiter word. */
const DELIMITER_END = /[\s;&|()<>]/;

/**
 * Read the heredoc redirection starting at `command[at]` (`at` points at `<<`).
 *
 * Returns the parsed delimiter and the index just past it, or null when what
 * follows is not a heredoc at all — a here-STRING (`<<<`) or a `<<` with no
 * delimiter word behind it. Both are left to the caller as ordinary text.
 */
function readHeredocOperator(
  command: string,
  at: number,
): { heredoc: PendingHeredoc; end: number } | null {
  let i = at + 2;
  if (command[i] === "<") return null; // `<<<` is a here-string, not a heredoc.

  let stripTabs = false;
  if (command[i] === "-") {
    stripTabs = true;
    i += 1;
  }
  while (command[i] === " " || command[i] === "\t") i += 1;

  let delimiter = "";
  const opener = command[i];
  if (opener === "'" || opener === '"') {
    i += 1;
    while (i < command.length && command[i] !== opener) {
      delimiter += command[i] as string;
      i += 1;
    }
    if (command[i] !== opener) return null; // Unterminated quote: not a delimiter.
    i += 1;
  } else {
    while (i < command.length && !DELIMITER_END.test(command[i] as string)) {
      delimiter += command[i] as string;
      i += 1;
    }
  }
  if (delimiter.length === 0) return null;

  return { heredoc: { delimiter, stripTabs }, end: i };
}

/**
 * Skip the bodies of every heredoc opened on the line just ended.
 *
 * `from` is the index of the first character of the body. Each body runs to a
 * line that IS the delimiter — never one that merely contains it — and the
 * return value is the index where live command text resumes.
 *
 * Skipping to END OF INPUT instead would be a blanket amnesty: a real commit
 * written after the terminator would go unseen, which is the very bypass this
 * module exists to close. The delimiter line is therefore the stopping point,
 * and end-of-input is only the fallback for a heredoc nobody terminated.
 */
function skipHeredocBodies(
  command: string,
  from: number,
  heredocs: readonly PendingHeredoc[],
): number {
  let pos = from;
  for (const { delimiter, stripTabs } of heredocs) {
    while (pos < command.length) {
      const newline = command.indexOf("\n", pos);
      const raw = newline === -1 ? command.slice(pos) : command.slice(pos, newline);
      const line = stripTabs ? raw.replace(/^\t+/, "") : raw;
      pos = newline === -1 ? command.length : newline + 1;
      if (line === delimiter) break;
    }
  }
  return pos;
}

/**
 * Consume a `$(...)` command substitution starting at `at` (which points at the
 * `$`), returning the index just past its closing `)`, or null when what
 * follows the `$` is not a substitution at all.
 *
 * A substitution is part of the WORD it sits in, not a scope boundary: the
 * shell runs it and splices the output back into the surrounding token. Reading
 * its `(` as a subshell opener tears the word apart, and the tear cuts both
 * ways — `git -C $(pwd) commit` loses the link between `git` and `commit` so
 * both blocking gates exit 0 in silence, while `echo $(git commit)` gains a
 * segment reading `git commit)` that nobody wrote. Everything between the
 * parens is therefore consumed as literal text: nested parens, quotes and
 * operators inside the span all belong to the substitution's own syntax.
 *
 * An unterminated span consumes to end of input rather than reporting an
 * imbalance, because the thing that is unterminated is a word, not a scope.
 */
function readSubstitution(command: string, at: number): number | null {
  if (command[at + 1] !== "(") return null;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = at + 1; i < command.length; i += 1) {
    const ch = command[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return command.length;
}

/**
 * Split a command line into the steps a shell would take in sequence.
 *
 * QUOTE-AWARE, and that is the whole point: an operator — or a parenthesis —
 * inside a quoted word is data, not syntax. A regex split ignores quotes, so
 * `echo "x && git commit"` hands back `git commit"` as its own segment and the
 * guard refuses a command that commits nothing. Over-refusal is the mirror image
 * of the bypass this module exists to close, so the scanner tracks quoting the
 * way a shell does and only breaks on syntax that is actually unquoted.
 */
function scanCommand(command: string): CommandScan {
  const events: CommandEvent[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let balanced = true;
  /** Heredocs opened on the line being scanned; their bodies start after it. */
  let pending: PendingHeredoc[] = [];

  const flush = (): void => {
    const text = current.trim();
    if (text.length > 0) events.push({ kind: "segment", text });
    current = "";
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] as string;

    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    // Before any paren handling: a `$(` opens a WORD, not a scope. Swallowing
    // the whole span here is what keeps `git -C $(pwd) commit` in one segment.
    if (ch === "$") {
      const end = readSubstitution(command, i);
      if (end !== null) {
        current += command.slice(i, end);
        i = end - 1;
        continue;
      }
    }

    // A paren also TERMINATES the segment beside it, so `git commit)` is read as
    // a commit followed by a scope close rather than as a subcommand nobody
    // recognises.
    if (ch === "(") {
      flush();
      events.push({ kind: "open" });
      depth += 1;
      continue;
    }
    if (ch === ")") {
      flush();
      events.push({ kind: "close" });
      if (depth === 0) balanced = false;
      else depth -= 1;
      continue;
    }

    const next = command[i + 1];

    // A heredoc BODY is data being written to a file, not command text. The
    // operator is noted here and the body skipped at the newline, because the
    // rest of THIS line still runs (`cat <<EOF > out.md` redirects after it).
    if (ch === "<" && next === "<") {
      const opened = readHeredocOperator(command, i);
      if (opened !== null) {
        pending.push(opened.heredoc);
        i = opened.end - 1;
        continue;
      }
    }

    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      flush();
      i += 1;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      flush();
      if (ch === "\n" && pending.length > 0) {
        i = skipHeredocBodies(command, i + 1, pending) - 1;
        pending = [];
      }
      continue;
    }

    current += ch;
  }
  flush();
  if (depth !== 0) balanced = false;

  return { events, balanced };
}

/**
 * Whitespace tokenizer that keeps quoted runs together and strips the quotes.
 *
 * An unquoted `$(...)` is kept together too, quotes and all: the shell does not
 * split a word at a substitution's internal whitespace, so
 * `git -C $(git rev-parse --show-toplevel) commit` is four-plus tokens with the
 * whole span as ONE `-C` value — not a `-C $(git` whose next word reads as the
 * subcommand.
 */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "$") {
      const end = readSubstitution(segment, i);
      if (end !== null) {
        current += segment.slice(i, end);
        started = true;
        i = end - 1;
        continue;
      }
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/** True when a word still carries an unexpanded shell expansion. */
function isUnexpanded(word: string): boolean {
  return word.includes("$") || word.includes("`") || word.includes("~");
}

/**
 * The `commit` subcommand check: `git` with its global options skipped, and the
 * first non-option token equal to `commit`. A command that merely MENTIONS a
 * commit (`git log --grep='git commit'`, `echo git commit`) never qualifies,
 * because its own first token is not `git` or its subcommand is not `commit`.
 */
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
  /** The subcommand, or null when the segment is not a git invocation at all. */
  subcommand: string | null;
}

function parseGit(tokens: readonly string[]): GitInvocation | null {
  if (tokens.length === 0 || tokens[0] !== "git") return null;
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
      return { dashCs, repoOption, unexpandedGlobal, subcommand: token };
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
  return { dashCs, repoOption, unexpandedGlobal, subcommand: null };
}

/** Apply a `cd` segment to the running directory. */
function applyCd(cwd: Cwd, argument: string | undefined): Cwd {
  if (argument === undefined || argument === "-") {
    return { dir: null, word: argument ?? "cd", moved: true };
  }
  if (isUnexpanded(argument)) {
    return { dir: null, word: argument, moved: true };
  }
  const base = cwd.dir;
  const dir = isAbsolute(argument) ? argument : base === null ? null : resolve(base, argument);
  if (dir === null) return { dir: null, word: cwd.word ?? argument, moved: true };
  return { dir, word: null, moved: true };
}

// ---------------------------------------------------------------------------
// resolveCommitTarget.
// ---------------------------------------------------------------------------

const NO_COMMIT: CommitTarget = {
  isCommit: false,
  shape: "none",
  repoRoot: null,
  unresolved: null,
};

/**
 * Resolve the repository a commit-bearing command writes to.
 *
 * @param command     The raw command line, as the hook payload carries it.
 * @param sessionCwd  The calling session's working directory.
 * @param roots       Directory → checkout root lookup (default: real filesystem).
 */
export function resolveCommitTarget(
  command: string,
  sessionCwd: string,
  roots: CheckoutRootResolver = checkoutRootOf,
): CommitTarget {
  const occurrences: CommitOccurrence[] = [];
  const { events, balanced } = scanCommand(command);
  let cwd: Cwd = { dir: sessionCwd, word: null, moved: false };
  /** The directories the enclosing subshells will restore on their `)`. */
  const scopes: Cwd[] = [];

  for (const event of events) {
    if (event.kind === "open") {
      // A subshell INHERITS the current directory and hands it back on close.
      scopes.push(cwd);
      continue;
    }
    if (event.kind === "close") {
      const outer = scopes.pop();
      if (outer !== undefined) cwd = outer;
      continue;
    }

    const tokens = tokenize(event.text);
    if (tokens.length === 0) continue;

    if (tokens[0] === "cd") {
      cwd = applyCd(cwd, tokens[1]);
      continue;
    }

    const git = parseGit(tokens);
    if (git === null || git.subcommand !== "commit") continue;

    // A repository named by `--git-dir`/`--work-tree` is a target this resolver
    // cannot place. Still a commit; just not one it may guess about.
    if (git.repoOption !== null) {
      occurrences.push({
        shape: cwd.moved ? "cd-prefixed" : "bare",
        dir: null,
        word: `the \`${git.repoOption}\` option`,
      });
      continue;
    }

    // A global option whose value the shell has not expanded yet could name any
    // tree at all. Naming the word is the honest answer; attributing the commit
    // to the session's checkout would be a confident answer about a repository
    // the command never named.
    if (git.unexpandedGlobal !== null) {
      occurrences.push({
        shape: git.dashCs.length > 0 ? "dash-c" : cwd.moved ? "cd-prefixed" : "bare",
        dir: null,
        word: git.unexpandedGlobal,
      });
      continue;
    }

    if (git.dashCs.length > 0) {
      // CHAINED, the way git resolves them: each `-C` starts from the directory
      // the previous one selected, and the first starts from the running cwd.
      // `applyCd` is the same step a `cd` segment takes, so an absolute argument
      // wins outright, a relative one composes, and an unexpanded word anywhere
      // in the chain poisons the whole of it into "unresolvable".
      let target: Cwd = cwd;
      for (const value of git.dashCs) target = applyCd(target, value);
      occurrences.push({
        shape: "dash-c",
        dir: target.dir,
        word: target.dir === null ? target.word : null,
      });
      continue;
    }

    occurrences.push({
      shape: cwd.moved ? "cd-prefixed" : "bare",
      dir: cwd.dir,
      word: cwd.dir === null ? cwd.word : null,
    });
  }

  if (occurrences.length === 0) return NO_COMMIT;

  const shape = (occurrences[0] as CommitOccurrence).shape;

  // AC-STE-597.4 — unbalanced parentheses mean the EXTENT of a subshell is not
  // knowable, and therefore neither is the directory the commit runs in. The
  // parser may answer or it may decline; what it may never do is answer
  // confidently about a repository it has not established.
  if (!balanced) {
    return {
      isCommit: true,
      shape,
      repoRoot: null,
      unresolved:
        "cannot resolve the commit's target repository from unbalanced " +
        "parentheses: the extent of the subshell, and so the directory the " +
        "commit runs in, is not determined by the command",
    };
  }

  // Anything the command names but cannot pin to a checkout root.
  const unnameable: string[] = [];
  const resolvedRoots: string[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.dir === null) {
      unnameable.push(occurrence.word ?? "the commit's target directory");
      continue;
    }
    const root = roots(occurrence.dir);
    if (root === null) unnameable.push(occurrence.dir);
    else resolvedRoots.push(root);
  }

  if (unnameable.length > 0) {
    return {
      isCommit: true,
      shape,
      repoRoot: null,
      unresolved: `cannot resolve the commit's target repository from ${unique(unnameable).join(", ")}`,
    };
  }

  const distinct = unique(resolvedRoots);
  if (distinct.length > 1) {
    return {
      isCommit: true,
      shape,
      repoRoot: null,
      unresolved: `the command commits to more than one repository: ${distinct.join(", ")}`,
    };
  }

  return {
    isCommit: true,
    shape,
    repoRoot: distinct[0] as string,
    unresolved: null,
  };
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
