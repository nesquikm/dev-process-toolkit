// STE-611 (M_685ff6) — AC-STE-611.3, the prose half: `/spec-write` resolves
// the attach target BEFORE the step 4 draft gate and before `Provider.sync`,
// names the resolved container in the gate preview, and a refusal ends the
// run with zero tracker writes and no FR file.
//
// Content pins are RED on the pre-change bytes (3170dfc), where the attach
// module's first mention is line 111 — after the draft gate (line 90) and
// after `Provider.sync` (line 107). Structural pins (358 split-lines, the
// line-111 prefix, the STE-token totals) are no-regression controls measured
// off the file at 3170dfc; line 177 is deliberately NOT pinned here (its
// module-path count belongs to the 580/592 suites).

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SPEC_WRITE = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const FRONT_DOOR = "attach_project_milestone.ts";
const GATE_PROMPT = "Approve and proceed?";

const read = (p: string) => readFileSync(p, "utf-8");
const lines = () => read(SPEC_WRITE).split("\n");
const steTokens = (s: string) => (s.match(/STE-\d+/g) ?? []).length;

function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** The step 4 line: `4. **Draft acceptance gate …`. */
function step4(): { index: number; text: string } {
  const l = lines();
  const index = l.findIndex((x) => x.startsWith("4. **Draft acceptance gate"));
  expect(index).toBeGreaterThan(-1);
  return { index, text: l[index]! };
}

/** The first line that RUNS `Provider.sync(spec)` (the `**Then** call` line). */
function syncLine(): number {
  const i = lines().findIndex((x) => x.includes("**Then** call `Provider.sync(spec)`"));
  expect(i).toBeGreaterThan(-1);
  return i;
}

describe("AC-STE-611.3 — /spec-write resolves the attach target before the draft gate and before any create", () => {
  test("the attach front door is first named before the draft gate's prompt and before Provider.sync", () => {
    const body = read(SPEC_WRITE);
    const door = body.indexOf(FRONT_DOOR);
    const gate = body.indexOf(GATE_PROMPT);
    const sync = body.indexOf("**Then** call `Provider.sync(spec)`");
    expect(door).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(door).toBeLessThan(gate);
    expect(door).toBeLessThan(sync);
  });

  test("step 4 orders the attach front door, and its line sits before the Provider.sync line", () => {
    const s = step4();
    expect(s.text).toContain(FRONT_DOOR);
    expect(s.index).toBeLessThan(syncLine());
    // Within step 4, the front door is ordered before the gate prompt.
    expect(s.text.indexOf(FRONT_DOOR)).toBeLessThan(s.text.indexOf(GATE_PROMPT));
  });

  test("the gate preview names the resolved container (the front door's printed surface and key)", () => {
    const t = step4().text;
    expect(t).toMatch(/`surface=`|`key=`/);
    expect(t).toMatch(/preview/i);
  });

  test("a refusal ends the run with zero tracker writes and no FR file", () => {
    const t = step4().text;
    const at = t.indexOf(FRONT_DOOR);
    const after = t.slice(at);
    expect(after).toMatch(/refus/i);
    expect(after).toMatch(/zero tracker writes|no tracker write/i);
    expect(after).toMatch(/no FR file/i);
  });
});

describe("AC-STE-611.3 — the prose is edited in place (controls)", () => {
  test("(control) spec-write/SKILL.md is 358 split-lines", () => {
    expect(lines().length).toBe(358);
  });

  test("(control) the line-111 prefix is unchanged", () => {
    expect(lines()[110]!.startsWith("   **Milestone attachment (any adapter with `project_milestone: true`")).toBe(true);
  });

  test("(control) zero new STE tokens: 54 in the file, 245 across skills/**/*.md", () => {
    expect(steTokens(read(SPEC_WRITE))).toBe(54);
    const total = mdFiles(join(PLUGIN_ROOT, "skills")).reduce((n, f) => n + steTokens(read(f)), 0);
    expect(total).toBe(245);
  });
});
