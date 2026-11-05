// STE-710 — Setup writes the settings file and a slim CLAUDE.md.
//
// Modules under test:
//   - adapters/_shared/src/project_settings.ts — `writeProjectSettings`, the
//     `set` verb of the front door, `SETTABLE_KEYS`, `renderSettingsPointer`.
//   - every writer in the FR's writer table, switched by the loader's source:
//     `writeTrackerConfig` (tracker_config.ts), `writeTrackerSubsection`
//     (setup/tracker_binding_write.ts), `reseedBranchTemplate`
//     (setup/migrate_branch_template.ts), `videoInit` (video_init.ts),
//     `verifyRepoint` / `writeRepoint` (repoint_tracker_binding.ts), and
//     `renderVerificationSection` (moves to the legacy module).
//   - templates/CLAUDE.md.template, skills/*/SKILL.md, docs/*.md (scans).
//
// Shape assumed by these tests:
//   - `writeProjectSettings(projectRoot, update, opts?)`. `update` is a deep
//     partial of the settings file's own snake_case shape (the shape
//     `loadProjectSettings(root).settings` returns): maps merge key by key,
//     scalars and lists replace, and an OWN key whose value is `undefined`
//     removes that key (and its lines). `opts.create === true` creates the
//     file (only `/setup` and STE-711's migration pass it). Refusals throw an
//     Error whose message carries the NFR-10 Refusing / Remedy / Context lines.
//   - A modelled `/setup` run calls the writers in the order `/setup`'s steps
//     call them: CLAUDE.md from the template, the create, then 7b, its
//     binding sub-section, 7c, 7d, 7e, 7f, 7g and 8c.
//
// AC-STE-710.13 (mutation controls) — each guarded behaviour, and the named
// test that reds when it is removed:
//   - source switch in writeTrackerSubsection -> "AC-.3 settings tree: writeTrackerSubsection writes task_tracking.linear, not `### Linear`"
//   - source switch in writeTrackerConfig      -> "AC-.3 settings tree: writeTrackerConfig writes task_tracking.status_vocabulary and no tracker-config.yaml"
//   - stub re-render from writeProjectSettings -> "AC-.12 a write that changes the Linear team re-renders the stub"
//                                                 "AC-.12 a write to mode: none removes the stub slot"
//   - `/setup`-only rule for `none` sources    -> "AC-.15 none tree: videoInit writes .dpt/video and no settings file"
//                                                 "AC-.15 none tree: writeTrackerConfig writes specs/tracker-config.yaml and no settings file"
//   - the template filter                      -> tests/m_94e6f7-ste-710-setup-template-filter.test.ts "AC-.17 per-category: the landed settings file holds no NEW_KEYS key"
//   - either direction of the pair refusal     -> tests/m_94e6f7-ste-710-setup-template-filter.test.ts "AC-.17 CLAUDE.md alone refuses ..." / "AC-.17 specs/settings.yaml alone refuses ..."
//   - the analyzer entry                       -> tests/m_94e6f7-ste-710-template-analyzer.test.ts "AC-.19 PROCESS_CONFIG_FILES contains specs/settings.yaml"
//   - the in-place line edit                   -> "AC-.18 a one-key change keeps every other line byte-identical"
//   - the `set` verb's source switch           -> "AC-.20 legacy tree: set writes nothing and prints source: legacy"
//                                                 "AC-.20 settings tree: set writes verification.verify_skill and leaves CLAUDE.md byte-identical"
//   - the `set` verb's closed key list         -> "AC-.20 a key outside SETTABLE_KEYS refuses and writes nothing"
//   - the foreign-file guard on create         -> "AC-.21 create over a foreign settings file refuses and leaves it byte-identical"
//
// AC-STE-710.14 is the full-suite gate (`bun test` from plugins/dev-process-toolkit
// reports 0 failures, skip identities equal to the trunk baseline by name). It is
// graded by the gate run, not by a test in this file.
//
// AC-STE-710.9 (template pins) is graded by the pre-existing tests the
// implementer rewrites; they are listed in the FR's Implementation notes.
//
// All ids, teams, projects, tags and session ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import * as PS from "../adapters/_shared/src/project_settings";
import * as LEGACY from "../adapters/_shared/src/project_settings_legacy";
import * as TC from "../adapters/_shared/src/tracker_config";
import * as TB from "../adapters/_shared/src/setup/tracker_binding_write";
import * as RESEED from "../adapters/_shared/src/setup/migrate_branch_template";
import * as VIDEO from "../adapters/_shared/src/video_init";
import * as REPOINT from "../adapters/_shared/src/repoint_tracker_binding";
import { runningDptVersion } from "../adapters/_shared/src/dpt_version";
import { isToolkitManaged, SETUP_MARKER } from "../adapters/_shared/src/toolkit_managed";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { runBunZeroMatchPlaceholderProbe } from "../adapters/_shared/src/bun_zero_match_placeholder";
import { parseVideoConfig } from "../adapters/_shared/src/video/config";
import { parseVideoStyle } from "../adapters/_shared/src/video/style";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const P = PS as Any;
const L = LEGACY as Any;

const PLUGIN = resolve(import.meta.dir, "..");
const PS_PATH = join(PLUGIN, "adapters", "_shared", "src", "project_settings.ts");
const REPOINT_PATH = join(PLUGIN, "adapters", "_shared", "src", "repoint_tracker_binding.ts");
const TEMPLATE_PATH = join(PLUGIN, "templates", "CLAUDE.md.template");
const SETTINGS = "specs/settings.yaml";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste710-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Every file under `root` as relative path -> bytes (the tree's byte snapshot). */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = readFileSync(p, "latin1");
    }
  };
  walk(root);
  return out;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Block-style top level, JSON flow values (valid YAML), as the loader suite builds its fixtures. */
function toSettingsYaml(obj: Record<string, unknown>): string {
  return `${Object.entries(obj)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n`;
}

function nfr10(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  expect(msg).toMatch(/^Refusing: /m);
  expect(msg).toMatch(/^Remedy: /m);
  expect(msg).toMatch(/^Context: /m);
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw, got a return");
}

function load(root: string): Any {
  return PS.loadProjectSettings(root);
}

function write(root: string, update: Record<string, unknown>, opts?: Record<string, unknown>): Any {
  return P.writeProjectSettings(root, update, opts);
}

const FLOOR = "2.0.0";

const STATUS_VOCAB = {
  tracker_key: "linear",
  statuses: ["Todo", "In Progress", "In Review", "Done"],
  roles: { initial: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done" },
};

const VIDEO_CONFIG = {
  tts: { provider: "elevenlabs", voice: "SynthVoice" },
  recorder: { kind: "web" },
  music: { source: "none" },
};

/** The loader suite's full Linear fixture (synthetic values, floor under the running toolkit). */
const BASE: Record<string, unknown> = {
  schema_version: 1,
  min_dpt_version: FLOOR,
  task_tracking: {
    mode: "linear",
    mcp_server: "linear",
    jira_ac_field: "",
    branch_template: "{type}/m{N}-{slug}",
    milestone_scan_fetch: false,
    linear: { team: "SYN", project: "Synthetic Project", default_labels: [], linear_bug_label: "Bug" },
    status_vocabulary: STATUS_VOCAB,
  },
  verification: { verify_skill: "smoke-test", verify_mode: "manual", run_cmd: "none", e2e_cmd: "none" },
  docs: { user_facing_mode: false, packages_mode: false, changelog_ci_owned: false, changelog_unversioned: false },
  orchestration: { default_effort: "ultracode", merge_policy: "offer" },
  tracking: { token_stats: { enabled: false } },
  close_out: { upgrade_offer: { enabled: false } },
  release: { files: [{ path: "package.json", kind: "json", field: "version" }] },
  video: { config: VIDEO_CONFIG, style: {} },
};

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
    status_vocabulary: { ...STATUS_VOCAB, tracker_key: "jira" },
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

const FIXTURES: Record<string, Record<string, unknown>> = {
  linear: BASE,
  jira: JIRA_BASE,
  custom: CUSTOM_BASE,
  none: NONE_BASE,
};

const MINIMAL_SETTINGS = `schema_version: 1\nmin_dpt_version: "${FLOOR}"\n`;

/** A settings-file CLAUDE.md: `## Project Settings` with the pointer, optionally a stub below. */
function settingsClaudeMd(stub = ""): string {
  let body = `# Synthetic Project\n\n## Project Settings\n\n${PS.renderSettingsPointer(FLOOR)}`;
  if (stub) body += `\n${stub}`;
  body += "\n## Key Commands\n\nbun test\n";
  return body;
}

const LINEAR_TT = { mode: "linear", mcp_server: "linear", linear: { team: "SYN", project: "Synthetic Project" } };
const LINEAR_STUB = PS.renderTrackingStub({ task_tracking: LINEAR_TT });
const LINEAR_SETTINGS = [
  "schema_version: 1",
  `min_dpt_version: "${FLOOR}"`,
  "task_tracking:",
  "  mode: linear",
  "  mcp_server: linear",
  "  linear:",
  "    team: SYN",
  "    project: Synthetic Project",
  "docs:",
  "  user_facing_mode: false",
  "  packages_mode: false",
  "",
].join("\n");

function linearSettingsTree(extra: Record<string, string> = {}): string {
  return tree({ "CLAUDE.md": settingsClaudeMd(LINEAR_STUB), [SETTINGS]: LINEAR_SETTINGS, ...extra });
}

const ALL_MOVED = [...LEGACY.MOVED_HEADINGS, "### Linear", "### Jira"] as readonly string[];

/** Moved headings in CLAUDE.md that sit outside every stub slot. */
function movedHeadingsOutsideStub(md: string): string[] {
  const lines = md.split("\n");
  const inStub = new Set<number>();
  for (const s of LEGACY.trackingStubSlots(md)) for (let i = 0; i < s.lines.length; i++) inStub.add(s.line - 1 + i);
  return lines.filter((l, i) => ALL_MOVED.includes(l) && !inStub.has(i));
}

/** The stub slot in CLAUDE.md is byte-equal to its render over the loaded settings (none when it renders ""). */
function expectStubInStep(root: string): void {
  const md = read(root, "CLAUDE.md");
  const render = PS.renderTrackingStub(load(root).settings);
  const slots = LEGACY.trackingStubSlots(md);
  if (render === "") {
    expect(slots).toEqual([]);
  } else {
    expect(slots).toHaveLength(1);
    expect(`${slots[0]!.text}\n`).toBe(render);
  }
}

/** `before`'s lines appear in `after` in order (a subsequence). */
function isSubsequence(before: string[], after: string[]): boolean {
  let j = 0;
  for (const l of after) if (j < before.length && l === before[j]) j++;
  return j === before.length;
}

function frontDoor(args: string[], env: Record<string, string | undefined> = process.env): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync([process.execPath, "run", PS_PATH, ...args], { cwd: PLUGIN, env: env as Record<string, string> });
  return { code: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const SETUP_FLOOR = runningDptVersion();
const RELEASE_FILES = [
  { path: "package.json", kind: "json", field: "version" },
  { path: "CHANGELOG.md", kind: "changelog" },
];

/**
 * A fresh `/setup`, modelled: CLAUDE.md from the template, the create (only
 * `/setup` passes `{ create: true }`), then the writers in step order.
 */
function modelFreshSetup(root: string, mode: "none" | "linear"): void {
  writeFileSync(join(root, "CLAUDE.md"), readFileSync(TEMPLATE_PATH, "utf8"));
  write(root, { schema_version: 1, min_dpt_version: SETUP_FLOOR }, { create: true });
  const md = join(root, "CLAUDE.md");
  if (mode === "linear") {
    write(root, { task_tracking: { mode: "linear", mcp_server: "linear", jira_ac_field: "" } }); // 7b
    TB.writeTrackerSubsection(md, "linear", { project: "Synthetic Project", team: "SYN" }); // 7b binding
    write(root, { task_tracking: { branch_template: "{type}/m{N}-{slug}" } }); // 7c
  }
  write(root, { docs: { user_facing_mode: false, packages_mode: false, changelog_ci_owned: false } }); // 7d
  write(root, { release: { files: RELEASE_FILES } }); // 7e
  if (mode === "linear") TC.writeTrackerConfig(join(root, "specs"), clone(STATUS_VOCAB) as Any); // 7f
  write(root, { tracking: { token_stats: { enabled: false } } }); // 7g
  write(root, { verification: { verify_skill: "smoke-test" } }); // 8c
}

/** Every leaf key path of a parsed YAML value (lists are leaves). */
function leafPaths(v: unknown, prefix = ""): string[] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return [prefix];
  const out: string[] = [];
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) out.push(...leafPaths(child, prefix ? `${prefix}.${k}` : k));
  return out;
}

// ---------------------------------------------------------------------------
// AC-STE-710.1 — round trip
// ---------------------------------------------------------------------------

describe("AC-STE-710.1 writeProjectSettings round-trips every loader fixture", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    test(`AC-.1 ${name}: an in-place write loads back deep-equal, and a second identical write is byte-identical`, () => {
      const reference = tree({ [SETTINGS]: toSettingsYaml(fixture) });
      const root = tree({ "CLAUDE.md": settingsClaudeMd(), [SETTINGS]: MINIMAL_SETTINGS });
      write(root, clone(fixture));
      expect(load(root).source).toBe("settings");
      expect(load(root).settings).toEqual(load(reference).settings);
      const settingsBytes = read(root, SETTINGS);
      const mdBytes = read(root, "CLAUDE.md");
      write(root, clone(fixture));
      expect(read(root, SETTINGS)).toBe(settingsBytes);
      expect(read(root, "CLAUDE.md")).toBe(mdBytes);
    });

    test(`AC-.1 ${name}: a create loads back deep-equal, and re-writing the same settings is byte-identical`, () => {
      const reference = tree({ [SETTINGS]: toSettingsYaml(fixture) });
      const root = tree({ "CLAUDE.md": settingsClaudeMd() });
      write(root, clone(fixture), { create: true });
      expect(load(root).settings).toEqual(load(reference).settings);
      const bytes = read(root, SETTINGS);
      write(root, clone(fixture));
      expect(read(root, SETTINGS)).toBe(bytes);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-710.2 — closed-set refusal
// ---------------------------------------------------------------------------

describe("AC-STE-710.2 writeProjectSettings refuses an update that breaks a closed set", () => {
  const BAD: Record<string, Record<string, unknown>> = {
    "an enum value outside its set": { orchestration: { merge_policy: "sometimes" } },
    "an unknown key in a closed section": { docs: { bogus_mode: true } },
    "an unknown top-level key": { retro_bogus: { enabled: true } },
    "a boolean given a string": { tracking: { token_stats: { enabled: "yes" } } },
  };
  for (const [label, update] of Object.entries(BAD)) {
    test(`AC-.2 ${label} refuses in NFR-10 shape and leaves both files byte-identical`, () => {
      const root = linearSettingsTree();
      const before = snapshot(root);
      const err = thrown(() => write(root, update));
      nfr10(err);
      expect(err.message).toContain("specs/settings.yaml");
      expect(snapshot(root)).toEqual(before);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-710.18 — comments survive a write
// ---------------------------------------------------------------------------

describe("AC-STE-710.18 comments survive a write", () => {
  const COMMENTED = [
    "# Synthetic settings — a full-line comment",
    "schema_version: 1",
    `min_dpt_version: "${FLOOR}"   # floor note`,
    "",
    "docs:",
    "  user_facing_mode: false   # keep off",
    "  packages_mode: false",
    "tracking:",
    "  token_stats: { enabled: false }   # note",
    "",
    "# orchestration knobs",
    "orchestration:",
    "  default_effort: high",
    "  merge_policy: offer",
    "",
  ].join("\n");

  function commentedTree(): string {
    return tree({ "CLAUDE.md": settingsClaudeMd(), [SETTINGS]: COMMENTED });
  }

  test("AC-.18 a one-key change keeps every other line byte-identical and in order", () => {
    const root = commentedTree();
    write(root, { docs: { packages_mode: true } });
    const before = COMMENTED.split("\n");
    const after = read(root, SETTINGS).split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((l, i) => (after[i] === l ? [] : [i]));
    expect(changed).toEqual([before.indexOf("  packages_mode: false")]);
    expect(after[changed[0]!]).toBe("  packages_mode: true");
    expect(load(root).settings.docs).toEqual({ user_facing_mode: false, packages_mode: true });
    expect(load(root).settings.orchestration).toEqual({ default_effort: "high", merge_policy: "offer" });
  });

  test("AC-.18 a changed key whose own line carries a trailing comment keeps that comment byte-identical", () => {
    const root = commentedTree();
    write(root, { docs: { user_facing_mode: true } });
    const before = COMMENTED.split("\n");
    const after = read(root, SETTINGS).split("\n");
    const i = before.indexOf("  user_facing_mode: false   # keep off");
    expect(after[i]).toMatch(/^ {2}user_facing_mode: true\s+# keep off$/);
    expect(after.filter((_, j) => j !== i)).toEqual(before.filter((_, j) => j !== i));
    expect(load(root).settings.docs.user_facing_mode).toBe(true);
  });

  test("AC-.18 a key inside a flow collection rewrites only that line, stays in flow style and keeps `# note`", () => {
    const root = commentedTree();
    write(root, { tracking: { token_stats: { enabled: true } } });
    const before = COMMENTED.split("\n");
    const after = read(root, SETTINGS).split("\n");
    const i = before.indexOf("  token_stats: { enabled: false }   # note");
    expect(after[i]).toMatch(/^ {2}token_stats: \{ ?enabled: true ?\}\s+# note$/);
    expect(after.filter((_, j) => j !== i)).toEqual(before.filter((_, j) => j !== i));
    expect(load(root).settings.tracking.token_stats.enabled).toBe(true);
  });

  test("AC-.18 inserting a new key changes only that key's lines, at its place in the fixed key order", () => {
    const root = commentedTree();
    write(root, { docs: { changelog_ci_owned: true } });
    const before = COMMENTED.split("\n");
    const after = read(root, SETTINGS).split("\n");
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((l) => !before.includes(l));
    expect(added).toEqual(["  changelog_ci_owned: true"]);
    expect(after.filter((l) => l !== "  changelog_ci_owned: true")).toEqual(before);
    // Fixed key order: user_facing_mode, packages_mode, changelog_ci_owned.
    expect(after.indexOf("  changelog_ci_owned: true")).toBe(after.indexOf("  packages_mode: false") + 1);
    expect(load(root).settings.docs).toEqual({ user_facing_mode: false, packages_mode: false, changelog_ci_owned: true });
  });

  test("AC-.18 inserting a new section changes only its own lines, placed before its later siblings", () => {
    const root = commentedTree();
    write(root, { verification: { verify_skill: "smoke-test" } });
    const before = COMMENTED.split("\n");
    const after = read(root, SETTINGS).split("\n");
    const added = after.filter((l) => !before.includes(l));
    expect(added).toEqual(["verification:", "  verify_skill: smoke-test"]);
    expect(after.filter((l) => !added.includes(l))).toEqual(before);
    // Fixed top-level order puts verification before docs.
    expect(after.indexOf("verification:")).toBeLessThan(after.indexOf("docs:"));
    expect(load(root).settings.verification).toEqual({ verify_skill: "smoke-test" });
  });

  test("AC-.18 removing a key removes only its own line", () => {
    const root = commentedTree();
    write(root, { orchestration: { merge_policy: undefined } });
    const before = COMMENTED.split("\n");
    const after = read(root, SETTINGS).split("\n");
    expect(after).toEqual(before.filter((l) => l !== "  merge_policy: offer"));
    expect(load(root).settings.orchestration).toEqual({ default_effort: "high" });
  });

  test("AC-.18 removing a section removes only its own lines; its comment above stays", () => {
    const root = commentedTree();
    write(root, { orchestration: undefined });
    const after = read(root, SETTINGS).split("\n");
    const gone = ["orchestration:", "  default_effort: high", "  merge_policy: offer"];
    expect(after).toEqual(COMMENTED.split("\n").filter((l) => !gone.includes(l)));
    expect(after).toContain("# orchestration knobs");
    expect(load(root).settings.orchestration).toEqual({});
  });

  test("AC-.18 a create writes block style: no flow marker other than an empty {} or []", () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd() });
    write(root, clone(BASE), { create: true });
    const text = read(root, SETTINGS);
    const stripped = text
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .map((l) =>
        l
          .replace(/"(?:[^"\\]|\\.)*"/g, '""')
          .replace(/'(?:[^']|'')*'/g, "''")
          .replace(/\{\}|\[\]/g, ""),
      )
      .join("\n");
    expect(stripped).not.toMatch(/[{}[\]]/);
    // One scalar per line: no line carries two `key: value` pairs.
    for (const l of stripped.split("\n")) expect(l.match(/\b[a-z_]+: \S/g)?.length ?? 0).toBeLessThanOrEqual(1);
    const reference = tree({ [SETTINGS]: toSettingsYaml(BASE) });
    expect(load(root).settings).toEqual(load(reference).settings);
  });

  test("AC-.18 a write that leaves the settings unchanged leaves the file byte-identical", () => {
    const root = commentedTree();
    write(root, { docs: { user_facing_mode: false } });
    expect(read(root, SETTINGS)).toBe(COMMENTED);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.3 — each writer writes its target key on a settings-file tree
// ---------------------------------------------------------------------------

describe("AC-STE-710.3 writers on a settings-file tree write the settings file", () => {
  test("AC-.3 settings tree: writeTrackerConfig writes task_tracking.status_vocabulary and no tracker-config.yaml", () => {
    const root = linearSettingsTree();
    TC.writeTrackerConfig(join(root, "specs"), clone(STATUS_VOCAB) as Any);
    expect(existsSync(join(root, "specs", "tracker-config.yaml"))).toBe(false);
    expect(load(root).source).toBe("settings");
    expect(load(root).settings.task_tracking.status_vocabulary).toEqual(STATUS_VOCAB);
    expect(movedHeadingsOutsideStub(read(root, "CLAUDE.md"))).toEqual([]);
    expectStubInStep(root);
  });

  test("AC-.3 settings tree: writeTrackerSubsection writes task_tracking.linear, not `### Linear`", () => {
    const root = linearSettingsTree();
    // Orchestrator amendment: keep the bound team (SYN). Writing another team without
    // `repoint: true` is refused by the STE-645 team guard on every tree, by design.
    TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "linear", { project: "Synthetic Project", team: "SYN" });
    expect(load(root).source).toBe("settings");
    expect(load(root).settings.task_tracking.linear).toEqual({ team: "SYN", project: "Synthetic Project" });
    expect(movedHeadingsOutsideStub(read(root, "CLAUDE.md"))).toEqual([]);
    expectStubInStep(root);
  });

  test("AC-.3 settings tree: reseedBranchTemplate rewrites task_tracking.branch_template", () => {
    const yaml = LINEAR_SETTINGS.replace("  mcp_server: linear\n", "  mcp_server: linear\n  branch_template: \"{type}/{ticket-id}-{slug}\"\n");
    const root = tree({ "CLAUDE.md": settingsClaudeMd(LINEAR_STUB), [SETTINGS]: yaml });
    expect(load(root).settings.task_tracking.branch_template).toBe("{type}/{ticket-id}-{slug}");
    const r = RESEED.reseedBranchTemplate(join(root, "CLAUDE.md"), { date: "2026-11-05" });
    expect(r.reseeded).toBe(true);
    expect(load(root).settings.task_tracking.branch_template).toBe("{type}/m{N}-{slug}");
    const md = read(root, "CLAUDE.md");
    expect(md).not.toMatch(/^branch_template:/m);
    expect(movedHeadingsOutsideStub(md)).toEqual([]);
    expectStubInStep(root);
  });

  test("AC-.3 settings tree: videoInit writes video.config and video.style, and no .dpt/video files", () => {
    const root = linearSettingsTree();
    VIDEO.videoInit(root, "google", "web", "none");
    expect(existsSync(join(root, LEGACY.VIDEO_CONFIG))).toBe(false);
    expect(existsSync(join(root, LEGACY.VIDEO_STYLE))).toBe(false);
    const s = load(root).settings;
    expect(s.video.config).toEqual(parseVideoConfig(VIDEO.renderVideoConfig("google", "web", "none")));
    expect(s.video.style).toEqual(parseVideoStyle(VIDEO.renderVideoStyle()));
  });

  test("AC-.3 settings tree: a second videoInit refuses because video.config already exists, writing nothing", () => {
    const root = linearSettingsTree();
    VIDEO.videoInit(root, "google", "web", "none");
    const before = snapshot(root);
    nfr10(thrown(() => VIDEO.videoInit(root, "elevenlabs", "web", "none")));
    expect(snapshot(root)).toEqual(before);
  });

  test("AC-.3 renderVerificationSection moves to the legacy module and keeps its v2.101.4 bytes", () => {
    expect(typeof L.renderVerificationSection).toBe("function");
    const cfg = { verifySkill: "smoke-test", verifyMode: "manual", runCmd: "none", e2eCmd: null };
    expect(L.renderVerificationSection(cfg)).toBe("## Verification\n\nverify_skill: smoke-test\nverify_mode: manual\nrun_cmd: none\n");
    const src = readFileSync(join(PLUGIN, "adapters", "_shared", "src", "verification_config.ts"), "utf8");
    expect(src).not.toMatch(/^export function renderVerificationSection\b/m);
  });

  test("AC-.3 a fresh /setup on an empty tree writes every step's key to the settings file and no moved heading", () => {
    const root = tree({});
    modelFreshSetup(root, "linear");
    const { source, settings } = load(root);
    expect(source).toBe("settings");
    expect(settings.task_tracking.mode).toBe("linear");
    expect(settings.task_tracking.branch_template).toBe("{type}/m{N}-{slug}");
    expect(settings.task_tracking.linear).toEqual({ team: "SYN", project: "Synthetic Project" });
    expect(settings.task_tracking.status_vocabulary).toEqual(STATUS_VOCAB);
    expect(settings.docs).toEqual({ user_facing_mode: false, packages_mode: false, changelog_ci_owned: false });
    expect(settings.release.files).toEqual(RELEASE_FILES);
    expect(settings.tracking.token_stats).toEqual({ enabled: false });
    expect(settings.verification).toEqual({ verify_skill: "smoke-test" });
    expect(existsSync(join(root, "specs", "tracker-config.yaml"))).toBe(false);
    expect(movedHeadingsOutsideStub(read(root, "CLAUDE.md"))).toEqual([]);
    expectStubInStep(root);
  });

  test("AC-.3 legacy tree: writeTrackerConfig and writeTrackerSubsection write the legacy homes, no settings file", () => {
    const md = "# Synthetic Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\n\n## Key Commands\n\nbun test\n";
    const root = tree({ "CLAUDE.md": md, "specs/.keep": "" });
    TC.writeTrackerConfig(join(root, "specs"), clone(STATUS_VOCAB) as Any);
    TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "linear", { project: "Synthetic Project", team: "SYN" });
    expect(existsSync(join(root, SETTINGS))).toBe(false);
    expect(read(root, "specs/tracker-config.yaml")).toBe(TRACKER_CONFIG_V2101);
    expect(read(root, "CLAUDE.md")).toContain("### Linear\nteam: SYN\nproject: Synthetic Project\n");
    expect(load(root).source).toBe("legacy");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.4 — shared declaration on a settings-file tree
// ---------------------------------------------------------------------------

describe("AC-STE-710.4 shared declaration through writeTrackerSubsection on a settings-file tree", () => {
  const JIRA_TT = { mode: "jira", mcp_server: "atlassian", jira: { project: "SYN" } };
  const JIRA_SETTINGS = [
    "schema_version: 1",
    `min_dpt_version: "${FLOOR}"`,
    "task_tracking:",
    "  mode: jira",
    "  mcp_server: atlassian",
    "  jira:",
    "    project: SYN",
    "",
  ].join("\n");

  test("AC-.4 repo_tag and min_dpt_version land in the settings file, the stop paragraph in `## Project Settings`, probe #25 zero", async () => {
    const root = tree({
      "CLAUDE.md": settingsClaudeMd(PS.renderTrackingStub({ task_tracking: JIRA_TT })),
      [SETTINGS]: JIRA_SETTINGS,
    });
    TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "jira", { project: "SYN", shared: { repoTag: "syn-be" } });
    const jira = load(root).settings.task_tracking.jira;
    expect(jira.repo_tag).toBe("syn-be");
    expect(jira.min_dpt_version).toBe(runningDptVersion());
    const md = read(root, "CLAUDE.md");
    const section = PS.projectSettingsSection(md);
    expect(section).not.toBeNull();
    const stop = TB.renderSharedTrackerSentinel({ adapter: "jira", project: "SYN", repoTag: "syn-be", minDptVersion: runningDptVersion() });
    expect(section!.lines.join("\n")).toContain(stop);
    expect(md.split(stop).length - 1).toBe(1);
    expect(movedHeadingsOutsideStub(md)).toEqual([]);
    expectStubInStep(root);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.5 — repoint --verify on a settings-file tree
// ---------------------------------------------------------------------------

describe("AC-STE-710.5 repoint --verify hashes task_tracking.status_vocabulary on a settings-file tree", () => {
  const SESSION = "ste710-synthetic-session-0001";
  const OLD_SETTINGS = [
    "schema_version: 1",
    `min_dpt_version: "${FLOOR}"`,
    "task_tracking:",
    "  mode: linear",
    "  mcp_server: linear",
    "  linear:",
    "    team: SYN",
    "    project: Old Synthetic",
    "  status_vocabulary:",
    "    tracker_key: linear",
    "    statuses:",
    "      - Todo",
    "      - In Progress",
    "      - In Review",
    "      - Done",
    "    roles:",
    "      initial: Todo",
    "      in_progress: In Progress",
    "      in_review: In Review",
    "      done: Done",
    "",
  ].join("\n");

  function withSession<T>(fn: () => T): T {
    const prev = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = SESSION;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = prev;
    }
  }

  function verifyCli(root: string): { code: number; stdout: string } {
    const r = Bun.spawnSync([process.execPath, "run", REPOINT_PATH, root, "--verify"], {
      cwd: PLUGIN,
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: SESSION } as Record<string, string>,
    });
    return { code: r.exitCode ?? -1, stdout: r.stdout.toString() };
  }

  function repointed(): string {
    const stub = PS.renderTrackingStub({ task_tracking: { mode: "linear", mcp_server: "linear", linear: { team: "SYN", project: "Old Synthetic" } } });
    const root = tree({ "CLAUDE.md": settingsClaudeMd(stub), [SETTINGS]: OLD_SETTINGS });
    withSession(() =>
      REPOINT.writeRepoint({ projectRoot: root, mode: "linear", newProject: "New Synthetic", peers: [] }, "Old Synthetic", [
        { row: 4, verdict: "PASS", reason: "synthetic", statusSnapshot: [...STATUS_VOCAB.statuses] },
      ]),
    );
    return root;
  }

  test("AC-.5 an unchanged status vocabulary reports `verify UNCHANGED`", () => {
    const root = repointed();
    expect(load(root).settings.task_tracking.linear.project).toBe("New Synthetic");
    expect(existsSync(join(root, "specs", "tracker-config.yaml"))).toBe(false);
    expect(withSession(() => REPOINT.verifyRepoint(root))).toEqual({ dropped: [], unchanged: true });
    const v = verifyCli(root);
    expect(v.code).toBe(0);
    expect(v.stdout.split("\n").some((l) => l.startsWith("verify UNCHANGED"))).toBe(true);
  });

  test("AC-.5 a changed status vocabulary that drops a status reports the change", () => {
    const root = repointed();
    write(root, {
      task_tracking: {
        status_vocabulary: {
          tracker_key: "linear",
          statuses: ["Todo", "In Progress", "Review", "Done"],
          roles: { initial: "Todo", in_progress: "In Progress", in_review: "Review", done: "Done" },
        },
      },
    });
    expect(withSession(() => REPOINT.verifyRepoint(root))).toEqual({ dropped: ["In Review"], unchanged: false });
    const v = verifyCli(root);
    expect(v.code).toBe(1);
    expect(v.stdout).toMatch(/^verify FAIL .*In Review/m);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.6 / .7 — the slim template
// ---------------------------------------------------------------------------

/** The v2.101.4 `Layout:` bullet under `## Testing Conventions`, byte for byte. */
const LAYOUT_BULLET_V2101 =
  "- **Layout:** src/-co-located <!-- toolkit default; each `src/foo.ts` has a sibling `src/foo.test.ts`. Override to `tests/-mirror` if needed; `/gate-check` reads this line. -->";

describe("AC-STE-710.6 the slim CLAUDE.md template", () => {
  const template = (): string => readFileSync(TEMPLATE_PATH, "utf8");

  for (const gone of ["## Task Tracking", "## Verification", "## Docs", "## Orchestration", "## Token Stats", "## Release Files", "milestone_scan_fetch"]) {
    test(`AC-.6 the template carries no \`${gone}\`, live or inside a comment`, () => {
      expect(template().includes(gone)).toBe(false);
    });
  }

  for (const kept of ["## Project Settings", "## Key Commands", "## Testing Conventions", SETUP_MARKER, "**Gating rule:**"]) {
    test(`AC-.6 the template keeps \`${kept}\``, () => {
      expect(template()).toContain(kept);
    });
  }

  test("AC-.6 the `Layout:` bullet under `## Testing Conventions` is byte-equal to the v2.101.4 line", () => {
    const t = template();
    const start = t.indexOf("## Testing Conventions");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = t.slice(start + 2).search(/^## /m);
    const section = next < 0 ? t.slice(start) : t.slice(start, start + 2 + next);
    expect(section.split("\n")).toContain(LAYOUT_BULLET_V2101);
  });

  test("AC-.6 detectLayout on the template returns co-location (a tests/ file is a layout violation, a sibling is not)", async () => {
    const mirror = tree({ "CLAUDE.md": template(), "bun.lock": "", "src/foo.ts": "export {};\n", "tests/foo.test.ts": "export {};\n" });
    const r = await runBunZeroMatchPlaceholderProbe(mirror);
    expect(r.violations.some((v) => v.reason.includes("src/-co-located"))).toBe(true);
    const sibling = tree({ "CLAUDE.md": template(), "bun.lock": "", "src/foo.ts": "export {};\n", "src/foo.test.ts": "export {};\n" });
    expect((await runBunZeroMatchPlaceholderProbe(sibling)).violations).toEqual([]);
  });

  test("AC-.6 the template carries no binding stub", () => {
    expect(template()).not.toContain(LEGACY.TRACKING_STUB_MARKER);
  });
});

describe("AC-STE-710.7 the template's pointer is renderSettingsPointer(\"3.0.0\"), byte for byte", () => {
  test("AC-.7 the pointer paragraph sits inside `## Project Settings`", () => {
    const t = readFileSync(TEMPLATE_PATH, "utf8");
    const pointer = PS.renderSettingsPointer("3.0.0");
    const section = PS.projectSettingsSection(t);
    expect(section).not.toBeNull();
    expect(`${section!.lines.join("\n")}\n`).toContain(pointer);
  });

  test("AC-.7 the pointer names the settings file, the 3.0.0 floor, and tells an older or unknown plugin to stop and ask for an upgrade", () => {
    const pointer = PS.renderSettingsPointer("3.0.0");
    expect(pointer).toContain("specs/settings.yaml");
    expect(pointer).toContain("3.0.0");
    expect(pointer).toMatch(/older/i);
    expect(pointer).toMatch(/unknown|cannot tell/i);
    expect(pointer).toMatch(/stop/i);
    expect(pointer).toMatch(/upgrade/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.8 — the writer scan
// ---------------------------------------------------------------------------

const SCAN_HEADINGS = ["## Task Tracking", "## Verification", "## Docs", "## Orchestration", "## Token Stats", "## Release Files", "### Linear", "### Jira"];
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HEADING_ALT = SCAN_HEADINGS.map(escRe).join("|");
/** The verbs that tell a reader to put something somewhere. */
const WRITE_VERB_RE =
  /\b(?:write|writes|writing|wrote|written|emit|emits|emitting|emitted|add|adds|adding|added|splice|splices|splicing|spliced|paste|pastes|pasting|pasted|insert|inserts|inserting|inserted|append|appends|appending|appended)\b/gi;
/** `into / in / to / under / as / the / a` + the heading: the verb's destination. */
const INTO_HEADING_RE = new RegExp(
  `\\b(?:into|in|to|under|as|the|a|an)\\s+(?:(?:the|a|an|CLAUDE\\.md's|CLAUDE\\.md|project's)\\s+)*\\**\`?(?:${HEADING_ALT})(?![A-Za-z])`,
  "i",
);
/** The verb immediately followed by the heading (`add \`## Task Tracking\``). */
const DIRECT_HEADING_RE = new RegExp(`^[A-Za-z-]+\\**\\s+\\**\`?(?:${HEADING_ALT})(?![A-Za-z])`);
/** A unit naming the writer, the `set` verb, or the word legacy is exempt. */
const EXEMPT_RE = /writeProjectSettings|project_settings\.ts`?\s+set\b|`set` verb|\bset verb\b|\blegacy\b/i;

interface ScanHit {
  file: string;
  line: number;
  text: string;
}

/** Paragraphs and list items, each joined across its wrapped lines; fenced code is skipped. */
function scanUnits(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = text.split("\n");
  let cur: string[] = [];
  let start = 0;
  let fence = false;
  const flush = (): void => {
    if (cur.length > 0) out.push({ line: start + 1, text: cur.join(" ") });
    cur = [];
  };
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, "");
    if (/^\s*(?:```|~~~)/.test(l)) {
      flush();
      fence = !fence;
      return;
    }
    if (fence) return;
    if (l.trim() === "") {
      flush();
      return;
    }
    const opensItem = /^\s*(?:[-*+]|\d+[.)])\s/.test(l);
    const standalone = /^\s*#{1,6}\s/.test(l) || /^\s*\|/.test(l);
    if (opensItem || standalone) {
      flush();
      start = i;
      cur.push(l.trim());
      if (standalone) flush();
      return;
    }
    if (cur.length === 0) start = i;
    cur.push(l.trim());
  });
  flush();
  return out;
}

function unitOffends(unit: string): boolean {
  if (EXEMPT_RE.test(unit)) return false;
  for (const m of unit.matchAll(WRITE_VERB_RE)) {
    const rest = unit.slice(m.index!);
    const end = rest.search(/[.!?;](?:\s|$)/);
    const clause = (end < 0 ? rest : rest.slice(0, end)).slice(0, 240);
    if (INTO_HEADING_RE.test(clause) || DIRECT_HEADING_RE.test(clause)) return true;
  }
  return false;
}

/** Scan `<base>/skills/*\/SKILL.md` and `<base>/docs/*.md`. */
function writerScan(base: string): ScanHit[] {
  const files: string[] = [];
  const skills = join(base, "skills");
  if (existsSync(skills)) {
    for (const d of readdirSync(skills).sort()) {
      const p = join(skills, d, "SKILL.md");
      if (existsSync(p)) files.push(p);
    }
  }
  const docs = join(base, "docs");
  if (existsSync(docs)) for (const f of readdirSync(docs).sort()) if (f.endsWith(".md")) files.push(join(docs, f));
  const hits: ScanHit[] = [];
  for (const f of files) {
    for (const u of scanUnits(readFileSync(f, "utf8"))) {
      if (unitOffends(u.text)) hits.push({ file: relative(base, f), line: u.line, text: u.text.slice(0, 160) });
    }
  }
  return hits;
}

describe("AC-STE-710.8 the writer scan", () => {
  test("AC-.8 no paragraph or list item tells the reader to write into a moved heading without naming the writer, the set verb or legacy", () => {
    expect(writerScan(PLUGIN).map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });

  test("AC-.8 the scan sees both roots it names", () => {
    expect(existsSync(join(PLUGIN, "skills", "setup", "SKILL.md"))).toBe(true);
    expect(readdirSync(join(PLUGIN, "docs")).some((f) => f.endsWith(".md"))).toBe(true);
  });

  const PLANTED_ONE = "Write the resolved flags into the `## Docs` section of CLAUDE.md.";
  const PLANTED_TWO = "Write the resolved flags into the\n`## Docs` section of CLAUDE.md.";

  function planted(body: string, where: "skill" | "doc"): string {
    const files = where === "skill" ? { "skills/planted/SKILL.md": `# Planted\n\n${body}\n` } : { "docs/planted.md": `# Planted\n\n${body}\n` };
    return tree(files);
  }

  test("AC-.8 control: a planted one-line instruction turns the scan red", () => {
    expect(writerScan(planted(PLANTED_ONE, "skill"))).toHaveLength(1);
    expect(writerScan(planted(`- ${PLANTED_ONE}`, "doc"))).toHaveLength(1);
  });

  test("AC-.8 control: the same instruction wrapped across two lines turns the scan red", () => {
    expect(writerScan(planted(PLANTED_TWO, "skill"))).toHaveLength(1);
    expect(writerScan(planted(`1. ${PLANTED_TWO.replace("\n", "\n   ")}`, "doc"))).toHaveLength(1);
  });

  test("AC-.8 control: adding the word legacy to the planted unit turns the scan green", () => {
    expect(writerScan(planted(`${PLANTED_TWO} On a legacy tree only.`, "skill"))).toEqual([]);
  });

  test("AC-.8 control: naming writeProjectSettings or the set verb also exempts the unit", () => {
    expect(writerScan(planted(`${PLANTED_ONE} Use \`writeProjectSettings\` on a settings-file tree.`, "skill"))).toEqual([]);
  });

  test("AC-.8 control: a read that names a moved heading is not a hit", () => {
    expect(writerScan(planted("The probe reads the `## Docs` section of CLAUDE.md.", "doc"))).toEqual([]);
  });

  const STEP_KEYS: [string, string][] = [
    ["0b", "task_tracking.mode"],
    ["7b", "task_tracking"],
    ["7c", "task_tracking.branch_template"],
    ["7d", "docs"],
    ["7e", "release.files"],
    ["7f", "task_tracking.status_vocabulary"],
    ["7g", "tracking.token_stats"],
    ["8c", "verification.verify_skill"],
  ];

  function setupStep(id: string): string {
    const lines = readFileSync(join(PLUGIN, "skills", "setup", "SKILL.md"), "utf8").split("\n");
    const start = lines.findIndex((l) => l.startsWith(`### ${id}. `));
    expect(start).toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{2,3} /.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  }

  for (const [step, key] of STEP_KEYS) {
    test(`AC-.8 setup step ${step} names writeProjectSettings and its key path \`${key}\``, () => {
      const body = setupStep(step);
      expect(body).toContain("writeProjectSettings");
      expect(body).toContain(key);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-710.10 — the STE-707 temporary allowlist is empty
// ---------------------------------------------------------------------------

describe("AC-STE-710.10 the one-reader scan's temporary allowlist is empty", () => {
  test("AC-.10 TEMPORARY in the STE-707 scan holds no entry", () => {
    const src = readFileSync(join(PLUGIN, "tests", "m_94e6f7-ste-707-one-settings-reader.test.ts"), "utf8");
    const m = /const TEMPORARY[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    expect(m).not.toBeNull();
    const entries = m![1]!.split("\n").filter((l) => /^\s*["'][^"']+["']\s*:/.test(l));
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.11 — NFR-1 cap
// ---------------------------------------------------------------------------

describe("AC-STE-710.11 skills/setup/SKILL.md stays within the NFR-1 cap", () => {
  test("AC-.11 SKILL_LINE_CAP is still 358 and setup's SKILL.md is within it", () => {
    const capSrc = readFileSync(join(PLUGIN, "tests", "skill-nfr-1-length.test.ts"), "utf8");
    expect(/const SKILL_LINE_CAP = (\d+);/.exec(capSrc)?.[1]).toBe("358");
    const lines = readFileSync(join(PLUGIN, "skills", "setup", "SKILL.md"), "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(358);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.12 — the stub follows the settings
// ---------------------------------------------------------------------------

describe("AC-STE-710.12 the stub follows the settings", () => {
  test("AC-.12 a write that changes the Linear team re-renders the stub", () => {
    const root = linearSettingsTree();
    const before = read(root, "CLAUDE.md");
    write(root, { task_tracking: { linear: { team: "SYX" } } });
    const after = read(root, "CLAUDE.md");
    expect(after).not.toBe(before);
    expect(after).toContain("team: SYX");
    expect(after).not.toContain("team: SYN");
    expectStubInStep(root);
    // No other CLAUDE.md byte changes: only the stub's own `team:` line differs.
    expect(after.replace("team: SYX", "team: SYN")).toBe(before);
  });

  test("AC-.12 a write to mode: none removes the stub slot", () => {
    const root = linearSettingsTree();
    write(root, { task_tracking: { mode: "none", mcp_server: undefined, linear: undefined } });
    const md = read(root, "CLAUDE.md");
    expect(LEGACY.trackingStubSlots(md)).toEqual([]);
    expect(md).not.toContain(LEGACY.TRACKING_STUB_MARKER);
    expect(isSubsequence(md.split("\n"), settingsClaudeMd(LINEAR_STUB).split("\n"))).toBe(true);
  });

  test("AC-.12 a write that turns a tracker mode on inserts a stub slot equal to its render", () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd(), [SETTINGS]: MINIMAL_SETTINGS });
    const before = read(root, "CLAUDE.md");
    write(root, { task_tracking: LINEAR_TT });
    const after = read(root, "CLAUDE.md");
    expectStubInStep(root);
    expect(isSubsequence(before.split("\n"), after.split("\n"))).toBe(true);
  });

  test("AC-.12 a write to docs leaves CLAUDE.md byte-identical", () => {
    const root = linearSettingsTree();
    const before = read(root, "CLAUDE.md");
    write(root, { docs: { user_facing_mode: true } });
    expect(load(root).settings.docs.user_facing_mode).toBe(true);
    expect(read(root, "CLAUDE.md")).toBe(before);
  });

  test("AC-.12 a fresh /setup in Linear mode, modelled on an empty tree, leaves a stub byte-equal to its render and probe #25 zero", async () => {
    const root = tree({});
    modelFreshSetup(root, "linear");
    expectStubInStep(root);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.15 — non-setup writers on an unmanaged tree
// ---------------------------------------------------------------------------

const VIDEO_CONFIG_V2101 = "tts:\n  provider: google\n  voice: en-US-Neural2-D\nrecorder:\n  kind: web\nmusic:\n  source: none\n";
const TRACKER_CONFIG_V2101 =
  "tracker_key: linear\nstatuses:\n  - Todo\n  - In Progress\n  - In Review\n  - Done\nroles:\n  initial: Todo\n  in_progress: In Progress\n  in_review: In Review\n  done: Done\n";
const RESEED_IN = "# Synthetic Project\n\nbranch_template: {type}/{ticket-id}-{slug}\n";
const RESEED_OUT_V2101 =
  '# Synthetic Project\n\nbranch_template: {type}/m{N}-{slug}\n\n## /setup audit\n\n- 2026-11-05 step:7c (branch_template) value:"{type}/m{N}-{slug}" reason:"--migrate re-seed of retired seeded default" imputed:true\n';

describe("AC-STE-710.15 non-setup writers on an unmanaged tree write their v2.101.4 homes", () => {
  test("AC-.15 none tree: videoInit writes .dpt/video and no settings file", () => {
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n\nSome prose.\n" });
    expect(PS.detectSettingsSource(root)).toBe("none");
    const managedBefore = isToolkitManaged(root);
    VIDEO.videoInit(root, "google", "web", "none");
    expect(read(root, LEGACY.VIDEO_CONFIG)).toBe(VIDEO_CONFIG_V2101);
    expect(read(root, LEGACY.VIDEO_STYLE)).toBe(VIDEO.renderVideoStyle());
    expect(existsSync(join(root, SETTINGS))).toBe(false);
    expect(isToolkitManaged(root)).toBe(managedBefore);
  });

  test("AC-.15 none tree: reseedBranchTemplate rewrites CLAUDE.md byte for byte, no settings file", () => {
    const root = tree({ "CLAUDE.md": RESEED_IN });
    expect(PS.detectSettingsSource(root)).toBe("none");
    RESEED.reseedBranchTemplate(join(root, "CLAUDE.md"), { date: "2026-11-05" });
    expect(read(root, "CLAUDE.md")).toBe(RESEED_OUT_V2101);
    expect(existsSync(join(root, SETTINGS))).toBe(false);
  });

  test("AC-.15 none tree: writeTrackerSubsection outside /setup refuses as v2.101.4 does, no settings file", () => {
    const md = "# Synthetic Project\n\nSome prose.\n";
    const root = tree({ "CLAUDE.md": md });
    expect(() => TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "linear", { project: "Synthetic Project", team: "SYN" })).toThrow(
      TB.TrackerBindingWriteError,
    );
    expect(read(root, "CLAUDE.md")).toBe(md);
    expect(existsSync(join(root, SETTINGS))).toBe(false);
  });

  test("AC-.15 none tree: writeTrackerConfig writes specs/tracker-config.yaml and no settings file", () => {
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n", "specs/.keep": "" });
    expect(PS.detectSettingsSource(root)).toBe("none");
    TC.writeTrackerConfig(join(root, "specs"), clone(STATUS_VOCAB) as Any);
    expect(read(root, "specs/tracker-config.yaml")).toBe(TRACKER_CONFIG_V2101);
    expect(existsSync(join(root, SETTINGS))).toBe(false);
  });

  test("AC-.15 none tree: writeProjectSettings without { create: true } refuses and creates nothing", () => {
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n" });
    const before = snapshot(root);
    nfr10(thrown(() => write(root, { docs: { user_facing_mode: true } })));
    expect(snapshot(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.16 — a fresh /setup writes no new key
// ---------------------------------------------------------------------------

describe("AC-STE-710.16 a fresh /setup writes only the keys its v2.101.4 steps wrote", () => {
  const V2101_KEYS = [
    "schema_version",
    "min_dpt_version",
    "task_tracking.mode",
    "task_tracking.mcp_server",
    "task_tracking.jira_ac_field",
    "task_tracking.branch_template",
    "task_tracking.linear.team",
    "task_tracking.linear.project",
    "task_tracking.status_vocabulary.tracker_key",
    "task_tracking.status_vocabulary.statuses",
    "task_tracking.status_vocabulary.roles.initial",
    "task_tracking.status_vocabulary.roles.in_progress",
    "task_tracking.status_vocabulary.roles.in_review",
    "task_tracking.status_vocabulary.roles.done",
    "docs.user_facing_mode",
    "docs.packages_mode",
    "docs.changelog_ci_owned",
    "release.files",
    "tracking.token_stats.enabled",
    "verification.verify_skill",
  ];

  for (const mode of ["linear", "none"] as const) {
    test(`AC-.16 ${mode}: the settings file's keys are a subset of the v2.101.4 keys, and no NEW_KEYS key is written`, () => {
      const root = tree({});
      modelFreshSetup(root, mode);
      const parsed = Bun.YAML.parse(read(root, SETTINGS)) as Record<string, unknown>;
      const paths = leafPaths(parsed);
      expect(paths.filter((p) => !V2101_KEYS.includes(p))).toEqual([]);
      for (const k of PS.NEW_KEYS) expect(paths.some((p) => p === k || p.startsWith(`${k}.`))).toBe(false);
      expect(paths).toContain("schema_version");
      expect(paths).toContain("min_dpt_version");
      if (mode === "none") expect(paths.some((p) => p.startsWith("task_tracking"))).toBe(false);
    });
  }

  // Review T2: the rows above grade a test-local model of /setup. These grade
  // the shipped /setup surfaces themselves, so a step edited to write a `new`
  // key turns them red.
  const SETUP_PROSE = ["skills/setup/SKILL.md", "skills/setup-template/SKILL.md", "docs/setup-reference.md"];
  const SECTIONS = ["task_tracking", "verification", "docs", "orchestration", "tracking", "close_out", "release", "video"];
  const settingsPathsIn = (line: string): string[] =>
    [...line.matchAll(/`([a-z_]+(?:\.[a-z_]+)*)(?::[^`]*)?`/g)].map((m) => m[1]!).filter((p) => SECTIONS.includes(p.split(".")[0]!));

  test("AC-.16 every settings key path a /setup step writes through writeProjectSettings is a v2.101.4 key (or its section)", () => {
    const written: string[] = [];
    for (const rel of SETUP_PROSE) {
      for (const line of read(PLUGIN, rel).split("\n")) if (line.includes("writeProjectSettings")) written.push(...settingsPathsIn(line));
    }
    expect(written.length).toBeGreaterThan(5);
    const unknown = [...new Set(written)].filter((p) => !V2101_KEYS.some((k) => k === p || k.startsWith(`${p}.`)));
    expect(unknown).toEqual([]);
  });

  test("AC-.16 no /setup surface (prose or setup code) names a NEW_KEYS key", () => {
    const setupCode = readdirSync(join(PLUGIN, "adapters", "_shared", "src", "setup"))
      .filter((n) => n.endsWith(".ts"))
      .map((n) => `adapters/_shared/src/setup/${n}`);
    const hits: string[] = [];
    for (const rel of [...SETUP_PROSE, ...setupCode]) {
      const body = read(PLUGIN, rel);
      for (const k of PS.NEW_KEYS) {
        const leaf = k.split(".").pop()!;
        if (body.includes(k) || new RegExp(`\\b${leaf}\\b`).test(body)) hits.push(`${rel}: ${k}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.20 — the set verb and the adopt paths
// ---------------------------------------------------------------------------

describe("AC-STE-710.20 the set verb", () => {
  test("AC-.20 SETTABLE_KEYS is closed to verification.verify_skill", () => {
    expect(P.SETTABLE_KEYS).toEqual(["verification.verify_skill"]);
  });

  test("AC-.20 settings tree: set writes verification.verify_skill and leaves CLAUDE.md byte-identical", () => {
    const root = linearSettingsTree();
    const md = read(root, "CLAUDE.md");
    const r = frontDoor(["set", "verification.verify_skill", "x", root]);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")).toContain("source: settings");
    expect(read(root, "CLAUDE.md")).toBe(md);
    expect(load(root).settings.verification).toEqual({ verify_skill: "x" });
    expect(frontDoor(["mode", root]).code).toBe(0);
  });

  test("AC-.20 legacy tree: set writes nothing and prints source: legacy", () => {
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n\n## Verification\n\nverify_skill: old-check\n" });
    const before = snapshot(root);
    const r = frontDoor(["set", "verification.verify_skill", "x", root]);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")).toContain("source: legacy");
    expect(snapshot(root)).toEqual(before);
  });

  test("AC-.20 empty tree: set writes nothing and prints source: none", () => {
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n" });
    const before = snapshot(root);
    const r = frontDoor(["set", "verification.verify_skill", "x", root]);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")).toContain("source: none");
    expect(snapshot(root)).toEqual(before);
  });

  for (const key of ["close_out.upgrade_offer.enabled", "tracking.token_stats.enabled", "verification.verify_mode"]) {
    test(`AC-.20 a key outside SETTABLE_KEYS refuses and writes nothing (${key})`, () => {
      const root = linearSettingsTree();
      const before = snapshot(root);
      const r = frontDoor(["set", key, "true", root]);
      expect(r.code).not.toBe(0);
      expect(r.stdout).toBe("");
      nfr10(r.stderr);
      expect(snapshot(root)).toEqual(before);
    });
  }

  test("AC-.20 a both-homes tree exits non-zero with the NFR-10 message on stderr and nothing on stdout", () => {
    const root = tree({
      "CLAUDE.md": `${settingsClaudeMd(LINEAR_STUB)}\n## Docs\n\nuser_facing_mode: false\n`,
      [SETTINGS]: LINEAR_SETTINGS,
    });
    expect(PS.detectSettingsSource(root)).toBe("both");
    const before = snapshot(root);
    const r = frontDoor(["set", "verification.verify_skill", "x", root]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
    nfr10(r.stderr);
    expect(snapshot(root)).toEqual(before);
  });

  const IMPLEMENT = join(PLUGIN, "skills", "implement", "SKILL.md");
  const VERB_RE = /\bset verification\.verify_skill\b/;
  const IMPLEMENT_LINES: [number, string][] = [
    [230, "2. **Discover (fallback)**"],
    [231, "3. **Ambiguous**"],
    [232, "4. **None**"],
    [244, "**Capability tokens"],
  ];

  for (const [n, anchor] of IMPLEMENT_LINES) {
    test(`AC-.20 skills/implement/SKILL.md line ${n} names the set verb, its legacy branch and the \`## Project Settings\` condition`, () => {
      const line = readFileSync(IMPLEMENT, "utf8").split("\n")[n - 1]!;
      expect(line.startsWith(anchor)).toBe(true);
      expect(line).toMatch(VERB_RE);
      expect(line).toMatch(/\blegacy\b/i);
      expect(line).toContain("## Project Settings");
    });
  }

  test("AC-.20 skills/implement/SKILL.md keeps its line count (357)", () => {
    expect(readFileSync(IMPLEMENT, "utf8").split("\n").length - 1).toBe(357);
  });

  const DOC = join(PLUGIN, "docs", "verification-skills.md");
  for (const [from, to] of [
    [119, 120],
    [121, 122],
    [236, 237],
  ] as const) {
    test(`AC-.20 docs/verification-skills.md lines ${from}-${to} name the set verb, its legacy branch and the \`## Project Settings\` condition`, () => {
      const text = readFileSync(DOC, "utf8").split("\n").slice(from - 1, to).join(" ");
      expect(text).toMatch(VERB_RE);
      expect(text).toMatch(/\blegacy\b/i);
      expect(text).toContain("## Project Settings");
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-710.21 — foreign settings file
// ---------------------------------------------------------------------------

const FOREIGN = "openapi: 3.0.0\ninfo:\n  title: Synthetic API\n  version: 1.0.0\n";

describe("AC-STE-710.21 a foreign settings file is never overwritten", () => {
  test("AC-.21 create over a foreign settings file refuses and leaves it byte-identical", () => {
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n", [SETTINGS]: FOREIGN });
    expect(PS.isForeignSettingsFile(root)).toBe(true);
    const before = snapshot(root);
    const err = thrown(() => write(root, { schema_version: 1, min_dpt_version: SETUP_FLOOR }, { create: true }));
    nfr10(err);
    expect(err.message).toContain("specs/settings.yaml");
    expect(snapshot(root)).toEqual(before);
  });

  test("AC-.21 a modelled fresh /setup on that tree writes every legacy home byte-equal to v2.101.4 and leaves the foreign file alone", () => {
    const root = tree({ [SETTINGS]: FOREIGN });
    // The create refuses; /setup then writes the legacy homes exactly as v2.101.4 does.
    expect(() => write(root, { schema_version: 1, min_dpt_version: SETUP_FLOOR }, { create: true })).toThrow();
    writeFileSync(
      join(root, "CLAUDE.md"),
      "# Synthetic Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\njira_ac_field:\nbranch_template: {type}/m{N}-{slug}\n\n## Key Commands\n\nbun test\n",
    );
    TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "linear", { project: "Synthetic Project", team: "SYN" });
    TC.writeTrackerConfig(join(root, "specs"), clone(STATUS_VOCAB) as Any);
    VIDEO.videoInit(root, "google", "web", "none");
    expect(read(root, "CLAUDE.md")).toBe(
      "# Synthetic Project\n\n## Task Tracking\n\nmode: linear\nmcp_server: linear\njira_ac_field:\nbranch_template: {type}/m{N}-{slug}\n\n### Linear\nteam: SYN\nproject: Synthetic Project\n\n\n## Key Commands\n\nbun test\n",
    );
    expect(read(root, "specs/tracker-config.yaml")).toBe(TRACKER_CONFIG_V2101);
    expect(read(root, LEGACY.VIDEO_CONFIG)).toBe(VIDEO_CONFIG_V2101);
    expect(read(root, SETTINGS)).toBe(FOREIGN);
    expect(PS.detectSettingsSource(root)).toBe("legacy");
  });

  test("AC-.21 /setup's closing report names a foreign settings file it left in place", () => {
    const skill = readFileSync(join(PLUGIN, "skills", "setup", "SKILL.md"), "utf8");
    const ref = readFileSync(join(PLUGIN, "docs", "setup-reference.md"), "utf8");
    const units = [...scanUnits(skill), ...scanUnits(ref)].map((u) => u.text);
    expect(units.some((u) => /foreign/i.test(u) && u.includes("specs/settings.yaml") && /report/i.test(u))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-710.13 — guard-specific rows (mutation battery follow-up). Each row
// feeds an input the shape validator ACCEPTS, so only the named guard can
// refuse it, and asserts that guard's own refusal text.
// ---------------------------------------------------------------------------

describe("AC-STE-710.13 guard-specific rows", () => {
  test("AC-.20 a shape-valid key outside SETTABLE_KEYS (verification.run_cmd) refuses naming the closed set and writes nothing", () => {
    const root = linearSettingsTree();
    const before = snapshot(root);
    const settingsBefore = read(root, SETTINGS);
    const r = frontDoor(["set", "verification.run_cmd", "foo", root]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
    nfr10(r.stderr);
    // The closed-key-list guard's own refusal: names the rejected key and every settable key.
    expect(r.stderr).toMatch(/^Refusing: .*verification\.run_cmd.*not a key the set verb writes/m);
    expect(P.SETTABLE_KEYS.length).toBeGreaterThan(0);
    for (const k of P.SETTABLE_KEYS as string[]) expect(r.stderr).toMatch(new RegExp(`^Remedy: .*${escRe(k)}`, "m"));
    expect(read(root, SETTINGS)).toBe(settingsBefore);
    expect(read(root, SETTINGS)).not.toContain("run_cmd");
    expect(snapshot(root)).toEqual(before);
  });

  test("AC-.21 create over a foreign file holding only toolkit-shaped keys (no schema_version, no min_dpt_version) refuses as foreign, byte-identical", () => {
    const foreign = "docs:\n  user_facing_mode: false\n";
    const root = tree({ "CLAUDE.md": "# Synthetic Project\n", [SETTINGS]: foreign });
    expect(PS.isForeignSettingsFile(root)).toBe(true);
    const before = snapshot(root);
    const err = thrown(() => write(root, { schema_version: 1, min_dpt_version: SETUP_FLOOR }, { create: true }));
    nfr10(err);
    expect(err.message).toMatch(/^Refusing: .*specs\/settings\.yaml.*not a toolkit settings file/m);
    expect(err.message).toMatch(/foreign/i);
    expect(read(root, SETTINGS)).toBe(foreign);
    expect(snapshot(root)).toEqual(before);
  });

  test("AC-.12 a create in Linear mode on a `## Project Settings` CLAUDE.md with no stub leaves a stub slot byte-equal to renderTrackingStub", () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd() });
    expect(existsSync(join(root, SETTINGS))).toBe(false);
    expect(LEGACY.trackingStubSlots(read(root, "CLAUDE.md"))).toEqual([]);
    const before = read(root, "CLAUDE.md");
    write(root, { schema_version: 1, min_dpt_version: FLOOR, task_tracking: clone(LINEAR_TT) }, { create: true });
    const render = PS.renderTrackingStub(load(root).settings);
    expect(render).not.toBe("");
    const after = read(root, "CLAUDE.md");
    const slots = LEGACY.trackingStubSlots(after);
    expect(slots).toHaveLength(1);
    expect(`${slots[0]!.text}\n`).toBe(render);
    expect(isSubsequence(before.split("\n"), after.split("\n"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audit follow-up rows (AC-STE-710.3 / .12 / .16 and the Requirement prose).
// ---------------------------------------------------------------------------

const SETUP_SKILL_PATH = join(PLUGIN, "skills", "setup", "SKILL.md");
const SETUP_REF_PATH = join(PLUGIN, "docs", "setup-reference.md");

/** A `### <id>. ` step body of `text` (heading through the next `##`/`###` heading). */
function stepBody(text: string, id: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`### ${id}. `));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Sentences of a unit (split on `. ` / `! ` / `? ` / `; `), so a token in one sentence never vouches for another. */
function sentences(unit: string): string[] {
  return unit.split(/(?<=[.!?;])\s+/).filter((s) => s.trim() !== "");
}

const CREATE_RE = /create:\s*true/;

function createStepComplete(unit: string): boolean {
  return (
    unit.includes("writeProjectSettings") &&
    CREATE_RE.test(unit) &&
    unit.includes("schema_version") &&
    unit.includes("min_dpt_version") &&
    /\bnone\b/.test(unit) &&
    /foreign/i.test(unit) &&
    /legacy/i.test(unit)
  );
}

describe("AC-STE-710.3/.16 only /setup creates the settings file, before step 7b", () => {
  test("AC-.16 skills/setup/SKILL.md runs writeProjectSettings({ create: true }) on a `none` source before step 7b, with the foreign-file fallback", () => {
    const skill = readFileSync(SETUP_SKILL_PATH, "utf8");
    const lines = skill.split("\n");
    const at7b = lines.findIndex((l) => l.startsWith("### 7b. "));
    expect(at7b).toBeGreaterThan(0);
    const before7b = lines.slice(0, at7b).join("\n");
    // A unit before 7b that runs the create (directly, or as a pointer line naming the reference doc).
    const createUnits = scanUnits(before7b).filter((u) => u.text.includes("writeProjectSettings") && CREATE_RE.test(u.text));
    expect(createUnits.length).toBeGreaterThan(0);
    const inline = createUnits.some((u) => createStepComplete(u.text));
    const ref = readFileSync(SETUP_REF_PATH, "utf8");
    const pointed =
      createUnits.some((u) => u.text.includes("setup-reference.md")) && scanUnits(ref).some((u) => createStepComplete(u.text));
    expect(inline || pointed).toBe(true);
  });

  test("AC-.16 no step at or after 7b in skills/setup/SKILL.md passes { create: true }", () => {
    const skill = readFileSync(SETUP_SKILL_PATH, "utf8");
    const lines = skill.split("\n");
    const at7b = lines.findIndex((l) => l.startsWith("### 7b. "));
    expect(at7b).toBeGreaterThan(0);
    // Guard against a vacuous pass: the create must exist somewhere, and only before 7b.
    expect(CREATE_RE.test(lines.slice(0, at7b).join("\n"))).toBe(true);
    expect(CREATE_RE.test(lines.slice(at7b).join("\n"))).toBe(false);
  });
});

describe("Requirement: step 7e skips re-seeding release.files on a settings-file tree", () => {
  test("Req 7e: the skip condition names `release.files` in the settings file alongside the legacy `## Release Files` heading", () => {
    const skill = readFileSync(SETUP_SKILL_PATH, "utf8");
    const ref = readFileSync(SETUP_REF_PATH, "utf8");
    const body = stepBody(skill, "7e");
    expect(body).not.toBe("");
    const refUnits = scanUnits(ref)
      .map((u) => u.text)
      .filter((t) => /\b7e\b/.test(t) || t.includes("## Release Files"));
    const candidates = [...scanUnits(body).map((u) => u.text), ...refUnits].flatMap(sentences);
    const skipSentences = candidates.filter((s) => /\bskip/i.test(s));
    expect(skipSentences.length).toBeGreaterThan(0);
    expect(
      skipSentences.some(
        (s) => s.includes("release.files") && (s.includes("specs/settings.yaml") || /settings file/i.test(s)) && s.includes("## Release Files"),
      ),
    ).toBe(true);
  });
});

/** A both-homes tree: a settings file and a CLAUDE.md that still carries `## Docs` with a recognised key. */
function bothHomesTree(): string {
  const yaml = LINEAR_SETTINGS.replace("  mcp_server: linear\n", "  mcp_server: linear\n  branch_template: \"{type}/{ticket-id}-{slug}\"\n");
  const root = tree({
    "CLAUDE.md": `${settingsClaudeMd(LINEAR_STUB)}\n## Docs\n\nuser_facing_mode: false\n`,
    [SETTINGS]: yaml,
  });
  expect(PS.detectSettingsSource(root)).toBe("both");
  return root;
}

function expectBothRefusal(err: Error): void {
  nfr10(err);
  expect(err.message).toContain("specs/settings.yaml");
  expect(err.message).toContain("CLAUDE.md");
}

describe("Requirement: writers pick their home from loadProjectSettings(projectRoot).source — a both-homes tree refuses", () => {
  test("Req both: writeTrackerConfig refuses in NFR-10 shape naming both homes, tree byte-identical", () => {
    const root = bothHomesTree();
    const before = snapshot(root);
    expectBothRefusal(thrown(() => TC.writeTrackerConfig(join(root, "specs"), clone(STATUS_VOCAB) as Any)));
    expect(snapshot(root)).toEqual(before);
  });

  test("Req both: writeTrackerSubsection refuses in NFR-10 shape naming both homes, tree byte-identical", () => {
    const root = bothHomesTree();
    const before = snapshot(root);
    expectBothRefusal(thrown(() => TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "linear", { project: "Synthetic Project", team: "SYN" })));
    expect(snapshot(root)).toEqual(before);
  });

  test("Req both: videoInit refuses in NFR-10 shape naming both homes, tree byte-identical", () => {
    const root = bothHomesTree();
    const before = snapshot(root);
    expectBothRefusal(thrown(() => VIDEO.videoInit(root, "google", "web", "none")));
    expect(snapshot(root)).toEqual(before);
  });

  test("Req both: reseedBranchTemplate refuses in NFR-10 shape naming both homes, tree byte-identical", () => {
    const root = bothHomesTree();
    const before = snapshot(root);
    expectBothRefusal(thrown(() => RESEED.reseedBranchTemplate(join(root, "CLAUDE.md"), { date: "2026-11-05" })));
    expect(snapshot(root)).toEqual(before);
  });
});

describe("AC-STE-710.2 a create with a shape-invalid settings object refuses", () => {
  test("AC-.2 writeProjectSettings { create: true } with an unknown top-level key refuses in NFR-10 shape and creates no file", () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd() });
    const before = snapshot(root);
    const err = thrown(() => write(root, { schema_version: 1, min_dpt_version: FLOOR, synthetic_unknown_key: true }, { create: true }));
    nfr10(err);
    expect(err.message).toContain("synthetic_unknown_key");
    expect(existsSync(join(root, SETTINGS))).toBe(false);
    expect(snapshot(root)).toEqual(before);
  });
});

describe("Requirement: examples/*/release.yml headers name release.files in the settings file", () => {
  const EXAMPLES = join(PLUGIN, "examples");
  const files = readdirSync(EXAMPLES)
    .sort()
    .map((d) => join(EXAMPLES, d, "release.yml"))
    .filter((p) => existsSync(p));

  test("Req examples: at least one examples/*/release.yml exists (scan control)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    const rel = relative(PLUGIN, f);
    /** The leading comment block, up to the first non-comment line. */
    const header = (): string => {
      const out: string[] = [];
      for (const l of readFileSync(f, "utf8").split("\n")) {
        if (!/^\s*#/.test(l)) break;
        out.push(l.replace(/^\s*#\s?/, ""));
      }
      return out.join(" ");
    };

    test(`Req examples: ${rel} header names \`release.files\` and specs/settings.yaml`, () => {
      const h = header();
      expect(h).toContain("release.files");
      expect(h).toContain("specs/settings.yaml");
    });

    test(`Req examples: ${rel} header never says the block lands in CLAUDE.md as \`## Release Files\` without a legacy clause`, () => {
      for (const s of sentences(header())) {
        if (s.includes("CLAUDE.md") || s.includes("## Release Files")) expect(s).toMatch(/legacy/i);
      }
    });
  }
});
