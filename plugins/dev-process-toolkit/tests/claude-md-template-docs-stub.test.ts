import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SETTINGS_HEADING, projectSettingsSection, renderSettingsPointer } from "../adapters/_shared/src/project_settings";

// Regression guard for STE-68 AC-STE-68.6 + STE-107 AC-STE-107.5 — the three
// docs flags are advertised to a freshly set-up project with all-false
// defaults that `/setup` step 7d configures.
//
// Amended by M_94e6f7/STE-710 (AC-.9): the `## Docs` block left
// `templates/CLAUDE.md.template`; the flags are now the `docs.*` keys of
// `specs/settings.yaml`. The template advertises them through the
// `## Project Settings` pointer, and `docs/settings-reference.md` documents
// each key with its `false` default.

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");
const settingsReferencePath = join(pluginRoot, "docs", "settings-reference.md");

describe("STE-68 AC-STE-68.6 — the docs keys are documented in their settings-file home", () => {
  test("docs/settings-reference.md documents all three `docs.*` keys", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the keys moved from the template's `## Docs` block to `docs.*` in the settings file.
    const body = readFileSync(settingsReferencePath, "utf-8");
    expect(body).toContain("`docs.user_facing_mode`");
    expect(body).toContain("`docs.packages_mode`");
    expect(body).toContain("`docs.changelog_ci_owned`");
  });

  test("template carries a live `## Project Settings` heading holding the pointer (STE-107 AC-STE-107.5)", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the live `## Docs` heading is replaced by the `## Project Settings` pointer.
    const body = readFileSync(templatePath, "utf-8");
    expect(body.split("\n").findIndex((l) => l === PROJECT_SETTINGS_HEADING)).toBeGreaterThanOrEqual(0);
    expect(body.split("\n").findIndex((l) => l === "## Docs")).toBe(-1);
    const section = projectSettingsSection(body);
    expect(section).not.toBeNull();
    expect(`${section!.lines.join("\n")}\n`).toContain(renderSettingsPointer("3.0.0"));
  });

  test("all three flags default to lowercase literal `false`", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the `false` seeds moved from template lines to the settings-reference defaults.
    const body = readFileSync(settingsReferencePath, "utf-8");
    expect(body).toMatch(/^\| `docs\.user_facing_mode` \| boolean \| `false` \|/m);
    expect(body).toMatch(/^\| `docs\.packages_mode` \| boolean \| `false` \|/m);
    expect(body).toMatch(/^\| `docs\.changelog_ci_owned` \| boolean \| `false` \|/m);
  });
});
