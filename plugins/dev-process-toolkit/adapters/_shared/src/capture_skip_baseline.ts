// capture_skip_baseline — the command-line front door of the skip ratchet's
// WRITE side.
//
// AC-STE-530.5 is why this module exists in this shape. The refusal a reader
// meets when no baseline stands ends on a command, and that command is asserted
// by being RUN in a throwaway project and having its record read back off disk,
// not by matching its text. A command naming a wrong path, a wrong flag, or a
// flag that does not exist reads identically to a correct one under a substring
// match, so the only assertion worth making is execution — and execution needs
// something to execute.
//
// Two rules hold here, and both exist because the number this milestone was
// opened over was typed by a human at a terminal:
//
//   1. NO ARGV POSITION CARRIES A COUNT. The count is derived here, from a gate
//      command this module runs itself, parsed through the shipped
//      `parseTestOutput`. A capture that can be handed a number will eventually
//      be handed the wrong one, and the store cannot tell the two apart
//      afterwards.
//   2. A REFUSAL IS LOUD AND WRITES NOTHING. Every path that cannot produce a
//      measurement says which precondition failed on stderr and exits non-zero.
//      A capture that reports success while writing nothing is the failure mode
//      the ratchet exists to detect; it must not be able to satisfy its own
//      test.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { runGateNamingSkips } from "./gate_identity_run";
import { captureSkipBaseline, resolveTrunkSha, type CaptureResult } from "./skip_baseline";
import { skipNamesSource } from "./skip_identities";
import { STACK_LAYOUTS, type GateInvocation } from "./stack_layout";
import { parseTestOutput, type Stack } from "./test_count_parser";

// STE-547: the marker → runner mapping this module used to keep privately is now
// one half of the ONE table in `stack_layout.ts`, whose other half is the path
// layout the pre-commit classifier reads. There is no second copy: an entry this
// repo can parse no count out of (Kotlin, Go) carries `gate: null` and is a
// recognised LAYOUT the scan below steps PAST — never a stop that turns a
// gate-carrying project's answer into `null`.
export type { GateInvocation };

/** The gate to run in `projectRoot`, or `null` when no gated marker is found. */
export function detectGate(projectRoot: string): GateInvocation | null {
  for (const entry of STACK_LAYOUTS) {
    if (entry.gate === null) continue;
    if (existsSync(join(projectRoot, entry.marker))) {
      // Rebuilt rather than returned by reference so this function's contract —
      // exactly `{ stack, command }` — cannot drift with the table's entry shape.
      return { stack: entry.gate.stack, command: entry.gate.command };
    }
  }
  return null;
}

/** The checked-out branch of `projectRoot`, or `null` when git cannot say. */
export function currentBranch(projectRoot: string): string | null {
  const proc = Bun.spawnSync(["git", "-C", projectRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  const name = proc.stdout.toString().trim();
  return name.length === 0 ? null : name;
}

/** What one capture run observed and what it did about it. */
export interface CaptureRun {
  readonly branch: string;
  /** The trunk commit the baseline is keyed by (STE-527). */
  readonly sha: string;
  readonly stack: Stack;
  readonly gate: string;
  readonly skipped: number;
  readonly result: CaptureResult;
}

/**
 * Measure `projectRoot`'s skip count and record it as the branch's baseline.
 *
 * Throws on every precondition that cannot be met — a missing root, a tree git
 * cannot name a branch for, an unrecognised runner, or output no counter could
 * be read out of. Nothing is written on any of those paths.
 */
export function runCapture(projectRoot: string): CaptureRun {
  if (!existsSync(projectRoot)) {
    throw new Error(`no such project root: ${projectRoot}`);
  }

  const branch = currentBranch(projectRoot);
  if (branch === null) {
    throw new Error(`${projectRoot} is not a git checkout git can name a branch for`);
  }

  // The store is keyed by the TRUNK COMMIT, never by the branch name
  // (AC-STE-527.1): the sha is resolved here rather than accepted, for the same
  // reason no argv position carries a count.
  const sha = resolveTrunkSha(projectRoot);
  if (sha === null) {
    throw new Error(`${projectRoot} carries no protected trunk to measure a baseline against`);
  }

  const gate = detectGate(projectRoot);
  if (gate === null) {
    const markers = STACK_LAYOUTS.filter((entry) => entry.gate !== null)
      .map((entry) => entry.marker)
      .join(", ");
    throw new Error(`no test runner detected in ${projectRoot} — looked for ${markers}`);
  }

  // ONE RUN, BOTH SIGNALS (AC-STE-529.1), and THE REPORT IS WRITTEN OUTSIDE THE
  // PROJECT TREE (AC-STE-529.10) — both rules live in `runGateNamingSkips`,
  // shared with the ratchet's READ side rather than written out a second time
  // here. They matter to this caller for two specific reasons: the gate that is
  // actually executed still prints the summary `parseTestOutput` reads below,
  // and `captureSkipBaseline` refuses a dirty tree (AC-STE-527.2), so a report
  // dropped inside the project would make the capture refuse on its own artifact.
  const run = runGateNamingSkips(projectRoot, gate.stack, gate.command);

  // `unavailable` stays ABSENT rather than becoming an empty set: an unreadable
  // report — like a runner with no report at all — is not evidence that nothing
  // was skipped.
  const identityNames: readonly string[] | undefined =
    run.identities !== null && run.identities.status === "named" ? run.identities.names : undefined;

  const parsed = parseTestOutput(run.output, gate.stack);
  if (!parsed.ok) {
    throw new Error(`${gate.command.join(" ")} produced no readable count — ${parsed.reason}`);
  }

  return {
    branch,
    sha,
    stack: gate.stack,
    gate: gate.command.join(" "),
    skipped: parsed.count.skipped,
    // `namesSource` is written whether or not names were obtained — the degrade
    // is a fact in the record (AC-STE-529.8), not a missing key.
    result: captureSkipBaseline(projectRoot, sha, parsed.count.skipped, {
      names: identityNames,
      namesSource: skipNamesSource(gate.stack),
    }),
  };
}

// Read-only-to-the-operator CLI, mirroring `deliver_decision.ts`: imported by
// tests and by consumers wanting `runCapture`, `import.meta.main` is false and
// this block never runs, so the module is side-effect-free at import. Usage:
//
//   bun run capture_skip_baseline.ts [projectRoot]
//
// `projectRoot` defaults to `process.cwd()`. There is deliberately no count
// positional — see rule 1 at the top of this file.
if (import.meta.main) {
  const projectRoot = resolve(process.argv[2] ?? process.cwd());
  try {
    const run = runCapture(projectRoot);
    const verb = run.result.written ? "captured" : "already recorded";
    console.log(
      `skip baseline ${verb} for ${run.sha}: ${run.result.record.skipped} skip(s) ` +
        `via \`${run.gate}\` (${run.stack})`,
    );
  } catch (error) {
    console.error(`capture_skip_baseline: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
