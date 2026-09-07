// Derive the set of BLOCKING hook gates from the hook entry points themselves.
//
// WHY THIS MODULE EXISTS, and it is not tidiness.
//
// A gate that refuses a commit is a promise made to the operator, and a promise
// nothing announces is a trap. The announcing surfaces — the hooks manual, the
// honored-contracts catalog, the bootstrapped CLAUDE.md — have been corrected
// one gate at a time, twice. A correction is one edit; the class needs a
// reader, and a reader that learns the gates from a hand-kept list is the same
// edit wearing a derivation's clothes: it goes stale on the day a fourth entry
// point lands, which is precisely the day it was supposed to speak up.
//
// So the set is computed from the entry-point SOURCES, and this module contains
// no gate's name in any form. That is the deliverable, not a stylistic
// preference: a literal here would survive a fourth-gate mutation, and a reader
// that cannot notice a new gate cannot red the run that adds it.
//
// It takes `pluginRoot` as a PARAMETER rather than resolving from
// `import.meta.dir` for the same reason: the falsifiability leg that proves the
// derivation is a derivation stages a synthetic entry point in a temp tree, and
// a reader wired to one absolute path could never be pointed at it.
//
// House precedent for a `_`-prefixed, uncollected test-support module:
// `tests/_fence.ts`, `tests/_sited-mutation.ts`.

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

/** One hook entry point that REFUSES — as opposed to one that merely reminds. */
export interface BlockingGate {
  /** The hook's registered name — the second argument of its demand call. */
  hook: string;
  /** The Skill it demands — the first argument of that same call. */
  skill: string;
  /**
   * The entry-point file, relative to the hooks directory, so a failure can
   * name the source. A top-level entry point is therefore its own basename;
   * one in a subdirectory carries the subdirectory, because the value's only
   * job is to tell a person which file to open.
   */
  entryPoint: string;
}

/** Where per-hook entry points live, relative to a plugin root. */
const HOOKS_SUBPATH = ["templates", "hooks", "_lib", "hooks"] as const;

/**
 * The helper an entry point calls when it intends to REFUSE on a miss.
 *
 * This is the discriminating clause, and it is a contract rather than a
 * heuristic: `templates/hooks/_lib/session.ts` ships two lookups over the same
 * transcript, and the only difference between them is that this one emits the
 * `Refusing:` block on a miss while its advisory sibling stays silent. Which
 * one an entry point imports is how its author declares what kind of hook they
 * are writing.
 *
 * Named as a fragment rather than matched loosely, because that advisory
 * sibling differs only by its prefix: a substring test written against the
 * shared tail would sweep in the reminder hooks and quietly inflate the set,
 * which reads exactly like a working derivation until someone counts.
 */
const DEMAND_CALL = "requireSkillToolUse";

/**
 * The refusal: an exit that can leave a non-zero status.
 *
 * Calling the demand helper is not the whole gate — a hook can ask and then
 * shrug — so the exit is graded too. What it is deliberately NOT graded against
 * is one spelling. An earlier draft of this module matched the shipped
 * `found ? 0 : 2` ternary verbatim with whitespace removed, and three shapes a
 * hook author would plausibly write were measured silently dropped by it: a
 * guarded `if (!found) process.exit(2)`, a renamed destructured binding, and —
 * the one that settles the argument — that SAME ternary after the formatter
 * wraps it, because wrapping adds the magic trailing comma and `(found?0:2,)`
 * is not `(found?0:2)`. A derivation that goes blind when a file is reformatted
 * is the hand-kept list it was built to replace.
 *
 * So what is asked for is the weakest shape that still means "refuses": an exit
 * call carrying a non-zero status somewhere in its argument. The residual error
 * is directional on purpose. Matching too widely adds a gate, and an extra gate
 * reds the announcement legs where a person reads the failure; matching too
 * narrowly drops a gate and the run stays green, which is the precise silence
 * this module exists to break.
 */
const BLOCKING_EXIT = /process\.exit\([^)]*[1-9][^)]*\)/;

/**
 * The first two string arguments of the demand call, in source order.
 *
 * Deliberately tolerant of newlines between the arguments: every shipped call
 * site is wrapped across four lines, so a single-line pattern would match none
 * of them and return an empty set — the failure mode where every "every gate is
 * announced" roll-up passes vacuously.
 *
 * First match only, so an entry point that demanded two Skills would contribute
 * one gate. No shipped hook does, and the alternative reading — that a second
 * call is a second gate — is not obviously right either, so the limit is
 * recorded here rather than guessed at in code.
 */
const DEMAND_ARGS =
  /requireSkillToolUse\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(["'`])([^"'`]+)\3/;

/** Does this source both demand a Skill and refuse when it is missing? */
function isBlockingSource(source: string): boolean {
  // Whitespace stripped ONCE, and both clauses read the dense form. Grading the
  // call on the raw text while grading the exit on the dense one is the
  // asymmetry that lets a wrapped call name pass one clause and fail the other.
  const dense = source.replace(/\s+/g, "");
  return dense.includes(`${DEMAND_CALL}(`) && BLOCKING_EXIT.test(dense);
}

/**
 * Every `*.ts` entry point ANYWHERE UNDER a hooks directory that ships the
 * blocking shape.
 *
 * Recursive, and that is the contract rather than a convenience: the scope is
 * "under the hooks tree", so an entry point one level down is in scope by the
 * wording, and a walk that listed the top level only would drop it without a
 * word — the hand-kept list's failure mode arriving by a different route.
 *
 * A missing directory answers `[]` rather than throwing: a consumer project
 * that never installed the hook tree is a legitimate state, and a reader that
 * crashed on it would make this module unusable anywhere but here. That is the
 * ONE sanctioned silence, and it is scoped to the ROOT listing. A subdirectory
 * that cannot be listed raises, because "there is no hook tree" and "there is a
 * corner of the hook tree I could not read" are not the same statement, and
 * only the first of them is safe to answer with an empty set.
 */
export function deriveBlockingGates(pluginRoot: string): BlockingGate[] {
  const hooksDir = join(pluginRoot, ...HOOKS_SUBPATH);

  let rootEntries: Dirent[];
  try {
    rootEntries = readdirSync(hooksDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const gates: BlockingGate[] = [];

  const visit = (dir: string, entries: Dirent[]): void => {
    for (const entry of entries) {
      const absolute = join(dir, entry.name);

      // Directories are discriminated HERE, by type, rather than downstream by
      // catching the read error one would produce. That is the whole reason for
      // `withFileTypes`: it leaves a failed read with exactly one meaning — a
      // file this module could not inspect — so the read can be allowed to
      // raise. Swallowing it would drop a candidate gate in silence, and
      // silence about a gate is the failure this module exists to prevent.
      //
      // Typed rather than name-based in BOTH directions: a directory whose name
      // happens to end in `.ts` is walked, never read, and the listing below is
      // uncaught for the reason in the doc comment.
      if (entry.isDirectory()) {
        visit(absolute, readdirSync(absolute, { withFileTypes: true }));
        continue;
      }

      // A symlink is neither a directory nor followed as one: `Dirent` reports
      // the link itself, so `isDirectory()` is false for a symlinked directory
      // and the recursion cannot be walked into a cycle by one.
      if (!entry.name.endsWith(".ts")) continue;

      // Relative to the hooks ROOT, not to `dir`: a bare basename would name
      // two different files identically once a subdirectory exists, and the
      // value exists to send a person to a file.
      const entryPoint = relative(hooksDir, absolute);
      const source = readFileSync(absolute, "utf-8");
      if (!isBlockingSource(source)) continue;

      const match = DEMAND_ARGS.exec(source);
      // An entry point carrying the blocking exit but no extractable pair is a
      // shape this reader does not understand. Skipping it silently is the
      // wrong answer for the same reason a hard-coded list is, so it raises.
      if (match === null) {
        throw new Error(
          `${entryPoint}: exits blocking on a miss, but its demand call's ` +
            `Skill/hook arguments could not be read`,
        );
      }

      gates.push({ hook: match[4]!, skill: match[2]!, entryPoint });
    }
  };

  visit(hooksDir, rootEntries);

  // Sorted by hook name so callers can compare whole arrays: directory order is
  // filesystem-dependent, and a set that reorders between machines turns a
  // stable assertion into a flaky one.
  return gates.sort((a, b) => (a.hook < b.hook ? -1 : a.hook > b.hook ? 1 : 0));
}
