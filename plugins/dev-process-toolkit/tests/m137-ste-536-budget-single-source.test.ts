// STE-536 (M137) — the authoring surfaces state the budgets, and they state
// them FROM the scanner's own definition. RED-state until the two authoring
// surfaces are edited:
//
//   skills/spec-write/SKILL.md            — the § 0b `## Summary` line (AC-STE-536.1)
//   templates/spec-templates/plan.md.template — § Task Sizing (AC-STE-536.2)
//
// SCOPE. This file covers FOUR of the FR's six ACs — .1, .2, .4 and .6. It
// deliberately does NOT test AC-STE-536.3 (the anti-decoration rule) or
// AC-STE-536.5 (skill files under the NFR-1 line cap / the docs extraction).
// Those land prose on eleven skill surfaces that are frozen pending an
// operator decision on a sibling FR, and a test here would pin work this file
// is not allowed to authorise.
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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SECTION_RULES,
  type SectionRuleSpec,
} from "../adapters/_shared/src/scan_fr_summary_altitude";
import {
  CHECKBOX_ITEM_MAJORITY,
  PLAN_NARRATIVE_WORD_CAP,
} from "../adapters/_shared/src/scan_plan_narrative_altitude";
import {
  ADOPTING_STAGES,
  PROSE_LEAD_IN_LINE_CAP,
} from "../adapters/_shared/src/stage_block_adoption";
import { STAGE_REPORT_LINE_CAP } from "../adapters/_shared/src/stage_status_block";
import { FENCE_LINE_CAP } from "../adapters/_shared/src/deliver_stage_capture";

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
  // The § 0b guidance line already states the Summary altitude rule. This is
  // the anchor the budgets must land beside: same line, not merely same file.
  const SUMMARY_RULE_ANCHOR = "3–6 non-empty lines of plain prose";

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
