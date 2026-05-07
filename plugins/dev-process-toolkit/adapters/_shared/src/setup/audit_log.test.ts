// STE-232 AC-STE-232.4 — collocated round-trip + tolerant-parse tests for
// `appendAuditRow` / `parseAuditRow`. The legacy STE-108 / STE-153 tests for
// `appendAuditEntry` continue to live at `tests/setup_audit_log.test.ts`.
//
// The plan/M65.md gate-command line cites this collocated path explicitly,
// so the file must exist next to the source even though the test bodies
// duplicate the AC-STE-232.4 cases also asserted in tests/.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAuditRow,
  parseAuditRow,
  type AuditRow,
  type AuditSource,
} from "./audit_log";

function tmpClaudeMd(initial: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "audit-log-collocated-"));
  const path = join(dir, "CLAUDE.md");
  writeFileSync(path, initial);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const sampleRow: AuditRow = {
  date: "2026-05-07",
  step: "7b",
  field: "tracker_mode",
  value: "linear",
  source: "user-supplied",
};

describe("AC-STE-232.4 — appendAuditRow imputed-column rendering (collocated)", () => {
  test.each<[AuditSource, string, boolean]>([
    ["user-supplied", "user-supplied", false],
    ["pre-baked", "pre-baked", true],
    ["default-applied", "default applied", true],
    ["model-imputed", "model-imputed", true],
  ])(
    "source=%s ⇒ reason=%s, imputed=%s",
    (source, expectedReason, expectedImputed) => {
      const ctx = tmpClaudeMd("# Project\n");
      try {
        appendAuditRow(ctx.path, { ...sampleRow, source });
        const out = readFileSync(ctx.path, "utf-8");
        expect(out).toContain(
          `value:"linear" reason:"${expectedReason}" imputed:${expectedImputed}`,
        );
      } finally {
        ctx.cleanup();
      }
    },
  );
});

describe("AC-STE-232.4 — parseAuditRow tolerant parse + round-trip (collocated)", () => {
  test("round-trip: render with imputed:false → parse recovers the row", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, sampleRow);
      const line = readFileSync(ctx.path, "utf-8")
        .split("\n")
        .find((l) => l.startsWith("- 2026-05-07"))!;
      const parsed = parseAuditRow(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.imputed).toBe(false);
      expect(parsed!.value).toBe("linear");
    } finally {
      ctx.cleanup();
    }
  });

  test("legacy row (no imputed: column) ⇒ parses with imputed=undefined", () => {
    const legacy = `- 2026-04-25 step:7c (branch_template) value:"feat/{ticket-id}-{slug}" reason:"default applied"`;
    const parsed = parseAuditRow(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBeUndefined();
    expect(parsed!.reason).toBe("default applied");
  });

  test("non-row line ⇒ null (heading / blank / prose)", () => {
    expect(parseAuditRow("## /setup audit")).toBeNull();
    expect(parseAuditRow("")).toBeNull();
    expect(parseAuditRow("body prose without leading bullet shape")).toBeNull();
  });
});
