// M111 STE-412 — /setup step 8: no specs/frs/ scaffold over a live monolithic
// requirements.md.
//
// PROSE-ONLY FR (STE-49 grep-shape pattern): the deterministic enforcement is
// THIS meta-test; the runtime behavior is LLM-executed `/setup` prose. Every
// assertion anchors BY CONTENT (substring / same-line regex on the SKILL body),
// never by line number.
//
// AC map:
//   AC-STE-412.1 — step 8 guard: BEFORE seeding `specs/frs/{,archive/}`, run the
//                  read-only `monolithSplit.detect(projectRoot)` check; when it
//                  APPLIES, SKIP the `specs/frs/` mkdir + `.gitkeep` seeding
//                  entirely, while the `specs/plan/{,archive/}` scaffolding and
//                  the technical/testing template copies are UNAFFECTED.
//   AC-STE-412.2 — an explicit never-overwrite rule for `specs/requirements.md`
//                  is pinned in the step-8 prose.
//   AC-STE-412.3 — the guard prints a one-line explanation naming the detected
//                  monolithic layout and appends a `## /setup audit` row with
//                  value `frs-scaffold-skipped`; the follow-up MUST route via
//                  `/dev-process-toolkit:gate-check` (probe #69), NEVER the
//                  literal `/dev-process-toolkit:upgrade` (m109-ste-395 invariant).
//   AC-STE-412.4 — the STE-189 "Scaffold deliverables" inventory paragraph gains
//                  a carve-out sentence on artifact class (5): the `.gitkeep`
//                  stubs are emitted unconditionally EXCEPT when the monolith
//                  guard fires — every OTHER class keeps the unconditional posture.
//   AC-STE-412.5 — the guard keys on the live-section pattern (`### FR-<digits>:`),
//                  so the requirements template's own `### FR-N: [Feature Name]`
//                  placeholder (N a literal, not digits) does NOT trip it; a
//                  fresh / non-monolithic scaffold is unchanged.
//
// NOTE FOR THE IMPLEMENTER: the same-line regex checks below expect each guard
// clause to live on a single physical line (a flowing prose paragraph — repo
// convention — or one bullet per clause). Splitting a single clause across hard
// newlines can trip a same-line check even after a correct edit.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const setupSkillPath = join(PLUGIN_ROOT, "skills", "setup", "SKILL.md");

const read = (path: string): string => readFileSync(path, "utf-8");

/**
 * The step-8 region: from the `### 8. Create specs (optional)` heading through
 * (but not including) the next `### ` heading (`### 8a.`). Scopes the guard /
 * never-overwrite / explanation assertions so pre-existing prose elsewhere in
 * the SKILL (e.g. step 6c's `gate-check` hint, step 8a's `## /setup audit`
 * writes) cannot false-GREEN them.
 */
function stepEight(body: string): string {
  const HEADING = "### 8. Create specs (optional)";
  const start = body.indexOf(HEADING);
  expect(start).toBeGreaterThan(-1);
  const remainder = body.slice(start + HEADING.length);
  const endRel = remainder.search(/\n### /);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + HEADING.length + endRel);
}

/** The blank-line-delimited paragraph containing `needle`. */
function paragraphWith(body: string, needle: string): string {
  const hits = body.split(/\n\s*\n/).filter((p) => p.includes(needle));
  if (hits.length === 0) throw new Error(`no paragraph contains ${JSON.stringify(needle)}`);
  return hits[0]!;
}

/** The STE-189 canonical-inventory paragraph inside step 8. */
function inventoryPara(body: string): string {
  return paragraphWith(stepEight(body), "Scaffold deliverables (canonical inventory, STE-189)");
}

/** True iff some single physical line of `text` satisfies every predicate. */
function anyLine(text: string, ...res: RegExp[]): boolean {
  return text.split("\n").some((line) => res.every((re) => re.test(line)));
}

// ---------------------------------------------------------------------------
// AC-STE-412.1 — the step-8 guard clause
// ---------------------------------------------------------------------------

describe("AC-STE-412.1 — guard names monolithSplit.detect and skips only specs/frs/", () => {
  test("step 8 names the read-only detector `monolithSplit.detect`", () => {
    expect(stepEight(read(setupSkillPath))).toContain("monolithSplit.detect");
  });

  test("step 8 states the guard SKIPS the `specs/frs/` scaffold", () => {
    // Same-line: no pre-existing step-8 line pairs "skip" with `specs/frs/`
    // (line 261 creates it without "skip"; "skip this step" carries no path).
    expect(anyLine(stepEight(read(setupSkillPath)), /\bskip/i, /specs\/frs\//)).toBe(true);
  });

  test("the skip explicitly covers the `specs/frs/` archive too", () => {
    expect(anyLine(stepEight(read(setupSkillPath)), /\bskip/i, /specs\/frs\//, /archive/)).toBe(
      true,
    );
  });

  test("step 8 says plan scaffolding + technical/testing copies are UNAFFECTED", () => {
    expect(
      anyLine(
        stepEight(read(setupSkillPath)),
        /plan/i,
        /(technical|testing)/i,
        /(unaffected|unchanged|untouched|not affected)/i,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-412.2 — never-overwrite rule for specs/requirements.md
// ---------------------------------------------------------------------------

describe("AC-STE-412.2 — existing specs/requirements.md is never overwritten", () => {
  test("step 8 pins an explicit never-overwrite rule for `specs/requirements.md`", () => {
    expect(
      anyLine(
        stepEight(read(setupSkillPath)),
        /requirements\.md/,
        /overwrit/i,
        /\b(never|not|no)\b/i,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-412.3 — explanation + audit row + gate-check follow-up (NOT /upgrade)
// ---------------------------------------------------------------------------

describe("AC-STE-412.3 — one-line explanation + `## /setup audit` frs-scaffold-skipped row", () => {
  test("step 8 references the `## /setup audit` row", () => {
    expect(stepEight(read(setupSkillPath))).toContain("## /setup audit");
  });

  test("step 8 records the skip with value `frs-scaffold-skipped`", () => {
    expect(stepEight(read(setupSkillPath))).toContain("frs-scaffold-skipped");
  });

  test("step 8 prints a one-line explanation naming the monolithic layout", () => {
    const region = stepEight(read(setupSkillPath));
    expect(region.toLowerCase()).toContain("one-line explanation");
    expect(region).toMatch(/monolith/i);
  });

  test("CRITICAL: the follow-up routes via `gate-check` / probe #69, not literal /upgrade", () => {
    expect(stepEight(read(setupSkillPath))).toMatch(/gate-check|probe #69/i);
  });

  test("tripwire: the whole setup SKILL never introduces the `/dev-process-toolkit:upgrade` literal", () => {
    // Passes today (setup SKILL has none) — it guards the implementer against
    // reviving the retired literal (m109-ste-395 de-listing invariant).
    expect(read(setupSkillPath)).not.toContain("/dev-process-toolkit:upgrade");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-412.4 — STE-189 inventory paragraph carve-out on artifact class (5)
// ---------------------------------------------------------------------------

describe("AC-STE-412.4 — the Scaffold-deliverables inventory gains the class-(5) carve-out", () => {
  test("the inventory paragraph names the monolith/legacy exception", () => {
    expect(inventoryPara(read(setupSkillPath))).toMatch(/(monolith|legacy)/i);
  });

  test("the carve-out frames it as an exception/guard-fires skip, not a new default", () => {
    expect(inventoryPara(read(setupSkillPath))).toMatch(/(except|carve|guard|skip)/i);
  });

  test("the carve-out is about the `.gitkeep` stubs (class 5) — still named", () => {
    expect(inventoryPara(read(setupSkillPath))).toContain(".gitkeep");
  });

  test("every OTHER class keeps the `emitted unconditionally` posture", () => {
    expect(inventoryPara(read(setupSkillPath))).toContain("emitted unconditionally");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-412.5 — non-monolithic trees scaffold byte-identically
// ---------------------------------------------------------------------------

describe("AC-STE-412.5 — the guard keys on `FR-<digits>`, not the `FR-N` template placeholder", () => {
  test("step 8 names the live-section pattern `FR-<digits>`", () => {
    expect(stepEight(read(setupSkillPath))).toContain("FR-<digits>");
  });

  test("step 8 distinguishes the template's own `FR-N` placeholder heading", () => {
    // `FR-N` (literal N) must be called out as NOT matching `FR-<digits>`.
    expect(stepEight(read(setupSkillPath))).toContain("FR-N");
  });

  test("step 8 states a fresh / non-monolithic scaffold is unchanged (never trips the guard)", () => {
    expect(
      anyLine(
        stepEight(read(setupSkillPath)),
        /(fresh|non-monolithic)/i,
        /(unaffected|unchanged|untouched|byte-identical|trip)/i,
      ),
    ).toBe(true);
  });
});
