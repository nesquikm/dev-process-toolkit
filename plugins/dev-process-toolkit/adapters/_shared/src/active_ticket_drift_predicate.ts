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
// | backlog/etc.  | any          | any              | any         | fail (M23 drift) |
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
  in_progress: string;
  done: string;
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
 * the current user, OR the single-FR-clean exemption applies (STE-151
 * partial-checked branch), OR the fully-checked-single-FR exemption applies
 * (STE-180 fully-checked branch).
 */
export function activeTicketDriftPasses(
  summary: TicketSummaryLike,
  planTaskState: PlanTaskState,
  statusMapping: StatusMapping,
  currentUser: string,
): boolean {
  return (
    inProgressMatches(summary, currentUser) ||
    singleFrCleanExempt(summary, planTaskState, statusMapping) ||
    fullyCheckedSingleFrExempt(summary, planTaskState, statusMapping)
  );
}
