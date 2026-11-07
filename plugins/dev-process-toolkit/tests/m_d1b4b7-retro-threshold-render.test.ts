// M_d1b4b7 pre-PR fix — a per-subject threshold renders as its bound, never
// as `[object Object]` (AC-STE-722.1 and AC-STE-721.2).
//
// `slow_gate_run`'s threshold is a per-subject map. Both rule-line renderers,
// the close-out offer (`retro_offer.ts`) and the `--from-retro` default
// (`report_issue_retro.ts`), printed it with a template literal, so a tripped
// run read `> [object Object]`. Every row here drives the committed fixtures
// under `tests/fixtures/m_d1b4b7-retro/` through the real engine, and every
// row was red on the v3.2.0 release commit 5cac191e.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildRetroReport } from "../adapters/_shared/src/retro_report";
import { retroPromptDefaults } from "../adapters/_shared/src/report_issue_retro";
import { retroOfferLines } from "../adapters/_shared/src/retro_offer";
import { evaluateRetroRules, type RetroRuleResult } from "../adapters/_shared/src/retro_rules";
import { RULE_IDS, SRC, cleanupTemps, loadCase, makeRetroTree } from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const T = 60_000;

const results = (rel: string): RetroRuleResult[] => evaluateRetroRules(loadCase(rel) as never);

/** The offer's lines for engine results, on a tree whose `retro.enabled` is true. */
function offerLines(rs: RetroRuleResult[]): string[] {
  const root = makeRetroTree("render", { retro: "true" });
  return retroOfferLines(root, "M_a1b2c3", {
    resolveScope: () => ({ kind: "milestone", id: "M_a1b2c3", sessions: ["fixture-session"], reason: null }) as never,
    evaluate: () => rs,
  });
}

/** The `--from-retro` "what happened" default for engine results. */
function whatHappened(rs: RetroRuleResult[]): string {
  const report = buildRetroReport({
    scope: { kind: "milestone", id: "M_a1b2c3" },
    sessionIds: [],
    results: rs,
    pluginVersion: "9.9.9",
    generatedAt: "2026-11-06T12:00:00.000Z",
  } as never);
  return retroPromptDefaults(report)[0];
}

describe("AC-STE-722.1 a tripped slow_gate_run offer line names its subject's bound", () => {
  test("AC-.1 slow_gate_run/tripped: rule=slow_gate_run 900001 ms > 900000 ms (gate-check)", () => {
    const rs = results("slow_gate_run/tripped");
    // Control: the fixture trips exactly this rule, on a per-subject threshold.
    expect(rs.filter((r) => r.disposition === "tripped").map((r) => r.id)).toEqual(["slow_gate_run"]);
    expect(typeof rs[0]!.threshold).toBe("object");
    expect(offerLines(rs)).toEqual(["scope=M_a1b2c3", "rule=slow_gate_run 900001 ms > 900000 ms (gate-check)"]);
  }, T);
});

describe("AC-STE-721.2 a tripped slow_gate_run clause names its subject's bound", () => {
  test("AC-.2 slow_gate_run/tripped: slow_gate_run (900001 ms, threshold 900000 ms (gate-check))", () => {
    expect(whatHappened(results("slow_gate_run/tripped"))).toBe(
      "1 retro rule(s) tripped: slow_gate_run (900001 ms, threshold 900000 ms (gate-check))",
    );
  });
});

describe("AC-STE-722.1 + AC-STE-721.2 no rendered rule line holds `[object`", () => {
  test("every rule's tripped fixture renders a plain-text line in both renderers", () => {
    for (const id of RULE_IDS) {
      const rs = results(`${id}/tripped`);
      // Control: each fixture trips its own rule, so a line is really rendered.
      expect(rs.find((r) => r.id === id)?.disposition, id).toBe("tripped");
      const lines = offerLines(rs).filter((l) => l.startsWith("rule="));
      expect(lines.some((l) => l.startsWith(`rule=${id} `)), id).toBe(true);
      for (const l of lines) expect(l, id).not.toContain("[object");
      const said = whatHappened(rs);
      expect(said, id).toContain(`${id} (`);
      expect(said, id).not.toContain("[object");
    }
  }, T);

  test("both renderers format the threshold through one shared formatter", () => {
    const src = (f: string): string => readFileSync(join(SRC, f), "utf-8");
    for (const f of ["retro_offer.ts", "report_issue_retro.ts"]) {
      expect(src(f), f).toMatch(/import\s*\{[^}]*\bformatRetroThreshold\b[^}]*\}\s*from\s*["']\.\/retro_rules["']/);
      expect(src(f), f).not.toMatch(/\$\{r\.threshold\}/);
    }
  });
});
