// Tests for canonicalBranchTemplate (STE-388 AC-STE-388.1) and its
// composition with /spec-write's branchNameFor (AC-STE-388.3).
//
// AC-STE-388.1: `canonicalBranchTemplate({ milestone })` — pure export
// beside `buildBranchProposal` in `branch_proposal.ts` — returns
// `"{type}/m{N}-{slug}"` when `milestone` is a non-empty digit string and
// `"{type}/{ticket-id}-{slug}"` otherwise. Input classes: present / absent /
// empty / non-digit.
//
// AC-STE-388.3 (functional leg): the § 7a new-FR branch gate derives its
// template via `canonicalBranchTemplate` with `{N}` from the FR's
// `milestone:` frontmatter — milestone-bound FR ⇒ m-form proposal;
// milestone-less FR ⇒ ticket-keyed fallback. `SpecWriteBranchInput` keeps
// its shape (cross-cutting literal untouched).

import { describe, expect, test } from "bun:test";
import { branchNameFor } from "../../../skills/spec-write/branch_name_for";
import { canonicalBranchTemplate } from "./branch_proposal";

const M_FORM = "{type}/m{N}-{slug}";
const TICKET_FORM = "{type}/{ticket-id}-{slug}";

describe("canonicalBranchTemplate — milestone present (AC-STE-388.1)", () => {
  test("non-empty digit string returns the milestone-keyed template", () => {
    expect(canonicalBranchTemplate({ milestone: "106" })).toBe(M_FORM);
  });

  test("single-digit milestone returns the milestone-keyed template", () => {
    expect(canonicalBranchTemplate({ milestone: "5" })).toBe(M_FORM);
  });
});

describe("canonicalBranchTemplate — milestone absent (AC-STE-388.1)", () => {
  test("omitted milestone returns the ticket-keyed fallback", () => {
    expect(canonicalBranchTemplate({})).toBe(TICKET_FORM);
  });

  test("explicit undefined milestone returns the ticket-keyed fallback", () => {
    expect(canonicalBranchTemplate({ milestone: undefined })).toBe(TICKET_FORM);
  });
});

describe("canonicalBranchTemplate — empty milestone (AC-STE-388.1)", () => {
  test("empty string returns the ticket-keyed fallback", () => {
    expect(canonicalBranchTemplate({ milestone: "" })).toBe(TICKET_FORM);
  });
});

describe("canonicalBranchTemplate — non-digit milestone (AC-STE-388.1)", () => {
  test("M-prefixed value is not a digit string", () => {
    expect(canonicalBranchTemplate({ milestone: "M106" })).toBe(TICKET_FORM);
  });

  test("lowercase m-prefixed value is not a digit string", () => {
    expect(canonicalBranchTemplate({ milestone: "m106" })).toBe(TICKET_FORM);
  });

  test("mixed alphanumerics are not a digit string", () => {
    expect(canonicalBranchTemplate({ milestone: "10a" })).toBe(TICKET_FORM);
  });

  test("digits with inner whitespace are not a digit string", () => {
    expect(canonicalBranchTemplate({ milestone: "1 6" })).toBe(TICKET_FORM);
  });
});

describe("/spec-write § 7a gate derives the template via canonicalBranchTemplate (AC-STE-388.3)", () => {
  test("milestone-bound FR renders the m-form proposal", () => {
    const template = canonicalBranchTemplate({ milestone: "106" });
    const result = branchNameFor({
      shape: "new-fr",
      template,
      type: "feat",
      slug: "milestone-branch-naming",
      milestone: "106",
      trackerId: "STE-388",
    });
    expect(result).toBe("feat/m106-milestone-branch-naming");
  });

  test("milestone-less tracker-mode FR falls back to the ticket-keyed form", () => {
    const template = canonicalBranchTemplate({});
    const result = branchNameFor({
      shape: "new-fr",
      template,
      type: "feat",
      slug: "branch-naming",
      trackerId: "STE-388",
    });
    expect(result).toBe("feat/ste-388-branch-naming");
  });

  test("milestone-less mode-none FR falls back to the short-ULID ticket form", () => {
    const template = canonicalBranchTemplate({});
    const result = branchNameFor({
      shape: "new-fr",
      template,
      type: "feat",
      slug: "branch-naming",
      shortUlid: "vdtaf4",
    });
    expect(result).toBe("feat/vdtaf4-branch-naming");
  });

  test("SpecWriteBranchInput keeps its shape: cross-cutting literal unchanged", () => {
    expect(branchNameFor({ shape: "cross-cutting" })).toBe("docs/specs-cross-cutting");
  });
});
