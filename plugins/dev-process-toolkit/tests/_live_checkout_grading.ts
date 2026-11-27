// STE-847 (M_e8850b) — the grade of a gate-probe run over a live checkout.
//
// Between a milestone's archival commit and its release commit, probe #63
// rightly reports unshipped debt. The runner's rows carry counts and no kinds,
// so this reads the kinds from the probe itself and excuses that one row, only
// when the shared predicate leaves nothing of it. The probe stays as strict.

import {
  GATE_PROBES,
  runGateProbes,
  type GateProbeEntry,
} from "../adapters/_shared/src/gate_probe_runner";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { gradedViolations } from "./_plan_ship_grading";

const FULL_PASS = "conformance-probes pass: 75/75 ["; // Amended by AC-STE-879.4 (M_43bc84): probe count 74 -> 75.
const WINDOW_PASS = "conformance-probes pass: 74/75 ["; // Amended by AC-STE-879.4 (M_43bc84): probe count 74 -> 75.

/** One line per refusal; `[]` means the checkout is accepted. */
export async function gradeLiveCheckout(
  projectRoot: string,
  table: GateProbeEntry[] = GATE_PROBES,
): Promise<string[]> {
  const { rows, summary } = await runGateProbes(projectRoot, table);
  const { violations } = await runPlanShipCoherenceProbe(projectRoot);
  const refusals: string[] = [];

  const ids = table.map((e) => `#${e.n} ${e.id}`);
  const registered = GATE_PROBES.map((e) => `#${e.n} ${e.id}`);
  if (ids.join("\n") !== registered.join("\n")) {
    refusals.push("the probes run are not exactly the registered probes");
  }

  const owned = gradedViolations(violations);
  for (const v of owned) refusals.push(`probe #63: ${v.message}`);

  // A thrown probe, or one that counts anything beyond the debt, is another row.
  const debtRow = `probe #63 plan_ship_coherence: fail (${violations.length})`;
  const inWindow = violations.length > 0 && owned.length === 0 && rows.includes(debtRow);
  for (const row of rows) {
    if (row.includes(": fail (") && !(inWindow && row === debtRow)) refusals.push(row);
  }

  const expected = inWindow ? WINDOW_PASS : FULL_PASS;
  if (!summary.startsWith(expected)) refusals.push(`expected \`${expected}\`, got \`${summary}\``);
  return refusals;
}
