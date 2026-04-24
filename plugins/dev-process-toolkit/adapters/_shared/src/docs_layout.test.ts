// Unit tests for ensureCanonicalLayout (STE-69 AC-STE-69.1, .4, .7).
//
// Covers: (a) empty project gets the full Diátaxis tree, (b) partial tree
// gets gaps filled without overwrites (idempotency invariant), (c) mixed-
// mode config produces reference/api/ subtree, (d) user-facing-only config
// omits reference/api/.
//
// Tests provide their own templates dir so the shape of the real shipped
// templates is not baked into the layout unit; docs_nav_contract.test.ts
// covers the README anchor contract separately.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCanonicalLayout, type DocsConfig } from "./docs_layout";

let work: string;
let projectRoot: string;
let templatesDir: string;

const README_TEMPLATE = `# Docs

## Tutorials {#tutorials}

See [tutorials/](tutorials/).

## How-to guides {#how-to}

See [how-to/](how-to/).

## Reference {#reference}

See [reference/](reference/).

## Explanation {#explanation}

See [explanation/architecture.md](explanation/architecture.md).
`;
const ARCHITECTURE_TEMPLATE = `# Architecture\n\nStub for {{project}}.\n`;
const GETTING_STARTED_TEMPLATE = `# Getting Started\n\nStub.\n`;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-layout-"));
  projectRoot = join(work, "project");
  templatesDir = join(work, "templates");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });
  writeFileSync(join(templatesDir, "docs-README.md.template"), README_TEMPLATE);
  writeFileSync(join(templatesDir, "docs-architecture.md.template"), ARCHITECTURE_TEMPLATE);
  writeFileSync(join(templatesDir, "docs-getting-started.md.template"), GETTING_STARTED_TEMPLATE);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const userFacingOnly: DocsConfig = {
  userFacingMode: true,
  packagesMode: false,
  changelogCiOwned: false,
};
const packagesOnly: DocsConfig = {
  userFacingMode: false,
  packagesMode: true,
  changelogCiOwned: false,
};
const mixed: DocsConfig = {
  userFacingMode: true,
  packagesMode: true,
  changelogCiOwned: false,
};

describe("ensureCanonicalLayout", () => {
  test("AC-STE-69.1 — empty project gets the full canonical tree", () => {
    const report = ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);

    // Directories.
    expect(existsSync(join(projectRoot, "docs"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/tutorials"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/how-to"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/reference"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/explanation"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/.pending"))).toBe(true);

    // Seed files.
    expect(existsSync(join(projectRoot, "docs/README.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/tutorials/getting-started.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/explanation/architecture.md"))).toBe(true);

    // .gitkeep in otherwise-empty directories.
    expect(existsSync(join(projectRoot, "docs/how-to/.gitkeep"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/reference/.gitkeep"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/.pending/.gitkeep"))).toBe(true);

    // Report lists what got created.
    expect(report.created.length).toBeGreaterThan(0);
    expect(report.existing).toEqual([]);
  });

  test("AC-STE-69.1/.4 — mixed-mode config seeds reference/api/.gitkeep instead of reference/.gitkeep", () => {
    ensureCanonicalLayout(projectRoot, mixed, templatesDir);

    expect(existsSync(join(projectRoot, "docs/reference/api"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/reference/api/.gitkeep"))).toBe(true);
    // reference/ is non-empty (contains api/), so its own .gitkeep is omitted.
    expect(existsSync(join(projectRoot, "docs/reference/.gitkeep"))).toBe(false);
  });

  test("AC-STE-69.1 — packages-only config seeds reference/api/.gitkeep", () => {
    ensureCanonicalLayout(projectRoot, packagesOnly, templatesDir);

    expect(existsSync(join(projectRoot, "docs/reference/api/.gitkeep"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/reference/.gitkeep"))).toBe(false);
  });

  test("AC-STE-69.1 — user-facing-only config omits reference/api/", () => {
    ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);

    expect(existsSync(join(projectRoot, "docs/reference/api"))).toBe(false);
    expect(existsSync(join(projectRoot, "docs/reference/.gitkeep"))).toBe(true);
  });

  test("AC-STE-69.7 — idempotent: second run creates nothing new", () => {
    ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);
    const second = ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);

    expect(second.created).toEqual([]);
    expect(second.existing.length).toBeGreaterThan(0);
  });

  test("AC-STE-69.7 — never overwrites existing files (user-edited content preserved)", () => {
    mkdirSync(join(projectRoot, "docs/tutorials"), { recursive: true });
    const userEdited = "# My Custom Getting Started\n\nThis is user content.\n";
    writeFileSync(join(projectRoot, "docs/tutorials/getting-started.md"), userEdited);

    ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);

    const after = readFileSync(join(projectRoot, "docs/tutorials/getting-started.md"), "utf8");
    expect(after).toBe(userEdited);
  });

  test("AC-STE-69.7 — partial tree gets gaps filled without overwrites", () => {
    // Pre-create docs/ with README.md present but tutorials/ empty.
    mkdirSync(join(projectRoot, "docs"), { recursive: true });
    writeFileSync(join(projectRoot, "docs/README.md"), "# Existing Readme\n");

    const report = ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);

    // README preserved, not overwritten.
    expect(readFileSync(join(projectRoot, "docs/README.md"), "utf8")).toBe("# Existing Readme\n");
    // Missing pieces filled.
    expect(existsSync(join(projectRoot, "docs/tutorials/getting-started.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "docs/.pending/.gitkeep"))).toBe(true);
    // Report should list README under existing, not created.
    expect(report.existing).toContain("docs/README.md");
    expect(report.created).not.toContain("docs/README.md");
  });

  test("LayoutReport reports relative paths, not absolute", () => {
    const report = ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);
    for (const p of report.created) {
      expect(p.startsWith("/")).toBe(false);
      expect(p === "docs" || p.startsWith("docs/")).toBe(true);
    }
  });

  test("templates with substitution tokens are rendered (project name)", () => {
    ensureCanonicalLayout(projectRoot, userFacingOnly, templatesDir);
    const arch = readFileSync(join(projectRoot, "docs/explanation/architecture.md"), "utf8");
    // The ARCHITECTURE_TEMPLATE above carries `{{project}}` — it should be
    // replaced with the basename of projectRoot ("project") after rendering.
    expect(arch).toContain("Stub for project.");
    expect(arch).not.toContain("{{project}}");
  });
});
