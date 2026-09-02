// STE-534 (M137) — word caps on FR narrative sections, on the probe that
// already exists. RED-state until the generalisation lands in the EXISTING
// scanner at:
//   plugins/dev-process-toolkit/adapters/_shared/src/scan_fr_summary_altitude.ts
//
// The scanner today walks ACTIVE FRs, locates `## Summary` by exact level-2
// heading match, walks to the next level-2 heading, and enforces a CLOSED rule
// union of exactly four rules (line_cap | backtick | ac_id | path_token), all
// of them Summary-scoped by construction because Summary is the only section
// it ever enters.
//
// This FR adds a fifth union member, `word_cap`, and widens the WALK — and only
// the walk — to two more narrative sections, each with its own number. The four
// existing rules stay bound to Summary ALONE.
//
// CONTRACT PINNED HERE (the shape the implementer must build):
//
//   export const SUMMARY_WORD_CAP = 80;
//   export const TECHNICAL_DESIGN_WORD_CAP = 120;
//   export const NOTES_WORD_CAP = 60;
//
//   export interface SectionRuleSpec {
//     readonly section: string;                     // exact level-2 heading text
//     readonly wordCap: number | null;              // null = uncapped
//     readonly rules: readonly RuleName[];          // rules BEYOND word_cap
//   }
//   export const SECTION_RULES: readonly SectionRuleSpec[];
//
//   export interface FrSummaryAltitudeViolation {
//     file: string; line: number; rule: RuleName; section: string;
//   }
//
//   scanFrSummaryAltitude(projectRoot, sectionRules = SECTION_RULES)
//     => FrSummaryAltitudeViolation[]
//
//   export interface MeasuredSection { file: string; section: string; words: number }
//   measureFrSections(projectRoot, sectionRules = SECTION_RULES)
//     => MeasuredSection[]
//
// WHY the table is a PARAMETER and not just a private constant: the FR's own
// Technical Design makes AC-STE-534.3's asymmetry "data rather than control
// flow", and AC-STE-534.8's three mutations are exactly table edits — raise a
// cap, widen a rule set, cap an uncapped section. Injecting a mutated table is
// therefore the mutation, and "the mutation applied" is measurable (the table
// handed in differs from the shipped one in the named field) rather than
// assumed. The default argument keeps the dogfood (AC-STE-534.7) and every
// existing caller on the SHIPPED table.
//
// WHY the anchor line is the CROSSING line: a violation must name "the line it
// anchors at" (AC-STE-534.1). For `word_cap` that is the first body line at
// which the running word count first EXCEEDS the cap — the line the author has
// to cut back to, mirroring `line_cap`'s "first line beyond the cap".
//
// AC map:
//   AC-STE-534.1 — union member + violation carries `section`
//   AC-STE-534.2 — 80 / 120 / 60 as exported named constants, body-only
//   AC-STE-534.3 — the discriminating asymmetry (+ its sibling half)
//   AC-STE-534.4 — Requirement / Acceptance Criteria / Testing uncapped
//   AC-STE-534.5 — probe id, severity and the README's 81-probe count unmoved
//   AC-STE-534.6 — per-section vacuity
//   AC-STE-534.7 — dogfood asserting a MEASURED COUNT, not an absence
//   AC-STE-534.8 — mutation-verified, each mutation asserted to have applied

import { describe, expect, test } from "bun:test";
const PLUGIN_ROOT = join(import.meta.dir, "..");
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  NOTES_WORD_CAP,
  PROBE_ID,
  SECTION_RULES,
  SUMMARY_WORD_CAP,
  TECHNICAL_DESIGN_WORD_CAP,
  measureFrSections,
  scanFrSummaryAltitude,
} from "../adapters/_shared/src/scan_fr_summary_altitude";
// The archive-blind-spot idiom, shared with the sibling M137 suites so there is
// exactly ONE spec-tree resolver rather than one per guard.
import { mdFilesIn, milestoneSpecFiles } from "./_spec_tree";

// ---------------------------------------------------------------- shared shapes

interface Violation {
  file: string;
  line: number;
  rule: string;
  section: string;
}

interface Measured {
  file: string;
  section: string;
  words: number;
}

interface RuleSpec {
  section: string;
  wordCap: number | null;
  rules: string[];
}

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SCANNER_SRC = join(
  import.meta.dir,
  "..",
  "adapters",
  "_shared",
  "src",
  "scan_fr_summary_altitude.ts",
);

// The optional second parameter is the injectable section table this FR adds;
// the calls are routed through a loose signature so the test pins BEHAVIOUR,
// not the declaration's exact generic shape.
const scanFn = scanFrSummaryAltitude as unknown as (
  root: string,
  table?: readonly RuleSpec[],
) => Violation[];
const measureFn = measureFrSections as unknown as (
  root: string,
  table?: readonly RuleSpec[],
) => Measured[];

const scan = (root: string, table?: readonly RuleSpec[]): Violation[] =>
  table === undefined ? scanFn(root) : scanFn(root, table);

const measure = (root: string, table?: readonly RuleSpec[]): Measured[] =>
  table === undefined ? measureFn(root) : measureFn(root, table);

/** Build a real temp project tree: rel-path => content. */
function makeTree(files: Record<string, string>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "fr-word-caps-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 1-indexed line of the first line in `content` containing `needle`. */
function lineOf(content: string, needle: string): number {
  const idx = content.split("\n").findIndex((l) => l.includes(needle));
  expect(idx).toBeGreaterThan(-1);
  return idx + 1;
}

/** Whitespace-delimited token count — the rule the scanner must implement. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const WORD_POOL = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
];

/**
 * `total` plain words spread over lines of `perLine` tokens. Every line's LAST
 * token is a unique `<prefix><NN>` marker, so a physical line can be located by
 * name and the crossing-line anchor asserted exactly. No token carries a
 * backtick, an AC-ID, a slash or a dot-extension — these bodies exercise the
 * word rule and nothing else.
 */
function bodyOfWords(total: number, prefix: string, perLine = 20): string[] {
  const lines: string[] = [];
  let remaining = total;
  let idx = 1;
  while (remaining > 0) {
    const take = Math.min(perLine, remaining);
    const marker = `${prefix}${String(idx).padStart(2, "0")}`;
    const filler = Array.from(
      { length: take - 1 },
      (_, i) => WORD_POOL[(idx * 7 + i) % WORD_POOL.length]!,
    );
    lines.push([...filler, marker].join(" "));
    remaining -= take;
    idx++;
  }
  return lines;
}

/** An active-FR file built from `[heading, bodyLines]` pairs, in order. */
function frFile(id: string, sections: [string, string[]][]): string {
  const out: string[] = [
    "---",
    `title: "Fixture ${id}"`,
    "status: active",
    "milestone: M137",
    "---",
    "",
    `# ${id}: Fixture`,
    "",
  ];
  for (const [heading, body] of sections) {
    out.push(`## ${heading}`, "", ...body, "");
  }
  return `${out.join("\n")}\n`;
}

const byRule = (vs: Violation[], rule: string) => vs.filter((v) => v.rule === rule);
const bySection = (vs: Violation[], section: string) =>
  vs.filter((v) => v.section === section);

/** A line that trips backtick + ac_id + path_token all at once. */
const DIRTY_LINE =
  "Mentions `renderStageEvidence` and AC-STE-534.3 and adapters/_shared/src/scan_fr_summary_altitude.ts once.";

/** Body of exactly `total` words whose FIRST line is `DIRTY_LINE`. */
function dirtyBodyOfWords(total: number, prefix: string): string[] {
  const rest = total - countWords(DIRTY_LINE);
  expect(rest).toBeGreaterThan(0);
  return [DIRTY_LINE, ...bodyOfWords(rest, prefix)];
}

// ================================================================ AC-STE-534.1

describe("AC-STE-534.1 — `word_cap` joins the closed union and names its section", () => {
  test("an over-cap Summary yields rule `word_cap` naming file, line, rule AND section", () => {
    const body = bodyOfWords(SUMMARY_WORD_CAP + 20, "sum"); // 100 words, 5 lines
    const content = frFile("STE-940", [["Summary", body]]);
    const fx = makeTree({ "specs/frs/STE-940.md": content });
    try {
      const violations = scan(fx.root);
      const hits = byRule(violations, "word_cap");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toEqual({
        file: "specs/frs/STE-940.md",
        // 20 words per line: 20/40/60/80/100 — the count first EXCEEDS 80 on
        // the fifth body line, which is where the violation anchors.
        line: lineOf(content, "sum05"),
        rule: "word_cap",
        section: "Summary",
      });
    } finally {
      fx.cleanup();
    }
  });

  test("the section field DISCRIMINATES which of the three caps broke", () => {
    // A rule id alone cannot say. Three files, three sections, three caps —
    // every violation carries the same rule id and a different section.
    const summary = frFile("STE-941", [["Summary", bodyOfWords(SUMMARY_WORD_CAP + 1, "s")]]);
    const design = frFile("STE-942", [
      ["Summary", ["A short compliant summary line."]],
      ["Technical Design", bodyOfWords(TECHNICAL_DESIGN_WORD_CAP + 1, "d")],
    ]);
    const notes = frFile("STE-943", [
      ["Summary", ["A short compliant summary line."]],
      ["Notes", bodyOfWords(NOTES_WORD_CAP + 1, "n")],
    ]);
    const fx = makeTree({
      "specs/frs/STE-941.md": summary,
      "specs/frs/STE-942.md": design,
      "specs/frs/STE-943.md": notes,
    });
    try {
      const violations = scan(fx.root);
      expect(byRule(violations, "word_cap")).toHaveLength(3);
      expect(
        byRule(violations, "word_cap")
          .map((v) => `${v.file}|${v.section}`)
          .sort(),
      ).toEqual([
        "specs/frs/STE-941.md|Summary",
        "specs/frs/STE-942.md|Technical Design",
        "specs/frs/STE-943.md|Notes",
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test("the union stays CLOSED at five members, and every violation carries a section", () => {
    const closed = new Set(["line_cap", "backtick", "ac_id", "path_token", "word_cap"]);
    const content = frFile("STE-944", [
      ["Summary", [DIRTY_LINE, ...bodyOfWords(SUMMARY_WORD_CAP + 40, "s")]],
      ["Technical Design", bodyOfWords(TECHNICAL_DESIGN_WORD_CAP + 5, "d")],
      ["Notes", bodyOfWords(NOTES_WORD_CAP + 5, "n")],
    ]);
    const fx = makeTree({ "specs/frs/STE-944.md": content });
    try {
      const violations = scan(fx.root);
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) {
        expect(closed.has(v.rule)).toBe(true);
        expect(typeof v.section).toBe("string");
        expect(v.section.length).toBeGreaterThan(0);
      }
      // `word_cap` is a real member of the declared union in the shipped source.
      expect(readFileSync(SCANNER_SRC, "utf-8")).toContain('"word_cap"');
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-534.2

describe("AC-STE-534.2 — 80 / 120 / 60 as exported named constants, body only", () => {
  test("the three caps are EXPORTED named constants carrying 80 / 120 / 60", () => {
    // Exported because STE-536 reads them to state the same numbers at the
    // authoring surfaces — a second typed copy there is the drift this forbids.
    expect(SUMMARY_WORD_CAP).toBe(80);
    expect(TECHNICAL_DESIGN_WORD_CAP).toBe(120);
    expect(NOTES_WORD_CAP).toBe(60);
  });

  test("each number is a named constant, not a literal repeated at each comparison", () => {
    // Comments stripped, each cap literal must appear EXACTLY ONCE in code —
    // at its declaration. A second occurrence is a re-typed comparison.
    const source = readFileSync(SCANNER_SRC, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    for (const literal of ["80", "120", "60"]) {
      const occurrences = source.match(new RegExp(`\\b${literal}\\b`, "g")) ?? [];
      expect(`${literal}:${occurrences.length}`).toBe(`${literal}:1`);
    }
    // ...and the identifiers are USED, not merely declared (declaration + >= 1
    // reference from the section table).
    for (const name of [
      "SUMMARY_WORD_CAP",
      "TECHNICAL_DESIGN_WORD_CAP",
      "NOTES_WORD_CAP",
    ]) {
      const uses = source.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
      expect(uses.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("the cap is measured over the section BODY only — the heading is excluded", () => {
    // `## Summary` is two whitespace-delimited tokens. A body of EXACTLY the
    // cap passes; if the heading were counted the total would be 82 and fail.
    const body = bodyOfWords(SUMMARY_WORD_CAP, "sum");
    expect(countWords(body.join("\n"))).toBe(80);
    const atCap = frFile("STE-945", [["Summary", body]]);
    const fxA = makeTree({ "specs/frs/STE-945.md": atCap });
    try {
      expect(byRule(scan(fxA.root), "word_cap")).toHaveLength(0);
    } finally {
      fxA.cleanup();
    }

    // One word past the cap fails — the boundary is real, not decorative.
    const overBody = bodyOfWords(SUMMARY_WORD_CAP + 1, "sum");
    expect(countWords(overBody.join("\n"))).toBe(81);
    const overCap = frFile("STE-946", [["Summary", overBody]]);
    const fxB = makeTree({ "specs/frs/STE-946.md": overCap });
    try {
      const hits = byRule(scan(fxB.root), "word_cap");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.section).toBe("Summary");
      expect(hits[0]!.line).toBe(lineOf(overCap, "sum05"));
    } finally {
      fxB.cleanup();
    }
  });

  test("the Technical Design and Notes boundaries are the 120 / 60 they claim", () => {
    const at = frFile("STE-947", [
      ["Technical Design", bodyOfWords(TECHNICAL_DESIGN_WORD_CAP, "d")],
      ["Notes", bodyOfWords(NOTES_WORD_CAP, "n")],
    ]);
    const over = frFile("STE-948", [
      ["Technical Design", bodyOfWords(TECHNICAL_DESIGN_WORD_CAP + 1, "d")],
      ["Notes", bodyOfWords(NOTES_WORD_CAP + 1, "n")],
    ]);
    const fx = makeTree({
      "specs/frs/STE-947.md": at,
      "specs/frs/STE-948.md": over,
    });
    try {
      const violations = scan(fx.root);
      expect(violations.filter((v) => v.file === "specs/frs/STE-947.md")).toEqual([]);
      const overHits = violations.filter((v) => v.file === "specs/frs/STE-948.md");
      expect(overHits.map((v) => `${v.rule}|${v.section}`).sort()).toEqual([
        "word_cap|Notes",
        "word_cap|Technical Design",
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test("the shipped section table binds each cap to its section", () => {
    const table = SECTION_RULES as unknown as RuleSpec[];
    const capOf = (section: string) =>
      table.find((s) => s.section === section)?.wordCap ?? null;
    expect(capOf("Summary")).toBe(SUMMARY_WORD_CAP);
    expect(capOf("Technical Design")).toBe(TECHNICAL_DESIGN_WORD_CAP);
    expect(capOf("Notes")).toBe(NOTES_WORD_CAP);
  });
});

// ================================================================ AC-STE-534.3

describe("AC-STE-534.3 — the four existing rules stay scoped to Summary ALONE", () => {
  test("Technical Design full of backticks, an AC-ID and a path yields NO backtick/ac_id/path_token violation — WHILE STILL being measured for words", () => {
    // The "while still measured" half is what makes this test discriminating.
    // A scanner that simply never entered Technical Design would satisfy the
    // silence and be the WRONG SUBJECT; the same fixture therefore breaches the
    // 120-word cap, so the section must have been walked and counted.
    const design = dirtyBodyOfWords(TECHNICAL_DESIGN_WORD_CAP + 1, "d");
    expect(countWords(design.join("\n"))).toBe(121);
    const content = frFile("STE-950", [
      ["Summary", ["A short compliant summary line with nothing to flag."]],
      ["Technical Design", design],
    ]);
    const fx = makeTree({ "specs/frs/STE-950.md": content });
    try {
      const violations = scan(fx.root);
      const design_hits = bySection(violations, "Technical Design");

      // Silence on the three prose rules...
      expect(byRule(design_hits, "backtick")).toEqual([]);
      expect(byRule(design_hits, "ac_id")).toEqual([]);
      expect(byRule(design_hits, "path_token")).toEqual([]);
      // ...and line_cap too — 7 body lines here, well past the 6-line Summary cap.
      expect(byRule(design_hits, "line_cap")).toEqual([]);

      // ...but NOT silence overall: the section WAS measured for words.
      expect(design_hits).toHaveLength(1);
      expect(design_hits[0]).toEqual({
        file: "specs/frs/STE-950.md",
        line: lineOf(content, "d06"), // 7 + 20*5 = 107, crossing 120 on d06 (121)
        rule: "word_cap",
        section: "Technical Design",
      });
      expect(violations).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });

  test("SIBLING HALF — the identical content under `## Summary` DOES fire all three prose rules", () => {
    // Isolation is half the test: a clause must also FAIL on its sibling.
    // Without this, the silence above would also be produced by a scanner that
    // had dropped the backtick/ac_id/path_token rules entirely.
    const content = frFile("STE-951", [["Summary", [DIRTY_LINE]]]);
    const fx = makeTree({ "specs/frs/STE-951.md": content });
    try {
      const violations = scan(fx.root);
      const line = lineOf(content, "renderStageEvidence");
      expect(violations.map((v) => v.rule).sort()).toEqual([
        "ac_id",
        "backtick",
        "path_token",
      ]);
      for (const v of violations) {
        expect(v).toMatchObject({ file: "specs/frs/STE-951.md", line, section: "Summary" });
      }
    } finally {
      fx.cleanup();
    }
  });

  test("Notes is the same asymmetry — prose rules silent, words still measured", () => {
    const notes = dirtyBodyOfWords(NOTES_WORD_CAP + 1, "n");
    expect(countWords(notes.join("\n"))).toBe(61);
    const content = frFile("STE-952", [
      ["Summary", ["A short compliant summary line with nothing to flag."]],
      ["Notes", notes],
    ]);
    const fx = makeTree({ "specs/frs/STE-952.md": content });
    try {
      const hits = bySection(scan(fx.root), "Notes");
      expect(hits.map((v) => v.rule)).toEqual(["word_cap"]);
    } finally {
      fx.cleanup();
    }
  });

  test("the shipped table carries the asymmetry as DATA — Summary owns all four prose rules, the other two own none", () => {
    const table = SECTION_RULES as unknown as RuleSpec[];
    const rulesOf = (section: string) =>
      [...(table.find((s) => s.section === section)?.rules ?? [])].sort();
    expect(rulesOf("Summary")).toEqual(["ac_id", "backtick", "line_cap", "path_token"]);
    expect(rulesOf("Technical Design")).toEqual([]);
    expect(rulesOf("Notes")).toEqual([]);
  });
});

// ================================================================ AC-STE-534.4

describe("AC-STE-534.4 — Requirement, Acceptance Criteria and Testing are uncapped", () => {
  test("a deliberately long Acceptance Criteria section produces ZERO violations", () => {
    // 700 words — well past every cap in the table — and carrying backticks,
    // AC-IDs and paths, which is what a real AC section always carries.
    const ac = dirtyBodyOfWords(700, "ac");
    expect(countWords(ac.join("\n"))).toBe(700);
    const req = dirtyBodyOfWords(300, "rq");
    const testing = dirtyBodyOfWords(300, "tg");
    const content = frFile("STE-953", [
      ["Summary", ["A short compliant summary line with nothing to flag."]],
      ["Requirement", req],
      ["Acceptance Criteria", ac],
      ["Testing", testing],
    ]);
    const fx = makeTree({ "specs/frs/STE-953.md": content });
    try {
      expect(scan(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("SIBLING HALF — the same 700-word body under `## Summary` is NOT silent", () => {
    // Proves the zero above is a scoping decision, not a scanner that returns
    // nothing for long bodies.
    const content = frFile("STE-954", [["Summary", dirtyBodyOfWords(700, "ac")]]);
    const fx = makeTree({ "specs/frs/STE-954.md": content });
    try {
      const violations = scan(fx.root);
      expect(byRule(violations, "word_cap")).toHaveLength(1);
      expect(byRule(violations, "word_cap")[0]!.section).toBe("Summary");
    } finally {
      fx.cleanup();
    }
  });

  test("the three uncapped sections are absent from the shipped table (or explicitly null)", () => {
    const table = SECTION_RULES as unknown as RuleSpec[];
    for (const section of ["Requirement", "Acceptance Criteria", "Testing"]) {
      const entry = table.find((s) => s.section === section);
      if (entry !== undefined) {
        expect(entry.wordCap).toBeNull();
        expect(entry.rules).toEqual([]);
      }
    }
    // ...and nothing else sneaked a cap in: exactly three capped sections.
    expect(
      table.filter((s) => s.wordCap !== null).map((s) => s.section).sort(),
    ).toEqual(["Notes", "Summary", "Technical Design"]);
  });

  test("uncapped sections are not MEASURED either — measurement follows the cap", () => {
    const content = frFile("STE-955", [
      ["Summary", ["A short compliant summary line with nothing to flag."]],
      ["Acceptance Criteria", bodyOfWords(700, "ac")],
    ]);
    const fx = makeTree({ "specs/frs/STE-955.md": content });
    try {
      expect(measure(fx.root).map((m) => m.section)).toEqual(["Summary"]);
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-534.5

describe("AC-STE-534.5 — probe id, severity and the README's probe count agree", () => {
  test("the README count line and the probe id are asserted TOGETHER", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("82 numbered `/gate-check` probes");
    expect(readme).not.toMatch(/\b81\b numbered `\/gate-check` probes/);
    expect(PROBE_ID).toBe("fr_summary_altitude");
  });

  test("the gate-check registration keeps probe #67's id and error severity", () => {
    const skill = readFileSync(
      join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    const entry = skill
      .split("\n")
      .find((l) => l.startsWith(`67. **\`${PROBE_ID}\`**`));
    expect(entry).toBeDefined();
    expect(entry!).toContain("**Severity: error.**");
    // MENTIONED, NEVER ORDERED. This pinned the CALL form
    // `scanFrSummaryAltitude(projectRoot)`, and a name in call form inside an
    // instruction reads as an order — which is how probe #67 came to route
    // past its own grandfathering arm (616 error rows against 0 on a 447-FR
    // corpus). The layering must stay visible; the raw scanner must not be
    // ordered. Routing itself is asserted in fr-word-cap-epoch-grandfathering
    // and by the class guard in m137-registration-routing.
    expect(entry!).toContain("scanFrSummaryAltitude");
    expect(entry!).not.toMatch(/call `scanFrSummaryAltitude\(/);
  });

  test("STE-534 minted no probe id of its own — the list ends where #82 left it", () => {
    // The whole reason the word rule joined an existing probe rather than
    // becoming one of its own was to spend no probe number of its own here.
    const skill = readFileSync(
      join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    const numbers = [...skill.matchAll(/^(\d+)\. \*\*`/gm)].map((m) => Number(m[1]));
    expect(Math.max(...numbers)).toBe(82);
  });

  test("word_cap violations are produced by the module that owns PROBE_ID", () => {
    // Same module, same id: `word_cap` rides probe #67 rather than a new probe.
    const content = frFile("STE-956", [["Summary", bodyOfWords(SUMMARY_WORD_CAP + 5, "s")]]);
    const fx = makeTree({ "specs/frs/STE-956.md": content });
    try {
      expect(byRule(scan(fx.root), "word_cap")).toHaveLength(1);
      expect(PROBE_ID).toBe("fr_summary_altitude");
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-534.6

describe("AC-STE-534.6 — an absent section yields no violation and no note", () => {
  test("vacuity is PER SECTION — a Summary with no Notes is measured for one, silent on the other", () => {
    const content = frFile("STE-957", [
      ["Summary", bodyOfWords(SUMMARY_WORD_CAP + 1, "s")],
      ["Requirement", ["Plain prose, uncapped."]],
    ]);
    const fx = makeTree({ "specs/frs/STE-957.md": content });
    try {
      const violations = scan(fx.root);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.section).toBe("Summary");
      expect(bySection(violations, "Notes")).toEqual([]);
      expect(bySection(violations, "Technical Design")).toEqual([]);
      // ...and no NOTE either: only the present section is measured.
      expect(measure(fx.root).map((m) => m.section)).toEqual(["Summary"]);
    } finally {
      fx.cleanup();
    }
  });

  test("an FR predating the rule — no capped section at all — stays byte-identically green", () => {
    const content = frFile("STE-958", [
      ["Requirement", dirtyBodyOfWords(400, "rq")],
      ["Acceptance Criteria", dirtyBodyOfWords(400, "ac")],
    ]);
    const fx = makeTree({ "specs/frs/STE-958.md": content });
    try {
      expect(scan(fx.root)).toEqual([]);
      expect(measure(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("an absent or empty specs/frs/ stays vacuous in BOTH the scan and the measurement", () => {
    const empty = makeTree({ "README.md": "no specs here\n" });
    try {
      expect(scan(empty.root)).toEqual([]);
      expect(measure(empty.root)).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });

  test("an EMPTY capped section is measured at zero words and never violates", () => {
    const content = frFile("STE-959", [
      ["Summary", []],
      ["Notes", []],
    ]);
    const fx = makeTree({ "specs/frs/STE-959.md": content });
    try {
      expect(scan(fx.root)).toEqual([]);
      const measured = measure(fx.root);
      expect(measured.map((m) => `${m.section}=${m.words}`).sort()).toEqual([
        "Notes=0",
        "Summary=0",
      ]);
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-534.7
//
// THE ARCHIVAL BLIND SPOT. The dogfood below measures this repository's own
// FRs — and M137's five FRs ARE the active tree it measures. Archiving them
// empties `specs/frs/`, and a dogfood written against the active tree alone
// goes RED at the archive commit: the one transition no gate run precedes.
// This repo has been bitten by that three times (STE-459 is the durable
// account).
//
// The union is taken HERE, in the test, and never in the scanner: probe #67's
// `archive/` exclusion is shipped behaviour that sibling suites pin, so the
// scanner must keep refusing to walk `specs/frs/archive/`. Instead the test
// resolves its own SUBJECT first — the active tree if it holds FRs, otherwise
// M137's FRs STAGED out of the archive into a temp root's `specs/frs/` — and
// then hands the scanner an ordinary active tree either way.
//
// Which path ran is asserted explicitly (`source`), because a run that
// silently found nothing on both paths must fail loudly rather than read as a
// clean pass. The `"none"` sentinel exists for exactly that, and is pinned
// below alongside a fallback path proven to actually measure.

/** Which tree supplied the dogfood's FR files. `"none"` is always a failure. */
type DogfoodSource = "active" | "archive" | "none";

interface Dogfood {
  /** Root to hand the scanner — always a tree whose FRs live in `specs/frs/`. */
  root: string;
  source: DogfoodSource;
  /** Basenames of the FR files the subject supplied. */
  files: string[];
  cleanup: () => void;
}

/** This milestone's own FRs, wherever they live, identified by frontmatter. */
const DOGFOOD_MILESTONE = "M137";

/**
 * Resolve the dogfood subject and return a root the scanner can walk.
 *
 * Active first — that is the live case, and it must stay the case that a new
 * milestone's FRs are what gets measured. Only when `specs/frs/` holds no FRs
 * at all does the fallback stage this milestone's ARCHIVED FRs into a temp
 * root's `specs/frs/`. The fallback is milestone-scoped on purpose: the whole
 * archive is 400-plus FRs written long before word caps existed, and staging
 * it wholesale would assert the caps over prose that never had to meet them.
 */
function dogfoodTree(repoRoot: string = REPO_ROOT): Dogfood {
  const noop = (): void => {};

  // BOTH paths go through the shared milestone-scoped resolver. Hand-rolling
  // the walk here is how the ACTIVE half shipped unfiltered while the ARCHIVE
  // half was scoped: `milestoneSpecFiles` filters the two identically and says
  // which one answered, so the two halves cannot drift apart again.
  const resolved = milestoneSpecFiles(repoRoot, "specs/frs", DOGFOOD_MILESTONE);
  if (resolved.source === "none") {
    return { root: repoRoot, source: "none", files: [], cleanup: noop };
  }
  const names = resolved.files.map((f) => basename(f));

  // The reported list and the GRADED SUBJECT must agree. The scanner walks a
  // DIRECTORY, not this list, so returning `repoRoot` while reporting a
  // filtered list would leave the filtered-out FRs being measured under names
  // that looked correct. The unstaged root is therefore only handed back when
  // the filter removed nothing at all.
  const activeAll = mdFilesIn(join(repoRoot, "specs", "frs"));
  if (resolved.source === "active" && activeAll.length === resolved.files.length) {
    return { root: repoRoot, source: "active", files: names, cleanup: noop };
  }

  const staged = mkdtempSync(join(tmpdir(), "fr-word-caps-dogfood-"));
  mkdirSync(join(staged, "specs", "frs"), { recursive: true });
  for (const abs of resolved.files) {
    writeFileSync(
      join(staged, "specs", "frs", basename(abs)),
      readFileSync(abs, "utf-8"),
    );
  }
  return {
    root: staged,
    source: resolved.source,
    files: names,
    cleanup: () => rmSync(staged, { recursive: true, force: true }),
  };
}

describe("AC-STE-534.7 — dogfood over this repository's OWN FRs, non-vacuously", () => {
  test("the scan actually MEASURED sections of all three capped kinds in specs/frs/", () => {
    // The trap this closes: this milestone's FRs all PASS the caps, so an
    // "assert zero violations" dogfood is vacuous BY CONSTRUCTION — it is
    // byte-identical to a scanner that walked nothing. Assert the MEASURED
    // COUNT instead.
    const dog = dogfoodTree();
    try {
      // WHICH path supplied the files, stated outright. `"none"` means both
      // trees came up empty: a silently-empty run must never read as a pass.
      expect(dog.source).not.toBe("none");
      expect(["active", "archive"]).toContain(dog.source);
      expect([dog.source, dog.files.length >= 3]).toEqual([dog.source, true]);

      const measured = measure(dog.root);
      // Non-vacuity on whichever path ran — the source rides in the assertion
      // so the failure message names the tree that came up empty.
      expect([dog.source, measured.length > 0]).toEqual([dog.source, true]);

      const kinds = new Set(measured.map((m) => m.section));
      expect(kinds.has("Summary")).toBe(true);
      expect(kinds.has("Technical Design")).toBe(true);
      expect(kinds.has("Notes")).toBe(true);

      // Real prose, not stubs: every measured section carries words, and the
      // largest is substantive. (STE-533's Technical Design measured 116 of
      // 120 at the introducing commit — four words of headroom.)
      for (const m of measured) {
        expect(`${m.file}|${m.section}`).toBeTruthy();
        expect(m.words).toBeGreaterThan(0);
        expect(m.file.startsWith("specs/frs/")).toBe(true);
      }
      expect(Math.max(...measured.map((m) => m.words))).toBeGreaterThanOrEqual(40);

      // More than one FR participated — a single-file dogfood proves little.
      expect(new Set(measured.map((m) => m.file)).size).toBeGreaterThanOrEqual(3);
    } finally {
      dog.cleanup();
    }
  });

  test("with the sections measured, this repository's own FRs pass the caps", () => {
    const dog = dogfoodTree();
    try {
      expect(dog.source).not.toBe("none");
      expect([dog.source, measure(dog.root).length > 0]).toEqual([dog.source, true]);
      expect(byRule(scan(dog.root), "word_cap")).toEqual([]);
    } finally {
      dog.cleanup();
    }
  });

  test("every measured section is under its own cap, and the maxima are the ones claimed", () => {
    const dog = dogfoodTree();
    try {
      expect(dog.source).not.toBe("none");
      const measured = measure(dog.root);
      expect([dog.source, measured.length > 0]).toEqual([dog.source, true]);
      const capOf: Record<string, number> = {
        Summary: SUMMARY_WORD_CAP,
        "Technical Design": TECHNICAL_DESIGN_WORD_CAP,
        Notes: NOTES_WORD_CAP,
      };
      const over = measured.filter((m) => m.words > capOf[m.section]!);
      // Named in the failure message, so an over-cap FR says WHICH file and by
      // how much rather than "expected 0 to be 1".
      expect(over.map((m) => `${m.file}|${m.section}|${m.words}`)).toEqual([]);
      // Every measured kind is one of the three capped ones — nothing unmapped
      // sneaks into the measurement.
      expect(measured.every((m) => m.section in capOf)).toBe(true);
    } finally {
      dog.cleanup();
    }
  });

  // ---- both paths exercised, on synthetic trees ---------------------------
  // Today the active path is the one that runs. These three prove the OTHER
  // branches are live code rather than dead prose — including that the
  // fallback really measures, so archival cannot turn this dogfood vacuous.

  /** An FR bound to this milestone, with all three capped sections populated. */
  const dogfoodFixture = (id: string): string =>
    frFile(id, [
      ["Summary", bodyOfWords(SUMMARY_WORD_CAP - 10, "s")],
      ["Technical Design", bodyOfWords(TECHNICAL_DESIGN_WORD_CAP - 10, "t")],
      ["Notes", bodyOfWords(NOTES_WORD_CAP - 10, "n")],
    ]);

  test("FALLBACK — with specs/frs/ empty, the archived FRs are staged and MEASURED", () => {
    const fx = makeTree({
      "specs/frs/archive/STE-970.md": dogfoodFixture("STE-970"),
      "specs/frs/archive/STE-971.md": dogfoodFixture("STE-971"),
      "specs/frs/archive/STE-972.md": dogfoodFixture("STE-972"),
      // A pre-word-cap archived FR from another milestone: the fallback is
      // milestone-scoped, so this must NOT be staged even though it sits in
      // the same directory. Its 200-word Summary would red the cap assertion.
      "specs/frs/archive/STE-100.md": frFile("STE-100", [
        ["Summary", bodyOfWords(SUMMARY_WORD_CAP + 120, "o")],
      ]).replace("milestone: M137", "milestone: M99"),
    });
    try {
      // The scanner ITSELF still refuses `archive/` — the union is the test's,
      // not the scanner's. Probe #67's exclusion is unchanged.
      expect(scan(fx.root)).toEqual([]);
      expect(measure(fx.root)).toEqual([]);

      const dog = dogfoodTree(fx.root);
      try {
        expect(dog.source).toBe("archive");
        expect(dog.root).not.toBe(fx.root);
        expect(dog.files).toEqual(["STE-970.md", "STE-971.md", "STE-972.md"]);

        // The fallback ACTUALLY measures — the whole point of the branch.
        const measured = measure(dog.root);
        expect(measured.length).toBeGreaterThan(0);
        expect(new Set(measured.map((m) => m.section))).toEqual(
          new Set(["Summary", "Technical Design", "Notes"]),
        );
        expect(new Set(measured.map((m) => m.file)).size).toBe(3);
        // The other milestone's over-cap FR was excluded, so the staged tree
        // is clean — and that is a measurement, not an empty walk.
        expect(byRule(scan(dog.root), "word_cap")).toEqual([]);
        expect(measured.some((m) => m.file.includes("STE-100"))).toBe(false);
      } finally {
        dog.cleanup();
      }
    } finally {
      fx.cleanup();
    }
  });

  test("ACTIVE — with specs/frs/ populated, the archive is not consulted at all", () => {
    const fx = makeTree({
      "specs/frs/STE-973.md": dogfoodFixture("STE-973"),
      "specs/frs/archive/STE-974.md": dogfoodFixture("STE-974"),
    });
    try {
      const dog = dogfoodTree(fx.root);
      try {
        expect(dog.source).toBe("active");
        expect(dog.root).toBe(fx.root);
        expect(dog.files).toEqual(["STE-973.md"]);
        expect(measure(dog.root).length).toBeGreaterThan(0);
      } finally {
        dog.cleanup();
      }
    } finally {
      fx.cleanup();
    }
  });

  test("NEITHER — an empty active tree and an empty archive report `none`, never a silent pass", () => {
    const fx = makeTree({ "README.md": "no specs here\n" });
    try {
      const dog = dogfoodTree(fx.root);
      dog.cleanup();
      expect(dog.source).toBe("none");
      expect(dog.files).toEqual([]);
      // …and the guard the three dogfood tests above use does reject it.
      expect(() => expect(dog.source).not.toBe("none")).toThrow();
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-534.8

describe("AC-STE-534.8 — mutation-verified, each mutation asserted to have APPLIED", () => {
  const shipped = () =>
    (SECTION_RULES as unknown as RuleSpec[]).map((s) => ({
      section: s.section,
      wordCap: s.wordCap,
      rules: [...s.rules],
    }));

  test("MUTATION 1 — raising the Summary cap past the measured maximum turns AC-STE-534.2's assertion red", () => {
    const clean = shipped();
    const mutated = clean.map((s) =>
      s.section === "Summary" ? { ...s, wordCap: 800 } : s,
    );

    // The mutation APPLIED: the table handed in differs from the shipped one,
    // in exactly the named field. (A mutation that never applied reads as a pass.)
    expect(JSON.stringify(mutated)).not.toBe(JSON.stringify(clean));
    expect(mutated.find((s) => s.section === "Summary")!.wordCap).toBe(800);
    expect(clean.find((s) => s.section === "Summary")!.wordCap).toBe(SUMMARY_WORD_CAP);

    const content = frFile("STE-960", [["Summary", bodyOfWords(SUMMARY_WORD_CAP + 1, "s")]]);
    const fx = makeTree({ "specs/frs/STE-960.md": content });
    try {
      // Clean table: the 81-word fixture violates — the assertion under test.
      expect(byRule(scan(fx.root, clean), "word_cap")).toHaveLength(1);
      // Mutated table: it does not. AC-STE-534.2's assertion CAN fail.
      expect(byRule(scan(fx.root, mutated), "word_cap")).toHaveLength(0);
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION 2 — widening the backtick rule to Technical Design turns AC-STE-534.3's assertion red", () => {
    const clean = shipped();
    const mutated = clean.map((s) =>
      s.section === "Technical Design" ? { ...s, rules: [...s.rules, "backtick"] } : s,
    );

    expect(JSON.stringify(mutated)).not.toBe(JSON.stringify(clean));
    expect(clean.find((s) => s.section === "Technical Design")!.rules).not.toContain(
      "backtick",
    );
    expect(mutated.find((s) => s.section === "Technical Design")!.rules).toContain(
      "backtick",
    );

    const content = frFile("STE-961", [
      ["Summary", ["A short compliant summary line with nothing to flag."]],
      ["Technical Design", dirtyBodyOfWords(TECHNICAL_DESIGN_WORD_CAP + 1, "d")],
    ]);
    const fx = makeTree({ "specs/frs/STE-961.md": content });
    try {
      // Clean: silence on backtick over Technical Design.
      expect(byRule(bySection(scan(fx.root, clean), "Technical Design"), "backtick")).toEqual(
        [],
      );
      // Mutated: it fires — so the silence above is a measurement, not a stub.
      const widened = byRule(
        bySection(scan(fx.root, mutated), "Technical Design"),
        "backtick",
      );
      expect(widened).toHaveLength(1);
      expect(widened[0]!.line).toBe(lineOf(content, "renderStageEvidence"));
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION 3 — capping Acceptance Criteria turns AC-STE-534.4's assertion red", () => {
    const clean = shipped();
    const mutated: RuleSpec[] = [
      ...clean,
      { section: "Acceptance Criteria", wordCap: 10, rules: [] },
    ];

    expect(JSON.stringify(mutated)).not.toBe(JSON.stringify(clean));
    expect(clean.some((s) => s.section === "Acceptance Criteria")).toBe(false);
    expect(mutated.find((s) => s.section === "Acceptance Criteria")!.wordCap).toBe(10);

    const content = frFile("STE-962", [
      ["Summary", ["A short compliant summary line with nothing to flag."]],
      ["Acceptance Criteria", bodyOfWords(700, "ac")],
    ]);
    const fx = makeTree({ "specs/frs/STE-962.md": content });
    try {
      // Clean: uncapped, zero violations — the assertion under test.
      expect(scan(fx.root, clean)).toEqual([]);
      // Mutated: the long AC section now violates. The zero above is a decision.
      const capped = bySection(scan(fx.root, mutated), "Acceptance Criteria");
      expect(capped).toHaveLength(1);
      expect(capped[0]!.rule).toBe("word_cap");
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-534.5
// Registration-prose parity — the SHIPPED surface must describe the SHIPPED
// scanner.
//
// AC-STE-534.5 pinned three things on `skills/gate-check/SKILL.md`: the probe
// id, its `**Severity: error.**`, and README's numbered-probe count. All three
// are still correct. What nothing pinned is the two things STE-534 actually
// changed on that surface — the RULE SET and the SECTION SCOPE — which is
// exactly why the entry still says the probe "enforces four altitude rules"
// over "each file's `## Summary` section" while the scanner ships five rules
// over three sections.
//
// Every assertion below is driven off the SHIPPED source (the `RuleName` union
// parsed out of scan_fr_summary_altitude.ts, and `SECTION_RULES` imported from
// it) rather than off a hand-typed "five" or "80" — a hand-typed number drifts
// again the next time a rule or a section is added. The point is not that the
// prose says a particular sentence; it is that the prose and the scanner
// CANNOT DISAGREE.

/** English number words, index = value, for reading a prose count claim. */
const COUNT_WORDS = [
  "zero", "one", "two", "three", "four", "five",
  "six", "seven", "eight", "nine", "ten",
];

/**
 * The closed rule union, read from the SHIPPED source's exported `RuleName`
 * type rather than restated here.
 */
function shippedRuleUnion(): string[] {
  const src = readFileSync(SCANNER_SRC, "utf-8");
  const decl = /export type RuleName\s*=\s*([^;]+);/.exec(src);
  expect(decl).not.toBeNull();
  const members = [...decl![1]!.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]!);
  // Guard against a vacuous parse: the union must at minimum cover every rule
  // the shipped section table actually binds to a section.
  const bound = [...new Set(SECTION_RULES.flatMap((s) => [...s.rules]))];
  expect(bound.length).toBeGreaterThan(0);
  expect(members).toEqual(expect.arrayContaining(bound));
  return members;
}

/** The `67. **`fr_summary_altitude`** — …` registration line, verbatim. */
function probe67Entry(): string {
  const skill = readFileSync(
    join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md"),
    "utf-8",
  );
  const entry = skill
    .split("\n")
    .find((l) => l.startsWith(`67. **\`${PROBE_ID}\`**`));
  expect(entry).toBeDefined();
  return entry!;
}

/** Rule ids of the union that the prose does NOT name in backticks. */
function ruleNamesMissingFrom(prose: string, union: readonly string[]): string[] {
  return union.filter((rule) => !prose.includes(`\`${rule}\``));
}

// `ruleNamesMissingFrom` searches the WHOLE line, so it only catches TOTAL
// omission. It cannot catch PARTIAL omission: the entry names every rule id
// several times over (`word_cap` alone appears in the union list, in the
// crossing-line sentence and in the cap paragraph), so deleting a member from
// the closed-union ENUMERATION leaves the id present elsewhere and the check
// reports clean. The auditor measured exactly that: rewriting
// "…`path_token` and `word_cap`" to "…`path_token`" leaves the line
// self-contradictory — "five altitude rules" beside a four-member list — with
// every test still green. The enumeration itself must therefore be read as a
// LIST, not as a bag of substrings.

/**
 * The rule ids of the enumeration that follows the prose's "closed union"
 * anchor, in order, stopping at the first token that is not another
 * backticked id joined by a list separator.
 *
 * Reading the list positionally is the whole point: a member dropped from the
 * enumeration ends the walk early even though the id still occurs later in
 * the paragraph.
 */
function closedUnionEnumeration(prose: string): string[] {
  const anchor = /closed union\s+(?=`)/i.exec(prose);
  if (anchor === null) return [];
  let rest = prose.slice(anchor.index + anchor[0].length);
  const ITEM = /^`([A-Za-z0-9_]+)`/;
  // Oxford-comma form first: a bare `,\s*` would swallow ", and " and then
  // fail to match `and` as an item, silently truncating a well-formed list.
  const SEPARATOR = /^(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+)/;
  const ids: string[] = [];
  for (;;) {
    const item = ITEM.exec(rest);
    if (item === null) break;
    ids.push(item[1]!);
    rest = rest.slice(item[0]!.length);
    const separator = SEPARATOR.exec(rest);
    if (separator === null) break;
    rest = rest.slice(separator[0]!.length);
  }
  return ids;
}

interface EnumerationGaps {
  /** The ids the enumeration actually lists, in prose order. */
  listed: string[];
  /** Union members the enumeration omits. */
  missing: string[];
  /** Listed ids that are not union members at all. */
  extra: string[];
}

/** How the prose's closed-union enumeration differs from the shipped union. */
function unionEnumerationGaps(
  prose: string,
  union: readonly string[],
): EnumerationGaps {
  const listed = closedUnionEnumeration(prose);
  return {
    listed,
    missing: union.filter((rule) => !listed.includes(rule)),
    extra: listed.filter((rule) => !union.includes(rule)),
  };
}

/** Every "<count> … rules" claim in the prose, as numbers. */
function ruleCountClaims(prose: string): number[] {
  const re = new RegExp(
    `\\b(${COUNT_WORDS.join("|")}|\\d+)\\s+(?:\\w+\\s+)?rules\\b`,
    "gi",
  );
  return [...prose.matchAll(re)].map((m) => {
    const token = m[1]!.toLowerCase();
    const word = COUNT_WORDS.indexOf(token);
    return word >= 0 ? word : Number(token);
  });
}

/**
 * Of the shipped cap numbers, the one mentioned CLOSEST to `section` in the
 * prose. Pairing, not mere presence: a surface that lists all three sections
 * and all three numbers but attaches them to the wrong ones is still wrong.
 */
function capNearest(prose: string, section: string, caps: readonly number[]): number | null {
  // Spans, not start offsets: distance is measured to the NEAREST EDGE of the
  // section name, so "Technical Design 120" is not beaten by a number that
  // happens to sit just before the name.
  const sectionAt = [...prose.matchAll(new RegExp(`\\b${section}\\b`, "g"))].map(
    (m) => [m.index!, m.index! + m[0]!.length] as const,
  );
  if (sectionAt.length === 0) return null;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cap of caps) {
    for (const hit of prose.matchAll(new RegExp(`\\b${cap}\\b`, "g"))) {
      for (const [from, to] of sectionAt) {
        const distance = Math.min(
          Math.abs(hit.index! - to),
          Math.abs(hit.index! + hit[0]!.length - from),
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = cap;
        }
      }
    }
  }
  return best;
}

describe("AC-STE-534.5 — probe #67's registration prose matches the shipped scanner", () => {
  test("the entry names EVERY member of the scanner's closed rule union", () => {
    const union = shippedRuleUnion();
    // Measured: rule ids present in the source's RuleName union but absent
    // from the shipped registration prose.
    expect(ruleNamesMissingFrom(probe67Entry(), union)).toEqual([]);
  });

  test("the entry's closed-union ENUMERATION lists the whole union, not a subset", () => {
    const union = shippedRuleUnion();
    const gaps = unionEnumerationGaps(probe67Entry(), union);
    // Non-vacuity first: an entry with no parseable enumeration would report
    // `listed: []` and could otherwise slip past as "nothing missing".
    expect(gaps.listed.length).toBe(union.length);
    expect(gaps.missing).toEqual([]);
    expect(gaps.extra).toEqual([]);
    // The enumeration and the count claim must agree with each other, not
    // merely each with the union — the self-contradiction the auditor found
    // ("five altitude rules" beside a four-member list) is exactly this pair
    // disagreeing.
    for (const claim of ruleCountClaims(probe67Entry())) {
      expect(claim).toBe(gaps.listed.length);
    }
  });

  test("every rule-COUNT claim in the entry equals the union's size", () => {
    const union = shippedRuleUnion();
    const claims = ruleCountClaims(probe67Entry());
    // Non-vacuity: the entry must actually state a count, or this assertion
    // would pass by saying nothing.
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim).toBe(union.length);
  });

  test("the entry names every SECTION the shipped table measures", () => {
    const measuredSections = SECTION_RULES.filter((s) => s.wordCap !== null).map(
      (s) => s.section,
    );
    expect(measuredSections.length).toBeGreaterThan(1);
    const entry = probe67Entry();
    // Measured: table sections the prose never mentions. The pre-STE-534
    // prose describes the subject as `## Summary` alone.
    expect(measuredSections.filter((s) => !entry.includes(s))).toEqual([]);
  });

  test("the entry states each section's cap, and states it NEXT TO that section", () => {
    const capped = SECTION_RULES.filter((s) => s.wordCap !== null);
    const caps = capped.map((s) => s.wordCap!);
    expect(new Set(caps).size).toBe(caps.length); // pairing is only meaningful if distinct
    const entry = probe67Entry();

    // Presence, then pairing — reported separately so a failure says which.
    expect(caps.filter((c) => !new RegExp(`\\b${c}\\b`).test(entry))).toEqual([]);
    for (const spec of capped) {
      expect([spec.section, capNearest(entry, spec.section, caps)]).toEqual([
        spec.section,
        spec.wordCap,
      ]);
    }
  });

  test("the four prose rules are still named, and still described as Summary-scoped", () => {
    const entry = probe67Entry();
    const summary = SECTION_RULES.find((s) => s.section === "Summary");
    expect(summary).toBeDefined();
    // Widening these three to Technical Design / Notes would red nearly every
    // FR in the repo (AC-STE-534.3); the prose must keep saying so.
    for (const rule of summary!.rules) expect(entry).toContain(`\`${rule}\``);
    expect(summary!.rules).toEqual(
      expect.arrayContaining(["line_cap", "backtick", "ac_id", "path_token"]),
    );
  });

  test("AC-STE-534.5's original three pins are UNMOVED by the prose repair", () => {
    // The rule joined an existing probe precisely so these would not move.
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("82 numbered `/gate-check` probes");
    expect(readme).not.toMatch(/\b81\b numbered `\/gate-check` probes/);

    const entry = probe67Entry();
    expect(PROBE_ID).toBe("fr_summary_altitude");
    expect(entry).toContain("**Severity: error.**");
    // MENTIONED, NEVER ORDERED. This pinned the CALL form
    // `scanFrSummaryAltitude(projectRoot)`, and a name in call form inside an
    // instruction reads as an order — which is how probe #67 came to route
    // past its own grandfathering arm (616 error rows against 0 on a 447-FR
    // corpus). The layering must stay visible; the raw scanner must not be
    // ordered. Routing itself is asserted in fr-word-cap-epoch-grandfathering
    // and by the class guard in m137-registration-routing.
    expect(entry).toContain("scanFrSummaryAltitude");
    expect(entry).not.toMatch(/call `scanFrSummaryAltitude\(/);

    const skill = readFileSync(
      join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md"),
      "utf-8",
    );
    const numbers = [...skill.matchAll(/^(\d+)\. \*\*`/gm)].map((m) => Number(m[1]));
    expect(Math.max(...numbers)).toBe(82);
  });

  // ---- falsifiability: the checks above must be able to FAIL ---------------
  // Each runs the SAME helper over synthetic prose, so a helper that can only
  // ever report "clean" is caught here rather than passing silently forever.

  test("FALSIFIABLE — the union check reports a rule the prose omits", () => {
    const union = shippedRuleUnion();
    const omits = `67. **\`${PROBE_ID}\`** — enforces \`${union[0]}\` only.`;
    expect(ruleNamesMissingFrom(omits, union)).toEqual(union.slice(1));
  });

  test("FALSIFIABLE — the enumeration check reddens on the auditor's PARTIAL-omission mutation", () => {
    const union = shippedRuleUnion();
    const entry = probe67Entry();
    const last = union[union.length - 1]!;
    const penultimate = union[union.length - 2]!;

    // The auditor's exact mutation, applied to the SHIPPED entry: drop the
    // final member from the closed-union list, changing nothing else.
    const mutated = entry.replace(
      `\`${penultimate}\` and \`${last}\``,
      `\`${penultimate}\``,
    );
    // The mutation APPLIED — a mutation that never applied reads as a pass.
    expect(mutated).not.toBe(entry);
    expect(mutated).not.toContain(`\`${penultimate}\` and \`${last}\``);

    // …and it is genuinely PARTIAL: the dropped id still occurs on the line,
    // which is why the whole-line check cannot see it.
    expect(mutated).toContain(`\`${last}\``);
    expect(ruleNamesMissingFrom(mutated, union)).toEqual([]);

    // The strengthened check does see it, and names the missing member.
    const gaps = unionEnumerationGaps(mutated, union);
    expect(gaps.listed).toEqual(union.slice(0, -1));
    expect(gaps.missing).toEqual([last]);

    // On the unmutated entry the same helper reports clean — so the RED above
    // is the mutation's doing, not a helper that always complains.
    expect(unionEnumerationGaps(entry, union).missing).toEqual([]);
  });

  test("FALSIFIABLE — the enumeration check reports a member dropped from the MIDDLE of the list", () => {
    const union = shippedRuleUnion();
    expect(union.length).toBeGreaterThan(2);
    const dropped = union[1]!;
    const listed = union.filter((r) => r !== dropped);
    // Same shape as the shipped prose: the dropped id still appears later in
    // the sentence, so only a positional read of the list can catch it.
    const prose =
      `enforcing rules — the closed union ${listed
        .slice(0, -1)
        .map((r) => `\`${r}\``)
        .join(", ")} and \`${listed.at(-1)!}\`. ` +
      `\`${dropped}\` is described separately below.`;
    expect(prose).toContain(`\`${dropped}\``);
    expect(ruleNamesMissingFrom(prose, union)).toEqual([]);
    expect(unionEnumerationGaps(prose, union)).toMatchObject({
      listed,
      missing: [dropped],
      extra: [],
    });
  });

  test("FALSIFIABLE — an entry with no parseable enumeration reports the whole union missing", () => {
    const union = shippedRuleUnion();
    const noList = `67. **\`${PROBE_ID}\`** — enforces ${union
      .map((r) => `\`${r}\``)
      .join(" and also ")} somewhere.`;
    // Every id is present, so the whole-line check is happy…
    expect(ruleNamesMissingFrom(noList, union)).toEqual([]);
    // …while the enumeration check refuses to call a missing list a pass.
    expect(unionEnumerationGaps(noList, union)).toMatchObject({
      listed: [],
      missing: [...union],
    });
  });

  test("FALSIFIABLE — the count check reads a wrong count as wrong", () => {
    const union = shippedRuleUnion();
    const understated = COUNT_WORDS[union.length - 1]!;
    expect(ruleCountClaims(`enforces ${understated} altitude rules over the body`)).toEqual([
      union.length - 1,
    ]);
    expect(ruleCountClaims(`enforces ${COUNT_WORDS[union.length]!} rules`)).toEqual([
      union.length,
    ]);
  });

  test("FALSIFIABLE — the pairing check catches caps attached to the wrong sections", () => {
    const capped = SECTION_RULES.filter((s) => s.wordCap !== null);
    const caps = capped.map((s) => s.wordCap!);
    expect(capped.length).toBeGreaterThan(1);
    // Same numbers, same section names, deliberately mis-paired.
    const swapped = capped
      .map((s, i) => `${s.section} ${caps[(i + 1) % caps.length]!} words`)
      .join("; ");
    const misPaired = capped.filter(
      (s) => capNearest(swapped, s.section, caps) !== s.wordCap,
    );
    expect(misPaired.map((s) => s.section)).toEqual(capped.map((s) => s.section));
    // …and reports a section it cannot find at all as null, not as a match.
    expect(capNearest(swapped, "Nonexistent Section", caps)).toBeNull();
  });
});

// ===========================================================================
// PR #76 ROUND C — F8: THE DOGFOOD'S ACTIVE PATH IS UNSCOPED
// ===========================================================================
//
// `dogfoodTree` scopes its ARCHIVE fallback to `DOGFOOD_MILESTONE` by
// frontmatter — the comment above it explains why at length: the archive holds
// 440-plus FRs written before these caps existed, and staging it wholesale
// swaps in a pre-rule subject. Every word of that reasoning applies to the
// ACTIVE path too, and the active path applies none of it: it takes
// `mdFilesIn(specs/frs)` unfiltered.
//
// While M137 is the only open milestone the two are indistinguishable, which is
// exactly why this shipped. The moment M138 opens an FR, this suite grades
// M137's acceptance criteria over M138's material — and AC-STE-534.7's
// non-vacuity legs would keep passing, because SOMETHING was measured.
//
// The sibling STE-535 dogfood filters both paths and is the shape to copy;
// `milestoneSpecFiles` in `tests/_spec_tree.ts` is that shape, shared.

/** An FR file bound to an arbitrary milestone — `frFile` hardcodes M137. */
function frFileForMilestone(
  id: string,
  milestone: string,
  sections: [string, string[]][],
): string {
  return frFile(id, sections).replace(/^milestone: M137$/m, `milestone: ${milestone}`);
}

describe("F8 — the dogfood subject is milestone-scoped on BOTH paths", () => {
  const SUMMARY = bodyOfWords(40, "own");

  test("the fixture builder really does bind the two files to different milestones", () => {
    // Mutation-applied check first: if both files came out as M137 the leg
    // below would pass on a scoping that never happened.
    const mine = frFileForMilestone("STE-990", DOGFOOD_MILESTONE, [["Summary", SUMMARY]]);
    const next = frFileForMilestone("STE-991", "M138", [["Summary", SUMMARY]]);
    expect(mine).toContain(`milestone: ${DOGFOOD_MILESTONE}`);
    expect(next).toContain("milestone: M138");
    expect(next).not.toContain(`milestone: ${DOGFOOD_MILESTONE}\n`);
  });

  test("an ACTIVE tree carrying a LATER milestone's FRs supplies only THIS milestone's", () => {
    const fx = makeTree({
      "specs/frs/STE-990.md": frFileForMilestone("STE-990", DOGFOOD_MILESTONE, [
        ["Summary", SUMMARY],
      ]),
      "specs/frs/STE-991.md": frFileForMilestone("STE-991", "M138", [["Summary", SUMMARY]]),
    });
    const dog = dogfoodTree(fx.root);
    try {
      expect(dog.source).toBe("active");
      expect(dog.files).toEqual(["STE-990.md"]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });

  test("the SCANNER sees only those files — a filtered list over an unfiltered root is not a fix", () => {
    // The list and the subject must agree. `dogfoodTree` hands the scanner a
    // ROOT, and the scanner walks the directory rather than the list, so
    // filtering `files` while returning `repoRoot` would leave M138's FRs being
    // graded while the reported names looked correct.
    const fx = makeTree({
      "specs/frs/STE-990.md": frFileForMilestone("STE-990", DOGFOOD_MILESTONE, [
        ["Summary", SUMMARY],
      ]),
      "specs/frs/STE-991.md": frFileForMilestone("STE-991", "M138", [["Summary", SUMMARY]]),
    });
    const dog = dogfoodTree(fx.root);
    try {
      const files = new Set(measure(dog.root).map((m) => m.file));
      expect([...files].sort()).toEqual(["specs/frs/STE-990.md"]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });

  test("an ACTIVE tree holding none of THIS milestone's FRs does not read as an active pass", () => {
    const fx = makeTree({
      "specs/frs/STE-992.md": frFileForMilestone("STE-992", "M138", [["Summary", SUMMARY]]),
    });
    const dog = dogfoodTree(fx.root);
    try {
      expect(dog.source).not.toBe("active");
      expect(dog.files).toEqual([]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });

  test("ISOLATION — an active tree of THIS milestone's FRs alone still resolves active", () => {
    // Without this leg a `dogfoodTree` that returned `"none"` unconditionally
    // would pass every assertion above.
    const fx = makeTree({
      "specs/frs/STE-993.md": frFileForMilestone("STE-993", DOGFOOD_MILESTONE, [
        ["Summary", SUMMARY],
      ]),
    });
    const dog = dogfoodTree(fx.root);
    try {
      expect(dog.source).toBe("active");
      expect(dog.files).toEqual(["STE-993.md"]);
    } finally {
      dog.cleanup();
      fx.cleanup();
    }
  });
});

// ============================================================================
// M137 ROUND 3 — THE BUDGET IS PER SECTION NAME PER FILE, NOT PER OCCURRENCE
// ============================================================================
//
// THE DEFECT, measured on the shipped scanner 2026-09-01, each line with its
// own control so a zero is evidence rather than a broken harness:
//
//   VECTOR   3 x `## Summary` of 70 words          (210 total, cap  80) -> []
//   CONTROL  1 x `## Summary` of 210 words                              -> ["word_cap", "line_cap"]
//   VECTOR   3 x `## Technical Design` of 100      (300 total, cap 120) -> []
//   VECTOR   2 x `## Notes` of 55                  (110 total, cap  60) -> []
//   VECTOR   2 x `## Summary` of 5 lines each      ( 10 total, cap   6) -> []
//   CONTROL  1 x `## Summary` of 10 lines                               -> ["line_cap"]
//
// `scanFile` resets its `words` and `nonEmpty` accumulators every time it
// ENTERS a section, so splitting an over-cap section into two identically-named
// sections evades the cap entirely. `line_cap` shipped in STE-386 (M105) and has
// been evadable for thirty-two milestones; the three word caps shipped in this
// milestone and were evadable on the day they landed.
//
// THE TAXONOMY, stated here so the next implementer does not rediscover it:
//
//   * A rule that carries STATE ACROSS LINES — a running word count, a running
//     non-empty line count — is graded against an ACCUMULATOR, and an
//     accumulator scoped to one occurrence of a heading is defeated by a second
//     occurrence. Those rules need the per-name property below.
//   * A PER-LINE PREDICATE — `backtick`, `ac_id`, `path_token` — carries no
//     state, so each offending line fires wherever it sits. MEASURED: one
//     Summary with three offending lines and three Summaries with one each
//     produce the identical multiset of violations. Those rules do NOT need it.
//
// That boundary is the useful half of this finding: it says which part of any
// section walker is at risk, without anyone having to enumerate vectors.
//
// THE ORDERING RULING (operator, 2026-09-01): THE PROPERTY GATES. It comes
// first and it is what decides correctness; the legs after it document known
// attacks and are not coverage. If the property is green while a vector test is
// red, THE VECTOR TEST IS WHAT IS WRONG.
//
// WHAT THIS SECTION DELIBERATELY DOES NOT PIN, said outright rather than left
// implicit: a duplicate `## Summary` / `## Technical Design` / `## Notes` is
// NOT made a violation in itself here. Two reasons, both measured. (1) Nothing
// in the FR template forbids a repeated heading, and 2 of this repository's 447
// archived FRs already carry one (`STE-74.md`, `STE-378.md`) — neither of them a
// capped section, but a rule that fires on repetition alone would be a new
// content rule retroactively applied to real prose, which is exactly what the
// `FR_WORD_CAP_EPOCH` grandfathering exists to avoid. (2) Accumulating per name
// closes the QUANTITY hole completely: 3 x 70 words is graded as 210. The
// contrast with `m137-ste-533-exempt-budget.test.ts`, which DOES refuse a
// duplicate outright, is deliberate: there the carve-out is a closed, cited
// list of sections whose renderers emit them exactly once, and absence is
// already a violation, so duplication must not be the loophole absence is not.

/** The capped sections, read off the SHIPPED table — never re-listed here. */
const CAPPED_SECTIONS: readonly { section: string; cap: number }[] = (
  SECTION_RULES as readonly RuleSpec[]
)
  .filter((s) => s.wordCap !== null)
  .map((s) => ({ section: s.section, cap: s.wordCap as number }));

/** The sections carrying the accumulating LINE rule, read off the same table. */
const LINE_CAP_SECTIONS: readonly string[] = (SECTION_RULES as readonly RuleSpec[])
  .filter((s) => s.rules.includes("line_cap"))
  .map((s) => s.section);

/**
 * The shipped line cap, MEASURED rather than typed: `LINE_CAP` is module-private,
 * and a hand-typed 6 here is a number free to drift from the one that grades.
 * Probed with single-word lines so the word cap cannot confound the answer.
 */
const measuredLineCap = (): number => {
  for (let n = 1; n <= 30; n++) {
    const content = frFile("STE-CAPPROBE", [
      ["Summary", Array.from({ length: n }, (_, i) => `probe${i + 1}`)],
    ]);
    const fx = makeTree({ "specs/frs/STE-CAPPROBE.md": content });
    try {
      if (byRule(scan(fx.root), "line_cap").length > 0) return n - 1;
    } finally {
      fx.cleanup();
    }
  }
  throw new Error("`line_cap` never fired on a Summary of up to 30 non-empty lines");
};

/** `total` words dealt into `n` bodies — remainder to the earliest bodies. */
function splitWords(total: number, n: number, prefix: string): string[][] {
  const base = Math.floor(total / n);
  const rem = total % n;
  return Array.from({ length: n }, (_, i) =>
    bodyOfWords(base + (i < rem ? 1 : 0), `${prefix}${i + 1}x`),
  );
}

/** `total` single-word lines dealt into `n` bodies. */
function splitLines(total: number, n: number, prefix: string): string[][] {
  const base = Math.floor(total / n);
  const rem = total % n;
  let seen = 0;
  return Array.from({ length: n }, (_, i) => {
    const take = base + (i < rem ? 1 : 0);
    const body = Array.from({ length: take }, (_, j) => `${prefix}${seen + j + 1}`);
    seen += take;
    return body;
  });
}

/** A section absent from the shipped table — graded by nothing, so a neutral spacer. */
const UNCAPPED_SECTION = "Acceptance Criteria";

interface FrComposition {
  name: string;
  /** The section name whose per-file total is the subject. */
  section: string;
  rule: "word_cap" | "line_cap";
  /** The per-name total across every occurrence — words, or non-empty lines. */
  total: number;
  cap: number;
  /** How many occurrences of the heading carry that total. */
  occurrences: number;
  content: string;
}

/**
 * The corpus: every arrangement of a repeated capped heading this scanner can
 * be handed, at several magnitudes and on both sides of every cap.
 *
 * Built from the SHIPPED table, so a section added to `SECTION_RULES` tomorrow
 * is attacked by every arrangement here the day it lands.
 */
function frCompositions(): FrComposition[] {
  const out: FrComposition[] = [];
  const splits = [1, 2, 3, 10];

  for (const { section, cap } of CAPPED_SECTIONS) {
    for (const total of [cap - 10, cap, cap + 1, cap * 3]) {
      for (const n of splits) {
        if (total < n) continue;
        const bodies = splitWords(total, n, `w${section.length}n${n}t${total}`);
        const id = `STE-P${section.length}${n}${total}`;

        out.push({
          name: `${section}: ${total} words over ${n} adjacent heading(s), cap ${cap}`,
          section,
          rule: "word_cap",
          total,
          cap,
          occurrences: n,
          content: frFile(id, bodies.map((b) => [section, b] as [string, string[]])),
        });

        if (n > 1) {
          // The same total, with an UNCAPPED section wedged between the
          // repetitions — a walker that only merges ADJACENT twins is defeated
          // by one intervening heading, and would pass the leg above.
          const spaced: [string, string[]][] = [];
          bodies.forEach((b, i) => {
            spaced.push([section, b]);
            if (i < bodies.length - 1) spaced.push([UNCAPPED_SECTION, ["- one criterion"]]);
          });
          out.push({
            name: `${section}: ${total} words over ${n} heading(s) split by \`## ${UNCAPPED_SECTION}\``,
            section,
            rule: "word_cap",
            total,
            cap,
            occurrences: n,
            content: frFile(`${id}S`, spaced),
          });

          // …and with ANOTHER CAPPED section between them, each of the two
          // subjects well under its own cap. A merge keyed on anything but the
          // heading NAME collapses the wrong pair here.
          const other = CAPPED_SECTIONS.find((c) => c.section !== section)!;
          const interleaved: [string, string[]][] = [];
          bodies.forEach((b, i) => {
            interleaved.push([section, b]);
            if (i < bodies.length - 1) {
              interleaved.push([other.section, bodyOfWords(5, `o${i}y`)]);
            }
          });
          out.push({
            name: `${section}: ${total} words over ${n} heading(s) interleaved with \`## ${other.section}\``,
            section,
            rule: "word_cap",
            total,
            cap,
            occurrences: n,
            content: frFile(`${id}I`, interleaved),
          });
        }
      }
    }
  }

  const lineCap = measuredLineCap();
  for (const section of LINE_CAP_SECTIONS) {
    for (const total of [lineCap - 1, lineCap, lineCap + 1, lineCap * 3]) {
      for (const n of splits) {
        if (total < n) continue;
        const bodies = splitLines(total, n, `L${n}t${total}n`);
        out.push({
          name: `${section}: ${total} non-empty lines over ${n} heading(s), line cap ${lineCap}`,
          section,
          rule: "line_cap",
          total,
          cap: lineCap,
          occurrences: n,
          content: frFile(
            `STE-L${n}${total}`,
            bodies.map((b) => [section, b] as [string, string[]]),
          ),
        });
      }
    }
  }
  return out;
}

/** Scan one composition in its own temp tree and return its violations. */
function scanComposition(c: FrComposition): Violation[] {
  const fx = makeTree({ "specs/frs/subject.md": c.content });
  try {
    return scan(fx.root);
  } finally {
    fx.cleanup();
  }
}

describe("M137 round 3 — THE PROPERTY: an accumulating rule is scoped per NAME per FILE", () => {
  test("GATING — a per-name total over the cap ALWAYS flags, under the cap NEVER does", () => {
    const corpus = frCompositions();
    expect(corpus.length).toBeGreaterThan(0);

    // NON-VACUITY, stated before the property is read. The corpus must contain
    // over-cap AND under-cap compositions, and split AND single-heading forms —
    // otherwise the property holds on a scanner that flags everything, on one
    // that flags nothing, or on one that was never shown a repetition.
    expect(corpus.some((c) => c.total > c.cap)).toBe(true);
    expect(corpus.some((c) => c.total <= c.cap)).toBe(true);
    expect(corpus.some((c) => c.occurrences === 1)).toBe(true);
    expect(corpus.some((c) => c.occurrences > 1 && c.total > c.cap)).toBe(true);
    expect(new Set(corpus.map((c) => c.rule))).toEqual(
      new Set(["word_cap", "line_cap"]),
    );

    const wrong: string[] = [];
    for (const c of corpus) {
      const hits = bySection(byRule(scanComposition(c), c.rule), c.section);
      const flagged = hits.length > 0;
      if (flagged !== c.total > c.cap) {
        wrong.push(
          `${c.rule} — ${c.name} — total ${c.total} vs cap ${c.cap}, flagged=${flagged}`,
        );
      }
      // …and when it flags, it flags ONCE for that name: one violation per
      // section per file, the shipped semantics, not one per occurrence.
      if (flagged && hits.length !== 1) {
        wrong.push(`${c.rule} — ${c.name} — flagged ${hits.length} times, expected 1`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("EVASION TWIN — the SAME total RESTRUCTURED across headings gets the SAME verdict", () => {
    // The standing rule (operator, 2026-09-01): every dogfood ships with an
    // evasion twin, because a dogfood over unrestructured material can only
    // answer "does this fire?" and never "can this be avoided?".
    //
    // Here every split composition is paired with the single-heading form of
    // the SAME total, and the two verdicts are compared directly.
    const corpus = frCompositions();
    const singles = new Map<string, boolean>();
    for (const c of corpus.filter((x) => x.occurrences === 1)) {
      singles.set(
        `${c.rule}|${c.section}|${c.total}`,
        bySection(byRule(scanComposition(c), c.rule), c.section).length > 0,
      );
    }
    expect(singles.size).toBeGreaterThan(0);

    const divergent: string[] = [];
    let compared = 0;
    for (const c of corpus.filter((x) => x.occurrences > 1)) {
      const key = `${c.rule}|${c.section}|${c.total}`;
      const original = singles.get(key);
      if (original === undefined) continue;
      const twin = bySection(byRule(scanComposition(c), c.rule), c.section).length > 0;
      if (twin !== original) {
        divergent.push(`${c.name} — single=${original}, restructured=${twin}`);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
    expect(divergent).toEqual([]);
  });
});

describe("M137 round 3 — the known attacks and the taxonomy (documentation, NOT coverage)", () => {
  test("THE CONTROLS — the single-heading form at each total really does flag", () => {
    // Coordinator's requirement, and the reason the zeros above are evidence:
    // a green from a scanner that stopped measuring is indistinguishable from a
    // green from a scanner that measures correctly, unless the control fires.
    for (const { section, cap } of CAPPED_SECTIONS) {
      const content = frFile("STE-CTRL", [
        [section, bodyOfWords(cap * 3, `c${section.length}z`)],
      ]);
      const fx = makeTree({ "specs/frs/STE-CTRL.md": content });
      try {
        const hits = bySection(byRule(scan(fx.root), "word_cap"), section);
        expect({ section, flagged: hits.length }).toEqual({ section, flagged: 1 });
      } finally {
        fx.cleanup();
      }
    }
    const lineCap = measuredLineCap();
    for (const section of LINE_CAP_SECTIONS) {
      const content = frFile("STE-CTRLL", [
        [section, Array.from({ length: lineCap * 3 }, (_, i) => `ctl${i + 1}`)],
      ]);
      const fx = makeTree({ "specs/frs/STE-CTRLL.md": content });
      try {
        const hits = bySection(byRule(scan(fx.root), "line_cap"), section);
        expect({ section, flagged: hits.length }).toEqual({ section, flagged: 1 });
      } finally {
        fx.cleanup();
      }
    }
  });

  test("THE TAXONOMY — per-line predicates do NOT multiply, and are unchanged", () => {
    // The other half of the boundary, MEASURED rather than assumed: the three
    // per-line rules carry no state, so the same offending lines fire the same
    // way however they are distributed across headings. A fix that merged
    // sections must not double-count them either.
    const perLineRules = ["backtick", "ac_id", "path_token"];
    const oneSection = frFile("STE-T1", [["Summary", [DIRTY_LINE, DIRTY_LINE, DIRTY_LINE]]]);
    const threeSections = frFile("STE-T3", [
      ["Summary", [DIRTY_LINE]],
      ["Summary", [DIRTY_LINE]],
      ["Summary", [DIRTY_LINE]],
    ]);
    const tally = (content: string): Record<string, number> => {
      const fx = makeTree({ "specs/frs/subject.md": content });
      try {
        const vs = scan(fx.root);
        return Object.fromEntries(
          perLineRules.map((r) => [r, byRule(vs, r).length]),
        );
      } finally {
        fx.cleanup();
      }
    };
    const expected = Object.fromEntries(perLineRules.map((r) => [r, 3]));
    expect(tally(oneSection)).toEqual(expected);
    expect(tally(threeSections)).toEqual(expected);
  });

  test("N repetitions do NOT buy N budgets — the live vector, at four magnitudes", () => {
    for (const { section, cap } of CAPPED_SECTIONS) {
      for (const n of [2, 3, 10, 50]) {
        // Each occurrence sits COMFORTABLY under the cap on its own; only the
        // per-file total is over it. A per-occurrence accumulator sees nothing.
        const per = Math.max(1, Math.floor(cap * 0.7));
        const bodies = Array.from({ length: n }, (_, i) =>
          bodyOfWords(per, `m${section.length}n${n}i${i}q`),
        );
        const content = frFile(
          `STE-M${section.length}${n}`,
          bodies.map((b) => [section, b] as [string, string[]]),
        );
        const fx = makeTree({ "specs/frs/subject.md": content });
        try {
          const hits = bySection(byRule(scan(fx.root), "word_cap"), section);
          expect({ section, n, per, total: per * n, cap, flagged: hits.length > 0 }).toEqual({
            section,
            n,
            per,
            total: per * n,
            cap,
            flagged: per * n > cap,
          });
        } finally {
          fx.cleanup();
        }
      }
    }
  });

  test("DOGFOOD EVASION TWIN — a real FR's own words, split across repeated headings", () => {
    // The dogfood legs above ask whether this repository's FRs pass the caps.
    // They cannot ask whether the caps are avoidable, because real prose does
    // not evade. This leg takes REAL FR content, pushes ONE section over its
    // cap, and then restructures the identical words across three headings of
    // the same name — the verdict must not move.
    const dog = dogfoodTree();
    try {
      expect(dog.source).not.toBe("none");
      const files = mdFilesIn(join(dog.root, "specs", "frs"));
      expect(files.length).toBeGreaterThan(0);

      const subject = files
        .map((abs) => ({ abs, body: readFileSync(abs, "utf-8") }))
        .find((f) => /^## Summary\s*$/m.test(f.body));
      expect(subject).toBeDefined();

      // The real Summary body, verbatim — this is what makes it a dogfood.
      const lines = subject!.body.split("\n");
      const start = lines.findIndex((l) => /^## Summary\s*$/.test(l));
      const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
      const realBody = lines
        .slice(start + 1, end === -1 ? lines.length : end)
        .filter((l) => l.trim() !== "");
      expect(realBody.length).toBeGreaterThan(0);
      const realTokens = realBody.join(" ").trim().split(/\s+/).filter(Boolean);
      expect(realTokens.length).toBeGreaterThan(0);

      // MUTATION: the real words, topped up to just past the cap. "Just past"
      // is the point — the restructured twin's chunks must each land UNDER the
      // cap, or the twin would flag for a reason that has nothing to do with
      // accumulation and this leg would pass while measuring nothing.
      const target = SUMMARY_WORD_CAP + 9;
      const filler = Array.from(
        { length: Math.max(0, target - realTokens.length) },
        (_, i) => `dogz${i + 1}`,
      );
      const allWords = [...realTokens, ...filler].slice(0, target);
      expect(allWords.length).toBe(target);
      expect(allWords.length).toBeGreaterThan(SUMMARY_WORD_CAP);
      // The real prose really is in there — otherwise this is a synthetic
      // fixture wearing a dogfood's name.
      expect(allWords.slice(0, realTokens.length)).toEqual(realTokens);

      const head = lines.slice(0, start).join("\n");
      const tail = end === -1 ? "" : lines.slice(end).join("\n");
      /** `words` laid out ten to a line — the shape a Summary really has. */
      const lay = (words: readonly string[]): string[] => {
        const out: string[] = [];
        for (let i = 0; i < words.length; i += 10) out.push(words.slice(i, i + 10).join(" "));
        return out;
      };
      const asOne = [head, "## Summary", "", ...lay(allWords), "", tail].join("\n");

      // THE TWIN: the SAME words, dealt into three `## Summary` headings, each
      // one comfortably under the cap on its own.
      const per = Math.ceil(allWords.length / 3);
      const chunks = [
        allWords.slice(0, per),
        allWords.slice(per, per * 2),
        allWords.slice(per * 2),
      ].filter((c) => c.length > 0);
      expect(chunks.length).toBe(3);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SUMMARY_WORD_CAP);
      const asMany = [
        head,
        ...chunks.flatMap((c) => ["## Summary", "", ...lay(c), ""]),
        tail,
      ].join("\n");

      // Same words, different structure — the definition of the twin.
      const wordsIn = (content: string): number =>
        content
          .split("\n")
          .filter((l) => !/^## Summary\s*$/.test(l))
          .join(" ")
          .trim()
          .split(/\s+/)
          .filter(Boolean).length;
      expect(wordsIn(asMany)).toBe(wordsIn(asOne));

      const verdictOf = (content: string): string[] => {
        const fx = makeTree({ "specs/frs/dogfood-twin.md": content });
        try {
          return bySection(byRule(scan(fx.root), "word_cap"), "Summary").map(
            (v) => `${v.rule}|${v.section}`,
          );
        } finally {
          fx.cleanup();
        }
      };
      expect(verdictOf(asOne)).toEqual(["word_cap|Summary"]);
      expect(verdictOf(asMany)).toEqual(verdictOf(asOne));
    } finally {
      dog.cleanup();
    }
  });
});

// ===========================================================================
// FENCES — sample text is not a section, and code is not prose
// ===========================================================================
//
// Both halves ship together and neither is sufficient. `fenceAware: false` was
// harmless while every rule read one line at a time; per-name accumulation made
// a fenced EXAMPLE of a capped section spend the real section's budget. But the
// flip alone raised this repository's archived-corpus count from 638 to 644,
// because a fenced heading had ALSO been truncating the real section early —
// so ending that handed `## Technical Design` its own worked examples as
// narration. One false-positive class traded for another is a relocation, not
// a fix.
describe("a fenced example is not a section, and its code is not prose", () => {
  function frWith(body: string): { root: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "fr-fence-"));
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    writeFileSync(join(root, "specs", "frs", "STE-950.md"), body);
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }
  const words = (n: number): string => Array.from({ length: n }, () => "w").join(" ");

  test("a fenced EXAMPLE of a capped section does not spend the real one's budget", () => {
    // The reported defect. Both Summaries are under the cap on their own; only
    // pooling the fenced one into the real one breaches it.
    const under = SUMMARY_WORD_CAP - 10;
    const fx = frWith(
      `# STE-950\n\n## Summary\n\n${words(under)}\n\n## Technical Design\n\n` +
        `Shape:\n\n\`\`\`markdown\n## Summary\n\n${words(under)}\n\`\`\`\n`,
    );
    try {
      const rows = scanFrSummaryAltitude(fx.root).filter((v) => v.rule === "word_cap");
      expect(rows, "the fenced example is sample text, not a second Summary").toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("fenced CODE does not count toward a prose word cap", () => {
    // A Technical Design carrying a long worked example is the section doing
    // its job. Counting the example as narration flags it for that.
    const fx = frWith(
      `# STE-950\n\n## Technical Design\n\nShort prose.\n\n` +
        `\`\`\`typescript\n// ${words(TECHNICAL_DESIGN_WORD_CAP * 2)}\n\`\`\`\n`,
    );
    try {
      const rows = scanFrSummaryAltitude(fx.root).filter((v) => v.rule === "word_cap");
      expect(rows, "a worked example is not narration").toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("prose OUTSIDE the fence is still counted — the skip is scoped", () => {
    // Non-vacuity. If the fence skip leaked to the whole section the cap would
    // stop working entirely, and the two legs above would pass for the wrong
    // reason.
    const fx = frWith(
      `# STE-950\n\n## Summary\n\n${words(SUMMARY_WORD_CAP + 20)}\n\n` +
        `\`\`\`markdown\nfenced\n\`\`\`\n`,
    );
    try {
      const rows = scanFrSummaryAltitude(fx.root).filter((v) => v.rule === "word_cap");
      expect(rows.length, "over-cap prose still flags").toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("the `backtick` rule STILL fires on a fence in Summary", () => {
    // `fencedFlags` marks the DELIMITER lines as fenced too, so a wholesale
    // skip would silently retire this rule — which is documented as "any
    // backtick character on a line, SUBSUMING code fences". The skip is scoped
    // to word counting for exactly this reason.
    const fx = frWith(`# STE-950\n\n## Summary\n\nShort.\n\n\`\`\`md\nx\n\`\`\`\n`);
    try {
      const rows = scanFrSummaryAltitude(fx.root).filter((v) => v.rule === "backtick");
      expect(rows.length, "a fence in Summary is still a backtick violation").toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// PROBE #67's REGISTRATION — what it ORDERS must be what the code DOES
// ===========================================================================
//
// Two claims in that registration were false, and both were prose defects
// rather than code defects — so they are fixed in the prose and pinned here,
// NOT by wiring the probe to make the sentence true.
describe("probe #67's registration describes the code that exists", () => {
  const registration = (): string => {
    const src = readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf-8");
    const line = src.split("\n").find((l) => l.includes("**`fr_summary_altitude`**"));
    expect(line, "probe #67's registration must exist to be graded").toBeDefined();
    return line!;
  };

  test("a repeated capped heading pools into ONE row — the BEHAVIOUR, not the prose", () => {
    // The registration used to say `word_cap` "flags once per section". Under
    // per-name accumulation two `## Summary` sections pool into one budget and
    // one row. Graded by execution so the prose cannot drift away from it
    // again: this is the fact, the sentence merely reports it.
    const root = mkdtempSync(join(tmpdir(), "fr-twosum-"));
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    const half = Array.from({ length: SUMMARY_WORD_CAP - 30 }, () => "w").join(" ");
    writeFileSync(
      join(root, "specs", "frs", "STE-960.md"),
      `# STE-960\n\n## Summary\n\n${half}\n\n## Notes\n\nx\n\n## Summary\n\n${half}\n`,
    );
    try {
      const rows = scanFrSummaryAltitude(root).filter((v) => v.rule === "word_cap");
      expect(rows.length, "two occurrences, one pooled budget, one row").toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("it does NOT claim the probe entry point covers the plan half", () => {
    // `runFrSummaryAltitudeProbe` never calls `scanPlanNarrativeAltitude`, and
    // no adapter module does — the plan scanner's only runtime caller is its
    // own `import.meta.main` front door. A registration that names one
    // "the runtime entry point" while the plan half needs a second call is how
    // a shipped cap goes unenforced while reading as covered.
    expect(registration()).toContain("does NOT reach the plan half");
  });

  test("the claim it makes about the entry point is TRUE of the module", () => {
    // The pin above grades a sentence. This one grades the fact the sentence
    // asserts, so the pair cannot agree with each other while both being wrong.
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "scan_fr_summary_altitude.ts"),
      "utf-8",
    );
    expect(src, "if this module ever DOES call the plan scanner, the prose above is now wrong")
      .not.toContain("scanPlanNarrativeAltitude");
  });
});
