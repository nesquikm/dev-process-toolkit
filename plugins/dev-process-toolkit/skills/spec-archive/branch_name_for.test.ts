// Tests for /spec-archive `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// /spec-archive has two run shapes:
//   - FR archive        → `chore/archive-<tracker-id>`  (lowercased ID)
//   - milestone archive → `chore/archive-m<N>`

import { describe, expect, test } from "bun:test";
import { branchNameFor } from "./branch_name_for";

describe("/spec-archive branchNameFor — FR archive (AC-STE-228.4)", () => {
  test("FR archive with tracker ID renders 'chore/archive-<id>' (lowercased)", () => {
    expect(branchNameFor({ shape: "fr", trackerId: "STE-227" })).toBe(
      "chore/archive-ste-227",
    );
  });

  test("FR archive lowercases mixed-case tracker IDs", () => {
    expect(branchNameFor({ shape: "fr", trackerId: "Ste-228" })).toBe(
      "chore/archive-ste-228",
    );
  });

  test("FR archive returns identical output for already-lowercase input", () => {
    expect(branchNameFor({ shape: "fr", trackerId: "ste-100" })).toBe(
      "chore/archive-ste-100",
    );
  });
});

describe("/spec-archive branchNameFor — milestone archive (AC-STE-228.4)", () => {
  test("milestone archive renders 'chore/archive-m<N>'", () => {
    expect(branchNameFor({ shape: "milestone", milestone: 61 })).toBe(
      "chore/archive-m61",
    );
  });

  test("milestone archive accepts string milestone numbers", () => {
    expect(branchNameFor({ shape: "milestone", milestone: "62" })).toBe(
      "chore/archive-m62",
    );
  });

  test("milestone archive renders single-digit milestone correctly", () => {
    expect(branchNameFor({ shape: "milestone", milestone: 7 })).toBe(
      "chore/archive-m7",
    );
  });
});
