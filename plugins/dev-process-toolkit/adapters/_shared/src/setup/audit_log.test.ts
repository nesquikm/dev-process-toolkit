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

describe("AC-STE-237.6 — appendAuditRow loop_entered column rendering", () => {
  test("loopEntered: true ⇒ rendered row carries `loop_entered:true`", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, loopEntered: true });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `value:"linear" reason:"user-supplied" imputed:false loop_entered:true`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("loopEntered: false ⇒ rendered row carries `loop_entered:false`", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, loopEntered: false });
      const out = readFileSync(ctx.path, "utf-8");
      expect(out).toContain(
        `value:"linear" reason:"user-supplied" imputed:false loop_entered:false`,
      );
    } finally {
      ctx.cleanup();
    }
  });

  test("loopEntered omitted ⇒ rendered row has NO loop_entered column (back-compat)", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, sampleRow);
      const out = readFileSync(ctx.path, "utf-8");
      const line = out.split("\n").find((l) => l.startsWith("- 2026-05-07"))!;
      expect(line).not.toContain("loop_entered:");
      expect(line).toMatch(/imputed:(true|false)$/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-237.6 — parseAuditRow tolerant parse for loop_entered (round-trip + permutations)", () => {
  test("round-trip: render with loopEntered=true → parse recovers true", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, loopEntered: true });
      const line = readFileSync(ctx.path, "utf-8")
        .split("\n")
        .find((l) => l.startsWith("- 2026-05-07"))!;
      const parsed = parseAuditRow(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.loopEntered).toBe(true);
      expect(parsed!.imputed).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  test("round-trip: render with loopEntered=false → parse recovers false", () => {
    const ctx = tmpClaudeMd("# Project\n");
    try {
      appendAuditRow(ctx.path, { ...sampleRow, loopEntered: false });
      const line = readFileSync(ctx.path, "utf-8")
        .split("\n")
        .find((l) => l.startsWith("- 2026-05-07"))!;
      const parsed = parseAuditRow(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.loopEntered).toBe(false);
    } finally {
      ctx.cleanup();
    }
  });

  test("legacy row (no loop_entered:, no imputed:) ⇒ both undefined", () => {
    const legacy = `- 2026-04-25 step:7c (branch_template) value:"feat/{ticket-id}-{slug}" reason:"default applied"`;
    const parsed = parseAuditRow(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBeUndefined();
    expect(parsed!.loopEntered).toBeUndefined();
  });

  test("STE-232 row (imputed: present, no loop_entered:) ⇒ imputed parsed, loopEntered undefined", () => {
    const ste232 = `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"user-supplied" imputed:false`;
    const parsed = parseAuditRow(ste232);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBe(false);
    expect(parsed!.loopEntered).toBeUndefined();
  });

  test("both columns present (STE-237 shape) ⇒ both parsed", () => {
    const ste237 = `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"user-supplied" imputed:false loop_entered:true`;
    const parsed = parseAuditRow(ste237);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBe(false);
    expect(parsed!.loopEntered).toBe(true);
  });

  test("loop_entered:true with imputed:true (model-imputed loop-entered shape)", () => {
    const row = `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"default applied" imputed:true loop_entered:true`;
    const parsed = parseAuditRow(row);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBe(true);
    expect(parsed!.loopEntered).toBe(true);
  });

  test("loop_entered:false flags magpie regression class", () => {
    const row = `- 2026-05-07 step:7b (tracker_mode) value:"linear" reason:"model-imputed" imputed:true loop_entered:false`;
    const parsed = parseAuditRow(row);
    expect(parsed).not.toBeNull();
    expect(parsed!.imputed).toBe(true);
    expect(parsed!.loopEntered).toBe(false);
  });
});
