// buildResolverConfig — FR-65 shared glue between Schema L (CLAUDE.md
// `## Task Tracking`) + Schema W (adapter `resolver:` frontmatter block) +
// resolveFRArgument's ResolverConfig shape.
//
// Before this helper existed, every skill that called resolveFRArgument
// hand-assembled the config from CLAUDE.md + adapter metadata — glue that
// duplicates across /spec-write, /implement, /spec-archive.
//
// `readTaskTrackingSection` lives here as an INTERNAL helper rather than a
// separate module — there is only one caller (the config builder below).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { declaresMode, viewProjectSection } from "./project_settings";
import { parseTaskTrackingSection } from "./project_settings_legacy";
import type { ResolverConfig, TrackerConfig } from "./resolve";

/**
 * Thrown when an adapter file is unreadable, missing its `resolver:` block,
 * or contains an invalid regex in a Schema W field. Callers re-render as
 * NFR-10 canonical shape (AC-65.6).
 */
export class MalformedAdapterMetadataError extends Error {
  readonly adapter: string;
  readonly reason: string;
  constructor(adapter: string, reason: string) {
    super(`adapter "${adapter}" metadata malformed: ${reason}`);
    this.name = "MalformedAdapterMetadataError";
    this.adapter = adapter;
    this.reason = reason;
  }
}

/**
 * The `## Task Tracking` section as a flat key:value map. Returns {} when
 * the file is absent OR the section is absent (both = `mode: none`
 * canonical form per AC-29.5).
 *
 * STE-707 — derived from `loadProjectSection(projectRoot, "task_tracking")`
 * with the project root resolved as the directory of `claudeMdPath`: on a
 * settings-file tree the section's declared string keys (the adapter
 * sub-sections and the status vocabulary are not flat keys); on a legacy
 * tree the v2.101.4 parse, which lives in the loader's legacy module.
 */
export function readTaskTrackingSection(claudeMdPath: string): Record<string, string> {
  return viewProjectSection(dirname(claudeMdPath), "task_tracking", flatTaskTracking, () =>
    parseTaskTrackingSection(claudeMdPath),
  );
}

function flatTaskTracking(tt: Parameters<typeof declaresMode>[0]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(tt)) {
    if (key === "status_vocabulary") continue;
    if (key === "mode" && !declaresMode(tt)) continue;
    const value = tt[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function buildTrackerConfig(adaptersDir: string, key: string): TrackerConfig {
  const adapterPath = join(adaptersDir, `${key}.md`);
  if (!existsSync(adapterPath)) {
    throw new MalformedAdapterMetadataError(key, `adapter file not found at ${adapterPath}`);
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(readFileSync(adapterPath, "utf8"));
  } catch (err) {
    throw new MalformedAdapterMetadataError(
      key,
      `could not parse frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const resolver = frontmatter["resolver"];
  if (!resolver || typeof resolver !== "object" || Array.isArray(resolver)) {
    throw new MalformedAdapterMetadataError(key, "missing `resolver:` block in frontmatter");
  }
  const r = resolver as Record<string, unknown>;
  const idPatternStr = r["id_pattern"];
  const urlHost = r["url_host"];
  const urlPathRegexStr = r["url_path_regex"];
  if (typeof idPatternStr !== "string" || idPatternStr.length === 0) {
    throw new MalformedAdapterMetadataError(key, "resolver.id_pattern missing or not a string");
  }
  if (typeof urlHost !== "string" || urlHost.length === 0) {
    throw new MalformedAdapterMetadataError(key, "resolver.url_host missing or not a string");
  }
  if (typeof urlPathRegexStr !== "string" || urlPathRegexStr.length === 0) {
    throw new MalformedAdapterMetadataError(key, "resolver.url_path_regex missing or not a string");
  }
  let idPattern: RegExp;
  try {
    idPattern = new RegExp(idPatternStr);
  } catch (err) {
    throw new MalformedAdapterMetadataError(
      key,
      `invalid id_pattern regex: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let urlPathRegex: RegExp;
  try {
    urlPathRegex = new RegExp(urlPathRegexStr);
  } catch (err) {
    throw new MalformedAdapterMetadataError(
      key,
      `invalid url_path_regex: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { key, idPattern, urlHost, urlPathRegex };
}

/**
 * Build a ResolverConfig from CLAUDE.md's `## Task Tracking` section plus
 * each configured adapter's Schema W `resolver:` frontmatter block.
 *
 * Primary tracker comes from `mode:`. An optional `secondary_tracker:` key
 * adds a second tracker (in order, primary first).
 *
 * Returns `{ trackers: [] }` when `mode:` is absent OR `mode: none` — the
 * resolver's empty-trackers fallthrough path handles this uniformly
 * (AC-65.7).
 *
 * @throws MalformedAdapterMetadataError — adapter file missing, resolver
 * block absent/incomplete, or a regex field failed to compile (AC-65.6).
 */
export function buildResolverConfig(claudeMdPath: string, adaptersDir: string): ResolverConfig {
  const section = readTaskTrackingSection(claudeMdPath);
  const mode = section["mode"];
  if (!mode || mode === "none") return { trackers: [] };

  const keys: string[] = [mode];
  const secondary = section["secondary_tracker"];
  if (secondary && secondary !== "none") keys.push(secondary);

  const trackers = keys.map((k) => buildTrackerConfig(adaptersDir, k));
  return { trackers };
}
