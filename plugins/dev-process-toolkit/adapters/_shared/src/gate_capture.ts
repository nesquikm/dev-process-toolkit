// gate_capture — the READ side of the skip ratchet.
//
// THE GAP THIS CLOSES. `deliver_stage_evidence` declares `skipNames` on
// `CapturedRun` and forwards it verbatim to `evaluateSkipDelta`, and until this
// module nothing in the tree supplied it. A field that is declared, threaded
// and fed by nothing is not a feature: every real run took the two-argument
// lookup and compared skips BY COUNT ALONE, so a change that silenced one test
// while un-silencing another read as a clean pass — the exact comparison the
// identity work exists to replace.
//
// The WRITE side (`capture_skip_baseline`) already names the skips it records.
// This is the other half: the identities of the run being evidenced RIGHT NOW,
// handed to the renderer in the same object as the bytes they came from.
//
// HOW THE RUN IS MADE is not decided here. Both halves of the ratchet run their
// gate through `runGateNamingSkips` in `gate_identity_run.ts`, which owns the
// three rules that make a measurement usable — one run for both signals, a
// report written outside the project tree, and `unavailable` kept distinct from
// empty. Two hand-copied implementations of those rules would be two things to
// keep in step, and the half that fell behind would still look like it worked.
// What this module owns is the MAPPING of that observation onto the record the
// evidence renderer takes, and the three states survive the mapping intact:
//
//   * key ABSENT — the runner writes no report; "this caller says nothing about
//     identities", and the byte-for-byte two-argument lookup every pre-existing
//     caller takes is what happens.
//   * `null` — the runner has a report and it could not be read; "this run
//     states it could not name its skips".
//   * an array — the report was read. EMPTY is a real answer: nothing skipped.
//
// Folding the second into the third would report every skip in the tree as
// newly introduced; folding it into the first would silently downgrade a
// readable-report stack to a count-only comparison and say nothing.

import { resolve } from "node:path";

import { detectGate } from "./capture_skip_baseline";
import { deriveRunCounts, type CapturedRun } from "./deliver_stage_evidence";
import { runGateNamingSkips } from "./gate_identity_run";
import type { Stack } from "./test_count_parser";

/**
 * The one totals line the front door prints, read from the SAME run's output
 * through `deriveRunCounts` — the derivation the evidence fence rows use, so
 * the two surfaces cannot disagree about what `pass` means on a stack. An
 * unparseable output states the parser's reason and never a number — a
 * guessed count is worse than none.
 */
export function renderTotalsLine(run: Pick<CapturedRun, "output" | "stack">): string {
  const counts = deriveRunCounts(run);
  if (!counts.ok) return `gate_capture: totals unreadable — ${counts.reason}`;
  return `gate_capture: pass ${counts.pass}, fail ${counts.fail}, skip ${counts.skip}`;
}

/**
 * Run `command` in `projectRoot` and return the capture the evidence renderer
 * takes — the bytes, the stack, and, where the runner can produce them, the
 * identities of the skips this run reported.
 *
 * The returned `command` is the gate as the operator wrote it, never the
 * identity invocation the run may have substituted for it: the evidence row
 * names the gate, and a reader who copies that row must get the gate back.
 */
export function captureGateRun(
  projectRoot: string,
  stack: Stack,
  command: readonly string[],
): CapturedRun {
  return captureGateRunNamingFailures(projectRoot, stack, command).captured;
}

/**
 * The front door's killed-on-the-bound line (AC-STE-686.9): a run that
 * outlived its bound is SAID to have been killed, naming the bound, so a short
 * capture is never read as merely an unreadable report.
 */
export function renderKilledLine(killedOnBoundMs: number | null): string[] {
  if (killedOnBoundMs === null) return [];
  return [
    `gate_capture: the gate run was killed on its ${killedOnBoundMs} ms bound (DPT_GATE_TIMEOUT_MS) — ` +
      `SIGTERM, then SIGKILL; its output and report are partial`,
  ];
}

/**
 * The front door's failing-test lines (AC-STE-686.8): one per failing test,
 * or, on a stack that writes a report, one line saying the report could not
 * be read, so a red run is never silent about why nothing is named.
 */
export function renderFailingLines(
  failingNames: readonly string[] | null,
  writesReport: boolean,
): string[] {
  if (failingNames !== null) return failingNames.map((name) => `gate_capture: failing — ${name}`);
  return writesReport ? ["gate_capture: failing tests cannot be named — this run's report could not be read"] : [];
}

/**
 * `captureGateRun`, plus the identities of the tests that FAILED in the same
 * run (AC-STE-686.8) — read from that run's own report before it is removed,
 * so a red gate can be diagnosed from its capture without a re-run. `null`
 * when the run produced no readable report to name them from.
 */
export function captureGateRunNamingFailures(
  projectRoot: string,
  stack: Stack,
  command: readonly string[],
): {
  readonly captured: CapturedRun;
  readonly failingNames: readonly string[] | null;
  /** The bound the run was killed on (AC-STE-686.9), or `null` when it finished. */
  readonly killedOnBoundMs: number | null;
} {
  const run = runGateNamingSkips(projectRoot, stack, command);
  const captured: CapturedRun = {
    command: command.join(" "),
    output: run.output,
    stack,
  };
  const failingNames = run.failures?.status === "named" ? run.failures.names : null;
  const killedOnBoundMs = run.killedOnBoundMs ?? null;

  // The key is ABSENT — not present-and-undefined — for a stack that writes no
  // report, because `evaluateSkipDelta` branches on `undefined` meaning "said
  // nothing" and a spread of an explicit `undefined` would read the same only
  // by luck of the current implementation.
  if (run.identities === null) return { captured, failingNames, killedOnBoundMs };

  const skipNames: readonly string[] | null =
    run.identities.status === "named" ? run.identities.names : null;
  return { captured: { ...captured, skipNames }, failingNames, killedOnBoundMs };
}

// The command-line front door of the READ side, mirroring
// `capture_skip_baseline.ts` on the WRITE side. Imported by consumers wanting
// `captureGateRun`, `import.meta.main` is false and this block never runs, so
// the module stays side-effect-free at import. Usage:
//
//   bun run gate_capture.ts [projectRoot]
//
// It prints ONE totals line first (`renderTotalsLine`, AC-STE-662.6), then, for
// a run killed on its bound, one line saying so and naming the bound
// (AC-STE-686.9), then one line per failing test (AC-STE-686.8), then the
// skip-identity verdict. The totals, the killed line and the failing lines
// never move the exit code — only the identity report does (AC-STE-662.7).
//
// WHY IT EXISTS. Without it nothing in the tree could execute this module: it
// carries no entry point and nothing carrying one imports it, which is exactly
// the unreachable-order class /gate-check probe #81 exists to catch — the gap
// this module was written to close, reproduced inside the fix. It also gives
// the surfaces that ORDER the skip identities something a reader can copy: the
// order is a runnable command that hands the names back, not a module name.
//
// The gate is DETECTED, never accepted from argv, for the same reason the WRITE
// side derives its count instead of taking one — a caller that can be handed a
// command can be handed the wrong one, and the identities would then belong to
// a run nobody ratcheted against. `detectGate` is reused rather than re-copied
// so both halves recognise the same stacks.
if (import.meta.main) {
  const projectRoot = resolve(process.argv[2] ?? process.cwd());
  const gate = detectGate(projectRoot);
  if (gate === null) {
    console.error(`gate_capture: no test runner detected in ${projectRoot}`);
    process.exitCode = 1;
  } else {
    const { captured, failingNames, killedOnBoundMs } = captureGateRunNamingFailures(
      projectRoot,
      gate.stack,
      gate.command,
    );
    const names = captured.skipNames;
    // Totals first, from this run's own bytes — the count and the names are
    // separate facts, so it prints whatever happened to the report.
    console.log(renderTotalsLine(captured));
    // A run killed on its bound says so, naming the bound (AC-STE-686.9).
    for (const line of renderKilledLine(killedOnBoundMs)) console.log(line);
    // Then every failing test, one line each, in the skip lines' shape
    // (AC-STE-686.8). Passing tests are never named.
    for (const line of renderFailingLines(failingNames, names !== undefined)) console.log(line);
    if (names === undefined) {
      // ABSENT, and said out loud: this runner writes no machine-readable
      // report, so the run says nothing about identities. Silence here would be
      // indistinguishable from "nothing was skipped".
      console.log(
        `gate_capture: \`${captured.command}\` (${gate.stack}) names no skips — ` +
          `this runner writes no machine-readable report`,
      );
    } else if (names === null) {
      console.log(
        `gate_capture: \`${captured.command}\` (${gate.stack}) could not name its skips — ` +
          `the report was missing, unreadable, or not a report`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `gate_capture: ${names.length} skip(s) named by \`${captured.command}\` (${gate.stack})`,
      );
      for (const name of names) console.log(`  ${name}`);
    }
  }
}
