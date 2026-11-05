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

import { dirname } from "node:path";

import { viewProjectSection } from "./project_settings";
import { parseTokenStatsConfig, type TokenStatsConfig } from "./project_settings_legacy";

export { MalformedTokenStatsConfigError, type TokenStatsConfig } from "./project_settings_legacy";

/**
 * The project's token-stats switch.
 *
 * STE-707 — derived from `loadProjectSection(projectRoot, "tracking")`
 * (`tracking.token_stats.enabled`, absent ≡ false) with the project root
 * resolved as the directory of `claudeMdPath`. On a legacy tree the v2.101.4
 * `## Token Stats` parse, which lives in the loader's legacy module.
 *
 * @throws MalformedTokenStatsConfigError on an out-of-closed-set key
 * inside the legacy section, or an `enabled` value outside {true, false}.
 */
export function readTokenStatsConfig(claudeMdPath: string): TokenStatsConfig {
  return viewProjectSection(
    dirname(claudeMdPath),
    "tracking",
    (t) => ({ enabled: t.token_stats?.enabled === true }),
    () => parseTokenStatsConfig(claudeMdPath),
  );
}

/**
 * Front door: `bun run adapters/_shared/src/token_stats_config.ts <CLAUDE.md>`
 * prints `enabled=<true|false>` from whichever home the project uses; a
 * malformed declaration exits 1 with the refusal on stderr.
 */
if (import.meta.main) {
  const claudeMdPath = process.argv[2];
  if (claudeMdPath === undefined) {
    console.error(
      [
        "Refusing: to read the token-stats switch without a CLAUDE.md path.",
        "Remedy: bun run adapters/_shared/src/token_stats_config.ts <CLAUDE.md>",
        "Context: mode=token-stats-config, phase=argv, argv=incomplete",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    try {
      console.log(`enabled=${readTokenStatsConfig(claudeMdPath).enabled}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  }
}
