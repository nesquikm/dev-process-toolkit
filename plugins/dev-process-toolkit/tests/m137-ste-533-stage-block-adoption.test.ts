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
  CAP_EXEMPT_SECTIONS,
  PROBE_ID as ADOPTION_PROBE_ID,
  PROSE_LEAD_IN_LINE_CAP,
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
    expect(verifyStageReportAdoption(appendAfterBlock(CLEAN, "\n  \n")).ok).toBe(
      true,
    );
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
    expect(verifyStageReportAdoption(CLEAN)).toEqual({ ok: true, reasons: [] });
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
    const heading = "## Verification evidence";
    const body = ["", heading, "", "- gate: pass 1, fail 0", ""];
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
  test("an AC-2a exempt section MAY follow the block", () => {
    const entry = CAP_EXEMPT_SECTIONS.find((e) => e.stage === "implement");
    expect(entry).toBeDefined();
    const trailing = appendAfterBlock(
      reportForStage("implement"),
      ["", entry!.heading, "", "- gate: pass 1, fail 0"].join("\n"),
    );
    // The mutation applied: there really is non-blank content after the block.
    expect(trailing.split("\n").slice(fenceCloseIndex(trailing) + 1).join("").trim().length)
      .toBeGreaterThan(0);
    expect(verifyStageReportAdoption(trailing)).toEqual({ ok: true, reasons: [] });
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

  test("THE PROBE IS NOT PRESENCE-ONLY — eleven fences with a broken contract still violate", async () => {
    const adopted = Object.fromEntries(
      ADOPTING_STAGES.map((s) => [skillRel(s), adoptedSkillBody(s)]),
    );
    const fx = tempProject(adopted);
    try {
      const clean = await runStageBlockAdoptionProbe(fx.root);
      expect(clean.violations).toEqual([]);

      // MUTATION: every stage keeps its fence — presence is untouched — but
      // one drops a listed exempt section. Under presence-only grading this
      // scores zero, which is precisely the vacuity AC-STE-533.8 refuses.
      const entry = CAP_EXEMPT_SECTIONS[0]!;
      const abs = join(fx.root, ...skillRel(entry.stage).split("/"));
      const before = read(abs);
      writeFileSync(abs, before.split(entry.heading).join("## Something else"), "utf-8");
      // THE MUTATION APPLIED, and the fence SURVIVED it.
      expect(read(abs)).not.toContain(entry.heading);
      expect(emitsBanner(read(abs), STAGE_BLOCK_FENCE_BANNER)).toBe(true);

      const after = await runStageBlockAdoptionProbe(fx.root);
      expect(after.violations.length).toBeGreaterThan(0);
      expect(after.violations.some((v) => v.note.includes(entry.stage))).toBe(true);
    } finally {
      fx.cleanup();
    }
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
    const frBody = read(join(REPO_ROOT, "specs", "frs", "STE-533.md"));
    expect(ADOPTING_STAGES.every((s) => frBody.includes(s))).toBe(true);
    expect(/only here/i.test(doc)).toBe(false);

    // What the doc must still say — dropping the claim is the fix, deleting
    // the pointer is not.
    expect(doc).toContain("ADOPTING_STAGES");
    expect(doc).toContain(ADOPTION_MODULE_REL);
  });
});
