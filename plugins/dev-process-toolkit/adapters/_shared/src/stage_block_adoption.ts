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
//   4. the block is the LAST thing in the report, EXCEPT the closed, cited set
//      of structured sections earlier milestones mandate (AC-STE-533.2a).
//
// Everything else is delegated. The fence walk is `closedStatusFences`, taken
// from the module that owns the adopting banner rather than rebuilt here; the
// banner is imported, never restated; the section order, the fallback literal
// and the whole-report cap are read from the modules that own them. Nothing in
// this file re-parses a status block.
//
// It also carries the /gate-check probe (#82, AC-STE-533.8). The probe runs
// the SCANNER half, which grades an AUTHORING SURFACE — a documented closed
// fence, banner ownership, and every cap-exempt section still emitted. It does
// NOT grade narration, and cannot: a SKILL.md is documentation, so prose
// around its fence is legitimate (measured: eleven SKILL.md carrying 60
// narration paragraphs above and below a compliant fence score clean).
// Narration is a property of a RENDERED REPORT and is graded below, by
// `verifyStageReportAdoption`. Two halves, two subjects.
//
// Pure and read-only in the grading half (it takes report TEXT, not a path);
// the scanner half reads SKILL.md bodies off disk and does nothing else — no
// git, no network, no child processes — so a probe or a smoke driver can call
// it mid-run.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CANONICAL_CAPABILITY_KEYS } from "./closing_summary_capability_keys";
import {
  DELIVER_STAGE_FENCE_BANNER,
  FENCE_LINE_CAP,
} from "./deliver_stage_capture";
import type { StageEvidenceInput } from "./deliver_stage_evidence";
import {
  closedStatusFences,
  STAGE_BLOCK_FENCE_BANNER,
  STAGE_REPORT_LINE_CAP,
  verifyStageStatusBlock,
} from "./stage_status_block";

/** The probe id this module registers under at `/gate-check` (#82). */
export const PROBE_ID = "stage_block_adoption";

export type Severity = "error" | "warning";

/**
 * THE closed list of adopting stages, resolved by operator decision on
 * 2026-08-31 and stated HERE, once. Every other surface — the scanner below,
 * the probe, the shipped prose — reads it from this binding; a second literal
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

/** Widened view of the tuple, spelled once so no caller re-types it inline. */
const STAGE_NAMES: readonly string[] = ADOPTING_STAGES;

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

// ---------------------------------------------------------------------------
// AC-STE-533.2a — the cap-exempt sections
// ---------------------------------------------------------------------------

/**
 * One structured section that an earlier milestone MANDATED and this cap does
 * NOT govern. The cap governs FREE-FORM NARRATION alone.
 *
 * `requiredBy` is a CITATION, and an entry whose citation resolves to nothing
 * is inadmissible — see `resolveExemptCitation`. A carve-out list that admits
 * an unresolvable reference is a dumping ground, which is the shape this
 * repository has recorded going unguarded more than once.
 */
export interface CapExemptSection {
  stage: AdoptingStage;
  /** The markdown heading, verbatim, `## `-prefixed. */
  heading: string;
  /** A REAL declarer: the module that declares the heading, or a real pin. */
  requiredBy: string;
}

/**
 * THE closed, cited carve-out list, stated HERE, once.
 *
 * MEASURED on 2026-08-31: the two citations originally proposed for these
 * entries — `tests/m132-ste-512-e2e-authoring.test.ts` and
 * `tests/m136-ste-531-order-fires.test.ts` — are both DEAD. Each names
 * `## Verification evidence` only inside a `//` comment, and a comment is not a
 * pin. The real declarers are cited instead: the module that DECLARES the
 * heading as a constant, and the shipped AC-STE-148.1 pin that asserts the
 * other one is emitted.
 *
 * EXEMPT IS NOT OPTIONAL. A listed section that stops being emitted is a
 * violation in its own right (`scanStageBlockAdoption` grades that direction),
 * because a carve-out checked one way is unguarded the other way.
 */
export const CAP_EXEMPT_SECTIONS: readonly CapExemptSection[] = [
  {
    stage: "implement",
    heading: "## Verification evidence",
    // `IMPLEMENT_EVIDENCE_HEADING` — the executable declaration of the literal.
    requiredBy: "adapters/_shared/src/implement_report_evidence.ts",
  },
  {
    stage: "implement",
    heading: "## Advisory notes",
    // Shipped AC-STE-148.1: "Phase 4 step 14 names the heading".
    requiredBy: "tests/implement-advisory-notes.test.ts",
  },
];

/** The exempt sections a stage carries. Reads the ONE list, never a re-listing. */
export function exemptSectionsFor(stage: string): readonly CapExemptSection[] {
  return CAP_EXEMPT_SECTIONS.filter((entry) => entry.stage === stage);
}

/** What a citation resolved to — the evidence, or `null` when it resolved to nothing. */
export interface ExemptCitationResolution {
  resolved: boolean;
  evidence: string | null;
}

/** Roots a plugin-relative citation may live under, in probe order. */
const citationRoots = (repoRoot: string): string[] => [
  join(repoRoot, "plugins", "dev-process-toolkit"),
  repoRoot,
];

/** A `//`, `*`, `/*` or `#` line — a MENTION, never a pin. */
const isCommentLine = (line: string): boolean => {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#")
  );
};

/** Every markdown file under `specs/frs/`, active and archived. */
function frBodies(repoRoot: string): { rel: string; body: string }[] {
  const out: { rel: string; body: string }[] = [];
  const dirs = ["specs/frs", "specs/frs/archive"];
  for (const dir of dirs) {
    const abs = join(repoRoot, ...dir.split("/"));
    if (!existsSync(abs)) continue;
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      try {
        out.push({
          rel: `${dir}/${name}`,
          body: readFileSync(join(abs, name), "utf-8"),
        });
      } catch {
        /* unreadable is not a resolution */
      }
    }
  }
  return out;
}

/**
 * Does an exempt entry's citation RESOLVE?
 *
 * Two admissible shapes, and nothing else:
 *
 *   * a FILE PATH — the file exists, and it names the entry's heading on a line
 *     that is not a comment. "It mentions it" is deliberately insufficient: the
 *     two citations originally proposed for these entries name the heading ONLY
 *     inside `//` comments, and a list admitted on one of those would be the
 *     vacuity AC-STE-533.2a exists to catch.
 *   * an ACCEPTANCE CRITERION id — some shipped FR carries it.
 *
 * The refusal is ABOUT COMMENTS, not about test files: a test file carrying a
 * REAL pin on the heading resolves, which is what makes the comment-only
 * refusal a measurement rather than a blanket rule.
 */
export function resolveExemptCitation(
  entry: CapExemptSection,
  repoRoot: string,
): ExemptCitationResolution {
  const citation = entry.requiredBy.trim();
  if (citation.length === 0) return { resolved: false, evidence: null };

  if (/^AC-[A-Za-z]+-\d+\.\d+[a-z]?$/.test(citation)) {
    for (const { rel, body } of frBodies(repoRoot)) {
      const hit = body
        .split("\n")
        .findIndex((line) => line.includes(citation));
      if (hit >= 0) {
        return {
          resolved: true,
          evidence: `${rel}:${hit + 1} — ${body.split("\n")[hit]!.trim()}`,
        };
      }
    }
    return { resolved: false, evidence: null };
  }

  for (const root of citationRoots(repoRoot)) {
    const abs = join(root, ...citation.split("/"));
    if (!existsSync(abs)) continue;
    let body: string;
    try {
      body = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.includes(entry.heading)) continue;
      if (isCommentLine(line)) continue;
      return { resolved: true, evidence: `${citation}:${i + 1} — ${line.trim()}` };
    }
  }
  return { resolved: false, evidence: null };
}

// ---------------------------------------------------------------------------
// The report grader
// ---------------------------------------------------------------------------

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
 * The ONE fence marker this module builds for itself: `/deliver`'s banner,
 * matched line-by-line so the scanner can name the offending line.
 *
 * TWO banners, because AC-STE-533.1a split one artifact into two contracts:
 * the adopting eleven emit theirs, `/deliver` keeps its machine hand-off, and
 * each grader accepts its own and refuses the other's. The walk over the
 * ADOPTING banner is `closedStatusFences`, imported from the module that owns
 * that banner — a private copy here would be a second walk free to disagree
 * with the grader this module is a policy over.
 */
const DELIVER_FENCE_OPEN = new RegExp(
  "^[ \\t]*" + DELIVER_STAGE_FENCE_BANNER + "[ \\t]*$",
);

/** A markdown heading line, and a list item — the two shapes a section takes. */
const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/** The `stage:` scalar a status block states, or `null` when it states none. */
function statedStage(fenceLines: readonly string[]): string | null {
  for (const line of fenceLines) {
    const match = /^\s*stage:\s*(\S+)/.exec(line);
    if (match !== null) return match[1]!;
  }
  return null;
}

/**
 * The NARRATION in a region: every non-blank line that is not part of one of
 * this stage's exempt sections.
 *
 * The carve-out admits the SECTION, not everything after it — a heading plus
 * its list rows. Prose under a correctly-headed section is still narration,
 * or a stage reinstates its whole report by heading it well.
 */
function narrationLines(
  region: readonly string[],
  exemptHeadings: readonly string[],
): string[] {
  const out: string[] = [];
  let underExempt = false;
  for (const line of region) {
    if (line.trim().length === 0) continue;
    if (HEADING_RE.test(line)) {
      underExempt = exemptHeadings.includes(line.trim());
      if (!underExempt) out.push(line);
      continue;
    }
    if (underExempt && LIST_ITEM_RE.test(line)) continue;
    out.push(line);
  }
  return out;
}

/**
 * One matcher per canonical capability key, compiled ONCE at module load.
 *
 * Boundary-anchored rather than a bare substring test: several canonical keys
 * share a family prefix, and an unanchored match would report the short key
 * every time the long one appears.
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
  const fences = closedStatusFences(report);
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

  const fences = closedStatusFences(report);
  if (fences.length !== 1) return { ok: false, reasons };
  const fence = fences[0]!;

  const lines = report.split("\n");

  // THE STAGE VOCABULARY (AC-STE-533.1a). This grader speaks the adopting
  // eleven's names and nothing else. `/deliver`'s ceremony ids ride the OTHER
  // banner, graded by `verifyDeliverStageCapture` — widening either vocabulary
  // to swallow the other would make a false thing true.
  const stage = statedStage(fence.lines);
  if (stage === null) {
    reasons.push(
      "the status block states no `stage:` value; the block names the stage " +
        "that emitted it",
    );
  } else if (!STAGE_NAMES.includes(stage)) {
    reasons.push(
      `the status block names \`stage: ${stage}\`, which is not one of the ` +
        `${ADOPTING_STAGES.length} adopting stages: \`${stage}\` belongs to ` +
        "`/deliver`'s ceremony vocabulary, graded on its own banner",
    );
  }
  const exemptHeadings = exemptSectionsFor(stage ?? "").map((e) => e.heading);

  // (1) THE PROSE LEAD-IN CAP, over NARRATION alone. The structured sections
  // earlier milestones mandate are exempt (AC-STE-533.2a) — and still required,
  // which the scanner grades from the other direction.
  const prose = narrationLines(
    lines.slice(0, fence.startLine - 1),
    exemptHeadings,
  );
  if (prose.length > PROSE_LEAD_IN_LINE_CAP) {
    reasons.push(
      `the report carries ${prose.length} lines of prose before the status ` +
        `block, over the ${PROSE_LEAD_IN_LINE_CAP}-line prose lead-in cap: ` +
        `the block REPLACES the narration rather than riding beneath it`,
    );
  }

  // (4) THE BLOCK COMES LAST, except this stage's exempt sections. Blank lines
  // are not content: a trailing newline is punctuation, not another paragraph
  // for the operator to read.
  const trailing = narrationLines(lines.slice(fence.endLine), exemptHeadings);
  if (trailing.length > 0) {
    reasons.push(
      `${trailing.length} non-blank line(s) follow the status block; the ` +
        "block is the LAST thing in the report, other than the cap-exempt " +
        "sections this stage is required to emit",
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

// ---------------------------------------------------------------------------
// The source scanner
// ---------------------------------------------------------------------------

/** Both skill roots, in probe order — the `closing_summary_capability_keys` idiom. */
const skillCandidates = (stage: string): string[][] => [
  ["plugins", "dev-process-toolkit", "skills", stage, "SKILL.md"],
  [".claude", "skills", stage, "SKILL.md"],
];

/** Every adopting SKILL.md that EXISTS under `projectRoot`, with its body. */
function adoptingSkillFiles(
  projectRoot: string,
): { stage: AdoptingStage; file: string; body: string }[] {
  const found: { stage: AdoptingStage; file: string; body: string }[] = [];
  for (const stage of ADOPTING_STAGES) {
    for (const segments of skillCandidates(stage)) {
      const abs = join(projectRoot, ...segments);
      if (!existsSync(abs)) continue;
      try {
        found.push({
          stage,
          file: segments.join("/"),
          body: readFileSync(abs, "utf-8"),
        });
      } catch {
        /* an unreadable surface is not a violation */
      }
    }
  }
  return found;
}

/** 1-based line the pattern first matches on, or `fallback`. */
function lineOf(body: string, test: (line: string) => boolean, fallback: number): number {
  const idx = body.split("\n").findIndex(test);
  return idx >= 0 ? idx + 1 : fallback;
}

/**
 * Every adopting stage whose shipped SKILL.md has not adopted the contract.
 *
 * `projectRoot` is the REPO root, and both skill roots are probed: a
 * marketplace checkout carries `plugins/dev-process-toolkit/skills/…`, a
 * consumer project carries `.claude/skills/…`, and a path that does not exist
 * is not a violation.
 *
 * THE SUBJECT IS AN AUTHORING SURFACE, so narration is not graded here and
 * cannot be: a SKILL.md is documentation, and prose around its fence is
 * legitimate — eleven SKILL.md carrying 60 narration paragraphs above and
 * below a compliant fence score clean. Narration belongs to a RENDERED report,
 * which `verifyStageReportAdoption` grades. Three things are graded here, and
 * the runtime report's section counts are deliberately not among them:
 *
 *   1. a closed status block on the ADOPTING banner is documented at all;
 *   2. the surface no longer emits `/deliver`'s banner — one banner, one owner;
 *   3. every AC-STE-533.2a section listed for the stage is still emitted —
 *      exempt is not optional.
 */
export function scanStageBlockAdoption(
  projectRoot: string,
): StageAdoptionViolation[] {
  const violations: StageAdoptionViolation[] = [];
  for (const { stage, file, body } of adoptingSkillFiles(projectRoot)) {
    const lastLine = Math.max(1, body.split("\n").length);
    if (closedStatusFences(body).length === 0) {
      violations.push({
        stage,
        file,
        line: lastLine,
        reason:
          `\`/${stage}\` still closes with narration: its SKILL.md carries no ` +
          `status block for the stage to emit`,
      });
      continue;
    }
    if (body.split("\n").some((line) => DELIVER_FENCE_OPEN.test(line))) {
      violations.push({
        stage,
        file,
        line: lineOf(body, (line) => DELIVER_FENCE_OPEN.test(line), lastLine),
        reason:
          `\`/${stage}\` still emits \`/deliver\`'s hand-off banner: the ` +
          `adopting stages emit their own, graded against ADOPTING_STAGES`,
      });
    }
    for (const entry of exemptSectionsFor(stage)) {
      if (body.includes(entry.heading)) continue;
      violations.push({
        stage,
        file,
        line: lastLine,
        reason:
          `\`/${stage}\` no longer emits the cap-exempt section ` +
          `\`${entry.heading}\`: exempt is not optional — the carve-out ` +
          `requires the section, it does not make it discretionary ` +
          `(required by ${entry.requiredBy})`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The /gate-check probe (#82)
// ---------------------------------------------------------------------------

export interface StageBlockAdoptionViolationRow {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface StageBlockAdoptionReport {
  violations: StageBlockAdoptionViolationRow[];
  /** True when the tree carries none of the eleven — nothing to grade. */
  vacuous: boolean;
}

function buildMessage(v: StageAdoptionViolation): string {
  return [
    `${PROBE_ID}: ${v.file}:${v.line} — ${v.reason}`,
    `Remedy: close \`/${v.stage}\` with exactly one ` +
      `\`${STAGE_BLOCK_FENCE_BANNER}\` fence as the last thing in its report, ` +
      `at most ${PROSE_LEAD_IN_LINE_CAP} lines of prose above it, and keep ` +
      `every cap-exempt section listed for the stage. The contract is ` +
      `\`docs/stage-status-block.md\`; the grader is ` +
      `\`verifyStageReportAdoption\` in ` +
      `\`adapters/_shared/src/stage_block_adoption.ts\`.`,
    `Context: file=${v.file}, line=${v.line}, stage=${v.stage}, ` +
      `probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

/**
 * `/gate-check` probe #82 — the runtime path the adoption grader runs on.
 *
 * Never throws: an absent tree, an unreadable surface and a BOM-mangled
 * SKILL.md all read as a verdict rather than a crashed gate run. Vacuous (zero
 * violations, `vacuous: true`) on a tree carrying none of the eleven.
 */
export async function runStageBlockAdoptionProbe(
  projectRoot: string,
): Promise<StageBlockAdoptionReport> {
  const present = adoptingSkillFiles(projectRoot);
  if (present.length === 0) return { violations: [], vacuous: true };
  const violations = scanStageBlockAdoption(projectRoot).map((v) => ({
    file: v.file,
    line: v.line,
    reason: v.reason,
    note: `${v.file}:${v.line} — ${v.reason}`,
    message: buildMessage(v),
    severity: "error" as Severity,
  }));
  return { violations, vacuous: false };
}

if (import.meta.main) {
  const projectRoot = process.argv[2] ?? process.cwd();
  const report = await runStageBlockAdoptionProbe(projectRoot);
  if (report.vacuous) {
    console.log(`${PROBE_ID}: vacuous — no adopting skill found under ${projectRoot}`);
  } else if (report.violations.length === 0) {
    console.log(
      `${PROBE_ID}: clean — all ${ADOPTING_STAGES.length} adopting stages emit the status block`,
    );
  } else {
    for (const v of report.violations) console.log(v.message);
  }
  process.exit(report.violations.length === 0 ? 0 : 1);
}
