// find_current_session — STE-229 AC-STE-229.4.
//
// Convert the working directory to a Claude-Code project slug (every
// character outside `[A-Za-z0-9]` becomes `-`) and return the
// most-recent-mtime `*.jsonl` under `<config-dir>/projects/<slug>/`
// whose transcript records the same cwd. Returns `null` when the slug
// directory is missing or holds no matching JSONL.
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

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

/**
 * Convert a path to the Claude-Code project-slug naming rule.
 * Every character outside `[A-Za-z0-9]` is replaced with `-`.
 *
 * Exported for unit-test reuse only. `findCurrentSession` is the public
 * entry point; downstream consumers should call that and let the slug
 * derivation stay an internal implementation detail.
 */
export function cwdToSlug(cwd: string): string {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  if (slug.length <= 200) return slug;
  return `${slug.slice(0, 200)}-${slugHash(cwd)}`;
}

// Claude Code 2.1.301's 32-bit string hash, rendered base-36 (see STE-677 notes).
function slugHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
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

/** How much of a transcript `firstRecordedCwd` reads, at most. */
export const CWD_PREFIX_CAP = 8 * 1024 * 1024;
const CWD_READ_CHUNK = 64 * 1024;

/**
 * Return the first `cwd` a transcript records (the first JSON line carrying
 * a string `cwd` field), or `null` when it records none within the first
 * {@link CWD_PREFIX_CAP} bytes or is unreadable. Two cwds can share one slug
 * folder (`/w/a.b` and `/w/a-b`), so candidates are filtered by this value
 * (STE-677 AC-STE-677.3). Transcripts run to hundreds of MB and every
 * candidate in a folder is checked, so this reads chunk by chunk and stops at
 * the first record that answers.
 */
export function firstRecordedCwd(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(CWD_READ_CHUNK);
    // A decoder, not `buf.toString`, so a multi-byte character split across two
    // chunks is not mangled.
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let read = 0;
    while (read < CWD_PREFIX_CAP) {
      const n = readSync(fd, buf, 0, CWD_READ_CHUNK, read);
      if (n === 0) break;
      read += n;
      const lines = (pending + decoder.write(buf.subarray(0, n))).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const cwd = cwdOfLine(line);
        if (cwd !== null) return cwd;
      }
    }
    // A final line with no newline, when the whole file fitted under the cap.
    return read < CWD_PREFIX_CAP ? cwdOfLine(pending) : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The string `cwd` of one JSONL line, or null. */
function cwdOfLine(line: string): string | null {
  if (!line.includes('"cwd"')) return null;
  try {
    const obj = JSON.parse(line) as { cwd?: unknown };
    return typeof obj.cwd === "string" ? obj.cwd : null;
  } catch {
    return null; // malformed line: keep scanning
  }
}

/**
 * True when `path` may belong to `cwd`: a transcript whose first recorded
 * cwd differs is rejected; one that records no cwd at all is kept. Keeping it
 * fails open on purpose: older transcripts and test fixtures carry no cwd, and
 * a slug folder only ever holds cwds that slug alike, so the only thing this
 * filter can catch is a recorded cwd that disagrees.
 */
export function transcriptMatchesCwd(path: string, cwd: string): boolean {
  const recorded = firstRecordedCwd(path);
  return recorded === null || recorded === cwd;
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
    if (!transcriptMatchesCwd(full, cwd)) continue;
    candidates.push({ path: full, mtime });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.path;
}
