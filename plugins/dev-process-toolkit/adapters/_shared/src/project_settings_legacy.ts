// STE-706 — the legacy half of the settings loader.
//
// Reads the v2.101.4 homes (CLAUDE.md headings, the standalone
// `milestone_scan_fetch:` line, `specs/tracker-config.yaml`, and
// video config and style files) with the same parse today's readers
// perform, and returns each section in the settings file's snake_case shape.
// Only `project_settings.ts` imports this module.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { videoConfigPath, videoStylePath } from "./dpt_paths";

import { readDocsConfig } from "./docs_config";
import { readMilestoneScanFetch } from "./milestone_scan_fetch_config";
import { readOrchestrationConfig } from "./orchestration_config";
import { MissingReleaseFilesBlockError, parseReleaseFiles } from "./release_config";
import { readTaskTrackingSection } from "./resolver_config";
import { readTokenStatsConfig } from "./token_stats_config";
import { readTrackerConfig, type TrackerConfig } from "./tracker_config";
import { readVerificationConfig } from "./verification_config";
import { parseVideoConfig, type VideoConfig } from "./video/config";
import { parseVideoStyle, type VideoStyle } from "./video/style";
import { readWorkspaceBinding } from "./workspace_binding";

/** The CLAUDE.md headings whose sections moved into `specs/settings.yaml`. */
export const MOVED_HEADINGS = [
  "## Task Tracking",
  "## Verification",
  "## Docs",
  "## Orchestration",
  "## Token Stats",
  "## Release Files",
] as const;

const TRACKER_CONFIG = "specs/tracker-config.yaml";
// Derived from the shared path helpers, never retyped (AC-STE-663.1).
const VIDEO_CONFIG = relative("/", videoConfigPath("/"));
const VIDEO_STYLE = relative("/", videoStylePath("/"));
/** The legacy homes that are whole files, as project-relative paths. */
const LEGACY_FILES = [TRACKER_CONFIG, VIDEO_CONFIG, VIDEO_STYLE] as const;

function claudeMd(projectRoot: string): string {
  return join(projectRoot, "CLAUDE.md");
}

/** CLAUDE.md as raw lines (CR stripped, no HTML-comment stripping), or null when absent. */
function claudeMdLines(projectRoot: string): string[] | null {
  const md = claudeMd(projectRoot);
  return existsSync(md) ? readFileSync(md, "utf8").split("\n").map((l) => l.replace(/\r$/, "")) : null;
}

function hasMilestoneScanFetchLine(lines: readonly string[]): boolean {
  return lines.some((l) => l.startsWith("milestone_scan_fetch:"));
}

/** Raw-line match, no HTML-comment stripping — as each v2.101.4 reader matches its home. */
export function hasLegacyHome(projectRoot: string): boolean {
  const lines = claudeMdLines(projectRoot);
  if (lines !== null) {
    if (lines.some((l) => (MOVED_HEADINGS as readonly string[]).includes(l))) return true;
    if (hasMilestoneScanFetchLine(lines)) return true;
  }
  return LEGACY_FILES.some((rel) => existsSync(join(projectRoot, rel)));
}

/**
 * The legacy homes that count as a second home beside a settings file, as
 * project-relative paths. The `## Task Tracking` stub slot never counts; any
 * other moved heading counts only when its body (raw lines, no comment
 * stripping) carries a key its section's closed set recognises. Never throws.
 */
export function legacyHomesBesideSettings(
  projectRoot: string,
  recognisedKeys: Readonly<Record<string, readonly string[]>>,
): string[] {
  const homes: string[] = [];
  try {
    const lines = claudeMdLines(projectRoot);
    if (lines !== null) {
      const keyed = hasMilestoneScanFetchLine(lines) ||
        lines.some((l, i) => {
          const keys = recognisedKeys[l];
          if (!keys) return false;
          for (let j = i + 1; j < lines.length && !/^#{1,2} /.test(lines[j]!); j++) {
            const m = /^([a-z_]+)\s*:/.exec(lines[j]!);
            if (m && keys.includes(m[1]!)) return true;
          }
          return false;
        });
      if (keyed) homes.push("CLAUDE.md");
    }
    for (const rel of LEGACY_FILES) {
      if (existsSync(join(projectRoot, rel))) homes.push(rel);
    }
  } catch {
    // detection never throws
  }
  return homes;
}

function snake(rec: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  return out;
}

function definedSnake(rec: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snake(rec))) if (v !== undefined) out[k] = v;
  return out;
}

export interface LegacyTaskTracking extends Record<string, unknown> {
  mode: string;
  status_vocabulary?: TrackerConfig | null;
}

/**
 * `task_tracking` from `## Task Tracking`, its adapter sub-section, the
 * standalone `milestone_scan_fetch:` line, and (lazily) `specs/tracker-config.yaml`.
 */
export function readLegacyTaskTracking(
  projectRoot: string,
  onStatusVocabularyError: (e: unknown) => never,
): LegacyTaskTracking {
  const md = claudeMd(projectRoot);
  const section = readTaskTrackingSection(md);
  const tt: LegacyTaskTracking = { ...section, mode: section.mode ?? "none" };
  tt.milestone_scan_fetch = readMilestoneScanFetch(md);
  if (tt.mode === "linear" || tt.mode === "jira") {
    const { shared: _shared, ...binding } = readWorkspaceBinding(md, tt.mode);
    tt[tt.mode] = definedSnake(binding);
  }
  Object.defineProperty(tt, "status_vocabulary", {
    enumerable: true,
    configurable: true,
    get(): TrackerConfig | null {
      try {
        return readTrackerConfig(join(projectRoot, "specs"));
      } catch (e) {
        return onStatusVocabularyError(e);
      }
    },
  });
  return tt;
}

export function readLegacyVerification(projectRoot: string): Record<string, unknown> {
  return snake(readVerificationConfig(claudeMd(projectRoot)));
}

export function readLegacyDocs(projectRoot: string): Record<string, unknown> {
  return snake(readDocsConfig(claudeMd(projectRoot)));
}

export function readLegacyOrchestration(projectRoot: string): Record<string, unknown> {
  return snake(readOrchestrationConfig(projectRoot));
}

export function readLegacyTracking(projectRoot: string): { token_stats: { enabled: boolean } } {
  return { token_stats: readTokenStatsConfig(claudeMd(projectRoot)) };
}

export function readLegacyRelease(projectRoot: string): { files: unknown[] } {
  const md = claudeMd(projectRoot);
  if (!existsSync(md)) return { files: [] };
  try {
    return { files: parseReleaseFiles(readFileSync(md, "utf8")) };
  } catch (e) {
    if (e instanceof MissingReleaseFilesBlockError) return { files: [] };
    throw e;
  }
}

export function readLegacyVideo(projectRoot: string): { config: VideoConfig | null; style: VideoStyle | null } {
  const cfg = join(projectRoot, VIDEO_CONFIG);
  const sty = join(projectRoot, VIDEO_STYLE);
  return {
    config: existsSync(cfg) ? parseVideoConfig(readFileSync(cfg, "utf8")) : null,
    style: existsSync(sty) ? parseVideoStyle(readFileSync(sty, "utf8")) : null,
  };
}

/** The marker line that opens the generated `## Task Tracking` stub (STE-706). */
export const TRACKING_STUB_MARKER =
  "<!-- Generated from specs/settings.yaml for older plugins. Edit that file, not this block. -->";

const STUB_SUBSECTIONS: Record<string, string> = { linear: "### Linear", jira: "### Jira" };

function stubValue(v: unknown): string {
  return Array.isArray(v) ? `[${v.map(String).join(", ")}]` : String(v);
}

/**
 * The `## Task Tracking` stub older plugins read: the marker line, the
 * heading with its `mode:` line, then the adapter sub-section in the
 * v2.101.4 line shape `readWorkspaceBinding` parses. `mode: none` renders "".
 */
export function renderTrackingStub(settings: { task_tracking: Record<string, unknown> & { mode: string } }): string {
  const tt = settings.task_tracking;
  if (tt.mode === "none") return "";
  const lines = [TRACKING_STUB_MARKER, "## Task Tracking", "", `mode: ${tt.mode}`];
  const sub = STUB_SUBSECTIONS[tt.mode];
  const binding = tt[tt.mode] as Record<string, unknown> | undefined;
  if (sub !== undefined && binding) {
    lines.push("", sub, "");
    for (const [k, v] of Object.entries(binding)) if (v !== undefined && v !== null) lines.push(`${k}: ${stubValue(v)}`);
  }
  return `${lines.join("\n")}\n`;
}
