// deliver_stage_evidence — STE-510: the `deliver-stage-result` fence's counts,
// DERIVED from captured command output rather than authored by the worker.
//
// THE DEFECT. The shipped fence carries a `gate:` section of pass and skip
// counts, and nothing anywhere checks that those numbers came from somewhere. A
// worker composing the block from memory emits the right sections, in the right
// order, under the line cap, carrying entirely plausible numbers — and the
// report is evidentially worthless. The wrong implementation is INVISIBLE in a
// green run.
//
// THE FIX. Every number the fence carries is produced HERE, by code, from bytes
// a runner really emitted: `parseTestOutput` for the counts, `evaluateSkipDelta`
// for the gate's baseline delta. Both are called by bare name from their one
// home, so an override of either is genuinely wired through (the STE-509 house
// idiom). The renderer writes the lines; `parseEvidenceLines` reads them back
// out, which is what lets `verifyDeliverStageCapture` cross-check a fence
// against the captures behind it.
//
// PURE AND IN-FENCE BY CONSTRUCTION. This module never touches the filesystem
// itself: the evidence lives INSIDE the fence, never in a companion artifact —
// a split source of truth is the shape M129 recorded three times in one
// milestone. (`evaluateSkipDelta` owns the one baseline read; nothing here
// writes anything.)

import { evaluateSkipDelta } from "./skip_baseline";
import { parseTestOutput, type Stack } from "./test_count_parser";

/** The evidence sections, in THE fixed order they render in. */
export const EVIDENCE_SECTIONS = ["gate", "drive", "e2e"] as const;

/** One of the three evidence sections. */
export type EvidenceSection = (typeof EVIDENCE_SECTIONS)[number];

/** A command that really ran, and the bytes it emitted. */
export interface CapturedRun {
  /** What ran. */
  readonly command: string;
  /** The bytes it emitted — THE CAPTURE every count below traces back to. */
  readonly output: string;
  /** Which runner produced them; the count formula differs per stack. */
  readonly stack: Stack;
}

/** The counts one section reports. `baseline`/`delta` are gate-only. */
export interface EvidenceCounts {
  readonly pass: number;
  /** Failures and errors, folded — a stage does not care which kind. */
  readonly fail: number;
  readonly skip: number;
  /** Gate only; `null` elsewhere, and `null` when unmeasured. */
  readonly baseline: number | null;
  /** Gate only; `null` elsewhere, and `null` when unmeasured — never 0. */
  readonly delta: number | null;
}

export interface StageEvidenceInput {
  readonly gate?: CapturedRun | null;
  readonly drive?: CapturedRun | null;
  readonly e2e?: CapturedRun | null;
  /**
   * Sections this stage must evidence. OMITTED MEANS ALL THREE — the
   * fail-closed default, so a stage that forgot to capture anything refuses
   * rather than reporting a confident nothing. A REDUCED chain (a milestone
   * whose work lands in a tree with no toolkit, where no gate, drive or e2e
   * command exists to run) passes `[]`, or a subset.
   */
  readonly required?: readonly EvidenceSection[];
  /** STE-509 baseline lookup. Both present ⇒ the gate delta is measured. */
  readonly projectRoot?: string;
  readonly branch?: string;
}

export interface RenderedStageEvidence {
  /** DERIVED from `reasons`, never asserted by a caller. */
  readonly ok: boolean;
  /** The `gate:` / `drive:` / `e2e:` blocks, ready to drop into the fence. */
  readonly lines: readonly string[];
  readonly counts: Readonly<Record<EvidenceSection, EvidenceCounts | null>>;
  /** One line per refusal ground; empty iff `ok`. */
  readonly reasons: readonly string[];
}

/** The literal an evidenced-but-absent section carries. Sections never vanish. */
const NONE_FOUND = "  - (none found)";

/**
 * Counts for one captured run, or `null` when the bytes cannot be parsed.
 *
 * STACK-CORRECT BY CONSTRUCTION: the runners disagree about what their total
 * includes. bun's `Ran N tests` COUNTS skipped tests; pytest's `N passed` does
 * not. A single-stack formula silently mis-derives `pass` on the other, which
 * is exactly the kind of wrong number that looks plausible in a green run.
 */
function deriveCounts(run: CapturedRun): { pass: number; fail: number; skip: number } | null {
  const parsed = parseTestOutput(run.output, run.stack);
  if (!parsed.ok) return null;

  const { total, failures, errors, skipped } = parsed.count;
  const fail = failures + errors;
  const pass = run.stack === "bun" ? total - fail - skipped : total - fail;
  return { pass, fail, skip: skipped };
}

/** The one rendered shape, written here and read back by `parseEvidenceLines`. */
function countsLine(counts: EvidenceCounts, section: EvidenceSection): string {
  const head = `  - pass ${counts.pass}, fail ${counts.fail}, skip ${counts.skip}`;
  if (section !== "gate") return head;
  if (counts.baseline === null || counts.delta === null) {
    // Never a silent zero: an unmeasured baseline says so in words.
    return `${head}, baseline unmeasured`;
  }
  return `${head}, baseline ${counts.baseline}, delta ${counts.delta}`;
}

/**
 * Render the three evidence blocks from the captures behind them.
 *
 * `ok` is true only when every REQUIRED section has a capture with derivable
 * counts, the gate delta is MEASURED, and no count indicates failure.
 */
export function renderStageEvidence(input: StageEvidenceInput): RenderedStageEvidence {
  const required = input.required ?? EVIDENCE_SECTIONS;
  const reasons: string[] = [];
  const counts: Record<EvidenceSection, EvidenceCounts | null> = {
    gate: null,
    drive: null,
    e2e: null,
  };

  for (const section of EVIDENCE_SECTIONS) {
    const isRequired = required.includes(section);
    const run = input[section] ?? null;

    if (run === null) {
      if (isRequired) {
        reasons.push(
          `\`${section}\`: no captured run — a stage cannot report ok without ` +
            "machine-read evidence for a section it is required to evidence",
        );
      }
      continue;
    }

    const derived = deriveCounts(run);
    if (derived === null) {
      reasons.push(
        `\`${section}\`: the output captured from ${JSON.stringify(run.command)} ` +
          `could not be parsed as ${run.stack} test output — no count can be derived from it`,
      );
      continue;
    }

    let baseline: number | null = null;
    let delta: number | null = null;

    if (section === "gate") {
      if (input.projectRoot !== undefined && input.branch !== undefined) {
        const verdict = evaluateSkipDelta(input.projectRoot, input.branch, derived.skip);
        baseline = verdict.baseline;
        delta = verdict.delta;
        if (verdict.outcome === "unmeasured" && isRequired) {
          reasons.push(
            "`gate`: the skip baseline is unmeasured for this branch — a missing " +
              "count is a refusal ground, never a silent zero delta",
          );
        }
        if (verdict.outcome === "fail") {
          reasons.push(
            `\`gate\`: ${verdict.delta} newly introduced skip(s) against a baseline of ` +
              `${verdict.baseline} — a positive skip delta is a refusal ground`,
          );
        }
      } else if (isRequired) {
        reasons.push(
          "`gate`: no project root and branch were supplied, so the skip baseline " +
            "is unmeasured — the delta is a required count",
        );
      }
    }

    if (derived.fail > 0) {
      reasons.push(
        `\`${section}\`: the capture reports ${derived.fail} failure(s) — a count ` +
          "indicating failure refuses `status: ok`",
      );
    }

    counts[section] = { ...derived, baseline, delta };
  }

  const lines: string[] = [];
  for (const section of EVIDENCE_SECTIONS) {
    lines.push(`${section}:`);
    const sectionCounts = counts[section];
    lines.push(sectionCounts === null ? NONE_FOUND : countsLine(sectionCounts, section));
  }

  return { ok: reasons.length === 0, lines, counts, reasons };
}

/** `gate:` / `drive:` / `e2e:` — a section heading and nothing else. */
const HEADING_RE = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*$/;

/**
 * A list ITEM under a section — the ONE predicate both halves of the contract
 * ask, INDENTATION-TOLERANT by design.
 *
 * THE HOLE IT CLOSES. This module's reader and `deliver_stage_capture`'s
 * `sectionItems` were two spellings of the same question, and they disagreed
 * about exactly one character class: the capture side demanded LEADING
 * WHITESPACE (`^[ \t]+-[ \t]`) while this side demanded nothing and the sibling
 * empty-item fallback was already lenient. A counts line at COLUMN 0 was
 * therefore read back as a claim and simultaneously invisible to
 * `checkEvidenceCounts` and `checkEvidenceCardinality` — a partial counts line
 * graded clean, and a failing run buried under a clean one graded green. Every
 * shipped fixture indents, which is precisely why nothing was red.
 *
 * Spelled ONCE and exported, so the two sides cannot drift apart again. Leading
 * whitespace is OPTIONAL, never required: deleting two spaces is not a semantic
 * difference, and legitimately indented content stays exactly as legal as it
 * has always been.
 */
export const EVIDENCE_ITEM_RE = /^[ \t]*-[ \t]/;

const PASS_RE = /\bpass\s+(\d+)\b/;
const FAIL_RE = /\bfail\s+(\d+)\b/;
const SKIP_RE = /\bskip\s+(\d+)\b/;
const BASELINE_RE = /\bbaseline\s+(\d+)\b/;
const DELTA_RE = /\bdelta\s+(-?\d+)\b/;

function numberFrom(line: string, regex: RegExp): number | null {
  const hit = regex.exec(line);
  return hit === null ? null : Number(hit[1]);
}

/**
 * Read the counts back OUT of rendered fence lines.
 *
 * This is the consumer half of the one line shape. It exists so the numbers in
 * a fence can be compared against numbers re-derived from the captures — a
 * round trip a worker-authored constant cannot survive.
 */
export function parseEvidenceLines(
  fenceLines: readonly string[],
): Readonly<Record<EvidenceSection, EvidenceCounts | null>> {
  const counts: Record<EvidenceSection, EvidenceCounts | null> = {
    gate: null,
    drive: null,
    e2e: null,
  };

  let current: EvidenceSection | null = null;
  for (const line of fenceLines) {
    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const name = heading[1] as EvidenceSection;
      current = (EVIDENCE_SECTIONS as readonly string[]).includes(name) ? name : null;
      continue;
    }
    if (current === null) continue;
    // Same predicate the capture verifier grades items with — a line that is
    // not an item is not a claim, at any indentation.
    if (!EVIDENCE_ITEM_RE.test(line)) continue;

    const pass = numberFrom(line, PASS_RE);
    const fail = numberFrom(line, FAIL_RE);
    const skip = numberFrom(line, SKIP_RE);
    if (pass === null && fail === null && skip === null) continue;

    counts[current] = {
      pass: pass ?? 0,
      fail: fail ?? 0,
      skip: skip ?? 0,
      baseline: numberFrom(line, BASELINE_RE),
      delta: numberFrom(line, DELTA_RE),
    };
    current = null;
  }

  return counts;
}
