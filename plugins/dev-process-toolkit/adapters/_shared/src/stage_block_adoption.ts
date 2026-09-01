// stage_block_adoption — the ADOPTION POLICY over the STE-532 grader (STE-533).
//
// STE-532 landed `verifyStageStatusBlock`: a grader for one RENDERED stage
// report. It already owns fence presence, the eight-section fixed order, the
// whole-report line cap, the empty-section fallback and counts-without-capture.
// It shipped with no production consumer, and this module is that consumer.
//
// What is NEW here is deliberately small. Every rule below is REPORT-LEVEL — it
// only makes sense once a stage has committed to emitting the block INSTEAD of
// narrating. The list is its own count, and no numeral restates it here: an
// earlier header said "four" while the list already ran to six, which is the
// § Counting a rule set defect in `docs/prose-altitude.md`. The same list, in
// the same order, heads `docs/stage-status-block.md`.
//
//   1. a prose lead-in cap, so the block replaces the narration rather than
//      riding beneath it;
//   2. the both-narration-and-block refusal, which falls out of (1);
//   3. exactly one block per report — DELEGATED to STE-532's own refusal, in
//      STE-532's own words, because a second parser free to disagree with the
//      first is the two-renderers defect this repository has recorded;
//   4. the block is the LAST thing in the report, EXCEPT the closed, cited set
//      of structured sections earlier milestones mandate (AC-STE-533.2a) —
//      and that carve-out is BOUNDED: each cap-exempt section owns at most the
//      lines its own renderer emits (its per-section budget, read off
//      `renderMax`), FUNDED ONCE PER REPORT rather than once per occurrence,
//      and a repeated exempt heading is refused outright by name; every line
//      past that budget is narration again, and an accepted report therefore
//      has a stated ceiling of `maxAdoptedReportLines(stage)` — 49 for
//      `/implement`, 40 for a stage that owes nothing;
//   5. the block names an ADOPTING stage — `stage:` must be one of
//      `ADOPTING_STAGES`; a missing value and a `/deliver` ceremony id are
//      both refused, because that vocabulary rides the other banner;
//   6. capability tokens ride INSIDE the block — `locateCapabilityTokens`
//      splits the tokens it finds into `inBlock` and `outsideBlock`, and a
//      token left loose in the prose is a reason of its own. It is a REFUSAL,
//      not a presence check: a report carrying no token at all grades clean.
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
// WHAT THE `--report` FRONT DOOR CANNOT GRADE, stated rather than implied.
// STE-532's counts-without-capture rule is never graded off a capture: the
// front door reads a rendered report off disk, there is no run behind that
// file, and the `evidence` argument it would have to trace a number back to
// does not exist at that point — so the front door calls
// `verifyStageReportAdoption(body)` with one argument and the rule stays
// silent. It fires only for an IN-PROCESS caller that has the run's evidence
// in hand and passes it as the second argument. Documented here because a rule
// advertised as enforced and enforced nowhere is worse than one written down
// as unenforced.
//
// Pure and read-only in the grading half (it takes report TEXT, not a path);
// the scanner half reads SKILL.md bodies off disk and does nothing else — no
// git, no network, no child processes — so a probe or a smoke driver can call
// it mid-run.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CANONICAL_CAPABILITY_KEYS } from "./closing_summary_capability_keys";
// The BANNER crosses the seam on purpose — each grader must refuse the other's
// banner, which is a claim about the other's bytes. The ARITHMETIC does not:
// `ADOPTED_FENCE_LINE_CAP` below is this contract's own, declared here.
import { DELIVER_STAGE_FENCE_BANNER } from "./deliver_stage_capture";
import {
  renderStageEvidence,
  type StageEvidenceInput,
} from "./deliver_stage_evidence";
import { renderMaxAdvisoryNotes } from "./implement_advisory_notes";
import {
  closedStatusFences,
  STAGE_BLOCK_FENCE_BANNER,
  STAGE_REPORT_LINE_CAP,
  verifyStageStatusBlock,
} from "./stage_status_block";
import { isToolkitManaged } from "./toolkit_managed";

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
 * The number of lines the ADOPTED status block's body may hold, its opener and
 * closer excluded.
 *
 * THIS CONTRACT'S OWN, and that is the whole point (AC-STE-533.1a, round 5).
 * The cap was formerly read from `FENCE_LINE_CAP` in
 * `./deliver_stage_capture` — /deliver's module, /deliver's contract — so a
 * /deliver retune moved eleven adopting stages' prose budget across the seam
 * this FR declares severed. MEASURED before the split: rewriting
 * `FENCE_LINE_CAP = 26` to `30` in a copy of the shared tree moved
 * `PROSE_LEAD_IN_LINE_CAP` from 12 to 8, with no edit to this file at all.
 *
 * The two caps hold the SAME VALUE today. That is expected, and it is not the
 * subject: the deliverable is the INDEPENDENCE, and a second contract is free
 * to retune its own fence without touching this one.
 */
export const ADOPTED_FENCE_LINE_CAP = 26;

/**
 * The number of prose lines a report may carry BEFORE the fence opener.
 *
 * DERIVED, never typed. STE-532 sized its whole-report cap as "the 26 lines the
 * fence itself may hold, its two markers, and a dozen lines of prose to say
 * what the stage did before the numbers start". That third term IS this cap, so
 * it is computed back out of the other two — the whole-report cap and THIS
 * contract's own fence cap: a hand-picked literal here would let the two
 * budgets drift apart silently, which is the whole failure mode this milestone
 * keeps recording.
 */
export const PROSE_LEAD_IN_LINE_CAP =
  STAGE_REPORT_LINE_CAP - ADOPTED_FENCE_LINE_CAP - 2;

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
  /**
   * The section AS ITS OWN SHIPPED RENDERER EMITS IT, at the largest size that
   * renderer can produce — heading first, then its body.
   *
   * THIS IS THE BUDGET, and it is read rather than typed. A number written
   * beside an entry is a number free to drift from what the renderer really
   * emits, which is this repository's most-recorded failure shape; a renderer
   * that grew a line would then hand the carve-out an allowance nobody voted
   * for. Both shipped sections are FIXED-SIZE by construction — the evidence
   * block always emits three sections and their rows, and the advisory section
   * always emits its heading and one bounded line — so "the largest it can
   * emit" is a real ceiling rather than a hopeful sample.
   *
   * OPTIONAL IN THE TYPE, REQUIRED IN THE LIST: `CAP_EXEMPT_SECTIONS` is typed
   * as `BoundedCapExemptSection`, so an entry landing without a renderer does
   * not compile, while callers that only need the citation half (see
   * `resolveExemptCitation`) can still describe an entry without one.
   */
  renderMax?: () => readonly string[];
}

/** An entry whose ceiling is known — the only shape the canonical list admits. */
export type BoundedCapExemptSection = CapExemptSection & {
  renderMax: () => readonly string[];
};

/**
 * `## Verification evidence`, at the size `renderImplementReportEvidence`
 * emits it.
 *
 * IT IS THE SAME RENDERER, reached one link down the chain. That module derives
 * nothing itself — it calls `renderStageEvidence` and re-labels the result with
 * this heading — so composing the heading here over the same shared renderer
 * yields its bytes rather than a snapshot of them, and the round-2 leg that
 * compares this against `renderImplementReportEvidence({}).lines` is what keeps
 * them married.
 *
 * WHY NOT IMPORT THAT MODULE DIRECTLY: a shipped measurement (STE-531,
 * `tests/m136-ste-531-order-fires.test.ts`) pins `implement_report_evidence.ts`
 * as having NO non-test importers and being unreachable — that FR's whole
 * subject. Importing it here would silently rewrite the defect that test
 * exists to hold still. Naming the reason beats leaving the next reader to
 * rediscover it.
 */
const EVIDENCE_SECTION_HEADING = "## Verification evidence";

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
export const CAP_EXEMPT_SECTIONS: readonly BoundedCapExemptSection[] = [
  {
    stage: "implement",
    heading: EVIDENCE_SECTION_HEADING,
    // `IMPLEMENT_EVIDENCE_HEADING` — the executable declaration of the literal.
    requiredBy: "adapters/_shared/src/implement_report_evidence.ts",
    renderMax: () => [
      EVIDENCE_SECTION_HEADING,
      ...renderStageEvidence({}).lines,
    ],
  },
  {
    stage: "implement",
    heading: "## Advisory notes",
    // Shipped AC-STE-148.1: "Phase 4 step 14 names the heading".
    requiredBy: "tests/implement-advisory-notes.test.ts",
    // The heading literal is stated HERE once (AC-STE-533.2a's own pin asserts
    // exactly one occurrence in this module); the renderer states its own, and
    // the round-2 leg asserting `renderMax()[0] === heading` is what refuses
    // the two drifting apart.
    renderMax: renderMaxAdvisoryNotes,
  },
];

/** The exempt sections a stage carries. Reads the ONE list, never a re-listing. */
export function exemptSectionsFor(
  stage: string,
): readonly BoundedCapExemptSection[] {
  return CAP_EXEMPT_SECTIONS.filter((entry) => entry.stage === stage);
}

/**
 * How many lines ONE cap-exempt section may own — READ OFF ITS RENDERER.
 *
 * The accessor CALLS `renderMax()`. It does not consult a table, and there is
 * no number here to keep in step with anything: a section that renders seven
 * lines is funded for seven, and the day its renderer emits an eighth the
 * budget is eight, with no edit to this file and no window in which the two
 * disagree.
 *
 * An entry with no renderer is REFUSED rather than defaulted. A default would
 * be an unbounded exemption acquired by omission, which is precisely the hole
 * this function closes; `BoundedCapExemptSection` makes it unreachable from the
 * canonical list, and this throw covers a caller that built one by hand.
 */
export function exemptSectionBudget(entry: CapExemptSection): number {
  const render = entry.renderMax;
  if (typeof render !== "function") {
    throw new Error(
      `the cap-exempt section \`${entry.heading}\` declares no renderMax(), so ` +
        "its budget cannot be read off its renderer: an entry with no ceiling " +
        "is an unbounded exemption",
    );
  }
  return render.call(entry).length;
}

/**
 * The STATED CEILING on a report this grader will accept for `stage`: the
 * whole-report cap, plus every exempt budget the stage owes and not one line
 * more.
 *
 * Derived, so it is a consequence of the budgets rather than a second opinion
 * about them. A stage that owes nothing gets exactly `STAGE_REPORT_LINE_CAP`;
 * `/implement`, which owes both sections, gets 49.
 */
export function maxAdoptedReportLines(stage: string): number {
  return exemptSectionsFor(stage).reduce(
    (sum, entry) => sum + exemptSectionBudget(entry),
    STAGE_REPORT_LINE_CAP,
  );
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

/**
 * A BARE `name:` line — the third shape the shipped section renderers emit.
 *
 * MEASURED on `renderImplementReportEvidence({})`, whose section is
 * `## Verification evidence`, then `gate:` / `drive:` / `e2e:` each followed by
 * a list row. Those three names are neither a heading nor a list item, so the
 * carve-out that forgave only list rows charged every one of them as NARRATION
 * — the effective lead-in budget for the one stage carrying exempt sections was
 * 8, not the stated 12, and the same two sections placed AFTER the block read
 * as four lines of trailing content.
 *
 * Deliberately BARE — nothing may follow the colon. A sentence that happens to
 * carry one ("Setup: the skill resolved its layout, …") is narration and stays
 * narration, which is what keeps this a shape rule rather than a licence.
 */
const SECTION_KEY_RE = /^\s*[A-Za-z][A-Za-z0-9_-]*:\s*$/;

/**
 * The non-shaped body lines an entry's own renderer emits — the mandated
 * sentences that are neither a list row nor a bare `name:` key.
 *
 * READ OFF `renderMax`, never declared beside the entry: the admitted literals
 * are then exactly the ones the renderer produces, and a reworded mandate
 * reaches this grader instead of leaving it pinned to a dead string. Memoised
 * per entry because the grader asks once per line.
 */
const BODY_LITERALS = new WeakMap<CapExemptSection, readonly string[]>();
function renderedBodyLiterals(entry: CapExemptSection): readonly string[] {
  const cached = BODY_LITERALS.get(entry);
  if (cached !== undefined) return cached;
  const literals =
    typeof entry.renderMax === "function"
      ? entry.renderMax().slice(1).map((line) => line.trim())
      : [];
  BODY_LITERALS.set(entry, literals);
  return literals;
}

/**
 * Is this line one the exempt section's OWN renderer emits?
 *
 * Three shapes and no fourth: a list row, a bare `name:` key, and a literal the
 * entry's renderer emits. The carve-out admits the section's RENDERED BODY, not
 * everything beneath its heading — and, since M137 round 2, no more of that
 * body than the renderer can actually produce (`exemptSectionBudget`).
 */
function isRenderedBodyLine(line: string, entry: CapExemptSection): boolean {
  if (LIST_ITEM_RE.test(line)) return true;
  if (SECTION_KEY_RE.test(line)) return true;
  return renderedBodyLiterals(entry).includes(line.trim());
}

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
 * this stage's exempt sections, AS ITS RENDERER EMITS IT.
 *
 * The carve-out runs from an exempt heading to the next heading of any kind,
 * and inside that span it forgives the three shapes `isRenderedBodyLine` names.
 * Prose under a correctly-headed section is still narration, or a stage
 * reinstates its whole report by heading it well.
 */
function narrationLines(
  region: readonly string[],
  exempt: readonly CapExemptSection[],
): string[] {
  const out: string[] = [];
  let current: CapExemptSection | null = null;
  for (const line of region) {
    if (line.trim().length === 0) continue;
    if (HEADING_RE.test(line)) {
      current = exempt.find((entry) => entry.heading === line.trim()) ?? null;
      if (current === null) out.push(line);
      continue;
    }
    if (current !== null && isRenderedBodyLine(line, current)) continue;
    out.push(line);
  }
  return out;
}

/**
 * The 0-based line indexes an exempt section OWNS — its heading, and the body
 * lines its own renderer emits — outside the fence.
 *
 * This is what FUNDS the carve-out. STE-532's whole-report cap is sized as
 * `PROSE_LEAD_IN_LINE_CAP + ADOPTED_FENCE_LINE_CAP + 2`, a partition of all 40 lines
 * with nothing left over, and it counted every line in the report. A report
 * respecting EVERY stated budget — 12 lines of prose, a full fence, and both
 * sections `/implement` owes at their smallest legal size — runs 49 lines and
 * was refused, with a Remedy naming only budgets it already met. A carve-out
 * that is stated but not funded refuses the very reports it exists to permit.
 *
 * The cap is NOT raised for narration: the exempt lines are excused from the
 * count and every other line still faces the shipped 40.
 *
 * AND THE CARVE-OUT IS BOUNDED (M137 round 2). Each occurrence of an exempt
 * heading owns AT MOST its own section budget — `exemptSectionBudget`, read off
 * that section's renderer — and every line past it is narration again, facing
 * the whole-report cap like any other line, with a refusal naming the section
 * and the number. The exemption shipped unbounded for one release, and the
 * measurement is worth keeping: a maximal legal 49-line report plus 120
 * narration paragraphs WEARING LIST MARKERS under `## Advisory notes` ran 169
 * lines and graded `{"ok":true,"reasons":[]}` against a 40-line cap, because
 * `isRenderedBodyLine` forgave every list row and this function then deleted
 * them all before anything counted. A stage could reinstate its entire former
 * report by heading it correctly and bulleting it.
 *
 * THE BOUND IS PER REPORT, PER HEADING (M137 round 3) — NOT per occurrence,
 * which is what shipped and what round 2's fix left open. Applied per
 * occurrence, REPEATING THE HEADING MULTIPLIES THE ALLOWANCE: measured against
 * a stated ceiling of 49 for `/implement`, 5 x `## Advisory notes` graded
 * `ok=true` at 34 lines and 50 x graded `ok=true` at 124. So the running spend
 * is keyed by the heading TEXT and carried across every occurrence in the
 * report: the first occurrence is funded, and every line of every repetition is
 * narration facing the whole-report cap.
 *
 * That is what makes `maxAdoptedReportLines(stage)` a real ceiling rather than
 * a description of one composition: an accepted report can excuse at most one
 * budget per owed heading, so its total can never exceed the shipped 40 plus
 * the sum of those budgets, whatever shape it takes. A stage that owes no
 * section gets no extra budget at all.
 *
 * WHY IT WAS PER OCCURRENCE, which matters more than the fix: a test was wrong
 * about its own subject. AC-STE-533.6's "an exempt section MAY follow the
 * block" built its subject by APPENDING an owed heading to a report that
 * already carried it — meaning to assert PLACEMENT and asserting DUPLICATION
 * instead. A per-report bound reddened it, so the bound was weakened to keep it
 * green. Placement is still admitted in full: DIFFERENT owed sections may sit
 * on either side of the block, each appearing once.
 */
interface ExemptSectionAccounting {
  /** The 0-based line indexes the carve-out excuses from the count. */
  owned: Set<number>;
  /** One record per exempt HEADING whose report-wide spend ran past its budget. */
  overBudget: { entry: CapExemptSection; budget: number; lines: number }[];
  /** One record per exempt heading carried more than once, with its count. */
  duplicated: { entry: CapExemptSection; occurrences: number }[];
}

/**
 * `fences` is a LIST, not the one fence: the count rule's own branch runs with
 * zero fences (or several), and it needs this accounting too — see
 * `verifyStageReportAdoption`, where handing STE-532 the raw report refused
 * blockless reports for a cap the carve-out already funds.
 */
function exemptSectionIndexes(
  lines: readonly string[],
  fences: readonly { startLine: number; endLine: number }[],
  exempt: readonly CapExemptSection[],
): ExemptSectionAccounting {
  const owned = new Set<number>();
  const overBudget: ExemptSectionAccounting["overBudget"] = [];
  const duplicated: ExemptSectionAccounting["duplicated"] = [];
  if (exempt.length === 0) return { owned, overBudget, duplicated };

  // Non-blank lines each HEADING has spent report-wide, heading lines included.
  // Every shape is counted, not only the excusable ones: prose smuggled under
  // the heading is still the section growing past what its renderer can emit,
  // and a bound that only counted the shapes it forgives would be a bound on
  // the wrong thing.
  const spent = new Map<string, number>();
  const occurrences = new Map<string, number>();
  let current: CapExemptSection | null = null;

  /** This heading's spend so far, plus `n`. */
  const spend = (entry: CapExemptSection, n: number): number => {
    const total = (spent.get(entry.heading) ?? 0) + n;
    spent.set(entry.heading, total);
    return total;
  };

  for (let i = 0; i < lines.length; i++) {
    // Inside a block nothing is exempt — the fence has its own budget, and a
    // section heading cannot open across it.
    if (fences.some((f) => i >= f.startLine - 1 && i <= f.endLine - 1)) {
      current = null;
      continue;
    }
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    if (HEADING_RE.test(line)) {
      // Compared on the TRIMMED line: a markdown heading may carry up to three
      // leading spaces and still be a heading, so an indented twin is a twin.
      current = exempt.find((entry) => entry.heading === line.trim()) ?? null;
      if (current !== null) {
        occurrences.set(current.heading, (occurrences.get(current.heading) ?? 0) + 1);
        if (spend(current, 1) <= exemptSectionBudget(current)) owned.add(i);
      }
      continue;
    }
    if (current === null) continue;
    const total = spend(current, 1);
    if (total <= exemptSectionBudget(current) && isRenderedBodyLine(line, current))
      owned.add(i);
  }

  for (const entry of exempt) {
    const budget = exemptSectionBudget(entry);
    const total = spent.get(entry.heading) ?? 0;
    if (total > budget) overBudget.push({ entry, budget, lines: total });
    const seen = occurrences.get(entry.heading) ?? 0;
    if (seen > 1) duplicated.push({ entry, occurrences: seen });
  }
  return { owned, overBudget, duplicated };
}

/**
 * The report MINUS the lines the carve-out owns — THE SPAN STE-532 IS GRADED
 * ON, spelled once so no call site can quietly hand over the raw report.
 *
 * That span IS the funding: the carve-out is stated in `exemptSectionIndexes`
 * and funded here, and a delegation that skipped it would refuse the very
 * reports the exemption exists to permit.
 */
function exemptFilteredSpan(
  lines: readonly string[],
  owned: ReadonlySet<number>,
): string {
  return lines.filter((_, i) => !owned.has(i)).join("\n");
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
  const fences = closedStatusFences(report);
  const lines = report.split("\n");
  if (fences.length !== 1) {
    // The count rule has exactly one owner: STE-532 refuses this, in STE-532's
    // own words, and this module adds nothing to it.
    //
    // ON THE EXEMPT-FILTERED SPAN, like every other call site. With no block
    // there is no `stage:` scalar to read, so the filter uses the WHOLE closed
    // carve-out list — the conservative choice on a branch whose verdict is
    // already "refuse": it can only drop a spurious SECOND reason, never the
    // missing-block refusal itself. MEASURED before the fix: a blockless
    // 41-line `/implement` report (filtered span 32) was refused for the
    // whole-report cap the carve-out funds, with a Remedy naming a budget the
    // report already met.
    const { owned } = exemptSectionIndexes(lines, fences, CAP_EXEMPT_SECTIONS);
    return {
      ok: false,
      reasons: [
        ...verifyStageStatusBlock(exemptFilteredSpan(lines, owned), evidence)
          .reasons,
      ],
    };
  }
  const fence = fences[0]!;

  // THE STAGE VOCABULARY (AC-STE-533.1a). This grader speaks the adopting
  // eleven's names and nothing else. `/deliver`'s ceremony ids ride the OTHER
  // banner, graded by `verifyDeliverStageCapture` — widening either vocabulary
  // to swallow the other would make a false thing true.
  const stage = statedStage(fence.lines);
  const exempt = exemptSectionsFor(stage ?? "");

  // STE-532 runs in full, over the report MINUS the lines the carve-out owns —
  // see `exemptSectionIndexes` for why the exemption has to be funded rather
  // than merely stated. Its reasons ride the same `reasons` array, so a caller
  // sees one verdict rather than two to reconcile.
  const { owned, overBudget, duplicated } = exemptSectionIndexes(lines, [fence], exempt);
  const base = verifyStageStatusBlock(
    exemptFilteredSpan(lines, owned),
    evidence,
  );
  const reasons: string[] = [...base.reasons];

  // THE CARVE-OUT IS BOUNDED. A section past its budget is refused BY NAME and
  // BY NUMBER: "something is too long" leaves the operator hunting, and the
  // whole-report cap alone would name a total without saying which section
  // spent it.
  for (const { entry, budget, lines: spent } of overBudget) {
    reasons.push(
      `the cap-exempt section \`${entry.heading}\` carries ${spent} lines, ` +
        `over its ${budget}-line section budget: the carve-out excuses the ` +
        `lines that section's own renderer emits and no more, so every line ` +
        `past the budget is narration again`,
    );
  }

  // AND THE HEADING IS CARRIED ONCE. Duplication is refused OUTRIGHT rather
  // than left to the arithmetic above: the carve-out is a CLOSED, CITED list of
  // sections whose own renderers emit them exactly once, and ABSENCE is already
  // a violation ("exempt is not optional"), so repetition must not be the
  // loophole absence is not. It is also the one refusal that reaches the
  // SMALLEST duplicate — two occurrences at their exact rendered size sit under
  // the ceiling, so no line-counting rule can carry that verdict. This does NOT
  // generalise: the FR and plan altitude scanners deliberately do not make a
  // repeated heading a violation, because their headings are free prose and a
  // retroactive repetition rule would grade material written before it.
  for (const { entry, occurrences } of duplicated) {
    reasons.push(
      `the report carries the cap-exempt section \`${entry.heading}\` ` +
        `${occurrences} times; each cap-exempt section appears exactly once — ` +
        `its own renderer emits it once, and the carve-out funds it once per ` +
        `report, so repeating the heading buys no second budget`,
    );
  }

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
  // (1) THE PROSE LEAD-IN CAP, over NARRATION alone. The structured sections
  // earlier milestones mandate are exempt (AC-STE-533.2a) — and still required,
  // which the presence check below grades from the other direction.
  const prose = narrationLines(lines.slice(0, fence.startLine - 1), exempt);
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
  const trailing = narrationLines(lines.slice(fence.endLine), exempt);
  if (trailing.length > 0) {
    reasons.push(
      `${trailing.length} non-blank line(s) follow the status block; the ` +
        "block is the LAST thing in the report, other than the cap-exempt " +
        "sections this stage is required to emit",
    );
  }

  // EXEMPT IS NOT OPTIONAL (AC-STE-533.2a, second direction), graded on the
  // REPORT.
  //
  // The only presence check that shipped read a SKILL.md body, and a SKILL.md
  // is a different subject: this tree's `/implement` SKILL.md names both
  // sections, so `scanStageBlockAdoption` is silent — while a RENDERED
  // `/implement` report that dropped them both graded CLEAN. Documentation
  // cannot excuse the report. The refusal NAMES the section, because a
  // carve-out checked one way is unguarded the other way.
  for (const entry of exempt) {
    if (lines.some((line) => line.trim() === entry.heading)) continue;
    reasons.push(
      `the report does not carry the cap-exempt section ` +
        `\`${entry.heading}\`: exempt is not optional — the carve-out ` +
        `requires the section, it does not make it discretionary ` +
        `(required by ${entry.requiredBy})`,
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

interface SkillCandidate {
  /** Path segments below the project root. */
  readonly segments: readonly string[];
  /**
   * True when the surface is a CONSUMER PROJECT's own skills directory, so it
   * may only be graded on a tree the toolkit actually owns.
   */
  readonly managedOnly: boolean;
}

/**
 * Both skill roots, in probe order — the `closing_summary_capability_keys` idiom.
 *
 * THE ASYMMETRY IS THE WHOLE POINT (PR #76 finding F12).
 *
 * The first root is the TOOLKIT'S OWN AUTHORING TREE. A tree carrying
 * `plugins/dev-process-toolkit/skills/…` IS the toolkit; it needs no separate
 * proof of ownership, it deliberately carries no managed marker of its own, and
 * gating it would silence the probe on the one tree it was written for.
 *
 * The second root is a CONSUMER PROJECT's `.claude/skills/`, and the eleven
 * `ADOPTING_STAGES` names are ordinary English words — `setup`, `deps`,
 * `implement`, `upgrade`. Measured on a project that never installed the
 * toolkit: its own `.claude/skills/setup/SKILL.md` ("set up the local dev
 * environment") and `.claude/skills/deps/SKILL.md` ("update dependencies")
 * collected two error-severity GATE FAILED rows ordering them to close
 * `/setup` with a status-block fence they have never heard of. So that root is
 * graded only when the shared predicate says the toolkit owns the tree.
 *
 * WHY PROBE #74 COULD NOT CATCH THIS. `claudemd_probe_managed_guard` is the
 * structural fuse STE-432 installed to force every managed-ness question
 * through `./toolkit_managed`, and it would have caught the omission — except
 * that it SELECTS only modules whose body resolves a path to the managed-tree
 * config file, and this module resolved none. It asks the ownership question
 * without ever naming the file that answers it, so the fuse's selector saw
 * nothing to grade and the gap shipped unremarked. The class is "modules that
 * decide applicability by ownership without touching that file", and this
 * comment is where the next one gets found.
 */
const skillCandidates = (stage: string): readonly SkillCandidate[] => [
  {
    segments: ["plugins", "dev-process-toolkit", "skills", stage, "SKILL.md"],
    managedOnly: false,
  },
  { segments: [".claude", "skills", stage, "SKILL.md"], managedOnly: true },
];

interface AdoptingSkillSurvey {
  /** Surfaces in scope, with their bodies — the only ones ever graded. */
  graded: { stage: AdoptingStage; file: string; body: string }[];
  /**
   * Repo-relative paths of surfaces that EXIST but went ungraded because the
   * tree is not toolkit-managed, sorted.
   *
   * Reported rather than dropped: a silently count-only skip is the M136
   * defect this repository has already paid for once — a surface silenced and
   * a surface never present read identically to the operator.
   */
  skipped: string[];
}

/**
 * Every adopting SKILL.md under `projectRoot`, split into the surfaces this
 * probe may grade and the project-local ones it declines.
 *
 * The managed-ness answer comes from `isToolkitManaged` — the SHARED predicate,
 * consulted here rather than re-derived. Four probes once open-coded that
 * question and drifted apart, which is exactly why STE-432 made it one module.
 */
function surveyAdoptingSkills(projectRoot: string): AdoptingSkillSurvey {
  const managed = isToolkitManaged(projectRoot);
  const graded: { stage: AdoptingStage; file: string; body: string }[] = [];
  const skipped: string[] = [];
  for (const stage of ADOPTING_STAGES) {
    for (const candidate of skillCandidates(stage)) {
      const abs = join(projectRoot, ...candidate.segments);
      if (!existsSync(abs)) continue;
      const file = candidate.segments.join("/");
      if (candidate.managedOnly && !managed) {
        skipped.push(file);
        continue;
      }
      try {
        graded.push({ stage, file, body: readFileSync(abs, "utf-8") });
      } catch {
        /* an unreadable surface is not a violation */
      }
    }
  }
  return { graded, skipped: skipped.sort() };
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
  return gradeAdoptingSkills(surveyAdoptingSkills(projectRoot).graded);
}

/**
 * The grading half, over an ALREADY-SCOPED surface list.
 *
 * Split out so the probe surveys the tree exactly once: a second
 * `surveyAdoptingSkills` call would re-ask the ownership question and could, on
 * a tree being written to underneath it, answer differently for the `skipped`
 * list than for the graded one.
 */
function gradeAdoptingSkills(
  files: readonly { stage: AdoptingStage; file: string; body: string }[],
): StageAdoptionViolation[] {
  const violations: StageAdoptionViolation[] = [];
  for (const { stage, file, body } of files) {
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
  /** True when the tree carries none of the eleven IN SCOPE — nothing to grade. */
  vacuous: boolean;
  /**
   * Repo-relative `.claude/skills/…` paths that exist but went ungraded because
   * the tree is not toolkit-managed, sorted. Named, never merely counted.
   */
  skipped: string[];
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
 * violations, `vacuous: true`) on a tree carrying none of the eleven IN SCOPE —
 * which now includes a consumer tree whose only adopting-stage names live under
 * `.claude/skills/` and which the toolkit does not own. Those surfaces are
 * named in `skipped`, so declining to grade is visible rather than silent.
 */
export async function runStageBlockAdoptionProbe(
  projectRoot: string,
): Promise<StageBlockAdoptionReport> {
  const { graded, skipped } = surveyAdoptingSkills(projectRoot);
  if (graded.length === 0) return { violations: [], vacuous: true, skipped };
  const violations = gradeAdoptingSkills(graded).map((v) => ({
    file: v.file,
    line: v.line,
    reason: v.reason,
    note: `${v.file}:${v.line} — ${v.reason}`,
    message: buildMessage(v),
    severity: "error" as Severity,
  }));
  return { violations, vacuous: false, skipped };
}

// ---------------------------------------------------------------------------
// The CLI front door
// ---------------------------------------------------------------------------
//
// TWO MODES, one entry point:
//
//   bun adapters/_shared/src/stage_block_adoption.ts [<projectRoot>]
//       the SHIPPED probe mode — scans an AUTHORING tree with the scanner half.
//
//   bun adapters/_shared/src/stage_block_adoption.ts --report <path>
//       grades one CAPTURED, RENDERED stage report off disk with
//       `verifyStageReportAdoption` — the report-level half, whose subject is
//       a rendered report rather than a SKILL.md.
//
// Exit codes: 0 clean, 1 violations (each printed in the NFR-10 shape), 2 a bad
// invocation. Nothing that could read as a clean verdict reaches stdout on a
// bad invocation.
//
// This is the SAME shape `deliver_stage_capture`'s captured-report grader ships
// with, and it exists because a grader nobody can run is a grader nothing
// enforces. Its running FREQUENCY is stated where the contract is stated:
// `docs/stage-status-block.md`.

/** The module path, plugin-root-relative — printed, never re-derived by a caller. */
const MODULE_REL = "adapters/_shared/src/stage_block_adoption.ts";

/** The one usage line both bad-invocation exits print. */
export const FRONT_DOOR_USAGE = [
  `usage: bun ${MODULE_REL} [<projectRoot>]        # scan an authoring tree`,
  `       bun ${MODULE_REL} --report <path>        # grade a captured report`,
].join("\n");

/**
 * One report-level violation, rendered in the module's existing NFR-10 shape:
 * a one-line verdict naming the subject, then `Remedy:`, then `Context:`.
 *
 * The reason rides the verdict line VERBATIM, so two different refusals print
 * two different verdicts. A front door that printed one constant message would
 * have executed without measuring anything.
 */
function buildReportMessage(reportPath: string, reason: string): string {
  return [
    `${PROBE_ID}: ${reportPath} — ${reason}`,
    `Remedy: close the stage with exactly one ` +
      `\`${STAGE_BLOCK_FENCE_BANNER}\`` +
      ` fence as the LAST thing in the report, at most ` +
      `${PROSE_LEAD_IN_LINE_CAP} lines of prose above it, and every capability ` +
      `token inside the fence. The contract is \`docs/stage-status-block.md\`; ` +
      `the grader is \`verifyStageReportAdoption\` in \`${MODULE_REL}\`.`,
    `Context: report=${reportPath}, probe=${PROBE_ID}, ` +
      `prose_cap=${PROSE_LEAD_IN_LINE_CAP}, severity=error`,
  ].join("\n");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);

  if (argv[0] === "--report") {
    const reportPath = argv[1];
    if (reportPath === undefined || reportPath.length === 0) {
      console.error(`${PROBE_ID}: --report needs a path to a captured report`);
      console.error(FRONT_DOOR_USAGE);
      process.exit(2);
    }
    let body: string;
    try {
      body = readFileSync(reportPath, "utf-8");
    } catch {
      console.error(`${PROBE_ID}: cannot read ${reportPath}`);
      console.error(FRONT_DOOR_USAGE);
      process.exit(2);
    }
    const verdict = verifyStageReportAdoption(body);
    if (verdict.ok) {
      console.log(
        `${PROBE_ID}: clean — ${reportPath} adopts the status block ` +
          `(one fence, block last, at most ${PROSE_LEAD_IN_LINE_CAP} prose lines above it)`,
      );
      process.exit(0);
    }
    for (const reason of verdict.reasons) {
      console.log(buildReportMessage(reportPath, reason));
    }
    process.exit(1);
  }

  const projectRoot = argv[0] ?? process.cwd();
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
  // The skip is reported on every run, verdict or not: an operator whose
  // project-local skills went ungraded must be able to see that, rather than
  // read a clean row and assume they were measured.
  for (const file of report.skipped) {
    console.log(
      `${PROBE_ID}: skipped ${file} — the toolkit does not manage this tree, ` +
        `so its project-local skills are out of scope`,
    );
  }
  process.exit(report.violations.length === 0 ? 0 : 1);
}
