// tracker_answer — the ONE reader of tracker answers, one per tracker.
//
// Every toolkit module that reads a tracker's answer — a listing page, a
// create's result, a fetched item — reads it here, so the shapes the toolkit
// believes a server sends have exactly one definition. Each shape accepted
// below was OBSERVED: the answers pinned under tests/fixtures/live-shapes/,
// each with its provenance (a read-only call or a recorded transcript, and
// the date). Anything else fails closed. That is the property this module
// exists for: before it, four readers each modelled Linear paging their own
// way, none matched the server, and the whole offline suite agreed with
// itself while disagreeing with the tracker.
//
// Measured shapes (2026-09-21):
//   Linear pages   `{ <items>: [...], hasNextPage: boolean, cursor? }` —
//                  top level, `cursor` present exactly when more follow;
//                  there is no `pageInfo`.
//   Linear list_milestones  `{ milestones: [...] }` — no paging field at
//                  all, and at most LINEAR_MILESTONE_WINDOW rows.
//   Jira pages     TWO shapes, flipping on the same server within days
//                  (what drives the flip was not determined):
//                  plain   `{ issues: [...], isLast: boolean, nextPageToken? }`
//                  wrapped `{ context, issues: { nodes: [...],
//                            pageInfo: { hasNextPage, endCursor } } }`
//   Lists          `readCompleteList`: Linear list_issue_statuses (a bare
//                  array), Jira getVisibleJiraProjects, Jira
//                  getJiraProjectIssueTypesMetadata.
//   Items          Linear: the object itself, keyed by top-level `id`
//                  (`STE-618`; no `identifier`, no `key`). Jira: plain
//                  `{ id, key, self, … }`, or wrapped with exactly one node.
//
// CLI: `bun tracker_answer.ts page <jira|linear> <answer.json> [itemsKey]`
// prints the canonical page, exit 1 naming why an answer is unreadable.

import { readFileSync } from "node:fs";

export type TrackerKind = "jira" | "linear";

/** The canonical page every reader returns: its items, whether it is proven last, and the cursor for the next. */
export interface TrackerPage {
  items: Record<string, unknown>[];
  /** True only when the answer PROVES nothing follows. */
  last: boolean;
  /** The token that fetches the next page, or null (last, or a window that cannot be paged). */
  next: string | null;
}

export type PageRead = { ok: true; page: TrackerPage } | { ok: false; reason: string };
export type ItemRead = { ok: true; item: Record<string, unknown> } | { ok: false; reason: string };

/**
 * The most rows one Linear `list_milestones` answer returns (measured: a
 * project holding about 140 milestones answered exactly 50, with no paging
 * field). A full window proves nothing about the rest; fewer rows is the
 * whole list.
 */
export const LINEAR_MILESTONE_WINDOW = 50;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";
const rows = (v: unknown[]): Record<string, unknown>[] | null => (v.every(isObj) ? (v as Record<string, unknown>[]) : null);

function linearPage(a: Record<string, unknown>, itemsKey: string): PageRead {
  const list = a[itemsKey];
  if (!Array.isArray(list)) return { ok: false, reason: `not a Linear answer: no \`${itemsKey}\` array` };
  const items = rows(list);
  if (!items) return { ok: false, reason: `a Linear \`${itemsKey}\` row is not an object` };
  if ("pageInfo" in a) return { ok: false, reason: "a Linear answer carrying `pageInfo` is not a shape the server was observed to send" };
  if (itemsKey === "milestones") {
    if ("hasNextPage" in a || "cursor" in a) return { ok: false, reason: "a Linear milestones answer carrying a paging field is not a shape the server was observed to send" };
    return { ok: true, page: { items, last: items.length < LINEAR_MILESTONE_WINDOW, next: null } };
  }
  if (typeof a.hasNextPage !== "boolean") return { ok: false, reason: "a Linear page with no boolean top-level `hasNextPage` does not say whether it is the last" };
  if (!a.hasNextPage) return { ok: true, page: { items, last: true, next: null } };
  if (!nonEmpty(a.cursor)) return { ok: false, reason: "a Linear page with `hasNextPage: true` and no `cursor` cannot be followed" };
  return { ok: true, page: { items, last: false, next: a.cursor } };
}

function jiraPage(a: Record<string, unknown>): PageRead {
  if (Array.isArray(a.issues)) {
    const items = rows(a.issues);
    if (!items) return { ok: false, reason: "a Jira `issues` row is not an object" };
    if (typeof a.isLast !== "boolean") return { ok: false, reason: "a plain Jira page with no boolean `isLast` does not say whether it is the last" };
    const token = a.nextPageToken;
    if (a.isLast) {
      if (token !== undefined && token !== null && token !== "") return { ok: false, reason: "a plain Jira page saying `isLast: true` while handing a `nextPageToken` contradicts itself" };
      return { ok: true, page: { items, last: true, next: null } };
    }
    if (!nonEmpty(token)) return { ok: false, reason: "a plain Jira page with `isLast: false` and no `nextPageToken` cannot be followed" };
    return { ok: true, page: { items, last: false, next: token } };
  }
  if (isObj(a.context) && isObj(a.issues) && Array.isArray(a.issues.nodes)) {
    const items = rows(a.issues.nodes);
    if (!items) return { ok: false, reason: "a wrapped Jira node is not an object" };
    const info = a.issues.pageInfo;
    if (!isObj(info) || typeof info.hasNextPage !== "boolean") return { ok: false, reason: "a wrapped Jira page with no `issues.pageInfo.hasNextPage` does not say whether it is the last" };
    if (!info.hasNextPage) return { ok: true, page: { items, last: true, next: null } };
    if (!nonEmpty(info.endCursor)) return { ok: false, reason: "a wrapped Jira page with `hasNextPage: true` and no `endCursor` cannot be followed" };
    return { ok: true, page: { items, last: false, next: info.endCursor } };
  }
  return { ok: false, reason: "not a Jira search answer in either observed shape (plain `issues` + `isLast`, or wrapped `context` + `issues.nodes`)" };
}

/** Read one listing answer into the canonical page, or say why it cannot be read. `itemsKey` is Linear's list key. */
export function readTrackerPage(tracker: TrackerKind, answer: unknown, itemsKey = "issues"): PageRead {
  if (!isObj(answer)) return { ok: false, reason: "the answer is not a JSON object" };
  return tracker === "linear" ? linearPage(answer, itemsKey) : jiraPage(answer);
}

export type ListingRead = { ok: true; items: Record<string, unknown>[]; last: boolean } | { ok: false; reason: string };

/**
 * Read a listing of one or more pages as ONE chain. Every page is read by
 * `readTrackerPage`; each page but the final must hand a `next`, never one an
 * earlier page handed; page n>1 must carry `requestCursor` — the cursor the
 * session fetched it with, which the answer itself does not carry — equal to
 * page n-1's `next`; and no key may appear on two pages. A dropped page then
 * shows as a broken link and a reordered or duplicated one as a repeat. The
 * result's `last` is whether the FINAL page proves nothing follows. One page
 * needs no `requestCursor`. (The chain rule is sibling_release's M_685ff6 r2
 * rule, given one home when the create decision turned out to lack it.)
 */
export function readTrackerListing(tracker: TrackerKind, pages: readonly unknown[], itemsKey = "issues"): ListingRead {
  if (pages.length === 0) return { ok: false, reason: "the listing holds no page" };
  const of = pages.length > 1 ? ` of ${pages.length}` : "";
  const oneLine = (v: string) => JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v);
  const items: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  const keys = new Set<string>();
  let previousNext: string | null = null;
  let last = false;
  for (let i = 0; i < pages.length; i++) {
    const n = i + 1;
    const read = readTrackerPage(tracker, pages[i], itemsKey);
    if (!read.ok) return { ok: false, reason: `page ${n}${of} cannot be read: ${read.reason}` };
    if (i > 0) {
      const requested = isObj(pages[i]) ? (pages[i] as Record<string, unknown>).requestCursor : undefined;
      if (!nonEmpty(requested)) return { ok: false, reason: `page ${n}${of} records no requestCursor — the cursor it was requested with` };
      if (requested !== previousNext) {
        return { ok: false, reason: `page ${n} was requested with ${oneLine(requested)}, but page ${i} ended at ${oneLine(previousNext ?? "")} — a page between them is missing` };
      }
    }
    for (const row of read.page.items) {
      const key = trackerItemKey(tracker, row);
      if (key === null) continue;
      if (keys.has(key)) return { ok: false, reason: `the key ${oneLine(key)} appears on more than one page — a page is duplicated` };
      keys.add(key);
    }
    items.push(...read.page.items);
    last = read.page.last;
    if (i === pages.length - 1) break;
    const next = read.page.next;
    if (next === null) return { ok: false, reason: `page ${n}${of} does not say more pages follow (it hands no cursor for the page after it)` };
    if (cursors.has(next)) return { ok: false, reason: `page ${n} repeats the cursor ${oneLine(next)} of an earlier page` };
    cursors.add(next);
    previousNext = next;
  }
  return { ok: true, items, last };
}

/** Read one item answer (a create's, an update's, a fetch's) into the item itself. */
export function readTrackerItem(tracker: TrackerKind, answer: unknown): ItemRead {
  if (!isObj(answer)) return { ok: false, reason: "the answer is not a JSON object" };
  if (tracker === "linear") {
    if (!nonEmpty(answer.id)) return { ok: false, reason: "a Linear item answer with no top-level `id`" };
    return { ok: true, item: answer };
  }
  if (nonEmpty(answer.key) && !("context" in answer)) return { ok: true, item: answer };
  if (isObj(answer.context) && isObj(answer.issues) && Array.isArray(answer.issues.nodes)) {
    const nodes = answer.issues.nodes;
    if (nodes.length !== 1 || !isObj(nodes[0])) return { ok: false, reason: `a wrapped Jira item answer holds ${nodes.length} nodes, not one item` };
    return { ok: true, item: nodes[0] };
  }
  return { ok: false, reason: "not a Jira item answer in either observed shape (plain `key`, or wrapped with one node)" };
}

/**
 * The list tools whose whole answer is one list (no cursor to follow), each
 * with its measured shape (2026-09-21). No other tool has a list reader: a
 * list the toolkit consumes from an unnamed tool has nothing to be measured
 * against, and a caller must treat it as asserted, not proven.
 */
export type CompleteListTool = "linear:list_issue_statuses" | "jira:getVisibleJiraProjects" | "jira:getJiraProjectIssueTypesMetadata";

export type ListRead = { ok: true; items: Record<string, unknown>[]; complete: boolean } | { ok: false; reason: string };

/**
 * Read one measured list answer and whether it PROVES it holds the whole list.
 *   linear:list_issue_statuses — a BARE array; the tool takes only `team` and
 *     has no paging parameter, so the answer is the whole list.
 *   jira:getVisibleJiraProjects — `{ values, isLast, … }`; complete iff `isLast`.
 *   jira:getJiraProjectIssueTypesMetadata — `{ startAt, maxResults, total,
 *     issueTypes }`, no `isLast`. NAMED ASSUMPTION: complete iff `startAt` is 0
 *     and the list holds `total` rows — an inference about an undocumented
 *     shape; when either field is absent the answer is unreadable, never
 *     complete.
 */
export function readCompleteList(tool: CompleteListTool, answer: unknown): ListRead {
  if (tool === "linear:list_issue_statuses") {
    if (!Array.isArray(answer)) return { ok: false, reason: "not a Linear list_issue_statuses answer: the server answers a bare array" };
    const items = rows(answer);
    return items ? { ok: true, items, complete: true } : { ok: false, reason: "a Linear status row is not an object" };
  }
  if (!isObj(answer)) return { ok: false, reason: "the answer is not a JSON object" };
  if (tool === "jira:getVisibleJiraProjects") {
    if (!Array.isArray(answer.values)) return { ok: false, reason: "not a getVisibleJiraProjects answer: no `values` array" };
    const items = rows(answer.values);
    if (!items) return { ok: false, reason: "a Jira project row is not an object" };
    if (typeof answer.isLast !== "boolean") return { ok: false, reason: "a getVisibleJiraProjects answer with no boolean `isLast` does not say whether it is the whole list" };
    return { ok: true, items, complete: answer.isLast };
  }
  if (tool === "jira:getJiraProjectIssueTypesMetadata") {
    if (!Array.isArray(answer.issueTypes)) return { ok: false, reason: "not a getJiraProjectIssueTypesMetadata answer: no `issueTypes` array" };
    const items = rows(answer.issueTypes);
    if (!items) return { ok: false, reason: "a Jira issue-type row is not an object" };
    if (typeof answer.total !== "number" || typeof answer.startAt !== "number") return { ok: false, reason: "a getJiraProjectIssueTypesMetadata answer with no numeric `total` and `startAt` cannot show it is the whole list" };
    return { ok: true, items, complete: answer.startAt === 0 && items.length === answer.total };
  }
  return { ok: false, reason: `no measured list shape for ${String(tool)}` };
}

const TICKET_KEY = /^[A-Z][A-Z0-9]*-[1-9]\d*$/;

/** An item's ticket key: Jira `key`, Linear `id` — upper-cased, or null when it is not key-shaped (a uuid). */
export function trackerItemKey(tracker: TrackerKind, item: Record<string, unknown>): string | null {
  const v = tracker === "jira" ? item.key : item.id;
  if (typeof v !== "string") return null;
  const k = v.toUpperCase();
  return TICKET_KEY.test(k) ? k : null;
}

/**
 * NAMED ASSUMPTION — a Linear identifier is `<TEAMKEY>-<n>`, so its prefix is
 * the team key. Observed 2026-09-21: `list_issues(team: "STE")` rows carry
 * `id: "STE-618"` and `team: "<display name>"`, and `list_teams` exposes no
 * key field, so the prefix is the only place a row carries its team key. It is
 * an inference about the tracker, not a documented guarantee: an identifier
 * that does not parse yields null, and callers refuse on null.
 */
export function linearTeamKeyOf(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const m = /^([A-Z][A-Z0-9]*)-[1-9]\d*$/.exec(id);
  return m ? m[1]! : null;
}

if (import.meta.main) {
  const [cmd, tracker, file, itemsKey] = process.argv.slice(2);
  if (cmd !== "page" || (tracker !== "jira" && tracker !== "linear") || !file) {
    console.error("usage: tracker_answer.ts page <jira|linear> <answer.json> [itemsKey]");
    process.exit(64);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.error(`${file}: cannot be read as JSON (${e instanceof Error ? e.message : String(e)})`);
    process.exit(1);
  }
  const r = readTrackerPage(tracker, parsed, itemsKey);
  if (!r.ok) {
    console.error(`${file}: ${r.reason}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ items: r.page.items.length, last: r.page.last, next: r.page.next }));
}
