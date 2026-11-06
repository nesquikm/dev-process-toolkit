// STE-711 — the `settings-file` migration moves every setting into
// `specs/settings.yaml` (AC-STE-711.1 .. .21), plus the STE-709 halves that
// waited on this entry (AC-STE-709.6 / .15: probe #69's `settings-file` row).
//
// AC map (this file):
//   AC-.1  registry entry shape, last in MIGRATIONS, validateRegistry, the
//          legacy_paths constants.
//   AC-.2  detect purity + the applies matrix (move / cleanup / stub / none rows).
//   AC-.3  round trip: loader sections after == legacy sections before.
//   AC-.4  CLAUDE.md after a move (byte-preservation oracle, pointer, stub).
//   AC-.5  a moved heading inside an HTML comment.
//   AC-.6  shared container floor raise to 3.0.0.
//   AC-.7  retired files deleted; .dpt/.env and .claude/settings.json never opened.
//   AC-.8  cleanup (equal removes, differing refuses).
//   AC-.9  second run is a no-op.
//   AC-.10 whole registry walk on a 2.70-era fixture.
//   AC-.11 docs/upgrade-reference.md + the plan's `migration: settings-file`.
//   AC-.12 older entries on a settings-only tree.
//   AC-.13 the registry pins live in tests/m139-ste-541-linear-minted-milestone.test.ts
//          and tests/m_2306b6-linear-team-key-migration.test.ts (amended by the
//          implementer); this file only pins "last" under AC-.1.
//   AC-.14 no setting in two places.
//   AC-.15 a leftover is pending on probe #69, and applying clears it.
//   AC-.16 old hooks still guard (the v2.101.4 binding parse reads the stub).
//   AC-.17 mutation controls: rows tagged "[AC-.17 control: <mutation>]" red
//          when the named behaviour is removed.
//   AC-.18 `bun test` from plugins/dev-process-toolkit — the full-suite gate, no row.
//   AC-.19 only moved keys are written.
//   AC-.20 lines that are not moved keys.
//   AC-.21 template comment blocks. The one `git show` case branches at runtime
//          on `git rev-parse --is-shallow-repository`: in a shallow clone it
//          records a named pass stating the reason; in a full clone a missing
//          commit fails it. No skip/todo call site is added (AC-STE-616.16).
//
// Running version. The move writes `min_dpt_version: 3.0.0`, and the loader
// refuses a floor above the running toolkit. Until the release bumps
// plugin.json, this file points CLAUDE_PLUGIN_ROOT at a scratch manifest that
// declares 3.0.0 (the version the migration ships in), restored in afterAll.
//
// Synthetic ids only. No skips, no todos.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { runClaudeMdDocsSectionProbe } from "../adapters/_shared/src/claudemd_docs_section";
import * as LegacyPaths from "../adapters/_shared/src/migrations/legacy_paths";
import { assertMigrationDeclared } from "../adapters/_shared/src/migrations/coverage";
import { MIGRATIONS, validateRegistry, type MigrationEntry } from "../adapters/_shared/src/migrations/index";
import {
  detectSettingsSource,
  loadProjectSettings,
  projectSettingsSection,
  renderSettingsPointer,
  renderTrackingStub,
  writeProjectSettings,
} from "../adapters/_shared/src/project_settings";
import { MOVED_HEADINGS, parseWorkspaceBinding, trackingStubSlots } from "../adapters/_shared/src/project_settings_legacy";
import { buildResolverConfig } from "../adapters/_shared/src/resolver_config";
import { renderSharedTrackerSentinel } from "../adapters/_shared/src/setup/tracker_binding_write";
import { runTaskTrackingCanonicalKeysProbe } from "../adapters/_shared/src/task_tracking_canonical_keys";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { SETUP_MARKER } from "../adapters/_shared/src/toolkit_managed";
import { runTrackerConfigShapeProbe } from "../adapters/_shared/src/tracker_config_shape";
import { runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";

const PLUGIN = resolve(import.meta.dir, "..");
const REPO = resolve(PLUGIN, "..", "..");
const ADAPTERS = join(PLUGIN, "adapters");
const ENTRY_ID = "settings-file";
const FLOOR = "3.0.0";
const OLD_SHARED_FLOOR = "2.90.0";
const POINTER_COMMENT = "<!-- Project settings live in specs/settings.yaml. Edit them there. -->";
const TEMPLATE_FIXTURE = join(import.meta.dir, "fixtures", "m_94e6f7-ste-711", "claude-md-v2.101.4-template.txt");
const TEMPLATE_COMMIT = "8b107a45";
const TEMPLATE_PATH = "plugins/dev-process-toolkit/templates/CLAUDE.md.template";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];
let prevPluginRoot: string | undefined;

beforeAll(() => {
  const fake = mkdtempSync(join(tmpdir(), "ste711-plugin-"));
  ROOTS.push(fake);
  mkdirSync(join(fake, ".claude-plugin"), { recursive: true });
  writeFileSync(join(fake, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "dev-process-toolkit", version: FLOOR }));
  prevPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = fake;
});

afterAll(() => {
  if (prevPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = prevPluginRoot;
  for (const r of ROOTS) {
    try {
      chmodSync(r, 0o755);
    } catch {
      /* best effort */
    }
    rmSync(r, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste711-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function entry(): MigrationEntry {
  const e = MIGRATIONS.find((m) => m.id === ENTRY_ID);
  if (e === undefined) throw new Error(`no \`${ENTRY_ID}\` entry in MIGRATIONS`);
  return e;
}

function detect(root: string): { applies: boolean; evidence: string[] } {
  return entry().detect(root);
}

interface ApplyOutcome {
  refused: boolean;
  text: string;
  changed: string[];
}

/** Run the entry's apply. A refusal may be thrown or returned; either way it carries the NFR-10 lines. */
function runApply(root: string): ApplyOutcome {
  const e = entry();
  if (typeof e.apply !== "function") throw new Error(`\`${ENTRY_ID}\` has no apply`);
  try {
    const r = e.apply(root);
    return { refused: /Refusing:/.test(r.summary), text: r.summary, changed: r.changed };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (!/Refusing:/.test(text)) throw err;
    return { refused: true, text, changed: [] };
  }
}

function expectRefusal(r: ApplyOutcome): void {
  expect(r.refused).toBe(true);
  expect(r.text).toMatch(/Refusing:/);
  expect(r.text).toMatch(/Remedy:/);
  expect(r.text).toMatch(/Context:/);
  expect(r.changed).toEqual([]);
}

function applyOk(root: string): ApplyOutcome {
  const r = runApply(root);
  if (r.refused) throw new Error(`apply refused unexpectedly:\n${r.text}`);
  return r;
}

/** Every file under root (dotfiles included, .git excluded), rel path -> base64 bytes. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walkDir = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".git") continue;
        walkDir(abs);
      } else {
        out[relative(root, abs)] = readFileSync(abs).toString("base64");
      }
    }
  };
  walkDir(root);
  return out;
}

const md = (root: string): string => readFileSync(join(root, "CLAUDE.md"), "utf8");
const settingsText = (root: string): string => readFileSync(join(root, "specs", "settings.yaml"), "utf8");
const settingsRaw = (root: string): Record<string, any> => Bun.YAML.parse(settingsText(root)) as Record<string, any>;

/** 1-based line numbers of every line of `text` equal to `line`. */
function linesEqual(text: string, line: string): number[] {
  const out: number[] = [];
  text.split("\n").forEach((l, i) => {
    if (l === line) out.push(i + 1);
  });
  return out;
}

function lineNo(text: string, line: string): number {
  const all = linesEqual(text, line);
  if (all.length === 0) throw new Error(`fixture has no line ${JSON.stringify(line)}`);
  return all[0]!;
}

/** Does `text` cite CLAUDE.md:<n>? */
function citesLine(text: string, n: number): boolean {
  return new RegExp(`CLAUDE\\.md:${n}(?!\\d)`).test(text);
}

/** Every `CLAUDE.md:<n>` cited in `text`. */
function citedLines(text: string): number[] {
  return [...text.matchAll(/CLAUDE\.md:(\d+)/g)].map((m) => Number(m[1]));
}

// --- instrumentation ----------------------------------------------------------

interface Trace {
  opened: string[];
  writes: string[];
  spawns: string[];
  fetches: number;
}

/** Run `fn` with fs / child_process / Bun.spawn / fetch observed (calls pass through). */
function traced<T>(fn: () => T): { value?: T; error?: unknown; trace: Trace } {
  const trace: Trace = { opened: [], writes: [], spawns: [], fetches: 0 };
  const restores: (() => void)[] = [];
  const watch = (obj: any, name: string, onCall: (args: unknown[]) => void): void => {
    if (obj === undefined || typeof obj[name] !== "function") return;
    try {
      const orig = obj[name];
      const s = spyOn(obj, name).mockImplementation(((...args: unknown[]) => {
        onCall(args);
        return orig.apply(obj, args);
      }) as any);
      restores.push(() => s.mockRestore());
    } catch {
      /* not observable on this runtime */
    }
  };
  const arg0 = (args: unknown[]): string => String(args[0]);
  for (const name of ["readFileSync", "createReadStream"]) watch(fs, name, (a) => trace.opened.push(arg0(a)));
  watch(fs, "openSync", (a) => {
    trace.opened.push(arg0(a));
    const flags = String(a[1] ?? "r");
    if (/[wa+]/.test(flags)) trace.writes.push(arg0(a));
  });
  for (const name of [
    "writeFileSync",
    "appendFileSync",
    "mkdirSync",
    "rmSync",
    "rmdirSync",
    "unlinkSync",
    "renameSync",
    "copyFileSync",
    "cpSync",
    "symlinkSync",
    "truncateSync",
    "chmodSync",
    "createWriteStream",
  ]) {
    watch(fs, name, (a) => trace.writes.push(`${name}:${arg0(a)}`));
  }
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    watch(cp, name, (a) => trace.spawns.push(`${name}:${arg0(a)}`));
  }
  watch(Bun, "spawn", (a) => trace.spawns.push(`Bun.spawn:${arg0(a)}`));
  watch(Bun, "spawnSync", (a) => trace.spawns.push(`Bun.spawnSync:${arg0(a)}`));
  watch(Bun, "write", (a) => trace.writes.push(`Bun.write:${arg0(a)}`));
  watch(Bun, "file", (a) => trace.opened.push(arg0(a)));
  watch(globalThis, "fetch", () => {
    trace.fetches++;
  });
  try {
    return { value: fn(), trace };
  } catch (error) {
    return { error, trace };
  } finally {
    for (const r of restores.reverse()) r();
  }
}

function expectPureDetect(root: string): { applies: boolean; evidence: string[] } {
  const before = snapshot(root);
  const t = traced(() => detect(root));
  expect(t.error).toBeUndefined();
  expect(t.trace.writes).toEqual([]);
  expect(t.trace.spawns).toEqual([]);
  expect(t.trace.fetches).toBe(0);
  expect(snapshot(root)).toEqual(before);
  return t.value!;
}

/** Apply every script entry of the live registry whose detector applies, in order. */
function walkRegistry(root: string): string[] {
  const changed: string[] = [];
  for (const e of MIGRATIONS) {
    if (e.kind !== "script" || typeof e.apply !== "function") continue;
    if (!e.detect(root).applies) continue;
    const r = e.apply(root);
    if (/Refusing:/.test(r.summary)) throw new Error(`${e.id} refused during the walk:\n${r.summary}`);
    changed.push(...r.changed);
  }
  return changed;
}

async function settingsFileRows(root: string): Promise<{ rows: string[]; violations: unknown[] }> {
  const r = await runUpgradeStalenessProbe(root);
  return { rows: r.rows.filter((row) => row.startsWith(`${ENTRY_ID} `)), violations: r.violations };
}

// ---------------------------------------------------------------------------
// Legacy fixtures (synthetic values; v2.101.4 line shapes)
// ---------------------------------------------------------------------------

const INTRO = [SETUP_MARKER, "# Synthetic Project", "", "Synthetic intro prose for the fixture.", ""];
const KEY_COMMANDS = ["## Key Commands", "", "- `bun test`", "", "**Gating rule:** run `bun test` before merging.", ""];
const TESTING = ["## Testing Conventions", "", "- **Framework:** bun:test", "- **Layout:** tests/-mirror", ""];
const NOTES = ["## Notes", "", "Synthetic closing prose.", ""];
const LAYOUT_LINE = "- **Layout:** tests/-mirror";

function legacyMd(opts: { top?: string[]; moved?: string[][] } = {}): string {
  return [...INTRO, ...(opts.top ?? []), ...KEY_COMMANDS, ...(opts.moved ?? []).flat(), ...TESTING, ...NOTES].join("\n");
}

const S_LINEAR = [
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
  "default_labels: [syn-a]",
  "",
];

const OLD_STOP = renderSharedTrackerSentinel({ adapter: "jira", project: "SYNJ", repoTag: "syn-repo", minDptVersion: OLD_SHARED_FLOOR });
const NEW_STOP = renderSharedTrackerSentinel({ adapter: "jira", project: "SYNJ", repoTag: "syn-repo", minDptVersion: FLOOR });

const S_SHARED_JIRA = [
  "## Task Tracking",
  "",
  "mode: jira",
  "mcp_server: atlassian",
  "jira_ac_field: customfield_10001",
  "",
  "### Jira",
  "",
  "project: SYNJ",
  "default_labels: [syn-repo]",
  "repo_tag: syn-repo",
  `min_dpt_version: ${OLD_SHARED_FLOOR}`,
  "",
  ...OLD_STOP.split("\n"),
  "",
];

const S_DOCS = ["## Docs", "", "user_facing_mode: true", "packages_mode: false", "changelog_ci_owned: false", "changelog_unversioned: false", ""];
const S_VERIFICATION = ["## Verification", "", "verify_skill: smoke-test", "verify_mode: manual", "run_cmd: none", "e2e_cmd: none", ""];
const S_ORCH = ["## Orchestration", "", "default_effort: high", "merge_policy: never", ""];
const S_TOKEN = ["## Token Stats", "", "enabled: true", ""];
const S_RELEASE = [
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
];

const TRACKER_CONFIG_YAML = (key: string, extraInitial = false): string =>
  [
    `tracker_key: ${key}`,
    "statuses:",
    ...(extraInitial ? ["  - Backlog"] : []),
    "  - Todo",
    "  - In Progress",
    "  - In Review",
    "  - Done",
    "roles:",
    `  initial: ${extraInitial ? "Backlog" : "Todo"}`,
    "  in_progress: In Progress",
    "  in_review: In Review",
    "  done: Done",
    "",
  ].join("\n");

const VIDEO_CONFIG_YAML = "tts:\n  provider: google\n  voice: en-US-Synth\nrecorder:\n  kind: footage\nmusic:\n  source: none\n";
const VIDEO_STYLE_YAML = "music:\n  level_db: -18\nhumor: none\n";

const TEMPLATE_MD = readFileSync(TEMPLATE_FIXTURE, "utf8");

type Section = "task_tracking" | "verification" | "docs" | "orchestration" | "tracking" | "release" | "video";

interface MoveRow {
  name: string;
  files: () => Record<string, string>;
  homes: Section[];
  /** Which task_tracking homes exist: the heading, the standalone line (its expected value), the tracker config file. */
  tt: { heading: boolean; msf: boolean | null; sv: boolean };
  video: { config: boolean; style: boolean };
  mode: "none" | "linear" | "jira";
  /** The matched template blocks the oracle may remove (template rows only). */
  templateBlocks?: string[];
}

const NO_TT = { heading: false, msf: null, sv: false };
const NO_VIDEO = { config: false, style: false };

// The seven shipped template comment blocks of the v2.101.4 template, by first content line.
const TEMPLATE_KIND_RE =
  /^(Optional: )?(Task Tracking section|milestone_scan_fetch|Verification section|Orchestration section|Docs section|Token Stats section|Release Files section)\b/;

interface Block {
  start: number; // 0-based index of the `<!--` line
  end: number; // 0-based index of the `-->` line
  text: string;
}

/** Every multi-or-single-line HTML comment block that opens at the start of a line. */
function commentBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith("<!--")) continue;
    let j = i;
    while (j < lines.length && !lines[j]!.includes("-->")) j++;
    if (j >= lines.length) break;
    out.push({ start: i, end: j, text: lines.slice(i, j + 1).join("\n") });
    i = j;
  }
  return out;
}

function shippedKindBlocks(text: string): Block[] {
  return commentBlocks(text).filter((b) => {
    const content = b.text.split("\n").find((l, k) => k > 0 && l.trim() !== "" && !/^=+$/.test(l.trim()));
    return content !== undefined && TEMPLATE_KIND_RE.test(content.trim());
  });
}

const TEMPLATE_BLOCK_TEXTS = shippedKindBlocks(TEMPLATE_MD).map((b) => b.text);

const MOVE_ROWS: MoveRow[] = [
  { name: "Linear", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_LINEAR] }) }), homes: ["task_tracking"], tt: { heading: true, msf: null, sv: false }, video: NO_VIDEO, mode: "linear" },
  { name: "shared Jira", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_SHARED_JIRA] }) }), homes: ["task_tracking"], tt: { heading: true, msf: null, sv: false }, video: NO_VIDEO, mode: "jira" },
  { name: "mode none with docs only", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_DOCS] }) }), homes: ["docs"], tt: NO_TT, video: NO_VIDEO, mode: "none" },
  { name: "verification", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_VERIFICATION] }) }), homes: ["verification"], tt: NO_TT, video: NO_VIDEO, mode: "none" },
  { name: "orchestration", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_ORCH] }) }), homes: ["orchestration"], tt: NO_TT, video: NO_VIDEO, mode: "none" },
  { name: "token stats", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_TOKEN] }) }), homes: ["tracking"], tt: NO_TT, video: NO_VIDEO, mode: "none" },
  { name: "release files", files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_RELEASE] }) }), homes: ["release"], tt: NO_TT, video: NO_VIDEO, mode: "none" },
  { name: "milestone_scan_fetch: true", files: () => ({ "CLAUDE.md": legacyMd({ top: ["milestone_scan_fetch: true", ""] }) }), homes: ["task_tracking"], tt: { heading: false, msf: true, sv: false }, video: NO_VIDEO, mode: "none" },
  { name: "milestone_scan_fetch: false", files: () => ({ "CLAUDE.md": legacyMd({ top: ["milestone_scan_fetch: false", ""] }) }), homes: ["task_tracking"], tt: { heading: false, msf: false, sv: false }, video: NO_VIDEO, mode: "none" },
  { name: "milestone_scan_fetch: yes", files: () => ({ "CLAUDE.md": legacyMd({ top: ["milestone_scan_fetch: yes", ""] }) }), homes: ["task_tracking"], tt: { heading: false, msf: false, sv: false }, video: NO_VIDEO, mode: "none" },
  {
    name: "tracker config",
    files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_LINEAR] }), "specs/tracker-config.yaml": TRACKER_CONFIG_YAML("linear") }),
    homes: ["task_tracking"],
    tt: { heading: true, msf: null, sv: true },
    video: NO_VIDEO,
    mode: "linear",
  },
  {
    name: "video config and style",
    files: () => ({ "CLAUDE.md": legacyMd(), ".dpt/video/config.yaml": VIDEO_CONFIG_YAML, ".dpt/video/style.yaml": VIDEO_STYLE_YAML }),
    homes: ["video"],
    tt: NO_TT,
    video: { config: true, style: true },
    mode: "none",
  },
  {
    name: "v2.101.4 template output",
    files: () => ({ "CLAUDE.md": TEMPLATE_MD }),
    homes: ["docs", "tracking", "release"],
    tt: NO_TT,
    video: NO_VIDEO,
    mode: "none",
    templateBlocks: TEMPLATE_BLOCK_TEXTS,
  },
];

function row(name: string): MoveRow {
  const r = MOVE_ROWS.find((x) => x.name === name);
  if (!r) throw new Error(`no move row ${name}`);
  return r;
}

/** A fresh tree for the row, migrated by the entry. Returns root and the CLAUDE.md before. */
function migrated(r: MoveRow): { root: string; before: string; legacy: Record<string, unknown> } {
  const root = tree(r.files());
  const before = md(root);
  const legacy = JSON.parse(JSON.stringify(loadProjectSettings(root).settings)) as Record<string, unknown>;
  applyOk(root);
  return { root, before, legacy };
}

// ---------------------------------------------------------------------------
// Settings-file fixtures (cleanup / stub rows)
// ---------------------------------------------------------------------------

const STATUS_VOCAB = {
  tracker_key: "linear",
  statuses: ["Todo", "In Progress", "In Review", "Done"],
  roles: { initial: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done" },
};

function baseSettings(): Record<string, any> {
  return {
    schema_version: 1,
    min_dpt_version: FLOOR,
    task_tracking: {
      mode: "linear",
      mcp_server: "linear",
      milestone_scan_fetch: true,
      linear: { team: "SYN", project: "Synthetic Project" },
      status_vocabulary: structuredClone(STATUS_VOCAB),
    },
    verification: { verify_skill: "smoke-test", verify_mode: "manual", run_cmd: "none", e2e_cmd: "none" },
    docs: { user_facing_mode: false, packages_mode: true, changelog_ci_owned: false, changelog_unversioned: false },
    orchestration: { default_effort: "high", merge_policy: "never" },
    tracking: { token_stats: { enabled: true } },
    release: { files: [{ path: "package.json", kind: "json", field: "version" }] },
    video: { config: Bun.YAML.parse(VIDEO_CONFIG_YAML), style: Bun.YAML.parse(VIDEO_STYLE_YAML) },
  };
}

const POINTER_LINE = renderSettingsPointer(FLOOR).replace(/\n$/, "");

function settingsClaudeMd(): string {
  return [...INTRO, "## Project Settings", "", POINTER_LINE, "", ...KEY_COMMANDS, ...TESTING, ...NOTES].join("\n");
}

/** A settings-file tree: CLAUDE.md with the pointer, the settings file (the writer inserts the stub in a tracker mode). */
function settingsTree(settings: Record<string, any> = baseSettings(), extra: Record<string, string> = {}): string {
  const root = tree({ "CLAUDE.md": settingsClaudeMd(), ...extra });
  writeProjectSettings(root, settings, { create: true });
  return root;
}

/** Fixture guard: a healthy settings tree loads from the settings file, with a stub equal to its render. */
function expectHealthySettingsTree(root: string): void {
  const loaded = loadProjectSettings(root);
  expect(loaded.source).toBe("settings");
  const render = renderTrackingStub(loaded.settings);
  const slots = trackingStubSlots(md(root));
  if (render === "") expect(slots).toEqual([]);
  else {
    expect(slots).toHaveLength(1);
    expect(`${slots[0]!.text}\n`).toBe(render);
  }
}

function appendToMd(root: string, lines: string[]): void {
  const cur = md(root);
  writeFileSync(join(root, "CLAUDE.md"), `${cur}${cur.endsWith("\n") ? "" : "\n"}\n${lines.join("\n")}\n`);
}

interface Leftover {
  name: string;
  /** The leftover's home as the evidence and `changed` name it. */
  home: string;
  equal: (root: string) => void;
  differ: (root: string) => void;
  /** The differing key path the refusal must name. */
  diffPath: string;
  /** For a CLAUDE.md leftover, the line that marks its span. */
  marker?: string;
  differMarker?: string;
  /** A prose line the leftover section keeps: the heading and this line must survive the cleanup (review T3). */
  prose?: string;
}

const LEFTOVER_PROSE = "Operator prose kept under the leftover Verification heading.";

const LEFTOVERS: Leftover[] = [
  {
    name: "## Verification keeping prose",
    home: "CLAUDE.md",
    marker: "## Verification",
    prose: LEFTOVER_PROSE,
    equal: (r) => appendToMd(r, [...S_VERIFICATION, LEFTOVER_PROSE]),
    differ: (r) => appendToMd(r, [...S_VERIFICATION.map((l) => (l === "verify_mode: manual" ? "verify_mode: advisory" : l)), LEFTOVER_PROSE]),
    diffPath: "verification.verify_mode",
  },
  {
    name: "## Verification",
    home: "CLAUDE.md",
    marker: "## Verification",
    equal: (r) => appendToMd(r, S_VERIFICATION),
    differ: (r) => appendToMd(r, S_VERIFICATION.map((l) => (l === "verify_mode: manual" ? "verify_mode: advisory" : l))),
    diffPath: "verification.verify_mode",
  },
  {
    name: "## Docs",
    home: "CLAUDE.md",
    marker: "## Docs",
    equal: (r) => appendToMd(r, ["## Docs", "", "user_facing_mode: false", "packages_mode: true", "changelog_ci_owned: false", "changelog_unversioned: false"]),
    differ: (r) => appendToMd(r, ["## Docs", "", "user_facing_mode: false", "packages_mode: false", "changelog_ci_owned: false", "changelog_unversioned: false"]),
    diffPath: "docs.packages_mode",
  },
  {
    name: "## Orchestration",
    home: "CLAUDE.md",
    marker: "## Orchestration",
    equal: (r) => appendToMd(r, S_ORCH),
    differ: (r) => appendToMd(r, ["## Orchestration", "", "default_effort: high", "merge_policy: offer"]),
    diffPath: "orchestration.merge_policy",
  },
  {
    name: "## Token Stats",
    home: "CLAUDE.md",
    marker: "## Token Stats",
    equal: (r) => appendToMd(r, S_TOKEN),
    differ: (r) => appendToMd(r, ["## Token Stats", "", "enabled: false"]),
    diffPath: "tracking.token_stats.enabled",
  },
  {
    name: "## Release Files",
    home: "CLAUDE.md",
    marker: "## Release Files",
    equal: (r) => appendToMd(r, ["## Release Files", "", "```yaml", "files:", "  - path: package.json", "    kind: json", "    field: version", "```"]),
    differ: (r) => appendToMd(r, ["## Release Files", "", "```yaml", "files:", "  - path: package.json", "    kind: json", "    field: package.version", "```"]),
    diffPath: "release.files",
  },
  {
    name: "standalone milestone_scan_fetch",
    home: "CLAUDE.md",
    marker: "milestone_scan_fetch: true",
    differMarker: "milestone_scan_fetch: false",
    equal: (r) => appendToMd(r, ["milestone_scan_fetch: true"]),
    differ: (r) => appendToMd(r, ["milestone_scan_fetch: false"]),
    diffPath: "task_tracking.milestone_scan_fetch",
  },
  {
    name: "specs/tracker-config.yaml",
    home: "specs/tracker-config.yaml",
    equal: (r) => writeFileSync(join(r, "specs", "tracker-config.yaml"), TRACKER_CONFIG_YAML("linear")),
    differ: (r) => writeFileSync(join(r, "specs", "tracker-config.yaml"), TRACKER_CONFIG_YAML("linear", true)),
    diffPath: "task_tracking.status_vocabulary",
  },
  {
    name: ".dpt/video/config.yaml",
    home: ".dpt/video/config.yaml",
    equal: (r) => {
      mkdirSync(join(r, ".dpt", "video"), { recursive: true });
      writeFileSync(join(r, ".dpt", "video", "config.yaml"), VIDEO_CONFIG_YAML);
    },
    differ: (r) => {
      mkdirSync(join(r, ".dpt", "video"), { recursive: true });
      writeFileSync(join(r, ".dpt", "video", "config.yaml"), VIDEO_CONFIG_YAML.replace("en-US-Synth", "en-US-Other"));
    },
    diffPath: "video.config",
  },
  {
    name: ".dpt/video/style.yaml",
    home: ".dpt/video/style.yaml",
    equal: (r) => {
      mkdirSync(join(r, ".dpt", "video"), { recursive: true });
      writeFileSync(join(r, ".dpt", "video", "style.yaml"), VIDEO_STYLE_YAML);
    },
    differ: (r) => {
      mkdirSync(join(r, ".dpt", "video"), { recursive: true });
      writeFileSync(join(r, ".dpt", "video", "style.yaml"), VIDEO_STYLE_YAML.replace("-18", "-12"));
    },
    diffPath: "video.style",
  },
];

function cleanupTree(l: Leftover, which: "equal" | "differ"): string {
  const root = settingsTree();
  expectHealthySettingsTree(root);
  (which === "equal" ? l.equal : l.differ)(root);
  return root;
}

interface StubRow {
  name: string;
  build: () => string;
  mode: "linear" | "none";
}

const LINEAR_STUB_RENDER = renderTrackingStub({ task_tracking: { mode: "linear", linear: { team: "SYN", project: "Synthetic Project" } } });

const STUB_ROWS: StubRow[] = [
  {
    name: "missing",
    mode: "linear",
    build: () => {
      const root = settingsTree();
      writeFileSync(join(root, "CLAUDE.md"), settingsClaudeMd());
      return root;
    },
  },
  {
    name: "drifted by one byte",
    mode: "linear",
    build: () => {
      const root = settingsTree();
      writeFileSync(join(root, "CLAUDE.md"), md(root).replace("team: SYN", "team: SYX"));
      return root;
    },
  },
  {
    name: "duplicated",
    mode: "linear",
    build: () => {
      const root = settingsTree();
      appendToMd(root, LINEAR_STUB_RENDER.replace(/\n$/, "").split("\n"));
      return root;
    },
  },
  {
    name: "left under mode: none",
    mode: "none",
    build: () => {
      const s = baseSettings();
      delete s.task_tracking;
      const root = settingsTree(s);
      appendToMd(root, LINEAR_STUB_RENDER.replace(/\n$/, "").split("\n"));
      return root;
    },
  },
];

const NONE_ROWS: { name: string; build: () => string }[] = [
  {
    name: "settings-only with a correct stub",
    build: () => {
      const root = settingsTree();
      expectHealthySettingsTree(root);
      return root;
    },
  },
  { name: "empty tree", build: () => tree({}) },
  {
    name: "## Testing Conventions with a Layout: bullet and no other legacy home",
    build: () => tree({ "CLAUDE.md": ["# Synthetic Project", "", ...TESTING].join("\n") }),
  },
];

// ---------------------------------------------------------------------------
// AC-STE-711.1 — the entry
// ---------------------------------------------------------------------------

describe("AC-STE-711.1 the registry entry", () => {
  test("AC-.1 id, introduced_in, kind, approval flag and an apply function", () => {
    const e = entry();
    expect(e.id).toBe("settings-file");
    expect(e.introduced_in).toBe("3.0.0");
    expect(e.kind).toBe("script");
    expect(e.requires_explicit_approval).toBe(true);
    expect(typeof e.apply).toBe("function");
    expect(typeof e.title).toBe("string");
    expect(e.title.length).toBeGreaterThan(0);
  });

  // Amended by AC-STE-716.20 (M_7bc805): capture-registration is appended after settings-file.
  test("AC-.1 the entry sits last in MIGRATIONS before capture-registration and validateRegistry passes", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 2]!.id).toBe("settings-file");
    expect(MIGRATIONS[MIGRATIONS.length - 1]!.id).toBe("capture-registration");
    expect(() => validateRegistry(MIGRATIONS)).not.toThrow();
    expect(MIGRATIONS.filter((m) => m.id === "settings-file")).toHaveLength(1);
  });

  test("AC-.1 the entry module is migrations/entries/settings_file.ts", () => {
    expect(existsSync(join(PLUGIN, "adapters", "_shared", "src", "migrations", "entries", "settings_file.ts"))).toBe(true);
  });

  test("AC-.1 legacy_paths.ts carries SETTINGS_COMMENT_POINTER byte for byte", () => {
    expect((LegacyPaths as Record<string, unknown>).SETTINGS_COMMENT_POINTER).toBe(POINTER_COMMENT);
  });

  test("AC-.1 legacy_paths.ts carries LEGACY_TEMPLATE_COMMENT_BLOCKS: { text, firstRelease, lastRelease, commit } entries", () => {
    const blocks = (LegacyPaths as Record<string, unknown>).LEGACY_TEMPLATE_COMMENT_BLOCKS as
      | { text: string; firstRelease: string; lastRelease: string; commit: string }[]
      | undefined;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks!.length).toBeGreaterThan(0);
    for (const b of blocks!) {
      expect(b.text.startsWith("<!--")).toBe(true);
      expect(b.text.replace(/\n$/, "").endsWith("-->")).toBe(true);
      expect(b.firstRelease).toMatch(/^2\.\d+\.\d+$/);
      expect(b.lastRelease).toMatch(/^2\.\d+\.\d+$/);
      expect(b.commit).toMatch(/^[0-9a-f]{7,40}$/);
    }
    expect(new Set(blocks!.map((b) => b.text)).size).toBe(blocks!.length);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.2 — detect: pure, never throws, the applies matrix
// ---------------------------------------------------------------------------

describe("AC-STE-711.2 detect is pure and applies exactly on the move, cleanup and stub rows", () => {
  for (const r of MOVE_ROWS) {
    test(`AC-.2 move row "${r.name}": applies, with file:line evidence, purely`, () => {
      const root = tree(r.files());
      expect(detectSettingsSource(root)).toBe("legacy");
      const d = expectPureDetect(root);
      expect(d.applies).toBe(true);
      expect(d.evidence.length).toBeGreaterThan(0);
      for (const line of d.evidence) expect(line).toMatch(/[\w./-]+:\d+/);
    });
  }

  for (const l of LEFTOVERS) {
    for (const which of ["equal", "differ"] as const) {
      test(`AC-.2 cleanup row "${l.name}" (values ${which === "equal" ? "equal" : "differing"}): applies and names the leftover`, () => {
        const root = cleanupTree(l, which);
        const d = expectPureDetect(root);
        expect(d.applies).toBe(true);
        const joined = d.evidence.join("\n");
        if (l.home === "CLAUDE.md") {
          // Orchestrator fix: the "differ" variant of a standalone line writes a different value,
          // so locate it by the variant's own marker when the row declares one.
          const marker = which === "differ" && l.differMarker ? l.differMarker : l.marker!;
          const at = lineNo(md(root), marker);
          expect(citedLines(joined).some((n) => n >= at)).toBe(true);
        } else {
          expect(joined).toMatch(new RegExp(`${l.home.replace(/[.]/g, "\\.")}:\\d+`));
        }
      });
    }
  }

  for (const s of STUB_ROWS) {
    test(`AC-.2 stub row "${s.name}": applies, citing CLAUDE.md`, () => {
      const root = s.build();
      const d = expectPureDetect(root);
      expect(d.applies).toBe(true);
      expect(d.evidence.join("\n")).toMatch(/CLAUDE\.md:\d+/);
    });
  }

  for (const n of NONE_ROWS) {
    test(`AC-.2 non-applying row "${n.name}"`, () => {
      const root = n.build();
      const d = expectPureDetect(root);
      expect(d).toEqual({ applies: false, evidence: [] });
    });
  }

  test("AC-.2 detect never throws: unreadable CLAUDE.md, malformed settings file, malformed legacy section", () => {
    const unreadable = tree({ "CLAUDE.md": legacyMd({ moved: [S_LINEAR] }) });
    chmodSync(join(unreadable, "CLAUDE.md"), 0o000);
    let threw: unknown;
    try {
      detect(unreadable);
    } catch (e) {
      threw = e;
    }
    chmodSync(join(unreadable, "CLAUDE.md"), 0o644);
    expect(threw).toBeUndefined();

    const malformedSettings = tree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": "schema_version: [\n  : : bad\n" });
    expect(() => detect(malformedSettings)).not.toThrow();

    const malformedLegacy = tree({ "CLAUDE.md": legacyMd({ moved: [["## Orchestration", "", "default_effort: warp", ""]] }) });
    expect(() => detect(malformedLegacy)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.3 — round trip; AC-STE-711.19 — only moved keys
// ---------------------------------------------------------------------------

function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) o[k] = stripNulls(x);
    return o;
  }
  return v;
}

function semverLess(x: string, y: string): boolean {
  const xs = x.split(".").map(Number);
  const ys = y.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((xs[i] ?? 0) !== (ys[i] ?? 0)) return (xs[i] ?? 0) < (ys[i] ?? 0);
  return false;
}

function comparable(settings: Record<string, any>, r: MoveRow): Record<string, unknown> {
  const s = JSON.parse(JSON.stringify(settings)) as Record<string, any>;
  if (r.tt.msf === null) delete s.task_tracking.milestone_scan_fetch;
  const out: Record<string, unknown> = { task_tracking: stripNulls(s.task_tracking) };
  for (const h of r.homes) if (h !== "task_tracking") out[h] = stripNulls(s[h]);
  return out;
}

describe("AC-STE-711.3 round trip", () => {
  for (const r of MOVE_ROWS) {
    test(`AC-.3 "${r.name}": loader sections after apply deep-equal the legacy sections before, source settings`, () => {
      const { root, legacy } = migrated(r);
      const after = loadProjectSettings(root);
      expect(after.source).toBe("settings");
      // Orchestrator amendment (spec deviation, contradicts → resolved by step 4): a shared container's
      // binding floor is raised to at least 3.0.0 by the move (AC-STE-711.6), so that one field is
      // compared against its raised value; every other value must round-trip unchanged.
      const expected = comparable(legacy as Record<string, any>, r) as Record<string, any>;
      for (const a of ["linear", "jira"]) {
        const b = expected.task_tracking?.[a];
        if (b && typeof b.min_dpt_version === "string") {
          const lower = semverLess(b.min_dpt_version, "3.0.0");
          if (lower) b.min_dpt_version = "3.0.0";
        }
      }
      expect(comparable(after.settings as unknown as Record<string, any>, r)).toEqual(expected);
    });
  }
});

describe("AC-STE-711.19 only moved keys are written", () => {
  const TOP_OF: Record<Section, string> = {
    task_tracking: "task_tracking",
    verification: "verification",
    docs: "docs",
    orchestration: "orchestration",
    tracking: "tracking",
    release: "release",
    video: "video",
  };
  for (const r of MOVE_ROWS) {
    test(`AC-.19 "${r.name}": the settings file holds only keys whose legacy home existed`, () => {
      const { root } = migrated(r);
      const raw = settingsRaw(root);
      expect(raw.schema_version).toBe(1);
      expect(String(raw.min_dpt_version)).toBe(FLOOR);
      expect(Object.keys(raw).sort()).toEqual(["min_dpt_version", "schema_version", ...r.homes.map((h) => TOP_OF[h])].sort());
      expect("close_out" in raw).toBe(false);
      if (raw.task_tracking !== undefined) {
        const tt = raw.task_tracking as Record<string, unknown>;
        expect("mode" in tt).toBe(r.tt.heading);
        expect("milestone_scan_fetch" in tt).toBe(r.tt.msf !== null);
        if (r.tt.msf !== null) expect(tt.milestone_scan_fetch).toBe(r.tt.msf);
        expect("status_vocabulary" in tt).toBe(r.tt.sv);
      }
      if (raw.video !== undefined) {
        expect("config" in raw.video).toBe(r.video.config);
        expect("style" in raw.video).toBe(r.video.style);
      }
      if (raw.tracking !== undefined) expect(Object.keys(raw.tracking)).toEqual(["token_stats"]);
    });
  }

  test("AC-.19 [AC-.17 control: column-0 milestone_scan_fetch key line] `milestone_scan_fetch: yes` moves as false and its line goes", () => {
    const { root, before } = migrated(row("milestone_scan_fetch: yes"));
    expect(before).toContain("milestone_scan_fetch: yes");
    expect(settingsRaw(root).task_tracking.milestone_scan_fetch).toBe(false);
    expect(md(root).split("\n").some((l) => l.startsWith("milestone_scan_fetch:"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.4 — CLAUDE.md after a move
// ---------------------------------------------------------------------------

const MOVED_KEYS = [
  "mode",
  "mcp_server",
  "jira_ac_field",
  "branch_template",
  "secondary_tracker",
  "milestone_scan_fetch",
  "team",
  "project",
  "default_labels",
  "repo_tag",
  "min_dpt_version",
  "linear_bug_label",
  "jira_bug_issue_type",
  "jira_issue_type",
  "verify_skill",
  "verify_mode",
  "run_cmd",
  "e2e_cmd",
  "user_facing_mode",
  "packages_mode",
  "changelog_ci_owned",
  "changelog_unversioned",
  "default_effort",
  "merge_policy",
  "enabled",
  "files",
];
const MOVED_KEY_LINE = new RegExp(`^(${MOVED_KEYS.join("|")})\\s*:`);
const MOVED_HEADING_SET = new Set<string>(MOVED_HEADINGS as readonly string[]);

/** Lines of `text` (0-based) inside a stub slot. */
function stubLineIndexes(text: string): Set<number> {
  const out = new Set<number>();
  for (const s of trackingStubSlots(text)) for (let i = 0; i < s.lines.length; i++) out.add(s.line - 1 + i);
  return out;
}

/** The oracle: the non-blank original lines a move must keep, byte-identical and in order. */
function keptLines(original: string, matchedBlocks: readonly string[] = []): string[] {
  const lines = original.split("\n");
  const removable = new Set<number>();
  let inMoved = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("```")) {
      if (inMoved) removable.add(i);
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{1,2}\s/.test(l)) {
      inMoved = MOVED_HEADING_SET.has(l);
      if (inMoved) removable.add(i);
      continue;
    }
    if (inMoved && (inFence || MOVED_KEY_LINE.test(l) || /^###\s+(Linear|Jira)$/.test(l) || l.startsWith(">"))) removable.add(i);
    if (l.startsWith("milestone_scan_fetch:")) removable.add(i);
  }
  for (const b of commentBlocks(original)) {
    if (matchedBlocks.includes(b.text)) for (let i = b.start; i <= b.end; i++) removable.add(i);
  }
  return lines.filter((l, i) => !removable.has(i) && l.trim() !== "");
}

function expectByteOrderPreserved(root: string, before: string, r: { mode: string; templateBlocks?: string[] }): void {
  const after = md(root);
  const loaded = loadProjectSettings(root).settings;
  const allowedNew = new Set<string>(["## Project Settings", POINTER_COMMENT, ...renderSettingsPointer(FLOOR).split("\n")]);
  for (const l of renderTrackingStub(loaded).split("\n")) allowedNew.add(l);
  if (r.mode === "jira") for (const l of NEW_STOP.split("\n")) allowedNew.add(l);
  const kept = keptLines(before, r.templateBlocks ?? []);
  let k = 0;
  const unexpected: string[] = [];
  for (const l of after.split("\n")) {
    if (l.trim() === "") continue;
    if (k < kept.length && l === kept[k]) {
      k++;
      continue;
    }
    if (!allowedNew.has(l)) unexpected.push(l);
  }
  expect(unexpected).toEqual([]);
  expect(kept.slice(k)).toEqual([]);
}

/** Body of the `##` section opening at 0-based `i`, without comment blocks. */
function bodyWithoutComments(lines: string[], i: number): string[] {
  let j = i + 1;
  while (j < lines.length && !/^#{1,2}\s/.test(lines[j]!)) j++;
  const body = lines.slice(i + 1, j).join("\n").replace(/<!--[\s\S]*?-->/g, "");
  return body.split("\n").filter((l) => l.trim() !== "");
}

describe("AC-STE-711.4 CLAUDE.md after a move", () => {
  for (const r of MOVE_ROWS) {
    test(`AC-.4 "${r.name}": no key line outside the stub, one pointer section, the stub, every other line kept in order`, () => {
      const { root, before } = migrated(r);
      const after = md(root);
      const lines = after.split("\n");
      const stub = stubLineIndexes(after);

      const strayKeys = lines.filter((l, i) => !stub.has(i) && MOVED_KEY_LINE.test(l));
      expect(strayKeys).toEqual([]);
      expect(lines.some((l) => l.startsWith("milestone_scan_fetch:"))).toBe(false);

      for (let i = 0; i < lines.length; i++) {
        if (!MOVED_HEADING_SET.has(lines[i]!) || stub.has(i)) continue;
        expect({ heading: lines[i], body: bodyWithoutComments(lines, i) }).not.toEqual({ heading: lines[i], body: [] });
      }

      expect(linesEqual(after, "## Project Settings")).toHaveLength(1);
      const ps = projectSettingsSection(after);
      expect(ps).not.toBeNull();
      expect(ps!.lines).toContain(POINTER_LINE);

      const render = renderTrackingStub(loadProjectSettings(root).settings);
      const slots = trackingStubSlots(after);
      if (r.mode === "none") {
        expect(slots).toEqual([]);
      } else {
        expect(slots).toHaveLength(1);
        expect(`${slots[0]!.text}\n`).toBe(render);
      }

      expectByteOrderPreserved(root, before, r);
      expect(linesEqual(after, LAYOUT_LINE).length + linesEqual(after, "- **Layout:** src/-co-located <!-- toolkit default; each `src/foo.ts` has a sibling `src/foo.test.ts`. Override to `tests/-mirror` if needed; `/gate-check` reads this line. -->").length).toBe(1);
    });
  }

  test("AC-.4 Linear: `## Project Settings` stands where `## Task Tracking` stood, and the stub follows it directly", () => {
    const { root } = migrated(row("Linear"));
    const headings = md(root).split("\n").filter((l) => /^##\s/.test(l));
    expect(headings).toEqual(["## Key Commands", "## Project Settings", "## Task Tracking", "## Testing Conventions", "## Notes"]);
  });

  test("AC-.4 v2.101.4 template: `## Project Settings` stands where `## Docs` stood (the first removed section)", () => {
    const { root } = migrated(row("v2.101.4 template output"));
    const headings = md(root).split("\n").filter((l) => /^##\s/.test(l));
    expect(headings).toEqual([
      "## Tech Stack",
      "## Architecture",
      "## Key Commands",
      "## Workflows",
      "## Key Patterns",
      "## Testing Conventions",
      "## DO NOT",
      "## Commit Convention",
      "## Project Settings",
    ]);
  });

  test("AC-.4 the `/setup` marker, the `Layout:` bullet and the gating-rule prose stay byte-identical", () => {
    const { root } = migrated(row("Linear"));
    const after = md(root);
    expect(after.split("\n")[0]).toBe(SETUP_MARKER);
    expect(linesEqual(after, LAYOUT_LINE)).toHaveLength(1);
    expect(linesEqual(after, "**Gating rule:** run `bun test` before merging.")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.5 — a moved heading inside an HTML comment
// ---------------------------------------------------------------------------

describe("AC-STE-711.5 a moved heading inside an HTML comment", () => {
  test("AC-.5 a commented `## Docs` is migrated as the v2.101.4 reader reads it", () => {
    const commented = ["<!--", ...S_DOCS.slice(0, -1), "-->", ""];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [commented] }) });
    expect(loadProjectSettings(root).settings.docs.user_facing_mode).toBe(true);
    expect(detect(root).applies).toBe(true);
    applyOk(root);
    expect(loadProjectSettings(root).source).toBe("settings");
    expect(settingsRaw(root).docs.user_facing_mode).toBe(true);
    expect(md(root).split("\n").some((l) => MOVED_KEY_LINE.test(l))).toBe(false);
    expect(detect(root).applies).toBe(false);
  });

  test("AC-.5 [AC-.17 control: step 0's refusal] a commented `## Task Tracking` span is refused, naming the marker lines", () => {
    const commented = ["<!--", ...S_LINEAR.slice(0, -1), "-->", ""];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [commented] }) });
    const text = md(root);
    const open = lineNo(text, "<!--");
    const close = lineNo(text, "-->");
    const d = detect(root);
    expect(d.applies).toBe(true);
    expect(citesLine(d.evidence.join("\n"), close)).toBe(true);
    const before = snapshot(root);
    const r = runApply(root);
    expectRefusal(r);
    expect(citesLine(r.text, open)).toBe(true);
    expect(citesLine(r.text, close)).toBe(true);
    expect(snapshot(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.6 — shared container; AC-STE-711.16 — old hooks still guard
// ---------------------------------------------------------------------------

describe("AC-STE-711.6 shared container", () => {
  test("AC-.6 fixture guard: the legacy shared Jira tree is clean on probe #25 before the move", async () => {
    const root = tree(row("shared Jira").files());
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
    expect(parseWorkspaceBinding(join(root, "CLAUDE.md"), "jira").minDptVersion).toBe(OLD_SHARED_FLOOR);
  });

  test("AC-.6 [AC-.17 control: step 4's floor raise] the floor rises to 3.0.0 in the settings file and the stub, the stop paragraph re-renders, probe #25 is clean", async () => {
    const { root } = migrated(row("shared Jira"));
    const raw = settingsRaw(root);
    expect(String(raw.min_dpt_version)).toBe(FLOOR);
    expect(String(raw.task_tracking.jira.min_dpt_version)).toBe(FLOOR);
    expect(raw.task_tracking.jira.repo_tag).toBe("syn-repo");

    const after = md(root);
    const slots = trackingStubSlots(after);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.lines).toContain(`min_dpt_version: ${FLOOR}`);
    expect(`${slots[0]!.text}\n`).toBe(renderTrackingStub(loadProjectSettings(root).settings));

    const ps = projectSettingsSection(after)!;
    expect(ps.lines.join("\n")).toContain(NEW_STOP);
    expect(after).not.toContain(OLD_SHARED_FLOOR);
    expect(after.split(NEW_STOP)).toHaveLength(2);

    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });
});

describe("AC-STE-711.16 old hooks still guard", () => {
  for (const name of ["Linear", "shared Jira"]) {
    test(`AC-.16 "${name}": the v2.101.4 binding parse of the migrated CLAUDE.md equals the settings file's binding`, () => {
      const r = row(name);
      const { root } = migrated(r);
      const adapter = r.mode as "linear" | "jira";
      const claudeMd = join(root, "CLAUDE.md");
      const fromStub = parseWorkspaceBinding(claudeMd, adapter);
      const fromSettings = readWorkspaceBinding(claudeMd, adapter);
      expect(fromStub).toEqual(fromSettings);
      if (adapter === "jira") {
        expect(fromStub.repoTag).toBe("syn-repo");
        expect(fromStub.minDptVersion).toBe(FLOOR);
        expect(fromStub.shared).toBe(true);
      } else {
        expect(fromStub.team).toBe("SYN");
        expect(fromStub.project).toBe("Synthetic Project");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-711.7 — retired files go; private files are never opened
// ---------------------------------------------------------------------------

describe("AC-STE-711.7 retired files and never-touched files", () => {
  test("AC-.7 the three retired files are reported in `changed` and deleted; .dpt/.env and .claude/settings.json are never opened", () => {
    const root = tree({
      "CLAUDE.md": legacyMd({ moved: [S_LINEAR] }),
      "specs/tracker-config.yaml": TRACKER_CONFIG_YAML("linear"),
      ".dpt/video/config.yaml": VIDEO_CONFIG_YAML,
      ".dpt/video/style.yaml": VIDEO_STYLE_YAML,
      ".dpt/.env": "SYNTH_VIDEO_KEY=synthetic-not-a-secret\n",
      ".claude/settings.json": '{ "permissions": { "allow": [] } }\n',
    });
    const env = readFileSync(join(root, ".dpt", ".env"));
    const cs = readFileSync(join(root, ".claude", "settings.json"));
    const t = traced(() => {
      detect(root);
      return runApply(root);
    });
    expect(t.error).toBeUndefined();
    const r = t.value!;
    expect(r.refused).toBe(false);
    for (const rel of ["specs/tracker-config.yaml", ".dpt/video/config.yaml", ".dpt/video/style.yaml"]) {
      expect(r.changed).toContain(rel);
      expect(existsSync(join(root, rel))).toBe(false);
    }
    expect(readFileSync(join(root, ".dpt", ".env"))).toEqual(env);
    expect(readFileSync(join(root, ".claude", "settings.json"))).toEqual(cs);
    const touched = [...t.trace.opened, ...t.trace.writes].filter((p) => /\.dpt\/\.env$|\.claude\/settings\.json$/.test(p));
    expect(touched).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.8 — cleanup
// ---------------------------------------------------------------------------

describe("AC-STE-711.8 cleanup", () => {
  for (const l of LEFTOVERS) {
    test(`AC-.8 [AC-.17 control: the cleanup removal] equal "${l.name}": removed, reported, settings file byte-identical`, () => {
      const root = cleanupTree(l, "equal");
      const settingsBefore = settingsText(root);
      const r = applyOk(root);
      expect(r.changed).toContain(l.home);
      expect(settingsText(root)).toBe(settingsBefore);
      if (l.home === "CLAUDE.md") {
        const after = md(root);
        const stub = stubLineIndexes(after);
        expect(after.split("\n").filter((x, i) => !stub.has(i) && MOVED_KEY_LINE.test(x))).toEqual([]);
        if (l.prose !== undefined) {
          // A heading that keeps any other line stays: only its key lines go.
          expect(linesEqual(after, l.marker!)).toHaveLength(1);
          expect(linesEqual(after, l.prose)).toHaveLength(1);
          expect(lineNo(after, l.prose)).toBeGreaterThan(lineNo(after, l.marker!));
        } else if (l.marker!.startsWith("## ")) expect(linesEqual(after, l.marker!)).toEqual([]);
      } else {
        expect(existsSync(join(root, l.home))).toBe(false);
      }
      expectHealthySettingsTree(root);
      expect(detect(root).applies).toBe(false);
    });

    test(`AC-.8 [AC-.17 control: the differing-values refusal] differing "${l.name}": refuses naming both homes and the key path, tree byte-identical`, () => {
      const root = cleanupTree(l, "differ");
      const before = snapshot(root);
      const r = runApply(root);
      expectRefusal(r);
      expect(r.text).toContain("specs/settings.yaml");
      expect(r.text).toContain(l.home);
      expect(r.text).toContain(l.diffPath);
      expect(snapshot(root)).toEqual(before);
    });
  }
});

// ---------------------------------------------------------------------------
// Stub repair
// ---------------------------------------------------------------------------

describe("stub repair (Requirement; AC-.2 / AC-.9 rows)", () => {
  for (const s of STUB_ROWS) {
    test(`[AC-.17 control: the stub render] stub "${s.name}": re-rendered (or removed under mode: none), settings byte-identical, probe #25 clean`, async () => {
      const root = s.build();
      const settingsBefore = settingsText(root);
      const r = applyOk(root);
      expect(r.changed).toContain("CLAUDE.md");
      expect(settingsText(root)).toBe(settingsBefore);
      const slots = trackingStubSlots(md(root));
      if (s.mode === "none") {
        expect(slots).toEqual([]);
        expect(md(root)).not.toContain("### Linear");
      } else {
        expect(slots).toHaveLength(1);
        expect(`${slots[0]!.text}\n`).toBe(renderTrackingStub(loadProjectSettings(root).settings));
      }
      expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
      expect(detect(root).applies).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-711.9 — second run is a no-op
// ---------------------------------------------------------------------------

describe("AC-STE-711.9 second run is a no-op", () => {
  const cases: { name: string; build: () => string }[] = [
    ...MOVE_ROWS.map((r) => ({ name: `move "${r.name}"`, build: () => tree(r.files()) })),
    ...LEFTOVERS.map((l) => ({ name: `cleanup "${l.name}"`, build: () => cleanupTree(l, "equal") })),
    ...STUB_ROWS.map((s) => ({ name: `stub "${s.name}"`, build: s.build })),
  ];
  for (const c of cases) {
    test(`AC-.9 ${c.name}: detect false, no probe #69 row, a second registry walk changes no byte`, async () => {
      const root = c.build();
      walkRegistry(root);
      expect(detect(root)).toEqual({ applies: false, evidence: [] });
      expect((await settingsFileRows(root)).rows).toEqual([]);
      const before = snapshot(root);
      expect(walkRegistry(root)).toEqual([]);
      expect(snapshot(root)).toEqual(before);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-711.10 — whole registry walk on a 2.70-era fixture
// ---------------------------------------------------------------------------

describe("AC-STE-711.10 whole walk", () => {
  test("AC-.10 every entry of MIGRATIONS in order on a 2.70-era tree ends on the settings file with probes #18 #21 #25 #52 clean", async () => {
    const era = [
      ...INTRO,
      ...KEY_COMMANDS,
      "## Task Tracking",
      "",
      "mode: linear",
      "mcp_server: linear",
      "branch_template: feat/{ticket-id}-{slug}",
      "",
      "### Linear",
      "",
      "team: SYN",
      "project: Synthetic Project",
      "",
      "### Sync log",
      "",
      "- 2026-01-01 synthetic sync entry",
      "",
      "## Verification",
      "",
      "verify_skill: smoke-test",
      "verify_mode: manual",
      "",
      "## Docs",
      "",
      "user_facing_mode: false",
      "packages_mode: false",
      "changelog_ci_owned: false",
      "",
      ...S_RELEASE,
      ...TESTING,
      ...NOTES,
    ].join("\n");
    const root = tree({ "CLAUDE.md": era });
    walkRegistry(root);
    expect(loadProjectSettings(root).source).toBe("settings");
    expect((await runClaudeMdDocsSectionProbe(root)).violations).toEqual([]);
    expect((await runTaskTrackingCanonicalKeysProbe(root)).violations).toEqual([]);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
    expect((await runTrackerConfigShapeProbe(root)).violations).toEqual([]);
    expect(md(root)).not.toContain("### Sync log");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.11 — upgrade reference + plan declaration
// ---------------------------------------------------------------------------

describe("AC-STE-711.11 docs/upgrade-reference.md and the plan's migration declaration", () => {
  /** The section of the doc whose heading names `settings-file`, to the next heading of the same or higher level. */
  function settingsFileSection(): string {
    const doc = readFileSync(join(PLUGIN, "docs", "upgrade-reference.md"), "utf8");
    const lines = doc.split("\n");
    const start = lines.findIndex((l) => /^#{2,4}\s/.test(l) && l.includes("`settings-file`"));
    if (start < 0) return "";
    const level = /^(#+)/.exec(lines[start]!)![1]!.length;
    let end = start + 1;
    while (end < lines.length && !(new RegExp(`^#{1,${level}}\\s`).test(lines[end]!))) end++;
    return lines.slice(start, end).join("\n");
  }

  test("AC-.11 a section headed by `settings-file` names its version, what it moves and removes", () => {
    const s = settingsFileSection();
    expect(s).not.toBe("");
    expect(s).toContain("3.0.0");
    expect(s).toContain("specs/settings.yaml");
    for (const home of [
      "## Task Tracking",
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
      expect(s).toContain(home);
    }
    expect(s).toMatch(/remov|delet/i);
  });

  test("AC-.11 the section names what it never touches, the binding stub and its 4.0 removal", () => {
    const s = settingsFileSection();
    for (const never of [".dpt/.env", ".claude/settings.json", "userConfig"]) expect(s).toContain(never);
    expect(s).toMatch(/stub/i);
    expect(s).toContain("4.0");
  });

  test("AC-.11 the milestone plan declares `migration: settings-file`, which resolves at 3.0.0", async () => {
    const candidates = [join(REPO, "specs", "plan", "M_94e6f7.md"), join(REPO, "specs", "plan", "archive", "M_94e6f7.md")];
    const plan = candidates.find((p) => existsSync(p));
    expect(plan).toBeDefined();
    expect(readFileSync(plan!, "utf8")).toMatch(/^migration: settings-file$/m);
    await assertMigrationDeclared(plan!, MIGRATIONS, "3.0.0");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.12 — older entries on the new home
// ---------------------------------------------------------------------------

describe("AC-STE-711.12 older entries on a settings-only tree", () => {
  const EDITS_MOVED_HEADING = ["v1-orphans", "mode-none-sequential-milestone", "verification-run-keys", "linear-team-key"];

  function settingsOnly(): string {
    const s = baseSettings();
    // A verification section with no run_cmd: on a legacy tree verification-run-keys would splice one.
    s.verification = { verify_skill: "smoke-test", verify_mode: "manual" };
    const root = settingsTree(s);
    expectHealthySettingsTree(root);
    return root;
  }

  test("AC-.12 every entry introduced below 3.0.0 returns from detect without throwing", () => {
    const root = settingsOnly();
    const older = MIGRATIONS.filter((m) => m.introduced_in !== "3.0.0" && Number(m.introduced_in.split(".")[0]) < 3);
    expect(older.length).toBeGreaterThan(0);
    for (const m of older) expect(() => m.detect(root)).not.toThrow();
  });

  for (const id of EDITS_MOVED_HEADING) {
    test(`AC-.12 \`${id}\` reports applies: false on the settings-only tree`, () => {
      const root = settingsOnly();
      const m = MIGRATIONS.find((x) => x.id === id);
      expect(m).toBeDefined();
      expect(m!.detect(root).applies).toBe(false);
    });
  }

  test("AC-.12 / AC-STE-709.6 the settings-file entry does not apply on a settings-only tree, and probe #69 renders no settings-file row", async () => {
    const root = settingsOnly();
    expect(detect(root)).toEqual({ applies: false, evidence: [] });
    const r = await settingsFileRows(root);
    expect(r.rows).toEqual([]);
    expect(r.violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.14 — no setting in two places
// ---------------------------------------------------------------------------

function filesUnder(root: string, rel: string): string[] {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walkDir = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walkDir(p);
      else out.push(relative(root, p));
    }
  };
  walkDir(abs);
  return out;
}

const SECOND_HOME_KEY = new RegExp(
  `^\\s*-?\\s*(${[...MOVED_KEYS, "tracker_key", "statuses", "roles", "tts", "recorder", "music", "humor"].join("|")})\\s*:`,
);

describe("AC-STE-711.14 no setting in two places", () => {
  for (const r of MOVE_ROWS) {
    test(`AC-.14 "${r.name}": each moved key lives only in specs/settings.yaml (the stub excepted, byte-equal to its render)`, () => {
      const { root } = migrated(r);
      for (const rel of ["specs/tracker-config.yaml", ".dpt/video/config.yaml", ".dpt/video/style.yaml"]) {
        expect(existsSync(join(root, rel))).toBe(false);
      }
      const others = [...filesUnder(root, "specs"), ...filesUnder(root, ".dpt")].filter((f) => f !== "specs/settings.yaml");
      for (const f of others) {
        const hits = readFileSync(join(root, f), "utf8").split("\n").filter((l) => SECOND_HOME_KEY.test(l));
        expect({ file: f, hits }).toEqual({ file: f, hits: [] });
      }
      const after = md(root);
      const stub = stubLineIndexes(after);
      const outside = after.split("\n").filter((l, i) => !stub.has(i));
      expect(outside.filter((l) => MOVED_KEY_LINE.test(l))).toEqual([]);
      expect(outside.filter((l) => MOVED_HEADING_SET.has(l) || l === "### Linear" || l === "### Jira")).toEqual([]);
      const render = renderTrackingStub(loadProjectSettings(root).settings);
      const slots = trackingStubSlots(after);
      expect(slots.map((s) => `${s.text}\n`)).toEqual(render === "" ? [] : [render]);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-711.15 — a leftover is pending; STE-709 halves on probe #69
// ---------------------------------------------------------------------------

describe("AC-STE-711.15 a leftover is pending on probe #69", () => {
  const FULL: MoveRow = {
    name: "full Linear",
    files: () => ({ "CLAUDE.md": legacyMd({ moved: [S_LINEAR, S_DOCS] }), "specs/tracker-config.yaml": TRACKER_CONFIG_YAML("linear") }),
    homes: ["task_tracking", "docs"],
    tt: { heading: true, msf: null, sv: true },
    video: NO_VIDEO,
    mode: "linear",
  };

  async function expectOnePendingRow(root: string, names: (row: string) => boolean): Promise<void> {
    const r = await settingsFileRows(root);
    expect(r.violations).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.startsWith("settings-file (3.0.0): ")).toBe(true);
    expect(names(r.rows[0]!)).toBe(true);
    applyOk(root);
    expect((await settingsFileRows(root)).rows).toEqual([]);
  }

  test("AC-.15 fixture guard: the migrated tree renders no settings-file row", async () => {
    const { root } = migrated(FULL);
    expect((await settingsFileRows(root)).rows).toEqual([]);
  });

  test("AC-.15 restoring specs/tracker-config.yaml renders one row naming it; applying clears it", async () => {
    const { root } = migrated(FULL);
    writeFileSync(join(root, "specs", "tracker-config.yaml"), TRACKER_CONFIG_YAML("linear"));
    await expectOnePendingRow(root, (row) => /specs\/tracker-config\.yaml:\d+/.test(row));
  });

  test("AC-.15 adding a `## Docs` section with a recognised key renders one row naming it; applying clears it", async () => {
    const { root } = migrated(FULL);
    const docs = settingsRaw(root).docs as Record<string, boolean>;
    appendToMd(root, ["## Docs", "", ...Object.entries(docs).map(([k, v]) => `${k}: ${v}`)]);
    const at = lineNo(md(root), "## Docs");
    await expectOnePendingRow(root, (row) => citedLines(row).some((n) => n >= at));
  });

  test("AC-.15 editing one byte of the stub renders one row naming it; applying clears it", async () => {
    const { root } = migrated(FULL);
    const text = md(root);
    const slot = trackingStubSlots(text)[0]!;
    writeFileSync(join(root, "CLAUDE.md"), text.replace("team: SYN", "team: SYX"));
    await expectOnePendingRow(root, (row) => citedLines(row).some((n) => n >= slot.line && n < slot.line + slot.lines.length));
  });

  test("AC-STE-709.15 a managed legacy tree: probe #69 renders exactly one settings-file row and no violation", async () => {
    const root = tree(row("Linear").files());
    const r = await runUpgradeStalenessProbe(root);
    expect(r.violations).toEqual([]);
    expect(r.rows.filter((x) => x.startsWith("settings-file "))).toHaveLength(1);
  });

  test("AC-STE-709.15 an unmanaged tree: probe #69 adds no settings-file row", async () => {
    const root = tree({ "README.md": "# synthetic\n" });
    expect((await settingsFileRows(root)).rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.20 — lines that are not moved keys
// ---------------------------------------------------------------------------

describe("AC-STE-711.20 lines that are not moved keys", () => {
  test("AC-.20 [AC-.17 control: step 2's key-line-only removal] `## Verification` and `## Docs` keep their headings and prose", () => {
    const ver = ["## Verification", "", "Run the smoke skill after every change.", "", "verify_skill: smoke-test", "verify_mode: manual", "run_cmd: none", "e2e_cmd: none", ""];
    const docs = ["## Docs", "", "The docs flags below are synthetic.", "user_facing_mode: true", "packages_mode: false", "changelog_ci_owned: false", "changelog_unversioned: false", ""];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [ver, docs] }) });
    applyOk(root);
    const after = md(root);
    const lines = after.split("\n");
    for (const [heading, prose] of [
      ["## Verification", "Run the smoke skill after every change."],
      ["## Docs", "The docs flags below are synthetic."],
    ] as const) {
      const i = lines.indexOf(heading);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(bodyWithoutComments(lines, i)).toEqual([prose]);
    }
    expect(lines.filter((l) => MOVED_KEY_LINE.test(l))).toEqual([]);
    expect(settingsRaw(root).verification.verify_skill).toBe("smoke-test");
    expect(settingsRaw(root).docs.user_facing_mode).toBe(true);
    expect(detect(root).applies).toBe(false);
  });

  test("AC-.20 `secondary_tracker: jira` moves; buildResolverConfig keeps both trackers; probe #21 reds it on both trees", async () => {
    const tt = [...S_LINEAR];
    tt.splice(tt.indexOf("mcp_server: linear") + 1, 0, "secondary_tracker: jira");
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [tt] }) });
    const claudeMd = join(root, "CLAUDE.md");
    const resolverBefore = JSON.stringify(buildResolverConfig(claudeMd, ADAPTERS));
    expect(buildResolverConfig(claudeMd, ADAPTERS).trackers).toHaveLength(2);
    expect((await runTaskTrackingCanonicalKeysProbe(root)).violations).toHaveLength(1);
    applyOk(root);
    expect(settingsRaw(root).task_tracking.secondary_tracker).toBe("jira");
    expect(JSON.stringify(buildResolverConfig(claudeMd, ADAPTERS))).toBe(resolverBefore);
    expect((await runTaskTrackingCanonicalKeysProbe(root)).violations).toHaveLength(1);
  });

  const REFUSE_ROWS: { name: string; moved: string[][]; offending: string[] }[] = [
    { name: "`## Docs` holding `foo: bar`", moved: [S_LINEAR, ["## Docs", "", "user_facing_mode: false", "foo: bar", ""]], offending: ["foo: bar"] },
    {
      name: "`## Task Tracking` holding a prose line",
      moved: [(() => {
        const s = [...S_LINEAR];
        s.splice(s.indexOf("mcp_server: linear") + 1, 0, "Tickets live on the synthetic board.");
        return s;
      })()],
      offending: ["Tickets live on the synthetic board."],
    },
    {
      name: "a `workspace_url:` line under `### Linear`",
      moved: [(() => {
        const s = [...S_LINEAR];
        s.splice(s.indexOf("project: Synthetic Project") + 1, 0, "workspace_url: https://example.invalid/synthetic");
        return s;
      })()],
      offending: ["workspace_url: https://example.invalid/synthetic"],
    },
    {
      name: "a prose line inside `### Linear`",
      moved: [(() => {
        const s = [...S_LINEAR];
        s.splice(s.indexOf("team: SYN") + 1, 0, "The synthetic team owns this board.");
        return s;
      })()],
      offending: ["The synthetic team owns this board."],
    },
    {
      name: "a `### Notes` sub-heading with one prose line",
      moved: [[...S_LINEAR, "### Notes", "", "Synthetic note line.", ""]],
      offending: ["### Notes", "Synthetic note line."],
    },
  ];

  for (const rr of REFUSE_ROWS) {
    test(`AC-.20 [AC-.17 control: step 0's refusal] ${rr.name}: detect lists it, apply refuses naming it and the prose-section destination, tree byte-identical`, () => {
      const root = tree({ "CLAUDE.md": legacyMd({ moved: rr.moved }) });
      const text = md(root);
      const d = detect(root);
      expect(d.applies).toBe(true);
      for (const line of rr.offending) expect(citesLine(d.evidence.join("\n"), lineNo(text, line))).toBe(true);
      const before = snapshot(root);
      const r = runApply(root);
      expectRefusal(r);
      for (const line of rr.offending) expect(citesLine(r.text, lineNo(text, line))).toBe(true);
      expect(r.text).toMatch(/prose section/i);
      expect(r.text).toMatch(/outside/i);
      expect(snapshot(root)).toEqual(before);
    });
  }

  test("AC-.20 a legacy Linear tree beside a foreign specs/settings.yaml: apply refuses naming the file, tree byte-identical", () => {
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [S_LINEAR] }), "specs/settings.yaml": "service:\n  port: 8080\n" });
    const before = snapshot(root);
    const r = runApply(root);
    expectRefusal(r);
    expect(r.text).toContain("specs/settings.yaml");
    expect(snapshot(root)).toEqual(before);
  });

  test("AC-.20 [AC-.17 control: the structural-line exemption] a Linear tree with blank lines in its span moves", () => {
    const spaced = [
      "## Task Tracking",
      "",
      "",
      "mode: linear",
      "",
      "mcp_server: linear",
      "",
      "",
      "### Linear",
      "",
      "",
      "team: SYN",
      "",
      "project: Synthetic Project",
      "",
      "",
    ];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [spaced] }) });
    const r = runApply(root);
    expect(r.refused).toBe(false);
    expectHealthySettingsTree(root);
    expect(settingsRaw(root).task_tracking.linear).toEqual({ team: "SYN", project: "Synthetic Project" });
  });

  test("AC-.20 [AC-.17 control: the structural-line exemption] an inactive `### Jira` under mode: linear moves into task_tracking.jira; the stub renders only Linear", () => {
    const both = [...S_LINEAR, "### Jira", "", "project: SYNJ", ""];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [both] }) });
    const claudeMd = join(root, "CLAUDE.md");
    const jiraBefore = readWorkspaceBinding(claudeMd, "jira");
    expect(jiraBefore.project).toBe("SYNJ");
    const r = runApply(root);
    expect(r.refused).toBe(false);
    expect(settingsRaw(root).task_tracking.jira).toEqual({ project: "SYNJ" });
    expect(readWorkspaceBinding(claudeMd, "jira")).toEqual(jiraBefore);
    const slots = trackingStubSlots(md(root));
    expect(slots).toHaveLength(1);
    expect(slots[0]!.lines).toContain("### Linear");
    expect(slots[0]!.lines).not.toContain("### Jira");
    expect(md(root)).not.toContain("### Jira");
  });

  test("AC-.20 [AC-.17 control: the structural-line exemption] the shared stop paragraph is structural: the shared Jira tree moves", () => {
    const root = tree(row("shared Jira").files());
    expect(runApply(root).refused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-711.21 — template comment blocks
// ---------------------------------------------------------------------------

const ADVICE_WORDS = /opt in|paste|Flip|Add it by hand/;
const NAMES_MOVED = new RegExp(
  `(${[...MOVED_HEADINGS, "### Linear", "### Jira"].map((h) => h.replace(/[#]/g, "\\#")).join("|")})|\`(${MOVED_KEYS.join("|")})\`|\\b(${MOVED_KEYS.join("|")}):`,
);

function shallowClone(): string {
  return cp.execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: PLUGIN, encoding: "utf8" }).trim();
}

function gitShow(spec: string): string {
  return cp.execFileSync("git", ["show", spec], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** The v2.101.4 template with one byte changed inside its Token Stats block. */
function alteredTokenStatsTemplate(): { text: string; block: string } {
  const tokenBlock = TEMPLATE_BLOCK_TEXTS.find((b) => b.includes("Token Stats section"));
  if (tokenBlock === undefined) throw new Error("template fixture has no Token Stats block");
  const altered = tokenBlock.replace("per-skill token-usage stats", "per-skill token-usage Stats");
  if (altered === tokenBlock || altered.length !== tokenBlock.length) throw new Error("one-byte alteration did not apply");
  return { text: TEMPLATE_MD.replace(tokenBlock, altered), block: altered };
}

const DOCS_NOTE = "<!-- Synthetic reminder: the ## Docs flags drive the /docs output. -->";
const PLAIN_NOTE = "<!-- Synthetic reminder: keep this list short. -->";

function customCommentTree(): string {
  const kc = [...KEY_COMMANDS.slice(0, -1), "", DOCS_NOTE, "", PLAIN_NOTE, ""];
  const text = [...INTRO, ...kc, ...S_DOCS, ...TESTING, ...NOTES].join("\n");
  return tree({ "CLAUDE.md": text });
}

describe("AC-STE-711.21 template comment blocks", () => {
  test("AC-.21 fixture guard: the v2.101.4 template copy carries the seven shipped block kinds", () => {
    expect(TEMPLATE_BLOCK_TEXTS).toHaveLength(7);
  });

  test("AC-.21 every shipped block of the v2.101.4 template is a LEGACY_TEMPLATE_COMMENT_BLOCKS entry", () => {
    const blocks = ((LegacyPaths as Record<string, unknown>).LEGACY_TEMPLATE_COMMENT_BLOCKS ?? []) as { text: string }[];
    const texts = blocks.map((b) => b.text.replace(/\n$/, ""));
    for (const t of TEMPLATE_BLOCK_TEXTS) expect(texts).toContain(t);
  });

  test("AC-.21 [AC-.17 control: the template block removal] on the template row: no `## Docs`/`## Token Stats`/`## Release Files`, no advice beside a moved name, exactly one pointer", () => {
    const { root } = migrated(row("v2.101.4 template output"));
    const after = md(root);
    for (const h of ["## Docs", "## Token Stats", "## Release Files"]) expect(linesEqual(after, h)).toEqual([]);
    const offenders: string[] = [];
    for (const b of commentBlocks(after)) if (ADVICE_WORDS.test(b.text) && NAMES_MOVED.test(b.text)) offenders.push(b.text.split("\n")[0]!);
    for (const l of after.split("\n")) if (ADVICE_WORDS.test(l) && NAMES_MOVED.test(l)) offenders.push(l);
    expect(offenders).toEqual([]);
    expect(linesEqual(after, POINTER_COMMENT)).toHaveLength(1);
    // The surviving pointer sits in `## Commit Convention`, which keeps prose.
    const lines = after.split("\n");
    const ptr = lines.indexOf(POINTER_COMMENT);
    const owner = lines.slice(0, ptr).reverse().find((l) => /^##\s/.test(l));
    expect(owner).toBe("## Commit Convention");
    expect(detect(root).applies).toBe(false);
  });

  test("AC-.21 each LEGACY_TEMPLATE_COMMENT_BLOCKS entry equals a block of the template at its listed commit, which carries its lastRelease (skips by name, with the reason, only in a shallow clone)", () => {
    if (shallowClone() === "true") {
      // Runtime branch, not a skip call site (AC-STE-616.16): a shallow clone
      // has no history to `git show`; the row records why and passes by name.
      console.log("AC-.21 git-show case skipped: `git rev-parse --is-shallow-repository` printed true (shallow clone, no history)");
      expect(shallowClone()).toBe("true");
      return;
    }
    const blocks = (LegacyPaths as Record<string, unknown>).LEGACY_TEMPLATE_COMMENT_BLOCKS as
      | { text: string; firstRelease: string; lastRelease: string; commit: string }[]
      | undefined;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks!.length).toBeGreaterThan(0);
    for (const b of blocks!) {
      // A missing commit throws here, failing the row in a full clone.
      const template = gitShow(`${b.commit}:${TEMPLATE_PATH}`);
      const version = JSON.parse(gitShow(`${b.commit}:plugins/dev-process-toolkit/.claude-plugin/plugin.json`)).version;
      expect({ commit: b.commit, version }).toEqual({ commit: b.commit, version: b.lastRelease });
      expect(commentBlocks(template).map((x) => x.text)).toContain(b.text.replace(/\n$/, ""));
    }
    // The fixture copy is the template at the v2.101.4 commit.
    expect(gitShow(`${TEMPLATE_COMMIT}:${TEMPLATE_PATH}`)).toBe(TEMPLATE_MD);
  });

  test("AC-.21 a Token Stats block one byte off: no `## Token Stats`/`## Docs`, the block kept byte-identical with one pointer directly after, the preview names it", () => {
    const { text, block } = alteredTokenStatsTemplate();
    const root = tree({ "CLAUDE.md": text });
    const blockLine = text.slice(0, text.indexOf(block)).split("\n").length;
    const d = detect(root);
    const r = applyOk(root);
    const preview = [...d.evidence, r.summary].join("\n");
    expect(citesLine(preview, blockLine)).toBe(true);
    const after = md(root);
    for (const h of ["## Docs", "## Token Stats"]) expect(linesEqual(after, h)).toEqual([]);
    expect(after).toContain(block);
    const tail = after.slice(after.indexOf(block) + block.length);
    expect(tail.startsWith(`\n${POINTER_COMMENT}\n`)).toBe(true);
    expect(tail.startsWith(`\n${POINTER_COMMENT}\n${POINTER_COMMENT}`)).toBe(false);
  });

  test("AC-.21 a custom comment naming `## Docs` stays byte-identical with one pointer directly after; one naming nothing gets none; the preview names the first", () => {
    const root = customCommentTree();
    const text = md(root);
    const docsNoteLine = lineNo(text, DOCS_NOTE);
    const d = detect(root);
    const r = applyOk(root);
    expect(citesLine([...d.evidence, r.summary].join("\n"), docsNoteLine)).toBe(true);
    const lines = md(root).split("\n");
    const i = lines.indexOf(DOCS_NOTE);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lines[i + 1]).toBe(POINTER_COMMENT);
    const j = lines.indexOf(PLAIN_NOTE);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(lines[j + 1]).not.toBe(POINTER_COMMENT);
    expect(lines.filter((l) => l === POINTER_COMMENT)).toHaveLength(1);
  });

  // Review T4: a second apply routes through the stub repair, so the move's own
  // "no second pointer" guard needs a MOVE row that already carries the pointer.
  test("AC-.21 [AC-.17 control: the no-second-pointer guard] a move row whose custom comment is already followed by the pointer keeps exactly one", () => {
    const kc = [...KEY_COMMANDS.slice(0, -1), "", DOCS_NOTE, POINTER_COMMENT, ""];
    const root = tree({ "CLAUDE.md": [...INTRO, ...kc, ...S_DOCS, ...TESTING, ...NOTES].join("\n") });
    expect(detectSettingsSource(root)).toBe("legacy");
    applyOk(root);
    const lines = md(root).split("\n");
    const i = lines.indexOf(DOCS_NOTE);
    expect(lines[i + 1]).toBe(POINTER_COMMENT);
    expect(lines[i + 2]).not.toBe(POINTER_COMMENT);
    expect(lines.filter((l) => l === POINTER_COMMENT)).toHaveLength(1);
  });

  for (const [name, build] of [
    ["the one-byte-off Token Stats row", () => tree({ "CLAUDE.md": alteredTokenStatsTemplate().text })],
    ["the custom comment row", customCommentTree],
  ] as const) {
    test(`AC-.21 a second apply on ${name} adds no second pointer, and detect reports applies: false`, () => {
      const root = build();
      applyOk(root);
      const once = md(root);
      const count = linesEqual(once, POINTER_COMMENT).length;
      expect(count).toBeGreaterThan(0);
      expect(detect(root).applies).toBe(false);
      runApply(root);
      expect(linesEqual(md(root), POINTER_COMMENT)).toHaveLength(count);
      expect(md(root)).toBe(once);
    });
  }
});

// ---------------------------------------------------------------------------
// Hardening rows — AC-STE-711.20 step 0, AC-STE-711.6 step 4, AC-STE-711.17
// column-0 key line, AC-STE-711.5 commented `## Docs` markers
// ---------------------------------------------------------------------------

describe("AC-STE-711.20 hardening: a comment block in the `## Task Tracking` span is not dropped silently", () => {
  const COMMENT_ROWS: { name: string; comment: string[] }[] = [
    { name: "a one-line `<!-- team notes -->`", comment: ["<!-- team notes -->"] },
    { name: "a three-line custom comment block", comment: ["<!-- synthetic team notes", "Reviewers rotate weekly on the synthetic board.", "end of synthetic notes -->"] },
  ];
  for (const cr of COMMENT_ROWS) {
    test(`AC-.20 [AC-.17 control: step 0's refusal] ${cr.name} matching no LEGACY_TEMPLATE_COMMENT_BLOCKS entry: detect lists it, apply refuses naming it and the prose-section destination, tree byte-identical`, () => {
      const blocks = ((LegacyPaths as Record<string, unknown>).LEGACY_TEMPLATE_COMMENT_BLOCKS ?? []) as { text: string }[];
      expect(blocks.map((b) => b.text.replace(/\n$/, ""))).not.toContain(cr.comment.join("\n"));
      const s = [...S_LINEAR];
      s.splice(s.indexOf("mcp_server: linear") + 1, 0, ...cr.comment);
      const root = tree({ "CLAUDE.md": legacyMd({ moved: [s] }) });
      const text = md(root);
      const d = detect(root);
      expect(d.applies).toBe(true);
      for (const line of cr.comment) expect(citesLine(d.evidence.join("\n"), lineNo(text, line))).toBe(true);
      const before = snapshot(root);
      const r = runApply(root);
      expectRefusal(r);
      for (const line of cr.comment) expect(citesLine(r.text, lineNo(text, line))).toBe(true);
      expect(r.text).toMatch(/prose section/i);
      expect(r.text).toMatch(/outside/i);
      expect(snapshot(root)).toEqual(before);
    });
  }
});

describe("AC-STE-711.6 hardening: a shared binding with `repo_tag` and no `min_dpt_version`", () => {
  // Orchestrator correction (2026-11-05): a binding that declares `repo_tag` with no
  // `min_dpt_version` is already invalid on v2.101.5 — readWorkspaceBinding refuses it and
  // probe #25 reds it. The move must not invent a floor for it: it refuses in NFR-10 shape,
  // naming the binding, and writes nothing ("No line is ever dropped silently").
  test("AC-.6 [AC-.17 control: step 0's refusal] a shared Linear binding declaring repo_tag with no floor is refused, naming the binding; tree byte-identical", () => {
    const s = [...S_LINEAR];
    s.splice(s.indexOf("default_labels: [syn-a]") + 1, 0, "repo_tag: syn-repo");
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [s] }) });
    expect(md(root)).not.toContain("min_dpt_version");
    const before = snapshot(root);
    const r = runApply(root);
    expectRefusal(r);
    expect(r.text).toContain("repo_tag");
    expect(r.text).toContain("min_dpt_version");
    expect(snapshot(root)).toEqual(before);
  });
});

describe("AC-STE-711.17 hardening: only a column-0 `milestone_scan_fetch:` line is a key line", () => {
  const INDENTED = "  milestone_scan_fetch: true";
  const FENCED = ["## Example Config", "", "```yaml", "task_tracking:", INDENTED, "```", ""];
  const LISTED = ["## Example List", "", "- a synthetic list item:", INDENTED, ""];

  for (const [name, extra] of [
    ["inside a code fence", FENCED],
    ["inside a list", LISTED],
  ] as const) {
    test(`AC-.17 [control: column-0 milestone_scan_fetch key line] an indented line ${name} stays byte-identical and is no home`, () => {
      const root = tree({ "CLAUDE.md": legacyMd({ moved: [S_LINEAR, [...extra]] }) });
      const before = md(root);
      expect(linesEqual(before, INDENTED)).toHaveLength(1);
      applyOk(root);
      const after = md(root);
      expect(linesEqual(after, INDENTED)).toHaveLength(1);
      const nonBlank = (t: string): string[] => t.split("\n").filter((l) => l.trim() !== "");
      const i = nonBlank(after).indexOf(extra[0]);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(nonBlank(after).slice(i, i + nonBlank(extra.join("\n")).length)).toEqual(nonBlank(extra.join("\n")));
      expect("milestone_scan_fetch" in (settingsRaw(root).task_tracking as Record<string, unknown>)).toBe(false);
      expect(detect(root).applies).toBe(false);
    });

    test(`AC-.17 [control: column-0 milestone_scan_fetch key line] an indented line ${name} alone is no legacy home: detect does not apply`, () => {
      const root = tree({ "CLAUDE.md": legacyMd({ top: [...extra] }) });
      expect(detect(root).applies).toBe(false);
      expect(loadProjectSettings(root).settings.task_tracking.milestone_scan_fetch).not.toBe(true);
    });
  }
});

describe("AC-STE-711.5 hardening: a commented `## Docs` span keeps its markers and other lines", () => {
  test("AC-.5 heading + key lines inside one `<!-- -->` block: both markers stay, only the key lines go", () => {
    const commented = ["<!--", "## Docs", "", "user_facing_mode: true", "packages_mode: false", "-->", ""];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [commented] }) });
    const before = md(root);
    expect(linesEqual(before, "<!--")).toHaveLength(1);
    expect(linesEqual(before, "-->")).toHaveLength(1);
    applyOk(root);
    const after = md(root);
    expect(settingsRaw(root).docs.user_facing_mode).toBe(true);
    expect(linesEqual(after, "<!--")).toHaveLength(1);
    expect(linesEqual(after, "-->")).toHaveLength(1);
    expect(lineNo(after, "<!--")).toBeLessThan(lineNo(after, "-->"));
    expect(after.split("\n").some((l) => MOVED_KEY_LINE.test(l))).toBe(false);
    expect(detect(root).applies).toBe(false);
  });

  test("AC-.5 heading + key line + prose inside one `<!-- -->` block: markers, heading and prose stay byte-identical, in order", () => {
    const commented = ["<!--", "## Docs", "", "Synthetic docs remark.", "user_facing_mode: true", "-->", ""];
    const root = tree({ "CLAUDE.md": legacyMd({ moved: [commented] }) });
    applyOk(root);
    const after = md(root);
    expect(settingsRaw(root).docs.user_facing_mode).toBe(true);
    const lines = after.split("\n");
    const open = lines.indexOf("<!--");
    const close = lines.indexOf("-->");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    expect(lines.slice(open + 1, close).filter((l) => l.trim() !== "")).toEqual(["## Docs", "Synthetic docs remark."]);
    expect(linesEqual(after, "user_facing_mode: true")).toEqual([]);
    expect(detect(root).applies).toBe(false);
  });
});
