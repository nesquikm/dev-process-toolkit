// implement_advisory_notes — the shared advisory-note formatter, and the
// DURABLE store the report's bounded line points at.
//
// WHAT WAS HERE BEFORE: nothing. `docs/implement-reference.md` § Advisory Notes
// has described "a single shared formatter" and "two surfaces" that consume it
// in the present tense since STE-148 (M40). Measured 2026-09-01: `advisoryNote`
// occurs exactly ONCE in the plugin's TypeScript, in
// `tests/implement-advisory-notes.test.ts` — a test pinning SKILL.md PROSE.
// There was no formatter, no store, and no consumer. The doc described a module
// that did not exist, which is the fourth "it is recorded elsewhere" claim this
// milestone has found resolving to nothing.
//
// WHY THE REPORT LINE IS BOUNDED. `## Advisory notes` is a cap-exempt section
// of the stage status block, and AC-STE-533's carve-out is now BOUNDED by what
// this renderer emits (`exemptSectionBudget` in `stage_block_adoption.ts` reads
// its budget straight off `renderMaxAdvisoryNotes()`). An unbounded section is
// how a stage reinstates its whole former report under a compliant heading —
// the defect M137 round 2 exists to close — so the section is FIXED-SIZE BY
// CONSTRUCTION: a heading and exactly one line, whatever the note count. That
// is what makes a static budget fundable at all.
//
// AND WHY BOUNDING THE DISPLAY IS NOT BOUNDING THE RECORD. Advisory notes are
// the channel a bounded review loop uses to escalate what it could NOT resolve,
// so losing the tail is the worst possible loss. The persistence that shipped
// before this module lived inside § Milestone Archival — "before staging the
// archive moves" — and an ordinary `/implement <FR-id>` run archives nothing,
// so on that path the step-14 report was the ONLY place the notes existed.
// Displaying "first 3 of 7" there would have destroyed four concerns outright.
//
// So the record is written FIRST and IN FULL, on every run, to
// `.dpt/ledger/advisory-notes.md` — `ledger/` being this repository's declared
// home for "state that must outlive a run" (`dpt_paths.ts`), already covered by
// `.dpt/.gitignore`'s CLOSED rule set, so nothing new has to be ignored. The
// report then shows the first few AND CITES that file, and the citation is
// verified BY EXECUTION: `persistAdvisoryNotes` reads the bytes back from the
// path it is about to print and refuses if they are not there. A citation
// nobody proved is the exact class of claim this milestone is closing.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";

import { advisoryNotesPath } from "./dpt_paths";

/** The section heading the step-14 report emits. */
export const ADVISORY_NOTES_HEADING = "## Advisory notes";

/**
 * The zero-entry body, mandated by `skills/implement/SKILL.md` Phase 4 step 14:
 * "never absent, so the operator never confuses 'no concerns' with 'concerns
 * hidden'". The heading without it, or the line without the heading, are both
 * refusals of that mandate.
 */
export const NO_ADVISORY_NOTES = "No advisory notes.";

/**
 * How many note bodies the ONE report line carries before it says "and here is
 * where the rest are".
 *
 * A display bound, never a record bound: `persistAdvisoryNotes` has already
 * written all of them by the time this applies, and the line states the total
 * so the reader keeps the magnitude and loses only the tail.
 */
export const ADVISORY_NOTES_SHOWN = 3;

/** The Phase 3 Stage B capture record — the schema `/implement` § Stage B states. */
export interface AdvisoryNote {
  /** The review pass the concern came out of (2, for the Pass 2 escalation). */
  pass: number;
  concern: string;
  /** Why it was routed to advisory rather than gate-blocking. */
  rationale: string;
  classification: "advisory";
}

/** What one run wrote, and where a reader finds it. */
export interface PersistedAdvisoryNotes {
  /** Absolute path written. */
  path: string;
  /** The path AS CITED in the report — relative to the project root. */
  citation: string;
  /** How many notes this run appended. */
  appended: number;
  /**
   * True only after the bytes were READ BACK from `path` and matched. There is
   * no code path that returns `false`: a failed read-back throws, because a
   * citation that cannot be proved must not be printed.
   */
  verified: true;
}

/** One line, always: a body carrying newlines would break the section's budget. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * ONE advisory note's bullet body — the byte-identical shape both consuming
 * surfaces render, and the reason this module exists rather than two.
 *
 * `<concern> — <rationale>`, per `docs/implement-reference.md` § Advisory Notes.
 */
export function advisoryNoteBody(note: AdvisoryNote): string {
  return `${oneLine(note.concern)} — ${oneLine(note.rationale)}`;
}

/** The FULL list, one bullet per advisory entry, in capture order. */
export function renderAdvisoryNoteBullets(
  notes: readonly AdvisoryNote[],
): readonly string[] {
  return notes.map((note) => `- ${advisoryNoteBody(note)}`);
}

/**
 * The archived-FR `## Implementation notes` body (Phase 4 § Milestone
 * Archival), and the durable store's per-run block: the whole list, never
 * bounded, with the same empty-state literal the report uses.
 */
export function renderAdvisoryNotesFull(
  notes: readonly AdvisoryNote[],
): readonly string[] {
  return notes.length === 0
    ? [NO_ADVISORY_NOTES]
    : renderAdvisoryNoteBullets(notes);
}

/**
 * Append this run's notes to the durable store, then PROVE the citation.
 *
 * The read-back is not defensive decoration. The report is about to tell an
 * operator "the rest are over there", and this milestone has now measured four
 * separate claims of that shape resolving to nothing — two AC citations landing
 * in `//` comments, a smoke fixture group naming a file no step produces, and
 * the formatter this module replaces. So the bytes are read back from the same
 * path the citation names, in the same run, and a mismatch throws instead of
 * printing a promise nobody kept.
 *
 * Zero notes append nothing — there is no record to lose — and the report keeps
 * the mandated empty-state literal, which carries no citation because it needs
 * none.
 */
export function persistAdvisoryNotes(
  projectRoot: string,
  notes: readonly AdvisoryNote[],
  meta: { at?: string; label?: string } = {},
): PersistedAdvisoryNotes {
  const path = advisoryNotesPath(projectRoot);
  const citation = relative(projectRoot, path);
  if (notes.length === 0) {
    return { path, citation, appended: 0, verified: true };
  }

  const at = meta.at ?? new Date().toISOString();
  const label = oneLine(meta.label ?? "");
  const block = [
    `## /implement — ${at}${label.length > 0 ? ` — ${label}` : ""}`,
    "",
    ...renderAdvisoryNoteBullets(notes),
    "",
  ].join("\n");

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, block, "utf-8");

  // THE PROOF, by execution: read it back from the cited path.
  let readBack: string;
  try {
    readBack = readFileSync(path, "utf-8");
  } catch (error) {
    throw new Error(
      `advisory notes were appended to ${citation} but that path could not be ` +
        `read back in the same run (${String(error)}); the step-14 report may ` +
        "not cite a store it cannot prove",
    );
  }
  if (!readBack.includes(block)) {
    throw new Error(
      `advisory notes were appended to ${citation} but reading the path back ` +
        "did not return the bytes just written; the step-14 report may not " +
        "cite a store it cannot prove",
    );
  }
  return { path, citation, appended: notes.length, verified: true };
}

/**
 * The step-14 `## Advisory notes` section: the heading and EXACTLY ONE line.
 *
 * `citation` is the path `persistAdvisoryNotes` proved. It is required for a
 * non-empty list and refused when absent — a bounded display whose pointer to
 * the full record is missing is the data loss this shape exists to avoid, not a
 * cosmetic omission.
 */
export function renderAdvisoryNotes(
  notes: readonly AdvisoryNote[],
  citation: string | null = null,
): readonly string[] {
  if (notes.length === 0) return [ADVISORY_NOTES_HEADING, NO_ADVISORY_NOTES];
  if (citation === null || citation.trim().length === 0) {
    throw new Error(
      `${ADVISORY_NOTES_HEADING} carries ${notes.length} note(s) but no ` +
        "citation of the durable store: persist the full list with " +
        "`persistAdvisoryNotes` first and render its `citation`, because the " +
        "bounded line is only honest while the tail is recoverable",
    );
  }
  const shown = Math.min(ADVISORY_NOTES_SHOWN, notes.length);
  const bodies = notes.slice(0, shown).map(advisoryNoteBody).join("; ");
  return [
    ADVISORY_NOTES_HEADING,
    `- first ${shown} of ${notes.length} (full list: ${citation}): ${bodies}`,
  ];
}

/**
 * The LARGEST this section's renderer can emit — the number
 * `exemptSectionBudget` funds the carve-out with.
 *
 * It is the empty-state render because every render is the same SIZE: the
 * heading and one line, at zero notes and at seven hundred. A section whose
 * size grew with its content could not fund a static budget, which is precisely
 * why the display is bounded and the record lives in the store above.
 */
export function renderMaxAdvisoryNotes(): readonly string[] {
  return renderAdvisoryNotes([]);
}
