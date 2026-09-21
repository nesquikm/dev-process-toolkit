// M_2306b6 — one reader per tracker, pinned to MEASURED answer shapes.
//
// Every tracker answer the toolkit reads goes through `tracker_answer.ts`,
// which accepts exactly the shapes recorded under tests/fixtures/live-shapes/
// and refuses anything else. The fixtures are real answers (read-only calls
// or recorded transcripts, sanitised), each carrying its provenance; this
// suite reads them from disk, so a reader cannot drift from what the server
// was observed to send. An unrecorded shape — a third Jira wrapper next month,
// a Linear page that grows `pageInfo` — fails closed, and the rows below that
// mutate a recorded shape prove it.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LINEAR_MILESTONE_WINDOW,
  linearTeamKeyOf,
  readCompleteList,
  readTrackerItem,
  readTrackerPage,
  trackerItemKey,
} from "../adapters/_shared/src/tracker_answer";

const SHAPES = join(import.meta.dir, "fixtures", "live-shapes");
type Shape = { provenance: Record<string, unknown>; answer?: unknown };
const shape = (tracker: string, name: string): Shape => JSON.parse(readFileSync(join(SHAPES, tracker, `${name}.json`), "utf-8"));
const answer = (tracker: string, name: string): any => structuredClone(shape(tracker, name).answer);
const refused = (r: { ok: boolean }) => expect(r.ok).toBe(false);

describe("provenance is enforced, not a convention", () => {
  const all = ["linear", "jira"].flatMap((t) => readdirSync(join(SHAPES, t)).map((f) => ({ t, f, s: JSON.parse(readFileSync(join(SHAPES, t, f), "utf-8")) as Shape })));
  test("the pin set is not empty (a vacuous walk proves nothing)", () => {
    expect(all.length).toBeGreaterThanOrEqual(18);
  });
  for (const { t, f, s } of all) {
    test(`${t}/${f} carries a provenance a reader can trace`, () => {
      const p = s.provenance;
      expect(["read-only-call", "recorded-transcript", "declared-unmeasured"]).toContain(p.method as string);
      if (p.method === "declared-unmeasured") {
        // First-class state: a reason and where it was looked for, and NO answer — never a plausible guess.
        expect(typeof p.reason).toBe("string");
        expect(typeof p.looked_in).toBe("string");
        expect("answer" in s).toBe(false);
      } else {
        expect(p.measured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(p.request && typeof p.request === "object").toBe(true);
        expect("answer" in s).toBe(true);
      }
    });
  }
  test("Linear create_issue_label is DECLARED unmeasured, not merely absent", () => {
    expect(shape("linear", "create_issue_label").provenance.method).toBe("declared-unmeasured");
  });
});

describe("Linear pages — the one measured shape: top-level hasNextPage + cursor", () => {
  test("a page with more after it reads next = its cursor", () => {
    const a = answer("linear", "list_issues.more");
    const r = readTrackerPage("linear", a);
    expect(r).toEqual({ ok: true, page: { items: a.issues, last: false, next: a.cursor } });
  });
  test("the final page reads last, no next", () => {
    const a = answer("linear", "list_issues.last");
    expect(readTrackerPage("linear", a)).toEqual({ ok: true, page: { items: a.issues, last: true, next: null } });
  });
  test("list_projects pages the same way under its own items key", () => {
    const a = answer("linear", "list_projects");
    expect(readTrackerPage("linear", a, "projects")).toEqual({ ok: true, page: { items: a.projects, last: true, next: null } });
  });
  test("REFUSE — the invented pageInfo shape (the Jira WRAPPED field, pasted into the Linear model)", () => {
    const a = answer("linear", "list_issues.last");
    delete a.hasNextPage;
    a.pageInfo = { hasNextPage: false };
    refused(readTrackerPage("linear", a));
  });
  test("REFUSE — a page carrying pageInfo beside hasNextPage (an unrecorded shape)", () => {
    const a = answer("linear", "list_issues.last");
    a.pageInfo = { hasNextPage: false };
    refused(readTrackerPage("linear", a));
  });
  test("REFUSE — no hasNextPage at all is never read as the last page (the container_ownership fail-open)", () => {
    const a = answer("linear", "list_issues.last");
    delete a.hasNextPage;
    refused(readTrackerPage("linear", a));
  });
  test("REFUSE — hasNextPage true with no cursor cannot be followed", () => {
    const a = answer("linear", "list_issues.more");
    delete a.cursor;
    refused(readTrackerPage("linear", a));
  });
  test("REFUSE — a non-boolean hasNextPage", () => {
    const a = answer("linear", "list_issues.last");
    a.hasNextPage = "false";
    refused(readTrackerPage("linear", a));
  });
  test("REFUSE — the items key missing or not an array", () => {
    const a = answer("linear", "list_issues.last");
    a.issues = {};
    refused(readTrackerPage("linear", a));
    refused(readTrackerPage("linear", answer("linear", "list_issues.last"), "projects"));
  });
});

describe("Linear milestones — no paging field; completeness is the measured window", () => {
  test("the recorded answer holds exactly LINEAR_MILESTONE_WINDOW rows and carries no paging field", () => {
    const a = answer("linear", "list_milestones");
    expect(Object.keys(a)).toEqual(["milestones"]);
    expect(a.milestones.length).toBe(LINEAR_MILESTONE_WINDOW);
  });
  test("a full window is NOT proven last (the project behind it held more)", () => {
    const a = answer("linear", "list_milestones");
    expect(readTrackerPage("linear", a, "milestones")).toEqual({ ok: true, page: { items: a.milestones, last: false, next: null } });
  });
  test("fewer rows than the window is the whole list", () => {
    const a = answer("linear", "list_milestones");
    a.milestones = a.milestones.slice(0, 3);
    expect(readTrackerPage("linear", a, "milestones")).toEqual({ ok: true, page: { items: a.milestones, last: true, next: null } });
  });
  test("REFUSE — a milestones answer that grew a paging field is an unrecorded shape", () => {
    const a = answer("linear", "list_milestones");
    a.milestones = a.milestones.slice(0, 3);
    a.hasNextPage = false;
    refused(readTrackerPage("linear", a, "milestones"));
  });
});

describe("Jira pages — BOTH measured shapes, one canonical page", () => {
  test("plain, more to come: next = nextPageToken", () => {
    const a = answer("jira", "search.plain.more");
    expect(readTrackerPage("jira", a)).toEqual({ ok: true, page: { items: a.issues, last: false, next: a.nextPageToken } });
  });
  test("plain, final page: last", () => {
    const a = answer("jira", "search.plain.last");
    expect(readTrackerPage("jira", a)).toEqual({ ok: true, page: { items: a.issues, last: true, next: null } });
  });
  test("WRAPPED, more to come: next = issues.pageInfo.endCursor", () => {
    const a = answer("jira", "search.wrapped.more");
    expect(readTrackerPage("jira", a)).toEqual({ ok: true, page: { items: a.issues.nodes, last: false, next: a.issues.pageInfo.endCursor } });
  });
  test("WRAPPED, final page: last", () => {
    const a = answer("jira", "search.wrapped.last");
    expect(readTrackerPage("jira", a)).toEqual({ ok: true, page: { items: a.issues.nodes, last: true, next: null } });
  });
  test("the two shapes carry the same item shape (a node IS a plain issue)", () => {
    const plain = Object.keys(answer("jira", "search.plain.last").issues[0]).sort();
    const node = Object.keys(answer("jira", "search.wrapped.last").issues.nodes[0]).filter((k) => k !== "webUrl").sort();
    expect(node).toEqual(plain);
  });
  test("REFUSE — plain isLast false with no nextPageToken", () => {
    const a = answer("jira", "search.plain.more");
    delete a.nextPageToken;
    refused(readTrackerPage("jira", a));
  });
  test("REFUSE — plain with no isLast is never read as last", () => {
    const a = answer("jira", "search.plain.last");
    delete a.isLast;
    refused(readTrackerPage("jira", a));
  });
  test("REFUSE — plain isLast true that still hands a token (an unrecorded contradiction)", () => {
    const a = answer("jira", "search.plain.last");
    a.nextPageToken = "tok";
    refused(readTrackerPage("jira", a));
  });
  test("REFUSE — wrapped with no pageInfo (the count-mode variant proves nothing about completeness)", () => {
    const a = answer("jira", "search.wrapped.last");
    delete a.issues.pageInfo;
    a.issues.totalCount = a.issues.nodes.length;
    refused(readTrackerPage("jira", a));
  });
  test("REFUSE — wrapped hasNextPage true with no endCursor", () => {
    const a = answer("jira", "search.wrapped.more");
    a.issues.pageInfo.endCursor = null;
    refused(readTrackerPage("jira", a));
  });
  test("REFUSE — a third wrapper nobody recorded fails closed", () => {
    const a = answer("jira", "search.plain.last");
    refused(readTrackerPage("jira", { data: a }));
    refused(readTrackerPage("jira", { context: {}, results: a.issues }));
  });
});

describe("single items — create and get answers, both trackers", () => {
  test("Linear create: the key is top-level id (no identifier, no key field exists)", () => {
    const a = answer("linear", "save_issue.create");
    expect("identifier" in a).toBe(false);
    const r = readTrackerItem("linear", a);
    expect(r.ok).toBe(true);
    expect(trackerItemKey("linear", (r as { item: Record<string, unknown> }).item)).toBe(a.id);
  });
  test("Linear update answers the same shape", () => {
    const a = answer("linear", "save_issue.update");
    expect(trackerItemKey("linear", (readTrackerItem("linear", a) as { item: Record<string, unknown> }).item)).toBe(a.id);
  });
  for (const name of ["create.plain", "create.wrapped", "get.plain", "get.wrapped"]) {
    test(`Jira ${name}: one item, keyed by key`, () => {
      const a = answer("jira", name);
      const r = readTrackerItem("jira", a);
      expect(r.ok).toBe(true);
      const expected = name.endsWith("wrapped") ? a.issues.nodes[0].key : a.key;
      expect(trackerItemKey("jira", (r as { item: Record<string, unknown> }).item)).toBe(expected);
    });
  }
  test("REFUSE — a wrapped item answer holding two nodes is not one item", () => {
    const a = answer("jira", "create.wrapped");
    a.issues.nodes = [a.issues.nodes[0], a.issues.nodes[0]];
    refused(readTrackerItem("jira", a));
  });
  test("REFUSE — a Linear item whose id is a uuid, not a key, has no key", () => {
    const a = answer("linear", "save_issue.create");
    a.id = a.uuid;
    expect(trackerItemKey("linear", a)).toBeNull();
  });
  test("REFUSE — an unrecorded item wrapper fails closed", () => {
    refused(readTrackerItem("jira", { data: answer("jira", "create.plain") }));
    refused(readTrackerItem("linear", { issue: answer("linear", "save_issue.create") }));
  });
});

describe("the named assumption: a Linear identifier is <TEAMKEY>-<n>", () => {
  // Observation (2026-09-21, read-only): list_issues(team: "STE") rows carry
  // team: "<display name>" and id: "STE-618"; list_teams exposes no key field
  // at all. So the team key is readable only as the identifier's prefix. That
  // is an inference about the tracker, not a documented guarantee — a row
  // whose identifier does not parse fails closed rather than falling through.
  test("the prefix of a measured row's id is the team key the query named", () => {
    const a = answer("linear", "list_issues.more");
    const req = shape("linear", "list_issues.more").provenance.request as { team: string };
    for (const row of a.issues) expect(linearTeamKeyOf(row.id)).toBe(req.team);
  });
  test("the row's team field is a display name, never the key", () => {
    const a = answer("linear", "list_issues.more");
    const req = shape("linear", "list_issues.more").provenance.request as { team: string };
    for (const row of a.issues) expect(row.team).not.toBe(req.team);
  });
  test("REFUSE — an identifier that does not parse yields no team key", () => {
    for (const bad of ["", "STE", "618", "ste 618", "e2308c9f-bbd0-4f5a-a19e-5eb6c68d3972", "STE-", "-618"]) expect(linearTeamKeyOf(bad)).toBeNull();
    expect(linearTeamKeyOf(undefined)).toBeNull();
  });
});

describe("complete lists — repoint's measured inputs, one reader per tool", () => {
  test("Linear list_issue_statuses: a bare array from a paging-less tool is the whole list", () => {
    const a = answer("linear", "list_issue_statuses");
    expect(Array.isArray(a)).toBe(true);
    expect(readCompleteList("linear:list_issue_statuses", a)).toEqual({ ok: true, items: a, complete: true });
  });
  test("REFUSE — the invented `{statuses: [...]}` wrapper is not what the server sends", () => {
    refused(readCompleteList("linear:list_issue_statuses", { statuses: answer("linear", "list_issue_statuses") }));
  });
  test("Jira getVisibleJiraProjects: complete when isLast is true", () => {
    const a = answer("jira", "getVisibleJiraProjects");
    expect(readCompleteList("jira:getVisibleJiraProjects", a)).toEqual({ ok: true, items: a.values, complete: true });
  });
  test("Jira getVisibleJiraProjects: isLast false is read, but NOT complete", () => {
    const a = answer("jira", "getVisibleJiraProjects");
    a.isLast = false;
    expect(readCompleteList("jira:getVisibleJiraProjects", a)).toEqual({ ok: true, items: a.values, complete: false });
  });
  test("REFUSE — getVisibleJiraProjects with no boolean isLast", () => {
    const a = answer("jira", "getVisibleJiraProjects");
    delete a.isLast;
    refused(readCompleteList("jira:getVisibleJiraProjects", a));
  });
  // NAMED ASSUMPTION (2026-09-21): getJiraProjectIssueTypesMetadata answers
  // {startAt, maxResults, total, issueTypes} with no isLast. Reading it as
  // complete when startAt is 0 and the list holds `total` rows is an inference
  // about an undocumented shape, not a documented guarantee.
  test("Jira getJiraProjectIssueTypesMetadata: complete when startAt is 0 and the list holds total rows", () => {
    const a = answer("jira", "getJiraProjectIssueTypesMetadata");
    expect("isLast" in a).toBe(false);
    expect(readCompleteList("jira:getJiraProjectIssueTypesMetadata", a)).toEqual({ ok: true, items: a.issueTypes, complete: true });
  });
  test("…and NOT complete when the page is short of total, or starts past 0", () => {
    const short = answer("jira", "getJiraProjectIssueTypesMetadata");
    short.total = short.issueTypes.length + 1;
    expect(readCompleteList("jira:getJiraProjectIssueTypesMetadata", short)).toMatchObject({ ok: true, complete: false });
    const later = answer("jira", "getJiraProjectIssueTypesMetadata");
    later.startAt = 50;
    expect(readCompleteList("jira:getJiraProjectIssueTypesMetadata", later)).toMatchObject({ ok: true, complete: false });
  });
  test("REFUSE — the fields the completeness rule needs are absent: fail closed, never complete", () => {
    for (const k of ["total", "startAt"]) {
      const a = answer("jira", "getJiraProjectIssueTypesMetadata");
      delete a[k];
      refused(readCompleteList("jira:getJiraProjectIssueTypesMetadata", a));
    }
  });
  test("REFUSE — a tool with no measured list shape", () => {
    refused(readCompleteList("jira:statuses" as never, { values: [], isLast: true }));
  });
});
