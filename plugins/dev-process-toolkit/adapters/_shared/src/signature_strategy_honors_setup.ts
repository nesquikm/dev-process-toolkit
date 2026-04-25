// STE-105 /gate-check probe: signature-strategy-honors-setup.
//
// Reads the per-stack preferred strategy recorded by /setup at
// `docs/.dpt-docs-toolchain.json` (AC-STE-105.5) and asserts the recorded
// tool is still present on the current machine via `probeToolchains`. Fires
// only on the "I had it at setup, lost it later" drift case (AC-STE-105.3).
// Skipped silently when the config file is absent (e.g. on pre-M27 projects
// or projects whose /setup ran without recording a preference).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  preferredFromStatus,
  probeToolchains,
  type PreferredByStack,
  type ProbeOptions,
  type ToolchainStatus,
} from "./toolchain_probe";

export interface ProbeFinding {
  ok: boolean;
  /** `file:line — reason` notes per gate-check probe convention. */
  notes: string[];
  /** Optional NFR-10 remedy line for the operator. */
  remedy?: string;
}

interface RecordedConfig {
  signature_extraction_preferred_strategy?: PreferredByStack;
}

function isStackKey(k: string): k is keyof PreferredByStack {
  return k === "ts" || k === "dart" || k === "python";
}

/**
 * AC-STE-105.3 / AC-STE-105.7 entry point.
 *
 * @param projectRoot project root (where docs/.dpt-docs-toolchain.json lives)
 * @param options optional `pathLookup` injection mirroring `probeToolchains`
 *   for hermetic test runs.
 */
export function runSignatureStrategyHonorsSetupProbe(
  projectRoot: string,
  options: ProbeOptions = {},
): ProbeFinding {
  const configPath = join(projectRoot, "docs", ".dpt-docs-toolchain.json");
  if (!existsSync(configPath)) {
    return { ok: true, notes: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (e) {
    return {
      ok: false,
      notes: [
        `docs/.dpt-docs-toolchain.json — read error: ${(e as Error).message}`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      notes: [
        `docs/.dpt-docs-toolchain.json — invalid JSON: ${(e as Error).message}`,
      ],
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: true, notes: [] };
  }

  const recorded = (parsed as RecordedConfig).signature_extraction_preferred_strategy ?? {};
  if (typeof recorded !== "object" || recorded === null) {
    return { ok: true, notes: [] };
  }

  const status = probeToolchains(projectRoot, options);
  const notes: string[] = [];

  for (const stack of Object.keys(recorded)) {
    if (!isStackKey(stack)) continue;
    const value = recorded[stack];
    if (!value || value === "regex-fallback") continue;
    if (!toolStillPresent(stack, value, status)) {
      notes.push(
        `docs/.dpt-docs-toolchain.json — ${stack}: setup recorded preferred strategy "${value}", actual is "regex-fallback".`,
      );
    }
  }

  if (notes.length === 0) return { ok: true, notes: [] };
  return {
    ok: false,
    notes,
    remedy:
      "Re-install the missing toolchain or re-run /setup to update the recorded preference.",
  };
}

function toolStillPresent(
  stack: keyof PreferredByStack,
  recorded: string,
  status: ToolchainStatus,
): boolean {
  if (stack === "ts") {
    if (recorded === "typedoc") return status.ts.typedoc;
    if (recorded === "ts-morph") return status.ts.tsMorph;
  }
  if (stack === "dart" && recorded === "dart-analyzer") return status.dart.dartSdk;
  if (stack === "python" && recorded === "griffe") return status.python.griffe;
  return true;
}

/**
 * Helper used by /setup at completion to render the per-stack preferred
 * strategy snapshot that lands in `docs/.dpt-docs-toolchain.json`. /setup
 * itself can choose to write only the keys for stacks the project actually
 * uses; the probe treats absent keys as "no recorded preference".
 */
export { preferredFromStatus };
