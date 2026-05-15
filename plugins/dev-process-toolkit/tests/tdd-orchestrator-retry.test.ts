import { describe, expect, test } from "bun:test";
import {
  newRetryBudget,
  recordAuditRoundFailure,
  recordTddFailure,
  type RetryKey,
} from "../adapters/_shared/src/tdd_retry_state";

// STE-225 AC.5 + AC.8(b/d) — Retry state machine.
//
// Five failure modes:
//   (A) false-RED — test-writer's tests don't actually fail when run
//   (B) implementer can't reach GREEN
//   (C) refactorer breaks GREEN
//   (D) format violation — no valid `tdd-result` block, wrong role, missing field
//   (E) maxTurns exhaustion — counts as failed attempt under (A)/(B)/(C) per role
//
// Budget:
//   A/B/C/E (semantic): max 2 attempts per role per AC, then halt.
//   D (format)        : single targeted retry, then halt.
//
// Halt path emits failure mode + retry count + last block (or raw output).

describe("AC-STE-225.5 — retry state machine", () => {
  test("first semantic failure on test-writer ⇒ retry (mode A)", () => {
    const budget = newRetryBudget();
    const key: RetryKey = { role: "test-writer" };
    const decision = recordTddFailure(budget, key, "A");
    expect(decision.decision).toBe("retry");
    expect(decision.retryKind).toBe("semantic");
    expect(decision.attemptNumber).toBe(1);
  });

  test("second semantic failure on test-writer ⇒ halt", () => {
    const budget = newRetryBudget();
    const key: RetryKey = { role: "test-writer" };
    recordTddFailure(budget, key, "A");
    const decision = recordTddFailure(budget, key, "A");
    expect(decision.decision).toBe("halt");
    expect(decision.attemptNumber).toBe(2);
  });

  test("implementer per-AC keying — different ACs do not share budget", () => {
    const budget = newRetryBudget();
    recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "B");
    const dec = recordTddFailure(
      budget,
      { role: "implementer", ac: "AC.2" },
      "B",
    );
    expect(dec.decision).toBe("retry");
    expect(dec.attemptNumber).toBe(1);
  });

  test("implementer same AC second failure ⇒ halt", () => {
    const budget = newRetryBudget();
    recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "B");
    const dec = recordTddFailure(
      budget,
      { role: "implementer", ac: "AC.1" },
      "B",
    );
    expect(dec.decision).toBe("halt");
  });

  test("refactorer first semantic failure ⇒ retry (mode C)", () => {
    const budget = newRetryBudget();
    const dec = recordTddFailure(budget, { role: "refactorer" }, "C");
    expect(dec.decision).toBe("retry");
    expect(dec.retryKind).toBe("semantic");
  });

  test("refactorer second semantic failure ⇒ halt", () => {
    const budget = newRetryBudget();
    recordTddFailure(budget, { role: "refactorer" }, "C");
    const dec = recordTddFailure(budget, { role: "refactorer" }, "C");
    expect(dec.decision).toBe("halt");
  });

  test("mode E (maxTurns) counts as semantic failure under same role", () => {
    const budget = newRetryBudget();
    const first = recordTddFailure(budget, { role: "test-writer" }, "E");
    expect(first.decision).toBe("retry");
    const second = recordTddFailure(budget, { role: "test-writer" }, "E");
    expect(second.decision).toBe("halt");
  });

  test("mode E mixes with mode A on the same key (both consume semantic budget)", () => {
    const budget = newRetryBudget();
    const first = recordTddFailure(budget, { role: "test-writer" }, "A");
    expect(first.decision).toBe("retry");
    const second = recordTddFailure(budget, { role: "test-writer" }, "E");
    expect(second.decision).toBe("halt");
  });

  test("first format violation (D) ⇒ retry with retryKind=format", () => {
    const budget = newRetryBudget();
    const dec = recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "D");
    expect(dec.decision).toBe("retry");
    expect(dec.retryKind).toBe("format");
  });

  test("second format violation (D) on same key ⇒ halt", () => {
    const budget = newRetryBudget();
    recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "D");
    const dec = recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "D");
    expect(dec.decision).toBe("halt");
  });

  test("format budget is independent of semantic budget on same key", () => {
    const budget = newRetryBudget();
    const sem = recordTddFailure(budget, { role: "test-writer" }, "A");
    const fmt = recordTddFailure(budget, { role: "test-writer" }, "D");
    expect(sem.decision).toBe("retry");
    expect(fmt.decision).toBe("retry");
    expect(fmt.retryKind).toBe("format");
  });

  test("decision.reason names the failure mode and the role", () => {
    const budget = newRetryBudget();
    const dec = recordTddFailure(budget, { role: "implementer", ac: "AC.7" }, "B");
    expect(dec.reason).toMatch(/B|implementer|AC\.7/);
  });

  test("halt decision still increments attemptNumber to expose the cap", () => {
    const budget = newRetryBudget();
    recordTddFailure(budget, { role: "test-writer" }, "A");
    const dec = recordTddFailure(budget, { role: "test-writer" }, "A");
    expect(dec.decision).toBe("halt");
    expect(dec.attemptNumber).toBe(2);
  });
});

// STE-296 AC.6 — audit-round retry budget (independent of per-AC budgets).
//
// `recordAuditRoundFailure(budget)` is keyed only on the literal "audit-round"
// slot (no role / ac). Cap = 1 — first call returns retry (attempt 1), second
// call returns halt (attempt 2). Independent from the per-AC semantic and
// format budgets.
describe("AC-STE-296.6 — recordAuditRoundFailure cap=1", () => {
  test("first audit-round failure ⇒ retry, attemptNumber=1", () => {
    const budget = newRetryBudget();
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("retry");
    expect(dec.attemptNumber).toBe(1);
  });

  test("second audit-round failure ⇒ halt, attemptNumber=2", () => {
    const budget = newRetryBudget();
    recordAuditRoundFailure(budget);
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("halt");
    expect(dec.attemptNumber).toBe(2);
  });

  test("audit-round budget independent of per-AC semantic budget", () => {
    const budget = newRetryBudget();
    // Burn the per-AC semantic budget for an implementer/AC pair — should not
    // touch audit-round.
    recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "B");
    recordTddFailure(budget, { role: "implementer", ac: "AC.1" }, "B");
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("retry");
    expect(dec.attemptNumber).toBe(1);
  });

  test("audit-round budget independent of test-writer semantic budget", () => {
    const budget = newRetryBudget();
    recordTddFailure(budget, { role: "test-writer" }, "A");
    const dec = recordAuditRoundFailure(budget);
    expect(dec.decision).toBe("retry");
    expect(dec.attemptNumber).toBe(1);
  });

  test("audit-round decision.reason names the audit-round mode", () => {
    const budget = newRetryBudget();
    recordAuditRoundFailure(budget);
    const dec = recordAuditRoundFailure(budget);
    expect(dec.reason).toMatch(/audit|spec-gap|spec-review/i);
  });
});
