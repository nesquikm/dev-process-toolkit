// active_ticket_drift_predicate — STE-151. Pure functions powering the
// /gate-check probe #14 ("Ticket-state drift — active side") relaxed
// decision rule.
//
// Predicate truth table (FR is `status: active` in every row):
//
// | Ticket status | Assignee     | Plan tasks       | Plan status | Outcome |
// |---------------|--------------|------------------|-------------|---------|
// | in_progress   | currentUser  | any              | any         | pass |
// | done          | any          | unchecked > 0    | active      | pass (single-FR clean) |
// | done          | any          | all checked      | active      | fail (forgot bulk archive) |
// | done          | any          | any              | missing     | fail (strict fallback) |
// | done          | any          | any              | archived    | vacuous (probe #27 owns) |
// | backlog/etc.  | any          | any              | any         | fail (M23 drift) |
// | in_progress   | != current   | any              | any         | fail (M23 drift) |
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
 * Composed predicate the probe runner asks: "does this active FR pass
 * probe #14?". Pass iff the ticket is in the in-progress lane assigned
 * to the current user, OR the single-FR-clean exemption applies.
 */
export function activeTicketDriftPasses(
  summary: TicketSummaryLike,
  planTaskState: PlanTaskState,
  statusMapping: StatusMapping,
  currentUser: string,
): boolean {
  return (
    inProgressMatches(summary, currentUser) ||
    singleFrCleanExempt(summary, planTaskState, statusMapping)
  );
}
