// STE-716 (M_7bc805) AC.16-.21 — registration of the opt-in capture hook.
//
// Module under test: adapters/_shared/src/capture_registration.ts, driven through
// its front door (`bun run capture_registration.ts status|register|unregister
// <root>`) and its pure exports (`renderCaptureHookCommand`,
// `checkRegisterPreconditions`, `isCaptureHookCommand`). The running
// installed-plugins record is `$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json`;
// every row points CLAUDE_CONFIG_DIR at a temp dir. The migration entry
// `capture-registration` is graded in-process over the live registry.
//
// All names, paths and ids are synthetic.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { MIGRATIONS, validateRegistry } from "../adapters/_shared/src/migrations/index";
import { runUpgradeStalenessProbe } from "../adapters/_shared/src/upgrade_staleness";
import { readSpecFile } from "./_spec_tree";
import {
  CR,
  GIT_ENV,
  PLUGIN_REAL,
  PLUGIN_REL,
  PLUGIN_ROOT,
  REPO_ROOT,
  RUNNING_VERSION,
  WRAPPER_REL,
  atV300,
  cleanupTemps,
  configDir,
  git,
  ledgerDir,
  ledgerRows,
  makeCheckout,
  parseStatus,
  payload,
  recordFor,
  recordPathOf,
  refusalText,
  runRegistration,
  runShell,
  setCaptureState,
  shimDir,
  tempDir,
  withGitEnv,
  withPath,
  writeRecord,
} from "./_m_7bc805_capture_fixture";

const T = 120_000;
afterAll(cleanupTemps);

const LOCAL = ".claude/settings.local.json";
const NEEDLE = "templates/hooks/process/tool-call-capture.sh";

const ENV_BLOCK = { SYNTHETIC_FLAG: "1", SYNTHETIC_MODE: "fixture" };
const UNRELATED_GROUP = { matcher: "Edit", hooks: [{ type: "command", command: "echo synthetic-unrelated-hook" }] };
const ORIGINAL_LOCAL = { env: ENV_BLOCK, hooks: { PreToolUse: [UNRELATED_GROUP] } };
const SHARED_SETTINGS = `${JSON.stringify({ permissions: { allow: ["Bash(bun *)"] } }, null, 2)}\n`;

/** A checkout with the setting on, the local file ignored and untracked, holding an env block and one unrelated hook. */
function registrable(label: string, opts: { state?: "on" | "false" | "absent" | "foreign"; ignore?: boolean; local?: string | null } = {}): string {
  const root = makeCheckout(label, opts.state ?? "on", {
    gitignore: opts.ignore === false ? "ignored.log\n" : `ignored.log\n${LOCAL}\n`,
    files: { ".claude/settings.json": SHARED_SETTINGS },
  });
  const local = opts.local === undefined ? `${JSON.stringify(ORIGINAL_LOCAL, null, 2)}\n` : opts.local;
  if (local !== null) writeFileSync(join(root, LOCAL), local);
  return root;
}

function readLocal(root: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, LOCAL), "utf-8")) as Record<string, any>;
}

function captureEntries(groups: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g) => ((g as { hooks?: unknown[] }).hooks ?? []) as Array<Record<string, unknown>>).filter(
    (h) => typeof h.command === "string" && (h.command as string).includes(NEEDLE),
  );
}

/** Every working-tree file outside .git, by bytes. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (dir === root && name === ".git") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = readFileSync(p, "latin1");
    }
  };
  walk(root);
  return out;
}

function nfr10(text: string): void {
  expect(text).toMatch(/^Refusing: /m);
  expect(text).toMatch(/^Remedy: /m);
  expect(text).toMatch(/^Context: /m);
}

async function renderReal(cfg: string): Promise<string> {
  return (await CR()).renderCaptureHookCommand({ pluginRoot: PLUGIN_REAL, version: RUNNING_VERSION, installedPlugins: recordPathOf(cfg) });
}

/** Write a local settings file holding `commands` as capture entries, one group per event. */
function writeCaptureLocal(root: string, commands: string[], extra: Record<string, unknown> = {}): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  const group = { matcher: "Bash|Skill", hooks: commands.map((command) => ({ type: "command", command, timeout: 2 })) };
  writeFileSync(join(root, LOCAL), `${JSON.stringify({ ...extra, hooks: { PreToolUse: [group], PostToolUse: [group] } }, null, 2)}\n`);
}

// ===========================================================================
// AC-STE-716.16 — register
// ===========================================================================

describe("AC-STE-716.16 register", () => {
  test("register writes one capture entry per event with timeout 2 and the rendered command; env and the unrelated hook stay; status current + pass", async () => {
    const root = registrable("reg");
    const { cfg } = recordFor("reg-rec", root);
    const sharedBefore = readFileSync(join(root, ".claude", "settings.json"), "utf-8");
    const r = runRegistration("register", root, { cfg });
    expect({ exitCode: r.exitCode, stderr: r.stderr }).toEqual({ exitCode: 0, stderr: "" });

    const after = readLocal(root);
    const expected = await renderReal(cfg);
    expect(expected).toContain(PLUGIN_REAL);
    for (const ev of ["PreToolUse", "PostToolUse"]) {
      const entries = captureEntries(after.hooks?.[ev]);
      expect({ ev, n: entries.length }).toEqual({ ev, n: 1 });
      expect(entries[0]!.timeout).toBe(2);
      expect(entries[0]!.command).toBe(expected);
      const group = (after.hooks[ev] as Array<Record<string, any>>).find((g) => captureEntries([g]).length === 1)!;
      expect(group.matcher).toBe("Bash|Skill");
    }
    expect(after.env).toEqual(ENV_BLOCK);
    expect(Object.keys(after)).toEqual(["env", "hooks"]);
    expect(after.hooks.PreToolUse[0]).toEqual(UNRELATED_GROUP);
    expect(readFileSync(join(root, ".claude", "settings.json"), "utf-8")).toBe(sharedBefore);

    const st = runRegistration("status", root, { cfg });
    expect(st.exitCode).toBe(0);
    expect(parseStatus(st.stdout)).toEqual({ setting: "on", registration: "current", guard: "pass" });

    const bytes = readFileSync(join(root, LOCAL), "utf-8");
    expect(runRegistration("register", root, { cfg }).exitCode).toBe(0);
    expect(readFileSync(join(root, LOCAL), "utf-8")).toBe(bytes);
  }, T);

  test("register creates the local file when absent and status reads it current", async () => {
    const root = registrable("reg-absent", { local: null });
    const { cfg } = recordFor("reg-absent-rec", root);
    expect(runRegistration("register", root, { cfg }).exitCode).toBe(0);
    for (const ev of ["PreToolUse", "PostToolUse"]) expect(captureEntries(readLocal(root).hooks?.[ev]).length).toBe(1);
    expect(parseStatus(runRegistration("status", root, { cfg }).stdout).registration).toBe("current");
  }, T);

  test("status is read-only and prints setting: off, registration: none on a default tree", () => {
    const root = registrable("status-default", { state: "absent", local: null });
    const { cfg } = recordFor("status-default-rec", root);
    const before = snapshot(root);
    const st = runRegistration("status", root, { cfg });
    expect(st.exitCode).toBe(0);
    expect(parseStatus(st.stdout)).toMatchObject({ setting: "off", registration: "none" });
    expect(snapshot(root)).toEqual(before);
  }, T);

  test("status reads stale for an entry whose command differs from the render, and for an entry with the setting off", async () => {
    const root = registrable("status-stale", { local: null });
    const { cfg } = recordFor("status-stale-rec", root);
    const old = (await CR()).renderCaptureHookCommand({ pluginRoot: PLUGIN_REAL, version: "0.0.1", installedPlugins: recordPathOf(cfg) });
    writeCaptureLocal(root, [old]);
    expect(parseStatus(runRegistration("status", root, { cfg }).stdout).registration).toBe("stale");
    writeCaptureLocal(root, [await renderReal(cfg)]);
    expect(parseStatus(runRegistration("status", root, { cfg }).stdout).registration).toBe("current"); // CONTROL
    setCaptureState(root, "absent");
    expect(parseStatus(runRegistration("status", root, { cfg }).stdout)).toMatchObject({ setting: "off", registration: "stale" });
  }, T);
});

// ===========================================================================
// AC-STE-716.17 — register refusals
// ===========================================================================

describe("AC-STE-716.17 register refusals", () => {
  // The tracked-by-git refusal's own wording (capture_registration.ts): a tracked
  // local file also fails `git check-ignore`, so exit 1 alone cannot tell the two apart.
  const TRACKED_REFUSAL = `Refusing: ${LOCAL} is tracked by git;`;
  const TRACKED_REMEDY = `git rm --cached ${LOCAL}`;
  const ROWS: Array<{ name: string; build: () => string; check?: (out: string) => void; refusal?: string[] }> = [
    { name: "register refuses: the setting off", build: () => registrable("ref-off", { state: "false" }) },
    {
      name: "register refuses: the local settings file tracked by git",
      build: () => {
        const root = registrable("ref-tracked");
        git(root, "add", "-f", LOCAL);
        git(root, "commit", "-q", "-m", "track the local file");
        return root;
      },
      check: (out) => {
        expect(out).toContain(TRACKED_REFUSAL);
        expect(out).toContain(TRACKED_REMEDY);
      },
      refusal: [TRACKED_REFUSAL, TRACKED_REMEDY],
    },
    {
      name: "register refuses: the file not ignored",
      build: () => registrable("ref-unignored", { ignore: false }),
      check: (out) => {
        expect(out.split("\n").some((l) => l.trim() === LOCAL || l.includes(`\`${LOCAL}\``) || l.includes(`'${LOCAL}'`) || l.includes(`"${LOCAL}"`))).toBe(true);
        expect(out).toContain(".gitignore");
      },
    },
    { name: "register refuses: the file holding a JSON array", build: () => registrable("ref-array", { local: "[]\n" }) },
  ];

  for (const row of ROWS) {
    test(row.name, async () => {
      const root = row.build();
      const { cfg } = recordFor("ref-rec", root);
      const before = snapshot(root);
      const r = runRegistration("register", root, { cfg });
      const out = `${r.stdout}${r.stderr}`;
      expect(r.exitCode).toBe(1);
      nfr10(out);
      row.check?.(out);
      expect(snapshot(root)).toEqual(before);

      // checkRegisterPreconditions returns the same refusals, with no write.
      const m = await CR();
      const settingOn = row.name !== "register refuses: the setting off";
      const refusals = withGitEnv(() => m.checkRegisterPreconditions(root, { settingOn })) as unknown[];
      expect(Array.isArray(refusals)).toBe(true);
      expect(refusals.length).toBeGreaterThan(0);
      if (row.refusal) {
        const texts = refusals.map((ref) => refusalText(ref));
        expect(texts.some((t) => row.refusal!.every((needle) => t.includes(needle)))).toBe(true);
      }
      for (const ref of refusals) {
        const first = refusalText(ref).split("\n").find((l) => l.startsWith("Refusing: "));
        expect(first).toBeDefined();
        expect(out).toContain(first!);
      }
      expect(snapshot(root)).toEqual(before);
      if (!settingOn) {
        // With settingOn: true the setting-off refusal is omitted (STE-728's pre-write check).
        expect(withGitEnv(() => m.checkRegisterPreconditions(root, { settingOn: true }))).toEqual([]);
      }
    }, T);
  }

  test("CONTROL: checkRegisterPreconditions on a registrable tree returns no refusal", async () => {
    const root = registrable("ref-ok");
    const m = await CR();
    expect(withGitEnv(() => m.checkRegisterPreconditions(root, { settingOn: true }))).toEqual([]);
  }, T);
});

// ===========================================================================
// AC-STE-716.18 — unregister
// ===========================================================================

describe("AC-STE-716.18 unregister", () => {
  test("unregister removes only capture entries and the groups they empty; status prints registration: none", () => {
    const root = registrable("unreg");
    const { cfg } = recordFor("unreg-rec", root);
    expect(runRegistration("register", root, { cfg }).exitCode).toBe(0);
    expect(runRegistration("unregister", root, { cfg }).exitCode).toBe(0);
    const after = readLocal(root);
    expect(after.env).toEqual(ENV_BLOCK);
    expect(Object.keys(after)[0]).toBe("env");
    expect(after.hooks.PreToolUse).toEqual([UNRELATED_GROUP]);
    expect(after.hooks.PostToolUse === undefined || (Array.isArray(after.hooks.PostToolUse) && after.hooks.PostToolUse.length === 0)).toBe(true);
    expect(captureEntries(after.hooks.PreToolUse).length + captureEntries(after.hooks.PostToolUse).length).toBe(0);
    expect(parseStatus(runRegistration("status", root, { cfg }).stdout).registration).toBe("none");
  }, T);

  test("unregister keeps a group that still holds another hook beside a capture entry", async () => {
    const root = registrable("unreg-shared", { local: null });
    const { cfg } = recordFor("unreg-shared-rec", root);
    const cmd = await renderReal(cfg);
    const group = { matcher: "Bash|Skill", hooks: [{ type: "command", command: cmd, timeout: 2 }, { type: "command", command: "echo synthetic-kept" }] };
    writeFileSync(join(root, LOCAL), `${JSON.stringify({ hooks: { PreToolUse: [group] }, statusLine: { type: "command", command: "echo s" } }, null, 2)}\n`);
    expect(runRegistration("unregister", root, { cfg }).exitCode).toBe(0);
    const after = readLocal(root);
    expect(after.hooks.PreToolUse).toEqual([{ matcher: "Bash|Skill", hooks: [{ type: "command", command: "echo synthetic-kept" }] }]);
    expect(after.statusLine).toEqual({ type: "command", command: "echo s" });
    expect(Object.keys(after)).toEqual(["hooks", "statusLine"]);
  }, T);

  test("unregister on a file with no capture entry writes nothing", () => {
    const root = registrable("unreg-none");
    const { cfg } = recordFor("unreg-none-rec", root);
    const file = join(root, LOCAL);
    const bytes = readFileSync(file, "utf-8");
    const mtime = statSync(file).mtimeMs;
    expect(runRegistration("unregister", root, { cfg }).exitCode).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(bytes);
    expect(statSync(file).mtimeMs).toBe(mtime);
  }, T);
});

// ===========================================================================
// AC-STE-716.19 — the shell guard
// ===========================================================================

const SYN_ROOT = "/opt/synthetic/plugins/cache/dpt/3.1.0";
const SYN_RECORD = "/opt/synthetic/config/plugins/installed_plugins.json";
// Amended by AC-STE-716.19 (M_7bc805): design fix — guard greps are silent on a missing file
const PINNED =
  `[ -f "$CLAUDE_PROJECT_DIR/specs/settings.yaml" ] && grep -qs 'tool_calls' "$CLAUDE_PROJECT_DIR/specs/settings.yaml" && ` +
  `grep -qsF '"${SYN_ROOT}"' '${SYN_RECORD}' && grep -qsF '"version": "3.1.0"' '${SYN_ROOT}/.claude-plugin/plugin.json' && ` +
  `[ -x '${SYN_ROOT}/templates/hooks/process/tool-call-capture.sh' ] && ` +
  `CLAUDE_PLUGIN_ROOT='${SYN_ROOT}' exec '${SYN_ROOT}/templates/hooks/process/tool-call-capture.sh' '${SYN_RECORD}'; exit 0`;

/** A fake plugin root: a manifest naming `version` and the real wrapper, executable. */
function fakePluginRoot(label: string, version: string): string {
  const root = join(tempDir(label), "plugin");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "templates", "hooks", "process"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: "dev-process-toolkit", version }, null, 2)}\n`);
  copyFileSync(join(PLUGIN_ROOT, WRAPPER_REL), join(root, WRAPPER_REL));
  chmodSync(join(root, WRAPPER_REL), 0o755);
  return realpathSync(root);
}

describe("AC-STE-716.19 the shell guard", () => {
  test("renderCaptureHookCommand over a synthetic root, version and record path is byte-equal to the pinned string", async () => {
    const m = await CR();
    expect(m.renderCaptureHookCommand({ pluginRoot: SYN_ROOT, version: "3.1.0", installedPlugins: SYN_RECORD })).toBe(PINNED);
    expect(m.isCaptureHookCommand(PINNED)).toBe(true);
    expect(m.isCaptureHookCommand("echo synthetic-unrelated-hook")).toBe(false);
  });

  test("each failing check exits 0 silent and never starts bun; with every check passing bun starts", async () => {
    const m = await CR();
    const VERSION = "9.9.9";
    const fake = fakePluginRoot("guard-root", VERSION);
    const marker = join(tempDir("guard-out"), "bun.ran");
    const shims = shimDir("guard-shim", "bun", marker, { exit: 0 });
    const render = (o: { pluginRoot?: string; version?: string; installedPlugins: string }): string =>
      m.renderCaptureHookCommand({ pluginRoot: o.pluginRoot ?? fake, version: o.version ?? VERSION, installedPlugins: o.installedPlugins });
    const on = makeCheckout("guard-on", "on");
    const absent = makeCheckout("guard-absent", "absent");
    const recordWith = (label: string, root: string, installPath: string): string =>
      writeRecord(configDir(label), [{ scope: "project", projectPath: root, installPath, version: VERSION }]);

    const rows: Array<[string, string, string]> = [
      ["the settings file lacks tool_calls", render({ installedPlugins: recordWith("g1", absent, fake) }), absent],
      ["the plugin path is missing", render({ pluginRoot: `${fake}-gone`, installedPlugins: recordWith("g2", on, `${fake}-gone`) }), on],
      ["the record lists only a newer root", render({ installedPlugins: recordWith("g3", on, `${fake}-newer`) }), on],
      ["the root's manifest names another version", render({ version: "9.9.8", installedPlugins: recordWith("g4", on, fake) }), on],
      ["the record file is absent", render({ installedPlugins: join(tempDir("g5"), "missing.json") }), on],
    ];
    for (const [label, command, root] of rows) {
      const r = runShell(command, { projectDir: root, env: withPath(shims) });
      expect({ label, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, bun: existsSync(marker) }).toEqual({
        label,
        exitCode: 0,
        stdout: "",
        stderr: "",
        bun: false,
      });
    }
    const pass = runShell(render({ installedPlugins: recordWith("g6", on, fake) }), { projectDir: on, env: withPath(shims) });
    expect(pass.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(true);
  }, T);

  test("the record lists the old root for another projectPath and a newer root for this checkout: guard passes, hook writes nothing, status guard: fail", async () => {
    const root = registrable("pin-old");
    const cfg = configDir("pin-old-cfg");
    writeRecord(cfg, [
      { scope: "project", projectPath: "/synthetic/another-project", installPath: PLUGIN_REAL, version: RUNNING_VERSION },
      { scope: "project", projectPath: root, installPath: "/synthetic/plugins/cache/dpt/9.9.9", version: "9.9.9" },
    ]);
    const command = await renderReal(cfg);
    const stdin = JSON.stringify(payload({ event: "pre", tool: "Bash", cwd: root, command: "ls" }));

    // CONTROL: the shell guard passes (a bun shim on PATH is reached).
    const marker = join(tempDir("pin-old-out"), "bun.ran");
    runShell(command, { projectDir: root, stdin, env: withPath(shimDir("pin-old-shim", "bun", marker, { exit: 0 })) });
    expect(existsSync(marker)).toBe(true);

    const r = runShell(command, { projectDir: root, stdin });
    expect({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(existsSync(ledgerDir(root))).toBe(false);

    expect(parseStatus(runRegistration("status", root, { cfg }).stdout).guard).toBe("fail");
  }, T);

  test("a record with no entry for the checkout but a user-scope entry naming the root writes rows", async () => {
    const root = registrable("pin-user");
    const cfg = configDir("pin-user-cfg");
    writeRecord(cfg, [{ scope: "user", installPath: PLUGIN_REAL, version: RUNNING_VERSION }]);
    const command = await renderReal(cfg);
    const r = runShell(command, { projectDir: root, stdin: JSON.stringify(payload({ event: "pre", tool: "Bash", cwd: root, command: "ls" })) });
    expect({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(ledgerRows(root).length).toBe(1);
    expect(parseStatus(runRegistration("status", root, { cfg }).stdout).guard).toBe("pass");
  }, T);
});

// ===========================================================================
// AC-STE-716.20 — the migration entry
// ===========================================================================

describe("AC-STE-716.20 the capture-registration migration", () => {
  const entry = () => MIGRATIONS.find((e) => e.id === "capture-registration");
  const saved = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  });
  function useRecord(label: string, root: string): string {
    const { cfg } = recordFor(label, root);
    process.env.CLAUDE_CONFIG_DIR = cfg;
    return cfg;
  }

  test("the entry: id, introduced_in 3.1.0, kind script, explicit approval, right after settings-file; validateRegistry passes", () => {
    const e = entry();
    expect(e).toBeDefined();
    expect(e!.introduced_in).toBe("3.1.0");
    expect(e!.kind).toBe("script");
    expect(e!.requires_explicit_approval).toBe(true);
    expect(typeof e!.apply).toBe("function");
    const ids = MIGRATIONS.map((x) => x.id);
    expect(ids.indexOf("capture-registration")).toBe(ids.indexOf("settings-file") + 1);
    expect(() => validateRegistry(MIGRATIONS)).not.toThrow();
    expect(existsSync(join(PLUGIN_ROOT, "adapters", "_shared", "src", "migrations", "entries", "capture_registration.ts"))).toBe(true);
  });

  test("detect applies on (setting on, no entry); apply registers; a second detect reports applies: false", () => {
    const root = registrable("mig-on-none", { local: null });
    useRecord("mig-on-none-rec", root);
    expect(entry()!.detect(root).applies).toBe(true);
    entry()!.apply!(root);
    for (const ev of ["PreToolUse", "PostToolUse"]) expect(captureEntries(readLocal(root).hooks?.[ev]).length).toBe(1);
    expect(entry()!.detect(root).applies).toBe(false);
  }, T);

  test("detect applies on (setting on, stale entry); apply re-registers; a second detect reports applies: false", async () => {
    const root = registrable("mig-on-stale", { local: null });
    const cfg = useRecord("mig-on-stale-rec", root);
    const stale = (await CR()).renderCaptureHookCommand({ pluginRoot: PLUGIN_REAL, version: "0.0.1", installedPlugins: recordPathOf(cfg) });
    writeCaptureLocal(root, [stale]);
    expect(entry()!.detect(root).applies).toBe(true);
    entry()!.apply!(root);
    const pre = captureEntries(readLocal(root).hooks.PreToolUse);
    expect(pre.map((h) => h.command)).toEqual([await renderReal(cfg)]);
    expect(entry()!.detect(root).applies).toBe(false);
  }, T);

  test("detect applies on (key absent, entry present); apply unregisters; a second detect reports applies: false", async () => {
    const root = registrable("mig-absent-entry", { state: "absent", local: null });
    const cfg = useRecord("mig-absent-entry-rec", root);
    writeCaptureLocal(root, [await renderReal(cfg)], { env: ENV_BLOCK });
    expect(entry()!.detect(root).applies).toBe(true);
    entry()!.apply!(root);
    const after = readLocal(root);
    expect(captureEntries(after.hooks?.PreToolUse).length + captureEntries(after.hooks?.PostToolUse).length).toBe(0);
    expect(after.env).toEqual(ENV_BLOCK);
    expect(entry()!.detect(root).applies).toBe(false);
  }, T);

  test("detect applies on (key committed on but removed in the working tree, entry present); apply unregisters and leaves specs/settings.yaml byte-identical", async () => {
    const root = registrable("mig-local-removed", { local: null });
    const cfg = useRecord("mig-local-removed-rec", root);
    expect(git(root, "show", "HEAD:specs/settings.yaml")).toContain("tool_calls"); // committed on
    writeCaptureLocal(root, [await renderReal(cfg)]);
    setCaptureState(root, "absent"); // removed locally, not committed
    const settingsBefore = readFileSync(join(root, "specs", "settings.yaml"), "utf-8");
    expect(entry()!.detect(root).applies).toBe(true);
    entry()!.apply!(root);
    expect(readFileSync(join(root, "specs", "settings.yaml"), "utf-8")).toBe(settingsBefore);
    expect(git(root, "show", "HEAD:specs/settings.yaml")).toContain("tool_calls"); // never committed or restored
    const after = readLocal(root);
    expect(captureEntries(after.hooks?.PreToolUse).length + captureEntries(after.hooks?.PostToolUse).length).toBe(0);
    expect(entry()!.detect(root).applies).toBe(false);
  }, T);

  test("detect does not apply on (key absent, no entry), (setting on, current entry) or (foreign settings file holding tool_calls on, no entry)", async () => {
    const a = registrable("mig-quiet-absent", { state: "absent", local: null });
    useRecord("mig-quiet-absent-rec", a);
    expect(entry()!.detect(a).applies).toBe(false);

    const b = registrable("mig-quiet-current", { local: null });
    const cfg = useRecord("mig-quiet-current-rec", b);
    writeCaptureLocal(b, [await renderReal(cfg)]);
    expect(entry()!.detect(b).applies).toBe(false);

    const c = registrable("mig-quiet-foreign", { state: "foreign", local: null });
    useRecord("mig-quiet-foreign-rec", c);
    expect(readFileSync(join(c, "specs", "settings.yaml"), "utf-8")).toContain("tool_calls"); // CONTROL: the byte prefilter would pass
    expect(entry()!.detect(c).applies).toBe(false);
  }, T);

  test("on a default fixture probe #69 renders no capture-registration row", async () => {
    const root = registrable("mig-default", { state: "absent", local: null });
    useRecord("mig-default-rec", root);
    const r = await runUpgradeStalenessProbe(root);
    expect(r.rows.filter((row) => row.startsWith("capture-registration ("))).toEqual([]);
  }, T);

  test("docs/upgrade-reference.md lists the capture-registration entry", () => {
    expect(readFileSync(join(PLUGIN_ROOT, "docs", "upgrade-reference.md"), "utf-8")).toContain("capture-registration");
  });
});

// ===========================================================================
// AC-STE-716.21 — the teammate row
// ===========================================================================

function verdict(r: { notes: string[]; violations: unknown[] }): string {
  if (r.violations.length > 0) return "GATE FAILED";
  return r.notes.length > 0 ? "GATE PASSED WITH NOTES" : "GATE PASSED";
}

describe("AC-STE-716.21 the teammate row", () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  });

  test("a committed switch with no registration gets one warn-only capture-registration row and GATE PASSED WITH NOTES; the off fixture reads GATE PASSED", async () => {
    const teammate = makeCheckout("mate-on", "on");
    const off = makeCheckout("mate-off", "absent");
    process.env.CLAUDE_CONFIG_DIR = recordFor("mate-rec", teammate).cfg;
    const before = snapshot(teammate);
    const on = await runUpgradeStalenessProbe(teammate);
    const base = await runUpgradeStalenessProbe(off);
    const row = on.rows.filter((r) => r.startsWith("capture-registration (3.1.0): "));
    expect(row.length).toBe(1);
    expect(on.violations).toEqual([]);
    expect(on.rows.filter((r) => !r.startsWith("capture-registration ("))).toEqual(base.rows);
    expect(verdict(on)).toBe("GATE PASSED WITH NOTES");
    expect(verdict(base)).toBe("GATE PASSED");
    expect(snapshot(teammate)).toEqual(before);
    expect(existsSync(join(teammate, ".claude", "settings.local.json"))).toBe(false);
    expect(readFileSync(join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf-8")).toBe(atV300(`${PLUGIN_REL}/hooks/hooks.json`));
  }, T);

  test("the session-token-ledger hook writes no timeline file on the teammate tree", () => {
    const teammate = makeCheckout("mate-ledger", "on");
    const transcript = join(tempDir("mate-tr"), "t.jsonl");
    writeFileSync(transcript, "");
    const p = spawnSync("/bin/bash", [join(PLUGIN_ROOT, "templates", "hooks", "process", "session-token-ledger.sh")], {
      cwd: teammate,
      input: JSON.stringify({ session_id: "00000000-0000-4000-8000-000000000716", transcript_path: transcript, cwd: teammate, hook_event_name: "SessionEnd" }),
      encoding: "utf-8",
      env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    });
    expect(p.status).toBe(0);
    expect(existsSync(ledgerDir(teammate))).toBe(false);
  }, T);

  const DEFAULTS_TEST = join(PLUGIN_ROOT, "tests", "m_7bc805-defaults-unchanged.test.ts");
  if (existsSync(DEFAULTS_TEST)) {
    test("the M_7bc805 defaults test lists the capture-registration row and the verdict line as its allowed difference", () => {
      const src = readFileSync(DEFAULTS_TEST, "utf-8");
      expect(src).toContain("capture-registration");
      expect(src).toContain("GATE PASSED WITH NOTES");
    });
  } else {
    // The defaults test is STE-717's file (the milestone's last FR); until it lands,
    // the spec that owns it must name the allowed difference.
    test("the M_7bc805 defaults test is not yet written: STE-717 names the capture-registration row and the verdict line as its allowed difference", () => {
      const fr = readSpecFile(REPO_ROOT, "specs/frs", "STE-717.md").body;
      expect(fr).toContain("capture-registration");
      expect(fr).toContain("GATE PASSED WITH NOTES");
    });
  }
});
