import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAuditEntry, type AuditEntry } from "../adapters/_shared/src/setup/audit_log";

// STE-108 AC-STE-108.7 — `appendAuditEntry(claudeMdPath, entry)` helper.
//
// Three behaviors:
//   (a) section absent → create `## /setup audit` with the entry
//   (b) section present → append the entry as a new bullet
//   (c) idempotent — appending the same entry twice still produces two
//       distinct bullets (no de-dup); the helper is purely append-only.

function tmpClaudeMd(initial: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "audit-log-"));
  const path = join(dir, "CLAUDE.md");
  writeFileSync(path, initial);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const sampleEntry: AuditEntry = {
  date: "2026-04-25",
  step: "7c",
  field: "branch_template",
  value: "{type}/{ticket-id}-{slug}",
  reason: "default applied",
};

describe("appendAuditEntry — create-section case", () => {
  test("creates `## /setup audit` block at end of file when missing", () => {
    const ctx = tmpClaudeMd("# Project\n\nBody.\n");
    try {
      appendAuditEntry(ctx.path, sampleEntry);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toMatch(/## \/setup audit\n/);
      expect(out).toMatch(
        /- 2026-04-25 step:7c \(branch_template\) value:"{type}\/{ticket-id}-{slug}" reason:"default applied"/,
      );
      expect(out.startsWith("# Project\n\nBody.\n")).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  test("preserves trailing newline shape (no double-blank-line drift)", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditEntry(ctx.path, sampleEntry);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).not.toMatch(/\n\n\n/);
      expect(out.endsWith("\n")).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("appendAuditEntry — append-entry case", () => {
  test("appends a new bullet under existing `## /setup audit` section", () => {
    const initial = `# Project\n\n## /setup audit\n\n- 2026-04-25 step:7d (docs.packages_mode) value:false reason:"default applied"\n`;
    const ctx = tmpClaudeMd(initial);
    try {
      appendAuditEntry(ctx.path, sampleEntry);
      const out = readFileSync(ctx.path, "utf-8");
      // Both bullets present.
      expect(out).toMatch(/docs\.packages_mode/);
      expect(out).toMatch(/branch_template/);
      // Order preserved (existing first, new last).
      expect(out.indexOf("docs.packages_mode")).toBeLessThan(out.indexOf("branch_template"));
    } finally {
      ctx.cleanup();
    }
  });

  test("works when the section is followed by another `##` heading (insert before it)", () => {
    const initial = `# Project\n\n## /setup audit\n\n- 2026-04-25 step:7d (docs.packages_mode) value:false reason:"default applied"\n\n## Another\n\nfoo\n`;
    const ctx = tmpClaudeMd(initial);
    try {
      appendAuditEntry(ctx.path, sampleEntry);
      const out = readFileSync(ctx.path, "utf-8");
      // The new bullet must land before `## Another`, not after.
      expect(out.indexOf("branch_template")).toBeLessThan(out.indexOf("## Another"));
    } finally {
      ctx.cleanup();
    }
  });
});

describe("appendAuditEntry — idempotent-append (no de-dup)", () => {
  test("appending the same entry twice yields two bullets", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditEntry(ctx.path, sampleEntry);
      appendAuditEntry(ctx.path, sampleEntry);
      const out = readFileSync(ctx.path, "utf-8");
      const matches = out.match(/branch_template/g);
      expect(matches?.length).toBe(2);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("appendAuditEntry — file-missing case fails loudly", () => {
  test("throws when the CLAUDE.md path does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-log-missing-"));
    const missing = join(dir, "no-such.md");
    try {
      expect(() => appendAuditEntry(missing, sampleEntry)).toThrow(/CLAUDE\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
