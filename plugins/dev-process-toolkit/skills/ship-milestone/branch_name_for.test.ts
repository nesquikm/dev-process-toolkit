// Tests for /ship-milestone `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// /ship-milestone has a single run shape — release. Branch name is
// `release/v<X.Y.Z>`. Collision suffixing (`-2` for the rare double-ship)
// is the gate's responsibility, not the builder's.

import { describe, expect, test } from "bun:test";
import { branchNameFor } from "./branch_name_for";

describe("/ship-milestone branchNameFor — AC-STE-228.4", () => {
  test("release version 2.11.0 → 'release/v2.11.0'", () => {
    expect(branchNameFor({ version: "2.11.0" })).toBe("release/v2.11.0");
  });

  test("release version 2.12.0 → 'release/v2.12.0'", () => {
    expect(branchNameFor({ version: "2.12.0" })).toBe("release/v2.12.0");
  });

  test("release version with v-prefix is normalized (single 'v' in output)", () => {
    expect(branchNameFor({ version: "v3.0.0" })).toBe("release/v3.0.0");
  });

  test("release version with single-digit components renders verbatim", () => {
    expect(branchNameFor({ version: "1.0.0" })).toBe("release/v1.0.0");
  });

  test("release version with two-digit minor renders verbatim", () => {
    expect(branchNameFor({ version: "1.37.0" })).toBe("release/v1.37.0");
  });
});
