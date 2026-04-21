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
      ticketId: "PROJ-1",
      now: "2026-04-18T10:00:00Z",
    });
    expect(line.startsWith("- ")).toBe(true);
    expect(line).toContain(" — ");
  });

  // AC-39.11: production-path guard. The DPT_TEST_FROZEN_TIME override
  // must be ignored unless NODE_ENV === "test", so a misconfigured
  // production process can never emit a frozen timestamp.
  test("ignores DPT_TEST_FROZEN_TIME when NODE_ENV is not 'test' (AC-39.11)", () => {
    const originalFrozen = process.env["DPT_TEST_FROZEN_TIME"];
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["DPT_TEST_FROZEN_TIME"] = "2025-01-01T00:00:00Z";
    process.env["NODE_ENV"] = "production";
    try {
      const line = formatSyncLogEntry({ conflictCount: 5, ticketId: "PROD-9" });
      // Must NOT contain the frozen value — should fall back to real clock.
      expect(line).not.toContain("2025-01-01T00:00:00Z");
      expect(line).toMatch(
        /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z — 5 AC conflicts resolved on PROD-9$/,
      );
    } finally {
      if (originalFrozen === undefined) delete process.env["DPT_TEST_FROZEN_TIME"];
      else process.env["DPT_TEST_FROZEN_TIME"] = originalFrozen;
      if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalNodeEnv;
    }
  });

  test("ignores DPT_TEST_FROZEN_TIME when NODE_ENV is unset (AC-39.11)", () => {
    const originalFrozen = process.env["DPT_TEST_FROZEN_TIME"];
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["DPT_TEST_FROZEN_TIME"] = "2025-01-01T00:00:00Z";
    delete process.env["NODE_ENV"];
    try {
      const line = formatSyncLogEntry({ conflictCount: 1, ticketId: "NOENV-1" });
      expect(line).not.toContain("2025-01-01T00:00:00Z");
      expect(line).toMatch(
        /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z — 1 AC conflicts resolved on NOENV-1$/,
      );
    } finally {
      if (originalFrozen === undefined) delete process.env["DPT_TEST_FROZEN_TIME"];
      else process.env["DPT_TEST_FROZEN_TIME"] = originalFrozen;
      if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalNodeEnv;
    }
  });

  // Symmetry: existing test already covers NODE_ENV=test + DPT_TEST_FROZEN_TIME.
  // This duplicates the setup explicitly so future edits to the guard can't
  // accidentally regress the happy-path without failing a dedicated test.
  test("honors DPT_TEST_FROZEN_TIME when NODE_ENV is 'test' (AC-39.11)", () => {
    const originalFrozen = process.env["DPT_TEST_FROZEN_TIME"];
    const originalNodeEnv = process.env["NODE_ENV"];
    process.env["DPT_TEST_FROZEN_TIME"] = "2026-04-18T10:00:00Z";
    process.env["NODE_ENV"] = "test";
    try {
      const line = formatSyncLogEntry({ conflictCount: 2, ticketId: "LIN-42" });
      expect(line).toBe("- 2026-04-18T10:00:00Z — 2 AC conflicts resolved on LIN-42");
    } finally {
      if (originalFrozen === undefined) delete process.env["DPT_TEST_FROZEN_TIME"];
      else process.env["DPT_TEST_FROZEN_TIME"] = originalFrozen;
      if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = originalNodeEnv;
    }
  });
});
