import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AC-STE-169.1 / AC-STE-169.2 — /implement chain-failure error message
// portability. The chain-failure block must not reference toolkit-internal
// paths (operators in non-toolkit projects can't follow that pointer).

const pluginRoot = join(import.meta.dir, "..");
const implementSkill = join(pluginRoot, "skills", "implement", "SKILL.md");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

describe("AC-STE-169.1 — chain-failure error message drops toolkit-internal path", () => {
  test("chain-failure block does NOT reference plugins/dev-process-toolkit/.claude-plugin/plugin.json", () => {
    const body = read(implementSkill);
    // Locate the chain-failure block.
    const idx = body.indexOf("Chain-failure refusal");
    expect(idx).toBeGreaterThan(-1);
    const block = body.slice(idx, idx + 800);
    expect(block).not.toContain("plugins/dev-process-toolkit/.claude-plugin/plugin.json");
  });

  test("chain-failure block names a generic remedy operators in non-toolkit projects can follow", () => {
    const body = read(implementSkill);
    const idx = body.indexOf("Chain-failure refusal");
    const block = body.slice(idx, idx + 800);
    // Must point at the user-facing remedy.
    expect(block).toMatch(/claude \/plugin list/);
  });
});

describe("AC-STE-169.2 — operator-facing toolkit-internal paths scrubbed from /implement", () => {
  test("zero matches of `plugins/dev-process-toolkit` in operator-facing prose", () => {
    const body = read(implementSkill);
    // grep -n -E 'plugins/dev-process-toolkit' SKILL.md should return zero
    // matches in the chain-failure / error-handling sections. We check the
    // entire file: any surviving match must live in a documentation
    // cross-reference (e.g., "see plugins/dev-process-toolkit/docs/X.md")
    // and NOT in operator-facing remedy/error text.
    const matches = body.split("\n").reduce<string[]>((acc, line, i) => {
      if (line.includes("plugins/dev-process-toolkit")) {
        acc.push(`${i + 1}: ${line.trim()}`);
      }
      return acc;
    }, []);
    // Every surviving match must be a doc cross-reference, not a remedy/error pointer.
    for (const match of matches) {
      const lower = match.toLowerCase();
      const isOperatorFacing =
        lower.includes("remedy:") ||
        lower.includes("verify the") ||
        lower.includes("check the") ||
        /^\s*remedy:/.test(match);
      expect(isOperatorFacing).toBe(false);
    }
  });
});
