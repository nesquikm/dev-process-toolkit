// STE-122 AC-STE-122.1 — `templates/spec-templates/requirements.md.template`
// must use `AC-<tracker-id>.<N>` placeholders (mirroring STE-66's filename
// rule), not bare-digit milestone-numbered `AC-1.1` / `AC-2.1` literals.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(pluginRoot, "templates", "spec-templates", "requirements.md.template");
const content = readFileSync(templatePath, "utf-8");

describe("requirements.md.template — AC placeholder shape (AC-STE-122.1)", () => {
  test("contains AC-<tracker-id>.<N> placeholder", () => {
    expect(content).toMatch(/AC-<tracker-id>\.\d+/);
  });

  test("does NOT contain bare-digit-milestone shape (AC-1.1, AC-2.1, etc.)", () => {
    // Strip fenced code blocks before scanning — illustrative `AC-1.1`
    // snippets in fenced blocks are exempt under AC-STE-122.4.
    const stripped = stripFencedBlocks(content);
    expect(stripped).not.toMatch(/\bAC-\d+\.\d+\b/);
  });

  test("placeholder bullet flagged in top-of-file comment block", () => {
    // STE-137 narrowed this: the comment still describes the
    // `AC-<tracker-id>.<N>` placeholder shape, but no longer cites STE-N
    // IDs (those would leak this repo's namespace into adopting
    // projects).
    expect(content).toMatch(/AC-<tracker-id>\.<N>/);
    expect(content).toMatch(/placeholder convention|tracker allocator/i);
  });

  test("traceability matrix uses AC-<tracker-id>.<N> placeholder rows", () => {
    expect(content).toMatch(/\|\s*AC-<tracker-id>\.\d+/);
  });
});

function stripFencedBlocks(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^    /.test(line)) continue;
    // strip inline backticks (single-line spans)
    out.push(line.replace(/`[^`]*`/g, ""));
  }
  return out.join("\n");
}
