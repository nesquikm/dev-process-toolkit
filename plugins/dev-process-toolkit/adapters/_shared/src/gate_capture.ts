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
import type { CapturedRun } from "./deliver_stage_evidence";
import { runGateNamingSkips } from "./gate_identity_run";
import type { Stack } from "./test_count_parser";

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
  const run = runGateNamingSkips(projectRoot, stack, command);
  const captured: CapturedRun = {
    command: command.join(" "),
    output: run.output,
    stack,
  };

  // The key is ABSENT — not present-and-undefined — for a stack that writes no
  // report, because `evaluateSkipDelta` branches on `undefined` meaning "said
  // nothing" and a spread of an explicit `undefined` would read the same only
  // by luck of the current implementation.
  if (run.identities === null) return captured;

  const skipNames: readonly string[] | null =
    run.identities.status === "named" ? run.identities.names : null;
  return { ...captured, skipNames };
}

// The command-line front door of the READ side, mirroring
// `capture_skip_baseline.ts` on the WRITE side. Imported by consumers wanting
// `captureGateRun`, `import.meta.main` is false and this block never runs, so
// the module stays side-effect-free at import. Usage:
//
//   bun run gate_capture.ts [projectRoot]
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
    const captured = captureGateRun(projectRoot, gate.stack, gate.command);
    const names = captured.skipNames;
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
