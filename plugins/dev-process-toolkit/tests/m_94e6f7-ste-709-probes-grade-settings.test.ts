// STE-709 — the gate probes grade the settings file (AC-STE-709.2 .. .15).
//
// AC map (this file):
//   AC-.2  paired fixtures per probe: a settings-file tree and its legacy twin
//          carrying the same values yield the same verdict, and a settings-file
//          tree with the graded defect yields a violation citing
//          `specs/settings.yaml` (where the probe's defect lives in that file:
//          #18, #21, #22, #25, #52, #80). #19's audit section and #25's stub
//          live in CLAUDE.md, #69 never fails, #74 grades source modules, and
//          #87's rows are the listed video paths — those cite their own homes.
//   AC-.3  probe #18 regression rows.
//   AC-.4  probe #25 Linear settings tree + leg (b) outside `## Project Settings`.
//          On a settings-file tree in a tracker mode the stub leg (AC-.12)
//          demands the stub, and the stub is the only place a `### Linear`
//          heading appears; "no `### Linear` heading" is read as "no legacy
//          `### Linear` home", i.e. the binding is graded from the settings file.
//   AC-.5  probe #21 closed set + secondary_tracker trunk parity.
//   AC-.6  probe #69 walks the registry on a settings-only tree. The
//          `settings-file` migration (STE-711) does not exist yet; the half that
//          asserts it does NOT apply on a settings-only tree is graded here only
//          as "no settings-file row", which STE-711's own suite completes.
//   AC-.7  probe #74 flags a private settings-file reader.
//   AC-.8  every pre-existing probe test passes unchanged — graded by the full
//          suite (AC-.14), not re-run from here.
//   AC-.9  the STE-709 probe modules leave the STE-707 one-reader allowlist and
//          carry no private settings-home parse.
//   AC-.10 skills/upgrade/SKILL.md Step 0 names the settings file within NFR-1.
//   AC-.11 skills/gate-check/SKILL.md byte-identical on this FR's commit — graded
//          by tests/m_2306b6-ste-618-live-proof-gate.test.ts with KICKOFF and
//          PERMITTED_LINES unchanged (no row here: STE-713 edits that file later
//          in the milestone, so a trunk-bytes pin here would red its commit).
//   AC-.12 probe #25 stub leg.
//   AC-.13 mutation controls: the rows tagged "[AC-.13 control]" red when the
//          guarded behaviour is removed — the `settings_file` detector (#69's
//          settings-only row; also every settings_file row of
//          tests/m_94e6f7-ste-709-managed-signal.test.ts), the settings arm of
//          #18 (the clean settings-tree row falls back to demanding `## Docs`),
//          the settings arm of #25 (the shared paragraph inside
//          `## Project Settings`, and the settings-file citation), and the stub
//          leg (missing / duplicated / drifted / mode-none rows go to zero).
//   AC-.14 `bun test` from plugins/dev-process-toolkit reports 0 failures and
//          skip identities equal the trunk baseline — the full-suite gate, no row.
//   AC-.15 legacy verdicts: each probe on each legacy fixture returns the
//          v2.101.4 verdict and notes byte for byte (pinned literally below).
//          The `settings-file` warn row probe #69 adds on a managed legacy tree
//          arrives with STE-711; here its rows are compared with any
//          `settings-file` row filtered out, and its `violations` stay empty.
//
// Synthetic ids only. No skips, no todos.

import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { runClaudeMdDocsSectionProbe } from "../adapters/_shared/src/claudemd_docs_section";
import { runClaudeMdProbeManagedGuardProbe } from "../adapters/_shared/src/claudemd_probe_managed_guard";
import type { MigrationEntry } from "../adapters/_shared/src/migrations/index";
import { loadProjectSettings, renderSettingsPointer, renderTrackingStub } from "../adapters/_shared/src/project_settings";
import { runRunnabilityDeclaredProbe } from "../adapters/_shared/src/runnability_declared";
import { renderSharedTrackerSentinel } from "../adapters/_shared/src/setup/tracker_binding_write";
import { runSetupAuditSectionPresenceProbe } from "../adapters/_shared/src/setup_audit_section_presence";
import { runTaskTrackingCanonicalKeysProbe } from "../adapters/_shared/src/task_tracking_canonical_keys";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "../adapters/_shared/src/task_tracking_workspace_binding_present";
import { SETUP_MARKER } from "../adapters/_shared/src/toolkit_managed";
import { runToolkitBootstrapCommittedProbe } from "../adapters/_shared/src/toolkit_bootstrap_committed";
import { runTrackerConfigShapeProbe } from "../adapters/_shared/src/tracker_config_shape";
import { runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";
import { runVideoToolingUncommittedProbe } from "../adapters/_shared/src/video_tooling_uncommitted";

const PLUGIN = resolve(import.meta.dir, "..");
const UPGRADE = "/dev-process-toolkit:upgrade";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste709-probes-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function git(root: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** `git init` the tree and commit exactly `paths` (all files when omitted). */
function gitTree(files: Record<string, string>, paths?: string[]): string {
  const root = tree(files);
  git(root, ["init", "--quiet", "-b", "main"]);
  git(root, ["add", "--", ...(paths ?? ["."])]);
  git(root, ["commit", "--quiet", "--no-verify", "-m", "chore: synthetic fixture"]);
  return root;
}

const FLOOR = "2.0.0";
const SHARED_FLOOR = "2.90.0";
const POINTER = renderSettingsPointer(FLOOR);

/** A settings-file CLAUDE.md: `## Project Settings` with the pointer, then the optional stop paragraph and stub. */
function settingsClaudeMd(opts: { marker?: boolean; pointer?: string | null; stop?: string; stub?: string; before?: string } = {}): string {
  const parts: string[] = [];
  if (opts.marker) parts.push(SETUP_MARKER);
  parts.push("# Synthetic Project", "");
  if (opts.before) parts.push(opts.before, "");
  parts.push("## Project Settings", "");
  let body = parts.join("\n") + "\n";
  if (opts.pointer !== null) body += opts.pointer ?? POINTER;
  if (opts.stop) body += `\n${opts.stop}\n`;
  if (opts.stub) body += `\n${opts.stub}`;
  return body;
}

const LINEAR_BINDING = { team: "SYN", project: "Synthetic Project" };
const LINEAR_TT = { mode: "linear", mcp_server: "linear", linear: LINEAR_BINDING };
const LINEAR_STUB = renderTrackingStub({ task_tracking: LINEAR_TT });

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
  "  changelog_ci_owned: false",
  "",
].join("\n");

const LINEAR_LEGACY_CLAUDE_MD = [
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
  "",
  "## Docs",
  "",
  "user_facing_mode: false",
  "packages_mode: false",
  "changelog_ci_owned: false",
  "",
].join("\n");

const JIRA_BINDING = { project: "SYNJ", default_labels: ["syn-repo"], repo_tag: "syn-repo", min_dpt_version: SHARED_FLOOR };
const JIRA_TT = { mode: "jira", mcp_server: "atlassian", jira: JIRA_BINDING };
const JIRA_STUB = renderTrackingStub({ task_tracking: JIRA_TT });
const JIRA_STOP = renderSharedTrackerSentinel({ adapter: "jira", project: "SYNJ", repoTag: "syn-repo", minDptVersion: SHARED_FLOOR });
const JIRA_SETTINGS = [
  "schema_version: 1",
  `min_dpt_version: "${FLOOR}"`,
  "task_tracking:",
  "  mode: jira",
  "  mcp_server: atlassian",
  "  jira:",
  "    project: SYNJ",
  "    default_labels: [syn-repo]",
  "    repo_tag: syn-repo",
  `    min_dpt_version: "${SHARED_FLOOR}"`,
  "",
].join("\n");

const STATUS_LINES = (key: string): string[] => [
  "  status_vocabulary:",
  `    tracker_key: ${key}`,
  "    statuses: [Todo, In Progress, In Review, Done]",
  "    roles:",
  "      initial: Todo",
  "      in_progress: In Progress",
  "      in_review: In Review",
  "      done: Done",
];
const TRACKER_CONFIG_YAML = (key: string): string =>
  [
    `tracker_key: ${key}`,
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

/** A settings file whose `task_tracking` body is `ttLines` (each already indented by two). */
function settingsWith(ttLines: string[], extra: string[] = []): string {
  return ["schema_version: 1", `min_dpt_version: "${FLOOR}"`, "task_tracking:", ...ttLines, ...extra, ""].join("\n");
}

/** 1-based line of the first line of `text` starting with `prefix`. */
function lineOf(text: string, prefix: string): number {
  const i = text.split("\n").findIndex((l) => l.startsWith(prefix));
  if (i < 0) throw new Error(`fixture has no line starting ${JSON.stringify(prefix)}`);
  return i + 1;
}

interface V {
  file: string;
  note: string;
  message: string;
  reason?: string;
}

const notes = (vs: readonly V[]): string[] => vs.map((v) => v.note);

// Fixture guard: every settings-file fixture that a row treats as healthy loads
// through the loader as a settings-file tree (so a red row is the probe's, not
// a broken fixture's).
function expectLoads(root: string): void {
  expect(loadProjectSettings(root).source).toBe("settings");
}

// ---------------------------------------------------------------------------
// Probe #18 — claudemd-docs-section-present
// ---------------------------------------------------------------------------

describe("probe #18 claudemd-docs-section-present (AC-.2, AC-.3)", () => {
  const healthy = (): string => tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });

  test("AC-.3 [AC-.13 control] settings tree: valid docs section + valid pointer + no `## Docs` heading ⇒ zero violations", async () => {
    const root = healthy();
    expectLoads(root);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).not.toContain("## Docs");
    expect((await runClaudeMdDocsSectionProbe(root)).violations).toEqual([]);
  });

  test("AC-.3 [AC-.13 control] removing the pointer paragraph reports one violation", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ pointer: null, stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });
    const r = await runClaudeMdDocsSectionProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith("CLAUDE.md:")).toBe(true);
  });

  test("AC-.3 [AC-.13 control] editing one byte of the pointer paragraph reports one violation", async () => {
    const drifted = POINTER.replace("requires", "Requires");
    expect(drifted).not.toBe(POINTER);
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ pointer: drifted, stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });
    expect((await runClaudeMdDocsSectionProbe(root)).violations).toHaveLength(1);
  });

  test("a pointer rendered for a different floor than the file's min_dpt_version reports one violation", async () => {
    const root = tree({
      "CLAUDE.md": settingsClaudeMd({ pointer: renderSettingsPointer("2.1.0"), stub: LINEAR_STUB }),
      "specs/settings.yaml": LINEAR_SETTINGS,
    });
    expect((await runClaudeMdDocsSectionProbe(root)).violations).toHaveLength(1);
  });

  test("AC-.2 defect: no `docs` section in the settings file ⇒ one violation citing specs/settings.yaml", async () => {
    const root = tree({
      "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }),
      "specs/settings.yaml": LINEAR_SETTINGS.replace(/docs:\n(  .*\n)+/, ""),
    });
    expectLoads(root);
    const r = await runClaudeMdDocsSectionProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith("specs/settings.yaml")).toBe(true);
  });

  test("AC-.2 pair: settings tree and legacy twin with the same values yield the same verdict (clean)", async () => {
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD });
    expect((await runClaudeMdDocsSectionProbe(legacy)).violations).toEqual([]);
    expect((await runClaudeMdDocsSectionProbe(healthy())).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Probe #19 — setup-audit-section-presence
// ---------------------------------------------------------------------------

describe("probe #19 setup-audit-section-presence (AC-.2)", () => {
  const AUDIT = "\n## /setup audit\n\n- step:7c branch_template — default applied\n";
  const BT_SETTINGS = settingsWith(["  mode: none", '  branch_template: "feat/{ticket-id}-{slug}"']);
  const BT_LEGACY = `${SETUP_MARKER}\n# Synthetic Project\n\n## Task Tracking\n\nmode: none\nbranch_template: feat/{ticket-id}-{slug}\n`;

  test("settings tree: branch_template populated in the settings file, no audit section ⇒ one violation", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ marker: true }), "specs/settings.yaml": BT_SETTINGS });
    expectLoads(root);
    const r = await runSetupAuditSectionPresenceProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith("CLAUDE.md:1 — ## /setup audit section missing")).toBe(true);
  });

  test("settings tree: docs flags emitted in the settings file, no audit section ⇒ one violation", async () => {
    const root = tree({
      "CLAUDE.md": settingsClaudeMd({ marker: true }),
      "specs/settings.yaml": settingsWith(["  mode: none"], ["docs:", "  user_facing_mode: false"]),
    });
    expectLoads(root);
    expect((await runSetupAuditSectionPresenceProbe(root)).violations).toHaveLength(1);
  });

  test("settings tree with the audit section ⇒ clean", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ marker: true }) + AUDIT, "specs/settings.yaml": BT_SETTINGS });
    expect((await runSetupAuditSectionPresenceProbe(root)).violations).toEqual([]);
  });

  test("scope stays marker-only: a settings tree without the /setup marker is vacuous", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": BT_SETTINGS });
    expect((await runSetupAuditSectionPresenceProbe(root)).violations).toEqual([]);
  });

  test("pair: the legacy twin with the same values yields the same verdict", async () => {
    const legacy = tree({ "CLAUDE.md": BT_LEGACY });
    const settings = tree({ "CLAUDE.md": settingsClaudeMd({ marker: true }), "specs/settings.yaml": BT_SETTINGS });
    const [l, s] = await Promise.all([runSetupAuditSectionPresenceProbe(legacy), runSetupAuditSectionPresenceProbe(settings)]);
    expect(s.violations.length).toBe(l.violations.length);
    expect(l.violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Probe #21 — task-tracking-canonical-keys
// ---------------------------------------------------------------------------

describe("probe #21 task-tracking-canonical-keys (AC-.2, AC-.5)", () => {
  const LINEAR_TT_LINES = ["  mode: linear", "  mcp_server: linear", "  linear:", "    team: SYN", "    project: Synthetic Project"];

  test("AC-.5 an extra top-level key under task_tracking is refused with a specs/settings.yaml:<line> citation", async () => {
    const yaml = settingsWith([...LINEAR_TT_LINES.slice(0, 2), "  linear_team_key: SYN", ...LINEAR_TT_LINES.slice(2)]);
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": yaml });
    const r = await runTaskTrackingCanonicalKeysProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith(`specs/settings.yaml:${lineOf(yaml, "  linear_team_key:")} — `)).toBe(true);
    expect(r.violations[0]!.note).toContain("linear_team_key");
  });

  test("AC-.5 every key of the closed set is accepted", async () => {
    const yaml = settingsWith([
      "  mode: linear",
      "  mcp_server: linear",
      '  jira_ac_field: ""',
      '  branch_template: "feat/{ticket-id}-{slug}"',
      "  milestone_scan_fetch: false",
      "  linear:",
      "    team: SYN",
      "    project: Synthetic Project",
      "  jira:",
      "    project: SYNJ",
      ...STATUS_LINES("linear"),
    ]);
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": yaml });
    expectLoads(root);
    expect((await runTaskTrackingCanonicalKeysProbe(root)).violations).toEqual([]);
  });

  test("AC-.5 trunk parity: secondary_tracker reds on a settings tree and on its legacy twin, one violation each", async () => {
    const yaml = settingsWith([...LINEAR_TT_LINES.slice(0, 2), "  secondary_tracker: jira", ...LINEAR_TT_LINES.slice(2)]);
    const settings = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": yaml });
    // The loader still reads the key (STE-706).
    expect(loadProjectSettings(settings).settings.task_tracking.secondary_tracker).toBe("jira");
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD.replace("mcp_server: linear\n", "mcp_server: linear\nsecondary_tracker: jira\n") });
    const s = await runTaskTrackingCanonicalKeysProbe(settings);
    const l = await runTaskTrackingCanonicalKeysProbe(legacy);
    expect(l.violations).toHaveLength(1);
    expect(s.violations).toHaveLength(1);
    expect(s.violations[0]!.note.startsWith(`specs/settings.yaml:${lineOf(yaml, "  secondary_tracker:")} — `)).toBe(true);
  });

  test("AC-.2 pair: clean settings tree and clean legacy twin both report zero", async () => {
    const settings = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD });
    expect((await runTaskTrackingCanonicalKeysProbe(settings)).violations).toEqual([]);
    expect((await runTaskTrackingCanonicalKeysProbe(legacy)).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Probe #22 — toolkit-bootstrap-committed
// ---------------------------------------------------------------------------

describe("probe #22 toolkit-bootstrap-committed (AC-.2)", () => {
  const files = (): Record<string, string> => ({
    "CLAUDE.md": settingsClaudeMd({ marker: true, stub: LINEAR_STUB }),
    "specs/settings.yaml": LINEAR_SETTINGS,
  });

  test("defect: an uncommitted specs/settings.yaml is reported, citing specs/settings.yaml", async () => {
    const root = gitTree(files(), ["CLAUDE.md"]);
    const r = await runToolkitBootstrapCommittedProbe(root);
    expect(notes(r.violations)).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith("specs/settings.yaml:1 — specs/settings.yaml is toolkit-managed but uncommitted")).toBe(true);
  });

  test("a modified, committed specs/settings.yaml is reported too", async () => {
    const root = gitTree(files());
    writeFileSync(join(root, "specs", "settings.yaml"), LINEAR_SETTINGS + "# edited\n");
    const r = await runToolkitBootstrapCommittedProbe(root);
    expect(r.violations.map((v) => v.note.split(" — ")[0])).toEqual(["specs/settings.yaml:1"]);
  });

  test("pair: everything committed ⇒ settings tree and legacy twin both clean", async () => {
    const settings = gitTree(files());
    const legacy = gitTree({ "CLAUDE.md": `${SETUP_MARKER}\n${LINEAR_LEGACY_CLAUDE_MD}` });
    expect((await runToolkitBootstrapCommittedProbe(settings)).violations).toEqual([]);
    expect((await runToolkitBootstrapCommittedProbe(legacy)).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Probe #25 — task-tracking-workspace-binding-present
// ---------------------------------------------------------------------------

describe("probe #25 task-tracking-workspace-binding-present (AC-.2, AC-.4)", () => {
  test("AC-.4 Linear settings tree with a populated task_tracking.linear binding and no legacy `### Linear` home ⇒ zero", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });
    expectLoads(root);
    // The only `### Linear` heading is the one inside the generated stub.
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8").split("\n").filter((l) => l === "### Linear")).toHaveLength(1);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });

  test("AC-.4 [AC-.13 control] shared Jira settings tree: stop paragraph inside `## Project Settings` ⇒ zero", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stop: JIRA_STOP, stub: JIRA_STUB }), "specs/settings.yaml": JIRA_SETTINGS });
    expectLoads(root);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });

  test("AC-.4 shared Jira settings tree: stop paragraph outside `## Project Settings` is red under leg (b)", async () => {
    const root = tree({
      "CLAUDE.md": settingsClaudeMd({ before: `## Key Commands\n\n${JIRA_STOP}`, stub: JIRA_STUB }),
      "specs/settings.yaml": JIRA_SETTINGS,
    });
    const r = await runTaskTrackingWorkspaceBindingPresentProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.reason).toContain("stop paragraph");
  });

  test("AC-.4 shared Jira settings tree: stop paragraph absent is red under leg (b)", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stub: JIRA_STUB }), "specs/settings.yaml": JIRA_SETTINGS });
    const r = await runTaskTrackingWorkspaceBindingPresentProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.reason).toContain("stop paragraph");
  });

  test("AC-.2 [AC-.13 control] defect: Linear binding missing `project` in the settings file ⇒ one violation citing specs/settings.yaml", async () => {
    const tt = { mode: "linear", mcp_server: "linear", linear: { team: "SYN" } };
    const yaml = settingsWith(["  mode: linear", "  mcp_server: linear", "  linear:", "    team: SYN"]);
    const root = tree({
      "CLAUDE.md": settingsClaudeMd({ stub: renderTrackingStub({ task_tracking: tt }) }),
      "specs/settings.yaml": yaml,
    });
    expectLoads(root);
    const r = await runTaskTrackingWorkspaceBindingPresentProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith("specs/settings.yaml:")).toBe(true);
    expect(r.violations[0]!.reason).toContain("project");
  });

  test("AC-.2 pair: the legacy twin of the missing-project defect also reports one violation", async () => {
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD.replace("project: Synthetic Project\n", "") });
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(legacy)).violations).toHaveLength(1);
  });

  test("AC-.2 pair: clean settings tree and clean legacy twin both report zero", async () => {
    const settings = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD });
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(settings)).violations).toEqual([]);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(legacy)).violations).toEqual([]);
  });
});

describe("probe #25 the stub leg (AC-.12)", () => {
  async function expectStubRed(claudeMd: string, settings: string): Promise<void> {
    const root = tree({ "CLAUDE.md": claudeMd, "specs/settings.yaml": settings });
    const r = await runTaskTrackingWorkspaceBindingPresentProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith("CLAUDE.md:")).toBe(true);
    expect(r.violations[0]!.message).toContain(UPGRADE);
  }

  test("a Linear settings tree whose stub is byte-equal to its render ⇒ zero", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": LINEAR_SETTINGS });
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });

  test("[AC-.13 control] a missing stub ⇒ one violation citing CLAUDE.md, remedy names /dev-process-toolkit:upgrade", async () => {
    await expectStubRed(settingsClaudeMd(), LINEAR_SETTINGS);
  });

  test("[AC-.13 control] a duplicated stub ⇒ one violation", async () => {
    await expectStubRed(settingsClaudeMd({ stub: `${LINEAR_STUB}\n${LINEAR_STUB}` }), LINEAR_SETTINGS);
  });

  test("[AC-.13 control] a one-byte edit to the stub ⇒ one violation", async () => {
    const drifted = LINEAR_STUB.replace("team: SYN", "team: SYM");
    expect(drifted).not.toBe(LINEAR_STUB);
    await expectStubRed(settingsClaudeMd({ stub: drifted }), LINEAR_SETTINGS);
  });

  test("[AC-.13 control] a stub slot holding a recognised key under `mode: none` ⇒ one violation", async () => {
    await expectStubRed(settingsClaudeMd({ stub: LINEAR_STUB }), settingsWith(["  mode: none"]));
  });

  test("control: `mode: none` with no stub slot ⇒ zero", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": settingsWith(["  mode: none"]) });
    expectLoads(root);
    expect((await runTaskTrackingWorkspaceBindingPresentProbe(root)).violations).toEqual([]);
  });

  test("a shared Jira tree whose stub declares a floor below the settings file's is red", async () => {
    const lowStub = renderTrackingStub({ task_tracking: { ...JIRA_TT, jira: { ...JIRA_BINDING, min_dpt_version: "2.88.0" } } });
    expect(lowStub).not.toBe(JIRA_STUB);
    await expectStubRed(settingsClaudeMd({ stop: JIRA_STOP, stub: lowStub }), JIRA_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// Probe #52 — tracker_config_shape
// ---------------------------------------------------------------------------

describe("probe #52 tracker_config_shape (AC-.2)", () => {
  const LINEAR_TT_LINES = ["  mode: linear", "  mcp_server: linear", "  linear:", "    team: SYN", "    project: Synthetic Project"];

  test("settings tree: a status_vocabulary whose tracker_key disagrees with the mode ⇒ one violation citing specs/settings.yaml", async () => {
    const yaml = settingsWith([...LINEAR_TT_LINES, ...STATUS_LINES("jira")]);
    const root = tree({ "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }), "specs/settings.yaml": yaml });
    expectLoads(root);
    const r = await runTrackerConfigShapeProbe(root);
    expect(r.violations).toHaveLength(1);
    const allowed = [lineOf(yaml, "  status_vocabulary:"), lineOf(yaml, "    tracker_key:")];
    const m = /^specs\/settings\.yaml:(\d+) — /.exec(r.violations[0]!.note);
    expect(m).not.toBeNull();
    expect(allowed).toContain(Number(m![1]));
  });

  test("pair: the legacy twin (tracker-config.yaml tracker_key: jira under mode: linear) also reports one", async () => {
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD, "specs/tracker-config.yaml": TRACKER_CONFIG_YAML("jira") });
    expect((await runTrackerConfigShapeProbe(legacy)).violations).toHaveLength(1);
  });

  test("pair: a valid status_vocabulary and its valid legacy twin are both clean", async () => {
    const settings = tree({
      "CLAUDE.md": settingsClaudeMd({ stub: LINEAR_STUB }),
      "specs/settings.yaml": settingsWith([...LINEAR_TT_LINES, ...STATUS_LINES("linear")]),
    });
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD, "specs/tracker-config.yaml": TRACKER_CONFIG_YAML("linear") });
    expect((await runTrackerConfigShapeProbe(settings)).violations).toEqual([]);
    expect((await runTrackerConfigShapeProbe(legacy)).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Probe #69 — upgrade_staleness
// ---------------------------------------------------------------------------

describe("probe #69 upgrade_staleness (AC-.2, AC-.6)", () => {
  const OLDER: MigrationEntry = {
    id: "synthetic-older-entry",
    introduced_in: "2.0.0",
    title: "synthetic older entry",
    kind: "assisted",
    detect: () => ({ applies: true, evidence: ["synthetic evidence"] }),
  };
  const ROW = "synthetic-older-entry (2.0.0): synthetic evidence";

  test("AC-.6 [AC-.13 control] a settings-only tree is managed: the registry is walked and an older applying entry renders", async () => {
    const root = tree({ "specs/settings.yaml": LINEAR_SETTINGS });
    const r = await runUpgradeStalenessProbe(root, [OLDER]);
    expect(r.rows).toEqual([ROW]);
    expect(r.violations).toEqual([]);
  });

  test("AC-.6 a settings-only tree with the live registry renders no `settings-file` row and never fails", async () => {
    // The `settings-file` migration (STE-711) does not apply on a settings-only
    // tree; STE-711's suite grades its detector directly.
    const root = tree({ "specs/settings.yaml": LINEAR_SETTINGS });
    const r = await runUpgradeStalenessProbe(root);
    expect(r.rows.filter((row) => row.startsWith("settings-file "))).toEqual([]);
    expect(r.violations).toEqual([]);
  });

  test("pair: the legacy twin renders the same row", async () => {
    const legacy = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD });
    expect((await runUpgradeStalenessProbe(legacy, [OLDER])).rows).toEqual([ROW]);
  });

  test("an unmanaged tree (or one holding only a foreign settings file) does not walk the registry", async () => {
    const empty = tree({ "README.md": "# synthetic\n" });
    const foreign = tree({ "specs/settings.yaml": "service:\n  port: 8080\n" });
    expect((await runUpgradeStalenessProbe(empty, [OLDER])).rows).toEqual([]);
    expect((await runUpgradeStalenessProbe(foreign, [OLDER])).rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Probe #74 — claudemd_probe_managed_guard
// ---------------------------------------------------------------------------

describe("probe #74 claudemd_probe_managed_guard (AC-.2, AC-.7)", () => {
  const SRC = "adapters/_shared/src";
  const PRIVATE_READER = [
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "",
    "export function readSettings(root: string): string {",
    '  return readFileSync(join(root, "specs/settings.yaml"), "utf8");',
    "}",
    "",
  ].join("\n");

  test("AC-.7 a module reading specs/settings.yaml with readFileSync, no loader import and no exemption, is flagged", async () => {
    const root = tree({ [`${SRC}/synthetic_settings_reader.ts`]: PRIVATE_READER });
    const r = await runClaudeMdProbeManagedGuardProbe(root);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.file.endsWith("synthetic_settings_reader.ts")).toBe(true);
  });

  test("AC-.7 the same read split into path segments is flagged too", async () => {
    const body = PRIVATE_READER.replace('join(root, "specs/settings.yaml")', 'join(root, "specs", "settings.yaml")');
    const root = tree({ [`${SRC}/synthetic_settings_reader.ts`]: body });
    expect((await runClaudeMdProbeManagedGuardProbe(root)).violations).toHaveLength(1);
  });

  test("AC-.7 project_settings.ts and its legacy module pass", async () => {
    const root = tree({
      [`${SRC}/project_settings.ts`]: PRIVATE_READER,
      [`${SRC}/project_settings_legacy.ts`]: PRIVATE_READER,
    });
    expect((await runClaudeMdProbeManagedGuardProbe(root)).violations).toEqual([]);
  });

  test("pair (legacy arm unchanged): a private CLAUDE.md reader is still flagged", async () => {
    const body = PRIVATE_READER.replace('"specs/settings.yaml"', '"CLAUDE.md"');
    const root = tree({ [`${SRC}/synthetic_claudemd_reader.ts`]: body });
    expect((await runClaudeMdProbeManagedGuardProbe(root)).violations).toHaveLength(1);
  });

  test("the live adapter layer stays clean", async () => {
    expect((await runClaudeMdProbeManagedGuardProbe(PLUGIN)).violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Probe #80 — runnability_declared
// ---------------------------------------------------------------------------

describe("probe #80 runnability_declared (AC-.2)", () => {
  const PKG = JSON.stringify({ name: "synthetic", scripts: { dev: "bun run src/main.ts" } }, null, 2) + "\n";
  const UNANSWERED = ["schema_version: 1", `min_dpt_version: "${FLOOR}"`, "verification:", "  verify_mode: advisory", ""].join("\n");
  const ANSWERED = UNANSWERED.replace("  verify_mode: advisory\n", "  verify_mode: advisory\n  run_cmd: none\n");
  const LEGACY = (answered: boolean): string =>
    `# Synthetic Project\n\n## Task Tracking\n\nmode: none\n\n## Verification\n\nverify_mode: advisory\n${answered ? "run_cmd: none\n" : ""}`;

  test("settings tree: run_cmd unanswered in the settings file ⇒ one violation citing specs/settings.yaml, not CLAUDE.md", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": UNANSWERED, "package.json": PKG });
    expectLoads(root);
    const r = await runRunnabilityDeclaredProbe(root);
    expect(r.vacuous).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.note.startsWith(`specs/settings.yaml:${lineOf(UNANSWERED, "verification:")} — `)).toBe(true);
    expect(r.violations[0]!.note.startsWith("CLAUDE.md")).toBe(false);
    expect(r.violations[0]!.message).toContain("verification.run_cmd");
  });

  test("settings tree: run_cmd answered in the settings file ⇒ clean, non-vacuous", async () => {
    const root = tree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": ANSWERED, "package.json": PKG });
    const r = await runRunnabilityDeclaredProbe(root);
    expect(r).toEqual({ violations: [], vacuous: false });
  });

  test("pair: the legacy twins carry the same verdicts", async () => {
    const red = tree({ "CLAUDE.md": LEGACY(false), "package.json": PKG });
    const green = tree({ "CLAUDE.md": LEGACY(true), "package.json": PKG });
    expect((await runRunnabilityDeclaredProbe(red)).violations).toHaveLength(1);
    expect(await runRunnabilityDeclaredProbe(green)).toEqual({ violations: [], vacuous: false });
  });
});

// ---------------------------------------------------------------------------
// Probe #87 — video_tooling_uncommitted
// ---------------------------------------------------------------------------

describe("probe #87 video_tooling_uncommitted (AC-.2)", () => {
  const VIDEO_YAML = "tts:\n  provider: google\n  voice: en-US-Synth\nrecorder:\n  kind: footage\nmusic:\n  source: none\n";
  const VIDEO_SETTINGS = [
    "schema_version: 1",
    `min_dpt_version: "${FLOOR}"`,
    "video:",
    "  config:",
    ...VIDEO_YAML.trimEnd().split("\n").map((l) => `    ${l}`),
    "",
  ].join("\n");

  test("settings tree with a `video` section is not vacuous (vacuity decided by the loader's video section)", async () => {
    const root = gitTree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": VIDEO_SETTINGS });
    expectLoads(root);
    expect(loadProjectSettings(root).settings.video.config).not.toBeNull();
    const r = await runVideoToolingUncommittedProbe(root);
    expect(r.vacuous).toBe(false);
    expect(r.violations).toEqual([]);
  });

  test("settings tree with no `video` section is vacuous", async () => {
    const root = gitTree({ "CLAUDE.md": settingsClaudeMd(), "specs/settings.yaml": LINEAR_SETTINGS });
    expect(await runVideoToolingUncommittedProbe(root)).toEqual({ violations: [], notes: [], vacuous: true });
  });

  test("pair: the committed legacy twin (.dpt/video/config.yaml) has the same verdict", async () => {
    const root = gitTree({ "CLAUDE.md": "# Synthetic Project\n", ".dpt/video/config.yaml": VIDEO_YAML });
    expect(await runVideoToolingUncommittedProbe(root)).toEqual({ violations: [], notes: [], vacuous: false });
  });
});

// ---------------------------------------------------------------------------
// AC-.15 — legacy verdicts hold, byte for byte
// ---------------------------------------------------------------------------

describe("AC-STE-709.15 legacy verdicts hold (v2.101.4 notes pinned)", () => {
  test("#18 legacy: managed tree without `## Docs`", async () => {
    const root = tree({ "CLAUDE.md": `${SETUP_MARKER}\n# Synthetic Project\n` });
    expect(notes((await runClaudeMdDocsSectionProbe(root)).violations)).toEqual([
      "CLAUDE.md:1 — ## Docs section missing — /docs cannot read mode flags without it",
    ]);
  });

  test("#19 legacy: marker + branch_template, no audit", async () => {
    const root = tree({ "CLAUDE.md": `${SETUP_MARKER}\n# Synthetic Project\n\n## Task Tracking\n\nmode: none\nbranch_template: feat/{ticket-id}-{slug}\n` });
    expect(notes((await runSetupAuditSectionPresenceProbe(root)).violations)).toEqual([
      "CLAUDE.md:1 — ## /setup audit section missing — toolkit-managed CLAUDE.md must record default-applied step outcomes",
    ]);
  });

  test("#21 legacy: secondary_tracker under ## Task Tracking", async () => {
    const root = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD.replace("mcp_server: linear\n", "mcp_server: linear\nsecondary_tracker: jira\n") });
    expect(notes((await runTaskTrackingCanonicalKeysProbe(root)).violations)).toEqual([
      "CLAUDE.md:7 — non-canonical keys at top level: secondary_tracker — closed set is {mode, mcp_server, jira_ac_field, branch_template}",
    ]);
  });

  test("#22 legacy: uncommitted CLAUDE.md", async () => {
    const root = gitTree({ "CLAUDE.md": `${SETUP_MARKER}\n${LINEAR_LEGACY_CLAUDE_MD}`, "README.md": "# synthetic\n" }, ["README.md"]);
    expect(notes((await runToolkitBootstrapCommittedProbe(root)).violations)).toEqual([
      "CLAUDE.md:1 — CLAUDE.md is toolkit-managed but uncommitted (status: ??) — toolkit bootstrap commit missed",
    ]);
  });

  test("#25 legacy: Linear sub-section missing project", async () => {
    const root = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD.replace("project: Synthetic Project\n", "") });
    const r = await runTaskTrackingWorkspaceBindingPresentProbe(root);
    expect(notes(r.violations)).toEqual(["CLAUDE.md:8 — ### Linear sub-section is missing required key: project"]);
    expect(r.skipped).toEqual(["key-prefix leg (Jira only)"]);
  });

  test("#25 legacy: clean Linear tree", async () => {
    const r = await runTaskTrackingWorkspaceBindingPresentProbe(tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD }));
    expect(r).toEqual({ violations: [], skipped: ["key-prefix leg (Jira only)"] });
  });

  test("#52 legacy: tracker_key disagrees with mode", async () => {
    const root = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD, "specs/tracker-config.yaml": TRACKER_CONFIG_YAML("jira") });
    const vs = (await runTrackerConfigShapeProbe(root)).violations;
    expect(vs).toHaveLength(1);
    expect(vs[0]!.note.startsWith("specs/tracker-config.yaml:1 — ")).toBe(true);
  });

  test("#69 legacy: managed legacy tree with the live registry — rows unchanged apart from STE-711's settings-file row, never failing", async () => {
    const root = tree({ "CLAUDE.md": LINEAR_LEGACY_CLAUDE_MD });
    const r = await runUpgradeStalenessProbe(root);
    expect(r.violations).toEqual([]);
    expect(r.rows.filter((row) => !row.startsWith("settings-file "))).toEqual(PINNED_69_LEGACY_ROWS);
  });

  test("#69 legacy: an unmanaged tree adds no row", async () => {
    const r = await runUpgradeStalenessProbe(tree({ "README.md": "# synthetic\n" }));
    expect(r).toEqual({ rows: [], notes: [], violations: [] });
  });

  test("#80 legacy: unanswered run_cmd cites the ## Verification heading", async () => {
    const root = tree({
      "CLAUDE.md": "# Synthetic Project\n\n## Task Tracking\n\nmode: none\n\n## Verification\n\nverify_mode: advisory\n",
      "package.json": JSON.stringify({ name: "synthetic", scripts: { dev: "bun run src/main.ts" } }) + "\n",
    });
    const vs = (await runRunnabilityDeclaredProbe(root)).violations;
    expect(vs.map((v) => v.note.split(" — ")[0])).toEqual(["CLAUDE.md:7"]);
  });

  test("#87 legacy: no video config is vacuous", async () => {
    const root = gitTree({ "CLAUDE.md": "# Synthetic Project\n" });
    expect(await runVideoToolingUncommittedProbe(root)).toEqual({ violations: [], notes: [], vacuous: true });
  });
});

// The live registry's rows on `LINEAR_LEGACY_CLAUDE_MD` alone, as v2.101.4 renders them.
const PINNED_69_LEGACY_ROWS: string[] = [];

// ---------------------------------------------------------------------------
// AC-.9 — the STE-709 probe modules leave the STE-707 one-reader allowlist
// ---------------------------------------------------------------------------

describe("AC-STE-709.9 the probe modules this FR owns hold no private settings-home parse", () => {
  // The STE-707 scan's offence shapes, restated (that file exports nothing).
  const MOVED = ["## Task Tracking", "### Linear", "### Jira", "## Verification", "## Docs", "## Orchestration", "## Token Stats", "## Release Files"];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const NAMES = "Task Tracking|Linear\\b|Jira\\b|Verification\\b|Docs\\b|Orchestration\\b|Token Stats|Release Files";
  const RULES = [
    new RegExp(`(["'])(?:${MOVED.map(esc).join("|")})\\1`),
    /(["'])[^"'\n]*tracker-config\.yaml\1/,
    new RegExp(`\\^\\\\?s*#[^\\n]{0,16}?(?:${NAMES})`),
    /\bvideo(?:Config|Style)Path\s*\(/,
  ];
  const STE_709_MODULES = [
    "claudemd_docs_section.ts",
    "setup_audit_section_presence.ts",
    "task_tracking_canonical_keys.ts",
    "task_tracking_workspace_binding_present.ts",
    "tracker_config_shape.ts",
    "video_tooling_uncommitted.ts",
    "toolkit_managed.ts",
  ];

  test("no STE-709 module hits the one-reader scan", () => {
    const hits: string[] = [];
    for (const m of STE_709_MODULES) {
      readFileSync(join(PLUGIN, "adapters/_shared/src", m), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return;
          if (RULES.some((re) => re.test(line))) hits.push(`${m}:${i + 1} ${t}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("the STE-707 temporary allowlist holds no STE-709 entry", () => {
    const src = readFileSync(join(PLUGIN, "tests/m_94e6f7-ste-707-one-settings-reader.test.ts"), "utf8");
    expect(src).not.toContain('{ owner: "STE-709"');
  });
});

// ---------------------------------------------------------------------------
// AC-.10 — skills/upgrade/SKILL.md Step 0 names the settings file within NFR-1
// ---------------------------------------------------------------------------

describe("AC-STE-709.10 upgrade Step 0 names the settings file", () => {
  const skill = readFileSync(join(PLUGIN, "skills/upgrade/SKILL.md"), "utf8");

  test("Step 0 names specs/settings.yaml among the managed signals", () => {
    const start = skill.indexOf("## Step 0");
    const end = skill.indexOf("\n## ", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(skill.slice(start, end)).toContain("specs/settings.yaml");
  });

  test("the file stays within NFR-1 and SKILL_LINE_CAP is not raised", () => {
    const capSrc = readFileSync(join(PLUGIN, "tests/skill-nfr-1-length.test.ts"), "utf8");
    expect(/const SKILL_LINE_CAP = (\d+);/.exec(capSrc)?.[1]).toBe("358");
    expect(skill.split("\n").length).toBeLessThanOrEqual(358);
  });
});
