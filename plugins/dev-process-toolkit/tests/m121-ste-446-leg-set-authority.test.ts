// M121 STE-446 — "Make SMOKE_LEGS the sole leg-set authority with five
// derivation surfaces".
//
// ===========================================================================
// WHAT IS BROKEN (measured 2026-08-07, before this file was written)
// ===========================================================================
//
// The leg set is written down in three independent places nothing keeps in
// sync:
//
//   1. `SMOKE_LEGS` in `adapters/_shared/src/smoke_fixture_groups.ts` — the
//      declared authority.
//   2. A second hardcoded copy immediately below it, a module-private alias
//      holding the same two-member literal. SEVEN of the eight canonical
//      fixture groups read THAT copy for their `legs` roster, not the enum.
//      This is why all eight rosters stayed static when the enum was mutated
//      during the design measurement — the roster never saw the new leg.
//   3. The literal text of the two project-local driver skills, which spell
//      `linear` and `jira` out by hand at five separate surfaces.
//
// ===========================================================================
// TWO OPPOSITE DIRECTIONS LIVE IN THIS MILESTONE. DO NOT CONFLATE THEM.
// ===========================================================================
//
// (A) `CANONICAL_LEG_ERROR_PATTERN` in `leg_derivation_mutation.ts` must stay
//     a HARDCODED, hand-written literal. The CLI builds its error text as
//     `SMOKE_LEGS.join(" | ")`, so an expectation derived from the same array
//     would move together with the actual and could never fail. Widening the
//     leg set is REQUIRED to break that file — that is the mechanism, not a
//     bug, and it is the forced human review checkpoint STE-445 installed.
//     § AC-STE-446.1 below re-states the widened set BY HAND and pins that the
//     module never builds the pattern from the enum.
//
// (B) The FIVE PROSE SURFACES must DERIVE from `SMOKE_LEGS`. Here the two
//     sides are genuinely different artifacts — the TypeScript enum is the
//     authority, the skill markdown is the asserted document — so comparing
//     them is a real assertion that can really fail.
//
// The distinguishing rule, stated once: deriving is circular only when BOTH
// sides trace to the same source.
//
// ===========================================================================
// THE SURFACE MODULE THIS FR MUST BUILD
// ===========================================================================
//
// `adapters/_shared/src/leg_prose_surfaces.ts` does not exist yet. It holds
// the five surface extractors, each of which answers ONE question about a
// driver document: *which leg tokens does this surface's prose actually
// enumerate?* It is the ACTUAL side of the comparison. The EXPECTED side is
// always `SMOKE_LEGS`, supplied by the caller.
//
// The direction is load-bearing and the API enforces it structurally:
// `proseLegs(docs)` NEVER receives the authority set. A surface cannot see
// what it is being compared against, so it cannot agree with it by
// construction. The module is also handed document TEXT, never document
// PATHS — it neither reads files nor names a skill path, which keeps it
// eligible for registration in STE-445's `DERIVATION_TARGETS` (whose AC.4
// meta-test forbids an expectation-defining module from naming a skill file).
//
// The five surfaces, and what each extracts:
//
//   spawn-fence-brace-groups     conformance-loop § Phase A spawn fence: the
//                                `--tracker <leg>` token of each `{ … } &`
//                                brace group, in fence order.
//   preflight-6-basename-allowlist
//                                smoke-test pre-flight #6's shell `case` arm:
//                                the `<leg>` suffix of each
//                                `dpt-test-project-<leg>` alternative.
//   green-probe-findings-files   conformance-loop § Termination (a): the
//                                `<leg>` segment of each
//                                `/tmp/dpt-smoke-findings-${DATE}-<leg>.md`.
//   closing-summary-columns      conformance-loop § Closing summary: the
//                                `<leg>` of each `high (<leg>)` table column.
//   pidfile-globs                conformance-loop's per-leg pidfile paths and
//                                poll-loop word list. (The smoke-test half of
//                                this surface is `<tracker>`-templated and so
//                                contributes no literal legs — see the
//                                AC-STE-446.4 hazard note below.)
//
// ===========================================================================
// AC-STE-446.4 HAZARD — READ BEFORE EDITING `.claude/skills/smoke-test`
// ===========================================================================
//
// `tests/m116-ste-423-tracker-scoped-artifacts.test.ts` scans the SMOKE-TEST
// skill for every `dpt-smoke-` literal and requires each to carry a tracker
// segment matching `(?:<tracker>|${TRACKER}|$TRACKER|linear|jira)`. That
// alternation does NOT include a third leg. So adding any `dpt-smoke-<newleg>`
// literal to the smoke-test skill turns AC-STE-423.4 RED, and the only repair
// would be editing the STE-423 test — which AC-STE-446.4 forbids outright.
//
// The way through is to keep the smoke-test skill's `dpt-smoke-` paths
// `<tracker>`-templated (they already are) and put the per-leg enumeration in
// the conformance-loop skill, which STE-423 explicitly declares out of scope.
// § AC-STE-446.4 pins both halves.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SMOKE_LEGS, groupsCoveringLeg } from "../adapters/_shared/src/smoke_fixture_groups";
import {
  CANONICAL_LEG_ERROR_PATTERN,
  DERIVATION_TARGETS,
  SYNTHETIC_LEG,
  runLegDerivationMutation,
} from "../adapters/_shared/src/leg_derivation_mutation";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const FIXTURE_GROUPS_REL = "adapters/_shared/src/smoke_fixture_groups.ts";
const FIXTURE_GROUPS_SRC = join(PLUGIN_ROOT, FIXTURE_GROUPS_REL);
const LEG_MUTATION_SRC = join(
  PLUGIN_ROOT,
  "adapters/_shared/src/leg_derivation_mutation.ts",
);
const SURFACES_REL = "adapters/_shared/src/leg_prose_surfaces.ts";
const SURFACES_SRC = join(PLUGIN_ROOT, SURFACES_REL);

const VERDICT_TEST_SRC = join(
  PLUGIN_ROOT,
  "tests/m116-ste-420-verdict-artifact.test.ts",
);
const SCOPING_TEST_REL =
  "plugins/dev-process-toolkit/tests/m116-ste-423-tracker-scoped-artifacts.test.ts";
const SCOPING_TEST_SRC = join(REPO_ROOT, SCOPING_TEST_REL);

// AC-STE-459.2 — live-then-archive, the house conditional already shipped at
// `m108-ste-393-docs-pins.test.ts:99` and `m114-ste-416-…:203`.
const FR_ACTIVE = join(REPO_ROOT, "specs/frs/STE-446.md");
const FR_ARCHIVED = join(REPO_ROOT, "specs/frs/archive/STE-446.md");
const FR_PATH = existsSync(FR_ACTIVE) ? FR_ACTIVE : FR_ARCHIVED;

const LOOP_SKILL = join(REPO_ROOT, ".claude/skills/conformance-loop/SKILL.md");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");

/**
 * The name of the second hardcoded leg copy AC-STE-446.1 deletes, assembled
 * from fragments rather than written out.
 *
 * NOT evasion — a necessity. AC.1's check is "a grep for that identifier
 * across `adapters/` and `tests/` returns zero hits", and this file lives in
 * `tests/`. Spelling the identifier here would make the assertion
 * self-defeating: it could never pass, no matter what the implementer did.
 */
const LEGACY_LEG_ALIAS = ["BOTH", "LEGS"].join("_");

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function git(args: readonly string[]): { stdout: string; status: number } {
  const r = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { stdout: r.stdout ?? "", status: r.status ?? -1 };
}

// Dogfood-only surfaces: a plugin-only checkout carries neither driver skill,
// so those suites skip cleanly instead of failing. Same idiom as m112/m116.
const loopDoc = read(LOOP_SKILL);
const smokeDoc = read(SMOKE_SKILL);
const describeIfSkills =
  loopDoc === null || smokeDoc === null ? describe.skip : describe;

// ───────────────────── the module under construction ───────────────────────
//
// Imported dynamically, exactly as `m121-ste-445` imports the harness module
// it drives into existence, so a missing module fails the ACs that need it
// with a readable message instead of erroring the whole file out and hiding
// the ACs that do not depend on it.

type LegProseDocId = "conformance-loop" | "smoke-test";
type LegProseDocs = Readonly<Record<LegProseDocId, string>>;

interface LegProseSurface {
  /** Stable id. */
  id: string;
  /** What is asserted against, IN WORDS — never a file path. */
  asserts: string;
  /** Which driver documents this surface spans. */
  documents: readonly LegProseDocId[];
  /**
   * The leg tokens this surface's prose actually enumerates, deduped, in
   * document order. Deliberately does NOT receive the authority set.
   */
  proseLegs(docs: LegProseDocs): readonly string[];
}

/** One `{ … } &` group of the conformance-loop Phase A spawn fence. */
interface SpawnFenceGroup {
  /** The group's `--tracker <token>` value; `""` when it names none. */
  tracker: string;
  /** Every `<leg>` appearing as `dpt-smoke-verdict-<leg>.json` in the body. */
  verdictLegs: readonly string[];
}

interface LegProseSurfacesModule {
  LEG_PROSE_SURFACES: readonly LegProseSurface[];
  /** Structured view of the Phase A spawn fence, for AC.3 / AC.4. */
  parseSpawnFenceGroups(conformanceLoopDoc: string): readonly SpawnFenceGroup[];
}

let surfaces: LegProseSurfacesModule | null = null;
let surfacesError = "";
try {
  surfaces = (await import(SURFACES_SRC)) as unknown as LegProseSurfacesModule;
} catch (e) {
  surfacesError = e instanceof Error ? e.message : String(e);
}

function surfaceMod(): LegProseSurfacesModule {
  if (surfaces === null || surfaces.LEG_PROSE_SURFACES === undefined) {
    throw new Error(
      `STE-446 requires ${SURFACES_REL} exporting LEG_PROSE_SURFACES + ` +
        `parseSpawnFenceGroups — import failed: ${surfacesError || "no exports"}`,
    );
  }
  return surfaces;
}

function docs(): LegProseDocs {
  return { "conformance-loop": loopDoc ?? "", "smoke-test": smokeDoc ?? "" };
}

function surfaceById(id: string): LegProseSurface {
  const found = surfaceMod().LEG_PROSE_SURFACES.find((s) => s.id === id);
  if (found === undefined) {
    throw new Error(
      `no LEG_PROSE_SURFACES entry with id ${JSON.stringify(id)} — have: ` +
        surfaceMod()
          .LEG_PROSE_SURFACES.map((s) => s.id)
          .join(", "),
    );
  }
  return found;
}

/** Legs the authority declares that the prose does not enumerate, and vice versa. */
function legDiff(
  prose: readonly string[],
  authority: readonly string[],
): { missing: string[]; extra: string[] } {
  const p = new Set(prose);
  const a = new Set(authority);
  return {
    missing: [...a].filter((leg) => !p.has(leg)),
    extra: [...p].filter((leg) => !a.has(leg)),
  };
}

const EXPECTED_LEGS: readonly string[] = SMOKE_LEGS as readonly string[];

// ═══════════════════════════ AC-STE-446.1 ══════════════════════════════════

describe("AC-STE-446.1 — SMOKE_LEGS is the only leg list left standing", () => {
  test("the enum carries all three legs, in order", () => {
    expect([...SMOKE_LEGS]).toEqual(["linear", "jira", "none"]);
  });

  test("the second hardcoded copy is gone from the defining module", () => {
    expect(readFileSync(FIXTURE_GROUPS_SRC, "utf8")).not.toContain(
      LEGACY_LEG_ALIAS,
    );
  });

  test("a grep across adapters/ and tests/ returns zero hits", () => {
    // The AC's own words, executed. `grep -r` exits 1 with empty stdout when
    // nothing matches, so the status is checked as well as the output — a
    // grep that failed to run (exit 2) must not read as "no hits".
    const r = spawnSync("grep", ["-rn", LEGACY_LEG_ALIAS, "adapters", "tests"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf8",
    });
    expect(r.stdout ?? "").toBe("");
    expect(r.status).toBe(1);
  });

  test("every group roster resolves through the enum, so no leg is unrostered", () => {
    // The failure this closes: a widened enum whose rosters never moved leaves
    // the new leg registered and covered by nothing, which the STE-445 CLI
    // guard then refuses on every invocation.
    for (const leg of SMOKE_LEGS) {
      expect({ leg, groups: [...groupsCoveringLeg(leg)] }).not.toEqual({
        leg,
        groups: [],
      });
    }
  });

  // ── the forced review checkpoint (direction A) ──────────────────────────

  test("the canonical error pattern is RE-STATED by hand for the widened set", () => {
    // Anchors and escaped pipes retained. Widening the enum without coming
    // here is exactly what STE-445 built this literal to catch.
    expect(CANONICAL_LEG_ERROR_PATTERN.source).toBe(
      "^smoke_fixture_groups: --leg must be one of linear \\| jira \\| none \\(got .*\\)$",
    );
  });

  test("the pattern is a written literal, never built from the enum", () => {
    // If the expectation were assembled from `SMOKE_LEGS`, both sides of the
    // assertion would trace to the same array and the whole harness would be
    // silently disarmed. Pin the mechanism, not just the current text.
    const src = readFileSync(LEG_MUTATION_SRC, "utf8");
    expect(src).toContain(
      "/^smoke_fixture_groups: --leg must be one of linear \\| jira \\| none \\(got .*\\)$/",
    );
    expect(src).not.toMatch(/SMOKE_LEGS\s*\.\s*join/);
    expect(src).not.toMatch(/\$\{\s*SMOKE_LEGS/);
    expect(src).not.toMatch(/from\s+["'][^"']*smoke_fixture_groups["']/);
  });

  test("the STE-445 registry's second statement of the literal moved too", () => {
    const target = DERIVATION_TARGETS.find(
      (entry) => entry.id === "leg-error-exact-set",
    );
    expect(target).toBeDefined();
    expect(target!.expectationLiteral).toBe(
      "^smoke_fixture_groups: --leg must be one of linear \\| jira \\| none \\(got .*\\)$",
    );
  });
});

// ═══════════════════════════ AC-STE-446.2 ══════════════════════════════════

describeIfSkills("AC-STE-446.2 — five surfaces, each bound to the enum", () => {
  test("exactly five surfaces are registered, one per Requirement bullet", () => {
    expect(surfaceMod().LEG_PROSE_SURFACES.map((s) => s.id).sort()).toEqual(
      [
        "closing-summary-columns",
        "green-probe-findings-files",
        "pidfile-globs",
        "preflight-6-basename-allowlist",
        "spawn-fence-brace-groups",
      ],
    );
  });

  test("the surface module never reads a file and never names a skill path", () => {
    // THE ONE-WAY CHECK, structural. A surface is handed document TEXT by its
    // caller; the moment it can open a file for itself, the expectation and
    // the subject start sharing a source. Keeping the module free of skill
    // paths also keeps it registrable in STE-445's DERIVATION_TARGETS, whose
    // AC.4 meta-test forbids exactly those tokens in an expectation module.
    const src = readFileSync(SURFACES_SRC, "utf8");
    expect(src).not.toContain("node:fs");
    expect(src).not.toContain("readFileSync");
    expect(src).not.toContain("SKILL.md");
    expect(src).not.toContain(".claude/skills");
    // The module's own header claims it "never states the expected side and
    // never imports it", but nothing here enforced the second half — importing
    // the authority set would let a surface agree with the enum by echoing it,
    // which is the circularity this whole binding exists to avoid. The sibling
    // pin on `leg_derivation_mutation.ts` already carries this clause; its
    // absence here was an audit finding, not a deliberate asymmetry.
    // Scoped to IMPORTS, deliberately. A blanket ban on the identifier would
    // also forbid the header from NAMING the enum it explains it never imports
    // — the same documentation-accuracy cost AC.1's whole-file pin already
    // paid, and not one worth paying twice. What matters is that no binding is
    // pulled in, not that the word never appears.
    expect(src).not.toMatch(/from\s+["'].*smoke_fixture_groups/);
    expect(src).not.toMatch(/^\s*import[\s\S]*?SMOKE_LEGS/m);
  });

  test("no surface can see the authority set it is compared against", () => {
    // `proseLegs` takes exactly one argument — the documents. A second
    // parameter would let a surface echo the enum back and agree by
    // construction, which is the circularity this milestone exists to remove.
    for (const surface of surfaceMod().LEG_PROSE_SURFACES) {
      expect({ id: surface.id, arity: surface.proseLegs.length }).toEqual({
        id: surface.id,
        arity: 1,
      });
    }
  });

  for (const id of [
    "spawn-fence-brace-groups",
    "preflight-6-basename-allowlist",
    "green-probe-findings-files",
    "closing-summary-columns",
    "pidfile-globs",
  ]) {
    describe(`surface: ${id}`, () => {
      test("the prose enumerates exactly the registered leg set", () => {
        const prose = [...surfaceById(id).proseLegs(docs())];
        expect(legDiff(prose, EXPECTED_LEGS)).toEqual({
          missing: [],
          extra: [],
        });
      });

      test("DISCRIMINATOR: the extractor really reads prose, not the enum", () => {
        // WHAT THIS USED TO ASSERT, AND WHY IT WAS REPLACED (audit finding).
        //
        // The previous body paired `prose.length > 0` with
        // `expect(prose).not.toContain(SYNTHETIC_LEG)`. That second assertion
        // CANNOT FAIL: `zzsynthetic` appears in neither driver document, so any
        // extractor that actually reads them can never return it — and one that
        // returned a hardcoded constant could not return it either. Its comment
        // described the widened-set comparison from an earlier revision that no
        // longer existed here. It was the same always-empty idiom already found
        // and removed from the AC.5 block, surviving inside AC.2's own
        // non-vacuity check.
        //
        // Replaced with the discriminator that actually discriminates: feed the
        // surface EMPTY documents. A genuine extractor returns nothing; one
        // echoing the enum or a constant returns the full set regardless. That
        // is the difference the test claims to detect, and it can fail.
        const surface = surfaceById(id);
        const prose = [...surface.proseLegs(docs())];
        expect(prose.length).toBeGreaterThan(0);

        const onEmpty = [...surface.proseLegs({
          "conformance-loop": "",
          "smoke-test": "",
        })];
        expect({ id, onEmpty }).toEqual({ id, onEmpty: [] });
      });
    });
  }

  test("pre-flight #6's case arm is byte-identical to the arm generated from the enum", () => {
    // The FR's Technical Design prefers generating the shell `case` arms from
    // the enum and byte-comparing over restating the allow-list in a shape a
    // test can reconstruct. This is that comparison.
    const arm = EXPECTED_LEGS.map((leg) => `dpt-test-project-${leg}`).join("|");
    expect(smokeDoc!).toContain(`${arm}) ;;`);
  });

  test("pre-flight #6's prose allow-list names every registered leg", () => {
    // The shipped shell snippet and the bullet above it are two statements of
    // the same allow-list; fixing only the executable one leaves the operator
    // reading a stale set.
    const bullet =
      smokeDoc!
        .split(/\n/)
        .find(
          (line) =>
            line.includes("closed allow-list") &&
            line.includes("dpt-test-project-"),
        ) ?? "";
    expect(bullet.length).toBeGreaterThan(0);
    for (const leg of EXPECTED_LEGS) {
      expect(bullet).toContain(`dpt-test-project-${leg}`);
    }
  });

  test("the closing-summary table carries a medium column naming every leg", () => {
    const header =
      loopDoc!.split(/\n/).find((line) => /\|\s*iter\s*\|/.test(line)) ?? "";
    expect(header.length).toBeGreaterThan(0);
    const medium = header.split("|").find((cell) => cell.includes("medium"));
    expect(medium).toBeDefined();
    for (const leg of EXPECTED_LEGS) {
      expect(medium!).toContain(leg);
    }
  });
});

// ═══════════════════════════ AC-STE-446.3 ══════════════════════════════════

describeIfSkills("AC-STE-446.3 — the spawn-fence pin is replaced, not widened", () => {
  const verdictTest = read(VERDICT_TEST_SRC) ?? "";

  test("the literal two-group count is gone", () => {
    // `expect(braceGroups(fence).length).toBe(2)` is a slicing technique, not
    // the contract. It cannot survive a third leg and it never asserted
    // scoping in the first place.
    expect(verdictTest).not.toContain("braceGroups(fence).length).toBe(2)");
  });

  test("the hardcoded per-tracker lookup table is gone", () => {
    expect(verdictTest).not.toContain('["linear", "RC_FILE_LINEAR"]');
    expect(verdictTest).not.toContain('["jira", "RC_FILE_JIRA"]');
  });

  test("the replacement derives its group set from the enum", () => {
    expect(verdictTest).toContain("SMOKE_LEGS");
  });

  test("one brace group per registered leg, with a matching tracker token", () => {
    const groups = surfaceMod().parseSpawnFenceGroups(loopDoc!);
    expect(groups.length).toBe(EXPECTED_LEGS.length);
    for (const leg of EXPECTED_LEGS) {
      const owned = groups.filter((g) => g.tracker === leg);
      expect({ leg, count: owned.length }).toEqual({ leg, count: 1 });
    }
  });

  test("each group reconciles its own leg's verdict artifact", () => {
    const groups = surfaceMod().parseSpawnFenceGroups(loopDoc!);
    for (const leg of EXPECTED_LEGS) {
      const group = groups.find((g) => g.tracker === leg)!;
      expect({ leg, verdicts: [...group.verdictLegs] }).toEqual({
        leg,
        verdicts: [leg],
      });
    }
  });
});

// ═══════════════════════════ AC-STE-446.4 ══════════════════════════════════

describeIfSkills("AC-STE-446.4 — STE-423 leg scoping survives untouched", () => {
  test("no brace group reconciles another leg's verdict artifact", () => {
    // The scoping contract itself, stated for N legs: a group's verdict-path
    // set is exactly its own leg. Crossing legs here is what STE-423 forbids.
    const groups = surfaceMod().parseSpawnFenceGroups(loopDoc!);
    const crossed = groups
      .filter((g) => g.verdictLegs.some((leg) => leg !== g.tracker))
      .map((g) => ({ tracker: g.tracker, verdictLegs: [...g.verdictLegs] }));
    expect(crossed).toEqual([]);
  });

  test("the STE-423 test file is unmodified", () => {
    // The AC's literal words — "remain green WITHOUT modification". The suite
    // itself proves the "green" half by running; this proves the other half.
    //
    // DIFFED AGAINST THE MERGE-BASE, NOT HEAD (audit finding). `diff HEAD`
    // reads as "unmodified" only while this work is uncommitted. The moment the
    // FR is committed it degrades to "working tree clean vs HEAD", which is
    // TRUE for a modification made IN that commit — the precise case the AC
    // exists to forbid. It also carries the symmetric false-positive: any later
    // unrelated uncommitted edit to that file would turn this RED. The
    // merge-base is what the AC actually claims: untouched across this branch.
    expect(existsSync(SCOPING_TEST_SRC)).toBe(true);
    const base = git(["merge-base", "HEAD", "main"]).stdout.trim();
    expect(base).toMatch(/^[0-9a-f]{7,40}$/); // non-vacuity: the base resolved
    const r = git(["diff", "--quiet", base, "--", SCOPING_TEST_REL]);
    expect({ path: SCOPING_TEST_REL, status: r.status }).toEqual({
      path: SCOPING_TEST_REL,
      status: 0,
    });
  });

  test("the smoke-test skill grows no leg literal STE-423's scan cannot match", () => {
    // THE HAZARD. STE-423's `TRACKER_SEGMENT` alternation is
    // `<tracker>|${TRACKER}|$TRACKER|linear|jira` — it knows nothing of a
    // third leg. Any `dpt-smoke-<newleg>` literal added to the SMOKE skill
    // therefore turns AC-STE-423.4 red, and the only repair would be editing
    // that test, which this AC forbids. Conformance-loop is explicitly out of
    // STE-423's scope, so the per-leg enumeration belongs there.
    const known = new Set(["linear", "jira"]);
    const offenders = EXPECTED_LEGS.filter(
      (leg) => !known.has(leg) && smokeDoc!.includes(`dpt-smoke-${leg}`),
    );
    expect(offenders).toEqual([]);
  });

  test("every pidfile literal in the smoke-test skill stays tracker-templated", () => {
    const literals = [...smokeDoc!.matchAll(/\/tmp\/dpt-smoke-[^\s`'")]*\.pid/g)]
      .map((m) => m[0])
      .filter((lit) => !/<tracker>|\$\{TRACKER\}|\$TRACKER/.test(lit));
    expect([...new Set(literals)]).toEqual([]);
  });
});

// ═══════════════════════════ AC-STE-446.5 ══════════════════════════════════

describeIfSkills("AC-STE-446.5 — every derivation surface fails under mutation", () => {
  test("the STE-445 harness is still falsifiable against the post-change tree", () => {
    const report = runLegDerivationMutation();
    expect(report.mutationApplied).toBe(true);
    expect(report.failuresUnderMutation.length).toBeGreaterThan(0);
  });

  test("direction (i): no surface enumerates a leg outside the registered set", () => {
    // WHAT THIS USED TO ASSERT, AND WHY IT WAS REPLACED (STE-446).
    //
    // The previous body compared each surface's prose against
    // `[...EXPECTED_LEGS, SYNTHETIC_LEG]` and asserted none covered the whole
    // widened set. That CANNOT FAIL: the synthetic leg is absent from the prose
    // by construction, so `missing` always contains it and the survivor list is
    // always empty — including for a surface whose `proseLegs` returns NOTHING
    // AT ALL. MEASURED: stripping `none` from the green-probe prose turned
    // direction (ii) RED while this test stayed GREEN. It passed for an unbound
    // surface, which is the exact defect this milestone exists to remove.
    //
    // Re-aimed at the complement of direction (ii). Together the pair asserts
    // set EQUALITY between prose and enum, and each half fails on its own kind
    // of drift: (ii) catches prose that is SHORT a registered leg — the
    // widened-enum case — and this one catches prose naming a leg the enum does
    // NOT register, which is what a stale leg left behind after a removal looks
    // like. Removal is as real a drift direction as addition, and nothing else
    // in this file covered it.
    const extras = surfaceMod()
      .LEG_PROSE_SURFACES.map((surface) => ({
        id: surface.id,
        extra: legDiff(EXPECTED_LEGS, [...surface.proseLegs(docs())]).missing,
      }))
      .filter((row) => row.extra.length > 0)
      .map((row) => `${row.id}: ${JSON.stringify(row.extra)}`);
    expect(extras).toEqual([]);
  });

  test("every surface reads prose — none returns a constant", () => {
    // PER-SURFACE bind check, covering all five. The phantom-leg witness below
    // exercises only ONE surface, because each surface parses its own region
    // and an injection shaped like a findings-file line lands only in the
    // green-probe region. This test closes that gap for the other four.
    //
    // Two arms, both needed:
    //   (a) on EMPTY documents a bound surface must return nothing. A surface
    //       returning the full set here would be reporting a hardcoded constant
    //       while appearing to derive.
    //   (b) rename the leg IN THE PROSE and the surface must report the renamed
    //       token. This is what distinguishes reading the document from
    //       coincidentally agreeing with the enum.
    const real = docs();
    const renamed: LegProseDocs = {
      "conformance-loop": real["conformance-loop"].split("none").join("nOnE"),
      "smoke-test": real["smoke-test"].split("none").join("nOnE"),
    };

    const unbound: string[] = [];
    for (const surface of surfaceMod().LEG_PROSE_SURFACES) {
      const onEmpty = [...surface.proseLegs({
        "conformance-loop": "",
        "smoke-test": "",
      })];
      const afterRename = [...surface.proseLegs(renamed)];
      if (onEmpty.length !== 0 || afterRename.includes("none")) {
        unbound.push(
          `${surface.id}: onEmpty=${JSON.stringify(onEmpty)} afterRename=${JSON.stringify(afterRename)}`,
        );
      }
    }
    expect(unbound).toEqual([]);
  });

  test("falsifiability witness: an injected phantom leg IS detected", () => {
    // PERMANENT COVERAGE FOR direction (i), not a one-off probe.
    //
    // direction (i) asserts an EMPTY list, so on a healthy tree it passes
    // trivially and tells you nothing about whether it could ever fail. Its
    // predecessor passed for a surface whose `proseLegs` returned nothing at
    // all, which is exactly how an always-empty assertion hides. This test is
    // the standing witness that the predicate fires: it feeds the surfaces a
    // SYNTHETIC document carrying a leg the enum does not register and asserts
    // they report it.
    //
    // Synthetic text, never a mutated file on disk — `proseLegs` takes document
    // TEXT, so the witness needs no backup/restore dance and cannot leave the
    // working tree dirty if an assertion throws mid-test.
    // The injection must land INSIDE the region the surface parses. Appending
    // at end-of-document does NOT work — verified — because the extractors are
    // region-scoped rather than whole-file greps. That scoping is correct, and
    // it is why this witness anchors on an existing per-leg line instead.
    const PHANTOM = "phantomleg";
    const real = docs();
    const loop = real["conformance-loop"];
    const anchor = /^(HIGH_[A-Z]+=\$\(grep -c .*findings-\$\{DATE\}-[a-z]+\.md\))$/m;
    expect(loop).toMatch(anchor); // non-vacuity: the anchor still resolves
    const injected: LegProseDocs = {
      ...real,
      "conformance-loop": loop.replace(
        anchor,
        (line) =>
          `${line}\nHIGH_PHANTOM=$(grep -c pat /tmp/dpt-smoke-findings-\${DATE}-${PHANTOM}.md)`,
      ),
    };

    const flagged = surfaceMod()
      .LEG_PROSE_SURFACES.filter((surface) =>
        legDiff(EXPECTED_LEGS, [...surface.proseLegs(injected)]).missing.includes(
          PHANTOM,
        ),
      )
      .map((surface) => surface.id);

    // At least one surface must notice. If NONE does, direction (i) is inert
    // and the set-equality pair has collapsed back to a single-sided check.
    expect(flagged.length).toBeGreaterThan(0);
  });

  test("direction (ii): unmutated, no surface is short a leg", () => {
    // Without this, a surface hardwired to report a gap would look identical
    // to a working binding.
    const short = surfaceMod()
      .LEG_PROSE_SURFACES.filter(
        (surface) =>
          legDiff([...surface.proseLegs(docs())], EXPECTED_LEGS).missing.length >
          0,
      )
      .map((surface) => surface.id);
    expect(short).toEqual([]);
  });
});

// ═══════════════════════════ AC-STE-446.6 ══════════════════════════════════

const ROSTER_GUARD_TOKENS = [
  "roster_guard_widened_to_render_path",
  "roster_guard_left_at_cli_boundary",
] as const;

describe("AC-STE-446.6 — the roster-guard scope decision is recorded", () => {
  const fr = read(FR_PATH);

  /**
   * The `## Implementation notes` body.
   *
   * Section-scoped on purpose: BOTH tokens also appear in AC.6's own text
   * under § Acceptance Criteria, so a whole-file count of either can never
   * resolve to one. Same trap STE-445's plan-token probe had to sidestep.
   */
  function notesSection(): string {
    const body = fr ?? "";
    const start = body.search(/^## Implementation notes[ \t]*$/m);
    if (start < 0) return "";
    const rest = body.slice(start).replace(/^## Implementation notes[ \t]*\n/, "");
    const next = rest.search(/^## /m);
    return next < 0 ? rest : rest.slice(0, next);
  }

  test("the FR carries an Implementation notes section", () => {
    expect(fr).not.toBeNull();
    expect(notesSection().trim().length).toBeGreaterThan(0);
  });

  test("exactly one of the two decision tokens is present", () => {
    const section = notesSection();
    const present = ROSTER_GUARD_TOKENS.filter((token) =>
      section.includes(token),
    );
    expect(present.length).toBe(1);
  });

  test("the left-at-boundary form carries a reason on the same line", () => {
    const section = notesSection();
    const deferred = "roster_guard_left_at_cli_boundary";
    if (!section.includes(deferred)) {
      // The widened-to-render-path form needs no stated reason — the code
      // change is the evidence. Assert that is genuinely the recorded choice
      // rather than letting this test pass by absence.
      expect(section).toContain("roster_guard_widened_to_render_path");
      return;
    }
    const line =
      section.split(/\n/).find((l) => l.includes(deferred)) ?? "";
    const after = line.slice(line.indexOf(deferred) + deferred.length);
    // A bare token, or a token followed only by punctuation, is the
    // "inherited, not answered" outcome this AC exists to prevent.
    expect(after.replace(/[^A-Za-z0-9]/g, "").length).toBeGreaterThan(20);
  });
});

// ═══════════════════════════ AC-STE-446.7 ══════════════════════════════════

describe("AC-STE-446.7 — enum widening and roster re-pointing land atomically", () => {
  const SMOKE_LEGS_DECL_RE = /export const SMOKE_LEGS = \[([^\]]*)\] as const;/;

  /** The leg members declared by one revision's copy of the module. */
  function declaredLegs(text: string): string[] {
    const m = SMOKE_LEGS_DECL_RE.exec(text);
    if (m === null) return [];
    return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  }

  test("the working tree is past the split, not inside it", () => {
    const src = readFileSync(FIXTURE_GROUPS_SRC, "utf8");
    expect(declaredLegs(src)).toEqual(["linear", "jira", "none"]);
    expect(src).not.toContain(LEGACY_LEG_ALIAS);
    expect([...groupsCoveringLeg("none")].length).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // CROSS-COMMIT ATOMICITY IS NOT ENFORCED. THIS IS A DELIBERATE ABSENCE.
  //
  // A second arm used to live here: walk every revision of the module on this
  // branch and assert none registers a leg while still reading the second
  // hardcoded copy. It was DELETED rather than shipped, on two independent
  // grounds — either alone would disqualify it.
  //
  //   1. It goes PERMANENTLY VACUOUS once this branch merges. The range is
  //      `merge-base(HEAD, main)..HEAD`; on main that collapses to `HEAD..HEAD`
  //      and the walk passes over an empty set for the rest of the repo's life.
  //      M121 exists to eliminate assertions that cannot fail, so shipping one
  //      as part of its own implementation would be self-refuting.
  //   2. Its predicate was an IDENTIFIER PROXY, requiring the old alias to be
  //      present. A split that first renames the alias while keeping the enum
  //      two-member, then widens in a later commit, leaves a broken
  //      intermediate the walk cannot see.
  //
  // A vacuous test is worse than no test: no test is an honest absence, a
  // vacuous one is a false presence that reads as coverage. This comment is
  // the honest absence.
  //
  // WHAT MIGHT ACTUALLY WORK, for whoever picks this up: walk the MILESTONE's
  // commit set (the shas touching `specs/plan/M121.md`, or a recorded
  // kickoff..ship range) rather than a range that collapses against its own
  // merge target — and key the predicate on ROSTER COVERAGE, asserting every
  // declared leg is rostered by at least one group in that revision, rather
  // than on the presence of any particular identifier. Recorded as scope in
  // `specs/notes/follow-ups.md`.
  //
  // The working-tree invariant above is the sound half and is retained: it is
  // falsifiable on every run, and it catches the end state this AC cares about.
  // ───────────────────────────────────────────────────────────────────────
});
