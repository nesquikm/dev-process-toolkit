// STE-706 — one settings file (`specs/settings.yaml`) and one loader.
//
// `loadProjectSettings(projectRoot)` returns `{ source, settings }` where
// `source` says which home the values came from: the settings file, the
// legacy CLAUDE.md homes, or neither.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { checkVersionFloor, runningDptVersion, STRICT_SEMVER_RE } from "./dpt_version";
import {
  CLOSED_KEYS as VERIFICATION_KEYS,
  EFFORT_LEVELS,
  hasLegacyHome,
  legacyHomesBesideSettings,
  MERGE_POLICIES,
  MOVED_HEADINGS,
  parseTaskTrackingSection,
  readLegacyDocs,
  readLegacyOrchestration,
  readLegacyRelease,
  readLegacyTaskTracking,
  readLegacyTracking,
  readLegacyVerification,
  readLegacyVideo,
  sectionEnd,
  VERIFY_MODES,
} from "./project_settings_legacy";
import { VALID_KINDS } from "./release_config";
import { CANONICAL_KEYS } from "./task_tracking_canonical_keys";
import { type TrackerConfig, validateTrackerConfig } from "./tracker_config";
import { parseVideoConfig, type VideoConfig } from "./video/config";
import { parseVideoStyle, type VideoStyle } from "./video/style";
import { writeProjectSettings } from "./project_settings_writer";

export const SETTINGS_FILE = "specs/settings.yaml";

/** Settings-file `task_tracking` objects whose `mode` the loader defaulted (the file declared none). */
const MODE_DEFAULTED = new WeakSet<object>();

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

/** The settings file's text; an existing file that cannot be read is an NFR-10 refusal, never "absent". */
function readSettingsTextOrRefuse(projectRoot: string): string | null {
  try {
    return readSettingsText(projectRoot);
  } catch (e) {
    throw new SettingsShapeError(
      `${SETTINGS_FILE} cannot be read: ${errorMessage(e)}`,
      `make ${SETTINGS_FILE} readable (check its permissions), then re-run.`,
      `file=${SETTINGS_FILE}`,
    );
  }
}

/**
 * True when the tree still carries a v2.101.5 home the settings file would sit
 * beside: a CLAUDE.md line or file a legacy reader reads as a setting, or a
 * moved heading in a CLAUDE.md that has no `## Project Settings` section. The
 * move and a 3.x /setup write that section; v2.101.5 never did. Never throws.
 */
function hasUnmigratedLegacyHome(projectRoot: string): boolean {
  try {
    if (legacyHomesBesideSettings(projectRoot, recognisedHeadingKeys()).length > 0) return true;
    if (!hasLegacyHome(projectRoot)) return false;
    const md = join(projectRoot, "CLAUDE.md");
    return !existsSync(md) || projectSettingsSection(readFileSync(md, "utf8")) === null;
  } catch {
    return false;
  }
}

/**
 * True when `specs/settings.yaml` exists and is not the toolkit's.
 *
 * Beside an unmigrated legacy home (review round 2, R2-B3) the file is the
 * toolkit's ONLY when it carries a column-0 `min_dpt_version:` line, the key
 * every toolkit writer writes and the header requires. Anything else there is
 * the project's own file: every reader, hook and the ledger ignore it, as
 * v2.101.5 does, and the move refuses to overwrite it. An unreadable file
 * there is ignored too (R2-B3b): v2.101.5 never opened it.
 *
 * With no such home the file is the only home, and the round-1 rule stands:
 * the toolkit's when `min_dpt_version:` sits at column 0, or when it parses to
 * a mapping holding `schema_version` beside one of the toolkit's sections; a
 * file that does not parse falls back to the column-0 marker rule, so a
 * malformed toolkit file is refused, never ignored (AC-STE-709.1); an
 * unreadable file is not foreign, so the loader refuses it (review #3).
 */
export function isForeignSettingsFile(projectRoot: string): boolean {
  let text: string | null;
  try {
    text = readSettingsText(projectRoot);
  } catch {
    return hasUnmigratedLegacyHome(projectRoot);
  }
  if (text === null) return false;
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  if (/^min_dpt_version\s*:/m.test(body)) return false;
  if (hasUnmigratedLegacyHome(projectRoot)) return true;
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(body);
  } catch {
    return !/^schema_version\s*:/m.test(body);
  }
  if (!isObj(parsed)) return !/^schema_version\s*:/m.test(body);
  if ("min_dpt_version" in parsed) return false;
  const sections: readonly string[] = TOP_KEYS.filter((k) => k !== "schema_version" && k !== "min_dpt_version");
  return !("schema_version" in parsed && Object.keys(parsed).some((k) => sections.includes(k)));
}

const BOM = String.fromCharCode(0xfeff);

function hasSettingsFile(projectRoot: string): boolean {
  try {
    return existsSync(join(projectRoot, SETTINGS_FILE)) && !isForeignSettingsFile(projectRoot);
  } catch {
    return false;
  }
}

/** The single home to read from; a settings file beside a legacy home is refused (AC-STE-706.7). */
function resolveSingleSource(projectRoot: string): Exclude<SettingsSource, "both"> {
  const source = detectSettingsSource(projectRoot);
  // An unreadable settings file refuses as itself, before any two-homes verdict (review #3).
  if (source === "settings" || source === "both") readSettingsTextOrRefuse(projectRoot);
  if (source === "both") throw bothHomesError(projectRoot);
  return source;
}

export function detectSettingsSource(projectRoot: string): SettingsSource {
  if (hasSettingsFile(projectRoot)) {
    return legacyHomesBesideSettings(projectRoot, recognisedHeadingKeys()).length > 0 ? "both" : "settings";
  }
  try {
    if (hasLegacyHome(projectRoot)) return "legacy";
  } catch {
    // detection never throws
  }
  return "none";
}

/**
 * STE-710 — the home a writer writes: the source `loadProjectSettings(projectRoot)`
 * reports, resolved without parsing a legacy home (so a legacy or empty tree
 * keeps its v2.101.5 writer bytes). A both-homes tree refuses, as the loader does.
 */
export function settingsWriteSource(projectRoot: string): Exclude<SettingsSource, "both"> {
  return resolveSingleSource(projectRoot);
}

/** The both-homes refusal (AC-STE-706.7): the loader never merges two homes. */
function bothHomesError(projectRoot: string): SettingsShapeError {
  const legacy = legacyHomesBesideSettings(projectRoot, recognisedHeadingKeys());
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
// A function, not a const: `CANONICAL_KEYS` may still be uninitialised while an
// import cycle through probe #21 (which reads the settings file through this
// module) evaluates this module.
function taskTrackingKeys(): string[] {
  return [...CANONICAL_KEYS, "milestone_scan_fetch", "secondary_tracker", "linear", "jira", "status_vocabulary"];
}
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
// A function, not a const: the legacy module's key sets may still be
// uninitialised while an import cycle through a reader evaluates this module.
export function recognisedHeadingKeys(): Readonly<Record<string, readonly string[]>> {
  const [, verification, docs, orchestration, tokenStats, releaseFiles] = MOVED_HEADINGS;
  return {
    [verification]: VERIFICATION_KEYS,
    [docs]: DOCS_KEYS,
    [orchestration]: ORCHESTRATION_KEYS,
    [tokenStats]: ["enabled"],
    [releaseFiles]: ["files"],
  };
}

/**
 * STE-710 — the fixed key order of the map at dotted `path` (`[]` marks a list item); [] when unordered.
 * It is also each map's closed key set: every `closeKeys` call in this module reads its set from here,
 * so a walk of this function sees exactly the keys the loader accepts (AC-STE-706.12, review T1).
 */
export function settingsKeyOrder(path: string): readonly string[] {
  const orders: Record<string, readonly string[]> = {
    "": TOP_KEYS,
    task_tracking: taskTrackingKeys(),
    "task_tracking.linear": BINDING_KEYS,
    "task_tracking.jira": BINDING_KEYS,
    "task_tracking.status_vocabulary": STATUS_VOCABULARY_KEYS,
    verification: VERIFICATION_KEYS,
    docs: DOCS_KEYS,
    orchestration: ORCHESTRATION_KEYS,
    tracking: ["token_stats"],
    "tracking.token_stats": ["enabled"],
    close_out: ["upgrade_offer"],
    "close_out.upgrade_offer": ["enabled"],
    release: ["files"],
    "release.files[]": RELEASE_ENTRY_KEYS,
    video: ["config", "style"],
  };
  return orders[path] ?? [];
}

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
  closeKeys(m, path, settingsKeyOrder(path));
  checkBool(m, path, "enabled");
}

function validateBinding(v: unknown, path: string): void {
  const b = requireMap(v, path);
  closeKeys(b, path, settingsKeyOrder(path));
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
  closeKeys(tt, "task_tracking", settingsKeyOrder("task_tracking"));
  for (const k of [...CANONICAL_KEYS, "secondary_tracker"]) checkString(tt, "task_tracking", k);
  checkBool(tt, "task_tracking", "milestone_scan_fetch");
  for (const adapter of ["linear", "jira"]) {
    if (adapter in tt) validateBinding(tt[adapter], `task_tracking.${adapter}`);
  }
  if (tt.status_vocabulary !== undefined && tt.status_vocabulary !== null) {
    const sv = requireMap(tt.status_vocabulary, "task_tracking.status_vocabulary");
    closeKeys(sv, "task_tracking.status_vocabulary", settingsKeyOrder("task_tracking.status_vocabulary"));
    try {
      validateTrackerConfig(sv as unknown as TrackerConfig);
    } catch (e) {
      throw shapeError("task_tracking.status_vocabulary", `is invalid: ${errorMessage(e)}`);
    }
  }
}

function validateRelease(v: unknown): void {
  const rel = requireMap(v, "release");
  closeKeys(rel, "release", settingsKeyOrder("release"));
  if (!("files" in rel)) return;
  if (!Array.isArray(rel.files)) throw shapeError("release.files", "must be a list of release file entries");
  rel.files.forEach((entry, i) => {
    const path = `release.files.${i}`;
    const e = requireMap(entry, path);
    closeKeys(e, path, settingsKeyOrder("release.files[]"));
    for (const k of ["path", "field", "pattern", "replace"]) checkString(e, path, k);
    checkBool(e, path, "optional");
    if (!("path" in e)) throw shapeError(at(path, "path"), "is required");
    if (!("kind" in e)) throw shapeError(at(path, "kind"), "is required");
    checkEnum(e, path, "kind", [...VALID_KINDS]);
  });
}

/** The header every read checks: schema version, the version floor, the closed top level (AC-STE-706.2). */
function validateHeader(parsed: Record<string, unknown>): void {
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
  // After the floor: a key a newer 3.x added reads as "upgrade the plugin", not "not a recognised key".
  // The top level is closed on every read: a misspelled section name would otherwise drop that
  // section silently. It names no section, so it is no section's to own (review #4 ruling).
  closeKeys(parsed, "", settingsKeyOrder(""));
}

type SectionKey = Exclude<keyof ProjectSettings, "schema_version" | "min_dpt_version">;

/** One validator per top-level section; each checks its own section only (review #4). */
const SECTION_VALIDATORS: Record<SectionKey, (v: unknown) => void> = {
  task_tracking: validateTaskTracking,
  verification: (v) => {
    const ver = requireMap(v, "verification");
    closeKeys(ver, "verification", settingsKeyOrder("verification"));
    for (const k of VERIFICATION_KEYS) if (k !== "verify_mode") checkString(ver, "verification", k);
    checkEnum(ver, "verification", "verify_mode", VERIFY_MODES);
  },
  docs: (v) => {
    const docs = requireMap(v, "docs");
    closeKeys(docs, "docs", settingsKeyOrder("docs"));
    for (const k of DOCS_KEYS) checkBool(docs, "docs", k);
  },
  orchestration: (v) => {
    const orch = requireMap(v, "orchestration");
    closeKeys(orch, "orchestration", settingsKeyOrder("orchestration"));
    checkEnum(orch, "orchestration", "default_effort", EFFORT_LEVELS);
    checkEnum(orch, "orchestration", "merge_policy", MERGE_POLICIES);
  },
  tracking: (v) => {
    const tr = requireMap(v, "tracking");
    closeKeys(tr, "tracking", settingsKeyOrder("tracking"));
    checkEnabledMap(tr, "tracking", "token_stats");
  },
  close_out: (v) => {
    const co = requireMap(v, "close_out");
    closeKeys(co, "close_out", settingsKeyOrder("close_out"));
    checkEnabledMap(co, "close_out", "upgrade_offer");
  },
  release: validateRelease,
  video: (v) => closeKeys(requireMap(v, "video"), "video", settingsKeyOrder("video")),
};

/** Whole-file shape check of a parsed settings file (AC-STE-706.2). */
export function validateSettingsShape(parsed: Record<string, unknown>): void {
  validateHeader(parsed);
  for (const section of Object.keys(SECTION_VALIDATORS) as SectionKey[]) {
    if (section in parsed) SECTION_VALIDATORS[section](parsed[section]);
  }
}

/** Run a delegated video parser, re-raising its refusal as a SettingsShapeError naming the file. */
function delegateVideo<T>(path: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw shapeError(path, `is invalid: ${errorMessage(e)}`);
  }
}

/** The settings file parsed to a mapping; unreadable, invalid YAML or a non-mapping refuses. */
function parseSettingsFile(projectRoot: string): Record<string, unknown> {
  const text = readSettingsTextOrRefuse(projectRoot) ?? "";
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (e) {
    throw new SettingsShapeError(`${SETTINGS_FILE} is not valid YAML: ${errorMessage(e)}`);
  }
  if (!isObj(parsed)) throw new SettingsShapeError(`${SETTINGS_FILE} is not a mapping`);
  return parsed;
}

/** One section of a parsed (and for that section, validated) settings file, defaults filled in. */
function buildSection<K extends SectionKey>(parsed: Record<string, unknown>, section: K): ProjectSettings[K] {
  const d = defaults();
  const built: { [S in SectionKey]: () => ProjectSettings[S] } = {
    task_tracking: () => {
      const tt = isObj(parsed.task_tracking) ? { ...parsed.task_tracking } : d.task_tracking;
      const taskTracking = { mode: "none", ...tt } as ProjectSettings["task_tracking"];
      if (!isObj(parsed.task_tracking) || !("mode" in parsed.task_tracking)) MODE_DEFAULTED.add(taskTracking);
      return taskTracking;
    },
    verification: () => (isObj(parsed.verification) ? parsed.verification : d.verification),
    docs: () => (isObj(parsed.docs) ? parsed.docs : d.docs),
    orchestration: () => (isObj(parsed.orchestration) ? parsed.orchestration : d.orchestration),
    tracking: () => (isObj(parsed.tracking) ? parsed.tracking : d.tracking) as ProjectSettings["tracking"],
    close_out: () => ({
      upgrade_offer: {
        enabled:
          isObj(parsed.close_out) && isObj(parsed.close_out.upgrade_offer)
            ? parsed.close_out.upgrade_offer.enabled === true
            : d.close_out.upgrade_offer.enabled,
      },
    }),
    release: () => (isObj(parsed.release) ? parsed.release : d.release) as ProjectSettings["release"],
    video: () => {
      const video = isObj(parsed.video) ? parsed.video : {};
      return {
        config:
          video.config === undefined
            ? null
            : delegateVideo("video.config", () => parseVideoConfig(JSON.stringify(video.config))),
        style:
          video.style === undefined ? null : delegateVideo("video.style", () => parseVideoStyle(JSON.stringify(video.style))),
      };
    },
  };
  return built[section]() as ProjectSettings[K];
}

/** The settings file alone, as the loader reads it — no single-home check (the cleanup reads it beside a leftover). */
export function loadFromSettingsFile(projectRoot: string): ProjectSettings {
  const parsed = parseSettingsFile(projectRoot);
  validateSettingsShape(parsed);
  return {
    schema_version: parsed.schema_version as number,
    min_dpt_version: parsed.min_dpt_version as string,
    task_tracking: buildSection(parsed, "task_tracking"),
    verification: buildSection(parsed, "verification"),
    docs: buildSection(parsed, "docs"),
    orchestration: buildSection(parsed, "orchestration"),
    tracking: buildSection(parsed, "tracking"),
    close_out: buildSection(parsed, "close_out"),
    release: buildSection(parsed, "release"),
    video: buildSection(parsed, "video"),
  };
}

/**
 * One section of the settings file: the header and that section are validated,
 * no other section is — a malformed section breaks only its own readers, as a
 * malformed CLAUDE.md section did in v2.101.5 (review #4). The whole-file check
 * stays with `loadProjectSettings` and the probes that grade the file.
 */
function loadSectionFromSettingsFile<K extends keyof ProjectSettings>(projectRoot: string, section: K): ProjectSettings[K] {
  const parsed = parseSettingsFile(projectRoot);
  validateHeader(parsed);
  if (section === "schema_version" || section === "min_dpt_version") return parsed[section] as ProjectSettings[K];
  const key = section as SectionKey;
  if (key in parsed) SECTION_VALIDATORS[key](parsed[key]);
  return buildSection(parsed, key) as ProjectSettings[K];
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
  if (resolveSingleSource(projectRoot) === "settings") return loadSectionFromSettingsFile(projectRoot, section);
  return loadLegacySection(projectRoot, section);
}

/**
 * STE-712 — the close-out switch `close_out.upgrade_offer.enabled`, read
 * through the loader. True only for an explicit `true`; any loader refusal (a
 * malformed settings file, a both-homes tree) reads as off, so a tree that
 * never opted in prints exactly what it printed before the switch existed.
 */
export function upgradeOfferSwitchOn(projectRoot: string): boolean {
  try {
    return loadProjectSection(projectRoot, "close_out")?.upgrade_offer?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * STE-707 — the one dispatch every settings reader goes through. On a
 * settings-file tree the reader's view of `loadProjectSection(projectRoot,
 * section)`; on a legacy or empty tree the reader's own v2.101.4 parse (which
 * lives in the loader's legacy module), so a malformed legacy section still
 * breaks only its own readers. A both-homes tree is refused, as the loader
 * refuses it.
 */
export function viewProjectSection<K extends keyof ProjectSettings, T>(
  projectRoot: string,
  section: K,
  fromSettings: (value: ProjectSettings[K]) => T,
  fromLegacy: () => T,
): T {
  if (resolveSingleSource(projectRoot) === "settings") return fromSettings(loadProjectSection(projectRoot, section));
  return fromLegacy();
}

/** True when the settings file itself declared `task_tracking.mode` (false for the loader's default). */
export function declaresMode(taskTracking: ProjectSettings["task_tracking"]): boolean {
  return !MODE_DEFAULTED.has(taskTracking);
}

/** The 1-based line of a top-level key in `specs/settings.yaml`, or null. Never throws. */
export function settingsKeyLine(projectRoot: string, key: string): number | null {
  try {
    const text = readSettingsText(projectRoot);
    if (text === null) return null;
    const idx = text.split("\n").findIndex((l) => l.startsWith(`${key}:`));
    return idx < 0 ? null : idx + 1;
  } catch {
    return null;
  }
}

/**
 * STE-709 — the 1-based line of a dotted key path (`task_tracking.status_vocabulary`)
 * in `specs/settings.yaml`, found by indentation; null when absent. Never throws.
 */
export function settingsKeyPathLine(projectRoot: string, dotted: string): number | null {
  try {
    const text = readSettingsText(projectRoot);
    if (text === null) return null;
    const lines = text.split("\n");
    let from = 0;
    let parentIndent = -1;
    let found = -1;
    for (const seg of dotted.split(".")) {
      found = -1;
      for (let i = from; i < lines.length; i++) {
        const l = lines[i]!;
        if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
        const indent = l.length - l.trimStart().length;
        if (indent <= parentIndent) break;
        if (l.trimStart().startsWith(`${seg}:`)) {
          found = i;
          parentIndent = indent;
          from = i + 1;
          break;
        }
      }
      if (found < 0) return null;
    }
    return found + 1;
  } catch {
    return null;
  }
}

/**
 * STE-709 — the direct child keys of top-level section `section` in
 * `specs/settings.yaml`, each with its 1-based line, read from the raw text
 * (so a key the loader would refuse is still listed); null when the file or
 * the section is absent. Never throws.
 */
export function settingsSectionKeys(projectRoot: string, section: string): { key: string; line: number }[] | null {
  try {
    const text = readSettingsText(projectRoot);
    if (text === null) return null;
    const lines = text.split("\n");
    const start = lines.findIndex((l) => l.startsWith(`${section}:`));
    if (start < 0) return null;
    const out: { key: string; line: number }[] = [];
    let childIndent = -1;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
      const indent = l.length - l.trimStart().length;
      if (indent === 0) break;
      if (childIndent < 0) childIndent = indent;
      if (indent !== childIndent) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(l.trimStart());
      if (m) out.push({ key: m[1]!, line: i + 1 });
    }
    return out;
  } catch {
    return null;
  }
}

/** STE-709 — the CLAUDE.md section that carries the settings pointer (and a shared stop paragraph). */
export const PROJECT_SETTINGS_HEADING = "## Project Settings";

/**
 * STE-709 — the `## Project Settings` section of CLAUDE.md text: the 1-based
 * heading line and the lines up to the next `#`/`##` heading; null when absent.
 */
export function projectSettingsSection(claudeMdContent: string): { line: number; lines: string[] } | null {
  const lines = claudeMdContent.split("\n").map((l) => l.replace(/\r$/, ""));
  const start = lines.findIndex((l) => l === PROJECT_SETTINGS_HEADING);
  if (start < 0) return null;
  return { line: start + 1, lines: lines.slice(start + 1, sectionEnd(lines, start)) };
}

/** STE-709 — a probe violation cited as `specs/settings.yaml:<line>`. */
export interface SettingsCitedViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

/** STE-709 — build a violation against the settings file, cited as `specs/settings.yaml:<line>`. */
export function settingsViolation(projectRoot: string, line: number, reason: string, message: string): SettingsCitedViolation {
  return { file: join(projectRoot, SETTINGS_FILE), line, reason, note: `${SETTINGS_FILE}:${line} — ${reason}`, message };
}

/**
 * STE-709 — a loader refusal as probes report it: the full error `text` and a
 * one-line `reason` (`specs/settings.yaml is refused by the loader: <first line>`).
 */
export function settingsRefusal(err: unknown): { text: string; reason: string } {
  const text = err instanceof Error ? err.message : String(err);
  return { text, reason: `${SETTINGS_FILE} is refused by the loader: ${text.split("\n")[0]}` };
}

/** The pointer line older CLAUDE.md homes carry once settings move to `specs/settings.yaml`. */
export function renderSettingsPointer(floor: string): string {
  return `Project settings live in \`${SETTINGS_FILE}\`, which requires dev-process-toolkit ${floor} or newer. If the installed plugin is older than ${floor}, or you cannot tell its version, stop and ask the operator to upgrade the plugin before reading or writing any setting.\n`;
}

export { renderTrackingStub } from "./project_settings_legacy";
export { writeProjectSettings } from "./project_settings_writer";

/** STE-710 — the closed list of dotted keys the front door's `set` verb writes. */
export const SETTABLE_KEYS: readonly string[] = ["verification.verify_skill"];

// ---------------------------------------------------------------------------
// Front door (AC-STE-706.10): `mode <projectRoot>` / `get <section> <projectRoot>`.
// ---------------------------------------------------------------------------

const FOREIGN_NOTE = `note: ${SETTINGS_FILE} ignored: not a toolkit settings file`;

/**
 * STE-710 — `set <dotted key> <value> <projectRoot>`. A settings-file tree gets
 * the write; a legacy or empty tree gets none (the caller writes the legacy
 * home); a both-homes tree and a key outside `SETTABLE_KEYS` refuse (NFR-10).
 */
function runSet(key: string, value: string, projectRoot: string): string {
  if (!SETTABLE_KEYS.includes(key)) {
    throw new SettingsShapeError(
      `\`${key}\` is not a key the set verb writes`,
      `set one of: ${SETTABLE_KEYS.join(", ")}; edit ${SETTINGS_FILE} by hand for any other key.`,
      `key=${key}`,
    );
  }
  const source = resolveSingleSource(projectRoot);
  if (source === "settings") {
    const [section, leaf] = key.split(".") as [string, string];
    writeProjectSettings(projectRoot, { [section]: { [leaf]: value } });
  }
  return `source: ${source}\n`;
}

function runFrontDoor(argv: readonly string[]): number {
  const [verb, ...rest] = argv;
  const projectRoot = rest[rest.length - 1];
  if (
    (verb !== "mode" && verb !== "get" && verb !== "set") ||
    projectRoot === undefined ||
    (verb === "get" && rest.length < 2) ||
    (verb === "set" && rest.length !== 3)
  ) {
    process.stderr.write(
      "usage: project_settings.ts mode <projectRoot> | get <section> <projectRoot> | set <dotted key> <value> <projectRoot>\n",
    );
    return 2;
  }
  try {
    let out: string;
    if (verb === "set") {
      out = runSet(rest[0]!, rest[1]!, projectRoot);
    } else if (verb === "mode") {
      const source = resolveSingleSource(projectRoot);
      const mode =
        source === "settings"
          ? loadSectionFromSettingsFile(projectRoot, "task_tracking").mode
          : (parseTaskTrackingSection(join(projectRoot, "CLAUDE.md")).mode ?? "none");
      out = `mode: ${mode}\nsource: ${source}\n`;
    } else {
      const section = rest[0]!;
      const sections = TOP_KEYS.filter((k) => k !== "schema_version" && k !== "min_dpt_version");
      if (!sections.includes(section as (typeof sections)[number])) {
        throw new SettingsShapeError(
          `\`${section}\` is not a settings section`,
          `get one of: ${sections.join(", ")}.`,
          `verb=get, section=${section}`,
        );
      }
      out = `${JSON.stringify(loadProjectSection(projectRoot, section as keyof ProjectSettings), null, 2)}\n`;
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
