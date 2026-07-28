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
 * The shape of a short-ULID tail: 6 chars of Crockford Base32 (I, L, O and U
 * excluded). One constant, two jobs — it decides whether a NEW spec's prefix
 * is a tail at all (tracker-mode prefixes are not, so they skip the scan), and
 * it decides whether an unreadable EXISTING record's filename stem may be
 * treated as the tail that record owns (STE-424).
 */
const SHORT_ULID_TAIL_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;

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
 * Pre-write collision scan (AC-73.3). Reads every `specs/frs/*.md` AND
 * every `specs/frs/archive/*.md` and throws `ShortUlidCollisionError` if
 * the new spec's prefix collides with any existing record's prefix.
 *
 * The archive is in scope because an archived record still OWNS its
 * short-ULID tail: the tail is the filename stem, the AC prefix and the
 * milestone token all at once, so handing it to a second record means the
 * next write lands on an occupied name. A missing `archive/` directory is
 * tolerated (consumer trees may not have one yet).
 *
 * Tracker-mode new specs bypass the scan: their prefix is a tracker ID,
 * which is collision-proof by construction (tracker allocator). Only
 * `mode: none` specs need the scan.
 *
 * An EXISTING record this scan cannot read is NOT waved through. A record
 * whose frontmatter is truncated, absent, or carries no usable identity
 * (no `id:`, empty `tracker: {}`) still OWNS the tail its filename spells:
 * `<tail>.md` is the canonical record name, so handing that tail to a second
 * record means the next write lands on an occupied name regardless of whether
 * the incumbent parses. So when `parseFrontmatter`/`acPrefix` yield nothing,
 * the filename stem becomes the comparison prefix — but only when the stem is
 * itself tail-shaped (`SHORT_ULID_TAIL_RE`). A stem that is not a tail
 * (`README`, `notes`, `index`) is never a collision candidate, which is what
 * keeps this from degrading into "any unparseable `.md` refuses every mint".
 * The self-skip stays keyed on identity, so the fallback applies only where
 * no readable identity exists.
 *
 * Caller contract: invoke BEFORE writing the new FR file. On success,
 * caller is free to write; on throw, nothing has been written.
 */
export async function scanShortUlidCollision(specsDir: string, newSpec: FRSpec): Promise<void> {
  const newPrefix = acPrefix(newSpec);
  // If the prefix doesn't look like a short-ULID slice (6 chars of
  // Crockford Base32), the new spec is in tracker mode — skip the scan.
  if (!SHORT_ULID_TAIL_RE.test(newPrefix)) return;

  const frsDir = join(specsDir, "frs");
  const newId = newSpec.frontmatter["id"] as string;

  // Active records first, then archived ones. Each directory is probed
  // independently so an absent `frs/` or `frs/archive/` is a no-op rather
  // than a crash.
  for (const dir of [frsDir, join(frsDir, "archive")]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // dir not present — nothing there to collide with
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const path = join(dir, entry);
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        continue;
      }
      // A record we cannot parse is NOT dismissed — see the doc comment. It
      // falls through to the filename-stem fallback below.
      let existingFm: Record<string, unknown> | undefined;
      try {
        existingFm = parseFrontmatter(content);
      } catch {
        existingFm = undefined;
      }
      const stem = entry.replace(/\.md$/, "");
      const existingId = typeof existingFm?.["id"] === "string"
        ? (existingFm["id"] as string)
        : stem;
      // Self-skip is keyed on IDENTITY, not on filename. Real records are
      // named `<tail>.md`, never `<full-id>.md`, so a filename comparison
      // never matches a real tree — and a re-scan run after the record is
      // on disk would report it colliding with itself.
      if (existingId === newId) continue;
      let existingPrefix: string | undefined;
      if (existingFm !== undefined) {
        try {
          existingPrefix = acPrefix({ frontmatter: existingFm, body: "" });
        } catch {
          existingPrefix = undefined; // no usable identity — fall back to the filename
        }
      }
      if (existingPrefix === undefined) {
        // The record carries no readable identity, so the filename stem is the
        // only statement of which tail it owns. Honour it when it IS a tail;
        // ignore it otherwise (`README.md` and friends own nothing).
        if (!SHORT_ULID_TAIL_RE.test(stem)) continue;
        existingPrefix = stem;
      }
      if (existingPrefix === newPrefix) {
        throw new ShortUlidCollisionError(newId, existingId, newPrefix);
      }
    }
  }
}
