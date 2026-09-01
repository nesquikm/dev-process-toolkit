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
// The answer, measured, is NO for nine of the eleven. Two of the nine cannot
// conform AT ANY SIZE, under any bound: their mandated prose floor is already
// over the 12-line lead-in cap before a single item of driving content is
// added. Seven more conform only below a threshold their realistic use is
// routinely over.
//
// So this file constructs, for every stage in `ADOPTING_STAGES`, the report
// that stage's SKILL.md instructs — at realistic size — and REQUIRES it to
// conform. It is RED until each stage's SKILL.md content is bounded. That red
// IS the deliverable: an adoption contract nine of its eleven adopters cannot
// satisfy is a contract enforced by nothing.
//
// WHY THE REPORTS ARE BUILT AS PROSE ABOVE THE FENCE. Because that is what the
// SKILL.md says. Eight of the eleven still order their report to "Present:" /
// "Summarize" / "report what happened, in this order" — free-form narration —
// and only `/spec-write`, `/report-issue`, `/best-practices` and `/deps` carry
// the sentence saying the rows now ride INSIDE the fence. A stage whose
// SKILL.md orders narration emits narration, whatever a doc elsewhere says the
// budget is; the report is built from the instruction, never from the budget it
// is being graded against, or the test would be measuring its own arithmetic.
//
// TWELFTH-STAGE COVERAGE. The suite iterates `ADOPTING_STAGES`, and a stage
// with no plan of its own is graded against `DEFAULT_PLAN` rather than skipped
// — a `for (const stage of ADOPTING_STAGES)` that silently covers ten of eleven
// is the shape this repository keeps recording. `every stage is graded` asserts
// the count.

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
// The eleven plans — each read off that stage's own SKILL.md
// ---------------------------------------------------------------------------

/**
 * A stage with no plan of its own. Deliberately MODEST — a twelfth stage is
 * graded rather than skipped, and a modest report that still fails says
 * something about the contract rather than about the plan.
 */
const DEFAULT_PLAN: StageReportPlan = {
  prose: [
    "The stage ran and closed. What it did is in the block below.",
    "Nothing was pushed from this stage.",
  ],
  summary: ["  - ran to completion, 0 refusals"],
  cite: "no per-stage plan — DEFAULT_PLAN",
  driving: "none (default plan)",
};

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

const planFor = (stage: AdoptingStage): StageReportPlan =>
  PLANS[stage] ?? DEFAULT_PLAN;

// ---------------------------------------------------------------------------
// THE MATRIX
// ---------------------------------------------------------------------------

describe("THE CONFORMANCE MATRIX — every adopting stage's own report must conform", () => {
  test("every stage in ADOPTING_STAGES is graded — none skipped, a twelfth included", () => {
    let graded = 0;
    for (const stage of ADOPTING_STAGES) {
      const report = buildReport(stage, planFor(stage));
      expect(report).toContain(STAGE_BLOCK_FENCE_BANNER);
      expect(report).toContain(`stage: ${stage}`);
      graded += 1;
    }
    expect(graded).toBe(ADOPTING_STAGES.length);
  });

  test("a stage with no plan of its own still gets graded, not skipped", () => {
    // The twelfth-stage leg. `planFor` falls back rather than returning
    // undefined, so a stage added to `ADOPTING_STAGES` tomorrow is covered by
    // this suite with no edit here — which is the whole reason the list is
    // driven off the const.
    const unplanned = "a-twelfth-stage" as AdoptingStage;
    expect(planFor(unplanned)).toBe(DEFAULT_PLAN);
    expect(buildReport(unplanned, planFor(unplanned))).toContain(
      "stage: a-twelfth-stage",
    );
  });

  for (const stage of ADOPTING_STAGES) {
    test(`${stage} — the report its SKILL.md instructs CONFORMS`, () => {
      const plan = planFor(stage);
      const report = buildReport(stage, plan);
      // The verdict is asserted with the plan's own citation attached, so a red
      // leg names the SKILL.md section a maintainer has to bound rather than
      // handing them a line count and a shrug.
      expect({
        stage,
        driving: plan.driving,
        cite: plan.cite,
        verdict: verifyStageReportAdoption(report),
      }).toEqual({
        stage,
        driving: plan.driving,
        cite: plan.cite,
        verdict: { ok: true, reasons: [] },
      });
    });
  }

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

  test("MUTATION — every plan's verdict is SIZE-SENSITIVE, so a green leg is a real one", () => {
    // A leg that passes no matter what it is handed certifies nothing. For each
    // stage, adding narration past the cap must flip the verdict: that proves
    // the grader is reading THIS report rather than agreeing by construction.
    let mutated = 0;
    for (const stage of ADOPTING_STAGES) {
      const plan = planFor(stage);
      const over: StageReportPlan = {
        ...plan,
        prose: [
          ...plan.prose,
          ...rows(PROSE_LEAD_IN_LINE_CAP + 1, (i) => `narration line ${i}.`),
        ],
      };
      const mutant = buildReport(stage, over);
      // THE MUTATION APPLIED.
      expect(mutant.split("\n").length).toBeGreaterThan(
        buildReport(stage, plan).split("\n").length,
      );
      expect(verifyStageReportAdoption(mutant).ok).toBe(false);
      mutated += 1;
    }
    expect(mutated).toBe(ADOPTING_STAGES.length);
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
