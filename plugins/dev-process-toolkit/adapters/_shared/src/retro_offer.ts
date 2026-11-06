// STE-722 — front door for the close-out retrospective offer.
//
//   bun run retro_offer.ts <projectRoot> <scope>
//
// Reads `retro.enabled` first (through `retroSwitchOn`), before any scope or
// ledger read. When the switch is on, the scope resolves to at least one
// session and at least one rule trips, prints `scope=<scope>` then one
// `rule=<id> <value> <unit> > <threshold>` line per tripped result, all fields
// taken from the `evaluateRetroRules` result. Otherwise prints nothing.
// Always exits 0 and writes no file; the derivation is retro_scope.ts plus
// retro_rules.ts, never a second one.

import { resolve } from "node:path";

import { retroSwitchOn } from "./project_settings";
import { gatherRetroInputs } from "./retro";
import { evaluateRetroRules } from "./retro_rules";
import { resolveRetroScope } from "./retro_scope";

export interface RetroOfferDeps {
  resolveScope?: typeof resolveRetroScope;
  evaluate?: typeof evaluateRetroRules;
}

/** The offer lines, or `[]` when the offer must not fire. */
export function retroOfferLines(projectRoot: string, scope: string, deps: RetroOfferDeps = {}): string[] {
  if (!retroSwitchOn(projectRoot)) return [];
  const resolveScope = deps.resolveScope ?? resolveRetroScope;
  const evaluate = deps.evaluate ?? evaluateRetroRules;
  const resolved = resolveScope(projectRoot, scope);
  if (resolved.sessions.length === 0) return [];
  const tripped = evaluate(gatherRetroInputs(projectRoot, resolved)).filter((r) => r.disposition === "tripped");
  if (tripped.length === 0) return [];
  return [`scope=${scope}`, ...tripped.map((r) => `rule=${r.id} ${r.value} ${r.unit} > ${r.threshold}`)];
}

if (import.meta.main) {
  const [, , rootArg, scope = ""] = process.argv;
  try {
    const lines = retroOfferLines(resolve(rootArg ?? process.cwd()), scope);
    if (lines.length > 0) console.log(lines.join("\n"));
  } catch {
    // the offer stays silent on any failure
  }
  process.exit(0);
}
