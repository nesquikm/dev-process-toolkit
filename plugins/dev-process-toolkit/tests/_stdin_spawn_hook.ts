// Shared hook plumbing for the M_4df444 / STE-595 suites.
//
// The stdin-spawn hook is located THROUGH ITS REGISTRATION, never by a
// hand-typed path: every `PreToolUse` command hook with matcher `Bash` in the
// tracked `.claude/settings.json` is resolved to its shim and to the entry the
// shim `exec`s, and the one whose entry imports `stdin_spawn_detector` is the
// hook. It is then run exactly as the harness runs a hook: the REGISTERED
// command string, in a shell, with the JSON payload on stdin and
// CLAUDE_PROJECT_DIR set to the repo root.

import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pluginRoot, repoRoot } from "./_spawn_fences";

export const SETTINGS_PATH = join(repoRoot, ".claude", "settings.json");
/** A transcript path that is never created: the hook must not need one. */
export const NO_TRANSCRIPT = join(tmpdir(), "ste-595-no-such-transcript.jsonl");

export interface RegisteredHook {
  /** The command string as registered. */
  command: string;
  /** Absolute path of the shell shim the command runs. */
  shim: string;
  /** Absolute path of the bun entry the shim execs. */
  entry: string;
  /** Shim basename without `.sh` — the `hook=` value of the Context line. */
  name: string;
}

export interface HookRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function expandVars(s: string): string {
  return s
    .replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR\b/g, repoRoot)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g, pluginRoot);
}

export function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
}

/** Every command registered under `hooks.PreToolUse` with matcher `Bash`. */
export function bashPreToolUseCommands(): string[] {
  const hooks = (readSettings().hooks ?? {}) as Record<string, unknown>;
  const pre = hooks.PreToolUse;
  if (!Array.isArray(pre)) return [];
  const out: string[] = [];
  for (const entry of pre as Array<Record<string, unknown>>) {
    if (entry?.matcher !== "Bash" || !Array.isArray(entry.hooks)) continue;
    for (const h of entry.hooks as Array<Record<string, unknown>>) {
      if (h?.type === "command" && typeof h.command === "string") out.push(h.command);
    }
  }
  return out;
}

export function shimOf(command: string): string | null {
  const flat = expandVars(command).replace(/["']/g, "");
  const m = /(?:^|\s)(\S+\.sh)(?:\s|$)/.exec(flat);
  if (!m) return null;
  return isAbsolute(m[1]!) ? m[1]! : resolve(repoRoot, m[1]!);
}

export function entryOf(shim: string): string | null {
  const line = readFileSync(shim, "utf-8")
    .split("\n")
    .find((l) => /^\s*exec\s+bun\b/.test(l));
  if (line === undefined) return null;
  const flat = expandVars(
    line.replace(
      /\$\(\s*dirname\s+"?\$(?:\{BASH_SOURCE\[0\]\}|BASH_SOURCE|0)"?\s*\)/g,
      dirname(shim),
    ),
  ).replace(/["']/g, "");
  const m = /(\S+\.ts)\b/.exec(flat);
  if (!m) return null;
  return isAbsolute(m[1]!) ? m[1]! : resolve(dirname(shim), m[1]!);
}

/** The registered stdin-spawn hook, or null when no registration resolves to it. */
export function registeredStdinSpawnHook(): RegisteredHook | null {
  for (const command of bashPreToolUseCommands()) {
    const shim = shimOf(command);
    if (shim === null || !existsSync(shim)) continue;
    const entry = entryOf(shim);
    if (entry === null || !existsSync(entry)) continue;
    if (!/stdin_spawn_detector/.test(readFileSync(entry, "utf-8"))) continue;
    return { command, shim, entry, name: basename(shim).replace(/\.sh$/, "") };
  }
  return null;
}

export function requireHook(): RegisteredHook {
  const hook = registeredStdinSpawnHook();
  if (hook === null) {
    throw new Error(
      "no `PreToolUse` hook with matcher `Bash` in the tracked .claude/settings.json runs an " +
        "entry that imports stdin_spawn_detector — register the STE-595 hook there " +
        `(Bash PreToolUse commands found: ${JSON.stringify(bashPreToolUseCommands())})`,
    );
  }
  return hook;
}

/** Run the registered hook command with `stdin` as its payload, as the harness does. */
export async function runHookRaw(
  stdin: string,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<HookRun> {
  const hook = requireHook();
  const proc = Bun.spawn(["bash", "-c", hook.command], {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, ...opts.env },
    stdin: new Response(stdin).body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** A Claude Code PreToolUse payload for the Bash tool. */
export function bashPayload(command: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: "ste-595-test",
    transcript_path: NO_TRANSCRIPT,
    cwd: repoRoot,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "STE-595 test payload" },
    ...overrides,
  });
}

export function runHookOn(
  command: string,
  opts?: { cwd?: string; env?: Record<string, string> },
): Promise<HookRun> {
  return runHookRaw(bashPayload(command), opts);
}

/** The NFR-10 lines of a hook's stderr, in order. */
export function nfr10Lines(stderr: string): string[] {
  return stderr.split("\n").filter((l) => /^(Refusing|Reminder|Remedy|Context): /.test(l));
}
