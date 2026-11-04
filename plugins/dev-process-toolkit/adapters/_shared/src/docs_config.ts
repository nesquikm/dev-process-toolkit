// readDocsConfig — STE-68 helper that reads the `## Docs` section from a
// project's CLAUDE.md and returns a typed `DocsConfig` record.
//
// Schema (Schema L-style, added alongside the existing `## Task Tracking`
// block):
//
//     ## Docs
//
//     user_facing_mode: <true|false>
//     packages_mode: <true|false>
//     changelog_ci_owned: <true|false>
//     changelog_unversioned: <true|false>
//
// Absent section ≡ all three `false` (AC-STE-68.3 — backward compat for
// projects that predate v1.23.0). Missing CLAUDE.md file also returns
// all-false — parallels the resolver_config convention where an absent
// file is not a hard failure.
//
// Malformed value (anything other than lowercase `true`/`false`) throws
// `MalformedDocsConfigError`; `/setup` re-renders as NFR-10 canonical
// shape. We accept only lowercase literal `true`/`false` — the prompt
// translates user-friendly `y`/`yes`/`n`/`no` to the canonical lowercase
// literals before writing, so any non-literal that shows up at read time
// is drift to surface, not silently coerce.

import { dirname } from "node:path";

import { viewProjectSection } from "./project_settings";
import { type DocsConfig, parseDocsConfig } from "./project_settings_legacy";

export { type DocsConfig, MalformedDocsConfigError } from "./project_settings_legacy";

/**
 * Fold a CLAUDE.md source to LF and drop a leading BOM before any line is
 * matched — without it the `## Docs` heading match never fires on a
 * CRLF-authored file and the reader fails OPEN (all-false). `\r\n` is folded
 * before lone `\r`, so the line COUNT never changes. The legacy parse applies
 * it before matching the heading.
 */
export function normalizeDocsSource(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * The project's docs flags.
 *
 * STE-707 — derived from `loadProjectSection(projectRoot, "docs")` with the
 * project root resolved as the directory of `claudeMdPath`; an absent key
 * reads `false`. On a legacy tree the v2.101.4 `## Docs` parse (absent
 * section ≡ all false, CRLF folded, a non-literal value throws
 * `MalformedDocsConfigError`), which lives in the loader's legacy module.
 */
export function readDocsConfig(claudeMdPath: string): DocsConfig {
  return viewProjectSection(
    dirname(claudeMdPath),
    "docs",
    (d) => ({
      userFacingMode: d.user_facing_mode === true,
      packagesMode: d.packages_mode === true,
      changelogCiOwned: d.changelog_ci_owned === true,
      changelogUnversioned: d.changelog_unversioned === true,
    }),
    () => parseDocsConfig(claudeMdPath),
  );
}
