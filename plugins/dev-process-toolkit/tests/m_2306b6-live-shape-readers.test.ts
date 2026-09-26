// M_2306b6 — every tracker page reader reads the MEASURED shapes, through the
// one reader in adapters/_shared/src/tracker_answer.ts.
//
// The answers fed here are built from tests/fixtures/live-shapes/ (read-only
// calls and recorded transcripts, each with its provenance): Linear pages are
// top-level `hasNextPage` + `cursor` with no `pageInfo`; a Linear row's key is
// its top-level `id` and its `team` is the DISPLAY name; Jira answers come
// plain (`issues` + `isLast`) or wrapped (`context` + `issues.nodes` +
// `issues.pageInfo`). Each permit has a refusal twin, and each refusal a permit
// twin, so no row here can pass by the reader refusing everything.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as containerOwnership from "../adapters/_shared/src/container_ownership";
const { normalizeContainerPage, pageIsLast } = containerOwnership;
const normalizeContainerItems = (...a: Parameters<typeof containerOwnership.normalizeContainerPage>) => (containerOwnership as any).normalizeContainerItems(...a);
import * as resolveMilestoneIdentity from "../adapters/_shared/src/resolve_milestone_identity";
import { readListingFile } from "../adapters/_shared/src/resolve_milestone_identity";
import { gradeChildren } from "../adapters/_shared/src/sibling_release";
import * as trackerAnswer from "../adapters/_shared/src/tracker_answer";
import { declareJira as declareOrphanJira, declareLinear as declareOrphanLinear, DRIFT_MODULE, jiraIssue, spawnModule } from "./_orphan_pages";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const PROBE = join(SRC, "create_idempotency_probe.ts");
const SHAPES = join(import.meta.dir, "fixtures", "live-shapes");

/** A pinned live answer (the `answer` half of `{provenance, answer}`), deep-copied. */
const live = (tracker: "jira" | "linear", name: string): Record<string, any> =>
  structuredClone(JSON.parse(readFileSync(join(SHAPES, tracker, `${name}.json`), "utf-8")).answer);

let manifestDir = "";
let scratch = "";
const SESSION = `live-shape-readers-${process.pid}`;

beforeAll(() => {
  manifestDir = mkdtempSync(join(tmpdir(), "dpt-live-shape-manifest-"));
  pluginManifest(manifestDir, "2.87.0");
  scratch = mkdtempSync(join(tmpdir(), "dpt-live-shape-pages-"));
});
afterAll(() => {
  rmSync(manifestDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

let seq = 0;
function writeJson(content: unknown): string {
  seq += 1;
  const p = join(scratch, `answer-${seq}.json`);
  writeFileSync(p, JSON.stringify(content));
  return p;
}

// ---------------------------------------------------------------- live rows

const TAG = "glacy-be";
const TITLE = "The reward banner - repainted light";
const LINEAR_MS_ID = "ms-3fa85f64";
const EPIC = "GF-40";

/** One live `list_issues` row (display-name `team`, key in `id`), retitled onto this test's subject. */
function linearRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const row = live("linear", "list_issues.last").issues[0];
  return { ...row, title: TITLE, labels: [TAG], projectMilestone: { id: LINEAR_MS_ID, name: "M" }, ...over };
}

/** The live Linear page envelope: top-level `hasNextPage`, `cursor` only when more follow. */
function linearPage(issues: unknown[], cursor: string | null = null): Record<string, unknown> {
  const envelope = live("linear", cursor === null ? "list_issues.last" : "list_issues.more");
  return { ...envelope, issues, ...(cursor === null ? {} : { cursor }) };
}

/** A Jira search node for the probe's conjuncts. */
function jiraNode(key: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    id: "63514",
    fields: { summary: TITLE, labels: [TAG], issuetype: { name: "Task" }, project: { key: "GF" }, parent: { key: EPIC }, ...over },
  };
}

/** The live WRAPPED Jira envelope around `nodes`; `endCursor` set means more follow. */
function wrappedPage(nodes: unknown[], endCursor: string | null = null): Record<string, any> {
  const envelope = live("jira", endCursor === null ? "search.wrapped.last" : "search.wrapped.more");
  envelope.issues.nodes = nodes;
  envelope.issues.pageInfo = endCursor === null ? { hasNextPage: false, endCursor: null } : { hasNextPage: true, endCursor };
  return envelope;
}

// ===========================================================================
// create_idempotency_probe — `decide` reads live pages
// ===========================================================================

function withRoot<T>(bind: (root: string) => void, body: (root: string) => T): T {
  // Not `declare`: Bun erases a bare `declare(...)` call as a TypeScript declaration.
  const fx = makeSpanFixture("M_GF_40", { repositories: false });
  try {
    bind(fx.b);
    return body(fx.b);
  } finally {
    fx.cleanup();
  }
}
// The binding names the project as the live rows carry it (its name); the team
// by its KEY, which the rows never carry except as their identifier's prefix.
const LIVE_PROJECT = live("linear", "list_issues.last").issues[0].project as string;
const sharedLinear = (root: string) =>
  claudeMd(root, { mode: "linear", team: "STE", project: LIVE_PROJECT, defaultLabels: [TAG], repoTag: TAG, minDptVersion: "2.87.0" });
const sharedJira = (root: string) =>
  claudeMd(root, { mode: "jira", project: "GF", defaultLabels: [TAG], repoTag: TAG, minDptVersion: "2.87.0" });

function decide(root: string, pages: unknown[], container: string[], attempt = "fast"): Record<string, any> {
  const proc = Bun.spawnSync(
    ["bun", "run", PROBE, "decide", root, ...pages.map(writeJson), "--title", TITLE, ...container, "--attempt", attempt],
    { env: { ...process.env, CLAUDE_PLUGIN_ROOT: manifestDir, CLAUDE_CODE_SESSION_ID: SESSION }, stdout: "pipe", stderr: "pipe" },
  );
  const line = proc.stdout.toString().split("\n").find((l) => l.startsWith("{"));
  expect(line, `decide printed no decision: exit ${proc.exitCode}\n${proc.stderr.toString()}`).toBeDefined();
  return JSON.parse(line!);
}
const LINEAR_C = ["--linear-milestone", LINEAR_MS_ID];
const JIRA_C = ["--parent", EPIC];

describe("create_idempotency_probe — decide over live Linear pages", () => {
  test("a live last page carrying this team's same-titled row (display-name `team`) is reused", () => {
    withRoot(sharedLinear, (root) => {
      const d = decide(root, [linearPage([linearRow()])], LINEAR_C);
      expect(d).toMatchObject({ outcome: "reused", key: "STE-618" });
    });
  }, 30_000);

  test("twin: the same row keyed in another team (id prefix OPS) refuses page-violates-query", () => {
    withRoot(sharedLinear, (root) => {
      const d = decide(root, [linearPage([linearRow({ id: "OPS-12" })])], LINEAR_C);
      expect(d).toMatchObject({ outcome: "refused", reason: "page-violates-query" });
    });
  }, 30_000);

  test("twin: a row whose id carries no team key (a uuid) makes the page unreadable", () => {
    withRoot(sharedLinear, (root) => {
      const d = decide(root, [linearPage([linearRow({ id: "0884f88d-f761-4ccd-b360-5e40cac85451" })])], LINEAR_C);
      expect(d).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
  }, 30_000);

  test("a live more-page then a last page: a miss on both is a create; the more-page alone is page-cap", () => {
    withRoot(sharedLinear, (root) => {
      const other = linearRow({ title: "Something else" });
      expect(decide(root, [linearPage([other], "c1"), { ...linearPage([]), requestCursor: "c1" }], LINEAR_C).outcome).toBe("create");
      expect(decide(root, [linearPage([other], "c1")], LINEAR_C)).toMatchObject({ outcome: "refused", reason: "page-cap" });
    });
  }, 30_000);

  // The dropped-page duplicate (Stage B, round 3): the decision took `capped`
  // from whichever page file came last, so a set missing its middle page — the
  // one holding the existing ticket — read complete and returned `create`. A
  // multi-page listing is now read as ONE chain (tracker_answer's
  // readTrackerListing, the rule sibling_release already had): each page after
  // the first records the cursor it was requested with, equal to the previous
  // page's `next`.
  const chained = (rows: Record<string, unknown>[], next: string | null, requestCursor?: string) => ({ ...linearPage(rows, next), ...(requestCursor ? { requestCursor } : {}) });
  test("HARM — pages 1 and 3 without page 2 (which holds the existing ticket): refused, never a create", () => {
    withRoot(sharedLinear, (root) => {
      const other = linearRow({ title: "Something else", id: "STE-700" });
      const other2 = linearRow({ title: "Another thing", id: "STE-701" });
      const d = decide(root, [chained([other], "c1"), chained([other2], null, "c2")], LINEAR_C);
      expect(d.outcome).not.toBe("create");
      expect(d).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
  }, 30_000);
  test("HARM — a reordered set (page 2, page 1, page 3) is refused, never a create", () => {
    withRoot(sharedLinear, (root) => {
      const a = linearRow({ title: "Something else", id: "STE-700" });
      const b = linearRow({ title: "Another thing", id: "STE-701" });
      const c = linearRow({ title: "A third thing", id: "STE-702" });
      const d = decide(root, [chained([b], "c2", "c1"), chained([a], "c1"), chained([c], null, "c2")], LINEAR_C);
      expect(d).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
  }, 30_000);
  test("PERMIT — the whole chain, correctly linked, finds the ticket on page 2 and reuses it", () => {
    withRoot(sharedLinear, (root) => {
      const a = linearRow({ title: "Something else", id: "STE-700" });
      const c = linearRow({ title: "A third thing", id: "STE-702" });
      const d = decide(root, [chained([a], "c1"), chained([linearRow()], "c2", "c1"), chained([c], null, "c2")], LINEAR_C);
      expect(d).toMatchObject({ outcome: "reused", key: "STE-618" });
    });
  }, 30_000);
  test("PERMIT — the whole chain with no match is a create (the normal multi-page case is not made stricter)", () => {
    withRoot(sharedLinear, (root) => {
      const a = linearRow({ title: "Something else", id: "STE-700" });
      const c = linearRow({ title: "A third thing", id: "STE-702" });
      expect(decide(root, [chained([a], "c1"), chained([c], null, "c1")], LINEAR_C).outcome).toBe("create");
    });
  }, 30_000);
  test("HARM, Jira wrapped — a dropped middle page is refused too (one chain rule for both trackers and shapes)", () => {
    withRoot(sharedJira, (root) => {
      const p1 = wrappedPage([jiraNode("GF-700", { summary: "Something else" })], "e1");
      const p3 = { ...wrappedPage([jiraNode("GF-701", { summary: "Another thing" })], null), requestCursor: "e2" };
      expect(decide(root, [p1, p3], JIRA_C)).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
  }, 30_000);

  test("an unrecorded shape — the invented `pageInfo` Linear page — fails closed as page-unreadable", () => {
    withRoot(sharedLinear, (root) => {
      const d = decide(root, [{ issues: [linearRow()], pageInfo: { hasNextPage: false, endCursor: null } }], LINEAR_C);
      expect(d).toMatchObject({ outcome: "refused", reason: "page-unreadable" });
    });
  }, 30_000);
});

describe("create_idempotency_probe — decide over wrapped Jira pages", () => {
  test("a wrapped last page carrying this repository's same-titled ticket is reused", () => {
    withRoot(sharedJira, (root) => {
      expect(decide(root, [wrappedPage([jiraNode("GF-501")])], JIRA_C)).toMatchObject({ outcome: "reused", key: "GF-501" });
    });
  }, 30_000);

  test("twin: a wrapped page whose ticket carries another repository's tag refuses page-violates-query", () => {
    withRoot(sharedJira, (root) => {
      const d = decide(root, [wrappedPage([jiraNode("GF-501", { labels: ["glacy-fe"] })])], JIRA_C);
      expect(d).toMatchObject({ outcome: "refused", reason: "page-violates-query" });
    });
  }, 30_000);

  test("twin: a wrapped page saying more follow, with no match, is page-cap", () => {
    withRoot(sharedJira, (root) => {
      const d = decide(root, [wrappedPage([jiraNode("GF-502", { summary: "Else" })], "CkljcmVhdGVk")], JIRA_C);
      expect(d).toMatchObject({ outcome: "refused", reason: "page-cap" });
    });
  }, 30_000);
});

// ===========================================================================
// container_ownership — completeness is proven, never assumed
// ===========================================================================

describe("container_ownership — pageIsLast reads through the shared reader", () => {
  test("a live Linear more-page is not last; the live last page is", () => {
    expect(pageIsLast(live("linear", "list_issues.more"), "linear")).toBe(false);
    expect(pageIsLast(live("linear", "list_issues.last"), "linear")).toBe(true);
  });

  test("a Linear page with no `hasNextPage` is not read as last: it is refused", () => {
    expect(() => pageIsLast({ issues: [] }, "linear")).toThrow(/hasNextPage/);
  });

  test("an unrecorded Linear shape (`pageInfo`) is refused, not read as last", () => {
    expect(() => pageIsLast({ issues: [], pageInfo: { hasNextPage: false } }, "linear")).toThrow(/pageInfo/);
  });

  test("a wrapped Jira more-page is not last; the wrapped last page is; a plain page with no isLast is refused", () => {
    expect(pageIsLast(live("jira", "search.wrapped.more"), "jira")).toBe(false);
    expect(pageIsLast(live("jira", "search.wrapped.last"), "jira")).toBe(true);
    expect(pageIsLast(live("jira", "search.plain.last"), "jira")).toBe(true);
    expect(() => pageIsLast({ issues: [] }, "jira")).toThrow(/isLast/);
  });
});

describe("container_ownership — the item reading accepts wrapped Jira nodes and live Linear rows", () => {
  test("a wrapped Jira page reads its nodes as tickets", () => {
    const tickets = normalizeContainerPage(live("jira", "search.wrapped.last"), "jira");
    expect(tickets.map((t) => t.key)).toEqual(["GF-28"]);
  });

  test("a live Linear page reads each row's key from `id`", () => {
    const tickets = normalizeContainerPage(live("linear", "list_issues.last"), "linear");
    expect(tickets.map((t) => t.key)).toEqual(["STE-618", "STE-584"]);
  });

  test("twin: an unrecorded page shape is refused by the item reading too", () => {
    expect(() => normalizeContainerPage({ issues: [], pageInfo: { hasNextPage: false } }, "linear")).toThrow(/pageInfo/);
    expect(() => normalizeContainerPage({ issues: { nodes: [] } }, "jira")).toThrow(/either observed shape/);
  });

  test("normalizeContainerItems reads items with no page around them", () => {
    const [t] = normalizeContainerItems([live("linear", "save_issue.create")], "linear");
    expect(t!.key).toBe("STE-619");
  });
});

// ===========================================================================
// tracker_local_reconciliation_drift — the detector's front door
// ===========================================================================

describe("tracker_local_reconciliation_drift — live pages at the front door", () => {
  function detect(bind: (root: string) => void, pages: unknown[]) {
    return withRoot(bind, (root) => spawnModule(DRIFT_MODULE, [root, ...pages.map(writeJson)], { CLAUDE_PLUGIN_ROOT: manifestDir }));
  }

  test("a live Linear more-page as the final page is container-partial, not graded", () => {
    const r = detect((root) => declareOrphanLinear(root, null), [live("linear", "list_issues.more")]);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("container-partial");
  }, 30_000);

  test("twin: the live last page is graded", () => {
    const r = detect((root) => declareOrphanLinear(root, null), [live("linear", "list_issues.last")]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("severity:");
  }, 30_000);

  test("a wrapped Jira last page is graded, and a wrapped more-page is container-partial", () => {
    const nodes = [jiraIssue({ key: "GF-121", title: "Crash on login", labels: [], creator: "Pat" })];
    const ok = detect((root) => declareOrphanJira(root, null), [wrappedPage(nodes)]);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain("GF-121");
    const partial = detect((root) => declareOrphanJira(root, null), [wrappedPage(nodes, "CkljcmVhdGVk")]);
    expect(partial.code, partial.stdout + partial.stderr).toBe(1);
    expect(partial.stdout).toContain("container-partial");
  }, 30_000);

  test("an unrecorded page shape is container-unreadable", () => {
    const r = detect((root) => declareOrphanLinear(root, null), [{ issues: [], pageInfo: { hasNextPage: false } }]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("container-unreadable");
  }, 30_000);
});

// ===========================================================================
// The orphan listing and probe #49 read a multi-page listing as ONE chain
// ===========================================================================
//
// Before this round `listOrphans` called a listing complete only when EVERY
// page was last, which no correct multi-page listing can be, and probe #49
// checked only the final page, so a set missing its middle page was graded as
// if whole. Both now read the pages through readTrackerListing (the chain
// rule the create decision and the sibling check share).

describe("orphan listing and probe #49 — a multi-page listing is one unbroken chain", () => {
  const rowsOf = (n: "list_issues.more" | "list_issues.last") => live("linear", n).issues as Record<string, unknown>[];
  const p1 = () => ({ ...live("linear", "list_issues.more"), issues: [rowsOf("list_issues.more")[0]], cursor: "c1" });
  const p2 = () => ({ ...live("linear", "list_issues.more"), issues: [rowsOf("list_issues.more")[1]], cursor: "c2", requestCursor: "c1" });
  const p3 = (requestCursor: string) => ({ ...live("linear", "list_issues.last"), issues: [rowsOf("list_issues.last")[1]], requestCursor });

  test("PERMIT — a correctly linked two-page Linear listing is complete (it was never complete before)", () => {
    withRoot((root) => declareOrphanLinear(root, null), (root) => {
      expect(containerOwnership.listOrphans(root, [p1(), p3("c1")]).complete).toBe(true);
    });
  });
  test("PERMIT — one last page alone is complete, unchanged", () => {
    withRoot((root) => declareOrphanLinear(root, null), (root) => {
      expect(containerOwnership.listOrphans(root, [live("linear", "list_issues.last")]).complete).toBe(true);
    });
  });
  test("REFUSE — a listing missing its middle page is refused, never listed as if whole", () => {
    withRoot((root) => declareOrphanLinear(root, null), (root) => {
      expect(() => containerOwnership.listOrphans(root, [p1(), p3("c2")])).toThrow(/a page between them is missing/);
    });
  });
  test("probe #49 PERMIT — the whole three-page chain is graded", () => {
    const r = withRoot((root) => declareOrphanLinear(root, null), (root) => spawnModule(DRIFT_MODULE, [root, ...[p1(), p2(), p3("c2")].map(writeJson)], { CLAUDE_PLUGIN_ROOT: manifestDir }));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("severity:");
  }, 30_000);
  test("probe #49 REFUSE — the same listing with its middle page dropped is not graded", () => {
    const r = withRoot((root) => declareOrphanLinear(root, null), (root) => spawnModule(DRIFT_MODULE, [root, ...[p1(), p3("c2")].map(writeJson)], { CLAUDE_PLUGIN_ROOT: manifestDir }));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/error container-partial: .*a page between them is missing/);
  }, 30_000);
});

// ===========================================================================
// sibling_release — the children listing
// ===========================================================================

const LINEAR_UUID = "550e8400-e29b-41d4-a716-446655440000";
const OWN = "STE-96090";
const SIB = "STE-96091";

function linearChild(id: string, label: string): Record<string, unknown> {
  return linearRow({
    id,
    title: `Child ${id}`,
    labels: [label],
    description: `Source: specs/frs/${id}.md`,
    projectMilestone: { id: LINEAR_UUID, name: "Milestone" },
  });
}

function grade(adapter: "jira" | "linear", listing: unknown, ownKeys: string[]) {
  return gradeChildren({
    listing,
    adapter,
    milestone: adapter === "linear" ? "M_550e84" : "M_GF_609",
    repoTag: "tag-a",
    declaredTags: ["tag-b"],
    ownKeys,
    partial: false,
    source: "children.json",
  });
}

function jiraChild(key: string, label: string): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Child ${key}`,
      labels: [label],
      description: `Source: specs/frs/${key}.md`,
      creator: { displayName: "Fixture Author" },
      issuetype: { name: "Task", hierarchyLevel: 0 },
      project: { key: "GF" },
    },
  };
}

describe("sibling_release — gradeChildren reads live Linear and wrapped Jira listings", () => {
  test("a live Linear last page with both children is complete", () => {
    const g = grade("linear", linearPage([linearChild(OWN, "tag-a"), linearChild(SIB, "tag-b")]), [OWN]);
    expect(g).toEqual({ refusal: null, count: 2 });
  });

  test("twin: a live Linear more-page alone does not prove the listing complete", () => {
    const g = grade("linear", linearPage([linearChild(OWN, "tag-a")], "c1"), [OWN]);
    expect(g.refusal).toContain("last page");
  });

  test("two live Linear pages chain: page 2's requestCursor is page 1's cursor", () => {
    const pages = [linearPage([linearChild(OWN, "tag-a")], "c1"), { ...linearPage([linearChild(SIB, "tag-b")]), requestCursor: "c1" }];
    expect(grade("linear", pages, [OWN])).toEqual({ refusal: null, count: 2 });
  });

  test("twin: page 2 requested with another cursor is a missing page", () => {
    const pages = [linearPage([linearChild(OWN, "tag-a")], "c1"), { ...linearPage([linearChild(SIB, "tag-b")]), requestCursor: "c9" }];
    expect(grade("linear", pages, [OWN]).refusal).toContain("c1");
  });

  test("an unrecorded shape (the invented `pageInfo` Linear page) refuses", () => {
    const g = grade("linear", { issues: [linearChild(OWN, "tag-a")], pageInfo: { hasNextPage: false, endCursor: "end" } }, [OWN]);
    expect(g.refusal).toContain("pageInfo");
  });

  test("a wrapped Jira last page is complete; two wrapped pages chain on endCursor", () => {
    expect(grade("jira", wrappedPage([jiraChild("GF-96090", "tag-a")]), ["GF-96090"])).toEqual({ refusal: null, count: 1 });
    const pages = [wrappedPage([jiraChild("GF-96090", "tag-a")], "e1"), { ...wrappedPage([jiraChild("GF-96091", "tag-b")]), requestCursor: "e1" }];
    expect(grade("jira", pages, ["GF-96090"])).toEqual({ refusal: null, count: 2 });
  });

  test("twin: a wrapped Jira more-page as the final page refuses", () => {
    expect(grade("jira", wrappedPage([jiraChild("GF-96090", "tag-a")], "e1"), ["GF-96090"]).refusal).toContain("last page");
  });
});

// ===========================================================================
// resolve_milestone_identity — the Epic and milestone listings
// ===========================================================================

function epicNode(key: string): Record<string, unknown> {
  return { key, fields: { summary: `M_${key} Rewards`, issuetype: { name: "Epic" }, project: { key: "GF" }, status: { name: "To Do", statusCategory: { key: "new" } }, labels: [] } };
}
const listing = (mode: "jira" | "linear", content: unknown) => readListingFile({ mode, project: mode === "jira" ? "GF" : "DPT", listingFile: writeJson(content) });

describe("resolve_milestone_identity — readListingFile reads through the shared reader", () => {
  test("a wrapped Jira Epic listing that proves it is last is read", () => {
    expect(listing("jira", wrappedPage([epicNode("GF-85")])).rowKeys).toEqual(["GF-85"]);
  });

  test("twin: a wrapped Epic listing saying more follow refuses as not the last page", () => {
    expect(() => listing("jira", wrappedPage([epicNode("GF-85")], "e1"))).toThrow(/not the last page/);
  });

  test("the live 50-row milestone window is read and reported incomplete; fewer rows are complete", () => {
    const full = listing("linear", live("linear", "list_milestones"));
    expect(full.rowKeys.length).toBe(50);
    expect(full.complete).toBe(false);
    const few = listing("linear", { milestones: live("linear", "list_milestones").milestones.slice(0, 3) });
    expect(few.complete).toBe(true);
  });

  test("twin: a milestones answer carrying a paging field is an unrecorded shape and refuses", () => {
    expect(() => listing("linear", { milestones: [], hasNextPage: false })).toThrow(/paging field/);
  });

  test("LINEAR_MILESTONE_WINDOW has one definition: re-exported from tracker_answer, no local literal", () => {
    expect(resolveMilestoneIdentity.LINEAR_MILESTONE_WINDOW).toBe(trackerAnswer.LINEAR_MILESTONE_WINDOW);
    const src = readFileSync(join(SRC, "resolve_milestone_identity.ts"), "utf-8");
    expect(src).not.toMatch(/LINEAR_MILESTONE_WINDOW\s*=\s*\d/);
    expect(src).toMatch(/export \{[^}]*LINEAR_MILESTONE_WINDOW[^}]*\} from "\.\/tracker_answer"/);
  });
});
