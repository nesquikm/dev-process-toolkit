// STE-388 — doc-conformance for milestone-keyed branch naming (M106).
//
// AC-STE-388.2: `/setup` step 7c seeds `branch_template: {type}/m{N}-{slug}`
// in BOTH tracker mode and `mode: none`; the mode-split default is retired;
// `docs/setup-tracker-mode.md` + `templates/CLAUDE.md.template` name the
// single default.
// AC-STE-388.3 (doc leg): `/spec-write` § 7a derives its template via
// `canonicalBranchTemplate` with `{N}` from the FR's `milestone:` frontmatter.
// AC-STE-388.4 (doc leg): `/implement` 0.b″ resolves `{N}` from the resolved
// FR's `milestone:` frontmatter; explicit Schema L `branch_template:` still
// wins; absent key still skips; `docs/implement-reference.md` § Branch
// Proposal updated.
// AC-STE-388.7: docs sweep — no shipped doc still presents the ticket-keyed
// form as a seeded default (historical/archived references exempt).
//
// Literal substring checks per this repo's doc-conformance convention
// (pattern: tests/branch-type-derivation-doc-conformance.test.ts).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(pluginRoot, rel), "utf8");
}

const SETUP_SKILL = "skills/setup/SKILL.md";
const SPEC_WRITE_SKILL = "skills/spec-write/SKILL.md";
const IMPLEMENT_SKILL = "skills/implement/SKILL.md";
const SPEC_WRITE_BRANCH_NAME_FOR = "skills/spec-write/branch_name_for.ts";
const SETUP_TRACKER_MODE = "docs/setup-tracker-mode.md";
const IMPLEMENT_REFERENCE = "docs/implement-reference.md";
const PATTERNS = "docs/patterns.md";
const CLAUDE_MD_TEMPLATE = "templates/CLAUDE.md.template";

const CANONICAL = "{type}/m{N}-{slug}";
const RETIRED = "{type}/{ticket-id}-{slug}";

/** Slice body between two anchors; fails the test when either is missing. */
function sliceBetween(body: string, startAnchor: string, endAnchor: string): string {
  const start = body.indexOf(startAnchor);
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf(endAnchor, start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

function setup7cRegion(): string {
  return sliceBetween(read(SETUP_SKILL), "### 7c. Branch-naming template", "### 7d");
}

function setupTrackerModeBranchSection(): string {
  return sliceBetween(read(SETUP_TRACKER_MODE), "## Branch template", "## `/setup --migrate` entry");
}

describe("AC-STE-388.2 — /setup step 7c seeds one canonical default in both modes", () => {
  test("setup SKILL.md § 7c names the canonical default", () => {
    expect(setup7cRegion()).toContain(`default: \`${CANONICAL}\``);
  });

  test("setup SKILL.md § 7c retires the mode-split default-for-mode phrasing", () => {
    expect(/default-for-mode/i.test(setup7cRegion())).toBe(false);
  });

  test("setup SKILL.md § 7c no longer seeds the ticket-keyed form as a tracker-mode default", () => {
    expect(setup7cRegion()).not.toContain(`\`${RETIRED}\` in any tracker mode`);
  });

  test("docs/setup-tracker-mode.md drops the mode-split defaults table", () => {
    const region = setupTrackerModeBranchSection();
    expect(region).not.toContain("Defaults by mode");
    expect(region).not.toContain(`| \`linear\` / \`jira\` / custom | \`${RETIRED}\` |`);
  });

  test("docs/setup-tracker-mode.md § Branch template names the single canonical default", () => {
    expect(setupTrackerModeBranchSection()).toContain(`\`${CANONICAL}\``);
  });

  test("docs/setup-tracker-mode.md carries no default-for-mode phrasing anywhere", () => {
    expect(/default-for-mode/i.test(read(SETUP_TRACKER_MODE))).toBe(false);
  });

  test("templates/CLAUDE.md.template names the single canonical default", () => {
    expect(read(CLAUDE_MD_TEMPLATE)).toContain(`branch_template: e.g. \`${CANONICAL}\``);
  });

  test("templates/CLAUDE.md.template drops the per-mode default qualifiers", () => {
    const body = read(CLAUDE_MD_TEMPLATE);
    expect(body).not.toContain("(tracker-mode default)");
    expect(body).not.toContain("(mode: none default)");
  });
});

describe("AC-STE-388.3 — /spec-write § 7a derives its template via canonicalBranchTemplate", () => {
  function gateRegion(): string {
    const body = read(SPEC_WRITE_SKILL);
    const idx = body.indexOf("Universal pre-commit branch gate (STE-228):");
    expect(idx).toBeGreaterThan(-1);
    return body.slice(idx, idx + 3000);
  }

  test("gate region references canonicalBranchTemplate", () => {
    expect(gateRegion()).toContain("canonicalBranchTemplate");
  });

  test("gate region resolves {N} from the FR's milestone: frontmatter", () => {
    expect(gateRegion()).toContain("`milestone:` frontmatter");
  });

  test("SpecWriteBranchInput keeps its shape (milestone stays optional)", () => {
    const body = read(SPEC_WRITE_BRANCH_NAME_FOR);
    expect(body).toContain("SpecWriteBranchInput");
    expect(body).toContain("milestone?: string");
  });
});

describe("AC-STE-388.4 — /implement 0.b″ proposes the m-form from milestone: frontmatter", () => {
  function bPrimePrimeLine(): string {
    const body = read(IMPLEMENT_SKILL);
    const line = body.split("\n").find((l) => l.includes("0.b″ Branch proposal"));
    expect(line).toBeDefined();
    return line!;
  }

  test("0.b″ references canonicalBranchTemplate", () => {
    expect(bPrimePrimeLine()).toContain("canonicalBranchTemplate");
  });

  test("0.b″ resolves {N} from the resolved FR's milestone: frontmatter", () => {
    expect(bPrimePrimeLine()).toContain("`milestone:` frontmatter");
  });

  test("0.b″ still documents that an explicit Schema L branch_template: value wins", () => {
    expect(/wins|takes precedence/i.test(bPrimePrimeLine())).toBe(true);
  });

  test("0.b″ absent-key semantics unchanged: absent branch_template: still skips entirely", () => {
    expect(bPrimePrimeLine()).toContain("Absent `branch_template:` ⇒ skip entirely");
  });

  function branchProposalRegion(): string {
    return sliceBetween(read(IMPLEMENT_REFERENCE), "## Branch Proposal", "## Milestone Archival Procedure");
  }

  test("implement-reference.md § Branch Proposal references canonicalBranchTemplate", () => {
    expect(branchProposalRegion()).toContain("canonicalBranchTemplate");
  });

  test("implement-reference.md § Branch Proposal names the milestone: frontmatter input", () => {
    expect(branchProposalRegion()).toContain("`milestone:`");
  });

  test("implement-reference.md § Branch Proposal documents the explicit-template precedence", () => {
    expect(/wins|takes precedence/i.test(branchProposalRegion())).toBe(true);
  });
});

describe("AC-STE-388.7 — docs sweep: ticket-keyed form no longer presented as a seeded default", () => {
  test("docs/patterns.md § Branch automation no longer seeds the ticket form in tracker mode", () => {
    expect(read(PATTERNS)).not.toContain(`\`${RETIRED}\` in tracker mode`);
  });

  test("docs/patterns.md Schema L key table exemplifies the canonical template", () => {
    expect(read(PATTERNS)).not.toContain(`branch-naming template (e.g., \`${RETIRED}\`)`);
  });

  test("docs/implement-reference.md presents no tracker-mode seeded default", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(body).not.toContain("tracker-mode default");
    expect(body).not.toContain(`\`${RETIRED}\` in tracker mode`);
  });

  test("all four swept docs name the canonical template", () => {
    for (const rel of [PATTERNS, SETUP_TRACKER_MODE, IMPLEMENT_REFERENCE, CLAUDE_MD_TEMPLATE]) {
      expect(read(rel)).toContain(CANONICAL);
    }
  });
});
