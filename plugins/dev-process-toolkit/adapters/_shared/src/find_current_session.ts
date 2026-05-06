// find_current_session — STE-229 AC-STE-229.4.
//
// Convert the working directory to a Claude-Code project slug
// (`/` → `-`) and return the most-recent-mtime `*.jsonl` under
// `<config-dir>/projects/<slug>/`. Returns `null` when the slug
// directory is missing or contains no JSONL.
//
// `<config-dir>` resolves to `process.env.CLAUDE_CONFIG_DIR` when set
// (operators who run Claude Code with a non-default config root —
// e.g., `~/.claude-st` — fall under this path), otherwise
// `<homedir()>/.claude`. Honoring the env var is load-bearing: without
// it, this helper silently returns `null` for every operator on a
// non-default config root, which would surface as
// "transcript unavailable — session JSONL not found" on every `--full`
// run for those operators.
//
// Rationale: skills cannot read their own session UUID from environment.
// The mtime heuristic is the deterministic best-known approximation. If
// Claude Code later exposes the session UUID via env var (e.g.,
// `CLAUDE_SESSION_ID`), this helper SHOULD prefer that and fall back to
// mtime — the call signature stays stable across the change.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Convert a path to the Claude-Code project-slug naming rule.
 * Every `/` is replaced with `-`.
 *
 * Exported for unit-test reuse only. `findCurrentSession` is the public
 * entry point; downstream consumers should call that and let the slug
 * derivation stay an internal implementation detail.
 */
export function cwdToSlug(cwd: string): string {
  return cwd.split("/").join("-");
}

/**
 * Resolve the Claude-Code config root, honoring `CLAUDE_CONFIG_DIR` over
 * the default `<homedir()>/.claude`. Exported for symmetry with
 * `cwdToSlug` so tests can assert the resolution rule directly.
 */
export function defaultConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env && env.length > 0) return env;
  return join(homedir(), ".claude");
}

/**
 * Return the absolute path to the most-recent-mtime `*.jsonl` under
 * `<config-dir>/projects/<cwd-slug>/`, or `null` when no candidate
 * exists. `configDir` defaults to `defaultConfigDir()` (env-aware);
 * tests override it.
 */
export function findCurrentSession(
  cwd: string,
  configDir: string = defaultConfigDir(),
): string | null {
  const slug = cwdToSlug(cwd);
  const dir = join(configDir, "projects", slug);
  if (!existsSync(dir)) return null;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const candidates: { path: string; mtime: number }[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(dir, name);
    let mtime: number;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({ path: full, mtime });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.path;
}
