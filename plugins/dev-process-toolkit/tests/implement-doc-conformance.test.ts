import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-227 AC-STE-227.6 / AC-STE-227.7 / AC-STE-227.8 — `/implement` doc
// conformance for the needs_technical_review refusal.
//
// The skill prose must document:
//   - AC.6: Phase 0.b′ refusal on single-FR resolve when frontmatter has
//     `needs_technical_review: true`. NFR-10 canonical refusal naming the
//     FR + remedy. No claim, no branch, zero side effects (refusal fires
//     before 0.b″ branch and 0.c claim).
//   - AC.7: Milestone-scope refusal when ANY active FR in M<N> has the
//     flag. Refusal enumerates every flagged FR. Fires before any claim.
//   - AC.8: `implement_refused_needs_technical_review` capability key
//     surfaces in the closing summary's static map.
//
// Doc-conformance only: assertions over SKILL.md prose, not runtime.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function read(): string {
  return readFileSync(skillPath, "utf8");
}

describe("AC-STE-227.6 — single-FR /implement refusal at Phase 0.b′", () => {
  test("SKILL.md documents needs_technical_review refusal in Phase 1 (where 0.b′ lives)", () => {
    const body = read();
    // Phase 1 carries the 0.b′ resolver entry.
    const ph1Idx = body.indexOf("## Phase 1: Understand");
    expect(ph1Idx).toBeGreaterThan(-1);
    const ph2Idx = body.indexOf("## Phase 2: Build");
    expect(ph2Idx).toBeGreaterThan(ph1Idx);
    const slice = body.slice(ph1Idx, ph2Idx);
    expect(slice).toContain("needs_technical_review");
  });

  test("SKILL.md documents the refusal happens before claim and before branch (zero side effects)", () => {
    const body = read();
    // Per AC.6: "No claim, no branch, zero side effects — refusal happens
    // before Phase 0.c (claim) and 0.b″ (branch proposal)." The prose must
    // tell the LLM not to claim / branch when refusing.
    expect(body).toMatch(
      /needs_technical_review[\s\S]{0,1500}(no\s+claim|before\s+0\.c|before.*claim|zero\s+side\s+effects)/i,
    );
  });

  test("SKILL.md documents the canonical remedy phrase referencing /spec-write", () => {
    const body = read();
    // The remedy must instruct the operator to run /spec-write <FR-id>
    // (no flag) to complete the technical sections.
    expect(body).toMatch(
      /needs_technical_review[\s\S]{0,2500}\/spec-write\s+(<[^>]+>|<FR-id>|<id>)/i,
    );
  });
});

describe("AC-STE-227.7 — /implement M<N> refuses the whole milestone", () => {
  test("SKILL.md documents milestone-scope refusal enumerating every flagged FR", () => {
    const body = read();
    // Per AC.7: refusal enumerates every flagged FR so the reviewer can
    // address them in one batch.
    expect(body).toMatch(
      /needs_technical_review[\s\S]{0,3500}(milestone|M<N>|M<n>|every\s+(active\s+)?FR|enumerate)/i,
    );
  });

  test("SKILL.md documents milestone-scope refusal fires before any claim cycle", () => {
    const body = read();
    // The refusal must fire before any tracker claim starts.
    expect(body).toMatch(
      /needs_technical_review[\s\S]{0,3500}(before\s+(any\s+)?claim|no\s+claim)/i,
    );
  });
});

describe("AC-STE-227.8 — implement_refused_needs_technical_review capability key", () => {
  test("SKILL.md or implement closing-summary surfaces implement_refused_needs_technical_review", () => {
    const body = read();
    // AC.8 requires the capability key to surface in /implement's closing
    // summary. The exact rendering can live in implement-reference.md, but
    // SKILL.md must at minimum reference the key by name so it's grep-able.
    expect(body).toContain("implement_refused_needs_technical_review");
  });
});
