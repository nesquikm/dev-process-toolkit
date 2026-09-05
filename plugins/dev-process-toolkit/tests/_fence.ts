// Shared shell-fence extraction for tests that EXECUTE a driver skill's
// snippets instead of grepping the prose around them.
//
// Why this module exists. `specs/notes/follow-ups.md` § 0c(c) records the
// extract-and-execute-a-fence pattern accumulating private copies — the entry
// says the threshold is "extract when a third wants it" and reports the trigger
// "firing at 4/3". The real count when STE-453 measured it was FIVE, across
// three mutually-disagreeing grammars:
//
//   driver-gate-fail-open-guards.test.ts, m117-ste-428-report-issue-renderable.test.ts,
//   m121-ste-447-legs-selector.test.ts, m121-ste-448-mode-none-leg.test.ts,
//   m121-ste-452-termination-harness.test.ts
//
// STE-453 needed a sixth. Adding one to a list already past its own threshold
// is how that entry stops meaning anything, so the STE-452 definitions were
// lifted here VERBATIM and that file now imports them. The remaining three
// inline copies are recorded, not silently tolerated — see § 0c(c).
//
// The two grammars are BOTH kept, deliberately, because they answer different
// questions and conflating them has already produced a guard that watched the
// wrong door (m121-ste-452-termination-harness.test.ts § "exactly ONE fence
// carries STATUS=green" documents that review finding).

/**
 * Every ```bash fence body in the document, in document order.
 *
 * Use this to FETCH a fence you intend to run: the driver's executable
 * snippets are bash-tagged, and running a ```text block would be a category
 * error.
 */
export function bashFences(body: string): string[] {
  return [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

/**
 * Every column-0 fence body whatever its language tag.
 *
 * Use this to COUNT carriers of a marker that a derivation surface locates by
 * first match. Those surfaces scan the whole document, so a decoy in a plain or
 * ```text fence re-points them just as effectively as a bash one — and a
 * uniqueness guard written with `bashFences` would report all-clear while it
 * happened.
 */
export function anyFences(body: string): string[] {
  return [...body.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
}

/**
 * Locate a fence by a marker in its body.
 *
 * Markers are the STATUS the fence assigns or the variable it owns — never a
 * leg name. Slicing on a leg would reinstate exactly the technique STE-446
 * retired and would stop finding the fence the day a leg is renamed.
 */
export function fenceContaining(body: string, marker: string): string {
  return bashFences(body).find((f) => f.includes(marker)) ?? "";
}

/**
 * Apply a textual mutation to an extracted fence and THROW if it did not apply.
 *
 * `specs/notes/follow-ups.md` § 0b: a mutation that silently no-ops is
 * indistinguishable from a fix that does nothing, and the natural reading of
 * "both runs printed the same thing" is *my change made no difference* rather
 * than *my mutation missed*. Every witness routed through here turns a regex
 * that stopped matching into a loud error instead of a green test asserting
 * that a guard it never removed still works.
 */
export function mutate(fence: string, pattern: RegExp | string, replacement: string): string {
  const out = fence.replace(pattern as RegExp, replacement);
  if (out === fence) {
    throw new Error(
      `mutation did not apply: ${String(pattern)} matched nothing in the extracted fence`,
    );
  }
  return out;
}

// ===========================================================================
// STE-565 — executing a fence under the shell an agent actually uses.
// ===========================================================================

/**
 * The shells a driver fence must agree under.
 *
 * `bash` is the shell the fences are LABELLED with; `zsh` is the shell an
 * agent's Bash tool actually runs on macOS. The whole STE-565 finding is that
 * those are different and only the first was ever tested: the leg-accounting
 * guard used `$(set -- ${VAR}; echo $#)`, which needs POSIX field splitting,
 * and zsh does not split unquoted expansions. A completed two-leg run was
 * aborted at its final gate while the suite stayed green, because the suite
 * ran the fence under the one shell where the bug is invisible.
 */
export const FENCE_SHELLS = ["bash", "zsh"] as const;

export type FenceShell = (typeof FENCE_SHELLS)[number];

/** Result of running a fence under one shell. */
export interface FenceRun {
  shell: FenceShell;
  status: number;
  stdout: string;
  stderr: string;
}

const shellAvailability = new Map<string, boolean>();

/**
 * Is `shell` on PATH?
 *
 * A missing shell must SKIP with a reason, never silently degrade to
 * bash-only — quietly running fewer shells than advertised is the exact shape
 * that produced this finding.
 */
export function shellAvailable(shell: string): boolean {
  const cached = shellAvailability.get(shell);
  if (cached !== undefined) return cached;
  // `Bun.spawnSync` THROWS on a missing executable rather than returning a
  // non-zero status, so absence has to be caught. A throw here would crash the
  // suite on a machine that simply has one fewer shell — which is the opposite
  // of the "skip with a reason" this function exists to provide.
  let ok = false;
  try {
    ok = Bun.spawnSync([shell, "-c", "exit 0"], { stderr: "pipe", stdout: "pipe" }).exitCode === 0;
  } catch {
    ok = false;
  }
  shellAvailability.set(shell, ok);
  return ok;
}

/** The shells actually present, in `FENCE_SHELLS` order. */
export function availableFenceShells(): FenceShell[] {
  return FENCE_SHELLS.filter((s) => shellAvailable(s));
}

/**
 * Run a script under one named shell.
 *
 * The shell travels into the result so a failing assertion can say WHICH
 * interpreter disagreed — the single most useful fact about a defect of this
 * class, and the one a bash-only runner can never report.
 */
export function runInShell(
  shell: FenceShell,
  script: string,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): FenceRun {
  const proc = Bun.spawnSync([shell, "-c", script], {
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  return {
    shell,
    status: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  };
}

/**
 * Run a script under EVERY available shell and return one result each.
 *
 * Callers assert over the whole array rather than over one entry, so a fence
 * that behaves differently between shells reds instead of passing on whichever
 * one happened to run first.
 */
export function runInEveryShell(
  script: string,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): FenceRun[] {
  return availableFenceShells().map((shell) => runInShell(shell, script, opts));
}
