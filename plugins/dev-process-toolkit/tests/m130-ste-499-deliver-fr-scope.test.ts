// M130 STE-499 — `/deliver` routes an FR identity at FR scope, not milestone
// scope.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-24, v2.68.0):
//
//   * `adapters/_shared/src/deliver_argument.ts:305-329` — the `fr_identity`
//     branch reads the FR body, parses `milestone:` out of its frontmatter,
//     assigns it to the local `milestone`, and returns. From the returned value
//     onward the FR is GONE: `DeliverRouting` has no field that carries it.
//   * `grep -c "scope" adapters/_shared/src/deliver_argument.ts` → 0. There is
//     no discriminator at all; `kind` is the only thing that still remembers
//     the operator named one FR, and the FR's own summary records that no
//     consumer reads it.
//   * So `/deliver STE-500` and `/deliver M130` are, to every downstream stage,
//     the SAME routing modulo `kind`: same `milestone`, same `planPath`, same
//     `entersDesignPhase`, and no `fr` anywhere.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * THE DEFECT IS A COLLAPSE, SO THE TESTS ASSERT THE THING THAT COLLAPSED.
//     A test that checks "the FR path carries milestone M130" passes TODAY,
//     under the shipped defect, and is worth nothing here — carrying the
//     milestone is precisely what the shipped code already does. Every AC.1/AC.2
//     assertion therefore names `scope` and `fr` explicitly, and never settles
//     for `kind`.
//   * FALSIFIABILITY IS EXECUTED, NOT CLAIMED. `assertFrScoped` is one predicate
//     applied twice: once to the real routing (must pass) and once to a
//     COLLAPSED copy — `{...routing, scope: "milestone", fr: null}`, i.e. the
//     shipped defect expressed as data — which must THROW. A pin that cannot
//     fail is not a pin, and this repo has killed four of them by mutation
//     before (M126).
//   * AC.5 IS A FIELD-BY-FIELD SNAPSHOT OF THE SHIPPED OUTPUT, not a restatement.
//     `shippedFields()` projects exactly the five fields `DeliverRouting` has
//     today and `toEqual`s a literal built from the fixture tree. And because a
//     routing that answered `scope: "milestone"` to EVERYTHING would satisfy
//     that snapshot, the same test asserts the FR path's snapshot differs and
//     its scope is `"fr"` — the milestone snapshot cannot be green while the
//     collapse is still in place.
//   * AC.4 REFUSALS RUN ON REAL DISK. `defaultIdentityProbe` against `mkdtemp`
//     trees, so "the FR file is absent" means absent from a filesystem rather
//     than absent from a stub's switch statement. Each refusal is asserted on
//     BOTH the NFR-10 three-line shape AND its distinguishing context token
//     (`fr=not-found`, `milestone=(absent)`, the malformed token verbatim,
//     `plan=not-found`) — shape alone is satisfied by every refusal in the file,
//     so shape alone would not tell the four apart.
//   * THE NON-TTY GATE IS ASSERTED AS AN ORDERING, NOT A RESULT. It refuses for
//     EVERY argument kind — including an FR identity that would otherwise have
//     resolved cleanly off the fixture tree — with an EXPLODING probe and an
//     EXPLODING sink injected. "Fires before any probe call" is then observable:
//     if the gate moved after the probe, the exploding probe's distinctive
//     error replaces the refusal and the shape assertion fails.
//   * PROSE STAYS PROSE, WATCHED NOT INFERRED. `entersDesignPhase` is
//     cross-checked against the injected `DeliverPhaseSink`'s recorded calls —
//     the flag and the side effect must agree, and the sink is asserted to have
//     been called exactly once with the operator's own words.
//
// DELIBERATE OMISSIONS.
//   * NO prose/skill-surface pins. This FR changes a routing value; the
//     `/deliver` chain prose that consumes the new scope is STE-500 and STE-501,
//     and pinning their surfaces here would redden on their schedule.
//   * NO `/gate-check` probe-count pin. This FR registers no probe.
//   * NO assertion about what an FR-scoped run DOES. Carrying the scope is this
//     FR by the spec's own framing ("even with no FR-scoped chain at all");
//     acting on it is STE-501.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REQUIRES_INPUT_REFUSED_MARKER } from "../adapters/_shared/src/requires_input";

// ===========================================================================
// The module under test, imported LAZILY through a locally-declared shape.
//
// The shipped `DeliverRouting` has no `scope` and no `fr`, so a static import
// typed against the shipped declaration could not even express the assertions
// below. The local interface is the INTENDED shape; the cast is what makes the
// gap show up as a red assertion rather than a compile error.
// ===========================================================================

const DELIVER_ARGUMENT_MODULE = "../adapters/_shared/src/deliver_argument";

type DeliverArgumentKind =
  | "milestone_identity"
  | "fr_identity"
  | "feature_request";

/** The discriminator this FR adds: what UNIT OF WORK the run delivers. */
type DeliverScope = "fr" | "milestone" | "design";

interface IdentityProbe {
  locatePlan(milestone: string): string | null;
  readFr(identity: string): string | null;
}

interface DeliverPhaseSink {
  enterDesign(request: string): void;
}

interface ResolveDeliverArgumentInput {
  readonly raw: string;
  readonly probe: IdentityProbe;
  readonly phases?: DeliverPhaseSink;
  readonly stdinIsTty?: boolean;
}

/** The INTENDED routing: today's five fields plus `scope` and `fr`. */
interface DeliverRouting {
  readonly kind: DeliverArgumentKind;
  readonly identity: string | null;
  readonly milestone: string | null;
  readonly planPath: string | null;
  readonly entersDesignPhase: boolean;
  /** Which unit of work this run delivers. */
  readonly scope: DeliverScope;
  /** The resolved FR identity, or `null` off the FR path. */
  readonly fr: string | null;
}

interface DeliverArgumentClassification {
  readonly kind: DeliverArgumentKind;
  readonly raw: string;
  readonly identity: string | null;
}

interface DeliverArgumentModule {
  DELIVER_SCOPES: readonly DeliverScope[];
  classifyDeliverArgument(raw: string): DeliverArgumentClassification;
  defaultIdentityProbe(repoRoot: string): IdentityProbe;
  resolveDeliverArgument(input: ResolveDeliverArgumentInput): DeliverRouting;
}

async function deliverArgument(): Promise<DeliverArgumentModule> {
  return (await import(
    DELIVER_ARGUMENT_MODULE
  )) as unknown as DeliverArgumentModule;
}

// ===========================================================================
// Fixture trees — real directories, so the refusals are filesystem verdicts.
// ===========================================================================

/** The milestone the fixture FRs belong to. Its plan EXISTS on the tree. */
const FIXTURE_MILESTONE = "M130";
/** A milestone token that is well-formed but has NO plan file. */
const MILESTONE_WITHOUT_PLAN = "M900";

const FR_OK = "STE-901"; // bound to M130, whose plan exists
const FR_NO_MILESTONE = "STE-902"; // frontmatter without `milestone:`
const FR_MALFORMED_MILESTONE = "STE-903"; // `milestone: Mx`
const FR_MILESTONE_WITHOUT_PLAN = "STE-904"; // bound to M900
const FR_ABSENT = "STE-999"; // no file at all
const MALFORMED_MILESTONE_TOKEN = "Mx";

/** An FR body whose frontmatter declares (or omits) `milestone:`. */
function frBody(milestone: string | null): string {
  return [
    "---",
    "title: a fixture requirement",
    ...(milestone === null ? [] : [`milestone: ${milestone}`]),
    "status: active",
    "archived_at: null",
    "---",
    "",
    "# a fixture requirement",
    "",
  ].join("\n");
}

interface FixtureTree {
  readonly root: string;
  readonly planPath: string;
  dispose(): void;
}

/**
 * Build a `specs/` tree the SHIPPED `defaultIdentityProbe` can walk: one plan
 * file, and four FRs covering the whole `milestone:` frontmatter space.
 */
function fixtureTree(): FixtureTree {
  const root = mkdtempSync(join(tmpdir(), "m130-ste-499-"));
  const planDir = join(root, "specs", "plan");
  const frsDir = join(root, "specs", "frs");
  mkdirSync(planDir, { recursive: true });
  mkdirSync(frsDir, { recursive: true });

  const planPath = join(planDir, `${FIXTURE_MILESTONE}.md`);
  writeFileSync(
    planPath,
    ["---", `milestone: ${FIXTURE_MILESTONE}`, "---", "", "# M130", ""].join(
      "\n",
    ),
    "utf-8",
  );

  writeFileSync(join(frsDir, `${FR_OK}.md`), frBody(FIXTURE_MILESTONE), "utf-8");
  writeFileSync(join(frsDir, `${FR_NO_MILESTONE}.md`), frBody(null), "utf-8");
  writeFileSync(
    join(frsDir, `${FR_MALFORMED_MILESTONE}.md`),
    frBody(MALFORMED_MILESTONE_TOKEN),
    "utf-8",
  );
  writeFileSync(
    join(frsDir, `${FR_MILESTONE_WITHOUT_PLAN}.md`),
    frBody(MILESTONE_WITHOUT_PLAN),
    "utf-8",
  );

  return {
    root,
    planPath,
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Run `fn` against a live fixture tree, tearing it down either way. */
async function withTree<T>(fn: (tree: FixtureTree) => Promise<T>): Promise<T> {
  const tree = fixtureTree();
  try {
    return await fn(tree);
  } finally {
    tree.dispose();
  }
}

// ===========================================================================
// Injectable doubles.
// ===========================================================================

/** A probe that FAILS LOUDLY if consulted at all. */
function explodingProbe(): IdentityProbe {
  return {
    locatePlan(): string | null {
      throw new Error("EXPLODING_PROBE: locatePlan was consulted");
    },
    readFr(): string | null {
      throw new Error("EXPLODING_PROBE: readFr was consulted");
    },
  };
}

/** A design-phase sink that records every entry. */
function recordingSink(): DeliverPhaseSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    enterDesign(request: string): void {
      calls.push(request);
    },
  };
}

/** A design-phase sink that FAILS LOUDLY if the design phase is entered. */
function explodingSink(): DeliverPhaseSink {
  return {
    enterDesign(): void {
      throw new Error("EXPLODING_SINK: the design phase was entered");
    },
  };
}

// ===========================================================================
// Assertion helpers.
// ===========================================================================

/** Capture the refusal a call raises, failing if it returned instead. */
function refusalFrom(fn: () => unknown, label: string): string {
  let returned: unknown;
  let raised: unknown = null;
  try {
    returned = fn();
  } catch (e) {
    raised = e;
  }
  expect(
    returned,
    `${label}: a routing came back instead of a refusal — the argument FELL THROUGH`,
  ).toBeUndefined();
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  const message = String((raised as Error).message);
  // An exploding double's error is NOT a refusal; catching it here and letting
  // the shape assertions run on it would read as a pass for the wrong reason.
  expect(message, `${label}: an injected double exploded instead`).not.toContain(
    "EXPLODING_",
  );
  return message;
}

/** Assert the NFR-10 canonical three-line refusal shape. */
function expectNfr10Shape(msg: string, label: string): void {
  expect(msg, `${label}: no Refusing:/Verdict: line`).toMatch(
    /^(Refusing|Verdict):/m,
  );
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
}

/**
 * The FIVE fields `DeliverRouting` ships with today, projected for AC.5's
 * field-by-field snapshot. Deliberately EXCLUDES `scope` and `fr` — the point
 * is that the pre-existing surface is untouched, and including the new fields
 * would make the snapshot re-assert this FR's own change instead.
 */
function shippedFields(routing: DeliverRouting): Record<string, unknown> {
  return {
    kind: routing.kind,
    identity: routing.identity,
    milestone: routing.milestone,
    planPath: routing.planPath,
    entersDesignPhase: routing.entersDesignPhase,
  };
}

/**
 * THE MUTATION PREDICATE for AC.1/AC.2.
 *
 * Applied to a real FR-path routing it must pass; applied to the COLLAPSED
 * copy — the shipped defect written out as data — it must throw. That second
 * application is what proves this assertion can fail, which "assert milestone
 * is carried" demonstrably cannot.
 */
function assertFrScoped(
  routing: DeliverRouting,
  expected: { fr: string; milestone: string },
): void {
  expect(routing.scope).toBe("fr");
  expect(routing.fr).toBe(expected.fr);
  expect(routing.milestone).toBe(expected.milestone);
}

/** The shipped defect as a data transform: FR scope collapsed into milestone. */
function collapsedIntoMilestoneScope(routing: DeliverRouting): DeliverRouting {
  return { ...routing, scope: "milestone", fr: null };
}

// ===========================================================================
// AC-STE-499.1 — `DeliverRouting` carries the FR identity and a scope
// discriminator separating an FR-scoped run from a milestone-scoped one.
// ===========================================================================

describe("AC-STE-499.1 — scope discriminator + carried FR identity", () => {
  test("the scope vocabulary is exported and is exactly the three units of work", async () => {
    const mod = await deliverArgument();
    expect(
      mod.DELIVER_SCOPES,
      "DELIVER_SCOPES is not exported — there is no scope vocabulary",
    ).toBeDefined();
    expect([...mod.DELIVER_SCOPES].sort()).toEqual([
      "design",
      "fr",
      "milestone",
    ]);
  });

  test("an FR-scoped routing declares scope 'fr' and carries the FR identity", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      assertFrScoped(routing, {
        fr: FR_OK,
        milestone: FIXTURE_MILESTONE,
      });
    });
  });

  test("the discriminator is separating, not decorative: milestone scope differs from FR scope", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const probe = mod.defaultIdentityProbe(tree.root);
      const fr = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe,
        phases: explodingSink(),
        stdinIsTty: true,
      });
      const milestone = mod.resolveDeliverArgument({
        raw: FIXTURE_MILESTONE,
        probe,
        phases: explodingSink(),
        stdinIsTty: true,
      });
      // Same milestone, same plan file — and yet NOT the same unit of work.
      expect(fr.milestone).toBe(milestone.milestone);
      expect(fr.planPath).toBe(milestone.planPath);
      expect(fr.scope).not.toBe(milestone.scope);
      expect(fr.fr).toBe(FR_OK);
      expect(milestone.fr).toBeNull();
    });
  });

  test("MUTATION: the FR-scope assertion FAILS on a routing collapsed into milestone scope", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      const expectation = { fr: FR_OK, milestone: FIXTURE_MILESTONE };
      // The predicate passes on the real thing …
      assertFrScoped(routing, expectation);
      // … and MUST reject the shipped defect. If this does not throw, every
      // AC.1/AC.2 assertion in this file is vacuous.
      expect(() =>
        assertFrScoped(collapsedIntoMilestoneScope(routing), expectation),
      ).toThrow();
    });
  });
});

// ===========================================================================
// AC-STE-499.2 — FR identity → FR scope; milestone identity → milestone scope;
// prose still enters the design phase.
// ===========================================================================

describe("AC-STE-499.2 — one scope per argument kind", () => {
  test("an FR identity resolves to FR scope", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      expect(routing.kind).toBe("fr_identity");
      expect(routing.scope).toBe("fr");
      expect(routing.fr).toBe(FR_OK);
      expect(routing.entersDesignPhase).toBe(false);
    });
  });

  test("a milestone identity resolves to milestone scope and carries NO fr", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FIXTURE_MILESTONE,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      expect(routing.kind).toBe("milestone_identity");
      expect(routing.scope).toBe("milestone");
      expect(routing.fr).toBeNull();
      expect(routing.entersDesignPhase).toBe(false);
    });
  });

  test("prose still enters the design phase — observed through the sink, not inferred", async () => {
    const mod = await deliverArgument();
    const prose = "add a dark mode toggle to the settings screen";
    const sink = recordingSink();
    const routing = mod.resolveDeliverArgument({
      raw: prose,
      // Prose consults NO probe; an exploding one proves that rather than
      // assuming it.
      probe: explodingProbe(),
      phases: sink,
      stdinIsTty: true,
    });
    expect(routing.kind).toBe("feature_request");
    expect(routing.scope).toBe("design");
    expect(routing.fr).toBeNull();
    expect(routing.identity).toBeNull();
    // The flag and the SIDE EFFECT must agree — either alone is inference.
    expect(routing.entersDesignPhase).toBe(true);
    expect(sink.calls).toEqual([prose]);
  });

  test("prose that MENTIONS an FR token mid-sentence stays design scope", async () => {
    const mod = await deliverArgument();
    const prose = "follow up on STE-499 with a proper end-to-end fixture";
    const sink = recordingSink();
    const routing = mod.resolveDeliverArgument({
      raw: prose,
      probe: explodingProbe(),
      phases: sink,
      stdinIsTty: true,
    });
    expect(routing.scope).toBe("design");
    expect(routing.fr).toBeNull();
    expect(sink.calls).toEqual([prose]);
  });

  test("every kind maps into the exported scope vocabulary", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const probe = mod.defaultIdentityProbe(tree.root);
      const scopes = [
        mod.resolveDeliverArgument({
          raw: FR_OK,
          probe,
          stdinIsTty: true,
        }).scope,
        mod.resolveDeliverArgument({
          raw: FIXTURE_MILESTONE,
          probe,
          stdinIsTty: true,
        }).scope,
        mod.resolveDeliverArgument({
          raw: "make the export faster for big accounts",
          probe: explodingProbe(),
          phases: recordingSink(),
          stdinIsTty: true,
        }).scope,
      ];
      for (const scope of scopes) {
        expect([...mod.DELIVER_SCOPES]).toContain(scope);
      }
      // Three kinds, three DISTINCT scopes — a resolver that answered one scope
      // to everything fails here.
      expect(new Set(scopes).size).toBe(3);
    });
  });
});

// ===========================================================================
// AC-STE-499.3 — the FR's milestone is still resolved and carried.
// ===========================================================================

describe("AC-STE-499.3 — the milestone survives FR scoping", () => {
  test("the FR routing carries the milestone parsed from the FR's own frontmatter", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      expect(routing.milestone).toBe(FIXTURE_MILESTONE);
      // NOT the identity — proof the token came from the frontmatter rather
      // than from echoing the argument back.
      expect(routing.milestone).not.toBe(routing.identity);
      expect(routing.fr).toBe(FR_OK);
    });
  });

  test("the FR routing carries the located plan path for the resolved milestone", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      // The exact file on disk, because `/spec-archive M<N>` and
      // `/ship-milestone M<N>` downstream need it.
      expect(routing.planPath).toBe(tree.planPath);
    });
  });
});

// ===========================================================================
// AC-STE-499.4 — every refusal already on the FR path fires on unchanged terms.
// ===========================================================================

describe("AC-STE-499.4 — refusals fire on unchanged terms", () => {
  test("FR file absent → refuses with fr=not-found", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const msg = refusalFrom(
        () =>
          mod.resolveDeliverArgument({
            raw: FR_ABSENT,
            probe: mod.defaultIdentityProbe(tree.root),
            // A refusal must NEVER fall through to the design phase.
            phases: explodingSink(),
            stdinIsTty: true,
          }),
        "FR absent",
      );
      expectNfr10Shape(msg, "FR absent");
      expect(msg).toContain("fr=not-found");
      expect(msg).toContain(FR_ABSENT);
    });
  });

  test("`milestone:` absent → refuses naming the absence", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const msg = refusalFrom(
        () =>
          mod.resolveDeliverArgument({
            raw: FR_NO_MILESTONE,
            probe: mod.defaultIdentityProbe(tree.root),
            phases: explodingSink(),
            stdinIsTty: true,
          }),
        "milestone absent",
      );
      expectNfr10Shape(msg, "milestone absent");
      expect(msg).toContain("milestone=(absent)");
      expect(msg).toContain(FR_NO_MILESTONE);
    });
  });

  test("`milestone:` malformed → refuses naming the malformed token verbatim", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const msg = refusalFrom(
        () =>
          mod.resolveDeliverArgument({
            raw: FR_MALFORMED_MILESTONE,
            probe: mod.defaultIdentityProbe(tree.root),
            phases: explodingSink(),
            stdinIsTty: true,
          }),
        "milestone malformed",
      );
      expectNfr10Shape(msg, "milestone malformed");
      expect(msg).toContain(`milestone=${MALFORMED_MILESTONE_TOKEN}`);
      // Distinguishable from the ABSENT case — the two refusals must not
      // collapse into one another.
      expect(msg).not.toContain("(absent)");
    });
  });

  test("FR resolves to a milestone with no plan → refuses with plan=not-found", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const msg = refusalFrom(
        () =>
          mod.resolveDeliverArgument({
            raw: FR_MILESTONE_WITHOUT_PLAN,
            probe: mod.defaultIdentityProbe(tree.root),
            phases: explodingSink(),
            stdinIsTty: true,
          }),
        "plan absent",
      );
      expectNfr10Shape(msg, "plan absent");
      expect(msg).toContain("plan=not-found");
      expect(msg).toContain(MILESTONE_WITHOUT_PLAN);
    });
  });

  test("non-tty stdin refuses EVERY argument kind, BEFORE any probe call", async () => {
    const mod = await deliverArgument();
    const args: ReadonlyArray<[string, string]> = [
      [FR_OK, "fr_identity"],
      [FIXTURE_MILESTONE, "milestone_identity"],
      ["add a dark mode toggle to the settings screen", "feature_request"],
    ];
    for (const [raw, kind] of args) {
      const label = `non-tty ${kind}`;
      const msg = refusalFrom(
        () =>
          mod.resolveDeliverArgument({
            raw,
            // If the gate ever moved AFTER the probe, this double's error would
            // replace the refusal and `refusalFrom` fails on EXPLODING_.
            probe: explodingProbe(),
            phases: explodingSink(),
            stdinIsTty: false,
          }),
        label,
      );
      expectNfr10Shape(msg, label);
      expect(msg, `${label}: no stdin=non-tty context token`).toContain(
        "stdin=non-tty",
      );
      expect(msg, `${label}: kind not named in context`).toContain(
        `kind=${kind}`,
      );
      // The requires-input class marker, IMPORTED not retyped.
      expect(msg, `${label}: not the requires-input refusal class`).toContain(
        REQUIRES_INPUT_REFUSED_MARKER,
      );
    }
  });

  test("ISOLATION: the same FR that refuses under non-tty resolves cleanly under a tty", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      // Without this leg, "everything refuses" would satisfy AC.4 entirely.
      expect(routing.scope).toBe("fr");
      expect(routing.fr).toBe(FR_OK);
    });
  });
});

// ===========================================================================
// AC-STE-499.5 — a milestone-identity run is byte-identical to today.
// ===========================================================================

describe("AC-STE-499.5 — the milestone path is unchanged, asserted", () => {
  test("every SHIPPED field of a milestone-identity routing matches, field by field", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const routing = mod.resolveDeliverArgument({
        raw: FIXTURE_MILESTONE,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: explodingSink(),
        stdinIsTty: true,
      });
      // Not a restatement — a literal, built from the fixture tree.
      expect(shippedFields(routing)).toEqual({
        kind: "milestone_identity",
        identity: FIXTURE_MILESTONE,
        milestone: FIXTURE_MILESTONE,
        planPath: tree.planPath,
        entersDesignPhase: false,
      });
    });
  });

  test("that snapshot is NOT satisfiable by a routing that answers milestone scope to everything", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const probe = mod.defaultIdentityProbe(tree.root);
      const milestone = mod.resolveDeliverArgument({
        raw: FIXTURE_MILESTONE,
        probe,
        phases: explodingSink(),
        stdinIsTty: true,
      });
      const fr = mod.resolveDeliverArgument({
        raw: FR_OK,
        probe,
        phases: explodingSink(),
        stdinIsTty: true,
      });
      // Same milestone and same plan, so the two are one collapse away from
      // identical — and must NOT be.
      expect(shippedFields(fr)).not.toEqual(shippedFields(milestone));
      expect(milestone.scope).toBe("milestone");
      expect(fr.scope).toBe("fr");
      expect(fr.scope).not.toBe(milestone.scope);
    });
  });

  test("the milestone path gains no FR identity and enters no design phase", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const sink = recordingSink();
      const routing = mod.resolveDeliverArgument({
        raw: FIXTURE_MILESTONE,
        probe: mod.defaultIdentityProbe(tree.root),
        phases: sink,
        stdinIsTty: true,
      });
      expect(routing.fr).toBeNull();
      expect(routing.entersDesignPhase).toBe(false);
      expect(sink.calls).toEqual([]);
    });
  });

  test("the milestone path's refusals are unchanged too", async () => {
    const mod = await deliverArgument();
    await withTree(async (tree) => {
      const msg = refusalFrom(
        () =>
          mod.resolveDeliverArgument({
            raw: MILESTONE_WITHOUT_PLAN,
            probe: mod.defaultIdentityProbe(tree.root),
            phases: explodingSink(),
            stdinIsTty: true,
          }),
        "milestone without plan",
      );
      expectNfr10Shape(msg, "milestone without plan");
      expect(msg).toContain("kind=milestone_identity");
      expect(msg).toContain("plan=not-found");
      expect(msg).toContain(MILESTONE_WITHOUT_PLAN);
    });
  });
});
