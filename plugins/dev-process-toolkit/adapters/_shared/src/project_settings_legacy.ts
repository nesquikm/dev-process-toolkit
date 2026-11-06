// STE-706 — the legacy half of the settings loader.
//
// Reads the v2.101.4 homes (CLAUDE.md headings, the standalone
// `milestone_scan_fetch:` line, `specs/tracker-config.yaml`, and
// video config and style files) with the same parse today's readers
// perform, and returns each section in the settings file's snake_case shape.
//
// STE-707 — the readers' private CLAUDE.md parses moved here unchanged, so
// the parse logic lives in one module. Each reader imports its parse from
// here for the legacy source and reads `specs/settings.yaml` through the
// loader otherwise. What this module imports from a reader module (a
// validator, a whole-file parser, a source normalizer) is called only at
// read time, never while modules load, so the reader -> loader -> legacy
// import cycle is safe.

import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { videoConfigPath, videoStylePath } from "./dpt_paths";

import { assertRepoTagForwarded } from "./create_idempotency_probe";
import { normalizeDocsSource } from "./docs_config";
import { FIRST_GATED_DPT_VERSION, nfr10Message, STRICT_SEMVER_RE } from "./dpt_version";
import { normalizeFrontmatterSource } from "./frontmatter";
import { compareSemver } from "./migrations/coverage";
import { normalizeOrchestrationSource } from "./orchestration_config";
import { MissingReleaseFilesBlockError, parseReleaseFiles } from "./release_config";
import { type TrackerConfig, TrackerConfigShapeError, validateTrackerConfig } from "./tracker_config";
import { parseVideoConfig, type VideoConfig } from "./video/config";
import { parseVideoStyle, type VideoStyle } from "./video/style";

/** The CLAUDE.md headings whose sections moved into `specs/settings.yaml`. */
export const MOVED_HEADINGS = [
  "## Task Tracking",
  "## Verification",
  "## Docs",
  "## Orchestration",
  "## Token Stats",
  "## Release Files",
] as const;

/** Named members of `MOVED_HEADINGS`, for the modules that name one heading in a message. */
export const TASK_TRACKING_HEADING = MOVED_HEADINGS[0];
export const DOCS_HEADING = MOVED_HEADINGS[2];
export const RELEASE_FILES_HEADING = MOVED_HEADINGS[5];
/** The CLAUDE.md `## Release Files` heading line, as `parseReleaseFiles` locates it. */
export const RELEASE_FILES_HEADING_RE = /^##\s+Release Files\s*$/m;
/** The CLAUDE.md `## Task Tracking` heading line, anchored (the managed-signal pattern). */
export const TASK_TRACKING_HEADING_RE = /^##\s+Task Tracking\s*$/m;
/** The CLAUDE.md `## Docs` heading line, anchored — `## Documentation` is not a match. */
export const DOCS_HEADING_RE = /^##\s+Docs\s*$/m;
/** A CLAUDE.md line opening with the `## Docs` heading word (probe #19's looser match). */
export const DOCS_HEADING_PREFIX_RE = /^##\s+Docs\b/m;
/** The `## Task Tracking` workspace-binding subsection heading per adapter. */
export const TRACKER_SUBSECTION_HEADINGS: Readonly<Record<"linear" | "jira", string>> = {
  linear: "### Linear",
  jira: "### Jira",
};

/** The legacy tracker status-vocabulary file, as a project-relative path. */
export const TRACKER_CONFIG = "specs/tracker-config.yaml";
// Derived from the shared path helpers, never retyped (AC-STE-663.1).
/** The legacy video config and style files, as project-relative paths. */
export const VIDEO_CONFIG = relative("/", videoConfigPath("/"));
export const VIDEO_STYLE = relative("/", videoStylePath("/"));
/** The legacy video config file under `projectRoot` (the `.dpt/video/` home a writer creates). */
export function legacyVideoConfigPath(projectRoot: string): string {
  return videoConfigPath(projectRoot);
}
/** The legacy video style file under `projectRoot`. */
export function legacyVideoStylePath(projectRoot: string): string {
  return videoStylePath(projectRoot);
}
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
          const keys = Object.hasOwn(recognisedKeys, l) ? recognisedKeys[l] : undefined;
          if (!keys) return false;
          for (let j = i + 1; j < lines.length && !/^#{1,2} /.test(lines[j]!); j++) {
            const m = /^([a-z_][a-z0-9_]*)\s*:/.exec(lines[j]!);
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

// ---------------------------------------------------------------------------
// STE-707 — the readers' v2.101.4 CLAUDE.md parses, moved here unchanged.
// Each reader re-exports the types, errors and constants it always exported.
// ---------------------------------------------------------------------------

/** `## Task Tracking` as a flat key:value map; {} when the file or section is absent. */
export function parseTaskTrackingSection(claudeMdPath: string): Record<string, string> {
  if (!existsSync(claudeMdPath)) return {};
  const md = readFileSync(claudeMdPath, "utf8");
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return {};
  const result: Record<string, string> = {};
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    result[key!] = (rawValue ?? "").trim();
  }
  return result;
}

/** The `## Task Tracking` line scan of probe `tracker_project_milestone_attached`: a non-none `mode:`. */
export function legacyIsTrackerMode(claudeMdContent: string): boolean {
  const lines = claudeMdContent.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return false;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    // Aligned with task_tracking_canonical_keys.ts boundary-detection convention.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = /^mode:\s*(\S+)\s*$/.exec(lines[i]!);
    if (m) {
      const mode = m[1]!;
      return mode !== "none" && mode !== "";
    }
  }
  return false;
}

// --- workspace binding (`### Linear` / `### Jira`) -------------------------

export interface WorkspaceBinding {
  team?: string;
  project?: string;
  defaultLabels?: string[];
  /** STE-602 — this repository's ownership label in a shared container. */
  repoTag?: string;
  /** STE-602 — the lowest toolkit version allowed to write into the shared container. */
  minDptVersion?: string;
  /** STE-679 — `jira_bug_issue_type:` override for `--bug` creates (Jira). */
  jiraBugIssueType?: string;
  /** STE-679 — `linear_bug_label:` override for `--bug` creates (Linear). */
  linearBugLabel?: string;
  /** STE-602 — always present; `true` exactly when a non-empty `repo_tag` is declared. */
  shared: boolean;
}

export type WorkspaceAdapterKey = "linear" | "jira";

/**
 * STE-602 — a malformed shared-container declaration (or an unreadable
 * CLAUDE.md). NFR-10 three-line message: verdict, `Remedy:`, `Context:`.
 * Tag membership (class 2) is refused by `RepoTagBindingError` instead.
 */
export class WorkspaceBindingError extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super(nfr10Message(verdict, remedy, context));
    this.name = "WorkspaceBindingError";
  }
}

const REPO_TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function locateSubsection(lines: string[], adapterKey: WorkspaceAdapterKey): string[] | null {
  const sectionStart = lines.findIndex((l) => l === "## Task Tracking");
  if (sectionStart < 0) return null;
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    // Matches `# H1` or `## H2` to align with the codebase convention
    // (task_tracking_canonical_keys.ts, migrate-task-tracking-*.ts). H1 in
    // CLAUDE.md only appears at the file head, so this is equivalent to
    // `/^##\s/` in practice but keeps the parser shape consistent.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }
  const subTitle = adapterKey === "linear" ? "### Linear" : "### Jira";
  let subStart = -1;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (lines[i] === subTitle) {
      subStart = i;
      break;
    }
  }
  if (subStart < 0) return null;
  let subEnd = sectionEnd;
  for (let i = subStart + 1; i < sectionEnd; i++) {
    if (/^#{2,3}\s/.test(lines[i]!)) {
      subEnd = i;
      break;
    }
  }
  return lines.slice(subStart + 1, subEnd);
}

function parseInlineYamlArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "[]") return [];
  const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim().length === 0) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .map((s) => s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
    .filter((s) => s.length > 0);
}

/** The v2.101.4 `readWorkspaceBinding` parse of the `### Linear` / `### Jira` sub-section. */
export function parseWorkspaceBinding(claudeMdPath: string, adapterKey: WorkspaceAdapterKey): WorkspaceBinding {
  if (!existsSync(claudeMdPath)) return { shared: false };
  const context = `file=${basename(claudeMdPath)}, adapter=${adapterKey}, helper=readWorkspaceBinding`;
  let content: string;
  try {
    content = readFileSync(claudeMdPath, "utf-8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown";
    refuseBinding(
      `CLAUDE.md at ${claudeMdPath} exists but cannot be read (${code}) — the shared-container declaration cannot be verified.`,
      `make ${claudeMdPath} a readable regular file, or remove it.`,
      `${context}, path=${claudeMdPath}, error=${code}`,
    );
  }
  const parsed = parseBindingSubsection(content, adapterKey);
  if (!parsed) return { shared: false };
  validateBindingDeclaration(parsed.result, parsed.occurrences, context);
  return { ...parsed.result, shared: parsed.result.repoTag !== undefined };
}

/**
 * The `### Linear` / `### Jira` sub-section of CLAUDE.md text as the binding's
 * declared values plus every `repo_tag` / `min_dpt_version` occurrence; null
 * when there is no such sub-section. Validation is the caller's.
 */
export function parseBindingSubsection(
  content: string,
  adapterKey: WorkspaceAdapterKey,
): { result: Omit<WorkspaceBinding, "shared">; occurrences: Record<string, string[]> } | null {
  const lines = content.split("\n");
  const sub = locateSubsection(lines, adapterKey);
  if (!sub) return null;

  const result: Omit<WorkspaceBinding, "shared"> = {};
  const occurrences: Record<string, string[]> = { repo_tag: [], min_dpt_version: [] };
  for (const raw of sub) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (key in occurrences) occurrences[key]!.push(value);
    if (key === "default_labels") {
      result.defaultLabels = parseInlineYamlArray(value);
      continue;
    }
    if (value.length === 0) continue;
    if (key === "team") result.team = value;
    else if (key === "project") result.project = value;
    else if (key === "repo_tag") result.repoTag = value;
    else if (key === "min_dpt_version") result.minDptVersion = value;
    else if (key === "jira_bug_issue_type" && adapterKey === "jira") result.jiraBugIssueType = value;
    else if (key === "linear_bug_label" && adapterKey === "linear") result.linearBugLabel = value;
  }
  return { result, occurrences };
}

export function refuseBinding(verdict: string, remedy: string, context: string): never {
  throw new WorkspaceBindingError(`WorkspaceBindingError: ${verdict}`, remedy, context);
}

/**
 * STE-602 — the one validation pass over `repo_tag` / `min_dpt_version`.
 * Vacuous for an undeclared sub-section, so that path is unchanged.
 */
export function validateBindingDeclaration(
  result: Omit<WorkspaceBinding, "shared">,
  occurrences: Record<string, string[]>,
  context: string,
): void {
  // Class 5 — a key written twice is refused, never last-wins.
  for (const [key, values] of Object.entries(occurrences)) {
    if (values.length > 1) {
      refuseBinding(
        `\`${key}\` is written ${values.length} times (values: ${values.map((v) => `"${v}"`).join(", ")}) — a duplicated declaration key is ambiguous and is never resolved last-wins.`,
        `keep exactly one \`${key}:\` line in the tracker sub-section.`,
        `${context}, key=${key}, value="${values[values.length - 1]}"`,
      );
    }
  }
  const tag = result.repoTag;
  const floor = result.minDptVersion;
  // Class 1 — tag shape.
  if (tag !== undefined && !REPO_TAG_RE.test(tag)) {
    refuseBinding(
      `repo_tag "${tag}" is not lowercase-kebab (^[a-z0-9]+(-[a-z0-9]+)*$).`,
      `rename the tag to lowercase letters, digits and single hyphens (e.g. "glade-be"), in both \`repo_tag\` and \`default_labels\`.`,
      `${context}, key=repo_tag, value="${tag}"`,
    );
  }
  // Class 3 — strict X.Y.Z floor.
  if (floor !== undefined && !STRICT_SEMVER_RE.test(floor)) {
    refuseBinding(
      `min_dpt_version "${floor}" is not strict X.Y.Z (no \`v\` prefix, no pre-release suffix).`,
      `write the floor as a bare release version, e.g. "${FIRST_GATED_DPT_VERSION}".`,
      `${context}, key=min_dpt_version, value="${floor}"`,
    );
  }
  // Class 4 — the two keys come as a pair.
  if (tag !== undefined && floor === undefined) {
    refuseBinding(
      `repo_tag "${tag}" is declared with no min_dpt_version — a shared container needs a toolkit version floor.`,
      `add \`min_dpt_version: ${FIRST_GATED_DPT_VERSION}\` (or later) beside \`repo_tag\`, or remove \`repo_tag\`.`,
      `${context}, key=repo_tag, value="${tag}"`,
    );
  }
  if (floor !== undefined && tag === undefined) {
    refuseBinding(
      `min_dpt_version "${floor}" is declared with no repo_tag — a floor without an ownership label declares nothing.`,
      `add \`repo_tag: <lowercase-kebab>\` beside the floor, or remove \`min_dpt_version\`.`,
      `${context}, key=min_dpt_version, value="${floor}"`,
    );
  }
  // Class 2 — tag membership, through its one definition.
  assertRepoTagForwarded(tag, result.defaultLabels);
  // Class 6 — a floor below the first gated release admits ungated clients.
  if (floor !== undefined && (compareSemver(floor, FIRST_GATED_DPT_VERSION) ?? 0) < 0) {
    refuseBinding(
      `min_dpt_version "${floor}" is below FIRST_GATED_DPT_VERSION ${FIRST_GATED_DPT_VERSION} — such a floor admits clients that carry no shared-container write gate.`,
      `raise \`min_dpt_version\` to ${FIRST_GATED_DPT_VERSION} or later.`,
      `${context}, key=min_dpt_version, value="${floor}"`,
    );
  }
}

// --- `## Verification` ------------------------------------------------------

export type VerifyMode = "advisory" | "blocking" | "manual";

export interface VerificationConfig {
  verifySkill: string | null;
  verifyMode: VerifyMode;
  /** Declared run command; `"none"`; `""` for a bare key; null when absent. */
  runCmd: string | null;
  /** Declared e2e command; `"none"`; `""` for a bare key; null when absent. */
  e2eCmd: string | null;
}

/**
 * Thrown when the `## Verification` section contains an out-of-closed-set
 * key, or a `verify_mode` value outside {advisory, blocking, manual}.
 * Callers surface key + value so the operator can fix the exact line.
 */
export class MalformedVerificationConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string, detail: string) {
    super(
      `verification config key "${key}" with value "${value}" is malformed — ${detail}`,
    );
    this.name = "MalformedVerificationConfigError";
    this.key = key;
    this.value = value;
  }
}

/** The `## Verification` section's one anchor, matched as a WHOLE LINE. */
export const VERIFICATION_HEADING = "## Verification";

export const VERIFY_MODES: readonly string[] = ["advisory", "blocking", "manual"];

export const VERIFICATION_DEFAULTS: VerificationConfig = {
  verifySkill: null,
  verifyMode: "advisory",
  runCmd: null,
  e2eCmd: null,
};

/** The closed key set, in canonical authoring (and render) order. */
export const CLOSED_KEYS = [
  "verify_skill",
  "verify_mode",
  "run_cmd",
  "e2e_cmd",
] as const;

/**
 * STE-710 — moved here from `verification_config.ts` (re-exported there).
 * Render a VerificationConfig back into a `## Verification` section body.
 *
 * Only DECLARED keys are emitted: a null `runCmd`/`e2eCmd`/`verifySkill`
 * produces no line at all, so an absent key round-trips as absent and the
 * literal `none` round-trips as `none`. `verifyMode` always has a value
 * (default `advisory`) and is always emitted.
 *
 * DO NOT USE THIS TO REWRITE AN EXISTING BLOCK. The always-emitted
 * `verify_mode` line is the trap: `readVerificationConfig` defaults that field
 * to `advisory`, so round-tripping a block that never declared the key STAMPS
 * `verify_mode: advisory` onto it — and `resolveVerifyMode` then returns that
 * written value instead of the `blocking` it owes a declared-runnable project.
 * The default would be defeated silently, on exactly the projects a rewrite
 * touches, and the operator's own comments and key order would be eaten with
 * it. A writer that edits a block someone already authored must SPLICE the
 * lines it needs (see `migrations/entries/verification_run_keys.ts`); this
 * renderer is for composing a section from scratch.
 */
export function renderVerificationSection(config: VerificationConfig): string {
  const lines: string[] = [VERIFICATION_HEADING, ""];
  if (config.verifySkill !== null) {
    lines.push(`verify_skill: ${config.verifySkill}`);
  }
  lines.push(`verify_mode: ${config.verifyMode}`);
  if (config.runCmd !== null) lines.push(`run_cmd: ${config.runCmd}`);
  if (config.e2eCmd !== null) lines.push(`e2e_cmd: ${config.e2eCmd}`);
  return `${lines.join("\n")}\n`;
}

/** The resolved record plus the keys the author ACTUALLY WROTE. */
export interface ParsedVerificationSection {
  config: VerificationConfig;
  declaredKeys: ReadonlySet<string>;
}

/** Index of the section heading in `lines`, or -1 when there is no section. */
function verificationSectionIndex(lines: readonly string[]): number {
  return lines.findIndex((l) => l === VERIFICATION_HEADING);
}

/** The 1-based line of the `## Verification` heading, or null. Never throws. */
export function legacyVerificationSectionLine(claudeMdPath: string): number | null {
  let body: string;
  try {
    body = readFileSync(claudeMdPath, "utf8");
  } catch {
    return null;
  }
  const idx = verificationSectionIndex(normalizeFrontmatterSource(body).split("\n"));
  return idx < 0 ? null : idx + 1;
}

/**
 * Parse the `## Verification` section of CLAUDE.md.
 *
 * @throws MalformedVerificationConfigError on an out-of-closed-set key
 * inside the section, or a `verify_mode` value outside
 * {advisory, blocking, manual}.
 */
export function parseVerificationSection(claudeMdPath: string): ParsedVerificationSection {
  const declaredKeys = new Set<string>();
  if (!existsSync(claudeMdPath)) {
    return { config: { ...VERIFICATION_DEFAULTS }, declaredKeys };
  }
  const md = normalizeFrontmatterSource(readFileSync(claudeMdPath, "utf8"));
  const lines = md.split("\n");
  const startIdx = verificationSectionIndex(lines);
  if (startIdx < 0) return { config: { ...VERIFICATION_DEFAULTS }, declaredKeys };

  const result: VerificationConfig = { ...VERIFICATION_DEFAULTS };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    declaredKeys.add(key!);
    switch (key) {
      case "verify_skill":
        result.verifySkill = value;
        break;
      case "verify_mode":
        if (!VERIFY_MODES.includes(value)) {
          throw new MalformedVerificationConfigError(
            key!,
            value,
            'expected one of lowercase "advisory" | "blocking" | "manual"',
          );
        }
        result.verifyMode = value as VerifyMode;
        break;
      case "run_cmd":
        result.runCmd = value;
        break;
      case "e2e_cmd":
        result.e2eCmd = value;
        break;
      default:
        throw new MalformedVerificationConfigError(
          key!,
          value,
          `the ## Verification key set is closed to {${CLOSED_KEYS.join(", ")}}`,
        );
    }
  }
  return { config: result, declaredKeys };
}

// --- `## Docs` --------------------------------------------------------------

export interface DocsConfig {
  userFacingMode: boolean;
  packagesMode: boolean;
  changelogCiOwned: boolean;
  changelogUnversioned: boolean;
}

/**
 * Thrown when the `## Docs` section contains a value that is neither
 * lowercase `true` nor lowercase `false`. Callers re-render as NFR-10
 * canonical shape.
 */
export class MalformedDocsConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string) {
    super(
      `docs config key "${key}" has malformed value "${value}" — expected lowercase "true" or "false"`,
    );
    this.name = "MalformedDocsConfigError";
    this.key = key;
    this.value = value;
  }
}

export const DOCS_ALL_FALSE: DocsConfig = {
  userFacingMode: false,
  packagesMode: false,
  changelogCiOwned: false,
  changelogUnversioned: false,
};

function parseDocsBool(key: string, raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new MalformedDocsConfigError(key, raw);
}

/** The v2.101.4 `readDocsConfig` parse. @throws MalformedDocsConfigError */
export function parseDocsConfig(claudeMdPath: string): DocsConfig {
  if (!existsSync(claudeMdPath)) return { ...DOCS_ALL_FALSE };
  const md = readFileSync(claudeMdPath, "utf8");
  const lines = normalizeDocsSource(md).split("\n");
  const startIdx = lines.findIndex((l) => l === "## Docs");
  if (startIdx < 0) return { ...DOCS_ALL_FALSE };

  const result: DocsConfig = { ...DOCS_ALL_FALSE };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    switch (key) {
      case "user_facing_mode":
        result.userFacingMode = parseDocsBool(key, value);
        break;
      case "packages_mode":
        result.packagesMode = parseDocsBool(key, value);
        break;
      case "changelog_ci_owned":
        result.changelogCiOwned = parseDocsBool(key, value);
        break;
      case "changelog_unversioned":
        result.changelogUnversioned = parseDocsBool(key, value);
        break;
    }
  }
  return result;
}

// --- `## Orchestration` -----------------------------------------------------

/** Closed set of legal `default_effort` values (shared authority for STE-464). */
export const EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
] as const;

/** Closed set of legal `merge_policy` values (shared authority for STE-464). */
export const MERGE_POLICIES = ["offer", "auto", "never"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export type MergePolicy = (typeof MERGE_POLICIES)[number];

export interface OrchestrationConfig {
  defaultEffort: EffortLevel;
  mergePolicy: MergePolicy;
}

export const ORCHESTRATION_DEFAULTS: OrchestrationConfig = {
  defaultEffort: "ultracode",
  mergePolicy: "offer",
};

/**
 * Thrown when the `## Orchestration` block carries a value outside its
 * closed set or an unknown top-level key. NFR-10 canonical refusal shape.
 */
export class MalformedOrchestrationConfigError extends Error {
  readonly line: number;
  constructor(line: number, reason: string, remedy: string) {
    super(
      [
        `CLAUDE.md:${line} — malformed \`## Orchestration\` block`,
        `Refusing: ${reason}`,
        `Remedy: ${remedy}`,
        `Context: mode=orchestration-config, file=CLAUDE.md, line=${line}`,
      ].join("\n"),
    );
    this.name = "MalformedOrchestrationConfigError";
    this.line = line;
  }
}

function requireMember<T extends string>(
  set: readonly T[],
  value: string,
  lineNo: number,
  key: string,
  noun: string,
): T {
  if (!(set as readonly string[]).includes(value)) {
    throw new MalformedOrchestrationConfigError(
      lineNo,
      `\`${key}: ${value}\` is not a legal ${noun}.`,
      `set ${key} to one of ${set.join(" | ")} ` +
        `(exact lowercase literal, unquoted).`,
    );
  }
  return value as T;
}

/** The v2.101.4 `readOrchestrationConfig` parse of `<projectRoot>/CLAUDE.md`. */
export function parseOrchestrationConfig(projectRoot: string): OrchestrationConfig {
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) return { ...ORCHESTRATION_DEFAULTS };
  const md = normalizeOrchestrationSource(readFileSync(claudeMdPath, "utf8"));
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Orchestration");
  if (startIdx < 0) return { ...ORCHESTRATION_DEFAULTS };

  const result: OrchestrationConfig = { ...ORCHESTRATION_DEFAULTS };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    const lineNo = i + 1;
    switch (key) {
      case "default_effort":
        result.defaultEffort = requireMember(EFFORT_LEVELS, value, lineNo, key, "effort level");
        break;
      case "merge_policy":
        result.mergePolicy = requireMember(MERGE_POLICIES, value, lineNo, key, "merge policy");
        break;
      default:
        throw new MalformedOrchestrationConfigError(
          lineNo,
          `unknown key \`${key}\` in the \`## Orchestration\` block ` +
            `(closed schema: default_effort, merge_policy).`,
          `remove \`${key}\` or rename it to a recognized key.`,
        );
    }
  }
  return result;
}

// --- `## Token Stats` -------------------------------------------------------

export interface TokenStatsConfig {
  enabled: boolean;
}

/**
 * Thrown when the `## Token Stats` section contains an out-of-closed-set
 * key, or an `enabled` value outside {true, false}.
 */
export class MalformedTokenStatsConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string, detail: string) {
    super(
      `token stats config key "${key}" with value "${value}" is malformed — ${detail}`,
    );
    this.name = "MalformedTokenStatsConfigError";
    this.key = key;
    this.value = value;
  }
}

/** The v2.101.4 `readTokenStatsConfig` parse. @throws MalformedTokenStatsConfigError */
export function parseTokenStatsConfig(claudeMdPath: string): TokenStatsConfig {
  if (!existsSync(claudeMdPath)) return { enabled: false };
  const md = readFileSync(claudeMdPath, "utf8");
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Token Stats");
  if (startIdx < 0) return { enabled: false };

  const result: TokenStatsConfig = { enabled: false };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    switch (key) {
      case "enabled":
        if (value !== "true" && value !== "false") {
          throw new MalformedTokenStatsConfigError(
            key!,
            value,
            'expected lowercase literal "true" | "false"',
          );
        }
        result.enabled = value === "true";
        break;
      default:
        throw new MalformedTokenStatsConfigError(
          key!,
          value,
          "the ## Token Stats key set is closed to {enabled}",
        );
    }
  }
  return result;
}

// --- `milestone_scan_fetch:` ------------------------------------------------

/** The standalone top-level `milestone_scan_fetch: true` line (only the literal `true` enables it). */
export function parseMilestoneScanFetch(claudeMdPath: string): boolean {
  if (!existsSync(claudeMdPath)) return false;
  let text: string;
  try {
    text = normalizeFrontmatterSource(readFileSync(claudeMdPath, "utf-8"));
  } catch {
    return false;
  }
  return /^milestone_scan_fetch:[ \t]*true[ \t]*$/m.test(text);
}

// --- `specs/tracker-config.yaml` --------------------------------------------

export const TRACKER_CONFIG_FILENAME = "tracker-config.yaml";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The v2.101.4 `readTrackerConfig` read of `<specsDir>/tracker-config.yaml`; null when absent. */
export function parseTrackerConfigFile(specsDir: string): TrackerConfig | null {
  const path = join(specsDir, TRACKER_CONFIG_FILENAME);
  if (!existsSync(path)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new TrackerConfigShapeError(
      `cannot read specs/${TRACKER_CONFIG_FILENAME}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      `mode=tracker-config, stage=read, path=${path}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    throw new TrackerConfigShapeError(
      `specs/${TRACKER_CONFIG_FILENAME} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      "fix the YAML syntax (check indentation, colons, and quoting).",
      `mode=tracker-config, stage=parse, path=${path}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new TrackerConfigShapeError(
      `specs/${TRACKER_CONFIG_FILENAME} top-level must be a mapping, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      undefined,
      `mode=tracker-config, stage=parse, path=${path}`,
    );
  }

  const config = parsed as TrackerConfig;
  validateTrackerConfig(config);
  return config;
}

// --- video config and style files -------------------------------------------

/** The legacy video config file, parsed; null when absent. Throws the parser's refusal. */
export function readLegacyVideoConfigFile(projectRoot: string): VideoConfig | null {
  const path = videoConfigPath(projectRoot);
  return existsSync(path) ? parseVideoConfig(readFileSync(path, "utf8")) : null;
}

/**
 * The legacy video config file, parsed. Unlike `readLegacyVideoConfigFile`, an
 * absent file throws the raw read error (the v2.101.5 behaviour the video
 * pipeline's stages keep).
 */
export function readLegacyVideoConfigFileStrict(projectRoot: string): VideoConfig {
  return parseVideoConfig(readFileSync(videoConfigPath(projectRoot), "utf8"));
}

/** The legacy video style file, parsed; null when absent. Throws the parser's refusal. */
export function readLegacyVideoStyleFile(projectRoot: string): VideoStyle | null {
  const path = videoStylePath(projectRoot);
  return existsSync(path) ? parseVideoStyle(readFileSync(path, "utf8")) : null;
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
  const section = parseTaskTrackingSection(md);
  const tt: LegacyTaskTracking = { ...section, mode: section.mode ?? "none" };
  tt.milestone_scan_fetch = parseMilestoneScanFetch(md);
  if (tt.mode === "linear" || tt.mode === "jira") {
    const { shared: _shared, ...binding } = parseWorkspaceBinding(md, tt.mode);
    tt[tt.mode] = definedSnake(binding);
  }
  Object.defineProperty(tt, "status_vocabulary", {
    enumerable: true,
    configurable: true,
    get(): TrackerConfig | null {
      try {
        return parseTrackerConfigFile(join(projectRoot, "specs"));
      } catch (e) {
        return onStatusVocabularyError(e);
      }
    },
  });
  return tt;
}

export function readLegacyVerification(projectRoot: string): Record<string, unknown> {
  return snake(parseVerificationSection(claudeMd(projectRoot)).config);
}

export function readLegacyDocs(projectRoot: string): Record<string, unknown> {
  return snake(parseDocsConfig(claudeMd(projectRoot)));
}

export function readLegacyOrchestration(projectRoot: string): Record<string, unknown> {
  return snake(parseOrchestrationConfig(projectRoot));
}

export function readLegacyTracking(projectRoot: string): {
  token_stats: { enabled: boolean };
  gate_outcomes: { enabled: boolean };
} {
  // STE-715: no legacy home carries gate_outcomes; it reads its default.
  return { token_stats: parseTokenStatsConfig(claudeMd(projectRoot)), gate_outcomes: { enabled: false } };
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

const STUB_SUBSECTIONS: Record<string, string> = TRACKER_SUBSECTION_HEADINGS;

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

/**
 * STE-709 — the index of the first `#`/`##` heading after `headingIdx`, or
 * `lines.length`: where a CLAUDE.md section that starts at `headingIdx` ends.
 */
export function sectionEnd(lines: readonly string[], headingIdx: number): number {
  for (let j = headingIdx + 1; j < lines.length; j++) {
    if (/^#{1,2}\s/.test(lines[j]!)) return j;
  }
  return lines.length;
}

/**
 * STE-709 — every `## Task Tracking` stub slot in CLAUDE.md text: the
 * heading (with the marker line when it sits directly above) through the
 * line before the next `#`/`##` heading, trailing blank lines dropped. `line`
 * is the slot's first 1-based line.
 */
export function trackingStubSlots(claudeMdContent: string): { line: number; text: string; lines: string[] }[] {
  const lines = claudeMdContent.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: { line: number; text: string; lines: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== TASK_TRACKING_HEADING) continue;
    const start = i > 0 && lines[i - 1] === TRACKING_STUB_MARKER ? i - 1 : i;
    const slot = lines.slice(start, sectionEnd(lines, i));
    while (slot.length > 0 && slot[slot.length - 1]!.trim() === "") slot.pop();
    out.push({ line: start + 1, text: slot.join("\n"), lines: slot });
  }
  return out;
}
