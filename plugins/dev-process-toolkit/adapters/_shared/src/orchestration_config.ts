// readOrchestrationConfig — STE-463 helper that reads the `## Orchestration`
// section from a project's CLAUDE.md and returns a typed record.
//
// Schema (Schema L-style, alongside `## Task Tracking` / `## Docs`):
//
//     ## Orchestration
//
//     default_effort: <low|medium|high|xhigh|max|ultracode>
//     merge_policy: <offer|auto|never>
//
// Absent file, absent heading, or absent keys ⇒ defaults
// `{ defaultEffort: "ultracode", mergePolicy: "offer" }` — parallels the
// readDocsConfig convention where absence is not a hard failure. Unlike
// readDocsConfig, the argument is the PROJECT ROOT, not a file path;
// CLAUDE.md is resolved inside it.
//
// Values are matched literally against the closed sets — no case
// coercion, no quote stripping, no inference (`auto` is never inferred).
// Any value outside the set, and any unknown top-level key inside the
// block, refuses with `MalformedOrchestrationConfigError` whose message
// carries the NFR-10 canonical shape: a `CLAUDE.md:<line>` anchor plus
// Refusing: / Remedy: / Context: sub-lines.
//
// Pure file reads only — no git, no network, no child processes.

import { viewProjectSection } from "./project_settings";
import {
  type EffortLevel,
  type MergePolicy,
  type OrchestrationConfig,
  ORCHESTRATION_DEFAULTS,
  parseOrchestrationConfig,
} from "./project_settings_legacy";

export {
  EFFORT_LEVELS,
  type EffortLevel,
  MalformedOrchestrationConfigError,
  MERGE_POLICIES,
  type MergePolicy,
  type OrchestrationConfig,
} from "./project_settings_legacy";

/**
 * Strip a leading UTF-8 BOM and normalize CRLF → LF (line count unchanged) —
 * the fold the `## Orchestration` parse applies before matching its heading.
 */
export function normalizeOrchestrationSource(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/**
 * The project's orchestration defaults.
 *
 * STE-707 — derived from `loadProjectSection(projectRoot, "orchestration")`;
 * an absent key reads its default (`ultracode`, `offer`). On a legacy tree
 * the v2.101.4 `## Orchestration` parse of `<projectRoot>/CLAUDE.md`, which
 * lives in the loader's legacy module.
 *
 * @throws MalformedOrchestrationConfigError on a value outside the
 * closed set or an unknown top-level key inside the legacy block.
 */
export function readOrchestrationConfig(
  projectRoot: string,
): OrchestrationConfig {
  return viewProjectSection(
    projectRoot,
    "orchestration",
    (o) => ({
      defaultEffort: (o.default_effort as EffortLevel | undefined) ?? ORCHESTRATION_DEFAULTS.defaultEffort,
      mergePolicy: (o.merge_policy as MergePolicy | undefined) ?? ORCHESTRATION_DEFAULTS.mergePolicy,
    }),
    () => parseOrchestrationConfig(projectRoot),
  );
}
