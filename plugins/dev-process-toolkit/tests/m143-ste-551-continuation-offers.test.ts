// M143 STE-551 — a continuation offer is not made when the answer was already
// given.
//
// WHAT IS BROKEN, measured on this tree today. Five skills end by offering, or
// printing, the step that comes next:
//
//   skills/brainstorm/SKILL.md:102     "…or I can start now."
//   skills/spec-write/SKILL.md:290-291 the closing `Next: Run …` recommendation
//   skills/implement/SKILL.md:301      the ship-ready close offer  [y/N]
//   skills/implement/SKILL.md:314      Phase 5 "Run /ship-milestone M<N> now?"
//   skills/ship-milestone/SKILL.md:240 "Next steps (not automated):"
//   skills/ship-milestone/SKILL.md:251 "Open ceremony PR via /pr now?"
//   skills/spec-archive/SKILL.md:74    "Archived. Next: /ship-milestone M<N>"
//
// Under an orchestrator every one of those steps was already named in the
// kickoff, so each offer asks a question that has an answer on the record. Six
// of the seven cost a turn. The seventh is a correctness defect: the FR-scoped
// last-active chain built by `frResumeChain` is
// `/implement -> /spec-archive -> /ship-milestone -> /pr`, and `/implement`'s
// own ship-ready offer runs `/spec-archive` then `/ship-milestone` too — so the
// close ceremony runs TWICE, once because the chain named it and once because
// the offer asked.
//
// WHY EACH LEG BELOW IS NOT A TAUTOLOGY.
//
//   * THE PER-SURFACE LEGS ARE PAIRED DIFFERENCE TESTS, ON ONE FIXTURE. Either
//     half alone proves nothing: "omitted when driven" is satisfied by an offer
//     nobody ever emits, "emitted standalone" by one that ignores the signal.
//     The driven body is RECONSTRUCTED from the standalone body, so the only
//     thing that differs between the two calls is the literal.
//   * EVERY SURFACE IS ASSERTED BY NAME, NEVER AS A GROUP. A loop that only
//     checked `every(...)` lets one regressing surface hide behind six healthy
//     ones — which is exactly the failure AC.8 is written against.
//   * THE SHIPPED PROSE IS GRADED FROM THE REGISTRY, not from a second list
//     hand-typed here. Each offer's shipped anchor must occur exactly ONCE in
//     the file the registry names, so a registry that drifts off the surfaces
//     it claims to describe reddens rather than passing quietly.
//   * AC.4 IS COUNTED ACROSS A RUN, NOT READ OFF EITHER SURFACE. Reading
//     `/implement`'s prose cannot see the chain, and reading the chain cannot
//     see the offer; only executing both together can. Its control asserts the
//     UNGUARDED arrangement yields two, or the leg proves nothing was fixed.
//   * MUTATIONS ARE MEASURED BEFORE THEY ARE SCORED. A removal that silently
//     never applied reads as a pass — a trap this repository has recorded more
//     than once — so every mutant is shown to differ from its original first.
//   * AC.7 FREEZES DECLARATION COUNTS CAPTURED BEFORE THIS FR LANDED, and the
//     line caps are measured with `split("\n")`, never `wc -l`.

import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DRIVEN_MARKER,
  isDrivenRun,
} from "../adapters/_shared/src/driven_run_signal";
import { DRIVEN_SUPPRESSION_CLAUSE } from "../adapters/_shared/src/inline_terminal_block";
import {
  resumeChain,
  type FrResumeClassification,
  type ResumeChainStep,
} from "../adapters/_shared/src/resume_classifier";
import {
  CLOSE_CEREMONY,
  CONTINUATION_OFFERS,
  DRIVEN_OMISSION_CLAUSE,
  closeCeremonyExecutions,
  continuationOffer,
  documentsDrivenOmission,
  drivenOmissionOccurrences,
  modelRun,
  offerFires,
  offersForSkill,
  scanContinuationOfferAdoption,
  stepExecutionCounts,
  type ContinuationOffer,
  type ModelledRunResult,
} from "../adapters/_shared/src/continuation_offer";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const read = (path: string): string => readFileSync(path, "utf-8");
const skillPath = (skill: string): string =>
  join(PLUGIN_ROOT, "skills", skill, "SKILL.md");
const skillBody = (skill: string): string => read(skillPath(skill));

/** The mandated measurement for the NFR-1 cap: `split("\n")`, never `wc -l`. */
const lineCount = (text: string): number => text.split("\n").length;

// ---------------------------------------------------------------------------
// The one fixture. Everything driven in this file is built FROM it.
// ---------------------------------------------------------------------------

/** An invocation body a person types: no signal of any kind. */
const PLAIN_BODY = [
  "/dev-process-toolkit:implement STE-551",
  "",
  "Build the FR on this branch, then stop.",
].join("\n");

/** The same body, driven. Reconstruction below proves it differs in one fact. */
const DRIVEN_BODY = `${DRIVEN_MARKER}\n${PLAIN_BODY}`;

/**
 * The seven shipped offers, by id, restated here rather than imported: a leg
 * that read the ids off the registry it is grading would pass for a registry
 * with six entries, or eight, or entirely different ones.
 */
const BRAINSTORM_START_NOW = "brainstorm_start_now";
const SPEC_WRITE_NEXT = "spec_write_next_implement";
const IMPLEMENT_SHIP_READY = "implement_ship_ready_close";
const IMPLEMENT_PHASE5 = "implement_phase5_close";
const SHIP_NOT_AUTOMATED = "ship_milestone_not_automated";
const SHIP_CEREMONY_PR = "ship_milestone_ceremony_pr";
const ARCHIVE_NEXT = "spec_archive_next";

const ALL_OFFER_IDS = [
  BRAINSTORM_START_NOW,
  SPEC_WRITE_NEXT,
  IMPLEMENT_SHIP_READY,
  IMPLEMENT_PHASE5,
  SHIP_NOT_AUTOMATED,
  SHIP_CEREMONY_PR,
  ARCHIVE_NEXT,
] as const;

/** The shipped anchor each offer owns, measured on this tree on 2026-09-04. */
const SHIPPED_ANCHORS: Record<string, { skill: string; anchor: string }> = {
  [BRAINSTORM_START_NOW]: {
    skill: "brainstorm",
    anchor: "or I can start now.",
  },
  [SPEC_WRITE_NEXT]: {
    skill: "spec-write",
    anchor: "Next: Run `/dev-process-toolkit:implement M<N>` when specs are ready.",
  },
  [IMPLEMENT_SHIP_READY]: {
    skill: "implement",
    anchor: "is ship-ready — run the close ceremony now? [y/N]",
  },
  [IMPLEMENT_PHASE5]: {
    skill: "implement",
    anchor: "Run /ship-milestone M<N> now? (y/n):",
  },
  [SHIP_NOT_AUTOMATED]: {
    skill: "ship-milestone",
    anchor: "Next steps (not automated):",
  },
  [SHIP_CEREMONY_PR]: {
    skill: "ship-milestone",
    anchor: "Open ceremony PR via /pr now? (y/n):",
  },
  [ARCHIVE_NEXT]: {
    skill: "spec-archive",
    anchor: "Archived. Next: /ship-milestone M<N>",
  },
};

const offerOrThrow = (id: string): ContinuationOffer => {
  const offer = continuationOffer(id);
  if (!offer) throw new Error(`no continuation offer registered as \`${id}\``);
  return offer;
};

/** One paired difference test, for one named surface. */
const assertPairedOffer = (id: string): void => {
  expect(offerFires(id, PLAIN_BODY), `${id} was omitted standalone`).toBe(true);
  expect(offerFires(id, DRIVEN_BODY), `${id} still fired when driven`).toBe(false);
};

// ---------------------------------------------------------------------------
// The modelled run's chain. The Phase-3 tail is the SHIPPED classifier's, so a
// chain that stopped containing the ceremony reddens these legs rather than
// silently making the double-run unreachable.
// ---------------------------------------------------------------------------

const LAST_ACTIVE_FR: FrResumeClassification = {
  scope: "fr",
  fr: "STE-551",
  milestone: "M143",
  state: "ready_to_implement",
  lastActiveFr: true,
  remainingActiveFrIds: [],
  needsTechnicalReview: false,
  reviewConsistencyViolations: [],
};

const frChain = (): readonly ResumeChainStep[] => resumeChain(LAST_ACTIVE_FR);

/** `/deliver`'s whole run: the two inline phases, then the FR-scoped chain. */
const fullChain = () => [
  { skill: "/brainstorm", target: "M143" },
  { skill: "/spec-write", target: "STE-551" },
  ...frChain().map((s) => ({ skill: s.skill as string, target: s.target })),
];

// ===========================================================================
// The registry itself — the thing every leg below grades through.
// ===========================================================================

describe("the registry names the surfaces it claims to describe", () => {
  test("exactly the seven shipped offers are registered, across five skills", () => {
    expect(CONTINUATION_OFFERS.length).toBe(7);
    expect([...CONTINUATION_OFFERS].map((o) => o.id).sort()).toEqual(
      [...ALL_OFFER_IDS].sort(),
    );
    expect(new Set(CONTINUATION_OFFERS.map((o) => o.skill)).size).toBe(5);
  });

  test("each offer's shipped anchor occurs EXACTLY ONCE in the file it names", () => {
    for (const id of ALL_OFFER_IDS) {
      const offer = offerOrThrow(id);
      const expected = SHIPPED_ANCHORS[id]!;
      expect(offer.skill, `${id} names the wrong skill`).toBe(expected.skill);
      expect(offer.anchor, `${id} names the wrong anchor`).toBe(expected.anchor);
      const body = skillBody(offer.skill);
      expect(body.split(offer.anchor).length - 1, `${id} anchor occurrences`).toBe(1);
      // The registry's path and the file actually read must be the same file.
      expect(offer.file).toBe(
        `plugins/dev-process-toolkit/skills/${offer.skill}/SKILL.md`,
      );
      expect(read(join(REPO_ROOT, offer.file))).toBe(body);
    }
  });

  test("an unregistered id resolves to nothing rather than to a default", () => {
    expect(continuationOffer("no_such_offer")).toBe(null);
    expect(offersForSkill("implement").map((o) => o.id).sort()).toEqual(
      [IMPLEMENT_PHASE5, IMPLEMENT_SHIP_READY].sort(),
    );
    expect(offersForSkill("brainstorm").length).toBe(1);
    expect(offersForSkill("spec-write").length).toBe(1);
    expect(offersForSkill("ship-milestone").length).toBe(2);
    expect(offersForSkill("spec-archive").length).toBe(1);
  });

  test("the predicate reads the signal's owner, not a second copy of the literal", () => {
    // Every offer answers identically to `isDrivenRun` on the same body, and
    // the module's own source carries no second spelling of the literal.
    const source = read(
      join(PLUGIN_ROOT, "adapters", "_shared", "src", "continuation_offer.ts"),
    );
    expect(source.includes("dpt:driven")).toBe(false);
    for (const body of [PLAIN_BODY, DRIVEN_BODY, "", `x ${DRIVEN_MARKER} y`]) {
      for (const id of ALL_OFFER_IDS) {
        expect(offerFires(id, body), `${id} on ${JSON.stringify(body)}`).toBe(
          !isDrivenRun(body),
        );
      }
    }
  });
});

// ===========================================================================
// AC-STE-551.1 — /brainstorm's hand-off.
// ===========================================================================

describe("AC-STE-551.1 — /brainstorm's \"or I can start now\" offer", () => {
  test("driven omits it; standalone emits it, from the same fixture", () => {
    // One readable fact separates the two bodies — proven by reconstruction.
    expect(DRIVEN_BODY.replace(`${DRIVEN_MARKER}\n`, "")).toBe(PLAIN_BODY);
    assertPairedOffer(BRAINSTORM_START_NOW);
  });

  test("the hand-off still proceeds to the next phase when driven", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
    });
    // Omitting the offer must not omit the step it was offering.
    expect(run.executed).toContain("/spec-write");
    expect(run.operatorTurns).not.toContain(BRAINSTORM_START_NOW);
  });

  test("the shipped offer text is still emitted verbatim on the standalone path", () => {
    expect(skillBody("brainstorm")).toContain(
      "Design approved. Run `/dev-process-toolkit:spec-write` and reference this " +
        "decision, or I can start now.",
    );
  });
});

// ===========================================================================
// AC-STE-551.2 — /spec-write's closing `Next:` recommendation.
// ===========================================================================

describe("AC-STE-551.2 — /spec-write's closing Next: recommendation", () => {
  test("driven omits it; standalone emits it", () => {
    assertPairedOffer(SPEC_WRITE_NEXT);
  });

  test("both shipped variants and the variant rule are byte-unchanged", () => {
    // Probe #66 (`spec_write_next_line_doc`) byte-checks these; the driven
    // branch must not have moved either template or the rule that picks them.
    const body = skillBody("spec-write");
    for (const literal of [
      "Next: Run `/dev-process-toolkit:implement M<N>` when specs are ready.",
      "Next: Run `/dev-process-toolkit:implement <tracker-id>` when specs are ready.",
      "**Next-line variant rule.**",
      "The discriminator is **milestone binding**, not new-FR presence.",
    ]) {
      expect(body.split(literal).length - 1, `${literal} occurrences`).toBe(1);
    }
  });
});

// ===========================================================================
// AC-STE-551.3 — the two chain prompts nobody needs to be asked.
// ===========================================================================

describe("AC-STE-551.3 — Phase 5's chain prompt and the ceremony-PR prompt", () => {
  test("/implement Phase 5 is not asked when driven, and is asked standalone", () => {
    assertPairedOffer(IMPLEMENT_PHASE5);
  });

  test("/ship-milestone's ceremony-PR prompt is not asked when driven", () => {
    assertPairedOffer(SHIP_CEREMONY_PR);
  });

  test("suppressing the prompts does not drop the steps the chain names", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
    });
    expect(run.executed).toContain("/ship-milestone");
    expect(run.executed).toContain("/pr");
    expect(run.operatorTurns).not.toContain(IMPLEMENT_PHASE5);
    expect(run.operatorTurns).not.toContain(SHIP_CEREMONY_PR);
  });
});

// ===========================================================================
// AC-STE-551.4 — THE LOAD-BEARING LEG. Counted across the run, with a control.
// ===========================================================================

describe("AC-STE-551.4 — the close ceremony executes exactly once", () => {
  test("the shipped FR-scoped chain really does name the ceremony", () => {
    // If this ever stops holding, the double-run below becomes unreachable and
    // the leg would pass while proving nothing.
    const chain = frChain().map((s) => s.skill);
    expect(chain).toEqual(["/implement", "/spec-archive", "/ship-milestone", "/pr"]);
    expect(CLOSE_CEREMONY).toEqual(["/spec-archive", "/ship-milestone"]);
  });

  test("GUARDED — the whole driven run executes the ceremony once", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [IMPLEMENT_SHIP_READY],
    });
    const counts = stepExecutionCounts(run);
    expect(counts["/spec-archive"], "/spec-archive ran more than once").toBe(1);
    expect(counts["/ship-milestone"], "/ship-milestone ran more than once").toBe(1);
    expect(closeCeremonyExecutions(run)).toBe(1);
  });

  test("CONTROL — the unguarded arrangement executes it twice", () => {
    // Same chain, same reached offer: the ONLY difference is that the offer
    // ignores the driven signal, exactly as it does today.
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [IMPLEMENT_SHIP_READY],
      restoredOffers: [IMPLEMENT_SHIP_READY],
    });
    const counts = stepExecutionCounts(run);
    expect(counts["/spec-archive"]).toBe(2);
    expect(counts["/ship-milestone"]).toBe(2);
    expect(closeCeremonyExecutions(run)).toBe(2);
  });

  test("the count is taken from the run, not from either surface", () => {
    // Neither the chain alone nor the offer alone can produce two: the defect
    // exists only where both claim the ceremony.
    const chainOnly = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [],
      restoredOffers: [IMPLEMENT_SHIP_READY],
    });
    expect(closeCeremonyExecutions(chainOnly)).toBe(1);

    const offerOnly = modelRun({
      chain: [{ skill: "/implement", target: "STE-551" }],
      promptBody: DRIVEN_BODY,
      reachedOffers: [IMPLEMENT_SHIP_READY],
      restoredOffers: [IMPLEMENT_SHIP_READY],
    });
    expect(closeCeremonyExecutions(offerOnly)).toBe(1);
  });

  test("standalone, the offer still fires and the operator still decides", () => {
    // The offer was never wrong — it was unconditional. A person running
    // `/implement STE-551` alone must still be asked.
    const run = modelRun({
      chain: [{ skill: "/implement", target: "STE-551" }],
      promptBody: PLAIN_BODY,
      reachedOffers: [IMPLEMENT_SHIP_READY],
    });
    expect(run.operatorTurns).toEqual([IMPLEMENT_SHIP_READY]);
    expect(closeCeremonyExecutions(run)).toBe(1);
  });
});

// ===========================================================================
// AC-STE-551.5 — /spec-archive's trailing Next: line.
// ===========================================================================

describe("AC-STE-551.5 — /spec-archive's trailing Next: line", () => {
  test("driven omits it; standalone emits it", () => {
    assertPairedOffer(ARCHIVE_NEXT);
  });

  test("it is omitted precisely because the session already holds that step", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
    });
    expect(run.executed).toContain("/ship-milestone");
    expect(run.operatorTurns).not.toContain(ARCHIVE_NEXT);
    // The parked variant is a different line and stays shipped, unchanged.
    expect(skillBody("spec-archive")).toContain(
      "Archived (parked). Unpark by shipping: /ship-milestone M<N>",
    );
  });
});

// ===========================================================================
// AC-STE-551.6 — the "not automated" notice, in a run that automated it.
// ===========================================================================

describe("AC-STE-551.6 — /ship-milestone's \"not automated\" notice", () => {
  test("driven omits it; standalone prints it", () => {
    assertPairedOffer(SHIP_NOT_AUTOMATED);
  });

  test("the run it would have appeared in did automate the steps it names", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
    });
    // The notice names `/pr` as a manual follow-up; the chain runs it.
    expect(skillBody("ship-milestone")).toContain("Next steps (not automated):");
    expect(run.executed).toContain("/pr");
    expect(run.operatorTurns).not.toContain(SHIP_NOT_AUTOMATED);
  });
});

// ===========================================================================
// The authoring half — the shipped prose carries a documented driven branch.
// ===========================================================================

describe("every offer's SKILL.md documents its driven branch", () => {
  test("the clause is a distinct literal with one owner", () => {
    expect(DRIVEN_OMISSION_CLAUSE.length).toBeGreaterThanOrEqual(24);
    expect(DRIVEN_OMISSION_CLAUSE).toMatch(/driven/i);
    // Byte-distinct from STE-550's clause in BOTH directions: two clauses that
    // contained one another would make either scanner's count meaningless.
    expect(DRIVEN_OMISSION_CLAUSE).not.toBe(DRIVEN_SUPPRESSION_CLAUSE);
    expect(DRIVEN_SUPPRESSION_CLAUSE.includes(DRIVEN_OMISSION_CLAUSE)).toBe(false);
    expect(DRIVEN_OMISSION_CLAUSE.includes(DRIVEN_SUPPRESSION_CLAUSE)).toBe(false);
    // One line, so it can land on a surface with zero line headroom.
    expect(DRIVEN_OMISSION_CLAUSE.includes("\n")).toBe(false);
  });

  test("each skill carries ONE clause PER OFFER it owns", () => {
    for (const skill of ["brainstorm", "spec-write", "implement", "ship-milestone", "spec-archive"]) {
      const owed = offersForSkill(skill).length;
      const body = skillBody(skill);
      expect(drivenOmissionOccurrences(body), `${skill} clause count`).toBe(owed);
      expect(documentsDrivenOmission(body, owed), `${skill} adoption`).toBe(true);
    }
    // Two offers in one file is the case a file-level check cannot see.
    expect(offersForSkill("implement").length).toBe(2);
    expect(offersForSkill("ship-milestone").length).toBe(2);
  });

  test("the scanner is clean on the shipped tree", () => {
    expect(scanContinuationOfferAdoption(REPO_ROOT)).toEqual([]);
  });

  test("MUTATION — the scanner names the offer whose branch is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-551-adoption-"));
    try {
      for (const offer of CONTINUATION_OFFERS) {
        const dir = join(root, "plugins", "dev-process-toolkit", "skills", offer.skill);
        mkdirSync(dir, { recursive: true });
        cpSync(skillPath(offer.skill), join(dir, "SKILL.md"));
      }
      // The unmutated copy grades exactly as the real tree does.
      expect(scanContinuationOfferAdoption(root)).toEqual([]);

      // Drop ONE of `/implement`'s two clauses — the half-adoption case a
      // file-level `includes` reports as compliant.
      const target = join(
        root, "plugins", "dev-process-toolkit", "skills", "implement", "SKILL.md",
      );
      const before = read(target);
      const idx = before.indexOf(DRIVEN_OMISSION_CLAUSE);
      expect(idx).toBeGreaterThanOrEqual(0);
      const after =
        before.slice(0, idx) + before.slice(idx + DRIVEN_OMISSION_CLAUSE.length);
      writeFileSync(target, after);
      // Measure the mutation before scoring it.
      expect(read(target).length).toBeLessThan(before.length);
      expect(read(target).includes(DRIVEN_OMISSION_CLAUSE)).toBe(true);

      const violations = scanContinuationOfferAdoption(root);
      expect(violations.length).toBe(1);
      expect(violations[0]!.skill).toBe("implement");
      expect(violations[0]!.file).toBe(
        "plugins/dev-process-toolkit/skills/implement/SKILL.md",
      );
      expect(violations[0]!.line).toBeGreaterThan(0);
      expect(violations[0]!.reason.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("MUTATION — a shipped anchor that vanished is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-551-anchor-"));
    try {
      for (const offer of CONTINUATION_OFFERS) {
        const dir = join(root, "plugins", "dev-process-toolkit", "skills", offer.skill);
        mkdirSync(dir, { recursive: true });
        cpSync(skillPath(offer.skill), join(dir, "SKILL.md"));
      }
      const victim = offerOrThrow(ARCHIVE_NEXT);
      const target = join(root, victim.file);
      const before = read(target);
      writeFileSync(target, before.split(victim.anchor).join(""));
      expect(read(target).length).toBeLessThan(before.length);

      const violations = scanContinuationOfferAdoption(root);
      expect(violations.map((v) => v.offer)).toContain(ARCHIVE_NEXT);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-551.7 — every standalone path is byte-identical.
// ===========================================================================

/**
 * Pre-existing expectation counts in the suites that grade the five surfaces
 * this FR edits, frozen as literals. Counted as `test(` declarations, measured
 * on this tree before any code in this FR landed.
 */
const PRE_FR_EXPECTATION_COUNTS: Record<string, number> = {
  "brainstorm-doc-conformance.test.ts": 4,
  "gate-check-spec-write-next-line-doc.test.ts": 20,
  "gate-check-active-plan-ship-ready.test.ts": 25,
  "implement-phase5-milestone-close.test.ts": 22,
  "m99-ste-370-post-merge-ceremony.test.ts": 23,
  "gate-check-plan-ship-coherence.test.ts": 22,
};

const declaredTests = (file: string): number =>
  read(join(PLUGIN_ROOT, "tests", file))
    .split("\n")
    .filter((line) => /^\s*test\(/.test(line)).length;

describe("AC-STE-551.7 — the standalone paths are unchanged", () => {
  test("every pre-FR suite grading the five skills holds its exact count", () => {
    for (const [file, want] of Object.entries(PRE_FR_EXPECTATION_COUNTS)) {
      expect(declaredTests(file), `${file} changed its expectation count`).toBe(want);
    }
    // All five surfaces are represented — a map that lost a skill would still
    // pass the loop above.
    expect(Object.keys(PRE_FR_EXPECTATION_COUNTS).length).toBe(6);
  });

  test("all seven offers fire on an unsignalled body, whatever else it carries", () => {
    for (const body of [
      "",
      PLAIN_BODY,
      "/dev-process-toolkit:ship-milestone M143",
      DRIVEN_BODY.replaceAll(DRIVEN_MARKER, ""),
    ]) {
      for (const id of ALL_OFFER_IDS) {
        expect(offerFires(id, body), `${id} on an unsignalled body`).toBe(true);
      }
    }
  });

  test("a standalone run asks every offer it reaches", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: PLAIN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
    });
    expect([...run.operatorTurns].sort()).toEqual([...ALL_OFFER_IDS].sort());
  });

  test("the two capped surfaces stay at or under the 358-line cap", () => {
    // Measured with `split("\n")` — `wc -l` reports one fewer.
    expect(lineCount(skillBody("implement"))).toBeLessThanOrEqual(358);
    expect(lineCount(skillBody("spec-write"))).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// AC-STE-551.8 — falsifiability, per offer and never in aggregate.
// ===========================================================================

describe("AC-STE-551.8 — restoring ONE offer costs exactly one operator turn", () => {
  test("the fixed driven run costs zero operator turns", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
    });
    expect(run.operatorTurns).toEqual([]);
  });

  for (const id of ALL_OFFER_IDS) {
    test(`restoring ${id} alone reintroduces exactly one turn — its own`, () => {
      const baseline: ModelledRunResult = modelRun({
        chain: fullChain(),
        promptBody: DRIVEN_BODY,
        reachedOffers: [...ALL_OFFER_IDS],
      });
      const mutant: ModelledRunResult = modelRun({
        chain: fullChain(),
        promptBody: DRIVEN_BODY,
        reachedOffers: [...ALL_OFFER_IDS],
        restoredOffers: [id],
      });
      // The mutation is measured before it is scored.
      expect(mutant.operatorTurns).not.toEqual(baseline.operatorTurns);
      expect(mutant.operatorTurns.length - baseline.operatorTurns.length).toBe(1);
      expect(mutant.operatorTurns).toEqual([id]);
      // The other six stay suppressed — no offer hides behind another.
      for (const other of ALL_OFFER_IDS) {
        if (other === id) continue;
        expect(mutant.operatorTurns, `${other} leaked`).not.toContain(other);
      }
    });
  }

  test("restoring all seven costs seven turns — the aggregate the per-offer legs replace", () => {
    const run = modelRun({
      chain: fullChain(),
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
      restoredOffers: [...ALL_OFFER_IDS],
    });
    expect(run.operatorTurns.length).toBe(7);
    // And the ceremony doubles, which is the aggregate's correctness half.
    expect(closeCeremonyExecutions(run)).toBeGreaterThan(1);
  });

  test("an offer whose chain step never runs cannot fire", () => {
    // Reachability is a real precondition: a run with no `/ship-milestone` step
    // has no ceremony-PR prompt to suppress, so restoring it changes nothing.
    const run = modelRun({
      chain: [{ skill: "/implement", target: "STE-551" }],
      promptBody: DRIVEN_BODY,
      reachedOffers: [...ALL_OFFER_IDS],
      restoredOffers: [SHIP_CEREMONY_PR],
    });
    expect(run.operatorTurns).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-551.3, ROUND 2 — the driven branch DROPS THE CLAIM, never performs
// the step.
//
// WHAT THE AUDIT FOUND, and why the legs above could not see it. This FR's own
// clauses re-create the double-run AC-STE-551.4 exists to remove, for three
// different steps:
//
//   skills/brainstorm/SKILL.md      "Proceed straight into step 3 above, in
//                                    the same turn" — step 3 IS the
//                                    `/spec-write` flow, and `/deliver` runs
//                                    `/spec-write` itself as Phase 2.
//   skills/implement/SKILL.md       "Chain straight into `/ship-milestone
//                                    M<N>` in the same turn." — the shipped
//                                    chain already names `/ship-milestone`.
//   skills/ship-milestone/SKILL.md  "Chain into `/pr` in the same turn exactly
//                                    as on `y`." — the chain already names
//                                    `/pr`.
//
// The sibling clause on `implement_ship_ready_close` answered the identical
// question the other way, and IS the idiom: "Do not run the ceremony from here
// either — the chain the worker was spawned with already names it … What is
// dropped is this surface's claim on the ceremony, never the ceremony."
//
// THE MODULE GAP THAT HID IT. `modelRun` executes `runsWhenAccepted` only when
// an offer FIRES. A suppressed offer therefore ran nothing at all, so a clause
// that says "chain anyway" was literally unmodelled: the run could not tell an
// offer that dropped its claim from one that kept it. The registry must carry
// what the DRIVEN path runs from that surface — `runsWhenDriven`, empty for
// every offer whose step the chain names — and `modelRun` must execute it.
//
// WHY THESE LEGS ARE NOT TAUTOLOGIES.
//
//   * THE CHAINS ARE DERIVED FROM SHIPPED SOURCE, never hand-typed here:
//     `resumeChain` at FR scope and at milestone scope (which is the only way
//     to reach `frResumeChain` / `milestoneResumeChain` and their `SHIP_TAIL`),
//     plus `/deliver`'s inline Phase 1 + Phase 2, read off `/deliver`'s own
//     SKILL.md. A chain that stopped naming a step makes these legs go quiet
//     honestly rather than passing on a stale copy — which is why the
//     derivation is asserted non-empty and by name first.
//   * EVERY STEP IS COUNTED ACROSS THE RUN AND CARRIES ITS OWN CONTROL. Each
//     of `/spec-write`, `/ship-milestone` and `/pr` is asserted at exactly one
//     execution, and each has a pre-fix control arm — the same run with that
//     one surface performing its step on the driven path, exactly as its
//     shipped clause orders today — asserted at two. Without the control the
//     "exactly one" reads identically on a tree where nothing was fixed.
//   * THE PROSE IS GRADED, NOT ONLY THE MODEL. A registry that quietly says
//     `runsWhenDriven: []` while the shipped clause still orders the step
//     would pass every modelled leg and ship the defect. The prose half is
//     asserted per offer, by name.
//   * THE DETECTOR IS PINNED ON BOTH IDIOMS. `performanceDirectiveIn` must
//     fire on the affirmative order and stay silent on the renunciation that
//     merely mentions the same verb under a negation — otherwise the prose leg
//     could never go green, or could never have been red.
// ===========================================================================

import * as ContinuationOfferModule from "../adapters/_shared/src/continuation_offer";
import type { ModelledRunStep } from "../adapters/_shared/src/continuation_offer";
import type { ResumeClassification } from "../adapters/_shared/src/resume_classifier";

/**
 * One offer whose driven path claims a step an orchestrator chain already
 * names. Declared here as the CONTRACT the module owes, so this file states
 * the shape it is grading rather than inheriting whatever ships.
 */
interface DrivenClaimViolation {
  readonly offer: string;
  readonly skill: string;
  readonly file: string;
  readonly line: number;
  /** The chain-named step the driven path would run a second time. */
  readonly step: string;
  /** Which half found it: the registry entry, or the shipped clause. */
  readonly source: "registry" | "prose";
  readonly reason: string;
}

/**
 * The new module surface, resolved at CALL time rather than at import time.
 *
 * A bare named import of a not-yet-landed export is a module-load error, and a
 * module-load error takes the FORTY legs above down with it — turning "these
 * new criteria are unmet" into "this whole file is broken", which is a strictly
 * worse signal and would hide a regression in any of the forty while this FR is
 * in flight. So each new symbol is fetched through one accessor that fails the
 * leg that needed it, by name, and nothing else.
 */
const owed = <T>(name: string): T => {
  const fn = (ContinuationOfferModule as Record<string, unknown>)[name];
  if (fn === undefined) {
    throw new Error(
      `continuation_offer does not yet export \`${name}\` — the driven path ` +
        `cannot be graded without it`,
    );
  }
  return fn as T;
};

const chainNamedSteps = (chains: readonly (readonly string[])[]): readonly string[] =>
  owed<(c: readonly (readonly string[])[]) => readonly string[]>("chainNamedSteps")(chains);

const deliverInlinePhaseSteps = (projectRoot: string): readonly string[] =>
  owed<(r: string) => readonly string[]>("deliverInlinePhaseSteps")(projectRoot);

const drivenClauseParagraph = (
  body: string,
  offer: ContinuationOffer,
): string | null =>
  owed<(b: string, o: ContinuationOffer) => string | null>("drivenClauseParagraph")(
    body,
    offer,
  );

const performanceDirectiveIn = (text: string): string | null =>
  owed<(t: string) => string | null>("performanceDirectiveIn")(text);

const drivenRegistryClaims = (
  chainSteps: readonly string[],
  offers?: readonly ContinuationOffer[],
): DrivenClaimViolation[] =>
  owed<
    (c: readonly string[], o?: readonly ContinuationOffer[]) => DrivenClaimViolation[]
  >("drivenRegistryClaims")(chainSteps, offers);

const scanDrivenClaimProse = (
  projectRoot: string,
  chainSteps: readonly string[],
): DrivenClaimViolation[] =>
  owed<(r: string, c: readonly string[]) => DrivenClaimViolation[]>(
    "scanDrivenClaimProse",
  )(projectRoot, chainSteps);

/** What one offer's driven path runs — the field this round adds. */
const runsWhenDriven = (offer: ContinuationOffer): readonly string[] => {
  const value = (offer as unknown as Record<string, unknown>).runsWhenDriven;
  if (value === undefined) {
    throw new Error(
      `\`${offer.id}\` carries no \`runsWhenDriven\`: what the DRIVEN path runs ` +
        `from this surface is unmodelled, so a clause that says "chain anyway" ` +
        `cannot be graded`,
    );
  }
  return value as readonly string[];
};

/** The same offer with its driven path performing `step` — the control arm. */
const performsWhenDriven = (id: string, step: string): ContinuationOffer =>
  ({ ...offerOrThrow(id), runsWhenDriven: [step] }) as ContinuationOffer;

/**
 * A modelled run with a registry override in force.
 *
 * `offerOverrides` is the ONE control lever these legs need: it swaps a
 * registry entry for the duration of the run, so the PRE-FIX arrangement — a
 * surface whose driven path still performs the step its shipped clause orders
 * — is expressed as the registry saying exactly that, and nothing else about
 * the run differs from the guarded arm. A `modelRun` that ignored the field
 * would leave every control arm at one execution, which is how these legs
 * report an unwired lever rather than passing on one.
 */
const runWithOverrides = (
  chain: readonly ModelledRunStep[],
  promptBody: string,
  offerOverrides: readonly ContinuationOffer[],
  reachedOffers: readonly string[] = [...ALL_OFFER_IDS],
): ModelledRunResult =>
  modelRun({
    chain,
    promptBody,
    reachedOffers,
    offerOverrides,
  } as Parameters<typeof modelRun>[0]);

/**
 * A milestone-scoped classification, so `resumeChain` reaches
 * `milestoneResumeChain` and renders its `SHIP_TAIL`. Stated as a fixture
 * rather than as a step list: the point is to READ the shipped chain builder,
 * not to restate what it currently emits.
 */
const READY_MILESTONE: ResumeClassification = {
  milestone: "M143",
  state: "ready_to_implement",
  planStatus: "active",
  totalTasks: 3,
  uncheckedTasks: 3,
  frsAwaitingReview: [],
  parkedReason: null,
  shippedIn: null,
  shipCoherenceViolations: [],
  reviewConsistencyViolations: [],
};

const milestoneChain = (): readonly string[] =>
  resumeChain(READY_MILESTONE).map((s) => s.skill as string);

/** Every step any shipped orchestrator chain names, derived, never typed. */
const shippedChainSteps = (): readonly string[] =>
  chainNamedSteps([
    deliverInlinePhaseSteps(REPO_ROOT),
    frChain().map((s) => s.skill as string),
    milestoneChain(),
  ]);

/**
 * `/deliver`'s whole run, built from shipped source: the two inline phases as
 * `/deliver`'s SKILL.md declares them, then the FR-scoped chain the classifier
 * builds. Each of `/spec-write`, `/ship-milestone` and `/pr` appears exactly
 * once here, which is the property the counting legs are about.
 */
const derivedFullChain = (): readonly ModelledRunStep[] => [
  ...deliverInlinePhaseSteps(REPO_ROOT).map((skill) => ({ skill, target: "M143" })),
  ...frChain().map((s) => ({ skill: s.skill as string, target: s.target })),
];

/** The three steps a driven clause currently orders a surface to run twice. */
const DOUBLE_RUN_CASES: readonly {
  readonly step: string;
  readonly offer: string;
}[] = [
  { step: "/spec-write", offer: BRAINSTORM_START_NOW },
  { step: "/ship-milestone", offer: IMPLEMENT_PHASE5 },
  { step: "/pr", offer: SHIP_CEREMONY_PR },
];

/** The renunciation idiom, verbatim from the one clause that got it right. */
const RENUNCIATION_IDIOM =
  "Do not run the ceremony from here either — the FR-scoped chain the worker " +
  "was spawned with already names `/spec-archive` then `/ship-milestone`, and " +
  "this offer runs both itself, so asking and accepting would execute the " +
  "close ceremony a second time. What is dropped is this surface's claim on " +
  "the ceremony, never the ceremony: the chain still runs each step under its " +
  "own approval gate, exactly once.";

/** The three affirmative orders shipped today, verbatim. */
const PERFORMANCE_ORDERS: readonly string[] = [
  "Proceed straight into step 3 above, in the same turn, and never end the turn on the offer.",
  "Chain straight into `/ship-milestone M<N>` in the same turn — what is omitted is the redundant question, never a gate, so `/ship-milestone`'s own deciding `Apply? [y/N]` still fires.",
  "Chain into `/pr` in the same turn exactly as on `y`. What the marker removes is the redundant question, never the authorization.",
];

describe("AC-STE-551.3 round 2 — the chains these legs grade against are derived", () => {
  test("`/deliver`'s inline phases are READ off `/deliver`'s SKILL.md", () => {
    const phases = deliverInlinePhaseSteps(REPO_ROOT);
    // Named, in phase order — a derivation that silently returned `[]` would
    // make every leg below vacuous, and an empty list is the shape a broken
    // parse produces.
    expect(phases).toEqual(["/brainstorm", "/spec-write"]);
    // And it really came off disk: the sentence it parsed is still shipped.
    expect(read(join(REPO_ROOT, "plugins/dev-process-toolkit/skills/deliver/SKILL.md")))
      .toContain("(Phase 1)");
  });

  test("a tree with no `/deliver` surface refuses rather than reporting none", () => {
    const empty = mkdtempSync(join(tmpdir(), "ste-551-nodeliver-"));
    try {
      expect(() => deliverInlinePhaseSteps(empty)).toThrow();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("the shipped chains really do name all three contested steps", () => {
    // If this stops holding, the double-run below becomes unreachable and every
    // leg in this section would pass while proving nothing.
    const steps = shippedChainSteps();
    for (const { step } of DOUBLE_RUN_CASES) {
      expect(steps, `no shipped chain names ${step}`).toContain(step);
    }
    // `/ship-milestone` and `/pr` reach the list through the MILESTONE builder
    // and its ship tail as well, not only through the FR chain.
    expect(milestoneChain()).toContain("/ship-milestone");
    expect(milestoneChain()).toContain("/pr");
    // De-duplicated: a step named by two chains is still one named step.
    expect(new Set(steps).size).toBe(steps.length);
  });

  test("the derived run names each contested step exactly once", () => {
    const counts: Record<string, number> = {};
    for (const step of derivedFullChain()) counts[step.skill] = (counts[step.skill] ?? 0) + 1;
    for (const { step } of DOUBLE_RUN_CASES) {
      expect(counts[step], `${step} appears ${counts[step]} times in the chain`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The registry half — what the driven path runs from each surface.
// ---------------------------------------------------------------------------

describe("AC-STE-551.3 round 2 — no offer's driven branch performs a chain-named step", () => {
  for (const id of ALL_OFFER_IDS) {
    test(`${id} claims nothing the shipped chain already names`, () => {
      const offer = offerOrThrow(id);
      const named = shippedChainSteps();
      const claimed = runsWhenDriven(offer).filter((s) => named.includes(s));
      expect(claimed, `${id} performs ${claimed.join(", ")} on the driven path`).toEqual([]);
    });
  }

  test("the registry scan reports no claim, and names the offer when it does", () => {
    expect(drivenRegistryClaims(shippedChainSteps())).toEqual([]);
    // MUTATION — a registry that put a chain-named step back is caught, and the
    // mutant is measured against the original before it is scored.
    const mutantOffer = performsWhenDriven(SHIP_CEREMONY_PR, "/pr");
    expect(runsWhenDriven(mutantOffer)).not.toEqual(
      runsWhenDriven(offerOrThrow(SHIP_CEREMONY_PR)),
    );
    const found: DrivenClaimViolation[] = drivenRegistryClaims(shippedChainSteps(), [
      mutantOffer,
    ]);
    expect(found.length).toBe(1);
    expect(found[0]!.offer).toBe(SHIP_CEREMONY_PR);
    expect(found[0]!.step).toBe("/pr");
    expect(found[0]!.source).toBe("registry");
    expect(found[0]!.reason.length).toBeGreaterThan(0);
  });

  test("`runsWhenDriven` is a field of its own, not an alias of `runsWhenAccepted`", () => {
    // The two must be separately readable, or "drops the claim" cannot be
    // expressed: `implement_ship_ready_close` RUNS the ceremony when accepted
    // and runs nothing when driven, and a single field cannot say both.
    const offer = offerOrThrow(IMPLEMENT_SHIP_READY);
    expect(offer.runsWhenAccepted).toEqual(CLOSE_CEREMONY);
    expect(runsWhenDriven(offer)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The counting half — one execution per step, each with its own control.
// ---------------------------------------------------------------------------

describe("AC-STE-551.3 round 2 — each contested step executes exactly once", () => {
  /**
   * A driven run of the derived chain. `offerOverrides` is the ONE control
   * lever: it swaps a registry entry for the run, so the pre-fix arrangement —
   * a surface whose driven path still performs the step its shipped clause
   * orders — is expressed as the registry saying so, and nothing else about
   * the run changes.
   */
  const drivenRun = (offerOverrides: readonly ContinuationOffer[] = []) =>
    runWithOverrides(derivedFullChain(), DRIVEN_BODY, offerOverrides);

  for (const { step, offer } of DOUBLE_RUN_CASES) {
    test(`GUARDED — ${step} runs once across the whole driven run`, () => {
      const counts = stepExecutionCounts(drivenRun());
      expect(counts[step], `${step} ran ${counts[step]} times`).toBe(1);
    });

    test(`CONTROL — ${offer} performing ${step} when driven runs it twice`, () => {
      const mutant = performsWhenDriven(offer, step);
      // The mutation is measured before it is scored.
      expect(runsWhenDriven(mutant)).not.toEqual(runsWhenDriven(offerOrThrow(offer)));
      const baseline = stepExecutionCounts(drivenRun());
      const counts = stepExecutionCounts(drivenRun([mutant]));
      expect(counts[step]).not.toBe(baseline[step]);
      expect(counts[step], `${step} ran ${counts[step]} times, want 2`).toBe(2);
      // And it cost NO operator turn: this is the silent double-run, which is
      // exactly why the AC.8 turn-counting legs above could never see it.
      expect(drivenRun([mutant]).operatorTurns).toEqual([]);
    });
  }

  test("all three at once — every contested step doubles, and only doubles", () => {
    const mutants = DOUBLE_RUN_CASES.map((c) => performsWhenDriven(c.offer, c.step));
    const counts = stepExecutionCounts(drivenRun(mutants));
    for (const { step } of DOUBLE_RUN_CASES) {
      expect(counts[step], `${step} ran ${counts[step]} times`).toBe(2);
    }
  });

  test("a driven consequence is taken at most ONCE per run, like the question", () => {
    // `/ship-milestone` appears twice in the run once Phase 5 performs it, and
    // the ceremony-PR surface must not perform `/pr` a second time on the
    // second pass — without that bound the counts above would drift on a
    // longer chain and stop meaning anything.
    const mutants = [
      performsWhenDriven(IMPLEMENT_PHASE5, "/ship-milestone"),
      performsWhenDriven(SHIP_CEREMONY_PR, "/pr"),
    ];
    const counts = stepExecutionCounts(drivenRun(mutants));
    expect(counts["/ship-milestone"]).toBe(2);
    expect(counts["/pr"], "the ceremony-PR consequence ran twice").toBe(2);
  });

  test("a driven override is INERT on a standalone body", () => {
    // Standalone the offer is asked and the operator decides, so what the
    // driven path would have run must change nothing at all.
    const standalone = (offerOverrides: readonly ContinuationOffer[] = []) =>
      runWithOverrides(derivedFullChain(), PLAIN_BODY, offerOverrides);
    const mutants = DOUBLE_RUN_CASES.map((c) => performsWhenDriven(c.offer, c.step));
    expect(stepExecutionCounts(standalone(mutants))).toEqual(
      stepExecutionCounts(standalone()),
    );
    expect([...standalone(mutants).operatorTurns].sort()).toEqual(
      [...ALL_OFFER_IDS].sort(),
    );
  });

  test("`runsWhenDriven` is what modelRun executes on the driven path", () => {
    // Wire check: a suppressed offer whose entry DOES name a step must execute
    // it, or the field is decorative and every guarded arm above is green for
    // the wrong reason.
    const wired = runWithOverrides(
      [{ skill: "/ship-milestone", target: "M143" }],
      DRIVEN_BODY,
      [performsWhenDriven(SHIP_CEREMONY_PR, "/pr")],
      [SHIP_CEREMONY_PR],
    );
    expect(wired.operatorTurns).toEqual([]);
    expect(stepExecutionCounts(wired)["/pr"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The prose half — the shipped clause is graded, not only the registry.
// ---------------------------------------------------------------------------

describe("AC-STE-551.3 round 2 — the detector fires on the order and not on the renunciation", () => {
  test("the renunciation idiom is NOT a performance directive", () => {
    // It contains "run", "chain" and both contested step names — under a
    // negation. A detector that fired here could never go green.
    expect(RENUNCIATION_IDIOM).toContain("run the ceremony from here");
    expect(performanceDirectiveIn(RENUNCIATION_IDIOM)).toBe(null);
  });

  test("each affirmative order IS a performance directive", () => {
    for (const order of PERFORMANCE_ORDERS) {
      const hit = performanceDirectiveIn(order);
      expect(hit, `missed: ${order.slice(0, 48)}…`).not.toBe(null);
      // It cites the offending words, so a violation is readable.
      expect(order).toContain(hit!);
    }
  });

  test("clause-free prose scores nothing", () => {
    expect(performanceDirectiveIn("")).toBe(null);
    expect(
      performanceDirectiveIn(
        "Standalone runs still print it, and the parked variant is not this offer.",
      ),
    ).toBe(null);
  });

  test("each offer's driven clause paragraph is locatable and bounded", () => {
    for (const id of ALL_OFFER_IDS) {
      const offer = offerOrThrow(id);
      const para = drivenClauseParagraph(skillBody(offer.skill), offer);
      expect(para, `${id} has no driven clause paragraph`).not.toBe(null);
      expect(para!).toContain(DRIVEN_OMISSION_CLAUSE);
      // Bounded at the paragraph, not run to end of file: a span that swallowed
      // the rest of the surface would score unrelated prose against this offer.
      expect(para!.includes("\n\n")).toBe(false);
    }
  });
});

describe("AC-STE-551.3 round 2 — no driven clause orders a step the chain names", () => {
  for (const id of ALL_OFFER_IDS) {
    test(`${id}'s driven clause drops the claim rather than performing it`, () => {
      const offer = offerOrThrow(id);
      const para = drivenClauseParagraph(skillBody(offer.skill), offer);
      expect(para, `${id} has no driven clause`).not.toBe(null);
      const hit = performanceDirectiveIn(para!);
      expect(
        hit,
        `${id} orders the surface to perform its step when driven: ${hit ?? ""}`,
      ).toBe(null);
    });
  }

  test("the prose scan is clean on the shipped tree", () => {
    expect(scanDrivenClaimProse(REPO_ROOT, shippedChainSteps())).toEqual([]);
  });

  test("MUTATION — a clause that regains the order is named, with a citable line", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-551-claim-"));
    try {
      for (const offer of CONTINUATION_OFFERS) {
        const dir = join(root, "plugins", "dev-process-toolkit", "skills", offer.skill);
        mkdirSync(dir, { recursive: true });
        cpSync(skillPath(offer.skill), join(dir, "SKILL.md"));
      }
      const victim = offerOrThrow(ARCHIVE_NEXT);
      const target = join(root, victim.file);
      const before = read(target);
      // Splice the order into the END of the offer's own driven paragraph, so
      // the mutation lands inside the span the scanner attributes to it.
      const para = drivenClauseParagraph(before, victim)!;
      const injected = `${para} Chain straight into \`/ship-milestone M<N>\` in the same turn.`;
      writeFileSync(target, before.replace(para, injected));
      // Measured before it is scored — a splice that never applied reads as a
      // pass, a trap this repository has recorded more than once.
      expect(read(target).length).toBeGreaterThan(before.length);
      expect(read(target)).toContain("Chain straight into");

      const found = scanDrivenClaimProse(root, shippedChainSteps());
      expect(found.map((v) => v.offer)).toEqual([ARCHIVE_NEXT]);
      expect(found[0]!.source).toBe("prose");
      expect(found[0]!.file).toBe(victim.file);
      expect(found[0]!.line).toBeGreaterThan(0);
      expect(found[0]!.reason.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the unmutated copy of the fixed tree scans clean", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-551-claim-clean-"));
    try {
      for (const offer of CONTINUATION_OFFERS) {
        const dir = join(root, "plugins", "dev-process-toolkit", "skills", offer.skill);
        mkdirSync(dir, { recursive: true });
        cpSync(skillPath(offer.skill), join(dir, "SKILL.md"));
      }
      expect(scanDrivenClaimProse(root, shippedChainSteps())).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the two capped surfaces are still at or under 358 lines after the reword", () => {
    // The fix is a REWORD, not an addition: both surfaces sit exactly at the
    // cap, so a clause that could only be satisfied by a new line is not a fix.
    expect(lineCount(skillBody("implement"))).toBeLessThanOrEqual(358);
    expect(lineCount(skillBody("spec-write"))).toBeLessThanOrEqual(358);
  });
});
