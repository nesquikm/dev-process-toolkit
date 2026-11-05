// STE-712 — front door for the opt-in close-out upgrade offer.
//
//   bun run upgrade_offer.ts <projectRoot>
//
// Behind the switch `close_out.upgrade_offer.enabled` (off by default). The
// switch is read FIRST: off (absent, false, legacy, no settings file, or any
// loader refusal) prints nothing and runs no probe. With it on, prints probe
// #69's rows followed by UPGRADE_OFFER_QUESTION, or nothing when the probe
// reports no rows or the tree is not toolkit-managed. Always exits 0. The
// module never walks the migration registry itself; probe #69 owns what is
// stale, and the remedy string is imported, never retyped.

import { resolve } from "node:path";
import { upgradeOfferSwitchOn } from "./project_settings";
import { isToolkitManaged } from "./toolkit_managed";
import {
  type UpgradeStalenessReport,
  UPGRADE_STALENESS_REMEDY,
  runUpgradeStalenessProbe,
} from "./upgrade_staleness";

export const UPGRADE_OFFER_QUESTION = "Apply the pending toolkit upgrades now? [y/N]";

export interface UpgradeOfferDeps {
  probe?: (projectRoot: string) => Promise<UpgradeStalenessReport>;
  isManaged?: (projectRoot: string) => boolean;
}

/** The offer lines, or `[]` when the offer must not fire. */
export async function upgradeOfferLines(projectRoot: string, deps: UpgradeOfferDeps = {}): Promise<string[]> {
  if (!upgradeOfferSwitchOn(projectRoot)) return [];
  const probe = deps.probe ?? ((root: string) => runUpgradeStalenessProbe(root));
  const isManaged = deps.isManaged ?? ((root: string) => isToolkitManaged(root));
  const { rows } = await probe(projectRoot);
  if (rows.length === 0) return [];
  if (!isManaged(projectRoot)) return [];
  return [...rows, UPGRADE_OFFER_QUESTION];
}

/** What a declined offer prints: probe #69's remedy line, verbatim. */
export function upgradeDeclineLines(): string[] {
  return [UPGRADE_STALENESS_REMEDY];
}

/**
 * The Phase 4 carried-forward NOTES lines for probe #69: the report's notes
 * unchanged (remedy line included) when no offer was made, its rows alone
 * (remedy line dropped, the offer named the upgrade) when it was.
 */
export function carriedUpgradeNotes(report: UpgradeStalenessReport, offerMade: boolean): string[] {
  return offerMade ? [...report.rows] : [...report.notes];
}

if (import.meta.main) {
  const [rootArg] = process.argv.slice(2);
  const projectRoot = resolve(rootArg ?? process.cwd());
  try {
    const lines = await upgradeOfferLines(projectRoot);
    if (lines.length > 0) console.log(lines.join("\n"));
  } catch {
    // The offer is advisory: a probe failure prints nothing.
  }
  process.exit(0);
}
