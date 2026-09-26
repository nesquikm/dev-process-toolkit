// STE-339 — Jira listMilestones() via milestone-label enumeration.
//
// PURE FUNCTION over an INJECTED page-fetcher (Schema-P house style, mirroring
// adapters/jira/src/discover_field.ts and the way nextFreeMilestoneNumber
// injects `provider` / `branchScanner`). The real `searchJiraIssuesUsingJql`
// MCP wiring lives in adapters/jira.md prose and is executed by the LLM; here
// the injected `fetchPage` is the only seam — no network, no auth.
//
// listMilestones drives pagination by calling fetchPage(0), fetchPage(1), …
// Each page is the RAW `searchJiraIssuesUsingJql` answer, read by the shared
// reader (`adapters/_shared/src/tracker_answer.ts`) in either measured shape —
// plain `{ issues, isLast, nextPageToken? }` or wrapped `{ context, issues:
// { nodes, pageInfo } }` — and each row is the measured `{ key, fields }`. A
// page in no measured shape is a genuine failure (fail-soft, below). The
// scan accumulates each page's rows. Every label matching the milestone-token
// union (^milestone-(M<N>|M_<epic-key>)$, STE-376 AC-STE-376.3) contributes
// its captured bare token. The result is deduped: numeric tokens first,
// ascending by numeric part, then epic-keyed tokens (lexicographic) — the
// BARE token (e.g. "M30", "M_PROJ_500"), never the "milestone-" prefixed
// label. The existing scanTracker `^M(\d+)` extractor in
// next_free_milestone_number.ts consumes this unchanged: epic-keyed names
// are opaque to it and never bump the sequential counter.

import {
  MILESTONE_TOKEN_SOURCE,
  compareMilestoneTokens,
  isMilestoneToken,
  milestoneIdFromEpicKey,
} from "../../_shared/src/milestone_token";
import { readTrackerPage } from "../../_shared/src/tracker_answer";

/**
 * One raw `searchJiraIssuesUsingJql` answer, as the MCP server returned it —
 * never pre-digested: the shared reader decides whether it is readable.
 */
export type JiraSearchPage = unknown;

export type JiraSearchPageFetcher = (page: number) => Promise<JiraSearchPage>;

// STE-375 AC-STE-375.3 — Epic-enumeration leg. The injected seam over the
// `issuetype = Epic` JQL (`searchJiraIssuesUsingJql`, paginated like the
// label leg), returning the same raw answers. Milestone Epics are selected
// CLIENT-SIDE: an Epic counts iff its `fields.summary`'s first
// whitespace-delimited word parses under the shared milestone-token union
// grammar. Each match contributes `M_<epic-key>` (key verbatim) — never a
// full labelled-task scan.
export type JiraEpicSearchPage = unknown;

export type JiraEpicPageFetcher = (page: number) => Promise<JiraEpicSearchPage>;

/**
 * Documented default pagination cap. Bounds the scan when no page proves it is
 * the last, so a never-terminating fetcher can never run away; also doubles as
 * the loop bound the test suite relies on. Used when `opts.pageCap` is omitted.
 */
export const MILESTONE_PAGE_CAP = 50;

// Exact-scope anchor: only `milestone-M<N>` / `milestone-M_<epic-key>` (no
// prefix, no suffix, no trailing whitespace) counts; the captured group is the
// bare token. The union shape comes from the shared `milestone_token` sources,
// so malformed labels (`milestone-M_`, `milestone-M5-extra`) stay rejected.
const MILESTONE_LABEL = new RegExp(`^milestone-(${MILESTONE_TOKEN_SOURCE})$`);

/** A row's `fields` object, or an empty one. */
function fieldsOf(row: Record<string, unknown>): Record<string, unknown> {
  const f = row["fields"];
  return f !== null && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, unknown>) : {};
}

/**
 * Shared pagination driver for both enumeration legs: calls `fetch(0)`,
 * `fetch(1)`, … up to `cap` pages, reading each answer through the shared
 * reader and feeding its rows to `onRows`, stopping early when a page proves
 * it is the last. An answer the reader cannot read throws (the caller's
 * fail-soft). Returns `true` on a proven-last finish, `false` when the cap was
 * exhausted first — the caller surfaces the possible truncation (AC-STE-339.2:
 * no silent cap).
 */
async function scanPages(
  fetch: (page: number) => Promise<unknown>,
  cap: number,
  onRows: (rows: Record<string, unknown>[]) => void,
): Promise<boolean> {
  for (let page = 0; page < cap; page++) {
    const read = readTrackerPage("jira", await fetch(page));
    if (!read.ok) throw new Error(`listMilestones: page ${page}: ${read.reason}`);
    onRows(read.page.items);
    if (read.page.last) return true;
  }
  return false;
}

export async function listMilestones(
  fetchPage: JiraSearchPageFetcher,
  opts?: {
    pageCap?: number;
    log?: (msg: string) => void;
    fetchEpicPage?: JiraEpicPageFetcher;
  },
): Promise<{ name: string }[]> {
  const cap = opts?.pageCap ?? MILESTONE_PAGE_CAP;
  const log = opts?.log;
  const found = new Set<string>();

  try {
    // Label leg (STE-339) — grandfathered milestone-M<N> labels for pre-Epic
    // milestones, AND the milestone-M_<key> label the Epic mint writes: it is
    // the only route to a freshly minted Epic whose summary does not yet lead
    // with a milestone token. The epic leg below is the primary enumeration.
    const reachedLast = await scanPages(fetchPage, cap, (rows) => {
      for (const issue of rows) {
        const labels = fieldsOf(issue)["labels"];
        for (const label of Array.isArray(labels) ? labels : []) {
          const match = typeof label === "string" ? label.match(MILESTONE_LABEL) : null;
          if (match) found.add(match[1]!);
        }
      }
    });
    // scanPages only returns false by exhausting the cap, so later pages may
    // have been dropped — surface it (AC-STE-339.2: no silent truncation).
    // A proven-last finish logs nothing.
    if (!reachedLast && log) {
      log(`listMilestones: stopped at page cap ${cap}; more pages may have been dropped (no page proved it was the last).`);
    }

    // Epic-enumeration leg (AC-STE-375.3): same pagination + cap discipline
    // as the label leg, over the `issuetype = Epic` seam. Client-side name
    // filter — only Epics whose summary LEADS with a milestone token count;
    // each contributes `M_<epic-key>` into the same deduping union.
    const fetchEpicPage = opts?.fetchEpicPage;
    if (fetchEpicPage) {
      const epicReachedLast = await scanPages(fetchEpicPage, cap, (rows) => {
        for (const epic of rows) {
          const summary = fieldsOf(epic)["summary"];
          const firstWord = typeof summary === "string" ? (summary.trim().split(/\s+/)[0] ?? "") : "";
          if (!isMilestoneToken(firstWord)) continue;
          // Canonical id via the shared sanitizer (key `DPT-500` →
          // `M_DPT_500`) — the SAME identity /spec-write mints and the
          // parent-sanitize membership check compares against. A malformed
          // or empty key skips this Epic; it never degrades the leg.
          try {
            found.add(milestoneIdFromEpicKey(String(epic["key"] ?? "")));
          } catch {
            continue;
          }
        }
      });
      if (!epicReachedLast && log) {
        log(`listMilestones: epic scan stopped at page cap ${cap}; more pages may have been dropped (no page proved it was the last).`);
      }
    }
  } catch {
    // Fail-soft: a throwing/rejecting fetcher, or an answer the shared reader
    // cannot read (either leg, at any page), degrades the whole scan to [].
    return [];
  }

  // Every token in `found` parses under the union grammar (it is the capture
  // of MILESTONE_LABEL). compareMilestoneTokens orders numeric tokens first,
  // ascending by numeric part; epic-keyed tokens are opaque (never read as
  // numbers) and follow, sorted by code point for determinism.
  return [...found].sort(compareMilestoneTokens).map((name) => ({ name }));
}
