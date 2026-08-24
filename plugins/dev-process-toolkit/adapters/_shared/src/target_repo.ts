// target_repo — a milestone plan declares the repo its work lands in, and
// `/deliver` routes on that declaration (M129 STE-495).
//
// The BACKWARD-COMPATIBILITY SPINE (AC-STE-495.1): a plan that declares nothing
// means the invoking session's repo, runs the shipped three-stage ceremony
// chain, and spec-writes inline — exactly as every plan on disk does today. The
// undeclared path never consults the repo probe at all, so an existing
// single-repo run cannot be slowed, refused, or redirected by machinery it does
// not use.
//
// Contract notes:
//   * Frontmatter is read through `./frontmatter`, the one place that owns
//     CRLF / lone-CR / BOM normalization. A private regex here would drift the
//     moment that module's normalization changes, and the failure would be
//     silent: a Windows-authored plan would read as having no frontmatter.
//   * `target_repo: null` is undeclared, identical to omitting the key. This is
//     the house sentinel idiom (`shipped_in: null` in the plan template); a
//     reader that treated it as a repo literally named "null" would refuse
//     every scaffolded plan.
//   * Toolkit presence is decided by `isToolkitManaged` from
//     `./toolkit_managed` — the single implementation of that question — never
//     by a second copy of its heading vocabulary.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { isToolkitManaged } from "./toolkit_managed";
import {
  DELIVER_STAGE_IDS,
  DELIVER_STAGE_SECTIONS,
} from "./deliver_stage_capture";

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

/** The plan-frontmatter key a milestone declares its target repo under. */
export const TARGET_REPO_KEY = "target_repo";

/** The three topologies a milestone can be routed to. */
export type MilestoneRoute = "invoking" | "cross_repo_toolkit" | "reduced";

/** The closed routing vocabulary, in reporting order. */
export const MILESTONE_ROUTES = [
  "invoking",
  "cross_repo_toolkit",
  "reduced",
] as const satisfies readonly MilestoneRoute[];

/** Where Phase 2 (spec-writing) runs for a given milestone. */
export type SpecWriteLocation = "inline" | "worker";

/**
 * Stage identities a milestone's worker chain can carry — DERIVED from the
 * fence module's vocabulary, never a second copy. The fence's
 * `stage:` validator and this routing vocabulary must be the same set — when
 * they drifted, a reduced chain's `stage: work` was rejected by the very
 * predicate that grades it.
 */
export type StageId = (typeof DELIVER_STAGE_IDS)[number];

/** The shipped ceremony chain: what a milestone in the invoking repo runs. */
export const FULL_CHAIN_STAGES = [
  "implement",
  "ship-milestone",
  "pr",
] as const satisfies readonly StageId[];

/**
 * A cross-repo toolkit milestone spec-writes INSIDE its own worker first — the
 * target tree's tracker and specs are what the specs have to bind to — then
 * runs the shipped ceremony unchanged.
 */
export const CROSS_REPO_CHAIN_STAGES = [
  "spec-write",
  ...FULL_CHAIN_STAGES,
] as const satisfies readonly StageId[];

/** A tree with no toolkit ceremony: do the work, then open a PR. */
export const REDUCED_CHAIN_STAGES = ["work", "pr"] as const satisfies readonly StageId[];

/** Workers that may run at once. The serial invariant, as a number. */
export const MAX_CONCURRENT_WORKERS = 1;

/** The literal a stage fence carries in a section with no real content. */
export const EMPTY_SECTION_FALLBACK = "- (none found)";

// ---------------------------------------------------------------------------
// Shapes.
// ---------------------------------------------------------------------------

/**
 * A plan's target-repo answer.
 *
 * Written as a DISCRIMINATED UNION rather than `{declared: boolean; value:
 * string | null}` so `declared === true` narrows `value` to `string` for the
 * compiler. The looser shape forced the router to assert `decl.value as string`
 * — a cast that would keep compiling if this reader ever started reporting
 * `declared: true` with a null value, which is precisely the bug the cast hides.
 */
export type TargetRepoDeclaration =
  | {
      /** The plan carried a real `target_repo:` value. */
      readonly declared: true;
      /** The declared value verbatim. */
      readonly value: string;
    }
  | {
      readonly declared: false;
      /** Undeclared: an absent key and the `null` sentinel are both this. */
      readonly value: null;
    };

/** How a declared target repo is turned into a real tree. Injectable. */
export interface RepoProbe {
  /** Absolute path of the declared repo, or `null` when it cannot be located. */
  locate(declared: string): string | null;
  /** True when that tree has the toolkit installed. */
  hasToolkit(repoPath: string): boolean;
}

export interface RouteInput {
  /** The milestone plan's full text. */
  readonly planBody: string;
  /** Absolute path of the repo the `/deliver` session was invoked in. */
  readonly invokingRepo: string;
  readonly probe?: RepoProbe;
}

export interface MilestoneRouting {
  readonly route: MilestoneRoute;
  /** Absolute path of the repo this milestone's work lands in. */
  readonly repo: string;
  readonly declared: boolean;
  readonly specWrite: SpecWriteLocation;
  readonly chain: readonly StageId[];
  /** True when the target tree runs the toolkit ceremony at all. */
  readonly ceremony: boolean;
  /** Workers this milestone gets. Always 1 — the serial invariant. */
  readonly workers: number;
  /** Workers that may run at once. Always 1. */
  readonly concurrency: number;
}

/**
 * The NFR-10 canonical refusal for a declaration that cannot be turned into a
 * real tree. Named so a caller can tell a routing refusal from any other throw.
 *
 * The message is composed in `routeMilestone` rather than through
 * `requires_input`'s exported `renderRefusalMessage`, and that is a CHECKED
 * decision, not a missed reuse — the same one `pr_draft.ts` records for
 * `DraftUnsupportedError`, and it applies here for the same two reasons.
 * That helper renders a different envelope for a different refusal class: its
 * first line is `Verdict:`, not `Refusing:`, and it appends
 * `<dpt:requires-input-refused>v1</dpt:requires-input-refused>` as a mandatory
 * last line. `socratic_first_turn_stream.ts` recognizes a refusal by scanning
 * assistant text for exactly that marker, so routing an unlocatable-target
 * refusal through it would make a `/deliver` routing halt read as a first-turn
 * requires-input refusal in the smoke harness. Sharing the envelope would
 * corrupt that reader to save three lines.
 */
export class TargetRepoError extends Error {
  override readonly name = "TargetRepoError";
}

// ---------------------------------------------------------------------------
// AC-STE-495.1 — the declaration reader.
// ---------------------------------------------------------------------------

/**
 * Read a milestone plan's target-repo declaration.
 *
 * Lenient by construction: a document with no frontmatter at all (a bodiless
 * file, a stray heading) is UNDECLARED, never a crash. An absent key and the
 * `null` sentinel are the same answer.
 */
export function readTargetRepoDeclaration(planBody: string): TargetRepoDeclaration {
  const fm = parseFrontmatter(planBody, { lenient: true });
  const raw = fm[TARGET_REPO_KEY];
  if (typeof raw !== "string") return { declared: false, value: null };
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") {
    return { declared: false, value: null };
  }
  return { declared: true, value };
}

// ---------------------------------------------------------------------------
// The default, filesystem-backed probe.
// ---------------------------------------------------------------------------

/** Expand a leading `~` against the current user's home directory. */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

/**
 * The real probe: a declaration locates iff it names an existing directory,
 * resolved against `invokingRepo` when relative. Toolkit presence defers
 * entirely to the shipped managed-tree predicate.
 */
export function defaultRepoProbe(invokingRepo: string = process.cwd()): RepoProbe {
  return {
    locate(declared: string): string | null {
      const expanded = expandHome(declared);
      const abs = isAbsolute(expanded) ? expanded : resolve(invokingRepo, expanded);
      try {
        if (!existsSync(abs)) return null;
        if (!statSync(abs).isDirectory()) return null;
      } catch {
        return null;
      }
      return abs;
    },
    hasToolkit(repoPath: string): boolean {
      return isToolkitManaged(repoPath);
    },
  };
}

// ---------------------------------------------------------------------------
// Routing.
// ---------------------------------------------------------------------------

/**
 * True when two repo paths name the same tree.
 *
 * AC-STE-495.2: declaring your OWN repo is a no-op, not a second code path — so
 * the comparison cannot be raw string identity. The probe hands back a
 * `resolve()`-normalized path while `invokingRepo` may arrive with a trailing
 * slash, a `.` segment, or in relative form; a literal `===` would miss the
 * inline branch for `target_repo: .` and route the invoking repo cross-repo.
 */
function sameRepo(a: string, b: string): boolean {
  return a === b || resolve(a) === resolve(b);
}

/** The routing every undeclared plan gets — today's behaviour, unchanged. */
function invokingRouting(invokingRepo: string, declared: boolean): MilestoneRouting {
  return {
    route: "invoking",
    repo: invokingRepo,
    declared,
    specWrite: "inline",
    chain: FULL_CHAIN_STAGES,
    ceremony: true,
    workers: 1,
    concurrency: MAX_CONCURRENT_WORKERS,
  };
}

/**
 * Classify one milestone.
 *
 * The undeclared path returns BEFORE `probe` is touched: "no declaration means
 * the invoking repo" is answered from the plan alone, so an existing
 * single-repo run never goes looking for another tree.
 */
export function routeMilestone(input: RouteInput): MilestoneRouting {
  const { planBody, invokingRepo } = input;
  const decl = readTargetRepoDeclaration(planBody);
  if (!decl.declared) return invokingRouting(invokingRepo, false);

  const declared = decl.value;
  const probe = input.probe ?? defaultRepoProbe(invokingRepo);
  const located = probe.locate(declared);
  if (located === null) {
    throw new TargetRepoError(
      [
        `Refusing: the milestone's declared target repo could not be located: ${declared}`,
        `Remedy: correct or remove the plan's \`${TARGET_REPO_KEY}:\` declaration, or check out the repo it names, then re-run. /deliver never silently falls back to the invoking repo.`,
        `Context: ${TARGET_REPO_KEY}=${declared}, invoking repo=${invokingRepo}`,
      ].join("\n"),
    );
  }

  if (sameRepo(located, invokingRepo)) return invokingRouting(invokingRepo, true);

  const ceremony = probe.hasToolkit(located);
  return {
    route: ceremony ? "cross_repo_toolkit" : "reduced",
    repo: located,
    declared: true,
    specWrite: "worker",
    chain: ceremony ? CROSS_REPO_CHAIN_STAGES : REDUCED_CHAIN_STAGES,
    ceremony,
    workers: 1,
    concurrency: MAX_CONCURRENT_WORKERS,
  };
}

// ---------------------------------------------------------------------------
// Stage-existence contract.
// ---------------------------------------------------------------------------

const CHAIN_BY_ROUTE: Record<MilestoneRoute, readonly StageId[]> = {
  invoking: FULL_CHAIN_STAGES,
  cross_repo_toolkit: CROSS_REPO_CHAIN_STAGES,
  reduced: REDUCED_CHAIN_STAGES,
};

/** The stages a route's worker chain is required to emit. */
export function stagesRequiredFor(route: MilestoneRoute): readonly StageId[] {
  return CHAIN_BY_ROUTE[route];
}

/** True when an absent `stage` is a halt for `route` — i.e. it was in its chain. */
export function haltsForMissingStage(route: MilestoneRoute, stage: StageId): boolean {
  return stagesRequiredFor(route).includes(stage);
}

/** The stages `route` required that `emitted` never reported, in chain order. */
export function missingRequiredStages(
  route: MilestoneRoute,
  emitted: readonly StageId[],
): readonly StageId[] {
  return stagesRequiredFor(route).filter((s) => !emitted.includes(s));
}

/**
 * The fence contract is route-independent: every chain, reduced included, emits
 * the same eight sections in the same fixed order.
 */
export function fenceSectionsFor(_route: MilestoneRoute): readonly string[] {
  return DELIVER_STAGE_SECTIONS;
}
