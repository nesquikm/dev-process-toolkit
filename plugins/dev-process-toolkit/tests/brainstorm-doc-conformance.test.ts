import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-227 AC-STE-227.4 — `/brainstorm --no-tech` documentation contract.
//
// Step 1 (Socratic clarification) runs unchanged. Step 2 (Explore Approaches)
// is skipped — non-technical users can't pick architectural tradeoffs. At
// Step 4 hand-off, the flag auto-propagates: the recommended next command is
// `/spec-write --no-tech`, not the bare form.
//
// This is doc-conformance: assertions over the SKILL.md prose, not runtime
// behavior. The skill prose must instruct the LLM how to behave under the
// flag; without this prose the implementation site has nothing to read.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "brainstorm", "SKILL.md");

function read(): string {
  return readFileSync(skillPath, "utf8");
}

describe("AC-STE-227.4 — /brainstorm --no-tech: argument-hint advertises the flag", () => {
  test("argument-hint frontmatter line carries --no-tech", () => {
    const body = read();
    const hintMatch = body.match(/^argument-hint:\s*['"](.+?)['"]/m);
    expect(hintMatch).not.toBeNull();
    expect(hintMatch![1]).toContain("--no-tech");
  });
});

describe("AC-STE-227.4 — Step 1 (Socratic clarification) documents the --no-tech flag", () => {
  test("Step 1 section mentions --no-tech (flag is acknowledged at the entry point)", () => {
    const body = read();
    const step1Idx = body.indexOf("### 1. Clarify the Problem");
    expect(step1Idx).toBeGreaterThan(-1);
    const step2Idx = body.indexOf("### 2. Explore Approaches");
    expect(step2Idx).toBeGreaterThan(step1Idx);
    const slice = body.slice(step1Idx, step2Idx);
    // The flag is explicitly named or referenced inside Step 1 (e.g.,
    // "--no-tech runs Step 1 only" / "Step 1 fires regardless of --no-tech").
    expect(slice).toContain("--no-tech");
  });
});

describe("AC-STE-227.4 — Step 2 (Explore Approaches) carve-out is documented", () => {
  test("Step 2 section documents --no-tech skip behavior", () => {
    const body = read();
    const step2Idx = body.indexOf("### 2. Explore Approaches");
    expect(step2Idx).toBeGreaterThan(-1);
    const step3Idx = body.indexOf("### 3.");
    expect(step3Idx).toBeGreaterThan(step2Idx);
    const slice = body.slice(step2Idx, step3Idx);
    // The carve-out: Step 2 is skipped under --no-tech.
    expect(slice).toContain("--no-tech");
    expect(slice).toMatch(/skip|skipped/i);
  });
});

describe("AC-STE-227.4 — Step 4 (Hand Off) auto-propagates the flag", () => {
  test("Step 4 documents recommending `/spec-write --no-tech` (not the bare form) under --no-tech", () => {
    const body = read();
    const step4Idx = body.indexOf("### 4. Hand Off");
    expect(step4Idx).toBeGreaterThan(-1);
    // Read to end-of-section (rules block or end of file).
    const sliceEnd = (() => {
      const rulesIdx = body.indexOf("## Rules", step4Idx);
      return rulesIdx > -1 ? rulesIdx : body.length;
    })();
    const slice = body.slice(step4Idx, sliceEnd);
    expect(slice).toContain("--no-tech");
    // The propagation: hand-off recommends `/spec-write --no-tech`.
    expect(slice).toMatch(/\/spec-write\s+--no-tech|\/dev-process-toolkit:spec-write\s+--no-tech/);
  });
});
