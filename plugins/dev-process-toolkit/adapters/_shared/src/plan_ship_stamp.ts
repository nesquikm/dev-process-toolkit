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
import { hasFrontmatterOpener, joinFrontmatter, splitFrontmatter } from "./frontmatter";

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
  // `splitFrontmatter` tolerates CRLF / lone-CR / BOM and carries the body
  // through VERBATIM. Without CRLF tolerance this helper refused to stamp a
  // plan whose frontmatter is perfectly well-formed; without a verbatim body,
  // a one-line stamp would rewrite every line ending in the file.
  const split = splitFrontmatter(original);
  if (split === null) {
    // Distinguish "never opened" from "opened but never closed" — the two
    // carry different remedies, and an existing regression pins both.
    if (hasFrontmatterOpener(original)) {
      throw new Error(
        [
          `Refusing: plan frontmatter opens with \`---\` but never closes.`,
          `Remedy: close the frontmatter block with a \`---\` line, then re-run.`,
          `Context: mode=plan-ship-stamp, file=${planPath}, attempted=${stampValue}`,
        ].join("\n"),
      );
    }
    throw new Error(
      [
        `Refusing: plan file has no YAML frontmatter block to stamp \`shipped_in\` into.`,
        `Remedy: ensure the plan starts with a \`---\` frontmatter block, then re-run.`,
        `Context: mode=plan-ship-stamp, file=${planPath}, attempted=${stampValue}`,
      ].join("\n"),
    );
  }

  const fmLines = split.lines;
  for (let i = 0; i < fmLines.length; i += 1) {
    const m = /^shipped_in\s*:\s*(.*)$/.exec(fmLines[i]!);
    if (!m) continue;
    const existing = (m[1] ?? "").trim();
    if (existing === stampValue) return; // idempotent no-op — no write
    if (existing === "null" || existing === "") {
      // Template pre-ship sentinel (`shipped_in: null`, emitted at plan
      // creation) — this is the first real stamp: overwrite in place,
      // preserving key position; never a double-ship conflict.
      fmLines[i] = stampLine;
      await writeFile(planPath, joinFrontmatter(split, fmLines), "utf-8");
      return;
    }
    throw new ShippedInConflictError(planPath, existing, stampValue);
  }

  // Fresh stamp: append exactly one line at the end of the frontmatter,
  // leaving every other key and the entire body byte-for-byte intact.
  await writeFile(planPath, joinFrontmatter(split, [...fmLines, stampLine]), "utf-8");
}
