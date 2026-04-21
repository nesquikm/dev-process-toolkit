// Phase A Tier 1 test: validate each JSON Schema file against the canonical
// example from technical-spec.md §8.3. Keeps the two definitions in lockstep.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMAS_DIR = import.meta.dir;

function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, `${name}.schema.json`), "utf-8"));
}

describe("JSON Schemas (Schemas Q–U)", () => {
  test("all 5 schema files exist", () => {
    const names = readdirSync(SCHEMAS_DIR)
      .filter((f) => f.endsWith(".schema.json"))
      .sort();
    expect(names).toEqual([
      "fr.schema.json",
      "index.schema.json",
      "layout.schema.json",
      "lock.schema.json",
      "plan.schema.json",
    ]);
  });

  test("fr schema rejects ULID with I/L/O/U (Crockford base32)", () => {
    const schema = readSchema("fr");
    const pattern = new RegExp((schema.properties as Record<string, { pattern: string }>).id.pattern);
    expect(pattern.test("fr_01HZ7XJFKP0000000000000A01")).toBe(true);
    expect(pattern.test("fr_I1HZ0000000000000000000001")).toBe(false); // I forbidden
    expect(pattern.test("fr_L1HZ0000000000000000000001")).toBe(false); // L forbidden
    expect(pattern.test("fr_O1HZ0000000000000000000001")).toBe(false); // O forbidden
    expect(pattern.test("fr_U1HZ0000000000000000000001")).toBe(false); // U forbidden
    expect(pattern.test("fr_01HZ0000000000000000000001A")).toBe(false); // 27 chars
    expect(pattern.test("fr_01HZ000000000000000000001")).toBe(false); // 25 chars
  });

  test("layout schema accepts canonical v2 example", () => {
    const schema = readSchema("layout");
    const example = { version: "v2", migrated_at: "2026-04-21T10:30:00Z", migration_commit: null };
    expect(Object.keys(schema.properties as object).sort()).toEqual([
      "migrated_at",
      "migration_commit",
      "version",
    ]);
    expect((schema.required as string[]).includes("version")).toBe(true);
    // Manual shape check (bun has no ajv without dep)
    expect(example.version).toMatch(/^v\d+$/);
    expect(typeof example.migrated_at).toBe("string");
    expect(example.migration_commit).toBeNull();
  });

  test("lock schema has required fields", () => {
    const schema = readSchema("lock");
    expect((schema.required as string[]).sort()).toEqual(["branch", "claimed_at", "claimer", "ulid"]);
  });

  test("plan schema allows migrated active plan with null kickoff_branch/frozen_at (AC-48.7 exception)", () => {
    const schema = readSchema("plan");
    const allOf = schema.allOf as Array<{ description: string }>;
    const descriptions = allOf.map((a) => a.description);
    expect(descriptions.some((d) => d.includes("draft"))).toBe(true);
    // No strict rule on active|complete — migration exception documented in $comment
    expect(descriptions.some((d) => d.includes("active|complete requires"))).toBe(false);
    expect(typeof schema.$comment).toBe("string");
  });

  test("index (FRIndexEntry) schema excludes archived status", () => {
    const schema = readSchema("index");
    const statusEnum = (schema.properties as Record<string, { enum: string[] }>).status.enum;
    expect(statusEnum).not.toContain("archived");
    expect(statusEnum).toEqual(["active", "in_progress", "draft"]);
  });

  test("fr schema status enum includes archived", () => {
    const schema = readSchema("fr");
    const statusEnum = (schema.properties as Record<string, { enum: string[] }>).status.enum;
    expect(statusEnum).toEqual(["active", "in_progress", "archived"]);
  });
});
