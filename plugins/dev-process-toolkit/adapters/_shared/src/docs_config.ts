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

import { existsSync, readFileSync } from "node:fs";

export interface DocsConfig {
  userFacingMode: boolean;
  packagesMode: boolean;
  changelogCiOwned: boolean;
}

/**
 * Thrown when the `## Docs` section contains a value that is neither
 * lowercase `true` nor lowercase `false`. Callers re-render as NFR-10
 * canonical shape.
 */
export class MalformedDocsConfigError extends Error {
  readonly key: string;
  readonly value: string;
  constructor(key: string, value: string) {
    super(
      `docs config key "${key}" has malformed value "${value}" — expected lowercase "true" or "false"`,
    );
    this.name = "MalformedDocsConfigError";
    this.key = key;
    this.value = value;
  }
}

const ALL_FALSE: DocsConfig = {
  userFacingMode: false,
  packagesMode: false,
  changelogCiOwned: false,
};

function parseBool(key: string, raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new MalformedDocsConfigError(key, raw);
}

/**
 * Parse the `## Docs` section of CLAUDE.md into a DocsConfig.
 *
 * Section terminates at the next heading line (`# `, `## `, `### `,
 * `#### `). Matches the same termination rule used by
 * `readTaskTrackingSection` — Schema L's grep contract requires flat
 * `key: value` pairs only, no nested structure.
 *
 * @throws MalformedDocsConfigError when any recognized key's value is
 * not lowercase `true` or `false`.
 */
export function readDocsConfig(claudeMdPath: string): DocsConfig {
  if (!existsSync(claudeMdPath)) return { ...ALL_FALSE };
  const md = readFileSync(claudeMdPath, "utf8");
  const lines = md.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Docs");
  if (startIdx < 0) return { ...ALL_FALSE };

  const result: DocsConfig = { ...ALL_FALSE };
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,4} /.test(line)) break;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = (rawValue ?? "").trim();
    switch (key) {
      case "user_facing_mode":
        result.userFacingMode = parseBool(key, value);
        break;
      case "packages_mode":
        result.packagesMode = parseBool(key, value);
        break;
      case "changelog_ci_owned":
        result.changelogCiOwned = parseBool(key, value);
        break;
    }
  }
  return result;
}
