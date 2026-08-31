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
//   AC-STE-533.2 — the block REPLACES narration: a stated prose cap, and the
//                  discriminating case where STE-532 says ok and adoption does
//                  not
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
  ADOPTING_STAGES,
  PROSE_LEAD_IN_LINE_CAP,
  locateCapabilityTokens,
  scanStageBlockAdoption,
  verifyStageReportAdoption,
} from "../adapters/_shared/src/stage_block_adoption";
import {
  EMPTY_SECTION_FALLBACK,
  LIST_STATUS_SECTIONS,
  SCALAR_STATUS_SECTIONS,
  STAGE_REPORT_LINE_CAP,
  STAGE_STATUS_SECTIONS,
  verifyStageStatusBlock,
} from "../adapters/_shared/src/stage_status_block";
import {
  DELIVER_STAGE_FENCE_BANNER,
  DELIVER_STAGE_IDS,
  FENCE_LINE_CAP,
} from "../adapters/_shared/src/deliver_stage_capture";
import {
  CANONICAL_CAPABILITY_KEYS,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
// The reusable non-test-consumer guard, extracted out of
// `tests/m137-ste-535-plan-narrative-cap.test.ts` under STE-533 so both suites
// share ONE walk. Classifies by FILE PATH, never by line content.
import { consumerFiles } from "./_module_consumers";

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

const read = (path: string): string => readFileSync(path, "utf-8");

/** Trailing newline stripped so every line count in this file means one thing. */
const fixture = (name: string): string =>
  read(join(FIXTURE_DIR, name)).replace(/\n+$/, "");

/** The shipped model report — 12 prose lines, a 17-line fence, 29 total. */
const CLEAN = fixture("worker-stage-report.txt");

// ------------------------------------------------------------- report surgery

const FENCE_OPEN_RE = new RegExp(
  `^[ \\t]*${DELIVER_STAGE_FENCE_BANNER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`,
);
const FENCE_CLOSE_RE = /^[ \t]*```[ \t]*$/;

const lineCount = (text: string): number => text.split("\n").length;

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

/**
 * The stage's report, with the `stage:` scalar rewritten. Adoption spans
 * eleven stages, only one of which the shipped fixture names, so a per-stage
 * loop has to be able to speak every stage's name.
 */
function reportForStage(stage: string): string {
  return CLEAN.replace(/^(\s*stage:).*$/m, `$1 ${stage}`);
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
    // STE-532 sized its whole-report cap as "the 26 lines the fence itself may
    // hold, its two markers, and a dozen lines of prose". That third term IS
    // this cap, so it is computed from the other two rather than typed twice —
    // a hand-picked number here would let the two budgets drift apart.
    expect(PROSE_LEAD_IN_LINE_CAP).toBe(STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2);
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
    expect(fenceOpenIndex(CLEAN)).toBe(PROSE_LEAD_IN_LINE_CAP);
    expect(verifyStageReportAdoption(CLEAN)).toEqual({ ok: true, reasons: [] });
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
    const atCap = withProseLines(CLEAN, PROSE_LEAD_IN_LINE_CAP);
    const overCap = withProseLines(CLEAN, PROSE_LEAD_IN_LINE_CAP + 1);
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
    const inside = blockOnly(CLEAN).replace(
      /^(summary:)$/m,
      `$1\n  - closing capability: \`${token}\``,
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
    const noise = ["A run mentioning `not_a_capability_key`.", blockOnly(CLEAN)].join(
      "\n",
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
  return [DELIVER_STAGE_FENCE_BANNER, ...body, "```"].join("\n");
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
    section.includes(DELIVER_STAGE_FENCE_BANNER) ||
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
      section.includes(DELIVER_STAGE_FENCE_BANNER) ||
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
    expect(twice.split(DELIVER_STAGE_FENCE_BANNER).length - 1).toBe(2);
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
    expect(verifyStageReportAdoption(appendAfterBlock(CLEAN, "\n  \n")).ok).toBe(
      true,
    );
  });

  test("a report with no block at all fails", () => {
    const proseOnly = CLEAN.split("\n").slice(0, fenceOpenIndex(CLEAN)).join("\n");
    expect(proseOnly).not.toContain(DELIVER_STAGE_FENCE_BANNER);
    expect(verifyStageReportAdoption(proseOnly).ok).toBe(false);
  });

  test("the adoption module BUILDS ON STE-532 rather than re-parsing", () => {
    const src = read(ADOPTION_MODULE_SRC);
    expect(src).toContain("./stage_status_block");
    expect(src).toContain("verifyStageStatusBlock");
    // The banner is IMPORTED, never restated: a second literal is the
    // two-renderers defect STE-532's own header calls out.
    expect(src).toContain("DELIVER_STAGE_FENCE_BANNER");
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
          [`# /${s}`, "", DELIVER_STAGE_FENCE_BANNER, "stage: " + s, "```", ""].join(
            "\n",
          ),
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
        expect(read(abs)).not.toContain(DELIVER_STAGE_FENCE_BANNER);

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
// THE ANTI-VACUITY GUARD — STE-532's module must have a REAL consumer
// ============================================================================
//
// `stage_status_block.ts` shipped with ZERO production consumers: its only
// referent was its own test. This repository has TWICE shipped a headline
// feature that could never fire, both times preceded by "by design, a later FR
// consumes it". STE-533 IS that later FR, so these assertions are the FR's
// exit condition, not decoration.

describe("STE-532's grader has a real production consumer after STE-533", () => {
  test("stage_status_block.ts is referenced by at least one NON-TEST file", () => {
    const files = consumerFiles(STATUS_BLOCK_REL);
    expect(files.length).toBeGreaterThan(0);
  });

  test("the adoption module itself is referenced by a NON-TEST file", () => {
    const files = consumerFiles(ADOPTION_MODULE_REL);
    expect(files.length).toBeGreaterThan(0);
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
