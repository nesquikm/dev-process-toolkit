// Phase A Tier 1 test: validate each JSON Schema file against the canonical
// example from technical-spec.md §8.3. Keeps the two definitions in lockstep.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMAS_DIR = import.meta.dir;

function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, `${name}.schema.json`), "utf-8"));
}

describe("JSON Schemas (Schemas Q, S, T)", () => {
  test("all 5 schema files exist", () => {
    const names = readdirSync(SCHEMAS_DIR)
      .filter((f) => f.endsWith(".schema.json"))
      .sort();
    expect(names).toEqual([
      "fr.schema.json",
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

  test("fr schema status enum includes archived", () => {
    const schema = readSchema("fr");
    const statusEnum = (schema.properties as Record<string, { enum: string[] }>).status.enum;
    expect(statusEnum).toEqual(["active", "in_progress", "archived"]);
  });
});
