// STE-707 — every settings read goes through the settings loader.
//
// Each reader in the FR's table keeps its exported signature and derives its
// value from `loadProjectSection` (STE-706). A reader taking a `claudeMdPath`
// resolves the project root as that path's directory.
//
// Rows in this file:
//   - AC-STE-707.1  settings twin: one row per reader, a settings-file tree and
//                   its legacy CLAUDE.md twin return deep-equal values; plus
//                   omitted-section and partial-section rows (a settings file
//                   that omits a section, or carries `tracking: {}` and other
//                   partial sections, returns the documented defaults of its
//                   legacy twin).
//   - AC-STE-707.2  the defect case (no `## Task Tracking`, settings `mode: linear`).
//   - AC-STE-707.5  the hooks through the shipped wrappers on settings-file trees.
//   - AC-STE-707.6  citations name `specs/settings.yaml` + key path, or CLAUDE.md.
//   - AC-STE-707.7  the `release_config.ts` front door on both homes and on this repo.
//   - AC-STE-707.9  `spans_repos.ts` across a settings-file repo and a legacy sibling.
//   - AC-STE-707.12 legacy isolation through the shipped wrappers, graded against
//                   the v2.101.4 hook code itself (extracted from git at 8b107a45).
//
// AC-STE-707.10 (mutation control): every settings-twin row below uses values
// that DIFFER from the reader's defaults, and the settings-file tree's CLAUDE.md
// carries no moved heading. So a reader whose loader call is removed falls back
// to its private CLAUDE.md parse, reads defaults, and its row reds:
//   readTaskTrackingSection     -> "AC-.1 twin: readTaskTrackingSection"
//   buildResolverConfig         -> "AC-.1 twin: buildResolverConfig"
//   readWorkspaceBinding        -> "AC-.1 twin: readWorkspaceBinding"
//   resolveBugTrackerType       -> "AC-.1 twin: resolveBugTrackerType over the read binding"
//   readVerificationConfig      -> "AC-.1 twin: readVerificationConfig"
//   verificationSectionLine     -> "AC-.1 twin: verificationSectionLine cites the section's own home"
//   resolveVerifyMode           -> "AC-.1 twin: resolveVerifyMode derives blocking from run_cmd"
//   readDocsConfig              -> "AC-.1 twin: readDocsConfig"
//   readOrchestrationConfig     -> "AC-.1 twin: readOrchestrationConfig"
//   readTokenStatsConfig        -> "AC-.1 twin: readTokenStatsConfig"
//   readMilestoneScanFetch      -> "AC-.1 twin: readMilestoneScanFetch"
//   release_config.ts CLI read  -> "AC-.1 twin: release_config.ts front door reads release.files"
//   tracker_project_milestone_attached -> "AC-.1 twin: tracker_project_milestone_attached grades the tracker-mode tree"
//   next_free_milestone_number  -> "AC-.1 twin: next_free_milestone_number front door reads the mode"
//   linear_team_key             -> "AC-.1 twin: linear_team_key detect reads the mode and binding"
//   readTrackerConfig           -> "AC-.1 twin: readTrackerConfig"
//   readVideoStyle              -> "AC-.1 twin: readVideoStyle"
//   video/readiness.ts          -> "AC-.1 twin: videoReadiness reads the video config"
//   video_pipeline.ts config    -> "AC-.1 twin: video_pipeline voice stage reads the video config"
//   migrate-task-tracking-add-workspace.ts -> "AC-.1 twin: migrate-task-tracking-add-workspace sees the binding"
//   migrate-task-tracking-canonical.ts     -> its twin row cannot discriminate (a
//       settings file is closed to non-canonical top-level keys, so both homes
//       report "no migration needed"); its mutation control is the one-reader
//       scan of AC-STE-707.3 (tests/m_94e6f7-ste-707-one-settings-reader.test.ts),
//       which reds while the script keeps its own `## Task Tracking` literal.
//
// AC-STE-707.8 (legacy behaviour holds) is graded by the pre-existing suites
// that build legacy CLAUDE.md / tracker-config / video-config fixtures, run
// with their assertions unchanged; this file adds no assertion to them.
// AC-STE-707.11 (`bun test` from plugins/dev-process-toolkit reports 0
// failures, skip identities equal to trunk by name) is graded by the full gate
// run, not by a test in this file.
//
// All ids, teams, projects, tags and sessions are synthetic.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { buildResolverConfig, readTaskTrackingSection } from "../adapters/_shared/src/resolver_config";
import { readWorkspaceBinding, resolveBugTrackerType } from "../adapters/_shared/src/workspace_binding";
import {
  readVerificationConfig,
  resolveVerifyMode,
  verificationSectionLine,
} from "../adapters/_shared/src/verification_config";
import { readDocsConfig } from "../adapters/_shared/src/docs_config";
import { readOrchestrationConfig } from "../adapters/_shared/src/orchestration_config";
import { readTokenStatsConfig } from "../adapters/_shared/src/token_stats_config";
import { readMilestoneScanFetch } from "../adapters/_shared/src/milestone_scan_fetch_config";
import { readTrackerConfig } from "../adapters/_shared/src/tracker_config";
import { readVideoStyle } from "../adapters/_shared/src/video/style";
import { videoReadiness } from "../adapters/_shared/src/video/readiness";
import { runVideoStage } from "../adapters/_shared/src/video_pipeline";
import { runTrackerProjectMilestoneAttachedProbe } from "../adapters/_shared/src/tracker_project_milestone_attached";
import { linearTeamKey } from "../adapters/_shared/src/migrations/entries/linear_team_key";
import { readAdapterName } from "../adapters/_shared/src/read_adapter_name";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { renderTrackingStub } from "../adapters/_shared/src/project_settings";
import { verifySpan } from "../adapters/_shared/src/spans_repos";
import { ledgerPath } from "../adapters/_shared/src/token_usage";
import { FIXTURE_TRACKER_PROJECT, FIXTURE_TRACKER_TEAM } from "./_span_fixture";
import { FLOOR, TAG_A, TAG_B, makeDeclarePair } from "./_span_declare_fixture";

const PLUGIN = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PLUGIN, "..", "..");
const SRC = join(PLUGIN, "adapters", "_shared", "src");
const ADAPTERS_DIR = join(PLUGIN, "adapters");
const RELEASE_DOOR = join(SRC, "release_config.ts");
const NEXT_FREE_DOOR = join(SRC, "next_free_milestone_number.ts");
const ADD_WORKSPACE_SCRIPT = join(PLUGIN, "scripts", "migrate-task-tracking-add-workspace.ts");
const CANONICAL_SCRIPT = join(PLUGIN, "scripts", "migrate-task-tracking-canonical.ts");
const LEDGER_WRAPPER = join(PLUGIN, "templates", "hooks", "process", "session-token-ledger.sh");
const GATE_WRAPPER = join(PLUGIN, "templates", "hooks", "process", "pre-tracker-write-gate.sh");
/** The v2.101.4 release commit (M_9261c7, PR #126) — the legacy-behaviour oracle of AC-.7 and AC-.12. */
const V2_101_4 = "8b107a45";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ste707-")));
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

function git(root: string, ...args: string[]): void {
  const p = Bun.spawnSync(
    ["git", "-c", "user.name=dpt-707", "-c", "user.email=dpt-707@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw, got a return");
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function spawnBun(args: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}): Run {
  const r = Bun.spawnSync([process.execPath, "run", ...args], {
    cwd: opts.cwd ?? PLUGIN,
    env: { ...process.env, NO_COLOR: "1", ...(opts.env ?? {}) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

/** Replace a tree's root path with a placeholder so two trees' outputs compare. */
function norm(text: string, root: string): string {
  return text.split(root).join("<ROOT>");
}

const PROSE_MD = "# Synthetic Project\n\nProject prose. No moved heading lives here.\n\n## Testing Conventions\n\n- Layout: tests/ mirrors src/\n";

// The values every twin row reads — each differs from its reader's default.
const STATUS_VOCAB = {
  tracker_key: "linear",
  statuses: ["Backlog", "Doing", "Reviewing", "Shipped"],
  roles: { initial: "Backlog", in_progress: "Doing", in_review: "Reviewing", done: "Shipped" },
};
const TRACKER_CONFIG_YAML = [
  "tracker_key: linear",
  "statuses:",
  "  - Backlog",
  "  - Doing",
  "  - Reviewing",
  "  - Shipped",
  "roles:",
  "  initial: Backlog",
  "  in_progress: Doing",
  "  in_review: Reviewing",
  "  done: Shipped",
  "",
].join("\n");
const VIDEO_CONFIG = { tts: { provider: "elevenlabs", voice: "SynthVoice" }, recorder: { kind: "web" }, music: { source: "none" } };
const VIDEO_CONFIG_YAML = "tts:\n  provider: elevenlabs\n  voice: SynthVoice\nrecorder:\n  kind: web\nmusic:\n  source: none\n";
const VIDEO_STYLE = { captions: { enabled: false }, humor: "none", pacing: { words_per_minute: 170 } };
const VIDEO_STYLE_YAML = "captions:\n  enabled: false\nhumor: none\npacing:\n  words_per_minute: 170\n";
const RELEASE_FILES = [{ path: "package.json", kind: "json", field: "version" }];
const PACKAGE_JSON = `${JSON.stringify({ name: "synthetic", version: "1.0.0" }, null, 2)}\n`;

function fullSettings(over: { team?: string } = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    min_dpt_version: "2.0.0",
    task_tracking: {
      mode: "linear",
      mcp_server: "linear",
      jira_ac_field: "",
      branch_template: "{type}/m{N}-{slug}",
      milestone_scan_fetch: true,
      linear: {
        team: over.team ?? "SYN",
        project: "Synthetic Project",
        default_labels: ["synth"],
        linear_bug_label: "Defect",
      },
      status_vocabulary: STATUS_VOCAB,
    },
    verification: { verify_skill: "smoke-test", verify_mode: "manual", run_cmd: "bun run start", e2e_cmd: "none" },
    docs: { user_facing_mode: true, packages_mode: false, changelog_ci_owned: true, changelog_unversioned: false },
    orchestration: { default_effort: "high", merge_policy: "auto" },
    tracking: { token_stats: { enabled: true } },
    release: { files: RELEASE_FILES },
    video: { config: VIDEO_CONFIG, style: VIDEO_STYLE },
  };
}

function fullLegacyMd(over: { team?: string } = {}): string {
  return [
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
    `team: ${over.team ?? "SYN"}`,
    "project: Synthetic Project",
    "default_labels: [synth]",
    "linear_bug_label: Defect",
    "",
    "## Notes",
    "",
    "milestone_scan_fetch: true",
    "",
    "## Verification",
    "",
    "verify_skill: smoke-test",
    "verify_mode: manual",
    "run_cmd: bun run start",
    "e2e_cmd: none",
    "",
    "## Docs",
    "",
    "user_facing_mode: true",
    "packages_mode: false",
    "changelog_ci_owned: true",
    "changelog_unversioned: false",
    "",
    "## Orchestration",
    "",
    "default_effort: high",
    "merge_policy: auto",
    "",
    "## Token Stats",
    "",
    "enabled: true",
    "",
    "## Release Files",
    "",
    "```yaml",
    "files:",
    "  - path: package.json",
    "    kind: json",
    "    field: version",
    "```",
    "",
    "## Testing Conventions",
    "",
    "- Layout: tests/ mirrors src/",
    "",
  ].join("\n");
}

/** A settings-file tree: the settings file, a prose CLAUDE.md, and the files the rows read. */
function settingsTree(obj: Record<string, unknown>, extra: Record<string, string> = {}): string {
  return tree({ "specs/settings.yaml": toSettingsYaml(obj), "CLAUDE.md": PROSE_MD, ...extra });
}

/** The legacy twin of `fullSettings`: CLAUDE.md headings, tracker-config.yaml, .dpt/video/*. */
function legacyFullTree(over: { team?: string } = {}, extra: Record<string, string> = {}): string {
  return tree({
    "CLAUDE.md": fullLegacyMd(over),
    "specs/tracker-config.yaml": TRACKER_CONFIG_YAML,
    ".dpt/video/config.yaml": VIDEO_CONFIG_YAML,
    ".dpt/video/style.yaml": VIDEO_STYLE_YAML,
    ...extra,
  });
}

function twins(extra: Record<string, string> = {}, over: { team?: string } = {}): { s: string; l: string } {
  return { s: settingsTree(fullSettings(over), extra), l: legacyFullTree(over, extra) };
}

const md = (root: string): string => join(root, "CLAUDE.md");

// ---------------------------------------------------------------------------
// AC-STE-707.1 — settings twin, one row per reader
// ---------------------------------------------------------------------------

describe("AC-STE-707.1 settings twin: each reader returns deep-equal values from both homes", () => {
  test("AC-.1 twin: readTaskTrackingSection", () => {
    const { s, l } = twins();
    const legacy = readTaskTrackingSection(md(l));
    expect(legacy.mode).toBe("linear");
    expect(readTaskTrackingSection(md(s))).toEqual(legacy);
  });

  test("AC-.1 twin: buildResolverConfig", () => {
    const { s, l } = twins();
    const view = (root: string) =>
      buildResolverConfig(md(root), ADAPTERS_DIR).trackers.map((t) => ({
        key: t.key,
        idPattern: t.idPattern.source,
        urlHost: t.urlHost,
        urlPathRegex: t.urlPathRegex.source,
      }));
    const legacy = view(l);
    expect(legacy.map((t) => t.key)).toEqual(["linear"]);
    expect(view(s)).toEqual(legacy);
  });

  test("AC-.1 twin: readWorkspaceBinding", () => {
    const { s, l } = twins();
    const legacy = readWorkspaceBinding(md(l), "linear");
    expect(legacy.team).toBe("SYN");
    expect(readWorkspaceBinding(md(s), "linear")).toEqual(legacy);
  });

  test("AC-.1 twin: resolveBugTrackerType over the read binding", () => {
    const { s, l } = twins();
    const legacy = resolveBugTrackerType("linear", readWorkspaceBinding(md(l), "linear"));
    expect(legacy).toBe("Defect");
    expect(resolveBugTrackerType("linear", readWorkspaceBinding(md(s), "linear"))).toBe(legacy);
  });

  test("AC-.1 twin: readVerificationConfig", () => {
    const { s, l } = twins();
    const legacy = readVerificationConfig(md(l));
    expect(legacy.verifySkill).toBe("smoke-test");
    expect(readVerificationConfig(md(s))).toEqual(legacy);
  });

  test("AC-.1 twin: verificationSectionLine cites the section's own home", () => {
    const { s, l } = twins();
    const legacyLine = fullLegacyMd().split("\n").indexOf("## Verification") + 1;
    expect(verificationSectionLine(md(l))).toBe(legacyLine);
    // On a settings-file tree the cited line is the `verification:` key of specs/settings.yaml.
    const settingsLine = readFileSync(join(s, "specs", "settings.yaml"), "utf8").split("\n").findIndex((x) => x.startsWith("verification:")) + 1;
    expect(settingsLine).toBeGreaterThan(0);
    expect(verificationSectionLine(md(s))).toBe(settingsLine);
  });

  test("AC-.1 twin: resolveVerifyMode derives blocking from run_cmd", () => {
    // No `verify_mode` in either home: a declared run_cmd resolves to `blocking`.
    const settings = fullSettings();
    settings.verification = { verify_skill: "smoke-test", run_cmd: "bun run start" };
    const s = settingsTree(settings);
    const l = tree({ "CLAUDE.md": "# Synthetic\n\n## Verification\n\nverify_skill: smoke-test\nrun_cmd: bun run start\n" });
    expect(resolveVerifyMode(md(l))).toBe("blocking");
    expect(resolveVerifyMode(md(s))).toBe("blocking");
  });

  test("AC-.1 twin: readDocsConfig", () => {
    const { s, l } = twins();
    const legacy = readDocsConfig(md(l));
    expect(legacy.userFacingMode).toBe(true);
    expect(readDocsConfig(md(s))).toEqual(legacy);
  });

  test("AC-.1 twin: readOrchestrationConfig", () => {
    const { s, l } = twins();
    const legacy = readOrchestrationConfig(l);
    expect(legacy).toEqual({ defaultEffort: "high", mergePolicy: "auto" });
    expect(readOrchestrationConfig(s)).toEqual(legacy);
  });

  test("AC-.1 twin: readTokenStatsConfig", () => {
    const { s, l } = twins();
    const legacy = readTokenStatsConfig(md(l));
    expect(legacy).toEqual({ enabled: true });
    expect(readTokenStatsConfig(md(s))).toEqual(legacy);
  });

  test("AC-.1 twin: readMilestoneScanFetch", () => {
    const { s, l } = twins();
    expect(readMilestoneScanFetch(md(l))).toBe(true);
    expect(readMilestoneScanFetch(md(s))).toBe(true);
  });

  test("AC-.1 twin: release_config.ts front door reads release.files", () => {
    const { s, l } = twins({ "package.json": PACKAGE_JSON });
    const run = (root: string) => spawnBun([RELEASE_DOOR, root, "9.9.9", "--dry-run"]);
    const legacy = run(l);
    expect(legacy.code, legacy.stderr).toBe(0);
    expect(legacy.stdout).toContain("would rewrite package.json (dry-run)");
    const settings = run(s);
    expect(settings.code, settings.stderr).toBe(0);
    expect(norm(settings.stdout, s)).toBe(norm(legacy.stdout, l));
  });

  test("AC-.1 twin: tracker_project_milestone_attached grades the tracker-mode tree", async () => {
    const fr = "---\ntitle: t\nmilestone: M1\nstatus: active\narchived_at: null\ntracker:\n  linear: SYN-1\ncreated_at: 2026-11-04T00:00:00Z\n---\n\nbody\n";
    const plan = "---\nmilestone: M1\nstatus: active\n---\n\n# M1 — Synthetic milestone\n";
    const { s, l } = twins({ "specs/frs/SYN-1.md": fr, "specs/plan/M1.md": plan });
    const deps = { getIssue: async () => ({ projectMilestone: null }) };
    const legacy = await runTrackerProjectMilestoneAttachedProbe(l, deps);
    expect(legacy.violations.length).toBe(1);
    const settings = await runTrackerProjectMilestoneAttachedProbe(s, deps);
    expect(settings.violations.map((v) => v.reason)).toEqual(legacy.violations.map((v) => v.reason));
  });

  test("AC-.1 twin: next_free_milestone_number front door reads the mode", () => {
    const { s, l } = twins();
    const run = (root: string) => spawnBun([NEXT_FREE_DOOR, join(root, "specs"), "M5"]);
    const legacy = run(l);
    expect(legacy.code).toBe(1);
    expect(legacy.stderr).toContain("under mode: linear");
    const settings = run(s);
    expect(settings.code).toBe(legacy.code);
    expect(settings.stderr.split("\n")[0]).toBe(legacy.stderr.split("\n")[0]);
  });

  test("AC-.1 twin: linear_team_key detect reads the mode and binding", () => {
    const { s, l } = twins({}, { team: "Synthetic Team" });
    expect(linearTeamKey.detect(l).applies).toBe(true);
    expect(linearTeamKey.detect(s).applies).toBe(true);
  });

  test("AC-.1 twin: readTrackerConfig", () => {
    const { s, l } = twins();
    const legacy = readTrackerConfig(join(l, "specs"));
    expect(legacy).toEqual(STATUS_VOCAB as never);
    expect(readTrackerConfig(join(s, "specs"))).toEqual(legacy);
  });

  test("AC-.1 twin: readVideoStyle", () => {
    const { s, l } = twins();
    const legacy = readVideoStyle(l);
    expect(legacy.pacing.words_per_minute).toBe(170);
    expect(readVideoStyle(s)).toEqual(legacy);
  });

  /** A tree ready to make videos: a git repo whose `.dpt/.env` is ignored and holds the provider key. */
  function videoReady(root: string): string {
    mkdirSync(join(root, ".dpt"), { recursive: true });
    writeFileSync(join(root, ".dpt", ".gitignore"), ".env\n");
    writeFileSync(join(root, ".dpt", ".env"), "ELEVENLABS_API_KEY=synthetic-key\n");
    git(root, "init", "-q", "-b", "main");
    return root;
  }

  test("AC-.1 twin: videoReadiness reads the video config", () => {
    const { s, l } = twins();
    const legacy = videoReadiness(videoReady(l));
    expect(legacy).toEqual({ ready: true, reasons: [] });
    expect(videoReadiness(videoReady(s))).toEqual(legacy);
  });

  test("AC-.1 twin: video_pipeline voice stage reads the video config", async () => {
    const { s, l } = twins();
    const stageError = async (root: string): Promise<string> => {
      videoReady(root);
      const workDir = join(root, ".dpt", "video", "work", "syn");
      mkdirSync(workDir, { recursive: true });
      writeFileSync(join(workDir, "script.md"), "# Synthetic script\n");
      await runVideoStage({ projectRoot: root, slug: "syn", stage: "approve-script" });
      try {
        // The voice stage reads the config first, then refuses on the absent segments.json.
        await runVideoStage({ projectRoot: root, slug: "syn", stage: "voice" });
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      return "<no refusal>";
    };
    const legacy = await stageError(l);
    expect(legacy).toContain("segments.json");
    expect(norm(await stageError(s), s)).toBe(norm(legacy, l));
  });

  test("AC-.1 twin: migrate-task-tracking-add-workspace sees the binding", () => {
    const { s, l } = twins();
    const run = (root: string) =>
      spawnBun([ADD_WORKSPACE_SCRIPT, md(root)], { env: { DPT_MIGRATE_TEAM: "SYN", DPT_MIGRATE_PROJECT: "Synthetic Project" } });
    const legacy = run(l);
    expect(legacy.code).toBe(0);
    expect(legacy.stderr).toContain("sub-section already present");
    const settings = run(s);
    expect({ code: settings.code, stdout: settings.stdout, stderr: settings.stderr }).toEqual({
      code: legacy.code,
      stdout: legacy.stdout,
      stderr: legacy.stderr,
    });
  });

  test("AC-.1 twin: migrate-task-tracking-canonical reports the same verdict", () => {
    const { s, l } = twins();
    const legacy = spawnBun([CANONICAL_SCRIPT, md(l)]);
    const settings = spawnBun([CANONICAL_SCRIPT, md(s)]);
    expect(legacy.code).toBe(0);
    expect({ code: settings.code, stdout: settings.stdout, stderr: settings.stderr }).toEqual({
      code: legacy.code,
      stdout: legacy.stdout,
      stderr: legacy.stderr,
    });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-707.1 — omitted and partial sections read the documented defaults
// ---------------------------------------------------------------------------

describe("AC-STE-707.1 settings twin: omitted and partial sections return the legacy twin's defaults", () => {
  const MINIMAL = { schema_version: 1, min_dpt_version: "2.0.0" };
  const PARTIAL = {
    ...MINIMAL,
    task_tracking: { mode: "linear" },
    verification: {},
    docs: { user_facing_mode: true },
    orchestration: { merge_policy: "auto" },
    tracking: {},
    video: {},
  };
  const PARTIAL_MD = [
    "# Synthetic Project",
    "",
    "## Task Tracking",
    "",
    "mode: linear",
    "",
    "## Verification",
    "",
    "## Docs",
    "",
    "user_facing_mode: true",
    "",
    "## Orchestration",
    "",
    "merge_policy: auto",
    "",
    "## Token Stats",
    "",
  ].join("\n");

  // Each case: [label, settings-file tree, legacy twin].
  const cases = (): Array<[string, string, string]> => [
    ["omitted", settingsTree(MINIMAL), tree({ "CLAUDE.md": PROSE_MD })],
    ["partial", settingsTree(PARTIAL), tree({ "CLAUDE.md": PARTIAL_MD })],
  ];

  test("AC-.1 defaults: readTaskTrackingSection", () => {
    for (const [label, s, l] of cases()) expect([label, readTaskTrackingSection(md(s))]).toEqual([label, readTaskTrackingSection(md(l))]);
  });

  test("AC-.1 defaults: buildResolverConfig", () => {
    const keys = (root: string) => buildResolverConfig(md(root), ADAPTERS_DIR).trackers.map((t) => t.key);
    for (const [label, s, l] of cases()) expect([label, keys(s)]).toEqual([label, keys(l)]);
  });

  test("AC-.1 defaults: readWorkspaceBinding", () => {
    for (const [label, s, l] of cases()) {
      expect([label, readWorkspaceBinding(md(s), "linear")]).toEqual([label, readWorkspaceBinding(md(l), "linear")]);
    }
  });

  test("AC-.1 defaults: readVerificationConfig and resolveVerifyMode", () => {
    for (const [label, s, l] of cases()) {
      expect([label, readVerificationConfig(md(s))]).toEqual([label, readVerificationConfig(md(l))]);
      expect([label, resolveVerifyMode(md(s))]).toEqual([label, resolveVerifyMode(md(l))]);
    }
  });

  test("AC-.1 defaults: readDocsConfig", () => {
    for (const [label, s, l] of cases()) expect([label, readDocsConfig(md(s))]).toEqual([label, readDocsConfig(md(l))]);
  });

  test("AC-.1 defaults: readOrchestrationConfig", () => {
    for (const [label, s, l] of cases()) expect([label, readOrchestrationConfig(s)]).toEqual([label, readOrchestrationConfig(l)]);
  });

  test("AC-.1 defaults: readTokenStatsConfig (`tracking: {}` reads enabled: false)", () => {
    for (const [label, s, l] of cases()) {
      expect([label, readTokenStatsConfig(md(s))]).toEqual([label, { enabled: false }]);
      expect([label, readTokenStatsConfig(md(l))]).toEqual([label, { enabled: false }]);
    }
  });

  test("AC-.1 defaults: readMilestoneScanFetch", () => {
    for (const [label, s, l] of cases()) expect([label, readMilestoneScanFetch(md(s))]).toEqual([label, readMilestoneScanFetch(md(l))]);
  });

  test("AC-.1 defaults: readTrackerConfig", () => {
    for (const [label, s, l] of cases()) {
      expect([label, readTrackerConfig(join(s, "specs"))]).toEqual([label, readTrackerConfig(join(l, "specs"))]);
    }
  });

  test("AC-.1 defaults: readVideoStyle", () => {
    for (const [label, s, l] of cases()) expect([label, readVideoStyle(s)]).toEqual([label, readVideoStyle(l)]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-707.2 — the defect case
// ---------------------------------------------------------------------------

describe("AC-STE-707.2 the defect case: settings `mode: linear`, no `## Task Tracking` heading", () => {
  test("AC-.2 buildResolverConfig resolves the Linear adapter", () => {
    const root = settingsTree({ schema_version: 1, min_dpt_version: "2.0.0", task_tracking: { mode: "linear" } });
    expect(readFileSync(md(root), "utf8")).not.toContain("## Task Tracking");
    const keys = buildResolverConfig(md(root), ADAPTERS_DIR).trackers.map((t) => t.key);
    expect(keys).toEqual(["linear"]);
  });

  test("AC-.2 readTokenStatsConfig returns enabled: true when the settings declare it", () => {
    const root = settingsTree({
      schema_version: 1,
      min_dpt_version: "2.0.0",
      task_tracking: { mode: "linear" },
      tracking: { token_stats: { enabled: true } },
    });
    expect(readTokenStatsConfig(md(root))).toEqual({ enabled: true });
  });
});

// ---------------------------------------------------------------------------
// Hook helpers (AC-.5, AC-.6, AC-.12)
// ---------------------------------------------------------------------------

const SESSION = "s-707-synthetic";

function writeTranscript(dir: string, lines: unknown[]): string {
  const file = join(dir, `transcript-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length > 0 ? "\n" : ""));
  return file;
}

function usageTranscript(dir: string): string {
  const line = (skill: string | null, n: number) => {
    const l: Record<string, unknown> = {
      type: "assistant",
      timestamp: "2026-11-04T12:00:00.000Z",
      sessionId: SESSION,
      gitBranch: "main",
      message: {
        role: "assistant",
        model: "claude-synthetic-1",
        usage: { input_tokens: n, output_tokens: n + 1, cache_read_input_tokens: n + 2, cache_creation_input_tokens: n + 3 },
      },
    };
    if (skill !== null) {
      l.attributionSkill = skill;
      l.attributionPlugin = "dev-process-toolkit";
    }
    return l;
  };
  return writeTranscript(dir, [line("dev-process-toolkit:implement", 10), line(null, 5)]);
}

async function runWrapper(wrapper: string, pluginRoot: string, payload: string, cwd: string): Promise<Run> {
  const proc = Bun.spawn(["bash", wrapper], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_CODE_SESSION_ID: SESSION },
    stdin: new Response(payload).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

function readLedger(root: string): unknown[] {
  const p = ledgerPath(root);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

async function runLedger(root: string, pluginRoot = PLUGIN, wrapper = LEDGER_WRAPPER): Promise<{ run: Run; rows: unknown[] }> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ste707-tx-")));
  ROOTS.push(scratch);
  const payload = JSON.stringify({ session_id: SESSION, transcript_path: usageTranscript(scratch), cwd: root, hook_event_name: "SessionEnd" });
  const run = await runWrapper(wrapper, pluginRoot, payload, root);
  return { run, rows: readLedger(root) };
}

const JIRA_CREATE = { cloudId: "synthetic.atlassian.net", projectKey: "SYN", issueTypeName: "Task", summary: "Synthetic untagged create" };
const LINEAR_CREATE = { title: "Synthetic untagged create", team: "SYN", project: "Synthetic Project" };

async function runGate(
  root: string,
  adapter: "jira" | "linear",
  pluginRoot = PLUGIN,
  wrapper = GATE_WRAPPER,
): Promise<Run> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ste707-tx-")));
  ROOTS.push(scratch);
  const payload = JSON.stringify({
    session_id: SESSION,
    transcript_path: writeTranscript(scratch, []),
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: adapter === "jira" ? "mcp__atlassian__createJiraIssue" : "mcp__linear__save_issue",
    tool_input: adapter === "jira" ? JIRA_CREATE : LINEAR_CREATE,
  });
  return runWrapper(wrapper, pluginRoot, payload, scratch);
}

const SHARED_JIRA_BINDING = { project: "SYN", default_labels: ["syn-be"], repo_tag: "syn-be", min_dpt_version: "2.87.0" };
const SHARED_JIRA_MD = [
  "# Synthetic Project",
  "",
  "## Task Tracking",
  "",
  "mode: jira",
  "mcp_server: atlassian",
  "",
  "### Jira",
  "",
  "project: SYN",
  "default_labels: [syn-be]",
  "repo_tag: syn-be",
  "min_dpt_version: 2.87.0",
  "",
].join("\n");

function sharedJiraSettings(): Record<string, unknown> {
  return {
    schema_version: 1,
    min_dpt_version: "2.0.0",
    task_tracking: { mode: "jira", mcp_server: "atlassian", jira: SHARED_JIRA_BINDING },
    tracking: { token_stats: { enabled: true } },
  };
}

function gitTree(files: Record<string, string>): string {
  const root = tree(files);
  git(root, "init", "-q", "-b", "main");
  return root;
}

// ---------------------------------------------------------------------------
// AC-STE-707.5 — the hooks through the shipped wrappers
// ---------------------------------------------------------------------------

describe("AC-STE-707.5 hooks through the shipped wrappers on settings-file trees", () => {
  test("AC-.5 session-token-ledger.sh writes rows when tracking.token_stats.enabled is true and no ## Token Stats exists", async () => {
    const root = gitTree({
      "specs/settings.yaml": toSettingsYaml({ schema_version: 1, min_dpt_version: "2.0.0", tracking: { token_stats: { enabled: true } } }),
      "CLAUDE.md": PROSE_MD,
    });
    const { run, rows } = await runLedger(root);
    expect(run.code).toBe(0);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("AC-.5 pre-tracker-write-gate.sh refuses an untagged create declared only in the settings file, as for CLAUDE.md", async () => {
    const legacy = gitTree({ "CLAUDE.md": SHARED_JIRA_MD });
    const settings = gitTree({ "specs/settings.yaml": toSettingsYaml(sharedJiraSettings()), "CLAUDE.md": PROSE_MD });
    const l = await runGate(legacy, "jira");
    expect(l.code).toBe(2);
    expect(l.stderr).toContain("Refusing:");
    const s = await runGate(settings, "jira");
    expect({ code: s.code, stdout: norm(s.stdout, settings), stderr: norm(s.stderr, settings) }).toEqual({
      code: l.code,
      stdout: norm(l.stdout, legacy),
      stderr: norm(l.stderr, legacy),
    });
  });

  test("AC-.5 the binding stub in CLAUDE.md is never read as a second home: the same refusal", async () => {
    const legacy = gitTree({ "CLAUDE.md": SHARED_JIRA_MD });
    const settingsObj = sharedJiraSettings();
    const stub = renderTrackingStub({ task_tracking: settingsObj.task_tracking as { mode: string } & Record<string, unknown> });
    expect(stub).toContain("## Task Tracking");
    const settings = gitTree({ "specs/settings.yaml": toSettingsYaml(settingsObj), "CLAUDE.md": `${PROSE_MD}\n${stub}` });
    const l = await runGate(legacy, "jira");
    const s = await runGate(settings, "jira");
    expect(s.code).toBe(2);
    expect({ code: s.code, stdout: norm(s.stdout, settings), stderr: norm(s.stderr, settings) }).toEqual({
      code: l.code,
      stdout: norm(l.stdout, legacy),
      stderr: norm(l.stderr, legacy),
    });
  });

  test("AC-.5 both homes: the gate refuses a tracker create naming both homes; the ledger writes no row and exits 0", async () => {
    const root = gitTree({
      "specs/settings.yaml": toSettingsYaml(sharedJiraSettings()),
      "CLAUDE.md": `${PROSE_MD}\n## Docs\n\nuser_facing_mode: false\n`,
    });
    const gate = await runGate(root, "jira");
    expect(gate.code).toBe(2);
    expect(gate.stderr).toContain("Refusing:");
    expect(gate.stderr).toContain("specs/settings.yaml");
    expect(gate.stderr).toContain("CLAUDE.md");
    expect(gate.stderr).toMatch(/two homes|both homes/);
    const { run, rows } = await runLedger(root);
    expect(run.code).toBe(0);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-707.6 — citations name the home the value came from
// ---------------------------------------------------------------------------

describe("AC-STE-707.6 citations name specs/settings.yaml and the key path, or CLAUDE.md on a legacy tree", () => {
  test("AC-.6 readVerificationConfig closed-key refusal", () => {
    const s = settingsTree({
      schema_version: 1,
      min_dpt_version: "2.0.0",
      verification: { verify_skill: "smoke-test", bogus_key: "1" },
    });
    const se = thrown(() => readVerificationConfig(md(s)));
    expect(se.message).toContain("specs/settings.yaml");
    expect(se.message).toContain("verification.bogus_key");
    const l = tree({ "CLAUDE.md": "# Synthetic\n\n## Verification\n\nverify_skill: smoke-test\nbogus_key: 1\n" });
    const le = thrown(() => readVerificationConfig(md(l)));
    expect(le.message).toContain("## Verification");
    expect(le.message).not.toContain("specs/settings.yaml");
  });

  test("AC-.6 readWorkspaceBinding declaration refusal", () => {
    const s = settingsTree({
      schema_version: 1,
      min_dpt_version: "2.0.0",
      task_tracking: { mode: "jira", jira: { project: "SYN", default_labels: ["syn-be"], repo_tag: "syn-be" } },
    });
    const se = thrown(() => readWorkspaceBinding(md(s), "jira"));
    expect(se.message).toContain("specs/settings.yaml");
    expect(se.message).toContain("task_tracking.jira");
    expect(se.message).not.toContain("file=CLAUDE.md");
    const l = tree({ "CLAUDE.md": "# Synthetic\n\n## Task Tracking\n\nmode: jira\n\n### Jira\n\nproject: SYN\ndefault_labels: [syn-be]\nrepo_tag: syn-be\n" });
    const le = thrown(() => readWorkspaceBinding(md(l), "jira"));
    expect(le.message).toContain("file=CLAUDE.md");
    expect(le.message).not.toContain("specs/settings.yaml");
  });

  test("AC-.6 pre-tracker-write-gate declaration remedy", async () => {
    const malformed = { project: "SYN", default_labels: ["syn-be"], repo_tag: "syn-be" };
    const s = gitTree({
      "specs/settings.yaml": toSettingsYaml({ schema_version: 1, min_dpt_version: "2.0.0", task_tracking: { mode: "jira", jira: malformed } }),
      "CLAUDE.md": PROSE_MD,
    });
    const sr = await runGate(s, "jira");
    expect(sr.code).toBe(2);
    const sRemedy = sr.stderr.split("\n").find((x) => x.startsWith("Remedy:")) ?? "";
    expect(sRemedy).toContain("specs/settings.yaml");
    expect(sRemedy).toContain("task_tracking.jira");
    expect(sRemedy).not.toContain("CLAUDE.md");
    const l = gitTree({ "CLAUDE.md": "# Synthetic\n\n## Task Tracking\n\nmode: jira\n\n### Jira\n\nproject: SYN\ndefault_labels: [syn-be]\nrepo_tag: syn-be\n" });
    const lr = await runGate(l, "jira");
    expect(lr.code).toBe(2);
    const lRemedy = lr.stderr.split("\n").find((x) => x.startsWith("Remedy:")) ?? "";
    expect(lRemedy).toContain("CLAUDE.md");
    expect(lRemedy).not.toContain("specs/settings.yaml");
  });

  test("AC-.6 read_adapter_name mode remedy", () => {
    const s = settingsTree({ schema_version: 1, min_dpt_version: "2.0.0", task_tracking: { mode: "bogus" } });
    const se = thrown(() => readAdapterName(md(s), ADAPTERS_DIR, "bogus"));
    const sRemedy = se.message.split("\n").find((x) => x.startsWith("Remedy:")) ?? "";
    expect(sRemedy).toContain("specs/settings.yaml");
    expect(sRemedy).toContain("task_tracking.mode");
    expect(sRemedy).not.toContain("## Task Tracking");
    const l = tree({ "CLAUDE.md": "# Synthetic\n\n## Task Tracking\n\nmode: bogus\n" });
    const le = thrown(() => readAdapterName(md(l), ADAPTERS_DIR, "bogus"));
    const lRemedy = le.message.split("\n").find((x) => x.startsWith("Remedy:")) ?? "";
    expect(lRemedy).toContain("CLAUDE.md");
    expect(lRemedy).toContain("## Task Tracking");
  });

  test("AC-.6 plan_ship_coherence `## Docs` clause", async () => {
    const plan = "---\nmilestone: M1\nstatus: archived\narchived_at: 2026-11-01T00:00:00Z\nshipped_in: unreleased\n---\n\n# M1 — Synthetic\n";
    const changelog = "# Changelog\n\n## [1.0.0] — 2026-11-01 — \"Synthetic\"\n\n- synthetic\n";
    const s = settingsTree(
      { schema_version: 1, min_dpt_version: "2.0.0", docs: { changelog_unversioned: false } },
      { "specs/plan/archive/M1.md": plan, "CHANGELOG.md": changelog },
    );
    const sv = (await runPlanShipCoherenceProbe(s)).violations.find((v) => v.kind === "corrupt_stamp");
    expect(sv).toBeDefined();
    expect(sv!.message).toContain("specs/settings.yaml");
    expect(sv!.message).toContain("docs.changelog_unversioned");
    expect(sv!.message).not.toContain("## Docs");
    const l = tree({
      "CLAUDE.md": "# Synthetic\n\n## Docs\n\nchangelog_unversioned: false\n",
      "specs/plan/archive/M1.md": plan,
      "CHANGELOG.md": changelog,
    });
    const lv = (await runPlanShipCoherenceProbe(l)).violations.find((v) => v.kind === "corrupt_stamp");
    expect(lv).toBeDefined();
    expect(lv!.message).toContain("CLAUDE.md");
    expect(lv!.message).toContain("## Docs");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-707.7 — the release_config.ts front door
// ---------------------------------------------------------------------------

// A byte copy of this repository's v2.101.4 `## Release Files` block (CLAUDE.md at 8b107a45).
const RELEASE_BLOCK_V2_101_4 = [
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: plugins/dev-process-toolkit/.claude-plugin/plugin.json",
  "    kind: json",
  "    field: version",
  "  - path: .claude-plugin/marketplace.json",
  "    kind: json",
  "    field: plugins[0].version",
  "  - path: CHANGELOG.md",
  "    kind: changelog",
  "  - path: README.md",
  "    kind: regex",
  "    pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — \"(?<codename>[^\"]+)\"'",
  "    replace: 'Latest: **v{version} — \"{codename}\"'",
  "    optional: true",
  "  - path: specs/requirements.md",
  "    kind: regex",
  "    pattern: '\\*\\*Latest shipped release:\\*\\* \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) \\(\"(?<codename>[^\"]+)\"\\)\\*\\*'",
  "    replace: '**Latest shipped release:** **v{version} (\"{codename}\")**'",
  "```",
  "",
].join("\n");

const FIVE_PATHS = [
  "plugins/dev-process-toolkit/.claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "CHANGELOG.md",
  "README.md",
  "specs/requirements.md",
];

/** The five release surfaces, each holding the anchor its bumper rewrites. */
const FIVE_FILES: Record<string, string> = {
  "plugins/dev-process-toolkit/.claude-plugin/plugin.json": `${JSON.stringify({ name: "synthetic", version: "1.0.0" }, null, 2)}\n`,
  ".claude-plugin/marketplace.json": `${JSON.stringify({ name: "synthetic", plugins: [{ name: "synthetic", version: "1.0.0" }] }, null, 2)}\n`,
  "CHANGELOG.md": "# Changelog\n\n## [1.0.0] — 2026-11-01 — \"Synthetic\"\n\n### Added\n\n- synthetic\n",
  "README.md": "# Synthetic\n\nLatest: **v1.0.0 — \"Synthetic\"**\n",
  "specs/requirements.md": "# Requirements\n\n**Latest shipped release:** **v1.0.0 (\"Synthetic\")**\n",
};

const RELEASE_ARGS = ["9.9.9", "--codename", "Twin", "--date", "2026-11-04", "--body", "synthetic body", "--test-count", "1,0,0", "--dry-run"];

/** The paths a dry run reports, in order. */
function reported(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((l) => /^would rewrite (.+) \(dry-run\)$/.exec(l)?.[1])
    .filter((p): p is string => p !== undefined);
}

describe("AC-STE-707.7 release_config.ts reads release.files from either home", () => {
  test("AC-.7 the byte copy is this repository's v2.101.4 block", () => {
    const r = Bun.spawnSync(["git", "-C", REPO_ROOT, "show", `${V2_101_4}:CLAUDE.md`], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    expect(r.stdout.toString()).toContain(RELEASE_BLOCK_V2_101_4);
  });

  test("AC-.7 legacy fixture holding the v2.101.4 block reports the five entries", () => {
    const l = tree({ "CLAUDE.md": `# Synthetic\n\n${RELEASE_BLOCK_V2_101_4}`, ...FIVE_FILES });
    const r = spawnBun([RELEASE_DOOR, l, ...RELEASE_ARGS]);
    expect(r.code, r.stderr).toBe(0);
    expect(reported(r.stdout)).toEqual(FIVE_PATHS);
  });

  test("AC-.7 a settings-file tree's release.files drives the front door", () => {
    const files = [
      { path: FIVE_PATHS[0], kind: "json", field: "version" },
      { path: FIVE_PATHS[1], kind: "json", field: "plugins[0].version" },
      { path: FIVE_PATHS[2], kind: "changelog" },
      {
        path: FIVE_PATHS[3],
        kind: "regex",
        pattern: 'Latest: \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) — "(?<codename>[^"]+)"',
        replace: 'Latest: **v{version} — "{codename}"',
        optional: true,
      },
      {
        path: FIVE_PATHS[4],
        kind: "regex",
        pattern: '\\*\\*Latest shipped release:\\*\\* \\*\\*v(?<version>\\d+\\.\\d+\\.\\d+) \\("(?<codename>[^"]+)"\\)\\*\\*',
        replace: '**Latest shipped release:** **v{version} ("{codename}")**',
      },
    ];
    const s = settingsTree({ schema_version: 1, min_dpt_version: "2.0.0", release: { files } }, FIVE_FILES);
    const l = tree({ "CLAUDE.md": `# Synthetic\n\n${RELEASE_BLOCK_V2_101_4}`, ...FIVE_FILES });
    const sr = spawnBun([RELEASE_DOOR, s, ...RELEASE_ARGS]);
    expect(sr.code, sr.stderr).toBe(0);
    expect(reported(sr.stdout)).toEqual(FIVE_PATHS);
    const lr = spawnBun([RELEASE_DOOR, l, ...RELEASE_ARGS]);
    expect(norm(sr.stdout, s)).toBe(norm(lr.stdout, l));
  });

  test("AC-.7 run on this repository's own tree it reports the five entries", () => {
    const r = spawnBun([RELEASE_DOOR, REPO_ROOT, ...RELEASE_ARGS]);
    expect(r.code, r.stderr).toBe(0);
    expect(reported(r.stdout)).toEqual(FIVE_PATHS);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-707.9 — mixed homes across a span
// ---------------------------------------------------------------------------

describe("AC-STE-707.9 spans_repos across a settings-file repository and a legacy sibling", () => {
  function settingsSide(root: string, mode: "linear" | "jira"): void {
    const binding =
      mode === "linear"
        ? { team: FIXTURE_TRACKER_TEAM, project: FIXTURE_TRACKER_PROJECT, default_labels: [TAG_A], repo_tag: TAG_A, min_dpt_version: FLOOR }
        : { project: FIXTURE_TRACKER_PROJECT, default_labels: [TAG_A], repo_tag: TAG_A, min_dpt_version: FLOOR };
    writeFileSync(
      join(root, "specs", "settings.yaml"),
      toSettingsYaml({ schema_version: 1, min_dpt_version: "2.0.0", task_tracking: { mode, mcp_server: mode, [mode]: binding } }),
    );
    writeFileSync(join(root, "CLAUDE.md"), PROSE_MD);
  }

  test("AC-.9 same mode and project pass the mode and project checks", async () => {
    const pair = makeDeclarePair("M_syn707");
    try {
      settingsSide(pair.a, "linear");
      const v = await verifySpan({ invokingRepo: pair.a, planFile: pair.planA, milestone: "M_syn707", siblingPath: pair.b, dryRun: true });
      expect(v.invokingTag).toBe(TAG_A);
      expect(v.siblingTag).toBe(TAG_B);
    } finally {
      pair.cleanup();
    }
  });

  test("AC-.9 a mode mismatch across the two homes still refuses, naming the settings-file side's mode", async () => {
    const pair = makeDeclarePair("M_syn707");
    try {
      settingsSide(pair.a, "jira");
      let message = "<no refusal>";
      try {
        await verifySpan({ invokingRepo: pair.a, planFile: pair.planA, milestone: "M_syn707", siblingPath: pair.b, dryRun: true });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toContain("the tracker modes differ");
      expect(message).toContain("binds mode `jira`");
      expect(message).toContain("binds mode `linear`");
    } finally {
      pair.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-707.12 — legacy isolation, graded against the v2.101.4 hooks
// ---------------------------------------------------------------------------

describe("AC-STE-707.12 legacy isolation through the shipped wrappers equals v2.101.4", () => {
  let oldPlugin = "";

  beforeAll(() => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "ste707-v2-101-4-")));
    ROOTS.push(dir);
    const r = Bun.spawnSync(
      [
        "bash",
        "-c",
        `git -C "$1" archive "$2" plugins/dev-process-toolkit/adapters plugins/dev-process-toolkit/templates plugins/dev-process-toolkit/.claude-plugin | tar -x -C "$3"`,
        "extract",
        REPO_ROOT,
        V2_101_4,
        dir,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (r.exitCode !== 0) throw new Error(`extracting v2.101.4 failed: ${r.stderr.toString()}`);
    oldPlugin = join(dir, "plugins", "dev-process-toolkit");
  });

  const oldWrapper = (name: string): string => join(oldPlugin, "templates", "hooks", "process", name);

  /** Run the ledger and the gate under v2.101.4 and under this tree; both must agree byte for byte. */
  async function expectSameAsV2_101_4(root: string, adapter: "jira" | "linear"): Promise<void> {
    const oldLedger = await runLedger(root, oldPlugin, oldWrapper("session-token-ledger.sh"));
    rmSync(ledgerPath(root), { force: true });
    const newLedger = await runLedger(root);
    expect(oldLedger.run.code).toBe(0);
    expect(oldLedger.rows.length).toBeGreaterThan(0);
    expect(newLedger.run).toEqual(oldLedger.run);
    expect(newLedger.rows).toEqual(oldLedger.rows);

    const oldGate = await runGate(root, adapter, oldPlugin, oldWrapper("pre-tracker-write-gate.sh"));
    const newGate = await runGate(root, adapter);
    expect(oldGate.code).toBe(2);
    expect(newGate).toEqual(oldGate);
  }

  const SHARED_LINEAR_MD = [
    "# Synthetic Project",
    "",
    "## Task Tracking",
    "",
    "mode: linear",
    "mcp_server: linear",
    "",
    "### Linear",
    "",
    "team: SYN",
    "project: Synthetic Project",
    "default_labels: [syn-be]",
    "repo_tag: syn-be",
    "min_dpt_version: 2.87.0",
    "",
  ].join("\n");
  const TOKEN_STATS_ON = "## Token Stats\n\nenabled: true\n";

  test("AC-.12 an unknown ## Verification key: same ledger rows and same gate decision as v2.101.4 (shared Jira)", async () => {
    const root = gitTree({
      "CLAUDE.md": `${SHARED_JIRA_MD}\n## Verification\n\nverify_skill: smoke-test\nbogus_key: 1\n\n${TOKEN_STATS_ON}`,
    });
    await expectSameAsV2_101_4(root, "jira");
  });

  test("AC-.12 valid ## Verification, malformed specs/tracker-config.yaml: same as v2.101.4 on a Linear tree", async () => {
    const root = gitTree({
      "CLAUDE.md": `${SHARED_LINEAR_MD}\n## Verification\n\nverify_skill: smoke-test\n\n${TOKEN_STATS_ON}`,
      "specs/tracker-config.yaml": "tracker_key: linear\nstatuses: []\nroles: {}\n",
    });
    await expectSameAsV2_101_4(root, "linear");
  });

  test("AC-.12 valid ## Verification, malformed specs/tracker-config.yaml: same as v2.101.4 on a shared Jira tree", async () => {
    const root = gitTree({
      "CLAUDE.md": `${SHARED_JIRA_MD}\n## Verification\n\nverify_skill: smoke-test\n\n${TOKEN_STATS_ON}`,
      "specs/tracker-config.yaml": "tracker_key: jira\nstatuses: []\nroles: {}\n",
    });
    await expectSameAsV2_101_4(root, "jira");
  });
});
