// m137-registration-routing — a /gate-check registration must ORDER the graded
// entry point, not the raw scanner it wraps.
//
// THE CLASS, and it shipped twice before this guard existed. A module that
// layers grading over a pure scanner has TWO entry points, and a registration
// is a front door made of prose: the imperative sentence — "call `X(projectRoot)`"
// — is what a reader or an LLM acts on. Naming the graded function later, in a
// descriptive clause, routes nobody.
//
// Measured on probe #67 before the fix: the registration ordered
// `scanFrSummaryAltitude` and mentioned `runFrSummaryAltitudeProbe` only in
// prose, and the module's own CLI called the raw scanner too. On a 447-FR
// corpus that is 616 error rows against 0 — the entire grandfathering arm,
// verified across eight legs and mutation-tested, could not fire through any
// door a user actually comes in by. Every test passed because tests call the
// graded function directly.
//
// WHY A TEST AND NOT A NOTE: the defect is invisible to every other guard we
// have. It is not a missing function, a wrong result, or an unreachable module
// — probe #81 grades reachability and this module was reachable. What was wrong
// was WHICH of two reachable functions the door pointed at.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const GATE_CHECK = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

/** Modules exporting a graded wrapper, with the raw entries it may wrap. */
function gradedModules(): { module: string; graded: string[]; raw: string[] }[] {
  const out: { module: string; graded: string[]; raw: string[] }[] = [];
  for (const name of readdirSync(SRC).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const src = readFileSync(join(SRC, name), "utf-8");
    const graded = [...src.matchAll(/^export (?:async )?function (run[A-Za-z]*)/gm)].map((m) => m[1]!);
    const raw = [...src.matchAll(/^export (?:async )?function ((?:scan|verify)[A-Za-z]*)/gm)].map((m) => m[1]!);
    if (graded.length > 0 && raw.length > 0) out.push({ module: name.replace(/\.ts$/, ""), graded, raw });
  }
  return out;
}

/** The imperatives a registration issues: every ``call `X(`` in the file. */
function orderedNames(): string[] {
  return [...readFileSync(GATE_CHECK, "utf-8").matchAll(/call `([A-Za-z]+)\(/g)].map((m) => m[1]!);
}

describe("a registration orders the GRADED entry, never the raw one it wraps", () => {
  test("the corpus is non-empty — there are graded modules to check", () => {
    // Non-vacuity first. If the extractor stopped matching, every leg below
    // would pass over an empty list and this guard would be worth nothing.
    const mods = gradedModules();
    expect(mods.length, "no graded modules found — the extractor is broken").toBeGreaterThan(3);
    expect(orderedNames().length, "no imperatives found in the registration").toBeGreaterThan(10);
  });

  test("no registration imperative names a raw scanner that has a graded wrapper", () => {
    const ordered = new Set(orderedNames());
    const offenders: string[] = [];
    for (const { module, graded, raw } of gradedModules()) {
      for (const r of raw) {
        if (!ordered.has(r)) continue;
        // The raw name is ORDERED. That is only acceptable if this module's
        // graded wrapper is ordered too and the raw call serves a different
        // subject — as `stage_block_adoption` does, where `--report` grades a
        // captured report rather than the authoring tree.
        if (!graded.some((g) => ordered.has(g))) {
          offenders.push(`${module}: registration orders \`${r}\` but never \`${graded.join("` / `")}\``);
        }
      }
    }
    expect(
      offenders,
      `a registration ordering a raw scanner routes past its grading arm:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("probe #67 specifically orders both GRADED halves", () => {
    // The instance that produced this guard, pinned by name so a future edit
    // cannot quietly revert it to the raw scanner.
    const ordered = new Set(orderedNames());
    expect(ordered.has("runFrSummaryAltitudeProbe"), "the FR half must be ordered graded").toBe(true);
    expect(ordered.has("scanFrSummaryAltitude"), "the raw FR scanner must not be ordered").toBe(false);
  });
});

describe("a module's CLI front door routes to the graded entry too", () => {
  test("no `import.meta.main` block calls a raw scanner without its graded wrapper", () => {
    const offenders: string[] = [];
    for (const { module, graded, raw } of gradedModules()) {
      const src = readFileSync(join(SRC, `${module}.ts`), "utf-8");
      const at = src.search(/^if \(import\.meta\.main\) \{/m);
      if (at === -1) continue; // no CLI is not a misroute
      const block = src.slice(at);
      const callsGraded = graded.some((g) => block.includes(`${g}(`));
      const callsRaw = raw.filter((r) => block.includes(`${r}(`));
      if (callsRaw.length > 0 && !callsGraded) {
        offenders.push(`${module}: CLI calls \`${callsRaw.join("`, `")}\` and never a graded wrapper`);
      }
    }
    expect(offenders, offenders.join("\n  ")).toEqual([]);
  });
});
