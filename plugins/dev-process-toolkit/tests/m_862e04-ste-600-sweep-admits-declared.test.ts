// M_862e04 STE-600 — the target-repo sweep admits a plan that actually
// declares one.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-09-17):
//
//   * `tests/m129-ste-495-target-repo.test.ts:656` — the NON-REGRESSION SWEEP
//     asserts `decl.declared === false` for EVERY plan file on disk, with the
//     message "unexpectedly declares a target repo". Writing the first plan
//     that uses the shipped `target_repo:` declaration turns that assertion
//     red, and `AC-STE-582.8` (which spawns the same suite and asserts
//     `0 fail`) goes red with it. The capability ships and its own guard
//     forbids using it.
//   * `ls tests/_target_repo_sweep.ts` → no matches. The per-plan routing
//     assertion is inlined in the sweep's loop body, so there is no named unit
//     a synthetic declaring plan or a mutant router can be handed to. Every
//     positive case in that suite is a fixture the sweep itself never sees.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * THE SUBJECT IS THE SWEEP, NOT THE ROUTER.
//     `adapters/_shared/src/target_repo.ts` is CORRECT and this file changes
//     nothing about it — every pin below is about what the sweep ASSERTS.
//   * REACHABILITY IS THE THING PINNED. AC.2 and AC.3 cannot be pinned by the
//     disk walk alone, because no plan on disk declares a target repo today, so
//     the declared group is empty in the real corpus. They are pinned instead
//     on the per-plan assertion being a NAMED UNIT — `auditPlanRouting` /
//     `auditPlanCorpus` in `tests/_target_repo_sweep.ts` — that a synthetic
//     body and a STUBBED router can be fed to. A partition living only inside
//     a `for` loop in a `test()` body is unreachable by construction, which is
//     exactly the shape this FR exists to correct.
//   * EVERY GROUP HAS A MUTANT KILL, IN BOTH DIRECTIONS. AC.3's leg hands the
//     unit an UNDECLARED body and a router that routes it to another tree, and
//     requires a throw; its paired arm hands the same body and a router that
//     routes it to the invoking repo, and requires no throw. A sweep rewritten
//     into a tautology fails the first arm; a sweep that still forbids
//     declarations fails AC.2's.
//   * AC.4 IS MEASURED, NOT ASSERTED. It writes a real declaring plan into
//     `specs/plan/`, spawns the M129 suite exactly as `AC-STE-582.8` spawns it,
//     and requires `0 fail` — reproducing the measured 2026-09-16 failure. The
//     sibling file is NOT edited; its grading block is pinned verbatim here so
//     "passes without being edited" is a checked claim rather than a promise.
//
// DELIBERATE OMISSIONS.
//   * NO assertion that the real corpus contains a declaring plan. It does not,
//     and the point of this FR is that it MAY, not that it must.
//   * NO new probe, no new skill, no production module change.
//   * NO edit to `tests/m_8f07e0-ste-582-target-repo-refusal.test.ts`.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FULL_CHAIN_STAGES,
  MAX_CONCURRENT_WORKERS,
  defaultRepoProbe,
  readTargetRepoDeclaration,
  routeMilestone,
  stagesRequiredFor,
  type MilestoneRoute,
  type MilestoneRouting,
  type RepoProbe,
  type RouteInput,
  type StageId,
  type TargetRepoDeclaration,
} from "../adapters/_shared/src/target_repo";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const TESTS_DIR = join(PLUGIN_ROOT, "tests");

const M129_SUITE_REL = "tests/m129-ste-495-target-repo.test.ts";
const M129_SUITE_FILE = join(PLUGIN_ROOT, M129_SUITE_REL);
const SIBLING_REL = "tests/m_8f07e0-ste-582-target-repo-refusal.test.ts";
const SIBLING_FILE = join(PLUGIN_ROOT, SIBLING_REL);
const OWN_SUITE_REL = "tests/m_862e04-ste-600-sweep-admits-declared.test.ts";

/**
 * Set by the MEASURED leg on the child it spawns. That leg now spawns THIS
 * file as well as M129 — grading only M129 is what let this file re-home the
 * forbidden invariant unnoticed — and a child that ran the spawning test again
 * would spawn its own child forever. The guard is read once, here.
 */
const IS_SPAWNED_CHILD = process.env.DPT_STE600_CHILD === "1";

const read = (p: string): string => readFileSync(p, "utf-8");

// ===========================================================================
// The shared sweep module, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// collapsing four independent reds into one load error and hiding which ACs are
// actually unmet. `target_repo` IS imported statically above — it is shipped,
// it is correct, and this FR does not touch it.
// ===========================================================================

const SWEEP_MODULE = "./_target_repo_sweep";
const SWEEP_MODULE_FILE = join(TESTS_DIR, "_target_repo_sweep.ts");

/** One plan file, as the corpus walker hands it to the audit. */
interface PlanEntry {
  readonly path: string;
  readonly body: string;
}

/**
 * What the audit needs in order to grade one plan. Everything is INJECTED so a
 * stubbed router can be fed to the very unit the real sweep runs — the
 * reachability this FR is about.
 */
interface SweepDeps {
  /** The repo the fictional `/deliver` session was invoked in. */
  readonly invokingRepo: string;
  /** The probe used for the DECLARED group only. */
  readonly declaredProbe: RepoProbe;
  readTargetRepoDeclaration(body: string): TargetRepoDeclaration;
  routeMilestone(input: RouteInput): MilestoneRouting;
  stagesRequiredFor(route: MilestoneRoute): readonly StageId[];
}

/** What the audit reports for one plan once it has PASSED its group's check. */
interface PlanVerdict {
  readonly path: string;
  readonly declared: boolean;
  readonly value: string | null;
  readonly route: MilestoneRoute;
  readonly repo: string;
}

interface SweepModule {
  INVOKING: string;
  OTHER_TOOLKIT_REPO: string;
  TOOLKIT_LESS_REPO: string;
  allPlanFiles(): string[];
  planBody(frontmatterExtra?: string[]): string;
  fixtureProbe(): RepoProbe;
  neverConsultedProbe(): RepoProbe;
  /** Grade ONE plan. Returns its verdict, or THROWS naming the plan. */
  auditPlanRouting(path: string, body: string, deps: SweepDeps): PlanVerdict;
  /** Grade a whole corpus. One verdict per entry, in order. */
  auditPlanCorpus(plans: readonly PlanEntry[], deps: SweepDeps): PlanVerdict[];
}

async function sweep(): Promise<SweepModule> {
  return (await import(SWEEP_MODULE)) as unknown as SweepModule;
}

// ===========================================================================
// Local helpers — stub routers. These are how a mutant is expressed.
// ===========================================================================

/** A routing object of the caller's choosing, with the invariant fields sane. */
function routingOf(over: {
  route: MilestoneRoute;
  repo: string;
  declared: boolean;
  specWrite: "inline" | "worker";
  chain: readonly StageId[];
  ceremony?: boolean;
}): MilestoneRouting {
  return {
    route: over.route,
    repo: over.repo,
    declared: over.declared,
    specWrite: over.specWrite,
    chain: over.chain,
    ceremony: over.ceremony ?? true,
    workers: 1,
    concurrency: MAX_CONCURRENT_WORKERS,
  };
}

/** The correct answer for an undeclared plan — what today's router returns. */
function healthyInvoking(invokingRepo: string): MilestoneRouting {
  return routingOf({
    route: "invoking",
    repo: invokingRepo,
    declared: false,
    specWrite: "inline",
    chain: FULL_CHAIN_STAGES,
  });
}

/** A router that records every call and answers with a fixed routing. */
function recordingRouter(answer: (input: RouteInput) => MilestoneRouting): {
  route: (input: RouteInput) => MilestoneRouting;
  calls: RouteInput[];
} {
  const calls: RouteInput[] = [];
  return {
    calls,
    route(input: RouteInput): MilestoneRouting {
      calls.push(input);
      return answer(input);
    },
  };
}

/**
 * The router stub the AC.3 corpus legs need: today's healthy answer for an
 * UNDECLARED plan, and the SHIPPED router for a declared one.
 *
 * Returning `healthyInvoking` unconditionally is M129's forbidden invariant a
 * third time — it claims every plan in the corpus declares nothing. Measured
 * 2026-09-17, by the same-file grading leg AC.4 gained: with one real declaring
 * plan on disk both legs below refused on THAT plan ("declares a target repo
 * ... but was routed as if it declared nothing") instead of on the plan they
 * poisoned, so the mutant kill was grading the wrong subject.
 */
function healthyUnlessDeclared(): (input: RouteInput) => MilestoneRouting {
  return (input: RouteInput) =>
    readTargetRepoDeclaration(input.planBody).declared
      ? routeMilestone(input)
      : healthyInvoking(input.invokingRepo);
}

function depsWith(
  mod: SweepModule,
  over: Partial<SweepDeps> = {},
): SweepDeps {
  return {
    invokingRepo: mod.INVOKING,
    declaredProbe: corpusProbe(mod),
    readTargetRepoDeclaration,
    routeMilestone,
    stagesRequiredFor,
    ...over,
  };
}

/**
 * The probe the corpus legs get: the three synthetic fixtures FIRST, then the
 * SHIPPED `defaultRepoProbe` for anything else.
 *
 * MEASURED 2026-09-17, and the reason this exists. With a bare `fixtureProbe()`
 * here, writing one real plan that uses the shipped `target_repo:` declaration
 * turned FOUR tests in this file red — every one of them a corpus leg — with
 * `this plan declares a target repo (...) that the probe cannot locate`. That
 * is M129's "no real plan declares a target repo" invariant, the one STE-600
 * calls the WRONG invariant, re-homed into the file written to remove it. A
 * fixture-only probe cannot locate a real tree, so the corpus legs forbade the
 * very declaration the partition admits.
 *
 * Fixtures are consulted first so the synthetic cases keep their exact
 * behaviour — `TOOLKIT_LESS_REPO` must still report no toolkit even though no
 * such directory exists on disk for the real probe to inspect.
 */
function corpusProbe(mod: SweepModule): RepoProbe {
  const fixture = mod.fixtureProbe();
  const shipped = defaultRepoProbe(REPO_ROOT);
  const SYNTHETIC = new Set([
    mod.INVOKING,
    mod.OTHER_TOOLKIT_REPO,
    mod.TOOLKIT_LESS_REPO,
  ]);
  return {
    locate: (declared: string): string | null =>
      fixture.locate(declared) ?? shipped.locate(declared),
    hasToolkit: (repoPath: string): boolean =>
      SYNTHETIC.has(repoPath)
        ? fixture.hasToolkit(repoPath)
        : shipped.hasToolkit(repoPath),
  };
}

/** Run `fn`, return the thrown Error, and fail loudly when nothing threw. */
function captureThrow(fn: () => unknown, label: string): Error {
  let raised: unknown = null;
  let returned: unknown = null;
  try {
    returned = fn();
  } catch (e) {
    raised = e;
  }
  expect(raised, `${label}: nothing was refused (returned ${String(returned)})`)
    .not.toBeNull();
  return raised as Error;
}

// ===========================================================================
// TRIPWIRES — the surfaces this FR's edits ride against.
// ===========================================================================

describe("TRIPWIRE — the sweep's neighbours are unchanged", () => {
  test("the FR still names all FOUR ACs this file is written against", () => {
    const active = join(REPO_ROOT, "specs", "frs", "STE-600.md");
    const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-600.md");
    const frFile = existsSync(active) ? active : archived;
    expect(existsSync(frFile), "STE-600.md found in neither frs/ nor archive/")
      .toBe(true);
    const fr = read(frFile);
    for (let n = 1; n <= 4; n++) {
      expect(fr, `AC-STE-600.${n} missing from the FR`).toContain(
        `AC-STE-600.${n}:`,
      );
    }
  });

  test("the M129 suite keeps its pinned declaration count of 67", () => {
    // `m143-ste-549-driven-signal.test.ts` freezes this suite's `test(` count
    // as a literal. The rewrite is a partition INSIDE the existing sweep test,
    // not new tests, so this number must not move — if it does, a suite this FR
    // never mentions goes red and the cause looks unrelated.
    const declared = read(M129_SUITE_FILE)
      .split("\n")
      .filter((line) => /^\s*test\(/.test(line)).length;
    expect(declared).toBe(67);
  });

  test("the production routing module is NOT the subject — it stays put", () => {
    // This FR changes a test's premise. A "fix" that edits the router instead
    // fails here rather than in review.
    expect([...FULL_CHAIN_STAGES]).toEqual(["implement", "ship-milestone", "pr"]);
    expect(
      routeMilestone({
        planBody: "---\nmilestone: M900\n---\n",
        invokingRepo: "/abs/invoking-repo",
      }).route,
    ).toBe("invoking");
  });

  test("the shared sweep module is a helper, not a collected test file", () => {
    // `tests/_*.ts` is the house shape for a module two suites share; a
    // `.test.ts` name would make bun run the sweep twice.
    expect(existsSync(SWEEP_MODULE_FILE), `${SWEEP_MODULE_FILE} is missing`).toBe(
      true,
    );
    expect(SWEEP_MODULE_FILE.endsWith(".test.ts")).toBe(false);
  });

  test("the M129 sweep DELEGATES to the shared unit rather than inlining it", async () => {
    // The reachability claim, stated where it can be checked: if the per-plan
    // assertion is still inlined in the loop body, nothing outside that loop
    // can ever exercise the declared group.
    await sweep();
    const suite = read(M129_SUITE_FILE);
    expect(suite, "the M129 suite does not import the shared sweep unit")
      .toContain("_target_repo_sweep");
    expect(
      suite,
      "the sweep still forbids a plan from declaring a target repo",
    ).not.toContain("unexpectedly declares a target repo");
  });

  test("the injected stub routers are distinguishable — the mutants are real", () => {
    // Without this control, every "a mutant router is rejected" pin below could
    // be passing because the mutant and the healthy answer are the same object.
    const healthy = healthyInvoking("/abs/invoking-repo");
    const mutant = routingOf({
      route: "cross_repo_toolkit",
      repo: "/abs/other-toolkit-repo",
      declared: false,
      specWrite: "worker",
      chain: stagesRequiredFor("cross_repo_toolkit"),
    });
    expect(healthy).not.toEqual(mutant);
    expect(healthy.repo).not.toBe(mutant.repo);
  });
});

// ===========================================================================
// AC-STE-600.1 — the undeclared invariant survives unchanged: every plan that
// declares nothing routes to the invoking repo with the full chain, and the
// probe is never consulted on that path.
// ===========================================================================

describe("AC-STE-600.1 — the undeclared group keeps today's invariant", () => {
  test("an undeclared plan is admitted, and its verdict names the invoking route", async () => {
    const mod = await sweep();
    const verdict = mod.auditPlanRouting(
      "specs/plan/M_synthetic.md",
      mod.planBody(),
      depsWith(mod),
    );
    expect(verdict).toEqual({
      path: "specs/plan/M_synthetic.md",
      declared: false,
      value: null,
      route: "invoking",
      repo: mod.INVOKING,
    });
  });

  test("the probe handed to an undeclared plan THROWS if it is consulted", async () => {
    // "Undeclared never even looks for another tree" is asserted, not inferred:
    // the unit must supply a throwing probe of its own, never the declared
    // group's probe and never `undefined` (which would let the router fall back
    // to the real filesystem probe).
    const mod = await sweep();
    const router = recordingRouter((input) => healthyInvoking(input.invokingRepo));
    const deps = depsWith(mod, { routeMilestone: router.route });
    mod.auditPlanRouting("specs/plan/M_synthetic.md", mod.planBody(), deps);

    expect(router.calls.length, "the router was not called at all").toBe(1);
    const handed = router.calls[0]!.probe;
    expect(handed, "the undeclared path handed the router NO probe").toBeDefined();
    expect(handed, "the undeclared path reused the DECLARED group's probe")
      .not.toBe(deps.declaredProbe);
    expect(() => handed!.locate("/abs/anything")).toThrow();
    expect(() => handed!.hasToolkit("/abs/anything")).toThrow();
  });

  test("END TO END: a router that consults the probe on an undeclared plan fails", async () => {
    const mod = await sweep();
    const router = recordingRouter((input) => {
      input.probe?.locate("/abs/anything");
      return healthyInvoking(input.invokingRepo);
    });
    const err = captureThrow(
      () =>
        mod.auditPlanRouting(
          "specs/plan/M_synthetic.md",
          mod.planBody(),
          depsWith(mod, { routeMilestone: router.route }),
        ),
      "consulted probe",
    );
    expect(err.message).toMatch(/probe/i);
  });

  test("the undeclared group is still held to the FULL chain and inline spec-writing", async () => {
    const mod = await sweep();
    for (const [label, answer] of [
      [
        "a short chain",
        routingOf({
          route: "invoking",
          repo: mod.INVOKING,
          declared: false,
          specWrite: "inline",
          chain: ["pr"] as StageId[],
        }),
      ],
      [
        "spec-writing moved into a worker",
        routingOf({
          route: "invoking",
          repo: mod.INVOKING,
          declared: false,
          specWrite: "worker",
          chain: FULL_CHAIN_STAGES,
        }),
      ],
    ] as const) {
      const err = captureThrow(
        () =>
          mod.auditPlanRouting(
            "specs/plan/M_synthetic.md",
            mod.planBody(),
            depsWith(mod, { routeMilestone: () => answer }),
          ),
        label,
      );
      expect(err.message, label).toContain("specs/plan/M_synthetic.md");
    }
  });

  test("REAL CORPUS: every plan on disk is admitted, all of them undeclared today", async () => {
    // The spine, unchanged in substance from the sweep it replaces: the whole
    // corpus, graded through the same unit, with a probe that throws if
    // consulted. The count is asserted so the walk cannot pass over zero files.
    const mod = await sweep();
    const files = mod.allPlanFiles();
    expect(files.length).toBeGreaterThanOrEqual(100);
    const verdicts = mod.auditPlanCorpus(
      files.map((path) => ({ path, body: read(path) })),
      depsWith(mod),
    );
    expect(verdicts.length, "a plan silently escaped the walk").toBe(files.length);
    // PARTITIONED, not blanket. Asserting `invoking` over EVERY verdict, or
    // that the declared group is empty, is M129's forbidden invariant written
    // again — it fails the moment a real plan uses the shipped declaration,
    // which is the thing STE-600 exists to make possible.
    const undeclared = verdicts.filter((v) => !v.declared);
    expect(
      undeclared.length,
      "no undeclared plan on disk — the invariant below would be vacuous",
    ).toBeGreaterThan(0);
    for (const v of undeclared) {
      expect(v.route, v.path).toBe("invoking");
      expect(v.repo, v.path).toBe(mod.INVOKING);
    }
    // The declared group is ADMITTED and graded, never counted down to zero.
    for (const v of verdicts.filter((x) => x.declared)) {
      expect(v.route, v.path).not.toBe("invoking");
      expect(v.repo, v.path).not.toBe(mod.INVOKING);
    }
  });
});

// ===========================================================================
// AC-STE-600.2 — a plan that DOES declare a target repo is ADMITTED by the
// sweep, and its declared routing is asserted rather than skipped.
// ===========================================================================

describe("AC-STE-600.2 — a declaring plan is admitted, and graded", () => {
  test("a cross-repo declaration is admitted — no throw — with its routing reported", async () => {
    const mod = await sweep();
    const verdict = mod.auditPlanRouting(
      "specs/plan/M_declares.md",
      mod.planBody([`target_repo: ${mod.OTHER_TOOLKIT_REPO}`]),
      depsWith(mod),
    );
    expect(verdict).toEqual({
      path: "specs/plan/M_declares.md",
      declared: true,
      value: mod.OTHER_TOOLKIT_REPO,
      route: "cross_repo_toolkit",
      repo: mod.OTHER_TOOLKIT_REPO,
    });
  });

  test("a toolkit-less declaration is admitted too, on its own reduced route", async () => {
    const mod = await sweep();
    const verdict = mod.auditPlanRouting(
      "specs/plan/M_reduced.md",
      mod.planBody([`target_repo: ${mod.TOOLKIT_LESS_REPO}`]),
      depsWith(mod),
    );
    expect(verdict.declared).toBe(true);
    expect(verdict.route).toBe("reduced");
    expect(verdict.repo).toBe(mod.TOOLKIT_LESS_REPO);
  });

  test("the declared plan is routed with the DECLARED probe, not a throwing one", async () => {
    const mod = await sweep();
    const router = recordingRouter(() =>
      routingOf({
        route: "cross_repo_toolkit",
        repo: mod.OTHER_TOOLKIT_REPO,
        declared: true,
        specWrite: "worker",
        chain: stagesRequiredFor("cross_repo_toolkit"),
      }),
    );
    const deps = depsWith(mod, { routeMilestone: router.route });
    mod.auditPlanRouting(
      "specs/plan/M_declares.md",
      mod.planBody([`target_repo: ${mod.OTHER_TOOLKIT_REPO}`]),
      deps,
    );
    expect(router.calls.length).toBe(1);
    expect(
      router.calls[0]!.probe,
      "the declared path did not use the injected probe",
    ).toBe(deps.declaredProbe);
  });

  test("ASSERTED, NOT SKIPPED: a declared plan routed as undeclared is rejected", async () => {
    // The teeth of AC.2. A sweep that "admits" a declaring plan by handing it a
    // free pass would pass every other leg in this block; it fails here,
    // because the declaration must be CHECKED against where the work landed.
    const mod = await sweep();
    const err = captureThrow(
      () =>
        mod.auditPlanRouting(
          "specs/plan/M_declares.md",
          mod.planBody([`target_repo: ${mod.OTHER_TOOLKIT_REPO}`]),
          depsWith(mod, {
            routeMilestone: () => healthyInvoking(mod.INVOKING),
          }),
        ),
      "declared plan routed to the invoking repo",
    );
    expect(err.message).toContain("specs/plan/M_declares.md");
    expect(err.message).toMatch(/declar/i);
  });

  test("ASSERTED, NOT SKIPPED: a declared plan landing in the WRONG tree is rejected", async () => {
    const mod = await sweep();
    const err = captureThrow(
      () =>
        mod.auditPlanRouting(
          "specs/plan/M_declares.md",
          mod.planBody([`target_repo: ${mod.OTHER_TOOLKIT_REPO}`]),
          depsWith(mod, {
            routeMilestone: () =>
              routingOf({
                route: "cross_repo_toolkit",
                repo: mod.TOOLKIT_LESS_REPO,
                declared: true,
                specWrite: "worker",
                chain: stagesRequiredFor("cross_repo_toolkit"),
              }),
          }),
        ),
      "declared plan landed in another tree",
    );
    expect(err.message).toContain("specs/plan/M_declares.md");
  });

  test("CORPUS: the real corpus plus ONE declaring plan is admitted whole", async () => {
    // What went red on 2026-09-16, expressed at the level the sweep works at:
    // the same walk, the same unit, one entry that uses the shipped feature.
    const mod = await sweep();
    const files = mod.allPlanFiles();
    const corpus: PlanEntry[] = [
      ...files.map((path) => ({ path, body: read(path) })),
      {
        path: "specs/plan/M_declares.md",
        body: mod.planBody([`target_repo: ${mod.OTHER_TOOLKIT_REPO}`]),
      },
    ];
    // The baseline is MEASURED off the real corpus rather than assumed to be
    // zero: pinning the total at 1 forbids every real plan from declaring, and
    // that is the invariant this FR removes.
    const baseline = mod
      .auditPlanCorpus(files.map((path) => ({ path, body: read(path) })), depsWith(mod))
      .filter((v) => v.declared).length;
    const verdicts = mod.auditPlanCorpus(corpus, depsWith(mod));
    expect(verdicts.length).toBe(corpus.length);
    const declared = verdicts.filter((v) => v.declared);
    expect(declared.length, "the declaring plan was dropped from the walk").toBe(
      baseline + 1,
    );
    const mine = declared.find((v) => v.path === "specs/plan/M_declares.md");
    expect(mine, "the declaring plan is absent from the declared group").toBeDefined();
    expect(mine!.repo).toBe(mod.OTHER_TOOLKIT_REPO);
    expect(mine!.route).toBe("cross_repo_toolkit");
  });
});

// ===========================================================================
// AC-STE-600.3 — the rewrite is not a tautology: an undeclared plan routed
// anywhere other than the invoking repo still FAILS the sweep.
// ===========================================================================

describe("AC-STE-600.3 — the undeclared guard still has teeth", () => {
  const MISROUTES: ReadonlyArray<{
    readonly label: string;
    readonly routing: (mod: SweepModule) => MilestoneRouting;
  }> = [
    {
      label: "routed cross-repo",
      routing: (mod) =>
        routingOf({
          route: "cross_repo_toolkit",
          repo: mod.OTHER_TOOLKIT_REPO,
          declared: false,
          specWrite: "worker",
          chain: stagesRequiredFor("cross_repo_toolkit"),
        }),
    },
    {
      label: "routed reduced",
      routing: (mod) =>
        routingOf({
          route: "reduced",
          repo: mod.TOOLKIT_LESS_REPO,
          declared: false,
          specWrite: "worker",
          chain: stagesRequiredFor("reduced"),
          ceremony: false,
        }),
    },
    {
      label: "route says invoking but the REPO drifted",
      routing: (mod) =>
        routingOf({
          route: "invoking",
          repo: mod.OTHER_TOOLKIT_REPO,
          declared: false,
          specWrite: "inline",
          chain: FULL_CHAIN_STAGES,
        }),
    },
  ];

  test("an undeclared plan routed off the invoking repo is REJECTED, every way", async () => {
    const mod = await sweep();
    for (const mutant of MISROUTES) {
      const err = captureThrow(
        () =>
          mod.auditPlanRouting(
            "specs/plan/M_synthetic.md",
            mod.planBody(),
            depsWith(mod, { routeMilestone: () => mutant.routing(mod) }),
          ),
        mutant.label,
      );
      expect(err.message, mutant.label).toContain("specs/plan/M_synthetic.md");
    }
  });

  test("PAIRED ARM: the same unit accepts the same plan when it routes correctly", async () => {
    // The other half of the mutant kill. Without it, "the mutants are rejected"
    // would be satisfied by a unit that rejects everything.
    const mod = await sweep();
    const verdict = mod.auditPlanRouting(
      "specs/plan/M_synthetic.md",
      mod.planBody(),
      depsWith(mod, {
        routeMilestone: () => healthyInvoking(mod.INVOKING),
      }),
    );
    expect(verdict.route).toBe("invoking");
    expect(verdict.repo).toBe(mod.INVOKING);
    expect(verdict.declared).toBe(false);
  });

  test("CORPUS: one misrouted plan among the real corpus reds the whole walk", async () => {
    // The partition must not have moved the teeth off the walk: a single bad
    // plan in a hundred good ones is still a failure, and the failure names it.
    const mod = await sweep();
    const files = mod.allPlanFiles();
    const poisoned = files[Math.floor(files.length / 2)]!;
    const err = captureThrow(
      () =>
        mod.auditPlanCorpus(
          files.map((path) => ({ path, body: read(path) })),
          depsWith(mod, {
            routeMilestone: (input: RouteInput) =>
              input.planBody === read(poisoned)
                ? routingOf({
                    route: "cross_repo_toolkit",
                    repo: mod.OTHER_TOOLKIT_REPO,
                    declared: false,
                    specWrite: "worker",
                    chain: stagesRequiredFor("cross_repo_toolkit"),
                  })
                : healthyUnlessDeclared()(input),
          }),
        ),
      "one misrouted plan in the corpus",
    );
    expect(err.message).toContain(poisoned);
  });

  test("NON-VACUITY: that same corpus passes when nothing is poisoned", async () => {
    const mod = await sweep();
    const files = mod.allPlanFiles();
    const verdicts = mod.auditPlanCorpus(
      files.map((path) => ({ path, body: read(path) })),
      depsWith(mod, { routeMilestone: healthyUnlessDeclared() }),
    );
    expect(verdicts.length).toBe(files.length);
  });
});

// ===========================================================================
// AC-STE-600.4 — the sibling meta-test passes WITHOUT being edited, because the
// suite it grades is genuinely green with a declaring plan on disk.
// ===========================================================================

describe("AC-STE-600.4 — the M129 suite is green with a real declaring plan", () => {
  // A plan file that uses the shipped feature exactly as a cross-repo milestone
  // would. It declares an ABSOLUTE path that exists on every checkout, so the
  // sweep's declared group resolves it whichever invoking repo it routes from.
  //
  // The NAME sorts ahead of every plan in the corpus, and that is load-bearing
  // rather than cosmetic. `allPlanFiles()` sorts, and the M129 suite has a
  // second test that reaches for position 0 — so a probe plan landing anywhere
  // else leaves the first-slot hazard untested, which is how the repaired
  // premise survived one test below its own repair.
  const DECLARING_PLAN_FILE = join(REPO_ROOT, "specs", "plan", "M_00600d.md");
  const declaringPlan = (): string =>
    [
      "---",
      "milestone: M_00600d",
      "status: active",
      "archived_at: null",
      "kickoff_branch: null",
      "frozen_at: null",
      "migration: none",
      `target_repo: ${REPO_ROOT}`,
      "---",
      "",
      "# Implementation Plan",
      "",
      "## M_00600d — a milestone that targets a repo {#M_00600d}",
      "",
    ].join("\n");

  // SECOND NET, and the reason there has to be one. This probe plan is written
  // into the LIVE `specs/plan/` tree, not a temp dir — it has to be, because
  // the child `bun test` walks the real corpus and that is the whole point of
  // the leg. The `finally` below covers every in-process outcome including a
  // throw and bun's own per-test timeout; it does NOT cover the process dying
  // under it. `exit` catches a normal or uncaught-exception exit, and the two
  // signals catch an operator's Ctrl-C or a supervisor's SIGTERM.
  //
  // WHAT REMAINS, named rather than assumed away: SIGKILL cannot be caught by
  // anything, so a hard kill still leaves the file. It is left UNTRACKED, so
  // `git status` shows it and the pre-write guard below refuses the next run by
  // name instead of quietly writing over it.
  const sweepProbePlan = (): void => {
    try {
      rmSync(DECLARING_PLAN_FILE, { force: true });
    } catch {
      // A cleanup that throws on the way out would mask the real failure.
    }
  };
  process.on("exit", sweepProbePlan);
  process.on("SIGINT", sweepProbePlan);
  process.on("SIGTERM", sweepProbePlan);

  test.skipIf(IS_SPAWNED_CHILD)(
    "MEASURED: with a declaring plan on disk, BOTH suites exit 0 with 0 fail",
    () => {
      // The 2026-09-16 failure, reproduced: writing the first plan that uses
      // `target_repo:` turned this suite red, and AC-STE-582.8 red with it.
      expect(
        existsSync(DECLARING_PLAN_FILE),
        `${DECLARING_PLAN_FILE} already exists. This test owns that path, so it` +
          " is debris from a run that was killed before its cleanup. Delete it" +
          " (`rm specs/plan/M_00600d.md`) and re-run — never commit it.",
      ).toBe(false);
      writeFileSync(DECLARING_PLAN_FILE, declaringPlan(), "utf-8");
      try {
        // A control first: the declaration really is one, so a green below
        // cannot come from a plan the reader never saw as declaring.
        const decl = readTargetRepoDeclaration(read(DECLARING_PLAN_FILE));
        expect(decl.declared, "the probe plan does not read as declaring").toBe(
          true,
        );
        expect(decl.value).toBe(REPO_ROOT);

        // BOTH suites, not just M129. Grading only the neighbour is how this
        // file came to re-home the forbidden invariant in its own corpus legs
        // and stay green: the file that proves the declaration is usable was
        // never itself run against a real declaring plan. Measured 2026-09-17
        // — four tests here went red under exactly this condition.
        //
        // `DPT_STE600_CHILD` stops the child re-entering this leg; without it
        // the spawn recurses without bound.
        for (const suite of [M129_SUITE_REL, OWN_SUITE_REL]) {
          const proc = Bun.spawnSync(["bun", "test", suite], {
            cwd: PLUGIN_ROOT,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env, DPT_STE600_CHILD: "1" },
          });
          const out = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
          expect(out, `${suite}: ${out.slice(0, 4000)}`).toMatch(/\b0 fail\b/);
          expect(proc.exitCode, suite).toBe(0);
        }
      } finally {
        rmSync(DECLARING_PLAN_FILE, { force: true });
      }
      expect(existsSync(DECLARING_PLAN_FILE), "the probe plan was left behind")
        .toBe(false);
    },
    180_000,
  );

  // The pinned block, hoisted so the pin below and its non-vacuity control
  // read ONE definition. A control that restates the pin grades its own copy.
  const BLOCK = [
    'describe("AC-STE-582.8 — the M129 target-repo suite passes with zero failures", () => {',
    "  test(",
    '    "bun test tests/m129-ste-495-target-repo.test.ts exits 0 with 0 fail",',
    "    () => {",
    "      const proc = Bun.spawnSync(",
    '        ["bun", "test", "tests/m129-ste-495-target-repo.test.ts"],',
    '        { cwd: PLUGIN_ROOT, stdout: "pipe", stderr: "pipe" },',
    "      );",
    "      const out = `${proc.stdout.toString()}\\n${proc.stderr.toString()}`;",
    "      expect(out).toMatch(/\\b0 fail\\b/);",
    "      expect(proc.exitCode).toBe(0);",
    "    },",
    "    120_000,",
    "  );",
    "});",
  ].join("\n");

  test("the sibling meta-test still grades that suite, verbatim and unedited", () => {
    // AC.4 says the sibling passes WITHOUT being edited. The block it passes
    // with is pinned here, so weakening it to buy a green fails this file
    // instead of going unnoticed.
    const sibling = read(SIBLING_FILE);
    expect(
      sibling,
      `${SIBLING_REL}: the AC-STE-582.8 grading block was edited`,
    ).toContain(BLOCK);
  });

  test("NON-VACUITY: the verbatim pin fails on a weakened block", () => {
    // Without this control, "the block is present" would be satisfied by a pin
    // that matches any text at all.
    const weakened = read(SIBLING_FILE).replace(
      "expect(proc.exitCode).toBe(0);",
      "// exit code no longer checked",
    );
    expect(weakened, "the mutation did not apply").not.toBe(read(SIBLING_FILE));
    // THE LOAD-BEARING LINE. Without it this test asserted that
    // `String.replace` replaces — true of any string, and silent about whether
    // the PIN would catch the weakening. Re-applying the pin's own `BLOCK` to
    // the mutated text is what makes it a control.
    expect(
      weakened,
      "the verbatim pin still matches a weakened block — it is vacuous",
    ).not.toContain(BLOCK);
  });
});
