// stage_status_block — grades a RENDERED stage report (STE-532).
//
// The sibling grader `deliver_stage_capture.ts` measures the hand-off between
// MACHINES: it reads a capture off disk and budgets the lines INSIDE the fence
// (`FENCE_LINE_CAP`). The surface a HUMAN reads is the whole report — prose
// lead-in plus fence — and that span is measured by nothing today: a report
// with a perfectly compliant fence and forty lines of narration bolted above
// it grades clean under the fence-only cap. This module owns that second span.
//
// It is a POLICY over the shipped primitives, never a second parser: the fence
// walk is delegated to `findFences` (STE-532.6) and the section order is
// imported from `deliver_stage_capture.ts`, the one place the eight names are
// listed (STE-532.2). A private copy of either is the two-renderers defect this
// repository has already recorded.
//
// Pure and read-only: it takes the report TEXT, not a path. Handing it a path
// would grade the path.

import {
  DELIVER_STAGE_FENCE_BANNER,
  DELIVER_STAGE_SECTIONS,
} from "./deliver_stage_capture";
import {
  EVIDENCE_SECTIONS,
  parseEvidenceLines,
  type StageEvidenceInput,
} from "./deliver_stage_evidence";
import { findFences } from "./markdown_fences";

/**
 * Opening / closing markers, built from the SHIPPED banner so the two cannot
 * drift, and indentation-tolerant for the same reason the capture grader is: a
 * report relayed through a nested list keeps the fence but not column 0.
 */
const FENCE_OPEN = new RegExp(
  "^[ \\t]*" + DELIVER_STAGE_FENCE_BANNER + "[ \\t]*$",
);
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;

/** A top-level section heading inside the fence body (`name:` at column 0). */
const SECTION_HEADING_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;

/**
 * THE fixed section order — re-exported, not restated. `DELIVER_STAGE_SECTIONS`
 * is the single home of the eight names; a second literal listing here would be
 * exactly the drift AC-STE-532.2 exists to forbid.
 */
export const STAGE_STATUS_SECTIONS = DELIVER_STAGE_SECTIONS;

/**
 * The sections carrying a single scalar value rather than a list. They are
 * excluded from the empty-section fallback rule: a scalar cannot be "empty with
 * a list item in it".
 */
export const SCALAR_STATUS_SECTIONS = [
  "stage",
  "milestone",
  "status",
] as const;

/**
 * Widened views of the two tuples above, spelled ONCE.
 *
 * Both exports are `as const` tuples, so every `includes` / `filter` against a
 * plain `string` needs the same widening. Each acceptance criterion's pass over
 * this module re-typed it inline, and the copies were only ever going to
 * multiply. Naming them here means the partition just below and the grading in
 * `verifyStageStatusBlock` read the SAME binding rather than four spellings of
 * it — and neither is exported, because the widened view is an implementation
 * detail of this file, not a second public spelling of the order.
 */
const SECTION_ORDER: readonly string[] = STAGE_STATUS_SECTIONS;
const SCALAR_NAMES: readonly string[] = SCALAR_STATUS_SECTIONS;

/**
 * The list-bearing sections — DERIVED from the order minus the scalars, so the
 * two lists partition the order by construction rather than by inspection.
 */
export const LIST_STATUS_SECTIONS: readonly string[] = SECTION_ORDER.filter(
  (name) => !SCALAR_NAMES.includes(name),
);

/** The one literal a list-bearing section with nothing to report carries. */
export const EMPTY_SECTION_FALLBACK = "- (none found)";

/**
 * Line cap over the WHOLE report — prose lead-in included.
 *
 * Sized as the fence budget plus a lead-in allowance: the 26 lines the fence
 * itself may hold (`FENCE_LINE_CAP`), its two markers, and a dozen lines of
 * prose to say what the stage did before the numbers start. Past that the
 * operator is scrolling, which is the condition this FR exists to end.
 *
 * Exported because the authoring surfaces restate the budget in prose and must
 * read the number from here rather than keep a second literal.
 */
export const STAGE_REPORT_LINE_CAP = 40;

/** One verdict shape, one channel: `reasons` is empty iff `ok`. */
export interface StageStatusVerdict {
  ok: boolean;
  reasons: readonly string[];
}

/** One top-level section of a fence body: its heading line plus its body. */
interface SectionBlock {
  name: string;
  lines: string[];
}

/** The top-level sections present in a fence body, in the order found. */
function sectionBlocks(body: readonly string[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  for (const line of body) {
    const match = SECTION_HEADING_RE.exec(line);
    if (match !== null) {
      blocks.push({ name: match[1]!, lines: [line] });
      continue;
    }
    if (blocks.length > 0) blocks[blocks.length - 1]!.lines.push(line);
  }
  return blocks;
}

/**
 * Grade a rendered stage report against the status-block contract.
 *
 * `report` is the full text a human sees, prose lead-in and fence together.
 * `evidence`, when supplied, additionally grades the stated counts against
 * what was actually captured (AC-STE-532.5); omitted, the report is graded on
 * shape alone.
 */
export function verifyStageStatusBlock(
  report: string,
  evidence?: StageEvidenceInput | null,
): StageStatusVerdict {
  const reasons: string[] = [];
  const lines = report.split("\n");

  if (lines.length > STAGE_REPORT_LINE_CAP) {
    reasons.push(
      `the report runs ${lines.length} lines, over the ` +
        `${STAGE_REPORT_LINE_CAP}-line whole-report cap (prose lead-in included)`,
    );
  }

  const fences = findFences(report, FENCE_OPEN, FENCE_CLOSE).filter(
    (fence) => fence.endLine > 0,
  );
  if (fences.length !== 1) {
    reasons.push(
      fences.length === 0
        ? "no closed deliver-stage-result status fence found in the report"
        : `${fences.length} deliver-stage-result status fences found; the report carries exactly one`,
    );
    return { ok: false, reasons };
  }

  const blocks = sectionBlocks(fences[0]!.lines);
  const found = blocks.map((block) => block.name);

  const missing = SECTION_ORDER.filter((name) => !found.includes(name));
  for (const name of missing) {
    reasons.push(
      `required section \`${name}\` is missing from the status block`,
    );
  }

  // Order is graded over the sections actually PRESENT, so a drop reports as a
  // drop rather than dragging every later section into a bogus order refusal.
  const expected = SECTION_ORDER.filter((name) => found.includes(name));
  const actual = found.filter((name) => SECTION_ORDER.includes(name));
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] === expected[i]) continue;
    reasons.push(
      `section \`${actual[i]}\` is out of order: position ${i + 1} of the ` +
        `status block belongs to \`${expected[i]}\``,
    );
  }

  // A scalar section holds ONE inline value on its heading line. The
  // empty-section fallback is a list item, so a scalar can never carry it: a
  // section with nothing to report is a list-bearing section by construction.
  for (const block of blocks) {
    if (!SCALAR_NAMES.includes(block.name)) continue;
    const inline = block.lines[0]!.slice(block.name.length + 1).trim();
    const body = block.lines.slice(1).filter((line) => line.trim().length > 0);
    if (inline.length > 0 && body.length === 0) continue;
    reasons.push(
      `section \`${block.name}\` is scalar: it carries one inline value on its ` +
        `heading line and cannot take the \`${EMPTY_SECTION_FALLBACK}\` fallback`,
    );
  }

  // A BARE HEADING (AC-STE-532.4). The rule has two clauses — a section with
  // nothing to report KEEPS ITS HEADING, and CARRIES THE LITERAL fallback — and
  // only the first was graded: a section reduced to its heading alone is not
  // missing, is not out of order and is not a scalar carrying a list item, so it
  // slipped past every other clause. It is also the shape a worker actually
  // emits when it has nothing to say, which is the whole reason the fallback
  // exists. Driven off `LIST_STATUS_SECTIONS` and `EMPTY_SECTION_FALLBACK`, the
  // bindings that already name the subject and the remedy — a second literal
  // listing of either is the drift AC-STE-532.2 forbids.
  for (const block of blocks) {
    if (!LIST_STATUS_SECTIONS.includes(block.name)) continue;
    const items = block.lines
      .slice(1)
      .filter((line) => line.trim().startsWith("-"));
    if (items.length > 0) continue;
    reasons.push(
      `section \`${block.name}\` carries no list items: a list-bearing ` +
        `section with nothing to report keeps its heading and carries the ` +
        `literal \`${EMPTY_SECTION_FALLBACK}\``,
    );
  }

  // A NUMBER WITH NOTHING BEHIND IT (AC-STE-532.5). The stated counts are read
  // back through `parseEvidenceLines` — the shipped reader for the one rendered
  // line shape, never a second parse of it — and every section that states a
  // count must have a captured run to trace it to. Graded only when an evidence
  // input is supplied: its absence means "grade on shape alone", and inventing
  // a refusal there would refuse every caller that has no captures to offer.
  //
  // The refusal lands in `reasons`, on the same `{ ok, reasons }` channel a
  // structural violation uses — no second severity, no throw, no second budget.
  // `/deliver`'s existing recovery path already reads this array, so an invented
  // number takes the path a missing section takes and earns nothing of its own.
  if (evidence !== undefined && evidence !== null) {
    const stated = parseEvidenceLines(fences[0]!.lines);
    for (const section of EVIDENCE_SECTIONS) {
      if (stated[section] === null) continue;
      const run = evidence[section] ?? null;
      if (run !== null && run.output.length > 0) continue;
      reasons.push(
        `section \`${section}\` states counts with no captured run behind ` +
          "them — a number that traces to nothing is refused",
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}
