import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for STE-68 AC-STE-68.6 + STE-107 AC-STE-107.5 —
// `templates/CLAUDE.md.template` carries a literal `## Docs` block with
// all-false defaults that downstream projects configure via `/setup` step
// 7d.
//
// STE-107 supersedes the original "commented stub" rule (STE-68 AC-STE-68.6
// pre-M29 wording): the section is now ALWAYS emitted as a real heading,
// even when all three flags default to false, so `/docs` and the
// `claudemd-docs-section-present` probe (gate-check #18) have something
// to read. Absent section is the legacy form (still treated as all-false
// by `readDocsConfig` for backward-compat) but `/setup`-generated files
// must always carry the literal block.

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");

describe("STE-68 AC-STE-68.6 — CLAUDE.md.template documents the ## Docs keys", () => {
  test("template file contains all three documented keys", () => {
    const body = readFileSync(templatePath, "utf-8");
    expect(body).toContain("user_facing_mode:");
    expect(body).toContain("packages_mode:");
    expect(body).toContain("changelog_ci_owned:");
  });

  test("template carries a literal `## Docs` heading (STE-107 AC-STE-107.5)", () => {
    const body = readFileSync(templatePath, "utf-8");
    const lines = body.split("\n");
    const liveHeadingIdx = lines.findIndex((l) => l === "## Docs");
    expect(liveHeadingIdx).toBeGreaterThanOrEqual(0);
  });

  test("template seeds all three flags to lowercase literal `false`", () => {
    const body = readFileSync(templatePath, "utf-8");
    expect(body).toMatch(/^user_facing_mode: false$/m);
    expect(body).toMatch(/^packages_mode: false$/m);
    expect(body).toMatch(/^changelog_ci_owned: false$/m);
  });
});
