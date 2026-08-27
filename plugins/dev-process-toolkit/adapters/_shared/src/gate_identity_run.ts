// gate_identity_run — run a project's gate ONCE and come back with both of the
// signals the skip ratchet needs: the bytes a counter can be parsed out of, and
// the identities of the skips that run reported.
//
// WHY THIS IS ONE MODULE AND NOT TWO COPIES. The ratchet has two halves, and
// they must observe the world the same way or they are not comparing like with
// like. `capture_skip_baseline` (the WRITE side) records a branch's baseline;
// `gate_capture` (the READ side) measures the run being evidenced right now.
// Both need the same three rules to hold, and each rule is a place a hand-copied
// second implementation can drift:
//
//   1. ONE RUN, BOTH SIGNALS. Where the stack's runner can name its skips, the
//      command actually executed is `skipIdentityCommand`'s invocation: the
//      machine-readable report goes to a file and the human summary still goes
//      to the console, so the counts a caller parses and the identities it
//      compares come from ONE measurement. Two runs could disagree, and the
//      ratchet would have no way to say which one it ratcheted against.
//   2. THE REPORT IS WRITTEN OUTSIDE THE PROJECT TREE. A report dropped inside
//      the project dirties the tree, and a dirty tree is precisely what the
//      capture side refuses on (AC-STE-527.2). The path is composed HERE, in
//      the caller's layer, and handed to both halves of `skip_identities`
//      (AC-STE-529.10) — those two ask nobody where the report lives.
//   3. UNAVAILABLE IS NOT EMPTY, and NEITHER IS SILENT. Three states leave this
//      module and all three are distinct: `null` for a stack whose runner has
//      no report at all ("this run says nothing about identities"), `named` for
//      a report that was read (an EMPTY name list is a real answer — nothing
//      was skipped), and `unavailable` for a stack that has a report which
//      could not be read ("this run states it could not name its skips").
//      Collapsing any pair of those is a fail-open: the last-into-the-first
//      reports every skip in the tree as newly introduced, and the
//      first-into-the-last silently downgrades a readable-report stack to a
//      count comparison while saying nothing about the downgrade.
//
// Callers map those three states into their own record shapes. What they do NOT
// do is decide them a second time.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractSkipIdentities,
  skipIdentityCommand,
  type SkipIdentities,
} from "./skip_identities";

/** What one gate run observed. */
export interface GateRunObservation {
  /**
   * stdout and stderr together: bun writes its summary to stderr, pytest to
   * stdout, and a gate that half-failed still carries the counters a parser
   * reads. One string, so no caller has to remember which stream to look in.
   */
  readonly output: string;
  /**
   * `null` — this stack's runner writes no machine-readable report, so the run
   * says NOTHING about identities and the caller keeps whatever count-shaped
   * path it took before identities existed. Otherwise the extractor's own
   * verdict, `named` or `unavailable`, forwarded without interpretation.
   */
  readonly identities: SkipIdentities | null;
}

/**
 * Run `command` in `projectRoot` and report what the run said.
 *
 * `stack` is typed as a plain string to match `skipIdentityCommand`'s own
 * signature: this module asks that table whether the runner can name its skips
 * and has no opinion of its own about which stacks exist, so it needs no import
 * of the stack vocabulary to stay correct when that vocabulary grows.
 */
export function runGateNamingSkips(
  projectRoot: string,
  stack: string,
  command: readonly string[],
): GateRunObservation {
  const reportDir = mkdtempSync(join(tmpdir(), "dpt-gate-report-"));
  const reportPath = join(reportDir, "junit.xml");
  const identityCommand = skipIdentityCommand(stack, reportPath);

  try {
    // ONE spawn, one options object. The branch is over WHAT is run — the
    // runner's own argv, or a shell asked to run the identity invocation — and
    // never over how it is run: a second options literal is a second place the
    // cwd or a captured stream can be forgotten, and a gate run in the wrong
    // directory measures another project's skips.
    const argv = identityCommand === null ? [...command] : ["/bin/sh", "-c", identityCommand];
    const proc = Bun.spawnSync(argv, { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
    const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;

    if (identityCommand === null) return { output, identities: null };
    return { output, identities: extractSkipIdentities(reportPath) };
  } finally {
    // The report directory is this module's alone, and it goes whether the run
    // succeeded, failed, or threw — a leaked temp tree per gate run is how a
    // long-lived session fills a disk.
    rmSync(reportDir, { recursive: true, force: true });
  }
}
