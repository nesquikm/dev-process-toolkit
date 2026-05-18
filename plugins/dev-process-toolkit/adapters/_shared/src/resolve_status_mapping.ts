// STE-302 AC-STE-302.5 — Adapter-side consumer refactor: single integration
// point for "give me this project's role → tracker-status map".
//
// Before STE-302, every adapter-side consumer of the role vocabulary read
// `status_mapping:` directly from the active adapter's markdown frontmatter
// (`adapters/linear.md`, `adapters/jira.md`). That mapping is hardcoded per
// adapter and doesn't survive non-default workflows (extra workflow stops,
// renamed columns, etc.). STE-302 introduces `specs/tracker-config.yaml` as
// the per-project source of truth.
//
// This helper threads that swap through one chokepoint: callers ask
// `resolveStatusMapping(specsDir, adaptersDir, adapterKey)` and get back a
// `ResolvedStatusMapping` carrying the four canonical roles + a `source`
// discriminator the operator-facing layers can use for diagnostics.
//
// Lookup precedence (highest first):
//
//   1. `specs/tracker-config.yaml` (loaded via `readTrackerConfig`)
//   2. `adapters/<key>.md` frontmatter `status_mapping:` block (legacy)
//
// The fallback preserves backward compatibility for projects that haven't
// run M79's `/setup` re-entry yet — once the tracker-config file lands the
// adapter-frontmatter branch becomes dead code (target removal: M80+).
//
// `mode: none` callers (LocalProvider) skip this helper entirely — there is
// no tracker vocabulary to resolve when there is no tracker.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import {
  CANONICAL_ROLES,
  readTrackerConfig,
  type Role,
  type TrackerConfig,
} from "./tracker_config";

/**
 * Source of the resolved mapping. Carries no behavioral meaning — purely a
 * diagnostic hint for operator-facing surfaces ("which file are we keying
 * off?"). Consumers that need behavior should branch on the role values,
 * not the source.
 */
export type StatusMappingSource = "tracker-config" | "adapter-frontmatter";

/**
 * Project-wide role → tracker-status mapping with provenance. Mirrors the
 * canonical four-role enum exactly so consumers can index by role name
 * without sentinel checks.
 */
export interface ResolvedStatusMapping {
  /** canonical roles → tracker-side status strings */
  roles: Record<Role, string>;
  /** which file the values came from */
  source: StatusMappingSource;
}

/**
 * Thrown when neither precedence step yielded a usable mapping AND the
 * caller didn't pass an inline default — i.e., no `tracker-config.yaml`,
 * no adapter file at the expected path, and no override.
 */
export class StatusMappingUnavailableError extends Error {
  constructor(
    public readonly specsDir: string,
    public readonly adapterKey: string,
    public readonly adapterPath: string,
  ) {
    super(
      [
        `Refusing: no status mapping found for adapter "${adapterKey}"`,
        `Remedy: run /setup to write specs/tracker-config.yaml, or restore ${adapterPath} with a status_mapping: frontmatter block.`,
        `Context: mode=resolve-status-mapping, specsDir=${specsDir}, adapterKey=${adapterKey}`,
      ].join("\n"),
    );
    this.name = "StatusMappingUnavailableError";
  }
}

/**
 * Read `status_mapping:` from an adapter's markdown frontmatter. Returns
 * `null` when the file is absent OR the frontmatter has no `status_mapping`
 * block — caller decides whether that's fatal.
 *
 * Exported so tests can exercise the fallback branch independently of the
 * full resolver.
 */
export function readAdapterFrontmatterStatusMapping(
  adaptersDir: string,
  adapterKey: string,
): Partial<Record<Role, string>> | null {
  const adapterPath = join(adaptersDir, `${adapterKey}.md`);
  if (!existsSync(adapterPath)) {
    return null;
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter(readFileSync(adapterPath, "utf8"), { lenient: true });
  } catch {
    return null;
  }
  const raw = frontmatter["status_mapping"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const out: Partial<Record<Role, string>> = {};
  for (const role of CANONICAL_ROLES) {
    const value = (raw as Record<string, unknown>)[role];
    if (typeof value === "string" && value.length > 0) {
      out[role] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build a `Record<Role, string>` from a partial map by reading each canonical
 * role. Callers MUST have already verified every canonical role is present;
 * the `!` is safe under that contract.
 */
function rolesFromPartial(partial: Partial<Record<Role, string>>): Record<Role, string> {
  return {
    initial: partial.initial!,
    in_progress: partial.in_progress!,
    in_review: partial.in_review!,
    done: partial.done!,
  };
}

/**
 * Derive a `ResolvedStatusMapping` from a `TrackerConfig`. Internal helper
 * exposed for tests; production callers should use `resolveStatusMapping`.
 */
export function fromTrackerConfig(config: TrackerConfig): ResolvedStatusMapping {
  // readTrackerConfig has already validated all four canonical roles are
  // present (validateTrackerConfig enforces it) so we can index directly.
  return {
    roles: rolesFromPartial(config.roles),
    source: "tracker-config",
  };
}

export interface ResolveOptions {
  /**
   * Inline override used when both `specs/tracker-config.yaml` and the
   * adapter frontmatter are missing. Callers that already received a
   * `StatusMapping` from upstream (e.g., probe runners that wire defaults
   * via dependency injection) pass it here so the helper doesn't have to
   * throw `StatusMappingUnavailableError`.
   */
  fallback?: Partial<Record<Role, string>>;
}

/**
 * Resolve the project's role → tracker-status mapping. Tries the per-project
 * `specs/tracker-config.yaml` first, then falls back to the active adapter's
 * `status_mapping:` frontmatter block, then to an inline override.
 *
 * Throws `StatusMappingUnavailableError` when all three sources are absent
 * AND at least one canonical role can't be filled — better to surface the
 * gap explicitly than to return a sparse map and let consumers stumble into
 * `undefined` at call time.
 *
 * The function intentionally does NOT cross-check `tracker_key` against
 * `adapterKey` — that check lives at the `validateTrackerConfig` boundary
 * and is invoked explicitly by /setup + the gate probe (FR2, AC-302.8).
 * Here we just want a mapping we can use.
 */
export function resolveStatusMapping(
  specsDir: string,
  adaptersDir: string,
  adapterKey: string,
  options: ResolveOptions = {},
): ResolvedStatusMapping {
  // 1. tracker-config.yaml — highest precedence.
  const config = readTrackerConfig(specsDir);
  if (config !== null) {
    return fromTrackerConfig(config);
  }

  // 2. adapter frontmatter `status_mapping:` block.
  const fromAdapter = readAdapterFrontmatterStatusMapping(adaptersDir, adapterKey);
  const merged: Partial<Record<Role, string>> = { ...(options.fallback ?? {}), ...(fromAdapter ?? {}) };

  // 3. require every canonical role to be filled, else escalate.
  const missing = CANONICAL_ROLES.filter((r) => !merged[r]);
  if (missing.length > 0) {
    throw new StatusMappingUnavailableError(
      specsDir,
      adapterKey,
      join(adaptersDir, `${adapterKey}.md`),
    );
  }

  return {
    roles: rolesFromPartial(merged),
    source: "adapter-frontmatter",
  };
}
