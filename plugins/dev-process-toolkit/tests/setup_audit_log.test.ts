import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAuditEntry,
  appendAuditRow,
  parseAuditRow,
  type AuditEntry,
  type AuditRow,
  type AuditSource,
} from "../adapters/_shared/src/setup/audit_log";

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

describe("appendAuditEntry — STE-153 user-supplied provenance", () => {
  // STE-153 AC-STE-153.1: every Schema L resolution at 7b/7c/7d records into
  // the audit table — user-supplied resolutions render the same bullet shape
  // as default-applied ones, only the `reason:` substring changes. Escape
  // rules (JSON.stringify on value + reason) are unchanged.
  test("renders the canonical bullet shape with reason: \"user-supplied\"", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      const userSuppliedEntry: AuditEntry = {
        date: "2026-04-29",
        step: "7c",
        field: "branch_template",
        value: "feat/{ticket-id}-{slug}",
        reason: "user-supplied",
      };
      appendAuditEntry(ctx.path, userSuppliedEntry);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toMatch(/## \/setup audit\n/);
      expect(out).toContain(
        `- 2026-04-29 step:7c (branch_template) value:"feat/{ticket-id}-{slug}" reason:"user-supplied"`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("docs.user_facing_mode user-supplied true renders boolean unquoted, reason quoted", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      const userSuppliedDocs: AuditEntry = {
        date: "2026-04-29",
        step: "7d",
        field: "docs.user_facing_mode",
        value: true,
        reason: "user-supplied",
      };
      appendAuditEntry(ctx.path, userSuppliedDocs);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `- 2026-04-29 step:7d (docs.user_facing_mode) value:true reason:"user-supplied"`,
      );
    } finally {
      ctx.cleanup();
    }
  });
});

// STE-232 AC-STE-232.4 — `## /setup audit` row format gains `imputed: true|false`.
// Helper `appendAuditRow(...)` accepts `source: 'user-supplied' | 'pre-baked'
// | 'default-applied' | 'model-imputed'` and derives `imputed = source !==
// 'user-supplied'`. Legacy rows (no `imputed:` column) parsed tolerantly;
// rewritten on next mutation. Round-trip parser test below.

const sampleRow: AuditRow = {
  date: "2026-05-07",
  step: "7b",
  field: "tracker_mode",
  value: "linear",
  source: "user-supplied",
};

describe("AC-STE-232.4 — appendAuditRow imputed-column rendering", () => {
  test("source=user-supplied ⇒ imputed:false rendered in row", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, sampleRow);
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"user-supplied" imputed:false`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("source=pre-baked ⇒ imputed:true rendered (CLI flag answer is not human-confirmed)", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, source: "pre-baked" });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"pre-baked" imputed:true`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("source=default-applied ⇒ imputed:true rendered (default applied via auto-approve marker)", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, source: "default-applied" });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"default applied" imputed:true`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("source=model-imputed ⇒ imputed:true rendered (the bug case the column makes detectable)", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, source: "model-imputed" });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"model-imputed" imputed:true`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("explicit reason override is preserved verbatim, source still drives imputed", () => {
    // Adapters with finer-grained provenance (e.g., "MCP unregistered; deferred")
    // pass an explicit `reason` override. The source still drives `imputed:`.
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, {
        ...sampleRow,
        source: "default-applied",
        reason: "MCP unregistered at /setup time; deferred to first downstream skill",
      });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `reason:"MCP unregistered at /setup time; deferred to first downstream skill" imputed:true`,
      );
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-232.4 — parseAuditRow tolerant parse + round-trip", () => {
  test("round-trip: render → parse → matches original", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, sampleRow);
      const out = readFileSync(ctx.path, "utf-8");
      const line = out
        .split("\n")
        .find((l) => l.startsWith("- 2026-05-07"))!;
      const parsed = parseAuditRow(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.date).toBe("2026-05-07");
      expect(parsed!.step).toBe("7b");
      expect(parsed!.field).toBe("tracker_mode");
      expect(parsed!.value).toBe("linear");
      expect(parsed!.reason).toBe("user-supplied");
      expect(parsed!.imputed).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  test("tolerant parse: legacy row (no imputed: column) parses to imputed=undefined", () => {
    // Legacy STE-108/153 rows pre-date STE-232 and carry no `imputed:` token.
    // The parser must still return them so dedup + audit-presence probes
    // continue to work across legacy + new files.
    const legacyLine = `- 2026-04-25 step:7c (branch_template) value:"feat/{ticket-id}-{slug}" reason:"default applied"`;
    const parsed = parseAuditRow(legacyLine);
    expect(parsed).not.toBeNull();
    expect(parsed!.date).toBe("2026-04-25");
    expect(parsed!.step).toBe("7c");
    expect(parsed!.field).toBe("branch_template");
    expect(parsed!.value).toBe("feat/{ticket-id}-{slug}");
    expect(parsed!.reason).toBe("default applied");
    expect(parsed!.imputed).toBeUndefined();
  });

  test("parses imputed:true correctly", () => {
    const line = `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"pre-baked" imputed:true`;
    const parsed = parseAuditRow(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBe(true);
    expect(parsed!.reason).toBe("pre-baked");
  });

  test("non-row line (heading, blank, prose) ⇒ returns null", () => {
    expect(parseAuditRow("## /setup audit")).toBeNull();
    expect(parseAuditRow("")).toBeNull();
    expect(parseAuditRow("Some narrative line about the setup.")).toBeNull();
  });

  test("source list is the closed set declared by AC-STE-232.4", () => {
    // The four canonical source values. Compile-time enforced by the type;
    // this runtime assertion documents the closed set so a future AC
    // extension is a deliberate test edit.
    const sources: AuditSource[] = [
      "user-supplied",
      "pre-baked",
      "default-applied",
      "model-imputed",
    ];
    expect(sources.length).toBe(4);
  });
});
