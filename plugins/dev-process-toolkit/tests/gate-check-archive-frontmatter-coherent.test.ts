import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runArchiveFrontmatterCoherentProbe } from "../adapters/_shared/src/archive_frontmatter_coherent";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dpt-archive-coh-"));
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  mkdirSync(join(root, "specs", "plan", "archive"), { recursive: true });
  return root;
}
function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("STE-210 — archive-frontmatter-coherent probe (AC-STE-210.4)", () => {
  test("clean archive (status: archived + archived_at populated) passes", async () => {
    const root = makeRoot();
    try {
      writeFileSync(
        join(root, "specs", "frs", "archive", "STE-1.md"),
        "---\nstatus: archived\narchived_at: 2026-05-04T12:00:00Z\nmilestone: M1\n---\n\n# FR\n",
      );
      writeFileSync(
        join(root, "specs", "plan", "archive", "M1.md"),
        "---\nstatus: archived\narchived_at: 2026-05-04T12:00:00Z\nmilestone: M1\n---\n\n# Plan\n",
      );
      const r = await runArchiveFrontmatterCoherentProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("F11 bug shape (status: active in archived FR) fires ERROR", async () => {
    const root = makeRoot();
    try {
      writeFileSync(
        join(root, "specs", "frs", "archive", "STE-1.md"),
        "---\nstatus: active\narchived_at: null\nmilestone: M1\n---\n\n# FR\n",
      );
      const r = await runArchiveFrontmatterCoherentProbe(root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/STE-1\.md:1 — archived file frontmatter shows status: active/);
    } finally {
      cleanup(root);
    }
  });

  test("missing archived_at fires ERROR", async () => {
    const root = makeRoot();
    try {
      writeFileSync(
        join(root, "specs", "plan", "archive", "M2.md"),
        "---\nstatus: archived\nmilestone: M2\n---\n",
      );
      const r = await runArchiveFrontmatterCoherentProbe(root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toMatch(/M2\.md:1 — archived file frontmatter has unset archived_at/);
    } finally {
      cleanup(root);
    }
  });

  test("vacuous on fresh repo with no archive directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "dpt-archive-coh-empty-"));
    try {
      const r = await runArchiveFrontmatterCoherentProbe(root);
      expect(r.violations).toEqual([]);
    } finally {
      cleanup(root);
    }
  });

  test("walks both frs/archive AND plan/archive", async () => {
    const root = makeRoot();
    try {
      writeFileSync(
        join(root, "specs", "frs", "archive", "STE-1.md"),
        "---\nstatus: active\narchived_at: null\n---\n",
      );
      writeFileSync(
        join(root, "specs", "plan", "archive", "M1.md"),
        "---\nstatus: active\narchived_at: null\n---\n",
      );
      const r = await runArchiveFrontmatterCoherentProbe(root);
      expect(r.violations.length).toBe(2);
    } finally {
      cleanup(root);
    }
  });
});
