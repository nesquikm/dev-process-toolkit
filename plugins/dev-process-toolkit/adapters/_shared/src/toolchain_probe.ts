// STE-105 toolchain detection probe.
//
// Shared between /setup (decides which signature-extraction strategy to
// record) and /gate-check (verifies the recorded strategy still applies).
// Co-located so the two callers can never drift on detection logic.

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ToolchainStatus {
  ts: {
    typedoc: boolean;
    tsMorph: true;
  };
  dart: {
    dartSdk: boolean;
  };
  python: {
    griffe: boolean;
  };
}

export interface ProbeOptions {
  /** Override PATH lookup for tests. Maps tool name → resolved binary or null. */
  pathLookup?: (tool: string) => string | null;
}

function defaultPathLookup(tool: string): string | null {
  const res = Bun.spawnSync(["which", tool], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  });
  if (res.exitCode !== 0) return null;
  const resolved = new TextDecoder().decode(res.stdout).trim();
  if (!resolved || !existsSync(resolved)) return null;
  return resolved;
}

function checkVersion(binary: string): boolean {
  try {
    const res = Bun.spawnSync([binary, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    if (res.exitCode !== 0) return false;
    const stdout = new TextDecoder().decode(res.stdout).trim();
    const stderr = new TextDecoder().decode(res.stderr).trim();
    return stdout.length > 0 || stderr.length > 0;
  } catch {
    return false;
  }
}

/** AC-STE-105.4 entry point. */
export function probeToolchains(
  projectRoot: string,
  options: ProbeOptions = {},
): ToolchainStatus {
  const lookup = options.pathLookup ?? defaultPathLookup;

  // typedoc: prefer node_modules/.bin (project-local), fall back to PATH.
  const localTypedoc = join(projectRoot, "node_modules/.bin/typedoc");
  const typedoc = existsSync(localTypedoc) || lookup("typedoc") !== null;

  // dart: PATH lookup AND --version produces output.
  const dartBin = lookup("dart");
  const dartSdk = dartBin !== null && checkVersion(dartBin);

  // griffe: PATH lookup AND --version produces output.
  const griffeBin = lookup("griffe");
  const griffe = griffeBin !== null && checkVersion(griffeBin);

  return {
    ts: { typedoc, tsMorph: true },
    dart: { dartSdk },
    python: { griffe },
  };
}

/**
 * Per-stack canonical mechanical strategy when the preferred toolchain is
 * available. Used by /setup to map probe results → recorded preferred
 * strategy in `docs/.dpt-docs-toolchain.json` (AC-STE-105.5), and by
 * /gate-check to validate the recording still holds.
 */
export type PreferredStrategy =
  | "typedoc"
  | "ts-morph"
  | "dart-analyzer"
  | "griffe"
  | "regex-fallback";

export interface PreferredByStack {
  ts?: "typedoc" | "ts-morph" | "regex-fallback";
  dart?: "dart-analyzer" | "regex-fallback";
  python?: "griffe" | "regex-fallback";
}

export function preferredFromStatus(status: ToolchainStatus): PreferredByStack {
  return {
    ts: status.ts.typedoc ? "typedoc" : status.ts.tsMorph ? "ts-morph" : "regex-fallback",
    dart: status.dart.dartSdk ? "dart-analyzer" : "regex-fallback",
    python: status.python.griffe ? "griffe" : "regex-fallback",
  };
}
