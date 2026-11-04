// STE-689 (M_7a948e) — the `changelog_unversioned` `## Docs` flag.
//
// AC-STE-689.1: `readDocsConfig` reads the flag; absent key or section reads
// `false`; anything but lowercase `true`/`false` throws
// `MalformedDocsConfigError` naming the key.
//
// AC-STE-689.2: the docs-section probe's canonical key set names the flag, a
// CLAUDE.md declaring it passes that probe, and the CLAUDE.md template plus
// `docs/setup-reference.md` document it with default `false`.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MalformedDocsConfigError, readDocsConfig } from "../adapters/_shared/src/docs_config";
import { runClaudeMdDocsSectionProbe } from "../adapters/_shared/src/claudemd_docs_section";

const PLUGIN_ROOT = join(import.meta.dir, "..");

const dirs: string[] = [];
function writeClaudeMd(body: string): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "ste-689-docs-"));
  dirs.push(root);
  const path = join(root, "CLAUDE.md");
  writeFileSync(path, body);
  return { root, path };
}
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function docsBlock(extra: string): string {
  return [
    "# Project",
    "",
    "## Task Tracking",
    "",
    "mode: none",
    "",
    "## Docs",
    "",
    "user_facing_mode: false",
    "packages_mode: false",
    "changelog_ci_owned: false",
    extra,
    "",
  ].join("\n");
}

describe("AC-STE-689.1 — readDocsConfig reads changelog_unversioned", () => {
  test("`changelog_unversioned: true` reads true", () => {
    const { path } = writeClaudeMd(docsBlock("changelog_unversioned: true"));
    const cfg = readDocsConfig(path);
    expect(cfg.changelogUnversioned).toBe(true);
    // The other keys are unaffected by the new one.
    expect(cfg.changelogCiOwned).toBe(false);
    expect(cfg.userFacingMode).toBe(false);
  });

  test("`changelog_unversioned: false` reads false", () => {
    const { path } = writeClaudeMd(docsBlock("changelog_unversioned: false"));
    expect(readDocsConfig(path).changelogUnversioned).toBe(false);
  });

  test("absent key reads false (not undefined)", () => {
    const { path } = writeClaudeMd(docsBlock(""));
    expect(readDocsConfig(path).changelogUnversioned).toBe(false);
  });

  test("absent `## Docs` section reads false (not undefined)", () => {
    const { path } = writeClaudeMd("# Project\n\n## Task Tracking\n\nmode: none\n");
    expect(readDocsConfig(path).changelogUnversioned).toBe(false);
  });

  test("absent CLAUDE.md reads false (not undefined)", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-689-docs-none-"));
    dirs.push(root);
    expect(readDocsConfig(join(root, "CLAUDE.md")).changelogUnversioned).toBe(false);
  });

  test("a key outside `## Docs` is not read as the flag", () => {
    const body = docsBlock("") + "\n## Other\n\nchangelog_unversioned: true\n";
    const { path } = writeClaudeMd(body);
    expect(readDocsConfig(path).changelogUnversioned).toBe(false);
  });

  for (const bad of ["True", "TRUE", "yes", "no", "1", "\"true\""]) {
    test(`malformed value ${JSON.stringify(bad)} throws MalformedDocsConfigError naming the key`, () => {
      const { path } = writeClaudeMd(docsBlock(`changelog_unversioned: ${bad}`));
      let caught: unknown;
      try {
        readDocsConfig(path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MalformedDocsConfigError);
      const err = caught as MalformedDocsConfigError;
      expect(err.key).toBe("changelog_unversioned");
      expect(err.value).toBe(bad);
      expect(err.message).toContain("changelog_unversioned");
    });
  }
});

describe("AC-STE-689.2 — the docs-section probe and the docs know the key", () => {
  test("a managed CLAUDE.md declaring `changelog_unversioned: true` passes the probe", async () => {
    const { root } = writeClaudeMd(docsBlock("changelog_unversioned: true"));
    const report = await runClaudeMdDocsSectionProbe(root);
    expect(report.violations).toEqual([]);
  });

  test("the probe's canonical key set (named in its remedy) includes changelog_unversioned", async () => {
    // A managed tree (real `## Task Tracking`) with no `## Docs` → one violation
    // whose remedy enumerates the canonical keys.
    const { root } = writeClaudeMd("# Project\n\n## Task Tracking\n\nmode: none\n");
    const report = await runClaudeMdDocsSectionProbe(root);
    expect(report.violations.length).toBe(1);
    const remedy = report.violations[0]!.message.split("\n").find((l) => l.startsWith("Remedy:"));
    expect(remedy).toBeDefined();
    for (const key of ["user_facing_mode", "packages_mode", "changelog_ci_owned", "changelog_unversioned"]) {
      expect(remedy!).toContain(key);
    }
  });

  /** docs/settings-reference.md § `docs` — the home the template's `## Project Settings` pointer leads to. */
  const settingsDocsSection = (): string => {
    const ref = readFileSync(join(PLUGIN_ROOT, "docs", "settings-reference.md"), "utf-8");
    const start = ref.indexOf("### `docs`");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = ref.indexOf("\n### ", start + 1);
    return end < 0 ? ref.slice(start) : ref.slice(start, end);
  };

  test("the docs keys /setup writes are only the three flags it sets", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the emitted `## Docs` block left the template; /setup writes the
    // `docs` keys to specs/settings.yaml, and settings-reference § docs names exactly the three it writes.
    const tpl = readFileSync(join(PLUGIN_ROOT, "templates", "CLAUDE.md.template"), "utf-8");
    expect(tpl).not.toMatch(/^## Docs\s*$/m);
    expect(tpl).toContain("specs/settings.yaml");
    const writes = settingsDocsSection().split("\n").find((l) => l.startsWith("`/setup` writes these three flags:"));
    expect(writes).toBeDefined();
    expect(writes!).not.toMatch(/changelog_unversioned/);
    expect(writes!.match(/`docs\.[a-z_]+`/g)).toEqual([
      "`docs.user_facing_mode`",
      "`docs.packages_mode`",
      "`docs.changelog_ci_owned`",
    ]);
  });

  test("the settings reference documents the key as optional, default false, outside the written list", () => {
    // Amended by M_94e6f7/STE-710 (AC-.9): the template's Docs comment moved to settings-reference § docs.
    const tpl = readFileSync(join(PLUGIN_ROOT, "templates", "CLAUDE.md.template"), "utf-8");
    expect(tpl).not.toContain("changelog_unversioned");
    const section = settingsDocsSection();
    const optionalIdx = section.indexOf("Optional key, not written by `/setup`:");
    expect(optionalIdx).toBeGreaterThan(0);
    const optional = section.slice(optionalIdx);
    expect(optional).toMatch(/`docs\.changelog_unversioned` \(default `false`;/);
    expect(optional).toMatch(/absent reads `false`/);
    expect(optional).toMatch(/by hand when git tags or CI own the version/);
  });

  test("docs/setup-reference.md documents the key with default false, outside the block /setup writes", () => {
    const ref = readFileSync(join(PLUGIN_ROOT, "docs", "setup-reference.md"), "utf-8");
    // /setup writes only the three prompted flags; the key is added by hand.
    expect(ref).not.toMatch(/^changelog_unversioned: <true\|false>$/m);
    expect(ref).toMatch(/`\/setup` neither prompts for nor writes `changelog_unversioned`/);
    const paragraphs = ref.split(/\n\s*\n/).filter((p) => p.includes("changelog_unversioned"));
    const documentsDefault = paragraphs.some((p) => /default/i.test(p) && /\bfalse\b/.test(p));
    expect(documentsDefault).toBe(true);
  });
});
