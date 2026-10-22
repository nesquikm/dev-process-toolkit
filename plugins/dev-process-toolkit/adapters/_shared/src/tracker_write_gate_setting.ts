// tracker_write_gate_setting — STE-693.
//
// The ONE reader of the per-user `userConfig.tracker_write_gate` option, shared
// by the pre-tracker-write-gate hook and the /gate-check row. Claude Code hands
// the option to the hook as `CLAUDE_PLUGIN_OPTION_TRACKER_WRITE_GATE`, value
// verbatim; an unset option arrives as an ABSENT variable, so absent means
// `enforce`. Any value other than `enforce` or `off` fails closed to `enforce`
// and is reported back as `ignored`.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

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
 * under `top` whose `env` block names the variable, or null. A file the model
 * can write is a measured route to the variable, so its presence turns `off`
 * back into `enforce`.
 */
export function projectSettingsNamingGate(top: string | null): string | null {
  return projectSettingsFilesNamingGate(top)[0] ?? null;
}

/** Every one of `.claude/settings.json` / `.claude/settings.local.json` under `top` whose `env` block names the variable. */
export function projectSettingsFilesNamingGate(top: string | null): string[] {
  if (!top) return [];
  const found: string[] = [];
  for (const file of ["settings.json", "settings.local.json"]) {
    const path = join(top, ".claude", file);
    const env = (readJson(path) as { env?: unknown } | null)?.env;
    if (env && typeof env === "object" && Object.prototype.hasOwnProperty.call(env, TRACKER_WRITE_GATE_ENV)) {
      found.push(path);
    }
  }
  return found;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
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
  const { effective } = trackerWriteGateSetting({ [TRACKER_WRITE_GATE_ENV]: raw });
  const forged = projectSettingsFilesNamingGate(projectRoot).map((p) => relative(projectRoot, p).split(sep).join("/"));
  if (forged.length > 0) {
    return {
      violations: [],
      notes: [
        `${PROBE_ID}: enforce — warning: ${forged.join(", ")} set${forged.length === 1 ? "s" : ""} ${TRACKER_WRITE_GATE_ENV} in ${forged.length === 1 ? "its" : "their"} \`env\` block, a file the model can write, so the hook enforces whatever the per-user option says; set the option in your user settings instead`,
      ],
      vacuous: false,
      setting: "enforce",
    };
  }
  const setting = effective === "off" ? "off (per-user)" : "enforce";
  return { violations: [], notes: [`${PROBE_ID}: ${setting}`], vacuous: false, setting };
}

if (import.meta.main) {
  const report = await runTrackerWriteGateSettingProbe(resolve(process.argv[2] || process.cwd()));
  for (const n of report.notes) console.log(n);
  // Informational row — never fails the gate.
  process.exit(0);
}
