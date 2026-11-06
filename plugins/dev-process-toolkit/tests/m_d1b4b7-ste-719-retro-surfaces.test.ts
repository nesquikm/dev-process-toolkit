// STE-719 (M_d1b4b7) AC.1, AC.13, AC.14, AC.15 — the skill file, the closing
// block and branch-gate allowlists, the skill counts on every surface, and the
// front door's reachability.
//
// The existing count tests (m137 stage-block adoption 12 -> 13, m84 allowlist
// 8 -> 9, the public-surface and video/best-practices counts) are re-keyed by
// the implementer; this file grades the shipped surfaces directly.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT, REPO_ROOT, SRC } from "./_m_d1b4b7_retro_fixture";

const SKILLS = join(PLUGIN_ROOT, "skills");
const RETRO_SKILL = join(SKILLS, "retro", "SKILL.md");
const read = (p: string) => readFileSync(p, "utf-8");

function frontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? m[1]! : "";
}

function skillCounts(root: string): { total: number; invocable: number; dispatch: number } {
  const names = readdirSync(root).filter((n) => existsSync(join(root, n, "SKILL.md")));
  const dispatch = names.filter((n) => /^user-invocable:\s*false\s*$/m.test(frontmatter(read(join(root, n, "SKILL.md"))))).length;
  return { total: names.length, invocable: names.length - dispatch, dispatch };
}

describe("AC-STE-719.1 skills/retro/SKILL.md", () => {
  test("exists, is user-invocable and carries argument-hint '[<milestone> | <fr-id>]'", () => {
    expect(existsSync(RETRO_SKILL)).toBe(true);
    const fm = frontmatter(read(RETRO_SKILL));
    expect(fm).toMatch(/^name:\s*retro\s*$/m);
    expect(fm).not.toMatch(/^user-invocable:\s*false/m);
    expect(fm).toContain("argument-hint: '[<milestone> | <fr-id>]'");
  });

  test("is at most 358 lines (the NFR-1 cap)", () => {
    expect(read(RETRO_SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });

  test("runs the front door and its overflow lives in docs/retro-reference.md", () => {
    const text = read(RETRO_SKILL);
    expect(text).toContain("adapters/_shared/src/retro.ts");
    expect(text).toContain("docs/retro-reference.md");
    expect(existsSync(join(PLUGIN_ROOT, "docs", "retro-reference.md"))).toBe(true);
  });
});

describe("AC-STE-719.13 the closing block and the branch-gate allowlist", () => {
  test("ADOPTING_STAGES contains retro and holds 13 stages", async () => {
    const { ADOPTING_STAGES } = await import("../adapters/_shared/src/stage_block_adoption");
    expect(ADOPTING_STAGES as readonly string[]).toContain("retro");
    expect(ADOPTING_STAGES.length).toBe(13);
  });

  test("NON_COMMIT_PRODUCING_SKILLS contains retro and holds 9 skills", async () => {
    const { NON_COMMIT_PRODUCING_SKILLS } = await import("../adapters/_shared/src/commit_producing_skill_branch_gate");
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("retro");
    expect(NON_COMMIT_PRODUCING_SKILLS.length).toBe(9);
  });

  test("the skill closes with a stage-status-block", () => {
    expect(read(RETRO_SKILL)).toContain("stage-status-block");
  });

  test("the m137 report-conformance matrix carries a retro row", () => {
    const matrix = read(join(PLUGIN_ROOT, "tests", "m137-ste-533-report-conformance-matrix.test.ts"));
    expect(matrix).toMatch(/^\s{2}retro:\s*\{/m);
  });
});

describe("AC-STE-719.14 skill counts: 29 skills, 20 user-invocable, 9 dispatch, 32 across both roots", () => {
  test("the plugin's own skills tree counts 29 / 20 / 9", () => {
    expect(skillCounts(SKILLS)).toEqual({ total: 29, invocable: 20, dispatch: 9 });
  });

  test("both roots together hold 32 skills", () => {
    const maint = join(REPO_ROOT, ".claude", "skills");
    expect(skillCounts(SKILLS).total + skillCounts(maint).total).toBe(32);
  });

  test("CLAUDE.md structure lines read 32 across both roots, 29 the plugin's, 29 slash commands (20 + 9)", () => {
    const md = read(join(REPO_ROOT, "CLAUDE.md"));
    expect(md).toContain("32 skills ship across the two roots, and only the 29 below are the plugin's.");
    expect(md).toContain("29 slash commands (20 user-invocable + 9 dispatch");
  });

  test("README: line 3 says 20 commands; the tree row reads 29 (20 + 9); the diagram paragraph and the note name five off-diagram skills", () => {
    const readme = read(join(REPO_ROOT, "README.md"));
    const lines = readme.split("\n");
    expect(lines[2]).toContain("20 commands");
    expect(readme).toContain("# 29 (20 + 9) skills (20 user-invocable + 9 internal forks)");
    const diagram = lines.find((l) => l.startsWith("The diagram below maps"))!;
    expect(diagram).toContain("of the 20 user-invocable skills");
    expect(diagram).toContain("`/retro`");
    const note = lines.find((l) => l.startsWith("> The diagram above is a deliberately high-level lifecycle map."))!;
    expect(note).toContain("five skills");
    expect(note).toContain("`/retro`");
  });

  test("README: the Commands table has a /retro row whose Args mirror the argument-hint", () => {
    const readme = read(join(REPO_ROOT, "README.md"));
    const row = readme.split("\n").find((l) => /^\|\s*`\/retro`\s*\|/.test(l));
    expect(row).toBeDefined();
    // The table cell escapes the pipe, as every other Commands row does, so GitHub keeps one cell.
    expect(row!).toContain("`[<milestone> \\| <fr-id>]`");
  });

  test("specs/technical-spec.md reads 20 user-invocable SKILL.md files; specs/testing-spec.md reads all 29 skills", () => {
    expect(read(join(REPO_ROOT, "specs", "technical-spec.md"))).toContain("20 user-invocable SKILL.md files");
    expect(read(join(REPO_ROOT, "specs", "testing-spec.md"))).toContain("all 29 skills");
  });
});

describe("AC-STE-719.15 retro.ts is a guarded front door every reference reaches", () => {
  test("retro.ts carries the `if (import.meta.main)` guard", () => {
    expect(read(join(SRC, "retro.ts"))).toMatch(/^if \(import\.meta\.main\)/m);
  });

  test("module_reachability (probe #81) classifies every retro reference reachable", async () => {
    const mod = (await import("../adapters/_shared/src/module_reachability")) as {
      runModuleReachabilityProbe: (root: string) => Promise<{ records: { module: string; reachable: boolean; surface: string; line: number }[] }>;
    };
    const report = await mod.runModuleReachabilityProbe(REPO_ROOT);
    const mine = report.records.filter((r) => /\/(retro|retro_rules|retro_report|retro_scope|session_aliases)\.ts$/.test(r.module));
    // ANTI-VACUITY: the skill's own front-door line is a reference.
    expect(mine.filter((r) => r.module.endsWith("/retro.ts")).length).toBeGreaterThan(0);
    expect(mine.filter((r) => !r.reachable)).toEqual([]);
  });
});
