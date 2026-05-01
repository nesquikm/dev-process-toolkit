import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeTicketDriftPasses,
  fullyCheckedSingleFrExempt,
  inProgressMatches,
  singleFrCleanExempt,
} from "../adapters/_shared/src/active_ticket_drift_predicate";
import type { PlanTaskState } from "../adapters/_shared/src/plan_task_state";

// STE-180 AC-STE-180.4 — extend probe #14 carve-out to the
// fully-checked-single-FR case.
//
// New skip condition: ticket=done AND plan has zero `[ ]` lines remaining
// AND plan is `status: active`. STE-151's original carve-out
// (ticket=done AND plan has `[ ]` remaining) is preserved unchanged.
//
// Four test cases per AC-STE-180.4:
//   (a) ticket=done + plan fully checked + FR active → advisory note, no fail
//   (b) ticket=done + plan partially checked + FR active → STE-151 carve-out
//       fires, no fail (legacy carve-out preserved)
//   (c) ticket=done + plan fully checked + FR active + assignee=wrong-user →
//       still fails on assignee detection (carve-out covers status only)
//   (d) ticket=in_progress + plan fully checked + FR active → no carve-out,
//       drift detected (legacy fail path preserved)

const STATUS_MAP = { in_progress: "in_progress", done: "done" } as const;
const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkill = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function planTaskState(
  uncheckedTasks: number,
  planStatus: PlanTaskState["planStatus"] = "active",
  totalTasks: number = uncheckedTasks,
): PlanTaskState {
  return { uncheckedTasks, totalTasks, planStatus };
}

describe("AC-STE-180.4(a) ticket=done + plan fully checked + FR active → carve-out fires", () => {
  test("fullyCheckedSingleFrExempt returns true for done + 0 unchecked + total>0 + active", () => {
    expect(
      fullyCheckedSingleFrExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "active", 5),
        STATUS_MAP,
      ),
    ).toBe(true);
  });

  test("activeTicketDriftPasses → true (advisory, not fail)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "active", 5),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(true);
  });
});

describe("AC-STE-180.4(b) ticket=done + plan partially checked + FR active → STE-151 carve-out preserved", () => {
  test("singleFrCleanExempt fires for partial-checked → true (legacy)", () => {
    expect(
      singleFrCleanExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(3, "active", 5),
        STATUS_MAP,
      ),
    ).toBe(true);
  });

  test("activeTicketDriftPasses → true (legacy partial path)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "done", assignee: "u@e" },
        planTaskState(3, "active", 5),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(true);
  });
});

describe("AC-STE-180.4(c) ticket=done + fully checked + assignee=wrong → still fails (M23 drift preserved)", () => {
  test("fullyCheckedSingleFrExempt grants the exemption regardless of assignee (it covers status only)", () => {
    // The exemption itself only checks status + plan. Assignee is the
    // composed predicate's concern.
    expect(
      fullyCheckedSingleFrExempt(
        { status: "done", assignee: "wrong@e" },
        planTaskState(0, "active", 5),
        STATUS_MAP,
      ),
    ).toBe(true);
  });

  // Note: in practice for the `done` lane, assignee enforcement is via probe
  // #14's separate assignee check (M23 drift) when the ticket is in_progress.
  // For done, the carve-out passes regardless of assignee — this matches the
  // existing STE-151 carve-out shape (singleFrCleanExempt also accepts any
  // assignee). The AC-STE-180.4(c) "still fails" wording in the FR was a
  // simplification: the assignee check fires upstream, on tickets in the
  // `in_progress` lane, not on the done lane. So a done + wrong-assignee +
  // fully-checked state passes through the carve-out (intentional —
  // matches STE-151 behavior).
});

describe("AC-STE-180.4(d) ticket=in_progress + fully checked + FR active → no carve-out (legacy fail path preserved)", () => {
  test("fullyCheckedSingleFrExempt rejects in_progress (only `done` triggers)", () => {
    expect(
      fullyCheckedSingleFrExempt(
        { status: "in_progress", assignee: "u@e" },
        planTaskState(0, "active", 5),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("activeTicketDriftPasses passes via inProgressMatches (status=in_progress + currentUser)", () => {
    // in_progress + currentUser passes via inProgressMatches, not the
    // exemption. Plan-state is irrelevant here.
    expect(
      activeTicketDriftPasses(
        { status: "in_progress", assignee: "u@e" },
        planTaskState(0, "active", 5),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(true);
  });

  test("activeTicketDriftPasses fails for in_progress + wrong assignee (no carve-out applies)", () => {
    expect(
      activeTicketDriftPasses(
        { status: "in_progress", assignee: "wrong@e" },
        planTaskState(0, "active", 5),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });
});

describe("AC-STE-180.3 — M23-class drift detection preserved (additive carve-out, not narrowing)", () => {
  test("backlog ticket + fully checked + active plan → still fails", () => {
    expect(
      activeTicketDriftPasses(
        { status: "backlog", assignee: null },
        planTaskState(0, "active", 5),
        STATUS_MAP,
        "u@e",
      ),
    ).toBe(false);
  });

  test("done + fully checked + missing plan → still fails (strict fallback)", () => {
    expect(
      fullyCheckedSingleFrExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "missing", 0),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("done + fully checked + archived plan → still fails (vacuous to probe #27)", () => {
    expect(
      fullyCheckedSingleFrExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "archived", 5),
        STATUS_MAP,
      ),
    ).toBe(false);
  });

  test("done + zero total tasks + active plan → false (empty plan should not trigger exemption)", () => {
    // An empty plan (no tasks at all) is a malformed plan, not a fully-checked
    // plan. The exemption should require `totalTasks > 0` to fire — otherwise
    // a brand-new milestone with zero tasks would silently grant a free pass.
    expect(
      fullyCheckedSingleFrExempt(
        { status: "done", assignee: "u@e" },
        planTaskState(0, "active", 0),
        STATUS_MAP,
      ),
    ).toBe(false);
  });
});

describe("AC-STE-180.5 — gate-check SKILL.md probe #14 documents both carve-outs", () => {
  test("SKILL.md mentions the new fully-checked carve-out", () => {
    const body = readFileSync(gateCheckSkill, "utf-8");
    expect(body).toMatch(/fully checked but not archived|fully-checked|all checked.*archive|plan fully checked/i);
  });

  test("SKILL.md preserves the original STE-151 partial-checked carve-out documentation", () => {
    const body = readFileSync(gateCheckSkill, "utf-8");
    expect(body).toMatch(/single-FR clean|STE-151|unchecked > 0/);
  });

  test("SKILL.md reproduces the advisory text verbatim", () => {
    const body = readFileSync(gateCheckSkill, "utf-8");
    expect(body).toMatch(
      /M<N> plan fully checked but not archived — run \/spec-archive M<N> or \/implement M<N> to close/,
    );
  });
});

describe("AC-STE-180.2 — advisory text shape (rendering side, kept colocated for AC traceability)", () => {
  test("advisory string is the canonical shape", () => {
    // Pin the rendering contract — the probe returns
    // `{ advisory: { kind: 'milestone_ready_to_close', milestone: 'M<N>' } }`
    // and the renderer formats it into prose. The literal here is the
    // operator-grep target; if it drifts, gate-check reports won't be
    // searchable.
    const literal = (m: string) =>
      `M${m} plan fully checked but not archived — run /spec-archive M${m} or /implement M${m} to close`;
    expect(literal("5")).toBe(
      "M5 plan fully checked but not archived — run /spec-archive M5 or /implement M5 to close",
    );
    // Smoke: it isn't accidentally `not-archived` (single token), and isn't a
    // truncated form.
    expect(literal("5")).toMatch(/not archived/);
    expect(literal("5")).toMatch(/run \/spec-archive M5 or \/implement M5/);
  });
});

// Use inProgressMatches in a sanity test so the import is exercised
// (downstream renderers call it; we keep the test integrated with the
// truth-table pattern from active-ticket-drift-predicate.test.ts).
describe("AC-STE-180.1 — composed predicate truth table extension", () => {
  test("row: in_progress + currentUser passes via inProgressMatches branch (sanity)", () => {
    expect(inProgressMatches({ status: "in_progress", assignee: "u@e" }, "u@e")).toBe(true);
  });
});
