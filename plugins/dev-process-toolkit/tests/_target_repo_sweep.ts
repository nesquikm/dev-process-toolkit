// The target-repo plan sweep, as a NAMED UNIT two suites share.
//
// Why this is a module and not a `for` loop in a `test()` body (STE-600): the
// per-plan routing assertion used to live inline in the M129 suite's
// NON-REGRESSION SWEEP. Nothing outside that loop could reach it, so the
// declared group — a plan that actually uses the shipped `target_repo:` key —
// had no positive case at all, and the loop's `decl.declared === false`
// assertion made writing the first declaring plan a test failure. The audit
// below is the same grading, hoisted somewhere a synthetic plan body and a
// stubbed router can be handed to it.
//
// EVERYTHING IS INJECTED. The module takes `readTargetRepoDeclaration`,
// `routeMilestone` and `stagesRequiredFor` through `SweepDeps` rather than
// importing them, for two reasons:
//
//   * A mutant router can be fed to the very unit the real sweep runs. That is
//     the reachability this exists to provide.
//   * The only import here is `import type`, which is erased. The M129 suite
//     imports `target_repo` LAZILY on purpose (a static import of a
//     not-yet-written module collapses every red into one load error), and a
//     runtime import in this helper would quietly defeat that.
//
// `tests/_*.ts` — not `.test.ts` — is the house shape for a shared helper; a
// `.test.ts` name would make `bun test` collect it as a suite of its own.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  MilestoneRoute,
  MilestoneRouting,
  RepoProbe,
  RouteInput,
  StageId,
  TargetRepoDeclaration,
} from "../adapters/_shared/src/target_repo";

// ---------------------------------------------------------------------------
// Paths + fixtures.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

/** The repo a fictional `/deliver` session was invoked in. */
export const INVOKING = "/abs/invoking-repo";
/** A second toolkit-managed tree, for the cross-repo route. */
export const OTHER_TOOLKIT_REPO = "/abs/other-toolkit-repo";
/** A tree with no toolkit installed, for the reduced route. */
export const TOOLKIT_LESS_REPO = "/abs/docs-only-repo";

/** Every REAL milestone plan on disk: the active ones plus the whole archive. */
export function allPlanFiles(): string[] {
  const out: string[] = [];
  const planDir = join(REPO_ROOT, "specs", "plan");
  const archiveDir = join(planDir, "archive");
  for (const dir of [planDir, archiveDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!name.endsWith(".md")) continue;
      if (statSync(p).isDirectory()) continue;
      out.push(p);
    }
  }
  return out.sort();
}

/** A minimal but realistic milestone plan body. */
export function planBody(frontmatterExtra: readonly string[] = []): string {
  return [
    "---",
    "milestone: M900",
    "status: active",
    "archived_at: null",
    "kickoff_branch: null",
    "frozen_at: null",
    "migration: none",
    ...frontmatterExtra,
    "---",
    "",
    "# Implementation Plan",
    "",
    "## M900 — a milestone {#M900}",
    "",
  ].join("\n");
}

/** A probe that resolves exactly the fixture repos and nothing else. */
export function fixtureProbe(): RepoProbe {
  return {
    locate(declared: string): string | null {
      if (declared === OTHER_TOOLKIT_REPO) return OTHER_TOOLKIT_REPO;
      if (declared === TOOLKIT_LESS_REPO) return TOOLKIT_LESS_REPO;
      if (declared === INVOKING || declared === ".") return INVOKING;
      return null;
    },
    hasToolkit(repoPath: string): boolean {
      return repoPath !== TOOLKIT_LESS_REPO;
    },
  };
}

/** A probe that FAILS LOUDLY if consulted — for the undeclared path. */
export function neverConsultedProbe(): RepoProbe {
  return {
    locate(): string | null {
      throw new Error(
        "probe.locate was consulted for a plan that declares NO target repo",
      );
    },
    hasToolkit(): boolean {
      throw new Error(
        "probe.hasToolkit was consulted for a plan that declares NO target repo",
      );
    },
  };
}

// ---------------------------------------------------------------------------
// The audit.
// ---------------------------------------------------------------------------

/** One plan file, as the corpus walker hands it to the audit. */
export interface PlanEntry {
  readonly path: string;
  readonly body: string;
}

/** What the audit needs in order to grade one plan. */
export interface SweepDeps {
  /** The repo the fictional `/deliver` session was invoked in. */
  readonly invokingRepo: string;
  /** The probe used for the DECLARED group only. */
  readonly declaredProbe: RepoProbe;
  readTargetRepoDeclaration(body: string): TargetRepoDeclaration;
  routeMilestone(input: RouteInput): MilestoneRouting;
  stagesRequiredFor(route: MilestoneRoute): readonly StageId[];
}

/** What the audit reports for one plan once it has PASSED its group's check. */
export interface PlanVerdict {
  readonly path: string;
  readonly declared: boolean;
  readonly value: string | null;
  readonly route: MilestoneRoute;
  readonly repo: string;
}

/** Every refusal this unit raises names the plan it is refusing. */
function refuse(path: string, what: string): never {
  throw new Error(`${path}: ${what}`);
}

/**
 * Grade ONE plan that declares no target repo.
 *
 * The invariant, unchanged since M129: it routes to the invoking repo, runs the
 * shipped full chain, spec-writes inline — and never consults a probe, which is
 * ASSERTED rather than inferred by handing the router a probe that throws.
 */
function auditUndeclared(
  path: string,
  body: string,
  deps: SweepDeps,
): PlanVerdict {
  const routing = deps.routeMilestone({
    planBody: body,
    invokingRepo: deps.invokingRepo,
    // Never `deps.declaredProbe`, and never `undefined` — an absent probe lets
    // the router fall back to the real filesystem probe, which would make
    // "undeclared never goes looking" unobservable.
    probe: neverConsultedProbe(),
  });

  if (routing.route !== "invoking") {
    refuse(
      path,
      `an undeclared plan routed \`${routing.route}\`, not \`invoking\``,
    );
  }
  if (routing.repo !== deps.invokingRepo) {
    refuse(
      path,
      `an undeclared plan landed in ${routing.repo}, not the invoking repo ${deps.invokingRepo}`,
    );
  }
  if (routing.declared !== false) {
    refuse(path, "an undeclared plan was routed as if it declared a target repo");
  }
  if (routing.specWrite !== "inline") {
    refuse(
      path,
      `an undeclared plan spec-writes \`${routing.specWrite}\`, not \`inline\``,
    );
  }
  const expected = deps.stagesRequiredFor("invoking");
  if ([...routing.chain].join(",") !== [...expected].join(",")) {
    refuse(
      path,
      `an undeclared plan's chain is [${[...routing.chain].join(", ")}], not the full chain [${[...expected].join(", ")}]`,
    );
  }

  return {
    path,
    declared: false,
    value: null,
    route: routing.route,
    repo: routing.repo,
  };
}

/**
 * True when two repo paths name the same tree.
 *
 * The same normalization the shipped router applies, restated locally: this
 * helper deliberately imports nothing from `target_repo` at RUNTIME (see the
 * header), so it cannot reuse `sameRepo` without defeating the M129 suite's
 * lazy import.
 */
function samePath(a: string, b: string): boolean {
  return a === b || resolve(a) === resolve(b);
}

/**
 * Grade ONE plan that DOES declare a target repo (STE-600 AC.2).
 *
 * The declaration is not a free pass: the expected answer is recomputed from
 * the declared value and the DECLARED group's probe — where the tree resolves
 * to, whether it carries the toolkit — and the routing the router actually
 * returned is checked against it. A declaring plan scored as undeclared, or
 * landed in a tree other than the one it named, is refused by name.
 */
function auditDeclared(
  path: string,
  body: string,
  declaredValue: string,
  deps: SweepDeps,
): PlanVerdict {
  const probe = deps.declaredProbe;
  const located = probe.locate(declaredValue);
  if (located === null) {
    refuse(
      path,
      `this plan declares a target repo (${declaredValue}) that the probe cannot locate`,
    );
  }

  // Declaring your OWN repo is a no-op, not a second code path — it routes
  // `invoking` with `declared: true`. Every other located tree routes on
  // toolkit presence.
  const ownRepo = samePath(located, deps.invokingRepo);
  const expectedRepo = ownRepo ? deps.invokingRepo : located;
  const expectedRoute: MilestoneRoute = ownRepo
    ? "invoking"
    : probe.hasToolkit(located)
      ? "cross_repo_toolkit"
      : "reduced";
  const expectedSpecWrite = ownRepo ? "inline" : "worker";

  const routing = deps.routeMilestone({
    planBody: body,
    invokingRepo: deps.invokingRepo,
    probe,
  });

  if (routing.declared !== true) {
    refuse(
      path,
      `this plan declares a target repo (${declaredValue}) but was routed as if it declared nothing`,
    );
  }
  if (routing.route !== expectedRoute) {
    refuse(
      path,
      `a plan declaring ${declaredValue} routed \`${routing.route}\`, not \`${expectedRoute}\``,
    );
  }
  if (!samePath(routing.repo, expectedRepo)) {
    refuse(
      path,
      `a plan declaring ${declaredValue} landed in ${routing.repo}, not the declared tree ${expectedRepo}`,
    );
  }
  if (routing.specWrite !== expectedSpecWrite) {
    refuse(
      path,
      `a plan declaring ${declaredValue} spec-writes \`${routing.specWrite}\`, not \`${expectedSpecWrite}\``,
    );
  }
  const expectedChain = deps.stagesRequiredFor(expectedRoute);
  if ([...routing.chain].join(",") !== [...expectedChain].join(",")) {
    refuse(
      path,
      `a plan declaring ${declaredValue} has chain [${[...routing.chain].join(", ")}], not the \`${expectedRoute}\` chain [${[...expectedChain].join(", ")}]`,
    );
  }

  return {
    path,
    declared: true,
    value: declaredValue,
    route: routing.route,
    repo: routing.repo,
  };
}

/**
 * Grade ONE plan. Returns its verdict, or THROWS naming the plan.
 *
 * The two groups are graded differently on purpose: an undeclared plan is held
 * to the invoking-repo invariant, while a declaring plan is held to the tree it
 * actually named. Neither group is skipped.
 */
export function auditPlanRouting(
  path: string,
  body: string,
  deps: SweepDeps,
): PlanVerdict {
  const decl = deps.readTargetRepoDeclaration(body);
  if (!decl.declared) return auditUndeclared(path, body, deps);
  return auditDeclared(path, body, decl.value, deps);
}

/** Grade a whole corpus. One verdict per entry, in order. */
export function auditPlanCorpus(
  plans: readonly PlanEntry[],
  deps: SweepDeps,
): PlanVerdict[] {
  return plans.map((plan) => auditPlanRouting(plan.path, plan.body, deps));
}
