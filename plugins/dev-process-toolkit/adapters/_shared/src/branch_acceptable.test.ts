// Tests for isCurrentBranchAcceptable (STE-64 AC-STE-64.4).
//
// Covers main/master rejection, milestone-identifier match (case-insensitive,
// word-boundary so m19 does not accept m191), tracker-ID match (FR runs,
// tracker mode), and short-ULID match (FR runs, mode: none).

import { describe, expect, test } from "bun:test";
import { isCurrentBranchAcceptable } from "./branch_proposal";

describe("isCurrentBranchAcceptable — main/master rejection (AC-STE-64.4)", () => {
  test("main is rejected for any run scope", () => {
    expect(
      isCurrentBranchAcceptable("main", { kind: "milestone", number: "19" }),
    ).toBe(false);
    expect(
      isCurrentBranchAcceptable("main", { kind: "fr-tracker", trackerId: "STE-64" }),
    ).toBe(false);
    expect(
      isCurrentBranchAcceptable("main", { kind: "fr-mode-none", shortUlid: "vdtaf4" }),
    ).toBe(false);
  });

  test("master is rejected for any run scope", () => {
    expect(
      isCurrentBranchAcceptable("master", { kind: "milestone", number: "19" }),
    ).toBe(false);
  });

  test("MAIN and Master (case variants) are rejected", () => {
    expect(
      isCurrentBranchAcceptable("MAIN", { kind: "milestone", number: "19" }),
    ).toBe(false);
    expect(
      isCurrentBranchAcceptable("Master", { kind: "milestone", number: "19" }),
    ).toBe(false);
  });
});

describe("isCurrentBranchAcceptable — milestone match (AC-STE-64.4)", () => {
  test("branch containing m19 is acceptable for M19 run", () => {
    expect(
      isCurrentBranchAcceptable("feat/m19-branch-automation", {
        kind: "milestone",
        number: "19",
      }),
    ).toBe(true);
  });

  test("milestone match is case-insensitive", () => {
    expect(
      isCurrentBranchAcceptable("feat/M19-branch-automation", {
        kind: "milestone",
        number: "19",
      }),
    ).toBe(true);
  });

  test("branch missing milestone is rejected", () => {
    expect(
      isCurrentBranchAcceptable("feat/m12-tracker-integration", {
        kind: "milestone",
        number: "19",
      }),
    ).toBe(false);
  });

  test("m19 inside m191 is rejected (word boundary)", () => {
    // Without word boundary, plain .includes('m19') would falsely accept.
    // We want strict milestone-identifier matching, not digit-extending substr.
    expect(
      isCurrentBranchAcceptable("feat/m191-something", {
        kind: "milestone",
        number: "19",
      }),
    ).toBe(false);
  });

  test("m19 next to alpha is rejected (word boundary)", () => {
    expect(
      isCurrentBranchAcceptable("feat/dm19-something", {
        kind: "milestone",
        number: "19",
      }),
    ).toBe(false);
  });

  test("no-prefix branch containing just 'm19' is acceptable", () => {
    expect(
      isCurrentBranchAcceptable("m19", { kind: "milestone", number: "19" }),
    ).toBe(true);
  });
});

describe("isCurrentBranchAcceptable — tracker-ID match (AC-STE-64.4)", () => {
  test("branch containing tracker ID is acceptable", () => {
    expect(
      isCurrentBranchAcceptable("feat/ste-64-branch-template", {
        kind: "fr-tracker",
        trackerId: "STE-64",
      }),
    ).toBe(true);
  });

  test("tracker-ID match is case-insensitive", () => {
    expect(
      isCurrentBranchAcceptable("feat/STE-64-branch-template", {
        kind: "fr-tracker",
        trackerId: "STE-64",
      }),
    ).toBe(true);
    expect(
      isCurrentBranchAcceptable("feat/ste-64-branch-template", {
        kind: "fr-tracker",
        trackerId: "ste-64",
      }),
    ).toBe(true);
  });

  test("branch missing tracker ID is rejected", () => {
    expect(
      isCurrentBranchAcceptable("feat/m19-branch-automation", {
        kind: "fr-tracker",
        trackerId: "STE-64",
      }),
    ).toBe(false);
  });
});

describe("isCurrentBranchAcceptable — short-ULID match (AC-STE-64.4, AC-STE-64.7)", () => {
  test("branch containing short-ULID tail is acceptable", () => {
    expect(
      isCurrentBranchAcceptable("feat/vdtaf4-add-thing", {
        kind: "fr-mode-none",
        shortUlid: "vdtaf4",
      }),
    ).toBe(true);
  });

  test("short-ULID match is case-insensitive", () => {
    expect(
      isCurrentBranchAcceptable("feat/VDTAF4-add-thing", {
        kind: "fr-mode-none",
        shortUlid: "vdtaf4",
      }),
    ).toBe(true);
  });

  test("branch missing short-ULID is rejected", () => {
    expect(
      isCurrentBranchAcceptable("feat/unrelated", {
        kind: "fr-mode-none",
        shortUlid: "vdtaf4",
      }),
    ).toBe(false);
  });
});
