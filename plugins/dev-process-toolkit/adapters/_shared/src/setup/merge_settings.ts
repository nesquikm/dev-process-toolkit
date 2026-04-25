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
