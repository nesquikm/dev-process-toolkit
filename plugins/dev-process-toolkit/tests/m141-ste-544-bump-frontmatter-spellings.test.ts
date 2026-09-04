// M141 STE-544 — `inferBump` must read BOTH frontmatter spellings.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-09-03, v2.75.1).
//
//   * `adapters/_shared/src/version_bump.ts:81` reads `fr.changelogCategory`.
//     The FR frontmatter writer emits `changelog_category` (snake), and the
//     reader preserves what is on disk. An FR handed to `inferBump` exactly as
//     read therefore falls through the `?? "Added"` default: a milestone of
//     three pure fixes at 2.75.1 returns `2.76.0` with a "minor bump: milestone
//     shipped 3 additive FRs" rationale, and NOTHING throws.
//   * The same function's breaking rationale (`:74`) reads `fr.trackerId`, a
//     flat camel key the frontmatter also does not carry — it nests the id
//     under a `tracker:` block. As read, the rationale degrades to the FR title.
//   * `FrSummary` (`:14`) declares only the camel shapes, and the header
//     comment (`:9`) states the rule in terms of `changelogCategory`, which is
//     the single-shape contract this FR retires.
//   * `specs/plan/M139.md` carries a live hand-check workaround naming the bug.
//
// TEST STRATEGY — why no leg here can pass vacuously.
//
//   * AC.1 IS A DIFFERENTIAL, NOT AN ASSERTION ABOUT ONE ARM. The same three
//     Fixed FRs are built twice — once snake, once camel — and the two
//     `{version, rationale}` results are compared for byte equality. A reader
//     that ignores BOTH keys satisfies equality trivially, so the as-read arm
//     additionally pins the POSITIVE answer (`2.75.2` / patch) and pins the
//     PRE-FIX answer (`2.76.0` / minor) as explicitly NOT returned.
//   * AC.2 SEPARATES THE THREE BRANCHES. Camel-preferred is only observable
//     when the two keys DISAGREE, so the precedence leg supplies both with
//     different values. The default leg supplies neither. A reader that always
//     returns the snake key fails the precedence leg; one that always returns
//     the default fails the fallback leg.
//   * AC.3 CARRIES THE CONTROL THE FR ASKS FOR. The unfixed expression
//     (`fr.trackerId ?? fr.title`) is recomputed inside the test over the same
//     fixture, shown to equal the TITLE, and the shipped rationale is asserted
//     to differ from it. The leg therefore fails on a rationale that still
//     degrades, not merely on one that "mentions something".
//   * AC.5 IS AN UNTOUCHED-BYTES LEG. The 15 shipped test titles and the five
//     camelCase fixture declarations of `version_bump.test.ts` are pinned
//     VERBATIM. Rewriting an existing expectation to accommodate the new reader
//     is exactly the regression this AC excludes, so the pin is on the prior
//     text, not on a count (the file is free to GAIN legs).
//   * AC.6 AVOIDS THE PROXIMITY TRAP. Both prose surfaces ALREADY mention
//     `changelog_category` near `inferBump` (SKILL.md:112, reference:81), so a
//     window-based pin would read green today without the mapping clause ever
//     being written. The pin is therefore a SINGLE LINE carrying `inferBump`
//     and `changelog_category` and `frontmatter` together — a conjunction no
//     shipped line satisfies at authoring time.
//
// HARD BUDGET, measured at authoring time:
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. AC.6's skill
//     clause must cite the field by name and add no ticket id. The ceiling leg
//     below counts the way `tests/m129-ste-498-resume-classifier.test.ts` and
//     `tests/m126-ste-481-single-active-plan.test.ts` count, and asserts `<=`.
//   * This file lives under `tests/`, which carries neither budget.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import * as VB from "../adapters/_shared/src/version_bump";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");

const MODULE_PATH = join(PLUGIN_ROOT, "adapters", "_shared", "src", "version_bump.ts");
const SHIPPED_TEST_PATH = join(PLUGIN_ROOT, "adapters", "_shared", "src", "version_bump.test.ts");
const SHIP_SKILL = join(SKILLS_DIR, "ship-milestone", "SKILL.md");
const SHIP_REFERENCE = join(PLUGIN_ROOT, "docs", "ship-milestone-reference.md");

const read = (p: string): string => readFileSync(p, "utf-8");

/** Plans move to `specs/plan/archive/` at milestone close — resolve both. */
function planPath(milestone: string): string {
  const active = join(REPO_ROOT, "specs", "plan", `${milestone}.md`);
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "plan", "archive", `${milestone}.md`);
  if (existsSync(archived)) return archived;
  throw new Error(`plan ${milestone}.md found in neither specs/plan/ nor specs/plan/archive/`);
}

// ===========================================================================
// The module under test — read through the namespace so a MISSING export is a
// per-test failure with a readable message, not a link error that takes the
// whole file down before a single leg reports.
// ===========================================================================

const NS = VB as unknown as Record<string, unknown>;

type LooseFr = {
  title: string;
  breaking?: boolean;
  trackerId?: string;
  tracker?: Record<string, string>;
  changelogCategory?: string;
  changelog_category?: string;
};

type BumpArgs = { currentVersion: string; frs: LooseFr[]; override?: string };

const bump = (ctx: BumpArgs): VB.BumpResult =>
  VB.inferBump(ctx as unknown as Parameters<typeof VB.inferBump>[0]);

const categoryOf = (): ((fr: LooseFr) => string) => {
  const fn = NS.categoryOf;
  expect(typeof fn, "version_bump.ts must export a `categoryOf` reader").toBe("function");
  return fn as (fr: LooseFr) => string;
};

const trackerRefOf = (): ((fr: LooseFr) => string | undefined) => {
  const fn = NS.trackerRefOf;
  expect(typeof fn, "version_bump.ts must export a `trackerRefOf` reader").toBe("function");
  return fn as (fr: LooseFr) => string | undefined;
};

// ===========================================================================
// Fixtures — the SAME three fix-class FRs, in the two spellings.
// ===========================================================================

const PURE_FIX_SNAKE: LooseFr[] = [
  { title: "read both spellings", tracker: { linear: "STE-544" }, changelog_category: "Fixed" },
  { title: "second fix", tracker: { linear: "STE-545" }, changelog_category: "Fixed" },
  { title: "third fix", tracker: { linear: "STE-546" }, changelog_category: "Removed" },
];

const PURE_FIX_CAMEL: LooseFr[] = [
  { title: "read both spellings", trackerId: "STE-544", changelogCategory: "Fixed" },
  { title: "second fix", trackerId: "STE-545", changelogCategory: "Fixed" },
  { title: "third fix", trackerId: "STE-546", changelogCategory: "Removed" },
];

const CURRENT = "2.75.1";
const FIXED_ANSWER = "2.75.2";
/** What the unfixed reader returns for `PURE_FIX_SNAKE` — the pre-fix answer. */
const PREFIX_ANSWER = "2.76.0";

// ===========================================================================
// AC-STE-544.1 — same version AND same rationale from either spelling.
// ===========================================================================

describe("AC-STE-544.1 — the two spellings agree", () => {
  test("a pure-fix milestone at 2.75.1 patches on BOTH spellings", () => {
    const asRead = bump({ currentVersion: CURRENT, frs: PURE_FIX_SNAKE });
    const handMapped = bump({ currentVersion: CURRENT, frs: PURE_FIX_CAMEL });

    expect(asRead.version).toBe(FIXED_ANSWER);
    expect(handMapped.version).toBe(FIXED_ANSWER);
    expect(asRead.rationale).toMatch(/patch bump/i);
    expect(handMapped.rationale).toMatch(/patch bump/i);
  });

  test("version AND rationale are byte-equal between the arms", () => {
    const asRead = bump({ currentVersion: CURRENT, frs: PURE_FIX_SNAKE });
    const handMapped = bump({ currentVersion: CURRENT, frs: PURE_FIX_CAMEL });
    expect(asRead).toEqual(handMapped);
  });

  test("the as-read arm is NOT the pre-fix answer (2.76.0 + additive rationale)", () => {
    // Falsifiability: equality alone is satisfied by a reader that ignores BOTH
    // keys and defaults everything to `Added`. This leg kills that reader.
    const asRead = bump({ currentVersion: CURRENT, frs: PURE_FIX_SNAKE });
    expect(asRead.version).not.toBe(PREFIX_ANSWER);
    expect(asRead.rationale).not.toMatch(/minor bump/i);
    expect(asRead.rationale).not.toMatch(/additive/i);
  });

  test("a snake-spelled ADDITIVE milestone still takes the minor bump", () => {
    // Isolation: the fix widens the reader, it does not force fix-class.
    const additive = bump({
      currentVersion: CURRENT,
      frs: [
        { title: "add it", tracker: { linear: "STE-900" }, changelog_category: "Added" },
        ...PURE_FIX_SNAKE.slice(1),
      ],
    });
    expect(additive.version).toBe(PREFIX_ANSWER);
    expect(additive.rationale).toMatch(/minor bump/i);
  });
});

// ===========================================================================
// AC-STE-544.2 — one exported category reader: camel → snake → default.
// ===========================================================================

describe("AC-STE-544.2 — categoryOf resolves in the specified order", () => {
  test("the camel key wins when the two spellings DISAGREE", () => {
    const fn = categoryOf();
    expect(fn({ title: "t", changelogCategory: "Changed", changelog_category: "Fixed" })).toBe("Changed");
  });

  test("the snake key is the fallback when the camel key is absent", () => {
    const fn = categoryOf();
    expect(fn({ title: "t", changelog_category: "Fixed" })).toBe("Fixed");
  });

  test("`Added` applies ONLY when neither key is present", () => {
    const fn = categoryOf();
    expect(fn({ title: "t" })).toBe("Added");
  });

  test("the default can no longer mask a present-but-unread value", () => {
    const fn = categoryOf();
    // The whole defect in one assertion: a value IS present, so the default
    // must not be what comes back.
    expect(fn({ title: "t", changelog_category: "Removed" })).not.toBe("Added");
  });

  test("inferBump's fix-class decision is routed through the same reader", () => {
    const fn = categoryOf();
    const src = read(MODULE_PATH);
    expect(src).toMatch(/export function categoryOf\b/);
    // The predicate must CALL the reader rather than re-reading a raw key.
    const from = src.indexOf("const allFixClass");
    const to = src.indexOf("if (allFixClass)");
    expect(from, "fix-class predicate not found in version_bump.ts").toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const predicate = src.slice(from, to);
    expect(predicate).toContain("categoryOf");
    expect(predicate).not.toContain("changelogCategory ??");
    expect(fn({ title: "t", changelog_category: "Fixed" })).toBe("Fixed");
  });
});

// ===========================================================================
// AC-STE-544.3 — one exported tracker reader; the rationale names the id.
// ===========================================================================

describe("AC-STE-544.3 — trackerRefOf and the breaking rationale", () => {
  const BREAKING_NESTED: LooseFr = {
    title: "break it via a nested tracker block",
    tracker: { linear: "STE-547" },
    breaking: true,
    changelog_category: "Changed",
  };

  test("the flat camel key is preferred", () => {
    const fn = trackerRefOf();
    expect(fn({ title: "t", trackerId: "STE-1", tracker: { linear: "STE-2" } })).toBe("STE-1");
  });

  test("the nested frontmatter block is accepted", () => {
    const fn = trackerRefOf();
    expect(fn({ title: "t", tracker: { linear: "STE-547" } })).toBe("STE-547");
  });

  test("neither shape present yields undefined, not a title", () => {
    const fn = trackerRefOf();
    expect(fn({ title: "some title" })).toBeUndefined();
  });

  test("the breaking rationale names the TRACKER ID for a nested-only FR", () => {
    const result = bump({ currentVersion: CURRENT, frs: [BREAKING_NESTED] });
    expect(result.version).toBe("3.0.0");
    expect(result.rationale).toMatch(/major bump/i);
    expect(result.rationale).toContain("STE-547");
  });

  test("CONTROL — the unfixed path degrades to the title, and the shipped one does not", () => {
    // Recompute the pre-fix expression over the same fixture. It must yield the
    // TITLE — that is the degradation this AC exists to remove — and the
    // shipped rationale must not carry it.
    const unfixed = BREAKING_NESTED.trackerId ?? BREAKING_NESTED.title;
    expect(unfixed).toBe("break it via a nested tracker block");

    const result = bump({ currentVersion: CURRENT, frs: [BREAKING_NESTED] });
    expect(result.rationale).not.toContain(unfixed);
  });

  test("a flat-camel breaking FR keeps its shipped rationale (no regression)", () => {
    const result = bump({
      currentVersion: CURRENT,
      frs: [{ title: "break it", trackerId: "STE-5", changelogCategory: "Changed", breaking: true }],
    });
    expect(result.version).toBe("3.0.0");
    expect(result.rationale).toContain("STE-5");
  });
});

// ===========================================================================
// AC-STE-544.4 — the declared shapes and the header comment.
// ===========================================================================

describe("AC-STE-544.4 — FrSummary declares both shapes; the header is corrected", () => {
  const frSummaryBlock = (): string => {
    const src = read(MODULE_PATH);
    const start = src.indexOf("export interface FrSummary");
    expect(start, "FrSummary interface not found in version_bump.ts").toBeGreaterThan(-1);
    const end = src.indexOf("}", start);
    return src.slice(start, end + 1);
  };

  test("both category spellings are declared on FrSummary", () => {
    const block = frSummaryBlock();
    expect(block).toContain("changelogCategory");
    expect(block).toContain("changelog_category");
  });

  test("both tracker shapes are declared on FrSummary", () => {
    const block = frSummaryBlock();
    expect(block).toContain("trackerId");
    expect(block).toMatch(/\btracker\?:/);
  });

  test("the header comment no longer states the single-shape contract", () => {
    const src = read(MODULE_PATH);
    const header = src.slice(0, src.indexOf("export interface FrSummary"));
    expect(header).toContain("changelog_category");
    expect(header).not.toMatch(/every FR's changelogCategory/);
  });

  test("the header is still the rules comment it always was (not gutted)", () => {
    const src = read(MODULE_PATH);
    const header = src.slice(0, src.indexOf("export interface FrSummary"));
    expect(header).toMatch(/major bump/);
    expect(header).toMatch(/patch bump/);
    expect(header).toMatch(/minor bump/);
  });
});

// ===========================================================================
// AC-STE-544.5 — the shipped suite's prior expectations are UNTOUCHED.
// ===========================================================================

describe("AC-STE-544.5 — version_bump.test.ts keeps every shipped assertion", () => {
  const SHIPPED_TEST_TITLES = [
    "minor bump when any FR is additive (Added)",
    "minor bump on mixed Added + Fixed",
    "minor bump counts the FRs in the rationale",
    "major bump when any FR has breaking: true",
    "major bump resets minor and patch",
    "patch bump when every FR is a Fixed category",
    "patch bump also accepts Removed-only milestones (fix-class housekeeping)",
    "single Added FR still forces minor (patch requires every FR be fix-class)",
    "--version X.Y.Z override wins over inferred bump",
    "override works even with a breaking FR",
    "malformed override throws InvalidOverrideError",
    "override without three segments throws",
    "empty FR list forces minor bump with a 'no FRs' rationale",
    "current version with extra segments (pre-release) is rejected",
    "current version missing a segment is rejected",
  ];

  const SHIPPED_FIXTURES = [
    `const ADDED_FR: FrSummary = { trackerId: "STE-1", title: "add it", changelogCategory: "Added" };`,
    `const FIXED_FR: FrSummary = { trackerId: "STE-2", title: "fix it", changelogCategory: "Fixed" };`,
    `const REMOVED_FR: FrSummary = { trackerId: "STE-3", title: "remove it", changelogCategory: "Removed" };`,
    `const CHANGED_FR: FrSummary = { trackerId: "STE-4", title: "change it", changelogCategory: "Changed" };`,
    `const BREAKING_FR: FrSummary = { trackerId: "STE-5", title: "break it", changelogCategory: "Changed", breaking: true };`,
  ];

  const SHIPPED_EXPECTATIONS = [
    `const result = inferBump({ currentVersion: "1.22.0", frs: [ADDED_FR] });`,
    `expect(result.version).toBe("1.23.0");`,
    `expect(result.version).toBe("2.0.0");`,
    `expect(result.rationale).toContain("STE-5");`,
    `expect(result.version).toBe("1.22.1");`,
    `expect(result.version).toBe("1.22.4");`,
    `expect(result.version).toBe("1.99.0");`,
  ];

  test("the pin list is non-empty and the file under pin is the right one", () => {
    expect(SHIPPED_TEST_TITLES.length).toBe(15);
    expect(read(SHIPPED_TEST_PATH)).toContain("inferBump");
  });

  test("all 15 shipped test titles survive verbatim", () => {
    const body = read(SHIPPED_TEST_PATH);
    for (const title of SHIPPED_TEST_TITLES) {
      expect(body, `shipped test title rewritten or removed: ${title}`).toContain(title);
    }
  });

  test("the five camelCase fixtures are unchanged — the widening is in the READER", () => {
    const body = read(SHIPPED_TEST_PATH);
    for (const fixture of SHIPPED_FIXTURES) {
      expect(body, `shipped fixture rewritten: ${fixture}`).toContain(fixture);
    }
  });

  test("the shipped expectation literals are unchanged", () => {
    const body = read(SHIPPED_TEST_PATH);
    for (const literal of SHIPPED_EXPECTATIONS) {
      expect(body, `shipped expectation rewritten: ${literal}`).toContain(literal);
    }
  });

  test("every camelCase caller still gets its shipped answer at runtime", () => {
    // The pins above are textual; this leg is behavioural, so a file that was
    // left alone but a reader that BROKE camel still reds here.
    expect(bump({ currentVersion: "1.22.0", frs: [{ trackerId: "STE-1", title: "add it", changelogCategory: "Added" }] }).version).toBe("1.23.0");
    expect(bump({ currentVersion: "1.22.0", frs: [{ trackerId: "STE-2", title: "fix it", changelogCategory: "Fixed" }] }).version).toBe("1.22.1");
    expect(bump({ currentVersion: "1.22.3", frs: [{ trackerId: "STE-3", title: "remove it", changelogCategory: "Removed" }] }).version).toBe("1.22.4");
  });
});

// ===========================================================================
// AC-STE-544.6 — both prose surfaces carry the mapping clause; ceiling holds.
// ===========================================================================

describe("AC-STE-544.6 — the mapping clause on both prose surfaces", () => {
  /**
   * A line naming `inferBump`, the `changelog_category` field, and the word
   * `frontmatter` together. Deliberately NOT a proximity window: both files
   * already mention `changelog_category` within a few lines of `inferBump`
   * (SKILL.md:112, reference:81), so a window pin reads green with the clause
   * never written.
   */
  const mappingLines = (path: string): string[] =>
    read(path)
      .split("\n")
      .filter(
        (line) =>
          line.includes("inferBump") &&
          line.includes("changelog_category") &&
          /frontmatter/i.test(line),
      );

  test("the clause names the value that is PASSED, not merely the field", () => {
    // Measured at authoring time: ZERO lines in either file satisfy even the
    // three-way conjunction, so the RED run is the proof of non-vacuity. This
    // leg adds the fourth conjunct the AC actually asks for — that the value
    // PASSED as the category is the frontmatter value.
    for (const path of [SHIP_SKILL, SHIP_REFERENCE]) {
      const clauses = mappingLines(path);
      expect(clauses.length, `no mapping clause in ${path}`).toBeGreaterThanOrEqual(1);
      expect(
        clauses.some((l) => /pass(?:ed|es)?|supplied|hand(?:ed|s)?\b/i.test(l)),
        `mapping clause in ${path} does not say the value is what gets passed`,
      ).toBe(true);
    }
  });

  test("skills/ship-milestone/SKILL.md states the mapping", () => {
    expect(mappingLines(SHIP_SKILL).length).toBeGreaterThanOrEqual(1);
  });

  test("docs/ship-milestone-reference.md states the mapping", () => {
    expect(mappingLines(SHIP_REFERENCE).length).toBeGreaterThanOrEqual(1);
  });

  test("the skills/ STE-token ceiling (246) is not breached", () => {
    // Counted exactly as tests/m129-ste-498-resume-classifier.test.ts counts.
    const SKILLS_STE_TOKEN_CEILING = 246;
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("the ship-milestone skill clause adds no STE-<N> token of its own", () => {
    const clause = mappingLines(SHIP_SKILL).join("\n");
    expect(clause).not.toMatch(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/);
  });

  test("skills/ship-milestone/SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(read(SHIP_SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// AC-STE-544.7 — the stale M139 hand-check workaround is gone.
// ===========================================================================

describe("AC-STE-544.7 — M139's workaround line is removed, the rest intact", () => {
  const plan = (): string => read(planPath("M139"));

  test("the workaround line is absent", () => {
    const body = plan();
    expect(body).not.toContain("changelogCategory");
    expect(body).not.toMatch(/checked by hand/i);
  });

  test("the follow-ups section itself survives, with its other bullet", () => {
    const body = plan();
    expect(body).toContain("### Follow-ups carried into M139");
    expect(body).toContain(`STE-417 AC.5's "Linear unchanged" regression pin is retired by this milestone.`);
  });

  test("the plan's other content is unchanged", () => {
    const body = plan();
    expect(body).toContain("## M139 — Tracker-First Linear Milestones {#M139}");
    // RETARGETED by M139/STE-541, and the reason is worth recording because
    // this pin could not have survived either way. M141 froze M139's release
    // target at the literal `v2.76.0` — and then M141 SHIPPED as v2.76.0
    // itself, taking the number out from under the plan it was pinning. So the
    // frozen literal became unsatisfiable the moment M141 released: M139 must
    // move, and this assertion had to move with it. The replacement is not
    // hand-picked either — `inferBump`, fed M139's three FRs exactly as
    // `parseFrontmatter` returns them, answers 2.77.0.
    //
    // What this leg is actually for survives intact: it proves the M139 plan
    // still HAS a release-target line in the canonical shape, so a plan that
    // lost it during the workaround removal would still red.
    expect(body).toContain("**Release target:** v2.77.0 (minor — all three FRs are Changed).");
    expect(body).toContain("### Dependency graph");
    expect(body).toContain("`cd plugins/dev-process-toolkit && bun test`");
    for (const fr of ["STE-539", "STE-540", "STE-541"]) {
      expect(body).toContain(fr);
    }
  });

  test("all 12 task bullets survive the deletion", () => {
    // COUNTS TOTAL TASKS, checked or not — retargeted by M139/STE-541, and the
    // original form was wrong rather than merely stale.
    //
    // This leg exists to prove the workaround-line deletion removed no TASK.
    // It measured that by filtering `- [ ] `, i.e. UNCHECKED bullets, which
    // silently made it assert something else entirely: that M139's tasks stay
    // unchecked forever. Ticking a task off is not removing it — but the
    // predicate could not tell those apart, so the leg was green only while
    // M139 was unimplemented and failed the moment it was implemented, which
    // is the one moment it was never meant to fire.
    //
    // The fix is NOT to leave the plan's tasks unticked to satisfy it: the
    // checkboxes are real state, `/implement` step 13 ticks them by contract,
    // and probe #14's carve-outs read them. So the predicate is corrected to
    // the claim it was always making — twelve tasks still EXIST.
    const bullets = plan()
      .split("\n")
      .filter((line) => line.startsWith("- [ ] ") || line.startsWith("- [x] "));
    expect(bullets.length).toBe(12);
  });
});
