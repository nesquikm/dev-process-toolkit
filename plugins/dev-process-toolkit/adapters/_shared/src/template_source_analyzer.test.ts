// Unit tests for analyzeTemplateSource (STE-468 AC-STE-468.1..4).
//
// Covers the template-source reuse inventory: the four categories
// (processConfig / manifests / scaffolding / sourcePatterns), the
// wholeProjectCandidate flag, NFR-10 refusals for a missing or
// non-directory sourceRoot, the non-git-is-legal + isGitRepo record,
// manifest delegation to deps_manifest/best_practices_manifest, and the
// malformed-manifest category-level warning path. Mirrors the shape of
// docs_config.test.ts — mkdtemp per test, thrown-error assertions.
//
// Mutation-verification discipline (AC-STE-468.4): every classifier has a
// positive AND a negative assertion — removing a classifier entry or
// inverting its predicate turns at least one expectation RED.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest as readBestPracticesManifest } from "./best_practices_manifest";
import { readManifest as readDepsManifest } from "./deps_manifest";
import {
  analyzeTemplateSource,
  PROCESS_CONFIG_FILES,
  SCAFFOLDING_CONFIG_NAMES,
} from "./template_source_analyzer";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-tmplsrc-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const VALID_DEPS_YAML = `deps:
  - name: sibling-docs
    path: ../sibling-docs
    kind: toolkit-docs
`;

const VALID_BEST_PRACTICES_YAML = `best_practices:
  - name: style-guide
    path: docs/style.md
    topics: [style, naming]
`;

// deps.yaml entry missing required `kind` — deps_manifest.ts refuses this
// with "missing required field \`kind\`" in its shape-error reason.
const MALFORMED_DEPS_YAML = `deps:
  - name: broken
    path: ../sibling-docs
`;

// best-practices.yaml entry with an unknown field — best_practices_manifest.ts
// refuses this with "unknown field \`bogus_key\`" in its shape-error reason.
const MALFORMED_BEST_PRACTICES_YAML = `best_practices:
  - name: broken
    path: docs/x.md
    bogus_key: nope
`;

interface FixtureOpts {
  git?: boolean;
  depsYaml?: string | null;
  bestPracticesYaml?: string | null;
}

/** Build a fully-populated template project tree under `root`. */
function makeFullFixture(root: string, opts: FixtureOpts = {}): string {
  const { git = true, depsYaml = VALID_DEPS_YAML, bestPracticesYaml = VALID_BEST_PRACTICES_YAML } =
    opts;
  mkdirSync(root, { recursive: true });
  // Process config
  writeFileSync(join(root, "CLAUDE.md"), "# Template project\n\n## Task Tracking\n\nmode: none\n");
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), '{ "permissions": { "allow": [] } }\n');
  writeFileSync(join(root, ".mcp.json"), '{ "mcpServers": {} }\n');
  // Manifests
  mkdirSync(join(root, "specs"), { recursive: true });
  if (depsYaml !== null) writeFileSync(join(root, "specs", "deps.yaml"), depsYaml);
  if (bestPracticesYaml !== null) {
    writeFileSync(join(root, "specs", "best-practices.yaml"), bestPracticesYaml);
  }
  // Scaffolding
  writeFileSync(join(root, "package.json"), '{ "name": "template", "version": "0.0.0" }\n');
  writeFileSync(join(root, "tsconfig.json"), '{ "compilerOptions": { "strict": true } }\n');
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "name: ci\non: push\n");
  // Source trees
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const answer = 42;\n");
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "lib", "util.ts"), "export const twice = (n: number) => n * 2;\n");
  // Non-source top-level dir that must never classify as a source pattern
  mkdirSync(join(root, "node_modules", "leftover-pkg"), { recursive: true });
  writeFileSync(join(root, "node_modules", "leftover-pkg", "index.js"), "module.exports = {};\n");
  // Negative-classification bait
  writeFileSync(join(root, "README.md"), "# Readme — docs, not process config\n");
  writeFileSync(join(root, "notes.txt"), "scratch notes — not a scaffolding config\n");
  if (git) {
    mkdirSync(join(root, ".git", "hooks"), { recursive: true });
    writeFileSync(join(root, ".git", "hooks", "commit-msg"), "#!/bin/sh\nexit 0\n");
  }
  return root;
}

/** Recursive tree snapshot (relative path + size + mtime) for the zero-mutation pin. */
function snapshotTree(root: string): string[] {
  const rows: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      const st = statSync(abs);
      rows.push(`${relPath}|${st.isDirectory() ? "dir" : st.size}|${st.mtimeMs}`);
      if (st.isDirectory()) walk(abs, relPath);
    }
  };
  walk(root, "");
  return rows;
}

describe("analyzeTemplateSource — categories (AC-STE-468.1)", () => {
  test("processConfig classifies CLAUDE.md, .claude/settings.json, .mcp.json, git hooks — and NOT README.md", () => {
    const root = makeFullFixture(join(work, "tmpl"));
    const inv = analyzeTemplateSource(root);
    expect(inv.processConfig.files).toContain("CLAUDE.md");
    expect(inv.processConfig.files).toContain(".claude/settings.json");
    expect(inv.processConfig.files).toContain(".mcp.json");
    // Git-hook template detection: the installed commit-msg hook is inventoried.
    expect(inv.processConfig.files.some((f) => f.includes("commit-msg"))).toBe(true);
    // Negative classification (mutation pin): a plain doc never classifies.
    expect(inv.processConfig.files).not.toContain("README.md");
  });

  test("scaffolding classifies known build/CI configs by name — and NOT arbitrary files", () => {
    const root = makeFullFixture(join(work, "tmpl"));
    const inv = analyzeTemplateSource(root);
    expect(inv.scaffolding.files).toContain("package.json");
    expect(inv.scaffolding.files).toContain("tsconfig.json");
    expect(inv.scaffolding.files.some((f) => f.includes(".github/workflows"))).toBe(true);
    // Negative classification (mutation pin).
    expect(inv.scaffolding.files).not.toContain("notes.txt");
    // Scaffolding and process config are disjoint vocabularies.
    expect(inv.scaffolding.files).not.toContain("CLAUDE.md");
  });

  test("sourcePatterns lists top-level source trees only — never node_modules or .git", () => {
    const root = makeFullFixture(join(work, "tmpl"));
    const inv = analyzeTemplateSource(root);
    expect(inv.sourcePatterns.dirs).toContain("src");
    expect(inv.sourcePatterns.dirs).toContain("lib");
    // Negative classification (mutation pin): excluded trees never appear.
    expect(inv.sourcePatterns.dirs).not.toContain("node_modules");
    expect(inv.sourcePatterns.dirs).not.toContain(".git");
  });

  test("manifests carry per-entry rows identical to the manifest modules' own parse", () => {
    const root = makeFullFixture(join(work, "tmpl"));
    const inv = analyzeTemplateSource(root);
    const specsDir = join(root, "specs");
    // Rows must match what the canonical manifest modules return — the
    // analyzer delegates, it does not re-parse ad hoc (AC-STE-468.3).
    expect(inv.manifests.deps).toEqual(readDepsManifest(specsDir).deps);
    expect(inv.manifests.bestPractices).toEqual(readBestPracticesManifest(specsDir).best_practices);
    expect(inv.manifests.deps.map((e) => e.name)).toEqual(["sibling-docs"]);
    expect(inv.manifests.bestPractices.map((e) => e.name)).toEqual(["style-guide"]);
    expect(inv.manifests.bestPractices[0]!.topics).toEqual(["style", "naming"]);
    // Healthy manifests ⇒ no category-level warnings.
    expect(inv.manifests.warnings).toEqual([]);
  });

  test("analysis is pure file reads — zero mutation of the source tree", () => {
    const root = makeFullFixture(join(work, "tmpl"));
    const before = snapshotTree(root);
    analyzeTemplateSource(root);
    expect(snapshotTree(root)).toEqual(before);
  });

  test("classifier vocabularies are exported consts shared with consumers", () => {
    expect(PROCESS_CONFIG_FILES).toContain("CLAUDE.md");
    expect(PROCESS_CONFIG_FILES).toContain(".claude/settings.json");
    expect(PROCESS_CONFIG_FILES).toContain(".mcp.json");
    expect(PROCESS_CONFIG_FILES.some((f) => f.includes("hook"))).toBe(true);
    expect(SCAFFOLDING_CONFIG_NAMES).toContain("package.json");
    expect(SCAFFOLDING_CONFIG_NAMES).toContain("tsconfig.json");
    // The two vocabularies are disjoint — a name never classifies twice.
    for (const name of SCAFFOLDING_CONFIG_NAMES) {
      expect(PROCESS_CONFIG_FILES).not.toContain(name);
    }
  });
});

describe("analyzeTemplateSource — wholeProjectCandidate (AC-STE-468.1, AC-STE-468.4)", () => {
  test("a fully-populated template flags wholeProjectCandidate true", () => {
    const root = makeFullFixture(join(work, "tmpl"));
    const inv = analyzeTemplateSource(root);
    expect(inv.wholeProjectCandidate).toBe(true);
  });

  test("a sparse directory with no reusable categories flags wholeProjectCandidate false", () => {
    const root = join(work, "sparse");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "data.txt"), "just a data file\n");
    const inv = analyzeTemplateSource(root);
    expect(inv.wholeProjectCandidate).toBe(false);
  });
});

describe("analyzeTemplateSource — sourceRoot validation (AC-STE-468.2)", () => {
  test("a missing sourceRoot refuses in NFR-10 canonical shape", () => {
    const missing = join(work, "does-not-exist");
    let err: Error | undefined;
    try {
      analyzeTemplateSource(missing);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/Refusing:/);
    expect(err!.message).toMatch(/Remedy:/);
    expect(err!.message).toMatch(/Context:/);
  });

  test("a non-directory sourceRoot refuses in NFR-10 canonical shape", () => {
    const filePath = join(work, "a-file.txt");
    writeFileSync(filePath, "not a directory\n");
    let err: Error | undefined;
    try {
      analyzeTemplateSource(filePath);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/Refusing:/);
    expect(err!.message).toMatch(/Remedy:/);
    expect(err!.message).toMatch(/Context:/);
  });

  test("a non-git directory is a legal template source and records isGitRepo false", () => {
    const root = makeFullFixture(join(work, "no-git"), { git: false });
    const inv = analyzeTemplateSource(root);
    expect(inv.isGitRepo).toBe(false);
    // The analysis still ran to completion — categories populated as usual.
    expect(inv.processConfig.files).toContain("CLAUDE.md");
  });

  test("a git directory records isGitRepo true (no git subprocess needed)", () => {
    const root = makeFullFixture(join(work, "with-git"));
    const inv = analyzeTemplateSource(root);
    expect(inv.isGitRepo).toBe(true);
  });
});

describe("analyzeTemplateSource — malformed manifests (AC-STE-468.3)", () => {
  test("malformed deps.yaml surfaces a category-level warning, never a hard failure", () => {
    const root = makeFullFixture(join(work, "bad-deps"), { depsYaml: MALFORMED_DEPS_YAML });
    const inv = analyzeTemplateSource(root);
    // Not a silent drop: the warning names the file and carries the
    // manifest module's own refusal reason (delegation pin).
    expect(inv.manifests.warnings.length).toBe(1);
    expect(inv.manifests.warnings[0]).toContain("deps.yaml");
    expect(inv.manifests.warnings[0]).toContain("missing required field `kind`");
    // The broken manifest contributes no rows...
    expect(inv.manifests.deps).toEqual([]);
    // ...but the healthy twin still parses — the whole analysis survives.
    expect(inv.manifests.bestPractices.map((e) => e.name)).toEqual(["style-guide"]);
    expect(inv.processConfig.files).toContain("CLAUDE.md");
  });

  test("malformed best-practices.yaml surfaces a category-level warning, never a hard failure", () => {
    const root = makeFullFixture(join(work, "bad-bp"), {
      bestPracticesYaml: MALFORMED_BEST_PRACTICES_YAML,
    });
    const inv = analyzeTemplateSource(root);
    expect(inv.manifests.warnings.length).toBe(1);
    expect(inv.manifests.warnings[0]).toContain("best-practices.yaml");
    expect(inv.manifests.warnings[0]).toContain("unknown field `bogus_key`");
    expect(inv.manifests.bestPractices).toEqual([]);
    // The healthy twin still parses.
    expect(inv.manifests.deps.map((e) => e.name)).toEqual(["sibling-docs"]);
  });

  test("both manifests absent is legal — empty rows, no warnings", () => {
    const root = makeFullFixture(join(work, "no-manifests"), {
      depsYaml: null,
      bestPracticesYaml: null,
    });
    const inv = analyzeTemplateSource(root);
    expect(inv.manifests.deps).toEqual([]);
    expect(inv.manifests.bestPractices).toEqual([]);
    expect(inv.manifests.warnings).toEqual([]);
  });
});

describe("analyzeTemplateSource — CLI shim (the boundary the setup-template child invokes)", () => {
  const MODULE = join(import.meta.dir, "template_source_analyzer.ts");

  test("success: JSON inventory on stdout, exit 0, silent stderr", () => {
    const root = makeFullFixture(join(work, "cli-ok"));
    const res = Bun.spawnSync(["bun", "run", MODULE, root]);
    expect(res.exitCode).toBe(0);
    const inv = JSON.parse(res.stdout.toString());
    expect(inv.processConfig.files).toContain("CLAUDE.md");
    expect(inv.wholeProjectCandidate).toBe(true);
    expect(res.stderr.toString()).toBe("");
  });

  test("missing argument: NFR-10 refusal on stderr, exit 2, no stdout", () => {
    const res = Bun.spawnSync(["bun", "run", MODULE]);
    expect(res.exitCode).toBe(2);
    const err = res.stderr.toString();
    expect(err).toContain("Refusing: missing <source-root> argument");
    expect(err).toContain("Remedy:");
    expect(res.stdout.toString()).toBe("");
  });

  test("non-directory root: refusal verbatim on stderr, exit 2, no stdout", () => {
    const file = join(work, "not-a-dir.txt");
    writeFileSync(file, "flat\n");
    const res = Bun.spawnSync(["bun", "run", MODULE, file]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr.toString()).toContain("Refusing:");
    expect(res.stdout.toString()).toBe("");
  });
});

describe("analyzeTemplateSource — hardening: dangling symlinks in a foreign tree", () => {
  test("dangling symlinks at top level and inside a classified dir do not crash; healthy entries survive", () => {
    const root = makeFullFixture(join(work, "symlinked"));
    // Top-level dangling symlink — hits the sourcePatterns readdir filter.
    symlinkSync(join(root, "no-such-target"), join(root, "ghost"));
    // Dangling symlink inside a directory-classified scaffolding entry.
    symlinkSync(
      join(root, ".github", "workflows", "no-such-workflow.yml"),
      join(root, ".github", "workflows", "dangling.yml"),
    );
    const inv = analyzeTemplateSource(root);
    // Dangling entries are skipped, never listed.
    expect(inv.sourcePatterns.dirs).not.toContain("ghost");
    expect(inv.scaffolding.files).not.toContain(".github/workflows/dangling.yml");
    // Healthy neighbors still classify.
    expect(inv.sourcePatterns.dirs).toEqual(["lib", "src"]);
    expect(inv.scaffolding.files).toContain(".github/workflows/ci.yml");
  });
});
