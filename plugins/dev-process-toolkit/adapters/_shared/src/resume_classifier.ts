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

/**
 * The FR-scoped vocabulary (STE-500). Deliberately NOT the milestone six: an FR
 * is either still awaiting its technical-review pass or ready to build. The
 * remaining four milestone states answer a question about a milestone's plan,
 * not about one FR, and `partly_implemented` at FR scope is explicitly out of
 * scope for this FR.
 */
export type FrResumeState = "needs_technical_review" | "ready_to_implement";

/** The FR-scoped classification vocabulary, in entry-point order. */
export const FR_RESUME_STATES: readonly FrResumeState[] = [
  "needs_technical_review",
  "ready_to_implement",
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

/**
 * One FR's resume classification (STE-500). Every field is ASSEMBLED from the
 * helper that already owns it — `milestoneFrBinding` for the binding,
 * `frsAwaitingTechnicalReview` for the review flag and
 * `runNeedsTechnicalReviewConsistencyProbe` for the NFR-10 messages. Nothing
 * here walks the FR directories or reads the review frontmatter for itself.
 */
export interface FrResumeClassification {
  readonly scope: "fr";
  /** The FR id under work, e.g. `STE-500`. */
  readonly fr: string;
  readonly milestone: string;
  readonly state: FrResumeState;
  /** True when no OTHER active FR is bound to this milestone. */
  readonly lastActiveFr: boolean;
  /** Active FR ids bound to the milestone MINUS this FR, sorted. */
  readonly remainingActiveFrIds: readonly string[];
  /** Whether THIS FR still awaits its technical-review pass. */
  readonly needsTechnicalReview: boolean;
  /** NFR-10 messages from the shipped consistency probe naming THIS FR. */
  readonly reviewConsistencyViolations: readonly string[];
}

/** Ask the milestone question — the shipped classification, unchanged. */
export interface MilestoneScopeInput {
  readonly scope: "milestone";
  readonly milestone: string;
}

/** Ask the FR question: one FR, inside the milestone it is bound to. */
export interface FrScopeInput {
  readonly scope: "fr";
  readonly fr: string;
  readonly milestone: string;
}

export type ResumeScopeInput = MilestoneScopeInput | FrScopeInput;

export type ResumeSkill =
  | "/spec-write"
  | "/implement"
  /**
   * The bulk-archive stage, and the reason it is an EXPLICIT step rather than
   * something `/implement` is assumed to have done (STE-501 AC.3): a single-FR
   * `/implement <FR-id>` run intentionally leaves the FR at `status: active` and
   * archives nothing. A chain that went straight from it to `/ship-milestone`
   * would ask `active_plan_ship_ready` to release a milestone whose FRs are all
   * still active — and would be correctly refused. Never emitted by the
   * milestone-scoped chain, which archives through `/implement` itself.
   */
  | "/spec-archive"
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
  /**
   * Claim at FR granularity. OPTIONAL, so a sink written against the shipped
   * milestone contract keeps working: an FR-scoped run that finds no `claimFr`
   * falls back to `claimMilestone`, and never claims through both.
   */
  claimFr?(fr: string): void;
}

export interface RunResumeInput {
  readonly projectRoot: string;
  readonly milestone: string;
  /**
   * The FR under work. Its PRESENCE is what selects FR scope — absent, this is
   * the shipped milestone-scoped run, byte-for-byte.
   */
  readonly fr?: string;
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

/** The shape both consulted probes report a violation in. */
interface SubjectViolation {
  readonly file: string;
  readonly message: string;
}

/**
 * Which of a probe's violations belong to one subject.
 *
 * Every probe this module consults keys its violations by FILE, and that file's
 * stem IS the subject id — `specs/plan/M130.md` is M130's violation,
 * `specs/frs/STE-500.md` is STE-500's. Saying so once is what keeps the
 * milestone branch and the FR branch from drifting on what "mine" means; a
 * per-branch copy of the rule would let one of them widen silently.
 */
function violationMessagesFor(
  violations: readonly SubjectViolation[],
  isSubject: (stem: string) => boolean,
): string[] {
  return violations
    .filter((v) => isSubject(basename(v.file, ".md")))
    .map((v) => v.message);
}

/**
 * The NFR-10 canonical refusal: what was refused, how to get unstuck, and the
 * machine-readable context. Every refusal this module raises is rendered here
 * so the three-line shape has one home — the callers own the WORDS, never the
 * SHAPE, so no refusal can quietly drop a line the others carry.
 */
function nfr10Refusal(refusing: string, remedy: string, context: string): string {
  return [`Refusing: ${refusing}`, `Remedy: ${remedy}`, `Context: ${context}`].join(
    "\n",
  );
}

/**
 * Classify a resumed milestone. Pure reads — nothing on disk moves, no tracker
 * is touched, and every predicate is the shipped helper's, not a copy.
 */
async function classifyMilestoneResume(
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
    shipCoherenceViolations: violationMessagesFor(
      coherence.violations,
      (stem) => stem === milestone,
    ),
    reviewConsistencyViolations: violationMessagesFor(consistency.violations, (stem) =>
      boundActive.has(stem),
    ),
  };
}

// ===========================================================================
// FR-scoped classification (STE-500).
//
// ASSEMBLY, NOT NEW MACHINERY — the same rule the milestone branch above obeys:
//
//   - is this FR bound here, and which siblings are still active
//                                            → `active_plan_ship_ready`
//   - does this FR still await its technical-review pass
//                                            → `needs_technical_review_consistency`
//   - the NFR-10 messages for that flag      → the same module's probe
//
// A private FR-directory walk or a private read of the review flag here would
// become a second source of truth for a binding the gate already computes, and
// the two would drift silently. Read-only, like everything else in this file.
// ===========================================================================

/** The FR sits in the milestone's archive — there is nothing left to resume. */
function frArchivedRefusal(fr: string, milestone: string): string {
  return nfr10Refusal(
    `FR ${fr} is archived — it is finished work, not resumable work in milestone ${milestone}.`,
    `resume an active FR bound to ${milestone}, or resume the milestone itself to reach its ship stages.`,
    `scope=fr, fr=${fr}, milestone=${milestone}, fr_state=archived`,
  );
}

/** The FR is not bound to the named milestone — or does not exist at all. */
function frNotBoundRefusal(fr: string, milestone: string): string {
  return nfr10Refusal(
    `FR ${fr} is not an active FR of milestone ${milestone}.`,
    `name the milestone this FR is really bound to, or fix the FR's \`milestone:\` frontmatter, then re-run the resume.`,
    `scope=fr, fr=${fr}, milestone=${milestone}, binding=none`,
  );
}

/**
 * Classify ONE FR inside its milestone. Pure reads — nothing on disk moves, no
 * tracker is touched, and every predicate is the shipped helper's, not a copy.
 *
 * Refuses when the FR is not active work of this milestone, because the two
 * failure modes are different operator problems and both are silent otherwise:
 * an archived FR means the work already landed, an unbound FR means the wrong
 * milestone (or the wrong id) was named.
 */
async function classifyFrResume(
  projectRoot: string,
  fr: string,
  milestone: string,
): Promise<FrResumeClassification> {
  const binding = await milestoneFrBinding(projectRoot, milestone);
  if (!binding.activeFrIds.includes(fr)) {
    throw new ResumeRefusedError(
      binding.archivedFrIds.includes(fr)
        ? frArchivedRefusal(fr, milestone)
        : frNotBoundRefusal(fr, milestone),
    );
  }

  // A count over the SHIPPED enumeration minus the FR under work — not a new
  // scan. This is the predicate the ship-tail decision hangs off.
  //
  // Deliberately NOT re-sorted: `milestoneFrBinding` already returns its ids
  // sorted and a filter preserves that order, so a second sort here is the
  // identity — but it would make the ORDER of this list something two modules
  // each decide, and the next hand that changes either comparator gets to pick
  // which of them wins. One sort, one home.
  const remainingActiveFrIds = binding.activeFrIds.filter((id) => id !== fr);

  const needsTechnicalReview = (await frsAwaitingTechnicalReview(projectRoot)).some(
    (entry) => entry.id === fr,
  );
  const consistency = await runNeedsTechnicalReviewConsistencyProbe(projectRoot);

  return {
    scope: "fr",
    fr,
    milestone,
    state: needsTechnicalReview ? "needs_technical_review" : "ready_to_implement",
    lastActiveFr: remainingActiveFrIds.length === 0,
    remainingActiveFrIds,
    needsTechnicalReview,
    // This FR's own violations only: a sibling's inconsistency is that
    // sibling's problem and must not widen this FR's answer.
    reviewConsistencyViolations: violationMessagesFor(
      consistency.violations,
      (stem) => stem === fr,
    ),
  };
}

/**
 * Classify a resume target.
 *
 * The shipped positional form (`classifyResume(root, "M130")`) and the object
 * milestone form are the SAME call — the object form exists so a caller can say
 * which question it is asking without changing the answer it gets back.
 */
export async function classifyResume(
  projectRoot: string,
  milestone: string,
): Promise<ResumeClassification>;
export async function classifyResume(
  projectRoot: string,
  input: MilestoneScopeInput,
): Promise<ResumeClassification>;
export async function classifyResume(
  projectRoot: string,
  input: FrScopeInput,
): Promise<FrResumeClassification>;
export async function classifyResume(
  projectRoot: string,
  target: string | ResumeScopeInput,
): Promise<ResumeClassification | FrResumeClassification> {
  if (typeof target === "string") {
    return classifyMilestoneResume(projectRoot, target);
  }
  if (target.scope === "fr") {
    return classifyFrResume(projectRoot, target.fr, target.milestone);
  }
  return classifyMilestoneResume(projectRoot, target.milestone);
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
  route?: ResumeRoute,
): readonly ResumeChainStep[];
export function resumeChain(
  c: FrResumeClassification,
  route?: ResumeRoute,
): readonly ResumeChainStep[];
export function resumeChain(
  c: ResumeClassification | FrResumeClassification,
  route: ResumeRoute = "invoking",
): readonly ResumeChainStep[] {
  // The FR-scoped branch dispatches FIRST: everything below reads milestone-only
  // fields (`frsAwaitingReview`, the milestone state vocabulary) that an
  // `FrResumeClassification` does not carry.
  return isFrClassification(c)
    ? frResumeChain(c, route)
    : milestoneResumeChain(c, route);
}

/** Which classification this is. The `scope` tag is the FR shape's own field. */
function isFrClassification(
  c: ResumeClassification | FrResumeClassification,
): c is FrResumeClassification {
  return (c as FrResumeClassification).scope === "fr";
}

/**
 * Where a `/spec-write` review pass runs.
 *
 * AC-STE-498.4, amended: inline for the invoking repo; inside the target repo's
 * own worker when the milestone names another toolkit repo, because that is the
 * only place its tracker and specs bind correctly. Stated ONCE so the milestone
 * chain and the FR chain cannot drift on it.
 */
function reviewPassPlacement(route: ResumeRoute): StepPlacement {
  return route === "cross_repo_toolkit" ? "worker" : "inline";
}

/**
 * The chain for ONE FR (STE-501).
 *
 * Two step lists, and the predicate that picks between them is STE-500's
 * `lastActiveFr` — not a recount here. Building an FR that leaves siblings open
 * stops at `/pr`: the milestone is not finished, and running the ceremony would
 * release it early. Building the LAST active FR closes the milestone, so the
 * chain carries on through `/spec-archive` (see the `ResumeSkill` member: a
 * single-FR `/implement` leaves `status: active` behind) and `/ship-milestone`.
 *
 * The shipped route rules apply unchanged: `reduced` has no toolkit ceremony to
 * run on either branch, and the review pass keeps the shipped placement rule.
 */
function frResumeChain(
  c: FrResumeClassification,
  route: ResumeRoute,
): readonly ResumeChainStep[] {
  const steps: ResumeChainStep[] = [];

  // AC-STE-501.7: one pass, scoped to THIS FR. Not a sweep of the milestone's
  // flagged FRs — a sibling's unfinished specs are that sibling's run's problem.
  if (c.needsTechnicalReview) {
    steps.push({
      skill: "/spec-write",
      placement: reviewPassPlacement(route),
      target: c.fr,
    });
  }

  if (route === "reduced") {
    steps.push({ skill: "/work", placement: "worker", target: c.milestone });
    steps.push({ skill: "/pr", placement: "worker", target: c.milestone });
    return steps;
  }

  steps.push({ skill: "/implement", placement: "worker", target: c.fr });
  if (c.lastActiveFr) {
    steps.push({ skill: "/spec-archive", placement: "worker", target: c.milestone });
    steps.push({ skill: "/ship-milestone", placement: "worker", target: c.milestone });
  }
  steps.push({ skill: "/pr", placement: "worker", target: c.milestone });
  return steps;
}

/** The shipped milestone-scoped chain, unchanged. */
function milestoneResumeChain(
  c: ResumeClassification,
  route: ResumeRoute,
): readonly ResumeChainStep[] {
  if (c.state === "shipped" || c.state === "parked") return [];

  const steps: ResumeChainStep[] = [];
  const specWritePlacement = reviewPassPlacement(route);
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

/**
 * The numbered step list, in one place so both scopes render the same shape.
 *
 * Exported because it is the ONE renderer of a step line: `deliver_decision`
 * prints the same chain into its decision record, and a byte-identical copy
 * there would let the record and the plan the operator confirms drift apart the
 * day either shape moves.
 */
export function stepLines(chain: readonly ResumeChainStep[]): string[] {
  return chain.map(
    (step, i) => `  ${i + 1}. ${step.skill} ${step.target} (${step.placement})`,
  );
}

/**
 * WHY this chain and not the other one, in the operator's words.
 *
 * AC-STE-501.4: a render that is nothing but the step list leaves the operator
 * ratifying rather than deciding — there is no way to catch a miscount in a list
 * of skills. So the count that drove the branch, and the branch itself, are
 * written out.
 */
function frBranchReason(c: FrResumeClassification): string {
  if (c.lastActiveFr) {
    return (
      `${c.fr} is the last active FR of ${c.milestone}: ${c.remainingActiveFrIds.length} active FRs would remain once ` +
      `it lands, so the chain extends through /spec-archive and /ship-milestone before ` +
      `the PR.`
    );
  }
  const remaining = c.remainingActiveFrIds.length;
  const noun = remaining === 1 ? "other active FR remains" : "other active FRs remain";
  return (
    `${remaining} ${noun} bound to ${c.milestone} once ${c.fr} lands, so the chain ` +
    `stops at the PR — the ship ceremony belongs to the run that closes the milestone.`
  );
}

/** What the operator is shown before anything is spawned or claimed. */
export function renderResumePlan(c: ResumeClassification): ResumePlan;
export function renderResumePlan(c: FrResumeClassification): ResumePlan;
export function renderResumePlan(
  c: ResumeClassification | FrResumeClassification,
): ResumePlan {
  return isFrClassification(c) ? renderFrResumePlan(c) : renderMilestoneResumePlan(c);
}

function renderMilestoneResumePlan(c: ResumeClassification): ResumePlan {
  const chain = resumeChain(c);
  const lines = [
    `Resume ${c.milestone} — classified state: ${c.state}`,
    "",
    ...stepLines(chain),
  ];
  return { milestone: c.milestone, state: c.state, chain, rendered: lines.join("\n") };
}

function renderFrResumePlan(c: FrResumeClassification): ResumePlan {
  const chain = resumeChain(c);
  const lines = [
    `Resume ${c.fr} in ${c.milestone} — FR scope, classified state: ${c.state}`,
    frBranchReason(c),
    "",
    ...stepLines(chain),
  ];
  return { milestone: c.milestone, state: c.state, chain, rendered: lines.join("\n") };
}

function shippedRefusal(c: ResumeClassification): string {
  return nfr10Refusal(
    `milestone ${c.milestone} already shipped as ${c.shippedIn ?? "a stamped release"}.`,
    "resume a milestone that is still open, or mint a new milestone for the follow-up work.",
    `milestone=${c.milestone}, state=shipped, shipped_in=${c.shippedIn ?? "<stamped>"}`,
  );
}

function parkedRefusal(c: ResumeClassification): string {
  const reason = c.parkedReason ?? "no reason recorded on the plan";
  return nfr10Refusal(
    `milestone ${c.milestone} is parked — ${reason}.`,
    "unpark the milestone by removing `ship_state: parked` from its plan, then re-run the resume.",
    `milestone=${c.milestone}, state=parked, reason=${reason}`,
  );
}

/**
 * Everything a resume run does AFTER it knows which plan to show — one home for
 * both scopes.
 *
 * The guarantees living here are one rule each, not one per scope: the abort
 * returns before any claim, any inline step and any spawn (AC-STE-501.6); the
 * operator's edited chain is what runs, and the proposed one is not spawned
 * alongside it (AC-STE-501.5); exactly one worker carries the whole worker
 * chain, with the serial invariant imported rather than restated. A per-scope
 * copy of this sequence is how one branch quietly loses a guarantee the other
 * keeps — so the ONLY thing the callers vary is who gets claimed.
 *
 * `claim` runs past the abort and before the first inline step, which is the
 * ordering both scopes are pinned to.
 */
function dispatchResume(
  input: RunResumeInput,
  plan: ResumePlan,
  claim: () => void,
): ResumeRunOutcome {
  const answer = input.gate.present(plan);

  const base = {
    milestone: input.milestone,
    state: plan.state,
    plan,
    milestones: 1,
    concurrency: MAX_CONCURRENT_WORKERS,
  } as const;

  if (answer.decision === "abort") {
    return { ...base, decision: "abort", chain: [] };
  }

  const chain =
    answer.decision === "edit" && answer.chain !== undefined ? answer.chain : plan.chain;

  claim();
  for (const step of chain) {
    if (step.placement === "inline") input.inline.runInline(step);
  }
  input.spawn.spawnWorker({
    milestone: input.milestone,
    chain: chain.filter((s) => s.placement === "worker"),
  });

  return { ...base, decision: answer.decision, chain };
}

/**
 * Resume ONE milestone: classify, refuse if it is shipped or parked, show the
 * operator the exact chain, and only then claim and spawn.
 */
export async function runResume(input: RunResumeInput): Promise<ResumeRunOutcome> {
  // FR scope is selected by the PRESENCE of `fr`, and it dispatches before the
  // milestone classification runs: the two answer different questions.
  if (input.fr !== undefined) return runFrResume(input, input.fr);

  const c = await classifyResume(input.projectRoot, input.milestone);
  if (c.state === "shipped") throw new ResumeRefusedError(shippedRefusal(c));
  if (c.state === "parked") throw new ResumeRefusedError(parkedRefusal(c));

  return dispatchResume(input, renderResumePlan(c), () =>
    input.tracker.claimMilestone(input.milestone),
  );
}

/**
 * Resume ONE FR: classify at FR scope, show the operator the chain WITH the
 * reason it was chosen, and only then claim and spawn.
 *
 * Differs from the milestone run in exactly two places — the plan is the
 * FR-scoped one, and the claim prefers FR granularity. Everything the two runs
 * share lives in `dispatchResume`.
 */
async function runFrResume(
  input: RunResumeInput,
  fr: string,
): Promise<ResumeRunOutcome> {
  const c = await classifyResume(input.projectRoot, {
    scope: "fr",
    fr,
    milestone: input.milestone,
  });

  // FR granularity when the sink offers it, the shipped milestone claim
  // otherwise — never both. An FR run that also claimed the milestone would
  // report the whole milestone as started when only one of its FRs is.
  return dispatchResume(input, renderResumePlan(c), () => {
    if (input.tracker.claimFr !== undefined) {
      input.tracker.claimFr(c.fr);
    } else {
      input.tracker.claimMilestone(input.milestone);
    }
  });
}
