// STE-679 (M_7384cf) — `/spec-write --bug` files a bug as a bug.
//
// CONTRACT this suite reads (the implementer satisfies it):
//
//   adapters/_shared/src/fr_frontmatter.ts
//     buildFRFrontmatter(spec, binding?, { ..., kind?: "bug" })
//       - `kind: "bug"`  → a `kind: bug` line right after `changelog_category:`
//       - no `kind`      → no line (byte-identical to today)
//       - anything else  → throws, message in NFR-10 shape (verdict / Remedy: / Context:)
//
//   adapters/_shared/src/workspace_binding.ts
//     readWorkspaceBinding(...)  → `jiraBugIssueType` from `### Jira`.jira_bug_issue_type,
//                                  `linearBugLabel`   from `### Linear`.linear_bug_label
//     resolveBugTrackerType(mode, binding) → override | "Bug" | null (mode none)
//
//   adapters/_shared/src/bug_tracker_type.ts
//     checkBugTrackerType(input) — PURE check over a saved tracker listing:
//       { mode: "jira",   issueType, epicKey, listing: <getJiraProjectIssueTypesMetadata answer> }
//       { mode: "linear", label,              listing: <list_issue_labels answer> }
//     returns the name to file under; throws (NFR-10 shape) when the Jira type
//     is absent (naming `jira_bug_issue_type`), cannot take the Epic as parent
//     (naming the type and the Epic), or the Linear label is absent / retired
//     (naming `linear_bug_label`).
//
//   adapters/_shared/src/create_idempotency_probe.ts decide … --bug
//     Jira:   createPayload.issueType = <resolved>
//     Linear: createPayload.labels gains <resolved> (never twice)
//     without --bug: payload byte-identical to today.
//
// AC-STE-679.9 is the orchestrator's full-gate run; no test here shells the suite.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFRFrontmatter } from "../adapters/_shared/src/fr_frontmatter";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import { branchTypeFor } from "../adapters/_shared/src/branch_type_for";
import * as workspaceBinding from "../adapters/_shared/src/workspace_binding";
import { claudeMd, pluginManifest } from "./_span_fixture";

// Spawns `bun run <module>`; the 5 s default kills a child under full-gate load.
setDefaultTimeout(60_000);

const pluginRoot = join(import.meta.dir, "..");
const SRC = join(pluginRoot, "adapters", "_shared", "src");
const MODULE = join(SRC, "create_idempotency_probe.ts");
const SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const JIRA_ADAPTER = join(pluginRoot, "adapters", "jira.md");
const LINEAR_ADAPTER = join(pluginRoot, "adapters", "linear.md");

const read = (p: string) => readFileSync(p, "utf-8");

/** NFR-10 canonical shape: a verdict line, then `Remedy:` and `Context:` lines. */
function expectNfr10(message: string): void {
  const lines = message.split("\n");
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines[0]!.trim().length).toBeGreaterThan(0);
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw, it returned");
}

const SPEC = { title: "Login button does nothing", milestone: "M_7384cf", createdAt: "2026-10-20T14:11:23Z" };
const BINDING = { key: "linear", id: "STE-999" };

// ===========================================================================
// AC-STE-679.1 — the frontmatter builder and reader
// ===========================================================================

describe("AC-STE-679.1 — buildFRFrontmatter emits kind: bug", () => {
  test("kind: bug lands on the line right after changelog_category:", () => {
    const fm = buildFRFrontmatter(SPEC, BINDING, { changelogCategory: "Fixed", kind: "bug" } as any);
    const lines = fm.split("\n");
    const cat = lines.indexOf("changelog_category: Fixed");
    expect(cat).toBeGreaterThan(0);
    expect(lines[cat + 1]).toBe("kind: bug");
    expect(lines[cat + 2]).toBe("---");
  });

  test("no kind option ⇒ no kind line, byte-identical to the call without the key", () => {
    const without = buildFRFrontmatter(SPEC, BINDING, { changelogCategory: "Added" });
    const undef = buildFRFrontmatter(SPEC, BINDING, { changelogCategory: "Added", kind: undefined } as any);
    expect(without).not.toMatch(/^kind:/m);
    expect(undef).toBe(without);
  });

  for (const bad of ["feature", "Bug", "BUG", "", "defect"]) {
    test(`kind: ${JSON.stringify(bad)} throws in the NFR-10 canonical shape`, () => {
      const e = thrown(() => buildFRFrontmatter(SPEC, BINDING, { changelogCategory: "Fixed", kind: bad } as any));
      expectNfr10(e.message);
      expect(e.message).toContain("kind");
    });
  }

  test("the frontmatter reader returns kind: \"bug\" for the emitted file", () => {
    const fm = buildFRFrontmatter(SPEC, BINDING, { changelogCategory: "Fixed", kind: "bug" } as any);
    const parsed = parseFrontmatter(`${fm}\n# Login button does nothing\n`);
    expect(parsed.kind).toBe("bug");
    expect(parsed.changelog_category).toBe("Fixed");
  });

  test("key order: tracker → needs_technical_review → created_at → changelog_category → kind", () => {
    const fm = buildFRFrontmatter(SPEC, BINDING, {
      needsTechnicalReview: true,
      changelogCategory: "Fixed",
      kind: "bug",
    } as any);
    const keys = fm
      .split("\n")
      .map((l) => /^([a-z_]+):/.exec(l)?.[1])
      .filter((k): k is string => k !== undefined);
    const order = ["tracker", "needs_technical_review", "created_at", "changelog_category", "kind"].map((k) =>
      keys.indexOf(k),
    );
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(keys[keys.length - 1]).toBe("kind");
  });
});

// ===========================================================================
// Skill-text corpus: SKILL.md plus every docs/ or templates/ file it names.
// SKILL.md sits near its line cap, so the prose may live in a referenced doc.
// ===========================================================================

function skillCorpus(): string {
  const skill = read(SKILL);
  const refs = new Set(skill.match(/(?:docs|templates)\/[A-Za-z0-9_./-]+\.md/g) ?? []);
  const parts = [skill];
  for (const r of refs) {
    const p = join(pluginRoot, r);
    if (existsSync(p)) parts.push(read(p));
  }
  return parts.join("\n\n");
}

/** The paragraphs (blank-line separated blocks, or table rows/bullets) that mention `--bug`. */
function bugParagraphs(): string[] {
  return skillCorpus()
    .split(/\n\s*\n/)
    .filter((p) => p.includes("--bug"));
}

describe("AC-STE-679.2 — /spec-write --bug: parsing, kind, category default and draft gate", () => {
  test("--bug is documented as parsed in the resolver-entry preamble, without changing resolver routing", () => {
    const paras = bugParagraphs();
    expect(paras.length).toBeGreaterThan(0);
    const parsedThere = paras.some(
      (p) => /resolver-entry preamble/i.test(p) && /does not (?:affect|change)[^.]*resolver[^.]*routing/i.test(p),
    );
    expect(parsedThere).toBe(true);
  });

  test("--bug sets kind: bug and defaults changelog_category to Fixed", () => {
    const text = bugParagraphs().join("\n");
    expect(text).toContain("kind: bug");
    expect(text).toMatch(/changelog_category/);
    expect(text).toMatch(/default[^.\n]*`?Fixed`?/i);
  });

  test("Security is accepted as an override; any other category is refused at the draft gate", () => {
    // Pins the rule sentence itself: Security / refus / draft gate each appear
    // elsewhere in these paragraphs, so word-level checks would survive its deletion.
    const text = bugParagraphs().join("\n");
    expect(text).toMatch(
      /`Security` is accepted as an override; any other category on a `--bug` run is refused at the draft gate/,
    );
  });

  test("the draft-gate preview shows both kind and changelog_category", () => {
    const preview = bugParagraphs().filter((p) => /preview/i.test(p));
    expect(preview.length).toBeGreaterThan(0);
    const joined = preview.join("\n");
    expect(joined).toMatch(/kind/);
    expect(joined).toMatch(/changelog_category/);
  });
});

describe("AC-STE-679.3 — a bug FR's body shape", () => {
  test("the bug body names Steps to reproduce, Expected, Actual under Requirement and Root cause under Technical Design", () => {
    const corpus = skillCorpus();
    for (const h of ["### Steps to reproduce", "### Expected", "### Actual", "### Root cause"]) {
      expect(corpus).toContain(h);
    }
    // Ordering inside the documented bug body: the three observable headings
    // sit after `## Requirement` and before `## Technical Design`; Root cause after it.
    const start = corpus.indexOf("### Steps to reproduce");
    const block = corpus.slice(corpus.lastIndexOf("## Requirement", start));
    const req = block.indexOf("## Requirement");
    const steps = block.indexOf("### Steps to reproduce");
    const expected = block.indexOf("### Expected");
    const actual = block.indexOf("### Actual");
    const td = block.indexOf("## Technical Design");
    const root = block.indexOf("### Root cause");
    expect(req).toBe(0);
    expect(steps).toBeGreaterThan(req);
    expect(expected).toBeGreaterThan(steps);
    expect(actual).toBeGreaterThan(expected);
    expect(td).toBeGreaterThan(actual);
    expect(root).toBeGreaterThan(td);
  });

  test("a bug FR carries a Regression: AC naming a test that fails before the fix", () => {
    const corpus = skillCorpus();
    expect(corpus).toMatch(/`?Regression:`?/);
    const paras = corpus.split(/\n\s*\n/).filter((p) => p.includes("Regression:"));
    expect(paras.some((p) => /fails? before the fix/i.test(p))).toBe(true);
  });
});

describe("AC-STE-679.4 — --bug --no-tech is QA-friendly; branchTypeFor unchanged", () => {
  test("the --bug --no-tech interview fills the observable sections; technical sections take the placeholder", () => {
    const both = bugParagraphs().filter((p) => p.includes("--no-tech"));
    expect(both.length).toBeGreaterThan(0);
    const text = both.join("\n");
    for (const s of ["Steps to reproduce", "Expected", "Actual", "Regression:"]) expect(text).toContain(s);
    expect(text).toContain("Root cause");
    expect(text).toMatch(/## Technical Design/);
    expect(text).toMatch(/## Testing/);
    expect(text).toMatch(/needs technical review|needs-technical-review|needs_technical_review/);
  });

  test("branchTypeFor: Fixed + noTech → chore; Fixed without noTech → fix", () => {
    expect(branchTypeFor({ changelogCategory: "Fixed", noTech: true })).toBe("chore");
    expect(branchTypeFor({ changelogCategory: "Fixed", noTech: false })).toBe("fix");
  });
});

// ===========================================================================
// AC-STE-679.5 — the binding keys and the resolver
// ===========================================================================

let scratch = "";
let manifestDir = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "dpt-ste679-"));
  manifestDir = mkdtempSync(join(tmpdir(), "dpt-ste679-manifest-"));
  pluginManifest(manifestDir, "2.87.0");
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(manifestDir, { recursive: true, force: true });
});

let rootSeq = 0;
function root(): string {
  rootSeq += 1;
  return mkdtempSync(join(scratch, `root-${rootSeq}-`));
}

type Resolve = (mode: "jira" | "linear" | "none", binding: Record<string, unknown>) => string | null;
const resolveBugTrackerType = (workspaceBinding as unknown as { resolveBugTrackerType?: Resolve })
  .resolveBugTrackerType;

describe("AC-STE-679.5 — readWorkspaceBinding + resolveBugTrackerType", () => {
  test("jira_bug_issue_type: is parsed from ### Jira", () => {
    const r = root();
    claudeMd(r, { mode: "jira", project: "GF", paragraph: "jira_bug_issue_type: Defect" });
    const b = workspaceBinding.readWorkspaceBinding(join(r, "CLAUDE.md"), "jira") as Record<string, unknown>;
    expect(b.jiraBugIssueType).toBe("Defect");
    expect(b.project).toBe("GF");
  });

  test("linear_bug_label: is parsed from ### Linear", () => {
    const r = root();
    claudeMd(r, { mode: "linear", team: "STE", project: "DPT", paragraph: "linear_bug_label: defect" });
    const b = workspaceBinding.readWorkspaceBinding(join(r, "CLAUDE.md"), "linear") as Record<string, unknown>;
    expect(b.linearBugLabel).toBe("defect");
  });

  test("an absent key leaves the binding field unset", () => {
    const r = root();
    claudeMd(r, { mode: "jira", project: "GF" });
    const b = workspaceBinding.readWorkspaceBinding(join(r, "CLAUDE.md"), "jira") as Record<string, unknown>;
    expect(b.jiraBugIssueType).toBeUndefined();
  });

  test("resolveBugTrackerType returns the override when set, Bug otherwise, null for mode none", () => {
    expect(typeof resolveBugTrackerType).toBe("function");
    const f = resolveBugTrackerType!;
    expect(f("jira", { shared: false, jiraBugIssueType: "Defect" })).toBe("Defect");
    expect(f("jira", { shared: false })).toBe("Bug");
    expect(f("jira", { shared: false, linearBugLabel: "defect" })).toBe("Bug");
    expect(f("linear", { shared: false, linearBugLabel: "defect" })).toBe("defect");
    expect(f("linear", { shared: false })).toBe("Bug");
    expect(f("linear", { shared: false, jiraBugIssueType: "Defect" })).toBe("Bug");
    expect(f("none", { shared: false, jiraBugIssueType: "Defect", linearBugLabel: "defect" })).toBeNull();
  });
});

// ===========================================================================
// AC-STE-679.6 — decide … --bug carries the bug type in the create payload
// ===========================================================================

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runModule(args: string[]): Run {
  const p = Bun.spawnSync(["bun", "run", MODULE, ...args], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: manifestDir, CLAUDE_CODE_SESSION_ID: `ste679-${process.pid}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const signal = p.signalCode ?? null;
  return {
    code: p.exitCode ?? -1,
    stdout: p.stdout.toString(),
    stderr: p.stderr.toString() + (signal ? `\n[killed by ${signal}]` : ""),
  };
}

function decisionOf(r: Run): Record<string, any> {
  const lines = r.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  if (lines.length !== 1) {
    throw new Error(`expected one JSON line; code=${r.code}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  }
  return JSON.parse(lines[0]!);
}

let pageSeq = 0;
function page(body: unknown): string {
  pageSeq += 1;
  const p = join(scratch, `page-${pageSeq}.json`);
  writeFileSync(p, JSON.stringify(body));
  return p;
}

const TITLE = "Login button does nothing";
const EPIC = "GF-40";
const LINEAR_MS = "ms-3fa85f64";
const JIRA_EMPTY = { issues: [], isLast: true };
const LINEAR_EMPTY = { issues: [], hasNextPage: false };

function decideJira(r: string, extra: string[]): Run {
  return runModule(["decide", r, page(JIRA_EMPTY), "--title", TITLE, "--parent", EPIC, "--attempt", "fast", ...extra]);
}

function decideLinear(r: string, extra: string[]): Run {
  return runModule([
    "decide",
    r,
    page(LINEAR_EMPTY),
    "--title",
    TITLE,
    "--linear-milestone",
    LINEAR_MS,
    "--attempt",
    "fast",
    ...extra,
  ]);
}

describe("AC-STE-679.6 — decide --bug puts the bug type in createPayload", () => {
  test("Jira --bug: issueType Bug in createPayload, labels untouched", () => {
    const r = root();
    claudeMd(r, { mode: "jira", project: "GF", defaultLabels: ["team-x"] });
    const d = decisionOf(decideJira(r, ["--bug"]));
    expect(d.outcome).toBe("create");
    expect(d.createPayload.issueType).toBe("Bug");
    expect(d.createPayload.labels).toEqual(["team-x"]);
    expect(d.createPayload.parent).toBe(EPIC);
  });

  test("Jira --bug honours the jira_bug_issue_type override", () => {
    const r = root();
    claudeMd(r, { mode: "jira", project: "GF", paragraph: "jira_bug_issue_type: Defect" });
    const d = decisionOf(decideJira(r, ["--bug"]));
    expect(d.createPayload.issueType).toBe("Defect");
  });

  test("Jira without --bug: payload byte-identical to today", () => {
    const r = root();
    claudeMd(r, { mode: "jira", project: "GF", defaultLabels: ["team-x"] });
    const d = decisionOf(decideJira(r, []));
    expect(JSON.stringify(d.createPayload)).toBe(
      JSON.stringify({ project: "GF", summary: TITLE, labels: ["team-x"], parent: EPIC }),
    );
  });

  test("Linear --bug: the Bug label is appended to labels", () => {
    const r = root();
    claudeMd(r, { mode: "linear", team: "STE", project: "DPT", defaultLabels: ["team-x"] });
    const d = decisionOf(decideLinear(r, ["--bug"]));
    expect(d.outcome).toBe("create");
    expect(d.createPayload.labels).toEqual(["team-x", "Bug"]);
    expect(d.createPayload.issueType).toBeUndefined();
  });

  test("Linear --bug honours linear_bug_label and seeds labels when default_labels is absent", () => {
    const r = root();
    claudeMd(r, { mode: "linear", team: "STE", project: "DPT", paragraph: "linear_bug_label: defect" });
    const d = decisionOf(decideLinear(r, ["--bug"]));
    expect(d.createPayload.labels).toEqual(["defect"]);
  });

  test("Linear --bug: no duplicate when default_labels already holds the label", () => {
    const r = root();
    claudeMd(r, { mode: "linear", team: "STE", project: "DPT", defaultLabels: ["Bug", "team-x"] });
    const d = decisionOf(decideLinear(r, ["--bug"]));
    expect(d.createPayload.labels).toEqual(["Bug", "team-x"]);
  });

  test("Linear without --bug: payload byte-identical to today", () => {
    const r = root();
    claudeMd(r, { mode: "linear", team: "STE", project: "DPT", defaultLabels: ["team-x"] });
    const d = decisionOf(decideLinear(r, []));
    expect(JSON.stringify(d.createPayload)).toBe(
      JSON.stringify({ team: "STE", project: "DPT", title: TITLE, labels: ["team-x"], milestone: LINEAR_MS }),
    );
  });
});

// ===========================================================================
// AC-STE-679.7 — the pure availability check over a saved listing
// ===========================================================================

type Check = (input: Record<string, unknown>) => string;

async function loadCheck(): Promise<Check> {
  const mod = (await import("../adapters/_shared/src/bug_tracker_type")) as { checkBugTrackerType?: Check };
  expect(typeof mod.checkBugTrackerType).toBe("function");
  return mod.checkBugTrackerType!;
}

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
  total: 4,
  issueTypes: [jiraType("Task", 0), jiraType("Bug", 0), jiraType("Epic", 1), jiraType("Subtask", -1, true)],
};

const linearLabel = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `lbl-${name}`,
  name,
  color: "#000000",
  archivedAt: null,
  ...extra,
});

describe("AC-STE-679.7 — checkBugTrackerType refuses before any write", () => {
  test("Jira: an available type that takes an Epic parent passes and returns its name", async () => {
    const check = await loadCheck();
    expect(check({ mode: "jira", issueType: "Bug", epicKey: EPIC, listing: JIRA_TYPES })).toBe("Bug");
  });

  test("Jira: an absent type refuses (NFR-10) naming jira_bug_issue_type", async () => {
    const check = await loadCheck();
    const e = thrown(() => check({ mode: "jira", issueType: "Defect", epicKey: EPIC, listing: JIRA_TYPES }));
    expectNfr10(e.message);
    expect(e.message).toContain("jira_bug_issue_type");
    expect(e.message).toContain("Defect");
  });

  test("Jira: a type that cannot take the Epic as parent refuses naming the type and the Epic, no label fallback", async () => {
    const check = await loadCheck();
    for (const t of ["Subtask", "Epic"]) {
      const e = thrown(() => check({ mode: "jira", issueType: t, epicKey: EPIC, listing: JIRA_TYPES }));
      expectNfr10(e.message);
      expect(e.message).toContain(t);
      expect(e.message).toContain(EPIC);
      expect(e.message).not.toMatch(/fall(?:s|ing)? ?back[^.\n]*label/i);
    }
  });

  test("Linear: a present, live label passes and returns its name", async () => {
    const check = await loadCheck();
    const listing = { labels: [linearLabel("Feature"), linearLabel("Bug")], hasNextPage: false };
    expect(check({ mode: "linear", label: "Bug", listing })).toBe("Bug");
  });

  test("Linear: an absent label refuses (NFR-10) naming linear_bug_label", async () => {
    const check = await loadCheck();
    const listing = { labels: [linearLabel("Feature")], hasNextPage: false };
    const e = thrown(() => check({ mode: "linear", label: "Bug", listing }));
    expectNfr10(e.message);
    expect(e.message).toContain("linear_bug_label");
    expect(e.message).toContain("Bug");
  });

  test("Linear: a retired label refuses (NFR-10) naming linear_bug_label", async () => {
    const check = await loadCheck();
    const listing = {
      labels: [linearLabel("Bug", { retiredAt: "2026-10-01T00:00:00.000Z" })],
      hasNextPage: false,
    };
    const e = thrown(() => check({ mode: "linear", label: "Bug", listing }));
    expectNfr10(e.message);
    expect(e.message).toContain("linear_bug_label");
  });
});

// ===========================================================================
// AC-STE-679.8 — argument hint, adapter docs, line cap
// ===========================================================================

describe("AC-STE-679.8 — skill hint, adapter docs, line cap", () => {
  test("the argument hint shows [--bug]", () => {
    const hint = /^argument-hint:\s*(.*)$/m.exec(read(SKILL))?.[1] ?? "";
    expect(hint).toContain("[--bug]");
  });

  test("adapters/jira.md documents jira_bug_issue_type; adapters/linear.md documents linear_bug_label", () => {
    expect(read(JIRA_ADAPTER)).toContain("jira_bug_issue_type");
    expect(read(LINEAR_ADAPTER)).toContain("linear_bug_label");
  });

  test("skills/spec-write/SKILL.md stays within its 358-line cap", () => {
    expect(read(SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// Phase 3 hardening — the --bug path is reachable from the skill, and the
// helpers hold at their edges (review findings, M_7384cf).
// ===========================================================================

describe("Phase 3 hardening — --bug wiring and helper edges", () => {
  test("SKILL.md's new-FR path names --bug, the availability check and decide --bug", () => {
    const skill = read(SKILL);
    const para = skill.split("\n").find((l) => l.includes("`--no-tech` flag")) ?? "";
    expect(para).toContain("--bug");
    expect(para).toContain("bug_tracker_type.ts");
    expect(para).toContain("decide");
    expect(para).toContain("docs/resolver-entry.md");
  });

  test("both adapters' Bug tickets section tells the run to append --bug to the decide call", () => {
    for (const doc of [JIRA_ADAPTER, LINEAR_ADAPTER]) {
      const text = read(doc);
      const start = text.indexOf("## Bug tickets");
      expect(start).toBeGreaterThan(-1);
      const section = text.slice(start, text.indexOf("\n## ", start + 1));
      expect(section).toContain("`--bug`");
      expect(section).toContain("`decide`");
    }
  });

  test("the Jira create step files the createPayload's issueType, not the resolved Task type", () => {
    const text = read(JIRA_ADAPTER);
    const at = text.indexOf("mcp__atlassian__createJiraIssue(projectKey=");
    expect(at).toBeGreaterThan(-1);
    const step = text.slice(at, text.indexOf("\n   - ", at));
    expect(step).toContain("`issueType`");
    expect(step).toMatch(/replaces the resolved type as `issuetype`/);
  });

  test("Linear --bug: the de-duplication ignores case (default 'bug' + resolved 'Bug' → one label)", () => {
    const r = root();
    claudeMd(r, { mode: "linear", team: "STE", project: "DPT", defaultLabels: ["bug", "team-x"] });
    const d = decisionOf(decideLinear(r, ["--bug"]));
    expect(d.createPayload.labels).toEqual(["bug", "team-x"]);
  });

  test("Linear: an absent label on an incomplete listing (hasNextPage) refuses as incomplete, not as missing", async () => {
    const check = await loadCheck();
    const listing = { labels: [linearLabel("Feature")], hasNextPage: true };
    const e = thrown(() => check({ mode: "linear", label: "Bug", listing }));
    expectNfr10(e.message);
    expect(e.message).toMatch(/incomplete|next page/i);
    expect(e.message).not.toMatch(/does not exist/);
  });

  test("Linear: a readable first page (hasNextPage + cursor) without the label refuses as incomplete", async () => {
    const check = await loadCheck();
    const listing = { labels: [linearLabel("Feature")], hasNextPage: true, cursor: "c-2" };
    const e = thrown(() => check({ mode: "linear", label: "Bug", listing }));
    expectNfr10(e.message);
    expect(e.message).toMatch(/more pages follow/);
    expect(e.message).not.toMatch(/does not exist/);
  });

  test("Jira: a readable listing shorter than its total, without the type, refuses as incomplete", async () => {
    const check = await loadCheck();
    const listing = { startAt: 0, maxResults: 2, total: 5, issueTypes: [jiraType("Task", 0), jiraType("Epic", 1)] };
    const e = thrown(() => check({ mode: "jira", issueType: "Bug", epicKey: EPIC, listing }));
    expectNfr10(e.message);
    expect(e.message).toMatch(/does not prove it holds every issue type/);
    expect(e.message).not.toMatch(/is not available/);
  });

  test("every refusal's Context line names the skill", async () => {
    const check = await loadCheck();
    const cases = [
      () => check({ mode: "jira", issueType: "Defect", epicKey: EPIC, listing: JIRA_TYPES }),
      () => check({ mode: "linear", label: "Bug", listing: { labels: [], hasNextPage: false } }),
    ];
    for (const c of cases) {
      const ctx = thrown(c).message.split("\n").find((l) => l.startsWith("Context:")) ?? "";
      expect(ctx).toContain("skill=/spec-write");
    }
  });
});

describe("Phase 3 round 1 — the availability check matches names exactly, as import does", () => {
  test("Jira: a configured type differing only in case is refused, not silently accepted", async () => {
    const check = await loadCheck();
    const e = thrown(() => check({ mode: "jira", issueType: "bug", epicKey: EPIC, listing: JIRA_TYPES }));
    expectNfr10(e.message);
    expect(e.message).toContain("jira_bug_issue_type");
  });

  test("Jira: a type matching only untranslatedName is refused — import reads fields.issuetype.name", async () => {
    const check = await loadCheck();
    const listing = { ...JIRA_TYPES, total: 1, issueTypes: [{ ...jiraType("Fehler", 0), untranslatedName: "Bug" }] };
    const e = thrown(() => check({ mode: "jira", issueType: "Bug", epicKey: EPIC, listing }));
    expectNfr10(e.message);
    expect(e.message).toContain("jira_bug_issue_type");
    expect(e.message).toContain("Fehler");
  });

  test("Linear: a configured label differing only in case is refused", async () => {
    const check = await loadCheck();
    const e = thrown(() => check({ mode: "linear", label: "bug", listing: { labels: [linearLabel("Bug")], hasNextPage: false } }));
    expectNfr10(e.message);
    expect(e.message).toContain("linear_bug_label");
  });
});
