// M_bae31f STE-693 — /gate-check probe `tracker_write_gate_setting` (AC-STE-693.6).
//
// An informational probe: it reports the EFFECTIVE per-user tracker write gate
// setting in exactly one row — `enforce` or `off (per-user)` — and never fails
// the gate. AC-STE-693.1 measured that project- and local-scope
// `pluginConfigs` never reach the hook, so the conditional "a committed project
// settings file sets the option to off" warning does NOT apply: the row
// reports the effective setting only, and a project file setting `off` leaves
// it at `enforce`.
//
// Contract pinned here:
//
//   adapters/_shared/src/tracker_write_gate_setting.ts
//     export const PROBE_ID = "tracker_write_gate_setting";
//     export async function runTrackerWriteGateSettingProbe(
//       projectRoot: string,
//       env?: Record<string, string | undefined>,   // default process.env
//     ): Promise<Report>
//     interface Report {
//       violations: [];                 // always empty — the row never fails the gate
//       notes: string[];                // exactly one: `tracker_write_gate_setting: <setting>`
//       vacuous: false;
//       setting: "enforce" | "off (per-user)";
//     }
//   Resolution, same as the hook's (through `trackerWriteGateSetting`):
//     1. `CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE` in `env`, when present;
//     2. otherwise the USER settings file — `<CLAUDE_CONFIG_DIR>/settings.json`,
//        or `<HOME>/.claude/settings.json` when CLAUDE_CONFIG_DIR is unset —
//        `pluginConfigs["dev-process-toolkit@<marketplace>"].options.tracker_write_gate`
//        (a /gate-check Bash call is not a hook, so the variable may be absent there);
//     3. otherwise `enforce`. An unknown value is `enforce`.
//     Project `.claude/settings.json` and `.claude/settings.local.json` are read only
//     for the `env` warning (AC-STE-693.5 amended), and never for `pluginConfigs`.
//   plus an `if (import.meta.main)` front door (probe #81): `bun run <module> <projectRoot>`
//   prints the one row and ALWAYS exits 0.
//   The SKILL.md registry carries the registration line naming the module.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const PROBE_ID = "tracker_write_gate_setting";
const MODULE_REL = "adapters/_shared/src/tracker_write_gate_setting.ts";
const MODULE_ABS = join(PLUGIN_ROOT, ...MODULE_REL.split("/"));
const SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const VAR = "CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE";

interface Report {
  readonly violations: readonly unknown[];
  readonly notes: readonly string[];
  readonly vacuous: boolean;
  readonly setting: string;
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-693-probe-${label}-`)));
  tempDirs.push(d);
  return d;
}

function settingsWith(value: string | null, key = "dev-process-toolkit@dev-process-toolkit"): string {
  return JSON.stringify(value === null ? {} : { pluginConfigs: { [key]: { options: { tracker_write_gate: value } } } }, null, 2);
}

/** A user config dir (CLAUDE_CONFIG_DIR) whose settings.json carries `value`, or no option. */
function userConfigDir(value: string | null, key?: string): string {
  const d = tempDir("user");
  writeFileSync(join(d, "settings.json"), settingsWith(value, key));
  return d;
}

/** A project root whose committed AND local project settings set the option to `value`. */
function projectWith(value: string | null): string {
  const root = tempDir("project");
  mkdirSync(join(root, ".claude"), { recursive: true });
  if (value !== null) {
    writeFileSync(join(root, ".claude", "settings.json"), settingsWith(value));
    writeFileSync(join(root, ".claude", "settings.local.json"), settingsWith(value));
  }
  return root;
}

async function probe(projectRoot: string, env: Record<string, string | undefined>): Promise<Report> {
  const mod = await import(MODULE_ABS);
  return (await mod.runTrackerWriteGateSettingProbe(projectRoot, env)) as Report;
}

function expectOneRow(r: Report, setting: string): void {
  expect(r.setting).toBe(setting);
  expect(r.violations).toEqual([]);
  expect(r.vacuous).toBe(false);
  expect(r.notes.length).toBe(1);
  expect(r.notes[0]).toBe(`${PROBE_ID}: ${setting}`);
}

describe("AC-STE-693.6 — tracker_write_gate_setting reports the effective setting in one row", () => {
  test("the module exists and exports PROBE_ID and the probe entry", async () => {
    expect(existsSync(MODULE_ABS)).toBe(true);
    const mod = await import(MODULE_ABS);
    expect(mod.PROBE_ID).toBe(PROBE_ID);
    expect(typeof mod.runTrackerWriteGateSettingProbe).toBe("function");
  });

  test("POSITIVE — nothing set anywhere → one row `enforce`", async () => {
    const r = await probe(projectWith(null), { CLAUDE_CONFIG_DIR: userConfigDir(null) });
    expectOneRow(r, "enforce");
  });

  test("the variable set to off → one row `off (per-user)`, never a violation", async () => {
    const r = await probe(projectWith(null), { [VAR]: "off", CLAUDE_CONFIG_DIR: userConfigDir(null) });
    expectOneRow(r, "off (per-user)");
  });

  test("the variable set to enforce, empty, or an unknown value → `enforce`", async () => {
    for (const v of ["enforce", ""]) {
      expectOneRow(await probe(projectWith(null), { [VAR]: v, CLAUDE_CONFIG_DIR: userConfigDir(null) }), "enforce");
    }
    // Amended for the review fix "the row names an unrecognised value": an unknown value is still `enforce`, and the row names it.
    for (const v of ["OFF", "disabled"]) {
      const r = await probe(projectWith(null), { [VAR]: v, CLAUDE_CONFIG_DIR: userConfigDir(null) });
      expect(r.setting).toBe("enforce");
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(false);
      expect(r.notes.length).toBe(1);
      expect(r.notes[0]!.startsWith(`${PROBE_ID}: enforce`)).toBe(true);
      expect(r.notes[0]!).toContain(v);
    }
  });

  test("no variable, user settings pluginConfigs set to off → `off (per-user)`, under any marketplace name", async () => {
    for (const key of ["dev-process-toolkit@dev-process-toolkit", "dev-process-toolkit@some-other-mkt"]) {
      const r = await probe(projectWith(null), { CLAUDE_CONFIG_DIR: userConfigDir("off", key) });
      expectOneRow(r, "off (per-user)");
    }
  });

  test("no CLAUDE_CONFIG_DIR: the user settings file is read from HOME/.claude/settings.json", async () => {
    const home = tempDir("home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), settingsWith("off"));
    expectOneRow(await probe(projectWith(null), { HOME: home }), "off (per-user)");
  });

  test("CONTROL — another plugin's option of the same name in user settings does not count", async () => {
    const r = await probe(projectWith(null), { CLAUDE_CONFIG_DIR: userConfigDir("off", "other-plugin@other-mkt") });
    expectOneRow(r, "enforce");
  });

  test("the variable wins over the user settings file (it is what the hook receives)", async () => {
    const r = await probe(projectWith(null), { [VAR]: "enforce", CLAUDE_CONFIG_DIR: userConfigDir("off") });
    expectOneRow(r, "enforce");
  });

  test("NEGATIVE scope — project and local settings setting off do not reach the hook, so the row stays `enforce` and carries no warning", async () => {
    const r = await probe(projectWith("off"), { CLAUDE_CONFIG_DIR: userConfigDir(null) });
    expectOneRow(r, "enforce");
  });

  test("front door — `bun run <module> <root>` prints the one row and exits 0, for both settings", () => {
    for (const [value, setting] of [
      [undefined, "enforce"],
      ["off", "off (per-user)"],
    ] as const) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      delete env[VAR];
      env.CLAUDE_CONFIG_DIR = userConfigDir(null);
      if (value !== undefined) env[VAR] = value;
      const p = Bun.spawnSync(["bun", "run", MODULE_ABS, projectWith(null)], { env, stdout: "pipe", stderr: "pipe" });
      expect(p.exitCode).toBe(0);
      const lines = p.stdout.toString().split("\n").filter((l) => l.trim() !== "");
      expect(lines).toEqual([`${PROBE_ID}: ${setting}`]);
    }
  });

  test("the module carries the import.meta.main front door probe #81 requires", () => {
    expect(readFileSync(MODULE_ABS, "utf-8")).toMatch(/if \(import\.meta\.main\)/);
  });

  test("the /gate-check registry registers the probe by its module", () => {
    const skill = readFileSync(SKILL, "utf-8");
    const line = skill.split("\n").find((l) => l.includes(`\`${PROBE_ID}\``));
    if (line === undefined) throw new Error(`skills/gate-check/SKILL.md registers no \`${PROBE_ID}\` probe`);
    expect(line).toMatch(/^\d+\. \*\*`tracker_write_gate_setting`\*\*/);
    expect(line).toContain("`runTrackerWriteGateSettingProbe(projectRoot)`");
    expect(line).toContain(`\`${MODULE_REL}\``);
    expect(line).toContain("off (per-user)");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-693.6 (amended) — the row warns about a project settings `env` block
// ---------------------------------------------------------------------------
//
// Run 5 measured that a project `.claude/settings.json` `env` block reaches the
// hook as the variable itself, so the hook treats `off` as `enforce` when such
// a file names it (AC.5). The row mirrors that:
//   - `.claude/settings.json` or `.claude/settings.local.json` under projectRoot
//     whose `env` block names the variable → the ONE row still starts with
//     `tracker_write_gate_setting: enforce` and carries a warning (/warn/i)
//     naming the variable and every such file;
//   - the effective setting is `enforce` then, whatever the variable or user
//     settings say;
//   - violations stay [] (the row never fails the gate);
//   - an `env` naming some other variable, or `pluginConfigs` only, warns about nothing.

describe("AC-STE-693.6 (amended) — the row warns when a project settings env block names the variable", () => {
  function projectEnv(files: Record<string, unknown>): string {
    const root = tempDir("project-env");
    mkdirSync(join(root, ".claude"), { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, ".claude", name), JSON.stringify(content, null, 2));
    return root;
  }

  function expectWarningRow(r: Report, files: string[]): void {
    expect(r.setting).toBe("enforce");
    expect(r.violations).toEqual([]);
    expect(r.vacuous).toBe(false);
    expect(r.notes.length).toBe(1);
    const row = r.notes[0]!;
    expect(row.startsWith(`${PROBE_ID}: enforce`)).toBe(true);
    expect(row).toMatch(/warn/i);
    expect(row).toContain(VAR);
    for (const f of files) expect(row).toContain(`.claude/${f}`);
  }

  for (const file of ["settings.json", "settings.local.json"]) {
    test(`.claude/${file} env sets the variable to off, variable absent → one row \`enforce\` with a warning naming the file`, async () => {
      const r = await probe(projectEnv({ [file]: { env: { [VAR]: "off" } } }), { CLAUDE_CONFIG_DIR: userConfigDir(null) });
      expectWarningRow(r, [file]);
    });

    test(`.claude/${file} env names the variable while the variable is off → effective enforce, warning`, async () => {
      const r = await probe(projectEnv({ [file]: { env: { [VAR]: "off" } } }), { [VAR]: "off", CLAUDE_CONFIG_DIR: userConfigDir(null) });
      expectWarningRow(r, [file]);
    });
  }

  test("user settings off + a project env block naming the variable → effective enforce, warning", async () => {
    const r = await probe(projectEnv({ "settings.json": { env: { [VAR]: "off" } } }), { CLAUDE_CONFIG_DIR: userConfigDir("off") });
    expectWarningRow(r, ["settings.json"]);
  });

  test("both project files name the variable → one row naming both files", async () => {
    const r = await probe(
      projectEnv({ "settings.json": { env: { [VAR]: "off" } }, "settings.local.json": { env: { [VAR]: "off" } } }),
      { CLAUDE_CONFIG_DIR: userConfigDir(null) },
    );
    expectWarningRow(r, ["settings.json", "settings.local.json"]);
  });

  test("CONTROL — a project env block naming some other variable → no warning, the plain row", async () => {
    const root = projectEnv({
      "settings.json": { env: { CLAUDE_PLUGIN_OPTION_SOMETHING_ELSE: "off" } },
      "settings.local.json": { env: { OTHER_VAR: "off" } },
    });
    expectOneRow(await probe(root, { CLAUDE_CONFIG_DIR: userConfigDir(null) }), "enforce");
    expectOneRow(await probe(root, { [VAR]: "off", CLAUDE_CONFIG_DIR: userConfigDir(null) }), "off (per-user)");
  });

  test("front door — a warning row is still one line and exits 0", () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env[VAR];
    env.CLAUDE_CONFIG_DIR = userConfigDir(null);
    const root = projectEnv({ "settings.json": { env: { [VAR]: "off" } } });
    const p = Bun.spawnSync(["bun", "run", MODULE_ABS, root], { env, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const lines = p.stdout.toString().split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBe(1);
    expect(lines[0]!.startsWith(`${PROBE_ID}: enforce`)).toBe(true);
    expect(lines[0]!).toMatch(/warn/i);
    expect(lines[0]!).toContain(".claude/settings.json");
  });

  test("the /gate-check registry line mentions the env-block warning", () => {
    const skill = readFileSync(SKILL, "utf-8");
    const line = skill.split("\n").find((l) => l.includes(`\`${PROBE_ID}\``));
    if (line === undefined) throw new Error(`skills/gate-check/SKILL.md registers no \`${PROBE_ID}\` probe`);
    expect(line).toMatch(/warn/i);
    expect(line).toMatch(/`env`/);
    expect(line).toContain(".claude/settings.json");
    expect(line).toContain(".claude/settings.local.json");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-693.6 (review fix) — an unrecognised value is named in the row
// ---------------------------------------------------------------------------
//
// When the variable, or the user-settings fallback, holds a value other than
// `enforce`, `off` or empty, the effective setting is `enforce` (fail closed),
// and the ONE row says so AND names the ignored value, so the user sees why
// their `disabled` did nothing. It never becomes a violation.
//
// NOTE: the earlier test "the variable set to enforce, empty, or an unknown
// value → `enforce`" was amended with this fix: it still pins the plain row for
// `enforce` and empty, and now requires the unknown values to be named.

describe("AC-STE-693.6 (review fix) — the row names an unrecognised value", () => {
  function expectIgnoredRow(r: Report, value: string): void {
    expect(r.setting).toBe("enforce");
    expect(r.violations).toEqual([]);
    expect(r.vacuous).toBe(false);
    expect(r.notes.length).toBe(1);
    const row = r.notes[0]!;
    expect(row.startsWith(`${PROBE_ID}: enforce`)).toBe(true);
    expect(row).toContain(value);
  }

  for (const value of ["disabled", "OFF"]) {
    test(`the variable set to \`${value}\` → one row \`enforce\` naming the ignored value \`${value}\``, async () => {
      const r = await probe(projectWith(null), { [VAR]: value, CLAUDE_CONFIG_DIR: userConfigDir(null) });
      expectIgnoredRow(r, value);
    });

    test(`no variable, user settings option set to \`${value}\` → one row \`enforce\` naming \`${value}\``, async () => {
      const r = await probe(projectWith(null), { CLAUDE_CONFIG_DIR: userConfigDir(value) });
      expectIgnoredRow(r, value);
    });
  }

  test("CONTROL — `enforce`, empty and absent name no ignored value: the plain row", async () => {
    expectOneRow(await probe(projectWith(null), { [VAR]: "enforce", CLAUDE_CONFIG_DIR: userConfigDir(null) }), "enforce");
    expectOneRow(await probe(projectWith(null), { [VAR]: "", CLAUDE_CONFIG_DIR: userConfigDir(null) }), "enforce");
    expectOneRow(await probe(projectWith(null), { CLAUDE_CONFIG_DIR: userConfigDir("enforce") }), "enforce");
  });

  test("front door — the unrecognised-value row is one line naming the value, exit 0", () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env[VAR] = "disabled";
    env.CLAUDE_CONFIG_DIR = userConfigDir(null);
    const p = Bun.spawnSync(["bun", "run", MODULE_ABS, projectWith(null)], { env, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const lines = p.stdout.toString().split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBe(1);
    expect(lines[0]!.startsWith(`${PROBE_ID}: enforce`)).toBe(true);
    expect(lines[0]!).toContain("disabled");
  });
});
