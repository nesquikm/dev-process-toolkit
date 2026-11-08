// STE-722 (M_d1b4b7) — the `retro: on` trailing switch line, and the modelled
// close-outs that take their reached offers from real stdout.
//
// AC-STE-722.14  gate_capture.ts / deliver_decision.ts stdout: byte-identical
//                to v3.0.0 with the retro switch absent or false (upgrade
//                switch off and on); `retro: on` as the last line with only the
//                retro switch on; `retro: on` then `upgrade_offer: on` with
//                both; neither on a both-homes tree. upgrade_offer.ts stdout
//                byte-identical to v3.0.0 on every STE-712 fixture, retro key
//                or not, and a source scan finds no retro read in it.
// AC-STE-722.6   modelRun cases whose `reachedOffers` come from real stdout.
// AC-STE-722.10  live mutants of deliver_decision.ts and upgrade_offer.ts.
//
// The v3.0.0 literals live in tests/_m_d1b4b7_ste722_fixture.ts (measured on
// the v3.0.0 merge commit 9dab5086). All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { DRIVEN_MARKER } from "../adapters/_shared/src/driven_run_signal";
import { modelRun, stepExecutionCounts } from "../adapters/_shared/src/continuation_offer";
import { SettingsShapeError, loadProjectSection } from "../adapters/_shared/src/project_settings";
import {
  DELIVER_DECISION_V300,
  DELIVER_RETRO,
  FR_ID,
  GATE_CAPTURE_V300,
  IMPLEMENT_RETRO,
  LEGACY_ORCH_CLAUDE_MD,
  MILESTONE,
  RETRO_ON,
  UPGRADE_OFFER,
  UPGRADE_ON,
  cleanupTemps,
  copyPluginTree,
  describeRun,
  offerTree,
  read,
  runDeliverDecision,
  runGateCapture,
  runRetroOffer,
  runUpgradeOffer,
  settingsYaml,
  tempDir,
  trailingSwitchLines,
  writeTree,
  type Tri,
} from "./_m_d1b4b7_ste722_fixture";

afterAll(cleanupTemps);

const T = 120_000;

// ===========================================================================
// AC-STE-722.14 — gate_capture.ts and deliver_decision.ts
// ===========================================================================

type Shape = { retro: Tri; upgrade: Tri };
const OFF_SHAPES: readonly Shape[] = [
  { retro: "absent", upgrade: "absent" },
  { retro: "absent", upgrade: "false" },
  { retro: "false", upgrade: "absent" },
  { retro: "false", upgrade: "false" },
];
const UPGRADE_ONLY_SHAPES: readonly Shape[] = [
  { retro: "absent", upgrade: "true" },
  { retro: "false", upgrade: "true" },
];
const label = (s: Shape): string => `retro ${s.retro}, upgrade ${s.upgrade}`;

for (const [call, run, v300] of [
  ["gate_capture.ts", runGateCapture, GATE_CAPTURE_V300],
  ["deliver_decision.ts", runDeliverDecision, DELIVER_DECISION_V300],
] as const) {
  describe(`AC-STE-722.14 ${call} switch lines`, () => {
    test(`AC-.14 ${call} with no settings file prints its v3.0.0 bytes`, () => {
      const r = run(offerTree(`${call}-nosettings`, null));
      expect(r.stdout, describeRun(r)).toBe(v300);
    }, T);

    for (const s of OFF_SHAPES) {
      test(`AC-.14 ${call} ${label(s)} prints its v3.0.0 bytes`, () => {
        const r = run(offerTree(`${call}-${s.retro}-${s.upgrade}`, settingsYaml(s)));
        expect(r.stdout, describeRun(r)).toBe(v300);
        expect(trailingSwitchLines(r.stdout)).toEqual([]);
      }, T);
    }

    for (const s of UPGRADE_ONLY_SHAPES) {
      test(`AC-.14 ${call} ${label(s)} prints its v3.0.0 bytes ending in the one upgrade_offer: on line`, () => {
        const r = run(offerTree(`${call}-${s.retro}-${s.upgrade}`, settingsYaml(s)));
        expect(r.stdout, describeRun(r)).toBe(`${v300}${UPGRADE_ON}\n`);
        expect(trailingSwitchLines(r.stdout)).toEqual([UPGRADE_ON]);
      }, T);
    }

    test(`AC-.14 ${call} retro true, upgrade off adds exactly one last line, retro: on`, () => {
      for (const upgrade of ["absent", "false"] as const) {
        const r = run(offerTree(`${call}-retro-only-${upgrade}`, settingsYaml({ retro: "true", upgrade })));
        expect(r.stdout, describeRun(r)).toBe(`${v300}${RETRO_ON}\n`);
      }
    }, T);

    test(`AC-.14 ${call} both switches on ends retro: on then upgrade_offer: on`, () => {
      const r = run(offerTree(`${call}-both`, settingsYaml({ retro: "true", upgrade: "true" })));
      expect(r.stdout, describeRun(r)).toBe(`${v300}${RETRO_ON}\n${UPGRADE_ON}\n`);
      const lines = r.stdout.replace(/\n$/, "").split("\n");
      expect(lines[lines.length - 1]).toBe(UPGRADE_ON);
      expect(trailingSwitchLines(r.stdout)).toEqual([RETRO_ON, UPGRADE_ON]);
    }, T);

    test(`AC-.14 ${call} a both-homes tree prints neither switch line`, () => {
      const root = offerTree(`${call}-bothhomes`, settingsYaml({ retro: "true", upgrade: "true" }), { claudeMd: LEGACY_ORCH_CLAUDE_MD });
      expect(() => loadProjectSection(root, "retro" as never)).toThrow(SettingsShapeError);
      const r = run(root);
      expect(r.stdout.split("\n")).not.toContain(RETRO_ON);
      expect(r.stdout.split("\n")).not.toContain(UPGRADE_ON);
      if (call === "gate_capture.ts") expect(r.stdout, describeRun(r)).toBe(v300);
    }, T);

    test(`AC-.14 ${call} a malformed retro section reads off (no retro: on line)`, () => {
      const r = run(offerTree(`${call}-badretro`, `${settingsYaml({})}retro: true\n`));
      expect(r.stdout.split("\n")).not.toContain(RETRO_ON);
    }, T);
  });
}

// ===========================================================================
// AC-STE-722.14 — upgrade_offer.ts untouched
// ===========================================================================

const MONOLITH = [
  "# Requirements",
  "",
  "### FR-1: First thing",
  "",
  "- AC-1.1: it works",
  "",
  "### FR-2: Second thing",
  "",
  "- AC-2.1: it also works",
  "",
].join("\n");
const SETUP_MARKER_MD = "<!-- generated by /dev-process-toolkit:setup -->\n# Synthetic\n";
const STE712_HEAD = 'schema_version: 1\nmin_dpt_version: "2.0.0"\n';
const STE712_ON = "close_out:\n  upgrade_offer:\n    enabled: true\n";

/** upgrade_offer.ts stdout on the stale STE-712 fixture with the switch on, v3.0.0. */
const UPGRADE_STALE_V300 =
  "monolith-split (1.16.0): specs/requirements.md carries 2 live FR-heading section(s) (FR-1, FR-2) — the monolithic layout retired in v1.16.0; specs/frs/ is absent — no FR has been split out into a per-FR file yet; no flat specs/plan.md — the sections' AC bullets carry no plan-side checkbox state to reconcile\n" +
  "Apply the pending toolkit upgrades now? [y/N]\n";

const STE712_FIXTURES: readonly { name: string; settings: string; stale: boolean; v300: string }[] = [
  { name: "switch on, current tree", settings: STE712_HEAD + STE712_ON, stale: false, v300: "" },
  { name: "switch on, stale tree", settings: STE712_HEAD + STE712_ON, stale: true, v300: UPGRADE_STALE_V300 },
  { name: "switch absent, stale tree", settings: STE712_HEAD, stale: true, v300: "" },
];

describe("AC-STE-722.14 upgrade_offer.ts stdout equals v3.0.0", () => {
  for (const f of STE712_FIXTURES) {
    for (const retro of ["absent", "false", "true"] as const) {
      test(`AC-.14 upgrade_offer.ts on the STE-712 fixture "${f.name}" with retro ${retro} prints its v3.0.0 bytes`, () => {
        const root = writeTree(tempDir("up712"), {
          "CLAUDE.md": SETUP_MARKER_MD,
          "specs/settings.yaml": f.settings + (retro === "absent" ? "" : `retro:\n  enabled: ${retro}\n`),
          ...(f.stale ? { "specs/requirements.md": MONOLITH } : {}),
        });
        const r = runUpgradeOffer(root);
        expect(r.code, describeRun(r)).toBe(0);
        expect(r.stdout).toBe(f.v300);
      }, T);
    }
  }

  test("AC-.14 upgrade_offer.ts source carries no retro read", () => {
    expect(read(UPGRADE_OFFER)).not.toMatch(/retro/i);
  });
});

// ===========================================================================
// AC-STE-722.10 — live mutants
// ===========================================================================

describe("AC-STE-722.10 live mutants of the switch line", () => {
  test("AC-.10 MUTANT — a retro import planted in upgrade_offer.ts is found by the scan", () => {
    const mutated = `import { retroSwitchOn } from "./project_settings";\n${read(UPGRADE_OFFER)}`;
    expect(/retro/i.test(mutated)).toBe(true);
  });

  const deliverSrc = (): string => read(join(import.meta.dir, "..", "adapters", "_shared", "src", "deliver_decision.ts"));

  test("AC-.10 MUTANT — deliver_decision.ts printing retro: on unconditionally reds the switch-off byte row", () => {
    const src = deliverSrc();
    expect(src).toContain("retroSwitchOn(projectRoot)");
    const plugin = copyPluginTree("mut-dd-off");
    const copy = join(plugin, "adapters", "_shared", "src", "deliver_decision.ts");
    writeFileSync(copy, src.split("retroSwitchOn(projectRoot)").join("true"));
    const root = offerTree("mut-dd-off-tree", settingsYaml({ retro: "false", upgrade: "false" }));
    expect(runDeliverDecision(root).stdout).toBe(DELIVER_DECISION_V300);
    expect(runDeliverDecision(root, copy).stdout).not.toBe(DELIVER_DECISION_V300);
  }, T);

  test("AC-.10 MUTANT — deliver_decision.ts with the two switch lines swapped reds the both-on row", () => {
    const lines = deliverSrc().split("\n");
    const retroAt = lines.findIndex((l) => l.includes(`"${RETRO_ON}"`));
    const upgradeAt = lines.findIndex((l) => l.includes(`"${UPGRADE_ON}"`));
    expect(retroAt).toBeGreaterThanOrEqual(0);
    expect(upgradeAt).toBeGreaterThan(retroAt);
    const swapped = [...lines];
    swapped[retroAt] = lines[upgradeAt]!;
    swapped[upgradeAt] = lines[retroAt]!;
    const plugin = copyPluginTree("mut-dd-swap");
    const copy = join(plugin, "adapters", "_shared", "src", "deliver_decision.ts");
    writeFileSync(copy, swapped.join("\n"));
    const root = offerTree("mut-dd-swap-tree", settingsYaml({ retro: "true", upgrade: "true" }));
    expect(runDeliverDecision(root).stdout).toBe(`${DELIVER_DECISION_V300}${RETRO_ON}\n${UPGRADE_ON}\n`);
    expect(runDeliverDecision(root, copy).stdout).not.toBe(`${DELIVER_DECISION_V300}${RETRO_ON}\n${UPGRADE_ON}\n`);
  }, T);
});

// ===========================================================================
// AC-STE-722.6 — modelled runs, offers reached from real stdout
// ===========================================================================

const PLAIN_BODY = `/dev-process-toolkit:implement ${FR_ID}\n\nBuild the FR on this branch, then stop.`;
const DRIVEN_BODY = `${DRIVEN_MARKER}\n${PLAIN_BODY}`;
const DELIVER_BODY = `/dev-process-toolkit:deliver ${MILESTONE}`;

/** /implement: step 14's gate_capture.ts stdout, then retro_offer.ts only behind `retro: on`. */
function implementReached(root: string, calls: string[]): string[] {
  const gate = runGateCapture(root);
  if (!trailingSwitchLines(gate.stdout).includes(RETRO_ON)) return [];
  calls.push("retro_offer.ts");
  return runRetroOffer(root, FR_ID).stdout === "" ? [] : [IMPLEMENT_RETRO];
}

/** /deliver: the decision command's stdout, then retro_offer.ts once per delivered milestone behind `retro: on`. */
function deliverReached(root: string, calls: string[]): string[] {
  const decision = runDeliverDecision(root);
  if (!trailingSwitchLines(decision.stdout).includes(RETRO_ON)) return [];
  const printed = [MILESTONE].filter((m) => {
    calls.push("retro_offer.ts");
    return runRetroOffer(root, m).stdout !== "";
  });
  return printed.length > 0 ? [DELIVER_RETRO] : [];
}

describe("AC-STE-722.6 modelled close-outs", () => {
  test("AC-.6 retro switch off: neither retro offer is reached and no turn is recorded", () => {
    const root = offerTree("model-off", settingsYaml({ retro: "false", tokenStats: true }), { ledger: "tripped" });
    const calls: string[] = [];
    const impl = implementReached(root, calls);
    const del = deliverReached(root, calls);
    expect(impl).toEqual([]);
    expect(del).toEqual([]);
    expect(calls).toEqual([]);
    const a = modelRun({ chain: [{ skill: "/implement", target: FR_ID }], promptBody: PLAIN_BODY, reachedOffers: impl });
    const b = modelRun({ chain: [{ skill: "/deliver", target: MILESTONE }], promptBody: DELIVER_BODY, reachedOffers: del });
    expect([...a.operatorTurns, ...b.operatorTurns]).toEqual([]);
    expect(stepExecutionCounts(a)["/retro"] ?? 0).toBe(0);
    expect(stepExecutionCounts(b)["/retro"] ?? 0).toBe(0);
  }, 2 * T);

  test("AC-.6 switch on, one tripped rule: a driven /implement reaching implement_retro_offer records no turn and runs no /retro", () => {
    const root = offerTree("model-driven", settingsYaml({ retro: "true", tokenStats: true }), { ledger: "tripped" });
    const reached = implementReached(root, []);
    expect(reached).toEqual([IMPLEMENT_RETRO]);
    const run = modelRun({ chain: [{ skill: "/implement", target: FR_ID }], promptBody: DRIVEN_BODY, reachedOffers: reached });
    expect(run.operatorTurns).toEqual([]);
    expect(stepExecutionCounts(run)["/retro"] ?? 0).toBe(0);
    // Positive companion: the same reached offer, standalone, asks once and runs /retro once.
    const standalone = modelRun({ chain: [{ skill: "/implement", target: FR_ID }], promptBody: PLAIN_BODY, reachedOffers: reached });
    expect(standalone.operatorTurns).toEqual([IMPLEMENT_RETRO]);
    expect(stepExecutionCounts(standalone)["/retro"]).toBe(1);
  }, 2 * T);

  test("AC-.6 switch on, one tripped rule: a standalone /deliver reaching deliver_close_retro_offer records exactly one turn for it", () => {
    const root = offerTree("model-deliver", settingsYaml({ retro: "true", tokenStats: true }), { ledger: "tripped" });
    const reached = deliverReached(root, []);
    expect(reached).toEqual([DELIVER_RETRO]);
    const run = modelRun({ chain: [{ skill: "/deliver", target: MILESTONE }], promptBody: DELIVER_BODY, reachedOffers: reached });
    expect(run.operatorTurns).toEqual([DELIVER_RETRO]);
    expect(stepExecutionCounts(run)["/retro"]).toBe(1);
  }, 2 * T);

  test("AC-.6 a /deliver run whose /implement stages are driven never records implement_retro_offer", () => {
    const root = offerTree("model-stages", settingsYaml({ retro: "true", tokenStats: true }), { ledger: "tripped" });
    const outer = modelRun({ chain: [{ skill: "/deliver", target: MILESTONE }], promptBody: DELIVER_BODY, reachedOffers: deliverReached(root, []) });
    const stage = modelRun({ chain: [{ skill: "/implement", target: MILESTONE }], promptBody: DRIVEN_BODY, reachedOffers: implementReached(root, []) });
    const turns = [...outer.operatorTurns, ...stage.operatorTurns];
    expect(turns).not.toContain(IMPLEMENT_RETRO);
    expect(turns).toEqual([DELIVER_RETRO]);
  }, 2 * T);
});
