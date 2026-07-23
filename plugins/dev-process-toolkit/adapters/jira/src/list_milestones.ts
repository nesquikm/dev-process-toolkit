// STE-339 — Jira listMilestones() via milestone-label enumeration.
//
// PURE FUNCTION over an INJECTED page-fetcher (Schema-P house style, mirroring
// adapters/jira/src/discover_field.ts and the way nextFreeMilestoneNumber
// injects `provider` / `branchScanner`). The real `searchJiraIssuesUsingJql`
// MCP wiring lives in adapters/jira.md prose and is executed by the LLM; here
// the injected `fetchPage` is the only seam — no network, no auth.
//
// listMilestones drives pagination by calling fetchPage(0), fetchPage(1), …
// accumulating each page's issues. Every label matching the milestone-token
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
} from "../../_shared/src/milestone_token";

export interface JiraLabelledIssue {
  labels?: string[];
}

export interface JiraSearchPage {
  issues: JiraLabelledIssue[];
  isLast?: boolean;
}

export type JiraSearchPageFetcher = (page: number) => Promise<JiraSearchPage>;

// STE-375 AC-STE-375.3 — Epic-enumeration leg. The injected seam over the
// `issuetype = Epic` JQL (`searchJiraIssuesUsingJql`, paginated like the
// label leg). Milestone Epics are selected CLIENT-SIDE: an Epic counts iff
// its summary's first whitespace-delimited word parses under the shared
// milestone-token union grammar. Each match contributes `M_<epic-key>` (key
// verbatim) — never a full labelled-task scan.
export interface JiraEpicSearchPage {
  epics: { key: string; summary?: string }[];
  isLast?: boolean;
}

export type JiraEpicPageFetcher = (page: number) => Promise<JiraEpicSearchPage>;

/**
 * Documented default pagination cap. Bounds the scan when no page reports
 * `isLast` so a never-terminating fetcher can never run away; also doubles as
 * the loop bound the test suite relies on. Used when `opts.pageCap` is omitted.
 */
export const MILESTONE_PAGE_CAP = 50;

// Exact-scope anchor: only `milestone-M<N>` / `milestone-M_<epic-key>` (no
// prefix, no suffix, no trailing whitespace) counts; the captured group is the
// bare token. The union shape comes from the shared `milestone_token` sources,
// so malformed labels (`milestone-M_`, `milestone-M5-extra`) stay rejected.
const MILESTONE_LABEL = new RegExp(`^milestone-(${MILESTONE_TOKEN_SOURCE})$`);

/**
 * Shared pagination driver for both enumeration legs: calls `fetch(0)`,
 * `fetch(1)`, … up to `cap` pages, feeding each page to `onPage` and stopping
 * early when a page reports `isLast`. Returns `true` on a clean isLast
 * finish, `false` when the cap was exhausted first — the caller surfaces the
 * possible truncation (AC-STE-339.2: no silent cap).
 */
async function scanPages<P extends { isLast?: boolean }>(
  fetch: (page: number) => Promise<P>,
  cap: number,
  onPage: (result: P) => void,
): Promise<boolean> {
  for (let page = 0; page < cap; page++) {
    const result = await fetch(page);
    onPage(result);
    if (result.isLast) return true;
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
    // Grandfathered milestone-M<N> label leg (STE-339) — persists solely for
    // pre-Epic milestones; the epic leg below is the primary enumeration.
    const reachedLast = await scanPages(fetchPage, cap, (result) => {
      for (const issue of result.issues) {
        for (const label of issue.labels ?? []) {
          const match = label.match(MILESTONE_LABEL);
          if (match) found.add(match[1]!);
        }
      }
    });
    // scanPages only returns false by exhausting the cap, so later pages may
    // have been dropped — surface it (AC-STE-339.2: no silent truncation).
    // A clean isLast finish logs nothing.
    if (!reachedLast && log) {
      log(`listMilestones: stopped at page cap ${cap}; more pages may have been dropped (no isLast reached).`);
    }

    // Epic-enumeration leg (AC-STE-375.3): same pagination + cap discipline
    // as the label leg, over the `issuetype = Epic` seam. Client-side name
    // filter — only Epics whose summary LEADS with a milestone token count;
    // each contributes `M_<epic-key>` into the same deduping union.
    const fetchEpicPage = opts?.fetchEpicPage;
    if (fetchEpicPage) {
      const epicReachedLast = await scanPages(fetchEpicPage, cap, (result) => {
        for (const epic of result.epics) {
          const firstWord = epic.summary?.trim().split(/\s+/)[0] ?? "";
          if (isMilestoneToken(firstWord)) found.add(`M_${epic.key}`);
        }
      });
      if (!epicReachedLast && log) {
        log(`listMilestones: epic scan stopped at page cap ${cap}; more pages may have been dropped (no isLast reached).`);
      }
    }
  } catch {
    // Fail-soft: a throwing/rejecting fetcher (either leg, at any page)
    // degrades the whole scan to [].
    return [];
  }

  // Every token in `found` parses under the union grammar (it is the capture
  // of MILESTONE_LABEL). compareMilestoneTokens orders numeric tokens first,
  // ascending by numeric part; epic-keyed tokens are opaque (never read as
  // numbers) and follow, sorted by code point for determinism.
  return [...found].sort(compareMilestoneTokens).map((name) => ({ name }));
}
