// M_b054b1 review r1 — the gate's hardening legs: every payload runs through the
// SHIPPED `.sh` wrapper. Invented keys and sites only.
//
//   STE-866 (F1) a wrapped `inputs` object is checked by no schema, so a decoy
//     subject field never stands in for `issueIdOrKey`
//   STE-865 (F4) a browse URL naming a second key resolves to nothing
//   STE-865 (F5) an `addGraphContext` the gate cannot read is refused
//   STE-867 (F6, F7) the newest fetch governs under every wrapper and spelling
//   STE-866 (F8) another server's tool that only shares an execute name is not ours

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { CLOUD, JIRA, PLUGIN_ROOT, SIBLING_TAG, Transcript, cleanupTemps, gate, jiraTicket, makeWorld, permitProblem, refusalProblem, show, type Run, type World } from "./_m_b2fdc0_ste729_fixture";
import { SocraticFirstTurnViolationError, assertFirstTurnShape } from "../adapters/_shared/src/socratic_first_turn";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";
import { buildPassingBundle, clone, serverPrefix, type LiveBundle, type ToolCall } from "./_live_bundle_fixtures";

setDefaultTimeout(120_000);

type Obj = Record<string, unknown>;
const OWN = "PROJ-112";
const FOREIGN = "PROJ-5";
const fields = { summary: "x" };
const wrap = (name: string, inputs: Obj): Obj => ({ name, inputs, cloudId: CLOUD });

let w: World;
beforeAll(() => {
  w = makeWorld({ boundFr: OWN });
});
afterAll(cleanupTemps);

const ask = (tool: string, input: Obj, t = new Transcript()): Promise<Run> => gate(PLUGIN_ROOT, tool.startsWith("mcp__") ? tool : JIRA(tool), input, t, w.root);
const refused = (r: Run): void => expect(refusalProblem(r), show(r)).toBeNull();
const permitted = (r: Run): void => expect(permitProblem(r), show(r)).toBeNull();

describe("AC-STE-866.2 / .5 — a decoy subject never stands in for issueIdOrKey", () => {
  const DECOYS: Array<[string, Obj]> = [
    ["an unbound key under issue", { issueIdOrKey: "10042", issue: "OTHER-1" }],
    ["an owned key under id", { issueIdOrKey: "10042", id: OWN }],
    ["an unbound key under issueId", { issueIdOrKey: "ari:cloud:jira:x:issue/10042", issueId: "OTHER-1" }],
    ["an owned key under issue beside a foreign key", { issueIdOrKey: FOREIGN, issue: OWN }],
  ];
  for (const [title, subject] of DECOYS) {
    for (const [tool, rest] of [
      ["editJiraIssue", { fields }],
      ["transitionJiraIssue", { transitionId: "4" }],
      ["addOrEditJiraIssueComment", { commentBody: "x" }],
      ["addWorklogToJiraIssue", { timeSpent: "1h" }],
    ] as const) {
      test(`REFUSE — wrapped ${tool}: ${title}`, async () => refused(await ask("executeWrite", wrap(tool, { ...subject, ...rest }))));
      test(`REFUSE — direct ${tool}: ${title}`, async () => refused(await ask(tool, { cloudId: CLOUD, ...subject, ...rest })));
      test(`REFUSE — executeDestructive ${tool}: ${title}`, async () => refused(await ask("executeDestructive", wrap(tool, { ...subject, ...rest }))));
    }
  }
  test("CONTROL — the owned key alone is permitted, direct and wrapped", async () => {
    permitted(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: OWN, fields }));
    permitted(await ask("executeWrite", wrap("editJiraIssue", { issueIdOrKey: OWN, fields })));
  });

  test("the grader reads the decoy as the hook does", async () => {
    const b = buildPassingBundle("jira");
    const s = b.sessions.find((x) => x.marker === "S13")!;
    const own = `${b.run.container}-890`;
    b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key: own, milestone: null });
    expect(await ungated(b, s.sessionId, "executeWrite", wrap("editJiraIssue", { issueIdOrKey: "10042", id: own, fields }))).toBe(true);
    expect(await ungated(b, s.sessionId, "executeWrite", wrap("editJiraIssue", { issueIdOrKey: own, fields }))).toBe(false);
  });
});

/** Whether the grader reports the appended call as an ungated write. */
async function ungated(bundle: LiveBundle, sessionId: string, tool: string, input: Obj): Promise<boolean> {
  const b = clone(bundle);
  const s = b.sessions.find((x) => x.sessionId === sessionId)!;
  const c: ToolCall = { ref: `${s.sessionId}:toolu_r1`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 1000).toISOString(), name: serverPrefix("jira", s.root) + tool, input, result: { isError: false, text: "", exitCode: null, items: [], lastPage: null }, sidechain: false };
  s.calls.push(c);
  const g = (await import("../adapters/_shared/src/shared_tracker_live_grader")) as unknown as { gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Array<{ code: string; detail?: string }> } };
  return g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest }).findings.some((f) => f.code === "ungated-write" && (f.detail ?? "").startsWith(`${c.ref}:`));
}

describe("AC-STE-865.6 — a browse URL naming a second key resolves to nothing", () => {
  for (const url of [
    `https://s.example.invalid/browse/OTHER-1?selectedIssue=${FOREIGN}`,
    `https://s.example.invalid/browse/OTHER-1#/browse/${FOREIGN}`,
    `https://s.example.invalid/browse/OTHER-1/?/../${FOREIGN}`,
    `https://${FOREIGN}@s.example.invalid/browse/OTHER-1`,
    `https://s.example.invalid/browse/${OWN}?issue=${FOREIGN}`,
  ]) {
    test(`REFUSE — ${url}`, async () => refused(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: url, fields })));
  }
  test("CONTROL — an owned key's URL, plain or with a comment query, is permitted", async () => {
    permitted(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: `https://s.example.invalid/browse/${OWN}`, fields }));
    permitted(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: `https://s.example.invalid/browse/${OWN}?focusedCommentId=10042`, fields }));
  });
});

describe("AC-STE-865.7 — an addGraphContext the gate cannot read is refused in a declared container", () => {
  const LINKS = "jira-work-item-links-jira-work-item";
  for (const relationshipType of [undefined, "links", LINKS.toUpperCase(), `${LINKS} `]) {
    test(`REFUSE — relationshipType ${JSON.stringify(relationshipType)} with a foreign target`, async () => {
      refused(await ask("addGraphContext", { cloudId: CLOUD, objectIdentifier: "OTHER-1", targetObjectIdentifier: FOREIGN, ...(relationshipType === undefined ? {} : { relationshipType }) }));
    });
  }
  test("REFUSE — an input the v1 rules have no name for", async () => {
    refused(await ask("addGraphContext", { objectIdentifier: "OTHER-1", relationships: [{ target: FOREIGN }] }));
    refused(await ask("executeWrite", wrap("addGraphContext", { objectIdentifier: "OTHER-1", relationships: [{ target: FOREIGN }] })));
  });
  test("CONTROL — a readable link with an owned side is permitted", async () => {
    permitted(await ask("addGraphContext", { cloudId: CLOUD, objectIdentifier: OWN, targetObjectIdentifier: FOREIGN, relationshipType: LINKS }));
  });
});

describe("AC-STE-867.4 — the newest fetch governs under every wrapper and spelling", () => {
  const KEY = "PROJ-510";
  const edit = { cloudId: CLOUD, issueIdOrKey: KEY, fields };
  const url = `https://s.example.invalid/browse/${KEY}`;
  const read = (t: Transcript, tool: string, input: Obj, answer: unknown): Transcript => {
    const id = t.use(JIRA(tool), input);
    t.result(id, [{ type: "text", text: JSON.stringify(answer) }]);
    return t;
  };
  const owned = jiraTicket(KEY);
  const foreign = jiraTicket(KEY, { labels: [SIBLING_TAG] });
  const direct = (id: string): [string, Obj] => ["getJiraIssue", { cloudId: CLOUD, issueIdOrKey: id }];
  for (const [title, [tool, input]] of [
    ["executeWrite", ["executeWrite", wrap("getJiraIssue", { issueIdOrKey: KEY })]],
    ["executeDestructive", ["executeDestructive", wrap("getJiraIssue", { issueIdOrKey: KEY })]],
    ["a direct browse URL", direct(url)],
    ["an executeRead browse URL", ["executeRead", wrap("getJiraIssue", { issueIdOrKey: url })]],
  ] as Array<[string, [string, Obj]]>) {
    test(`REFUSE — an owned fetch, then a newer foreign one through ${title}`, async () => {
      const t = read(new Transcript(), ...direct(KEY), owned);
      refused(await ask("editJiraIssue", edit, read(t, tool, input, foreign)));
    });
    test(`PERMIT — a foreign fetch, then a newer owned one through ${title}`, async () => {
      const t = read(new Transcript(), ...direct(KEY), foreign);
      permitted(await ask("editJiraIssue", edit, read(t, tool, input, owned)));
    });
  }
});

describe("AC-STE-866.1 — an execute tool of another server that names no operation is not Atlassian's", () => {
  for (const [tool, input] of [
    ["mcp__postgres__executeRead", { query: "select 1" }],
    ["mcp__postgres__executeWrite", { query: "insert" }],
  ] as Array<[string, Obj]>) {
    test(`PERMIT — ${tool} ${JSON.stringify(input)}`, async () => permitted(await ask(tool, input)));
  }
  test("REFUSE — any server's call in the execute shape is graded by its operation", async () => {
    refused(await ask("mcp__renamed__executeWrite", wrap("editJiraIssue", { issueIdOrKey: FOREIGN, fields })));
    refused(await ask("mcp__renamed__executeWrite", { name: "frobnicate", inputs: {} }));
    refused(await ask("executeWrite", { query: "insert" }));
  });
});

describe("AC-STE-866.2 — the recorded v2 link and worklog operations", () => {
  const LINK = (a: string, b: string, extra: Obj = {}): Obj => ({ linkType: "Relates", inwardIssue: a, outwardIssue: b, ...extra });
  const WORK = (k: string, extra: Obj = {}): Obj => ({ issueIdOrKey: k, timeSpent: "1h", ...extra });
  for (const tool of ["executeWrite", "direct"] as const) {
    const run = (op: string, i: Obj): Promise<Run> => (tool === "direct" ? ask(op, { cloudId: CLOUD, ...i }) : ask(tool, wrap(op, i)));
    test(`PERMIT — ${tool} createJiraIssueLink with an owned side`, async () => permitted(await run("createJiraIssueLink", LINK(OWN, FOREIGN))));
    test(`REFUSE — ${tool} createJiraIssueLink with no owned side`, async () => refused(await run("createJiraIssueLink", LINK(FOREIGN, "PROJ-6"))));
    test(`REFUSE — ${tool} createJiraIssueLink carrying a comment onto a side not owned`, async () => refused(await run("createJiraIssueLink", LINK(OWN, FOREIGN, { comment: "hi" }))));
    test(`REFUSE — ${tool} createJiraIssueLink with a side that is no key`, async () => refused(await run("createJiraIssueLink", LINK(OWN, "10042"))));
    test(`PERMIT — ${tool} addOrEditJiraIssueWorklog on an owned ticket, adding and editing`, async () => {
      permitted(await run("addOrEditJiraIssueWorklog", WORK(OWN)));
      permitted(await run("addOrEditJiraIssueWorklog", WORK(OWN, { worklogId: "1" })));
    });
    test(`REFUSE — ${tool} addOrEditJiraIssueWorklog on a foreign ticket`, async () => refused(await run("addOrEditJiraIssueWorklog", WORK(FOREIGN))));
  }
  test("the grader gives the same verdicts", async () => {
    const b = buildPassingBundle("jira");
    const s = b.sessions.find((x) => x.marker === "S13")!;
    const own = `${b.run.container}-890`;
    const other = `${b.run.container}-891`;
    b.repos[s.root].frBindings.push({ path: "specs/frs/fr-890.md", title: "Own", key: own, milestone: null });
    const g = (op: string, i: Obj): Promise<boolean> => ungated(b, s.sessionId, "executeWrite", wrap(op, i));
    expect([await g("createJiraIssueLink", LINK(own, other)), await g("createJiraIssueLink", LINK(other, other)), await g("addOrEditJiraIssueWorklog", WORK(own)), await g("addOrEditJiraIssueWorklog", WORK(other))]).toEqual([false, true, false, true]);
  });
});

describe("AC-STE-866.3 / .4 / .5 — the recorded catalogue", () => {
  const READS = ["listJiraIssueTransitions", "listJiraIssueLinkTypes", "listJiraIssueRemoteIssueLinks", "listJiraIssueWorklogs", "listJiraIssueChangelogs", "listJiraStatuses", "listJiraBoards", "listJiraProjects", "listJiraProjectIssueTypesMetadata"];
  const REFUSED = ["addLoomInteraction", "convertJiraIssueHierarchy", "createJiraIssueRemoteIssueLink", "editJiraEntityProperty", "linkToFocusArea", "manageJiraProjectVersion", "manageJiraProjectVersionRelatedWork", "manageJiraSprint", "setJsmAgentAvailability", "transitionJsmRequest", "updateJiraAlignItem", "uploadAttachmentToJiraIssue", "watchJiraIssue"];
  test("every recorded Jira read passes under executeRead", async () => {
    for (const n of READS) permitted(await ask("executeRead", wrap(n, { issueIdOrKey: FOREIGN })));
  });
  test("every recorded Confluence write passes, under executeWrite and executeDestructive", async () => {
    for (const n of ["addConfluenceReaction", "addLabelsToConfluenceContent", "createConfluenceAttachment", "createConfluenceComment", "createConfluenceInfographicForPage", "createConfluenceMauiApp", "createConfluenceSpace", "editConfluenceInfographicForPage", "editConfluenceMauiApp", "manageConfluenceApproval", "unwatchConfluenceLabel", "unwatchConfluenceSpace", "updateConfluenceComment", "updateConfluenceCommentResolution", "watchConfluenceContent", "watchConfluenceLabel", "watchConfluenceSpace"]) {
      permitted(await ask("executeWrite", wrap(n, { contentId: "1" })));
      permitted(await ask("executeDestructive", wrap(n, { contentId: "1" })));
    }
  });
  for (const n of REFUSED) {
    test(`REFUSE — ${n}, even on an owned ticket`, async () => {
      for (const tool of ["executeWrite", "executeDestructive", "executeRead"]) {
        const r = await ask(tool, wrap(n, { issueIdOrKey: OWN }));
        refused(r);
        expect(r.stderr).toContain(n);
      }
    });
  }
  test("the refusal of an unlisted operation says it is unlisted, and how it gets done", async () => {
    const r = await ask("executeWrite", wrap("addLoomInteraction", {}));
    refused(r);
    const remedy = r.stderr.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("person");
    expect(remedy).toContain("list");
    expect(remedy).not.toContain("spelled exactly");
  });
  test("the refusal of a nameless call still says to name an operation", async () => {
    const r = await ask("executeWrite", { inputs: {}, cloudId: CLOUD });
    refused(r);
    expect(r.stderr).toContain("name");
  });
  test("REFUSE — a name no catalogue lists", async () => refused(await ask("executeRead", wrap("listJiraFrobs", {}))));
});

describe("AC-STE-865.4 / AC-STE-866.2 — a create or a move that names its project or type twice", () => {
  const create = (over: Obj): Obj => ({ cloudId: CLOUD, projectKey: "OTHER", issueType: "Task", summary: "x", ...over });
  for (const [title, over] of [
    ["additional_fields.project", { additional_fields: { project: { key: "PROJ" } } }],
    ["additional_fields.issuetype", { projectKey: "PROJ", additional_fields: { issuetype: { name: "Epic" } } }],
    ["two different labels lists", { projectKey: "PROJ", labels: ["a"], additional_fields: { labels: ["b"] } }],
    ["two different parents", { projectKey: "PROJ", parent: "PROJ-1", additional_fields: { parent: { key: "PROJ-2" } } }],
    ["a project key with spaces", { projectKey: " PROJ " }],
  ] as Array<[string, Obj]>) {
    test(`REFUSE — create: ${title}`, async () => {
      refused(await ask("createJiraIssue", create(over)));
      refused(await ask("executeWrite", wrap("createJiraIssue", create(over))));
    });
  }
  test("CONTROL — a create in a project no target binds passes", async () => permitted(await ask("createJiraIssue", create({ additional_fields: { labels: ["a"] } }))));
  for (const block of ["fields", "additional_fields"]) {
    test(`REFUSE — an edit of another project's ticket that moves it into the declared project (${block})`, async () => {
      refused(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: "OTHER-1", [block]: { project: { key: "PROJ" } } }));
      refused(await ask("executeWrite", wrap("editJiraIssue", { issueIdOrKey: "OTHER-1", [block]: { project: { key: " proj " } } })));
    });
  }
  for (const project of [{ id: "10000" }, "10000", 10000, { name: "Declared project" }, "https://s.example.invalid/projects/PROJ"]) {
    test(`REFUSE — a move whose project cannot be resolved (${JSON.stringify(project)})`, async () => refused(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: "OTHER-1", fields: { project } })));
  }
  test("CONTROL — an edit naming the ticket's own project is judged as any edit of it", async () => permitted(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: OWN, fields: { project: { key: "PROJ" }, summary: "x" } })));
  // Review r3 — the grader's twin, on a run with an old space beside the shared one.
  for (const block of ["fields", "additional_fields"]) {
    for (const [title, project, out] of [["the shared project", { key: "SHARED" }, true], ["a project it cannot resolve", { id: "10000" }, true], ["its own project", { key: "OWN" }, false], ["another project", { key: "ELSE" }, false]] as Array<[string, Obj, boolean]>) {
      test(`the grader ${out ? "reports" : "passes"} an edit of an owned old-space ticket that names ${title} (${block})`, async () => {
        const b = buildPassingBundle("jira");
        b.run.repointFrom = "DST2";
        const s = b.sessions.find((x) => x.marker === "S13")!;
        b.repos[s.root].frBindings.push({ path: "specs/frs/fr-5.md", title: "Own", key: "DST2-5", milestone: null });
        const key = project.key === "SHARED" ? b.run.container.toLowerCase() : project.key === "OWN" ? "DST2" : project.key;
        const input = { issueIdOrKey: "DST2-5", [block]: { project: key === undefined ? project : { key } } };
        expect(await ungated(b, s.sessionId, "editJiraIssue", input)).toBe(out);
        expect(await ungated(b, s.sessionId, "executeWrite", wrap("editJiraIssue", input))).toBe(out);
      });
    }
  }
  test("CONTROL — an edit that moves it elsewhere passes", async () => permitted(await ask("editJiraIssue", { cloudId: CLOUD, issueIdOrKey: "OTHER-1", fields: { project: { key: "ELSE" } } })));
});

describe("AC-STE-867.4 — the grader's fetch and re-list rules on a wrapped read whose keys have no place", () => {
  const KEYOF = (b: LiveBundle): string => `${b.run.container}-960`;
  const item = (b: LiveBundle, key: string, tag: string): ToolCall["result"] => ({ isError: false, text: "", exitCode: null, lastPage: null, items: [{ key, summary: "S", labels: [tag], status: "To Do", parent: null, milestone: null, issueType: "Task", kind: "issue", container: b.run.container } as never] });
  async function editAfter(inputs: Obj): Promise<boolean> {
    const b = buildPassingBundle("jira");
    const s = b.sessions.find((x) => x.marker === "S13")!;
    s.calls.push({ ref: `${s.sessionId}:toolu_fetch`, at: new Date(Date.parse(s.calls.at(-1)!.at) + 500).toISOString(), name: `${serverPrefix("jira", s.root)}executeRead`, input: { name: "getJiraIssue", inputs, cloudId: CLOUD }, result: item(b, KEYOF(b), b.roots[s.root].tag), sidechain: false });
    return ungated(b, s.sessionId, "editJiraIssue", { cloudId: CLOUD, issueIdOrKey: KEYOF(b), fields });
  }
  test("CONTROL — an owned wrapped fetch is gated", async () => {
    expect(await editAfter({ issueIdOrKey: KEYOF(buildPassingBundle("jira")) })).toBe(false);
  });
  test("a wrapped fetch naming two sites proves nothing", async () => {
    expect(await editAfter({ issueIdOrKey: KEYOF(buildPassingBundle("jira")), cloudId: "other.example.invalid" })).toBe(true);
  });
  for (const [title, over, want] of [
    ["CONTROL — as recorded, wrapped", {}, false],
    ["a key beside inputs is no re-list", { jql: "project = X" }, true],
  ] as Array<[string, Obj, boolean]>) {
    test(`the Epic re-list: ${title}`, async () => {
      const b = clone(buildPassingBundle("jira"));
      let rewrapped = 0;
      for (const s of b.sessions) {
        for (const c of s.calls) {
          const bare = c.name.split("__").at(-1)!;
          if (bare !== "searchJiraIssuesUsingJql" || !/issuetype\s*=\s*epic/i.test(String(c.input.jql))) continue;
          c.name = c.name.slice(0, -bare.length) + "executeRead";
          const { cloudId, ...inputs } = c.input;
          c.input = { name: bare, inputs, cloudId, ...over };
          rewrapped++;
        }
      }
      expect(rewrapped).toBeGreaterThan(0);
      const g = (await import("../adapters/_shared/src/shared_tracker_live_grader")) as unknown as { gradeBundle: (b: LiveBundle, o: { behaviourDigestNow: string }) => { findings: Array<{ code: string; detail?: string }> } };
      const v = g.gradeBundle(b, { behaviourDigestNow: b.run.behaviourDigest.digest });
      expect(v.findings.some((f) => f.code === "ungated-write" && /listing/.test(f.detail ?? ""))).toBe(want);
    });
  }
});

describe("AC-STE-869.3 — the first-turn detector sees a create on both surfaces", () => {
  const line = (name: string, input: Obj): string => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
  const turn = (name: string, input: Obj) => parseStreamJsonTranscript(`${line(name, input)}\n${line("AskUserQuestion", {})}`);
  for (const [name, input] of [
    ["mcp__atlassian__createJiraIssue", {}],
    ["mcp__claude_ai_Atlassian__createJiraIssue", {}],
    ["mcp__atlassian__executeWrite", wrap("createJiraIssue", {})],
    ["mcp__claude_ai_Atlassian__executeWrite", wrap("createJiraIssue", {})],
    ["mcp__atlassian__executeRead", wrap("createJiraIssue", {})],
    ["mcp__atlassian__executeWrite", { inputs: {} }],
    ["mcp__atlassian__executeDestructive", { name: 7 }],
    ["mcp__jira_cloud__createJiraIssue", {}],
    ["mcp__jira_cloud__executeWrite", wrap("createJiraIssue", {})],
    ["mcp__jira_cloud__executeWrite", { inputs: {} }],
  ] as Array<[string, Obj]>) {
    test(`VIOLATION — ${name} ${JSON.stringify(input)}`, () => expect(() => assertFirstTurnShape(turn(name, input))).toThrow(SocraticFirstTurnViolationError));
  }
  for (const [name, input] of [["mcp__atlassian__executeRead", wrap("searchJiraIssuesUsingJql", {})], ["mcp__atlassian__executeRead", {}], ["mcp__atlassian__executeWrite", wrap("editJiraIssue", {})], ["mcp__db__executeWrite", { sql: "x" }], ["mcp__atlassian__getJiraIssue", {}]] as Array<[string, Obj]>) {
    test(`CONTROL — ${name} ${JSON.stringify(input)} is no create`, () => expect(assertFirstTurnShape(turn(name, input)).outcome).toBe("ok-asked"));
  }
});

describe("AC-STE-869.1 / .3 — the docs an agent follows on v2", () => {
  const read = (p: string): string => readFileSync(join(PLUGIN_ROOT, p), "utf-8");
  test("the project style has a v2 signal", () => {
    for (const p of ["adapters/jira.md", "skills/setup/SKILL.md"]) {
      expect(read(p), p).toContain('`"simplified": true`');
      expect(read(p), p).toContain('`"style": "next-gen"`');
    }
  });
  test("AC-field discovery names its inputs, and no doc names the REST call as the step's source", () => {
    const step = read("docs/setup-tracker-mode.md").split("one-time AC-field discovery")[1]!.slice(0, 1400);
    const ref = read("docs/setup-reference.md").split("\n").find((l) => l.startsWith("4. For Jira"))!;
    for (const doc of [step, ref]) for (const word of ["getJiraIssueTypeMetaWithFields", "projectIdOrKey", "issueTypeId", "requiredFieldsOnly: false", "executeRead"]) expect(doc).toContain(word);
    expect(ref).not.toContain("GET /rest/api/3/field");
  });
});

describe("AC-STE-869.3 — the shared-tracker smoke's pre-flight fence reads both surfaces", () => {
  const SKILL = readFileSync(join(PLUGIN_ROOT, "..", "..", ".claude", "skills", "shared-tracker-smoke", "SKILL.md"), "utf-8");
  const shape = (f: string): unknown => (JSON.parse(readFileSync(join(PLUGIN_ROOT, "tests", "fixtures", "live-shapes", "jira", f), "utf-8")) as { answer: unknown }).answer;
  /** Run the fence's own jq command whose text holds `needle` over one saved answer. */
  function jq(needle: string, file: string, answer: unknown): { code: number; out: string } {
    const line = SKILL.split("\n").find((l) => l.includes("jq ") && l.includes(needle))!;
    const cmd = /jq (-e|-r) (?:--arg k "\$\{KEY\}" )?'([^']*)'/.exec(line)!;
    const dir = mkdtempSync(join(tmpdir(), "dpt-869-fence-"));
    try {
      writeFileSync(join(dir, file), JSON.stringify(answer));
      const p = Bun.spawnSync(["jq", cmd[1]!, "--arg", "k", "ZZ", cmd[2]!, join(dir, file)], { stdout: "pipe", stderr: "pipe" });
      return { code: p.exitCode, out: p.stdout.toString().trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const un = (a: unknown): unknown => (a as { data: unknown }).data;
  for (const [name, spell] of [["v1", un], ["v2", (a: unknown) => a]] as Array<[string, (a: unknown) => unknown]>) {
    test(`${name}: the space, Epic and task checks pass and the type is read`, () => {
      const space = spell(shape("listJiraProjects.last.v2.json"));
      const types = spell(shape("listJiraProjectIssueTypesMetadata.v2.json"));
      expect(jq(".values[]?", "s.json", space).code).toBe(0);
      expect(jq('index("Epic")', "t.json", types).code).toBe(0);
      expect(jq('index("task")', "t.json", types).code).toBe(0);
      expect(jq("first'", "t.json", types).out).toBe("Task");
    });
  }
  test("the second-server read: an answer passes, an in-band error does not", () => {
    expect(jq('has("error")', "r.json", { data: { accountId: "x" } }).code).toBe(0);
    expect(jq('has("error")', "r.json", { data: { error: "X", status: 401 } }).code).not.toBe(0);
    expect(jq('has("error")', "r.json", { error: "X" }).code).not.toBe(0);
    expect(jq('has("error")', "r.json", [{ id: "x" }]).code).toBe(0);
    expect(jq('has("error")', "r.json", []).code).not.toBe(0);
  });
});
