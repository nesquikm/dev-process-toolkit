// STE-535 (M137) — plan narrative is capped by section KIND, not by section
// NAME. RED-state until the plan scanner lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/scan_plan_narrative_altitude.ts
//
// The sibling FR scanner (`scan_fr_summary_altitude.ts`, STE-386 + STE-534)
// walks ACTIVE FRs, enters sections located by exact level-2 heading TEXT, and
// caps them by a per-name table. That approach cannot work on plans: a plan's
// length lives under level-3 headings whose names vary between plans
// ("Follow-ups carried into M137", "Dependency graph", "Notes on the rollout").
// No fixed name finds them. So this scanner decides by what a body IS.
//
// CONTRACT PINNED HERE (the shape the implementer must build):
//
//   export const PLAN_NARRATIVE_WORD_CAP = 150;
//   export const CHECKBOX_ITEM_MAJORITY = 0.6;
//
//   export type SectionKind = "narrative" | "structural";
//
//   // BODY ONLY — one parameter, no heading. See AC-STE-535.1.
//   export function classifySectionBody(body: readonly string[]): SectionKind;
//
//   export interface PlanNarrativeViolation {
//     file: string; line: number; rule: "word_cap"; section: string;
//   }
//   export interface MeasuredSubsection {
//     file: string; section: string; line: number; words: number;
//     kind: SectionKind;
//   }
//
//   scanPlanNarrativeAltitude(projectRoot, classify = classifySectionBody)
//     => PlanNarrativeViolation[]
//   measurePlanSubsections(projectRoot, classify = classifySectionBody)
//     => MeasuredSubsection[]
//
// WHY the classifier is an INJECTABLE second parameter, defaulting to the
// shipped one: AC-STE-535.9's first mutation is "invert the classifier", and
// an inversion has to reach the SCAN for the scan's silence over a checkbox
// body to count as a measurement rather than a stub. Injecting the mutant is
// therefore the mutation, and "the mutation applied" is measurable (the mutant
// disagrees with the shipped function on the very body under test) rather than
// assumed. This mirrors STE-534's injectable section table verbatim.
//
// WHY the anchor line is the CROSSING line: the sibling scanner's `word_cap`
// already anchors "at the first body line at which the running word count
// first EXCEEDS the cap". The plan scanner reports through the same violation
// shape (the FR's Technical Design: "one violation type so probe #67 renders
// both without a second code path"), so it uses the same anchor rule.
//
// AC map:
//   AC-STE-535.1  — body-only classifier, asserted STRUCTURALLY (arity+source)
//   AC-STE-535.2  — >60% checkbox ITEMS is structural; both sides of it
//   AC-STE-535.2a — the discriminating case, on the template's mandated shape
//                   AND on this repository's own real plan body
//   AC-STE-535.3  — header row + delimiter row, not a pipe count
//   AC-STE-535.4  — fenced code is structural; an unterminated fence does not
//                   swallow the rest of the file
//   AC-STE-535.5  — over-cap narrative names file, line, rule, heading
//   AC-STE-535.6  — `specs/plan/archive/` is never scanned, pinned against the
//                   REAL archive tree (which genuinely violates)
//   AC-STE-535.7  — renaming a section does not change its classification
//   AC-STE-535.8  — dogfood over this repository's own active plans,
//                   non-vacuously, with an archive fallback for the archive
//                   commit
//   AC-STE-535.9  — mutation-verified, each mutation asserted to have applied

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  CHECKBOX_ITEM_MAJORITY,
  PLAN_NARRATIVE_WORD_CAP,
  classifySectionBody,
  measurePlanSubsections,
  scanPlanNarrativeAltitude,
} from "../adapters/_shared/src/scan_plan_narrative_altitude";
import {
  PROBE_ID,
  scanFrSummaryAltitude,
} from "../adapters/_shared/src/scan_fr_summary_altitude";
// The shared section walk, imported so GAP 3's harm demonstration runs against
// the SHIPPED walk rather than against a re-implementation of it.
import { walkSections } from "../adapters/_shared/src/markdown_section_walk";
// The reusable non-test-consumer guard, extracted under STE-533 so this suite
// and `tests/m137-ste-533-stage-block-adoption.test.ts` share ONE walk.
import {
  consumerFiles,
  nonTestConsumers,
  walkTextFiles,
} from "./_module_consumers";
// The archive-blind-spot idiom, shared with the sibling M137 suites so there is
// exactly ONE spec-tree resolver rather than one per guard.
import { mdFilesIn, milestoneSpecFiles, resolveSpecFile } from "./_spec_tree";

// ---------------------------------------------------------------- shared shapes

type Kind = "narrative" | "structural";

interface Violation {
  file: string;
  line: number;
  rule: string;
  section: string;
}

interface Measured {
  file: string;
  section: string;
  line: number;
  words: number;
  kind: Kind;
}

/** A classifier as the SCANNER may call it: body alone. */
type Classify = (body: readonly string[]) => Kind;

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SCANNER_SRC = join(
  import.meta.dir,
  "..",
  "adapters",
  "_shared",
  "src",
  "scan_plan_narrative_altitude.ts",
);
const PLAN_TEMPLATE_SRC = join(
  import.meta.dir,
  "..",
  "templates",
  "spec-templates",
  "plan.md.template",
);

// Routed through loose signatures so the test pins BEHAVIOUR, not the exact
// declared generic shape of the injectable parameter.
const classifyFn = classifySectionBody as unknown as (body: readonly string[]) => Kind;
const scanFn = scanPlanNarrativeAltitude as unknown as (
  root: string,
  classify?: Classify,
) => Violation[];
const measureFn = measurePlanSubsections as unknown as (
  root: string,
  classify?: Classify,
) => Measured[];

const classify = (body: readonly string[]): Kind => classifyFn(body);
const scan = (root: string, c?: Classify): Violation[] =>
  c === undefined ? scanFn(root) : scanFn(root, c);
const measure = (root: string, c?: Classify): Measured[] =>
  c === undefined ? measureFn(root) : measureFn(root, c);

// ---------------------------------------------------------------- tree helpers

/** Build a real temp project tree: rel-path => content. */
function makeTree(files: Record<string, string>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "plan-narrative-cap-"));
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

/** Whitespace-delimited token count over a block of lines. */
function countWords(lines: readonly string[]): number {
  return lines.join(" ").trim().split(/\s+/).filter(Boolean).length;
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
 * `total` plain prose words spread over lines of `perLine` tokens. Every line's
 * LAST token is a unique `<prefix><NN>` marker, so a physical line can be found
 * by name and the crossing-line anchor asserted exactly. No line starts with a
 * list marker, carries a pipe, or is indented — these bodies are prose and
 * nothing else.
 */
function proseLines(total: number, prefix: string, perLine = 20): string[] {
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

/** An active plan file built from `[heading, bodyLines]` level-3 pairs. */
function planFile(milestone: string, sections: [string, string[]][]): string {
  const out: string[] = [
    "---",
    `milestone: ${milestone}`,
    "status: active",
    "archived_at: null",
    "kickoff_branch: null",
    "frozen_at: null",
    "migration: none",
    "---",
    "",
    "# Implementation Plan",
    "",
    `## ${milestone} — Fixture {#${milestone}}`,
    "",
    "**Goal:** A fixture plan.",
    "",
  ];
  for (const [heading, body] of sections) {
    out.push(`### ${heading}`, "", ...body, "");
  }
  return `${out.join("\n")}\n`;
}

const bySection = (vs: Violation[], section: string): Violation[] =>
  vs.filter((v) => v.section === section);
const kindOf = (ms: Measured[], section: string): Kind | undefined =>
  ms.find((m) => m.section === section)?.kind;

// --------------------------------------------------- checkbox / item fixtures

/**
 * `items` checkbox entries in the plan template's MANDATED two-line shape —
 * line 1 the action as a checkbox bullet, line 2 an indented `verify:` line —
 * followed by `prose` flush-left prose lines.
 *
 * Line-counted, an all-two-line-task body sits at exactly 50% checkbox lines
 * and can NEVER clear a 60% threshold. Item-counted, it is 100%. That is the
 * whole disagreement STE-535 turns on.
 */
function twoLineTasks(items: number, prose = 0): string[] {
  const out: string[] = [];
  for (let i = 1; i <= items; i++) {
    out.push(`- [ ] STE-9${String(i).padStart(2, "0")} — do the ${i}th thing`);
    out.push(`  verify: the ${i}th assertion passes under the gate command`);
  }
  out.push(...proseLines(prose * 12, "p", 12).slice(0, prose));
  return out;
}

/** `checks` single-line checkbox entries followed by `prose` prose lines. */
function singleLineTasks(checks: number, prose: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= checks; i++) {
    out.push(`- [ ] task number ${i} in this fixture body`);
  }
  out.push(...proseLines(prose * 12, "q", 12).slice(0, prose));
  return out;
}

/** The test's own BARE-LINE variant — the definition STE-535 rejects. */
const CHECKBOX_LINE_RE = /^\s*[-*]\s+\[[^\]]*\]/;
function bareLineCheckboxRatio(body: readonly string[]): number {
  const nonEmpty = body.filter((l) => l.trim() !== "");
  if (nonEmpty.length === 0) return 0;
  return nonEmpty.filter((l) => CHECKBOX_LINE_RE.test(l)).length / nonEmpty.length;
}

// ---------------------------------------------------- real-plan subject helper
//
// The union of active + archived is taken HERE, in the test, and never in the
// scanner: AC-STE-535.6 pins that the scanner itself refuses to walk
// `specs/plan/archive/`, and that exclusion must stay shipped behaviour. The
// test resolves its own SUBJECT first — the active tree if it holds a plan,
// otherwise THIS milestone's plan staged out of the archive into a temp root's
// `specs/plan/` — and hands the scanner an ordinary active tree either way.
//
// Which path ran is asserted explicitly, because a run that silently found
// nothing on both paths must fail loudly rather than read as a clean pass.
// `"none"` is the sentinel for exactly that.
//
// BOTH paths are MILESTONE-SCOPED, for the same reason on each side.
//
// Archive side, measured 2026-08-31: `specs/plan/archive/M136.md` alone carries
// a 939-word Tasks section and an 1161-word follow-ups section, all written long
// before any word cap existed. Staging the archive wholesale would assert this
// rule over prose that never had to meet it.
//
// ACTIVE side, the same trap dated forward: `specs/plan/` holds whatever plan is
// open, and the moment M138 opens one before M137 archives, an unscoped subject
// would grade THIS milestone's suite on the NEXT milestone's plan shape — red
// here rather than on that plan's own gate run, and for a body this milestone
// never wrote. The subject is therefore this milestone's own plan on both paths,
// identified by frontmatter, and staged into a temp root either way so the
// scanner is handed an ordinary active tree holding exactly that plan.

type PlanSource = "active" | "archive" | "none";

interface PlanSubject {
  /** Root to hand the scanner — plans always live in `specs/plan/`. */
  root: string;
  source: PlanSource;
  /** Basenames of the plan files the subject supplied. */
  files: string[];
  cleanup: () => void;
}

/** This milestone's own plan, wherever it lives, identified by frontmatter. */
const DOGFOOD_MILESTONE = "M137";

function dogfoodTree(repoRoot: string = REPO_ROOT): PlanSubject {
  const noop = (): void => {};

  /** Copy `plans` into a fresh temp root's `specs/plan/` and describe it. */
  const stage = (plans: string[], source: PlanSource): PlanSubject => {
    const staged = mkdtempSync(join(tmpdir(), "plan-narrative-dogfood-"));
    mkdirSync(join(staged, "specs", "plan"), { recursive: true });
    for (const abs of plans) {
      writeFileSync(join(staged, "specs", "plan", basename(abs)), readFileSync(abs, "utf-8"));
    }
    return {
      root: staged,
      source,
      files: plans.map((f) => basename(f)),
      cleanup: () => rmSync(staged, { recursive: true, force: true }),
    };
  };

  // One resolver for both paths. This suite already filtered its two halves the
  // same way, and that is exactly why it must not keep its own copy: two
  // sibling suites hand-rolled the same walk and got the ACTIVE half wrong, so
  // the idiom lives in `_spec_tree.ts` and every caller reads it from there.
  const resolved = milestoneSpecFiles(repoRoot, "specs/plan", DOGFOOD_MILESTONE);
  if (resolved.source === "none") {
    return { root: repoRoot, source: "none", files: [], cleanup: noop };
  }
  return stage(resolved.files, resolved.source);
}

/**
 * Absolute path of THIS milestone's plan file, active tree or archive.
 *
 * Delegated to the shared resolver so the active-then-archive lookup exists in
 * exactly one place: a per-suite copy is how this blind spot keeps coming back.
 */
function realPlanFile(): { abs: string; source: PlanSource } {
  const found = resolveSpecFile(REPO_ROOT, "specs/plan", `${DOGFOOD_MILESTONE}.md`);
  return { abs: found.abs, source: found.source };
}

/**
 * The test's OWN level-3 subsection walk, independent of the scanner — used to
 * read real bodies out of real plans without asking the subject under test to
 * describe itself. Fence-aware so a `###` inside a closed fence cannot split.
 */
function subsectionsOfContent(content: string): { heading: string; body: string[] }[] {
  const lines = content.split("\n");
  const out: { heading: string; body: string[] }[] = [];
  let cur: { heading: string; body: string[] } | null = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced) {
      const h3 = /^###\s+(.*?)\s*$/.exec(line);
      const h2 = /^##(?!#)\s+/.test(line);
      if (h3 !== null || h2) {
        if (cur !== null) out.push(cur);
        cur = h3 === null ? null : { heading: h3[1]!, body: [] };
        continue;
      }
    }
    if (cur !== null) cur.body.push(line);
  }
  if (cur !== null) out.push(cur);
  return out;
}

function realTasksBody(): string[] {
  const { abs } = realPlanFile();
  expect(abs).not.toBe("");
  const secs = subsectionsOfContent(readFileSync(abs, "utf-8"));
  const tasks = secs.find((s) => s.heading === "Tasks");
  expect(tasks).toBeDefined();
  return tasks!.body;
}

// ================================================================ AC-STE-535.1

describe("AC-STE-535.1 — the classifier decides from the BODY, and cannot see the heading", () => {
  test("it returns one of exactly two kinds for a body", () => {
    expect(classify(proseLines(40, "a"))).toBe("narrative");
    expect(classify(twoLineTasks(6))).toBe("structural");
    for (const body of [proseLines(40, "a"), twoLineTasks(6), []]) {
      expect(["narrative", "structural"]).toContain(classify(body));
    }
  });

  test("STRUCTURAL TEETH — the exported function's arity is 1: there is no heading parameter", () => {
    // Behaviour alone is not enough here. A function that ACCEPTS a heading and
    // ignores it today can start branching on it tomorrow — which is exactly
    // the mutation AC-STE-535.9 describes. The signature must make heading-based
    // classification unavailable, not merely unused.
    expect(typeof classifySectionBody).toBe("function");
    expect((classifySectionBody as unknown as { length: number }).length).toBe(1);
  });

  test("STRUCTURAL TEETH — the declaration in the source takes one parameter and never names a heading", () => {
    expect(existsSync(SCANNER_SRC)).toBe(true);
    const src = readFileSync(SCANNER_SRC, "utf-8");
    const decl = /export function classifySectionBody\s*\(([^)]*)\)/.exec(src);
    // The failure message names the file, so a renamed export says so.
    expect([SCANNER_SRC, decl !== null]).toEqual([SCANNER_SRC, true]);
    const params = decl![1]!;

    // Exactly one top-level parameter (commas inside `<>`/`[]`/`{}`/`()` do not
    // separate parameters).
    let depth = 0;
    let topLevelCommas = 0;
    for (const ch of params) {
      if ("<[{(".includes(ch)) depth++;
      else if (">]})".includes(ch)) depth--;
      else if (ch === "," && depth === 0) topLevelCommas++;
    }
    expect([params, topLevelCommas]).toEqual([params, 0]);

    // And that one parameter is not a heading by any of its usual names.
    expect(/head|title|\bname\b|section/i.test(params)).toBe(false);
  });
});

// ================================================================ AC-STE-535.2

describe("AC-STE-535.2 — >60% checkbox ITEMS is structural, and the threshold is named", () => {
  test("the threshold is an exported named constant equal to 0.6", () => {
    expect(CHECKBOX_ITEM_MAJORITY).toBe(0.6);
  });

  test("ABOVE the threshold — 13 checkbox lines of 20 (65%) classifies structural", () => {
    const body = singleLineTasks(13, 7);
    expect(body.filter((l) => l.trim() !== "")).toHaveLength(20);
    expect(13 / 20).toBeGreaterThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(body)).toBe("structural");
  });

  test("AT the threshold — 12 checkbox lines of 20 (exactly 60%) classifies narrative", () => {
    // "more than sixty percent" is strict: a body sitting exactly on the line
    // is prose. Asserting the boundary from below is what stops the threshold
    // being satisfied by a constant function.
    const body = singleLineTasks(12, 8);
    expect(body.filter((l) => l.trim() !== "")).toHaveLength(20);
    expect(12 / 20).toBe(CHECKBOX_ITEM_MAJORITY);
    expect(classify(body)).toBe("narrative");
  });

  test("BELOW the threshold — 4 checkbox lines of 20 (20%) classifies narrative", () => {
    const body = singleLineTasks(4, 16);
    expect(4 / 20).toBeLessThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(body)).toBe("narrative");
  });

  test("an ITEM spans its checkbox line plus its indented continuation lines", () => {
    // Six two-line items and four prose lines: 16 lines, 6 of them checkbox
    // lines (37.5% by line) but 12 of them item lines (75% by item). Line
    // counting says narrative; item counting says structural. The two
    // definitions are asserted to DISAGREE here, so this cannot pass by
    // accident under a bare-line implementation.
    const body = twoLineTasks(6, 4);
    expect(body.filter((l) => l.trim() !== "")).toHaveLength(16);
    expect(bareLineCheckboxRatio(body)).toBeLessThan(CHECKBOX_ITEM_MAJORITY);
    expect(12 / 16).toBeGreaterThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(body)).toBe("structural");
  });

  test("a half-prose, half-checklist body is narrative — the prose half is what grows", () => {
    const body = [...twoLineTasks(4), ...proseLines(200, "m")];
    expect(bareLineCheckboxRatio(body)).toBeLessThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(body)).toBe("narrative");
  });
});

// =============================================================== AC-STE-535.2a

describe("AC-STE-535.2a — the discriminating case: the template's own mandated task shape", () => {
  test("the plan template really does mandate the two-line entry this fixture is built from", () => {
    // The fixture is not hand-invented: this asserts the shape it copies is the
    // one the shipped template orders authors to write.
    const tpl = readFileSync(PLAN_TEMPLATE_SRC, "utf-8");
    expect(tpl).toContain("the action as a checkbox bullet");
    expect(tpl).toContain("an indented `verify:` line");
    // And the template's own scaffolded Tasks block is written in it.
    expect(/^- \[ \] .*\n\s+verify: /m.test(tpl)).toBe(true);
  });

  test("a Tasks body written to the template's mandated shape classifies STRUCTURAL", () => {
    const body = twoLineTasks(12);
    // Every line is either a checkbox line or its indented `verify:` line, so
    // the BARE-LINE ratio is exactly 50% — it can never clear 60%, whatever the
    // body's size. Under a line-counting classifier this body is narrative.
    expect(bareLineCheckboxRatio(body)).toBe(0.5);
    expect(bareLineCheckboxRatio(body)).toBeLessThanOrEqual(CHECKBOX_ITEM_MAJORITY);
    // Under ITEM counting it is 100% structural.
    expect(classify(body)).toBe("structural");
  });

  test("MEASURED — this repository's OWN plan § Tasks: 50% by line, structural by item", () => {
    // Measured 2026-08-31 on specs/plan/M137.md § Tasks: 24 content lines, 12
    // checkbox lines each followed by one indented `verify:` line, 346 words.
    // 12/24 = exactly 50% by bare line — below 60%, so a line-counting
    // classifier calls it NARRATIVE and fires a 346-word violation on the most
    // common subsection in every plan this toolkit writes.
    const { source } = realPlanFile();
    expect(source).not.toBe("none");

    const body = realTasksBody();
    const nonEmpty = body.filter((l) => l.trim() !== "");
    expect([source, nonEmpty.length > 0]).toEqual([source, true]);

    // The contrast, asserted rather than asserted-about: the bare-line ratio
    // cannot clear the threshold ...
    expect(bareLineCheckboxRatio(body)).toBeLessThanOrEqual(CHECKBOX_ITEM_MAJORITY);
    // ... and the body is long enough that misclassifying it WOULD violate.
    expect(countWords(body)).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
    // ... yet the shipped classifier calls it structural.
    expect(classify(body)).toBe("structural");
  });

  test("MEASURED — the real Tasks body yields no violation through the SCANNER either", () => {
    const body = realTasksBody();
    const content = planFile("M900", [["Tasks", body]]);
    const fx = makeTree({ "specs/plan/M900.md": content });
    try {
      expect(bySection(scan(fx.root), "Tasks")).toEqual([]);
      expect(kindOf(measure(fx.root), "Tasks")).toBe("structural");
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-535.3

describe("AC-STE-535.3 — a markdown table is structural, recognised by header + delimiter", () => {
  const TABLE_BODY = [
    "| FR | Title | Tracker |",
    "|----|-------|---------|",
    "| STE-535 | Plan narrative is capped by section kind | linear:`STE-535` |",
    "| STE-536 | Authoring surfaces state the budgets | linear:`STE-536` |",
  ];

  test("a header row followed by a delimiter row classifies structural", () => {
    expect(classify(TABLE_BODY)).toBe("structural");
  });

  test("prose that MENTIONS pipes is narrative — pipe count is not the test", () => {
    // Eight lines, every one of them carrying pipe characters, none of them a
    // delimiter row. A pipe-counting classifier calls this a table.
    const piped = proseLines(240, "t").map(
      (l) => `${l} joined by a | pipe | character in running prose`,
    );
    expect(piped.every((l) => l.includes("|"))).toBe(true);
    expect(piped.some((l) => /^\s*\|?\s*:?-{3,}/.test(l))).toBe(false);
    expect(classify(piped)).toBe("narrative");
  });

  test("FALSIFIABLE — the same rows WITHOUT the delimiter row are narrative", () => {
    // Isolation is half the test: the table verdict must also FAIL on the
    // sibling body that differs in exactly the delimiter row.
    const noDelimiter = [TABLE_BODY[0]!, ...TABLE_BODY.slice(2), ...proseLines(200, "u")];
    expect(classify(noDelimiter)).toBe("narrative");
  });

  test("an over-cap prose subsection mentioning a pipe still violates", () => {
    const body = [
      "The stage report is rendered by a | pipe | separated helper in prose.",
      ...proseLines(200, "v"),
    ];
    const content = planFile("M901", [["Rationale", body]]);
    const fx = makeTree({ "specs/plan/M901.md": content });
    try {
      expect(bySection(scan(fx.root), "Rationale")).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-535.4

describe("AC-STE-535.4 — fenced code is structural, and an unterminated fence does not swallow the file", () => {
  const FENCE_BODY = [
    "```sh",
    "cd plugins/dev-process-toolkit && bun test",
    "bun test tests/m137-ste-535-plan-narrative-cap.test.ts",
    "```",
  ];

  test("a fenced code block classifies structural", () => {
    expect(classify(FENCE_BODY)).toBe("structural");
  });

  test("a long fenced block does not violate the word cap however many words it holds", () => {
    const long = ["```text", ...proseLines(600, "f"), "```"];
    expect(countWords(long)).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
    expect(classify(long)).toBe("structural");

    const content = planFile("M902", [["Gate", long]]);
    const fx = makeTree({ "specs/plan/M902.md": content });
    try {
      expect(scan(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a CLOSED fence hides a heading inside it — that section is not split", () => {
    const body = ["```markdown", "### Not A Real Heading", "sample plan text", "```"];
    const content = planFile("M903", [["Example", body]]);
    const fx = makeTree({ "specs/plan/M903.md": content });
    try {
      const measured = measure(fx.root);
      expect(measured.map((m) => m.section)).toEqual(["Example"]);
      expect(measured.map((m) => m.section)).not.toContain("Not A Real Heading");
    } finally {
      fx.cleanup();
    }
  });

  test("an UNTERMINATED fence does not swallow the rest of the file into one section", () => {
    // Section one opens a fence and never closes it. If the walker lets that
    // fence run to EOF, section two disappears — and with it its 200-word
    // violation. That is the swallow this AC forbids.
    const content = planFile("M904", [
      ["Snippet", ["```sh", "echo the fence is never closed"]],
      ["Rationale", proseLines(200, "w")],
    ]);
    const fx = makeTree({ "specs/plan/M904.md": content });
    try {
      const measured = measure(fx.root);
      const headings = measured.map((m) => m.section);
      expect(headings).toContain("Snippet");
      expect(headings).toContain("Rationale");
      expect(headings).toHaveLength(2);

      const violations = bySection(scan(fx.root), "Rationale");
      expect(violations).toHaveLength(1);
      expect(violations[0]!.section).toBe("Rationale");
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-535.5

describe("AC-STE-535.5 — an over-cap narrative subsection names file, line, rule and heading", () => {
  test("the cap is an exported named constant equal to 150", () => {
    expect(PLAN_NARRATIVE_WORD_CAP).toBe(150);
  });

  test("a 160-word narrative subsection yields one fully-named violation", () => {
    const body = proseLines(160, "r"); // 8 lines of 20 words
    const content = planFile("M905", [["Follow-ups carried into M905", body]]);
    const fx = makeTree({ "specs/plan/M905.md": content });
    try {
      const violations = scan(fx.root);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toEqual({
        file: "specs/plan/M905.md",
        // The CROSSING line: the running count first exceeds 150 on the 8th
        // body line (140 -> 160), mirroring the FR scanner's word_cap anchor.
        line: lineOf(content, "r08"),
        rule: "word_cap",
        section: "Follow-ups carried into M905",
      });
      // The heading it was measured under is the heading it was WRITTEN under,
      // whatever that heading happens to be called.
      expect(Object.keys(violations[0]!).sort()).toEqual([
        "file",
        "line",
        "rule",
        "section",
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test("BOTH SIDES — exactly 150 words is clean, 151 violates", () => {
    const at = planFile("M906", [["Notes", proseLines(PLAN_NARRATIVE_WORD_CAP, "x")]]);
    const over = planFile("M907", [
      ["Notes", proseLines(PLAN_NARRATIVE_WORD_CAP + 1, "y")],
    ]);
    const fx = makeTree({ "specs/plan/M906.md": at, "specs/plan/M907.md": over });
    try {
      const violations = scan(fx.root);
      expect(violations.map((v) => v.file)).toEqual(["specs/plan/M907.md"]);
      expect(violations[0]!.rule).toBe("word_cap");
    } finally {
      fx.cleanup();
    }
  });

  test("measurement reports the word count and the kind for every subsection", () => {
    const content = planFile("M908", [
      ["Overview", proseLines(30, "z")],
      ["Tasks", twoLineTasks(5)],
    ]);
    const fx = makeTree({ "specs/plan/M908.md": content });
    try {
      const measured = measure(fx.root);
      expect(measured.map((m) => m.section)).toEqual(["Overview", "Tasks"]);
      expect(measured.map((m) => m.kind)).toEqual(["narrative", "structural"]);
      expect(measured.find((m) => m.section === "Overview")!.words).toBe(30);
      expect(measured.find((m) => m.section === "Overview")!.line).toBe(
        lineOf(content, "### Overview"),
      );
      expect(measured.every((m) => m.file === "specs/plan/M908.md")).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-535.6

describe("AC-STE-535.6 — `specs/plan/archive/` is frozen history and is never scanned", () => {
  test("NON-VACUITY — this repository's REAL archive genuinely contains over-cap narrative", () => {
    // If the archive held nothing over the cap, the exclusion below would prove
    // nothing. Measured 2026-08-31: specs/plan/archive/M136.md carries a
    // 939-word Tasks section and an 1161-word follow-ups section. This
    // recomputes that independently of the scanner, so the exclusion assertion
    // is known to be doing work.
    const archived = mdFilesIn(join(REPO_ROOT, "specs", "plan", "archive"));
    expect(archived.length).toBeGreaterThan(0);

    const overCap: string[] = [];
    for (const abs of archived) {
      for (const sec of subsectionsOfContent(readFileSync(abs, "utf-8"))) {
        if (
          countWords(sec.body) > PLAN_NARRATIVE_WORD_CAP &&
          classify(sec.body) === "narrative"
        ) {
          overCap.push(`${basename(abs)}|${sec.heading}|${countWords(sec.body)}`);
        }
      }
    }
    // Named in the failure message so an empty archive says so outright.
    expect([overCap.length > 0, overCap.slice(0, 3)]).toEqual([true, overCap.slice(0, 3)]);
    expect(overCap.length).toBeGreaterThan(0);
  });

  test("scanning this repository yields no violation anchored under specs/plan/archive/", () => {
    const violations = scan(REPO_ROOT);
    const fromArchive = violations.filter((v) => v.file.includes("specs/plan/archive/"));
    expect(fromArchive.map((v) => `${v.file}|${v.section}`)).toEqual([]);
  });

  test("measurement never enters the archive either", () => {
    const measured = measure(REPO_ROOT);
    expect(measured.filter((m) => m.file.includes("specs/plan/archive/"))).toEqual([]);
  });

  test("FALSIFIABLE — the SAME over-cap plan violates in specs/plan/ and is silent in the archive", () => {
    const content = planFile("M909", [["Rationale", proseLines(400, "n")]]);

    const archived = makeTree({ "specs/plan/archive/M909.md": content });
    try {
      expect(scan(archived.root)).toEqual([]);
      expect(measure(archived.root)).toEqual([]);
    } finally {
      archived.cleanup();
    }

    const active = makeTree({ "specs/plan/M909.md": content });
    try {
      // Byte-identical content, one directory up: the silence above is an
      // exclusion, not an inability to read the file.
      expect(scan(active.root)).toHaveLength(1);
      expect(scan(active.root)[0]!.section).toBe("Rationale");
    } finally {
      active.cleanup();
    }
  });
});

// ================================================================ AC-STE-535.7

describe("AC-STE-535.7 — renaming a section does not change its classification", () => {
  /** One body, two headings, through the scanner. Verdicts must be equal. */
  function verdictsUnderTwoHeadings(
    body: string[],
    a: string,
    b: string,
  ): [Kind | undefined, Kind | undefined] {
    const content = planFile("M910", [
      [a, body],
      [b, [...body]],
    ]);
    const fx = makeTree({ "specs/plan/M910.md": content });
    try {
      const measured = measure(fx.root);
      expect(measured.map((m) => m.section)).toEqual([a, b]);
      return [kindOf(measured, a), kindOf(measured, b)];
    } finally {
      fx.cleanup();
    }
  }

  test("a checkbox body classifies the same under `Tasks` and under `Ruminations`", () => {
    const [under1, under2] = verdictsUnderTwoHeadings(
      twoLineTasks(8),
      "Tasks",
      "Ruminations",
    );
    expect(under1).toBeDefined();
    expect(under2).toBe(under1!);
  });

  test("a prose body classifies the same under `Notes` and under `Tasks`", () => {
    // The evasion this closes runs the other way too: calling a wall of prose
    // "Tasks" must not buy it an exemption.
    const [under1, under2] = verdictsUnderTwoHeadings(proseLines(400, "k"), "Notes", "Tasks");
    expect(under1).toBeDefined();
    expect(under2).toBe(under1!);
  });

  test("an over-cap prose body violates under `Tasks` exactly as under `Notes`", () => {
    const body = proseLines(400, "j");
    const content = planFile("M911", [
      ["Tasks", body],
      ["Notes", [...body]],
    ]);
    const fx = makeTree({ "specs/plan/M911.md": content });
    try {
      const violations = scan(fx.root);
      expect(violations.map((v) => v.section).sort()).toEqual(["Notes", "Tasks"]);
    } finally {
      fx.cleanup();
    }
  });

  test("NON-VACUITY — the verdict is not constant: two different bodies disagree under ONE heading", () => {
    // Equality above would hold trivially if every body classified the same
    // way. It does not.
    const prose = verdictsUnderTwoHeadings(proseLines(300, "h"), "Tasks", "Aside")[0];
    const checks = verdictsUnderTwoHeadings(twoLineTasks(8), "Tasks", "Aside")[0];
    expect(prose).toBe("narrative");
    expect(checks).toBe("structural");
    expect(prose).not.toBe(checks!);
  });
});

// ================================================================ AC-STE-535.8

describe("AC-STE-535.8 — dogfood over this repository's OWN active plans, non-vacuously", () => {
  test("the scan actually CLASSIFIED subsections of this repository's plan", () => {
    // The trap this closes: this milestone's plan currently PASSES the cap
    // (measured 2026-08-31 — FRs 93 words / table, Tasks 346 / checkbox items,
    // Gate 5, Dependency graph 52, Follow-ups 114; the three narrative ones all
    // under 150). An "assert zero violations" dogfood is therefore VACUOUS BY
    // CONSTRUCTION: byte-identical to a scanner that walked nothing. Assert the
    // CLASSIFIED COUNT instead.
    const dog = dogfoodTree();
    try {
      // WHICH path supplied the plan, stated outright. `"none"` means both
      // trees came up empty: a silently-empty run must never read as a pass.
      expect(dog.source).not.toBe("none");
      expect(["active", "archive"]).toContain(dog.source);
      expect([dog.source, dog.files.length > 0]).toEqual([dog.source, true]);

      const measured = measure(dog.root);
      expect([dog.source, measured.length > 0]).toEqual([dog.source, true]);

      // Both kinds appear — a run that only ever emitted one verdict would
      // prove nothing about the classifier.
      const kinds = new Set(measured.map((m) => m.kind));
      expect([dog.source, [...kinds].sort()]).toEqual([
        dog.source,
        ["narrative", "structural"],
      ]);

      // Real subsections, not stubs.
      for (const m of measured) {
        expect(m.file.startsWith("specs/plan/")).toBe(true);
        expect(m.file.includes("archive/")).toBe(false);
        expect(m.section.length).toBeGreaterThan(0);
        expect(m.line).toBeGreaterThan(0);
        expect(m.words).toBeGreaterThanOrEqual(0);
      }
      expect(Math.max(...measured.map((m) => m.words))).toBeGreaterThanOrEqual(50);
    } finally {
      dog.cleanup();
    }
  });

  test("with the subsections classified, this repository's own active plans pass the cap", () => {
    const dog = dogfoodTree();
    try {
      expect(dog.source).not.toBe("none");
      const measured = measure(dog.root);
      // Non-vacuity rides in front of the zero, so an empty walk cannot read as
      // a clean pass.
      expect([dog.source, measured.length > 0]).toEqual([dog.source, true]);
      const violations = scan(dog.root);
      expect(violations.map((v) => `${v.file}|${v.section}|${v.line}`)).toEqual([]);
    } finally {
      dog.cleanup();
    }
  });

  test("every measured narrative subsection is under the cap, and each is named if not", () => {
    const dog = dogfoodTree();
    try {
      expect(dog.source).not.toBe("none");
      const measured = measure(dog.root);
      expect([dog.source, measured.length > 0]).toEqual([dog.source, true]);
      const over = measured.filter(
        (m) => m.kind === "narrative" && m.words > PLAN_NARRATIVE_WORD_CAP,
      );
      expect(over.map((m) => `${m.file}|${m.section}|${m.words}`)).toEqual([]);
    } finally {
      dog.cleanup();
    }
  });

  test("FALLBACK — with specs/plan/ empty, this milestone's ARCHIVED plan is staged and MEASURED", () => {
    // The archival blind spot, closed in advance: this milestone ARCHIVES its
    // own plan at its close, and that is the one transition no gate run
    // precedes. With the active tree empty the dogfood must still measure.
    const planContent = planFile(DOGFOOD_MILESTONE, [
      ["FRs", ["| FR | Title |", "|----|-------|", "| STE-535 | Fixture |"]],
      ["Tasks", twoLineTasks(6)],
      ["Dependency graph", proseLines(50, "g")],
    ]);
    const fx = makeTree({
      [`specs/plan/archive/${DOGFOOD_MILESTONE}.md`]: planContent,
      // Another milestone's archived plan, over the cap. The fallback is
      // milestone-scoped, so this must NOT be staged even though it sits in the
      // same directory — staging it would red the cap assertion above.
      "specs/plan/archive/M99.md": planFile("M99", [
        ["Follow-ups carried out of M99", proseLines(1100, "o")],
      ]),
    });
    try {
      const dog = dogfoodTree(fx.root);
      try {
        expect(dog.source).toBe("archive");
        expect(dog.files).toEqual([`${DOGFOOD_MILESTONE}.md`]);
        const measured = measure(dog.root);
        // The fallback really measures — it is live code, not dead prose.
        expect(measured.map((m) => m.section)).toEqual([
          "FRs",
          "Tasks",
          "Dependency graph",
        ]);
        expect(new Set(measured.map((m) => m.kind))).toEqual(
          new Set(["structural", "narrative"]),
        );
        expect(scan(dog.root)).toEqual([]);
      } finally {
        dog.cleanup();
      }
    } finally {
      fx.cleanup();
    }
  });

  test("SENTINEL — both trees empty resolves to `none`, which every dogfood refuses", () => {
    const fx = makeTree({ "README.md": "no plans here\n" });
    try {
      expect(dogfoodTree(fx.root).source).toBe("none");
    } finally {
      fx.cleanup();
    }
  });
});

// ================================================================ AC-STE-535.9

describe("AC-STE-535.9 — mutation-verified, each mutation asserted to have APPLIED", () => {
  test("MUTATION 1 — inverting the classifier turns AC-STE-535.2's assertion red", () => {
    const inverted: Classify = (body) =>
      classify(body) === "structural" ? "narrative" : "structural";

    // AC-STE-535.2's subject: a checkbox-item-majority body.
    const body = twoLineTasks(12);

    // The mutation APPLIED — the mutant disagrees with the shipped classifier
    // on the very body under test. (A mutation that never applied reads as a
    // pass; this repository has been bitten by exactly that.)
    expect(classify(body)).toBe("structural");
    expect(inverted(body)).toBe("narrative");
    expect(inverted(body)).not.toBe(classify(body));

    // AC-STE-535.2's assertion, re-run under the mutant: it is now red.
    expect(inverted(body)).not.toBe("structural");

    // And it reaches the SCAN: the shipped classifier's silence over a 346-word
    // checkbox body is a measurement, not a stub.
    const content = planFile("M912", [["Tasks", body]]);
    const fx = makeTree({ "specs/plan/M912.md": content });
    try {
      expect(countWords(body)).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
      expect(scan(fx.root)).toEqual([]);
      const mutated = scan(fx.root, inverted);
      expect(mutated).toHaveLength(1);
      expect(mutated[0]!.section).toBe("Tasks");
      expect(mutated[0]!.rule).toBe("word_cap");
    } finally {
      fx.cleanup();
    }
  });

  test("MUTATION 2 — a heading-branching classifier turns AC-STE-535.7's assertion red", () => {
    // AC-STE-535.7's assertion, expressed over a classifier that MAY see the
    // heading: one body, two headings, verdicts compared for equality.
    type HeadingAware = (body: readonly string[], heading: string) => Kind;
    const equalUnderTwoHeadings = (f: HeadingAware, body: string[]): boolean =>
      f(body, "Tasks") === f(body, "Ruminations");

    // The shipped classifier ignores the heading because it never receives it.
    const shipped: HeadingAware = (body) => classify(body);
    // The mutant branches on the name — the evasion the FR exists to forbid.
    const headingAware: HeadingAware = (body, heading) =>
      heading === "Tasks" ? "structural" : classify(body);

    const body = proseLines(400, "d"); // narrative by body, called "Tasks"

    // The mutation APPLIED — the mutant's verdicts differ across headings for
    // this body, and it disagrees with the shipped function under "Tasks".
    expect(headingAware(body, "Tasks")).toBe("structural");
    expect(headingAware(body, "Ruminations")).toBe("narrative");
    expect(headingAware(body, "Tasks")).not.toBe(shipped(body, "Tasks"));

    // AC-STE-535.7's assertion holds for the shipped classifier ...
    expect(equalUnderTwoHeadings(shipped, body)).toBe(true);
    // ... and is RED under the mutant.
    expect(equalUnderTwoHeadings(headingAware, body)).toBe(false);
  });

  test("MUTATION 3 — a bare-LINE checkbox ratio turns AC-STE-535.2a's assertion red", () => {
    // The definition STE-535 rejects, implemented honestly: count checkbox
    // LINES rather than items. Everything else defers to the shipped
    // classifier, so the mutation is exactly the counting rule.
    const bareLine: Classify = (body) =>
      body.some((l) => CHECKBOX_LINE_RE.test(l))
        ? bareLineCheckboxRatio(body) > CHECKBOX_ITEM_MAJORITY
          ? "structural"
          : "narrative"
        : classify(body);

    const body = twoLineTasks(12);

    // The mutation APPLIED on the discriminating body.
    expect(bareLineCheckboxRatio(body)).toBe(0.5);
    expect(bareLine(body)).toBe("narrative");
    expect(bareLine(body)).not.toBe(classify(body));

    // AC-STE-535.2a's assertion is red under it, and the plan's own Tasks
    // section would fire a violation it must not.
    expect(bareLine(body)).not.toBe("structural");
    const content = planFile("M913", [["Tasks", body]]);
    const fx = makeTree({ "specs/plan/M913.md": content });
    try {
      expect(scan(fx.root)).toEqual([]);
      expect(scan(fx.root, bareLine)).toHaveLength(1);
    } finally {
      fx.cleanup();
    }
  });
});

// ============================================================================
// STE-535 Technical Design — "The plan and FR scanners report through one
// violation type so probe #67 renders both without a second code path."
//
// MEASURED DEFECT (guarded grep, control + target run identically):
// `scanPlanNarrativeAltitude` has NO production consumer anywhere in the
// plugin tree. It is imported only by THIS test file. Probe #67's registration
// in `skills/gate-check/SKILL.md` names `scanFrSummaryAltitude(projectRoot)`
// and `adapters/_shared/src/scan_fr_summary_altitude.ts` and says nothing at
// all about plans — so every one of the 41 assertions above measures a module
// that the gate never runs. The whole FR ships INERT.
//
// This repository has twice shipped a headline feature that could never fire
// for exactly this reason (`captureSkipBaseline`, zero production callers;
// M132's headline feature, same shape). Both times the sentence that excused
// it was "by design, a later FR consumes it". So the wiring is asserted HERE,
// in the same commit as the scanner, and it is asserted by a REUSABLE guard
// rather than by a one-off grep, because the class recurs.
//
// Everything numeric below is anchored on the SHIPPED exported constants
// (`PLAN_NARRATIVE_WORD_CAP`, `CHECKBOX_ITEM_MAJORITY`, the parsed `RuleName`
// union, the NFR-1 cap read out of its own enforcing test) rather than on a
// hand-typed literal — the idiom `tests/m137-ste-534-fr-word-caps.test.ts`
// established, reused verbatim.
// ============================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const NFR1_TEST_SRC = join(PLUGIN_ROOT, "tests", "skill-nfr-1-length.test.ts");
const FR_SCANNER_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "scan_fr_summary_altitude.ts",
);

/** Plugin-root-relative, POSIX separators — the vocabulary the guard speaks. */
const PLAN_SCANNER_REL = "adapters/_shared/src/scan_plan_narrative_altitude.ts";
const FR_SCANNER_REL = "adapters/_shared/src/scan_fr_summary_altitude.ts";

// ------------------------------------------------ the REUSABLE consumer guard
//
// A module under `adapters/_shared/src/` whose only referents are test files is
// a defect: it cannot fire in production, so every test over it is measuring
// nothing that ships. The guard answers one question for ANY module — "which
// NON-TEST files reference it?" — and was written here to be pointed at a second
// module by a later FR without modification. STE-533 is that later FR, so the
// guard moved to `tests/_module_consumers.ts` and BOTH suites read it from there;
// a second private copy would be the two-renderers defect this repo has recorded.
//
// The trap it exists to avoid is still pinned below: classify by FILE PATH, never
// by line content, because probe #67's registration line ENDS with a
// "Test coverage: `tests/<name>.test.ts`" footer and a content filter deletes it.

// ------------------------------------------------------- probe #67 registration

/** The `67. **`fr_summary_altitude`** — …` registration line, verbatim. */
function probe67Entry(): string {
  const skill = readFileSync(GATE_CHECK_SKILL, "utf-8");
  const entry = skill
    .split("\n")
    .find((l) => l.startsWith(`67. **\`${PROBE_ID}\`**`));
  expect(entry).toBeDefined();
  return entry!;
}

/**
 * The PLAN half of probe #67's entry: everything from the first mention of the
 * plan scanner to the end of the line. Reading a WINDOW rather than the whole
 * entry is deliberate — the FR half already says "archive/ excluded", "table",
 * "code fences" and "heading text", so a whole-line search would read the FR
 * half's words as if they described plans. Returns "" when the entry never
 * names the plan scanner at all, which every claim below then reports as a gap
 * rather than silently passing.
 */
function planHalf(entry: string): string {
  // The optional leading path segment matters: when the module PATH is the
  // first mention, anchoring on the bare stem would slice the window open in
  // the MIDDLE of the path, and the `module_path` claim could then never be
  // satisfied by a well-written entry.
  const at = entry.search(
    /(?:[\w./_-]*\/)?scan_plan_narrative_altitude|scanPlanNarrativeAltitude/,
  );
  if (at < 0) return "";
  // The trailing `Test coverage: …` footer is the entry's bibliography, not a
  // claim about plans, and it names test FILES whose names carry digits
  // ("m137-ste-534-fr-word-caps"). Measured: leaving it inside the window made
  // the "the only word count stated is the cap" assertion UNSATISFIABLE — it
  // read 534 out of a filename. The window stops before it.
  const half = entry.slice(at);
  const footer = half.search(/\s*Test coverage:/);
  return footer < 0 ? half : half.slice(0, footer);
}

/**
 * The claims probe #67's plan half MUST make, each keyed by id so a failure
 * names which claim is missing. Numbers come from the shipped constants.
 */
function planProseClaims(): [string, RegExp][] {
  const cap = PLAN_NARRATIVE_WORD_CAP;
  const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
  return [
    ["module_path", new RegExp(PLAN_SCANNER_REL.replace(/[./]/g, "\\$&"))],
    ["entry_point", /scanPlanNarrativeAltitude\(projectRoot\)/],
    ["word_cap", new RegExp(`\\b${cap}\\b[^.]{0,40}\\bwords?\\b`, "i")],
    ["by_kind", /\bkinds?\b/i],
    [
      "not_by_heading_name",
      /(?:not|never|regardless of|whatever|rather than)[^.]{0,90}\bheading\b|\bheading\b[^.]{0,90}(?:is not|are not|never|does not|do not|is irrelevant|plays no)/i,
    ],
    // The checkbox kind and its threshold are ONE claim on purpose: a separate
    // /checkbox/i probe would be satisfied by this very sentence, so dropping
    // it in the isolation harness below could never turn anything red.
    ["kind_checkbox_majority", new RegExp(`\\b${pct}\\s*(?:%|percent)[^.]{0,40}checkbox`, "i")],
    ["kind_table", /table/i],
    ["kind_fence", /fenc/i],
    ["active_scope", /specs\/plan\//],
    [
      "archive_excluded",
      /archive\/?[^.]{0,80}(?:excluded|never|not scanned|frozen|untouched)|(?:excluded|never|not|frozen)[^.]{0,80}archive/i,
    ],
  ];
}

/** The claim ids the plan half fails to make. */
function planProseGaps(half: string): string[] {
  return planProseClaims()
    .filter(([, re]) => !re.test(half))
    .map(([id]) => id);
}

// ------------------------------------------- one violation TYPE, not two copies

interface ViolationTypeBinding {
  /** The plan module imports the FR scanner's violation type. */
  importsFrType: boolean;
  /** The plan module declares its OWN interface body — a drift-free copy. */
  declaresLocalInterface: boolean;
  /** `PlanNarrativeViolation` resolves to the imported FR type. */
  aliasesFrType: boolean;
}

const IMPORTS_FR_TYPE_RE =
  /import\s+(?:type\s+)?\{[^}]*\bFrSummaryAltitudeViolation\b[^}]*\}\s*from\s*["'][^"']*scan_fr_summary_altitude(?:\.ts)?["']/;
const LOCAL_INTERFACE_RE = /(?:export\s+)?interface\s+PlanNarrativeViolation\s*\{/;
const ALIAS_RE =
  /export\s+type\s+PlanNarrativeViolation\s*=\s*FrSummaryAltitudeViolation\s*;|export\s+type\s*\{[^}]*\bFrSummaryAltitudeViolation\s+as\s+PlanNarrativeViolation\b[^}]*\}/;

/** How the plan module obtains `PlanNarrativeViolation`, read from its source. */
function violationTypeBinding(src: string): ViolationTypeBinding {
  return {
    importsFrType: IMPORTS_FR_TYPE_RE.test(src),
    declaresLocalInterface: LOCAL_INTERFACE_RE.test(src),
    aliasesFrType: ALIAS_RE.test(src),
  };
}

/** The FR scanner's closed rule union, parsed from its SHIPPED source. */
function frRuleUnion(): string[] {
  const src = readFileSync(FR_SCANNER_SRC, "utf-8");
  const decl = /export type RuleName\s*=\s*([^;]+);/.exec(src);
  expect(decl).not.toBeNull();
  const members = [...decl![1]!.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]!);
  expect(members.length).toBeGreaterThan(0);
  return members;
}

/** An active FR whose `## Summary` overruns the shipped 80-word cap. */
function overCapFrFile(id: string, body: string[]): string {
  return [
    "---",
    `title: "Fixture ${id}"`,
    "status: active",
    "milestone: M137",
    "---",
    "",
    `# ${id}: Fixture`,
    "",
    "## Summary",
    "",
    ...body,
    "",
  ].join("\n") + "\n";
}

// ================================================ WIRING — a production consumer

describe("STE-535 wiring — the plan scanner has a PRODUCTION consumer", () => {
  test("POSITIVE CONTROL — the FR scanner's non-test consumer is probe #67's registration", () => {
    // If this ever reports zero, the guard is broken, not the tree — which is
    // the whole reason the control runs beside the target.
    const files = consumerFiles(FR_SCANNER_REL);
    expect(files).toContain("skills/gate-check/SKILL.md");
    expect(files.length).toBeGreaterThan(0);
  });

  test("the guard classifies by PATH — a consumer line that MENTIONS a .test.ts still counts", () => {
    // The measured trap: probe #67's registration line ends with
    // "Test coverage: `tests/<name>.test.ts`", so a content filter deletes it and
    // reports the FR scanner as consumer-less.
    const refs = nonTestConsumers(FR_SCANNER_REL).filter(
      (r) => r.file === "skills/gate-check/SKILL.md",
    );
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => r.text.includes(".test.ts"))).toBe(true);
  });

  test("TARGET — `scan_plan_narrative_altitude.ts` is referenced by at least one NON-TEST file", () => {
    const refs = nonTestConsumers(PLAN_SCANNER_REL);
    // RED today: the module is imported by this test file and by nothing else.
    expect(refs.map((r) => r.file)).not.toEqual([]);
    expect(consumerFiles(PLAN_SCANNER_REL)).toContain("skills/gate-check/SKILL.md");
  });

  test("probe #67's entry names the plan scanner's FUNCTION and its MODULE PATH", () => {
    const entry = probe67Entry();
    // The same two things it already names for the FR half — same shape, one
    // entry, no second probe.
    expect(entry).toContain("scanPlanNarrativeAltitude(projectRoot)");
    expect(entry).toContain(PLAN_SCANNER_REL);
  });

  test("probe #67's `Test coverage:` footer names THIS suite", () => {
    // The footer is the entry's bibliography; a probe that gained a half
    // without gaining its tests in the footer is half-registered.
    const entry = probe67Entry();
    expect(entry).toContain("Test coverage:");
    expect(entry).toContain(basename(import.meta.file ?? import.meta.path));
  });

  test("FALSIFIABLE — a module referenced ONLY by a test file reports zero consumers", () => {
    const fx = makeTree({
      "src/thing.ts": "// src/thing.ts — names itself in its own header\nexport const thing = 1;\n",
      "tests/thing.test.ts": 'import { thing } from "../src/thing";\n',
    });
    try {
      // Self-reference excluded, test importer excluded => genuinely zero.
      expect(nonTestConsumers("src/thing.ts", fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("FALSIFIABLE — adding ONE non-test referent flips the same guard to non-empty", () => {
    const fx = makeTree({
      "src/thing.ts": "export const thing = 1;\n",
      "tests/thing.test.ts": 'import { thing } from "../src/thing";\n',
      "skills/demo/SKILL.md":
        "call `thing()` from `src/thing.ts`. Test coverage: `tests/thing.test.ts`.\n",
    });
    try {
      const refs = nonTestConsumers("src/thing.ts", fx.root);
      expect(refs.map((r) => r.file)).toEqual(["skills/demo/SKILL.md"]);
      // …and the one line it found mentions a .test.ts, proving once more the
      // classification is by path.
      expect(refs[0]!.text).toContain("tests/thing.test.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("FALSIFIABLE — a sibling under `tests/` never counts, however it is named", () => {
    const fx = makeTree({
      "src/thing.ts": "export const thing = 1;\n",
      "tests/helpers/uses-thing.ts": 'import "../../src/thing";\n',
      "src/deep/__tests__/thing.spec.ts": 'import "../../thing";\n',
    });
    try {
      expect(nonTestConsumers("src/thing.ts", fx.root)).toEqual([]);
      // Non-vacuity: the walk DID see those files.
      expect(walkTextFiles(fx.root)).toEqual([
        "src/deep/__tests__/thing.spec.ts",
        "src/thing.ts",
        "tests/helpers/uses-thing.ts",
      ]);
    } finally {
      fx.cleanup();
    }
  });
});

// ================================== probe #67's PLAN half describes plans truly

describe("STE-535 wiring — probe #67's prose describes the PLAN half truthfully", () => {
  test("the plan half states every required claim", () => {
    // Reported as a LIST of missing claim ids, so a failure names what is
    // absent rather than saying only "no match".
    expect(planProseGaps(planHalf(probe67Entry()))).toEqual([]);
  });

  test("the word cap it states is the SHIPPED constant, not a hand-typed 150", () => {
    const half = planHalf(probe67Entry());
    expect(half).toMatch(new RegExp(`\\b${PLAN_NARRATIVE_WORD_CAP}\\b`));
    // A stale neighbour number would be the tell: the cap must be the only
    // three-digit word-count claim in the plan half.
    // Immediate adjacency only ("150 words" / "150-word"): a looser window
    // reads digits out of neighbouring filenames and identifiers.
    const counts = [...half.matchAll(/\b(\d{2,4})[ -]words?\b/gi)].map((m) =>
      Number(m[1]),
    );
    expect(counts.length).toBeGreaterThan(0);
    expect([...new Set(counts)]).toEqual([PLAN_NARRATIVE_WORD_CAP]);
  });

  test("the majority threshold it states is the SHIPPED constant as a percentage", () => {
    const half = planHalf(probe67Entry());
    const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
    expect(half).toMatch(new RegExp(`\\b${pct}\\s*(?:%|percent)`, "i"));
  });

  test("NON-VACUITY — the plan half is not empty", () => {
    // Every claim regex above is run over the half; an empty half would make
    // "all claims present" impossible, but this says so directly.
    expect(planHalf(probe67Entry()).length).toBeGreaterThan(0);
  });

  test("FALSIFIABLE — prose that makes every claim reports no gaps", () => {
    const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
    const complete =
      `scanPlanNarrativeAltitude(projectRoot) from \`${PLAN_SCANNER_REL}\` walks the ` +
      "ACTIVE plans only (`specs/plan/*.md`, non-recursive — `specs/plan/archive/` is " +
      "frozen history and is excluded) and classifies every level-3 subsection by the " +
      "KIND of its body, never by its heading text, so renaming a heading changes " +
      `nothing; the three structural kinds are exempt — a body more than ${pct} percent ` +
      "checkbox ITEMS, a markdown table (header row plus delimiter row), and fenced " +
      `code — and a narrative subsection is capped at ${PLAN_NARRATIVE_WORD_CAP} words.`;
    expect(planProseGaps(planHalf(complete))).toEqual([]);
  });

  test("FALSIFIABLE — each claim is independently detectable when dropped", () => {
    // Isolation is only half the test: a claim regex must also FAIL on prose
    // that omits exactly it. Every claim is dropped one at a time.
    const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
    const fragments: Record<string, string> = {
      module_path: `\`${PLAN_SCANNER_REL}\``,
      entry_point: "scanPlanNarrativeAltitude(projectRoot)",
      word_cap: `capped at ${PLAN_NARRATIVE_WORD_CAP} words`,
      by_kind: "classified by the KIND of its body",
      not_by_heading_name: "never by its heading text",
      kind_checkbox_majority: `more than ${pct} percent checkbox ITEMS`,
      kind_table: "a markdown table",
      kind_fence: "fenced code",
      active_scope: "over `specs/plan/*.md`",
      // Deliberately does NOT restate `specs/plan/`: the isolation harness
      // below drops one fragment at a time, and a fragment that repeats
      // another claim's evidence makes that other claim undroppable.
      archive_excluded: "the archive tree is excluded",
    };
    const ids = planProseClaims().map(([id]) => id);
    // The fragment table must cover the claim table exactly, or a claim could
    // go untested here without anyone noticing.
    expect(Object.keys(fragments).sort()).toEqual([...ids].sort());

    const join_ = (keys: string[]): string =>
      keys.map((k) => fragments[k]!).join("; ") + ".";
    // Whole set first: with every fragment present there are no gaps.
    expect(planProseGaps(planHalf(join_(ids)))).toEqual([]);
    for (const dropped of ids) {
      const prose = join_(ids.filter((k) => k !== dropped));
      expect([dropped, planProseGaps(planHalf(prose)).includes(dropped)]).toEqual([
        dropped,
        true,
      ]);
    }
  });

  test("FALSIFIABLE — a plan half that never names the scanner reports EVERY claim missing", () => {
    const entry = `67. **\`${PROBE_ID}\`** — the FR half only, no plans here.`;
    expect(planHalf(entry)).toBe("");
    expect(planProseGaps(planHalf(entry)).sort()).toEqual(
      planProseClaims().map(([id]) => id).sort(),
    );
  });
});

// ==================================== ONE violation type, not two look-alikes

describe("STE-535 wiring — the two scanners report through ONE violation type", () => {
  test("STRUCTURAL — the plan module IMPORTS the FR scanner's violation type", () => {
    const binding = violationTypeBinding(readFileSync(SCANNER_SRC, "utf-8"));
    // RED today: the plan module declares its own look-alike interface.
    expect(binding.importsFrType).toBe(true);
  });

  test("STRUCTURAL — the plan module declares NO local copy of the violation shape", () => {
    // A second interface free to drift from the first is the two-renderers
    // defect this repository has already recorded once.
    expect(
      violationTypeBinding(readFileSync(SCANNER_SRC, "utf-8")).declaresLocalInterface,
    ).toBe(false);
  });

  test("STRUCTURAL — `PlanNarrativeViolation` RESOLVES to the imported FR type", () => {
    expect(
      violationTypeBinding(readFileSync(SCANNER_SRC, "utf-8")).aliasesFrType,
    ).toBe(true);
  });

  test("BY SHAPE — a real plan violation carries exactly a real FR violation's fields", () => {
    const planContent = planFile("M960", [["Rollout notes", proseLines(180, "u")]]);
    const planFx = makeTree({ "specs/plan/M960.md": planContent });
    const frFx = makeTree({
      "specs/frs/STE-960.md": overCapFrFile("STE-960", proseLines(100, "v")),
    });
    try {
      const planViolations = scan(planFx.root);
      const frViolations = scanFrSummaryAltitude(frFx.root).filter(
        (v) => v.rule === "word_cap",
      );
      // Non-vacuity on BOTH sides — two empty arrays would compare equal.
      expect(planViolations.length).toBeGreaterThan(0);
      expect(frViolations.length).toBeGreaterThan(0);
      expect(Object.keys(planViolations[0]!).sort()).toEqual(
        Object.keys(frViolations[0]! as unknown as Record<string, unknown>).sort(),
      );
    } finally {
      planFx.cleanup();
      frFx.cleanup();
    }
  });

  test("BY SHAPE — the plan scanner's `rule` is a member of the FR scanner's closed union", () => {
    const union = frRuleUnion();
    const content = planFile("M961", [["Rollout notes", proseLines(180, "w")]]);
    const fx = makeTree({ "specs/plan/M961.md": content });
    try {
      const violations = scan(fx.root);
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) expect(union).toContain(v.rule);
    } finally {
      fx.cleanup();
    }
  });

  test("FALSIFIABLE — the structural read tells an import apart from a local copy", () => {
    const imported = [
      'import type { FrSummaryAltitudeViolation } from "./scan_fr_summary_altitude";',
      "export type PlanNarrativeViolation = FrSummaryAltitudeViolation;",
    ].join("\n");
    expect(violationTypeBinding(imported)).toEqual({
      importsFrType: true,
      declaresLocalInterface: false,
      aliasesFrType: true,
    });

    const copied = [
      "export interface PlanNarrativeViolation {",
      "  file: string;",
      "  line: number;",
      '  rule: "word_cap";',
      "  section: string;",
      "}",
    ].join("\n");
    expect(violationTypeBinding(copied)).toEqual({
      importsFrType: false,
      declaresLocalInterface: true,
      aliasesFrType: false,
    });

    // The nastiest near-miss: the type IS imported, and a look-alike interface
    // is declared anyway. Structurally identical shapes today, free to drift
    // tomorrow — caught by the local-copy leg, not by the import leg.
    const both = `${imported}\n${copied}`;
    expect(violationTypeBinding(both).importsFrType).toBe(true);
    expect(violationTypeBinding(both).declaresLocalInterface).toBe(true);
  });
});

// ============================== the pins this repair is FORBIDDEN to move

describe("STE-535 wiring — probe id, severity and NFR-1 cap are UNMOVED", () => {
  test("probe #67 keeps its id and its error severity", () => {
    // The plan rule joins probe #67 rather than minting one of its own, so
    // the id and severity do not move. (#82 is STE-533's, a different FR.)
    expect(PROBE_ID).toBe("fr_summary_altitude");
    const entry = probe67Entry();
    expect(entry).toContain("**Severity: error.**");
    expect(entry).toContain("scanFrSummaryAltitude(projectRoot)");
    expect(entry).toContain(FR_SCANNER_REL);
  });

  test("STE-535 minted no probe id of its own — the list ends where #82 left it", () => {
    const skill = readFileSync(GATE_CHECK_SKILL, "utf-8");
    const numbers = [...skill.matchAll(/^(\d+)\. \*\*`/gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThan(0);
    expect(Math.max(...numbers)).toBe(82);
  });

  test("README advertises the live count — 82 since STE-533 landed probe #82", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("82 numbered `/gate-check` probes");
    expect(readme).not.toMatch(/\b81\b numbered `\/gate-check` probes/);
  });

  test("NFR-1 — gate-check/SKILL.md stays at or under the cap its own test enforces", () => {
    // The cap is read from the enforcing test rather than retyped, so this
    // assertion cannot disagree with the gate.
    const capDecl = /const SKILL_LINE_CAP\s*=\s*(\d+);/.exec(
      readFileSync(NFR1_TEST_SRC, "utf-8"),
    );
    expect(capDecl).not.toBeNull();
    const cap = Number(capDecl![1]);
    expect(cap).toBeGreaterThan(0);

    // Measured the same way the enforcing test measures it.
    const lines = readFileSync(GATE_CHECK_SKILL, "utf-8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(cap);

    // Probe #67's entry is ONE long line, and the plan half must be edited
    // INTO it: expanding it into new lines is what would breach the cap.
    const entry = probe67Entry();
    expect(entry.split("\n")).toHaveLength(1);
  });

  test("the gate-check skill file is a real file, not a directory or a symlink target", () => {
    // Guards the three assertions above against a silently-empty read.
    expect(statSync(GATE_CHECK_SKILL).isFile()).toBe(true);
    expect(readFileSync(GATE_CHECK_SKILL, "utf-8").length).toBeGreaterThan(0);
  });
});

// ============================================================================
// GAP 1 — the MIXED-KIND rule, pinned directly.
//
// Probe #67's plan half and STE-535's Requirement line both describe THREE
// INDEPENDENT kind exemptions ("checkbox-majority, markdown table, and fenced
// code"). The shipped rule is ONE COMBINED RATIO: (code + table + item) over
// content lines, strictly greater than `CHECKBOX_ITEM_MAJORITY`. The FR's
// Technical Design settles which side is right — "A subsection that is half
// prose and half checklist is narrative, because the prose half is the part
// that grows" — so the BEHAVIOUR is correct and the PROSE is loose.
//
// The scanner's own header comment already words the rule correctly:
//
//   "A body more than CHECKBOX_ITEM_MAJORITY structural (code + table + item)
//    is structural and exempt; anything else is narrative and capped at
//    PLAN_NARRATIVE_WORD_CAP."
//
// The two directions below are the ones that make the divergence visible, and
// they are asserted rather than assumed. Neither is reachable from the
// three-independent-exemptions reading.
// ============================================================================

/** A four-line markdown table: header, delimiter, two rows. */
const MIXED_TABLE_ROWS = [
  "| FR | Title |",
  "|----|-------|",
  "| STE-535 | Plan narrative is capped by section kind |",
  "| STE-536 | Authoring surfaces state the budgets |",
];

/** A four-line fenced block: opener, two body lines, closer. */
const MIXED_FENCE_LINES = [
  "```sh",
  "cd plugins/dev-process-toolkit && bun test",
  "bun test tests/m137-ste-535-plan-narrative-cap.test.ts",
  "```",
];

/** Non-blank lines of a body — the denominator the shipped ratio divides by. */
const contentLines = (body: readonly string[]): string[] =>
  body.filter((l) => l.trim() !== "");

describe("GAP 1 — the exemption is ONE combined structural share, not three independent clauses", () => {
  test("DIRECTION A — a whole markdown table under a prose caption is NARRATIVE (4 of 7 lines)", () => {
    // The categorical reading says "a markdown table is structural, full stop",
    // and this body IS a whole, unbroken markdown table — plus three lines of
    // caption. Under the shipped combined ratio it is 4/7 = 57%, below the
    // threshold, so it is narrative. Whichever side one prefers, the surfaces
    // must not promise the other one.
    const caption = proseLines(180, "ca", 60);
    const body = [...caption, ...MIXED_TABLE_ROWS];

    // The measurement, recomputed here so the arithmetic is on the record.
    expect(caption).toHaveLength(3);
    expect(contentLines(body)).toHaveLength(7);
    expect(4 / 7).toBeLessThan(CHECKBOX_ITEM_MAJORITY);

    // The table clause in isolation really does exempt — so the narrative
    // verdict below is the COMBINED ratio talking, not a broken table reader.
    expect(classify(MIXED_TABLE_ROWS)).toBe("structural");
    expect(classify(body)).toBe("narrative");
  });

  test("DIRECTION A — and it violates through the SCANNER, table and all", () => {
    const body = [...proseLines(180, "cb", 60), ...MIXED_TABLE_ROWS];
    expect(countWords(body)).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
    const content = planFile("M920", [["Rollout table", body]]);
    const fx = makeTree({ "specs/plan/M920.md": content });
    try {
      const violations = bySection(scan(fx.root), "Rollout table");
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule).toBe("word_cap");
      expect(kindOf(measure(fx.root), "Rollout table")).toBe("narrative");
    } finally {
      fx.cleanup();
    }
  });

  test("DIRECTION B — table lines plus fence lines and ZERO checkboxes is STRUCTURAL (8 of 8)", () => {
    // The mirror image: this body matches no single categorical clause. It is
    // not checkbox-majority (it holds no checkbox at all), it is not a table
    // (half of it is a fence), and it is not fenced code (half of it is a
    // table). Under the three-independent reading it is exempt by nothing.
    // Under the shipped combined ratio it is 8/8 = 100% structural.
    const body = [...MIXED_TABLE_ROWS, ...MIXED_FENCE_LINES];
    expect(contentLines(body)).toHaveLength(8);
    expect(bareLineCheckboxRatio(body)).toBe(0);
    expect(body.some((l) => CHECKBOX_LINE_RE.test(l))).toBe(false);
    expect(8 / 8).toBeGreaterThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(body)).toBe("structural");
  });

  test("DIRECTION B — and the SCANNER stays silent over it well past the cap", () => {
    const body = [
      ...MIXED_TABLE_ROWS,
      "```text",
      ...proseLines(300, "cc", 30),
      "```",
    ];
    expect(body.some((l) => CHECKBOX_LINE_RE.test(l))).toBe(false);
    expect(countWords(body)).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
    expect(classify(body)).toBe("structural");

    const content = planFile("M921", [["Gate and FRs", body]]);
    const fx = makeTree({ "specs/plan/M921.md": content });
    try {
      expect(scan(fx.root)).toEqual([]);
      expect(kindOf(measure(fx.root), "Gate and FRs")).toBe("structural");
    } finally {
      fx.cleanup();
    }
  });

  test("THE RATIO IS COMBINED — kinds ADD UP: neither half alone clears the threshold, together they do", () => {
    // Three prose lines against four table lines is 4/7 (narrative, direction
    // A). Add four fence lines and the SAME prose is outvoted: 8/11 = 73%.
    // Nothing about the table changed; only the total structural share did.
    const caption = proseLines(180, "cd", 60);
    const tableOnly = [...caption, ...MIXED_TABLE_ROWS];
    const tableAndFence = [...caption, ...MIXED_TABLE_ROWS, ...MIXED_FENCE_LINES];

    expect(contentLines(tableOnly)).toHaveLength(7);
    expect(contentLines(tableAndFence)).toHaveLength(11);
    expect(4 / 7).toBeLessThan(CHECKBOX_ITEM_MAJORITY);
    expect(8 / 11).toBeGreaterThan(CHECKBOX_ITEM_MAJORITY);

    expect(classify(tableOnly)).toBe("narrative");
    expect(classify(tableAndFence)).toBe("structural");
  });

  test("THE RATIO IS COMBINED — checkbox items add to the same share, they do not own a clause", () => {
    // Two single-line checkboxes and three prose lines is 2/5 = 40%: narrative,
    // even though checkboxes are present. Swap one prose line for one fence
    // line pair and the share crosses without a single checkbox being added.
    const withProse = [...singleLineTasks(2, 3)];
    expect(contentLines(withProse)).toHaveLength(5);
    expect(2 / 5).toBeLessThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(withProse)).toBe("narrative");

    const withFence = [...singleLineTasks(2, 1), ...MIXED_FENCE_LINES];
    expect(contentLines(withFence)).toHaveLength(7);
    expect(6 / 7).toBeGreaterThan(CHECKBOX_ITEM_MAJORITY);
    expect(classify(withFence)).toBe("structural");
  });
});

// ------------------------------------ the prose that must state that rule

/**
 * A marker that the three kinds are counted TOGETHER rather than severally.
 * `code + table + item` is the scanner header's own wording, admitted verbatim.
 */
const COMBINED_KINDS_RE =
  /\b(?:combined|together|jointly|aggregate|in total|added up|sum(?:med)?)\b|\bcode\s*\+\s*table\s*\+\s*item\b/i;

/** Sentences of `text`, split only where a period is followed by a new one. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=\.)\s+(?=[A-Z(`])/);
}

/**
 * The claims the plan half must make about the exemption RULE, keyed by id so a
 * failure names which is missing. Deliberately kept OUT of `planProseClaims()`:
 * that table is asserted claim-by-claim in an isolation harness whose fragment
 * map must match it exactly, and this rule is one the current prose fails.
 */
function combinedShareGaps(text: string): string[] {
  const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
  const thresholdRe = new RegExp(`\\b${pct}\\s*(?:%|percent)`, "i");
  const stating = sentencesOf(text).filter((s) => thresholdRe.test(s));
  if (stating.length === 0) return ["threshold_absent"];
  const gaps: string[] = [];
  if (!stating.some((s) => COMBINED_KINDS_RE.test(s))) gaps.push("combination_absent");
  if (!stating.some((s) => /\bstructural\b/i.test(s))) gaps.push("structural_share_absent");
  return gaps;
}

/** The same claim for prose that spells its numbers out, e.g. an FR body. */
function statesCombinedExemption(text: string): boolean {
  return sentencesOf(text)
    .filter((s) => /\btable\b/i.test(s) && /fenc/i.test(s))
    .some((s) => COMBINED_KINDS_RE.test(s));
}

/** A truthful plan half: every existing claim, plus the combined-share rule. */
function truthfulPlanHalf(): string {
  const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
  return (
    `scanPlanNarrativeAltitude(projectRoot) from \`${PLAN_SCANNER_REL}\` walks the ` +
    "ACTIVE plans only (`specs/plan/*.md`, non-recursive — `specs/plan/archive/` is " +
    "frozen history and is excluded) and classifies every level-3 subsection by the " +
    "KIND of its body, never by its heading text. " +
    "The exemption is ONE combined share rather than three independent clauses: a body " +
    `more than ${pct}% checkbox items, table rows and fenced-code lines counted together ` +
    "— its combined structural share — is exempt, and anything else is narrative and " +
    `capped at ${PLAN_NARRATIVE_WORD_CAP} words.`
  );
}

/** `specs/frs/<id>.md`, or its archived twin, with which path supplied it. */
function frFile(id: string): { abs: string; source: PlanSource; text: string } {
  const active = join(REPO_ROOT, "specs", "frs", `${id}.md`);
  if (existsSync(active)) {
    return { abs: active, source: "active", text: readFileSync(active, "utf-8") };
  }
  const archived = join(REPO_ROOT, "specs", "frs", "archive", `${id}.md`);
  if (existsSync(archived)) {
    return { abs: archived, source: "archive", text: readFileSync(archived, "utf-8") };
  }
  return { abs: "", source: "none", text: "" };
}

/** The body of `## <name>` in an FR file, up to the next level-2 heading. */
function frSection(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##(?!#)\s+/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join(" ").trim();
}

describe("GAP 1 — the shipped PROSE states the combined-share rule it actually implements", () => {
  test("RED UNTIL FIXED — probe #67's plan half states ONE combined structural share", () => {
    // Measured 2026-08-31: the half reads "the three structural kinds are
    // exempt: a body more than 60% checkbox ITEMS …, a markdown table …, and
    // fenced code" — three independent categorical exemptions, which is not
    // what ships. Direction A above is narrative despite being a whole table;
    // direction B is structural while matching no single clause.
    expect(combinedShareGaps(planHalf(probe67Entry()))).toEqual([]);
  });

  test("RED UNTIL FIXED — STE-535's Requirement line states it too", () => {
    // The quiet half: fixing the probe registration alone leaves the FR still
    // promising `exempt by kind: checkbox-majority, markdown table, and fenced
    // code`. Milestone-scoped through the archive the same way the plan subject
    // is, so archiving this FR cannot red the suite.
    const fr = frFile("STE-535");
    expect(fr.source).not.toBe("none");
    const requirement = frSection(fr.text, "Requirement");
    expect([fr.source, requirement.length > 0]).toEqual([fr.source, true]);
    expect([fr.source, statesCombinedExemption(requirement)]).toEqual([fr.source, true]);
  });

  test("FALSIFIABLE — the three-independent phrasing is REPORTED, the combined one is not", () => {
    const pct = Math.round(CHECKBOX_ITEM_MAJORITY * 100);
    const threeClauses =
      `the three structural kinds are exempt: a body more than ${pct}% checkbox ITEMS ` +
      "(items, not bare lines), a markdown table (a row plus its delimiter row), and " +
      "fenced code.";
    expect(combinedShareGaps(threeClauses)).toEqual(["combination_absent"]);

    const combined =
      `a body whose structural share — fenced code, table rows and checkbox items ` +
      `counted together — is more than ${pct}% of its content lines is exempt.`;
    expect(combinedShareGaps(combined)).toEqual([]);

    // The scanner's OWN header wording, the reference this repair copies.
    const headerWording =
      `A body more than ${pct} percent structural (code + table + item) is structural ` +
      "and exempt; anything else is narrative and capped at 150 words.";
    expect(combinedShareGaps(headerWording)).toEqual([]);

    // And prose that never states the threshold at all says so distinctly.
    expect(combinedShareGaps("a subsection is capped at 150 words.")).toEqual([
      "threshold_absent",
    ]);
  });

  test("FALSIFIABLE — the FR-style check separates `exempt by kind` from `counted together`", () => {
    const severally =
      "Structural subsections are exempt by kind: checkbox-majority, markdown table, " +
      "and fenced code.";
    expect(statesCombinedExemption(severally)).toBe(false);

    const together =
      "A subsection is structural when its checkbox items, table rows and fenced code " +
      "lines together make up more than sixty percent of its content lines.";
    expect(statesCombinedExemption(together)).toBe(true);

    // A sentence that names only ONE kind is not the sentence under test, so a
    // stray "together" elsewhere cannot satisfy this.
    expect(
      statesCombinedExemption("Checkbox items and prose are counted together."),
    ).toBe(false);
  });

  test("JOINTLY SATISFIABLE — one wording clears the existing claim table AND the new rule", () => {
    // The trap this closes is a pair of pins nothing can satisfy at once: the
    // repair is only actionable if a single sentence can pass `planProseClaims`
    // and `combinedShareGaps` together. Here is that sentence.
    const half = truthfulPlanHalf();
    expect(planProseGaps(planHalf(half))).toEqual([]);
    expect(combinedShareGaps(planHalf(half))).toEqual([]);
    // …and `planHalf` really did find its window in it.
    expect(planHalf(half).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// GAP 2 — the shared section-walk helper has BOTH scanners as consumers.
//
// STE-535's Technical Design: the two scanners "share a section-walk helper
// rather than each owning a copy". `markdown_section_walk.ts` was extracted at
// REFACTOR and nothing asserted it, so a future copy-back would redden nothing.
// The reusable `nonTestConsumers` guard answers it in one line — and because a
// mere comment mentioning the module satisfies a substring search, the identity
// legs below read the IMPORT STATEMENT and the copy-back tripwire as well.
// ============================================================================

const SHARED_WALK_REL = "adapters/_shared/src/markdown_section_walk.ts";
const SHARED_WALK_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "markdown_section_walk.ts",
);

/** A real `import { … walkSections … } from "…/markdown_section_walk"`. */
const SHARED_WALK_IMPORT_RE =
  /import\s*\{[^}]*\bwalkSections\b[^}]*\}\s*from\s*["'][^"']*markdown_section_walk(?:\.ts)?["']/;
/** A local DEFINITION of the walk — the copy-back this guard exists to catch. */
const LOCAL_WALK_DEFINITION_RE =
  /(?:export\s+)?(?:async\s+)?function\s+(?:walkSections|fencedFlags)\s*\(/;

describe("GAP 2 — the two scanners SHARE one section-walk helper, not two copies", () => {
  test("the shared module exists and both scanners are among its NON-TEST consumers", () => {
    expect(statSync(SHARED_WALK_SRC).isFile()).toBe(true);
    const files = consumerFiles(SHARED_WALK_REL);
    expect(files).toContain(PLAN_SCANNER_REL);
    expect(files).toContain(FR_SCANNER_REL);
  });

  test("BY IDENTITY — each scanner IMPORTS `walkSections` from it (a comment cannot satisfy this)", () => {
    // The substring guard above counts a header comment as a reference. This
    // leg does not: it requires the import statement itself, in each file.
    for (const [rel, abs] of [
      [PLAN_SCANNER_REL, SCANNER_SRC],
      [FR_SCANNER_REL, FR_SCANNER_SRC],
    ] as const) {
      const src = readFileSync(abs, "utf-8");
      expect([rel, SHARED_WALK_IMPORT_RE.test(src)]).toEqual([rel, true]);
    }
  });

  test("BY IDENTITY — neither scanner declares its OWN walk, and the shared module does", () => {
    // The copy-back, stated from both ends: the definition lives in exactly one
    // file, and it is not either scanner.
    const shared = readFileSync(SHARED_WALK_SRC, "utf-8");
    expect(LOCAL_WALK_DEFINITION_RE.test(shared)).toBe(true);
    expect(/export function walkSections\s*\(/.test(shared)).toBe(true);
    for (const [rel, abs] of [
      [PLAN_SCANNER_REL, SCANNER_SRC],
      [FR_SCANNER_REL, FR_SCANNER_SRC],
    ] as const) {
      const src = readFileSync(abs, "utf-8");
      expect([rel, LOCAL_WALK_DEFINITION_RE.test(src)]).toEqual([rel, false]);
    }
  });

  test("BEHAVIOURALLY — the plan scanner's sections are exactly the shared walk's sections", () => {
    // Identity by source text is structural; this ties the two together by
    // OUTPUT, on the input the two walks are most likely to disagree on: a
    // level-3 heading quoted inside a matched fence, and a level-2 heading that
    // closes an open subsection.
    const content = planFile("M922", [
      ["Example", ["```markdown", "### Not A Real Heading", "sample text", "```"]],
      ["Rationale", proseLines(40, "sw")],
    ]);
    const fx = makeTree({ "specs/plan/M922.md": content });
    try {
      const viaScanner = measure(fx.root).map((m) => `${m.section}@${m.line}`);
      const viaShared = walkSections(content.split("\n"), {
        opens: /^###(?!#)\s+(.*?)\s*$/,
        closes: /^#{1,2}(?!#)\s+/,
        fenceAware: true,
      }).map((s) => `${s.heading}@${s.line}`);
      expect(viaScanner.length).toBeGreaterThan(0);
      expect(viaScanner).toEqual(viaShared);
      expect(viaScanner).not.toContain("Not A Real Heading");
    } finally {
      fx.cleanup();
    }
  });

  test("FALSIFIABLE — the import read tells an import apart from a mention", () => {
    expect(
      SHARED_WALK_IMPORT_RE.test(
        "// splitting a file into sections lives in markdown_section_walk.ts\n",
      ),
    ).toBe(false);
    expect(
      SHARED_WALK_IMPORT_RE.test(
        'import {\n  countWords,\n  walkSections,\n} from "./markdown_section_walk";\n',
      ),
    ).toBe(true);
    // A DIFFERENT module's import does not count, however similar the names.
    expect(
      SHARED_WALK_IMPORT_RE.test(
        'import { walkSections } from "./my_own_section_walk";\n',
      ),
    ).toBe(false);
  });

  test("FALSIFIABLE — the copy-back tripwire fires on a file that redeclares the walk", () => {
    const copiedBack =
      'import { countWords } from "./markdown_section_walk";\n' +
      "function walkSections(lines: string[]): unknown[] {\n  return [];\n}\n";
    expect(LOCAL_WALK_DEFINITION_RE.test(copiedBack)).toBe(true);
    // …and the same file no longer imports the walk, so BOTH legs move.
    expect(SHARED_WALK_IMPORT_RE.test(copiedBack)).toBe(false);
  });
});

// ============================================================================
// GAP 3 — `markdown_section_walk.ts` documents a contract nothing enforced:
//
//   "Neither regex may carry the `g` or `y` flag: both make `exec`/`test`
//    stateful across calls, and this walk calls each once per line."
//
// A `g`-flagged opener does not throw and does not fail loudly: `lastIndex`
// survives a successful match, so the NEXT line is tested from the wrong
// offset and a section is silently swallowed into its predecessor's body. The
// flags of the SHIPPED patterns are read out of both scanners' sources, and
// the reader is proved able to report a flagged one.
// ============================================================================

interface WalkPattern {
  /** The scanner file the spec was read from, plugin-root-relative. */
  module: string;
  /** The `SectionWalkSpec` const's name. */
  spec: string;
  /** `opens` or `closes`. */
  axis: "opens" | "closes";
  /** The identifier the axis was bound to, or `<inline>` for a literal. */
  ident: string;
  /** The regex body, without delimiters. */
  source: string;
  /** The regex flags, possibly empty. */
  flags: string;
}

/** Every `opens`/`closes` pattern of every `SectionWalkSpec` declared in `src`. */
function walkSpecPatterns(src: string, module: string): WalkPattern[] {
  const out: WalkPattern[] = [];
  for (const spec of src.matchAll(
    /const\s+([A-Za-z0-9_$]+)\s*:\s*SectionWalkSpec\s*=\s*\{([^}]*)\}/g,
  )) {
    const name = spec[1]!;
    const body = spec[2]!;
    for (const axis of ["opens", "closes"] as const) {
      const bound = new RegExp(`\\b${axis}\\s*:\\s*([^,\\n]+)`).exec(body);
      if (bound === null) continue;
      const value = bound[1]!.trim().replace(/,$/, "");
      if (value === "null" || value === "undefined") continue;
      const inline = /^\/(.+)\/([a-z]*)$/.exec(value);
      if (inline !== null) {
        out.push({
          module,
          spec: name,
          axis,
          ident: "<inline>",
          source: inline[1]!,
          flags: inline[2]!,
        });
        continue;
      }
      const decl = new RegExp(
        `const\\s+${value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*=\\s*/(.+)/([a-z]*)\\s*;`,
      ).exec(src);
      // An unresolvable binding is recorded, never skipped: a silent skip is
      // how a flagged pattern would slip past this guard.
      out.push({
        module,
        spec: name,
        axis,
        ident: value,
        source: decl === null ? "<unresolved>" : decl[1]!,
        flags: decl === null ? "<unresolved>" : decl[2]!,
      });
    }
  }
  return out;
}

/** `<module>:<spec>.<axis>=/…/<flags>` for every pattern carrying `g` or `y`. */
const flaggedPatterns = (patterns: WalkPattern[]): string[] =>
  patterns
    .filter((p) => /[gy]/.test(p.flags))
    .map((p) => `${p.module}:${p.spec}.${p.axis}=/${p.source}/${p.flags}`);

const shippedWalkPatterns = (): WalkPattern[] => [
  ...walkSpecPatterns(readFileSync(SCANNER_SRC, "utf-8"), PLAN_SCANNER_REL),
  ...walkSpecPatterns(readFileSync(FR_SCANNER_SRC, "utf-8"), FR_SCANNER_REL),
];

describe("GAP 3 — no shipped walk pattern carries the `g` or `y` flag", () => {
  test("NON-VACUITY — both scanners' specs are found, with the axes they declare", () => {
    const patterns = shippedWalkPatterns();
    // The plan walk declares both axes; the FR walk declares `closes: null`, so
    // it contributes only `opens`. Asserted, so a spec the reader failed to
    // parse cannot masquerade as a spec with nothing to check.
    expect(patterns.map((p) => `${p.module}|${p.spec}|${p.axis}`)).toEqual([
      `${PLAN_SCANNER_REL}|PLAN_SECTION_WALK|opens`,
      `${PLAN_SCANNER_REL}|PLAN_SECTION_WALK|closes`,
      `${FR_SCANNER_REL}|FR_SECTION_WALK|opens`,
    ]);
    expect(readFileSync(FR_SCANNER_SRC, "utf-8")).toContain("closes: null");

    // Every binding resolved to a REAL heading pattern, not to a stub: each one
    // matches at least one heading line.
    for (const p of patterns) {
      expect([p.ident, p.source]).not.toEqual([p.ident, "<unresolved>"]);
      const re = new RegExp(p.source);
      const hits = ["# One", "## Two", "### Three"].filter((l) => re.test(l));
      expect([`${p.spec}.${p.axis}`, hits.length > 0]).toEqual([
        `${p.spec}.${p.axis}`,
        true,
      ]);
    }
  });

  test("THE CONTRACT — every shipped pattern's flags exclude `g` and `y`", () => {
    const patterns = shippedWalkPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    // Reported as a LIST, so a failure names the offending pattern outright.
    expect(flaggedPatterns(patterns)).toEqual([]);
    for (const p of patterns) {
      expect([`${p.spec}.${p.axis}`, p.flags.includes("g")]).toEqual([
        `${p.spec}.${p.axis}`,
        false,
      ]);
      expect([`${p.spec}.${p.axis}`, p.flags.includes("y")]).toEqual([
        `${p.spec}.${p.axis}`,
        false,
      ]);
    }
  });

  test("the shared module still DOCUMENTS the rule this test enforces", () => {
    const shared = readFileSync(SHARED_WALK_SRC, "utf-8");
    expect(shared).toContain("`g` or `y` flag");
  });

  test("FALSIFIABLE — the reader REPORTS a flagged pattern, bound or inline", () => {
    const bound = [
      "const H3_RE = /^###(?!#)\\s+(.*?)\\s*$/g;",
      "const H1_H2_RE = /^#{1,2}(?!#)\\s+/;",
      "const BAD_WALK: SectionWalkSpec = {",
      "  opens: H3_RE,",
      "  closes: H1_H2_RE,",
      "  fenceAware: true,",
      "};",
    ].join("\n");
    const boundPatterns = walkSpecPatterns(bound, "fixture/bound.ts");
    expect(boundPatterns.map((p) => p.flags)).toEqual(["g", ""]);
    expect(flaggedPatterns(boundPatterns)).toEqual([
      "fixture/bound.ts:BAD_WALK.opens=/^###(?!#)\\s+(.*?)\\s*$/g",
    ]);

    const inline = [
      "const INLINE_WALK: SectionWalkSpec = {",
      "  opens: /^##\\s+(.*?)\\s*$/y,",
      "  closes: null,",
      "  fenceAware: false,",
      "};",
    ].join("\n");
    const inlinePatterns = walkSpecPatterns(inline, "fixture/inline.ts");
    expect(inlinePatterns.map((p) => `${p.axis}:${p.ident}:${p.flags}`)).toEqual([
      "opens:<inline>:y",
    ]);
    expect(flaggedPatterns(inlinePatterns)).toHaveLength(1);

    // …and the same reader over a clean spec reports nothing, so the check is
    // not simply always-failing.
    const clean = bound.replace("(.*?)\\s*$/g;", "(.*?)\\s*$/;");
    expect(flaggedPatterns(walkSpecPatterns(clean, "fixture/clean.ts"))).toEqual([]);
  });

  test("WHY — a `g`-flagged opener silently SWALLOWS a section, it does not throw", () => {
    // The harm, demonstrated on the shared walk itself: `lastIndex` survives a
    // successful match, so the immediately following heading is tested from the
    // wrong offset, fails, and lands in its predecessor's BODY.
    const lines = ["### A", "### B", "### C"];
    const clean = walkSections(lines, {
      opens: /^###(?!#)\s+(.*?)\s*$/,
      closes: null,
      fenceAware: false,
    });
    const sticky = walkSections(lines, {
      opens: /^###(?!#)\s+(.*?)\s*$/g,
      closes: null,
      fenceAware: false,
    });

    expect(clean.map((s) => s.heading)).toEqual(["A", "B", "C"]);
    expect(sticky.map((s) => s.heading)).toEqual(["A", "C"]);
    expect(sticky.length).toBeLessThan(clean.length);
    // The dropped heading is not lost loudly — it is now BODY text, which is
    // exactly how a swallowed subsection escapes the cap.
    expect(sticky[0]!.body).toContain("### B");
  });
});

// ============================================================================
// GAP 4 — the dogfood subject is THIS milestone's plan, on both paths.
//
// AC-STE-535.8 asserts both kinds present and zero violations over WHATEVER
// active plan exists. Unscoped, the first plan M138 opens before M137 archives
// would grade this milestone's suite on the next milestone's prose — a red here
// rather than on that plan's own gate run. `dogfoodTree` now filters BOTH paths
// by `milestone: M137` frontmatter; the non-vacuity and the `none` sentinel are
// untouched.
// ============================================================================

describe("GAP 4 — a NEXT milestone's plan cannot red THIS milestone's dogfood", () => {
  /** A clean, cap-passing stand-in for this milestone's own plan. */
  const cleanOwnPlan = (): string =>
    planFile(DOGFOOD_MILESTONE, [
      ["FRs", ["| FR | Title |", "|----|-------|", "| STE-535 | Fixture |"]],
      ["Tasks", twoLineTasks(6)],
      ["Dependency graph", proseLines(50, "d4")],
    ]);

  /** A next-milestone plan that genuinely breaches the cap. */
  const overCapNextPlan = (): string =>
    planFile("M138", [["Follow-ups carried into M138", proseLines(600, "n4")]]);

  test("ACTIVE PATH — only this milestone's plan is staged, and the next one's is left behind", () => {
    const fx = makeTree({
      [`specs/plan/${DOGFOOD_MILESTONE}.md`]: cleanOwnPlan(),
      "specs/plan/M138.md": overCapNextPlan(),
    });
    try {
      const dog = dogfoodTree(fx.root);
      try {
        expect(dog.source).toBe("active");
        expect(dog.files).toEqual([`${DOGFOOD_MILESTONE}.md`]);

        const measured = measure(dog.root);
        expect(measured.length).toBeGreaterThan(0);
        expect([...new Set(measured.map((m) => m.file))]).toEqual([
          `specs/plan/${DOGFOOD_MILESTONE}.md`,
        ]);
        // The three AC-STE-535.8 assertions, run over the scoped subject.
        expect(new Set(measured.map((m) => m.kind))).toEqual(
          new Set(["narrative", "structural"]),
        );
        expect(scan(dog.root)).toEqual([]);
      } finally {
        dog.cleanup();
      }

      // NON-VACUITY — the plan that was left behind really would have fired.
      // Without this, "no violations" could mean the fixture was harmless.
      const unscoped = scan(fx.root);
      expect(unscoped.map((v) => v.file)).toEqual(["specs/plan/M138.md"]);
      expect(unscoped[0]!.section).toBe("Follow-ups carried into M138");
    } finally {
      fx.cleanup();
    }
  });

  test("ACTIVE PATH — a tree holding ONLY the next milestone's plan falls through, never grades it", () => {
    // The forward-dated trap in its purest form: M137's plan has archived and
    // M138's is open. The active path must not adopt M138's plan as this
    // milestone's subject.
    const fx = makeTree({
      "specs/plan/M138.md": overCapNextPlan(),
      [`specs/plan/archive/${DOGFOOD_MILESTONE}.md`]: cleanOwnPlan(),
    });
    try {
      const dog = dogfoodTree(fx.root);
      try {
        expect(dog.source).toBe("archive");
        expect(dog.files).toEqual([`${DOGFOOD_MILESTONE}.md`]);
        expect(scan(dog.root)).toEqual([]);
      } finally {
        dog.cleanup();
      }
    } finally {
      fx.cleanup();
    }
  });

  test("SENTINEL UNMOVED — a tree holding ONLY another milestone's plans resolves to `none`", () => {
    // Scoping must not turn "nothing of mine here" into a silent pass: with no
    // M137 plan on either path the subject is `none`, which every dogfood
    // refuses.
    const fx = makeTree({
      "specs/plan/M138.md": overCapNextPlan(),
      "specs/plan/archive/M136.md": planFile("M136", [["Notes", proseLines(400, "s4")]]),
    });
    try {
      expect(dogfoodTree(fx.root).source).toBe("none");
    } finally {
      fx.cleanup();
    }
  });

  test("THE REAL SUBJECT — this repository's dogfood resolves to M137's own plan alone", () => {
    const dog = dogfoodTree();
    try {
      expect(dog.source).not.toBe("none");
      expect(dog.files).toEqual([`${DOGFOOD_MILESTONE}.md`]);
      // Staged, never the live repo root — so a plan added beside it mid-run
      // cannot join the subject.
      expect(dog.root).not.toBe(REPO_ROOT);
      const measured = measure(dog.root);
      expect([...new Set(measured.map((m) => m.file))]).toEqual([
        `specs/plan/${DOGFOOD_MILESTONE}.md`,
      ]);
    } finally {
      dog.cleanup();
    }
  });
});

// ===========================================================================
// PR #76 ROUND C — F7: THE LEVEL-3-ONLY RULE IS ASSERTED BY NOTHING
// ===========================================================================
//
// `H3_RE` is `/^###(?!#)\s+(.*?)\s*$/` and its comment says "`####`
// deliberately excluded". Measured 2026-09-01: widening it to `/^#{3,4}\s+/`
// leaves the entire gate GREEN. No fixture in this suite carries a `####`
// heading at all, so the exclusion is a claim the suite never reads.
//
// It is not a cosmetic claim. A `####` that opened a subsection would let a
// 400-word narrative be split under two sub-headings and clear the 150-word cap
// twice over, evading the budget entirely — while the plan on screen reads as
// one long narrative section, which is what the cap exists to bound.
//
// The discriminating pair below is the whole leg: the SAME prose split under
// `####` must measure as ONE over-cap subsection, and split under `###` must
// measure as THREE clean ones. A widened `H3_RE` flips the first and leaves the
// second untouched, so only the pair can tell them apart.

describe("F7 — `####` does NOT open a subsection; its prose rides the enclosing `###`", () => {
  const PER_SUB = PLAN_NARRATIVE_WORD_CAP - 50; // 100 words: clean alone, over-cap together
  const SUB_A = proseLines(PER_SUB, "sa", 20);
  const SUB_B = proseLines(PER_SUB, "sb", 20);

  /** One `### Notes` whose body is split under two `####` sub-headings. */
  const NESTED = planFile("M901", [
    ["Notes on the rollout", ["#### First half", "", ...SUB_A, "", "#### Second half", "", ...SUB_B]],
  ]);

  /** The SAME prose, promoted to two sibling level-3 subsections. */
  const FLAT = planFile("M902", [
    ["Notes on the rollout", []],
    ["First half", SUB_A],
    ["Second half", SUB_B],
  ]);

  test("the fixtures really are the discriminating pair — same prose, different heading level", () => {
    expect(NESTED).toContain("#### First half");
    expect(NESTED).toContain("#### Second half");
    expect(FLAT).not.toContain("####");
    expect(FLAT).toContain("### First half");
    // Each half alone is UNDER the cap; the two together are over it. Without
    // that the nested case would fail for a reason unrelated to the walk.
    expect(countWords(SUB_A)).toBeLessThan(PLAN_NARRATIVE_WORD_CAP);
    expect(countWords(SUB_B)).toBeLessThan(PLAN_NARRATIVE_WORD_CAP);
    expect(countWords([...SUB_A, ...SUB_B])).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
  });

  test("the `####` plan measures as ONE subsection carrying BOTH halves' words", () => {
    const fx = makeTree({ "specs/plan/M901.md": NESTED });
    try {
      const measured = measure(fx.root);
      expect(measured.map((m) => m.section)).toEqual(["Notes on the rollout"]);
      // The sub-headings are not sections: their text never becomes a section
      // name, and their prose is counted into the enclosing one.
      expect(measured.map((m) => m.section)).not.toContain("First half");
      expect(measured[0]!.words).toBeGreaterThan(PLAN_NARRATIVE_WORD_CAP);
    } finally {
      fx.cleanup();
    }
  });

  test("…and it is REFUSED — the split under `####` does not buy a second budget", () => {
    const fx = makeTree({ "specs/plan/M901.md": NESTED });
    try {
      const violations = scan(fx.root);
      expect(violations.map((v) => [v.rule, v.section])).toEqual([
        ["word_cap", "Notes on the rollout"],
      ]);
    } finally {
      fx.cleanup();
    }
  });

  test("THE ISOLATING HALF — the SAME prose under `###` measures as three, and is clean", () => {
    // This is what a widened `H3_RE` would turn the nested fixture into. Both
    // legs are needed: the nested one alone could be satisfied by a walk that
    // never split anything, and this one alone by a walk that always did.
    const fx = makeTree({ "specs/plan/M902.md": FLAT });
    try {
      const measured = measure(fx.root);
      expect(measured.map((m) => m.section).sort()).toEqual([
        "First half",
        "Notes on the rollout",
        "Second half",
      ]);
      expect(scan(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the exclusion is stated in the scanner beside the pattern that implements it", () => {
    const src = readFileSync(SCANNER_SRC, "utf-8");
    expect(src).toMatch(/####.{0,40}excluded/i);
  });
});

// ============================================================================
// M137 ROUND 3 — THE NARRATIVE BUDGET IS PER SUBSECTION NAME, NOT PER OCCURRENCE
// ============================================================================
//
// THE DEFECT, measured on the shipped scanner 2026-09-01, with its control:
//
//   VECTOR   3 x `### Notes` of 140 words (420 total, cap 150) -> []
//   CONTROL  1 x `### Notes` of 420 words                      -> ["Notes"]
//
// `scanFile` resets its `words` accumulator every time it ENTERS a subsection,
// so splitting an over-cap subsection into two identically-named subsections
// evades the cap entirely. The same defect, in the same shape, sits in
// `scan_fr_summary_altitude.ts` (word_cap AND line_cap) and in
// `stage_block_adoption.ts` (the cap-exempt section budget): three modules, one
// bug — an accumulator scoped to one occurrence of a heading.
//
// THE TAXONOMY, stated in `m137-ste-534-fr-word-caps.test.ts` and repeated here
// in one line because it is what tells the next implementer where to look: a
// rule that carries STATE ACROSS LINES needs this property; a per-line
// predicate does not. This scanner has exactly one rule and it is an
// accumulator, so all of it is at risk.
//
// THE ORDERING RULING (operator, 2026-09-01): THE PROPERTY GATES — it comes
// first and decides correctness. The legs after it document known attacks and
// are NOT coverage. If the property is green while a vector test is red, the
// vector test is what is wrong.
//
// SCOPE, decided rather than left implicit. The compositions below repeat a
// heading UNDER ONE MILESTONE — the same `##` parent — because that is the
// vector and because the plan template mandates one milestone per file ("never
// bundle M<N> and M<N+1> in the same file"). Whether the accumulator is keyed
// per FILE or per PARENT `##` is therefore NOT pinned either way: measured
// across this repository's 136 archived plans, ZERO repeat a `###` name at all,
// under one parent or across two, so the two scopes coincide on every real
// plan and pinning the difference would invent a rule nobody has needed. What
// IS pinned is the quantity: repetition must not multiply the budget.
//
// STRUCTURAL BODIES STAY EXEMPT. A `### Tasks` full of checkbox items is exempt
// from the cap, not merely under it, and every real plan carries a large one —
// so only NARRATIVE occurrences accumulate. A fix that summed structural bodies
// into the total would red every plan in this repository, which is why that
// direction is pinned below as its own leg.

/** The repetition counts — a list including a large value. */
const PLAN_REPETITIONS: readonly number[] = [2, 3, 10];

/** `total` prose words dealt into `n` bodies — remainder to the earliest. */
function splitProse(total: number, n: number, prefix: string): string[][] {
  const base = Math.floor(total / n);
  const rem = total % n;
  return Array.from({ length: n }, (_, i) =>
    proseLines(base + (i < rem ? 1 : 0), `${prefix}${i + 1}z`),
  );
}

interface PlanComposition {
  name: string;
  /** The `###` heading whose per-file total is the subject. */
  section: string;
  /** The NARRATIVE word total across every occurrence of that heading. */
  total: number;
  occurrences: number;
  content: string;
}

/**
 * The corpus: a repeated narrative heading, at several magnitudes, on both
 * sides of the cap, in every arrangement one plan file can express.
 */
function planCompositions(): PlanComposition[] {
  const cap = PLAN_NARRATIVE_WORD_CAP;
  const out: PlanComposition[] = [];
  const section = "Notes";

  for (const total of [cap - 20, cap, cap + 1, cap * 3]) {
    for (const n of [1, ...PLAN_REPETITIONS]) {
      if (total < n) continue;
      const bodies = splitProse(total, n, `p${n}t${total}`);
      out.push({
        name: `${total} narrative words over ${n} adjacent \`### ${section}\`, cap ${cap}`,
        section,
        total,
        occurrences: n,
        content: planFile(
          DOGFOOD_MILESTONE,
          bodies.map((b) => [section, b] as [string, string[]]),
        ),
      });

      if (n > 1) {
        // The repetitions separated by a DIFFERENT subsection — a merge that
        // only joins ADJACENT twins is defeated by one heading in between.
        const spaced: [string, string[]][] = [];
        bodies.forEach((b, i) => {
          spaced.push([section, b]);
          if (i < bodies.length - 1) spaced.push([`Interlude ${i + 1}`, proseLines(10, `i${i}q`)]);
        });
        out.push({
          name: `${total} narrative words over ${n} \`### ${section}\` split by other subsections`,
          section,
          total,
          occurrences: n,
          content: planFile(DOGFOOD_MILESTONE, spaced),
        });

        // …and separated by a STRUCTURAL subsection, which is exempt and must
        // neither break the accumulation nor contribute to it.
        const withTasks: [string, string[]][] = [];
        bodies.forEach((b, i) => {
          withTasks.push([section, b]);
          if (i < bodies.length - 1) withTasks.push(["Tasks", twoLineTasks(4)]);
        });
        out.push({
          name: `${total} narrative words over ${n} \`### ${section}\` split by structural \`### Tasks\``,
          section,
          total,
          occurrences: n,
          content: planFile(DOGFOOD_MILESTONE, withTasks),
        });
      }
    }
  }
  return out;
}

/** Scan one composition in its own temp tree. */
function scanPlanComposition(c: PlanComposition): Violation[] {
  const fx = makeTree({ [`specs/plan/${DOGFOOD_MILESTONE}.md`]: c.content });
  try {
    return scan(fx.root);
  } finally {
    fx.cleanup();
  }
}

describe("M137 round 3 — THE PROPERTY: the narrative budget is scoped per NAME", () => {
  test("GATING — a per-name narrative total over the cap ALWAYS flags, under it NEVER does", () => {
    const corpus = planCompositions();
    expect(corpus.length).toBeGreaterThan(0);

    // NON-VACUITY, read before the property: the corpus must contain over-cap
    // and under-cap compositions, single-heading and split forms. Without all
    // four, the property holds on a scanner that flags everything, one that
    // flags nothing, or one that was never shown a repetition.
    expect(corpus.some((c) => c.total > PLAN_NARRATIVE_WORD_CAP)).toBe(true);
    expect(corpus.some((c) => c.total <= PLAN_NARRATIVE_WORD_CAP)).toBe(true);
    expect(corpus.some((c) => c.occurrences === 1)).toBe(true);
    expect(
      corpus.some((c) => c.occurrences > 1 && c.total > PLAN_NARRATIVE_WORD_CAP),
    ).toBe(true);

    const wrong: string[] = [];
    for (const c of corpus) {
      const hits = bySection(scanPlanComposition(c), c.section);
      const flagged = hits.length > 0;
      if (flagged !== c.total > PLAN_NARRATIVE_WORD_CAP) {
        wrong.push(
          `${c.name} — total ${c.total} vs cap ${PLAN_NARRATIVE_WORD_CAP}, flagged=${flagged}`,
        );
      }
      // One violation per NAME per file when it fires — the shipped
      // once-per-subsection semantics, not once per occurrence.
      if (flagged && hits.length !== 1) {
        wrong.push(`${c.name} — flagged ${hits.length} times, expected 1`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("EVASION TWIN — the SAME total RESTRUCTURED across headings gets the SAME verdict", () => {
    const corpus = planCompositions();
    const singles = new Map<number, boolean>();
    for (const c of corpus.filter((x) => x.occurrences === 1)) {
      singles.set(c.total, bySection(scanPlanComposition(c), c.section).length > 0);
    }
    expect(singles.size).toBeGreaterThan(0);

    const divergent: string[] = [];
    let compared = 0;
    for (const c of corpus.filter((x) => x.occurrences > 1)) {
      const original = singles.get(c.total);
      if (original === undefined) continue;
      const twin = bySection(scanPlanComposition(c), c.section).length > 0;
      if (twin !== original) {
        divergent.push(`${c.name} — single=${original}, restructured=${twin}`);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
    expect(divergent).toEqual([]);
  });
});

describe("M137 round 3 — the known attacks (documentation, NOT coverage)", () => {
  test("THE CONTROL — one `### Notes` at the same total really does flag", () => {
    // The zero above is evidence only because this fires. A scanner that
    // stopped measuring produces the identical empty result.
    const content = planFile(DOGFOOD_MILESTONE, [
      ["Notes", proseLines(PLAN_NARRATIVE_WORD_CAP * 3, "ctl")],
    ]);
    const fx = makeTree({ [`specs/plan/${DOGFOOD_MILESTONE}.md`]: content });
    try {
      expect(bySection(scan(fx.root), "Notes").length).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  test("N repetitions do NOT buy N budgets — three magnitudes, each occurrence legal alone", () => {
    for (const n of PLAN_REPETITIONS) {
      const per = Math.floor(PLAN_NARRATIVE_WORD_CAP * 0.9);
      const content = planFile(
        DOGFOOD_MILESTONE,
        Array.from(
          { length: n },
          (_, i) => ["Notes", proseLines(per, `r${n}i${i}y`)] as [string, string[]],
        ),
      );
      const fx = makeTree({ [`specs/plan/${DOGFOOD_MILESTONE}.md`]: content });
      try {
        // Each occurrence is UNDER the cap on its own — only the total is over.
        expect(per).toBeLessThanOrEqual(PLAN_NARRATIVE_WORD_CAP);
        const measured = measure(fx.root).filter((m) => m.section === "Notes");
        expect({ n, occurrencesMeasured: measured.length > 0 }).toEqual({
          n,
          occurrencesMeasured: true,
        });
        expect({ n, total: per * n, flagged: bySection(scan(fx.root), "Notes").length > 0 })
          .toEqual({ n, total: per * n, flagged: per * n > PLAN_NARRATIVE_WORD_CAP });
      } finally {
        fx.cleanup();
      }
    }
  });

  test("STRUCTURAL STAYS EXEMPT — repeated checkbox subsections never accumulate into a flag", () => {
    // The direction that would red every real plan in this repository. A
    // structural body is EXEMPT from the cap, not merely under it, so ten
    // `### Tasks` of forty checkbox items must stay clean however large the
    // word total gets.
    const content = planFile(
      DOGFOOD_MILESTONE,
      Array.from({ length: 10 }, () => ["Tasks", twoLineTasks(12)] as [string, string[]]),
    );
    const fx = makeTree({ [`specs/plan/${DOGFOOD_MILESTONE}.md`]: content });
    try {
      const measured = measure(fx.root).filter((m) => m.section === "Tasks");
      expect(measured.length).toBeGreaterThan(0);
      expect(measured.every((m) => m.kind === "structural")).toBe(true);
      // The total really is far over the cap — otherwise the clean verdict
      // could come from a small fixture rather than from the exemption.
      expect(measured.reduce((sum, m) => sum + m.words, 0)).toBeGreaterThan(
        PLAN_NARRATIVE_WORD_CAP,
      );
      expect(bySection(scan(fx.root), "Tasks")).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("DOGFOOD EVASION TWIN — this milestone's OWN plan words, split across repeated headings", () => {
    // The dogfood legs above ask whether this repository's plan passes the cap.
    // They cannot ask whether the cap is avoidable — real material does not
    // evade. This leg takes a REAL narrative subsection, pushes it just past
    // the cap, and restructures the identical words across three headings of
    // the same name under the same milestone. The verdict must not move.
    const { abs } = realPlanFile();
    expect(abs).not.toBe("");
    const real = readFileSync(abs, "utf-8");
    const narrative = subsectionsOfContent(real).find(
      (s) => classify(s.body) === "narrative" && countWords(s.body) > 20,
    );
    expect(narrative).toBeDefined();

    const realTokens = narrative!.body.join(" ").trim().split(/\s+/).filter(Boolean);
    expect(realTokens.length).toBeGreaterThan(20);

    // Just past the cap, so each of the three chunks lands UNDER it — a twin
    // whose chunks were themselves over-cap would flag for a reason that has
    // nothing to do with accumulation.
    const target = PLAN_NARRATIVE_WORD_CAP + 9;
    const words = [
      ...realTokens,
      ...Array.from({ length: Math.max(0, target - realTokens.length) }, (_, i) => `fillz${i + 1}`),
    ].slice(0, target);
    expect(words.length).toBe(target);
    expect(words.slice(0, Math.min(realTokens.length, target))).toEqual(
      realTokens.slice(0, target),
    );

    /** `words` laid out ten to a line — prose shape, no list markers. */
    const lay = (ws: readonly string[]): string[] => {
      const out: string[] = [];
      for (let i = 0; i < ws.length; i += 10) out.push(ws.slice(i, i + 10).join(" "));
      return out;
    };
    const heading = narrative!.heading;
    const asOne = planFile(DOGFOOD_MILESTONE, [[heading, lay(words)]]);

    const per = Math.ceil(words.length / 3);
    const chunks = [words.slice(0, per), words.slice(per, per * 2), words.slice(per * 2)]
      .filter((c) => c.length > 0);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(PLAN_NARRATIVE_WORD_CAP);
    const asMany = planFile(
      DOGFOOD_MILESTONE,
      chunks.map((c) => [heading, lay(c)] as [string, string[]]),
    );

    const verdictOf = (content: string): string[] => {
      const fx = makeTree({ [`specs/plan/${DOGFOOD_MILESTONE}.md`]: content });
      try {
        return bySection(scan(fx.root), heading).map((v) => `${v.rule}|${v.section}`);
      } finally {
        fx.cleanup();
      }
    };
    expect(verdictOf(asOne)).toEqual(["word_cap|" + heading]);
    expect(verdictOf(asMany)).toEqual(verdictOf(asOne));
  });
});
