// Doc-conformance tests for STE-349 (M93 FR-C) — verification-skills docs,
// patterns.md entry + per-stack examples + discoverable cross-links.
//
// STE-349 is a DOCS-ONLY FR. Every AC is a prose / file-existence contract
// layered on top of the STE-347 (`## Verification` convention) + STE-348
// (scaffold generator + check-skill templates) work already GREEN in this
// session. These meta-tests lock the "encourage" half: an authoring guide,
// a patterns.md pattern, worked stack examples, and top-of-docs discoverability.
//
//   AC-STE-349.1 — docs/verification-skills.md authoring guide
//   AC-STE-349.2 — docs/patterns.md "Project-Authored Verification Skills" entry
//   AC-STE-349.3 — one check-skill example per primary stack under examples/
//   AC-STE-349.4 — discoverable cross-links (implement SKILL, templates,
//                  README, sdd-methodology)
//
// IMPORTANT (namespace hygiene, see FR clause 5): the SHIPPED surfaces these
// tests assert on must NOT carry `STE-\d+` / `AC-STE-\d+` literals — the
// docs/ internal-namespace token ceiling forbids it. So every assertion below
// greps for a *capability name* literal, never a ticket ID. (This test file's
// own comments cite AC IDs freely — tests/ is not a shipped surface.)

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const docsDir = join(pluginRoot, "docs");
const examplesDir = join(pluginRoot, "examples");
const templatesDir = join(pluginRoot, "templates", "check-skill");
const skillsDir = join(pluginRoot, "skills");
const repoRoot = join(pluginRoot, "..", "..");

// Read a file, returning "" when absent so content assertions fail as clean
// `expect` mismatches (RED) rather than thrown ENOENT — keeps the RED output
// readable and the GREEN transition unambiguous.
function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const guidePath = join(docsDir, "verification-skills.md");

// Extract a single `## Pattern N: …` section (heading line through the line
// before the next `## Pattern …` heading, or EOF). Returns "" if no heading
// matches `titleRe`.
function extractPatternSection(body: string, titleRe: RegExp): string {
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (titleRe.test(lines[i]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## Pattern /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// ---------------------------------------------------------------------------
// AC-STE-349.1 — Authoring guide: docs/verification-skills.md
// ---------------------------------------------------------------------------
//
// A new authoring guide that documents the verification philosophy (a passing
// gate ≠ a working app), the `## Verification` config contract, the
// `.claude/skills/<name>` + `disable-model-invocation: true` convention, and a
// step-by-step "author your own check skill" walkthrough (from the /setup
// scaffold OR from scratch). Each assertion targets a single greppable literal
// so the implementer has clear targets — without over-constraining sentences.

describe("AC-STE-349.1 — docs/verification-skills.md authoring guide", () => {
  test("the guide file exists", () => {
    expect(existsSync(guidePath)).toBe(true);
  });

  test("the guide is substantive (non-empty)", () => {
    expect(readIfExists(guidePath).trim().length).toBeGreaterThan(200);
  });

  test("documents the philosophy: a passing gate is not a working app", () => {
    // Robust literal — the philosophy prose will naturally say "working app".
    expect(readIfExists(guidePath)).toMatch(/working app/i);
  });

  test("documents the `## Verification` config contract", () => {
    expect(readIfExists(guidePath)).toContain("## Verification");
  });

  test("documents the verify_skill config key", () => {
    expect(readIfExists(guidePath)).toContain("verify_skill");
  });

  test("documents the .claude/skills/<name> convention", () => {
    expect(readIfExists(guidePath)).toContain(".claude/skills");
  });

  test("documents the disable-model-invocation frontmatter convention", () => {
    expect(readIfExists(guidePath)).toContain("disable-model-invocation");
  });

  test("includes a from-scratch authoring walkthrough marker", () => {
    // The AC's own phrasing — "from the /setup scaffold or from scratch".
    expect(readIfExists(guidePath)).toMatch(/from scratch/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-349.2 — patterns.md "Project-Authored Verification Skills" entry
// ---------------------------------------------------------------------------
//
// A new numbered Pattern (the file currently ends at Pattern 29; next free
// number is Pattern 30) titled "Project-Authored Verification Skills",
// cross-linking the existing Pattern 10 (Visual Verification via MCP) +
// Pattern 12 (Verification-Before-Completion). The reverse cross-ref lives in
// skills/implement/SKILL.md's Phase 4b″ area (points at the guide or pattern).

const patternTitleRe =
  /^## Pattern \d+: .*Project-Authored Verification Skills/m;

describe("AC-STE-349.2 — patterns.md Project-Authored Verification Skills entry", () => {
  test("a numbered `## Pattern N:` heading carries the pattern title", () => {
    const patterns = readIfExists(join(docsDir, "patterns.md"));
    expect(patterns).toMatch(patternTitleRe);
  });

  test("the new pattern's body cross-links Pattern 10 (Visual Verification via MCP)", () => {
    const patterns = readIfExists(join(docsDir, "patterns.md"));
    const section = extractPatternSection(patterns, patternTitleRe);
    expect(section).toContain("Pattern 10");
  });

  test("the new pattern's body cross-links Pattern 12 (Verification-Before-Completion)", () => {
    const patterns = readIfExists(join(docsDir, "patterns.md"));
    const section = extractPatternSection(patterns, patternTitleRe);
    expect(section).toContain("Pattern 12");
  });

  test("skills/implement/SKILL.md Phase 4b″ area cross-refs the guide or the pattern", () => {
    // Reverse cross-ref — accept EITHER a guide-path token OR a pattern
    // reference, since the implementer may point at whichever is cheaper on
    // the hard-capped implement SKILL.md line budget.
    const implement = readIfExists(join(skillsDir, "implement", "SKILL.md"));
    expect(implement).toMatch(
      /verification-skills\.md|Pattern 30|Project-Authored Verification Skills/,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-349.3 — Per-stack check-skill examples under examples/
// ---------------------------------------------------------------------------
//
// The existing examples/ layout is per-stack dirs (typescript-node,
// flutter-dart, python) each holding gate-commands.md + release.yml. This AC
// adds one worked, condensed, copy-adaptable check-skill example per stack —
// modeled on the glacy-drive (Flutter/dart-MCP) + glacy-progress-e2e (HTTP
// API e2e) shapes. Chosen filename: check-skill-example.md in each stack dir.

const EXAMPLE_FILENAME = "check-skill-example.md";
const STACK_DIRS = ["typescript-node", "flutter-dart", "python"] as const;

describe("AC-STE-349.3 — per-stack check-skill examples", () => {
  for (const stack of STACK_DIRS) {
    const examplePath = join(examplesDir, stack, EXAMPLE_FILENAME);

    test(`examples/${stack}/${EXAMPLE_FILENAME} exists`, () => {
      expect(existsSync(examplePath)).toBe(true);
    });

    test(`examples/${stack}/${EXAMPLE_FILENAME} is non-empty`, () => {
      expect(readIfExists(examplePath).trim().length).toBeGreaterThan(0);
    });

    test(`examples/${stack}/${EXAMPLE_FILENAME} carries disable-model-invocation: true`, () => {
      expect(readIfExists(examplePath)).toContain("disable-model-invocation: true");
    });

    test(`examples/${stack}/${EXAMPLE_FILENAME} references the authoring guide`, () => {
      expect(readIfExists(examplePath)).toContain("verification-skills.md");
    });
  }

  test("the three stack examples are pairwise distinct (stack-appropriate)", () => {
    const bodies = STACK_DIRS.map((stack) =>
      readIfExists(join(examplesDir, stack, EXAMPLE_FILENAME)).trim(),
    );
    // Guard: don't let three empty strings pass as "distinct".
    expect(bodies.every((b) => b.length > 0)).toBe(true);
    expect(bodies[0]).not.toBe(bodies[1]);
    expect(bodies[1]).not.toBe(bodies[2]);
    expect(bodies[0]).not.toBe(bodies[2]);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-349.4 — Discoverable cross-links
// ---------------------------------------------------------------------------
//
// (a) the four check-skill templates reference the guide (already GREEN from
//     STE-348 — kept to lock the contract);
// (b) skills/implement/SKILL.md references the guide by path (scaffold-offer);
// (c) the repo-root README.md mentions the verification-skill capability;
// (d) docs/sdd-methodology.md mentions the verification-skill capability.
//
// NOTE (FR clause 4d): the FR text names docs/methodology.md, but the ACTUAL
// file in this repo is docs/sdd-methodology.md — target the real file.

const CAPABILITY_MENTION = /verify_skill|verification skill|verification-skills\.md/i;

describe("AC-STE-349.4 — discoverable cross-links", () => {
  // (a) — precondition already GREEN from STE-348; kept to lock the contract.
  const TEMPLATES = [
    "flutter.SKILL.md.template",
    "web.SKILL.md.template",
    "python.SKILL.md.template",
    "generic.SKILL.md.template",
  ] as const;

  for (const tpl of TEMPLATES) {
    test(`templates/check-skill/${tpl} references the guide (green precondition from STE-348)`, () => {
      expect(readIfExists(join(templatesDir, tpl))).toContain(
        "verification-skills.md",
      );
    });
  }

  // (b) — the /implement scaffold-offer references the guide by path.
  test("skills/implement/SKILL.md references docs/verification-skills.md by path", () => {
    expect(readIfExists(join(skillsDir, "implement", "SKILL.md"))).toContain(
      "verification-skills.md",
    );
  });

  // (c) — repo-root README.md surfaces the capability (capability-name literal
  //       only; NO ticket/milestone IDs — a root-hygiene scan may cover it).
  test("repo-root README.md mentions the verification-skill capability", () => {
    expect(readIfExists(join(repoRoot, "README.md"))).toMatch(CAPABILITY_MENTION);
  });

  // (d) — docs/sdd-methodology.md surfaces the capability from the top of docs.
  test("docs/sdd-methodology.md mentions the verification-skill capability", () => {
    expect(readIfExists(join(docsDir, "sdd-methodology.md"))).toMatch(
      CAPABILITY_MENTION,
    );
  });
});
