// Doc-conformance tests for the spec-research subagent + skill
// (STE-230 AC-STE-230.1 / .2 / .3 / .8 / .9 / .10 / .11).
//
// These assertions are byte-level: frontmatter shape, banner literal,
// section names, capability rows, branch-gate exemption note, and the
// no-cache invariant. They run on the canonical SKILL.md / agents/*.md
// files shipped with the plugin (not on tmp fixtures).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NON_COMMIT_PRODUCING_SKILLS } from "../adapters/_shared/src/commit_producing_skill_branch_gate";
import {
  SPEC_RESEARCH_BANNER,
  SPEC_RESEARCH_SECTIONS,
} from "../adapters/_shared/src/spec_research_result_shape";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const AGENT_PATH = join(PLUGIN_ROOT, "agents", "spec-researcher.md");
const SKILL_PATH = join(PLUGIN_ROOT, "skills", "spec-research", "SKILL.md");
const BRAINSTORM_PATH = join(PLUGIN_ROOT, "skills", "brainstorm", "SKILL.md");
const SPEC_WRITE_PATH = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");

interface ParsedFrontmatter {
  raw: string;
  body: string;
  fields: Record<string, string>;
}

function parseFrontmatter(absPath: string): ParsedFrontmatter {
  const text = readFileSync(absPath, "utf-8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`No frontmatter block at ${absPath}`);
  }
  const raw = match[1]!;
  const body = match[2]!;
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (m) {
      fields[m[1]!] = m[2]!;
    }
  }
  return { raw, body, fields };
}

// -----------------------------------------------------------------------------
// Subagent file (AC-STE-230.1, .8) — frontmatter shape.
// -----------------------------------------------------------------------------

describe("spec-researcher subagent frontmatter (AC-STE-230.1, .8)", () => {
  test("agents/spec-researcher.md exists with canonical frontmatter", () => {
    const { fields } = parseFrontmatter(AGENT_PATH);
    expect(fields.name).toBe("spec-researcher");
    expect(fields.tools).toBe("Read, Grep, Glob");
    expect(fields.model).toBe("haiku");
    expect(fields.description).toBeTruthy();
    expect(fields.description!.length).toBeGreaterThan(20);
  });

  test("subagent tools list excludes Edit, Write, Bash, and MCP tools", () => {
    const { fields } = parseFrontmatter(AGENT_PATH);
    const tools = fields.tools!.split(",").map((s) => s.trim());
    expect(tools).toEqual(["Read", "Grep", "Glob"]);
    for (const banned of ["Edit", "Write", "Bash", "Agent"]) {
      expect(tools).not.toContain(banned);
    }
    for (const t of tools) {
      expect(t.startsWith("mcp__")).toBe(false);
    }
  });

  test("subagent system prompt contains the canonical banner literal (AC-STE-230.3)", () => {
    const { body } = parseFrontmatter(AGENT_PATH);
    expect(body).toContain(SPEC_RESEARCH_BANNER);
  });

  test("subagent system prompt documents all three section names in canonical order (AC-STE-230.4)", () => {
    const { body } = parseFrontmatter(AGENT_PATH);
    let cursor = 0;
    for (const heading of SPEC_RESEARCH_SECTIONS) {
      const idx = body.indexOf(heading, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + heading.length;
    }
  });

  test("subagent system prompt documents the ≤ 25-line cap (AC-STE-230.5)", () => {
    const { body } = parseFrontmatter(AGENT_PATH);
    expect(body).toContain("25");
    expect(body).toMatch(/≤\s*25/);
  });

  test("subagent system prompt has no `cache` or `memoize` references (AC-STE-230.9)", () => {
    const text = readFileSync(AGENT_PATH, "utf-8");
    expect(text).not.toMatch(/\bcache\b/i);
    expect(text).not.toMatch(/\bmemoize\b/i);
  });
});

// -----------------------------------------------------------------------------
// Skill file (AC-STE-230.2, .9, .10) — frontmatter + body invariants.
// -----------------------------------------------------------------------------

describe("spec-research skill frontmatter (AC-STE-230.2)", () => {
  test("skills/spec-research/SKILL.md exists with canonical frontmatter", () => {
    const { fields } = parseFrontmatter(SKILL_PATH);
    expect(fields.name).toBe("spec-research");
    expect(fields.context).toBe("fork");
    expect(fields.agent).toBe("spec-researcher");
    expect(fields["user-invocable"]).toBe("false");
    expect(fields["argument-hint"]).toBe("'<topic description>'");
    expect(fields.description).toBeTruthy();
    expect(fields.description!.length).toBeGreaterThan(20);
  });

  test("skill body restates the 3-section output contract (AC-STE-230.4)", () => {
    const { body } = parseFrontmatter(SKILL_PATH);
    for (const heading of SPEC_RESEARCH_SECTIONS) {
      expect(body).toContain(heading);
    }
  });

  test("skill body has no `cache` or `memoize` references (AC-STE-230.9)", () => {
    const text = readFileSync(SKILL_PATH, "utf-8");
    expect(text).not.toMatch(/\bcache\b/i);
    expect(text).not.toMatch(/\bmemoize\b/i);
  });

  test("skill body documents the branch-gate exemption (AC-STE-230.10)", () => {
    const { body } = parseFrontmatter(SKILL_PATH);
    expect(body).toContain("NON_COMMIT_PRODUCING_SKILLS");
    expect(body).toMatch(/STE-228/);
  });
});

// -----------------------------------------------------------------------------
// Allowlist append (AC-STE-230.10) — `spec-research` must be on the
// canonical NON_COMMIT_PRODUCING_SKILLS list alongside `report-issue`.
// -----------------------------------------------------------------------------

describe("branch-gate allowlist append (AC-STE-230.10)", () => {
  test("`spec-research` is on the NON_COMMIT_PRODUCING_SKILLS allowlist", () => {
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("spec-research");
  });

  test("`report-issue` is still on the allowlist (no regression)", () => {
    expect(NON_COMMIT_PRODUCING_SKILLS).toContain("report-issue");
  });
});

// -----------------------------------------------------------------------------
// /spec-write integration (AC-STE-230.6) — § 0b carries a step 2.5
// invocation site between step 2 and step 3, with the --no-tech
// carve-out and the shape-violation fallback.
// -----------------------------------------------------------------------------

describe("/spec-write integration (AC-STE-230.6)", () => {
  test("§ 0b documents the /spec-research invocation between step 2 and step 3", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    expect(text).toContain("/dev-process-toolkit:spec-research");
    expect(text).toMatch(/\*\*Spec-research seed/);
    // The seed paragraph must appear after "Build canonical frontmatter" (step 2)
    // and before "AC prefix" (step 3) in document order.
    const step2Idx = text.search(/2\.\s*\*\*Build canonical frontmatter/);
    const seedIdx = text.search(/\*\*Spec-research seed/);
    const step3Idx = text.search(/3\.\s*\*\*AC prefix\*\*/);
    expect(step2Idx).toBeGreaterThan(0);
    expect(seedIdx).toBeGreaterThan(step2Idx);
    expect(step3Idx).toBeGreaterThan(seedIdx);
  });

  test("§ 0b documents the --no-tech carve-out for the spec-research invocation", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    const tail = text.slice(text.indexOf("Spec-research seed"));
    expect(tail).toMatch(/--no-tech/);
  });

  test("§ 0b documents the shape-violation fallback (drop block, log capability row)", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    const tail = text.slice(text.indexOf("Spec-research seed"));
    expect(tail).toMatch(/spec_research_shape_violation/);
  });

  test("/spec-research is referenced at least once in spec-write/SKILL.md", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    const matches = text.match(/\/dev-process-toolkit:spec-research/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

// -----------------------------------------------------------------------------
// /brainstorm integration (AC-STE-230.7) — step 1.5 between Step 1 and
// Step 2, with --no-tech carve-out.
// -----------------------------------------------------------------------------

describe("/brainstorm integration (AC-STE-230.7)", () => {
  test("step 1.5 documents the /spec-research invocation between Step 1 and Step 2", () => {
    const text = readFileSync(BRAINSTORM_PATH, "utf-8");
    expect(text).toContain("/dev-process-toolkit:spec-research");
    expect(text).toMatch(/###\s*1\.5\.\s+Spec-research seed/);
    const s15 = text.search(/###\s*1\.5\.\s+Spec-research seed/);
    const s2 = text.search(/###\s*2\.\s+Explore Approaches/);
    expect(s15).toBeGreaterThan(0);
    expect(s2).toBeGreaterThan(s15);
  });

  test("step 1.5 documents the --no-tech carve-out", () => {
    const text = readFileSync(BRAINSTORM_PATH, "utf-8");
    const tail = text.slice(text.indexOf("1.5. Spec-research seed"));
    expect(tail).toMatch(/--no-tech/);
  });

  test("/spec-research is referenced at least once in brainstorm/SKILL.md", () => {
    const text = readFileSync(BRAINSTORM_PATH, "utf-8");
    const matches = text.match(/\/dev-process-toolkit:spec-research/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

// -----------------------------------------------------------------------------
// Capability rows (AC-STE-230.11) — three new rows in /spec-write § 7.
// -----------------------------------------------------------------------------

describe("/spec-write § 7 capability rows (AC-STE-230.11)", () => {
  test("`spec_research_invoked` key + canonical prose are present in the map", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    expect(text).toContain("`spec_research_invoked`");
    expect(text).toContain(
      "/spec-research returned <N> related FRs from <M> scanned",
    );
  });

  test("`spec_research_no_matches` key + canonical prose are present in the map", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    expect(text).toContain("`spec_research_no_matches`");
    expect(text).toContain(
      "zero topic matches — empty block injected into parent skill",
    );
  });

  test("`spec_research_shape_violation` key + canonical prose are present in the map", () => {
    const text = readFileSync(SPEC_WRITE_PATH, "utf-8");
    expect(text).toContain("`spec_research_shape_violation`");
    expect(text).toContain(
      "block dropped, parent skill proceeds without seed",
    );
  });
});
