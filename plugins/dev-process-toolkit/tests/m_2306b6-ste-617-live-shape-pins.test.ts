// STE-617 (M_2306b6) — every tracker double is bound to the MEASURED answer
// shapes, so no fixture can invent a shape again.
//
// The toolkit once modelled tracker answers nobody had measured: four readers
// each paged Linear their own way, the offline doubles agreed with them, and
// the whole suite agreed with itself while disagreeing with the tracker. The
// real answers are now pinned under tests/fixtures/live-shapes/ (each with its
// provenance) and read by ONE module, tracker_answer.ts. This suite binds the
// two doubles the live-run suites build to those pins:
//
//   * tests/_live_bundle_fixtures.ts — every tracker answer its materializer
//     writes into a transcript (`trackerAnswer`), for each tool it builds, in
//     both Jira shapes;
//   * tests/_tracker_doubles.ts — the pages and items its JiraDouble and
//     LinearDouble emit (imported read-only).
//
// For each answer: the top-level key set equals the pinned answer's, the item
// key set equals the pinned item's, and the answer reads OK through
// tracker_answer.ts. A `list_issues` row carries exactly the `fields` its call
// asked for plus `id` (measured: the CONTROL below checks the rule on the pin
// itself), so its row key set is graded by that rule against the call's own
// request. A tool the fixtures build that no measurement covers is named in
// UNMEASURED, so a new unpinned tool fails here instead of passing silently.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readTrackerItem, readTrackerPage } from "../adapters/_shared/src/tracker_answer";
import { buildPassingBundle, clone, JIRA_SHAPES, type JiraShape, type ToolCall, trackerAnswer, type Tracker } from "./_live_bundle_fixtures";
import { JiraDouble, LinearDouble } from "./_tracker_doubles";

const SHAPES_DIR = join(import.meta.dir, "fixtures", "live-shapes");

type Json = Record<string, any>;

interface Pin {
  file: string;
  request: Json;
  answer: Json;
}

function loadPin(tracker: Tracker, name: string): Pin {
  const raw = JSON.parse(readFileSync(join(SHAPES_DIR, tracker, `${name}.json`), "utf-8"));
  if (!raw.answer) throw new Error(`pin ${tracker}/${name}.json holds no measured answer (${raw.provenance?.method ?? "no provenance"})`);
  return { file: `${tracker}/${name}.json`, request: raw.provenance?.request ?? {}, answer: raw.answer };
}

const keys = (o: unknown): string[] => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).sort() : []);
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** How one pinned tool's answer is read: a page (rows under `rows`) or one item. */
interface PinSpec {
  tracker: Tracker;
  pin: string;
  /** Linear rows key for a page; "jira" for a Jira page; null for an item answer. */
  page: string | null;
}

/**
 * The key-set violations of `answer` against the pin `spec`, and whether it
 * reads through tracker_answer.ts. `requestFields` is the answering call's own
 * `fields` (a Linear `list_issues` row carries exactly those plus `id`).
 */
function pinViolations(spec: PinSpec, answer: unknown, requestFields?: readonly string[]): string[] {
  const pin = loadPin(spec.tracker, spec.pin);
  const v: string[] = [];
  const where = spec.pin;
  const same = (what: string, got: unknown, want: unknown) => {
    const g = keys(got);
    const w = keys(want);
    if (JSON.stringify(g) !== JSON.stringify(w)) v.push(`${where}: ${what} keys [${g.join(", ")}] are not the measured [${w.join(", ")}] (${pin.file})`);
  };
  same("top-level", answer, pin.answer);
  const a = isObj(answer) ? answer : {};
  if (spec.tracker === "jira") {
    if (isObj(pin.answer.issues)) {
      // wrapped: `{ context, issues: { nodes, pageInfo?, webUrl?, remainingCount? } }`
      same("issues", a.issues, pin.answer.issues);
      if (isObj(pin.answer.issues.pageInfo)) same("issues.pageInfo", a.issues?.pageInfo, pin.answer.issues.pageInfo);
      const nodes: unknown[] = Array.isArray(a.issues?.nodes) ? a.issues.nodes : [];
      for (const n of nodes) same("node", n, pin.answer.issues.nodes[0]);
    } else if (Array.isArray(pin.answer.issues)) {
      for (const n of Array.isArray(a.issues) ? a.issues : []) same("row", n, pin.answer.issues[0]);
    }
  } else if (spec.page !== null) {
    const pinRows: Json[] = pin.answer[spec.page];
    const rows: unknown[] = Array.isArray(a[spec.page]) ? a[spec.page] : [];
    if (spec.pin.startsWith("list_issues")) {
      if (!requestFields) v.push(`${where}: a list_issues answer graded without its call's fields`);
      const want = [...new Set(["id", ...(requestFields ?? [])])].sort();
      for (const r of rows) if (JSON.stringify(keys(r)) !== JSON.stringify(want)) v.push(`${where}: row keys [${keys(r).join(", ")}] are not the requested fields plus id [${want.join(", ")}]`);
    } else {
      for (const r of rows) same("row", r, pinRows[0]);
    }
  } else if (isObj(pin.answer.status)) {
    same("status", a.status, pin.answer.status);
  }
  const read = spec.page === null ? readTrackerItem(spec.tracker, answer) : readTrackerPage(spec.tracker, answer, spec.tracker === "jira" ? undefined : spec.page);
  if (!read.ok) v.push(`${where}: does not read through tracker_answer.ts (${read.reason})`);
  return v;
}

// ---------------------------------------------------------------------------
// The pins themselves
// ---------------------------------------------------------------------------

describe("CONTROL — the pins are measured answers, read OK by tracker_answer.ts", () => {
  const all = readdirSync(SHAPES_DIR).flatMap((t) => readdirSync(join(SHAPES_DIR, t)).map((f) => `${t}/${f}`));
  // Checks the ANSWER only; provenance ({measured_at, method, request}) is
  // enforced per pin in m_2306b6-ste-617-tracker-answer.test.ts.
  test("every pin but a declared-unmeasured one carries an answer", () => {
    const missing = all.filter((f) => {
      const raw = JSON.parse(readFileSync(join(SHAPES_DIR, f), "utf-8"));
      return !raw.answer && raw.provenance?.method !== "declared-unmeasured";
    });
    expect(missing).toEqual([]);
  });
  test("a list_issues row carries exactly its request's fields plus id (the rule the fixture rows are graded by)", () => {
    for (const name of ["list_issues.last", "list_issues.more"]) {
      const pin = loadPin("linear", name);
      const want = [...new Set(["id", ...(pin.request.fields as string[])])].sort();
      for (const r of pin.answer.issues) expect({ name, keys: keys(r) }).toEqual({ name, keys: want });
    }
  });
});

// ---------------------------------------------------------------------------
// tests/_live_bundle_fixtures.ts — every answer its materializer writes
// ---------------------------------------------------------------------------

/** The pin a fixture call's answer is graded against, or null when the tool is UNMEASURED. */
function specOf(tracker: Tracker, c: ToolCall, shape: JiraShape): PinSpec | null {
  const tool = c.name.split("__").at(-1)!;
  if (tracker === "jira") {
    if (tool === "searchJiraIssuesUsingJql") return { tracker, pin: `search.${shape}.${c.result.lastPage === true ? "last" : "more"}`, page: "jira" };
    if (tool === "createJiraIssue") return { tracker, pin: `create.${shape}`, page: null };
    if (tool === "getJiraIssue") return { tracker, pin: `get.${shape}`, page: null };
    if (tool === "editJiraIssue") return { tracker, pin: `edit.${shape}`, page: null };
    return null;
  }
  if (tool === "list_issues") return { tracker, pin: `list_issues.${c.result.lastPage === true ? "last" : "more"}`, page: "issues" };
  if (tool === "list_milestones") return { tracker, pin: "list_milestones", page: "milestones" };
  if (tool === "get_milestone") return { tracker, pin: "get_milestone", page: null };
  if (tool === "get_project") return { tracker, pin: "get_project", page: null };
  if (tool === "get_issue") return { tracker, pin: "get_issue", page: null };
  if (tool === "save_milestone" && !c.input.id) return { tracker, pin: "save_milestone.create", page: null };
  if (tool === "save_issue") return { tracker, pin: c.input.id ? "save_issue.update" : "save_issue.create", page: null };
  return null;
}

/**
 * The tools the fixtures answer that no measurement covers, each with why. A
 * tool answered here and absent from both the pins and this list fails.
 */
const UNMEASURED: Readonly<Record<string, string>> = {
  // Empty since editJiraIssue (both shapes, recorded) and Linear get_issue (a
  // read-only call) were pinned. The mechanism stays: a tool answered here and
  // pinned nowhere must be named with its reason or the coverage test fails.
};

interface Built {
  tracker: Tracker;
  shape: JiraShape;
  call: ToolCall;
  answer: unknown;
}

function fixtureAnswers(): Built[] {
  const out: Built[] = [];
  const legs: Array<[Tracker, JiraShape]> = [...JIRA_SHAPES.map((s) => ["jira", s] as [Tracker, JiraShape]), ["linear", "plain"]];
  for (const [tracker, shape] of legs) {
    for (const opts of [{}, { importConsent: "answers-block" as const }]) {
      for (const s of buildPassingBundle(tracker, opts).sessions) {
        for (const c of s.calls) {
          if (c.result.isError || c.result.items === null || c.name === "Bash" || !c.name.startsWith("mcp__")) continue;
          out.push({ tracker, shape, call: c, answer: trackerAnswer(tracker, c, shape) });
        }
      }
    }
  }
  return out;
}

const BUILT = fixtureAnswers();

describe("the live-bundle fixtures build every tracker answer in its measured shape", () => {
  test("CONTROL — the fixtures answer every tool the task names, in both Jira shapes and both page positions", () => {
    const seen = new Set(BUILT.map((b) => specOf(b.tracker, b.call, b.shape)).filter((x): x is PinSpec => x !== null).map((x) => `${x.tracker}/${x.pin}`));
    const want = [
      "linear/list_issues.last", "linear/list_issues.more", "linear/list_milestones", "linear/get_milestone", "linear/get_project", "linear/save_issue.create",
      "jira/search.plain.last", "jira/search.plain.more", "jira/search.wrapped.last", "jira/search.wrapped.more",
      "jira/create.plain", "jira/create.wrapped", "jira/get.plain", "jira/get.wrapped",
    ];
    expect(want.filter((w) => !seen.has(w))).toEqual([]);
  });
  test("every answered tool is pinned or named UNMEASURED with its reason", () => {
    const stray = [...new Set(BUILT.filter((b) => specOf(b.tracker, b.call, b.shape) === null).map((b) => `${b.tracker}:${b.call.name.split("__").at(-1)}`))];
    expect(stray.filter((s) => !(s in UNMEASURED)).sort()).toEqual([]);
  });
  test("each built answer has its pin's top-level and item key sets and reads OK through tracker_answer.ts", () => {
    const v = BUILT.flatMap((b) => {
      const spec = specOf(b.tracker, b.call, b.shape);
      if (spec === null) return [];
      const fields = Array.isArray(b.call.input.fields) ? (b.call.input.fields as string[]) : undefined;
      return pinViolations(spec, b.answer, fields).map((x) => `${b.tracker}(${b.shape}) ${b.call.ref}: ${x}`);
    });
    expect([...new Set(v)]).toEqual([]);
  });
  test("a Linear row's team is a display name, never the team key", () => {
    const teams = BUILT.filter((b) => b.tracker === "linear").flatMap((b) => {
      const a = b.answer as Json;
      const rows: Json[] = Array.isArray(a.issues) ? a.issues : isObj(a) && "team" in a ? [a] : [];
      return rows.filter((r) => "team" in r).map((r) => r.team);
    });
    expect(teams.length).toBeGreaterThan(0);
    for (const t of new Set(teams)) expect({ team: t, isKey: /^[A-Z][A-Z0-9]*$/.test(String(t)) }).toEqual({ team: t, isKey: false });
  });

  // MUTATION CONTROL — the check above goes red on the two drifts the old
  // doubles had: a Linear page growing `pageInfo`, and one losing `hasNextPage`.
  const page = (): Built => {
    const b = BUILT.find((x) => x.tracker === "linear" && /__list_issues$/.test(x.call.name) && x.call.result.lastPage === true);
    if (!b) throw new Error("fixture: no Linear last page was built");
    return b;
  };
  const grade = (b: Built, answer: unknown) => pinViolations(specOf(b.tracker, b.call, b.shape)!, answer, b.call.input.fields as string[]);
  test("MUTATION — a fixture Linear page that grows `pageInfo` is red, naming the top-level keys and the reader's refusal; PERMIT TWIN — the built page", () => {
    const b = page();
    expect(grade(b, b.answer), "PERMIT TWIN").toEqual([]);
    const grown = clone(b.answer) as Json;
    grown.pageInfo = { hasNextPage: false, endCursor: null };
    const v = grade(b, grown);
    expect(v.some((x) => /top-level keys \[.*pageInfo.*\] are not the measured/.test(x)), JSON.stringify(v)).toBe(true);
    expect(v.some((x) => /does not read through tracker_answer\.ts .*pageInfo/.test(x)), JSON.stringify(v)).toBe(true);
  });
  test("MUTATION — a fixture Linear page that loses `hasNextPage` is red", () => {
    const b = page();
    const lost = clone(b.answer) as Json;
    delete lost.hasNextPage;
    const v = grade(b, lost);
    expect(v.some((x) => /top-level keys/.test(x)), JSON.stringify(v)).toBe(true);
    expect(v.some((x) => /does not read through tracker_answer\.ts/.test(x)), JSON.stringify(v)).toBe(true);
  });
  test("MUTATION — a fixture Jira row that loses `self`, or a wrapped node that loses `webUrl`, is red", () => {
    for (const shape of JIRA_SHAPES) {
      const b = BUILT.find((x) => x.tracker === "jira" && x.shape === shape && /__searchJiraIssuesUsingJql$/.test(x.call.name) && (x.call.result.items ?? []).length > 0)!;
      const m = clone(b.answer) as Json;
      const row = shape === "plain" ? m.issues[0] : m.issues.nodes[0];
      delete row[shape === "plain" ? "self" : "webUrl"];
      expect({ shape, red: grade(b, m).some((x) => /(row|node) keys/.test(x)) }).toEqual({ shape, red: true });
    }
  });
});

// ---------------------------------------------------------------------------
// tests/_tracker_doubles.ts — the pages and items its doubles emit (read-only)
// ---------------------------------------------------------------------------

describe("the offline tracker doubles emit every page and item in its measured shape", () => {
  const linearFields = (name: string) => loadPin("linear", name).request.fields as string[];

  function linearDouble(): LinearDouble {
    const d = new LinearDouble();
    for (let n = 1; n <= 3; n++) d.seed({ title: `shape pin ${n}`, project: "DPT Shared", team: "STE" });
    d.seedMilestone("DPT Shared", "Shape Pin Milestone");
    return d;
  }
  function jiraDouble(shape: JiraShape): JiraDouble {
    const d = new JiraDouble({}, shape);
    for (let n = 1; n <= 3; n++) d.seed({ summary: `shape pin ${n}`, project: "DST" });
    return d;
  }

  test("LinearDouble.listIssues — a page with more after it, and the last page", () => {
    const d = linearDouble();
    const fields = linearFields("list_issues.more");
    const more = d.listIssues({ project: "DPT Shared", limit: 2, fields });
    const v = pinViolations({ tracker: "linear", pin: "list_issues.more", page: "issues" }, more, fields);
    const next = (more as Json).cursor ?? (more as Json).pageInfo?.endCursor;
    const last = d.listIssues({ project: "DPT Shared", limit: 2, fields, ...(typeof next === "string" ? { cursor: next } : {}) });
    v.push(...pinViolations({ tracker: "linear", pin: "list_issues.last", page: "issues" }, last, fields));
    expect(v).toEqual([]);
  });
  test("LinearDouble.listMilestones", () => {
    expect(pinViolations({ tracker: "linear", pin: "list_milestones", page: "milestones" }, linearDouble().listMilestones({ project: "DPT Shared" }))).toEqual([]);
  });
  test("LinearDouble.apply save_issue (a create)", () => {
    const a = linearDouble().apply("save_issue", { team: "STE", project: "DPT Shared", title: "shape pin create", labels: [] });
    expect(pinViolations({ tracker: "linear", pin: "save_issue.create", page: null }, a)).toEqual([]);
  });
  test("LinearDouble.apply save_milestone (a create)", () => {
    const a = linearDouble().apply("save_milestone", { project: "DPT Shared", name: "shape pin milestone" });
    expect(pinViolations({ tracker: "linear", pin: "save_milestone.create", page: null }, a)).toEqual([]);
  });
  for (const shape of JIRA_SHAPES) {
    test(`JiraDouble (${shape}).search — a page with more after it, and the last page`, () => {
      const d = jiraDouble(shape);
      const more = d.search({ cloudId: "fixture-cloud", jql: "project = DST", fields: ["summary", "labels"], maxResults: 2 }) as Json;
      const v = pinViolations({ tracker: "jira", pin: `search.${shape}.more`, page: "jira" }, more);
      const token = shape === "plain" ? more.nextPageToken : more.issues?.pageInfo?.endCursor;
      const last = d.search({ cloudId: "fixture-cloud", jql: "project = DST", fields: ["summary", "labels"], maxResults: 2, ...(typeof token === "string" ? { nextPageToken: token } : {}) });
      v.push(...pinViolations({ tracker: "jira", pin: `search.${shape}.last`, page: "jira" }, last));
      expect(v).toEqual([]);
    });
    test(`JiraDouble (${shape}).get and .apply createJiraIssue`, () => {
      const d = jiraDouble(shape);
      const v = pinViolations({ tracker: "jira", pin: `get.${shape}`, page: null }, d.get({ cloudId: "fixture-cloud", issueIdOrKey: "DST-1" }));
      v.push(...pinViolations({ tracker: "jira", pin: `create.${shape}`, page: null }, d.apply("createJiraIssue", { cloudId: "fixture-cloud", projectKey: "DST", issueTypeName: "Task", summary: "shape pin create" })));
      expect(v).toEqual([]);
    });
  }
});
