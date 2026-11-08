// STE-719 (M_d1b4b7) AC.4 + AC.5 — the v1 rule table and the closed source set.
//
// AC.4 pins every value of the Requirement's v1 rule table: id, source,
// threshold value, unit and comparator. AC.5 grades that every rule reads
// only a parent-visible source, and that a test-registered rule naming any
// other source makes `evaluateRetroRules` throw BEFORE any evaluator runs.

import { describe, expect, test } from "bun:test";

import { gateSubject } from "../adapters/_shared/src/gate_receipt";
import { RULE_IDS, inputs, rulesMod, session, timeline } from "./_m_d1b4b7_retro_fixture";

describe("AC-STE-719.4 RETRO_RULES holds exactly the four v1 rules, every value pinned", () => {
  test("the rule ids are exactly the four v1 ids, in table order", async () => {
    const { RETRO_RULES } = await rulesMod();
    expect(RETRO_RULES.map((r: any) => r.id)).toEqual([...RULE_IDS]);
  });

  test("slow_gate_run: timeline, per-subject ms bounds (gate-check 900000, spec-review 1200000, tdd 3600000), strict >", async () => {
    const { RETRO_RULES } = await rulesMod();
    const r = RETRO_RULES.find((x: any) => x.id === "slow_gate_run");
    expect(r.source).toEqual(["timeline"]);
    expect(r.threshold).toEqual({
      value: {
        [gateSubject("gate-check")]: 900000,
        [gateSubject("spec-review")]: 1200000,
        [gateSubject("tdd")]: 3600000,
      },
      unit: "ms",
      comparator: ">",
    });
  });

  test("gate_rerun_unchanged_key: timeline, 1 rerun, inclusive >=", async () => {
    const { RETRO_RULES } = await rulesMod();
    const r = RETRO_RULES.find((x: any) => x.id === "gate_rerun_unchanged_key");
    expect(r.source).toEqual(["timeline"]);
    expect(r.threshold).toEqual({ value: 1, unit: "runs", comparator: ">=" });
  });

  test("zero_yield_round: timeline, 2 rounds, inclusive >=", async () => {
    const { RETRO_RULES } = await rulesMod();
    const r = RETRO_RULES.find((x: any) => x.id === "zero_yield_round");
    expect(r.source).toEqual(["timeline"]);
    expect(r.threshold).toEqual({ value: 2, unit: "rounds", comparator: ">=" });
  });

  test("cost_per_changed_line: token_ledger + capture_ledger, 500 tokens per line, strict >", async () => {
    const { RETRO_RULES } = await rulesMod();
    const r = RETRO_RULES.find((x: any) => x.id === "cost_per_changed_line");
    expect(r.source).toEqual(["token_ledger", "capture_ledger"]);
    expect(r.threshold).toEqual({ value: 500, unit: "tokens/line", comparator: ">" });
  });

  test("every rule carries an evaluator function", async () => {
    const { RETRO_RULES } = await rulesMod();
    for (const r of RETRO_RULES) expect({ id: r.id, evaluate: typeof r.evaluate }).toEqual({ id: r.id, evaluate: "function" });
  });

  test("RETRO_DISPOSITIONS is exactly tripped, clear and the one skip literal", async () => {
    const { RETRO_DISPOSITIONS } = await rulesMod();
    expect([...RETRO_DISPOSITIONS]).toEqual(["tripped", "clear", "skipped: input not observable"]);
  });
});

describe("AC-STE-719.5 every rule reads only a parent-visible source", () => {
  test("PARENT_VISIBLE_SOURCES is exactly timeline, capture_ledger, token_ledger", async () => {
    const { PARENT_VISIBLE_SOURCES } = await rulesMod();
    expect([...PARENT_VISIBLE_SOURCES].sort()).toEqual(["capture_ledger", "timeline", "token_ledger"]);
  });

  test("every RETRO_RULES source is a member of PARENT_VISIBLE_SOURCES", async () => {
    const { RETRO_RULES, PARENT_VISIBLE_SOURCES } = await rulesMod();
    for (const r of RETRO_RULES) {
      expect(r.source.length).toBeGreaterThan(0);
      for (const s of r.source) expect({ rule: r.id, source: s, member: PARENT_VISIBLE_SOURCES.includes(s) }).toEqual({ rule: r.id, source: s, member: true });
    }
  });

  test("a test-registered rule naming a fork-internal source makes evaluateRetroRules throw before any evaluator runs", async () => {
    const { RETRO_RULES, evaluateRetroRules } = await rulesMod();
    let called = 0;
    const spy = (r: any) => ({ ...r, evaluate: (...a: unknown[]) => (called++, r.evaluate(...a)) });
    const rogue = {
      id: "fork_internal_probe",
      source: ["timeline", "fork_transcript"],
      threshold: { value: 1, unit: "count", comparator: ">=" },
      evaluate: () => {
        called++;
        return { observable: true, value: 99 };
      },
    };
    // The rogue rule sits LAST, so a check made per rule while evaluating would
    // already have run the four legitimate evaluators.
    const rules = [...RETRO_RULES.map(spy), rogue];
    const input = inputs({ sessions: [session(1, timeline())] });
    expect(() => evaluateRetroRules(input, rules)).toThrow(/fork_transcript/);
    expect(called).toBe(0);
  });

  test("the same rogue rule with only parent-visible sources evaluates (the throw is about the source, nothing else)", async () => {
    const { evaluateRetroRules } = await rulesMod();
    const ok = {
      id: "parent_visible_probe",
      source: ["timeline"],
      threshold: { value: 1, unit: "count", comparator: ">=" },
      evaluate: () => ({ observable: true, value: 5 }),
    };
    const out = evaluateRetroRules(inputs({ sessions: [session(1, timeline())] }), [ok]);
    expect(out.map((r: any) => [r.id, r.disposition, r.value])).toEqual([["parent_visible_probe", "tripped", 5]]);
  });
});
