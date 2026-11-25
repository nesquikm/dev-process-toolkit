// STE-871 (M_e8850b) — the tracker-write gate counts only evidence from the
// declared Jira site and permits only writes to it. Every leg runs the SHIPPED
// `.sh` wrapper. Each refuse leg has a permit twin that differs in the site
// only, so nothing but the site check can refuse it. Invented hosts and UUIDs.
//
// Mutants (AC-STE-871.10) are found by call site, not by source text: each
// `siteMatches(` / `browseHostMatches(` call in the hook is neutralised in turn.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { EPIC, MILESTONE, PLUGIN_ROOT, SESSION, SIBLING_TAG, TAG, Transcript, cleanupTemps, gate, hookModuleRel, jiraTicket, makeWorld, moduleRel, permitProblem, refusalProblem, runModule, show, tempDir, type Run, type World, type WorldOpts } from "./_m_b2fdc0_ste729_fixture";
import { commitAll } from "./_span_fixture";

setDefaultTimeout(180_000);

type Obj = Record<string, unknown>;
const HOST = "tracker.example.invalid";
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const OTHER_HOST = "other.example.invalid";
const OTHER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const OWN = "PROJ-520"; // bound by a tracked FR
const FOREIGN = "PROJ-5";
const TICKET = "PROJ-510"; // owned only by evidence
const MADE = "PROJ-150";
const SITE_REL = moduleRel("atlassian_site.ts");
const CALL_REL = moduleRel("atlassian_call.ts");

type Declared = { site?: string; cloudId?: string };
/** A shared Jira world whose `### Jira` declares `d`. */
function world(d: Declared, o: WorldOpts = {}, blank = false): World {
  const w = makeWorld({ boundFr: OWN, ...o });
  const path = join(w.root, "CLAUDE.md");
  const lines = [...(d.site ? [`site: ${d.site}`] : []), ...(d.cloudId ? [`cloud_id: ${d.cloudId}`] : []), ...(blank ? ["site:", "cloud_id:"] : [])];
  const src = readFileSync(path, "utf-8");
  if (!src.includes("### Jira\n\n")) throw new Error("fixture: no ### Jira sub-section");
  writeFileSync(path, src.replace("### Jira\n\n", `### Jira\n\n${lines.map((l) => `${l}\n`).join("")}`));
  commitAll(w.root, "fixture: declare the site");
  return w;
}

let both: World;
let siteOnly: World;
let idOnly: World;
let none: World;
beforeAll(() => {
  both = world({ site: HOST, cloudId: UUID });
  siteOnly = world({ site: HOST });
  idOnly = world({ cloudId: UUID });
  none = world({});
});
afterAll(cleanupTemps);

type How = "direct" | "wrapped";
const HOWS: How[] = ["direct", "wrapped"];
const ABSENT = Symbol("absent");
/** The call of `op` at `cloudId`, by its own tool or wrapped. */
function spelled(how: How, op: string, inputs: Obj, cloudId: unknown, o: { server?: string; read?: boolean } = {}): [string, Obj] {
  const id = cloudId === ABSENT ? {} : { cloudId };
  const p = `mcp__${o.server ?? "atlassian"}__`;
  return how === "direct" ? [p + op, { ...id, ...inputs }] : [p + (o.read ? "executeRead" : "executeWrite"), { name: op, inputs, ...id }];
}
const send = (w: World, how: How, op: string, inputs: Obj, cloudId: unknown, t = new Transcript(), o: { server?: string; root?: string } = {}): Promise<Run> => {
  const [tool, input] = spelled(how, op, inputs, cloudId, o);
  return gate(o.root ?? PLUGIN_ROOT, tool, input, t, w.root);
};
const permits = (r: Run): void => expect(permitProblem(r), show(r)).toBeNull();
const refuses = (r: Run, ...needles: string[]): void => {
  expect(refusalProblem(r), show(r)).toBeNull();
  for (const n of needles) expect(r.stderr).toContain(n);
};
const edit = (key: string): Obj => ({ issueIdOrKey: key, fields: { summary: "Retitled" } });
const sendEdit = (w: World, key: string, cloudId: unknown, t = new Transcript(), o: { server?: string; root?: string } = {}): Promise<Run> => send(w, "direct", "editJiraIssue", edit(key), cloudId, t, o);

// ----------------------------------------------------------- evidence makers

/** One read through `how` and its answer. */
function answered(t: Transcript, how: How, op: string, inputs: Obj, cloudId: unknown, answer: unknown, o: { server?: string; isError?: boolean; write?: boolean } = {}): Transcript {
  const [tool, input] = spelled(how, op, inputs, cloudId, { server: o.server, read: o.write !== true });
  t.tool(tool, input, answer, o.isError ?? false);
  return t;
}
const fetched = (t: Transcript, cloudId: unknown, o: { how?: How; key?: string; subject?: string; labels?: string[]; server?: string; isError?: boolean; project?: string } = {}): Transcript =>
  answered(t, o.how ?? "direct", "getJiraIssue", { issueIdOrKey: o.subject ?? o.key ?? TICKET }, cloudId, o.isError ? "Jira 503" : jiraTicket(o.key ?? TICKET, { labels: o.labels ?? [TAG], project: o.project }), o);

function announce(t: Transcript, root: string, module: string, args: string, input: ReceiptInput): void {
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  let path: string;
  try {
    path = writeReceipt(root, input);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = prev;
  }
  t.bash(`bun run "${join(PLUGIN_ROOT, moduleRel(module))}" ${args}`, announceReceipt(path));
}

const TITLE = "Payout export";
const EPIC_TITLE = "Payouts";
function ticketDecided(w: World): Transcript {
  const t = new Transcript();
  announce(t, w.root, "create_idempotency_probe.ts", `decide "${w.root}" /tmp/page.json --title "${TITLE}" --parent ${EPIC} --attempt fast`, {
    kind: "create",
    adapter: "jira",
    container: EPIC,
    subject: TITLE,
    decision: "create",
    evidence: { createPayload: { project: "PROJ", summary: TITLE, labels: [TAG], parent: EPIC } },
  });
  announce(t, w.root, "attach_project_milestone.ts", `${w.root} jira PROJ ${w.planFile} /tmp/listing.json`, {
    kind: "attach-target",
    adapter: "jira",
    container: "PROJ",
    subject: MILESTONE,
    decision: "parent",
    evidence: { surface: "parent", key: EPIC, planFile: w.planRel, provenance: { kind: "not-applicable" } },
  });
  return t;
}
function epicDecision(w: World): Transcript {
  const listing = join(w.scratch, "listing.json");
  writeFileSync(listing, JSON.stringify({ issues: [], isLast: true }));
  const run = runModule(PLUGIN_ROOT, "resolve_milestone_identity.ts", [w.root, "jira", "PROJ", listing, "--title", EPIC_TITLE]);
  if (run.exitCode !== 0) throw new Error(`fixture: the decision did not run:\n${show(run)}`);
  const t = new Transcript();
  t.run(run);
  return t;
}
const RELIST: Obj = { jql: "project = PROJ AND issuetype = Epic", fields: ["summary", "status", "issuetype", "project", "labels"], maxResults: 100 };
const page = (issues: unknown[], next?: string): Obj => ({ issues, isLast: next === undefined, ...(next === undefined ? {} : { nextPageToken: next }) });
const relisted = (t: Transcript, cloudId: unknown, answer: unknown = page([]), o: { how?: How; isError?: boolean; token?: string } = {}): Transcript =>
  answered(t, o.how ?? "direct", "searchJiraIssuesUsingJql", { ...RELIST, ...(o.token ? { nextPageToken: o.token } : {}) }, cloudId, o.isError ? "Jira 503" : answer, { isError: o.isError });
const epicRow = (key: string, summary: string): Obj => ({ key, id: "10090", fields: { ...(jiraTicket(key, { type: "Epic" }).fields as Obj), summary } });

const TICKET_V1: Obj = { projectKey: "PROJ", issueTypeName: "Task", summary: TITLE, parent: EPIC, additional_fields: { labels: [TAG] } };
const TICKET_V2: Obj = { projectKey: "PROJ", issueType: "Task", summary: TITLE, parent: EPIC, labels: [TAG] };
const EPIC_V1: Obj = { projectKey: "PROJ", issueTypeName: "Epic", summary: EPIC_TITLE, additional_fields: { labels: [TAG] } };
const EPIC_V2: Obj = { projectKey: "PROJ", issueType: "Epic", summary: EPIC_TITLE, labels: [TAG] };

// ------------------------------------------------------- AC.3: the write check

const GRAPH = { objectIdentifier: OWN, targetObjectIdentifier: FOREIGN, relationshipType: "jira-work-item-links-jira-work-item" };
const OPS: Array<[string, string, Obj]> = [
  ["v1 edit", "editJiraIssue", edit(OWN)],
  ["v2 edit", "editJiraIssue", { issueIdOrKey: OWN, additional_fields: { summary: "Retitled" } }],
  ["v1 transition", "transitionJiraIssue", { issueIdOrKey: OWN, transition: { id: "31" } }],
  ["v2 transition", "transitionJiraIssue", { issueIdOrKey: OWN, transitionId: "31" }],
  ["v1 comment", "addCommentToJiraIssue", { issueIdOrKey: OWN, commentBody: "Noted." }],
  ["v2 comment", "addOrEditJiraIssueComment", { issueIdOrKey: OWN, body: "Noted." }],
  ["v1 worklog", "addWorklogToJiraIssue", { issueIdOrKey: OWN, timeSpent: "1h" }],
  ["v2 worklog", "addOrEditJiraIssueWorklog", { issueIdOrKey: OWN, timeSpent: "1h" }],
  ["v1 link", "createIssueLink", { type: "Blocks", inwardIssue: OWN, outwardIssue: FOREIGN }],
  ["v2 link", "createJiraIssueLink", { linkType: "Blocks", inwardIssue: OWN, outwardIssue: FOREIGN }],
  ["v1 graph link", "addTeamworkGraphContext", GRAPH],
  ["v2 graph link", "addGraphContext", GRAPH],
];

describe("AC-STE-871.3 — a write to another site is refused", () => {
  for (const [what, op, inputs] of OPS) {
    for (const how of HOWS) {
      test(`AC-STE-871.3: REFUSE — ${how} ${what} at another site`, async () => refuses(await send(both, how, op, inputs, OTHER_UUID), OTHER_UUID, HOST));
      test(`AC-STE-871.3: PERMIT TWIN — ${how} ${what} at the declared site`, async () => permits(await send(both, how, op, inputs, UUID)));
    }
  }
  for (const how of HOWS) {
    for (const [v, ticket, epic] of [["v1", TICKET_V1, EPIC_V1], ["v2", TICKET_V2, EPIC_V2]] as const) {
      for (const [word, id] of [["REFUSE", OTHER_HOST], ["PERMIT TWIN", HOST]] as const) {
        test(`AC-STE-871.3: ${word} — ${how} ${v} ticket create at ${id}`, async () => {
          const r = await send(both, how, "createJiraIssue", ticket, id, ticketDecided(both));
          if (id === HOST) permits(r);
          else refuses(r, OTHER_HOST, HOST);
        });
        test(`AC-STE-871.3: ${word} — ${how} ${v} Epic create at ${id}`, async () => {
          const r = await send(both, how, "createJiraIssue", epic, id, relisted(epicDecision(both), HOST));
          if (id === HOST) permits(r);
          else refuses(r, OTHER_HOST, HOST);
        });
      }
    }
  }
  test("AC-STE-871.3: wrapped — a cloudId inside inputs is read too", async () => {
    const wrapped = (id: string): Promise<Run> => gate(PLUGIN_ROOT, "mcp__atlassian__executeWrite", { name: "editJiraIssue", inputs: { ...edit(OWN), cloudId: id } }, new Transcript(), both.root);
    refuses(await wrapped(OTHER_UUID), OTHER_UUID);
    permits(await wrapped(UUID));
  });
  test("AC-STE-871.3: site only, UUID sent — the refusal says to add cloud_id", async () => {
    const r = await sendEdit(siteOnly, OWN, UUID);
    refuses(r, UUID, HOST);
    expect(r.stderr).toMatch(/\badd\b[^\n]*\bcloud_id\b/i);
  });
  test("AC-STE-871.3: cloud_id only, host sent — the refusal says to add site", async () => {
    const r = await sendEdit(idOnly, OWN, HOST);
    refuses(r, HOST, UUID);
    expect(r.stderr).toMatch(/\badd\b[^\n]*\bsite\b/i);
  });
  test("AC-STE-871.3: both declared — no key to add is named", async () => {
    const r = await sendEdit(both, OWN, OTHER_UUID);
    refuses(r);
    expect(r.stderr).not.toMatch(/\badd\b[^\n]*\bcloud_id\b/i);
    expect(r.stderr).not.toMatch(/\badd\b[^\n]*\bsite\b/i);
  });
  // Review finding 14: a host value is the one that could draw a wrong `site` hint.
  test("AC-STE-871.3: both declared, another host sent — no key to add is named", async () => {
    const r = await sendEdit(both, OWN, OTHER_HOST);
    refuses(r, OTHER_HOST, HOST);
    expect(r.stderr).not.toMatch(/\badd\b[^\n]*\bsite\b/i);
    expect(r.stderr).not.toMatch(/\badd\b[^\n]*\bcloud_id\b/i);
  });
  test("AC-STE-871.3: CONTROL — site only, another host sent — no key to add is named", async () => {
    const r = await sendEdit(siteOnly, OWN, OTHER_HOST);
    refuses(r, OTHER_HOST, HOST);
    expect(r.stderr).not.toMatch(/\badd\b[^\n]*\bsite\b/i);
  });
  test("AC-STE-871.3: a key no declared binding holds is out of scope", async () => permits(await sendEdit(both, "ELSE-1", OTHER_UUID)));
});

describe("AC-STE-871.2 — the cloudId spellings, through the hook", () => {
  for (const v of [UUID, UUID.toUpperCase(), HOST, HOST.toUpperCase(), `https://${HOST}`, `HTTPS://${HOST.toUpperCase()}`]) test(`AC-STE-871.2: PERMIT — ${v}`, async () => permits(await sendEdit(both, OWN, v)));
  const bad: unknown[] = [OTHER_UUID, OTHER_HOST, `a.${HOST}`, `${HOST}.evil.example.invalid`, `x${HOST}`, `${HOST}x`, `http://${HOST}`, `https://${HOST}:8443`, "", "  ", 42, null, [UUID], { id: UUID }, ABSENT];
  for (const v of bad) test(`AC-STE-871.2: REFUSE — ${typeof v === "symbol" ? "missing" : JSON.stringify(v)}`, async () => refuses(await sendEdit(both, OWN, v), HOST));
});

// ------------------------------------------------------------ AC.4: evidence

describe("AC-STE-871.4 — evidence from another site proves nothing", () => {
  for (const how of HOWS) {
    test(`AC-STE-871.4: REFUSE — ${how} getJiraIssue answered by another site`, async () => refuses(await sendEdit(both, TICKET, UUID, fetched(new Transcript(), OTHER_UUID, { how }))));
    test(`AC-STE-871.4: PERMIT TWIN — ${how} getJiraIssue answered by the declared site`, async () => permits(await sendEdit(both, TICKET, UUID, fetched(new Transcript(), HOST, { how }))));
    const made = (id: unknown, v: Obj): Transcript => answered(new Transcript(), how, "createJiraIssue", v, id, { id: "10150", key: MADE }, { write: true });
    for (const [n, v] of [["v1", TICKET_V1], ["v2", TICKET_V2], ["Epic", EPIC_V1]] as const) {
      test(`AC-STE-871.4: REFUSE — ${how} ${n} create answered by another site`, async () => refuses(await sendEdit(both, MADE, UUID, made(OTHER_UUID, v))));
      test(`AC-STE-871.4: PERMIT TWIN — ${how} ${n} create answered by the declared site`, async () => permits(await sendEdit(both, MADE, UUID, made(HOST, v))));
    }
    test(`AC-STE-871.4: REFUSE — ${how} re-list answered by another site`, async () => refuses(await send(both, "direct", "createJiraIssue", EPIC_V1, UUID, relisted(epicDecision(both), OTHER_UUID, page([]), { how }))));
    test(`AC-STE-871.4: PERMIT TWIN — ${how} re-list answered by the declared site`, async () => permits(await send(both, "direct", "createJiraIssue", EPIC_V1, UUID, relisted(epicDecision(both), HOST, page([]), { how }))));
  }
  for (const [what, id] of [["missing", ABSENT], ["blank", ""], ["number", 7]] as const) test(`AC-STE-871.4: REFUSE — a fetch with a ${what} cloudId`, async () => refuses(await sendEdit(both, TICKET, UUID, fetched(new Transcript(), id))));

  const own = (): Transcript => fetched(new Transcript(), UUID);
  test("AC-STE-871.4: a newer other-site answer does not hide an older matching one", async () => permits(await sendEdit(both, TICKET, UUID, fetched(own(), OTHER_UUID, { labels: [SIBLING_TAG] }))));
  test("AC-STE-871.4: a newer other-site error does not hide an older matching answer", async () => permits(await sendEdit(both, TICKET, UUID, fetched(own(), OTHER_UUID, { isError: true }))));
  test("AC-STE-871.4: a newer other-site answer does not override an older matching sibling's answer", async () => refuses(await sendEdit(both, TICKET, UUID, fetched(fetched(new Transcript(), UUID, { labels: [SIBLING_TAG] }), OTHER_UUID))));
  test("AC-STE-871.4: CONTROL — a newer matching sibling's answer still hides an older owned one", async () => refuses(await sendEdit(both, TICKET, UUID, fetched(own(), UUID, { labels: [SIBLING_TAG] }))));

  const epicCreate = (t: Transcript): Promise<Run> => send(both, "direct", "createJiraIssue", EPIC_V1, UUID, t);
  test("AC-STE-871.4: another site's open same-title Epic is no duplicate here", async () => permits(await epicCreate(relisted(relisted(epicDecision(both), UUID), OTHER_UUID, page([epicRow("PROJ-90", EPIC_TITLE)])))));
  test("AC-STE-871.4: TWIN — the declared site's open same-title Epic is a duplicate", async () => refuses(await epicCreate(relisted(relisted(epicDecision(both), UUID), UUID, page([epicRow("PROJ-90", EPIC_TITLE)])))));
  test("AC-STE-871.4: an other-site error inside a chain does not break it", async () => {
    const t = relisted(epicDecision(both), UUID, page([epicRow("PROJ-91", "Other")], "tok-2"));
    relisted(t, OTHER_UUID, null, { isError: true });
    permits(await epicCreate(relisted(t, UUID, page([]), { token: "tok-2" })));
  });
  test("AC-STE-871.4: an other-site page does not finish a chain", async () => {
    const t = relisted(epicDecision(both), UUID, page([epicRow("PROJ-91", "Other")], "tok-2"));
    refuses(await epicCreate(relisted(t, OTHER_UUID, page([]), { token: "tok-2" })));
  });
});

describe("AC-STE-871.4 — two roots with different sites in one session", () => {
  const OKEY = "OTHR-7";
  let second: World;
  let sameSite: World;
  beforeAll(() => {
    second = world({ site: OTHER_HOST, cloudId: OTHER_UUID }, { project: "OTHR", tag: SIBLING_TAG, boundFr: OKEY });
    sameSite = world({ site: HOST, cloudId: UUID }, { project: "OTHR", tag: SIBLING_TAG, boundFr: OKEY });
  });
  const joined = (w = second): Transcript => {
    const t = new Transcript();
    announce(t, w.root, "ticket_ownership.ts", `confirm ${w.root} ${OKEY} /tmp/t.json`, { kind: "binding", adapter: "jira", container: "OTHR", subject: OKEY, decision: "owned", evidence: { verdict: "owned", tracked: 1 } });
    return t;
  };
  test("AC-STE-871.4: each root's key is written at that root's site", async () => {
    permits(await sendEdit(both, OWN, UUID, joined()));
    permits(await sendEdit(both, OKEY, OTHER_UUID, joined()));
  });
  test("AC-STE-871.3: REFUSE — the first root's key at the second root's site", async () => refuses(await sendEdit(both, OWN, OTHER_UUID, joined()), OTHER_UUID, HOST));
  test("AC-STE-871.3: REFUSE — the second root's key at the first root's site", async () => refuses(await sendEdit(both, OKEY, UUID, joined()), UUID, OTHER_HOST));
  const t2 = (id: string): Transcript => fetched(joined(), id, { key: "OTHR-9", labels: [SIBLING_TAG], project: "OTHR" });
  test("AC-STE-871.4: REFUSE — the second root's ticket fetched from the first root's site", async () => refuses(await sendEdit(both, "OTHR-9", OTHER_UUID, t2(UUID))));
  test("AC-STE-871.4: PERMIT TWIN — fetched from its own site", async () => permits(await sendEdit(both, "OTHR-9", OTHER_UUID, t2(OTHER_UUID))));
  const link = { type: "Blocks", inwardIssue: OWN, outwardIssue: OKEY };
  for (const id of [UUID, OTHER_UUID]) test(`AC-STE-871.3: REFUSE — a link in scope of both roots at ${id}`, async () => refuses(await send(both, "direct", "createIssueLink", link, id, joined())));
  test("AC-STE-871.3: PERMIT TWIN — the same link when both roots declare one site", async () => permits(await send(both, "direct", "createIssueLink", link, UUID, joined(sameSite))));
});

// Review finding 2. Decided: a root that declares no site, binding a project a
// sibling root in scope declares a site for, takes that sibling's site. So it
// can no longer accept a write, a fetch or a browse URL from another site.
describe("AC-STE-871.3/.4 — a sibling that declares no site launders nothing", () => {
  const BKEY = "PROJ-530";
  let undeclared: World;
  beforeAll(() => {
    undeclared = world({}, { tag: SIBLING_TAG, boundFr: BKEY });
  });
  /** The undeclared sibling joins the session through a receipt it announced. */
  const joinedB = (): Transcript => {
    const t = new Transcript();
    announce(t, undeclared.root, "ticket_ownership.ts", `confirm ${undeclared.root} ${BKEY} /tmp/t.json`, { kind: "binding", adapter: "jira", container: "PROJ", subject: BKEY, decision: "owned", evidence: { verdict: "owned", tracked: 1 } });
    return t;
  };
  const siblingFetch = (id: string): Transcript => fetched(joinedB(), id, { labels: [SIBLING_TAG] });
  test("AC-STE-871.3: REFUSE — another-site fetch and edit owned only through the undeclared sibling", async () => {
    const r = await sendEdit(both, TICKET, OTHER_UUID, siblingFetch(OTHER_UUID));
    refuses(r, OTHER_UUID, HOST, "taken from");
  });
  test("AC-STE-871.3: REFUSE — the same by a browse URL on another host", async () => refuses(await sendEdit(both, browse(OTHER_HOST, TICKET), OTHER_UUID, siblingFetch(OTHER_UUID)), OTHER_UUID, HOST));
  test("AC-STE-871.4: REFUSE — an edit at the declared site owned only by an another-site fetch in the sibling", async () => refuses(await sendEdit(both, TICKET, UUID, siblingFetch(OTHER_UUID))));
  test("AC-STE-871.4: PERMIT TWIN — the sibling's fetch and the edit at the declared site", async () => permits(await sendEdit(both, TICKET, UUID, siblingFetch(UUID))));
  test("AC-STE-871.4: PERMIT TWIN — the sibling's own FR key at the declared site", async () => permits(await sendEdit(both, BKEY, UUID, joinedB())));
  test("AC-STE-871.3: REFUSE — the sibling's own FR key at another site", async () => refuses(await sendEdit(both, BKEY, OTHER_UUID, joinedB()), OTHER_UUID, HOST));
  test("AC-STE-871.3: the inherited site draws no hint to add a key to the sibling", async () => {
    const r = await sendEdit(both, BKEY, OTHER_HOST, joinedB());
    refuses(r, OTHER_HOST);
    expect(r.stderr).not.toMatch(/have the operator add/);
  });
  test("AC-STE-871.7: CONTROL — with no declaring sibling in scope the undeclared root keeps the old behaviour", async () => permits(await sendEdit(undeclared, TICKET, OTHER_UUID, fetched(new Transcript(), OTHER_UUID, { labels: [SIBLING_TAG] }))));
});

// Review finding 3: the hook cannot tell a UUID from the host of the same site,
// so an earlier create under another spelling still settles the ticket.
describe("STE-642 × STE-871 — a create under another cloudId spelling still counts", () => {
  const madeAt = (t: Transcript, v: Obj, id: string, key: string): Transcript => answered(t, "direct", "createJiraIssue", v, id, { id: "10160", key }, { write: true });
  test("REFUSE — a ticket created under the UUID is settled for a create under the declared host", async () => {
    const r = await send(siteOnly, "direct", "createJiraIssue", TICKET_V1, HOST, madeAt(ticketDecided(siteOnly), TICKET_V1, UUID, "PROJ-160"));
    refuses(r, "PROJ-160");
  });
  test("PERMIT TWIN — the same create with no earlier create", async () => permits(await send(siteOnly, "direct", "createJiraIssue", TICKET_V1, HOST, ticketDecided(siteOnly))));
  test("REFUSE — an Epic created under the UUID is settled for a create under the declared host", async () => {
    const r = await send(siteOnly, "direct", "createJiraIssue", EPIC_V1, HOST, madeAt(relisted(epicDecision(siteOnly), HOST), EPIC_V1, UUID, "PROJ-161"));
    refuses(r, "PROJ-161");
  });
  test("PERMIT TWIN — the same Epic create with no earlier create", async () => permits(await send(siteOnly, "direct", "createJiraIssue", EPIC_V1, HOST, relisted(epicDecision(siteOnly), HOST))));
});

// -------------------------------------------------------- AC.5: browse URLs

const browse = (host: string, key: string): string => `https://${host}/browse/${key}`;
const SUBJECT_OPS = OPS.filter(([, , i]) => "issueIdOrKey" in i);
const linkAt = (side: string): Array<[string, string, Obj]> => [
  ["v1 link inward", "createIssueLink", { type: "Blocks", inwardIssue: side, outwardIssue: FOREIGN }],
  ["v1 link outward", "createIssueLink", { type: "Blocks", inwardIssue: FOREIGN, outwardIssue: side }],
  ["v2 link", "createJiraIssueLink", { linkType: "Blocks", inwardIssue: side, outwardIssue: FOREIGN }],
  ["v1 graph object", "addTeamworkGraphContext", { ...GRAPH, objectIdentifier: side }],
  ["v1 graph target", "addTeamworkGraphContext", { ...GRAPH, objectIdentifier: FOREIGN, targetObjectIdentifier: side }],
  ["v2 graph target", "addGraphContext", { ...GRAPH, objectIdentifier: FOREIGN, targetObjectIdentifier: side }],
  ["v1 graph goal object", "addTeamworkGraphContext", { objectIdentifier: side, targetObjectIdentifier: "some goal", relationshipType: "jira-work-item-contributes-to-atlassian-goal" }],
];

describe("AC-STE-871.5 — a browse URL resolves only on the declared host", () => {
  for (const how of HOWS) {
    linkAt("").forEach(([what, op], n) => {
      const at = (host: string): Obj => linkAt(browse(host, OWN))[n]![2];
      test(`AC-STE-871.5: REFUSE — ${how} ${what} on another host`, async () => refuses(await send(siteOnly, how, op, at(OTHER_HOST), HOST)));
      test(`AC-STE-871.5: PERMIT TWIN — ${how} ${what} on the declared host`, async () => permits(await send(siteOnly, how, op, at(HOST), HOST)));
      test(`AC-STE-871.5: cloud_id only — ${how} ${what} on any host resolves as today`, async () => permits(await send(idOnly, how, op, at(OTHER_HOST), UUID)));
    });
    for (const [what, op, i] of SUBJECT_OPS) {
      const at = (host: string): Obj => ({ ...i, issueIdOrKey: browse(host, OWN) });
      test(`AC-STE-871.5: REFUSE — ${how} ${what} subject on another host`, async () => refuses(await send(siteOnly, how, op, at(OTHER_HOST), HOST)));
      test(`AC-STE-871.5: PERMIT TWIN — ${how} ${what} subject on the declared host`, async () => permits(await send(siteOnly, how, op, at(HOST.toUpperCase()), HOST)));
      test(`AC-STE-871.5: cloud_id only — ${how} ${what} subject on any host resolves as today`, async () => permits(await send(idOnly, how, op, at(OTHER_HOST), UUID)));
    }
    const byUrl = (id: string, host: string): Transcript => fetched(new Transcript(), id, { how, subject: browse(host, TICKET) });
    test(`AC-STE-871.5: REFUSE — ${how} evidence fetched by a URL on another host`, async () => refuses(await sendEdit(siteOnly, TICKET, HOST, byUrl(HOST, OTHER_HOST))));
    test(`AC-STE-871.5: PERMIT TWIN — ${how} evidence fetched by a URL on the declared host`, async () => permits(await sendEdit(siteOnly, TICKET, HOST, byUrl(HOST, HOST))));
    test(`AC-STE-871.5: cloud_id only — ${how} evidence fetched by a URL on any host counts`, async () => permits(await sendEdit(idOnly, TICKET, UUID, byUrl(UUID, OTHER_HOST))));
  }
  for (const [what, url] of [
    ["http", `http://${HOST}/browse/${OWN}`],
    ["a port", browse(`${HOST}:8443`, OWN)],
    ["userinfo", browse(`u@${HOST}`, OWN)],
    ["a trailing dot", browse(`${HOST}.`, OWN)],
    ["a prefixed host", browse(`a.${HOST}`, OWN)],
    ["a suffixed host", browse(`${HOST}.evil.example.invalid`, OWN)],
  ] as const) {
    test(`AC-STE-871.5: REFUSE — a link side with ${what}`, async () => refuses(await send(siteOnly, "direct", "createIssueLink", linkAt(url)[0]![2], HOST)));
    if (what !== "userinfo") test(`AC-STE-871.5: REFUSE — an edit subject with ${what}`, async () => refuses(await sendEdit(siteOnly, url, HOST)));
  }
});

// ------------------------------------------------------- AC.6 / .7 / .10

describe("AC-STE-871.6 — the server name is not evidence", () => {
  for (const server of ["atlassian", "claude_ai_Atlassian", "plugin_jira_atlassian", "my-own_tracker"]) {
    test(`AC-STE-871.6: PERMIT — fetch and write through ${server} at the declared site`, async () => permits(await sendEdit(both, TICKET, HOST, fetched(new Transcript(), UUID, { server }), { server })));
    test(`AC-STE-871.6: PERMIT — fetched through ${server}, written through another`, async () => permits(await sendEdit(both, TICKET, HOST, fetched(new Transcript(), UUID, { server }))));
    test(`AC-STE-871.6: REFUSE — fetched through ${server} at another site`, async () => refuses(await sendEdit(both, TICKET, HOST, fetched(new Transcript(), OTHER_UUID, { server }), { server })));
    test(`AC-STE-871.6: REFUSE — written through ${server} at another site`, async () => refuses(await sendEdit(both, OWN, OTHER_UUID, new Transcript(), { server })));
  }
});

describe("AC-STE-871.7 — with neither key declared nothing changes", () => {
  const silent = (r: Run): void => expect({ exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  for (const id of [OTHER_UUID, OTHER_HOST, "", 42, ABSENT]) {
    const word = typeof id === "symbol" ? "missing" : JSON.stringify(id);
    test(`AC-STE-871.7: cloudId ${word}: a write on the repository's key is silent`, async () => silent(await sendEdit(none, OWN, id)));
    test(`AC-STE-871.7: cloudId ${word}: evidence fetched at it counts`, async () => silent(await sendEdit(none, TICKET, UUID, fetched(new Transcript(), id))));
  }
  test("AC-STE-871.7: blank keys read as undeclared", async () => silent(await sendEdit(world({}, {}, true), OWN, OTHER_UUID)));
  test("AC-STE-871.7: a browse URL on any host resolves", async () => silent(await sendEdit(none, browse(OTHER_HOST, OWN), UUID)));
  test("AC-STE-871.7: an unshared repository that declares a site stays silent", async () => silent(await sendEdit(world({ site: HOST }, { unshared: true }), OWN, OTHER_UUID)));
  test("AC-STE-871.7: an unowned key refuses as before, with no site named", async () => {
    const r = await sendEdit(none, TICKET, OTHER_UUID);
    refuses(r);
    expect(r.stderr).not.toContain(OTHER_UUID);
  });
});

/** Remove the plugin copies a mutant leg made once it is graded (each holds a full adapters tree); afterAll stays the backstop. */
function dropCopies(roots: string[]): void {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}

/** A copy of the shipped code with `edit` applied to `rel`; unmutated without it. */
function pluginCopy(rel?: string, change?: (src: string) => string): string {
  const root = tempDir("ste871-plugin");
  for (const d of ["adapters", "templates", "hooks"]) cpSync(join(PLUGIN_ROOT, d), join(root, d), { recursive: true });
  if (rel !== undefined && change !== undefined) {
    const p = join(root, rel);
    const src = readFileSync(p, "utf-8");
    const out = change(src);
    expect(out).not.toBe(src);
    writeFileSync(p, out);
  }
  return root;
}
/** One mutant per call of `fn` in the files, that call alone answering true. */
function mutants(fn: string, files: string[]): string[] {
  return files.flatMap((rel) => {
    const src = readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
    const at = [...src.matchAll(new RegExp(`(?<!function )\\b${fn}\\(`, "g"))].map((m) => m.index!).filter((i) => !/^\s*(\/\/|\/?\*)/.test(src.slice(src.lastIndexOf("\n", i) + 1, i)));
    return at.map((i) => pluginCopy(rel, (s) => `${s.slice(0, i)}((..._a: unknown[]) => true)(${s.slice(i + fn.length + 1)}`));
  });
}
async function someFlips(roots: string[], leg: (root: string) => Promise<Run>, twin: (root: string) => Promise<Run>): Promise<void> {
  const control = pluginCopy();
  refuses(await leg(control));
  permits(await twin(control));
  let flipped = 0;
  try {
    for (const r of roots) if (permitProblem(await leg(r)) === null) flipped += 1;
  } finally {
    dropCopies([control, ...roots]);
  }
  expect(flipped).toBeGreaterThan(0);
}
const badWrite = (root: string): Promise<Run> => sendEdit(both, OWN, OTHER_UUID, new Transcript(), { root });
const goodWrite = (root: string): Promise<Run> => sendEdit(both, OWN, UUID, new Transcript(), { root });
const badFetch = (root: string): Promise<Run> => sendEdit(both, TICKET, UUID, fetched(new Transcript(), OTHER_UUID), { root });
const goodFetch = (root: string): Promise<Run> => sendEdit(both, TICKET, UUID, fetched(new Transcript(), UUID), { root });
const badBrowse = (root: string): Promise<Run> => send(siteOnly, "direct", "createIssueLink", linkAt(browse(OTHER_HOST, OWN))[0]![2], HOST, new Transcript(), { root });
const goodBrowse = (root: string): Promise<Run> => send(siteOnly, "direct", "createIssueLink", linkAt(browse(HOST, OWN))[0]![2], HOST, new Transcript(), { root });
const HOOK_FILES = [hookModuleRel, CALL_REL];

describe("AC-STE-871.10 — removing a check turns a named test red", () => {
  test('AC-STE-871.10: hook write check removed → "REFUSE — direct v1 edit at another site" fails', () => someFlips(mutants("siteMatches", HOOK_FILES), badWrite, goodWrite));
  test('AC-STE-871.10: hook evidence check removed → "REFUSE — direct getJiraIssue answered by another site" fails', () => someFlips(mutants("siteMatches", HOOK_FILES), badFetch, goodFetch));
  test('AC-STE-871.10: hook browse-host check removed → "REFUSE — direct v1 link inward on another host" fails', () => someFlips(mutants("browseHostMatches", HOOK_FILES), badBrowse, goodBrowse));
  test('AC-STE-871.10: exact host comparison removed → the prefixed- and suffixed-host tests of AC-STE-871.2 fail', async () => {
    const loose = pluginCopy(SITE_REL, (s) => {
      expect(s.split("export function siteMatches(").length - 1, "one `export function siteMatches(`").toBe(1);
      return `${s.replace("export function siteMatches(", "export function siteMatchesExact(")}
export function siteMatches(b: any, c: any): boolean {
  return siteMatchesExact(b, typeof c === "string" && b.site && c.toLowerCase().includes(b.site) ? b.site : c);
}
`;
    });
    for (const h of [`a.${HOST}`, `${HOST}.evil.example.invalid`]) {
      refuses(await sendEdit(both, OWN, h, new Transcript(), { root: pluginCopy() }));
      permits(await sendEdit(both, OWN, h, new Transcript(), { root: loose }));
    }
  });
});
