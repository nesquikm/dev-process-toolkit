// STE-872 (M_e8850b) — a Jira issue type of unknown level is a bug type only
// when it is known or declared standard (AC-STE-872.6 / .7 / .8).
//
// A v2 listing row carries no `hierarchyLevel`. Such a type passes when its
// name is exactly Bug, Task or Story, or when the binding declares
// `jira_bug_type_standard: true`; Epic (any case) and `subtask: true` refuse
// even then. A numeric level decides as today. The front door reads the
// setting through `--root <projectRoot>`:
//   bun bug_tracker_type.ts jira <listing.json> <issueType> [<epicKey>] [--root <projectRoot>]
//
// AC-STE-872.8 mutation sites. The mutants below are real copies of the
// plugin's adapters. Each site is ONE line in bug_tracker_type.ts of the form
//   const <name> = <boolean expression>; // AC-STE-872.8 mutation: <site>
// for <site> in known-name (the name is Bug, Task or Story), setting (the
// binding declared jira_bug_type_standard: true) and epic (the name is Epic in
// any case). The mutation replaces the expression with `false`.
// Invented keys and names only.

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkBugTrackerType } from "../adapters/_shared/src/bug_tracker_type";
import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";

setDefaultTimeout(60_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MODULE_REL = join("adapters", "_shared", "src", "bug_tracker_type.ts");
const EPIC = "ZZ-1";
const KEY = "jira_bug_type_standard";

type Obj = Record<string, unknown>;
type Run = { exitCode: number | null; signal: string | null; stdout: string; stderr: string };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `dpt-872-${label}-`));
  dirs.push(d);
  return d;
}

// ------------------------------------------------------------------ listings

type Row = { name: string; subtask?: boolean; hierarchyLevel?: number };
/** A v2 listing: rows {id, name, description, subtask}, no hierarchyLevel. */
const v2 = (rows: Row[]): Obj => ({
  data: { startAt: 0, maxResults: 50, total: rows.length, issueTypes: rows.map((r, i) => ({ id: String(10001 + i), name: r.name, description: "", subtask: r.subtask === true })) },
});
/** A v1 listing: rows carry a numeric hierarchyLevel. */
const v1 = (rows: Row[]): Obj => ({
  startAt: 0,
  maxResults: 50,
  total: rows.length,
  issueTypes: rows.map((r, i) => ({ id: String(10001 + i), name: r.name, untranslatedName: r.name, description: "", subtask: r.subtask === true, hierarchyLevel: r.hierarchyLevel ?? 0 })),
});
const V2_ROWS: Row[] = [{ name: "Bug" }, { name: "Task" }, { name: "Story" }, { name: "Epic" }, { name: "epic" }, { name: "EPIC" }, { name: "bug" }, { name: "Defect" }, { name: "Zz Sub", subtask: true }];
const V1_ROWS: Row[] = [{ name: "Defect", hierarchyLevel: 0 }, { name: "Zz Initiative", hierarchyLevel: 1 }, { name: "Zz Sub", subtask: true, hierarchyLevel: -1 }];

function saveListing(listing: Obj): string {
  const f = join(tempDir("listing"), "listing.json");
  writeFileSync(f, JSON.stringify(listing));
  return f;
}

// ------------------------------------------------------------------ project roots

/** A settings-file tree: `task_tracking.<adapter>` in specs/settings.yaml. */
function settingsRoot(value: unknown, adapter: "jira" | "linear" = "jira"): string {
  const root = tempDir("settings");
  writeFileSync(join(root, "CLAUDE.md"), "# Fixture\n");
  mkdirSync(join(root, "specs"), { recursive: true });
  const binding: Obj = { ...(adapter === "linear" ? { team: "ZZT" } : {}), project: "ZZ", ...(value === undefined ? {} : { [KEY]: value }) };
  writeFileSync(join(root, "specs", "settings.yaml"), `schema_version: 1\nmin_dpt_version: 3.0.0\ntask_tracking: ${JSON.stringify({ mode: adapter, [adapter]: binding })}\n`);
  return root;
}
/** A legacy tree: a `jira_bug_type_standard:` line under `### Jira` (or `### Linear`) in CLAUDE.md. */
function legacyRoot(value: string | undefined, adapter: "jira" | "linear" = "jira"): string {
  const root = tempDir("legacy");
  const lines = ["# Fixture", "", "## Task Tracking", "", `mode: ${adapter}`, "", adapter === "jira" ? "### Jira" : "### Linear", "", ...(adapter === "linear" ? ["team: ZZT"] : []), "project: ZZ", ...(value === undefined ? [] : [`${KEY}: ${value}`]), ""];
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
  return root;
}
const HOMES: Array<[string, (on: boolean) => string]> = [
  ["settings file", (on) => settingsRoot(on)],
  ["legacy", (on) => legacyRoot(String(on))],
];

// ------------------------------------------------------------------ front door

function frontDoor(pluginRoot: string, args: string[]): Run {
  const p = Bun.spawnSync([process.execPath, "run", join(pluginRoot, MODULE_REL), ...args], { stdout: "pipe", stderr: "pipe", cwd: tmpdir() });
  return { exitCode: p.exitCode, signal: p.signalCode ?? null, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}
const show = (r: Run): string => `exit=${r.exitCode} signal=${r.signal}\nstdout=${r.stdout}\nstderr=${r.stderr}`;
const check = (listing: Obj, type: string, root?: string, pluginRoot = PLUGIN_ROOT): Run =>
  frontDoor(pluginRoot, ["jira", saveListing(listing), type, EPIC, ...(root === undefined ? [] : ["--root", root])]);

function permits(r: Run, name: string): void {
  expect(r.exitCode, show(r)).toBe(0);
  expect(r.stdout.trim(), show(r)).toBe(name);
}
function refuses(r: Run, needle?: string | RegExp): void {
  expect(r.exitCode, show(r)).toBe(2);
  expect(r.stdout, show(r)).toBe("");
  const lines = r.stderr.trim().split("\n");
  expect(lines.filter((l) => l.startsWith("Remedy: ")).length, show(r)).toBe(1);
  expect(lines.filter((l) => l.startsWith("Context: ")).length, show(r)).toBe(1);
  if (needle !== undefined) expect(r.stderr, show(r)).toMatch(needle);
}

// ===================================================================== AC.6

describe("AC-STE-872.6 — a type with no numeric hierarchyLevel: known names pass, custom names need the setting", () => {
  for (const name of ["Bug", "Task", "Story"]) {
    test(`AC-STE-872.6: PERMIT — "${name}" by name alone, no --root`, () => permits(check(v2(V2_ROWS), name), name));
  }
  test('AC-STE-872.6: REFUSE — "bug" is not exactly Bug, and the refusal names jira_bug_type_standard', () => refuses(check(v2(V2_ROWS), "bug"), KEY));
  test("AC-STE-872.6: REFUSE — a custom name with no --root, naming jira_bug_type_standard", () => refuses(check(v2(V2_ROWS), "Defect"), KEY));
  test("AC-STE-872.6: REFUSE — a custom name with a root that does not declare the setting", () => refuses(check(v2(V2_ROWS), "Defect", settingsRoot(undefined)), KEY));
  for (const [home, make] of HOMES) {
    test(`AC-STE-872.6: ${home}: PERMIT — a custom name when the binding declares jira_bug_type_standard: true`, () => permits(check(v2(V2_ROWS), "Defect", make(true)), "Defect"));
    test(`AC-STE-872.6: ${home}: REFUSE — a custom name when the binding declares jira_bug_type_standard: false`, () => refuses(check(v2(V2_ROWS), "Defect", make(false)), KEY));
    for (const epic of ["Epic", "epic", "EPIC"]) {
      test(`AC-STE-872.6: ${home}: REFUSE — "${epic}" even with the setting on`, () => refuses(check(v2(V2_ROWS), epic, make(true)), "cannot take"));
    }
    test(`AC-STE-872.6: ${home}: REFUSE — a subtask: true type even with the setting on`, () => refuses(check(v2(V2_ROWS), "Zz Sub", make(true)), "cannot take"));
  }
  test("AC-STE-872.6: in process — declaredStandard: true admits a custom name, and its absence refuses", () => {
    expect(checkBugTrackerType({ mode: "jira", issueType: "Defect", epicKey: EPIC, listing: v2(V2_ROWS), declaredStandard: true })).toBe("Defect");
    expect(() => checkBugTrackerType({ mode: "jira", issueType: "Defect", epicKey: EPIC, listing: v2(V2_ROWS) })).toThrow(KEY);
  });
});

describe("AC-STE-872.6 — a numeric hierarchyLevel decides as today, whatever the setting says", () => {
  test("AC-STE-872.6: PERMIT — level 0 custom name with no setting", () => permits(check(v1(V1_ROWS), "Defect"), "Defect"));
  test("AC-STE-872.6: PERMIT — level 0 custom name with the setting false", () => permits(check(v1(V1_ROWS), "Defect", settingsRoot(false)), "Defect"));
  for (const [home, make] of HOMES) {
    test(`AC-STE-872.6: ${home}: REFUSE — level 1 with the setting on, the message unchanged`, () => {
      const r = check(v1(V1_ROWS), "Zz Initiative", make(true));
      refuses(r, 'bug type refused: Jira issue type "Zz Initiative" cannot take the milestone Epic ZZ-1 as parent');
      expect(r.stderr).toContain("hierarchyLevel=1");
    });
    test(`AC-STE-872.6: ${home}: REFUSE — level -1 subtask with the setting on`, () => refuses(check(v1(V1_ROWS), "Zz Sub", make(true)), "cannot take"));
  }
  test("AC-STE-872.6: in process — declaredStandard: true does not lift a level-1 refusal", () => {
    expect(() => checkBugTrackerType({ mode: "jira", issueType: "Zz Initiative", epicKey: EPIC, listing: v1(V1_ROWS), declaredStandard: true })).toThrow("cannot take");
  });
});

// ===================================================================== AC.7

/** The NFR-10 refusal readWorkspaceBinding throws, naming the key. */
function bindingRefusal(root: string, adapter: "jira" | "linear" = "jira"): void {
  let message = "";
  try {
    message = `NOT REFUSED: ${JSON.stringify(readWorkspaceBinding(join(root, "CLAUDE.md"), adapter))}`;
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).not.toContain("NOT REFUSED");
  expect(message).toMatch(new RegExp(`(?<![\\w-])${KEY}(?![\\w-])`));
  const lines = message.split("\n");
  expect(lines.filter((l) => l.startsWith("Remedy: ")).length).toBe(1);
  expect(lines.filter((l) => l.startsWith("Context: ")).length).toBe(1);
  expect(lines[0]).not.toMatch(/^(Remedy|Context): /);
}

describe("AC-STE-872.7 — jira_bug_type_standard is a boolean in both homes", () => {
  for (const v of ["yes", "true", 1, 0, ["x"], { on: true }]) {
    test(`AC-STE-872.7: settings file: ${JSON.stringify(v)} refuses NFR-10 naming the key`, () => bindingRefusal(settingsRoot(v)));
  }
  for (const v of ["yes", "1", "on", "maybe"]) {
    test(`AC-STE-872.7: legacy: "${v}" refuses NFR-10 naming the key`, () => bindingRefusal(legacyRoot(v)));
  }
  test("AC-STE-872.7: settings file: under Linear the key is unknown and refuses", () => bindingRefusal(settingsRoot(true, "linear"), "linear"));
  test("AC-STE-872.7: legacy: under Linear the key is unknown and refuses", () => bindingRefusal(legacyRoot("true", "linear"), "linear"));
  for (const [home, make] of [["settings file", settingsRoot], ["legacy", (v: unknown) => legacyRoot(String(v))]] as const) {
    test(`AC-STE-872.7: ${home}: the front door refuses a non-boolean value with exit 2, naming the key`, () => {
      refuses(check(v2(V2_ROWS), "Defect", (make as (v: unknown) => string)("yes")), new RegExp(`(?<![\\w-])${KEY}(?![\\w-])`));
    });
  }
  test("AC-STE-872.7: the existing four-argument call still works (no --root)", () => {
    permits(frontDoor(PLUGIN_ROOT, ["jira", saveListing(v2(V2_ROWS)), "Bug", EPIC]), "Bug");
    permits(frontDoor(PLUGIN_ROOT, ["jira", saveListing(v2(V2_ROWS)), "Bug"]), "Bug");
  });
  for (const rel of [join("skills", "spec-write", "SKILL.md"), join("docs", "resolver-entry.md"), join("adapters", "jira.md")]) {
    test(`AC-STE-872.7: ${rel} shows the --root form of the bug_tracker_type.ts front door`, () => {
      const text = readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
      const calls = text.split("\n").filter((l) => l.includes("bug_tracker_type.ts"));
      expect(calls.some((l) => /bug_tracker_type\.ts[^\n]*--root <projectRoot>/.test(l))).toBe(true);
      expect(text).toContain(KEY);
    });
  }
});

// ===================================================================== AC.8

const SITE = (site: string): RegExp => new RegExp(`^(\\s*(?:const|let)\\s+\\w+\\s*=\\s*)[^;\\n]+;(\\s*//\\s*AC-STE-872\\.8 mutation: ${site})\\s*$`, "m");

/** A copy of the plugin's code; with `site`, that marked line's expression is replaced by `false`. */
function mutantPlugin(site?: string): string {
  const root = tempDir("plugin");
  for (const d of ["adapters", ".claude-plugin"]) cpSync(join(PLUGIN_ROOT, d), join(root, d), { recursive: true });
  if (site !== undefined) {
    const path = join(root, MODULE_REL);
    const src = readFileSync(path, "utf-8");
    const re = SITE(site);
    expect(src.split("\n").filter((l) => new RegExp(re.source).test(l)).length, `bug_tracker_type.ts marks the ${site} site exactly once`).toBe(1);
    const out = src.replace(re, "$1false;$2");
    writeFileSync(path, out);
    expect(readFileSync(path, "utf-8"), `the ${site} mutation applied`).not.toBe(src);
  }
  return root;
}

describe("AC-STE-872.8 — dropping the known-name check, the setting or the Epic refusal turns a named test red", () => {
  test('AC-STE-872.8: known-name check dropped → "PERMIT — \\"Bug\\" by name alone, no --root" fails', () => {
    permits(check(v2(V2_ROWS), "Bug", undefined, mutantPlugin()), "Bug");
    refuses(check(v2(V2_ROWS), "Bug", undefined, mutantPlugin("known-name")));
  });
  test('AC-STE-872.8: setting dropped → "PERMIT — a custom name when the binding declares jira_bug_type_standard: true" fails', () => {
    permits(check(v2(V2_ROWS), "Defect", settingsRoot(true), mutantPlugin()), "Defect");
    refuses(check(v2(V2_ROWS), "Defect", settingsRoot(true), mutantPlugin("setting")), KEY);
  });
  test('AC-STE-872.8: Epic refusal dropped → "REFUSE — \\"Epic\\" even with the setting on" fails', () => {
    refuses(check(v2(V2_ROWS), "Epic", settingsRoot(true), mutantPlugin()), "cannot take");
    permits(check(v2(V2_ROWS), "Epic", settingsRoot(true), mutantPlugin("epic")), "Epic");
  });
});
