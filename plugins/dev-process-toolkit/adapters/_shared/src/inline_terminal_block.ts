// inline_terminal_block (STE-550) — a stage that is being DRIVEN does not close
// with a terminal report.
//
// THE DEFECT, measured on this tree. Eleven adopting stages (`ADOPTING_STAGES`)
// each close with exactly one `stage-status-block` fence, mandated as the LAST
// thing in the report with nothing permitted after it. Under a fork that rule
// costs nothing — ending the turn is how a fork hands control back to its
// orchestrator. Run INLINE as a step of `/deliver`'s Phase 1 / Phase 2 the very
// same rule ends the whole run: the block is the last thing in the report, so
// the turn is over, so the operator has to type again before Phase 2 starts and
// again before Phase 3 spawns. And the escape a reader reaches for first —
// "then emit both phases' blocks in one turn" — is refused by the shipped
// grader, which accepts exactly one block per report. A rule that is correct
// for the forked case and fatal for the inline case is not a rule with an
// exception; it is a rule that was never told which case it is in.
//
// WHY THIS SHAPE. The missing fact is the one STE-549 minted: whether an
// orchestrator is driving this stage. So the whole of the decision is a single
// question asked of the invocation body, and this module is the place that asks
// it on behalf of a report renderer. Three properties are load-bearing:
//
//   * ONE READER OF THE LITERAL. `terminalBlockSuppressed` delegates to
//     `isDrivenRun` and never greps `DRIVEN_MARKER` itself. A second reader
//     spelled out here would agree today and stop agreeing the day the literal
//     moves — precisely the drift STE-549's one-owner indirection exists to
//     prevent. The delegation is asserted behaviourally, over a matrix, not by
//     reading this comment.
//   * THE STANDALONE PATH IS BYTE-IDENTICAL. `stageReportFor` returns its input
//     unchanged when the signal is absent. Not "equivalent", not "regenerated
//     from the same sections" — the same bytes. Anything weaker turns a fix
//     about the DRIVEN path into a silent rewrite of the ten thousand reports
//     that were already correct, and the grader in `stage_status_block.ts`
//     would then be grading this module's renderer rather than the stage's.
//   * SUPPRESSION IS A DELETION, NOT A RELAXATION. The driven report carries
//     ZERO fences, which is a different case from the two-fence report the
//     one-per-report rule refuses. Nothing here widens that rule: a report with
//     two blocks is refused before and after this module exists, and this FR
//     cannot be satisfied by loosening the count.
//
// AUTHORIZES NOTHING, exactly as the signal it reads authorizes nothing. Losing
// the closing block loses a summary; it does not skip a gate, approve a commit,
// or silence an approval prompt. That is why a forged marker is uninteresting
// here — a user who pastes the literal into their own prompt has asked for a
// shorter report and gets one.
//
// The rendering half is pure (report TEXT in, report TEXT out — a path would
// grade the path). The scanner half reads SKILL.md bodies off disk and does
// nothing else: no git, no network, no child processes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isDrivenRun } from "./driven_run_signal";
import { ADOPTING_STAGES, type AdoptingStage } from "./stage_block_adoption";
import { closedStatusFences } from "./stage_status_block";

// ---------------------------------------------------------------------------
// The runtime half (AC-STE-550.1 / AC-STE-550.2)
// ---------------------------------------------------------------------------

/**
 * Is the terminal status block suppressed for this invocation?
 *
 * THE ONE JOB OF THIS FUNCTION IS TO NOT BE A SECOND PREDICATE. It exists to
 * give the renderer a name for what it is asking — "should I stay silent?" is
 * a different question from "am I driven?", even though today's answer is the
 * same byte — while keeping the literal's owner at exactly one. Should the two
 * questions ever come apart, they come apart HERE, in a function whose
 * disagreement with `isDrivenRun` would be deliberate and visible, rather than
 * in a grep at a call site that nobody remembers writing.
 */
export function terminalBlockSuppressed(promptBody: string): boolean {
  return isDrivenRun(promptBody);
}

/**
 * Every closed status fence removed from `report`, opener and closer included.
 *
 * The fence WALK is `closedStatusFences` — the banner's owner owns the walk
 * over it, and a private second expression here is how two readers come to
 * disagree about what a block IS. Spans are removed back to front so an earlier
 * removal cannot shift a later span's 1-based line numbers out from under it,
 * and trailing blank lines left behind by the deletion go with it: the block
 * was the last thing in the report, so what it leaves behind is whitespace at
 * the end of a turn, not a paragraph break.
 */
function stripStatusFences(report: string): string {
  const fences = closedStatusFences(report);
  if (fences.length === 0) return report;
  const lines = report.split("\n");
  for (const fence of [...fences].sort((a, b) => b.startLine - a.startLine)) {
    lines.splice(fence.startLine - 1, fence.endLine - fence.startLine + 1);
  }
  return lines.join("\n").replace(/\n+$/, "");
}

/**
 * THE report a stage actually emits, given the report it would emit standalone
 * and the body it was invoked with.
 *
 * Two paths, and their asymmetry is the criterion:
 *
 *   * STANDALONE — the input, byte for byte. The block stays where the eleven
 *     stages' shipped contracts put it, positioned and bounded exactly as
 *     today, and the turn ends as it always has.
 *   * DRIVEN — the same report with the block deleted. Zero fences, so nothing
 *     in the emitted text tells the reader (or the grader) that the turn is
 *     over, and the orchestrator's next step runs inside the same turn.
 *
 * Taking the STANDALONE report as an argument rather than the sections to
 * render it from is deliberate: this module must never become a second renderer
 * of the block. It is a filter over the one the stage already produced.
 */
export function stageReportFor(
  standaloneReport: string,
  promptBody: string,
): string {
  const report = String(standaloneReport ?? "");
  return terminalBlockSuppressed(promptBody) ? stripStatusFences(report) : report;
}

// ---------------------------------------------------------------------------
// The authoring half (AC-STE-550.3)
// ---------------------------------------------------------------------------

/**
 * THE clause every adopting SKILL.md carries, stated here once.
 *
 * A shared literal with ONE OWNER, for the same reason `ADOPTING_STAGES` is
 * one: eleven hand-written paraphrases of "skip the block when driven" are
 * eleven contracts that drift apart one reword at a time, and the scanner below
 * could then only ever grade whichever spelling it happened to know. Reworded
 * here, it is reworded everywhere in one edit — and the scanner names any
 * surface that did not come along.
 *
 * Written as ONE LINE, and appendable to an existing sentence, because three of
 * the eleven sit at the shipped line cap with zero headroom: the clause must be
 * able to land without costing a line.
 */
export const DRIVEN_SUPPRESSION_CLAUSE =
  "Skip this block when the invocation body carries the driven-run marker: " +
  "the orchestrator drives the next step in the same turn.";

/** Does this authoring surface document the driven-suppression branch? */
export function documentsDrivenSuppression(skillBody: string): boolean {
  return String(skillBody ?? "").includes(DRIVEN_SUPPRESSION_CLAUSE);
}

/** One adopting surface that has not documented the branch. */
export interface DrivenSuppressionViolation {
  /** The adopting stage, by name. */
  readonly stage: AdoptingStage;
  /** Repo-relative path of the surface, for a citable `file:line`. */
  readonly file: string;
  /** 1-based line to cite — the end of the file, where the clause is owed. */
  readonly line: number;
  /** Why this is a violation, in the operator's words. */
  readonly reason: string;
}

/** The one authoring root this scanner grades — the toolkit's own tree. */
const SKILL_SEGMENTS = (stage: string): string[] => [
  "plugins",
  "dev-process-toolkit",
  "skills",
  stage,
  "SKILL.md",
];

/**
 * Every adopting stage whose shipped SKILL.md has not adopted the suppression
 * branch.
 *
 * A DIFFERENT SUBJECT from `scanStageBlockAdoption`, deliberately kept in its
 * own scanner rather than folded in as a fourth rule there. That scanner grades
 * whether a stage documents a closed block at all; this one grades whether the
 * documented block has a driven branch. Folding them would mean a surface
 * missing the branch reads as "still closes with narration", which is false and
 * would send a reader to fix the wrong thing.
 *
 * A path that does not exist is not a violation: a tree that does not carry a
 * stage cannot be delinquent about that stage's prose.
 */
export function scanDrivenSuppressionAdoption(
  projectRoot: string,
): DrivenSuppressionViolation[] {
  const violations: DrivenSuppressionViolation[] = [];
  for (const stage of ADOPTING_STAGES) {
    const segments = SKILL_SEGMENTS(stage);
    const abs = join(projectRoot, ...segments);
    if (!existsSync(abs)) continue;
    let body: string;
    try {
      body = readFileSync(abs, "utf-8");
    } catch {
      continue; // an unreadable surface is not a violation
    }
    if (documentsDrivenSuppression(body)) continue;
    violations.push({
      stage,
      file: segments.join("/"),
      line: Math.max(1, body.split("\n").length),
      reason:
        `\`/${stage}\` documents no driven branch on its closing block: run ` +
        `inline by an orchestrator it would end the turn, and the run would ` +
        `stall waiting for the operator to type again`,
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The graded half (AC-STE-558.1) — the scanner, wrapped as a /gate-check probe
// ---------------------------------------------------------------------------

/**
 * The probe id, as registered in `skills/gate-check/SKILL.md`.
 *
 * ONE OWNER, for the same reason the clause above has one: the id opens every
 * violation message AND rides its `Context:` line, and a reader who greps the
 * id out of a red must land on the registration row that named it.
 */
export const PROBE_ID = "driven_suppression_adoption";

/** The one-line fix, stated once — every violation carries the same remedy. */
const REMEDY =
  "append `DRIVEN_SUPPRESSION_CLAUSE` (adapters/_shared/src/" +
  "inline_terminal_block.ts) to the stage's closing-block instruction — it is " +
  "one line and appendable to an existing sentence";

/** One graded violation, in the shape probe #77 established. */
export interface DrivenSuppressionAdoptionViolation {
  readonly file: string;
  readonly line: number;
  /** Severity travels PER VIOLATION, never as a report-level field. */
  readonly severity: "error";
  readonly reason: string;
  /** `<repo-relative-file>:<line> — <reason>`, per STE-82. */
  readonly note: string;
  /** The NFR-10 canonical shape: verdict line, `Remedy:`, `Context:`. */
  readonly message: string;
}

export interface DrivenSuppressionAdoptionReport {
  readonly violations: DrivenSuppressionAdoptionViolation[];
  /** MEASURED: no adopting stage's surface existed under this root at all. */
  readonly vacuous: boolean;
}

/**
 * Grade every adopting stage's driven-suppression adoption.
 *
 * RENDERS, DOES NOT RE-SCAN. `scanDrivenSuppressionAdoption` above stays the
 * one walk and the one author of `reason`; this function only dresses its rows
 * in the house violation shape. A second derivation of "why is this surface
 * delinquent" here would be a private paraphrase that drifts the day the
 * scanner's wording changes.
 *
 * VACUOUS IS MEASURED, not assumed. `vacuous` is true exactly when no adopting
 * stage's SKILL.md exists under `projectRoot` — the consumer-project case,
 * where the toolkit's own tree is absent and there is nothing to grade. It is
 * NOT "the walk returned no violations": a clean tree is a graded tree, and
 * collapsing the two would let a probe that scans nothing anywhere report
 * itself as vacuous forever.
 */
export function runDrivenSuppressionAdoptionProbe(
  projectRoot: string,
): DrivenSuppressionAdoptionReport {
  // The SAME path expression the scanner walks — `SKILL_SEGMENTS` is shared,
  // not respelled, so "graded nothing" and "found nothing" cannot disagree.
  const graded = ADOPTING_STAGES.filter((stage) =>
    existsSync(join(projectRoot, ...SKILL_SEGMENTS(stage))),
  );

  const violations = scanDrivenSuppressionAdoption(projectRoot).map(
    (v): DrivenSuppressionAdoptionViolation => ({
      file: v.file,
      line: v.line,
      severity: "error",
      reason: v.reason,
      note: `${v.file}:${v.line} — ${v.reason}`,
      message: [
        `${PROBE_ID}: ${v.file}:${v.line} — ${v.reason}`,
        `Remedy: ${REMEDY}`,
        `Context: file=${v.file}, line=${v.line}, stage=${v.stage}, ` +
          `probe=${PROBE_ID}, severity=error`,
      ].join("\n"),
    }),
  );

  return { violations, vacuous: graded.length === 0 };
}

// Read-only CLI front door. Imported by tests and by /gate-check, where
// `import.meta.main` is false and this block never runs — the module stays
// side-effect free at import. Its presence is also load-bearing: a probe
// registration whose module has no front door turns probe #81 red.
if (import.meta.main) {
  // `||`, not `??`: `??` substitutes only on null/undefined, so `bun run
  // inline_terminal_block.ts ""` would pass an empty string straight through as
  // the project root and resolve every skill path against "". Falling back on
  // any falsy argv entry is the same decision the sibling front door in
  // external_link_verdicts.ts reaches.
  const projectRoot = process.argv[2] || process.cwd();
  const report = runDrivenSuppressionAdoptionProbe(projectRoot);
  if (report.violations.length > 0) {
    console.log(report.violations.map((v) => v.message).join("\n\n"));
    process.exit(1);
  }
}
