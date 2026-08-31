// stage_block_adoption — the ADOPTION POLICY over the STE-532 grader (STE-533).
//
// STE-532 landed `verifyStageStatusBlock`: a grader for one RENDERED stage
// report. It already owns fence presence, the eight-section fixed order, the
// whole-report line cap, the empty-section fallback and counts-without-capture.
// It shipped with no production consumer, and this module is that consumer.
//
// What is NEW here is deliberately small — four REPORT-LEVEL rules that only
// make sense once a stage has committed to emitting the block INSTEAD of
// narrating:
//
//   1. a prose lead-in cap, so the block replaces the narration rather than
//      riding beneath it;
//   2. the both-narration-and-block refusal, which falls out of (1);
//   3. exactly one block per report — DELEGATED to STE-532's own refusal, in
//      STE-532's own words, because a second parser free to disagree with the
//      first is the two-renderers defect this repository has recorded;
//   4. the block is the LAST thing in the report.
//
// Everything else is delegated. The fence walk is `findFences`, the shared
// line-state machine; the banner is imported, never restated; the section
// order, the fallback literal and the whole-report cap are read from the
// modules that own them. Nothing in this file re-parses a status block.
//
// Pure and read-only in the grading half (it takes report TEXT, not a path);
// the scanner half reads SKILL.md bodies off disk and does nothing else — no
// git, no network, no child processes — so a probe or a smoke driver can call
// it mid-run.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CANONICAL_CAPABILITY_KEYS } from "./closing_summary_capability_keys";
import {
  DELIVER_STAGE_FENCE_BANNER,
  FENCE_LINE_CAP,
} from "./deliver_stage_capture";
import type { StageEvidenceInput } from "./deliver_stage_evidence";
import { findFences } from "./markdown_fences";
import {
  STAGE_REPORT_LINE_CAP,
  verifyStageStatusBlock,
} from "./stage_status_block";

/**
 * THE closed list of adopting stages, resolved by operator decision on
 * 2026-08-31 and stated HERE, once. Every other surface — the scanner below,
 * the tests, the shipped prose — reads it from this binding; a second literal
 * listing is the drift AC-STE-533.1 exists to forbid.
 *
 * The boundary is exactly the set of skills that ALREADY carry a
 * closing-summary contract, so each one has an existing contract to replace
 * rather than a new obligation to acquire. It is deliberately NOT the
 * `/deliver` stage vocabulary (`DELIVER_STAGE_IDS`): that omits brainstorm —
 * the stage the original request named first — and three of its five members
 * have no closing summary to supersede.
 *
 * A stage absent from this list is OUT OF SCOPE BY DECLARATION, not by
 * oversight: `/pr`, `/docs`, `/deliver` and `/simplify` are real shipped skills
 * that close with no summary contract, and the scanner is silent about them.
 */
export const ADOPTING_STAGES = [
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

/** One of the eleven. Derived from the list, never re-listed. */
export type AdoptingStage = (typeof ADOPTING_STAGES)[number];

/**
 * The number of prose lines a report may carry BEFORE the fence opener.
 *
 * DERIVED, never typed. STE-532 sized its whole-report cap as "the 26 lines the
 * fence itself may hold, its two markers, and a dozen lines of prose to say
 * what the stage did before the numbers start". That third term IS this cap, so
 * it is computed back out of the other two: a hand-picked literal here would
 * let the two budgets drift apart silently, which is the whole failure mode
 * this milestone keeps recording.
 */
export const PROSE_LEAD_IN_LINE_CAP =
  STAGE_REPORT_LINE_CAP - FENCE_LINE_CAP - 2;

/** One verdict shape, one channel: `reasons` is empty iff `ok`. */
export interface StageAdoptionVerdict {
  ok: boolean;
  reasons: readonly string[];
}

/** One stage that has not adopted the block, cited at `file:line`. */
export interface StageAdoptionViolation {
  stage: AdoptingStage;
  file: string;
  line: number;
  reason: string;
}

/**
 * Fence markers, built from the SHIPPED banner so the two cannot drift, and
 * indentation-tolerant for the same reason every sibling grader is.
 */
const FENCE_OPEN = new RegExp(
  "^[ \\t]*" + DELIVER_STAGE_FENCE_BANNER + "[ \\t]*$",
);
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;

/** The closed status fences in a text, in the order found. */
const closedFences = (text: string) =>
  findFences(text, FENCE_OPEN, FENCE_CLOSE).filter((fence) => fence.endLine > 0);

/**
 * One matcher per canonical capability key, compiled ONCE at module load.
 *
 * Boundary-anchored rather than a bare substring test: several canonical keys
 * share a family prefix, and an unanchored match would report the short key
 * every time the long one appears.
 *
 * Built here rather than inside the scan because the scan runs twice per
 * `verifyStageReportAdoption` — once for the block, once for the prose around
 * it — over the whole canonical set, and because a key that could not compile
 * should fail at import rather than on the one report that happens to name it.
 */
const KEY_MATCHERS: readonly (readonly [string, RegExp])[] = (
  CANONICAL_CAPABILITY_KEYS as readonly string[]
).map(
  (key) =>
    [key, new RegExp(`(?<![A-Za-z0-9_])${key}(?![A-Za-z0-9_])`)] as const,
);

/** The canonical capability keys present in `text`. */
const capabilityKeysIn = (text: string): string[] =>
  KEY_MATCHERS.filter(([, matcher]) => matcher.test(text)).map(([key]) => key);

/**
 * Where a report's capability tokens sit: inside the status block, or loose in
 * the prose around it.
 *
 * The tokens are the machine-readable half of the closing summary, and the
 * point of adoption is that they SURVIVE the rewrite — inside the block, where
 * a reader and a grep both still find them. A token left in the narration is
 * a token the block does not carry.
 */
export function locateCapabilityTokens(report: string): {
  inBlock: string[];
  outsideBlock: string[];
} {
  const lines = report.split("\n");
  const fences = closedFences(report);
  const outsideIndexes = new Set<number>(lines.map((_, i) => i));
  for (const fence of fences) {
    for (let i = fence.startLine - 1; i <= fence.endLine - 1; i++) {
      outsideIndexes.delete(i);
    }
  }
  const insideText = fences.map((fence) => fence.lines.join("\n")).join("\n");
  const outsideText = [...outsideIndexes]
    .sort((a, b) => a - b)
    .map((i) => lines[i])
    .join("\n");
  return {
    inBlock: capabilityKeysIn(insideText),
    outsideBlock: capabilityKeysIn(outsideText),
  };
}

/**
 * Grade a rendered stage report against the ADOPTION contract.
 *
 * STE-532 runs first and in full — its reasons ride the same `reasons` array,
 * so a caller sees one verdict rather than two to reconcile. When the report
 * does not carry exactly one closed block, STE-532's refusal is returned
 * UNCHANGED and this module adds nothing: the count rule has exactly one owner.
 */
export function verifyStageReportAdoption(
  report: string,
  evidence?: StageEvidenceInput | null,
): StageAdoptionVerdict {
  const base = verifyStageStatusBlock(report, evidence);
  const reasons: string[] = [...base.reasons];

  const fences = closedFences(report);
  if (fences.length !== 1) return { ok: false, reasons };
  const fence = fences[0]!;

  const lines = report.split("\n");

  // (1) THE PROSE LEAD-IN CAP. `startLine` is 1-based, so the lines strictly
  // above the opener are its count minus one — the same number the report's
  // reader scrolls past before the first fact.
  const proseLines = fence.startLine - 1;
  if (proseLines > PROSE_LEAD_IN_LINE_CAP) {
    reasons.push(
      `the report carries ${proseLines} lines of prose before the status ` +
        `block, over the ${PROSE_LEAD_IN_LINE_CAP}-line prose lead-in cap: ` +
        `the block REPLACES the narration rather than riding beneath it`,
    );
  }

  // (4) THE BLOCK COMES LAST. Blank lines are not content: a trailing newline
  // is punctuation, not another paragraph for the operator to read.
  const trailing = lines
    .slice(fence.endLine)
    .filter((line) => line.trim().length > 0);
  if (trailing.length > 0) {
    reasons.push(
      `${trailing.length} non-blank line(s) follow the status block; the ` +
        `block is the LAST thing in the report`,
    );
  }

  // The tokens survive INSIDE the block.
  for (const key of locateCapabilityTokens(report).outsideBlock) {
    reasons.push(
      `capability token \`${key}\` sits outside the status block; capability ` +
        `tokens ride inside the status block`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Every adopting stage whose shipped SKILL.md still closes with narration.
 *
 * `projectRoot` is the REPO root, and both skill roots are probed — the
 * `closing_summary_capability_keys` idiom: a marketplace checkout carries
 * `plugins/dev-process-toolkit/skills/…`, a consumer project carries
 * `.claude/skills/…`, and a path that does not exist is not a violation.
 *
 * The grade here is PRESENCE of a closed status block, not the full STE-532
 * contract: a SKILL.md documents the block it will emit, and holding an
 * authoring surface to a runtime report's section counts would grade the wrong
 * subject.
 */
export function scanStageBlockAdoption(
  projectRoot: string,
): StageAdoptionViolation[] {
  const violations: StageAdoptionViolation[] = [];
  for (const stage of ADOPTING_STAGES) {
    const candidates = [
      ["plugins", "dev-process-toolkit", "skills", stage, "SKILL.md"],
      [".claude", "skills", stage, "SKILL.md"],
    ];
    for (const segments of candidates) {
      const abs = join(projectRoot, ...segments);
      if (!existsSync(abs)) continue;
      let body: string;
      try {
        body = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      if (closedFences(body).length > 0) continue;
      violations.push({
        stage,
        file: segments.join("/"),
        line: Math.max(1, body.split("\n").length),
        reason:
          `\`/${stage}\` still closes with narration: its SKILL.md carries no ` +
          `status block for the stage to emit`,
      });
    }
  }
  return violations;
}
