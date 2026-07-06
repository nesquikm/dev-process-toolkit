import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stampShippedIn } from "./plan_ship_stamp";

// M99 STE-368 — AC-STE-368.3: `plan_ship_stamp.ts` exports the stamp writer
// `stampShippedIn(planPath, version)`.
//
// Contract pinned here:
//   - `version` is the bare semver string (`2.40.0`) — the same shape
//     `inferBump` (version_bump.ts) emits at /ship-milestone step 2/7.
//   - The written frontmatter value is `v`-prefixed: `shipped_in: v2.40.0`
//     (AC-STE-368.1 names the stamp as `shipped_in: v<X.Y.Z>`).
//   - Fresh stamp inserts exactly one line into the frontmatter block; every
//     other frontmatter key is preserved byte-for-byte in original order, and
//     the body (everything from the closing `---` on) is byte-identical —
//     same frontmatter-edit discipline as archiveFRWithFlip (STE-210).
//   - Same-version re-run is an idempotent no-op (byte-identical file).
//   - A *different* existing `shipped_in` is the double-ship guard: refuse
//     with the NFR-10 canonical shape (Refusing: / Remedy: / Context:) and
//     leave the file untouched.

const STAMP_LINE = "shipped_in: v2.40.0";

/** Plan fixture mirroring a real archived plan — note the body `---` HR,
 *  which must NOT be mistaken for the frontmatter close. */
const PLAN = [
  "---",
  "milestone: M42",
  "status: archived",
  "archived_at: 2026-07-06T07:47:47Z",
  "kickoff_branch: feat/m42-thing",
  "frozen_at: null",
  "---",
  "",
  "# Implementation Plan",
  "",
  "## Milestone Order",
  "",
  "---",
  "",
  "trailing body line — must survive byte-for-byte  ",
  "",
].join("\n");

function makePlan(body: string): { path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "plan-ship-stamp-"));
  const path = join(root, "M42.md");
  writeFileSync(path, body);
  return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Index of the frontmatter-closing `\n---\n` (anchored past the opener so a
 *  body HR can never match first). */
function fmCloseIdx(s: string): number {
  const i = s.indexOf("\n---\n", 4);
  expect(i).toBeGreaterThan(-1);
  return i;
}
const fmOf = (s: string) => s.slice(4, fmCloseIdx(s));
const bodyOf = (s: string) => s.slice(fmCloseIdx(s));

describe("STE-368 — stampShippedIn: fresh stamp (AC-STE-368.3)", () => {
  test("writes `shipped_in: v<X.Y.Z>` into the frontmatter block", async () => {
    const ctx = makePlan(PLAN);
    try {
      await stampShippedIn(ctx.path, "2.40.0");
      const after = readFileSync(ctx.path, "utf-8");
      // Stamp line lands INSIDE the frontmatter (not the body).
      expect(fmOf(after).split("\n")).toContain(STAMP_LINE);
      expect(bodyOf(after)).not.toContain(STAMP_LINE);
    } finally {
      ctx.cleanup();
    }
  });

  test("preserves all other frontmatter keys (in order) and the body byte-for-byte", async () => {
    const ctx = makePlan(PLAN);
    try {
      await stampShippedIn(ctx.path, "2.40.0");
      const after = readFileSync(ctx.path, "utf-8");
      // Exactly one inserted line: removing it must reproduce the original
      // frontmatter byte-for-byte (this also pins key order preservation).
      const fmLinesMinusStamp = fmOf(after)
        .split("\n")
        .filter((line) => line !== STAMP_LINE);
      expect(fmLinesMinusStamp.join("\n")).toBe(fmOf(PLAN));
      // Body — including the `---` HR and trailing whitespace — untouched.
      expect(bodyOf(after)).toBe(bodyOf(PLAN));
    } finally {
      ctx.cleanup();
    }
  });
});

describe("STE-368 — stampShippedIn: same-version idempotency (AC-STE-368.3)", () => {
  test("re-stamping with the identical version is a byte-identical no-op", async () => {
    const stamped = PLAN.replace(
      "frozen_at: null",
      `frozen_at: null\n${STAMP_LINE}`,
    );
    const ctx = makePlan(stamped);
    try {
      await stampShippedIn(ctx.path, "2.40.0");
      const after = readFileSync(ctx.path, "utf-8");
      expect(after).toBe(stamped);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("STE-368 — stampShippedIn: double-ship guard (AC-STE-368.3)", () => {
  test("differing existing shipped_in refuses with NFR-10 canonical shape and leaves the file untouched", async () => {
    const stamped = PLAN.replace(
      "frozen_at: null",
      "frozen_at: null\nshipped_in: v2.39.0",
    );
    const ctx = makePlan(stamped);
    try {
      let err: Error | null = null;
      try {
        await stampShippedIn(ctx.path, "2.40.0");
      } catch (e) {
        err = e as Error;
      }
      expect(err).not.toBeNull();
      // NFR-10 canonical refusal shape: Refusing: / Remedy: / Context:.
      expect(err!.message).toMatch(/Refusing:/);
      expect(err!.message).toMatch(/Remedy:/);
      expect(err!.message).toMatch(/Context:/);
      // Actionability: both the already-stamped and the attempted version
      // appear in the message (double-ship diagnosis needs both).
      expect(err!.message).toContain("v2.39.0");
      expect(err!.message).toContain("v2.40.0");
      // Refusal fires before any write — file byte-identical.
      const after = readFileSync(ctx.path, "utf-8");
      expect(after).toBe(stamped);
    } finally {
      ctx.cleanup();
    }
  });
});
