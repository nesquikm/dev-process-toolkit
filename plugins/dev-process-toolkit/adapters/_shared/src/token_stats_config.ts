// readTokenStatsConfig — STE-378 helper that reads the optional
// `## Token Stats` section from a project's CLAUDE.md and returns a typed
// `TokenStatsConfig` record (AC-STE-378.2).
//
// Schema (Schema L-style, optional section alongside `## Task Tracking`,
// `## Docs`, and `## Verification`):
//
//     ## Token Stats
//
//     enabled: <true|false>
//
// `enabled` opts the M92 per-skill token-usage stats capture + render in
// (default OFF). The top-level key set inside the section is CLOSED —
// exactly {enabled}. Unlike `## Docs` (which ignores unrecognized keys),
// an out-of-set key here throws: a typo'd key would otherwise silently
// diverge from what the project declared.
//
// Absent CLAUDE.md, absent section, or absent key ⇒ default
// { enabled: false } — parallels the verification_config/docs_config
// convention where an absent file is not a hard failure (fail-off).
//
// Malformed input (out-of-set key, or an `enabled` value outside the
// lowercase literal set {true, false}) throws
// `MalformedTokenStatsConfigError` carrying the offending key + value
// (NFR-10 remedy shape).

import { existsSync, readFileSync } from "node:fs";

export interface TokenStatsConfig {
  enabled: boolean;
}

/**
 * Thrown when the `## Token Stats` section contains an out-of-closed-set
 * key, or an `enabled` value outside the lowercase literal set
 * {true, false}. Callers surface key + value so the operator can fix the
 * exact line.
 */
export class MalformedTokenStatsConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string, detail: string) {
    super(
      `token stats config key "${key}" with value "${value}" is malformed — ${detail}`,
    );
    this.name = "MalformedTokenStatsConfigError";
    this.key = key;
    this.value = value;
  }
}

const ALL_FALSE: TokenStatsConfig = {
  enabled: false,
};

/**
 * Parse the `## Token Stats` section of CLAUDE.md into a TokenStatsConfig.
 *
 * Section terminates at the next heading line (`# `, `## `, `### `,
 * `#### `) — the same termination rule as `readVerificationConfig`.
 * Schema L's grep contract requires flat `key: value` pairs only, no
 * nesting.
 *
 * @throws MalformedTokenStatsConfigError on an out-of-closed-set key
 * inside the section, or an `enabled` value outside {true, false}.
 */
export function readTokenStatsConfig(claudeMdPath: string): TokenStatsConfig {
  if (!existsSync(claudeMdPath)) return { ...ALL_FALSE };
  const md = readFileSync(claudeMdPath, "utf8");
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Token Stats");
  if (startIdx < 0) return { ...ALL_FALSE };

  const result: TokenStatsConfig = { ...ALL_FALSE };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    switch (key) {
      case "enabled":
        if (value !== "true" && value !== "false") {
          throw new MalformedTokenStatsConfigError(
            key!,
            value,
            'expected lowercase literal "true" | "false"',
          );
        }
        result.enabled = value === "true";
        break;
      default:
        throw new MalformedTokenStatsConfigError(
          key!,
          value,
          "the ## Token Stats key set is closed to {enabled}",
        );
    }
  }
  return result;
}
