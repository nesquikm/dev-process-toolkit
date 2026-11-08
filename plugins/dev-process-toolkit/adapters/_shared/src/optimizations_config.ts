// STE-723 — the closed set of reuse knobs in `specs/settings.yaml`.
//
// The section is read through the settings loader only (`loadProjectSection`),
// never re-parsed here. No environment variable and no plugin user setting
// changes a knob's value. The reader fails toward `run`: an absent, refused or
// invalid section, or `tracking.gate_outcomes` off, means no reuse anywhere.

import {
  gateOutcomesSwitchOn,
  isForeignSettingsFile,
  loadProjectSection,
  SETTINGS_FILE,
  type SettingsCitedViolation,
  settingsKeyLine,
  settingsSectionKeys,
  settingsSectionValue,
  SettingsShapeError,
  settingsViolation,
} from "./project_settings";
import { isToolkitManaged } from "./toolkit_managed";

export const OPTIMIZATION_KNOBS = ["gate_commands"] as const;
export const OPTIMIZATION_VALUES = ["reuse", "run"] as const;

/** Step names a knob may never target: LLM judgement, or reads outside the tree. */
export const NEVER_REUSABLE_STEPS = [
  "code_review",
  "review",
  "spec_review",
  "tdd",
  "probes",
  "conformance_probes",
  "tracker_probes",
  "upgrade_staleness",
] as const;

export type OptimizationKnob = (typeof OPTIMIZATION_KNOBS)[number];
export type OptimizationValue = (typeof OPTIMIZATION_VALUES)[number];
export type Optimizations = Record<OptimizationKnob, OptimizationValue>;

export type OptimizationReason =
  | "unknown-knob"
  | "unknown-value"
  | "never-reusable"
  | "not-a-mapping"
  | "requires-gate-outcomes";

export interface OptimizationViolation {
  reason: OptimizationReason;
  key: string | null;
}

function isMap(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One violation per offending key of a raw `optimizations` value. */
export function validateOptimizations(raw: unknown, gateOutcomesEnabled: boolean): OptimizationViolation[] {
  if (!isMap(raw)) return [{ reason: "not-a-mapping", key: null }];
  const out: OptimizationViolation[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if ((NEVER_REUSABLE_STEPS as readonly string[]).includes(key)) out.push({ reason: "never-reusable", key });
    else if (!(OPTIMIZATION_KNOBS as readonly string[]).includes(key)) out.push({ reason: "unknown-knob", key });
    else if (!(OPTIMIZATION_VALUES as readonly unknown[]).includes(value)) out.push({ reason: "unknown-value", key });
    else if (value === "reuse" && !gateOutcomesEnabled) out.push({ reason: "requires-gate-outcomes", key });
  }
  return out;
}

function allRun(): Optimizations {
  return Object.fromEntries(OPTIMIZATION_KNOBS.map((k) => [k, "run"])) as Optimizations;
}

/** The effective knob map: every knob `run` unless the section is valid and gate outcomes are recorded. */
export function readOptimizations(projectRoot: string): Optimizations {
  let section: unknown;
  try {
    section = loadProjectSection(projectRoot, "optimizations");
  } catch {
    return allRun();
  }
  const outcomes = gateOutcomesSwitchOn(projectRoot);
  if (!outcomes || validateOptimizations(section, outcomes).length > 0) return allRun();
  const out = allRun();
  for (const k of OPTIMIZATION_KNOBS) if ((section as Record<string, unknown>)[k] === "reuse") out[k] = "reuse";
  return out;
}

// ---------------------------------------------------------------------------
// STE-723 — the /gate-check probe `optimizations_reuse_only`. Severity: error.
// ---------------------------------------------------------------------------

export const PROBE_ID = "optimizations_reuse_only";

export interface OptimizationsProbeViolation extends SettingsCitedViolation {
  severity: "error";
}

export interface OptimizationsProbeReport {
  violations: OptimizationsProbeViolation[];
  notes: string[];
}

const REMEDY: Record<OptimizationReason, string> = {
  "unknown-knob": `name only these knobs under \`optimizations\`: ${OPTIMIZATION_KNOBS.join(", ")}.`,
  "unknown-value": `set each knob to one of: ${OPTIMIZATION_VALUES.join(", ")}.`,
  "never-reusable": "remove the key: that step is never reusable.",
  "not-a-mapping": "make `optimizations` a mapping of knob to value, or remove it.",
  "requires-gate-outcomes": "turn on `tracking.gate_outcomes.enabled`, or set the knob to `run`.",
};

/**
 * Vacuous on an unmanaged tree, an absent, foreign or unparseable settings
 * file, or a file with no `optimizations` section. The shape is decided from
 * the parsed value; lines from the raw text.
 */
export function runOptimizationsReuseOnlyProbe(projectRoot: string): OptimizationsProbeReport {
  const vacuous: OptimizationsProbeReport = { violations: [], notes: [] };
  if (!isToolkitManaged(projectRoot) || isForeignSettingsFile(projectRoot)) return vacuous;
  const parsed = settingsSectionValue(projectRoot, "optimizations");
  if (parsed === null || parsed.value === undefined) return vacuous;
  const sectionLine = settingsKeyLine(projectRoot, "optimizations") ?? 1;
  let graded: unknown = parsed.value;
  if (isMap(graded)) {
    try {
      graded = loadProjectSection(projectRoot, "optimizations");
    } catch {
      // The loader refuses the section; grade the parsed keys as written.
    }
  }
  const keyLines = new Map((settingsSectionKeys(projectRoot, "optimizations") ?? []).map((k) => [k.key, k.line]));
  const violations = validateOptimizations(graded, gateOutcomesSwitchOn(projectRoot)).map((v) => {
    const line = (v.key !== null ? keyLines.get(v.key) : undefined) ?? sectionLine;
    const message = new SettingsShapeError(
      v.key === null ? `\`optimizations\` is ${v.reason}` : `\`optimizations.${v.key}\` is ${v.reason}`,
      REMEDY[v.reason],
      `file=${SETTINGS_FILE}, probe=${PROBE_ID}`,
    ).message;
    return { ...settingsViolation(projectRoot, line, v.reason, message), severity: "error" as const };
  });
  return { violations, notes: [] };
}

function runFrontDoor(argv: string[]): number {
  const [verb, projectRoot, name] = argv;
  if (verb !== "knob" || projectRoot === undefined || name === undefined) {
    process.stderr.write("usage: optimizations_config.ts knob <projectRoot> <knob>\n");
    return 2;
  }
  if (!(OPTIMIZATION_KNOBS as readonly string[]).includes(name)) {
    const why = (NEVER_REUSABLE_STEPS as readonly string[]).includes(name)
      ? "is a step that is never reusable"
      : "is not an optimizations knob";
    process.stderr.write(
      `${new SettingsShapeError(`\`${name}\` ${why}`, `name one of: ${OPTIMIZATION_KNOBS.join(", ")}.`, `verb=knob, knob=${name}`).message}\n`,
    );
    return 1;
  }
  process.stdout.write(`${readOptimizations(projectRoot)[name as OptimizationKnob]}\n`);
  return 0;
}

if (import.meta.main) process.exit(runFrontDoor(process.argv.slice(2)));
