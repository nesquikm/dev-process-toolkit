// STE-290 — Pre-commit /tdd orchestrator enforcement (per-hook entrypoint).
// STE-295 AC.1 — carve-out: spec-only commits skip the /tdd requirement.
// STE-360 AC.1 — carve-out: /setup's Bun zero-match placeholder test is exempt.
// STE-597 — a commit is recognised in three shapes (bare, `cd <dir> && git
//   commit`, `git -C <dir> commit`), and every git query and layout lookup runs
//   in the repository the commit WRITES TO rather than the hook process's own
//   directory. A target that cannot be resolved exits 1 with an NFR-10
//   `Reminder:` naming it — never a refusal.
//
// Refusing hook: on a recognised commit, runs `git diff --cached --name-only`
// in that resolved repository to find staged files, then asks
// `classifyStagedPaths` for a verdict:
//   - "spec-only"     → exit 0 (carve-out: pure spec/plan/requirements commit)
//   - "no-fr"         → exit 0 (no FR-related paths; STE-290 didn't flag)
//   - "stack-unknown" → exit 1 + an NFR-10 `Reminder:` on stderr (STE-548: no
//                        stack marker resolved, so the guard could not look).
//   - "tdd-required"  → require a `dev-process-toolkit:tdd` Skill tool_use in
//                        the session transcript (exit 2 on miss).
//
// Spec-only carve-out fires iff the staged set is NON-EMPTY, EVERY path
// matches one of the SPEC_PATTERNS below, AND NO path matches the
// src/test patterns (`src/**`, `**/__tests__/**`, `*.{test,spec}.{ts,tsx,js}`).
// Mixed spec+src or spec+test still requires /tdd (preserves STE-290 semantics).
//
// STE-360 placeholder exemption (dual key): a staged path is exempt iff
//   (a) its basename is `.placeholder.test.ts` (guard, secondary), AND
//   (b) the STAGED BLOB carries the "Bun zero-match workaround" marker
//       comment (grep, primary) OR the path is staged as a DELETION
//       (the STE-215/STE-222 first-real-test-lands lifecycle).
// Exemption subtracts exempt placeholders from the tdd-REQUIRED set only —
// it never waives the check for other staged files, and it does not feed
// back into the spec-only carve-out (placeholder + FR file stays mixed,
// hence tdd-required).

import {
  emitNFR10,
  harnessAbsent,
  parseHookPayload,
  requireTddEvidence,
} from "../session.ts";
import {
  buildLayoutPredicates,
  resolveStackLayout,
  type LayoutPredicates,
  type StackLayoutEntry,
} from "../../../../adapters/_shared/src/stack_layout.ts";
import { resolveCommitTargetFromPayload } from "../../../../adapters/_shared/src/commit_target_repo.ts";
import {
  checkoutRootOf,
  gateEvidenceTarget,
} from "../../../../adapters/_shared/src/gate_receipt.ts";

// ---------------------------------------------------------------------------
// Pure classifier — exported for unit tests (AC-STE-295.1).
//
// STE-547: the source/test predicates are no longer hard-coded TypeScript path
// regexes. They are derived from the ONE marker table in `stack_layout.ts`, so a
// Dart, Python, Kotlin or Go commit staging a source file and its test gets the
// same verdict a TypeScript one already did.
// ---------------------------------------------------------------------------

// ACTIVE FRs only. `.*` used to cross the `archive/` segment, so filing a
// finished FR — the archive move `/implement` Phase 4 performs — was read as
// staging new work and demanded TDD evidence for a markdown record: there is no
// test to run red and no FR to `/tdd`, so the refusal named no path the session
// could take. Measured live on 2026-09-23, where it aborted a 26-step leg.
// Archived records are frozen history, the same rule every other walk applies.
const FR_RE = /^specs\/frs\/(?!archive\/)[^/]*\.md$/;

// Spec-only carve-out patterns. Every staged path must match at least one of
// these AND none may match the src/test patterns below for `spec-only`.
const SPEC_PATTERNS: RegExp[] = [
  /^specs\/frs\/[^/]+\.md$/, // specs/frs/*.md (excludes subdirs except archive below)
  /^specs\/frs\/archive\/[^/]+\.md$/, // specs/frs/archive/*.md
  /^specs\/plan\/M[^/]*\.md$/, // specs/plan/M*.md
  /^specs\/plan\/archive\/[^/]+\.md$/, // specs/plan/archive/*.md
  /^specs\/requirements\.md$/,
  /^specs\/technical-spec\.md$/,
  /^specs\/testing-spec\.md$/,
];

const isSpecPath = (p: string): boolean =>
  SPEC_PATTERNS.some((re) => re.test(p));

/**
 * The predicates for a RESOLVED table entry — one place, so the verdict below
 * and the STE-360 subtraction in the entrypoint read the same layout. A project
 * that used one stack's rules for the verdict and another's for the subtraction
 * could raise the requirement under one and waive it under the other.
 *
 * STE-548: there is no `null` leg any more. An unresolved marker no longer picks
 * a default layout to guess with — it never reaches a predicate at all.
 */
const predicatesFor = (entry: StackLayoutEntry): LayoutPredicates =>
  buildLayoutPredicates(entry.layout);

/**
 * The STE-290 trigger for ONE staged path: FR markdown (stack-independent) or a
 * file the resolved stack calls a test. Named once because the entrypoint filters
 * the tdd-required SET with the same rule the verdict is decided by. Two copies
 * of that rule could disagree: `required` would come back empty for a commit
 * already classified `tdd-required`, and the exemption's `required.length > 0`
 * guard would turn that into an unexplainable block rather than a waiver.
 */
const isTddRequiredPath = (
  path: string,
  isTest: (p: string) => boolean,
  entry: StackLayoutEntry,
): boolean => FR_RE.test(path) || (isTest(path) && !isDataFixture(path, entry));

const FIXTURES_DIR_RE = /(^|\/)fixtures\//;

/**
 * STE-616 — DATA in a `fixtures/` directory is not a test. The layout calls
 * everything in the test tree test material, which the spec-only carve-out
 * still reads; but the /tdd trigger asks "was a test written", and a JSON
 * evidence bundle a live smoke captured has no red to prove. Demanding one
 * deadlocked the smoke's own pre-flight, which requires the bundle committed.
 *
 * Narrow on purpose: a file whose NAME is a test (the stack's test globs), or
 * whose extension is one of the stack's SOURCE extensions, keeps the
 * requirement even inside `fixtures/` — code there is code.
 */
const isDataFixture = (path: string, entry: StackLayoutEntry): boolean => {
  if (!FIXTURES_DIR_RE.test(path)) return false;
  if (entry.layout.sourceExtensions.some((ext) => path.endsWith(ext))) return false;
  // Globs only: the same builder with no test directories answers "is this
  // file NAMED like a test", which is the question a fixtures dir leaves open.
  const byName = buildLayoutPredicates({ ...entry.layout, testDirs: [] }).isTest;
  return !byName(path);
};

export type StagedClassification =
  | "spec-only"
  | "tdd-required"
  | "no-fr"
  | "stack-unknown";

/**
 * Classify a staged-paths list into one of FOUR verdicts that drive the
 * pre-commit /tdd orchestrator's early-exit decision.
 *
 *   - "spec-only"     — staged set is non-empty and every path matches a spec
 *                        pattern (and, where a stack resolved, no path matches
 *                        its src/test rules). Hook exits 0 (carve-out).
 *   - "tdd-required"  — staged set contains an FR-markdown path or any path the
 *                        resolved stack calls a test. Hook requires a /tdd
 *                        Skill tool_use.
 *   - "no-fr"         — a stack resolved and neither carve-out nor the STE-290
 *                        trigger fired; hook exits 0 (empty set, pure
 *                        README/CHANGELOG). "Nothing to guard."
 *   - "stack-unknown" — STE-548: NO stack marker resolved, so nothing could be
 *                        classified. "Could not tell", which is not the same
 *                        claim as "nothing to guard" — hook exits 1 with an
 *                        NFR-10 `Reminder:` naming the project.
 *
 * `projectRoot` is OPTIONAL and only selects WHICH stack's conventions apply;
 * it defaults to walking up from the process cwd to the first stack marker (or
 * the enclosing `.git` checkout root, whichever comes first). Since STE-597 the
 * shipped entrypoint never takes that default — it resolves the repository the
 * commit writes to and passes it — so the process-cwd leg is an API
 * convenience for callers that have no payload, not the hook's reading.
 */
export function classifyStagedPaths(
  paths: string[],
  projectRoot?: string,
): StagedClassification {
  return classifyStagedPathsForEntry(
    paths,
    resolveStackLayout(projectRoot ?? process.cwd()),
  );
}

/**
 * The same classifier with the resolved table entry INJECTED rather than looked
 * up — one code path, two front doors. Emptying an entry's `layout` and passing
 * it here exercises the shipped predicate builder, not a copy of it.
 */
export function classifyStagedPathsForEntry(
  paths: string[],
  entry: StackLayoutEntry | null,
): StagedClassification {
  if (paths.length === 0) {
    return "no-fr";
  }
  // Computed ONCE and read by both branches below, because the question is
  // stack-independent by construction: `specs/frs/*.md` is spec material
  // whatever the project is written in. Two copies of this rule could drift,
  // and the no-entry branch is exactly where a drifted copy would silently
  // delete `spec-only` (AC-STE-548.6).
  const allSpec = paths.every(isSpecPath);
  if (entry === null) {
    // STE-548. The spec carve-out is answered FIRST and deliberately: a staged
    // set of nothing but spec files carries nothing a stack could have told us
    // about. Reporting "could not tell" ahead of the carve-out would fold
    // `spec-only` away in exactly the projects this FR is about.
    if (allSpec) {
      return "spec-only";
    }
    // Anything else: we cannot say whether this commit needed a guard, and
    // saying "no-fr" would claim we had looked.
    return "stack-unknown";
  }
  const { isSource, isTest } = predicatesFor(entry);
  const hasSrcOrTest = paths.some((p) => isSource(p) || isTest(p));
  if (!hasSrcOrTest && allSpec) {
    return "spec-only";
  }
  if (paths.some((p) => isTddRequiredPath(p, isTest, entry))) {
    return "tdd-required";
  }
  return "no-fr";
}

// ---------------------------------------------------------------------------
// Git plumbing — one spawn/collect helper shared by every `git` call below.
// ---------------------------------------------------------------------------

interface GitResult {
  exitCode: number;
  stdout: string;
  /**
   * True when the subprocess could not be RUN at all — `git` missing from the
   * hook's PATH, or `cwd` gone between resolution and the spawn. Distinct from a
   * non-zero exit, which means git ran and disagreed.
   */
  spawnFailed: boolean;
}

/**
 * Run `git <args>` in `cwd`; capture stdout, discard stderr, report exit code.
 *
 * STE-597 — `cwd` is REQUIRED at every call site. It used to be the hook
 * process's own directory, which is the one thing here that has nothing to do
 * with where the commit lands: the same staged set produced opposite verdicts
 * depending on which tree the calling session happened to sit in.
 *
 * STE-597 (FINDING B) — a spawn that throws is REPORTED, not propagated. Every
 * other failure mode in this file emits a worded NFR-10 block and exits 1 (a
 * visible, non-blocking Reminder — STE-601); an uncaught `Bun.spawn` made the
 * one remaining mode a raw stack trace, which is an unexplained interruption.
 */
async function gitOut(args: string[], cwd: string): Promise<GitResult> {
  const failed: GitResult = { exitCode: -1, stdout: "", spawnFailed: true };
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
  } catch {
    return failed;
  }
  try {
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout, spawnFailed: false };
  } catch {
    return failed;
  }
}

// ---------------------------------------------------------------------------
// STE-360 — /setup Bun zero-match placeholder exemption.
// ---------------------------------------------------------------------------

const PLACEHOLDER_BASENAME = ".placeholder.test.ts";
const PLACEHOLDER_MARKER = "Bun zero-match workaround";

/**
 * True iff `path` is an exempt /setup placeholder per the STE-360 dual key:
 * basename must be `.placeholder.test.ts` AND the staged blob must carry the
 * `Bun zero-match workaround` marker comment (or the path must be staged as
 * a deletion). Reads the INDEX (`git show :<path>`), not the worktree, so a
 * marker-less file renamed to the placeholder basename stays tdd-required.
 */
async function isExemptPlaceholder(
  path: string,
  repoRoot: string,
): Promise<boolean> {
  if (path.split("/").pop() !== PLACEHOLDER_BASENAME) {
    return false;
  }
  // Deletion leg: `git rm`-ed placeholders have no staged blob to grep.
  const status = await gitOut(
    ["diff", "--cached", "--name-status", "--", path],
    repoRoot,
  );
  if (status.stdout.trimStart().startsWith("D")) {
    return true;
  }
  // Marker leg: grep the staged blob for the workaround marker comment.
  const show = await gitOut(["show", `:${path}`], repoRoot);
  return show.exitCode === 0 && show.stdout.includes(PLACEHOLDER_MARKER);
}

// ---------------------------------------------------------------------------
// Entrypoint — only runs when this file is executed (not imported for tests).
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const stdin = await Bun.stdin.text();
  const payload = parseHookPayload(stdin);
  // STE-614 AC.2 — the ONE fail-open leg, asked BEFORE any other verdict. The
  // advisory `Reminder:` legs below all exit 1, which is stderr shown to an
  // operator; with no harness there is no operator and no session to grade.
  if (!payload || harnessAbsent(payload)) {
    process.exit(0);
  }
  // STE-597 — recognise the commit in all three shapes (bare, `cd`-prefixed,
  // `-C`) and resolve the tree it WRITES TO. The retired `/^git commit\b/`
  // matcher refused the careful path and waved the careless one through. Same
  // front door as the sibling gate-check hook, deliberately.
  const target = resolveCommitTargetFromPayload(payload);
  if (!target.isCommit) {
    process.exit(0);
  }

  /**
   * Every "could not tell" leg below: an NFR-10 `Reminder:`, then exit 1, not 0.
   * The harness shows no stderr on exit 0, so a Reminder there is a silent
   * allow; exit 1 is non-blocking and visible (AC-STE-601.7, AC-STE-601.16).
   */
  // A declaration, not an arrow: only a declared `never` narrows the caller.
  function remind(sentence: string, remedy: string): never {
    emitNFR10("Reminder", sentence, remedy, "dev-process-toolkit:tdd", "pre-commit-tdd-orchestrator");
    process.exit(1);
  }

  if (target.repoRoot === null) {
    // AC-STE-597.4 — ADVISORY, never a refusal, and it NAMES what it could not
    // determine. The same shape the STE-548 stack-unknown leg already uses: not
    // knowing where the commit lands is the toolkit's limitation, not the
    // operator's mistake.
    remind(
      `${target.unresolved}, so the /tdd guard could not tell whether this ` +
        `commit stages a source file and its test.`,
      "run the commit with a literal directory (for example `git -C " +
        "/path/to/repo commit`), or run /dev-process-toolkit:tdd yourself when " +
        "this commit carries an FR.",
    );
  }
  // Every git query and every layout lookup below is anchored HERE, not at the
  // hook process's cwd (AC-STE-597.2).
  const repoRoot = target.repoRoot;

  // AC-STE-601.8 — a merge, cherry-pick, revert, am or commit-tree writes a
  // commit whose content is NOT the staged set (only a `--continue` concludes
  // one from the index), so the staged-set classifier below cannot speak for
  // it. Say so, visibly, rather than grade the wrong subject.
  if (!target.fromIndex) {
    const sub = target.subcommand ?? "this git subcommand";
    remind(
      `\`git ${sub}\` writes a commit in ${repoRoot} from something other than ` +
        `the staged files, so the /tdd guard could not tell whether it carries ` +
        `a source file and its test.`,
      "run /dev-process-toolkit:tdd yourself when this commit carries an FR.",
    );
  }

  // Collect staged files via filesystem call (no $CLAUDE_STAGED_FILES env var).
  const stagedResult = await gitOut(["diff", "--cached", "--name-only"], repoRoot);
  if (stagedResult.spawnFailed) {
    // AC-STE-597.4 (FINDING B) — ADVISORY, never a refusal, and it NAMES what
    // could not be done. A toolchain the guard cannot run is the toolkit's
    // problem, not the operator's mistake, and a stack trace is not a sentence.
    remind(
      `\`git\` could not be run in ${repoRoot}, so the /tdd guard could not read ` +
        `the staged files and could not tell whether this commit stages a ` +
        `source file and its test.`,
      "check that `git` is on the PATH this hook runs with and that " +
        `${repoRoot} still exists, then commit again; or run ` +
        "/dev-process-toolkit:tdd yourself when this commit carries an FR.",
    );
  }
  const staged = stagedResult.stdout.split("\n").filter((l) => l.length > 0);

  // ONE resolution, reused below: the verdict and the STE-360 subtraction must
  // read the same stack, or a placeholder could be exempted under one layout
  // while the requirement was raised under another.
  const entry = resolveStackLayout(repoRoot);
  const verdict = classifyStagedPathsForEntry(staged, entry);
  if (verdict === "stack-unknown") {
    // STE-548 — ADVISORY, never a refusal (AC-STE-548.4). Not knowing the stack
    // is the toolkit's limitation, not the operator's mistake, so the commit
    // proceeds; the line names WHICH project so the reminder is actionable.
    //
    // That name MUST be the checkout root, never a cwd: `resolveStackLayout`
    // walked up to it, `git diff --cached` reported paths relative to it, and it
    // is the directory the remedy asks for a marker in. Naming a subdirectory
    // would tell the operator about the wrong project. Before STE-597 that took
    // a `git rev-parse --show-toplevel` round trip to recover from the cwd;
    // `target.repoRoot` now IS that root, so the lookup was deleted rather than
    // left to re-derive a value already in hand.
    remind(
      `no stack marker was identified for ${repoRoot}, so the /tdd guard ` +
        `could not tell whether this commit stages a source file and its test.`,
      "add a recognised stack marker at the project root (for example " +
        "`package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`), or run " +
        "/dev-process-toolkit:tdd yourself when this commit carries an FR.",
    );
  }
  if (verdict !== "tdd-required") {
    process.exit(0);
  }

  // STE-360 — subtract exempt placeholders from the tdd-required set. If
  // every path that triggered "tdd-required" is an exempt placeholder, the
  // commit passes without /tdd evidence; any remaining tdd-required path
  // (FR markdown, real test file) keeps the requirement in force.
  // `tdd-required` is unreachable with no entry resolved — the null case answers
  // `spec-only` or `stack-unknown` and has already exited above — so this is a
  // narrowing of a state the classifier has ruled out, not an unchecked guess.
  const { isTest } = predicatesFor(entry!);
  const required = staged.filter((p) => isTddRequiredPath(p, isTest, entry!));
  const exemptFlags = await Promise.all(required.map((p) => isExemptPlaceholder(p, repoRoot)));
  if (required.length > 0 && exemptFlags.every(Boolean)) {
    process.exit(0);
  }

  // STE-598 — EITHER door satisfies: the per-FR orchestrator's Skill tool_use,
  // or a red-before proof covering the very paths that raised the requirement.
  // `required` is that set, so a proof for some other file cannot open the door.
  // STE-614 AC.5 — `repoRoot` is non-null by here (the null leg reminded and
  // exited above), and it is the checkout the /tdd receipt has to name: an FE
  // /tdd run is not evidence about a commit aimed at BE.
  // STE-614 NF-2 — door two carries its own scope, because a proof is a line an
  // operator typed rather than a receipt a gate minted: nothing else places it.
  // Both roots are realpath'd through the SAME lookup the receipt store keys on
  // (`checkoutRootOf`), so a checkout reached through a symlink is one checkout
  // for the proof exactly as it is for the receipt. A target git cannot place
  // falls back to the resolved root rather than becoming `undefined` — an
  // absent scope would silently restore the session-wide reading this closes.
  const proofRoot = checkoutRootOf(repoRoot) ?? repoRoot;
  const sessionRoot = payload.cwd ? checkoutRootOf(payload.cwd) : null;

  const { found } = requireTddEvidence(
    "dev-process-toolkit:tdd",
    "pre-commit-tdd-orchestrator",
    payload,
    required,
    {
      // Door one's repository leg: the same composer the sibling gate-check
      // hook calls, so "which roots, and which vouching peers" is answered once
      // for both gates. This commit is PLACED by here — the unresolved leg
      // reminded and exited above — so it grades exactly `repoRoot`, with the
      // session's own checkout counted as a peer.
      ...gateEvidenceTarget("dev-process-toolkit:tdd", payload.session_id, {
        roots: [repoRoot],
        sessionRoot,
      }),
      proof: { targetRoot: proofRoot, sessionRoot },
    },
  );
  process.exit(found ? 0 : 2);
}
