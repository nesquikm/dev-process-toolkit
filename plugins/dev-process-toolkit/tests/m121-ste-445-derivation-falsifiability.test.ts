// M121 STE-445 — "Build the falsifiability harness and one-way derivation
// binding for SMOKE_LEGS".
//
// ===========================================================================
// WHAT IS BROKEN
// ===========================================================================
//
// `SMOKE_LEGS` in `adapters/_shared/src/smoke_fixture_groups.ts` is presented
// as the authority for which conformance legs exist. It is imported by nothing.
// Measured 2026-08-07: widening it from `["linear","jira"]` to a three-member
// array containing a synthetic leg and running the whole gate returned
// 6605 pass / 15 skip / 0 fail — byte-identical to the clean baseline. Zero
// tests went red.
//
// Exactly one assertion in the suite was even REACHABLE by that mutation, and
// it tolerated it. `tests/m117-ste-425-falsifiable-coverage.test.ts:867`:
//
//     expect(r.stderr).toMatch(/--leg must be one of linear \| jira/)
//
// asserted against a string the CLI builds as `SMOKE_LEGS.join(" | ")`. The
// regex is unanchored, so the mutated `linear | jira | zzsynthetic` still
// CONTAINS the pinned substring and the assertion passed.
//
// ===========================================================================
// THE CIRCULARITY TRAP THIS FILE IS BUILT TO AVOID
// ===========================================================================
//
// The tempting fix — build the expected string from `SMOKE_LEGS` in the test so
// it "tracks the enum by construction" — is the WORST available option. Under a
// widened enum both the actual and the expected move together, so the assertion
// can never fail. That is a vacuous test wearing the costume of a derivation,
// and it is exactly the defect this milestone exists to remove.
//
// AC.2's wording settles the direction: the assertion must fail when
// `SMOKE_LEGS` gains a member "the assertion does not name". The expected value
// is therefore a HARDCODED LITERAL naming the full expected set, matched
// EXACTLY (anchored), never `toContain`. The hardcoded literal is a deliberate
// review checkpoint: widening the leg set forces a human to come here and
// re-state the new set by hand.
//
// ONE-WAY DERIVATION, stated once so it is not re-litigated per assertion:
//
//   - TypeScript is the AUTHORITY. Expected values originate there.
//   - Skill prose is the SUBJECT. It is read to be ASSERTED AGAINST.
//   - Reading a skill file to COMPUTE an expected value is forbidden — that
//     inverts the direction and yields a test that inspects the same document
//     it derived its expectation from, which cannot fail.
//
// The distinction is narrow and must not be over-applied: `m117-ste-425` reads
// `.claude/skills/smoke-test/SKILL.md` all over the place and every one of
// those reads is legitimate, because the prose is the thing under check. AC.4's
// meta-test encodes the distinction structurally (see § AC-STE-445.4 below).
//
// ===========================================================================
// TEST DESIGN
// ===========================================================================
//
// The mutation is executed, not described. `smoke_fixture_groups.ts` is
// self-contained (zero imports — verified), so the harness copies that single
// file to a temp dir, rewrites the `SMOKE_LEGS` line, and spawns the CLI from
// the copy. The real source file is NEVER mutated in place: an in-place
// mutation would race the rest of the suite and leave the tree dirty whenever
// an assertion threw.
//
// The harness asserts BOTH directions, and both are load-bearing:
//
//   (i)  mutation APPLIED  ⇒ the hardcoded expectation does NOT match ⇒ the
//        derivation assertion WOULD fail. This is falsifiability.
//   (ii) mutation ABSENT   ⇒ the same expectation DOES match. Without this a
//        harness that always reports RED would look identical to a working one.
//
// and the harness fails when the mutation produces ZERO failures, which is the
// milestone's declared halt condition (AC.5, `fr1_derivation_collapsed`).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const FIXTURE_GROUPS_SRC = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "smoke_fixture_groups.ts",
);
const STE425_TEST_PATH = join(
  PLUGIN_ROOT,
  "tests",
  "m117-ste-425-falsifiable-coverage.test.ts",
);
// AC-STE-459.2 — live-then-archive, the house conditional already shipped at
// `m108-ste-393-docs-pins.test.ts:99` and `m114-ste-416-…:203`. Archiving the
// milestone must not change what this suite checks; before STE-459 it took
// three of these assertions red.
const PLAN_ACTIVE = join(REPO_ROOT, "specs", "plan", "M121.md");
const PLAN_ARCHIVED = join(REPO_ROOT, "specs", "plan", "archive", "M121.md");
const PLAN_PATH = existsSync(PLAN_ACTIVE) ? PLAN_ACTIVE : PLAN_ARCHIVED;

// ──────────────────────── the module under construction ────────────────────
//
// `adapters/_shared/src/leg_derivation_mutation.ts` does not exist yet — this
// FR builds it. Imported dynamically, exactly as `m117-ste-425` imports
// `smoke_fixture_groups`, so a missing module fails the ACs that need it with a
// readable message instead of erroring the whole file out and hiding AC.2 and
// AC.5 (which do not depend on it).

interface LegCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface DerivationCheck {
  /** Stable id, must match a `DERIVATION_TARGETS` entry. */
  name: string;
  /** Did the hardcoded expectation match the UNMUTATED CLI? (direction ii) */
  matchedCanonical: boolean;
  /** Did it match the MUTATED CLI? `false` is the falsifying result. */
  matchedMutated: boolean;
}

interface LegMutationReport {
  syntheticLeg: string;
  /** False when the `SMOKE_LEGS` rewrite did not apply — a no-op mutation. */
  mutationApplied: boolean;
  checks: readonly DerivationCheck[];
  /** Names of checks whose expectation FAILED under mutation. */
  failuresUnderMutation: readonly string[];
}

interface DerivationTarget {
  /** Matches a `DerivationCheck.name`. */
  id: string;
  /** What is being asserted against — MAY be a skill file. Reading prose to
   *  assert against it is legitimate; see the one-way note above. */
  asserts: string;
  /** Where the expected VALUE lives. MUST be TypeScript, never prose. */
  expectationSourceFile: string;
  expectationSource: "typescript";
  /** The expected value verbatim, as it appears in `expectationSourceFile`. */
  expectationLiteral: string;
}

interface LegDerivationModule {
  /** A leg token deliberately absent from the canonical `SMOKE_LEGS`. */
  SYNTHETIC_LEG: string;
  /** Anchored, hardcoded, names the full expected set. NOT built from the enum. */
  CANONICAL_LEG_ERROR_PATTERN: RegExp;
  /** True iff stderr's first line exactly matches the hardcoded full-set literal. */
  legErrorMatchesCanonicalSet(stderr: string): boolean;
  /** Spawn the real, unmutated CLI. */
  runCanonicalLegCli(args: readonly string[]): LegCliResult;
  /** Spawn the CLI from a temp COPY whose `SMOKE_LEGS` gained `syntheticLeg`. */
  runMutatedLegCli(syntheticLeg: string, args: readonly string[]): LegCliResult;
  /** Run every registered derivation check in both directions. */
  runLegDerivationMutation(syntheticLeg?: string): LegMutationReport;
  DERIVATION_TARGETS: readonly DerivationTarget[];
}

const LEG_MODULE_PATH = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "leg_derivation_mutation.ts",
);

let legModule: LegDerivationModule | null = null;
let legModuleError = "";
try {
  legModule = (await import(LEG_MODULE_PATH)) as unknown as LegDerivationModule;
} catch (e) {
  legModuleError = e instanceof Error ? e.message : String(e);
}

function legMod(): LegDerivationModule {
  if (legModule === null) {
    throw new Error(
      `STE-445 requires adapters/_shared/src/leg_derivation_mutation.ts — ` +
        `import failed: ${legModuleError}`,
    );
  }
  return legModule;
}

// The renderer/guard surface AC.3 needs, on the existing module.
interface FixtureGroupSpecShape {
  group: number;
  sut: string;
  legs: readonly string[];
}
interface FixtureGroupsExtras {
  groupsCoveringLeg?(leg: string): readonly number[];
  CANONICAL_FIXTURE_GROUPS?: readonly FixtureGroupSpecShape[];
}
const fixtureGroupsExtras = (await import(
  FIXTURE_GROUPS_SRC
)) as unknown as FixtureGroupsExtras;

// ═══════════════════════════ AC-STE-445.1 ══════════════════════════════════

describe("AC-STE-445.1 — a permanent mutation test proves the binding can fail", () => {
  test("the synthetic leg is genuinely absent from the canonical set", () => {
    const m = legMod();
    expect(typeof m.SYNTHETIC_LEG).toBe("string");
    expect(m.SYNTHETIC_LEG.length).toBeGreaterThan(0);
    expect((SMOKE_LEGS as readonly string[]).includes(m.SYNTHETIC_LEG)).toBe(
      false,
    );
  });

  test("the mutation actually applies — a no-op rewrite is not a mutation", () => {
    const report = legMod().runLegDerivationMutation();
    expect(report.mutationApplied).toBe(true);
    expect(report.syntheticLeg).not.toBe("");
    expect((SMOKE_LEGS as readonly string[]).includes(report.syntheticLeg)).toBe(
      false,
    );
  });

  test("the mutated CLI really does carry the synthetic leg in its error text", () => {
    // Independent evidence that the temp copy is the thing being executed —
    // without it, `matchedMutated: false` could just mean "the copy failed to
    // run at all", which would make the whole harness a green-looking crash.
    const m = legMod();
    const r = m.runMutatedLegCli(m.SYNTHETIC_LEG, [
      "render",
      "--leg",
      "definitely-not-a-leg",
      "--passed",
      "1",
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain(m.SYNTHETIC_LEG);
    expect(r.stderr).toContain("--leg must be one of");
  });

  test("direction (i): under mutation at least one derivation assertion FAILS", () => {
    const report = legMod().runLegDerivationMutation();
    expect(report.checks.length).toBeGreaterThan(0);
    // THE HALT GATE. Zero failures means the binding is not falsifiable and the
    // milestone stops at STE-445 with `fr1_derivation_collapsed` (AC.5).
    expect(report.failuresUnderMutation.length).toBeGreaterThan(0);
    expect(report.failuresUnderMutation).toContain("leg-error-exact-set");
  });

  test("direction (ii): unmutated, every derivation expectation still matches", () => {
    // Without this a harness hardwired to report RED would be indistinguishable
    // from one that works.
    const report = legMod().runLegDerivationMutation();
    const stuck = report.checks
      .filter((check) => !check.matchedCanonical)
      .map((check) => check.name);
    expect(stuck).toEqual([]);
  });

  test("the harness never mutates the real source file", () => {
    legMod().runLegDerivationMutation();
    const src = readFileSync(FIXTURE_GROUPS_SRC, "utf8");
    expect(src).toContain(
      'export const SMOKE_LEGS = ["linear", "jira", "none"] as const;',
    );
    expect(src).not.toContain(legMod().SYNTHETIC_LEG);
  });

  test("the hardcoded expectation matches the real CLI and rejects a widened set", () => {
    const m = legMod();
    const canonical = m.runCanonicalLegCli([
      "render",
      "--leg",
      "jirra",
      "--passed",
      "1",
    ]);
    expect(canonical.exitCode).toBe(2);
    expect(m.legErrorMatchesCanonicalSet(canonical.stderr)).toBe(true);

    const mutated = m.runMutatedLegCli(m.SYNTHETIC_LEG, [
      "render",
      "--leg",
      "jirra",
      "--passed",
      "1",
    ]);
    expect(mutated.exitCode).toBe(2);
    expect(m.legErrorMatchesCanonicalSet(mutated.stderr)).toBe(false);
  });

  test("the expectation is anchored, so a widened set cannot satisfy it as a prefix", () => {
    const m = legMod();
    // The exact defect being retired, restated as data: the pre-fix regex
    // matched this string. The post-fix expectation must not.
    expect(
      m.legErrorMatchesCanonicalSet(
        'smoke_fixture_groups: --leg must be one of linear | jira | none | zzsynthetic (got "jirra")\n',
      ),
    ).toBe(false);
    expect(
      m.legErrorMatchesCanonicalSet(
        'smoke_fixture_groups: --leg must be one of linear | jira | none (got "jirra")\n' +
          "usage: bun smoke_fixture_groups.ts render --leg <linear|jira>",
      ),
    ).toBe(true);
  });
});

// ═══════════════════════════ AC-STE-445.2 ══════════════════════════════════

describe("AC-STE-445.2 — the --leg assertion is an exact-set match, not a prefix", () => {
  const ste425 = existsSync(STE425_TEST_PATH)
    ? readFileSync(STE425_TEST_PATH, "utf8")
    : null;

  test("the ste-425 test file is present", () => {
    expect(ste425).not.toBeNull();
  });

  test("the unanchored substring regex is gone", () => {
    // `toMatch(/--leg must be one of …/)` with no terminator is satisfied by
    // `linear | jira | zzsynthetic`. Measured: it stayed green under mutation.
    expect(ste425 ?? "").not.toContain("toMatch(/--leg must be one of");
  });

  test("the assertion uses the shared, hardcoded exact-set expectation", () => {
    expect(ste425 ?? "").toContain("legErrorMatchesCanonicalSet");
  });

  test("the surrounding rc and stdout assertions survive the edit", () => {
    // The cheapest way to make an assertion stop failing is to delete it. Pin
    // the two neighbours the FR says to keep.
    const src = ste425 ?? "";
    expect(src).toContain("an unrecognized or missing --leg is a usage error");
    expect(src).toContain('expect(r.stdout).not.toContain("Fixture groups:")');
  });
});

// ═══════════════════════════ AC-STE-445.3 ══════════════════════════════════

describe("AC-STE-445.3 — a registered leg no group rosters is loud, not all-N/A", () => {
  test("groupsCoveringLeg reports which canonical groups roster a leg", () => {
    const coveringLeg = fixtureGroupsExtras.groupsCoveringLeg;
    expect(typeof coveringLeg).toBe("function");
    // Group 2 is Linear-only by design (probe #26 is vacuous on Jira).
    expect([...coveringLeg!("linear")]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13]);
    expect([...coveringLeg!("jira")]).toEqual([1, 3, 4, 5, 6, 7, 8, 11, 12, 13]);
    // STE-446 widened the enum and the rosters now DERIVE from it. STE-449's
    // audit then took group 4 OFF the tracker-less leg: its two sub-fixtures are
    // 4a-Linear and 4b-Jira, and step 4 of each asserts a tracker ticket reaches
    // Done — there is no tracker-less instance to run. STE-450 then added group
    // 9, and STE-451 group 10 — both rostering the tracker-less leg ALONE — so
    // the leg is covered by one group MORE than the Jira leg, and two of its
    // groups are ones no tracker leg can reach. Restated by hand rather
    // than derived: computing it from the roster would compare the roster with
    // itself.
    // STE-464 then added group 11 on the full alias (the /deliver headless
    // refusal reads stdin tty-ness only), widening all three legs by one.
    // M124's group 12 (the best-practices lens disposition, manifest-on-disk
    // only) rides the full alias too, widening all three legs again — as does
    // M125's group 13 (the setup-template headless refusal, stdin tty-ness
    // only).
    expect([...coveringLeg!("none")]).toEqual([1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect([...coveringLeg!("zzsynthetic")]).toEqual([]);
  });

  test("every registered leg is rostered, so the guard's state cannot arise", () => {
    // WHAT THIS USED TO ASSERT, AND WHY IT NO LONGER DOES (re-aimed by STE-446).
    //
    // This test previously drove the STE-445 registered-but-unrostered guard
    // through the mutated CLI: `--leg <synthetic>` on a copy whose `SMOKE_LEGS`
    // had gained that leg, expecting rc 2 and a "no fixture group rosters it"
    // refusal instead of eight `not-applicable` records rendering as a pass.
    //
    // STE-446 AC.1 pointed the group rosters at the enum
    // (`const ALL_LEGS: readonly SmokeLeg[] = SMOKE_LEGS`, deleting the second
    // hardcoded copy that used to sit beside it — deliberately not spelled
    // here, because AC.1's grep for that identifier covers `tests/` too and a
    // mere mention in a comment is a hit). The mutation now widens the enum AND the
    // rosters together, so the same invocation renders
    // `Fixture groups: PASS — 7 passed … 1 n/a` at rc 0. Measured 2026-08-07.
    // The guard's precondition is unreachable by construction, so the old
    // assertion cannot be honestly repaired — only faked, by adding an
    // injectable-roster API purely to rebuild a state that can no longer occur.
    //
    // That is a STRENGTHENING, not a coverage loss: single-source construction
    // made the vacuous-pass state UNREPRESENTABLE rather than merely detected.
    // The guard itself stays at the CLI boundary as a fail-closed backstop
    // (FR STE-446 § Implementation notes, `roster_guard_left_at_cli_boundary`).
    //
    // WHAT IT ASSERTS NOW: the derivation that bought that strengthening. Both
    // arms fail the moment a partial literal roster comes back — which is the
    // regression actually worth catching, since it is what would make the
    // guard's state reachable again.
    const coveringLeg = fixtureGroupsExtras.groupsCoveringLeg;
    const groups = fixtureGroupsExtras.CANONICAL_FIXTURE_GROUPS;
    expect(typeof coveringLeg).toBe("function");
    expect(Array.isArray(groups)).toBe(true);

    // Arm 1 — the headline property: no leg the enum registers is rostered by
    // nobody. The full pre-STE-446 shape (`ALL_LEGS` a `["linear","jira"]`
    // literal read by seven groups) leaves `none` at zero groups and fails here.
    const unrostered = (SMOKE_LEGS as readonly string[]).filter(
      (leg) => coveringLeg!(leg).length === 0,
    );
    expect(unrostered).toEqual([]);

    // Arm 2 — the sharper one, and it is load-bearing: arm 1 alone survives a
    // SINGLE group being re-pointed at a literal, because the rest still roster
    // the leg. So every group must roster the whole registered set, except the
    // ones documented by design below. Re-pointing any group's `legs` at a
    // partial literal fails here.
    // FOUR exemptions, and they are exempt for DIFFERENT reasons — which is why
    // this map declares them one by one instead of counting them. An exemption
    // that appears here without a reason beside it is the drift this arm exists
    // to catch; an un-updated copy of the leg list would show up as a group
    // silently dropping a leg it never declared.
    const DECLARED_EXEMPTIONS: Readonly<Record<number, readonly string[]>> = {
      // Group 2's SUT is probe #26, which is vacuous on every non-Linear
      // tracker. Scoped by CAPABILITY: no leg can ever be added back, because
      // the thing under test does not exist off Linear.
      2: ["linear"],
      // Group 4 (STE-449 audit). Scoped by FIXTURE CONSTITUTION, not by
      // capability: the group is two tracker-parameterized sub-fixtures whose
      // step 4 asserts a tracker ticket reaching Done, so it has no tracker-less
      // instance to run. Steps 1-3 of the `--no-tech` contract ARE
      // tracker-agnostic, so this exemption is retired the moment someone writes
      // a tracker-less sub-fixture — unlike group 2's, which is permanent.
      // Recorded as a coverage gap in specs/notes/follow-ups.md § M121.
      4: ["linear", "jira"],
      // Group 9 (STE-450). A THIRD reason class, and it points the OTHER way:
      // 2 and 4 are exempt FROM the tracker-less leg, this one is exempt from
      // the TRACKER legs. Scoped by INVERSION, not by vacuity — gate probes
      // #13 and #73 do not merely go quiet under a tracker, they demand the
      // opposite (a `tracker:` block present, the minted `id:` absent), so the
      // arms this group asserts are unreachable from `linear` and `jira`
      // rather than merely uninteresting there. Permanent, like group 2's:
      // no tracker leg can ever be added back without the probes changing
      // meaning.
      9: ["none"],
      // Group 10 (STE-451). Same leg as group 9 and a FOURTH reason class, which
      // is why it is listed separately rather than folded into that entry. Not
      // inversion: `.dpt/locks/<id>` is written only by LocalProvider.claimLock,
      // which runs only under `mode: none` — a tracker-mode claim writes to the
      // ticket, so a tracker leg has no lock file to observe at any instant.
      // Vacuity WITH A NAMED SUBSTITUTE (the tracker legs carry the same
      // property through the ticket-state row), unlike group 2's vacuity where
      // nothing carries it anywhere. Permanent for the same structural reason.
      10: ["none"],
    };
    const full = [...(SMOKE_LEGS as readonly string[])].sort();
    const offenders = groups!
      .map((spec) => {
        const expected = DECLARED_EXEMPTIONS[spec.group] ?? full;
        const actual = [...spec.legs].sort();
        const want = [...expected].sort();
        const same =
          actual.length === want.length &&
          actual.every((leg, i) => leg === want[i]);
        return same ? null : `group ${spec.group}: ${JSON.stringify(spec.legs)}`;
      })
      .filter((entry) => entry !== null);
    expect(offenders).toEqual([]);
  });

  test("the two canonical legs are unaffected by the guard", () => {
    const m = legMod();
    const jira = m.runCanonicalLegCli([
      "render",
      "--leg",
      "jira",
      "--passed",
      "1 3 4 5 6 7 8 11 12 13",
    ]);
    expect(jira.exitCode).toBe(0);
    expect(jira.stdout).toContain("STE-214 runtime check: N/A");

    const linear = m.runCanonicalLegCli([
      "render",
      "--leg",
      "linear",
      "--passed",
      "1 2 3 4 5 6 7 8 11 12 13",
    ]);
    expect(linear.exitCode).toBe(0);
    expect(linear.stdout.split("\n")[0]).toMatch(/^Fixture groups: PASS\b/);
  });
});

// ═══════════════════════════ AC-STE-445.4 ══════════════════════════════════

describe("AC-STE-445.4 — every expectation originates in TypeScript, not in prose", () => {
  test("the registry is non-empty", () => {
    expect(legMod().DERIVATION_TARGETS.length).toBeGreaterThan(0);
  });

  test("the registry and the executed checks have exactly ONE source", () => {
    // WHAT THIS USED TO ASSERT, AND WHY IT NO LONGER DOES (STE-445).
    //
    // This test previously compared `DERIVATION_TARGETS` against the executed
    // `checks` and asserted the two sets were equal — a drift detector. That
    // assertion CANNOT FAIL as the module is now built: both are `.map()`
    // projections of the single `DERIVATION_SPECS` array, so their id sets are
    // identical for any contents of that array, including empty. Measured: with
    // the spec array emptied, the equality assertion stayed GREEN.
    //
    // The honest reading is NOT "this test went vacuous". It is that its
    // SUBJECT CEASED TO EXIST: single-source construction makes drift
    // unrepresentable rather than merely detected, which is strictly stronger
    // than detecting it. Re-splitting into two hand-maintained arrays purely so
    // a test could fail would reintroduce the exact hazard the construction
    // eliminates — preserving a test by restoring the bug it detects.
    //
    // So the assertion is RE-AIMED at the property that genuinely still holds
    // and genuinely can still fail: that there is exactly ONE source.
    //
    // WHAT EACH ARM BELOW DOES AND DOES NOT CATCH — stated precisely, because
    // an earlier revision of this comment overclaimed and was measured false.
    // Anchoring on the NAME (`^const DERIVATION_SPECS\b`) does NOT catch a
    // second, differently-named array: `\b` cannot fire before `_`, so
    // `const DERIVATION_SPECS_TWO` slips past it, and a redeclaration of the
    // SAME identifier is already a TypeScript error needing no test. So the
    // first arm anchors on the TYPE instead, which is what a parallel source
    // must carry to be usable.
    const src = readFileSync(LEG_MODULE_PATH, "utf8");

    // Arm 1 — exactly one array of derivation specs exists, whatever it is
    // named. A second hand-maintained `readonly DerivationSpec[]` fails here.
    const specArrays = [...src.matchAll(/:\s*readonly DerivationSpec\[\]\s*=/g)];
    expect(specArrays.length).toBe(1);

    // Arm 2 — both consumers derive from that identifier rather than restating it.
    // If either is ever replaced by a hand-maintained array literal, the
    // corresponding `DERIVATION_SPECS.map(` reference disappears and this fails.
    const derivations = [...src.matchAll(/DERIVATION_SPECS\.map\(/g)];
    expect(derivations.length).toBeGreaterThanOrEqual(2);

    // And the exported registry is still a projection, not its own literal.
    expect(src).toMatch(
      /export const DERIVATION_TARGETS[\s\S]{0,120}?DERIVATION_SPECS\.map\(/,
    );
  });

  test("no expectation is sourced from a markdown/prose file", () => {
    for (const target of legMod().DERIVATION_TARGETS) {
      expect(target.expectationSource).toBe("typescript");
      expect(target.expectationSourceFile.endsWith(".md")).toBe(false);
      expect(target.expectationSourceFile.endsWith(".ts")).toBe(true);
    }
  });

  test("the declared expectation literal really is in the declared TypeScript file", () => {
    // Keeps the marker from being decorative: deleting the literal from the
    // TypeScript, or moving it into prose, turns this RED.
    for (const target of legMod().DERIVATION_TARGETS) {
      const abs = join(PLUGIN_ROOT, target.expectationSourceFile);
      expect(existsSync(abs)).toBe(true);
      expect(readFileSync(abs, "utf8")).toContain(target.expectationLiteral);
    }
  });

  test("an expectation-defining module never reads a skill file", () => {
    // THE ONE-WAY CHECK. Scoped to the module that DEFINES the expected value,
    // not to the test that asserts with it — `m117-ste-425` reads SKILL.md
    // legitimately, because the prose is the subject under check. Inverting the
    // direction (computing the expectation from the prose) is what this
    // forbids, and adding such a read here turns it RED.
    for (const target of legMod().DERIVATION_TARGETS) {
      const src = readFileSync(join(PLUGIN_ROOT, target.expectationSourceFile), "utf8");
      expect(src).not.toContain("SKILL.md");
      expect(src).not.toContain(".claude/skills");
    }
  });

  test("the leg-error expectation is registered against the shared module", () => {
    const target = legMod().DERIVATION_TARGETS.find(
      (entry) => entry.id === "leg-error-exact-set",
    );
    expect(target).toBeDefined();
    expect(target!.expectationSourceFile).toBe(
      "adapters/_shared/src/leg_derivation_mutation.ts",
    );
    expect(target!.expectationLiteral).toContain("linear");
    expect(target!.expectationLiteral).toContain("jira");
  });
});

// ═══════════════════════════ AC-STE-445.5 ══════════════════════════════════

const OUTCOME_RECORD_RE =
  /^<!-- STE-445 outcome token: (fr1_derivation_falsifiable|fr1_derivation_collapsed) -->$/gm;

describe("AC-STE-445.5 — the plan records exactly one outcome token", () => {
  const plan = existsSync(PLAN_PATH) ? readFileSync(PLAN_PATH, "utf8") : null;

  test("the milestone plan exists", () => {
    expect(plan).not.toBeNull();
  });

  test("the not-yet-recorded placeholder is gone", () => {
    expect(plan ?? "").not.toContain("<!-- STE-445 outcome token: not yet recorded -->");
  });

  test("exactly one outcome-record line is present, carrying one of the two tokens", () => {
    // Scoped to the record LINE on purpose: both tokens also appear in the
    // plan's § Halt condition prose, so a naive whole-file count of either
    // token can never resolve to one.
    const matches = [...(plan ?? "").matchAll(OUTCOME_RECORD_RE)];
    expect(matches.length).toBe(1);
    expect(["fr1_derivation_falsifiable", "fr1_derivation_collapsed"]).toContain(
      matches[0]![1],
    );
  });

  test("a collapsed outcome means zero commits reference STE-446", () => {
    const matches = [...(plan ?? "").matchAll(OUTCOME_RECORD_RE)];
    const token = matches[0]?.[1];
    if (token !== "fr1_derivation_collapsed") {
      // Falsifiable outcome: STE-446 is permitted to exist. Nothing to assert.
      expect(token).toBe("fr1_derivation_falsifiable");
      return;
    }
    const r = spawnSync("git", ["log", "--format=%H", "-F", "--grep=STE-446"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});
