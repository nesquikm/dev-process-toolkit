// STE-339 — Jira listMilestones() via milestone-label enumeration.
//
// listMilestones is a PURE FUNCTION over an INJECTED page-fetcher (mirroring
// how nextFreeMilestoneNumber injects `provider` / `branchScanner`); the real
// `searchJiraIssuesUsingJql` MCP wiring lives in adapters/jira.md prose and is
// executed by the LLM. These tests drive the core via a mocked fetcher.
//
// Behavior under test:
//   - AC-STE-339.1 label-scan listing → deduped, ascending {name:"M<N>"}[]
//   - AC-STE-339.4 label scope: only exact ^milestone-(M\d+)$ counts
//   - AC-STE-339.2 paginate, no silent cap (isLast stop + capped log)
//   - AC-STE-339.3 fail-soft: a throwing/rejecting fetcher → []

import { describe, expect, test } from "bun:test";
import {
  listMilestones,
  MILESTONE_PAGE_CAP,
  type JiraSearchPage,
} from "./list_milestones";

/** Build a fetcher that serves the given pages by index; out-of-range pages
 *  default to an empty, terminal page so a fetcher never over-runs by accident. */
function pagedFetcher(pages: JiraSearchPage[]): (page: number) => Promise<JiraSearchPage> {
  return async (page: number) => pages[page] ?? { issues: [], isLast: true };
}

/** Shorthand for an issue carrying a fixed label set. */
function issue(...labels: string[]) {
  return { labels };
}

describe("listMilestones — label-scan listing (AC-STE-339.1)", () => {
  test("mixed labels yield deduped, ascending bare M-tokens (not the milestone- label)", async () => {
    const fetch = pagedFetcher([
      {
        issues: [
          issue("milestone-M30", "frontend"),
          issue("milestone-M86"),
          issue(), // label-less issue contributes nothing
          issue("milestone-M30"), // duplicate is deduped
        ],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    expect(got).toEqual([{ name: "M30" }, { name: "M86" }]);
  });

  test("returns the bare M-token, never the milestone- prefixed label", async () => {
    const fetch = pagedFetcher([{ issues: [issue("milestone-M5")], isLast: true }]);
    const got = await listMilestones(fetch);
    expect(got).toEqual([{ name: "M5" }]);
    // Explicitly: the prefixed form must NOT leak into the result.
    expect(got.map((m) => m.name)).not.toContain("milestone-M5");
  });

  test("sorts by numeric part, not lexicographically (M9 before M30 before M100)", async () => {
    const fetch = pagedFetcher([
      {
        issues: [issue("milestone-M100"), issue("milestone-M9"), issue("milestone-M30")],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    expect(got).toEqual([{ name: "M9" }, { name: "M30" }, { name: "M100" }]);
  });

  test("no milestone labels anywhere → empty array", async () => {
    const fetch = pagedFetcher([
      { issues: [issue("frontend"), issue("backend"), issue()], isLast: true },
    ]);
    const got = await listMilestones(fetch);
    expect(got).toEqual([]);
  });
});

describe("listMilestones — label scope (AC-STE-339.4)", () => {
  test("only exact ^milestone-(M\\d+)$ labels count; near-misses are ignored", async () => {
    const fetch = pagedFetcher([
      {
        issues: [
          issue("milestone-foo"), // non-numeric suffix
          issue("milestone-"), // empty suffix
          issue("xmilestone-M5"), // prefix not anchored at start
          issue("M5"), // bare token, missing the milestone- prefix
          issue("milestone-M5-extra"), // trailing -extra breaks the anchor
          issue("milestone-M5 "), // trailing space breaks the anchor
          issue("milestone-M42"), // the ONE valid label
        ],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    // Every near-miss is rejected; only the exact-match label survives.
    expect(got).toEqual([{ name: "M42" }]);
  });

  test("a page of nothing but near-miss labels yields []", async () => {
    const fetch = pagedFetcher([
      {
        issues: [
          issue("milestone-foo"),
          issue("milestone-"),
          issue("xmilestone-M5"),
          issue("milestone-M5-extra"),
          issue("milestone-M5 "),
        ],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    expect(got).toEqual([]);
  });
});

describe("listMilestones — paginate, no silent cap (AC-STE-339.2)", () => {
  test("(a) accumulates across the page boundary until a page reports isLast:true", async () => {
    const calls: number[] = [];
    const pages: JiraSearchPage[] = [
      { issues: [issue("milestone-M30")], isLast: false },
      { issues: [issue("milestone-M86")], isLast: true },
    ];
    const fetch = async (page: number) => {
      calls.push(page);
      return pages[page] ?? { issues: [], isLast: true };
    };
    const got = await listMilestones(fetch);
    // Both pages' milestones are present, deduped + sorted.
    expect(got).toEqual([{ name: "M30" }, { name: "M86" }]);
    // Pagination drove page 0 then page 1, in order, and stopped at isLast.
    expect(calls).toEqual([0, 1]);
  });

  test("(b) hitting opts.pageCap before isLast stops the scan AND logs a one-line dropped-pages message", async () => {
    let fetched = 0;
    // A fetcher that NEVER sets isLast — without a cap it would loop forever.
    const fetch = async (_page: number): Promise<JiraSearchPage> => {
      fetched++;
      return { issues: [issue("milestone-M7")], isLast: false };
    };
    const logged: string[] = [];
    const got = await listMilestones(fetch, {
      pageCap: 3,
      log: (msg) => logged.push(msg),
    });
    // It stopped — did not run away past the cap.
    expect(fetched).toBe(3);
    // Whatever it collected before the cap is still returned (no crash).
    expect(got).toEqual([{ name: "M7" }]);
    // Exactly one log line, and it signals truncation (no silent cap).
    expect(logged.length).toBe(1);
    expect(logged[0]!.toLowerCase()).toMatch(/drop|truncat|cap|beyond|more page/);
  });

  test("the documented default cap is a positive integer used when opts.pageCap is omitted", async () => {
    expect(Number.isInteger(MILESTONE_PAGE_CAP)).toBe(true);
    expect(MILESTONE_PAGE_CAP).toBeGreaterThan(0);

    // With no pageCap supplied, a never-isLast fetcher must still terminate at
    // the documented default and log the truncation once.
    let fetched = 0;
    const fetch = async (_page: number): Promise<JiraSearchPage> => {
      fetched++;
      return { issues: [], isLast: false };
    };
    const logged: string[] = [];
    await listMilestones(fetch, { log: (msg) => logged.push(msg) });
    expect(fetched).toBe(MILESTONE_PAGE_CAP);
    expect(logged.length).toBe(1);
  });

  test("a clean isLast finish does NOT emit a dropped-pages log", async () => {
    const logged: string[] = [];
    const fetch = pagedFetcher([{ issues: [issue("milestone-M1")], isLast: true }]);
    const got = await listMilestones(fetch, { pageCap: 5, log: (msg) => logged.push(msg) });
    expect(got).toEqual([{ name: "M1" }]);
    // No truncation occurred, so no log line about dropped pages.
    expect(logged).toEqual([]);
  });
});

describe("listMilestones — fail-soft (AC-STE-339.3)", () => {
  test("a fetcher that throws synchronously degrades to [] and never throws", async () => {
    const fetch = (_page: number): Promise<JiraSearchPage> => {
      throw new Error("JQL boom");
    };
    let resolved: { name: string }[] | "threw" = "threw";
    await expect(
      (async () => {
        resolved = await listMilestones(fetch);
      })(),
    ).resolves.toBeUndefined();
    expect(resolved).toEqual([]);
  });

  test("a fetcher that rejects degrades to [] and never throws", async () => {
    const fetch = async (_page: number): Promise<JiraSearchPage> => {
      throw new Error("network down");
    };
    const got = await listMilestones(fetch);
    expect(got).toEqual([]);
  });

  test("a fetcher that rejects on a LATER page degrades to [] without throwing", async () => {
    const fetch = async (page: number): Promise<JiraSearchPage> => {
      if (page === 0) return { issues: [issue("milestone-M30")], isLast: false };
      throw new Error("page 1 exploded");
    };
    const got = await listMilestones(fetch);
    // A mid-scan failure is non-load-bearing: the whole scan degrades to [].
    expect(got).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STE-376 AC-STE-376.3 — the label token filter accepts the M_<epic-key>
// union shape. Epic-keyed labels are surfaced as bare tokens (existence
// checks need them) while staying opaque to the numeric max+1 computation
// (scanTracker in next_free_milestone_number.ts ignores non-`M<N>` names).
// ---------------------------------------------------------------------------

describe("listMilestones — M_<epic-key> label tolerance (AC-STE-376.3)", () => {
  test("milestone-M_PROJ_500 is surfaced as { name: 'M_PROJ_500' } alongside numeric tokens", async () => {
    const fetch = pagedFetcher([
      {
        issues: [issue("milestone-M30", "frontend"), issue("milestone-M_PROJ_500")],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    const names = got.map((m) => m.name);
    expect(names).toContain("M30");
    expect(names).toContain("M_PROJ_500");
  });

  test("hyphen-form epic label (milestone-M_PROJ-500) is surfaced whole", async () => {
    const fetch = pagedFetcher([
      { issues: [issue("milestone-M_PROJ-500")], isLast: true },
    ]);
    const got = await listMilestones(fetch);
    expect(got.map((m) => m.name)).toContain("M_PROJ-500");
  });

  test("duplicate epic labels are deduped", async () => {
    const fetch = pagedFetcher([
      {
        issues: [issue("milestone-M_PROJ_500"), issue("milestone-M_PROJ_500")],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    expect(got.filter((m) => m.name === "M_PROJ_500").length).toBe(1);
  });

  test("malformed epic label milestone-M_ (empty key) is not surfaced", async () => {
    const fetch = pagedFetcher([
      { issues: [issue("milestone-M_", "milestone-M5")], isLast: true },
    ]);
    const got = await listMilestones(fetch);
    expect(got.map((m) => m.name)).toEqual(["M5"]);
  });

  test("numeric tokens keep their ascending numeric order when epic tokens are present", async () => {
    const fetch = pagedFetcher([
      {
        issues: [
          issue("milestone-M100"),
          issue("milestone-M_PROJ_500"),
          issue("milestone-M9"),
        ],
        isLast: true,
      },
    ]);
    const got = await listMilestones(fetch);
    const numeric = got.map((m) => m.name).filter((n) => /^M\d+$/.test(n));
    expect(numeric).toEqual(["M9", "M100"]);
  });
});
