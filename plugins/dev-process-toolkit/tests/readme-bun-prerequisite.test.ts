// Doc-conformance tests for STE-337 — bun as a universal prerequisite.
//
// AC-STE-337.1: README.md gains a `## Prerequisites` section (near "Install as
//   Plugin") stating bun must be installed because the toolkit's
//   `adapters/_shared` helpers + tracker adapters run on bun via `bun run`,
//   regardless of the consumer's own stack; includes the `https://bun.sh`
//   install pointer and a `bun --version` verification line.
// AC-STE-337.2: the existing tracker-mode bun mention is reconciled to point at
//   the universal Prerequisites section as canonical (promote-and-widen); no
//   surviving "bun ... only ... tracker" framing remains.
// AC-STE-337.3: the Prerequisites text scopes the claim to the toolkit's own
//   machinery — it does NOT assert the consumer must rewrite in TypeScript or
//   adopt bun for their own gates (a Flutter project still gates via
//   `fvm flutter`).
//
// All assertions are RED until the docs are authored.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const PLUGIN_ROOT = join(__dirname, "..");

const README = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
const TRACKER_DOC = readFileSync(
  join(PLUGIN_ROOT, "docs", "setup-tracker-mode.md"),
  "utf-8",
);

// Extract the body of the README `## Prerequisites` section: everything from
// the `## Prerequisites` heading up to (but not including) the next `## `
// heading (or end of file). Returns "" when the section is absent.
function prerequisitesSection(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s+Prerequisites\s*$/i.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("STE-337 AC-1 — README Prerequisites section documents bun universally", () => {
  test("README has a `## Prerequisites` heading", () => {
    expect(README).toMatch(/^##\s+Prerequisites\s*$/m);
  });

  test("Prerequisites section is positioned near the `Install as Plugin` section", () => {
    const prereqIdx = README.search(/^##\s+Prerequisites\s*$/m);
    const installIdx = README.search(/^##\s+Install as Plugin\s*$/m);
    expect(prereqIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(-1);
    // "Near" = within ~1200 chars of the Install as Plugin heading either way.
    expect(Math.abs(prereqIdx - installIdx)).toBeLessThan(1200);
  });

  test("section names bun as the required runtime", () => {
    const section = prerequisitesSection(README);
    expect(section.toLowerCase()).toContain("bun");
  });

  test("section grounds the requirement in `adapters/_shared` helpers", () => {
    const section = prerequisitesSection(README);
    expect(section).toMatch(/adapters\/_shared|_shared|helpers/);
  });

  test("section explains the helpers are invoked via `bun run`", () => {
    const section = prerequisitesSection(README);
    expect(section).toMatch(/bun run/);
  });

  test("section scopes the requirement as universal / stack-independent", () => {
    const section = prerequisitesSection(README);
    expect(section).toMatch(/regardless|stack-independent|any stack/i);
  });

  test("section carries the https://bun.sh install pointer", () => {
    const section = prerequisitesSection(README);
    expect(section).toContain("https://bun.sh");
  });

  test("section carries a `bun --version` verification line", () => {
    const section = prerequisitesSection(README);
    expect(section).toContain("bun --version");
  });
});

describe("STE-337 AC-2 — tracker-mode bun mention reconciled to the universal section", () => {
  test("setup-tracker-mode.md cross-references the universal Prerequisites concept", () => {
    // RED-until-authored: a cross-link to the canonical universal section.
    expect(TRACKER_DOC).toMatch(/universal|README.*Prerequisites|Prerequisites section/);
  });

  test("no surviving `bun ... only ... tracker` narrow-scoping framing remains", () => {
    // Absence assertion: designed to be RED only if such narrow framing were
    // present. None exists today, so this passes now and must keep passing.
    const narrow = /bun[^.]*only[^.]*tracker/i;
    expect(README).not.toMatch(narrow);
    expect(TRACKER_DOC).not.toMatch(narrow);
  });
});

describe("STE-337 AC-3 — Prerequisites text scopes the claim to the toolkit's machinery", () => {
  test("section limits the claim and does not demand the consumer adopt bun for their own gates", () => {
    const section = prerequisitesSection(README);
    expect(section).toMatch(
      /your (own )?(project|stack|gates)|toolkit's (own )?(helpers|machinery)|not.*rewrite|fvm flutter/i,
    );
  });
});
