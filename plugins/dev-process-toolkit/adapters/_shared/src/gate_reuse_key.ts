// STE-715 (M_7bc805) — the gate reuse key.
//
// `gateReuseKey(root)` names the exact input a gate graded: the commit, the
// uncommitted changes (tracked and untracked), the toolchain and toolkit
// versions, the `## Key Commands` section of CLAUDE.md and the settings file
// bytes. Every field is computed on the spot; nothing is cached.
//
// `gateReuseKey` is the toolkit's only reuse-key function. `worktreeDigest` is
// exported for STE-716 (it lives in `worktree_digest.ts`; re-exported here).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runningDptVersion } from "./dpt_version";
import { offendingPaths } from "./skip_baseline";
import { headOrNull, sha256Hex, worktreeDigest } from "./worktree_digest";

export { worktreeDigest };

export interface GateReuseKey {
  v: 1;
  head: string | null;
  clean: boolean;
  worktree: string;
  bun: string;
  plugin: string;
  commands: string;
  settings: string;
}

export interface GateReuseKeyOptions {
  /** Overrides `Bun.version` (tests only). */
  bunVersion?: string;
  /** The plugin root whose manifest names the running toolkit version. */
  pluginRoot?: string;
}

/** `sha256:` of the `## Key Commands` section (heading through the line before the next `## `), or `"absent"`. */
function commandsDigest(root: string): string {
  const file = join(root, "CLAUDE.md");
  if (!existsSync(file)) return "absent";
  const lines = readFileSync(file, "utf-8").split("\n");
  const start = lines.findIndex((l) => l === "## Key Commands");
  if (start < 0) return "absent";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return `sha256:${sha256Hex(lines.slice(start, end).join("\n"))}`;
}

/** `sha256:` of `<root>/specs/settings.yaml` bytes, or `"absent"`. */
function settingsDigest(root: string): string {
  const file = join(root, "specs", "settings.yaml");
  if (!existsSync(file)) return "absent";
  return `sha256:${sha256Hex(readFileSync(file))}`;
}

export function gateReuseKey(root: string, options: GateReuseKeyOptions = {}): GateReuseKey {
  return {
    v: 1,
    head: headOrNull(root),
    clean: offendingPaths(root).length === 0,
    worktree: worktreeDigest(root),
    bun: options.bunVersion ?? Bun.version,
    plugin: runningDptVersion(options.pluginRoot),
    commands: commandsDigest(root),
    settings: settingsDigest(root),
  };
}

/** `sha256:` over the key serialised as JSON with sorted keys. */
export function reuseKeyDigest(key: GateReuseKey | Record<string, unknown>): string {
  const record = key as Record<string, unknown>;
  const sorted = Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
  return `sha256:${sha256Hex(JSON.stringify(sorted))}`;
}
