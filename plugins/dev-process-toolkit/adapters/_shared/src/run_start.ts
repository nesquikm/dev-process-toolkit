// run_start — STE-810: one `dpt-run-start/1` row per skill start.
//
// Each row is one JSON line appended to runStartLedgerPath(root) in ONE
// O_APPEND write, holding exactly {schema, session_id, skill, fr, started_at,
// settings_hash, settings, plugin_version, registration}. The path is composed
// only in ./dpt_paths (AC-STE-382.1).

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { captureStatus, manifestVersion, runningPluginRoot } from "./capture_registration";
import { runStartLedgerPath } from "./dpt_paths";
import { settingsSectionValue } from "./project_settings";
import { PROPOSABLE_SETTINGS } from "./retro_proposal";
import { RUN_START_SCHEMA, type RunStartRow } from "./run_start_ledger";

// The read side lives in ./run_start_ledger (STE-811); re-exported for callers.
export { RUN_START_SCHEMA, readRunStarts, type RunStartRow } from "./run_start_ledger";

export interface RunStartInput {
  session: string;
  skill: string;
  fr: string | null;
  at: string;
}

/** The value an unset proposable key carries — not the loader's default. */
export const ABSENT = "absent";

/**
 * The settings snapshot a run starts under: every PROPOSABLE_SETTINGS key, and
 * no other, mapped to its raw value in the settings file or to `"absent"`.
 */
export function snapshotSettings(root: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key } of PROPOSABLE_SETTINGS) {
    const [section, ...rest] = key.split(".");
    let v: unknown = settingsSectionValue(root, section!)?.value;
    for (const part of rest) {
      v = v !== null && typeof v === "object" ? (v as Record<string, unknown>)[part] : undefined;
    }
    out[key] = v === undefined ? ABSENT : v;
  }
  return out;
}

/** Canonical JSON: keys sorted at every level, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** sha256 hex of the canonical JSON of `{ settings, plugin_version, registration }`. */
export function settingsHash(settings: Record<string, unknown>, plugin_version: string, registration: string): string {
  return createHash("sha256").update(canonicalJson({ settings, plugin_version, registration })).digest("hex");
}

/** True when at least one `tracking.<name>.enabled` in the settings file is `true`. */
export function anyTrackingSwitchOn(root: string): boolean {
  const tracking = settingsSectionValue(root, "tracking")?.value;
  if (tracking === null || typeof tracking !== "object") return false;
  return Object.values(tracking as Record<string, unknown>).some(
    (v) => v !== null && typeof v === "object" && (v as Record<string, unknown>).enabled === true,
  );
}

/** Append one run-start row for `input` to the project's run-start ledger. */
export function recordRunStart(root: string, input: RunStartInput): RunStartRow {
  const settings = snapshotSettings(root);
  const plugin_version = manifestVersion(runningPluginRoot()) ?? "unknown";
  const registration = captureStatus(root).registration;
  const row: RunStartRow = {
    schema: RUN_START_SCHEMA,
    session_id: input.session,
    skill: input.skill,
    fr: input.fr,
    started_at: input.at,
    settings_hash: settingsHash(settings, plugin_version, registration),
    settings,
    plugin_version,
    registration,
  };
  const file = runStartLedgerPath(root);
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "a");
  try {
    writeSync(fd, `${JSON.stringify(row)}\n`);
  } finally {
    closeSync(fd);
  }
  return row;
}

// CLI: bun run run_start.ts <root> <skill> [fr]
if (import.meta.main) {
  const [root, skill, fr] = process.argv.slice(2);
  if (!root || !skill) {
    process.stderr.write("Usage: bun run run_start.ts <root> <skill> [fr]\n");
    process.exit(2);
  }
  const session = process.env.CLAUDE_CODE_SESSION_ID ?? "";
  if (session === "") {
    process.stderr.write(
      "run_start: refusing to record a run start — no session id.\n" +
        "Remedy: run inside a Claude Code session, which sets CLAUDE_CODE_SESSION_ID, or export it before calling.\n" +
        `Context: env=CLAUDE_CODE_SESSION_ID, skill=${skill}, helper=run_start\n`,
    );
    process.exit(1);
  }
  if (!anyTrackingSwitchOn(root)) {
    process.stdout.write("skipped: no tracking switch is on\n");
    process.exit(0);
  }
  const row = recordRunStart(root, {
    session,
    skill,
    fr: fr ?? null,
    at: new Date().toISOString(),
  });
  process.stdout.write(`settings_hash=${row.settings_hash}\n`);
}
