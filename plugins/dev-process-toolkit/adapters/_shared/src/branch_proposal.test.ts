// Tests for buildBranchProposal (STE-64 AC-STE-64.5, .7, .13).
//
// Covers template rendering across mode: none + tracker mode, slug/type
// sanitization against adversarial inputs, 60-char truncation clamp
// affecting slug only, and the empty-slug NFR-10 refusal.

import { describe, expect, test } from "bun:test";
import {
  buildBranchProposal,
  EmptySlugError,
  type BranchProposalContext,
} from "./branch_proposal";

function ctx(overrides: Partial<BranchProposalContext> = {}): BranchProposalContext {
  return {
    template: "{type}/m{N}-{slug}",
    type: "feat",
    slug: "add-thing",
    milestone: "19",
    trackerId: undefined,
    shortUlid: undefined,
    ...overrides,
  };
}

describe("buildBranchProposal — template rendering (AC-STE-64.5)", () => {
  test("mode: none default template renders {type}/m{N}-{slug}", () => {
    expect(buildBranchProposal(ctx())).toBe("feat/m19-add-thing");
  });

  test("tracker-mode default template renders {type}/{ticket-id}-{slug}", () => {
    const result = buildBranchProposal(
      ctx({
        template: "{type}/{ticket-id}-{slug}",
        trackerId: "STE-64",
      }),
    );
    expect(result).toBe("feat/ste-64-add-thing");
  });

  test("mode: none template with {ticket-id} substitutes the short-ULID tail lowercased (AC-STE-64.7)", () => {
    const result = buildBranchProposal(
      ctx({
        template: "{type}/{ticket-id}-{slug}",
        shortUlid: "vdtaf4",
        milestone: undefined,
      }),
    );
    expect(result).toBe("feat/vdtaf4-add-thing");
  });

  test("all four substitutions work together", () => {
    const result = buildBranchProposal(
      ctx({
        template: "{type}/m{N}-{ticket-id}-{slug}",
        milestone: "19",
        trackerId: "STE-64",
        slug: "branch-template",
      }),
    );
    expect(result).toBe("feat/m19-ste-64-branch-template");
  });

  test("type 'fix' and 'chore' substitute as expected", () => {
    expect(buildBranchProposal(ctx({ type: "fix" }))).toBe("fix/m19-add-thing");
    expect(buildBranchProposal(ctx({ type: "chore" }))).toBe("chore/m19-add-thing");
  });
});

describe("buildBranchProposal — type clamping (AC-STE-64.13)", () => {
  test("unknown type defaults to feat", () => {
    expect(buildBranchProposal(ctx({ type: "refactor" }))).toBe("feat/m19-add-thing");
    expect(buildBranchProposal(ctx({ type: "docs" }))).toBe("feat/m19-add-thing");
    expect(buildBranchProposal(ctx({ type: "" }))).toBe("feat/m19-add-thing");
  });

  test("type stripped of disallowed chars before match", () => {
    // $() and backticks → stripped → "feat" survives; clamp keeps allowed "feat"
    expect(buildBranchProposal(ctx({ type: "$(feat)" }))).toBe("feat/m19-add-thing");
    expect(buildBranchProposal(ctx({ type: "`fix`" }))).toBe("fix/m19-add-thing");
  });

  test("type case-insensitive when matching", () => {
    expect(buildBranchProposal(ctx({ type: "FEAT" }))).toBe("feat/m19-add-thing");
    expect(buildBranchProposal(ctx({ type: "Chore" }))).toBe("chore/m19-add-thing");
  });
});

describe("buildBranchProposal — slug sanitizer (AC-STE-64.13)", () => {
  test("shell-metachar injection stripped: $()", () => {
    expect(buildBranchProposal(ctx({ slug: "add$(rm-rf)-thing" }))).toBe("feat/m19-addrm-rf-thing");
  });

  test("backticks stripped", () => {
    expect(buildBranchProposal(ctx({ slug: "add-`pwned`-thing" }))).toBe("feat/m19-add-pwned-thing");
  });

  test("semicolons stripped", () => {
    expect(buildBranchProposal(ctx({ slug: "add;rm-rf" }))).toBe("feat/m19-addrm-rf");
  });

  test("newlines stripped", () => {
    expect(buildBranchProposal(ctx({ slug: "add\nrm-rf" }))).toBe("feat/m19-addrm-rf");
  });

  test("spaces stripped (slug must be kebab)", () => {
    expect(buildBranchProposal(ctx({ slug: "add rm rf" }))).toBe("feat/m19-addrmrf");
  });

  test("path-traversal .. stripped", () => {
    expect(buildBranchProposal(ctx({ slug: "../../../etc/passwd" }))).toBe("feat/m19-etcpasswd");
  });

  test("uppercase letters lowercased", () => {
    expect(buildBranchProposal(ctx({ slug: "Add-New-Feature" }))).toBe("feat/m19-add-new-feature");
  });

  test("Unicode homoglyphs stripped (e.g. Cyrillic 'а' U+0430)", () => {
    // 'а' is Cyrillic U+0430, visually identical to Latin 'a' but not [a-z]
    expect(buildBranchProposal(ctx({ slug: "аdd-thing" }))).toBe("feat/m19-dd-thing");
  });

  test("collapses runs of hyphens", () => {
    expect(buildBranchProposal(ctx({ slug: "add---many----hyphens" }))).toBe(
      "feat/m19-add-many-hyphens",
    );
  });

  test("strips leading and trailing hyphens from slug", () => {
    expect(buildBranchProposal(ctx({ slug: "-add-thing-" }))).toBe("feat/m19-add-thing");
  });

  test("digits preserved in slug", () => {
    expect(buildBranchProposal(ctx({ slug: "fix-issue-42" }))).toBe("feat/m19-fix-issue-42");
  });
});

describe("buildBranchProposal — empty slug NFR-10 refusal (AC-STE-64.13)", () => {
  test("empty slug throws EmptySlugError", () => {
    expect(() => buildBranchProposal(ctx({ slug: "" }))).toThrow(EmptySlugError);
  });

  test("slug that sanitizes to empty throws EmptySlugError", () => {
    // All disallowed chars → nothing survives → empty
    expect(() => buildBranchProposal(ctx({ slug: "$();|&`" }))).toThrow(EmptySlugError);
  });

  test("slug that sanitizes to only hyphens throws EmptySlugError", () => {
    // After stripping leading/trailing/runs, pure-hyphen input becomes empty
    expect(() => buildBranchProposal(ctx({ slug: "---" }))).toThrow(EmptySlugError);
  });

  test("EmptySlugError message carries NFR-10 canonical shape", () => {
    try {
      buildBranchProposal(ctx({ slug: "$()" }));
      throw new Error("expected throw");
    } catch (err) {
      if (!(err instanceof EmptySlugError)) throw err;
      expect(err.message).toContain("Remedy:");
      expect(err.message).toContain("Context:");
    }
  });
});

describe("buildBranchProposal — 60-char truncation (AC-STE-64.5)", () => {
  test("rendered branch <=60 chars is not truncated", () => {
    const result = buildBranchProposal(
      ctx({ slug: "short-slug" }),
    );
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toBe("feat/m19-short-slug");
  });

  test("rendered branch >60 chars truncates slug only", () => {
    const result = buildBranchProposal(
      ctx({
        slug: "extremely-long-slug-that-exceeds-any-reasonable-budget-by-a-wide-margin-indeed",
      }),
    );
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.startsWith("feat/m19-")).toBe(true);
  });

  test("truncated slug does not end in a hyphen (clean suffix)", () => {
    const result = buildBranchProposal(
      ctx({
        slug: "extremely-long-slug-that-exceeds-any-reasonable-budget-by-a-wide-margin",
      }),
    );
    expect(result.endsWith("-")).toBe(false);
  });

  test("truncation preserves non-slug template parts verbatim", () => {
    const result = buildBranchProposal(
      ctx({
        template: "{type}/{ticket-id}-{slug}",
        trackerId: "STE-64",
        slug: "a".repeat(100),
      }),
    );
    expect(result.startsWith("feat/ste-64-")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  test("template prefix alone exceeds 60 chars ⇒ throws EmptySlugError (no `feat/m19-` malformed result)", () => {
    // If the non-slug portion already spends the entire 60-char budget,
    // slug gets truncated to empty. Rather than return `prefix-` with a
    // dangling hyphen, the renderer must throw — the user picks [e] to
    // supply a shorter prefix or rejects the proposal.
    expect(() =>
      buildBranchProposal(
        ctx({
          template: "feat/super-long-prefix-that-eats-the-whole-sixty-char-budget-already/{slug}",
          slug: "short",
        }),
      ),
    ).toThrow(EmptySlugError);
  });
});
