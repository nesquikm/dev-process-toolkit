// STE-604 (M_947c79) — creating a ticket in a shared container is decided by
// code on Jira and Linear.
//
// The pre-create "was this ticket already made?" check used to be prose the
// model followed. It is now two subcommands of the module that owns the one
// normalizer:
//
//   bun run adapters/_shared/src/create_idempotency_probe.ts query  <root> --title <t> [container]
//   bun run adapters/_shared/src/create_idempotency_probe.ts decide <root> <page.json>... --title <t> [container] --attempt <a>
//
// Every behavioural leg below SPAWNS those commands over real fixture roots
// and drives them against in-memory trackers that honour every conjunct their
// query carried — the tracker that exists, not the one that returned a
// `glacy-be` row to a search filtered on `glacy-fe`.
//
// Output contract this suite reads (the FR fixes the fields, this file fixes
// the framing):
//   - `query`, Jira: ONE JSON line `{ "jql": "<JQL>", "fields": [...] }`.
//   - `query`, Linear: ONE JSON line — the `list_issues` arguments object itself.
//   - `decide`: ONE JSON line `{ outcome, key?, reason?, capability?, createPayload? }`,
//     plus a `dpt-receipt: <absolute path>` line when a receipt was written.
//   - A refusal of the binding (malformed declaration, failed floor, unforwarded
//     tag) exits non-zero with the error on stderr.
//
// The pre-change bytes (`ac1f3cb`) are extracted with `git show` for the
// undeclared-parity leg (AC.7) and the old-client leg (AC.10).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  RECEIPT_ANNOUNCEMENT_PREFIX,
  readSessionReceipts,
} from "../adapters/_shared/src/tracker_receipts";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const MODULE = join(pluginRoot, "adapters", "_shared", "src", "create_idempotency_probe.ts");
const JIRA_ADAPTER = join(pluginRoot, "adapters", "jira.md");
const LINEAR_ADAPTER = join(pluginRoot, "adapters", "linear.md");
const SPEC_WRITE_SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const PRE_CHANGE_SHA = "ac1f3cb";
const UNCERTAIN = "tracker_idempotency_uncertain";

const read = (p: string) => readFileSync(p, "utf-8");

// ===========================================================================
// Shared scaffolding: a manifest dir (running version >= the gated release),
// a scratch dir for page files, and a session id per test run.
// ===========================================================================

let manifestDir = "";
let scratch = "";
const SESSION = `ste604-${process.pid}`;

beforeAll(() => {
  manifestDir = mkdtempSync(join(tmpdir(), "dpt-ste604-manifest-"));
  pluginManifest(manifestDir, "2.87.0");
  scratch = mkdtempSync(join(tmpdir(), "dpt-ste604-pages-"));
});

afterAll(() => {
  rmSync(manifestDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runModule(args: string[], env: Record<string, string> = {}): Run {
  const proc = Bun.spawnSync(["bun", "run", MODULE, ...args], {
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: manifestDir,
      CLAUDE_CODE_SESSION_ID: SESSION,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** The ONE JSON line a subcommand prints. */
function jsonLine(run: Run): Record<string, any> {
  const lines = run.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  expect(
    lines.length,
    `expected exactly one JSON line on stdout; code=${run.code}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
  ).toBe(1);
  return JSON.parse(lines[0]!);
}

function receiptAnnouncements(run: Run): string[] {
  return run.stdout
    .split("\n")
    .filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))
    .map((l) => l.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim());
}

let pageSeq = 0;
function writePage(page: unknown): string {
  pageSeq += 1;
  const p = join(scratch, `page-${pageSeq}.json`);
  writeFileSync(p, JSON.stringify(page));
  return p;
}

type Container =
  | { parent: string }
  | { milestoneLabel: string }
  | { linearMilestone: string };

function containerFlags(c: Container): string[] {
  if ("parent" in c) return ["--parent", c.parent];
  if ("milestoneLabel" in c) return ["--milestone-label", c.milestoneLabel];
  return ["--linear-milestone", c.linearMilestone];
}

function query(root: string, title: string, c: Container, extra: string[] = []): Run {
  return runModule(["query", root, "--title", title, ...containerFlags(c), ...extra]);
}

function decide(
  root: string,
  pages: string[],
  title: string,
  c: Container,
  attempt: "fast" | "retry-1" | "retry-2" | "retry-3",
): Run {
  return runModule([
    "decide",
    root,
    ...pages,
    "--title",
    title,
    ...containerFlags(c),
    "--attempt",
    attempt,
  ]);
}

// ---------------------------------------------------------------- fixtures

const EPIC = "GF-40";
const PARENT: Container = { parent: EPIC };
const NUMERIC: Container = { milestoneLabel: "milestone-M46" };
const LINEAR_MS_ID = "ms-3fa85f64";
const LINEAR_MS: Container = { linearMilestone: LINEAR_MS_ID };
const TITLE = "The reward banner - repainted light";

function declareJira(root: string, tag: string | null): void {
  if (tag === null) claudeMd(root, { mode: "jira", project: "GF" });
  else {
    claudeMd(root, {
      mode: "jira",
      project: "GF",
      defaultLabels: [tag],
      repoTag: tag,
      minDptVersion: "2.87.0",
    });
  }
}

function declareLinear(root: string, tag: string | null): void {
  if (tag === null) claudeMd(root, { mode: "linear", team: "STE", project: "DPT" });
  else {
    claudeMd(root, {
      mode: "linear",
      team: "STE",
      project: "DPT",
      defaultLabels: [tag],
      repoTag: tag,
      minDptVersion: "2.87.0",
    });
  }
}

/** A two-root fixture; `a` is the FE repository, `b` the BE one. */
function withRoots<T>(body: (a: string, b: string) => T): T {
  const fx = makeSpanFixture("M_GF_40");
  try {
    return body(fx.a, fx.b);
  } finally {
    fx.cleanup();
  }
}

/** Every file under `root`, relative path -> bytes. */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p), read(p));
    }
  };
  walk(root);
  return out;
}

// ===========================================================================
// In-memory Jira that honours EVERY conjunct of the JQL it is handed.
// ===========================================================================

interface JiraTicket {
  key: string;
  summary: string;
  labels: string[];
  issuetype: string;
  parent: string | null;
  project: string;
}

/**
 * Read a JQL string literal starting at `s[i] === '"'`. Returns the unescaped
 * content and the index just past the closing quote. An unterminated literal
 * is the live 400 ("Expecting either 'OR' or 'AND'") — thrown, never guessed.
 */
function readJqlString(s: string, i: number): { value: string; end: number } {
  if (s[i] !== '"') throw new Error(`in-memory Jira 400: expected a string literal at ${i}: ${s}`);
  let value = "";
  let j = i + 1;
  while (j < s.length) {
    const ch = s[j]!;
    if (ch === "\\") {
      if (j + 1 >= s.length) break;
      value += s[j + 1];
      j += 2;
      continue;
    }
    if (ch === '"') return { value, end: j + 1 };
    value += ch;
    j += 1;
  }
  throw new Error(`in-memory Jira 400: unterminated string literal in: ${s}`);
}

/** Undo one level of backslash escaping (the phrase level). */
function unescapeOnce(s: string): string {
  return s.replace(/\\(.)/gsu, "$1");
}

interface ParsedJql {
  project?: string;
  parent?: string;
  labels: string[];
  notEpic: boolean;
  phrase?: string;
  /** The raw summary literal's end index — must be the end of the JQL. */
  summaryEnd?: number;
}

function parseJql(jql: string): ParsedJql {
  const out: ParsedJql = { labels: [], notEpic: false };
  let i = 0;
  const rest = () => jql.slice(i);
  for (;;) {
    let m: RegExpExecArray | null;
    if ((m = /^project = ([A-Z][A-Z0-9_]*)/.exec(rest()))) {
      out.project = m[1];
      i += m[0].length;
    } else if ((m = /^parent = ([A-Z][A-Z0-9_]*-\d+)/.exec(rest()))) {
      out.parent = m[1];
      i += m[0].length;
    } else if ((m = /^issuetype != Epic/.exec(rest()))) {
      out.notEpic = true;
      i += m[0].length;
    } else if ((m = /^labels = /.exec(rest()))) {
      i += m[0].length;
      const lit = readJqlString(jql, i);
      out.labels.push(lit.value);
      i = lit.end;
    } else if ((m = /^summary ~ /.exec(rest()))) {
      i += m[0].length;
      const lit = readJqlString(jql, i);
      const v = lit.value;
      if (!(v.startsWith('"') && v.endsWith('"') && v.length >= 2)) {
        throw new Error(`in-memory Jira: summary ~ is not the quoted-phrase form: ${jql}`);
      }
      out.phrase = v.slice(1, -1);
      out.summaryEnd = lit.end;
      i = lit.end;
    } else {
      throw new Error(`in-memory Jira 400: unparseable JQL at ${i}: ${jql}`);
    }
    if (i === jql.length) return out;
    if (jql.startsWith(" AND ", i)) {
      i += 5;
      continue;
    }
    throw new Error(`in-memory Jira 400: expected AND at ${i}: ${jql}`);
  }
}

const loose = (s: string) =>
  s.toLowerCase().replace(/[–—]/gu, "-").replace(/\s+/gu, " ").trim();

class MemJira {
  tickets: JiraTicket[] = [];
  creates = 0;
  /** When true every page reports `isLast: false`. */
  capped = false;
  private seq = 100;

  add(t: Partial<JiraTicket> & { summary: string }): JiraTicket {
    this.seq += 1;
    const ticket: JiraTicket = {
      key: `GF-${this.seq}`,
      labels: [],
      issuetype: "Task",
      parent: null,
      project: "GF",
      ...t,
    };
    this.tickets.push(ticket);
    return ticket;
  }

  /** Honour every conjunct. Unknown JQL throws. */
  search(jql: string): { issues: unknown[]; isLast: boolean } {
    const q = parseJql(jql);
    const phrases = q.phrase === undefined ? [] : [q.phrase, unescapeOnce(q.phrase)];
    const hits = this.tickets.filter((t) => {
      if (q.project !== undefined && t.project !== q.project) return false;
      if (q.parent !== undefined && t.parent !== q.parent) return false;
      if (q.notEpic && t.issuetype === "Epic") return false;
      for (const l of q.labels) if (!t.labels.includes(l)) return false;
      if (phrases.length > 0 && !phrases.some((p) => loose(t.summary).includes(loose(p)))) {
        return false;
      }
      return true;
    });
    return { issues: hits.map(jiraRow), isLast: !this.capped };
  }

  /** The create a decision authorised, carrying `createPayload` as-is. */
  createFrom(payload: Record<string, any>, title: string): JiraTicket {
    this.creates += 1;
    return this.add({
      summary: typeof payload.summary === "string" ? payload.summary : title,
      labels: Array.isArray(payload.labels) ? [...payload.labels] : [],
      parent: typeof payload.parent === "string" ? payload.parent : null,
      issuetype: "Task",
    });
  }

  /** The create as the PRE-CHANGE prose issued it: no parent, no container label. */
  createBare(title: string, labels: string[] = []): JiraTicket {
    this.creates += 1;
    return this.add({ summary: title, labels });
  }
}

function jiraRow(t: JiraTicket): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    summary: t.summary,
    labels: t.labels,
    issuetype: { name: t.issuetype },
    project: { key: t.project },
  };
  if (t.parent !== null) fields.parent = { key: t.parent };
  return { key: t.key, fields };
}

/** A hand-written Jira page — what a conjunct-IGNORING search hands back. */
function jiraPage(tickets: Partial<JiraTicket>[], isLast = true) {
  let n = 800;
  return {
    issues: tickets.map((t) =>
      jiraRow({
        key: `GF-${(n += 1)}`,
        summary: TITLE,
        labels: [],
        issuetype: "Task",
        parent: EPIC,
        project: "GF",
        ...t,
      } as JiraTicket),
    ),
    isLast,
  };
}

// ===========================================================================
// In-memory Linear honouring every `list_issues` argument it accepts.
// ===========================================================================

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  labels: string[];
  projectMilestone: { id: string; name: string } | null;
  project: string;
  team: string;
}

class MemLinear {
  issues: LinearIssue[] = [];
  creates = 0;
  capped = false;
  private seq = 900;

  add(i: Partial<LinearIssue> & { title: string }): LinearIssue {
    this.seq += 1;
    const issue: LinearIssue = {
      id: `STE-${this.seq}`,
      identifier: `STE-${this.seq}`,
      labels: [],
      projectMilestone: null,
      project: "DPT",
      team: "STE",
      ...i,
    };
    this.issues.push(issue);
    return issue;
  }

  list(args: Record<string, any>) {
    // The real schema has `additionalProperties: false` and no such inputs.
    if ("projectMilestone" in args) throw new Error("list_issues: unknown input projectMilestone");
    if ("query" in args) throw new Error("list_issues: `query` is ranked relevance, never a filter");
    const hits = this.issues.filter((i) => {
      if (args.team !== undefined && i.team !== args.team) return false;
      if (args.project !== undefined && i.project !== args.project) return false;
      if (args.label !== undefined && !i.labels.includes(args.label)) return false;
      return true;
    });
    return { issues: hits, pageInfo: { hasNextPage: this.capped, endCursor: null } };
  }

  createFrom(payload: Record<string, any>, title: string): LinearIssue {
    this.creates += 1;
    return this.add({
      title: typeof payload.title === "string" ? payload.title : title,
      labels: Array.isArray(payload.labels) ? [...payload.labels] : [],
      projectMilestone:
        typeof payload.milestone === "string"
          ? { id: payload.milestone, name: "M_3fa85f — Shared container" }
          : null,
    });
  }

  createBare(title: string, labels: string[] = []): LinearIssue {
    this.creates += 1;
    return this.add({ title, labels });
  }
}

// ---------------------------------------------------------- one probe round

function jiraRound(
  root: string,
  jira: MemJira,
  title: string,
  c: Container,
  attempt: "fast" | "retry-1" | "retry-2" | "retry-3",
): { decision: Record<string, any>; run: Run } {
  const q = query(root, title, c);
  expect(q.code, `query failed: ${q.stderr}`).toBe(0);
  const page = jira.search(jsonLine(q).jql);
  const run = decide(root, [writePage(page)], title, c, attempt);
  return { decision: jsonLine(run), run };
}

function linearRound(
  root: string,
  linear: MemLinear,
  title: string,
  c: Container,
  attempt: "fast" | "retry-1" | "retry-2" | "retry-3",
): { decision: Record<string, any>; run: Run } {
  const q = query(root, title, c);
  expect(q.code, `query failed: ${q.stderr}`).toBe(0);
  const page = linear.list(jsonLine(q));
  const run = decide(root, [writePage(page)], title, c, attempt);
  return { decision: jsonLine(run), run };
}

/**
 * The retry path after a timed-out create: probe on retry-1..3, stop on the
 * first reuse or refusal, create on a `create` decision.
 */
function retryAfterTimeout(
  round: (a: "retry-1" | "retry-2" | "retry-3") => Record<string, any>,
  create: (payload: Record<string, any>) => void,
): Record<string, any> {
  let last: Record<string, any> = {};
  for (const a of ["retry-1", "retry-2", "retry-3"] as const) {
    last = round(a);
    if (last.outcome === "create") {
      create(last.createPayload);
      return last;
    }
    if (last.outcome === "reused" || last.outcome === "refused") return last;
  }
  return last;
}

// ---------------------------------------------- pre-change bytes, extracted

/** Extract `repoRelPath` and every relative import it reaches at `sha` into `dest`. */
function extractAt(sha: string, repoRelPath: string, dest: string, seen = new Set<string>()): string {
  const out = join(dest, repoRelPath);
  if (seen.has(repoRelPath)) return out;
  seen.add(repoRelPath);
  const proc = Bun.spawnSync(["git", "show", `${sha}:${repoRelPath}`], { cwd: repoRoot });
  if (proc.exitCode !== 0) {
    throw new Error(`git show ${sha}:${repoRelPath} failed: ${proc.stderr.toString()}`);
  }
  const body = proc.stdout.toString();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  for (const m of body.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    let dep = join(dirname(repoRelPath), m[1]!);
    if (!dep.endsWith(".ts")) dep += ".ts";
    extractAt(sha, dep, dest, seen);
  }
  return out;
}

const PROBE_REL = "plugins/dev-process-toolkit/adapters/_shared/src/create_idempotency_probe.ts";
const ATTACH_REL = "plugins/dev-process-toolkit/adapters/_shared/src/attach_project_milestone.ts";

// ===========================================================================
// AC-STE-604.1 — `query` reads the tag from the binding, never from the model.
// ===========================================================================

describe("AC-STE-604.1 — query builds from the binding", () => {
  test("a fixture declaring glacy-be yields labels = \"glacy-be\" with no tag argument", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const run = query(b, TITLE, PARENT);
      expect(run.code, run.stderr).toBe(0);
      const out = jsonLine(run);
      expect(out.jql).toContain('labels = "glacy-be"');
      expect(out.jql).toContain("project = GF");
      expect(out.jql).toContain(`parent = ${EPIC}`);
      expect(out.jql).toContain("issuetype != Epic");
      expect(out.jql).toContain("summary ~ ");
      expect(out.jql).not.toContain("summary = ");
      expect([...out.fields].sort()).toEqual(
        ["issuetype", "labels", "parent", "project", "summary"].sort(),
      );
    });
  });

  test("an undeclared fixture yields no tag conjunct — but still the issue-type conjunct", () => {
    withRoots((a) => {
      declareJira(a, null);
      const run = query(a, TITLE, PARENT);
      expect(run.code, run.stderr).toBe(0);
      const jql = jsonLine(run).jql as string;
      expect(jql).not.toContain("labels = ");
      expect(jql).toContain("issuetype != Epic");
      expect(jql).toContain(`parent = ${EPIC}`);
    });
  });

  test("a numeric container adds its milestone label conjunct", () => {
    withRoots((a) => {
      declareJira(a, null);
      const jql = jsonLine(query(a, TITLE, NUMERIC)).jql as string;
      expect(jql).toContain('labels = "milestone-M46"');
      expect(jql).not.toContain("parent = ");
    });
  });

  test("the model cannot supply the tag: a tag argument never reaches the JQL", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      for (const flag of ["--tag", "--repo-tag"]) {
        const run = query(b, TITLE, PARENT, [flag, "glacy-fe"]);
        expect(
          run.stdout.includes("glacy-fe"),
          `${flag} glacy-fe must be refused or ignored — the binding owns the tag`,
        ).toBe(false);
      }
    });
  });

  test("a title carrying both `\"` and `\\` produces a phrase that unescapes to the original", () => {
    withRoots((a) => {
      declareJira(a, null);
      const title = 'Say "hi" to C:\\temp now';
      const run = query(a, title, PARENT);
      expect(run.code, run.stderr).toBe(0);
      const jql = jsonLine(run).jql as string;
      // The live 400: a raw quote ends the literal early. The summary literal
      // must parse and run to the end of the query.
      const parsed = parseJql(jql);
      expect(parsed.summaryEnd).toBe(jql.length);
      const phrase = parsed.phrase!;
      expect(phrase === title || unescapeOnce(phrase) === title).toBe(true);
    });
  });

  test("a declared but unforwarded tag refuses with RepoTagBindingError", () => {
    withRoots((_a, b) => {
      claudeMd(b, {
        mode: "jira",
        project: "GF",
        defaultLabels: ["spec"],
        repoTag: "glacy-be",
        minDptVersion: "2.87.0",
      });
      const run = query(b, TITLE, PARENT);
      expect(run.code).not.toBe(0);
      expect(run.stderr).toContain("RepoTagBindingError");
      expect(run.stdout).not.toContain("jql");
    });
  });

  test("a failed version floor refuses", () => {
    withRoots((_a, b) => {
      claudeMd(b, {
        mode: "jira",
        project: "GF",
        defaultLabels: ["glacy-be"],
        repoTag: "glacy-be",
        minDptVersion: "2.90.0",
      });
      const run = query(b, TITLE, PARENT);
      expect(run.code).not.toBe(0);
      expect(run.stderr).toMatch(/min_dpt_version|2\.90\.0/);
      expect(run.stdout).not.toContain("jql");
    });
  });

  test("Linear: the list_issues arguments never carry `query` or `projectMilestone`", () => {
    withRoots((_a, b) => {
      declareLinear(b, "glacy-be");
      const run = query(b, TITLE, LINEAR_MS);
      expect(run.code, run.stderr).toBe(0);
      const args = jsonLine(run);
      expect(Object.keys(args)).not.toContain("query");
      expect(Object.keys(args)).not.toContain("projectMilestone");
      expect(args.team).toBe("STE");
      expect(args.project).toBe("DPT");
      expect(args.label).toBe("glacy-be");
      expect(args.limit).toBe(250);
      expect([...args.fields].sort()).toEqual(
        ["labels", "project", "projectMilestone", "team", "title"].sort(),
      );
    });
  });

  test("Linear undeclared: no label argument", () => {
    withRoots((a) => {
      declareLinear(a, null);
      const args = jsonLine(query(a, TITLE, LINEAR_MS));
      expect("label" in args).toBe(false);
      expect(Object.keys(args)).not.toContain("query");
      expect(Object.keys(args)).not.toContain("projectMilestone");
    });
  });

  test("relocated: a worktree's own tag is used, and decide writes under the worktree root", () => {
    const base = mkdtempSync(join(tmpdir(), "dpt-ste604-wt-"));
    try {
      const main = join(base, "main");
      const wt = join(base, "wt");
      mkdirSync(main, { recursive: true });
      declareJira(main, "glacy-fe");
      const git = (cwd: string, ...args: string[]) => {
        const p = Bun.spawnSync(
          ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
          { cwd },
        );
        expect(p.exitCode, p.stderr.toString()).toBe(0);
      };
      git(main, "init", "-q");
      git(main, "add", "CLAUDE.md");
      git(main, "commit", "-q", "-m", "init");
      git(main, "worktree", "add", "-q", "-b", "wt-branch", wt);
      declareJira(wt, "glacy-be");

      const q = query(wt, TITLE, PARENT);
      expect(q.code, q.stderr).toBe(0);
      const jql = jsonLine(q).jql as string;
      expect(jql).toContain('labels = "glacy-be"');
      expect(jql).not.toContain("glacy-fe");

      const run = decide(wt, [writePage({ issues: [], isLast: true })], TITLE, PARENT, "fast");
      expect(jsonLine(run).outcome).toBe("create");
      const announced = receiptAnnouncements(run);
      expect(announced).toHaveLength(1);
      expect(realpathSync(announced[0]!).startsWith(realpathSync(wt) + "/")).toBe(true);
      expect(existsSync(join(main, ".dpt"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-604.2 — decide FORBIDS: a page that violates the query is refused.
// ===========================================================================

describe("AC-STE-604.2 — decide forbids over a two-repo shared Epic", () => {
  function beDecision(page: unknown): Record<string, any> {
    return withRoots((a, b) => {
      declareJira(a, "glacy-fe");
      declareJira(b, "glacy-be");
      return jsonLine(decide(b, [writePage(page)], TITLE, PARENT, "fast"));
    });
  }

  test("FE's same-titled ticket tagged glacy-fe on BE's page is page-violates-query, zero creates", () => {
    const d = beDecision(jiraPage([{ labels: ["glacy-fe"] }]));
    expect(d.outcome).toBe("refused");
    expect(d.reason).toBe("page-violates-query");
    expect(d.capability).toBe(UNCERTAIN);
    expect(d.createPayload).toBeUndefined();
  });

  test("the same ticket UNTAGGED is refused the same way", () => {
    const d = beDecision(jiraPage([{ labels: [] }]));
    expect(d.outcome).toBe("refused");
    expect(d.reason).toBe("page-violates-query");
    expect(d.capability).toBe(UNCERTAIN);
  });

  test("a same-titled Epic on the page is refused by the issue-type conjunct", () => {
    const d = beDecision(jiraPage([{ labels: ["glacy-be"], issuetype: "Epic" }]));
    expect(d.outcome).toBe("refused");
    expect(d.reason).toBe("page-violates-query");
    expect(d.capability).toBe(UNCERTAIN);
  });

  test("a candidate from another project or another parent is refused", () => {
    for (const bad of [{ project: "GB" }, { parent: "GF-41" }] as Partial<JiraTicket>[]) {
      const d = beDecision(jiraPage([{ labels: ["glacy-be"], ...bad }]));
      expect(d.outcome, JSON.stringify(bad)).toBe("refused");
      expect(d.reason, JSON.stringify(bad)).toBe("page-violates-query");
    }
  });

  test("Linear: a differently-tagged candidate on a label-filtered page is refused", () => {
    withRoots((_a, b) => {
      declareLinear(b, "glacy-be");
      const page = {
        issues: [
          {
            id: "STE-990",
            identifier: "STE-990",
            title: TITLE,
            labels: ["glacy-fe"],
            projectMilestone: { id: LINEAR_MS_ID, name: "M" },
            project: "DPT",
            team: "STE",
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      const d = jsonLine(decide(b, [writePage(page)], TITLE, LINEAR_MS, "fast"));
      expect(d.outcome).toBe("refused");
      expect(d.reason).toBe("page-violates-query");
      expect(d.capability).toBe(UNCERTAIN);
    });
  });
});

// ===========================================================================
// AC-STE-604.3 — decide PERMITS: the join path and the proven-absent create.
// ===========================================================================

describe("AC-STE-604.3 — decide permits, and records what it decided", () => {
  test("BE's own tagged ticket under the shared Epic is reused, and a reuse receipt names it", () => {
    withRoots((a, b) => {
      declareJira(a, "glacy-fe");
      declareJira(b, "glacy-be");
      const jira = new MemJira();
      jira.add({ summary: TITLE, labels: ["glacy-fe"], parent: EPIC }); // FE's
      const mine = jira.add({ summary: TITLE, labels: ["glacy-be"], parent: EPIC });
      const { decision, run } = jiraRound(b, jira, TITLE, PARENT, "fast");
      expect(decision.outcome).toBe("reused");
      expect(decision.key).toBe(mine.key);
      expect(jira.creates).toBe(0);

      const announced = receiptAnnouncements(run);
      expect(announced).toHaveLength(1);
      expect(isAbsolute(announced[0]!)).toBe(true);
      expect(existsSync(announced[0]!)).toBe(true);
      const { receipts } = readSessionReceipts(b, SESSION);
      const reuse = receipts.filter((r) => r.kind === "reuse");
      expect(reuse).toHaveLength(1);
      expect(JSON.stringify(reuse[0])).toContain(mine.key);
    });
  });

  test("a query-honouring page with no match yields create, and a create receipt holding the payload", () => {
    withRoots((a, b) => {
      declareJira(a, "glacy-fe");
      declareJira(b, "glacy-be");
      const jira = new MemJira();
      jira.add({ summary: "Something else entirely", labels: ["glacy-be"], parent: EPIC });
      const { decision, run } = jiraRound(b, jira, TITLE, PARENT, "fast");
      expect(decision.outcome).toBe("create");
      expect(decision.createPayload.parent).toBe(EPIC);
      expect(decision.createPayload.labels).toContain("glacy-be");

      expect(receiptAnnouncements(run)).toHaveLength(1);
      const { receipts } = readSessionReceipts(b, SESSION);
      const create = receipts.filter((r) => r.kind === "create");
      expect(create).toHaveLength(1);
      const body = JSON.stringify(create[0]);
      expect(body).toContain(EPIC);
      expect(body).toContain("glacy-be");
    });
  });

  test("an empty complete page is proven-absent, then create", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const d = jsonLine(decide(b, [writePage({ issues: [], isLast: true })], TITLE, PARENT, "fast"));
      expect(d.outcome).toBe("create");
      expect(d.reason).toBe("proven-absent");
      expect(d.createPayload.parent).toBe(EPIC);
    });
  });

  test("a numeric container's createPayload carries its milestone label", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const d = jsonLine(decide(b, [writePage({ issues: [], isLast: true })], TITLE, NUMERIC, "fast"));
      expect(d.outcome).toBe("create");
      expect(d.createPayload.labels).toContain("milestone-M46");
      expect(d.createPayload.labels).toContain("glacy-be");
    });
  });

  test("Linear: createPayload sets the milestone and forwards the tag", () => {
    withRoots((_a, b) => {
      declareLinear(b, "glacy-be");
      const page = { issues: [], pageInfo: { hasNextPage: false, endCursor: null } };
      const d = jsonLine(decide(b, [writePage(page)], TITLE, LINEAR_MS, "fast"));
      expect(d.outcome).toBe("create");
      expect(d.createPayload.milestone).toBe(LINEAR_MS_ID);
      expect(d.createPayload.labels).toContain("glacy-be");
    });
  });

  test("an undeclared repository gets the decision and no file: its tree stays byte-identical", () => {
    withRoots((a) => {
      declareJira(a, null);
      const before = snapshotTree(a);
      const run = decide(a, [writePage({ issues: [], isLast: true })], TITLE, PARENT, "fast");
      expect(jsonLine(run).outcome).toBe("create");
      expect(receiptAnnouncements(run)).toEqual([]);
      expect(existsSync(join(a, ".dpt"))).toBe(false);
      expect(snapshotTree(a)).toEqual(before);
    });
  });
});

// ===========================================================================
// AC-STE-604.4 — a timed-out create's own retry finds its ticket.
// ===========================================================================

describe("AC-STE-604.4 — own-ticket retry: the create carries its container", () => {
  for (const [label, c] of [
    ["Epic parent", PARENT],
    ["numeric milestone label", NUMERIC],
  ] as const) {
    for (const tag of [null, "glacy-be"] as const) {
      test(`Jira ${label} (${tag ?? "undeclared"}): created from createPayload, found by retry-1 — one create`, () => {
        withRoots((_a, b) => {
          declareJira(b, tag);
          const jira = new MemJira();
          const fast = jiraRound(b, jira, TITLE, c, "fast").decision;
          expect(fast.outcome).toBe("create");
          jira.createFrom(fast.createPayload, TITLE); // ...and the response times out
          const retry = jiraRound(b, jira, TITLE, c, "retry-1").decision;
          expect(retry.outcome).toBe("reused");
          expect(retry.key).toBe(jira.tickets[0]!.key);
          expect(jira.creates).toBe(1);
        });
      });
    }

    test(`Jira ${label} CONTROL: the pre-change create (no container) is missed and created again`, () => {
      withRoots((a) => {
        declareJira(a, null);
        const jira = new MemJira();
        jira.createBare(TITLE); // as the pre-change prose issued it; the response times out
        const last = retryAfterTimeout(
          (att) => jiraRound(a, jira, TITLE, c, att).decision,
          (p) => jira.createFrom(p, TITLE),
        );
        expect(last.outcome).toBe("create");
        expect(jira.creates).toBe(2);
      });
    });
  }

  test("Linear milestone: created from createPayload, found by retry-1 — one create", () => {
    withRoots((a) => {
      declareLinear(a, null);
      const linear = new MemLinear();
      const fast = linearRound(a, linear, TITLE, LINEAR_MS, "fast").decision;
      expect(fast.outcome).toBe("create");
      linear.createFrom(fast.createPayload, TITLE);
      const retry = linearRound(a, linear, TITLE, LINEAR_MS, "retry-1").decision;
      expect(retry.outcome).toBe("reused");
      expect(retry.key).toBe(linear.issues[0]!.identifier);
      expect(linear.creates).toBe(1);
    });
  });

  test("Linear milestone CONTROL: the pre-change create (no milestone) is missed and created again", () => {
    withRoots((a) => {
      declareLinear(a, null);
      const linear = new MemLinear();
      linear.createBare(TITLE);
      const last = retryAfterTimeout(
        (att) => linearRound(a, linear, TITLE, LINEAR_MS, att).decision,
        (p) => linear.createFrom(p, TITLE),
      );
      expect(last.outcome).toBe("create");
      expect(linear.creates).toBe(2);
    });
  });
});

// ===========================================================================
// AC-STE-604.5 — cap, fall-through, and one decision on two surfaces.
// ===========================================================================

describe("AC-STE-604.5 — page cap and the retry-3 fall-through", () => {
  for (const tag of [null, "glacy-be"] as const) {
    test(`Jira (${tag ?? "undeclared"}): a last page reporting more results, no match, is page-cap`, () => {
      withRoots((_a, b) => {
        declareJira(b, tag);
        const other = { summary: "Something else", labels: tag ? [tag] : [] };
        const d = jsonLine(
          decide(b, [writePage(jiraPage([other], false))], TITLE, PARENT, "fast"),
        );
        expect(d.outcome).toBe("refused");
        expect(d.reason).toBe("page-cap");
        expect(d.capability).toBe(UNCERTAIN);
      });
    });

    test(`Linear (${tag ?? "undeclared"}): hasNextPage: true on the last page, no match, is page-cap`, () => {
      withRoots((_a, b) => {
        declareLinear(b, tag);
        const first = { issues: [], pageInfo: { hasNextPage: true, endCursor: "c1" } };
        const last = { issues: [], pageInfo: { hasNextPage: true, endCursor: "c2" } };
        const d = jsonLine(
          decide(b, [writePage(first), writePage(last)], TITLE, LINEAR_MS, "retry-3"),
        );
        expect(d.outcome).toBe("refused");
        expect(d.reason).toBe("page-cap");
        expect(d.capability).toBe(UNCERTAIN);
      });
    });
  }

  test("Linear: a match on an earlier page of a cursor-ordered set is still found", () => {
    withRoots((_a, b) => {
      declareLinear(b, "glacy-be");
      const hit = {
        id: "STE-977",
        identifier: "STE-977",
        title: TITLE,
        labels: ["glacy-be"],
        projectMilestone: { id: LINEAR_MS_ID, name: "M" },
        project: "DPT",
        team: "STE",
      };
      const first = { issues: [hit], pageInfo: { hasNextPage: true, endCursor: "c1" } };
      const last = { issues: [], pageInfo: { hasNextPage: false, endCursor: null } };
      const d = jsonLine(decide(b, [writePage(first), writePage(last)], TITLE, LINEAR_MS, "fast"));
      expect(d.outcome).toBe("reused");
      expect(d.key).toBe("STE-977");
    });
  });

  test("retry-3 uncapped miss REFUSES when shared", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const d = jsonLine(decide(b, [writePage({ issues: [], isLast: true })], TITLE, PARENT, "retry-3"));
      expect(d.outcome).toBe("refused");
      expect(d.reason).toBe("retry-miss-shared");
      expect(d.capability).toBe(UNCERTAIN);
      expect(d.createPayload).toBeUndefined();
    });
  });

  test("retry-3 uncapped miss CREATES with the warning when undeclared", () => {
    withRoots((a) => {
      declareJira(a, null);
      const d = jsonLine(decide(a, [writePage({ issues: [], isLast: true })], TITLE, PARENT, "retry-3"));
      expect(d.outcome).toBe("create");
      expect(d.capability).toBe(UNCERTAIN);
      expect(d.createPayload.parent).toBe(EPIC);
    });
  });
});

describe("AC-STE-604.5 — runCreateIdempotencyProbe and the command decide alike", () => {
  type Attempt = "fast" | "retry-1" | "retry-2" | "retry-3";
  interface Row {
    name: string;
    tag: string | null;
    page: { issues: any[]; isLast: boolean };
    attempt: Attempt;
    title?: string;
  }
  const own = { labels: ["glacy-be"] };
  const rows: Row[] = [
    { name: "shared own match", tag: "glacy-be", page: jiraPage([own]), attempt: "fast" },
    { name: "shared drifted own match", tag: "glacy-be", page: jiraPage([{ ...own, summary: "The reward banner – repainted light  " }]), attempt: "fast" },
    { name: "shared capped page carrying the match", tag: "glacy-be", page: jiraPage([own], false), attempt: "fast" },
    { name: "shared foreign-tag row", tag: "glacy-be", page: jiraPage([{ labels: ["glacy-fe"] }]), attempt: "fast" },
    { name: "shared untagged row", tag: "glacy-be", page: jiraPage([{ labels: [] }]), attempt: "fast" },
    { name: "shared Epic row", tag: "glacy-be", page: jiraPage([{ ...own, issuetype: "Epic" }]), attempt: "fast" },
    { name: "shared other-project row", tag: "glacy-be", page: jiraPage([{ ...own, project: "GB" }]), attempt: "fast" },
    { name: "shared other-parent row", tag: "glacy-be", page: jiraPage([{ ...own, parent: "GF-41" }]), attempt: "fast" },
    { name: "shared uncapped miss, fast", tag: "glacy-be", page: jiraPage([{ ...own, summary: "Other" }]), attempt: "fast" },
    { name: "shared empty page, fast", tag: "glacy-be", page: { issues: [], isLast: true }, attempt: "fast" },
    { name: "shared capped miss", tag: "glacy-be", page: jiraPage([{ ...own, summary: "Other" }], false), attempt: "fast" },
    { name: "shared uncapped miss, retry-1", tag: "glacy-be", page: { issues: [], isLast: true }, attempt: "retry-1" },
    { name: "shared uncapped miss, retry-3", tag: "glacy-be", page: { issues: [], isLast: true }, attempt: "retry-3" },
    { name: "undeclared foreign-labelled match", tag: null, page: jiraPage([{ labels: ["glacy-fe"] }]), attempt: "fast" },
    { name: "undeclared Epic row", tag: null, page: jiraPage([{ issuetype: "Epic" }]), attempt: "fast" },
    { name: "undeclared capped miss", tag: null, page: jiraPage([{ summary: "Other" }], false), attempt: "fast" },
    { name: "undeclared uncapped miss, fast", tag: null, page: { issues: [], isLast: true }, attempt: "fast" },
    { name: "undeclared uncapped miss, retry-1", tag: null, page: { issues: [], isLast: true }, attempt: "retry-1" },
    { name: "undeclared uncapped miss, retry-3", tag: null, page: { issues: [], isLast: true }, attempt: "retry-3" },
  ];

  function comparable(o: Record<string, any>, surface: "api" | "cmd") {
    const kind = surface === "api" ? o.kind : o.outcome;
    const outcome = kind === "created" ? "create" : kind;
    return {
      outcome,
      reason: outcome === "refused" ? o.reason : undefined,
      capability: o.capability ?? null,
      key: outcome === "reused" ? (surface === "api" ? o.id : o.key) : undefined,
    };
  }

  for (const row of rows) {
    test(`parity: ${row.name}`, async () => {
      const mod = (await import(MODULE)) as any;
      const title = row.title ?? TITLE;
      const cmd = withRoots((_a, b) => {
        declareJira(b, row.tag);
        return jsonLine(decide(b, [writePage(row.page)], title, PARENT, row.attempt));
      });
      const creates: unknown[] = [];
      const api = await mod.runCreateIdempotencyProbe(
        {
          projectKey: "GF",
          title,
          parentKey: EPIC,
          ...(row.tag ? { repoTag: row.tag, defaultLabels: [row.tag] } : {}),
          attempt: row.attempt,
        },
        {
          async search() {
            return {
              candidates: row.page.issues.map((i: any) => ({
                id: i.key,
                title: i.fields.summary,
                labels: i.fields.labels,
                project: i.fields.project?.key,
                parent: i.fields.parent?.key ?? null,
                issuetype: i.fields.issuetype?.name,
              })),
              capped: !row.page.isLast,
            };
          },
          async create(p: unknown) {
            creates.push(p);
            return { id: "GF-FRESH" };
          },
        },
      );
      expect(comparable(api, "api")).toEqual(comparable(cmd, "cmd"));
      expect(creates.length).toBe(cmd.outcome === "create" ? 1 : 0);
    });
  }
});

// ===========================================================================
// AC-STE-604.6 — unreadable input is a refusal, never "no match".
// ===========================================================================

describe("AC-STE-604.6 — unreadable input refuses", () => {
  function expectRefusal(d: Record<string, any>) {
    expect(d.outcome).toBe("refused");
    expect(d.capability).toBe(UNCERTAIN);
    expect(d.createPayload).toBeUndefined();
  }

  test("a missing page file", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      expectRefusal(jsonLine(decide(b, [join(scratch, "no-such-page.json")], TITLE, PARENT, "fast")));
    });
  });

  test("a non-JSON page", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const p = join(scratch, "garbage.json");
      writeFileSync(p, "<html>504 Gateway Timeout</html>");
      expectRefusal(jsonLine(decide(b, [p], TITLE, PARENT, "fast")));
    });
  });

  test("a shared-mode candidate without `labels`", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const page = jiraPage([{ labels: ["glacy-be"] }]);
      delete (page.issues[0] as any).fields.labels;
      expectRefusal(jsonLine(decide(b, [writePage(page)], TITLE, PARENT, "fast")));
    });
  });

  test("a Linear page without `pageInfo`", () => {
    withRoots((_a, b) => {
      declareLinear(b, "glacy-be");
      expectRefusal(jsonLine(decide(b, [writePage({ issues: [] })], TITLE, LINEAR_MS, "fast")));
    });
  });

  // Stage C hardening (AUDIT advisory): the team conjunct must be checkable
  // on every row. A row without `team` used to SKIP that conjunct — a sibling
  // team's same-titled issue would have been reused. Control: the same row
  // carrying this repository's team is reused.
  test("a Linear candidate without `team` refuses; the same row with its team is reused (control)", () => {
    withRoots((_a, b) => {
      declareLinear(b, "glacy-be");
      const row = {
        id: "STE-976",
        identifier: "STE-976",
        title: TITLE,
        labels: ["glacy-be"],
        projectMilestone: { id: LINEAR_MS_ID, name: "M" },
        project: "DPT",
      };
      const page = (issue: object) => ({ issues: [issue], pageInfo: { hasNextPage: false, endCursor: null } });
      expectRefusal(jsonLine(decide(b, [writePage(page(row))], TITLE, LINEAR_MS, "fast")));
      const ok = jsonLine(decide(b, [writePage(page({ ...row, team: "STE" }))], TITLE, LINEAR_MS, "fast"));
      expect(ok.outcome).toBe("reused");
      expect(ok.key).toBe("STE-976");
    });
  });
});

// ===========================================================================
// AC-STE-604.7 — undeclared repositories decide as the pre-change module did,
//                except on the named rows.
// ===========================================================================

describe("AC-STE-604.7 — undeclared parity with the pre-change module", () => {
  let oldDir = "";
  let old: any;

  beforeAll(async () => {
    oldDir = mkdtempSync(join(tmpdir(), "dpt-ste604-old-"));
    old = await import(extractAt(PRE_CHANGE_SHA, PROBE_REL, oldDir));
  });
  afterAll(() => rmSync(oldDir, { recursive: true, force: true }));

  interface Scenario {
    name: string;
    title?: string;
    container: Container;
    seed: (j: MemJira) => void;
    capped?: boolean;
    attempt?: "fast" | "retry-3";
    /** The named difference, when the decisions are allowed to differ. */
    differs?: { because: string; old: string; now: string };
    /** A conjunct-ignoring search: every ticket with the title, anywhere. */
    ignoresConjuncts?: boolean;
  }

  const scenarios: Scenario[] = [
    { name: "own match in the Epic", container: PARENT, seed: (j) => void j.add({ summary: TITLE, parent: EPIC }) },
    { name: "no match", container: PARENT, seed: (j) => void j.add({ summary: "Other", parent: EPIC }) },
    { name: "empty tracker", container: PARENT, seed: () => {} },
    { name: "drifted title", container: PARENT, seed: (j) => void j.add({ summary: "The reward banner – repainted light", parent: EPIC }) },
    { name: "capped miss", container: PARENT, capped: true, seed: (j) => void j.add({ summary: "Other", parent: EPIC }) },
    { name: "foreign-labelled match", container: PARENT, seed: (j) => void j.add({ summary: TITLE, parent: EPIC, labels: ["glacy-be"] }) },
    { name: "numeric container match", container: NUMERIC, seed: (j) => void j.add({ summary: TITLE, labels: ["milestone-M46"] }) },
    { name: "retry-3 uncapped miss", container: PARENT, attempt: "retry-3", seed: () => {} },
    {
      name: "same-titled Epic in the container",
      container: PARENT,
      seed: (j) => void j.add({ summary: TITLE, parent: EPIC, issuetype: "Epic" }),
      differs: { because: "the issue-type conjunct", old: "reused", now: "create" },
    },
    {
      name: "a title carrying a double quote",
      title: 'The "reward" banner',
      container: PARENT,
      seed: () => {},
      differs: { because: "the escaping", old: "error", now: "create" },
    },
    {
      name: "a conjunct-violating candidate (another project)",
      container: PARENT,
      ignoresConjuncts: true,
      seed: (j) => void j.add({ summary: TITLE, parent: EPIC, project: "GB" }),
      differs: { because: "a conjunct-violating candidate", old: "reused", now: "refused" },
    },
  ];

  for (const s of scenarios) {
    test(`${s.differs ? `NAMED DIFFERENCE (${s.differs.because})` : "equal"}: ${s.name}`, async () => {
      const title = s.title ?? TITLE;
      const container = s.container;

      // The pre-change module, over the same in-memory tracker.
      const oldJira = new MemJira();
      oldJira.capped = s.capped ?? false;
      s.seed(oldJira);
      let oldOutcome: string;
      try {
        const o = await old.runCreateIdempotencyProbe(
          {
            projectKey: "GF",
            title,
            ...("parent" in container ? { parentKey: container.parent } : {}),
            ...("milestoneLabel" in container ? { milestoneLabel: container.milestoneLabel } : {}),
          },
          {
            async search(params: any) {
              const page = s.ignoresConjuncts
                ? { issues: oldJira.tickets.filter((t) => t.summary === title).map(jiraRow), isLast: !oldJira.capped }
                : oldJira.search(old.buildIdempotencyJql(params));
              return {
                candidates: page.issues.map((i: any) => ({
                  id: i.key,
                  title: i.fields.summary,
                  labels: i.fields.labels,
                })),
                capped: !page.isLast,
              };
            },
            async create() {
              oldJira.creates += 1;
              return { id: "GF-FRESH" };
            },
          },
        );
        oldOutcome = o.kind === "created" ? "create" : o.kind;
      } catch {
        oldOutcome = "error";
      }

      // The command, in an undeclared fixture.
      const nowOutcome = withRoots((a) => {
        declareJira(a, null);
        const before = snapshotTree(a);
        const jira = new MemJira();
        jira.capped = s.capped ?? false;
        s.seed(jira);
        const q = query(a, title, container);
        expect(q.code, q.stderr).toBe(0);
        const page = s.ignoresConjuncts
          ? { issues: jira.tickets.filter((t) => t.summary === title).map(jiraRow), isLast: true }
          : jira.search(jsonLine(q).jql);
        const run = decide(a, [writePage(page)], title, container, s.attempt ?? "fast");
        const d = jsonLine(run);
        expect(receiptAnnouncements(run)).toEqual([]);
        expect(existsSync(join(a, ".dpt")), "no file appears under .dpt/").toBe(false);
        expect(snapshotTree(a)).toEqual(before);
        return d.outcome as string;
      });

      if (s.differs) {
        expect(oldOutcome, `pre-change decision on "${s.name}"`).toBe(s.differs.old);
        expect(nowOutcome, `post-change decision on "${s.name}"`).toBe(s.differs.now);
      } else {
        expect(nowOutcome).toBe(oldOutcome);
      }
    });
  }
});

// ===========================================================================
// AC-STE-604.8 — the prose runs the code; the pinned files stay pinned.
// ===========================================================================

function upsertSection(body: string): string {
  const start = body.indexOf("### `upsert_ticket_metadata");
  expect(start).toBeGreaterThan(-1);
  return body.slice(start);
}

/** Index just past the ordered sequence, or -1 when any step is missing. */
function orderedFrom(text: string, from: number, steps: RegExp[]): number {
  let at = from;
  for (const re of steps) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    g.lastIndex = at;
    const m = g.exec(text);
    if (!m) return -1;
    at = m.index + m[0].length;
  }
  return at;
}

const QUERY_CMD = /create_idempotency_probe\.ts query\b|`query` (?:sub)?command|the `query` step/;
const DECIDE_CMD = /create_idempotency_probe\.ts decide\b|`decide` (?:sub)?command|`decide --attempt/;
const CREATE_PAYLOAD = /createPayload/;

describe("AC-STE-604.8 — the adapters order query, search, decide, create", () => {
  for (const [label, path, search, create] of [
    ["jira.md", JIRA_ADAPTER, /mcp__atlassian__searchJiraIssuesUsingJql/, /mcp__atlassian__createJiraIssue/],
    ["linear.md", LINEAR_ADAPTER, /mcp__linear__list_issues/, /mcp__linear__save_issue/],
  ] as const) {
    test(`${label}: the fast path orders query -> search -> decide -> create with createPayload`, () => {
      const section = upsertSection(read(path));
      const end = orderedFrom(section, 0, [QUERY_CMD, search, DECIDE_CMD, /--attempt fast/, create]);
      expect(end, `${label} fast path must order query, search, decide --attempt fast, then the create`).toBeGreaterThan(-1);
      expect(section).toMatch(CREATE_PAYLOAD);
    });

    test(`${label}: every retry attempt re-runs query -> search -> decide --attempt retry-<N> -> create`, () => {
      const section = upsertSection(read(path));
      const fastEnd = orderedFrom(section, 0, [QUERY_CMD, search, DECIDE_CMD, /--attempt fast/, create]);
      expect(fastEnd).toBeGreaterThan(-1);
      const retryEnd = orderedFrom(section, fastEnd, [
        QUERY_CMD,
        search,
        DECIDE_CMD,
        /--attempt retry-/,
        CREATE_PAYLOAD,
      ]);
      expect(retryEnd, `${label}: the retry path must restate the order after the fast-path create`).toBeGreaterThan(-1);
      const everyAttempt =
        /retry-<N>/.test(section) ||
        (/retry-1\b/.test(section) && /retry-2\b/.test(section) && /retry-3\b/.test(section));
      expect(everyAttempt, `${label}: each of the three retry attempts runs decide`).toBe(true);
    });

    test(`${label}: no longer says that nothing grades the agreement`, () => {
      expect(read(path)).not.toMatch(/nothing grades the[\s>]+agreement/i);
    });
  }

  test("linear.md names no `projectMilestone` input and no undefined \"documented cap\"", () => {
    const body = read(LINEAR_ADAPTER);
    expect(body).not.toMatch(/`projectMilestone`\s*—/);
    expect(body).not.toMatch(/projectMilestone=/);
    expect(body).not.toContain("documented cap");
  });

  test("linear.md defines its cap as hasNextPage: true after cursor pagination", () => {
    const section = upsertSection(read(LINEAR_ADAPTER));
    expect(section).toMatch(/cap[\s\S]{0,300}hasNextPage: true|hasNextPage: true[\s\S]{0,300}cap/);
    expect(section).toMatch(/cursor/i);
  });

  test("linear.md orders a shared-mode fast path", () => {
    const section = upsertSection(read(LINEAR_ADAPTER));
    expect(section).toMatch(/--attempt fast/);
    expect(section).toContain("repo_tag");
  });
});

describe("AC-STE-604.8 — spec-write/SKILL.md and the pins stay where they are", () => {
  const steTokens = (s: string) => (s.match(/STE-\d+/g) ?? []).length;

  test("SKILL.md measures 358 split-lines and 54 STE tokens", () => {
    const body = read(SPEC_WRITE_SKILL);
    expect(body.split("\n").length).toBe(358);
    expect(steTokens(body)).toBe(54);
  });

  test("step 4 (line 109 in place) carries the six tokens; line 109 one MUST emit for the key, no module path", () => {
    const body = read(SPEC_WRITE_SKILL);
    // Step 4 sliced exactly as the sibling suite slices it: `\n4. ` .. `\n5. `.
    const start = body.indexOf("\n4. ");
    expect(start).toBeGreaterThan(-1);
    const tail = body.slice(start + 1);
    const endRel = tail.search(/\n5\. /);
    const step4 = endRel === -1 ? body.slice(start) : body.slice(start, start + 1 + endRel);
    expect(step4).toMatch(/Provider\.sync\(spec\)/);
    expect(step4).toMatch(/1\s*\+\s*2\s*\+\s*4\s*s|1s\s*\+\s*2s\s*\+\s*4s|1, 2, 4 seconds/);
    expect(step4).toMatch(/three attempts|3 attempts/i);
    expect(step4).toMatch(/JQL/);
    expect(step4).toMatch(/Gateway-Timeout|gateway timeout|network[- ]?error/i);
    expect(step4).toMatch(/single-shot|fast path/);
    const line = body.split("\n")[108] ?? "";
    expect(step4).toContain(line);
    expect(line).toContain("Idempotency hardening on Gateway-Timeout retry");
    expect(line.split("MUST emit `tracker_idempotency_uncertain`").length - 1).toBe(1);
    expect(line.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.ts\b/)).toBeNull();
  });

  test("line 111 still opens the milestone-attachment paragraph", () => {
    expect((read(SPEC_WRITE_SKILL).split("\n")[110] ?? "").trimStart()).toMatch(/^\*\*Milestone attachment/);
  });

  test("skills/**/*.md totals 245 STE tokens", () => {
    const skillsRoot = join(pluginRoot, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(skillsRoot)) {
      files += 1;
      total += steTokens(read(join(skillsRoot, rel)));
    }
    expect(files).toBeGreaterThan(20);
    expect(total).toBe(245);
  });

  test("ORDERED_UNREACHABLE_PIN is not raised, and the awaited probe measures within it", async () => {
    expect(ORDERED_UNREACHABLE_PIN).toBe(ORDERED_UNREACHABLE_PIN_LEDGER[0]!.value);
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThanOrEqual(124);
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(typeof report.orderedUnreachable).toBe("number");
    expect(report.orderedUnreachable).toBeLessThanOrEqual(ORDERED_UNREACHABLE_PIN);
  }, 120_000);
});

// ===========================================================================
// AC-STE-604.10 — an older client's attach is a no-op on a ticket created
//                 from createPayload.
// ===========================================================================

describe("AC-STE-604.10 — the pre-change attach performs zero writes", () => {
  let oldDir = "";
  let attach: any;

  beforeAll(async () => {
    oldDir = mkdtempSync(join(tmpdir(), "dpt-ste604-attach-"));
    attach = await import(extractAt(PRE_CHANGE_SHA, ATTACH_REL, oldDir));
  });
  afterAll(() => rmSync(oldDir, { recursive: true, force: true }));

  function provider(jira: MemJira, writes: string[]) {
    return {
      milestoneBinding: "epic" as const,
      async listEpics() {
        return [{ key: EPIC, name: "Shared container" }];
      },
      async setParent(id: string, key: string) {
        writes.push(`setParent ${id} ${key}`);
        const t = jira.tickets.find((x) => x.key === id)!;
        t.parent = key;
      },
      async addLabel(id: string, label: string) {
        writes.push(`addLabel ${id} ${label}`);
      },
      async getIssue(id: string) {
        const t = jira.tickets.find((x) => x.key === id)!;
        return { parent: t.parent, labels: t.labels };
      },
      async listMilestones() {
        writes.push("listMilestones");
        return [];
      },
      async saveMilestone() {
        writes.push("saveMilestone");
      },
      async upsertTicketMetadata() {
        writes.push("upsertTicketMetadata");
        return "";
      },
    };
  }

  test("a ticket created from createPayload is already parented: zero writes", async () => {
    const payload = withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const d = jsonLine(decide(b, [writePage({ issues: [], isLast: true })], TITLE, PARENT, "fast"));
      expect(d.outcome).toBe("create");
      return d.createPayload;
    });
    const jira = new MemJira();
    const ticket = jira.createFrom(payload, TITLE);
    const writes: string[] = [];
    const result = await attach.attachProjectMilestone(
      provider(jira, writes),
      "GF",
      "M_GF_40 — Shared container",
      ticket.key,
      { sleep: async () => {} },
    );
    expect(writes).toEqual([]);
    expect(result.epicKey).toBe(EPIC);
    expect(jira.creates).toBe(1);
  });

  test("control: a ticket created WITHOUT the parent is re-parented by the same old attach", async () => {
    const jira = new MemJira();
    const ticket = jira.createBare(TITLE, ["glacy-be"]);
    const writes: string[] = [];
    await attach.attachProjectMilestone(
      provider(jira, writes),
      "GF",
      "M_GF_40 — Shared container",
      ticket.key,
      { sleep: async () => {} },
    );
    expect(writes).toEqual([`setParent ${ticket.key} ${EPIC}`]);
  });
});

// ===========================================================================
// Pass 2 review hardening — the query can only NARROW. Unquoted operands must
// be bare Jira keys and quoted ones are escaped, so no operand can append a
// clause that widens the page.
// ===========================================================================

describe("STE-604 hardening — no operand can widen the query", () => {
  test("a --parent that is not a Jira issue key refuses and prints no JQL (control: a real key prints)", () => {
    withRoots((_a, b) => {
      declareJira(b, "glacy-be");
      const bad = query(b, TITLE, { parent: "GF-40 OR project = GB" });
      expect(bad.code).not.toBe(0);
      expect(bad.stdout).not.toContain("OR project");
      const ok = query(b, TITLE, PARENT);
      expect(ok.code, ok.stderr).toBe(0);
      expect(jsonLine(ok).jql).toContain(`parent = ${EPIC}`);
    });
  });

  test("a quote in a milestone label stays inside its literal", async () => {
    const { buildIdempotencyJql } = await import("../adapters/_shared/src/create_idempotency_probe");
    const jql = buildIdempotencyJql({
      projectKey: "GF",
      title: "t",
      milestoneLabel: 'milestone-M8" OR labels = "x',
    });
    expect(jql).toContain('labels = "milestone-M8\\" OR labels = \\"x"');
    expect(jql.split(" AND ").length).toBe(3);
  });
});
