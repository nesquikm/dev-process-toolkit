// STE-871 (M_e8850b) — the live grader gives the hook's verdict on the declared
// Jira site, `extract` records it through redaction, and the create decision
// that reads calls from the transcript (`decide --from-transcript`) refuses
// pages from another site (AC-STE-871.4 / .8 / .10).
//
// Bundle roots carry optional `site` / `cloudId`. Every refuse leg has a permit
// twin that differs in the site only. Invented hosts and UUIDs.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { EPIC, PLUGIN_ROOT, TAG, Transcript, cleanupTemps, graderRel, hookModuleRel, jiraTicket, makeWorld, moduleRel, runModule, show, tempDir, type World } from "./_m_b2fdc0_ste729_fixture";
import { buildPassingBundle, clone, materialize, serverPrefix, type BundleSession, type LiveBundle, type Root, type ToolCall, type TrackerItem } from "./_live_bundle_fixtures";
import { commitAll } from "./_span_fixture";

setDefaultTimeout(180_000);
afterAll(cleanupTemps);

type Obj = Record<string, unknown>;
type How = "direct" | "wrapped";
const HOWS: How[] = ["direct", "wrapped"];
const HOST = "tracker.example.invalid";
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const OTHER_HOST = "other.example.invalid";
const OTHER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const ABSENT = Symbol("absent");
const SITE_REL = moduleRel("atlassian_site.ts");
const CALL_REL = moduleRel("atlassian_call.ts");
const PROBE_REL = moduleRel("create_idempotency_probe.ts");

type Declared = { site?: string; cloudId?: string };
const BOTH: Declared = { site: HOST, cloudId: UUID };
const SITE_ONLY: Declared = { site: HOST };
const ID_ONLY: Declared = { cloudId: UUID };

interface Grader {
  gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { outcome?: string; findings: Array<{ code: string; detail?: string }> };
  extractBundle: (o: Obj) => { ok: true; bundle: LiveBundle } | { ok: false; verdict: unknown };
}
const grader = async (root = PLUGIN_ROOT): Promise<Grader> => (await import(join(root, graderRel))) as unknown as Grader;
const findings = async (b: LiveBundle, root = PLUGIN_ROOT): Promise<Array<{ code: string; detail?: string }>> => (await grader(root)).gradeBundle(clone(b), { behaviourDigestNow: b.run.behaviourDigest.digest }).findings;
const flagged = async (b: LiveBundle, ref: string, root = PLUGIN_ROOT): Promise<boolean> => (await findings(b, root)).some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${ref}:`));

/** The passing bundle with every Jira call sent to `site`, both roots declaring `d`. */
function declaredBundle(d: Declared, sent: string | null = d.cloudId ?? d.site ?? null): LiveBundle {
  const b = clone(buildPassingBundle("jira"));
  if (sent !== null) for (const s of b.sessions) for (const c of s.calls) if (c.name.startsWith("mcp__")) c.input.cloudId = sent;
  Object.assign(b.roots.A, d);
  Object.assign(b.roots.B, d);
  return b;
}

let seq = 0;
function append(s: BundleSession, how: How, op: string, inputs: Obj, cloudId: unknown, o: { items?: TrackerItem[]; isError?: boolean; read?: boolean; server?: string } = {}): ToolCall {
  const id = cloudId === ABSENT ? {} : { cloudId };
  const p = o.server ? `mcp__${o.server}__` : serverPrefix("jira", s.root);
  const c: ToolCall = {
    ref: `${s.sessionId}:toolu_871_${++seq}`,
    at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(),
    name: p + (how === "direct" ? op : o.read ? "executeRead" : "executeWrite"),
    input: how === "direct" ? { ...id, ...inputs } : { name: op, inputs, ...id },
    result: { isError: o.isError ?? false, text: o.isError ? "Jira 503" : "", exitCode: null, items: o.isError ? null : (o.items ?? []), lastPage: null },
    sidechain: false,
  };
  s.calls.push(c);
  return c;
}
interface Ctx {
  b: LiveBundle;
  s: BundleSession;
  own: string;
  foreign: string;
  ticket: string;
  item: (key: string, labels?: string[]) => TrackerItem;
}
/** Root B's S13 session, with one FR-bound key and one key only evidence can own. */
function ctx(d: Declared): Ctx {
  const b = declaredBundle(d);
  const s = b.sessions.find((x) => x.marker === "S13")!;
  const own = `${b.run.container}-890`;
  b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key: own, milestone: null });
  const item = (key: string, labels = [b.roots[s.root].tag]): TrackerItem => ({ key, summary: `Ticket ${key}`, labels, status: "To Do", parent: null, milestone: null, issueType: "Task", kind: "issue", container: b.run.container });
  return { b, s, own, foreign: `${b.run.container}-9001`, ticket: `${b.run.container}-960`, item };
}
const edit = (key: string): Obj => ({ issueIdOrKey: key, fields: { summary: "Retitled" } });
const fetchOf = (x: Ctx, cloudId: unknown, o: { how?: How; labels?: string[]; isError?: boolean; subject?: string; server?: string } = {}): ToolCall =>
  append(x.s, o.how ?? "direct", "getJiraIssue", { issueIdOrKey: o.subject ?? x.ticket }, cloudId, { items: [x.item(x.ticket, o.labels)], isError: o.isError, read: true, server: o.server });
/** The verdict on one write by `x` after `before`. */
async function write(d: Declared, how: How, op: string, inputs: (x: Ctx) => Obj, cloudId: unknown, o: { before?: (x: Ctx) => void; root?: string; server?: string } = {}): Promise<boolean> {
  const x = ctx(d);
  o.before?.(x);
  const c = append(x.s, how, op, inputs(x), cloudId, { server: o.server });
  return flagged(x.b, c.ref, o.root);
}

// ------------------------------------------------------------- write check

const graph = (a: string, b: string): Obj => ({ objectIdentifier: a, targetObjectIdentifier: b, relationshipType: "jira-work-item-links-jira-work-item" });
const OPS: Array<[string, string, (own: string, foreign: string) => Obj]> = [
  ["v1 edit", "editJiraIssue", (k) => edit(k)],
  ["v2 edit", "editJiraIssue", (k) => ({ issueIdOrKey: k, additional_fields: { summary: "Retitled" } })],
  ["v1 transition", "transitionJiraIssue", (k) => ({ issueIdOrKey: k, transition: { id: "31" } })],
  ["v2 transition", "transitionJiraIssue", (k) => ({ issueIdOrKey: k, transitionId: "31" })],
  ["v1 comment", "addCommentToJiraIssue", (k) => ({ issueIdOrKey: k, commentBody: "Noted." })],
  ["v2 comment", "addOrEditJiraIssueComment", (k) => ({ issueIdOrKey: k, body: "Noted." })],
  ["v1 worklog", "addWorklogToJiraIssue", (k) => ({ issueIdOrKey: k, timeSpent: "1h" })],
  ["v2 worklog", "addOrEditJiraIssueWorklog", (k) => ({ issueIdOrKey: k, timeSpent: "1h" })],
  ["v1 link", "createIssueLink", (k, f) => ({ type: "Blocks", inwardIssue: k, outwardIssue: f })],
  ["v2 link", "createJiraIssueLink", (k, f) => ({ linkType: "Blocks", inwardIssue: f, outwardIssue: k })],
  ["v1 graph link", "addTeamworkGraphContext", (k, f) => graph(k, f)],
  ["v2 graph link", "addGraphContext", (k, f) => graph(f, k)],
];

describe("AC-STE-871.8 — the grader's write check", () => {
  for (const [what, op, i] of OPS) {
    for (const how of HOWS) {
      test(`AC-STE-871.8: REFUSE — grader — ${how} ${what} at another site`, async () => expect(await write(BOTH, how, op, (x) => i(x.own, x.foreign), OTHER_UUID)).toBe(true));
      test(`AC-STE-871.8: PERMIT TWIN — grader — ${how} ${what} at the declared site`, async () => expect(await write(BOTH, how, op, (x) => i(x.own, x.foreign), UUID)).toBe(false));
    }
  }
  for (const v of [UUID.toUpperCase(), HOST, HOST.toUpperCase(), `https://${HOST}`, `HTTPS://${HOST.toUpperCase()}`]) test(`AC-STE-871.8: PERMIT — grader — cloudId ${v}`, async () => expect(await write(BOTH, "direct", "editJiraIssue", (x) => edit(x.own), v)).toBe(false));
  for (const v of [OTHER_HOST, `a.${HOST}`, `${HOST}.evil.example.invalid`, `x${HOST}`, `${HOST}x`, `http://${HOST}`, `https://${HOST}:8443`, "", "  ", 42, null, [UUID], { id: UUID }, ABSENT]) {
    test(`AC-STE-871.8: REFUSE — grader — cloudId ${typeof v === "symbol" ? "missing" : JSON.stringify(v)}`, async () => expect(await write(BOTH, "direct", "editJiraIssue", (x) => edit(x.own), v)).toBe(true));
  }
  test("AC-STE-871.8: REFUSE — grader — site only, UUID sent", async () => expect(await write(SITE_ONLY, "direct", "editJiraIssue", (x) => edit(x.own), UUID)).toBe(true));
  test("AC-STE-871.8: REFUSE — grader — cloud_id only, host sent", async () => expect(await write(ID_ONLY, "direct", "editJiraIssue", (x) => edit(x.own), HOST)).toBe(true));
  for (const server of ["claude_ai_Atlassian", "my-own_tracker_atlassian"]) {
    test(`AC-STE-871.6: PERMIT — grader — ${server} at the declared site`, async () => expect(await write(BOTH, "direct", "editJiraIssue", (x) => edit(x.own), UUID, { server })).toBe(false));
    test(`AC-STE-871.6: REFUSE — grader — ${server} at another site`, async () => expect(await write(BOTH, "direct", "editJiraIssue", (x) => edit(x.own), OTHER_UUID, { server })).toBe(true));
  }
});

/** The bundle's own decided creates: a ticket create and the S3 Epic create with its re-list. */
function creates(b: LiveBundle): { s: BundleSession; ticket: ToolCall; epicSession: BundleSession; epic: ToolCall; relists: ToolCall[] } {
  const at = (marker: string, root: Root): BundleSession => b.sessions.find((x) => x.marker === marker && x.root === root)!;
  const s = at("S1", "A");
  const epicSession = at("S3", "A");
  const epic = epicSession.calls.find((c) => c.name.endsWith("__createJiraIssue") && c.input.issueTypeName === "Epic")!;
  const end = epicSession.calls.indexOf(epic);
  return { s, ticket: s.calls.find((c) => c.name.endsWith("__createJiraIssue"))!, epicSession, epic, relists: epicSession.calls.slice(0, end).filter((c) => c.name.endsWith("__searchJiraIssuesUsingJql")) };
}
const wrapIt = (c: ToolCall, read: boolean): void => {
  const { cloudId, ...inputs } = c.input;
  const op = c.name.split("__").at(-1)!;
  c.name = c.name.replace(op, read ? "executeRead" : "executeWrite");
  c.input = { name: op, inputs, cloudId };
};

describe("AC-STE-871.8 — the grader's create and re-list checks", () => {
  for (const how of HOWS) {
    for (const [word, id] of [["REFUSE", OTHER_UUID], ["PERMIT TWIN", HOST]] as const) {
      for (const which of ["ticket", "epic"] as const) {
        test(`AC-STE-871.8: ${word} — grader — ${how} ${which} create at ${id}`, async () => {
          const b = declaredBundle(BOTH);
          const c = creates(b)[which];
          c.input.cloudId = id;
          if (how === "wrapped") wrapIt(c, false);
          expect(await flagged(b, c.ref)).toBe(id === OTHER_UUID);
        });
      }
      test(`AC-STE-871.8: ${word} — grader — ${how} re-list answered by ${id}`, async () => {
        const b = declaredBundle(BOTH);
        const { epic, relists } = creates(b);
        expect(relists.length).toBeGreaterThan(0);
        for (const r of relists) {
          r.input.cloudId = id;
          if (how === "wrapped") wrapIt(r, true);
        }
        expect(await flagged(b, epic.ref)).toBe(id === OTHER_UUID);
      });
    }
  }
  for (const [word, id] of [["another site", OTHER_UUID], ["the declared site (TWIN)", UUID]] as const) {
    test(`AC-STE-871.8: grader — an open same-title Epic listed by ${word}`, async () => {
      const b = declaredBundle(BOTH);
      const { epicSession, epic, relists } = creates(b);
      const dup = clone(relists.at(-1)!);
      dup.ref = `${epicSession.sessionId}:toolu_871_dup`;
      dup.input.cloudId = id;
      dup.result.items = [{ ...clone(epic.result.items![0]!), key: `${b.run.container}-777` }];
      epicSession.calls.splice(epicSession.calls.indexOf(epic), 0, dup);
      expect(await flagged(b, epic.ref)).toBe(id === UUID);
    });
  }
});

// --------------------------------------------------------------- evidence

const editTicket = (before: (x: Ctx) => void, d: Declared = BOTH, root?: string): Promise<boolean> => write(d, "direct", "editJiraIssue", (x) => edit(x.ticket), d.cloudId ?? d.site ?? UUID, { before, root });
const SIB = (x: Ctx): string => x.b.roots[x.s.root === "A" ? "B" : "A"].tag;

describe("AC-STE-871.8 — the grader's evidence check", () => {
  for (const how of HOWS) {
    test(`AC-STE-871.8: REFUSE — grader — ${how} getJiraIssue answered by another site`, async () => expect(await editTicket((x) => void fetchOf(x, OTHER_UUID, { how }))).toBe(true));
    test(`AC-STE-871.8: PERMIT TWIN — grader — ${how} getJiraIssue answered by the declared site`, async () => expect(await editTicket((x) => void fetchOf(x, HOST, { how }))).toBe(false));
    const made = (x: Ctx, id: string): void =>
      void append(x.s, how, "createJiraIssue", { projectKey: x.b.run.container, issueTypeName: "Task", summary: "Made", additional_fields: { labels: [x.b.roots[x.s.root].tag] } }, id, { items: [x.item(x.ticket)] });
    test(`AC-STE-871.8: REFUSE — grader — ${how} create answered by another site`, async () => expect(await editTicket((x) => made(x, OTHER_UUID))).toBe(true));
    test(`AC-STE-871.8: PERMIT TWIN — grader — ${how} create answered by the declared site`, async () => expect(await editTicket((x) => made(x, HOST))).toBe(false));
  }
  for (const id of [ABSENT, "", 7]) test(`AC-STE-871.8: REFUSE — grader — a fetch with cloudId ${typeof id === "symbol" ? "missing" : JSON.stringify(id)}`, async () => expect(await editTicket((x) => void fetchOf(x, id))).toBe(true));
  test("AC-STE-871.8: grader — a newer other-site answer does not hide an older matching one", async () => expect(await editTicket((x) => { fetchOf(x, UUID); fetchOf(x, OTHER_UUID, { labels: [SIB(x)] }); })).toBe(false));
  test("AC-STE-871.8: grader — a newer other-site error does not hide an older matching answer", async () => expect(await editTicket((x) => { fetchOf(x, UUID); fetchOf(x, OTHER_UUID, { isError: true }); })).toBe(false));
  test("AC-STE-871.8: grader — a newer other-site answer proves nothing over a matching sibling's answer", async () => expect(await editTicket((x) => { fetchOf(x, UUID, { labels: [SIB(x)] }); fetchOf(x, OTHER_UUID); })).toBe(true));
  test("AC-STE-871.8: grader — two roots with different sites: each is read at its own", async () => {
    const run = async (id: string): Promise<boolean> => {
      const x = ctx(BOTH);
      const other: Root = x.s.root === "A" ? "B" : "A";
      Object.assign(x.b.roots[other], { site: OTHER_HOST, cloudId: OTHER_UUID });
      const c = append(x.s, "direct", "editJiraIssue", edit(x.own), id);
      return flagged(x.b, c.ref);
    };
    expect(await run(UUID)).toBe(false);
    expect(await run(OTHER_UUID)).toBe(true);
  });
});

// Review finding 2, grader twin: a root in scope that declares no site takes the
// site of the sibling that does, as the hook's `inheritSites`.
describe("AC-STE-871.8 — the grader: an undeclared sibling launders nothing", () => {
  /** S13's root declares no site; the other root, which declares BOTH, is put in scope by one of its announcements. */
  const run = async (fetchAt: string, writeAt: string, o: { inScope?: boolean; key?: (x: Ctx) => string } = {}): Promise<boolean> => {
    const x = ctx(BOTH);
    const other: Root = x.s.root === "A" ? "B" : "A";
    delete x.b.roots[x.s.root].site;
    delete x.b.roots[x.s.root].cloudId;
    if (o.inScope !== false) {
      const a = x.b.sessions.filter((s) => s.root === other).flatMap((s) => s.calls).find((c) => c.name === "Bash" && !c.result.isError && new RegExp(`^dpt-receipt: <${other}>/`, "m").test(c.result.text));
      expect(a, "fixture: an announcement by the other root").toBeDefined();
      x.s.calls.push({ ...clone(a!), ref: `${x.s.sessionId}:toolu_871_ann_${++seq}`, at: new Date(Date.parse(x.s.calls.at(-1)!.at) + 1000).toISOString(), sidechain: false });
    }
    fetchOf(x, fetchAt);
    const c = append(x.s, "direct", "editJiraIssue", edit(o.key ? o.key(x) : x.ticket), writeAt);
    return flagged(x.b, c.ref);
  };
  test("AC-STE-871.8: REFUSE — grader — another-site fetch and edit owned only through the undeclared root", async () => expect(await run(OTHER_UUID, OTHER_UUID)).toBe(true));
  test("AC-STE-871.8: REFUSE — grader — an edit at the declared site owned only by an another-site fetch", async () => expect(await run(OTHER_UUID, UUID)).toBe(true));
  test("AC-STE-871.8: PERMIT TWIN — grader — the fetch and the edit at the declared site", async () => expect(await run(UUID, UUID)).toBe(false));
  test("AC-STE-871.8: REFUSE — grader — the undeclared root's FR key at another site", async () => expect(await run(UUID, OTHER_UUID, { key: (x) => x.own })).toBe(true));
  test("AC-STE-871.8: PERMIT TWIN — grader — the undeclared root's FR key at the declared site", async () => expect(await run(UUID, UUID, { key: (x) => x.own })).toBe(false));
  test("AC-STE-871.7: CONTROL — grader — with no declaring root in scope the undeclared root grades as today", async () => expect(await run(OTHER_UUID, OTHER_UUID, { inScope: false })).toBe(false));
});

// Review finding 3, grader twin: an earlier create under another spelling of the
// site still settles the ticket, as the hook's `priorCreates`.
describe("AC-STE-871.8 — the grader: a create under another cloudId spelling still counts", () => {
  for (const which of ["ticket", "epic"] as const) {
    const what = which === "ticket" ? "a ticket" : "an Epic";
    test(`AC-STE-871.8: REFUSE — grader — ${what} created under the UUID, created again under the declared host`, async () => {
      const b = declaredBundle(SITE_ONLY);
      const all = creates(b);
      const c = all[which];
      const s = which === "ticket" ? all.s : all.epicSession;
      const dup = clone(c);
      dup.ref = `${s.sessionId}:toolu_871_first_${which}`;
      dup.input.cloudId = UUID;
      s.calls.splice(s.calls.indexOf(c), 0, dup);
      expect(await flagged(b, c.ref)).toBe(true);
    });
    test(`AC-STE-871.8: PERMIT TWIN — grader — the same ${which === "ticket" ? "ticket" : "Epic"} create with no earlier create`, async () => {
      const b = declaredBundle(SITE_ONLY);
      expect(await flagged(b, creates(b)[which].ref)).toBe(false);
    });
  }
});

// ------------------------------------------------------------- browse URLs

const browse = (host: string, key: string): string => `https://${host}/browse/${key}`;
const SIDES: Array<[string, string, (side: string, f: string) => Obj]> = [
  ["v1 link", "createIssueLink", (s, f) => ({ type: "Blocks", inwardIssue: s, outwardIssue: f })],
  ["v2 link", "createJiraIssueLink", (s, f) => ({ linkType: "Blocks", inwardIssue: f, outwardIssue: s })],
  ["v1 graph object", "addTeamworkGraphContext", (s, f) => graph(s, f)],
  ["v2 graph target", "addGraphContext", (s, f) => graph(f, s)],
  ...OPS.slice(0, 8),
];
describe("AC-STE-871.8 — the grader's browse-host check", () => {
  for (const [what, op, i] of SIDES) {
    for (const how of HOWS) {
      const leg = (d: Declared, host: string): Promise<boolean> => write(d, how, op, (x) => i(browse(host, x.own), x.foreign), d.site ?? d.cloudId);
      test(`AC-STE-871.8: REFUSE — grader — ${how} ${what} on another host`, async () => expect(await leg(SITE_ONLY, OTHER_HOST)).toBe(true));
      test(`AC-STE-871.8: PERMIT TWIN — grader — ${how} ${what} on the declared host`, async () => expect(await leg(SITE_ONLY, HOST)).toBe(false));
      test(`AC-STE-871.8: cloud_id only — grader — ${how} ${what} on any host resolves as today`, async () => expect(await leg(ID_ONLY, OTHER_HOST)).toBe(false));
    }
  }
  for (const host of [`${HOST}:8443`, `u@${HOST}`, `${HOST}.`, `a.${HOST}`, `${HOST}.evil.example.invalid`]) test(`AC-STE-871.8: REFUSE — grader — a link side on ${host}`, async () => expect(await write(SITE_ONLY, "direct", "createIssueLink", (x) => ({ type: "Blocks", inwardIssue: browse(host, x.own), outwardIssue: x.foreign }), HOST)).toBe(true));
  test("AC-STE-871.8: REFUSE — grader — evidence fetched by a URL on another host", async () => expect(await editTicket((x) => void fetchOf(x, HOST, { subject: browse(OTHER_HOST, x.ticket) }), SITE_ONLY)).toBe(true));
  test("AC-STE-871.8: PERMIT TWIN — grader — evidence fetched by a URL on the declared host", async () => expect(await editTicket((x) => void fetchOf(x, HOST, { subject: browse(HOST, x.ticket) }), SITE_ONLY)).toBe(false));
});

describe("AC-STE-871.7 — a bundle without the keys grades as today", () => {
  test("AC-STE-871.7: grader — the passing bundle has no ungated write, whatever its cloudId", async () => {
    expect((await findings(buildPassingBundle("jira"))).filter((f) => f.code === "ungated-write")).toEqual([]);
    expect((await findings(declaredBundle({}, OTHER_UUID))).filter((f) => f.code === "ungated-write")).toEqual([]);
  });
  test("AC-STE-871.8: CONTROL — grader — the passing bundle at its declared site has none either", async () => {
    expect((await findings(declaredBundle(BOTH))).filter((f) => f.code === "ungated-write")).toEqual([]);
  });
});

describe("AC-STE-871.8 — one shared function compares sites", () => {
  for (const rel of [hookModuleRel, graderRel, PROBE_REL]) test(`AC-STE-871.8: ${rel} reads atlassian_site`, () => expect(readFileSync(join(PLUGIN_ROOT, rel), "utf-8")).toMatch(/["'][^"'\n]*\/atlassian_site(\.ts)?["']/));
});

// ---------------------------------------------------------------- extract

const REAL_OWN = "fixture-own.atlassian.net";
const REAL_OTHER = "fixture-other.atlassian.net";
describe("AC-STE-871.8 — extract records the declared site and keeps hosts apart", () => {
  /** The bundle read back from disk, B's CLAUDE.md declaring `lines`, with one write at each cloudId. */
  async function extracted(lines: string[], ids: string[]): Promise<{ bundle: LiveBundle; refs: string[] }> {
    const x = ctx({});
    const refs = ids.map((id) => append(x.s, "direct", "editJiraIssue", edit(x.own), id, { items: [x.item(x.own)] }).ref);
    const m = materialize(x.b, tempDir("records"));
    for (const r of ["A", "B"] as const) {
      const tag = x.b.roots[r].tag;
      writeFileSync(join(m.roots[r], "CLAUDE.md"), ["# Fixture", "", "## Task Tracking", "", "mode: jira", "", "### Jira", "", `project: ${x.b.run.container}`, `default_labels: [${tag}]`, `repo_tag: ${tag}`, "min_dpt_version: 2.87.0", ...lines, ""].join("\n"));
    }
    const e = (await grader()).extractBundle({ configDirs: [m.configDir], ledgerSessionIds: m.ledger, roots: { A: { path: m.roots.A, tag: x.b.roots.A.tag }, B: { path: m.roots.B, tag: x.b.roots.B.tag } }, run: m.run, synthetic: true });
    if (!e.ok) throw new Error(`fixture: not extracted: ${JSON.stringify(e.verdict)}`);
    return { bundle: e.bundle, refs };
  }
  test("AC-STE-871.8: both keys reach the bundle's roots", async () => {
    const { bundle } = await extracted([`site: ${REAL_OWN}`, `cloud_id: ${UUID}`], []);
    for (const r of ["A", "B"] as const) {
      const root = bundle.roots[r] as unknown as Obj;
      expect(root.cloudId).toBe(UUID);
      expect(typeof root.site).toBe("string");
      expect(root.site).not.toBe("");
    }
  });
  test("AC-STE-871.8: a root that declares neither carries neither key", async () => {
    const { bundle } = await extracted([], []);
    for (const r of ["A", "B"] as const) expect(Object.keys(bundle.roots[r]).sort()).toEqual(["name", "tag"]);
  });
  test("AC-STE-871.8: after redaction the declared host passes, every other fails, and no real host stays", async () => {
    const own = [REAL_OWN, REAL_OWN.toUpperCase(), `https://${REAL_OWN}`];
    const other = [REAL_OTHER, `https://${REAL_OTHER}`, `a.${REAL_OWN}`, `x${REAL_OWN}`, `${REAL_OWN}.evil.example.invalid`, "<site>"];
    const { bundle, refs } = await extracted([`site: ${REAL_OWN}`], [...own, ...other]);
    const verdicts = await Promise.all(refs.map((r) => flagged(bundle, r)));
    expect(verdicts).toEqual([...own.map(() => false), ...other.map(() => true)]);
    const text = JSON.stringify(bundle).toLowerCase();
    expect(text).not.toContain(REAL_OWN);
    expect(text).not.toContain(REAL_OTHER);
    expect(text).not.toContain("fixture-own.atlassian");
  });
  test("AC-STE-871.8: a cloud_id declaration survives extraction", async () => {
    const { bundle, refs } = await extracted([`cloud_id: ${UUID}`], [UUID, OTHER_UUID]);
    expect(await Promise.all(refs.map((r) => flagged(bundle, r)))).toEqual([false, true]);
  });
});

// ------------------------------------------------- decide --from-transcript

const TITLE = "Payout export";
describe("AC-STE-871.4 — decide --from-transcript", () => {
  let declared: World;
  let none: World;
  let printed: Obj = {};
  beforeAll(() => {
    declared = makeWorld();
    const p = join(declared.root, "CLAUDE.md");
    writeFileSync(p, readFileSync(p, "utf-8").replace("### Jira\n\n", `### Jira\n\nsite: ${HOST}\ncloud_id: ${UUID}\n`));
    commitAll(declared.root, "fixture: declare the site");
    none = makeWorld();
    const r = runModule(PLUGIN_ROOT, "create_idempotency_probe.ts", ["query", none.root, "--title", TITLE, "--parent", EPIC]);
    if (r.exitCode !== 0) throw new Error(`fixture: query failed\n${show(r)}`);
    printed = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("{"))!) as Obj;
  });
  const row = (key: string, summary: string): Obj => ({ key, id: "10150", fields: { ...(jiraTicket(key).fields as Obj), summary, labels: [TAG], parent: { key: EPIC } } });
  const page = (issues: Obj[], next?: string): Obj => ({ issues, isLast: next === undefined, ...(next === undefined ? {} : { nextPageToken: next }) });
  let n = 0;
  function decide(w: World, how: How, calls: Array<{ id: unknown; answer: Obj; token?: string }>, root = PLUGIN_ROOT): Obj {
    const t = new Transcript();
    const ids = calls.map((c) => {
      const inputs = { ...printed, ...(c.token ? { nextPageToken: c.token } : {}) };
      const id = c.id === ABSENT ? {} : { cloudId: c.id };
      const u = how === "direct" ? t.use("mcp__atlassian__searchJiraIssuesUsingJql", { ...id, ...inputs }) : t.use("mcp__atlassian__executeRead", { name: "searchJiraIssuesUsingJql", inputs, ...id });
      t.result(u, [{ type: "text", text: JSON.stringify(c.answer) }]);
      return u;
    });
    const path = join(w.scratch, `transcript-${++n}.jsonl`);
    writeFileSync(path, `${t.lines.join("\n")}\n`);
    const r = runModule(root, "create_idempotency_probe.ts", ["decide", w.root, "--from-transcript", path, ...ids, "--title", TITLE, "--parent", EPIC, "--attempt", "fast"]);
    const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
    if (line === undefined) throw new Error(`decide printed no decision:\n${show(r)}`);
    return JSON.parse(line) as Obj;
  }
  const hit = (): Obj => page([row("PROJ-150", TITLE)]);
  for (const how of HOWS) {
    for (const id of [OTHER_UUID, OTHER_HOST, `a.${HOST}`, "", ABSENT]) {
      const word = typeof id === "symbol" ? "missing" : JSON.stringify(id);
      test(`AC-STE-871.4: REFUSE — decide — ${how} empty search page, cloudId ${word}`, () => expect(decide(declared, how, [{ id, answer: page([]) }]).outcome).toBe("refused"));
      test(`AC-STE-871.4: REFUSE — decide — ${how} matching search page, cloudId ${word}`, () => expect(decide(declared, how, [{ id, answer: hit() }]).outcome).toBe("refused"));
    }
    for (const id of [UUID, UUID.toUpperCase(), HOST, `https://${HOST}`]) {
      test(`AC-STE-871.4: PERMIT TWIN — decide — ${how} empty search page, cloudId ${id}`, () => expect(decide(declared, how, [{ id, answer: page([]) }])).toMatchObject({ outcome: "create", reason: "proven-absent" }));
      test(`AC-STE-871.4: PERMIT TWIN — decide — ${how} matching search page, cloudId ${id}`, () => expect(decide(declared, how, [{ id, answer: hit() }])).toMatchObject({ outcome: "reused", key: "PROJ-150" }));
    }
    for (const [word, second, outcome] of [["another site", OTHER_UUID, "refused"], ["the declared site (TWIN)", HOST, "reused"]] as const) {
      test(`AC-STE-871.4: decide — ${how} second page from ${word}`, () => expect(decide(declared, how, [{ id: UUID, answer: page([row("PROJ-149", "Another title")], "tok-2") }, { id: second, answer: hit(), token: "tok-2" }]).outcome).toBe(outcome));
    }
    test(`AC-STE-871.7: decide — ${how} with neither key declared any cloudId is read`, () => expect(decide(none, how, [{ id: OTHER_UUID, answer: hit() }])).toMatchObject({ outcome: "reused" }));
  }
  test("AC-STE-871.10: decide's site check removed → the refuse tests above fail", () => {
    const roots = mutants("siteMatches", [PROBE_REL]);
    expect(decide(declared, "direct", [{ id: OTHER_UUID, answer: hit() }], pluginCopy()).outcome).toBe("refused");
    expect(roots.map((r) => decide(declared, "direct", [{ id: OTHER_UUID, answer: hit() }], r).outcome)).toContain("reused");
  });
});

// ---------------------------------------------------------------- mutants
/** Remove the plugin copies a mutant leg made once it is graded (each holds a full adapters tree); afterAll stays the backstop. */
function dropCopies(roots: string[]): void {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}


function pluginCopy(rel?: string, change?: (src: string) => string): string {
  const root = tempDir("ste871-plugin");
  // The manifest keeps the version floor readable for spawned modules.
  for (const d of ["adapters", "templates", "hooks", ".claude-plugin"]) cpSync(join(PLUGIN_ROOT, d), join(root, d), { recursive: true });
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
async function someFlips(roots: string[], leg: (root: string) => Promise<boolean>, twin: (root: string) => Promise<boolean>): Promise<void> {
  const control = pluginCopy();
  expect(await leg(control)).toBe(true);
  expect(await twin(control)).toBe(false);
  const verdicts: boolean[] = [];
  try {
    for (const r of roots) verdicts.push(await leg(r));
  } finally {
    dropCopies([control, ...roots]);
  }
  expect(verdicts).toContain(false);
}
const FILES = [graderRel, CALL_REL];
const writeAt = (id: string) => (root: string): Promise<boolean> => write(BOTH, "direct", "editJiraIssue", (x) => edit(x.own), id, { root });
const fetchAt = (id: string) => (root: string): Promise<boolean> => editTicket((x) => void fetchOf(x, id), BOTH, root);
const sideAt = (host: string) => (root: string): Promise<boolean> => write(SITE_ONLY, "direct", "createIssueLink", (x) => ({ type: "Blocks", inwardIssue: browse(host, x.own), outwardIssue: x.foreign }), HOST, { root });

describe("AC-STE-871.10 — removing a grader check turns a named test red", () => {
  test('AC-STE-871.10: grader write check removed → "REFUSE — grader — direct v1 edit at another site" fails', () => someFlips(mutants("siteMatches", FILES), writeAt(OTHER_UUID), writeAt(UUID)));
  test('AC-STE-871.10: grader evidence check removed → "REFUSE — grader — direct getJiraIssue answered by another site" fails', () => someFlips(mutants("siteMatches", FILES), fetchAt(OTHER_UUID), fetchAt(UUID)));
  test('AC-STE-871.10: grader browse-host check removed → "REFUSE — grader — direct v1 link on another host" fails', () => someFlips(mutants("browseHostMatches", FILES), sideAt(OTHER_HOST), sideAt(HOST)));
  test('AC-STE-871.10: exact host comparison removed → "REFUSE — grader — cloudId a.<host>" fails', async () => {
    const loose = pluginCopy(SITE_REL, (s) => {
      expect(s.split("export function siteMatches(").length - 1, "one `export function siteMatches(`").toBe(1);
      return `${s.replace("export function siteMatches(", "export function siteMatchesExact(")}
export function siteMatches(b: any, c: any): boolean {
  return siteMatchesExact(b, typeof c === "string" && b.site && c.toLowerCase().includes(b.site) ? b.site : c);
}
`;
    });
    for (const h of [`a.${HOST}`, `${HOST}.evil.example.invalid`]) {
      expect(await writeAt(h)(pluginCopy())).toBe(true);
      expect(await writeAt(h)(loose)).toBe(false);
    }
  });
});
