// M137 / STE-533 — THE CONFORMANCE MATRIX.
//
// THE DEFECT THIS FILE EXISTS TO CATCH, stated first because it is the reason
// nine broken stages shipped.
//
// `verifyStageReportAdoption` grades a rendered stage report. Every lens that
// ran on it — three rounds of budget arithmetic, a probe, a fixture group, five
// per-AC audits — was anchored to the FIX DIFF, so its coverage equalled the
// files a fix happened to touch. Nobody ever asked the only question that
// matters about an adoption contract:
//
//     for EVERY stage that adopted it, can the report that stage's OWN
//     SKILL.md instructs actually conform?
//
// THE DEFECT THIS FILE ITSELF SHIPPED, and the reason it was rewritten. The
// first version answered that question against a HAND-WRITTEN LITERAL TABLE of
// eleven report plans. It never read a SKILL.md. MEASURED: spec-archive's
// bounding edit was reverted on disk — "at most the first 3 as `first 3 of <K>`
// rows" replaced by "every finding as its own row", the exact revert of the fix
// — and this suite stayed 20/20 green. Six of the nine stages' bounding edits
// could be reverted with the whole gate clean. The one deliverable that was
// supposed to make a tenth broken stage unshippable was itself the class it was
// built to catch: a guard that runs, returns cleanly, and measures nothing.
//
// SO THE ROW BUDGET IS NOW DERIVED FROM THE SKILL.md. For every stage in
// `ADOPTING_STAGES` this suite reads that stage's own text, derives what its
// closing report is instructed to contain (`tests/_stage_report_instruction.ts`
// states exactly what is derived, what is not, and what is refused), builds
// that report, and grades it with `verifyStageReportAdoption`. Reverting a
// stage's bounding edit removes the clause the derivation reads, the stage
// becomes UNANALYSABLE, and two legs go red naming the paragraph — asserted
// here in memory for every bounded stage, with the mutation asserted to have
// APPLIED before any verdict is read, because a mutation that never applied
// reads as a pass.
//
// THE LITERAL TABLE SURVIVES AS A CROSS-CHECK ONLY. `PLANS` below no longer
// decides any verdict; it is graded AGAINST the derivation, and a bound the
// literal claims that the SKILL.md does not state is a finding rather than a
// fallback. An unbounded fallback is how this file went hollow the first time.
//
// WHAT THE DERIVATION COULD NOT DO, said out loud. A stage whose instructed
// content cannot be derived at all FAILS LOUDLY as unanalysable — it does not
// pass quietly and it does not fall back. Measured on the way in: `/upgrade`
// was one. Its § Step 6 ordered per-entry content ("entries applied (id +
// summary), entries declined, assisted entries routed and their outcome") and
// bounded none of it; the claim that it was "bounded by construction" existed
// only in this test file's own comment, on this test file's own authority.
// That is the shape the rewrite was for, and it was found by the rewrite.
//
// WHY THE REPORTS ARE BUILT WITH A FULL PROSE LEAD-IN. Because the cap is the
// one thing about narration every SKILL.md states in its own words, and it is
// read out of that sentence rather than out of the module — a leg below
// asserts the two agree, so a doc that drifts from `PROSE_LEAD_IN_LINE_CAP`
// reddens instead of going quiet. Filling the derived cap exactly grades the
// worst case the instruction permits.
//
// TWELFTH-STAGE COVERAGE. The suite iterates `ADOPTING_STAGES`, and a stage is
// covered by reading its SKILL.md, so a twelfth added tomorrow is graded with
// no edit here — and one whose text says nothing is refused, not skipped.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADOPTED_FENCE_LINE_CAP,
  ADOPTING_STAGES,
  PROSE_LEAD_IN_LINE_CAP,
  exemptSectionsFor,
  maxAdoptedReportLines,
  verifyStageReportAdoption,
  type AdoptingStage,
} from "../adapters/_shared/src/stage_block_adoption";
import {
  STAGE_BLOCK_FENCE_BANNER,
  STAGE_REPORT_LINE_CAP,
} from "../adapters/_shared/src/stage_status_block";
import {
  deriveReportInstruction,
  revertBoundingEdit,
  type DerivedInstruction,
} from "./_stage_report_instruction";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const read = (path: string): string => readFileSync(path, "utf-8");
const skillPath = (stage: string): string =>
  join(PLUGIN_ROOT, "skills", stage, "SKILL.md");

// ---------------------------------------------------------------------------
// The report builder
// ---------------------------------------------------------------------------

/**
 * ONE stage's report AS ITS SKILL.md INSTRUCTS IT, at realistic size.
 *
 * `cite` names the SKILL.md section the plan was read off, so a reader can
 * check the construction against its source rather than trust this file.
 * `driving` names the content whose SIZE is what breaks the stage — the number
 * a maintainer has to bound to turn the leg green.
 */
interface StageReportPlan {
  /** Narration the SKILL.md orders ABOVE the fence, at realistic size. */
  readonly prose: readonly string[];
  /** Rows the SKILL.md says ride INSIDE the fence. */
  readonly summary: readonly string[];
  readonly gate?: readonly string[];
  readonly drive?: readonly string[];
  readonly e2e?: readonly string[];
  readonly followUps?: readonly string[];
  /** Where in that stage's SKILL.md this shape is written down. */
  readonly cite: string;
  /** The content whose size drives the verdict. */
  readonly driving: string;
}

const NONE = ["  - (none found)"] as const;

/** Render `n` rows from a template — the per-item content, at realistic count. */
const rows = (n: number, render: (i: number) => string): string[] =>
  Array.from({ length: n }, (_, i) => render(i + 1));

/**
 * Assemble the rendered report: the prose the stage's SKILL.md orders, one
 * status block, and the cap-exempt sections that stage OWES — read off
 * `exemptSectionsFor`, never re-listed here, because exempt is not optional and
 * a report missing one is refused for a reason that has nothing to do with size.
 */
function buildReport(stage: AdoptingStage, plan: StageReportPlan): string {
  const lines: string[] = [
    ...plan.prose,
    STAGE_BLOCK_FENCE_BANNER,
    `stage: ${stage}`,
    "milestone: M137",
    "status: ok",
    "summary:",
    ...plan.summary,
    "gate:",
    ...(plan.gate ?? NONE),
    "drive:",
    ...(plan.drive ?? NONE),
    "e2e:",
    ...(plan.e2e ?? NONE),
    "follow_ups:",
    ...(plan.followUps ?? NONE),
    "```",
  ];
  for (const entry of exemptSectionsFor(stage)) lines.push(...entry.renderMax());
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The eleven plans — DEMOTED to a cross-check
// ---------------------------------------------------------------------------
//
// These decide NO verdict. Every conformance leg below builds its report from
// `deriveReportInstruction`, and this table is held AGAINST that derivation:
// a bound the literal claims which the SKILL.md does not state is a finding.
//
// There is deliberately no `DEFAULT_PLAN` any more. A fallback plan for a stage
// with no entry here is exactly the shape that let a twelfth stage — and then
// nine of the eleven — be "graded" by a literal nobody had checked against the
// instruction. A stage with no entry is simply not cross-checked; it is still
// DERIVED, still graded, and still refused if its own text bounds nothing.

const PLANS: Partial<Record<AdoptingStage, StageReportPlan>> = {
  // § Closing-summary contract, item 1: the markdown table is SUPERSEDED for
  // the closing report — `list` emits a `manifest entries: <M>` row inside the
  // fence and at most the first 3 entries, total stated.
  "best-practices": {
    prose: [
      "/best-practices list — the manifest is in the block below.",
      "Next: run `/dev-process-toolkit:best-practices add` to catalogue another doc.",
    ],
    summary: [
      "  - manifest entries: 11 — first 3 of 11 listed below",
      ...rows(
        3,
        (i) => `  - entry-${i} — docs/bp/entry-${i}.md (scope src/area-${i}/**, topics topic-${i})`,
      ),
      "  - `best_practices_list_11_entries`",
      "  - `branch_gate_clean`",
    ],
    cite: "skills/best-practices/SKILL.md § Closing-summary contract",
    driving: "11 manifest entries — bounded to first 3, total stated",
  },

  // § Step 5 hand-off: "Summarize the approved decision in 2–3 sentences", then
  // one transition line. BOUNDED BY CONSTRUCTION — the size does not grow with
  // the work, which is why this stage is expected to pass.
  brainstorm: {
    prose: [
      "Design approved: the adopting stages emit one status block in place of",
      "the closing narration, with the per-item rows riding inside the fence.",
      "The /deliver hand-off banner is untouched — two banners, two owners.",
      "Design approved. Run `/dev-process-toolkit:spec-write` and reference this decision.",
    ],
    summary: [
      "  - decision: one banner per vocabulary",
      "  - approaches considered: 3",
      "  - next: /dev-process-toolkit:spec-write",
    ],
    cite: "skills/brainstorm/SKILL.md § Design hand-off",
    driving: "2–3 sentences — fixed",
  },

  // § /deps summary: BOTH reference tables are SUPERSEDED for the closing
  // report — every subcommand, `list` and `sync` included, emits a
  // `manifest entries: <M>` row inside the fence and at most the first 3.
  deps: {
    prose: [
      "/deps list — the manifest is in the block below.",
      "Next: run `/dev-process-toolkit:deps sync` to reconcile sibling checkouts.",
    ],
    summary: [
      "  - manifest entries: 11 — first 3 of 11 listed below",
      ...rows(3, (i) => `  - sibling-${i} — ../sibling-${i} (present, synced)`),
      "  - `deps_list_11_entries`",
      "  - `branch_gate_clean`",
    ],
    cite: "skills/deps/SKILL.md § /deps summary",
    driving: "11 manifest entries — bounded to first 3, total stated",
  },

  // § Reporting + § Code Review + § Drift Check + § Verdict. All three of the
  // first are now SUPERSEDED in their own words — reference material surfaced
  // inline while the gate runs, not verbatim content the closing report
  // reproduces. The report carries roll-up counts and a bounded drift sample;
  // a FAILED command and a CONCERN criterion are named in full and never
  // bounded away, which is why the clean run above renders as three rows.
  // § Verdict is untouched: the verdict line is genuine narration.
  "gate-check": {
    prose: [
      "GATE PASSED WITH NOTES — 1 AC not found; the numbers are in the block below.",
    ],
    summary: [
      "  - commands: 3 of 3 pass — typecheck 0 errors, lint 0 warnings, tests 9412 passed / 0 failed",
      "  - code review: 5 of 5 criteria OK — OVERALL: OK",
      "  - drift: 1 of 41 ACs not found, named below",
      "  - AC-STE-533.1 | not found | —",
      "  - 82 probes run, 0 error-severity violations",
    ],
    gate: ["  - pass 9412, fail 0, skip 16, baseline 16, delta 0"],
    cite: "skills/gate-check/SKILL.md §§ Reporting, Code Review, Drift Check, Verdict",
    driving: "3 commands + 5 criteria rolled up; drift bounded, total stated",
  },

  // Phase 4 step 14: "Present: AC checklist with pass/fail status; files
  // created/modified; test coverage; self-review findings; spec changes; drift
  // findings; gate check result citing actual output; number of review rounds
  // used" — eight mandates — plus the four Archival hygiene lines a milestone
  // run owes. Step 14 now orders all eight INSIDE the fence with every
  // per-item list bounded and its total stated, which is the shape the model
  // fixture below carries; the archival-hygiene four ride as one row.
  implement: {
    prose: [
      "/implement M137 — the operator approved the commit at the Phase 4 gate.",
      "Full gate re-run from the plugin root: green. The numbers are below.",
    ],
    summary: [
      "  - acceptance criteria: 41 of 41 pass — first 3 of 41 listed below",
      "  - AC-STE-533.1 pass — the adopting eleven, enumerated and stated once",
      "  - AC-STE-533.1a pass — one banner, one owner, one vocabulary each",
      "  - AC-STE-533.2 pass — the block replaces the narration above it",
      "  - files created/modified: 22 — first 3 of 22 listed below",
      "  - adapters/_shared/src/stage_block_adoption.ts (modified, +214/-61)",
      "  - adapters/_shared/src/stage_status_block.ts (modified, +18/-4)",
      "  - tests/m137-ste-533-stage-block-adoption.test.ts (modified, +503/-77)",
      "  - test coverage: 41 of 41 ACs pinned; 0 changed modules without direct tests",
      "  - self-review findings: 3 caught and fixed, 0 remaining",
      "  - spec changes: 1 edge case added, 2 deviations resolved, 0 provisional",
      "  - drift findings: 0 against specs/ (traceability map complete)",
      "  - archival hygiene: 6 links rewritten in 2 plans, 3 verify lines updated, 4 rows appended, 1 FR staged",
      "  - review rounds used: 2 of 2; `best_practices_lens_applied`; `end_to_end_none_needed`",
    ],
    gate: ["  - pass 9412, fail 0, skip 16, baseline 16, delta 0"],
    drive: ["  - pass 12, fail 0, skip 0"],
    cite: "skills/implement/SKILL.md Phase 4 step 14",
    driving: "41 ACs + 22 files — bounded to first 3 each, totals stated",
  },

  // § Closing summary: the gist URL, the file list with byte sizes, the
  // redaction-match counts, and the verbatim `Next:` block. `scrubSecrets`
  // emits one row per entry in `SECRET_PATTERNS` REGARDLESS OF MATCH COUNT, so
  // that group is a fixed 7 rows on every run — a floor no lead-in budget can
  // absorb, and the one content here that cannot be bounded by sampling.
  // § 9 now AGGREGATES it to a count and CITES `metadata.json`, whose
  // `redaction_summary` field § 6 composes and § 8 uploads in the same gist.
  // The file list is bounded by construction (§ 6: three files maximum).
  "report-issue": {
    prose: [
      "https://gist.github.com/octocat/0f7a1c9e2b3d4f5a6b7c8d9e0f1a2b3c",
      "Next:",
      "  - Share this URL with the plugin maintainer for triage.",
      "  - Or run /dev-process-toolkit:brainstorm <gist-url> to self-debug from the captured context.",
    ],
    summary: [
      "  - severity: medium (verified)",
      "  - redaction: 3 match(es) across 7 pattern(s) — breakdown in metadata.json",
      "  - payload: 3 files, 423.2 KB",
      "  - narrative.md 2.1 KB",
      "  - context.md 8.4 KB",
      "  - transcript.jsonl 412.7 KB",
      "  - `report_issue_redacted_payload`",
      "  - `report_issue_session_matched_marker`",
      "  - `report_issue_evidence_verified`",
    ],
    cite: "skills/report-issue/SKILL.md § Closing summary",
    driving: "7 fixed SECRET_PATTERNS rows — aggregated, breakdown cited to metadata.json",
  },

  // Step 11 Report: "Summarize what was created" now reads INSIDE THE FENCE,
  // BOUNDED — a `files created/modified: <M>` row then at most the first 3. A
  // bootstrap run creates the CLAUDE.md, the settings files, the hook, the
  // spec tree and the templates — thirteen files on a plain TypeScript
  // project, and `git status --porcelain` still holds every path.
  setup: {
    prose: [
      "/setup — TypeScript project bootstrapped; the file list is in the block below.",
    ],
    summary: [
      "  - files created/modified: 13 — first 3 of 13 listed below",
      ...rows(3, (i) => `  - created: specs/generated/file-${i}.md`),
      "  - `setup_allowlist_entries_added`",
      "  - `tracker_config_write_succeeded`",
    ],
    cite: "skills/setup/SKILL.md § 11 Report",
    driving: "13 created files — bounded to first 3, total stated",
  },

  // § Drift check: the Schema I table is the DRIFT report, rendered in full at
  // the user-choice gate and written verbatim to `specs/drift-<date>.md` on
  // the save-for-later path — reference material surfaced inline, not content
  // the CLOSING report reproduces. The block carries the counts and at most
  // the first 3 findings; a milestone archival routinely finds double figures.
  "spec-archive": {
    prose: [
      "/spec-archive M137 — 4 FRs and 1 plan archived; the drift roll-up is below.",
    ],
    summary: [
      "  - archived 4 FRs and 1 plan",
      "  - drift findings: 11 (3 high, 8 medium) — first 3 of 11 listed below",
      ...rows(
        3,
        (i) =>
          `  - specs/requirements.md § ${i} | medium | stale reference | delete line ${i}`,
      ),
    ],
    cite: "skills/spec-archive/SKILL.md § Drift check (Schema I)",
    driving: "11 drift findings — bounded to first 3, total stated",
  },

  // § 4 report: the drift refresh hint is genuine narration and stays above
  // the fence — the SKILL.md already calls it "a single line of the prose
  // lead-in". The per-AC traceability now rides INSIDE the fence, bounded to
  // the first 3 with the total stated, and the § 4b status table is
  // superseded for the closing report. A typical FR carries 6–9 ACs.
  "spec-review": {
    prose: [
      "Live-spec refresh suggested — 3 drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.",
    ],
    summary: [
      "  - ACs audited: 6 — 6 done, 0 missing, 0 partial — first 3 of 6 listed below",
      ...rows(
        3,
        (i) =>
          `  - AC-STE-533.${i} → adapters/_shared/src/stage_block_adoption.ts:${100 + i}, tests/m137-ste-533-stage-block-adoption.test.ts:${500 + i}`,
      ),
      "  - drift_count: 3",
    ],
    cite: "skills/spec-review/SKILL.md §§ 4 report, Live-spec drift refresh hint",
    driving: "6 ACs — bounded to first 3, total stated, gaps never bounded away",
  },

  // § 7 static map + § Size floor: this is the ONE stage whose SKILL.md
  // already said the rows ride INSIDE the fence — which is HALF the shape, and
  // the half that does not fit on its own: a multi-FR interview fires on the
  // order of 25 rows against a 26-line fence. § Size floor now bounds them to
  // the first 6 with the total stated; the § 7 static map holds every body.
  "spec-write": {
    prose: [
      "Specs written for M137: 4 FRs, 41 ACs, plan and requirements updated.",
      "Every capability row the run fired is accounted for in the block below.",
    ],
    summary: [
      "  - capability rows: 25 fired — first 6 of 25 listed below",
      ...rows(6, (i) => `  - \`capability_row_${i}\``),
    ],
    cite: "skills/spec-write/SKILL.md § 7 static map, § Size floor",
    driving: "25 capability rows — bounded to first 6, total stated",
  },

  // § Step 6 closing summary: entries applied, entries declined, assisted
  // entries and their outcome, the backup directory verbatim, and standing
  // advisories. BOUNDED BY CONSTRUCTION — the migration registry is a fixed,
  // small, version-ordered list, so the report cannot grow with the project.
  upgrade: {
    prose: [
      "/upgrade — 3 entries applied, 1 declined, 1 assisted.",
      "Every applied entry's detect() now returns applies: false.",
    ],
    summary: [
      "  - applied: m104-dpt-layout, m106-branch-naming, m132-evidence-ledger",
      "  - declined: m109-upgrade-autodetect",
      "  - assisted: m108-migration-framework — routed, operator approved",
      "  - Backup: .dpt/backup/2026-09-01T09-14-02Z",
      "  - advisories still standing: 0",
    ],
    cite: "skills/upgrade/SKILL.md § Step 6 — closing summary",
    driving: "fixed-size migration registry",
  },
};

// ---------------------------------------------------------------------------
// THE MATRIX
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE DERIVED REPORT — built from the SKILL.md, never from the table above
// ---------------------------------------------------------------------------

/** Every adopting stage's derivation, read once. */
const DERIVED: ReadonlyMap<AdoptingStage, DerivedInstruction> = new Map(
  ADOPTING_STAGES.map((stage) => [
    stage,
    deriveReportInstruction(stage, read(skillPath(stage))),
  ]),
);

const derivedFor = (stage: AdoptingStage): DerivedInstruction => {
  const derived = DERIVED.get(stage);
  if (derived === undefined) throw new Error(`no derivation for ${stage}`);
  return derived;
};

/** The `summary:` rows the instruction adds up to, rendered. */
function derivedSummaryRows(derived: DerivedInstruction): string[] {
  const out: string[] = [];
  const bounded = derived.groups.filter((g) => g.disposition.kind === "bounded");
  if (derived.mandateCount !== null) {
    // A fixed mandate list rides as one row each; the mandates that are
    // themselves bounded lists contribute their item rows on top.
    for (let i = 1; i <= derived.mandateCount; i += 1) {
      out.push(`  - mandate ${i} of ${derived.mandateCount}, rolled up to one row`);
    }
  }
  for (const group of derived.groups) {
    const d = group.disposition;
    if (derived.mandateCount === null && d.kind !== "fixed") {
      out.push(`  - ${group.template}`);
    }
    if (d.kind === "bounded") {
      for (let i = 1; i <= d.n; i += 1) {
        out.push(`  - bounded item ${i} of ${d.n} — first ${d.n} of <M> listed`);
      }
    } else if (d.kind === "fixed") {
      for (let i = 1; i <= d.n; i += 1) {
        out.push(`  - fixed item ${i} of ${d.n}`);
      }
    }
  }
  if (out.length === 0) out.push(NONE[0]);
  return out;
}

/**
 * The report a stage's SKILL.md instructs, at the worst case that instruction
 * permits: the full derived prose lead-in, the derived `summary:` rows, and
 * every cap-exempt section the stage OWES (read off `exemptSectionsFor`, never
 * re-listed, because exempt is not optional).
 */
function buildDerivedReport(
  stage: AdoptingStage,
  derived: DerivedInstruction,
): string {
  const proseCap = derived.proseCap;
  if (proseCap === null) {
    throw new Error(
      `${stage}: its SKILL.md states no prose lead-in cap, so the narration ` +
        "budget cannot be derived from the instruction",
    );
  }
  const lines: string[] = [
    ...rows(proseCap, (i) => `narration line ${i} of ${proseCap}, as instructed.`),
    STAGE_BLOCK_FENCE_BANNER,
    `stage: ${stage}`,
    "milestone: M137",
    "status: ok",
    "summary:",
    ...derivedSummaryRows(derived),
    "gate:",
    ...NONE,
    "drive:",
    ...NONE,
    "e2e:",
    ...NONE,
    "follow_ups:",
    ...NONE,
    "```",
  ];
  for (const entry of exemptSectionsFor(stage)) lines.push(...entry.renderMax());
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// THE MATRIX
// ---------------------------------------------------------------------------

describe("THE CONFORMANCE MATRIX — every adopting stage's own report must conform", () => {
  test("every stage in ADOPTING_STAGES is derived — none skipped", () => {
    expect([...DERIVED.keys()]).toEqual([...ADOPTING_STAGES]);
    for (const stage of ADOPTING_STAGES) {
      expect({ stage, read: derivedFor(stage).regionParagraphs.length > 0 }).toEqual({
        stage,
        read: true,
      });
    }
  });

  test("each SKILL.md STATES the prose lead-in cap, and it agrees with the module", () => {
    // The one narration budget every stage writes down in its own words. Read
    // it out of the text and hold it against the module that enforces it: a
    // SKILL.md that drifts from `PROSE_LEAD_IN_LINE_CAP` reddens here instead
    // of instructing a report the grader will refuse.
    for (const stage of ADOPTING_STAGES) {
      expect({ stage, stated: derivedFor(stage).proseCap }).toEqual({
        stage,
        stated: PROSE_LEAD_IN_LINE_CAP,
      });
    }
  });

  for (const stage of ADOPTING_STAGES) {
    test(`${stage} — its closing-report instruction is ANALYSABLE`, () => {
      // A stage whose instructed content cannot be derived fails HERE, naming
      // the paragraph and the reason, rather than passing quietly on a literal
      // somebody typed into this file.
      const derived = derivedFor(stage);
      expect({ stage, unanalysable: derived.unanalysable }).toEqual({
        stage,
        unanalysable: [],
      });
      expect(derived.groups.length).toBeGreaterThan(0);
    });

    test(`${stage} — the report its SKILL.md instructs CONFORMS`, () => {
      const derived = derivedFor(stage);
      const report = buildDerivedReport(stage, derived);
      // The verdict carries the derivation attached, so a red leg names the
      // clause a maintainer has to bound rather than handing them a line count
      // and a shrug.
      expect({
        stage,
        rows: derived.summaryRows,
        budget: derived.groups.map((g) => `${g.template} → ${g.disposition.kind}`),
        verdict: verifyStageReportAdoption(report),
      }).toEqual({
        stage,
        rows: derived.summaryRows,
        budget: derived.groups.map((g) => `${g.template} → ${g.disposition.kind}`),
        verdict: { ok: true, reasons: [] },
      });
      expect(derivedSummaryRows(derived).length).toBe(derived.summaryRows);
    });
  }

  test("MUTATION — reverting a stage's bounding edit makes the derivation REFUSE it", () => {
    // THE ACCEPTANCE TEST FOR THIS FILE. Strip the `at most the first <N>`
    // clause and the `first <N> of` row shape from the SKILL.md text — the
    // exact revert of the round-2 fix — and the stage must become unanalysable.
    // A stage whose bound is stated some other way (aggregated to one row, or
    // fixed by construction) has no such clause to revert and is exempted BY
    // NAME below, never by a silent `continue`.
    const noBoundToRevert: string[] = [];
    let reverted = 0;
    for (const stage of ADOPTING_STAGES) {
      const derived = derivedFor(stage);
      const hasBound = derived.groups.some((g) => g.disposition.kind === "bounded");
      if (!hasBound) {
        noBoundToRevert.push(stage);
        continue;
      }
      const mutant = revertBoundingEdit(read(skillPath(stage)));
      // THE MUTATION APPLIED. A revert whose regex silently fails to match
      // reads as a pass, which is the way this exact check has been fooled.
      expect({ stage, applied: mutant !== null }).toEqual({ stage, applied: true });
      const after = deriveReportInstruction(stage, mutant!);
      expect({
        stage,
        refused: after.unanalysable.length > 0,
        stillBounded: after.groups.some((g) => g.disposition.kind === "bounded"),
      }).toEqual({ stage, refused: true, stillBounded: false });
      reverted += 1;
    }
    // Named, not counted away: these three state their budget without an item
    // bound, so there is no bounding edit to revert.
    expect(noBoundToRevert).toEqual(["brainstorm", "report-issue"]);
    expect(reverted).toBe(ADOPTING_STAGES.length - noBoundToRevert.length);
  });

  test("MUTATION — every derived verdict is SIZE-SENSITIVE, so a green leg is a real one", () => {
    // A leg that passes no matter what it is handed certifies nothing. For each
    // stage, narration past the derived cap must flip the verdict: that proves
    // the grader is reading THIS report rather than agreeing by construction.
    let mutated = 0;
    for (const stage of ADOPTING_STAGES) {
      const derived = derivedFor(stage);
      const clean = buildDerivedReport(stage, derived);
      const mutant = [
        ...rows(PROSE_LEAD_IN_LINE_CAP + 1, (i) => `extra narration line ${i}.`),
        clean,
      ].join("\n");
      expect(mutant.split("\n").length).toBeGreaterThan(clean.split("\n").length);
      expect({ stage, verdict: verifyStageReportAdoption(mutant).ok }).toEqual({
        stage,
        verdict: false,
      });
      mutated += 1;
    }
    expect(mutated).toBe(ADOPTING_STAGES.length);
  });

  test("a stage whose text says NOTHING is refused, not skipped — the twelfth-stage leg", () => {
    // `deriveReportInstruction` is the only thing that decides coverage, so a
    // stage added to `ADOPTING_STAGES` tomorrow is graded with no edit here. An
    // empty or silent SKILL.md must land in `unanalysable` rather than yielding
    // a clean zero-group pass, which is the exact vacuity this file shipped.
    const silent = deriveReportInstruction("a-twelfth-stage", "");
    expect(silent.groups).toEqual([]);
    expect(silent.unanalysable.length).toBe(1);
    expect(silent.unanalysable[0]!.why).toContain("bounds");

    // …and a stage that narrates about its closing summary while bounding
    // nothing is refused for the same reason.
    const narrating = deriveReportInstruction(
      "a-twelfth-stage",
      "**Closing summary — the status block.** It closes with exactly one\n" +
        "`stage-status-block` fence, with at most 12 lines of prose lead-in.\n",
    );
    expect(narrating.unanalysable.length).toBe(1);
  });

  test("LEDGER — a stage's derived row budget cannot change without being seen", () => {
    // A DROPPED SUBJECT READS AS A PASS, and this file has now been fooled by
    // that twice: `/implement`'s bound lived inside its row template, so the
    // mutated template stopped matching and vanished rather than being refused;
    // `/report-issue`'s "**three files maximum**" could be deleted outright and
    // the stage stayed green on its remaining group. Both are invisible to any
    // leg that only grades what the derivation FOUND.
    //
    // So the derivation's OUTPUT is pinned. This is not the literal table
    // coming back: nothing here can be satisfied by typing a plan into this
    // file — every entry is only reachable by the SKILL.md still saying what it
    // says. A group that disappears reddens, and a maintainer who meant it
    // updates one line with the change in front of them.
    const ledger: Readonly<Record<AdoptingStage, string>> = {
      "best-practices": "bounded:3",
      brainstorm: "fixed:3",
      deps: "bounded:3",
      "gate-check": "aggregated | aggregated | bounded:3",
      implement: "bounded:3 | bounded:3 (+8 mandates)",
      "report-issue": "aggregated | fixed:3",
      setup: "bounded:3",
      "spec-archive": "bounded:3",
      "spec-review": "bounded:3",
      "spec-write": "bounded:6",
      upgrade: "bounded:3",
    };
    for (const stage of ADOPTING_STAGES) {
      const derived = derivedFor(stage);
      const shape = derived.groups
        .map((g) =>
          g.disposition.kind === "aggregated"
            ? "aggregated"
            : `${g.disposition.kind}:${g.disposition.n}`,
        )
        .join(" | ");
      const mandates =
        derived.mandateCount === null ? "" : ` (+${derived.mandateCount} mandates)`;
      expect({ stage, shape: `${shape}${mandates}` }).toEqual({
        stage,
        shape: ledger[stage],
      });
    }
  });

  test("COVERAGE — how many of the eleven could be derived, stated as a number", () => {
    // The count is asserted, not narrated, so "ten of eleven" cannot quietly
    // become "one of eleven" while the suite stays green.
    const analysable = ADOPTING_STAGES.filter(
      (s) => derivedFor(s).unanalysable.length === 0,
    );
    expect(analysable.length).toBe(11);
    expect(analysable.length).toBe(ADOPTING_STAGES.length);
    // Every stage's budget comes from one of the three dispositions the
    // derivation admits, and from nothing else.
    for (const stage of ADOPTING_STAGES) {
      for (const group of derivedFor(stage).groups) {
        expect(["bounded", "aggregated", "fixed"]).toContain(
          group.disposition.kind,
        );
        expect(group.quote.length).toBeGreaterThan(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // The literal table, DEMOTED to a cross-check
  // -------------------------------------------------------------------------

  test("CROSS-CHECK — every bound the literal plans claim is one the SKILL.md STATES", () => {
    // The table below decides no verdict any more. It is held against the
    // derivation: a `first N of M` the plans render must be a bound the stage's
    // own text declares. A disagreement is a finding, named on both sides.
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const plan = PLANS[stage];
      if (plan === undefined) continue;
      const stated = derivedFor(stage)
        .groups.flatMap((g) => (g.disposition.kind === "bounded" ? [g.disposition.n] : []));
      const claimed = [
        ...buildReport(stage, plan).matchAll(/first (\d+) of (\d+)/g),
      ].map((m) => Number(m[1]));
      for (const n of claimed) {
        expect({ stage, claimedBound: n, statedInSkill: stated }).toEqual({
          stage,
          claimedBound: n,
          statedInSkill: expect.arrayContaining([n]),
        });
      }
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
  });

  test("the plans are REAL — each cites a section that exists in that stage's SKILL.md", () => {
    // Falsifiability: a plan citing a section nobody wrote is a plan about
    // nothing. Every `cite` names a real file, and the driving content of every
    // planned stage is non-empty.
    let checked = 0;
    for (const stage of ADOPTING_STAGES) {
      const plan = PLANS[stage];
      if (plan === undefined) continue;
      const file = plan.cite.split(" ")[0]!;
      expect({ stage, file, readable: read(join(PLUGIN_ROOT, file)).length > 0 })
        .toEqual({ stage, file, readable: true });
      expect(plan.driving.length).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBe(ADOPTING_STAGES.length);
  });
});

// ---------------------------------------------------------------------------
// THE MODEL FIXTURE carries what step 14 MANDATES
// ---------------------------------------------------------------------------
//
// The fixture labelled "a compliant /implement capture" carried four lines of
// prose and one summary row for three rounds. It graded clean because the
// grader measures the BUDGET, never whether the report says what step 14 orders
// — so the adoption contract looked satisfiable while being modelled by a
// report that skipped its own mandates. These legs make that unbuildable again.

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "stage-block-adoption");
const CAPTURED_CLEAN = join(FIXTURE_DIR, "stage-report.txt");
const CAPTURED_NARRATED = join(FIXTURE_DIR, "stage-report-narrated.txt");

/**
 * Step 14's mandates, each with the phrase the SKILL.md uses for it and a
 * matcher for the row that satisfies it.
 *
 * The `orders` phrase is asserted to still be IN the SKILL.md, so a reworded or
 * deleted mandate reddens this list instead of leaving it pinned to a mandate
 * nobody makes any more.
 */
const STEP_14_MANDATES: readonly {
  readonly name: string;
  readonly orders: string;
  readonly row: RegExp;
}[] = [
  {
    name: "AC checklist with pass/fail status",
    orders: "AC checklist with pass/fail status",
    row: /acceptance criteria:.*\bpass\b/i,
  },
  {
    name: "files created/modified",
    orders: "files created/modified",
    row: /files created\/modified:\s*\d+/i,
  },
  {
    name: "test coverage",
    orders: "test coverage",
    row: /test coverage:/i,
  },
  {
    name: "self-review findings",
    orders: "self-review findings",
    row: /self-review findings:/i,
  },
  {
    name: "spec changes",
    orders: "spec changes",
    row: /spec changes:/i,
  },
  {
    name: "drift findings",
    orders: "drift findings",
    row: /drift findings:/i,
  },
  {
    name: "gate check result citing actual output",
    orders: "gate check result citing actual output",
    row: /^\s*-\s*pass \d+, fail \d+/m,
  },
  {
    name: "number of review rounds used",
    orders: "number of review rounds used",
    row: /review rounds used:\s*\d+/i,
  },
];

/** The fence body of a report — what "inside the block" means. */
function fenceBody(report: string): string[] {
  const lines = report.split("\n");
  const open = lines.findIndex((l) => l.trim() === STAGE_BLOCK_FENCE_BANNER);
  const close = lines.findIndex((l, i) => i > open && /^[ \t]*```[ \t]*$/.test(l));
  return lines.slice(open + 1, close);
}

describe("THE MODEL FIXTURE says what step 14 orders it to say", () => {
  test("step 14 still ORDERS each mandate this fixture is checked against", () => {
    // The mandate list is not a private opinion: every entry names a phrase the
    // shipped SKILL.md still uses. A deleted mandate reddens here first.
    const step14 = read(skillPath("implement"));
    for (const mandate of STEP_14_MANDATES) {
      expect({ mandate: mandate.name, ordered: step14.includes(mandate.orders) }).toEqual({
        mandate: mandate.name,
        ordered: true,
      });
    }
    expect(STEP_14_MANDATES.length).toBe(8);
  });

  test("the CLEAN fixture carries every step-14 mandate INSIDE the fence", () => {
    const body = fenceBody(read(CAPTURED_CLEAN)).join("\n");
    for (const mandate of STEP_14_MANDATES) {
      expect({ mandate: mandate.name, carried: mandate.row.test(body) }).toEqual({
        mandate: mandate.name,
        carried: true,
      });
    }
  });

  test("the per-item lists are BOUNDED and STATE THEIR TOTAL — never silently truncated", () => {
    // "first N of M" with M stated and M > N: the operator keeps the magnitude
    // and knows a tail exists. A list that just stops is the lossy shape
    // `renderAdvisoryNotes` was written to refuse.
    const body = fenceBody(read(CAPTURED_CLEAN)).join("\n");
    const bounds = [...body.matchAll(/first (\d+) of (\d+)/g)];
    expect(bounds.length).toBeGreaterThanOrEqual(2);
    for (const [, first, total] of bounds) {
      expect(Number(first)).toBeGreaterThan(0);
      expect(Number(total)).toBeGreaterThan(Number(first));
    }
    // …and each bounded list actually LISTS the N it promises.
    expect(body).toContain("first 3 of 41");
    expect(body).toContain("first 3 of 22");
  });

  test("the fixture is REALISTIC, not a stub: it fills the budgets it is graded against", () => {
    const body = read(CAPTURED_CLEAN);
    const fence = fenceBody(body);
    // A four-line stub is what shipped. A model report at realistic size uses
    // most of the fence it is allowed and stays under the report cap.
    expect(fence.length).toBeGreaterThan(20);
    expect(fence.length).toBeLessThanOrEqual(ADOPTED_FENCE_LINE_CAP);
    expect(verifyStageReportAdoption(body)).toEqual({ ok: true, reasons: [] });
    // It rides inside the ceiling the carve-out funds, and it is over the bare
    // whole-report cap — which is the measurement that makes the carve-out
    // load-bearing rather than decorative.
    expect(body.split("\n").length).toBeLessThanOrEqual(
      maxAdoptedReportLines("implement"),
    );
    expect(body.split("\n").length).toBeGreaterThan(STAGE_REPORT_LINE_CAP);
  });

  test("the NARRATED twin still differs ONLY by narration, and is refused for the PROSE rule", () => {
    const clean = read(CAPTURED_CLEAN);
    const narrated = read(CAPTURED_NARRATED);
    expect(fenceBody(narrated)).toEqual(fenceBody(clean));
    const verdict = verifyStageReportAdoption(narrated);
    expect(verdict.ok).toBe(false);
    expect(
      verdict.reasons.some((r) => /prose|lead-in|narration/i.test(r)),
    ).toBe(true);
  });
});
