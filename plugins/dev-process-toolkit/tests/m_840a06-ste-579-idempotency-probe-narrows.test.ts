// STE-579 (M_840a06) — the idempotency probe stops always-missing, stops
// mis-binding, and grades its stop.
//
// FOUR SHIPPED SITES order the "was this ticket already created?" comparison as
// an EXACT-TITLE tracker query. Measured live against cloudId
// 96bffaef-cf5d-4dbf-a170-3d700df9bc83:
//
//   project = GF AND summary = "The reward banner, repainted light"
//       -> {"issues": [], "isLast": true}          silent ALWAYS-MISS
//   project = GF AND summary ~ "\"The reward banner, repainted light\""
//       -> GF-83, exactly one
//   Linear list_issues(query="Reward banner", team=STE)
//       -> 9 issues, NONE carrying the string  (ranked relevance, not a filter)
//
// The four sites, asserted SEPARATELY below — a roll-up that greens when three
// of four are fixed is the exact hole this repository has recorded as
// "milestone reproduces its own defect":
//
//   1. adapters/jira.md   ~:291-294  single-shot pre-create JQL probe
//   2. adapters/jira.md   ~:296-319  the Gateway-Timeout retry table
//   3. adapters/linear.md ~:248-259  the symmetric Linear blockquote
//   4. skills/spec-write/SKILL.md:109 THE EXECUTING COPY (adapters are reference)
//
// The behavioural half loads its subject through a LAZY dynamic import so a
// missing module reds only the behavioural describes — every doc-conformance
// and pin assertion still reports its own RED independently.

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_CAPABILITY_KEYS,
  KEY_OWNER_SKILL,
  runClosingSummaryCapabilityKeysProbe,
} from "../adapters/_shared/src/closing_summary_capability_keys";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { CANONICAL_KEYS as TASK_TRACKING_CANONICAL_KEYS } from "../adapters/_shared/src/task_tracking_canonical_keys";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const SPEC_WRITE_SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const JIRA_ADAPTER = join(pluginRoot, "adapters", "jira.md");
const LINEAR_ADAPTER = join(pluginRoot, "adapters", "linear.md");
const M84_TEST = join(pluginRoot, "tests", "m84-ste-320-code-reviewer-scope-registry.test.ts");
const M126_TEST = join(pluginRoot, "tests", "m126-ste-482-allowlist-loud-merge.test.ts");
const JIRA_RETRY_TEST = join(pluginRoot, "tests", "spec-write-jira-retry-idempotency.test.ts");

const read = (p: string) => readFileSync(p, "utf-8");

/** The section anchor both adapter docs use for the create/upsert contract. */
function upsertSection(body: string): string {
  const start = body.indexOf("### `upsert_ticket_metadata");
  expect(start).toBeGreaterThan(-1);
  return body.slice(start);
}

/**
 * § 0b step 4 of /spec-write, sliced EXACTLY as
 * tests/spec-write-jira-retry-idempotency.test.ts slices it — same
 * `body.indexOf("\n4. ")` head and same `\n5. ` tail — so this file grades the
 * same bytes the sibling suite grades and cannot drift away from it.
 */
function extractStep4(body: string): string {
  const start = body.indexOf("\n4. ");
  expect(start).toBeGreaterThan(-1);
  const tail = body.slice(start + 1);
  const endRel = tail.search(/\n5\. /);
  const slice = endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
  expect(slice).toContain("Provider.sync(spec)");
  return slice;
}

// ===========================================================================
// The module under test — contract declared here, loaded lazily.
// ===========================================================================

const MODULE_SPECIFIER = "../adapters/_shared/src/create_idempotency_probe";

type DriftRule = "en-dash" | "double-space" | "trailing-space" | "nbsp" | "heading-anchor";

interface IdempotencyCandidate {
  id: string;
  title: string;
  labels: readonly string[];
}

interface IdempotencySearchResult {
  candidates: readonly IdempotencyCandidate[];
  /** true when the result page hit the documented cap before reporting isLast. */
  capped: boolean;
}

interface IdempotencySearchParams {
  projectKey: string;
  title: string;
  parentKey?: string;
  milestoneLabel?: string;
  repoTag?: string;
}

interface IdempotencyDeps {
  search(params: IdempotencySearchParams): Promise<IdempotencySearchResult>;
  create(params: { projectKey: string; title: string }): Promise<{ id: string }>;
}

type IdempotencyOutcome =
  | { kind: "reused"; id: string; capability: null }
  | { kind: "created"; id: string; capability: null }
  | {
      kind: "refused";
      id: null;
      capability: "tracker_idempotency_uncertain";
      reason: "foreign-repo-tag" | "page-cap";
    };

interface ProbeModule {
  DRIFT_RULES: readonly DriftRule[];
  normalizeTitleForCompare(title: string, rules?: readonly DriftRule[]): string;
  RepoTagBindingError: new (...args: never[]) => Error;
  assertRepoTagForwarded(
    repoTag: string | undefined,
    defaultLabels: readonly string[] | undefined,
  ): void;
  buildIdempotencyJql(params: IdempotencySearchParams): string;
  runCreateIdempotencyProbe(
    params: IdempotencySearchParams & { defaultLabels?: readonly string[] },
    deps: IdempotencyDeps,
  ): Promise<IdempotencyOutcome>;
}

async function probeModule(): Promise<ProbeModule> {
  return (await import(MODULE_SPECIFIER)) as unknown as ProbeModule;
}

function recorder(result: IdempotencySearchResult) {
  const searches: IdempotencySearchParams[] = [];
  const creates: { projectKey: string; title: string }[] = [];
  const deps: IdempotencyDeps = {
    async search(params) {
      searches.push(params);
      return result;
    },
    async create(params) {
      creates.push(params);
      return { id: "GF-FRESH" };
    },
  };
  return { searches, creates, deps };
}

const TITLE = "The reward banner - repainted light";
const CONTAINER = { projectKey: "GF", parentKey: "GF-40" } as const;

// ===========================================================================
// AC-STE-579.1 — adapters/jira.md: the exact-title order is GONE, and the
//                narrowing contract is PRESENT. Absence never ships alone.
// ===========================================================================

describe("AC-STE-579.1 — jira.md stops ordering an exact-summary join", () => {
  test("site 1+2: the literal `matches \\`title\\` exactly` order is gone from the whole file", () => {
    const body = read(JIRA_ADAPTER);
    expect(
      body.includes("matches `title` exactly"),
      "adapters/jira.md still orders `summary = <title>`, which Jira ACCEPTS and answers " +
        "with zero rows — a silent always-miss, measured on GF-83",
    ).toBe(false);
  });

  test("site 1: the single-shot pre-create probe orders `summary ~`", () => {
    const section = upsertSection(read(JIRA_ADAPTER));
    const probeStart = section.indexOf("Pre-create JQL idempotency probe");
    expect(probeStart).toBeGreaterThan(-1);
    // The single-shot bullet ends where the createJiraIssue call begins.
    const probeEnd = section.indexOf("mcp__atlassian__createJiraIssue", probeStart);
    expect(probeEnd).toBeGreaterThan(probeStart);
    const singleShot = section.slice(probeStart, probeEnd);
    expect(singleShot).toContain("summary ~");
    expect(singleShot).not.toContain("matches `title` exactly");
  });

  test("site 2: the Gateway-Timeout retry table orders `summary ~`, not an exact match", () => {
    const section = upsertSection(read(JIRA_ADAPTER));
    const tableStart = section.indexOf("| Attempt | Wait before probe | Action |");
    expect(tableStart).toBeGreaterThan(-1);
    const tableEnd = section.indexOf("Three attempts total", tableStart);
    expect(tableEnd).toBeGreaterThan(tableStart);
    const table = section.slice(tableStart, tableEnd);
    expect(
      table,
      "the retry table runs the SAME probe three times — fixing the single-shot bullet " +
        "and leaving the table re-ships the always-miss on the retry path",
    ).toContain("summary ~");
    expect(table).not.toMatch(/exact `summary` match|summary = /);
  });

  test("the narrowing contract is stated: the query narrows, the client joins", () => {
    const section = upsertSection(read(JIRA_ADAPTER));
    expect(
      section,
      "adapters/jira.md must state that the query NARROWS THE PAGE — `~` is a text " +
        "match, never an identity test",
    ).toContain("narrows the page");
    expect(
      section,
      "…and that THE CLIENT DECIDES THE JOIN, by normalized compare over the narrowed page",
    ).toContain("the client decides the join");
  });

  test("the measured always-miss evidence is recorded, not merely the fix", () => {
    const body = read(JIRA_ADAPTER);
    expect(
      /always[- ]miss/i.test(body),
      "record WHY `=` was wrong: Jira accepts it and answers zero rows for a summary " +
        "the issue provably carries (GF-83) — an accepted-and-empty answer, not a syntax error",
    ).toBe(true);
    expect(body.includes("GF-83"), "name the measured witness issue key").toBe(true);
  });
});

// ===========================================================================
// AC-STE-579.2 — `repo_tag` lands in all three surfaces, as a FREE-FORM
//                sub-section field, never a `## Task Tracking` top-level key.
// ===========================================================================

describe("AC-STE-579.2 — repo_tag is documented on all three surfaces", () => {
  test("adapters/jira.md names repo_tag", () => {
    expect(read(JIRA_ADAPTER).includes("repo_tag")).toBe(true);
  });

  test("adapters/linear.md names repo_tag", () => {
    expect(read(LINEAR_ADAPTER).includes("repo_tag")).toBe(true);
  });

  test("skills/spec-write/SKILL.md — THE EXECUTING COPY — names repo_tag", () => {
    expect(
      read(SPEC_WRITE_SKILL).includes("repo_tag"),
      "the adapter docs are reference; SKILL.md is what the LLM runs. Documenting " +
        "repo_tag in the adapters only is the milestone-reproduces-its-own-defect shape",
    ).toBe(true);
  });

  test("THE EXECUTING COPY carries the NARROWING CONTRACT itself, not just proxy tokens", () => {
    // The audit's finding: every assertion about narrow-then-compare was scoped to
    // adapters/jira.md. Line 109 was pinned only by `repo_tag` and the MUST-emit
    // directive — proxy tokens. A line 109 that gained both while KEEPING
    // exact-title language would have stayed green, leaving this FR's own subject
    // unasserted on the single site that executes. The adapter docs are reference;
    // this line is what the LLM runs.
    const executing = read(SPEC_WRITE_SKILL).split("\n")[108] ?? "";

    expect(
      executing,
      "line 109 must state that the query only NARROWS the candidate page",
    ).toMatch(/narrows the page/i);

    expect(
      executing,
      "line 109 must state that the CLIENT decides the join, not the query",
    ).toMatch(/client decides the join/i);

    expect(
      executing,
      "line 109 must state that a non-empty page is not by itself a hit",
    ).toMatch(/not a hit|never a hit/i);

    // The defect being removed, asserted as absent ON THIS LINE rather than
    // repo-wide: an exact-summary equality join is the silent always-miss.
    expect(
      executing.includes("summary = "),
      "line 109 must not order an exact-summary equality join — Jira ACCEPTS it and " +
        "answers zero rows, which is the always-miss this FR exists to close",
    ).toBe(false);
  });

  test("repo_tag is documented as a free-form `### Jira` / `### Linear` sub-section field", () => {
    for (const [label, path] of [
      ["jira", JIRA_ADAPTER],
      ["linear", LINEAR_ADAPTER],
    ] as const) {
      const body = read(path);
      const idx = body.indexOf("repo_tag");
      expect(idx).toBeGreaterThan(-1);
      // The declaration paragraph must say free-form and name the sub-section,
      // exactly as `default_labels` already does.
      const near = body.slice(Math.max(0, idx - 600), idx + 600);
      expect(near, `${label}: repo_tag must be declared free-form`).toMatch(/free-form/i);
      expect(near, `${label}: repo_tag must be declared under the adapter sub-section`).toMatch(
        /### Linear|### Jira/,
      );
    }
  });

  test("repo_tag is NOT promoted to a `## Task Tracking` top-level canonical key", () => {
    expect(
      TASK_TRACKING_CANONICAL_KEYS.has("repo_tag"),
      "a top-level canonical key would red the task-tracking-canonical-keys probe for " +
        "every consumer project that does not set it; repo_tag is free-form, like default_labels",
    ).toBe(false);
    // Non-vacuity: the set this test reads is the real one.
    expect(TASK_TRACKING_CANONICAL_KEYS.has("mode")).toBe(true);
  });
});

// ===========================================================================
// AC-STE-579.3 — adapters/linear.md: `query=<title>` is gone; the ranked-
//                relevance truth and the structured replacement are stated.
// ===========================================================================

describe("AC-STE-579.3 — linear.md stops joining on the relevance query", () => {
  test("site 3: the symmetric blockquote no longer orders `query=<title>`", () => {
    const body = read(LINEAR_ADAPTER);
    expect(
      body.includes("query=<title>"),
      "measured: list_issues(query=\"Reward banner\", team=STE) returned 9 issues, NONE " +
        "carrying the string — a ranked relevance search, never a filter",
    ).toBe(false);
  });

  test("linear.md states the query is a RANKED RELEVANCE search over title or description", () => {
    const section = upsertSection(read(LINEAR_ADAPTER));
    expect(section).toContain("ranked relevance search");
    expect(section).toMatch(/title or description/i);
  });

  test("linear.md states the relevance query must never be joined on", () => {
    const section = upsertSection(read(LINEAR_ADAPTER));
    expect(section).toContain("never be joined on");
  });

  test("the structured parameters that replace the query are NAMED", () => {
    const section = upsertSection(read(LINEAR_ADAPTER));
    for (const param of ["`team`", "`project`", "`label`"]) {
      expect(section, `the replacement must name ${param} explicitly`).toContain(param);
    }
  });
});

// ===========================================================================
// AC-STE-579.4 — the create call COUNT is zero, on the refusal path and on the
//                success path SEPARATELY. A parent-only assertion passes on an
//                implementation that minted a stray and ignored it.
// ===========================================================================

describe("AC-STE-579.4 — foreign repo_tag never mints", () => {
  test("refusal path: a container hit carrying a DIFFERENT repo_tag issues zero creates", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [{ id: "GB-83", title: TITLE, labels: ["glacy-be"] }],
      capped: false,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(rec.creates).toHaveLength(0);
    expect(outcome.kind).toBe("refused");
    expect(outcome.capability).toBe("tracker_idempotency_uncertain");
    expect((outcome as { reason: string }).reason).toBe("foreign-repo-tag");
    expect(outcome.id).toBeNull();
  });

  test("success path: a container hit carrying the SAME repo_tag also issues zero creates", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [{ id: "GF-83", title: TITLE, labels: ["glacy-fe"] }],
      capped: false,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(rec.creates).toHaveLength(0);
    expect(outcome).toEqual({ kind: "reused", id: "GF-83", capability: null });
  });

  test("the zero-count assertions are NOT vacuous — an empty page does mint, exactly once", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({ candidates: [], capped: false });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(rec.creates).toEqual([{ projectKey: "GF", title: TITLE }]);
    expect(outcome).toEqual({ kind: "created", id: "GF-FRESH", capability: null });
  });

  test("the refusal never widens into a create even when a same-tag sibling is also on the page", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    // A page carrying BOTH a foreign-tag exact match and an unrelated same-tag
    // issue: the foreign match is the one that matters and it stops the run.
    const rec = recorder({
      candidates: [
        { id: "GB-83", title: TITLE, labels: ["glacy-be"] },
        { id: "GF-11", title: "Something else entirely", labels: ["glacy-fe"] },
      ],
      capped: false,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(rec.creates).toHaveLength(0);
    expect(outcome.kind).toBe("refused");
  });
});

// ===========================================================================
// AC-STE-579.5 — one case PER drift trigger, and each case FAILS on its
//                siblings' fix. Isolation proven in both directions.
// ===========================================================================

const CANONICAL_TITLE = "The reward banner - repainted light";

const DRIFT_CASES: { rule: DriftRule; variant: string; what: string }[] = [
  {
    rule: "en-dash",
    variant: "The reward banner – repainted light",
    what: "an en-dash where the canonical carries an ASCII hyphen",
  },
  {
    rule: "double-space",
    variant: "The reward banner -  repainted light",
    what: "a doubled internal space",
  },
  {
    rule: "trailing-space",
    variant: "The reward banner - repainted light  ",
    what: "trailing whitespace",
  },
  {
    rule: "nbsp",
    variant: "The reward banner -\u00A0repainted light",
    what: "a non-breaking space",
  },
  {
    rule: "heading-anchor",
    variant: "The reward banner - repainted light {#reward-banner}",
    what: "a retained heading anchor",
  },
];

describe("AC-STE-579.5 — the normalized compare, one case per drift trigger", () => {
  test("DRIFT_RULES enumerates exactly the five normalizing triggers", async () => {
    const { DRIFT_RULES } = await probeModule();
    expect([...DRIFT_RULES].sort()).toEqual(
      ["double-space", "en-dash", "heading-anchor", "nbsp", "trailing-space"],
    );
  });

  for (const c of DRIFT_CASES) {
    test(`${c.rule}: ${c.what} normalizes onto the canonical title`, async () => {
      const { normalizeTitleForCompare } = await probeModule();
      expect(normalizeTitleForCompare(c.variant)).toBe(
        normalizeTitleForCompare(CANONICAL_TITLE),
      );
      // …and the raw strings really do differ, so the case is not self-satisfying.
      expect(c.variant).not.toBe(CANONICAL_TITLE);
    });

    test(`${c.rule}: its OWN rule alone is sufficient`, async () => {
      const { normalizeTitleForCompare } = await probeModule();
      expect(normalizeTitleForCompare(c.variant, [c.rule])).toBe(
        normalizeTitleForCompare(CANONICAL_TITLE, [c.rule]),
      );
    });

    test(`${c.rule}: FAILS on every sibling's fix — isolation in both directions`, async () => {
      const { normalizeTitleForCompare } = await probeModule();
      const siblings = DRIFT_CASES.filter((s) => s.rule !== c.rule).map((s) => s.rule);
      expect(siblings).toHaveLength(4);
      for (const sibling of siblings) {
        expect(
          normalizeTitleForCompare(c.variant, [sibling]),
          `the ${sibling} rule alone must NOT absorb ${c.rule} drift — a suite whose ` +
            `six cases all pass under one rule proves only that six cases pass`,
        ).not.toBe(normalizeTitleForCompare(CANONICAL_TITLE, [sibling]));
      }
    });
  }

  test("plain retitle: a genuinely different title never compares equal, under any rule set", async () => {
    const { DRIFT_RULES, normalizeTitleForCompare } = await probeModule();
    const retitled = "The reward banner - repainted dark";
    expect(normalizeTitleForCompare(retitled)).not.toBe(
      normalizeTitleForCompare(CANONICAL_TITLE),
    );
    for (const rule of DRIFT_RULES) {
      expect(normalizeTitleForCompare(retitled, [rule])).not.toBe(
        normalizeTitleForCompare(CANONICAL_TITLE, [rule]),
      );
    }
  });

  test("the probe joins on the normalized compare, not on raw bytes", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [
        { id: "GF-83", title: "The reward banner – repainted light  ", labels: ["glacy-fe"] },
      ],
      capped: false,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: CANONICAL_TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(rec.creates).toHaveLength(0);
    expect(outcome).toEqual({ kind: "reused", id: "GF-83", capability: null });
  });
});

// ===========================================================================
// AC-STE-579.6 — a declared repo_tag absent from the forwarded default labels
//                is REFUSED in NFR-10 canonical shape, naming both.
// ===========================================================================

describe("AC-STE-579.6 — an unforwarded repo_tag is refused, not silently trusted", () => {
  test("a declared tag missing from defaultLabels throws RepoTagBindingError", async () => {
    const { assertRepoTagForwarded, RepoTagBindingError } = await probeModule();
    expect(() => assertRepoTagForwarded("glacy-fe", ["milestone-M46"])).toThrow(
      RepoTagBindingError,
    );
  });

  test("the refusal carries NFR-10 canonical shape and names the tag AND the label set", async () => {
    const { assertRepoTagForwarded } = await probeModule();
    let message = "";
    try {
      assertRepoTagForwarded("glacy-fe", ["milestone-M46", "spec"]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    const lines = message.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).not.toMatch(/^Remedy:|^Context:/);
    expect(message).toMatch(/\nRemedy: /);
    expect(message).toMatch(/\nContext: /);
    // A tag that never lands on a created issue produces a conjunct that always
    // misses, so EVERY later probe would read "no prior run" — the message must
    // name both halves of the mismatch, not just the tag.
    expect(message).toContain("glacy-fe");
    expect(message).toContain("milestone-M46");
    expect(message).toContain("spec");
  });

  test("a forwarded tag does NOT throw — the refusal is not unconditional", async () => {
    const { assertRepoTagForwarded } = await probeModule();
    expect(() => assertRepoTagForwarded("glacy-fe", ["glacy-fe", "milestone-M46"])).not.toThrow();
  });

  test("an undeclared tag never throws, even against empty labels", async () => {
    const { assertRepoTagForwarded } = await probeModule();
    expect(() => assertRepoTagForwarded(undefined, [])).not.toThrow();
    expect(() => assertRepoTagForwarded(undefined, undefined)).not.toThrow();
  });

  test("the probe refuses BEFORE searching or creating", async () => {
    const { runCreateIdempotencyProbe, RepoTagBindingError } = await probeModule();
    const rec = recorder({ candidates: [], capped: false });
    await expect(
      runCreateIdempotencyProbe(
        { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["milestone-M46"] },
        rec.deps,
      ),
    ).rejects.toBeInstanceOf(RepoTagBindingError);
    expect(rec.searches).toHaveLength(0);
    expect(rec.creates).toHaveLength(0);
  });
});

// ===========================================================================
// AC-STE-579.7 — with no repo_tag declared, every leg behaves as at HEAD apart
//                from the query-operator change. Absent === empty, byte for byte.
// ===========================================================================

describe("AC-STE-579.7 — the no-repo_tag path is unchanged", () => {
  test("an absent repo_tag and an empty one are byte-identical, outcome and search params", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const page: IdempotencySearchResult = {
      candidates: [{ id: "GF-83", title: TITLE, labels: ["glacy-be"] }],
      capped: false,
    };
    const absent = recorder(page);
    const empty = recorder(page);
    const a = await runCreateIdempotencyProbe({ ...CONTAINER, title: TITLE }, absent.deps);
    const b = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "" },
      empty.deps,
    );
    expect(a).toEqual(b);
    expect(absent.searches).toEqual(empty.searches);
    expect(absent.creates).toEqual(empty.creates);
  });

  test("with no repo_tag, a foreign-labelled candidate is REUSED — HEAD behaviour, untouched", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [{ id: "GB-83", title: TITLE, labels: ["glacy-be"] }],
      capped: false,
    });
    const outcome = await runCreateIdempotencyProbe({ ...CONTAINER, title: TITLE }, rec.deps);
    expect(
      outcome,
      "the repo-tag join is opt-in: an undeclared tag must not start refusing runs that " +
        "worked at HEAD",
    ).toEqual({ kind: "reused", id: "GB-83", capability: null });
    expect(rec.creates).toHaveLength(0);
  });

  test("with no repo_tag a CAPPED page still refuses — the ONE named exception to as-at-HEAD", async () => {
    // The audit caught AC.7 and AC.8 colliding on exactly this leg. AC.7 promises
    // the no-tag path behaves as at HEAD; AC.8 promises a capped page is never a
    // miss. They cannot both be unconditional, so the cap WINS and AC.7 carries a
    // NAMED exception rather than a silent one. Untested, this leg was free to
    // drift either way, and every other cap test declares a tag.
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({ candidates: [], capped: true });
    const outcome = await runCreateIdempotencyProbe({ ...CONTAINER, title: TITLE }, rec.deps);
    expect(
      outcome.kind,
      "a capped page has not PROVEN the ticket absent, tag or no tag — creating on it " +
        "is the duplicate this FR exists to stop",
    ).toBe("refused");
    expect(rec.creates, "zero creates on an unproven absence").toHaveLength(0);
  });

  test("with no repo_tag an UNCAPPED miss still creates — the exception is scoped to the cap", async () => {
    // The sibling of the above, and what stops it reading as a blanket halt:
    // drop `capped`, and the no-tag path creates exactly as it did at HEAD.
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({ candidates: [], capped: false });
    const outcome = await runCreateIdempotencyProbe({ ...CONTAINER, title: TITLE }, rec.deps);
    expect(outcome.kind).toBe("created");
    expect(rec.creates).toHaveLength(1);
  });

  test("with no repo_tag the JQL carries no label conjunct — but DOES carry `summary ~`", async () => {
    const { buildIdempotencyJql } = await probeModule();
    const jql = buildIdempotencyJql({ ...CONTAINER, title: TITLE });
    expect(jql).not.toContain("labels = ");
    expect(jql).toContain("summary ~");
    expect(jql).not.toContain("summary = ");
  });

  test("with a repo_tag the JQL narrows by the label, quoted-phrase-escaped on summary", async () => {
    const { buildIdempotencyJql } = await probeModule();
    const jql = buildIdempotencyJql({ ...CONTAINER, title: TITLE, repoTag: "glacy-fe" });
    expect(jql).toContain('labels = "glacy-fe"');
    expect(jql).toContain("project = GF");
    expect(jql).toContain("parent = GF-40");
    // Measured: `summary ~ "\"<title>\""` returns GF-83, exactly one. The
    // escaped inner quotes are the phrase-match form; without them `~` widens.
    expect(jql).toContain('summary ~ "\\"' + TITLE + '\\""');
  });
});

// ===========================================================================
// AC-STE-579.8 — a capped result page is UNCERTAINTY, never a miss.
// ===========================================================================

describe("AC-STE-579.8 — a capped page is uncertainty, mirroring MILESTONE_PAGE_CAP", () => {
  test("cap reached with no match: zero creates, graded refusal", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [{ id: "GF-11", title: "Something else entirely", labels: ["glacy-fe"] }],
      capped: true,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(
      rec.creates,
      "a capped page that did not report isLast has NOT proven the ticket absent; " +
        "creating on it is the duplicate this FR exists to stop",
    ).toHaveLength(0);
    expect(outcome.kind).toBe("refused");
    expect(outcome.capability).toBe("tracker_idempotency_uncertain");
    expect((outcome as { reason: string }).reason).toBe("page-cap");
  });

  test("cap NOT reached with no match: the run creates — the cap clause is not a blanket halt", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [{ id: "GF-11", title: "Something else entirely", labels: ["glacy-fe"] }],
      capped: false,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(rec.creates).toHaveLength(1);
    expect(outcome.kind).toBe("created");
  });

  test("a capped page that DOES carry the match still reuses — the cap never masks a hit", async () => {
    const { runCreateIdempotencyProbe } = await probeModule();
    const rec = recorder({
      candidates: [{ id: "GF-83", title: TITLE, labels: ["glacy-fe"] }],
      capped: true,
    });
    const outcome = await runCreateIdempotencyProbe(
      { ...CONTAINER, title: TITLE, repoTag: "glacy-fe", defaultLabels: ["glacy-fe"] },
      rec.deps,
    );
    expect(outcome).toEqual({ kind: "reused", id: "GF-83", capability: null });
    expect(rec.creates).toHaveLength(0);
  });

  test("adapters/jira.md states the cap clause for the idempotency probe too", () => {
    const section = upsertSection(read(JIRA_ADAPTER));
    const probeStart = section.indexOf("Pre-create JQL idempotency probe");
    const probeEnd = section.indexOf("Capture the returned `key`", probeStart);
    expect(probeEnd).toBeGreaterThan(probeStart);
    const probeProse = section.slice(probeStart, probeEnd);
    expect(
      probeProse,
      "mirror the milestone-listing pagination cap already shipped in this file: a page " +
        "that reaches the cap before reporting isLast is uncertainty, not a miss",
    ).toMatch(/cap/i);
    expect(probeProse).toMatch(/uncertain/i);
  });
});

// ===========================================================================
// AC-STE-579.9 — the capped file's measurements, unmoved.
// ===========================================================================

/** Frozen historical value. DOWN-ONLY: this FR may not RAISE the pin. */
const PIN_FROZEN_AT = 129;

function steTokenCount(body: string): number {
  return (body.match(/STE-\d+/g) ?? []).length;
}

describe("AC-STE-579.9 — spec-write/SKILL.md stays exactly where it is", () => {
  test("the file measures exactly 358 split-lines — an in-place rewrite, no insert, no reflow", () => {
    const lines = read(SPEC_WRITE_SKILL).split("\n");
    expect(
      lines.length,
      "line 109 is a one-line-for-one-line rewrite; NFR-1's cap on this file is enforced " +
        "by a test that pins the split-line count",
    ).toBe(358);
  });

  test("the milestone-attachment paragraph is still at line 111", () => {
    const lines = read(SPEC_WRITE_SKILL).split("\n");
    expect(lines[110]).toContain("**Milestone attachment");
    // …and line 109 sits ABOVE it, still carrying the idempotency contract.
    expect(lines[108]).toContain("Idempotency hardening on Gateway-Timeout retry");
  });

  test("line 109 names NO module path — the reachability pin is down-only", () => {
    const line109 = read(SPEC_WRITE_SKILL).split("\n")[108]!;
    expect(
      line109.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.ts\b/),
      "naming a `<dir>/<file>.ts` on an ORDERED line raises ORDERED_UNREACHABLE_PIN " +
        "129 -> 130, and that ratchet refuses a recorded raise",
    ).toBeNull();
  });

  test("ORDERED_UNREACHABLE_PIN is not raised, and the awaited probe measures it", async () => {
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThanOrEqual(PIN_FROZEN_AT);
    // AWAITED. Without `await` every field reads undefined and every assertion
    // below passes vacuously.
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(typeof report.orderedUnreachable).toBe("number");
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN}`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("spec-write/SKILL.md adds ZERO STE tokens — the file total is unmoved", () => {
    const count = steTokenCount(read(SPEC_WRITE_SKILL));
    expect(count).toBeLessThanOrEqual(55);
    expect(
      count,
      "the tree total is pinned with `.toBe(245)` by FOUR suites (m121-ste-457, " +
        "m121-ste-461, m125-ste-469, m126-ste-481) — one new token reds all four",
    ).toBe(54);
  });

  test("the skills/**/*.md STE-token total is unmoved at 245", () => {
    const skillsRoot = join(pluginRoot, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(skillsRoot)) {
      files += 1;
      total += steTokenCount(read(join(skillsRoot, rel)));
    }
    expect(files).toBeGreaterThan(20); // the walk is non-vacuous
    expect(total).toBeLessThanOrEqual(246);
    expect(total).toBe(245);
  });
});

// ===========================================================================
// AC-STE-579.10 — the six step-4 prose tokens survive the in-place rewrite.
// ===========================================================================

describe("AC-STE-579.10 — the step-4 tokens the sibling suite grades survive", () => {
  const tokens: { name: string; re: RegExp }[] = [
    { name: "Provider.sync(spec)", re: /Provider\.sync\(spec\)/ },
    { name: "1s + 2s + 4s", re: /1\s*\+\s*2\s*\+\s*4\s*s|1s\s*\+\s*2s\s*\+\s*4s|1, 2, 4 seconds/ },
    { name: "three attempts", re: /three attempts|3 attempts/i },
    { name: "JQL", re: /JQL/ },
    { name: "Gateway-Timeout / network-error", re: /Gateway-Timeout|gateway timeout|network[- ]?error/i },
    { name: "single-shot / fast path", re: /single-shot|fast path/i },
  ];

  for (const t of tokens) {
    test(`step 4 still carries: ${t.name}`, () => {
      const step4 = extractStep4(read(SPEC_WRITE_SKILL));
      expect(
        step4,
        `dropping \`${t.name}\` while "improving" the prose reds ` +
          `tests/spec-write-jira-retry-idempotency.test.ts`,
      ).toMatch(t.re);
    });
  }

  test("the sibling suite that grades these tokens is still present and non-vacuous", () => {
    const sibling = read(JIRA_RETRY_TEST);
    expect(sibling.includes("function extractStep4")).toBe(true);
    expect(sibling.includes('const start = body.indexOf("\\n4. ");')).toBe(true);
    expect(/single-shot\|fast path/.test(sibling)).toBe(true);
  });

  test("step 4 is genuinely the slice under test — it ends before step 5", () => {
    const step4 = extractStep4(read(SPEC_WRITE_SKILL));
    expect(step4).not.toContain("Post-write self-checks");
    expect(step4.length).toBeGreaterThan(500);
  });
});

// ===========================================================================
// AC-STE-579.11 — the key is REGISTERED; every bare-literal pin moves 44 -> 45.
// ===========================================================================

const NEW_KEY = "tracker_idempotency_uncertain";

describe("AC-STE-579.11 — the registry takes the key, and every pin moves with it", () => {
  test("the canonical set carries the key", () => {
    expect([...CANONICAL_CAPABILITY_KEYS]).toContain(NEW_KEY);
  });

  test("the key-owner map routes it to spec-write", () => {
    expect((KEY_OWNER_SKILL as Record<string, string>)[NEW_KEY]).toBe("spec-write");
  });

  test("the set's length is 45", () => {
    expect(CANONICAL_CAPABILITY_KEYS.length).toBe(45);
  });

  test("the m84 TITLE literal moved 44 -> 45", () => {
    const m = /CANONICAL_CAPABILITY_KEYS length is exactly (\d+)/.exec(read(M84_TEST));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(CANONICAL_CAPABILITY_KEYS.length);
    expect(Number(m![1])).toBe(45);
  });

  test("the m84 ASSERTION literal moved 44 -> 45", () => {
    const m = /expect\(CANONICAL_CAPABILITY_KEYS\.length\)\.toBe\((\d+)\)/.exec(read(M84_TEST));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(45);
  });

  test("the m84 discovered-set literal moved 44 -> 45", () => {
    const m = /expect\(discovered\.size\)\.toBe\((\d+)\)/.exec(read(M84_TEST));
    expect(m).not.toBeNull();
    expect(
      Number(m![1]),
      "`discovered` scrapes `MUST emit \\`<key>\\`` out of spec-write SKILL.md — " +
        "registering the key without landing the directive reds this instead",
    ).toBe(45);
  });

  test("m84's Set A carries the key, so the out-of-Set-A guard does not fire", () => {
    expect(
      read(M84_TEST).includes(`"${NEW_KEY}"`),
      "EXPECTED_SET_A is asserted equal to the const in both directions; a key in " +
        "the const but not in Set A reds `does not contain any out-of-Set-A keys`",
    ).toBe(true);
  });

  test("no bare literal 44 survives on any of the three m84 pin shapes", () => {
    const m84 = read(M84_TEST);
    const shapes: [string, RegExp][] = [
      ["title", /CANONICAL_CAPABILITY_KEYS length is exactly 44/],
      ["assertion", /expect\(CANONICAL_CAPABILITY_KEYS\.length\)\.toBe\(44\)/],
      ["discovered.size", /expect\(discovered\.size\)\.toBe\(44\)/],
    ];
    expect(
      shapes.filter(([, re]) => re.test(m84)).map(([name]) => name),
      "a stale bare-literal 44 survives in m84 — the pin moves 44 -> 45 at EVERY site",
    ).toEqual([]);
  });

  test("the sibling suite that RE-PARSES those literals is still live", () => {
    const m126 = read(M126_TEST);
    expect(
      m126.includes("AC-STE-482.1"),
      "m126-ste-482 re-parses the m84 literals rather than importing them — it is the " +
        "site most easily missed when the pin moves",
    ).toBe(true);
    expect(m126.includes("CANONICAL_CAPABILITY_KEYS length is exactly (\\d+)")).toBe(true);
    expect(m126.includes("expect\\(discovered\\.size\\)\\.toBe\\((\\d+)\\)")).toBe(true);
  });
});

// ===========================================================================
// AC-STE-579.12 — the MUST-emit directive lands in place; EXACTLY ONE
//                 plain-language rendering exists.
// ===========================================================================

describe("AC-STE-579.12 — the directive lands, the rendering stays singular", () => {
  test("SKILL.md carries the literal MUST-emit directive for the key", () => {
    expect(read(SPEC_WRITE_SKILL).includes(`MUST emit \`${NEW_KEY}\``)).toBe(true);
  });

  test("the directive sits on line 109 — the in-place rewrite, not a new line", () => {
    const lines = read(SPEC_WRITE_SKILL).split("\n");
    expect(lines[108]).toContain(`MUST emit \`${NEW_KEY}\``);
    expect(lines.length).toBe(358);
  });

  test("the MUST-emit directive for this key appears EXACTLY once", () => {
    const body = read(SPEC_WRITE_SKILL);
    const hits = body.match(new RegExp(`MUST emit \`${NEW_KEY}\``, "g")) ?? [];
    expect(hits).toHaveLength(1);
  });

  test("exactly ONE plain-language rendering exists — the § 7 map row", () => {
    const map = specWriteStep7Map(read(SPEC_WRITE_SKILL));
    const rows = map.match(new RegExp(`^\\| \`${NEW_KEY}\` \\|`, "gm")) ?? [];
    expect(
      rows,
      "AC.13 requires the count asserted, not the presence — a second rendering added " +
        "'for clarity' is exactly what this pins out",
    ).toHaveLength(1);
  });

  test("the single rendering is the row already at SKILL.md:311", () => {
    const lines = read(SPEC_WRITE_SKILL).split("\n");
    expect(lines[310]).toMatch(new RegExp(`^\\| \`${NEW_KEY}\` \\|`));
    // No second row anywhere else in the file.
    const all = lines
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => new RegExp(`^\\| \`${NEW_KEY}\` \\|`).test(l))
      .map(([n]) => n);
    expect(all).toEqual([311]);
  });
});

// ===========================================================================
// AC-STE-579.13 — the bidirectional registry check, with a CONSTRUCTED failing
//                 case for EACH direction. Neither is asserted by the other's
//                 fixture.
// ===========================================================================

function fixtureProject(specWriteBody: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ste-579-registry-"));
  const dir = join(root, ".claude", "skills", "spec-write");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), specWriteBody, "utf-8");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A body carrying a MUST-emit directive for every canonical key. */
function fullDirectiveBody(omit?: string, extra?: string): string {
  const lines = ["# fixture spec-write", ""];
  for (const key of CANONICAL_CAPABILITY_KEYS) {
    if (key === omit) continue;
    lines.push(`- MUST emit \`${key}\` (fixture).`);
  }
  if (extra) lines.push(`- MUST emit \`${extra}\` (fixture).`);
  return lines.join("\n") + "\n";
}

describe("AC-STE-579.13 — the registry invariant holds in BOTH directions", () => {
  test("the landed tree is green in both directions", async () => {
    const report = await runClosingSummaryCapabilityKeysProbe(repoRoot);
    expect(
      report.violations.map((v) => v.note),
      "the key and its directive must ship together — either half alone reds this",
    ).toEqual([]);
  });

  test("FORWARD failing case: a registered key with no directive is an error violation", async () => {
    const fx = fixtureProject(fullDirectiveBody(NEW_KEY));
    try {
      const report = await runClosingSummaryCapabilityKeysProbe(fx.root);
      expect(report.violations).toHaveLength(1);
      const v = report.violations[0]!;
      expect(v.missingKey).toBe(NEW_KEY);
      expect(v.severity).toBe("error");
      expect(v.reason).toContain("MUST-emit directive missing");
      // Not asserted by the reverse fixture: this direction emits NO orphan row.
      expect(report.violations.some((x) => x.reason.includes("orphan"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("REVERSE failing case: an unregistered directive is an orphan violation", async () => {
    // Digit-free on purpose: the probe's reverse-leg regex is
    // /MUST emit\s*`([a-z_]+)`/g — a key carrying digits is INVISIBLE to it.
    const stray = "ste_unregistered_stray_key";
    expect([...CANONICAL_CAPABILITY_KEYS]).not.toContain(stray);
    const fx = fixtureProject(fullDirectiveBody(undefined, stray));
    try {
      const report = await runClosingSummaryCapabilityKeysProbe(fx.root);
      expect(report.violations).toHaveLength(1);
      const v = report.violations[0]!;
      expect(v.missingKey).toBe(stray);
      expect(v.severity).toBe("error");
      expect(v.reason).toContain("orphan MUST-emit directive");
      // Not asserted by the forward fixture: this direction emits NO missing row.
      expect(report.violations.some((x) => x.reason.includes("directive missing"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("the fixture generator is honest — a complete body produces no violations", async () => {
    const fx = fixtureProject(fullDirectiveBody());
    try {
      const report = await runClosingSummaryCapabilityKeysProbe(fx.root);
      expect(
        report.violations,
        "if the control fixture also violated, neither failing case above would be evidence",
      ).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
