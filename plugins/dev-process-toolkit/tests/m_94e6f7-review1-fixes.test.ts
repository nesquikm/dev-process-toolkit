// M_94e6f7 review round 1 — regression rows for the reviewer's DO-NOT-MERGE
// findings on the v3.0.0 settings move. Each describe names the finding it pins:
//
//   B1  a second /upgrade walk must not splice a setting back into a kept
//       CLAUDE.md heading (verification-run-keys had no settings-file arm).
//   B2  a column-0 key line inside an HTML comment is read by the v2.101.5
//       readers, so the move takes its value and strips only that line.
//   B3  a project's own specs/settings.yaml (schema_version but no toolkit
//       key) is foreign: a tree that never ran /upgrade reads as trunk does.
//   #4  a malformed section breaks only its own readers.
//   #3  an unreadable settings file refuses; it never reads as absent.
//   #2  the add-workspace script prints a refusal, not a stack trace.
//
// Fixtures are synthetic. No skips, no todos.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  SettingsShapeError,
} from "../adapters/_shared/src/project_settings";
import { parseMilestoneScanFetch, parseDocsConfig } from "../adapters/_shared/src/project_settings_legacy";
import { readReleaseFiles } from "../adapters/_shared/src/release_config";
import { readTaskTrackingSection } from "../adapters/_shared/src/resolver_config";
import { readTokenStatsConfig } from "../adapters/_shared/src/token_stats_config";
import { SETUP_MARKER } from "../adapters/_shared/src/toolkit_managed";
import { readTrackerConfig } from "../adapters/_shared/src/tracker_config";
import { runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";
import { readVerificationConfig } from "../adapters/_shared/src/verification_config";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";

const PLUGIN = resolve(import.meta.dir, "..");

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) {
    try {
      chmodSync(join(r, "specs", "settings.yaml"), 0o644);
    } catch {
      /* absent */
    }
    rmSync(r, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "m94-r1-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== ".git") walk(abs);
      } else out[relative(root, abs)] = readFileSync(abs, "utf8");
    }
  };
  walk(root);
  return out;
}

/** Apply every script entry of the live registry whose detector applies, in order; a refusal throws. */
function walkRegistry(root: string): string[] {
  const changed: string[] = [];
  for (const e of MIGRATIONS) {
    if (e.kind !== "script" || typeof e.apply !== "function") continue;
    if (!e.detect(root).applies) continue;
    const r = e.apply(root);
    if (/Refusing:/.test(r.summary)) throw new Error(`${e.id} refused during the walk:\n${r.summary}`);
    changed.push(...r.changed.map((c) => `${e.id}:${c}`));
  }
  return changed;
}

function entry(id: string) {
  const e = MIGRATIONS.find((m) => m.id === id);
  if (e === undefined) throw new Error(`no ${id} entry`);
  return e;
}

const md = (root: string): string => readFileSync(join(root, "CLAUDE.md"), "utf8");
const settingsRaw = (root: string): Record<string, any> =>
  Bun.YAML.parse(readFileSync(join(root, "specs", "settings.yaml"), "utf8")) as Record<string, any>;

const INTRO = [SETUP_MARKER, "# Synthetic Project", "", "Synthetic intro prose.", ""];
const OUTRO = ["## Notes", "", "Synthetic closing prose.", ""];
const legacy = (...sections: string[][]): string => [...INTRO, ...sections.flat(), ...OUTRO].join("\n");

const H_TT = ["## Task Tracking", "", "mode: linear", "mcp_server: linear", "jira_ac_field:", "", "### Linear", "", "team: SYN", "project: Synthetic Project", ""];
const H_VERIFICATION = ["## Verification", "", "verify_skill: smoke-test", "verify_mode: manual", "run_cmd: bun run dev", "", "Operator prose kept under Verification.", ""];
const H_DOCS = ["## Docs", "", "user_facing_mode: true", "packages_mode: false", "", "Operator prose kept under Docs.", ""];
const H_ORCH = ["## Orchestration", "", "default_effort: high", "merge_policy: never", "", "Operator prose kept under Orchestration.", ""];
const H_TOKEN = ["## Token Stats", "", "enabled: true", "", "Operator prose kept under Token Stats.", ""];
const H_RELEASE = [
  "## Release Files",
  "",
  "```yaml",
  "files:",
  "  - path: package.json",
  "    kind: json",
  "    field: version",
  "```",
  "",
  "Operator prose kept under Release Files.",
  "",
];

// ---------------------------------------------------------------------------
// B1 — the second walk on a migrated tree with prose under a moved heading
// ---------------------------------------------------------------------------

describe("B1 verification-run-keys never writes CLAUDE.md on a settings-file tree", () => {
  const KEPT = legacy(["## Verification", "", "Operator prose kept under Verification.", ""]);
  const SETTINGS = 'schema_version: 1\nmin_dpt_version: "3.0.0"\nverification:\n  run_cmd: bun run dev\n';

  test("B1 detect is false when specs/settings.yaml is the home, though the kept heading declares no run_cmd", () => {
    const root = tree({ "CLAUDE.md": KEPT, "specs/settings.yaml": SETTINGS });
    expect(detectSettingsSource(root)).toBe("settings");
    expect(entry("verification-run-keys").detect(root)).toEqual({ applies: false, evidence: [] });
    const before = md(root);
    entry("verification-run-keys").apply!(root);
    expect(md(root)).toBe(before);
  });

  test("B1 control: the same CLAUDE.md with no settings file still gets run_cmd: none (trunk behaviour)", () => {
    const root = tree({ "CLAUDE.md": KEPT });
    expect(entry("verification-run-keys").detect(root).applies).toBe(true);
  });

  const ROWS: { name: string; sections: string[][] }[] = [
    { name: "## Verification", sections: [H_VERIFICATION] },
    { name: "## Docs", sections: [H_DOCS] },
    { name: "## Orchestration", sections: [H_ORCH] },
    { name: "## Token Stats", sections: [H_TOKEN] },
    { name: "## Release Files", sections: [H_RELEASE] },
    { name: "every moved heading at once", sections: [H_TT, H_VERIFICATION, H_DOCS, H_ORCH, H_TOKEN, H_RELEASE] },
  ];
  for (const row of ROWS) {
    test(`B1 whole-registry walk, prose kept under ${row.name}: migrate, then a second walk is byte-identical and probe #69 is empty`, async () => {
      const root = tree({ "CLAUDE.md": legacy(...row.sections) });
      walkRegistry(root);
      expect(detectSettingsSource(root)).toBe("settings");
      const after1 = snapshot(root);
      expect(walkRegistry(root)).toEqual([]);
      expect(snapshot(root)).toEqual(after1);
      expect((await runUpgradeStalenessProbe(root)).rows).toEqual([]);
    });
  }

  test("B1 prose under ## Task Tracking: the move refuses naming the line, writes nothing, and the refusal is stable", () => {
    const root = tree({ "CLAUDE.md": legacy([...H_TT, "Operator prose kept under Task Tracking.", ""]) });
    const before = snapshot(root);
    const r1 = entry("settings-file").apply!(root);
    expect(r1.summary).toMatch(/^Refusing:/);
    expect(r1.summary).toMatch(/CLAUDE\.md:\d+ — `Operator prose kept under Task Tracking\.`/);
    expect(snapshot(root)).toEqual(before);
    expect(entry("settings-file").apply!(root).summary).toBe(r1.summary);
  });
});

// ---------------------------------------------------------------------------
// B2 — key lines inside an HTML comment
// ---------------------------------------------------------------------------

describe("B2 a column-0 key line inside a comment is a setting everywhere: detect, move and both-homes agree", () => {
  const commented = (value: string): string =>
    legacy(["<!-- ops note: synthetic", `milestone_scan_fetch: ${value}`, "-->", ""], H_DOCS);

  for (const value of ["true", "false"] as const) {
    test(`B2 milestone_scan_fetch: ${value} inside a kept comment: the value moves, only that line leaves the comment, no second home`, async () => {
      const root = tree({ "CLAUDE.md": commented(value) });
      const trunk = parseMilestoneScanFetch(join(root, "CLAUDE.md"));
      expect(trunk).toBe(value === "true");
      const d = entry("settings-file").detect(root);
      expect(d.evidence.some((e) => /CLAUDE\.md:\d+ — `milestone_scan_fetch:` moves/.test(e))).toBe(true);
      const r = entry("settings-file").apply!(root);
      expect(r.summary).not.toMatch(/Refusing:/);
      expect(r.summary).toContain("its moved key lines removed");
      expect(settingsRaw(root).task_tracking.milestone_scan_fetch).toBe(trunk);
      expect(md(root)).toContain("<!-- ops note: synthetic\n-->");
      expect(md(root)).not.toContain("milestone_scan_fetch:");
      expect(detectSettingsSource(root)).toBe("settings");
      expect(readMilestoneScanFetch(join(root, "CLAUDE.md"))).toBe(trunk);
      const after1 = snapshot(root);
      expect(walkRegistry(root)).toEqual([]);
      expect(snapshot(root)).toEqual(after1);
      expect((await runUpgradeStalenessProbe(root)).rows).toEqual([]);
    });
  }

  test("B2 a recognised key line inside a comment under a moved heading moves too (trunk reads it)", () => {
    const docs = ["## Docs", "", "<!-- synthetic note", "user_facing_mode: true", "-->", "packages_mode: false", "", "Operator prose kept under Docs.", ""];
    const root = tree({ "CLAUDE.md": legacy(docs) });
    expect(parseDocsConfig(join(root, "CLAUDE.md")).userFacingMode).toBe(true);
    const r = entry("settings-file").apply!(root);
    expect(r.summary).not.toMatch(/Refusing:/);
    expect(settingsRaw(root).docs.user_facing_mode).toBe(true);
    expect(md(root)).toContain("<!-- synthetic note\n-->");
    expect(detectSettingsSource(root)).toBe("settings");
    expect(readDocsConfig(join(root, "CLAUDE.md")).userFacingMode).toBe(true);
  });

  test("B2 a key line that carries a comment marker cannot be stripped alone: step 0 refuses naming CLAUDE.md:<line>", () => {
    const root = tree({ "CLAUDE.md": legacy(["<!-- ops note: synthetic", "milestone_scan_fetch: true -->", ""], H_DOCS) });
    const before = snapshot(root);
    const r = entry("settings-file").apply!(root);
    expect(r.summary).toMatch(/^Refusing:/);
    expect(r.summary).toMatch(/CLAUDE\.md:7 — /);
    expect(snapshot(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// B3 — a project's own specs/settings.yaml on a tree that never ran /upgrade
// ---------------------------------------------------------------------------

function runHook(root: string, hook: string, tool: string, input: unknown): { code: number; out: string } {
  // The gate reads declarations under the cwd's git top level only.
  if (!existsSync(join(root, ".git"))) Bun.spawnSync(["git", "init", "-q", root]);
  const transcript = join(root, ".git", "empty-transcript.jsonl");
  writeFileSync(transcript, "");
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
  t("tokenStats", () => readTokenStatsConfig(mdPath));
  t("tracker", () => readTrackerConfig(join(root, "specs")));
  t("wsLinear", () => readWorkspaceBinding(mdPath, "linear"));
  t("msf", () => readMilestoneScanFetch(mdPath));
  t("tt", () => readTaskTrackingSection(mdPath));
  t("release", () => readReleaseFiles(root, () => readFileSync(mdPath, "utf8")));
  return out;
}

describe("B3 a foreign specs/settings.yaml leaves an un-upgraded tree reading as trunk", () => {
  const LEGACY = legacy(H_TT, ["milestone_scan_fetch: true", ""], H_VERIFICATION, H_DOCS, H_ORCH, H_TOKEN, H_RELEASE);
  const FOREIGN = "schema_version: 1\napp:\n  name: synthetic\n";

  test("B3 schema_version plus a non-toolkit key is foreign; the source stays legacy", () => {
    const root = tree({ "CLAUDE.md": LEGACY, "specs/settings.yaml": FOREIGN });
    expect(isForeignSettingsFile(root)).toBe(true);
    expect(detectSettingsSource(root)).toBe("legacy");
  });

  test("B3 every reader returns byte-equal values with and without the foreign file", () => {
    const root = tree({ "CLAUDE.md": LEGACY, "specs/requirements.md": "# Synthetic requirements\n" });
    const base = JSON.stringify(readAll(root));
    expect(base).not.toContain("THROW");
    writeFileSync(join(root, "specs", "settings.yaml"), FOREIGN);
    expect(JSON.stringify(readAll(root))).toBe(base);
  });

  test("B3 the tracker-write hook and the ledger gate behave as without the file", () => {
    const root = tree({ "CLAUDE.md": LEGACY, "specs/requirements.md": "# Synthetic requirements\n" });
    const input = { title: "synthetic", team: "SYN" };
    const base = runHook(root, "pre-tracker-write-gate", "mcp__linear__save_issue", input);
    writeFileSync(join(root, "specs", "settings.yaml"), FOREIGN);
    const withFile = runHook(root, "pre-tracker-write-gate", "mcp__linear__save_issue", input);
    expect(withFile).toEqual(base);
    expect(readTokenStatsConfig(join(root, "CLAUDE.md")).enabled).toBe(true);
  });

  test("B3 controls: min_dpt_version alone, or schema_version with a toolkit section, is toolkit-owned", () => {
    expect(isForeignSettingsFile(tree({ "specs/settings.yaml": 'min_dpt_version: "3.0.0"\n' }))).toBe(false);
    expect(isForeignSettingsFile(tree({ "specs/settings.yaml": "schema_version: 1\ndocs:\n  user_facing_mode: true\n" }))).toBe(false);
    expect(isForeignSettingsFile(tree({ "specs/settings.yaml": "app:\n  name: synthetic\n" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #4 — a malformed section breaks only its own readers
// ---------------------------------------------------------------------------

describe("#4 a typo in one section of specs/settings.yaml breaks only that section's readers", () => {
  const GOOD = [
    "schema_version: 1",
    'min_dpt_version: "3.0.0"',
    "task_tracking:",
    "  mode: linear",
    "  mcp_server: linear",
    "  milestone_scan_fetch: true",
    "  linear:",
    "    team: SYN",
    "    project: Synthetic Project",
    "verification:",
    "  verify_skill: smoke-test",
    "  verify_mode: manual",
    "  run_cmd: none",
    "docs:",
    "  user_facing_mode: true",
    "orchestration:",
    "  default_effort: high",
    "  merge_policy: never",
    "tracking:",
    "  token_stats:",
    "    enabled: true",
    "release:",
    "  files:",
    "    - path: package.json",
    "      kind: json",
    "      field: version",
    "",
  ].join("\n");
  const TYPO = GOOD.replace("  default_effort: high", "  default_efort: high");
  const STUB = legacy([]);

  test("#4 the orchestration reader refuses, naming the key; every other reader returns the file's values", () => {
    const good = tree({ "CLAUDE.md": STUB, "specs/settings.yaml": GOOD });
    const bad = tree({ "CLAUDE.md": STUB, "specs/settings.yaml": TYPO });
    const g = readAll(good);
    const b = readAll(bad);
    expect(String(b.orch)).toMatch(/^THROW: Refusing: .*orchestration\.default_efort/);
    for (const k of Object.keys(g)) if (k !== "orch") expect(b[k]).toEqual(g[k]);
  });

  test("#4 the whole-file loader still refuses the typo (AC-STE-706.2 is unchanged)", () => {
    const bad = tree({ "CLAUDE.md": STUB, "specs/settings.yaml": TYPO });
    expect(() => loadProjectSettings(bad)).toThrow(SettingsShapeError);
  });

  test("#4 the tracker-write hook is not refused by a typo outside task_tracking", () => {
    const good = tree({ "CLAUDE.md": STUB, "specs/settings.yaml": GOOD });
    const bad = tree({ "CLAUDE.md": STUB, "specs/settings.yaml": TYPO });
    const input = { title: "synthetic", team: "SYN" };
    const g = runHook(good, "pre-tracker-write-gate", "mcp__linear__save_issue", input);
    const b = runHook(bad, "pre-tracker-write-gate", "mcp__linear__save_issue", input);
    expect(b.code).toBe(g.code);
    expect(b.out.replaceAll(bad, "<ROOT>")).toBe(g.out.replaceAll(good, "<ROOT>"));
  });

  test("#4 the ledger never fails silently: a refused tracking section is reported on stderr, exit 0", () => {
    const bad = tree({ "CLAUDE.md": STUB, "specs/settings.yaml": GOOD.replace("    enabled: true", "    enabled: yes-please") });
    const transcript = join(bad, "t.jsonl");
    writeFileSync(transcript, "");
    const r = Bun.spawnSync(["bash", join(PLUGIN, "templates", "hooks", "process", "session-token-ledger.sh")], {
      cwd: bad,
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "s1", transcript_path: transcript, cwd: bad })),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: bad },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr.toString()).toMatch(/Refusing: .*tracking\.token_stats\.enabled/);
  });
});

// ---------------------------------------------------------------------------
// #3 — an unreadable settings file
// ---------------------------------------------------------------------------

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("#3 an unreadable specs/settings.yaml refuses, consistent with the managed signal", () => {
  test("#3 chmod 000: readers throw an NFR-10 refusal naming the file; nothing falls back to the stub or defaults", () => {
    // A migrated tree: the move writes `## Project Settings`. Without it the same CLAUDE.md is an
    // un-upgraded tree, where an unreadable file is ignored as v2.101.5 does (review round 2, R2-B3b).
    const root = tree({
      "CLAUDE.md": legacy(["## Project Settings", "", "Project settings live in `specs/settings.yaml`.", ""], ["## Task Tracking", "", "mode: jira", ""]),
      "specs/settings.yaml": 'schema_version: 1\nmin_dpt_version: "3.0.0"\ntask_tracking:\n  mode: linear\n',
    });
    chmodSync(join(root, "specs", "settings.yaml"), 0o000);
    try {
      if (isRoot) {
        // root reads through mode 000: the file is readable, so the refusal cannot be provoked.
        expect(readTaskTrackingSection(join(root, "CLAUDE.md")).mode).toBe("linear");
        return;
      }
      expect(isForeignSettingsFile(root)).toBe(false);
      expect(() => readTaskTrackingSection(join(root, "CLAUDE.md"))).toThrow(SettingsShapeError);
      let msg = "";
      try {
        readDocsConfig(join(root, "CLAUDE.md"));
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/^Refusing: specs\/settings\.yaml cannot be read/);
      expect(msg).toMatch(/\nRemedy: /);
      expect(msg).toMatch(/\nContext: /);
    } finally {
      chmodSync(join(root, "specs", "settings.yaml"), 0o644);
    }
  });
});

// ---------------------------------------------------------------------------
// #2 — the add-workspace script
// ---------------------------------------------------------------------------

describe("#2 scripts/migrate-task-tracking-add-workspace.ts prints a refusal, not a stack trace", () => {
  test("#2 a malformed settings file: stderr carries the NFR-10 lines, no stack frames, exit non-zero", () => {
    const root = tree({
      "CLAUDE.md": legacy([]),
      "specs/settings.yaml": 'schema_version: 1\nmin_dpt_version: "3.0.0"\ntask_tracking:\n  mode: linear\n  mcp_servr: linear\n',
    });
    const r = Bun.spawnSync(["bun", "run", join(PLUGIN, "scripts", "migrate-task-tracking-add-workspace.ts"), join(root, "CLAUDE.md")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const err = r.stderr.toString();
    expect(r.exitCode).not.toBe(0);
    expect(err).toMatch(/^Refusing: /m);
    expect(err).toMatch(/^Remedy: /m);
    expect(err).toMatch(/^Context: /m);
    expect(err).not.toMatch(/^\s+at /m);
    expect(err).not.toContain("SettingsShapeError");
  });
});

// ---------------------------------------------------------------------------
// #10 — the writer keeps a CRLF file CRLF
// ---------------------------------------------------------------------------

describe("#10 writeProjectSettings keeps the line endings of a CRLF settings file and CLAUDE.md", () => {
  const lone = (text: string): number => text.split("\r\n").join("").split("\n").length - 1;

  test("#10 a changed and an inserted line in a CRLF specs/settings.yaml end in CRLF; no lone LF appears", () => {
    const { writeProjectSettings } = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const yaml = 'schema_version: 1\nmin_dpt_version: "3.0.0"\nverification:\n  verify_skill: smoke-test\n'.replaceAll("\n", "\r\n");
    const root = tree({ "CLAUDE.md": legacy([]), "specs/settings.yaml": yaml });
    writeProjectSettings(root, { verification: { verify_skill: "visual-check", run_cmd: "none" }, docs: { user_facing_mode: true } });
    const after = readFileSync(join(root, "specs", "settings.yaml"), "utf8");
    expect(lone(after)).toBe(0);
    expect(after).toContain("verify_skill: visual-check\r\n");
    expect(after).toContain("run_cmd: none\r\n");
    expect(settingsRaw(root).docs.user_facing_mode).toBe(true);
  });

  test("#10 control: an LF file stays LF", () => {
    const { writeProjectSettings } = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const root = tree({ "CLAUDE.md": legacy([]), "specs/settings.yaml": 'schema_version: 1\nmin_dpt_version: "3.0.0"\n' });
    writeProjectSettings(root, { docs: { user_facing_mode: true } });
    expect(readFileSync(join(root, "specs", "settings.yaml"), "utf8")).not.toContain("\r");
  });

  test("#10 the binding stub synced into a CRLF CLAUDE.md is CRLF", () => {
    const { writeProjectSettings } = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const root = tree({
      "CLAUDE.md": legacy(["## Project Settings", "", "Synthetic pointer paragraph.", ""]).replaceAll("\n", "\r\n"),
      "specs/settings.yaml": 'schema_version: 1\nmin_dpt_version: "3.0.0"\n',
    });
    writeProjectSettings(root, { task_tracking: { mode: "linear", mcp_server: "linear", linear: { team: "SYN", project: "Synthetic Project" } } });
    const after = md(root);
    expect(after).toContain("## Task Tracking\r\n");
    expect(lone(after)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #11 — a template copy never replaces a target's foreign settings file
// ---------------------------------------------------------------------------

describe("#11 planTemplateCopy refuses to replace a target's foreign specs/settings.yaml", () => {
  const TEMPLATE_SETTINGS = 'schema_version: 1\nmin_dpt_version: "3.0.0"\ndocs:\n  user_facing_mode: true\n';
  const plan = () => require("../adapters/_shared/src/setup/template_copy") as typeof import("../adapters/_shared/src/setup/template_copy");

  test("#11 the target holds a foreign settings file: the plan refuses in NFR-10 shape and the target is untouched", () => {
    const template = tree({ "CLAUDE.md": legacy([]), "specs/settings.yaml": TEMPLATE_SETTINGS });
    const target = tree({ "specs/settings.yaml": "schema_version: 1\napp:\n  name: synthetic\n" });
    const before = snapshot(target);
    let msg = "";
    try {
      plan().planTemplateCopy(template, target, { mode: "whole-project" } as never);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/^Refusing: .*specs\/settings\.yaml/);
    expect(msg).toMatch(/\nRemedy: /);
    expect(msg).toMatch(/\nContext: /);
    expect(snapshot(target)).toEqual(before);
  });

  test("#11 control: a target with no settings file plans the copy", () => {
    const template = tree({ "CLAUDE.md": legacy([]), "specs/settings.yaml": TEMPLATE_SETTINGS });
    const target = tree({ "README.md": "# Synthetic\n" });
    const p = plan().planTemplateCopy(template, target, { mode: "whole-project" } as never);
    expect(Object.keys(p.files)).toContain("specs/settings.yaml");
  });
});

// ---------------------------------------------------------------------------
// T5 — legacy parity against literals captured from dbdb9572 (AC-STE-706.4 / .19)
// ---------------------------------------------------------------------------
// tests/fixtures/m_94e6f7-review1/trunk-parity.json was written by running the
// v2.101.5 readers (worktree at dbdb9572) over the fixture corpus it carries.
// These rows compare the 3.0 readers and the loader against those literals,
// so a change to a legacy parse turns them red — the AC-.4/.19 rows compare
// the same legacy function on both sides and cannot.

describe("T5 legacy parity against v2.101.5 literals", () => {
  const PIN = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "m_94e6f7-review1", "trunk-parity.json"), "utf8")) as {
    capturedFrom: string;
    fixtures: Record<string, Record<string, string>>;
    expected: Record<string, Record<string, unknown>>;
  };
  const { buildResolverConfig } = require("../adapters/_shared/src/resolver_config") as typeof import("../adapters/_shared/src/resolver_config");
  const { resolveVerifyMode } = require("../adapters/_shared/src/verification_config") as typeof import("../adapters/_shared/src/verification_config");
  const { readVideoStyle } = require("../adapters/_shared/src/video/style") as typeof import("../adapters/_shared/src/video/style");
  const { loadProjectSection } = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");

  test("T5 fixture guard: captured from dbdb9572, with the milestone_scan_fetch value edge cases", () => {
    expect(PIN.capturedFrom).toContain("dbdb9572");
    expect(Object.keys(PIN.fixtures).filter((n) => n.startsWith("msf")).length).toBeGreaterThanOrEqual(6);
    expect(new Set(Object.values(PIN.expected).map((e) => e.milestoneScanFetch))).toEqual(new Set([true, false]));
  });

  for (const [name, files] of Object.entries(PIN.fixtures)) {
    test(`T5 "${name}": every 3.0 reader returns the v2.101.5 literal`, () => {
      const root = tree(files);
      const m = join(root, "CLAUDE.md");
      const r: Record<string, unknown> = {};
      const t = (k: string, f: () => unknown): void => {
        try {
          r[k] = JSON.parse(JSON.stringify(f() ?? null));
        } catch (e) {
          r[k] = { throws: (e as Error).name };
        }
      };
      t("taskTracking", () => readTaskTrackingSection(m));
      t("resolverTrackers", () => buildResolverConfig(m, join(PLUGIN, "adapters")).trackers?.map((x: { key?: string; name?: string }) => x.key ?? x.name) ?? null);
      t("linear", () => readWorkspaceBinding(m, "linear"));
      t("jira", () => readWorkspaceBinding(m, "jira"));
      t("verification", () => readVerificationConfig(m));
      t("verifyMode", () => resolveVerifyMode(m));
      t("docs", () => readDocsConfig(m));
      t("orchestration", () => readOrchestrationConfig(root));
      t("tokenStats", () => readTokenStatsConfig(m));
      t("milestoneScanFetch", () => readMilestoneScanFetch(m));
      t("release", () => readReleaseFiles(root, () => readFileSync(m, "utf8")));
      t("trackerConfig", () => readTrackerConfig(join(root, "specs")));
      t("videoStyle", () => readVideoStyle(root));
      t("videoConfig", () => loadProjectSection(root, "video").config);
      expect(r).toEqual(JSON.parse(JSON.stringify(PIN.expected[name])));
    });

    test(`T5 "${name}": the loader's legacy sections carry the v2.101.5 literal values`, () => {
      const root = tree(files);
      const e = PIN.expected[name]!;
      const tt = loadProjectSection(root, "task_tracking");
      expect(tt.milestone_scan_fetch === true).toBe(e.milestoneScanFetch);
      expect(tt.mode).toBe(((e.taskTracking as Record<string, string>).mode || "none") as string);
      expect(loadProjectSection(root, "tracking").token_stats.enabled).toBe((e.tokenStats as { enabled: boolean }).enabled);
      expect(JSON.parse(JSON.stringify(loadProjectSection(root, "release").files))).toEqual(e.release);
    });
  }
});
