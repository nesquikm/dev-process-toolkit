// tracker_write_gate_setting — STE-693.
//
// The ONE reader of the per-user `userConfig.tracker_write_gate` option, shared
// by the pre-tracker-write-gate hook and the /gate-check row. Claude Code hands
// the option to the hook as `CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE`, value
// verbatim; an unset option arrives as an ABSENT variable, so absent means
// `enforce`. Any value other than `enforce` or `off` fails closed to `enforce`
// and is reported back as `ignored`.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const TRACKER_WRITE_GATE_ENV = "CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE";

export interface TrackerWriteGateSetting {
  effective: "enforce" | "off";
  /** The raw value when it was neither absent, empty, `enforce` nor `off`. */
  ignored: string | null;
}

export function trackerWriteGateSetting(
  env: Record<string, string | undefined> = process.env,
): TrackerWriteGateSetting {
  const raw = env[TRACKER_WRITE_GATE_ENV];
  if (raw === undefined || raw === "" || raw === "enforce") return { effective: "enforce", ignored: null };
  if (raw === "off") return { effective: "off", ignored: null };
  return { effective: "enforce", ignored: raw };
}

/**
 * AC-STE-693.5 — the first of `.claude/settings.json` / `.claude/settings.local.json`
 * in `from` or any directory up to and including `top` whose `env` block names
 * the variable, or null. A file the model can write is a measured route to the
 * variable, so its presence turns `off` back into `enforce`. A file that exists
 * but cannot be read or parsed counts as naming it (fail closed).
 */
export function projectSettingsNamingGate(top: string | null, from: string | null = top): string | null {
  return projectSettingsFilesNamingGate(top, from)[0] ?? null;
}

/**
 * Every settings file that names the variable (or exists but cannot be read
 * or parsed), scanning `from` and each ancestor up to and including `top` —
 * never below `from`, never siblings. A `from` outside `top` scans `top` only.
 */
export function projectSettingsFilesNamingGate(top: string | null, from: string | null = top): string[] {
  if (!top) return [];
  const found: string[] = [];
  for (const dir of dirsUpTo(top, from)) {
    for (const file of ["settings.json", "settings.local.json"]) {
      const path = join(dir, ".claude", file);
      if (!existsSync(path)) continue;
      const parsed = readJsonStrict(path);
      const env = parsed.ok ? (parsed.value as { env?: unknown } | null)?.env : undefined;
      if (!parsed.ok || (env && typeof env === "object" && Object.prototype.hasOwnProperty.call(env, TRACKER_WRITE_GATE_ENV))) {
        found.push(path);
      }
    }
  }
  return found;
}

/** `from` and each of its ancestors up to and including `top`, nearest first, spelled under `top`. */
function dirsUpTo(top: string, from: string | null): string[] {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  if (!from) return [top];
  const rel = relative(real(top), real(from));
  if (rel.startsWith("..") || isAbsolute(rel)) return [top];
  const parts = rel === "" ? [] : rel.split(sep);
  const dirs: string[] = [];
  for (let n = parts.length; n > 0; n--) dirs.push(join(top, ...parts.slice(0, n)));
  dirs.push(top);
  return dirs;
}

function readJsonStrict(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ok: false };
  }
}

function readJson(path: string): unknown {
  const parsed = readJsonStrict(path);
  return parsed.ok ? parsed.value : null;
}

// ---------------------------------------------------------------------------
// AC-STE-693.6 — the /gate-check row `tracker_write_gate_setting`.
// ---------------------------------------------------------------------------

export const PROBE_ID = "tracker_write_gate_setting";

export interface Report {
  violations: [];
  notes: string[];
  vacuous: false;
  setting: "enforce" | "off (per-user)";
}

/**
 * The option as the USER settings file carries it. A /gate-check Bash call is
 * not a hook, so the variable may be absent there; the user settings file is
 * where Claude Code reads the per-user value from. Project-scope `pluginConfigs`
 * never reach the hook (AC-STE-693.1), so they are never read.
 */
function userSettingsOption(env: Record<string, string | undefined>): string | undefined {
  const configDir = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
  const configs = (readJson(join(configDir, "settings.json")) as { pluginConfigs?: unknown } | null)?.pluginConfigs;
  if (!configs || typeof configs !== "object") return undefined;
  for (const [key, entry] of Object.entries(configs as Record<string, unknown>)) {
    if (!key.startsWith("dev-process-toolkit@")) continue;
    const value = (entry as { options?: { tracker_write_gate?: unknown } } | null)?.options?.tracker_write_gate;
    if (typeof value === "string") return value;
  }
  return undefined;
}

export async function runTrackerWriteGateSettingProbe(
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Report> {
  const raw = env[TRACKER_WRITE_GATE_ENV] ?? userSettingsOption(env);
  const { effective, ignored } = trackerWriteGateSetting({ [TRACKER_WRITE_GATE_ENV]: raw });
  const forged = projectSettingsFilesNamingGate(projectRoot, process.cwd()).map((p) => relative(projectRoot, p).split(sep).join("/"));
  if (forged.length > 0) {
    return {
      violations: [],
      notes: [
        `${PROBE_ID}: enforce — warning: ${forged.join(", ")} ${forged.length === 1 ? "names" : "name"} ${TRACKER_WRITE_GATE_ENV} in ${forged.length === 1 ? "its" : "their"} \`env\` block or cannot be read — ${forged.length === 1 ? "a file" : "files"} the model can write — so the hook enforces whatever the per-user option says; set the option in your user settings instead`,
      ],
      vacuous: false,
      setting: "enforce",
    };
  }
  const setting = effective === "off" ? "off (per-user)" : "enforce";
  const suffix = ignored === null ? "" : ` — ignored unrecognised value \`${ignored}\` (only \`enforce\` or \`off\` are read)`;
  return { violations: [], notes: [`${PROBE_ID}: ${setting}${suffix}`], vacuous: false, setting };
}

if (import.meta.main) {
  const report = await runTrackerWriteGateSettingProbe(resolve(process.argv[2] || process.cwd()));
  for (const n of report.notes) console.log(n);
  // Informational row — never fails the gate.
  process.exit(0);
}
