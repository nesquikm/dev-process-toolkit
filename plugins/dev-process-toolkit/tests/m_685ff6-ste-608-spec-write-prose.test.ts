// STE-608 (M_685ff6) — AC.11 and the gate-check row-73 half of AC.16: the
// shipped prose orders the decision front door and stops making claims the
// code does not keep.
//
// Content pins below are RED on the pre-change bytes; structural pins
// (split-lines, blank neighbours, the line-111 prefix, STE-token totals) are
// no-regression controls measured off the files at 2c99778.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SPEC_WRITE = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
const GATE_CHECK = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const JIRA_DOC = join(PLUGIN_ROOT, "adapters", "jira.md");
const LINEAR_DOC = join(PLUGIN_ROOT, "adapters", "linear.md");

const FRONT_DOOR = "resolve_milestone_identity.ts";
const GATE_LINE = "`gate=`";

const read = (p: string) => readFileSync(p, "utf-8");
const lines = (p: string) => read(p).split("\n");
const collapse = (s: string) => s.replace(/\s+/g, " ");
const steTokens = (s: string) => (s.match(/STE-\d+/g) ?? []).length;

function line177(): string {
  return lines(SPEC_WRITE)[176] ?? "";
}
function line179(): string {
  return lines(SPEC_WRITE)[178] ?? "";
}

/** A branch of line 177, from its bold lead to the next branch's bold lead. */
function branch(start: string, end: string): string {
  const l = line177();
  const a = l.indexOf(start);
  const b = l.indexOf(end, a + start.length);
  expect(a, `line 177 must carry "${start}"`).toBeGreaterThan(-1);
  expect(b, `line 177 must carry "${end}" after "${start}"`).toBeGreaterThan(a);
  return l.slice(a, b);
}

const LINEAR_BRANCH = () => branch("**Linear tracker-first branch", "**Scheme-adoption notice");
const JIRA_BRANCH = () => branch("**Jira Epic-first branch", "**Tracker-less minted branch");

function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

// ===========================================================================
// AC-STE-608.11 — content
// ===========================================================================

describe("AC-STE-608.11 — line 177 orders the decision front door before the gate", () => {
  test("the Linear branch orders the front door before any mint", () => {
    const b = LINEAR_BRANCH();
    const door = b.indexOf(FRONT_DOOR);
    expect(door, "the Linear branch names resolve_milestone_identity.ts").toBeGreaterThan(-1);
    const mint = b.indexOf("mintMilestoneLinear(");
    if (mint > -1) expect(door).toBeLessThan(mint);
  });

  test("the Jira branch orders the front door before any mint", () => {
    const b = JIRA_BRANCH();
    const door = b.indexOf(FRONT_DOOR);
    expect(door, "the Jira branch names resolve_milestone_identity.ts").toBeGreaterThan(-1);
    const mint = b.indexOf("mintMilestoneEpic(");
    if (mint > -1) expect(door).toBeLessThan(mint);
  });

  test("a join is ordered by key: the front door's --join-key form is named", () => {
    expect(line177()).toContain("--join-key");
  });

  test("the retired sentences are gone: 'by key and never by name', and `{ join: true }` as the joining repo's only mint call", () => {
    const l = line177();
    expect(l).not.toContain("The join is by key and never by name");
    expect(l).not.toMatch(/its only `mintMilestoneEpic` call is the join call/);
  });
});

describe("AC-STE-608.11 — line 179: the gate question is the front door's gate= line", () => {
  test("line 179 quotes the gate= line as the question", () => {
    expect(line179()).toContain(GATE_LINE);
    expect(line179()).toContain(FRONT_DOOR);
  });

  test("line 179 no longer calls Linear's default the sequential M<N>", () => {
    expect(line179()).not.toContain("Linear's is the sequential `M<N>`");
  });
});

describe("AC-STE-608.11 — the step 4 draft gate cannot say 'creates' before the find leg ran", () => {
  test("the draft acceptance gate orders the front door and quotes its gate= line", () => {
    const step4 = lines(SPEC_WRITE).find((l) => l.startsWith("4. **Draft acceptance gate"));
    expect(step4).toBeDefined();
    expect(step4!).toContain(FRONT_DOOR);
    expect(step4!).toContain(GATE_LINE);
  });
});

describe("AC-STE-608.11 — the adapters no longer say a normalized match joins without `{ join: true }`", () => {
  for (const [name, path] of [["jira.md", JIRA_DOC], ["linear.md", LINEAR_DOC]] as const) {
    test(`adapters/${name}`, () => {
      const body = collapse(read(path));
      expect(body).not.toContain("Without `{ join: true }` the same normalized match still joins");
      expect(body).not.toMatch(/without `\{ join: true \}`[^.]*normalized match[^.]*joins/i);
    });
  }
});

// ===========================================================================
// AC-STE-608.11 — structural pins (controls)
// ===========================================================================

describe("AC-STE-608.11 — structural pins are unmoved (controls)", () => {
  test("(control) spec-write/SKILL.md is 358 split-lines", () => {
    expect(lines(SPEC_WRITE).length).toBe(358);
  });

  test("(control) line 177 is one line with blank neighbours", () => {
    const l = lines(SPEC_WRITE);
    expect(l[175]).toBe("");
    expect(l[177]).toBe("");
    expect(l[176]!.startsWith("**Milestone-number allocation guard.**")).toBe(true);
  });

  test("(control) the line-111 prefix", () => {
    expect(lines(SPEC_WRITE)[110]!.startsWith("   **Milestone attachment (any adapter with `project_milestone: true`")).toBe(true);
  });

  test("(control) 54 STE tokens in the file, 245 across skills/**/*.md", () => {
    expect(steTokens(read(SPEC_WRITE))).toBe(54);
    const total = mdFiles(join(PLUGIN_ROOT, "skills")).reduce((n, f) => n + steTokens(read(f)), 0);
    expect(total).toBe(245);
  });
});

// ===========================================================================
// AC-STE-608.16 — gate-check row 73 names the Linear arm
// ===========================================================================

describe("AC-STE-608.16 — gate-check row 73 (line 160) is rewritten in place", () => {
  const row = () => lines(GATE_CHECK)[159] ?? "";

  test("row 73 names the Linear arm and its epoch", () => {
    expect(row().startsWith("73. **`plan_identity_mode_conditional`**")).toBe(true);
    expect(row()).toContain("LINEAR_TRACKER_KEY_EPOCH");
  });

  test("row 73 no longer says the arm never runs under linear", () => {
    expect(row()).not.toContain("this arm never runs there");
    expect(row()).not.toContain("it therefore cannot fire on this repository at all");
  });

  test("(control) gate-check/SKILL.md keeps 356 split-lines and 87 STE tokens", () => {
    expect(lines(GATE_CHECK).length).toBe(356);
    expect(steTokens(read(GATE_CHECK))).toBe(87);
  });
});

// AC-STE-608.9's skill half: on `labels=unchanged` the skill makes zero label
// writes. Graded on line 177, where the Jira join branch orders the label write.
describe("AC-STE-608.9 — the skill makes no label write on labels=unchanged", () => {
  test("line 177 orders zero label writes when the front door prints labels=unchanged", () => {
    const line = readFileSync(join(import.meta.dir, "..", "skills", "spec-write", "SKILL.md"), "utf-8").split("\n")[176]!;
    expect(line).toMatch(/`labels=unchanged`[^.]*no label write is made/);
  });
});
