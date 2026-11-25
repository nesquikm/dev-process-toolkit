// M_e8850b review fixes (settings group).
//
//   1. The settings-file move carries `site`, `cloud_id` and `jira_bug_type_standard`
//      out of a legacy `### Jira` block, and raises the moved file's top-level
//      `min_dpt_version` to 3.11.0 (the release that added them) when any is moved.
//   2. The generic names `site` and `cloud_id` name a moved key only under `### Jira`:
//      an unrelated `<!-- site: … -->` comment elsewhere gets no pointer.
//   3. The live grader's `binding-unreadable` abort for a Jira run, and the redaction
//      of its detail (root paths become `<A>` / `<B>`, personal data its token).
//   4. The bug-key remedies name where the key lives in both homes.
//
// Running version. The loader refuses a floor above the running toolkit, so this
// file points CLAUDE_PLUGIN_ROOT at a scratch manifest that declares 3.11.0,
// restored in afterAll. Synthetic ids only. No skips, no todos.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkBugTrackerType } from "../adapters/_shared/src/bug_tracker_type";
import { SETTINGS_COMMENT_POINTER } from "../adapters/_shared/src/migrations/legacy_paths";
import { MIGRATIONS, type MigrationEntry } from "../adapters/_shared/src/migrations/index";
import { loadProjectSettings, renderSettingsPointer } from "../adapters/_shared/src/project_settings";
import { extractBundle, privacyViolations, type RunMeta } from "../adapters/_shared/src/shared_tracker_live_grader";

const SITE_FLOOR = "3.11.0";
const MOVE_FLOOR = "3.0.0";

const ROOTS: string[] = [];
let prevPluginRoot: string | undefined;

beforeAll(() => {
  const fake = mkdtempSync(join(tmpdir(), "e8850b-fix-plugin-"));
  ROOTS.push(fake);
  mkdirSync(join(fake, ".claude-plugin"), { recursive: true });
  writeFileSync(join(fake, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "dev-process-toolkit", version: SITE_FLOOR }));
  prevPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = fake;
});

afterAll(() => {
  if (prevPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = prevPluginRoot;
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "e8850b-fix-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function entry(): MigrationEntry {
  const e = MIGRATIONS.find((m) => m.id === "settings-file");
  if (e === undefined || typeof e.apply !== "function") throw new Error("no settings-file entry with apply in MIGRATIONS");
  return e;
}

function move(root: string): { text: string; changed: string[] } {
  const r = entry().apply!(root);
  if (/Refusing:/.test(r.summary)) throw new Error(`move refused unexpectedly:\n${r.summary}`);
  return { text: r.summary, changed: r.changed };
}

const md = (root: string): string => readFileSync(join(root, "CLAUDE.md"), "utf8");
const settings = (root: string): Record<string, any> =>
  Bun.YAML.parse(readFileSync(join(root, "specs", "settings.yaml"), "utf8")) as Record<string, any>;

const jiraTree = (extra: string[], mode = "jira"): string =>
  tree({
    "CLAUDE.md": [
      "# Synthetic",
      "",
      "## Task Tracking",
      "",
      `mode: ${mode}`,
      "",
      ...(mode === "linear" ? ["### Linear", "", "team: SYN", "project: Synthetic Project", ""] : []),
      "### Jira",
      "",
      "project: SYNJ",
      ...extra,
      "",
    ].join("\n"),
  });

// ---------------------------------------------------------------------------
// 1. The move raises the floor for the 3.11.0 Jira keys
// ---------------------------------------------------------------------------

describe("settings-file move — site / cloud_id / jira_bug_type_standard", () => {
  test("all three keys move, the boolean stays a boolean, and the top-level floor is 3.11.0", () => {
    const root = jiraTree(["site: example.atlassian.net", "cloud_id: 11111111-2222-4333-8444-555555555555", "jira_bug_type_standard: true"]);
    move(root);
    const s = settings(root);
    expect(s.task_tracking.jira.site).toBe("example.atlassian.net");
    expect(s.task_tracking.jira.cloud_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(s.task_tracking.jira.jira_bug_type_standard).toBe(true);
    expect(s.min_dpt_version).toBe(SITE_FLOOR);
    // The CLAUDE.md pointer names the same floor the file declares.
    expect(md(root)).toContain(renderSettingsPointer(SITE_FLOOR).trimEnd());
    expect(md(root)).not.toContain(renderSettingsPointer(MOVE_FLOOR).trimEnd());
    // The moved file reads back on the release that added the keys.
    expect(loadProjectSettings(root).settings.task_tracking.jira?.site).toBe("example.atlassian.net");
  });

  for (const line of ["site: example.atlassian.net", "cloud_id: 11111111-2222-4333-8444-555555555555", "jira_bug_type_standard: false"]) {
    test(`\`${line}\` alone raises the floor to 3.11.0`, () => {
      const root = jiraTree([line]);
      move(root);
      expect(settings(root).min_dpt_version).toBe(SITE_FLOOR);
    });
  }

  test("jira_bug_type_standard: false moves as the boolean false", () => {
    const root = jiraTree(["jira_bug_type_standard: false"]);
    move(root);
    expect(settings(root).task_tracking.jira.jira_bug_type_standard).toBe(false);
  });

  test("an inactive `### Jira` (mode: linear) carrying `site` raises the floor too", () => {
    const root = jiraTree(["site: example.atlassian.net"], "linear");
    move(root);
    const s = settings(root);
    expect(s.task_tracking.jira.site).toBe("example.atlassian.net");
    expect(s.min_dpt_version).toBe(SITE_FLOOR);
  });

  test("CONTROL — a Jira binding without the new keys keeps the 3.0.0 floor", () => {
    const root = jiraTree([]);
    move(root);
    expect(settings(root).min_dpt_version).toBe(MOVE_FLOOR);
    expect(md(root)).toContain(renderSettingsPointer(MOVE_FLOOR).trimEnd());
  });

  test("CONTROL — a blank `site:` reads as absent and raises nothing", () => {
    const root = jiraTree(["site:"]);
    move(root);
    expect(settings(root).task_tracking.jira.site).toBeUndefined();
    expect(settings(root).min_dpt_version).toBe(MOVE_FLOOR);
  });
});

// ---------------------------------------------------------------------------
// 2. Generic Jira names are scoped to `### Jira`
// ---------------------------------------------------------------------------

describe("settings-file move — `site:` / `cloud_id:` outside `### Jira` are prose", () => {
  const withNote = (note: string): string =>
    tree({
      "CLAUDE.md": ["# Synthetic", "", "## Notes", "", note, "", "Deploys go out on Fridays.", "", "## Task Tracking", "", "mode: none", ""].join("\n"),
    });

  for (const note of ["<!-- site: staging.example.org -->", "<!-- cloud_id: 11111111-2222-4333-8444-555555555555 -->"]) {
    test(`${note} under ## Notes gets no pointer and no kept-block row`, () => {
      const root = withNote(note);
      const ev = entry().detect(root).evidence;
      expect(ev.filter((r) => /comment block kept/.test(r))).toEqual([]);
      const r = move(root);
      expect(r.text).not.toMatch(/comment block kept/);
      const lines = md(root).split("\n");
      const at = lines.indexOf(note);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(lines[at + 1]).not.toBe(SETTINGS_COMMENT_POINTER);
      expect(lines.filter((l) => l === SETTINGS_COMMENT_POINTER)).toEqual([]);
    });
  }

  test("CONTROL — a comment naming a non-generic moved key (`project:`) under ## Notes still gets the pointer", () => {
    const note = "<!-- project: SYNJ -->";
    const root = withNote(note);
    expect(entry().detect(root).evidence.filter((r) => /comment block kept/.test(r)).length).toBe(1);
    move(root);
    const lines = md(root).split("\n");
    expect(lines[lines.indexOf(note) + 1]).toBe(SETTINGS_COMMENT_POINTER);
  });
});

// ---------------------------------------------------------------------------
// 3. The grader's binding-unreadable abort and its redaction
// ---------------------------------------------------------------------------

describe("live grader — a Jira run whose binding cannot be read aborts at extraction", () => {
  const run = (tracker: "jira" | "linear"): RunMeta => ({
    runId: "run-e8850b-fix",
    nonce: "n0nce",
    tracker,
    pluginVersion: SITE_FLOOR,
    startedAt: "2026-11-25T00:00:00.000Z",
    behaviourDigest: { digest: "sha256:0", files: {} },
    belowFloorDigest: "sha256:0",
    container: "SYNJ",
    repointFrom: null,
    linearTeam: null,
    skips: [],
    auditQuery: "",
  });
  const BAD_EMAIL = "jo.doe@example.com";

  /** Root A's CLAUDE.md is a directory (the refusal names its absolute path); root B's `site` is an email. */
  function roots(): { A: string; B: string; config: string } {
    const A = tree({ "README.md": "a\n" });
    mkdirSync(join(A, "CLAUDE.md"));
    const B = tree({
      "CLAUDE.md": ["# B", "", "## Task Tracking", "", "mode: jira", "", "### Jira", "", "project: SYNJ", `site: ${BAD_EMAIL}`, ""].join("\n"),
    });
    const config = tree({ "projects/.keep": "" });
    return { A, B, config };
  }

  const extract = (r: { A: string; B: string; config: string }, tracker: "jira" | "linear") =>
    extractBundle({
      configDirs: [r.config],
      ledgerSessionIds: [],
      roots: { A: { path: r.A, tag: "syn-a" }, B: { path: r.B, tag: "syn-b" } },
      run: run(tracker),
      synthetic: true,
    });

  test("both unreadable bindings are named, each as `binding-unreadable`, and the verdict is abort", () => {
    const r = roots();
    const x = extract(r, "jira");
    expect(x.ok).toBe(false);
    if (x.ok) return;
    expect(x.verdict.outcome).toBe("abort");
    expect(x.verdict.findings.map((f) => f.code)).toEqual(["binding-unreadable", "binding-unreadable"]);
    const [a, b] = x.verdict.findings.map((f) => f.detail ?? "");
    expect(a!.startsWith("repository <A>'s Jira binding cannot be read: ")).toBe(true);
    expect(b!.startsWith("repository <B>'s Jira binding cannot be read: ")).toBe(true);
  });

  test("the detail is redacted: the root path becomes its token, and personal data its class token", () => {
    const r = roots();
    const x = extract(r, "jira");
    if (x.ok) throw new Error("expected an abort");
    const [a, b] = x.verdict.findings.map((f) => f.detail ?? "");
    expect(a).toContain("<A>/CLAUDE.md");
    expect(a).not.toContain(r.A);
    expect(b).toContain("<email>");
    expect(b).not.toContain(BAD_EMAIL);
    expect(privacyViolations(x.verdict.findings)).toEqual([]);
  });

  test("CONTROL — a Linear run never reads the Jira binding, so it has no binding-unreadable finding", () => {
    const r = roots();
    let codes: string[] = [];
    try {
      const x = extract(r, "linear");
      codes = x.ok ? [] : x.verdict.findings.map((f) => f.code);
    } catch {
      codes = [];
    }
    expect(codes).not.toContain("binding-unreadable");
  });

  test("CONTROL — readable Jira bindings raise no binding-unreadable finding", () => {
    const body = ["# R", "", "## Task Tracking", "", "mode: jira", "", "### Jira", "", "project: SYNJ", "site: example.atlassian.net", ""].join("\n");
    const r = { A: tree({ "CLAUDE.md": body }), B: tree({ "CLAUDE.md": body }), config: tree({ "projects/.keep": "" }) };
    let codes: string[] = [];
    try {
      const x = extract(r, "jira");
      codes = x.ok ? [] : x.verdict.findings.map((f) => f.code);
    } catch {
      codes = [];
    }
    expect(codes).not.toContain("binding-unreadable");
  });
});

// ---------------------------------------------------------------------------
// 4. The bug-key remedies name both homes
// ---------------------------------------------------------------------------

describe("bug-key remedies name where the key lives in both homes", () => {
  const JIRA_HOME = "under task_tracking.jira in specs/settings.yaml (under ### Jira in CLAUDE.md before the settings move)";
  const LINEAR_HOME = "under task_tracking.linear in specs/settings.yaml (under ### Linear in CLAUDE.md before the settings move)";

  function refusal(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected a refusal");
  }
  const remedy = (msg: string): string => msg.split("\n").find((l) => l.startsWith("Remedy: ")) ?? "";
  /** A v1 Jira listing: rows carry a numeric hierarchyLevel unless `hierarchyLevel: null`. */
  const v1 = (rows: Array<{ name: string; hierarchyLevel?: number | null; subtask?: boolean }>) => ({
    startAt: 0,
    maxResults: 50,
    total: rows.length,
    issueTypes: rows.map((r, i) => ({
      id: String(10001 + i),
      name: r.name,
      description: "",
      subtask: r.subtask === true,
      ...(r.hierarchyLevel === null ? {} : { hierarchyLevel: r.hierarchyLevel ?? 0 }),
    })),
  });
  const label = (name: string, extra: Record<string, unknown> = {}) => ({ id: `lbl-${name}`, name, color: "#000000", ...extra });

  test("every refusal's remedy names the settings home and the legacy home, never CLAUDE.md alone", () => {
    const messages: Array<[string, string]> = [];
    const run = (o: Record<string, unknown>, home: string) => messages.push([remedy(refusal(() => checkBugTrackerType(o))), home]);
    run({ mode: "jira", issueType: "Defect", epicKey: "SYNJ-1", listing: v1([{ name: "Bug" }]) }, JIRA_HOME);
    run({ mode: "jira", issueType: "Subtask", epicKey: "SYNJ-1", listing: v1([{ name: "Subtask", hierarchyLevel: -1, subtask: true }]) }, JIRA_HOME);
    run({ mode: "jira", issueType: "Defect", epicKey: "SYNJ-1", listing: v1([{ name: "Defect", hierarchyLevel: null }]) }, JIRA_HOME);
    run({ mode: "linear", label: "Bug", listing: { labels: [label("Feature")], hasNextPage: false } }, LINEAR_HOME);
    run({ mode: "linear", label: "Bug", listing: { labels: [label("Bug", { retiredAt: "2026-10-01T00:00:00.000Z" })], hasNextPage: false } }, LINEAR_HOME);
    expect(messages.length).toBe(5);
    for (const [r, home] of messages) {
      expect(r).toContain(home);
      expect(r).not.toMatch(/ in CLAUDE\.md to /);
    }
  });
});
