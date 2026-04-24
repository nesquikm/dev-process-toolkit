import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// STE-82 AC-STE-82.2 + AC-STE-82.7 — gate-check probe #2 integration test.
//
// Probe 2 requires every active FR file under `specs/frs/*.md` to carry the
// mode-invariant Schema Q keys: `title`, `milestone`, `status`, `archived_at`,
// `tracker`, `created_at`. Missing a field → GATE FAILED naming the file +
// field.
//
// The `id:` key is handled by probe #13 `identity_mode_conditional` (STE-86
// AC-STE-86.5) because its presence/absence is mode-conditional post-STE-76:
// required in `mode: none`, absent in tracker mode.
//
// Positive fixture: a fully-populated tracker-mode FR body parses cleanly and
// exposes all 6 mode-invariant keys.
// Negative fixture: an FR body missing any one required key reports the
// specific gap; the probe would emit a `file:field — missing` note.

const REQUIRED_KEYS = [
  "title",
  "milestone",
  "status",
  "archived_at",
  "tracker",
  "created_at",
] as const;

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function missingKeys(frontmatter: Record<string, unknown>): string[] {
  return REQUIRED_KEYS.filter((k) => !(k in frontmatter));
}

// Tracker-mode canonical fixture (post-STE-76) — no `id:` line.
const GOOD_FR = `---
title: Sample FR
milestone: M22
status: active
archived_at: null
tracker:
  linear: STE-77
created_at: 2026-04-24T07:53:16Z
---

Body.
`;

describe("STE-82 AC-STE-82.2 prose — /gate-check probe 2 is documented in SKILL.md", () => {
  test("SKILL.md names the Required frontmatter fields probe", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Required frontmatter fields/);
  });

  test("probe enumerates all 6 mode-invariant required keys", () => {
    const body = read(gateCheckSkillPath);
    for (const key of REQUIRED_KEYS) {
      expect(body).toContain(`\`${key}\``);
    }
  });

  test("probe emits GATE FAILED with file + field on missing key", () => {
    const body = read(gateCheckSkillPath);
    // Locate probe block, verify verdict language.
    const probeIdx = body.indexOf("Required frontmatter fields");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 300);
    expect(block).toContain("GATE FAILED");
    expect(block).toMatch(/file and field|file.*field/i);
  });
});

describe("STE-82 AC-STE-82.2/7 — required-frontmatter fixtures (positive + negative)", () => {
  test("POSITIVE: fully-populated FR has zero missing keys", () => {
    const fm = parseFrontmatter(GOOD_FR);
    expect(missingKeys(fm)).toEqual([]);
  });

  test("NEGATIVE: FR missing `archived_at` reports exactly that gap", () => {
    const noArchived = GOOD_FR.replace(/^archived_at: null\n/m, "");
    const fm = parseFrontmatter(noArchived);
    expect(missingKeys(fm)).toContain("archived_at");
    expect(missingKeys(fm).length).toBe(1);
  });

  test("NEGATIVE: FR missing `tracker` reports exactly that gap", () => {
    const noTracker = GOOD_FR.replace(/^tracker:\n  linear: STE-77\n/m, "");
    const fm = parseFrontmatter(noTracker);
    expect(missingKeys(fm)).toContain("tracker");
  });

  test("NEGATIVE: FR with empty frontmatter reports all 6 mode-invariant keys missing", () => {
    const empty = `---\n---\n\nBody.\n`;
    const fm = parseFrontmatter(empty, { lenient: true });
    // The probe note shape follows `file:field — reason`; each missing key
    // would be its own note.
    const gaps = missingKeys(fm);
    expect(gaps.length).toBe(REQUIRED_KEYS.length);
    // AC-STE-82.7 note shape — render one example.
    const exampleNote = `specs/frs/bad.md:1 — missing field \`${gaps[0]}\``;
    expect(exampleNote).toMatch(/^specs\/frs\/.*:\d+ — missing field `\w+`$/);
  });
});
