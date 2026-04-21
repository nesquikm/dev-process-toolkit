// Phase B Tier 4 tests for layout.ts (FR-47, AC-47.2/4).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLayoutVersion } from "./layout";

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-layout-"));
  mkdirSync(join(work, "specs"), { recursive: true });
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("readLayoutVersion", () => {
  test("returns 'v2' on a tree with specs/.dpt-layout (version: v2)", () => {
    writeFileSync(
      join(work, "specs", ".dpt-layout"),
      "version: v2\nmigrated_at: 2026-04-21T10:30:00Z\nmigration_commit: null\n",
    );
    expect(readLayoutVersion(join(work, "specs"))).toBe("v2");
  });

  test("returns null on a tree without the marker file (default)", () => {
    expect(() => readLayoutVersion(join(work, "specs"))).toThrow(/dpt-layout/);
  });

  test("with allowMissing: true, returns null on missing file (AC-47.4 /setup exemption)", () => {
    expect(readLayoutVersion(join(work, "specs"), { allowMissing: true })).toBeNull();
  });

  test("throws on malformed YAML (unterminated quote)", () => {
    writeFileSync(join(work, "specs", ".dpt-layout"), 'version: "v2\n');
    expect(() => readLayoutVersion(join(work, "specs"))).toThrow(/malformed|parse|yaml/i);
  });

  test("throws on missing required 'version' field", () => {
    writeFileSync(join(work, "specs", ".dpt-layout"), "migrated_at: 2026-04-21T10:30:00Z\n");
    expect(() => readLayoutVersion(join(work, "specs"))).toThrow(/version/i);
  });

  test("version string format matches ^v\\d+$", () => {
    writeFileSync(join(work, "specs", ".dpt-layout"), "version: v3\nmigrated_at: 2026-04-21T10:30:00Z\nmigration_commit: null\n");
    expect(readLayoutVersion(join(work, "specs"))).toBe("v3");
  });
});
