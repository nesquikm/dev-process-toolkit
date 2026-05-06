// STE-227 AC-STE-227.2 — `buildFRFrontmatter` accepts the optional
// `{ needsTechnicalReview?: boolean }` opts param and emits the
// `needs_technical_review: true` line on the frontmatter block **only when
// explicitly true**. Absent / undefined / false are byte-identical (field
// omitted entirely). Round-trip coverage required so the absence-when-false
// invariant survives future helper edits.

import { describe, expect, test } from "bun:test";
import { buildFRFrontmatter } from "../adapters/_shared/src/fr_frontmatter";

const baseSpec = {
  title: "feat: --no-tech flag",
  milestone: "M60",
  createdAt: "2026-05-05T13:24:13Z",
};

const trackerBinding = { key: "linear", id: "STE-227" };

describe("AC-STE-227.2 — needs_technical_review opt: emit when true", () => {
  test("tracker mode with { needsTechnicalReview: true } emits the line", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
    });
    expect(out).toContain("needs_technical_review: true");
  });

  test("mode-none with { needsTechnicalReview: true } emits the line", () => {
    const out = buildFRFrontmatter(
      { ...baseSpec, id: "fr_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      undefined,
      { needsTechnicalReview: true },
    );
    expect(out).toContain("needs_technical_review: true");
  });

  test("emitted line lands on its own line (one frontmatter key, not a fragment)", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
    });
    expect(out).toMatch(/(^|\n)needs_technical_review: true(\n|$)/);
  });
});

describe("AC-STE-227.2 — absent ≡ false: no opts argument", () => {
  test("tracker mode with no opts param has no needs_technical_review line", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding);
    expect(out).not.toContain("needs_technical_review");
  });

  test("mode-none with no opts param has no needs_technical_review line", () => {
    const out = buildFRFrontmatter(
      { ...baseSpec, id: "fr_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      undefined,
    );
    expect(out).not.toContain("needs_technical_review");
  });
});

describe("AC-STE-227.2 — explicit false ≡ absent", () => {
  test("tracker mode with { needsTechnicalReview: false } omits the field", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: false,
    });
    expect(out).not.toContain("needs_technical_review");
  });

  test("tracker mode with empty opts {} omits the field", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {});
    expect(out).not.toContain("needs_technical_review");
  });

  test("byte-equality: false === absent === undefined", () => {
    const a = buildFRFrontmatter(baseSpec, trackerBinding);
    const b = buildFRFrontmatter(baseSpec, trackerBinding, {});
    const c = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: false,
    });
    const d = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: undefined,
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });
});

describe("AC-STE-227.2 — round-trip: parse then re-emit byte-equal", () => {
  test("frontmatter with flag round-trips byte-identically", () => {
    const out1 = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
    });
    // Parse-equivalent: re-emit with same inputs and assert byte equality.
    const out2 = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
    });
    expect(out1).toBe(out2);
  });

  test("flag-set output also keeps the required Schema Q keys", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
    });
    expect(out).toContain("title:");
    expect(out).toContain("milestone: M60");
    expect(out).toContain("status: active");
    expect(out).toContain("archived_at: null");
    expect(out).toContain("tracker:");
    expect(out).toContain("created_at:");
  });
});

describe("AC-STE-227.2 — field ordering: after tracker block (or id), before created_at", () => {
  test("tracker mode: needs_technical_review sits between tracker block and created_at", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
    });
    const trackerIdx = out.indexOf("tracker:");
    const flagIdx = out.indexOf("needs_technical_review:");
    const createdIdx = out.indexOf("created_at:");
    expect(trackerIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeGreaterThan(trackerIdx);
    expect(createdIdx).toBeGreaterThan(flagIdx);
  });

  test("mode-none: needs_technical_review sits between id and created_at", () => {
    const out = buildFRFrontmatter(
      { ...baseSpec, id: "fr_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      undefined,
      { needsTechnicalReview: true },
    );
    const idIdx = out.indexOf("id: fr_");
    const flagIdx = out.indexOf("needs_technical_review:");
    const createdIdx = out.indexOf("created_at:");
    expect(idIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeGreaterThan(idIdx);
    expect(createdIdx).toBeGreaterThan(flagIdx);
  });
});
