// tdd_retry_state — STE-225 AC.5. Bounded retry state machine for the
// TDD orchestrator. Five failure modes:
//
//   (A) false-RED — test-writer's tests pass when run (must show RED)
//   (B) implementer can't reach GREEN
//   (C) refactorer breaks GREEN
//   (D) format violation — no `tdd-result` block, wrong role, or missing
//       required field
//   (E) maxTurns exhaustion — counts as a failed attempt under whichever
//       semantic mode (A/B/C) applies to the calling role
//
// Budget:
//   A/B/C/E (semantic): max 2 attempts per role per AC. After the second
//                       failure the orchestrator halts and escalates.
//   D (format)        : single targeted retry. After the second format
//                       failure the orchestrator halts.
//
// The two budgets are independent so a format violation does not consume
// the semantic-failure budget (the retry is a cheaper class of fix —
// "re-emit your last message with a valid tdd-result block").
//
// Keying:
//   test-writer / refactorer  ⇒ key = role         (run once per FR)
//   implementer               ⇒ key = role + ac    (run per AC)

import type { TddRole } from "./tdd_result";

export type FailureMode = "A" | "B" | "C" | "D" | "E" | "spec-gap";

export interface RetryKey {
  role: TddRole;
  /** Required for `implementer`; ignored for `test-writer` / `refactorer`. */
  ac?: string;
}

export interface RetryDecision {
  decision: "retry" | "halt";
  /** Set when decision === 'retry'. */
  retryKind?: "semantic" | "format";
  /** 1-based attempt number after recording this event. */
  attemptNumber: number;
  /** Human-readable explanation; surfaces failure mode + role + ac. */
  reason: string;
}

export interface RetryBudget {
  semantic: Map<string, number>;
  format: Map<string, number>;
  /** Independent audit-round counter — STE-296 AC.6, cap = 1. */
  auditRound: number;
}

const SEMANTIC_CAP = 2;
const FORMAT_CAP = 2;
const AUDIT_ROUND_CAP = 1;

export function newRetryBudget(): RetryBudget {
  return { semantic: new Map(), format: new Map(), auditRound: 0 };
}

/**
 * Record an audit-round failure — STE-296 AC.6 stub. The audit-round
 * budget is independent from per-AC semantic / format budgets. Cap = 1
 * (one retry after the first audit; halt on the second). Full
 * implementation lands under AC.6's fork.
 */
export function recordAuditRoundFailure(budget: RetryBudget): RetryDecision {
  budget.auditRound += 1;
  const attemptNumber = budget.auditRound;
  const decision: "retry" | "halt" =
    attemptNumber > AUDIT_ROUND_CAP ? "halt" : "retry";
  return {
    decision,
    retryKind: decision === "retry" ? "semantic" : undefined,
    attemptNumber,
    reason:
      decision === "retry"
        ? `audit-round attempt ${attemptNumber} — retrying RED→GREEN sub-loop for missing ACs`
        : `audit-round attempt ${attemptNumber} exceeds cap ${AUDIT_ROUND_CAP} — halting`,
  };
}

function keyToString(key: RetryKey): string {
  if (key.role === "implementer") return `implementer:${key.ac ?? ""}`;
  return key.role;
}

function isFormatMode(mode: FailureMode): boolean {
  return mode === "D";
}

export function recordTddFailure(
  budget: RetryBudget,
  key: RetryKey,
  mode: FailureMode,
): RetryDecision {
  const k = keyToString(key);
  const isFormat = isFormatMode(mode);
  const map = isFormat ? budget.format : budget.semantic;
  const cap = isFormat ? FORMAT_CAP : SEMANTIC_CAP;
  const prior = map.get(k) ?? 0;
  const attemptNumber = prior + 1;
  map.set(k, attemptNumber);
  const decision: "retry" | "halt" = attemptNumber >= cap ? "halt" : "retry";
  const acFragment = key.role === "implementer" && key.ac ? ` for ${key.ac}` : "";
  const reason = decision === "retry"
    ? `mode ${mode} on ${key.role}${acFragment} — attempt ${attemptNumber}/${cap}, retry queued`
    : `mode ${mode} on ${key.role}${acFragment} — attempt ${attemptNumber}/${cap}, halt`;
  if (decision === "retry") {
    return {
      decision,
      retryKind: isFormat ? "format" : "semantic",
      attemptNumber,
      reason,
    };
  }
  return { decision, attemptNumber, reason };
}
