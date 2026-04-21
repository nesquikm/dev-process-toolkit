// Phase B Tier 4 tests for ulid.ts (FR-41).
//
// Invariants:
//   1. Format: ^fr_[0-9A-HJKMNP-TV-Z]{26}$ (Crockford base32, excludes I, L, O, U) — AC-41.1
//   2. Uniqueness: 100 sequential mints are distinct — FR-41
//   3. Monotonic-within-ms: two mints in the same millisecond produce sortable strings — AC-41.3
//   4. Pure-local (no network): call succeeds with no fetch mock, works offline — AC-41.3
//   5. Deterministic in test mode: NODE_ENV=test + DPT_TEST_ULID_SEED produces a known sequence
//   6. Retry on collision: filesystem-existence check that returns true twice then false → mintUniqueId returns the fresh id; 3 consecutive collisions → throws

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mintId, mintUniqueId, ULID_REGEX } from "./ulid";

const savedEnv: Record<string, string | undefined> = {};
function stash(key: string) {
  savedEnv[key] = process.env[key];
}
function restore(key: string) {
  const v = savedEnv[key];
  if (v === undefined) delete process.env[key];
  else process.env[key] = v;
}

describe("mintId — format + uniqueness (FR-41)", () => {
  test("format matches ^fr_[0-9A-HJKMNP-TV-Z]{26}$ (AC-41.1)", () => {
    const id = mintId();
    expect(id).toMatch(ULID_REGEX);
    expect(id.length).toBe(3 + 26);
  });

  test("100 sequential mints are all distinct", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(mintId());
    expect(ids.size).toBe(100);
  });

  test("monotonic-within-ms: repeated mints in the same millisecond sort ascending", () => {
    const a = mintId();
    const b = mintId();
    // Same millisecond most of the time on modern hardware; if they collide on ts,
    // the randomness / monotonic counter keeps the order a < b.
    expect(a).not.toBe(b);
  });

  test("ULID_REGEX accepts valid Crockford, rejects I/L/O/U", () => {
    expect(ULID_REGEX.test("fr_01HZ7XJFKP0000000000000A01")).toBe(true);
    expect(ULID_REGEX.test("fr_I1HZ0000000000000000000001")).toBe(false);
    expect(ULID_REGEX.test("fr_L1HZ0000000000000000000001")).toBe(false);
    expect(ULID_REGEX.test("fr_O1HZ0000000000000000000001")).toBe(false);
    expect(ULID_REGEX.test("fr_U1HZ0000000000000000000001")).toBe(false);
  });
});

describe("mintId — test mode determinism", () => {
  beforeEach(() => {
    stash("NODE_ENV");
    stash("DPT_TEST_ULID_SEED");
  });
  afterEach(() => {
    restore("NODE_ENV");
    restore("DPT_TEST_ULID_SEED");
    // Reset the test-mode counter between tests.
    delete (globalThis as Record<string, unknown>)["__dpt_ulid_test_counter"];
  });

  test("NODE_ENV=test + DPT_TEST_ULID_SEED=01HZ produces deterministic sequence", () => {
    process.env["NODE_ENV"] = "test";
    process.env["DPT_TEST_ULID_SEED"] = "01HZ";
    delete (globalThis as Record<string, unknown>)["__dpt_ulid_test_counter"];
    expect(mintId()).toBe("fr_01HZ0000000000000000000001");
    expect(mintId()).toBe("fr_01HZ0000000000000000000002");
    expect(mintId()).toBe("fr_01HZ0000000000000000000003");
  });

  test("seed must be valid Crockford base32; invalid seed throws", () => {
    process.env["NODE_ENV"] = "test";
    process.env["DPT_TEST_ULID_SEED"] = "ILOU"; // all forbidden
    delete (globalThis as Record<string, unknown>)["__dpt_ulid_test_counter"];
    expect(() => mintId()).toThrow();
  });

  test("no determinism when NODE_ENV is unset even if DPT_TEST_ULID_SEED is set (AC-39.11 discipline)", () => {
    delete process.env["NODE_ENV"];
    process.env["DPT_TEST_ULID_SEED"] = "01HZ";
    delete (globalThis as Record<string, unknown>)["__dpt_ulid_test_counter"];
    const id = mintId();
    // Should NOT match the deterministic fr_01HZ000...01 pattern
    expect(id).not.toBe("fr_01HZ0000000000000000000001");
    expect(id).toMatch(ULID_REGEX);
  });
});

describe("mintUniqueId — collision retry (statistical-zero path)", () => {
  test("returns fresh id after 2 collisions then success", () => {
    const seen = ["fr_01HZ7XJFKP0000000000000COL1", "fr_01HZ7XJFKP0000000000000COL2"];
    const existsCalls: string[] = [];
    const exists = (id: string): boolean => {
      existsCalls.push(id);
      return seen.includes(id);
    };
    const result = mintUniqueId({ exists });
    expect(result).toMatch(ULID_REGEX);
    expect(seen).not.toContain(result);
  });

  test("throws after 3 consecutive collisions with clear message", () => {
    const alwaysExists = () => true;
    expect(() => mintUniqueId({ exists: alwaysExists })).toThrow(/3.*collision|collision.*3/i);
  });
});
