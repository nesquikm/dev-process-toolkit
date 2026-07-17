// M108 STE-391 — seed entry: stale v2.21-era hook entries (AC-STE-391.5).
//
// The retired `/setup --hooks` installer (v2.21.0–v2.22.1) wrote four
// dev-process-toolkit hook entries into the consumer's `.claude/settings.json`;
// the plugin-bundled hooks.json (v2.22.2) superseded them and STE-289 shipped
// forward-only. This entry is that migration, four releases later. The stale
// command shape comes exclusively from `../legacy_paths` (AC-STE-391.1).
//
// SURGERY, NOT REWRITE (STE-209 precedent): settings.json is the operator's
// file, and the installer only ever merged INTO it. So `apply` removes exactly
// the dead entries — plus the matcher shells left empty by their removal, which
// existed only to carry them — and hands every other key back untouched, in its
// original position.

import { relative } from "node:path";
import { readJsonObject, settingsPath, writeJsonIfChanged } from "../consumer_files";
import type { DetectResult, MigrationEntry } from "../index";
import { isLegacyHookScriptRef } from "../legacy_paths";

/** One `{ type, command, args }` hook registration. */
interface HookCommand {
  command?: unknown;
  args?: unknown;
  [key: string]: unknown;
}

/** One `{ matcher, hooks: [...] }` group under an event key. */
interface HookGroup {
  hooks?: unknown;
  [key: string]: unknown;
}

interface Settings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The parsed settings object, or null when there is nothing usable to read. */
function readSettings(projectRoot: string): Settings | null {
  return readJsonObject(settingsPath(projectRoot)) as Settings | null;
}

/** The event-keyed hook map, or null when there is nothing shaped like one. */
function hookEvents(settings: Settings | null): Record<string, unknown> | null {
  const events = settings?.hooks;
  if (typeof events !== "object" || events === null || Array.isArray(events)) return null;
  return events;
}

/** A group's registration list, or null when the group isn't shaped like one. */
function registrations(group: HookGroup): HookCommand[] | null {
  return Array.isArray(group.hooks) ? (group.hooks as HookCommand[]) : null;
}

/**
 * The retired script path this registration points at, or null. Both `command`
 * and `args` are searched: the installer put the script in `args` (behind
 * `command: "bash"`), but a hand-edited entry may inline it as the command.
 */
function legacyRef(hook: HookCommand): string | null {
  const candidates: unknown[] = [hook.command, ...(Array.isArray(hook.args) ? hook.args : [])];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && isLegacyHookScriptRef(candidate)) return candidate;
  }
  return null;
}

/**
 * Shared by the entry's `detect` and its `apply` guard, so "did this fire?" and
 * "is there anything left to do?" can never answer differently. Module-level
 * rather than a method, so `apply` never depends on a `this` binding.
 */
function detectStaleHooks(projectRoot: string): DetectResult {
  const events = hookEvents(readSettings(projectRoot));
  if (events === null) return { applies: false, evidence: [] };

  const rel = relative(projectRoot, settingsPath(projectRoot));
  const evidence: string[] = [];
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as HookGroup[]) {
      for (const hook of registrations(group) ?? []) {
        // Quote the path as READ, never as composed: the evidence has to name
        // the operator's actual entry for them to recognize it in a preview.
        const ref = legacyRef(hook);
        if (ref !== null) {
          evidence.push(
            `${rel} → hooks.${event} registers "${ref}" (retired installer entry, superseded by the plugin-bundled hooks.json in v2.22.2)`,
          );
        }
      }
    }
  }
  return { applies: evidence.length > 0, evidence };
}

export const staleHookEntries: MigrationEntry = {
  id: "stale-hook-entries",
  introduced_in: "2.22.2",
  title: "Remove stale v2.21-era installer hook entries from .claude/settings.json",
  kind: "script",
  detect: detectStaleHooks,
  apply(projectRoot) {
    // Re-apply is a no-op by construction: with nothing left to detect there is
    // nothing to heal, so we never touch the file — not even to reformat it.
    if (!detectStaleHooks(projectRoot).applies) {
      return { changed: [], summary: "No stale v2.21-era hook entries found — nothing to do." };
    }

    const path = settingsPath(projectRoot);
    // Both non-null by construction: detect only fires on a parsed hook map.
    const settings = readSettings(projectRoot)!;
    const events = hookEvents(settings)!;

    let removed = 0;
    const keptEvents: Record<string, unknown> = {};
    for (const [event, groups] of Object.entries(events)) {
      // Anything not shaped like a matcher list is not ours to prune.
      if (!Array.isArray(groups)) {
        keptEvents[event] = groups;
        continue;
      }
      const keptGroups: HookGroup[] = [];
      for (const group of groups as HookGroup[]) {
        const hooks = registrations(group);
        if (hooks === null) {
          keptGroups.push(group);
          continue;
        }
        const kept = hooks.filter((hook) => legacyRef(hook) === null);
        removed += hooks.length - kept.length;
        // A matcher shell emptied by the surgery was the installer's and goes
        // with the entries it carried; every surviving group keeps its own
        // keys (matcher, and anything else the operator put there).
        if (kept.length > 0) keptGroups.push({ ...group, hooks: kept });
      }
      // Drop an event key only when the surgery is what emptied it — an
      // already-empty list is the operator's and survives as written.
      if (keptGroups.length > 0 || groups.length === 0) keptEvents[event] = keptGroups;
    }

    // Assigning the existing key in place preserves its position; a `hooks` map
    // emptied by the surgery leaves no shell of its own behind either.
    if (Object.keys(keptEvents).length > 0) settings.hooks = keptEvents;
    else delete settings.hooks;

    const rel = relative(projectRoot, path);
    return {
      changed: writeJsonIfChanged(path, settings) ? [rel] : [],
      summary: `Removed ${removed} retired installer hook ${removed === 1 ? "entry" : "entries"} from ${rel} (the plugin-bundled hooks.json has covered them since v2.22.2). Every other setting is preserved.`,
    };
  },
};
