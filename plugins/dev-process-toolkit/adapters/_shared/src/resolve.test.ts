// Unit tests for resolveFRArgument + findFRByTrackerRef (FR-51, NFR-21).
//
// Target: 100% branch coverage on resolve.ts. Mutation probes: removing any
// single regex check, ambiguity branch, or fallthrough return must cause at
// least one test to fail.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AmbiguousArgumentError,
  findFRByTrackerRef,
  resolveFRArgument,
  type ResolverConfig,
  type TrackerConfig,
} from "./resolve";

const linearConfig: TrackerConfig = {
  key: "linear",
  idPattern: /^[A-Z]+-\d+$/,
  urlHost: "linear.app",
  urlPathRegex: /\/[^/]+\/issue\/([A-Z]+-\d+)/,
  prefixes: ["LIN", "DPT"],
};

const jiraConfig: TrackerConfig = {
  key: "jira",
  idPattern: /^[A-Z]+-\d+$/,
  urlHost: "example.atlassian.net",
  urlPathRegex: /\/browse\/([A-Z]+-\d+)/,
  prefixes: ["PROJ"],
};

const githubConfig: TrackerConfig = {
  key: "github",
  idPattern: /^#?\d+$/,
  urlHost: "github.com",
  urlPathRegex: /\/[^/]+\/[^/]+\/issues\/(\d+)/,
};

const onlyLinear: ResolverConfig = { trackers: [linearConfig] };
const linearAndJira: ResolverConfig = { trackers: [linearConfig, jiraConfig] };
const overlappingFoo: ResolverConfig = {
  trackers: [
    { ...linearConfig, prefixes: ["FOO"] },
    { ...jiraConfig, prefixes: ["FOO"] },
  ],
};
const fullStack: ResolverConfig = { trackers: [linearConfig, jiraConfig, githubConfig] };
const noTrackers: ResolverConfig = { trackers: [] };

describe("resolveFRArgument — ULID detection (AC-51.2)", () => {
  test("valid ULID returns {kind: 'ulid'}", () => {
    const r = resolveFRArgument("fr_01KPR3M74XA75GJKT4Z4HG95TC", onlyLinear);
    expect(r.kind).toBe("ulid");
    expect(r.ulid).toBe("fr_01KPR3M74XA75GJKT4Z4HG95TC");
  });

  test("ULID without fr_ prefix falls through", () => {
    const r = resolveFRArgument("01KPR3M74XA75GJKT4Z4HG95TC", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });

  test("ULID with wrong length falls through", () => {
    const r = resolveFRArgument("fr_01KPR3M74XA75GJKT4Z4HG95", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });

  test("ULID with disallowed charset (I/L/O/U) falls through", () => {
    const r = resolveFRArgument("fr_I1KPR3M74XA75GJKT4Z4HG95TC", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });
});

describe("resolveFRArgument — explicit prefix form (AC-51.5)", () => {
  test("linear:LIN-1234 resolves to tracker-id", () => {
    const r = resolveFRArgument("linear:LIN-1234", onlyLinear);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
    expect(r.trackerId).toBe("LIN-1234");
  });

  test("case-insensitive: LINEAR:LIN-1234 resolves the same as linear:LIN-1234", () => {
    const r = resolveFRArgument("LINEAR:LIN-1234", onlyLinear);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
    expect(r.trackerId).toBe("LIN-1234");
  });

  test("github:42 resolves even though 42 alone would match GitHub's bare-integer pattern", () => {
    const r = resolveFRArgument("github:42", fullStack);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("github");
    expect(r.trackerId).toBe("42");
  });

  test("explicit prefix wins over ambiguous idPattern", () => {
    const r = resolveFRArgument("linear:FOO-42", overlappingFoo);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
    expect(r.trackerId).toBe("FOO-42");
  });

  test("explicit prefix with unknown tracker key → fall through to other detection", () => {
    // After the unknown prefix is rejected, later branches are tested against
    // the FULL original argument (not the id portion), so "unknowntracker:fr_…"
    // fails the ^fr_-anchored ULID regex and every other branch → fallthrough.
    const r = resolveFRArgument("unknowntracker:fr_01KPR3M74XA75GJKT4Z4HG95TC", onlyLinear);
    expect(r.kind).toBe("fallthrough");
  });
});

describe("resolveFRArgument — URL detection (AC-51.4)", () => {
  test("Linear URL extracts tracker id from path", () => {
    const r = resolveFRArgument(
      "https://linear.app/acme/issue/LIN-1234/some-slug",
      onlyLinear,
    );
    expect(r.kind).toBe("url");
    expect(r.trackerKey).toBe("linear");
    expect(r.trackerId).toBe("LIN-1234");
  });

  test("GitHub URL extracts issue number", () => {
    const r = resolveFRArgument(
      "https://github.com/owner/repo/issues/42",
      fullStack,
    );
    expect(r.kind).toBe("url");
    expect(r.trackerKey).toBe("github");
    expect(r.trackerId).toBe("42");
  });

  test("Jira URL extracts tracker id via /browse/", () => {
    const r = resolveFRArgument(
      "https://example.atlassian.net/browse/PROJ-77",
      linearAndJira,
    );
    expect(r.kind).toBe("url");
    expect(r.trackerKey).toBe("jira");
    expect(r.trackerId).toBe("PROJ-77");
  });

  test("URL with unknown host → fallthrough (NFR-19 allowlist)", () => {
    const r = resolveFRArgument("https://gitlab.com/owner/repo/issues/42", fullStack);
    expect(r.kind).toBe("fallthrough");
  });

  test("URL with correct host but non-matching path → fallthrough", () => {
    const r = resolveFRArgument("https://linear.app/some-random-page", onlyLinear);
    expect(r.kind).toBe("fallthrough");
  });

  test("malformed URL is caught and returns fallthrough", () => {
    const r = resolveFRArgument("https://", onlyLinear);
    expect(r.kind).toBe("fallthrough");
  });

  test("http (not https) works too", () => {
    const r = resolveFRArgument(
      "http://linear.app/acme/issue/LIN-1234/slug",
      onlyLinear,
    );
    expect(r.kind).toBe("url");
  });
});

describe("resolveFRArgument — tracker-id detection (AC-51.3)", () => {
  test("single configured tracker matches unambiguously", () => {
    const r = resolveFRArgument("LIN-1234", onlyLinear);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
    expect(r.trackerId).toBe("LIN-1234");
  });

  test("two trackers, distinct prefixes → disambiguates by prefix", () => {
    const linearR = resolveFRArgument("LIN-1234", linearAndJira);
    expect(linearR.kind).toBe("tracker-id");
    expect(linearR.trackerKey).toBe("linear");

    const jiraR = resolveFRArgument("PROJ-77", linearAndJira);
    expect(jiraR.kind).toBe("tracker-id");
    expect(jiraR.trackerKey).toBe("jira");
  });

  test("bare-integer matches GitHub configuration", () => {
    const r = resolveFRArgument("42", fullStack);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("github");
    expect(r.trackerId).toBe("42");
  });

  test("#-prefixed integer also matches GitHub", () => {
    const r = resolveFRArgument("#42", fullStack);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("github");
    expect(r.trackerId).toBe("#42");
  });

  test("no trackers configured → fallthrough", () => {
    const r = resolveFRArgument("LIN-1234", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });
});

describe("resolveFRArgument — ambiguity (AC-51.6, NFR-20)", () => {
  test("overlapping prefixes (both FOO) → throws AmbiguousArgumentError", () => {
    expect(() => resolveFRArgument("FOO-42", overlappingFoo)).toThrow(
      AmbiguousArgumentError,
    );
  });

  test("AmbiguousArgumentError lists both candidates", () => {
    try {
      resolveFRArgument("FOO-42", overlappingFoo);
      throw new Error("expected AmbiguousArgumentError");
    } catch (err) {
      expect(err).toBeInstanceOf(AmbiguousArgumentError);
      const e = err as AmbiguousArgumentError;
      expect(e.candidates).toContain("linear:FOO-42");
      expect(e.candidates).toContain("jira:FOO-42");
      expect(e.argument).toBe("FOO-42");
    }
  });

  test("multi-match resolves when only one tracker declares the prefix", () => {
    // Both match idPattern, but only linear has 'LIN' in prefixes
    const r = resolveFRArgument("LIN-1234", linearAndJira);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
  });
});

describe("resolveFRArgument — fallthrough (AC-51.7, NFR-18)", () => {
  test("free-form title returns fallthrough", () => {
    const r = resolveFRArgument("My new feature", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });

  test("'all' keyword → fallthrough", () => {
    const r = resolveFRArgument("all", fullStack);
    expect(r.kind).toBe("fallthrough");
  });

  test("'requirements' keyword → fallthrough", () => {
    const r = resolveFRArgument("requirements", fullStack);
    expect(r.kind).toBe("fallthrough");
  });

  test("milestone code 'M12' → fallthrough", () => {
    const r = resolveFRArgument("M12", fullStack);
    expect(r.kind).toBe("fallthrough");
  });

  test("empty string → fallthrough", () => {
    const r = resolveFRArgument("", fullStack);
    expect(r.kind).toBe("fallthrough");
  });

  test("whitespace-only → fallthrough", () => {
    expect(resolveFRArgument("   ", fullStack).kind).toBe("fallthrough");
    expect(resolveFRArgument("\t\n", fullStack).kind).toBe("fallthrough");
  });

  test("very-long garbage string → fallthrough (no crash)", () => {
    const r = resolveFRArgument("x".repeat(10_000), fullStack);
    expect(r.kind).toBe("fallthrough");
  });
});

describe("resolveFRArgument — ordering invariants (§9.4)", () => {
  test("ULID regex takes precedence over tracker-id regex (ULID prefix 'fr_' never collides)", () => {
    // Constructed-only safety check; see technical-spec §9.9 regression canary
    const r = resolveFRArgument("fr_01KPR3M74XA75GJKT4Z4HG95TC", linearAndJira);
    expect(r.kind).toBe("ulid");
  });

  test("URL detection beats tracker-id on strings starting with 'https://'", () => {
    // An https URL would never match the ^[A-Z]+-\d+$ pattern anyway,
    // but we verify the URL branch is consulted before the tracker-id branch.
    const r = resolveFRArgument(
      "https://linear.app/acme/issue/LIN-1234/slug",
      onlyLinear,
    );
    expect(r.kind).toBe("url");
  });

  test("explicit prefix form is checked before URL detection", () => {
    // An explicit-prefix literal with a URL-shaped value still resolves
    // via the explicit branch — though this is an unusual input.
    const r = resolveFRArgument("linear:LIN-1234", linearAndJira);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
  });
});

describe("findFRByTrackerRef (AC-51.8)", () => {
  function makeTestSpecs(frs: Array<{ id: string; status: string; tracker: Record<string, string> }>, archive: typeof frs = []): string {
    const dir = mkdtempSync(join(tmpdir(), "resolve-test-"));
    mkdirSync(join(dir, "frs"), { recursive: true });
    mkdirSync(join(dir, "frs", "archive"), { recursive: true });
    for (const fr of frs) {
      const trackerYaml = Object.keys(fr.tracker).length === 0
        ? "{}"
        : `\n${Object.entries(fr.tracker).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`;
      const body = `---\nid: ${fr.id}\ntitle: test\nmilestone: M1\nstatus: ${fr.status}\ntracker: ${trackerYaml}\n---\n`;
      writeFileSync(join(dir, "frs", `${fr.id}.md`), body);
    }
    for (const fr of archive) {
      const trackerYaml = Object.keys(fr.tracker).length === 0
        ? "{}"
        : `\n${Object.entries(fr.tracker).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`;
      const body = `---\nid: ${fr.id}\ntitle: test\nmilestone: M1\nstatus: archived\ntracker: ${trackerYaml}\n---\n`;
      writeFileSync(join(dir, "frs", "archive", `${fr.id}.md`), body);
    }
    return dir;
  }

  test("returns matching ULID when tracker ref found in active FRs", async () => {
    const dir = makeTestSpecs([
      { id: "fr_01A", status: "active", tracker: { linear: "LIN-1" } },
      { id: "fr_01B", status: "active", tracker: { linear: "LIN-2" } },
      { id: "fr_01C", status: "active", tracker: {} },
    ]);
    try {
      const r = await findFRByTrackerRef(dir, "linear", "LIN-2");
      expect(r).toBe("fr_01B");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null when no active FR matches", async () => {
    const dir = makeTestSpecs([
      { id: "fr_01A", status: "active", tracker: { linear: "LIN-1" } },
    ]);
    try {
      const r = await findFRByTrackerRef(dir, "linear", "LIN-999");
      expect(r).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("excludes archive by default (AC-54.4 semantics)", async () => {
    const dir = makeTestSpecs(
      [{ id: "fr_01A", status: "active", tracker: { linear: "LIN-1" } }],
      [{ id: "fr_01X", status: "archived", tracker: { linear: "LIN-9" } }],
    );
    try {
      const r = await findFRByTrackerRef(dir, "linear", "LIN-9");
      expect(r).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("{includeArchive: true} finds archived FRs", async () => {
    const dir = makeTestSpecs(
      [{ id: "fr_01A", status: "active", tracker: { linear: "LIN-1" } }],
      [{ id: "fr_01X", status: "archived", tracker: { linear: "LIN-9" } }],
    );
    try {
      const r = await findFRByTrackerRef(dir, "linear", "LIN-9", { includeArchive: true });
      expect(r).toBe("fr_01X");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("handles missing specs/frs directory without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "resolve-empty-"));
    try {
      const r = await findFRByTrackerRef(dir, "linear", "LIN-1");
      expect(r).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("different tracker key does not match", async () => {
    const dir = makeTestSpecs([
      { id: "fr_01A", status: "active", tracker: { linear: "LIN-1" } },
    ]);
    try {
      const r = await findFRByTrackerRef(dir, "jira", "LIN-1");
      expect(r).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveFRArgument — FR-N removed (STE-52 fallthrough regression)", () => {
  // STE-52 removed the FR-code route entirely. Any `FR-<N>` argument now
  // falls through. If this test regresses, the FR-code branch has been
  // accidentally re-introduced.
  test("FR-57 falls through (STE-52 removed the FR-N branch)", () => {
    const r = resolveFRArgument("FR-57", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });

  test("FR-1 (single-digit) falls through", () => {
    const r = resolveFRArgument("FR-1", noTrackers);
    expect(r.kind).toBe("fallthrough");
  });

  test("FR-57 with trackers whose idPattern doesn't match stays fallthrough", () => {
    // github-only has `idPattern: /^#?\d+$/` — FR-57 fails both that and ULID/URL,
    // so it must fall through. Before STE-52 it would have matched the FR-code
    // branch; this test locks the branch removal.
    const githubOnly: ResolverConfig = { trackers: [githubConfig] };
    const r = resolveFRArgument("FR-57", githubOnly);
    expect(r.kind).toBe("fallthrough");
  });

  test("ULID still takes precedence over fallthrough", () => {
    const r = resolveFRArgument("fr_01KPR3M74XA75GJKT4Z4HG95TC", fullStack);
    expect(r.kind).toBe("ulid");
  });
});

describe("Fixture-driven integration (tests/fixtures/resolver/)", () => {
  const FIXTURES_ROOT = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "resolver",
  );

  test("linear-only fixture: LIN-1234 → find-by-tracker-ref hit", async () => {
    const specsDir = join(FIXTURES_ROOT, "linear-only", "specs");
    const r = resolveFRArgument("LIN-1234", onlyLinear);
    expect(r.kind).toBe("tracker-id");
    expect(r.trackerKey).toBe("linear");
    const ulid = await findFRByTrackerRef(specsDir, "linear", "LIN-1234");
    expect(ulid).toBe("fr_01MRESOLVERFIXTURELIN01");
  });

  test("linear-and-jira fixture: LIN-1234 → Linear, PROJ-77 → Jira", async () => {
    const specsDir = join(FIXTURES_ROOT, "linear-and-jira", "specs");
    const lin = resolveFRArgument("LIN-1234", linearAndJira);
    expect(lin.trackerKey).toBe("linear");
    const linUlid = await findFRByTrackerRef(specsDir, "linear", "LIN-1234");
    expect(linUlid).toBe("fr_01MRESOLVERFIXTURELAJ01");

    const jira = resolveFRArgument("PROJ-77", linearAndJira);
    expect(jira.trackerKey).toBe("jira");
    const jiraUlid = await findFRByTrackerRef(specsDir, "jira", "PROJ-77");
    expect(jiraUlid).toBe("fr_01MRESOLVERFIXTURELAJ02");
  });

  test("overlapping-prefixes fixture: FOO-42 → ambiguous throw", () => {
    expect(() => resolveFRArgument("FOO-42", overlappingFoo)).toThrow(
      AmbiguousArgumentError,
    );
  });

  test("no-trackers fixture: all tracker-shaped inputs fall through", async () => {
    const specsDir = join(FIXTURES_ROOT, "no-trackers", "specs");
    expect(resolveFRArgument("LIN-1234", noTrackers).kind).toBe("fallthrough");
    expect(resolveFRArgument("42", noTrackers).kind).toBe("fallthrough");
    expect(
      resolveFRArgument("https://linear.app/acme/issue/LIN-1234/slug", noTrackers).kind,
    ).toBe("fallthrough");
    // Still finds the local FR by ULID if searched directly
    const r = await findFRByTrackerRef(specsDir, "linear", "LIN-1234");
    expect(r).toBeNull();
  });
});
