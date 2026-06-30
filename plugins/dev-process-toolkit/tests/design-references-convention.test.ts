import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-341 — specs/design/ storage convention + optional `## Design References`
// template section. This FR is a DOCUMENTATION / PROSE-CONTRACT only — no
// runtime helper ships. These meta-tests assert the documentation + skill
// surfaces carry the convention (modelled on the existing
// `*-doc-conformance` / `claude-md-template-docs-stub` meta-tests:
// readFileSync the surface, assert it contains the required phrasing).

const pluginRoot = join(import.meta.dir, "..");

const layoutPath = join(pluginRoot, "docs", "layout-reference.md");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const specArchivePath = join(pluginRoot, "skills", "spec-archive", "SKILL.md");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Slice § 0b (FR creation path) out of /spec-write SKILL.md so placement
 * assertions are scoped to the body-section contract, not the whole file.
 */
function specWriteSection0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  const end = body.indexOf("### 1. Assess current state");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("STE-341 — specs/design/ convention + optional ## Design References section", () => {
  test("AC-STE-341.1 — layout-reference.md documents both specs/design/ subtrees + never-archived rule", () => {
    const layout = read(layoutPath);

    // Both subtrees must be documented by their canonical paths.
    expect(layout).toContain("specs/design/system/");
    expect(layout).toContain("specs/design/frs/");

    // The never-archived rule: no skill git-mv's or rewriteArchiveLinks-
    // rewrites any specs/design/ path. Accept "never archived"/"never-
    // archived" or "never `git mv`" / "never ... rewriteArchiveLinks".
    expect(layout).toMatch(
      /never[- ]archived|never\b[\s\S]{0,20}git mv|never\b[\s\S]{0,24}rewriteArchiveLinks/i,
    );
  });

  test("AC-STE-341.2 — optional `## Design References` section documented (shape + worked example)", () => {
    // (a) layout-reference.md names the section AND relaxes the
    // "exactly these top-level sections" closed-set claim to admit the
    // optional follow-on.
    const layout = read(layoutPath);
    expect(layout).toContain("## Design References");
    expect(layout).toMatch(
      /optional(?:ly)?[\s\S]{0,140}Design References|Design References[\s\S]{0,140}optional(?:ly)?/i,
    );

    // (b) /spec-write § 0b body-section contract documents the optional
    // section placed after `## Acceptance Criteria`, with repo-root-relative
    // image paths and a worked example.
    const sec0b = specWriteSection0b(read(specWritePath));
    expect(sec0b).toContain("## Design References");
    expect(sec0b).toContain("## Acceptance Criteria");
    // Placement: the optional section is introduced after the required
    // `## Acceptance Criteria` section in the contract prose.
    expect(sec0b.indexOf("## Design References")).toBeGreaterThan(
      sec0b.indexOf("## Acceptance Criteria"),
    );
    // Reference style is documented as repo-root-relative.
    expect(sec0b).toMatch(/repo[- ]root[- ]relative/i);
    // Worked example: a repo-root-relative design-image path.
    expect(sec0b).toMatch(
      /specs\/design\/frs\/[^\s)`'"]+\.(?:png|jpe?g|svg|webp|gif)/i,
    );
  });

  test("AC-STE-341.3 — archival immutability stated at /implement Phase 4 + /spec-archive", () => {
    // Each archival surface carries an explicit specs/design/ immutability
    // statement: specs/design/ paths are never git-mv'd and never rewritten
    // by rewriteArchiveLinks. Check it as a co-located statement (the
    // never/immutable wording + the rewrite mechanism appear in the same
    // neighborhood as the specs/design/ mention).
    const assertImmutabilityStatement = (path: string) => {
      const body = read(path);
      const idx = body.indexOf("specs/design/");
      expect(idx, `${path} should mention specs/design/`).toBeGreaterThan(-1);
      const window = body.slice(Math.max(0, idx - 200), idx + 400);
      expect(window, `${path}: immutability wording near specs/design/`).toMatch(
        /never|immutab/i,
      );
      expect(
        window,
        `${path}: git mv / rewriteArchiveLinks near specs/design/`,
      ).toMatch(/git mv|rewriteArchiveLinks/);
    };

    assertImmutabilityStatement(implementPath);
    assertImmutabilityStatement(specArchivePath);
  });

  test("AC-STE-341.4 — FR-section contract carries the optional-section permission note (no drift)", () => {
    // No /gate-check probe enforces the FR body section SET/ORDER, so the
    // no-drift requirement is satisfied by an explicit note in the FR-section
    // contract that the optional `## Design References` section is permitted
    // after `## Acceptance Criteria`. Kept distinct from .2: this is the
    // permission / no-drift wording specifically.
    const layout = read(layoutPath);
    expect(layout).toMatch(
      /optional(?:ly)?\s+followed by[\s\S]{0,40}Design References|optional(?:ly)?[\s\S]{0,100}Design References[\s\S]{0,100}Acceptance Criteria/i,
    );
  });

  test("AC-STE-341.1 (template) — CLAUDE.md.template mentions specs/design/", () => {
    // Generated projects learn the convention exists via the layout overview.
    const template = read(templatePath);
    expect(template).toContain("specs/design/");
  });
});
