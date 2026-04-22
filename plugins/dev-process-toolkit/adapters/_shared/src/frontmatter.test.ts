// Phase-I follow-up test — shared parseFrontmatter (consolidation of 4
// near-duplicate inline copies).

import { describe, expect, test } from "bun:test";
import { parseFrontmatter, parseFrontmatterFlat, setTrackerBinding } from "./frontmatter";

describe("parseFrontmatter", () => {
  test("parses scalar keys + nested tracker map + null literal", () => {
    const md = [
      "---",
      "id: fr_01HZ7XJFKP0000000000000A01",
      "title: Sample",
      "milestone: M13",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  linear: LIN-1234",
      "  github: 42",
      "created_at: 2026-04-21T10:30:00Z",
      "---",
      "",
      "body",
    ].join("\n");
    const fm = parseFrontmatter(md);
    expect(fm.id).toBe("fr_01HZ7XJFKP0000000000000A01");
    expect(fm.title).toBe("Sample");
    expect(fm.archived_at).toBeNull();
    expect(fm.tracker).toEqual({ linear: "LIN-1234", github: "42" });
  });

  test("empty tracker map via {} literal", () => {
    const md = ["---", "id: fr_xxx", "tracker: {}", "---", ""].join("\n");
    expect(parseFrontmatter(md).tracker).toEqual({});
  });

  test("throws on missing frontmatter by default", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(/no YAML frontmatter/);
  });

  test("returns {} on missing frontmatter when lenient: true", () => {
    expect(parseFrontmatter("no frontmatter", { lenient: true })).toEqual({});
  });

  test("strips both single and double quotes", () => {
    const md = ['---', 'a: "quoted"', "b: 'single'", "c: plain", "---", ""].join("\n");
    const fm = parseFrontmatter(md);
    expect(fm.a).toBe("quoted");
    expect(fm.b).toBe("single");
    expect(fm.c).toBe("plain");
  });

  test("coerces bare true/false to booleans (YAML scalar literals)", () => {
    // Adapter metadata fields like `project_milestone: true` (FR-59) need
    // the parser to surface real booleans, not the string "true" — without
    // coercion, every downstream `if (fm.flag)` silently passes on
    // `"false"` too. Quoted literals stay strings.
    const md = [
      "---",
      "flag_on: true",
      "flag_off: false",
      "quoted_string: 'true'",
      "bare_string: maybe",
      "---",
      "",
    ].join("\n");
    const fm = parseFrontmatter(md);
    expect(fm.flag_on).toBe(true);
    expect(fm.flag_off).toBe(false);
    expect(fm.quoted_string).toBe("true");
    expect(fm.bare_string).toBe("maybe");
  });
});

describe("setTrackerBinding — FR-58 migration binding writer", () => {
  const SEED_FR = [
    "---",
    "id: fr_01HZ7XJFKP0000000000000A01",
    "title: Sample",
    "milestone: M1",
    "status: active",
    "archived_at: null",
    "tracker: {}",
    "created_at: 2026-04-22T00:00:00.000Z",
    "---",
    "",
    "## Requirement",
    "",
    "Body.",
    "",
  ].join("\n");

  test("AC-58.1/58.4 — converts empty-seed tracker: {} to multi-line map with one key", () => {
    const out = setTrackerBinding(SEED_FR, "linear", "STE-42");
    // Parsing the output recovers the binding.
    expect(parseFrontmatter(out).tracker).toEqual({ linear: "STE-42" });
    // Canonical multi-line form — never inline {} after a bind.
    expect(out).toContain("tracker:\n  linear: STE-42");
    expect(out).not.toContain("tracker: {}");
    expect(out).not.toContain("tracker: { linear");
    // Body preserved.
    expect(out).toContain("## Requirement");
    expect(out).toContain("Body.");
  });

  test("AC-58.2/58.4 — preserves existing entries and inserts alphabetically", () => {
    const existing = [
      "---",
      "id: fr_01HZ7XJFKP0000000000000A02",
      "title: Multi-tracker sample",
      "milestone: M1",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  jira: PROJ-1",
      "created_at: 2026-04-22T00:00:00.000Z",
      "---",
      "",
      "body",
      "",
    ].join("\n");
    const out = setTrackerBinding(existing, "linear", "LIN-42");
    const fm = parseFrontmatter(out);
    // Both entries present after the second bind.
    expect(fm.tracker).toEqual({ jira: "PROJ-1", linear: "LIN-42" });
    // Alphabetical emission (jira < linear).
    const trackerBlock = out.match(/tracker:\n(  \S+: \S+\n)+/);
    expect(trackerBlock).not.toBeNull();
    expect(trackerBlock![0]).toBe("tracker:\n  jira: PROJ-1\n  linear: LIN-42\n");
  });

  test("AC-58.2/58.4 — idempotent on re-bind: same key overwrites in place, ordering stable", () => {
    const once = setTrackerBinding(SEED_FR, "linear", "LIN-1");
    const twice = setTrackerBinding(once, "linear", "LIN-2");
    expect(parseFrontmatter(twice).tracker).toEqual({ linear: "LIN-2" });
    // Still canonical multi-line, no duplicate key.
    expect(twice.match(/linear:/g)?.length).toBe(1);
  });

  test("inserts alphabetically before an existing higher key", () => {
    const existing = [
      "---",
      "id: fr_x",
      "title: t",
      "milestone: M1",
      "status: active",
      "archived_at: null",
      "tracker:",
      "  zenhub: ZH-9",
      "created_at: 2026-04-22T00:00:00.000Z",
      "---",
      "",
    ].join("\n");
    const out = setTrackerBinding(existing, "jira", "PROJ-5");
    expect(out).toContain("tracker:\n  jira: PROJ-5\n  zenhub: ZH-9");
  });

  test("rejects missing frontmatter — callers must guarantee FR file shape", () => {
    expect(() => setTrackerBinding("not a FR file", "linear", "LIN-1")).toThrow(
      /no YAML frontmatter/,
    );
  });

  test("refuses the inline non-empty tracker form (AC-58.4) rather than silently dropping keys", () => {
    const inline = [
      "---",
      "id: fr_x",
      "title: t",
      "milestone: M1",
      "status: active",
      "archived_at: null",
      "tracker: { jira: PROJ-1 }",
      "created_at: 2026-04-22T00:00:00.000Z",
      "---",
      "",
    ].join("\n");
    expect(() => setTrackerBinding(inline, "linear", "LIN-1")).toThrow(
      /inline non-empty tracker map is not supported/,
    );
  });

  test("quotes values that contain YAML-unsafe characters so the block round-trips", () => {
    // Defensive: real adapter IDs today are bare-safe (STE-36, PROJ-1, 42),
    // but a future adapter that surfaces richer IDs (custom boards, URLs)
    // must not corrupt the YAML block.
    const out = setTrackerBinding(SEED_FR, "custom", "id: with colon");
    expect(out).toContain('custom: "id: with colon"');
    // Round-trips through the parser back to the original value.
    expect(parseFrontmatter(out).tracker).toEqual({ custom: "id: with colon" });
  });
});

describe("parseFrontmatterFlat", () => {
  test("returns flat Record<string,string> for simple archives", () => {
    const md = [
      "---",
      "milestone: M97",
      "title: Sample",
      "archived: 2025-12-15",
      "revision: 1",
      "---",
    ].join("\n");
    const fm = parseFrontmatterFlat(md);
    expect(fm.milestone).toBe("M97");
    expect(fm.archived).toBe("2025-12-15");
  });

  test("returns {} on missing frontmatter", () => {
    expect(parseFrontmatterFlat("nothing")).toEqual({});
  });
});
