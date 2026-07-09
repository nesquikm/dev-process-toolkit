// AC-STE-143.5 — regression guard for the F8 namespace sweep.
//
// `STE-N` / `M<N>` references are internal traceability noise once the
// plugin ships. Adapters, skills, and docs that downstream projects copy
// or read should carry as few of these as possible. Tier-1 (M38 STE-137)
// cleared most user-copied surfaces; Tier-2 + Tier-3 (M39 STE-143)
// stripped trailing parentheticals from adapter docs, skill prose, and
// reference docs. This test locks the post-sweep residual counts in place
// so future edits can't silently re-grow the surface.
//
// The ceiling is calibrated post-sweep: the residue is exactly the
// load-bearing references that other tests assert on (AC anchors,
// historical-context heading suffixes, etc.). Future contributors who
// need to add a new STE-N reference should consider whether it's
// genuinely load-bearing — if not, route the audit context through
// `git log` / `git blame` instead.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

function countNamespaceTokens(dir: string): number {
  let count = 0;
  function walk(d: string) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      const body = readFileSync(p, "utf-8");
      const matches = body.match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [];
      count += matches.length;
    }
  }
  walk(dir);
  return count;
}

// Ceilings calibrated post-sweep on M39 STE-143. The residue is exactly
// the load-bearing references that other tests assert on. Loosening these
// requires explaining why — tightening them is always welcome.
const CEILINGS = {
  adapters: 5, // Tier 2 cleaned: 0 baseline, 5 buffer for future minor refs.
  skills: 240, // Tier 3 conservative-sweep residue + STE-301 deps-research anchor refs (M78) + STE-318 four-stage AUDIT canon citing STE-296 M77 origin (M84) + STE-324 disable-model-invocation allowlist probe #59 citing STE-308 + HG95TQ origins (M84) + STE-369 plan_ship_coherence probe #63 row anchor and spec-archive --parked flag anchor (M99) + STE-373 deps_research_result_shape (#64) and deps_research_disposition_contract (#65) gate-check probe-row origin citations (M100).
  docs: 250, // Tier 3 conservative-sweep residue (~216 + buffer).
};

describe("AC-STE-143.5 — internal namespace token ceilings (post-F8 sweep)", () => {
  test("adapters/*.md token count stays within ceiling", () => {
    const count = countNamespaceTokens(join(pluginRoot, "adapters"));
    expect(count).toBeLessThanOrEqual(CEILINGS.adapters);
  });

  test("skills/*/SKILL.md token count stays within ceiling", () => {
    const count = countNamespaceTokens(join(pluginRoot, "skills"));
    expect(count).toBeLessThanOrEqual(CEILINGS.skills);
  });

  test("docs/*.md token count stays within ceiling", () => {
    const count = countNamespaceTokens(join(pluginRoot, "docs"));
    expect(count).toBeLessThanOrEqual(CEILINGS.docs);
  });
});
