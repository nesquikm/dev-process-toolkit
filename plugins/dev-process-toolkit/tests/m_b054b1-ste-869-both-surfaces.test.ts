// STE-869 (M_b054b1) — the Jira adapter guide, the skills and the tool
// inventory name both Atlassian surfaces (v1 and v2).
//
// The checks read text STRUCTURE (table cells, a v1 spelling and its v2 twin on
// the same or an adjacent line, tool names), never exact prose. Each check is a
// pure function of the text, with a planted-violation control.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gradeBundle } from "../adapters/_shared/src/shared_tracker_live_grader";
import {
  TRACKER_EXECUTE_TOOLS,
  TRACKER_READ_TOOLS,
  TRACKER_WRITE_TOOLS,
  UNGATED_WRITE_TOOLS,
} from "../templates/hooks/_lib/hooks/pre-tracker-write-gate";
import { buildPassingBundle } from "./_live_bundle_fixtures";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const INVENTORY = join(PLUGIN_ROOT, "adapters", "_shared", "data", "tracker-tool-inventory.json");
const HOOKS_JSON = join(PLUGIN_ROOT, "hooks", "hooks.json");
const read = (p: string): string => readFileSync(p, "utf-8");
const JIRA_MD = read(join(PLUGIN_ROOT, "adapters", "jira.md"));
const HOOKS_REF = read(join(PLUGIN_ROOT, "docs", "hooks-reference.md"));

/** AC.3's surfaces. */
const SURFACES: Readonly<Record<string, string>> = {
  "skills/setup/SKILL.md": join(PLUGIN_ROOT, "skills/setup/SKILL.md"),
  "skills/spec-write/SKILL.md": join(PLUGIN_ROOT, "skills/spec-write/SKILL.md"),
  "skills/gate-check/SKILL.md": join(PLUGIN_ROOT, "skills/gate-check/SKILL.md"),
  "docs/setup-reference.md": join(PLUGIN_ROOT, "docs/setup-reference.md"),
  "docs/setup-tracker-mode.md": join(PLUGIN_ROOT, "docs/setup-tracker-mode.md"),
  "docs/spec-write-tracker-mode.md": join(PLUGIN_ROOT, "docs/spec-write-tracker-mode.md"),
  "docs/hooks-reference.md": join(PLUGIN_ROOT, "docs/hooks-reference.md"),
  ".claude/skills/smoke-test/SKILL.md": join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md"),
  ".claude/skills/shared-tracker-smoke/SKILL.md": join(REPO_ROOT, ".claude/skills/shared-tracker-smoke/SKILL.md"),
  ".claude/skills/conformance-loop/SKILL.md": join(REPO_ROOT, ".claude/skills/conformance-loop/SKILL.md"),
};

/** The recorded v2 registry (2026-11-24), by class: the literal the inventory is held to. */
const V2_CLASSES: Readonly<Record<"read" | "gated-write" | "out-of-scope" | "execute", readonly string[]>> = {
  read: [
    "atlassianUserInfo", "discover", "getAccessibleAtlassianResources", "getCollaborators", "getConfluenceContent",
    "getGraphContext", "getGraphObject", "getJiraIssue", "getLoomObjectsContent", "getPeopleInfo", "getWorkActivity",
    "getWorkPortfolio", "listJiraIssueComments", "search", "searchConfluence", "searchJiraIssuesUsingJql",
  ],
  "gated-write": ["addGraphContext", "addOrEditJiraIssueComment", "createJiraIssue", "editJiraIssue", "transitionJiraIssue"],
  "out-of-scope": ["createConfluenceContent", "updateConfluenceContent"],
  execute: ["executeDestructive", "executeRead", "executeWrite"],
};
const V2_TOOLS = Object.values(V2_CLASSES).flat().sort();

/** v1 operations the surfaces name that have no direct v2 tool, and the execute tool each goes through. */
const VIA_EXECUTE: Readonly<Record<string, string>> = {
  getTransitionsForJiraIssue: "executeRead",
  getVisibleJiraProjects: "executeRead",
  getJiraProjectIssueTypesMetadata: "executeRead",
  getJiraIssueTypeMetaWithFields: "executeRead",
  getIssueLinkTypes: "executeRead",
  lookupJiraAccountId: "executeRead",
  createIssueLink: "executeWrite",
  addWorklogToJiraIssue: "executeWrite",
};

/** The v2 operation each v1 name became (recorded catalogue); a name not here kept its own. */
const V2_NAME: Readonly<Record<string, string>> = {
  getTransitionsForJiraIssue: "listJiraIssueTransitions",
  getVisibleJiraProjects: "listJiraProjects",
  getJiraProjectIssueTypesMetadata: "listJiraProjectIssueTypesMetadata",
  getIssueLinkTypes: "listJiraIssueLinkTypes",
  createIssueLink: "createJiraIssueLink",
  addWorklogToJiraIssue: "addOrEditJiraIssueWorklog",
};
/** Operations a recorded wrapped CALL proves; every other name is catalogue text. */
const CALLED = ["searchJiraIssuesUsingJql", "listJiraProjects", "listJiraProjectIssueTypesMetadata", "listJiraIssueTransitions", "listJiraIssueLinkTypes", "getJiraIssueTypeMetaWithFields"];
const v2Name = (t: string): string => V2_NAME[t] ?? t;

// --- inventory ---------------------------------------------------------------

interface Entry {
  class: string;
  reason?: string;
}
interface Surface {
  captured_at?: string;
  source?: string;
  prefix: string;
  count: number;
  tools: string[];
  classification: Record<string, Entry>;
  /** The operations `discover` lists, reached through the execute tools. */
  operations?: { captured_at: string; source: string; count: number; classification: Record<string, Operation> };
}
interface Operation extends Entry {
  product: string;
  execute_tool: string;
  inputs: string[];
}
interface Inventory {
  captured_at: string;
  source: string;
  servers: Record<string, Surface>;
  atlassian_v2?: Surface;
}
const inventory = (): Inventory => JSON.parse(read(INVENTORY)) as Inventory;
/** The v2 block; a missing one is an empty surface, so each assertion names what it lacks. */
const v2 = (): Surface => inventory().atlassian_v2 ?? { prefix: "", count: 0, tools: [], classification: {} };

// --- text helpers ------------------------------------------------------------

const has = (text: string, word: string): boolean => new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`).test(text);
const DISCOVER = /(?<![\w.])discover(?!\w)/;
const VIEW_FULL = /\bview\s*[:=]\s*"full"/;

/** The lines `i-1 .. i+1` of `lines`, joined. */
const near = (lines: readonly string[], i: number): string => lines.slice(Math.max(0, i - 1), i + 2).join("\n");

/** A v1-only spelling and the test its v2 twin must pass in the same or an adjacent line. */
const TWINS: readonly { v1: string; re: RegExp; twin: (w: string) => boolean }[] = [
  { v1: "issueTypeName", re: /(?<![A-Za-z])issueTypeName(?![A-Za-z])/, twin: (w) => has(w, "issueType") },
  { v1: "transition {id}", re: /(?<![A-Za-z])transition\s*[=:]\s*\{\s*id/, twin: (w) => has(w, "transitionId") || has(w, "transitionName") },
  // The v1 create's labels block; v2 takes a top-level `labels`, so the twin must say which surface that is.
  {
    v1: "additional_fields.labels",
    re: /additional_fields\.labels/,
    twin: (w) => /(?<![A-Za-z0-9])v2(?![A-Za-z0-9])/.test(w) && /(?<![.\w])labels(?!\w)/.test(w),
  },
  { v1: "addCommentToJiraIssue", re: /(?<![A-Za-z])addCommentToJiraIssue(?![A-Za-z])/, twin: (w) => has(w, "addOrEditJiraIssueComment") },
  { v1: "addTeamworkGraphContext", re: /(?<![A-Za-z])addTeamworkGraphContext(?![A-Za-z])/, twin: (w) => has(w, "addGraphContext") },
  ...Object.entries(VIA_EXECUTE).map(([op, tool]) => ({
    v1: op,
    re: new RegExp(`(?<![A-Za-z])${op}(?![A-Za-z])`),
    twin: (w: string) => has(w, tool),
  })),
];

/** `line: spelling` for every v1-only spelling with no v2 twin on its own or an adjacent line. */
function untwinned(text: string): string[] {
  const lines = text.split("\n");
  return lines.flatMap((l, i) =>
    TWINS.filter((t) => t.re.test(l) && !t.twin(near(lines, i))).map((t) => `${i + 1}: ${t.v1}`),
  );
}

/** Deciding commands a tracker read can feed. */
const DECIDING =
  /\b(create_idempotency_probe|container_ownership|ticket_ownership|resolve_milestone_identity|attach_project_milestone|epic_close|epic_edit|sibling_release|tracker_local_reconciliation_drift)\b/;
const ISSUE_READ = /(?<![A-Za-z])(getJiraIssue|searchJiraIssuesUsingJql)(?![A-Za-z])/;

/** Lines that hand a Jira read to a deciding command without naming `fields` and `view: "full"` there. */
function bareDecidingReads(text: string): number[] {
  const lines = text.split("\n");
  return lines.flatMap((l, i) =>
    ISSUE_READ.test(l) && DECIDING.test(l) && !(VIEW_FULL.test(near(lines, i)) && /\bfields\b/i.test(near(lines, i))) ? [i + 1] : [],
  );
}

/** The text of the `heading` section, up to the next heading of the same or a higher level. */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  expect(`${heading}: ${start >= 0 ? "found" : "missing"}`).toBe(`${heading}: found`);
  const level = /^#+/.exec(lines[start]!)![0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && /^#+/.exec(l)![0].length <= level);
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

interface OpRow {
  op: string;
  v1: string;
  v2: string;
  /** The row without its v2 cell. */
  rest: string;
}

/** The operations table of jira.md; [] when it has no v2 column. */
function operations(text: string): OpRow[] {
  const rows = section(text, /^## MCP tool names/)
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.replace(/^\||\|\s*$/g, "").split(/(?<!\\)\|/).map((c) => c.trim()));
  const head = rows[0]!;
  const i1 = head.findIndex((c) => /\bv1\b/i.test(c));
  const i2 = head.findIndex((c) => /\bv2\b/i.test(c));
  if (i1 < 0 || i2 < 0) return [];
  return rows.slice(2).map((r) => ({ op: r[0]!, v1: r[i1]!, v2: r[i2]!, rest: r.filter((_, i) => i !== i2).join(" | ") }));
}

/** What is wrong with each row's v1 and v2 cells. */
function rowProblems(rows: readonly OpRow[], v1Tools: readonly string[]): string[] {
  return rows.flatMap((r) => {
    const out: string[] = [];
    if (!v1Tools.some((t) => has(r.v1, t))) out.push(`${r.op}: no v1 tool`);
    if (!V2_TOOLS.some((t) => t !== "discover" && has(r.v2, t))) out.push(`${r.op}: no v2 tool`);
    for (const t of v1Tools.filter((n) => !V2_TOOLS.includes(n) && v2Name(n) !== n && has(r.v2, n))) out.push(`${r.op}: ${t} is a v1 name`);
    for (const t of v1Tools.filter((n) => !V2_TOOLS.includes(n) && has(r.v2, v2Name(n)))) {
      const wrapper = VIA_EXECUTE[t];
      if (!wrapper || !has(r.v2, wrapper)) out.push(`${r.op}: ${v2Name(t)} is not a direct v2 tool`);
      else if (!CALLED.includes(v2Name(t)) && !DISCOVER.test(r.v2)) out.push(`${r.op}: ${v2Name(t)} is not marked discover`);
    }
    for (const t of Object.keys(VIA_EXECUTE).filter((n) => has(r.v1, n))) {
      if (!has(r.v2, v2Name(t))) out.push(`${r.op}: the v2 cell names no operation for ${t}`);
    }
    return out;
  });
}

const V1_TOOLS = inventory().servers.atlassian!.tools;

// ===========================================================================
// AC-STE-869.1
// ===========================================================================

describe("AC-STE-869.1 — jira.md gives both calls for each operation", () => {
  const OPS = [
    "pull_acs", "push_ac_toggle", "transition_status", "upsert_ticket_metadata", "list_project_statuses",
    "addCommentToJiraIssue", "Project visibility probe", "listMilestones", "list_active_frs",
  ];
  const row = (op: string): OpRow | undefined => operations(JIRA_MD).find((r) => r.op.includes(op));

  test("the operations table has a v1 and a v2 column and keeps every operation", () => {
    const ops = operations(JIRA_MD).map((r) => r.op);
    expect(OPS.filter((o) => !ops.some((x) => x.includes(o)))).toEqual([]);
  });

  test("every row's v1 cell names a v1 tool, and its v2 cell a v2 tool or an execute tool with its operation, marked discover when unproven", () => {
    const rows = operations(JIRA_MD);
    expect(rows.length).toBeGreaterThanOrEqual(OPS.length);
    expect(rowProblems(rows, V1_TOOLS)).toEqual([]);
  });

  test("CONTROL — a row with no v2 tool, an unwrapped v1-only name, or no discover mark is reported", () => {
    const r = (v2Cell: string, v1 = "`getVisibleJiraProjects`"): OpRow => ({ op: "x", v1, v2: v2Cell, rest: v1 });
    expect(rowProblems([r("none", "`editJiraIssue`")], V1_TOOLS)).toEqual(["x: no v2 tool"]);
    expect(rowProblems([r("`search` `listJiraProjects`")], V1_TOOLS)).toEqual(["x: listJiraProjects is not a direct v2 tool"]);
    expect(rowProblems([r("`executeRead` `listJiraProjects` for `getVisibleJiraProjects`")], V1_TOOLS)).toEqual(["x: getVisibleJiraProjects is a v1 name"]);
    expect(rowProblems([r("`executeWrite` `createJiraIssueLink`", "`createIssueLink`")], V1_TOOLS)).toEqual(["x: createJiraIssueLink is not marked discover"]);
    expect(rowProblems([r("`executeRead` (find it through `discover`)")], V1_TOOLS)).toEqual(["x: the v2 cell names no operation for getVisibleJiraProjects"]);
    expect(rowProblems([r("`executeRead` `listJiraProjects`")], V1_TOOLS)).toEqual([]);
    expect(rowProblems([r("`executeWrite` `createJiraIssueLink`, found through `discover`", "`createIssueLink`")], V1_TOOLS)).toEqual([]);
  });

  // The v2 inputs are the keys of the recorded calls (tests/fixtures/live-shapes/jira/*.v2.json).
  const INPUTS: readonly [op: string, v1: readonly string[], v2: readonly string[]][] = [
    ["pull_acs", ["issueIdOrKey", "fields"], ["issueIdOrKey", "view"]],
    ["push_ac_toggle", ["issueIdOrKey", "fields"], ["issueIdOrKey", "fields"]],
    ["transition_status", ["issueIdOrKey", "transition"], ["issueIdOrKey", "transitionId"]],
    ["upsert_ticket_metadata", ["projectKey", "issueTypeName", "summary", "additional_fields"], ["projectKey", "issueType", "summary", "labels"]],
    ["addCommentToJiraIssue", ["issueIdOrKey", "commentBody"], ["issueIdOrKey", "commentBody"]],
    ["listMilestones", ["jql", "fields"], ["jql", "fields"]],
    ["list_active_frs", ["jql", "fields"], ["jql", "fields"]],
  ];
  for (const [op, v1Keys, v2Keys] of INPUTS) {
    test(`${op}: the row states the v1 and the v2 inputs`, () => {
      const r = row(op);
      expect({ v1: v1Keys.filter((k) => !has(r?.rest ?? "", k)), v2: v2Keys.filter((k) => !has(r?.v2 ?? "", k)) }).toEqual({ v1: [], v2: [] });
    });
  }

  test("the guide says to use whichever surface the session lists", () => {
    const rule = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.!?])\s/).filter((s) => /\bwhichever\b/i.test(s) && /\bsession\b/i.test(s) && /\blist(s|ed)?\b/i.test(s));
    expect(rule("Use whichever surface your session lists.").length).toBe(1);
    expect(rule("Use the v1 tool in every session.")).toEqual([]);
    expect(rule(JIRA_MD).length).toBeGreaterThan(0);
  });

  test("every v1-only spelling in the guide has its v2 twin on the same or an adjacent line", () => {
    expect(untwinned(JIRA_MD)).toEqual([]);
  });

  test("CONTROL — each v1-only spelling without its twin is reported, and with it is not", () => {
    const cases: readonly [v1: string, twin: string][] = [
      ['issueTypeName="Epic"', 'issueType="Epic"'],
      ["transition={ id: x }", "transitionId: x"],
      ["createJiraIssue.additional_fields.labels", "v2: `labels`"],
      ["`mcp__atlassian__addCommentToJiraIssue`", "`mcp__atlassian__addOrEditJiraIssueComment`"],
      ["`addTeamworkGraphContext`", "`addGraphContext`"],
      ["`mcp__atlassian__getVisibleJiraProjects`", "`executeRead`"],
      ["`createIssueLink`", "`executeWrite`"],
    ];
    for (const [v1, twin] of cases) {
      expect({ v1, found: untwinned(`a\n${v1}\nb`).length }).toEqual({ v1, found: 1 });
      expect({ v1, adjacent: untwinned(`a\n${v1}\n${twin}`) }).toEqual({ v1, adjacent: [] });
      expect({ v1, far: untwinned(`${v1}\na\n${twin}`).length }).toEqual({ v1, far: 1 });
    }
  });
});

// ===========================================================================
// AC-STE-869.2
// ===========================================================================

describe("AC-STE-869.2 — a read that feeds a deciding command names its fields and view: \"full\"", () => {
  test("the list_active_frs row carries view: \"full\" in its v2 cell beside its fields", () => {
    const r = operations(JIRA_MD).find((x) => x.op.includes("list_active_frs"));
    expect(VIEW_FULL.test(r?.v2 ?? "")).toBe(true);
    expect(has(r!.v2, "fields")).toBe(true);
  });

  test("both idempotency searches (fast path and retry) carry fields and view: \"full\" in their step", () => {
    const lines = section(JIRA_MD, /^### `upsert_ticket_metadata/).split("\n");
    const at = lines.flatMap((l, i) => (/^\s+2\. .*searchJiraIssuesUsingJql/.test(l) ? [i] : []));
    expect(at.length).toBe(2);
    const steps = at.map((i) => {
      const end = lines.findIndex((l, k) => k > i && /^\s+3\. /.test(l));
      return lines.slice(i, end).join("\n");
    });
    expect(steps.map((s) => ({ full: VIEW_FULL.test(s), fields: has(s, "fields") }))).toEqual([
      { full: true, fields: true },
      { full: true, fields: true },
    ]);
  });

  test("the Epic listing the attach and the mint decide from, and the re-list before a container create, carry view: \"full\" and fields", () => {
    const paragraphs = section(JIRA_MD, /^### Epic path/).split(/\n\s*\n/);
    const grade = (start: string) => {
      const p = paragraphs.find((x) => x.startsWith(`**${start}`));
      return { start, full: VIEW_FULL.test(p ?? ""), fields: has(p ?? "", "fields") };
    };
    expect([grade("Find."), grade("Re-list before")]).toEqual([
      { start: "Find.", full: true, fields: true },
      { start: "Re-list before", full: true, fields: true },
    ]);
  });

  test("every place jira.md states the full view keeps it: the rule, three table rows, two searches, the Epic path, the re-list and both milestone legs", () => {
    const places: Array<[string, RegExp]> = [
      ["the v2 reads rule", /\*\*v2 reads\.\*\*[^\n]*view: "full"/],
      ["pull_acs", /^\| `pull_acs`.*view: "full"/m],
      ["listMilestones", /^\| `listMilestones`.*view: "full"/m],
      ["list_active_frs", /^\| `list_active_frs`.*view: "full"/m],
      ["the retry search", /with the printed `jql` and `fields`,\s+plus `view: "full"` on v2/],
      ["the fast search", /On v2, add\s+`view: "full"` and nothing else/],
      ["the Epic Find", /\*\*Find\.\*\*[\s\S]{0,400}?on v2 `view: "full"`/],
      ["the re-list", /^\*\*Re-list before a container create\.\*\*.*view: "full"/m],
      ["the milestone legs", /fields `summary` and `labels` and, on v2,\s+`view: "full"`/],
      ["the second milestone leg", /with the same fields and view/],
    ];
    expect(places.filter(([, re]) => !re.test(JIRA_MD)).map(([n]) => n)).toEqual([]);
  });

  test("docs/spec-write-tracker-mode.md: the listing fields the consent command needs come with view: \"full\"", () => {
    const text = read(SURFACES["docs/spec-write-tracker-mode.md"]!);
    const bullet = /^- \*\*Jira\*\* \(`searchJiraIssuesUsingJql`[\s\S]*?(?=^- \*\*Linear\*\*)/m.exec(text)?.[0] ?? "";
    expect(["summary", "labels", "description", "project", "status"].filter((f) => !has(bullet, f))).toEqual([]);
    expect(VIEW_FULL.test(bullet)).toBe(true);
  });

  for (const [name, path] of Object.entries({ "adapters/jira.md": join(PLUGIN_ROOT, "adapters/jira.md"), ...SURFACES })) {
    test(`${name}: no line hands a Jira read to a deciding command without fields and view: "full"`, () => {
      expect(bareDecidingReads(read(path))).toEqual([]);
    });
  }

  test("CONTROL — a deciding read without view: \"full\", or without fields, is reported", () => {
    const line = "Save the `searchJiraIssuesUsingJql` page, then run `epic_close.ts`";
    expect(bareDecidingReads(line)).toEqual([1]);
    expect(bareDecidingReads(`${line} with view: "full"`)).toEqual([1]);
    expect(bareDecidingReads(`${line} with fields [key]`)).toEqual([1]);
    expect(bareDecidingReads(`${line} with fields [key] and, on v2, view: "full"`)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-869.3
// ===========================================================================

describe("AC-STE-869.3 — skills and docs name both surfaces", () => {
  for (const [name, path] of Object.entries(SURFACES)) {
    test(`${name}: every v1-only spelling has its v2 twin on the same or an adjacent line`, () => {
      expect(untwinned(read(path))).toEqual([]);
    });
  }

  for (const [name, path] of Object.entries(SURFACES)) {
    test(`${name}: a v2 execute call names the v2 operation, never the v1 name`, () => {
      const text = read(path);
      const wrong = Object.entries(V2_NAME).filter(([v1, v2n]) => new RegExp(`name[ =:]+[`+"`"+`"]${v1}`).test(text) || (has(text, "executeRead") && has(text, v1) && VIA_EXECUTE[v1] === "executeRead" && !has(text, v2n)));
      expect(wrong).toEqual([]);
    });
  }

  /** v1 operations with no direct v2 tool whose v2 name no recorded call proves. */
  const unproven = Object.keys(VIA_EXECUTE).filter((op) => !CALLED.includes(v2Name(op)));
  for (const [name, path] of Object.entries(SURFACES)) {
    test(`${name}: an operation no recorded call proves is marked found through discover wherever its v2 name stands`, () => {
      const lines = read(path).split("\n");
      const bare = lines.flatMap((l, n) => unproven.filter((op) => v2Name(op) !== op && has(l, v2Name(op)) && !DISCOVER.test(near(lines, n))).map((op) => `${n + 1}: ${v2Name(op)}`));
      // hooks-reference describes what the gate translates; it tells no agent to call a tool.
      expect(name === "docs/hooks-reference.md" ? [] : bare).toEqual([]);
    });
  }
  test("CONTROL — the unproven operations are the two catalogue-only writes and one read", () => {
    expect(unproven.map(v2Name).sort()).toEqual(["addOrEditJiraIssueWorklog", "createJiraIssueLink", "lookupJiraAccountId"]);
  });

  test("CONTROL — the discover mark is the word, not discover_field.ts or discovery", () => {
    expect(DISCOVER.test("`discover_field.ts` runs AC-field discovery")).toBe(false);
    expect(DISCOVER.test("found through `discover`")).toBe(true);
  });

  const cap = Number(/const SKILL_LINE_CAP = (\d+);/.exec(read(join(PLUGIN_ROOT, "tests/skill-nfr-1-length.test.ts")))?.[1]);
  // gate-check is edited in place: it adds no line to the 360 it had.
  for (const [skill, max] of [["setup", cap], ["spec-write", cap], ["gate-check", 360]] as const) {
    test(`skills/${skill}/SKILL.md stays within ${max} lines`, () => {
      expect(cap).toBe(362);
      expect(read(SURFACES[`skills/${skill}/SKILL.md`]!).trimEnd().split("\n").length).toBeLessThanOrEqual(max);
    });
  }
});

// ===========================================================================
// AC-STE-869.4
// ===========================================================================

describe("AC-STE-869.4 — hooks-reference.md describes the gate as it is", () => {
  const gate = section(HOOKS_REF, /^### pre-tracker-write-gate/);
  const bullets = gate.split(/^(?=- )/m);
  const registered = (): string =>
    (JSON.parse(read(HOOKS_JSON)) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } }).hooks.PreToolUse.find((e) =>
      e.hooks.some((h) => h.command.includes("pre-tracker-write-gate")),
    )!.matcher;
  const LISTS: Readonly<Record<string, readonly string[]>> = { TRACKER_WRITE_TOOLS, TRACKER_EXECUTE_TOOLS };

  /** The matcher a Matcher bullet states: `<names>` filled from the lists it names, in the hook's order. */
  function stated(bullet: string): string {
    const pattern = /`(\^mcp__[^`]+\$)`/.exec(bullet)?.[1] ?? "";
    const names = Object.entries(LISTS).filter(([n]) => bullet.includes(n)).flatMap(([, l]) => l);
    return pattern.replace("<names>", names.join("|"));
  }

  test("the Matcher bullet's pattern, filled from the lists it names, is the hooks.json matcher", () => {
    expect(stated(bullets.find((b) => b.startsWith("- **Matcher:**"))!)).toBe(registered());
  });

  test("CONTROL — a Matcher bullet naming the write list alone does not state the hooks.json matcher", () => {
    expect(stated("- **Matcher:** `^mcp__.+__(<names>)$`, from `TRACKER_WRITE_TOOLS`")).not.toBe(registered());
    expect(stated("- **Matcher:** `^mcp__.+__(<names>)$`, from `TRACKER_WRITE_TOOLS` and `TRACKER_EXECUTE_TOOLS`")).toBe(registered());
  });

  test("the Matcher bullet no longer says reads never reach the hook (executeRead does)", () => {
    expect(bullets.find((b) => b.startsWith("- **Matcher:**"))!).not.toMatch(/reads never reach/i);
  });

  test("a bullet describes the translator: the module and the v2 spellings it reads", () => {
    const b = bullets.find((x) => /atlassian_call\.ts/.test(x)) ?? "";
    expect(["issueType", "transitionId", "transitionName", "addOrEditJiraIssueComment"].filter((w) => !has(b, w))).toEqual([]);
  });

  test("a bullet gives the execute-tool rule: the three tools, graded by the operation, refused when unknown in a declared container", () => {
    const b = bullets.find((x) => !x.startsWith("- **Matcher:**") && TRACKER_EXECUTE_TOOLS.every((t) => has(x, t))) ?? "";
    expect({ operation: /\boperation\b/i.test(b), refuses: /\brefus/i.test(b), unknown: /\bunknown\b|does not know/i.test(b), scope: /\bdeclare[sd]?\b/i.test(b) })
      .toEqual({ operation: true, refuses: true, unknown: true, scope: true });
  });

  test("the gate section gives the non-Jira list: the code list by name, with the v2 Confluence writes", () => {
    const b = bullets.filter((x) => /non-Jira/i.test(x)).join("\n");
    expect(["UNGATED_WRITE_TOOLS", "createConfluenceContent", "updateConfluenceContent"].filter((w) => !b.includes(w))).toEqual([]);
  });

  test("a bullet describes the plugin-copy note: another copy, its version, and rerunning from the hook's own copy", () => {
    const b = bullets.filter((x) => /\bcopy\b/i.test(x) && /\bversion\b/i.test(x) && /\bre-?run\b/i.test(x) && /\b(another|other|foreign)\b[^.]*\bcopy\b/i.test(x));
    expect(b.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-STE-869.5
// ===========================================================================

describe("AC-STE-869.5 — the inventory records both surfaces", () => {
  const SETS: Readonly<Record<string, readonly string[]>> = {
    "gated-write": TRACKER_WRITE_TOOLS,
    read: TRACKER_READ_TOOLS,
    "out-of-scope": Object.keys(UNGATED_WRITE_TOOLS),
    execute: TRACKER_EXECUTE_TOOLS,
  };
  const setsOf = (n: string): string[] => Object.keys(SETS).filter((k) => SETS[k]!.includes(n));
  const unpartitioned = (names: readonly string[]): string[] => names.filter((n) => setsOf(n).length !== 1);

  test("the v2 block carries its own date, source, prefix and count, and exactly the recorded 26 names", () => {
    const b = v2();
    expect(b.captured_at).toBe("2026-11-24");
    expect(b.source ?? "").toContain("mcp__atlassian__");
    expect(b.source ?? "").toContain("mcp__claude_ai_Atlassian__");
    expect(b.prefix).toBe("mcp__atlassian__");
    expect(b.count).toBe(26);
    expect([...b.tools].sort()).toEqual(V2_TOOLS);
  });

  test("the v1 block is untouched and keeps its date and source", () => {
    const inv = inventory();
    expect(inv.captured_at).toBe("2026-09-30");
    expect(inv.source.trim().length).toBeGreaterThan(0);
    expect(Object.keys(inv.servers).sort()).toEqual(["atlassian", "linear"]);
    expect(inv.servers.atlassian!.tools.length).toBe(41);
  });

  for (const [cls, names] of Object.entries(V2_CLASSES)) {
    test(`v2 classification ${cls}: exactly its recorded names`, () => {
      expect(Object.entries(v2().classification).filter(([, e]) => e.class === cls).map(([n]) => n).sort()).toEqual([...names].sort());
    });
  }

  test("each v2 out-of-scope name carries a one-line reason", () => {
    const reasons = V2_CLASSES["out-of-scope"].map((n) => v2().classification[n]?.reason ?? "");
    expect(reasons.map((r) => r.trim().length > 0 && !r.includes("\n"))).toEqual([true, true]);
  });

  test("every Atlassian name of either surface sits in exactly one of the write, read, ungated and execute sets", () => {
    const names = [...inventory().servers.atlassian!.tools, ...v2().tools];
    expect(names.length).toBe(67); // 41 + 26
    expect(unpartitioned(names)).toEqual([]);
  });

  test("each name's recorded class is the set it sits in, on both surfaces", () => {
    const wrong = [inventory().servers.atlassian!, v2()].flatMap((s) => s.tools.filter((t) => setsOf(t)[0] !== s.classification[t]?.class));
    expect(v2().tools.length).toBe(26);
    expect(wrong).toEqual([]);
  });

  describe("the recorded operation catalogue", () => {
    const REFUSED = ["addLoomInteraction", "convertJiraIssueHierarchy", "createJiraIssueRemoteIssueLink", "editJiraEntityProperty", "linkToFocusArea", "manageJiraProjectVersion", "manageJiraProjectVersionRelatedWork", "manageJiraSprint", "setJsmAgentAvailability", "transitionJsmRequest", "updateJiraAlignItem", "uploadAttachmentToJiraIssue", "watchJiraIssue"];
    const block = () => v2().operations!;
    test("carries its own date, source and count, and repeats no directly listed name", () => {
      expect(block().captured_at).toBe("2026-11-24");
      expect(block().source).toContain("discover");
      expect(Object.keys(block().classification).length).toBe(block().count);
      expect(Object.keys(block().classification).filter((n) => v2().tools.includes(n))).toEqual([]);
    });
    test("every operation's class is the set it sits in; a refused one sits in none and carries a reason", () => {
      const wrong = Object.entries(block().classification).filter(([n, e]) => (e.class === "refused" ? setsOf(n).length !== 0 || !e.reason : setsOf(n).length !== 1 || setsOf(n)[0] !== e.class));
      expect(wrong).toEqual([]);
    });
    test("exactly the writes with no rule are refused", () => {
      expect(Object.entries(block().classification).filter(([, e]) => e.class === "refused").map(([n]) => n).sort()).toEqual(REFUSED);
    });
    test("hooks-reference names every refused operation", () => {
      expect(REFUSED.filter((n) => !HOOKS_REF.includes(`\`${n}\``))).toEqual([]);
    });
    test("no Jira, Jira Align or JSM write is in the ungated list", () => {
      const writes = Object.entries(block().classification).filter(([, e]) => /^(jira|jsm|jira-align)$/.test(e.product) && e.execute_tool !== "executeRead");
      expect(writes.length).toBeGreaterThan(5);
      expect(writes.filter(([n]) => n in UNGATED_WRITE_TOOLS)).toEqual([]);
    });
  });

  test("CONTROL — a planted unknown name fails the partition", () => {
    expect(unpartitioned([...V2_TOOLS, "frobnicateJiraIssue"])).toEqual(["frobnicateJiraIssue"]);
  });

  // --- the live grader reads the union ---------------------------------------

  const tmp = mkdtempSync(join(tmpdir(), "ste869-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  let n = 0;
  const jsonFile = (v: unknown): string => {
    const p = join(tmp, `f${n++}.json`);
    writeFileSync(p, JSON.stringify(v));
    return p;
  };
  /** The registration findings on `tool` when one session of a passing bundle called it. */
  function findings(tool: string, o: { hooksJsonPath?: string; inventoryPath?: string } = {}): string[] {
    const b = buildPassingBundle("jira");
    const s = b.sessions.find((x) => x.calls.length > 0)!;
    s.calls.push({
      ...s.calls[0]!,
      ref: `${s.sessionId}:toolu_869`,
      at: new Date(Date.parse(s.calls[0]!.at) + 1000).toISOString(),
      name: tool,
      input: {},
      result: { isError: false, text: "", exitCode: null, items: [], lastPage: null },
    } as (typeof s.calls)[number]);
    const v = gradeBundle(b as Parameters<typeof gradeBundle>[0], { behaviourDigestNow: b.run.behaviourDigest.digest, ...o });
    return v.findings
      .filter((f) => ["unclassified-tool", "unregistered-write-tool", "tool-registration-unreadable"].includes(f.code) && (f.tool === undefined || f.tool === tool))
      .map((f) => f.code);
  }
  const hooksWithout = (tool: string): string => {
    const j = JSON.parse(read(HOOKS_JSON)) as { hooks: { PreToolUse: { matcher: string }[] } };
    let changed = 0;
    for (const e of j.hooks.PreToolUse) {
      const m = e.matcher.replace(new RegExp(`\\|${tool}(?=[|)])`), "");
      if (m !== e.matcher) changed++;
      e.matcher = m;
    }
    expect(changed).toBe(1);
    return jsonFile(j);
  };

  for (const prefix of ["mcp__atlassian__", "mcp__claude_ai_Atlassian__"]) {
    for (const tool of ["listJiraIssueComments", "discover", "addOrEditJiraIssueComment", "createConfluenceContent", "executeRead", "executeWrite", "executeDestructive"]) {
      test(`grader: ${prefix}${tool} is classified and registered`, () => {
        expect(findings(prefix + tool)).toEqual([]);
      });
    }
    test(`grader: an unknown ${prefix} name is still unclassified-tool`, () => {
      expect(findings(`${prefix}frobnicateJiraIssue`)).toEqual(["unclassified-tool"]);
    });
    test(`grader: a v1-only ${prefix} name stays classified`, () => {
      expect(findings(`${prefix}getVisibleJiraProjects`)).toEqual([]);
    });
  }

  for (const tool of ["executeRead", "executeWrite", "executeDestructive", "addOrEditJiraIssueComment"]) {
    test(`grader: ${tool} that hooks.json does not match is unregistered-write-tool`, () => {
      expect(findings(`mcp__atlassian__${tool}`, { hooksJsonPath: hooksWithout(tool) })).toEqual(["unregistered-write-tool"]);
    });
  }

  test("grader: a v2 name listed with no class is unclassified-tool, never a read", () => {
    const inv = inventory();
    expect(inv.atlassian_v2?.classification.listJiraIssueComments?.class).toBe("read");
    delete inv.atlassian_v2!.classification.listJiraIssueComments;
    expect(findings("mcp__atlassian__listJiraIssueComments", { inventoryPath: jsonFile(inv) })).toEqual(["unclassified-tool"]);
  });

  test("grader: the v2 block classifies Atlassian names only, so a Linear-server executeWrite is unclassified-tool", () => {
    expect(findings("mcp__linear__executeWrite")).toEqual(["unclassified-tool"]);
  });
});

// ===========================================================================
// AC-STE-869.6
// ===========================================================================

describe("AC-STE-869.6 — jira.md names only recorded Atlassian tools", () => {
  /** Named in the guide only to say it does not exist. */
  const ABSENT = "deleteJiraIssue";

  /** The Atlassian tool names `text` carries: prefixed (either spelling, brace lists too) and bare Jira or execute names. */
  function atlassianNames(text: string): string[] {
    const prefixed = [...text.matchAll(/mcp__(?:claude_ai_)?atlassian__(?:\{([^}]*)\}|([A-Za-z]\w*))/gi)].flatMap((m) =>
      m[1] !== undefined ? m[1].split(",").map((s) => s.trim()) : [m[2]!],
    );
    const bare = [...text.matchAll(/(?<![A-Za-z_])((?:get|create|edit|delete|update|add|addOrEdit|search|transition|list|lookup)[A-Z]?\w*Jira\w*|(?:create|get)IssueLink\w*|execute[A-Z][A-Za-z]*)/g)].map((m) => m[1]!);
    return [...new Set([...prefixed, ...bare])].sort();
  }
  const unrecorded = (text: string): string[] => {
    const known = new Set([...inventory().servers.atlassian!.tools, ...v2().tools, ...Object.keys(v2().operations?.classification ?? {})]);
    return atlassianNames(text).filter((t) => !known.has(t) && t !== ABSENT);
  };

  test("every Atlassian tool name in the guide is in one of the two recorded surfaces, and both surfaces are named", () => {
    const names = atlassianNames(JIRA_MD);
    expect(["getVisibleJiraProjects", "addCommentToJiraIssue", "addOrEditJiraIssueComment", "executeRead"].filter((t) => !names.includes(t))).toEqual([]);
    expect(unrecorded(JIRA_MD)).toEqual([]);
  });

  test("the one exempt name appears only where the guide says the tool does not exist", () => {
    const lines = JIRA_MD.split("\n").filter((l) => l.includes(ABSENT));
    expect(lines.map((l) => /\bNo `deleteJiraIssue` tool\b/.test(l))).toEqual([true]);
  });

  for (const [how, planted, name] of [
    ["prefixed", "`mcp__atlassian__frobnicateTicket`", "frobnicateTicket"],
    ["other server spelling", "`mcp__claude_ai_Atlassian__frobnicateTicket`", "frobnicateTicket"],
    ["in a brace list", "`mcp__atlassian__{getJiraIssue, frobnicateTicket}`", "frobnicateTicket"],
    ["bare", "`listJiraFrobs`", "listJiraFrobs"],
    ["bare execute", "`executeFrob`", "executeFrob"],
  ] as const) {
    test(`planted name, ${how}: the guide fails on exactly that name`, () => {
      expect(unrecorded(`${JIRA_MD}\nCall ${planted}.\n`)).toEqual([name]);
    });
  }
});
