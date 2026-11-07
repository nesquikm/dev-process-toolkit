// STE-719 (M_d1b4b7) AC.16 — mutation controls.
//
// Four named mutations must each turn at least one named test red:
//   M1 removing the PARENT_VISIBLE_SOURCES check
//        -> retro-rules "a test-registered rule naming a fork-internal source
//           makes evaluateRetroRules throw before any evaluator runs" (and the
//           control below);
//   M2 mapping a non-observable input to `clear`
//        -> the pure-engine controls below, and every retro-fixtures
//           "<rule>/skipped yields no clear" test;
//   M3 dropping the `key_stable: true` filter
//        -> retro-fixtures "clear: the repeated key is key_stable false ..."
//           and the inline control below;
//   M4 making retro.ts refuse when retro.enabled is off
//        -> graded here on a TEMP COPY of the plugin's adapters with the
//           refusal injected before the `if (import.meta.main)` guard: the
//           AC.2 predicate (exit 0, no refusal, one report) holds on the
//           unmutated copy and fails on the mutant.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  KEY_A,
  PLUGIN_ROOT,
  SKIPPED,
  cleanupTemps,
  gateRun,
  inputs,
  makeConfigDir,
  makeRetroTree,
  reportFiles,
  resultFor,
  rulesMod,
  runRetro,
  session,
  sid,
  tempDir,
  timeline,
  type RetroSetting,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

describe("AC-STE-719.16 M1 — the source check runs before evaluation", () => {
  test("a rule whose only source is outside PARENT_VISIBLE_SOURCES throws, and its evaluator never runs", async () => {
    const { evaluateRetroRules } = await rulesMod();
    let ran = false;
    const rogue = {
      id: "rogue",
      source: ["subagent_transcript"],
      threshold: { value: 1, unit: "count", comparator: ">=" },
      evaluate: () => {
        ran = true;
        return { observable: true, value: 1 };
      },
    };
    expect(() => evaluateRetroRules(inputs({ sessions: [session(1, timeline())] }), [rogue])).toThrow();
    expect(ran).toBe(false);
  });
});

describe("AC-STE-719.16 M2 — a non-observable input never maps to clear", () => {
  for (const value of [null, 0]) {
    test(`a rule returning { observable: false, value: ${value} } is skipped with its reason, never clear`, async () => {
      const { evaluateRetroRules } = await rulesMod();
      const blind = {
        id: "blind",
        source: ["timeline"],
        threshold: { value: 1, unit: "count", comparator: ">=" },
        evaluate: () => ({ observable: false, value, reason: "no timeline file" }),
      };
      const [r] = evaluateRetroRules(inputs({ sessions: [session(1, null)] }), [blind]);
      expect(r.disposition).toBe(SKIPPED);
      expect(r.reason).toContain("no timeline file");
    });
  }

  test("an observable value below the threshold is clear (the control: clear is reachable)", async () => {
    const { evaluateRetroRules } = await rulesMod();
    const seen = {
      id: "seen",
      source: ["timeline"],
      threshold: { value: 1, unit: "count", comparator: ">=" },
      evaluate: () => ({ observable: true, value: 0 }),
    };
    const [r] = evaluateRetroRules(inputs({ sessions: [session(1, timeline())] }), [seen]);
    expect(r.disposition).toBe("clear");
  });
});

describe("AC-STE-719.16 M3 — only key_stable: true runs count as reruns", () => {
  test("two pass runs of one subject and key, one key_stable false: clear, sum 0", async () => {
    const { evaluateRetroRules } = await rulesMod();
    const runs = [gateRun(10, { key_digest: KEY_A, key_stable: true }), gateRun(10, { key_digest: KEY_A, key_stable: false })];
    const r = resultFor(evaluateRetroRules(inputs({ sessions: [session(1, timeline({ gate_runs: runs }))] })), "gate_rerun_unchanged_key");
    expect([r.disposition, r.value]).toEqual(["clear", 0]);
  });

  test("control: the same two runs both key_stable true trip, sum 1", async () => {
    const { evaluateRetroRules } = await rulesMod();
    const runs = [gateRun(10, { key_digest: KEY_A, key_stable: true }), gateRun(10, { key_digest: KEY_A, key_stable: true })];
    const r = resultFor(evaluateRetroRules(inputs({ sessions: [session(1, timeline({ gate_runs: runs }))] })), "gate_rerun_unchanged_key");
    expect([r.disposition, r.value]).toEqual(["tripped", 1]);
  });
});

// ------------------------------------------------------------------- M4

const REFUSAL = [
  'if (import.meta.main && !(await import("./project_settings")).retroSwitchOn(process.argv[2]!)) {',
  '  process.stderr.write("retro is off\\nRemedy: set retro.enabled: true\\nContext: mode=none, ticket=unbound, skill=retro\\n");',
  "  process.exit(1);",
  "}",
].join("\n");

/** A temp copy of the plugin's adapters + manifest; `mutate` injects the M4 refusal into retro.ts. */
function pluginCopy(label: string, mutate: boolean): string {
  const root = join(tempDir(label), "plugin");
  cpSync(join(PLUGIN_ROOT, "adapters"), join(root, "adapters"), { recursive: true });
  cpSync(join(PLUGIN_ROOT, ".claude-plugin"), join(root, ".claude-plugin"), { recursive: true });
  const door = join(root, "adapters", "_shared", "src", "retro.ts");
  if (mutate) {
    const text = readFileSync(door, "utf-8");
    const at = text.search(/^if \(import\.meta\.main\)/m);
    if (at < 0) throw new Error("retro.ts has no `if (import.meta.main)` guard to inject before");
    writeFileSync(door, `${text.slice(0, at)}${REFUSAL}\n${text.slice(at)}`);
  }
  return door;
}

function ac2Holds(door: string, setting: RetroSetting, label: string): boolean {
  const root = makeRetroTree(label, { retro: setting });
  const config = makeConfigDir(`${label}-config`, root, [sid(1)]);
  const r = runRetro(root, [], { CLAUDE_CONFIG_DIR: config }, door);
  return r.status === 0 && !/Remedy:|refus/i.test(`${r.stdout}\n${r.stderr}`) && reportFiles(root).length === 1;
}

describe("AC-STE-719.16 M4 — a front door that refuses on retro.enabled reds AC.2", () => {
  test("control: the unmutated copy satisfies the AC.2 predicate with retro.enabled absent", () => {
    expect(ac2Holds(pluginCopy("m4-control", false), "absent", "m4-control-tree")).toBe(true);
  });

  test("the mutant fails the AC.2 predicate with retro.enabled absent and with false", () => {
    const door = pluginCopy("m4-mutant", true);
    expect(ac2Holds(door, "absent", "m4-mutant-absent")).toBe(false);
    expect(ac2Holds(door, "false", "m4-mutant-false")).toBe(false);
  });

  test("the mutant still passes with retro.enabled true (the mutation is the switch read, nothing else)", () => {
    expect(ac2Holds(pluginCopy("m4-mutant-on", true), "true", "m4-mutant-true")).toBe(true);
  });
});
