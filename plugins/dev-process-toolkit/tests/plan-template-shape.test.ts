import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

const pluginRoot = join(import.meta.dir, "..");
const planTemplatePath = join(
  pluginRoot,
  "templates",
  "spec-templates",
  "plan.md.template",
);

function readTemplate(): string {
  return readFileSync(planTemplatePath, "utf8");
}

describe("STE-197 — plan.md.template shape", () => {
  test("AC-STE-197.2: opens with `---` YAML frontmatter block", () => {
    const body = readTemplate();
    expect(body.startsWith("---\n")).toBe(true);
  });

  test("AC-STE-197.2: frontmatter carries the five required fields", () => {
    const body = readTemplate();
    const fm = parseFrontmatter(body);
    expect(Object.keys(fm)).toEqual(
      expect.arrayContaining([
        "milestone",
        "status",
        "archived_at",
        "kickoff_branch",
        "frozen_at",
      ]),
    );
    expect(fm["status"]).toBe("active");
    expect(fm["archived_at"]).toBe(null);
    expect(fm["kickoff_branch"]).toBe(null);
    expect(fm["frozen_at"]).toBe(null);
    // milestone is a placeholder — `M<N>` literal — but must be present
    expect(typeof fm["milestone"]).toBe("string");
  });

  test("AC-STE-197.1: scaffolds exactly one `## M<N>:` heading", () => {
    const body = readTemplate();
    const headings = body.match(/^## M[^:\s]+:/gm) ?? [];
    expect(headings.length).toBe(1);
  });

  test("AC-STE-197.1: no `## Milestone Dependency Graph` section", () => {
    const body = readTemplate();
    expect(body).not.toMatch(/^## Milestone Dependency Graph/m);
  });

  test("AC-STE-197.1: keeps `## Milestone Order` heading", () => {
    const body = readTemplate();
    expect(body).toMatch(/^## Milestone Order/m);
  });

  test("STE-80 carryover: HTML comment with `<tracker-id>` placeholder convention is retained", () => {
    const body = readTemplate();
    // Comment may live anywhere now (after frontmatter rather than at byte 0);
    // it just needs to exist and reference the placeholder convention.
    expect(body).toMatch(/<!--[\s\S]*?<tracker-id>[\s\S]*?(placeholder|allocator|substitute)/i);
  });
});
