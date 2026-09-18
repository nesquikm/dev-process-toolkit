// dpt_version — STE-602.
//
// `FIRST_GATED_DPT_VERSION` is a historical fact: the toolkit release that
// ships M_947c79's shared-container write gate. A declared `min_dpt_version`
// below it admits clients that carry no gate at all.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareSemver } from "./migrations/coverage";
import type { WorkspaceBinding } from "./workspace_binding";

export const FIRST_GATED_DPT_VERSION = "2.87.0";

/** A bare release version: three numeric parts, no `v` prefix, no suffix. */
export const STRICT_SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** NFR-10 three-line message: verdict, `Remedy:`, `Context:`. */
export function nfr10Message(verdict: string, remedy: string, context: string): string {
  return `${verdict}\nRemedy: ${remedy}\nContext: ${context}`;
}

/** STE-602 — the running version could not be read, or is not strict `X.Y.Z`. */
export class DptVersionError extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super(nfr10Message(verdict, remedy, context));
    this.name = "DptVersionError";
  }
}

function defaultPluginRoot(): string {
  const env = process.env.CLAUDE_PLUGIN_ROOT;
  if (env) return env;
  // this module lives at <pluginRoot>/adapters/_shared/src/dpt_version.ts
  return resolve(import.meta.dir, "..", "..", "..");
}

/**
 * The running toolkit version: `version` from
 * `<pluginRoot>/.claude-plugin/plugin.json`. Never a literal.
 */
export function runningDptVersion(pluginRoot?: string): string {
  const root = pluginRoot ?? defaultPluginRoot();
  const manifest = join(root, ".claude-plugin", "plugin.json");
  let version: unknown;
  try {
    version = JSON.parse(readFileSync(manifest, "utf-8"))?.version;
  } catch (e) {
    throw new DptVersionError(
      `DptVersionError: the plugin manifest could not be read, so the running toolkit version is unknown.`,
      `restore ${manifest} with a string \`version\` field in strict X.Y.Z form.`,
      `manifest=${manifest}, cause=${(e as Error).message}`,
    );
  }
  if (typeof version !== "string" || !STRICT_SEMVER_RE.test(version)) {
    throw new DptVersionError(
      `DptVersionError: the plugin manifest's version "${String(version)}" is not strict X.Y.Z.`,
      `set \`version\` in ${manifest} to strict X.Y.Z (no "v" prefix, three numeric parts).`,
      `manifest=${manifest}, version="${String(version)}"`,
    );
  }
  return version;
}

export type VersionFloorVerdict =
  | { ok: true }
  | { ok: false; floor: string; running: string; message: string };

/**
 * STE-602 — refuse exactly when `running` is below the binding's declared
 * `min_dpt_version`; equal and greater pass. No declared floor passes.
 */
export function checkVersionFloor(
  binding: Pick<WorkspaceBinding, "minDptVersion">,
  running: string,
): VersionFloorVerdict {
  const floor = binding.minDptVersion;
  if (floor === undefined) return { ok: true };
  const cmp = compareSemver(running, floor);
  if (cmp !== null && cmp >= 0) return { ok: true };
  return {
    ok: false,
    floor,
    running,
    message: nfr10Message(
      `the running toolkit version ${running} is below this workspace's min_dpt_version ${floor}.`,
      `upgrade the dev-process-toolkit plugin to ${floor} or later.`,
      `running=${running}, min_dpt_version=${floor}`,
    ),
  };
}
