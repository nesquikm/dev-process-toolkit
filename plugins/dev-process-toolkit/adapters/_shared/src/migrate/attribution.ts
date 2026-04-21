// Milestone attribution for migrated FRs (AC-48.6/7 support).
//
// Extracted from migrate/index.ts to respect NFR-7 (500-line source-file cap).
// The two-pass strategy is documented on findMilestoneForFr below.

import type { splitPlan } from "./split_plan";

export function oldFrOrder(a: string, b: string): number {
  const na = parseInt(a.replace(/^FR-/, ""), 10);
  const nb = parseInt(b.replace(/^FR-/, ""), 10);
  return na - nb;
}

/**
 * Resolve an FR's milestone by scanning plan bodies.
 *
 * Strategy (in order):
 *   1. Look for the canonical declaration line `**FRs covered:** FR-N..M`
 *      (or comma-separated variants like `FR-N, FR-M, FR-P`) in each
 *      milestone body. This is the unambiguous author-declared mapping.
 *   2. If no milestone has the canonical line, fall back to a substring
 *      match — but only on the first `- [ ]` task-line occurrence (task
 *      lines reference the FR they're implementing), not the whole body.
 *      This avoids the old bug where cross-milestone commentary caused
 *      mis-attribution (e.g., M12's body mentioned FR-41..50 in its
 *      co-development paragraph, so the substring match incorrectly
 *      bucketed M13's FRs into M12).
 *
 * Returns null if no milestone claims the FR; caller falls back to
 * fallbackMilestone.
 */
export function findMilestoneForFr(
  oldId: string,
  planSplit: ReturnType<typeof splitPlan>,
): string | null {
  // Pass 1: canonical `**FRs covered:**` declaration
  const n = parseInt(oldId.replace(/^FR-/, ""), 10);
  if (!Number.isNaN(n)) {
    for (const m of planSplit.milestones) {
      const declared = extractDeclaredFrRange(m.body);
      if (declared.has(n)) return m.id;
    }
  }
  // Pass 2: scoped-body substring (task-line only, not commentary)
  const targetRe = new RegExp(`^\\s*-\\s+\\[\\s*[ x]\\s*\\]\\s.*\\b${oldId}\\b`, "m");
  for (const m of planSplit.milestones) {
    if (targetRe.test(m.body)) return m.id;
  }
  return null;
}

/**
 * Parse `**FRs covered:** FR-29..39` or `**FRs covered:** FR-1, FR-2, FR-5`
 * into a Set of FR numbers. Used by findMilestoneForFr to make milestone
 * attribution unambiguous.
 */
export function extractDeclaredFrRange(planBody: string): Set<number> {
  const out = new Set<number>();
  const m = /\*\*FRs covered:\*\*\s*([^\n]+)/i.exec(planBody);
  if (!m) return out;
  const list = m[1]!;
  const rangeRe = /FR-(\d+)\.\.(\d+)/g;
  const singleRe = /FR-(\d+)(?!\.\.\d)/g;
  let match: RegExpExecArray | null;
  while ((match = rangeRe.exec(list)) !== null) {
    const a = parseInt(match[1]!, 10);
    const b = parseInt(match[2]!, 10);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi; i++) out.add(i);
  }
  while ((match = singleRe.exec(list)) !== null) {
    out.add(parseInt(match[1]!, 10));
  }
  return out;
}

export function fallbackMilestone(planSplit: ReturnType<typeof splitPlan>): string {
  if (planSplit.milestones.length > 0) return planSplit.milestones[0]!.id;
  return "M0";
}
