// Tests for /spec-write `branchNameFor()` builder (STE-228 AC-STE-228.4).
//
// /spec-write has two run shapes:
//   - new-FR run        → delegates to existing buildBranchProposal
//                         (template rendering); tested via mocked input.
//   - cross-cutting-only run → returns the literal `docs/specs-cross-cutting`.

import { describe, expect, test } from "bun:test";
import { branchNameFor } from "./branch_name_for";

describe("/spec-write branchNameFor — cross-cutting (AC-STE-228.4)", () => {
  test("cross-cutting-only run returns 'docs/specs-cross-cutting'", () => {
    const result = branchNameFor({ shape: "cross-cutting" });
    expect(result).toBe("docs/specs-cross-cutting");
  });
});

describe("/spec-write branchNameFor — new-FR (AC-STE-228.4)", () => {
  test("new-FR tracker mode delegates to template rendering", () => {
    // Template + identity → delegated rendering must produce the expected
    // branch name (matches the existing buildBranchProposal contract).
    const result = branchNameFor({
      shape: "new-fr",
      template: "{type}/{ticket-id}-{slug}",
      type: "feat",
      slug: "branch-gate",
      trackerId: "STE-228",
    });
    expect(result).toBe("feat/ste-228-branch-gate");
  });

  test("new-FR mode-none uses milestone substitution", () => {
    const result = branchNameFor({
      shape: "new-fr",
      template: "{type}/m{N}-{slug}",
      type: "feat",
      slug: "branch-gate",
      milestone: "61",
    });
    expect(result).toBe("feat/m61-branch-gate");
  });

  test("new-FR with mode-none short-ULID substitutes {ticket-id}", () => {
    const result = branchNameFor({
      shape: "new-fr",
      template: "{type}/{ticket-id}-{slug}",
      type: "feat",
      slug: "thing",
      shortUlid: "vdtaf4",
    });
    expect(result).toBe("feat/vdtaf4-thing");
  });
});
