// STE-609 (M_685ff6) — AC-STE-609.9 (prose follows the code, edited in place,
// inside its budgets) and the FR's own amendment record (AC-STE-609.9 /
// AC-STE-609.10).
//
// Budgets are MEASURED against `main`, never recited: the gate-check skill's
// split-line count and every absolute probe-row position, and the number of
// `STE-<n>` tokens across `skills/`. The implement skill's 358 is the exact pin
// the STE-584 and STE-590 suites already hold.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "./_span_fixture";
import { PLUGIN_ROOT, REPO_ROOT, SIBLING_STATES } from "./_sibling_state_fixture";

const readLf = (p: string): string => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
const splitCount = (text: string): number => text.split("\n").length;

const SHIP_SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const SHIP_REF = join(PLUGIN_ROOT, "docs", "ship-milestone-reference.md");
const GATE_SKILL_REL = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
const GATE_SKILL = join(REPO_ROOT, GATE_SKILL_REL);
const IMPLEMENT_SKILL = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const FR_PATHS = [
  join(REPO_ROOT, "specs", "frs", "STE-609.md"),
  join(REPO_ROOT, "specs", "frs", "archive", "STE-609.md"),
];

const OLD_UNLOCATABLE_SENTENCE = "An unlocatable sibling is not a refusal";

/** A word-bounded match for a state name (hyphens included). */
const stateWord = (state: string): RegExp =>
  new RegExp(`(^|[^a-z-])${state.replace(/-/g, "\\-")}([^a-z-]|$)`);

/** The `4. **` block of the ship skill's `## Pre-flight refusals` window. */
function refusalFour(): string {
  const ls = readLf(SHIP_SKILL).split("\n");
  const start = ls.indexOf("## Pre-flight refusals");
  const end = ls.indexOf("## Flow");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const win = ls.slice(start + 1, end);
  const four = win.findIndex((l) => /^4\. \*\*/.test(l));
  expect(four).toBeGreaterThanOrEqual(0);
  let stop = win.length;
  for (let i = four + 1; i < win.length; i++) {
    if (/^\d+\. \*\*/.test(win[i]!)) {
      stop = i;
      break;
    }
  }
  return win.slice(four, stop).join("\n");
}

/** The table rows of the reference's `## Refusal #4` section. */
function refusalFourMatrix(): string[] {
  const ls = readLf(SHIP_REF).split("\n");
  const start = ls.findIndex((l) => /^## Refusal #4\b/.test(l));
  expect(start, "no `## Refusal #4` section").toBeGreaterThanOrEqual(0);
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) {
    if (ls[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return ls
    .slice(start + 1, end)
    .filter((l) => l.startsWith("|") && !/^\|\s*-+/.test(l) && !/^\|\s*State\s*\|/.test(l));
}

/** The first cell and the outcome cell of a matrix row. */
const cells = (row: string): string[] =>
  row
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

/** Every probe row (`<n>. **`) of a text as `[line, probe number]`, in order. */
const probePositions = (text: string): Array<[number, string]> =>
  text
    .split("\n")
    .map((l, i) => [i + 1, /^(\d+)\. \*\*/.exec(l)?.[1] ?? ""] as [number, string])
    .filter(([, n]) => n !== "");

/**
 * Main's probe-row positions must hold unchanged in the working text; the only
 * rows allowed beyond them are those whose probe number main lacks, at the
 * lines the working text puts them.
 */
function compareProbePositions(
  mainText: string,
  nowText: string,
): { ok: boolean; expected: Array<[number, string]>; actual: Array<[number, string]> } {
  const main = probePositions(mainText);
  const actual = probePositions(nowText);
  const onMain = new Set(main.map(([, n]) => n));
  const expected = [...main, ...actual.filter(([, n]) => !onMain.has(n))];
  const ok = Bun.deepEquals(actual, expected);
  return { ok, expected, actual };
}

/**
 * The control's whole verdict, as violation lines (empty = holds). Positions
 * go through `compareProbePositions`; the split-line count is held to main's
 * only where the working text adds no row, since an added row adds its line.
 */
function probeControlViolations(mainText: string, nowText: string): string[] {
  const r = compareProbePositions(mainText, nowText);
  const violations: string[] = [];
  if (!r.ok) {
    // Name the first differing row only; the full lists run to ~86 pairs.
    const i = r.expected.findIndex((e, k) => !Bun.deepEquals(e, r.actual[k]));
    const at = i === -1 ? r.expected.length : i;
    violations.push(
      `probe-row ${at + 1}: expected ${JSON.stringify(r.expected[at] ?? null)}, got ${JSON.stringify(r.actual[at] ?? null)}`,
    );
  }
  const added = r.expected.length - probePositions(mainText).length;
  if (added === 0 && splitCount(nowText) !== splitCount(mainText)) {
    violations.push(`split-line count ${splitCount(nowText)} != main's ${splitCount(mainText)} with no probe row added`);
  }
  return violations;
}

describe("AC-STE-609.9 — refusal #4 in skills/ship-milestone/SKILL.md", () => {
  test(`the "${OLD_UNLOCATABLE_SENTENCE}" sentence is gone (red on HEAD)`, () => {
    expect(readLf(SHIP_SKILL)).not.toContain(OLD_UNLOCATABLE_SENTENCE);
  });

  test("refusal #4 says only an idle sibling releases without --partial (red on HEAD)", () => {
    const block = refusalFour();
    expect(block).toMatch(/\bidle\b/);
    expect(block).toContain("--partial");
    expect(block).toMatch(stateWord("unlocatable"));
  });
});

describe("AC-STE-609.9 — the refusal #4 matrix in docs/ship-milestone-reference.md, one row per state", () => {
  test("every state of the closed set has its own row (red on HEAD)", () => {
    const rows = refusalFourMatrix();
    const missing = SIBLING_STATES.filter(
      (s) => !rows.some((r) => stateWord(s).test(cells(r)[0] ?? "")),
    );
    expect(missing, rows.join("\n")).toEqual([]);
  });

  test("every non-idle row without --partial refuses; the idle row ships (red on HEAD)", () => {
    const rows = refusalFourMatrix();
    for (const s of SIBLING_STATES) {
      const own = rows.filter((r) => stateWord(s).test(cells(r)[0] ?? "") && !cells(r)[0]!.includes("--partial"));
      expect(own.length, `${s}: ${rows.join("\n")}`).toBeGreaterThan(0);
      for (const r of own) {
        const outcome = cells(r)[1] ?? "";
        if (s === "idle") expect(outcome, r).toMatch(/^Ship\b/);
        else expect(outcome, r).toMatch(/^Refuse\b/);
      }
    }
  });

  test("(control) the busy --partial row stays, with its measured footer", () => {
    const row = refusalFourMatrix().find((l) => l.startsWith("| Sibling busy, `--partial`"));
    expect(row).toBeDefined();
    expect(row!).toContain("pending");
    expect(row!).toContain("@v<X.Y.Z>");
  });
});

describe("AC-STE-609.9 — the probe #75 row in skills/gate-check/SKILL.md", () => {
  const row75 = (): string => {
    const row = readLf(GATE_SKILL)
      .split("\n")
      .find((l) => /^75\. \*\*`active_plan_ship_ready`\*\*/.test(l));
    expect(row).toBeDefined();
    return row!;
  };

  test("an unlocatable sibling no longer 'leaves the verdict intact'; the row says non-idle siblings hold the milestone (red on HEAD)", () => {
    const row = row75();
    expect(row).not.toContain("leaves the verdict intact");
    expect(row).toMatch(/\bidle\b/);
  });

  test("(control) the row keeps both row names and the spans_repos.ts reference", () => {
    const row = row75();
    expect(row).toContain("awaiting-sibling");
    expect(row).toContain("sibling-unlocatable");
    expect(row).toContain("spans_repos.ts");
  });

  test("(control) the skill's split-line count and every absolute probe-row position equal main's", () => {
    const onMain = git(REPO_ROOT, "show", `main:${GATE_SKILL_REL}`);
    const now = readFileSync(GATE_SKILL, "utf-8");
    expect(probePositions(onMain).length).toBeGreaterThan(0);
    // Amended by AC-STE-659.3: probe #86 (`milestone_name_unasked`) registers on line 173; rows 1..85 hold main's positions.
    // Fixed by AC-STE-660.1: rows main lacks are derived from the two texts, so the control holds before and after the merge;
    // the split-line count is held to main's only where no row is added.
    // Positions are asserted directly for bun's row-level diff on failure; the verdict adds the split-line rule.
    const r = compareProbePositions(onMain, now);
    expect(r.actual).toEqual(r.expected);
    expect(probeControlViolations(onMain, now)).toEqual([]);
  });
});

// STE-660 — the control above derives the rows a branch adds from its
// difference with main instead of hard-coding them. The comparison lives in a
// pure helper in this file, `compareProbePositions(mainText, nowText)`, which
// returns `{ ok, expected, actual }`: `actual` is the working text's probe-row
// positions, `expected` is main's positions followed by the working rows whose
// probe number main lacks (in working order), and `ok` is their deep equality.
describe("AC-STE-660 — the AC-STE-609.9 control compares against main as it stands", () => {
  const SELF = join(PLUGIN_ROOT, "tests", "m_685ff6-ste-609-prose.test.ts");
  const CONTROL_TITLE = "(control) the skill's split-line count and every absolute probe-row position equal main's";

  /** The body of the `(control)` test, from its title line through its own `  });` close. */
  const controlBody = (): string => {
    const ls = readLf(SELF).split("\n");
    const start = ls.findIndex((l) => /^\s*test\(/.test(l) && l.includes(CONTROL_TITLE));
    expect(start, `no control test titled ${CONTROL_TITLE}`).toBeGreaterThanOrEqual(0);
    const indent = /^(\s*)/.exec(ls[start]!)![1]!;
    const end = ls.findIndex((l, i) => i > start && l === `${indent}});`);
    expect(end, "the control test has no closing line").toBeGreaterThan(start);
    return ls.slice(start, end + 1).join("\n");
  };

  const MAIN_FIXTURE = [
    "# Gate check",
    "",
    "1. **`alpha`** — first probe.",
    "2. **`beta`** — second probe.",
    "",
    "Some prose between rows.",
    "3. **`gamma`** — third probe.",
    "",
  ].join("\n");

  test("AC-STE-660.1: the hard-coded `[173, \"86\"]` row is gone from this file", () => {
    // Built by concatenation so this test's own source never contains the literal it forbids.
    const literal = "[173, " + '"86"]';
    expect(readLf(SELF)).not.toContain(literal);
  });

  test("AC-STE-660.1: the control asserts through the derived comparison helper against main's text", () => {
    const body = controlBody();
    expect(body).toMatch(/compareProbePositions\(\s*onMain\s*,\s*now\s*\)/);
    expect(body).not.toMatch(/\[\s*\d+\s*,\s*"\d+"\s*\]/);
  });

  test("AC-STE-660.1 / AC-STE-660.2: on a tree equal to main the helper holds with no added rows", () => {
    const r = compareProbePositions(MAIN_FIXTURE, MAIN_FIXTURE);
    expect(r.ok).toBe(true);
    expect(r.actual).toEqual([
      [3, "1"],
      [4, "2"],
      [7, "3"],
    ]);
    expect(r.expected).toEqual(r.actual);
  });

  test("AC-STE-660.3: one extra probe row registered after main's last row passes the helper", () => {
    const now = MAIN_FIXTURE.replace("3. **`gamma`** — third probe.\n", "3. **`gamma`** — third probe.\n4. **`delta`** — added probe.\n");
    expect(now).not.toBe(MAIN_FIXTURE);
    const r = compareProbePositions(MAIN_FIXTURE, now);
    expect(r.ok).toBe(true);
    expect(r.actual).toEqual([
      [3, "1"],
      [4, "2"],
      [7, "3"],
      [8, "4"],
    ]);
    expect(r.expected).toEqual(r.actual);
  });

  test("AC-STE-660.4: an existing probe row moved to a different line fails the helper", () => {
    // Row 3 moves up one line (the prose line now follows it); no row is added.
    const now = MAIN_FIXTURE.replace(
      "Some prose between rows.\n3. **`gamma`** — third probe.\n",
      "3. **`gamma`** — third probe.\nSome prose between rows.\n",
    );
    expect(now).not.toBe(MAIN_FIXTURE);
    const r = compareProbePositions(MAIN_FIXTURE, now);
    expect(r.ok).toBe(false);
    expect(r.expected).toEqual([
      [3, "1"],
      [4, "2"],
      [7, "3"],
    ]);
    expect(r.actual).toEqual([
      [3, "1"],
      [4, "2"],
      [6, "3"],
    ]);
  });

  test("AC-STE-660.4: a moved row is not excused by an added row alongside it", () => {
    const now = MAIN_FIXTURE.replace(
      "Some prose between rows.\n3. **`gamma`** — third probe.\n",
      "3. **`gamma`** — third probe.\nSome prose between rows.\n4. **`delta`** — added probe.\n",
    );
    const r = compareProbePositions(MAIN_FIXTURE, now);
    expect(r.ok).toBe(false);
    expect(r.expected).toEqual([
      [3, "1"],
      [4, "2"],
      [7, "3"],
      [8, "4"],
    ]);
  });

  test("AC-STE-660.5: the AC-STE-659.3 amendment comment stays and names AC-STE-660.1 as its fix", () => {
    const commentLines = controlBody()
      .split("\n")
      .filter((l) => l.trim().startsWith("//"));
    const marker = commentLines.find((l) => l.includes("AC-STE-659.3"));
    expect(marker, "no AC-STE-659.3 amendment comment in the control").toBeDefined();
    const comment = commentLines.join("\n");
    expect(comment).toContain("AC-STE-659.3");
    expect(comment).toContain("AC-STE-660.1");
  });

  // Requirement "Holds on a branch": the control's whole verdict, not only the
  // helper, must pass on a tree that registers one new probe row — which adds a
  // line, so the split-line count is held only where no row was added.
  test("Holds on a branch: the control's verdict passes a tree that adds one probe row (and its line)", () => {
    const now = MAIN_FIXTURE.replace("3. **`gamma`** — third probe.\n", "3. **`gamma`** — third probe.\n4. **`delta`** — added probe.\n");
    expect(splitCount(now)).toBe(splitCount(MAIN_FIXTURE) + 1);
    expect(probeControlViolations(MAIN_FIXTURE, now)).toEqual([]);
  });

  test("Holds on main: with no row added, the control's verdict still holds the split-line count", () => {
    expect(probeControlViolations(MAIN_FIXTURE, MAIN_FIXTURE)).toEqual([]);
    const now = `${MAIN_FIXTURE}A trailing note after the last row.\n`;
    expect(probePositions(now)).toEqual(probePositions(MAIN_FIXTURE));
    expect(splitCount(now)).toBe(splitCount(MAIN_FIXTURE) + 1);
    expect(probeControlViolations(MAIN_FIXTURE, now)).toHaveLength(1);
  });

  test("Still a control: the control's verdict fails a moved row", () => {
    const now = MAIN_FIXTURE.replace(
      "Some prose between rows.\n3. **`gamma`** — third probe.\n",
      "3. **`gamma`** — third probe.\nSome prose between rows.\n",
    );
    expect(probeControlViolations(MAIN_FIXTURE, now).length).toBeGreaterThan(0);
  });

  test("Still a control: the control's verdict fails a removed row, naming the first missing one", () => {
    const now = MAIN_FIXTURE.replace("3. **`gamma`** — third probe.\n", "");
    expect(probeControlViolations(MAIN_FIXTURE, now)).toEqual([
      `probe-row 3: expected [7,"3"], got null`,
      "split-line count 7 != main's 8 with no probe row added",
    ]);
  });

  test("the control asserts through the control's verdict helper", () => {
    expect(controlBody()).toMatch(/probeControlViolations\(\s*onMain\s*,\s*now\s*\)/);
  });
});

describe("AC-STE-609.9 — the close-offer sentence in skills/implement/SKILL.md", () => {
  const offerLine = (): string => {
    const hits = readLf(IMPLEMENT_SKILL)
      .split("\n")
      .filter((l) => l.includes("adapters/_shared/src/active_plan_ship_ready.ts"));
    expect(hits).toHaveLength(1);
    return hits[0]!;
  };

  test("the close offer orders the skill to surface the CLI's stderr `held:` lines (red on HEAD)", () => {
    const line = offerLine();
    expect(line).toContain("held:");
    expect(line).toMatch(/\bstderr\b/);
    expect(line).toMatch(/\bsurface\b/i);
  });

  test("(control) the file stays at exactly 358 split-lines and the offer line still names spans_repos", () => {
    expect(splitCount(readFileSync(IMPLEMENT_SKILL, "utf-8"))).toBe(358);
    expect(offerLine()).toContain("spans_repos");
  });
});

describe("AC-STE-609.9 — skills/ gains zero STE tokens", () => {
  test("(control) the STE-<n> token count across skills/ equals main's", () => {
    const count = (text: string): number => (text.match(/\bSTE-\d+\b/g) ?? []).length;
    const tracked = git(REPO_ROOT, "ls-tree", "-r", "--name-only", "main", "--", "plugins/dev-process-toolkit/skills")
      .split("\n")
      .filter((f) => f.trim() !== "");
    expect(tracked.length).toBeGreaterThan(0);
    let onMain = 0;
    for (const f of tracked) onMain += count(git(REPO_ROOT, "show", `main:${f}`));
    const nowFiles = git(REPO_ROOT, "ls-files", "--cached", "--others", "--exclude-standard", "--", "plugins/dev-process-toolkit/skills")
      .split("\n")
      .filter((f) => f.trim() !== "" && existsSync(join(REPO_ROOT, f)));
    let now = 0;
    for (const f of nowFiles) now += count(readFileSync(join(REPO_ROOT, f), "utf-8"));
    expect(now).toBe(onMain);
  });
});

describe("AC-STE-609.9 / AC-STE-609.10 — the FR records the amendments it makes to shipped pins", () => {
  const frText = (): string => {
    const file = FR_PATHS.find((p) => existsSync(p));
    expect(file, `no STE-609 FR at ${FR_PATHS.join(" or ")}`).toBeDefined();
    return readLf(file!);
  };

  test("the FR records that it supersedes AC-STE-589.3's 'an unlocatable sibling does not refuse' clause (red on HEAD)", () => {
    const text = frText();
    const line = text
      .split("\n")
      .find((l) => l.includes("AC-STE-589.3") && /supersed/i.test(l));
    expect(line, "no FR line records superseding AC-STE-589.3").toBeDefined();
  });

  test("the FR's implementation notes list the amended span-fixture consumer suites (red on HEAD)", () => {
    const text = frText();
    // Every consumer suite this FR edits, verdict amendments and
    // construction-only changes (`{ repositories: false }`) alike — written
    // out, never derived from a diff against main, which is empty once merged.
    for (const suite of [
      "m_79b1f6-ste-588-sibling-coherence",
      "m_79b1f6-ste-589-sibling-ship-gate",
      "m_79b1f6-ste-590-offers-ask-the-gate",
      "m_79b1f6-ste-591-sibling-by-tracker-id",
      "m_8f07e0-ste-583-spans-repos",
      "m_8f07e0-ste-584-awaiting-siblings",
      "m_8f07e0-ste-584-fr-scope-waits",
      "m_8f07e0-ste-587-span-fixture",
      "create-front-door-shared",
      "gate-check-tracker-local-reconciliation-drift",
      "hook-modules-pre-tracker-write-gate",
      "m_685ff6-ste-608-numeric-door",
      "orphan-listing-shared",
      "shared-declaration-reader",
      "shared-declaration-setup",
      "ticket-ownership-shared",
    ]) {
      expect(text, `the FR does not list ${suite}`).toContain(suite);
    }
  });
});
