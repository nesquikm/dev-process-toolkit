// M_4daa6e STE-775 AC-STE-775.3 — seed `retro.priority` into a moved
// `specs/settings.yaml` that predates the key.
//
// DETECT. The tree reads its settings from `specs/settings.yaml` alone (source
// `settings`), and that file declares no `retro.priority`. Any declared value —
// a non-default order included — is the operator's answer and is left alone.
// A tree that has not moved (no settings file, or a legacy home still beside
// it) is skipped, and the evidence names why.
//
// APPLY. Writes `retro: { priority: [waste, tokens, time] }` through
// `writeProjectSettings`, the in-place editor, so comments, key order and the
// file's line endings survive. A second run finds the key and writes nothing.
//
// BROKEN FILE. A settings file that cannot be read or parsed is surfaced, never
// read as "nothing to do": detect reports it as evidence, and apply refuses
// with a `Refusing:` summary and writes nothing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as ProjectSettings from "../../project_settings";
import type * as ProjectSettingsWriter from "../../project_settings_writer";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";

type Plan =
  | { applies: true; rel: string; order: string[] }
  | { applies: false; reason: string | null }
  | { applies: "broken"; rel: string; reason: string };

// Loaded when first used: the settings loader's version helpers import this registry (STE-707).
function settingsModule(): typeof ProjectSettings {
  return require("../../project_settings") as typeof ProjectSettings;
}

/** The first line of a thrown value's message — the part a one-line summary quotes. */
function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
}

function plan(projectRoot: string): Plan {
  const { detectSettingsSource, SETTINGS_FILE, DEFAULT_RETRO_PRIORITY, checkRetroPriority } = settingsModule();
  const source = detectSettingsSource(projectRoot);
  if (source !== "settings") {
    return {
      applies: false,
      reason: `skipped: ${SETTINGS_FILE} is not this tree's only settings home (source: ${source}); run the settings-file move first`,
    };
  }
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(readFileSync(join(projectRoot, SETTINGS_FILE), "utf8"));
  } catch {
    return { applies: "broken", rel: SETTINGS_FILE, reason: `${SETTINGS_FILE} could not be parsed, so its retro.priority cannot be checked` };
  }
  const retro = (parsed as { retro?: unknown } | null)?.retro;
  if (retro !== null && typeof retro === "object" && "priority" in (retro as object)) {
    // AC-STE-784.7: a present priority the loader refuses (null included) is broken, not "nothing to do".
    try {
      checkRetroPriority((retro as { priority: unknown }).priority);
    } catch (e) {
      const why = firstLine(e);
      return { applies: "broken", rel: SETTINGS_FILE, reason: `${SETTINGS_FILE} declares a retro.priority the loader refuses (${why})` };
    }
    return { applies: false, reason: null };
  }
  return { applies: true, rel: SETTINGS_FILE, order: [...DEFAULT_RETRO_PRIORITY] };
}

export const retroPriorityDefault: MigrationEntry = {
  id: "retro-priority-default",
  introduced_in: "3.6.0",
  title: "`specs/settings.yaml` declares `retro.priority: [waste, tokens, time]`",
  kind: "script",
  detect(projectRoot: string): DetectResult {
    const p = plan(projectRoot);
    if (p.applies === "broken") return { applies: true, evidence: [`${p.reason}: fix the file, then re-run`] };
    if (!p.applies) return { applies: false, evidence: p.reason === null ? [] : [p.reason] };
    return {
      applies: true,
      evidence: [`${p.rel} declares no retro.priority: add \`priority: [${p.order.join(", ")}]\` under retro`],
    };
  },
  apply(projectRoot: string): ApplyResult {
    const p = plan(projectRoot);
    if (p.applies === "broken") {
      return { changed: [], summary: `Refusing: ${p.reason}.\nRemedy: fix ${p.rel} so the loader accepts it, then re-run /dev-process-toolkit:upgrade.\nContext: entry=retro-priority-default, file=${p.rel}` };
    }
    if (!p.applies) {
      return { changed: [], summary: p.reason ?? `${settingsModule().SETTINGS_FILE} already declares retro.priority — nothing to do` };
    }
    const { writeProjectSettings } = require("../../project_settings_writer") as typeof ProjectSettingsWriter;
    try {
      writeProjectSettings(projectRoot, { retro: { priority: p.order } });
    } catch (e) {
      const why = firstLine(e).replace(/^Refusing:\s*/, "");
      return { changed: [], summary: `Refusing: ${why}.\nRemedy: add \`priority: [${p.order.join(", ")}]\` under retro in ${p.rel} by hand, then re-run /dev-process-toolkit:upgrade.\nContext: entry=retro-priority-default, file=${p.rel}` };
    }
    return { changed: [p.rel], summary: `added retro.priority: [${p.order.join(", ")}] to ${p.rel}` };
  },
};
