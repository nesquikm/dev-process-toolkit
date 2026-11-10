// STE-729 (M_b2fdc0) — AC-STE-729.13: /spec-write's Jira Epic-first branch
// records where the milestone's container came from.
//
// The branch must order writing `container_origin: minted` into the new plan's
// frontmatter when the mint returned `created`, and `container_origin: joined`
// on a join — the marker epic_edit.ts check (e) reads (AC-STE-729.12). The edit
// lands in place: skills/spec-write/SKILL.md stays within the existing NFR-1
// cap of 358 lines (tests/skill-nfr-1-length.test.ts), which is NOT raised.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SKILL_PATH = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const NFR1_TEST = join(PLUGIN_ROOT, "tests", "skill-nfr-1-length.test.ts");
const SPEC_WRITE_LINE_CAP = 358;

const skill = readFileSync(SKILL_PATH, "utf-8");

/** The Jira Epic-first branch: from its bold heading to the next branch's heading. */
function jiraBranch(): string {
  const start = skill.indexOf("**Jira Epic-first branch");
  if (start < 0) throw new Error("SKILL.md has no **Jira Epic-first branch heading");
  const end = skill.indexOf("**Tracker-less minted branch", start);
  if (end < 0) throw new Error("SKILL.md has no **Tracker-less minted branch heading after the Jira branch");
  return skill.slice(start, end);
}

/** The clause around the first occurrence of `literal`: back to the previous sentence/clause stop, forward to the next. */
function clauseAround(text: string, literal: string): string {
  const at = text.indexOf(literal);
  if (at < 0) return "";
  const stops = /(?<!e\.g)(?<!i\.e)\.\s|;\s/g;
  let from = 0;
  let to = text.length;
  for (const m of text.matchAll(stops)) {
    const i = m.index!;
    if (i < at) from = i + m[0].length;
    else if (i >= at + literal.length) {
      to = i;
      break;
    }
  }
  return text.slice(from, to);
}

describe("AC-STE-729.13 — the Jira Epic-first branch orders the container_origin marker into the new plan", () => {
  test("the branch orders `container_origin: minted` when the mint returned `created`", () => {
    const branch = jiraBranch();
    expect(branch).toContain("container_origin: minted");
    const clause = clauseAround(branch, "container_origin: minted");
    expect(clause, clause).toContain("`created`");
    expect(clause, clause).toMatch(/frontmatter/);
    expect(clause, clause).toMatch(/plan/);
  });

  test("the branch orders `container_origin: joined` on a join", () => {
    const branch = jiraBranch();
    expect(branch).toContain("container_origin: joined");
    const clause = clauseAround(branch, "container_origin: joined");
    expect(clause, clause).toMatch(/join/i);
    expect(clause, clause).toMatch(/plan|frontmatter/);
  });

  test("the marker lives in the Jira branch only — no other branch of SKILL.md writes it", () => {
    const branch = jiraBranch();
    const outside = skill.replace(branch, "");
    expect(outside).not.toContain("container_origin: minted");
    expect(outside).not.toContain("container_origin: joined");
  });
});

describe("AC-STE-729.13 — the edit lands in place, without raising any SKILL.md line cap", () => {
  test(`skills/spec-write/SKILL.md stays within ${SPEC_WRITE_LINE_CAP} lines`, () => {
    const lines = skill.split("\n").length - (skill.endsWith("\n") ? 1 : 0);
    expect(lines).toBeLessThanOrEqual(SPEC_WRITE_LINE_CAP);
  });

  test("the NFR-1 cap for spec-write is still 358 (not raised)", () => {
    expect(readFileSync(NFR1_TEST, "utf-8")).toContain(`const SKILL_LINE_CAP = ${SPEC_WRITE_LINE_CAP};`);
  });
});
