// M_94e6f7 /implement Phase 3 hardening — regression rows for defects found after the
// per-FR TDD cycles (self-review, code-reviewer passes, audit leftovers). Each row names
// the defect it pins. Fixtures are synthetic.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { changelogUnversionedAt } from "../adapters/_shared/src/active_plan_ship_ready";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "m94-p3-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const SETTINGS_DOCS = "schema_version: 1\nmin_dpt_version: \"2.0.0\"\ndocs:\n  user_facing_mode: false\n  packages_mode: false\n  changelog_unversioned: true\n";
const LEGACY_DOCS = "# Synthetic\n\n## Docs\n\nuser_facing_mode: false\npackages_mode: false\nchangelog_unversioned: true\n";

describe("SettingsShapeError is a reader refusal, not a crash", () => {
  test("changelogUnversionedAt on a both-homes tree reads false (as a malformed legacy block does), never throws", () => {
    const root = tree({ "specs/settings.yaml": SETTINGS_DOCS, "CLAUDE.md": LEGACY_DOCS });
    expect(() => changelogUnversionedAt(root)).not.toThrow();
    expect(changelogUnversionedAt(root)).toBe(false);
  });

  test("control: the settings file alone answers true", () => {
    const root = tree({ "specs/settings.yaml": SETTINGS_DOCS, "CLAUDE.md": "# Synthetic\n" });
    expect(changelogUnversionedAt(root)).toBe(true);
  });

  test("control: the legacy block alone answers true (unchanged from trunk)", () => {
    const root = tree({ "CLAUDE.md": LEGACY_DOCS });
    expect(changelogUnversionedAt(root)).toBe(true);
  });
});

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC_DIR = join(PLUGIN_ROOT, "adapters", "_shared", "src");

describe("remedies name the home the tree actually uses", () => {
  test("videoReadiness on a settings-file tree without video settings names video.config in specs/settings.yaml, not .dpt/video", () => {
    const { videoReadiness } = require("../adapters/_shared/src/video/readiness") as typeof import("../adapters/_shared/src/video/readiness");
    const root = tree({ "specs/settings.yaml": "schema_version: 1\nmin_dpt_version: \"2.0.0\"\n", "CLAUDE.md": "# Synthetic\n" });
    const first = videoReadiness(root, { ffmpegRunner: () => ({ code: 0, stdout: "", stderr: "" }) }).reasons[0] ?? "";
    expect(first).toContain("`video.config` in specs/settings.yaml is absent");
    expect(first).not.toContain(".dpt/video/config.yaml");
  });

  test("control: on a legacy tree the readiness reason still names .dpt/video/config.yaml (trunk text)", () => {
    const { videoReadiness } = require("../adapters/_shared/src/video/readiness") as typeof import("../adapters/_shared/src/video/readiness");
    const root = tree({ "CLAUDE.md": "# Synthetic\n" });
    const first = videoReadiness(root, { ffmpegRunner: () => ({ code: 0, stdout: "", stderr: "" }) }).reasons[0] ?? "";
    expect(first).toBe(".dpt/video/config.yaml is absent — remedy: create .dpt/video/config.yaml with tts, recorder and music blocks.");
  });

  function typedCheck(root: string): string {
    const r = Bun.spawnSync(["bun", "run", join(SRC_DIR, "next_free_milestone_number.ts"), join(root, "specs"), "M7"], { stdout: "pipe", stderr: "pipe" });
    return r.stderr.toString();
  }

  test("the typed-milestone mode refusal on a settings-file tree points at task_tracking.mode in specs/settings.yaml", () => {
    const root = tree({
      "specs/settings.yaml": "schema_version: 1\nmin_dpt_version: \"2.0.0\"\ntask_tracking:\n  mode: bogus\n",
      "CLAUDE.md": "# Synthetic\n",
    });
    const err = typedCheck(root);
    expect(err).toContain("Refusing:");
    expect(err).toMatch(/Remedy: .*specs\/settings\.yaml/);
    expect(err).not.toContain("declaring `## Task Tracking`");
  });

  test("control: the legacy mode refusal keeps its trunk remedy", () => {
    const root = tree({ "specs/x.md": "", "CLAUDE.md": "# Synthetic\n\n## Task Tracking\n\nmode: bogus\n" });
    const err = typedCheck(root);
    expect(err).toContain("Remedy: set `mode:` in ");
    expect(err).not.toContain("specs/settings.yaml");
  });
});

/** Run `fn` with the running toolkit version reported as 3.0.0 (the move writes a 3.0.0 floor). */
async function asRelease<T>(fn: () => Promise<T> | T): Promise<T> {
  const fake = mkdtempSync(join(tmpdir(), "m94-p3-plugin-"));
  roots.push(fake);
  mkdirSync(join(fake, ".claude-plugin"), { recursive: true });
  writeFileSync(join(fake, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "dev-process-toolkit", version: "3.0.0" }));
  const prev = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = fake;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prev;
  }
}

describe("the move carries every binding key it removes (review pass 1, finding 1)", () => {
  const MD = [
    "# Synthetic",
    "",
    "## Task Tracking",
    "",
    "mode: jira",
    "mcp_server: atlassian",
    "jira_ac_field:",
    "",
    "### Jira",
    "",
    "project: SYN",
    "jira_issue_type: Story",
    "linear_bug_label: Bug",
    "",
    "### Linear",
    "",
    "team: SYN",
    "project: Syn",
    "jira_bug_issue_type: Bug",
    "",
  ].join("\n");

  test("jira_issue_type and off-adapter bug keys land in specs/settings.yaml and the stub; a second detect is clean", async () => {
    const { MIGRATIONS } = require("../adapters/_shared/src/migrations/index") as typeof import("../adapters/_shared/src/migrations/index");
    const { loadProjectSection } = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const entry = MIGRATIONS.find((e) => e.id === "settings-file")!;
    const root = tree({ "CLAUDE.md": MD });
    await asRelease(async () => {
      const res = await entry.apply(root);
      expect(res.changed).toContain("specs/settings.yaml");
      const tt = loadProjectSection(root, "task_tracking") as Record<string, Record<string, unknown>>;
      expect(tt.jira).toMatchObject({ project: "SYN", jira_issue_type: "Story", linear_bug_label: "Bug" });
      expect(tt.linear).toMatchObject({ team: "SYN", project: "Syn", jira_bug_issue_type: "Bug" });
      const md = readFileSync(join(root, "CLAUDE.md"), "utf8");
      expect(md).toContain("\njira_issue_type: Story\n");
      expect((await entry.detect(root)).applies).toBe(false);
    });
  });
});

describe("a shared binding write never drops its stop paragraph (review pass 1, finding 2)", () => {
  const SETTINGS = "schema_version: 1\nmin_dpt_version: \"2.0.0\"\ntask_tracking:\n  mode: jira\n  mcp_server: atlassian\n  jira:\n    project: SYN\n";

  test("a settings-file tree whose CLAUDE.md has no ## Project Settings refuses the shared write and changes no file", () => {
    const TB = require("../adapters/_shared/src/setup/tracker_binding_write") as typeof import("../adapters/_shared/src/setup/tracker_binding_write");
    const PS = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const md = `# Synthetic\n\n${PS.renderTrackingStub({ task_tracking: { mode: "jira", mcp_server: "atlassian", jira: { project: "SYN" } } } as never)}`;
    const root = tree({ "CLAUDE.md": md, "specs/settings.yaml": SETTINGS });
    let err: unknown;
    try {
      TB.writeTrackerSubsection(join(root, "CLAUDE.md"), "jira", { project: "SYN", shared: { repoTag: "syn-be" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TB.TrackerBindingWriteError);
    expect(String((err as Error).message)).toContain("## Project Settings");
    expect(readFileSync(join(root, "specs/settings.yaml"), "utf8")).toBe(SETTINGS);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(md);
  });
});

describe("the move refuses, never throws, on a value it cannot read (review pass 1, finding 3)", () => {
  test("a malformed ## Docs value returns an NFR-10 refusal with nothing written", async () => {
    const { MIGRATIONS } = require("../adapters/_shared/src/migrations/index") as typeof import("../adapters/_shared/src/migrations/index");
    const entry = MIGRATIONS.find((e) => e.id === "settings-file")!;
    const md = "# Synthetic\n\n## Docs\n\nuser_facing_mode: yes\npackages_mode: false\nchangelog_ci_owned: false\n";
    const root = tree({ "CLAUDE.md": md });
    await asRelease(async () => {
      const res = await entry.apply(root);
      expect(res.changed).toEqual([]);
      expect(res.summary).toMatch(/^Refusing: /);
      expect(res.summary).toContain("user_facing_mode");
      expect(res.summary).toMatch(/\nRemedy: /);
      expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(md);
      expect(require("node:fs").existsSync(join(root, "specs/settings.yaml"))).toBe(false);
    });
  });
});

describe("review minors", () => {
  const SETTINGS_MIN = "schema_version: 1\nmin_dpt_version: \"2.0.0\"\nverification:\n  verify_mode: manual\n";

  test("a CLAUDE.md ## Verification holding only e2e_cmd beside a settings file is a second home (digit keys count)", () => {
    const PS = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const root = tree({ "specs/settings.yaml": SETTINGS_MIN, "CLAUDE.md": "# Synthetic\n\n## Verification\n\ne2e_cmd: bun run e2e\n" });
    expect(PS.detectSettingsSource(root)).toBe("both");
  });

  test("a CLAUDE.md line named like an Object.prototype member does not hide a leftover legacy file", () => {
    const PS = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const root = tree({
      "specs/settings.yaml": SETTINGS_MIN,
      "CLAUDE.md": "# Synthetic\n\nconstructor\n",
      "specs/tracker-config.yaml": "tracker_key: linear\n",
    });
    expect(PS.detectSettingsSource(root)).toBe("both");
  });

  test("`project_settings.ts get <unknown>` refuses in NFR-10 shape and exits non-zero", () => {
    const root = tree({ "specs/settings.yaml": SETTINGS_MIN, "CLAUDE.md": "# Synthetic\n" });
    const r = Bun.spawnSync(["bun", "run", join(SRC_DIR, "project_settings.ts"), "get", "bogus", root], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout.toString()).toBe("");
    expect(r.stderr.toString()).toMatch(/^Refusing: `bogus` is not a settings section/);
  });

  test("control: `get verification` still prints the section and exits 0", () => {
    const root = tree({ "specs/settings.yaml": SETTINGS_MIN, "CLAUDE.md": "# Synthetic\n" });
    const r = Bun.spawnSync(["bun", "run", join(SRC_DIR, "project_settings.ts"), "get", "verification", root], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("\"verify_mode\": \"manual\"");
  });

  async function probe22(settingsBody: string): Promise<string> {
    const { runToolkitBootstrapCommittedProbe } = require("../adapters/_shared/src/toolkit_bootstrap_committed") as typeof import("../adapters/_shared/src/toolkit_bootstrap_committed");
    const { SETUP_MARKER } = require("../adapters/_shared/src/toolkit_managed") as typeof import("../adapters/_shared/src/toolkit_managed");
    const root = tree({ "CLAUDE.md": `${SETUP_MARKER}\n# Synthetic\n` });
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", root, ...a], { stdout: "pipe", stderr: "pipe" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.email=s@example.invalid", "-c", "user.name=s", "commit", "-qm", "init");
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs/settings.yaml"), settingsBody);
    return JSON.stringify(await runToolkitBootstrapCommittedProbe(root));
  }

  test("probe #22 does not ask a marker-managed tree to commit another tool's specs/settings.yaml", async () => {
    expect(await probe22("theme: dark\n")).not.toContain("settings.yaml");
  });

  test("control: probe #22 still names an uncommitted toolkit settings file", async () => {
    expect(await probe22(SETTINGS_MIN)).toContain("settings.yaml");
  });
});

describe("the version floor is checked before the closed top-level key set (review pass 2, finding 1)", () => {
  test("a file from a newer toolkit, with a top-level key this one does not know, refuses with the upgrade remedy", () => {
    const PS = require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");
    const root = tree({ "specs/settings.yaml": "schema_version: 1\nmin_dpt_version: \"99.0.0\"\nfuture_section:\n  on: true\n", "CLAUDE.md": "# Synthetic\n" });
    let msg = "";
    try {
      PS.loadProjectSettings(root);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("below specs/settings.yaml's min_dpt_version 99.0.0");
    expect(msg).toContain("upgrade the dev-process-toolkit plugin");
  });
});

describe("the writer never writes a file that means something else (review pass 1, finding 6)", () => {
  const W = () => require("../adapters/_shared/src/project_settings_writer") as typeof import("../adapters/_shared/src/project_settings_writer");
  const PS = () => require("../adapters/_shared/src/project_settings") as typeof import("../adapters/_shared/src/project_settings");

  test("removing the only child of a block map refuses and leaves the file byte-identical, still loadable", () => {
    const body = "schema_version: 1\nmin_dpt_version: \"2.0.0\"\nclose_out:\n  upgrade_offer:\n    enabled: true\n";
    const root = tree({ "specs/settings.yaml": body, "CLAUDE.md": "# Synthetic\n" });
    expect(() => W().writeProjectSettings(root, { close_out: { upgrade_offer: { enabled: undefined } } })).toThrow(/cannot take this update in place/);
    expect(readFileSync(join(root, "specs/settings.yaml"), "utf8")).toBe(body);
    expect(() => PS().loadProjectSettings(root)).not.toThrow();
  });

  test("an update to a quoted key refuses rather than adding a duplicate key", () => {
    const body = "schema_version: 1\nmin_dpt_version: \"2.0.0\"\n\"verification\":\n  verify_mode: manual\n";
    const root = tree({ "specs/settings.yaml": body, "CLAUDE.md": "# Synthetic\n" });
    expect(() => W().writeProjectSettings(root, { verification: { verify_mode: "blocking" } })).toThrow(/cannot take this update in place/);
    expect(readFileSync(join(root, "specs/settings.yaml"), "utf8")).toBe(body);
  });

  test("control: a plain in-place edit still writes", () => {
    const body = "schema_version: 1\nmin_dpt_version: \"2.0.0\"\nverification:\n  verify_mode: manual\n";
    const root = tree({ "specs/settings.yaml": body, "CLAUDE.md": "# Synthetic\n" });
    W().writeProjectSettings(root, { verification: { verify_mode: "blocking" } });
    expect(readFileSync(join(root, "specs/settings.yaml"), "utf8")).toContain("verify_mode: blocking");
  });
});
