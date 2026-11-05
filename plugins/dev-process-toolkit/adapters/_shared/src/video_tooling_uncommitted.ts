// STE-673 — /gate-check probe #87 `video_tooling_uncommitted`.
//
// AC-STE-673.6: in a video-configured project (`.dpt/video/config.yaml`
// present) every path `listUncommittedVideoTooling` returns is reported at
// WARNING severity — never GATE FAILED. Vacuous when the config is absent;
// clean (non-vacuous, zero rows) when the list is empty. The listing is the
// front door's own `uncommittedVideoTooling`, never a re-derivation.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectSettingsSource, loadProjectSection } from "./project_settings";
import { VIDEO_CONFIG } from "./project_settings_legacy";
import { uncommittedVideoTooling } from "./video_commit_nudge";

export const PROBE_ID = "video_tooling_uncommitted";

const REASON = "video style or tooling is not committed, so the next clone renders without the house style";
const REMEDY =
  "commit it — `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/video_commit_nudge.ts <projectRoot> --commit` stages exactly the listed paths and creates one commit";

export interface Violation {
  file: string;
  reason: string;
  note: string;
  message: string;
  severity: "warning";
}

export interface Report {
  violations: Violation[];
  notes: string[];
  vacuous: boolean;
}

/**
 * STE-709 — on a settings-file tree vacuity is decided by the loader's
 * `video` section (a `video.config` present); on a legacy tree by the legacy
 * config file, as before. A settings file the loader refuses reads as
 * unconfigured (vacuous) — the refusal is reported by the probes that read
 * the values.
 */
function isVideoConfigured(projectRoot: string): boolean {
  if (detectSettingsSource(projectRoot) === "settings") {
    try {
      return loadProjectSection(projectRoot, "video").config !== null;
    } catch {
      return false;
    }
  }
  return existsSync(join(projectRoot, VIDEO_CONFIG));
}

export async function runVideoToolingUncommittedProbe(projectRoot: string): Promise<Report> {
  if (!isVideoConfigured(projectRoot)) return { violations: [], notes: [], vacuous: true };
  let paths: string[];
  try {
    paths = uncommittedVideoTooling(projectRoot);
  } catch (err) {
    return { violations: [], notes: [`${PROBE_ID}: could not list video tooling — ${(err as Error).message}`], vacuous: false };
  }
  const violations = paths.map((file): Violation => ({
    file,
    reason: REASON,
    note: `${file} — ${REASON}`,
    message: [
      `${PROBE_ID}: ${file} — ${REASON}`,
      `Remedy: ${REMEDY}`,
      `Context: file=${file}, probe=${PROBE_ID}, severity=warning`,
    ].join("\n"),
    severity: "warning",
  }));
  return { violations, notes: [], vacuous: false };
}

if (import.meta.main) {
  const projectRoot = resolve(process.argv[2] || process.cwd());
  const report = await runVideoToolingUncommittedProbe(projectRoot);
  for (const v of report.violations) console.log(v.message);
  for (const n of report.notes) console.log(n);
  // Warnings never fail the gate.
  process.exit(0);
}
