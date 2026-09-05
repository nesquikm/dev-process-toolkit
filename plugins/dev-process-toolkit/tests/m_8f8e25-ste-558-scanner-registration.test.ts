// M_8f8e25 / STE-558 — "The two M143 scanners grade the tree, not just their
// own suites".
//
// WHAT THE IMPLEMENTER WRITES. Two probe wrappers, in the modules that already
// own the scanners:
//
//   adapters/_shared/src/inline_terminal_block.ts
//     export function runDrivenSuppressionAdoptionProbe(projectRoot): Report
//   adapters/_shared/src/continuation_offer.ts
//     export function runContinuationOfferAdoptionProbe(projectRoot): Report
//
// plus an `import.meta.main` front door on each, two registry rows (#84, #85),
// and the probe-count cascade 83 -> 85.
//
// THE CONTRACT THESE LEGS PIN, stated once so nothing has to be guessed. The
// shape is probe #77's / probe #83's, not a new one:
//
//   interface Violation {
//     file: string;      // the surface, repo-relative (what `note` cites)
//     line: number;      // 1-based
//     reason: string;    // the operator's words — from the SHIPPED scanner
//     note: string;      // `<repo-relative-file>:<line> — <reason>`
//     message: string;   // `<probe_id>: …` + `Remedy:` + `Context:` sub-lines
//     severity: "error";
//   }
//   interface Report { violations: Violation[]; vacuous: boolean }
//
// The wrappers RENDER; they do not re-scan. `scanDrivenSuppressionAdoption`,
// `scanContinuationOfferAdoption` and `scanDrivenClaimProse` are the shipped
// walks and stay untouched, so what their suites already prove still holds —
// which is why every leg below reads a violation's `reason` for the SHIPPED
// scanner's own words rather than for a phrase invented by the wrapper.
//
// WHY EACH LEG IS NOT A TAUTOLOGY.
//
//   * ACCESSED THROUGH `owed()`, never a named import. A named import of an
//     export that does not exist yet is a MODULE-LOAD failure, which reds every
//     leg in this file at once — including the sibling-stays-green halves that
//     are the whole point of the mutation legs.
//   * THE FRONT DOORS ARE EXECUTED, NEVER GREPPED (AC.4 says so in as many
//     words). And the load-bearing half is the FAILING run: `bun run` on a
//     module with NO `import.meta.main` block also exits 0, so a green exit
//     proves nothing. Exit 1 over a mutated tree is what proves the door is
//     there AND grades.
//   * EVERY MUTATION IS MEASURED BEFORE IT IS SCORED. A removal that silently
//     never applied reads as a pass — recorded on this repository more than
//     once — so `removeFrom`/`insertAfter` assert the body changed.
//   * EVERY MUTATION LEG CARRIES ITS SIBLING. Probe #84 redding is worth
//     nothing unless probe #85 stayed green over the same tree, and the
//     unmutated arm is asserted in the same leg (AC.6 requires exactly that).
//   * THE COUNT IS RE-DERIVED FROM THE SHIPPED REGISTRY (`liveProbeCount`),
//     never hand-typed, and the staleness half asserts 83 is GONE — a cascade
//     that only checks the new number passes on a surface carrying both.
//
// MEASURED AT b0761df + the staged STE-557 tree, so nothing below is recalled:
//
//   * 83 numbered probe registrations in skills/gate-check/SKILL.md (353 lines,
//     NFR-1 cap 358 — two registration rows fit).
//   * `scanDrivenSuppressionAdoption(REPO_ROOT)` -> [] and
//     `scanContinuationOfferAdoption(REPO_ROOT)` -> []: the tree is CLEAN, so a
//     probe that reds today is reporting the wrong thing.
//   * `skills/gate-check/SKILL.md` warns "registering probe #83 will turn probe
//     #81 red"; `ORDERED_UNREACHABLE_PIN` is 129 and the ledger has 9 entries.
//
// TWO CORRECTIONS TO THE FR, both measured, both asserted below rather than
// left for the gate to discover:
//
//   1. AC.8 says "nothing else pins that sentence". FALSE —
//      tests/m140-ste-543-external-link-verdicts.test.ts:978 pins it verbatim.
//      Repointing one and not the other is a red gate, so both are asserted.
//   2. tests/m141-ste-546-surface-agreement.test.ts:729 asserts `no 84. row was
//      registered`. Registering #84 reds it. That tripwire moves to #86 with
//      the rest of the cascade — a count-adjacent number that is NOT the count,
//      so it is asserted by name.
//
// Filter by AC with `bun test -t "AC-STE-558.N"`.

import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import * as InlineTerminalBlock from "../adapters/_shared/src/inline_terminal_block";
import { DRIVEN_SUPPRESSION_CLAUSE } from "../adapters/_shared/src/inline_terminal_block";
import * as ContinuationOfferModule from "../adapters/_shared/src/continuation_offer";
import {
  CONTINUATION_OFFERS,
  DRIVEN_OMISSION_CLAUSE,
  type ContinuationOffer,
} from "../adapters/_shared/src/continuation_offer";
import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  gradePinLedger,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";

// ---------------------------------------------------------------------------
// Paths + tiny helpers
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const README = join(REPO_ROOT, "README.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

const SUPPRESSION_MODULE_REL = "adapters/_shared/src/inline_terminal_block.ts";
const OFFER_MODULE_REL = "adapters/_shared/src/continuation_offer.ts";
const SUPPRESSION_MODULE_ABS = join(PLUGIN_ROOT, ...SUPPRESSION_MODULE_REL.split("/"));
const OFFER_MODULE_ABS = join(PLUGIN_ROOT, ...OFFER_MODULE_REL.split("/"));
const TEST_FILE_REL = "tests/m_8f8e25-ste-558-scanner-registration.test.ts";

const M140_TEST_REL = "tests/m140-ste-543-external-link-verdicts.test.ts";
const M141_AGREEMENT_TEST_REL = "tests/m141-ste-546-surface-agreement.test.ts";

const read = (path: string): string => readFileSync(path, "utf-8");

/** Repo-relative path of one adopting stage's shipped surface. */
const stageSurfaceRel = (stage: string): string =>
  `plugins/dev-process-toolkit/skills/${stage}/SKILL.md`;

// ---------------------------------------------------------------------------
// The owed exports. Accessed lazily so a missing one reds ONE leg, never the
// module load — the M143 house idiom (m143-ste-551-continuation-offers.ts:760).
// ---------------------------------------------------------------------------

/** One graded violation, in the shape probe #77 established. */
interface AdoptionViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly note: string;
  readonly message: string;
  readonly severity: string;
}

interface AdoptionReport {
  readonly violations: readonly AdoptionViolation[];
  readonly vacuous: boolean;
}

const owed = <T>(
  mod: Record<string, unknown>,
  moduleRel: string,
  name: string,
): T => {
  const value = mod[name];
  if (value === undefined) {
    throw new Error(
      `${moduleRel} does not yet export \`${name}\` — the scanner it wraps is ` +
        `read only by its own suite, so a clause dropped from a shipped ` +
        `surface reds one test file and never the gate`,
    );
  }
  return value as T;
};

const runDrivenSuppressionAdoptionProbe = (projectRoot: string): AdoptionReport =>
  owed<(root: string) => AdoptionReport>(
    InlineTerminalBlock as unknown as Record<string, unknown>,
    SUPPRESSION_MODULE_REL,
    "runDrivenSuppressionAdoptionProbe",
  )(projectRoot);

const runContinuationOfferAdoptionProbe = (projectRoot: string): AdoptionReport =>
  owed<(root: string) => AdoptionReport>(
    ContinuationOfferModule as unknown as Record<string, unknown>,
    OFFER_MODULE_REL,
    "runContinuationOfferAdoptionProbe",
  )(projectRoot);

// ---------------------------------------------------------------------------
// Fixture trees. The scanners read `plugins/dev-process-toolkit/skills/<s>/
// SKILL.md` under the root they are handed, so the fixture is a COPY of the
// shipped skills tree — a hand-built stub would grade prose this repository
// never shipped, and the mutation legs would then prove nothing about it.
// ---------------------------------------------------------------------------

interface Fixture {
  readonly root: string;
  readonly cleanup: () => void;
}

function skillsFixture(slug: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `ste558-${slug}-`));
  const dest = join(root, "plugins", "dev-process-toolkit", "skills");
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(PLUGIN_ROOT, "skills"), dest, { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const fixtureSkill = (root: string, skill: string): string =>
  join(root, "plugins", "dev-process-toolkit", "skills", skill, "SKILL.md");

/** Delete `needle`, MEASURING that the deletion applied. */
function removeFrom(path: string, needle: string): void {
  const before = read(path);
  expect(before, `${path} does not carry the clause the mutation removes`).toContain(needle);
  const after = before.split(needle).join("");
  expect(after, "the mutation did not change the surface").not.toBe(before);
  writeFileSync(path, after);
}

/** Insert `insertion` right after `anchor`, MEASURING that it applied. */
function insertAfter(path: string, anchor: string, insertion: string): void {
  const before = read(path);
  expect(before, `${path} does not carry the insertion anchor`).toContain(anchor);
  const after = before.replace(anchor, `${anchor}${insertion}`);
  expect(after, "the mutation did not change the surface").not.toBe(before);
  writeFileSync(path, after);
}

const offerOrThrow = (id: string): ContinuationOffer => {
  const offer = CONTINUATION_OFFERS.find((o) => o.id === id);
  if (offer === undefined) throw new Error(`no continuation offer registered as \`${id}\``);
  return offer;
};

/**
 * The house violation shape, asserted in ONE place so the two probes cannot
 * drift into two spellings of the same contract.
 */
function assertHouseShape(v: AdoptionViolation, expectedFileRel: string): void {
  expect(v.severity).toBe("error");
  expect(v.line).toBeGreaterThan(0);
  expect(String(v.file)).toContain(expectedFileRel);
  expect(v.reason.length).toBeGreaterThan(20);
  // `note` is `<repo-relative-file>:<line> — <reason>` (STE-82).
  expect(v.note).toBe(`${expectedFileRel}:${v.line} — ${v.reason}`);
  // `message` is the NFR-10 canonical shape: a `<probe_id>:` verdict line,
  // then `Remedy:`, then `Context:`.
  expect(v.message).toMatch(/^[a-z][a-z0-9_]*: /);
  const lines = v.message.split("\n");
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
}

// ---------------------------------------------------------------------------
// The shipped registry
// ---------------------------------------------------------------------------

/** The numbered `/gate-check` probe registrations, in order. House idiom. */
function probeRegistrationLines(): { number: number; line: string }[] {
  return read(GATE_CHECK_SKILL)
    .split("\n")
    .flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [{ number: Number(m[1]), line }];
    });
}

/** The live count, RE-DERIVED off the shipped registry — never hand-typed. */
const liveProbeCount = (): number => probeRegistrationLines().length;

/** The single registration row naming `moduleRel`. Throws if it is not unique. */
function registrationFor(moduleRel: string): { number: number; line: string } {
  const hits = probeRegistrationLines().filter((r) => r.line.includes(moduleRel));
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly ONE numbered registration naming \`${moduleRel}\`, found ` +
        `${hits.length} — an unregistered scanner grades its own suite and ` +
        `nothing else`,
    );
  }
  return hits[0]!;
}

/** The probe id the registration row declares, as `N. **\`id\`**`. */
function registeredProbeId(moduleRel: string): string {
  const { line } = registrationFor(moduleRel);
  const m = /^\d+\. \*\*`([a-z][a-z0-9_]*)`\*\*/.exec(line);
  if (m === null) {
    throw new Error(`registration row for ${moduleRel} declares no probe id: ${line}`);
  }
  return m[1]!;
}

// ===========================================================================
// AC-STE-558.1 — `inline_terminal_block` exports a probe wrapper
// ===========================================================================

describe("AC-STE-558.1 — driven-suppression adoption is a graded probe", () => {
  test("a violation carries the house shape, severity travelling per violation", () => {
    const fx = skillsFixture("ac1-shape");
    try {
      removeFrom(fixtureSkill(fx.root, "gate-check"), DRIVEN_SUPPRESSION_CLAUSE);
      const report = runDrivenSuppressionAdoptionProbe(fx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      assertHouseShape(v, stageSurfaceRel("gate-check"));
      // The SHIPPED scanner's words, not the wrapper's: the wrapper renders,
      // it does not re-derive why the surface is delinquent.
      expect(v.reason).toContain("documents no driven branch");
      expect(v.reason).toContain("gate-check");
    } finally {
      fx.cleanup();
    }
  });

  test("VACUOUS when the plugin tree is absent — a consumer project never fails on it", () => {
    const root = mkdtempSync(join(tmpdir(), "ste558-ac1-empty-"));
    try {
      expect(existsSync(join(root, "plugins"))).toBe(false);
      const report = runDrivenSuppressionAdoptionProbe(root);
      expect(report.violations).toEqual([]);
      expect(report.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("`vacuous` is a MEASURED state — the shipped tree is graded and CLEAN", () => {
    const report = runDrivenSuppressionAdoptionProbe(REPO_ROOT);
    // Without this control, `vacuous: true` above is satisfied by a probe that
    // scans nothing anywhere.
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-558.2 — `continuation_offer` covers BOTH of its scanners
// ===========================================================================

/**
 * An affirmative order, inserted into an offer's driven-clause paragraph. The
 * step is named as a `/token` so `scanDrivenClaimProse` can match it against
 * the chain, and the sentence carries no governing negation.
 */
const ORDER_SPEC_WRITE =
  " Chain straight into `/spec-write` in the same turn, exactly as on `y`.";
const ORDER_SHIP_MILESTONE =
  " Chain straight into `/ship-milestone M<N>` in the same turn, exactly as on `y`.";

describe("AC-STE-558.2 — the offer probe grades adoption AND driven-claim prose", () => {
  test("HALF ONE — a clause missing from an offer's span is reported, by offer id", () => {
    const fx = skillsFixture("ac2-adoption");
    try {
      expect(runContinuationOfferAdoptionProbe(fx.root).violations).toEqual([]);
      removeFrom(fixtureSkill(fx.root, "spec-archive"), DRIVEN_OMISSION_CLAUSE);

      const report = runContinuationOfferAdoptionProbe(fx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      assertHouseShape(v, offerOrThrow("spec_archive_next").file);
      expect(v.reason).toContain("spec_archive_next");
      expect(v.reason).toContain("documents no driven branch");
    } finally {
      fx.cleanup();
    }
  });

  test("HALF TWO — a clause that still ORDERS the step is reported, by offer id", () => {
    // A reworded clause and a clause that still orders the step are different
    // defects with different remedies; either scanner alone leaves half the
    // surface ungraded, which is the whole of AC.2.
    const fx = skillsFixture("ac2-prose");
    try {
      insertAfter(
        fixtureSkill(fx.root, "spec-archive"),
        DRIVEN_OMISSION_CLAUSE,
        ORDER_SPEC_WRITE,
      );
      const report = runContinuationOfferAdoptionProbe(fx.root);
      expect(report.violations.length).toBe(1);
      const v = report.violations[0]!;
      assertHouseShape(v, offerOrThrow("spec_archive_next").file);
      expect(v.reason).toContain("spec_archive_next");
      // The prose half's own words — NOT "documents no driven branch", which
      // would mean the adoption scanner reported it and the claim scanner is
      // unwired.
      expect(v.reason).toContain("orders the surface to perform");
      expect(v.reason).toContain("/spec-write");
    } finally {
      fx.cleanup();
    }
  });

  test("the chain steps are the SHIPPED ones — `/ship-milestone` is graded too", () => {
    // `deliverInlinePhaseSteps` alone yields only `/brainstorm` + `/spec-write`.
    // The step whose double-run motivated M143 is `/ship-milestone`, which is
    // named by the FR-scoped and milestone-scoped `resumeChain`s. A probe whose
    // chain list stops at `/deliver`'s two inline phases cannot see it, and
    // would report the worst case clean. The derivation is the M143 suite's
    // `shippedChainSteps()` (m143-ste-551-continuation-offers.test.ts:870).
    const fx = skillsFixture("ac2-shipchain");
    try {
      insertAfter(
        fixtureSkill(fx.root, "spec-archive"),
        DRIVEN_OMISSION_CLAUSE,
        ORDER_SHIP_MILESTONE,
      );
      const report = runContinuationOfferAdoptionProbe(fx.root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.reason).toContain("/ship-milestone");
    } finally {
      fx.cleanup();
    }
  });

  test("VACUOUS on an absent plugin tree, and it does NOT throw", () => {
    // `deliverInlinePhaseSteps` THROWS when `/deliver`'s surface is missing —
    // deliberately, so a caller cannot go quietly vacuous. A probe that let
    // that escape would crash the gate in every consumer project.
    const root = mkdtempSync(join(tmpdir(), "ste558-ac2-empty-"));
    try {
      const report = runContinuationOfferAdoptionProbe(root);
      expect(report.violations).toEqual([]);
      expect(report.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("`vacuous` is a MEASURED state — the shipped tree is graded and CLEAN", () => {
    const report = runContinuationOfferAdoptionProbe(REPO_ROOT);
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-558.3 — registered as probes #84 and #85, in the house idiom
// ===========================================================================

describe("AC-STE-558.3 — both scanners are numbered registrations", () => {
  test("the registry is contiguous 1..85", () => {
    const registrations = probeRegistrationLines();
    expect(liveProbeCount()).toBe(85);
    expect(registrations.map((r) => r.number)).toEqual(
      Array.from({ length: 85 }, (_, i) => i + 1),
    );
  });

  test("probe #84 registers the driven-suppression wrapper, in the house idiom", () => {
    const row = registrationFor(SUPPRESSION_MODULE_REL);
    expect(row.number).toBe(84);
    expect(row.line).toContain("runDrivenSuppressionAdoptionProbe(projectRoot)");
    expect(row.line).toContain("**Severity: error**");
    expect(row.line).toContain(SUPPRESSION_MODULE_REL);
    // What it grades, and its vacuity — the two halves a reader needs before
    // they can act on a red.
    expect(row.line).toContain("scanDrivenSuppressionAdoption");
    expect(row.line).toContain("vacuous");
    expect(row.line).toContain(TEST_FILE_REL);
  });

  test("probe #85 registers the offer wrapper and names BOTH scanners", () => {
    const row = registrationFor(OFFER_MODULE_REL);
    expect(row.number).toBe(85);
    expect(row.line).toContain("runContinuationOfferAdoptionProbe(projectRoot)");
    expect(row.line).toContain("**Severity: error**");
    expect(row.line).toContain(OFFER_MODULE_REL);
    // BOTH, by name: a registration naming one scanner describes half the
    // subject, and a reader following a red would open the wrong surface.
    expect(row.line).toContain("scanContinuationOfferAdoption");
    expect(row.line).toContain("scanDrivenClaimProse");
    expect(row.line).toContain("vacuous");
    expect(row.line).toContain(TEST_FILE_REL);
  });

  test("each registration's probe id is the one its messages carry", () => {
    // A registration whose id disagrees with the emitted message sends a
    // reader grepping for a probe that never speaks.
    const suppressionId = registeredProbeId(SUPPRESSION_MODULE_REL);
    const offerId = registeredProbeId(OFFER_MODULE_REL);
    expect(suppressionId).not.toBe(offerId);

    const fx = skillsFixture("ac3-ids");
    try {
      removeFrom(fixtureSkill(fx.root, "gate-check"), DRIVEN_SUPPRESSION_CLAUSE);
      removeFrom(fixtureSkill(fx.root, "spec-archive"), DRIVEN_OMISSION_CLAUSE);

      const suppression = runDrivenSuppressionAdoptionProbe(fx.root);
      expect(suppression.violations.length).toBe(1);
      expect(suppression.violations[0]!.message.startsWith(`${suppressionId}: `)).toBe(true);
      expect(suppression.violations[0]!.message).toContain(`probe=${suppressionId}`);

      const offers = runContinuationOfferAdoptionProbe(fx.root);
      expect(offers.violations.length).toBe(1);
      expect(offers.violations[0]!.message.startsWith(`${offerId}: `)).toBe(true);
      expect(offers.violations[0]!.message).toContain(`probe=${offerId}`);
    } finally {
      fx.cleanup();
    }
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (358)", () => {
    const SKILL_LINE_CAP = 358;
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});

// ===========================================================================
// AC-STE-558.4 — front doors, EXECUTED; and the reachability record
// ===========================================================================

interface DoorRun {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Execute a module's command-line entry point over `projectRoot`. */
function runFrontDoor(moduleAbs: string, projectRoot: string): DoorRun {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", moduleAbs, projectRoot],
    cwd: PLUGIN_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: `${proc.stdout.toString()}${proc.stderr.toString()}`,
  };
}

describe("AC-STE-558.4 — each registration is an order a reader can carry out", () => {
  test(
    "the driven-suppression front door RUNS and reports: exit 1 over a mutated tree",
    () => {
      // THE LOAD-BEARING HALF. `bun run` on a module with no `import.meta.main`
      // block also exits 0, so a green exit proves nothing at all; a non-zero
      // exit can only come from a door that ran and graded.
      const fx = skillsFixture("ac4-suppression");
      try {
        removeFrom(fixtureSkill(fx.root, "gate-check"), DRIVEN_SUPPRESSION_CLAUSE);
        const run = runFrontDoor(SUPPRESSION_MODULE_ABS, fx.root);
        expect(run.exitCode).toBe(1);
        expect(run.stdout).toContain(stageSurfaceRel("gate-check"));
      } finally {
        fx.cleanup();
      }
    },
    180_000,
  );

  test(
    "the offer front door RUNS and reports: exit 1 over a mutated tree",
    () => {
      const fx = skillsFixture("ac4-offer");
      try {
        removeFrom(fixtureSkill(fx.root, "spec-archive"), DRIVEN_OMISSION_CLAUSE);
        const run = runFrontDoor(OFFER_MODULE_ABS, fx.root);
        expect(run.exitCode).toBe(1);
        expect(run.stdout).toContain("spec_archive_next");
      } finally {
        fx.cleanup();
      }
    },
    180_000,
  );

  test(
    "both front doors exit 0 over THIS repository — the state they ship in",
    () => {
      expect(runFrontDoor(SUPPRESSION_MODULE_ABS, REPO_ROOT).exitCode).toBe(0);
      expect(runFrontDoor(OFFER_MODULE_ABS, REPO_ROOT).exitCode).toBe(0);
    },
    180_000,
  );

  test("every reference to either module is REACHABLE", async () => {
    // `runModuleReachabilityProbe` is async — an unawaited Promise makes any
    // assertion on `.records` pass vacuously.
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    for (const moduleRel of [SUPPRESSION_MODULE_REL, OFFER_MODULE_REL]) {
      const records = report.records.filter((r) => r.module.includes(moduleRel));
      // ANTI-VACUITY: the registration row itself is a reference, so a zero
      // here means the walk never saw the registration this FR adds.
      expect(records.length, `no shipped surface references ${moduleRel}`).toBeGreaterThan(0);
      expect(
        records.filter((r) => !r.reachable),
        `${moduleRel} is ordered by a registration nobody can carry out`,
      ).toEqual([]);
    }
  });
});

// ===========================================================================
// AC-STE-558.5 — the probe-count cascade, edited BY SUBJECT and never by digit
// ===========================================================================

/** The count these pins read BEFORE probes #84 and #85 — the number that must be gone. */
const STALE_PROBE_COUNT = 83;
/** The count after this FR registers both scanners. */
const NEW_PROBE_COUNT = 85;

/**
 * Every surface carrying the probe count, as `[plugin-relative-or-README path,
 * template]`. `{N}` is the count. M140's table, verbatim, plus the rows for
 * M140's and M141's OWN suites that nothing previously pinned.
 */
const PINS: readonly (readonly [string, string])[] = [
  ["README.md", "{N} numbered `/gate-check` probes"],
  ["README.md", String.raw`layers {N} probes`],

  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],

  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`README documents {N} probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`documents {N} numbered /gate-check probes`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-claudemd-probe-managed-guard.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/gate-check-public-surface-count-drift.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/gate-check-runnability-declared.test.ts", String.raw`contiguous 1..{N}`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/gate-check-runnability-declared.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`"{N} numbered"`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`layers {N} probes`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Number(counted![1])).toBe({N});`],

  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-upgrade-staleness.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m108-ste-393-docs-pins.test.ts", String.raw`layers {N} probes`],

  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`"{N} numbered"`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`toBe({N})`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b\\s+probes`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b.*numbered`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\\b{N}\\b\\s+numbered`],

  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`layers {N} probes`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m115-ste-417-docs-pins.test.ts", String.raw`expect(numbers.length).toBe({N});`],

  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`exactly {N} probes`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m116-ste-424-short-ulid-collision.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b.*numbered`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`\b{N}\b\s+probes`],

  ["tests/m137-ste-534-fr-word-caps.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-534-fr-word-caps.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-535-plan-narrative-cap.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-535-plan-narrative-cap.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],

  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`expect(live).toBe({N});`],

  // M140's own cascade table, which nothing previously pinned.
  [M140_TEST_REL, String.raw`const NEW_PROBE_COUNT = {N};`],
  [M140_TEST_REL, String.raw`contiguous 1..{N}`],

  // M141's agreement suite, which nothing previously pinned either.
  [M141_AGREEMENT_TEST_REL, String.raw`contiguous 1..{N}`],
  [M141_AGREEMENT_TEST_REL, String.raw`).toBe({N});`],
  [M141_AGREEMENT_TEST_REL, String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
] as const;

const fill = (template: string, n: number): string =>
  template.split("{N}").join(String(n));

const surfaceAbs = (rel: string): string =>
  rel === "README.md" ? README : join(PLUGIN_ROOT, ...rel.split("/"));

const surfaceBody = (rel: string): string => read(surfaceAbs(rel));

/** LOCAL copy of the unexported `onlyLine` helper — copied privately in six suites. */
function onlyLine(body: string, anchor: RegExp): { line: string; number: number } {
  const hits = body
    .split("\n")
    .map((line, i) => ({ line, number: i + 1 }))
    .filter((h) => anchor.test(h.line));
  if (hits.length !== 1) {
    throw new Error(`expected exactly 1 line matching ${anchor}, found ${hits.length}`);
  }
  return hits[0]!;
}

describe("AC-STE-558.5 — the probe-count cascade moved as one", () => {
  test("the live count is 85 and the numbers are contiguous 1..85", () => {
    expect(liveProbeCount()).toBe(NEW_PROBE_COUNT);
    expect(probeRegistrationLines().map((r) => r.number)).toEqual(
      Array.from({ length: NEW_PROBE_COUNT }, (_, i) => i + 1),
    );
  });

  test("EVERY enumerated pin reads the LIVE count — and none still reads 83", () => {
    const live = liveProbeCount();
    const missing: string[] = [];
    const stale: string[] = [];
    for (const [rel, template] of PINS) {
      const body = surfaceBody(rel);
      if (!body.includes(fill(template, live))) {
        missing.push(`${rel} — ${fill(template, live)}`);
      }
      if (body.includes(fill(template, STALE_PROBE_COUNT))) {
        stale.push(`${rel} — ${fill(template, STALE_PROBE_COUNT)}`);
      }
    }
    // ANTI-VACUITY: an empty table reports a clean cascade by moving nothing.
    expect(PINS.length).toBeGreaterThanOrEqual(50);
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("every named surface EXISTS — a pin on a deleted file is not a pin", () => {
    for (const [rel] of PINS) {
      expect({ rel, exists: existsSync(surfaceAbs(rel)) }).toEqual({ rel, exists: true });
    }
  });

  test("README's TWO pins read 85, each on its own unique measured line", () => {
    const readme = read(README);
    expect(onlyLine(readme, /numbered `\/gate-check` probes/).line).toContain(
      `${NEW_PROBE_COUNT} numbered \`/gate-check\` probes`,
    );
    expect(onlyLine(readme, /which layers \d+ probes on top/).line).toContain(
      `layers ${NEW_PROBE_COUNT} probes`,
    );
  });

  test("M141's `no NEXT row` tripwire moved to #86 — a count-adjacent number", () => {
    // Registering #84 reds this leg where it stands. It is not the count, so
    // it is repointed by NAME rather than swept along with the digits.
    const body = surfaceBody(M141_AGREEMENT_TEST_REL);
    expect(body).toContain(String.raw`/^${NEW_PROBE_COUNT + 1}\. \*\*/m`);
    expect(body).not.toContain(String.raw`/^84\. \*\*/m`);
    expect(body).not.toContain("no `84.` row was registered");
  });

  test("ISOLATING HALF: deliberately frozen NON-probe numbers survive the cascade", () => {
    // Proof the edit was by subject, not by digit.
    const adoption = surfaceBody("tests/m137-ste-533-stage-block-adoption.test.ts");
    // `stage_block_adoption`'s OWN probe number, not a count.
    expect(adoption).toContain("expect(mine[0]!.number).toBe(82);");
    expect(adoption).not.toContain("expect(mine[0]!.number).toBe(85);");

    const retirement = surfaceBody("tests/gate-check-active-plan-ship-ready.test.ts");
    expect(retirement).toContain("`74 numbered`");

    const drift = surfaceBody("tests/gate-check-public-surface-count-drift.test.ts");
    expect(drift).toContain("42 numbered `/gate-check` probes");

    const wordCaps = surfaceBody("tests/m137-ste-534-fr-word-caps.test.ts");
    // An 81-WORD count, not a probe count.
    expect(wordCaps).toContain('expect(countWords(overBody.join("\\n"))).toBe(81);');
  });
});

// ===========================================================================
// AC-STE-558.6 — a removed clause is a GATE error, not merely a test failure
// ===========================================================================

describe("AC-STE-558.6 — a clause removed from a driven-path surface reds the gate", () => {
  test("removing the driven-SUPPRESSION clause reds #84 and leaves #85 GREEN", () => {
    const fx = skillsFixture("ac6-suppression");
    try {
      // THE UNMUTATED ARM, in the same leg: without it, "one violation after"
      // is satisfied by a probe that reports one violation always.
      expect(runDrivenSuppressionAdoptionProbe(fx.root).violations).toEqual([]);
      expect(runContinuationOfferAdoptionProbe(fx.root).violations).toEqual([]);

      removeFrom(fixtureSkill(fx.root, "implement"), DRIVEN_SUPPRESSION_CLAUSE);

      const suppression = runDrivenSuppressionAdoptionProbe(fx.root);
      expect(suppression.violations.length).toBe(1);
      expect(suppression.violations[0]!.severity).toBe("error");
      expect(suppression.violations[0]!.note).toContain(stageSurfaceRel("implement"));
      expect(suppression.violations[0]!.reason).toContain("implement");

      // ISOLATION: the two clauses are byte-disjoint in both directions, so
      // the sibling probe must be untouched. A shared substring would make
      // both counts meaningless.
      expect(runContinuationOfferAdoptionProbe(fx.root).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("removing the driven-OMISSION clause reds #85 and leaves #84 GREEN", () => {
    const fx = skillsFixture("ac6-omission");
    try {
      expect(runDrivenSuppressionAdoptionProbe(fx.root).violations).toEqual([]);
      expect(runContinuationOfferAdoptionProbe(fx.root).violations).toEqual([]);

      removeFrom(fixtureSkill(fx.root, "spec-archive"), DRIVEN_OMISSION_CLAUSE);

      const offers = runContinuationOfferAdoptionProbe(fx.root);
      expect(offers.violations.length).toBe(1);
      expect(offers.violations[0]!.severity).toBe("error");
      expect(offers.violations[0]!.reason).toContain("spec_archive_next");
      expect(offers.violations[0]!.note).toContain(offerOrThrow("spec_archive_next").file);

      expect(runDrivenSuppressionAdoptionProbe(fx.root).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("SPAN-SCOPED: a file with TWO offers loses only the one it was cut from", () => {
    // `/implement` owns two closes. A file-level `includes` reports the
    // half-adopted case as compliant, which is the regression the span scanner
    // exists against — and the reason the violation must name an OFFER.
    const fx = skillsFixture("ac6-span");
    try {
      const surface = fixtureSkill(fx.root, "implement");
      const shipReady = offerOrThrow("implement_ship_ready_close");
      const body = read(surface);
      const anchorAt = body.indexOf(shipReady.anchor);
      expect(anchorAt).toBeGreaterThanOrEqual(0);
      const clauseAt = body.indexOf(DRIVEN_OMISSION_CLAUSE, anchorAt);
      expect(clauseAt).toBeGreaterThan(anchorAt);
      writeFileSync(
        surface,
        body.slice(0, clauseAt) + body.slice(clauseAt + DRIVEN_OMISSION_CLAUSE.length),
      );
      expect(read(surface)).not.toBe(body);

      const offers = runContinuationOfferAdoptionProbe(fx.root);
      expect(offers.violations.length).toBe(1);
      expect(offers.violations[0]!.reason).toContain("implement_ship_ready_close");
      expect(offers.violations[0]!.reason).not.toContain("implement_phase5_close");
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-558.7 — the reachability pin does not RISE
// ===========================================================================

/** The pin, and the ledger's length, as they stood entering STE-558. */
const PIN_ENTERING_STE558 = 129;
const LEDGER_LENGTH_ENTERING = 9;
/** The nine recorded moves entering STE-558, newest first. Frozen history. */
const FROZEN_LEDGER_VALUES: readonly number[] = [
  129, 130, 131, 133, 136, 137, 139, 142, 146,
];

describe("AC-STE-558.7 — the pin moved at most once, and only downward", () => {
  test("the pin is at or below where it stood, and the frozen history survives", () => {
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThanOrEqual(PIN_ENTERING_STE558);
    const values = ORDERED_UNREACHABLE_PIN_LEDGER.map((m) => m.value);
    // AT MOST ONE new entry: a change that moved the pin twice, or rewrote
    // history to make a raise look like a lowering, fails here.
    expect(values.length).toBeGreaterThanOrEqual(LEDGER_LENGTH_ENTERING);
    expect(values.length).toBeLessThanOrEqual(LEDGER_LENGTH_ENTERING + 1);
    expect(values.slice(values.length - LEDGER_LENGTH_ENTERING)).toEqual([
      ...FROZEN_LEDGER_VALUES,
    ]);
  });

  test("if the pin moved, the move is a LOWERING carrying its own reason", () => {
    const ledger = ORDERED_UNREACHABLE_PIN_LEDGER;
    if (ledger.length === LEDGER_LENGTH_ENTERING) {
      expect(ORDERED_UNREACHABLE_PIN).toBe(PIN_ENTERING_STE558);
      return;
    }
    const head = ledger[0]!;
    expect(head.value).toBeLessThan(PIN_ENTERING_STE558);
    expect(head.commit.trim().length).toBeGreaterThan(0);
    expect(head.rationale.trim().length).toBeGreaterThan(20);
    expect(ORDERED_UNREACHABLE_PIN).toBe(head.value);
  });

  test("the ledger grades clean, and the PROBE actually RAN at the pinned count", async () => {
    expect(gradePinLedger(ORDERED_UNREACHABLE_PIN_LEDGER)).toEqual({ ok: true, refusals: [] });
    // BOTH halves: the pin alone is satisfied by a probe that never ran.
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    // Anti-vacuity: the walk really found references to classify.
    expect(report.records.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-558.8 — the standing warning names the NEXT unregistered number
// ===========================================================================

describe("AC-STE-558.8 — the front-door warning no longer describes a landed registration", () => {
  test("it names the next unregistered number, DERIVED from the live registry", () => {
    const skill = read(GATE_CHECK_SKILL);
    const next = liveProbeCount() + 1;
    expect(skill).toContain(`registering probe #${next} will turn probe #81 red`);
    expect(skill).not.toContain("registering probe #83 will turn probe #81 red");
    expect(skill).not.toContain("registering probe #84 will turn probe #81 red");
  });

  test("the two sanctioned resolutions are stated unchanged", () => {
    const skill = read(GATE_CHECK_SKILL);
    expect(skill).toContain("The two sanctioned resolutions are to give the new probe's module an `import.meta.main` entry");
    expect(skill).toContain("without ordering the reader to run it by hand");
    // The disclosure that probe #81 is in the class it counts stays too.
    expect(skill).toContain("the probe is in the class it counts");
  });

  test("CORRECTION TO THE FR — the M140 suite pins that sentence too, and moved with it", () => {
    // AC.8 asserts "nothing else pins that sentence". Measured FALSE:
    // tests/m140-ste-543-external-link-verdicts.test.ts:978 pins it verbatim,
    // so repointing one and not the other is a red gate.
    const body = surfaceBody(M140_TEST_REL);
    const next = liveProbeCount() + 1;
    expect(body).toContain(`registering probe #${next} will turn probe #81 red`);
    expect(body).not.toContain("registering probe #83 will turn probe #81 red");
  });
});

// ===========================================================================
// AC-STE-558.9 — falsifiability
// ===========================================================================

/**
 * Every `test(...)` / `describe(...)` title in the suite, by file.
 *
 * Titles only — a comment recording history is not a claim the suite makes,
 * and the AC.10 sweep's comment-blindness rationale applies here verbatim.
 */
const ONE_TITLE_PER_LINE: ReadonlyArray<{ file: string; titles: string[] }> = (() => {
  const out: Array<{ file: string; titles: string[] }> = [];
  for (const abs of readdirSync(join(PLUGIN_ROOT, "tests"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(PLUGIN_ROOT, "tests", f))) {
    const titles = [...read(abs).matchAll(/^\s*(?:test|describe)\(\s*"([^"]+)"/gm)].map(
      (m) => m[1]!,
    );
    if (titles.length > 0) out.push({ file: relative(PLUGIN_ROOT, abs), titles });
  }
  return out;
})();

/**
 * Does this title CLAIM something about the probe count? A title naming probe
 * #83 as an id, or carrying a tracker id like `AC-STE-83.1`, does not.
 */
const COUNT_SUBJECT =
  /\b(?:count|counts|numbered|probes|contiguous|highest|advertises|list ends)\b/i;

/**
 * A title whose SUBJECT is the old count's ABSENCE is not stale — it is the
 * staleness check itself, and forbidding it would forbid guarding staleness.
 * A real distinction, not a carve-out for this file: any suite may legitimately
 * assert that a superseded number is gone.
 */
const ASSERTS_ABSENCE = /\b(?:none still reads|is absent|absent from|no longer|superseded|not\s)\b/i;

describe("AC-STE-558.9 — the mutations really apply, and the old count is gone", () => {
  test("each graded clause is present in the pristine fixture — the mutant differs", () => {
    // A removal that never applied reads as a pass. Measured here once, for
    // both clauses, so every leg above scores a mutant that really is one.
    const fx = skillsFixture("ac9-applied");
    try {
      const suppressionSurface = fixtureSkill(fx.root, "implement");
      const omissionSurface = fixtureSkill(fx.root, "spec-archive");
      const beforeSuppression = read(suppressionSurface);
      const beforeOmission = read(omissionSurface);
      expect(beforeSuppression).toContain(DRIVEN_SUPPRESSION_CLAUSE);
      expect(beforeOmission).toContain(DRIVEN_OMISSION_CLAUSE);

      removeFrom(suppressionSurface, DRIVEN_SUPPRESSION_CLAUSE);
      removeFrom(omissionSurface, DRIVEN_OMISSION_CLAUSE);
      expect(read(suppressionSurface)).not.toContain(DRIVEN_SUPPRESSION_CLAUSE);
      expect(read(omissionSurface)).not.toContain(DRIVEN_OMISSION_CLAUSE);

      // And the two clauses are byte-disjoint IN BOTH DIRECTIONS, which is
      // what makes "the sibling stayed green" mean anything.
      expect(DRIVEN_SUPPRESSION_CLAUSE).not.toContain(DRIVEN_OMISSION_CLAUSE);
      expect(DRIVEN_OMISSION_CLAUSE).not.toContain(DRIVEN_SUPPRESSION_CLAUSE);
    } finally {
      fx.cleanup();
    }
  });

  test("EVERY cascade table's staleness half is LIVE — none frozen at a dead number", () => {
    // A cascade table guards "the old count is gone". Frozen at a
    // doubly-superseded number, that half can never fail again — M140 named
    // this defect, repaired M137's copy, and then its OWN copy went dead when
    // this FR moved the count past it. Three tables now exist; a leg that
    // checked only the newest would repeat the fix-only-the-clause-you-name
    // shape that produced the problem.
    const live = liveProbeCount();
    const declared: Array<{ file: string; value: number }> = [];
    for (const entry of readdirSync(join(PLUGIN_ROOT, "tests")).filter((f) => f.endsWith(".ts"))) {
      const abs = join(PLUGIN_ROOT, "tests", entry);
      // ANCHORED at line start: m140 asserts on the STRING form of this
      // declaration, and an unanchored match would count those quoted copies
      // as tables — reporting 7 where there are 3.
      for (const m of read(abs).matchAll(/^const STALE_PROBE_COUNT = (\d+);/gm)) {
        declared.push({ file: entry, value: Number(m[1]) });
      }
    }
    expect(declared.length, "no cascade table found — this leg would pass on an empty tree").toBe(3);
    expect(
      declared.filter((d) => d.value !== STALE_PROBE_COUNT).map((d) => `${d.file} = ${d.value}`),
      `a staleness half is frozen below the count it must exclude (live ${live}, ` +
        `previous ${STALE_PROBE_COUNT}) — it can no longer fail`,
    ).toEqual([]);
    // Non-vacuity of the constant itself: it must name a REAL previous count.
    expect(STALE_PROBE_COUNT).toBe(live - 2);
  });

  test("TITLES moved with their assertions — a half-rewritten title is a half-fix", () => {
    // THE OWN-DEFECT LEG. AC.10 forbids a cap pin whose TITLE names a
    // superseded number; the probe-count cascade had no such guard, so it
    // moved assertions and left titles behind. The sharpest instance was
    // `tests/m140-ste-543-external-link-verdicts.test.ts:889` reading "the
    // live count is 83 and the numbers are contiguous 1..85" — the PINS
    // template `contiguous 1..{N}` matched INSIDE the title string and
    // rewrote half of it.
    //
    // BY SUBJECT, never by digit: `tests/ship-milestone-remedy-shape.test.ts`
    // carries five `AC-STE-83.*` describe titles. Those are TRACKER IDS. A
    // sweep that could not tell them from a count would corrupt all five,
    // which is the failure this leg exists to prevent, not to cause.
    const stale = ONE_TITLE_PER_LINE.flatMap(({ file, titles }) =>
      titles
        .filter(
          (t) =>
            COUNT_SUBJECT.test(t) &&
            !ASSERTS_ABSENCE.test(t) &&
            /(?<![\d.-])83(?![\d.])/.test(t),
        )
        .map((t) => `${file} — ${t}`),
    );
    expect(
      stale,
      "a test title still states the superseded probe count while its assertion reads the live one",
    ).toEqual([]);

    // Non-vacuity: the collector really sees titles, and really sees the
    // tracker-id titles it must NOT flag.
    const all = ONE_TITLE_PER_LINE.flatMap((f) => f.titles);
    expect(all.length, "no titles collected — this leg would pass on an empty tree").toBeGreaterThan(
      400,
    );
    const trackerIds = ONE_TITLE_PER_LINE.find((f) =>
      f.file.endsWith("ship-milestone-remedy-shape.test.ts"),
    );
    expect(trackerIds, "the tracker-id control file vanished").toBeDefined();
    expect(
      trackerIds!.titles.filter((t) => /AC-STE-83\./.test(t)).length,
      "the AC-STE-83.* tracker ids were edited away by a digit sweep",
    ).toBe(5);
  });

  test("the STALENESS half: 83 is absent from every pinned surface", () => {
    // The `missing` half alone passes on a surface carrying BOTH numbers.
    const stale: string[] = [];
    for (const [rel, template] of PINS) {
      if (surfaceBody(rel).includes(fill(template, STALE_PROBE_COUNT))) {
        stale.push(`${rel} — ${fill(template, STALE_PROBE_COUNT)}`);
      }
    }
    expect(stale).toEqual([]);
    expect(STALE_PROBE_COUNT).toBeLessThan(NEW_PROBE_COUNT);
  });

  test("this suite's own file is the one the registrations name", () => {
    // A registration pointing at a test file that does not exist is an order
    // a reader cannot carry out.
    expect(existsSync(join(PLUGIN_ROOT, ...TEST_FILE_REL.split("/")))).toBe(true);
  });
});

// ===========================================================================
// AC-STE-558.10 — no suite pins a SKILL.md line cap to a number the NFR-1
// contract does not set
// ===========================================================================
//
// The guard is a DERIVED SWEEP over `tests/`, deliberately NOT the list of the
// five sites the FR names. MEASURED while writing it, which is the whole
// argument for the shape:
//
//   * the enumeration was ALREADY incomplete —
//     `tests/m141-ste-546-corrections.test.ts:595` is a SIXTH 354 pin, under a
//     test titled "the NFR-1 line cap still holds", that no list mentions;
//   * three more pin a SKILL.md cap at a number NFR-1 does not set —
//     `tests/docs-skill-shape.test.ts` and `tests/ship-milestone-shape.test.ts`
//     at 300 beneath describes that call it the NFR-1 budget, and
//     `tests/spec-write-preamble-reconcile.test.ts` at 360, which is LOOSER
//     than the contract and so is a hole rather than a false red. Both
//     directions are the same defect: the pin's number is not the NFR's.
//
// A guard aimed at five named files would leave four standing — which is
// exactly how these survived M140/STE-543, a fix aimed at this defect that
// repointed its own copy and no other.
//
// The sweep grades ASSERTIONS, never comments. The files that record the
// 351 → 352 → 354 → 358 history in prose must stay green: a guard that cannot
// tell a live pin from a historical note forbids recording what was fixed.

const TESTS_DIR = join(PLUGIN_ROOT, "tests");
const NFR1_TEST_NAME = "skill-nfr-1-length.test.ts";
const REQUIREMENTS_MD = join(REPO_ROOT, "specs", "requirements.md");

/** The ONE NFR-1 cap, read off the suite that enforces it — never typed here. */
function nfr1Cap(): number {
  const m = /const SKILL_LINE_CAP = (\d+);/.exec(read(join(TESTS_DIR, NFR1_TEST_NAME)));
  if (m === null) {
    throw new Error(`tests/${NFR1_TEST_NAME} no longer declares the one NFR-1 cap`);
  }
  return Number(m[1]);
}

/**
 * A source's lines with every COMMENT blanked — line, trailing and block. This
 * is what makes the sweep gradeable: a note recording the superseded value is
 * not a pin, and forbidding such notes would forbid recording the fix.
 */
function liveLines(src: string): string[] {
  let inBlock = false;
  return src.split("\n").map((raw) => {
    const trimmed = raw.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return "";
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      return "";
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return "";
    return raw.split(" //")[0]!;
  });
}

interface CapPin {
  readonly file: string;
  readonly line: number;
  readonly cap: number;
  readonly title: string;
  readonly source: string;
}

/** The subject: this pin is about a shipped SKILL.md, not some other budget. */
const SKILL_SUBJECT = /SKILL\.md|SKILL_PATH|skillPath|readSkill|skillBody|[A-Z0-9_]*_SKILL\b|skill\(\)/;
/** The measurement: a LINE count, not a token/entry/word count. */
const LINE_MEASURE = /lineCount|LINE_CAP|\blines\b|split\("\\n"\)\.length/;
const CAP_ASSERTION = /toBeLessThanOrEqual\(\s*(\d+)\s*\)/;
const CAP_DECLARATION = /\bconst\s+([A-Za-z0-9_]*LINE_CAP)\s*=\s*(\d+)\s*;/;
const TEST_TITLE = /^\s*(?:test|it)(?:\.[A-Za-z]+(?:\([^)]*\))?)?\(\s*[`"]([^`"]*)/;

/** Every live SKILL.md line-cap pin in one test source, with its own title. */
function skillCapPins(fileRel: string, src: string): CapPin[] {
  const live = liveLines(src);
  const pins: CapPin[] = [];
  live.forEach((line, i) => {
    const declared = CAP_DECLARATION.exec(line);
    const asserted = CAP_ASSERTION.exec(line);
    let cap: number | null = null;
    if (declared !== null) {
      const scope = live.slice(Math.max(0, i - 3), i + 12).join("\n");
      if (SKILL_SUBJECT.test(declared[1]!) || SKILL_SUBJECT.test(scope)) {
        cap = Number(declared[2]);
      }
    } else if (asserted !== null && LINE_MEASURE.test(line)) {
      const scope = live.slice(Math.max(0, i - 10), i + 1).join("\n");
      if (SKILL_SUBJECT.test(scope)) cap = Number(asserted[1]);
    }
    if (cap === null) return;
    let title = "";
    for (let j = i; j >= 0 && j > i - 30; j -= 1) {
      const t = TEST_TITLE.exec(live[j]!);
      if (t !== null) {
        title = t[1]!;
        break;
      }
    }
    pins.push({ file: fileRel, line: i + 1, cap, title, source: line.trim() });
  });
  return pins;
}

/** The sweep: EVERY test file in the suite, never a named subset. */
function sweepSkillCapPins(): CapPin[] {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .flatMap((name) => skillCapPins(`tests/${name}`, read(join(TESTS_DIR, name))));
}

/** Cap-shaped numbers a TITLE states, with tracker and milestone ids removed. */
function titleCapNumbers(title: string): number[] {
  const prose = title
    .replace(/[A-Za-z]+-\d+(?:\.\d+)?/g, "")
    .replace(/\bM_?\d+/g, "")
    .replace(/#\d+/g, "");
  return (prose.match(/\d{3,}/g) ?? []).map(Number);
}

describe("AC-STE-558.10 — every SKILL.md line-cap pin states the ONE NFR-1 cap", () => {
  /** The value the five stale pins carry. History; it does not move. */
  const SUPERSEDED_VALUE = 354;

  test("the cap is DERIVED, and the enforcing suite and the NFR state one number", () => {
    const cap = nfr1Cap();
    const nfr = /No single skill file shall exceed (\d+) lines/.exec(read(REQUIREMENTS_MD));
    expect(nfr, "specs/requirements.md no longer states NFR-1 in the pinned words").not.toBeNull();
    expect(Number(nfr![1])).toBe(cap);
    // The superseded value is genuinely NOT the contract — otherwise every leg
    // below is a tautology about a number that was never wrong.
    expect(cap).not.toBe(SUPERSEDED_VALUE);
  });

  test("ANTI-VACUITY — the sweep reaches the suite, and sees every site in question", () => {
    const pins = sweepSkillCapPins();
    const files = new Set(pins.map((p) => p.file));
    // A sweep that matched nothing would pass the two legs below vacuously.
    expect(pins.length).toBeGreaterThan(25);
    expect(files.size).toBeGreaterThan(20);
    // Asserted as sweep COVERAGE, which stays true after the repointing: the
    // five the FR names, the sixth it missed, and the three that pin a
    // different number in the other direction.
    for (const rel of [
      "tests/m108-ste-393-docs-pins.test.ts",
      "tests/m108-ste-392-skill-and-docs.test.ts",
      "tests/m120-ste-444-jira-binding-prose.test.ts",
      "tests/m136-ste-528-firing-caller.test.ts",
      "tests/m140-ste-543-external-link-verdicts.test.ts",
      "tests/m141-ste-546-corrections.test.ts",
      "tests/docs-skill-shape.test.ts",
      "tests/ship-milestone-shape.test.ts",
      "tests/spec-write-preamble-reconcile.test.ts",
      `tests/${NFR1_TEST_NAME}`,
    ]) {
      expect(files.has(rel), `the sweep is blind to ${rel}`).toBe(true);
    }
  });

  test("THE SWEEP — no live pin states a cap the NFR does not set", () => {
    const cap = nfr1Cap();
    const stale = sweepSkillCapPins()
      .filter((p) => p.cap !== cap)
      .map((p) => `${p.file}:${p.line} pins ${p.cap}, NFR-1 sets ${cap} — ${p.source}`);
    expect(stale).toEqual([]);
  });

  test("and the pin's own TITLE names no other cap — a half-fix is still stale", () => {
    const cap = nfr1Cap();
    const stale = sweepSkillCapPins()
      .filter((p) => titleCapNumbers(p.title).some((n) => n !== cap))
      .map((p) => `${p.file}:${p.line} — "${p.title}"`);
    expect(stale).toEqual([]);
  });

  test("the sweep grades ASSERTIONS, not the notes that record what was fixed", () => {
    const cap = nfr1Cap();
    for (const name of [
      "m123-ste-464-deliver-skill.test.ts",
      "m132-cross-fr-hardening.test.ts",
      "m136-ste-531-order-fires.test.ts",
      "m104-ste-383-dpt-gitignore.test.ts",
      "m140-ste-543-external-link-verdicts.test.ts",
    ]) {
      const src = read(join(TESTS_DIR, name));
      // The control is worth nothing unless the historical note is really there.
      expect(
        src.includes(String(SUPERSEDED_VALUE)),
        `tests/${name} no longer records the superseded value`,
      ).toBe(true);
      const offending = skillCapPins(`tests/${name}`, src).filter((p) => p.cap !== cap);
      expect(offending, `tests/${name} was flagged for a COMMENT, not an assertion`).toEqual([]);
    }
  });

  test("FALSIFIABILITY — the collector reds a synthetic stale pin, not its twin", () => {
    const cap = nfr1Cap();
    const synthetic = (pinned: number): string =>
      [
        `test(\`gate-check SKILL.md stays within the NFR-1 line cap (${pinned})\`, () => {`,
        `  const lines = read(GATE_CHECK_SKILL).split("\\n").length;`,
        `  expect(lines).toBeLessThanOrEqual(${pinned});`,
        `});`,
      ].join("\n");

    const stalePin = skillCapPins("tests/synthetic.test.ts", synthetic(SUPERSEDED_VALUE));
    expect(stalePin.length).toBe(1);
    expect(stalePin[0]!.cap).toBe(SUPERSEDED_VALUE);
    expect(titleCapNumbers(stalePin[0]!.title)).toEqual([SUPERSEDED_VALUE]);

    const compliantPin = skillCapPins("tests/synthetic.test.ts", synthetic(cap));
    expect(compliantPin.length).toBe(1);
    expect(compliantPin[0]!.cap).toBe(cap);
    expect(titleCapNumbers(compliantPin[0]!.title).filter((n) => n !== cap)).toEqual([]);

    // The SAME pin, commented out, is not a pin at all — the comment-blindness
    // half, measured on a body proven to be detectable when live.
    const commented = synthetic(SUPERSEDED_VALUE)
      .split("\n")
      .map((l) => `// ${l}`)
      .join("\n");
    expect(skillCapPins("tests/synthetic.test.ts", commented)).toEqual([]);
  });
});
