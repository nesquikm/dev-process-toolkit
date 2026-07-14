// STE-381 — doc-conformance for the derived-branch-type contract.
//
// AC-STE-381.2: `/spec-write` § 0b step 2 passes `changelogCategory` on
// every new-FR create (closed Keep-a-Changelog set, default `Added`).
// AC-STE-381.3: `/spec-write` § 7a derives `type` via
// `branchTypeFor({ changelogCategory, noTech })`; LLM pass rescoped to
// `{slug}` only.
// AC-STE-381.4: `/implement` 0.b″ reads the resolved FR's
// `changelog_category` frontmatter and derives `type` via the same helper
// (`noTech` never applies there — documented, not plumbed).
// AC-STE-381.5: docs sweep — every "LLM-returned `{type}`" reference
// updated (branch_proposal.ts header, docs/implement-reference.md § Branch
// Proposal); `docs/specs-cross-cutting` literal + TRUNK_OK_TYPES untouched.
//
// Literal substring checks per this repo's doc-conformance convention.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(pluginRoot, rel), "utf8");
}

const SPEC_WRITE_SKILL = "skills/spec-write/SKILL.md";
const IMPLEMENT_SKILL = "skills/implement/SKILL.md";
const BRANCH_PROPOSAL_SRC = "adapters/_shared/src/branch_proposal.ts";
const IMPLEMENT_REFERENCE = "docs/implement-reference.md";
const SPEC_WRITE_BRANCH_NAME_FOR = "skills/spec-write/branch_name_for.ts";
const REQUIRE_COMMITTABLE = "adapters/_shared/src/require_committable_branch.ts";

describe("AC-STE-381.2 — /spec-write § 0b step 2 passes changelogCategory on every new-FR create", () => {
  test("§ 0b step 2 (Build canonical frontmatter) region names the changelog-category opt", () => {
    const body = read(SPEC_WRITE_SKILL);
    const anchorIdx = body.indexOf("Build canonical frontmatter via");
    expect(anchorIdx).toBeGreaterThan(-1);
    const slice = body.slice(anchorIdx, anchorIdx + 3000);
    expect(/changelog_category|changelogCategory/.test(slice)).toBe(true);
  });

  test("spec-write SKILL.md names the closed Keep-a-Changelog set", () => {
    const body = read(SPEC_WRITE_SKILL);
    expect(body).toContain("Added, Changed, Deprecated, Removed, Fixed, Security");
  });

  test("spec-write SKILL.md carries the camelCase opt name for buildFRFrontmatter", () => {
    const body = read(SPEC_WRITE_SKILL);
    expect(body).toContain("changelogCategory");
  });
});

describe("AC-STE-381.3 — /spec-write § 7a derives type via branchTypeFor", () => {
  test("spec-write SKILL.md pins the derived-type call shape", () => {
    const body = read(SPEC_WRITE_SKILL);
    expect(body).toContain("branchTypeFor({ changelogCategory, noTech })");
  });

  test("spec-write SKILL.md references the branchTypeFor helper", () => {
    const body = read(SPEC_WRITE_SKILL);
    expect(body).toContain("branchTypeFor");
  });
});

describe("AC-STE-381.4 — /implement 0.b″ derives type from changelog_category frontmatter", () => {
  function bPrimePrimeRegion(): string {
    const body = read(IMPLEMENT_SKILL);
    const anchorIdx = body.indexOf("0.b″ Branch proposal");
    expect(anchorIdx).toBeGreaterThan(-1);
    return body.slice(anchorIdx, anchorIdx + 4500);
  }

  test("0.b″ region references branchTypeFor", () => {
    expect(bPrimePrimeRegion()).toContain("branchTypeFor");
  });

  test("0.b″ region reads the resolved FR's changelog_category frontmatter", () => {
    expect(bPrimePrimeRegion()).toContain("changelog_category");
  });

  test("0.b″ region documents that noTech never applies there", () => {
    expect(bPrimePrimeRegion()).toContain("noTech");
  });

  test("implement SKILL.md no longer runs an LLM pass for {type, slug}", () => {
    const body = read(IMPLEMENT_SKILL);
    expect(body).not.toContain("LLM pass for `{type, slug}`");
  });
});

describe("AC-STE-381.5 — docs sweep: LLM-returned {type} references updated", () => {
  test("branch_proposal.ts header no longer claims the LLM pass returns {type, slug}", () => {
    const body = read(BRANCH_PROPOSAL_SRC);
    expect(body).not.toContain("LLM pass that returns");
  });

  test("branch_proposal.ts type field is no longer documented as raw LLM-returned", () => {
    const body = read(BRANCH_PROPOSAL_SRC);
    expect(body).not.toContain("Raw LLM-returned `{type}`");
  });

  test("branch_proposal.ts points at the derived-type contract (branchTypeFor)", () => {
    const body = read(BRANCH_PROPOSAL_SRC);
    expect(body).toContain("branchTypeFor");
  });

  test("implement-reference.md § Branch Proposal no longer returns {type, slug} as structured JSON", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(body).not.toContain("return `{type, slug}` as structured JSON");
  });

  test("implement-reference.md § Branch Proposal references branchTypeFor", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(body).toContain("branchTypeFor");
  });

  test("implement-reference.md § Branch Proposal names the changelog_category input", () => {
    const body = read(IMPLEMENT_REFERENCE);
    expect(body).toContain("changelog_category");
  });
});

describe("AC-STE-381.5 — untouched surfaces stay untouched", () => {
  test("cross-cutting literal docs/specs-cross-cutting survives in spec-write branch_name_for.ts", () => {
    const body = read(SPEC_WRITE_BRANCH_NAME_FOR);
    expect(body).toContain('return "docs/specs-cross-cutting"');
  });

  test('TRUNK_OK_TYPES = ["ci"] survives in require_committable_branch.ts', () => {
    const body = read(REQUIRE_COMMITTABLE);
    expect(body).toContain('TRUNK_OK_TYPES = ["ci"]');
  });
});
