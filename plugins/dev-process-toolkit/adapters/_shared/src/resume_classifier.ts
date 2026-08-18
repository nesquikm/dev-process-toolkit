// resume_classifier — STE-498: `/deliver` enters a resumed milestone at the
// phase its state allows.
//
// ASSEMBLY, NOT NEW MACHINERY. Every fact this module reports is asked of the
// helper that already owns it:
//
//   - plan task counts + active/archived plan location → `plan_task_state`
//   - ship-readiness and the FR binding it derives → `active_plan_ship_ready`
//   - the shipped-stamp coherence verdict          → `plan_ship_coherence`
//   - which FRs still await technical review       → `needs_technical_review_consistency`
//   - the serial worker invariant                  → `target_repo`
//
// Re-deriving any of those here would create a second source of truth for a
// classification the gate already computes. The only frontmatter this module
// reads for itself is the plan's own ship stamp / parked state, which no
// helper exposes.
//
// READ-ONLY by construction: no write and no exec channel exists in this file,
// and nothing here reaches a tracker. The claim and the spawn happen through
// injected sinks, after the operator has confirmed.

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { parseFrontmatter } from "./frontmatter";
import { readPlanTaskState, type PlanStatus } from "./plan_task_state";
import { milestoneFrBinding, shipReadyMilestones } from "./active_plan_ship_ready";
import { runPlanShipCoherenceProbe } from "./plan_ship_coherence";
import {
  frsAwaitingTechnicalReview,
  runNeedsTechnicalReviewConsistencyProbe,
} from "./needs_technical_review_consistency";
import { MAX_CONCURRENT_WORKERS } from "./target_repo";

// ===========================================================================
// Vocabulary.
// ===========================================================================

/** The states that change WHERE a resumed milestone is entered. */
export type ResumeState =
  | "needs_technical_review"
  | "ready_to_implement"
  | "partly_implemented"
  | "ship_ready"
  | "shipped"
  | "parked";

/** The classification vocabulary, in entry-point order. */
export const RESUME_STATES: readonly ResumeState[] = [
  "needs_technical_review",
  "ready_to_implement",
  "partly_implemented",
  "ship_ready",
  "shipped",
  "parked",
];

export interface ResumeClassification {
  readonly milestone: string;
  readonly state: ResumeState;
  readonly planStatus: PlanStatus;
  readonly totalTasks: number;
  readonly uncheckedTasks: number;
  /** FR ids bound to THIS milestone whose specs still await technical review. */
  readonly frsAwaitingReview: readonly string[];
  /** The reason a parked milestone was parked, or `null` when none is recorded. */
  readonly parkedReason: string | null;
  /** The `shipped_in:` stamp verbatim, or `null` when unstamped. */
  readonly shippedIn: string | null;
  /** NFR-10 messages from `plan_ship_coherence` naming THIS milestone. */
  readonly shipCoherenceViolations: readonly string[];
  /** NFR-10 messages from `needs_technical_review_consistency` for its FRs. */
  readonly reviewConsistencyViolations: readonly string[];
}

export type ResumeSkill =
  | "/spec-write"
  | "/implement"
  | "/ship-milestone"
  | "/pr"
  /** The reduced chain's work stage — a target repo with no toolkit ceremony. */
  | "/work";
export type StepPlacement = "inline" | "worker";

export interface ResumeChainStep {
  readonly skill: ResumeSkill;
  readonly placement: StepPlacement;
  /** The FR id (for `/spec-write`) or the milestone token. */
  readonly target: string;
}

export interface ResumePlan {
  readonly milestone: string;
  readonly state: ResumeState;
  readonly chain: readonly ResumeChainStep[];
  /** What the operator is shown, verbatim. */
  readonly rendered: string;
}

export type ResumeGateDecision = "confirm" | "edit" | "abort";

export interface ResumeGateAnswer {
  readonly decision: ResumeGateDecision;
  readonly chain?: readonly ResumeChainStep[];
}

export interface ResumeOperatorGate {
  present(plan: ResumePlan): ResumeGateAnswer;
}

export interface ResumeSpawn {
  readonly milestone: string;
  readonly chain: readonly ResumeChainStep[];
}

export interface ResumeSpawnSink {
  spawnWorker(spawn: ResumeSpawn): void;
}

export interface ResumeInlineSink {
  runInline(step: ResumeChainStep): void;
}

export interface ResumeTrackerSink {
  claimMilestone(milestone: string): void;
}

export interface RunResumeInput {
  readonly projectRoot: string;
  readonly milestone: string;
  readonly gate: ResumeOperatorGate;
  readonly spawn: ResumeSpawnSink;
  readonly inline: ResumeInlineSink;
  readonly tracker: ResumeTrackerSink;
}

export interface ResumeRunOutcome {
  readonly decision: ResumeGateDecision;
  readonly milestone: string;
  readonly state: ResumeState;
  readonly plan: ResumePlan;
  /** What was actually run — `[]` on abort. */
  readonly chain: readonly ResumeChainStep[];
  /** Milestones this invocation resumed. Always 1. */
  readonly milestones: number;
  /** Workers that may run at once — the shipped serial invariant. */
  readonly concurrency: number;
}

/** A resume that must not start: the milestone is shipped or parked. */
export class ResumeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeRefusedError";
  }
}

// ===========================================================================
// Classification.
// ===========================================================================

const STAMP_RE = /^v\d+\.\d+\.\d+$/;

/** The plan's own frontmatter — the ship stamp and the parked record. */
async function readPlanFrontmatter(
  projectRoot: string,
  milestone: string,
  planStatus: PlanStatus,
): Promise<Record<string, unknown>> {
  if (planStatus === "missing") return {};
  const planDir = join(projectRoot, "specs", "plan");
  const file =
    planStatus === "archived"
      ? join(planDir, "archive", `${milestone}.md`)
      : join(planDir, `${milestone}.md`);
  try {
    return parseFrontmatter(await readFile(file, "utf-8"), { lenient: true });
  } catch {
    return {};
  }
}

/** A frontmatter scalar as a non-empty string, or null. */
function scalar(fm: Record<string, unknown>, key: string): string | null {
  const value = fm[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Classify a resumed milestone. Pure reads — nothing on disk moves, no tracker
 * is touched, and every predicate is the shipped helper's, not a copy.
 */
export async function classifyResume(
  projectRoot: string,
  milestone: string,
): Promise<ResumeClassification> {
  const taskState = await readPlanTaskState(join(projectRoot, "specs"), milestone);
  const planFm = await readPlanFrontmatter(projectRoot, milestone, taskState.planStatus);

  const shippedIn = scalar(planFm, "shipped_in");
  const parked = scalar(planFm, "ship_state") === "parked";
  const parkedReason = scalar(planFm, "park_reason");

  const binding = await milestoneFrBinding(projectRoot, milestone);
  const awaiting = (await frsAwaitingTechnicalReview(projectRoot))
    .filter((fr) => fr.milestone === milestone)
    .map((fr) => fr.id)
    .sort();
  const shipReady = (await shipReadyMilestones(projectRoot)).includes(milestone);

  // Precedence is deliberate and each step is load-bearing:
  //   a real ship stamp beats a stale review flag (the work is done and out);
  //   a parked plan beats ship-readiness (parking is an operator decision);
  //   unfinished specs beat everything still to build;
  //   ship-readiness beats partial work (zero active FRs means nothing is left
  //   to implement); and partial work — ticked plan tasks OR an already
  //   archived FR — beats "nothing built yet", so finished work is not redone.
  let state: ResumeState;
  if (shippedIn !== null && STAMP_RE.test(shippedIn)) {
    state = "shipped";
  } else if (parked) {
    state = "parked";
  } else if (awaiting.length > 0) {
    state = "needs_technical_review";
  } else if (shipReady) {
    state = "ship_ready";
  } else if (
    binding.archivedFrIds.length > 0 ||
    taskState.totalTasks - taskState.uncheckedTasks > 0
  ) {
    state = "partly_implemented";
  } else {
    state = "ready_to_implement";
  }

  const coherence = await runPlanShipCoherenceProbe(projectRoot);
  const consistency = await runNeedsTechnicalReviewConsistencyProbe(projectRoot);
  const boundActive = new Set(binding.activeFrIds);

  return {
    milestone,
    state,
    planStatus: taskState.planStatus,
    totalTasks: taskState.totalTasks,
    uncheckedTasks: taskState.uncheckedTasks,
    frsAwaitingReview: awaiting,
    parkedReason,
    shippedIn,
    shipCoherenceViolations: coherence.violations
      .filter((v) => basename(v.file, ".md") === milestone)
      .map((v) => v.message),
    reviewConsistencyViolations: consistency.violations
      .filter((v) => boundActive.has(basename(v.file, ".md")))
      .map((v) => v.message),
  };
}

// ===========================================================================
// The chain, the render, and the run.
// ===========================================================================

const SHIP_TAIL: readonly ResumeSkill[] = ["/ship-milestone", "/pr"];

/**
 * Which topology a resumed milestone's target repo supports.
 *
 * Mirrors `target_repo.MilestoneRoute` by VALUE rather than importing it, so
 * this module stays free of a dependency on the routing module — the caller
 * resolves the route and hands it in. Omitted means `invoking`, which is what
 * every plan that declares no `target_repo:` means and therefore the shipped
 * default.
 */
export type ResumeRoute = "invoking" | "cross_repo_toolkit" | "reduced";

/**
 * The exact chain a classified milestone should run, in order.
 *
 * ROUTE-AWARE as of the 2026-08-17 amendment to AC-STE-498.4. Before it, this
 * function had no target-repo awareness at all: it always emitted the full
 * `/implement -> /ship-milestone -> /pr` tail and always placed `/spec-write`
 * inline, which made two chains unreachable — a cross-repo milestone could not
 * bind its specs to the target tree, and a toolkit-less target got a chain with
 * two ceremony stages that cannot exist there.
 *
 * The `/spec-write` placement is the amended half, and the guarantee that
 * survives it is about WHO ANSWERS, not where the skill runs: `/deliver` never
 * answers on the operator's behalf, never paraphrases, never pre-fills and
 * never batches, on either branch. A VISIBLE worker the operator types into
 * directly inserts no relay hop, so it proxies nothing.
 */
export function resumeChain(
  c: ResumeClassification,
  route: ResumeRoute = "invoking",
): readonly ResumeChainStep[] {
  if (c.state === "shipped" || c.state === "parked") return [];

  const steps: ResumeChainStep[] = [];
  // AC-STE-498.4, amended: inline for the invoking repo; inside the target
  // repo's own worker when the milestone names another toolkit repo, because
  // that is the only place its tracker and specs bind correctly.
  const specWritePlacement: StepPlacement =
    route === "cross_repo_toolkit" ? "worker" : "inline";
  for (const fr of c.frsAwaitingReview) {
    steps.push({ skill: "/spec-write", placement: specWritePlacement, target: fr });
  }

  // A target repo with no toolkit has no ceremony to run: do the work, open a
  // PR. Emitting `/implement` or `/ship-milestone` there names stages that do
  // not exist in that tree.
  if (route === "reduced") {
    steps.push({ skill: "/work", placement: "worker", target: c.milestone });
    steps.push({ skill: "/pr", placement: "worker", target: c.milestone });
    return steps;
  }

  if (c.state !== "ship_ready") {
    steps.push({ skill: "/implement", placement: "worker", target: c.milestone });
  }
  for (const skill of SHIP_TAIL) {
    steps.push({ skill, placement: "worker", target: c.milestone });
  }
  return steps;
}

/** What the operator is shown before anything is spawned or claimed. */
export function renderResumePlan(c: ResumeClassification): ResumePlan {
  const chain = resumeChain(c);
  const lines = [`Resume ${c.milestone} — classified state: ${c.state}`, ""];
  chain.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step.skill} ${step.target} (${step.placement})`);
  });
  return { milestone: c.milestone, state: c.state, chain, rendered: lines.join("\n") };
}

function shippedRefusal(c: ResumeClassification): string {
  return [
    `Refusing: milestone ${c.milestone} already shipped as ${c.shippedIn ?? "a stamped release"}.`,
    "Remedy: resume a milestone that is still open, or mint a new milestone for the follow-up work.",
    `Context: milestone=${c.milestone}, state=shipped, shipped_in=${c.shippedIn ?? "<stamped>"}`,
  ].join("\n");
}

function parkedRefusal(c: ResumeClassification): string {
  const reason = c.parkedReason ?? "no reason recorded on the plan";
  return [
    `Refusing: milestone ${c.milestone} is parked — ${reason}.`,
    "Remedy: unpark the milestone by removing `ship_state: parked` from its plan, then re-run the resume.",
    `Context: milestone=${c.milestone}, state=parked, reason=${reason}`,
  ].join("\n");
}

/**
 * Resume ONE milestone: classify, refuse if it is shipped or parked, show the
 * operator the exact chain, and only then claim and spawn. Exactly one worker
 * carries the whole chain — the serial invariant is imported, not restated.
 */
export async function runResume(input: RunResumeInput): Promise<ResumeRunOutcome> {
  const c = await classifyResume(input.projectRoot, input.milestone);
  if (c.state === "shipped") throw new ResumeRefusedError(shippedRefusal(c));
  if (c.state === "parked") throw new ResumeRefusedError(parkedRefusal(c));

  const plan = renderResumePlan(c);
  const answer = input.gate.present(plan);

  const base = {
    milestone: input.milestone,
    state: c.state,
    plan,
    milestones: 1,
    concurrency: MAX_CONCURRENT_WORKERS,
  } as const;

  if (answer.decision === "abort") {
    return { ...base, decision: "abort", chain: [] };
  }

  const chain =
    answer.decision === "edit" && answer.chain !== undefined ? answer.chain : plan.chain;

  input.tracker.claimMilestone(input.milestone);
  for (const step of chain) {
    if (step.placement === "inline") input.inline.runInline(step);
  }
  input.spawn.spawnWorker({
    milestone: input.milestone,
    chain: chain.filter((s) => s.placement === "worker"),
  });

  return { ...base, decision: answer.decision, chain };
}
