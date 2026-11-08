// STE-706 — one settings file (`specs/settings.yaml`) and one loader that
// still reads the old CLAUDE.md homes.
//
// Module under test: adapters/_shared/src/project_settings.ts (plus its legacy
// half, which holds the moved v2.101.x readers and `renderTrackingStub`).
//
// Shape assumed by these tests (the FR's own YAML schema, snake_case): the
// loaded `settings` mirrors `specs/settings.yaml` section by section, e.g.
// `settings.orchestration` is `{ default_effort, merge_policy }` (AC-.6), and
// a legacy section deep-equals the v2.101.4 reader's record with its keys in
// the file's snake_case spelling (`verifySkill` -> `verify_skill`).
// `loadProjectSection(root, section)` returns that section's value.
//
// AC-STE-706.17 (mutation controls) — each guarded behaviour, and the named
// test that reds when it is removed:
//   - both-homes refusal          -> "AC-.7 both homes: <kind> refuses naming both paths"
//   - foreign-file test           -> "AC-.7 foreign: OpenAPI file beside a legacy Linear CLAUDE.md loads legacy"
//                                    "AC-.7 foreign: an indented schema_version line is still foreign"
//   - raw-line heading match      -> "AC-.5 a commented ## Task Tracking counts as on v2.101.4"
//     (no comment stripping)         "AC-.7 both homes: commented ## Verification heading still refuses"
//   - recognised-key test         -> "AC-.13 prose-only ## Verification and ## Docs beside a settings file load settings"
//   - stub-slot exemption         -> "AC-.14 a stub slot holding a different mode and team loads settings values"
//   - floor check                 -> "AC-.8 a floor above the running toolkit refuses"
//   - mode-only read of `mode`    -> "AC-.10 mode verb: legacy Linear with a malformed tracker-config prints mode: linear"
//                                    "AC-.10 mode verb: legacy Linear whose ### Linear refuses prints mode: linear"
//   - section isolation           -> "AC-.19 isolation: malformed <section> refuses only <section>"
//   - lazy status_vocabulary      -> "AC-.19 isolation: malformed tracker-config throws only at status_vocabulary"
//   - stub marker line            -> "AC-.15 stub render: <case> is byte-equal to the pinned string"
//
// AC-STE-706.18 is the full-suite gate (`bun test` from plugins/dev-process-toolkit
// reports 0 failures, skip identities equal to trunk by name). It is graded by
// the gate run, not by a test in this file.
//
// All ids, teams, projects and tags are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildResolverConfig, readTaskTrackingSection } from "../adapters/_shared/src/resolver_config";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";
import { readVerificationConfig } from "../adapters/_shared/src/verification_config";
import { readDocsConfig } from "../adapters/_shared/src/docs_config";
import { readOrchestrationConfig } from "../adapters/_shared/src/orchestration_config";
import { readTokenStatsConfig } from "../adapters/_shared/src/token_stats_config";
import { readMilestoneScanFetch } from "../adapters/_shared/src/milestone_scan_fetch_config";
import { MissingReleaseFilesBlockError, parseReleaseFiles } from "../adapters/_shared/src/release_config";
import { readTrackerConfig } from "../adapters/_shared/src/tracker_config";
import { parseVideoConfig } from "../adapters/_shared/src/video/config";
import { parseVideoStyle, VIDEO_STYLE_DEFAULTS } from "../adapters/_shared/src/video/style";

const PLUGIN = resolve(import.meta.dir, "..");
const SRC = join(PLUGIN, "adapters", "_shared", "src");
const MOD_PATH = join(SRC, "project_settings.ts");
const ADAPTERS_DIR = join(PLUGIN, "adapters");
const DOCS_DIR = join(PLUGIN, "docs");

// ---------------------------------------------------------------------------
// Module loading — dynamic, so each test reds on its own while the module is
// absent instead of the whole file failing to load.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMod = any;
let loaded: AnyMod = null;
let loadError: unknown = null;
try {
  loaded = await import(MOD_PATH);
} catch (e) {
  loadError = e;
}
function M(): AnyMod {
  if (!loaded) {
    throw new Error(`project_settings.ts is not loadable: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste706-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

/** Block-style top level, JSON flow values (valid YAML), so every top-level key sits at column 0. */
function toSettingsYaml(obj: Record<string, unknown>): string {
  return `${Object.entries(obj)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n`;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): Record<string, unknown> {
  const parts = dotted.split(".");
  let cur: Record<string, unknown> = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return obj;
}

function deletePath(obj: Record<string, unknown>, dotted: string): Record<string, unknown> {
  const parts = dotted.split(".");
  let cur: Record<string, unknown> = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  delete cur[parts[parts.length - 1]!];
  return obj;
}

function snake(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  return out;
}

function defined(rec: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec ?? {})) if (v !== undefined) out[k] = v;
  return out;
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw, got a return");
}

const STATUS_VOCAB_LINEAR = {
  tracker_key: "linear",
  statuses: ["Todo", "In Progress", "In Review", "Done"],
  roles: { initial: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done" },
};

const VIDEO_CONFIG = {
  tts: { provider: "elevenlabs", voice: "SynthVoice" },
  recorder: { kind: "web" },
  music: { source: "none" },
};

/** The full Linear settings fixture (synthetic values, floor under the running 2.x toolkit). */
const BASE: Record<string, unknown> = {
  schema_version: 1,
  min_dpt_version: "2.0.0",
  task_tracking: {
    mode: "linear",
    mcp_server: "linear",
    jira_ac_field: "",
    branch_template: "{type}/m{N}-{slug}",
    milestone_scan_fetch: false,
    linear: {
      team: "SYN",
      project: "Synthetic Project",
      default_labels: [],
      linear_bug_label: "Bug",
    },
    status_vocabulary: STATUS_VOCAB_LINEAR,
  },
  verification: { verify_skill: "smoke-test", verify_mode: "manual", run_cmd: "none", e2e_cmd: "none" },
  docs: { user_facing_mode: false, packages_mode: false, changelog_ci_owned: false, changelog_unversioned: false },
  orchestration: { default_effort: "ultracode", merge_policy: "offer" },
  tracking: { token_stats: { enabled: false } },
  close_out: { upgrade_offer: { enabled: false } },
  release: { files: [{ path: "package.json", kind: "json", field: "version" }] },
  video: { config: VIDEO_CONFIG, style: {} },
};

/** A shared-container Jira settings fixture with a secondary tracker. */
const JIRA_BASE: Record<string, unknown> = (() => {
  const b = clone(BASE);
  b.task_tracking = {
    mode: "jira",
    mcp_server: "atlassian",
    jira_ac_field: "customfield_10001",
    branch_template: "{type}/{ticket-id}-{slug}",
    secondary_tracker: "linear",
    milestone_scan_fetch: true,
    jira: {
      project: "SYN",
      default_labels: ["syn-be"],
      repo_tag: "syn-be",
      min_dpt_version: "2.90.0",
      jira_bug_issue_type: "Defect",
      jira_issue_type: "Task",
    },
    status_vocabulary: { ...STATUS_VOCAB_LINEAR, tracker_key: "jira" },
  };
  return b;
})();

const CUSTOM_BASE: Record<string, unknown> = (() => {
  const b = clone(BASE);
  b.task_tracking = { mode: "github", mcp_server: "github" };
  return b;
})();

const NONE_BASE: Record<string, unknown> = (() => {
  const b = clone(BASE);
  b.task_tracking = { mode: "none" };
  return b;
})();

function settingsTree(obj: Record<string, unknown>, extra: Record<string, string> = {}): string {
  return tree({ "specs/settings.yaml": toSettingsYaml(obj), ...extra });
}

// Legacy CLAUDE.md snippets ---------------------------------------------------

const LEGACY_LINEAR_MD = [
  "# Synthetic Project",
  "",
  "## Task Tracking",
  "",
  "mode: linear",
  "mcp_server: linear",
  "jira_ac_field:",
  "branch_template: {type}/m{N}-{slug}",
  "",
  "### Linear",
  "",
  "team: SYN",
  "project: Synthetic Project",
  "default_labels: [synth]",
  "linear_bug_label: Defect",
  "",
  "## Testing Conventions",
  "",
  "- Layout: tests/ mirrors src/",
  "",
].join("\n");

const TRACKER_CONFIG_YAML = [
  "tracker_key: linear",
  "statuses:",
  "  - Todo",
  "  - In Progress",
  "  - In Review",
  "  - Done",
  "roles:",
  "  initial: Todo",
  "  in_progress: In Progress",
  "  in_review: In Review",
  "  done: Done",
  "",
].join("\n");

const MALFORMED_TRACKER_CONFIG_YAML = "tracker_key: linear\nstatuses: []\nroles: {}\n";

const RELEASE_BLOCK = [
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: package.json",
  "    kind: json",
  "    field: version",
  "  - path: CHANGELOG.md",
  "    kind: changelog",
  "```",
  "",
].join("\n");

const VIDEO_CONFIG_YAML = "tts:\n  provider: google\n  voice: en-US-Synth\nrecorder:\n  kind: footage\nmusic:\n  source: none\n";
const VIDEO_STYLE_YAML = "music:\n  level_db: -18\nhumor: none\n";

const MARKER = "<!-- Generated from specs/settings.yaml for older plugins. Edit that file, not this block. -->";

// Legacy parity: compare every section the loader returns with the v2.101.4 readers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expectLegacyParity(root: string, s: any): void {
  const md = join(root, "CLAUDE.md");
  const section = readTaskTrackingSection(md);
  expect(s.task_tracking.mode).toBe(section.mode ?? "none");
  for (const k of ["mcp_server", "jira_ac_field", "branch_template", "secondary_tracker"]) {
    if (section[k] !== undefined) expect(s.task_tracking[k]).toBe(section[k]);
  }
  expect(s.task_tracking.milestone_scan_fetch).toBe(readMilestoneScanFetch(md));
  for (const adapter of ["linear", "jira"] as const) {
    if (section.mode === adapter) {
      const { shared: _shared, ...binding } = readWorkspaceBinding(md, adapter);
      expect(defined(s.task_tracking[adapter])).toEqual(snake(binding));
    }
  }
  expect(s.task_tracking.status_vocabulary ?? null).toEqual(readTrackerConfig(join(root, "specs")));
  expect(s.verification).toEqual(snake(readVerificationConfig(md) as unknown as Record<string, unknown>));
  expect(s.docs).toEqual(snake(readDocsConfig(md) as unknown as Record<string, unknown>));
  expect(s.orchestration).toEqual(snake(readOrchestrationConfig(root) as unknown as Record<string, unknown>));
  expect(s.tracking.token_stats).toEqual(readTokenStatsConfig(md));
  expect(s.close_out.upgrade_offer.enabled).toBe(false);
  let files: unknown[] = [];
  if (existsSync(md)) {
    try {
      files = parseReleaseFiles(readFileSync(md, "utf8"));
    } catch (e) {
      if (!(e instanceof MissingReleaseFilesBlockError)) throw e;
    }
  }
  expect(s.release.files).toEqual(files);
  const vc = join(root, ".dpt", "video", "config.yaml");
  if (existsSync(vc)) expect(s.video.config).toEqual(parseVideoConfig(readFileSync(vc, "utf8")));
  const vs = join(root, ".dpt", "video", "style.yaml");
  if (existsSync(vs)) expect(s.video.style).toEqual(parseVideoStyle(readFileSync(vs, "utf8")));
}

function runFrontDoor(...args: string[]): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync([process.execPath, "run", MOD_PATH, ...args], { cwd: PLUGIN, env: { ...process.env } });
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

// ===========================================================================
// AC-STE-706.1 — exports
// ===========================================================================

describe("AC-STE-706.1 exports", () => {
  test("AC-.1 module exports the named surface", () => {
    const m = M();
    expect(m.SETTINGS_FILE).toBe("specs/settings.yaml");
    for (const fn of [
      "detectSettingsSource",
      "loadProjectSettings",
      "loadProjectSection",
      "renderSettingsPointer",
      "renderTrackingStub",
      "isForeignSettingsFile",
    ]) {
      expect(typeof m[fn]).toBe("function");
    }
    expect(typeof m.SettingsShapeError).toBe("function");
    expect(new m.SettingsShapeError("x", "y", "z")).toBeInstanceOf(Error);
    expect(Array.isArray(m.NEW_KEYS)).toBe(true);
  });

  test("AC-.1 loadProjectSettings returns { source, settings } for a settings tree", () => {
    const r = M().loadProjectSettings(settingsTree(BASE));
    expect(r.source).toBe("settings");
    expect(r.settings.task_tracking.mode).toBe("linear");
    expect(r.settings.verification).toEqual(BASE.verification);
    expect(r.settings.docs).toEqual(BASE.docs);
    expect(r.settings.orchestration).toEqual(BASE.orchestration);
    // Amended by AC-STE-715.21 (M_7bc805): absent new tracking keys read their default.; Amended by AC-STE-716.24 (M_7bc805): tool_calls too.
    expect(r.settings.tracking).toEqual({ ...(BASE.tracking as Record<string, unknown>), gate_outcomes: { enabled: false }, tool_calls: { enabled: false } });
    expect(r.settings.close_out).toEqual(BASE.close_out);
    expect(r.settings.release).toEqual(BASE.release);
    expect(r.settings.task_tracking.linear).toEqual((BASE.task_tracking as Record<string, unknown>).linear);
    expect(r.settings.task_tracking.status_vocabulary).toEqual(STATUS_VOCAB_LINEAR);
    expect(r.settings.video.config).toEqual(VIDEO_CONFIG);
    expect(r.settings.video.style).toEqual(VIDEO_STYLE_DEFAULTS);
  });

  test("AC-.1 renderSettingsPointer names the settings file and the floor", () => {
    const out = M().renderSettingsPointer("3.0.0");
    expect(typeof out).toBe("string");
    expect(out).toContain("specs/settings.yaml");
    expect(out).toContain("3.0.0");
  });
});

// ===========================================================================
// AC-STE-706.2 — closed sets
// ===========================================================================

describe("AC-STE-706.2 closed key sets", () => {
  const UNKNOWN_KEY_ROWS: Array<[string, string]> = [
    ["top level", "bogus_top"],
    ["task_tracking", "task_tracking.bogus_tt"],
    ["task_tracking.linear", "task_tracking.linear.bogus_lin"],
    ["task_tracking.jira", "task_tracking.jira.bogus_jira"],
    ["task_tracking.status_vocabulary", "task_tracking.status_vocabulary.bogus_sv"],
    ["verification", "verification.bogus_ver"],
    ["docs", "docs.bogus_docs"],
    ["orchestration", "orchestration.bogus_orch"],
    ["tracking", "tracking.bogus_tracking"],
    ["tracking.token_stats", "tracking.token_stats.bogus_ts"],
    ["close_out", "close_out.bogus_close"],
    ["close_out.upgrade_offer", "close_out.upgrade_offer.bogus_uo"],
    ["release", "release.bogus_rel"],
    ["video", "video.bogus_video"],
  ];
  for (const [name, path] of UNKNOWN_KEY_ROWS) {
    test(`AC-.2 unknown key in ${name} refuses naming the file and ${path}`, () => {
      const obj = setPath(clone(BASE), path, "x");
      const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
      expect(err).toBeInstanceOf(M().SettingsShapeError);
      expect(err.message).toContain("specs/settings.yaml");
      expect(err.message).toContain(path);
      expect(err.message).toMatch(/\nRemedy: /);
      expect(err.message).toMatch(/\nContext: /);
    });
  }

  test("AC-.2 unknown key in a release.files entry refuses", () => {
    const obj = clone(BASE);
    (obj.release as { files: Record<string, unknown>[] }).files[0]!.bogus_entry = "x";
    const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
    expect(err).toBeInstanceOf(M().SettingsShapeError);
    expect(err.message).toContain("specs/settings.yaml");
    expect(err.message).toContain("release.files");
    expect(err.message).toContain("bogus_entry");
  });

  test("AC-.2 unknown key in video.config refuses through the settings file", () => {
    const obj = setPath(clone(BASE), "video.config.bogus_vc", "x");
    const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
    expect(err).toBeInstanceOf(M().SettingsShapeError);
    expect(err.message).toContain("specs/settings.yaml");
    expect(err.message).toContain("bogus_vc");
  });

  test("AC-.2 unknown key in video.style refuses through the settings file", () => {
    const obj = setPath(clone(BASE), "video.style.bogus_vs", "x");
    const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
    expect(err).toBeInstanceOf(M().SettingsShapeError);
    expect(err.message).toContain("specs/settings.yaml");
    expect(err.message).toContain("bogus_vs");
  });

  const WRONG_TYPE_ROWS: Array<[string, unknown]> = [
    ["task_tracking.mode", 7],
    ["task_tracking.milestone_scan_fetch", "true"],
    ["task_tracking.linear.default_labels", "synth"],
    ["verification.verify_mode", "loud"],
    ["docs.user_facing_mode", "yes"],
    ["orchestration.merge_policy", "sometimes"],
    ["orchestration.default_effort", "extreme"],
    ["tracking.token_stats.enabled", "true"],
    ["close_out.upgrade_offer.enabled", "on"],
    ["release.files", "package.json"],
    ["release.files.0.kind", "xml"],
  ];
  for (const [path, value] of WRONG_TYPE_ROWS) {
    test(`AC-.2 wrong type at ${path} refuses naming the key path`, () => {
      const obj = clone(BASE);
      if (path.startsWith("release.files.0.")) {
        (obj.release as { files: Record<string, unknown>[] }).files[0]!.kind = value;
      } else {
        setPath(obj, path, value);
      }
      const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
      expect(err).toBeInstanceOf(M().SettingsShapeError);
      expect(err.message).toContain("specs/settings.yaml");
      expect(err.message).toContain(path.startsWith("release.files.0.") ? "release.files" : path);
    });
  }

  test("AC-.2 missing schema_version refuses", () => {
    const err = thrown(() => M().loadProjectSettings(settingsTree(deletePath(clone(BASE), "schema_version"))));
    expect(err).toBeInstanceOf(M().SettingsShapeError);
    expect(err.message).toContain("schema_version");
    expect(err.message).toContain("specs/settings.yaml");
  });

  test("AC-.2 schema_version other than 1 refuses", () => {
    const err = thrown(() => M().loadProjectSettings(settingsTree(setPath(clone(BASE), "schema_version", 2))));
    expect(err).toBeInstanceOf(M().SettingsShapeError);
    expect(err.message).toContain("schema_version");
  });

  test("AC-.2 the full Jira variant (secondary_tracker, jira sub-map, jira_issue_type) is accepted", () => {
    const r = M().loadProjectSettings(settingsTree(JIRA_BASE));
    expect(r.source).toBe("settings");
    const tt = JIRA_BASE.task_tracking as Record<string, unknown>;
    expect(r.settings.task_tracking.mode).toBe("jira");
    expect(r.settings.task_tracking.secondary_tracker).toBe("linear");
    expect(r.settings.task_tracking.milestone_scan_fetch).toBe(true);
    expect(r.settings.task_tracking.jira_ac_field).toBe("customfield_10001");
    expect(r.settings.task_tracking.jira).toEqual(tt.jira);
  });

  test("AC-.2 both adapter sub-maps may be present (v2.101.4 tolerates an inactive one)", () => {
    const obj = clone(BASE);
    setPath(obj, "task_tracking.jira", { project: "SYN2" });
    const r = M().loadProjectSettings(settingsTree(obj));
    expect(r.settings.task_tracking.jira).toEqual({ project: "SYN2" });
    expect(r.settings.task_tracking.linear.team).toBe("SYN");
  });
});

// ===========================================================================
// AC-STE-706.3 — delegated validators
// ===========================================================================

describe("AC-STE-706.3 delegated validators", () => {
  test("AC-.3 status_vocabulary is validated by validateTrackerConfig", () => {
    const obj = setPath(clone(BASE), "task_tracking.status_vocabulary.roles.done", "Shipped");
    const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
    // validateTrackerConfig's own wording for a role outside `statuses:`
    expect(err.message).toContain("does not appear in `statuses:`");
  });

  test("AC-.3 video.config is validated by parseVideoConfig", () => {
    const obj = setPath(clone(BASE), "video.config.tts.provider", "synthvoice-co");
    const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
    // parseVideoConfig's own refusal names the key path `tts.provider`
    expect(err.message).toContain("tts.provider");
  });

  test("AC-.3 video.style is validated by parseVideoStyle", () => {
    const obj = setPath(clone(BASE), "video.style.captions", { enabled: "yes" });
    const err = thrown(() => M().loadProjectSettings(settingsTree(obj)));
    expect(err.message).toContain("captions.enabled");
  });

  test("AC-.3 the loader source delegates instead of copying the rules", () => {
    const sources = ["project_settings.ts", "project_settings_legacy.ts"]
      .map((f) => join(SRC, f))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    expect(existsSync(MOD_PATH)).toBe(true);
    expect(sources).toMatch(/\bvalidateTrackerConfig\(/);
    expect(sources).toMatch(/\bparseVideoConfig\(/);
    expect(sources).toMatch(/\bparseVideoStyle\(/);
    // no second copy of the tracker-config role rule or the video enums
    expect(sources).not.toContain("does not appear in `statuses:`");
    expect(sources).not.toMatch(/"ios-sim"\s*,\s*"android-emu"/);
  });
});

// ===========================================================================
// AC-STE-706.4 — legacy parity
// ===========================================================================

describe("AC-STE-706.4 legacy parity", () => {
  const ROWS: Array<[string, Record<string, string>]> = [
    ["resolver_config / workspace_binding: Linear tree", { "CLAUDE.md": LEGACY_LINEAR_MD }],
    [
      "workspace_binding: shared Jira container",
      {
        "CLAUDE.md": [
          "## Task Tracking",
          "",
          "mode: jira",
          "mcp_server: atlassian",
          "jira_ac_field: customfield_10001",
          "",
          "### Jira",
          "",
          "project: SYN",
          "default_labels: [syn-be, extra]",
          "repo_tag: syn-be",
          "min_dpt_version: 2.90.0",
          "jira_bug_issue_type: Defect",
          "",
        ].join("\n"),
      },
    ],
    [
      "verification_config: full section",
      { "CLAUDE.md": "# P\n\n## Verification\n\nverify_skill: smoke-test\nverify_mode: manual\nrun_cmd: none\ne2e_cmd: bun run e2e\n" },
    ],
    ["verification_config: bare run_cmd", { "CLAUDE.md": "## Verification\n\nrun_cmd:\n" }],
    [
      "docs_config: all true",
      { "CLAUDE.md": "## Docs\n\nuser_facing_mode: true\npackages_mode: true\nchangelog_ci_owned: true\nchangelog_unversioned: true\n" },
    ],
    ["docs_config: CRLF file", { "CLAUDE.md": "## Docs\r\n\r\nuser_facing_mode: true\r\npackages_mode: false\r\n" }],
    ["orchestration_config: non-default", { "CLAUDE.md": "## Orchestration\n\ndefault_effort: high\nmerge_policy: auto\n" }],
    ["token_stats_config: enabled", { "CLAUDE.md": "## Token Stats\n\nenabled: true\n" }],
    ["milestone_scan_fetch_config: true", { "CLAUDE.md": "# P\n\nmilestone_scan_fetch: true\n" }],
    ["milestone_scan_fetch_config: yes reads false", { "CLAUDE.md": "# P\n\nmilestone_scan_fetch: yes\n" }],
    ["release_config: two entries", { "CLAUDE.md": `# P\n\n${RELEASE_BLOCK}` }],
    ["tracker_config: status vocabulary only", { "specs/tracker-config.yaml": TRACKER_CONFIG_YAML }],
    [
      "tracker_config beside a Linear CLAUDE.md",
      { "CLAUDE.md": LEGACY_LINEAR_MD, "specs/tracker-config.yaml": TRACKER_CONFIG_YAML },
    ],
    ["video config only", { ".dpt/video/config.yaml": VIDEO_CONFIG_YAML }],
    ["video style only", { ".dpt/video/style.yaml": VIDEO_STYLE_YAML }],
  ];
  for (const [name, files] of ROWS) {
    test(`AC-.4 parity: ${name}`, () => {
      const root = tree(files);
      const r = M().loadProjectSettings(root);
      expect(r.source).toBe("legacy");
      expect(M().detectSettingsSource(root)).toBe("legacy"); // AC-.16
      expectLegacyParity(root, r.settings);
    });
  }

  test("AC-.4 parity: secondary_tracker: jira reads through and buildResolverConfig lists both trackers", () => {
    const md = LEGACY_LINEAR_MD.replace("mcp_server: linear", "mcp_server: linear\nsecondary_tracker: jira");
    const root = tree({ "CLAUDE.md": md });
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("legacy");
    expect(r.settings.task_tracking.secondary_tracker).toBe("jira");
    const resolver = buildResolverConfig(join(root, "CLAUDE.md"), ADAPTERS_DIR);
    expect(resolver.trackers.map((t) => t.key)).toEqual(["linear", "jira"]);
    expectLegacyParity(root, r.settings);
  });
});

// ===========================================================================
// AC-STE-706.5 — HTML comments, per reader
// ===========================================================================

describe("AC-STE-706.5 HTML comments", () => {
  test("AC-.5 a commented ## Task Tracking counts as on v2.101.4", () => {
    const root = tree({ "CLAUDE.md": "# P\n\n<!--\n## Task Tracking\n\nmode: linear\n-->\n" });
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("legacy");
    expect(r.settings.task_tracking.mode).toBe("linear");
    const md = join(root, "CLAUDE.md");
    expect(r.settings.task_tracking.mode).toBe(readTaskTrackingSection(md).mode);
    expect(buildResolverConfig(md, ADAPTERS_DIR).trackers.map((t) => t.key)).toEqual(["linear"]);
    expect(M().detectSettingsSource(root)).toBe("legacy");
  });

  for (const [name, layout] of [
    ["commented", "<!-- - Layout: tests/ mirrors src/ -->"],
    ["live", "- Layout: tests/ mirrors src/"],
  ] as const) {
    test(`AC-.5 a ${name} Layout: line under ## Testing Conventions is not a legacy home`, () => {
      const root = tree({ "CLAUDE.md": `# P\n\n## Testing Conventions\n\n${layout}\n` });
      const r = M().loadProjectSettings(root);
      expect(r.source).toBe("none");
      expect(M().detectSettingsSource(root)).toBe("none");
      expect(r.settings.testing).toBeUndefined();
    });
  }

  test("AC-.5 detectLayout keeps reading the Layout: bullet from CLAUDE.md", () => {
    const src = readFileSync(join(SRC, "bun_zero_match_placeholder.ts"), "utf8");
    expect(src).toContain('detectLayout(join(projectRoot, "CLAUDE.md"))');
    expect(src).not.toContain("project_settings");
  });
});

// ===========================================================================
// AC-STE-706.6 — defaults
// ===========================================================================

describe("AC-STE-706.6 defaults", () => {
  for (const [name, files] of [
    ["empty tree", {}],
    ["prose-only CLAUDE.md", { "CLAUDE.md": "# P\n\n## Key Commands\n\n- bun test\n" }],
  ] as const) {
    test(`AC-.6 ${name} loads source none with documented defaults`, () => {
      const root = tree(files as Record<string, string>);
      const r = M().loadProjectSettings(root);
      expect(r.source).toBe("none");
      expect(M().detectSettingsSource(root)).toBe("none");
      expect(r.settings.task_tracking.mode).toBe("none");
      expect(r.settings.tracking.token_stats.enabled).toBe(false);
      expect(r.settings.close_out.upgrade_offer.enabled).toBe(false);
      expect(r.settings.orchestration).toEqual({ default_effort: "ultracode", merge_policy: "offer" });
      expect(r.settings.docs).toEqual({
        user_facing_mode: false,
        packages_mode: false,
        changelog_ci_owned: false,
        changelog_unversioned: false,
      });
      expect(r.settings.release.files).toEqual([]);
    });
  }

  test("AC-.6 a legacy tree reads close_out.upgrade_offer.enabled as false", () => {
    const r = M().loadProjectSettings(tree({ "CLAUDE.md": LEGACY_LINEAR_MD }));
    expect(r.source).toBe("legacy");
    expect(r.settings.close_out.upgrade_offer.enabled).toBe(false);
  });

  test("AC-.6 a settings file without close_out reads upgrade_offer off", () => {
    const r = M().loadProjectSettings(settingsTree(deletePath(clone(BASE), "close_out")));
    expect(r.source).toBe("settings");
    expect(r.settings.close_out.upgrade_offer.enabled).toBe(false);
  });
});

// ===========================================================================
// AC-STE-706.7 / .16 — both homes, foreign files
// ===========================================================================

describe("AC-STE-706.7 both homes", () => {
  const BOTH_ROWS: Array<[string, Record<string, string>, string]> = [
    ["## Verification", { "CLAUDE.md": "# P\n\n## Verification\n\nverify_mode: manual\n" }, "CLAUDE.md"],
    ["## Docs", { "CLAUDE.md": "# P\n\n## Docs\n\nuser_facing_mode: false\n" }, "CLAUDE.md"],
    ["## Orchestration", { "CLAUDE.md": "# P\n\n## Orchestration\n\nmerge_policy: offer\n" }, "CLAUDE.md"],
    ["## Token Stats", { "CLAUDE.md": "# P\n\n## Token Stats\n\nenabled: false\n" }, "CLAUDE.md"],
    ["## Release Files", { "CLAUDE.md": `# P\n\n${RELEASE_BLOCK}` }, "CLAUDE.md"],
    ["milestone_scan_fetch: false", { "CLAUDE.md": "# P\n\nmilestone_scan_fetch: false\n" }, "CLAUDE.md"],
    ["milestone_scan_fetch: yes", { "CLAUDE.md": "# P\n\nmilestone_scan_fetch: yes\n" }, "CLAUDE.md"],
    ["specs/tracker-config.yaml", { "specs/tracker-config.yaml": TRACKER_CONFIG_YAML }, "specs/tracker-config.yaml"],
    [".dpt/video/config.yaml", { ".dpt/video/config.yaml": VIDEO_CONFIG_YAML }, ".dpt/video/config.yaml"],
    [".dpt/video/style.yaml", { ".dpt/video/style.yaml": VIDEO_STYLE_YAML }, ".dpt/video/style.yaml"],
  ];
  for (const [kind, extra, legacyPath] of BOTH_ROWS) {
    test(`AC-.7 both homes: ${kind} refuses naming both paths`, () => {
      const root = settingsTree(BASE, extra);
      const err = thrown(() => M().loadProjectSettings(root));
      expect(err).toBeInstanceOf(M().SettingsShapeError);
      expect(err.message).toContain("specs/settings.yaml");
      expect(err.message).toContain(legacyPath);
      expect(err.message).toContain("/dev-process-toolkit:upgrade");
      expect(err.message).toMatch(/\nRemedy: /);
      // AC-.16: detection never throws and reports both
      expect(M().detectSettingsSource(root)).toBe("both");
    });
  }

  test("AC-.7 both homes: commented ## Verification heading still refuses", () => {
    const root = settingsTree(BASE, { "CLAUDE.md": "# P\n\n<!--\n## Verification\n\nverify_mode: manual\n-->\n" });
    expect(() => M().loadProjectSettings(root)).toThrow(M().SettingsShapeError);
    expect(M().detectSettingsSource(root)).toBe("both");
  });

  test("AC-.7 both homes: section isolation does not bypass the refusal", () => {
    const root = settingsTree(BASE, { "CLAUDE.md": "# P\n\n## Docs\n\npackages_mode: true\n" });
    expect(() => M().loadProjectSection(root, "verification")).toThrow(M().SettingsShapeError);
  });

  for (const [name, layout] of [
    ["live", "- Layout: tests/ mirrors src/"],
    ["commented", "<!-- - Layout: tests/ mirrors src/ -->"],
  ] as const) {
    test(`AC-.7 a settings file beside a ${name} Layout: line loads settings`, () => {
      const root = settingsTree(BASE, { "CLAUDE.md": `# P\n\n## Testing Conventions\n\n${layout}\n` });
      const r = M().loadProjectSettings(root);
      expect(r.source).toBe("settings");
      expect(M().detectSettingsSource(root)).toBe("settings");
    });
  }
});

describe("AC-STE-706.7 foreign settings files", () => {
  const OPENAPI = "openapi: 3.0.0\ninfo:\n  title: Synthetic API\n  version: 1.0.0\npaths: {}\n";

  test("AC-.7 foreign: OpenAPI file beside a legacy Linear CLAUDE.md loads legacy", () => {
    const root = tree({ "specs/settings.yaml": OPENAPI, "CLAUDE.md": LEGACY_LINEAR_MD });
    expect(M().isForeignSettingsFile(root)).toBe(true);
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("legacy");
    expect(M().detectSettingsSource(root)).toBe("legacy");
    expectLegacyParity(root, r.settings);
  });

  test("AC-.7 foreign: OpenAPI file alone loads none", () => {
    const root = tree({ "specs/settings.yaml": OPENAPI });
    expect(M().isForeignSettingsFile(root)).toBe(true);
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("none");
    expect(M().detectSettingsSource(root)).toBe("none");
  });

  test("AC-.7 foreign: an indented schema_version line is still foreign", () => {
    const root = tree({ "specs/settings.yaml": "info:\n  schema_version: 1\n  min_dpt_version: 3.0.0\n" });
    expect(M().isForeignSettingsFile(root)).toBe(true);
    expect(M().loadProjectSettings(root).source).toBe("none");
  });

  test("AC-.7 foreign: an unparseable foreign file never throws", () => {
    const root = tree({ "specs/settings.yaml": "{{{ not: [yaml\n" });
    expect(M().isForeignSettingsFile(root)).toBe(true);
    expect(M().detectSettingsSource(root)).toBe("none");
    expect(M().loadProjectSettings(root).source).toBe("none");
  });

  test("AC-.7 a toolkit settings file is not foreign", () => {
    expect(M().isForeignSettingsFile(settingsTree(BASE))).toBe(false);
  });

  test("AC-.7 a file with only min_dpt_version at column 0 is a settings file and refuses its bad shape", () => {
    const root = tree({ "specs/settings.yaml": "min_dpt_version: 2.0.0\n" });
    expect(M().isForeignSettingsFile(root)).toBe(false);
    expect(() => M().loadProjectSettings(root)).toThrow(M().SettingsShapeError);
  });

  test("AC-.7 schema_version: 1 plus an unknown key still refuses", () => {
    const root = tree({ "specs/settings.yaml": "schema_version: 1\nmin_dpt_version: 2.0.0\nbogus_key: 1\n" });
    expect(M().isForeignSettingsFile(root)).toBe(false);
    expect(() => M().loadProjectSettings(root)).toThrow(M().SettingsShapeError);
  });

  test("AC-.7 mode verb on a foreign file beside legacy Linear: two stdout lines, warn note on stderr, exit 0", () => {
    const root = tree({ "specs/settings.yaml": OPENAPI, "CLAUDE.md": LEGACY_LINEAR_MD });
    const r = runFrontDoor("mode", root);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toEqual(["mode: linear", "source: legacy"]);
    expect(r.stderr).toContain("note: specs/settings.yaml ignored: not a toolkit settings file");
  });

  test("AC-.7 mode verb on a foreign file alone: none/none, warn note, exit 0", () => {
    const root = tree({ "specs/settings.yaml": OPENAPI });
    const r = runFrontDoor("mode", root);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toEqual(["mode: none", "source: none"]);
    expect(r.stderr).toContain("note: specs/settings.yaml ignored: not a toolkit settings file");
  });
});

// ===========================================================================
// AC-STE-706.8 — floor
// ===========================================================================

describe("AC-STE-706.8 floor", () => {
  test("AC-.8 a settings file without min_dpt_version refuses", () => {
    // A migrated tree (the pointer line under ## Project Settings): on any other tree a file with no
    // column-0 min_dpt_version is the project's own and is ignored (review round 3, R3-B1).
    const md = `# Synthetic Project\n\n## Project Settings\n\n${M().renderSettingsPointer("3.0.0")}`;
    const err = thrown(() => M().loadProjectSettings(settingsTree(deletePath(clone(BASE), "min_dpt_version"), { "CLAUDE.md": md })));
    expect(err).toBeInstanceOf(M().SettingsShapeError);
    expect(err.message).toContain("min_dpt_version");
  });

  for (const bad of ["3.0", "v3.0.0", "3.0.0-rc.1", "three"]) {
    test(`AC-.8 a non-strict floor "${bad}" refuses`, () => {
      const err = thrown(() => M().loadProjectSettings(settingsTree(setPath(clone(BASE), "min_dpt_version", bad))));
      expect(err).toBeInstanceOf(M().SettingsShapeError);
      expect(err.message).toContain("min_dpt_version");
    });
  }

  test("AC-.8 a floor above the running toolkit refuses", () => {
    const err = thrown(() => M().loadProjectSettings(settingsTree(setPath(clone(BASE), "min_dpt_version", "99.0.0"))));
    expect(err.message).toContain("99.0.0");
    expect(err.message).toMatch(/\nRemedy: /);
  });

  test("AC-.8 the floor check goes through checkVersionFloor and runningDptVersion", () => {
    const src = readFileSync(MOD_PATH, "utf8");
    expect(src).toMatch(/\bcheckVersionFloor\(/);
    expect(src).toMatch(/\brunningDptVersion\(/);
  });
});

// ===========================================================================
// AC-STE-706.9 — purity
// ===========================================================================

describe("AC-STE-706.9 purity", () => {
  function moduleSources(): Array<[string, string]> {
    expect(existsSync(MOD_PATH)).toBe(true);
    return ["project_settings.ts", "project_settings_legacy.ts"]
      .map((f) => join(SRC, f))
      .filter((p) => existsSync(p))
      .map((p) => [p, readFileSync(p, "utf8")] as [string, string]);
  }

  test("AC-.9 the source names none of the never-moved surfaces", () => {
    for (const [, src] of moduleSources()) {
      expect(src).not.toContain(".dpt/.env");
      expect(src).not.toContain(".claude/settings.json");
      expect(src).not.toContain("tracker_write_gate");
    }
  });

  test("AC-.9 the source spawns nothing, fetches nothing, writes nothing and is synchronous", () => {
    for (const [, src] of moduleSources()) {
      expect(src).not.toMatch(/child_process|Bun\.spawn|\bexecSync\b|\bspawnSync\b/);
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toMatch(/\b(writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|Bun\.write)\b/);
      expect(src).not.toMatch(/\basync\s+function\b|\bawait\s/);
    }
  });

  test("AC-.9 loading a tree writes nothing into it", () => {
    const root = tree({ "CLAUDE.md": LEGACY_LINEAR_MD });
    const before = readFileSync(join(root, "CLAUDE.md"), "utf8");
    M().loadProjectSettings(root);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(before);
    expect(existsSync(join(root, "specs", "settings.yaml"))).toBe(false);
  });
});

// ===========================================================================
// AC-STE-706.10 — front door
// ===========================================================================

describe("AC-STE-706.10 front door", () => {
  test("AC-.10 mode verb on a settings tree prints exactly two lines and exits 0", () => {
    const r = runFrontDoor("mode", settingsTree(BASE));
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toEqual(["mode: linear", "source: settings"]);
  });

  test("AC-.10 mode verb on an empty tree prints mode: none / source: none", () => {
    const r = runFrontDoor("mode", tree({}));
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toEqual(["mode: none", "source: none"]);
  });

  test("AC-.10 get verification prints the section as JSON", () => {
    const r = runFrontDoor("get", "verification", settingsTree(BASE));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(BASE.verification);
  });

  test("AC-.10 get orchestration on a legacy tree prints the legacy value", () => {
    const root = tree({ "CLAUDE.md": "## Orchestration\n\ndefault_effort: high\nmerge_policy: auto\n" });
    const r = runFrontDoor("get", "orchestration", root);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ default_effort: "high", merge_policy: "auto" });
  });

  test("AC-.10 a refusal exits non-zero with the NFR-10 message on stderr and nothing on stdout", () => {
    const root = settingsTree(BASE, { "CLAUDE.md": "# P\n\n## Docs\n\nuser_facing_mode: true\n" });
    const r = runFrontDoor("mode", root);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Remedy:");
    expect(r.stderr).toContain("/dev-process-toolkit:upgrade");
  });

  test("AC-.10 mode verb: legacy Linear with a malformed tracker-config prints mode: linear", () => {
    const root = tree({ "CLAUDE.md": LEGACY_LINEAR_MD, "specs/tracker-config.yaml": MALFORMED_TRACKER_CONFIG_YAML });
    const r = runFrontDoor("mode", root);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toEqual(["mode: linear", "source: legacy"]);
  });

  test("AC-.10 mode verb: legacy Linear whose ### Linear refuses prints mode: linear", () => {
    const md = LEGACY_LINEAR_MD.replace("team: SYN", "team: SYN\nrepo_tag: BAD_TAG");
    const root = tree({ "CLAUDE.md": md });
    // control: the v2.101.4 binding reader refuses these bytes
    expect(() => readWorkspaceBinding(join(root, "CLAUDE.md"), "linear")).toThrow();
    const r = runFrontDoor("mode", root);
    expect(r.code).toBe(0);
    expect(r.stdout.trimEnd().split("\n")).toEqual(["mode: linear", "source: legacy"]);
  });
});

// ===========================================================================
// AC-STE-706.11 — docs/settings-reference.md
// ===========================================================================

// AC-STE-706.12 mapping table: every closed-set key -> the v2.101.4 reader key
// it replaces, or `new` (owning FR, no legacy home), or `format` (this FR).
type Row =
  | { kind: "legacy"; replaces: string }
  | { kind: "new"; fr: string; note: "no legacy home" }
  | { kind: "format"; fr: "STE-706" };

const BINDING_KEYS = [
  "team",
  "project",
  "default_labels",
  "repo_tag",
  "min_dpt_version",
  "linear_bug_label",
  "jira_bug_issue_type",
  "jira_issue_type",
];

const MAPPING: Record<string, Row> = {
  schema_version: { kind: "format", fr: "STE-706" },
  min_dpt_version: { kind: "format", fr: "STE-706" },
  "task_tracking.mode": { kind: "legacy", replaces: "## Task Tracking mode: (readTaskTrackingSection)" },
  "task_tracking.mcp_server": { kind: "legacy", replaces: "## Task Tracking mcp_server: (CANONICAL_KEYS)" },
  "task_tracking.jira_ac_field": { kind: "legacy", replaces: "## Task Tracking jira_ac_field: (CANONICAL_KEYS)" },
  "task_tracking.branch_template": { kind: "legacy", replaces: "## Task Tracking branch_template: (CANONICAL_KEYS)" },
  "task_tracking.secondary_tracker": { kind: "legacy", replaces: "## Task Tracking secondary_tracker: (buildResolverConfig)" },
  "task_tracking.milestone_scan_fetch": { kind: "legacy", replaces: "milestone_scan_fetch: line (readMilestoneScanFetch)" },
  ...Object.fromEntries(
    BINDING_KEYS.flatMap((k) => [
      [`task_tracking.linear.${k}`, { kind: "legacy", replaces: `### Linear ${k}: (readWorkspaceBinding / writeTrackerSubsection)` }],
      [`task_tracking.jira.${k}`, { kind: "legacy", replaces: `### Jira ${k}: (readWorkspaceBinding / writeTrackerSubsection)` }],
    ]),
  ),
  "task_tracking.status_vocabulary.tracker_key": { kind: "legacy", replaces: "specs/tracker-config.yaml tracker_key (readTrackerConfig)" },
  "task_tracking.status_vocabulary.statuses": { kind: "legacy", replaces: "specs/tracker-config.yaml statuses (readTrackerConfig)" },
  "task_tracking.status_vocabulary.roles": { kind: "legacy", replaces: "specs/tracker-config.yaml roles (readTrackerConfig)" },
  "verification.verify_skill": { kind: "legacy", replaces: "## Verification verify_skill: (readVerificationConfig)" },
  "verification.verify_mode": { kind: "legacy", replaces: "## Verification verify_mode: (readVerificationConfig)" },
  "verification.run_cmd": { kind: "legacy", replaces: "## Verification run_cmd: (readVerificationConfig)" },
  "verification.e2e_cmd": { kind: "legacy", replaces: "## Verification e2e_cmd: (readVerificationConfig)" },
  "docs.user_facing_mode": { kind: "legacy", replaces: "## Docs user_facing_mode: (readDocsConfig)" },
  "docs.packages_mode": { kind: "legacy", replaces: "## Docs packages_mode: (readDocsConfig)" },
  "docs.changelog_ci_owned": { kind: "legacy", replaces: "## Docs changelog_ci_owned: (readDocsConfig)" },
  "docs.changelog_unversioned": { kind: "legacy", replaces: "## Docs changelog_unversioned: (readDocsConfig)" },
  "orchestration.default_effort": { kind: "legacy", replaces: "## Orchestration default_effort: (readOrchestrationConfig)" },
  "orchestration.merge_policy": { kind: "legacy", replaces: "## Orchestration merge_policy: (readOrchestrationConfig)" },
  "tracking.token_stats": { kind: "legacy", replaces: "## Token Stats enabled: (readTokenStatsConfig)" },
  // Amended by AC-STE-715.14 (M_7bc805): the gate-outcome switch is a new key with no legacy home.
  "tracking.gate_outcomes": { kind: "new", fr: "STE-715", note: "no legacy home" },
  // Amended by AC-STE-716.1 (M_7bc805): the tool-call capture switch is a new key with no legacy home.
  "tracking.tool_calls": { kind: "new", fr: "STE-716", note: "no legacy home" },
  "close_out.upgrade_offer": { kind: "new", fr: "STE-712", note: "no legacy home" },
  // Amended by AC-STE-719.3 (M_d1b4b7): the retro offer switch is a new block with no legacy home.
  retro: { kind: "new", fr: "STE-719", note: "no legacy home" },
  "release.files": { kind: "legacy", replaces: "## Release Files (parseReleaseFiles)" },
  "video.config": { kind: "legacy", replaces: ".dpt/video/config.yaml (parseVideoConfig)" },
  "video.style": { kind: "legacy", replaces: ".dpt/video/style.yaml (parseVideoStyle)" },
};

/** Paths whose value is one setting (a block, a list or a delegated document), not a further section. */
const LEAF_BLOCKS = new Set([
  "task_tracking.status_vocabulary.roles",
  "tracking.token_stats",
  // Amended by AC-STE-715.14 (M_7bc805): the gate-outcome switch is one setting block.
  "tracking.gate_outcomes",
  // Amended by AC-STE-716.1 (M_7bc805): the tool-call capture switch is one setting block.
  "tracking.tool_calls",
  "close_out.upgrade_offer",
  // Amended by AC-STE-719.3 (M_d1b4b7): the retro switch is one setting block.
  "retro",
  "release.files",
  "video.config",
  "video.style",
]);

function closedSetPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (LEAF_BLOCKS.has(p) || typeof v !== "object" || v === null || Array.isArray(v)) out.push(p);
    else out.push(...closedSetPaths(v as Record<string, unknown>, p));
  }
  return out;
}

const NEVER_MOVED = [".dpt/.env", "tracker_write_gate", ".claude/settings.json", "DPT_"];

describe("AC-STE-706.11 settings reference", () => {
  const REF = join(DOCS_DIR, "settings-reference.md");

  test("AC-.11 docs/settings-reference.md exists and is linked from docs/setup-reference.md", () => {
    expect(existsSync(REF)).toBe(true);
    expect(readFileSync(join(DOCS_DIR, "setup-reference.md"), "utf8")).toContain("settings-reference.md");
  });

  test("AC-.11 every closed-set key appears in the reference", () => {
    const doc = readFileSync(REF, "utf8");
    const missing = Object.keys(MAPPING)
      .map((p) => p.split(".").pop()!)
      .filter((leaf) => !doc.includes(`\`${leaf}\``) && !doc.includes(`.${leaf}\``));
    expect(missing).toEqual([]);
    for (const section of ["task_tracking", "verification", "docs", "orchestration", "tracking", "close_out", "release", "video"]) {
      expect(doc).toContain(section);
    }
  });

  test("AC-.11 every legacy home it replaces is named", () => {
    const doc = readFileSync(REF, "utf8");
    for (const home of [
      "## Task Tracking",
      "### Linear",
      "### Jira",
      "## Verification",
      "## Docs",
      "## Orchestration",
      "## Token Stats",
      "## Release Files",
      "milestone_scan_fetch",
      "specs/tracker-config.yaml",
      ".dpt/video/config.yaml",
      ".dpt/video/style.yaml",
    ]) {
      expect(doc).toContain(home);
    }
  });

  test("AC-.11 every never-moved surface is listed", () => {
    const doc = readFileSync(REF, "utf8");
    for (const s of NEVER_MOVED) expect(doc).toContain(s);
  });

  test("AC-.11 the --fetch / --no-fetch flags still outrank milestone_scan_fetch per resolveFetchPolicy", () => {
    const doc = readFileSync(REF, "utf8");
    expect(doc).toContain("--fetch");
    expect(doc).toContain("--no-fetch");
    expect(doc).toContain("resolveFetchPolicy");
  });
});

// ===========================================================================
// AC-STE-706.12 — no new knob
// ===========================================================================

/**
 * Every closed-set path the LOADER accepts, walked from its own closed sets
 * (`settingsKeyOrder`, which every `closeKeys` call reads) — not from a fixture.
 * A path is a leaf when it is a setting block or names no further closed map.
 */
function loaderClosedSetPaths(order: (path: string) => readonly string[], prefix = ""): string[] {
  const out: string[] = [];
  for (const k of order(prefix)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (LEAF_BLOCKS.has(p) || order(p).length === 0) out.push(p);
    else out.push(...loaderClosedSetPaths(order, p));
  }
  return out;
}

describe("AC-STE-706.12 mapping table", () => {
  // Review T1: the guard walks the loader's closed sets, so a key added to the
  // loader with no mapping row (a new knob) turns this red.
  test("AC-.12 every closed-set key the loader accepts has a mapping row", () => {
    const paths = loaderClosedSetPaths(M().settingsKeyOrder);
    expect(paths.length).toBeGreaterThan(40);
    expect(paths.filter((p) => !(p in MAPPING))).toEqual([]);
  });

  test("AC-.12 [control: a planted knob] a key planted in a loader closed set has no row and is caught", () => {
    const planted = (path: string): readonly string[] =>
      path === "orchestration" ? [...M().settingsKeyOrder(path), "skip_gates"] : M().settingsKeyOrder(path);
    expect(loaderClosedSetPaths(planted).filter((p) => !(p in MAPPING))).toEqual(["orchestration.skip_gates"]);
  });

  test("AC-.12 the loader refuses a key outside its walked closed sets (the walk is what it enforces)", () => {
    const obj = setPath(clone(BASE), "orchestration.skip_gates", true);
    expect(() => M().loadProjectSettings(settingsTree(obj))).toThrow(M().SettingsShapeError);
  });

  test("AC-.12 every closed-set key in the fixtures has a mapping row", () => {
    const paths = new Set([...closedSetPaths(BASE), ...closedSetPaths(JIRA_BASE)]);
    const unmapped = [...paths].filter((p) => !(p in MAPPING));
    expect(unmapped).toEqual([]);
  });

  test("AC-.12 every fixture leaf key is accepted by the loader", () => {
    // BASE and JIRA_BASE carry every key the table rows name at the fixture granularity
    expect(M().loadProjectSettings(settingsTree(BASE)).source).toBe("settings");
    expect(M().loadProjectSettings(settingsTree(JIRA_BASE)).source).toBe("settings");
  });

  test("AC-.12 every new row names an owning FR and no legacy home", () => {
    for (const [key, row] of Object.entries(MAPPING)) {
      if (row.kind !== "new") continue;
      expect(row.fr).toMatch(/^STE-\d+$/);
      expect(row.note).toBe("no legacy home");
    }
  });

  test("AC-.12 the new rows equal NEW_KEYS exactly", () => {
    const newRows = Object.entries(MAPPING)
      .filter(([, r]) => r.kind === "new")
      .map(([k]) => k)
      .sort();
    expect([...M().NEW_KEYS].sort()).toEqual(newRows);
  });

  test("AC-.12 format rows are owned by STE-706", () => {
    const format = Object.entries(MAPPING).filter(([, r]) => r.kind === "format");
    expect(format.map(([k]) => k).sort()).toEqual(["min_dpt_version", "schema_version"]);
  });

  test("AC-.12 every new key is off when absent", () => {
    const obj = clone(BASE);
    for (const key of M().NEW_KEYS as string[]) {
      const top = key.split(".")[0]!;
      delete obj[top];
    }
    const r = M().loadProjectSettings(settingsTree(obj));
    for (const key of M().NEW_KEYS as string[]) {
      let cur: unknown = r.settings;
      for (const p of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[p];
      expect((cur as { enabled?: unknown } | undefined)?.enabled ?? false).toBe(false);
    }
  });
});

// ===========================================================================
// AC-STE-706.13 — same-name consumer headings
// ===========================================================================

describe("AC-STE-706.13 same-name consumer headings", () => {
  const PROSE = "# P\n\n## Verification\n\nRun the smoke test by hand before a release.\n\n## Docs\n\nSee the docs folder for details.\n";

  test("AC-.13 prose-only ## Verification and ## Docs beside a settings file load settings", () => {
    const root = settingsTree(BASE, { "CLAUDE.md": PROSE });
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("settings");
    expect(M().detectSettingsSource(root)).toBe("settings");
    expect(r.settings.verification).toEqual(BASE.verification);
    expect(r.settings.docs).toEqual(BASE.docs);
  });

  test("AC-.13 one recognised key under ## Verification makes it refuse", () => {
    const root = settingsTree(BASE, { "CLAUDE.md": PROSE.replace("before a release.\n", "before a release.\nverify_mode: manual\n") });
    expect(() => M().loadProjectSettings(root)).toThrow(M().SettingsShapeError);
    expect(M().detectSettingsSource(root)).toBe("both");
  });

  test("AC-.13 one recognised key under ## Docs makes it refuse", () => {
    const root = settingsTree(BASE, { "CLAUDE.md": PROSE.replace("for details.\n", "for details.\npackages_mode: false\n") });
    expect(() => M().loadProjectSettings(root)).toThrow(M().SettingsShapeError);
    expect(M().detectSettingsSource(root)).toBe("both");
  });
});

// ===========================================================================
// AC-STE-706.14 / .15 — the binding stub
// ===========================================================================

const PINNED_LINEAR = [
  MARKER,
  "## Task Tracking",
  "",
  "mode: linear",
  "",
  "### Linear",
  "",
  "team: SYN",
  "project: Synthetic Project",
  "default_labels: []",
  "linear_bug_label: Bug",
  "",
].join("\n");

const PINNED_SHARED_JIRA = [
  MARKER,
  "## Task Tracking",
  "",
  "mode: jira",
  "",
  "### Jira",
  "",
  "project: SYN",
  "default_labels: [syn-be]",
  "repo_tag: syn-be",
  "min_dpt_version: 2.90.0",
  "jira_bug_issue_type: Defect",
  "jira_issue_type: Task",
  "",
].join("\n");

const PINNED_CUSTOM = [MARKER, "## Task Tracking", "", "mode: github", ""].join("\n");

const MOVED_HEADINGS = [
  "## Task Tracking",
  "### Linear",
  "### Jira",
  "## Verification",
  "## Docs",
  "## Orchestration",
  "## Token Stats",
  "## Release Files",
];
const SLOT_HEADINGS = new Set(["## Task Tracking", "### Linear", "### Jira"]);

describe("AC-STE-706.15 stub render", () => {
  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ["Linear", BASE, PINNED_LINEAR],
    ["shared Jira", JIRA_BASE, PINNED_SHARED_JIRA],
    ["custom adapter", CUSTOM_BASE, PINNED_CUSTOM],
    ["mode none", NONE_BASE, ""],
  ];
  for (const [name, obj, pinned] of CASES) {
    test(`AC-.15 stub render: ${name} is byte-equal to the pinned string`, () => {
      const { settings } = M().loadProjectSettings(settingsTree(obj));
      const out: string = M().renderTrackingStub(settings);
      expect(out).toBe(pinned);
      if (out.length > 0) {
        expect(out.split("\n")[0]).toBe(MARKER);
        const stray = out
          .split("\n")
          .filter((l) => MOVED_HEADINGS.includes(l) && !SLOT_HEADINGS.has(l));
        expect(stray).toEqual([]);
        // the marker names no heading and holds no key line
        expect(MARKER).not.toMatch(/##|^[a-z_]+:/);
      }
    });
  }

  for (const [name, obj, adapter] of [
    ["Linear", BASE, "linear"],
    ["shared Jira", JIRA_BASE, "jira"],
  ] as const) {
    test(`AC-.15 stub render: ${name} parses back through readWorkspaceBinding to the settings binding`, () => {
      const { settings } = M().loadProjectSettings(settingsTree(obj));
      const root = tree({ "CLAUDE.md": `# P\n\n${M().renderTrackingStub(settings)}` });
      const { shared: _shared, ...binding } = readWorkspaceBinding(join(root, "CLAUDE.md"), adapter);
      const expected = { ...(settings.task_tracking[adapter] as Record<string, unknown>) };
      // jira_issue_type is written by writeTrackerSubsection and read by adapters/jira.md, not readWorkspaceBinding
      delete expected.jira_issue_type;
      expect(snake(binding)).toEqual(defined(expected));
      expect(readTaskTrackingSection(join(root, "CLAUDE.md")).mode).toBe(adapter);
    });
  }

  test("AC-.15 renderTrackingStub is owned by the legacy module and re-exported", () => {
    const src = readFileSync(MOD_PATH, "utf8");
    expect(src).not.toMatch(/function\s+renderTrackingStub\b/);
    expect(src).toMatch(/renderTrackingStub/);
  });
});

describe("AC-STE-706.14 the stub slot", () => {
  test("AC-.14 a CLAUDE.md carrying the exact rendered stub loads settings", () => {
    const { settings } = M().loadProjectSettings(settingsTree(BASE));
    const root = settingsTree(BASE, { "CLAUDE.md": `# P\n\n${M().renderTrackingStub(settings)}\n## Key Commands\n\n- bun test\n` });
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("settings");
    expect(M().detectSettingsSource(root)).toBe("settings");
  });

  test("AC-.14 a stub slot holding a different mode and team loads settings values", () => {
    const stale = "# P\n\n## Task Tracking\n\nmode: jira\nmcp_server: atlassian\n\n### Jira\n\nteam: OTHER\nproject: OTHER\n";
    const root = settingsTree(BASE, { "CLAUDE.md": stale });
    const r = M().loadProjectSettings(root);
    expect(r.source).toBe("settings");
    expect(M().detectSettingsSource(root)).toBe("settings");
    expect(r.settings.task_tracking.mode).toBe("linear");
    expect(r.settings.task_tracking.mcp_server).toBe("linear");
    expect(r.settings.task_tracking.linear.team).toBe("SYN");
    expect(r.settings.task_tracking.jira).toBeUndefined();
  });
});

// ===========================================================================
// AC-STE-706.19 — section isolation
// ===========================================================================

describe("AC-STE-706.19 section isolation", () => {
  const HEALTHY: Record<string, string> = {
    task_tracking: "## Task Tracking\n\nmode: linear\nmcp_server: linear\nsecondary_tracker: jira\n\n### Linear\n\nteam: SYN\nproject: Synthetic Project\n",
    verification: "## Verification\n\nverify_skill: smoke-test\nverify_mode: manual\n",
    docs: "## Docs\n\nuser_facing_mode: true\n",
    orchestration: "## Orchestration\n\nmerge_policy: auto\n",
    tracking: "## Token Stats\n\nenabled: true\n",
    release: RELEASE_BLOCK,
  };
  const MALFORMED: Record<string, string> = {
    task_tracking: "## Task Tracking\n\nmode: linear\n\n### Linear\n\nteam: SYN\nrepo_tag: BAD_TAG\n",
    verification: "## Verification\n\nverify_skil: smoke-test\n",
    docs: "## Docs\n\nuser_facing_mode: yes\n",
    orchestration: "## Orchestration\n\nmerge_policy: sometimes\n",
    tracking: "## Token Stats\n\nenabled: yes\n",
    release: "## Release Files\n\n```yaml\nfiles:\n  - path: package.json\n```\n",
  };
  const SECTIONS = Object.keys(HEALTHY);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function expectReaderValue(root: string, section: string, value: any): void {
    const md = join(root, "CLAUDE.md");
    switch (section) {
      case "task_tracking": {
        const tt = readTaskTrackingSection(md);
        expect(value.mode).toBe(tt.mode);
        expect(value.secondary_tracker).toBe(tt.secondary_tracker);
        const { shared: _s, ...b } = readWorkspaceBinding(md, "linear");
        expect(defined(value.linear)).toEqual(snake(b));
        break;
      }
      case "verification":
        expect(value).toEqual(snake(readVerificationConfig(md) as unknown as Record<string, unknown>));
        break;
      case "docs":
        expect(value).toEqual(snake(readDocsConfig(md) as unknown as Record<string, unknown>));
        break;
      case "orchestration":
        expect(value).toEqual(snake(readOrchestrationConfig(root) as unknown as Record<string, unknown>));
        break;
      case "tracking":
        expect(value.token_stats).toEqual(readTokenStatsConfig(md));
        break;
      case "release":
        expect(value.files).toEqual(parseReleaseFiles(readFileSync(md, "utf8")));
        break;
    }
  }

  for (const bad of SECTIONS) {
    test(`AC-.19 isolation: malformed ${bad} refuses only ${bad}`, () => {
      const md = SECTIONS.map((s) => (s === bad ? MALFORMED[s] : HEALTHY[s])).join("\n");
      const root = tree({ "CLAUDE.md": `# P\n\n${md}` });
      expect(() => {
        const v = M().loadProjectSection(root, bad);
        // touch the binding so a lazily parsed sub-map still has to refuse
        if (bad === "task_tracking") void v.linear;
      }).toThrow();
      for (const other of SECTIONS.filter((s) => s !== bad)) {
        expectReaderValue(root, other, M().loadProjectSection(root, other));
      }
    });
  }

  test("AC-.19 isolation: malformed video config refuses only video", () => {
    const root = tree({
      "CLAUDE.md": `# P\n\n${SECTIONS.map((s) => HEALTHY[s]).join("\n")}`,
      ".dpt/video/config.yaml": "tts:\n  provider: synthvoice-co\n",
    });
    expect(() => M().loadProjectSection(root, "video")).toThrow();
    for (const s of SECTIONS) expectReaderValue(root, s, M().loadProjectSection(root, s));
  });

  test("AC-.19 isolation: malformed tracker-config throws only at status_vocabulary", () => {
    const root = tree({
      "CLAUDE.md": `# P\n\n${SECTIONS.map((s) => HEALTHY[s]).join("\n")}`,
      "specs/tracker-config.yaml": MALFORMED_TRACKER_CONFIG_YAML,
    });
    // control: the v2.101.4 reader refuses this file
    expect(() => readTrackerConfig(join(root, "specs"))).toThrow();
    const tt = M().loadProjectSection(root, "task_tracking");
    expect(tt.mode).toBe("linear");
    expect(tt.secondary_tracker).toBe("jira");
    expect(defined(tt.linear)).toEqual({ team: "SYN", project: "Synthetic Project" });
    expect(() => tt.status_vocabulary).toThrow(M().SettingsShapeError);
    for (const s of SECTIONS.filter((x) => x !== "task_tracking")) {
      expectReaderValue(root, s, M().loadProjectSection(root, s));
    }
  });

  // Review #4 (Worker ruling in STE-706's notes): a settings source isolates
  // sections as the legacy source does — a section read validates the header,
  // the closed top level and its own section only; the whole-file loader still
  // refuses any malformed section (AC-.2).
  test("AC-.19 a settings source isolates sections: a malformed verification refuses only verification", () => {
    const obj = setPath(clone(BASE), "verification.bogus_ver", "x");
    const root = settingsTree(obj);
    expect(() => M().loadProjectSection(root, "verification")).toThrow(M().SettingsShapeError);
    expect(() => M().loadProjectSection(root, "docs")).not.toThrow();
    expect(() => M().loadProjectSettings(root)).toThrow(M().SettingsShapeError);
  });

  test("AC-.19 a settings source: an unknown top-level key refuses every section read", () => {
    const obj = setPath(clone(BASE), "bogus_top", "x");
    expect(() => M().loadProjectSection(settingsTree(obj), "docs")).toThrow(M().SettingsShapeError);
  });
});
