// STE-381 — `branchTypeFor` deterministic branch-type derivation.
//
// AC-STE-381.1: pure helper keyed on the FR's `changelog_category`
// frontmatter (STE-73 read-side default `Added`), with `noTech === true` as
// the highest-precedence override (⇒ `chore`). `changelogCategory ∈
// {Fixed, Security}` ⇒ `fix`; any other value including absent ⇒ `feat`.
// Never throws; return set is a subset of STE-64 AC-13's clamp allow-list.
//
// AC-STE-381.3: `/spec-write` § 7a composition — callers derive `type` via
// the helper and pass it through `branchNameFor`'s new-FR arm; a `--no-tech`
// run proposes `chore/<tracker-id>-<slug>`.
//
// AC-STE-381.5 (guard): `buildBranchProposal`'s signature stays unchanged —
// callers pass the derived value through the existing `type` field.

import { describe, expect, test } from "bun:test";
import { branchTypeFor } from "./branch_type_for";
import { buildBranchProposal } from "./branch_proposal";
import { branchNameFor } from "../../../skills/spec-write/branch_name_for";

const CANONICAL_CATEGORIES = [
  "Added",
  "Changed",
  "Deprecated",
  "Removed",
  "Fixed",
  "Security",
] as const;

const TEMPLATE = "{type}/{ticket-id}-{slug}";

describe("AC-STE-381.1 — matrix: 6 canonical categories × noTech: false", () => {
  const expected: Record<string, "feat" | "fix"> = {
    Added: "feat",
    Changed: "feat",
    Deprecated: "feat",
    Removed: "feat",
    Fixed: "fix",
    Security: "fix",
  };
  for (const category of CANONICAL_CATEGORIES) {
    test(`${category} + noTech:false ⇒ ${expected[category]}`, () => {
      expect(branchTypeFor({ changelogCategory: category, noTech: false })).toBe(
        expected[category]!,
      );
    });
  }
});

describe("AC-STE-381.1 — matrix: 6 canonical categories × noTech: true ⇒ chore", () => {
  for (const category of CANONICAL_CATEGORIES) {
    test(`${category} + noTech:true ⇒ chore`, () => {
      expect(branchTypeFor({ changelogCategory: category, noTech: true })).toBe("chore");
    });
  }
});

describe("AC-STE-381.1 — absent category (STE-73 read-side default Added) ⇒ feat", () => {
  test("empty opts object ⇒ feat", () => {
    expect(branchTypeFor({})).toBe("feat");
  });

  test("noTech:false with no category ⇒ feat", () => {
    expect(branchTypeFor({ noTech: false })).toBe("feat");
  });

  test("explicit undefined for both fields ⇒ feat", () => {
    expect(branchTypeFor({ changelogCategory: undefined, noTech: undefined })).toBe("feat");
  });
});

describe("AC-STE-381.1 — unknown category strings ⇒ feat (defensive tolerance, never throws)", () => {
  test("unknown string 'Bugfix' ⇒ feat", () => {
    expect(branchTypeFor({ changelogCategory: "Bugfix" })).toBe("feat");
  });

  test("lowercase 'fixed' is not in the closed set ⇒ feat (strict membership)", () => {
    expect(branchTypeFor({ changelogCategory: "fixed" })).toBe("feat");
  });

  test("empty string ⇒ feat", () => {
    expect(branchTypeFor({ changelogCategory: "" })).toBe("feat");
  });

  test("never throws across the whole input grid", () => {
    const categories = [...CANONICAL_CATEGORIES, "Bugfix", "fixed", "", undefined];
    const noTechs = [true, false, undefined];
    for (const changelogCategory of categories) {
      for (const noTech of noTechs) {
        expect(() => branchTypeFor({ changelogCategory, noTech })).not.toThrow();
      }
    }
  });
});

describe("AC-STE-381.1 — precedence: noTech beats Fixed/Security", () => {
  test("Fixed + noTech:true ⇒ chore (not fix)", () => {
    expect(branchTypeFor({ changelogCategory: "Fixed", noTech: true })).toBe("chore");
  });

  test("Security + noTech:true ⇒ chore (not fix)", () => {
    expect(branchTypeFor({ changelogCategory: "Security", noTech: true })).toBe("chore");
  });
});

describe("AC-STE-381.1 — return set ⊆ STE-64 AC-13 clamp allow-list", () => {
  test("every grid output is one of feat | fix | chore", () => {
    const legal = new Set(["feat", "fix", "chore"]);
    const categories = [...CANONICAL_CATEGORIES, "Bugfix", "", undefined];
    const noTechs = [true, false, undefined];
    for (const changelogCategory of categories) {
      for (const noTech of noTechs) {
        expect(legal.has(branchTypeFor({ changelogCategory, noTech }))).toBe(true);
      }
    }
  });
});

describe("AC-STE-381.3 — derived type feeds branchNameFor's new-FR arm", () => {
  test("--no-tech run proposes chore/<tracker-id>-<slug>", () => {
    const type = branchTypeFor({ changelogCategory: "Added", noTech: true });
    const name = branchNameFor({
      shape: "new-fr",
      template: TEMPLATE,
      type,
      slug: "milestone-next-line",
      trackerId: "STE-381",
    });
    expect(name).toBe("chore/ste-381-milestone-next-line");
  });

  test("Fixed category (no --no-tech) proposes fix/<tracker-id>-<slug>", () => {
    const type = branchTypeFor({ changelogCategory: "Fixed", noTech: false });
    const name = branchNameFor({
      shape: "new-fr",
      template: TEMPLATE,
      type,
      slug: "milestone-next-line",
      trackerId: "STE-381",
    });
    expect(name).toBe("fix/ste-381-milestone-next-line");
  });

  test("absent category (default Added) proposes feat/<tracker-id>-<slug>", () => {
    const type = branchTypeFor({});
    const name = branchNameFor({
      shape: "new-fr",
      template: TEMPLATE,
      type,
      slug: "milestone-next-line",
      trackerId: "STE-381",
    });
    expect(name).toBe("feat/ste-381-milestone-next-line");
  });

  test("cross-cutting arm is untouched by the derivation contract", () => {
    expect(branchNameFor({ shape: "cross-cutting" })).toBe("docs/specs-cross-cutting");
  });
});

describe("AC-STE-381.5 (guard) — buildBranchProposal signature unchanged", () => {
  test("callers pass the derived value through the existing `type` field", () => {
    const name = buildBranchProposal({
      template: TEMPLATE,
      type: branchTypeFor({ changelogCategory: "Changed" }),
      slug: "signpost",
      trackerId: "STE-381",
    });
    expect(name).toBe("feat/ste-381-signpost");
  });

  test("STE-64 AC-13 clamp path still accepts every helper output verbatim", () => {
    for (const type of ["feat", "fix", "chore"]) {
      const name = buildBranchProposal({
        template: TEMPLATE,
        type,
        slug: "signpost",
        trackerId: "STE-381",
      });
      expect(name).toBe(`${type}/ste-381-signpost`);
    }
  });
});
