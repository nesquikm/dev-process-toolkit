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
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
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
 * Parse the `## Task Tracking` section of a CLAUDE.md file into a flat
 * key:value map. Returns {} when the file is absent OR the section is
 * absent (both = `mode: none` canonical form per AC-29.5).
 *
 * Section terminates at the next heading line (`# `, `## `, `### `,
 * `#### `) — the canonical Schema L shape contains only flat `key: value`
 * pairs under the `## Task Tracking` heading.
 *
 * Exported so tests and sibling modules can reuse it without duplicating
 * the probe. Marked internal-to-FR-65 — may graduate to its own module if
 * a second caller appears.
 */
export function readTaskTrackingSection(claudeMdPath: string): Record<string, string> {
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
