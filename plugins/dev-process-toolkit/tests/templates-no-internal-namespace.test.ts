// STE-137 AC-STE-137.7 — shipped templates + examples must not leak this
// repo's internal `STE-N` / `M<N>` namespace into surfaces that copy into
// adopting projects. The test strips fenced code blocks (templates may
// legitimately demonstrate frontmatter snippets containing
// `<tracker-id>` placeholders) and asserts the residual user-visible
// prose carries no `STE-\d+` or `M\d+` literal — adapter-rendered
// placeholder shapes like `STE-<N>` / `M<N>` survive (the `<` is not a
// digit, so the regex doesn't match).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const TARGET_FILES: string[] = [
  "templates/CLAUDE.md.template",
  "templates/spec-templates/requirements.md.template",
  "templates/spec-templates/plan.md.template",
  "templates/spec-templates/testing-spec.md.template",
  "templates/docs-architecture.md.template",
  "examples/bun-typescript.md",
];

const FENCED_BLOCK_RE = /```[\s\S]*?```/g;
// FR text says `STE-\d+` (hyphen) and `M\d+` (no hyphen) — match both shapes.
// Adapter-rendered placeholders (`STE-<N>` / `M<N>`) intentionally don't
// match because `<` is not a digit, so the residual content is allowed to
// keep them.
const VIOLATION_RE = /\b(?:STE-|M)\d+\b/g;

function stripFenced(source: string): string {
  return source.replace(FENCED_BLOCK_RE, "");
}

describe("AC-STE-137.7 — shipped templates carry no internal STE-N / M-N namespace", () => {
  for (const relPath of TARGET_FILES) {
    test(`${relPath}: no STE-\\d+ / M-\\d+ literals in non-fenced content`, () => {
      const body = readFileSync(join(pluginRoot, relPath), "utf-8");
      const stripped = stripFenced(body);
      const matches = stripped.match(VIOLATION_RE);
      if (matches) {
        throw new Error(
          `${relPath} leaks internal namespace tokens (post fenced-code-strip): ${matches.join(", ")}`,
        );
      }
      expect(matches).toBeNull();
    });
  }
});

describe("AC-STE-137.4 — testing-spec.md.template fixes the G0 broken docs/patterns.md link", () => {
  const body = readFileSync(
    join(pluginRoot, "templates", "spec-templates", "testing-spec.md.template"),
    "utf-8",
  );
  test("template carries no docs/patterns.md path reference", () => {
    expect(body).not.toMatch(/docs\/patterns\.md/);
  });
});
