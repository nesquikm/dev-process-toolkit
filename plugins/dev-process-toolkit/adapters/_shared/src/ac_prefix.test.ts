// Tests for acPrefix() + scanShortUlidCollision (FR-73).
//
// Covers AC-73.1 (tracker-mode prefix = tracker ID), AC-73.2 (mode-none
// prefix = spec.id.slice(23, 29) from the monotonic tail of the random
// portion), and AC-73.3 (pre-write collision scan throws
// ShortUlidCollisionError).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ShortUlidCollisionError,
  acPrefix,
  scanShortUlidCollision,
} from "./ac_prefix";
import type { FRSpec } from "./provider";

function makeSpec(overrides: Partial<{
  id: string;
  tracker: Record<string, string | null>;
}> = {}): FRSpec {
  return {
    frontmatter: {
      id: overrides.id ?? "fr_01KPTSA7W7NX6R98CBXTVDTAF4",
      title: "Test FR",
      milestone: "M99",
      status: "active",
      archived_at: null,
      tracker: overrides.tracker ?? {},
      created_at: "2026-04-22T00:00:00.000Z",
    },
    body: "",
  };
}

describe("acPrefix — tracker mode (AC-73.1)", () => {
  test("returns the tracker ID when tracker block has a non-null value", () => {
    const spec = makeSpec({ tracker: { linear: "STE-50" } });
    expect(acPrefix(spec)).toBe("STE-50");
  });

  test("returns the first non-null tracker value when multiple keys present", () => {
    const spec = makeSpec({ tracker: { linear: null, jira: "PROJ-123" } });
    expect(acPrefix(spec)).toBe("PROJ-123");
  });

  test("ignores null values and falls back to short-ULID", () => {
    const spec = makeSpec({
      id: "fr_01KPTSA7W7NX6R98CBXTVDTAF4",
      tracker: { linear: null },
    });
    // "fr_01KPTSA7W7NX6R98CBXTVDTAF4" is 29 chars; slice(23, 29) grabs
    // chars at indices 23..28 = last 6 chars = "VDTAF4".
    expect(acPrefix(spec)).toBe("VDTAF4");
  });
});

describe("acPrefix — mode: none (AC-73.2)", () => {
  test("returns spec.id.slice(23, 29) when tracker block is empty", () => {
    const spec = makeSpec({ id: "fr_01KPTSA7W7NX6R98CBXTVDTAF4", tracker: {} });
    expect(acPrefix(spec)).toBe("VDTAF4");
  });

  test("returns the last 6 chars of random portion (tail, not head)", () => {
    // Burst-minted monotonic ULIDs share the high random bits but differ in
    // the low end. slice(23, 29) must differ between these two.
    const a = makeSpec({
      id: "fr_01KPTSA7W8N116XWSXXE0G1PY3",
      tracker: {},
    });
    const b = makeSpec({
      id: "fr_01KPTSA7W8N116XWSXXE0G1PY4",
      tracker: {},
    });
    expect(acPrefix(a)).toBe("0G1PY3");
    expect(acPrefix(b)).toBe("0G1PY4");
    expect(acPrefix(a)).not.toBe(acPrefix(b));
  });

  test("regression — slice(13, 19) would collide for burst-minted ULIDs; tail slice must not", () => {
    // Documents the FR-73 spec deviation resolution (Option A). If someone
    // regresses acPrefix back to slice(13, 19), this test catches it.
    const a = "fr_01KPTSA7W8N116XWSXXE0G1PY3";
    const b = "fr_01KPTSA7W8N116XWSXXE0G1PY4";
    expect(a.slice(13, 19)).toBe(b.slice(13, 19)); // head collides
    expect(a.slice(23, 29)).not.toBe(b.slice(23, 29)); // tail does not
    expect(acPrefix(makeSpec({ id: a, tracker: {} }))).not.toBe(
      acPrefix(makeSpec({ id: b, tracker: {} })),
    );
  });
});

describe("scanShortUlidCollision — mode: none collision detection (AC-73.3)", () => {
  function makeSpecsDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "ac-prefix-"));
    mkdirSync(join(dir, "frs"), { recursive: true });
    mkdirSync(join(dir, "frs", "archive"), { recursive: true });
    return dir;
  }

  function writeFr(specsDir: string, id: string, tracker: Record<string, string | null>): void {
    const fm = [
      "---",
      `id: ${id}`,
      "title: Existing FR",
      "milestone: M99",
      "status: active",
      "archived_at: null",
      "tracker:",
      ...(Object.keys(tracker).length === 0
        ? ["  {}"]
        : Object.entries(tracker).map(([k, v]) => `  ${k}: ${v === null ? "null" : v}`)),
      "created_at: 2026-04-22T00:00:00.000Z",
      "---",
      "",
      "## Acceptance Criteria",
      "",
      `- AC-${id.slice(23, 29)}.1: existing ac`,
      "",
    ].join("\n");
    writeFileSync(join(specsDir, "frs", `${id}.md`), fm);
  }

  test("mode-none new FR whose short-ULID collides with an existing FR throws", async () => {
    const specsDir = makeSpecsDir();
    try {
      // All ids are exactly 29 chars (fr_ + 26-char Crockford ULID).
      const existingId = "fr_01KPTSA7W7AAAAAAAAAAN1KEY0";
      writeFr(specsDir, existingId, {});
      const newSpec = makeSpec({
        id: "fr_01KQBBBBBBBBBBBBBBBBN1KEY0",
        tracker: {},
      });
      expect(acPrefix(newSpec)).toBe("N1KEY0");
      await expect(scanShortUlidCollision(specsDir, newSpec)).rejects.toBeInstanceOf(
        ShortUlidCollisionError,
      );
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("mode-none new FR with unique short-ULID does not throw", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KPTSA7W7AAAAAAAAAAN1KEY0", {});
      const newSpec = makeSpec({
        id: "fr_01KQBBBBBBBBBBBBBBBBXMNPT9",
        tracker: {},
      });
      await expect(scanShortUlidCollision(specsDir, newSpec)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("tracker-mode new FR bypasses the scan even when its tail overlaps", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeFr(specsDir, "fr_01KPTSA7W7AAAAAAAAAAN1KEY0", {});
      const newSpec = makeSpec({
        id: "fr_01KQCCCCCCCCCCCCCCCCN1KEY0",
        tracker: { linear: "STE-999" },
      });
      // acPrefix returns "STE-999", not the colliding short-ULID — scan
      // should be a no-op for tracker-mode FRs.
      await expect(scanShortUlidCollision(specsDir, newSpec)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("scan ignores archive/ subdirectory", async () => {
    const specsDir = makeSpecsDir();
    try {
      const archivedId = "fr_01KPTSA7W7AAAAAAAAAAARCHV0";
      writeFileSync(
        join(specsDir, "frs", "archive", `${archivedId}.md`),
        [
          "---",
          `id: ${archivedId}`,
          "title: Archived",
          "milestone: M99",
          "status: archived",
          "archived_at: 2026-04-21T00:00:00.000Z",
          "tracker:",
          "  {}",
          "created_at: 2026-04-21T00:00:00.000Z",
          "---",
          "",
        ].join("\n"),
      );
      const newSpec = makeSpec({
        id: "fr_01KQDDDDDDDDDDDDDDDDARCHV0",
        tracker: {},
      });
      // Even though new spec's tail "ARCHV0" matches the archived one's,
      // the scan should skip archive/ and not throw.
      await expect(scanShortUlidCollision(specsDir, newSpec)).resolves.toBeUndefined();
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("ShortUlidCollisionError — NFR-10 shape", () => {
  test("carries the new ULID, the existing ULID, and the colliding prefix", () => {
    const err = new ShortUlidCollisionError(
      "fr_01NEW00000000000000000N1KEY0",
      "fr_01OLD00000000000000000N1KEY0",
      "N1KEY0",
    );
    expect(err.name).toBe("ShortUlidCollisionError");
    expect(err.message).toContain("N1KEY0");
    expect(err.message).toContain("fr_01NEW00000000000000000N1KEY0");
    expect(err.message).toContain("fr_01OLD00000000000000000N1KEY0");
    expect(err.newId).toBe("fr_01NEW00000000000000000N1KEY0");
    expect(err.existingId).toBe("fr_01OLD00000000000000000N1KEY0");
    expect(err.prefix).toBe("N1KEY0");
  });
});
