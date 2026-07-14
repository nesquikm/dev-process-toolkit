// STE-381 AC-STE-381.2 — `buildFRFrontmatter` accepts the optional
// `{ changelogCategory?: string }` opt on `BuildFRFrontmatterOpts` and emits
// `changelog_category: <value>` after `created_at:` (the shipped M102-era
// file shape) **only when provided**. Opt absent ⇒ byte-identical output to
// today. Round-trip coverage per the STE-227 AC.2 pattern
// (tests/fr-frontmatter-needs-technical-review.test.ts) — extend, don't
// rewrite.

import { describe, expect, test } from "bun:test";
import { buildFRFrontmatter } from "../adapters/_shared/src/fr_frontmatter";

const baseSpec = {
  title: "Deterministic branch-type derivation",
  milestone: "M103",
  createdAt: "2026-07-14T16:20:20Z",
};

const trackerBinding = { key: "linear", id: "STE-381" };
const ULID = "fr_01ARZ3NDEKTSV4RRFFQ69G5FAV";

const CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

describe("AC-STE-381.2 — changelog_category opt: emit when provided", () => {
  test("tracker mode with { changelogCategory: 'Changed' } emits the line", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: "Changed",
    });
    expect(out).toContain("changelog_category: Changed");
  });

  test("mode-none with { changelogCategory: 'Changed' } emits the line", () => {
    const out = buildFRFrontmatter({ ...baseSpec, id: ULID }, undefined, {
      changelogCategory: "Changed",
    });
    expect(out).toContain("changelog_category: Changed");
  });

  test("every closed Keep-a-Changelog set value round-trips verbatim", () => {
    for (const category of CATEGORIES) {
      const out = buildFRFrontmatter(baseSpec, trackerBinding, {
        changelogCategory: category,
      });
      expect(out).toContain(`changelog_category: ${category}`);
    }
  });

  test("emitted line lands on its own line (one frontmatter key, not a fragment)", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: "Changed",
    });
    expect(out).toMatch(/(^|\n)changelog_category: Changed(\n|$)/);
  });
});

describe("AC-STE-381.2 — canonical position: after created_at (M102-era file shape)", () => {
  test("tracker mode: changelog_category sits immediately after created_at, before closing ---", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: "Changed",
    });
    expect(out).toMatch(
      /\ncreated_at: 2026-07-14T16:20:20Z\nchangelog_category: Changed\n---\n$/,
    );
  });

  test("mode-none: created_at < changelog_category by index", () => {
    const out = buildFRFrontmatter({ ...baseSpec, id: ULID }, undefined, {
      changelogCategory: "Added",
    });
    const createdIdx = out.indexOf("created_at:");
    const categoryIdx = out.indexOf("changelog_category:");
    expect(createdIdx).toBeGreaterThan(-1);
    expect(categoryIdx).toBeGreaterThan(createdIdx);
  });

  test("both opts present: tracker → needs_technical_review → created_at → changelog_category", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      needsTechnicalReview: true,
      changelogCategory: "Security",
    });
    const trackerIdx = out.indexOf("tracker:");
    const flagIdx = out.indexOf("needs_technical_review:");
    const createdIdx = out.indexOf("created_at:");
    const categoryIdx = out.indexOf("changelog_category:");
    expect(trackerIdx).toBeGreaterThan(-1);
    expect(flagIdx).toBeGreaterThan(trackerIdx);
    expect(createdIdx).toBeGreaterThan(flagIdx);
    expect(categoryIdx).toBeGreaterThan(createdIdx);
  });
});

describe("AC-STE-381.2 — opt absent ⇒ byte-identical output to today", () => {
  test("no opts param has no changelog_category line (tracker mode)", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding);
    expect(out).not.toContain("changelog_category");
  });

  test("no opts param has no changelog_category line (mode-none)", () => {
    const out = buildFRFrontmatter({ ...baseSpec, id: ULID }, undefined);
    expect(out).not.toContain("changelog_category");
  });

  test("empty opts {} omits the field", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {});
    expect(out).not.toContain("changelog_category");
  });

  test("byte-equality: absent === {} === { changelogCategory: undefined }", () => {
    const a = buildFRFrontmatter(baseSpec, trackerBinding);
    const b = buildFRFrontmatter(baseSpec, trackerBinding, {});
    const c = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: undefined,
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("AC-STE-381.2 — round-trip: re-emit byte-equal + Schema Q keys retained", () => {
  test("opt-set output round-trips byte-identically", () => {
    const out1 = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: "Changed",
    });
    const out2 = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: "Changed",
    });
    expect(out1).toBe(out2);
  });

  test("opt-set output keeps the required Schema Q keys", () => {
    const out = buildFRFrontmatter(baseSpec, trackerBinding, {
      changelogCategory: "Changed",
    });
    expect(out).toContain("title:");
    expect(out).toContain("milestone: M103");
    expect(out).toContain("status: active");
    expect(out).toContain("archived_at: null");
    expect(out).toContain("tracker:");
    expect(out).toContain("created_at:");
  });
});
