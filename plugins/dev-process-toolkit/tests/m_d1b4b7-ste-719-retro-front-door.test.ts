// STE-719 (M_d1b4b7) AC.2, AC.3 (first two clauses + the rest of its loader
// contract), AC.11 and the end-to-end half of AC.12 — the front door
// `bun run adapters/_shared/src/retro.ts <root> [scope]`.
//
// Every tree is a temp git checkout outside the repo. The no-argument scope
// reads the current session through `findCurrentSession(cwd)`, so each run
// sets CLAUDE_CONFIG_DIR to a temp config dir whose project folder holds one
// synthetic transcript recording `cwd: <root>`; the front door runs with
// cwd = root. `/retro` never reads `retro.enabled`: one case per value.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_ON,
  BRANCH,
  PLUGIN_ROOT,
  REPORT_NAME_RE,
  RULE_IDS,
  SETTINGS_HEAD,
  SETUP_MD,
  SKIPPED,
  UUID_RE,
  aliasMod,
  cleanupTemps,
  dptSnapshot,
  gateRun,
  gitStatus,
  makeConfigDir,
  makeRetroTree,
  pluginVersion,
  reportFiles,
  reportMod,
  retroDir,
  runRetro,
  settingsMod,
  sid,
  tempDir,
  timeline,
  tokenRow,
  writeTimeline,
  writeTokenLedger,
  type RetroSetting,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const SETTINGS_VALUES: RetroSetting[] = ["absent", "false", "true"];

function readReport(root: string): { name: string; text: string; json: any } {
  const files = reportFiles(root);
  if (files.length !== 1) throw new Error(`expected one report, found ${JSON.stringify(files)}`);
  const text = readFileSync(join(retroDir(root), files[0]!), "utf-8");
  return { name: files[0]!, text, json: JSON.parse(text) };
}

// ===========================================================================
// AC-STE-719.2 — a hand run always runs, whatever retro.enabled says
// ===========================================================================

describe("AC-STE-719.2 the front door runs with retro.enabled absent, false and true", () => {
  for (const setting of SETTINGS_VALUES) {
    test(`retro.enabled ${setting}: exit 0, no refusal, one report, every rule skipped on a tree with no data`, () => {
      const root = makeRetroTree(`door-${setting}`, { retro: setting });
      const config = makeConfigDir(`door-${setting}-config`, root, [sid(1)]);
      const r = runRetro(root, [], { CLAUDE_CONFIG_DIR: config });
      expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: r.stderr });
      expect(r.status).toBe(0);
      expect(`${r.stdout}\n${r.stderr}`).not.toMatch(/Remedy:|refus/i);
      const files = reportFiles(root);
      expect(files.length).toBe(1);
      const { json } = readReport(root);
      expect(json.rules.map((x: any) => x.id)).toEqual([...RULE_IDS]);
      for (const rule of json.rules) {
        expect({ id: rule.id, d: rule.disposition }).toEqual({ id: rule.id, d: SKIPPED });
        expect(typeof rule.reason === "string" && rule.reason.length > 0).toBe(true);
      }
    });
  }
});

// ===========================================================================
// AC-STE-719.3 — the `retro:` settings section and retroSwitchOn
// ===========================================================================

function settingsTree(label: string, body: string | null, claudeMd = SETUP_MD): string {
  const root = tempDir(label);
  writeFileSync(join(root, "CLAUDE.md"), claudeMd);
  if (body !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), body);
  }
  return root;
}

const BOTH_HOMES_MD = "# Fixture\n\n## Orchestration\n\ndefault_effort: high\nmerge_policy: offer\n";
const LEGACY_MD = "# Fixture\n\n## Task Tracking\n\nmode: none\n\n## Key Commands\n\n- `bun test`\n";

describe("AC-STE-719.3 the retro settings section", () => {
  test("a retro: section with a key other than enabled throws SettingsShapeError naming retro.<key>", async () => {
    const m = await settingsMod();
    const root = settingsTree("retro-unknown", `${SETTINGS_HEAD}retro:\n  enabled: true\n  threshold_ms: 5\n`);
    let err: unknown = null;
    try {
      m.loadProjectSettings(root);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(m.SettingsShapeError);
    expect((err as Error).message).toContain("retro.threshold_ms");
  });

  test("loadProjectSettings accepts a top-level retro key and returns its value", async () => {
    const m = await settingsMod();
    const root = settingsTree("retro-accept", `${SETTINGS_HEAD}retro:\n  enabled: true\n`);
    expect(m.loadProjectSettings(root).settings.retro).toEqual({ enabled: true });
    expect(m.loadProjectSection(root, "retro")).toEqual({ enabled: true });
  });

  test("an absent section, a legacy tree and no settings file default to { enabled: false }", async () => {
    const m = await settingsMod();
    expect(m.loadProjectSettings(settingsTree("retro-absent", SETTINGS_HEAD)).settings.retro).toEqual({ enabled: false });
    expect(m.loadProjectSettings(settingsTree("retro-legacy", null, LEGACY_MD)).settings.retro).toEqual({ enabled: false });
    expect(m.loadProjectSettings(settingsTree("retro-none", null)).settings.retro).toEqual({ enabled: false });
  });

  test("a non-map retro section and a non-boolean enabled throw SettingsShapeError", async () => {
    const m = await settingsMod();
    expect(() => m.loadProjectSettings(settingsTree("retro-bare", `${SETTINGS_HEAD}retro: true\n`))).toThrow(m.SettingsShapeError);
    expect(() => m.loadProjectSettings(settingsTree("retro-yes", `${SETTINGS_HEAD}retro:\n  enabled: "yes"\n`))).toThrow(m.SettingsShapeError);
  });

  test("TOP_KEYS orders retro after close_out; settingsKeyOrder('retro') is ['enabled']; NEW_KEYS holds retro", async () => {
    const m = await settingsMod();
    const top = m.settingsKeyOrder("") as string[];
    expect(top.indexOf("retro")).toBe(top.indexOf("close_out") + 1);
    expect(m.settingsKeyOrder("retro")).toEqual(["enabled"]);
    expect(m.NEW_KEYS).toContain("retro");
  });

  test("a malformed retro section breaks only its own reader: another section still loads", async () => {
    const m = await settingsMod();
    const root = settingsTree("retro-isolated", `${SETTINGS_HEAD}tracking:\n  tool_calls:\n    enabled: true\nretro:\n  bogus: 1\n`);
    expect(m.loadProjectSection(root, "tracking").tool_calls).toEqual({ enabled: true });
    expect(m.retroSwitchOn(root)).toBe(false);
  });

  test("retroSwitchOn: false for absent, enabled false, legacy, no settings file and both homes; true for enabled true", async () => {
    const m = await settingsMod();
    const cases: [string, string, boolean][] = [
      ["absent", settingsTree("sw-absent", SETTINGS_HEAD), false],
      ["false", settingsTree("sw-false", `${SETTINGS_HEAD}retro:\n  enabled: false\n`), false],
      ["legacy", settingsTree("sw-legacy", null, LEGACY_MD), false],
      ["none", settingsTree("sw-none", null), false],
      // A real both-homes tree: a moved heading with one of its keys beside the settings file
      // (`## Task Tracking` is the stub slot and never counts as a second home).
      ["both", settingsTree("sw-both", `${SETTINGS_HEAD}retro:\n  enabled: true\n`, BOTH_HOMES_MD), false],
      ["true", settingsTree("sw-true", `${SETTINGS_HEAD}retro:\n  enabled: true\n`), true],
    ];
    expect(cases.map(([k, root]) => [k, m.retroSwitchOn(root)])).toEqual(cases.map(([k, , want]) => [k, want]));
  });

  test("docs/settings-reference.md names the block as `retro` and the key as `retro.enabled`", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "settings-reference.md"), "utf-8");
    expect(doc).toContain("`retro`");
    expect(doc).toContain("`retro.enabled`");
  });
});

// ===========================================================================
// AC-STE-719.11 — exactly one write, nothing else moves
// ===========================================================================

describe("AC-STE-719.11 the front door writes exactly one ignored report file", () => {
  for (const setting of SETTINGS_VALUES) {
    test(`retro.enabled ${setting}: one <scope-slug>-<stamp>.json that parseRetroReport accepts; git status and the rest of .dpt/ unchanged`, async () => {
      const { parseRetroReport } = await reportMod();
      const root = makeRetroTree(`write-${setting}`, { retro: setting });
      writeTimeline(root, sid(1), timeline({ gate_runs: [gateRun(1000)] }));
      writeTokenLedger(root, [tokenRow(sid(1), 10)]);
      const config = makeConfigDir(`write-${setting}-config`, root, [sid(1)]);
      const beforeStatus = gitStatus(root);
      const beforeDpt = dptSnapshot(root);
      const r = runRetro(root, [], { CLAUDE_CONFIG_DIR: config });
      expect(r.status).toBe(0);
      const files = reportFiles(root);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(REPORT_NAME_RE);
      const { text } = readReport(root);
      expect(() => parseRetroReport(text)).not.toThrow();
      expect(parseRetroReport(text).schema).toBe("dpt-retro/1");
      expect(gitStatus(root)).toBe(beforeStatus);
      expect(dptSnapshot(root)).toEqual(beforeDpt);
    });
  }

  test("the stamp is the UTC time of the run", () => {
    const root = makeRetroTree("write-stamp");
    const config = makeConfigDir("write-stamp-config", root, [sid(1)]);
    const before = Date.now();
    expect(runRetro(root, [], { CLAUDE_CONFIG_DIR: config }).status).toBe(0);
    const after = Date.now();
    const m = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/.exec(reportFiles(root)[0]!)!;
    const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
    expect(t).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(t).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// AC-STE-719.12 (end to end) — what the written report may hold
// ===========================================================================

describe("AC-STE-719.12 the written report holds aliases only, and no path, command, UUID or branch", () => {
  test("FR scope over two claimed sessions: s1/s2 with digests, two tripped rules -> medium", async () => {
    const { sessionDigest } = await aliasMod();
    const root = makeRetroTree("privacy", { tracking: ALL_ON });
    writeTokenLedger(root, [
      tokenRow(sid(21), 10, { claimed_by: "STE-1", git_branch: BRANCH }),
      tokenRow(sid(22), 10, { claimed_by: "STE-1", git_branch: BRANCH }),
      tokenRow(sid(23), 10, { claimed_by: "STE-9", git_branch: BRANCH }),
    ]);
    // Session 21: a slow gate-check run; session 22: the same key re-run unchanged.
    writeTimeline(root, sid(21), timeline({ gate_runs: [gateRun(900001)] }));
    writeTimeline(root, sid(22), timeline({ gate_runs: [gateRun(1000)] }));
    const r = runRetro(root, ["STE-1"]);
    expect(r.status).toBe(0);
    const { text, json } = readReport(root);

    expect(json.plugin_version).toBe(pluginVersion());
    expect(json.scope).toEqual({ kind: "fr", id: "STE-1" });
    expect(json.sessions).toEqual([
      { alias: "s1", digest: sessionDigest(sid(21)) },
      { alias: "s2", digest: sessionDigest(sid(22)) },
    ]);
    const by = Object.fromEntries(json.rules.map((x: any) => [x.id, x.disposition]));
    expect(by).toEqual({
      slow_gate_run: "tripped",
      gate_rerun_unchanged_key: "tripped",
      zero_yield_round: SKIPPED,
      cost_per_changed_line: SKIPPED,
    });
    expect(json.tripped_count).toBe(2);
    expect(json.suggested_severity).toBe("medium");

    expect([...text.matchAll(UUID_RE)].map((m) => m[0])).toEqual([]);
    expect(text).not.toContain(root);
    expect(text).not.toMatch(/"\/[^"]*"/);
    expect(text).not.toContain(BRANCH);
    expect(text).not.toContain("git commit");
    expect(text).not.toContain(sessionDigest(sid(23)));
  });

  test("one tripped rule -> low", () => {
    const root = makeRetroTree("privacy-low", { tracking: ALL_ON });
    writeTokenLedger(root, [tokenRow(sid(31), 10, { claimed_by: "STE-1" })]);
    writeTimeline(root, sid(31), timeline({ gate_runs: [gateRun(900001)] }));
    expect(runRetro(root, ["STE-1"]).status).toBe(0);
    const { json } = readReport(root);
    expect(json.tripped_count).toBe(1);
    expect(json.suggested_severity).toBe("low");
  });
});
