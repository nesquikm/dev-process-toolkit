// STE-706 — one settings file (`specs/settings.yaml`) and one loader.
//
// `loadProjectSettings(projectRoot)` returns `{ source, settings }` where
// `source` says which home the values came from: the settings file, the
// legacy CLAUDE.md homes, or neither.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { checkVersionFloor, runningDptVersion, STRICT_SEMVER_RE } from "./dpt_version";
import { EFFORT_LEVELS, MERGE_POLICIES } from "./orchestration_config";
import {
  hasLegacyHome,
  legacyHomesBesideSettings,
  readLegacyDocs,
  readLegacyOrchestration,
  readLegacyRelease,
  readLegacyTaskTracking,
  readLegacyTracking,
  readLegacyVerification,
  readLegacyVideo,
} from "./project_settings_legacy";
import { VALID_KINDS } from "./release_config";
import { readTaskTrackingSection } from "./resolver_config";
import { CANONICAL_KEYS } from "./task_tracking_canonical_keys";
import { type TrackerConfig, validateTrackerConfig } from "./tracker_config";
import { CLOSED_KEYS as VERIFICATION_KEYS, VERIFY_MODES } from "./verification_config";
import { parseVideoConfig, type VideoConfig } from "./video/config";
import { parseVideoStyle, type VideoStyle } from "./video/style";

export const SETTINGS_FILE = "specs/settings.yaml";

/** Dotted paths of the keys with no v2.101.4 reader (the AC-STE-706.12 `new` rows). */
export const NEW_KEYS: readonly string[] = ["close_out.upgrade_offer"];

export type SettingsSource = "settings" | "legacy" | "none" | "both";

export interface ProjectSettings {
  schema_version?: number;
  min_dpt_version?: string;
  task_tracking: Record<string, unknown> & { mode: string; status_vocabulary?: TrackerConfig | null };
  verification: Record<string, unknown>;
  docs: Record<string, unknown>;
  orchestration: Record<string, unknown>;
  tracking: { token_stats: { enabled: boolean } } & Record<string, unknown>;
  close_out: { upgrade_offer: { enabled: boolean } };
  release: { files: unknown[] };
  video: { config: VideoConfig | null; style: VideoStyle | null };
}

/** NFR-10 refusal shape: Refusing / Remedy / Context. */
export class SettingsShapeError extends Error {
  readonly reason: string;
  constructor(reason: string, remedy?: string, context?: string) {
    super(
      [
        `Refusing: ${reason}`,
        `Remedy: ${remedy ?? `fix ${SETTINGS_FILE} to conform to the documented schema and re-run.`}`,
        `Context: ${context ?? `file=${SETTINGS_FILE}`}`,
      ].join("\n"),
    );
    this.name = "SettingsShapeError";
    this.reason = reason;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readSettingsText(projectRoot: string): string | null {
  const p = join(projectRoot, SETTINGS_FILE);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** True when `specs/settings.yaml` exists but carries no toolkit marker key at column 0. */
export function isForeignSettingsFile(projectRoot: string): boolean {
  const text = readSettingsText(projectRoot);
  if (text === null) return false;
  return !/^(schema_version|min_dpt_version)\s*:/m.test(text);
}

function hasSettingsFile(projectRoot: string): boolean {
  try {
    return readSettingsText(projectRoot) !== null && !isForeignSettingsFile(projectRoot);
  } catch {
    return false;
  }
}

/** The single home to read from; a settings file beside a legacy home is refused (AC-STE-706.7). */
function resolveSingleSource(projectRoot: string): Exclude<SettingsSource, "both"> {
  const source = detectSettingsSource(projectRoot);
  if (source === "both") throw bothHomesError(projectRoot);
  return source;
}

export function detectSettingsSource(projectRoot: string): SettingsSource {
  if (hasSettingsFile(projectRoot)) {
    return legacyHomesBesideSettings(projectRoot, RECOGNISED_HEADING_KEYS).length > 0 ? "both" : "settings";
  }
  try {
    if (hasLegacyHome(projectRoot)) return "legacy";
  } catch {
    // detection never throws
  }
  return "none";
}

/** The both-homes refusal (AC-STE-706.7): the loader never merges two homes. */
function bothHomesError(projectRoot: string): SettingsShapeError {
  const legacy = legacyHomesBesideSettings(projectRoot, RECOGNISED_HEADING_KEYS);
  return new SettingsShapeError(
    `project settings live in two homes: ${SETTINGS_FILE} and ${legacy.join(", ")}; the loader never merges two homes`,
    `run /dev-process-toolkit:upgrade to move the legacy home into ${SETTINGS_FILE}, or remove ${legacy.join(", ")}, then re-run.`,
    `file=${SETTINGS_FILE}, legacy=${legacy.join(",")}`,
  );
}

function defaults(): ProjectSettings {
  return {
    task_tracking: { mode: "none" },
    verification: {},
    docs: {},
    orchestration: {},
    tracking: { token_stats: { enabled: false } },
    close_out: { upgrade_offer: { enabled: false } },
    release: { files: [] },
    video: { config: null, style: null },
  };
}

// ---------------------------------------------------------------------------
// Closed key sets (AC-STE-706.2). Each set reuses its v2.101.4 reader's
// constants where that reader exports them.
// ---------------------------------------------------------------------------

const TOP_KEYS = [
  "schema_version",
  "min_dpt_version",
  "task_tracking",
  "verification",
  "docs",
  "orchestration",
  "tracking",
  "close_out",
  "release",
  "video",
] as const;
const TASK_TRACKING_KEYS = [
  ...CANONICAL_KEYS,
  "milestone_scan_fetch",
  "secondary_tracker",
  "linear",
  "jira",
  "status_vocabulary",
];
const BINDING_KEYS = [
  "team",
  "project",
  "default_labels",
  "repo_tag",
  "min_dpt_version",
  "linear_bug_label",
  "jira_bug_issue_type",
  "jira_issue_type",
];
const STATUS_VOCABULARY_KEYS = ["tracker_key", "statuses", "roles"];
const DOCS_KEYS = ["user_facing_mode", "packages_mode", "changelog_ci_owned", "changelog_unversioned"];
const ORCHESTRATION_KEYS = ["default_effort", "merge_policy"];
const RELEASE_ENTRY_KEYS = ["path", "kind", "field", "pattern", "replace", "optional"];

/** The moved CLAUDE.md headings (stub slot excluded) and the keys that make each a second home. */
const RECOGNISED_HEADING_KEYS: Readonly<Record<string, readonly string[]>> = {
  "## Verification": VERIFICATION_KEYS,
  "## Docs": DOCS_KEYS,
  "## Orchestration": ORCHESTRATION_KEYS,
  "## Token Stats": ["enabled"],
  "## Release Files": ["files"],
};

function shapeError(path: string, reason: string): SettingsShapeError {
  return new SettingsShapeError(
    `${SETTINGS_FILE}: \`${path}\` ${reason}`,
    undefined,
    `file=${SETTINGS_FILE}, key=${path}`,
  );
}

function at(prefix: string, key: string | number): string {
  return prefix === "" ? String(key) : `${prefix}.${key}`;
}

function requireMap(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw shapeError(path, "must be a mapping");
  return v;
}

function closeKeys(obj: Record<string, unknown>, prefix: string, allowed: readonly string[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      const label = prefix === "" ? "the top level" : `\`${prefix}\``;
      throw shapeError(at(prefix, k), `is not a recognised key; ${label} is closed to {${allowed.join(", ")}}`);
    }
  }
}

function checkString(obj: Record<string, unknown>, prefix: string, key: string): void {
  if (key in obj && typeof obj[key] !== "string") throw shapeError(at(prefix, key), "must be a string");
}

function checkBool(obj: Record<string, unknown>, prefix: string, key: string): void {
  if (key in obj && typeof obj[key] !== "boolean") throw shapeError(at(prefix, key), "must be a boolean (true or false)");
}

function checkEnum(obj: Record<string, unknown>, prefix: string, key: string, values: readonly string[]): void {
  if (key in obj && !values.includes(obj[key] as string)) {
    throw shapeError(at(prefix, key), `must be one of ${values.join(" | ")}`);
  }
}

function checkEnabledMap(parent: Record<string, unknown>, prefix: string, key: string): void {
  if (!(key in parent)) return;
  const path = at(prefix, key);
  const m = requireMap(parent[key], path);
  closeKeys(m, path, ["enabled"]);
  checkBool(m, path, "enabled");
}

function validateBinding(v: unknown, path: string): void {
  const b = requireMap(v, path);
  closeKeys(b, path, BINDING_KEYS);
  for (const k of BINDING_KEYS) {
    if (k === "default_labels") continue;
    checkString(b, path, k);
  }
  if ("default_labels" in b) {
    const labels = b.default_labels;
    if (!Array.isArray(labels) || labels.some((l) => typeof l !== "string")) {
      throw shapeError(at(path, "default_labels"), "must be a list of strings");
    }
  }
}

function validateTaskTracking(v: unknown): void {
  const tt = requireMap(v, "task_tracking");
  closeKeys(tt, "task_tracking", TASK_TRACKING_KEYS);
  for (const k of [...CANONICAL_KEYS, "secondary_tracker"]) checkString(tt, "task_tracking", k);
  checkBool(tt, "task_tracking", "milestone_scan_fetch");
  for (const adapter of ["linear", "jira"]) {
    if (adapter in tt) validateBinding(tt[adapter], `task_tracking.${adapter}`);
  }
  if (tt.status_vocabulary !== undefined && tt.status_vocabulary !== null) {
    const sv = requireMap(tt.status_vocabulary, "task_tracking.status_vocabulary");
    closeKeys(sv, "task_tracking.status_vocabulary", STATUS_VOCABULARY_KEYS);
    try {
      validateTrackerConfig(sv as unknown as TrackerConfig);
    } catch (e) {
      throw shapeError("task_tracking.status_vocabulary", `is invalid: ${errorMessage(e)}`);
    }
  }
}

function validateRelease(v: unknown): void {
  const rel = requireMap(v, "release");
  closeKeys(rel, "release", ["files"]);
  if (!("files" in rel)) return;
  if (!Array.isArray(rel.files)) throw shapeError("release.files", "must be a list of release file entries");
  rel.files.forEach((entry, i) => {
    const path = `release.files.${i}`;
    const e = requireMap(entry, path);
    closeKeys(e, path, RELEASE_ENTRY_KEYS);
    for (const k of ["path", "field", "pattern", "replace"]) checkString(e, path, k);
    checkBool(e, path, "optional");
    if (!("path" in e)) throw shapeError(at(path, "path"), "is required");
    if (!("kind" in e)) throw shapeError(at(path, "kind"), "is required");
    checkEnum(e, path, "kind", [...VALID_KINDS]);
  });
}

/** Whole-file shape check of a parsed settings file (AC-STE-706.2). */
function validateSettingsShape(parsed: Record<string, unknown>): void {
  closeKeys(parsed, "", TOP_KEYS);
  if (!("schema_version" in parsed)) throw shapeError("schema_version", "is required (set `schema_version: 1`)");
  if (parsed.schema_version !== 1) throw shapeError("schema_version", "must be 1");
  if (!("min_dpt_version" in parsed)) throw shapeError("min_dpt_version", "is required (set it to the oldest toolkit version that reads this file, as X.Y.Z)");
  if (typeof parsed.min_dpt_version !== "string" || !STRICT_SEMVER_RE.test(parsed.min_dpt_version)) {
    throw shapeError("min_dpt_version", "must be a strict X.Y.Z version");
  }
  const floor = checkVersionFloor({ minDptVersion: parsed.min_dpt_version }, runningDptVersion());
  if (!floor.ok) {
    throw new SettingsShapeError(
      `the running toolkit version ${floor.running} is below ${SETTINGS_FILE}'s min_dpt_version ${floor.floor}`,
      `upgrade the dev-process-toolkit plugin to ${floor.floor} or later.`,
      `file=${SETTINGS_FILE}, running=${floor.running}, min_dpt_version=${floor.floor}`,
    );
  }

  if ("task_tracking" in parsed) validateTaskTracking(parsed.task_tracking);

  if ("verification" in parsed) {
    const ver = requireMap(parsed.verification, "verification");
    closeKeys(ver, "verification", VERIFICATION_KEYS);
    for (const k of VERIFICATION_KEYS) if (k !== "verify_mode") checkString(ver, "verification", k);
    checkEnum(ver, "verification", "verify_mode", VERIFY_MODES);
  }

  if ("docs" in parsed) {
    const docs = requireMap(parsed.docs, "docs");
    closeKeys(docs, "docs", DOCS_KEYS);
    for (const k of DOCS_KEYS) checkBool(docs, "docs", k);
  }

  if ("orchestration" in parsed) {
    const orch = requireMap(parsed.orchestration, "orchestration");
    closeKeys(orch, "orchestration", ORCHESTRATION_KEYS);
    checkEnum(orch, "orchestration", "default_effort", EFFORT_LEVELS);
    checkEnum(orch, "orchestration", "merge_policy", MERGE_POLICIES);
  }

  if ("tracking" in parsed) {
    const tr = requireMap(parsed.tracking, "tracking");
    closeKeys(tr, "tracking", ["token_stats"]);
    checkEnabledMap(tr, "tracking", "token_stats");
  }

  if ("close_out" in parsed) {
    const co = requireMap(parsed.close_out, "close_out");
    closeKeys(co, "close_out", ["upgrade_offer"]);
    checkEnabledMap(co, "close_out", "upgrade_offer");
  }

  if ("release" in parsed) validateRelease(parsed.release);

  if ("video" in parsed) closeKeys(requireMap(parsed.video, "video"), "video", ["config", "style"]);
}

/** Run a delegated video parser, re-raising its refusal as a SettingsShapeError naming the file. */
function delegateVideo<T>(path: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw shapeError(path, `is invalid: ${errorMessage(e)}`);
  }
}

function loadFromSettingsFile(projectRoot: string): ProjectSettings {
  const text = readSettingsText(projectRoot) ?? "";
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (e) {
    throw new SettingsShapeError(`${SETTINGS_FILE} is not valid YAML: ${errorMessage(e)}`);
  }
  if (!isObj(parsed)) throw new SettingsShapeError(`${SETTINGS_FILE} is not a mapping`);
  validateSettingsShape(parsed);
  const d = defaults();
  const tt = isObj(parsed.task_tracking) ? { ...parsed.task_tracking } : d.task_tracking;
  const video = isObj(parsed.video) ? parsed.video : {};
  return {
    schema_version: parsed.schema_version as number,
    min_dpt_version: parsed.min_dpt_version as string,
    task_tracking: { mode: "none", ...tt } as ProjectSettings["task_tracking"],
    verification: isObj(parsed.verification) ? parsed.verification : d.verification,
    docs: isObj(parsed.docs) ? parsed.docs : d.docs,
    orchestration: isObj(parsed.orchestration) ? parsed.orchestration : d.orchestration,
    tracking: (isObj(parsed.tracking) ? parsed.tracking : d.tracking) as ProjectSettings["tracking"],
    close_out: (isObj(parsed.close_out) ? parsed.close_out : d.close_out) as ProjectSettings["close_out"],
    release: (isObj(parsed.release) ? parsed.release : d.release) as ProjectSettings["release"],
    video: {
      config:
        video.config === undefined
          ? null
          : delegateVideo("video.config", () => parseVideoConfig(JSON.stringify(video.config))),
      style:
        video.style === undefined ? null : delegateVideo("video.style", () => parseVideoStyle(JSON.stringify(video.style))),
    },
  };
}

function statusVocabularyError(e: unknown): never {
  throw new SettingsShapeError(
    `specs/tracker-config.yaml is invalid: ${errorMessage(e)}`,
    "fix specs/tracker-config.yaml and re-run.",
    "file=specs/tracker-config.yaml, key=task_tracking.status_vocabulary",
  );
}

/** One legacy section, parsed from its own home only (section isolation). */
function loadLegacySection<K extends keyof ProjectSettings>(projectRoot: string, section: K): ProjectSettings[K] {
  const readers: { [S in keyof ProjectSettings]?: () => ProjectSettings[S] } = {
    task_tracking: () => readLegacyTaskTracking(projectRoot, statusVocabularyError),
    verification: () => readLegacyVerification(projectRoot),
    docs: () => readLegacyDocs(projectRoot),
    orchestration: () => readLegacyOrchestration(projectRoot),
    tracking: () => readLegacyTracking(projectRoot),
    release: () => readLegacyRelease(projectRoot),
    video: () => readLegacyVideo(projectRoot),
  };
  const read = readers[section];
  return read ? (read() as ProjectSettings[K]) : defaults()[section];
}

function loadLegacy(projectRoot: string): ProjectSettings {
  return {
    task_tracking: loadLegacySection(projectRoot, "task_tracking"),
    verification: loadLegacySection(projectRoot, "verification"),
    docs: loadLegacySection(projectRoot, "docs"),
    orchestration: loadLegacySection(projectRoot, "orchestration"),
    tracking: loadLegacySection(projectRoot, "tracking"),
    close_out: defaults().close_out,
    release: loadLegacySection(projectRoot, "release"),
    video: loadLegacySection(projectRoot, "video"),
  };
}

export function loadProjectSettings(projectRoot: string): { source: SettingsSource; settings: ProjectSettings } {
  const source = resolveSingleSource(projectRoot);
  if (source === "settings") return { source, settings: loadFromSettingsFile(projectRoot) };
  return { source, settings: loadLegacy(projectRoot) };
}

export function loadProjectSection<K extends keyof ProjectSettings>(projectRoot: string, section: K): ProjectSettings[K] {
  if (resolveSingleSource(projectRoot) === "settings") return loadFromSettingsFile(projectRoot)[section];
  return loadLegacySection(projectRoot, section);
}

/** The pointer line older CLAUDE.md homes carry once settings move to `specs/settings.yaml`. */
export function renderSettingsPointer(floor: string): string {
  return `Project settings live in \`${SETTINGS_FILE}\` (requires dev-process-toolkit >= ${floor}).\n`;
}

export { renderTrackingStub } from "./project_settings_legacy";

// ---------------------------------------------------------------------------
// Front door (AC-STE-706.10): `mode <projectRoot>` / `get <section> <projectRoot>`.
// ---------------------------------------------------------------------------

const FOREIGN_NOTE = `note: ${SETTINGS_FILE} ignored: not a toolkit settings file`;

function runFrontDoor(argv: readonly string[]): number {
  const [verb, ...rest] = argv;
  const projectRoot = rest[rest.length - 1];
  if ((verb !== "mode" && verb !== "get") || projectRoot === undefined || (verb === "get" && rest.length < 2)) {
    process.stderr.write("usage: project_settings.ts mode <projectRoot> | get <section> <projectRoot>\n");
    return 2;
  }
  try {
    let out: string;
    if (verb === "mode") {
      const source = resolveSingleSource(projectRoot);
      const mode =
        source === "settings"
          ? loadFromSettingsFile(projectRoot).task_tracking.mode
          : (readTaskTrackingSection(join(projectRoot, "CLAUDE.md")).mode ?? "none");
      out = `mode: ${mode}\nsource: ${source}\n`;
    } else {
      out = `${JSON.stringify(loadProjectSection(projectRoot, rest[0] as keyof ProjectSettings), null, 2)}\n`;
    }
    if (isForeignSettingsFile(projectRoot)) process.stderr.write(`${FOREIGN_NOTE}\n`);
    process.stdout.write(out);
    return 0;
  } catch (e) {
    process.stderr.write(`${errorMessage(e)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exit(runFrontDoor(process.argv.slice(2)));
