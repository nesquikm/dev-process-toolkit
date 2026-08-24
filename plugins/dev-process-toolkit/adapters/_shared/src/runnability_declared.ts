// runnability_declared (M131) — /gate-check probe #80.
// Severity: error.
//
// The enforcement half of `./detect_runnability`. The detector answers "does
// this repo document how to run itself?"; this probe turns that answer into a
// question the author must actually answer: if run instructions ARE
// discoverable, `## Verification` must declare `run_cmd:` — with the literal
// `none` ("this project cannot be run") a fully legitimate answer.
//
// THE DESIGN CONSTRAINT IS RESTRAINT. A probe that reds a library repo trains
// the author to type `run_cmd: none` without reading the question, and a
// contract everyone silences is worse than no contract because it looks like
// coverage. So the probe is SILENT in three separate ways:
//
//   * silent when detection did not fire — a repo carrying no run instructions
//     is never asked, whatever `run_cmd` says (or does not say);
//   * silent the moment the author has answered — a real command AND `none`
//     both count, because `none` is an answer and an absent key is not; a bare
//     `run_cmd:` with an empty value is an omission wearing a declaration's
//     clothes, and is treated exactly as the absent key;
//   * vacuous on a tree the toolkit does not own — a hand-written CLAUDE.md
//     must never be nagged about a key it has never heard of.
//
// Selection  — toolkit-managed trees only, decided by the shared predicate in
//              `./toolkit_managed` (probe #74's route). This module's
//              applicability genuinely IS a managed-ness question: the key it
//              demands is a toolkit key.
// Fires when — `detectRunnability` reports at least one source AND
//              `readVerificationConfig` reports no `run_cmd` ANSWER: the key
//              absent (`null`), or present with an empty/whitespace-only value.
// Vacuous    — the tree carries no toolkit-managed signal (no CLAUDE.md at
//              all, or a hand-written one).
//
// SHARED READERS, NEVER A PRIVATE COPY. Detection comes from
// `detectRunnability`, whose closed, exact-match source rules are the whole
// anti-over-eagerness design and must not be re-derived here. Everything about
// the `## Verification` section comes from `./verification_config`: the declared
// value from `readVerificationConfig` (which knows a `run_cmd:` line outside the
// section is not a declaration — a bare grep would not, and would silence the
// probe on exactly that tree), the section's position from
// `verificationSectionLine`, and the heading text quoted in the remedy from
// `VERIFICATION_HEADING`. This module parses no part of the section itself; it
// decides only what to do with the answers — including the fallback line when
// there is no section yet.
//
// ONE violation, not one per fired source: the author has one omission to fix,
// and the message names EVERY source that fired with its concrete evidence so
// the fix takes one step rather than one round-trip per source.
//
// PURE. No git, no network, no child processes, no writes. Every read is
// synchronous and the body awaits nothing — the `async` keyword is the
// `run*Probe` signature convention shared with the other probes, not
// concurrency (same note as `./toolkit_managed`).
//
// NEVER THROWS: a malformed `## Verification` block surfaces as a verdict (the
// key reads as undeclared), because a crashed gate is strictly worse than a
// failed one.

import { join, relative } from "node:path";
import { detectRunnability } from "./detect_runnability";
import { isToolkitManaged } from "./toolkit_managed";
import {
  VERIFICATION_HEADING,
  isRunCmdAnswered,
  readVerificationConfig,
  verificationSectionLine,
} from "./verification_config";

export const PROBE_ID = "runnability_declared";

export type Severity = "error";

export interface RunnabilityDeclaredViolation {
  file: string;
  line: number;
  severity: Severity;
  reason: string;
  note: string;
  message: string;
}

export interface RunnabilityDeclaredReport {
  violations: RunnabilityDeclaredViolation[];
  vacuous: boolean;
}

/**
 * True when `## Verification` carries an ANSWER for `run_cmd`.
 *
 * Three states, two verdicts. `readVerificationConfig` reports the value as
 * WRITTEN — that is its contract and this module does not change it — so a
 * bare `run_cmd:` arrives here as the empty string, distinct from the absent
 * key's `null`. Both are the same verdict: no answer.
 *
 * An empty value is a CHEAPER reflex-silence than `none` — the author deletes
 * four characters, detection still fires, and the gate goes quiet — which is
 * exactly the "contract everyone silences" failure this probe exists to
 * prevent, reached without even reading the question. `none` is an answer
 * ("this project cannot be run"); an empty line is an omission that merely
 * looks like one, so the probe treats it as the absent key.
 *
 * A malformed `## Verification` block (out-of-set key, bad `verify_mode`) reads
 * as UNDECLARED rather than propagating: the operator gets this probe's verdict
 * plus the malformed-config probe's, never a crashed gate run.
 *
 * The verdict itself is `isRunCmdAnswered` from the section's own module — the
 * SAME predicate `resolveVerifyMode` decides a mandatory drive with. This probe
 * owns only what an unanswered key MEANS here (a violation), never what counts
 * as an answer: a second opinion on that is how `run_cmd: None` came to silence
 * this probe while mandating a drive of a command named "None".
 */
function hasRunCmdAnswer(claudeMdPath: string): boolean {
  try {
    return isRunCmdAnswered(readVerificationConfig(claudeMdPath).runCmd);
  } catch {
    return false;
  }
}

/**
 * Report whether `projectRoot` owes a `run_cmd` declaration it has not made.
 *
 * @param projectRoot absolute path to the consumer project root
 */
export async function runRunnabilityDeclaredProbe(
  projectRoot: string,
): Promise<RunnabilityDeclaredReport> {
  if (!isToolkitManaged(projectRoot)) return { violations: [], vacuous: true };

  const { sources } = detectRunnability(projectRoot);
  if (sources.length === 0) return { violations: [], vacuous: false };

  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (hasRunCmdAnswer(claudeMd)) return { violations: [], vacuous: false };

  const rel = relative(projectRoot, claudeMd);
  // Point at the block the author must edit; with no block yet, the file
  // itself. The heading's position comes from the section's own module — this
  // probe decides only the no-section FALLBACK, never where a section is.
  const line = verificationSectionLine(claudeMd) ?? 1;
  // Evidence, not merely the source id: "declare run_cmd" teaches nothing,
  // while "package.json declares a `dev` script" lets the author answer in one
  // step. Every fired source is named — a message quoting only the first would
  // send an author with two sources back for a second look.
  const fired = sources.map((s) => `${s.source} (${s.evidence})`).join("; ");
  const reason =
    `run instructions are discoverable but \`run_cmd\` is undeclared — fired: ${fired}`;
  const note = `${rel}:${line} — ${reason}`;
  const message = [
    `${PROBE_ID}: ${note}`,
    `Remedy: add a \`run_cmd:\` line to the \`${VERIFICATION_HEADING}\` section of ${rel} ` +
      "naming the command that starts this project (e.g. `run_cmd: bun run dev`). " +
      "If the project genuinely cannot be run — a library, a plugin, a spec repo — " +
      "write `run_cmd: none`: `none` is an answer, and it silences this probe " +
      "exactly as a real command does. Do not silence it by deleting the run " +
      "instructions the sources above found.",
    `Context: file=${rel}, line=${line}, sources=${sources.map((s) => s.source).join(",")}, ` +
      `probe=${PROBE_ID}, severity=error`,
  ].join("\n");

  return {
    violations: [{ file: claudeMd, line, severity: "error", reason, note, message }],
    vacuous: false,
  };
}
