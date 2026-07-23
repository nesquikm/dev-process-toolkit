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
} from "../../_shared/src/milestone_token";

export interface JiraLabelledIssue {
  labels?: string[];
}

export interface JiraSearchPage {
  issues: JiraLabelledIssue[];
  isLast?: boolean;
}

export type JiraSearchPageFetcher = (page: number) => Promise<JiraSearchPage>;

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

export async function listMilestones(
  fetchPage: JiraSearchPageFetcher,
  opts?: { pageCap?: number; log?: (msg: string) => void },
): Promise<{ name: string }[]> {
  const cap = opts?.pageCap ?? MILESTONE_PAGE_CAP;
  const log = opts?.log;
  const found = new Set<string>();

  try {
    let reachedLast = false;
    let page = 0;
    for (; page < cap; page++) {
      const result = await fetchPage(page);
      for (const issue of result.issues) {
        for (const label of issue.labels ?? []) {
          const match = label.match(MILESTONE_LABEL);
          if (match) found.add(match[1]!);
        }
      }
      if (result.isLast) {
        reachedLast = true;
        break;
      }
    }
    // The loop can only exit without an isLast page by exhausting the cap, so
    // later pages may have been dropped — surface it (AC-STE-339.2: no silent
    // truncation). A clean isLast finish sets reachedLast and logs nothing.
    if (!reachedLast && log) {
      log(`listMilestones: stopped at page cap ${cap}; more pages may have been dropped (no isLast reached).`);
    }
  } catch {
    // Fail-soft: a throwing/rejecting fetcher (at any page) degrades to [].
    return [];
  }

  // Every token in `found` parses under the union grammar (it is the capture
  // of MILESTONE_LABEL). compareMilestoneTokens orders numeric tokens first,
  // ascending by numeric part; epic-keyed tokens are opaque (never read as
  // numbers) and follow, sorted by code point for determinism.
  return [...found].sort(compareMilestoneTokens).map((name) => ({ name }));
}
