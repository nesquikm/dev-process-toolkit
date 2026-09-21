// M_2306b6 — the repoint rows read their tracker listings in the MEASURED
// shapes, and say which completeness the tracker proved and which the session
// only asserted.
//
// Measured (tests/fixtures/live-shapes/, read by tracker_answer.ts):
//   row 1 --projects     Linear list_projects `{ projects, hasNextPage }` (last page);
//                        Jira getVisibleJiraProjects `{ …, isLast, values }` (isLast)
//   row 3 --issue-types  Jira getJiraProjectIssueTypesMetadata `{ startAt, total,
//                        issueTypes }` (complete iff startAt 0 and `total` rows)
//   row 4 --statuses     Linear list_issue_statuses — a BARE array
//   row 6 --containers   Linear list_milestones — a full 50-row window is not complete
// Unmeasurable (no Atlassian MCP tool lists a project's statuses or labels):
//   row 4 --statuses and row 6 --labels (Jira) keep the hand-assembled
//   `isLast: true` claim; a missing claim refuses, and a row that relied on
//   the claim carries COMPLETENESS_ASSERTED_MARKER, and the receipt names the
//   input under `assertedCompleteness`.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as repoint from "../adapters/_shared/src/repoint_tracker_binding";
import {
  GF_STATUSES,
  LINEAR_URL,
  linearClaudeMdText,
  makeGlacy,
  receiptFiles,
  rowLine,
  runRepoint,
  verdict,
  writeMcpJson,
  writeTrackerConfig,
  type Glacy,
} from "./_repoint_fixture";
import { commitAll, makeSpanFixture } from "./_span_fixture";

const T = 60_000;
const MARKER = (): string => (repoint as unknown as Record<string, string>).COMPLETENESS_ASSERTED_MARKER ?? "<COMPLETENESS_ASSERTED_MARKER not exported>";
const live = (tracker: string, name: string): any =>
  structuredClone(JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "live-shapes", tracker, `${name}.json`), "utf-8")).answer);

function withGlacy(body: (g: Glacy) => void): () => void {
  return () => {
    const g = makeGlacy();
    try {
      body(g);
    } finally {
      g.cleanup();
    }
  };
}

/** A measured getVisibleJiraProjects answer listing `keys`. */
function jiraProjectsAnswer(keys: string[], isLast = true): unknown {
  const a = live("jira", "getVisibleJiraProjects");
  const row = a.values[0];
  a.values = keys.map((key, i) => ({ ...row, id: String(10001 + i), key, name: `Project ${key}` }));
  a.total = keys.length;
  a.isLast = isLast;
  return a;
}

/** A measured getJiraProjectIssueTypesMetadata answer listing `names`, claiming `total` types. */
function issueTypesAnswer(names: string[], total = names.length): unknown {
  const a = live("jira", "getJiraProjectIssueTypesMetadata");
  const row = a.issueTypes[0];
  a.issueTypes = names.map((name, i) => ({ ...row, id: String(11100 + i), name }));
  a.total = total;
  return a;
}

/** A measured Linear list_issue_statuses answer: a bare array. */
function linearStatusesAnswer(names: string[]): unknown {
  const row = live("linear", "list_issue_statuses")[0];
  return names.map((name, i) => ({ ...row, id: `s-${i}`, name }));
}

describe("row 1 — --projects in the measured shapes", () => {
  test(
    "Jira: the measured getVisibleJiraProjects answer passes, with no asserted-completeness marker",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--projects": g.listing("p.json", jiraProjectsAnswer(["GB", "GF", "GX"])) }));
      expect(verdict(r.stdout, 1), rowLine(r.stdout, 1)).toBe("PASS");
      expect(rowLine(r.stdout, 1)).not.toContain(MARKER());
    }),
    T,
  );
  test(
    "twin: the same answer saying isLast false refuses",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--projects": g.listing("p.json", jiraProjectsAnswer(["GB", "GF", "GX"], false)) }));
      expect(verdict(r.stdout, 1), rowLine(r.stdout, 1)).toBe("REFUSE");
    }),
    T,
  );
});

describe("row 3 — --issue-types, the measured getJiraProjectIssueTypesMetadata answer", () => {
  test(
    "a complete answer (startAt 0, total rows) offering Task passes, with no marker",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--issue-types": g.listing("t.json", issueTypesAnswer(["Epic", "Task", "Bug"])) }));
      expect(verdict(r.stdout, 3), rowLine(r.stdout, 3)).toBe("PASS");
      expect(rowLine(r.stdout, 3)).not.toContain(MARKER());
    }),
    T,
  );
  test(
    "twin: an answer holding fewer rows than its `total` refuses — it does not prove the list whole",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--issue-types": g.listing("t.json", issueTypesAnswer(["Epic", "Task", "Bug"], 5)) }));
      expect(verdict(r.stdout, 3), rowLine(r.stdout, 3)).toBe("REFUSE");
    }),
    T,
  );
});

describe("rows 4 and 6 (Jira) — completeness the session asserts, never the tracker", () => {
  test(
    "row 4: a hand-assembled status list claiming isLast true passes, CARRYING the marker; row 6 likewise",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--statuses": g.listing("s.json", { statuses: GF_STATUSES.map((name, i) => ({ id: String(i + 1), name })), isLast: true }) }));
      expect(verdict(r.stdout, 4), rowLine(r.stdout, 4)).toBe("PASS");
      expect(rowLine(r.stdout, 4)).toContain(MARKER());
      expect(verdict(r.stdout, 6), rowLine(r.stdout, 6)).toBe("PASS");
      expect(rowLine(r.stdout, 6)).toContain(MARKER());
    }),
    T,
  );
  test(
    "twin: the status list with no isLast claim refuses",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--statuses": g.listing("s.json", { statuses: GF_STATUSES.map((name, i) => ({ id: String(i + 1), name })) }) }));
      expect(verdict(r.stdout, 4), rowLine(r.stdout, 4)).toBe("REFUSE");
    }),
    T,
  );
  test(
    "the repoint receipt names each asserted input under assertedCompleteness",
    withGlacy((g) => {
      const r = runRepoint(g.args({ "--statuses": g.listing("s.json", { statuses: GF_STATUSES.map((name, i) => ({ id: String(i + 1), name })), isLast: true }) }));
      expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
      const files = receiptFiles(g.a);
      expect(files.length).toBe(1);
      const receipt = JSON.parse(readFileSync(files[0]!, "utf-8"));
      expect(receipt.evidence.assertedCompleteness).toEqual(["statuses", "labels"]);
    }),
    T,
  );
});

describe("row 4 (Linear) — list_issue_statuses answers a bare array", () => {
  function linearRun(statuses: unknown): { stdout: string; code: number; receipt: any } {
    const f = makeSpanFixture("M_live_l4");
    const lst = mkdtempSync(join(tmpdir(), "dpt-live-l4-"));
    try {
      writeFileSync(join(f.a, "CLAUDE.md"), linearClaudeMdText({ team: "STE", project: "Old Proj" }));
      writeMcpJson(f.a, { linear: LINEAR_URL });
      writeTrackerConfig(f.a, "linear", ["Todo", "In Progress", "Done"]);
      commitAll(f.a, "linear fixture");
      const w = (n: string, c: unknown) => {
        const p = join(lst, n);
        writeFileSync(p, JSON.stringify(c));
        return p;
      };
      const r = runRepoint([
        f.a, "linear", "New Proj",
        "--projects", w("p.json", { projects: [{ id: "p-1", name: "New Proj" }], hasNextPage: false }),
        "--containers", w("c.json", { milestones: [] }),
        "--statuses", w("s.json", statuses),
      ]);
      const files = receiptFiles(f.a);
      return { stdout: r.stdout, code: r.code, receipt: files.length === 1 ? JSON.parse(readFileSync(files[0]!, "utf-8")) : null };
    } finally {
      f.cleanup();
      rmSync(lst, { recursive: true, force: true });
    }
  }

  test("the measured bare-array answer passes row 4 with no marker, and the receipt asserts nothing", () => {
    const r = linearRun(linearStatusesAnswer(["Todo", "In Progress", "Done"]));
    expect(verdict(r.stdout, 4), rowLine(r.stdout, 4)).toBe("PASS");
    expect(r.stdout).not.toContain(MARKER());
    expect(r.code, r.stdout).toBe(0);
    expect(r.receipt.evidence.assertedCompleteness).toEqual([]);
  }, T);

  test("twin: the invented `{ statuses: [...] }` wrapper refuses row 4", () => {
    const r = linearRun({ statuses: [{ id: "1", name: "Todo" }, { id: "2", name: "In Progress" }, { id: "3", name: "Done" }] });
    expect(verdict(r.stdout, 4), rowLine(r.stdout, 4)).toBe("REFUSE");
  }, T);
});
