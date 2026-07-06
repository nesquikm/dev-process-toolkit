// plan_ship_stamp — M99 STE-368 AC-STE-368.3 helper.
//
// `stampShippedIn(planPath, version)` — stamps `shipped_in: v<X.Y.Z>`
// into an archived plan's YAML frontmatter at /ship-milestone time.
//
//   - `version` is the bare semver string (`2.40.0`) — the same shape
//     `inferBump` (version_bump.ts) emits at /ship-milestone step 2/7.
//     The written frontmatter value is `v`-prefixed (`shipped_in: v2.40.0`).
//   - Fresh stamp inserts exactly one line at the end of the frontmatter
//     block; every other frontmatter key is preserved byte-for-byte in
//     original order, and the body (everything from the closing `---`
//     on) is byte-identical — same frontmatter-edit discipline as
//     `flipArchivedFrontmatter` (archive_fr.ts, STE-210).
//   - Same-version re-run is an idempotent no-op (no write at all).
//   - A *different* existing `shipped_in` is the double-ship guard:
//     refuse with the NFR-10 canonical shape (Refusing: / Remedy: /
//     Context:) and leave the file untouched.
//
// Frontmatter scan anchors on `\n---\n` past the opener (or `\n---` at
// EOF) so a body `---` HR can never be mistaken for the frontmatter
// close — same anchoring as archive_fr.ts.

import { readFile, writeFile } from "node:fs/promises";

/**
 * NFR-10 canonical refusal for the double-ship guard: the plan already
 * carries a `shipped_in` that differs from the version being stamped.
 */
export class ShippedInConflictError extends Error {
  /** Existing frontmatter value (v-prefixed), e.g. `v2.39.0`. */
  readonly existing: string;
  /** Attempted new value (v-prefixed), e.g. `v2.40.0`. */
  readonly attempted: string;

  constructor(planPath: string, existing: string, attempted: string) {
    super(
      [
        `Refusing: plan already stamped \`shipped_in: ${existing}\`; ` +
          `re-stamping with \`${attempted}\` would record a double-ship.`,
        `Remedy: a plan ships exactly once — if \`${existing}\` is wrong, ` +
          `fix the frontmatter by hand and re-run; otherwise do not re-ship this milestone.`,
        `Context: mode=plan-ship-stamp, file=${planPath}, existing=${existing}, attempted=${attempted}`,
      ].join("\n"),
    );
    this.name = "ShippedInConflictError";
    this.existing = existing;
    this.attempted = attempted;
  }
}

/**
 * Stamp `shipped_in: v<version>` into the plan's frontmatter block.
 *
 * Idempotent: when the existing `shipped_in` equals the new value the
 * file is left byte-identical (no write). Throws
 * {@link ShippedInConflictError} (NFR-10 shape) when the plan already
 * carries a *different* `shipped_in`.
 *
 * @param planPath absolute path to the plan file (e.g. `specs/plan/archive/M99.md`)
 * @param version bare semver (`2.40.0`); a leading `v` is tolerated
 */
export async function stampShippedIn(
  planPath: string,
  version: string,
): Promise<void> {
  const stampValue = version.startsWith("v") ? version : `v${version}`;
  const stampLine = `shipped_in: ${stampValue}`;

  const original = await readFile(planPath, "utf-8");
  if (!original.startsWith("---\n")) {
    throw new Error(
      [
        `Refusing: plan file has no YAML frontmatter block to stamp \`shipped_in\` into.`,
        `Remedy: ensure the plan starts with a \`---\` frontmatter block, then re-run.`,
        `Context: mode=plan-ship-stamp, file=${planPath}, attempted=${stampValue}`,
      ].join("\n"),
    );
  }

  // Anchor past the opener so a body `---` HR can never match first.
  let closeIdx = original.indexOf("\n---\n", 4);
  if (closeIdx < 0) {
    if (original.endsWith("\n---")) {
      closeIdx = original.length - 4;
    } else {
      throw new Error(
        [
          `Refusing: plan frontmatter opens with \`---\` but never closes.`,
          `Remedy: close the frontmatter block with a \`---\` line, then re-run.`,
          `Context: mode=plan-ship-stamp, file=${planPath}, attempted=${stampValue}`,
        ].join("\n"),
      );
    }
  }

  const fmSection = original.slice(4, closeIdx);
  const rest = original.slice(closeIdx + 4); // consume `\n---` only; `\n` stays with body

  for (const line of fmSection.split("\n")) {
    const m = /^shipped_in\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const existing = (m[1] ?? "").trim();
    if (existing === stampValue) return; // idempotent no-op — no write
    throw new ShippedInConflictError(planPath, existing, stampValue);
  }

  // Fresh stamp: append exactly one line at the end of the frontmatter,
  // leaving every other key and the entire body byte-for-byte intact.
  const newContent = `---\n${fmSection}\n${stampLine}\n---${rest}`;
  await writeFile(planPath, newContent, "utf-8");
}
