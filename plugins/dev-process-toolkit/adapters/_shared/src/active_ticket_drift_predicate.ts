// active_ticket_drift_predicate — STE-151 (carve-out for partial-checked
// plans), widened by STE-180 (carve-out for fully-checked plans). Pure
// functions powering the /gate-check probe #14 ("Ticket-state drift —
// active side") relaxed decision rule.
//
// Predicate truth table (FR is `status: active` in every row):
//
// | Ticket status | Assignee     | Plan tasks       | Plan status | Outcome |
// |---------------|--------------|------------------|-------------|---------|
// | in_progress   | currentUser  | any              | any         | pass |
// | done          | any          | unchecked > 0    | active      | pass (single-FR clean — STE-151) |
// | done          | any          | all checked + total > 0 | active | pass + advisory (fully-checked — STE-180) |
// | done          | any          | total = 0        | active      | fail (empty/malformed plan) |
// | done          | any          | any              | missing     | fail (strict fallback) |
// | done          | any          | any              | archived    | vacuous (probe #27 owns) |
// | initial       | any          | no checked task names the FR; no lock names it; `startedBy` supplied and empty | any | pass (not started — STE-825) |
// | backlog/etc.  | any          | any              | any         | fail (M23 drift, unless the not-started row above holds) |
// | in_progress   | != current   | any              | any         | fail (M23 drift) |
//
// When the fully-checked exemption fires, the probe additionally emits an
// advisory — `M<N> plan fully checked but not archived — run /spec-archive
// M<N> or /implement M<N> to close` — so the operator can finish the
// canonical-chain milestone-close step. Severity = note, never gate-fail.
//
// Splitting into discrete pure functions lets the test suite render the
// table directly — one test per row.

import type { PlanTaskState } from "./plan_task_state";

export interface TicketSummaryLike {
  status: string;
  assignee?: string | null;
}

export interface StatusMapping {
  initial?: string;
  in_progress: string;
  done: string;
}

/** The FR's tracker id, its minted `id:` when it has one, and the ids held in the lock store (`readLockIds`). */
export interface FrRef {
  trackerId: string;
  /** The FR's frontmatter `id:` — locks are filed under it, not under the tracker id. */
  frId?: string;
  lockIds: readonly string[];
  /**
   * Evidence lines showing the FR's work has begun (STE-825). Absent: the
   * caller gathered no evidence, so the not-started carve-out never fires.
   * Non-empty: started, so the carve-out never fires either.
   */
  startedBy?: readonly string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regex matching text that names `trackerId`, bounded by non-alphanumerics on
 * both sides: `fix-STE-825` and `STE-825-2` name STE-825, `STE-8250` does not.
 * Shared by the not-started carve-out and `fr_work_started` (STE-825).
 */
export function namesTrackerIdRe(trackerId: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(trackerId)}(?![0-9A-Za-z])`);
}

/**
 * STE-825 not-started carve-out. True iff the ticket's status maps to the
 * `initial` role, no checked task line (`[x]` or `[X]`) of the FR's plan
 * names its tracker id, no lock entry names the FR, and `frRef.startedBy`
 * is supplied and empty. Without `frRef` or `startedBy` nothing is provable.
 */
export function notStartedExempt(
  summary: TicketSummaryLike,
  planTaskState: PlanTaskState,
  statusMapping: StatusMapping,
  frRef?: FrRef,
): boolean {
  if (!frRef || !frRef.trackerId || statusMapping.initial == null) return false;
  if (frRef.startedBy === undefined || frRef.startedBy.length > 0) return false;
  if (summary.status !== statusMapping.initial) return false;
  const named = namesTrackerIdRe(frRef.trackerId);
  if ((planTaskState.checkedTaskLines ?? []).some((line) => named.test(line))) return false;
  return !frRef.lockIds.some((id) => id === frRef.trackerId || (frRef.frId !== undefined && id === frRef.frId));
}

/**
 * Original strict shape (M23 origin guarantee). True iff the ticket is in
 * the in-progress lane AND the assignee matches the current user.
 */
export function inProgressMatches(
  summary: TicketSummaryLike,
  currentUser: string,
): boolean {
  return (
    summary.status === "in_progress" &&
    summary.assignee != null &&
    summary.assignee === currentUser
  );
}

/**
 * STE-151 single-FR-clean exemption. True iff the ticket is in the done
 * lane AND the milestone plan is still active AND has at least one
 * unchecked task line.
 *
 * The exemption only applies to active plans. Archived-plan FR pairs are
 * the domain of probe #27 (frontmatter-milestone-not-archived); a missing
 * plan is an orphan and falls back to the strict assertion.
 */
export function singleFrCleanExempt(
  summary: TicketSummaryLike,
  planTaskState: PlanTaskState,
  statusMapping: StatusMapping,
): boolean {
  return (
    summary.status === statusMapping.done &&
    planTaskState.planStatus === "active" &&
    planTaskState.uncheckedTasks > 0
  );
}

/**
 * STE-180 fully-checked-single-FR exemption. True iff the ticket is in the
 * done lane AND the milestone plan is still active AND has zero unchecked
 * task lines AND has at least one task line total (i.e., the plan has
 * something to check; an empty plan is malformed and falls back to the
 * strict assertion).
 *
 * Together with `singleFrCleanExempt`, this covers both legitimate
 * mid-canonical-chain states for `/implement <FR-id>` runs:
 *   - partial-checked (other tasks remain in the milestone) — STE-151
 *   - fully-checked (this FR completed the milestone's last task) — STE-180
 *
 * The probe runner emits an advisory when this branch fires; severity is
 * note, not error.
 */
export function fullyCheckedSingleFrExempt(
  summary: TicketSummaryLike,
  planTaskState: PlanTaskState,
  statusMapping: StatusMapping,
): boolean {
  return (
    summary.status === statusMapping.done &&
    planTaskState.planStatus === "active" &&
    planTaskState.uncheckedTasks === 0 &&
    planTaskState.totalTasks > 0
  );
}

/**
 * Composed predicate the probe runner asks: "does this active FR pass
 * probe #14?". Pass iff the ticket is in the in-progress lane assigned to
 * the current user, OR the not-started carve-out applies (STE-825), OR
 * the single-FR-clean exemption applies (STE-151
 * partial-checked branch), OR the fully-checked-single-FR exemption applies
 * (STE-180 fully-checked branch).
 */
export function activeTicketDriftPasses(
  summary: TicketSummaryLike,
  planTaskState: PlanTaskState,
  statusMapping: StatusMapping,
  currentUser: string,
  frRef?: FrRef,
): boolean {
  return (
    inProgressMatches(summary, currentUser) ||
    notStartedExempt(summary, planTaskState, statusMapping, frRef) ||
    singleFrCleanExempt(summary, planTaskState, statusMapping) ||
    fullyCheckedSingleFrExempt(summary, planTaskState, statusMapping)
  );
}
