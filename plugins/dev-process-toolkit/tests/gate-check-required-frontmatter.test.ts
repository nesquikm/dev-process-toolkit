import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// STE-82 AC-STE-82.2 + AC-STE-82.7 — gate-check probe #2 integration test.
//
// STE-321 (M84) AC-STE-321.7 — split semantics:
//   - mode-invariant REQUIRED keys: `title`, `milestone`, `status`,
//     `archived_at`, `created_at` (5 keys).
//   - tracker-mode-only requirement: `tracker:` present + populated.
//   - mode-none-only requirement: `tracker:` ABSENT (paired with mode-none's
//     `id: fr_<26-char ULID>`).
//
// `id:` is owned by probe #13 `identity_mode_conditional` and is asserted
// there, not here. The probe note shape for missing keys follows
// `file:field — missing` per AC-STE-82.7.

const MODE_INVARIANT_REQUIRED_KEYS = [
  "title",
  "milestone",
  "status",
  "archived_at",
  "created_at",
] as const;

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function missingModeInvariantKeys(frontmatter: Record<string, unknown>): string[] {
  return MODE_INVARIANT_REQUIRED_KEYS.filter((k) => !(k in frontmatter));
}

// Tracker-mode canonical fixture (post-STE-76) — carries `tracker:` block.
const GOOD_TRACKER_FR = `---
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

// Mode-none canonical fixture (post-STE-321) — NO `tracker:` block.
const GOOD_MODE_NONE_FR = `---
id: fr_01KPWPMA9TKSYYBNCQ3TAYM9C2
title: Sample mode-none FR
milestone: M22
status: active
archived_at: null
created_at: 2026-04-24T07:53:16Z
---

Body.
`;

describe("STE-82/STE-321 prose — /gate-check probe 2 is documented in SKILL.md", () => {
  test("SKILL.md names the Required frontmatter fields probe", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Required frontmatter fields/);
  });

  test("probe enumerates the 5 mode-invariant required keys (NOT `tracker`)", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Required frontmatter fields");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 800);
    for (const key of MODE_INVARIANT_REQUIRED_KEYS) {
      expect(block).toContain("`" + key + "`");
    }
    // The mode-invariant declaration sentence must NOT mention `tracker`
    // (it's now mode-conditional per AC-STE-321.4).
    const sentenceMatch = block.match(/mode-invariant Schema Q keys[^.]*\./);
    expect(sentenceMatch).not.toBeNull();
    expect(sentenceMatch![0]).not.toContain("`tracker`");
  });

  test("probe documents `tracker:` as mode-conditional, deferred to probe #13", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Required frontmatter fields");
    const block = body.slice(probeIdx, probeIdx + 1000);
    expect(block).toMatch(/`tracker`.*mode-conditional|mode-conditional.*`tracker`/);
    expect(block).toMatch(/identity_mode_conditional/);
  });

  test("probe emits GATE FAILED with file + field on missing key", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.indexOf("Required frontmatter fields");
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 400);
    expect(block).toContain("GATE FAILED");
    expect(block).toMatch(/file and field|file.*field/i);
  });
});

describe("STE-82/STE-321 — tracker-mode fixture invariants", () => {
  test("POSITIVE: fully-populated tracker-mode FR has zero missing mode-invariant keys", () => {
    const fm = parseFrontmatter(GOOD_TRACKER_FR);
    expect(missingModeInvariantKeys(fm)).toEqual([]);
  });

  test("POSITIVE: tracker-mode FR has `tracker:` present and populated", () => {
    const fm = parseFrontmatter(GOOD_TRACKER_FR);
    expect("tracker" in fm).toBe(true);
    const tracker = fm["tracker"] as Record<string, unknown> | null | undefined;
    expect(tracker).not.toBeNull();
    expect(tracker).toBeDefined();
    expect(Object.keys(tracker!).length).toBeGreaterThan(0);
  });

  test("NEGATIVE: FR missing `archived_at` reports exactly that gap", () => {
    const noArchived = GOOD_TRACKER_FR.replace(/^archived_at: null\n/m, "");
    const fm = parseFrontmatter(noArchived);
    expect(missingModeInvariantKeys(fm)).toContain("archived_at");
    expect(missingModeInvariantKeys(fm).length).toBe(1);
  });

  test("NEGATIVE: tracker-mode FR missing `tracker:` violates the mode-conditional invariant", () => {
    // tracker: is no longer in the mode-invariant set, but its absence in a
    // tracker-mode FR is still a violation — owned by probe #13.
    const noTracker = GOOD_TRACKER_FR.replace(/^tracker:\n  linear: STE-77\n/m, "");
    const fm = parseFrontmatter(noTracker);
    // Mode-invariant scan still passes — `tracker` is no longer in the set.
    expect(missingModeInvariantKeys(fm)).toEqual([]);
    // But the tracker block is gone — probe #13 will catch this.
    expect("tracker" in fm).toBe(false);
  });

  test("NEGATIVE: FR with empty frontmatter reports all 5 mode-invariant keys missing", () => {
    const empty = `---\n---\n\nBody.\n`;
    const fm = parseFrontmatter(empty, { lenient: true });
    const gaps = missingModeInvariantKeys(fm);
    expect(gaps.length).toBe(MODE_INVARIANT_REQUIRED_KEYS.length);
    // AC-STE-82.7 note shape — render one example.
    const exampleNote = `specs/frs/bad.md:1 — missing field \`${gaps[0]}\``;
    expect(exampleNote).toMatch(/^specs\/frs\/.*:\d+ — missing field `\w+`$/);
  });
});

describe("STE-321 AC-STE-321.7 — mode-none fixture invariants", () => {
  test("POSITIVE: mode-none FR has zero missing mode-invariant keys", () => {
    const fm = parseFrontmatter(GOOD_MODE_NONE_FR);
    expect(missingModeInvariantKeys(fm)).toEqual([]);
  });

  test("POSITIVE: mode-none FR has `tracker:` ABSENT (paired with `id:` present)", () => {
    const fm = parseFrontmatter(GOOD_MODE_NONE_FR);
    expect("tracker" in fm).toBe(false);
    expect("id" in fm).toBe(true);
  });

  test("NEGATIVE: mode-none FR carrying a stray `tracker:` block violates the invariant", () => {
    // Under STE-321 AC.5, mode-none MUST NOT carry a `tracker:` line.
    // The mode-invariant required-key scan does not fire; probe #13 owns
    // this bidirectional invariant. This test pins the contract by asserting
    // the mode-invariant scan stays silent and the tracker key is detectable
    // by downstream callers (probe #13).
    const stray = GOOD_MODE_NONE_FR.replace(
      /^---\n/,
      "---\ntracker:\n  linear: STE-9999\n",
    );
    const fm = parseFrontmatter(stray);
    expect(missingModeInvariantKeys(fm)).toEqual([]);
    expect("tracker" in fm).toBe(true);
  });
});

describe("AC-STE-139.5 — required-frontmatter runs clean on this repo's baseline", () => {
  test("every active FR carries the 5 mode-invariant Schema Q keys", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const repoFrsDir = join(import.meta.dir, "..", "..", "..", "specs", "frs");
    const gaps: string[] = [];
    for (const name of readdirSync(repoFrsDir)) {
      const path = join(repoFrsDir, name);
      if (!statSync(path).isFile() || !name.endsWith(".md")) continue;
      const fm = parseFrontmatter(readFileSync(path, "utf-8"), { lenient: true });
      for (const key of MODE_INVARIANT_REQUIRED_KEYS) {
        if (!(key in fm)) gaps.push(`${name}:${key}`);
      }
    }
    expect(gaps).toEqual([]);
  });
});
