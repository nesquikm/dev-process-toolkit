// Phase-I follow-up test — shared parseFrontmatter (consolidation of 4
// near-duplicate inline copies).

import { describe, expect, test } from "bun:test";
import { parseFrontmatter, parseFrontmatterFlat } from "./frontmatter";

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
