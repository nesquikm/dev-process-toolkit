// STE-716 (M_7bc805) shared fixture helper — the opt-in tool-call capture hook.
//
// Leading underscore: a helper module, never collected as a suite.
//
// The shapes these suites assume (the FR's Requirement is the design):
//
//   templates/hooks/process/tool-call-capture.sh   the wrapper; `exec bun run
//       "${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/tool-call-capture.ts" "$@"`
//   templates/hooks/_lib/hooks/tool-call-capture.ts  the entry module; argv[2] is
//       the installed-plugins record path (the registered command passes it)
//   adapters/_shared/src/capture_registration.ts   the front door:
//       `bun run capture_registration.ts status|register|unregister <root>`
//       exports renderCaptureHookCommand, isCaptureHookCommand, dropCaptureEntries,
//       checkRegisterPreconditions
//   The running installed-plugins record is `<config dir>/plugins/installed_plugins.json`,
//   where `<config dir>` is `$CLAUDE_CONFIG_DIR` (else `~/.claude`). Every suite
//   sets CLAUDE_CONFIG_DIR to a temp dir, so no real record is ever read.
//
// The record is Claude Code's own file: `{ version: 2, plugins: { "<name>@<market>":
// [ { scope, projectPath?, installPath, version, ... } ] } }`, written with a
// two-space indent (so `"installPath": "<root>"` is what the shell guard greps).
//
// All names, paths and ids are synthetic.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import { GIT_ENV as BASE_GIT_ENV, PLUGIN_ROOT, SETTINGS_HEAD, tempDir } from "./_m_7bc805_gate_outcome_fixture";

/**
 * An empty XDG config home. GIT_CONFIG_GLOBAL=/dev/null does not stop git
 * reading `$XDG_CONFIG_HOME/git/ignore` (default `~/.config/git/ignore`), the
 * default `core.excludesFile`; a maintainer's global ignore there can ignore
 * `.claude/settings.local.json` and hide the "not ignored" refusal. Every git
 * spawn here and in the CLIs the fixture runs gets this dir, and
 * `core.excludesFile` is forced to /dev/null, so ignore state is the tree's own.
 */
const XDG_EMPTY = mkdtempSync(join(tmpdir(), "m7bc805-xdg-empty-"));
process.on("exit", () => rmSync(XDG_EMPTY, { recursive: true, force: true }));

export const GIT_ENV: Record<string, string> = {
  ...BASE_GIT_ENV,
  XDG_CONFIG_HOME: XDG_EMPTY,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.excludesFile",
  GIT_CONFIG_VALUE_0: "/dev/null",
};

export function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, ...GIT_ENV } });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

/** Run `fn` in-process with GIT_ENV applied to process.env (for pure exports that spawn git), then restore. */
export function withGitEnv<T>(fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(GIT_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = GIT_ENV[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export {
  PLUGIN_REL,
  PLUGIN_ROOT,
  REPO_ROOT,
  SETTINGS_HEAD,
  SRC,
  V300,
  atV300,
  cleanupTemps,
  pluginCopy,
  tempDir,
} from "./_m_7bc805_gate_outcome_fixture";

/** The plugin root as the filesystem sees it (what the record and the render name). */
export const PLUGIN_REAL = realpathSync(PLUGIN_ROOT);
export const WRAPPER_REL = "templates/hooks/process/tool-call-capture.sh";
export const ENTRY_REL = "templates/hooks/_lib/hooks/tool-call-capture.ts";
export const CAPTURE_MODULE_REL = "adapters/_shared/src/capture_registration.ts";
export const CAPTURE_MODULE = join(PLUGIN_ROOT, CAPTURE_MODULE_REL);
export const PLUGIN_KEY = "dev-process-toolkit@dev-process-toolkit";
export const RUNNING_VERSION = (JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8")) as {
  version: string;
}).version;

/** The closed row key set of `tool-call/v1` (D2 answered no: no `exit_code`). */
export const ROW_KEYS = ["schema", "event", "tool_use_id", "tool", "class", "skill", "ts", "tree", "diff", "scope"].sort();

export const TOOL_CALLS_ON = "tracking:\n  tool_calls:\n    enabled: true\n";
export const TOOL_CALLS_FALSE = "tracking:\n  tool_calls:\n    enabled: false\n";

export const REAL_GIT = (spawnSync("which", ["git"], { encoding: "utf-8" }).stdout ?? "").trim() || "/usr/bin/git";
export const REAL_BUN = (spawnSync("which", ["bun"], { encoding: "utf-8" }).stdout ?? "").trim() || "bun";

// ------------------------------------------------------------------- trees

/**
 * - `on`      — settings file, `tracking.tool_calls.enabled: true`
 * - `false`   — settings file, `enabled: false`
 * - `absent`  — settings file with no `tracking` key
 * - `foreign` — a settings file with no `min_dpt_version` (non-migrated tree) holding `tool_calls: { enabled: true }`
 * - `none`    — no settings file
 */
export type CaptureState = "on" | "false" | "absent" | "foreign" | "none";

export function captureSettingsFor(state: CaptureState): string | null {
  if (state === "on") return SETTINGS_HEAD + TOOL_CALLS_ON;
  if (state === "false") return SETTINGS_HEAD + TOOL_CALLS_FALSE;
  if (state === "absent") return SETTINGS_HEAD;
  if (state === "foreign") return `schema_version: 1\n${TOOL_CALLS_ON}`;
  return null;
}

export const CLAUDE_MD = "<!-- generated by /dev-process-toolkit:setup -->\n# Fixture\n\n## Key Commands\n\n- `bun test`\n";

/**
 * A git checkout (one commit) in the named switch state. `.dpt/.gitignore`
 * carries the unchanged DPT_GITIGNORE_BODY, so the ledger never moves the tree
 * digest. Returns the checkout's real path.
 */
export function makeCheckout(
  label: string,
  state: CaptureState,
  opts: { files?: Record<string, string>; gitignore?: string; branch?: string } = {},
): string {
  const root = join(tempDir(label), "repo");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", opts.branch ?? "main");
  writeFileSync(join(root, "CLAUDE.md"), CLAUDE_MD);
  writeFileSync(join(root, ".gitignore"), opts.gitignore ?? "ignored.log\n");
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), DPT_GITIGNORE_BODY);
  writeFileSync(join(root, "a.txt"), "one\ntwo\nthree\n");
  const settings = captureSettingsFor(state);
  if (settings !== null) {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", "settings.yaml"), settings);
  }
  for (const [rel, body] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return realpathSync(root);
}

/** Overwrite the checkout's settings file with the bytes of `state` (or delete-equivalent for `none`). */
export function setCaptureState(root: string, state: CaptureState): void {
  const body = captureSettingsFor(state);
  mkdirSync(join(root, "specs"), { recursive: true });
  if (body === null) spawnSync("rm", ["-f", join(root, "specs", "settings.yaml")]);
  else writeFileSync(join(root, "specs", "settings.yaml"), body);
}

// ------------------------------------------------------------------ record

export interface RecordEntry {
  scope: "user" | "project" | "local";
  projectPath?: string;
  installPath: string;
  version: string;
}

/** A temp Claude config dir; its record lives at `<dir>/plugins/installed_plugins.json`. */
export function configDir(label: string): string {
  const d = join(tempDir(label), "config");
  mkdirSync(join(d, "plugins"), { recursive: true });
  return realpathSync(d);
}

export function recordPathOf(cfg: string): string {
  return join(cfg, "plugins", "installed_plugins.json");
}

export function writeRecord(cfg: string, entries: RecordEntry[]): string {
  const path = recordPathOf(cfg);
  const plugins: Record<string, unknown[]> = {
    [PLUGIN_KEY]: entries.map((e) => ({
      ...e,
      installedAt: "2026-01-01T00:00:00.000Z",
      lastUpdated: "2026-01-01T00:00:00.000Z",
      gitCommitSha: "0000000000000000000000000000000000000000",
    })),
  };
  writeFileSync(path, `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`);
  return path;
}

/** A config dir whose record pins `pluginRoot` for this checkout (project scope). */
export function recordFor(label: string, root: string, pluginRoot = PLUGIN_REAL, version = RUNNING_VERSION): { cfg: string; record: string } {
  const cfg = configDir(label);
  const record = writeRecord(cfg, [{ scope: "project", projectPath: realpathSync(root), installPath: pluginRoot, version }]);
  return { cfg, record };
}

// ----------------------------------------------------------------- payloads

export interface PayloadSpec {
  event: "pre" | "post";
  tool: "Bash" | "Skill";
  cwd: string;
  command?: string;
  description?: string;
  skill?: string;
  args?: string;
  sid?: string;
  toolUseId?: string;
  agentId?: string;
}

export const SID = "00000000-0000-4000-8000-000000000716";

/** A PreToolUse / PostToolUse payload in the measured shape (tests/fixtures/hook-payloads/). */
export function payload(p: PayloadSpec): Record<string, unknown> {
  const sid = p.sid ?? SID;
  const out: Record<string, unknown> = {
    session_id: sid,
    transcript_path: join(p.cwd, ".claude-config", `${sid.replace(/\//g, "_")}.jsonl`),
    cwd: p.cwd,
    permission_mode: "auto",
    hook_event_name: p.event === "pre" ? "PreToolUse" : "PostToolUse",
    tool_name: p.tool,
    tool_input:
      p.tool === "Bash"
        ? { command: p.command ?? "ls", description: p.description ?? "List files" }
        : { skill: p.skill ?? "dev-process-toolkit:gate-check", ...(p.args !== undefined ? { args: p.args } : {}) },
    tool_use_id: p.toolUseId ?? "toolu_SYNTH_716",
  };
  if (p.agentId !== undefined) {
    out.agent_id = p.agentId;
    out.agent_type = "general-purpose";
  }
  if (p.event === "post") {
    out.tool_response =
      p.tool === "Bash"
        ? { stdout: "", stderr: "", interrupted: false, isImage: false }
        : { success: true, commandName: p.skill ?? "dev-process-toolkit:gate-check" };
    out.duration_ms = 5;
  }
  return out;
}

// ------------------------------------------------------------------- runs

export interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Drive the capture wrapper the way the registered command does: `<wrapper> <record>`, payload on stdin. */
export function runCapture(
  input: Record<string, unknown> | string,
  opts: { record: string; pluginRoot?: string; env?: Record<string, string>; cwd?: string; projectDir?: string },
): Run {
  const pluginRoot = opts.pluginRoot ?? PLUGIN_ROOT;
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  const cwd = opts.cwd ?? (typeof input === "string" ? undefined : (input.cwd as string | undefined));
  const p = spawnSync("/bin/bash", [join(pluginRoot, WRAPPER_REL), opts.record], {
    cwd: cwd && existsSync(cwd) ? cwd : undefined,
    input: stdin,
    encoding: "utf-8",
    env: {
      ...(process.env as Record<string, string>),
      ...GIT_ENV,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PROJECT_DIR: opts.projectDir ?? cwd ?? "",
      ...(opts.env ?? {}),
    },
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** Run a rendered registered command through `sh -c`, as Claude Code does. */
export function runShell(command: string, opts: { projectDir: string; stdin?: string; env?: Record<string, string> }): Run {
  const p = spawnSync("/bin/sh", ["-c", command], {
    cwd: opts.projectDir,
    input: opts.stdin ?? "",
    encoding: "utf-8",
    env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_PROJECT_DIR: opts.projectDir, ...(opts.env ?? {}) },
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** The registration front door: `bun run capture_registration.ts <verb> <root>`. */
export function runRegistration(verb: string, root: string, opts: { cfg: string; module?: string; env?: Record<string, string> }): Run {
  const p = spawnSync("bun", ["run", opts.module ?? CAPTURE_MODULE, verb, root], {
    cwd: root,
    encoding: "utf-8",
    env: { ...(process.env as Record<string, string>), ...GIT_ENV, CLAUDE_CONFIG_DIR: opts.cfg, ...(opts.env ?? {}) },
  });
  return { exitCode: p.status ?? -1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** `status` output parsed into its three fields. */
export function parseStatus(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const m = /^(setting|registration|guard): (\S+)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

// ------------------------------------------------------------------ ledger

export function ledgerDir(root: string): string {
  return join(root, ".dpt", "ledger", "tool-calls");
}

export function ledgerEntries(root: string): string[] {
  const d = ledgerDir(root);
  return existsSync(d) ? readdirSync(d).sort() : [];
}

export function ledgerRows(root: string, sid = SID): Record<string, unknown>[] {
  const file = join(ledgerDir(root), `${sid}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Every byte the ledger directory holds, concatenated. */
export function ledgerBytes(root: string): string {
  const d = ledgerDir(root);
  if (!existsSync(d)) return "";
  return readdirSync(d)
    .sort()
    .map((n) => readFileSync(join(d, n), "utf-8"))
    .join("");
}

// ------------------------------------------------------------------- shims

/** A dir holding an executable `name` that writes `marker` and then runs `then` (or exits `exit`). */
export function shimDir(label: string, name: string, marker: string, then: { exec?: string; exit?: number } = { exit: 0 }): string {
  const d = tempDir(label);
  const body = then.exec !== undefined
    ? `#!/bin/sh\necho ran >> '${marker}'\nexec '${then.exec}' "$@"\n`
    : `#!/bin/sh\necho ran >> '${marker}'\nexit ${then.exit ?? 0}\n`;
  writeFileSync(join(d, name), body);
  chmodSync(join(d, name), 0o755);
  return d;
}

export function withPath(dir: string): Record<string, string> {
  return { PATH: `${dir}:${process.env.PATH ?? ""}` };
}

// ------------------------------------------------------------------ module

export type AnyMod = Record<string, any>;

/** The registration module, loaded lazily so a missing module reds each test, not the file. */
export async function CR(): Promise<AnyMod> {
  return (await import(`../${CAPTURE_MODULE_REL}`)) as AnyMod;
}

/** The text of a refusal, whatever shape `checkRegisterPreconditions` returns it in. */
export function refusalText(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["text", "message", "refusal"]) if (typeof o[k] === "string") return o[k] as string;
    return JSON.stringify(r);
  }
  return String(r);
}
