// M_e8850b review 2 — F1 and F5.
//
// F1: root C declares no Jira site; its sibling A declares one and binds the
// same project, so the hook gives C A's site (`inheritSites`). `decide
// --from-transcript` in C cannot see A, so it records the site its search ran
// at (`searchSite`), and the hook holds a `reuse` or `create` receipt to the
// site the target is given. Every leg runs the real decide CLI and the SHIPPED
// `.sh` gate. Each refuse leg has a permit twin that differs in the site only.
//
// F5: the other-site refusal names the `site` key to add for an https URL with
// a path or a trailing slash, as `siteMatches` reads that value.
//
// Invented hosts, UUIDs and keys only.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { siteHostOf, siteMatches } from "../adapters/_shared/src/atlassian_site";
import { announceReceipt, writeReceipt, type ReceiptInput } from "../adapters/_shared/src/tracker_receipts";
import { EPIC, MILESTONE, PLUGIN_ROOT, SESSION, SIBLING_TAG, Transcript, cleanupTemps, gate, jiraTicket, makeWorld, moduleRel, permitProblem, refusalProblem, runModule, show, type Run, type World } from "./_m_b2fdc0_ste729_fixture";
import { commitAll } from "./_span_fixture";

setDefaultTimeout(180_000);

type Obj = Record<string, unknown>;
const HOST = "tracker.example.invalid";
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const OTHER_HOST = "other.example.invalid";
const OTHER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const TITLE = "Payout export";
const KEY = "PROJ-577";
const SEARCH = "mcp__atlassian__searchJiraIssuesUsingJql";

function declareSite(w: World, lines: string[]): void {
  const p = join(w.root, "CLAUDE.md");
  const src = readFileSync(p, "utf-8");
  if (!src.includes("### Jira\n\n")) throw new Error("fixture: no ### Jira sub-section");
  writeFileSync(p, src.replace("### Jira\n\n", `### Jira\n\n${lines.map((l) => `${l}\n`).join("")}`));
  commitAll(w.root, "fixture: declare the site");
}

let A: World; // declares the site, is the session's cwd
let C: World; // declares no site, binds the same project
let idOnly: World; // F5: declares only cloud_id
beforeAll(() => {
  A = makeWorld({ boundFr: "PROJ-520" });
  declareSite(A, [`site: ${HOST}`, `cloud_id: ${UUID}`]);
  C = makeWorld({ tag: SIBLING_TAG, boundFr: "PROJ-530" });
  idOnly = makeWorld({ boundFr: "PROJ-520" });
  declareSite(idOnly, [`cloud_id: ${UUID}`]);
});
afterAll(cleanupTemps);

const permits = (r: Run): void => expect(permitProblem(r), show(r)).toBeNull();
const refuses = (r: Run, ...needles: string[]): void => {
  expect(refusalProblem(r), show(r)).toBeNull();
  for (const n of needles) expect(r.stderr).toContain(n);
};

/** The search `query` prints for `w`, as JSON. */
function printedSearch(w: World): Obj {
  const q = runModule(PLUGIN_ROOT, "create_idempotency_probe.ts", ["query", w.root, "--title", TITLE, "--parent", EPIC]);
  const line = q.stdout.split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error(`fixture: query printed no search:\n${show(q)}`);
  return JSON.parse(line) as Obj;
}

const row = (tag: string): Obj => ({ key: KEY, id: "10177", fields: { ...(jiraTicket(KEY).fields as Obj), summary: TITLE, labels: [tag], parent: { key: EPIC } } });

let runs = 0;
/**
 * The printed search run in `w` at each of `sites` (one page per site, chained
 * by a page token), then `decide --from-transcript` on those pages, recorded.
 */
function decided(w: World, sites: string[], hit: boolean, tag = SIBLING_TAG): { t: Transcript; out: string } {
  const printed = printedSearch(w);
  const t = new Transcript();
  const ids = sites.map((site, n) => {
    const last = n === sites.length - 1;
    const id = t.use(SEARCH, { cloudId: site, ...printed, ...(n > 0 ? { nextPageToken: `tok-${n}` } : {}) });
    const issues = last && hit ? [row(tag)] : [];
    t.result(id, [{ type: "text", text: JSON.stringify({ issues, isLast: last, ...(last ? {} : { nextPageToken: `tok-${n + 1}` }) }) }]);
    return id;
  });
  const path = join(w.scratch, `t-${++runs}.jsonl`);
  writeFileSync(path, t.lines.join("\n") + "\n");
  const d = runModule(PLUGIN_ROOT, "create_idempotency_probe.ts", ["decide", w.root, "--from-transcript", path, ...ids, "--title", TITLE, "--parent", EPIC, "--attempt", "fast"]);
  t.run(d);
  return { t, out: d.stdout };
}

/** An attach-target receipt for `w`, so a create's parent is proven (the create gate's last step). */
function attached(t: Transcript, w: World): Transcript {
  const input: ReceiptInput = {
    kind: "attach-target",
    adapter: "jira",
    container: "PROJ",
    subject: MILESTONE,
    decision: "parent",
    evidence: { surface: "parent", key: EPIC, planFile: w.planRel, provenance: { kind: "not-applicable" } },
  };
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = SESSION;
  let path: string;
  try {
    path = writeReceipt(w.root, input);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = prev;
  }
  t.bash(`bun run "${join(PLUGIN_ROOT, moduleRel("attach_project_milestone.ts"))}" ${w.root} jira PROJ ${w.planFile} /tmp/listing.json`, announceReceipt(path));
  return t;
}

const editKey = (t: Transcript, cloudId: string): Promise<Run> =>
  gate(PLUGIN_ROOT, "mcp__atlassian__editJiraIssue", { cloudId, issueIdOrKey: KEY, fields: { summary: "Retitled" } }, t, A.root);
const createTicket = (t: Transcript, cloudId: string): Promise<Run> =>
  gate(
    PLUGIN_ROOT,
    "mcp__atlassian__createJiraIssue",
    { cloudId, projectKey: "PROJ", issueTypeName: "Task", summary: TITLE, parent: EPIC, additional_fields: { labels: [SIBLING_TAG] } },
    t,
    A.root,
  );

describe("F1 — decide records the site its transcript search ran at", () => {
  test("a reuse receipt carries the search's cloudId as searchSite", () => {
    const { out } = decided(C, [OTHER_UUID], true);
    expect(out).toContain('"outcome":"reused"');
    const path = out.split("\n").find((l) => l.startsWith("dpt-receipt:"))!.replace(/^dpt-receipt:\s*/, "").replace(/\s+sha256:\S+\s*$/, "");
    const r = JSON.parse(readFileSync(path, "utf-8")) as { evidence: Obj };
    expect(r.evidence).toEqual({ key: KEY, searchSite: OTHER_UUID });
  });

  test("REFUSE — in a root with no site, pages searched at two sites are not one search", () => {
    expect(decided(C, [UUID, OTHER_UUID], true).out).toContain('"reason":"page-violates-query"');
  });
  test("PERMIT TWIN — the same two pages at one site decide", () => {
    expect(decided(C, [UUID, UUID], true).out).toContain('"outcome":"reused"');
  });
});

describe("F1 — the hook holds a decide receipt to the site the target is given", () => {
  test("REFUSE — a reuse decided from another site's page does not own the key at the inherited site", async () => {
    const { t, out } = decided(C, [OTHER_UUID], true);
    expect(out).toContain('"outcome":"reused"');
    refuses(await editKey(t, UUID));
  });
  test("PERMIT TWIN — a reuse decided from the inherited site's page owns the key", async () => {
    const { t, out } = decided(C, [UUID], true);
    expect(out).toContain('"outcome":"reused"');
    permits(await editKey(t, UUID));
  });
  test("PERMIT TWIN — the inherited site named by its host counts as that site", async () => {
    const { t } = decided(C, [`https://${HOST}`], true);
    permits(await editKey(t, UUID));
  });

  test("REFUSE — a create decided from another site's empty page authorises no create at the inherited site", async () => {
    const { t, out } = decided(C, [OTHER_UUID], false);
    expect(out).toContain('"outcome":"create"');
    refuses(await createTicket(attached(t, C), UUID), "decided from a search at another site");
  });
  test("PERMIT TWIN — a create decided from the inherited site's empty page authorises the create", async () => {
    const { t, out } = decided(C, [UUID], false);
    expect(out).toContain('"outcome":"create"');
    permits(await createTicket(attached(t, C), UUID));
  });
});

describe("F5 — the add-key hint reads the host as siteMatches does", () => {
  test("siteHostOf drops a path and a trailing slash, as siteMatches does", () => {
    for (const v of [`https://${OTHER_HOST}/`, `https://${OTHER_HOST}/jira`, `https://${OTHER_HOST.toUpperCase()}`, OTHER_HOST]) {
      expect(siteHostOf(v)).toBe(OTHER_HOST);
      expect(siteMatches({ site: OTHER_HOST }, v)).toBe(true);
    }
  });
  for (const value of [`https://${OTHER_HOST}/`, `https://${OTHER_HOST}/jira`]) {
    test(`REFUSE with the site hint — cloudId ${value}`, async () => {
      const r = await gate(PLUGIN_ROOT, "mcp__atlassian__editJiraIssue", { cloudId: value, issueIdOrKey: "PROJ-520", fields: { summary: "Retitled" } }, new Transcript(), idOnly.root);
      refuses(r, `add \`site: ${OTHER_HOST}\``);
    });
  }
  test("TWIN — a bare host gets the same hint", async () => {
    const r = await gate(PLUGIN_ROOT, "mcp__atlassian__editJiraIssue", { cloudId: OTHER_HOST, issueIdOrKey: "PROJ-520", fields: { summary: "Retitled" } }, new Transcript(), idOnly.root);
    refuses(r, `add \`site: ${OTHER_HOST}\``);
  });
});
