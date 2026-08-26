// M134 / STE-518 — "The worker's remote-control name is derived, never typed".
//
// THE DEFECT. A spawned ceremony worker has no name: the orchestrator hands the
// spawning skill the kickoff text and the milestone identity and nothing else,
// so every worker launches under whatever name the spawner defaults to. Where
// session names are global that makes the sessions indistinguishable from each
// other and from the operator's own — and a NAME COLLISION IS NOT COSMETIC: the
// spawning skill refuses to launch when a live session already holds the name,
// so a collision blocks a spawn outright.
//
// THE MODULE THE IMPLEMENTER WRITES (the path these legs load):
//
//     adapters/_shared/src/deliver_worker_name.ts        ← NEW
//
// THE CONTRACT THESE TESTS PIN, stated once so the implementer does not guess:
//
//     export const WORKER_NAME_MAX_LENGTH = 32;
//     export const WORKER_NAME_GRAMMAR = /^[a-z][a-z0-9_-]{0,31}$/;
//
//     /** The identity segment, taken from the routing the resolver returned. */
//     export function workerIdentitySegment(routing: DeliverRouting): string;
//
//     /** The whole name, or a canonical NFR-10 refusal. */
//     export function workerRemoteControlName(input: {
//       readonly repoRoot: string;
//       readonly identity: string;
//     }): string;
//
//   * `workerIdentitySegment` returns `routing.fr` when the run carries one and
//     `routing.milestone` otherwise, RAW — sanitizing belongs to the name
//     builder, not to the extractor. A routing that carries neither (the
//     feature-request path) refuses. This export is what makes AC.3 assertable:
//     with the identity a bare string parameter (the FR's Technical Design keeps
//     it that way so both callers can reuse the builder), a test that computed
//     `routing.fr ?? routing.milestone` ITSELF would assert nothing about the
//     module. The extraction has to be the module's.
//
//   * `workerRemoteControlName` lowercases, folds runs of characters outside
//     the grammar to a single hyphen, strips leading and trailing hyphens from
//     EACH segment, then joins `<repo>-<identity>`. The repository segment is
//     the basename of `repoRoot`.
//
//   * OVERFLOW IS ASYMMETRIC ON PURPOSE (AC.6/AC.7). Over the 32-character cap
//     the REPOSITORY segment gives way — deterministically, keeping its leading
//     characters — until the whole name fits. The identity segment is the
//     discriminator that motivated the name shape, so truncating it would
//     silently reintroduce the collision the shape exists to prevent. When no
//     repository segment of one character or more makes the name fit, the
//     function REFUSES.
//
//   * REFUSALS ARE THE HOUSE NFR-10 ENVELOPE — `Refusing: ` / `Remedy: ` /
//     `Context: `, in that order, on a named Error subclass. See
//     `deliver_decision.ts`'s `refuse(...)` for the shape these legs assert.
//
// PIN DISCIPLINE (docs/patterns.md Pattern 31; house precedent
// `m133-ste-514-gate-render.test.ts`):
//
//   * AC.8 IS THE FALSIFIABILITY CLAUSE AND THIS FILE TREATS IT AS ONE. Both
//     real shapes of THIS repository fit today, so a one-sided suite — "the
//     name is what I expected" — would pass forever without ever reaching the
//     overflow rule. Every overflow leg is therefore paired with the fitting
//     leg, and each overflow fixture asserts that it IS a trigger (the
//     unshortened composition really does exceed the cap) before asserting what
//     the module did about it. A leg that cannot fail is not evidence.
//
//   * AC.3 IS MUTATION-VERIFIED THROUGH THE REAL RESOLVER. The routings come
//     from `resolveDeliverArgument`, not from hand-composed object literals, and
//     the mutation asserts it APPLIED before asserting the name moved — a
//     mutation that never landed reads as a pass (measured M124).
//
//   * AC.4 SWEEPS, IT DOES NOT SPOT-CHECK. Every name the suite produces is
//     recorded as it is produced, and the grammar leg runs over the recorded set
//     AS WELL AS over the explicit fixture table, so a name introduced by a
//     future leg cannot escape the grammar assertion by not being in the table.
//
// WHY AC.7'S LEGS CARRY BOTH FIXTURES. No repository name, of any length,
// triggers the refusal — it fires when the IDENTITY leaves no room for a
// repository segment of even one character. AC.8 names exactly that split (an
// over-long REPOSITORY for AC.6, an IDENTITY of 31+ characters for AC.7), and
// these legs follow it: the long repository fixture AND a long identity, so a
// reader cannot come away believing repository length alone reaches the branch.
// (This comment previously rebutted an earlier draft of AC.8 that asked for
// repository names on both sides; the FR was corrected, so the rebuttal is gone.)
//
// THE FR'S ARITHMETIC IS PINNED HERE. Against the 32-character cap the measured
// headroom is EIGHT for the 24-character milestone shape and FIVE for the
// 27-character FR shape. The FR's Notes section says exactly that, and the AC.5
// legs below assert both numbers (headroom: 8, headroom: 5), so a future edit
// that reintroduces wrong figures in either surface reds this file.
// (An earlier draft of the Notes said "five and seven"; it was corrected during
// implementation, and pinning the numbers is what stops that recurring.)

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { DeliverRouting, IdentityProbe } from "../adapters/_shared/src/deliver_argument";
import { resolveDeliverArgument } from "../adapters/_shared/src/deliver_argument";
import { canonicalBranchTemplate } from "../adapters/_shared/src/branch_proposal";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

// The module STE-518 introduces. Absolute path + dynamic import on purpose: a
// static import of a not-yet-written module fails the WHOLE file at resolution
// time, collapsing ten ACs into one opaque red. Loading per test keeps each
// AC's RED attributable to that AC.
const NAME_MODULE = join(SRC_DIR, "deliver_worker_name.ts");

async function loadModule(): Promise<any> {
  return await import(NAME_MODULE);
}

// ===========================================================================
// Fixtures.
// ===========================================================================

/** The spawning skill's cap on an agent name. Stated by the FR. */
const CAP = 32;

/** The grammar the FR states, spelled out here so the module cannot define it away. */
const GRAMMAR = /^[a-z][a-z0-9_-]{0,31}$/;

/** This repository, as it really is named. */
const REAL_REPO = "dev-process-toolkit";

const MILESTONE = "M134";
const FR = "STE-515";

/** The two shapes AC.1/AC.2/AC.5 name, verbatim. */
const MILESTONE_NAME = "dev-process-toolkit-m134";
const FR_NAME = "dev-process-toolkit-ste-515";

/**
 * A repository name long enough that BOTH real identity shapes overflow the cap
 * (36 characters, against a 32-character whole-name budget). Neither its
 * 27-character nor its 24-character prefix ends on a hyphen, so these legs pin
 * the shortening rule and not an undefined interaction between shortening and
 * hyphen-stripping.
 */
const LONG_REPO = "dev-process-toolkit-overflowing-repo";

/** `LONG_REPO` shortened to fit, with each identity segment intact. */
const LONG_REPO_MILESTONE_NAME = "dev-process-toolkit-overflo-m134";
const LONG_REPO_FR_NAME = "dev-process-toolkit-over-ste-515";

/**
 * An identity that leaves no room for a repository segment of even one
 * character: 35 characters against a 32-character cap. Letters only, so the
 * "names their lengths" assertion cannot be satisfied by a digit run inside the
 * identity itself — `35` appearing in the refusal means the LENGTH was named.
 */
const OVERSIZE_IDENTITY = "STE-ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE";
const OVERSIZE_IDENTITY_SEGMENT = OVERSIZE_IDENTITY.toLowerCase();

/** Repository roots, created for real so a module that stats the path still works. */
const REPO_ROOTS = new Map<string, string>();

function repoRootNamed(name: string): string {
  const cached = REPO_ROOTS.get(name);
  if (cached !== undefined) return cached;
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "ste518-repo-")));
  const root = join(parent, name);
  mkdirSync(root, { recursive: true });
  REPO_ROOTS.set(name, root);
  return root;
}

/**
 * Every name this suite has seen the module return. AC.4 sweeps this as well as
 * its own table, so a name introduced by a future leg cannot escape the grammar
 * assertion by not being written into the table.
 */
const NAMES_SEEN: string[] = [];

/** Call the module and record what it returned. */
async function derive(repoName: string, identity: string): Promise<string> {
  const mod = await loadModule();
  const name = mod.workerRemoteControlName({
    repoRoot: repoRootNamed(repoName),
    identity,
  });
  NAMES_SEEN.push(name);
  return name;
}

interface Refusal {
  readonly threw: boolean;
  readonly message: string;
  readonly name: string;
  readonly returned: unknown;
}

/** Run `fn`, reporting whether it refused and with what. */
function capture(fn: () => unknown): Refusal {
  try {
    const returned = fn();
    return { threw: false, message: "", name: "", returned };
  } catch (error) {
    return {
      threw: true,
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "",
      returned: undefined,
    };
  }
}

const ENVELOPE_PREFIXES = ["Refusing: ", "Remedy: ", "Context: "] as const;

/** Does `message` carry the three canonical NFR-10 lines, in order? */
function carriesEnvelope(message: string): { present: boolean; ordered: boolean } {
  const lines = message.split(/\r?\n/);
  const indices = ENVELOPE_PREFIXES.map((prefix) =>
    lines.findIndex((line) => line.startsWith(prefix)),
  );
  return {
    present: indices.every((i) => i !== -1),
    ordered: indices[0]! < indices[1]! && indices[1]! < indices[2]!,
  };
}

// ===========================================================================
// Routings, from the real resolver rather than hand-composed literals.
// ===========================================================================

/** A probe that finds a plan for every milestone and an FR that declares M134. */
function probeFor(frMilestone: string): IdentityProbe {
  return {
    locatePlan: (milestone: string) => `/fixture/specs/plan/${milestone}.md`,
    readFr: (identity: string) =>
      [
        "---",
        "title: Fixture FR",
        `milestone: ${frMilestone}`,
        "status: active",
        "tracker:",
        `  linear: ${identity}`,
        "---",
        "",
        "# Fixture FR",
        "",
      ].join("\n"),
  };
}

function routingFor(raw: string): DeliverRouting {
  return resolveDeliverArgument({
    raw,
    probe: probeFor(MILESTONE),
    // Explicit: the non-tty gate fires before anything else, and under
    // `bun test` stdin is not a tty, so every routing here would refuse.
    stdinIsTty: true,
  });
}

// ===========================================================================
// AC.1 — the milestone shape.
// ===========================================================================

describe("AC-STE-518.1 — a milestone-scoped run joins repository to milestone", () => {
  test(`${REAL_REPO} delivering ${MILESTONE} yields ${MILESTONE_NAME}`, async () => {
    expect(await derive(REAL_REPO, MILESTONE)).toBe(MILESTONE_NAME);
  });

  test("the repository segment really came from the repository root", async () => {
    // Not a constant baked into the module: a different repository under the
    // same milestone must produce a different name.
    const other = await derive("some-other-repo", MILESTONE);
    expect({ other, differs: other !== MILESTONE_NAME }).toEqual({
      other: "some-other-repo-m134",
      differs: true,
    });
  });
});

// ===========================================================================
// AC.2 — the FR shape, asserted as its OWN case.
// ===========================================================================

describe("AC-STE-518.2 — an FR-scoped run renders the FR as the identity segment", () => {
  test(`${REAL_REPO} delivering ${FR} yields ${FR_NAME}`, async () => {
    // Its own case on purpose. The FR-scoped collision — two FR runs under one
    // milestone — is what selected this name shape, so a suite that exercised
    // only the milestone form would leave the motivating case unasserted.
    expect(await derive(REAL_REPO, FR)).toBe(FR_NAME);
  });

  test("the two shapes are distinct names, which is the whole point", async () => {
    const milestoneName = await derive(REAL_REPO, MILESTONE);
    const frName = await derive(REAL_REPO, FR);
    expect({ same: milestoneName === frName }).toEqual({ same: false });
  });

  test("two FRs under one milestone do not collide", async () => {
    const a = await derive(REAL_REPO, "STE-515");
    const b = await derive(REAL_REPO, "STE-516");
    expect({ a, b, collide: a === b }).toEqual({
      a: "dev-process-toolkit-ste-515",
      b: "dev-process-toolkit-ste-516",
      collide: false,
    });
  });
});

// ===========================================================================
// AC.3 — the identity segment comes from the routing, mutation-verified.
// ===========================================================================

describe("AC-STE-518.3 — the identity comes from the routing object", () => {
  test("the FR path's routing yields its FR, the milestone path's its milestone", async () => {
    const mod = await loadModule();
    const frRouting = routingFor(FR);
    const milestoneRouting = routingFor(MILESTONE);
    // Ground the fixtures first: if the resolver did not populate `fr` on the FR
    // path, the leg below would be asserting about the wrong object.
    expect({
      frFieldOnFrPath: frRouting.fr,
      frFieldOnMilestonePath: milestoneRouting.fr,
      milestoneOnMilestonePath: milestoneRouting.milestone,
    }).toEqual({
      frFieldOnFrPath: FR,
      frFieldOnMilestonePath: null,
      milestoneOnMilestonePath: MILESTONE,
    });
    expect({
      fromFrRouting: mod.workerIdentitySegment(frRouting),
      fromMilestoneRouting: mod.workerIdentitySegment(milestoneRouting),
    }).toEqual({ fromFrRouting: FR, fromMilestoneRouting: MILESTONE });
  });

  test("MUTATION — moving the routing's fr field moves the returned name", async () => {
    const mod = await loadModule();
    const routing = routingFor(FR);
    const before = mod.workerRemoteControlName({
      repoRoot: repoRootNamed(REAL_REPO),
      identity: mod.workerIdentitySegment(routing),
    });
    NAMES_SEEN.push(before);

    const mutated: DeliverRouting = { ...routing, fr: "STE-777" };
    // The mutation must APPLY: a mutation that never landed reads as a pass.
    expect({ applied: mutated.fr !== routing.fr, was: routing.fr, now: mutated.fr }).toEqual({
      applied: true,
      was: FR,
      now: "STE-777",
    });

    const after = mod.workerRemoteControlName({
      repoRoot: repoRootNamed(REAL_REPO),
      identity: mod.workerIdentitySegment(mutated),
    });
    NAMES_SEEN.push(after);

    expect({ before, after, moved: before !== after }).toEqual({
      before: "dev-process-toolkit-ste-515",
      after: "dev-process-toolkit-ste-777",
      moved: true,
    });
  });

  test("it is NOT re-derived by re-parsing the raw argument", async () => {
    // The falsifying shape. A re-parse of `routing.identity` would return
    // `STE-515` for BOTH routings below, because `identity` is what the operator
    // typed and the mutation only moved `fr`. Reading the routing's own field is
    // the only way these two differ.
    const mod = await loadModule();
    const routing = routingFor(FR);
    const mutated: DeliverRouting = { ...routing, fr: "STE-777" };
    expect({ rawIdentityUnchanged: mutated.identity === routing.identity }).toEqual({
      rawIdentityUnchanged: true,
    });
    expect(mod.workerIdentitySegment(mutated)).toBe("STE-777");
  });

  test("a routing that carries neither an FR nor a milestone refuses", async () => {
    const mod = await loadModule();
    const routing = resolveDeliverArgument({
      raw: "add a way to name the worker",
      probe: probeFor(MILESTONE),
      phases: { enterDesign: () => {} },
      stdinIsTty: true,
    });
    expect({ fr: routing.fr, milestone: routing.milestone }).toEqual({
      fr: null,
      milestone: null,
    });
    const refusal = capture(() => mod.workerIdentitySegment(routing));
    expect({ threw: refusal.threw, ...carriesEnvelope(refusal.message) }).toEqual({
      threw: true,
      present: true,
      ordered: true,
    });
  });
});

// ===========================================================================
// AC.4 — every name matches the grammar. A sweep, not a spot check.
// ===========================================================================

/** Every (repository, identity) pair this suite hands the module and expects a name for. */
const GRAMMAR_TABLE: readonly { readonly repo: string; readonly identity: string }[] = [
  { repo: REAL_REPO, identity: MILESTONE },
  { repo: REAL_REPO, identity: FR },
  { repo: REAL_REPO, identity: "STE-516" },
  { repo: "some-other-repo", identity: MILESTONE },
  { repo: LONG_REPO, identity: MILESTONE },
  { repo: LONG_REPO, identity: FR },
  { repo: "Dev_Process.Toolkit", identity: "M9" },
  { repo: "---leading-hyphens---", identity: MILESTONE },
  { repo: "repo with spaces & symbols!", identity: "STE-1" },
  { repo: "UPPER-CASE-REPO", identity: "m7" },
];

describe("AC-STE-518.4 — every returned name matches the spawning skill's grammar", () => {
  for (const { repo, identity } of GRAMMAR_TABLE) {
    test(`${repo} + ${identity}`, async () => {
      const name = await derive(repo, identity);
      expect({
        repo,
        identity,
        matchesGrammar: GRAMMAR.test(name),
        withinCap: name.length <= CAP,
        name,
      }).toEqual({
        repo,
        identity,
        matchesGrammar: true,
        withinCap: true,
        name,
      });
    });
  }

  test("the grammar fixture is not vacuous — it rejects names outside it", () => {
    // Falsifiability for the predicate itself. A regexp that accepted everything
    // would green every leg above.
    const outside = ["9lives-m134", "-repo-m134", "Repo-M134", "repo m134", "a".repeat(33), ""];
    expect(outside.filter((n) => GRAMMAR.test(n))).toEqual([]);
    expect(GRAMMAR.test(MILESTONE_NAME)).toBe(true);
  });

  test("EVERY name this suite has produced conforms, table or not", async () => {
    // The sweep half. `NAMES_SEEN` is appended to by every leg that receives a
    // name, so a future leg cannot introduce a non-conforming name and escape by
    // not being written into GRAMMAR_TABLE.
    await derive(REAL_REPO, MILESTONE); // ensure at least one, whatever ran first
    const offenders = NAMES_SEEN.filter((n) => !GRAMMAR.test(n) || n.length > CAP);
    expect({ offenders, sawAtLeastOne: NAMES_SEEN.length > 0 }).toEqual({
      offenders: [],
      sawAtLeastOne: true,
    });
  });
});

// ===========================================================================
// AC.5 — a name that fits renders in full.
// ===========================================================================

describe("AC-STE-518.5 — a fitting name is rendered whole", () => {
  test(`the milestone shape is ${MILESTONE_NAME.length} characters and complete`, async () => {
    const name = await derive(REAL_REPO, MILESTONE);
    expect({
      name,
      length: name.length,
      keepsWholeRepo: name.startsWith(REAL_REPO),
      keepsWholeIdentity: name.endsWith(MILESTONE.toLowerCase()),
      headroom: CAP - name.length,
    }).toEqual({
      name: MILESTONE_NAME,
      length: 24,
      keepsWholeRepo: true,
      keepsWholeIdentity: true,
      headroom: 8,
    });
  });

  test(`the FR shape is ${FR_NAME.length} characters and complete`, async () => {
    const name = await derive(REAL_REPO, FR);
    expect({
      name,
      length: name.length,
      keepsWholeRepo: name.startsWith(REAL_REPO),
      keepsWholeIdentity: name.endsWith(FR.toLowerCase()),
      headroom: CAP - name.length,
    }).toEqual({
      name: FR_NAME,
      length: 27,
      keepsWholeRepo: true,
      keepsWholeIdentity: true,
      headroom: 5,
    });
  });

  test("no character of either segment is dropped", async () => {
    // "Renders in full" is not "starts with the repository" — a name could start
    // with the repository and still have lost a character from the middle of the
    // identity. Reconstruct the whole thing from its two parts.
    for (const identity of [MILESTONE, FR]) {
      const name = await derive(REAL_REPO, identity);
      expect({
        identity,
        reconstructed: name,
      }).toEqual({
        identity,
        reconstructed: `${REAL_REPO}-${identity.toLowerCase()}`,
      });
    }
  });
});

// ===========================================================================
// AC.6 — overflow shortens the REPOSITORY segment only.
// ===========================================================================

describe("AC-STE-518.6 — overflow shortens the repository segment, never the identity", () => {
  test("the fixture is a real trigger — unshortened, it exceeds the cap", () => {
    // Assert the trigger BEFORE asserting what the module did about it. A fixture
    // that already fits would green every leg below without the branch running.
    expect({
      milestoneOverflow: `${LONG_REPO}-${MILESTONE.toLowerCase()}`.length > CAP,
      frOverflow: `${LONG_REPO}-${FR.toLowerCase()}`.length > CAP,
      repoLength: LONG_REPO.length,
    }).toEqual({ milestoneOverflow: true, frOverflow: true, repoLength: 36 });
  });

  test("the milestone shape shortens the repository and keeps the milestone whole", async () => {
    const name = await derive(LONG_REPO, MILESTONE);
    expect({
      name,
      length: name.length,
      identitySegment: name.slice(name.lastIndexOf("-") + 1),
      repoSegment: name.slice(0, name.length - "-m134".length),
      keepsLeadingCharacters: LONG_REPO.startsWith(name.slice(0, name.length - "-m134".length)),
    }).toEqual({
      name: LONG_REPO_MILESTONE_NAME,
      length: 32,
      identitySegment: "m134",
      repoSegment: "dev-process-toolkit-overflo",
      keepsLeadingCharacters: true,
    });
  });

  test("the FR shape shortens the repository and keeps the FR byte-identical", async () => {
    const name = await derive(LONG_REPO, FR);
    const identitySegment = name.slice(name.length - FR.length);
    expect({
      name,
      length: name.length,
      identitySegment,
      byteIdentical: identitySegment === FR.toLowerCase(),
      repoSegment: name.slice(0, name.length - FR.length - 1),
    }).toEqual({
      name: LONG_REPO_FR_NAME,
      length: 32,
      identitySegment: "ste-515",
      byteIdentical: true,
      repoSegment: "dev-process-toolkit-over",
    });
  });

  test("it shortens by exactly as much as it must, and no more", async () => {
    // "Until the whole name fits" — not "to some safe short prefix". Both
    // shortened names land exactly on the cap, so a module that over-trimmed
    // would red here even though every grammar leg stayed green.
    const milestoneName = await derive(LONG_REPO, MILESTONE);
    const frName = await derive(LONG_REPO, FR);
    expect({ milestone: milestoneName.length, fr: frName.length }).toEqual({
      milestone: CAP,
      fr: CAP,
    });
  });

  test("it is deterministic — the same inputs give the same name", async () => {
    const first = await derive(LONG_REPO, FR);
    const second = await derive(LONG_REPO, FR);
    const third = await derive(LONG_REPO, FR);
    expect({ first, second, third }).toEqual({
      first: LONG_REPO_FR_NAME,
      second: LONG_REPO_FR_NAME,
      third: LONG_REPO_FR_NAME,
    });
  });

  test("a still-longer repository lands on the same cap with the identity intact", async () => {
    // The budget is a function of the IDENTITY's length, not of how far over the
    // repository ran. A repository 19 characters longer than the fixture is cut
    // to the same 24-character prefix — the two shortened names coincide, which
    // is precisely why the identity half may never be the one that gives way.
    const longer = `${LONG_REPO}-and-then-some-more`;
    const name = await derive(longer, FR);
    expect({
      length: name.length,
      identity: name.slice(name.length - FR.length),
      isLeadingPrefix: longer.startsWith(name.slice(0, name.length - FR.length - 1)),
      sameAsShorterFixture: name === LONG_REPO_FR_NAME,
    }).toEqual({
      length: CAP,
      identity: "ste-515",
      isLeadingPrefix: true,
      // Both repositories share the first 24 characters, so the shortened names
      // coincide — which is exactly why the identity half may never give way.
      sameAsShorterFixture: true,
    });
  });
});

// ===========================================================================
// AC.7 — when nothing fits, it refuses. It never truncates the identity.
// ===========================================================================

describe("AC-STE-518.7 — no repository segment fits ⇒ a canonical refusal", () => {
  test("the fixture is a real trigger — even one repository character overflows", () => {
    expect({
      identityLength: OVERSIZE_IDENTITY_SEGMENT.length,
      shortestPossibleName: `x-${OVERSIZE_IDENTITY_SEGMENT}`.length,
      overflowsAnyway: `x-${OVERSIZE_IDENTITY_SEGMENT}`.length > CAP,
    }).toEqual({ identityLength: 35, shortestPossibleName: 37, overflowsAnyway: true });
  });

  test("it refuses rather than returning anything", async () => {
    const mod = await loadModule();
    // The long repository fixture, per AC.8's wording — though the branch is
    // reached by the identity's length, not the repository's.
    const refusal = capture(() =>
      mod.workerRemoteControlName({
        repoRoot: repoRootNamed(LONG_REPO),
        identity: OVERSIZE_IDENTITY,
      }),
    );
    expect({ threw: refusal.threw, returned: refusal.returned }).toEqual({
      threw: true,
      returned: undefined,
    });
  });

  test("the refusal is the canonical NFR-10 envelope on a named error", async () => {
    const mod = await loadModule();
    const refusal = capture(() =>
      mod.workerRemoteControlName({
        repoRoot: repoRootNamed(REAL_REPO),
        identity: OVERSIZE_IDENTITY,
      }),
    );
    expect({
      threw: refusal.threw,
      ...carriesEnvelope(refusal.message),
      namedClass: refusal.name !== "" && refusal.name !== "Error",
    }).toEqual({ threw: true, present: true, ordered: true, namedClass: true });
  });

  test("it names both segments and both their lengths", async () => {
    const mod = await loadModule();
    const refusal = capture(() =>
      mod.workerRemoteControlName({
        repoRoot: repoRootNamed(REAL_REPO),
        identity: OVERSIZE_IDENTITY,
      }),
    );
    // REAL_REPO is 19 characters and the identity 35. Neither number occurs
    // inside either segment, so a hit here means the LENGTH was named and not
    // that a digit happened to sit in the text.
    expect({
      namesRepoSegment: refusal.message.includes(REAL_REPO),
      namesIdentitySegment: refusal.message.includes(OVERSIZE_IDENTITY_SEGMENT),
      namesRepoLength: refusal.message.includes(String(REAL_REPO.length)),
      namesIdentityLength: refusal.message.includes(String(OVERSIZE_IDENTITY_SEGMENT.length)),
      namesCap: refusal.message.includes(String(CAP)),
    }).toEqual({
      namesRepoSegment: true,
      namesIdentitySegment: true,
      namesRepoLength: true,
      namesIdentityLength: true,
      namesCap: true,
    });
  });

  test("across the whole boundary it either keeps the identity whole or refuses", async () => {
    // The universal form of "never returns a name whose identity segment was
    // truncated": sweep identities from comfortably-fitting to impossible and
    // assert the invariant at every step, including the exact boundary.
    const mod = await loadModule();
    const outcomes: { identity: number; verdict: string }[] = [];
    for (let extra = 20; extra <= 36; extra += 1) {
      const identity = `STE-${"a".repeat(extra)}`;
      const segment = identity.toLowerCase();
      const result = capture(() =>
        mod.workerRemoteControlName({
          repoRoot: repoRootNamed(LONG_REPO),
          identity,
        }),
      );
      if (result.threw) {
        outcomes.push({ identity: segment.length, verdict: "refused" });
        continue;
      }
      const name = String(result.returned);
      NAMES_SEEN.push(name);
      const identityWhole = name.endsWith(segment);
      const repoAtLeastOne = name.length - segment.length - 1 >= 1;
      outcomes.push({
        identity: segment.length,
        verdict:
          identityWhole && repoAtLeastOne && name.length <= CAP && GRAMMAR.test(name)
            ? "kept-whole"
            : `VIOLATED:${name}`,
      });
    }
    // The boundary is arithmetic, not a guess: a one-character repository plus a
    // joining hyphen leaves 30 characters for the identity.
    expect(outcomes).toEqual([
      { identity: 24, verdict: "kept-whole" },
      { identity: 25, verdict: "kept-whole" },
      { identity: 26, verdict: "kept-whole" },
      { identity: 27, verdict: "kept-whole" },
      { identity: 28, verdict: "kept-whole" },
      { identity: 29, verdict: "kept-whole" },
      { identity: 30, verdict: "kept-whole" },
      { identity: 31, verdict: "refused" },
      { identity: 32, verdict: "refused" },
      { identity: 33, verdict: "refused" },
      { identity: 34, verdict: "refused" },
      { identity: 35, verdict: "refused" },
      { identity: 36, verdict: "refused" },
      { identity: 37, verdict: "refused" },
      { identity: 38, verdict: "refused" },
      { identity: 39, verdict: "refused" },
      { identity: 40, verdict: "refused" },
    ]);
  });
});

// ===========================================================================
// AC.8 — both sides pinned. A one-sided suite would pass forever on this repo.
// ===========================================================================

describe("AC-STE-518.8 — the fitting case is asserted alongside each overflow case", () => {
  test("AC.6's pair — the same identity fits on this repository and shortens on a long one", async () => {
    const fitting = await derive(REAL_REPO, FR);
    const overflowing = await derive(LONG_REPO, FR);
    expect({
      fitting,
      fittingLength: fitting.length,
      fittingRepoWhole: fitting.startsWith(REAL_REPO),
      overflowing,
      overflowingLength: overflowing.length,
      overflowingRepoWhole: overflowing.startsWith(LONG_REPO),
      identityIdenticalAcrossBoth:
        fitting.slice(fitting.length - FR.length) ===
        overflowing.slice(overflowing.length - FR.length),
    }).toEqual({
      fitting: FR_NAME,
      fittingLength: 27,
      fittingRepoWhole: true,
      overflowing: LONG_REPO_FR_NAME,
      overflowingLength: 32,
      overflowingRepoWhole: false,
      identityIdenticalAcrossBoth: true,
    });
  });

  test("AC.7's pair — the same repository returns for a fitting identity and refuses for an impossible one", async () => {
    const mod = await loadModule();
    const fitting = await derive(LONG_REPO, MILESTONE);
    const impossible = capture(() =>
      mod.workerRemoteControlName({
        repoRoot: repoRootNamed(LONG_REPO),
        identity: OVERSIZE_IDENTITY,
      }),
    );
    expect({
      fitting,
      fittingReturned: typeof fitting === "string" && fitting.length > 0,
      impossibleThrew: impossible.threw,
    }).toEqual({
      fitting: LONG_REPO_MILESTONE_NAME,
      fittingReturned: true,
      impossibleThrew: true,
    });
  });

  test("the refusal is not blanket — the long repository still names most identities", async () => {
    // The mirror guard. A function that threw on everything would satisfy every
    // refusal leg in this file; the fitting halves above must come back from the
    // SAME function that refused.
    const names = await Promise.all(
      [MILESTONE, FR, "STE-1", "M9"].map((identity) => derive(LONG_REPO, identity)),
    );
    expect({
      count: names.length,
      allWithinCap: names.every((n) => n.length <= CAP && GRAMMAR.test(n)),
      allDistinct: new Set(names).size === names.length,
    }).toEqual({ count: 4, allWithinCap: true, allDistinct: true });
  });
});

// ===========================================================================
// AC.9 — a composed name that would not start with a lowercase letter refuses.
// ===========================================================================

describe("AC-STE-518.9 — a name that cannot start with a lowercase letter refuses", () => {
  const LEADING_TRAPS = [
    { repo: "9lives", why: "a leading digit" },
    { repo: "_internal-tools", why: "a leading underscore" },
    { repo: "42", why: "digits only" },
  ] as const;

  test("the traps are real — composed naively, each is outside the grammar", () => {
    for (const { repo, why } of LEADING_TRAPS) {
      const naive = `${repo.toLowerCase()}-${MILESTONE.toLowerCase()}`;
      expect({ repo, why, naiveIsOutsideGrammar: GRAMMAR.test(naive) === false }).toEqual({
        repo,
        why,
        naiveIsOutsideGrammar: true,
      });
    }
  });

  for (const { repo, why } of LEADING_TRAPS) {
    test(`${repo} (${why}) refuses rather than returning an ungrammatical name`, async () => {
      const mod = await loadModule();
      const refusal = capture(() =>
        mod.workerRemoteControlName({
          repoRoot: repoRootNamed(repo),
          identity: MILESTONE,
        }),
      );
      expect({
        repo,
        threw: refusal.threw,
        returned: refusal.returned,
        ...carriesEnvelope(refusal.message),
      }).toEqual({ repo, threw: true, returned: undefined, present: true, ordered: true });
    });
  }

  test("stripping, not refusing, is what leading hyphens get", async () => {
    // The contrast that keeps the leg above from being satisfied by a function
    // that refuses on anything unusual. Leading hyphens are STRIPPED by the
    // sanitizer, so this composes cleanly and must come back as a name.
    const name = await derive("---leading-hyphens---", MILESTONE);
    expect({ name, grammatical: GRAMMAR.test(name) }).toEqual({
      name: "leading-hyphens-m134",
      grammatical: true,
    });
  });
});

// ===========================================================================
// AC.10 — the derivation shares nothing with the branch-proposal module.
// ===========================================================================

/** Import specifiers `source` pulls in. Comments and prose are not imports. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bawait\s+import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

describe("AC-STE-518.10 — nothing is imported from the branch-proposal module", () => {
  test("the module exists and is the one under test", () => {
    // Guards the vacuity: "contains no import of branch_proposal" is trivially
    // true of a file that does not exist or that defines nothing.
    const source = readFileSync(NAME_MODULE, "utf-8");
    expect({
      file: basename(NAME_MODULE),
      definesTheBuilder: source.includes("workerRemoteControlName"),
      definesTheExtractor: source.includes("workerIdentitySegment"),
    }).toEqual({
      file: "deliver_worker_name.ts",
      definesTheBuilder: true,
      definesTheExtractor: true,
    });
  });

  test("no import specifier names branch_proposal", () => {
    const specifiers = importSpecifiers(readFileSync(NAME_MODULE, "utf-8"));
    expect({ offenders: specifiers.filter((s) => s.includes("branch_proposal")) }).toEqual({
      offenders: [],
    });
  });

  test("neither of the branch-proposal exports is referenced by name", async () => {
    const source = readFileSync(NAME_MODULE, "utf-8");
    // Strip comments first: the module is EXPECTED to warn a future reader off
    // this module by name, and a warning is the opposite of a reuse.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect({
      canonicalBranchTemplate: code.includes("canonicalBranchTemplate"),
      buildBranchProposal: code.includes("buildBranchProposal"),
    }).toEqual({ canonicalBranchTemplate: false, buildBranchProposal: false });
  });

  test("the detector is not vacuous — it catches the import it forbids", () => {
    // Falsifiability. A detector that matched nothing would green the leg above
    // on a module that imported the trap on its first line.
    const synthetic = [
      'import { canonicalBranchTemplate } from "./branch_proposal";',
      'import { join } from "node:path";',
      "export const x = 1;",
    ].join("\n");
    expect(importSpecifiers(synthetic).filter((s) => s.includes("branch_proposal"))).toEqual([
      "./branch_proposal",
    ]);
  });

  test("the trap is real — the branch template disagrees with itself on M-form tokens", () => {
    // The FR's stated rationale, MEASURED rather than repeated.
    // `canonicalBranchTemplate` tests for bare digits and then for an epic
    // token; a full numeric token such as `M133` matches neither and falls
    // through to the ticket-keyed template, while the module's own comment
    // describes that input as supported. Reusing it here would inherit that.
    const bareDigits = canonicalBranchTemplate({ milestone: "133" });
    const mForm = canonicalBranchTemplate({ milestone: "M133" });
    const absent = canonicalBranchTemplate({});
    expect({
      twoSpellingsOfOneMilestoneDisagree: bareDigits !== mForm,
      mFormFallsThroughToTheTicketTemplate: mForm === absent,
    }).toEqual({
      twoSpellingsOfOneMilestoneDisagree: true,
      mFormFallsThroughToTheTicketTemplate: true,
    });
  });

  test("and this module gets M-form tokens right regardless", async () => {
    // The point of AC.10 stated positively: whatever the branch template does
    // with `M134`, the derivation here renders it.
    expect(await derive(REAL_REPO, MILESTONE)).toBe(MILESTONE_NAME);
  });
});

// ===========================================================================
// M134 post-review fixes (STE-518 half). Added after the milestone-level
// /spec-review found what three clean per-FR audits structurally could not.
// ===========================================================================

describe("post-review — the IDENTITY segment may not fold away either", () => {
  // MEASURED BEFORE THE FIX: workerRemoteControlName({repoRoot:"/x/dev-process-toolkit",
  // identity:"###"}) returned "dev-process-toolkit-" — grammar-legal, cap-legal,
  // and carrying NO discriminator, so two runs collide on one name and the
  // spawning skill refuses the second. The repository half was guarded against
  // folding away since the module shipped; this is the mirror that was missing.
  for (const identity of ["###", "-", "   ", "!!!"]) {
    test(`an identity of ${JSON.stringify(identity)} refuses instead of composing a nameless name`, async () => {
      const mod = await loadModule();
      let thrown: any = null;
      try {
        mod.workerRemoteControlName({ repoRoot: "/x/dev-process-toolkit", identity });
      } catch (e) {
        thrown = e;
      }
      expect({
        threw: thrown !== null,
        rule: thrown?.rule ?? null,
        // the old return value must NOT be what comes back
        namesNothing: thrown === null,
      }).toEqual({ threw: true, rule: "identity_nothing_left", namesNothing: false });
    });
  }

  test("the guard is NARROW — an identity that survives folding still renders", async () => {
    // The other side of the pin. A guard that refused everything would satisfy
    // every leg above and break the module.
    const mod = await loadModule();
    expect(
      mod.workerRemoteControlName({ repoRoot: "/x/dev-process-toolkit", identity: "M134" }),
    ).toEqual("dev-process-toolkit-m134");
  });
});

describe("post-review — the derivation has a runnable front door", () => {
  // The fresh-idea path was ORDERED to run this derivation and had no command
  // to run: the module carried no `import.meta.main` while both sibling deliver
  // modules carry one. A reader who cannot execute an order narrates it, and a
  // narrated name and a derived one drift apart.
  test("the module carries a command-line entry point", () => {
    const src = readFileSync(NAME_MODULE, "utf-8");
    expect(src.includes("import.meta.main")).toBe(true);
  });

  test("the command prints exactly what the function returns", async () => {
    const mod = await loadModule();
    const viaFunction = mod.workerRemoteControlName({
      repoRoot: join(import.meta.dir, "..", "..", ".."),
      identity: "M134",
    });
    const viaCommand = Bun.spawnSync([
      "bun",
      "run",
      NAME_MODULE,
      join(import.meta.dir, "..", "..", ".."),
      "M134",
    ]);
    expect({
      code: viaCommand.exitCode,
      stdout: new TextDecoder().decode(viaCommand.stdout).trim(),
    }).toEqual({ code: 0, stdout: viaFunction });
  });

  test("the command REFUSES on stderr with an empty stdout, never a partial name", () => {
    const r = Bun.spawnSync(["bun", "run", NAME_MODULE, "/x/dev-process-toolkit", "###"]);
    expect({
      nonZero: r.exitCode !== 0,
      stdoutEmpty: new TextDecoder().decode(r.stdout).trim() === "",
      stderrRefuses: new TextDecoder().decode(r.stderr).includes("Refusing:"),
    }).toEqual({ nonZero: true, stdoutEmpty: true, stderrRefuses: true });
  });
});
