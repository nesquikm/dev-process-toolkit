// acPrefix helper (FR-73) — derives the human-facing AC-prefix segment
// from an FR's frontmatter.
//
// Tracker mode: returns the first non-null tracker ID from the FR's
// `tracker:` block (AC-73.1).
// mode: none: returns `spec.id.slice(23, 29)` — the last 6 chars of the
// ULID's random portion. Head-of-random (slice(13, 19)) is NOT used
// because `ulid.ts` implements monotonic ULIDs: within the same ms,
// randomness increments at the least-significant end, so same-burst
// mints share the leading random chars. The tail is entropic both within
// and across bursts (AC-73.2).
//
// Callers use this at FR-creation time (`/spec-write` §0b, `importFromTracker`
// for tracker-mode imports) and at scan time (`scanShortUlidCollision`
// here, `ac_lint` sibling module for the duplicate-AC scan).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import type { FRSpec } from "./provider";

/**
 * Thrown by `scanShortUlidCollision` when a new `mode: none` FR's
 * short-ULID tail matches an existing FR's short-ULID tail. Callers
 * re-render as NFR-10 canonical shape.
 */
export class ShortUlidCollisionError extends Error {
  readonly newId: string;
  readonly existingId: string;
  readonly prefix: string;
  constructor(newId: string, existingId: string, prefix: string) {
    super(
      `Short-ULID collision: new FR ${newId} has AC prefix "${prefix}", ` +
        `already in use by ${existingId}. Refusing to write.`,
    );
    this.name = "ShortUlidCollisionError";
    this.newId = newId;
    this.existingId = existingId;
    this.prefix = prefix;
  }
}

/**
 * Derive the AC prefix segment for `spec`.
 *
 * Rules:
 *   - If `spec.frontmatter.tracker` has any non-null string value, return
 *     the first such value (iteration order of `Object.entries`).
 *   - Otherwise return `spec.id.slice(23, 29)` (last 6 chars of random
 *     portion). See module header for why the tail is used rather than
 *     the head.
 *
 * Deterministic; no I/O.
 */
export function acPrefix(spec: FRSpec): string {
  const tracker = spec.frontmatter["tracker"];
  if (tracker && typeof tracker === "object" && !Array.isArray(tracker)) {
    for (const value of Object.values(tracker as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  const id = spec.frontmatter["id"];
  if (typeof id !== "string") {
    throw new TypeError(`acPrefix: spec.frontmatter.id must be a string, got ${typeof id}`);
  }
  return id.slice(23, 29);
}

/**
 * Pre-write collision scan (AC-73.3). Reads every `specs/frs/*.md`
 * (excluding `archive/`) and throws `ShortUlidCollisionError` if the
 * new spec's prefix collides with any existing file's prefix.
 *
 * Tracker-mode new specs bypass the scan: their prefix is a tracker ID,
 * which is collision-proof by construction (tracker allocator). Only
 * `mode: none` specs need the scan.
 *
 * Caller contract: invoke BEFORE writing the new FR file. On success,
 * caller is free to write; on throw, nothing has been written.
 */
export async function scanShortUlidCollision(specsDir: string, newSpec: FRSpec): Promise<void> {
  const newPrefix = acPrefix(newSpec);
  // If the prefix doesn't look like a short-ULID slice (6 chars of
  // Crockford Base32), the new spec is in tracker mode — skip the scan.
  if (!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(newPrefix)) return;

  const frsDir = join(specsDir, "frs");
  let entries: string[];
  try {
    entries = await readdir(frsDir);
  } catch {
    return; // no frs dir yet — nothing to collide with
  }

  const newId = newSpec.frontmatter["id"] as string;
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    if (entry === `${newId}.md`) continue; // don't collide with self
    const path = join(frsDir, entry);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let existingFm: Record<string, unknown>;
    try {
      existingFm = parseFrontmatter(content);
    } catch {
      continue;
    }
    const existingSpec: FRSpec = { frontmatter: existingFm, body: "" };
    const existingPrefix = acPrefix(existingSpec);
    if (existingPrefix === newPrefix) {
      const existingId = typeof existingFm["id"] === "string"
        ? (existingFm["id"] as string)
        : entry.replace(/\.md$/, "");
      throw new ShortUlidCollisionError(newId, existingId, newPrefix);
    }
  }
}
