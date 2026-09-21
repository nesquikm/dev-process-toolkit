// STE-616 (M_2306b6) — two repositories on one tracker double, end to end.
//
// What this suite grades, clause by clause:
//
//   AC.1   the two-repository fixture: real git roots, declarations written by
//          the declaration front door, read back by the reader front door
//          spawned per root, cleanup in `finally` even when the body throws.
//   AC.2   the doubles are no kinder than the real trackers — each property a
//          self-test that ALSO runs against a kinder double and must go red
//          there (the AC.23 harness controls).
//   AC.3   no import of a guard: a meta-check over this file, the matrix suite
//          and the runner; the harness block rule, with its exit-1 control.
//   AC.4   every registry id has exactly one test per tracker, by name.
//   AC.5-13, AC.17-22   the scenarios S1..S18, spawned through the real front
//          doors and hook wrappers by `tests/_shared_tracker_runner.ts`.
//   AC.11  the hooks.json matcher against the classified tool inventory,
//          cross-graded against the spawned hook.
//   AC.14  no vacuous scenario: declared invocation kinds recorded, refused
//          AND permitted writes where the hook is declared, the summary line.
//   AC.16  no new probe, capability key or smoke leg; skip sites unchanged.
//   D-2 / D-3   the two named known defects, asserted at their measured
//          behaviour, titled as the defect.
//
// The registry (`adapters/_shared/src/shared_tracker_scenarios.ts`) is loaded
// with a dynamic import so its absence reds the registry clauses by name
// while every scenario still runs and is graded on its behaviour.

import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";
import {
  INVOCATION_KINDS,
  type InvocationKind,
  type ProcRun,
  type ScenarioResult,
  SCENARIO_DEFS,
  exitNonZeroBlocks,
  gatedWriteTools,
  genericWriteInput,
  harnessBlocks,
  measureKnownDefectD2,
  measureKnownDefectD3,
  measureKnownDefectD4,
  measureKnownDefectD5,
  measureKnownDefectsReceipts,
  runScenario,
  trackerHookMatchers,
} from "./_shared_tracker_runner";
import {
  JIRA_PROJECT,
  LINEAR_PROJECT,
  LINEAR_TEAM,
  REAL_PLUGIN_ROOT,
  SERVERS,
  TAG_A,
  TAG_B,
  doorEnv,
  withSharedTrackerFixture,
  type Tracker,
} from "./_shared_tracker_fixture";
import {
  JiraDouble,
  LinearDouble,
  UnknownParameterError,
  UnsupportedQueryError,
  TransportError,
  parseJql,
  readInventory,
  type Kindness,
  JIRA_SHAPES,
  type JiraShape,
} from "./_tracker_doubles";

const PLUGIN_ROOT = REAL_PLUGIN_ROOT;
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const REGISTRY_PATH = join(PLUGIN_ROOT, "adapters", "_shared", "src", "shared_tracker_scenarios.ts");
const THIS_SUITE = join(PLUGIN_ROOT, "tests", "m_2306b6-ste-616-shared-tracker-scenarios.test.ts");
const MATRIX_SUITE = join(PLUGIN_ROOT, "tests", "m_2306b6-ste-616-guard-mutation-matrix.test.ts");
const RUNNER = join(PLUGIN_ROOT, "tests", "_shared_tracker_runner.ts");
const FIXTURE_HELPER = join(PLUGIN_ROOT, "tests", "_shared_tracker_fixture.ts");
const SCENARIO_TIMEOUT = 240_000;

// ===========================================================================
// The registry, loaded without importing it statically.
// ===========================================================================

interface RegistryScenario {
  id: string;
  trackers: readonly string[];
  property: string;
  invocations: readonly string[];
  live: boolean;
  offlineReason?: string;
  /** STE-617 — children the live smoke starts for this id (0 when offline-only). */
  liveSteps?: number;
  /** STE-617 — Linear issues one broken refusal of this id could let through. */
  worstCaseExtraIssues?: number;
}
interface RegistryModule {
  SHARED_TRACKER_SCENARIOS?: readonly RegistryScenario[];
  SHARED_TRACKER_SCENARIO_IDS?: readonly string[];
  LINEAR_ISSUE_BUDGET?: number;
  spawnCeiling?: (tracker: "jira" | "linear") => number;
  linearWorstCase?: () => number;
}

let registry: RegistryModule | null = null;
let registryError = "";
try {
  registry = (await import(REGISTRY_PATH)) as RegistryModule;
} catch (e) {
  registryError = `${(e as Error)?.message ?? String(e)}`;
}

function registryScenarios(): readonly RegistryScenario[] {
  if (registry === null) {
    throw new Error(`the scenario registry ${REGISTRY_PATH} cannot be loaded (${registryError}); STE-616 ships it`);
  }
  const s = registry.SHARED_TRACKER_SCENARIOS;
  if (!Array.isArray(s)) throw new Error(`the registry exports no SHARED_TRACKER_SCENARIOS array (got ${typeof s})`);
  return s;
}

/** The closed id list, in order. */
const EXPECTED_IDS = Array.from({ length: 18 }, (_, i) => `S${i + 1}`);

/**
 * The invocation kinds each scenario must record (AC-STE-616.14). The
 * registry declares them; this table pins the declaration the runner is
 * written against, so a registry that under-declares cannot pass vacuously.
 */
const EXPECTED_KINDS: Record<string, InvocationKind[]> = {
  S1: ["front-door", "tracker-write-hook"],
  S2: ["front-door", "tracker-write-hook"],
  S3: ["front-door", "tracker-write-hook"],
  S4: ["front-door", "detector"],
  S5: ["front-door"],
  S6: ["front-door", "tracker-write-hook"],
  S7: ["front-door", "tracker-write-hook"],
  S8: ["front-door"],
  S9: ["front-door", "tracker-write-hook"],
  S10: ["front-door", "detector"],
  S11: ["front-door", "tracker-write-hook", "detector"],
  S12: ["commit-pr-hook"],
  S13: ["front-door", "tracker-write-hook"],
  S14: ["front-door", "tracker-write-hook"],
  S15: ["detector"],
  S16: ["front-door", "gate-probe"],
  S17: ["commit-pr-hook"],
  S18: ["commit-pr-hook"],
};

// ===========================================================================
// Pure graders, each with a negative control below.
// ===========================================================================

/** AC.4 — every registry id × tracker has exactly one test whose name begins `<id> <tracker> —`. */
export function coverageErrors(reg: ReadonlyArray<{ id: string; trackers: readonly string[] }>, testNames: readonly string[]): string[] {
  if (reg.length === 0) return ["the registry is empty — no scenario can be graded"];
  const errors: string[] = [];
  const ids = new Set(reg.map((r) => r.id));
  for (const r of reg) {
    for (const t of r.trackers) {
      const n = testNames.filter((name) => name.startsWith(`${r.id} ${t} —`)).length;
      if (n !== 1) errors.push(`registry id ${r.id} on ${t} has ${n} tests (exactly one required)`);
    }
  }
  for (const name of testNames) {
    const m = /^(S\d+) (jira|linear) —/.exec(name);
    if (m && !ids.has(m[1]!)) errors.push(`test "${name}" is named for ${m[1]}, which the registry lacks`);
    if (m && ids.has(m[1]!) && !reg.find((r) => r.id === m[1])!.trackers.includes(m[2]!)) {
      errors.push(`test "${name}" runs ${m[1]} on ${m[2]}, a tracker the registry does not apply it to`);
    }
  }
  return errors;
}

/** AC.14 — a scenario that records zero invocations of a declared kind is vacuous. */
export function vacuityErrors(declared: readonly string[], r: Pick<ScenarioResult, "invocations" | "hookRefused" | "hookPermitted">): string[] {
  if (declared.length === 0) return ["the scenario declares no invocation kind"];
  const errors: string[] = [];
  for (const k of declared) {
    if (!(INVOCATION_KINDS as readonly string[]).includes(k)) errors.push(`unknown invocation kind "${k}"`);
    else if ((r.invocations[k as InvocationKind] ?? 0) === 0) errors.push(`declares ${k} but recorded zero ${k} invocations`);
  }
  if (declared.includes("tracker-write-hook")) {
    if (r.hookRefused === 0) errors.push("declares the tracker-write hook but recorded no refused write");
    if (r.hookPermitted === 0) errors.push("declares the tracker-write hook but recorded no permitted write");
  }
  return errors;
}

/** AC.3 — module specifiers a source imports that resolve under adapters/ (other than the registry) or templates/hooks/. */
export function bannedImports(source: string, fromFile: string): string[] {
  const specs: string[] = [];
  for (const re of [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s+["']([^"']+)["']/gm]) {
    for (const m of source.matchAll(re)) specs.push(m[1]!);
  }
  const out: string[] = [];
  for (const spec of specs) {
    if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
    const abs = resolve(dirname(fromFile), spec).replace(/\.ts$/, "");
    const rel = abs.startsWith(PLUGIN_ROOT) ? abs.slice(PLUGIN_ROOT.length + 1) : abs;
    if (rel === "adapters/_shared/src/shared_tracker_scenarios") continue;
    if (rel.startsWith("adapters/") || rel.startsWith("templates/hooks/")) out.push(spec);
  }
  return out;
}

/** AC.11 — inventory tools classified neither gated-write, read, nor out-of-scope with a reason. */
export function classificationErrors(inv: { servers: Record<string, { tools: string[]; classification?: Record<string, { class: string; reason?: string }> }> }): string[] {
  const servers = Object.entries(inv.servers ?? {});
  const total = servers.reduce((n, [, s]) => n + (s.tools?.length ?? 0), 0);
  if (total === 0) return ["the tool inventory is empty — the matcher cannot be graded against it"];
  const errors: string[] = [];
  for (const [name, s] of servers) {
    for (const t of s.tools) {
      const c = s.classification?.[t];
      if (!c) errors.push(`${name}.${t} carries no classification`);
      else if (c.class === "out-of-scope" && (typeof c.reason !== "string" || c.reason.trim() === "")) {
        errors.push(`${name}.${t} is out-of-scope with no written reason`);
      } else if (!["gated-write", "read", "out-of-scope"].includes(c.class)) errors.push(`${name}.${t} has unknown class "${c.class}"`);
    }
  }
  return errors;
}

const FORBIDDEN_FORMS = ["." + "skip(", "." + "todo(", "test" + ".if("];

// ===========================================================================
// AC-STE-616.2 — the doubles, no kinder than the real trackers
// ===========================================================================

const jiraPage = (d: JiraDouble, jql: string, extra: Record<string, unknown> = {}) =>
  d.search({ cloudId: "c", jql, fields: ["summary", "labels"], ...extra });
const keysOf = (p: { issues: unknown }) =>
  (Array.isArray(p.issues) ? p.issues : (p.issues as { nodes: unknown[] }).nodes).map((i) => String((i as { key?: string; id?: string }).key ?? (i as { id?: string }).id));

function jiraFilterHolds(k: Kindness): boolean {
  const d = new JiraDouble(k);
  d.seed({ project: "SHR", summary: "Same title", labels: [TAG_A] });
  d.seed({ project: "SHR", summary: "Same title", labels: [TAG_B] });
  const a = keysOf(jiraPage(d, `project = SHR AND labels = "${TAG_A}"`));
  const b = keysOf(jiraPage(d, `project = SHR AND labels = "${TAG_B}"`));
  return JSON.stringify(a) !== JSON.stringify(b) && a.length === 1 && b.length === 1;
}
function linearFilterHolds(k: Kindness): boolean {
  const d = new LinearDouble(k);
  d.seed({ project: "P", title: "Same title", labels: [TAG_A] });
  d.seed({ project: "P", title: "Same title", labels: [TAG_B] });
  const a = keysOf(d.listIssues({ project: "P", label: TAG_A }));
  const b = keysOf(d.listIssues({ project: "P", label: TAG_B }));
  return JSON.stringify(a) !== JSON.stringify(b) && a.length === 1 && b.length === 1;
}
function textSupersetHolds(k: Kindness): boolean {
  const j = new JiraDouble(k);
  j.seed({ project: "SHR", summary: "Payout export daily run (v2, rerun)" });
  const l = new LinearDouble(k);
  l.seed({ project: "P", title: "Payout export daily run (v2, rerun)" });
  const jHits = jiraPage(j, 'project = SHR AND summary ~ "\\"payout export daily run\\""').issues.length;
  const lHits = l.listIssues({ project: "P", query: "payout export" }).issues.length;
  return jHits === 1 && lHits === 1;
}
function pagingHolds(k: Kindness): boolean {
  const l = new LinearDouble(k);
  for (let n = 1; n <= 3; n++) l.seed({ project: "P", title: `Row ${n}` });
  l.pageSize = 2;
  // Linear pages at the top level (measured): `hasNextPage` + `cursor`, no `pageInfo`.
  const l1 = l.listIssues({ project: "P" });
  if (l1.issues.length !== 2 || l1.hasNextPage !== true || typeof l1.cursor !== "string") return false;
  const l2 = l.listIssues({ project: "P", cursor: l1.cursor });
  if (l2.issues.length !== 1 || l2.hasNextPage !== false || l2.cursor !== undefined) return false;
  // Jira pages in both measured shapes, read through the double's own paging.
  for (const shape of JIRA_SHAPES) {
    const j = new JiraDouble(k, shape);
    for (let n = 1; n <= 3; n++) j.seed({ project: "SHR", summary: `Row ${n}` });
    j.pageSize = 2;
    const j1 = j.pageMeta(jiraPage(j, "project = SHR"));
    if (j1.items.length !== 2 || j1.last !== false || typeof j1.next !== "string") return false;
    const j2 = j.pageMeta(jiraPage(j, "project = SHR", { nextPageToken: j1.next }));
    if (j2.items.length !== 1 || j2.last !== true || j2.next !== null) return false;
  }
  return true;
}
function archivedHiddenHolds(k: Kindness): boolean {
  const l = new LinearDouble(k);
  l.seed({ project: "P", title: "Live" });
  l.seed({ project: "P", title: "Archived", archivedAt: "2026-09-01T00:00:00Z" });
  return l.listIssues({ project: "P" }).issues.length === 1 && l.listIssues({ project: "P", includeArchived: true }).issues.length === 2;
}

describe("AC-STE-616.2 — the doubles are no kinder than the real trackers", () => {
  test("filters: two JQL strings differing only in the labels conjunct, and two list_issues calls differing only in label, answer differently", () => {
    expect(jiraFilterHolds({}), "the Jira double must honour the labels conjunct").toBe(true);
    expect(linearFilterHolds({}), "the Linear double must honour the label filter").toBe(true);
  });
  test("CONTROL — a double that ignores its query fails the filter self-test", () => {
    expect(jiraFilterHolds({ ignoreQuery: true }), "a query-ignoring Jira double must fail the filter property").toBe(false);
    expect(linearFilterHolds({ ignoreQuery: true }), "a query-ignoring Linear double must fail the filter property").toBe(false);
  });
  test("text search: a summary that merely contains the phrase is returned by summary ~ and by query", () => {
    expect(textSupersetHolds({}), "text search must be a superset (containment), never equality").toBe(true);
  });
  test("CONTROL — an exact-equality text search fails the superset self-test", () => {
    expect(textSupersetHolds({ exactText: true })).toBe(false);
  });
  test("paging: page size 2 over 3 rows answers 2 rows plus a continuation token, then the third row and none", () => {
    expect(pagingHolds({}), "both doubles must page at the settable page size").toBe(true);
  });
  test("CONTROL — a double that answers in one page fails the paging self-test", () => {
    expect(pagingHolds({ onePage: true })).toBe(false);
  });
  test("Linear hides an archived issue unless includeArchived is true", () => {
    expect(archivedHiddenHolds({})).toBe(true);
    expect(archivedHiddenHolds({ showArchived: true }), "CONTROL — a double that shows archived issues fails").toBe(false);
  });
  test("closed grammar: every emitted conjunct parses; labels in (...) and labels IS NOT EMPTY throw UnsupportedQueryError naming the conjunct", () => {
    const accepted = [
      'project = SHR AND parent = SHR-1 AND labels = "milestone-M_SHR_1" AND issuetype != Epic AND labels = "shr-app-a" AND summary ~ "\\"a \\\\\\"quoted\\\\\\" title\\""',
      "project = SHR AND issuetype = Epic ORDER BY created DESC",
      "project = SHR AND statusCategory != Done",
      "project = SHR AND statusCategory = Done",
    ];
    for (const jql of accepted) expect(() => parseJql(jql), jql).not.toThrow();
    for (const [jql, conjunct] of [
      ['project = SHR AND labels in ("a", "b")', 'labels in ("a", "b")'],
      ["project = SHR AND labels IS NOT EMPTY ORDER BY created DESC", "labels IS NOT EMPTY"],
    ] as const) {
      let err: unknown = null;
      try {
        parseJql(jql);
      } catch (e) {
        err = e;
      }
      expect(err, `expected UnsupportedQueryError for ${jql}`).toBeInstanceOf(UnsupportedQueryError);
      expect((err as UnsupportedQueryError).conjunct).toBe(conjunct);
      expect((err as Error).message).toContain(conjunct);
    }
  });
  test("the grammar is exactly what the FR-create front door emits: its query JQL parses in the double", async () => {
    await withSharedTrackerFixture({ tracker: "jira", shape: "coexist" }, async (fx) => {
      const tf = join(fx.scratch, "t.txt");
      writeFileSync(tf, 'A "quoted" \\ title\n');
      const p = spawnSync("bun", ["run", join(PLUGIN_ROOT, "adapters/_shared/src/create_idempotency_probe.ts"), "query", fx.b.root, "--title-file", tf, "--parent", fx.b.milestone.key], {
        env: doorEnv(PLUGIN_ROOT, "s616-grammar"),
        encoding: "utf-8",
      });
      expect(p.status, p.stderr).toBe(0);
      const jql = JSON.parse(p.stdout.trim()).jql as string;
      const parsed = parseJql(jql);
      expect(parsed.conjuncts.length, `every conjunct of ${jql} parsed`).toBeGreaterThanOrEqual(4);
      fx.jira!.seed({ project: JIRA_PROJECT, summary: 'A "quoted" \\ title', labels: [TAG_B], parent: fx.b.milestone.key });
      fx.jira!.seed({ project: JIRA_PROJECT, summary: 'A "quoted" \\ title', labels: [TAG_A], parent: fx.b.milestone.key });
      const hits = fx.jira!.search({ cloudId: "c", jql, fields: ["summary", "labels"] });
      expect(hits.issues.length, "the tag conjunct the door emitted must select only B's row").toBe(1);
    });
  });
  test("an unknown Linear parameter, judged against the inventory's recorded parameter names, throws naming it", () => {
    const l = new LinearDouble();
    let err: unknown = null;
    try {
      l.listIssues({ project: "P", projectMilestone: "x" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownParameterError);
    expect((err as UnknownParameterError).parameter).toBe("projectMilestone");
    expect(() => l.listIssues({ project: "P", includeArchived: true, label: "x" })).not.toThrow();
    const params = readInventory().servers.linear!.parameters!;
    for (const tool of ["list_issues", "list_milestones", "save_issue", "save_milestone", "get_issue"]) {
      expect(params[tool]?.length ?? 0, `the inventory records parameter names for linear.${tool}`).toBeGreaterThan(0);
    }
  });
  test("every Jira page carries isLast, the empty one included", () => {
    const d = new JiraDouble();
    const empty = jiraPage(d, "project = NONE");
    expect(typeof empty.isLast).toBe("boolean");
    expect(empty.isLast).toBe(true);
    d.seed({ project: "SHR", summary: "x" });
    expect(typeof jiraPage(d, "project = SHR").isLast).toBe("boolean");
  });
  test("list_milestones returns at most 50 milestones, newest first", () => {
    const l = new LinearDouble();
    for (let n = 1; n <= 55; n++) l.seedMilestone("P", `Milestone ${n}`);
    const rows = l.listMilestones({ project: "P" }).milestones;
    expect(rows.length).toBe(50);
    expect(rows[0]!.name).toBe("Milestone 55");
    expect(rows[49]!.name).toBe("Milestone 6");
  });
  test("every call is recorded, and a create can land and then answer with a transport error", () => {
    const j = new JiraDouble();
    j.search({ cloudId: "c", jql: "project = SHR" });
    j.failNextWrite = true;
    expect(() => j.apply("createJiraIssue", { cloudId: "c", projectKey: "SHR", issueTypeName: "Task", summary: "Lands then times out" })).toThrow(TransportError);
    expect(j.calls.map((c) => c.kind)).toEqual(["read", "write"]);
    expect(j.writeCount).toBe(1);
    expect(j.issues.map((i) => i.summary)).toEqual(["Lands then times out"]);
  });
});

// ===========================================================================
// AC-STE-616.1 — the two-repository fixture
// ===========================================================================

/** AC.1 — the declaration-key literals a source carries (the fixture helper must carry none). */
export function declarationLiterals(src: string): string[] {
  return ["repo_tag" + ":", "min_dpt_version" + ":"].filter((lit) => src.includes(lit));
}

/** AC.1 — the reader front door's report for one root against what that root must declare. */
export function readerReportErrors(
  repo: { name: string; tag: string },
  report: { repoTag?: unknown; minDptVersion?: unknown; shared?: unknown },
  version: string,
): string[] {
  const errors: string[] = [];
  if (report.repoTag !== repo.tag) errors.push(`root ${repo.name}: the reader reports repoTag ${JSON.stringify(report.repoTag)}, expected its own ${repo.tag}`);
  if (report.minDptVersion !== version) errors.push(`root ${repo.name}: the reader reports minDptVersion ${JSON.stringify(report.minDptVersion)}, expected ${version}`);
  if (report.shared !== true) errors.push(`root ${repo.name}: the reader reports shared ${JSON.stringify(report.shared)}, expected true`);
  return errors;
}

/** AC.1 — two fixture roots must be two distinct git repositories after realpathSync. */
export function rootPairErrors(a: string, b: string): string[] {
  const errors: string[] = [];
  if (realpathSync(a) === realpathSync(b)) errors.push(`the two roots are one directory after realpathSync: ${realpathSync(a)}`);
  for (const r of [a, b]) {
    const g = spawnSync("git", ["-C", r, "rev-parse", "--is-inside-work-tree"], { encoding: "utf-8" });
    if (g.stdout.trim() !== "true") errors.push(`${r} is not a git repository`);
  }
  return errors;
}

function spawnReader(root: string): Record<string, unknown> {
  const r = spawnSync("bun", ["run", join(PLUGIN_ROOT, "adapters/_shared/src/workspace_binding.ts"), root], { env: doorEnv(PLUGIN_ROOT, "s616-reader"), encoding: "utf-8" });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout.split("\n")[0]!);
}

describe("AC-STE-616.1 — makeSharedTrackerFixture", () => {
  test("the helper file carries no declaration-key literal (the front door writes them)", () => {
    expect(declarationLiterals(readFileSync(FIXTURE_HELPER, "utf-8")), "tests/_shared_tracker_fixture.ts must carry no declaration-key literal").toEqual([]);
  });
  test("CONTROL — a copy of the fixture helper source with a hand-written repo_tag: literal fails the same scan", () => {
    const src = readFileSync(FIXTURE_HELPER, "utf-8");
    const KEY = "repo_tag" + ":";
    const mutated = src.replace("export const TAG_B", `const HAND_WRITTEN = "${KEY} ${TAG_B}";\nexport const TAG_B`);
    expect(mutated, "the control mutation applied").not.toBe(src);
    expect(declarationLiterals(mutated)).toEqual([KEY]);
  });

  for (const tracker of ["jira", "linear"] as const) {
    test(`${tracker}: two distinct git roots whose reader front door reports their own repoTag, the floor and shared: true, with the stop paragraph as written`, async () => {
      const version = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8")).version as string;
      await withSharedTrackerFixture({ tracker, shape: "coexist" }, async (fx) => {
        expect(rootPairErrors(fx.a.root, fx.b.root)).toEqual([]);
        for (const repo of [fx.a, fx.b]) {
          expect(readerReportErrors(repo, spawnReader(repo.root), version)).toEqual([]);
          const md = readFileSync(join(repo.root, "CLAUDE.md"), "utf-8");
          const added = repo.declarationDiff.split("\n").filter((l) => l.startsWith("+> ")).map((l) => l.slice(1));
          expect(added.length, "the declaration front door wrote the stop paragraph").toBeGreaterThanOrEqual(4);
          for (const line of added) expect(md.includes(line), `CLAUDE.md of ${repo.name} carries "${line}" as written`).toBe(true);
        }
      });
    }, 60_000);
  }

  test("CONTROL — a fixture whose reader front door reports the sibling's repoTag fails the AC.1 check, and one root passed twice fails the root-pair check", async () => {
    const version = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf-8")).version as string;
    await withSharedTrackerFixture({ tracker: "jira", shape: "coexist" }, async (fx) => {
      const md = join(fx.b.root, "CLAUDE.md");
      writeFileSync(md, readFileSync(md, "utf-8").split(TAG_B).join(TAG_A));
      const report = spawnReader(fx.b.root);
      expect(report.repoTag, "the mutated fixture's reader reports A's tag for root b").toBe(TAG_A);
      const errs = readerReportErrors(fx.b, report, version);
      expect(errs.length).toBe(1);
      expect(errs[0]).toContain(`expected its own ${TAG_B}`);
      expect(rootPairErrors(fx.a.root, fx.a.root)).toEqual([`the two roots are one directory after realpathSync: ${realpathSync(fx.a.root)}`]);
    });
  }, 60_000);

  test("after withSharedTrackerFixture returns, neither root nor any worktree exists — including when the body throws", async () => {
    let seen: string[] = [];
    await withSharedTrackerFixture({ tracker: "jira", shape: "span" }, (fx) => {
      seen = [fx.a.root, fx.b.root, fx.addWorktree("a"), fx.addWorktree("b", { at: "pre-declaration" }), fx.scratch];
    });
    expect(seen.filter(existsSync)).toEqual([]);
    let thrown: string[] = [];
    let caught: unknown = null;
    try {
      await withSharedTrackerFixture({ tracker: "linear", shape: "coexist" }, (fx) => {
        thrown = [fx.a.root, fx.b.root, fx.addWorktree("b"), fx.scratch];
        throw new Error("body failed on purpose");
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error)?.message).toBe("body failed on purpose");
    expect(thrown.length).toBe(4);
    expect(thrown.filter(existsSync)).toEqual([]);
  }, 60_000);
});

// ===========================================================================
// AC-STE-616.3 — subprocesses only, and the harness rule
// ===========================================================================

describe("AC-STE-616.3 — no guard is imported; blocked means exit 2 or a deny", () => {
  test("neither suite nor the runner imports a module under adapters/ (other than the registry) or templates/hooks/", () => {
    for (const f of [THIS_SUITE, MATRIX_SUITE, RUNNER]) {
      expect(existsSync(f), `${f} exists`).toBe(true);
      expect(bannedImports(readFileSync(f, "utf-8"), f), `banned imports in ${f}`).toEqual([]);
    }
  });
  test("CONTROL — the meta-check catches a guard import and a hook import", () => {
    // Spelled through variables so this file's own source never matches the scan.
    const FROM = "from";
    const IMPORT = "import";
    const src = `${IMPORT} { readWorkspaceBinding } ${FROM} "../adapters/_shared/src/workspace_binding";\nconst h = await ${IMPORT}("../templates/hooks/_lib/hooks/pre-tracker-write-gate.ts");\n${IMPORT} { x } ${FROM} "../adapters/_shared/src/shared_tracker_scenarios";`;
    expect(bannedImports(src, RUNNER)).toEqual(["../adapters/_shared/src/workspace_binding", "../templates/hooks/_lib/hooks/pre-tracker-write-gate.ts"]);
  });
  test("the harness blocks on exit 2 and on exit 0 with a deny decision — never on an advisory exit 1", () => {
    const run = (exitCode: number, stdout = ""): ProcRun => ({ exitCode, stdout, stderr: "" });
    expect(harnessBlocks(run(2))).toBe(true);
    expect(harnessBlocks(run(0, JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } })))).toBe(true);
    expect(harnessBlocks(run(0, JSON.stringify({ decision: "block", reason: "x" })))).toBe(true);
    expect(harnessBlocks(run(1))).toBe(false);
    expect(harnessBlocks(run(0))).toBe(false);
    expect(harnessBlocks(run(0, "Reminder: not a decision"))).toBe(false);
    expect(harnessBlocks(run(127))).toBe(false);
  });
  test("CONTROL — a runner that treats exit 1 as a block disagrees with the harness exactly on the advisory exit", () => {
    const one: ProcRun = { exitCode: 1, stdout: "", stderr: "Refusing: x" };
    expect(exitNonZeroBlocks(one)).toBe(true);
    expect(harnessBlocks(one)).toBe(false);
  });
});

// ===========================================================================
// The registry (AC-STE-616.4 / .14)
// ===========================================================================

describe("the scenario registry — adapters/_shared/src/shared_tracker_scenarios.ts", () => {
  test("it loads and holds exactly the closed id list S1..S18, in order", () => {
    const s = registryScenarios();
    expect(s.map((x) => x.id)).toEqual(EXPECTED_IDS);
    expect([...(registry!.SHARED_TRACKER_SCENARIO_IDS ?? [])]).toEqual(EXPECTED_IDS);
  });
  // STE-617 deviation row: S18 is offline-only too (its visibility is an exit
  // code no tool record carries). This test pinned S18 live — a defect of
  // STE-616 that STE-617 found — so it now names BOTH offline-only ids.
  test("trackers per id: S15 (Jira only) and S18 (both trackers) are offline-only with a written reason; every other id runs on both trackers and live", () => {
    for (const s of registryScenarios()) {
      if (s.id === "S15") {
        expect({ id: s.id, trackers: [...s.trackers], live: s.live }).toEqual({ id: "S15", trackers: ["jira"], live: false });
        expect((s.offlineReason ?? "").trim().length, "S15's offline-only reason").toBeGreaterThan(0);
      } else if (s.id === "S18") {
        expect({ id: s.id, trackers: [...s.trackers].sort(), live: s.live }).toEqual({ id: "S18", trackers: ["jira", "linear"], live: false });
        expect(s.offlineReason ?? "", "S18's offline-only reason names the exit code no tool record carries").toMatch(/exit[- ]code/i);
      } else {
        expect({ id: s.id, trackers: [...s.trackers].sort(), live: s.live }).toEqual({ id: s.id, trackers: ["jira", "linear"], live: true });
        expect(s.offlineReason, `${s.id} is live, so it carries no offline reason`).toBeUndefined();
      }
    }
  });
  test("CONTROL — the offline-only set is exactly S15 and S18, derived from the registry rather than typed", () => {
    expect(registryScenarios().filter((s) => !s.live).map((s) => s.id)).toEqual(["S15", "S18"]);
  });
  test("every id carries a one-line property", () => {
    for (const s of registryScenarios()) {
      expect({ id: s.id, ok: typeof s.property === "string" && s.property.trim().length > 0 && !s.property.includes("\n") }).toEqual({ id: s.id, ok: true });
    }
  });
  test("every id declares its invocation kinds, at least one, exactly as the runner records them", () => {
    for (const s of registryScenarios()) {
      expect({ id: s.id, kinds: [...s.invocations].sort() }).toEqual({ id: s.id, kinds: [...EXPECTED_KINDS[s.id]!].sort() });
    }
  });
  test("the Linear issue budget the live smoke may spend is seven (unchanged by S15..S18)", () => {
    registryScenarios();
    expect(registry!.LINEAR_ISSUE_BUDGET).toBe(7);
  });
});

// ===========================================================================
// STE-617 — the registry carries what the live ceiling and the Linear worst
// case are DERIVED from (spec deviation row 2: nothing is typed twice).
// ===========================================================================

/**
 * Children the live smoke starts per id. S10 counts three: the old client,
 * the hook-less intruder (reserved marker `intruder`) and the detector run
 * after them. S17 has its own session: one session carries one marker
 * (AC-STE-617.6), so it cannot share S12's.
 */
const EXPECTED_LIVE_STEPS: Record<string, number> = {
  S1: 2, S2: 2, S3: 2, S4: 2, S5: 2, S6: 1, S7: 1, S8: 2, S9: 1,
  S10: 3, S11: 1, S12: 1, S13: 1, S14: 2, S15: 0, S16: 2, S17: 1, S18: 0,
};

/**
 * Linear issues one broken refusal could let through: the below-floor write
 * (S6), the unreceipted create (S7) and B's FR create before its join (S14).
 * Every other id either creates nothing or is refused on an edit.
 */
const EXPECTED_WORST_CASE_EXTRA: Record<string, number> = {
  S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, S6: 1, S7: 1, S8: 0, S9: 0,
  S10: 0, S11: 0, S12: 0, S13: 0, S14: 1, S15: 0, S16: 0, S17: 0, S18: 0,
};

describe("STE-617 — per-scenario live steps and worst-case allowances", () => {
  test("every id carries a whole-number liveSteps; offline-only ids carry 0 and every live id at least 1", () => {
    for (const s of registryScenarios()) {
      const n = s.liveSteps;
      expect({ id: s.id, integer: Number.isInteger(n) }).toEqual({ id: s.id, integer: true });
      expect({ id: s.id, liveSteps: n }).toEqual({ id: s.id, liveSteps: s.live ? Math.max(1, n!) : 0 });
    }
  });
  test("the live step counts per id are exactly the pinned table", () => {
    expect(Object.fromEntries(registryScenarios().map((s) => [s.id, s.liveSteps]))).toEqual(EXPECTED_LIVE_STEPS);
  });
  test("every id carries a whole-number worstCaseExtraIssues of 0 or 1, exactly the pinned table", () => {
    expect(Object.fromEntries(registryScenarios().map((s) => [s.id, s.worstCaseExtraIssues]))).toEqual(EXPECTED_WORST_CASE_EXTRA);
  });
  test("spawnCeiling(tracker) is the tracker's live steps plus the two audits — derived, per tracker", () => {
    registryScenarios();
    expect(typeof registry!.spawnCeiling, "the registry exports spawnCeiling(tracker)").toBe("function");
    for (const t of ["jira", "linear"] as const) {
      const steps = registryScenarios()
        .filter((s) => s.live && s.trackers.includes(t))
        .reduce((n, s) => n + (s.liveSteps ?? 0), 0);
      expect({ tracker: t, ceiling: registry!.spawnCeiling!(t) }).toEqual({ tracker: t, ceiling: steps + 2 });
    }
    expect(registry!.spawnCeiling!("jira")).toBe(28);
    expect(registry!.spawnCeiling!("linear")).toBe(28);
  });
  test("linearWorstCase() is the budget plus every live Linear id's allowance — ten", () => {
    registryScenarios();
    expect(typeof registry!.linearWorstCase, "the registry exports linearWorstCase()").toBe("function");
    const extra = registryScenarios()
      .filter((s) => s.live && s.trackers.includes("linear"))
      .reduce((n, s) => n + (s.worstCaseExtraIssues ?? 0), 0);
    expect(registry!.linearWorstCase!()).toBe(registry!.LINEAR_ISSUE_BUDGET! + extra);
    expect(registry!.linearWorstCase!()).toBe(10);
  });
  test("CONTROL — the derivations move with the registry: an offline id's steps never count", () => {
    // Offline ids carry 0 steps and 0 allowance, so flipping one live→offline
    // could only lower a derived number, never leave a typed one standing.
    for (const s of registryScenarios().filter((x) => !x.live)) {
      expect({ id: s.id, steps: s.liveSteps, extra: s.worstCaseExtraIssues }).toEqual({ id: s.id, steps: 0, extra: 0 });
    }
  });
});

const SCENARIO_TEST_NAMES: string[] = [];
for (const [id, def] of Object.entries(SCENARIO_DEFS)) for (const t of def.trackers) SCENARIO_TEST_NAMES.push(`${id} ${t} — ${def.title}`);

describe("AC-STE-616.4 — every registry id has exactly one test per tracker", () => {
  test("the registry and the scenario tests agree by name", () => {
    expect(coverageErrors(registryScenarios(), SCENARIO_TEST_NAMES)).toEqual([]);
  });
  test("CONTROL — an id with no test, an empty registry and a test for an unknown id each fail naming it", () => {
    const reg = [{ id: "S1", trackers: ["jira", "linear"] }, { id: "S99", trackers: ["jira"] }];
    const errs = coverageErrors(reg, ["S1 jira — a", "S1 linear — a", "S42 jira — ghost"]);
    expect(errs.some((e) => e.includes("S99") && e.includes("0 tests"))).toBe(true);
    expect(errs.some((e) => e.includes("S42") && e.includes("lacks"))).toBe(true);
    expect(coverageErrors([], SCENARIO_TEST_NAMES)).toEqual(["the registry is empty — no scenario can be graded"]);
    expect(coverageErrors([{ id: "S1", trackers: ["jira"] }], ["S1 jira — a", "S1 jira — b"])[0]).toContain("2 tests");
  });
});

describe("AC-STE-616.14 — no vacuous scenario", () => {
  test("CONTROL — a scenario that records no hook call, or no refused write, or declares nothing, is vacuous", () => {
    const zero = { "front-door": 3, "tracker-write-hook": 0, "commit-pr-hook": 0, detector: 0, "gate-probe": 0 } as Record<InvocationKind, number>;
    expect(vacuityErrors(["front-door", "tracker-write-hook"], { invocations: zero, hookRefused: 0, hookPermitted: 0 })).toContain("declares tracker-write-hook but recorded zero tracker-write-hook invocations");
    const onlyPermits = { ...zero, "tracker-write-hook": 2 };
    expect(vacuityErrors(["tracker-write-hook"], { invocations: onlyPermits, hookRefused: 0, hookPermitted: 2 })).toEqual(["declares the tracker-write hook but recorded no refused write"]);
    expect(vacuityErrors([], { invocations: zero, hookRefused: 0, hookPermitted: 0 })).toEqual(["the scenario declares no invocation kind"]);
    expect(vacuityErrors(["front-door"], { invocations: zero, hookRefused: 0, hookPermitted: 0 })).toEqual([]);
  });
  test("neither suite contains a skip, todo or conditional test form", () => {
    for (const f of [THIS_SUITE, MATRIX_SUITE]) {
      const src = readFileSync(f, "utf-8");
      for (const form of FORBIDDEN_FORMS) expect(src.includes(form), `${f} contains ${form}`).toBe(false);
    }
  });
});

// ===========================================================================
// AC-STE-616.11 — the matcher, the classified inventory, the spawned hook
// ===========================================================================

async function spawnHook(tracker: Tracker, root: string, tool: string, input: Record<string, unknown>, transcript: string, server: string): Promise<ProcRun> {
  const payload = JSON.stringify({
    session_id: "s616-ac11",
    transcript_path: transcript,
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: `mcp__${server}__${tool}`,
    tool_input: input,
    tool_use_id: "toolu_616_ac11",
  });
  void tracker;
  return new Promise((res) => {
    const c = spawn("bash", [join(PLUGIN_ROOT, "templates/hooks/process/pre-tracker-write-gate.sh")], { env: doorEnv(PLUGIN_ROOT, "s616-ac11"), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => res({ exitCode: code ?? -1, stdout, stderr }));
    c.stdin.end(payload);
  });
}

async function bounded<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

describe("AC-STE-616.11 — the tracker-write matcher against the classified inventory", () => {
  test("every inventory tool is classified gated-write, read, or out-of-scope with a written reason", () => {
    expect(classificationErrors(readInventory())).toEqual([]);
  });
  test("CONTROL — an unclassified tool, a reasonless out-of-scope tool and an empty inventory fail naming them", () => {
    const errs = classificationErrors({ servers: { linear: { tools: ["frob", "zap"], classification: { zap: { class: "out-of-scope" } } } } });
    expect(errs).toEqual(["linear.frob carries no classification", "linear.zap is out-of-scope with no written reason"]);
    expect(classificationErrors({ servers: {} })).toEqual(["the tool inventory is empty — the matcher cannot be graded against it"]);
    expect(classificationErrors({ servers: { atlassian: { tools: [] } } })).toEqual(["the tool inventory is empty — the matcher cannot be graded against it"]);
  });
  test("the matcher hooks.json registers matches every gated write under two server names per tracker and no read", () => {
    const matchers = trackerHookMatchers(PLUGIN_ROOT);
    expect(matchers.length, "hooks.json registers the tracker-write hook").toBeGreaterThan(0);
    const inv = readInventory();
    const m = (name: string) => matchers.some((r) => r.test(name));
    const misses: string[] = [];
    for (const [server, spellings] of [
      ["atlassian", ["atlassian", "claude_ai_Atlassian"]],
      ["linear", ["linear", "claude_ai_Linear"]],
    ] as const) {
      const cls = inv.servers[server]!.classification!;
      const gated = Object.keys(cls).filter((t) => cls[t]!.class === "gated-write");
      const reads = Object.keys(cls).filter((t) => cls[t]!.class === "read");
      expect(gated.length, `${server} has gated writes`).toBeGreaterThan(0);
      expect(reads.length, `${server} has reads`).toBeGreaterThan(0);
      for (const s of spellings) {
        for (const t of gated) if (!m(`mcp__${s}__${t}`)) misses.push(`write mcp__${s}__${t} unmatched`);
        for (const t of reads) if (m(`mcp__${s}__${t}`)) misses.push(`read mcp__${s}__${t} matched`);
      }
    }
    expect(misses).toEqual([]);
  });
  for (const tracker of ["jira", "linear"] as const) {
    test(`${tracker}: the classification is cross-graded against the spawned hook — in a declared shared root with no receipt a gated write is refused and a read is not`, async () => {
      await withSharedTrackerFixture({ tracker, shape: "coexist" }, async (fx) => {
        const transcript = join(fx.scratch, "empty.jsonl");
        writeFileSync(transcript, "");
        const server = tracker === "jira" ? "atlassian" : "linear";
        const cls = readInventory().servers[server]!.classification!;
        const key = tracker === "jira" ? `${JIRA_PROJECT}-1` : `${LINEAR_TEAM}-1`;
        const cases = Object.entries(cls)
          .filter(([, c]) => c.class !== "out-of-scope")
          .map(([t, c]) => ({ t, c: c.class, input: c.class === "gated-write" ? genericWriteInput(tracker, t, key) : { id: key } }));
        const runs = await bounded(cases, 6, (x) => spawnHook(tracker, fx.b.root, x.t, x.input, transcript, SERVERS[tracker].b));
        const wrong = cases
          .map((x, i) => ({ ...x, r: runs[i]! }))
          .filter((x) => (x.c === "gated-write" ? x.r.exitCode !== 2 : x.r.exitCode !== 0))
          .map((x) => `${x.c} ${x.t}: exit ${x.r.exitCode} ${x.r.stderr.split("\n")[0]}`);
        expect(wrong).toEqual([]);
      });
    }, 120_000);
  }
});

// ===========================================================================
// AC-STE-616.16 — nothing new pinned
// ===========================================================================

describe("AC-STE-616.16 — no new probe, capability key or smoke leg", () => {
  test("the numbered probe count in the gate-check skill is the kickoff's 85", () => {
    const body = readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf-8");
    expect([...body.matchAll(/^(\d+)\. \*\*/gm)].length).toBe(85);
  });
  test("CANONICAL_CAPABILITY_KEYS.length, SMOKE_LEGS and the head of ORDERED_UNREACHABLE_PIN_LEDGER equal the kickoff's (read in a subprocess)", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "dpt-ste616-pins-")));
    try {
      const script = join(dir, "pins.ts");
      writeFileSync(
        script,
        "const [a, b, c] = process.argv.slice(2);\nconst m1 = await import(a!); const m2 = await import(b!); const m3 = await import(c!);\nconsole.log(JSON.stringify({ keys: m1.CANONICAL_CAPABILITY_KEYS.length, legs: m2.SMOKE_LEGS, head: { value: m3.ORDERED_UNREACHABLE_PIN_LEDGER[0].value, commit: m3.ORDERED_UNREACHABLE_PIN_LEDGER[0].commit } }));\n",
      );
      const src = join(PLUGIN_ROOT, "adapters", "_shared", "src");
      const p = spawnSync("bun", ["run", script, join(src, "closing_summary_capability_keys.ts"), join(src, "smoke_fixture_groups.ts"), join(src, "module_reachability.ts")], { encoding: "utf-8" });
      expect(p.status, p.stderr).toBe(0);
      expect(JSON.parse(p.stdout.trim())).toEqual({ keys: 47, legs: ["linear", "jira", "none"], head: { value: 120, commit: "049ce5f" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("the skip and todo call sites across the suite are identical by name to the kickoff's (static measure)", () => {
    const pinned = JSON.parse(readFileSync(join(PLUGIN_ROOT, "tests", "fixtures", "ste-616-kickoff-skips.json"), "utf-8")).sites as string[];
    const now: string[] = [];
    for (const pat of ["tests/**/*.ts", "adapters/**/*.test.ts"]) {
      for (const f of new Glob(pat).scanSync({ cwd: PLUGIN_ROOT })) {
        if (f.includes("m_2306b6-ste-616")) continue;
        readFileSync(join(PLUGIN_ROOT, f), "utf-8")
          .split("\n")
          .forEach((l) => {
            if (/\b(?:test|it|describe)\.(?:skip|skipIf|todo|todoIf|if)\(/.test(l)) now.push(`${f}: ${l.trim()}`);
          });
      }
    }
    expect(now.sort()).toEqual([...pinned].sort());
  });
});

// ===========================================================================
// S1..S18 — one test per registry id per tracker
// ===========================================================================

const RESULTS: ScenarioResult[] = [];

/**
 * The answer shapes each tracker's double is run under: Jira was measured
 * flipping between a plain and a wrapped answer on the same server, so every
 * Jira scenario runs under both; Linear has one measured shape.
 */
const SHAPES_OF: Record<Tracker, readonly (JiraShape | null)[]> = { jira: JIRA_SHAPES, linear: [null] };

describe("S1..S18 — two repositories on one tracker double, through the real front doors and hooks", () => {
  for (const [id, def] of Object.entries(SCENARIO_DEFS)) {
    for (const tracker of def.trackers) {
      for (const jiraShape of SHAPES_OF[tracker]) {
      test(`${id} ${tracker}${jiraShape === null ? "" : ` (${jiraShape})`} — ${def.title}`, async () => {
        const r = await runScenario(id, tracker, { pluginRoot: PLUGIN_ROOT, ...(jiraShape === null ? {} : { jiraShape }) });
        const vacuity = vacuityErrors(EXPECTED_KINDS[id] ?? [], r);
        RESULTS.push({ ...r, ok: r.ok && vacuity.length === 0, failures: [...r.failures, ...vacuity.map((v) => `VACUOUS: ${v}`)] });
        expect(r.loadErrors, `${id} ${tracker}: a front door or hook could not load`).toEqual([]);
        expect(r.failures, `${id} ${tracker} failed (steps: ${r.steps.join(" → ")})`).toEqual([]);
        expect(vacuity, `${id} ${tracker} is vacuous`).toEqual([]);
      }, SCENARIO_TIMEOUT);
      }
    }
  }
});

/** AC.14 — the per-tracker summary line, computed from the recorded results. */
export function summaryLine(tracker: Tracker, results: ReadonlyArray<Pick<ScenarioResult, "tracker" | "ok" | "failures">>): string {
  const mine = results.filter((r) => r.tracker === tracker);
  const vacuous = mine.filter((r) => r.failures.some((f) => f.startsWith("VACUOUS:"))).length;
  const pass = mine.filter((r) => r.ok).length;
  return `[${tracker}] scenarios pass=${pass} fail=${mine.length - pass} vacuous=${vacuous}`;
}

describe("AC-STE-616.14 — the summary line", () => {
  test("each tracker's summary line reads pass=<every scenario of that tracker> fail=0 vacuous=0 (captured, then printed)", () => {
    for (const tracker of ["jira", "linear"] as const) {
      const n = Object.values(SCENARIO_DEFS).filter((d) => d.trackers.includes(tracker)).length * SHAPES_OF[tracker].length;
      const line = summaryLine(tracker, RESULTS);
      console.log(line);
      expect(line).toBe(`[${tracker}] scenarios pass=${n} fail=0 vacuous=0`);
    }
  });
  test("CONTROL — a vacuous result and a failed result each move the summary line off pass-only", () => {
    const ok = { tracker: "jira" as const, ok: true, failures: [] as string[] };
    const vac = { tracker: "jira" as const, ok: false, failures: ["VACUOUS: declares the tracker-write hook but recorded no refused write"] };
    const red = { tracker: "jira" as const, ok: false, failures: ["S7 failed"] };
    expect(summaryLine("jira", [ok, vac])).toBe("[jira] scenarios pass=1 fail=1 vacuous=1");
    expect(summaryLine("jira", [ok, red])).toBe("[jira] scenarios pass=1 fail=1 vacuous=0");
    expect(summaryLine("linear", [ok])).toBe("[linear] scenarios pass=0 fail=0 vacuous=0");
  });
});

// ===========================================================================
// The named known defects — measured, titled, never skipped
// ===========================================================================

/** Temp paths, session ids and receipt counts out: what is left is the wording. */
function normalisedRefusal(stderr: string): string {
  return stderr
    .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s)"'`,]+/g, "<PATH>")
    .replace(/s616-[A-Za-z0-9-]+/g, "<SID>")
    .replace(/\b\d+ announced receipt file/g, "<N> announced receipt file");
}

describe("What ships as a known defect", () => {
  for (const tracker of ["jira", "linear"] as const) {
    test(`KNOWN DEFECT D-4 (${tracker}) — a milestone create decided from a listing captured before the sibling minted is permitted: a fresh session, B's act=create from the stale listing, no join decision, then B's container create — the hook exits 0 and the double holds TWO containers with that title`, async () => {
      const m = await measureKnownDefectD4(tracker, PLUGIN_ROOT);
      // Measured: pre-tracker-write-gate.ts:1592 permits an unspent create
      // decision; it cannot see A's container. AC-STE-616.6 requires exit 2
      // with the write count unchanged — a hook that refuses flips this red.
      expect(m).toEqual({ decisionAct: "create", exitCode: 0, blocked: false, containersWithTitle: 2, writesAdded: 1 });
    }, SCENARIO_TIMEOUT);
    test(`KNOWN DEFECT D-5 (${tracker}) — a relocated checkout's receipt-location refusal is worded as a label carrying two tags, in both directions: receipt in B's main checkout with the write decided in B's worktree, and receipt in B's worktree with the write decided in B's main checkout`, async () => {
      const m = await measureKnownDefectD5(tracker, PLUGIN_ROOT);
      for (const [direction, r] of [
        ["receipt in the main checkout, write decided in the worktree", m.mainReceiptWorktreeWrite],
        ["receipt in the worktree, write decided in the main checkout", m.worktreeReceiptMainWrite],
      ] as const) {
        expect(r, direction).not.toBeNull();
        expect(r!.exitCode, `${direction}:\n${r!.stderr}`).toBe(2);
        // The labels carry ONE tag; two declared roots share it. Measured wording:
        expect(r!.stderr, direction).toMatch(/labels \[[^\],]+\] carry more than one repo tag of the declared targets/);
        // …and no receipt location is named anywhere in the refusal.
        expect(/receipt|\.dpt\/ledger/i.test(r!.stderr), `${direction}: the refusal names no receipt location:\n${r!.stderr}`).toBe(false);
      }
    }, SCENARIO_TIMEOUT);
    test(`KNOWN DEFECT D-6 (${tracker}) — an unreadable receipt directory is reported in the malformed-receipt wording: no substring tells it from a malformed receipt once paths, session ids and counts are normalised`, async () => {
      const m = await measureKnownDefectsReceipts(tracker, PLUGIN_ROOT);
      expect(m.writesAdded, "no refused write reached the double").toBe(0);
      expect(m.malformed!.exitCode, m.malformed!.stderr).toBe(2);
      expect(m.unreadable!.exitCode, m.unreadable!.stderr).toBe(2);
      expect(m.unreadable!.stderr).toMatch(/announced receipt file\(s\) failed to parse and were ignored/);
      expect(normalisedRefusal(m.unreadable!.stderr)).toBe(normalisedRefusal(m.malformed!.stderr));
    }, SCENARIO_TIMEOUT);
    // NON-DISCRIMINATING BY CONSTRUCTION: D-7 pins that another session's
    // receipt is indistinguishable from no receipt at all, so this check can
    // never tell those two cases apart — that sameness IS the measured defect.
    // It goes red if the hook ever names the other session, or permits the write.
    test(`KNOWN DEFECT D-7 (${tracker}) — another session's receipt prints the plain no-receipt text (non-discriminating against the no-receipt case by construction)`, async () => {
      const m = await measureKnownDefectsReceipts(tracker, PLUGIN_ROOT);
      expect(m.otherSession!.exitCode, m.otherSession!.stderr).toBe(2);
      expect(m.noReceipt!.exitCode, m.noReceipt!.stderr).toBe(2);
      expect(m.otherSession!.stderr).toContain("no create receipt announced by create_idempotency_probe.ts decide in this session authorises it.");
      expect(normalisedRefusal(m.otherSession!.stderr)).toBe(normalisedRefusal(m.noReceipt!.stderr));
    }, SCENARIO_TIMEOUT);
    test(`KNOWN DEFECT D-2 (${tracker}) — an FR archived on B's main branch but active on an unmerged branch reads idle: sibling_release.ts exits 0 where AC-STE-616.8 requires 1`, async () => {
      const m = await measureKnownDefectD2(tracker, PLUGIN_ROOT);
      // Measured at the kickoff: exit 0 (active_plan_ship_ready.ts:376-379).
      // A fix flips this to 1 and must update the FR's known-defect record.
      expect(m.exitCode, m.output).toBe(0);
    }, SCENARIO_TIMEOUT);
    test(`KNOWN DEFECT D-3 (${tracker}) — B's CLAUDE.md without its project: line routes the repoint to resume, which rewrites the binding and exits 0 with no row run`, async () => {
      const m = await measureKnownDefectD3(tracker, PLUGIN_ROOT);
      expect({ exitCode: m.exitCode, stdout: m.stdout.trim(), rowLines: m.rowLines, claudeMdChanged: m.claudeMdChanged }).toEqual({ exitCode: 0, stdout: "resume", rowLines: 0, claudeMdChanged: true });
    }, SCENARIO_TIMEOUT);
  }
});

void LINEAR_PROJECT;
void REPO_ROOT;
