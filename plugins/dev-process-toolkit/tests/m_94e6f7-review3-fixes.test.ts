// M_94e6f7 review round 3 — regression rows for the reviewer's DO-NOT-MERGE
// finding on 3d3daded, and its LOW follow-up:
//
//   R3-B1   a tree is migrated only when CLAUDE.md's `## Project Settings`
//           section holds the pointer line the move writes. On every other
//           tree, specs/settings.yaml is the toolkit's ONLY with a column-0
//           `min_dpt_version:` line; anything else is the project's own file,
//           and every reader, the tracker-write hook (3 tools) and the ledger
//           behave as v2.101.5 (dbdb9572) does. The two shapes the round-2
//           rule missed: (a) no legacy home at all (no CLAUDE.md, or a
//           hand-written one), (b) a legacy tree whose only toolkit section is
//           `## Task Tracking`, beside the user's OWN `## Project Settings`.
//   R3-LOW  a migrated tree whose `## Project Settings` section was deleted
//           still refuses a file that lost min_dpt_version, when CLAUDE.md
//           keeps a line only a 3.x settings-file writer writes.
//
// "Byte-equal to dbdb9572" is graded as byte-equal to the same tree with no
// settings file: the v2.101.5 readers never open specs/settings.yaml (the
// reviewer's harness diffed the real dbdb9572 plugin over the same matrix).
// Fixtures are synthetic. No skips, no todos.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { readDocsConfig } from "../adapters/_shared/src/docs_config";
import { readMilestoneScanFetch } from "../adapters/_shared/src/milestone_scan_fetch_config";
import { SETTINGS_COMMENT_POINTER } from "../adapters/_shared/src/migrations/legacy_paths";
import { MIGRATIONS } from "../adapters/_shared/src/migrations/index";
import { readOrchestrationConfig } from "../adapters/_shared/src/orchestration_config";
import {
  detectSettingsSource,
  isForeignSettingsFile,
  loadProjectSettings,
  renderSettingsPointer,
  renderTrackingStub,
  writeProjectSettings,
} from "../adapters/_shared/src/project_settings";
import { readReleaseFiles } from "../adapters/_shared/src/release_config";
import { readTaskTrackingSection } from "../adapters/_shared/src/resolver_config";
import { planTemplateCopy } from "../adapters/_shared/src/setup/template_copy";
import { readTokenStatsConfig } from "../adapters/_shared/src/token_stats_config";
import { ledgerPath } from "../adapters/_shared/src/token_usage";
import { readTrackerConfig } from "../adapters/_shared/src/tracker_config";
import { readVerificationConfig, resolveVerifyMode } from "../adapters/_shared/src/verification_config";
import { readVideoStyle } from "../adapters/_shared/src/video/style";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";

const PLUGIN = resolve(import.meta.dir, "..");
const SETTINGS = "specs/settings.yaml";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) {
    try {
      chmodSync(join(r, SETTINGS), 0o644);
    } catch {
      /* absent or a directory */
    }
    rmSync(r, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "m94-r3-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else out.set(relative(root, abs), readFileSync(abs, "utf8"));
    }
  };
  walk(root);
  return out;
}

function entry(id: string) {
  const e = MIGRATIONS.find((m) => m.id === id);
  if (e === undefined) throw new Error(`no ${id} entry`);
  return e;
}

/** Every settings reader the v2.101.5 tree had, plus release. */
function readAll(root: string): Record<string, unknown> {
  const mdPath = join(root, "CLAUDE.md");
  const out: Record<string, unknown> = {};
  const t = (name: string, f: () => unknown): void => {
    try {
      out[name] = f();
    } catch (e) {
      out[name] = `THROW: ${(e as Error).message}`;
    }
  };
  t("docs", () => readDocsConfig(mdPath));
  t("orch", () => readOrchestrationConfig(root));
  t("verif", () => readVerificationConfig(mdPath));
  t("verifyMode", () => resolveVerifyMode(mdPath));
  t("tokenStats", () => readTokenStatsConfig(mdPath));
  t("tracker", () => readTrackerConfig(join(root, "specs")));
  t("wsLinear", () => readWorkspaceBinding(mdPath, "linear"));
  t("wsJira", () => readWorkspaceBinding(mdPath, "jira"));
  t("msf", () => readMilestoneScanFetch(mdPath));
  t("tt", () => readTaskTrackingSection(mdPath));
  t("release", () => readReleaseFiles(root, () => readFileSync(mdPath, "utf8")));
  t("videoStyle", () => readVideoStyle(root));
  return out;
}

function runHook(root: string, tool: string, input: unknown): { code: number; out: string } {
  const transcript = join(root, ".t-empty.jsonl");
  if (!existsSync(transcript)) writeFileSync(transcript, "");
  const payload = JSON.stringify({
    session_id: "s1",
    transcript_path: transcript,
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: input,
  });
  const r = Bun.spawnSync(["bash", join(PLUGIN, "templates", "hooks", "process", "pre-tracker-write-gate.sh")], {
    cwd: root,
    stdin: new TextEncoder().encode(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode ?? -1, out: `${r.stdout.toString()}${r.stderr.toString()}` };
}

/** The tracker-write tools the gate covers: a Linear create, a Linear milestone write, a Jira create. */
const TRACKER_WRITES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["mcp__linear__save_issue", { title: "synthetic", team: "SYN", project: "Synthetic Project" }],
  ["mcp__linear__save_milestone", { name: "synthetic", project: "Synthetic Project" }],
  ["mcp__atlassian__createJiraIssue", { projectKey: "SYN", summary: "synthetic", issueType: "Task" }],
];

function trackerHooks(root: string): Array<{ code: number; out: string }> {
  return TRACKER_WRITES.map(([tool, input]) => runHook(root, tool, input));
}

function usageLine(skill: string | null, n: number): string {
  const line: Record<string, unknown> = {
    type: "assistant",
    timestamp: "2026-07-06T12:00:00.000Z",
    sessionId: "s-r3",
    gitBranch: "main",
    message: {
      role: "assistant",
      model: "claude-fable-5",
      usage: { input_tokens: n, output_tokens: n, cache_read_input_tokens: n, cache_creation_input_tokens: n },
    },
  };
  if (skill !== null) {
    line.attributionSkill = skill;
    line.attributionPlugin = "dev-process-toolkit";
  }
  return JSON.stringify(line);
}

/** Run the ledger hook once and return {exit, stderr, rows}; the ledger file is removed afterwards. */
function runLedger(root: string): { code: number; stderr: string; rows: unknown[] } {
  const transcript = join(root, ".t-usage.jsonl");
  writeFileSync(transcript, `${[usageLine("dev-process-toolkit:implement", 3), usageLine(null, 5)].join("\n")}\n`);
  const r = Bun.spawnSync(["bash", join(PLUGIN, "templates", "hooks", "process", "session-token-ledger.sh")], {
    cwd: root,
    stdin: new TextEncoder().encode(
      JSON.stringify({ session_id: "s-r3", transcript_path: transcript, cwd: root, hook_event_name: "SessionEnd" }),
    ),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: root },
    stdout: "pipe",
    stderr: "pipe",
  });
  const path = ledgerPath(root);
  const rows = existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => {
          const row = JSON.parse(l) as Record<string, unknown>;
          delete row.recorded_at;
          delete row.ts;
          return row;
        })
    : [];
  rmSync(path, { force: true });
  return { code: r.exitCode ?? -1, stderr: r.stderr.toString(), rows };
}

// ---------------------------------------------------------------------------
// Fixtures: the reviewer's tree shapes and file shapes
// ---------------------------------------------------------------------------

const TT_LINEAR = ["## Task Tracking", "", "mode: linear", "mcp_server: linear", "jira_ac_field:", "", "### Linear", "", "team: SYN", "project: Synthetic Project", ""];

/** CLAUDE.md shapes on trees that never ran /upgrade. `null` = no CLAUDE.md. */
const UNMIGRATED_SHAPES: ReadonlyArray<readonly [string, string | null]> = [
  ["(a) no CLAUDE.md", null],
  ["(a) hand-written CLAUDE.md with no toolkit section", "# Hand-written project\n\nSome notes.\n"],
  ["(b) the user's own ## Project Settings heading only", "# Proj\n\n## Project Settings\n\nApp config is in specs/settings.yaml.\n"],
  [
    "(b) only ## Task Tracking beside the user's own ## Project Settings",
    ["# Proj", "", "## Project Settings", "", "We keep our app settings in specs/settings.yaml.", "", ...TT_LINEAR].join("\n"),
  ],
];

const BOM = String.fromCharCode(0xfeff);

/** File shapes with no column-0 `min_dpt_version:` line. `UNREAD` / `DIR` are built, not written. */
const FOREIGN_FILES: ReadonlyArray<readonly [string, string]> = [
  ["schema_version + release:", "schema_version: 1\nrelease:\n  channel: beta\n"],
  ["schema_version + docs:", "schema_version: 1\ndocs:\n  site: https://x.invalid\n"],
  ["schema_version + tracking:", "schema_version: 1\ntracking:\n  ga: UA-1\n"],
  ["schema_version + task_tracking:", "schema_version: 2\ntask_tracking:\n  board: x\n"],
  ["schema_version + video: behind a BOM", `${BOM}schema_version: 1\nvideo:\n  fps: 30\n`],
  ["quoted keys", '"schema_version": 1\n"orchestration":\n  workers: 4\n'],
  ["unparseable YAML", "schema_version: 1\napp: [unclosed\n"],
  ["multi-document", "---\nschema_version: 1\ndocs: {}\n---\nother: 1\n"],
  ["plain app config", "schema_version: 1\napp:\n  name: synthetic\n"],
  ["indented min_dpt_version only", "app:\n  min_dpt_version: 3.0.0\n"],
  ["UNREAD", "schema_version: 1\nrelease:\n  channel: beta\n"],
  ["DIR", ""],
];

function placeFile(root: string, kind: string, body: string): boolean {
  const p = join(root, SETTINGS);
  mkdirSync(dirname(p), { recursive: true });
  if (kind === "DIR") {
    mkdirSync(p, { recursive: true });
    return true;
  }
  writeFileSync(p, body);
  if (kind === "UNREAD") {
    if (isRoot) return false; // root reads through mode 000: unreadability cannot be provoked.
    chmodSync(p, 0o000);
  }
  return true;
}

function unmigratedTree(md: string | null): string {
  const files: Record<string, string> = { "specs/requirements.md": "# Synthetic requirements\n" };
  if (md !== null) files["CLAUDE.md"] = md;
  return tree(files);
}

const POINTER = renderSettingsPointer("3.0.0").replace(/\n$/, "");
const MIN_FILE = 'schema_version: 1\nmin_dpt_version: "3.0.0"\n';

// ---------------------------------------------------------------------------
// R3-B1 — the matrix
// ---------------------------------------------------------------------------

describe("R3-B1 a tree that never ran /upgrade ignores a settings file with no column-0 min_dpt_version", () => {
  for (const [shape, md] of UNMIGRATED_SHAPES) {
    for (const [kind, body] of FOREIGN_FILES) {
      test(`R3-B1 ${shape} × ${kind}: readers, 3 tracker-write tools and the ledger match the tree without the file`, () => {
        const root = unmigratedTree(md);
        const readers = JSON.stringify(readAll(root));
        const hooks = trackerHooks(root);
        const ledger = runLedger(root);
        if (!placeFile(root, kind, body)) return;
        expect(isForeignSettingsFile(root)).toBe(true);
        expect(JSON.stringify(readAll(root))).toBe(readers);
        expect(trackerHooks(root)).toEqual(hooks);
        expect(runLedger(root)).toEqual(ledger);
      }, 30_000);
    }
  }

  test("R3-B1 /upgrade's move on shape (b) refuses naming the foreign file, and touches nothing", () => {
    const [, md] = UNMIGRATED_SHAPES[3]!;
    for (const [kind, body] of FOREIGN_FILES) {
      if (kind === "UNREAD" || kind === "DIR") continue;
      const root = unmigratedTree(md);
      placeFile(root, kind, body);
      const before = snapshot(root);
      const d = entry("settings-file").detect(root);
      expect(d.evidence[0]).toMatch(/^specs\/settings\.yaml — exists and is not a toolkit settings file/);
      const r = entry("settings-file").apply(root);
      expect(r.summary).toMatch(/Refusing: specs\/settings\.yaml exists and is not a toolkit settings file/);
      expect(snapshot(root)).toEqual(before);
    }
  });

  test("R3-B1 control: on the same unmigrated shapes a column-0 min_dpt_version file IS the toolkit's", () => {
    for (const [, md] of UNMIGRATED_SHAPES) {
      const root = unmigratedTree(md);
      writeFileSync(join(root, SETTINGS), MIN_FILE);
      expect(isForeignSettingsFile(root)).toBe(false);
    }
  });

  test("R3-B1 control: a drifted pointer line is not the badge (only the rendered pointer is)", () => {
    const md = ["# Proj", "", "## Project Settings", "", "Project settings live in `specs/settings.yaml`.", ""].join("\n");
    const root = tree({ "CLAUDE.md": md, [SETTINGS]: "schema_version: 1\ndocs:\n  user_facing_mode: true\n" });
    expect(isForeignSettingsFile(root)).toBe(true);
    expect(detectSettingsSource(root)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// R3-B1 — a migrated tree stays strict
// ---------------------------------------------------------------------------

describe("R3-B1 a migrated tree (the pointer line under ## Project Settings) keeps the strict loader", () => {
  const migratedMd = (floor = "3.0.0"): string =>
    ["# Proj", "", "## Project Settings", "", renderSettingsPointer(floor).replace(/\n$/, ""), "", "## Notes", "", "Synthetic.", ""].join("\n");

  test("R3-B1 migrated: every file shape without min_dpt_version is the toolkit's and refuses", () => {
    for (const [kind, body] of FOREIGN_FILES) {
      const root = tree({ "CLAUDE.md": migratedMd() });
      if (!placeFile(root, kind, body)) continue;
      expect(isForeignSettingsFile(root)).toBe(false);
      expect(() => loadProjectSettings(root)).toThrow(/^Refusing: /);
    }
  });

  test("R3-B1 migrated: an unreadable file and a directory refuse as 'cannot be read'", () => {
    const dir = tree({ "CLAUDE.md": migratedMd() });
    placeFile(dir, "DIR", "");
    expect(() => loadProjectSettings(dir)).toThrow(/specs\/settings\.yaml cannot be read/);
    if (isRoot) return;
    const unread = tree({ "CLAUDE.md": migratedMd(), [SETTINGS]: MIN_FILE });
    chmodSync(join(unread, SETTINGS), 0o000);
    expect(() => loadProjectSettings(unread)).toThrow(/specs\/settings\.yaml cannot be read/);
  });

  test("R3-B1 migrated: a file that lost min_dpt_version refuses naming the key", () => {
    const root = tree({ "CLAUDE.md": migratedMd(), [SETTINGS]: "schema_version: 1\ntask_tracking:\n  mode: none\n" });
    expect(() => loadProjectSettings(root)).toThrow(/min_dpt_version/);
  });

  test("R3-B1 migrated: the pointer rendered for any floor is the badge", () => {
    const root = tree({ "CLAUDE.md": migratedMd("3.4.12"), [SETTINGS]: "schema_version: 1\napp:\n  name: synthetic\n" });
    expect(isForeignSettingsFile(root)).toBe(false);
  });

  test("R3-B1 migrated: a keyed legacy home beside a marked file still refuses two homes", () => {
    const md = migratedMd().replace("## Notes", "## Docs\n\nuser_facing_mode: true\n\n## Notes");
    const root = tree({ "CLAUDE.md": md, [SETTINGS]: MIN_FILE });
    expect(detectSettingsSource(root)).toBe("both");
    expect(() => loadProjectSettings(root)).toThrow(/^Refusing: /);
  });

  test("R3-B1 the shipped CLAUDE.md template carries the badge, so a fresh 3.x tree is strict", () => {
    const template = readFileSync(join(PLUGIN, "templates", "CLAUDE.md.template"), "utf8");
    expect(template.split("\n")).toContain(POINTER);
    const root = tree({ "CLAUDE.md": template, [SETTINGS]: "schema_version: 1\napp:\n  name: synthetic\n" });
    expect(isForeignSettingsFile(root)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R3-B1 — every 3.x writer writes the column-0 marker
// ---------------------------------------------------------------------------

describe("R3-B1 every 3.x settings writer leaves a column-0 min_dpt_version line", () => {
  test("R3-B1 /setup's create on a tree with no CLAUDE.md", () => {
    const root = tree({ "specs/requirements.md": "# Synthetic requirements\n" });
    writeProjectSettings(root, { schema_version: 1, min_dpt_version: "3.0.0" }, { create: true });
    expect(readFileSync(join(root, SETTINGS), "utf8")).toMatch(/^min_dpt_version: /m);
    expect(isForeignSettingsFile(root)).toBe(false);
    expect(detectSettingsSource(root)).toBe("settings");
  });

  test("R3-B1 the set verb keeps the marker", () => {
    const root = tree({ "CLAUDE.md": "# Proj\n", [SETTINGS]: MIN_FILE });
    const r = Bun.spawnSync(
      ["bun", "run", join(PLUGIN, "adapters", "_shared", "src", "project_settings.ts"), "set", "verification.verify_skill", "smoke-test", root],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
    const text = readFileSync(join(root, SETTINGS), "utf8");
    expect(text).toMatch(/verify_skill: smoke-test/);
    expect(text).toMatch(/^min_dpt_version: /m);
    expect(isForeignSettingsFile(root)).toBe(false);
  });

  test("R3-B1 the move writes the marker and the badge", () => {
    const md = ["# Proj", "", ...TT_LINEAR, "## Docs", "", "user_facing_mode: true", "packages_mode: false", "changelog_ci_owned: false", ""].join("\n");
    const root = tree({ "CLAUDE.md": md, "specs/requirements.md": "# Synthetic requirements\n" });
    const r = entry("settings-file").apply(root);
    expect(r.summary).not.toMatch(/Refusing/);
    expect(readFileSync(join(root, SETTINGS), "utf8")).toMatch(/^min_dpt_version: /m);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8").split("\n")).toContain(
      renderSettingsPointer(/^min_dpt_version: "?([^"\n]+)"?$/m.exec(readFileSync(join(root, SETTINGS), "utf8"))![1]!).replace(/\n$/, ""),
    );
    expect(detectSettingsSource(root)).toBe("settings");
  });

  test("R3-B1 the template copy carries the template's marker line through", () => {
    const template = tree({
      "CLAUDE.md": readFileSync(join(PLUGIN, "templates", "CLAUDE.md.template"), "utf8"),
      [SETTINGS]: `${MIN_FILE}docs:\n  user_facing_mode: true\n`,
    });
    const target = tree({ "specs/requirements.md": "# Synthetic requirements\n" });
    const plan = planTemplateCopy(template, target, { mode: "per-category", selection: ["CLAUDE.md", SETTINGS] });
    expect(plan.files[SETTINGS]).toMatch(/^min_dpt_version: /m);
  });
});

// ---------------------------------------------------------------------------
// R3-LOW — a migrated tree that lost its ## Project Settings section
// ---------------------------------------------------------------------------

describe("R3-LOW a migrated tree without ## Project Settings still refuses a file that lost min_dpt_version", () => {
  const LOST_MIN = "schema_version: 1\ntask_tracking:\n  mode: linear\n  mcp_server: linear\n  linear:\n    team: SYN\n    project: Synthetic Project\n";

  test("R3-LOW the 3.x tracking stub alone keeps the tree migrated", () => {
    const stub = renderTrackingStub({ task_tracking: { mode: "linear", linear: { team: "SYN", project: "Synthetic Project" } } });
    const root = tree({ "CLAUDE.md": `# Proj\n\n${stub}`, [SETTINGS]: LOST_MIN });
    expect(isForeignSettingsFile(root)).toBe(false);
    expect(() => loadProjectSettings(root)).toThrow(/min_dpt_version/);
    expect(() => readDocsConfig(join(root, "CLAUDE.md"))).toThrow(/min_dpt_version/);
  });

  test("R3-LOW the move's comment pointer alone keeps the tree migrated", () => {
    const root = tree({ "CLAUDE.md": `# Proj\n\n${SETTINGS_COMMENT_POINTER}\n`, [SETTINGS]: LOST_MIN });
    expect(isForeignSettingsFile(root)).toBe(false);
    expect(() => readTokenStatsConfig(join(root, "CLAUDE.md"))).toThrow(/min_dpt_version/);
  });

});
