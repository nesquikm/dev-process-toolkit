// Phase D Tier 4 test — split_plan.ts (AC-48.7).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitPlan } from "./split_plan";

const FIXTURE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "migration",
  "v1-to-v2",
  "input",
  "specs",
  "plan.md",
);

describe("splitPlan", () => {
  test("detects in-flight milestone M99 + archived pointer lines for M97 and M98", () => {
    const md = readFileSync(FIXTURE, "utf-8");
    const result = splitPlan(md);
    expect(result.milestones.map((m) => m.id).sort()).toEqual(["M99"]);
    expect(result.archivedPointers.map((p) => p.id).sort()).toEqual(["M97", "M98"]);
  });

  test("in-flight milestone gets status=active, null kickoff_branch / frozen_at per AC-48.7", () => {
    const md = readFileSync(FIXTURE, "utf-8");
    const result = splitPlan(md);
    const m99 = result.milestones.find((m) => m.id === "M99")!;
    expect(m99.frontmatter.status).toBe("active");
    expect(m99.frontmatter.kickoff_branch).toBeNull();
    expect(m99.frontmatter.frozen_at).toBeNull();
    expect(m99.frontmatter.milestone).toBe("M99");
    expect(m99.frontmatter.revision).toBe(1);
  });

  test("archived pointer carries title + archived date", () => {
    const md = readFileSync(FIXTURE, "utf-8");
    const result = splitPlan(md);
    const m97 = result.archivedPointers.find((p) => p.id === "M97")!;
    expect(m97.title).toContain("First Archived Milestone");
    expect(m97.archivedDate).toBe("2026-01-01");
    expect(m97.archiveFile).toBe("specs/archive/M97-first.md");
  });

  test("milestone body includes the plan content verbatim", () => {
    const md = readFileSync(FIXTURE, "utf-8");
    const result = splitPlan(md);
    const m99 = result.milestones.find((m) => m.id === "M99")!;
    expect(m99.body).toContain("Build FR-1");
    expect(m99.body).toContain("verify: unit test");
  });

  test("non-in-flight milestone with `Status: complete` marker gets status=complete", () => {
    const md = [
      "# Plan",
      "",
      "## M50: Done Milestone {#M50}",
      "",
      "**Status:** complete.",
      "",
      "- [x] Shipped",
      "",
      "## M51: In Flight {#M51}",
      "",
      "**Status:** active.",
      "",
      "- [ ] Todo",
      "",
    ].join("\n");
    const result = splitPlan(md);
    const m50 = result.milestones.find((m) => m.id === "M50")!;
    expect(m50.frontmatter.status).toBe("complete");
    const m51 = result.milestones.find((m) => m.id === "M51")!;
    expect(m51.frontmatter.status).toBe("active");
  });
});
