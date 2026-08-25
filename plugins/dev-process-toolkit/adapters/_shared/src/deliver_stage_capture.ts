// deliver_stage_capture — STE-492: a real predicate for the
// `deliver-stage-result` hand-off contract, taking a CAPTURED WORKER STAGE
// REPORT as its subject.
//
// THE DEFECT. Every one of the eighteen shipped STE-464 acceptance criteria for
// the `deliver-stage-result` contract is a prose-grep of `/deliver`'s own
// `skills/deliver/SKILL.md`. A contract with no producer anywhere in the
// toolkit — no worker ever emitting the fence, no artifact ever checked — passed
// all eighteen, because the only thing they ever read was the orchestrator
// describing the contract to itself. Producer/consumer asymmetry (STE-485 /
// STE-396): the consumer side was pinned to the byte, the producer side was
// evidenced by nothing.
//
// THE FIX. This module reads a capture — the text a ceremony stage actually
// emitted — from disk and returns a structured verdict. The smoke driver's
// fixture group 14 runs it against a worker capture, so the contract now has a
// second, non-prose evidence path that fails when the producer stops producing.
//
// THE VACUITY THIS MODULE MUST NOT HAVE. `skills/deliver/SKILL.md` itself
// carries a well-formed ```deliver-stage-result EXAMPLE — one fence, all eight
// sections, in the canonical order. A naive "does the text contain the banner"
// (or even "banner plus ordered sections") predicate therefore scores the
// ORCHESTRATOR'S OWN PROSE as a passing worker report, which is a perfect pin on
// the wrong subject and worth nothing. So the predicate additionally demands
// what a template cannot have: CONCRETE scalars. A capture must carry a real
// `stage:` value, a real milestone identity under the shared `milestone_token`
// union grammar — `M<digits>` or `M_<epic-key>` (the SKILL's says `M<N>`, which
// is neither) — and a real `status:`, none of them carrying the `#`-annotated
// alternation a template uses to enumerate its options.
//
// WHAT IT DELIBERATELY DOES NOT DEMAND. `summary` and `follow_ups` are never
// content-checked, because the literal `- (none found)` fallback is legal in
// either — and that fallback stays legal in the three EVIDENCE sections too. On
// a REDUCED chain (a milestone whose work lands in a tree with no toolkit)
// `gate`, `drive` and `e2e` legitimately carry exactly that: there is no gate,
// drive or e2e command there to report counts from, and grading "this section
// must have run" here would fail that healthy case. That obligation lives in
// `renderStageEvidence`, where the ROUTE decides which sections are required.
//
// WHAT STE-510 ADDED. A section that carries a COUNTS LINE must carry every
// count that line owes: `pass`, `fail` and `skip` in all three, plus the
// STE-509 `baseline` and the `delta` it implies in `gate`. The skip count is
// precisely the one a silent-skip run omits, so a `gate:` line stating only
// pass and fail — plausible, well-shaped, and quietly hiding newly skipped
// tests — is refused rather than accepted as a green report.
//
// Pure and read-only by construction: one `readFileSync`, no git, no network,
// no child processes — the same discipline every `adapters/_shared/src` scanner
// follows, so a smoke driver can call it mid-run without side effects.

import { readFileSync } from "node:fs";

import {
  EVIDENCE_ITEM_RE,
  EVIDENCE_SECTIONS,
  parseEvidenceLines,
  renderStageEvidence,
  type EvidenceCounts,
  type StageEvidenceInput,
} from "./deliver_stage_evidence";
import { findFences } from "./markdown_fences";
import { MILESTONE_TOKEN_SOURCE } from "./milestone_token";
import {
  chainRequiresSpawnReceipt,
  findSpawnReceiptLine,
  parseSpawnReceipt,
  SPAWN_RECEIPT_FIELDS,
  SPAWN_RECEIPT_PREFIX,
  type ChainStep,
} from "./spawn_receipt";

/**
 * A concrete milestone identity, anchored on the SHARED union grammar rather
 * than a private `M\d+` copy.
 *
 * This is load-bearing, not hygiene. Fixture group 14 is rostered on every leg
 * (`legs: ALL_LEGS`), and the three mint paths emit three different shapes: the
 * Linear route mints `M<N>`, the Jira route `M_<epic-key>`, and the
 * tracker-less route `M_<short-ULID>`. A hand-rolled `^M\d+$` recognizes only
 * the first, so a perfectly healthy capture from the jira or tracker-less leg
 * would be graded `ok:false` — the group would false-RED on two of its three
 * legs while looking green on the one that happened to be developed against.
 * `milestone_token.ts` is the one home for this grammar (STE-376), and its
 * consumer audit greps for exactly this import so a private copy cannot
 * silently return.
 *
 * The SKILL's placeholder `M<N>` still matches NEITHER branch of the union, so
 * widening here does not reopen the wrong-subject vacuity the module exists to
 * close — and the `#`-alternation check remains an independent second ground.
 */
const CONCRETE_MILESTONE_RE = new RegExp(`^${MILESTONE_TOKEN_SOURCE}$`);

/** The fenced banner every stage report must end with. */
export const DELIVER_STAGE_FENCE_BANNER = "```deliver-stage-result";

/**
 * Opening / closing markers, indentation-tolerant: a worker report relayed
 * through a nested list or a quoted pane transcript keeps the fence but not
 * the column-0 position, and rejecting that would fail the healthy case.
 * The opener is built from the exported banner so the two cannot drift.
 */
const FENCE_OPEN = new RegExp(`^[ \\t]*${DELIVER_STAGE_FENCE_BANNER}[ \\t]*$`);
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;

/**
 * The eight sections, in THE canonical order. Restated here as the module's own
 * authority; `skills/deliver/SKILL.md` and `docs/deliver-reference.md` state the
 * same order in prose for the worker's benefit.
 *
 * STE-510 inserted `drive` and `e2e` CONTIGUOUSLY after `gate`, before
 * `follow_ups`: the three evidence sections sit together so a reader (and the
 * cross-check that re-derives their counts from the captures) finds them as one
 * block. The position is graded, not merely the presence — a capture placing
 * them anywhere else is rejected as out of order.
 */
export const DELIVER_STAGE_SECTIONS = [
  "stage",
  "milestone",
  "status",
  "summary",
  "gate",
  "drive",
  "e2e",
  "follow_ups",
] as const;

/**
 * Every stage `/deliver` can run, across ALL routes — the single vocabulary for
 * the fence's `stage:` scalar.
 *
 * This is deliberately wider than the full ceremony's three. A milestone whose
 * work lands in a tree with no toolkit runs a REDUCED chain (`work` then `pr`),
 * and one targeting another toolkit repo runs `spec-write` first. Those stages
 * emit the same eight-section fence as any other — the reduced chain is exempt
 * from stages it never RUNS, never from the fence contract itself.
 *
 * Caught by the STE-495 refactor pass: this list was the full-ceremony triple,
 * so a healthy reduced-chain worker emitting `stage: work` was graded `ok:
 * false` with "not one of implement | ship-milestone | pr". Fixture group 14
 * would have false-REDded a correct reduced chain — the third instance in this
 * milestone of the fence predicate disagreeing with the routing it grades.
 *
 * `target_repo.ts` derives its `StageId` union from this const rather than
 * keeping a second copy; the import runs that way because `target_repo` already
 * imports `DELIVER_STAGE_SECTIONS` from here, and the reverse would be circular.
 */
export const DELIVER_STAGE_IDS = [
  "spec-write",
  "implement",
  "ship-milestone",
  "pr",
  "work",
] as const;

const STAGE_VALUES = DELIVER_STAGE_IDS;

/** The two terminal statuses a stage report can carry. */
const STATUS_VALUES = ["ok", "failed"] as const;

/**
 * Line cap INSIDE the fence (SKILL § Stage hand-offs).
 *
 * RAISED from the shipped 20 by STE-510, which inserted `drive` and `e2e`
 * between `gate` and `follow_ups`. Each new section costs a heading plus its
 * items, so the old budget could not hold a full eight-section report: 20 + two
 * sections × (one heading + two items) = 26.
 *
 * The alternative was spilling the evidence into a companion artifact under
 * `.dpt/scratch/` and pointing at it from the fence. That is the
 * split-source-of-truth shape M129 recorded three separate times, every
 * instance producing a grader that failed healthy runs: the orchestrator would
 * read `status:` from one place and the numbers backing it from another, and
 * the two can drift. So the cap moves and the evidence stays in the block —
 * one fence, one read, one truth.
 *
 * It is still a CAP, not a formality: a hand-off is a summary, not a
 * transcript, and a fence one line over 26 is refused exactly as a fence one
 * line over 20 was. Detail lives in the worker's visible session.
 *
 * Exported because `skills/deliver/SKILL.md` and `docs/deliver-reference.md`
 * both restate this number in prose, and the surface-drift guard reads it from
 * here rather than from a second literal of its own — a rule that lands on one
 * surface and not its sibling is the M131 drift shape.
 */
export const FENCE_LINE_CAP = 26;

/**
 * Minimum characters of report prose before the fence. A bare fence with no
 * report around it is not a stage hand-off; it is a snippet.
 */
const MIN_PROSE_CHARS = 40;

/**
 * HOW THOROUGHLY a verdict was graded — never WHETHER it passed.
 *
 * `verifyDeliverStageCapture` called without captures grades SHAPE ONLY, and
 * that mode is deliberate: a caller with no captures to offer must not receive
 * a verdict about numbers it never supplied. But an `ok: true` from that path
 * is byte-identical to an evidence-backed one, so a caller cannot tell a fence
 * whose numbers were cross-checked against real bytes from one whose numbers
 * were merely well-shaped. This discriminator is the difference, and nothing
 * more: it answers "was the cross-check run?", never "did this pass?".
 */
export type DeliverStageGrade = "shape-only" | "evidence-backed";

/** Grading read the fence's own bytes only — no captures were supplied. */
const GRADE_SHAPE_ONLY: DeliverStageGrade = "shape-only";

/** Grading cross-checked every stated count against the capture behind it. */
const GRADE_EVIDENCE_BACKED: DeliverStageGrade = "evidence-backed";

/**
 * What the ORCHESTRATOR knows about the spawn behind this stage, supplied so
 * the verifier can grade `summary`'s receipt against it (STE-516).
 *
 * `chain` carries the placements the chain itself rendered, so "does this
 * stage owe a receipt?" is answered from the chain rather than re-decided in
 * prose at each call site. `handle` is the handle the SPAWNING TOOL returned
 * and the ownership check resolved — never one this verifier or the reporting
 * stage composed. That is the whole discriminator: a receipt whose handle is
 * well-formed but was composed by the reporter parses perfectly and is
 * refused anyway, because it is not the handle the check resolved.
 */
export interface StageSpawnExpectation {
  readonly chain: readonly ChainStep[];
  /** The handle the ownership check resolved, when one was spawned. */
  readonly handle?: string;
}

export interface DeliverStageCaptureVerdict {
  /** True only when every clause below holds. */
  ok: boolean;
  /** One human-readable line per violated clause; empty iff `ok`. */
  reasons: readonly string[];
  /**
   * Which grading mode produced this verdict. ADDITIVE, and present on EVERY
   * return path — an `undefined` here would be a third state every caller had
   * to handle, which is exactly the second failure mode the `{ ok, reasons }`
   * contract exists to avoid. `ok` stays boolean, `reasons` stays the one
   * channel every violation lands in, and `/deliver`'s bounded-retry-then-halt
   * path reads precisely what it read before.
   */
  graded: DeliverStageGrade;
}

/**
 * CRLF/BOM normalization. A capture written on Windows, or one a tool prefixed
 * with U+FEFF, is the same report — and a line-anchored check that silently
 * missed it would fail the healthy case, which is the loudest possible way to
 * be wrong about a green run.
 */
function normalize(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * A top-level `key:` line inside the fence — heading or scalar, both.
 *
 * ONE HOME, deliberately. `topLevelKeys` reads the order clause off it and
 * `sectionItems` uses it to decide which section an item belongs to; spelled
 * twice, a change to what counts as a key would reach one clause and not the
 * other. It is NOT the evidence module's `HEADING_RE`, which is the narrower
 * "heading and nothing after it" — that one has to reject `stage: implement`,
 * this one has to recognise it.
 */
const TOP_LEVEL_KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;

/** Top-level `key:` lines inside the fence, in the order they appear. */
function topLevelKeys(lines: readonly string[]): string[] {
  const keys: string[] = [];
  for (const line of lines) {
    const hit = TOP_LEVEL_KEY_RE.exec(line);
    if (hit !== null) keys.push(hit[1]!);
  }
  return keys;
}

/** The raw text after `key:` on its top-level line, or `undefined`. */
function scalarValue(lines: readonly string[], key: string): string | undefined {
  for (const line of lines) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trim();
  }
  return undefined;
}

/**
 * Does this scalar carry a `#` alternation comment (`ok  # ok | failed`)? That
 * is a template enumerating its options, not a report stating a fact — the
 * single most reliable tell that the subject is `/deliver`'s own SKILL rather
 * than something a worker emitted.
 */
function hasTemplateAnnotation(value: string): boolean {
  return value.includes("#");
}

/**
 * The value a scalar STATES, with any `#` alternation comment stripped.
 *
 * Both readers of a scalar want the fact and not the annotation — `checkScalar`
 * to grade it against a pattern, `checkStatusAgainstCounts` to ask whether the
 * status is `ok`. Stripped in one place so the two can never disagree about
 * where a template comment starts.
 */
function scalarFact(raw: string): string {
  return raw.split("#")[0]!.trim();
}

function checkScalar(
  reasons: string[],
  lines: readonly string[],
  key: string,
  allowed: RegExp,
  expectation: string,
): void {
  const raw = scalarValue(lines, key);
  if (raw === undefined) {
    reasons.push(`\`${key}:\` is missing from the fence`);
    return;
  }
  if (hasTemplateAnnotation(raw)) {
    reasons.push(
      `\`${key}:\` carries a \`#\` alternation comment (${JSON.stringify(raw)}) — ` +
        `that is a template enumerating its options, not a capture reporting a value`,
    );
  }
  const value = scalarFact(raw);
  if (!allowed.test(value)) {
    reasons.push(
      `\`${key}:\` is ${JSON.stringify(value)}, not ${expectation} — a placeholder ` +
        `is a template, not a captured worker report`,
    );
  }
}

/**
 * The counts EVERY evidence section's list item owes. `skip` is load-bearing:
 * it is the one a silent-skip run omits, and a line carrying only pass and fail
 * reads as a clean run while hiding every newly skipped test.
 */
const REQUIRED_SECTION_COUNTS = ["pass", "fail", "skip"] as const;

/**
 * What `gate:` owes ON TOP of the three. The baseline is the shipped STE-509
 * one; the delta is what it implies. Both are named so an UNMEASURED baseline
 * (`baseline unmeasured`, carrying no delta) is refused rather than read as a
 * silent zero — a missing count is a refusal ground, never a benign 0.
 */
const REQUIRED_GATE_COUNTS = ["baseline", "delta"] as const;

/** The legal empty-section fallback, in any list section. */
const EMPTY_ITEM_RE = /^[ \t]*-[ \t]*\(none found\)[ \t]*$/;

/**
 * A list item under a section — `- ...`, at ANY indentation INCLUDING NONE.
 *
 * `EVIDENCE_ITEM_RE` is imported rather than respelled: this clause and
 * `parseEvidenceLines` must agree about what an item IS, and when they did not
 * — this side demanding leading whitespace, that side demanding none, and
 * `EMPTY_ITEM_RE` right here already lenient — a counts line at column 0 was
 * read back as a claim by one half and graded by neither
 * `checkEvidenceCounts` nor `checkEvidenceCardinality`. Two spellings of one
 * question is the hole; one exported predicate is the fix.
 */
const LIST_ITEM_RE = EVIDENCE_ITEM_RE;

/** The list items belonging to one top-level section, in order. */
function sectionItems(lines: readonly string[], key: string): string[] {
  const items: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (TOP_LEVEL_KEY_RE.test(line)) {
      inside = line.startsWith(`${key}:`);
      continue;
    }
    if (inside && LIST_ITEM_RE.test(line)) items.push(line);
  }
  return items;
}

/**
 * Does this item state `<word> <number>` — the one rendered count shape?
 *
 * PRESENCE, NOT VALUE, and deliberately permissive about the sign: only `delta`
 * can legitimately be negative, but a fence saying `pass -3` has still STATED a
 * pass count, and reading it as absent would answer the wrong question here.
 * A nonsensical value is the cross-check's subject — it will disagree with the
 * number derived from the capture — not this clause's.
 */
function statesCount(item: string, word: string): boolean {
  return new RegExp(`\\b${word}\\s+-?\\d+\\b`).test(item);
}

/** How a count reads in a diagnostic; `null` is "unmeasured", never `0`. */
function countText(value: number | null): string {
  return value === null ? "unmeasured" : String(value);
}

/**
 * Grade the counts the three evidence sections carry.
 *
 * The rule is per-ITEM, not per-section: `- (none found)` stays legal (the
 * reduced chain depends on it), but an item that reports numbers at all must
 * report all of them.
 */
function checkEvidenceCounts(reasons: string[], fenceLines: readonly string[]): void {
  for (const section of EVIDENCE_SECTIONS) {
    const owed = [
      ...REQUIRED_SECTION_COUNTS,
      ...(section === "gate" ? REQUIRED_GATE_COUNTS : []),
    ];
    for (const item of sectionItems(fenceLines, section)) {
      if (EMPTY_ITEM_RE.test(item)) continue;
      const missing = owed.filter((word) => !statesCount(item, word));
      if (missing.length === 0) continue;
      reasons.push(
        `\`${section}:\` states ${JSON.stringify(item.trim())}, which carries no ` +
          `${missing.join(", ")} count — a counts line owes ${owed.join(", ")}; ` +
          "an omitted count is a refusal ground, and `- (none found)` is the only " +
          "way to report that the section never ran",
      );
    }
  }
}

/**
 * ONE RUN, ONE COUNTS LINE — an evidence section is a summary, not a log.
 *
 * THE HOLE THIS CLOSES. `parseEvidenceLines` stops at a section's FIRST counts
 * line, so every line beneath it is invisible both to the status check below
 * and to the cross-check. A worker can print a clean line and BURY the real one
 * under it: `fail 3` sits inside the fence, `status: ok` sits above it, and the
 * report grades clean. The total line cap cannot catch that — six counts lines
 * under `gate:` is eighteen fence lines, comfortably under the cap — so only a
 * per-section rule refuses a section that pastes a sequence of runs where one
 * run's summary belongs.
 *
 * A section states the counts of ONE run, or the single `- (none found)`
 * fallback saying it never ran. Anything more is refused by name.
 */
function checkEvidenceCardinality(reasons: string[], fenceLines: readonly string[]): void {
  for (const section of EVIDENCE_SECTIONS) {
    const items = sectionItems(fenceLines, section);
    if (items.length <= 1) continue;
    reasons.push(
      `\`${section}:\` carries ${items.length} items — an evidence section states ` +
        "exactly ONE run's counts (or the single `- (none found)` fallback). A " +
        "second line is either a second run, which belongs in the worker's own " +
        "session, or a real result buried under a clean one, which is how a " +
        "failing stage reports green",
    );
  }
}

/**
 * Refuse `status: ok` when the fence's OWN numbers say the stage did not pass.
 *
 * THE SECOND REFUSAL GROUND. `checkEvidenceCounts` above closes the first one —
 * a required count ABSENT. This closes the other: a count PRESENT and
 * INDICATING FAILURE. They are different defects with different causes (a
 * worker that omitted a number vs. a worker that reported a real one and then
 * asserted `ok` next to it), and closing only one leaves the other riding.
 *
 * The whole point of STE-510 is that `status: ok` stops being a worker's
 * ASSERTION and becomes a value DERIVED from evidence. `renderStageEvidence`
 * derives it from the captures; this derives it from the fence, so a hand-off
 * read on its own — with no captures to offer — is still graded against the
 * numbers it printed itself rather than taken at its word.
 *
 * `status: failed` beside failing counts is NOT touched: honesty is legal, and
 * a guard that refused it would fail the one report shape we most want workers
 * to emit.
 */
function checkStatusAgainstCounts(reasons: string[], fenceLines: readonly string[]): void {
  const raw = scalarValue(fenceLines, "status");
  if (raw === undefined || scalarFact(raw) !== "ok") return;

  const claimed = parseEvidenceLines(fenceLines);
  for (const section of EVIDENCE_SECTIONS) {
    const stated = claimed[section];
    // `- (none found)` states nothing, so it indicates nothing. Absence is
    // ground one's subject, graded there.
    if (stated === null) continue;

    if (stated.fail > 0) {
      reasons.push(
        `\`status: ok\` beside \`${section}:\` stating fail ${stated.fail} — a ` +
          "count indicating failure refuses `ok`; the status is DERIVED from the " +
          "evidence, never asserted next to it",
      );
    }
    if (stated.delta !== null && stated.delta > 0) {
      reasons.push(
        `\`status: ok\` beside \`${section}:\` stating a skip delta of ` +
          `${stated.delta} against a baseline of ${countText(stated.baseline)} — ` +
          "newly skipped tests are a count indicating failure, and a stage that " +
          "silently skips its way to green is the defect this section exists to catch",
      );
    }
  }
}

/**
 * The counts cross-checked against the captures, in the order they render.
 *
 * DERIVED from the two owed-count lists rather than restated as a third
 * literal: what a section OWES and what gets cross-checked are the same set by
 * construction, so a count added to the contract cannot be graded for presence
 * and then quietly skipped by the comparison.
 *
 * `baseline` and `delta` are gate-only and `null` elsewhere on BOTH sides, so
 * comparing them everywhere is correct rather than merely harmless.
 */
const CROSS_CHECKED_COUNTS: readonly (keyof EvidenceCounts)[] = [
  ...REQUIRED_SECTION_COUNTS,
  ...REQUIRED_GATE_COUNTS,
];

/**
 * Cross-check the numbers a fence STATES against numbers re-derived from the
 * captures behind it.
 *
 * THE DEFECT THIS CLOSES. Every shape clause above grades the fence's FORM.
 * A worker composing the block from memory satisfies all of them — right
 * sections, right order, under the cap, plausible numbers — and the report is
 * evidentially worthless. The only thing that can tell an authored number from
 * a read one is the capture it claims to come from.
 *
 * ONE FAILURE MODE, DELIBERATELY. A counts disagreement pushes onto the SAME
 * `reasons` array as a missing section or a blown cap, so the caller sees one
 * `{ ok: false, reasons }` verdict and nothing else. That is the whole point:
 * `/deliver`'s shipped bounded-retry-then-halt path already handles that
 * verdict, and a second failure mode here — a throw, a distinct return shape, a
 * separate severity — would need its own recovery, its own retry budget and its
 * own halt clause. Inheriting the existing path is the design; forking a new
 * one is the bug.
 */
function crossCheckEvidence(
  reasons: string[],
  fenceLines: readonly string[],
  evidence: StageEvidenceInput,
): void {
  let rendered: ReturnType<typeof renderStageEvidence>;
  try {
    rendered = renderStageEvidence(evidence);
  } catch (error) {
    // Never a throw out of this function: a cross-check that blew up would be a
    // second failure mode by the back door, and the caller has no path for it.
    reasons.push(
      "the captures behind this fence could not be re-derived: " +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  // The evidence layer's own refusal grounds ARE this verdict's reasons — same
  // array, same channel, same bounded-retry-then-halt path.
  reasons.push(...rendered.reasons);

  const claimed = parseEvidenceLines(fenceLines);
  for (const section of EVIDENCE_SECTIONS) {
    const stated = claimed[section];
    const derived = rendered.counts[section];

    if (stated === null) {
      // `- (none found)` claims nothing — legal only when nothing was captured.
      if (derived !== null) {
        reasons.push(
          `\`${section}:\` reports no counts, but ${JSON.stringify(
            evidence[section]?.command ?? "the captured run",
          )} was captured and derives pass ${derived.pass}, fail ${derived.fail}, ` +
            `skip ${derived.skip} — a section may only fall back to \`- (none found)\` ` +
            "when it genuinely never ran",
        );
      }
      continue;
    }

    if (derived === null) {
      reasons.push(
        `\`${section}:\` states pass ${stated.pass}, fail ${stated.fail}, skip ` +
          `${stated.skip} with NO captured run behind them — every number in the ` +
          "fence must trace to bytes a command really emitted, never to the " +
          "reporting worker's memory",
      );
      continue;
    }

    for (const word of CROSS_CHECKED_COUNTS) {
      if (stated[word] === derived[word]) continue;
      reasons.push(
        `\`${section}:\` states ${word} ${countText(stated[word])}, but the ` +
          `capture behind it derives ${word} ${countText(derived[word])} — a fence ` +
          "count that disagrees with its capture is a contract violation, graded " +
          "exactly like a shape violation",
      );
    }
  }
}

/**
 * Grade the `summary` section for the receipt — the FIRST content this
 * verifier has ever demanded of `summary`, and demanded only of a chain that
 * actually carried a step that ran outside this session (the caller gates on
 * `chainRequiresSpawnReceipt`, so the inline path is untouched).
 *
 * Four distinct failures, never merged into one:
 *
 *   * ABSENT — the chain spawned, and `summary` carries no receipt at all.
 *     This is the shape STE-516 exists to close: on the run that prompted the
 *     FR every step ran in the orchestrating session and the fence still
 *     graded clean, because `summary` was ungraded. The reason names the
 *     section and the literal prefix the missing line must start with, so the
 *     operator is told what to add rather than only that something is wrong.
 *     A `- (none found)` fallback is not a receipt: it does not parse, and it
 *     does not carry the prefix either, so it lands here exactly like an empty
 *     summary.
 *
 *   * MALFORMED — a line CLAIMS the receipt prefix and does not parse: the
 *     fields transposed, a field missing, a value empty. Split out from ABSENT
 *     deliberately. A transposed line does not parse, so a grader that only
 *     asked `parseSpawnReceipt` would answer it with the absent sentence and
 *     send an operator who mis-ordered two fields off to add a line that is
 *     already there. The two situations have different remedies, so they get
 *     different refusals — and a reader can see from the texts alone that both
 *     guards exist rather than one guard firing twice.
 *
 *   * UNOWNED — a receipt parses and carries a non-zero `owned`, i.e. the
 *     stage transcribed an ownership check that FAILED and reported it as
 *     evidence anyway. Graded here rather than trusted: `owned` was parsed and
 *     never read, so a hand-composed fence stating a failed check graded clean
 *     — the same fail-open shape the absent branch closes, one field over. The
 *     OBSERVED code is quoted (the AC.5 idiom): "owned must be 0" tells an
 *     operator nothing about WHICH ownership outcome was reported, and exit 2
 *     (no ledger row) and exit 3 (a live session holds the name) have nothing
 *     in common as remedies. Checked before the handle comparison and returning
 *     immediately, because a check that did not resolve resolved no handle to
 *     compare against.
 *
 *   * MISMATCHED — a receipt is present but names a handle the ownership
 *     check did not resolve. The comparison — not the line's SHAPE — is the
 *     discriminator. A handle the reporting stage composed is well-formed by
 *     construction, so a shape-only guard would wave it through; what refuses
 *     it is that it disagrees with what the check resolved. Both handles are
 *     named so the operator sees WHICH two disagreed.
 *
 * The absent check does NOT depend on `spawn.handle`: a chain that spawned
 * owes a receipt whether or not the caller can say which handle to expect.
 * Gating absence on a known handle would reopen the fail-open hole for every
 * caller that omits it.
 */
function checkSpawnReceipt(
  reasons: string[],
  fenceLines: readonly string[],
  spawn: StageSpawnExpectation,
): void {
  const receipt = parseSpawnReceipt(fenceLines);
  if (receipt === null) {
    const claimed = findSpawnReceiptLine(fenceLines);
    if (claimed !== null) {
      reasons.push(
        `the summary section carries a ${JSON.stringify(SPAWN_RECEIPT_PREFIX)} ` +
          `item that is not a receipt: ${JSON.stringify(claimed.trim())} — the ` +
          `fields are fixed in the order ` +
          `${SPAWN_RECEIPT_FIELDS.join(", ")}, each with a non-empty value, so ` +
          "a transposed, incomplete or empty-valued line is receipt-shaped " +
          "prose rather than a receipt",
      );
      return;
    }
    reasons.push(
      `the chain carried a step that did not run inline, but the summary ` +
        `section carries no spawn receipt — a stage that spawned a worker reports one ` +
        `${JSON.stringify(SPAWN_RECEIPT_PREFIX)} item under \`summary:\`, and a ` +
        "stage cannot report a spawn it did not perform",
    );
    return;
  }
  if (receipt.owned !== 0) {
    reasons.push(
      `the spawn receipt reports ownership exit code ${receipt.owned} — only ` +
        "`owned=0` is an ownership check that resolved, so a receipt carrying " +
        `\`owned=${receipt.owned}\` reports a spawn whose ownership was never ` +
        "established, and a stage cannot report a spawn it did not perform",
    );
    return;
  }
  const expected = spawn.handle;
  if (expected === undefined) {
    // AUDIT-4 ITEM 1. This branch used to `return` — a clean grade — which made
    // the comparison CALLER-OPTIONAL: a worker chain whose fence carried a
    // wholly fabricated handle graded clean whenever the caller supplied the
    // chain but not the handle. `handle` stays optional on the shape so that
    // ABSENCE of the receipt never depends on the caller, but a chain that OWES
    // a receipt and has nothing to corroborate it against is refused, because a
    // receipt nothing corroborates is exactly the narrated evidence this
    // contract exists to eliminate.
    //
    // ORDER IS LOAD-BEARING: this sits AFTER the absent/malformed branches and
    // AFTER the `owned !== 0` branch, so the observed exit code — the more
    // actionable fact — stays the reason whenever there is one.
    reasons.push(
      "the chain carried a step that did not run inline and the summary " +
        "section carries a spawn receipt, but the grader was given no resolved " +
        "handle to corroborate it against — pass the handle the ownership " +
        "check resolved as the `handle` of the spawn expectation, so the " +
        "receipt is checked against what was resolved rather than taken on the " +
        "reporting stage's word",
    );
    return;
  }
  if (receipt.handle !== expected) {
    reasons.push(
      `the spawn receipt names handle ${JSON.stringify(receipt.handle)}, but ` +
        `the ownership check resolved ${JSON.stringify(expected)} — a stage ` +
        "reports the handle the check resolved, never one it composed",
    );
  }
}

/**
 * Verify one captured stage report against the `deliver-stage-result` contract.
 *
 * Returns `{ ok: true, reasons: [] }` only for a capture that a ceremony stage
 * could genuinely have emitted: report prose, then exactly one well-formed
 * fence, with all eight sections in the canonical order and concrete scalars.
 * Every violated clause contributes its own reason, so a diagnostic names all
 * of what is wrong rather than only the first thing.
 */
export function verifyDeliverStageCapture(
  capturePath: string,
  evidence?: StageEvidenceInput | null,
  spawn?: StageSpawnExpectation | null,
): DeliverStageCaptureVerdict {
  let raw: string;
  try {
    raw = readFileSync(capturePath, "utf-8");
  } catch (error) {
    return {
      ok: false,
      reasons: [
        `capture ${JSON.stringify(capturePath)} could not be read: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      ],
      // Nothing was cross-checked here — there were no bytes to cross-check
      // against — and a verdict that claimed otherwise would be the label
      // lying about the grade.
      graded: GRADE_SHAPE_ONLY,
    };
  }

  const body = normalize(raw);
  const lines = body.split("\n");
  const reasons: string[] = [];

  // The fence walk is `markdown_fences.findFences` — the one scanner shared
  // with the ```bash probes and the `tdd-result` parser. Only the grading
  // policy below is this contract's own.
  const fences = findFences(body, FENCE_OPEN, FENCE_CLOSE);

  if (fences.length === 0) {
    // Deliberately the whole verdict: with no fence there is nothing to check
    // sections or scalars against, and appending six phantom "missing section"
    // reasons would bury the one fact that matters.
    return {
      ok: false,
      reasons: [
        "capture carries no ```deliver-stage-result fence — a stage report " +
          "must end with exactly one, and prose naming the contract is not one",
      ],
      graded: GRADE_SHAPE_ONLY,
    };
  }
  if (fences.length > 1) {
    reasons.push(
      `capture carries ${fences.length} \`deliver-stage-result\` fences — ` +
        "the contract is exactly one, as the last thing in the report",
    );
  }

  const fence = fences[0]!;
  if (fence.endLine < 0) {
    return {
      ok: false,
      reasons: [
        ...reasons,
        "the ```deliver-stage-result fence is never closed — an unterminated " +
          "fence is not a hand-off the orchestrator can read",
      ],
      graded: GRADE_SHAPE_ONLY,
    };
  }
  const fenceLines = fence.lines;

  const prose = lines.slice(0, fence.startLine - 1).join("\n").trim();
  if (prose.length < MIN_PROSE_CHARS) {
    reasons.push(
      `only ${prose.length} characters of report prose precede the fence — a ` +
        "bare fence is a snippet, not a captured stage report",
    );
  }

  if (fenceLines.length > FENCE_LINE_CAP) {
    reasons.push(
      `the fence holds ${fenceLines.length} lines, over the ${FENCE_LINE_CAP}-line cap`,
    );
  }

  const canonical = DELIVER_STAGE_SECTIONS as readonly string[];
  const keys = topLevelKeys(fenceLines);
  const missing = canonical.filter((name) => !keys.includes(name));
  if (missing.length > 0) {
    reasons.push(
      `fence is missing section(s) ${missing.join(", ")} — sections are never ` +
        "omitted; an empty one keeps its heading and carries `- (none found)`",
    );
  }
  const known = keys.filter((key) => canonical.includes(key));
  if (missing.length === 0 && known.join(",") !== canonical.join(",")) {
    reasons.push(
      `fence sections are out of order: got ${known.join(" < ")}, expected ` +
        `${canonical.join(" < ")} — the section order is fixed, never reordered`,
    );
  }

  checkScalar(
    reasons,
    fenceLines,
    "stage",
    new RegExp(`^(?:${STAGE_VALUES.join("|")})$`),
    `one of ${STAGE_VALUES.join(" | ")}`,
  );
  checkScalar(
    reasons,
    fenceLines,
    "milestone",
    CONCRETE_MILESTONE_RE,
    "a concrete milestone identity (`M<digits>` or `M_<epic-key>`)",
  );
  checkScalar(
    reasons,
    fenceLines,
    "status",
    new RegExp(`^(?:${STATUS_VALUES.join("|")})$`),
    `one of ${STATUS_VALUES.join(" | ")}`,
  );

  checkEvidenceCounts(reasons, fenceLines);
  checkEvidenceCardinality(reasons, fenceLines);
  checkStatusAgainstCounts(reasons, fenceLines);

  // Second argument absent ⇒ shape checks only, exactly as before STE-510: the
  // caller has no captures to offer, and inventing a verdict about numbers it
  // never supplied would fail every healthy shape-only call.
  const crossChecked = evidence !== undefined && evidence !== null;
  if (crossChecked) {
    crossCheckEvidence(reasons, fenceLines, evidence);
  }

  // Third argument absent ⇒ the spawn is not graded at all, and a chain that
  // spawned nothing owes no receipt: the inline path is graded exactly as it
  // was before this argument existed.
  if (
    spawn !== undefined &&
    spawn !== null &&
    chainRequiresSpawnReceipt(spawn.chain)
  ) {
    checkSpawnReceipt(reasons, fenceLines, spawn);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    graded: crossChecked ? GRADE_EVIDENCE_BACKED : GRADE_SHAPE_ONLY,
  };
}
