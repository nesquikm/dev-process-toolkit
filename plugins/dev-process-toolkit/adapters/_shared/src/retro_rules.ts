// STE-719 (M_d1b4b7) — the /retro rule engine.
//
// Every rule declares `id`, `source` (one or more members of the closed
// PARENT_VISIBLE_SOURCES set), `threshold` (`value`, `unit`, `comparator`) and
// an evaluator returning `{ observable, value }`. The engine maps each result
// to exactly one disposition in RETRO_DISPOSITIONS. A rule never reports
// `clear` from absent data.

import { gateSubject } from "./gate_receipt";

/** The closed set of sources a rule may read: each a session's own, parent-visible file. */
export const PARENT_VISIBLE_SOURCES = ["timeline", "capture_ledger", "token_ledger"] as const;
export type RetroSource = (typeof PARENT_VISIBLE_SOURCES)[number];

export const SKIPPED_DISPOSITION = "skipped: input not observable" as const;
export const RETRO_DISPOSITIONS = ["tripped", "clear", SKIPPED_DISPOSITION] as const;
export type RetroDisposition = (typeof RETRO_DISPOSITIONS)[number];

export type RetroComparator = ">" | ">=";

export interface RetroThreshold {
  value: number | Record<string, number>;
  unit: string;
  comparator: RetroComparator;
}

export interface RetroEvaluation {
  observable: boolean;
  value?: number | null;
  /** Set by a rule whose threshold is not a single number (e.g. a per-subject map). */
  tripped?: boolean;
  /** Why the input is not observable; names the missing input. */
  reason?: string;
}

export interface RetroInputs {
  sessions: { session_id: string; timeline: unknown | null; capture_rows: unknown[] }[];
  token_rows: unknown[];
  tracking: { token_stats: boolean; tool_calls: boolean; gate_outcomes: boolean };
}

export interface RetroRule {
  id: string;
  source: readonly string[];
  threshold: RetroThreshold;
  evaluate: (inputs: RetroInputs, rule: RetroRule) => RetroEvaluation;
  /** The unit the report line prints, when it must say more than the threshold's unit. */
  reportUnit?: string;
}

export interface RetroRuleResult {
  id: string;
  source: readonly string[];
  threshold: RetroThreshold["value"];
  unit: string;
  value: number | null;
  disposition: RetroDisposition;
  reason: string | null;
}

type Row = Record<string, unknown>;

const skip = (reason: string): RetroEvaluation => ({ observable: false, value: null, reason });
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x): x is Row => typeof x === "object" && x !== null) : []);
const offSuffix = (on: boolean, key: string): string => (on ? "" : ` (${key} off)`);

/** The timelines of the scope's sessions, or the skip naming why there are none. */
function scopeTimelines(inputs: RetroInputs): Row[] | RetroEvaluation {
  const tls = inputs.sessions.map((s) => s.timeline).filter((t): t is Row => typeof t === "object" && t !== null);
  if (tls.length === 0) return skip(`no scope session has a timeline file${offSuffix(inputs.tracking.tool_calls, "tracking.tool_calls")}`);
  return tls;
}

const gateRuns = (tls: Row[]): Row[] => tls.flatMap((t) => asRows(t.gate_runs));
const gateFieldSkip = (inputs: RetroInputs, field: string): RetroEvaluation =>
  skip(`no gate run has a non-null ${field}${offSuffix(inputs.tracking.gate_outcomes, "tracking.gate_outcomes")}`);

function compare(value: number, bound: number, comparator: RetroComparator): boolean {
  return comparator === ">" ? value > bound : value >= bound;
}


function evaluateSlowGateRun(inputs: RetroInputs, rule: RetroRule): RetroEvaluation {
  const tls = scopeTimelines(inputs);
  if (!Array.isArray(tls)) return tls;
  const bounds = rule.threshold.value as Record<string, number>;
  const timed = gateRuns(tls).filter(
    (g) => (g.outcome === "pass" || g.outcome === "fail") && typeof g.wall_ms === "number" && typeof bounds[String(g.subject)] === "number",
  );
  if (timed.length === 0) return gateFieldSkip(inputs, "wall_ms");
  const tripped = timed.some((g) => compare(g.wall_ms as number, bounds[String(g.subject)]!, rule.threshold.comparator));
  return { observable: true, value: Math.max(...timed.map((g) => g.wall_ms as number)), tripped };
}

function evaluateGateRerunUnchangedKey(inputs: RetroInputs): RetroEvaluation {
  const tls = scopeTimelines(inputs);
  if (!Array.isArray(tls)) return tls;
  const keyed = gateRuns(tls).filter((g) => typeof g.key_digest === "string");
  if (keyed.length === 0) return gateFieldSkip(inputs, "key_digest");
  const groups = new Map<string, number>();
  for (const g of keyed) {
    if (g.outcome !== "pass" || g.key_stable !== true) continue;
    const k = `${String(g.subject)}\u0000${String(g.key_digest)}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  let sum = 0;
  for (const n of groups.values()) sum += n - 1;
  return { observable: true, value: sum };
}

const TDD_WORK_SKILLS = ["dev-process-toolkit:tdd-implement", "dev-process-toolkit:tdd-refactor"];

function evaluateZeroYieldRound(inputs: RetroInputs): RetroEvaluation {
  const tls = scopeTimelines(inputs);
  if (!Array.isArray(tls)) return tls;
  const rounds = tls.flatMap((t) => asRows(t.rounds)).filter((r) => TDD_WORK_SKILLS.includes(String(r.skill)));
  if (rounds.length === 0) return skip("no tdd-implement or tdd-refactor round in scope");
  const observed = rounds.filter((r) => r.tree_disposition !== "not-observable");
  if (observed.length === 0) return skip("every tdd-implement or tdd-refactor round has tree_disposition not-observable");
  return { observable: true, value: observed.filter((r) => r.tree_changed === false).length };
}

function evaluateCostPerChangedLine(inputs: RetroInputs): RetroEvaluation {
  const label = "parent-visible tokens";
  if (!inputs.tracking.token_stats) return skip(`${label}: no token-ledger rows (tracking.token_stats off)`);
  const tokens = asRows(inputs.token_rows).filter((r) => typeof r.output_tokens === "number");
  if (tokens.length === 0) return skip(`${label}: no token-ledger row in scope`);
  const diffs = inputs.sessions
    .flatMap((s) => asRows(s.capture_rows))
    .filter((r) => r.class === "commit" && r.scope !== "fork" && typeof r.diff === "object" && r.diff !== null)
    .map((r) => r.diff as Row);
  if (diffs.length === 0) return skip(`${label}: no commit row carries a diff`);
  const lines = diffs.reduce((n, d) => n + (Number(d.insertions) || 0) + (Number(d.deletions) || 0), 0);
  if (lines === 0) return skip(`${label}: the changed-line sum is 0`);
  const sum = tokens.reduce((n, r) => n + (r.output_tokens as number), 0);
  return { observable: true, value: sum / lines };
}

export const RETRO_RULES: readonly RetroRule[] = [
  {
    id: "slow_gate_run",
    source: ["timeline"],
    threshold: {
      value: {
        [gateSubject("gate-check")]: 900000,
        [gateSubject("spec-review")]: 1200000,
        [gateSubject("tdd")]: 3600000,
      },
      unit: "ms",
      comparator: ">",
    },
    evaluate: evaluateSlowGateRun,
  },
  {
    id: "gate_rerun_unchanged_key",
    source: ["timeline"],
    threshold: { value: 1, unit: "runs", comparator: ">=" },
    evaluate: evaluateGateRerunUnchangedKey,
  },
  {
    id: "zero_yield_round",
    source: ["timeline"],
    threshold: { value: 2, unit: "rounds", comparator: ">=" },
    evaluate: evaluateZeroYieldRound,
  },
  {
    id: "cost_per_changed_line",
    source: ["token_ledger", "capture_ledger"],
    threshold: { value: 500, unit: "tokens/line", comparator: ">" },
    reportUnit: "parent-visible tokens/line",
    evaluate: evaluateCostPerChangedLine,
  },
];

/**
 * Every rule's sources are checked against PARENT_VISIBLE_SOURCES before any
 * evaluator runs; a rule naming any other source throws.
 */
function assertParentVisible(rules: readonly RetroRule[]): void {
  const allowed: readonly string[] = PARENT_VISIBLE_SOURCES;
  for (const r of rules) {
    const bad = r.source.filter((s) => !allowed.includes(s));
    if (r.source.length === 0 || bad.length > 0) {
      throw new Error(
        `retro rule ${r.id} reads a source outside PARENT_VISIBLE_SOURCES (${allowed.join(", ")}): ${bad.length > 0 ? bad.join(", ") : "<none declared>"}`,
      );
    }
  }
}

export function evaluateRetroRules(inputs: RetroInputs, rules: readonly RetroRule[] = RETRO_RULES): RetroRuleResult[] {
  assertParentVisible(rules);
  return rules.map((r) => {
    const ev = r.evaluate(inputs, r);
    const base = { id: r.id, source: r.source, threshold: r.threshold.value, unit: r.reportUnit ?? r.threshold.unit };
    if (!ev.observable || typeof ev.value !== "number") {
      return { ...base, value: null, disposition: SKIPPED_DISPOSITION, reason: ev.reason ?? `${r.id}: input not observable` };
    }
    const bound = r.threshold.value;
    const tripped = typeof bound === "number" ? compare(ev.value, bound, r.threshold.comparator) : ev.tripped === true;
    return { ...base, value: ev.value, disposition: tripped ? "tripped" : "clear", reason: null };
  });
}
