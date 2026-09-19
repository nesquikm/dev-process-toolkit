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
    expect(splitCount(now)).toBe(splitCount(onMain));
    const positions = (text: string): Array<[number, string]> =>
      text
        .split("\n")
        .map((l, i) => [i + 1, /^(\d+)\. \*\*/.exec(l)?.[1] ?? ""] as [number, string])
        .filter(([, n]) => n !== "");
    const mainPositions = positions(onMain);
    expect(mainPositions.length).toBeGreaterThan(0);
    expect(positions(now)).toEqual(mainPositions);
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
