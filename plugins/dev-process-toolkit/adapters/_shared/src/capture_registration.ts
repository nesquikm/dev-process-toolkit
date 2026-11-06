// STE-716 — registration of the opt-in tool-call capture hook.
//
// The plugin registers nothing: `hooks/hooks.json` never names the capture
// hook. This module writes (or removes) the user's own entry in
// `<root>/.claude/settings.local.json`, one matcher group per event under
// `hooks.PreToolUse` and `hooks.PostToolUse`, each holding one command entry
// with `"timeout": 2` whose command is `renderCaptureHookCommand(...)`.
//
// Front door:
//   bun run capture_registration.ts status <root>      read-only
//   bun run capture_registration.ts register <root>    refuses in NFR-10 shape, exit 1
//   bun run capture_registration.ts unregister <root>

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type * as CaptureRecord from "../../../templates/hooks/_lib/capture_record.ts";
import { toolCallsSwitchOn } from "./project_settings";

/** The substring that marks a capture entry's command. */
export const CAPTURE_WRAPPER_REL = "templates/hooks/process/tool-call-capture.sh";
export const LOCAL_SETTINGS_REL = ".claude/settings.local.json";
export const CAPTURE_MATCHER = "Bash|Skill";
export const CAPTURE_TIMEOUT_SECONDS = 2;
const EVENTS = ["PreToolUse", "PostToolUse"] as const;

/** The running plugin root, as the filesystem sees it. */
export function runningPluginRoot(): string {
  const root = resolve(import.meta.dir, "..", "..", "..");
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** The version a plugin root's manifest declares, or null when unreadable. */
export function manifestVersion(pluginRoot: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf-8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Claude Code's installed-plugins record: `<config dir>/plugins/installed_plugins.json`. */
export function installedPluginsPath(env: NodeJS.ProcessEnv = process.env): string {
  const cfg = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR !== "" ? env.CLAUDE_CONFIG_DIR : join(homedir(), ".claude");
  return join(cfg, "plugins", "installed_plugins.json");
}

/** The registered command, byte for byte (STE-716 § Registration). */
export function renderCaptureHookCommand(o: { pluginRoot: string; version: string; installedPlugins: string }): string {
  const { pluginRoot, version, installedPlugins } = o;
  const wrapper = `${pluginRoot}/${CAPTURE_WRAPPER_REL}`;
  return (
    `[ -f "$CLAUDE_PROJECT_DIR/specs/settings.yaml" ] && grep -qs 'tool_calls' "$CLAUDE_PROJECT_DIR/specs/settings.yaml" && ` +
    `grep -qsF '"${pluginRoot}"' '${installedPlugins}' && grep -qsF '"version": "${version}"' '${pluginRoot}/.claude-plugin/plugin.json' && ` +
    `[ -x '${wrapper}' ] && ` +
    `CLAUDE_PLUGIN_ROOT='${pluginRoot}' exec '${wrapper}' '${installedPlugins}'; exit 0`
  );
}

/** An entry is a capture entry when its command names the capture wrapper. */
export function isCaptureHookCommand(command: unknown): boolean {
  return typeof command === "string" && command.includes(CAPTURE_WRAPPER_REL);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isCaptureEntry(h: unknown): boolean {
  return isObject(h) && isCaptureHookCommand(h.command);
}

/**
 * Pure: a copy of a settings object with every capture entry removed, and the
 * matcher groups that removal leaves empty. Every other key keeps its order.
 */
export function dropCaptureEntries(json: unknown): unknown {
  if (!isObject(json) || !isObject(json.hooks)) return json;
  const hooks: Record<string, unknown> = {};
  for (const [ev, groups] of Object.entries(json.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[ev] = groups;
      continue;
    }
    const kept: unknown[] = [];
    for (const g of groups) {
      if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isCaptureEntry)) {
        kept.push(g);
        continue;
      }
      const rest = g.hooks.filter((h) => !isCaptureEntry(h));
      if (rest.length > 0) kept.push({ ...g, hooks: rest });
    }
    hooks[ev] = kept;
  }
  return { ...json, hooks };
}

// ------------------------------------------------------------------ refusals

function refusal(why: string, remedy: string, context: string): string {
  return `Refusing: ${why}\nRemedy: ${remedy}\nContext: ${context}`;
}

function git(root: string, args: string[]): { status: number | null; stdout: string } {
  const p = spawnSync("git", args, { cwd: root, encoding: "utf-8", env: process.env });
  return { status: p.status, stdout: p.stdout ?? "" };
}

/**
 * Pure and read-only: the refusals `register` would raise, with the setting
 * taken as `settingOn` instead of read. Empty when registration may proceed.
 */
export function checkRegisterPreconditions(root: string, opts: { settingOn: boolean }): string[] {
  const out: string[] = [];
  const ctx = `root=${root}, file=${LOCAL_SETTINGS_REL}, verb=register`;
  if (!opts.settingOn) {
    out.push(
      refusal(
        "tracking.tool_calls.enabled is not true in specs/settings.yaml, so there is nothing to register.",
        "Turn the setting on through an approved settings change, then run register again.",
        ctx,
      ),
    );
  }
  if (git(root, ["ls-files", "--error-unmatch", "--", LOCAL_SETTINGS_REL]).status === 0) {
    out.push(
      refusal(
        `${LOCAL_SETTINGS_REL} is tracked by git; the capture entry names an absolute path and may never reach a committed file.`,
        `Untrack it (git rm --cached ${LOCAL_SETTINGS_REL}) and commit that, then run register again.`,
        ctx,
      ),
    );
  }
  if (git(root, ["check-ignore", "-q", "--", LOCAL_SETTINGS_REL]).status !== 0) {
    out.push(
      refusal(
        `${LOCAL_SETTINGS_REL} is not ignored by git.`,
        `Add the line \`${LOCAL_SETTINGS_REL}\` to ${join(root, ".gitignore")} (the project's .gitignore), then run register again.`,
        ctx,
      ),
    );
  }
  const file = join(root, LOCAL_SETTINGS_REL);
  if (existsSync(file)) {
    let parsed: unknown;
    let ok = true;
    try {
      parsed = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      ok = false;
    }
    if (!ok || !isObject(parsed)) {
      out.push(
        refusal(
          `${LOCAL_SETTINGS_REL} exists but holds no JSON object.`,
          "Fix the file so it holds one JSON object (or remove it), then run register again.",
          ctx,
        ),
      );
    }
  }
  return out;
}

// ------------------------------------------------------------------- verbs

function readLocal(root: string): Record<string, unknown> | null {
  const file = join(root, LOCAL_SETTINGS_REL);
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, "utf-8"));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

function captureCommands(local: Record<string, unknown> | null, ev: string): string[] {
  if (local === null || !isObject(local.hooks)) return [];
  const groups = local.hooks[ev];
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g) =>
    isObject(g) && Array.isArray(g.hooks) ? g.hooks.filter(isCaptureEntry).map((h) => (h as { command: string }).command) : [],
  );
}

function currentRender(): string | null {
  const pluginRoot = runningPluginRoot();
  const version = manifestVersion(pluginRoot);
  if (version === null) return null;
  return renderCaptureHookCommand({ pluginRoot, version, installedPlugins: installedPluginsPath() });
}

/** The shell guard's checks plus the hook's record-entry check, for the running plugin root. */
function guardPasses(root: string): boolean {
  const pluginRoot = runningPluginRoot();
  const version = manifestVersion(pluginRoot);
  const record = installedPluginsPath();
  const settings = join(root, "specs", "settings.yaml");
  try {
    if (!readFileSync(settings, "utf-8").includes("tool_calls")) return false;
    if (version === null) return false;
    if (!readFileSync(record, "utf-8").includes(`"${pluginRoot}"`)) return false;
    if (!readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf-8").includes(`"version": "${version}"`)) return false;
    const wrapper = join(pluginRoot, CAPTURE_WRAPPER_REL);
    if (!existsSync(wrapper) || (statSync(wrapper).mode & 0o111) === 0) return false;
  } catch {
    return false;
  }
  // Loaded here, not at module load: the migration registry and template copy
  // import this module, and a tree copied without `templates/` must still load.
  const { recordPinsPluginRoot } = require("../../../templates/hooks/_lib/capture_record.ts") as typeof CaptureRecord;
  return recordPinsPluginRoot(record, root, pluginRoot);
}

export interface CaptureStatus {
  setting: "on" | "off";
  registration: "none" | "current" | "stale";
  guard: "pass" | "fail";
}

/** Read-only: the setting, the registration and the guard for `root`. */
export function captureStatus(root: string): CaptureStatus {
  const settingOn = toolCallsSwitchOn(root);
  const local = readLocal(root);
  const perEvent = EVENTS.map((ev) => captureCommands(local, ev));
  const any = perEvent.some((c) => c.length > 0);
  const render = currentRender();
  const current = settingOn && render !== null && perEvent.every((c) => c.length === 1 && c[0] === render);
  return {
    setting: settingOn ? "on" : "off",
    registration: !any ? "none" : current ? "current" : "stale",
    guard: guardPasses(root) ? "pass" : "fail",
  };
}

function writeIfChanged(root: string, obj: unknown): void {
  const file = join(root, LOCAL_SETTINGS_REL);
  const next = `${JSON.stringify(obj, null, 2)}\n`;
  if (existsSync(file) && readFileSync(file, "utf-8") === next) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
}

/** Add or replace the capture entries. Returns the refusals raised (nothing written when any). */
export function registerCapture(root: string): string[] {
  const refusals = checkRegisterPreconditions(root, { settingOn: toolCallsSwitchOn(root) });
  if (refusals.length > 0) return refusals;
  const command = currentRender();
  if (command === null) {
    return [
      refusal(
        "the running plugin root's manifest declares no readable version.",
        "Reinstall the plugin, then run register again.",
        `root=${root}, plugin=${runningPluginRoot()}, verb=register`,
      ),
    ];
  }
  const entry = { type: "command", command, timeout: CAPTURE_TIMEOUT_SECONDS };
  const local = readLocal(root) ?? {};
  const hooks: Record<string, unknown> = isObject(local.hooks) ? { ...local.hooks } : {};
  for (const ev of EVENTS) {
    const groups: unknown[] = Array.isArray(hooks[ev]) ? [...(hooks[ev] as unknown[])] : [];
    let placed = false;
    const next: unknown[] = [];
    for (const g of groups) {
      if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isCaptureEntry)) {
        next.push(g);
        continue;
      }
      const rest: unknown[] = [];
      for (const h of g.hooks) {
        if (!isCaptureEntry(h)) rest.push(h);
        else if (!placed) {
          rest.push(entry);
          placed = true;
        }
      }
      if (rest.length > 0) next.push({ ...g, hooks: rest });
    }
    if (!placed) next.push({ matcher: CAPTURE_MATCHER, hooks: [entry] });
    hooks[ev] = next;
  }
  writeIfChanged(root, { ...local, hooks });
  return [];
}

/** Remove only the capture entries (and the groups they empty); writes nothing when none exists. */
export function unregisterCapture(root: string): void {
  const local = readLocal(root);
  if (local === null) return;
  const events = isObject(local.hooks) ? Object.keys(local.hooks) : [];
  if (!events.some((ev) => captureCommands(local, ev).length > 0)) return;
  writeIfChanged(root, dropCaptureEntries(local));
}

if (import.meta.main) {
  const [verb, rootArg] = process.argv.slice(2);
  const usage = "Usage: bun run capture_registration.ts status|register|unregister <root>";
  if (rootArg === undefined || !["status", "register", "unregister"].includes(verb ?? "")) {
    console.error(usage);
    process.exit(2);
  }
  const root = resolve(rootArg);
  if (verb === "status") {
    const s = captureStatus(root);
    console.log(`setting: ${s.setting}\nregistration: ${s.registration}\nguard: ${s.guard}`);
  } else if (verb === "register") {
    const refusals = registerCapture(root);
    if (refusals.length > 0) {
      console.error(refusals.join("\n\n"));
      process.exit(1);
    }
    console.log(`registered: ${join(root, LOCAL_SETTINGS_REL)}`);
  } else {
    unregisterCapture(root);
    console.log(`unregistered: ${join(root, LOCAL_SETTINGS_REL)}`);
  }
}
