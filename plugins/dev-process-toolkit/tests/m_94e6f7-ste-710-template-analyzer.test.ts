// STE-710 AC-STE-710.19 — the template analyzer inventories the settings file.
//
// Module under test: adapters/_shared/src/template_source_analyzer.ts.
// `PROCESS_CONFIG_FILES` gains `specs/settings.yaml`, so a 3.x template's
// settings file is offered with the other process config files; a 2.x
// template has none, so its inventory is unchanged.
//
// All names and paths are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { analyzeTemplateSource, PROCESS_CONFIG_FILES } from "../adapters/_shared/src/template_source_analyzer";

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste710-analyzer-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

const SETTINGS = 'schema_version: 1\nmin_dpt_version: "2.0.0"\n';

describe("AC-STE-710.19 the analyzer inventories the settings file", () => {
  test("AC-.19 PROCESS_CONFIG_FILES contains specs/settings.yaml", () => {
    expect(PROCESS_CONFIG_FILES).toContain("specs/settings.yaml");
  });

  test("AC-.19 a 3.x template that carries specs/settings.yaml lists it under processConfig", () => {
    const root = tree({ "CLAUDE.md": "# T\n", "specs/settings.yaml": SETTINGS });
    const inv = analyzeTemplateSource(root);
    expect(inv.processConfig.files).toContain("specs/settings.yaml");
    expect(inv.processConfig.files).toContain("CLAUDE.md");
    expect(inv.scaffolding.files).not.toContain("specs/settings.yaml");
  });

  test("AC-.19 a 2.x template with no settings file omits it, and its inventory is otherwise unchanged", () => {
    const root = tree({ "CLAUDE.md": "# T\n", ".mcp.json": "{}\n", "package.json": "{}\n", "src/index.ts": "export {};\n" });
    const inv = analyzeTemplateSource(root);
    expect(inv.processConfig.files).not.toContain("specs/settings.yaml");
    expect(inv.processConfig.files).toEqual(["CLAUDE.md", ".mcp.json"]);
    expect(inv.scaffolding.files).toEqual(["package.json"]);
    expect(inv.sourcePatterns.dirs).toEqual(["src"]);
  });
});
