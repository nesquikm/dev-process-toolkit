// M137 / STE-533 — "Every user-facing stage emits the status block instead of
// narrating".
//
// THE DEFECT. STE-532 landed `verifyStageStatusBlock` — a grader for a RENDERED
// stage report — and it has ZERO production consumers: the only file that
// imports it is its own test. This repository has TWICE shipped a headline
// feature that could never fire, both times preceded by "a later FR consumes
// it". STE-533 is that later FR. It must leave STE-532's module with a REAL
// consumer, and the guard at the bottom of this file ASSERTS the consumer
// exists rather than that one could.
//
// THE SUBJECT THE IMPLEMENTER WRITES:
//
//     adapters/_shared/src/stage_block_adoption.ts        ← NEW
//
// built ON TOP of the shipped `adapters/_shared/src/stage_status_block.ts`. It
// is a POLICY over that grader, never a second parser: STE-532 already grades
// fence presence, the eight-section fixed order, the whole-report line cap, the
// empty-section fallback and counts-without-capture, and none of that is
// re-pinned here. What is NEW is the four report-level rules layered on top —
// the prose-before-block cap, the both-narration-and-block refusal, the
// two-blocks refusal, and "the block is the LAST thing in the report" — plus
// the closed list of stages that adopt them.
//
// THE CONTRACT THESE TESTS PIN, stated once so nothing has to be guessed:
//
//   export const ADOPTING_STAGES        // THE closed list of ELEVEN, stated
//                                       // ONCE and read from there
//                                       // (AC-STE-533.1)
//   export type  AdoptingStage = (typeof ADOPTING_STAGES)[number]
//
//   export const PROSE_LEAD_IN_LINE_CAP // the STATED number of prose lines a
//                                       // report may carry BEFORE the fence
//                                       // opener (AC-STE-533.2)
//
//   export interface StageAdoptionVerdict { ok: boolean; reasons: readonly string[] }
//
//   export function verifyStageReportAdoption(
//     report: string,                          // the RENDERED report a human
//                                              // reads: prose PLUS fence
//     evidence?: StageEvidenceInput | null,    // passed through to STE-532
//   ): StageAdoptionVerdict
//
//   export function locateCapabilityTokens(report: string): {
//     inBlock: string[];        // canonical capability keys INSIDE the fence
//     outsideBlock: string[];   // canonical capability keys in the prose
//   }
//
//   export interface StageAdoptionViolation {
//     stage: AdoptingStage; file: string; line: number; reason: string;
//   }
//   export function scanStageBlockAdoption(
//     projectRoot: string,      // REPO root (the `closing_summary_capability_keys`
//                               // idiom: plugins/dev-process-toolkit/skills/…
//                               // then .claude/skills/…)
//   ): StageAdoptionViolation[]
//
// AC map:
//   AC-STE-533.1 — the closed ELEVEN, enumerated (never sampled), stated once,
//                  and deliberately NOT the `/deliver` stage vocabulary
//   AC-STE-533.1a— ONE BANNER, ONE OWNER, ONE VOCABULARY EACH. The adopting
//                  eleven emit `STAGE_BLOCK_FENCE_BANNER`, graded against
//                  `ADOPTING_STAGES`; `deliver-stage-result` stays /deliver's,
//                  graded by `verifyDeliverStageCapture` against
//                  `DELIVER_STAGE_IDS`. Each grader ACCEPTS its own banner and
//                  REFUSES the other's. Operator decision 2026-08-31, on the
//                  measurement that NINE of the eleven emit a `stage:` value
//                  the shipped /deliver grader refuses outright, and that that
//                  grader REQUIRES prose before its fence while this FR's whole
//                  claim is that the block replaces the prose. Two contracts
//                  that cannot both be satisfied by the same bytes are two
//                  contracts. `DELIVER_STAGE_IDS` is NOT widened — that would
//                  tell the worker-capture grader a brainstorm run is a valid
//                  ceremony hand-off, which is false.
//   AC-STE-533.2 — the block REPLACES narration: a stated prose cap, and the
//                  discriminating case where STE-532 says ok and adoption does
//                  not. The cap governs FREE-FORM NARRATION ALONE; the
//                  structured sections earlier milestones mandate are exempt.
//   AC-STE-533.2a— the exempt sections are a CLOSED, CITED list. An entry with
//                  no RESOLVING citation FAILS, and exempt is not optional: a
//                  listed section that stops being emitted FAILS too. BOTH
//                  directions, because a carve-out checked one way is unguarded
//                  the other way.
//   AC-STE-533.8 — the adoption grader runs on a REAL /gate-check probe over
//                  the eleven, registered as an ORDERED reference (graded with
//                  the repo's own `classifyReferenceLine`), and grading the
//                  adoption CONTRACT rather than fence PRESENCE — presence-only
//                  grading is this FR's headline claim enforced by nothing.
//   AC-STE-533.3 — capability tokens survive INSIDE the block, and the shipped
//                  `closing_summary_capability_keys` probe is not weakened,
//                  relaxed, or scoped away — tested per token FAMILY
//   AC-STE-533.4 — the shipped >=100-byte closing-summary floor clears on the
//                  WORST case: every list-bearing section on the fallback
//   AC-STE-533.5 — the superseding is written down at /spec-write § 7, the
//                  surface that mandated the two-table-plus-prose shape
//   AC-STE-533.6 — exactly one block per report, as the LAST thing in it
//   AC-STE-533.7 — mutation-verified per stage, each mutation asserted to have
//                  APPLIED before its verdict is read
//
// Everything numeric below is computed from the SHIPPED exported constants
// (`STAGE_REPORT_LINE_CAP`, `LIST_STATUS_SECTIONS`, `EMPTY_SECTION_FALLBACK`,
// `CANONICAL_CAPABILITY_KEYS`, the NFR-1 cap read out of its own enforcing
// test) rather than from a hand-typed literal — the idiom the sibling M137
// suites established.

import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ADOPTED_FENCE_LINE_CAP,
  ADOPTING_STAGES,
  CAP_EXEMPT_SECTIONS,
  PROBE_ID as ADOPTION_PROBE_ID,
  PROSE_LEAD_IN_LINE_CAP,
  exemptSectionBudget,
  exemptSectionsFor,
  locateCapabilityTokens,
  resolveExemptCitation,
  runStageBlockAdoptionProbe,
  scanStageBlockAdoption,
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
  verifyStageStatusBlock,
} from "../adapters/_shared/src/stage_status_block";
import {
  DELIVER_STAGE_FENCE_BANNER,
  DELIVER_STAGE_IDS,
  FENCE_LINE_CAP,
  verifyDeliverStageCapture,
} from "../adapters/_shared/src/deliver_stage_capture";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
// The ONE shared renderer /implement step 14 is ordered to call for its
// `## Verification evidence` section. Every fixture below that carries that
// section is built FROM it, never hand-typed: a hand-typed copy keeps passing
// on the day the renderer changes shape, which is the failure the pre-merge
// review measured.
import {
  IMPLEMENT_EVIDENCE_HEADING,
  renderImplementReportEvidence,
} from "../adapters/_shared/src/implement_report_evidence";
import { EVIDENCE_SECTIONS } from "../adapters/_shared/src/deliver_stage_evidence";
// The smoke driver's canonical fixture-group roster. STE-533's SECOND consumer
// registers here, mirroring STE-492/group 14 — the shipped precedent for
// "a grader whose subject is a captured report gets a fixture-group consumer".
import {
  CANONICAL_FIXTURE_GROUPS,
  SMOKE_LEGS,
} from "../adapters/_shared/src/smoke_fixture_groups";
// The repository's OWN reference classifier — probe #81's. AC-STE-533.8 grades
// this FR's probe registration with it rather than with a private rule, because
// a guard that stays green by classifying its subject unreachable certifies the
// opposite of what it claims. It is the same instrument that caught the STE-535
// reachability regression.
import { classifyReferenceLine } from "../adapters/_shared/src/module_reachability";
// The reusable non-test-consumer guard, extracted out of
// `tests/m137-ste-535-plan-narrative-cap.test.ts` under STE-533 so both suites
// share ONE walk. Classifies by FILE PATH, never by line content.
import {
  CONSUMER_SEARCH_ROOT,
  consumerFiles,
  nonTestConsumers,
  isTestPath,
  walkTextFiles,
} from "./_module_consumers";
// The active-then-archive spec lookup. THIS FR's own file is a subject of two
// legs below, and an FR moves to `specs/frs/archive/` the moment its milestone
// ships — the one transition no gate run precedes. Reaching it by a hardcoded
// active path is green until the archive commit and ENOENT on it.
import { readSpecFile } from "./_spec_tree";
// ----------------------------------------------------------------------- paths

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

/** Plugin-root-relative, POSIX separators — the vocabulary the guard speaks. */
const ADOPTION_MODULE_REL = "adapters/_shared/src/stage_block_adoption.ts";
const STATUS_BLOCK_REL = "adapters/_shared/src/stage_status_block.ts";

const ADOPTION_MODULE_SRC = join(PLUGIN_ROOT, ...ADOPTION_MODULE_REL.split("/"));
const SPEC_WRITE_SKILL = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const NFR1_TEST_SRC = join(PLUGIN_ROOT, "tests", "skill-nfr-1-length.test.ts");
const CAPABILITY_PROBE_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "closing_summary_capability_keys.ts",
);
const FIXTURE_DIR = join(import.meta.dir, "fixtures", "deliver-stage-capture");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const STATUS_BLOCK_DOC = join(PLUGIN_ROOT, "docs", "stage-status-block.md");
const README = join(REPO_ROOT, "README.md");

/**
 * The smoke driver's operative surface. It lives at the REPO root, NOT under
 * the plugin — a plugin-root-scoped sweep is blind to it, which this repository
 * has already recorded going wrong once.
 */
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");

/**
 * THIS FR's own spec file, read through the active-then-archive lookup.
 *
 * Two legs below assert on its body. `specs/frs/STE-533.md` is where it lives
 * while M137 is open and `specs/frs/archive/STE-533.md` is where `git mv` puts
 * it when M137 ships, so a hardcoded active path passes every run up to the
 * archive commit and throws on it. `readSpecFile` throws on neither-path rather
 * than handing back an empty body, and reports which tree answered.
 */
const SELF_FR = "STE-533.md";
function selfFr(): { body: string; rel: string; source: string } {
  return readSpecFile(REPO_ROOT, "specs/frs", SELF_FR);
}

/** The committed captured-report fixtures STE-533's fixture group grades. */
const ADOPTION_FIXTURE_DIR = join(
  import.meta.dir,
  "fixtures",
  "stage-block-adoption",
);
const CAPTURED_CLEAN = join(ADOPTION_FIXTURE_DIR, "stage-report.txt");
const CAPTURED_NARRATED = join(ADOPTION_FIXTURE_DIR, "stage-report-narrated.txt");
const ADOPTION_FIXTURE_README = join(ADOPTION_FIXTURE_DIR, "README.md");

/** The fixture group STE-533 registers on the canonical roster. */
const ADOPTION_GROUP = 15;

const read = (path: string): string => readFileSync(path, "utf-8");

const skillPath = (stage: string): string =>
  join(PLUGIN_ROOT, "skills", stage, "SKILL.md");

/** Trailing newline stripped so every line count in this file means one thing. */
const fixture = (name: string): string =>
  read(join(FIXTURE_DIR, name)).replace(/\n+$/, "");

/**
 * The shipped model report — 12 prose lines, a 17-line fence, 29 total —
 * REBANNERED onto the adopting stages' own fence.
 *
 * AC-STE-533.1a (operator decision 2026-08-31) split one artifact into two: the
 * `deliver-stage-result` fence is /deliver's MACHINE hand-off between ceremony
 * stages, and the adopting eleven emit their OWN banner for a HUMAN-facing
 * closing summary. The fixture is /deliver's; only its banner is swapped, so
 * every line count, section and count in this suite still comes from the
 * shipped model report rather than from a hand-typed one.
 */
const CLEAN = fixture("worker-stage-report.txt").replace(
  DELIVER_STAGE_FENCE_BANNER,
  STAGE_BLOCK_FENCE_BANNER,
);

// ------------------------------------------------------------- report surgery

const FENCE_OPEN_RE = new RegExp(
  `^[ \\t]*${STAGE_BLOCK_FENCE_BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`,
);
const FENCE_CLOSE_RE = /^[ \t]*```[ \t]*$/;

const lineCount = (text: string): number => text.split("\n").length;

/**
 * How many times a heading appears in a report, COMPARED ON THE TRIMMED LINE.
 *
 * Trimmed, because a markdown heading may carry up to three leading spaces and
 * still be a heading to every reader and to the grader — a substring or
 * strict-equality count would miss the indented twin.
 */
const occurrencesOf = (report: string, heading: string): number =>
  report.split("\n").filter((line) => line.trim() === heading).length;

/** 0-indexed line the fence opener sits on — also the count of prose lines. */
function fenceOpenIndex(report: string): number {
  return report.split("\n").findIndex((line) => FENCE_OPEN_RE.test(line));
}

/** 0-indexed line the fence's closing marker sits on. */
function fenceCloseIndex(report: string): number {
  const all = report.split("\n");
  const open = fenceOpenIndex(report);
  return all.findIndex((line, i) => i > open && FENCE_CLOSE_RE.test(line));
}

/** The fence, opener and closer included — the "block" in the AC's words. */
function blockOf(report: string): string {
  const all = report.split("\n");
  return all.slice(fenceOpenIndex(report), fenceCloseIndex(report) + 1).join("\n");
}

/** The report with only the block left in it: zero prose, nothing trailing. */
const blockOnly = (report: string): string => blockOf(report);

// ------------------------------------------- the cap-exempt sections, RENDERED
//
// MEASURED on the shipped code (2026-09-01), and the reason this whole block
// exists: the carve-out AC-STE-533.2a added did NOT reach its sections' bodies.
//
//   renderImplementReportEvidence({}).lines
//     = ["## Verification evidence", "gate:", "  - (none found)",
//        "drive:", "  - (none found)", "e2e:", "  - (none found)"]
//   `## Advisory notes` with zero entries  = the heading plus one mandated
//                                            literal sentence.
//
// `gate:`, `drive:`, `e2e:` and that sentence are neither markdown headings nor
// list items, so every one of them was charged as NARRATION — which is why the
// two sections placed AFTER the block scored "4 non-blank line(s) follow the
// status block", and nine narration lines plus the same sections placed BEFORE
// it scored 13 over a 12-line cap. The effective lead-in budget for the only
// stage that carries exempt sections was 8, not 12.
//
// Everything below is therefore driven off the SHIPPED renderers rather than
// typed here, so these fixtures track the renderer instead of a snapshot of it.

/**
 * The `/implement` advisory section's empty-list body, READ OFF the surface
 * that mandates it.
 *
 * `## Advisory notes` with zero entries is required to carry this exact line —
 * "never absent, so the operator never confuses 'no concerns' with 'concerns
 * hidden'". Reading it here means a reword of the mandate reaches these
 * fixtures instead of leaving them pinned to a dead literal.
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
 * it — heading and body together.
 *
 * A CAP_EXEMPT_SECTIONS entry with no renderer known here THROWS rather than
 * being quietly skipped: a carve-out nothing can render is a carve-out nothing
 * tests, and a silent skip is how a new entry would ride in untested.
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
 * A report with every section its stage OWES appended after the block.
 *
 * AC-STE-533.6 explicitly permits the exempt sections to follow the block, and
 * "exempt is not optional" means a rendered `/implement` report that carries
 * neither is not a compliant report at all — so this is what a COMPLIANT
 * fixture looks like, not decoration on one.
 */
const withOwedSections = (report: string, stage: string): string =>
  [report, ...owedSectionLines(stage)].join("\n");

/**
 * The stage's report, with the `stage:` scalar rewritten and every section
 * that stage owes appended. Adoption spans eleven stages, only one of which the
 * shipped fixture names, so a per-stage loop has to be able to speak every
 * stage's name — and to speak it COMPLIANTLY.
 */
function reportForStage(stage: string): string {
  return withOwedSections(
    CLEAN.replace(/^(\s*stage:).*$/m, `$1 ${stage}`),
    stage,
  );
}

/**
 * MUTATION (AC-STE-533.7): reinstate a stage's former multi-paragraph report
 * above an otherwise compliant block. This is the shape AC-STE-533.2 exists to
 * refuse — narration RIDING BESIDE the block was the rejected alternative at
 * design time.
 */
const FORMER_REPORT = [
  "## /<stage> summary",
  "",
  "The run completed. Below is what it did, at the length these reports have",
  "drifted to: a paragraph for the setup, a paragraph for the work, a paragraph",
  "for the gate, and a closing paragraph nobody reads.",
  "",
  "Setup: the skill resolved its layout, probed the tracker mode, reconciled the",
  "local FR set against the tracker, and bound the milestone before touching a",
  "single file on disk.",
  "",
  "Work: every section named in the request was rewritten, and the sections that",
  "were not named were left byte-identical so the diff stays readable.",
  "",
  "Gate: the full suite ran green from the plugin root, with the skip baseline",
  "unchanged, and nothing was pushed from this stage.",
].join("\n");

function reinstateParagraphs(report: string, stage: string): string {
  const all = report.split("\n");
  const open = fenceOpenIndex(report);
  const narration = FORMER_REPORT.replace("<stage>", stage);
  return [...all.slice(0, open), ...narration.split("\n"), "", ...all.slice(open)].join(
    "\n",
  );
}

/** MUTATION: bolt `count` lines of prose above the fence, prose only. */
function withProseLines(report: string, count: number): string {
  const filler = Array.from(
    { length: count },
    (_, i) => `Prose line ${i + 1}: what the stage did, in the operator's language.`,
  );
  return [...filler, blockOnly(report)].join("\n");
}

/** MUTATION: append text AFTER the block's closing marker. */
function appendAfterBlock(report: string, trailing: string): string {
  return [report, trailing].join("\n");
}

/** MUTATION: a second, byte-identical block appended to the report. */
function duplicateBlock(report: string): string {
  return [report, "", blockOf(report)].join("\n");
}

// -------------------------------------------------------------- reason shapes

/**
 * The PROSE-cap refusal, distinguished from STE-532's whole-report cap: it
 * names `PROSE_LEAD_IN_LINE_CAP` and is not the whole-report reason. Without
 * the third clause the two refusals are indistinguishable whenever a mutant
 * trips both, and this suite would be reading 532's verdict as if it were the
 * new rule's.
 */
const isProseCapReason = (reason: string): boolean =>
  /prose|lead-in|narration/i.test(reason) &&
  reason.includes(String(PROSE_LEAD_IN_LINE_CAP)) &&
  !/whole-report/i.test(reason);

/**
 * STE-532's OWN whole-report cap refusal — the other half of the pair above.
 *
 * It is named here because the two graders' DISAGREEMENT is load-bearing under
 * M137 round 5: the shipped grader counts every line in the report, the
 * adoption grader counts the report MINUS the lines the cap-exempt sections'
 * own renderers emit, and an honest `/implement` report lands in the gap. A
 * suite that cannot tell this refusal from the prose one cannot say which
 * grader spoke.
 */
const isWholeReportCapReason = (reason: string): boolean =>
  /whole-report cap/i.test(reason) &&
  reason.includes(String(STAGE_REPORT_LINE_CAP));

/** The block-must-be-last refusal. */
const isBlockLastReason = (reason: string): boolean =>
  /last|trailing|after the (?:block|fence)/i.test(reason);

/** The exactly-one-block refusal, delegated to STE-532's wording. */
const isFenceCountReason = (reason: string): boolean =>
  /exactly one/i.test(reason);

/** The token-outside-the-block refusal. */
const isTokenPlacementReason = (reason: string): boolean =>
  /(?:inside|outside) the (?:status )?block/i.test(reason);

// ============================================================================
// AC-STE-533.1 — the adopting stages are a CLOSED list of ELEVEN
// ============================================================================

/**
 * The list, spelled out ONCE here as the test's independent statement of the
 * operator's 2026-08-31 decision. The suite compares the shipped const against
 * it — a test that read the const and compared it to itself would pass on any
 * list at all.
 */
const EXPECTED_ELEVEN = [
  "best-practices",
  "brainstorm",
  "deps",
  "gate-check",
  "implement",
  "report-issue",
  "setup",
  "spec-archive",
  "spec-review",
  "spec-write",
  "upgrade",
] as const;

describe("AC-STE-533.1 — the closed list of eleven adopting stages", () => {
  test("ADOPTING_STAGES is exactly the operator-resolved eleven, in order", () => {
    expect([...ADOPTING_STAGES]).toEqual([...EXPECTED_ELEVEN]);
    expect(ADOPTING_STAGES.length).toBe(11);
  });

  test("every adopting stage names a real shipped skill — ENUMERATED, not sampled", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      expect(existsSync(join(PLUGIN_ROOT, "skills", stage, "SKILL.md"))).toBe(true);
      checked += 1;
    }
    // The loop is the assertion: a `for` over an empty list passes silently.
    expect(checked).toBe(ADOPTING_STAGES.length);
  });

  test("the list is deliberately NOT the /deliver stage vocabulary", () => {
    // `/deliver`'s five omit `brainstorm` — the stage the original request
    // named FIRST — and three of them carry no closing summary to replace.
    expect([...ADOPTING_STAGES]).not.toEqual([...DELIVER_STAGE_IDS]);
    expect(ADOPTING_STAGES).toContain("brainstorm");
    expect([...DELIVER_STAGE_IDS]).not.toContain("brainstorm");
    for (const only of ["work", "ship-milestone", "pr"]) {
      expect([...ADOPTING_STAGES]).not.toContain(only);
    }
  });

  test("the list is STATED IN ONE PLACE and read from there", () => {
    const src = read(ADOPTION_MODULE_SRC);
    // A second literal listing is the drift AC-STE-533.1 forbids. `spec-archive`
    // is the probe: it appears in the const and nowhere else in the module.
    const occurrences = src.split('"spec-archive"').length - 1;
    expect(occurrences).toBe(1);
    // …and the scanner READS the const rather than re-listing the stages.
    expect(src).toContain("ADOPTING_STAGES");
  });

  test("a stage absent from the list is out of scope BY DECLARATION", () => {
    // `/pr` and `/docs` are real shipped skills with no closing-summary
    // contract. The scanner must be silent about them — absence from the list
    // is a declaration, not an oversight.
    for (const outOfScope of ["pr", "docs", "deliver", "simplify"]) {
      expect(existsSync(join(PLUGIN_ROOT, "skills", outOfScope, "SKILL.md"))).toBe(
        true,
      );
      expect([...ADOPTING_STAGES]).not.toContain(outOfScope);
    }
    const violations = scanStageBlockAdoption(REPO_ROOT);
    for (const v of violations) {
      expect([...ADOPTING_STAGES]).toContain(v.stage);
    }
  });

  test("DOGFOOD — this repository's own eleven stages have adopted the block", () => {
    const violations = scanStageBlockAdoption(REPO_ROOT);
    expect(violations.map((v) => `${v.stage}: ${v.reason}`)).toEqual([]);
  });
});

// ============================================================================
// AC-STE-533.2 — the block REPLACES narration
// ============================================================================

describe("AC-STE-533.2 — prose before the block is capped at a stated number", () => {
  test("PROSE_LEAD_IN_LINE_CAP is DERIVED from the shipped budgets", () => {
    expect(Number.isInteger(PROSE_LEAD_IN_LINE_CAP)).toBe(true);
    expect(PROSE_LEAD_IN_LINE_CAP).toBeGreaterThan(0);
    expect(PROSE_LEAD_IN_LINE_CAP).toBeLessThan(STAGE_REPORT_LINE_CAP);
    // THE TAUTOLOGY THAT USED TO SIT HERE was
    //     expect(PROSE_LEAD_IN_LINE_CAP).toBe(STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2)
    // and the module COMPUTES the constant with that exact expression, so both
    // sides moved together. Mutation-tested (fence cap 26 → 30): the assertion
    // stayed GREEN while five unrelated tests reddened — the arithmetic was
    // protected only INCIDENTALLY, by tests that happen to depend on the
    // values, and those can be rewritten for their own reasons. The guard that
    // LOOKED like the guard would have stayed green through that.
    //
    // The arithmetic is now asserted against INDEPENDENT expected values, in
    // `§ THE ARITHMETIC` below. What is left here is the SHAPE claim the
    // derivation makes and the expression cannot: the cap is smaller than the
    // report it is carved out of, and it is a real, positive whole number.
  });

  test("the number is WRITTEN DOWN at a shipped surface, not only in the module", () => {
    // "capped at a STATED number of lines" — a cap nobody can read is not
    // stated. Search the shipped tree (tests excluded by path) for a line that
    // names the number in the same breath as the thing it caps.
    const consumers = consumerFiles(ADOPTION_MODULE_REL);
    expect(consumers.length).toBeGreaterThan(0);
    const stated = consumers.some((rel) => {
      const body = read(join(PLUGIN_ROOT, ...rel.split("/")));
      return body
        .split("\n")
        .some(
          (line) =>
            line.includes(String(PROSE_LEAD_IN_LINE_CAP)) &&
            /prose|lead-in|narration/i.test(line),
        );
    });
    expect(stated).toBe(true);
  });

  test("the shipped model report sits AT the cap and is accepted", () => {
    // `CLEAN` states `stage: implement`, and /implement OWES the two AC-2a
    // sections — a report that dropped them is not a compliant report, so the
    // accepted form carries them (they follow the block, which AC-STE-533.6
    // permits). The assertion is unchanged; only the fixture is compliant.
    const model = withOwedSections(CLEAN, "implement");
    expect(fenceOpenIndex(model)).toBe(PROSE_LEAD_IN_LINE_CAP);
    expect(verifyStageReportAdoption(model)).toEqual({ ok: true, reasons: [] });
  });

  test("THE DISCRIMINATING SHAPE: STE-532 accepts it, adoption does not", () => {
    // Prose over the new cap, TOTAL under STE-532's whole-report cap. Without
    // this construction a mutant trips both rules and the suite cannot tell
    // which one fired — it would be re-pinning 532 and calling it 533.
    const overProse = withProseLines(CLEAN, PROSE_LEAD_IN_LINE_CAP + 8);
    expect(fenceOpenIndex(overProse)).toBeGreaterThan(PROSE_LEAD_IN_LINE_CAP);
    expect(lineCount(overProse)).toBeLessThanOrEqual(STAGE_REPORT_LINE_CAP);

    // Half one: the SHIPPED grader is content.
    expect(verifyStageStatusBlock(overProse).ok).toBe(true);
    // Half two: the new rule is not.
    const verdict = verifyStageReportAdoption(overProse);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isProseCapReason)).toBe(true);
  });

  test("a report exactly at the cap passes and one line over it fails", () => {
    const atCap = withOwedSections(
      withProseLines(CLEAN, PROSE_LEAD_IN_LINE_CAP),
      "implement",
    );
    const overCap = withOwedSections(
      withProseLines(CLEAN, PROSE_LEAD_IN_LINE_CAP + 1),
      "implement",
    );
    expect(fenceOpenIndex(atCap)).toBe(PROSE_LEAD_IN_LINE_CAP);
    expect(fenceOpenIndex(overCap)).toBe(PROSE_LEAD_IN_LINE_CAP + 1);
    expect(verifyStageReportAdoption(atCap).ok).toBe(true);
    expect(verifyStageReportAdoption(overCap).ok).toBe(false);
  });

  test("the former multi-paragraph report ALONGSIDE a compliant block FAILS", () => {
    const base = reportForStage("implement");
    expect(verifyStageReportAdoption(base).ok).toBe(true);
    const both = reinstateParagraphs(base, "implement");
    // The block inside the mutant is untouched and still compliant — the
    // failure is the narration riding beside it, not a broken fence.
    expect(blockOf(both)).toBe(blockOf(base));
    const verdict = verifyStageReportAdoption(both);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isProseCapReason)).toBe(true);
  });

  test("NFR-1 — no adopting skill exceeds the shipped SKILL.md line cap", () => {
    // Read the cap from its own enforcing test, never retyped. This FR REPLACES
    // narration rather than adding beside it, so a correct edit is net-neutral
    // or net-negative — and three adopting skills ship with ONE line of
    // headroom each.
    const capMatch = /const SKILL_LINE_CAP = (\d+);/.exec(read(NFR1_TEST_SRC));
    expect(capMatch).not.toBeNull();
    const cap = Number(capMatch![1]);
    expect(cap).toBeGreaterThan(0);
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const lines = lineCount(read(join(PLUGIN_ROOT, "skills", stage, "SKILL.md")));
      expect({ stage, lines: lines <= cap }).toEqual({ stage, lines: true });
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
  });
});

// ============================================================================
// AC-STE-533.3 — capability tokens survive, INSIDE the block
// ============================================================================

/**
 * The token FAMILIES as measured on 2026-08-31, each with one representative
 * key. Per FAMILY rather than per key: forty per-key assertions would pin the
 * map's CURRENT CONTENTS, where what this AC protects is the SURVIVAL property.
 */
const BASELINE_FAMILIES: readonly (readonly [string, string])[] = [
  ["spec_write", "spec_write_draft_default_applied"],
  ["milestone_allocation", "milestone_allocation_default_applied"],
  ["milestone_attach", "milestone_attach_failed"],
  ["milestone_label", "milestone_label_asserted_at_archive"],
  ["milestone_epic", "milestone_epic_unsupported"],
  ["branch_gate", "branch_gate_default_applied"],
  ["spec_research", "spec_research_invoked"],
  ["deps_research", "deps_research_invoked"],
  ["tracker_status", "tracker_status_advisory_non_tty"],
  ["tracker_local", "tracker_local_orphan_local"],
  ["token_stats", "token_stats_rendered"],
  ["report_issue", "report_issue_session_matched_marker"],
  ["best_practices", "best_practices_lens_applied"],
  ["brainstorm_socratic", "brainstorm_socratic_refused"],
  ["setup_allowlist", "setup_allowlist_entries_added"],
  ["end_to_end", "end_to_end_tests_authored"],
  // M139/STE-541: the Linear scheme-changeover notice — a new family, listed
  // here so the whole-set coverage leg below stays exhaustive rather than
  // silently tolerating an unlisted key.
  ["linear_milestone", "linear_milestone_scheme_adopted"],
] as const;

/** The canonical key count measured on 2026-08-31, before the rewrite. */
const BASELINE_KEY_COUNT = 42;

const mustEmitLiteral = (key: string): string => `MUST emit \`${key}\``;

describe("AC-STE-533.3 — the capability-keys probe is not weakened", () => {
  test("the canonical key set does not SHRINK", () => {
    expect(CANONICAL_CAPABILITY_KEYS.length).toBeGreaterThanOrEqual(
      BASELINE_KEY_COUNT,
    );
  });

  test("every baseline token family is still represented in the canonical set", () => {
    let checked = 0;
    for (const [family, representative] of BASELINE_FAMILIES) {
      const members = CANONICAL_CAPABILITY_KEYS.filter((k) =>
        k.startsWith(family),
      );
      expect({ family, members: members.length > 0 }).toEqual({
        family,
        members: true,
      });
      expect([...CANONICAL_CAPABILITY_KEYS]).toContain(representative);
      checked += 1;
    }
    expect(checked).toBe(BASELINE_FAMILIES.length);
  });

  test("the family table covers the WHOLE canonical set — no family unlisted", () => {
    const prefixes = BASELINE_FAMILIES.map(([family]) => family);
    const uncovered = CANONICAL_CAPABILITY_KEYS.filter(
      (key) => !prefixes.some((p) => key.startsWith(p)),
    );
    expect(uncovered).toEqual([]);
  });

  test("a token survives the rewrite for at least one stage PER FAMILY", () => {
    const specWrite = read(SPEC_WRITE_SKILL);
    let checked = 0;
    for (const [family, representative] of BASELINE_FAMILIES) {
      const present = specWrite.includes(mustEmitLiteral(representative));
      expect({ family, present }).toEqual({ family, present: true });
      checked += 1;
    }
    expect(checked).toBe(BASELINE_FAMILIES.length);
  });

  test("the probe's glob is not NARROWED away from either skills root", () => {
    const src = read(CAPABILITY_PROBE_SRC);
    expect(src).toContain('"plugins"');
    expect(src).toContain('"dev-process-toolkit"');
    expect(src).toContain('".claude"');
    expect(src).toContain('"spec-write"');
  });

  test("the probe still checks EVERY canonical key, not a reduced subset", async () => {
    // The strongest non-weakening proof available: hand the probe a project
    // whose spec-write body carries NO directives at all and count what it
    // reports. A probe quietly scoped down to a subset reports fewer.
    const fx = tempProject({ [skillRel("spec-write")]: "# /spec-write\n" });
    try {
      const report = await runClosingSummaryCapabilityKeysProbe(fx.root);
      expect(report.violations.length).toBe(CANONICAL_CAPABILITY_KEYS.length);
      expect(new Set(report.violations.map((v) => v.missingKey)).size).toBe(
        CANONICAL_CAPABILITY_KEYS.length,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("the probe still runs CLEAN over this repository", async () => {
    const report = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
    expect(report.violations.map((v) => v.note)).toEqual([]);
  });

  test("tokens ride INSIDE the block; a token left in the prose is refused", () => {
    const token = BASELINE_FAMILIES[0]![1];
    const inside = withOwedSections(
      blockOnly(CLEAN).replace(
        /^(summary:)$/m,
        `$1\n  - closing capability: \`${token}\``,
      ),
      "implement",
    );
    expect(inside).toContain(`\`${token}\``);
    const located = locateCapabilityTokens(inside);
    expect(located.inBlock).toContain(token);
    expect(located.outsideBlock).toEqual([]);
    expect(verifyStageReportAdoption(inside).ok).toBe(true);

    const outside = [`Emitted \`${token}\` during the run.`, blockOnly(CLEAN)].join(
      "\n",
    );
    const strayed = locateCapabilityTokens(outside);
    expect(strayed.outsideBlock).toContain(token);
    expect(strayed.inBlock).toEqual([]);
    const verdict = verifyStageReportAdoption(outside);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isTokenPlacementReason)).toBe(true);
  });

  test("only CANONICAL keys count as capability tokens", () => {
    const noise = withOwedSections(
      ["A run mentioning `not_a_capability_key`.", blockOnly(CLEAN)].join("\n"),
      "implement",
    );
    const located = locateCapabilityTokens(noise);
    expect(located.inBlock).toEqual([]);
    expect(located.outsideBlock).toEqual([]);
    expect(verifyStageReportAdoption(noise).ok).toBe(true);
  });
});

// ============================================================================
// AC-STE-533.4 — the >=100-byte closing-summary floor clears on the WORST case
// ============================================================================

/** The shipped floor, in bytes. The regression signal that the summary fired. */
const CLOSING_SUMMARY_BYTE_FLOOR = 100;

/**
 * The WORST case, composed from the SHIPPED constants rather than typed by
 * hand: every scalar section carries its minimum inline value, and every
 * list-bearing section takes `EMPTY_SECTION_FALLBACK`.
 */
function worstCaseReport(): string {
  const scalarValue: Record<string, string> = {
    stage: "setup",
    milestone: "M137",
    status: "ok",
  };
  const scalars: readonly string[] = SCALAR_STATUS_SECTIONS;
  const body = (STAGE_STATUS_SECTIONS as readonly string[]).map((name) =>
    scalars.includes(name)
      ? `${name}: ${scalarValue[name] ?? "ok"}`
      : `${name}:\n  ${EMPTY_SECTION_FALLBACK}`,
  );
  return [STAGE_BLOCK_FENCE_BANNER, ...body, "```"].join("\n");
}

describe("AC-STE-533.4 — the hundred-byte floor clears on the compact block", () => {
  test("the worst case really does take the fallback in EVERY list section", () => {
    const worst = worstCaseReport();
    const fallbacks = worst.split(EMPTY_SECTION_FALLBACK).length - 1;
    expect(fallbacks).toBe(LIST_STATUS_SECTIONS.length);
    expect(fallbacks).toBeGreaterThan(0);
  });

  test("the worst case clears the >=100-byte floor", () => {
    const bytes = Buffer.byteLength(worstCaseReport(), "utf-8");
    expect(bytes).toBeGreaterThanOrEqual(CLOSING_SUMMARY_BYTE_FLOOR);
  });

  test("the worst case is itself a COMPLIANT report", () => {
    // A floor cleared by an invalid report proves nothing.
    expect(verifyStageStatusBlock(worstCaseReport()).reasons).toEqual([]);
    expect(verifyStageReportAdoption(worstCaseReport())).toEqual({
      ok: true,
      reasons: [],
    });
  });

  test("the two shipped floor pins are not silently DISARMED", () => {
    // The floor lives in prose-conformance assertions on two skills. A rewrite
    // that shortened the reports and deleted the pins would leave the floor
    // enforced by nothing — the shape this repository has recorded before.
    for (const rel of [
      "tests/spec-write-final-summary.test.ts",
      "tests/report-issue.smoke.test.ts",
    ]) {
      const body = read(join(PLUGIN_ROOT, ...rel.split("/")));
      expect({ rel, pinned: body.includes("100\\s*byte") }).toEqual({
        rel,
        pinned: true,
      });
    }
  });
});

// ============================================================================
// AC-STE-533.5 — the superseding is WRITTEN DOWN where the mandate lives
// ============================================================================

/**
 * /spec-write § 7 — from its heading to the next level-2 heading, FENCE-AWARE.
 *
 * Measured trap: § 7's own reference shape is a fenced block whose first line
 * is `## /spec-write summary`. A naive `/^## /` terminator stops THERE, slicing
 * the section off before the "Size floor" paragraph — the very paragraph
 * AC-STE-533.5 is about — and every claim below would then pass or fail on the
 * wrong text.
 */
function specWriteSection7(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^### 7\. Report\s*$/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  let inFence = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence && /^## /.test(line)) break;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * The predicate AC-STE-533.5 turns on: § 7 must SAY the block supersedes the
 * shape § 7 itself mandated. "A contract left standing while nothing satisfies
 * it reads as a passing test over a dead rule."
 */
function supersedingIsWrittenDown(section: string): boolean {
  const namesTheBlock =
    section.includes(STAGE_BLOCK_FENCE_BANNER) ||
    /status block/i.test(section);
  const namesTheOldShape =
    /two-table|collapse to a single line|two tables/i.test(section);
  const amends =
    /(supersed\w*|replac\w*|no longer|instead of|in place of)/i.test(section);
  // The amendment has to be ABOUT the old shape, not merely nearby: an
  // amending word and a mention of the old shape in the same sentence.
  const inOneSentence = section
    .split(/(?<=[.!?])\s+/)
    .some(
      (s) =>
        /(supersed\w*|replac\w*|no longer|instead of|in place of)/i.test(s) &&
        /(two-table|two tables|single line|status block)/i.test(s),
    );
  return namesTheBlock && namesTheOldShape && amends && inOneSentence;
}

describe("AC-STE-533.5 — the old mandate is amended, not merely disobeyed", () => {
  test("/spec-write § 7 is the surface that mandated the two-table shape", () => {
    const section = specWriteSection7(read(SPEC_WRITE_SKILL));
    expect(section.length).toBeGreaterThan(0);
    expect(/two-table|two tables|collapse to a single line/i.test(section)).toBe(
      true,
    );
  });

  test("§ 7 names the status block", () => {
    const section = specWriteSection7(read(SPEC_WRITE_SKILL));
    expect(
      section.includes(STAGE_BLOCK_FENCE_BANNER) ||
        /status block/i.test(section),
    ).toBe(true);
  });

  test("§ 7 WRITES DOWN that the block supersedes the mandated shape", () => {
    expect(supersedingIsWrittenDown(specWriteSection7(read(SPEC_WRITE_SKILL)))).toBe(
      true,
    );
  });

  test("no unqualified 'do not collapse to a single line' rule is left standing", () => {
    const section = specWriteSection7(read(SPEC_WRITE_SKILL));
    const paragraphs = section.split(/\n\s*\n/);
    for (const p of paragraphs) {
      if (!/collapse to a single line/i.test(p)) continue;
      // The instruction may survive, but only inside the amending paragraph.
      expect({
        paragraph: p.slice(0, 60),
        amended: /(supersed\w*|replac\w*|no longer|status block)/i.test(p),
      }).toEqual({ paragraph: p.slice(0, 60), amended: true });
    }
  });
});

// ============================================================================
// AC-STE-533.6 — exactly one block, as the LAST thing in the report
// ============================================================================

describe("AC-STE-533.6 — one block per report, and it comes last", () => {
  test("both narration AND a block fails", () => {
    const both = reinstateParagraphs(reportForStage("setup"), "setup");
    expect(verifyStageReportAdoption(both).ok).toBe(false);
  });

  test("two blocks fails, and the refusal is DELEGATED to STE-532's wording", () => {
    const twice = duplicateBlock(CLEAN);
    // Mutation applied: there really are two fences now.
    expect(twice.split(STAGE_BLOCK_FENCE_BANNER).length - 1).toBe(2);
    const verdict = verifyStageReportAdoption(twice);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isFenceCountReason)).toBe(true);
    // Not a second parser: STE-532 refuses it in the same words.
    expect(verifyStageStatusBlock(twice).reasons.some(isFenceCountReason)).toBe(
      true,
    );
  });

  test("THE DISCRIMINATING SHAPE: trailing prose after a compliant block", () => {
    const trailing = appendAfterBlock(
      CLEAN,
      "\nAnd finally, a closing thought the operator has to scroll past.",
    );
    expect(lineCount(trailing)).toBeLessThanOrEqual(STAGE_REPORT_LINE_CAP);
    // STE-532 is content: one fence, right sections, under the report cap.
    expect(verifyStageStatusBlock(trailing).ok).toBe(true);
    // The new rule is not: the block must be the LAST thing in the report.
    const verdict = verifyStageReportAdoption(trailing);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isBlockLastReason)).toBe(true);
  });

  test("blank lines after the block are not trailing content", () => {
    expect(
      verifyStageReportAdoption(
        appendAfterBlock(withOwedSections(CLEAN, "implement"), "\n  \n"),
      ).ok,
    ).toBe(true);
  });

  test("a report with no block at all fails", () => {
    const proseOnly = CLEAN.split("\n").slice(0, fenceOpenIndex(CLEAN)).join("\n");
    expect(proseOnly).not.toContain(STAGE_BLOCK_FENCE_BANNER);
    expect(verifyStageReportAdoption(proseOnly).ok).toBe(false);
  });

  test("the adoption module BUILDS ON STE-532 rather than re-parsing", () => {
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).toContain("./stage_status_block");
    expect(src).toContain("verifyStageStatusBlock");
    // The banner is IMPORTED, never restated: a second literal is the
    // two-renderers defect STE-532's own header calls out.
    expect(src).toContain("STAGE_BLOCK_FENCE_BANNER");
    expect(src.split("```deliver-stage-result").length - 1).toBe(0);
  });
});

// ============================================================================
// AC-STE-533.7 — mutation-verified per stage, each mutation asserted to APPLY
// ============================================================================

interface TempRoot {
  root: string;
  cleanup: () => void;
}

function tempProject(files: Record<string, string>): TempRoot {
  const root = mkdtempSync(join(tmpdir(), "ste-533-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf-8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const skillRel = (stage: string): string =>
  `plugins/dev-process-toolkit/skills/${stage}/SKILL.md`;

/**
 * A synthetic SKILL.md that HAS adopted the contract: the stage's own banner,
 * and every AC-STE-533.2a section listed for that stage.
 *
 * The exempt sections are part of the adopted shape, not decoration —
 * AC-STE-533.2a's second direction is that a listed section which stops being
 * emitted FAILS, so a fixture that omitted them would be a fixture the scanner
 * is required to reject, and every "clean baseline" built on it would be
 * measuring the wrong thing.
 */
function adoptedSkillBody(stage: string): string {
  const exempt = exemptSectionsFor(stage as never).map((e) => e.heading);
  return [
    `# /${stage}`,
    "",
    STAGE_BLOCK_FENCE_BANNER,
    `stage: ${stage}`,
    "```",
    "",
    ...exempt.flatMap((heading) => [heading, "", "- row", ""]),
  ].join("\n");
}

describe("AC-STE-533.7 — mutation testing, per stage", () => {
  test("MUTATION 1 — reinstating a stage's paragraphs turns AC.2's assertion red", () => {
    let mutated = 0;
    for (const stage of ADOPTING_STAGES) {
      const base = reportForStage(stage);

      // The base is genuinely accepted — otherwise the flip below measures
      // nothing.
      expect({ stage, ok: verifyStageReportAdoption(base).ok }).toEqual({
        stage,
        ok: true,
      });

      const mutant = reinstateParagraphs(base, stage);

      // THE MUTATION APPLIED. "A mutation that never applied reads as a pass."
      expect({ stage, changed: mutant !== base }).toEqual({ stage, changed: true });
      expect(mutant).toContain(`## /${stage} summary`);
      expect({
        stage,
        overCap: fenceOpenIndex(mutant) > PROSE_LEAD_IN_LINE_CAP,
      }).toEqual({ stage, overCap: true });

      // …and the verdict flips.
      const verdict = verifyStageReportAdoption(mutant);
      expect({ stage, ok: verdict.ok }).toEqual({ stage, ok: false });
      expect({
        stage,
        prose: verdict.reasons.some(isProseCapReason),
      }).toEqual({ stage, prose: true });
      mutated += 1;
    }
    expect(mutated).toBe(ADOPTING_STAGES.length);
  });

  test("MUTATION 2 — deleting one capability token turns AC.3's assertion red", async () => {
    const specWrite = read(SPEC_WRITE_SKILL);
    const victim = BASELINE_FAMILIES.find(([, key]) =>
      specWrite.includes(mustEmitLiteral(key)),
    );
    expect(victim).toBeDefined();
    const key = victim![1];

    // Baseline: the probe is clean over a project carrying the REAL body.
    const clean = tempProject({ [skillRel("spec-write")]: specWrite });
    try {
      const before = await runClosingSummaryCapabilityKeysProbe(clean.root);
      expect(before.violations.map((v) => v.missingKey)).toEqual([]);
    } finally {
      clean.cleanup();
    }

    // MUTATION: every occurrence of the directive removed.
    const mutantBody = specWrite.split(mustEmitLiteral(key)).join(`emits \`${key}\``);
    // THE MUTATION APPLIED.
    expect(mutantBody).not.toBe(specWrite);
    expect(mutantBody).not.toContain(mustEmitLiteral(key));
    expect(specWrite).toContain(mustEmitLiteral(key));

    const broken = tempProject({ [skillRel("spec-write")]: mutantBody });
    try {
      const after = await runClosingSummaryCapabilityKeysProbe(broken.root);
      expect(after.violations.map((v) => v.missingKey)).toContain(key);
    } finally {
      broken.cleanup();
    }
  });

  test("MUTATION 3 — a stage that never adopted the block is CAUGHT, per stage", () => {
    let mutated = 0;
    for (const stage of ADOPTING_STAGES) {
      const adopted = Object.fromEntries(
        ADOPTING_STAGES.map((s) => [
          skillRel(s),
          adoptedSkillBody(s),
        ]),
      );
      const fx = tempProject(adopted);
      try {
        expect({ stage, clean: scanStageBlockAdoption(fx.root).length }).toEqual({
          stage,
          clean: 0,
        });
        // MUTATION: this one stage keeps its narration and drops the block.
        const abs = join(fx.root, ...skillRel(stage).split("/"));
        const before = read(abs);
        const after = [`# /${stage}`, "", "It narrates, at length, in prose.", ""].join(
          "\n",
        );
        writeFileSync(abs, after, "utf-8");
        // THE MUTATION APPLIED.
        expect({ stage, changed: read(abs) !== before }).toEqual({
          stage,
          changed: true,
        });
        expect(read(abs)).not.toContain(STAGE_BLOCK_FENCE_BANNER);

        const violations = scanStageBlockAdoption(fx.root);
        expect(violations.map((v) => v.stage)).toEqual([stage]);
        expect(violations[0]!.file).toContain(`${stage}`);
        expect(violations[0]!.line).toBeGreaterThan(0);
        mutated += 1;
      } finally {
        fx.cleanup();
      }
    }
    expect(mutated).toBe(ADOPTING_STAGES.length);
  });

  test("MUTATION 4 — stripping the superseding sentence turns AC.5's assertion red", () => {
    const section = specWriteSection7(read(SPEC_WRITE_SKILL));
    expect(supersedingIsWrittenDown(section)).toBe(true);
    const mutant = section.replace(
      /supersed\w*|replac\w*|no longer|instead of|in place of/gi,
      "mentions",
    );
    // THE MUTATION APPLIED.
    expect(mutant).not.toBe(section);
    expect(/supersed|replac|no longer/i.test(mutant)).toBe(false);
    expect(supersedingIsWrittenDown(mutant)).toBe(false);
  });
});

// ============================================================================
// THE CALL GUARD — a MENTION is not a CALL
// ============================================================================
//
// THE DEFECT THIS SECTION EXISTS FOR, measured 2026-08-31 and operator-
// authorized to close now:
//
//   `verifyStageReportAdoption` owns this FR's HEADLINE rules — the 12-line
//   prose lead-in cap, the both-narration-and-block refusal, block-comes-last,
//   and capability-token location — and had ZERO non-test CALLERS. Its only two
//   non-test occurrences were inside its own file: the `export function`
//   declaration, and a string naming itself in probe #82's remedy text. Probe
//   #82 calls `scanStageBlockAdoption`, which never invokes it.
//
//   So the MODULE was reachable while the headline FUNCTION was dead. That is
//   the fourth occurrence of this shape in this repository and a SHARPER
//   variant of it: module-level reachability certifies the MODULE and says
//   nothing whatever about the function.
//
// THE GUARD THAT LET IT THROUGH was the one directly below — it counted
// non-test REFERENCES via `consumerFiles`, and a doc mention and a line of
// `/gate-check` prose both satisfy that. It asserted a MENTION where the
// requirement is a CALL. It is fixed here rather than supplemented, because a
// guard that reports a hollow result as satisfied is the thing being fixed.
//
// WHAT THE FIX MUST LOOK LIKE — the SHIPPED PRECEDENT, taken literally rather
// than reinvented. `verifyDeliverStageCapture` grades a CAPTURED WORKER REPORT
// read from disk, and it has exactly two consumers: an executable front door,
// and smoke fixture group 14 running it against a real capture.
// `verifyStageReportAdoption`'s subject is the SAME KIND of thing — a rendered
// stage report — so it gets the SAME TWO:
//
//   1. a CLI front door (`import.meta.main`) that takes a path to a captured
//      report and grades it, printing violations in the NFR-10 shape;
//   2. a fixture-group consumer of the smoke-driver shape, with a real
//      captured-report fixture committed under `tests/fixtures/`.
//
// FREQUENCY, STATED HONESTLY. The smoke driver runs on CONFORMANCE runs, not on
// every gate-check. That is real enforcement at a lower frequency, and no
// surface may over-promise it as gate-time enforcement. The narration rule is
// deliberately NOT retrofitted onto probe #82: an AUTHORING-surface probe
// structurally cannot read a rendered report's narration.

/** Roots the CALL search covers. */
const CALL_SEARCH_ROOTS: readonly string[] = [
  CONSUMER_SEARCH_ROOT,
  join(REPO_ROOT, ".claude"),
];

interface CallSite {
  root: string;
  file: string;
  line: number;
  text: string;
}

/** A `//`, `*`, `/*` or `#` line — a MENTION, never a call. */
const isCommentish = (line: string): boolean => {
  const t = line.trim();
  return (
    t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#")
  );
};

const EXECUTABLE_EXT = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Every line that INVOKES `symbol` — not a declaration, not a comment, not a
 * bare mention.
 *
 * TWO ROOTS on purpose. A plugin-root-scoped sweep cannot see
 * `<repo>/.claude/skills/`, and that is where the smoke driver — one of the two
 * consumers this FR is buying — lives. A one-root walk here would report the
 * driver leg as absent and the fix as incomplete, or (worse, later) report a
 * deleted driver leg as still present because nothing ever looked.
 */
function callSites(
  symbol: string,
  roots: readonly string[] = CALL_SEARCH_ROOTS,
): CallSite[] {
  const call = new RegExp(`(?<![A-Za-z0-9_$.])${symbol}\\s*\\(`);
  const declaration = new RegExp(`\\bfunction\\s+${symbol}\\b`);
  const out: CallSite[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const rel of walkTextFiles(root)) {
      if (isTestPath(rel)) continue;
      let body: string;
      try {
        body = read(join(root, ...rel.split("/")));
      } catch {
        continue;
      }
      body.split("\n").forEach((text, i) => {
        if (!call.test(text)) return;
        if (declaration.test(text)) return;
        if (isCommentish(text)) return;
        out.push({ root, file: rel, line: i + 1, text });
      });
    }
  }
  return out;
}

/**
 * The call sites a MACHINE executes: `.ts`/`.js` files only.
 *
 * The distinction is not pedantry. `docs/stage-status-block.md` carries the
 * line "`verifyStageReportAdoption(report, evidence)` layers the adoption
 * policy" — call-SHAPED prose that a naive `symbol(` grep scores as an
 * invocation. A markdown line can be an ORDERED INSTRUCTION (graded separately,
 * with the repository's own classifier) but it is never a machine call, and
 * conflating the two is how this defect would come back wearing a better grep.
 */
const executableCallSites = (
  symbol: string,
  roots?: readonly string[],
): CallSite[] =>
  callSites(symbol, roots).filter((site) => EXECUTABLE_EXT.test(site.file));

/** Is this call site inside the file's `import.meta.main` entry block? */
function underImportMetaMain(site: CallSite): boolean {
  const lines = read(join(site.root, ...site.file.split("/"))).split("\n");
  const guard = lines.findIndex((l) => /^\s*if\s*\(\s*import\.meta\.main\s*\)/.test(l));
  return guard >= 0 && site.line > guard + 1;
}

describe("STE-532's grader has a real production consumer after STE-533", () => {
  test("stage_status_block.ts is referenced by at least one NON-TEST file", () => {
    const files = consumerFiles(STATUS_BLOCK_REL);
    expect(files.length).toBeGreaterThan(0);
  });

  test("the adoption module is referenced by a NON-TEST file — the WEAK half, kept", () => {
    // Kept verbatim, not deleted: "no longer sole evidence" means ADDED to. The
    // strong half is the next test, and the comment above it says why this one
    // could never have been it.
    const files = consumerFiles(ADOPTION_MODULE_REL);
    expect(files.length).toBeGreaterThan(0);
  });

  test("THE FIXED GUARD — `verifyStageReportAdoption` is CALLED by a non-test file, not merely mentioned", () => {
    // This is the assertion the old guard should always have made. A reference
    // count is satisfied by prose; only an invocation proves the function can
    // fire.
    const calls = executableCallSites("verifyStageReportAdoption");
    expect(calls.map((c) => `${c.file}:${c.line}`)).not.toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
  });

  test("at least one of those calls sits under an `import.meta.main` entry — it is REACHABLE, not just written", () => {
    // A call in a never-entered branch is a mention with parentheses. The
    // shipped precedent for "executable" in this repository is the
    // `import.meta.main` front door (`smoke_verdict.ts`, `gate_capture.ts`).
    const entered = executableCallSites("verifyStageReportAdoption").filter(
      underImportMetaMain,
    );
    expect(entered.map((c) => `${c.file}:${c.line}`)).not.toEqual([]);
  });

  test("THE INSTRUMENT WORKS — the same walk finds the sibling grader's real call", () => {
    // Isolation. Without this leg a `callSites` that returned `[]` for
    // everything would make the falsifiability test below pass while the guard
    // above stayed permanently red for the wrong reason.
    const sibling = executableCallSites("verifyStageStatusBlock");
    expect(sibling.length).toBeGreaterThan(0);
    expect(sibling.some((c) => c.file === ADOPTION_MODULE_REL)).toBe(true);
  });

  test("FALSIFIABLE — the call guard REDDENS on a mention-only tree the old guard passes", () => {
    // The measured defect, rebuilt: a non-test module file whose only
    // occurrences of the symbol are its declaration and a string naming itself,
    // plus a doc that mentions the module path. `consumerFiles` is content —
    // and that is exactly the hollow result the old guard reported as
    // satisfied.
    const fx = tempProject({
      [ADOPTION_MODULE_REL]: [
        "// verifyStageReportAdoption — the adoption policy grader.",
        "export function verifyStageReportAdoption(report: string) {",
        "  return { ok: true, reasons: [] as string[] };",
        "}",
        "",
        "export function scanStageBlockAdoption(root: string) {",
        '  const remedy = "the grader is `verifyStageReportAdoption`";',
        "  return [remedy, root];",
        "}",
        "",
        "if (import.meta.main) {",
        "  console.log(scanStageBlockAdoption(process.cwd()));",
        "}",
        "",
      ].join("\n"),
      "docs/stage-status-block.md": [
        "# The stage status block",
        "",
        "Grading lives in `adapters/_shared/src/stage_block_adoption.ts` —",
        "`verifyStageReportAdoption(report, evidence)` layers the adoption policy.",
        "",
      ].join("\n"),
      "skills/gate-check/SKILL.md": [
        "82. **stage_block_adoption** — see `adapters/_shared/src/stage_block_adoption.ts`.",
        "",
      ].join("\n"),
    });
    try {
      // THE OLD GUARD IS GREEN on this tree: three non-test referents.
      expect(
        consumerFiles(ADOPTION_MODULE_REL, fx.root).length,
      ).toBeGreaterThan(0);

      // THE FIXED GUARD IS RED on the same bytes.
      expect(executableCallSites("verifyStageReportAdoption", [fx.root])).toEqual(
        [],
      );

      // …and it is not simply blind: the SIBLING call in the same fixture is
      // found, so the zero above is a measurement rather than a broken walk.
      expect(
        executableCallSites("scanStageBlockAdoption", [fx.root]).length,
      ).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("the fixture-group consumer names the grader as an ORDERED instruction", () => {
    // The markdown half, graded honestly: a SKILL.md line can never be a
    // machine call, so it is classified with the repository's OWN classifier —
    // probe #81's — rather than by a private rule that would let prose pass.
    const smoke = read(SMOKE_SKILL);
    const naming = smoke
      .split("\n")
      .filter((line) => line.includes("verifyStageReportAdoption"));
    expect(naming.length).toBeGreaterThan(0);
    expect(naming.some((line) => classifyReferenceLine(line) === "ordered")).toBe(
      true,
    );
  });

  test("the consumer chain REACHES a surface outside adapters/_shared/src", () => {
    // Two modules importing each other is still an island. Close the chain two
    // hops out and require it to land on something that ships to a reader —
    // a SKILL.md, a doc, a probe registry, a CLI.
    const hop1 = consumerFiles(STATUS_BLOCK_REL);
    const reached = new Set<string>(hop1);
    for (const rel of hop1) reached.add(rel);
    for (const rel of hop1) {
      for (const next of consumerFiles(rel)) reached.add(next);
    }
    const offIsland = [...reached].filter(
      (rel) => !rel.startsWith("adapters/_shared/src/"),
    );
    expect(offIsland.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// AC-STE-533.1a — ONE BANNER, ONE OWNER, ONE VOCABULARY EACH
// ============================================================================
//
// THE ROOT CAUSE this section closes, in the operator's words: the milestone
// reused ONE artifact for two genuinely different jobs — a MACHINE hand-off
// between ceremony stages, and a HUMAN-facing closing summary for eleven
// skills. Five separate findings were three faces of that one defect.
//
// The measurement that settles it: NINE of the eleven adopting stages emit a
// `stage:` value `verifyDeliverStageCapture` refuses outright, and that grader
// REQUIRES prose before its fence (a bare fence is "a snippet") while this FR's
// whole claim is that the block REPLACES the prose. Two contracts that cannot
// both be satisfied by the same bytes are two contracts.
//
// Widening `DELIVER_STAGE_IDS` was rejected: it would tell the worker-capture
// grader that a `/brainstorm` run is a valid ceremony hand-off, which is false.
// A fix that makes a false thing true is not a fix.

/** A capture written to disk — `verifyDeliverStageCapture` reads paths, not text. */
function withCaptureFile<T>(body: string, use: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ste-533-capture-"));
  try {
    const path = join(dir, "capture.txt");
    writeFileSync(path, `${body}\n`, "utf-8");
    return use(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The SAME model report, on /deliver's banner — the fixture as shipped. */
const CLEAN_DELIVER = fixture("worker-stage-report.txt");

/** A fence-opener line for `banner`, anywhere in `body`, at any indent. */
const emitsBanner = (body: string, banner: string): boolean =>
  body
    .split("\n")
    .some((line) => new RegExp(`^[ \\t]*${banner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`).test(line));

describe("AC-STE-533.1a — the adopting stages own their banner", () => {
  test("the two banners are DISTINCT literals, each a real fence opener", () => {
    expect(STAGE_BLOCK_FENCE_BANNER).not.toBe(DELIVER_STAGE_FENCE_BANNER);
    for (const banner of [STAGE_BLOCK_FENCE_BANNER, DELIVER_STAGE_FENCE_BANNER]) {
      expect(banner.startsWith("```")).toBe(true);
      expect(banner.length).toBeGreaterThan(3);
    }
    // Neither is a prefix of the other: a prefix would make one grader's fence
    // opener match the other's line, which is the collision this AC undoes.
    expect(STAGE_BLOCK_FENCE_BANNER.startsWith(DELIVER_STAGE_FENCE_BANNER)).toBe(false);
    expect(DELIVER_STAGE_FENCE_BANNER.startsWith(STAGE_BLOCK_FENCE_BANNER)).toBe(false);
  });

  test("the adoption grader ACCEPTS its own banner and REFUSES /deliver's", () => {
    expect(verifyStageReportAdoption(withOwedSections(CLEAN, "implement"))).toEqual({
      ok: true,
      reasons: [],
    });
    const verdict = verifyStageReportAdoption(CLEAN_DELIVER);
    expect(verdict.ok).toBe(false);
    // Not "some other complaint": the adoption grader sees NO fence at all.
    expect(verdict.reasons.some((r) => /no closed|fence|block/i.test(r))).toBe(true);
  });

  test("the /deliver grader ACCEPTS its own banner and REFUSES the adopting one", () => {
    // Half one: the shipped fixture, unchanged, is still a valid hand-off.
    const accepted = withCaptureFile(CLEAN_DELIVER, (p) => verifyDeliverStageCapture(p));
    expect(accepted.reasons).toEqual([]);
    expect(accepted.ok).toBe(true);

    // Half two: the SAME bytes on the adopting banner are not a hand-off.
    const refused = withCaptureFile(CLEAN, (p) => verifyDeliverStageCapture(p));
    expect(refused.ok).toBe(false);
    expect(
      refused.reasons.some((r) => r.includes("deliver-stage-result")),
    ).toBe(true);
  });

  test("all ELEVEN adopting stages' blocks are accepted by the adoption grader", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const verdict = verifyStageReportAdoption(reportForStage(stage));
      expect({ stage, ok: verdict.ok, reasons: verdict.reasons }).toEqual({
        stage,
        ok: true,
        reasons: [],
      });
      checked += 1;
    }
    expect(checked).toBe(11);
  });

  test("the adoption grader REFUSES a /deliver-only stage value", () => {
    const deliverOnly = (DELIVER_STAGE_IDS as readonly string[]).filter(
      (id) => !(ADOPTING_STAGES as readonly string[]).includes(id),
    );
    // The measurement, asserted rather than assumed: /deliver's vocabulary
    // carries members the eleven do not.
    expect(deliverOnly.length).toBeGreaterThan(0);
    for (const id of deliverOnly) {
      const verdict = verifyStageReportAdoption(reportForStage(id));
      expect({ id, ok: verdict.ok }).toEqual({ id, ok: false });
      expect({
        id,
        named: verdict.reasons.some((r) => r.includes(id)),
      }).toEqual({ id, named: true });
    }
  });

  test("THE MEASUREMENT that split the contracts: nine of eleven are outside /deliver's vocabulary", () => {
    const outside = (ADOPTING_STAGES as readonly string[]).filter(
      (s) => !(DELIVER_STAGE_IDS as readonly string[]).includes(s),
    );
    expect(outside.length).toBe(9);
    // …and the two survivors are exactly the two /deliver already knows.
    const inside = (ADOPTING_STAGES as readonly string[]).filter((s) =>
      (DELIVER_STAGE_IDS as readonly string[]).includes(s),
    );
    expect(inside.sort()).toEqual(["implement", "spec-write"]);

    // Every one of the nine is REFUSED by the /deliver grader on the /deliver
    // banner — the proof that widening would have been a lie, not a fix.
    for (const stage of outside) {
      const capture = CLEAN_DELIVER.replace(/^(\s*stage:).*$/m, `$1 ${stage}`);
      const verdict = withCaptureFile(capture, (p) => verifyDeliverStageCapture(p));
      expect({ stage, ok: verdict.ok }).toEqual({ stage, ok: false });
    }
  });

  test("DELIVER_STAGE_IDS is NOT widened — the false thing stays false", () => {
    expect([...DELIVER_STAGE_IDS].sort()).toEqual(
      ["implement", "pr", "ship-milestone", "spec-write", "work"].sort(),
    );
    expect(DELIVER_STAGE_IDS.length).toBe(5);
    for (const stage of ADOPTING_STAGES) {
      if (stage === "implement" || stage === "spec-write") continue;
      expect([...DELIVER_STAGE_IDS]).not.toContain(stage);
    }
  });

  test("no adopting SKILL.md still emits the `deliver-stage-result` banner", () => {
    const offenders: string[] = [];
    for (const stage of ADOPTING_STAGES) {
      if (emitsBanner(read(skillPath(stage)), DELIVER_STAGE_FENCE_BANNER)) {
        offenders.push(stage);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every adopting SKILL.md DOES emit the adopting banner — the other direction", () => {
    const silent: string[] = [];
    for (const stage of ADOPTING_STAGES) {
      if (!emitsBanner(read(skillPath(stage)), STAGE_BLOCK_FENCE_BANNER)) {
        silent.push(stage);
      }
    }
    expect(silent).toEqual([]);
  });

  test("/deliver keeps its banner — the split moved the eleven, not everyone", () => {
    // The one surface that must STILL speak `deliver-stage-result`. Without
    // this leg the "no adopting skill emits it" assertion above is satisfiable
    // by deleting the contract from the repository altogether.
    const deliver = read(skillPath("deliver"));
    expect(emitsBanner(deliver, DELIVER_STAGE_FENCE_BANNER)).toBe(true);
    expect([...ADOPTING_STAGES]).not.toContain("deliver");
  });

  test("the doc shows the block on the adopting banner, not /deliver's", () => {
    const doc = read(STATUS_BLOCK_DOC);
    expect(emitsBanner(doc, STAGE_BLOCK_FENCE_BANNER)).toBe(true);
    expect(emitsBanner(doc, DELIVER_STAGE_FENCE_BANNER)).toBe(false);
  });
});

// ============================================================================
// AC-STE-533.2a — the cap-exempt sections are a CLOSED, CITED list
// ============================================================================
//
// The cap governs FREE-FORM NARRATION alone. The structured sections earlier
// milestones mandate are EXEMPT — and still REQUIRED. AC-STE-533.2a gives that
// carve-out the same discipline AC-STE-533.1's closed list got:
//
//   * closed, named in ONE place, read from there;
//   * ADMISSIBLE only with a citation that RESOLVES — a shipped AC, a real pin,
//     or the module that declares the heading. A citation pointing at nothing
//     is the vacuity this exists to catch;
//   * EXEMPT IS NOT OPTIONAL — a listed section that stops being emitted FAILS;
//   * BOTH DIRECTIONS asserted, because a carve-out checked one way is
//     unguarded the other way, and this repository has recorded that exact
//     class going unguarded more than once.

/**
 * Citations MEASURED on 2026-08-31 that must NOT resolve. Two of them were the
 * citations proposed for these very entries — and neither pins anything: both
 * files name the heading ONLY inside a `//` comment. A comment is not a pin,
 * and a list admitted on one would be the dumping ground AC-STE-533.2a exists
 * to prevent.
 */
const UNRESOLVABLE_CITATIONS: readonly (readonly [string, string])[] = [
  ["AC-STE-999999.1", "an acceptance criterion no FR carries"],
  ["tests/does-not-exist.test.ts", "a test file that is not in the repository"],
  [
    "tests/m132-ste-512-e2e-authoring.test.ts",
    "names `## Verification evidence` ONLY in a comment — measured, no pin",
  ],
  [
    "tests/m136-ste-531-order-fires.test.ts",
    "names `## Verification evidence` ONLY in a comment — measured, no pin",
  ],
] as const;

describe("AC-STE-533.2a — the exempt list is closed, cited and load-bearing", () => {
  test("CAP_EXEMPT_SECTIONS is non-empty and every entry is well formed", () => {
    expect(CAP_EXEMPT_SECTIONS.length).toBeGreaterThan(0);
    for (const entry of CAP_EXEMPT_SECTIONS) {
      expect([...ADOPTING_STAGES]).toContain(entry.stage);
      expect(entry.heading.startsWith("## ")).toBe(true);
      expect(entry.requiredBy.trim().length).toBeGreaterThan(0);
    }
  });

  test("the known members are present: /implement's two structured sections", () => {
    const implementHeadings = CAP_EXEMPT_SECTIONS.filter(
      (e) => e.stage === "implement",
    ).map((e) => e.heading);
    expect(implementHeadings).toContain("## Verification evidence");
    expect(implementHeadings).toContain("## Advisory notes");
  });

  test("EVERY entry's citation RESOLVES — no entry rides on a dead reference", () => {
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const resolution = resolveExemptCitation(entry, REPO_ROOT);
      expect({
        heading: entry.heading,
        citation: entry.requiredBy,
        resolved: resolution.resolved,
      }).toEqual({
        heading: entry.heading,
        citation: entry.requiredBy,
        resolved: true,
      });
      // A resolver that answered `true` with nothing to show would be the same
      // vacuity one level up.
      expect(resolution.evidence).not.toBeNull();
      expect(String(resolution.evidence).length).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("A CITATION POINTING AT NOTHING IS REFUSED — falsifiability, per shape", () => {
    const subject = CAP_EXEMPT_SECTIONS.find(
      (e) => e.heading === "## Verification evidence",
    );
    expect(subject).toBeDefined();
    let checked = 0;
    for (const [citation, why] of UNRESOLVABLE_CITATIONS) {
      const mutant: CapExemptSection = { ...subject!, requiredBy: citation };
      // THE MUTATION APPLIED: the citation really did change.
      expect(mutant.requiredBy).not.toBe(subject!.requiredBy);
      const resolution = resolveExemptCitation(mutant, REPO_ROOT);
      expect({ citation, why, resolved: resolution.resolved }).toEqual({
        citation,
        why,
        resolved: false,
      });
      checked += 1;
    }
    expect(checked).toBe(UNRESOLVABLE_CITATIONS.length);
  });

  test("the comment-only refusal is ABOUT COMMENTS — the isolating half", () => {
    // The two refused citations above are refused for a REASON: their only
    // mention of the heading is a `//` comment. A resolver that refused every
    // test file would pass that leg while measuring nothing, so the same shape
    // with a REAL pin must resolve.
    const real: CapExemptSection = {
      stage: "implement",
      heading: "## Advisory notes",
      requiredBy: "tests/implement-advisory-notes.test.ts",
    };
    expect(resolveExemptCitation(real, REPO_ROOT).resolved).toBe(true);
    // …and the file cited as comment-only really does mention the heading,
    // which is what makes "it mentions it" an insufficient test.
    const commentOnly = read(
      join(PLUGIN_ROOT, "tests", "m132-ste-512-e2e-authoring.test.ts"),
    );
    expect(commentOnly).toContain("## Verification evidence");
  });

  test("exemptSectionsFor reads the ONE list — and is empty for a stage with none", () => {
    for (const stage of ADOPTING_STAGES) {
      const fromHelper = exemptSectionsFor(stage).map((e) => e.heading).sort();
      const fromList = CAP_EXEMPT_SECTIONS.filter((e) => e.stage === stage)
        .map((e) => e.heading)
        .sort();
      expect({ stage, fromHelper }).toEqual({ stage, fromHelper: fromList });
    }
    // Not every stage carries one — a helper that answered non-empty for all
    // eleven would make the carve-out universal and the cap meaningless.
    const without = ADOPTING_STAGES.filter((s) => exemptSectionsFor(s).length === 0);
    expect(without.length).toBeGreaterThan(0);
  });

  test("the list is STATED IN ONE PLACE — the headings are not re-listed", () => {
    const src = read(ADOPTION_MODULE_SRC);
    // `## Advisory notes` is the probe: it belongs to the const and nowhere
    // else in the module. A second literal is the drift this AC forbids.
    expect(src.split('"## Advisory notes"').length - 1).toBe(1);
  });

  test("DIRECTION ONE — an exempt section does NOT count against the prose cap", () => {
    const body = ["", ...owedSectionLines("implement"), ""];
    // The section is bolted ABOVE the block, taking the report past the cap in
    // raw lines while carrying not one line of narration.
    const withSection = [
      ...Array.from({ length: PROSE_LEAD_IN_LINE_CAP }, (_, i) => `Prose ${i + 1}.`),
      ...body,
      blockOnly(reportForStage("implement")),
    ].join("\n");
    // The fence really is past the raw cap — otherwise the exemption is not
    // what carried the verdict.
    expect(fenceOpenIndex(withSection)).toBeGreaterThan(PROSE_LEAD_IN_LINE_CAP);
    // `ok`, not merely "no prose reason": a grader that found no fence at all
    // would also report no prose reason, and pass this leg while measuring
    // nothing.
    expect(verifyStageReportAdoption(withSection)).toEqual({ ok: true, reasons: [] });
  });

  test("DIRECTION ONE (discriminator) — a NON-exempt section DOES count", () => {
    // Same shape, same line count, one word changed in the heading. Without
    // this leg the exemption above is satisfiable by not counting anything.
    const body = ["", "## Verification notes", "", "- gate: pass 1, fail 0", ""];
    const withSection = [
      ...Array.from({ length: PROSE_LEAD_IN_LINE_CAP }, (_, i) => `Prose ${i + 1}.`),
      ...body,
      blockOnly(reportForStage("implement")),
    ].join("\n");
    const verdict = verifyStageReportAdoption(withSection);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isProseCapReason)).toBe(true);
  });

  test("DIRECTION ONE (owner) — another stage's exempt section is not exempt here", () => {
    const foreign = CAP_EXEMPT_SECTIONS.find((e) => e.stage === "implement");
    expect(foreign).toBeDefined();
    // `/setup` carries no such carve-out, so the same heading is narration.
    const withSection = [
      ...Array.from({ length: PROSE_LEAD_IN_LINE_CAP }, (_, i) => `Prose ${i + 1}.`),
      "",
      foreign!.heading,
      "",
      "- row",
      "",
      blockOnly(reportForStage("setup")),
    ].join("\n");
    const verdict = verifyStageReportAdoption(withSection);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isProseCapReason)).toBe(true);
  });

  test("DIRECTION TWO — EXEMPT IS NOT OPTIONAL: dropping a listed section FAILS", () => {
    const adopted = Object.fromEntries(
      ADOPTING_STAGES.map((s) => [skillRel(s), adoptedSkillBody(s)]),
    );
    const fx = tempProject(adopted);
    try {
      expect(scanStageBlockAdoption(fx.root)).toEqual([]);
      let mutated = 0;
      for (const entry of CAP_EXEMPT_SECTIONS) {
        const abs = join(fx.root, ...skillRel(entry.stage).split("/"));
        const before = read(abs);
        expect(before).toContain(entry.heading);
        writeFileSync(abs, before.split(entry.heading).join("## Something else"), "utf-8");
        // THE MUTATION APPLIED.
        expect(read(abs)).not.toContain(entry.heading);

        const violations = scanStageBlockAdoption(fx.root);
        expect({
          heading: entry.heading,
          caught: violations.some(
            (v) => v.stage === entry.stage && v.reason.includes(entry.heading),
          ),
        }).toEqual({ heading: entry.heading, caught: true });

        writeFileSync(abs, before, "utf-8");
        expect(scanStageBlockAdoption(fx.root)).toEqual([]);
        mutated += 1;
      }
      expect(mutated).toBe(CAP_EXEMPT_SECTIONS.length);
    } finally {
      fx.cleanup();
    }
  });

  test("DIRECTION TWO (dogfood) — this repository still emits every listed section", () => {
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const body = read(skillPath(entry.stage));
      expect({ stage: entry.stage, heading: entry.heading, emitted: body.includes(entry.heading) }).toEqual(
        { stage: entry.stage, heading: entry.heading, emitted: true },
      );
    }
  });
});

// ============================================================================
// AC-STE-533.6 (REWRITTEN) — the block is last EXCEPT for AC-2a sections
// ============================================================================

describe("AC-STE-533.6 — the block comes last, except the exempt sections", () => {
  test("an AC-2a exempt section MAY follow the block — each heading carried ONCE", () => {
    // THIS LEG'S SUBJECT IS PLACEMENT, and it was wrong about that for one
    // round. The construction it replaced appended `entry.heading` to
    // `reportForStage("implement")` — a report that ALREADY carries that
    // heading, because "exempt is not optional" requires it. So it asserted a
    // report with TWO `## Verification evidence` headings must be ACCEPTED,
    // which no shipped renderer ever emits, and which is what forced the
    // section budget to be applied PER OCCURRENCE: a per-report bound reddened
    // this leg, so the bound was weakened to keep it green. A test wrong about
    // its own subject bought the defect it was standing next to.
    const stage = "implement";
    const entries = exemptSectionsFor(stage);
    expect(entries.length).toBeGreaterThan(0);

    const trailing = [
      blockOnly(reportForStage(stage)),
      ...owedSectionLines(stage),
    ].join("\n");

    // THE CONSTRUCTION IS THE SUBJECT — each owed heading appears EXACTLY ONCE…
    for (const entry of entries) {
      expect({
        heading: entry.heading,
        occurrences: occurrencesOf(trailing, entry.heading),
      }).toEqual({ heading: entry.heading, occurrences: 1 });
    }
    // …and it really does sit AFTER the block, headings included.
    const after = trailing
      .split("\n")
      .slice(fenceCloseIndex(trailing) + 1)
      .filter((l) => l.trim().length > 0);
    expect(after.length).toBeGreaterThan(0);
    for (const entry of entries) expect(after).toContain(entry.heading);

    expect(verifyStageReportAdoption(trailing)).toEqual({ ok: true, reasons: [] });

    // FALSIFIABILITY, in place: the SAME placement with a heading one word off
    // is refused. Without it, a grader that forgave everything after the block
    // would pass this leg while measuring nothing.
    const victim = entries[0]!;
    const nearMiss = trailing.split(victim.heading).join("## Verification notes");
    expect(nearMiss).not.toContain(victim.heading);
    const missVerdict = verifyStageReportAdoption(nearMiss);
    expect(missVerdict.ok).toBe(false);
    expect(missVerdict.reasons.some(isBlockLastReason)).toBe(true);
  });

  test("a NON-exempt trailing paragraph still FAILS — the discriminator", () => {
    const trailing = appendAfterBlock(
      reportForStage("implement"),
      "\nAnd finally, a closing thought the operator has to scroll past.",
    );
    const verdict = verifyStageReportAdoption(trailing);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isBlockLastReason)).toBe(true);
  });

  test("prose UNDER an exempt trailing section is still refused", () => {
    // The carve-out admits the SECTION, not everything after it. Without this
    // leg a stage reinstates its whole narration by heading it correctly.
    const entry = CAP_EXEMPT_SECTIONS.find((e) => e.stage === "implement");
    const trailing = appendAfterBlock(
      reportForStage("implement"),
      [
        "",
        entry!.heading,
        "",
        "- gate: pass 1, fail 0",
        "",
        "And then four more paragraphs of the report this FR deleted, which is",
        "the narration riding beneath the block with a compliant heading on it.",
      ].join("\n"),
    );
    expect(verifyStageReportAdoption(trailing).ok).toBe(false);
  });

  test("the exempt section must belong to THIS stage to be admitted", () => {
    const entry = CAP_EXEMPT_SECTIONS.find((e) => e.stage === "implement");
    const trailing = appendAfterBlock(
      reportForStage("setup"),
      ["", entry!.heading, "", "- gate: pass 1, fail 0"].join("\n"),
    );
    const verdict = verifyStageReportAdoption(trailing);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isBlockLastReason)).toBe(true);
  });

  test("the old 'LAST thing in it' wording is SUPERSEDED IN WRITING", () => {
    // AC-STE-533.5's own requirement, applied to this FR's own text: a rule
    // left standing while nothing satisfies it reads as a passing test over a
    // dead rule. The exception is written down at the contract doc…
    const doc = read(STATUS_BLOCK_DOC);
    const lastRule = doc
      .split("\n")
      .filter((l) => /LAST thing|last thing/.test(l));
    expect(lastRule.length).toBeGreaterThan(0);
    expect(
      lastRule.some((l) => /except|apart from|other than/i.test(l)),
    ).toBe(true);

    // …and on every stage that actually carries an exempt section, because a
    // contract amended only in the shared doc leaves the surface lying.
    const stagesWithExempt = [
      ...new Set(CAP_EXEMPT_SECTIONS.map((e) => e.stage)),
    ];
    expect(stagesWithExempt.length).toBeGreaterThan(0);
    for (const stage of stagesWithExempt) {
      const claims = read(skillPath(stage))
        .split("\n")
        .filter((l) => /LAST thing|last thing/.test(l));
      expect({ stage, claims: claims.length > 0 }).toEqual({ stage, claims: true });
      expect({
        stage,
        amended: claims.every((l) => /except|apart from|other than/i.test(l)),
      }).toEqual({ stage, amended: true });
    }
  });
});

// ============================================================================
// AC-STE-533.8 — THE ADOPTION GRADER RUNS ON A REAL GATE PROBE
// ============================================================================
//
// MEASURED before this AC existed: ZERO of the 15 non-test references to either
// module were ORDERED — all classified `descriptive` under the repository's own
// `classifyReferenceLine` — and nothing at runtime called
// `verifyStageReportAdoption` or `scanStageBlockAdoption`. `scanStageBlockAdoption`
// graded fence PRESENCE only, so all eleven could keep every paragraph, add a
// fence, and score zero violations: this FR's headline claim enforced by nothing
// that executes. It is the THIRD occurrence of that shape in this repository.
//
// Two things the probe must NOT be, both stated by the operator:
//   * it must NOT grade fence presence alone — that is today's vacuity with a
//     probe id on it;
//   * its pin must NOT be satisfiable by a DESCRIPTIVE reference.

/** The numbered `/gate-check` probe registrations, in order. */
function probeRegistrationLines(): { number: number; line: string }[] {
  return read(GATE_CHECK_SKILL)
    .split("\n")
    .flatMap((line) => {
      // House idiom, shared verbatim with six sibling shipped suites
      // (gate-check-active-plan-ship-ready, gate-check-best-practices-manifest-hygiene,
      // gate-check-runnability-declared, m109-ste-394-docs-pins, m115-ste-417-docs-pins):
      // a probe registration is `<N>. **`, never a bare numbered list item. The looser
      // /^(\d+)\.\s/ swept ordinary numbered prose lists and would have counted them as
      // probes — measure the subject, do not reshape the subject to fit the measurement.
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [{ number: Number(m[1]), line }];
    });
}

/** The live numbered-probe count, read off the shipped registry. */
const liveProbeCount = (): number => probeRegistrationLines().length;

describe("AC-STE-533.8 — the adoption grader is registered on a runtime path", () => {
  test("the module exports a PROBE_ID and a runnable probe", () => {
    expect(ADOPTION_PROBE_ID).toBe("stage_block_adoption");
    expect(typeof runStageBlockAdoptionProbe).toBe("function");
  });

  test("/gate-check registers it as probe #82, contiguous with the rest", () => {
    const registrations = probeRegistrationLines();
    const numbers = registrations.map((r) => r.number);
    expect(numbers).toEqual(Array.from({ length: 82 }, (_, i) => i + 1));
    const mine = registrations.filter((r) =>
      r.line.includes(`\`${ADOPTION_PROBE_ID}\``),
    );
    expect(mine.length).toBe(1);
    expect(mine[0]!.number).toBe(82);
    // The registration shape every sibling carries.
    expect(mine[0]!.line).toMatch(/\*\*Severity: (error|warning)\*\*/);
    expect(mine[0]!.line).toContain("tests/m137-ste-533-stage-block-adoption.test.ts");
    expect(mine[0]!.line).toContain(ADOPTION_MODULE_REL);
  });

  test("THE REGISTRATION IS AN ORDERED REFERENCE, not a descriptive mention", () => {
    // Graded with the repository's OWN classifier — the instrument that caught
    // the STE-535 reachability regression. A private rule here would let this
    // guard certify the opposite of what it claims.
    const mine = probeRegistrationLines().find((r) =>
      r.line.includes(`\`${ADOPTION_PROBE_ID}\``),
    );
    expect(mine).toBeDefined();
    expect(classifyReferenceLine(mine!.line)).toBe("ordered");

    // The classifier really can say otherwise — the isolating half. A guard
    // whose instrument answers "ordered" for everything measures nothing.
    expect(
      classifyReferenceLine(
        `The adoption policy lives in \`${ADOPTION_MODULE_REL}\`.`,
      ),
    ).toBe("descriptive");
  });

  test("the module carries a command-line front door — probe #81 stays green", () => {
    // `/gate-check`'s own note: "registering probe #82 will turn probe #81 red,
    // and its pinned count is not the fix". The sanctioned resolution taken
    // here is the first one — give the module an `import.meta.main` entry.
    const src = read(ADOPTION_MODULE_SRC);
    expect(/^\s*if\s*\(\s*import\.meta\.main\s*\)/m.test(src)).toBe(true);
  });

  // THE LEG BELOW USED TO OVERCLAIM. It was titled "eleven fences with a broken
  // contract still violate" and mutated by DROPPING A CAP-EXEMPT SECTION — but
  // only `implement` carries one, so it proved the property for ONE of eleven
  // stages and left the other ten resting on a title. It is split in two here:
  // the broad claim gets a mutation that applies to ALL ELEVEN, and the
  // exempt-section leg is renamed to the scope it actually covers, with that
  // scope DERIVED from `CAP_EXEMPT_SECTIONS` rather than asserted in prose.
  //
  // Note what is deliberately NOT here: a narration mutation. Probe #82 grades
  // an AUTHORING SURFACE and structurally cannot read a rendered report's
  // narration — that is `verifyStageReportAdoption`'s subject, exercised by the
  // front door and the fixture group below. Retrofitting it here would be a pin
  // on the wrong subject.

  test("THE PROBE IS NOT PRESENCE-ONLY — ALL ELEVEN: a stage keeping its fence but emitting /deliver's banner still violates", async () => {
    let mutated = 0;
    for (const stage of ADOPTING_STAGES) {
      const fx = tempProject(
        Object.fromEntries(
          ADOPTING_STAGES.map((s) => [skillRel(s), adoptedSkillBody(s)]),
        ),
      );
      try {
        const clean = await runStageBlockAdoptionProbe(fx.root);
        expect({ stage, clean: clean.violations.length }).toEqual({ stage, clean: 0 });

        // MUTATION: this stage KEEPS its own fence — presence untouched — and
        // additionally emits `/deliver`'s hand-off banner. Under presence-only
        // grading this scores zero. Unlike the exempt-section mutation, it
        // applies to every one of the eleven, which is what the broad claim
        // needs.
        const abs = join(fx.root, ...skillRel(stage).split("/"));
        const before = read(abs);
        writeFileSync(
          abs,
          `${before}\n${DELIVER_STAGE_FENCE_BANNER}\nstage: implement\n\`\`\`\n`,
          "utf-8",
        );
        // THE MUTATION APPLIED, and the stage's OWN fence SURVIVED it.
        expect({ stage, changed: read(abs) !== before }).toEqual({
          stage,
          changed: true,
        });
        expect(emitsBanner(read(abs), DELIVER_STAGE_FENCE_BANNER)).toBe(true);
        expect(emitsBanner(read(abs), STAGE_BLOCK_FENCE_BANNER)).toBe(true);

        const after = await runStageBlockAdoptionProbe(fx.root);
        expect({ stage, violations: after.violations.length > 0 }).toEqual({
          stage,
          violations: true,
        });
        expect({
          stage,
          named: after.violations.some((v) => v.note.includes(stage)),
        }).toEqual({ stage, named: true });
        mutated += 1;
      } finally {
        fx.cleanup();
      }
    }
    // Enumerated, never sampled — and the count is the list's, not a literal.
    expect(mutated).toBe(ADOPTING_STAGES.length);
  });

  test("…and for the stages that CARRY a cap-exempt section, dropping it also violates (scope: the exempt stages, derived)", async () => {
    // The former "eleven fences" leg, renamed to what it proves. Its coverage
    // is stated as a NUMBER read off `CAP_EXEMPT_SECTIONS`, so a reader can see
    // it is a subset and a future entry widens it automatically.
    const exemptStages = [...new Set(CAP_EXEMPT_SECTIONS.map((e) => e.stage))];
    expect(exemptStages.length).toBeGreaterThan(0);
    expect(exemptStages.length).toBeLessThanOrEqual(ADOPTING_STAGES.length);

    let covered = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const fx = tempProject(
        Object.fromEntries(
          ADOPTING_STAGES.map((s) => [skillRel(s), adoptedSkillBody(s)]),
        ),
      );
      try {
        const clean = await runStageBlockAdoptionProbe(fx.root);
        expect(clean.violations).toEqual([]);

        const abs = join(fx.root, ...skillRel(entry.stage).split("/"));
        const before = read(abs);
        writeFileSync(
          abs,
          before.split(entry.heading).join("## Something else"),
          "utf-8",
        );
        // THE MUTATION APPLIED, and the fence SURVIVED it.
        expect(read(abs)).not.toContain(entry.heading);
        expect(emitsBanner(read(abs), STAGE_BLOCK_FENCE_BANNER)).toBe(true);

        const after = await runStageBlockAdoptionProbe(fx.root);
        expect(after.violations.length).toBeGreaterThan(0);
        expect(after.violations.some((v) => v.note.includes(entry.stage))).toBe(
          true,
        );
        covered += 1;
      } finally {
        fx.cleanup();
      }
    }
    expect(covered).toBe(CAP_EXEMPT_SECTIONS.length);
  });

  test("the probe also catches a stage still emitting /deliver's banner", async () => {
    const adopted = Object.fromEntries(
      ADOPTING_STAGES.map((s) => [skillRel(s), adoptedSkillBody(s)]),
    );
    const fx = tempProject(adopted);
    try {
      expect((await runStageBlockAdoptionProbe(fx.root)).violations).toEqual([]);
      const abs = join(fx.root, ...skillRel("brainstorm").split("/"));
      const before = read(abs);
      writeFileSync(
        abs,
        `${before}\n${DELIVER_STAGE_FENCE_BANNER}\nstage: brainstorm\n\`\`\`\n`,
        "utf-8",
      );
      expect(emitsBanner(read(abs), DELIVER_STAGE_FENCE_BANNER)).toBe(true);
      const after = await runStageBlockAdoptionProbe(fx.root);
      expect(after.violations.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("violations carry the NFR-10 shape every sibling probe emits", async () => {
    const fx = tempProject({ [skillRel("brainstorm")]: "# /brainstorm\n" });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations.length).toBeGreaterThan(0);
      for (const v of report.violations) {
        expect(v.note).toMatch(/^[^\s].*:\d+ — /);
        expect(v.message).toContain("Remedy:");
        expect(v.message).toContain("Context:");
        expect(["error", "warning"]).toContain(v.severity);
      }
    } finally {
      fx.cleanup();
    }
  });

  test("the probe is VACUOUS on a tree carrying none of the eleven", async () => {
    const fx = tempProject({ "README.md": "# not a toolkit project\n" });
    try {
      const report = await runStageBlockAdoptionProbe(fx.root);
      expect(report.violations).toEqual([]);
      expect(report.vacuous).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("the probe runs CLEAN over THIS repository — the dogfood leg", async () => {
    const report = await runStageBlockAdoptionProbe(REPO_ROOT);
    expect(report.violations.map((v) => v.note)).toEqual([]);
    expect(report.vacuous).toBe(false);
  });

  test("at least one NON-TEST reference to the module is ORDERED", () => {
    // The exit condition, restated at the reference level. MEASURED before this
    // AC existed: ZERO of the fifteen non-test references to either module were
    // ordered — every one classified `descriptive`, the hiding place probe #81
    // records. A consumer list alone does not close that: `descriptive` mentions
    // count as consumers and execute nothing.
    const ordered = nonTestConsumers(ADOPTION_MODULE_REL).filter(
      (ref) => classifyReferenceLine(ref.text) === "ordered",
    );
    expect(ordered.map((r) => r.file)).toContain("skills/gate-check/SKILL.md");
    expect(ordered.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// THE PUBLIC PROBE-COUNT CASCADE — moved TOGETHER, or not at all
// ============================================================================
//
// Authorized by operator decision 2026-08-31 together with probe #82 itself.
// A PARTIAL move is the cascade defect this milestone has spent the day
// avoiding, so the scan below is mechanical and repository-wide rather than a
// hand-kept list of files somebody remembered.

/**
 * EVERY site in this repository that PINS the numbered-probe count, MEASURED on
 * 2026-08-31, with `{N}` standing in for the count itself.
 *
 * Enumerated rather than pattern-sniffed, and that is not fastidiousness. A
 * regex scan over `(\d+) numbered` / `layers (\d+) probes` was tried first and
 * is BOOBY-TRAPPED here: `gate-check-public-surface-count-drift.test.ts` carries
 * deliberate stale fixtures ("42 numbered `/gate-check` probes", "the 3 numbered
 * steps"), `gate-check-active-plan-ship-ready.test.ts` carries a RETIREMENT
 * TRIPWIRE pinned at 74, and `m137-ste-534-fr-word-caps.test.ts` asserts a WORD
 * count that happens to be 81. Every one of those must stay exactly where it is.
 * A scan that moved them would be a perfect pin on the wrong subject — the shape
 * this repository has recorded more than once.
 *
 * A PARTIAL move is the cascade defect this milestone has spent the day
 * avoiding, so the whole table moves together or the leg is red.
 */
const PROBE_COUNT_PINS: readonly (readonly [string, string])[] = [
  ["README.md", "{N} numbered `/gate-check` probes"],
  ["README.md", String.raw`layers {N} probes`],

  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`README documents {N} probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`documents {N} numbered /gate-check probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-runnability-declared.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`"{N} numbered"`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`layers {N} probes`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Number(counted![1])).toBe({N});`],

  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`layers {N} probes`],

  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`"{N} numbered"`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`toBe({N})`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b\\s+probes`],

  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`exactly {N} probes`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/m137-ste-534-fr-word-caps.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-534-fr-word-caps.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-535-plan-narrative-cap.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-535-plan-narrative-cap.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
] as const;

/** The count these pins read BEFORE probe #82 — the number that must be gone. */
const STALE_PROBE_COUNT = 81;

const fill = (template: string, n: number): string =>
  template.split("{N}").join(String(n));

const surfaceBody = (rel: string): string =>
  rel === "README.md"
    ? read(README)
    : read(join(PLUGIN_ROOT, ...rel.split("/")));

describe("AC-STE-533.8 — the probe-count cascade moved as one", () => {
  test("the live count is 82 and README advertises it in BOTH places", () => {
    const live = liveProbeCount();
    expect(live).toBe(82);
    const readme = read(README);
    expect(readme).toContain(`${live} numbered \`/gate-check\` probes`);
    expect(readme).toMatch(new RegExp(`layers ${live} probes`));
  });

  test("EVERY enumerated pin reads the live count — none left behind", () => {
    const live = liveProbeCount();
    const missing: string[] = [];
    const stale: string[] = [];
    for (const [rel, template] of PROBE_COUNT_PINS) {
      const body = surfaceBody(rel);
      if (!body.includes(fill(template, live))) {
        missing.push(`${rel} — ${fill(template, live)}`);
      }
      if (body.includes(fill(template, STALE_PROBE_COUNT))) {
        stale.push(`${rel} — ${fill(template, STALE_PROBE_COUNT)}`);
      }
    }
    // ANTI-VACUITY: an empty table would report a clean cascade by moving
    // nothing at all.
    expect(PROBE_COUNT_PINS.length).toBeGreaterThanOrEqual(40);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("every named surface EXISTS — a pin on a deleted file is not a pin", () => {
    for (const [rel] of PROBE_COUNT_PINS) {
      const abs =
        rel === "README.md" ? README : join(PLUGIN_ROOT, ...rel.split("/"));
      expect({ rel, exists: existsSync(abs) }).toEqual({ rel, exists: true });
    }
  });

  test("THE ISOLATING HALF — the numbers that must NOT move are untouched", () => {
    // Three deliberate non-probe-count numbers live inside the very files the
    // cascade rewrites. If any of them moved, the cascade edited by digit
    // rather than by subject.
    const untouched: readonly (readonly [string, string])[] = [
      // A retirement tripwire, frozen at the count it retired.
      ["tests/gate-check-active-plan-ship-ready.test.ts", "`74 numbered` / `layers 74 probes`"],
      ["tests/gate-check-active-plan-ship-ready.test.ts", "/layers 74 probes/"],
      // Synthetic drift fixtures: a README that is SUPPOSED to disagree.
      ["tests/gate-check-public-surface-count-drift.test.ts", "42 numbered `/gate-check` probes"],
      ["tests/gate-check-public-surface-count-drift.test.ts", "Follow the 3 numbered steps below to get started."],
      // A WORD count that happens to equal the old probe count, in a file the
      // cascade really does rewrite two lines away.
      ["tests/m137-ste-534-fr-word-caps.test.ts", 'expect(countWords(overBody.join("\\n"))).toBe(81);'],
    ];
    for (const [rel, literal] of untouched) {
      expect({ rel, literal, present: surfaceBody(rel).includes(literal) }).toEqual({
        rel,
        literal,
        present: true,
      });
    }
  });

  test("no surface still asserts the count did NOT move", () => {
    // `m137-ste-535` shipped a leg titled "README still advertises 81 numbered
    // probes, not 82" — an assertion this FR makes false. Leaving it standing
    // is the dead-rule defect AC-STE-533.5 exists to prevent, pointed at a
    // sibling suite instead of a skill.
    for (const rel of [
      "tests/m137-ste-535-plan-narrative-cap.test.ts",
      "tests/m137-ste-534-fr-word-caps.test.ts",
    ]) {
      const body = surfaceBody(rel);
      expect({ rel, denies: /not 82|unmoved at 81|still 81/i.test(body) }).toEqual({
        rel,
        denies: false,
      });
    }
  });
});

// ============================================================================
// AC-STE-533.5 (WIDENED) — the superseded mandate is amended on ALL ELEVEN
// ============================================================================
//
// THE AUDIT LEFTOVER this closes: AC-STE-533.5's assertion was /spec-write-
// scoped, which is precisely what let `skills/deps/SKILL.md` keep an
// UNQUALIFIED copy of the exact rule AC-STE-533.5 names — "do not collapse to a
// single line" — at the SAME line number as /spec-write's, one amended and one
// not. `skills/report-issue/SKILL.md` carries it in different words. A rule
// checked on one surface is unchecked on the other ten.

/**
 * The superseded closing-summary mandates, MEASURED across the eleven on
 * 2026-08-31.
 *
 * Each carries its own `aboutTheSummary` scope, because two of these phrases
 * appear on these same surfaces about something else entirely — `/deps`'s table
 * columns and `/gate-check`'s probe #28 prose — and a scan that flagged those
 * would be a perfect pin on the wrong subject.
 */
const SUPERSEDED_MANDATES: readonly {
  label: string;
  match: RegExp;
  aboutTheSummary: (paragraph: string) => boolean;
}[] = [
  {
    label: "do not collapse to a single line",
    match: /do not collapse to a single line/i,
    aboutTheSummary: () => true,
  },
  {
    label: "Emit the full block, do not collapse",
    match: /do not collapse\./i,
    aboutTheSummary: () => true,
  },
  {
    label: "the summary must include <the old shape>",
    match: /must include/i,
    aboutTheSummary: (p) => /summary/i.test(p),
  },
  {
    label: "Report what happened, in this order",
    match: /Report what happened, in this order/i,
    aboutTheSummary: () => true,
  },
];

/** An amending qualifier — the paragraph SAYS the rule no longer stands. */
const isAmended = (paragraph: string): boolean =>
  /(supersed\w*|replac\w*|no longer|formerly|instead of|in place of|status block)/i.test(
    paragraph,
  );

/** Paragraphs of a markdown body, blank-line delimited. */
const paragraphsOf = (body: string): string[] => body.split(/\n\s*\n/);

describe("AC-STE-533.5 (widened) — every one of the eleven, not just /spec-write", () => {
  test("no UNQUALIFIED superseded mandate survives on any of the eleven", () => {
    const standing: string[] = [];
    let scanned = 0;
    for (const stage of ADOPTING_STAGES) {
      const body = read(skillPath(stage));
      for (const paragraph of paragraphsOf(body)) {
        for (const mandate of SUPERSEDED_MANDATES) {
          if (!mandate.match.test(paragraph)) continue;
          if (!mandate.aboutTheSummary(paragraph)) continue;
          scanned += 1;
          if (!isAmended(paragraph)) {
            standing.push(`${stage} — ${mandate.label}: ${paragraph.slice(0, 90)}`);
          }
        }
      }
    }
    // ANTI-VACUITY: the mandates really are present on these surfaces, so an
    // empty `standing` means "all amended", never "none found".
    expect(scanned).toBeGreaterThan(0);
    expect(standing).toEqual([]);
  });

  test("the scan is DRIVEN OFF ADOPTING_STAGES — enumerated, not sampled", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      expect(existsSync(skillPath(stage))).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
  });

  test("THE ISOLATING HALF — the scope really does exclude the two sibling uses", () => {
    // `/deps` line 151 forbids collapsing a TABLE's columns; `/gate-check`
    // probe #28 requires a path token to include a slash. Neither is a closing
    // summary, and a scan that flagged them would be measuring the wrong
    // subject — the failure shape this repository has recorded twice.
    const columnsRule =
      "The table is the primary stdout payload — do not wrap it in prose, do not collapse columns, do not reorder them.";
    const probe28 = "inspects `verify:` lines for path-shaped tokens (must include `/`)";
    for (const foreign of [columnsRule, probe28]) {
      const fired = SUPERSEDED_MANDATES.filter(
        (m) => m.match.test(foreign) && m.aboutTheSummary(foreign),
      );
      expect({ foreign: foreign.slice(0, 40), fired: fired.length }).toEqual({
        foreign: foreign.slice(0, 40),
        fired: 0,
      });
    }
    // …and the real subject still fires, so the scope is not simply off.
    const real =
      "The two-table-plus-prose shape clears the byte floor naturally; do not collapse to a single line.";
    expect(
      SUPERSEDED_MANDATES.some((m) => m.match.test(real) && m.aboutTheSummary(real)),
    ).toBe(true);
    expect(isAmended(real)).toBe(false);
  });
});

// ============================================================================
// AUDIT LEFTOVERS — the claim and the contract must agree
// ============================================================================

describe("M137 audit leftovers — no surface claims what its neighbour denies", () => {
  test("a stage claiming the block REPLACED its contract has actually amended it", () => {
    // Seven skills claim the block replaces a contract their surface
    // "formerly" mandated, while that contract still reads in the present
    // imperative a few lines above. A claim and its neighbour cannot both be
    // true; the assertion is that they agree.
    const disagreeing: string[] = [];
    let claiming = 0;
    for (const stage of ADOPTING_STAGES) {
      const body = read(skillPath(stage));
      const claims = paragraphsOf(body).some((p) =>
        /formerly mandated|formerly required|the block \*\*replaces\*\*/i.test(p),
      );
      if (!claims) continue;
      claiming += 1;
      for (const paragraph of paragraphsOf(body)) {
        for (const mandate of SUPERSEDED_MANDATES) {
          if (!mandate.match.test(paragraph)) continue;
          if (!mandate.aboutTheSummary(paragraph)) continue;
          if (!isAmended(paragraph)) {
            disagreeing.push(`${stage} — ${mandate.label}`);
          }
        }
      }
    }
    expect(claiming).toBeGreaterThan(0);
    expect(disagreeing).toEqual([]);
  });

  test("docs/stage-status-block.md makes no FALSE claim about its own readers", () => {
    const doc = read(STATUS_BLOCK_DOC);

    // THE MEASURED FACT the doc's claims deny: a test file re-lists all eleven
    // names DELIBERATELY, as its independent statement of the operator's
    // decision. A test that read the const and compared it to itself would
    // pass on any list at all.
    const relisters = walkTextFiles(CONSUMER_SEARCH_ROOT).filter((rel) => {
      if (!isTestPath(rel)) return false;
      const body = read(join(PLUGIN_ROOT, ...rel.split("/")));
      return ADOPTING_STAGES.every((s) => body.includes(`"${s}"`));
    });
    expect(relisters.length).toBeGreaterThan(0);

    // …so the doc must not claim its readers do not re-list it.
    expect(/tests[^.]{0,120}rather than re-listing/i.test(doc)).toBe(false);
    expect(/never re-list/i.test(doc)).toBe(false);

    // The second false claim: the names appear "only here". They do not — this
    // FR's own acceptance criteria spell all eleven out too.
    const self = selfFr();
    // WHICH tree answered, stated outright. A subject that resolved nowhere
    // would make the eleven-name check below trivially true against `""`, so
    // the source is pinned before the body is read.
    expect(["active", "archive"]).toContain(self.source);
    expect([self.rel, ADOPTING_STAGES.every((s) => self.body.includes(s))]).toEqual([
      self.rel,
      true,
    ]);
    expect(/only here/i.test(doc)).toBe(false);

    // What the doc must still say — dropping the claim is the fix, deleting
    // the pointer is not.
    expect(doc).toContain("ADOPTING_STAGES");
    expect(doc).toContain(ADOPTION_MODULE_REL);
  });
});

// ============================================================================
// CONSUMER 1 — THE CLI FRONT DOOR, WHICH MUST EXECUTE *AND* MEASURE
// ============================================================================
//
// THE CONTRACT PINNED HERE, stated once so nothing has to be guessed:
//
//     bun adapters/_shared/src/stage_block_adoption.ts [<projectRoot>]
//         # SHIPPED probe mode — scans an authoring tree. Unchanged.
//
//     bun adapters/_shared/src/stage_block_adoption.ts --report <path>
//         # NEW. Reads a CAPTURED stage report off disk and grades it with
//         # `verifyStageReportAdoption`.
//
//   exit 0 — clean; the one line printed names the probe id and the report.
//   exit 1 — violations; EVERY reason printed in the module's existing NFR-10
//            shape (a one-line verdict, then `Remedy:`, then `Context:`).
//   exit 2 — bad invocation: `--report` with no path, or a path that does not
//            resolve. Nothing is printed to stdout that could read as a clean
//            verdict.
//
// THE VACUITY THIS SECTION EXISTS TO CATCH: a front door that runs, exits
// non-zero, and prints nothing — or prints the same thing for every input. A
// front door that cannot tell one violation from another has executed without
// measuring, and the whole point of buying a consumer was the measurement.

const decode = (buf: Uint8Array | null): string =>
  buf === null ? "" : new TextDecoder().decode(buf);

interface FrontDoorRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the module's `import.meta.main` entry point as a real process. */
function frontDoor(args: readonly string[]): FrontDoorRun {
  const proc = Bun.spawnSync({
    cmd: ["bun", ADOPTION_MODULE_SRC, ...args],
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: proc.exitCode,
    stdout: decode(proc.stdout),
    stderr: decode(proc.stderr),
  };
}

/** A captured report written to disk — the front door reads paths, not text. */
function withReportFile<T>(body: string, use: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ste-533-report-"));
  try {
    const path = join(dir, "captured-report.txt");
    writeFileSync(path, `${body}\n`, "utf-8");
    return use(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The NFR-10 canonical shape: a one-line verdict, then Remedy, then Context. */
function carriesNfr10Shape(stdout: string): boolean {
  const lines = stdout.split("\n");
  return (
    lines.some((l) => l.startsWith(`${ADOPTION_PROBE_ID}:`)) &&
    lines.some((l) => l.startsWith("Remedy:")) &&
    lines.some((l) => l.startsWith("Context:"))
  );
}

/** The verdict lines alone — what distinguishes one violating input from another. */
const verdictLines = (stdout: string): string[] =>
  stdout.split("\n").filter((l) => l.startsWith(`${ADOPTION_PROBE_ID}:`));

// --- the three violating report shapes, each built off the SHIPPED model ----

/** Narration reinstated ABOVE a compliant block — the FR's headline refusal. */
const REPORT_NARRATED = reinstateParagraphs(reportForStage("implement"), "implement");

/** Narration trailing the block — rule 4, "the block is the LAST thing". */
const REPORT_TRAILING = [
  reportForStage("gate-check"),
  "",
  "One more thing the operator has to scroll past.",
].join("\n");

/** Two blocks — the count rule, owned by STE-532 and surfaced by the front door. */
const REPORT_TWO_BLOCKS = [
  reportForStage("setup"),
  "",
  blockOnly(reportForStage("setup")),
].join("\n");

describe("CONSUMER 1 — the CLI front door grades a captured report", () => {
  test("the module still carries an `import.meta.main` entry (probe #81 stays green)", () => {
    expect(/^\s*if\s*\(\s*import\.meta\.main\s*\)/m.test(read(ADOPTION_MODULE_SRC))).toBe(
      true,
    );
  });

  test("--report on a COMPLIANT captured report exits 0 and says so", () => {
    const run = withReportFile(reportForStage("implement"), (path) =>
      frontDoor(["--report", path]),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(ADOPTION_PROBE_ID);
    expect(run.stdout).toMatch(/clean/i);
    // It names the SUBJECT it graded. "clean" with no subject is a verdict
    // about nothing in particular.
    expect(run.stdout).toContain("captured-report.txt");
  });

  test("--report on NARRATION-ABOVE-THE-FENCE exits 1 and NAMES THE RULE", () => {
    const run = withReportFile(REPORT_NARRATED, (path) =>
      frontDoor(["--report", path]),
    );
    expect(run.status).toBe(1);
    // NOT-VACUOUS: it printed something.
    expect(run.stdout.trim().length).toBeGreaterThan(0);
    // …and that something identifies WHICH rule fired.
    expect(run.stdout).toMatch(/prose|lead-in|narration/i);
    expect(carriesNfr10Shape(run.stdout)).toBe(true);
  });

  test("--report on TRAILING NARRATION exits 1 and names the block-comes-last rule", () => {
    const run = withReportFile(REPORT_TRAILING, (path) =>
      frontDoor(["--report", path]),
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/follow|last/i);
    expect(carriesNfr10Shape(run.stdout)).toBe(true);
  });

  test("--report on TWO BLOCKS exits 1 and names the count rule", () => {
    const run = withReportFile(REPORT_TWO_BLOCKS, (path) =>
      frontDoor(["--report", path]),
    );
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/exactly one|2 stage-status-block|two .{0,12}fence/i);
    expect(carriesNfr10Shape(run.stdout)).toBe(true);
  });

  test("THE VACUITY LEG — the three violations do NOT print the same thing", () => {
    // A front door that exits 1 with a constant message has executed without
    // measuring: it would pass all three tests above while being unable to tell
    // narration from a second block. The verdict lines must differ.
    const outs = [REPORT_NARRATED, REPORT_TRAILING, REPORT_TWO_BLOCKS].map((body) =>
      withReportFile(body, (path) => frontDoor(["--report", path])),
    );
    for (const run of outs) expect(verdictLines(run.stdout).length).toBeGreaterThan(0);
    const shapes = outs.map((run) => verdictLines(run.stdout).sort().join("\n"));
    expect(new Set(shapes).size).toBe(shapes.length);
    // …and none of them is the clean message.
    for (const shape of shapes) expect(shape).not.toMatch(/clean/i);
  });

  test("--report with a path that does not resolve exits 2 and prints NO clean verdict", () => {
    const missing = join(tmpdir(), "ste-533-does-not-exist-9c1f.txt");
    expect(existsSync(missing)).toBe(false);
    const run = frontDoor(["--report", missing]);
    expect(run.status).toBe(2);
    expect(`${run.stdout}${run.stderr}`).toContain(missing);
    expect(run.stdout).not.toMatch(/clean/i);
  });

  test("--report with no path exits 2 and states a usage line", () => {
    const run = frontDoor(["--report"]);
    expect(run.status).toBe(2);
    expect(`${run.stdout}${run.stderr}`).toMatch(/usage:/i);
  });

  test("THE SHIPPED PROBE MODE IS UNTOUCHED — a clean tree still exits 0", () => {
    const fx = tempProject(
      Object.fromEntries(
        ADOPTING_STAGES.map((s) => [skillRel(s), adoptedSkillBody(s)]),
      ),
    );
    try {
      const run = frontDoor([fx.root]);
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/clean/i);
    } finally {
      fx.cleanup();
    }
  });

  test("THE SHIPPED PROBE MODE IS UNTOUCHED — a narrating tree still exits 1", () => {
    const fx = tempProject({ [skillRel("brainstorm")]: "# /brainstorm\n" });
    try {
      const run = frontDoor([fx.root]);
      expect(run.status).toBe(1);
      expect(run.stdout).toContain(ADOPTION_PROBE_ID);
    } finally {
      fx.cleanup();
    }
  });

  test("the front door is DOCUMENTED at the contract surface", () => {
    // A front door nobody is told about is a call site, not a consumer. The
    // shipped `gate_capture.ts` precedent puts the invocation in the doc verbatim.
    const doc = read(STATUS_BLOCK_DOC);
    expect(doc).toContain("--report");
    expect(doc).toContain(ADOPTION_MODULE_REL);
  });
});

// ============================================================================
// CONSUMER 2 — THE FIXTURE GROUP, RUN OVER A REAL CAPTURED-REPORT FIXTURE
// ============================================================================
//
// The shipped precedent, taken literally: STE-492 gave `verifyDeliverStageCapture`
// smoke fixture group 14 plus committed capture fixtures under
// `tests/fixtures/deliver-stage-capture/`. `verifyStageReportAdoption` grades
// the same KIND of artifact, so it gets group 15 and its own fixture directory.
//
// FREQUENCY, HONESTLY: the smoke driver runs on CONFORMANCE runs, not on every
// gate-check. Lower frequency, real enforcement — and no surface may say
// otherwise.

const smokeSkill = (): string => read(SMOKE_SKILL);

/** The `#### Fixture group 15 …` block, up to the next `#### `/`### ` heading. */
function fixtureGroupBlock(n: number): string {
  const body = smokeSkill();
  const lines = body.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^#### Fixture group ${n}\\b`).test(l),
  );
  expect({ group: n, found: start >= 0 }).toEqual({ group: n, found: true });
  const rest = lines.slice(start + 1);
  const endRel = rest.findIndex((l) => /^#{1,4} /.test(l));
  return [lines[start]!, ...(endRel < 0 ? rest : rest.slice(0, endRel))].join("\n");
}

/** Sentences, so a claim is scoped to the clause that makes it. */
const sentencesOf = (text: string): string[] =>
  text.split(/(?<=[.!?;:])\s+/).filter((s) => s.trim().length > 0);

/**
 * Does `text` claim, IN ONE SENTENCE, that the report-level narration rules run
 * at gate time? That claim is FALSE and the FR must not make it.
 */
const claimsGateTimeNarration = (text: string): boolean =>
  sentencesOf(text).some(
    (s) =>
      /verifyStageReportAdoption|narration|prose lead-in/i.test(s) &&
      /every gate run|every gate-check|every gate check|at gate time|on each gate run/i.test(
        s,
      ),
  );

/** Does `text` state the real frequency — a conformance run — for the grader? */
const statesConformanceFrequency = (text: string): boolean =>
  sentencesOf(text).some(
    (s) =>
      /verifyStageReportAdoption|fixture group 15|stage-block-adoption/i.test(s) &&
      /conformance/i.test(s),
  );

describe("CONSUMER 2 — smoke fixture group 15 grades a captured report", () => {
  test("the roster carries 15 groups, 1..15 in order", () => {
    expect(CANONICAL_FIXTURE_GROUPS).toHaveLength(15);
    expect(CANONICAL_FIXTURE_GROUPS.map((s) => s.group)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  test("group 15: sut STE-533, legs = the SMOKE_LEGS ALIAS, a real rationale", () => {
    const spec = CANONICAL_FIXTURE_GROUPS.find((s) => s.group === ADOPTION_GROUP);
    expect(spec).toBeDefined();
    expect(spec!.sut).toBe("STE-533");
    expect([...spec!.legs].sort()).toEqual(["jira", "linear", "none"]);
    // STE-446: the ALIAS, not a parallel literal. Reference identity is the
    // observable — a hand-written copy is why every roster stayed static when
    // the leg enum was mutated.
    expect(spec!.legs).toBe(SMOKE_LEGS as unknown as typeof spec.legs);
    // STE-449 floor: a rationale is a clause, not a token.
    expect(String(spec!.rationale).trim().split(/\s+/).length).toBeGreaterThanOrEqual(6);
  });

  test("the smoke SKILL carries the group 15 block, and it names the GRADER", () => {
    const block = fixtureGroupBlock(ADOPTION_GROUP);
    expect(block).toContain("STE-533");
    expect(block).toContain("verifyStageReportAdoption");
    expect(block).toContain(ADOPTION_MODULE_REL);
  });

  test("the group's subject is a CAPTURE, never a SKILL — the wrong-subject exclusion is written down", () => {
    const block = fixtureGroupBlock(ADOPTION_GROUP);
    expect(block).toContain("/tmp/dpt-smoke-");
    expect(block).toMatch(/captur/i);
    // The same exclusion group 14 states: nobody may re-point this at the
    // contract doc, which carries a well-formed example fence.
    expect(block).toMatch(/stage-status-block\.md|template|SKILL text|own prose/i);
  });

  test("the group states the NEGATIVE half — a narrated report FAILS it", () => {
    const block = fixtureGroupBlock(ADOPTION_GROUP);
    expect(block).toMatch(/narrat/i);
    expect(block).toMatch(/ok: false|FAILS|fails/);
  });

  test("the group carries all three runtime-check summary lines (house footer shape)", () => {
    const block = fixtureGroupBlock(ADOPTION_GROUP);
    expect(block).toContain("STE-533 runtime check: PASS");
    expect(block).toContain("STE-533 runtime check: FAIL");
    expect(block).toContain("STE-533 runtime check: NOT-REACHED");
  });
});

describe("CONSUMER 2 — the committed captured-report fixtures are REAL and DETECTABLE", () => {
  test("the fixture directory exists and carries both reports plus a provenance README", () => {
    for (const path of [CAPTURED_CLEAN, CAPTURED_NARRATED, ADOPTION_FIXTURE_README]) {
      expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
    }
    // The group-14 precedent: the provenance label is load-bearing, because a
    // hand-authored model is not a harvest and the difference must be readable.
    expect(read(ADOPTION_FIXTURE_README)).toMatch(/provenance/i);
  });

  test("the CLEAN fixture is a genuine adopting-stage report the grader ACCEPTS", () => {
    const body = read(CAPTURED_CLEAN);
    expect(body).toContain(STAGE_BLOCK_FENCE_BANNER);
    expect(body).not.toContain(DELIVER_STAGE_FENCE_BANNER);
    const stage = /^\s*stage:\s*(\S+)/m.exec(body)?.[1];
    expect([...ADOPTING_STAGES]).toContain(stage as never);
    expect(verifyStageReportAdoption(body)).toEqual({ ok: true, reasons: [] });
  });

  test("the CLEAN fixture is the DISCRIMINATING shape: STE-532 REFUSES it, adoption ACCEPTS it", () => {
    // THE PAIR INVERTED (M137 round 5). It is not dead, and the new form is the
    // stronger one.
    //
    // The old framing — "STE-532 accepts the NARRATED twin, adoption refuses
    // it" — is UNSATISFIABLE for an honest report, and the arithmetic says so.
    // The twin needs at least `PROSE_LEAD_IN_LINE_CAP + 1` narration lines to
    // break the prose cap, plus the fence and its two markers, plus the nine
    // lines of the two sections `/implement` OWES: 49 against STE-532's own
    // 40-line whole-report cap, which does not fund the carve-out. The only
    // report that ever satisfied the old framing was the four-line stub the
    // conformance matrix exists to outlaw.
    //
    // What separates the two graders is the CARVE-OUT FUNDING — the actual
    // design difference — and it separates them on the LEGAL report, the other
    // way round from the old pair.
    const body = read(CAPTURED_CLEAN);
    expect(body).toContain(STAGE_BLOCK_FENCE_BANNER);

    // STE-532 counts EVERY line, the two mandated sections included, so it
    // refuses a report that broke no budget it can name.
    const base = verifyStageStatusBlock(body);
    expect(base.ok).toBe(false);
    expect(base.reasons.some(isWholeReportCapReason)).toBe(true);
    // …and it refuses it for the CAP, not for the rule adoption owns.
    expect(base.reasons.some(isProseCapReason)).toBe(false);

    // Adoption excuses exactly the lines those sections' own renderers emit and
    // accepts the SAME BYTES.
    expect(verifyStageReportAdoption(body)).toEqual({ ok: true, reasons: [] });

    // ISOLATION — the disagreement is the FUNDING and nothing else. Restage the
    // same bytes onto an adopting stage that owes NO cap-exempt section: the
    // funding disappears, and adoption refuses on STE-532's own cap.
    const unfunded = ADOPTING_STAGES.find(
      (stage) => exemptSectionsFor(stage).length === 0,
    );
    expect(unfunded, "every adopting stage owes an exempt section").toBeDefined();
    const restaged = body.replace(/^(\s*stage:).*$/m, `$1 ${unfunded}`);
    // THE MUTATION APPLIED, and it moved nothing but the scalar.
    expect(restaged).not.toBe(body);
    expect(lineCount(restaged)).toBe(lineCount(body));
    const sibling = verifyStageReportAdoption(restaged);
    expect(sibling.ok).toBe(false);
    expect(sibling.reasons.some(isWholeReportCapReason)).toBe(true);
  });

  test("the NARRATED twin is refused by BOTH graders — and only adoption names the RULE", () => {
    const body = read(CAPTURED_NARRATED);
    expect(body).toContain(STAGE_BLOCK_FENCE_BANNER);

    // Honest about the arithmetic (see above): the twin is over STE-532's raw
    // cap at any size, so "532 accepts it" is not constructible for a report
    // that carries its own mandates. What still discriminates is the REASON —
    // the prose lead-in cap is a rule STE-532 does not own and never states.
    const base = verifyStageStatusBlock(body);
    expect(base.ok).toBe(false);
    expect(base.reasons.some(isProseCapReason)).toBe(false);

    const verdict = verifyStageReportAdoption(body);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some(isProseCapReason)).toBe(true);
  });

  test("the two fixtures differ ONLY by the reinstated narration", () => {
    // Isolation. If the mutant differed in its block too, the red above would
    // not be attributable to the narration rule.
    expect(blockOf(read(CAPTURED_NARRATED))).toBe(blockOf(read(CAPTURED_CLEAN)));
    expect(fenceOpenIndex(read(CAPTURED_NARRATED))).toBeGreaterThan(
      PROSE_LEAD_IN_LINE_CAP,
    );
    expect(fenceOpenIndex(read(CAPTURED_CLEAN))).toBeLessThanOrEqual(
      PROSE_LEAD_IN_LINE_CAP,
    );
  });

  test("THE GROUP RUNS THE GRADER OVER THE FIXTURE ON DISK — front door, real file, both verdicts", () => {
    // This is the leg that ties the three pieces together: a real captured
    // report on disk, graded by the executable front door, in the shape the
    // fixture group orders.
    const clean = frontDoor(["--report", CAPTURED_CLEAN]);
    expect({ status: clean.status, clean: /clean/i.test(clean.stdout) }).toEqual({
      status: 0,
      clean: true,
    });

    const narrated = frontDoor(["--report", CAPTURED_NARRATED]);
    expect(narrated.status).toBe(1);
    expect(narrated.stdout).toMatch(/prose|lead-in|narration/i);
  });

  test("MUTATION — mutating the on-disk fixture REDDENS the group, and the unmutated copy does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste-533-fixture-mut-"));
    try {
      const pristine = join(dir, "pristine.txt");
      const mutant = join(dir, "mutant.txt");
      const body = read(CAPTURED_CLEAN);
      writeFileSync(pristine, body, "utf-8");
      // MUTATION: trailing narration after the block — the operator scrolling
      // past the summary, which is the condition adoption exists to end.
      writeFileSync(
        mutant,
        `${body.replace(/\n+$/, "")}\n\nAnd a closing paragraph the block was supposed to replace.\n`,
        "utf-8",
      );
      // THE MUTATION APPLIED.
      expect(read(mutant)).not.toBe(read(pristine));
      expect(read(mutant)).toContain(STAGE_BLOCK_FENCE_BANNER);

      // ISOLATION: the pristine copy passes.
      expect(frontDoor(["--report", pristine]).status).toBe(0);
      // …and the mutant reddens, naming the rule.
      const red = frontDoor(["--report", mutant]);
      expect(red.status).toBe(1);
      expect(red.stdout).toMatch(/follow|last/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("WRONG-SUBJECT exclusion: the CONTRACT DOC does not grade clean", () => {
    // `docs/stage-status-block.md` carries a well-formed ```stage-status-block
    // example. A group re-pointed at it would report green forever without any
    // stage ever emitting anything.
    const run = frontDoor(["--report", STATUS_BLOCK_DOC]);
    expect(run.status).toBe(1);
    expect(verifyStageReportAdoption(read(STATUS_BLOCK_DOC)).ok).toBe(false);
  });
});

// ============================================================================
// THE TWO GRADERS' DISAGREEMENT IS LOAD-BEARING — pin it (M137 round 5)
// ============================================================================
//
// The inversion above turns "STE-532 refuses a legal /implement report" from an
// incidental fact into a property the design DEPENDS on. A property the design
// relies on, held up by nothing but nobody having done the obvious thing yet,
// is the tautological-pin defect in miniature. Two things are pinned here:
//
//   * NO production path grades an UNFILTERED report from an adopting stage.
//     The delegation is on the EXEMPT-FILTERED span — that span IS the funding.
//   * probe #82's registration SAYS SO. It currently advertises the one-block
//     count as "delegated to `verifyStageStatusBlock`, in its own words", and
//     honouring that prose literally refuses every legal report: measured,
//     `verifyStageStatusBlock` grading the committed CLEAN fixture directly
//     returns `{ok:false, "the report runs 41 lines, over the 40-line
//     whole-report cap"}`. Prose that describes a different program than the
//     code runs is a rule advertised as enforced and enforced nowhere.

/**
 * Every `.ts` file under the plugin, tests excluded BY PATH, that calls `needle`.
 *
 * Dot-directories are excluded too: a `.scratch/` probe someone left behind is
 * not a production path, and letting one join the sweep makes this leg report a
 * second caller that nothing ships.
 */
function productionCallersOf(needle: string): string[] {
  return walkTextFiles(CONSUMER_SEARCH_ROOT)
    .filter((rel) => rel.endsWith(".ts") && !isTestPath(rel))
    .filter((rel) => !rel.split("/").some((seg) => seg.startsWith(".")))
    .filter((rel) => {
      try {
        return read(join(CONSUMER_SEARCH_ROOT, ...rel.split("/"))).includes(needle);
      } catch {
        return false;
      }
    });
}

/**
 * The CLEAN fixture with its block DELETED and `narration` lines of prose put
 * where it stood.
 *
 * Still a report from an adopting stage, still carrying both sections
 * `/implement` OWES — and carrying no block at all, so it takes the branch
 * where the count rule is delegated. That branch is the one that grades the
 * RAW report today.
 */
function unblockedCleanFixture(narration: number): string {
  const lines = read(CAPTURED_CLEAN).replace(/\n+$/, "").split("\n");
  const open = lines.findIndex((line) => FENCE_OPEN_RE.test(line));
  const close = lines.findIndex((line, i) => i > open && FENCE_CLOSE_RE.test(line));
  expect({ open: open >= 0, close: close > open }).toEqual({ open: true, close: true });
  const filler = Array.from(
    { length: narration },
    (_, i) => `Narration line ${i + 1} the status block was supposed to replace.`,
  );
  return [...lines.slice(0, open), ...filler, ...lines.slice(close + 1)].join("\n");
}

/** Every line the cap-exempt sections a stage owes are funded for, summed. */
const exemptSpendFor = (stage: string): number =>
  exemptSectionsFor(stage).reduce(
    (total, entry) => total + exemptSectionBudget(entry),
    0,
  );

describe("THE DELEGATION IS ON THE EXEMPT-FILTERED SPAN, on every production path", () => {
  test("`verifyStageStatusBlock` has exactly ONE production caller — the adoption module", () => {
    // Non-vacuity first: the delegation really is in the tree, and it really is
    // in one place. A sweep that finds nothing certifies nothing.
    const callers = productionCallersOf("verifyStageStatusBlock(");
    expect(callers).toContain(ADOPTION_MODULE_REL);
    expect(callers.filter((rel) => rel !== STATUS_BLOCK_REL)).toEqual([
      ADOPTION_MODULE_REL,
    ]);
  });

  test("NO call site hands it the RAW report — every one is given the filtered span", () => {
    const src = read(ADOPTION_MODULE_SRC);
    // Non-vacuity: the module carries at least two call sites (the count-rule
    // branch and the main one), so an empty match below means something.
    expect((src.match(/verifyStageStatusBlock\(/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(src.match(/verifyStageStatusBlock\(\s*report\b/g) ?? []).toEqual([]);
  });

  test("a BLOCKLESS report is refused for the MISSING BLOCK, never for a cap the carve-out funds", () => {
    // THE BAND WHERE THE TWO GRADERS DISAGREE: raw length over the shipped
    // whole-report cap, exempt-filtered length under it. An honest /implement
    // report lives in exactly this band, so a spurious cap refusal here names a
    // budget the report already met — the shape the carve-out exists to end.
    const spend = exemptSpendFor("implement");
    expect(spend).toBeGreaterThan(0);

    const pad = STAGE_REPORT_LINE_CAP + 1 - lineCount(unblockedCleanFixture(0));
    expect(pad).toBeGreaterThan(0);
    const report = unblockedCleanFixture(pad);
    expect(lineCount(report)).toBe(STAGE_REPORT_LINE_CAP + 1);
    expect(lineCount(report) - spend).toBeLessThanOrEqual(STAGE_REPORT_LINE_CAP);

    const verdict = verifyStageReportAdoption(report);
    expect(verdict.ok).toBe(false);
    // The count rule fires, in STE-532's own words — that is the delegation.
    expect(verdict.reasons.some((r) => /fence|block/i.test(r))).toBe(true);
    // …and the whole-report cap does NOT, because the span it was handed is the
    // one the carve-out funds.
    expect(verdict.reasons.filter(isWholeReportCapReason)).toEqual([]);
  });

  test("…and the SAME clause fires once the FILTERED span really is over the cap", () => {
    // Isolation. Without this leg the assertion above is satisfied by a grader
    // that simply never reports the cap on a blockless report.
    const spend = exemptSpendFor("implement");
    const pad =
      STAGE_REPORT_LINE_CAP + spend + 1 - lineCount(unblockedCleanFixture(0));
    expect(pad).toBeGreaterThan(0);
    const report = unblockedCleanFixture(pad);
    expect(lineCount(report) - spend).toBeGreaterThan(STAGE_REPORT_LINE_CAP);

    const verdict = verifyStageReportAdoption(report);
    expect(verdict.reasons.some(isWholeReportCapReason)).toBe(true);
  });

  test("PROOF the literal reading of the registration prose is FALSE", () => {
    // The registration says the count is "delegated to `verifyStageStatusBlock`,
    // in its own words". Called on the raw report — the only reading that prose
    // admits — the shipped grader refuses the committed LEGAL fixture.
    const base = verifyStageStatusBlock(read(CAPTURED_CLEAN));
    expect(base.ok).toBe(false);
    expect(base.reasons.some(isWholeReportCapReason)).toBe(true);
    // The same bytes, through the front door the probe actually runs: clean.
    expect(frontDoor(["--report", CAPTURED_CLEAN]).status).toBe(0);
  });

  test("probe #82's registration SAYS the delegation is on the exempt-filtered span", () => {
    const mine = probeRegistrationLines().find((r) =>
      r.line.includes(`\`${ADOPTION_PROBE_ID}\``),
    );
    expect(mine).toBeDefined();
    // Non-vacuity: the registration really does advertise the delegation, so
    // the per-sentence rule below has a subject.
    const advertising = sentencesOf(mine!.line).filter((s) =>
      s.includes("verifyStageStatusBlock"),
    );
    expect(advertising.length).toBeGreaterThan(0);
    // And EVERY sentence that advertises it says what it is called ON.
    for (const sentence of advertising) {
      expect(
        /exempt-filtered|exempt-section|cap-exempt sections removed|minus the cap-exempt|exempt lines removed/i.test(
          sentence,
        ),
        `probe #82 advertises the delegation without naming the span it runs on: ${sentence}`,
      ).toBe(true);
    }
  });
});

describe("FREQUENCY IS STATED HONESTLY — conformance-run enforcement, not gate-time", () => {
  test("no shipped surface claims the narration rules run at gate time", () => {
    const self = selfFr();
    // The FR is one of the four surfaces graded here; naming WHICH tree it came
    // from keeps a vanished subject from reading as a fourth clean surface.
    expect(["active", "archive"]).toContain(self.source);
    for (const [label, body] of [
      ["docs/stage-status-block.md", read(STATUS_BLOCK_DOC)],
      [self.rel, self.body],
      [".claude/skills/smoke-test/SKILL.md", smokeSkill()],
      [ADOPTION_MODULE_REL, read(ADOPTION_MODULE_SRC)],
    ] as const) {
      expect({ label, overpromises: claimsGateTimeNarration(body) }).toEqual({
        label,
        overpromises: false,
      });
    }
  });

  test("the contract doc STATES the real frequency — a conformance run", () => {
    expect(statesConformanceFrequency(read(STATUS_BLOCK_DOC))).toBe(true);
  });

  test("BOTH predicates are falsifiable — they fire on the sentences they name", () => {
    // Without this leg a predicate hard-wired to `false` (or to `true`) would
    // satisfy both tests above while measuring nothing.
    expect(
      claimsGateTimeNarration(
        "`verifyStageReportAdoption` grades narration on every gate run.",
      ),
    ).toBe(true);
    expect(
      claimsGateTimeNarration("The scanner runs on every gate run."),
    ).toBe(false);
    expect(
      statesConformanceFrequency(
        "Fixture group 15 runs `verifyStageReportAdoption` on every conformance leg.",
      ),
    ).toBe(true);
    expect(
      statesConformanceFrequency(
        "Fixture group 15 runs `verifyStageReportAdoption` over a captured report.",
      ),
    ).toBe(false);
  });

  test("probe #82's clauses are NOT widened to narration — the analysis stands", () => {
    // Operator decision: an AUTHORING-surface probe structurally cannot read a
    // rendered report's narration. Eleven SKILL.md carrying narration around a
    // compliant fence must still score clean.
    const narrated = Object.fromEntries(
      ADOPTING_STAGES.map((s) => [
        skillRel(s),
        [
          `# /${s}`,
          "",
          ...Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1} of legitimate documentation prose.\n`),
          adoptedSkillBody(s),
          "",
          "And more documentation prose below the fence, which is legitimate here.",
          "",
        ].join("\n"),
      ]),
    );
    const fx = tempProject(narrated);
    try {
      expect(scanStageBlockAdoption(fx.root)).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

// ============================================================================
// THE ROSTER-COUNT CASCADE — a new fixture group re-keys every count pin
// ============================================================================
//
// M116's lesson, restated by the STE-492 precedent that registered group 14:
// "a roster registration flips the count in every shipped count-pin suite".
// Naming the sites makes the re-key a REQUIREMENT rather than an accident
// discovered by a red gate an hour later.

/** The count these pins read BEFORE group 15 — the number that must be gone. */
const STALE_GROUP_COUNT = 14;

const ROSTER_COUNT_PINS: readonly (readonly [string, string])[] = [
  ["tests/m117-ste-425-falsifiable-coverage.test.ts", "toHaveLength({N})"],
  ["tests/m121-ste-451-fixture-group-10.test.ts", "toHaveLength({N})"],
  ["tests/m123-ste-464-deliver-skill.test.ts", "toHaveLength({N})"],
  ["tests/m124-ste-467-implement-lens.test.ts", "toHaveLength({N})"],
  ["tests/m129-ste-492-deliver-fence-producer.test.ts", "toHaveLength({N})"],
  ["tests/m125-ste-469-setup-template.test.ts", "CANONICAL_FIXTURE_GROUPS.length).toBe({N})"],
] as const;

describe("the roster-count cascade moved as one", () => {
  test("EVERY enumerated roster pin reads the live count — none left behind", () => {
    const live = CANONICAL_FIXTURE_GROUPS.length;
    expect(live).toBe(15);
    const missing: string[] = [];
    const stale: string[] = [];
    for (const [rel, template] of ROSTER_COUNT_PINS) {
      const body = read(join(PLUGIN_ROOT, ...rel.split("/")));
      if (!body.includes(fill(template, live))) missing.push(`${rel} — ${fill(template, live)}`);
      if (body.includes(fill(template, STALE_GROUP_COUNT))) {
        stale.push(`${rel} — ${fill(template, STALE_GROUP_COUNT)}`);
      }
    }
    // ANTI-VACUITY: an empty table reports a clean cascade by moving nothing.
    expect(ROSTER_COUNT_PINS.length).toBeGreaterThanOrEqual(6);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("the per-leg coverage lists widen to include group 15 on all three legs", () => {
    // Group 15 is rostered on the SMOKE_LEGS alias, so all three lists gain it.
    // A roster entry the coverage derivation never sees is a group that runs
    // nowhere — the shape STE-446 recorded when a hand-written leg copy went
    // stale.
    const body = read(
      join(PLUGIN_ROOT, "tests", "m121-ste-445-derivation-falsifiability.test.ts"),
    ).replace(/\s+/g, "");
    expect({ widened: body.split("14,15]").length - 1 }).toEqual({ widened: 3 });
  });

  test("the STE-492 re-key registry itself re-keys — a registry pinned at 14 is a stale pin", () => {
    // `m129-ste-492` carries a table asserting five sibling suites contain
    // `toHaveLength(14)`. Those suites move to 15, so the registry moves with
    // them or it fails on the very re-key it exists to enforce.
    const body = read(
      join(PLUGIN_ROOT, "tests", "m129-ste-492-deliver-fence-producer.test.ts"),
    );
    expect(body).not.toContain('expected: "toHaveLength(14)"');
    expect(body).toContain('expected: "toHaveLength(15)"');
  });
});

// ============================================================================
// M137 PRE-MERGE REVIEW — the AC-STE-533.2a carve-out, made load-bearing
// ============================================================================
//
// An adversarial review of PR #76 measured four ways in which the cap-exempt
// carve-out was INERT. Every number below was read off the shipped code, not
// reported:
//
//   1. THE CARVE-OUT DID NOT REACH ITS SECTIONS' CONTENT. `narrationLines`
//      forgave an exempt HEADING plus lines matching `LIST_ITEM_RE`, and the
//      shipped renderers emit neither: `renderImplementReportEvidence` emits
//      `gate:` / `drive:` / `e2e:` section names, and `## Advisory notes` with
//      zero entries emits one mandated sentence. All four were charged as
//      narration — exempt sections AFTER the block scored "4 non-blank line(s)
//      follow the status block", and nine narration lines plus the same
//      sections BEFORE it scored 13 over a 12-line cap. The effective lead-in
//      budget for the ONLY stage with exempt sections was 8, not 12.
//
//   2. THE CARVE-OUT WAS ARITHMETICALLY UNFUNDED.
//      `PROSE_LEAD_IN_LINE_CAP = STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2`
//      partitions all forty lines into fence, markers and prose, leaving ZERO
//      budget for the exempt sections — and `verifyStageStatusBlock` applies
//      the whole-report cap to every line, exempt or not. A report respecting
//      every stated budget to its face is 49 lines and was refused.
//
//   3. "EXEMPT IS NOT OPTIONAL" WAS UNENFORCED AT RUNTIME. `exemptHeadings`
//      was read ONLY to forgive lines from the narration count;
//      `verifyStageReportAdoption` never checked an owed section was PRESENT.
//      The milestone's own committed "compliant capture" fixture declared
//      `stage: implement`, carried NEITHER mandated section, and graded
//      `ok: true`. The one presence check that existed reads a SKILL.md body —
//      documentation, which no rendered report can change.
//
//   4. THE CARVE-OUT COVERED ONE STAGE. `/gate-check` and `/setup` were given
//      the same 12-line cap while their own SKILL.md still orders their reports
//      to reproduce verbatim artifacts, and neither has an exempt entry.
//      Disclosure is not resolution: AC-STE-533.2a says the exempt list IS the
//      resolution, and those stages have no entries in it.

/** Lines INSIDE the fence, markers excluded — the `ADOPTED_FENCE_LINE_CAP` subject. */
const fenceBodyLineCount = (report: string): number =>
  fenceCloseIndex(report) - fenceOpenIndex(report) - 1;

/**
 * The report that respects EVERY budget the contract states, each at its face
 * value: `PROSE_LEAD_IN_LINE_CAP` lines of narration, a fence body of exactly
 * `ADOPTED_FENCE_LINE_CAP` lines, its two markers, and every section the stage owes in
 * its smallest legal form.
 *
 * Composed from the SHIPPED constants, never typed: if any budget moves, this
 * construction moves with it rather than pinning yesterday's arithmetic.
 */
function maximalLegalReport(stage: string): string {
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
  return [
    ...Array.from(
      { length: PROSE_LEAD_IN_LINE_CAP },
      (_, i) => `Prose ${i + 1}: what the stage did, in the operator's language.`,
    ),
    STAGE_BLOCK_FENCE_BANNER,
    ...body,
    "```",
    ...owedSectionLines(stage),
  ].join("\n");
}

/** A markdown heading line, and a list item — the two shapes the module forgave. */
const IS_HEADING = (line: string): boolean => /^\s{0,3}#{1,6}\s+\S/.test(line);
const IS_LIST_ITEM = (line: string): boolean =>
  /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line);

describe("M137 review — an exempt section is forgiven as its RENDERER emits it", () => {
  test("THE MEASUREMENT: the shipped renderers emit lines that are neither heading nor list item", () => {
    const rendered = renderImplementReportEvidence({}).lines;
    expect(rendered[0]).toBe(IMPLEMENT_EVIDENCE_HEADING);
    const body = rendered.slice(1).filter((l) => l.trim().length > 0);
    expect(body.length).toBeGreaterThan(0);

    // The `gate:` / `drive:` / `e2e:` section names — driven off the shipped
    // section list, so this tracks the renderer rather than a snapshot of it.
    const neither = body.filter((l) => !IS_HEADING(l) && !IS_LIST_ITEM(l));
    expect(neither.map((l) => l.trim())).toEqual(
      (EVIDENCE_SECTIONS as readonly string[]).map((name) => `${name}:`),
    );

    // …and the advisory section's mandated empty-list line is the same shape.
    expect(IS_HEADING(ADVISORY_EMPTY_LITERAL)).toBe(false);
    expect(IS_LIST_ITEM(ADVISORY_EMPTY_LITERAL)).toBe(false);
  });

  test("every owed section, EXACTLY as its renderer emits it, is forgiven AFTER the block", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const owed = owedSectionLines(stage);
      if (owed.length === 0) continue;
      const report = [blockOnly(reportForStage(stage)), ...owed].join("\n");

      // THE CONSTRUCTION IS THE SUBJECT: there really is non-blank content
      // after the block, and it really does include the non-list lines above.
      const trailing = report
        .split("\n")
        .slice(fenceCloseIndex(report) + 1)
        .filter((l) => l.trim().length > 0);
      expect(trailing.length).toBeGreaterThan(0);
      expect(trailing.some((l) => !IS_HEADING(l) && !IS_LIST_ITEM(l))).toBe(true);

      expect({ stage, verdict: verifyStageReportAdoption(report) }).toEqual({
        stage,
        verdict: { ok: true, reasons: [] },
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("…and BEFORE it, alongside a FULL prose lead-in — the budget is 12, not 8", () => {
    const stage = "implement";
    const prose = Array.from(
      { length: PROSE_LEAD_IN_LINE_CAP },
      (_, i) => `Prose ${i + 1}.`,
    );
    const report = [
      ...prose,
      ...owedSectionLines(stage),
      blockOnly(reportForStage(stage)),
    ].join("\n");

    // The exempt sections really do push the fence past the raw cap — so the
    // exemption is what has to carry the verdict, not a short report.
    expect(fenceOpenIndex(report)).toBeGreaterThan(PROSE_LEAD_IN_LINE_CAP);
    // …and the report is UNDER STE-532's whole-report cap, so this leg cannot
    // be satisfied or refused by that other rule.
    expect(lineCount(report)).toBeLessThanOrEqual(STAGE_REPORT_LINE_CAP);

    expect(verifyStageReportAdoption(report)).toEqual({ ok: true, reasons: [] });
  });

  test("the boundary is still the STATED cap: one narration line more is refused", () => {
    const stage = "implement";
    const build = (n: number): string =>
      [
        ...Array.from({ length: n }, (_, i) => `Prose ${i + 1}.`),
        ...owedSectionLines(stage),
        blockOnly(reportForStage(stage)),
      ].join("\n");
    expect(verifyStageReportAdoption(build(PROSE_LEAD_IN_LINE_CAP)).ok).toBe(true);
    const over = verifyStageReportAdoption(build(PROSE_LEAD_IN_LINE_CAP + 1));
    expect(over.ok).toBe(false);
    expect(over.reasons.some(isProseCapReason)).toBe(true);
  });

  test("DISCRIMINATOR — free prose inside an exempt section is STILL refused", () => {
    const stage = "implement";
    const report = [
      blockOnly(reportForStage(stage)),
      ...owedSectionLines(stage),
      "And then the four paragraphs of narration this FR deleted, wearing a",
      "compliant heading so nobody notices they came back.",
    ].join("\n");
    expect(verifyStageReportAdoption(report).ok).toBe(false);
  });

  test("DISCRIMINATOR — a body line the renderer never emits is STILL refused", () => {
    // Isolation for the leg above: the carve-out admits the SHAPES the shipped
    // renderers emit, not everything under a correctly-spelled heading. A
    // grader that forgave the whole section would pass both legs while
    // measuring nothing.
    const stage = "implement";
    const mutant = [
      blockOnly(reportForStage(stage)),
      IMPLEMENT_EVIDENCE_HEADING,
      "The gate ran green, roughly, as far as anyone checked.",
      ...owedSectionLines(stage).filter((l) => l !== IMPLEMENT_EVIDENCE_HEADING),
    ].join("\n");
    // THE MUTATION APPLIED: the sentence really is in the report.
    expect(mutant).toContain("as far as anyone checked");
    expect(verifyStageReportAdoption(mutant).ok).toBe(false);
  });
});

describe("M137 review — the cap-exempt carve-out is arithmetically FUNDED", () => {
  test("THE MEASUREMENT: the three stated budgets already consume the whole-report cap", () => {
    // Fence body + its two markers + the prose lead-in = the WHOLE cap. There
    // is, by construction, nothing left over for the sections AC-STE-533.2a
    // exempts — which is why the exemption has to be funded rather than stated.
    expect(PROSE_LEAD_IN_LINE_CAP + ADOPTED_FENCE_LINE_CAP + 2).toBe(
      STAGE_REPORT_LINE_CAP,
    );
    expect(owedSectionLines("implement").length).toBeGreaterThan(0);
  });

  test("the MAXIMAL legal report — every stated budget at its face — is ACCEPTED", () => {
    const maximal = maximalLegalReport("implement");

    // The construction sits AT each stated budget…
    expect(fenceOpenIndex(maximal)).toBe(PROSE_LEAD_IN_LINE_CAP);
    expect(fenceBodyLineCount(maximal)).toBe(ADOPTED_FENCE_LINE_CAP);
    for (const entry of exemptSectionsFor("implement")) {
      expect(maximal).toContain(entry.heading);
    }
    // …and over the RAW whole-report cap, so the exemption is what must carry
    // it. Without this line the leg could pass on a report that simply fits.
    expect(lineCount(maximal)).toBeGreaterThan(STAGE_REPORT_LINE_CAP);

    expect(verifyStageReportAdoption(maximal)).toEqual({ ok: true, reasons: [] });
  });

  test("ISOLATION — the whole-report cap still refuses a report bloated with NARRATION", () => {
    const stage = "implement";
    const bloated = [
      ...Array.from(
        { length: STAGE_REPORT_LINE_CAP },
        (_, i) => `Prose ${i + 1}.`,
      ),
      blockOnly(reportForStage(stage)),
      ...owedSectionLines(stage),
    ].join("\n");
    const verdict = verifyStageReportAdoption(bloated);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((r) => /whole-report cap/i.test(r))).toBe(true);
  });

  test("ISOLATION — a stage that owes NOTHING gets no extra budget", () => {
    // `/setup` carries no exempt entry, so its maximal legal report is exactly
    // the cap and one line more inside the fence is refused by STE-532's cap.
    const stage = ADOPTING_STAGES.find((s) => exemptSectionsFor(s).length === 0);
    expect(stage).toBeDefined();
    const maximal = maximalLegalReport(stage!);
    expect(lineCount(maximal)).toBe(STAGE_REPORT_LINE_CAP);
    expect(verifyStageReportAdoption(maximal)).toEqual({ ok: true, reasons: [] });

    const over = maximal.replace(
      `  ${EMPTY_SECTION_FALLBACK}`,
      `  ${EMPTY_SECTION_FALLBACK}\n  - one row too many`,
    );
    // THE MUTATION APPLIED.
    expect(lineCount(over)).toBe(STAGE_REPORT_LINE_CAP + 1);
    const verdict = verifyStageReportAdoption(over);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((r) => /whole-report cap/i.test(r))).toBe(true);
  });
});

describe("M137 review — EXEMPT IS NOT OPTIONAL in a RENDERED report", () => {
  test("DIRECTION ONE — a report carrying every section it owes is ACCEPTED", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const owed = owedSectionLines(stage);
      if (owed.length === 0) continue;
      const full = [blockOnly(reportForStage(stage)), ...owed].join("\n");
      expect({ stage, verdict: verifyStageReportAdoption(full) }).toEqual({
        stage,
        verdict: { ok: true, reasons: [] },
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("DIRECTION TWO — dropping ONE owed section is REFUSED, and the refusal NAMES it", () => {
    // Driven off the REAL `CAP_EXEMPT_SECTIONS`, never a hand-typed list: an
    // entry added tomorrow is graded by this loop the day it lands.
    let checked = 0;
    for (const entry of CAP_EXEMPT_SECTIONS) {
      const kept = exemptSectionsFor(entry.stage).filter(
        (e) => e.heading !== entry.heading,
      );
      const without = [
        blockOnly(reportForStage(entry.stage)),
        ...kept.flatMap((e) => [...renderedExemptSection(e)]),
      ].join("\n");

      // THE MUTATION APPLIED: the section really is gone, and the others stay.
      expect(without).not.toContain(entry.heading);
      for (const e of kept) expect(without).toContain(e.heading);

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

  test("DOCUMENTATION CANNOT EXCUSE THE REPORT — the SKILL.md check is a different subject", () => {
    // The only presence check that shipped reads a SKILL.md body. This tree's
    // `/implement` SKILL.md names both sections, and `scanStageBlockAdoption`
    // is therefore silent — while the RENDERED report that dropped them is
    // still a violation. Two subjects, and the report's own one must fire.
    const skill = read(skillPath("implement"));
    for (const entry of exemptSectionsFor("implement")) {
      expect(skill).toContain(entry.heading);
    }
    expect(
      scanStageBlockAdoption(REPO_ROOT).filter((v) => v.stage === "implement"),
    ).toEqual([]);

    const dropped = blockOnly(reportForStage("implement"));
    for (const entry of exemptSectionsFor("implement")) {
      expect(dropped).not.toContain(entry.heading);
    }
    expect(verifyStageReportAdoption(dropped).ok).toBe(false);
  });

  test("ISOLATION — a stage that owes nothing is not made to carry another stage's section", () => {
    const stages = ADOPTING_STAGES.filter((s) => exemptSectionsFor(s).length === 0);
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      expect({ stage, verdict: verifyStageReportAdoption(blockOnly(reportForStage(stage))) })
        .toEqual({ stage, verdict: { ok: true, reasons: [] } });
    }
  });

  test("the committed 'compliant capture' fixture carries every section it OWES", () => {
    // The measured defect, on the milestone's own model artifact: it declared
    // `stage: implement`, carried NEITHER mandated section, and graded clean.
    const body = read(CAPTURED_CLEAN);
    const stage = /^\s*stage:\s*(\S+)/m.exec(body)?.[1];
    expect(stage).toBe("implement");
    let checked = 0;
    for (const entry of exemptSectionsFor(stage!)) {
      expect({ heading: entry.heading, carried: body.includes(entry.heading) }).toEqual({
        heading: entry.heading,
        carried: true,
      });
      checked += 1;
    }
    expect(checked).toBe(exemptSectionsFor(stage!).length);
    expect(checked).toBeGreaterThan(0);

    // The section bodies track the SHIPPED renderer's section names rather
    // than a hand-typed shape.
    const afterHeading = body.split(IMPLEMENT_EVIDENCE_HEADING)[1]!.split("\n").slice(1);
    const stop = afterHeading.findIndex(IS_HEADING);
    const evidenceBody = (stop < 0 ? afterHeading : afterHeading.slice(0, stop))
      .filter((l) => l.trim().length > 0 && !IS_LIST_ITEM(l))
      .map((l) => l.trim());
    expect(evidenceBody).toEqual(
      (EVIDENCE_SECTIONS as readonly string[]).map((name) => `${name}:`),
    );
    expect(body).toContain(ADVISORY_EMPTY_LITERAL);

    // …and the narrated twin carries them too, so the pair still differs by
    // narration ALONE.
    const narrated = read(CAPTURED_NARRATED);
    for (const entry of exemptSectionsFor(stage!)) {
      expect(narrated).toContain(entry.heading);
    }
  });
});

// ---------------------------------------------------------------------------
// The carve-out covers ONE stage (AC-STE-533.2a, widened to the eleven)
// ---------------------------------------------------------------------------

/** The cap sentence, matched on the LIVE number — never a typed 12. */
const CAP_SENTENCE_RE = new RegExp(
  `at most ${PROSE_LEAD_IN_LINE_CAP} lines of prose lead-in`,
  "i",
);

/** Does this stage's shipped SKILL.md put its report under the prose cap? */
const carriesProseCap = (stage: string): boolean =>
  CAP_SENTENCE_RE.test(read(skillPath(stage)));

/**
 * The heading block of a stage's SKILL.md that carries the cap sentence — the
 * section where that stage's closing report contract is written down.
 */
function closingSection(stage: string): { lines: string[]; capIndex: number } | null {
  const lines = read(skillPath(stage)).split("\n");
  const capIndex = lines.findIndex((l) => CAP_SENTENCE_RE.test(l));
  if (capIndex < 0) return null;
  let start = capIndex;
  while (start > 0 && !/^#{1,6}\s/.test(lines[start]!)) start -= 1;
  const level = (/^(#{1,6})\s/.exec(lines[start]!)?.[1] ?? "##").length;
  let end = start + 1;
  while (end < lines.length) {
    const m = /^(#{1,6})\s/.exec(lines[end]!);
    if (m !== null && m[1]!.length <= level) break;
    end += 1;
  }
  return { lines: lines.slice(start, end), capIndex: capIndex - start };
}

/** The `## Heading` literals the closing contract ORDERS the report to emit. */
function mandatedReportHeadings(stage: string): string[] {
  const section = closingSection(stage);
  if (section === null) return [];
  const text = section.lines.join("\n");
  const out = new Set<string>();
  for (const m of text.matchAll(
    /(?:render|append|emit|present|produce)[^.]{0,200}?`(## [^`]+)`/g,
  )) {
    out.add(m[1]!);
  }
  for (const m of text.matchAll(/`(## [^`]+)` section/g)) out.add(m[1]!);
  return [...out];
}

/**
 * The VERBATIM artifacts a stage's closing contract still orders its report to
 * reproduce — fenced blocks other than the status block itself.
 *
 * A section that says in so many words that the status block REPLACES or
 * SUPERSEDES its former shape has no such artifact left: the fence is a
 * reference to a retired shape, not an order. The cap sentence is excluded from
 * that scan, because every stage's cap sentence says the block "replaces the
 * narration" and reading it as a supersession would excuse all eleven.
 */
function mandatedVerbatimArtifacts(stage: string): string[][] {
  const section = closingSection(stage);
  if (section === null) return [];
  const superseded = section.lines.some(
    (l, i) => i !== section.capIndex && /\b(replaces|supersedes|superseded)\b/i.test(l),
  );
  if (superseded) return [];
  const out: string[][] = [];
  let current: string[] | null = null;
  let run = 0;
  let isStatusBlock = false;
  for (const line of section.lines) {
    const m = /^\s*(`{3,})(.*)$/.exec(line);
    if (m !== null) {
      if (current === null) {
        run = m[1]!.length;
        isStatusBlock = `\`\`\`${m[2]!.trim()}` === STAGE_BLOCK_FENCE_BANNER;
        current = [line];
        continue;
      }
      if (m[1]!.length >= run && m[2]!.trim().length === 0) {
        current.push(line);
        if (!isStatusBlock) out.push(current);
        current = null;
        continue;
      }
    }
    if (current !== null) current.push(line);
  }
  return out;
}

describe("M137 review — the carve-out covers EVERY capped stage, not one", () => {
  test("THE INSTRUMENT WORKS — the heading extractor finds /implement's two, and no phantoms", () => {
    // A scan that found nothing would pass the subset leg below while
    // measuring nothing at all.
    expect(mandatedReportHeadings("implement").sort()).toEqual(
      exemptSectionsFor("implement").map((e) => e.heading).sort(),
    );
    // …and it does not fire on a stage that mandates no report section.
    expect(mandatedReportHeadings("upgrade")).toEqual([]);
  });

  test("every capped stage's mandated report HEADINGS have a cap-exempt entry", () => {
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      if (!carriesProseCap(stage)) continue;
      const owed = exemptSectionsFor(stage).map((e) => e.heading);
      const mandated = mandatedReportHeadings(stage);
      expect({ stage, uncovered: mandated.filter((h) => !owed.includes(h)) }).toEqual({
        stage,
        uncovered: [],
      });
      checked += 1;
    }
    // Enumerated, never sampled: every one of the eleven carries the cap.
    expect(checked).toBe(ADOPTING_STAGES.length);
  });

  test("every VERBATIM artifact a capped stage still mandates is covered — or the cap does not apply", () => {
    // MEASURED on the shipped tree (2026-09-01): `/gate-check` (11 lines),
    // `/setup` (10) and `/spec-review` (3) each order their report to reproduce
    // a verbatim block that is NOT marked superseded and has NO cap-exempt
    // entry — structured content charged against a cap sized for free
    // narration. `/deps`, `/report-issue` and `/spec-write` name a block too
    // and write down that the status block supersedes it, which is what a
    // resolved collision looks like.
    //
    // Two remedies, both legitimate: give the artifact a cap-exempt entry, or
    // write down that the block supersedes the shape. What is not legitimate is
    // leaving the stage under a cap its own contract cannot satisfy.
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      if (!carriesProseCap(stage)) continue;
      const artifacts = mandatedVerbatimArtifacts(stage);
      const owed = exemptSectionsFor(stage);
      expect({
        stage,
        uncoveredArtifacts: owed.length > 0 ? 0 : artifacts.length,
      }).toEqual({ stage, uncoveredArtifacts: 0 });
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
  });

  test("THE ISOLATING HALF — the supersession scan really does discriminate", () => {
    // Without this leg the artifact scan could pass by finding nothing
    // anywhere. Some stage's closing contract DOES still name a block, and the
    // stages that retired theirs say so in writing.
    const named = ADOPTING_STAGES.filter(
      (s) => closingSection(s) !== null && /```/.test(closingSection(s)!.lines.join("\n")),
    );
    expect(named.length).toBeGreaterThan(0);
    const retired = ADOPTING_STAGES.filter((s) => {
      const section = closingSection(s);
      if (section === null) return false;
      return section.lines.some(
        (l, i) => i !== section.capIndex && /\b(replaces|supersedes)\b/i.test(l),
      );
    });
    expect(retired.length).toBeGreaterThan(0);
    expect(retired.length).toBeLessThan(ADOPTING_STAGES.length);
  });
});

// ===========================================================================
// PR #76 ROUND C — C3: THE ONE RUNTIME PATH HAS NO PRODUCER
// ===========================================================================
//
// Fixture group 15 is the ONLY runtime path claimed for
// `verifyStageReportAdoption` — the group added specifically to close the
// dead-grader gap. Its subject is `/tmp/dpt-smoke-<tracker>-ste533-stage-report.txt`
// and, measured 2026-09-01, NOTHING WRITES THAT FILE: the only occurrences of
// the literal repo-wide are group 15's own body, a comment in
// `m117-ste-425-falsifiable-coverage.test.ts` and the fixture README.
//
// So the group renders NOT-REACHED on every leg, forever, and
// `docs/stage-status-block.md`'s claim that the report-level rules are
// "enforced at conformance frequency rather than probe frequency — lower, and
// real" is false as written. A grader whose only consumer never runs is the
// dead grader this FR exists to prevent, one level up.
//
// Group 14 is the shipped shape and states its producer outright: "the driver
// writes the capture from the stage report text it did receive". Group 13a
// states its own ("captured by this sub-fixture's own spawn above"). Every
// other Source line names the phase that already captured it.
//
// The guard is therefore over EVERY Source line rather than over group 15
// alone: a group whose subject nothing writes must fail a test on the branch
// that adds it, which is the only way this does not recur silently.

/** Every `**Source:**` line in the smoke driver, with its 1-indexed line. */
function smokeSourceLines(): { line: number; text: string }[] {
  return read(SMOKE_SKILL)
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter((row) => row.text.startsWith("**Source:**"));
}

/**
 * The producer shapes the smoke driver already ships. A Source line has to name
 * WHO writes its subject; these are the four ways it currently does.
 *
 * Kept as a closed union rather than a "mentions a verb" heuristic: the whole
 * failure being closed is a Source line whose grammar implies a producer
 * ("the closing report captured from the last adopting stage") without there
 * being one.
 */
const PRODUCER_CLAUSE =
  /already captured during Phase|captured by this sub-fixture's own spawn|the driver writes|new spawns to/;

describe("C3 — every fixture group's subject has a PRODUCER, named on the Source line", () => {
  test("the scan has a real subject — the driver carries many Source lines", () => {
    const sources = smokeSourceLines();
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });

  test("THE INSTRUMENT WORKS — group 14's shipped Source line satisfies the predicate", () => {
    // Isolation. A predicate that matched nothing would make the guard below
    // red for the wrong reason; one that matched everything would make it
    // vacuous. Group 14 is the shape the review points at, read from the
    // driver rather than retyped.
    const block14 = fixtureGroupBlock(14);
    const source14 = block14.split("\n").find((l) => l.startsWith("**Source:**"));
    expect(source14).toBeDefined();
    expect(PRODUCER_CLAUSE.test(source14!)).toBe(true);
    // …and a Source line written without a producer does NOT satisfy it.
    expect(
      PRODUCER_CLAUSE.test(
        "**Source:** `/tmp/dpt-smoke-<tracker>-x.txt` — the report captured from the last stage the chain ran.",
      ),
    ).toBe(false);
  });

  test("no Source line names a subject with no producer", () => {
    const orphans = smokeSourceLines().filter((row) => !PRODUCER_CLAUSE.test(row.text));
    expect(
      orphans.map((row) => `SKILL.md:${row.line} — ${row.text.slice(0, 120)}`),
      "these fixture groups grade a file nothing in the driver writes, so they render " +
        "NOT-REACHED on every leg forever. Name the producer the way group 14 does " +
        "(`the driver writes the capture from …`), or point the group at a subject an " +
        "earlier phase already captured",
    ).toEqual([]);
  });

  test("group 15 in particular — the claim that it enforces at conformance frequency is EARNED", () => {
    const block = fixtureGroupBlock(ADOPTION_GROUP);
    const source = block.split("\n").find((l) => l.startsWith("**Source:**"));
    expect(source).toBeDefined();
    expect(PRODUCER_CLAUSE.test(source!)).toBe(true);
    // The contract doc makes the frequency claim; it is only true while the
    // group above actually runs. The two are asserted together on purpose —
    // separated, either can go stale without the other noticing.
    expect(statesConformanceFrequency(read(STATUS_BLOCK_DOC))).toBe(true);
  });
});

// ===========================================================================
// PR #76 ROUND C — C5: GROUP 15 MAY ONLY PIN WHAT EXIT 0 ENFORCES
// ===========================================================================
//
// The group's first assertion says exit 0 proves four things. Two are worth
// re-measuring rather than assuming:
//
//   "nothing after it but the cap-exempt sections the stage owes" — TRUE, and
//   only since Round A: the OWED half (a listed section that stopped being
//   emitted) is now graded on the report, not just on the SKILL.md.
//
//   "every canonical capability token inside the fence" — FALSE.
//   `locateCapabilityTokens` refuses tokens found OUTSIDE the fence and says
//   nothing about tokens that are absent, so a report carrying ZERO tokens
//   exits 0. The enforced property is "no token loose in the prose", which is
//   a different sentence.

/** The same report with every canonical capability token spelled away. */
const withoutCapabilityTokens = (report: string): string =>
  (CANONICAL_CAPABILITY_KEYS as readonly string[]).reduce(
    (acc, key) => acc.split(key).join("the gate stayed green"),
    report,
  );

describe("C5 — the group pins the enforced clause, not a stronger one", () => {
  test("MEASUREMENT — a report carrying NO capability token at all grades clean", () => {
    const stripped = withoutCapabilityTokens(read(CAPTURED_CLEAN));
    // The mutation applied: the clean fixture DID carry a token and now carries
    // none. Without this the leg below would pass on a fixture that never had
    // one.
    expect(locateCapabilityTokens(read(CAPTURED_CLEAN)).inBlock.length).toBeGreaterThan(0);
    expect(locateCapabilityTokens(stripped)).toEqual({ inBlock: [], outsideBlock: [] });
    // …and the grader accepts it. So exit 0 cannot prove "every canonical
    // capability token is inside the fence".
    expect(verifyStageReportAdoption(stripped)).toEqual({ ok: true, reasons: [] });
  });

  test("the group's token clause names the direction the grader actually refuses", () => {
    const block = fixtureGroupBlock(ADOPTION_GROUP);
    const tokenLines = block.split("\n").filter((l) => /capability token/i.test(l));
    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) {
      expect(
        /every canonical capability token inside the fence/i.test(line),
        "exit 0 does not prove the canonical set is PRESENT — only that no token " +
          "found in the report sits outside the block",
      ).toBe(false);
    }
    expect(
      tokenLines.some((l) => /outside|loose/i.test(l)),
      "state the enforced direction: a token loose in the prose is the refusal",
    ).toBe(true);
  });

  test("the OWED-section clause IS enforced, so the group may keep pinning it", () => {
    // The other half of C5, kept honest by measurement rather than by
    // assumption. Dropping a cap-exempt section the stage owes is refused ON
    // THE REPORT, and the refusal names the section.
    const clean = read(CAPTURED_CLEAN);
    const owed = exemptSectionsFor("implement");
    expect(owed.length).toBeGreaterThan(0);
    const heading = owed[0]!.heading;
    const dropped = clean
      .split("\n")
      .filter((line) => line.trim() !== heading)
      .join("\n");
    expect(dropped).not.toBe(clean);
    const verdict = verifyStageReportAdoption(dropped);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((r) => r.includes(heading))).toBe(true);
  });
});

// ===========================================================================
// PR #76 ROUND C — F2: THE COUNTS-WITHOUT-CAPTURE RULE CANNOT FIRE AT RUNTIME
// ===========================================================================
//
// AC-STE-532.5's headline is that "a number that traces to nothing is refused".
// The rule is gated behind the optional `evidence` parameter, and measured
// 2026-09-01 NO runtime path supplies one: the `--report` front door calls
// `verifyStageReportAdoption(body)` with a single argument, so `evidence` is
// `undefined` on every real invocation and the refusal exists only under unit
// test.
//
// Two honest resolutions, and the surface must take one of them:
//
//   WIRE IT — pass an evidence object through the `--report` front door. A
//   captured report has no run behind it, so whatever is passed has to be
//   something the capture itself can honestly supply.
//
//   DECLARE IT — say plainly, at the surface a reader meets, that the counts
//   rule is not graded off a capture. A rule documented as enforced and
//   enforced nowhere is worse than one documented as unenforced.
//
// What is NOT acceptable is a third path invented to make the guard green.

/** Argument lists of every CALL to `symbol` in `src` — the declaration excluded. */
function callArgLists(src: string, symbol: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${symbol}\\s*\\(`, "g");
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const before = src.slice(0, m.index);
    if (/\b(?:function|const|let|var)\s+$/.test(before)) continue;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    out.push(src.slice(m.index + m[0].length, i).trim());
  }
  return out;
}

/** Top-level comma count + 1 — how many arguments a call passes. */
function arityOf(args: string): number {
  if (args.trim().length === 0) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of args) {
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) count += 1;
  }
  return count;
}

describe("F2 — the counts-without-capture rule is wired at runtime OR declared test-only", () => {
  test("THE INSTRUMENT WORKS — the arity walk reads a two-argument call correctly", () => {
    const probe = [
      "export function verifyStageReportAdoption(report: string, evidence?: X) {}",
      "const a = verifyStageReportAdoption(body);",
      "const b = verifyStageReportAdoption(body, evidenceFor(run, { deep: 1 }));",
    ].join("\n");
    const calls = callArgLists(probe, "verifyStageReportAdoption");
    expect(calls.map(arityOf)).toEqual([1, 2]);
  });

  test("the module's runtime call sites are MEASURED, and the count is stated", () => {
    const src = read(ADOPTION_MODULE_SRC);
    const calls = callArgLists(src, "verifyStageReportAdoption");
    // Non-vacuity: the front door really does call it. A walk that found no
    // call would satisfy the disjunction below for free.
    expect(calls.length).toBeGreaterThan(0);
  });

  test("either the front door PASSES evidence, or the surface SAYS the rule cannot fire there", () => {
    const src = read(ADOPTION_MODULE_SRC);
    const wired = callArgLists(src, "verifyStageReportAdoption").some(
      (args) => arityOf(args) >= 2,
    );

    const surfaces = `${src}\n${read(STATUS_BLOCK_DOC)}`;
    const declared = surfaces
      .split(/(?<=[.!?])\s+/)
      .some(
        (s) =>
          /counts?[- ]without[- ]capture|count with no capture|counts.{0,40}captur/i.test(s) &&
          /not graded|never graded|cannot fire|does not fire|no evidence|test-only|unit tests only|off a capture/i.test(
            s,
          ),
      );

    expect(
      { wired, declared, satisfied: wired || declared },
      "AC-STE-532.5's refusal is gated behind an optional `evidence` argument that no " +
        "runtime path supplies, so the headline rule fires only under unit test. Wire " +
        "evidence through the `--report` front door with something a capture can " +
        "honestly supply, or state plainly at the surface that the rule is not graded " +
        "off a capture. Do not invent a runtime path to make this green",
    ).toMatchObject({ satisfied: true });
  });
});

// ===========================================================================
// PR #76 ROUND C — F5: A RULE SET COUNTED BY A LITERAL, FOR THE FOURTH TIME
// ===========================================================================
//
// `stage_block_adoption.ts`'s header says "four REPORT-LEVEL rules" and
// enumerates 1-4. `docs/stage-status-block.md` heads the same list "The six
// adoption rules" and enumerates 1-6. `verifyStageReportAdoption` grades six.
//
// This is the FOURTH instance of the class in one milestone, and the repository
// already wrote down the remedy: `docs/prose-altitude.md` § Counting a rule set
// says to let a numbered list be its own count, and to name the binding
// wherever prose genuinely needs the numeral.

/** `//   N. …` items in a module's leading `//` header comment. */
function headerRuleItems(src: string): number[] {
  const header: string[] = [];
  for (const line of src.split("\n")) {
    if (!line.startsWith("//")) break;
    header.push(line);
  }
  return header
    .map((l) => /^\/\/\s+(\d+)\.\s+\S/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

/** `N. …` items in the markdown section opened by `heading`. */
function docRuleItems(body: string, heading: RegExp): number[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  expect(start).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  return (end < 0 ? rest : rest.slice(0, end))
    .map((l) => /^(\d+)\.\s+\S/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

describe("F5 — the header's rule set and the doc's rule set are the SAME set", () => {
  test("both surfaces enumerate a real, contiguous list", () => {
    const headerItems = headerRuleItems(read(ADOPTION_MODULE_SRC));
    const docItems = docRuleItems(read(STATUS_BLOCK_DOC), /^## The \w+ adoption rules\s*$/);
    expect(headerItems.length).toBeGreaterThan(0);
    expect(docItems.length).toBeGreaterThan(0);
    expect(headerItems).toEqual(headerItems.map((_, i) => i + 1));
    expect(docItems).toEqual(docItems.map((_, i) => i + 1));
  });

  test("the module header enumerates every rule the contract states — not a stale prefix", () => {
    const headerItems = headerRuleItems(read(ADOPTION_MODULE_SRC));
    const docItems = docRuleItems(read(STATUS_BLOCK_DOC), /^## The \w+ adoption rules\s*$/);
    expect(headerItems.length).toBe(docItems.length);
  });

  test("no surface restates the count as a numeral that disagrees with its own list", () => {
    const src = read(ADOPTION_MODULE_SRC);
    const headerItems = headerRuleItems(src);
    const header = src.split("\n").filter((l) => l.startsWith("//")).join("\n");
    for (const m of header.matchAll(/\b(\w+)\s+REPORT-LEVEL rules\b/gi)) {
      const stated = NUMBER_WORDS[m[1]!.toLowerCase()] ?? Number(m[1]);
      expect({ stated, listed: headerItems.length }).toEqual({
        stated: headerItems.length,
        listed: headerItems.length,
      });
    }
    const doc = read(STATUS_BLOCK_DOC);
    const docHeading = /^## The (\w+) adoption rules\s*$/m.exec(doc);
    expect(docHeading).not.toBeNull();
    const docStated = NUMBER_WORDS[docHeading![1]!.toLowerCase()] ?? Number(docHeading![1]);
    expect(docStated).toBe(
      docRuleItems(doc, /^## The \w+ adoption rules\s*$/).length,
    );
  });

  test("the fourth instance is RECORDED beside the three the milestone already logged", () => {
    // `docs/prose-altitude.md` § Counting a rule set enumerates the corrected
    // surfaces. A running tally that stops one short is the same defect it is
    // a record of.
    const doc = readFileSync(
      join(PLUGIN_ROOT, "docs", "prose-altitude.md"),
      "utf-8",
    );
    expect(doc).toContain("stage_block_adoption.ts");
  });
});

// ============================================================================
// AC-STE-533.1a, ARITHMETIC HALF — the adopting contract owns its OWN fence cap
// ============================================================================
//
// THE COUPLING THIS SECTION BREAKS (operator decision, M137 round 5).
//
// `FENCE_LINE_CAP` lives in `adapters/_shared/src/deliver_stage_capture.ts` —
// /deliver's module, /deliver's contract — and `stage_block_adoption.ts`
// derived the ELEVEN adopting stages' prose budget from it. AC-STE-533.1a split
// those two banners on the argument that they are TWO CONTRACTS WITH TWO
// OWNERS; the arithmetic stayed joined, so a /deliver retune silently moved
// eleven stages' prose budget across the seam the FR declares severed.
//
// MEASURED, before the split: rewriting `FENCE_LINE_CAP = 26` to `30` in a copy
// of the shared tree moved `PROSE_LEAD_IN_LINE_CAP` from 12 to 8 in the same
// copy, with no edit to the adopting module at all.
//
// The adopting contract now names its own fence cap, in its own home. The two
// may hold the SAME VALUE today — that is expected, and it is not the subject.
// THE DELIVERABLE IS THE INDEPENDENCE, proven by mutation below.

const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

/** A delta big enough that no budget's mutant collides with another's value. */
const FENCE_CAP_MUTATION_DELTA = 4;

/** A throwaway copy of the shared source tree, for one mutation. */
function withMutatedSharedTree<T>(
  label: string,
  mutate: (copySrc: string) => void,
  use: (copySrc: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), `ste-533-${label}-`));
  const copySrc = join(dir, "src");
  cpSync(SHARED_SRC, copySrc, { recursive: true });
  mutate(copySrc);
  return use(copySrc).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** Rewrite `export const <name> = <from>;` to `<to>`, asserting it APPLIED. */
function retuneConst(path: string, name: string, from: number, to: number): void {
  const original = read(path);
  const anchor = `export const ${name} = ${from};`;
  // A mutation that never applied reads as a pass. Assert the anchor is present
  // exactly once BEFORE relying on the rewrite.
  expect(
    original.split(anchor).length - 1,
    `${name} is not declared as \`${anchor}\` — the mutation would be a no-op`,
  ).toBe(1);
  writeFileSync(path, original.replace(anchor, `export const ${name} = ${to};`), "utf-8");
}

describe("AC-STE-533.1a — the adopting contract's fence cap is its OWN", () => {
  test("`ADOPTED_FENCE_LINE_CAP` is exported by the ADOPTING module", () => {
    expect(Number.isInteger(ADOPTED_FENCE_LINE_CAP)).toBe(true);
    expect(ADOPTED_FENCE_LINE_CAP).toBeGreaterThan(0);
    expect(ADOPTED_FENCE_LINE_CAP).toBeLessThan(STAGE_REPORT_LINE_CAP);
  });

  test("it is DECLARED there — not an alias, not a re-export, not a copy of the import", () => {
    const src = read(ADOPTION_MODULE_SRC);
    // Its own home, its own literal.
    expect(src).toMatch(
      new RegExp(String.raw`export const ADOPTED_FENCE_LINE_CAP\s*=\s*\d+\s*;`),
    );
    // Not `export { FENCE_LINE_CAP as ADOPTED_FENCE_LINE_CAP } from …`
    expect(src).not.toMatch(/export\s*\{[^}]*FENCE_LINE_CAP[^}]*\}\s*from/);
    // Not `export const ADOPTED_FENCE_LINE_CAP = FENCE_LINE_CAP`
    expect(src).not.toMatch(/ADOPTED_FENCE_LINE_CAP\s*=\s*FENCE_LINE_CAP\b/);
  });

  test("the adopting module no longer IMPORTS /deliver's fence cap", () => {
    const src = read(ADOPTION_MODULE_SRC);
    const block = /import\s*\{([^}]*)\}\s*from\s*"\.\/deliver_stage_capture"/.exec(src);
    // Non-vacuity: the import really is there, so the exclusion below has a
    // subject. The BANNER still crosses the seam on purpose — each grader must
    // refuse the other's banner, which is a claim about the other's bytes.
    expect(block, "the adopting module no longer imports from ./deliver_stage_capture").not.toBeNull();
    const named = block![1]!
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
      .filter((s) => s.length > 0);
    expect(named).toContain("DELIVER_STAGE_FENCE_BANNER");
    // …the ARITHMETIC does not.
    expect(named).not.toContain("FENCE_LINE_CAP");
  });

  test("THE DELIVERABLE — a /deliver fence-cap retune moves NO adopting stage's prose cap", async () => {
    await withMutatedSharedTree(
      "deliver-retune",
      (copySrc) =>
        retuneConst(
          join(copySrc, "deliver_stage_capture.ts"),
          "FENCE_LINE_CAP",
          FENCE_LINE_CAP,
          FENCE_LINE_CAP + FENCE_CAP_MUTATION_DELTA,
        ),
      async (copySrc) => {
        // THE MUTATION IS LIVE in the copy — read back off the copy's own module.
        const capture = await import(join(copySrc, "deliver_stage_capture.ts"));
        expect(capture.FENCE_LINE_CAP).toBe(FENCE_LINE_CAP + FENCE_CAP_MUTATION_DELTA);
        expect(capture.FENCE_LINE_CAP).not.toBe(FENCE_LINE_CAP);

        // …and the adopting contract, out of THE SAME COPY, did not move.
        const adoption = await import(join(copySrc, "stage_block_adoption.ts"));
        expect(
          adoption.ADOPTED_FENCE_LINE_CAP,
          "/deliver's fence cap moved the adopting contract's fence cap: the two are re-coupled",
        ).toBe(ADOPTED_FENCE_LINE_CAP);
        expect(
          adoption.PROSE_LEAD_IN_LINE_CAP,
          "/deliver's fence cap moved eleven adopting stages' prose budget across the seam AC-STE-533.1a declares severed",
        ).toBe(PROSE_LEAD_IN_LINE_CAP);
      },
    );
  });

  test("HARNESS CONTROL — retuning the ADOPTING cap in the same copy DOES move its prose cap", async () => {
    // Without this leg the independence assertion above is satisfied by a
    // harness that cannot see movement at all — a stale module cache, a copy
    // that never loaded, an import resolving back to the real tree. This leg
    // fails in exactly those worlds and passes only when the harness measures.
    await withMutatedSharedTree(
      "adopting-retune",
      (copySrc) =>
        retuneConst(
          join(copySrc, "stage_block_adoption.ts"),
          "ADOPTED_FENCE_LINE_CAP",
          ADOPTED_FENCE_LINE_CAP,
          ADOPTED_FENCE_LINE_CAP + FENCE_CAP_MUTATION_DELTA,
        ),
      async (copySrc) => {
        const adoption = await import(join(copySrc, "stage_block_adoption.ts"));
        expect(adoption.ADOPTED_FENCE_LINE_CAP).toBe(
          ADOPTED_FENCE_LINE_CAP + FENCE_CAP_MUTATION_DELTA,
        );
        // The prose cap is still DERIVED — it moved by exactly the delta, the
        // other way. A cap that ignored its own fence budget would be a second
        // hand-typed number, which is the drift the derivation exists to stop.
        expect(adoption.PROSE_LEAD_IN_LINE_CAP).toBe(
          PROSE_LEAD_IN_LINE_CAP - FENCE_CAP_MUTATION_DELTA,
        );
        // /deliver's cap, untouched in this copy, is where it always was.
        const capture = await import(join(copySrc, "deliver_stage_capture.ts"));
        expect(capture.FENCE_LINE_CAP).toBe(FENCE_LINE_CAP);
      },
    );
  });

  test("no shipped surface describes the ADOPTING prose cap as derived from /deliver's cap", () => {
    // The prose must name the owner the code reads. A doc line saying
    // `STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2` after the split points the
    // reader across the seam it was cut to close.
    //
    // The subject is an ARITHMETIC statement — `± FENCE_LINE_CAP` on a line
    // that names the adopting cap — not any sentence that happens to mention
    // both. A line CONTRASTING the two contracts is legitimate prose and stays
    // legal; a line that adds or subtracts across the seam does not.
    const derivesAcrossTheSeam = (line: string): boolean =>
      /[-+−]\s*(?<!ADOPTED_)FENCE_LINE_CAP\b/.test(line);

    const surfaces = [STATUS_BLOCK_DOC, ADOPTION_MODULE_SRC];
    let stating = 0;
    for (const path of surfaces) {
      for (const line of read(path).split("\n")) {
        if (!line.includes("PROSE_LEAD_IN_LINE_CAP")) continue;
        // The POPULATION, counted before the rule is applied — so the
        // non-vacuity gate below still measures something once every line has
        // been corrected.
        stating += 1;
        expect(
          derivesAcrossTheSeam(line),
          `${path} derives the adopting prose cap from /deliver's cap: ${line.trim()}`,
        ).toBe(false);
      }
    }
    // Non-vacuity: the surfaces really do talk about this cap.
    expect(stating).toBeGreaterThan(0);
    // …and the rule can fire — the isolating half, so the sweep above is not a
    // predicate that answers `false` for everything.
    expect(
      derivesAcrossTheSeam(
        "`PROSE_LEAD_IN_LINE_CAP`, derived as `STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2`",
      ),
    ).toBe(true);
    expect(
      derivesAcrossTheSeam(
        "`PROSE_LEAD_IN_LINE_CAP` = `STAGE_REPORT_LINE_CAP - ADOPTED_FENCE_LINE_CAP - 2`",
      ),
    ).toBe(false);
  });
});

// ============================================================================
// THE ARITHMETIC — three budgets, three INDEPENDENT expected values
// ============================================================================
//
// THE DEFECT THIS REPLACES. `expect(PROSE_LEAD_IN_LINE_CAP).toBe(
// STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2)` restates the very expression the
// module computes the constant with, so both sides move together. Mutation-
// tested (fence cap 26 → 30): that assertion stayed GREEN while five unrelated
// tests reddened. The arithmetic was protected only INCIDENTALLY — by tests
// that happen to depend on the values — and those can be rewritten for their
// own reasons, at which point the protection vanishes while the assertion that
// LOOKS like the guard stays green.
//
// The three numbers below are therefore HAND-TYPED, deliberately, against this
// file's usual rule of reading every number off an export. That rule buys
// tracking; here tracking is the defect. A retune of any one budget reddens a
// test NAMED for the arithmetic, and its message says which budget moved and
// what that did to the others.

interface Budget {
  readonly name: string;
  readonly what: string;
  readonly actual: () => number;
  readonly expected: number;
}

const BUDGETS: readonly Budget[] = [
  {
    name: "STAGE_REPORT_LINE_CAP",
    what: "STE-532's whole-report cap — every line a rendered report may carry",
    actual: () => STAGE_REPORT_LINE_CAP,
    expected: 40,
  },
  {
    name: "ADOPTED_FENCE_LINE_CAP",
    what: "the adopting contract's own fence-body cap",
    actual: () => ADOPTED_FENCE_LINE_CAP,
    expected: 26,
  },
  {
    name: "PROSE_LEAD_IN_LINE_CAP",
    what: "the prose lead-in cap, derived from the two above",
    actual: () => PROSE_LEAD_IN_LINE_CAP,
    expected: 12,
  },
];

/** Every budget's current value against its expected one — the whole picture. */
const budgetLedger = (): string =>
  BUDGETS.map(
    (b) =>
      `${b.name} = ${b.actual()} (expected ${b.expected})${
        b.actual() === b.expected ? "" : "   ← MOVED"
      }`,
  ).join("\n");

describe("THE ARITHMETIC — the three budgets, pinned to independent values", () => {
  for (const budget of BUDGETS) {
    test(`${budget.name} is ${budget.expected} — ${budget.what}`, () => {
      expect(
        budget.actual(),
        `${budget.name} was retuned. The three budgets now read:\n${budgetLedger()}\n` +
          "They are a PARTITION of the whole report — fence body + its two " +
          "markers + prose lead-in — so moving one moves what the others may " +
          "spend. Retune the expected values here, in the same commit, and " +
          "restate the numbers on every surface that carries them.",
      ).toBe(budget.expected);
    });
  }

  test("the three PARTITION the whole report, with the fence's two markers and nothing over", () => {
    const FENCE_MARKERS = 2;
    const report = BUDGETS.find((b) => b.name === "STAGE_REPORT_LINE_CAP")!;
    const fence = BUDGETS.find((b) => b.name === "ADOPTED_FENCE_LINE_CAP")!;
    const prose = BUDGETS.find((b) => b.name === "PROSE_LEAD_IN_LINE_CAP")!;
    // Asserted on the EXPECTED values, not the live ones: this is the claim the
    // three literals above make about each other, and it must hold on them
    // whether or not the module currently agrees.
    expect(fence.expected + FENCE_MARKERS + prose.expected).toBe(report.expected);
    // …and then the live values are held to the same shape, so a retune that
    // kept the sum but moved the split still reddens a named test above.
    expect(fence.actual() + FENCE_MARKERS + prose.actual()).toBe(report.actual());
  });
});
