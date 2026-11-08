// STE-723 (M_fd9a03) — the settings file names a closed set of reuse knobs.
//
// Module under test: adapters/_shared/src/optimizations_config.ts (new), and
// the loader wiring in adapters/_shared/src/project_settings.ts.
//
//   AC-STE-723.1   readOptimizations and the `knob` verb: run for absent,
//                  sectionless and invalid trees; reuse only with
//                  tracking.gate_outcomes on; the verb refuses other names.
//   AC-STE-723.2   OPTIMIZATION_KNOBS / OPTIMIZATION_VALUES literal lists.
//   AC-STE-723.3   validateOptimizations: one violation per offending key.
//   AC-STE-723.5   an invalid section reads every knob as run.
//   AC-STE-723.6   the module reads no process.env key and no userConfig.
//   AC-STE-723.8   the loader admits `optimizations` as a closed section.
//   AC-STE-723.10  mutation controls (temp copies of the module).
//   AC-STE-723.12  never implied: reuse without tracking.gate_outcomes.
//   AC-STE-723.13  the PROPOSABLE_SETTINGS reuse row and propose.
//   AC-STE-723.15  the archived STE-722 clause and the TOP_KEYS revert.
//
// AC-STE-723.4 (the probe) lives in tests/gate-check-optimizations-reuse-only.test.ts.
// All ids and paths are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { cleanupTemps, PLUGIN_ROOT, REPO_ROOT, SETTINGS_HEAD, SETUP_MD, SRC, tempDir } from "./_m_d1b4b7_retro_fixture";
import {
  approve,
  childEnv,
  makeTree,
  pluginCopy,
  settingsPath,
  skipped,
  GATE_OUTCOMES_REASON,
  TOKEN_STATS_REASON,
  TOOL_CALLS_REASON,
  type Approved,
  printedLines,
  propose,
  rules,
  trackingYaml,
  writeReport,
  OFF,
  type RuleRow,
} from "./_m_d1b4b7_ste728_fixture";

afterAll(cleanupTemps);

const MOD_PATH = join(SRC, "optimizations_config.ts");
const SETTINGS_MOD = join(SRC, "project_settings.ts");
const T = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMod = any;

async function O(): Promise<AnyMod> {
  if (!existsSync(MOD_PATH)) throw new Error(`optimizations_config.ts is absent: ${MOD_PATH}`);
  return await import(MOD_PATH);
}
async function S(): Promise<AnyMod> {
  return await import(SETTINGS_MOD);
}

// ---------------------------------------------------------------- fixtures

const TRACK_ON = "tracking:\n  gate_outcomes:\n    enabled: true\n";
const TRACK_OFF = "tracking:\n  gate_outcomes:\n    enabled: false\n";
const FLOW_REUSE = "optimizations: { gate_commands: reuse }\n";

/** A toolkit-managed tree: the setup CLAUDE.md and, unless null, `specs/settings.yaml` holding `settings`. */
function tree(label: string, settings: string | null): string {
  const root = join(tempDir(`ste723-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
  }
  return root;
}

function knob(root: string, name: string, module = MOD_PATH): { code: number | null; stdout: string; stderr: string } {
  const p = spawnSync(process.execPath, ["run", module, "knob", root, name], { cwd: root, encoding: "utf-8", timeout: 60_000 });
  return { code: p.status, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

function fileList(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(root.length + 1)] = readFileSync(p, "utf-8");
    }
  };
  walk(root);
  return out;
}

const NFR10_RE = /^Refusing: .+\nRemedy: .+\nContext: .+/m;
const reasons = (vs: AnyMod[]): string[] => vs.map((v) => v.reason);

// ---------------------------------------------------------------- AC.1

const READER_ROWS: [string, string | null, "run" | "reuse"][] = [
  ["no settings file", null, "run"],
  ["a settings file with no optimizations section", SETTINGS_HEAD + TRACK_ON, "run"],
  ["an invalid section (a refused knob name)", `${SETTINGS_HEAD}${TRACK_ON}optimizations:\n  code_review: reuse\n`, "run"],
  ["an invalid section (a bad value)", `${SETTINGS_HEAD}${TRACK_ON}optimizations:\n  gate_commands: skip\n`, "run"],
  ["gate_commands: reuse with tracking.gate_outcomes on", SETTINGS_HEAD + TRACK_ON + FLOW_REUSE, "reuse"],
  ["gate_commands: reuse with tracking.gate_outcomes absent", SETTINGS_HEAD + FLOW_REUSE, "run"],
  ["gate_commands: reuse with tracking.gate_outcomes false", SETTINGS_HEAD + TRACK_OFF + FLOW_REUSE, "run"],
];

describe("AC-STE-723.1 readOptimizations and the knob verb", () => {
  for (const [name, settings, want] of READER_ROWS) {
    test(`readOptimizations: ${name} -> ${want}`, async () => {
      const root = tree(`ac1-r-${want}`, settings);
      expect((await O()).readOptimizations(root)).toEqual({ gate_commands: want });
    });
    test(`knob verb: ${name} -> prints ${want}, exit 0`, () => {
      const root = tree(`ac1-v-${want}`, settings);
      const r = knob(root, "gate_commands");
      expect({ code: r.code, lines: printedLines(r.stdout) }).toEqual({ code: 0, lines: [want] });
    }, T);
  }

  for (const bad of ["code_review", "nope"]) {
    test(`knob verb: ${bad} as the knob name exits 1 with empty stdout and an NFR-10 refusal`, () => {
      const root = tree(`ac1-bad-${bad}`, SETTINGS_HEAD + TRACK_ON + FLOW_REUSE);
      const r = knob(root, bad);
      expect({ code: r.code, stdout: r.stdout }).toEqual({ code: 1, stdout: "" });
      expect(r.stderr).toMatch(NFR10_RE);
    }, T);
  }
});

// ---------------------------------------------------------------- AC.2

describe("AC-STE-723.2 the closed knob and value lists", () => {
  test("OPTIMIZATION_KNOBS equals exactly [gate_commands]", async () => {
    const { OPTIMIZATION_KNOBS } = await O();
    expect(Array.isArray(OPTIMIZATION_KNOBS)).toBe(true);
    expect([...OPTIMIZATION_KNOBS]).toEqual(["gate_commands"]);
  });
  test("OPTIMIZATION_VALUES equals exactly [reuse, run]", async () => {
    const { OPTIMIZATION_VALUES } = await O();
    expect(Array.isArray(OPTIMIZATION_VALUES)).toBe(true);
    expect([...OPTIMIZATION_VALUES]).toEqual(["reuse", "run"]);
  });
  test("both are declared `as const` arrays in the module source", () => {
    const src = existsSync(MOD_PATH) ? readFileSync(MOD_PATH, "utf-8") : "";
    expect(src).toMatch(/export const OPTIMIZATION_KNOBS\s*=\s*\[\s*"gate_commands"\s*,?\s*\]\s*as const/);
    expect(src).toMatch(/export const OPTIMIZATION_VALUES\s*=\s*\[\s*"reuse"\s*,\s*"run"\s*,?\s*\]\s*as const/);
  });
});

// ---------------------------------------------------------------- AC.3

const NEVER = ["code_review", "review", "spec_review", "tdd", "probes", "conformance_probes", "tracker_probes", "upgrade_staleness"];

describe("AC-STE-723.3 validateOptimizations: one violation per offending key", () => {
  test("NEVER_REUSABLE_STEPS is exactly the refused-name list", async () => {
    expect([...(await O()).NEVER_REUSABLE_STEPS]).toEqual(NEVER);
  });

  test("a clean section returns no violation: reuse with outcomes on, run with outcomes on and off, and {}", async () => {
    const { validateOptimizations } = await O();
    expect(validateOptimizations({ gate_commands: "reuse" }, true)).toEqual([]);
    expect(validateOptimizations({ gate_commands: "run" }, true)).toEqual([]);
    expect(validateOptimizations({ gate_commands: "run" }, false)).toEqual([]);
    expect(validateOptimizations({}, false)).toEqual([]);
  });

  test("unknown-knob for a name outside both lists, naming the key", async () => {
    const v = (await O()).validateOptimizations({ nope: "reuse" }, true);
    expect(reasons(v)).toEqual(["unknown-knob"]);
    expect(JSON.stringify(v[0])).toContain("nope");
  });

  for (const name of NEVER) {
    test(`never-reusable for ${name}, distinct from unknown-knob, one violation even with a bad value`, async () => {
      const { validateOptimizations } = await O();
      const v = validateOptimizations({ [name]: "reuse" }, true);
      expect(reasons(v)).toEqual(["never-reusable"]);
      expect(JSON.stringify(v[0])).toContain(name);
      expect(reasons(validateOptimizations({ [name]: "skip" }, true))).toEqual(["never-reusable"]);
    });
  }

  for (const value of [true, "skip", "off", false, 1, null]) {
    test(`unknown-value for gate_commands: ${JSON.stringify(value)}`, async () => {
      expect(reasons((await O()).validateOptimizations({ gate_commands: value }, true))).toEqual(["unknown-value"]);
    });
  }

  for (const raw of ["reuse", ["gate_commands"], null, 3]) {
    test(`not-a-mapping for a ${JSON.stringify(raw)} section`, async () => {
      expect(reasons((await O()).validateOptimizations(raw, true))).toEqual(["not-a-mapping"]);
    });
  }

  test("requires-gate-outcomes for gate_commands: reuse with gateOutcomesEnabled false; run never needs it", async () => {
    const { validateOptimizations } = await O();
    expect(reasons(validateOptimizations({ gate_commands: "reuse" }, false))).toEqual(["requires-gate-outcomes"]);
    expect(validateOptimizations({ gate_commands: "run" }, false)).toEqual([]);
  });

  test("three offending keys give exactly three violations, one reason each", async () => {
    const v = (await O()).validateOptimizations({ nope: "reuse", review: "reuse", gate_commands: "skip" }, true);
    expect(reasons(v).sort()).toEqual(["never-reusable", "unknown-knob", "unknown-value"]);
  });
});

// ---------------------------------------------------------------- AC.5

describe("AC-STE-723.5 an invalid section reads every knob as run", () => {
  test("never-reusable fixture beside gate_commands: reuse and outcomes on -> run", async () => {
    const root = tree("ac5-never", `${SETTINGS_HEAD}${TRACK_ON}optimizations:\n  gate_commands: reuse\n  code_review: reuse\n`);
    expect((await O()).readOptimizations(root)).toEqual({ gate_commands: "run" });
    expect(printedLines(knob(root, "gate_commands").stdout)).toEqual(["run"]);
  }, T);
  test("unknown-value fixture with outcomes on -> run (the bad value is never passed through)", async () => {
    const root = tree("ac5-value", `${SETTINGS_HEAD}${TRACK_ON}optimizations:\n  gate_commands: skip\n`);
    expect((await O()).readOptimizations(root)).toEqual({ gate_commands: "run" });
  });
  test("unknown-knob fixture beside gate_commands: reuse and outcomes on -> run", async () => {
    const root = tree("ac5-unknown", `${SETTINGS_HEAD}${TRACK_ON}optimizations:\n  gate_commands: reuse\n  nope: reuse\n`);
    expect((await O()).readOptimizations(root)).toEqual({ gate_commands: "run" });
  });
});

// ---------------------------------------------------------------- AC.6

describe("AC-STE-723.6 no environment or userConfig override", () => {
  test("optimizations_config.ts names neither process.env nor userConfig", () => {
    expect(existsSync(MOD_PATH)).toBe(true);
    const src = readFileSync(MOD_PATH, "utf-8");
    expect(src.match(/process\.env/g) ?? []).toEqual([]);
    expect(src.match(/userConfig/g) ?? []).toEqual([]);
  });
  test("control: the same grep finds process.env.CLAUDE_CODE_SESSION_ID in gate_receipt.ts", () => {
    const src = readFileSync(join(SRC, "gate_receipt.ts"), "utf-8");
    expect((src.match(/process\.env/g) ?? []).length).toBeGreaterThan(0);
    expect(src).toContain("process.env.CLAUDE_CODE_SESSION_ID");
  });
});

// ---------------------------------------------------------------- AC.8

describe("AC-STE-723.8 the loader admits optimizations as a closed section", () => {
  test("settingsKeyOrder('') names optimizations as its last entry", async () => {
    const top = [...(await S()).settingsKeyOrder("")];
    expect(top).toContain("optimizations");
    expect(top[top.length - 1]).toBe("optimizations");
  });
  test("settingsKeyOrder('optimizations') equals OPTIMIZATION_KNOBS, and gate_commands is a leaf", async () => {
    const s = await S();
    expect([...s.settingsKeyOrder("optimizations")]).toEqual([...(await O()).OPTIMIZATION_KNOBS]);
    expect([...s.settingsKeyOrder("optimizations.gate_commands")]).toEqual([]);
  });
  test("NEW_KEYS holds optimizations.gate_commands", async () => {
    expect((await S()).NEW_KEYS).toContain("optimizations.gate_commands");
  });
  test("defaults: a sectionless settings file and a legacy tree both load optimizations as { gate_commands: run }", async () => {
    const s = await S();
    expect(s.loadProjectSettings(tree("ac8-def-file", SETTINGS_HEAD)).settings.optimizations).toEqual({ gate_commands: "run" });
    expect(s.loadProjectSettings(tree("ac8-def-legacy", null)).settings.optimizations).toEqual({ gate_commands: "run" });
    expect(s.loadProjectSection(tree("ac8-def-sec", SETTINGS_HEAD), "optimizations")).toEqual({ gate_commands: "run" });
  });
  test("loadProjectSection refuses code_review: reuse naming optimizations.code_review; the tracking read still succeeds", async () => {
    const s = await S();
    const root = tree("ac8-refuse", `${SETTINGS_HEAD}${TRACK_ON}optimizations:\n  code_review: reuse\n`);
    let err: unknown = null;
    try {
      s.loadProjectSection(root, "optimizations");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(s.SettingsShapeError);
    expect(String((err as Error).message)).toContain("optimizations.code_review");
    expect(s.loadProjectSection(root, "tracking").gate_outcomes).toEqual({ enabled: true });
  });
  test("loadProjectSection accepts gate_commands: skip (value grading is the probe's)", async () => {
    const root = tree("ac8-skip", `${SETTINGS_HEAD}optimizations:\n  gate_commands: skip\n`);
    expect((await S()).loadProjectSection(root, "optimizations")).toEqual({ gate_commands: "skip" });
  });
  test("docs/settings-reference.md names optimizations.gate_commands, reuse, run, the run default and the STE-724 residual", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "settings-reference.md"), "utf-8");
    expect(doc).toContain("optimizations.gate_commands");
    const at = doc.indexOf("optimizations");
    const section = at < 0 ? "" : doc.slice(at);
    expect(section).toContain("`reuse`");
    expect(section).toContain("`run`");
    expect(section).toMatch(/default[^\n]*`run`|`run`[^\n]*default/i);
    expect(section).toContain(".env");
    expect(section).toContain("node_modules");
  });
  test("a settings file written by /setup's create call holds no optimizations key; /setup names none", async () => {
    const s = await S();
    const root = tree("ac8-setup", null);
    s.writeProjectSettings(root, { schema_version: 1, min_dpt_version: "3.0.0" }, { create: true });
    const text = readFileSync(join(root, "specs", "settings.yaml"), "utf-8");
    expect(text).toContain("min_dpt_version");
    expect(text).not.toMatch(/^optimizations:/m);
    expect(readFileSync(join(PLUGIN_ROOT, "skills", "setup", "SKILL.md"), "utf-8")).not.toMatch(/optimizations[:.]/);
    // the section is admitted (so an absent section is a choice, not an omission)
    expect([...s.settingsKeyOrder("")]).toContain("optimizations");
  });
});

// ---------------------------------------------------------------- AC.10

/** A temp copy of the plugin's adapters; returns the copied src dir. */
function srcCopy(label: string): string {
  return dirname(pluginCopy(`ste723-${label}`));
}

function mutate(path: string, re: RegExp, to: string | ((m: string) => string)): void {
  const src = readFileSync(path, "utf-8");
  if (!re.test(src)) throw new Error(`mutation did not apply: ${re} matched nothing in ${path}`);
  writeFileSync(path, src.replace(re, to as string));
}

describe("AC-STE-723.10 mutation controls: each rule reds a named test", () => {
  test("control: an unmutated copy grades as the real module does", async () => {
    const dir = srcCopy("m-control");
    const m = await import(join(dir, "optimizations_config.ts"));
    expect(reasons(m.validateOptimizations({ code_review: "reuse" }, true))).toEqual(["never-reusable"]);
    expect(reasons(m.validateOptimizations({ gate_commands: "skip" }, true))).toEqual(["unknown-value"]);
    expect(reasons(m.validateOptimizations({ gate_commands: "reuse" }, false))).toEqual(["requires-gate-outcomes"]);
    expect(m.readOptimizations(tree("m-control", SETTINGS_HEAD + FLOW_REUSE))).toEqual({ gate_commands: "run" });
  }, T);

  test("removing the never-reusable branch turns 'AC-STE-723.3 never-reusable for code_review' red", async () => {
    const dir = srcCopy("m-never");
    const p = join(dir, "optimizations_config.ts");
    mutate(p, /export const NEVER_REUSABLE_STEPS\b[^=]*=\s*(?:Object\.freeze\(\s*)?\[[^\]]*\]/, "export const NEVER_REUSABLE_STEPS: readonly string[] = []");
    const m = await import(p);
    expect(reasons(m.validateOptimizations({ code_review: "reuse" }, true))).not.toEqual(["never-reusable"]);
  }, T);

  test("widening OPTIMIZATION_VALUES turns 'AC-STE-723.3 unknown-value for gate_commands: \"skip\"' red", async () => {
    const dir = srcCopy("m-values");
    const p = join(dir, "optimizations_config.ts");
    mutate(p, /export const OPTIMIZATION_VALUES\s*=\s*\[[^\]]*\]/, 'export const OPTIMIZATION_VALUES = ["reuse", "run", "skip"]');
    const m = await import(p);
    expect(reasons(m.validateOptimizations({ gate_commands: "skip" }, true))).not.toEqual(["unknown-value"]);
  }, T);

  test("dropping the outcome dependency from readOptimizations turns 'AC-STE-723.1 ... tracking.gate_outcomes absent -> run' red", async () => {
    const dir = srcCopy("m-reader-dep");
    mutate(
      join(dir, "project_settings.ts"),
      /export function gateOutcomesSwitchOn\(projectRoot: string\): boolean \{/,
      "export function gateOutcomesSwitchOn(projectRoot: string): boolean {\n  if (projectRoot) return true;",
    );
    const m = await import(join(dir, "optimizations_config.ts"));
    expect(m.readOptimizations(tree("m-reader-dep", SETTINGS_HEAD + FLOW_REUSE))).not.toEqual({ gate_commands: "run" });
  }, T);

  test("dropping the outcome dependency from validateOptimizations turns 'AC-STE-723.3 requires-gate-outcomes' and 'AC-STE-723.12' red", async () => {
    const dir = srcCopy("m-validate-dep");
    const p = join(dir, "optimizations_config.ts");
    mutate(p, /export (function validateOptimizations\b|const validateOptimizations\b)/, (m) => m.replace("validateOptimizations", "__validateOptimizationsOriginal").replace(/^export /, ""));
    writeFileSync(
      p,
      `${readFileSync(p, "utf-8")}\nexport function validateOptimizations(raw: unknown, _gateOutcomesEnabled: boolean) {\n  return __validateOptimizationsOriginal(raw, true);\n}\n`,
    );
    const m = await import(p);
    expect(reasons(m.validateOptimizations({ gate_commands: "reuse" }, false))).not.toEqual(["requires-gate-outcomes"]);
    const r = await m.runOptimizationsReuseOnlyProbe(tree("m-validate-dep", `${SETTINGS_HEAD}optimizations:\n  gate_commands: reuse\n`));
    expect(reasons(r.violations)).not.toEqual(["requires-gate-outcomes"]);
  }, T);
});

// ---------------------------------------------------------------- AC.12

describe("AC-STE-723.12 never implied", () => {
  test("reuse with no tracking.gate_outcomes key: one requires-gate-outcomes violation, the verb prints run, nothing written", async () => {
    const root = tree("ac12", `${SETTINGS_HEAD}optimizations:\n  gate_commands: reuse\n`);
    const before = fileList(root);
    const r = await (await O()).runOptimizationsReuseOnlyProbe(root);
    expect(r.violations.map((v: AnyMod) => [v.reason, v.note, v.severity])).toEqual([
      ["requires-gate-outcomes", "specs/settings.yaml:4 — requires-gate-outcomes", "error"],
    ]);
    const k = knob(root, "gate_commands");
    expect({ code: k.code, lines: printedLines(k.stdout) }).toEqual({ code: 0, lines: ["run"] });
    expect((await O()).readOptimizations(root)).toEqual({ gate_commands: "run" });
    expect(fileList(root)).toEqual(before);
    expect(existsSync(join(root, ".dpt"))).toBe(false);
  }, T);
});

// ---------------------------------------------------------------- AC.13

const REUSE_LINE = "set optimizations.gate_commands: reuse";
const tripped = (id: string): RuleRow => ({ id, disposition: "tripped", reason: null });
const PROPOSAL_MOD = join(SRC, "retro_proposal.ts");

describe("AC-STE-723.13 the PROPOSABLE_SETTINGS reuse row", () => {
  test("the table holds the optimizations.gate_commands row with the value reuse, carrying a trigger", async () => {
    const { PROPOSABLE_SETTINGS } = await import(PROPOSAL_MOD);
    const row = PROPOSABLE_SETTINGS.find((r: AnyMod) => r.key === "optimizations.gate_commands");
    expect(row?.value).toBe("reuse");
    expect(row?.trigger === null || row?.trigger === undefined).toBe(false);
  });

  test("gate_rerun_unchanged_key tripped, tracking.gate_outcomes on: propose prints the reuse set line", async () => {
    const root = makeTree("ste723-ac13-on", { settings: SETTINGS_HEAD + trackingYaml({ ...OFF, gate_outcomes: true }) });
    const report = await writeReport("ste723-ac13-on", rules([tripped("gate_rerun_unchanged_key")]));
    const r = propose(root, report);
    expect(r.status).toBe(0);
    expect(printedLines(r.stdout).filter((l) => l.startsWith("set "))).toEqual([REUSE_LINE]);
  }, T);

  test("the same report with tracking.gate_outcomes off: nothing for that row", async () => {
    const root = makeTree("ste723-ac13-off", { settings: SETTINGS_HEAD + trackingYaml(OFF) });
    const report = await writeReport("ste723-ac13-off", rules([tripped("gate_rerun_unchanged_key")]));
    const r = propose(root, report);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("optimizations.gate_commands");
  }, T);

  test("control: tracking.gate_outcomes on but gate_rerun_unchanged_key clear: nothing for that row", async () => {
    const root = makeTree("ste723-ac13-clear", { settings: SETTINGS_HEAD + trackingYaml({ ...OFF, gate_outcomes: true }) });
    const report = await writeReport("ste723-ac13-clear", rules());
    const r = propose(root, report);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("optimizations.gate_commands");
  }, T);

  // AC-STE-728.2's refusal rows stay green: graded on temp copies whose table is prefixed with one row.
  const EXTRA = "__DPT_STE723_TEST_ROWS__";
  let n = 0;
  async function loadWith(row: Record<string, unknown>): Promise<{ ok: boolean; error?: unknown }> {
    const door = pluginCopy(`ste723-ac13-load-${++n}`);
    const src = readFileSync(door, "utf-8");
    const m = /export const PROPOSABLE_SETTINGS\b[^=]*=\s*(?:Object\.freeze\(\s*)?\[/.exec(src);
    if (m === null) throw new Error("retro_proposal.ts declares no PROPOSABLE_SETTINGS array literal");
    const at = m.index + m[0].length;
    writeFileSync(door, `${src.slice(0, at)}\n  ...(((globalThis as any).${EXTRA} ?? []) as any[]),${src.slice(at)}`);
    (globalThis as AnyMod)[EXTRA] = [row];
    try {
      await import(door);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      delete (globalThis as AnyMod)[EXTRA];
    }
  }
  const trigger = { rules: ["gate_rerun_unchanged_key"], names: "x", emptyScope: false };
  for (const [name, key, value] of [
    ["optimizations.gate_commands with run", "optimizations.gate_commands", "run"],
    ["a knob outside OPTIMIZATION_KNOBS with reuse", "optimizations.nope", "reuse"],
    ["a refused step name with reuse", "optimizations.code_review", "reuse"],
  ] as const) {
    test(`${name} still throws when the module loads`, async () => {
      const r = await loadWith({ key, value, trigger });
      expect(r.ok).toBe(false);
      expect(String((r.error as Error)?.message ?? r.error)).toContain(key);
    }, T);
  }
  test("control: a second optimizations.gate_commands: reuse row loads (the widened case)", async () => {
    expect((await loadWith({ key: "optimizations.gate_commands", value: "reuse", trigger })).ok).toBe(true);
  }, T);
});

// ---------------------------------------------------------------- AC.15

const MERGE = "13fdf144";
const ARCHIVE = "specs/frs/archive/STE-722.md";
const C8 = " *(Amended by AC-STE-725.12 (v3.3.0): the Phase 3 step-i line also differs from v3.0.0, by the reuse clause appended after its trunk text.)*";
const C12 = " *(Amended by AC-STE-723.15 (v3.3.0): the get refusal's Remedy list gains optimizations last, and get optimizations prints its run default.)*";

describe("AC-STE-723.15 the archived STE-722 clause and the get pins", () => {
  test(`${ARCHIVE} differs from its ${MERGE} bytes only by the AC-STE-722.8 and AC-STE-722.12 clauses, the .12 one present`, () => {
    const g = spawnSync("git", ["-C", REPO_ROOT, "show", `${MERGE}:${ARCHIVE}`], { encoding: "utf-8" });
    expect(g.status).toBe(0);
    const base = g.stdout.split("\n");
    const now = readFileSync(resolve(REPO_ROOT, ARCHIVE), "utf-8").split("\n");
    expect(now.length).toBe(base.length);
    const i8 = base.findIndex((l) => l.startsWith("- AC-STE-722.8:"));
    const i12 = base.findIndex((l) => l.startsWith("- AC-STE-722.12:"));
    expect(i8).toBeGreaterThan(0);
    expect(i12).toBeGreaterThan(0);
    const bad: number[] = [];
    for (let i = 0; i < base.length; i++) {
      const ok = now[i] === base[i] || (i === i8 && now[i] === base[i] + C8) || (i === i12 && now[i] === base[i] + C12);
      if (!ok) bad.push(i + 1);
    }
    expect(bad).toEqual([]);
    expect(now[i12]).toBe(base[i12] + C12);
  });

  test("control: the separator is one space, as the file's existing amendment clauses use", () => {
    const text = readFileSync(resolve(REPO_ROOT, ARCHIVE), "utf-8");
    expect(text).toMatch(/\S \*\(Amended by AC-STE-722\.14 \(v3\.2\.0\)/);
    expect(C12.startsWith(" *(")).toBe(true);
  });

  const getRun = (module: string, root: string, section: string) => {
    const p = spawnSync(process.execPath, ["run", module, "get", section, root], { cwd: root, encoding: "utf-8", timeout: 60_000 });
    return { code: p.status, out: p.stdout ?? "", err: p.stderr ?? "" };
  };
  const REMEDY = "Remedy: get one of: task_tracking, verification, docs, orchestration, tracking, close_out, retro, release, video, optimizations.";

  test("the real module: get optimizations prints its run default; the get refusal's Remedy list ends in optimizations", () => {
    const root = tree("ac15-get", null);
    expect(getRun(SETTINGS_MOD, root, "optimizations")).toEqual({ code: 0, out: '{\n  "gate_commands": "run"\n}\n', err: "" });
    expect(getRun(SETTINGS_MOD, root, "nosuch").err.split("\n")[1]).toBe(REMEDY);
  }, T);

  test("reverting optimizations out of TOP_KEYS in a temp copy turns both pins red", () => {
    const dir = srcCopy("ac15-revert");
    const p = join(dir, "project_settings.ts");
    mutate(p, /(const TOP_KEYS = \[[^\]]*?)\n\s*"optimizations",/, "$1");
    const root = tree("ac15-revert", null);
    expect(getRun(p, root, "optimizations").code).toBe(1);
    expect(getRun(p, root, "nosuch").err.split("\n")[1]).not.toBe(REMEDY);
  }, T);
});

// ---------------------------------------------------------------- AC.13 (apply)
//
// The reuse row "is applied only through that FR's explicit approval": STE-728's
// `apply` verb. Graded in a child process that imports `apply` (so its returned
// `keys` are observable) with the session env, config dir and cwd a live call has.

describe("AC-STE-723.13 (apply) the reuse row through STE-728's apply", () => {
  function applyKeys(a: Approved): { status: number | null; keys: string[] | null; stderr: string } {
    const script = join(tempDir("ste723-ac13-apply-runner"), "run-apply.ts");
    writeFileSync(
      script,
      `import { apply } from ${JSON.stringify(PROPOSAL_MOD)};\n` +
        `const [root, report, digest] = process.argv.slice(2);\n` +
        `console.log("KEYS=" + JSON.stringify(apply(root!, report!, digest!).keys));\n`,
    );
    const p = spawnSync(process.execPath, ["run", script, a.root, a.report, a.digest], {
      cwd: a.transcript.cwd,
      encoding: "utf-8",
      env: childEnv({ configDir: a.configDir, session: a.session }),
      timeout: 60_000,
    });
    const line = (p.stdout ?? "").split("\n").find((l) => l.startsWith("KEYS="));
    return { status: p.status, keys: line === undefined ? null : JSON.parse(line.slice("KEYS=".length)), stderr: p.stderr ?? "" };
  }

  test("AC-STE-723.13 (apply): an approved set optimizations.gate_commands: reuse writes the key and returns it", async () => {
    const root = makeTree("ste723-ac13-apply-reuse", { settings: SETTINGS_HEAD + trackingYaml({ ...OFF, gate_outcomes: true }) });
    const report = await writeReport("ste723-ac13-apply-reuse", rules([tripped("gate_rerun_unchanged_key")]));
    const a = approve("ste723-ac13-apply-reuse", root, report);
    expect(a.lines.filter((l) => l.startsWith("set "))).toEqual([REUSE_LINE]);

    const r = applyKeys(a);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
    expect(r.keys).toEqual(["optimizations.gate_commands"]);
    expect((await S()).loadProjectSection(root, "optimizations")).toEqual({ gate_commands: "reuse" });
    expect(readFileSync(settingsPath(root), "utf-8")).toContain("gate_commands: reuse");
  }, T);

  test("AC-STE-723.13 (apply) control: the three tracking rows apply exactly as before", async () => {
    const root = makeTree("ste723-ac13-apply-tracking");
    const report = await writeReport(
      "ste723-ac13-apply-tracking",
      rules([
        skipped("cost_per_changed_line", TOKEN_STATS_REASON),
        skipped("zero_yield_round", TOOL_CALLS_REASON),
        skipped("slow_gate_run", GATE_OUTCOMES_REASON),
      ]),
    );
    const a = approve("ste723-ac13-apply-tracking", root, report);
    expect(a.lines.filter((l) => l.startsWith("set ")).sort()).toEqual([
      "set tracking.gate_outcomes.enabled: true",
      "set tracking.token_stats.enabled: true",
      "set tracking.tool_calls.enabled: true",
    ]);

    const r = applyKeys(a);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
    expect(r.keys).toEqual(["tracking.token_stats.enabled", "tracking.tool_calls.enabled", "tracking.gate_outcomes.enabled"]);
    expect(readFileSync(settingsPath(root), "utf-8")).toBe(
      SETTINGS_HEAD + trackingYaml({ token_stats: true, tool_calls: true, gate_outcomes: true }),
    );
    expect(readFileSync(settingsPath(root), "utf-8")).not.toContain("optimizations");
  }, T);
});
