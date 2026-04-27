// STE-121 AC-STE-121.7 — `migrate-fr-frontmatter-strip-id` dry-run script.
//
// Walks active `specs/frs/*.md` (excluding `archive/`), detects FRs that
// carry both `id:` and a populated `tracker:` block (the inconsistent shape
// the M29 prose flip didn't catch), and emits a unified diff stripping the
// `id:` line. Operator pipes to `patch -p1` to apply.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeStripIdMigrationDiffs } from "./migrate_fr_frontmatter_strip_id";

function makeFrsDir(opts: {
  active?: Record<string, string>;
  archive?: Record<string, string>;
}): { specsDir: string; cleanup: () => void } {
  const specsDir = mkdtempSync(join(tmpdir(), "migrate-strip-id-"));
  const frsDir = join(specsDir, "frs");
  mkdirSync(frsDir, { recursive: true });
  for (const [name, content] of Object.entries(opts.active ?? {})) {
    writeFileSync(join(frsDir, name), content);
  }
  if (opts.archive) {
    const archiveDir = join(frsDir, "archive");
    mkdirSync(archiveDir, { recursive: true });
    for (const [name, content] of Object.entries(opts.archive)) {
      writeFileSync(join(archiveDir, name), content);
    }
  }
  return { specsDir, cleanup: () => rmSync(specsDir, { recursive: true, force: true }) };
}

const dirtyTrackerFR = [
  "---",
  "title: Bad FR",
  "milestone: M99",
  "status: active",
  "archived_at: null",
  "id: STE-999",
  "tracker:",
  "  linear: STE-999",
  "created_at: 2026-04-27T00:00:00Z",
  "---",
  "",
  "## Requirement",
  "",
].join("\n");

const cleanTrackerFR = [
  "---",
  "title: Good FR",
  "milestone: M99",
  "status: active",
  "archived_at: null",
  "tracker:",
  "  linear: STE-1000",
  "created_at: 2026-04-27T00:00:00Z",
  "---",
  "",
].join("\n");

const modeNoneFR = [
  "---",
  "title: Mode-none FR",
  "milestone: M99",
  "status: active",
  "archived_at: null",
  "id: fr_01KPTSA7W7NX6R98CBXTVDTAF4",
  "created_at: 2026-04-27T00:00:00Z",
  "---",
  "",
].join("\n");

describe("computeStripIdMigrationDiffs — flagged files", () => {
  test("active tracker-mode FR with id: → diff strips the line", async () => {
    const ctx = makeFrsDir({ active: { "STE-999.md": dirtyTrackerFR } });
    try {
      const diffs = await computeStripIdMigrationDiffs(ctx.specsDir);
      expect(diffs.length).toBe(1);
      const diff = diffs[0]!;
      expect(diff.path.endsWith("STE-999.md")).toBe(true);
      expect(diff.diff).toMatch(/^-id: STE-999$/m);
      // Diff must NOT remove the tracker block.
      expect(diff.diff).not.toMatch(/^-tracker:$/m);
      // Headers
      expect(diff.diff).toMatch(/^--- a\//m);
      expect(diff.diff).toMatch(/^\+\+\+ b\//m);
    } finally {
      ctx.cleanup();
    }
  });

  test("multiple dirty files → one diff per file", async () => {
    const second = dirtyTrackerFR.replace(/STE-999/g, "STE-998");
    const ctx = makeFrsDir({
      active: { "STE-999.md": dirtyTrackerFR, "STE-998.md": second },
    });
    try {
      const diffs = await computeStripIdMigrationDiffs(ctx.specsDir);
      expect(diffs.length).toBe(2);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("computeStripIdMigrationDiffs — non-flagged files", () => {
  test("clean tracker-mode FR (no id:) → no diff", async () => {
    const ctx = makeFrsDir({ active: { "STE-1000.md": cleanTrackerFR } });
    try {
      const diffs = await computeStripIdMigrationDiffs(ctx.specsDir);
      expect(diffs).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("mode-none FR (id required, no tracker) → no diff", async () => {
    const ctx = makeFrsDir({ active: { "VDTAF4.md": modeNoneFR } });
    try {
      const diffs = await computeStripIdMigrationDiffs(ctx.specsDir);
      expect(diffs).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("archive directory ignored entirely (archive immutability)", async () => {
    const ctx = makeFrsDir({
      active: { "STE-1000.md": cleanTrackerFR },
      archive: { "OLD.md": dirtyTrackerFR }, // dirty in archive should NOT be touched
    });
    try {
      const diffs = await computeStripIdMigrationDiffs(ctx.specsDir);
      expect(diffs).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("file without frontmatter → ignored", async () => {
    const ctx = makeFrsDir({ active: { "stray.md": "Not an FR.\n" } });
    try {
      const diffs = await computeStripIdMigrationDiffs(ctx.specsDir);
      expect(diffs).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});
