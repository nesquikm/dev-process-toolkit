// Tests for /setup `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// The /setup bootstrap commit has no FR / tracker context — the builder
// returns a fixed literal `chore/setup-bootstrap`. Collision suffixing
// (e.g. `-2`) is the gate's responsibility, not the builder's.

import { describe, expect, test } from "bun:test";
import { branchNameFor } from "./branch_name_for";

describe("/setup branchNameFor — AC-STE-228.4", () => {
  test("returns the literal 'chore/setup-bootstrap'", () => {
    expect(branchNameFor()).toBe("chore/setup-bootstrap");
  });

  test("is deterministic across calls (no random suffix from builder)", () => {
    expect(branchNameFor()).toBe(branchNameFor());
  });

  test("returned name matches the documented branch-name table in STE-228", () => {
    // Sanity: the canonical-table row for /setup bootstrap reads
    //   `chore/setup-bootstrap` — collision becomes `-2`.
    expect(branchNameFor()).toMatch(/^chore\/setup-bootstrap$/);
  });
});
