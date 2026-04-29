import { describe, expect, test } from "bun:test";
import {
  activeTicketDriftPasses,
  inProgressMatches,
  singleFrCleanExempt,
} from "../adapters/_shared/src/active_ticket_drift_predicate";
import type { PlanTaskState } from "../adapters/_shared/src/plan_task_state";

// STE-151 — predicate truth table:
//
// | FR status | Ticket status | Assignee     | Plan tasks       | Plan status | Outcome |
// |-----------|---------------|--------------|------------------|-------------|---------|
// | active    | in_progress   | currentUser  | any              | any         | pass |
// | active    | done          | any          | unchecked > 0    | active      | pass (single-FR clean) |
// | active    | done          | any          | all checked      | active      | fail (forgot bulk archive) |
// | active    | done          | any          | any              | missing     | fail (strict fallback) |
// | active    | done          | any          | any              | archived    | vacuous (probe #27 owns) |
// | active    | backlog/etc.  | any          | any              | any         | fail (M23 drift) |
// | active    | in_progress   | != current   | any              | any         | fail (M23 drift) |
//
// One discrete test per row.

const STATUS_MAP = { in_progress: "in_progress", done: "done" } as const;

function planTaskState(
  uncheckedTasks: number,
  planStatus: PlanTaskState["planStatus"] = "active",
  totalTasks: number = uncheckedTasks,
): PlanTaskState {
  return { uncheckedTasks, totalTasks, planStatus };
}

describe("inProgressMatches — original strict shape", () => {
  test("status=in_progress + assignee=currentUser → true", () => {
    expect(inProgressMatches({ status: "in_progress", assignee: "u@e" }, "u@e")).toBe(true);
  });

  test("status=in_progress + wrong assignee → false", () => {
    expect(inProgressMatches({ status: "in_progress", assignee: "other@e" }, "u@e")).toBe(false);
  });

  test("status=done + currentUser → false (status mismatch)", () => {
    expect(inProgressMatches({ status: "done", assignee: "u@e" }, "u@e")).toBe(false);
  });

  test("status=in_progress + null assignee → false", () => {
    expect(inProgressMatches({ status: "in_progress", assignee: null }, "u@e")).toBe(false);
  });
});

describe("singleFrCleanExempt — Done + plan unchecked + active plan", () => {
  test("done + unchecked > 0 + active plan → true (single-FR clean)", () => {
    expect(
      singleFrCleanExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(3, "active"),
        STATUS_MAP,
      ),
    ).toBe(true);
  });

  test("done + all checked + active plan → false (forgot bulk archive)", () => {
    expect(
      singleFrCleanExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "active", 3),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("done + any tasks + missing plan → false (orphan, strict fallback)", () => {
    expect(
      singleFrCleanExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "missing", 0),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("done + archived plan → false (vacuous case — caller must scope before calling)", () => {
    // The exemption only applies to active plans. Archived-plan FR pairs are
    // owned by probe #27; the predicate stays defensively false here so a
    // miswired caller can't accidentally grant the exemption to an archived
    // plan.
    expect(
      singleFrCleanExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "archived", 5),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("in_progress + unchecked > 0 + active plan → false (only 'done' triggers exemption)", () => {
    expect(
      singleFrCleanExempt(
        { status: "in_progress", assignee: "u@e" },
        planTaskState(3, "active"),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("backlog + unchecked > 0 + active plan → false", () => {
    expect(
      singleFrCleanExempt(
        { status: "backlog", assignee: null },
        planTaskState(3, "active"),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("custom status_mapping — exemption keys off mapping.done, not literal 'done'", () => {
    const customMap = { in_progress: "Doing", done: "Shipped" } as const;
    expect(
      singleFrCleanExempt(
        { status: "Shipped", assignee: "u@e" },
        planTaskState(3, "active"),
        customMap,
      ),
    ).toBe(true);
    expect(
      singleFrCleanExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(3, "active"),
        customMap,
      ),
    ).toBe(false);
  });
});

describe("activeTicketDriftPasses — composed predicate (truth table)", () => {
  test("row 1: in_progress + currentUser + any plan → pass", () => {
    expect(
      activeTicketDriftPasses(
        { status: "in_progress", assignee: "u@e" },
        planTaskState(3, "active"),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(true);
  });

  test("row 2: done + any assignee + unchecked > 0 + active → pass (single-FR clean)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "done", assignee: null },
        planTaskState(2, "active"),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(true);
  });

  test("row 3: done + all checked + active plan → fail (forgot bulk archive)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "active", 3),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });

  test("row 4: done + missing plan → fail (strict fallback)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "missing", 0),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });

  test("row 5: done + archived plan → exemption denied (caller must scope to probe #27)", () => {
    // The composed predicate must not grant the exemption when the plan is
    // archived; downstream the call site is expected to filter to active
    // plans only. Belt-and-suspenders.
    expect(
      activeTicketDriftPasses(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "archived", 3),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });

  test("row 6: backlog + any assignee → fail (M23 drift)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "backlog", assignee: null },
        planTaskState(3, "active"),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });

  test("row 7: in_progress + wrong assignee → fail (M23 drift)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "in_progress", assignee: "other@e" },
        planTaskState(3, "active"),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });
});
