import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReleaseFiles } from "../adapters/_shared/src/release_config";

// AC-STE-167.5 / AC-STE-167.4 / AC-STE-167.2 — wiring tests.
//
// 1. Toolkit's own CLAUDE.md ships a populated `## Release Files` block
//    that parses to the legacy four-file shape (self-hosting verification).
// 2. /setup SKILL.md prose carries the step that writes the block.
// 3. /ship-milestone SKILL.md prose carries the new block-driven flow and
//    no longer hard-codes the four toolkit-internal paths.
// 4. CLAUDE.md.template ships the canonical block stub for downstream
//    projects.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pluginRoot = join(import.meta.dir, "..");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

describe("AC-STE-167.5 — toolkit CLAUDE.md self-hosts the block", () => {
  test("toolkit CLAUDE.md carries a parseable Release Files block", () => {
    const md = read(join(repoRoot, "CLAUDE.md"));
    const entries = parseReleaseFiles(md);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("plugins/dev-process-toolkit/.claude-plugin/plugin.json");
    expect(paths).toContain(".claude-plugin/marketplace.json");
    expect(paths).toContain("CHANGELOG.md");
    expect(paths).toContain("README.md");
  });

  test("toolkit's nested marketplace entry uses plugins[0].version dot-path", () => {
    const md = read(join(repoRoot, "CLAUDE.md"));
    const entries = parseReleaseFiles(md);
    const marketplace = entries.find((e) => e.path === ".claude-plugin/marketplace.json");
    expect(marketplace).toBeDefined();
    expect(marketplace!.kind).toBe("json");
    expect(marketplace!.field).toBe("plugins[0].version");
  });
});

describe("AC-STE-167.1 — CLAUDE.md.template ships the block stub", () => {
  test("template carries a `## Release Files` heading", () => {
    const tpl = read(join(pluginRoot, "templates", "CLAUDE.md.template"));
    expect(tpl).toContain("## Release Files");
  });

  test("template's stub block parses to a valid entry list", () => {
    const tpl = read(join(pluginRoot, "templates", "CLAUDE.md.template"));
    const entries = parseReleaseFiles(tpl);
    expect(entries.length).toBeGreaterThan(0);
    // Default stub assumes a TS/Node project — package.json + CHANGELOG + README.
    expect(entries.some((e) => e.path === "package.json" && e.kind === "json")).toBe(true);
  });
});

describe("AC-STE-167.2 — /setup SKILL.md describes step 7e", () => {
  test("setup SKILL.md mentions the Release Files block step", () => {
    const skill = read(join(pluginRoot, "skills", "setup", "SKILL.md"));
    expect(skill).toMatch(/Release Files block/);
    expect(skill).toMatch(/examples\/<stack>\/release\.yml/);
    // Re-run preserves user edits.
    expect(skill.toLowerCase()).toMatch(/leave it alone|user-edited overrides win/);
  });
});

describe("AC-STE-167.4 — /ship-milestone SKILL.md reads the block", () => {
  test("ship-milestone SKILL.md no longer hard-codes the four toolkit paths", () => {
    const skill = read(join(pluginRoot, "skills", "ship-milestone", "SKILL.md"));
    const step4 = skill.slice(skill.indexOf("### 4. Construct release-file changes"));
    const step5Idx = step4.indexOf("### 5.");
    const step4Body = step4.slice(0, step5Idx);
    // The hard-coded "four files" enumeration must be gone from step 4.
    expect(step4Body).not.toContain("plugins/dev-process-toolkit/.claude-plugin/plugin.json");
    expect(step4Body).not.toContain(".claude-plugin/marketplace.json");
    // The new block-driven flow must be cited.
    expect(step4Body).toContain("## Release Files");
    expect(step4Body).toContain("parseReleaseFiles");
    expect(step4Body).toContain("bumpFile");
  });

  test("ship-milestone SKILL.md cites the refusal shapes for missing/malformed block", () => {
    const skill = read(join(pluginRoot, "skills", "ship-milestone", "SKILL.md"));
    expect(skill).toContain("MissingReleaseFilesBlockError");
    expect(skill).toContain("MalformedReleaseFilesError");
  });
});

describe("docs/ship-milestone-reference.md carries the schema reference", () => {
  test("reference doc covers all five kinds with worked examples", () => {
    const ref = read(join(pluginRoot, "docs", "ship-milestone-reference.md"));
    expect(ref).toContain("kind: json");
    expect(ref).toContain("kind: toml");
    expect(ref).toContain("kind: yaml");
    expect(ref).toContain("kind: changelog");
    expect(ref).toContain("kind: regex");
    // Covers the override guide.
    expect(ref.toLowerCase()).toMatch(/writing your own override|kind: regex.*escape hatch/i);
  });
});
