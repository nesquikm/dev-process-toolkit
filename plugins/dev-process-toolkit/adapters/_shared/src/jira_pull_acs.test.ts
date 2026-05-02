// jira_pull_acs — STE-190: ADF-escape tolerance for the description-body
// pull_acs path.
//
// The Jira adapter's description-body pull_acs parses bullet items under a
// `## Acceptance Criteria` heading. Markdown round-trips through Jira's ADF
// conversion: input `- [x] AC 1: ...` re-renders as `* \[x\] AC 1: ...`
// (asterisk-bullet + escaped brackets). The parser tolerates both forms by
// design — a regression here would silently break /implement's AC-toggle
// round-trip on the live Jira path.

import { describe, expect, it } from "bun:test";

import { parseJiraDescriptionAcs } from "./jira_pull_acs";

describe("parseJiraDescriptionAcs — canonical (unescaped) form", () => {
  it("parses [x] as completed", () => {
    const body = [
      "## Acceptance Criteria",
      "",
      "- [x] AC-DST-7.1: greet('Alice') returns 'Hello, Alice!'.",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(body)).toEqual([
      { id: "AC-DST-7.1", text: "greet('Alice') returns 'Hello, Alice!'.", completed: true },
    ]);
  });

  it("parses [ ] as not completed", () => {
    const body = [
      "## Acceptance Criteria",
      "",
      "- [ ] AC-DST-7.2: greet() returns 'Hello, world!'.",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(body)).toEqual([
      { id: "AC-DST-7.2", text: "greet() returns 'Hello, world!'.", completed: false },
    ]);
  });
});

describe("parseJiraDescriptionAcs — ADF-escape tolerance (STE-190)", () => {
  // The smoke #9 / run 2 evidence: input markdown `- [x] AC N: ...` re-renders
  // back from Jira as `* \[x\] AC N: ...` (asterisk-bullet + escaped
  // brackets). The parser tolerates the escape so the AC-toggle round-trip
  // survives the description-body ADF conversion.
  it("parses ADF-escaped \\[x\\] as completed (asterisk-bullet)", () => {
    const adfEscaped = [
      "## Acceptance Criteria",
      "",
      "* \\[x\\] AC-DST-7.1: greet('Alice') returns 'Hello, Alice!'.",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(adfEscaped)).toEqual([
      { id: "AC-DST-7.1", text: "greet('Alice') returns 'Hello, Alice!'.", completed: true },
    ]);
  });

  it("parses ADF-escaped \\[ \\] as not completed (asterisk-bullet)", () => {
    const adfEscaped = [
      "## Acceptance Criteria",
      "",
      "* \\[ \\] AC-DST-7.2: greet() returns 'Hello, world!'.",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(adfEscaped)).toEqual([
      { id: "AC-DST-7.2", text: "greet() returns 'Hello, world!'.", completed: false },
    ]);
  });

  it("escaped and unescaped forms parse to the same AC list", () => {
    const unescaped = [
      "## Acceptance Criteria",
      "",
      "- [x] AC-DST-7.1: alpha.",
      "- [ ] AC-DST-7.2: beta.",
      "",
    ].join("\n");
    const adfEscaped = [
      "## Acceptance Criteria",
      "",
      "* \\[x\\] AC-DST-7.1: alpha.",
      "* \\[ \\] AC-DST-7.2: beta.",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(adfEscaped)).toEqual(parseJiraDescriptionAcs(unescaped));
  });
});

describe("parseJiraDescriptionAcs — section boundary", () => {
  it("ignores bullets outside the ## Acceptance Criteria section", () => {
    const body = [
      "Some prose.",
      "",
      "- [x] this is not an AC, it's outside the section",
      "",
      "## Acceptance Criteria",
      "",
      "- [x] AC-DST-7.1: in-section AC.",
      "",
      "## Notes",
      "",
      "- [ ] not an AC either",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(body)).toEqual([
      { id: "AC-DST-7.1", text: "in-section AC.", completed: true },
    ]);
  });

  it("returns an empty array when the section is absent", () => {
    expect(parseJiraDescriptionAcs("no AC section here.")).toEqual([]);
  });

  it("returns an empty array when the section is empty", () => {
    const body = ["## Acceptance Criteria", "", "## Next section", ""].join("\n");
    expect(parseJiraDescriptionAcs(body)).toEqual([]);
  });

  it("treats an indented ## line as the section boundary (trim() semantics)", () => {
    // The reader trims each line before testing the heading regex, so an
    // indented ## inside the AC section closes it. Server-rendered ADF
    // doesn't indent headings; this test pins the trim-based boundary.
    const body = [
      "## Acceptance Criteria",
      "",
      "- [x] AC-DST-7.1: pre-boundary AC.",
      "   ## indented heading-like line",
      "- [ ] AC-DST-7.2: post-boundary, ignored.",
      "",
    ].join("\n");
    expect(parseJiraDescriptionAcs(body)).toEqual([
      { id: "AC-DST-7.1", text: "pre-boundary AC.", completed: true },
    ]);
  });
});
