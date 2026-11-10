// STE-729 (M_b2fdc0) — a ticket fetched in this session proves ownership.
//
// The tracker-write gate permits a write to a non-Epic ticket K that no
// tracked FR binds when the NEWEST non-error tool_result in this session for a
// get-ticket call on K (`getJiraIssue` / `get_issue`, under the server names
// the gate already recognises) reads as K and `decideTicketOwnership` on that
// answer, in K's target root, returns `owned`; `unowned` passes only after an
// `Adopt <K>` answer (AC-STE-729.5). Any other tool's result, an error result,
// an answer naming another key, a refused verdict, or an owned result
// superseded by a newer refused one grants nothing (AC-STE-729.6).
//
// Also here: the ownership refusal's new remedy order (AC-STE-729.7), the
// grader mirror of the fetched-ticket route (AC-STE-729.8) and the v3.3.0
// behaviour that must not move (AC-STE-729.11).
//
// Synthetic identities only (PROJ-*, STE-*, demo-be / demo-fe).

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  BOUND_TICKET,
  CLOUD,
  EPIC,
  JIRA,
  PLUGIN_ROOT,
  TICKET,
  Transcript,
  cleanupTemps,
  editInput,
  fetchedTicketLegs,
  gate,
  graderFetchLegs,
  makeWorld,
  permitProblem,
  refusalProblem,
  remedyOf,
  show,
  type Run,
} from "./_m_b2fdc0_ste729_fixture";

setDefaultTimeout(120_000);
afterAll(cleanupTemps);

// ===========================================================================
// AC-STE-729.5 / .6 / .9 — the fetched-ticket route, through the shipped .sh wrapper
// ===========================================================================

describe("AC-STE-729.5 / .6 / .9 — a fetched, owned ticket may be written; every twin differing in one condition is refused", () => {
  for (const leg of fetchedTicketLegs()) {
    test(`${leg.expect === "permit" ? "AC-STE-729.5" : "AC-STE-729.6"} — ${leg.name}`, async () => {
      const r = await leg.run(PLUGIN_ROOT);
      const problem = leg.expect === "permit" ? permitProblem(r) : refusalProblem(r);
      if (problem !== null) throw new Error(`${leg.name}: expected ${leg.expect} (${problem}):\n${show(r)}`);
    });
  }
});

// ===========================================================================
// AC-STE-729.7 — the ownership refusal's remedy order
// ===========================================================================

const CONFIRM_SHAPE = 'ticket_ownership.ts" confirm <projectRoot> <KEY> <ticket.json>';
const FETCH_LEAD = "fetch the ticket in this session";

describe("AC-STE-729.7 — the ownership refusal leads with the fetch, names epic_edit.ts and `Edit <KEY>`, keeps epic_close.ts, and keeps the confirm route last", () => {
  let r: Run;
  let remedy = "";
  beforeAll(async () => {
    const w = makeWorld();
    r = await gate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(TICKET, { summary: "Retitled" }), new Transcript(), w.root);
    remedy = remedyOf(r);
  });

  test("CONTROL — the unowned write is refused (exit 2, NFR-10 block)", () => {
    expect(refusalProblem(r), show(r)).toBeNull();
  });

  test('the remedy LEADS with "fetch the ticket in this session, then retry"', () => {
    expect(remedy.startsWith(`Remedy: ${FETCH_LEAD}`), remedy).toBe(true);
    const firstSentence = remedy.slice("Remedy: ".length).split(/(?<=\.)\s+(?=[A-Z])/)[0]!;
    expect(firstSentence, "the lead sentence ends in the retry").toMatch(/then retry/);
  });

  test("the remedy names epic_edit.ts and the `Edit <KEY>` answer for an Epic's description or summary", () => {
    expect(remedy).toContain("epic_edit.ts");
    expect(remedy).toContain('"Edit <KEY>"');
    const at = remedy.indexOf("epic_edit.ts");
    expect(remedy.slice(Math.max(0, at - 200), at + 400), "the Epic-edit route speaks of the description or summary").toMatch(/description|summary/);
  });

  test("the remedy keeps epic_close.ts (with --children) for a close", () => {
    expect(remedy).toContain("epic_close.ts");
    expect(remedy).toMatch(/epic_close\.ts" <projectRoot> <EPIC-KEY> --children <listing>/);
  });

  test("the `<ticket.json>` confirm route comes LAST: after the fetch lead, after epic_edit.ts and after epic_close.ts, with no route after it", () => {
    const confirm = remedy.indexOf(CONFIRM_SHAPE);
    expect(confirm, "the confirm route is still named").toBeGreaterThan(0);
    expect(confirm).toBeGreaterThan(remedy.indexOf(FETCH_LEAD));
    expect(confirm).toBeGreaterThan(remedy.indexOf("epic_edit.ts"));
    expect(confirm).toBeGreaterThan(remedy.indexOf("epic_close.ts"));
    const tail = remedy.slice(confirm + CONFIRM_SHAPE.length);
    for (const later of ["epic_edit.ts", "epic_close.ts", FETCH_LEAD]) expect({ later, after: tail.includes(later) }).toEqual({ later, after: false });
  });

  test("the confirm route keeps its conditional --adopt and the decide step (STE-649 AC.8 / AC.10)", () => {
    expect(remedy).toContain('ticket_ownership.ts" decide <projectRoot> <ticket.json>');
    expect(remedy).not.toContain("[--adopt]");
    expect(remedy).toMatch(/only when decide's verdict is unowned/);
  });

  test("the same remedy order on an Epic (PROJ-500) refused with no receipt", async () => {
    const w = makeWorld();
    const e = await gate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(EPIC), new Transcript(), w.root);
    expect(refusalProblem(e), show(e)).toBeNull();
    const rem = remedyOf(e);
    expect(rem.startsWith(`Remedy: ${FETCH_LEAD}`), rem).toBe(true);
    expect(rem.indexOf(CONFIRM_SHAPE)).toBeGreaterThan(rem.indexOf("epic_edit.ts"));
  });
});

// ===========================================================================
// AC-STE-729.8 — the live grader mirrors AC.5 and AC.6
// ===========================================================================

describe("AC-STE-729.8 — shared_tracker_live_grader.ts mirrors the fetched-ticket route", () => {
  for (const leg of graderFetchLegs()) {
    test(`${leg.name} → ${leg.expect === "gated" ? "no ungated-write" : "ungated-write"}`, async () => {
      const r = await leg.run(PLUGIN_ROOT);
      expect(r.ungated).toBe(leg.expect === "ungated");
    });
  }
});

// ===========================================================================
// AC-STE-729.11 — what v3.3.0 permitted still passes; an unshared repository is untouched
// ===========================================================================

describe("AC-STE-729.11 — an unshared repository, and every write the gate permitted at v3.3.0, behave as before", () => {
  test("an UNSHARED Jira repository: an edit on its Epic with no receipt, answer or fetch is permitted, any fields", async () => {
    const w = makeWorld({ unshared: true });
    const r = await gate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(EPIC, { labels: ["x"], summary: "Any" }), new Transcript(), w.root);
    expect(permitProblem(r), show(r)).toBeNull();
  });

  test("an UNSHARED Jira repository: a write on a never-fetched ticket is permitted", async () => {
    const w = makeWorld({ unshared: true });
    const r = await gate(PLUGIN_ROOT, JIRA("transitionJiraIssue"), { cloudId: CLOUD, issueIdOrKey: TICKET, transition: { id: "31" } }, new Transcript(), w.root);
    expect(permitProblem(r), show(r)).toBeNull();
  });

  test("a shared repository: a write on a ticket a TRACKED FR binds is permitted with no fetch, any fields (as at v3.3.0)", async () => {
    const w = makeWorld({ boundFr: BOUND_TICKET });
    const r = await gate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(BOUND_TICKET, { labels: ["x"], summary: "Any" }), new Transcript(), w.root);
    expect(permitProblem(r), show(r)).toBeNull();
  });

  test("a shared repository: a tracked-FR-bound ticket stays permitted even when a newer fetch in the session reads it as foreign-repo", async () => {
    const w = makeWorld({ boundFr: BOUND_TICKET });
    const t = new Transcript();
    t.tool(JIRA("getJiraIssue"), { cloudId: CLOUD, issueIdOrKey: BOUND_TICKET }, {
      key: BOUND_TICKET,
      fields: { summary: "x", labels: ["demo-fe"], issuetype: { name: "Task", hierarchyLevel: 0 }, project: { key: "PROJ" }, status: { name: "To Do", statusCategory: { key: "new" } } },
    });
    const r = await gate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput(BOUND_TICKET, { summary: "Any" }), t, w.root);
    expect(permitProblem(r), show(r)).toBeNull();
  });

  test("a shared repository: a ticket outside every declared project (OTHER-1) is not gated", async () => {
    const w = makeWorld();
    const r = await gate(PLUGIN_ROOT, JIRA("editJiraIssue"), editInput("OTHER-1", { labels: ["x"] }), new Transcript(), w.root);
    expect(permitProblem(r), show(r)).toBeNull();
  });
});
