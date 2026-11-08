// STE-716 (M_7bc805) AC.13 + AC.22 — the Out of Scope supersession and the
// STE-289 / STE-285 supersession notes.
//
// Baseline for every "unchanged" byte: the v3.0.0 merge commit (6c62b32c), the
// milestone base.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT, REPO_ROOT, atV300 } from "./_m_7bc805_gate_outcome_fixture";

const OLD_LINE = "- No hooks/bin/.lsp.json in the plugin";
const NEW_LINE =
  "- ~~No hooks/bin/.lsp.json in the plugin~~ — superseded in v3.1.0: hooks ship in hooks/hooks.json since STE-289, and v3.1.0 adds an opt-in tool-call capture hook that only an approved settings change registers. bin/ and .lsp.json stay out of scope.";

/** The lines of `## 5. Out of Scope`, heading through the line before the next `## `. */
function sectionFive(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === "## 5. Out of Scope");
  expect(start).toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

describe("AC-STE-716.13 the Out of Scope hooks line is struck", () => {
  const base = sectionFive(atV300("specs/requirements.md"));
  const now = sectionFive(readFileSync(join(REPO_ROOT, "specs", "requirements.md"), "utf-8"));

  test("the base carries the hooks line exactly once (guards a vacuous row)", () => {
    expect(base.filter((l) => l === OLD_LINE).length).toBe(1);
  });

  // Amended by operator ruling 2026-11-06 (AC-STE-716.13): the note names the release only, never a milestone id.
  test("§ 5 carries the hooks line struck inside ~~ markers, then a note naming v3.1.0 and no milestone id", () => {
    const line = now.find((l) => l.includes("~~No hooks/bin/.lsp.json in the plugin~~"));
    expect(line).toBeDefined();
    expect(line!).toBe(NEW_LINE);
    const after = line!.slice(line!.indexOf("~~", 4) + 2);
    expect(after).toContain("v3.1.0");
    expect(after).not.toMatch(/\bM(?:_[0-9A-Za-z_]+|\d+)\b/);
  });

  test("bin/ and .lsp.json both appear after the strike as still out of scope", () => {
    const line = now.find((l) => l.includes("~~No hooks/bin/.lsp.json in the plugin~~"))!;
    const after = line.slice(line.indexOf("~~", 4) + 2);
    expect(after).toContain("bin/");
    expect(after).toContain(".lsp.json");
    expect(after).toMatch(/stay out of scope/);
  });

  test("every other line of § 5 is byte-identical to the milestone base", () => {
    // Amended by AC-STE-718.8 (M_d1b4b7): the three lines STE-718 rewrites are graded by m_d1b4b7-ste-718-out-of-scope.test.ts.
    const rewritten = (l: string) =>
      l.startsWith("- ") && ["No new slash commands", "No fast-track workflow", "No multi-agent orchestration"].some((s) => l.includes(s));
    expect(now.filter((l) => !rewritten(l))).toEqual(base.filter((l) => !rewritten(l)).map((l) => (l === OLD_LINE ? NEW_LINE : l)));
  });
});

/** The text `inserted` such that `after` = `before` with `inserted` spliced in at one point; null otherwise. */
function pureInsertion(before: string, after: string): string | null {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  if (p + s !== before.length) return null;
  return after.slice(p, after.length - s);
}

describe("AC-STE-716.22 the STE-289 and STE-285 supersession notes", () => {
  const NOTES: Array<[string, string, string]> = [
    [
      "STE-289",
      "AC-STE-289.1:",
      "**[Superseded in part by M_7bc805 STE-716 (v3.1.0): hooks/hooks.json stays the only bundled surface; the opt-in capture hook alone is registered in project-local settings, pinned to the installed plugin version.]**",
    ],
    [
      "STE-285",
      "AC-STE-285.3:",
      "**[Superseded in part by M_7bc805 STE-716 (v3.1.0): one opt-in hook is again registered install-side, in .claude/settings.local.json, never .claude/settings.json, pinned to the installed plugin version.]**",
    ],
  ];

  for (const [fr, ac, note] of NOTES) {
    test(`specs/frs/archive/${fr}.md ${ac.slice(0, -1)} ends with the supersession note and no other byte changes`, () => {
      const rel = `specs/frs/archive/${fr}.md`;
      const before = atV300(rel);
      const after = readFileSync(join(REPO_ROOT, rel), "utf-8");
      const line = after.split("\n").find((l) => l.startsWith(`- ${ac}`));
      expect(line).toBeDefined();
      expect(line!.endsWith(note)).toBe(true);
      const inserted = pureInsertion(before, after);
      expect(inserted).not.toBeNull();
      expect(inserted!.trim()).toBe(note);
    });
  }

  test("docs/hooks-reference.md § Reversal context names § tool-call-capture", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "hooks-reference.md"), "utf-8");
    const lines = doc.split("\n");
    const start = lines.findIndex((l) => l.startsWith("## Reversal context"));
    expect(start).toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i]!.startsWith("## ")) {
        end = i;
        break;
      }
    }
    expect(lines.slice(start, end).join("\n")).toMatch(/§ ?tool-call-capture|#tool-call-capture/);
  });
});
