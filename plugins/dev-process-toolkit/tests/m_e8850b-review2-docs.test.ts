// M_e8850b review 2, F4 — adding `jira_bug_type_standard` raises the settings floor.
//
// The settings move raises the top-level `min_dpt_version` when the key is
// present, because an older client refuses an unknown key. A person who adds
// the key by hand must do the same, so the docs that describe the key say so.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const KEY = "jira_bug_type_standard";
const MOVE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "migrations", "entries", "settings_file.ts");

/** The floor the settings move writes when a Jira key from that release is present. */
function codeFloor(): string {
  const src = readFileSync(MOVE, "utf8");
  const keys = /const JIRA_SITE_KEYS = \[([^\]]*)\]/.exec(src);
  expect(keys, "settings_file.ts declares JIRA_SITE_KEYS").not.toBeNull();
  expect(keys![1]).toContain(`"${KEY}"`);
  const floor = /const JIRA_SITE_KEYS_FLOOR = "(\d+\.\d+\.\d+)";/.exec(src);
  expect(floor, "settings_file.ts declares JIRA_SITE_KEYS_FLOOR").not.toBeNull();
  return floor![1]!;
}

/** The prose paragraphs of a doc that name the key; table rows are left out. */
function paragraphsNaming(rel: string): string[] {
  return readFileSync(join(PLUGIN_ROOT, rel), "utf8")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").filter((l) => !l.trimStart().startsWith("|")).join("\n"))
    .filter((p) => p.includes(KEY));
}

describe("F4 — the docs say to raise min_dpt_version when jira_bug_type_standard is added", () => {
  for (const rel of ["docs/settings-reference.md", "adapters/jira.md"]) {
    test(`${rel}: a paragraph naming the key says an older client refuses it and names the floor to raise`, () => {
      const floor = codeFloor();
      const hits = paragraphsNaming(rel).filter(
        (p) =>
          /`min_dpt_version`/.test(p) &&
          p.includes(floor) &&
          /\brais(?:e|ed|ing)\b/i.test(p) &&
          /\bolder\b[\s\S]{0,200}\brefuse|\brefuse[\s\S]{0,200}\bolder\b/i.test(p),
      );
      expect(hits.length, `${rel} has no such paragraph`).toBeGreaterThan(0);
    });
  }

  test("adapters/jira.md: the floor sentence sits in the bug-type paragraph, next to `jira_bug_type_standard: true`", () => {
    const para = paragraphsNaming("adapters/jira.md").find((p) => p.includes(`${KEY}: true`));
    expect(para).toBeDefined();
    expect(para!).toMatch(/`min_dpt_version`/);
    expect(para!).toContain(codeFloor());
  });
});
