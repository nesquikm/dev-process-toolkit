// STE-691 (M_7a948e) — a numbered Jira milestone has no children to grade.
//
// In a repository bound to a shared tracker container (`repo_tag` set),
// refusal #4's front door
//
//   bun run adapters/_shared/src/sibling_release.ts <projectRoot> <planFile> <milestone>
//     [--partial] [--children <listingFile> | --offer]
//
// demanded `--children` for every milestone. Under the Jira adapter a numeric
// `M<N>` milestone has no Epic (STE-523 routes it to the label path with no
// parent), so it has no child listing by construction: the front door now
// skips the grade for it and prints `children=none (no container)` on stderr
// in place of the `children=` count. An `M_<epic-key>` milestone under Jira,
// and every milestone under a Linear shared binding, still refuse without
// `--children` exactly as before.
//
// Fixtures: one real git root (GIT_ENV) per test, bound to a shared Jira or
// Linear container, holding the milestone's archived plan (no `spans_repos:`,
// so no sibling refuses) and one archived FR bound to it. Torn down in a
// `finally`; one child spawned at a time.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { FIXTURE_TRACKER_PROJECT, commitAll, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import { PLUGIN_ROOT, SHIP_GATE_DOOR, describeRun, lines, runModule, writePlan, type Run } from "./_sibling_state_fixture";
import { TAG_A, TAG_B, sharedClaudeMd, trackedFr } from "./_span_declare_fixture";

type Mode = "jira" | "linear";

/** The literal the front door prints for a milestone with no tracker container. */
const NO_CONTAINER = "children=none (no container)";
/** The shared-container refusal's own words — "exactly as before" (AC-STE-691.4). */
const MUST_GRADE = "is released from a shared tracker container, so refusal #4 must grade its children.";

const JIRA_PROJECT = "GK";
const LINEAR_UUID = "550e8400-e29b-41d4-a716-446655440000";

/** The four (adapter, token-kind) cells: each with its milestone and own FR ticket. */
const CELLS = {
  jiraNumeric: { mode: "jira", milestone: "M7", ownKey: "GK-96910", project: JIRA_PROJECT },
  jiraKeyed: { mode: "jira", milestone: "M_GK_609", ownKey: "GK-96911", project: JIRA_PROJECT },
  linearNumeric: { mode: "linear", milestone: "M7", ownKey: "STE-96910", project: FIXTURE_TRACKER_PROJECT },
  linearKeyed: { mode: "linear", milestone: "M_550e84", ownKey: "STE-96911", project: FIXTURE_TRACKER_PROJECT },
} as const;
type Cell = (typeof CELLS)[keyof typeof CELLS];

interface Tree {
  readonly fx: SpanFixture;
  readonly a: string;
  readonly planFile: string;
  readonly cell: Cell;
  readonly dir: string;
}

/**
 * A repository bound to a shared container (`repo_tag` = TAG_A) under the
 * cell's adapter, holding the milestone's ARCHIVED plan and one archived FR
 * bound to it. `sibling: true` declares an idle sibling B (same container,
 * naming A back) so the `Spans:` footer has a line to print; otherwise the
 * plan declares no `spans_repos:` and no sibling can refuse.
 */
async function withShared<T>(
  cell: Cell,
  body: (t: Tree) => Promise<T> | T,
  opts: { sibling?: boolean } = {},
): Promise<T> {
  const fx = makeSpanFixture(cell.milestone);
  const dir = mkdtempSync(join(tmpdir(), "dpt-691-children-"));
  try {
    const bind = { mode: cell.mode, project: cell.project } as const;
    sharedClaudeMd(fx.a, TAG_A, bind);
    commitAll(fx.a, "fixture: A bound to a shared container");
    if (opts.sibling) {
      sharedClaudeMd(fx.b, TAG_B, bind);
      writePlan(fx.b, "live", cell.milestone, { [TAG_A]: relative(fx.b, fx.a), [TAG_B]: "." });
      trackedFr(fx.b, `${cell.ownKey}1`, cell.milestone, "archived", cell.mode);
      commitAll(fx.b, "fixture: B idle on the milestone");
    }
    const planFile = writePlan(
      fx.a,
      "archive",
      cell.milestone,
      opts.sibling ? { [TAG_A]: ".", [TAG_B]: relative(fx.a, fx.b) } : {},
    );
    trackedFr(fx.a, cell.ownKey, cell.milestone, "archived", cell.mode);
    return await body({ fx, a: fx.a, planFile, cell, dir });
  } finally {
    try {
      fx.cleanup();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const gate = (t: Tree, ...flags: string[]): Run =>
  runModule(SHIP_GATE_DOOR, [t.a, t.planFile, t.cell.milestone, ...flags]);

function save(t: Tree, content: unknown, name = "children.json"): string {
  const p = join(t.dir, name);
  writeFileSync(p, JSON.stringify(content));
  return p;
}

/** One Jira child issue in the measured `searchJiraIssuesUsingJql` shape. */
function jiraChild(key: string, labels: string[]): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Child ${key}`,
      labels,
      description: `Source: specs/frs/${key}.md`,
      creator: { displayName: "Fixture Author" },
      issuetype: { name: "Task", hierarchyLevel: 0 },
      project: { key: JIRA_PROJECT },
      status: { name: "Done", statusCategory: { key: "done" } },
      parent: { key: "GK-609" },
    },
  };
}

/** One Linear `list_issues` row in the measured shape. */
function linearIssue(key: string, labels: string[]): Record<string, unknown> {
  return {
    id: key,
    title: `Child ${key}`,
    description: `Source: specs/frs/${key}.md`,
    createdBy: "Fixture Author",
    labels,
    project: FIXTURE_TRACKER_PROJECT,
    projectMilestone: { id: LINEAR_UUID, name: "Milestone 550e84" },
    team: "Example Team Display Name",
  };
}

function expectSharedRefusal(r: Run, milestone: string): void {
  expect(r.status, describeRun(r)).toBe(1);
  expect(r.stdout, describeRun(r)).toBe("");
  expect(r.stderr, describeRun(r)).toMatch(/^\/ship-milestone: /);
  expect(r.stderr, describeRun(r)).toContain(`${milestone} ${MUST_GRADE}`);
  expect(r.stderr, describeRun(r)).toContain("--children");
  expect(r.stderr, describeRun(r)).toContain("--offer");
  expect(r.stderr, describeRun(r)).toContain(`repo_tag=${TAG_A}`);
  expect(r.stderr, describeRun(r)).not.toContain(NO_CONTAINER);
}

// ===========================================================================
// AC-STE-691.1 + .2 — the regression, and the permit line
// ===========================================================================

describe("AC-STE-691.1 — regression", () => {
  test("a numeric Jira milestone in a shared container passes refusal #4 with no --children", async () => {
    await withShared(CELLS.jiraNumeric, (t) => {
      const r = gate(t);
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stderr, describeRun(r)).not.toContain(MUST_GRADE);
      expect(lines(r.stderr), describeRun(r)).toEqual([NO_CONTAINER]);
    });
  }, 30_000);
});

describe("AC-STE-691.2 — a numeric Jira milestone prints children=none (no container) in place of the count", () => {
  test("no --children: exit 0, stdout empty (no sibling), exactly one stderr line, no children=<n> count", async () => {
    await withShared(CELLS.jiraNumeric, (t) => {
      const r = gate(t);
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout, describeRun(r)).toBe("");
      expect(lines(r.stderr), describeRun(r)).toEqual([NO_CONTAINER]);
      expect(r.stderr, describeRun(r)).not.toMatch(/children=\d/);
      expect(r.stderr, describeRun(r)).not.toContain("children=not checked (offer)");
    });
  }, 30_000);

  test("with an idle declared sibling the Spans: footer is still printed beside the no-container line", async () => {
    await withShared(
      CELLS.jiraNumeric,
      (t) => {
        const r = gate(t);
        expect(r.status, describeRun(r)).toBe(0);
        expect(r.stdout, describeRun(r)).toBe(`Spans: ${TAG_B}@pending\n`);
        expect(lines(r.stderr), describeRun(r)).toEqual([NO_CONTAINER]);
      },
      { sibling: true },
    );
  }, 30_000);

  test("(control) a sibling that refuses still refuses a numeric Jira milestone — the skip is the children grade only", async () => {
    await withShared(
      CELLS.jiraNumeric,
      (t) => {
        // B holds an ACTIVE FR bound to the milestone: busy.
        trackedFr(t.fx.b, `${t.cell.ownKey}9`, t.cell.milestone, "active", "jira");
        commitAll(t.fx.b, "fixture: B busy");
        const r = gate(t);
        expect(r.status, describeRun(r)).toBe(1);
        expect(r.stderr, describeRun(r)).toContain(TAG_B);
        expect(r.stderr, describeRun(r)).toContain("busy");
        expect(r.stderr, describeRun(r)).not.toContain(NO_CONTAINER);
      },
      { sibling: true },
    );
  }, 30_000);
});

// ===========================================================================
// AC-STE-691.3 — a passed --children is not graded for a numeric Jira milestone
// ===========================================================================

describe("AC-STE-691.3 — --children <file> on a numeric Jira milestone is not graded against the listing", () => {
  test("an empty listing (which the grade refuses as children=0) passes and prints the no-container line", async () => {
    await withShared(CELLS.jiraNumeric, (t) => {
      const r = gate(t, "--children", save(t, { issues: [], isLast: true }));
      expect(r.status, describeRun(r)).toBe(0);
      expect(lines(r.stderr), describeRun(r)).toEqual([NO_CONTAINER]);
      expect(r.stderr, describeRun(r)).not.toContain("children=0");
    });
  }, 30_000);

  test("a listing omitting this repository's own FR ticket and not the last page passes too", async () => {
    await withShared(CELLS.jiraNumeric, (t) => {
      const listing = { issues: [jiraChild("GK-96999", ["glade-app-ops"])], isLast: false, nextPageToken: "t-next" };
      const r = gate(t, "--children", save(t, listing));
      expect(r.status, describeRun(r)).toBe(0);
      expect(lines(r.stderr), describeRun(r)).toEqual([NO_CONTAINER]);
      expect(r.stderr, describeRun(r)).not.toContain(t.cell.ownKey);
    });
  }, 30_000);

  test("(control) the same empty listing on an M_<epic-key> Jira milestone is graded and refuses with children=0", async () => {
    await withShared(CELLS.jiraKeyed, (t) => {
      const r = gate(t, "--children", save(t, { issues: [], isLast: true }));
      expect(r.status, describeRun(r)).toBe(1);
      expect(`${r.stdout}\n${r.stderr}`, describeRun(r)).toMatch(/(^|\s)children=0(\s|$)/m);
      expect(r.stderr, describeRun(r)).not.toContain(NO_CONTAINER);
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-691.4 — every other cell refuses without --children exactly as before
// ===========================================================================

describe("AC-STE-691.4 — keyed Jira and every Linear milestone still refuse without --children", () => {
  test("an M_<epic-key> milestone under Jira refuses without --children, naming --children and --offer", async () => {
    await withShared(CELLS.jiraKeyed, (t) => expectSharedRefusal(gate(t), t.cell.milestone));
  }, 30_000);

  test("a numeric M<N> milestone under a Linear shared binding refuses without --children", async () => {
    await withShared(CELLS.linearNumeric, (t) => expectSharedRefusal(gate(t), t.cell.milestone));
  }, 30_000);

  test("an M_<key> milestone under a Linear shared binding refuses without --children", async () => {
    await withShared(CELLS.linearKeyed, (t) => expectSharedRefusal(gate(t), t.cell.milestone));
  }, 30_000);

  test("(control) an M_<epic-key> Jira milestone with a complete listing is still graded and prints children=1", async () => {
    await withShared(CELLS.jiraKeyed, (t) => {
      const r = gate(t, "--children", save(t, { issues: [jiraChild(t.cell.ownKey, [TAG_A])], isLast: true }));
      expect(r.status, describeRun(r)).toBe(0);
      expect(lines(r.stderr), describeRun(r)).toEqual(["children=1"]);
    });
  }, 30_000);

  test("(control) a Linear M_<key> milestone with a complete listing is still graded and prints children=1", async () => {
    await withShared(CELLS.linearKeyed, (t) => {
      const r = gate(t, "--children", save(t, { issues: [linearIssue(t.cell.ownKey, [TAG_A])], hasNextPage: false }));
      expect(r.status, describeRun(r)).toBe(0);
      expect(lines(r.stderr), describeRun(r)).toEqual(["children=1"]);
    });
  }, 30_000);

  test("(control) a numeric Linear milestone given --children is graded, never answered with the no-container line", async () => {
    await withShared(CELLS.linearNumeric, (t) => {
      const r = gate(t, "--children", save(t, { issues: [], hasNextPage: false }));
      expect(r.status, describeRun(r)).toBe(1);
      expect(r.stderr, describeRun(r)).not.toContain(NO_CONTAINER);
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-691.5 — the --offer path
// ===========================================================================

describe("AC-STE-691.5 — --offer on a numeric Jira milestone prints the no-container line", () => {
  test("--offer: exit 0 and exactly one stderr line children=none (no container)", async () => {
    await withShared(CELLS.jiraNumeric, (t) => {
      const r = gate(t, "--offer");
      expect(r.status, describeRun(r)).toBe(0);
      expect(lines(r.stderr), describeRun(r)).toEqual([NO_CONTAINER]);
      expect(r.stderr, describeRun(r)).not.toContain("children=not checked (offer)");
    });
  }, 30_000);

  test("(control) --offer on an M_<epic-key> Jira milestone still prints children=not checked (offer)", async () => {
    await withShared(CELLS.jiraKeyed, (t) => {
      const r = gate(t, "--offer");
      expect(r.status, describeRun(r)).toBe(0);
      expect(lines(r.stderr), describeRun(r)).toEqual(["children=not checked (offer)"]);
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-691.6 — the SKILL says so in refusal #4
// ===========================================================================

/**
 * The ONE sentence STE-691 appends IN PLACE to refusal #4 (line 91 of
 * skills/ship-milestone/SKILL.md, already a permitted line of the
 * AC-STE-618.8 freeze). The freeze guard in
 * tests/m_2306b6-ste-618-live-proof-gate.test.ts pins the same text.
 */
const REFUSAL_4_NUMERIC_JIRA_SENTENCE =
  "`--children` is not required for a numeric `M<N>` milestone under a Jira shared binding — it has no Epic, so no child listing — and the front door prints `children=none (no container)` in place of the count.";

describe("AC-STE-691.6 — skills/ship-milestone/SKILL.md refusal #4 names the numeric-Jira exemption", () => {
  test("refusal #4 says --children is not required for a numeric milestone under a Jira shared binding", () => {
    const skill = readFileSync(join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md"), "utf-8");
    const refusal4 = skill.split("\n").filter((l) => l.startsWith("4. **Sibling not provably idle**"));
    expect(refusal4, "refusal #4 is one line").toHaveLength(1);
    const line = refusal4[0]!;
    expect(line).toContain(REFUSAL_4_NUMERIC_JIRA_SENTENCE);
    expect(line).toContain(NO_CONTAINER);
    expect(line).toMatch(/`--children` is not required for a numeric `M<N>` milestone under a Jira shared binding/);
    // Said once, and only in refusal #4.
    expect(skill.split(REFUSAL_4_NUMERIC_JIRA_SENTENCE).length - 1).toBe(1);
  });
});

// STE-690 review (Phase 3, M_7a948e): the `Spans:` footer must agree with
// coherence's sibling leg — a sibling stamped `unreleased` under its OWN
// `changelog_unversioned: true` has shipped, so the footer names the stamp
// instead of `pending`. Without the sibling's flag it is still `pending`.
describe("STE-690 — the Spans: footer reads a sibling's `unreleased` stamp under the sibling's own flag", () => {
  /** Stamp B's plan `unreleased`, optionally declare B's flag, and commit B. */
  function stampSiblingUnreleased(t: Tree, declareFlag: boolean): void {
    const bPlan = join(t.fx.b, "specs", "plan", `${t.cell.milestone}.md`);
    const body = readFileSync(bPlan, "utf-8").replace(/^shipped_in: null$/m, "shipped_in: unreleased");
    expect(body).toMatch(/^shipped_in: unreleased$/m);
    writeFileSync(bPlan, body);
    if (declareFlag) {
      const md = join(t.fx.b, "CLAUDE.md");
      writeFileSync(md, `${readFileSync(md, "utf-8")}\n## Docs\n\nchangelog_unversioned: true\n`);
    }
    commitAll(t.fx.b, "fixture: B stamped unreleased");
  }

  test("the sibling declares the flag: the footer prints @unreleased", async () => {
    await withShared(
      CELLS.jiraNumeric,
      (t) => {
        stampSiblingUnreleased(t, true);
        const r = gate(t);
        expect(r.status, describeRun(r)).toBe(0);
        expect(r.stdout, describeRun(r)).toBe(`Spans: ${TAG_B}@unreleased\n`);
      },
      { sibling: true },
    );
  }, 30_000);

  test("(control) the sibling does not declare the flag: the footer still prints @pending", async () => {
    await withShared(
      CELLS.jiraNumeric,
      (t) => {
        stampSiblingUnreleased(t, false);
        const r = gate(t);
        expect(r.status, describeRun(r)).toBe(0);
        expect(r.stdout, describeRun(r)).toBe(`Spans: ${TAG_B}@pending\n`);
      },
      { sibling: true },
    );
  }, 30_000);
});
