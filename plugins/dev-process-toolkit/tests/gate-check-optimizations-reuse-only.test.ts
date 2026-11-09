// STE-723 (M_fd9a03) — /gate-check probe `optimizations_reuse_only`.
//
// AC-STE-723.4: a clean fixture passes; one negative fixture per reason, each
// asserting its `specs/settings.yaml:<line> — <reason>` note and error
// severity (the unknown-knob and never-reusable fixtures included although
// the loader refuses their section); vacuous with zero violations and zero
// notes on an unmanaged tree, a foreign settings file, a sectionless file and
// an unparseable file. Flow-style rows decide the shape from the parsed value
// (`settingsSectionValue`), and a control shows the raw-lines shape alone
// would call the passing flow fixture `not-a-mapping`.
//
// AC-STE-723.12's probe half lives in tests/m_fd9a03-ste-723-optimizations-config.test.ts.
// All ids and paths are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTemps, SETTINGS_HEAD, SETUP_MD, SRC, tempDir } from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const MOD_PATH = join(SRC, "optimizations_config.ts");
const SETTINGS_MOD = join(SRC, "project_settings.ts");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMod = any;

async function O(): Promise<AnyMod> {
  if (!existsSync(MOD_PATH)) throw new Error(`optimizations_config.ts is absent: ${MOD_PATH}`);
  return await import(MOD_PATH);
}
async function S(): Promise<AnyMod> {
  return await import(SETTINGS_MOD);
}

function tree(label: string, settings: string | null, claudeMd: string | null = SETUP_MD): string {
  const root = join(tempDir(`ste723-probe-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  if (claudeMd !== null) writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
  }
  return root;
}

async function probe(root: string): Promise<{ violations: AnyMod[]; notes?: unknown[] }> {
  return await (await O()).runOptimizationsReuseOnlyProbe(root);
}

/** Lines 1-2 are SETTINGS_HEAD; TRACK_ON is lines 3-5, so a section after it opens on line 6. */
const TRACK_ON = "tracking:\n  gate_outcomes:\n    enabled: true\n";
const ON = SETTINGS_HEAD + TRACK_ON;

async function expectVacuous(root: string): Promise<void> {
  const r = await probe(root);
  expect(r.violations).toEqual([]);
  expect(r.notes ?? []).toEqual([]);
}

async function expectOne(root: string, line: number, reason: string): Promise<void> {
  const r = await probe(root);
  expect(r.violations.map((v) => ({ reason: v.reason, note: v.note, severity: v.severity }))).toEqual([
    { reason, note: `specs/settings.yaml:${line} — ${reason}`, severity: "error" },
  ]);
  expect(r.violations[0].message).toMatch(/Refusing: .+\nRemedy: .+\nContext: .+/);
}

describe("AC-STE-723.4 optimizations_reuse_only — block style", () => {
  test("clean: gate_commands: reuse with tracking.gate_outcomes on passes", async () => {
    const r = await probe(tree("clean", `${ON}optimizations:\n  gate_commands: reuse\n`));
    expect(r.violations).toEqual([]);
  });
  test("clean: gate_commands: run with no tracking key passes", async () => {
    const r = await probe(tree("clean-run", `${SETTINGS_HEAD}optimizations:\n  gate_commands: run\n`));
    expect(r.violations).toEqual([]);
  });

  test("unknown-knob: cites the knob's own line although the loader refuses the section", async () => {
    const root = tree("unknown-knob", `${ON}optimizations:\n  gate_commands: run\n  nope: reuse\n`);
    const s = await S();
    expect(() => s.loadProjectSection(root, "optimizations")).toThrow();
    await expectOne(root, 8, "unknown-knob");
  });
  test("never-reusable: cites the knob's own line although the loader refuses the section", async () => {
    const root = tree("never", `${ON}optimizations:\n  gate_commands: run\n  code_review: reuse\n`);
    const s = await S();
    expect(() => s.loadProjectSection(root, "optimizations")).toThrow();
    await expectOne(root, 8, "never-reusable");
  });
  test("unknown-value: gate_commands: skip cites its line", async () => {
    await expectOne(tree("value", `${ON}optimizations:\n  gate_commands: skip\n`), 7, "unknown-value");
  });
  test("requires-gate-outcomes: reuse with tracking.gate_outcomes false cites the knob line", async () => {
    await expectOne(tree("requires", `${SETTINGS_HEAD}tracking:\n  gate_outcomes:\n    enabled: false\noptimizations:\n  gate_commands: reuse\n`), 7, "requires-gate-outcomes");
  });
  test("requires-gate-outcomes: reuse with no tracking key", async () => {
    await expectOne(tree("requires-absent", `${SETTINGS_HEAD}optimizations:\n  gate_commands: reuse\n`), 4, "requires-gate-outcomes");
  });
  test("not-a-mapping: a list section cites the section line", async () => {
    await expectOne(tree("list", `${ON}optimizations:\n  - gate_commands\n`), 6, "not-a-mapping");
  });
});

describe("AC-STE-723.4 optimizations_reuse_only — flow style and scalars", () => {
  test("optimizations: { gate_commands: reuse } with outcomes on passes, and readOptimizations reads reuse", async () => {
    const root = tree("flow-pass", `${ON}optimizations: { gate_commands: reuse }\n`);
    expect((await probe(root)).violations).toEqual([]);
    expect((await O()).readOptimizations(root)).toEqual({ gate_commands: "reuse" });
  });
  test("optimizations: { gate_commands: skip } reports unknown-value at the section line", async () => {
    await expectOne(tree("flow-skip", `${ON}optimizations: { gate_commands: skip }\n`), 6, "unknown-value");
  });
  test("optimizations: { review: reuse } reports never-reusable at the section line", async () => {
    await expectOne(tree("flow-review", `${ON}optimizations: { review: reuse }\n`), 6, "never-reusable");
  });
  test("optimizations: {} passes with zero violations", async () => {
    expect((await probe(tree("flow-empty", `${ON}optimizations: {}\n`))).violations).toEqual([]);
  });
  test("a bare optimizations: line reports not-a-mapping", async () => {
    await expectOne(tree("bare", `${ON}optimizations:\n`), 6, "not-a-mapping");
  });
  test("optimizations: reuse reports not-a-mapping", async () => {
    await expectOne(tree("scalar", `${ON}optimizations: reuse\n`), 6, "not-a-mapping");
  });

  test("control: the raw-lines shape alone (settingsSectionKeys) calls the passing flow fixture not-a-mapping", async () => {
    const s = await S();
    const root = tree("flow-control", `${ON}optimizations: { gate_commands: reuse }\n`);
    const keys = s.settingsSectionKeys(root, "optimizations");
    const rawLinesShape = keys !== null && keys.length === 0 ? "not-a-mapping" : null;
    expect(rawLinesShape).toBe("not-a-mapping");
    expect(s.settingsSectionValue(root, "optimizations")).toEqual({ value: { gate_commands: "reuse" } });
    expect((await probe(root)).violations).toEqual([]);
  });
});

describe("AC-STE-723.4 settingsSectionValue never throws and validates nothing", () => {
  test("returns { value } for block, flow and bare sections; null for an absent or unparseable file", async () => {
    const s = await S();
    expect(s.settingsSectionValue(tree("v-block", `${ON}optimizations:\n  nope: reuse\n`), "optimizations")).toEqual({ value: { nope: "reuse" } });
    expect(s.settingsSectionValue(tree("v-flow", `${ON}optimizations: {}\n`), "optimizations")).toEqual({ value: {} });
    expect(s.settingsSectionValue(tree("v-bare", `${ON}optimizations:\n`), "optimizations")).toEqual({ value: null });
    expect(s.settingsSectionValue(tree("v-absent", null), "optimizations")).toBeNull();
    expect(s.settingsSectionValue(tree("v-bad", `${SETTINGS_HEAD}optimizations: [\n`), "optimizations")).toBeNull();
  });
});

describe("AC-STE-723.4 optimizations_reuse_only — vacuous", () => {
  test("an unmanaged tree (no CLAUDE.md, a foreign settings file holding a bad section): zero violations, zero notes", async () => {
    await expectVacuous(tree("unmanaged", "schema_version: 1\noptimizations:\n  nope: reuse\n", null));
  });
  test("an unmanaged tree with nothing at all", async () => {
    await expectVacuous(tree("empty", null, null));
  });
  test("a foreign settings file on a managed tree", async () => {
    const root = tree("foreign", "schema_version: 1\noptimizations:\n  code_review: reuse\n");
    expect((await S()).isForeignSettingsFile(root)).toBe(true);
    await expectVacuous(root);
  });
  test("a toolkit settings file with no optimizations section", async () => {
    await expectVacuous(tree("no-section", ON));
  });
  test("a managed tree with no settings file", async () => {
    await expectVacuous(tree("no-file", null));
  });
  test("a settings file that does not parse", async () => {
    await expectVacuous(tree("unparseable", `${SETTINGS_HEAD}optimizations: [\n`));
  });
  test("control: the same managed tree with a bad section is not vacuous", async () => {
    expect((await probe(tree("not-vacuous", `${ON}optimizations:\n  nope: reuse\n`))).violations.length).toBe(1);
  });
});
