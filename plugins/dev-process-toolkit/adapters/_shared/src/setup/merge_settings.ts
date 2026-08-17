// merge_settings — STE-106 AC-STE-106.4 / AC-STE-106.7 helper.
//
// Pure function. /setup composes the canonical allow-list per detected stack
// (via `canonicalAllowList(template, stack)`) and merges it into an existing
// `.claude/settings.json` (via `mergeAllowList(existing, canonical)`).
//
// Malformed-JSON handling lives in the skill prose — this helper assumes
// `existing` is already a parsed object.

export interface SettingsPermissions {
  allow?: string[];
  deny?: string[];
  [key: string]: unknown;
}

export interface SettingsJson {
  permissions?: SettingsPermissions;
  [key: string]: unknown;
}

export interface PermissionsTemplate {
  _common: string[];
  stacks: Record<string, string[]>;
}

/**
 * Build the canonical allow-list for a detected stack.
 *
 * Returns `_common ∪ stacks[stack]`, deduped, in insertion order
 * (common entries first). Throws when the stack is not registered in the
 * template — the caller (skill prose) is expected to fall back to "generic"
 * for unknown stacks rather than silently emit an empty allow-list.
 */
export function canonicalAllowList(
  template: PermissionsTemplate,
  stack: string,
): string[] {
  const stackEntries = template.stacks[stack];
  if (!stackEntries) {
    throw new Error(
      `canonicalAllowList: unknown stack "${stack}" — register it in templates/permissions.json or fall back to "generic"`,
    );
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...template._common, ...stackEntries]) {
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

/**
 * Merge canonical allow-list entries into an existing settings.json object.
 *
 * Behavior:
 *   - dedups so canonical entries already in `existing.permissions.allow`
 *     don't double up;
 *   - preserves user additions (never strips);
 *   - preserves all other keys on `existing` and on `existing.permissions`.
 */
export function mergeAllowList(existing: SettingsJson, canonical: string[]): SettingsJson {
  const existingAllow = existing.permissions?.allow ?? [];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const e of [...existingAllow, ...canonical]) {
    if (!seen.has(e)) {
      seen.add(e);
      merged.push(e);
    }
  }
  return {
    ...existing,
    permissions: {
      ...(existing.permissions ?? {}),
      allow: merged,
    },
  };
}

/**
 * The capability key `/setup` emits for the allow-list merge. Registered in
 * `CANONICAL_CAPABILITY_KEYS` (closing_summary_capability_keys.ts) and rendered
 * in /spec-write § 7's static plain-language map.
 */
export const ALLOWLIST_MERGE_CAPABILITY_KEY = "setup_allowlist_entries_added" as const;

/** The reporting shape returned by `mergeAllowListReport`. */
export interface AllowListMergeReport {
  /** The merged settings object — byte-identical to `mergeAllowList`'s. */
  settings: SettingsJson;
  /** Distinct entries the CALLER supplied (0 on the scaffold-from-nothing path). */
  callerCount: number;
  /** Entries the merge ADDED beyond the caller's list. */
  addedCount: number;
  /** Size of the resulting entry set. */
  mergedCount: number;
  /**
   * The literal registered capability key. Typed as the literal (not `string`)
   * so the single-sourcing is carried by the type, matching the house idiom in
   * `tolerance_probe_routing.ts` — a caller cannot substitute an arbitrary
   * token for the registered one.
   */
  capabilityKey: typeof ALLOWLIST_MERGE_CAPABILITY_KEY;
  /** The rendered capability row. ALWAYS non-empty — never a silent skip. */
  row: string;
}

/**
 * Reporting wrapper around `mergeAllowList` — the LOUD half.
 *
 * The merge itself is intended, load-bearing behaviour and is left byte-
 * unchanged: this delegates to `mergeAllowList` and returns its result
 * untouched. What it adds is the SIGNAL that was missing — the allow-list a
 * reviewer reads in a PR diff is the opening posture, never the effective
 * policy, and nothing in a `/setup` run said so. Every disposition reports,
 * including the quiet ones: a caller who supplied no list gets the full
 * scaffolded count, and a caller who already listed everything gets a row
 * saying `0` were added. A skipped row is indistinguishable from a broken
 * one, so `row` is never empty.
 */
export function mergeAllowListReport(
  existing: SettingsJson,
  canonical: string[],
): AllowListMergeReport {
  const settings = mergeAllowList(existing, canonical);
  const callerCount = new Set(existing.permissions?.allow ?? []).size;
  const mergedCount = settings.permissions?.allow?.length ?? 0;
  const addedCount = mergedCount - callerCount;
  const row =
    `${ALLOWLIST_MERGE_CAPABILITY_KEY}: /setup merged the canonical allow-list into ` +
    `.claude/settings.json — the caller supplied ${callerCount} entries, the merge added ` +
    `${addedCount} beyond that list, and ${mergedCount} entries are in effect. ` +
    `The caller's list is merged, never replaced; when no list was supplied the added ` +
    `count IS the full scaffolded count, and a zero added count means the caller ` +
    `already listed everything.`;
  return {
    settings,
    callerCount,
    addedCount,
    mergedCount,
    capabilityKey: ALLOWLIST_MERGE_CAPABILITY_KEY,
    row,
  };
}
