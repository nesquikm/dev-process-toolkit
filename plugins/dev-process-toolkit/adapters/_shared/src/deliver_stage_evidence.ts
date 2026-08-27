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
// for the gate's baseline delta. Each is reached at its call site from its one
// home — never copied, never cached in a local binding — so an override of
// either is genuinely wired through (the STE-509 house idiom). The renderer
// writes the lines; `parseEvidenceLines` reads them back out, which is what
// lets `verifyDeliverStageCapture` cross-check a fence against the captures
// behind it.
//
// THE REMEDY IS NOT RE-SPELLED HERE EITHER (AC-STE-530.2). A gate refusal hands
// the reader the verdict's OWN line, rendered by `skip_baseline`, so the
// copy-pasteable command a reader meets on this — the surface they actually
// reach — is the same string, per cause, that `renderSkipVerdict` carries. A
// second copy of the command in this file would agree with that renderer right
// up until either is reworded, and the drifted one would turn up exactly where
// somebody is already stuck.
//
// PURE AND IN-FENCE BY CONSTRUCTION. This module never touches the filesystem
// itself: the evidence lives INSIDE the fence, never in a companion artifact —
// a split source of truth is the shape M129 recorded three times in one
// milestone. (`evaluateSkipDelta` owns the one baseline read; nothing here
// writes anything.)

// BY NAME, deliberately. This module reads three things from its verdict source
// — the classification, the line carrying the remedy, and the count-only label
// its degraded rows confess with — and importing them by name means a source
// that stops exporting any one of them fails to LOAD, loudly, at the import.
//
// It was briefly a namespace import, so that a test stub supplying only some of
// the three could still link. That traded a loud link error for a quiet
// `undefined` at call time — a fail-open branch in production existing purely
// to keep a test loadable, which is the shape this whole module's milestone was
// convened to remove. The stub re-exports what it does not supersede instead.
//
// Kept to ONE `./skip_baseline` specifier: the AC-STE-530.4 harness rewrites
// that anchor to graft in a substituted verdict source, and a second specifier
// would leave it with a dangling import.
import {
  COUNT_ONLY_NOTE,
  evaluateSkipDelta,
  renderSkipVerdict,
  type SkipVerdict,
} from "./skip_baseline";
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
  /**
   * The identities of the skips this run reported — gate only (AC-STE-529.2).
   *
   * SUPPLIED BY THE CALLER, never read here. This module is pure over the
   * values it is handed: it does not touch the filesystem, and folding a junit
   * read into it would make it impure for every caller it already has. The
   * caller that owns the runner owns the identity source.
   *
   * THREE STATES, THREE DISTINCT FACTS — the same three `evaluateSkipDelta`
   * documents, and this field is forwarded to it verbatim:
   *
   *   * OMITTED — this caller says nothing about identities. The lookup takes
   *     today's two-argument path byte for byte, which is where every existing
   *     caller is; reading "said nothing" as "could not name them" would turn a
   *     named baseline into a refusal for callers that never opted in.
   *   * `null` — this run STATES it could not name its skips.
   *   * an array — these are the skips, by name.
   */
  readonly skipNames?: readonly string[] | null;
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
  /**
   * STE-509 baseline lookup. The ROOT ALONE decides: since STE-527 re-keyed the
   * store on the branch's trunk commit, `evaluateSkipDelta` resolves that itself
   * through `git merge-base` and takes no branch. A root present ⇒ the gate
   * delta is measured.
   */
  readonly projectRoot?: string;
  /**
   * @deprecated Read by nothing in this module since the STE-527 re-key. Kept
   * only so existing callers that still pass it keep type-checking; it has no
   * effect on the baseline lookup, and demanding it is exactly the leftover
   * gate AC-STE-527.4 removed — a root-with-no-branch caller was falling
   * through to the no-root arm and reporting a REAL baseline as unmeasured.
   */
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

/**
 * The one rendered shape, written here and read back by `parseEvidenceLines`.
 *
 * THE DEGRADED ROW SAYS SO (AC-STE-529.3). `countOnly` is the gate verdict's own
 * flag, forwarded — never re-derived here — and the numbers it labels are the
 * ones the row already carried, byte for byte. A comparison that fell back to
 * arithmetic because neither side named its skips is otherwise INDISTINGUISHABLE
 * on this line from one that compared identities, and this line is the only
 * skip-comparison surface a PASSING stage renders: `remedyClause` fires on a
 * refusal alone, and a degraded comparison that passes is exactly the case the
 * label exists for. The label itself is read from `skip_baseline`, the one place
 * it is spelled, so the row and the verdict line cannot drift apart.
 */
function countsLine(
  counts: EvidenceCounts,
  section: EvidenceSection,
  countOnly: boolean,
): string {
  const head = `  - pass ${counts.pass}, fail ${counts.fail}, skip ${counts.skip}`;
  if (section !== "gate") return head;
  const note = countOnly ? `; ${COUNT_ONLY_NOTE}` : "";
  if (counts.baseline === null || counts.delta === null) {
    // Never a silent zero: an unmeasured baseline says so in words.
    return `${head}, baseline unmeasured${note}`;
  }
  return `${head}, baseline ${counts.baseline}, delta ${counts.delta}${note}`;
}

/**
 * The remedy clause a gate refusal ends on: the verdict's OWN rendered line.
 *
 * ONE SPELLING BY CONSTRUCTION (AC-STE-530.2). The command is not read out of
 * `skip_baseline` and re-embedded — the whole line is, so each cause keeps the
 * remedy bound to it there (AC-STE-530.8: a foreign checkout re-measures here,
 * an unnamed run re-runs the gate) and a reword on either surface cannot leave
 * the reader holding the other one's command, or a drifted second copy of it.
 *
 * NOT GUARDED, deliberately. An earlier form treated `renderSkipVerdict` as
 * possibly-absent so that a test stub supplying only the verdict source could
 * still link. That guard existed for no production reason — this module's one
 * home always exports the renderer — and it fails OPEN: a link that went wrong
 * would drop the remedy silently and leave a refusal that hands the reader
 * nothing, which is the defect this clause was added to close. The stub
 * re-exports the shipped renderer instead, so the branch is gone.
 */
function remedyClause(verdict: SkipVerdict): string {
  return ` — ${renderSkipVerdict(verdict)}`;
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
  // The gate verdict's own `countOnly`, carried to the rendering pass below.
  // Never inferred from the counts: equal-looking numbers are produced by both
  // a set comparison and a scalar one, which is the whole reason for the flag.
  let gateCountOnly = false;
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
      // THE ROOT ALONE (AC-STE-527.4). This used to also demand `input.branch`,
      // a leftover from when `evaluateSkipDelta` took one. The lookup now
      // resolves the trunk commit itself, so a caller with a root and no branch
      // was falling through to the no-root arm below and reporting a baseline
      // it could have read perfectly well as unmeasured. Omitting the root is
      // still its own case, with its own arm and its own remedy.
      if (input.projectRoot !== undefined) {
        // THE THIRD ARGUMENT IS FORWARDED, NOT BRANCHED ON. `run.skipNames`
        // being absent IS `undefined`, which is exactly the value
        // `evaluateSkipDelta` reads as "this caller said nothing about
        // identities" and answers on its scalar path — so an opt-out caller
        // reaches the same arm through the same one call site, and there is no
        // second copy of the lookup to drift.
        const verdict = evaluateSkipDelta(input.projectRoot, derived.skip, run.skipNames);
        baseline = verdict.baseline;
        delta = verdict.delta;
        gateCountOnly = verdict.countOnly === true;
        if (verdict.outcome === "unmeasured" && isRequired) {
          reasons.push(
            "`gate`: the skip baseline is unmeasured for this branch — a missing " +
              "count is a refusal ground, never a silent zero delta" +
              remedyClause(verdict),
          );
        }
        if (verdict.outcome === "incomparable" && isRequired) {
          // ITS OWN ground, never folded into the unmeasured one: a baseline
          // that exists but cannot be compared is a different defect, with a
          // different remedy, from a baseline that was never taken.
          reasons.push(
            "`gate`: the skip baseline exists but is incomparable to this run " +
              `(cause: ${verdict.cause ?? "unknown"}) — an incomparable baseline ` +
              "is a refusal ground, never a silent zero delta" +
              remedyClause(verdict),
          );
        }
        if (verdict.outcome === "fail") {
          // A SET failure is worded from the SET, never from the delta. The
          // swap of one skip for another is a refusal on a delta of ZERO, and
          // the arithmetic sentence would then read "0 newly introduced
          // skip(s)" — a refusal that contradicts itself in its own first
          // clause. The identities come from the verdict's own line, so the
          // names a reader meets here are the ones `renderSkipVerdict` renders,
          // capped the same way, with no second copy of the clause.
          const newSkips = verdict.newSkips ?? [];
          reasons.push(
            newSkips.length > 0
              ? "`gate`: this run skips test(s) that were not skipping at the " +
                  "branch point — a newly skipping identity is a refusal ground, " +
                  "and the count alone would have reported nothing here" +
                  remedyClause(verdict)
              : `\`gate\`: ${verdict.delta} newly introduced skip(s) against a baseline of ` +
                `${verdict.baseline} — a positive skip delta is a refusal ground`,
          );
        }
      } else if (isRequired) {
        reasons.push(
          "`gate`: no project root and branch were supplied, so the skip baseline " +
            "is unmeasured — the delta is a required count" +
            // A non-pass rendering, so it ends on a command too — the same one,
            // from the same renderer, that a looked-up unmeasured verdict does.
            remedyClause({
              outcome: "unmeasured",
              baseline: null,
              current: derived.skip,
              delta: null,
            }),
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
    lines.push(
      sectionCounts === null
        ? NONE_FOUND
        : countsLine(sectionCounts, section, section === "gate" && gateCountOnly),
    );
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
