// shell_invocations — the shared shell-command recogniser (STE-601).
//
// Given a command line, a session directory and a checkout-root lookup, return
// every SIMPLE COMMAND the shell would run, in the order it would run them,
// each with its argv (quotes removed, wrappers stripped), the directory it runs
// in, and the wrapper chain that carried it.
//
// This module owns the GRAMMAR — quotes, heredocs, substitutions, subshell
// scopes, wrappers, reserved words, nested shells — so that every hook that asks
// "what does this command run?" reads it through one parser instead of growing
// its own. `commit_target_repo.ts` keeps only the commit question, asked over
// the invocation stream this module produces.
//
// Extension points are data plus small functions: `WRAPPERS` (prefix words and
// their options), `RESERVED_WORDS`, `NESTED_SHELLS`, `SHELL_BUILTINS` (the
// builtins that change the shell's own `ShellFrame` — its directory and its
// exports), and the `ReadingRules` switches a caller reads the stream under.

import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Public vocabulary.
// ---------------------------------------------------------------------------

/** One simple command the shell would run. */
export interface ShellInvocation {
  /** The words, after quote removal and wrapper stripping. */
  argv: string[];
  /** The literal directory the command runs in, or null when it is not literal. */
  dir: string | null;
  /** The unexpanded word that made `dir` null (STE-597 rules); null otherwise. */
  unexpanded: string | null;
  /** The wrapper chain, outermost first (e.g. `["env", "time", "command"]`). */
  wrappers: string[];
  /** True once a `cd` (or `env -C`) has moved off the session directory. */
  moved: boolean;
  /** Leading `NAME=value` bindings (and `env` operands) the command runs under. */
  assignments: string[];
  /** True when a nested string was NOT read because nesting exceeded the bound. */
  nestingExceeded: boolean;
  /**
   * True when the command sits inside a `case` arm. Whether an arm runs depends
   * on a pattern match the shell performs at run time, so a caller may not
   * treat such a command as placed.
   */
  caseArm: boolean;
  /**
   * Set when the command runs through a wrapper whose count or directory the
   * recogniser cannot model (`xargs`, `find -exec`, `parallel`, `watch`,
   * `sudo`, `env -S`): the outermost such wrapper, and the words it substitutes
   * at run time (`{}`), which are never a directory anyone can name.
   */
  unplaced: UnplacedWrapper | null;
}

/** An unplaced wrapper and the placeholder words it substitutes at run time. */
export interface UnplacedWrapper {
  by: string;
  placeholders: string[];
}

/** Directory → checkout root lookup. Returns null for "inside no checkout". */
export type CheckoutRootLookup = (dir: string) => string | null;

/**
 * Which parts of the grammar a reading applies.
 *
 * The switches exist so a caller can adopt the grammar one row at a time while
 * its own pins stay exact: each switch is a decision a later change flips, not
 * a second parser.
 */
export interface ReadingRules {
  /** Strip prefix wrappers (`env`, `command`, `time`, …) and leading assignments. */
  wrappers: boolean;
  /** Strip leading reserved words (`{`, `if`, `do`, …), `function NAME` and `for` headers. */
  reservedWords: boolean;
  /** Read `sh -c STRING` / `eval STRING` recursively. */
  nestedShells: boolean;
  /** Emit the commands inside `$(...)` substitutions. */
  substitutions: boolean;
}

/** Every rule on: the recogniser as `shellInvocations` exposes it. */
export const FULL_READING: ReadingRules = {
  wrappers: true,
  reservedWords: true,
  nestedShells: true,
  substitutions: true,
};

/** Nested shells, `eval` and substitutions are read at most this deep. */
export const MAX_NESTING = 8;

// ---------------------------------------------------------------------------
// The running directory.
// ---------------------------------------------------------------------------

/** A directory that is known literally, or known only as an unexpanded word. */
export interface RunningDirectory {
  /** The literal directory, or null when it is an unexpanded shell word. */
  dir: string | null;
  /** The word that could not be expanded, when `dir` is null. */
  word: string | null;
  /** True once a `cd` has moved off the session directory. */
  moved: boolean;
}

/** True when a word still carries an unexpanded shell expansion. */
export function isUnexpanded(word: string): boolean {
  return word.includes("$") || word.includes("`") || word.includes("~");
}

/**
 * True when an argv0 names the program `name`: its final path segment is
 * exactly that word, so `/usr/bin/git`, `./git` and a bare `git` all qualify
 * while `gitk` and `mygit` do not.
 *
 * One rule, asked in one place, because every resolver over this reader asks it
 * of its own program — the commit question of `git`, the request question of
 * `gh` — and this module's own `-C` expansion asks it too. Three copies of the
 * test is three chances for the siblings to disagree about what counts as an
 * invocation, which is the drift the shared recogniser exists to prevent.
 *
 * Quote removal has already run by the time an argv0 reaches here, so `\git`
 * and `"git"` are both the word `git`.
 */
export function argv0Is(word: string | undefined, name: string): boolean {
  if (word === undefined) return false;
  return word.slice(word.lastIndexOf("/") + 1) === name;
}

/**
 * A literal path read against a base directory: an absolute path stands alone,
 * a relative one needs a literal base and is null without one.
 */
export function resolvePath(base: string | null, path: string): string | null {
  return isAbsolute(path) ? path : base === null ? null : resolve(base, path);
}

/**
 * Expand a leading `~` / `~/…` to the hook process's home, which runs as the
 * same OS user as the session's shell. Read at call time so a test that sets
 * HOME is honoured. `~user` is left as is (unexpanded).
 */
export function expandHome(word: string): string {
  if (word !== "~" && !word.startsWith("~/")) return word;
  const home = process.env.HOME || homedir();
  return home + word.slice(1);
}

/** An unresolvable running directory naming the word that made it so. */
function unresolvable(word: string): RunningDirectory {
  return { dir: null, word, moved: true };
}

/**
 * Apply a `cd` (or one `-C` step) to the running directory. Home expansion
 * lives HERE, not in `expandDirectory`, because this is the one step every
 * directory word ends in — including the raw `-C` chain `commit_target_repo`
 * replays from an invocation's argv.
 */
export function changeDirectory(cwd: RunningDirectory, raw: string | undefined): RunningDirectory {
  if (raw === undefined || raw === "-") return unresolvable(raw ?? "cd");
  const argument = expandHome(raw);
  if (isUnexpanded(argument)) return unresolvable(argument);
  const dir = resolvePath(cwd.dir, argument);
  if (dir === null) return { dir: null, word: cwd.word ?? argument, moved: true };
  return { dir, word: null, moved: true };
}

/** `cd`'s own options (`-L`, `-P`, `-e`, `-@`), alone or combined (`-Pe`). */
const CD_OPTION = /^-[LPe@]+$/;

/**
 * The operand of a `cd` / `pushd` argv: its options are skipped and `--` ends
 * them. Undefined when there is none (a bare `cd`).
 */
function directoryOperand(argv: readonly string[]): string | undefined {
  let i = 1;
  while (i < argv.length && CD_OPTION.test(argv[i] as string)) i++;
  if (argv[i] === "--") i++;
  return argv[i];
}

/**
 * Apply a `cd` / `pushd` argv. With `CDPATH` set and non-empty in the
 * resolver's environment, a relative operand not beginning with `.` or `..` is
 * searched along it first, so its directory cannot be named.
 */
function changeDirectoryBuiltin(cwd: RunningDirectory, argv: readonly string[]): RunningDirectory {
  const operand = directoryOperand(argv);
  const cdpath = process.env.CDPATH;
  if (
    operand !== undefined &&
    operand !== "-" &&
    cdpath !== undefined &&
    cdpath !== "" &&
    !isUnexpanded(operand) &&
    !isAbsolute(operand) &&
    !/^\.\.?(\/|$)/.test(operand)
  ) {
    return unresolvable("the `CDPATH` search path");
  }
  return changeDirectory(cwd, operand);
}

/** A `NAME=value` binding (a command prefix, an `env` operand, an `export` operand). */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The state a simple command can change in the shell that runs it. A subshell
 * scope saves the whole frame on `(` and restores it on `)`; a brace group
 * saves nothing. New shell state (a `pushd` stack, in-command variables) is a
 * new field here plus a row in `SHELL_BUILTINS`.
 */
export interface ShellFrame {
  /** The directory the next command runs in. */
  cwd: RunningDirectory;
  /**
   * `NAME=value` bindings an in-command `export` put in the environment: every
   * later command in this shell runs under them (`export GIT_DIR=x; git commit`).
   */
  exported: readonly string[];
  /**
   * The modelled `pushd` directory stack BELOW the running directory, top last.
   * `popd` returns to its top; a subshell restores it with the rest of the frame.
   */
  stack: readonly RunningDirectory[];
  /**
   * In-command shell variables (STE-613 item 5): NAME → its literal value, or
   * null when it is bound to something the resolver cannot expand (a
   * substitution, a loop variable, an unbound name). A name absent from the
   * map is unbound. `exported` marks the names a child shell inherits.
   */
  vars: ReadonlyMap<string, ShellVariable>;
}

/** One in-command variable binding. */
export interface ShellVariable {
  value: string | null;
  exported: boolean;
}

/** No word of the reading carries a quoted `$`: every reference may expand. */
const NO_LITERALS: ReadonlySet<string> = new Set();

/**
 * Bind NAME to a value the resolver cannot expand, keeping whether a child
 * shell inherits it.
 */
function forgetValue(vars: Map<string, ShellVariable>, name: string): void {
  vars.set(name, { value: null, exported: vars.get(name)?.exported ?? false });
}

/** A `$NAME` / `${NAME}` reference inside a word. */
const VARIABLE_REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/**
 * Expand the variable references of a DIRECTORY word against the frame's
 * bindings. The word comes back unchanged — and so stays unexpanded, under the
 * STE-597 rule — when any reference is unbound or bound to an unexpandable
 * value, or when the word carried a quoted `$` (`'$B'`, `\$B`) the shell never
 * expands (`literal`).
 */
export function expandVariables(word: string, vars: ShellFrame["vars"], literal: ReadonlySet<string>): string {
  if (!word.includes("$") || literal.has(word)) return word;
  let complete = true;
  const out = word.replace(VARIABLE_REFERENCE, (ref, braced: string | undefined, bare: string | undefined) => {
    const value = vars.get((braced ?? bare) as string)?.value ?? null;
    if (value === null) complete = false;
    return value ?? ref;
  });
  return complete && !isUnexpanded(out) ? out : word;
}

/** `$(pwd)`, `$(pwd -P)`, `$(pwd -L)`, `` `pwd` `` — the running directory. */
const PWD_SPAN = /^(?:\$\(\s*pwd(?:\s+-[LP])?\s*\)|`\s*pwd(?:\s+-[LP])?\s*`)$/;
/** `$(git rev-parse --show-toplevel)` / `$(git -C DIR rev-parse --show-toplevel)` — a checkout root. */
const TOPLEVEL_SPAN = /^\$\(\s*git\s+(?:-C\s+([^\s$`~'"()]+)\s+)?rev-parse\s+--show-toplevel\s*\)$/;
/** `$PWD` / `${PWD}` at the start of the rest of a word. */
const PWD_VARIABLE = /^\$(?:\{PWD\}|PWD(?![A-Za-z0-9_]))/;

/**
 * Expand the FIXED computed directories of a directory word (STE-613 item 6):
 * the running directory's own spellings, and the checkout root of the running
 * directory (or of a literal DIR) through the injected root lookup. Only a
 * substitution standing at the word's own level is read — one nested inside
 * another (`$(dirname $(pwd))`) is part of that other, which stays as written
 * and so unexpanded, like every other substitution. A `$PWD` the command itself
 * bound is left to the variable expansion.
 */
export function expandFixedDirectories(
  word: string,
  frame: ShellFrame,
  literal: ReadonlySet<string>,
  roots: CheckoutRootLookup | undefined,
): string {
  const here = frame.cwd.dir;
  if (here === null || literal.has(word) || !(word.includes("$") || word.includes("`"))) return word;
  const fixed = (span: string): string | null => {
    if (PWD_SPAN.test(span)) return here;
    const top = roots === undefined ? null : TOPLEVEL_SPAN.exec(span);
    if (top === null || roots === undefined) return null;
    const target = top[1] === undefined ? here : resolvePath(here, top[1]);
    return target === null ? null : roots(target);
  };
  let out = "";
  let i = 0;
  while (i < word.length) {
    const ch = word[i] as string;
    let end = -1;
    if (ch === "$" && word[i + 1] === "(") end = readSubstitution(word, i);
    else if (ch === "`") end = word.indexOf("`", i + 1) + 1 || word.length;
    if (end > i) {
      const span = word.slice(i, end);
      out += fixed(span) ?? span;
      i = end;
      continue;
    }
    const variable = ch === "$" && !frame.vars.has("PWD") ? PWD_VARIABLE.exec(word.slice(i)) : null;
    if (variable !== null) {
      out += here;
      i += variable[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * THE directory-word expander: its fixed computed directories, then its
 * variables. Every directory word the walk reads (`cd` / `pushd` operands,
 * `env -C` / `sudo -D` values, git `-C` values, assignment values) goes
 * through it; a leading `~` is left to `changeDirectory`.
 */
function expandDirectory(
  word: string,
  frame: ShellFrame,
  literal: ReadonlySet<string>,
  roots: CheckoutRootLookup | undefined,
): string {
  // A quoted leading `~` is a directory literally named `~`: pin it as relative
  // so `changeDirectory` never reads it as home (it stays unplaced, never wrong).
  if (word.startsWith("~") && literal.has(word)) return `./${word}`;
  return expandVariables(expandFixedDirectories(word, frame, literal, roots), frame.vars, literal);
}

/**
 * Bind `NAME=value` words in order; a value that does not expand binds null. A
 * fixed computed directory (`R=$(pwd)`) binds the directory at binding time.
 */
/**
 * The longest bound value the model keeps. A binding may reference itself
 * (`A=$A$A`), so a chain of them doubles the value at every step: 28 links
 * exhausted the heap and threw inside the guard, measured on the shipped bytes.
 * A gate that crashes is worse than one that says "I cannot tell", so a value
 * past this length binds null — unresolvable, never a guess (STE-613 review).
 */
export const MAX_BOUND_VALUE = 4096;

function bindAssignments(
  frame: ShellFrame,
  words: readonly string[],
  literal: ReadonlySet<string>,
  exported: boolean,
  roots?: CheckoutRootLookup,
): ShellFrame {
  const vars = new Map(frame.vars);
  for (const w of words) {
    const eq = w.indexOf("=");
    const name = w.slice(0, eq);
    const raw = w.slice(eq + 1);
    const value =
      raw.includes("$") && literal.has(w)
        ? null
        : expandDirectory(raw, { ...frame, vars }, NO_LITERALS, roots);
    const keep = value !== null && !isUnexpanded(value) && value.length <= MAX_BOUND_VALUE;
    vars.set(name, { value: keep ? value : null, exported: exported || (vars.get(name)?.exported ?? false) });
  }
  return { ...frame, vars };
}

/** A shell variable name. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Builtins that set or remove a variable in ways the resolver does not model
 * value-wise (`read B`, `declare B=…`, `local`, `printf -v B`): every name they
 * mention becomes unexpandable. `unset` removes the binding outright.
 */
const VARIABLE_WRITERS: ReadonlySet<string> = new Set([
  "read", "mapfile", "readarray", "getopts", "printf", "declare", "typeset", "local", "readonly", "let",
]);

/** Apply a segment's effect on the variable map, if it has one. */
function applyVariableEffects(
  frame: ShellFrame,
  argv: readonly string[],
  literal: ReadonlySet<string>,
  roots?: CheckoutRootLookup,
): ShellFrame {
  const argv0 = argv[0] as string;
  const operands = argv.slice(1);
  if (argv0 === "export") {
    const vars = new Map(frame.vars);
    for (const a of operands) {
      const known = vars.get(a);
      if (NAME.test(a) && known !== undefined) vars.set(a, { ...known, exported: true });
    }
    return bindAssignments({ ...frame, vars }, operands.filter((a) => ASSIGNMENT.test(a)), literal, true, roots);
  }
  if (argv0 === "unset") {
    const vars = new Map(frame.vars);
    for (const a of operands) vars.delete(a);
    return { ...frame, vars };
  }
  if (argv0 === "source" || argv0 === ".") {
    // A sourced file may set anything: every binding stops being known.
    const vars = new Map([...frame.vars].map(([k, v]) => [k, { ...v, value: null }] as const));
    return { ...frame, vars };
  }
  if (VARIABLE_WRITERS.has(argv0)) {
    const vars = new Map(frame.vars);
    for (const a of operands) {
      const name = a.replace(/[+]?=.*$/, "");
      if (NAME.test(name)) forgetValue(vars, name);
    }
    return { ...frame, vars };
  }
  return frame;
}

/**
 * Expand the `-C` values of a git argv's global options — directory words —
 * and nothing else: a `-c` / `--git-dir` value stays as written (STE-597).
 */
function expandGitDirectories(
  argv: string[],
  frame: ShellFrame,
  literal: ReadonlySet<string>,
  roots: CheckoutRootLookup | undefined,
): string[] {
  if (!argv0Is(argv[0], "git")) return argv;
  const out = argv.slice();
  let i = 1;
  while (i < out.length && (out[i] as string).startsWith("-")) {
    const token = out[i] as string;
    if (token === "-C" && i + 1 < out.length) {
      out[i + 1] = expandDirectory(out[i + 1] as string, frame, literal, roots);
      i += 2;
    } else if (token.startsWith("-C") && token.length > 2) {
      if (!literal.has(token)) out[i] = `-C${expandDirectory(token.slice(2), frame, NO_LITERALS, roots)}`;
      i += 1;
    } else if (["-c", "--git-dir", "--work-tree", "--namespace"].includes(token)) i += 2;
    else i += 1;
  }
  return out;
}

/** A `+N` / `-N` stack index: rotates a stack the resolver does not model. */
const STACK_INDEX = /^[+-]\d+$/;

/**
 * `pushd DIR` moves and pushes; `pushd -n DIR` pushes without moving. A bare
 * `pushd` (swap) and `pushd +N` / `-N` (rotate) are unresolvable.
 */
function pushDirectory(frame: ShellFrame, argv: readonly string[]): ShellFrame {
  const noMove = argv.slice(1).includes("-n");
  const rest = [argv[0] as string, ...argv.slice(1).filter((a) => a !== "-n")];
  const operand = directoryOperand(rest);
  if (operand === undefined || STACK_INDEX.test(operand)) {
    return { ...frame, cwd: unresolvable(operand ?? "pushd") };
  }
  const target = changeDirectoryBuiltin(frame.cwd, rest);
  if (noMove) return { ...frame, stack: [...frame.stack, target] };
  return { ...frame, cwd: target, stack: [...frame.stack, frame.cwd] };
}

/**
 * `popd` returns to the top of the modelled stack; `popd -n` drops it without
 * moving. An empty modelled stack and `popd +N` / `-N` are unresolvable.
 */
function popDirectory(frame: ShellFrame, argv: readonly string[]): ShellFrame {
  const operands = argv.slice(1).filter((a) => a !== "-n" && a !== "--");
  const index = operands.find((a) => STACK_INDEX.test(a));
  if (index !== undefined) return { ...frame, cwd: unresolvable(index) };
  const top = frame.stack[frame.stack.length - 1];
  if (top === undefined) return { ...frame, cwd: unresolvable("popd (an empty modelled directory stack)") };
  const stack = frame.stack.slice(0, -1);
  return argv.slice(1).includes("-n") ? { ...frame, stack } : { ...frame, cwd: top, stack };
}

/** A builtin that changes the running shell's own frame, keyed by argv0. */
export type ShellBuiltin = (frame: ShellFrame, argv: readonly string[]) => ShellFrame;

/**
 * Builtins that change THIS shell's frame rather than run a program. They apply
 * only in the shell itself: the same word run by an unplaced wrapper (`xargs
 * cd`, `sudo cd`) runs in a child process and changes nothing here. Adding a
 * directory builtin (`pushd`, `popd`) is adding a row.
 */
export const SHELL_BUILTINS: Readonly<Record<string, ShellBuiltin>> = {
  cd: (frame, argv) => restampPwd({ ...frame, cwd: changeDirectoryBuiltin(frame.cwd, argv) }),
  pushd: (frame, argv) => restampPwd(pushDirectory(frame, argv)),
  popd: (frame, argv) => restampPwd(popDirectory(frame, argv)),
  // `builtin cd` is `cd` (`command cd` is already stripped as a wrapper).
  builtin: (frame, argv) => {
    const row = argv[1] === "builtin" ? undefined : rowOf(SHELL_BUILTINS, argv[1]);
    return row === undefined ? frame : row(frame, argv.slice(1));
  },
  export: (frame, argv) => ({
    ...frame,
    exported: [...frame.exported, ...argv.slice(1).filter((a) => ASSIGNMENT.test(a))],
  }),
};

/**
 * `PWD` is maintained by the shell, not by the command: a `cd`, `pushd` or
 * `popd` re-stamps it, overriding an earlier `PWD=` a command wrote by hand.
 * Dropping the manual binding hands `$PWD` back to the fixed-form reader, which
 * answers with the directory the walk is actually in — measured against bash,
 * which prints the `cd` target after `PWD=/elsewhere; cd /real` (STE-613 review).
 */
function restampPwd(frame: ShellFrame): ShellFrame {
  if (!frame.vars.has("PWD")) return frame;
  const vars = new Map(frame.vars);
  vars.delete("PWD");
  return { ...frame, vars };
}

/** A table row by key, never an inherited `Object.prototype` member (`constructor`). */
function rowOf<T>(table: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

// ---------------------------------------------------------------------------
// Lexing: command text → segments of words, scopes and substitutions.
// ---------------------------------------------------------------------------

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
type LexItem =
  | {
      kind: "segment";
      words: string[];
      subs: Lexed[];
      caseArm: boolean;
      /** Words that carry a QUOTED `$` (`'$B'`, `\$B`): never variable-expanded. */
      literal: Set<string>;
    }
  | { kind: "open" }
  | { kind: "close" };

interface Lexed {
  items: LexItem[];
  /** False when the unquoted parentheses do not pair up. */
  balanced: boolean;
  /** True when this substitution sat deeper than `MAX_NESTING` and was not read. */
  exceeded: boolean;
}

/** The body of a substitution nested too deep to read: nothing in it is run. */
const UNREAD: Lexed = { items: [], balanced: true, exceeded: true };

/** A heredoc redirection awaiting its body, which starts on the next line. */
interface PendingHeredoc {
  /** The terminator word, with any quotes around it already removed. */
  delimiter: string;
  /** True for `<<-`, where leading tabs are stripped before the line is compared. */
  stripTabs: boolean;
}

/** Characters that end an unquoted heredoc delimiter word. */
const DELIMITER_END = /[\s;&|()<>]/;

/** Characters a backslash escapes inside double quotes. */
const DQ_ESCAPABLE = new Set(['"', "\\", "$", "`", "\n"]);

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
 * Find the end of a `$(...)` span WITHOUT reading its contents — the fallback
 * for a substitution nested deeper than `MAX_NESTING`, which is skipped as one
 * opaque word rather than lexed. Returns the index just past the closing `)`,
 * or the end of input for an unterminated span.
 */
function readSubstitution(command: string, at: number): number {
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
 * Lex command text into the steps a shell would take in sequence.
 *
 * QUOTE-AWARE, and that is the whole point: an operator — or a parenthesis —
 * inside a quoted word is data, not syntax. A regex split ignores quotes, so
 * `echo "x && git commit"` hands back `git commit"` as its own segment and the
 * guard refuses a command that commits nothing. Over-refusal is the mirror image
 * of the bypass this module exists to close, so the lexer tracks quoting the
 * way a shell does and only breaks on syntax that is actually unquoted.
 *
 * Words come out with their quotes removed, but an unquoted `$(...)` span is
 * kept together, quotes and all: the shell does not split a word at a
 * substitution's internal whitespace, so
 * `git -C $(git rev-parse --show-toplevel) commit` is four-plus words with the
 * whole span as ONE `-C` value — not a `-C $(git` whose next word reads as the
 * subcommand.
 *
 * `inSubstitution` is true when lexing the body of a `$(`: the first unmatched
 * `)` then ends the body, and the returned `end` is the index just past it.
 */
function lex(
  text: string,
  start: number,
  inSubstitution: boolean,
  level: number,
): { lexed: Lexed; end: number } {
  const items: LexItem[] = [];
  let words: string[] = [];
  let subs: Lexed[] = [];
  let word = "";
  let started = false;
  /** True once the current word holds a `$` the shell will not expand. */
  let quotedDollar = false;
  /**
   * True when the word's FIRST character is a quoted or escaped `~`: tilde
   * expansion needs an unquoted leading `~`, so `"~/x"` names `./~/x`, never home.
   */
  let quotedTilde = false;
  let literal = new Set<string>();
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let balanced = true;
  /** Heredocs opened on the line being lexed; their bodies start after it. */
  let pending: PendingHeredoc[] = [];
  /**
   * The open `case` statements, innermost last: each is reading either its
   * arm PATTERNS (words up to the `)`, which run nothing) or an arm BODY.
   * A pattern's `)` closes no subshell, so without this a `case` read as an
   * unbalanced scope and every commit in it became unplaceable for the wrong
   * reason.
   */
  const cases: Array<"pattern" | "body"> = [];
  const inPattern = (): boolean => cases[cases.length - 1] === "pattern";
  /**
   * Where the current and-or list began in `items`, one entry per open scope.
   * A trailing single `&` runs that WHOLE list in a background subshell, so
   * `cd /b & git commit` commits where the session already was: the list is
   * wrapped in an open/close pair and its `cd` cannot leak past the `&`.
   */
  const listStarts: number[] = [items.length];
  const newList = (): void => {
    listStarts[listStarts.length - 1] = items.length;
  };

  const pushSegment = (): void => {
    if (words.length > 0 || subs.length > 0) {
      items.push({ kind: "segment", words, subs, caseArm: cases.length > 0, literal });
    }
    words = [];
    subs = [];
    literal = new Set();
  };
  const endWord = (): void => {
    if (started && (quotedDollar || quotedTilde)) literal.add(word);
    quotedDollar = false;
    quotedTilde = false;
    if (started) {
      if (cases.length > 0 && word === "esac" && (words.length === 0 || inPattern())) {
        // `esac` closes the innermost case, whether it follows `;;` or ends the last arm.
        cases.pop();
        words = [];
      } else {
        words.push(word);
        // `case WORD in` — the header runs nothing; what follows is a pattern.
        const k = leadingReservedWords(words);
        if (!inPattern() && words.length === k + 3 && words[k] === "case" && words[k + 2] === "in") {
          words = words.slice(0, k);
          pushSegment();
          cases.push("pattern");
        }
      }
    }
    word = "";
    started = false;
  };
  const flush = (): void => {
    endWord();
    if (words.length > 0) items.push({ kind: "segment", words, subs, caseArm: cases.length > 0, literal });
    words = [];
    subs = [];
    literal = new Set();
  };

  /**
   * A substitution is part of the WORD it sits in, not a scope boundary: the
   * shell runs it and splices the output back into the surrounding token.
   * Reading its `(` as a subshell opener tears the word apart, and the tear cuts
   * both ways — `git -C $(pwd) commit` loses the link between `git` and `commit`,
   * while `echo $(git commit)` gains a segment reading `git commit)` that nobody
   * wrote. The body is lexed as a command of its own (so its quotes, operators
   * and heredocs follow its own syntax) and its raw text is kept in the word.
   *
   * An unterminated span consumes to end of input rather than reporting an
   * imbalance, because the thing that is unterminated is a word, not a scope.
   */
  const readSub = (at: number): number => {
    if (level + 1 > MAX_NESTING) return spliceSub(at, readSubstitution(text, at), UNREAD);
    const inner = lex(text, at + 2, true, level + 1);
    return spliceSub(at, inner.end, inner.lexed);
  };
  /** Keep the span `text[at, end)` in the word, note its body, resume at its end. */
  const spliceSub = (at: number, end: number, body: Lexed): number => {
    subs.push(body);
    word += text.slice(at, end);
    started = true;
    return end - 1;
  };

  /**
   * A backtick substitution is the older spelling of `$(...)`, and it scopes the
   * same way: an operator inside it splits INSIDE the substitution, and a `cd`
   * inside it moves only the substitution. Inside backticks a backslash quotes
   * only `` ` ``, `\` and `$`; the body is un-escaped before it is lexed as a
   * command of its own. An unterminated span consumes to end of input.
   */
  const readBacktick = (at: number): number => {
    let body = "";
    let i = at + 1;
    while (i < text.length && text[i] !== "`") {
      if (text[i] === "\\" && ["`", "\\", "$"].includes(text[i + 1] as string)) {
        body += text[i + 1] as string;
        i += 2;
        continue;
      }
      body += text[i] as string;
      i += 1;
    }
    const end = Math.min(i + 1, text.length);
    return spliceSub(at, end, level + 1 > MAX_NESTING ? UNREAD : lex(body, 0, false, level + 1).lexed);
  };

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] as string;

    if (quote === "'") {
      if (ch === "'") quote = null;
      else {
        if (ch === "~" && word === "") quotedTilde = true;
        word += ch;
      }
      if (ch === "$") quotedDollar = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\" && DQ_ESCAPABLE.has(text[i + 1] as string)) {
        if (text[i + 1] === "$") quotedDollar = true;
        if (text[i + 1] !== "\n") word += text[i + 1] as string;
        i += 1;
        continue;
      }
      if (ch === "$" && text[i + 1] === "(") {
        i = readSub(i);
        continue;
      }
      if (ch === "`") {
        i = readBacktick(i);
        continue;
      }
      if (ch === "~" && word === "") quotedTilde = true;
      word += ch;
      continue;
    }

    // Quote removal runs before any word is read, so `\git` is `git`.
    if (ch === "\\") {
      if (i + 1 < text.length) {
        if (text[i + 1] !== "\n") {
          if (text[i + 1] === "$") quotedDollar = true;
          if (text[i + 1] === "~" && word === "") quotedTilde = true;
          word += text[i + 1] as string;
          started = true;
        }
        i += 1;
      } else {
        word += ch;
        started = true;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }

    // Before any paren handling: a `$(` opens a WORD, not a scope. Swallowing
    // the whole span here is what keeps `git -C $(pwd) commit` in one segment.
    if (ch === "$" && text[i + 1] === "(") {
      i = readSub(i);
      continue;
    }
    if (ch === "`") {
      i = readBacktick(i);
      continue;
    }

    // Inside a `case` pattern list: `(`, `|` and whitespace separate patterns,
    // and the `)` that ends the list opens the arm body — no scope is involved.
    if (inPattern()) {
      if (ch === ")") {
        endWord();
        words = [];
        cases[cases.length - 1] = "body";
      } else if (ch === "(" || ch === "|" || ch === ";" || /\s/.test(ch)) {
        endWord();
      } else {
        word += ch;
        started = true;
      }
      continue;
    }
    // `;;`, `;&` and `;;&` end a case arm; the next words are patterns again.
    if (cases.length > 0 && ch === ";" && (text[i + 1] === ";" || text[i + 1] === "&")) {
      flush();
      i += 1;
      if (text[i] === ";" && text[i + 1] === "&") i += 1;
      cases[cases.length - 1] = "pattern";
      newList();
      continue;
    }

    // A paren also TERMINATES the segment beside it, so `git commit)` is read as
    // a commit followed by a scope close rather than as a subcommand nobody
    // recognises.
    if (ch === "(") {
      flush();
      items.push({ kind: "open" });
      listStarts.push(items.length);
      depth += 1;
      continue;
    }
    if (ch === ")") {
      flush();
      if (inSubstitution && depth === 0) {
        return { lexed: { items, balanced, exceeded: false }, end: i + 1 };
      }
      items.push({ kind: "close" });
      if (listStarts.length > 1) listStarts.pop();
      if (depth === 0) balanced = false;
      else depth -= 1;
      continue;
    }

    const next = text[i + 1];

    // A heredoc BODY is data being written to a file, not command text. The
    // operator is noted here and the body skipped at the newline, because the
    // rest of THIS line still runs (`cat <<EOF > out.md` redirects after it).
    if (ch === "<" && next === "<") {
      const opened = readHeredocOperator(text, i);
      if (opened !== null) {
        endWord();
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
    // A single `&` (background) separates segments too, and so does the `&` of
    // `|&`. It is a redirection instead in `&>`, `>&` and `<&` (`2>&1`).
    if (ch === "&") {
      const redirect = next === ">" || (started && (word.endsWith(">") || word.endsWith("<")));
      if (!redirect) {
        flush();
        const from = listStarts[listStarts.length - 1] as number;
        items.splice(from, 0, { kind: "open" });
        items.push({ kind: "close" });
        newList();
        continue;
      }
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      flush();
      if (ch !== "|") newList();
      if (ch === "\n" && pending.length > 0) {
        i = skipHeredocBodies(text, i + 1, pending) - 1;
        pending = [];
      }
      continue;
    }
    if (/\s/.test(ch)) {
      endWord();
      continue;
    }

    word += ch;
    started = true;
  }
  flush();
  if (depth !== 0) balanced = false;

  return { lexed: { items, balanced, exceeded: false }, end: text.length };
}

// ---------------------------------------------------------------------------
// Wrappers, reserved words and nested shells — the tables.
// ---------------------------------------------------------------------------

/** What one wrapper consumed: where the wrapped argv starts, and its side data. */
interface WrapperStep {
  next: number;
  chdirs?: string[];
  assignments?: string[];
  /**
   * Set by an UNPLACED wrapper: the argv(s) it runs, or the string it splits
   * into one, in place of `argv.slice(next)`.
   */
  unplaced?: UnplacedWrapper & { commands: string[][]; text?: string };
}

/**
 * Reads the options of the wrapper at `argv[at]`. Returns null when this use of
 * the word does NOT run the following words as a command (`command -v git` is a
 * lookup), in which case the word is left as argv0.
 */
type WrapperReader = (argv: readonly string[], at: number) => WrapperStep | null;

/**
 * A placed wrapper's options, as data. Options are read strictly: a word in
 * none of these lists ends the options, and is the command the wrapper runs.
 */
interface WrapperOptions {
  /** Options that take no value. */
  flags?: readonly string[];
  /** Options that take the next word as their value (a `--long` one also `--long=value`). */
  valued?: readonly string[];
  /** One-word options with their value attached (`nice -5`, `nice -n5`). */
  attached?: RegExp;
  /** Operands read after the options and before the command (`timeout DURATION`). */
  operands?: number;
}

/** The reader for a wrapper whose options are all data. */
function optionReader({ flags = [], valued = [], attached, operands = 0 }: WrapperOptions): WrapperReader {
  return (argv, at) => {
    let i = at + 1;
    while (i < argv.length) {
      const a = argv[i] as string;
      if (a === "--") {
        i += 1;
        break;
      }
      if (flags.includes(a)) i += 1;
      else if (valued.includes(a)) i += 2;
      else if (valued.some((v) => v.startsWith("--") && a.startsWith(`${v}=`))) i += 1;
      else if (attached?.test(a)) i += 1;
      else break;
    }
    return { next: i + operands };
  };
}

/** `env`'s options that take no value. */
const ENV_FLAGS = ["-i", "-", "-0", "-v", "--ignore-environment", "--null", "--debug"];

const readEnv: WrapperReader = (argv, at) => {
  const chdirs: string[] = [];
  const assignments: string[] = [];
  let i = at + 1;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") {
      i += 1;
      break;
    }
    if (ENV_FLAGS.includes(a)) i += 1;
    else if (a === "-u" || a === "--unset") i += 2;
    else if (a.startsWith("--unset=") || (a.startsWith("-u") && a.length > 2)) i += 1;
    else if (a === "-C" || a === "--chdir") {
      chdirs.push(argv[i + 1] as string);
      i += 2;
    } else if (a.startsWith("--chdir=")) {
      chdirs.push(a.slice("--chdir=".length));
      i += 1;
    } else if (a.startsWith("-C") && a.length > 2) {
      chdirs.push(a.slice(2));
      i += 1;
    } else if (a === "-S" || a === "--split-string" || a.startsWith("--split-string=") || a.startsWith("-S")) {
      // `env -S STRING` splits STRING into the command it runs: unplaced.
      const inline = a.startsWith("--split-string=") ? a.slice("--split-string=".length) : a.startsWith("-S") && a.length > 2 ? a.slice(2) : null;
      const value = inline ?? argv[i + 1];
      if (value === undefined) return null;
      const rest = argv.slice(inline === null ? i + 2 : i + 1);
      return {
        next: argv.length,
        chdirs,
        assignments,
        unplaced: { by: "env", placeholders: [], commands: [], text: [value, ...rest].join(" ") },
      };
    } else if (ASSIGNMENT.test(a)) {
      assignments.push(a);
      i += 1;
    } else break;
  }
  return { next: i, chdirs, assignments };
};

const readCommand: WrapperReader = (argv, at) => {
  let i = at + 1;
  if (argv[i] === "-p") i += 1;
  if (argv[i] === "-v" || argv[i] === "-V") return null; // A lookup, not an execution.
  if (argv[i] === "--") i += 1;
  return { next: i };
};

// --- Unplaced wrappers: they run a command, but not once, or not here. -----

/**
 * Skip a run of options, read leniently: `valued` options take the next word,
 * or an attached value (`-n1`, `--max-args=1`), and any other `-word` is a
 * flag. Returns the index of the first operand. `onOption` sees every option:
 * a valued one with its value, a flag as the whole word with no value.
 */
function skipOptions(
  argv: readonly string[],
  from: number,
  valued: readonly string[],
  onOption: (option: string, value: string | undefined) => void = () => {},
): number {
  let i = from;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") return i + 1;
    if (!a.startsWith("-") || a === "-") break;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0 && valued.includes(a.slice(0, eq))) {
      onOption(a.slice(0, eq), a.slice(eq + 1));
      i += 1;
    } else if (valued.includes(a)) {
      onOption(a, argv[i + 1]);
      i += 2;
    } else if (!a.startsWith("--") && a.length > 2 && valued.includes(a.slice(0, 2))) {
      onOption(a.slice(0, 2), a.slice(2));
      i += 1;
    } else {
      onOption(a, undefined);
      i += 1;
    }
  }
  return i;
}

/** Value-taking options of each unplaced wrapper. */
const XARGS_VALUED = [
  "-I", "-L", "-n", "-P", "-s", "-d", "-a", "-E",
  "--max-lines", "--max-args", "--max-procs", "--max-chars", "--delimiter", "--arg-file", "--eof", "--process-slot-var",
];
const PARALLEL_VALUED = [
  "-j", "-P", "-S", "-I", "-N", "-n", "-L", "-d", "-a", "-E", "-C",
  "--jobs", "--sshlogin", "--colsep", "--results", "--joblog", "--tmpdir",
  "--delay", "--timeout", "--halt", "--arg-file", "--basefile", "--workdir", "--wd",
];
const WATCH_VALUED = ["-n", "--interval", "-q", "--equexit"];
const SUDO_VALUED = [
  "-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U",
  "--user", "--group", "--close-from", "--chdir", "--host", "--prompt", "--role", "--type", "--command-timeout", "--other-user",
];

const readXargs: WrapperReader = (argv, at) => {
  const placeholders: string[] = [];
  const i = skipOptions(argv, at + 1, XARGS_VALUED, (option, value) => {
    // `-I` takes a required value; `-i` / `--replace` an OPTIONAL attached one.
    if (option === "-I") {
      if (value !== undefined) placeholders.push(value);
    } else if (option === "-i" || option === "--replace") placeholders.push("{}");
    else if (option.startsWith("--replace=")) placeholders.push(option.slice("--replace=".length));
    else if (option.startsWith("-i")) placeholders.push(option.slice(2));
  });
  if (i >= argv.length) return null;
  return { next: argv.length, unplaced: { by: "xargs", placeholders, commands: [argv.slice(i)] } };
};

const readFind: WrapperReader = (argv, at) => {
  const commands: string[][] = [];
  for (let i = at + 1; i < argv.length; i += 1) {
    if (["-exec", "-execdir", "-ok", "-okdir"].includes(argv[i] as string)) {
      let j = i + 1;
      while (j < argv.length && argv[j] !== ";" && argv[j] !== "+") j += 1;
      if (j > i + 1) commands.push(argv.slice(i + 1, j));
      i = j;
    }
  }
  if (commands.length === 0) return null;
  return { next: argv.length, unplaced: { by: "find", placeholders: ["{}"], commands } };
};

const readParallel: WrapperReader = (argv, at) => {
  const i = skipOptions(argv, at + 1, PARALLEL_VALUED);
  let end = i;
  while (end < argv.length && !/^::::?\+?$/.test(argv[end] as string)) end += 1;
  if (end === i) return null;
  return { next: argv.length, unplaced: { by: "parallel", placeholders: ["{"], commands: [argv.slice(i, end)] } };
};

const readWatch: WrapperReader = (argv, at) => {
  const exec = argv.slice(at + 1).some((a) => a === "-x" || a === "--exec");
  const i = skipOptions(argv, at + 1, WATCH_VALUED);
  if (i >= argv.length) return null;
  const words = argv.slice(i);
  // Without `-x`, watch hands its words to `sh -c` as one string.
  return exec
    ? { next: argv.length, unplaced: { by: "watch", placeholders: [], commands: [words] } }
    : { next: argv.length, unplaced: { by: "watch", placeholders: [], commands: [], text: words.join(" ") } };
};

const readSudo: WrapperReader = (argv, at) => {
  const chdirs: string[] = [];
  const i = skipOptions(argv, at + 1, SUDO_VALUED, (option, value) => {
    if ((option === "-D" || option === "--chdir") && value !== undefined) chdirs.push(value);
  });
  if (i >= argv.length) return null;
  return { next: argv.length, chdirs, unplaced: { by: "sudo", placeholders: [], commands: [argv.slice(i)] } };
};

/**
 * Prefix words that run the words after them as a command. Each row is a word
 * and the reader for its options; adding a wrapper is adding a row. The placed
 * rows are pure data; `env` and `command` read options that change what runs
 * (a directory, an environment, a lookup), and the unplaced rows name the
 * command(s) they run somewhere else or more than once.
 */
export const WRAPPERS: Readonly<Record<string, WrapperReader>> = {
  env: readEnv,
  command: readCommand,
  exec: optionReader({ flags: ["-c", "-l", "-cl", "-lc"], valued: ["-a"] }),
  nohup: optionReader({}),
  time: optionReader({ flags: ["-p"] }),
  nice: optionReader({ valued: ["-n", "--adjustment"], attached: /^-(?:n-?)?\d+$/ }),
  timeout: optionReader({
    flags: ["--preserve-status", "--foreground", "-v", "--verbose"],
    valued: ["-s", "--signal", "-k", "--kill-after"],
    operands: 1,
  }),
  "!": optionReader({}),
  xargs: readXargs,
  find: readFind,
  parallel: readParallel,
  watch: readWatch,
  sudo: readSudo,
};

/**
 * Reserved words stripped from the front of a segment. None of them runs a
 * command; each only frames the command after it, so `if git commit; then …`
 * and `while …; do git commit; done` still run `git commit`. A brace group is
 * NOT a subshell, so a `cd` inside `{ … }` outlives the `}`.
 */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  ...["{", "}"], // A brace group: NOT a subshell.
  ...["if", "then", "elif", "else", "fi"], // A conditional.
  ...["while", "until", "do", "done"], // A loop.
]);

/** Segment-leading words that introduce a header running no command (`for f in a b`). */
const HEADER_WORDS: ReadonlySet<string> = new Set(["for", "select"]);

/**
 * How many leading words frame, rather than form, the command: reserved words
 * and a `function NAME` definition header (its body is read as if run).
 */
function leadingReservedWords(words: readonly string[]): number {
  let k = 0;
  while (k < words.length) {
    const w = words[k] as string;
    if (RESERVED_WORDS.has(w)) k += 1;
    else if (w === "function" && k + 1 < words.length) k += 2;
    else break;
  }
  return k;
}

/** Shells whose `-c STRING` is read recursively. */
export const NESTED_SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

interface Stripped {
  argv: string[];
  wrappers: string[];
  chdirs: string[];
  assignments: string[];
  /** The outermost unplaced wrapper that carried the command, if any. */
  unplaced: UnplacedWrapper | null;
  /** A command STRING the unplaced wrapper runs (`watch`, `env -S`), read like a nested shell. */
  text?: string;
}

/**
 * Strip wrappers off a segment. Usually one command comes back; an unplaced
 * wrapper may run several (`find -exec a \; -exec b \;`).
 */
function stripWrappers(words: readonly string[]): Stripped[] {
  const wrappers: string[] = [];
  const chdirs: string[] = [];
  const assignments: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i] as string;
    if (ASSIGNMENT.test(w)) {
      assignments.push(w);
      i += 1;
      continue;
    }
    const reader = rowOf(WRAPPERS, w);
    if (reader === undefined) break;
    const step = reader(words, i);
    if (step === null) break;
    wrappers.push(w);
    chdirs.push(...(step.chdirs ?? []));
    assignments.push(...(step.assignments ?? []));
    if (step.unplaced !== undefined) {
      const { by, placeholders, commands, text } = step.unplaced;
      const unplaced: UnplacedWrapper = { by, placeholders };
      if (text !== undefined) {
        return [{ argv: [], wrappers, chdirs, assignments, unplaced, text }];
      }
      return commands.flatMap((command) =>
        stripWrappers(command).map((inner) => ({
          argv: inner.argv,
          wrappers: [...wrappers, ...inner.wrappers],
          chdirs: [...chdirs, ...inner.chdirs],
          assignments: [...assignments, ...inner.assignments],
          unplaced: {
            by,
            placeholders: [...placeholders, ...(inner.unplaced?.placeholders ?? [])],
          },
          ...(inner.text !== undefined ? { text: inner.text } : {}),
        })),
      );
    }
    i = step.next;
  }
  return [{ argv: words.slice(i), wrappers, chdirs, assignments, unplaced: null }];
}

/** A nested command string this argv runs, and whether it runs in THIS shell. */
interface NestedString {
  text: string;
  /** True for `eval`: it runs in the current shell, so a `cd` inside it persists. */
  inPlace: boolean;
}

function nestedString(argv: readonly string[]): NestedString | null {
  const argv0 = argv[0] as string;
  if (argv0 === "eval") {
    return argv.length > 1 ? { text: argv.slice(1).join(" "), inPlace: true } : null;
  }
  if (!NESTED_SHELLS.has(argv0)) return null;
  let sawC = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--") {
      i += 1;
      break;
    }
    if (a === "-o" || a === "+o") {
      i += 2;
      continue;
    }
    if (/^[-+][A-Za-z]+$/.test(a)) {
      if (a.startsWith("-") && a.includes("c")) sawC = true;
      i += 1;
      continue;
    }
    if (a.startsWith("--")) {
      i += 1;
      continue;
    }
    break;
  }
  if (!sawC || i >= argv.length) return null;
  return { text: argv[i] as string, inPlace: false };
}

// ---------------------------------------------------------------------------
// Walking: lexed items → invocations, with the directory model applied.
// ---------------------------------------------------------------------------

interface WalkState {
  rules: ReadingRules;
  out: ShellInvocation[];
  /** False once any read scope's parentheses fail to pair. */
  balanced: boolean;
  /** The injected checkout-root lookup, for `$(git rev-parse --show-toplevel)`. */
  roots: CheckoutRootLookup | undefined;
}

/** What a nested reading inherits from the command that carries it. */
interface Carrier {
  /** How deep in nested strings and substitutions this reading sits. */
  level: number;
  /** The wrapper chain so far, outermost first. */
  chain: readonly string[];
  /** True inside a `case` arm. */
  caseArm: boolean;
  /** The outermost unplaced wrapper, once one has carried the command. */
  unplaced: UnplacedWrapper | null;
}

const TOP_LEVEL: Carrier = { level: 0, chain: [], caseArm: false, unplaced: null };

/**
 * Lex and walk a nested command STRING (`sh -c`, `eval`, `watch`, `env -S`) one
 * level down, starting from `frame`. Returns the frame it ends in, or null when
 * the string sits deeper than `MAX_NESTING` and was not read.
 */
function walkString(text: string, frame: ShellFrame, carrier: Carrier, state: WalkState): ShellFrame | null {
  if (carrier.level > MAX_NESTING) return null;
  const inner = lex(text, 0, false, carrier.level).lexed;
  if (!inner.balanced) state.balanced = false;
  return walk(inner, frame, carrier, state);
}

function walk(lexed: Lexed, start: ShellFrame, carrier: Carrier, state: WalkState): ShellFrame {
  const { rules, out, roots } = state;
  let frame = start;
  /** The frames the enclosing subshells will restore on their `)`. */
  const scopes: ShellFrame[] = [];

  for (const item of lexed.items) {
    if (item.kind === "open") {
      // A subshell INHERITS the current frame and hands it back on close.
      scopes.push(frame);
      continue;
    }
    if (item.kind === "close") {
      frame = scopes.pop() ?? frame;
      continue;
    }

    const caseArm = carrier.caseArm || item.caseArm;
    const down = carrier.level + 1;

    // A substitution runs first, in a subshell of the running directory, and
    // never under the unplaced wrapper of the command it is spliced into.
    if (rules.substitutions) {
      for (const sub of item.subs) {
        if (sub.exceeded) continue;
        if (!sub.balanced) state.balanced = false;
        walk(sub, frame, { ...carrier, level: down, caseArm, unplaced: null }, state);
      }
    }

    let words = item.words;
    if (rules.reservedWords) {
      words = words.slice(leadingReservedWords(words));
      if (HEADER_WORDS.has(words[0] as string)) {
        // `for NAME in …`: the loop variable takes a value per iteration.
        const name = words[1];
        if (name !== undefined && NAME.test(name)) {
          const vars = new Map(frame.vars);
          forgetValue(vars, name);
          frame = { ...frame, vars };
        }
        continue;
      }
    }
    const strippedList: Stripped[] = rules.wrappers
      ? stripWrappers(words)
      : [{ argv: words.slice(), wrappers: [], chdirs: [], assignments: [], unplaced: null }];
    for (const stripped of strippedList) {
      const { argv } = stripped;
      const unplaced = carrier.unplaced ?? stripped.unplaced;
      const wrappers = [...carrier.chain, ...stripped.wrappers];

      // `env -C DIR` and `sudo -D DIR` move this command only, not the shell.
      let here = frame.cwd;
      for (const d of stripped.chdirs) here = changeDirectory(here, expandDirectory(d, { ...frame, cwd: here }, item.literal, roots));
      const at: ShellFrame = { ...frame, cwd: here };

      // `watch CMD`, `env -S STRING`: a command string, read like a nested shell.
      if (stripped.text !== undefined) {
        walkString(stripped.text, at, { level: down, chain: wrappers, caseArm, unplaced }, state);
        continue;
      }
      if (argv.length === 0) {
        // A segment of bare `NAME=value` words binds them for later segments.
        if (stripped.wrappers.length === 0 && unplaced === null && stripped.assignments.length > 0) {
          frame = bindAssignments(frame, stripped.assignments, item.literal, false, roots);
        }
        continue;
      }

      const nested = rules.nestedShells ? nestedString(argv) : null;
      if (nested !== null) {
        const carried: Carrier = { level: down, chain: [...wrappers, argv[0] as string], caseArm, unplaced };
        // A child shell (`sh -c`) sees only exported variables; a string the
        // outer shell expanded (no quoted `$`) already carries the values.
        const inherited =
          nested.inPlace || !item.literal.has(nested.text)
            ? at
            : { ...at, vars: new Map([...at.vars].filter(([, v]) => v.exported)) };
        const after = walkString(nested.text, inherited, carried, state);
        if (after !== null) {
          // Only `eval` runs in THIS shell, so only its frame — its `cd` AND its
          // `export`s — outlives it: `eval 'export GIT_DIR=x'; git commit`.
          if (nested.inPlace && stripped.chdirs.length === 0 && unplaced === null) {
            frame = after;
          }
          continue;
        }
      }

      out.push({
        argv: unplaced === null ? expandGitDirectories(argv, at, item.literal, roots) : argv,
        dir: here.dir,
        unexpanded: here.dir === null ? here.word : null,
        wrappers,
        moved: here.moved,
        assignments: [...frame.exported, ...stripped.assignments],
        nestingExceeded: nested !== null,
        caseArm,
        unplaced,
      });

      // A builtin run by an unplaced wrapper runs in a child process, not this shell.
      const builtin = rowOf(SHELL_BUILTINS, argv[0]);
      if (unplaced === null) {
        if (builtin !== undefined) {
          const expanded =
            argv[0] === "export" ? argv : argv.map((w, k) => (k === 0 ? w : expandDirectory(w, frame, item.literal, roots)));
          frame = builtin(frame, expanded);
        }
        frame = applyVariableEffects(frame, argv, item.literal, roots);
      }
    }
  }
  return frame;
}

// ---------------------------------------------------------------------------
// Front doors.
// ---------------------------------------------------------------------------

/** The invocation stream plus whether every read scope's parentheses paired. */
export interface InvocationReading {
  invocations: ShellInvocation[];
  /** False when unquoted parentheses do not pair up (the scope extent is unknown). */
  balanced: boolean;
}

/**
 * Read a command under explicit `rules`. `roots` is the injected checkout-root
 * lookup: the grammar consults it for `$(git rev-parse --show-toplevel)`, and
 * it is threaded here so readers that need a checkout (alias expansion,
 * candidate roots) take the same injected lookup the resolver does.
 */
export function readInvocations(
  command: string,
  sessionCwd: string,
  roots: CheckoutRootLookup | undefined,
  rules: ReadingRules = FULL_READING,
): InvocationReading {
  const { lexed } = lex(command, 0, false, 0);
  const state: WalkState = { rules, out: [], balanced: lexed.balanced, roots };
  walk(lexed, { cwd: { dir: sessionCwd, word: null, moved: false }, exported: [], stack: [], vars: new Map() }, TOP_LEVEL, state);
  return { invocations: state.out, balanced: state.balanced };
}

/** Every simple command the shell would run, in order, under the full grammar. */
export function shellInvocations(
  command: string,
  sessionCwd: string,
  roots?: CheckoutRootLookup,
): ShellInvocation[] {
  return readInvocations(command, sessionCwd, roots, FULL_READING).invocations;
}
