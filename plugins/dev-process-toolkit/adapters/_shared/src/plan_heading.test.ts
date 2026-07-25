// STE-335 AC-STE-335.1 / .6 — shared plan-heading parser matrix.
//
// `parsePlanHeading(md)` matches a milestone heading at EITHER `#` or `##`
// depth, with EITHER an em-dash (—) or colon (:) separator, and an optional
// trailing `{#M<N>}` anchor. It returns the canonical name normalized to
// `M<N> — <title>` (em-dash, regardless of source separator), or `null` when
// no milestone heading is present.
//
// Matrix: {`#`, `##`} × {`—`, `:`} × {anchor present, absent}, plus headingless
// (→ null) and titles containing `/` and `:` (greedy/lazy nuance — a colon-form
// title that itself contains a colon must still capture the FULL title).

import { describe, expect, test } from "bun:test";
import { parsePlanHeading } from "./plan_heading";

const CANONICAL = "M31 — Tracker Workflow Hardening"; // U+2014 em-dash

describe("AC-STE-335.1 — depth × separator × anchor matrix", () => {
  test("H1 + em-dash, no anchor → canonical", () => {
    expect(parsePlanHeading("# M31 — Tracker Workflow Hardening\n")).toBe(CANONICAL);
  });

  test("H1 + em-dash, anchor present → canonical (anchor stripped)", () => {
    expect(parsePlanHeading("# M31 — Tracker Workflow Hardening {#M31}\n")).toBe(CANONICAL);
  });

  test("H1 + colon, no anchor → canonical (separator normalized to em-dash)", () => {
    expect(parsePlanHeading("# M31: Tracker Workflow Hardening\n")).toBe(CANONICAL);
  });

  test("H1 + colon, anchor present → canonical", () => {
    expect(parsePlanHeading("# M31: Tracker Workflow Hardening {#M31}\n")).toBe(CANONICAL);
  });

  test("H2 + em-dash, no anchor → canonical", () => {
    expect(parsePlanHeading("## M31 — Tracker Workflow Hardening\n")).toBe(CANONICAL);
  });

  test("H2 + em-dash, anchor present → canonical", () => {
    expect(parsePlanHeading("## M31 — Tracker Workflow Hardening {#M31}\n")).toBe(CANONICAL);
  });

  test("H2 + colon, no anchor → canonical (current /spec-write form sans anchor)", () => {
    expect(parsePlanHeading("## M31: Tracker Workflow Hardening\n")).toBe(CANONICAL);
  });

  test("H2 + colon, anchor present → canonical (current plan-template form)", () => {
    expect(parsePlanHeading("## M31: Tracker Workflow Hardening {#M31}\n")).toBe(CANONICAL);
  });
});

describe("AC-STE-335.1 — normalization preserves em-dash byte + drops anchor", () => {
  test("colon source still yields a U+2014 em-dash at index 4", () => {
    const got = parsePlanHeading("## M31: Tracker Workflow Hardening {#M31}\n");
    expect(got).not.toBeNull();
    expect(got!.charCodeAt(4)).toBe(0x2014);
  });

  test("anchor is never present in the returned name", () => {
    const got = parsePlanHeading("## M86: Jira Project-Milestone Support {#M86}\n");
    expect(got).toBe("M86 — Jira Project-Milestone Support");
    expect(got!).not.toContain("{#");
  });
});

describe("AC-STE-335.1 — headingless → null", () => {
  test("non-milestone headings return null", () => {
    expect(parsePlanHeading("# Some other heading\n\n## Subhead\n")).toBeNull();
  });

  test("empty document returns null", () => {
    expect(parsePlanHeading("")).toBeNull();
  });

  test("prose without any milestone heading returns null", () => {
    expect(parsePlanHeading("just body text\nmore text\n")).toBeNull();
  });
});

describe("AC-STE-335.1 — boundary negatives (Stage C hardening)", () => {
  test("H3 (`### M<N>:`) is NOT a milestone heading → null (depth capped at H1/H2)", () => {
    expect(parsePlanHeading("### M1: Too deep\n")).toBeNull();
  });

  test("hyphen-minus separator (`## M1 - Foo`) → null (only em-dash or colon)", () => {
    // A plain ASCII hyphen `-` is NOT the U+2014 em-dash the canonical form uses;
    // accepting it would let a typo silently bind a half-parsed milestone name.
    expect(parsePlanHeading("## M1 - Foo\n")).toBeNull();
  });

  test("no space after `#` (`#M1: Foo`) → null (heading requires whitespace)", () => {
    expect(parsePlanHeading("#M1: Foo\n")).toBeNull();
  });

  test("empty title (`## M1:`) → null (a title is required)", () => {
    expect(parsePlanHeading("## M1:\n")).toBeNull();
  });
});

describe("AC-STE-335.1 — titles with `/` and `:` (greedy/lazy nuance)", () => {
  test("title containing a slash is captured whole", () => {
    expect(parsePlanHeading("## M1: Foundation / Scaffolding\n")).toBe(
      "M1 — Foundation / Scaffolding",
    );
  });

  test("colon-form title that itself contains a colon captures the FULL title", () => {
    // Only the FIRST `:` is the separator; the rest belongs to the title.
    expect(parsePlanHeading("## M2: Foo: Bar\n")).toBe("M2 — Foo: Bar");
  });

  test("colon-form title with a colon AND an anchor still captures the full title", () => {
    expect(parsePlanHeading("## M2: Foo: Bar {#M2}\n")).toBe("M2 — Foo: Bar");
  });

  test("em-dash form with a slash title and anchor", () => {
    expect(parsePlanHeading("# M1 — Foundation / Scaffolding {#M1}\n")).toBe(
      "M1 — Foundation / Scaffolding",
    );
  });
});

describe("AC-STE-335.1 — multi-line documents (heading not on first line)", () => {
  test("frontmatter + blank line + heading still parses", () => {
    const md = "---\nmilestone: M31\nstatus: active\n---\n\n## M31: Tracker Workflow Hardening {#M31}\n\nbody\n";
    expect(parsePlanHeading(md)).toBe(CANONICAL);
  });
});

describe("AC-STE-335.6 — legacy H1+em-dash regression", () => {
  test("legacy `# M<N> — <title>` parses to the identical canonical name", () => {
    expect(parsePlanHeading("# M30 — Stale doc references\n")).toBe("M30 — Stale doc references");
  });

  test("multi-digit milestone numbers parse", () => {
    expect(parsePlanHeading("# M120 — multi-digit milestone\n")).toBe(
      "M120 — multi-digit milestone",
    );
  });
});

// ---------------------------------------------------------------------------
// STE-376 AC-STE-376.2 — M_<epic-key> union grammar. `parsePlanHeading`
// accepts Epic-keyed milestone tokens across the same {`#`,`##`} × {`—`,`:`}
// matrix as numeric tokens, normalizing to `M_<epic-key> — <title>`.
// ---------------------------------------------------------------------------

describe("AC-STE-376.2 — M_<epic-key> depth × separator matrix", () => {
  const EPIC_CANONICAL = "M_PROJ_500 — Epic-keyed milestone"; // U+2014 em-dash

  test("H1 + em-dash → canonical", () => {
    expect(parsePlanHeading("# M_PROJ_500 — Epic-keyed milestone\n")).toBe(EPIC_CANONICAL);
  });

  test("H1 + colon → canonical (separator normalized to em-dash)", () => {
    expect(parsePlanHeading("# M_PROJ_500: Epic-keyed milestone\n")).toBe(EPIC_CANONICAL);
  });

  test("H2 + em-dash → canonical", () => {
    expect(parsePlanHeading("## M_PROJ_500 — Epic-keyed milestone\n")).toBe(EPIC_CANONICAL);
  });

  test("H2 + colon → canonical (current plan-template form)", () => {
    expect(parsePlanHeading("## M_PROJ_500: Epic-keyed milestone\n")).toBe(EPIC_CANONICAL);
  });

  test("anchor form is stripped from the canonical name", () => {
    expect(parsePlanHeading("## M_PROJ_500: Epic-keyed milestone {#M_PROJ_500}\n")).toBe(
      EPIC_CANONICAL,
    );
  });

  test("colon source still yields a U+2014 em-dash separator", () => {
    const got = parsePlanHeading("## M_PROJ_500: Epic-keyed milestone\n");
    expect(got).not.toBeNull();
    // "M_PROJ_500 " is 11 chars — the separator byte sits at index 11.
    expect(got!.charCodeAt(11)).toBe(0x2014);
  });

  test("hyphen-form epic key (raw Jira key shape) parses whole", () => {
    expect(parsePlanHeading("## M_PROJ-500: Epic-keyed milestone\n")).toBe(
      "M_PROJ-500 — Epic-keyed milestone",
    );
  });

  test("frontmatter + blank line + epic heading still parses", () => {
    const md =
      "---\nmilestone: M_PROJ_500\nstatus: active\n---\n\n## M_PROJ_500: Epic-keyed milestone {#M_PROJ_500}\n\nbody\n";
    expect(parsePlanHeading(md)).toBe("M_PROJ_500 — Epic-keyed milestone");
  });
});

describe("AC-STE-376.2 — malformed epic tokens stay unparsed", () => {
  test("`## M_: <title>` (empty key) → null", () => {
    expect(parsePlanHeading("## M_: Empty key\n")).toBeNull();
  });

  test("ASCII-hyphen separator after an epic token → null (only em-dash or colon)", () => {
    expect(parsePlanHeading("## M_PROJ_500 - Epic-keyed milestone\n")).toBeNull();
  });
});
