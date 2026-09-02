// M137 ROUND 2 — THE CAP-EXEMPT EXEMPTION IS BOUNDED.
//
// THE DEFECT THIS SUITE EXISTS FOR, reproduced on the shipped code 2026-09-01:
//
//     STAGE_REPORT_LINE_CAP = 40
//     report lines = 169   (the maximal legal 49 + 120 appended list rows)
//     verifyStageReportAdoption(report) -> {"ok":true,"reasons":[]}
//
// A valid fence, both mandated cap-exempt sections, and then a hundred and
// twenty narration paragraphs written as LIST ROWS under `## Advisory notes`.
// Graded clean. The PRE-FIX module — the one that shipped before AC-STE-533.2a's
// carve-out reached its sections' bodies — refused the identical bytes with
// "the report runs 169 lines, over the 40-line whole-report cap".
//
// MECHANISM. `isRenderedBodyLine` forgives ANY list row under an exempt
// heading, and `exemptSectionIndexes` then DELETES every exempt-owned line
// before `verifyStageStatusBlock` ever counts. The exemption is therefore
// UNBOUNDED, and the whole-report cap — this FR's headline budget — is defeated
// through its own carve-out.
//
// WHY THE PREVIOUS ROUND MISSED IT, which is what decides the shape of this
// suite. That round wrote a discriminator — "free prose smuggled under an
// exempt heading is still refused" — and verified it passes. It does. But free
// prose is not the vector: a LIST ROW is, because a list row is what the
// renderer emits and what `isRenderedBodyLine` forgives. The test measured the
// shape its author IMAGINED rather than the shape the producer EMITS. So this
// suite does NOT write a third vector-specific discriminator. It asserts a
// BOUND, which makes the vector irrelevant: once there is a ceiling on how many
// lines an exempt section may own, it stops mattering what shape the extra
// lines take.
//
// THE CONTRACT PINNED HERE:
//
//   1. Every `CAP_EXEMPT_SECTIONS` entry carries its own SECTION BUDGET, and
//      the budget is DERIVED from that section's shipped renderer — read from
//      the renderer, never typed, so the budget cannot drift from what the
//      renderer actually emits (this milestone's own single-sourcing rule,
//      applied to itself).
//   2. A section rendered exactly as its renderer emits it is fully forgiven.
//   3. A section carrying MORE lines than its budget is REFUSED, whatever shape
//      the extra lines take — list rows, prose, bare `name:` keys, or
//      blank-separated paragraphs — and the refusal NAMES the section and the
//      budget.
//   4. Therefore there is a STATED CEILING on an accepted report:
//      `STAGE_REPORT_LINE_CAP` plus every exempt budget the stage owes. The
//      property is asserted over the MAXIMAL LEGAL COMPOSITION rather than over
//      one example, so a future carve-out cannot re-open the hole without
//      reddening this file.
//   5. The module's own comments state what is TRUE. The shipped comment at
//      `stage_block_adoption.ts` asserted the opposite — "Narration bloat is
//      refused exactly as before" — which is measurably false and shipped.
//
// Everything numeric below is computed from the SHIPPED exported constants and
// the SHIPPED renderers. Nothing here is a hand-typed snapshot, except the two
// counts that describe the reproduced defect itself, which are stated so the
// reproduction stays legible.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE NAMESPACE IMPORT IS DELIBERATE. Three of the bindings this suite pins do
// not exist yet, and a missing NAMED import is a module-load error that reddens
// every test in the file with no assertion behind any of them. Reached through
// the namespace, each leg fails on an assertion about the API it needs, which
// is the difference between a RED test and a broken file.
import * as adoption from "../adapters/_shared/src/stage_block_adoption";
import {
  ADOPTED_FENCE_LINE_CAP,
  ADOPTING_STAGES,
  CAP_EXEMPT_SECTIONS,
  exemptSectionsFor,
  verifyStageReportAdoption,
  type CapExemptSection,
} from "../adapters/_shared/src/stage_block_adoption";
import {
  EMPTY_SECTION_FALLBACK,
  LIST_STATUS_SECTIONS,
  SCALAR_STATUS_SECTIONS,
  STAGE_BLOCK_FENCE_BANNER,
  STAGE_REPORT_LINE_CAP,
  STAGE_STATUS_SECTIONS,
} from "../adapters/_shared/src/stage_status_block";
import {
  IMPLEMENT_EVIDENCE_HEADING,
  renderImplementReportEvidence,
} from "../adapters/_shared/src/implement_report_evidence";

// ----------------------------------------------------------------------- paths

const PLUGIN_ROOT = join(import.meta.dir, "..");
const ADOPTION_MODULE_REL = "adapters/_shared/src/stage_block_adoption.ts";
const ADOPTION_MODULE_SRC = join(PLUGIN_ROOT, ...ADOPTION_MODULE_REL.split("/"));
const STATUS_BLOCK_DOC = join(PLUGIN_ROOT, "docs", "stage-status-block.md");

const read = (path: string): string => readFileSync(path, "utf-8");
const skillPath = (stage: string): string =>
  join(PLUGIN_ROOT, "skills", stage, "SKILL.md");

// ------------------------------------------------------- the API under test
//
// Reached through the namespace, and asserted to EXIST before it is used. A
// leg that called an absent export directly would throw a TypeError, and a
// TypeError is not a measurement.

/** The per-section budget accessor this suite pins. */
function budgetOf(entry: CapExemptSection): number {
  const fn = (adoption as Record<string, unknown>)["exemptSectionBudget"];
  expect(typeof fn).toBe("function");
  return (fn as (e: CapExemptSection) => number)(entry);
}

/** The section's own renderer, at the largest size that renderer can emit. */
function renderMaxOf(entry: CapExemptSection): readonly string[] {
  const fn = (entry as unknown as Record<string, unknown>)["renderMax"];
  expect(typeof fn).toBe("function");
  return (fn as () => readonly string[]).call(entry);
}

/** The stated ceiling on an ACCEPTED report for one stage. */
function maxReportLines(stage: string): number {
  const fn = (adoption as Record<string, unknown>)["maxAdoptedReportLines"];
  expect(typeof fn).toBe("function");
  return (fn as (s: string) => number)(stage);
}

// ------------------------------------------------------------ report surgery

const FENCE_OPEN_RE = new RegExp(
  `^[ \\t]*${STAGE_BLOCK_FENCE_BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`,
);
const FENCE_CLOSE_RE = /^[ \t]*```[ \t]*$/;

const lineCount = (text: string): number => text.split("\n").length;

function fenceOpenIndex(report: string): number {
  return report.split("\n").findIndex((line) => FENCE_OPEN_RE.test(line));
}

function fenceCloseIndex(report: string): number {
  const all = report.split("\n");
  const open = fenceOpenIndex(report);
  return all.findIndex((line, i) => i > open && FENCE_CLOSE_RE.test(line));
}

/** The fence and nothing else — banner, body, closing marker. */
function blockOnly(stage: string): string {
  const scalarValue: Record<string, string> = {
    stage,
    milestone: "M137",
    status: "ok",
  };
  const scalars: readonly string[] = SCALAR_STATUS_SECTIONS;
  const body: string[] = [];
  for (const name of STAGE_STATUS_SECTIONS as readonly string[]) {
    if (scalars.includes(name)) {
      body.push(`${name}: ${scalarValue[name] ?? "ok"}`);
      continue;
    }
    body.push(`${name}:`, `  ${EMPTY_SECTION_FALLBACK}`);
  }
  const pad = ADOPTED_FENCE_LINE_CAP - body.length;
  if (pad < 0) {
    throw new Error(
      "the fixed section order no longer fits inside ADOPTED_FENCE_LINE_CAP — this " +
        "construction can no longer sit AT the stated budget",
    );
  }
  const firstList = body.indexOf(`${LIST_STATUS_SECTIONS[0]}:`);
  body.splice(
    firstList + 1,
    0,
    ...Array.from({ length: pad }, (_, i) => `  - row ${i + 1} of the summary`),
  );
  return [STAGE_BLOCK_FENCE_BANNER, ...body, "```"].join("\n");
}

/** A fence body at its cap, with NO prose — used where prose must not confound. */
const bareBlock = (stage: string): string => blockOnly(stage);

/** `n` lines of prose lead-in. */
const proseLines = (n: number): string[] =>
  Array.from(
    { length: n },
    (_, i) => `Prose ${i + 1}: what the stage did, in the operator's language.`,
  );

// ------------------------------------------- the cap-exempt sections, RENDERED
//
// Driven off the SHIPPED renderers, exactly as the sibling suite does: a
// hand-typed copy keeps passing on the day the renderer changes shape, which is
// the failure the pre-merge review already measured once.

/**
 * The `/implement` advisory section's empty-list body, READ OFF the surface
 * that mandates it. A reword of the mandate reaches these fixtures rather than
 * leaving them pinned to a dead literal.
 */
const ADVISORY_EMPTY_LITERAL: string = (() => {
  const m = /heading plus the literal line `([^`]+)`/.exec(read(skillPath("implement")));
  if (m === null) {
    throw new Error(
      "skills/implement/SKILL.md no longer mandates an empty-list literal for " +
        "`## Advisory notes`; the fixtures below were driven off that mandate",
    );
  }
  return m[1]!;
})();

/**
 * ONE cap-exempt section, rendered EXACTLY as its own shipped renderer emits
 * it. An entry with no renderer known here THROWS rather than being quietly
 * skipped — a silent skip is how a new entry rides in untested.
 *
 * This is the INDEPENDENT statement of what each renderer emits. The module's
 * own `renderMax` is compared against it below; a suite that read the module's
 * renderer and compared it to itself would pass on any budget at all.
 */
function renderedExemptSection(entry: CapExemptSection): readonly string[] {
  if (entry.heading === IMPLEMENT_EVIDENCE_HEADING) {
    return renderImplementReportEvidence({}).lines;
  }
  if (entry.stage === "implement" && /advisory/i.test(entry.heading)) {
    return [entry.heading, ADVISORY_EMPTY_LITERAL];
  }
  throw new Error(
    `no shipped renderer is known for cap-exempt section \`${entry.heading}\``,
  );
}

/** Every section `stage` OWES, each rendered by its own renderer, in list order. */
const owedSectionLines = (stage: string): string[] =>
  exemptSectionsFor(stage).flatMap((entry) => [...renderedExemptSection(entry)]);

/**
 * Every section `stage` owes, with `extra` spliced in immediately after the
 * named section's rendered body — i.e. INSIDE that section, before the next
 * heading. This is the smuggling position, and the only one that matters.
 */
function owedSectionsInflated(
  stage: string,
  heading: string,
  extra: readonly string[],
): string[] {
  const out: string[] = [];
  let spliced = false;
  for (const entry of exemptSectionsFor(stage)) {
    out.push(...renderedExemptSection(entry));
    if (entry.heading === heading) {
      out.push(...extra);
      spliced = true;
    }
  }
  if (!spliced) {
    throw new Error(`\`${heading}\` is not a cap-exempt section of \`${stage}\``);
  }
  return out;
}

/**
 * The report that respects EVERY budget the contract states, each at its face:
 * a full prose lead-in, a fence body at `ADOPTED_FENCE_LINE_CAP`, its two markers, and
 * every section the stage owes at exactly its renderer's size.
 *
 * This is Round A's "49-line maximal legal report", rebuilt from the shipped
 * constants so it tracks them rather than pinning yesterday's arithmetic.
 */
function maximalLegalReport(stage: string): string {
  return [
    ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP),
    bareBlock(stage),
    ...owedSectionLines(stage),
  ].join("\n");
}

// -------------------------------------------------------------- reason shapes

/** The whole-report cap refusal — STE-532's, in STE-532's own words. */
const isWholeReportCapReason = (reason: string): boolean =>
  /whole-report cap/i.test(reason);

/**
 * The SECTION-BUDGET refusal: it names the section and the budget, and says
 * "budget". Both halves matter — a refusal that named neither would leave the
 * operator holding "something is too long" with no section and no number.
 */
const isSectionBudgetReason = (
  reason: string,
  heading: string,
  budget: number,
): boolean =>
  reason.includes(heading) &&
  reason.includes(String(budget)) &&
  /budget/i.test(reason);

/** The stages that actually owe a cap-exempt section — derived, never listed. */
const exemptStages = (): readonly string[] => [
  ...new Set(CAP_EXEMPT_SECTIONS.map((entry) => entry.stage)),
];

// ============================================================================
// 1 — THE EXEMPTION IS BOUNDED
// ============================================================================

describe("M137 round 2 — every cap-exempt entry carries a DERIVED budget", () => {
  test("the carve-out is non-empty, so this suite has a subject", () => {
    expect(CAP_EXEMPT_SECTIONS.length).toBeGreaterThan(0);
    expect(exemptStages().length).toBeGreaterThan(0);
  });

  test("EVERY entry declares a renderer, and the renderer is deterministic", () => {
    // An entry with no renderer is an entry with no ceiling — unbounded by
    // omission, which is the hole this milestone is closing. Enumerated over
    // the REAL list, so an entry added tomorrow is graded the day it lands.
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const once = renderMaxOf(entry);
      const twice = renderMaxOf(entry);
      expect({ heading: entry.heading, lines: [...once] }).toEqual({
        heading: entry.heading,
        lines: [...twice],
      });
      expect(once.length).toBeGreaterThan(0);
      expect(once[0]).toBe(entry.heading);
      checked += 1;
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("each entry's renderer IS the section's shipped renderer, not a copy of it", () => {
    // Compared against this suite's INDEPENDENT statement of what each shipped
    // renderer emits. `## Verification evidence` comes from
    // `renderImplementReportEvidence`; `## Advisory notes` from the mandate in
    // `skills/implement/SKILL.md`. A module that snapshotted either would drift
    // the day the renderer changes, and this leg is what refuses that.
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      expect({ heading: entry.heading, lines: [...renderMaxOf(entry)] }).toEqual({
        heading: entry.heading,
        lines: [...renderedExemptSection(entry)],
      });
      checked += 1;
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("the BUDGET equals what the renderer emits — read from the renderer", () => {
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const budget = budgetOf(entry);
      expect(Number.isInteger(budget)).toBe(true);
      expect(budget).toBeGreaterThan(0);
      expect({ heading: entry.heading, budget }).toEqual({
        heading: entry.heading,
        budget: renderedExemptSection(entry).length,
      });
      checked += 1;
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("FALSIFIABILITY — a hand-typed number cannot satisfy the accessor", () => {
    // The accessor is handed SYNTHETIC entries whose renderers emit a known
    // number of lines. A `budget` read out of a table, or typed per entry,
    // answers the shipped numbers here and fails every one of these. Only an
    // accessor that genuinely calls the renderer passes.
    for (const size of [1, 2, 3, 5, 8, 13, 40]) {
      const synthetic = {
        stage: "implement",
        heading: "## Synthetic section",
        requiredBy: ADOPTION_MODULE_REL,
        renderMax: () => [
          "## Synthetic section",
          ...Array.from({ length: size - 1 }, (_, i) => `- row ${i + 1}`),
        ],
      } as unknown as CapExemptSection;
      expect({ size, budget: budgetOf(synthetic) }).toEqual({ size, budget: size });
    }
  });

  test("the budget is NOT typed into the carve-out list", () => {
    // The secondary pin on the same property, read off the source: a numeric
    // budget literal beside an entry is the drift this milestone forbids.
    const src = read(ADOPTION_MODULE_SRC);
    const start = src.indexOf("export const CAP_EXEMPT_SECTIONS");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n];", start);
    expect(end).toBeGreaterThan(start);
    const declaration = src.slice(start, end);
    expect(declaration).not.toMatch(/\b(?:budget|budgetLines|maxLines|lineCap)\s*:\s*\d+/i);
  });
});

describe("M137 round 2 — a section AT its budget is forgiven, OVER it is refused", () => {
  test("DIRECTION ONE — every owed section at exactly its budget is ACCEPTED", () => {
    let checked = 0;
    for (const stage of exemptStages()) {
      const before = [...owedSectionLines(stage), bareBlock(stage)].join("\n");
      const after = [bareBlock(stage), ...owedSectionLines(stage)].join("\n");
      expect({ stage, where: "before", verdict: verifyStageReportAdoption(before) }).toEqual(
        { stage, where: "before", verdict: { ok: true, reasons: [] } },
      );
      expect({ stage, where: "after", verdict: verifyStageReportAdoption(after) }).toEqual(
        { stage, where: "after", verdict: { ok: true, reasons: [] } },
      );
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  // THE SHAPES. The live vector is a LIST ROW, because that is what the
  // renderer emits and what `isRenderedBodyLine` forgives. The other three are
  // here so this suite is not a third guess at the vector: a bounded exemption
  // refuses ALL of them, and a shape-specific fix would leave one green.
  const OVERFLOW_SHAPES: readonly {
    name: string;
    lines: (n: number) => string[];
  }[] = [
    {
      name: "extra list rows (THE LIVE VECTOR)",
      lines: (n) =>
        Array.from(
          { length: n },
          (_, i) => `- Narration paragraph ${i + 1}, wearing a list marker.`,
        ),
    },
    {
      name: "extra free prose",
      lines: (n) =>
        Array.from(
          { length: n },
          (_, i) => `Narration paragraph ${i + 1}, under a correctly spelled heading.`,
        ),
    },
    {
      name: "extra bare `name:` keys",
      lines: (n) => Array.from({ length: n }, (_, i) => `extra${i + 1}:`),
    },
    {
      name: "extra blank-separated paragraphs",
      lines: (n) =>
        Array.from({ length: n }, (_, i) => [
          "",
          `Paragraph ${i + 1}: the report this milestone deleted, returning.`,
        ]).flat(),
    },
  ];

  for (const shape of OVERFLOW_SHAPES) {
    test(`DIRECTION TWO — one line over the budget as ${shape.name} is REFUSED`, () => {
      let checked = 0;
      for (const entry of CAP_EXEMPT_SECTIONS) {
        const budget = budgetOf(entry);
        // The exempt sections sit BEFORE the block, and the overflow is a
        // single line: the report stays under the whole-report cap and under
        // the prose lead-in cap, so NEITHER of those rules can carry this
        // verdict. Without that construction the leg would be re-pinning a
        // cap that already fires and calling it the new rule.
        const report = [
          ...owedSectionsInflated(entry.stage, entry.heading, shape.lines(1)),
          bareBlock(entry.stage),
        ].join("\n");
        expect(lineCount(report)).toBeLessThanOrEqual(maxReportLines(entry.stage));

        const verdict = verifyStageReportAdoption(report);
        expect({
          heading: entry.heading,
          ok: verdict.ok,
          named: verdict.reasons.some((r) => isSectionBudgetReason(r, entry.heading, budget)),
        }).toEqual({ heading: entry.heading, ok: false, named: true });
        checked += 1;
      }
      expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
    });
  }

  test("ISOLATION — the section-budget refusal is the ONLY reason that fires", () => {
    // The construction is deliberately legal in every other respect. A module
    // that refused this report through the whole-report cap or the prose cap
    // would pass the legs above while measuring something else entirely.
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const budget = budgetOf(entry);
      const report = [
        ...owedSectionsInflated(entry.stage, entry.heading, ["- one row too many"]),
        bareBlock(entry.stage),
      ].join("\n");
      const verdict = verifyStageReportAdoption(report);
      expect({
        heading: entry.heading,
        reasons: verdict.reasons.length,
        allBudget: verdict.reasons.every((r) =>
          isSectionBudgetReason(r, entry.heading, budget),
        ),
      }).toEqual({ heading: entry.heading, reasons: 1, allBudget: true });
      checked += 1;
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("the refusal names the SECTION and the BUDGET, not a bare complaint", () => {
    const entry = CAP_EXEMPT_SECTIONS[0]!;
    const budget = budgetOf(entry);
    const report = [
      ...owedSectionsInflated(entry.stage, entry.heading, [
        "- smuggled row one",
        "- smuggled row two",
      ]),
      bareBlock(entry.stage),
    ].join("\n");
    const verdict = verifyStageReportAdoption(report);
    expect(verdict.ok).toBe(false);
    const reason = verdict.reasons.find((r) => r.includes(entry.heading));
    expect(reason).toBeDefined();
    expect(reason!).toContain(entry.heading);
    expect(reason!).toContain(String(budget));
    expect(reason!).toMatch(/budget/i);
  });

  test("the bound is per SECTION — inflating one does not spend the other's budget", () => {
    // Isolation the other way: a stage owing two sections must not be able to
    // pay for an overrun in one out of the other's unused allowance.
    const stage = "implement";
    const entries = exemptSectionsFor(stage);
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) {
      const report = [
        ...owedSectionsInflated(stage, entry.heading, ["- one row too many"]),
        bareBlock(stage),
      ].join("\n");
      const verdict = verifyStageReportAdoption(report);
      expect({ heading: entry.heading, ok: verdict.ok }).toEqual({
        heading: entry.heading,
        ok: false,
      });
    }
  });
});

// ============================================================================
// 2 — THE WHOLE-REPORT CAP IS MEANINGFUL AGAIN
// ============================================================================

describe("M137 round 2 — an accepted report has a STATED ceiling", () => {
  test("the ceiling is the whole-report cap PLUS every budget the stage owes", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const owedBudget = exemptSectionsFor(stage).reduce(
        (sum, entry) => sum + budgetOf(entry),
        0,
      );
      expect({ stage, bound: maxReportLines(stage) }).toEqual({
        stage,
        bound: STAGE_REPORT_LINE_CAP + owedBudget,
      });
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
  });

  test("a stage that owes NOTHING gets no extra budget at all", () => {
    const stage = ADOPTING_STAGES.find((s) => exemptSectionsFor(s).length === 0);
    expect(stage).toBeDefined();
    expect(maxReportLines(stage!)).toBe(STAGE_REPORT_LINE_CAP);
  });

  test("ROUND A, KEPT GREEN — the maximal legal report sits AT the ceiling and is ACCEPTED", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const maximal = maximalLegalReport(stage);
      expect({ stage, lines: lineCount(maximal) }).toEqual({
        stage,
        lines: maxReportLines(stage),
      });
      expect({ stage, verdict: verifyStageReportAdoption(maximal) }).toEqual({
        stage,
        verdict: { ok: true, reasons: [] },
      });
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
    // The number Round A measured, restated so a silent change to it is visible.
    expect(maxReportLines("implement")).toBe(49);
  });

  test("THE PROPERTY — no composition over the ceiling is ACCEPTED", () => {
    // Expressed over the MAXIMAL LEGAL COMPOSITION rather than as one example:
    // every insertion point the contract knows about, at several magnitudes.
    // A future carve-out that re-opens the hole cannot leave this green.
    const magnitudes = [1, 2, 5, 40, 120];
    let checked = 0;
    for (const stage of exemptStages()) {
      const bound = maxReportLines(stage);
      for (const entry of exemptSectionsFor(stage)) {
        for (const k of magnitudes) {
          for (const shape of [
            (n: number) => Array.from({ length: n }, (_, i) => `- smuggled row ${i + 1}`),
            (n: number) => Array.from({ length: n }, (_, i) => `smuggled prose ${i + 1}`),
            (n: number) => Array.from({ length: n }, (_, i) => `smuggled${i + 1}:`),
          ]) {
            const report = [
              ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP),
              bareBlock(stage),
              ...owedSectionsInflated(stage, entry.heading, shape(k)),
            ].join("\n");
            // THE CONSTRUCTION IS THE SUBJECT: it really is over the ceiling.
            expect(lineCount(report)).toBeGreaterThan(bound);
            const verdict = verifyStageReportAdoption(report);
            expect({ stage, heading: entry.heading, k, ok: verdict.ok }).toEqual({
              stage,
              heading: entry.heading,
              k,
              ok: false,
            });
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("THE PROPERTY, other insertion points — one line over the ceiling anywhere is refused", () => {
    const stage = "implement";
    const bound = maxReportLines(stage);
    const variants: Record<string, string> = {
      "one prose line too many": [
        ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP + 1),
        bareBlock(stage),
        ...owedSectionLines(stage),
      ].join("\n"),
      "one fence row too many": [
        ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP),
        bareBlock(stage).replace(
          `  ${EMPTY_SECTION_FALLBACK}`,
          `  ${EMPTY_SECTION_FALLBACK}\n  - one row too many`,
        ),
        ...owedSectionLines(stage),
      ].join("\n"),
      "one trailing narration line too many": [
        ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP),
        bareBlock(stage),
        ...owedSectionLines(stage),
        "One more paragraph, after everything the contract admits.",
      ].join("\n"),
    };
    for (const [name, report] of Object.entries(variants)) {
      expect({ name, lines: lineCount(report) }).toEqual({ name, lines: bound + 1 });
      expect({ name, ok: verifyStageReportAdoption(report).ok }).toEqual({
        name,
        ok: false,
      });
    }
  });

  test("the ceiling is WRITTEN DOWN at a shipped surface, not only in the module", () => {
    // A bound nobody can read is not a stated bound. The contract doc is where
    // every other budget in this family is stated; the ceiling joins them.
    const doc = read(STATUS_BLOCK_DOC);
    const bound = String(maxReportLines("implement"));
    const stated = doc
      .split("\n")
      .some((line) => line.includes(bound) && /cap|budget|ceiling|bound/i.test(line));
    expect(stated).toBe(true);
  });
});

// ============================================================================
// 3 — THE REGRESSION, PINNED BY ITS EXACT BYTES
// ============================================================================

/**
 * The number of list rows the reproduced defect smuggled under
 * `## Advisory notes`. Stated because it describes a MEASUREMENT, not a budget.
 */
const SMUGGLED_ROWS = 120;

/** The smuggled report, built from the SHIPPED renderers rather than typed. */
function smuggledReport(): string {
  const stage = "implement";
  const advisory = exemptSectionsFor(stage).find((e) => /advisory/i.test(e.heading));
  if (advisory === undefined) {
    throw new Error("`/implement` no longer owes an advisory cap-exempt section");
  }
  return [
    ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP),
    bareBlock(stage),
    ...owedSectionsInflated(
      stage,
      advisory.heading,
      Array.from(
        { length: SMUGGLED_ROWS },
        (_, i) =>
          `- Narration paragraph ${i + 1}, written as a list row so the carve-out forgives it.`,
      ),
    ),
  ].join("\n");
}

describe("M137 round 2 — THE REGRESSION: 120 list rows under an exempt heading", () => {
  test("the construction is the DISCRIMINATING shape it claims to be", () => {
    const report = smuggledReport();
    // A valid, closed fence…
    expect(fenceOpenIndex(report)).toBeGreaterThan(-1);
    expect(fenceCloseIndex(report)).toBeGreaterThan(fenceOpenIndex(report));
    // …both mandated cap-exempt sections…
    for (const entry of exemptSectionsFor("implement")) {
      expect(report).toContain(entry.heading);
    }
    // …and a hundred and twenty narration paragraphs wearing list markers.
    const smuggled = report
      .split("\n")
      .filter((line) => /^- Narration paragraph \d+, written as a list row/.test(line));
    expect(smuggled.length).toBe(SMUGGLED_ROWS);
  });

  test("the report is REFUSED, and the refusal NAMES the whole-report cap", () => {
    const report = smuggledReport();
    // Its size is derived, never typed: the maximal legal composition plus the
    // smuggled rows. Measured on the shipped code 2026-09-01 as 169 lines,
    // graded `{"ok":true,"reasons":[]}`.
    expect(lineCount(report)).toBe(maxReportLines("implement") + SMUGGLED_ROWS);
    expect(lineCount(report)).toBeGreaterThan(STAGE_REPORT_LINE_CAP);

    const verdict = verifyStageReportAdoption(report);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isWholeReportCapReason)).toBe(true);
  });

  test("…and the over-budget SECTION is named too, so the operator knows where", () => {
    const report = smuggledReport();
    const advisory = exemptSectionsFor("implement").find((e) =>
      /advisory/i.test(e.heading),
    )!;
    const budget = budgetOf(advisory);
    const verdict = verifyStageReportAdoption(report);
    expect(
      verdict.reasons.some((r) => isSectionBudgetReason(r, advisory.heading, budget)),
    ).toBe(true);
  });

  test("the SIBLING section is untouched by the smuggling — the vector is local", () => {
    // Isolation: the evidence section is rendered at exactly its budget in the
    // same report, and must not collect a refusal of its own.
    const report = smuggledReport();
    const evidence = exemptSectionsFor("implement").find(
      (e) => e.heading === IMPLEMENT_EVIDENCE_HEADING,
    )!;
    const budget = budgetOf(evidence);
    const verdict = verifyStageReportAdoption(report);
    expect(
      verdict.reasons.some((r) => isSectionBudgetReason(r, evidence.heading, budget)),
    ).toBe(false);
  });
});

// ============================================================================
// 4 — ROUND A's GUARANTEES, RESTATED HERE SO THIS FIX CANNOT TAKE THEM
// ============================================================================

describe("M137 round 2 — the Round A guarantees survive the bound", () => {
  test("EXEMPT IS NOT OPTIONAL — dropping an owed section is still REFUSED, and NAMED", () => {
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const kept = exemptSectionsFor(entry.stage).filter(
        (e) => e.heading !== entry.heading,
      );
      const without = [
        bareBlock(entry.stage),
        ...kept.flatMap((e) => [...renderedExemptSection(e)]),
      ].join("\n");
      expect(without).not.toContain(entry.heading);
      const verdict = verifyStageReportAdoption(without);
      expect({
        heading: entry.heading,
        ok: verdict.ok,
        named: verdict.reasons.some((r) => r.includes(entry.heading)),
      }).toEqual({ heading: entry.heading, ok: false, named: true });
      checked += 1;
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("an owed section rendered by its renderer may still FOLLOW the block", () => {
    for (const stage of exemptStages()) {
      const report = [bareBlock(stage), ...owedSectionLines(stage)].join("\n");
      expect({ stage, verdict: verifyStageReportAdoption(report) }).toEqual({
        stage,
        verdict: { ok: true, reasons: [] },
      });
    }
  });

  test("a full prose lead-in ALONGSIDE every owed section is still accepted", () => {
    const stage = "implement";
    const report = [
      ...proseLines(adoption.PROSE_LEAD_IN_LINE_CAP),
      ...owedSectionLines(stage),
      bareBlock(stage),
    ].join("\n");
    expect(verifyStageReportAdoption(report)).toEqual({ ok: true, reasons: [] });
  });
});

// ============================================================================
// 5 — THE MODULE SAYS WHAT IS TRUE
// ============================================================================

describe("M137 round 2 — no comment claims a guarantee the code does not give", () => {
  /**
   * The module's COMMENT PROSE as one span, markers stripped and lines joined.
   *
   * Line-by-line is the wrong instrument here and this suite learned it the
   * hard way: the false sentence that shipped is wrapped across two comment
   * lines — "…refused exactly as" / "before, and a stage…" — so a per-line
   * predicate reports a clean module while the claim sits right there.
   */
  const commentProse = (src: string): string =>
    src
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
      })
      .map((line) => line.trim().replace(/^(?:\/\/+|\/\*+|\*+\/?)\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");

  /**
   * The claim the shipped module made, and the predicate that catches it. A
   * comment may not assert that narration bloat is refused unchanged by the
   * carve-out — that sentence was measurably false the day it shipped.
   */
  const claimsRefusedAsBefore = (prose: string): boolean =>
    /refused (?:exactly )?as before|refused unchanged/i.test(prose);

  /** A comment that states the exemption has a CEILING, per section. */
  const statesTheBound = (prose: string): boolean =>
    /(?:cap-exempt|exempt section|exemption|carve-out)[^.]{0,240}(?:is bounded|bounded by|section budget|per-section budget|its own budget)/i.test(
      prose,
    ) ||
    /(?:is bounded|bounded by|section budget|per-section budget|its own budget)[^.]{0,240}(?:cap-exempt|exempt section|exemption|carve-out)/i.test(
      prose,
    );

  test("THE INSTRUMENT WORKS — both predicates fire on the sentences they name", () => {
    // The exact bytes from `stage_block_adoption.ts` before this fix, wrap and
    // all. Without this leg the assertions below could pass by matching nothing.
    const shipped =
      " * The cap is NOT raised: the exempt lines are excused from the count and every" +
      "\n * other line still faces the shipped 40. Narration bloat is refused exactly as" +
      "\n * before, and a stage that owes no section gets no extra budget at all.";
    expect(claimsRefusedAsBefore(commentProse(shipped))).toBe(true);
    expect(statesTheBound(commentProse(shipped))).toBe(false);

    const truthful =
      " * The carve-out is bounded: each cap-exempt section owns at most the lines" +
      "\n * its own renderer emits, and every line past that section budget is narration" +
      "\n * again, facing the shipped whole-report cap.";
    expect(statesTheBound(commentProse(truthful))).toBe(true);
    expect(claimsRefusedAsBefore(commentProse(truthful))).toBe(false);
  });

  test("the module carries NO such claim any more", () => {
    expect(claimsRefusedAsBefore(commentProse(read(ADOPTION_MODULE_SRC)))).toBe(false);
  });

  test("the module STATES the bound instead — the exemption is documented as finite", () => {
    expect(statesTheBound(commentProse(read(ADOPTION_MODULE_SRC)))).toBe(true);
  });

  test("the contract doc does not claim a shape rule the module contradicts", () => {
    // MEASURED, not asserted: a bare `name:` key under an exempt heading is
    // forgiven by the module — `renderImplementReportEvidence` emits three of
    // them. So a doc sentence limiting the admitted shapes to a heading and
    // its list rows "and nothing else" is false about the shipped grader.
    const stage = "implement";
    const accepted = [bareBlock(stage), ...owedSectionLines(stage)].join("\n");
    const bareKeys = owedSectionLines(stage).filter((l) => /^\s*[A-Za-z][\w-]*:\s*$/.test(l));
    expect(bareKeys.length).toBeGreaterThan(0);
    expect(verifyStageReportAdoption(accepted)).toEqual({ ok: true, reasons: [] });

    const doc = read(STATUS_BLOCK_DOC);
    expect(doc).not.toMatch(/its heading and its list rows, and nothing else/i);
  });

  test("the contract doc STATES that the carve-out is bounded per section", () => {
    const doc = read(STATUS_BLOCK_DOC);
    const stated = doc
      .split("\n")
      .some(
        (line) =>
          /cap-exempt|carve-out|exempt section/i.test(line) &&
          /budget|bounded|ceiling/i.test(line),
      );
    expect(stated).toBe(true);
  });
});

// ============================================================================
// 6 — M137 ROUND 3: THE BOUND IS PER REPORT, PER HEADING
// ============================================================================
//
// THE DEFECT, measured on the shipped module 2026-09-01, with the ceiling read
// off `maxAdoptedReportLines("implement")` = 49:
//
//      1 x `## Advisory notes`  ->  26 lines   ok=true
//      5 x `## Advisory notes`  ->  34 lines   ok=true
//     50 x `## Advisory notes`  -> 124 lines   ok=true
//
// The section budget is applied PER OCCURRENCE of an exempt heading, so
// REPEATING THE HEADING MULTIPLIES THE ALLOWANCE. Round 2 bounded a section;
// this bounds the REPORT.
//
// WHY IT WAS PER OCCURRENCE, which is the part that matters more than the fix:
// a test was wrong about its own subject. `m137-ste-533-stage-block-adoption`'s
// "an AC-2a exempt section MAY follow the block" built its subject by appending
// `entry.heading` to `reportForStage("implement")` — a report that ALREADY
// carries that heading, because "exempt is not optional" requires it. It meant
// to assert PLACEMENT and asserted DUPLICATION instead. A per-report bound
// reddened it, so the bound was made per-occurrence to keep it green. That leg
// has been rewritten to assert what it means.
//
// THE ORDERING RULING (operator, 2026-09-01), stated here because this is where
// it is enforced:
//
//   * THE PROPERTY GATES. It is the first test in this section and it is the
//     one that decides whether the module is correct.
//   * The vector tests below it DOCUMENT KNOWN ATTACKS. They are not coverage.
//     Three vector tests read as coverage is exactly how this hole survived
//     four rounds — raw lines, then list rows, then repeated headings, each fix
//     bounding the shape it was shown.
//   * If THE PROPERTY is green and a vector test is red, THE VECTOR TEST IS
//     WHAT IS WRONG. If THE PROPERTY is red, nothing else in this file matters.
//
// THE RULE THIS SECTION PINS, in two halves:
//
//   1. QUANTITY — an exempt heading is funded ONCE PER REPORT. N occurrences do
//      not buy N budgets, whatever shape the repetitions take and wherever they
//      sit relative to the block.
//   2. DUPLICATION — a report carrying the same exempt heading twice is refused
//      OUTRIGHT, and the refusal names the heading. This half is specific to
//      THIS module and deliberately does NOT generalise to the FR and plan
//      scanners (see the note in `m137-ste-534-fr-word-caps.test.ts`): here the
//      carve-out is a closed, cited list of sections whose own renderers emit
//      them exactly once, and "exempt is not optional" already grades ABSENCE —
//      so duplication must not be the loophole that absence is not.

/** How many times a heading appears, COMPARED ON THE TRIMMED LINE. */
const occurrencesOf = (report: string, heading: string): number =>
  report.split("\n").filter((line) => line.trim() === heading).length;

/** `n` copies of one exempt section, each exactly as its renderer emits it. */
const repeatSection = (entry: CapExemptSection, n: number): string[] =>
  Array.from({ length: n }, () => [...renderedExemptSection(entry)]).flat();

/**
 * The repetition counts. A LIST, including a large value, so a future
 * off-by-one — "the second occurrence is free" — cannot pass by handling only
 * the case someone imagined.
 */
const REPETITIONS: readonly number[] = [2, 3, 8, 50];

interface Composition {
  name: string;
  stage: string;
  report: string;
  /** The heading this composition carries more than once, or null. */
  duplicated: string | null;
}

/**
 * The ADVERSARIAL corpus — every arrangement of a repeated exempt heading this
 * contract can express, not one vector.
 *
 * Deliberately built from the REAL `CAP_EXEMPT_SECTIONS`, so an entry added
 * tomorrow is attacked by every composition here the day it lands.
 */
function adversarialCompositions(): Composition[] {
  const out: Composition[] = [];
  for (const stage of exemptStages()) {
    for (const entry of exemptSectionsFor(stage)) {
      const others = exemptSectionsFor(stage)
        .filter((e) => e.heading !== entry.heading)
        .flatMap((e) => [...renderedExemptSection(e)]);

      for (const n of REPETITIONS) {
        out.push({
          name: `${stage}: ${entry.heading} x${n}, all after the block`,
          stage,
          report: [bareBlock(stage), ...others, ...repeatSection(entry, n)].join("\n"),
          duplicated: entry.heading,
        });
        const half = Math.floor(n / 2);
        out.push({
          name: `${stage}: ${entry.heading} x${n}, interleaved across the block`,
          stage,
          report: [
            ...repeatSection(entry, half),
            bareBlock(stage),
            ...others,
            ...repeatSection(entry, n - half),
          ].join("\n"),
          duplicated: entry.heading,
        });
      }

      out.push({
        name: `${stage}: ${entry.heading} once BEFORE and once AFTER the block`,
        stage,
        report: [
          ...renderedExemptSection(entry),
          bareBlock(stage),
          ...others,
          ...renderedExemptSection(entry),
        ].join("\n"),
        duplicated: entry.heading,
      });

      // An INDENTED twin. A markdown heading may carry up to three leading
      // spaces and still be a heading — to the module's own `HEADING_RE` and to
      // every reader. A duplicate check comparing raw lines misses this one.
      const indented = renderedExemptSection(entry).map((l, i) =>
        i === 0 ? `   ${l}` : l,
      );
      out.push({
        name: `${stage}: ${entry.heading} plus an INDENTED twin`,
        stage,
        report: [
          bareBlock(stage),
          ...others,
          ...renderedExemptSection(entry),
          ...indented,
        ].join("\n"),
        duplicated: entry.heading,
      });

      // NESTED under the sibling section — a second occurrence opened inside
      // another exempt section's span rather than after it.
      const sibling = exemptSectionsFor(stage).find((e) => e.heading !== entry.heading);
      if (sibling !== undefined) {
        out.push({
          name: `${stage}: ${entry.heading} nested inside ${sibling.heading}`,
          stage,
          report: [
            bareBlock(stage),
            ...owedSectionsInflated(stage, sibling.heading, renderedExemptSection(entry)),
          ].join("\n"),
          duplicated: entry.heading,
        });
      }
    }
  }
  return out;
}

/**
 * The LEGAL corpus — every composition the contract admits, each carrying its
 * owed headings exactly once.
 *
 * Its job is NON-VACUITY: a property asserted over a corpus in which nothing is
 * accepted holds on a grader that refuses everything, which would retire the
 * whole contract while reading green.
 */
function legalCompositions(): Composition[] {
  const out: Composition[] = [];
  for (const stage of ADOPTING_STAGES) {
    out.push({
      name: `${stage}: the maximal legal report`,
      stage,
      report: maximalLegalReport(stage),
      duplicated: null,
    });
    out.push({
      name: `${stage}: owed sections AFTER the block`,
      stage,
      report: [bareBlock(stage), ...owedSectionLines(stage)].join("\n"),
      duplicated: null,
    });
    out.push({
      name: `${stage}: owed sections BEFORE the block`,
      stage,
      report: [...owedSectionLines(stage), bareBlock(stage)].join("\n"),
      duplicated: null,
    });
    const entries = exemptSectionsFor(stage);
    if (entries.length > 1) {
      // ROUND A's guarantee, kept explicitly: exempt sections are legal BEFORE
      // and AFTER the block. That is DIFFERENT sections on either side, each
      // appearing once — never the same heading twice, which no renderer emits.
      out.push({
        name: `${stage}: one owed section before the block, the rest after`,
        stage,
        report: [
          ...renderedExemptSection(entries[0]!),
          bareBlock(stage),
          ...entries.slice(1).flatMap((e) => [...renderedExemptSection(e)]),
        ].join("\n"),
        duplicated: null,
      });
    }
  }
  return out;
}

describe("M137 round 3 — THE PROPERTY: the ceiling holds over ANY composition", () => {
  test("GATING — no report `verifyStageReportAdoption` ACCEPTS exceeds the ceiling", () => {
    // THE ASSERTION THAT SHOULD HAVE EXISTED THREE ROUNDS AGO. It is over the
    // QUANTITY, so it cannot be defeated by a shape nobody imagined: whatever
    // an accepted report is made of, it is at most `maxAdoptedReportLines`.
    const corpus = [...legalCompositions(), ...adversarialCompositions()];
    expect(corpus.length).toBeGreaterThan(0);

    const accepted = corpus.filter((c) => verifyStageReportAdoption(c.report).ok);
    const overCeiling = corpus.filter(
      (c) => lineCount(c.report) > maxReportLines(c.stage),
    );

    // NON-VACUITY, BOTH DIRECTIONS. Without the first, a grader that refuses
    // everything passes; without the second, a corpus that never goes over the
    // ceiling passes on a grader that counts nothing.
    expect(accepted.length).toBeGreaterThan(0);
    expect(overCeiling.length).toBeGreaterThan(0);

    // Named, with the arithmetic, so a breach says WHICH composition and by how
    // much rather than "expected 0 to be 1".
    const breaches = accepted
      .filter((c) => lineCount(c.report) > maxReportLines(c.stage))
      .map(
        (c) =>
          `${c.name} — accepted at ${lineCount(c.report)} lines, ceiling ${maxReportLines(c.stage)}`,
      );
    expect(breaches).toEqual([]);
  });

  test("ROUND A KEPT — every LEGAL composition is still ACCEPTED, reasons empty", () => {
    let checked = 0;
    for (const c of legalCompositions()) {
      expect({ name: c.name, verdict: verifyStageReportAdoption(c.report) }).toEqual({
        name: c.name,
        verdict: { ok: true, reasons: [] },
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("M137 round 3 — the known attacks (documentation, NOT coverage)", () => {
  test("N repetitions of an exempt heading do NOT buy N budgets", () => {
    // THE ARITHMETIC IS THE ASSERTION. Under a PER-REPORT bound the excused
    // lines are each owed heading's budget ONCE, so the residual the shipped
    // whole-report cap sees is `lines - (ceiling - STAGE_REPORT_LINE_CAP)`. A
    // module that refused the duplicate but went on EXCUSING every repetition's
    // lines would leave that residual small and this leg red — which is what
    // separates "the bound is per report" from "duplicates are rejected".
    let checked = 0;
    for (const stage of exemptStages()) {
      const fundedOnce = maxReportLines(stage) - STAGE_REPORT_LINE_CAP;
      for (const entry of exemptSectionsFor(stage)) {
        const others = exemptSectionsFor(stage)
          .filter((e) => e.heading !== entry.heading)
          .flatMap((e) => [...renderedExemptSection(e)]);
        for (const n of REPETITIONS) {
          const report = [
            bareBlock(stage),
            ...others,
            ...repeatSection(entry, n),
          ].join("\n");
          // THE REPETITION APPLIED: the heading really is there n times.
          expect({ heading: entry.heading, n, seen: occurrencesOf(report, entry.heading) })
            .toEqual({ heading: entry.heading, n, seen: n });

          const verdict = verifyStageReportAdoption(report);
          expect({ heading: entry.heading, n, ok: verdict.ok }).toEqual({
            heading: entry.heading,
            n,
            ok: false,
          });

          const residual = lineCount(report) - fundedOnce;
          expect({
            heading: entry.heading,
            n,
            capFired: verdict.reasons.some(isWholeReportCapReason),
          }).toEqual({
            heading: entry.heading,
            n,
            capFired: residual > STAGE_REPORT_LINE_CAP,
          });
          checked += 1;
        }
      }
    }
    expect(checked).toBe(REPETITIONS.length * CAP_EXEMPT_SECTIONS.length);
  });

  test("a DUPLICATE exempt heading is refused OUTRIGHT, and the refusal NAMES it", () => {
    // Absence is already a violation ("exempt is not optional"). Duplication
    // must not be the loophole absence is not — and the smallest duplicate,
    // two occurrences at their exact rendered size, sits UNDER the ceiling, so
    // no line-counting rule can carry this verdict.
    const duplicates = adversarialCompositions().filter((c) => c.duplicated !== null);
    expect(duplicates.length).toBeGreaterThan(0);
    const survivors: string[] = [];
    for (const c of duplicates) {
      const verdict = verifyStageReportAdoption(c.report);
      const named = verdict.reasons.some(
        (r) => r.includes(c.duplicated!) && /twice|duplicate|more than once|exactly once|repeat/i.test(r),
      );
      if (!verdict.ok && named) continue;
      survivors.push(`${c.name} — ok=${verdict.ok}, named=${named}`);
    }
    expect(survivors).toEqual([]);
  });

  test("ISOLATION — the smallest duplicate is UNDER the ceiling, so only the duplicate rule can refuse it", () => {
    let checked = 0;
    for (const stage of exemptStages()) {
      for (const entry of exemptSectionsFor(stage)) {
        const others = exemptSectionsFor(stage)
          .filter((e) => e.heading !== entry.heading)
          .flatMap((e) => [...renderedExemptSection(e)]);
        const report = [bareBlock(stage), ...others, ...repeatSection(entry, 2)].join("\n");
        // Under the ceiling, and under the raw whole-report cap once the owed
        // headings are funded once: neither cap can be what refuses it.
        expect({
          heading: entry.heading,
          overCeiling: lineCount(report) > maxReportLines(stage),
        }).toEqual({ heading: entry.heading, overCeiling: false });

        const verdict = verifyStageReportAdoption(report);
        expect({ heading: entry.heading, ok: verdict.ok }).toEqual({
          heading: entry.heading,
          ok: false,
        });
        expect({
          heading: entry.heading,
          allNameIt: verdict.reasons.every((r) => r.includes(entry.heading)),
        }).toEqual({ heading: entry.heading, allNameIt: true });
        checked += 1;
      }
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("EVASION TWIN — the 169-line regression RESTRUCTURED as repeated headings is refused too", () => {
    // THE STANDING RULE (operator, 2026-09-01): every dogfood ships with an
    // evasion twin. The original vector smuggles 120 list rows UNDER one
    // heading; the twin carries the SAME TOTAL as repeated headings instead.
    // A dogfood over real material can only ever answer "does this fire?" —
    // real material does not evade — so the twin is the only half that answers
    // "can this be avoided?".
    const original = smuggledReport();
    const stage = "implement";
    const advisory = exemptSectionsFor(stage).find((e) => /advisory/i.test(e.heading))!;
    const budget = budgetOf(advisory);
    expect(SMUGGLED_ROWS % budget).toBe(0);

    const twin = [
      maximalLegalReport(stage),
      ...repeatSection(advisory, SMUGGLED_ROWS / budget),
    ].join("\n");

    // SAME TOTAL, different structure — this is what makes it a twin.
    expect(lineCount(twin)).toBe(lineCount(original));
    expect(occurrencesOf(twin, advisory.heading)).toBe(1 + SMUGGLED_ROWS / budget);
    expect(occurrencesOf(original, advisory.heading)).toBe(1);

    // SAME VERDICT: refused, and refused by the whole-report cap — the twin
    // must not be excused into compliance by wearing more headings.
    const verdict = verifyStageReportAdoption(twin);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isWholeReportCapReason)).toBe(true);
  });
});
