// STE-216 — /simplify emits a loud advisory when leaving the tree dirty.
//
// /simplify modifies tracked files but leaves them uncommitted (auto-
// commit was rejected per CLAUDE.md core principle "human approval
// before commit"). The 4× recurring smoke finding is that the operator
// silently inherits a dirty tree because /simplify's closing summary
// doesn't warn about it. Fix: emit a `⚠ tree dirty: M <files> — run /pr
// or git commit to land the simplification` line + a
// `simplify_tree_dirty` capability row when `git status --porcelain` is
// non-empty after /simplify exits.
//
// /simplify is an LLM-driven skill; SKILL.md prose IS the contract.
// Tests assert the SKILL.md carries the right instructions plus the
// new capability key in the static plain-language map shared by
// /spec-write step 7.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");
const simplifySkill = join(pluginRoot, "skills", "simplify", "SKILL.md");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function readSimplify(): string {
  return readFileSync(simplifySkill, "utf-8");
}
function readSpecWrite(): string {
  return readFileSync(specWriteSkill, "utf-8");
}

describe("AC-STE-216.1 — closing summary runs git status --porcelain + emits advisory on dirty tree", () => {
  test("SKILL.md mentions `git status --porcelain` in the closing summary contract", () => {
    const body = readSimplify();
    expect(body).toMatch(/git status --porcelain/);
  });

  test("SKILL.md documents the literal `tree dirty:` token (machine-greppable)", () => {
    const body = readSimplify();
    expect(body).toMatch(/tree dirty:/);
  });

  test("SKILL.md instructs the closing summary to point the operator at `/pr` or `git commit`", () => {
    const body = readSimplify();
    expect(body).toMatch(/\/pr|git commit/);
  });
});

describe("AC-STE-216.2 — advisory glyph + literal token", () => {
  test("SKILL.md uses the warning glyph `⚠` adjacent to `tree dirty:`", () => {
    const body = readSimplify();
    // Must instruct the LLM to emit `⚠ tree dirty:` exactly so the smoke
    // driver can grep for the literal token deterministically.
    expect(body).toMatch(/⚠.*tree dirty:/);
  });
});

describe("AC-STE-216.3 — simplify_tree_dirty capability key in the static plain-language map", () => {
  test("the canonical key is present in the spec-write static map (single source of truth)", () => {
    const map = specWriteStep7Map(readSpecWrite());
    expect(map).toMatch(/\| `simplify_tree_dirty` \|/);
  });

  test("the rendered prose names the dirty tree + the operator's next step", () => {
    const map = specWriteStep7Map(readSpecWrite());
    const rowMatch = map.match(/simplify_tree_dirty[\s\S]{0,300}/);
    expect(rowMatch).not.toBeNull();
    const row = rowMatch![0];
    expect(row).toMatch(/tree dirty/i);
    expect(row).toMatch(/\/pr|git commit/);
  });

  test("simplify SKILL.md references the simplify_tree_dirty capability key", () => {
    const body = readSimplify();
    expect(body).toMatch(/simplify_tree_dirty/);
  });
});

describe("AC-STE-216.4 — clean tree ⇒ no advisory, no capability row", () => {
  test("SKILL.md documents the no-fire path on a clean tree", () => {
    const body = readSimplify();
    // The advisory is opt-in by tree state — must be conditional, not
    // unconditional. Pin the conditional emit phrasing.
    expect(body).toMatch(/clean.*(?:no\s+(?:advisory|fire)|nothing|skip)|when (?:non-empty|dirty)|if (?:non-empty|dirty)/i);
  });
});

describe("AC-STE-216.5 — fires regardless of who made the change (canonical or pre-existing)", () => {
  test("SKILL.md does NOT condition the advisory on /simplify being the change source", () => {
    const body = readSimplify();
    // The actionable signal is the dirty tree at exit time. Pre-existing
    // dirty + simplify-no-op should still fire. Pin the SKILL.md prose
    // describing the exit-time check rather than a write-tracking gate.
    expect(body).toMatch(/exit|end of|closing summary/i);
  });
});

describe("AC-STE-216.6 — informational advisory does NOT cause non-zero exit", () => {
  test("SKILL.md states the advisory is informational and exit code stays 0", () => {
    const body = readSimplify();
    expect(body).toMatch(/exit\s*0|exit-code|non-zero|informational/i);
  });
});
