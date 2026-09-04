// M143 — "One review outcome, one instruction".
//
// `skills/implement/SKILL.md` carries two passages, twenty-four lines apart,
// that answer the same question — what happens when Stage B's Pass 1 returns
// critical findings — with opposite instructions:
//
//   site A (Stage B preamble): "do NOT run Pass 2; surface Pass 1 findings
//                               and stop."          ← HALT
//   site B (e. Integrate Pass 1): "Fix findings, re-run gate check, then
//                               re-invoke Pass 1 on round 2 — if round 2
//                               still fails, escalate."   ← BOUNDED LOOP
//
// Site B is the behaviour that survives; site A is REWRITTEN to agree (not
// deleted — it sits where a reader arrives first).
//
// Pin shape: the two-sided documentation contract probe #66 uses
// (adapters/_shared/src/spec_write_next_line_doc.ts) — positive literals at
// each site, matched as literal substrings, plus a tripwire on the retired
// wording. Two-sided is the whole point: the divergence exists because
// nothing ever compared the two sites.
//
// PRESCRIBED FIX (one line replaces one line — the file has zero headroom):
//
//    **If Pass 1 returns critical findings: Skip Pass 2. Fix findings, re-run gate check, then re-invoke Pass 1 on round 2 — if round 2 still fails, escalate.**
//
// Do not write a tracker id into any SKILL.md — a shipped token ceiling
// across skills/ is pinned elsewhere and is at its limit.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const SKILL_REL = "plugins/dev-process-toolkit/skills/implement/SKILL.md";
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

// Section anchors used to locate each site structurally, so a violation can
// name WHICH site drifted rather than reporting a file-level miss.
const STAGE_B_HEADER = "### Stage B — Two-Pass Review";
const PASS_1_HEADER = "### Pass 1: Spec Compliance";
const INTEGRATE_PASS_1 = "e. **Integrate Pass 1:**";
const PASS_2_HEADER = "### Pass 2: Code Quality";

// Within its section, each site is the unique line carrying this marker.
const SITE_A_MARKER = "critical findings";
const SITE_B_MARKER = "`OVERALL: CONCERNS`";

// AC-STE-553.2 — the loop's OWN vocabulary. A leg asserting only that the two
// sites agree would pass if BOTH had been rewritten to halt; these literals
// assert the surviving behaviour positively: skip, fix, re-run, second round,
// escalate.
const REQUIRED_LOOP_LITERALS = [
  "Skip Pass 2",
  "Fix findings",
  "re-run gate check",
  "re-invoke Pass 1 on round 2",
  "if round 2 still fails, escalate",
] as const;

// AC-STE-553.4 — retired halt wording. Matched as literal substrings so a
// copy-edit of the replacement cannot silently disable the tripwire, and the
// short phrase survives a re-punctuation of the full sentence.
const RETIRED_HALT_SENTENCE =
  "If Pass 1 returns critical findings, do NOT run Pass 2; " +
  "surface Pass 1 findings and stop.";
const RETIRED_HALT_PHRASE = "surface Pass 1 findings and stop";
const RETIRED_LITERALS = [RETIRED_HALT_SENTENCE, RETIRED_HALT_PHRASE] as const;

// The prescribed site-A replacement, used by the AC.6 mutations to restore
// a clean baseline body when the real file has not been fixed yet.
const SITE_A_FIXED_LINE =
  "   **If Pass 1 returns critical findings: Skip Pass 2. Fix findings, " +
  "re-run gate check, then re-invoke Pass 1 on round 2 — if round 2 " +
  "still fails, escalate.**";
const SITE_A_RETIRED_LINE = `   **${RETIRED_HALT_SENTENCE}**`;

// ---------------------------------------------------------------------------
// Pin
// ---------------------------------------------------------------------------

type Site = "A" | "B" | "file";

interface Violation {
  site: Site;
  line: number;
  reason: string;
}

function sectionRange(
  lines: readonly string[],
  startAnchor: string,
  endAnchor: string,
): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.includes(startAnchor));
  if (start < 0) return null;
  const rel = lines.slice(start + 1).findIndex((l) => l.includes(endAnchor));
  if (rel < 0) return null;
  return { start: start + 1, end: start + 1 + rel };
}

/** Index of the unique marker line inside a section, or a negative code. */
function locateSite(
  lines: readonly string[],
  startAnchor: string,
  endAnchor: string,
  marker: string,
): { index: number; matches: number } {
  const range = sectionRange(lines, startAnchor, endAnchor);
  if (!range) return { index: -1, matches: -1 };
  const hits: number[] = [];
  for (let i = range.start; i < range.end; i += 1) {
    if ((lines[i] ?? "").includes(marker)) hits.push(i);
  }
  return { index: hits[0] ?? -1, matches: hits.length };
}

export function locateSiteA(lines: readonly string[]) {
  return locateSite(lines, STAGE_B_HEADER, PASS_1_HEADER, SITE_A_MARKER);
}

export function locateSiteB(lines: readonly string[]) {
  return locateSite(lines, INTEGRATE_PASS_1, PASS_2_HEADER, SITE_B_MARKER);
}

/**
 * The two-sided pin. Returns every violation, each tagged with the site that
 * drifted, so correcting one site and leaving the other is a failure that
 * names the survivor (AC-STE-553.3).
 */
export function pinOneReviewInstruction(body: string): Violation[] {
  const lines = body.split("\n");
  const violations: Violation[] = [];

  for (const [site, locator] of [
    ["A", locateSiteA],
    ["B", locateSiteB],
  ] as const) {
    const { index, matches } = locator(lines);
    if (matches !== 1) {
      violations.push({
        site,
        line: 0,
        reason:
          `site ${site} not uniquely locatable (found ${matches} marker ` +
          "lines in its section; expected exactly 1)",
      });
      continue;
    }
    const text = lines[index] ?? "";
    for (const literal of REQUIRED_LOOP_LITERALS) {
      if (text.includes(literal)) continue;
      violations.push({
        site,
        line: index + 1,
        reason:
          `site ${site} is missing bounded-loop literal ` +
          `${JSON.stringify(literal)}`,
      });
    }
  }

  // Tripwire — file-wide, so the retired halt wording cannot reappear at a
  // third location either (AC-STE-553.4).
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    for (const retired of RETIRED_LITERALS) {
      if (!text.includes(retired)) continue;
      violations.push({
        site: "file",
        line: i + 1,
        reason: `retired halt wording ${JSON.stringify(retired)} present`,
      });
    }
  }

  return violations;
}

function violationsFor(body: string, site: Site): Violation[] {
  return pinOneReviewInstruction(body).filter((v) => v.site === site);
}

function describeViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return "(none)";
  return violations
    .map((v) => `${SKILL_REL}:${v.line} [site ${v.site}] ${v.reason}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const body = readFileSync(skillPath, "utf-8");
const lines = body.split("\n");

/**
 * A body guaranteed to satisfy the pin, derived from the real file by
 * applying the prescribed site-A rewrite. Once the implementation lands this
 * is byte-identical to the real file; before it lands, it lets the AC.6
 * mutation legs still exercise real content — while the `expect` on the real
 * file's own cleanliness keeps them honestly RED.
 */
function cleanBody(): string {
  const copy = [...lines];
  const a = locateSiteA(copy);
  if (a.matches === 1) copy[a.index] = SITE_A_FIXED_LINE;
  return copy.join("\n");
}

function replaceLine(source: string, index: number, next: string): string {
  const copy = source.split("\n");
  copy[index] = next;
  return copy.join("\n");
}

// ---------------------------------------------------------------------------
// AC-STE-553.1 / .3 — exactly one instruction, asserted at BOTH sites
// ---------------------------------------------------------------------------

describe("AC-STE-553.1 / AC-STE-553.3 — one instruction, two sites", () => {
  test("both sites are uniquely locatable", () => {
    expect(locateSiteA(lines).matches).toBe(1);
    expect(locateSiteB(lines).matches).toBe(1);
  });

  test("site A (Stage B preamble) carries the surviving instruction", () => {
    const found = violationsFor(body, "A");
    expect(describeViolations(found)).toBe("(none)");
  });

  test("site B (Integrate Pass 1) carries the surviving instruction", () => {
    const found = violationsFor(body, "B");
    expect(describeViolations(found)).toBe("(none)");
  });

  test("the two sites give the same instruction", () => {
    const a = lines[locateSiteA(lines).index] ?? "";
    const b = lines[locateSiteB(lines).index] ?? "";
    const shared = REQUIRED_LOOP_LITERALS.filter(
      (lit) => a.includes(lit) && b.includes(lit),
    );
    expect(shared).toEqual([...REQUIRED_LOOP_LITERALS]);
  });

  test("the whole pin is clean on the shipped file", () => {
    expect(describeViolations(pinOneReviewInstruction(body))).toBe("(none)");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-553.2 — the surviving behaviour is the BOUNDED LOOP, not a halt
// ---------------------------------------------------------------------------

describe("AC-STE-553.2 — the loop's own vocabulary survives", () => {
  test("each site names fix, re-run, second round, and escalate", () => {
    for (const [site, index] of [
      ["A", locateSiteA(lines).index],
      ["B", locateSiteB(lines).index],
    ] as const) {
      const text = lines[index] ?? "";
      const missing = REQUIRED_LOOP_LITERALS.filter((l) => !text.includes(l));
      expect(`site ${site}: ${missing.join(", ") || "(none)"}`).toBe(
        `site ${site}: (none)`,
      );
    }
  });

  test("a both-sites-halt rewrite would NOT satisfy the pin", () => {
    // The failure mode this leg exists for: resolving the contradiction by
    // rewriting BOTH sites to halt. Agreement alone must not be enough.
    const base = cleanBody();
    const baseLines = base.split("\n");
    const withHaltA = replaceLine(
      base,
      locateSiteA(baseLines).index,
      SITE_A_RETIRED_LINE,
    );
    const bothHalt = replaceLine(
      withHaltA,
      locateSiteB(withHaltA.split("\n")).index,
      `   - \`OVERALL: CONCERNS\` → ${RETIRED_HALT_SENTENCE}`,
    );
    expect(bothHalt).not.toBe(base);
    expect(pinOneReviewInstruction(bothHalt).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-553.4 — tripwire on the retired wording
// ---------------------------------------------------------------------------

describe("AC-STE-553.4 — retired halt wording tripwire", () => {
  test("the retired sentence is absent from the shipped file", () => {
    expect(body.includes(RETIRED_HALT_SENTENCE)).toBe(false);
  });

  test("the retired halt phrase is absent from the shipped file", () => {
    expect(body.includes(RETIRED_HALT_PHRASE)).toBe(false);
  });

  test("the tripwire fires wherever the retired wording is reintroduced", () => {
    const reintroduced = `${cleanBody()}\n\n   **${RETIRED_HALT_SENTENCE}**`;
    const fileHits = violationsFor(reintroduced, "file");
    expect(fileHits.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-553.5 — the edit is net-zero or shorter
// ---------------------------------------------------------------------------

describe("AC-STE-553.5 — no line-count cost", () => {
  // Baseline measured on this tree the way the enforcing suite measures it:
  // split("\n").length === 358 (wc -l reports 357, one fewer — expected).
  const BASELINE_LINES = 358;

  test("the enforcing cap is still the number this leg is written against", () => {
    // Re-derive the cap from its source rather than trusting the constant:
    // a briefed number that drifts becomes a pin defended by a green suite.
    const capSource = readFileSync(
      join(pluginRoot, "tests", "skill-nfr-1-length.test.ts"),
      "utf-8",
    );
    const match = /const SKILL_LINE_CAP = (\d+);/.exec(capSource);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(BASELINE_LINES);
  });

  test("the landed fix costs no lines", () => {
    // Guard first: a line-count assertion alone is green on the UNFIXED file,
    // which would score a mutation that never applied as a pass.
    expect(describeViolations(pinOneReviewInstruction(body))).toBe("(none)");

    const headBody = execFileSync("git", ["show", `HEAD:${SKILL_REL}`], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const headLines = headBody.split("\n").length;

    expect(lines.length).toBeLessThanOrEqual(BASELINE_LINES);
    expect(lines.length).toBeLessThanOrEqual(headLines);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-553.6 — falsifiability, per site, independently
// ---------------------------------------------------------------------------

describe("AC-STE-553.6 — restoring the halt at either site reddens the pin", () => {
  test("precondition: the shipped file passes the pin un-mutated", () => {
    expect(describeViolations(pinOneReviewInstruction(body))).toBe("(none)");
  });

  test("mutation at site A alone reddens site A and spares site B", () => {
    const base = cleanBody();
    const baseLines = base.split("\n");
    const idx = locateSiteA(baseLines).index;
    expect(idx).toBeGreaterThanOrEqual(0);

    const mutated = replaceLine(base, idx, SITE_A_RETIRED_LINE);
    // The mutation must actually apply — an inert mutation reads as a pass.
    expect(mutated).not.toBe(base);
    expect(mutated.split("\n")[idx]).toBe(SITE_A_RETIRED_LINE);
    expect(mutated.split("\n").length).toBe(baseLines.length);

    expect(violationsFor(mutated, "A").length).toBeGreaterThan(0);
    expect(describeViolations(violationsFor(mutated, "B"))).toBe("(none)");
    expect(violationsFor(mutated, "file").length).toBeGreaterThan(0);
  });

  test("mutation at site B alone reddens site B and spares site A", () => {
    const base = cleanBody();
    const baseLines = base.split("\n");
    const idx = locateSiteB(baseLines).index;
    expect(idx).toBeGreaterThanOrEqual(0);

    const halted =
      "   - `OVERALL: CONCERNS` (critical: undocumented features or " +
      `missing AC coverage) → ${RETIRED_HALT_SENTENCE}`;
    const mutated = replaceLine(base, idx, halted);
    expect(mutated).not.toBe(base);
    expect(mutated.split("\n")[idx]).toBe(halted);
    expect(mutated.split("\n").length).toBe(baseLines.length);

    expect(violationsFor(mutated, "B").length).toBeGreaterThan(0);
    expect(describeViolations(violationsFor(mutated, "A"))).toBe("(none)");
    expect(violationsFor(mutated, "file").length).toBeGreaterThan(0);
  });
});
