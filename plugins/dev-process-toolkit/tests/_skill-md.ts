import { expect } from "bun:test";

// Shared SKILL.md prose-test helpers. Used by `tests/probe-parity.test.ts`-style
// regex-shape gates that need to scope their assertions to a specific
// SKILL.md section (e.g., the `## Rules` block).
//
// The DRY rationale: multiple tests assert against the same `## Rules` section
// from different ACs (M24 STE-87 and M28 STE-101). Inlining the slicer in each
// test would silently drift if one copy was patched; a shared helper closes
// that gap.

/**
 * Extract the `## Rules` section from a SKILL.md body. Returns the section
 * text from the heading line through (but not including) the next `## ` heading.
 *
 * Caller invariant: the SKILL.md body contains exactly one `## Rules` heading.
 */
export function rulesBlock(body: string): string {
  const start = body.indexOf("\n## Rules");
  expect(start).toBeGreaterThan(-1);
  const remainder = body.slice(start + 1);
  const endRel = remainder.search(/\n## \S/);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
}
