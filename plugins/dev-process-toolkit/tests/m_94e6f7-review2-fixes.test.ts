// M_94e6f7 review round 2 — regression rows for the reviewer's DO-NOT-MERGE
// findings on b5a56eee. Each describe names the finding it pins:
//
//   R2-B3   beside a legacy home, specs/settings.yaml is the toolkit's only
//           when it carries a column-0 `min_dpt_version:` line. Without it the
//           file is the project's own: every reader, the tracker-write hook
//           and the ledger behave as v2.101.5 (dbdb9572) does, and /upgrade's
//           move refuses without touching it.
//   R2-B3b  an unreadable settings file on an un-upgraded tree refuses
//           nothing; on a migrated tree it still refuses (round-1 #3).
//   R2-F1   every registry entry's `changed` set names exactly the files its
//           apply wrote, on legacy and migrated trees (/upgrade stages exactly
//           that set).
//
// "Byte-equal to dbdb9572" is graded as byte-equal to the same tree with no
// settings file: the v2.101.5 readers ignore specs/settings.yaml, and the
// review-1 T5 rows pin a legacy tree's reads to literals captured from
// dbdb9572. Fixtures are synthetic. No skips, no todos.

import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { readDocsConfig } from "../adapters/_shared/src/docs_config";
import { readMilestoneScanFetch } from "../adapters/_shared/src/milestone_scan_fetch_config";
import { MIGRATIONS } from "../adapters/_shared/src/migrations/index";
import { readOrchestrationConfig } from "../adapters/_shared/src/orchestration_config";
import {
  detectSettingsSource,
  isForeignSettingsFile,
  loadProjectSettings,
  renderSettingsPointer,
  SettingsShapeError,
} from "../adapters/_shared/src/project_settings";
import { readReleaseFiles } from "../adapters/_shared/src/release_config";
import { readTaskTrackingSection } from "../adapters/_shared/src/resolver_config";
import { readTokenStatsConfig } from "../adapters/_shared/src/token_stats_config";
import { ledgerPath } from "../adapters/_shared/src/token_usage";
import { SETUP_MARKER } from "../adapters/_shared/src/toolkit_managed";
import { readTrackerConfig } from "../adapters/_shared/src/tracker_config";
import { readVerificationConfig, resolveVerifyMode } from "../adapters/_shared/src/verification_config";
import { readVideoStyle } from "../adapters/_shared/src/video/style";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";

const PLUGIN = resolve(import.meta.dir, "..");
const SETTINGS = "specs/settings.yaml";

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) {
    try {
      chmodSync(join(r, SETTINGS), 0o644);
    } catch {
      /* absent */
    }
    rmSync(r, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "m94-r2-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function copyTree(src: string): string {
  const root = mkdtempSync(join(tmpdir(), "m94-r2c-"));
  ROOTS.push(root);
  cpSync(src, root, { recursive: true });
  return root;
}

function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== ".git") walk(abs);
      } else out.set(relative(root, abs), readFileSync(abs, "utf8"));
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

const INTRO = [SETUP_MARKER, "# Synthetic Project", "", "Synthetic intro prose.", ""];
const OUTRO = ["## Notes", "", "Synthetic closing prose.", ""];
const legacy = (...sections: string[][]): string => [...INTRO, ...sections.flat(), ...OUTRO].join("\n");

const H_TT = ["## Task Tracking", "", "mode: linear", "mcp_server: linear", "jira_ac_field:", "", "### Linear", "", "team: SYN", "project: Synthetic Project", ""];
const H_VERIFICATION = ["## Verification", "", "verify_skill: smoke-test", "verify_mode: manual", "run_cmd: none", ""];
const H_DOCS = ["## Docs", "", "user_facing_mode: true", "packages_mode: false", ""];
const H_ORCH = ["## Orchestration", "", "default_effort: high", "merge_policy: never", ""];
const H_TOKEN = ["## Token Stats", "", "enabled: true", ""];
const H_RELEASE = ["## Release Files", "", "```yaml", "files:", "  - path: package.json", "    kind: json", "    field: version", "```", ""];
const LEGACY_MD = legacy(H_TT, ["milestone_scan_fetch: true", ""], H_VERIFICATION, H_DOCS, H_ORCH, H_TOKEN, H_RELEASE);
const TRACKER_CONFIG =
  "tracker_key: linear\nstatuses:\n  - Backlog\n  - Doing\n  - Done\nroles:\n  initial: Backlog\n  in_progress: Doing\n  in_review: Doing\n  done: Done\n";

/** Every settings reader the v2.101.5 tree had, plus release (no v2.101.5 reader; graded against its legacy read). */
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

function runHook(root: string, hook: string, tool: string, input: unknown): { code: number; out: string } {
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
  const r = Bun.spawnSync(["bash", join(PLUGIN, "templates", "hooks", "process", `${hook}.sh`)], {
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
  ["mcp__linear__save_issue", { title: "synthetic", team: "SYN" }],
  ["mcp__linear__save_milestone", { name: "synthetic", project: "Synthetic Project" }],
  ["mcp__atlassian__createJiraIssue", { projectKey: "SYN", summary: "synthetic", issueType: "Task" }],
];

function trackerHooks(root: string): Array<{ code: number; out: string }> {
  return TRACKER_WRITES.map(([tool, input]) => runHook(root, "pre-tracker-write-gate", tool, input));
}

function usageLine(skill: string | null, n: number): string {
  const line: Record<string, unknown> = {
    type: "assistant",
    timestamp: "2026-07-06T12:00:00.000Z",
    sessionId: "s-r2",
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
      JSON.stringify({ session_id: "s-r2", transcript_path: transcript, cwd: root, hook_event_name: "SessionEnd" }),
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
// R2-B3 — the marker rule beside a legacy home
// ---------------------------------------------------------------------------

/** A project's own specs/settings.yaml shapes the review named, none with a column-0 min_dpt_version line. */
const FOREIGN_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ["release section (reviewer repro b3r)", "schema_version: 1\nrelease:\n  channel: beta\n"],
  ["docs section", "schema_version: 1\ndocs:\n  site: synthetic\n"],
  ["orchestration section", "schema_version: 1\norchestration:\n  workers: 4\n"],
  ["video section", "schema_version: 1\nvideo:\n  codec: h264\n"],
  ["tracking section", "schema_version: 1\ntracking:\n  analytics: on\n"],
  ["verification section", "schema_version: 1\nverification:\n  lint: strict\n"],
  ["task_tracking section", "schema_version: 1\ntask_tracking:\n  board: synthetic\n"],
  ["close_out section", "schema_version: 1\nclose_out:\n  notify: team\n"],
  ["quoted keys", '"schema_version": 1\n"docs":\n  site: synthetic\n'],
  ["unparseable YAML with column-0 schema_version", "schema_version: 1\ndocs: [unclosed\n"],
  ["multi-document with column-0 schema_version", "schema_version: 1\n---\ndocs:\n  site: synthetic\n"],
  ["byte-order mark", "﻿schema_version: 1\ndocs:\n  site: synthetic\n"],
  ["indented min_dpt_version", 'schema_version: 1\napp:\n  min_dpt_version: "3.0.0"\ndocs:\n  site: synthetic\n'],
  ["plain app key", "schema_version: 1\napp:\n  name: synthetic\n"],
];

describe("R2-B3 beside a legacy home, a settings file without column-0 min_dpt_version is the project's own", () => {
  const BASE_FILES = { "CLAUDE.md": LEGACY_MD, "specs/requirements.md": "# Synthetic requirements\n", "specs/tracker-config.yaml": TRACKER_CONFIG };

  for (const [name, body] of FOREIGN_VARIANTS) {
    test(`R2-B3 ${name}: foreign, source legacy, every reader byte-equal to the tree without the file`, () => {
      const root = tree(BASE_FILES);
      const base = JSON.stringify(readAll(root));
      expect(base).not.toContain("THROW");
      writeFileSync(join(root, SETTINGS), body);
      expect(isForeignSettingsFile(root)).toBe(true);
      expect(detectSettingsSource(root)).toBe("legacy");
      expect(loadProjectSettings(root).source).toBe("legacy");
      expect(JSON.stringify(readAll(root))).toBe(base);
    });

    test(`R2-B3 ${name}: the tracker-write hook (3 tools) and the ledger behave as without the file`, () => {
      const root = tree(BASE_FILES);
      const hooksBase = trackerHooks(root);
      const ledgerBase = runLedger(root);
      expect(ledgerBase.rows.length).toBeGreaterThan(0);
      writeFileSync(join(root, SETTINGS), body);
      expect(trackerHooks(root)).toEqual(hooksBase);
      expect(runLedger(root)).toEqual(ledgerBase);
    });
  }

  test("R2-B3 /upgrade's move refuses beside the reviewer's b3r file, names it, and touches nothing", () => {
    const root = tree({ ...BASE_FILES, [SETTINGS]: FOREIGN_VARIANTS[0]![1] });
    const before = snapshot(root);
    const r = entry("settings-file").apply(root);
    expect(r.changed).toEqual([]);
    expect(r.summary).toMatch(/Refusing: specs\/settings\.yaml exists and is not a toolkit settings file/);
    expect(r.summary).not.toMatch(/min_dpt_version is required/);
    expect(snapshot(root)).toEqual(before);
  });

  test("R2-B3 /upgrade's preview names the foreign file first, so the refusal is no surprise", () => {
    const root = tree({ ...BASE_FILES, [SETTINGS]: FOREIGN_VARIANTS[0]![1] });
    const d = entry("settings-file").detect(root);
    expect(d.applies).toBe(true);
    expect(d.evidence[0]).toMatch(/^specs\/settings\.yaml — exists and is not a toolkit settings file .*the move refuses until it is renamed/);
  });

  test("R2-B3 control: with no settings file the preview carries no foreign-file row", () => {
    const d = entry("settings-file").detect(tree(BASE_FILES));
    expect(d.applies).toBe(true);
    expect(d.evidence.some((e) => /not a toolkit settings file/.test(e))).toBe(false);
  });

  test("R2-B3 control: the same legacy tree with a column-0 min_dpt_version file is the toolkit's and refuses two homes", () => {
    const root = tree({ ...BASE_FILES, [SETTINGS]: 'schema_version: 1\nmin_dpt_version: "3.0.0"\ndocs:\n  user_facing_mode: true\n' });
    expect(isForeignSettingsFile(root)).toBe(false);
    expect(detectSettingsSource(root)).toBe("both");
    expect(() => loadProjectSettings(root)).toThrow(SettingsShapeError);
  });

  test("R2-B3 control: with no legacy home the marker rule applies too (review R3-B1: schema_version plus a toolkit section is foreign)", () => {
    const root = tree({ [SETTINGS]: "schema_version: 1\ndocs:\n  user_facing_mode: true\n" });
    expect(isForeignSettingsFile(root)).toBe(true);
    expect(() => loadProjectSettings(root)).not.toThrow();
    expect(loadProjectSettings(root).source).toBe("none");
  });

  test("R2-B3 control: a migrated tree (## Project Settings pointer, stub heading) whose file lost min_dpt_version still refuses, never reads as foreign", () => {
    const md = legacy(["## Project Settings", "", renderSettingsPointer("3.0.0").replace(/\n$/, ""), ""], ["## Task Tracking", "", "mode: linear", ""]);
    const root = tree({ "CLAUDE.md": md, [SETTINGS]: "schema_version: 1\ntask_tracking:\n  mode: linear\n" });
    expect(isForeignSettingsFile(root)).toBe(false);
    expect(() => loadProjectSettings(root)).toThrow(/min_dpt_version/);
  });

  test("R2-B3 the move always writes a column-0 min_dpt_version line", () => {
    const md = legacy(H_TT, H_VERIFICATION, H_DOCS, H_ORCH, H_TOKEN, H_RELEASE);
    const root = tree({ "CLAUDE.md": md, "specs/requirements.md": "# Synthetic requirements\n" });
    const r = entry("settings-file").apply(root);
    expect(r.summary).not.toMatch(/Refusing/);
    expect(readFileSync(join(root, SETTINGS), "utf8")).toMatch(/^min_dpt_version: /m);
    expect(isForeignSettingsFile(root)).toBe(false);
    expect(detectSettingsSource(root)).toBe("settings");
  });
});

// ---------------------------------------------------------------------------
// R2-B3b — an unreadable settings file
// ---------------------------------------------------------------------------

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("R2-B3b an unreadable settings file refuses only on a migrated tree", () => {
  test("R2-B3b un-upgraded tree: an unreadable file is ignored; readers, the hook and the ledger match the tree without it", () => {
    const root = tree({ "CLAUDE.md": LEGACY_MD, "specs/requirements.md": "# Synthetic requirements\n" });
    const base = JSON.stringify(readAll(root));
    const hooksBase = trackerHooks(root);
    const ledgerBase = runLedger(root);
    writeFileSync(join(root, SETTINGS), "schema_version: 1\napp:\n  name: synthetic\n");
    chmodSync(join(root, SETTINGS), 0o000);
    try {
      if (isRoot) return; // root reads through mode 000: unreadability cannot be provoked.
      expect(isForeignSettingsFile(root)).toBe(true);
      expect(detectSettingsSource(root)).toBe("legacy");
      expect(JSON.stringify(readAll(root))).toBe(base);
      expect(trackerHooks(root)).toEqual(hooksBase);
      expect(runLedger(root)).toEqual(ledgerBase);
    } finally {
      chmodSync(join(root, SETTINGS), 0o644);
    }
  });

  test("R2-B3b migrated tree (## Project Settings): an unreadable file still refuses naming it (round-1 #3)", () => {
    const md = legacy(["## Project Settings", "", renderSettingsPointer("3.0.0").replace(/\n$/, ""), ""], ["## Task Tracking", "", "mode: jira", ""]);
    const root = tree({ "CLAUDE.md": md, [SETTINGS]: 'schema_version: 1\nmin_dpt_version: "3.0.0"\ntask_tracking:\n  mode: linear\n' });
    chmodSync(join(root, SETTINGS), 0o000);
    try {
      if (isRoot) return;
      expect(isForeignSettingsFile(root)).toBe(false);
      expect(() => readTaskTrackingSection(join(root, "CLAUDE.md"))).toThrow(/^Refusing: specs\/settings\.yaml cannot be read/);
    } finally {
      chmodSync(join(root, SETTINGS), 0o644);
    }
  });
});

// ---------------------------------------------------------------------------
// R2-F1 — the changed set is the set of files written
// ---------------------------------------------------------------------------

/** One tree that makes every script entry of the registry detect, in `mode` (linear or none). */
function triggerFiles(mode: "linear" | "none"): Record<string, string> {
  const tt =
    mode === "linear"
      ? ["## Task Tracking", "", "mode: linear", "mcp_server: linear", "jira_ac_field:", "", "### Linear", "", "team: Synthetic Team", "project: Synthetic Project", "", "### Sync log", "", "- a v1 row", ""]
      : ["## Task Tracking", "", "mode: none", "", "### Sync log", "", "- a v1 row", ""];
  return {
    "CLAUDE.md": legacy(tt, ["## Verification", "", "verify_skill: smoke-test", "verify_mode: manual", ""]),
    "specs/requirements.md": "# Synthetic requirements\n",
    "specs/.dpt-layout": "v1\n",
    "specs/INDEX.md": "# Synthetic index\n",
    ".claude/settings.json": `${JSON.stringify(
      {
        permissions: { allow: ["Bash(bun *)"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash", args: ["${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/pre-commit-gate-check.sh"] }] }] },
      },
      null,
      2,
    )}\n`,
    // Amended by AC-STE-716.20 (M_7bc805): capture-registration is appended after settings-file.
    // One capture entry with the key absent, so the entry detects and its apply unregisters.
    ".claude/settings.local.json": `${JSON.stringify(
      {
        hooks: {
          PreToolUse: [{ matcher: "Bash|Skill", hooks: [{ type: "command", command: "exec '/opt/synthetic/plugin/templates/hooks/process/tool-call-capture.sh'; exit 0", timeout: 2 }] }],
          PostToolUse: [{ matcher: "Bash|Skill", hooks: [{ type: "command", command: "exec '/opt/synthetic/plugin/templates/hooks/process/tool-call-capture.sh'; exit 0", timeout: 2 }] }],
        },
      },
      null,
      2,
    )}\n`,
    ".dpt-locks/M1.lock": "synthetic\n",
    ".dev-process/token-ledger.jsonl": "{}\n",
    ".gitignore": "node_modules/\n.dev-process/\n",
    ".dpt/.gitignore": "ledger/\n",
    "specs/frs/SYN-12.md": "---\ntitle: Synthetic\nmilestone: M1\nstatus: active\ntracker:\n  linear: SYN-12\n---\n\n# Synthetic\n",
    "specs/plan/M1.md": "---\nmilestone: M1\nstatus: active\n---\n\n# M1\n",
  };
}

/** The trigger tree as a legacy tree, or migrated: the move runs on its CLAUDE.md first, then the other triggers land. */
function triggerTree(mode: "linear" | "none", shape: "legacy" | "migrated"): string {
  const files = triggerFiles(mode);
  if (shape === "legacy") return tree(files);
  const md = files["CLAUDE.md"]!.replace("### Sync log\n\n- a v1 row\n", "");
  const root = tree({ "CLAUDE.md": md, "specs/requirements.md": files["specs/requirements.md"]! });
  const moved = entry("settings-file").apply(root);
  if (/Refusing/.test(moved.summary)) throw new Error(`the move refused building the migrated fixture:\n${moved.summary}`);
  for (const [rel, body] of Object.entries(files)) {
    if (rel === "CLAUDE.md") continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

/** The project-relative files whose bytes differ (added, edited or removed). */
function writtenFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k)).sort();
}

/** A changed entry names a file, or a directory that holds the file. */
const covers = (changed: readonly string[], file: string): boolean =>
  changed.some((c) => file === c || file.startsWith(`${c.replace(/\/$/, "")}/`));

describe("R2-F1 every registry entry's changed set names exactly the files it wrote", () => {
  const SHAPES = [
    ["linear", "legacy"],
    ["linear", "migrated"],
    ["none", "legacy"],
    ["none", "migrated"],
  ] as const;
  const applied = new Map<string, string[]>();

  /** Apply `e` on `root` and grade the tree diff against its changed set; null when it refused. */
  function audit(root: string, e: (typeof MIGRATIONS)[number], label: string): string | null | "refused" {
    const before = snapshot(root);
    const r = e.apply!(root);
    const written = writtenFiles(before, snapshot(root));
    if (/Refusing/.test(r.summary)) {
      expect(written).toEqual([]);
      return "refused";
    }
    applied.set(e.id, [...(applied.get(e.id) ?? []), label]);
    const uncovered = written.filter((f) => !covers(r.changed, f));
    const unwritten = r.changed.filter((c) => !written.some((f) => covers([c], f)));
    return uncovered.length > 0 || unwritten.length > 0
      ? `${e.id}: changed=${JSON.stringify(r.changed)} written=${JSON.stringify(written)}`
      : null;
  }
  const scriptEntries = () => MIGRATIONS.filter((e) => e.kind === "script" && typeof e.apply === "function");

  for (const [mode, shape] of SHAPES) {
    test(`R2-F1 ${mode} ${shape}: each entry applied alone; the tree diff equals its changed set`, () => {
      const template = triggerTree(mode, shape);
      const mismatches: string[] = [];
      for (const e of scriptEntries()) {
        const root = copyTree(template);
        if (!e.detect(root).applies) continue;
        // An entry may refuse alone while an earlier entry's state is pending (the sequential walk grades it).
        const m = audit(root, e, `${mode}/${shape}`);
        if (typeof m === "string" && m !== "refused") mismatches.push(m);
      }
      expect(mismatches).toEqual([]);
    });

    test(`R2-F1 ${mode} ${shape}: the whole registry walked in order; each applied entry's diff equals its changed set`, () => {
      const root = triggerTree(mode, shape);
      const mismatches: string[] = [];
      for (const e of scriptEntries()) {
        if (!e.detect(root).applies) continue;
        const m = audit(root, e, `${mode}/${shape}`);
        expect(m === "refused" ? `${e.id} refused during the walk` : "ok").toBe("ok");
        if (m !== null && m !== "refused") mismatches.push(m);
      }
      expect(mismatches).toEqual([]);
    });
  }

  test("R2-F1 coverage: every script entry applied at least once, and linear-team-key on a migrated tree", () => {
    const scripts = MIGRATIONS.filter((e) => e.kind === "script").map((e) => e.id);
    expect(scripts.filter((id) => !applied.has(id))).toEqual([]);
    expect(applied.get("linear-team-key")).toContain("linear/migrated");
    expect(applied.get("mode-none-sequential-milestone")).toContain("none/migrated");
  });

  test("R2-F1 linear-team-key on a migrated tree names specs/settings.yaml in changed, evidence and summary", () => {
    const root = triggerTree("linear", "migrated");
    const e = entry("linear-team-key");
    const d = e.detect(root);
    expect(d.applies).toBe(true);
    expect(d.evidence.join("\n")).toMatch(/^specs\/settings\.yaml — /);
    const r = e.apply(root);
    expect(r.changed).toContain(SETTINGS);
    expect(r.summary).toMatch(/^specs\/settings\.yaml: /);
    expect(readWorkspaceBinding(join(root, "CLAUDE.md"), "linear").team).toBe("SYN");
  });

  test("R2-F1 control: linear-team-key on a legacy tree still names CLAUDE.md alone", () => {
    const root = triggerTree("linear", "legacy");
    const r = entry("linear-team-key").apply(root);
    expect(r.changed).toEqual(["CLAUDE.md"]);
    expect(r.summary).toMatch(/^CLAUDE\.md: /);
  });

  test("R2-F1 mode-none-sequential-milestone names the renamed plan's old path beside the new one", () => {
    const root = triggerTree("none", "legacy");
    const r = entry("mode-none-sequential-milestone").apply(root);
    expect(r.changed).toContain(join("specs", "plan", "M1.md"));
    expect(existsSync(join(root, "specs", "plan", "M1.md"))).toBe(false);
  });
});
