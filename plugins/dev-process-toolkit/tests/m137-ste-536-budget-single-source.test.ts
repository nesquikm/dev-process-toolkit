// STE-536 (M137) — the authoring surfaces state the budgets, and they state
// them FROM the scanner's own definition. RED-state until the two authoring
// surfaces are edited:
//
//   skills/spec-write/SKILL.md            — the § 0b `## Summary` line (AC-STE-536.1)
//   templates/spec-templates/plan.md.template — § Task Sizing (AC-STE-536.2)
//
// SCOPE. This file covers ALL SIX of the FR's ACs. The earlier fence around
// AC-STE-536.3 (the anti-decoration rule) and AC-STE-536.5 (skill files under
// the NFR-1 line cap / the docs extraction) is lifted: the sibling FR those
// two waited on has landed, so the eleven skill surfaces are no longer frozen.
//
// ---------------------------------------------------------------------------
// WHY SINGLE-SOURCING IS THE POINT (AC-STE-536.4)
//
// The motivating precedent is NFR-1's per-SKILL.md line cap, which is written
// as three different numbers in this very repo: `specs/requirements.md` states
// one, `tests/skill-nfr-1-length.test.ts` pins a larger one, and the gate-check
// suites pin a third, tighter one between them. Nothing compares them, so the
// three drifted apart unnoticed and a skill file grew past the stated cap while
// every test stayed green. Fixing NFR-1 is out of scope here. Not REPEATING it
// for the four new budgets is the whole of AC-STE-536.4.
//
// The mechanism: the scanner modules export the numbers, the surfaces state
// them in prose, and this file reads the number back from the EXPORT and looks
// for that value in the prose. No number in this file is typed by hand — the
// meta-test `no budget literal is hand-typed in this file` proves it by
// scanning this file's own source. A test that hard-coded "the summary cap is
// N" would be the fourth NFR-1 number.
//
// ---------------------------------------------------------------------------
// WHY BOTH DIRECTIONS (AC-STE-536.6)
//
// A one-sided check passes whenever the unchecked side is the side that moved.
// So each budget is mutated twice, against the same pure predicate:
//
//   (i)  SCANNER moves, surface does not — call the predicate with a mutated
//        cap against the REAL surface text. Must flip true -> false.
//   (ii) SURFACE moves, scanner does not — rewrite the stated number in an
//        in-memory copy of the surface text, call the predicate with the REAL
//        shipped cap. Must flip true -> false.
//
// Each direction asserts the baseline (shipped cap + shipped text => true)
// BEFORE the flip, and direction (ii) additionally asserts the rewritten text
// actually differs from the original. A mutation that never applied reads as a
// pass, and that failure mode has bitten this repo before.
//
// ---------------------------------------------------------------------------
// WHY "NEAREST PRECEDING SECTION NAME" IS THE BINDING RULE (AC-STE-536.1)
//
// AC-STE-536.1 requires each budget be stated "in the section each applies to",
// not merely somewhere on the page. A bare proximity window is not enough: a
// window wide enough to be robust reaches into adjacent pre-existing prose and
// starts certifying text the FR never wrote. So the binding asserted here is
// ordinal rather than metric — for a stated budget to count for a section, the
// NEAREST PRECEDING mention of any capped section name must be that section's.
// Stating the summary cap under the Notes guidance therefore fails, at any
// distance.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  SECTION_RULES,
  measureFrSections,
  scanFrSummaryAltitude,
  type FrSummaryAltitudeViolation,
  type MeasuredSection,
  type SectionRuleSpec,
} from "../adapters/_shared/src/scan_fr_summary_altitude";
import {
  CHECKBOX_ITEM_MAJORITY,
  PLAN_NARRATIVE_WORD_CAP,
  measurePlanSubsections,
  scanPlanNarrativeAltitude,
  type MeasuredSubsection,
  type PlanNarrativeViolation,
} from "../adapters/_shared/src/scan_plan_narrative_altitude";
import {
  ADOPTING_STAGES,
  PROSE_LEAD_IN_LINE_CAP,
} from "../adapters/_shared/src/stage_block_adoption";
import { STAGE_REPORT_LINE_CAP } from "../adapters/_shared/src/stage_status_block";
import { FENCE_LINE_CAP } from "../adapters/_shared/src/deliver_stage_capture";
// The shared milestone-scoped spec-tree resolver — how the FR-side dogfood below
// stays scoped to THIS milestone on BOTH paths instead of swallowing 440-plus
// pre-rule FRs on one and the next milestone's FRs on the other.
import { milestoneSpecFiles } from "./_spec_tree";

const pluginRoot = join(import.meta.dir, "..");
const SELF = join(import.meta.dir, "m137-ste-536-budget-single-source.test.ts");
const SPEC_WRITE = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const PLAN_TEMPLATE = join(
  pluginRoot,
  "templates",
  "spec-templates",
  "plan.md.template",
);
const FR_SCANNER = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "scan_fr_summary_altitude.ts",
);
const PLAN_SCANNER = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "scan_plan_narrative_altitude.ts",
);

const read = (path: string): string => readFileSync(path, "utf-8");

/** The delta every mutation applies. Not a budget value. */
const MUTATION_DELTA = 7;

/**
 * The § 0b guidance line that already states the Summary altitude rule — the
 * one line where FR prose is authored. AC-STE-536.1 binds the three word
 * budgets to it; AC-STE-536.3 binds the anti-decoration rule to it as well.
 * Module-scoped because two blocks now anchor to the same line.
 */
const SUMMARY_RULE_ANCHOR = "3–6 non-empty lines of plain prose";

// --------------------------------------------------------------- the budgets
//
// Both the NAMES and the NUMBERS come off the scanner's shipped table, so this
// file names no section and no cap of its own. A row whose `wordCap` is null is
// uncapped by the scanner and is therefore not a budget any surface must state.

interface Budget {
  readonly section: string;
  readonly cap: number;
}

const FR_BUDGETS: readonly Budget[] = SECTION_RULES.filter(
  (r: SectionRuleSpec): boolean => r.wordCap !== null,
).map((r: SectionRuleSpec): Budget => ({
  section: r.section,
  cap: r.wordCap as number,
}));

const CAPPED_SECTION_NAMES: readonly string[] = FR_BUDGETS.map((b) => b.section);

/**
 * The share threshold as the surfaces must state it: a percentage, derived
 * from the shipped ratio rather than written down. The round-trip assertion in
 * the AC-STE-536.2 block is what proves the derivation is exact.
 */
const STRUCTURAL_SHARE_PCT = Math.round(CHECKBOX_ITEM_MAJORITY * 1000) / 10;

// ------------------------------------------------------------- the predicates

/** Matches a stated word budget of `cap`: "N words", "N word", "N-word". */
function wordBudgetRe(cap: number): RegExp {
  return new RegExp(String.raw`\b${cap}[ -]words?\b`, "g");
}

/** True iff `text` states a word budget of `cap` anywhere. */
function statesWordBudget(text: string, cap: number): boolean {
  return wordBudgetRe(cap).test(text);
}

/**
 * True iff `text` states a word budget of `cap` whose NEAREST PRECEDING capped
 * section name is `section` — the ordinal binding described in the header.
 */
function bindsBudgetToSection(
  text: string,
  section: string,
  cap: number,
): boolean {
  const re = wordBudgetRe(cap);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const before = text.slice(0, m.index);
    let nearest: string | null = null;
    let nearestAt = -1;
    for (const name of CAPPED_SECTION_NAMES) {
      const at = before.lastIndexOf(name);
      if (at > nearestAt) {
        nearestAt = at;
        nearest = name;
      }
    }
    if (nearest === section) return true;
  }
  return false;
}

/** True iff `text` states the structural share threshold as `pct` percent. */
function statesSharePct(text: string, pct: number): boolean {
  return new RegExp(String.raw`(?<![\d.])${pct}\s?%`).test(text);
}

/** Rewrite every stated `cap`-word budget in `text` to `to` words. */
function rewriteWordBudget(text: string, cap: number, to: number): string {
  return text.replace(wordBudgetRe(cap), `${to} words`);
}

/** Rewrite every stated `pct` percent in `text` to `to` percent. */
function rewriteSharePct(text: string, pct: number, to: number): string {
  return text.replace(
    new RegExp(String.raw`(?<![\d.])${pct}(\s?%)`, "g"),
    `${to}$1`,
  );
}

/** Occurrences of `value` as a standalone numeric literal in `src`. */
function literalCount(src: string, value: number): number {
  const escaped = String(value).replace(".", String.raw`\.`);
  const re = new RegExp(String.raw`(?<![\d.])${escaped}(?![\d])`, "g");
  return (src.match(re) ?? []).length;
}

// ===========================================================================
// AC-STE-536.1 — the FR-authoring surface states all three FR budgets
// ===========================================================================

describe("AC-STE-536.1 — spec-write states the three FR word budgets", () => {
  test("the shipped table actually carries three capped sections", () => {
    // Guards the whole block against vacuity: were the table to lose its caps,
    // every per-budget test below would pass over an empty list.
    expect(FR_BUDGETS.length).toBe(3);
    for (const { cap } of FR_BUDGETS) expect(cap).toBeGreaterThan(0);
  });

  test("the § 0b altitude-rule line is still present to anchor to", () => {
    const lines = read(SPEC_WRITE).split("\n");
    const hits = lines.filter((l) => l.includes(SUMMARY_RULE_ANCHOR));
    expect(hits.length).toBe(1);
  });

  test("the Summary budget is stated ON the § 0b altitude-rule line", () => {
    const summary = FR_BUDGETS.find((b) => b.section === "Summary");
    expect(summary).toBeDefined();
    const anchorLine = read(SPEC_WRITE)
      .split("\n")
      .find((l) => l.includes(SUMMARY_RULE_ANCHOR));
    expect(anchorLine).toBeDefined();
    expect(statesWordBudget(anchorLine as string, (summary as Budget).cap)).toBe(
      true,
    );
  });

  for (const { section, cap } of FR_BUDGETS) {
    test(`${section} — budget is stated, bound to its own section`, () => {
      const text = read(SPEC_WRITE);
      expect(statesWordBudget(text, cap)).toBe(true);
      expect(bindsBudgetToSection(text, section, cap)).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-536.2 — the plan template states the narrative budget and the
// COMBINED-SHARE exemption rule (not three categorical exemptions)
// ===========================================================================

describe("AC-STE-536.2 — plan template states the narrative budget", () => {
  // The three structural kinds, as the shipped classifier categorises lines.
  const KINDS: readonly (readonly [string, RegExp])[] = [
    ["checkbox items", /checkbox/i],
    ["markdown tables", /table/i],
    ["fenced code", /fence|code block/i],
  ];

  test("the stated percentage is an exact round-trip of the shipped ratio", () => {
    // Proves STRUCTURAL_SHARE_PCT is derived, not a second copy of the number.
    expect(STRUCTURAL_SHARE_PCT / 100).toBe(CHECKBOX_ITEM_MAJORITY);
  });

  test("the narrative word budget is stated", () => {
    expect(statesWordBudget(read(PLAN_TEMPLATE), PLAN_NARRATIVE_WORD_CAP)).toBe(
      true,
    );
  });

  test("the budget sits beside the subsection guidance (§ Task Sizing)", () => {
    const text = read(PLAN_TEMPLATE);
    const sizingAt = text.indexOf("### Task Sizing");
    expect(sizingAt).toBeGreaterThanOrEqual(0);
    // The next level-2/level-3 heading closes the section.
    const rest = text.slice(sizingAt + "### Task Sizing".length);
    const endRel = rest.search(/^#{2,3}(?!#)\s+/m);
    const body = endRel === -1 ? rest : rest.slice(0, endRel);
    expect(statesWordBudget(body, PLAN_NARRATIVE_WORD_CAP)).toBe(true);
  });

  test("the structural share threshold is stated", () => {
    expect(statesSharePct(read(PLAN_TEMPLATE), STRUCTURAL_SHARE_PCT)).toBe(true);
  });

  test("all three structural kinds are named", () => {
    const text = read(PLAN_TEMPLATE);
    for (const [label, re] of KINDS) {
      expect(re.test(text), `plan template must name ${label}`).toBe(true);
    }
  });

  test("the three kinds are stated as ONE combined share, not three exemptions", () => {
    // The shipped classifier runs a SINGLE ratio — (code + table + item) over
    // content lines — so a four-row table under a three-line prose caption is
    // a minority share and classifies NARRATIVE despite "being a table". A
    // template promising three independent categorical exemptions would
    // reintroduce exactly the drift STE-535 corrected. So the paragraph that
    // states the threshold must also name all three kinds and say they are
    // counted TOGETHER.
    const text = read(PLAN_TEMPLATE);
    const paragraphs = text.split(/\n\s*\n/);
    const stating = paragraphs.filter((p) =>
      statesSharePct(p, STRUCTURAL_SHARE_PCT),
    );
    expect(stating.length).toBeGreaterThan(0);
    const combined = stating.filter((p) => {
      const namesAll = KINDS.every(([, re]) => re.test(p));
      const combines = /combined|together|share|sum|total/i.test(p);
      return namesAll && combines;
    });
    expect(combined.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-536.4 — budgets are SINGLE-SOURCED
// ===========================================================================

describe("AC-STE-536.4 — one definition per budget", () => {
  test("each FR cap appears exactly once in the FR scanner", () => {
    const src = read(FR_SCANNER);
    for (const { section, cap } of FR_BUDGETS) {
      expect(literalCount(src, cap), `${section} cap`).toBe(1);
    }
  });

  test("the plan cap and the share ratio appear exactly once in the plan scanner", () => {
    const src = read(PLAN_SCANNER);
    expect(literalCount(src, PLAN_NARRATIVE_WORD_CAP)).toBe(1);
    expect(literalCount(src, CHECKBOX_ITEM_MAJORITY)).toBe(1);
  });

  test("no budget literal is hand-typed in this file", () => {
    // The NFR-1 precedent this AC cites is a cap written as three different
    // numbers across a spec and two test files. A test that typed a budget
    // number would be a fourth copy of it; every number used here is read back
    // from an export or computed from one.
    const src = read(SELF);
    for (const { section, cap } of FR_BUDGETS) {
      expect(literalCount(src, cap), `${section} cap literal`).toBe(0);
    }
    expect(literalCount(src, PLAN_NARRATIVE_WORD_CAP)).toBe(0);
    expect(literalCount(src, CHECKBOX_ITEM_MAJORITY)).toBe(0);
    expect(literalCount(src, STRUCTURAL_SHARE_PCT)).toBe(0);
  });

  test("the surfaces state the shipped numbers and no competing number", () => {
    // Divergence detection stated positively: for every budget, the value the
    // surface states is the value the scanner exports. Any other number in the
    // same binding position fails the AC-STE-536.1 / .2 assertions above; this
    // test additionally pins that the surface does not ALSO state a stale one.
    const specWrite = read(SPEC_WRITE);
    for (const { section, cap } of FR_BUDGETS) {
      expect(bindsBudgetToSection(specWrite, section, cap)).toBe(true);
      expect(
        statesWordBudget(specWrite, cap + MUTATION_DELTA),
        `${section}: a competing budget is stated`,
      ).toBe(false);
    }
    const template = read(PLAN_TEMPLATE);
    expect(statesWordBudget(template, PLAN_NARRATIVE_WORD_CAP)).toBe(true);
    expect(
      statesWordBudget(template, PLAN_NARRATIVE_WORD_CAP + MUTATION_DELTA),
    ).toBe(false);
  });
});

// ===========================================================================
// AC-STE-536.6 — both directions of drift fail
// ===========================================================================

describe("AC-STE-536.6 — direction (i): scanner moves, surface does not", () => {
  for (const { section, cap } of FR_BUDGETS) {
    test(`${section} — a changed scanner cap no longer matches the surface`, () => {
      const text = read(SPEC_WRITE);
      expect(bindsBudgetToSection(text, section, cap)).toBe(true); // baseline
      const mutated = cap + MUTATION_DELTA;
      expect(mutated).not.toBe(cap); // mutation applied
      expect(bindsBudgetToSection(text, section, mutated)).toBe(false); // flips
    });
  }

  test("plan narrative cap — a changed scanner cap no longer matches the template", () => {
    const text = read(PLAN_TEMPLATE);
    expect(statesWordBudget(text, PLAN_NARRATIVE_WORD_CAP)).toBe(true);
    const mutated = PLAN_NARRATIVE_WORD_CAP + MUTATION_DELTA;
    expect(mutated).not.toBe(PLAN_NARRATIVE_WORD_CAP);
    expect(statesWordBudget(text, mutated)).toBe(false);
  });

  test("structural share — a changed scanner ratio no longer matches the template", () => {
    const text = read(PLAN_TEMPLATE);
    expect(statesSharePct(text, STRUCTURAL_SHARE_PCT)).toBe(true);
    const mutated = STRUCTURAL_SHARE_PCT + MUTATION_DELTA;
    expect(mutated).not.toBe(STRUCTURAL_SHARE_PCT);
    expect(statesSharePct(text, mutated)).toBe(false);
  });
});

describe("AC-STE-536.6 — direction (ii): surface moves, scanner does not", () => {
  for (const { section, cap } of FR_BUDGETS) {
    test(`${section} — a changed surface number no longer matches the scanner`, () => {
      const text = read(SPEC_WRITE);
      expect(bindsBudgetToSection(text, section, cap)).toBe(true); // baseline
      const mutatedText = rewriteWordBudget(text, cap, cap + MUTATION_DELTA);
      expect(mutatedText).not.toBe(text); // mutation applied
      expect(bindsBudgetToSection(mutatedText, section, cap)).toBe(false); // flips
    });
  }

  test("plan narrative cap — a changed template number no longer matches the scanner", () => {
    const text = read(PLAN_TEMPLATE);
    expect(statesWordBudget(text, PLAN_NARRATIVE_WORD_CAP)).toBe(true);
    const mutatedText = rewriteWordBudget(
      text,
      PLAN_NARRATIVE_WORD_CAP,
      PLAN_NARRATIVE_WORD_CAP + MUTATION_DELTA,
    );
    expect(mutatedText).not.toBe(text);
    expect(statesWordBudget(mutatedText, PLAN_NARRATIVE_WORD_CAP)).toBe(false);
  });

  test("structural share — a changed template percentage no longer matches the scanner", () => {
    const text = read(PLAN_TEMPLATE);
    expect(statesSharePct(text, STRUCTURAL_SHARE_PCT)).toBe(true);
    const mutatedText = rewriteSharePct(
      text,
      STRUCTURAL_SHARE_PCT,
      STRUCTURAL_SHARE_PCT + MUTATION_DELTA,
    );
    expect(mutatedText).not.toBe(text);
    expect(statesSharePct(mutatedText, STRUCTURAL_SHARE_PCT)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-536.4 / AC-STE-536.6 — the DERIVED prose lead-in cap
//
// The three budgets above are TYPED in their scanners. `PROSE_LEAD_IN_LINE_CAP`
// is not: it is computed as `STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2`, so it
// moves whenever EITHER upstream budget moves — and it moves silently, because
// nothing recomputes the prose. Twelve shipped surfaces restate its value as a
// literal: the eleven `ADOPTING_STAGES` SKILL.md files and
// `docs/stage-status-block.md`. Nothing bound those twelve copies to the
// export, which is precisely the divergence AC-STE-536.4 forbids and precisely
// the NFR-1 shape it cites — one number written several ways, drifting unseen.
//
// The nearest existing guard (`tests/m137-ste-533-...` — "the number is WRITTEN
// DOWN at a shipped surface") is a `.some()`: ONE surface stating the number
// satisfies it while the other eleven go stale. That is the hole closed here.
//
// Every number below is read back from an export. The surface list is derived
// from `ADOPTING_STAGES` plus the doc, so a twelfth adopting stage is covered
// the day it is added rather than the day someone remembers to edit this file.
// ===========================================================================

const ADOPTION_MODULE = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "stage_block_adoption.ts",
);

/**
 * The fence's own opener and closer — the third term of the derivation, and
 * the ONE number the shipped expression is allowed to carry. Not a budget: it
 * is a property of a fenced block, which has exactly these two marker lines.
 */
const FENCE_MARKER_LINES = 2;

interface Surface {
  readonly label: string;
  readonly path: string;
}

/** The twelve restating surfaces, derived — never listed by hand. */
const LEAD_IN_SURFACES: readonly Surface[] = [
  ...ADOPTING_STAGES.map((stage): Surface => ({
    label: `skills/${stage}/SKILL.md`,
    path: join(pluginRoot, "skills", stage, "SKILL.md"),
  })),
  {
    label: "docs/stage-status-block.md",
    path: join(pluginRoot, "docs", "stage-status-block.md"),
  },
];

/**
 * Number words indexed BY VALUE, so `NUMBER_WORDS[cap]` is the spelling of the
 * shipped cap and no numeral is typed here at all. `docs/stage-status-block.md`
 * states the cap twice on the same line — once in digits, once in words — and a
 * word-blind check would certify a half-updated sentence.
 */
const NUMBER_WORDS: readonly string[] = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

/** The lines of `text` that talk about the prose lead-in. */
function leadInLines(text: string): readonly string[] {
  return text.split("\n").filter((l) => /lead-in/i.test(l));
}

/** Matches a stated line budget of `cap`: "N lines", "N line", "N-line". */
function lineBudgetRe(cap: number): RegExp {
  return new RegExp(String.raw`\b${cap}([ -]lines?\b)`, "g");
}

/** Every line count stated in digits on a lead-in line, in order. */
function statedLineCounts(text: string): readonly number[] {
  const out: number[] = [];
  for (const line of leadInLines(text)) {
    for (const m of line.matchAll(/\b(\d+)[ -]lines?\b/g)) {
      out.push(Number(m[1]));
    }
  }
  return out;
}

/** Every line count SPELLED OUT on a lead-in line, lower-cased, in order. */
function spelledLineCounts(text: string): readonly string[] {
  const re = new RegExp(
    String.raw`\b(${NUMBER_WORDS.join("|")})[ -]lines?\b`,
    "gi",
  );
  const out: string[] = [];
  for (const line of leadInLines(text)) {
    for (const m of line.matchAll(re)) out.push(m[1].toLowerCase());
  }
  return out;
}

/** True iff `text` states a lead-in budget of `cap` on a lead-in line. */
function statesLeadInCap(text: string, cap: number): boolean {
  return leadInLines(text).some((l) => lineBudgetRe(cap).test(l));
}

/** Rewrite every stated `cap`-line lead-in budget in `text` to `to` lines. */
function rewriteLeadInCap(text: string, cap: number, to: number): string {
  return text
    .split("\n")
    .map((l) => (/lead-in/i.test(l) ? l.replace(lineBudgetRe(cap), `${to}$1`) : l))
    .join("\n");
}

/**
 * True iff `text` restates the DERIVATION itself — the cap's name alongside
 * both upstream budgets, on one line. `docs/stage-status-block.md` does; a
 * surface that spells the subtraction out in numerals is stating two MORE
 * budgets it can drift from, so those two are bound here as well.
 */
function statesDerivation(text: string, report: number, fence: number): boolean {
  return text
    .split("\n")
    .some(
      (l) =>
        l.includes("PROSE_LEAD_IN_LINE_CAP") &&
        new RegExp(String.raw`(?<![\d.])${report}(?![\d])`).test(l) &&
        new RegExp(String.raw`(?<![\d.])${fence}(?![\d])`).test(l),
    );
}

/** Rewrite a standalone numeric literal on the derivation line(s) only. */
function rewriteDerivationNumber(text: string, from: number, to: number): string {
  const re = new RegExp(String.raw`(?<![\d.])${from}(?![\d])`, "g");
  return text
    .split("\n")
    .map((l) => (l.includes("PROSE_LEAD_IN_LINE_CAP") ? l.replace(re, String(to)) : l))
    .join("\n");
}

describe("AC-STE-536.4 — the derived lead-in cap has one definition", () => {
  test("the surface list is non-empty and covers every adopting stage plus the doc", () => {
    // Non-vacuity, first gate. A binding test that silently enumerates zero
    // surfaces passes while proving nothing.
    expect(LEAD_IN_SURFACES.length).toBeGreaterThan(0);
    expect(LEAD_IN_SURFACES.length).toBe(ADOPTING_STAGES.length + 1);
    for (const { label, path } of LEAD_IN_SURFACES) {
      expect(existsSync(path), `${label} must exist`).toBe(true);
    }
  });

  test("the cap is DERIVED from both upstream budgets, read from their owners", () => {
    expect(PROSE_LEAD_IN_LINE_CAP).toBe(
      STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - FENCE_MARKER_LINES,
    );
  });

  test("the shipped expression is an expression, not a quietly-typed literal", () => {
    // The equality above holds just as well if someone replaces the expression
    // with the number it currently evaluates to — at which point the cap stops
    // tracking its inputs and the twelve surfaces below become right by luck.
    const src = read(ADOPTION_MODULE);
    const m = /export const PROSE_LEAD_IN_LINE_CAP\s*=\s*([^;]+);/.exec(src);
    expect(m).not.toBeNull();
    const rhs = (m as RegExpExecArray)[1].replace(/\s+/g, "");
    expect(rhs).toBe(
      `STAGE_REPORT_LINE_CAP-FENCE_LINE_CAP-${FENCE_MARKER_LINES}`,
    );
  });

  for (const { label, path } of LEAD_IN_SURFACES) {
    test(`${label} — states the cap the export currently holds`, () => {
      const text = read(path);
      const stated = statedLineCounts(text);
      // Non-vacuity, second gate: the phrase was actually FOUND here. A
      // surface that stopped restating the cap must fail, not pass silently.
      expect(stated.length, `${label} states no lead-in line budget`).toBeGreaterThan(0);
      // And every number it states is the shipped one — no competing copy.
      for (const n of stated) expect(n).toBe(PROSE_LEAD_IN_LINE_CAP);
      expect(statesLeadInCap(text, PROSE_LEAD_IN_LINE_CAP)).toBe(true);
    });
  }

  test("a spelled-out restatement matches the digits", () => {
    const word = NUMBER_WORDS[PROSE_LEAD_IN_LINE_CAP];
    expect(word, "the cap has moved outside the spelling table").toBeDefined();
    let seen = 0;
    for (const { label, path } of LEAD_IN_SURFACES) {
      for (const w of spelledLineCounts(read(path))) {
        seen += 1;
        expect(w, `${label} spells a stale lead-in cap`).toBe(word as string);
      }
    }
    // Non-vacuity: at least one surface really does spell it out, so this test
    // is measuring shipped prose rather than an empty loop.
    expect(seen).toBeGreaterThan(0);
  });

  test("the derivation restatement names both upstream budgets, as shipped", () => {
    const stating = LEAD_IN_SURFACES.filter(({ path }) =>
      statesDerivation(read(path), STAGE_REPORT_LINE_CAP, FENCE_LINE_CAP),
    );
    expect(stating.length).toBeGreaterThan(0);
  });

  test("no lead-in budget literal is hand-typed in this file", () => {
    // Same rule as the block above, extended to the three numbers this section
    // reasons about. A number typed here would be the copy that survives when
    // the export moves.
    const src = read(SELF);
    expect(literalCount(src, PROSE_LEAD_IN_LINE_CAP)).toBe(0);
    expect(literalCount(src, STAGE_REPORT_LINE_CAP)).toBe(0);
    expect(literalCount(src, FENCE_LINE_CAP)).toBe(0);
  });
});

describe("AC-STE-536.6 — lead-in cap, direction (i): export moves, prose does not", () => {
  for (const { label, path } of LEAD_IN_SURFACES) {
    test(`${label} — a changed cap no longer matches the prose`, () => {
      const text = read(path);
      expect(statesLeadInCap(text, PROSE_LEAD_IN_LINE_CAP)).toBe(true); // baseline
      const mutated = PROSE_LEAD_IN_LINE_CAP + MUTATION_DELTA;
      expect(mutated).not.toBe(PROSE_LEAD_IN_LINE_CAP); // mutation applied
      expect(statesLeadInCap(text, mutated)).toBe(false); // flips
    });
  }

  test("either upstream budget moving moves the derived cap", () => {
    // The reason direction (i) is not hypothetical: the cap has no author. A
    // change to EITHER input silently changes what the twelve surfaces owe.
    const base = STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - FENCE_MARKER_LINES;
    expect(base).toBe(PROSE_LEAD_IN_LINE_CAP); // baseline
    const reportMoved =
      STAGE_REPORT_LINE_CAP + MUTATION_DELTA - FENCE_LINE_CAP - FENCE_MARKER_LINES;
    expect(reportMoved).not.toBe(PROSE_LEAD_IN_LINE_CAP);
    const fenceMoved =
      STAGE_REPORT_LINE_CAP - (FENCE_LINE_CAP + MUTATION_DELTA) - FENCE_MARKER_LINES;
    expect(fenceMoved).not.toBe(PROSE_LEAD_IN_LINE_CAP);
    // ...and the shipped prose tracks neither on its own.
    const doc = read(LEAD_IN_SURFACES[LEAD_IN_SURFACES.length - 1].path);
    expect(statesLeadInCap(doc, reportMoved)).toBe(false);
    expect(statesLeadInCap(doc, fenceMoved)).toBe(false);
  });

  test("derivation restatement — a changed upstream budget no longer matches", () => {
    const stating = LEAD_IN_SURFACES.filter(({ path }) =>
      statesDerivation(read(path), STAGE_REPORT_LINE_CAP, FENCE_LINE_CAP),
    );
    expect(stating.length).toBeGreaterThan(0);
    for (const { label, path } of stating) {
      const text = read(path);
      const report = STAGE_REPORT_LINE_CAP + MUTATION_DELTA;
      const fence = FENCE_LINE_CAP + MUTATION_DELTA;
      expect(report).not.toBe(STAGE_REPORT_LINE_CAP);
      expect(fence).not.toBe(FENCE_LINE_CAP);
      expect(
        statesDerivation(text, report, FENCE_LINE_CAP),
        `${label}: whole-report cap`,
      ).toBe(false);
      expect(
        statesDerivation(text, STAGE_REPORT_LINE_CAP, fence),
        `${label}: fence cap`,
      ).toBe(false);
    }
  });
});

describe("AC-STE-536.6 — lead-in cap, direction (ii): prose moves, export does not", () => {
  for (const { label, path } of LEAD_IN_SURFACES) {
    test(`${label} — a changed prose number no longer matches the export`, () => {
      const text = read(path);
      expect(statesLeadInCap(text, PROSE_LEAD_IN_LINE_CAP)).toBe(true); // baseline
      const mutatedText = rewriteLeadInCap(
        text,
        PROSE_LEAD_IN_LINE_CAP,
        PROSE_LEAD_IN_LINE_CAP + MUTATION_DELTA,
      );
      expect(mutatedText, `${label}: mutation never applied`).not.toBe(text);
      expect(statesLeadInCap(mutatedText, PROSE_LEAD_IN_LINE_CAP)).toBe(false); // flips
      // ...and the same rewrite is what the per-surface check above catches.
      expect(
        statedLineCounts(mutatedText).every((n) => n === PROSE_LEAD_IN_LINE_CAP),
      ).toBe(false);
    });
  }

  test("a spelled-out restatement that drifts alone still fails", () => {
    const word = NUMBER_WORDS[PROSE_LEAD_IN_LINE_CAP] as string;
    const other = NUMBER_WORDS[PROSE_LEAD_IN_LINE_CAP + MUTATION_DELTA] as string;
    expect(other).toBeDefined();
    expect(other).not.toBe(word);
    const stating = LEAD_IN_SURFACES.filter(
      ({ path }) => spelledLineCounts(read(path)).length > 0,
    );
    expect(stating.length).toBeGreaterThan(0);
    for (const { label, path } of stating) {
      const text = read(path);
      const mutatedText = text
        .split("\n")
        .map((l) =>
          /lead-in/i.test(l)
            ? l.replace(
                new RegExp(String.raw`\b${word}([ -]lines?\b)`, "gi"),
                `${other}$1`,
              )
            : l,
        )
        .join("\n");
      expect(mutatedText, `${label}: mutation never applied`).not.toBe(text);
      expect(
        spelledLineCounts(mutatedText).every((w) => w === word),
        `${label}: a drifted spelling was accepted`,
      ).toBe(false);
    }
  });

  test("derivation restatement — a changed prose number no longer matches", () => {
    const stating = LEAD_IN_SURFACES.filter(({ path }) =>
      statesDerivation(read(path), STAGE_REPORT_LINE_CAP, FENCE_LINE_CAP),
    );
    expect(stating.length).toBeGreaterThan(0);
    for (const { label, path } of stating) {
      const text = read(path);
      for (const budget of [STAGE_REPORT_LINE_CAP, FENCE_LINE_CAP]) {
        const mutatedText = rewriteDerivationNumber(
          text,
          budget,
          budget + MUTATION_DELTA,
        );
        expect(mutatedText, `${label}: mutation never applied`).not.toBe(text);
        expect(
          statesDerivation(mutatedText, STAGE_REPORT_LINE_CAP, FENCE_LINE_CAP),
          `${label}: a drifted derivation was accepted`,
        ).toBe(false);
      }
    }
  });
});

// ===========================================================================
// AC-STE-536.3 — the anti-decoration rule is stated AT the authoring surfaces
//
// The AC has two halves and a placement clause, and all three are load-bearing:
//
//   half A   no aphorisms;
//   half B   no restating a point in a second register;
//   where    "stated where the prose is authored, NOT ONLY in a document about
//            the rule".
//
// A check that merely greps the repository for the words would pass on a
// docs/ page alone, which is the exact failure the AC names. So each half is
// asserted at the two surfaces where prose is actually authored — the § 0b
// authoring line in `skills/spec-write/SKILL.md` (FR prose) and the § Task
// Sizing section of `templates/spec-templates/plan.md.template` (plan prose) —
// the same two places the budgets themselves are stated.
//
// FALSIFIABILITY. Each half is stripped from an in-memory copy of the surface
// and the matching predicate must flip true -> false, with the mutation
// asserted to have APPLIED. Isolation is asserted in both directions too: with
// half A stripped, half B must still hold, and vice versa. A single predicate
// satisfied by either half would pass a surface that states only one of them,
// and "removing either half reddens" is precisely what the AC needs.
// ===========================================================================

/** Half A of the anti-decoration rule: aphorisms are forbidden. */
const NO_APHORISMS_RE =
  /\b(no|not|never|avoid|without)\b[^.;]{0,90}\baphorisms?\b/i;

/** Half B: a point may not be restated in a second register. */
const NO_SECOND_REGISTER_RE =
  /\b(no|not|never|avoid|without)\b[^.;]{0,90}\b(restat\w*|repeat\w*|again)\b[^.;]{0,90}\bregisters?\b/i;

/** True iff `text` states BOTH halves of the anti-decoration rule. */
function statesAntiDecoration(text: string): boolean {
  return NO_APHORISMS_RE.test(text) && NO_SECOND_REGISTER_RE.test(text);
}

/** Strip half A's subject word, leaving half B untouched. */
function stripAphorismHalf(text: string): string {
  return text.replace(/aphorisms?/gi, "flourishes");
}

/** Strip half B's subject word, leaving half A untouched. */
function stripRegisterHalf(text: string): string {
  return text.replace(/\bregisters?\b/gi, "voice");
}

/** The single § 0b authoring line, or `undefined` if the anchor moved. */
function specWriteAuthoringLine(): string | undefined {
  return read(SPEC_WRITE)
    .split("\n")
    .find((l) => l.includes(SUMMARY_RULE_ANCHOR));
}

/** The body of the plan template's § Task Sizing subsection. */
function planTaskSizingBody(): string {
  const text = read(PLAN_TEMPLATE);
  const heading = "### Task Sizing";
  const at = text.indexOf(heading);
  if (at < 0) return "";
  const rest = text.slice(at + heading.length);
  const endRel = rest.search(/^#{2,3}(?!#)\s+/m);
  return endRel === -1 ? rest : rest.slice(0, endRel);
}

interface AuthoringSurface {
  readonly label: string;
  readonly text: () => string;
}

/**
 * The two surfaces where prose is authored. Derived from the same anchors the
 * budget blocks above use, so the rule and the budgets cannot drift apart onto
 * different lines of the same file.
 */
const AUTHORING_SURFACES: readonly AuthoringSurface[] = [
  {
    label: "skills/spec-write/SKILL.md § 0b authoring line",
    text: () => specWriteAuthoringLine() ?? "",
  },
  {
    label: "templates/spec-templates/plan.md.template § Task Sizing",
    text: planTaskSizingBody,
  },
];

describe("AC-STE-536.3 — the anti-decoration rule, at the authoring surface", () => {
  test("both authoring surfaces resolve to real, non-empty prose", () => {
    // Non-vacuity gate. Were either anchor to move, every assertion below
    // would run against an empty string and a missing rule would read GREEN.
    expect(AUTHORING_SURFACES.length).toBeGreaterThan(0);
    for (const { label, text } of AUTHORING_SURFACES) {
      expect(text().length, `${label} resolved to nothing`).toBeGreaterThan(0);
    }
  });

  test("the § 0b authoring line is the SAME line that states the budgets", () => {
    // The placement clause. The rule belongs beside the budgets it explains,
    // not merely elsewhere in the same file.
    const line = specWriteAuthoringLine();
    expect(line).toBeDefined();
    const summary = FR_BUDGETS.find((b) => b.section === "Summary");
    expect(summary).toBeDefined();
    expect(statesWordBudget(line as string, (summary as Budget).cap)).toBe(true);
  });

  for (const { label, text } of AUTHORING_SURFACES) {
    test(`${label} — states half A: no aphorisms`, () => {
      expect(NO_APHORISMS_RE.test(text())).toBe(true);
    });

    test(`${label} — states half B: no restating in a second register`, () => {
      expect(NO_SECOND_REGISTER_RE.test(text())).toBe(true);
    });

    test(`${label} — removing half A reddens, and leaves half B standing`, () => {
      const original = text();
      expect(statesAntiDecoration(original)).toBe(true); // baseline
      const mutated = stripAphorismHalf(original);
      expect(mutated, `${label}: mutation never applied`).not.toBe(original);
      expect(NO_APHORISMS_RE.test(mutated)).toBe(false); // flips
      expect(statesAntiDecoration(mutated)).toBe(false);
      // Isolation: the OTHER half is untouched, so the flip above is half A's
      // doing and not a predicate that collapses on any edit at all.
      expect(NO_SECOND_REGISTER_RE.test(mutated)).toBe(true);
    });

    test(`${label} — removing half B reddens, and leaves half A standing`, () => {
      const original = text();
      expect(statesAntiDecoration(original)).toBe(true); // baseline
      const mutated = stripRegisterHalf(original);
      expect(mutated, `${label}: mutation never applied`).not.toBe(original);
      expect(NO_SECOND_REGISTER_RE.test(mutated)).toBe(false); // flips
      expect(statesAntiDecoration(mutated)).toBe(false);
      expect(NO_APHORISMS_RE.test(mutated)).toBe(true);
    });
  }

  test("a rule stated ONLY in a document about the rule does not satisfy this", () => {
    // The AC's own escape clause, made executable: strip the rule from the
    // authoring surfaces while leaving every docs/ page exactly as shipped.
    // The surface predicate must go false anyway.
    const docsCarrying = docsPagesStatingTheRule();
    expect(
      docsCarrying.length,
      "no docs/ page states the rule, so this leg would prove nothing",
    ).toBeGreaterThan(0);
    for (const { label, text } of AUTHORING_SURFACES) {
      const stripped = stripRegisterHalf(stripAphorismHalf(text()));
      expect(stripped, `${label}: mutation never applied`).not.toBe(text());
      expect(
        statesAntiDecoration(stripped),
        `${label}: a docs-only statement was accepted`,
      ).toBe(false);
    }
    // ...while the docs pages, untouched, still state it. Both facts together
    // are what "not ONLY in a document about the rule" means.
    for (const name of docsCarrying) {
      expect(statesAntiDecoration(read(join(DOCS_DIR, name)))).toBe(true);
    }
  });
});

// ===========================================================================
// AC-STE-536.5 — every SKILL.md this FR touches stays under the NFR-1 cap
//
// Two properties, both taken from the AC's own wording.
//
//   (a) THE SET IS READ FROM THE DIFF. "The cap assertion runs over the actual
//       files this FR edits, read from the diff rather than from a hand-
//       maintained list." A typed list silently stops covering a file the FR
//       later touches — it is right on the day it is written and wrong from
//       the next edit on. So the set is derived by diffing the working tree
//       against a FIXED historical anchor: the commit carrying the
//       `Release: v2.74.0` footer, the release this milestone grew on top of.
//
//       WHY NOT `git merge-base main HEAD`, the obvious choice: it is correct
//       on the feature branch and goes EMPTY the moment the branch merges, at
//       which point the leg passes while measuring nothing. This repository has
//       been bitten by exactly that (M136 / STE-531, which re-anchored its own
//       added-module set to release commits for the same reason). Diffing
//       against the working tree rather than HEAD also means an edit that has
//       not been committed yet is still measured.
//
//   (b) THE CAP IS READ, NOT RETYPED. NFR-1's cap is the FR's own cautionary
//       example — one number written three ways across a spec and two test
//       files, drifted unnoticed. Retyping it here would add a fourth. The
//       number is parsed out of `tests/skill-nfr-1-length.test.ts`, the file
//       that enforces it, and a meta-leg asserts it appears nowhere in this
//       file as a literal.
//
//   The counting method is `split("\n").length`, matching the shipped cap test
//   byte for byte. `wc -l` counts newlines and reads one line low, which is
//   enough to certify a file that is actually one line over.
//
// NON-VACUITY. An empty touched set is a FAILURE here, not a pass: the set is
// asserted non-empty, asserted to contain the surface this FR must edit, and
// every member is asserted to exist on disk. A separate leg proves the cap
// assertion has bite by showing at least one touched file sits within a
// mutation delta of the cap — so the comparison is not slack.
// ===========================================================================

const REPO_ROOT = join(pluginRoot, "..", "..");
const PLUGIN_REL = "plugins/dev-process-toolkit";
const DOCS_DIR = join(pluginRoot, "docs");
const NFR1_TEST = join(pluginRoot, "tests", "skill-nfr-1-length.test.ts");

/** The release M137 grew on top of. Fixed history, not a moving ref. */
const PREVIOUS_RELEASE = "v2.74.0";

/** The surface this FR must edit — named so an empty set cannot read as clean. */
const REQUIRED_TOUCHED = `${PLUGIN_REL}/skills/spec-write/SKILL.md`;

/** Every docs page that states BOTH halves of the anti-decoration rule. */
function docsPagesStatingTheRule(): readonly string[] {
  return readdirSync(DOCS_DIR)
    .filter((n) => n.endsWith(".md"))
    .filter((n) => statesAntiDecoration(read(join(DOCS_DIR, n))));
}

/**
 * The cap the shipped NFR-1 test enforces, parsed from that test's source.
 *
 * Throws rather than defaulting: a cap that cannot be read would otherwise
 * become a hand-picked number, which is the drift this AC's sibling forbids.
 */
function nfr1LineCap(): number {
  const m = /const SKILL_LINE_CAP = (\d+);/.exec(read(NFR1_TEST));
  if (m === null) {
    throw new Error(
      "tests/skill-nfr-1-length.test.ts no longer declares `const SKILL_LINE_CAP = <n>;`, " +
        "so the cap cannot be read from its enforcer and any number used here would be a copy",
    );
  }
  return Number(m[1]);
}

/** Lines, counted the way the shipped cap test counts them. */
function skillLineCount(repoRelPath: string): number {
  return read(join(REPO_ROOT, repoRelPath)).split("\n").length;
}

/** The commit that shipped a release, found by its `Release:` footer. */
function releaseCommit(version: string): string {
  const proc = Bun.spawnSync(
    ["git", "-C", REPO_ROOT, "log", "--format=%H", `--grep=^Release: ${version} `, "-1"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const sha = proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
  if (sha.length === 0) {
    throw new Error(
      `no commit carries a \`Release: ${version}\` footer, so the set of files this FR ` +
        "touches cannot be anchored; an empty set would pass every leg below while " +
        "measuring nothing",
    );
  }
  return sha;
}

/**
 * Every SKILL.md that differs between the anchor release and the WORKING TREE
 * — derived, never listed. Uncommitted edits are included, so a file this FR
 * is in the middle of editing is measured now rather than after the commit.
 */
function touchedSkillFiles(): readonly string[] {
  const base = releaseCommit(PREVIOUS_RELEASE);
  const proc = Bun.spawnSync(
    ["git", "-C", REPO_ROOT, "diff", "--name-only", base, "--", `${PLUGIN_REL}/skills`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`git diff failed at ${base}: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith("/SKILL.md"));
}

describe("AC-STE-536.5 — touched skill files stay under the NFR-1 cap", () => {
  test("the touched set is derived from the diff and is NOT empty", () => {
    const touched = touchedSkillFiles();
    expect(touched.length, "the diff yielded no SKILL.md at all").toBeGreaterThan(0);
    // Named, so a set that silently shrank to something irrelevant still fails.
    expect(touched, "the surface this FR edits is not in the diff").toContain(
      REQUIRED_TOUCHED,
    );
    for (const path of touched) {
      expect(existsSync(join(REPO_ROOT, path)), `${path} must exist`).toBe(true);
    }
  });

  test("the cap is READ from its enforcer, never retyped here", () => {
    const cap = nfr1LineCap();
    expect(cap).toBeGreaterThan(0);
    // The NFR-1 precedent, refused: a number typed here would be a fourth copy
    // of a cap already written three ways.
    expect(literalCount(read(SELF), cap), "the cap is hand-typed here").toBe(0);
  });

  test("the counting method is the shipped cap test's own", () => {
    // `wc -l` counts newlines and reads one line LOW, which is enough to
    // certify a file that is actually one line over the cap.
    expect(read(NFR1_TEST)).toContain('split("\\n").length');
  });

  test("every touched SKILL.md is within the cap", () => {
    const cap = nfr1LineCap();
    const touched = touchedSkillFiles();
    expect(touched.length).toBeGreaterThan(0);
    for (const path of touched) {
      const lines = skillLineCount(path);
      expect(lines, `${path} is ${lines} lines, cap is ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  test("the cap assertion has bite — a tightened cap would fail", () => {
    // Proves the comparison is not slack. At least one touched file sits close
    // enough to the cap that a mutation-sized tightening reddens the leg above.
    const cap = nfr1LineCap();
    const counts = touchedSkillFiles().map(skillLineCount);
    expect(counts.length).toBeGreaterThan(0);
    expect(
      counts.some((n) => n > cap - MUTATION_DELTA),
      "no touched skill file is near the cap, so the leg above cannot fail",
    ).toBe(true);
  });

  test("this FR's prose lands as a docs/ extraction the skill points at", () => {
    // The AC's remedy, not just its constraint: the surfaces at zero headroom
    // cannot absorb the reference detail, so it moves to `docs/` on the shipped
    // `docs/deliver-reference.md` precedent and the skill links to it.
    const carrying = docsPagesStatingTheRule();
    expect(
      carrying.length,
      "no docs/ page carries the anti-decoration reference detail",
    ).toBeGreaterThan(0);
    const specWrite = read(SPEC_WRITE);
    const pointed = carrying.filter((n) => specWrite.includes(`docs/${n}`));
    expect(
      pointed.length,
      `spec-write points at none of: ${carrying.join(", ")}`,
    ).toBeGreaterThan(0);
  });

  test("the files at zero headroom did not grow to hold it", () => {
    // The concrete shape of "rather than by growing a skill file": any touched
    // file that was already AT the cap at the anchor is still at most the cap.
    const cap = nfr1LineCap();
    const base = releaseCommit(PREVIOUS_RELEASE);
    const atCap: string[] = [];
    for (const path of touchedSkillFiles()) {
      const proc = Bun.spawnSync(["git", "-C", REPO_ROOT, "show", `${base}:${path}`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode !== 0) continue; // added after the anchor
      const before = proc.stdout.toString().split("\n").length;
      if (before >= cap) atCap.push(path);
    }
    expect(
      atCap.length,
      "no touched skill file was at the cap, so this leg measures nothing",
    ).toBeGreaterThan(0);
    for (const path of atCap) {
      const now = skillLineCount(path);
      expect(now, `${path} grew past the cap to ${now}`).toBeLessThanOrEqual(cap);
    }
  });
});

// ===========================================================================
// AC-STE-536.2 / AC-STE-536.4 — A SURFACE THAT STATES A BUDGET MUST CLEAR IT
//
// THE BLIND SPOT. Everything above checks that the surfaces STATE the right
// numbers. Nothing above checks that a surface OBEYS the number it states.
// Those are different properties, and the gap between them is not theoretical:
// `templates/spec-templates/plan.md.template` states the plan narrative budget
// in its own § Task Sizing subsection, and that same subsection is prose well
// past the cap the sentence announces. Staged as an active plan and run
// through the shipped scanner it yields one `word_cap` violation, anchored on
// the budget sentence itself.
//
// WHY NO EXISTING DOGFOOD SEES IT. The plan half of probe #67 walks
// `specs/plan/*.md`. This repository's own plan is hand-written and clean, and
// the TEMPLATE lives outside every scanned tree — `templates/`, not `specs/`.
// So the scanner is green here and red in every project `/setup` scaffolds:
// step 8 copies this template to `specs/plan/M1.md`, and the consumer's first
// `/gate-check` fails on prose the consumer never wrote.
//
// THE GENERALISATION. Pinning one path would leave the same hole open for the
// next plan template. The rule asserted instead is a property of the class:
// every plan-shaped template this repo ships must satisfy the plan budget it
// states. The file list is a glob over `templates/spec-templates/*.md.template`
// filtered by SHAPE — a leading YAML frontmatter block carrying a `milestone:`
// key, which is what makes a file one `/setup` lands in `specs/plan/` and one
// the plan scanner walks. A second plan template added later is covered with
// no edit here, and the filter is asserted to DISCRIMINATE (it must exclude at
// least one shipped template) so "plan-shaped" cannot quietly become "every
// file".
//
// NON-VACUITY. "Zero violations" is the same answer a scanner that read
// nothing would give. So each template's audit also asserts the MEASUREMENT:
// the subsections the scan classified, named, in file order, equal the `###`
// headings actually present in the template source, and at least one of them
// was classified narrative — a structural-only template would be exempt by
// construction and would prove nothing.
//
// FALSIFIABILITY. Two mutations, both through the same helpers the real audit
// uses: an over-cap plan-shaped template staged the same way must produce a
// `word_cap` violation naming its own subsection, and a temp templates
// directory holding one plan-shaped and one non-plan template must yield
// exactly the plan-shaped one from discovery and redden on it.
// ===========================================================================

const SPEC_TEMPLATES_DIR = join(pluginRoot, "templates", "spec-templates");

/** Where `/setup` step 8 lands the plan template in a consumer project. */
const STAGED_PLAN_REL = "specs/plan/M1.md";

interface StagedTree {
  root: string;
  cleanup: () => void;
}

/** Write `files` (repo-relative paths) into a fresh temp root. */
function stageTree(files: Record<string, string>, prefix: string): StagedTree {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

interface ShippedTemplate {
  /** Basename, e.g. `plan.md.template`. */
  name: string;
  /** Full file text. */
  text: string;
}

/** Every spec template this repo ships, in name order. */
function shippedTemplates(dir: string = SPEC_TEMPLATES_DIR): ShippedTemplate[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md.template"))
    .sort()
    .map((n) => ({ name: n, text: read(join(dir, n)) }));
}

/** The leading YAML frontmatter block of a markdown file, or null. */
function frontmatterOf(text: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m === null ? null : (m[1] as string);
}

/**
 * Plan-shaped = carries the frontmatter key that binds a file to a milestone.
 * That key is what `/setup` fills when it copies a template into
 * `specs/plan/`, and a file in `specs/plan/` is what the plan scanner walks.
 * Deciding by SHAPE rather than by filename is what makes a second plan
 * template covered without an edit here.
 */
function isPlanShaped(text: string): boolean {
  const fm = frontmatterOf(text);
  if (fm === null) return false;
  return fm.split("\n").some((l) => /^milestone:\s*\S/.test(l));
}

function planShapedTemplates(dir?: string): ShippedTemplate[] {
  return shippedTemplates(dir).filter((t) => isPlanShaped(t.text));
}

interface PlanTemplateAudit {
  violations: PlanNarrativeViolation[];
  measured: MeasuredSubsection[];
}

/**
 * Stage one template exactly where `/setup` lands it and run the SHIPPED
 * scanner over it. Both the violations and the measurements come back, so a
 * caller can prove the scan happened before trusting that it was clean.
 */
function auditPlanTemplate(t: ShippedTemplate): PlanTemplateAudit {
  const staged = stageTree({ [STAGED_PLAN_REL]: t.text }, "budget-surface-plan-");
  try {
    return {
      violations: scanPlanNarrativeAltitude(staged.root),
      measured: measurePlanSubsections(staged.root),
    };
  } finally {
    staged.cleanup();
  }
}

/** The level-3 headings of a template, in file order — the expected subject set. */
function h3HeadingsOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^###(?!#)\s+(.*?)\s*$/.exec(line);
    if (m !== null) out.push(m[1] as string);
  }
  return out;
}

/** `n` whitespace-delimited words, carrying no digits of their own. */
function prosePad(n: number): string {
  return Array.from({ length: n }, () => "budget").join(" ");
}

/** The subsection heading the over-cap fixtures below breach under. */
const PADDED_SECTION = "Padded Narrative";

/**
 * A plan-shaped template that STATES the budget and then breaches it — the
 * exact shape of the shipped defect, built from the exported cap so no number
 * is typed here.
 */
function overCapPlanTemplate(): string {
  return [
    "---",
    "milestone: <milestone-id>",
    "status: active",
    "---",
    "",
    "# Implementation Plan",
    "",
    `Every prose subsection of this plan is capped at ${PLAN_NARRATIVE_WORD_CAP} words.`,
    "",
    "## Milestone Order",
    "",
    `### ${PADDED_SECTION}`,
    "",
    prosePad(PLAN_NARRATIVE_WORD_CAP + MUTATION_DELTA),
    "",
  ].join("\n");
}

/** A template with no frontmatter at all — never plan-shaped. */
function nonPlanTemplate(): string {
  return [
    "# Technical Specification",
    "",
    "## 1. Architecture",
    "",
    `### ${PADDED_SECTION}`,
    "",
    prosePad(PLAN_NARRATIVE_WORD_CAP + MUTATION_DELTA),
    "",
  ].join("\n");
}

describe("budget-stating surfaces — plan-shaped templates clear the plan cap", () => {
  test("discovery finds shipped templates and DISCRIMINATES plan-shaped ones", () => {
    const all = shippedTemplates();
    expect(all.length, "no spec templates were discovered at all").toBeGreaterThan(0);
    const plans = planShapedTemplates();
    expect(plans.length, "no shipped template is plan-shaped").toBeGreaterThan(0);
    // The filter must actually reject something; a predicate that admits every
    // template would make the audits below run over unrelated files and would
    // read as broader coverage rather than as a broken filter.
    expect(
      plans.length,
      "every shipped template reads as plan-shaped, so the filter decides nothing",
    ).toBeLessThan(all.length);
  });

  test("every plan-shaped template STATES the budget it is about to be held to", () => {
    // The antecedent of the rule, asserted rather than assumed: these are the
    // surfaces that announce the cap, which is why they must clear it.
    const plans = planShapedTemplates();
    expect(plans.length).toBeGreaterThan(0);
    for (const t of plans) {
      expect(
        statesWordBudget(t.text, PLAN_NARRATIVE_WORD_CAP),
        `${t.name} does not state the plan narrative budget`,
      ).toBe(true);
    }
  });

  for (const t of planShapedTemplates()) {
    test(`${t.name} — the scan CLASSIFIED its subsections, by name`, () => {
      const audit = auditPlanTemplate(t);
      const headings = h3HeadingsOf(t.text);
      expect(headings.length, `${t.name} has no level-3 subsections`).toBeGreaterThan(0);
      // Named and ordered: a scanner that read nothing returns an empty list,
      // and one that read a different file returns different names.
      expect(audit.measured.map((m) => m.section)).toEqual(headings);
      expect(audit.measured.every((m) => m.words > 0)).toBe(true);
      // A wholly structural template would be exempt by construction, so the
      // zero-violation leg below would prove nothing about its prose.
      expect(
        audit.measured.some((m) => m.kind === "narrative"),
        `${t.name} has no narrative subsection, so the cap is never applied`,
      ).toBe(true);
    });

    test(`${t.name} — staged as a plan, the shipped scanner returns ZERO violations`, () => {
      const audit = auditPlanTemplate(t);
      // Rendered as strings so a failure names the offending subsection and
      // rule rather than printing an opaque object count.
      expect(
        audit.violations.map((v) => `${v.section} — ${v.rule} (line ${v.line})`),
      ).toEqual([]);
    });
  }

  test("the audit BITES — an over-cap plan-shaped template reddens it", () => {
    const fixture: ShippedTemplate = {
      name: "over-cap.md.template",
      text: overCapPlanTemplate(),
    };
    const audit = auditPlanTemplate(fixture);
    // The mutation reached the scanner: it measured the padded subsection.
    expect(audit.measured.map((m) => m.section)).toEqual([PADDED_SECTION]);
    expect(audit.measured[0]?.kind).toBe("narrative");
    expect(audit.violations.length).toBeGreaterThan(0);
    expect(audit.violations.map((v) => v.section)).toContain(PADDED_SECTION);
    expect(audit.violations.every((v) => v.rule === "word_cap")).toBe(true);
  });

  test("discovery BITES — a second plan-shaped template is picked up and audited", () => {
    // The generalisation, demonstrated: drop a new plan-shaped template beside
    // a non-plan one and it is found, filtered in, and measured — with no edit
    // to the list above.
    const staged = stageTree(
      {
        "aaa-not-a-plan.md.template": nonPlanTemplate(),
        "zzz-second-plan.md.template": overCapPlanTemplate(),
      },
      "budget-surface-dir-",
    );
    try {
      expect(shippedTemplates(staged.root).map((t) => t.name)).toEqual([
        "aaa-not-a-plan.md.template",
        "zzz-second-plan.md.template",
      ]);
      const plans = planShapedTemplates(staged.root);
      expect(plans.map((t) => t.name)).toEqual(["zzz-second-plan.md.template"]);
      const audit = auditPlanTemplate(plans[0] as ShippedTemplate);
      expect(audit.violations.map((v) => v.section)).toContain(PADDED_SECTION);
    } finally {
      staged.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-536.1 / AC-STE-536.4 — the symmetric FR-side guard
//
// Same principle, other budget. The FR-authoring guidance surface states three
// word budgets; nothing so far checks the FR bodies it governs against THE
// NUMBERS IT STATES. The blocks above compare number to number — surface text
// against scanner export — which catches a retyped constant but never asks
// whether any FR actually clears what the guidance promises.
//
// So the caps used here are PARSED OUT OF THE GUIDANCE PROSE and handed to the
// shipped scanner as its injectable section table. A budget the surface states
// and the FRs breach fails here even when the scanner's own constant agrees
// with the prose, and a surface tightened in prose alone fails here even
// though direction (ii) above would call it drift rather than a breach.
//
// NON-VACUITY, twice over. All three budgets must PARSE (a table built from
// `null` caps would measure nothing), and the scan must return measurements
// over more than one FR file. The subject tree is the repository's own FRs
// with the archive fallback this repo has been bitten without: archiving a
// milestone empties `specs/frs/`, and an active-tree-only dogfood goes silently
// vacuous at exactly that commit.
//
// FALSIFIABILITY: the same guidance text with every stated budget rewritten
// down to a handful of words must redden the very same tree.
// ===========================================================================

/** Any stated word budget; group 1 is the number. */
const ANY_WORD_BUDGET_RE = /\b(\d+)[ -]words?\b/;

/**
 * The budget the surface STATES for `section`: the first stated word budget
 * whose nearest preceding capped section name is that section — the same
 * ordinal binding `bindsBudgetToSection` uses, returning the number instead of
 * a verdict.
 */
function statedBudgetFor(text: string, section: string): number | null {
  const re = new RegExp(ANY_WORD_BUDGET_RE.source, "g");
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const before = text.slice(0, m.index);
    let nearest: string | null = null;
    let nearestAt = -1;
    for (const name of CAPPED_SECTION_NAMES) {
      const at = before.lastIndexOf(name);
      if (at > nearestAt) {
        nearestAt = at;
        nearest = name;
      }
    }
    if (nearest === section) return Number(m[1]);
  }
  return null;
}

/**
 * The scanner's section table rebuilt from what the guidance surface SAYS.
 * Throws on a section whose budget cannot be parsed: a silent fallback to the
 * exported cap would turn this guard back into the number-to-number comparison
 * it exists to complement.
 */
function statedSectionRules(text: string): SectionRuleSpec[] {
  return SECTION_RULES.map((r: SectionRuleSpec): SectionRuleSpec => {
    if (r.wordCap === null) return r;
    const stated = statedBudgetFor(text, r.section);
    if (stated === null) {
      throw new Error(
        `the FR-authoring guidance surface states no word budget for \`${r.section}\`, ` +
          "so the FRs it governs cannot be measured against what it promises",
      );
    }
    return { section: r.section, wordCap: stated, rules: r.rules };
  });
}

interface FrDogfood {
  root: string;
  source: "active" | "archive";
  files: readonly string[];
  cleanup: () => void;
}

/** The milestone whose FRs this suite dogfoods, on either resolution path. */
const DOGFOOD_MILESTONE = "M137";

/**
 * A root whose `specs/frs/` the FR scanner can walk: this repository when its
 * active tree carries FRs, otherwise a temp root seeded with THIS MILESTONE's
 * archived FRs. Throws when neither exists — an empty subject is a failure,
 * never a pass.
 *
 * THE FALLBACK IS MILESTONE-SCOPED, and that scoping is the whole point rather
 * than a refinement. `specs/frs/archive/` holds 442 FRs, nearly all of them
 * written before these budgets existed; measured 2026-08-31 the archive carries
 * 638 `word_cap` breaches against a rule it predates (`STE-101.md:47`,
 * `STE-101.md:66`, `STE-103.md:77`, …). An unscoped fallback therefore does not
 * restore the subject the archive commit took away — it substitutes a larger
 * pre-rule subject and reddens the tree on legitimate history. The sibling
 * STE-534 and STE-535 dogfoods scope theirs by frontmatter for exactly this
 * reason, and this one now speaks the same idiom.
 */
function frDogfoodTree(repoRoot: string = REPO_ROOT): FrDogfood {
  // BOTH paths through the shared resolver. The ACTIVE half used to take every
  // `.md` under `specs/frs/` while only the ARCHIVE half was milestone-scoped,
  // so the moment the next milestone opened an FR this suite would have graded
  // M137's stated budgets over M138's prose with every non-vacuity leg green.
  const resolved = milestoneSpecFiles(repoRoot, "specs/frs", DOGFOOD_MILESTONE);
  if (resolved.source === "none") {
    throw new Error(
      `this repository carries no FR files for ${DOGFOOD_MILESTONE} at all, active or ` +
        "archived, so the FR-side guard would report a clean tree while measuring nothing",
    );
  }
  // Always staged, on either path: the scanner walks a DIRECTORY, so a filtered
  // list handed back beside an unfiltered root would grade the files the filter
  // was supposed to remove.
  const names = resolved.files.map((abs) => abs.split(/[\\/]/).pop() as string);
  const files: Record<string, string> = {};
  for (const abs of resolved.files) {
    files[`specs/frs/${abs.split(/[\\/]/).pop() as string}`] = read(abs);
  }
  const staged = stageTree(files, "budget-surface-fr-");
  return {
    root: staged.root,
    source: resolved.source,
    files: names,
    cleanup: staged.cleanup,
  };
}

interface FrAudit {
  violations: FrSummaryAltitudeViolation[];
  measured: MeasuredSection[];
  /** WHICH tree supplied the FRs — carried out so legs can pin it. */
  source: "active" | "archive";
  /** How many FR files the subject actually held. */
  fileCount: number;
}

/** Run the shipped FR scanner over the dogfood tree under a given table. */
function auditFrTree(rules: readonly SectionRuleSpec[]): FrAudit {
  const dog = frDogfoodTree();
  try {
    return {
      violations: scanFrSummaryAltitude(dog.root, rules),
      measured: measureFrSections(dog.root, rules),
      source: dog.source,
      fileCount: dog.files.length,
    };
  } finally {
    dog.cleanup();
  }
}

describe("budget-stating surfaces — the FR guidance surface clears its own caps", () => {
  test("all three budgets PARSE out of the guidance prose, and match the scanner", () => {
    const text = read(SPEC_WRITE);
    const rules = statedSectionRules(text);
    const capped = rules.filter((r) => r.wordCap !== null);
    expect(capped.length).toBe(FR_BUDGETS.length);
    for (const { section, cap } of FR_BUDGETS) {
      expect(statedBudgetFor(text, section), `${section} as stated`).toBe(cap);
    }
  });

  test("the FR subject tree is real — measured sections over more than one file", () => {
    const audit = auditFrTree(statedSectionRules(read(SPEC_WRITE)));
    // WHICH tree answered, stated outright — and how many files it held. On the
    // archive path that count is this milestone's FRs alone, never the whole
    // 442-file archive, so a fallback that quietly widened would show up here.
    expect(["active", "archive"]).toContain(audit.source);
    expect([audit.source, audit.fileCount >= 3]).toEqual([audit.source, true]);
    expect(audit.measured.length, "no FR section was measured at all").toBeGreaterThan(0);
    expect(
      new Set(audit.measured.map((m) => m.file)).size,
      "a single-file subject proves little",
    ).toBeGreaterThan(1);
    // Every measured section is one the guidance actually budgets.
    for (const m of audit.measured) {
      expect(CAPPED_SECTION_NAMES).toContain(m.section);
    }
  });

  test("the FRs clear the budgets the guidance surface STATES", () => {
    const audit = auditFrTree(statedSectionRules(read(SPEC_WRITE)));
    expect(
      audit.violations.map((v) => `${v.file}:${v.line} — ${v.rule} — ${v.section}`),
    ).toEqual([]);
  });

  test("the guard BITES — a guidance surface stating a smaller cap reddens the tree", () => {
    const text = read(SPEC_WRITE);
    // Baseline first: the shipped prose over the shipped tree is clean.
    expect(auditFrTree(statedSectionRules(text)).violations.length).toBe(0);

    // Now shrink every stated budget in an in-memory copy of the surface. The
    // replacement value is the mutation delta, not a budget, and every real FR
    // section is longer than a handful of words.
    let shrunk = text;
    for (const { cap } of FR_BUDGETS) {
      shrunk = rewriteWordBudget(shrunk, cap, MUTATION_DELTA);
    }
    expect(shrunk, "the mutation never applied").not.toBe(text);
    const mutatedRules = statedSectionRules(shrunk);
    for (const r of mutatedRules) {
      if (r.wordCap !== null) expect(r.wordCap).toBe(MUTATION_DELTA);
    }

    const audit = auditFrTree(mutatedRules);
    expect(audit.violations.length).toBeGreaterThan(0);
    expect(audit.violations.every((v) => v.rule === "word_cap")).toBe(true);
    expect(new Set(audit.violations.map((v) => v.section)).size).toBeGreaterThan(0);
  });
});

// ===========================================================================
// PR #76 ROUND C — F8: THE FR DOGFOOD'S ACTIVE PATH IS UNSCOPED
// ===========================================================================
//
// `frDogfoodTree`'s own doc comment argues the scoping case at length — 442
// archived FRs, 638 `word_cap` breaches against a rule they predate — and then
// applies it to the ARCHIVE branch alone. The ACTIVE branch takes every `.md`
// in `specs/frs/`, unfiltered. The two are indistinguishable while M137 is the
// only open milestone; they diverge the moment M138 opens an FR, and at that
// point this suite grades M137's stated budgets over M138's prose while every
// non-vacuity leg keeps passing.
//
// `milestoneSpecFiles` in `tests/_spec_tree.ts` is the shared shape that
// filters both paths and reports which one answered.

/** A minimal active FR bound to `milestone`, with one budgeted section. */
function fixtureFr(id: string, milestone: string, summaryWords: number): string {
  const words = Array.from({ length: summaryWords }, (_, i) => `word${i % 7}`).join(" ");
  return [
    "---",
    `title: "Fixture ${id}"`,
    "status: active",
    `milestone: ${milestone}`,
    "---",
    "",
    `# ${id}: Fixture`,
    "",
    "## Summary",
    "",
    words,
    "",
  ].join("\n");
}

describe("F8 — the FR dogfood subject is milestone-scoped on BOTH paths", () => {
  test("an ACTIVE tree carrying a LATER milestone's FRs supplies only THIS milestone's", () => {
    const fx = stageTree(
      {
        "specs/frs/STE-990.md": fixtureFr("STE-990", DOGFOOD_MILESTONE, 30),
        "specs/frs/STE-991.md": fixtureFr("STE-991", "M138", 30),
      },
      "budget-surface-f8-",
    );
    const dog = frDogfoodTree(fx.root);
    try {
      expect(dog.source).toBe("active");
      expect([...dog.files]).toEqual(["STE-990.md"]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });

  test("the SCANNER sees only those files — the reported list and the graded root agree", () => {
    // `auditFrTree` hands `dog.root` to a scanner that walks the DIRECTORY, so
    // filtering only the reported `files` would leave M138's FR graded while
    // the names looked right.
    const fx = stageTree(
      {
        "specs/frs/STE-990.md": fixtureFr("STE-990", DOGFOOD_MILESTONE, 30),
        "specs/frs/STE-991.md": fixtureFr("STE-991", "M138", 30),
      },
      "budget-surface-f8-",
    );
    const dog = frDogfoodTree(fx.root);
    try {
      const rules = statedSectionRules(read(SPEC_WRITE));
      const files = new Set(measureFrSections(dog.root, rules).map((m) => m.file));
      expect([...files].sort()).toEqual(["specs/frs/STE-990.md"]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });

  test("an ACTIVE tree holding none of THIS milestone's FRs never reads as an active pass", () => {
    const fx = stageTree(
      { "specs/frs/STE-992.md": fixtureFr("STE-992", "M138", 30) },
      "budget-surface-f8-",
    );
    try {
      // No archived copy exists under this temp root either, so the resolver
      // must raise rather than hand back another milestone's FR.
      expect(() => frDogfoodTree(fx.root)).toThrow(/M137/);
    } finally {
      fx.cleanup();
    }
  });

  test("ISOLATION — an active tree of THIS milestone's FRs alone still resolves active", () => {
    const fx = stageTree(
      { "specs/frs/STE-993.md": fixtureFr("STE-993", DOGFOOD_MILESTONE, 30) },
      "budget-surface-f8-",
    );
    const dog = frDogfoodTree(fx.root);
    try {
      expect(dog.source).toBe("active");
      expect([...dog.files]).toEqual(["STE-993.md"]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });
});
