import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveFRWithFlip, flipArchivedFrontmatter } from "./archive_fr";

function makeFile(body: string): { path: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "archive-fr-"));
  const path = join(root, "STE-1.md");
  writeFileSync(path, body);
  return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("STE-210 — flipArchivedFrontmatter", () => {
  test("AC-STE-210.2: flips status: active → archived + sets archived_at", async () => {
    const ctx = makeFile(
      "---\nstatus: active\narchived_at: null\nmilestone: M5\n---\n\n# FR\n",
    );
    try {
      const r = await flipArchivedFrontmatter(ctx.path, "2026-05-04T12:00:00Z");
      expect(r.alreadyArchived).toBe(false);
      expect(r.archivedAt).toBe("2026-05-04T12:00:00Z");
      const after = readFileSync(ctx.path, "utf-8");
      expect(after).toContain("status: archived");
      expect(after).toContain("archived_at: 2026-05-04T12:00:00Z");
      expect(after).toContain("milestone: M5");
    } finally {
      ctx.cleanup();
    }
  });

  test("AC-STE-210.3 idempotency: re-flipping an already-archived file is a no-op", async () => {
    const ctx = makeFile(
      "---\nstatus: archived\narchived_at: 2026-05-04T11:00:00Z\nmilestone: M5\n---\n\n# FR\n",
    );
    try {
      const original = readFileSync(ctx.path, "utf-8");
      const r = await flipArchivedFrontmatter(ctx.path, "2026-05-04T13:00:00Z");
      expect(r.alreadyArchived).toBe(true);
      // Existing non-null archived_at preserved on idempotent re-run.
      const after = readFileSync(ctx.path, "utf-8");
      expect(after).toBe(original);
      expect(after).toContain("archived_at: 2026-05-04T11:00:00Z");
    } finally {
      ctx.cleanup();
    }
  });

  test("STE-197 AC-STE-197.4: synthesizes frontmatter for legacy frontmatter-less files", async () => {
    const ctx = makeFile("# Legacy plan\n\nbody\n");
    try {
      await flipArchivedFrontmatter(ctx.path, "2026-05-04T14:00:00Z");
      const after = readFileSync(ctx.path, "utf-8");
      expect(after.startsWith("---\nstatus: archived\narchived_at: 2026-05-04T14:00:00Z\n---\n\n")).toBe(true);
      expect(after).toContain("# Legacy plan");
    } finally {
      ctx.cleanup();
    }
  });

  test("preserves other frontmatter keys verbatim", async () => {
    const ctx = makeFile(
      "---\ntitle: foo\nstatus: active\narchived_at: null\ntracker:\n  linear: STE-1\n---\n",
    );
    try {
      await flipArchivedFrontmatter(ctx.path, "2026-05-04T15:00:00Z");
      const after = readFileSync(ctx.path, "utf-8");
      expect(after).toContain("title: foo");
      expect(after).toContain("tracker:");
      expect(after).toContain("  linear: STE-1");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("STE-210 — archiveFRWithFlip (AC-STE-210.3 spec-named wrapper)", () => {
  test("AC-STE-210.3: signature is (repoRoot, frPath, archivedAt) → archivePath", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "archive-wrap-"));
    try {
      mkdirSync(join(repoRoot, "specs", "frs", "archive"), { recursive: true });
      const archivePath = join(repoRoot, "specs", "frs", "archive", "STE-2.md");
      writeFileSync(
        archivePath,
        "---\nstatus: active\narchived_at: null\n---\n\n# FR\n",
      );
      const out = await archiveFRWithFlip(repoRoot, "specs/frs/STE-2.md", "2026-05-04T16:00:00Z");
      expect(out).toBe(archivePath);
      const after = readFileSync(archivePath, "utf-8");
      expect(after).toContain("status: archived");
      expect(after).toContain("archived_at: 2026-05-04T16:00:00Z");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("AC-STE-210.3 idempotency: second call is a no-op", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "archive-wrap-idem-"));
    try {
      mkdirSync(join(repoRoot, "specs", "frs", "archive"), { recursive: true });
      const archivePath = join(repoRoot, "specs", "frs", "archive", "STE-3.md");
      writeFileSync(
        archivePath,
        "---\nstatus: archived\narchived_at: 2026-05-04T15:00:00Z\n---\n",
      );
      const before = readFileSync(archivePath, "utf-8");
      await archiveFRWithFlip(repoRoot, "specs/frs/STE-3.md", "2026-05-04T17:00:00Z");
      const after = readFileSync(archivePath, "utf-8");
      // Existing non-null archived_at preserved on idempotent re-run.
      expect(after).toBe(before);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("accepts an already-archive-relative path", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "archive-wrap-rel-"));
    try {
      mkdirSync(join(repoRoot, "specs", "plan", "archive"), { recursive: true });
      const archivePath = join(repoRoot, "specs", "plan", "archive", "M5.md");
      writeFileSync(
        archivePath,
        "---\nstatus: active\narchived_at: null\n---\n",
      );
      const out = await archiveFRWithFlip(
        repoRoot,
        "specs/plan/archive/M5.md",
        "2026-05-04T18:00:00Z",
      );
      expect(out).toBe(archivePath);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
