// M_a8e09a / STE-574 — the dogfood grades only the subject its milestone owns.
//
// THE WINDOW, stated once so every fixture below can be read against it:
//
//   /implement archives the plan.   → specs/plan/archive/M<N>.md, unstamped
//   ... some number of commits ...  → every `bun test` run in here is graded
//   /ship-milestone writes the      → shipped_in: vX.Y.Z + the CHANGELOG entry
//   release commit.
//
// Inside that window an archived plan carries no `shipped_in` stamp and no
// `ship_state: parked`. `runPlanShipCoherenceProbe` reports it — correctly —
// as unshipped debt. A live-tree dogfood that grades the WHOLE report flat
// therefore reds the suite for the whole window, and /ship-milestone's
// pre-flight refuses on a non-zero failure count, so the ship cannot clear the
// gate it must clear in order to make the gate green. That is a deadlock, and
// it is the only thing this FR removes.
//
// WHAT MOVES AND WHAT DOES NOT:
//
//   moves      the instant at which a `bun test` run passes judgement on
//              unshipped debt — the two live-tree dogfoods now grade through
//              `gradedViolations` (tests/_plan_ship_grading.ts).
//   does NOT   detection. The probe still emits the row; /gate-check probe #63
//              still grades it at severity error; /ship-milestone's bare
//              no-arg form still scans `specs/plan/archive/` for exactly this
//              predicate. AC.4 and AC.7 are the tests that say so.
//
// This is a reduction in automatic pressure, and the suite records it as one
// rather than dressing it up: after this lands, both surviving detectors are
// operator-invoked.
//
// EVERY fixture is a `mkdtempSync` temp root reconstructing the window, never
// the live tree — whose state changes underneath the suite as the milestone
// ships. The single live-tree arm is the dogfood in
// `tests/m141-ste-546-surface-agreement.test.ts`, graded there.
//
// Filter by AC with `bun test -t "AC-STE-574.N"`.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SHIP_CEREMONY_RECIPE,
  runPlanShipCoherenceProbe,
  type PlanShipCoherenceReport,
  type PlanShipCoherenceViolation,
} from "../adapters/_shared/src/plan_ship_coherence";
import { TRANSIENT_KIND, gradedViolations } from "./_plan_ship_grading";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const PROBE_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "plan_ship_coherence.ts");
const M141_SUITE = join(PLUGIN_ROOT, "tests", "m141-ste-546-surface-agreement.test.ts");
const SIBLING_SUITE = join(PLUGIN_ROOT, "tests", "gate-check-plan-ship-coherence.test.ts");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");

const read = (path: string): string => readFileSync(path, "utf-8").replace(/\r\n/g, "\n");

/** The closed union AC.1 fixes. Sorted, so set comparison is order-free. */
const KINDS = ["corrupt_stamp", "surface_disagreement", "unshipped_debt"] as const;

// ---------------------------------------------------------------------------
// Fixture vocabulary — every root is BUILT from named parts, so two roots that
// differ by one condition differ by one argument in the source too.
// ---------------------------------------------------------------------------

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * An archived plan. `shippedIn: null` writes the template's pre-ship sentinel
 * `shipped_in: null` — the literal shape a plan carries inside the window,
 * NOT an absent key, because the sentinel is what /implement's archival
 * actually leaves behind.
 */
const planText = (milestone: string, shippedIn: string | null): string =>
  [
    "---",
    `milestone: ${milestone}`,
    "status: archived",
    "archived_at: 2026-09-07T00:00:00Z",
    `shipped_in: ${shippedIn ?? "null"}`,
    "---",
    "",
    `# ${milestone}: fixture milestone`,
    "",
  ].join("\n");

/** Newest heading v2.80.5 "Herald" — the release the window is waiting on. */
const CHANGELOG = [
  "# Changelog",
  "",
  '## [2.80.5] — 2026-09-07 — "Herald"',
  "",
  "- something",
  "",
  '## [2.80.4] — 2026-09-06 — "Verity"',
  "",
  "- something",
  "",
].join("\n");

const readmeWith = (codename: string, milestone: string): string =>
  [
    "# Fixture",
    "",
    "## Release Notes",
    "",
    `See CHANGELOG.md. Latest: **v2.80.5 — "${codename}"** (${milestone}, a sentence.)`,
    "",
  ].join("\n");

/** The banner that AGREES with the newest CHANGELOG entry and its plan. */
const AGREEING_README = readmeWith("Herald", "M_prior");
/** The banner left naming the PREVIOUS release's codename. */
const STALE_README = readmeWith("Verity", "M_prior");

interface RootSpec {
  readonly readme: string;
  /** `specs/plan/archive/<M>.md` → its `shipped_in` value (`null` = sentinel). */
  readonly archivePlans: Record<string, string | null>;
}

function makeRoot(spec: RootSpec): string {
  const root = mkdtempSync(join(tmpdir(), "ste-574-"));
  dirs.push(root);
  const archive = join(root, "specs", "plan", "archive");
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(root, "CHANGELOG.md"), CHANGELOG);
  writeFileSync(join(root, "README.md"), spec.readme);
  for (const [milestone, shippedIn] of Object.entries(spec.archivePlans)) {
    writeFileSync(join(archive, `${milestone}.md`), planText(milestone, shippedIn));
  }
  return root;
}

/**
 * THE WINDOW: one shipped plan, one archived-not-yet-shipped plan, surfaces in
 * agreement. Exactly one violation, and it is the transient one.
 */
const windowRoot = (): string =>
  makeRoot({ readme: AGREEING_README, archivePlans: { M_prior: "v2.80.5", M_debt: null } });

/** The window plus a stamp naming a release CHANGELOG.md does not carry. */
const corruptRoot = (): string =>
  makeRoot({
    readme: AGREEING_README,
    archivePlans: { M_prior: "v2.80.5", M_debt: null, M_bad: "v9.9.9" },
  });

/** The window plus a banner carrying the previous release's codename. */
const surfaceRoot = (): string =>
  makeRoot({ readme: STALE_README, archivePlans: { M_prior: "v2.80.5", M_debt: null } });

/**
 * All three kinds at once, and all FOUR of the probe's violation push sites:
 *
 *   M_debt  unstamped + unparked   → unshipped_debt
 *   M_mal   malformed stamp        → corrupt_stamp
 *   M_bad   stamp with no heading  → corrupt_stamp
 *   README  stale codename         → surface_disagreement   (the raw literal)
 *
 * `M_mal` carries `2.80.5` — a real version missing its `v`. It is malformed
 * as a stamp AND resolvable as a release, which is why the README's milestone
 * field still agrees and the only surface row is the codename one.
 */
const allKindsRoot = (): string =>
  makeRoot({
    readme: STALE_README,
    archivePlans: { M_prior: "v2.80.5", M_bad: "v9.9.9", M_mal: "2.80.5", M_debt: null },
  });

const kindsOf = (rows: readonly PlanShipCoherenceViolation[]): string[] =>
  [...new Set(rows.map((v) => v.kind))].sort();

const describeRows = (rows: readonly PlanShipCoherenceViolation[]): string =>
  rows.map((r) => `  - [${String(r.kind)}] ${r.reason}`).join("\n") || "  (none)";

const rowFor = (report: PlanShipCoherenceReport, needle: string): PlanShipCoherenceViolation => {
  const hit = report.violations.filter((v) => v.file.endsWith(needle));
  expect(hit.length, `expected exactly one row for ${needle}\n${describeRows(report.violations)}`).toBe(1);
  return hit[0]!;
};

// ===========================================================================
// AC-STE-574.1 — a closed `kind`, set at all FOUR push sites
// ===========================================================================

describe("AC-STE-574.1 — the violation record carries a closed kind", () => {
  test("the union declared in the module is EXACTLY the three kinds", () => {
    const src = read(PROBE_MODULE);
    // Whichever declaration carries `"unshipped_debt"` — a named type alias or
    // the field's inline union — is the union. Anchored on the literal rather
    // than on a type NAME the AC never fixes.
    const decl = /(?:=|:)\s*((?:\s*\|?\s*"[a-z_]+")+)\s*;/g;
    const unions = [...src.matchAll(decl)]
      .map((m) => m[1]!)
      .filter((u) => u.includes(`"${TRANSIENT_KIND}"`));
    expect(
      unions.length,
      "no string-literal union in plan_ship_coherence.ts mentions " +
        `"${TRANSIENT_KIND}" — the kind field is untyped, or typed somewhere this scan cannot see`,
    ).toBe(1);
    const literals = [...unions[0]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).sort();
    expect(literals, `the union is not closed over exactly ${KINDS.join(" | ")}`).toEqual([
      ...KINDS,
    ]);
  });

  test("all four push sites set a kind — one fixture, four rows, three kinds", async () => {
    const report = await runPlanShipCoherenceProbe(allKindsRoot());
    // Non-vacuity first: four rows, or the mapping below grades an empty set.
    expect(report.violations.length, describeRows(report.violations)).toBe(4);
    expect(rowFor(report, "M_debt.md").kind).toBe("unshipped_debt");
    expect(rowFor(report, "M_mal.md").kind).toBe("corrupt_stamp");
    expect(rowFor(report, "M_bad.md").kind).toBe("corrupt_stamp");
    // The surface row is built from a RAW OBJECT LITERAL, not `makeViolation`.
    // A change that only touches the shared factory leaves this one undefined.
    expect(
      rowFor(report, "README.md").kind,
      "the release-surface-agreement site does not set `kind` — it is the one push site that " +
        "does not go through `makeViolation`, so a factory-only edit misses it",
    ).toBe("surface_disagreement");
    expect(kindsOf(report.violations)).toEqual([...KINDS]);
  });

  test("no row anywhere carries a kind outside the union", async () => {
    const roots = [windowRoot(), corruptRoot(), surfaceRoot(), allKindsRoot()];
    const rows: PlanShipCoherenceViolation[] = [];
    for (const root of roots) rows.push(...(await runPlanShipCoherenceProbe(root)).violations);
    expect(rows.length, "no rows collected — this leg would pass on an empty tree").toBeGreaterThan(0);
    const stray = rows.filter((v) => !(KINDS as readonly string[]).includes(v.kind));
    expect(stray, describeRows(stray)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-574.2 — not one byte of reason / note / message changes
// ===========================================================================
//
// Two ways of saying the same thing, deliberately. The GOLDENS below are the
// bytes measured off the pre-change probe; the SUBPROCESS leg runs the two
// sibling suites that pin this text independently and requires them to pass
// unchanged, which is the assertion the AC actually names — "they pass", not
// "they were not edited".

const GOLDEN_DEBT_REASON =
  "archived plan specs/plan/archive/M_debt.md has neither a shipped_in stamp nor " +
  "ship_state: parked (unshipped debt)";

const GOLDEN_MAL_REASON =
  "malformed shipped_in stamp in specs/plan/archive/M_mal.md: expected v<X.Y.Z>, " +
  "observed: 2.80.5 (corrupt stamp)";

const GOLDEN_BAD_REASON =
  "shipped_in stamp v9.9.9 in specs/plan/archive/M_bad.md has no matching ## [9.9.9] " +
  "heading in CHANGELOG.md (corrupt stamp)";

const GOLDEN_SURFACE_REASON =
  'release surfaces disagree on codename: README "Latest:" names codename "Verity"; ' +
  'v2.80.5\'s CHANGELOG entry is "Herald". The README release-file entry rewrites only the ' +
  "version, so this field goes stale unless a writer maintains it. Add `{codename}` to that " +
  "entry's `replace` template, or maintain the line by hand — see " +
  "`docs/ship-milestone-reference.md` § `kind: regex`.";

const GOLDEN_DEBT_MESSAGE = [
  `plan_ship_coherence: ${GOLDEN_DEBT_REASON}`,
  "Remedy: run the post-merge ship ceremony:",
  SHIP_CEREMONY_RECIPE,
  "Context: file=specs/plan/archive/M_debt.md, shipped_in=<absent>, probe=plan_ship_coherence",
].join("\n");

const GOLDEN_MAL_MESSAGE = [
  `plan_ship_coherence: ${GOLDEN_MAL_REASON}`,
  "Remedy: rewrite the shipped_in stamp in specs/plan/archive/M_mal.md as v<X.Y.Z> matching " +
    "the `## [X.Y.Z]` CHANGELOG.md heading of the release that shipped this milestone.",
  "Context: file=specs/plan/archive/M_mal.md, shipped_in=2.80.5, probe=plan_ship_coherence",
].join("\n");

const GOLDEN_BAD_MESSAGE = [
  `plan_ship_coherence: ${GOLDEN_BAD_REASON}`,
  "Remedy: fix the shipped_in stamp in specs/plan/archive/M_bad.md to the version of the " +
    "CHANGELOG.md release heading that actually shipped this milestone, or ship the release " +
    "so the `## [9.9.9]` heading exists.",
  "Context: file=specs/plan/archive/M_bad.md, shipped_in=v9.9.9, probe=plan_ship_coherence",
].join("\n");

const GOLDEN_SURFACE_MESSAGE = [
  `plan_ship_coherence: ${GOLDEN_SURFACE_REASON}`,
  "Remedy: rewrite README.md's `Latest:` line so its version, codename and milestone match " +
    "the CHANGELOG entry of the released version and the plan whose `shipped_in:` stamp names " +
    "it. The `kind: regex` release-file entry rewrites the version ONLY, so the codename and " +
    "the milestone are hand-written.",
  "Context: file=README.md, field=codename, expected=Herald, found=Verity, " +
    "probe=plan_ship_coherence",
].join("\n");

describe("AC-STE-574.2 — the diagnostic text is byte-identical", () => {
  test("reason, note and message are unchanged at all four push sites", async () => {
    const report = await runPlanShipCoherenceProbe(allKindsRoot());
    expect(report.violations.length, describeRows(report.violations)).toBe(4);
    const cases: Array<[string, string, string, number]> = [
      ["M_debt.md", GOLDEN_DEBT_REASON, GOLDEN_DEBT_MESSAGE, 1],
      ["M_mal.md", GOLDEN_MAL_REASON, GOLDEN_MAL_MESSAGE, 5],
      ["M_bad.md", GOLDEN_BAD_REASON, GOLDEN_BAD_MESSAGE, 5],
      ["README.md", GOLDEN_SURFACE_REASON, GOLDEN_SURFACE_MESSAGE, 1],
    ];
    for (const [needle, reason, message, line] of cases) {
      const row = rowFor(report, needle);
      expect(row.reason, `reason drifted for ${needle}`).toBe(reason);
      expect(row.message, `message drifted for ${needle}`).toBe(message);
      // `note` is `<repo-relative-file>:<line> — <reason>` per STE-82.
      const rel = needle === "README.md" ? "README.md" : `specs/plan/archive/${needle}`;
      expect(row.note, `note drifted for ${needle}`).toBe(`${rel}:${line} — ${reason}`);
    }
  });

  test("the two sibling suites that pin this text pass unchanged", () => {
    // `gate-check-plan-ship-coherence.test.ts:200-201` pins the sentinel row's
    // reason in BOTH directions (`not.toContain("corrupt stamp")` /
    // `toContain("unshipped debt")`); `m141-ste-546-corrections.test.ts` pins
    // the surface rows' reason substrings. Neither is edited by this FR, so
    // "they pass" is a statement about the probe, not about the tests.
    const proc = Bun.spawnSync(
      [
        "bun",
        "test",
        "tests/gate-check-plan-ship-coherence.test.ts",
        "tests/m141-ste-546-corrections.test.ts",
      ],
      { cwd: PLUGIN_ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode, out.slice(-3000)).toBe(0);
    // Non-vacuity: a run that collected nothing exits 0 too.
    expect(out, "the sibling run reported no passing tests at all").toMatch(/\b\d+ pass\b/);
    expect(out).not.toMatch(/^\s*0 pass\b/m);
  });
});

// ===========================================================================
// AC-STE-574.3 — the predicate the live-tree dogfood grades through
// ===========================================================================

describe("AC-STE-574.3 — the window is clean once graded through the predicate", () => {
  test("on the archive-then-ship window the predicate selects nothing", async () => {
    const report = await runPlanShipCoherenceProbe(windowRoot());
    // ZERO-HIT GUARD: the fixture must really reconstruct the window, or the
    // emptiness below is a statement about a tree with no violations at all.
    expect(
      report.violations.length,
      "the window fixture produced no violations — the assertion below would be vacuous",
    ).toBe(1);
    expect(report.violations[0]!.kind).toBe(TRANSIENT_KIND);
    expect(gradedViolations(report.violations), describeRows(report.violations)).toEqual([]);
  });

  test("the m141 live-tree dogfood grades through THAT predicate, not a copy", () => {
    const src = read(M141_SUITE);
    expect(
      src,
      "m141-ste-546-surface-agreement.test.ts does not import the shared grading predicate",
    ).toMatch(/import\s*\{[^}]*gradedViolations[^}]*\}\s*from\s*"\.\/_plan_ship_grading"/);
    // The probe #63 dogfood specifically — the flat assert is gone from it.
    const start = src.indexOf('describe("dogfood — the live tree is clean"');
    expect(start, "the live-tree dogfood describe block is gone").toBeGreaterThan(-1);
    const block = src.slice(start);
    expect(block).toContain("gradedViolations(report.violations)");
    expect(
      block,
      "the dogfood still grades the whole report flat — the window would red it",
    ).not.toContain("expect(report.violations, describeRowsOfProbe(report.violations)).toEqual([])");
  });

  // The defect is a SHAPE, not a line: any dogfood handing the raw
  // `report.violations` to a flat emptiness assert reopens the deadlock.
  //
  // `[^;]*` rather than `[^)]*`, and that is the whole point of this reader.
  // The form this FR actually deleted is the TWO-ARGUMENT house idiom
  // `expect(rows, describeRowsOfProbe(rows)).toEqual([])`, and a character
  // class excluding `)` cannot reach past the `)` that closes the message
  // builder — so the obvious spelling of this guard matches only the
  // one-argument form nobody here writes, and could never have been RED.
  // Excluding `;` instead keeps the match inside one statement while letting
  // it cross the nested call.
  const FLAT_REPORT_ASSERT = /expect\(\s*report\.violations\s*[,)][^;]*\.toEqual\(\[\]\)/g;

  test("the flat-assert reader can actually see the form it forbids", () => {
    // The instrument, before the measurement. A guard whose regex cannot match
    // its own subject reads exactly like a clean tree, which is the failure
    // this whole FR is about — so both spellings are proved detectable here.
    const oneArg = "expect(report.violations).toEqual([]);";
    const twoArg =
      "expect(report.violations, describeRowsOfProbe(report.violations)).toEqual([]);";
    expect([...oneArg.matchAll(FLAT_REPORT_ASSERT)].length, oneArg).toBe(1);
    expect([...twoArg.matchAll(FLAT_REPORT_ASSERT)].length, twoArg).toBe(1);
  });

  test("no live-tree probe #63 assert grades the report flat any more", () => {
    // Scoped to the live-tree dogfood block, NOT the whole file: the same
    // suite's temp-root legs assert flat emptiness legitimately — a fixture
    // built to agree with itself is clean — and a whole-file scan would red
    // them for writing the correct assertion about a different subject.
    const src = read(M141_SUITE);
    const start = src.indexOf('describe("dogfood — the live tree is clean"');
    expect(start, "the live-tree dogfood describe block is gone").toBeGreaterThan(-1);
    const block = src.slice(start);
    const flat = [...block.matchAll(FLAT_REPORT_ASSERT)];
    expect(
      flat.map((m) => m[0]),
      "a flat `expect(report.violations).toEqual([])` survives in the live-tree dogfood",
    ).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-574.4 — detection is unmoved
// ===========================================================================

describe("AC-STE-574.4 — the probe still reports the debt it always reported", () => {
  test("the window root still yields an unshipped_debt row from the probe itself", async () => {
    const report = await runPlanShipCoherenceProbe(windowRoot());
    const debt = report.violations.filter((v) => v.kind === TRANSIENT_KIND);
    expect(
      debt.length,
      "the probe no longer detects unshipped debt — the change was applied to the PROBE " +
        "instead of to the test that grades it",
    ).toBeGreaterThanOrEqual(1);
    expect(debt[0]!.reason).toContain("unshipped debt");
    expect(debt[0]!.file).toContain("M_debt.md");
  });

  test("the row that the dogfood stops grading is the row the probe still emits", async () => {
    const report = await runPlanShipCoherenceProbe(windowRoot());
    const dropped = report.violations.filter((v) => !gradedViolations(report.violations).includes(v));
    expect(dropped.length, "the predicate dropped nothing — the window fixture is wrong").toBe(1);
    expect(dropped[0]!.kind).toBe(TRANSIENT_KIND);
  });
});

// ===========================================================================
// AC-STE-574.5 — MUTATION ARM (mandatory): the predicate is not degenerate
// ===========================================================================
//
// A predicate that selected NOTHING would satisfy AC.3 (the window is clean)
// and AC.4 (the probe still detects) at the same time, while silently deleting
// the entire live-tree check. Only a fixture that must SURVIVE the predicate
// tells the two apart.

/** The mutant: the predicate degenerated to "select nothing". */
const degenerate = (_rows: readonly PlanShipCoherenceViolation[]): PlanShipCoherenceViolation[] =>
  [];

describe("AC-STE-574.5 — corrupt stamps and surface disagreement SURVIVE the predicate", () => {
  test("a corrupt-stamp fixture yields at least one graded row", async () => {
    const report = await runPlanShipCoherenceProbe(corruptRoot());
    const graded = gradedViolations(report.violations);
    expect(graded.length, describeRows(report.violations)).toBeGreaterThanOrEqual(1);
    expect(graded.every((v) => v.kind === "corrupt_stamp")).toBe(true);
    expect(graded.some((v) => v.file.endsWith("M_bad.md"))).toBe(true);
  });

  test("a surface-disagreement fixture yields at least one graded row", async () => {
    const report = await runPlanShipCoherenceProbe(surfaceRoot());
    const graded = gradedViolations(report.violations);
    expect(graded.length, describeRows(report.violations)).toBeGreaterThanOrEqual(1);
    expect(graded.every((v) => v.kind === "surface_disagreement")).toBe(true);
    expect(graded.some((v) => v.file.endsWith("README.md"))).toBe(true);
  });

  test("THE MUTANT: a select-nothing predicate passes AC.3 and AC.4 and fails here", async () => {
    const windowReport = await runPlanShipCoherenceProbe(windowRoot());
    const corruptReport = await runPlanShipCoherenceProbe(corruptRoot());
    const surfaceReport = await runPlanShipCoherenceProbe(surfaceRoot());

    // The mutant is indistinguishable from the real predicate on AC.3's arm …
    expect(degenerate(windowReport.violations)).toEqual([]);
    expect(gradedViolations(windowReport.violations)).toEqual([]);
    // … and AC.4 grades the PROBE, which the mutant cannot touch at all.
    expect(windowReport.violations.some((v) => v.kind === TRANSIENT_KIND)).toBe(true);

    // Here it dies, and the real predicate does not. Both directions asserted:
    // a mutation that never applied reads exactly like a pin that holds.
    expect(degenerate(corruptReport.violations).length).toBe(0);
    expect(degenerate(surfaceReport.violations).length).toBe(0);
    expect(gradedViolations(corruptReport.violations).length).toBeGreaterThan(0);
    expect(gradedViolations(surfaceReport.violations).length).toBeGreaterThan(0);
  });

  test("the predicate is a FILTER on kind, not a filter on everything", async () => {
    const report = await runPlanShipCoherenceProbe(allKindsRoot());
    const graded = gradedViolations(report.violations);
    expect(report.violations.length).toBe(4);
    expect(graded.length, describeRows(graded)).toBe(3);
    expect(kindsOf(graded)).toEqual(["corrupt_stamp", "surface_disagreement"]);
  });
});

// ===========================================================================
// AC-STE-574.6 — REMOVAL ARM: a real corrupt stamp still reds the assert
// ===========================================================================

describe("AC-STE-574.6 — the assert still reds on a genuine corrupt stamp", () => {
  test("graded set is non-empty and the dogfood-shaped assert throws", async () => {
    const report = await runPlanShipCoherenceProbe(corruptRoot());
    const graded = gradedViolations(report.violations);
    expect(graded.length, describeRows(report.violations)).toBeGreaterThan(0);
    // The assert in its dogfood shape, run for real. If it did not throw, the
    // narrowing would have removed the check rather than scoped it.
    expect(
      () => expect(graded, describeRows(graded)).toEqual([]),
      "the dogfood-shaped assert passed with a corrupt stamp present — the check is gone",
    ).toThrow();
  });

  test("the control: the same assert does NOT throw on the window root", async () => {
    const report = await runPlanShipCoherenceProbe(windowRoot());
    const graded = gradedViolations(report.violations);
    expect(() => expect(graded).toEqual([])).not.toThrow();
    // Zero-hit guard on the control: the window really did produce a row.
    expect(report.violations.length).toBe(1);
  });
});

// ===========================================================================
// AC-STE-574.7 — both surviving detectors, confirmed by test not by prose
// ===========================================================================

describe("AC-STE-574.7 — the two operator-invoked detectors are still registered", () => {
  test("/gate-check probe #63 is still plan_ship_coherence at severity error", () => {
    const lines = read(GATE_SKILL).split("\n");
    const start = lines.findIndex((l) => /^63\. \*\*/.test(l));
    expect(start, "no `63. **` row in skills/gate-check/SKILL.md").toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\d+\. \*\*/.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    const row = lines.slice(start, end).join("\n");
    expect(row).toMatch(/^63\. \*\*`plan_ship_coherence`\*\*/m);
    expect(row, "probe #63 is no longer graded at severity error").toContain(
      "**Severity: error.**",
    );
    expect(row).toContain("runPlanShipCoherenceProbe(projectRoot)");
    // The unshipped-debt leg specifically — the one this FR stops dogfooding.
    expect(
      row,
      "probe #63's row no longer documents the neither-key GATE FAILED leg, so the " +
        "detector this FR relies on surviving is undocumented",
    ).toMatch(/neither key.*GATE FAILED/s);
  });

  test("/ship-milestone's bare no-arg form still scans specs/plan/archive/ for the same predicate", () => {
    const ship = read(SHIP_SKILL);
    const idx = ship.indexOf("bare no-arg form");
    expect(idx, "skills/ship-milestone/SKILL.md no longer describes the bare no-arg form").toBeGreaterThan(-1);
    const block = ship.slice(idx, idx + 1500);
    expect(block, "the archive-fallback scan no longer names specs/plan/archive/").toContain(
      "specs/plan/archive/",
    );
    expect(block).toContain("shipped_in");
    expect(block).toContain("ship_state: parked");
    expect(
      block,
      "the ship skill no longer says it reads the SAME predicate as the probe — the two " +
        "surviving detectors could drift apart with nothing to notice",
    ).toContain("plan_ship_coherence");
  });
});

// ===========================================================================
// AC-STE-574.8 — the sibling filter migrates, provably behaviour-preservingly
// ===========================================================================

describe("AC-STE-574.8 — reason-substring → kind, with the same rows selected", () => {
  test("on a fixture carrying all three kinds the two selections are identical", async () => {
    const report = await runPlanShipCoherenceProbe(allKindsRoot());
    const byReason = report.violations.filter((v) => v.reason.includes("corrupt stamp"));
    const byKind = report.violations.filter((v) => v.kind === "corrupt_stamp");
    // ZERO-HIT GUARD both ways: two empty selections are trivially equal.
    expect(
      byReason.length,
      "the reason-substring selection is empty — the equality below would be vacuous",
    ).toBe(2);
    expect(byKind.length, "the kind selection is empty — `kind` is not set").toBe(2);
    expect(byKind).toEqual(byReason);
    // And the fixture really did carry the other two kinds, or "same rows"
    // would be a claim about a set with nothing to exclude.
    expect(kindsOf(report.violations)).toEqual([...KINDS]);
  });

  test("neither of the other two kinds says `corrupt stamp` in its reason", async () => {
    const report = await runPlanShipCoherenceProbe(allKindsRoot());
    const others = report.violations.filter((v) => v.kind !== "corrupt_stamp");
    expect(others.length, "no non-corrupt rows collected — vacuous").toBe(2);
    expect(others.filter((v) => v.reason.includes("corrupt stamp")), describeRows(others)).toEqual(
      [],
    );
  });

  test("the sibling suite's dogfood filter reads kind, and no longer reads reason", () => {
    const src = read(SIBLING_SUITE);
    const start = src.indexOf('describe("dogfood — real specs/plan/archive/ tree is coherent"');
    expect(start, "the sibling dogfood describe block is gone").toBeGreaterThan(-1);
    const block = src.slice(start);
    expect(block, "the sibling dogfood still filters on the reason substring").not.toContain(
      'v.reason.includes("corrupt stamp")',
    );
    expect(block, "the sibling dogfood does not filter on kind").toContain(
      'v.kind === "corrupt_stamp"',
    );
  });
});
