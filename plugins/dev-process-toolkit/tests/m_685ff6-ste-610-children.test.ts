// STE-610 (M_685ff6) — AC-STE-610.6: the undeclared side is graded.
//
// In a repository whose binding is shared (a `repo_tag`), refusal #4's front door
//
//   bun run adapters/_shared/src/sibling_release.ts <projectRoot> <planFile> <milestone>
//     [--partial] (--children <listingFile> | --offer)
//
// run for a release requires `--children <listingFile>`: for Jira the milestone
// Epic's child issues as `searchJiraIssuesUsingJql` returns them
// ({ issues: [{ key, fields: { labels, ... } }], isLast }, or the wrapped
// shape the same server also answers); for Linear the project's `list_issues`
// answer in its measured shape ({ issues: [{ id, labels, projectMilestone:
// { id }, ... }], hasNextPage, cursor? } — no `pageInfo`, no `identifier`),
// filtered to the milestone by its project-milestone id. A missing,
// unreadable, malformed or not-last-page
// listing refuses; so does one omitting this repository's own FR tickets bound
// to the milestone, and so does `children=0`. A child carrying neither this
// repository's tag nor a declared sibling's tag refuses without `--partial`,
// naming the key and its labels. A complete, accounted listing passes and
// prints `children=<n>`. `--offer` grades every other state and prints one
// stderr line `children=not checked (offer)`. Without either flag a shared
// repository refuses naming both. Without a `repo_tag`, neither flag is
// required or read.
//
// Real git roots (GIT_ENV), torn down in a `finally`; one child spawned at a time.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { FIXTURE_TRACKER_PROJECT, commitAll, makeSpanFixture, type SpanFixture } from "./_span_fixture";
import { SHIP_GATE_DOOR, describeRun, lines, runModule, writePlan, type Run } from "./_sibling_state_fixture";
import { TAG_A, TAG_B, sharedClaudeMd, trackedFr } from "./_span_declare_fixture";

type Mode = "jira" | "linear";

const JIRA = { milestone: "M_GF_609", project: "GF", epic: "GF-609", ownKey: "GF-96090", siblingKey: "GF-96091" };
const LINEAR_UUID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_UUID = "7a1c3f00-0000-4000-8000-000000000001";
const LINEAR = {
  milestone: "M_550e84",
  project: FIXTURE_TRACKER_PROJECT,
  ownKey: "STE-96090",
  siblingKey: "STE-96091",
};

const FOREIGN_TAG = "glacy-app-ops";

interface ChildTree {
  readonly fx: SpanFixture;
  readonly a: string;
  readonly planFile: string;
  readonly milestone: string;
  readonly mode: Mode;
  readonly dir: string;
}

/**
 * A shared two-root tree: A and B tagged in one container, B idle on the
 * milestone and naming A back, A holding one archived FR bound to it.
 * `declared: false` leaves A's plan with no `spans_repos:`. `shared: false`
 * rebinds A without a `repo_tag` (and B stays tagged).
 */
async function withChildren<T>(
  mode: Mode,
  body: (t: ChildTree) => Promise<T> | T,
  opts: { declared?: boolean; shared?: boolean; siblingBusy?: boolean } = {},
): Promise<T> {
  const k = mode === "jira" ? JIRA : LINEAR;
  const fx = makeSpanFixture(k.milestone);
  const dir = mkdtempSync(join(tmpdir(), "dpt-610-children-"));
  try {
    const bind = { mode, project: k.project } as const;
    sharedClaudeMd(fx.a, opts.shared === false ? null : TAG_A, bind);
    commitAll(fx.a, "fixture: A bound");
    sharedClaudeMd(fx.b, TAG_B, bind);
    writePlan(fx.b, "live", k.milestone, { [TAG_A]: relative(fx.b, fx.a), [TAG_B]: "." });
    trackedFr(fx.b, k.siblingKey, k.milestone, "archived", mode);
    if (opts.siblingBusy) trackedFr(fx.b, `${k.siblingKey}9`, k.milestone, "active", mode);
    commitAll(fx.b, "fixture: B idle on the milestone");
    const planFile = writePlan(
      fx.a,
      "live",
      k.milestone,
      opts.declared === false ? {} : { [TAG_A]: ".", [TAG_B]: relative(fx.a, fx.b) },
    );
    trackedFr(fx.a, k.ownKey, k.milestone, "archived", mode);
    return await body({ fx, a: fx.a, planFile, milestone: k.milestone, mode, dir });
  } finally {
    try {
      fx.cleanup();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------- listings

function jiraChild(key: string, labels: string[]): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Child ${key}`,
      labels,
      description: `Source: specs/frs/${key}.md`,
      creator: { displayName: "Fixture Author" },
      issuetype: { name: "Task", hierarchyLevel: 0 },
      project: { key: JIRA.project },
      status: { name: "Done", statusCategory: { key: "done" } },
      parent: { key: JIRA.epic },
    },
  };
}

/** One Linear `list_issues` row in the measured shape: keyed by `id`, `team` a display name. */
function linearIssue(key: string, labels: string[], milestoneUuid = LINEAR_UUID): Record<string, unknown> {
  return {
    id: key,
    title: `Child ${key}`,
    description: `Source: specs/frs/${key}.md`,
    createdBy: "Fixture Author",
    labels,
    project: LINEAR.project,
    projectMilestone: { id: milestoneUuid, name: `Milestone ${milestoneUuid.slice(0, 6)}` },
    team: "Example Team Display Name",
  };
}

/** A page of `children` in the tracker's measured shape; `last: false` hands the cursor for the next. */
function page(mode: Mode, children: Record<string, unknown>[], last = true): unknown {
  return mode === "jira"
    ? { issues: children, isLast: last, ...(last ? {} : { nextPageToken: "t-next" }) }
    : { issues: children, hasNextPage: !last, ...(last ? {} : { cursor: "c-next" }) };
}

function child(mode: Mode, which: "own" | "sibling" | string, labels: string[]): Record<string, unknown> {
  const k = mode === "jira" ? JIRA : LINEAR;
  const key = which === "own" ? k.ownKey : which === "sibling" ? k.siblingKey : which;
  return mode === "jira" ? jiraChild(key, labels) : linearIssue(key, labels);
}

/** The complete, accounted child listing: A's own ticket and B's, each tagged. */
const accounted = (mode: Mode): Record<string, unknown>[] => [
  child(mode, "own", [TAG_A]),
  child(mode, "sibling", [TAG_B]),
];

function save(t: ChildTree, content: unknown, name = "children.json", raw = false): string {
  const p = join(t.dir, name);
  writeFileSync(p, raw ? String(content) : JSON.stringify(content));
  return p;
}

const gate = (t: ChildTree, ...flags: string[]): Run =>
  runModule(SHIP_GATE_DOOR, [t.a, t.planFile, t.milestone, ...flags]);

const both = (r: Run): string => `${r.stdout}\n${r.stderr}`;

function expectRefused(r: Run, ...needles: string[]): void {
  expect(r.status, describeRun(r)).toBe(1);
  expect(r.stderr, describeRun(r)).toMatch(/^\/ship-milestone: /);
  for (const n of needles) expect(r.stderr, describeRun(r)).toContain(n);
}

// ===========================================================================
// The flag contract
// ===========================================================================

describe("AC-STE-610.6 — a shared repository's release names its children", () => {
  test("without --children or --offer a shared repository refuses, naming both (red on HEAD: exit 0)", async () => {
    await withChildren("jira", (t) => {
      const r = gate(t);
      expectRefused(r, "--children", "--offer");
      expect(r.stdout, describeRun(r)).toBe("");
    });
  }, 30_000);

  test("Jira permit leg: a complete listing whose every child carries an accounted tag passes and prints children=2 (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const r = gate(t, "--children", save(t, page("jira", accounted("jira"))));
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout).toContain(`Spans: ${TAG_B}@pending`);
      expect(both(r)).toMatch(/(^|\s)children=2(\s|$)/m);
    });
  }, 30_000);

  test("Linear permit leg: the project's issues are filtered to the milestone by identifier — another milestone's foreign issue is not a child (red on HEAD)", async () => {
    await withChildren("linear", (t) => {
      const issues = [...accounted("linear"), linearIssue("STE-96999", [FOREIGN_TAG], OTHER_UUID)];
      const r = gate(t, "--children", save(t, page("linear", issues)));
      expect(r.status, describeRun(r)).toBe(0);
      expect(both(r)).toMatch(/(^|\s)children=2(\s|$)/m);
    });
  }, 30_000);

  test("--offer grades every other state and says in one stderr line what it skipped (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const r = gate(t, "--offer");
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout).toBe(`Spans: ${TAG_B}@pending\n`);
      expect(lines(r.stderr)).toEqual(["children=not checked (offer)"]);
    });
  }, 30_000);

  test("(control) --offer still refuses a busy sibling", async () => {
    await withChildren(
      "jira",
      (t) => {
        expectRefused(gate(t, "--offer"), TAG_B, "busy");
      },
      { siblingBusy: true },
    );
  }, 30_000);
});

// ===========================================================================
// Foreign work holds the release
// ===========================================================================

describe("AC-STE-610.6 — a child carrying no accounted tag refuses the release", () => {
  test("FE undeclared while BE's tagged child sits under FE's Epic refuses, naming the child and its label (red on HEAD: exit 0)", async () => {
    await withChildren(
      "jira",
      (t) => {
        const r = gate(t, "--children", save(t, page("jira", accounted("jira"))));
        expectRefused(r, JIRA.siblingKey, TAG_B);
        expect(r.stdout, describeRun(r)).toBe("");
      },
      { declared: false },
    );
  }, 30_000);

  test("permit leg: FE undeclared with only its own tagged child passes and prints children=1 (red on HEAD)", async () => {
    await withChildren(
      "jira",
      (t) => {
        const r = gate(t, "--children", save(t, page("jira", [child("jira", "own", [TAG_A])])));
        expect(r.status, describeRun(r)).toBe(0);
        expect(both(r)).toMatch(/(^|\s)children=1(\s|$)/m);
      },
      { declared: false },
    );
  }, 30_000);

  test("Jira: a child tagged for an undeclared repository refuses, naming the key and its labels (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const listing = [...accounted("jira"), child("jira", "GF-96099", [FOREIGN_TAG])];
      expectRefused(gate(t, "--children", save(t, page("jira", listing))), "GF-96099", FOREIGN_TAG);
    });
  }, 30_000);

  test("Linear: a child of this milestone tagged for an undeclared repository refuses, naming the key and its labels (red on HEAD)", async () => {
    await withChildren("linear", (t) => {
      const listing = [...accounted("linear"), linearIssue("STE-96099", [FOREIGN_TAG])];
      expectRefused(gate(t, "--children", save(t, page("linear", listing))), "STE-96099", FOREIGN_TAG);
    });
  }, 30_000);

  test("a hand-filed child with no tag at all refuses, naming the key (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const listing = [...accounted("jira"), child("jira", "GF-96098", [])];
      expectRefused(gate(t, "--children", save(t, page("jira", listing))), "GF-96098");
    });
  }, 30_000);

  test("(control) --partial ships this half past a foreign child", async () => {
    await withChildren("jira", (t) => {
      const listing = [...accounted("jira"), child("jira", "GF-96099", [FOREIGN_TAG])];
      const r = gate(t, "--partial", "--children", save(t, page("jira", listing)));
      expect(r.status, describeRun(r)).toBe(0);
    });
  }, 30_000);
});

// ===========================================================================
// An incomplete listing refuses
// ===========================================================================

describe("AC-STE-610.6 — a listing that cannot prove itself complete refuses", () => {
  test("a missing listing file refuses, naming it (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const missing = join(t.dir, "no-such-listing.json");
      expectRefused(gate(t, "--children", missing), "no-such-listing.json");
    });
  }, 30_000);

  test("an unreadable listing (a directory) refuses (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      expectRefused(gate(t, "--children", t.dir));
    });
  }, 30_000);

  test("a listing that is not JSON refuses (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      expectRefused(gate(t, "--children", save(t, "{ not json", "bad.json", true)));
    });
  }, 30_000);

  test("a JSON listing with no issues array refuses (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      expectRefused(gate(t, "--children", save(t, { children: accounted("jira"), isLast: true })));
    });
  }, 30_000);

  test("Jira: a page that is not the last one refuses (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      expectRefused(gate(t, "--children", save(t, page("jira", accounted("jira"), false))));
    });
  }, 30_000);

  test("Linear: a page reporting hasNextPage refuses (red on HEAD)", async () => {
    await withChildren("linear", (t) => {
      expectRefused(gate(t, "--children", save(t, page("linear", accounted("linear"), false))));
    });
  }, 30_000);

  test("a listing omitting this repository's own FR ticket refuses, naming the missing key (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const r = gate(t, "--children", save(t, page("jira", [child("jira", "sibling", [TAG_B])])));
      expectRefused(r, JIRA.ownKey);
    });
  }, 30_000);

  test("an empty child list prints children=0 and refuses as incomplete (red on HEAD)", async () => {
    await withChildren("jira", (t) => {
      const r = gate(t, "--children", save(t, page("jira", [])));
      expect(r.status, describeRun(r)).toBe(1);
      expect(both(r)).toMatch(/(^|\s)children=0(\s|$)/m);
    });
  }, 30_000);
});

// ===========================================================================
// Unshared repositories are untouched
// ===========================================================================

describe("AC-STE-610.6 — without a repo_tag, refusal #4 is byte-identical to STE-609 (controls)", () => {
  test("(control) no flag: exit 0, the footer alone on stdout, nothing on stderr", async () => {
    await withChildren(
      "jira",
      (t) => {
        const r = gate(t);
        expect(r.status, describeRun(r)).toBe(0);
        expect(r.stdout).toBe(`Spans: ${TAG_B}@pending\n`);
        expect(r.stderr).toBe("");
      },
      { shared: false },
    );
  }, 30_000);

  test("(control) --children is not read: a missing listing file changes nothing", async () => {
    await withChildren(
      "jira",
      (t) => {
        const r = gate(t, "--children", join(t.dir, "no-such-listing.json"));
        expect(r.status, describeRun(r)).toBe(0);
        expect(r.stdout).toBe(`Spans: ${TAG_B}@pending\n`);
      },
      { shared: false },
    );
  }, 30_000);
});


// Orchestrator hardening (AUDIT): a release gate reads completeness from the
// page's own signal. A page that never SAYS it is the last one has not proved
// the milestone's child list complete — the same rule create_idempotency_probe
// applies to these MCP answers.
describe("AC-STE-610.6 hardening — a page must prove it is the last page", () => {
  test("Jira: a child page with no isLast refuses as incomplete", async () => {
    await withChildren("jira", (t) => {
      expectRefused(gate(t, "--children", save(t, { issues: accounted("jira") })));
    });
  }, 30_000);

  test("Linear: a child page with no hasNextPage refuses as incomplete", async () => {
    await withChildren("linear", (t) => {
      expectRefused(gate(t, "--children", save(t, { issues: accounted("linear") })));
    });
  }, 30_000);

  test("(control) the same children on a page that says it is last pass", async () => {
    await withChildren("jira", (t) => {
      const r = gate(t, "--children", save(t, page("jira", accounted("jira"), true)));
      expect(r.status, describeRun(r)).toBe(0);
    });
  }, 30_000);
});

// ===========================================================================
// M_685ff6 pre-PR review — a large Linear project pages its children. The
// listing may be the JSON array of every cursor page, in order: each page but
// the last says it is not (Linear `hasNextPage: true` with its `cursor`,
// Jira `isLast: false`) and the last proves it is. Red on 07655a75, where an
// array is not a page at all and a project past one page can never release.
// ===========================================================================

describe("M_685ff6 review — a paged child listing is read whole", () => {
  // Amended by the M_685ff6 review r2: each page after the first records the
  // cursor it was requested with (`requestCursor`), so the pages chain.
  const linearPage = (issues: Record<string, unknown>[], next: string | null, requested?: string): unknown => ({
    issues,
    hasNextPage: next !== null,
    ...(next !== null ? { cursor: next } : {}),
    ...(requested !== undefined ? { requestCursor: requested } : {}),
  });
  // Amended by the M_685ff6 review r2: every page's filler carries its own
  // keys (`from`), since a key on two pages now refuses as a duplicated page.
  const filler = (n: number, from = 0): Record<string, unknown>[] =>
    Array.from({ length: n }, (_, i) => linearIssue(`STE-9${String(from + i).padStart(4, "0")}`, [FOREIGN_TAG], OTHER_UUID));

  test("Linear: three cursor pages (250 + 250 + rest) holding the two children pass and print children=2", async () => {
    await withChildren("linear", (t) => {
      const pages = [
        linearPage([child("linear", "own", [TAG_A]), ...filler(249)], "c1"),
        linearPage(filler(250, 249), "c2", "c1"),
        linearPage([child("linear", "sibling", [TAG_B]), ...filler(10, 499)], null, "c2"),
      ];
      const r = gate(t, "--children", save(t, pages));
      expect(r.status, describeRun(r)).toBe(0);
      expect(both(r)).toMatch(/(^|\s)children=2(\s|$)/m);
    });
  }, 30_000);

  test("Jira: two pages (isLast false, then true) pass and print children=2", async () => {
    await withChildren("jira", (t) => {
      const pages = [
        { issues: [child("jira", "own", [TAG_A])], isLast: false, nextPageToken: "t1" },
        { issues: [child("jira", "sibling", [TAG_B])], isLast: true, requestCursor: "t1" },
      ];
      const r = gate(t, "--children", save(t, pages));
      expect(r.status, describeRun(r)).toBe(0);
      expect(both(r)).toMatch(/(^|\s)children=2(\s|$)/m);
    });
  }, 30_000);

  test("Linear: pages whose LAST page still reports hasNextPage refuse", async () => {
    await withChildren("linear", (t) => {
      const pages = [linearPage([child("linear", "own", [TAG_A])], "c1"), linearPage([child("linear", "sibling", [TAG_B])], "c2", "c1")];
      expectRefused(gate(t, "--children", save(t, pages)), "last page");
    });
  }, 30_000);

  test("Linear: a page claiming to be last in the middle of the array refuses", async () => {
    await withChildren("linear", (t) => {
      const pages = [linearPage([child("linear", "own", [TAG_A])], null), linearPage([child("linear", "sibling", [TAG_B])], null)];
      expectRefused(gate(t, "--children", save(t, pages)), "page 1");
    });
  }, 30_000);

  test("Linear: a page repeated (the same cursor twice) refuses", async () => {
    await withChildren("linear", (t) => {
      const pages = [
        linearPage([child("linear", "own", [TAG_A])], "c1"),
        linearPage([child("linear", "own", [TAG_A])], "c1", "c1"),
        linearPage([child("linear", "sibling", [TAG_B])], null, "c1"),
      ];
      // Amended by the M_685ff6 review r2: the repeated page is now caught at
      // its repeated key, before its repeated cursor.
      expectRefused(gate(t, "--children", save(t, pages)), LINEAR.ownKey);
    });
  }, 30_000);

  test("(control) an empty array of pages refuses", async () => {
    await withChildren("linear", (t) => {
      expectRefused(gate(t, "--children", save(t, [])));
    });
  }, 30_000);
});

describe("M_685ff6 review — refusal #4's prose says how to page a Linear listing", () => {
  const refusal4 = (): string => {
    const skill = readFileSync(join(import.meta.dir, "..", "skills", "ship-milestone", "SKILL.md"), "utf-8");
    return skill.split("\n").find((l) => l.startsWith("4. **Sibling not provably idle**")) ?? "";
  };
  /**
   * The measured paging model (tests/fixtures/live-shapes/): a Linear page
   * hands a top-level `cursor` (there is no `endCursor`), and Jira pages in
   * either of its two shapes — plain `nextPageToken`, wrapped
   * `issues.pageInfo.endCursor`. Returns what the line gets wrong.
   */
  const pagingViolations = (line: string): string[] => {
    const v: string[] = [];
    if (!line.includes("includeArchived: true")) v.push("no includeArchived: true");
    if (!line.includes("top-level `cursor`")) v.push("Linear paging does not name the top-level `cursor`");
    if (/previous page's `endCursor`/.test(line)) v.push("Linear paging names an `endCursor` (the invented pageInfo model)");
    if (!/until `hasNextPage` is false/.test(line)) v.push("no until `hasNextPage` is false");
    if (!line.includes("`nextPageToken`")) v.push("the plain Jira shape's `nextPageToken` is not named");
    if (!line.includes("`issues.pageInfo.endCursor`")) v.push("the wrapped Jira shape's `issues.pageInfo.endCursor` is not named");
    // M_685ff6 review r2: each page after the first records its requestCursor.
    if (!line.includes("`requestCursor`")) v.push("no `requestCursor`");
    return v;
  };

  test("the refusal #4 line orders includeArchived and top-level cursor paging to hasNextPage false, naming both Jira shapes", () => {
    const line = refusal4();
    expect(line).not.toBe("");
    expect(pagingViolations(line)).toEqual([]);
  });

  test("MUTATION — the line reverted to the invented `previous page's endCursor` wording is red", () => {
    const line = refusal4();
    const reverted = line.replace("the previous page's top-level `cursor`", "the previous page's `endCursor`");
    expect(reverted, "the mutation must apply").not.toBe(line);
    expect(pagingViolations(reverted)).toEqual([
      "Linear paging does not name the top-level `cursor`",
      "Linear paging names an `endCursor` (the invented pageInfo model)",
    ]);
  });
});

describe("M_685ff6 review r2 — paged child listings chain", () => {
  const lp = (issues: Record<string, unknown>[], next: string | null, requested?: string): unknown => ({
    issues,
    hasNextPage: next !== null,
    ...(next !== null ? { cursor: next } : {}),
    ...(requested !== undefined ? { requestCursor: requested } : {}),
  });

  test("Linear: a dropped middle page (page 3 requested with c2, page 1 ended at c1) refuses", async () => {
    await withChildren("linear", (t) => {
      const pages = [
        lp([child("linear", "own", [TAG_A])], "c1"),
        lp([child("linear", "sibling", [TAG_B])], null, "c2"),
      ];
      expectRefused(gate(t, "--children", save(t, pages)), "c1");
    });
  }, 30_000);

  test("Linear: a page after the first that records no requestCursor refuses", async () => {
    await withChildren("linear", (t) => {
      const pages = [lp([child("linear", "own", [TAG_A])], "c1"), lp([child("linear", "sibling", [TAG_B])], null)];
      expectRefused(gate(t, "--children", save(t, pages)), "requestCursor");
    });
  }, 30_000);

  test("Jira: a duplicated page (the same keys twice, tokens chained) refuses, naming the key", async () => {
    await withChildren("jira", (t) => {
      const pages = [
        { issues: [child("jira", "own", [TAG_A])], isLast: false, nextPageToken: "t1" },
        { issues: [child("jira", "own", [TAG_A])], isLast: false, nextPageToken: "t2", requestCursor: "t1" },
        { issues: [child("jira", "sibling", [TAG_B])], isLast: true, requestCursor: "t2" },
      ];
      expectRefused(gate(t, "--children", save(t, pages)), JIRA.ownKey);
    });
  }, 30_000);

  test("Linear: a repeated cursor with distinct keys (a page that did not advance) refuses", async () => {
    await withChildren("linear", (t) => {
      const pages = [
        lp([child("linear", "own", [TAG_A])], "c1"),
        lp([linearIssue("STE-97001", [FOREIGN_TAG], OTHER_UUID)], "c1", "c1"),
        lp([child("linear", "sibling", [TAG_B])], null, "c1"),
      ];
      expectRefused(gate(t, "--children", save(t, pages)), "c1");
    });
  }, 30_000);

  test("Jira: a non-last page with no nextPageToken refuses", async () => {
    await withChildren("jira", (t) => {
      const pages = [
        { issues: [child("jira", "own", [TAG_A])], isLast: false },
        { issues: [child("jira", "sibling", [TAG_B])], isLast: true, requestCursor: "t1" },
      ];
      expectRefused(gate(t, "--children", save(t, pages)), "nextPageToken");
    });
  }, 30_000);
});
