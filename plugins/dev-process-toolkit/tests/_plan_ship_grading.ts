// STE-574 — the ONE predicate the live-tree dogfoods grade probe #63 through.
//
// An archived plan that has not yet shipped is legitimate transient state
// between /implement's archival commit and /ship-milestone's release commit.
// A live-tree assert that grades the whole report flat reds every test run
// inside that window, and the ship cannot clear a gate it must clear to ship.
//
// So the DOGFOOD narrows; the PROBE does not. `runPlanShipCoherenceProbe`
// still reports unshipped debt, /gate-check probe #63 still grades it at
// severity error, and `/ship-milestone`'s bare no-arg form still scans
// `specs/plan/archive/` for exactly this predicate. What changes is the one
// instant at which a `bun test` run passes judgement on it.
//
// This lives in ONE module rather than being retyped at each dogfood so that
// `tests/m_a8e09a-ste-574-dogfood-scope.test.ts` grades THE predicate the
// dogfoods use, not a copy of it that could drift away from them.

import type { PlanShipCoherenceViolation } from "../adapters/_shared/src/plan_ship_coherence";

/**
 * The one kind a live-tree dogfood does not own: unshipped ship debt.
 *
 * Named, not inlined — the mutation arm in the STE-574 suite compares the
 * predicate's selection against a degenerate one, and a bare string literal in
 * two places is how the two halves stop being the same predicate.
 */
export const TRANSIENT_KIND = "unshipped_debt" as const;

/**
 * The violations a live-tree assert owns: everything except the transient kind.
 *
 * Corrupt stamps and release-surface disagreement are NOT transient — neither
 * one becomes true and then false again by shipping — so both survive here.
 * A predicate that selected nothing would satisfy "the window is clean" and
 * "detection is unmoved" at the same time while deleting the whole check;
 * that is what the suite's mandatory mutation arm exists to catch.
 */
export function gradedViolations(
  rows: readonly PlanShipCoherenceViolation[],
): PlanShipCoherenceViolation[] {
  return rows.filter((v) => v.kind !== TRANSIENT_KIND);
}
