// STE-684 (M_0cac80) — the `--bug` tracker-type check runs before a new
// milestone Epic exists, so the Jira Epic key is optional.
//
// CONTRACT this suite reads (the implementer satisfies it):
//
//   adapters/_shared/src/bug_tracker_type.ts
//     checkBugTrackerType({ mode: "jira", issueType, listing })          — no epicKey
//       runs every Jira check (absent type, subtask / hierarchyLevel != 0, good type);
//       the parent refusal names "the new milestone Epic" and its Context line
//       carries `epic=(new)`.
//     checkBugTrackerType({ mode: "jira", issueType, epicKey, listing }) — with a key
//       every output is byte-identical to the pre-fix messages (pinned below as literals).
//     Front door: `jira <listing.json> <issueType> [<epicKey>]`.
//
//   skills/spec-write/SKILL.md + docs/resolver-entry.md
//     the `--bug` check runs before the milestone Epic mint on a new-milestone run,
//     and passes the Epic key only when the milestone already exists.
//
// AC-STE-684.5 (mutation) and AC-STE-684.6 (full gate) are graded by the
// orchestrator; the front-door and in-process no-key tests here are the ones a
// "key required again" mutation reddens.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBugTrackerType } from "../adapters/_shared/src/bug_tracker_type";

// Spawns `bun run <module>`; the 5 s default kills a child under full-gate load.
setDefaultTimeout(60_000);

const pluginRoot = join(import.meta.dir, "..");
const MODULE = join(pluginRoot, "adapters", "_shared", "src", "bug_tracker_type.ts");
const SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const RESOLVER_ENTRY = join(pluginRoot, "docs", "resolver-entry.md");
const SKILL_LINE_CAP = 358;

const read = (p: string) => readFileSync(p, "utf-8");

const EPIC = "GK-40";

const jiraType = (name: string, hierarchyLevel: number, subtask = false) => ({
  id: `id-${name}`,
  name,
  untranslatedName: name,
  subtask,
  hierarchyLevel,
});

const JIRA_TYPES = {
  startAt: 0,
  maxResults: 50,
  total: 5,
  issueTypes: [
    jiraType("Task", 0),
    jiraType("Bug", 0),
    jiraType("Epic", 1),
    jiraType("Subtask", -1, true),
    // Not flagged a subtask, but off level 0: still cannot sit under an Epic.
    jiraType("Story Group", 2),
  ],
};

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw, it returned");
}

const contextOf = (message: string) => message.split("\n").find((l) => l.startsWith("Context: ")) ?? "";

/** NFR-10 canonical shape: a verdict line, then `Remedy:` and `Context:` lines. */
function expectNfr10(message: string): void {
  const lines = message.split("\n");
  expect(lines.length).toBe(3);
  expect(lines[0]!.trim().length).toBeGreaterThan(0);
  expect(lines[1]!.startsWith("Remedy: ")).toBe(true);
  expect(lines[2]!.startsWith("Context: ")).toBe(true);
}

// ---------------------------------------------------------------------------
// With-key literals: today's exact messages (AC-STE-684.2 byte-identity).
// ---------------------------------------------------------------------------

const WITH_KEY_ABSENT = [
  `bug type refused: Jira issue type "Defect" is not available in this project`,
  `Remedy: set jira_bug_issue_type in CLAUDE.md to one of: Task, Bug, Epic, Subtask, Story Group`,
  `Context: mode=jira, jira_bug_issue_type=Defect, epic=GK-40, skill=/spec-write`,
].join("\n");

const WITH_KEY_SUBTASK = [
  `bug type refused: Jira issue type "Subtask" cannot take the milestone Epic GK-40 as parent`,
  `Remedy: set jira_bug_issue_type in CLAUDE.md to a standard issue type that sits under an Epic`,
  `Context: mode=jira, jira_bug_issue_type=Subtask, epic=GK-40, hierarchyLevel=-1, subtask=true, skill=/spec-write`,
].join("\n");

const WITH_KEY_LEVEL = [
  `bug type refused: Jira issue type "Story Group" cannot take the milestone Epic GK-40 as parent`,
  `Remedy: set jira_bug_issue_type in CLAUDE.md to a standard issue type that sits under an Epic`,
  `Context: mode=jira, jira_bug_issue_type=Story Group, epic=GK-40, hierarchyLevel=2, subtask=false, skill=/spec-write`,
].join("\n");

// ---------------------------------------------------------------------------
// Front door harness
// ---------------------------------------------------------------------------

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

let dir = "";
let listingPath = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ste684-"));
  listingPath = join(dir, "issue-types.json");
  writeFileSync(listingPath, JSON.stringify(JIRA_TYPES));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function runFrontDoor(args: string[]): Run {
  const p = Bun.spawnSync(["bun", "run", MODULE, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 50_000,
  });
  const signal = p.signalCode ?? null;
  return {
    code: p.exitCode ?? -1,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString() + (signal ? `\n[killed by ${signal}]` : ""),
  };
}

// ===========================================================================
// AC-STE-684.1 — the regression
// ===========================================================================

describe("AC-STE-684.1 — regression", () => {
  test("the jira front door grades a type with no epic key", () => {
    const r = runFrontDoor(["jira", listingPath, "Bug"]);
    expect(r.stderr).not.toContain("usage:");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Bug\n");
  });
});

// ===========================================================================
// AC-STE-684.2 — in-process, with and without a key
// ===========================================================================

describe("AC-STE-684.2 — checkBugTrackerType with no epicKey runs every Jira check", () => {
  test("a good type passes and returns its name", () => {
    expect(checkBugTrackerType({ mode: "jira", issueType: "Bug", listing: JIRA_TYPES })).toBe("Bug");
  });

  test("an absent type refuses (NFR-10) naming jira_bug_issue_type, with no stray epic value", () => {
    const e = thrown(() => checkBugTrackerType({ mode: "jira", issueType: "Defect", listing: JIRA_TYPES }));
    expectNfr10(e.message);
    expect(e.message.split("\n")[0]).toBe(
      `bug type refused: Jira issue type "Defect" is not available in this project`,
    );
    expect(e.message).toContain("jira_bug_issue_type");
    const ctx = contextOf(e.message);
    expect(ctx).not.toContain("epic=,");
    expect(ctx).not.toContain("epic=undefined");
    expect(ctx).not.toContain("epic=null");
  });

  test("a subtask type refuses naming the new milestone Epic, Context carries epic=(new)", () => {
    const e = thrown(() => checkBugTrackerType({ mode: "jira", issueType: "Subtask", listing: JIRA_TYPES }));
    expectNfr10(e.message);
    expect(e.message.split("\n")[0]).toContain(`"Subtask"`);
    expect(e.message.split("\n")[0]).toContain("the new milestone Epic");
    const ctx = contextOf(e.message);
    expect(ctx).toContain("epic=(new)");
    expect(ctx).toContain("hierarchyLevel=-1");
    expect(ctx).toContain("subtask=true");
  });

  test("a type off hierarchy level 0 (not flagged subtask) refuses naming the new milestone Epic", () => {
    for (const t of ["Story Group", "Epic"]) {
      const e = thrown(() => checkBugTrackerType({ mode: "jira", issueType: t, listing: JIRA_TYPES }));
      expectNfr10(e.message);
      expect(e.message.split("\n")[0]).toContain(`"${t}"`);
      expect(e.message.split("\n")[0]).toContain("the new milestone Epic");
      expect(contextOf(e.message)).toContain("epic=(new)");
      expect(contextOf(e.message)).toContain("subtask=false");
    }
  });

  test("an empty-string epicKey is treated as no key, never as `epic=`", () => {
    const e = thrown(() =>
      checkBugTrackerType({ mode: "jira", issueType: "Subtask", epicKey: "", listing: JIRA_TYPES }),
    );
    expect(e.message).toContain("the new milestone Epic");
    expect(contextOf(e.message)).toContain("epic=(new)");
  });
});

describe("AC-STE-684.2 — with a key, every output is byte-identical to today", () => {
  test("a good type returns its name", () => {
    expect(checkBugTrackerType({ mode: "jira", issueType: "Bug", epicKey: EPIC, listing: JIRA_TYPES })).toBe("Bug");
  });

  test("absent type: exact message", () => {
    const e = thrown(() =>
      checkBugTrackerType({ mode: "jira", issueType: "Defect", epicKey: EPIC, listing: JIRA_TYPES }),
    );
    expect(e.message).toBe(WITH_KEY_ABSENT);
  });

  test("subtask type: exact message", () => {
    const e = thrown(() =>
      checkBugTrackerType({ mode: "jira", issueType: "Subtask", epicKey: EPIC, listing: JIRA_TYPES }),
    );
    expect(e.message).toBe(WITH_KEY_SUBTASK);
  });

  test("hierarchyLevel != 0 type: exact message", () => {
    const e = thrown(() =>
      checkBugTrackerType({ mode: "jira", issueType: "Story Group", epicKey: EPIC, listing: JIRA_TYPES }),
    );
    expect(e.message).toBe(WITH_KEY_LEVEL);
  });
});

// ===========================================================================
// AC-STE-684.3 — front door: jira <listing.json> <issueType> [<epicKey>]
// ===========================================================================

describe("AC-STE-684.3 — the front door accepts an optional epicKey", () => {
  test("no key: an absent type exits 2 with the refusal, not the usage line", () => {
    const r = runFrontDoor(["jira", listingPath, "Defect"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toContain("usage:");
    expect(r.stderr).toContain(`Jira issue type "Defect" is not available in this project`);
  });

  test("no key: a subtask type exits 2 naming the new milestone Epic with epic=(new)", () => {
    const r = runFrontDoor(["jira", listingPath, "Subtask"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toContain("usage:");
    expect(r.stderr).toContain("the new milestone Epic");
    expect(r.stderr).toContain("epic=(new)");
  });

  test("no key: a hierarchyLevel != 0 type exits 2 naming the new milestone Epic", () => {
    const r = runFrontDoor(["jira", listingPath, "Story Group"]);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain("usage:");
    expect(r.stderr).toContain("the new milestone Epic");
    expect(r.stderr).toContain("hierarchyLevel=2");
  });

  test("with a key: a good type prints its name and exits 0", () => {
    const r = runFrontDoor(["jira", listingPath, "Bug", EPIC]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Bug\n");
  });

  test("with a key: refusals are byte-identical to today", () => {
    const cases: Array<[string, string]> = [
      ["Defect", WITH_KEY_ABSENT],
      ["Subtask", WITH_KEY_SUBTASK],
      ["Story Group", WITH_KEY_LEVEL],
    ];
    for (const [type, expected] of cases) {
      const r = runFrontDoor(["jira", listingPath, type, EPIC]);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`${expected}\n`);
    }
  });

  test("the usage line shows the epicKey as optional", () => {
    const r = runFrontDoor([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("jira <listing.json> <issueType> [<epicKey>]");
  });

  test("a jira call still needs an issueType", () => {
    const r = runFrontDoor(["jira", listingPath]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage:");
  });
});

// ===========================================================================
// AC-STE-684.4 — skill + resolver-entry ordering, line cap
// ===========================================================================

/** The sentence-bearing line that runs the check (the one naming bug_tracker_type.ts). */
function checkLine(text: string): string {
  const line = text.split("\n").find((l) => l.includes("bug_tracker_type.ts")) ?? "";
  expect(line).not.toBe("");
  return line;
}

function expectOrderedBeforeEpicMint(line: string): void {
  // The check is ordered before the milestone Epic mint …
  expect(line).toMatch(/before[^.]*milestone Epic[^.]*(?:mint|created|creat)/i);
  // … and the key is passed only when the milestone already exists.
  expect(line).toMatch(/only when the milestone already exists/i);
  // The invocation shows the key as optional.
  expect(line).toContain("[<epicKey>]");
  expect(line).not.toMatch(/<issueType> <epicKey>/);
}

describe("AC-STE-684.4 — the docs order the check before the Epic mint", () => {
  test("skills/spec-write/SKILL.md orders the --bug check before the milestone Epic mint", () => {
    expectOrderedBeforeEpicMint(checkLine(read(SKILL)));
  });

  test("docs/resolver-entry.md orders the --bug check before the milestone Epic mint", () => {
    expectOrderedBeforeEpicMint(checkLine(read(RESOLVER_ENTRY)));
  });

  test(`skills/spec-write/SKILL.md stays within its ${SKILL_LINE_CAP}-line cap`, () => {
    expect(read(SKILL).split("\n").length).toBeLessThanOrEqual(SKILL_LINE_CAP);
  });
});
