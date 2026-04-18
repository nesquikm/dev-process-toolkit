import { describe, expect, test } from "bun:test";
import { formatSyncLogEntry } from "./sync_log";

describe("formatSyncLogEntry", () => {
  test("uses explicit now override when provided", () => {
    const line = formatSyncLogEntry({
      conflictCount: 2,
      ticketId: "LIN-42",
      now: "2026-04-18T10:00:00Z",
    });
    expect(line).toBe("- 2026-04-18T10:00:00Z — 2 AC conflicts resolved on LIN-42");
  });

  test("reads DPT_TEST_FROZEN_TIME when now not passed", () => {
    const original = process.env["DPT_TEST_FROZEN_TIME"];
    process.env["DPT_TEST_FROZEN_TIME"] = "2025-01-01T00:00:00Z";
    try {
      const line = formatSyncLogEntry({ conflictCount: 1, ticketId: "ABC-7" });
      expect(line).toBe("- 2025-01-01T00:00:00Z — 1 AC conflicts resolved on ABC-7");
    } finally {
      if (original === undefined) delete process.env["DPT_TEST_FROZEN_TIME"];
      else process.env["DPT_TEST_FROZEN_TIME"] = original;
    }
  });

  test("falls back to Date.now() when neither override is set", () => {
    const original = process.env["DPT_TEST_FROZEN_TIME"];
    delete process.env["DPT_TEST_FROZEN_TIME"];
    try {
      const line = formatSyncLogEntry({ conflictCount: 3, ticketId: "LIN-1" });
      expect(line).toMatch(/^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z — 3 AC conflicts resolved on LIN-1$/);
    } finally {
      if (original !== undefined) process.env["DPT_TEST_FROZEN_TIME"] = original;
    }
  });

  test("leading bullet marker is exact Schema L form", () => {
    const line = formatSyncLogEntry({
      conflictCount: 0,
      ticketId: "ASANA-1",
      now: "2026-04-18T10:00:00Z",
    });
    expect(line.startsWith("- ")).toBe(true);
    expect(line).toContain(" — ");
  });
});
